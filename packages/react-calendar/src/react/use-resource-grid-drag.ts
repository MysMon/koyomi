/**
 * @packageDocumentation
 * リソースビュー（列 = リソース × 縦 = 時間）のドラッグインタラクション。
 *
 * - 空き領域のクリック / ドラッグ → 範囲選択（新規作成。リソースは開始列に固定）
 * - イベント本体のドラッグ → 移動（縦 = 時間、横 = リソースの同時変更）
 * - 上下端ハンドルのドラッグ → リサイズ（時間のみ。リソース不変）
 * - 終日行 — セルのクリック → 当日 1 日の終日イベント作成、
 *   終日アイテムのドラッグ → 列間移動（リソース変更のみ）
 * - キーボード — `↑`/`↓` = `snapMinutes` 分移動、`Shift+↑`/`↓` = リサイズ、
 *   `←`/`→` = 隣のリソース列へ移動（画面上の視覚軸に対応する操作）
 * - ドラッグ中は Escape / pointercancel でキャンセルし、画面端で縦に自動スクロールする
 *
 * 週/日ビューの {@link ./use-time-grid-drag} と同じプロップゲッターパターンだが、
 * 列レジストリは「1 日 = 1 列」ではなく「1 リソース = 1 列」
 * （`Map<columnKey, { element, resourceId }>`）で持つ。確定時は時間の変更と
 * `resourceId` の変更を 1 つのパッチに合成して 1 回の `updateEvent` にする
 * （詳細は `docs/internal/views-expansion-design.md` §6.4）。
 * allDay⇔時間指定の越境変換は提供しない（同 §8.3）。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { dragPreviewRange, timeAtGridPosition } from '../core/interaction';
import {
  addDaysInZone,
  addMinutesInZone,
  minutesOfDayInZone,
  startOfDayInZone,
} from '../core/timezone';
import type {
  CalendarEventPatch,
  DateRange,
  EventOccurrence,
  PositionedOccurrence,
  RecurringEditScope,
  ResourceColumn,
  TimeZoneId,
} from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import { autoScrollVelocity } from './use-time-grid-drag';

/** リソース列要素に付与する props。 */
export interface ResourceColumnProps {
  /** 列要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 列キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-resource': string;
}

/** 終日行のセル要素に付与する props。 */
export interface ResourceAllDayCellProps {
  /** クリックで当日 1 日の終日イベントを作成する。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** 列キー（スタイルフック用）。 */
  'data-koyomi-resource': string;
}

/** イベントブロック要素に付与する props。 */
export interface ResourceEventProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter = クリック相当、Delete = 削除、矢印キー = 移動・リサイズ・列移動）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** オカレンスキー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`（薄く表示するなどのスタイルフック）。 */
  'data-koyomi-dragging'?: 'true';
}

/** リサイズハンドル要素に付与する props。 */
export interface ResourceResizeHandleProps {
  /** リサイズドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリックの伝播を止める（親要素の `onEventClick` 誤発火防止）。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** スタイルフック。どちらの端のハンドルかを示す。 */
  'data-koyomi-resize-handle': 'start' | 'end';
}

/** 1 列分のドラッグプレビューの表示位置。 */
export interface ResourcePreviewSegment {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 日内の表示開始（分）。 */
  startMinutes: number;
  /** 日内の表示終了（分、排他）。 */
  endMinutes: number;
}

/** `useResourceGridDrag` が返すハンドラ集。 */
export interface ResourceGridDragHandlers {
  /** リソース列要素用の props を返す。 */
  getColumnProps(column: ResourceColumn): ResourceColumnProps;
  /** 終日行のセル用の props を返す。 */
  getAllDayCellProps(column: ResourceColumn): ResourceAllDayCellProps;
  /** 時間指定イベントブロック用の props を返す（対象レーンはオカレンスの `resourceId` から導出する）。 */
  getEventProps(item: PositionedOccurrence): ResourceEventProps;
  /** 終日アイテム用の props を返す（列間移動のみ。リサイズなし）。 */
  getAllDayItemProps(occurrence: EventOccurrence): ResourceEventProps;
  /**
   * リサイズハンドル用の props を返す。
   * @param edge - どちらの端のハンドルか。省略時は `'end'`（下端、終了時刻の変更）
   */
  getResizeHandleProps(
    item: PositionedOccurrence,
    edge?: 'start' | 'end',
  ): ResourceResizeHandleProps;
  /**
   * 指定列の時間指定ドラッグプレビュー区間を返す（その列が対象でなければ `null`）。
   * コンポーネントはこれをオーバーレイとして描画する。
   */
  previewFor(column: ResourceColumn): ResourcePreviewSegment | null;
  /** 指定列が終日プレビュー（終日アイテムの列間移動・終日作成）の対象かを返す。 */
  isAllDayPreviewTarget(column: ResourceColumn): boolean;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録される列要素の情報。 */
interface ColumnEntry {
  /** 列の DOM 要素。 */
  element: HTMLElement;
  /** 列のリソース ID（未割り当て列は `null`）。 */
  resourceId: string | null;
}

/** ドラッグセッション（開始から終了までの内部状態）。 */
interface DragSession {
  /**
   * 操作の種類。`allday-move` は終日アイテムの列間移動（リソース変更のみ）、
   * それ以外は {@link ./use-time-grid-drag} と同じ意味。
   */
  mode: 'create' | 'move' | 'resize' | 'resize-start' | 'allday-move';
  /** 対象のオカレンス（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。 */
  anchor: Date;
  /**
   * 対象レーンのリソース ID。`create` では開始列に固定、`move` / `allday-move` では
   * ポインタ位置の列に追従、`resize` 系では元の列のまま。
   */
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

/** 列要素の矩形内でのポインタの縦位置（0〜1）を求める（高さ 0 以下は 0）。 */
function fractionYFromClientY(rect: DOMRect, clientY: number): number {
  if (rect.height <= 0) {
    return 0;
  }
  return (clientY - rect.top) / rect.height;
}

/**
 * オカレンスの現在のレーンのリソース ID（未割り当ては `null`）を返す。
 *
 * `resources` に存在しない ID（参照先のない resourceId）はビュービルダーが
 * 未割り当てレーンへ合流させるため、ここでも `null` に正規化する。
 * 正規化しないと、キーボードの列移動が現在レーン（未割り当て）を見つけられず、
 * 変更検出も表示上のレーンと食い違う。
 */
function laneResourceIdOf(
  occurrence: EventOccurrence,
  resources: readonly { id: string }[],
): string | null {
  const resourceId = occurrence.event.resourceId;
  if (resourceId === undefined) {
    return null;
  }
  return resources.some((resource) => resource.id === resourceId) ? resourceId : null;
}

/**
 * リソースビューのドラッグインタラクションを提供するフック。
 *
 * 変更の適用はライブラリが行う（`api.updateEvent`）。繰り返しイベントの場合は
 * `callbacks.resolveRecurringScope` でスコープを解決し、`null` が返ればキャンセルする。
 * 適用後に `callbacks.onEventChange`（`resourceId` 付き）を呼ぶ。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 * @example
 * ```tsx
 * const drag = useResourceGridDrag({ calendar, callbacks });
 * return <div {...drag.getColumnProps(column)} />;
 * ```
 */
export function useResourceGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): ResourceGridDragHandlers {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 列キー → 列要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, ColumnEntry>());
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

  /** 表示日の 0:00 を返す（リソースビューの表示範囲の先頭）。 */
  function displayDay(): Date {
    const { state, api } = paramsRef.current.calendar;
    return startOfDayInZone(api.getVisibleRange().start, state.timeZone);
  }

  /** オカレンスの現在のレーンのリソース ID（{@link laneResourceIdOf}）。 */
  function occurrenceLaneId(occurrence: EventOccurrence): string | null {
    return laneResourceIdOf(occurrence, paramsRef.current.calendar.state.resources);
  }

  /** clientX を含む列（なければ中心距離が最も近い列）を探す。 */
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

  /** ポインタ位置に対応する日時（スナップ済み）を返す。列が見つからなければ `null`。 */
  function pointerDateAt(clientX: number, clientY: number): Date | null {
    const column = findColumnForClientX(clientX);
    if (column === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return timeAtGridPosition({
      day: displayDay(),
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
    const mode = session.mode === 'allday-move' ? 'move' : session.mode;
    return dragPreviewRange(
      { mode, occurrence: session.occurrence, anchor: session.anchor },
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
   * 作成（時間指定・終日共通）を確定する。`onSelectRange` があればそれを呼び、
   * なければ選択レーンの `resourceId` を含めて既定作成する
   * （未割り当てレーンでは `resourceId` を付けない）。
   */
  function commitCreateRange(range: DateRange, allDay: boolean, resourceId: string | null): void {
    try {
      const { calendar, callbacks } = paramsRef.current;
      if (callbacks?.onSelectRange) {
        callbacks.onSelectRange({ range, allDay, resourceId });
        return;
      }
      calendar.api.createEvent({
        title: calendar.state.options.defaultEventTitle,
        start: range.start,
        end: range.end,
        ...(allDay ? { allDay: true } : {}),
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
   * （スコープ解決済みの前提）。{@link ./use-time-grid-drag} と同じく常に同期的に
   * 完結させる（ドラッグ確定直後のネイティブ click 抑制を間に合わせるため）。
   *
   * @param range - 変更後の日時範囲。`null` なら時間は変更しない（リソースのみの変更）
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
      // 未割り当てへの移動は「キーが存在し値が undefined = フィールド削除」の
      // パッチセマンティクスに従う
      patch.resourceId = resourceId ?? undefined;
    }
    paramsRef.current.calendar.api.updateEvent(
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
    });
  }

  /** 繰り返しオカレンスのスコープを解決する（単発は呼び出し元で `null` 固定）。 */
  async function resolveScopeForRecurring(
    occurrence: EventOccurrence,
    action: 'move' | 'resize' | 'delete' | 'update',
  ): Promise<RecurringEditScope | null> {
    const resolveRecurringScope = paramsRef.current.callbacks?.resolveRecurringScope;
    return resolveRecurringScope ? resolveRecurringScope(occurrence, action) : 'this';
  }

  /**
   * 移動・リサイズ・列間移動ドラッグの確定処理。移動がなかった場合は何もしない
   * （クリックは onClick に任せる）。`finally` で必ずプレビューを消す。
   */
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

      if (session.mode === 'allday-move') {
        // 終日アイテムの列間移動: リソースのみの変更（時間は不変）
        if (session.targetResourceId === session.initialResourceId) {
          return;
        }
        let scope: RecurringEditScope | null = null;
        if (occurrence.isRecurring) {
          const resolved = await resolveScopeForRecurring(occurrence, 'move');
          if (resolved === null) {
            return;
          }
          scope = resolved;
        }
        applyChange(occurrence, scope, null, session.targetResourceId, occurrence.allDay);
        return;
      }

      const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
      if (range === null) {
        return;
      }
      const action: 'move' | 'resize' = session.mode === 'move' ? 'move' : 'resize';
      let recurringScope: RecurringEditScope | null = null;
      if (occurrence.isRecurring) {
        const resolved = await resolveScopeForRecurring(occurrence, action);
        if (resolved === null) {
          return;
        }
        recurringScope = resolved;
      }
      applyChange(occurrence, recurringScope, range, session.targetResourceId, false);
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /** セッションの種類に応じて確定処理を振り分ける。 */
  function commitSession(session: DragSession, nativeEvent: MouseEvent): void {
    if (session.mode === 'create') {
      try {
        const range = session.hasMoved
          ? computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY)
          : clickRangeForCreate(session.anchor);
        if (range !== null) {
          commitCreateRange(range, false, session.targetResourceId);
          return;
        }
      } catch (error) {
        reportError(error);
      }
      paramsRef.current.calendar.api.setDragPreview(null);
      return;
    }
    void commitMoveOrResize(session, nativeEvent).catch(reportError);
  }

  /** ドラッグセッションを開始する。 */
  function startSession(
    mode: DragSession['mode'],
    occurrence: EventOccurrence | null,
    anchor: Date,
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

    // 縦方向のオートスクロール（時間グリッドと同じ仕組み。コンテナは resource-body）
    let scrollContainer: Element | null = null;
    let scrollVelocity = 0;
    let scrollFrameId: number | null = null;

    const scrollStep = (): void => {
      if (scrollContainer === null || scrollVelocity === 0) {
        scrollFrameId = null;
        return;
      }
      scrollContainer.scrollTop += scrollVelocity;
      scrollFrameId = requestAnimationFrame(scrollStep);
    };

    const stopAutoScroll = (): void => {
      if (scrollFrameId !== null) {
        cancelAnimationFrame(scrollFrameId);
        scrollFrameId = null;
      }
      scrollContainer = null;
      scrollVelocity = 0;
    };

    const updateAutoScroll = (clientX: number, clientY: number): void => {
      if (mode === 'allday-move') {
        // 終日行の列間移動は縦スクロールに追従する必要がない
        return;
      }
      const column = findColumnForClientX(clientX);
      const container = column?.element.closest('[data-koyomi="resource-body"]') ?? null;
      if (container === null) {
        stopAutoScroll();
        return;
      }
      const rect = container.getBoundingClientRect();
      scrollContainer = container;
      scrollVelocity = autoScrollVelocity({
        edgeStart: rect.top,
        edgeEnd: rect.bottom,
        pointer: clientY,
      });
      if (scrollVelocity === 0) {
        if (scrollFrameId !== null) {
          cancelAnimationFrame(scrollFrameId);
          scrollFrameId = null;
        }
        return;
      }
      if (scrollFrameId === null) {
        scrollFrameId = requestAnimationFrame(scrollStep);
      }
    };

    const session: DragSession = {
      mode,
      occurrence,
      anchor,
      targetResourceId: initialResourceId,
      initialResourceId,
      baselineRange,
      hasMoved: false,
      cleanup: () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerCancel);
        document.removeEventListener('keydown', handleKeyDown);
        stopAutoScroll();
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

      // 横方向（リソース）の追従。create は開始列に固定、resize 系は元の列のまま
      if (session.mode === 'move' || session.mode === 'allday-move') {
        const column = findColumnForClientX(clientX);
        if (column !== null && column.resourceId !== session.targetResourceId) {
          session.targetResourceId = column.resourceId;
          if (column.resourceId !== session.initialResourceId) {
            session.hasMoved = true;
          }
        }
      }

      if (session.mode === 'allday-move') {
        const occurrenceForPreview = session.occurrence;
        if (occurrenceForPreview !== null) {
          paramsRef.current.calendar.api.setDragPreview({
            kind: 'move',
            occurrenceKey: occurrenceForPreview.key,
            range: { start: occurrenceForPreview.start, end: occurrenceForPreview.end },
            allDay: true,
            resourceId: session.targetResourceId,
          });
        }
        return;
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
        kind: session.mode === 'move' ? 'move' : session.mode === 'create' ? 'create' : 'resize',
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: false,
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

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
    document.addEventListener('keydown', handleKeyDown);

    dragSessionRef.current = session;
    setIsDragging(true);
  }

  /** 空き領域での作成ドラッグを開始する（リソースは開始列に固定）。 */
  function handleColumnPointerDown(
    column: ResourceColumn,
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const { state } = paramsRef.current.calendar;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = timeAtGridPosition({
      day: displayDay(),
      fractionY: fractionYFromClientY(rect, event.clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
    startSession('create', null, anchor, column.resource?.id ?? null);
  }

  /** イベント本体のドラッグ（移動）を開始する。`editable: false` の場合は開始しない。 */
  function handleEventPointerDown(
    occurrence: EventOccurrence,
    mode: 'move' | 'allday-move',
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const anchor = pointerDateAt(event.clientX, event.clientY) ?? occurrence.start;
    startSession(mode, occurrence, anchor, occurrenceLaneId(occurrence));
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
    const anchor = pointerDateAt(event.clientX, event.clientY) ?? fallback;
    startSession(
      edge === 'start' ? 'resize-start' : 'resize',
      occurrence,
      anchor,
      occurrenceLaneId(occurrence),
    );
  }

  /**
   * クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。
   *
   * 伝播は常に止める。止めないと終日アイテムのクリックが親の終日セル
   * （{@link getAllDayCellProps} の作成クリック）まで伝わり、既存の予定を
   * クリックしただけで新しい終日イベントが作成されてしまう。
   */
  function handleEventClick(
    occurrence: EventOccurrence,
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
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
    if (!occurrence.isRecurring) {
      paramsRef.current.calendar.api.deleteEvent(occurrence.eventId);
      paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope: null });
      return;
    }
    const scope = await resolveScopeForRecurring(occurrence, 'delete');
    if (scope === null) {
      return;
    }
    paramsRef.current.calendar.api.deleteEvent(occurrence.eventId, {
      occurrenceStart: occurrence.originalStart,
      scope,
    });
    paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope });
  }

  /** 現在のビューモデルの列並びを返す（リソースビューでなければ空配列）。 */
  function currentColumns(): readonly ResourceColumn[] {
    const { viewModel } = paramsRef.current.calendar;
    return viewModel.type === 'resource' ? viewModel.columns : [];
  }

  /** 隣のリソース列（`direction` = -1 で左、1 で右）のリソース ID を返す。なければ `undefined`。 */
  function adjacentResourceId(
    resourceId: string | null,
    direction: -1 | 1,
  ): string | null | undefined {
    const columns = currentColumns();
    const index = columns.findIndex((column) => (column.resource?.id ?? null) === resourceId);
    if (index === -1) {
      return undefined;
    }
    const next = columns[index + direction];
    return next === undefined ? undefined : (next.resource?.id ?? null);
  }

  /** キーボード操作による変更を確定する（単発は同期完結）。 */
  async function commitKeyboardChange(
    occurrence: EventOccurrence,
    action: 'move' | 'resize',
    range: DateRange | null,
    resourceId: string | null,
    allDay: boolean,
  ): Promise<void> {
    let recurringScope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const resolved = await resolveScopeForRecurring(occurrence, action);
      if (resolved === null) {
        return;
      }
      recurringScope = resolved;
    }
    applyChange(occurrence, recurringScope, range, resourceId, allDay);
  }

  /**
   * キーボード操作。
   * - `Enter` / `Space` — クリック相当、`Delete` / `Backspace` — 削除
   * - `↑` / `↓` — ∓/± `snapMinutes` 分移動、`Shift` 併用で終了時刻をリサイズ
   *   （終日アイテムでは時間操作なし）
   * - `←` / `→` — 隣のリソース列へ移動（原則 7: キーは画面上の視覚軸に従う）
   */
  function handleEventKeyDown(
    occurrence: EventOccurrence,
    allDay: boolean,
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

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (occurrence.event.editable === false) {
        return;
      }
      const target = adjacentResourceId(
        occurrenceLaneId(occurrence),
        event.key === 'ArrowLeft' ? -1 : 1,
      );
      if (target === undefined || target === occurrenceLaneId(occurrence)) {
        return;
      }
      void commitKeyboardChange(occurrence, 'move', null, target, allDay).catch(reportError);
      return;
    }

    if (allDay) {
      // 終日アイテムに時間の矢印操作はない
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    if (occurrence.event.editable === false) {
      return;
    }
    const { state } = paramsRef.current.calendar;
    const snap = state.options.snapMinutes;
    const timeZone = state.timeZone;
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    let range: DateRange;
    if (event.shiftKey) {
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
    void commitKeyboardChange(
      occurrence,
      event.shiftKey ? 'resize' : 'move',
      range,
      occurrenceLaneId(occurrence),
      false,
    ).catch(reportError);
  }

  /** 終日セルのクリックで当日 1 日の終日イベントを作成する。 */
  function handleAllDayCellClick(column: ResourceColumn): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const { state } = paramsRef.current.calendar;
    const day = displayDay();
    const range: DateRange = {
      start: day,
      end: startOfDayInZone(addDaysInZone(day, 1, state.timeZone), state.timeZone),
    };
    commitCreateRange(range, true, column.resource?.id ?? null);
  }

  function getColumnProps(column: ResourceColumn): ResourceColumnProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(column.key);
        } else {
          registryRef.current.set(column.key, {
            element,
            resourceId: column.resource?.id ?? null,
          });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleColumnPointerDown(column, event);
      },
      'data-koyomi-resource': column.key,
    };
  }

  function getAllDayCellProps(column: ResourceColumn): ResourceAllDayCellProps {
    return {
      onClick: () => {
        handleAllDayCellClick(column);
      },
      'data-koyomi-resource': column.key,
    };
  }

  function eventPropsFor(
    occurrence: EventOccurrence,
    mode: 'move' | 'allday-move',
    allDay: boolean,
  ): ResourceEventProps {
    const base: ResourceEventProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleEventPointerDown(occurrence, mode, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        handleEventClick(occurrence, event);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleEventKeyDown(occurrence, allDay, event);
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
    };
    if (dragSessionRef.current?.occurrence?.key === occurrence.key) {
      return { ...base, 'data-koyomi-dragging': 'true' };
    }
    return base;
  }

  function getEventProps(item: PositionedOccurrence): ResourceEventProps {
    return eventPropsFor(item.occurrence, 'move', false);
  }

  function getAllDayItemProps(occurrence: EventOccurrence): ResourceEventProps {
    return eventPropsFor(occurrence, 'allday-move', true);
  }

  function getResizeHandleProps(
    item: PositionedOccurrence,
    edge: 'start' | 'end' = 'end',
  ): ResourceResizeHandleProps {
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

  function previewFor(column: ResourceColumn): ResourcePreviewSegment | null {
    const { state } = paramsRef.current.calendar;
    const preview = state.dragPreview;
    if (preview === null || preview.allDay) {
      return null;
    }
    if ((preview.resourceId ?? null) !== (column.resource?.id ?? null)) {
      return null;
    }
    const timeZone: TimeZoneId = state.timeZone;
    const dayStart = displayDay();
    const dayEnd = startOfDayInZone(addDaysInZone(dayStart, 1, timeZone), timeZone);
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

  function isAllDayPreviewTarget(column: ResourceColumn): boolean {
    const preview = paramsRef.current.calendar.state.dragPreview;
    if (preview === null || !preview.allDay) {
      return false;
    }
    return (preview.resourceId ?? null) === (column.resource?.id ?? null);
  }

  return {
    getColumnProps,
    getAllDayCellProps,
    getEventProps,
    getAllDayItemProps,
    getResizeHandleProps,
    previewFor,
    isAllDayPreviewTarget,
    isDragging,
  };
}
