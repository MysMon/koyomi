/**
 * @packageDocumentation
 * カレンダーエンジン（フレームワーク非依存）。
 *
 * カレンダーの状態（ビュー・基準日・タイムゾーン・イベント・ドラッグプレビュー）を
 * 保持し、購読モデルで変更を通知する。React からは `useCalendar` フックが
 * `useSyncExternalStore` でこのエンジンを購読する。
 *
 * 状態の変更操作は {@link ./mutations} の純粋関数に委譲し、
 * ビューモデルの構築は {@link ./views} の各ビルダーに委譲する。
 */

import { navigateDate, visibleRangeFor } from './date-utils';
import { expandEvents } from './expansion';
import type { MutationContext, RecurringTarget } from './mutations';
import { createEventIn, deleteEventInWithChanges, updateEventInWithChanges } from './mutations';
import {
  getLocalTimeZone,
  isValidTimeZone,
  parseSlotBoundaryTime,
  parseTimeOfDay,
} from './timezone';
import type {
  BusinessHoursRule,
  CalendarApi,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarOptions,
  CalendarOptionsPatch,
  CalendarRangeChangeInfo,
  CalendarResource,
  CalendarState,
  CalendarViewModel,
  CalendarViewType,
  DateRange,
  DragPreview,
  EventChangeEntry,
  EventId,
  EventOccurrence,
  ResolvedCalendarOptions,
  TimeZoneId,
  Weekday,
} from './types';
import { buildListViewModel } from './views/list-view';
import { buildMonthViewModel } from './views/month-view';
import { buildMultiMonthViewModel } from './views/multi-month-view';
import { buildResourceViewModel } from './views/resource-view';
import { buildTimeGridViewModel } from './views/time-grid-view';
import { buildTimelineViewModel } from './views/timeline-view';
import { buildYearViewModel } from './views/year-view';

/** 解決済みオプションの既定値。 */
const DEFAULT_OPTIONS: Omit<ResolvedCalendarOptions, 'now'> = {
  weekStartsOn: 0,
  dayMaxEvents: 4,
  snapMinutes: 15,
  slotMinutes: 60,
  timeAxisZones: [],
  defaultEventMinutes: 60,
  listDays: 30,
  multiMonthCount: 3,
  timelineDays: 1,
  resourceViewDays: 1,
  timelineScale: 'hour',
  unassignedLane: 'auto',
  locale: 'ja',
  hiddenWeekdays: [],
  showWeekNumbers: false,
  businessHours: [],
  eventOverlap: true,
  eventConstraint: null,
  slotMinTime: '00:00',
  slotMaxTime: '24:00',
};

/**
 * `hiddenWeekdays` を正規化する。重複を除き、7 曜日すべてが指定された場合は
 * 表示できる日がなくなるため無効な設定として空配列を返す。
 */
function normalizeHiddenWeekdays(hiddenWeekdays: readonly Weekday[]): readonly Weekday[] {
  const unique = [...new Set(hiddenWeekdays)];
  return unique.length >= 7 ? [] : unique;
}

/** 自動採番 ID のプレフィックス。 */
const ID_PREFIX = 'koyomi-';

/**
 * 正の整数オプションを正規化する。
 * 非有限値・下限未満（0 や負値を含む）は下限へクランプし、小数は切り捨てる。
 * `slotMinutes` / `snapMinutes` が 0 だとゼロ除算やスロット消失を招くため、
 * 壊れた表示を作らないよう最低値を保証する。
 */
function normalizePositiveInt(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.floor(value));
}

/**
 * `CalendarOptions` から解決済みオプションを構築する。
 * 未指定のフィールドには既定値を適用し、数値オプションは正の整数へ正規化する。
 * 配列オプション（`timeAxisZones` / `businessHours`）は呼び出し側の配列参照を
 * そのまま保持せず、浅く複製する（事後変更が内部状態に影響しないようにするため）。
 */
