/**
 * @packageDocumentation
 * リソースビュー（列 = リソース × 日、縦 = 時間）のドラッグインタラクション。
 *
 * - 空き領域のクリック / ドラッグ → 範囲選択（新規作成。リソースと日は開始列に固定）
 * - イベント本体のドラッグ → 移動（縦 = 時間、横 = リソース・日の同時変更）
 * - 上下端ハンドルのドラッグ → リサイズ（時間のみ。リソース・日は不変）
 * - 終日行 — セルのクリック → その列の日 1 日の終日イベント作成、
 *   終日アイテムのドラッグ → 列間移動（リソース変更と日数シフトの合成）
 * - イベント本体の移動ドラッグ中にポインタが終日行（`resource-allday-cell` 等）に
 *   乗ると、終日イベントへの変換プレビューに切り替わる（週/日ビューの
 *   {@link ./use-time-grid-drag} と同じ「時間指定 → 終日」変換。変換先はドロップした
 *   列の日から暦日数分・その列のリソース割当）
 * - 終日アイテムのドラッグ中にポインタが列本体（`resource-column`）に乗ると、
 *   時間指定イベントへの変換プレビューに切り替わる（{@link ./use-day-drag} と同じ
 *   「終日 → 時間指定」変換。変換先はドロップ位置の時刻から `defaultEventMinutes` 分・
 *   ドロップした列のリソース割当）
 * - キーボード — `↑`/`↓` = `snapMinutes` 分移動、`Shift+↑`/`↓` = リサイズ、
 *   `←`/`→` = 隣の列へ移動（画面上の視覚軸に対応する操作。複数日表示では
 *   同一リソース内の隣の日 → リソース境界では隣のリソースの端の日、の順に移る）
 * - フォーカス中の予定の A キー → 終日 ⇔ 時間指定の変換（変換ドラッグと同じ
 *   `action: 'convert'` のキーボード経路。レーンは不変。時間指定 → 開始日 1 日分の
 *   終日、終日 → 開始日の `slotMinTime` から `defaultEventMinutes` 分の時間指定）
 * - 列のキーボード（Enter・Space） → その列の日の表示時間帯の開始（`slotMinTime`）から
 *   `defaultEventMinutes` 分・列のリソース付きの即時作成。既定即時作成が確定した場合は
 *   新規予定の要素へフォーカスを移し、そのまま矢印キーで調整できる
 * - ドラッグ中は Escape / pointercancel でキャンセルし、画面端で縦に自動スクロールする
 *
 * 週/日ビューの {@link ./use-time-grid-drag} と同じプロップゲッターパターンだが、
 * 列レジストリは「1 リソース × 1 日 = 1 列」
 * （`Map<columnKey, { element, resourceId, dayStart }>`）で持つ。確定時は時間の変更と
 * リソース割当の変更を 1 つのパッチに合成して 1 回の `updateEvent` にする。
 * 複数リソース割当（`resourceIds`）のオカレンスは割当先の各列に表示され、
 * レーン間の移動では**操作した列の割当だけ**が移動先に変わる
 * （{@link resourceLanePatch}。他の列の割当は保持される）。
 * allDay ⇔ 時間指定の変換はポインタの変換ドラッグと A キーの 2 経路で提供し、
 * どちらも週/日ビューと同じ `action: 'convert'` の確定フロー
 * （制約判定 → `onBeforeEventChange` → スコープ解決）を通す。
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
import { dragPreviewRange, timeAtGridPosition } from '../core/interaction';
import { resourceLanePatch } from '../core/resource-assignment';
import {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  dateKeyInZone,
  minutesOfDayInZone,
  parseSlotBoundaryTime,
  startOfDayInZone,
} from '../core/timezone';
import type {
  BusinessHoursRule,
  CalendarEventPatch,
  DateRange,
  EventOccurrence,
  PositionedOccurrence,
  RecurringEditScope,
  ResolvedCalendarOptions,
  ResourceColumn,
  TimeZoneId,
} from '../core/types';
import { laneKeyForResource, UNASSIGNED_LANE_KEY } from '../core/views/lane-key';
import {
  allDayPatchRange,
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

/**
 * このフックが担当するビュー（リソースビュー）のルート要素のセレクタ。
 * `captureOccurrenceDeleteFocusContext` の `viewRootSelector` に渡す。仮想化版
 * （`virtual-resource-view.tsx`）も同じルート属性値を使う。
 */
const RESOURCE_GRID_DRAG_VIEW_ROOT_SELECTOR = '[data-koyomi="resource"]';

/** 1 日のミリ秒数。 */
const MS_PER_DAY = 86_400_000;

/**
 * 終日行の領域を示す `data-koyomi` 属性のセレクタ（セル・ラッパー・行いずれの要素でも
 * 一致する）。時間指定イベントの移動ドラッグがこの領域に乗ると終日変換になる。
 */
const RESOURCE_ALLDAY_REGION_SELECTOR =
  '[data-koyomi="resource-allday-cells"], [data-koyomi="resource-allday-cell"], [data-koyomi="allday-row"]';

/**
 * 列本体（時間領域）を示す `data-koyomi` 属性のセレクタ。
 * 終日アイテムの移動ドラッグがこの領域に乗ると時間指定変換になる。
 */
