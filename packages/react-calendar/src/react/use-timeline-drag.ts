/**
 * @packageDocumentation
 * タイムラインビュー（横 = 時間 × 行 = リソース）のドラッグインタラクション。
 *
 * - 空き領域のクリック / 横ドラッグ → 範囲選択（新規作成。行は開始行に固定）
 * - 帯のドラッグ → 移動（横 = 時間、縦 = 行の同時変更）。終日の帯は日単位スナップ
 * - 左右端ハンドルのドラッグ → リサイズ（時間のみ。行不変）
 * - キーボード — `←`/`→` = `snapMinutes` 分移動（終日は ∓/± 1 日）、
 *   `Shift+←`/`→` = リサイズ、`↑`/`↓` = 隣の行へ移動（画面上の視覚軸に対応する操作）
 * - ドラッグ中は Escape / pointercancel でキャンセルし、画面端で横に自動スクロールする
 *
 * 横位置 → 日時の変換は行要素の矩形と {@link timeAtTimelineOffset}（表示分の座標系）で
 * 行う。行要素は `getRowProps` が返す `ref` コールバックで内部レジストリに登録される。
 * 確定時は時間の変更と `resourceId` の変更を 1 つのパッチに合成して 1 回の
 * `updateEvent` にする（{@link ./use-resource-grid-drag} と同じ規則）。
 * allDay⇔時間指定の越境変換は提供しない。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { dayDragPreviewRange, dragPreviewRange, timeAtTimelineOffset } from '../core/interaction';
import {
  addDaysInZone,
  addMinutesInZone,
  dateKeyInZone,
  minutesOfDayInZone,
  startOfDayInZone,
} from '../core/timezone';
import type {
  CalendarEventPatch,
  DateRange,
  EventOccurrence,
  RecurringEditScope,
  TimelineItem,
  TimelineRow,
} from '../core/types';
import {
  attachDragSessionListeners,
  autoScrollVelocity,
  checkBeforeEventChange,
  checkBeforeEventDelete,
  checkBeforeSelectRange,
  createAutoScrollLoop,
  laneResourceIdOf,
  resolveScopeForRecurring,
} from './drag-common';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;

/** タイムライン行要素に付与する props。 */
export interface TimelineRowProps {
  /** 行要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 行キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-resource': string;
}

/** 帯（タイムラインアイテム）要素に付与する props。 */
export interface TimelineItemProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter = クリック相当、Delete = 削除、矢印キー = 移動・リサイズ・行移動）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** オカレンスキー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`（薄く表示するなどのスタイルフック）。 */
  'data-koyomi-dragging'?: 'true';
}

/** リサイズハンドル要素に付与する props。 */
export interface TimelineResizeHandleProps {
  /** リサイズドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリックの伝播を止める（親要素の `onEventClick` 誤発火防止）。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** スタイルフック。どちらの端のハンドルかを示す。 */
  'data-koyomi-resize-handle': 'start' | 'end';
}

/** 1 行分のドラッグプレビューの表示位置（表示分の座標系）。 */
export interface TimelinePreviewSegment {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 表示開始（表示分）。 */
  startMinutes: number;
  /** 表示終了（表示分、排他）。 */
  endMinutes: number;
}

/** `useTimelineDrag` が返すハンドラ集。 */
export interface TimelineDragHandlers {
  /** 行要素用の props を返す。 */
  getRowProps(row: TimelineRow): TimelineRowProps;
  /** 帯（タイムラインアイテム）用の props を返す。 */
  getItemProps(item: TimelineItem): TimelineItemProps;
  /**
   * リサイズハンドル用の props を返す（終日の帯には付けない）。
   * @param edge - どちらの端のハンドルか。省略時は `'end'`（右端、終了時刻の変更）
   */
  getResizeHandleProps(item: TimelineItem, edge?: 'start' | 'end'): TimelineResizeHandleProps;
  /**
   * 指定行のドラッグプレビュー区間（表示分）を返す（その行が対象でなければ `null`）。
   * コンポーネントはこれをオーバーレイとして描画する。
   */
  previewFor(row: TimelineRow): TimelinePreviewSegment | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録される行要素の情報。 */
interface RowEntry {
  /** 行の DOM 要素（横幅がタイムライン全体のトラック幅に一致する要素）。 */
  element: HTMLElement;
  /** 行のリソース ID（未割り当て行は `null`）。 */
  resourceId: string | null;
}

/** ドラッグセッション（開始から終了までの内部状態）。 */
interface DragSession {
  /** 操作の種類。`allday-move` は終日の帯の日単位移動。 */
  mode: 'create' | 'move' | 'resize' | 'resize-start' | 'allday-move';
  /** 対象のオカレンス（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。 */
  anchor: Date;
  /** `allday-move` 用: ドラッグ開始時のポインタ位置が属する日の 0:00。 */
  anchorDay: Date;
  /** 対象レーンのリソース ID（`move` / `allday-move` はポインタ行に追従）。 */
  targetResourceId: string | null;
  /** ドラッグ開始時点のリソース ID（変更検出用）。 */
  initialResourceId: string | null;
  /** セッション開始時点を基準とするプレビュー範囲（移動判定の基準）。 */
  baselineRange: DateRange;
  /** 実質的な移動（時間またはリソースの変化）があったか。 */
  hasMoved: boolean;
  /** document に登録したリスナーを解除し、オートスクロールを停止する。 */
  cleanup: () => void;
}

/** 行要素の矩形内でのポインタの横位置（0〜1）を求める（幅 0 以下は 0）。 */
function fractionXFromClientX(rect: DOMRect, clientX: number): number {
  if (rect.width <= 0) {
    return 0;
  }
  return (clientX - rect.left) / rect.width;
}

/**
 * タイムラインビューのドラッグインタラクションを提供するフック。
 *
 * 変更の適用はライブラリが行う（`api.updateEvent`）。繰り返しイベントの場合は
 * `callbacks.resolveRecurringScope` でスコープを解決し、`null` が返ればキャンセルする。
 * 適用後に `callbacks.onEventChange`（`resourceId` 付き）を呼ぶ。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 * @example
 * ```tsx
 * const drag = useTimelineDrag({ calendar, callbacks });
 * return <div {...drag.getRowProps(row)} />;
 * ```
 */
export function useTimelineDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimelineDragHandlers {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 行キー → 行要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, RowEntry>());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const dragSessionRef = useRef<DragSession | null>(null);
  /** 直後の click イベントを 1 回だけ抑制するフラグ。 */
  const suppressNextClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      dragSessionRef.current?.cleanup();
      dragSessionRef.current = null;
    };
  }, []);

  /** 例外を `onError`（なければ console.error）へ報告する。 */
  function reportError(error: unknown): void {
    const onError = paramsRef.current.callbacks?.onError;
    if (onError) {
      onError(error);
      return;
    }
    // biome-ignore lint/suspicious/noConsole: onError 未指定時の既定動作
    console.error(error);
  }

  /** 表示日の 0:00 の配列を返す（タイムラインビューでなければ空配列）。 */
  function displayDays(): readonly Date[] {
    const { viewModel } = paramsRef.current.calendar;
    return viewModel.type === 'timeline' ? viewModel.days.map((day) => day.date) : [];
  }

  /** オカレンスの現在のレーンのリソース ID（{@link laneResourceIdOf}）。 */
  function occurrenceLaneId(occurrence: EventOccurrence): string | null {
    return laneResourceIdOf(occurrence, paramsRef.current.calendar.state.resources);
  }

  /** clientY を含む行（なければ中心距離が最も近い行）を探す。 */
  function findRowForClientY(clientY: number): RowEntry | null {
    let containing: RowEntry | null = null;
    let nearest: RowEntry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of registryRef.current.values()) {
      const rect = entry.element.getBoundingClientRect();
      if (clientY >= rect.top && clientY < rect.bottom) {
        containing = entry;
        break;
      }
      const center = (rect.top + rect.bottom) / 2;
      const distance = Math.abs(clientY - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    return containing ?? nearest;
  }

  /** ポインタの横位置に対応する表示分（スナップ前の生値）を返す。行が見つからなければ `null`。 */
  function rawDisplayMinutesAt(clientX: number, clientY: number): number | null {
    const row = findRowForClientY(clientY);
    if (row === null) {
      return null;
    }
    const days = displayDays();
    if (days.length === 0) {
      return null;
    }
    const fraction = fractionXFromClientX(row.element.getBoundingClientRect(), clientX);
    return fraction * days.length * MINUTES_PER_DAY;
  }

  /**
   * ポインタ位置に対応する日時（スナップ済み）を返す。行が見つからなければ `null`。
   * @param allowExclusiveEnd - リサイズの終了端のみ `true`（排他端を許容）
   */
  function pointerDateAt(
    clientX: number,
    clientY: number,
    allowExclusiveEnd: boolean,
  ): Date | null {
    const raw = rawDisplayMinutesAt(clientX, clientY);
    if (raw === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return timeAtTimelineOffset({
      days: displayDays(),
      displayMinutes: raw,
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
      allowExclusiveEnd,
    });
  }

  /** ポインタの横位置が属する表示日の 0:00 を返す。行が見つからなければ `null`。 */
  function pointerDayAt(clientX: number, clientY: number): Date | null {
    const raw = rawDisplayMinutesAt(clientX, clientY);
    if (raw === null) {
      return null;
    }
    const days = displayDays();
    const index = Math.min(Math.max(Math.floor(raw / MINUTES_PER_DAY), 0), days.length - 1);
    return days[index] ?? null;
  }

  /** 現在のセッションとポインタ位置からプレビュー範囲を計算する。 */
  function computeRangeFromEvent(
    session: DragSession,
    clientX: number,
    clientY: number,
  ): DateRange | null {
    const { state } = paramsRef.current.calendar;
    if (session.mode === 'allday-move') {
      const pointerDay = pointerDayAt(clientX, clientY);
      if (pointerDay === null || session.occurrence === null) {
        return null;
      }
      return dayDragPreviewRange(
        { mode: 'move', occurrence: session.occurrence },
        pointerDay,
        session.anchorDay,
        state.timeZone,
      );
    }
    const allowExclusiveEnd = session.mode === 'resize';
    const pointer = pointerDateAt(clientX, clientY, allowExclusiveEnd);
    if (pointer === null) {
      return null;
    }
    // 'allday-move' は冒頭で早期リターン済みのため、ここでは時間グリッド系のモードに確定している
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

  /**
   * 作成を確定する（`onBeforeSelectRange` で拒否されなければ、`onSelectRange` が
   * あればそれを呼び、なければ既定作成する）。
   */
  async function commitCreateRange(range: DateRange, resourceId: string | null): Promise<void> {
    try {
      const gate = checkBeforeSelectRange(paramsRef.current.callbacks, {
        range,
        allDay: false,
        resourceId,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        return;
      }
      const { calendar, callbacks } = paramsRef.current;
      if (callbacks?.onSelectRange) {
        callbacks.onSelectRange({ range, allDay: false, resourceId });
        return;
      }
      calendar.api.createEvent({
        title: calendar.state.options.defaultEventTitle,
        start: range.start,
        end: range.end,
        ...(resourceId !== null ? { resourceId } : {}),
      });
    } catch (error) {
      reportError(error);
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /**
   * オカレンスの変更（時間・リソースの合成パッチ）を適用し、`onEventChange` を通知する
   * （スコープ解決済みの前提。{@link ./use-resource-grid-drag} と同じ規則）。
   */
  function applyChange(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange | null,
    resourceId: string | null,
    allDay: boolean,
  ): void {
    const patch: CalendarEventPatch = {};
    if (range !== null) {
      patch.start = range.start;
      patch.end = range.end;
    }
    if (resourceId !== occurrenceLaneId(occurrence)) {
      // 未割り当てへの移動は「キーが存在し値が undefined = フィールド削除」のパッチセマンティクス
      patch.resourceId = resourceId ?? undefined;
    }
    const changes = paramsRef.current.calendar.api.updateEvent(
      occurrence.eventId,
      patch,
      recurringScope === null
        ? undefined
        : { occurrenceStart: occurrence.originalStart, scope: recurringScope },
    );
    paramsRef.current.callbacks?.onEventChange?.({
      occurrence,
      newRange: range ?? { start: occurrence.start, end: occurrence.end },
      allDay,
      scope: recurringScope,
      resourceId,
      changes,
    });
  }

  /** 移動・リサイズドラッグの確定処理。移動がなかった場合は何もしない。 */
  async function commitMoveOrResize(session: DragSession, nativeEvent: MouseEvent): Promise<void> {
    try {
      if (!session.hasMoved) {
        return;
      }
      const occurrence = session.occurrence;
      if (occurrence === null) {
        return;
      }
      suppressNextClickRef.current = true;

      const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
      if (range === null) {
        return;
      }
      const timeChanged =
        range.start.getTime() !== occurrence.start.getTime() ||
        range.end.getTime() !== occurrence.end.getTime();
      const resourceChanged = session.targetResourceId !== session.initialResourceId;
      if (!timeChanged && !resourceChanged) {
        return;
      }
      const action: 'move' | 'resize' =
        session.mode === 'move' || session.mode === 'allday-move' ? 'move' : 'resize';
      const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
        occurrence,
        range: timeChanged ? range : { start: occurrence.start, end: occurrence.end },
        allDay: occurrence.allDay,
        resourceId: session.targetResourceId,
        action,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        return;
      }
      let recurringScope: RecurringEditScope | null = null;
      if (occurrence.isRecurring) {
        const resolved = await resolveScopeForRecurring(
          paramsRef.current.callbacks,
          occurrence,
          action,
        );
        if (resolved === null) {
          return;
        }
        recurringScope = resolved;
      }
      applyChange(
        occurrence,
        recurringScope,
        timeChanged ? range : null,
        session.targetResourceId,
        occurrence.allDay,
      );
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /** セッションの種類に応じて確定処理を振り分ける。 */
  function commitSession(session: DragSession, nativeEvent: MouseEvent): void {
    if (session.mode === 'create') {
      let range: DateRange | null;
      try {
        range = session.hasMoved
          ? computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY)
          : clickRangeForCreate(session.anchor);
      } catch (error) {
        reportError(error);
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      if (range === null) {
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      void commitCreateRange(range, session.targetResourceId).catch(reportError);
      return;
    }
    void commitMoveOrResize(session, nativeEvent).catch(reportError);
  }

  /** ドラッグセッションを開始する。 */
  function startSession(
    mode: DragSession['mode'],
    occurrence: EventOccurrence | null,
    anchor: Date,
    anchorDay: Date,
    initialResourceId: string | null,
  ): void {
    dragSessionRef.current?.cleanup();

    const { state } = paramsRef.current.calendar;
    const baselineRange =
      occurrence === null
        ? dragPreviewRange({ mode: 'create', occurrence: null, anchor }, anchor, {
            timeZone: state.timeZone,
            snap: state.options.snapMinutes,
          })
        : { start: occurrence.start, end: occurrence.end };

    // 横方向のオートスクロール（コンテナは timeline-body）
    const autoScroll = createAutoScrollLoop('horizontal');

    const updateAutoScroll = (clientX: number, clientY: number): void => {
      const row = findRowForClientY(clientY);
      const container = row?.element.closest('[data-koyomi="timeline-body"]') ?? null;
      if (container === null) {
        autoScroll.stop();
        return;
      }
      const rect = container.getBoundingClientRect();
      autoScroll.update(
        container,
        autoScrollVelocity({ edgeStart: rect.left, edgeEnd: rect.right, pointer: clientX }),
      );
    };

    const session: DragSession = {
      mode,
      occurrence,
      anchor,
      anchorDay,
      targetResourceId: initialResourceId,
      initialResourceId,
      baselineRange,
      hasMoved: false,
      cleanup: () => {
        detachListeners();
        autoScroll.stop();
      },
    };

    const cancelSession = (): void => {
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      paramsRef.current.calendar.api.setDragPreview(null);
    };

    // jsdom は PointerEvent 未実装のことがあるため、MouseEvent 互換の型で受け取る
    const handlePointerMove = (nativeEvent: MouseEvent): void => {
      const { clientX, clientY } = nativeEvent;
      updateAutoScroll(clientX, clientY);

      // 縦方向（行 = リソース）の追従。create は開始行に固定、resize 系は元の行のまま
      if (session.mode === 'move' || session.mode === 'allday-move') {
        const row = findRowForClientY(clientY);
        if (row !== null && row.resourceId !== session.targetResourceId) {
          session.targetResourceId = row.resourceId;
          if (row.resourceId !== session.initialResourceId) {
            session.hasMoved = true;
          }
        }
      }

      const range = computeRangeFromEvent(session, clientX, clientY);
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
        kind:
          session.mode === 'move' || session.mode === 'allday-move'
            ? 'move'
            : session.mode === 'create'
              ? 'create'
              : 'resize',
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: session.occurrence?.allDay ?? false,
        resourceId: session.targetResourceId,
      });
    };

    const handlePointerUp = (nativeEvent: MouseEvent): void => {
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      commitSession(session, nativeEvent);
    };

    const handlePointerCancel = (): void => {
      cancelSession();
    };

    const handleKeyDown = (nativeEvent: KeyboardEvent): void => {
      if (nativeEvent.key !== 'Escape') {
        return;
      }
      suppressNextClickRef.current = true;
      cancelSession();
    };

    const detachListeners = attachDragSessionListeners({
      pointermove: handlePointerMove,
      pointerup: handlePointerUp,
      pointercancel: handlePointerCancel,
      keydown: handleKeyDown,
    });

    dragSessionRef.current = session;
    setIsDragging(true);
  }

  /** 空き領域での作成ドラッグを開始する（行は開始行に固定）。 */
  function handleRowPointerDown(row: TimelineRow, event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const anchor = pointerDateAt(event.clientX, event.clientY, false);
    const anchorDay = pointerDayAt(event.clientX, event.clientY);
    if (anchor === null || anchorDay === null) {
      return;
    }
    startSession('create', null, anchor, anchorDay, row.resource?.id ?? null);
  }

  /** 帯のドラッグ（移動）を開始する。`editable: false` の場合は開始しない。 */
  function handleItemPointerDown(
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
    const anchor = pointerDateAt(event.clientX, event.clientY, false) ?? occurrence.start;
    const { state } = paramsRef.current.calendar;
    const anchorDay =
      pointerDayAt(event.clientX, event.clientY) ??
      startOfDayInZone(occurrence.start, state.timeZone);
    startSession(
      occurrence.allDay ? 'allday-move' : 'move',
      occurrence,
      anchor,
      anchorDay,
      occurrenceLaneId(occurrence),
    );
  }

  /** リサイズハンドルのドラッグを開始する。 */
  function handleResizePointerDown(
    occurrence: EventOccurrence,
    edge: 'start' | 'end',
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const fallback = edge === 'start' ? occurrence.start : occurrence.end;
    const anchor = pointerDateAt(event.clientX, event.clientY, edge === 'end') ?? fallback;
    const { state } = paramsRef.current.calendar;
    startSession(
      edge === 'start' ? 'resize-start' : 'resize',
      occurrence,
      anchor,
      startOfDayInZone(occurrence.start, state.timeZone),
      occurrenceLaneId(occurrence),
    );
  }

  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  function handleItemClick(occurrence: EventOccurrence, event: ReactMouseEvent<HTMLElement>): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    paramsRef.current.callbacks?.onEventClick?.(occurrence, event.nativeEvent);
  }

  /** 削除（Delete / Backspace）。`editable: false` は削除しない。 */
  async function deleteOccurrence(occurrence: EventOccurrence): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    const gate = checkBeforeEventDelete(paramsRef.current.callbacks, occurrence);
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      return;
    }
    if (!occurrence.isRecurring) {
      const changes = paramsRef.current.calendar.api.deleteEvent(occurrence.eventId);
      paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope: null, changes });
      return;
    }
    const scope = await resolveScopeForRecurring(paramsRef.current.callbacks, occurrence, 'delete');
    if (scope === null) {
      return;
    }
    const changes = paramsRef.current.calendar.api.deleteEvent(occurrence.eventId, {
      occurrenceStart: occurrence.originalStart,
      scope,
    });
    paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope, changes });
  }

  /** 現在のビューモデルの行並びを返す（タイムラインビューでなければ空配列）。 */
  function currentRows(): readonly TimelineRow[] {
    const { viewModel } = paramsRef.current.calendar;
    return viewModel.type === 'timeline' ? viewModel.rows : [];
  }

  /** 隣の行（`direction` = -1 で上、1 で下）のリソース ID を返す。なければ `undefined`。 */
  function adjacentResourceId(
    resourceId: string | null,
    direction: -1 | 1,
  ): string | null | undefined {
    const rows = currentRows();
    const index = rows.findIndex((row) => (row.resource?.id ?? null) === resourceId);
    if (index === -1) {
      return undefined;
    }
    const next = rows[index + direction];
    return next === undefined ? undefined : (next.resource?.id ?? null);
  }

  /** キーボード操作による変更を確定する（単発は同期完結）。 */
  async function commitKeyboardChange(
    occurrence: EventOccurrence,
    action: 'move' | 'resize',
    range: DateRange | null,
    resourceId: string | null,
  ): Promise<void> {
    const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
      occurrence,
      range: range ?? { start: occurrence.start, end: occurrence.end },
      allDay: occurrence.allDay,
      resourceId,
      action,
    });
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      return;
    }
    let recurringScope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const resolved = await resolveScopeForRecurring(
        paramsRef.current.callbacks,
        occurrence,
        action,
      );
      if (resolved === null) {
        return;
      }
      recurringScope = resolved;
    }
    applyChange(occurrence, recurringScope, range, resourceId, occurrence.allDay);
  }

  /**
   * キーボード操作。
   * - `Enter` / `Space` — クリック相当、`Delete` / `Backspace` — 削除
   * - `←` / `→` — ∓/± `snapMinutes` 分移動（終日の帯は ∓/± 1 日）、
   *   `Shift` 併用で終了時刻をリサイズ（終日の帯では無効）
   * - `↑` / `↓` — 隣の行（リソース）へ移動（原則 7: キーは画面上の視覚軸に従う）
   */
  function handleItemKeyDown(
    occurrence: EventOccurrence,
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void deleteOccurrence(occurrence).catch(reportError);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (occurrence.event.editable === false) {
        return;
      }
      const target = adjacentResourceId(
        occurrenceLaneId(occurrence),
        event.key === 'ArrowUp' ? -1 : 1,
      );
      if (target === undefined || target === occurrenceLaneId(occurrence)) {
        return;
      }
      void commitKeyboardChange(occurrence, 'move', null, target).catch(reportError);
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    if (occurrence.event.editable === false) {
      return;
    }
    const { state } = paramsRef.current.calendar;
    const timeZone = state.timeZone;
    const snap = state.options.snapMinutes;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    let range: DateRange;
    let action: 'move' | 'resize' = 'move';
    if (occurrence.allDay) {
      // 終日の帯は日単位で移動する（Shift リサイズは提供しない）
      if (event.shiftKey) {
        return;
      }
      range = {
        start: addDaysInZone(occurrence.start, direction, timeZone),
        end: addDaysInZone(occurrence.end, direction, timeZone),
      };
    } else if (event.shiftKey) {
      action = 'resize';
      const candidate = addMinutesInZone(occurrence.end, direction * snap, timeZone);
      const minEnd = addMinutesInZone(occurrence.start, snap, timeZone);
      const end = candidate.getTime() < minEnd.getTime() ? occurrence.end : candidate;
      range = { start: occurrence.start, end };
    } else {
      range = {
        start: addMinutesInZone(occurrence.start, direction * snap, timeZone),
        end: addMinutesInZone(occurrence.end, direction * snap, timeZone),
      };
    }
    if (
      range.start.getTime() === occurrence.start.getTime() &&
      range.end.getTime() === occurrence.end.getTime()
    ) {
      return;
    }
    void commitKeyboardChange(occurrence, action, range, occurrenceLaneId(occurrence)).catch(
      reportError,
    );
  }

  function getRowProps(row: TimelineRow): TimelineRowProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(row.key);
        } else {
          registryRef.current.set(row.key, {
            element,
            resourceId: row.resource?.id ?? null,
          });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleRowPointerDown(row, event);
      },
      'data-koyomi-resource': row.key,
    };
  }

  function getItemProps(item: TimelineItem): TimelineItemProps {
    const occurrence = item.occurrence;
    const base: TimelineItemProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleItemPointerDown(occurrence, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        handleItemClick(occurrence, event);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleItemKeyDown(occurrence, event);
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
    };
    if (dragSessionRef.current?.occurrence?.key === occurrence.key) {
      return { ...base, 'data-koyomi-dragging': 'true' };
    }
    return base;
  }

  function getResizeHandleProps(
    item: TimelineItem,
    edge: 'start' | 'end' = 'end',
  ): TimelineResizeHandleProps {
    const occurrence = item.occurrence;
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleResizePointerDown(occurrence, edge, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      'data-koyomi-resize-handle': edge,
    };
  }

  function previewFor(row: TimelineRow): TimelinePreviewSegment | null {
    const { state } = paramsRef.current.calendar;
    const preview = state.dragPreview;
    if (preview === null) {
      return null;
    }
    if ((preview.resourceId ?? null) !== (row.resource?.id ?? null)) {
      return null;
    }
    const days = displayDays();
    const first = days[0];
    if (first === undefined) {
      return null;
    }
    const timeZone = state.timeZone;
    const totalMinutes = days.length * MINUTES_PER_DAY;
    const rangeEnd = startOfDayInZone(
      addDaysInZone(days[days.length - 1] ?? first, 1, timeZone),
      timeZone,
    );
    if (
      preview.range.end.getTime() <= first.getTime() ||
      preview.range.start.getTime() >= rangeEnd.getTime()
    ) {
      return null;
    }
    const dayIndexByKey = new Map<string, number>(
      days.map((day, index) => [dateKeyInZone(day, timeZone), index]),
    );
    const displayOf = (instant: Date): number => {
      const index = dayIndexByKey.get(dateKeyInZone(instant, timeZone));
      if (index === undefined) {
        return 0;
      }
      return index * MINUTES_PER_DAY + minutesOfDayInZone(instant, timeZone);
    };
    const startsInRange = preview.range.start.getTime() >= first.getTime();
    const endsInRange = preview.range.end.getTime() < rangeEnd.getTime();
    return {
      kind: preview.kind,
      startMinutes: startsInRange ? displayOf(preview.range.start) : 0,
      endMinutes: endsInRange ? displayOf(preview.range.end) : totalMinutes,
    };
  }

  return {
    getRowProps,
    getItemProps,
    getResizeHandleProps,
    previewFor,
    isDragging,
  };
}
