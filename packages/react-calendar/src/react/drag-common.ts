/**
 * @packageDocumentation
 * 時間グリッド／リソースビュー／タイムラインの3つのドラッグ系フック
 * （`use-time-grid-drag` / `use-resource-grid-drag` / `use-timeline-drag`）が
 * 共有する内部ヘルパー。ライブラリの公開 API ではない（`index.ts` からは
 * 再エクスポートしない。利用側は各フックが返すハンドラ経由でのみ機能を使う）。
 *
 * ここに置いているのは、3フックで実装が一字一句同一だった、あるいは
 * 「ビュー固有の処理をコールバックとして注入するだけで吸収できる」と
 * 判断できたロジックに限る:
 *
 * - {@link laneResourceIdOf} — オカレンスの代表レーンのリソース ID を求める
 *   （リソースビュー・タイムラインの2フックで共有）
 * - {@link laneIdFromEventTarget} — 操作した DOM 要素から操作元レーンのリソース ID を
 *   解決する（複数リソース割当のオカレンスは複数レーンに表示されるため、操作元の
 *   特定は DOM を正とする。リソースビュー・タイムラインの2フックで共有）
 * - {@link collectOverlapBlockersInRange} — 重なり判定用ブロッカーの収集
 *   （時間グリッド・日単位（帯）・リソース・タイムライン・外部ドラッグの 5 フック共通。
 *   `api.getOccurrences` から収集することで、表示中のビューモデルに現れない
 *   オカレンスとの重なりも判定対象にする）。展開結果は {@link OverlapBlockerCache}
 *   （{@link createOverlapBlockerCache} で作成し、各フックが `useRef` で 1 つ保持する）
 *   によりイベント集合・表示 TZ・対象範囲が変わらない限りドラッグ 1 回につき 1 回に
 *   抑える
 * - {@link resolveScopeForRecurring} — 繰り返しオカレンスのスコープ解決（3フック共通）
 * - {@link checkBeforeEventChange} / {@link checkBeforeSelectRange} /
 *   {@link checkBeforeEventDelete} — 適用前フック（`onBeforeEventChange` 等）の
 *   判定（4フック共通。`use-day-drag.ts` を含む）
 * - {@link reportOperationRejected} — 拒否通知 `onOperationRejected` の呼び出し
 *   （4フック共通。`isDragCandidateValid` が `false` を返した箇所（`reason: 'constraint'`）、
 *   および適用前フックが `false` を返した箇所（`reason: 'rejected'`）の両方、
 *   拒否が確定した直後（早期 return の直前）から呼ぶ）
 * - {@link autoScrollVelocity} — オートスクロールの速度計算（3フック共通）
 * - {@link createAutoScrollLoop} — オートスクロールの rAF ループ管理（3フック共通。
 *   軸（縦/横）だけが違う）
 * - {@link attachDragSessionListeners} — pointermove/pointerup/pointercancel/keydown の
 *   document リスナー配線・解除（3フック共通）
 * - {@link eventNotificationProps} — 追加通知系ハンドラ（`onEventDoubleClick` /
 *   `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`）の配線
 *   （3フックに加え `use-day-drag.ts` と `list-view-parts.tsx` も含む 5 箇所共通）
 * - {@link createDefaultEvent} — `onSelectRange` 未指定時の既定即時作成
 *   （3フックに加え `use-day-drag.ts` と `use-calendar-announcer.ts` も含む 5 箇所共通。
 *   タイトル・`allDay` / `resourceId` の付与規則をここに集約し、複製を禁止する）
 * - {@link captureOccurrenceDeleteFocusContext} / {@link createOccurrenceDeleteFocusController} —
 *   キーボード削除後のフォーカス管理（4フック共通。`use-day-drag.ts` を含む）
 * - {@link originatesFromOccurrenceElement} — 列/行/セルへバブルしてきたイベントが、
 *   内側にネストされた予定要素（`data-koyomi-occurrence`）由来かどうかの判定
 *   （3フックのキーボード作成の二重処理防止で共通）
 * - {@link createCreatedEventFocusController} — キーボード作成による既定即時作成の
 *   確定後、新規予定の要素へフォーカスを移す管理（3フック共通）
 *
 * 逆に、`startSession` 本体（`DragSession` の構造・pointermove 時の座標→日時変換や
 * レーン追従ロジック・`cancelSession`/`commitSession` の中身）は意図的に共通化して
 * いない。3フックで保持する状態が異なり（例: 終日変換プレビューは時間グリッドのみ、
 * 対象リソース ID の追跡はリソースビュー/タイムラインのみ、終日の帯の日単位移動用の
 * 基準日はタイムラインのみ）、無理に1つのヘルパーへ吸収しようとすると分岐用の
 * オプション引数が増殖してしまうため（このプロジェクトが避けたい過剰抽象化）。
 */

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { type OverlapBlocker, occurrenceBlocksOverlap } from '../core/constraints';
import { rangesOverlap } from '../core/date-utils';
import { assignedLaneIds, effectiveResourceIds } from '../core/resource-assignment';
import { addDaysInZone, startOfDayInZone } from '../core/timezone';
import type {
  CalendarApi,
  CalendarEvent,
  DateRange,
  EventChangeEntry,
  EventOccurrence,
  RecurringEditScope,
  TimeZoneId,
} from '../core/types';
import { resourceIdFromLaneKey } from '../core/views/lane-key';
import type {
  CalendarInteractionCallbacks,
  EventChangeProposal,
  EventCreateInfo,
  OperationRejection,
  RangeSelection,
} from './types';

