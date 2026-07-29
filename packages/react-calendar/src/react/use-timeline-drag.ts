/**
 * @packageDocumentation
 * タイムラインビュー（横 = 時間 × 行 = リソース）のドラッグインタラクション。
 *
 * - 空き領域のクリック / 横ドラッグ → 範囲選択（新規作成。行は開始行に固定）
 * - 帯のドラッグ → 移動（横 = 時間、縦 = 行の同時変更）。
 *   終日の帯、または {@link CalendarOptions.timelineScale} が `'hour'` 以外
 *   （日単位スナップ、`daySnap`）のときは日単位スナップになる
 * - 左右端ハンドルのドラッグ → リサイズ（時間のみ。行不変。`daySnap` のときは日単位）
 * - キーボード — `←`/`→` = `snapMinutes` 分移動（`daySnap` は ∓/± 1 日）、
 *   `Shift+←`/`→` = リサイズ（終日の帯は非対応）、`↑`/`↓` = 隣の行へ移動
 *   （画面上の視覚軸に対応する操作）
 * - フォーカス中の帯の A キー → 終日 ⇔ 時間指定の変換（`action: 'convert'` の
 *   キーボード経路。レーンは不変。時間指定 → 開始日 1 日分の終日、終日 → 開始日の
 *   0:00 から `defaultEventMinutes` 分（`timelineScale` が `'hour'` 以外のときは
 *   1 日分）の時間指定）
 * - 行のキーボード（Enter・Space） → 表示範囲の先頭に行のリソース付きで即時作成
 *   （`timelineScale` が `'hour'` のときは `defaultEventMinutes` 分、それ以外は 1 日分）。
 *   既定即時作成が確定した場合は新規予定の帯へフォーカスを移し、そのまま矢印キーで
 *   調整できる
 * - ドラッグ中は Escape / pointercancel でキャンセルし、画面端で横に自動スクロールする
 *
 * 横位置 → 日時の変換は行要素の矩形と {@link timeAtTimelineOffset}（表示分の座標系）で
 * 行う。行要素は `getRowProps` が返す `ref` コールバックで内部レジストリに登録される。
 * 確定時は時間の変更とリソース割当の変更を 1 つのパッチに合成して 1 回の
 * `updateEvent` にする（{@link ./use-resource-grid-drag} と同じ規則）。
 * 複数リソース割当（`resourceIds`）のオカレンスは割当先の各行に表示され、
 * 行間の移動では**操作した行の割当だけ**が移動先に変わる
 * （{@link resourceLanePatch}。他の行の割当は保持される）。
 * allDay ⇔ 時間指定の変換は A キー（キーボード）でのみ提供する。タイムラインは
 * 終日の帯を時間指定の帯と同一のレーン空間（行）に積んで表示するため、ポインタの
 * 移動先として区別できる終日領域が存在せず、空間ドラッグでの変換は定義できない
 * （週/日ビュー・リソースビューの変換ドラッグに相当する操作は提供しない）。
 *
 * `daySnap`（`occurrence?.allDay === true || options.timelineScale !== 'hour'`）は
 * セッション開始時に固定される。`updateOptions` で `timelineScale` を変更しても、
 * 進行中のドラッグセッションには反映されない（次回セッションから新しい設定が使われる）。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  isDragCandidateValid,
  occurrenceBlocksOverlap,
  resolveConstraintRules,
} from '../core/constraints';
import { occurrenceKey } from '../core/expansion';
import {
  type DayDragMode,
  dayDragPreviewRange,
  dragPreviewRange,
  timeAtTimelineOffset,
} from '../core/interaction';
import { resourceLanePatch } from '../core/resource-assignment';
import {
  addDaysInZone,
  addMinutesInZone,
  dateKeyInZone,
  minutesOfDayInZone,
  startOfDayInZone,
} from '../core/timezone';
import type {
  BusinessHoursRule,
  CalendarEventPatch,
  DateRange,
  EventOccurrence,
  RecurringEditScope,
  ResolvedCalendarOptions,
  TimelineItem,
  TimelineRow,
} from '../core/types';
import {
  attachDragSessionListeners,
  autoScrollVelocity,
  captureOccurrenceDeleteFocusContext,
  checkBeforeEventChange,
  checkBeforeEventDelete,
  checkBeforeSelectRange,
  collectOverlapBlockersInRange,
  createAutoScrollLoop,
  createCreatedEventFocusController,
  createDefaultEvent,
  createOccurrenceDeleteFocusController,
  createOverlapBlockerCache,
  type EventNotificationProps,
  eventNotificationProps,
  laneIdFromEventTarget,
  laneResourceIdOf,
  type OccurrenceDeleteFocusContext,
  originatesFromOccurrenceElement,
  reportOperationRejected,
  resolveScopeForRecurring,
} from './drag-common';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;

/**
 * このフックが担当するビュー（タイムラインビュー）のルート要素のセレクタ。
 * `captureOccurrenceDeleteFocusContext` の `viewRootSelector` に渡す。仮想化版
 * （`virtual-timeline-view.tsx`）も同じルート属性値を使う。
 */