function resolveOptions(
  options:
    | (Omit<CalendarOptions, 'onEventsChange' | 'onRangeChange' | 'eventConstraint'> & {
        /** `null` は「配置制約を解除する」（{@link CalendarOptionsPatch.eventConstraint}）。 */
        eventConstraint?: CalendarOptions['eventConstraint'] | null;
      })
    | undefined,
  base?: ResolvedCalendarOptions,
): ResolvedCalendarOptions {
  const current = base ?? { ...DEFAULT_OPTIONS, now: () => new Date() };
  if (options?.timeAxisZones !== undefined) {
    assertTimeAxisZones(options.timeAxisZones);
  }
  if (options?.businessHours !== undefined) {
    assertBusinessHours(options.businessHours);
  }
  if (options?.eventConstraint !== undefined && Array.isArray(options.eventConstraint)) {
    assertBusinessHours(options.eventConstraint);
  }
  if (options?.slotMinTime !== undefined || options?.slotMaxTime !== undefined) {
    assertSlotTimeRange(
      options?.slotMinTime ?? current.slotMinTime,
      options?.slotMaxTime ?? current.slotMaxTime,
    );
  }
  return {
    weekStartsOn: options?.weekStartsOn ?? current.weekStartsOn,
    dayMaxEvents: normalizePositiveInt(options?.dayMaxEvents ?? current.dayMaxEvents, 1),
    snapMinutes: normalizePositiveInt(options?.snapMinutes ?? current.snapMinutes, 1),
    slotMinutes: normalizePositiveInt(options?.slotMinutes ?? current.slotMinutes, 1),
    timeAxisZones:
      options?.timeAxisZones !== undefined ? [...options.timeAxisZones] : current.timeAxisZones,
    defaultEventMinutes: normalizePositiveInt(
      options?.defaultEventMinutes ?? current.defaultEventMinutes,
      1,
    ),
    listDays: normalizePositiveInt(options?.listDays ?? current.listDays, 1),
    multiMonthCount: normalizePositiveInt(options?.multiMonthCount ?? current.multiMonthCount, 1),
    timelineDays: normalizePositiveInt(options?.timelineDays ?? current.timelineDays, 1),
    resourceViewDays: normalizePositiveInt(
      options?.resourceViewDays ?? current.resourceViewDays,
      1,
    ),
    timelineScale: options?.timelineScale ?? current.timelineScale,
    unassignedLane: options?.unassignedLane ?? current.unassignedLane,
    locale: options?.locale ?? current.locale,
    hiddenWeekdays:
      options?.hiddenWeekdays !== undefined
        ? normalizeHiddenWeekdays(options.hiddenWeekdays)
        : current.hiddenWeekdays,
    showWeekNumbers: options?.showWeekNumbers ?? current.showWeekNumbers,
    businessHours:
      options?.businessHours !== undefined ? [...options.businessHours] : current.businessHours,
    eventOverlap: options?.eventOverlap ?? current.eventOverlap,
    eventConstraint:
      options?.eventConstraint !== undefined
        ? Array.isArray(options.eventConstraint)
          ? [...options.eventConstraint]
          : options.eventConstraint
        : current.eventConstraint,
    slotMinTime: options?.slotMinTime ?? current.slotMinTime,
    slotMaxTime: options?.slotMaxTime ?? current.slotMaxTime,
    now: options?.now ?? current.now,
  };
}

/** {@link BusinessHoursRule} 1 件同士が等しいかどうかを比較する。 */
function businessHoursRuleEqual(a: BusinessHoursRule, b: BusinessHoursRule): boolean {
  return (
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.daysOfWeek.length === b.daysOfWeek.length &&
    a.daysOfWeek.every((weekday, index) => weekday === b.daysOfWeek[index])
  );
}

/**
 * {@link ResolvedCalendarOptions.eventConstraint} 同士が等しいかどうかを比較する。
 * 両方 `null`、両方 `'businessHours'`、または配列同士（{@link businessHoursRuleEqual} で
 * 各要素を比較）のいずれかで一致すれば等しい（型が異なる組み合わせは常に不一致）。
 */