/**
 * オカレンスの代表レーンのリソース ID（未割り当ては `null`）を返す。
 *
 * `resources` に存在しない ID（参照先を失った割当）はビュービルダーが
 * 未割り当てレーン／行へ合流させるため、ここでも `null` に正規化する。
 * 正規化しないと、キーボードでの列・行移動が現在のレーンを見つけられず、
 * 変更検出も表示上のレーンと食い違う。
 *
 * 複数リソース割当（`resourceIds`）のオカレンスは複数のレーンに表示されるため、
 * この関数は**先頭の存在する割当**（表示上の最初のレーン）を代表として返す。
 * 操作対象のレーンを厳密に特定する必要がある場合は、操作した DOM 要素から
 * {@link laneIdFromEventTarget} で解決し、この関数はそのフォールバックとして使う。
 *
 * リソースビュー（`use-resource-grid-drag`）・タイムライン（`use-timeline-drag`）の
 * 両方から共通で使う（週/日ビューにはレーンの概念がないため対象外）。
 *
 * @param occurrence - 対象のオカレンス
 * @param resources - 現在の表示対象リソース一覧（`id` のみ参照する）
 * @returns 正規化済みのリソース ID。未割り当てなら `null`
 */
export function laneResourceIdOf(
  occurrence: EventOccurrence,
  resources: readonly { id: string }[],
): string | null {
  const first = effectiveResourceIds(occurrence.event).find((id) =>
    resources.some((resource) => resource.id === id),
  );
  return first ?? null;
}

/**
 * 操作対象の DOM 要素から、その要素が属するレーンのリソース ID を解決する。
 *
 * リソースビューの列・終日セル、タイムラインの行はいずれも `data-koyomi-resource`
 * 属性にレーンキー（`` `r:${id}` `` / `'unassigned'`。{@link resourceIdFromLaneKey} の
 * デコード対象）を持つため、最も近い祖先のこの属性から操作元レーンを特定できる。
 * 複数リソース割当（`resourceIds`）のオカレンスは複数のレーンに同時に表示されるため、
 * 「操作したレーン」の特定はイベントデータからは行えず、この DOM 解決を正とする。
 *
 * @param target - 操作イベントの `currentTarget`（またはその子孫要素）
 * @returns レーンのリソース ID（未割り当てレーンは `null`）。属性を持つ祖先が
 *   見つからない場合は `undefined`（呼び出し側が {@link laneResourceIdOf} 等へ
 *   フォールバックする）
 */
export function laneIdFromEventTarget(target: EventTarget | null): string | null | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const laneElement = target.closest('[data-koyomi-resource]');
  if (laneElement === null) {
    return undefined;
  }
  return resourceIdFromLaneKey(laneElement.getAttribute('data-koyomi-resource'));
}

/**
 * {@link collectOverlapBlockersInRange} の展開結果キャッシュの内部エントリ。
 * null 許容の 1 件のみを保持する（Map や LRU にはしない。ドラッグ中に有効な
 * イベント集合・表示 TZ・対象範囲の組は常に高々 1 つのため）。
 */
interface OverlapBlockerCacheEntry {
  /** 展開時の `api.getEvents()`（参照同一性で無効化判定に使う）。 */
  events: readonly CalendarEvent[];
  /** 展開時の表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** 展開時の `defaultEventMinutes`（`state.options.defaultEventMinutes`）。 */
  defaultEventMinutes: number;
  /** 展開した対象範囲の開始（ミリ秒）。 */
  rangeStartMs: number;
  /** 展開した対象範囲の終了（ミリ秒、排他）。 */
  rangeEndMs: number;
  /** 展開結果（blocker へマップする前のオカレンス。lane による絞り込み前）。 */
  occurrences: readonly EventOccurrence[];
}

/**
 * {@link collectOverlapBlockersInRange} の展開結果キャッシュ。
 *
 * ドラッグ系フックが {@link createOverlapBlockerCache} で 1 つ作り、`useRef` で
 * セッションを跨いで（アンマウントまで）保持し、そのフック内のすべての
 * {@link collectOverlapBlockersInRange} 呼び出しに渡す。
 */
export interface OverlapBlockerCache {
  /** 直近の展開結果。未展開、または無効化された直後は `null`。 */
  entry: OverlapBlockerCacheEntry | null;
}

/**
 * {@link OverlapBlockerCache} を新規作成する（未展開の空の状態）。
 *
 * 各ドラッグ系フック（時間グリッド・日単位（帯）・リソース・タイムライン・
 * 外部ドラッグ）が `useRef(createOverlapBlockerCache())` で 1 つ保持し、
 * そのフック内の {@link collectOverlapBlockersInRange} 呼び出しすべてに
 * 同じインスタンスを渡す（呼び出し箇所ごとに新規作成しない）。
 *
 * @returns 空の {@link OverlapBlockerCache}
 */
export function createOverlapBlockerCache(): OverlapBlockerCache {
  return { entry: null };
}

/**
 * 候補範囲を表示タイムゾーンの日境界に量子化する。
 *
 * 開始は当日の 0:00、終了は「当日の 0:00 が `range.end` より前なら翌日 0:00
 * へ切り上げ、`range.end` がすでに日境界ならそのまま」。これにより、候補範囲を
 * 含む最小の「日単位の範囲」が得られる（{@link collectOverlapBlockersInRange}
 * の対象範囲の合成に使う）。
 */
function quantizeToDayBoundaries(range: DateRange, timeZone: TimeZoneId): DateRange {
  const start = startOfDayInZone(range.start, timeZone);
  const startOfEndDay = startOfDayInZone(range.end, timeZone);
  const end =
    startOfEndDay.getTime() < range.end.getTime()
      ? addDaysInZone(startOfEndDay, 1, timeZone)
      : startOfEndDay;
  return { start, end };
}

/** 2 つの範囲の和集合（両方を包含する最小の範囲）を返す。 */
function unionRanges(a: DateRange, b: DateRange): DateRange {
  return {
    start: a.start.getTime() <= b.start.getTime() ? a.start : b.start,
    end: a.end.getTime() >= b.end.getTime() ? a.end : b.end,
  };
}