const RESOURCE_COLUMN_BODY_SELECTOR = '[data-koyomi="resource-column"]';

/**
 * ポインタ位置が `selector` に一致する領域の上にあるかを判定する。
 *
 * `document.elementFromPoint` が存在しない環境（jsdom では未実装のことがある）では
 * 安全に「領域外」（`false`）と判定する。テストでは `vi.spyOn(document, 'elementFromPoint')`
 * でモックする（`use-time-grid-drag.ts` の `isOverAlldayRegion` と同じ方針）。
 */
function isPointerOverRegion(selector: string, clientX: number, clientY: number): boolean {
  if (typeof document.elementFromPoint !== 'function') {
    return false;
  }
  const target = document.elementFromPoint(clientX, clientY);
  return target?.closest(selector) != null;
}

/**
 * 終日 ⇔ 時間指定変換のキーボードトグル（A キー）かどうかを判定する。
 *
 * 大文字（Shift や CapsLock による `'A'`）も対象にする。Ctrl / Cmd / Alt を伴う場合は
 * ブラウザ・OS のショートカット（Ctrl+A の全選択等）を奪わないため対象外にする
 * （Shift は大文字の `'A'` を入力する手段そのものなので除外しない）。
 * `use-time-grid-drag.ts` / `use-day-drag.ts` / `use-timeline-drag.ts` の同名関数と
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
 * 日時範囲が表示タイムゾーンで何暦日にまたがるかを求める（最低でも 1）。
 *
 * `end` は排他的なので、`end` の 1 ミリ秒前が属する日を最終日とする
 * （終日変換時、時間指定オカレンスの複数日にまたがる長さを終日の日数に換算するために使う）。
 * 日数差は日付キーを UTC 0:00 に載せて求めるため、DST 切り替えの影響を受けない。
 * `use-time-grid-drag.ts` の同名関数と対の実装（計算規則を変える場合は両方を同期させること）。
 */
function calendarDaySpan(range: DateRange, timeZone: TimeZoneId): number {
  const startKey = dateKeyInZone(range.start, timeZone);
  const lastInstant =
    range.end.getTime() > range.start.getTime() ? new Date(range.end.getTime() - 1) : range.start;
  const endKey = dateKeyInZone(lastInstant, timeZone);
  const startUtcMs = dateFromKey(startKey, 'UTC').getTime();
  const endUtcMs = dateFromKey(endKey, 'UTC').getTime();
  const diffDays = Math.round((endUtcMs - startUtcMs) / MS_PER_DAY);
  return Math.max(1, diffDays + 1);
}

/** リソース列要素に付与する props。 */
export interface ResourceColumnProps {
  /** 列要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * キーボード操作（Enter・Space = その列の日の表示時間帯の開始（`slotMinTime`）から
   * `defaultEventMinutes` 分・列のリソース付きの時間指定イベント作成）。
   */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /**
   * 列のレーンキー（`` `r:${id}` `` / `'unassigned'`。スタイルフック・ヒットテスト・
   * 外部ドラッグのリソース解決用。複数日表示では同じレーンの列が日ごとに並ぶため、
   * 列の一意な識別には {@link ResourceColumn.key} を使う）。
   */
  'data-koyomi-resource': string;
  /** 列の日の `'YYYY-MM-DD'` キー（スタイルフック・外部ドラッグの日解決用）。 */
  'data-koyomi-date': string;
}

/** 終日行のセル要素に付与する props。 */
export interface ResourceAllDayCellProps {
  /** クリックでその列の日 1 日の終日イベントを作成する。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter・Space = その列の日 1 日の終日イベントを作成）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** 列のレーンキー（{@link ResourceColumnProps} の同名 props と同じ規則）。 */
  'data-koyomi-resource': string;
  /** 列の日の `'YYYY-MM-DD'` キー（スタイルフック・外部ドラッグの日解決用）。 */
  'data-koyomi-date': string;
}

/** イベントブロック要素に付与する props。 */
export interface ResourceEventProps extends EventNotificationProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * キーボード操作（Enter = クリック相当、Delete = 削除、
   * A = 終日 ⇔ 時間指定の変換、矢印キー = 移動・リサイズ・列移動）。
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
  /**
   * このプレビューが宣言的制約（`eventOverlap` / `eventConstraint`）に違反しているか。
   * 省略時（`undefined`）は違反していない（`false`）と同義。
   */
  invalid?: boolean;
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
  /** 列の日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  dayStart: Date;
}

/** ドラッグセッション（開始から終了までの内部状態）。 */
interface DragSession {
  /**
   * 操作の種類。`allday-move` は終日アイテムの列間移動（リソース変更と日数シフト）、
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
  /**
   * 対象の日（列の日の開始時刻）。`create` / `resize` 系では開始列の日に固定、
   * `move` / `allday-move` ではポインタ位置の列に追従する。
   */
  targetDayStart: Date;
  /** ドラッグ開始時点の日（日数シフトの基準）。 */
  initialDayStart: Date;
  /** セッション開始時点を基準とするプレビュー範囲（移動判定の基準）。 */
  baselineRange: DateRange;
  /** 実質的な移動（時間・リソース・日のいずれかの変化）があったか。 */
  hasMoved: boolean;
  /**
   * 終日行への変換ドラッグ中の確定用範囲。
   *
   * `mode === 'move'` のセッションでポインタが終日行
   * （{@link RESOURCE_ALLDAY_REGION_SELECTOR}）の上にある間だけ非 `null` になる。
   * 非 `null` の間に pointerup すると、この範囲・`allDay: true`・
   * ポインタ位置の列のリソース割当で終日イベントへの変換として確定する
   * （`use-time-grid-drag.ts` の `allDayConversion` と対になる機能）。
   */
  allDayConversion: DateRange | null;
  /**
   * 列本体（時間領域）への変換ドラッグ中の確定用範囲。
   *
   * `mode === 'allday-move'` のセッションでポインタが列本体
   * （{@link RESOURCE_COLUMN_BODY_SELECTOR}）の上にある間だけ非 `null` になる。
   * 非 `null` の間に pointerup すると、この範囲・`allDay: false`・
   * ポインタ位置の列のリソース割当で時間指定イベントへの変換として確定する
   * （`use-day-drag.ts` の `timedConversion` と対になる機能）。
   */
  timedConversion: DateRange | null;
  /** document に登録したリスナーを解除し、オートスクロールを停止する。 */
  cleanup: () => void;
}

