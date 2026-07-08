/**
 * @packageDocumentation
 * 時間グリッド（週/日ビュー）のドラッグインタラクション。
 *
 * - 空き領域のクリック / ドラッグ → 範囲選択（新規作成）
 * - イベント本体のドラッグ → 移動（列をまたぐ移動・スナップ対応）
 * - 下端ハンドルのドラッグ → リサイズ（終了時刻の変更）
 * - ドラッグ中は Escape でキャンセル
 *
 * プロップゲッターパターンを採用する。コンポーネントは
 * {@link TimeGridDragHandlers.getDayProps} などを対応する要素に
 * スプレッドするだけでインタラクションが有効になる。
 *
 * DOM 座標から日時への変換は、日列要素の矩形（`getBoundingClientRect`）と
 * {@link timeAtGridPosition} で行う。列要素は `getDayProps` が返す
 * `ref` コールバックで内部レジストリに登録される。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { dragPreviewRange, timeAtGridPosition } from '../core/interaction';
import { addDaysInZone, addMinutesInZone, minutesOfDayInZone } from '../core/timezone';
import type {
  DateRange,
  EventOccurrence,
  PositionedOccurrence,
  RecurringEditScope,
  TimeGridDay,
} from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 日列要素に付与する props。 */
export interface TimeGridDayProps {
  /** 列要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 日付キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-date': string;
}

/** イベントブロック要素に付与する props。 */
export interface TimeGridEventProps {
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
  /** ドラッグ中の対象なら `'true'`（薄く表示するなどのスタイルフック）。 */
  'data-koyomi-dragging'?: 'true';
}

/** リサイズハンドル要素に付与する props。 */
export interface TimeGridResizeHandleProps {
  /** リサイズドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * クリックの伝播を止める。移動のない pointerdown → pointerup の後に
   * 発生する click が親のイベント要素まで伝わり、誤って `onEventClick` を
   * 発火させてしまうのを防ぐ。
   */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** スタイルフック。 */
  'data-koyomi-resize-handle': 'true';
}

/** 1 日分のドラッグプレビューの表示位置。 */
export interface TimeGridPreviewSegment {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 日内の表示開始（分）。 */
  startMinutes: number;
  /** 日内の表示終了（分、排他）。 */
  endMinutes: number;
}

/** `useTimeGridDrag` が返すハンドラ集。 */
export interface TimeGridDragHandlers {
  /** 日列要素用の props を返す。 */
  getDayProps(day: TimeGridDay): TimeGridDayProps;
  /** イベントブロック用の props を返す。 */
  getEventProps(item: PositionedOccurrence): TimeGridEventProps;
  /** リサイズハンドル用の props を返す。 */
  getResizeHandleProps(item: PositionedOccurrence): TimeGridResizeHandleProps;
  /**
   * 指定日のドラッグプレビュー区間を返す（その日に重ならなければ `null`）。
   * コンポーネントはこれをオーバーレイとして描画する。
   */
  previewFor(day: TimeGridDay): TimeGridPreviewSegment | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録される列要素の情報。 */
interface ColumnEntry {
  /** 列の DOM 要素。 */
  element: HTMLElement;
  /** 列が表す日の 0:00（絶対時刻）。 */
  date: Date;
}

/** ドラッグセッション（開始から終了までの内部状態）。 */
interface DragSession {
  /** 操作の種類。 */
  mode: 'create' | 'move' | 'resize';
  /** 対象の発生（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。 */
  anchor: Date;
  /**
   * セッション開始時点（ポインタが実質的に未移動の状態）を基準とするプレビュー範囲。
   * `create` ではクリック相当のプレビュー長（`anchor` から snap 分）、
   * `move` / `resize` では対象発生の現在の範囲（`occurrence.start`〜`occurrence.end`）。
   * {@link DragSession.hasMoved} の判定基準として使う。
   */
  baselineRange: DateRange;
  /**
   * 実質的な移動があったか（計算された range が {@link DragSession.baselineRange} と
   * 異なったことが一度でもあるか）。
   *
   * 実ブラウザではクリック操作でも微小な pointermove が発生することがあるため、
   * 「pointermove が発生したか」ではなく「計算結果が変わったか」で判定する。
   * そうしないと通常クリックがドラッグ確定として扱われ、
   * クリック作成が `defaultEventMinutes` ではなく `snapMinutes` 長になったり、
   * クリックによる `onEventClick` が抑制されてしまったりする。
   */
  hasMoved: boolean;
  /** document に登録したリスナーを解除する。 */
  cleanup: () => void;
}

/**
 * セッション開始時点（ポインタ未移動）を基準とするプレビュー範囲を求める。
 *
 * - `create`（`occurrence === null`）— ポインタが `anchor` から動いていない場合に
 *   {@link dragPreviewRange} が返す範囲（クリック相当の snap 分の長さ）と同じ式で計算する
 * - `move` / `resize`（`occurrence !== null`）— 対象発生の現在の範囲そのもの。
 *   `anchor` からの移動量が 0 のときの {@link dragPreviewRange} の計算結果と一致する
 */
function baselineRangeForSession(
  occurrence: EventOccurrence | null,
  anchor: Date,
  context: { timeZone: string; snap: number },
): DateRange {
  if (occurrence === null) {
    return dragPreviewRange({ mode: 'create', occurrence: null, anchor }, anchor, context);
  }
  return { start: occurrence.start, end: occurrence.end };
}

/**
 * 列要素の矩形内でのポインタの縦位置（0〜1）を求める。
 * 矩形の高さが 0 以下の場合は 0 を返す（0 除算・NaN の防御）。
 */
function fractionYFromClientY(rect: DOMRect, clientY: number): number {
  if (rect.height <= 0) {
    return 0;
  }
  return (clientY - rect.top) / rect.height;
}

/**
 * 時間グリッドのドラッグインタラクションを提供するフック。
 *
 * 変更の適用はライブラリが行う（`api.updateEvent` 相当）。繰り返し
 * イベントの場合は `callbacks.resolveRecurringScope` でスコープを解決し、
 * `null` が返ればキャンセルする。適用後に `callbacks.onEventChange` を呼ぶ。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 */
export function useTimeGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimeGridDragHandlers {
  // document レベルのリスナーはクロージャで最新の params を参照する必要があるため、
  // 常に最新値を保持する ref を経由してアクセスする（レンダーの度に同期する）。
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 日付キー → 列要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, ColumnEntry>());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const dragSessionRef = useRef<DragSession | null>(null);
  /** 直後の click イベントを 1 回だけ抑制するフラグ（ドラッグ確定直後用）。 */
  const suppressNextClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // アンマウント時に進行中のセッションがあれば document リスナーを確実に解除する。
  useEffect(() => {
    return () => {
      dragSessionRef.current?.cleanup();
      dragSessionRef.current = null;
    };
  }, []);

