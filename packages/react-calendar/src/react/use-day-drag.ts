/**
 * @packageDocumentation
 * 日単位のドラッグインタラクション（月ビューのセル・終日行）。
 *
 * - セルのクリック / ドラッグ → 日範囲の選択（終日イベントの新規作成）
 * - 帯セグメントのドラッグ → 日単位の移動（期間・壁時計時刻は維持）
 * - ドラッグ中は Escape でキャンセル
 *
 * 時間グリッドと同様のプロップゲッターパターン。セル要素は
 * `getDayCellProps` の `ref` でレジストリに登録され、ポインタ座標から
 * 現在乗っている日を判定する。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef } from 'react';
import { dayDragPreviewRange } from '../core/interaction';
import { startOfDayInZone } from '../core/timezone';
import type { DateRange, EventOccurrence, EventSegment, RecurringEditScope } from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 日セル要素に付与する props。 */
export interface DayCellProps {
  /** セル要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空きセルでの作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 日付キー。 */
  'data-koyomi-date': string;
}

/** 帯セグメント要素に付与する props。 */
export interface SegmentProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter = クリック相当、Delete = 削除）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** 発生キー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`。 */
  'data-koyomi-dragging'?: 'true';
}

/** `useDayDrag` が返すハンドラ集。 */
export interface DayDragHandlers {
  /** 日セル用の props を返す。 */
  getDayCellProps(day: { date: Date; key: string }): DayCellProps;
  /** 帯セグメント用の props を返す。 */
  getSegmentProps(segment: EventSegment): SegmentProps;
  /**
   * 現在のドラッグプレビューの日範囲（日 0:00 起点、`end` 排他）。
   * コンポーネントは各週に投影してハイライトを描画する。
   */
  previewRange: DateRange | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録された日セルの情報。 */
interface RegisteredDayCell {
  /** セルの DOM 要素。 */
  element: HTMLElement;
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
}

/** 進行中のドラッグセッションの内部状態。 */
interface DragSession {
  /** 作成ドラッグか移動ドラッグか。 */
  kind: 'create' | 'move';
  /** 移動ドラッグの対象発生（作成ドラッグでは `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時に確定した基準日（その日の 0:00）。 */
  anchorDay: Date;
  /**
   * ポインタが実際に動いたか（クリックとの区別に使う）。
   * 基準日（`anchorDay`）と異なる日に一度でも乗った場合にのみ `true` にする。
   * 単に pointermove が発火しただけ（同じセル内の微小な揺れ）では `true` にしない。
   */
  moved: boolean;
  /** 直近のポインタ位置から計算したプレビュー範囲。 */
  lastRange: DateRange;
  /** このセッションが登録した document リスナーを解除する関数。 */
  cleanup: () => void;
}

/**
 * 日単位ドラッグのインタラクションを提供するフック。
 *
 * 月ビューでは時間指定イベントの帯（span 1）も日単位で移動できる
 * （Google カレンダーの月ビューと同じ。壁時計時刻は維持される）。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 */