/**
 * 判定対象の候補範囲に重なる既存オカレンスを {@link OverlapBlocker} として収集する。
 *
 * ビューモデル（`CalendarViewModel`）由来の収集ではなく `api.getOccurrences`
 * （{@link CalendarApi.getOccurrences}。`expandEvents` による正規のオカレンス展開）
 * から収集する。ビューモデルは表示時間帯（`slotMinTime`/`slotMaxTime`）や表示範囲
 * （週・タイムラインの表示日数等）でさらにフィルタ済みのため、それを元にすると
 * 表示から除外されたオカレンスとの重なりを見逃してしまう
 * （例: `slotMaxTime` より後の時間指定イベント、表示範囲外の日にあるイベント）。
 * `getOccurrences` は表示フィルタ前の全オカレンスを返すため、これを直接使うことで
 * 非表示のオカレンスとの重なりも判定対象に含められる。
 *
 * ## 展開キャッシュ
 *
 * `cache`（{@link OverlapBlockerCache}）が非 `null` のエントリを持ち、かつ
 * イベント集合（`api.getEvents()` の参照同一性）・表示タイムゾーン・
 * `defaultEventMinutes`・対象範囲がすべて直近の呼び出しと一致する場合は
 * `api.getOccurrences` を呼ばず、キャッシュ済みのオカレンスを再利用する。
 * 一致しない場合のみ再展開してエントリを差し替える。
 *
 * 対象範囲は「`api.getVisibleRange()` ∪ `range` を表示タイムゾーンの日境界に
 * 量子化した範囲」（{@link quantizeToDayBoundaries}・{@link unionRanges}）。
 * 通常のポインタドラッグでは候補範囲が表示範囲に収まるため対象範囲は表示範囲と
 * 一致し、ドラッグ中ずっと不変になる（＝展開はイベント状態が変わらない限り
 * ドラッグ 1 回につき 1 回で済む）。矢印キー操作で候補が表示範囲外へ出た場合のみ
 * 対象範囲が広がり、そのキー押下時に 1 回再展開する。
 *
 * この「対象範囲で展開し、実際の候補範囲でフィルタする」方式は候補範囲での
 * 直接展開と厳密に等価である。対象範囲は候補範囲を包含するため、候補範囲に
 * 重なるオカレンスは（重なりの定義上）対象範囲にも重なり、対象範囲での展開結果に
 * 必ず含まれる。これを候補範囲との実際の重なりでフィルタすれば、候補範囲を
 * 直接渡して展開した場合と同じ集合になる。
 *
 * キャッシュはオカレンス（lane や `eventOverlap` を適用する前の展開結果）のみを
 * 保持する。`range` によるフィルタ・lane 指定による絞り込み・blocker への
 * マッピングはキャッシュのヒット・ミスに関わらず呼び出しのたびに行うため、
 * 同じキャッシュ内容に対して異なる候補範囲・異なる lane で呼んでも正しい結果になる。
 *
 * @param api - 対象カレンダーの `CalendarApi`
 * @param cache - 展開結果キャッシュ（{@link createOverlapBlockerCache} で作成し、
 *   呼び出し元フック内で `useRef` により 1 つを使い回す）
 * @param range - 判定対象の候補範囲
 * @param eventOverlap - {@link CalendarOptions.eventOverlap} の実効値
 * @param lane - レーンを持つビュー（リソース・タイムライン・それらへの外部ドラッグ）
 *   でのみ指定する。指定すると、所属レーン一覧（{@link assignedLaneIds}。複数リソース
 *   割当のオカレンスは割当先の各レーンに属する）が `lane.laneId` を含むオカレンス
 *   だけに絞り込む（レーンの概念がないビュー（時間グリッド・日単位（帯）等）では
 *   省略する）
 * @returns 収集された {@link OverlapBlocker} の一覧
 */
export function collectOverlapBlockersInRange(
  api: CalendarApi,
  cache: OverlapBlockerCache,
  range: DateRange,
  eventOverlap: boolean,
  lane?: { resources: readonly { id: string }[]; laneId: string | null },
): readonly OverlapBlocker[] {
  const { timeZone, options } = api.getState();
  const events = api.getEvents();
  const defaultEventMinutes = options.defaultEventMinutes;

  const targetRange = unionRanges(api.getVisibleRange(), quantizeToDayBoundaries(range, timeZone));
  const rangeStartMs = targetRange.start.getTime();
  const rangeEndMs = targetRange.end.getTime();

  let entry = cache.entry;
  if (
    entry === null ||
    entry.events !== events ||
    entry.timeZone !== timeZone ||
    entry.defaultEventMinutes !== defaultEventMinutes ||
    entry.rangeStartMs !== rangeStartMs ||
    entry.rangeEndMs !== rangeEndMs
  ) {
    entry = {
      events,
      timeZone,
      defaultEventMinutes,
      rangeStartMs,
      rangeEndMs,
      occurrences: api.getOccurrences(targetRange),
    };
    cache.entry = entry;
  }

  const overlapping = entry.occurrences.filter((occurrence) =>
    rangesOverlap({ start: occurrence.start, end: occurrence.end }, range),
  );
  let scoped: readonly EventOccurrence[];
  if (lane === undefined) {
    scoped = overlapping;
  } else {
    // 複数リソース割当（resourceIds）のオカレンスは属する各レーンでブロッカーになるため、
    // 代表レーンではなく所属レーン一覧（assignedLaneIds）で判定する
    const knownIds = new Set(lane.resources.map((resource) => resource.id));
    scoped = overlapping.filter((occurrence) =>
      assignedLaneIds(occurrence.event, knownIds).includes(lane.laneId),
    );
  }
  return scoped.map((occurrence) => ({
    key: occurrence.key,
    start: occurrence.start,
    end: occurrence.end,
    blocksOverlap: occurrenceBlocksOverlap(occurrence.event, eventOverlap),
  }));
}