/**
 * 列のレーンキー（`` `r:${id}` `` / `'unassigned'`）を返す。
 * `column.key` は複数日表示で日付キー付きになるため、`data-koyomi-resource` には
 * 常にデコード可能なレーンキー（{@link resourceIdFromLaneKey} の逆変換対象）を使う。
 */
function laneKeyOf(column: ResourceColumn): string {
  return column.resource === null ? UNASSIGNED_LANE_KEY : laneKeyForResource(column.resource.id);
}

/** 列要素の矩形内でのポインタの縦位置（0〜1）を求める（高さ 0 以下は 0）。 */
function fractionYFromClientY(rect: DOMRect, clientY: number): number {
  if (rect.height <= 0) {
    return 0;
  }
  return (clientY - rect.top) / rect.height;
}

/**
 * `state.options.slotMinTime`/`slotMaxTime` を分換算した表示範囲を返す。
 * ポインタ操作（作成・移動・リサイズ）の対象時刻計算を表示時間帯内にクランプするために使う
 * （矢印キー操作は対象外。`use-time-grid-drag.ts` の同名ヘルパと同じ方針）。
 */
function slotTimeRangeMinutes(options: { slotMinTime: string; slotMaxTime: string }): {
  rangeStartMinutes: number;
  rangeEndMinutes: number;
} {
  return {
    rangeStartMinutes: parseSlotBoundaryTime(options.slotMinTime),
    rangeEndMinutes: parseSlotBoundaryTime(options.slotMaxTime),
  };
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
 * リソースビューのドラッグインタラクションを提供するフック。
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
 * const drag = useResourceGridDrag({ calendar, callbacks });
 * return <div {...drag.getColumnProps(column)} />;
 * ```
 */
export function useResourceGridDrag(params: {
  calendar: UseCalendarResult;
  defaultEventTitle?: string;
  callbacks?: CalendarInteractionCallbacks;
}): ResourceGridDragHandlers {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 列キー → 列要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, ColumnEntry>());
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

  /** 表示範囲の先頭日の 0:00 を返す（列が見つからない場合のフォールバック）。 */
  function displayDay(): Date {
    const { state, api } = paramsRef.current.calendar;
    return startOfDayInZone(api.getVisibleRange().start, state.timeZone);
  }

  /** 表示日の開始時刻一覧（昇順）。リソースビューでなければ先頭日のみの 1 件。 */
  function visibleDayStarts(): readonly Date[] {
    const { viewModel } = paramsRef.current.calendar;
    if (viewModel.type === 'resource') {
      return viewModel.days.map((day) => day.date);
    }
    return [displayDay()];
  }

  /**
   * 表示日一覧の中での `dayStart` のインデックスを返す（見つからなければ `0`）。
   * 表示日は連続する日の並びのため、インデックス差 = 日数差として扱える。
   */
  function dayIndexOf(dayStart: Date): number {
    const index = visibleDayStarts().findIndex((day) => day.getTime() === dayStart.getTime());
    return index === -1 ? 0 : index;
  }

  /**
   * `date` の属する表示日の開始時刻を返す。表示範囲より前なら先頭日、
   * 後なら最終日へクランプする（キーボード操作の基準列の決定に使う）。
   */
  function dayStartForDate(date: Date): Date {
    const days = visibleDayStarts();
    const time = date.getTime();
    for (let index = days.length - 1; index >= 0; index -= 1) {
      const day = days[index];
      if (day !== undefined && time >= day.getTime()) {
        return day;
      }
    }
    return days[0] ?? displayDay();
  }

  /** 範囲を日数分シフトする（0 日ならそのままの参照を返す）。 */
  function shiftRangeByDays(range: DateRange, dayDelta: number): DateRange {
    if (dayDelta === 0) {
      return range;
    }
    const timeZone = paramsRef.current.calendar.state.timeZone;
    return {
      start: addDaysInZone(range.start, dayDelta, timeZone),
      end: addDaysInZone(range.end, dayDelta, timeZone),
    };
  }

  /** オカレンスの代表レーンのリソース ID（{@link laneResourceIdOf}）。 */
  function occurrenceLaneId(occurrence: EventOccurrence): string | null {
    return laneResourceIdOf(occurrence, paramsRef.current.calendar.state.resources);
  }

  /**
   * 操作元レーンのリソース ID を解決する。操作した DOM 要素の属するレーン
   * （{@link laneIdFromEventTarget}）を正とし、解決できない場合のみ代表レーン
   * （{@link occurrenceLaneId}）へフォールバックする。複数リソース割当のオカレンスは
   * 複数の列に同時に表示されるため、「操作した列」はイベントデータからは特定できない。
   */
  function sourceLaneIdFor(occurrence: EventOccurrence, target: EventTarget | null): string | null {
    const fromDom = laneIdFromEventTarget(target);
    return fromDom !== undefined ? fromDom : occurrenceLaneId(occurrence);
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

  /**
   * ポインタ位置に対応する日時（スナップ済み）を返す。列が見つからなければ `null`。
   * @param fixedDay - 日を固定する場合、その日の開始時刻。省略時はポインタ位置の列の日を使う
   *   （縦位置の計算にはどの列も同じ形状のため、ポインタ位置の列の矩形を使う）
   */
  function pointerDateAt(clientX: number, clientY: number, fixedDay?: Date): Date | null {
    const column = findColumnForClientX(clientX);
    if (column === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return timeAtGridPosition({
      day: fixedDay ?? column.dayStart,
      fractionY: fractionYFromClientY(column.element.getBoundingClientRect(), clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
      ...slotTimeRangeMinutes(state.options),
    });
  }

  /**
   * 現在のセッションとポインタ位置からプレビュー範囲を計算する。列が見つからなければ `null`。
   * `create` / `resize` 系は日を開始列（`session.initialDayStart`）に固定し、
   * `move` はポインタ位置の列の日に追従する（日またぎ移動）。
   */
  function computeRangeFromEvent(
    session: DragSession,
    clientX: number,
    clientY: number,
  ): DateRange | null {
    const fixedDay =
      session.mode === 'move' || session.mode === 'allday-move'
        ? undefined
        : session.initialDayStart;
    const pointer = pointerDateAt(clientX, clientY, fixedDay);
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
   * 候補範囲が宣言的制約に違反していないかを判定する（新規作成は `occurrence: null`）。
   * `laneId` は判定対象のレーン（移動先の列のリソース ID。未割り当ては `null`）。
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
   * 作成（時間指定・終日共通）を確定する。`onBeforeSelectRange` で拒否されなければ、
   * `onSelectRange` があればそれを呼び、なければ選択レーンの `resourceId` を含めて
   * 既定作成する（未割り当てレーンでは `resourceId` を付けない）。
   *
   * @param focus - 既定即時作成の確定後に新規予定へフォーカスを移す場合のビュールート。
   *   キーボード作成のみ指定する（ポインタ・終日セル経路は `null`）。`onSelectRange`
   *   指定時（アプリ委譲）はフォーカスを移さない
   */
  async function commitCreateRange(
    range: DateRange,
    allDay: boolean,
    resourceId: string | null,
    focus: { viewRoot: Element } | null,
  ): Promise<void> {
    try {
      if (!isCandidateValid(null, range, allDay, resourceId)) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action: 'create',
          reason: 'constraint',
        });
        return;
      }
      const gate = checkBeforeSelectRange(paramsRef.current.callbacks, {
        range,
        allDay,
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
        callbacks.onSelectRange({ range, allDay, resourceId });
        return;
      }
      const created = createDefaultEvent(
        calendar.api,
        { range, allDay, resourceId },
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
   * （スコープ解決済みの前提）。{@link ./use-time-grid-drag} と同じく常に同期的に
   * 完結させる（ドラッグ確定直後のネイティブ click 抑制を間に合わせるため）。
   *
   * @param range - 変更後の日時範囲。`null` なら時間は変更しない（リソースのみの変更）
   * @param sourceLaneId - 操作を開始したレーンのリソース ID。複数リソース割当では
   *   このレーンの割当だけが `resourceId`（移動先）へ変わる（{@link resourceLanePatch}）
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
      // 終日の移動はタイムゾーンに依存しない日付キー文字列で書き込む
      // （表示 TZ の絶対時刻のままだと timeZone を持つイベントで日付がずれる）
      const patchRange = allDay
        ? allDayPatchRange(range, paramsRef.current.calendar.state.timeZone)
        : range;
      patch.start = patchRange.start;
      patch.end = patchRange.end;
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
   * と異なり、パッチに `allDay` を常に含めて変換を確定させる。
   *
   * @param allDay - 変換後の `allDay`（`true` = 終日化、`false` = 時間指定化）
   * @param sourceLaneId - 操作を開始したレーンのリソース ID（{@link resourceLanePatch}）
   */
  function applyConversion(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange,
    resourceId: string | null,
    allDay: boolean,
    sourceLaneId: string | null,
  ): void {
    // 終日として書き込む start / end はタイムゾーンに依存しない日付キー文字列にする
    // （applyChange と同じ理由。時間指定化（allDay: false）は絶対時刻のまま）
    const patch: CalendarEventPatch = {
      ...resourceLanePatch(occurrence.event, sourceLaneId, resourceId),
      ...(allDay
        ? allDayPatchRange(range, paramsRef.current.calendar.state.timeZone)
        : { start: range.start, end: range.end }),
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
   * 繰り返しスコープ解決 → 適用の順）。ポインタの変換ドラッグ
   * （{@link commitMoveOrResize}）と A キー（{@link handleEventKeyDown}）の
   * 両経路から共通で使う。
   *
   * @param range - 変換後の日時範囲（終日化では日 0:00 起点・`end` 排他）
   * @param allDay - 変換後の `allDay`
   * @param resourceId - 変換後の割当先レーンのリソース ID（キーボード経路ではレーン不変）
   * @param sourceLaneId - 操作を開始したレーンのリソース ID
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

  /**
   * 移動・リサイズ・列間移動ドラッグの確定処理。移動がなかった場合は何もしない
   * （クリックは onClick に任せる）。`finally` で必ずプレビューを消す。
   *
   * 変換ドラッグ中（`session.allDayConversion` / `session.timedConversion` が非 `null`）は
   * その範囲で終日 ⇔ 時間指定の変換として確定する（{@link commitConversion}）。変換中か
   * どうかは pointermove 時点の判定を維持する（pointerup 時点で再判定すると、領域境界
   * ぎりぎりで離した際にプレビューと異なる結果で確定してしまうため。
   * `use-time-grid-drag.ts` / `use-day-drag.ts` と同じ扱い）。
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

      if (session.allDayConversion !== null) {
        // 時間指定 → 終日の変換ドラッグの確定（ポインタ位置の列のリソース割当）
        await commitConversion(
          occurrence,
          session.allDayConversion,
          true,
          session.targetResourceId,
          session.initialResourceId,
        );
        return;
      }
      if (session.timedConversion !== null) {
        // 終日 → 時間指定の変換ドラッグの確定（ポインタ位置の列のリソース割当）
        await commitConversion(
          occurrence,
          session.timedConversion,
          false,
          session.targetResourceId,
          session.initialResourceId,
        );
        return;
      }

      if (session.mode === 'allday-move') {
        // 終日アイテムの列間移動: リソース変更と日数シフト（複数日表示）の合成。
        // 時間帯（現地時刻）は変えない
        const dayDelta = dayIndexOf(session.targetDayStart) - dayIndexOf(session.initialDayStart);
        if (session.targetResourceId === session.initialResourceId && dayDelta === 0) {
          return;
        }
        const shiftedRange = shiftRangeByDays(
          { start: occurrence.start, end: occurrence.end },
          dayDelta,
        );
        if (
          !isCandidateValid(occurrence, shiftedRange, occurrence.allDay, session.targetResourceId)
        ) {
          reportOperationRejected(paramsRef.current.callbacks, {
            action: 'move',
            reason: 'constraint',
            occurrence,
          });
          return;
        }
        const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
          occurrence,
          range: shiftedRange,
          allDay: occurrence.allDay,
          resourceId: session.targetResourceId,
          action: 'move',
        });
        const allowed = typeof gate === 'boolean' ? gate : await gate;
        if (!allowed) {
          reportOperationRejected(paramsRef.current.callbacks, {
            action: 'move',
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
        applyChange(
          occurrence,
          scope,
          dayDelta === 0 ? null : shiftedRange,
          session.targetResourceId,
          occurrence.allDay,
          session.initialResourceId,
        );
        return;
      }

      const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
      if (range === null) {
        return;
      }
      const action: 'move' | 'resize' = session.mode === 'move' ? 'move' : 'resize';
      if (!isCandidateValid(occurrence, range, false, session.targetResourceId)) {
        reportOperationRejected(paramsRef.current.callbacks, {
          action,
          reason: 'constraint',
          occurrence,
        });
        return;
      }
      const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
        occurrence,
        range,
        allDay: false,
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
        range,
        session.targetResourceId,
        false,
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
      void commitCreateRange(range, false, session.targetResourceId, null).catch(reportError);
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
    initialDayStart: Date,
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

    // 縦方向のオートスクロール（時間グリッドと同じ仕組み。コンテナは縦横の
    // スクロールを一括で担うルート [data-koyomi="resource"]）
    const autoScroll = createAutoScrollLoop('vertical');

    const updateAutoScroll = (clientX: number, clientY: number): void => {
      if (mode === 'allday-move') {
        // 終日行の列間移動は縦スクロールに追従する必要がない
        return;
      }
      const column = findColumnForClientX(clientX);
      const container = column?.element.closest('[data-koyomi="resource"]') ?? null;
      if (container === null) {
        autoScroll.stop();
        return;
      }
      const rect = container.getBoundingClientRect();
      autoScroll.update(
        container,
        autoScrollVelocity({ edgeStart: rect.top, edgeEnd: rect.bottom, pointer: clientY }),
      );
    };

    const session: DragSession = {
      mode,
      occurrence,
      anchor,
      targetResourceId: initialResourceId,
      initialResourceId,
      targetDayStart: initialDayStart,
      initialDayStart,
      baselineRange,
      hasMoved: false,
      allDayConversion: null,
      timedConversion: null,
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

      // 横方向（リソース・日）の追従。create は開始列に固定、resize 系は元の列のまま
      if (session.mode === 'move' || session.mode === 'allday-move') {
        const column = findColumnForClientX(clientX);
        if (column !== null) {
          if (column.resourceId !== session.targetResourceId) {
            session.targetResourceId = column.resourceId;
            if (column.resourceId !== session.initialResourceId) {
              session.hasMoved = true;
            }
          }
          if (column.dayStart.getTime() !== session.targetDayStart.getTime()) {
            session.targetDayStart = column.dayStart;
            if (column.dayStart.getTime() !== session.initialDayStart.getTime()) {
              session.hasMoved = true;
            }
          }
        }
      }

      // 'move' セッション中にポインタが終日行の上にあれば、終日イベントへの
      // 変換プレビューに切り替える（`use-time-grid-drag.ts` と同じ操作感）
      if (
        session.mode === 'move' &&
        session.occurrence !== null &&
        isPointerOverRegion(RESOURCE_ALLDAY_REGION_SELECTOR, clientX, clientY)
      ) {
        const column = findColumnForClientX(clientX);
        if (column !== null) {
          // 終日行の上ではグリッド本体のオートスクロールは不要
          autoScroll.stop();
          const { state } = paramsRef.current.calendar;
          const occurrenceForConversion = session.occurrence;
          const dayCount = calendarDaySpan(
            { start: occurrenceForConversion.start, end: occurrenceForConversion.end },
            state.timeZone,
          );
          const conversionRange: DateRange = {
            start: column.dayStart,
            end: addDaysInZone(column.dayStart, dayCount, state.timeZone),
          };
          session.hasMoved = true;
          session.allDayConversion = conversionRange;
          const invalid = !isCandidateValid(
            occurrenceForConversion,
            conversionRange,
            true,
            session.targetResourceId,
          );
          paramsRef.current.calendar.api.setDragPreview({
            kind: 'move',
            occurrenceKey: occurrenceForConversion.key,
            range: conversionRange,
            allDay: true,
            resourceId: session.targetResourceId,
            ...(invalid ? { invalid: true } : {}),
          });
          return;
        }
      }
      // 終日行の外に戻った（または最初から終日行上でない）場合は終日変換を解除する
      session.allDayConversion = null;

      if (session.mode === 'allday-move') {
        const occurrenceForPreview = session.occurrence;
        if (occurrenceForPreview === null) {
          return;
        }
        // ポインタが列本体（時間領域）の上にあれば、時間指定イベントへの
        // 変換プレビューに切り替える（`use-day-drag.ts` と同じ操作感）
        if (isPointerOverRegion(RESOURCE_COLUMN_BODY_SELECTOR, clientX, clientY)) {
          const pointer = pointerDateAt(clientX, clientY);
          if (pointer !== null) {
            const { state } = paramsRef.current.calendar;
            const conversionRange: DateRange = {
              start: pointer,
              end: addMinutesInZone(pointer, state.options.defaultEventMinutes, state.timeZone),
            };
            session.hasMoved = true;
            session.timedConversion = conversionRange;
            const invalid = !isCandidateValid(
              occurrenceForPreview,
              conversionRange,
              false,
              session.targetResourceId,
            );
            paramsRef.current.calendar.api.setDragPreview({
              kind: 'move',
              occurrenceKey: occurrenceForPreview.key,
              range: conversionRange,
              allDay: false,
              resourceId: session.targetResourceId,
              ...(invalid ? { invalid: true } : {}),
            });
            return;
          }
        }
        // 列本体の外に戻った（または最初から列本体上でない）場合は時間指定変換を解除する
        session.timedConversion = null;
        // 複数日表示では列の日の差分だけ範囲をシフトする（時間帯は不変）
        const dayDelta = dayIndexOf(session.targetDayStart) - dayIndexOf(session.initialDayStart);
        const conversionRange = shiftRangeByDays(
          { start: occurrenceForPreview.start, end: occurrenceForPreview.end },
          dayDelta,
        );
        const invalid = !isCandidateValid(
          occurrenceForPreview,
          conversionRange,
          true,
          session.targetResourceId,
        );
        paramsRef.current.calendar.api.setDragPreview({
          kind: 'move',
          occurrenceKey: occurrenceForPreview.key,
          range: conversionRange,
          allDay: true,
          resourceId: session.targetResourceId,
          ...(invalid ? { invalid: true } : {}),
        });
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
      const invalid = !isCandidateValid(session.occurrence, range, false, session.targetResourceId);
      paramsRef.current.calendar.api.setDragPreview({
        kind: session.mode === 'move' ? 'move' : session.mode === 'create' ? 'create' : 'resize',
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: false,
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

  /** 空き領域での作成ドラッグを開始する（リソースと日は開始列に固定）。 */
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
      day: column.date,
      fractionY: fractionYFromClientY(rect, event.clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
      ...slotTimeRangeMinutes(state.options),
    });
    startSession('create', null, anchor, column.resource?.id ?? null, column.date);
  }

  /**
   * ポインタ位置の列の日（列が見つからなければオカレンスの属する表示日）を返す。
   * ドラッグ開始時のセッションの基準日（`initialDayStart`）の決定に使う。
   */
  function initialDayStartFor(occurrence: EventOccurrence, clientX: number): Date {
    return findColumnForClientX(clientX)?.dayStart ?? dayStartForDate(occurrence.start);
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
    startSession(
      mode,
      occurrence,
      anchor,
      sourceLaneIdFor(occurrence, event.currentTarget),
      initialDayStartFor(occurrence, event.clientX),
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
    const anchor = pointerDateAt(event.clientX, event.clientY) ?? fallback;
    startSession(
      edge === 'start' ? 'resize-start' : 'resize',
      occurrence,
      anchor,
      sourceLaneIdFor(occurrence, event.currentTarget),
      initialDayStartFor(occurrence, event.clientX),
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

  /** 現在のビューモデルの列並びを返す（リソースビューでなければ空配列）。 */
  function currentColumns(): readonly ResourceColumn[] {
    const { viewModel } = paramsRef.current.calendar;
    return viewModel.type === 'resource' ? viewModel.columns : [];
  }

  /**
   * オカレンスが属する列（指定レーンと開始日が一致する列）のインデックスを返す。
   * 見つからなければ `-1`。
   *
   * @param laneId - 対象レーンのリソース ID（複数リソース割当ではフォーカス中の
   *   列のレーン。{@link sourceLaneIdFor} で解決した値）
   */
  function columnIndexFor(occurrence: EventOccurrence, laneId: string | null): number {
    const dayStart = dayStartForDate(occurrence.start);
    return currentColumns().findIndex(
      (column) =>
        (column.resource?.id ?? null) === laneId && column.date.getTime() === dayStart.getTime(),
    );
  }

  /** キーボード操作による変更を確定する（単発は同期完結）。 */
  async function commitKeyboardChange(
    occurrence: EventOccurrence,
    action: 'move' | 'resize',
    range: DateRange | null,
    resourceId: string | null,
    allDay: boolean,
    sourceLaneId: string | null,
  ): Promise<void> {
    if (
      !isCandidateValid(
        occurrence,
        range ?? { start: occurrence.start, end: occurrence.end },
        allDay,
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
      allDay,
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
    applyChange(occurrence, recurringScope, range, resourceId, allDay, sourceLaneId);
  }

  /**
   * キーボード操作。
   * - `Enter` / `Space` — クリック相当、`Delete` / `Backspace` — 削除
   * - `A`（大文字小文字とも。Ctrl / Cmd / Alt 併用は対象外） — 終日 ⇔ 時間指定の変換
   *   （{@link commitConversion}。レーンは不変。時間指定 → 開始日 1 日分の終日、
   *   終日 → 開始日の `slotMinTime` から `defaultEventMinutes` 分の時間指定。
   *   終日行に表示される複数日の時間指定のオカレンスでは何もしない）
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
      const focusContext = captureOccurrenceDeleteFocusContext({
        target: event.target,
        occurrenceKey: occurrence.key,
        viewRootSelector: RESOURCE_GRID_DRAG_VIEW_ROOT_SELECTOR,
      });
      void deleteOccurrence(occurrence, focusContext).catch(reportError);
      return;
    }
    if (isConversionToggleKey(event)) {
      // 終日行の帯のうち終日でないもの（複数日にまたがる時間指定のオカレンス）では
      // 既定動作を抑制せず、A キーを他のリスナー（`useCalendarShortcuts` の
      // ビュー切替等）へそのまま委ねる（`use-day-drag.ts` の終日行と同じ規則）
      if (allDay && !occurrence.allDay) {
        return;
      }
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
        // 終日 → 時間指定: 開始日の表示時間帯の開始（`slotMinTime`）から
        // `defaultEventMinutes` 分（`use-day-drag.ts` の A キーと同じ長さ規則）
        const start = addMinutesInZone(
          dayStart,
          parseSlotBoundaryTime(state.options.slotMinTime),
          timeZone,
        );
        void commitConversion(
          occurrence,
          { start, end: addMinutesInZone(start, state.options.defaultEventMinutes, timeZone) },
          false,
          laneId,
          laneId,
        ).catch(reportError);
        return;
      }
      // 時間指定 → 終日: 開始日 1 日分（`use-time-grid-drag.ts` の A キーと同じ長さ規則。
      // ポインタの変換ドラッグと異なり、暦日数分には引き伸ばさない）
      void commitConversion(
        occurrence,
        { start: dayStart, end: addDaysInZone(dayStart, 1, timeZone) },
        true,
        laneId,
        laneId,
      ).catch(reportError);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (occurrence.event.editable === false) {
        return;
      }
      // 画面上の隣の列（リソース × 日の並び）へ移動する。複数日表示では
      // 同一リソース内の隣の日、リソース境界では隣のリソースの端の日になり、
      // 日の差分は開始・終了の日数シフトとして適用する。
      // 基準列はフォーカス中の要素が属するレーン（複数リソース割当では
      // 表示中の複数の列のうち操作した列だけが移動対象になる）
      const sourceLaneId = sourceLaneIdFor(occurrence, event.currentTarget);
      const columns = currentColumns();
      const index = columnIndexFor(occurrence, sourceLaneId);
      if (index === -1) {
        return;
      }
      const current = columns[index];
      const target = columns[index + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (current === undefined || target === undefined) {
        return;
      }
      const targetLaneId = target.resource?.id ?? null;
      const dayDelta = target.dayIndex - current.dayIndex;
      if (dayDelta === 0 && targetLaneId === sourceLaneId) {
        return;
      }
      const range =
        dayDelta === 0
          ? null
          : shiftRangeByDays({ start: occurrence.start, end: occurrence.end }, dayDelta);
      void commitKeyboardChange(
        occurrence,
        'move',
        range,
        targetLaneId,
        allDay,
        sourceLaneId,
      ).catch(reportError);
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
    // 時間のみの操作。レーンは不変（source = target）のため割当パッチは生成されない
    const laneId = sourceLaneIdFor(occurrence, event.currentTarget);
    void commitKeyboardChange(
      occurrence,
      event.shiftKey ? 'resize' : 'move',
      range,
      laneId,
      false,
      laneId,
    ).catch(reportError);
  }

  /** 終日セルのクリックでその列の日 1 日の終日イベントを作成する。 */
  function handleAllDayCellClick(column: ResourceColumn): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const { state } = paramsRef.current.calendar;
    const day = column.date;
    const range: DateRange = {
      start: day,
      end: startOfDayInZone(addDaysInZone(day, 1, state.timeZone), state.timeZone),
    };
    void commitCreateRange(range, true, column.resource?.id ?? null, null).catch(reportError);
  }

  /**
   * キーボード作成（Enter / Space）の作成範囲を返す。開始はその列の日の表示時間帯の
   * 開始（`slotMinTime`。未指定なら 0:00）、長さは `defaultEventMinutes` 分
   * （クリック作成と同じ長さ規則。`use-time-grid-drag.ts` の同名ヘルパと同じ方針）。
   */
  function keyboardCreateRange(column: ResourceColumn): DateRange {
    const { state } = paramsRef.current.calendar;
    const start = addMinutesInZone(
      column.date,
      parseSlotBoundaryTime(state.options.slotMinTime),
      state.timeZone,
    );
    return {
      start,
      end: addMinutesInZone(start, state.options.defaultEventMinutes, state.timeZone),
    };
  }

  /**
   * リソース列のキーボード操作（Enter・Space = 即時作成）。作成範囲は
   * {@link keyboardCreateRange}、リソースは列のレーン（未割り当て列は `null`）で、
   * 確定はポインタ経路と同じ {@link commitCreateRange}（制約判定 →
   * `onBeforeSelectRange` → `onSelectRange` 委譲 / 既定即時作成）。
   * 既定即時作成の確定後は新規予定の要素へフォーカスを移す。
   */
  function handleColumnKeyDown(
    column: ResourceColumn,
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    // 列の子として描画される予定ボタン由来のキー操作（Enter/Space 等）を
    // 列の作成として二重処理しない（終日セルと同じ規則）
    if (originatesFromOccurrenceElement(event.target)) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    const viewRoot = event.currentTarget.closest(RESOURCE_GRID_DRAG_VIEW_ROOT_SELECTOR);
    void commitCreateRange(
      keyboardCreateRange(column),
      false,
      column.resource?.id ?? null,
      viewRoot === null ? null : { viewRoot },
    ).catch(reportError);
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
            dayStart: column.date,
          });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleColumnPointerDown(column, event);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleColumnKeyDown(column, event);
      },
      tabIndex: 0,
      'data-koyomi-resource': laneKeyOf(column),
      'data-koyomi-date': column.dayKey,
    };
  }

  function getAllDayCellProps(column: ResourceColumn): ResourceAllDayCellProps {
    return {
      onClick: () => {
        handleAllDayCellClick(column);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        // 終日アイテムのボタン由来のキー操作（Enter/Space 等）をセルの作成として
        // 二重処理しない（pointerdown/click と同じ理由）
        if (originatesFromOccurrenceElement(event.target)) {
          return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        handleAllDayCellClick(column);
      },
      tabIndex: 0,
      'data-koyomi-resource': laneKeyOf(column),
      'data-koyomi-date': column.dayKey,
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
      ...eventNotificationProps(paramsRef.current.callbacks, occurrence),
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
    // 複数日表示ではプレビュー範囲をこの列の日でクランプする（対象日以外の列には出さない）
    const timeZone: TimeZoneId = state.timeZone;
    const dayStart = column.date;
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
      ...(preview.invalid ? { invalid: true } : {}),
    };
  }

  function isAllDayPreviewTarget(column: ResourceColumn): boolean {
    const { state } = paramsRef.current.calendar;
    const preview = state.dragPreview;
    if (preview === null || !preview.allDay) {
      return false;
    }
    if ((preview.resourceId ?? null) !== (column.resource?.id ?? null)) {
      return false;
    }
    // 複数日表示ではプレビュー範囲がこの列の日と重なる場合のみ対象にする
    // （長さ 0 の範囲でも開始日 1 日分として扱えるよう、終端を最低 1ms 確保する）
    const timeZone: TimeZoneId = state.timeZone;
    const dayStart = column.date;
    const dayEnd = startOfDayInZone(addDaysInZone(dayStart, 1, timeZone), timeZone);
    const effectiveEndMs = Math.max(preview.range.end.getTime(), preview.range.start.getTime() + 1);
    return preview.range.start.getTime() < dayEnd.getTime() && effectiveEndMs > dayStart.getTime();
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