export function useDayDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): DayDragHandlers {
  const { calendar, callbacks } = params;

  /** ポインタ座標 → 日の判定に使う、登録済みセルのレジストリ。 */
  const registryRef = useRef<Map<string, RegisteredDayCell>>(new Map());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const sessionRef = useRef<DragSession | null>(null);
  /**
   * 直後の click イベントを 1 回だけ抑制するフラグ。
   * ブラウザは pointerup の後に click を自動発火するため、ドラッグ移動が確定した
   * 直後のその click では `onEventClick` を誤って発火させたくない
   * （`use-time-grid-drag.ts` の `suppressNextClickRef` と同じパターン）。
   */
  const suppressNextClickRef = useRef(false);

  // document に登録するリスナーは pointerdown 発火時点でクロージャとして
  // 生成されるため、常に最新の api / timeZone / callbacks を参照できるよう ref に保持する
  const apiRef = useRef(calendar.api);
  apiRef.current = calendar.api;
  const timeZoneRef = useRef(calendar.state.timeZone);
  timeZoneRef.current = calendar.state.timeZone;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // アンマウント時、ドラッグ中であれば document リスナーを解除する
  useEffect(() => {
    return () => {
      sessionRef.current?.cleanup();
      sessionRef.current = null;
    };
  }, []);

  /**
   * clientX/clientY の位置に対応する日を、登録済みセルから探す。
   * 矩形に座標が含まれるセルを優先し、なければ中心距離が最も近いセルを返す。
   * セルが 1 件も登録されていない場合は `null` を返す。
   */
  function locateDay(clientX: number, clientY: number): Date | null {
    let containing: Date | null = null;
    let nearest: Date | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const cell of registryRef.current.values()) {
      const rect = cell.element.getBoundingClientRect();
      if (
        containing === null &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        containing = cell.date;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = (clientX - centerX) ** 2 + (clientY - centerY) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = cell.date;
      }
    }
    return containing ?? nearest;
  }

  /** 範囲選択を確定する（`onSelectRange` があればそれを呼び、なければ即時作成する）。 */
  function commitSelection(range: DateRange): void {
    const onSelectRange = callbacksRef.current?.onSelectRange;
    if (onSelectRange !== undefined) {
      onSelectRange({ range, allDay: true });
      return;
    }
    apiRef.current.createEvent({
      title: '(タイトルなし)',
      start: range.start,
      end: range.end,
      allDay: true,
    });
  }

  /** 発生の移動を確定する（繰り返しならスコープを解決してから適用する）。 */
  async function commitMove(occurrence: EventOccurrence, range: DateRange): Promise<void> {
    let scope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const resolveRecurringScope = callbacksRef.current?.resolveRecurringScope;
      scope =
        resolveRecurringScope === undefined
          ? 'this'
          : await resolveRecurringScope(occurrence, 'move');
      if (scope === null) {
        return;
      }
      apiRef.current.updateEvent(
        occurrence.eventId,
        { start: range.start, end: range.end },
        { occurrenceStart: occurrence.originalStart, scope },
      );
    } else {
      apiRef.current.updateEvent(occurrence.eventId, { start: range.start, end: range.end });
    }
    callbacksRef.current?.onEventChange?.({
      occurrence,
      newRange: range,
      allDay: occurrence.allDay,
      scope,
    });
  }

  /** 発生の削除を確定する（繰り返しならスコープを解決してから適用する）。 */
  async function commitDelete(occurrence: EventOccurrence): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    if (occurrence.isRecurring) {
      const resolveRecurringScope = callbacksRef.current?.resolveRecurringScope;
      const scope =
        resolveRecurringScope === undefined
          ? 'this'
          : await resolveRecurringScope(occurrence, 'delete');
      if (scope === null) {
        return;
      }
      apiRef.current.deleteEvent(occurrence.eventId, {
        occurrenceStart: occurrence.originalStart,
        scope,
      });
      return;
    }
    apiRef.current.deleteEvent(occurrence.eventId);
  }

  /**
   * ドラッグ（作成・移動）を開始する。
   *
   * document に pointermove / pointerup / keydown（Escape）のリスナーを登録し、
   * pointermove ごとにプレビューを更新、pointerup で確定、Escape でキャンセルする。
   */
  function beginDrag(
    kind: 'create' | 'move',
    occurrence: EventOccurrence | null,
    anchorDay: Date,
  ): void {
    if (sessionRef.current !== null) {
      return;
    }

    const computeRange = (pointerDay: Date): DateRange =>
      dayDragPreviewRange({ mode: kind, occurrence }, pointerDay, anchorDay, timeZoneRef.current);

    const handlePointerMove = (event: PointerEvent): void => {
      const session = sessionRef.current;
      if (session === null) {
        return;
      }
      const pointerDay = locateDay(event.clientX, event.clientY) ?? anchorDay;
      const range = computeRange(pointerDay);
      // 基準日と異なる日に乗った場合にのみ「移動した」とみなす。
      // 同じセル内での微小な揺れ（pointermove は発火するが日は変わらない）は
      // クリック相当として扱いたいため、ここでは moved にしない。
      if (pointerDay.getTime() !== anchorDay.getTime()) {
        session.moved = true;
      }
      session.lastRange = range;
      apiRef.current.setDragPreview({
        kind,
        occurrenceKey: occurrence?.key ?? null,
        range,
        // 本フックは常に「日単位の帯」を扱うため、プレビューは常に帯としての
        // 見た目にする。ここでの allDay は「帯としてのプレビューか」を表す
        // 見た目のフラグであり、イベント自体の allDay 属性とは独立している
        // （時間指定だが複数日にまたがるセグメントの移動でも帯として見せる）。
        allDay: true,
      });
    };

    const finish = (): void => {
      const session = sessionRef.current;
      cleanup();
      sessionRef.current = null;
      apiRef.current.setDragPreview(null);
      if (session === null) {
        return;
      }
      if (kind === 'create') {
        commitSelection(session.lastRange);
        return;
      }
      if (session.moved && occurrence !== null) {
        // 移動が確定した直後、ブラウザが自動発火する click を 1 回だけ抑制する。
        // resolveRecurringScope の解決を待つ前（同期のうち）にフラグを立てることで、
        // 確定処理が非同期でも click 到達前に確実に反映されるようにする。
        suppressNextClickRef.current = true;
        void commitMove(occurrence, session.lastRange);
      }
    };

    const handlePointerUp = (): void => {
      finish();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      cleanup();
      sessionRef.current = null;
      apiRef.current.setDragPreview(null);
    };

    function cleanup(): void {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('keydown', handleKeyDown);
    }

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('keydown', handleKeyDown);

    sessionRef.current = {
      kind,
      occurrence,
      anchorDay,
      moved: false,
      lastRange: computeRange(anchorDay),
      cleanup,
    };
  }

  function getDayCellProps(day: { date: Date; key: string }): DayCellProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(day.key);
        } else {
          registryRef.current.set(day.key, { element, date: day.date });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        beginDrag('create', null, day.date);
      },
      'data-koyomi-date': day.key,
    };
  }

  function getSegmentProps(segment: EventSegment): SegmentProps {
    const occurrence = segment.occurrence;
    const dragPreview = calendar.state.dragPreview;
    const isDraggingThis =
      dragPreview !== null &&
      dragPreview.kind === 'move' &&
      dragPreview.occurrenceKey === occurrence.key;

    const base: SegmentProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || occurrence.event.editable === false) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        const anchorDay =
          locateDay(event.clientX, event.clientY) ??
          startOfDayInZone(occurrence.start, timeZoneRef.current);
        beginDrag('move', occurrence, anchorDay);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        callbacksRef.current?.onEventClick?.(occurrence, event.nativeEvent);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          void commitDelete(occurrence);
        }
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
    };
    return isDraggingThis ? { ...base, 'data-koyomi-dragging': 'true' } : base;
  }

  const dragPreview = calendar.state.dragPreview;

  return {
    getDayCellProps,
    getSegmentProps,
    previewRange: dragPreview !== null ? dragPreview.range : null,
    isDragging: dragPreview !== null,
  };
}