  /**
   * clientX を含む列（なければ中心距離が最も近い列）を探す。
   * レジストリが空なら `null` を返す。
   */
  function findColumnForClientX(clientX: number): ColumnEntry | null {
    let containing: ColumnEntry | null = null;
    let nearest: ColumnEntry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of registryRef.current.values()) {
      const rect = entry.element.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        containing = entry;
        break;
      }
      const center = (rect.left + rect.right) / 2;
      const distance = Math.abs(clientX - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    return containing ?? nearest;
  }

  /** ポインタ位置に対応する列の日時（スナップ済み）を返す。列が見つからなければ `null`。 */
  function pointerDateAt(clientX: number, clientY: number): Date | null {
    const column = findColumnForClientX(clientX);
    if (column === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return timeAtGridPosition({
      day: column.date,
      fractionY: fractionYFromClientY(column.element.getBoundingClientRect(), clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
  }

  /** 現在のセッションとポインタ位置からプレビュー範囲を計算する。列が見つからなければ `null`。 */
  function computeRangeFromEvent(
    session: DragSession,
    clientX: number,
    clientY: number,
  ): DateRange | null {
    const pointer = pointerDateAt(clientX, clientY);
    if (pointer === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return dragPreviewRange(
      { mode: session.mode, occurrence: session.occurrence, anchor: session.anchor },
      pointer,
      { timeZone: state.timeZone, snap: state.options.snapMinutes },
    );
  }

  /** クリック（移動なし）による新規作成範囲（`defaultEventMinutes` 分の長さ）を返す。 */
  function clickRangeForCreate(anchor: Date): DateRange {
    const { state } = paramsRef.current.calendar;
    return {
      start: anchor,
      end: addMinutesInZone(anchor, state.options.defaultEventMinutes, state.timeZone),
    };
  }

  /** 作成ドラッグ（`create`）の確定処理。 */
  function commitCreate(session: DragSession, nativeEvent: MouseEvent): void {
    const range = session.hasMoved
      ? computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY)
      : clickRangeForCreate(session.anchor);
    if (range !== null) {
      const { calendar, callbacks } = paramsRef.current;
      if (callbacks?.onSelectRange) {
        callbacks.onSelectRange({ range, allDay: false });
      } else {
        calendar.api.createEvent({ title: '(タイトルなし)', start: range.start, end: range.end });
      }
    }
    paramsRef.current.calendar.api.setDragPreview(null);
  }

  /** 移動・リサイズドラッグの確定処理。移動がなかった場合は何もしない（クリックは onClick に任せる）。 */
  async function commitMoveOrResize(session: DragSession, nativeEvent: MouseEvent): Promise<void> {
    if (!session.hasMoved) {
      return;
    }
    const occurrence = session.occurrence;
    if (occurrence === null) {
      return;
    }
    const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
    if (range === null) {
      paramsRef.current.calendar.api.setDragPreview(null);
      return;
    }

    let recurringScope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const action: 'move' | 'resize' = session.mode === 'resize' ? 'resize' : 'move';
      const resolveRecurringScope = paramsRef.current.callbacks?.resolveRecurringScope;
      const resolved = resolveRecurringScope
        ? await resolveRecurringScope(occurrence, action)
        : 'this';
      if (resolved === null) {
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      recurringScope = resolved;
    }

    paramsRef.current.calendar.api.updateEvent(
      occurrence.eventId,
      { start: range.start, end: range.end },
      recurringScope === null
        ? undefined
        : { occurrenceStart: occurrence.originalStart, scope: recurringScope },
    );
    paramsRef.current.callbacks?.onEventChange?.({
      occurrence,
      newRange: range,
      allDay: false,
      scope: recurringScope,
    });
    suppressNextClickRef.current = true;
    paramsRef.current.calendar.api.setDragPreview(null);
  }

  /** セッションの種類に応じて確定処理を振り分ける。 */
  function commitSession(session: DragSession, nativeEvent: MouseEvent): void {
    if (session.mode === 'create') {
      commitCreate(session, nativeEvent);
      return;
    }
    void commitMoveOrResize(session, nativeEvent);
  }

  /**
   * ドラッグセッションを開始する。document に pointermove / pointerup / keydown の
   * リスナーを登録し、`cleanup` でそれらを解除できるようにする。
   */
  function startSession(
    mode: DragSession['mode'],
    occurrence: EventOccurrence | null,
    anchor: Date,
  ): void {
    // 前のセッションが残っていれば（通常発生しないが）先に後始末する。
    dragSessionRef.current?.cleanup();

    const { state } = paramsRef.current.calendar;
    const baselineRange = baselineRangeForSession(occurrence, anchor, {
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });

    const session: DragSession = {
      mode,
      occurrence,
      anchor,
      baselineRange,
      hasMoved: false,
      cleanup: () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('keydown', handleKeyDown);
      },
    };

    // jsdom は PointerEvent 未実装のことがあるため、MouseEvent 互換の型で受け取る。
    const handlePointerMove = (nativeEvent: MouseEvent): void => {
      const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
      if (range === null) {
        return;
      }
      if (
        range.start.getTime() !== session.baselineRange.start.getTime() ||
        range.end.getTime() !== session.baselineRange.end.getTime()
      ) {
        session.hasMoved = true;
      }
      paramsRef.current.calendar.api.setDragPreview({
        kind: session.mode,
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: false,
      });
    };

    const handlePointerUp = (nativeEvent: MouseEvent): void => {
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      commitSession(session, nativeEvent);
    };

    const handleKeyDown = (nativeEvent: KeyboardEvent): void => {
      if (nativeEvent.key !== 'Escape') {
        return;
      }
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      paramsRef.current.calendar.api.setDragPreview(null);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('keydown', handleKeyDown);

    dragSessionRef.current = session;
    setIsDragging(true);
  }

  /** 空き領域での作成ドラッグを開始する。 */
  function handleDayPointerDown(day: TimeGridDay, event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const { state } = paramsRef.current.calendar;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = timeAtGridPosition({
      day: day.date,
      fractionY: fractionYFromClientY(rect, event.clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
    startSession('create', null, anchor);
  }

  /** ポインタ位置が乗っている列を基準にアンカー日時を求める（列が未登録なら fallback を使う）。 */
  function anchorFromPointer(event: ReactPointerEvent<HTMLElement>, fallback: Date): Date {
    return pointerDateAt(event.clientX, event.clientY) ?? fallback;
  }

  /**
   * イベント本体のドラッグ（移動）を開始する。`editable: false` の場合は開始しない。
   *
   * `stopPropagation` は開始の可否によらず常に呼ぶ。呼ばないと `editable: false`
   * のイベントでポインタ操作が列（`getDayProps`）まで伝播し、意図せず
   * その列の作成ドラッグが始まってしまう。
   */
  function handleEventPointerDown(
    occurrence: EventOccurrence,
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    startSession('move', occurrence, anchorFromPointer(event, occurrence.start));
  }

  /**
   * リサイズハンドルのドラッグを開始する。`editable: false` の場合は開始しない。
   * `stopPropagation` を常に呼ぶ理由は {@link handleEventPointerDown} と同じ。
   */
  function handleResizePointerDown(
    occurrence: EventOccurrence,
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    startSession('resize', occurrence, anchorFromPointer(event, occurrence.end));
  }

  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。ドラッグ確定直後は 1 回だけ抑制する。 */
  function handleEventClick(
    occurrence: EventOccurrence,
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    paramsRef.current.callbacks?.onEventClick?.(occurrence, event.nativeEvent);
  }

  /**
   * 繰り返し発生の削除。スコープ解決が必要な場合は解決してから削除する。
   * `editable: false` のイベントは削除しない（ドラッグ移動・リサイズと同じ契約）。
   */
  async function deleteOccurrence(occurrence: EventOccurrence): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    if (!occurrence.isRecurring) {
      paramsRef.current.calendar.api.deleteEvent(occurrence.eventId);
      return;
    }
    const resolveRecurringScope = paramsRef.current.callbacks?.resolveRecurringScope;
    const scope = resolveRecurringScope
      ? await resolveRecurringScope(occurrence, 'delete')
      : 'this';
    if (scope === null) {
      return;
    }
    paramsRef.current.calendar.api.deleteEvent(occurrence.eventId, {
      occurrenceStart: occurrence.originalStart,
      scope,
    });
  }

  /** キーボード操作（Enter/Space = クリック相当、Delete/Backspace = 削除）。 */
  function handleEventKeyDown(
    occurrence: EventOccurrence,
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    if (event.key === 'Enter' || event.key === ' ') {
      // キーボード操作由来のためポインタ座標を持たない MouseEvent を新規に作成する。
      paramsRef.current.callbacks?.onEventClick?.(occurrence, new MouseEvent('click'));
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      void deleteOccurrence(occurrence);
    }
  }

  function getDayProps(day: TimeGridDay): TimeGridDayProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(day.key);
        } else {
          registryRef.current.set(day.key, { element, date: day.date });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleDayPointerDown(day, event);
      },
      'data-koyomi-date': day.key,
    };
  }

  function getEventProps(item: PositionedOccurrence): TimeGridEventProps {
    const occurrence = item.occurrence;
    const base: TimeGridEventProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleEventPointerDown(occurrence, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        handleEventClick(occurrence, event);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleEventKeyDown(occurrence, event);
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
    };
    if (dragSessionRef.current?.occurrence?.key === occurrence.key) {
      return { ...base, 'data-koyomi-dragging': 'true' };
    }
    return base;
  }

  function getResizeHandleProps(item: PositionedOccurrence): TimeGridResizeHandleProps {
    const occurrence = item.occurrence;
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleResizePointerDown(occurrence, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      'data-koyomi-resize-handle': 'true',
    };
  }

  function previewFor(day: TimeGridDay): TimeGridPreviewSegment | null {
    const { state } = paramsRef.current.calendar;
    const preview = state.dragPreview;
    if (preview === null || preview.allDay) {
      return null;
    }
    const timeZone = state.timeZone;
    const dayStart = day.date;
    const dayEnd = addDaysInZone(dayStart, 1, timeZone);
    if (
      preview.range.end.getTime() <= dayStart.getTime() ||
      preview.range.start.getTime() >= dayEnd.getTime()
    ) {
      return null;
    }
    const startsInDay = preview.range.start.getTime() >= dayStart.getTime();
    const endsAtOrAfterDayEnd = preview.range.end.getTime() >= dayEnd.getTime();
    return {
      kind: preview.kind,
      startMinutes: startsInDay ? minutesOfDayInZone(preview.range.start, timeZone) : 0,
      endMinutes: endsAtOrAfterDayEnd ? 1440 : minutesOfDayInZone(preview.range.end, timeZone),
    };
  }

  return {
    getDayProps,
    getEventProps,
    getResizeHandleProps,
    previewFor,
    isDragging,
  };
}