/**
 * 繰り返しオカレンスのスコープを解決する。呼び出し元は `occurrence.isRecurring` が
 * `true` の場合にのみ呼ぶこと（単発オカレンスは呼び出し元で `null` 固定とし、
 * この関数を経由しない＝ `await` を発生させない。ドラッグ確定直後にブラウザが
 * 発火するネイティブ `click` に対する抑制フラグの設定を間に合わせるため）。
 *
 * @param callbacks - インタラクションコールバック。`resolveRecurringScope` が
 *   未指定なら常に `'this'`（既定スコープ）を返す
 * @param occurrence - 対象のオカレンス
 * @param action - 操作の種別
 * @returns 解決されたスコープ。キャンセルされた場合は `null`
 */
export async function resolveScopeForRecurring(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
  action: 'move' | 'resize' | 'delete' | 'update',
): Promise<RecurringEditScope | null> {
  const resolveRecurringScope = callbacks?.resolveRecurringScope;
  return resolveRecurringScope ? resolveRecurringScope(occurrence, action) : 'this';
}

/**
 * 変更（移動・リサイズ・終日⇔時間指定変換）の適用前フック `onBeforeEventChange`
 * を判定する（FullCalendar の `eventAllow` 相当）。呼び出し元は
 * `resolveRecurringScope` による繰り返しスコープの問い合わせより**前**に
 * これを呼ぶこと（拒否された場合にスコープ問い合わせ自体を行わないため）。
 *
 * 戻り値は次の三項演算子パターンと組み合わせて使うこと（呼び出し元の `async`
 * 関数の中に直接書く。別の `async` ヘルパー関数へ切り出さない）:
 *
 * ```ts
 * const gate = checkBeforeEventChange(callbacks, proposal);
 * const allowed = typeof gate === 'boolean' ? gate : await gate;
 * ```
 *
 * `boolean` を直接返す分岐（フック未指定、または同期的に `true`/`false` を返す
 * 実装）では `await` 式自体を評価しない。これを `await checkBeforeEventChange(...)`
 * のように毎回無条件に `await` してしまうと、フック未指定・同期 `true` 返却の
 * 場合でも呼び出し元の関数が microtask を 1 回消費してしまい、繰り返しでない
 * 単発オカレンスの操作が同期的に完結するという既存の前提（ドラッグ確定直後の
 * ネイティブ `click` 抑制のタイミング等）が崩れる。この判定を別の `async` 関数へ
 * 切り出すと、その関数呼び出し自体が常に `Promise` を返すため、`boolean` 分岐でも
 * 同じ問題が再発する（`async` 関数は本体が `await` に到達しなくても常に
 * `Promise` を返すため）。そのため、あえて関数化せず各呼び出し元にこの三項演算子
 * をそのまま書く方針にしている。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeEventChange` が
 *   未指定なら常に許可（`true`）する
 * @param proposal - 適用しようとしている変更の内容
 * @returns 適用してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeEventChange(
  callbacks: CalendarInteractionCallbacks | undefined,
  proposal: EventChangeProposal,
): boolean | Promise<boolean> {
  const onBeforeEventChange = callbacks?.onBeforeEventChange;
  return onBeforeEventChange === undefined ? true : onBeforeEventChange(proposal);
}

/**
 * 範囲選択の適用前フック `onBeforeSelectRange` を判定する
 * （FullCalendar の `selectAllow` 相当）。{@link checkBeforeEventChange} と同様、
 * 三項演算子パターンと組み合わせて使うこと。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeSelectRange` が
 *   未指定なら常に許可（`true`）する
 * @param selection - 選択された範囲
 * @returns 適用してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeSelectRange(
  callbacks: CalendarInteractionCallbacks | undefined,
  selection: RangeSelection,
): boolean | Promise<boolean> {
  const onBeforeSelectRange = callbacks?.onBeforeSelectRange;
  return onBeforeSelectRange === undefined ? true : onBeforeSelectRange(selection);
}

/**
 * 削除の適用前フック `onBeforeEventDelete` を判定する。
 * 呼び出し元は `resolveRecurringScope` より**前**にこれを呼ぶこと
 * （{@link checkBeforeEventChange} と同じ理由）。三項演算子パターンと組み合わせて使うこと。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeEventDelete` が
 *   未指定なら常に許可（`true`）する
 * @param occurrence - 削除しようとしているオカレンス
 * @returns 削除してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeEventDelete(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
): boolean | Promise<boolean> {
  const onBeforeEventDelete = callbacks?.onBeforeEventDelete;
  return onBeforeEventDelete === undefined ? true : onBeforeEventDelete(occurrence);
}

/**
 * 拒否通知 `onOperationRejected` を呼ぶ（未指定なら何もしない）。
 *
 * `isDragCandidateValid` が `false` を返した箇所（`reason: 'constraint'`）と、
 * `checkBeforeEventChange` / `checkBeforeSelectRange` / `checkBeforeEventDelete` が
 * `false` を返した箇所（`reason: 'rejected'`）の両方で、4 つのドラッグ系フックが
 * 拒否が確定した直後（早期 return の直前）から呼ぶ。
 *
 * `resolveRecurringScope` が `null` を返した場合（繰り返しスコープの選択を
 * ユーザーがキャンセルした場合）や `editable: false` による早期終了では呼ばない
 * （拒否ではなくユーザー自身によるキャンセル、または操作自体が開始されないため）。
 *
 * @param callbacks - インタラクションコールバック。`onOperationRejected` が
 *   未指定なら何もしない
 * @param rejection - 拒否の内容
 */
export function reportOperationRejected(
  callbacks: CalendarInteractionCallbacks | undefined,
  rejection: OperationRejection,
): void {
  callbacks?.onOperationRejected?.(rejection);
}