function eventConstraintEqual(
  a: ResolvedCalendarOptions['eventConstraint'],
  b: ResolvedCalendarOptions['eventConstraint'],
): boolean {
  if (a === null || b === null || typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  return (
    a.length === b.length &&
    a.every((rule, index) => {
      const other = b[index];
      return other !== undefined && businessHoursRuleEqual(rule, other);
    })
  );
}

/**
 * 解決済みオプション同士を浅く比較する。
 * `hiddenWeekdays` / `businessHours` は配列の中身（順序込み）で比較する。
 */
function resolvedOptionsEqual(a: ResolvedCalendarOptions, b: ResolvedCalendarOptions): boolean {
  return (
    a.weekStartsOn === b.weekStartsOn &&
    a.dayMaxEvents === b.dayMaxEvents &&
    a.snapMinutes === b.snapMinutes &&
    a.slotMinutes === b.slotMinutes &&
    a.timeAxisZones.length === b.timeAxisZones.length &&
    a.timeAxisZones.every((zone, index) => zone === b.timeAxisZones[index]) &&
    a.defaultEventMinutes === b.defaultEventMinutes &&
    a.listDays === b.listDays &&
    a.multiMonthCount === b.multiMonthCount &&
    a.timelineDays === b.timelineDays &&
    a.resourceViewDays === b.resourceViewDays &&
    a.timelineScale === b.timelineScale &&
    a.unassignedLane === b.unassignedLane &&
    a.locale === b.locale &&
    a.now === b.now &&
    a.hiddenWeekdays.length === b.hiddenWeekdays.length &&
    a.hiddenWeekdays.every((weekday, index) => weekday === b.hiddenWeekdays[index]) &&
    a.showWeekNumbers === b.showWeekNumbers &&
    a.businessHours.length === b.businessHours.length &&
    a.businessHours.every((rule, index) => {
      const other = b.businessHours[index];
      return other !== undefined && businessHoursRuleEqual(rule, other);
    }) &&
    a.eventOverlap === b.eventOverlap &&
    eventConstraintEqual(a.eventConstraint, b.eventConstraint) &&
    a.slotMinTime === b.slotMinTime &&
    a.slotMaxTime === b.slotMaxTime
  );
}

/** タイムゾーンを検証し、不正なら例外を投げる。 */
function assertTimeZone(timeZone: TimeZoneId): void {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`不正なタイムゾーンです: '${timeZone}'`);
  }
}

/** 追加の時間軸タイムゾーン一覧を検証し、不正な要素があれば例外を投げる。 */
function assertTimeAxisZones(timeAxisZones: readonly TimeZoneId[]): void {
  for (const zone of timeAxisZones) {
    assertTimeZone(zone);
  }
}

/**
 * 営業時間の指定一覧を検証し、不正な要素があれば例外を投げる。
 * `startTime` の形式は {@link parseTimeOfDay} が、`endTime` の形式は
 * {@link parseSlotBoundaryTime} が検証し（`endTime` のみ日の終端 `'24:00'` を許容）、
 * ここでは `startTime` が `endTime` より前であることを追加で検証する。
 */
function assertBusinessHours(businessHours: readonly BusinessHoursRule[]): void {
  for (const rule of businessHours) {
    const start = parseTimeOfDay(rule.startTime);
    const end = parseSlotBoundaryTime(rule.endTime);
    if (start >= end) {
      throw new Error(
        `不正な営業時間の指定です（startTime は endTime より前である必要があります）: startTime='${rule.startTime}', endTime='${rule.endTime}'`,
      );
    }
  }
}

/**
 * 表示時間帯（`slotMinTime`/`slotMaxTime`）を検証し、不正なら例外を投げる。
 * `slotMinTime`/`slotMaxTime` の形式は {@link parseSlotBoundaryTime} が検証し
 * （`slotMaxTime` のみ `'24:00'` 特例を許容）、ここでは `slotMinTime` が
 * `slotMaxTime` より前であることを追加で検証する（{@link assertBusinessHours} と同型）。
 */
function assertSlotTimeRange(slotMinTime: string, slotMaxTime: string): void {
  const start = parseSlotBoundaryTime(slotMinTime);
  const end = parseSlotBoundaryTime(slotMaxTime);
  if (start >= end) {
    throw new Error(
      `不正な表示時間帯の指定です（slotMinTime は slotMaxTime より前である必要があります）: slotMinTime='${slotMinTime}', slotMaxTime='${slotMaxTime}'`,
    );
  }
}

/** 日付を検証し、無効（NaN）なら例外を投げる。 */
function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error('無効な日付です');
  }
}

/** 有効なビュー名の一覧（{@link CalendarViewType} と同期させる）。 */
const VIEW_TYPES: readonly CalendarViewType[] = [
  'month',
  'week',
  'day',
  'list',
  'year',
  'multiMonth',
  'resource',
  'timeline',
];