const TIMELINE_DRAG_VIEW_ROOT_SELECTOR = '[data-koyomi="timeline"]';

/** タイムライン行要素に付与する props。 */
export interface TimelineRowProps {
  /** 行要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * キーボード操作（Enter・Space = 表示範囲の先頭に行のリソース付きで作成。
   * `timelineScale` が `'hour'` のときは `defaultEventMinutes` 分、それ以外
   * （日単位スナップ）は 1 日分）。
   */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** 行キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-resource': string;
}

/** 帯（タイムラインアイテム）要素に付与する props。 */
export interface TimelineItemProps extends EventNotificationProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * キーボード操作（Enter = クリック相当、Delete = 削除、
   * A = 終日 ⇔ 時間指定の変換、矢印キー = 移動・リサイズ・行移動）。
   */
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
  /**
   * このプレビューが宣言的制約（`eventOverlap` / `eventConstraint`）に違反しているか。
   * 省略時（`undefined`）は違反していない（`false`）と同義。
   */
  invalid?: boolean;
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
  /** 操作の種類。 */
  mode: 'create' | 'move' | 'resize' | 'resize-start';
  /** 対象のオカレンス（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。`daySnap` では未使用。 */
  anchor: Date;
  /** ドラッグ開始時のポインタ位置が属する日の 0:00（`daySnap` の日数差計算の基準）。 */
  anchorDay: Date;
  /**
   * 日単位スナップを適用するか（セッション開始時に固定）。
   * `occurrence?.allDay === true || options.timelineScale !== 'hour'` で決まる。
   */
  daySnap: boolean;
  /** 対象レーンのリソース ID（`move` はポインタ行に追従）。 */
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
 * 終日 ⇔ 時間指定変換のキーボードトグル（A キー）かどうかを判定する。
 *
 * 大文字（Shift や CapsLock による `'A'`）も対象にする。Ctrl / Cmd / Alt を伴う場合は
 * ブラウザ・OS のショートカット（Ctrl+A の全選択等）を奪わないため対象外にする
 * （Shift は大文字の `'A'` を入力する手段そのものなので除外しない）。
 * `use-time-grid-drag.ts` / `use-day-drag.ts` / `use-resource-grid-drag.ts` の同名関数と
 * 対の実装（判定を変える場合はすべてを同期させること。共有ヘルパー化しないのは、
 * 判定 1 つのために内部モジュール間の依存を増やさないため）。
 */
function isConversionToggleKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    (event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

/**
 * 動かしている側の overlap 実効値（重なりを拒否するか）を求める。
 * 新規作成（`occurrence` が `null`）では動かしている側の個別設定が存在しないため、
 * グローバル `eventOverlap` をそのまま動かしている側の値として使う。
 */
function resolveMoverBlocksOverlap(
  occurrence: EventOccurrence | null,
  eventOverlap: boolean,
): boolean {
  return occurrence === null
    ? eventOverlap === false
    : occurrenceBlocksOverlap(occurrence.event, eventOverlap);
}

/**
 * 対象（新規作成は `null`）に適用される配置制約の実効ルールを解決する。
 * イベント個別の `constraint` が優先され、未指定ならグローバル `eventConstraint` を使う。
 */
function resolveConstraintRulesForOccurrence(
  occurrence: EventOccurrence | null,
  eventConstraint: ResolvedCalendarOptions['eventConstraint'],
  businessHours: readonly BusinessHoursRule[],
): readonly BusinessHoursRule[] | null {
  return resolveConstraintRules(occurrence?.event.constraint ?? eventConstraint, businessHours);
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
 * @param params.defaultEventTitle - 既定即時作成（空きレーンのドラッグ）で使うイベントタイトル。
 *   省略時は {@link createDefaultEvent} の既定値
 * @example
 * ```tsx
 * const drag = useTimelineDrag({ calendar, callbacks });
 * return <div {...drag.getRowProps(row)} />;
 * ```
 */
export function useTimelineDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
  defaultEventTitle?: string;
}): TimelineDragHandlers {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 行キー → 行要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, RowEntry>());
  /** {@link collectOverlapBlockersInRange} の展開結果キャッシュ（本フック内で使い回す）。 */
  const overlapCacheRef = useRef(createOverlapBlockerCache());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const dragSessionRef = useRef<DragSession | null>(null);
  /** 直後の click イベントを 1 回だけ抑制するフラグ。 */
  const suppressNextClickRef = useRef(false);
  /** キーボード削除後のフォーカス復帰を管理するコントローラ（本フック内で使い回す）。 */
  const deleteFocusControllerRef = useRef(createOccurrenceDeleteFocusController());
  /** キーボード作成による既定即時作成後のフォーカス移動を管理するコントローラ。 */
  const createdEventFocusControllerRef = useRef(createCreatedEventFocusController());
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      dragSessionRef.current?.cleanup();
      dragSessionRef.current = null;
    };
  }, []);

  // キーボード削除・キーボード作成の確定後、DOM 更新完了後（再レンダー後）に一度だけ
  // フォーカス解決を試みる（`virtual-resource-view.tsx` の pinned フォーカス復元と同じ
  // 「無条件・毎レンダーの useLayoutEffect」パターン）。
  useLayoutEffect(() => {
    deleteFocusControllerRef.current.consume();
    createdEventFocusControllerRef.current.consume();
  });

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

  /** オカレンスの代表レーンのリソース ID（{@link laneResourceIdOf}）。 */
  function occurrenceLaneId(occurrence: EventOccurrence): string | null {
    return laneResourceIdOf(occurrence, paramsRef.current.calendar.state.resources);
  }

  /**
   * 操作元レーン（行）のリソース ID を解決する。操作した DOM 要素の属する行
   * （{@link laneIdFromEventTarget}）を正とし、解決できない場合のみ代表レーン
   * （{@link occurrenceLaneId}）へフォールバックする。複数リソース割当のオカレンスは
   * 複数の行に同時に表示されるため、「操作した行」はイベントデータからは特定できない。
   */
  function sourceLaneIdFor(occurrence: EventOccurrence, target: EventTarget | null): string | null {
    const fromDom = laneIdFromEventTarget(target);
    return fromDom !== undefined ? fromDom : occurrenceLaneId(occurrence);
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
    if (session.daySnap) {
      const pointerDay = pointerDayAt(clientX, clientY);
      if (pointerDay === null) {
        return null;
      }
      // DragSession.mode（'resize' = 終了端）を DayDragMode（'resize-end'）へマップする
      const dayMode: DayDragMode = session.mode === 'resize' ? 'resize-end' : session.mode;
      return dayDragPreviewRange(
        { mode: dayMode, occurrence: session.occurrence },
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
    return dragPreviewRange(
      { mode: session.mode, occurrence: session.occurrence, anchor: session.anchor },
      pointer,
      { timeZone: state.timeZone, snap: state.options.snapMinutes },
    );
  }

  /**
   * クリック（移動なし）による新規作成範囲を返す。
   * `daySnap` のときは掴んだ日 1 日分（`anchorDay` 〜 +1 日）、それ以外は
   * `defaultEventMinutes` 分の長さ。
   */
  function clickRangeForCreate(session: DragSession): DateRange {
    const { state } = paramsRef.current.calendar;
    if (session.daySnap) {
      return { start: session.anchorDay, end: addDaysInZone(session.anchorDay, 1, state.timeZone) };
    }
    return {
      start: session.anchor,
      end: addMinutesInZone(session.anchor, state.options.defaultEventMinutes, state.timeZone),
    };
  }

  /**
   * 候補範囲が宣言的制約に違反していないかを判定する（新規作成は `occurrence: null`）。
   * `laneId` は判定対象のレーン（移動先の行のリソース ID。未割り当ては `null`）。
   */
  function isCandidateValid(
    occurrence: EventOccurrence | null,
    range: DateRange,
    allDay: boolean,
    laneId: string | null,
  ): boolean {
    const { state, api } = paramsRef.current.calendar;
    return isDragCandidateValid({
      range,
      allDay,
      excludeKey: occurrence?.key ?? null,
      moverBlocksOverlap: resolveMoverBlocksOverlap(occurrence, state.options.eventOverlap),
      blockers: collectOverlapBlockersInRange(
        api,
        overlapCacheRef.current,
        range,
        state.options.eventOverlap,
        { resources: state.resources, laneId },
      ),
      constraintRules: resolveConstraintRulesForOccurrence(
        occurrence,
        state.options.eventConstraint,
        state.options.businessHours,
      ),
      timeZone: state.timeZone,
    });
  }

  /**
   * 作成を確定する（`onBeforeSelectRange` で拒否されなければ、`onSelectRange` が
   * あればそれを呼び、なければ既定作成する）。
   *
   * @param focus - 既定即時作成の確定後に新規予定へフォーカスを移す場合のビュールート。
   *   キーボード作成のみ指定する（ポインタ経路は `null`）。`onSelectRange` 指定時
   *   （アプリ委譲）はフォーカスを移さない
   */
  async function commitCreateRange(
    range: DateRange,
    resourceId: string | null,
    focus: { viewRoot: Element } | null,
  ): Promise<void> {
    try {
      if (!isCandidateValid(null, range, false, resourceId)) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action: 'create',
          reason: 'constraint',
        });
        return;
      }
      const gate = checkBeforeSelectRange(paramsRef.current.callbacks, {
        range,
        allDay: false,
        resourceId,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action: 'create',
          reason: 'rejected',
        });
        return;
      }
      const { calendar, callbacks, defaultEventTitle } = paramsRef.current;
      if (callbacks?.onSelectRange) {
        callbacks.onSelectRange({ range, allDay: false, resourceId });
        return;
      }
      const created = createDefaultEvent(
        calendar.api,
        { range, allDay: false, resourceId },
        defaultEventTitle,
        callbacks,
      );
      if (focus !== null) {
        createdEventFocusControllerRef.current.arm({
          viewRoot: focus.viewRoot,
          occurrenceKey: occurrenceKey(created.id, range.start),
        });
      }
    } catch (error) {
      reportError(error);
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /**
   * オカレンスの変更（時間・リソースの合成パッチ）を適用し、`onEventChange` を通知する
   * （スコープ解決済みの前提。{@link ./use-resource-grid-drag} と同じ規則）。
   *
   * @param sourceLaneId - 操作を開始した行のリソース ID。複数リソース割当では
   *   この行の割当だけが `resourceId`（移動先）へ変わる（{@link resourceLanePatch}）
   */
  function applyChange(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange | null,
    resourceId: string | null,
    allDay: boolean,
    sourceLaneId: string | null,
  ): void {
    const patch: CalendarEventPatch = {
      ...resourceLanePatch(occurrence.event, sourceLaneId, resourceId),
    };
    if (range !== null) {
      patch.start = range.start;
      patch.end = range.end;
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

  /**
   * 終日 ⇔ 時間指定の変換（`allDay` の変更を含む合成パッチ）を適用し、`onEventChange` を
   * 通知する（スコープ解決済みの前提）。時間・リソースの変更のみを扱う {@link applyChange}
   * と異なり、パッチに `allDay` を常に含めて変換を確定させる
   * （{@link ./use-resource-grid-drag} と同じ規則）。
   *
   * @param allDay - 変換後の `allDay`（`true` = 終日化、`false` = 時間指定化）
   * @param sourceLaneId - 操作を開始した行のリソース ID（{@link resourceLanePatch}）
   */
  function applyConversion(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange,
    resourceId: string | null,
    allDay: boolean,
    sourceLaneId: string | null,
  ): void {
    const patch: CalendarEventPatch = {
      ...resourceLanePatch(occurrence.event, sourceLaneId, resourceId),
      start: range.start,
      end: range.end,
      allDay,
    };
    const changes = paramsRef.current.calendar.api.updateEvent(
      occurrence.eventId,
      patch,
      recurringScope === null
        ? undefined
        : { occurrenceStart: occurrence.originalStart, scope: recurringScope },
    );
    paramsRef.current.callbacks?.onEventChange?.({
      occurrence,
      newRange: range,
      allDay,
      scope: recurringScope,
      resourceId,
      changes,
    });
  }

  /**
   * 終日 ⇔ 時間指定の変換を確定する（制約判定 → 適用前フック（`action: 'convert'`） →
   * 繰り返しスコープ解決 → 適用の順）。A キー（{@link handleItemKeyDown}）の
   * キーボード経路から使う（タイムラインは空間ドラッグでの変換を提供しない。
   * モジュール冒頭のドキュメント参照）。
   *
   * @param range - 変換後の日時範囲（終日化では日 0:00 起点・`end` 排他）
   * @param allDay - 変換後の `allDay`
   * @param resourceId - 変換後の割当先行のリソース ID（キーボード経路ではレーン不変）
   * @param sourceLaneId - 操作を開始した行のリソース ID
   */
  async function commitConversion(
    occurrence: EventOccurrence,
    range: DateRange,
    allDay: boolean,
    resourceId: string | null,
    sourceLaneId: string | null,
  ): Promise<void> {
    if (!isCandidateValid(occurrence, range, allDay, resourceId)) {
      reportOperationRejected(paramsRef.current.callbacks, {
        action: 'convert',
        reason: 'constraint',
        occurrence,
      });
      return;
    }
    const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
      occurrence,
      range,
      allDay,
      resourceId,
      action: 'convert',
    });
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      reportOperationRejected(paramsRef.current.callbacks, {
        action: 'convert',
        reason: 'rejected',
        occurrence,
      });
      return;
    }
    let scope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const resolved = await resolveScopeForRecurring(
        paramsRef.current.callbacks,
        occurrence,
        'move',
      );
      if (resolved === null) {
        return;
      }
      scope = resolved;
    }
    applyConversion(occurrence, scope, range, resourceId, allDay, sourceLaneId);
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
      const validationRange = timeChanged
        ? range
        : { start: occurrence.start, end: occurrence.end };
      const action: 'move' | 'resize' = session.mode === 'move' ? 'move' : 'resize';
      if (
        !isCandidateValid(occurrence, validationRange, occurrence.allDay, session.targetResourceId)
      ) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action,
          reason: 'constraint',
          occurrence,
        });
        return;
      }
      const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
        occurrence,
        range: validationRange,
        allDay: occurrence.allDay,
        resourceId: session.targetResourceId,
        action,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action,
          reason: 'rejected',
          occurrence,
        });
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
        session.initialResourceId,
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
          : clickRangeForCreate(session);
      } catch (error) {
        reportError(error);
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      if (range === null) {
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      void commitCreateRange(range, session.targetResourceId, null).catch(reportError);
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
    // 終日イベント、または timelineScale が 'hour' 以外のときは日単位スナップを適用する
    // （セッション開始時に固定。updateOptions による事後の timelineScale 変更は
    // 進行中のセッションには反映されない）
    const daySnap = occurrence?.allDay === true || state.options.timelineScale !== 'hour';
    const baselineRange =
      occurrence === null
        ? daySnap
          ? dayDragPreviewRange(
              { mode: 'create', occurrence: null },
              anchorDay,
              anchorDay,
              state.timeZone,
            )
          : dragPreviewRange({ mode: 'create', occurrence: null, anchor }, anchor, {
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
      daySnap,
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
      if (session.mode === 'move') {
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
      const previewAllDay = session.occurrence?.allDay ?? false;
      const invalid = !isCandidateValid(
        session.occurrence,
        range,
        previewAllDay,
        session.targetResourceId,
      );
      paramsRef.current.calendar.api.setDragPreview({
        kind: session.mode === 'move' ? 'move' : session.mode === 'create' ? 'create' : 'resize',
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: previewAllDay,
        resourceId: session.targetResourceId,
        ...(invalid ? { invalid: true } : {}),
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

  /**
   * キーボード作成（Enter / Space）の作成範囲を返す。開始は表示範囲の先頭
   * （先頭表示日の 0:00）で、長さは `timelineScale` が `'hour'` のときは
   * `defaultEventMinutes` 分、それ以外（日単位スナップ）は 1 日分
   * （クリック作成の `clickRangeForCreate` と同じ長さ規則）。
   * 表示日が空（タイムラインビューでない）場合は `null` を返す。
   */
  function keyboardCreateRange(): DateRange | null {
    const { state } = paramsRef.current.calendar;
    const first = displayDays()[0];
    if (first === undefined) {
      return null;
    }
    if (state.options.timelineScale !== 'hour') {
      return { start: first, end: addDaysInZone(first, 1, state.timeZone) };
    }
    return {
      start: first,
      end: addMinutesInZone(first, state.options.defaultEventMinutes, state.timeZone),
    };
  }

  /**
   * 行のキーボード操作（Enter・Space = 即時作成）。作成範囲は
   * {@link keyboardCreateRange}、リソースは行のレーン（未割り当て行は `null`）で、
   * 確定はポインタ経路と同じ {@link commitCreateRange}（制約判定 →
   * `onBeforeSelectRange` → `onSelectRange` 委譲 / 既定即時作成）。
   * 既定即時作成の確定後は新規予定の帯へフォーカスを移す。
   */
  function handleRowKeyDown(row: TimelineRow, event: ReactKeyboardEvent<HTMLElement>): void {
    // 行の子として描画される帯ボタン由来のキー操作（Enter/Space 等）を
    // 行の作成として二重処理しない（リソースビューの列と同じ規則）
    if (originatesFromOccurrenceElement(event.target)) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    const range = keyboardCreateRange();
    if (range === null) {
      return;
    }
    const viewRoot = event.currentTarget.closest(TIMELINE_DRAG_VIEW_ROOT_SELECTOR);
    void commitCreateRange(
      range,
      row.resource?.id ?? null,
      viewRoot === null ? null : { viewRoot },
    ).catch(reportError);
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
      'move',
      occurrence,
      anchor,
      anchorDay,
      sourceLaneIdFor(occurrence, event.currentTarget),
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
    // anchorDay は掴んだハンドルの位置（ポインタの日）を基準にする。
    // occurrence.start の日に固定すると、終了ハンドル（end）が別日にある
    // 複数日アイテムで daySnap の日数差計算が開始時点からずれてしまう
    const anchorDay =
      pointerDayAt(event.clientX, event.clientY) ?? startOfDayInZone(fallback, state.timeZone);
    startSession(
      edge === 'start' ? 'resize-start' : 'resize',
      occurrence,
      anchor,
      anchorDay,
      sourceLaneIdFor(occurrence, event.currentTarget),
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

  /**
   * 削除（Delete / Backspace）。`editable: false` は削除しない。削除が実際に適用された
   * 場合のみ削除後のフォーカス復帰（`focusContext`。呼び出し元が Delete/Backspace の
   * キーダウン時点で {@link captureOccurrenceDeleteFocusContext} を使って作る）を予約する。
   */
  async function deleteOccurrence(
    occurrence: EventOccurrence,
    focusContext: OccurrenceDeleteFocusContext | null,
  ): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    const gate = checkBeforeEventDelete(paramsRef.current.callbacks, occurrence);
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      reportOperationRejected(paramsRef.current.callbacks, {
        action: 'delete',
        reason: 'rejected',
        occurrence,
      });
      return;
    }
    if (!occurrence.isRecurring) {
      const changes = paramsRef.current.calendar.api.deleteEvent(occurrence.eventId);
      deleteFocusControllerRef.current.arm(focusContext);
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
    deleteFocusControllerRef.current.arm(focusContext);
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
    sourceLaneId: string | null,
  ): Promise<void> {
    if (
      !isCandidateValid(
        occurrence,
        range ?? { start: occurrence.start, end: occurrence.end },
        occurrence.allDay,
        resourceId,
      )
    ) {
      reportOperationRejected(paramsRef.current.callbacks, {
        action,
        reason: 'constraint',
        occurrence,
      });
      return;
    }
    const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
      occurrence,
      range: range ?? { start: occurrence.start, end: occurrence.end },
      allDay: occurrence.allDay,
      resourceId,
      action,
    });
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      reportOperationRejected(paramsRef.current.callbacks, {
        action,
        reason: 'rejected',
        occurrence,
      });
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
    applyChange(occurrence, recurringScope, range, resourceId, occurrence.allDay, sourceLaneId);
  }

  /**
   * キーボード操作。
   * - `Enter` / `Space` — クリック相当、`Delete` / `Backspace` — 削除
   * - `A`（大文字小文字とも。Ctrl / Cmd / Alt 併用は対象外） — 終日 ⇔ 時間指定の変換
   *   （{@link commitConversion}。レーンは不変。時間指定 → 開始日 1 日分の終日、
   *   終日 → 開始日の 0:00 から `defaultEventMinutes` 分（`timelineScale` が
   *   `'hour'` 以外のときは 1 日分）の時間指定）
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
      const focusContext = captureOccurrenceDeleteFocusContext({
        target: event.target,
        occurrenceKey: occurrence.key,
        viewRootSelector: TIMELINE_DRAG_VIEW_ROOT_SELECTOR,
      });
      void deleteOccurrence(occurrence, focusContext).catch(reportError);
      return;
    }
    if (isConversionToggleKey(event)) {
      event.preventDefault();
      if (occurrence.event.editable === false) {
        return;
      }
      const { state } = paramsRef.current.calendar;
      const timeZone = state.timeZone;
      // レーンは不変（source = target）のため割当パッチは生成されない
      const laneId = sourceLaneIdFor(occurrence, event.currentTarget);
      const dayStart = startOfDayInZone(occurrence.start, timeZone);
      if (occurrence.allDay) {
        // 終日 → 時間指定: 開始日の 0:00 から `defaultEventMinutes` 分。
        // `timelineScale` が 'hour' 以外（日単位スナップ）のときは 1 日分
        // （行のキーボード作成 `keyboardCreateRange` と同じ長さ規則）
        const end =
          state.options.timelineScale !== 'hour'
            ? addDaysInZone(dayStart, 1, timeZone)
            : addMinutesInZone(dayStart, state.options.defaultEventMinutes, timeZone);
        void commitConversion(occurrence, { start: dayStart, end }, false, laneId, laneId).catch(
          reportError,
        );
        return;
      }
      // 時間指定 → 終日: 開始日 1 日分（`use-time-grid-drag.ts` の A キーと同じ長さ規則）
      void commitConversion(
        occurrence,
        { start: dayStart, end: addDaysInZone(dayStart, 1, timeZone) },
        true,
        laneId,
        laneId,
      ).catch(reportError);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (occurrence.event.editable === false) {
        return;
      }
      // 基準行はフォーカス中の要素が属する行（複数リソース割当では表示中の
      // 複数の行のうち操作した行だけが移動対象になる）
      const sourceLaneId = sourceLaneIdFor(occurrence, event.currentTarget);
      const target = adjacentResourceId(sourceLaneId, event.key === 'ArrowUp' ? -1 : 1);
      if (target === undefined || target === sourceLaneId) {
        return;
      }
      void commitKeyboardChange(occurrence, 'move', null, target, sourceLaneId).catch(reportError);
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
    // 終日の帯、または timelineScale が 'hour' 以外のときは日単位で移動・リサイズする
    const daySnap = occurrence.allDay || state.options.timelineScale !== 'hour';
    let range: DateRange;
    let action: 'move' | 'resize' = 'move';
    if (daySnap) {
      if (event.shiftKey) {
        if (occurrence.allDay) {
          // 終日の帯のキーボードリサイズは提供しない（既存の制限を維持）
          return;
        }
        action = 'resize';
        const candidate = addDaysInZone(occurrence.end, direction, timeZone);
        const minEnd = addDaysInZone(occurrence.start, 1, timeZone);
        const end = candidate.getTime() < minEnd.getTime() ? occurrence.end : candidate;
        range = { start: occurrence.start, end };
      } else {
        range = {
          start: addDaysInZone(occurrence.start, direction, timeZone),
          end: addDaysInZone(occurrence.end, direction, timeZone),
        };
      }
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
    // 時間のみの操作。レーンは不変（source = target）のため割当パッチは生成されない
    const laneId = sourceLaneIdFor(occurrence, event.currentTarget);
    void commitKeyboardChange(occurrence, action, range, laneId, laneId).catch(reportError);
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
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleRowKeyDown(row, event);
      },
      tabIndex: 0,
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
      ...eventNotificationProps(paramsRef.current.callbacks, occurrence),
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
      ...(preview.invalid ? { invalid: true } : {}),
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