/**
 * ドラッグ中のポインタ位置からオートスクロールの速度を計算する。
 *
 * 軸に依存しない（呼び出し側がどちらの軸で使うかを決める）。`pointer` がスクロール
 * コンテナの進行方向の始端（`edgeStart`）から `threshold` 未満の距離にあれば負
 * （始端方向へスクロール）、終端（`edgeEnd`）から `threshold` 未満の距離にあれば正
 * （終端方向へスクロール）の速度を返す。端に近いほど速く、最大でも `maxSpeed` を
 * 超えない。それ以外の範囲では `0`（スクロールしない）。
 *
 * - 縦方向（週/日ビュー・リソースビュー）: `edgeStart`/`edgeEnd` にスクロール
 *   コンテナの上端/下端、`pointer` に `clientY` を渡す
 * - 横方向（タイムライン）: `edgeStart`/`edgeEnd` にコンテナの左端/右端、
 *   `pointer` に `clientX` を渡す
 *
 * @param params.edgeStart - スクロールコンテナの進行方向の始端の座標（px）
 * @param params.edgeEnd - スクロールコンテナの進行方向の終端の座標（px）
 * @param params.pointer - 現在のポインタの座標（px、`edgeStart`/`edgeEnd` と同じ軸・
 *   同じ座標系）
 * @param params.threshold - 端からオートスクロールが始まる距離（px）。既定は `24`
 * @param params.maxSpeed - 最大スクロール速度（px/フレーム相当）。既定は `16`
 * @returns スクロール速度（負 = 始端方向へ、正 = 終端方向へ、`0` = 停止）
 * @example
 * ```ts
 * autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 0 }); // => -16（始端で最大速度）
 * autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 300 }); // => 0（中央では停止）
 * ```
 */
export function autoScrollVelocity(params: {
  edgeStart: number;
  edgeEnd: number;
  pointer: number;
  threshold?: number;
  maxSpeed?: number;
}): number {
  const { edgeStart, edgeEnd, pointer, threshold = 24, maxSpeed = 16 } = params;
  if (threshold <= 0) {
    return 0;
  }
  const startBoundary = edgeStart + threshold;
  if (pointer < startBoundary) {
    const depth = Math.min(startBoundary - pointer, threshold);
    return -(depth / threshold) * maxSpeed;
  }
  const endBoundary = edgeEnd - threshold;
  if (pointer > endBoundary) {
    const depth = Math.min(pointer - endBoundary, threshold);
    return (depth / threshold) * maxSpeed;
  }
  return 0;
}

/** {@link createAutoScrollLoop} が返すコントローラ。 */
export interface AutoScrollLoop {
  /**
   * オートスクロールの状態を更新する。`container` が `null` ならループを止める
   * （{@link AutoScrollLoop.stop} と同じ）。`velocity` が `0` ならループは止めるが、
   * 次に非 0 の速度が来たときのために直近のコンテナは保持する。
   */
  update(container: Element | null, velocity: number): void;
  /** ループを止める（ドラッグセッションの `cleanup` から呼ぶ）。 */
  stop(): void;
}

/**
 * ドラッグ中のオートスクロールの rAF ループを管理するコントローラを作る。
 *
 * 呼び出し側は pointermove のたびに、対象コンテナと {@link autoScrollVelocity} の
 * 計算結果を {@link AutoScrollLoop.update} に渡す。速度が非 0 の間だけ
 * `requestAnimationFrame` でスクロール位置を進め続け、ドラッグ終了時（`cleanup`）に
 * {@link AutoScrollLoop.stop} を呼んでループを止める。
 *
 * `axis` はフレームごとに進めるスクロール位置のプロパティを決める
 * （`'vertical'` → `scrollTop`、`'horizontal'` → `scrollLeft`）。コンテナの探索方法
 * （セレクタ）や速度計算のための矩形の取り方はビュー固有のため、この関数の外
 * （呼び出し側の pointermove ハンドラ）で行う。
 *
 * @param axis - スクロールする軸
 */