/**
 * カレンダーエンジンを作成する。
 *
 * @param options - カレンダーのオプション（省略時はすべて既定値）
 * @returns カレンダー API（{@link CalendarApi}）
 *
 * @remarks
 * - `getState()` が返すスナップショットは、状態が変わらない限り同一の
 *   オブジェクト参照を返す（`useSyncExternalStore` との整合のため）。
 *   値が実際に変わらない設定操作（同じ view / timeZone / 日時、同一の
 *   イベント配列参照、内容が同じオプションパッチなど）は通知自体を発生させない
 * - `getViewModel()` の結果は、ビューモデルに影響する状態
 *   （ビュー・基準日・タイムゾーン・イベント・オプション）が変わるまで
 *   キャッシュされる。`setDragPreview` はキャッシュを無効化しない
 * - イベントの変更操作（`createEvent` / `updateEvent` / `deleteEvent`）が
 *   行われるたびに {@link CalendarOptions.onEventsChange} が呼ばれる。
 *   `setEvents`（外部同期の入口）では呼ばれない
 * - `createEvent` で `id` を省略した場合は `'koyomi-1'` のような連番 ID を
 *   採番する（既存 ID と衝突しない番号まで進む）
 * - `initialDate` に渡した `Date`、`events` / `resources` 配列は事後に変更しても
 *   内部状態に影響しない（複製して保持する）。ただし各イベント/リソース
 *   オブジェクト自身は複製されないため、カレンダーに渡した後・getter が
 *   返した後は変更しないこと
 *
 * @example
 * ```ts
 * const calendar = createCalendar({
 *   initialView: 'month',
 *   timeZone: 'Asia/Tokyo',
 *   events: [{ id: '1', title: '会議', start: '2026-07-01T10:00', end: '2026-07-01T11:00' }],
 * });
 * const unsubscribe = calendar.subscribe(() => {
 *   console.log('状態が変わりました', calendar.getState().view);
 * });
 * calendar.setView('week');
 * ```
 */
/**
 * ビュー名を検証し、未知の値なら Error を投げる。
 *
 * TypeScript の型チェックを経ない呼び出し（JS からの利用等）で不正な値が渡ると、
 * 後続の getViewModel() で原因の分かりにくい TypeError になるため、
 * 渡された時点で失敗させる（setTimeZone の不正 IANA ID 検証と同じ方針）。
 */
function assertViewType(view: CalendarViewType): void {
  if (!VIEW_TYPES.includes(view)) {
    throw new Error(`不正なビュー名です: '${String(view)}'（有効な値: ${VIEW_TYPES.join(', ')}）`);
  }
}