export function createAutoScrollLoop(axis: 'vertical' | 'horizontal'): AutoScrollLoop {
  let scrollContainer: Element | null = null;
  let scrollVelocity = 0;
  let scrollFrameId: number | null = null;

  const scrollStep = (): void => {
    if (scrollContainer === null || scrollVelocity === 0) {
      scrollFrameId = null;
      return;
    }
    if (axis === 'vertical') {
      scrollContainer.scrollTop += scrollVelocity;
    } else {
      scrollContainer.scrollLeft += scrollVelocity;
    }
    scrollFrameId = requestAnimationFrame(scrollStep);
  };

  const stop = (): void => {
    if (scrollFrameId !== null) {
      cancelAnimationFrame(scrollFrameId);
      scrollFrameId = null;
    }
    scrollContainer = null;
    scrollVelocity = 0;
  };

  const update = (container: Element | null, velocity: number): void => {
    if (container === null) {
      stop();
      return;
    }
    scrollContainer = container;
    scrollVelocity = velocity;
    if (velocity === 0) {
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

  return { update, stop };
}

/** {@link attachDragSessionListeners} に渡すハンドラ集。 */
export interface DragSessionListenerHandlers {
  /** `pointermove`。jsdom の PointerEvent 未実装環境も考慮し `MouseEvent` で受ける。 */
  pointermove: (event: MouseEvent) => void;
  /** `pointerup`。`pointermove` と同じ理由で `MouseEvent` で受ける。 */
  pointerup: (event: MouseEvent) => void;
  /** `pointercancel`。 */
  pointercancel: (event: PointerEvent) => void;
  /** `keydown`（主に Escape によるキャンセル用）。 */
  keydown: (event: KeyboardEvent) => void;
}

/**
 * ドラッグセッション用の document レベルのリスナー
 * （pointermove/pointerup/pointercancel/keydown）をまとめて登録する。
 *
 * 3フックの `startSession` はいずれも同じ4イベントを同じ配線パターンで登録・解除
 * するため、その配線部分だけを共通化する（各イベントのハンドラの中身＝
 * ドラッグ座標の解釈やコミット処理はビュー固有のまま、フック側で定義する）。
 *
 * @param handlers - 各イベントのハンドラ
 * @returns 登録した4つのリスナーをすべて解除する関数（セッションの `cleanup` から呼ぶ）
 */
export function attachDragSessionListeners(handlers: DragSessionListenerHandlers): () => void {
  document.addEventListener('pointermove', handlers.pointermove);
  document.addEventListener('pointerup', handlers.pointerup);
  document.addEventListener('pointercancel', handlers.pointercancel);
  document.addEventListener('keydown', handlers.keydown);
  return () => {
    document.removeEventListener('pointermove', handlers.pointermove);
    document.removeEventListener('pointerup', handlers.pointerup);
    document.removeEventListener('pointercancel', handlers.pointercancel);
    document.removeEventListener('keydown', handlers.keydown);
  };
}

/**
 * イベント要素に付与する追加通知系ハンドラ（`onDoubleClick` / `onContextMenu` /
 * `onPointerEnter` / `onPointerLeave`）。対応するコールバック
 * （`onEventDoubleClick` 等）が未指定のキーは {@link eventNotificationProps} の
 * 戻り値に含まれない。
 */
export interface EventNotificationProps {
  /** ダブルクリックで `onEventDoubleClick` を呼ぶ。 */
  onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** コンテキストメニュー操作で `onEventContextMenu` を呼ぶ（`preventDefault` はしない）。 */
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** `pointerenter` で `onEventHover` を呼ぶ。 */
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** `pointerleave` で `onEventHoverEnd` を呼ぶ。 */
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * イベント要素に付与する追加通知系ハンドラ（`onEventDoubleClick` /
 * `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`）を、対応する
 * コールバックが指定されている場合のみ含むオブジェクトとして返す。
 *
 * コールバック未指定時はキー自体を含めない。月ビュー（帯セグメント）・週/日ビュー・
 * リソースビュー・タイムライン・リストビューの `getEventProps` 系の戻り値に
 * スプレッドすることで、各ビューの「省略時は DOM props を追加しない」という仕様を
 * 1 箇所の実装で保証する。
 *
 * @param callbacks - インタラクションコールバック
 * @param occurrence - 対象のオカレンス
 * @returns 追加通知系ハンドラ（該当コールバック未指定のキーは含まない）
 */
export function eventNotificationProps(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
): EventNotificationProps {
  const props: EventNotificationProps = {};
  const onEventDoubleClick = callbacks?.onEventDoubleClick;
  if (onEventDoubleClick !== undefined) {
    props.onDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
      onEventDoubleClick(occurrence, event.nativeEvent);
    };
  }
  const onEventContextMenu = callbacks?.onEventContextMenu;
  if (onEventContextMenu !== undefined) {
    props.onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
      onEventContextMenu(occurrence, event.nativeEvent);
    };
  }
  const onEventHover = callbacks?.onEventHover;
  if (onEventHover !== undefined) {
    props.onPointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
      onEventHover(occurrence, event.nativeEvent);
    };
  }
  const onEventHoverEnd = callbacks?.onEventHoverEnd;
  if (onEventHoverEnd !== undefined) {
    props.onPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
      onEventHoverEnd(occurrence, event.nativeEvent);
    };
  }
  return props;
}

/** {@link createDefaultEvent} の `defaultEventTitle` 省略時に使う既定タイトル。 */
const FALLBACK_DEFAULT_EVENT_TITLE = '(タイトルなし)';

/**
 * `onSelectRange` 未指定時の既定即時作成を実行する（{@link CalendarInteractionCallbacks.onSelectRange}
 * の既定動作）。
 *
 * 4 つのドラッグ系フック（`use-day-drag` / `use-time-grid-drag` / `use-resource-grid-drag` /
 * `use-timeline-drag`）と `useCalendarAnnouncer` の `wrapCallbacks` が同一実装として呼ぶ。
 * タイトル・`allDay` / `resourceId` の付与規則をここに集約し、複製を禁止する
 * （呼び出し元ごとに個別実装すると、将来これらの扱いが変わったときに乖離するため）。
 *
 * `callbacks.onEventCreate`（{@link CalendarInteractionCallbacks.onEventCreate}）が
 * 指定されている場合、作成後に undo 対応用の `changes` を組み立てて呼ぶ。
 *
 * @param api - 対象カレンダーの `CalendarApi`
 * @param selection - 作成する範囲・終日フラグ・（リソース/タイムラインビューでの）対象レーンの
 *   リソース ID。`resourceId` を省略（`undefined`）した場合はリソース対象外ビュー、
 *   `null` は未割り当てレーンを表し、いずれも作成イベントに `resourceId` を含めない
 *   （文字列の場合のみ含める）
 * @param defaultEventTitle - 作成するイベントのタイトル。省略時は `'(タイトルなし)'`
 *   （呼び出し元は中央メッセージカタログの `common.untitledEvent` を渡す）
 * @param callbacks - `onEventCreate` の呼び出しに使うインタラクションコールバック
 * @returns 作成されたイベント
 */
export function createDefaultEvent(
  api: CalendarApi,
  selection: RangeSelection,
  defaultEventTitle: string = FALLBACK_DEFAULT_EVENT_TITLE,
  callbacks?: CalendarInteractionCallbacks,
): CalendarEvent {
  const { range, allDay, resourceId } = selection;
  const created = api.createEvent({
    title: defaultEventTitle,
    start: range.start,
    end: range.end,
    ...(allDay ? { allDay: true } : {}),
    ...(typeof resourceId === 'string' ? { resourceId } : {}),
  });
  const onEventCreate = callbacks?.onEventCreate;
  if (onEventCreate !== undefined) {
    const changes: readonly EventChangeEntry[] = [
      { after: created, index: api.getEvents().length - 1 },
    ];
    const info: EventCreateInfo = { event: created, changes, selection };
    onEventCreate(info);
  }
  return created;
}

/**
 * フォーカス移動先になり得るセル要素のセレクタ。`use-grid-navigation.ts` の
 * 非公開定数 `FOCUSABLE_CELL_SELECTOR` と同じ対象
 * （月・複数月ビューの日セル、週/日ビューの終日セル、年ビューの日ボタン）を指す。
 *
 * オカレンス削除後のフォーカス復帰（{@link captureOccurrenceDeleteFocusContext}）専用に
 * ここへ複製する。`use-grid-navigation.ts` はビルトインビュー専用の非公開モジュールで
 * この定数を export していないため import できない。対象セルの仕様を変える際は
 * 両ファイルを同期させること。
 */
const FOCUSABLE_CELL_SELECTOR = [
  '[data-koyomi="month-day"][data-koyomi-date]',
  '[data-koyomi="allday-cell"][data-koyomi-date]',
  '[data-koyomi="year-day"][data-koyomi-date]:not([data-outside])',
].join(', ');

/**
 * キーボード削除後のフォーカス復帰に使う、削除確定前に記録しておく情報。
 * {@link captureOccurrenceDeleteFocusContext} で作り、
 * {@link OccurrenceDeleteFocusController.arm} に渡す。
 */
export interface OccurrenceDeleteFocusContext {
  /** 削除対象オカレンスが属するビューのルート要素。削除後の再検索の基点にする。 */
  readonly viewRoot: Element;
  /**
   * ビュールート内で削除対象の次に位置する予定のキー（無ければ `null`）。
   * 削除対象と同じキーの要素（月ビューの週またぎの帯・複数リソース割当のオカレンス等、
   * 同じオカレンスが複数の DOM 要素を持つ場合）は重複排除した上で前後を求める。
   */
  readonly nextKey: string | null;
  /** ビュールート内で削除対象の前に位置する予定のキー（無ければ `null`）。 */
  readonly prevKey: string | null;
  /**
   * 削除対象の位置から最も近い、フォーカス移動先になり得るセル（{@link FOCUSABLE_CELL_SELECTOR}
   * に一致する祖先要素）。無ければ `null`。
   */
  readonly fallbackCell: HTMLElement | null;
}

/**
 * 削除確定前に、キーボード削除後のフォーカス復帰に必要な情報を記録する。
 *
 * `target` から最も近い `viewRootSelector` に一致するビュールート要素を探し、その内側の
 * `[data-koyomi-occurrence]` を DOM 順に列挙する（キーの重複は最初の出現だけを残す）。
 * 削除対象キー（`occurrenceKey`）の直前・直後のキーを「前の予定」「次の予定」の候補として
 * 記録し、削除確定後（{@link createOccurrenceDeleteFocusController} 経由）に実際の
 * フォーカス移動へ使う。
 *
 * ビュールートが見つからない場合は `null` を返す。呼び出し元はこの場合フォーカス復帰を
 * 行わない（`onKeyDownCapture` 等の想定外の DOM 構造からの呼び出しへの安全策）。
 *
 * @param params.target - 削除を発生させたキーボード操作イベントの `target`
 * @param params.occurrenceKey - 削除対象オカレンスのキー
 * @param params.viewRootSelector - ビュールート要素を特定するセレクタ（呼び出し元のビューの
 *   `data-koyomi` 属性値。複数候補がある場合はカンマ区切り）
 * @returns 記録したコンテキスト。ビュールートが見つからなければ `null`
 */