export function createCalendar(options?: CalendarOptions): CalendarApi {
  let resolvedOptions = resolveOptions(options);
  let view: CalendarViewType = options?.initialView ?? 'month';
  assertViewType(view);
  // initialDate / now() の戻り値は呼び出し側が保持する Date と同一参照になり得るため、
  // 複製して保持する（事後の外部変更が内部状態に影響しないようにするため）。
  let currentDate: Date =
    options?.initialDate !== undefined
      ? new Date(options.initialDate.getTime())
      : new Date(resolvedOptions.now().getTime());
  let timeZone: TimeZoneId = options?.timeZone ?? getLocalTimeZone();
  // events / resources も同様に、呼び出し側の配列参照をそのまま保持せず浅く複製する。
  let events: readonly CalendarEvent[] = options?.events !== undefined ? [...options.events] : [];
  let resources: readonly CalendarResource[] =
    options?.resources !== undefined ? [...options.resources] : [];
  // initialCollapsedResourceIds は作成時のみ有効（initialDate/initialView と同じ扱い）。
  // 呼び出し側の配列参照をそのまま保持せず、複製した Set として保持する
  let collapsedResourceIds: ReadonlySet<string> = new Set(
    options?.initialCollapsedResourceIds ?? [],
  );
  /**
   * `setEvents` / `updateOptions({ events })` に直近渡された「入力そのものの参照」。
   * `events`（内部の複製済み配列）とは別に保持し、同一参照を渡された場合の
   * no-op 判定に使う。`applyEventsChange`（createEvent 等の内部変更）が起きると
   * 無効化（`null`）し、その後に同じ入力配列を渡し直した場合は正しく反映されるようにする。
   */
  let lastEventsInput: readonly CalendarEvent[] | null = options?.events ?? null;
  /** `setResources` / `updateOptions({ resources })` 版の {@link lastEventsInput}。 */
  let lastResourcesInput: readonly CalendarResource[] | null = options?.resources ?? null;
  let dragPreview: DragPreview | null = null;
  let onEventsChange = options?.onEventsChange;
  let onRangeChange = options?.onRangeChange;

  assertTimeZone(timeZone);
  assertValidDate(currentDate);

  const listeners = new Set<() => void>();
  /** getState 用のスナップショットキャッシュ。 */
  let stateCache: CalendarState | null = null;
  /** getViewModel 用のキャッシュ。 */
  let viewModelCache: CalendarViewModel | null = null;
  /** ID 自動採番のカウンタ。 */
  let idCounter = 0;
  /** {@link lastNotifiedRange} の比較用スナップショットの型。 */
  type RangeSnapshot = {
    view: CalendarViewType;
    currentDateTime: number;
    rangeStart: number;
    rangeEnd: number;
  };

  /**
   * 直近に比較基準として記録した内容。`null` は「まだ一度も記録していない」
   * （このカレンダーの生存期間中、比較基準を 1 度も作っていない）ことを表す。
   * `onRangeChange` の登録有無に関わらず、状態が変わるたびに更新される
   * （未登録で作成 → 後から登録、という順序でも誤発火しないようにするため）。
   */
  let lastNotifiedRange: RangeSnapshot | null = null;

  /** 現在の状態から {@link RangeSnapshot} を作る。 */
  function computeRangeSnapshot(range: DateRange): RangeSnapshot {
    return {
      view,
      currentDateTime: currentDate.getTime(),
      rangeStart: range.start.getTime(),
      rangeEnd: range.end.getTime(),
    };
  }

  /** 2 つの {@link RangeSnapshot} が同じ内容かどうかを判定する。 */
  function rangeSnapshotsEqual(a: RangeSnapshot, b: RangeSnapshot): boolean {
    return (
      a.view === b.view &&
      a.currentDateTime === b.currentDateTime &&
      a.rangeStart === b.rangeStart &&
      a.rangeEnd === b.rangeEnd
    );
  }

  /**
   * `onRangeChange` が登録されていれば、現在のビュー・基準日・表示範囲を通知する。
   * 未登録なら何もしない。`currentDate` は複製してから渡す（公開境界での複製。
   * 呼び出し側が `info.currentDate` を変更しても内部状態に影響しないようにするため）。
   */
  function emitRangeChange(range: DateRange): void {
    if (onRangeChange === undefined) {
      return;
    }
    const info: CalendarRangeChangeInfo = {
      view,
      currentDate: new Date(currentDate.getTime()),
      rangeStart: range.start,
      rangeEnd: range.end,
    };
    onRangeChange(info);
  }

  /**
   * `onRangeChange` の発火判定を行う。ビュー・基準日・表示範囲（の計算結果）が
   * 直前の比較基準と 1 つでも異なる場合のみ 1 回発火する。表示範囲は
   * {@link getVisibleRange}（イベント展開にも使う既存の範囲計算）をそのまま
   * 再利用し、別の計算式を持たない。比較基準の更新自体は `onRangeChange` の
   * 登録有無に関わらず常に行う。
   */
  function notifyRangeChangeIfNeeded(): void {
    const range = getVisibleRange();
    const next = computeRangeSnapshot(range);
    const changed = lastNotifiedRange === null || !rangeSnapshotsEqual(lastNotifiedRange, next);
    lastNotifiedRange = next;
    if (!changed) {
      return;
    }
    emitRangeChange(range);
  }

  /**
   * 状態変更を確定してリスナーに通知する。
   * @param invalidatesViewModel - ビューモデルに影響する変更なら `true`
   */
  function commit(invalidatesViewModel: boolean): void {
    stateCache = null;
    if (invalidatesViewModel) {
      viewModelCache = null;
    }
    for (const listener of listeners) {
      listener();
    }
    if (invalidatesViewModel) {
      // ビュー・基準日・オプション（表示範囲に影響し得る）の変更はここに集約されるため、
      // ここで併せて onRangeChange の発火判定を行う（イベント/リソースの変更など
      // 範囲に無関係な更新は notifyRangeChangeIfNeeded 内の差分比較で自然に除外される）。
      // listeners 通知の後に呼ぶことで、commit 完了後に呼ぶ onEventsChange と
      // 発火タイミングの規約を揃える。
      notifyRangeChangeIfNeeded();
    }
  }

  /** 既存 ID と衝突しない連番 ID を生成する。 */
  function generateId(): EventId {
    const existing = new Set(events.map((event) => event.id));
    let id: EventId;
    do {
      idCounter += 1;
      id = `${ID_PREFIX}${idCounter}`;
    } while (existing.has(id));
    return id;
  }

  /** 変更操作用のコンテキストを構築する。 */
  function mutationContext(): MutationContext {
    return {
      displayTimeZone: timeZone,
      defaultEventMinutes: resolvedOptions.defaultEventMinutes,
      generateId,
    };
  }

  /** イベント一覧を置き換え、onEventsChange に通知する。 */
  function applyEventsChange(next: readonly CalendarEvent[]): void {
    events = next;
    // 内部変更により events が直近の入力参照と対応しなくなるため無効化する
    // （無効化しないと、後で同じ入力配列を setEvents に渡し直しても no-op 扱いになってしまう）。
    lastEventsInput = null;
    commit(true);
    onEventsChange?.(events);
  }

  function getVisibleRange(): DateRange {
    return visibleRangeFor(view, currentDate, timeZone, {
      weekStartsOn: resolvedOptions.weekStartsOn,
      listDays: resolvedOptions.listDays,
      multiMonthCount: resolvedOptions.multiMonthCount,
      timelineDays: resolvedOptions.timelineDays,
      resourceViewDays: resolvedOptions.resourceViewDays,
    });
  }

  function getOccurrences(range: DateRange): readonly EventOccurrence[] {
    return expandEvents({
      events,
      range,
      displayTimeZone: timeZone,
      defaultEventMinutes: resolvedOptions.defaultEventMinutes,
    });
  }

  function buildViewModel(): CalendarViewModel {
    const occurrences = getOccurrences(getVisibleRange());
    const now = resolvedOptions.now();
    switch (view) {
      case 'month':
        return buildMonthViewModel({
          currentDate,
          timeZone,
          occurrences,
          weekStartsOn: resolvedOptions.weekStartsOn,
          dayMaxEvents: resolvedOptions.dayMaxEvents,
          hiddenWeekdays: resolvedOptions.hiddenWeekdays,
          showWeekNumbers: resolvedOptions.showWeekNumbers,
          now,
        });
      case 'week':
      case 'day':
        return buildTimeGridViewModel({
          currentDate,
          viewType: view,
          timeZone,
          occurrences,
          weekStartsOn: resolvedOptions.weekStartsOn,
          slotMinutes: resolvedOptions.slotMinutes,
          locale: resolvedOptions.locale,
          timeAxisZones: resolvedOptions.timeAxisZones,
          hiddenWeekdays: resolvedOptions.hiddenWeekdays,
          showWeekNumbers: resolvedOptions.showWeekNumbers,
          businessHours: resolvedOptions.businessHours,
          slotMinTime: resolvedOptions.slotMinTime,
          slotMaxTime: resolvedOptions.slotMaxTime,
          now,
        });
      case 'list':
        return buildListViewModel({
          currentDate,
          timeZone,
          occurrences,
          listDays: resolvedOptions.listDays,
          now,
        });
      case 'year':
        return buildYearViewModel({
          currentDate,
          timeZone,
          occurrences,
          weekStartsOn: resolvedOptions.weekStartsOn,
          now,
        });
      case 'multiMonth':
        return buildMultiMonthViewModel({
          currentDate,
          timeZone,
          occurrences,
          weekStartsOn: resolvedOptions.weekStartsOn,
          dayMaxEvents: resolvedOptions.dayMaxEvents,
          hiddenWeekdays: resolvedOptions.hiddenWeekdays,
          multiMonthCount: resolvedOptions.multiMonthCount,
          now,
        });
      case 'resource':
        return buildResourceViewModel({
          currentDate,
          timeZone,
          occurrences,
          resources,
          unassignedLane: resolvedOptions.unassignedLane,
          slotMinutes: resolvedOptions.slotMinutes,
          locale: resolvedOptions.locale,
          businessHours: resolvedOptions.businessHours,
          slotMinTime: resolvedOptions.slotMinTime,
          slotMaxTime: resolvedOptions.slotMaxTime,
          resourceViewDays: resolvedOptions.resourceViewDays,
          now,
          collapsedResourceIds,
        });
      case 'timeline':
        return buildTimelineViewModel({
          currentDate,
          timeZone,
          occurrences,
          resources,
          unassignedLane: resolvedOptions.unassignedLane,
          timelineDays: resolvedOptions.timelineDays,
          slotMinutes: resolvedOptions.slotMinutes,
          locale: resolvedOptions.locale,
          timelineScale: resolvedOptions.timelineScale,
          weekStartsOn: resolvedOptions.weekStartsOn,
          businessHours: resolvedOptions.businessHours,
          now,
          collapsedResourceIds,
        });
    }
  }

  // 作成直後に 1 回発火する（FullCalendar の datesSet が初期レンダーでも呼ばれるのに合わせる）。
  notifyRangeChangeIfNeeded();

  return {
    getState(): CalendarState {
      if (stateCache === null) {
        stateCache = {
          view,
          // 公開境界での複製。呼び出し側が戻り値の currentDate を変更しても
          // 内部状態に影響しないようにする（このオブジェクト自体は状態が
          // 変わるまでキャッシュされ、同一参照を返し続ける）。
          currentDate: new Date(currentDate.getTime()),
          timeZone,
          events,
          resources,
          dragPreview,
          collapsedResourceIds,
          options: resolvedOptions,
        };
      }
      return stateCache;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // --- ナビゲーション ---

    setView(next: CalendarViewType): void {
      assertViewType(next);
      if (next === view) {
        return;
      }
      view = next;
      commit(true);
    },

    next(): void {
      currentDate = navigateDate(view, currentDate, 1, timeZone, {
        listDays: resolvedOptions.listDays,
        multiMonthCount: resolvedOptions.multiMonthCount,
        timelineDays: resolvedOptions.timelineDays,
        resourceViewDays: resolvedOptions.resourceViewDays,
      });
      commit(true);
    },

    prev(): void {
      currentDate = navigateDate(view, currentDate, -1, timeZone, {
        listDays: resolvedOptions.listDays,
        multiMonthCount: resolvedOptions.multiMonthCount,
        timelineDays: resolvedOptions.timelineDays,
        resourceViewDays: resolvedOptions.resourceViewDays,
      });
      commit(true);
    },

    today(): void {
      // now() の戻り値は呼び出しごとに同一の Date インスタンスであり得るため複製する
      currentDate = new Date(resolvedOptions.now().getTime());
      commit(true);
    },

    goTo(date: Date): void {
      assertValidDate(date);
      if (date.getTime() === currentDate.getTime()) {
        return;
      }
      // 引数の Date をそのまま保持せず複製する（事後の外部変更から保護するため）
      currentDate = new Date(date.getTime());
      commit(true);
    },

    setTimeZone(next: TimeZoneId): void {
      assertTimeZone(next);
      if (next === timeZone) {
        return;
      }
      timeZone = next;
      commit(true);
    },

    updateOptions(patch: CalendarOptionsPatch): void {
      // 更新の原子性を保つため、いずれかのフィールドをミューテートする前に
      // すべてのバリデーションを完了させる（resolveOptions は timeAxisZones を検証する）。
      if (patch.timeZone !== undefined && patch.timeZone !== timeZone) {
        assertTimeZone(patch.timeZone);
      }
      const nextResolved = resolveOptions(patch, resolvedOptions);

      let changed = false;
      if (patch.timeZone !== undefined && patch.timeZone !== timeZone) {
        timeZone = patch.timeZone;
        changed = true;
      }
      if (
        patch.events !== undefined &&
        patch.events !== events &&
        patch.events !== lastEventsInput
      ) {
        lastEventsInput = patch.events;
        events = [...patch.events];
        changed = true;
      }
      if (
        patch.resources !== undefined &&
        patch.resources !== resources &&
        patch.resources !== lastResourcesInput
      ) {
        lastResourcesInput = patch.resources;
        resources = [...patch.resources];
        changed = true;
      }
      if (patch.onEventsChange !== undefined) {
        // コールバックの差し替えは state スナップショットに影響しないため通知しない。
        // null は「解除」を意味するため内部表現の undefined へ落とす。
        onEventsChange = patch.onEventsChange === null ? undefined : patch.onEventsChange;
      }
      if (patch.onRangeChange !== undefined) {
        // 同上。差し替え自体では発火せず、以後の実際の変更で新しいコールバックが呼ばれる
        onRangeChange = patch.onRangeChange === null ? undefined : patch.onRangeChange;
      }
      if (!resolvedOptionsEqual(nextResolved, resolvedOptions)) {
        resolvedOptions = nextResolved;
        changed = true;
      }
      if (changed) {
        commit(true);
      }
    },

    refresh(): void {
      // 状態は変えず、ビューモデルキャッシュを破棄して通知する。
      // 再構築時に now() が再評価され、「今日」判定と現在時刻線が最新になる
      commit(true);
    },

    notifyRangeChange(): void {
      // notifyRangeChangeIfNeeded と異なり、差分の有無に関わらず常に比較基準を
      // 更新し、登録済みなら必ず通知する（React 層がマウント後に初期通知するために使う）。
      const range = getVisibleRange();
      lastNotifiedRange = computeRangeSnapshot(range);
      emitRangeChange(range);
    },

    // --- イベント CRUD ---

    getEvents(): readonly CalendarEvent[] {
      return events;
    },

    setEvents(next: readonly CalendarEvent[]): void {
      // next が「現在の内部配列」または「直近に受け取った入力参照」と同じなら no-op。
      // 呼び出し側の配列参照をそのまま保持せず浅く複製するため、この 2 系統の
      // 比較を両方行わないと、複製後の再代入のたびに毎回変更扱いになってしまう。
      if (next === events || next === lastEventsInput) {
        return;
      }
      // 外部同期の入口なので onEventsChange は呼ばない（呼び出しの循環防止）
      lastEventsInput = next;
      events = [...next];
      commit(true);
    },

    // --- リソース ---

    getResources(): readonly CalendarResource[] {
      return resources;
    },

    setResources(next: readonly CalendarResource[]): void {
      if (next === resources || next === lastResourcesInput) {
        return;
      }
      // ID 重複の除外などの正規化は行わない（events と同じ扱い）。
      // 重複 ID はビュービルダーが先勝ちで決定論的に処理し、
      // 開発ビルドの警告は React 層の責務とする
      lastResourcesInput = next;
      resources = [...next];
      commit(true);
    },

    createEvent(input: CalendarEventInput): CalendarEvent {
      const result = createEventIn(events, input, mutationContext());
      applyEventsChange(result.events);
      return result.created;
    },

    updateEvent(
      id: EventId,
      patch: CalendarEventPatch,
      target?: { occurrenceStart: Date; scope: RecurringTarget['scope'] },
    ): readonly EventChangeEntry[] {
      const result = updateEventInWithChanges(events, id, patch, target, mutationContext());
      applyEventsChange(result.events);
      return result.changes;
    },

    deleteEvent(
      id: EventId,
      target?: { occurrenceStart: Date; scope: RecurringTarget['scope'] },
    ): readonly EventChangeEntry[] {
      const result = deleteEventInWithChanges(events, id, target, mutationContext());
      applyEventsChange(result.events);
      return result.changes;
    },

    // --- ビューモデル ---

    getViewModel(): CalendarViewModel {
      if (viewModelCache === null) {
        viewModelCache = buildViewModel();
      }
      return viewModelCache;
    },

    getVisibleRange,
    getOccurrences,

    // --- ドラッグプレビュー ---

    setDragPreview(preview: DragPreview | null): void {
      if (preview === dragPreview) {
        return;
      }
      dragPreview = preview;
      // プレビューはビューモデルに影響しない（オーバーレイ描画用）
      commit(false);
    },

    // --- リソースの階層グルーピング ---

    toggleResourceCollapsed(resourceId: string): void {
      const next = new Set(collapsedResourceIds);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      collapsedResourceIds = next;
      // リソース/タイムラインビューモデルの列・行構成に影響するため、キャッシュを破棄する
      commit(true);
    },
  };
}