export function captureOccurrenceDeleteFocusContext(params: {
  target: EventTarget | null;
  occurrenceKey: string;
  viewRootSelector: string;
}): OccurrenceDeleteFocusContext | null {
  const { target, occurrenceKey, viewRootSelector } = params;
  if (!(target instanceof Element)) {
    return null;
  }
  const viewRoot = target.closest(viewRootSelector);
  if (viewRoot === null) {
    return null;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const element of Array.from(viewRoot.querySelectorAll('[data-koyomi-occurrence]'))) {
    const key = element.getAttribute('data-koyomi-occurrence');
    if (key !== null && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const index = keys.indexOf(occurrenceKey);
  const nextKey = index >= 0 ? (keys[index + 1] ?? null) : null;
  const prevKey = index >= 0 ? (keys[index - 1] ?? null) : null;
  return {
    viewRoot,
    nextKey,
    prevKey,
    fallbackCell: target.closest<HTMLElement>(FOCUSABLE_CELL_SELECTOR),
  };
}

/**
 * `viewRoot` 内で `key` に一致する `[data-koyomi-occurrence]` 要素を探す。
 * 見つからなければ `null`（削除によりその予定自体が消えた場合を含む）。
 */
function findOccurrenceElementByKey(viewRoot: Element, key: string): HTMLElement | null {
  for (const element of Array.from(
    viewRoot.querySelectorAll<HTMLElement>('[data-koyomi-occurrence]'),
  )) {
    if (element.getAttribute('data-koyomi-occurrence') === key) {
      return element;
    }
  }
  return null;
}

/**
 * 削除後、次の予定 → 前の予定 → 削除位置から最も近い FOCUSABLE セル → 何もしない、
 * の優先順でフォーカスを移す（{@link createOccurrenceDeleteFocusController} 内部専用）。
 * DOM 更新完了後（呼び出し元の `useLayoutEffect`）に呼ばれる前提のため、
 * `nextKey`/`prevKey` は再レンダー後の DOM から探し直す。
 */
function focusAfterOccurrenceDelete(context: OccurrenceDeleteFocusContext): void {
  const { viewRoot, nextKey, prevKey, fallbackCell } = context;
  const next = nextKey === null ? null : findOccurrenceElementByKey(viewRoot, nextKey);
  if (next !== null) {
    next.focus({ preventScroll: true });
    return;
  }
  const prev = prevKey === null ? null : findOccurrenceElementByKey(viewRoot, prevKey);
  if (prev !== null) {
    prev.focus({ preventScroll: true });
    return;
  }
  if (fallbackCell?.isConnected) {
    fallbackCell.focus({ preventScroll: true });
  }
}

/** {@link createOccurrenceDeleteFocusController} が返すコントローラ。 */
export interface OccurrenceDeleteFocusController {
  /**
   * 削除が実際に適用された直後（`api.deleteEvent` 呼び出しの直後、`await` を挟まず
   * 同じ同期区間内）に呼ぶ。次の再レンダー（DOM 更新）後に一度だけフォーカス解決を
   * 試みるよう予約する。`context` が `null` なら何も予約しない
   * （{@link captureOccurrenceDeleteFocusContext} がビュールートを見つけられなかった場合）。
   */
  arm(context: OccurrenceDeleteFocusContext | null): void;
  /**
   * 予約されたフォーカス解決を消費する。呼び出し元フックの、依存配列なし（＝毎レンダー
   * 実行される）の `useLayoutEffect` から呼ぶこと（`virtual-resource-view.tsx` の
   * pinned フォーカス復元と同じ「DOM 更新完了後まで待つ」パターン）。予約がなければ
   * 何もしない。
   */
  consume(): void;
}

/**
 * オカレンス削除後のフォーカス復帰を管理するコントローラを作る。
 *
 * 4 つのドラッグ系フック（`use-day-drag` / `use-time-grid-drag` / `use-resource-grid-drag` /
 * `use-timeline-drag`）が `useRef(createOccurrenceDeleteFocusController())` で 1 つ保持する。
 *
 * @returns 空のコントローラ（未予約の状態）
 */
export function createOccurrenceDeleteFocusController(): OccurrenceDeleteFocusController {
  let pending: OccurrenceDeleteFocusContext | null = null;
  return {
    arm(context: OccurrenceDeleteFocusContext | null): void {
      pending = context;
    },
    consume(): void {
      if (pending === null) {
        return;
      }
      const context = pending;
      pending = null;
      focusAfterOccurrenceDelete(context);
    },
  };
}

/**
 * 列/行/セルへバブルしてきたイベントが、内側にネストされた予定要素
 * （`data-koyomi-occurrence` 属性を持つ要素）由来かどうかを判定する。
 *
 * 予定要素側のキー操作（Enter/Space によるクリック相当等）は伝播を止めない
 * （カレンダー外側の祖先の利用側リスナーへそのまま届ける方針）ため、列/行/セル側が
 * この判定でイベントの由来を確認し、自身のキーボード作成として二重処理しないようにする
 * （`use-day-drag.ts` のセルと同じ規則）。
 *
 * @param target - 列/行/セルの keydown / pointerdown イベントの `target`
 * @returns 予定要素（またはその子孫）由来なら `true`
 */
export function originatesFromOccurrenceElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-koyomi-occurrence]') !== null;
}

/**
 * キーボード作成による既定即時作成の確定後、新規予定の要素へフォーカスを移すために
 * 作成確定時に記録しておく情報。{@link CreatedEventFocusController.arm} に渡す。
 */
export interface CreatedEventFocusContext {
  /** 作成操作が行われたビューのルート要素。作成後の要素検索の基点にする。 */
  readonly viewRoot: Element;
  /**
   * 作成されたイベントの先頭オカレンスのキー。既定即時作成は単発イベントを作るため、
   * `occurrenceKey(作成イベントの id, 作成範囲の start)`（`core/expansion.ts`）で求まる。
   */
  readonly occurrenceKey: string;
}

/** {@link createCreatedEventFocusController} が返すコントローラ。 */
export interface CreatedEventFocusController {
  /**
   * 既定即時作成（{@link createDefaultEvent}）が適用された直後（`await` を挟まず同じ
   * 同期区間内）に呼ぶ。次の再レンダー（DOM 更新）後に一度だけフォーカス移動を
   * 試みるよう予約する。`context` が `null` なら何も予約しない。
   */
  arm(context: CreatedEventFocusContext | null): void;
  /**
   * 予約されたフォーカス移動を消費する。呼び出し元フックの、依存配列なし（＝毎レンダー
   * 実行される）の `useLayoutEffect` から呼ぶこと
   * （{@link OccurrenceDeleteFocusController.consume} と同じパターン）。予約がなければ
   * 何もしない。対象キーの要素が見つからない場合（`onBeforeSelectRange` 以降に
   * イベントが消えた場合等）はフォーカスを移さない。
   */
  consume(): void;
}

/**
 * キーボード作成による既定即時作成の確定後のフォーカス移動を管理するコントローラを作る。
 *
 * キーボード作成を持つ 3 つのドラッグ系フック（`use-time-grid-drag` /
 * `use-resource-grid-drag` / `use-timeline-drag`）が
 * `useRef(createCreatedEventFocusController())` で 1 つ保持する。ポインタの作成経路では
 * 予約しない（フォーカス移動はキーボード作成の既定即時作成が成功したときのみ）。
 *
 * @returns 空のコントローラ（未予約の状態）
 */
export function createCreatedEventFocusController(): CreatedEventFocusController {
  let pending: CreatedEventFocusContext | null = null;
  return {
    arm(context: CreatedEventFocusContext | null): void {
      pending = context;
    },
    consume(): void {
      if (pending === null) {
        return;
      }
      const context = pending;
      pending = null;
      findOccurrenceElementByKey(context.viewRoot, context.occurrenceKey)?.focus({
        preventScroll: true,
      });
    },
  };
}
