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
import { createEventIn, deleteEventIn, updateEventIn } from './mutations';
import { getLocalTimeZone, isValidTimeZone } from './timezone';
import type {
  CalendarApi,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarOptions,
  CalendarState,
  CalendarViewModel,
  CalendarViewType,
  DateRange,
  DragPreview,
  EventId,
  EventOccurrence,
  ResolvedCalendarOptions,
  TimeZoneId,
  Weekday,
} from './types';
import { buildListViewModel } from './views/list-view';
import { buildMonthViewModel } from './views/month-view';
import { buildMultiMonthViewModel } from './views/multi-month-view';
import { buildTimeGridViewModel } from './views/time-grid-view';
import { buildYearViewModel } from './views/year-view';

/** 解決済みオプションの既定値。 */
const DEFAULT_OPTIONS: Omit<ResolvedCalendarOptions, 'now'> = {
  weekStartsOn: 0,
  dayMaxEvents: 4,
  snapMinutes: 15,
  slotMinutes: 60,
  defaultEventMinutes: 60,
  defaultEventTitle: '(タイトルなし)',
  listDays: 30,
  multiMonthCount: 3,
  locale: 'ja',
  hiddenWeekdays: [],
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
 */
function resolveOptions(
  options: CalendarOptions | undefined,
  base?: ResolvedCalendarOptions,
): ResolvedCalendarOptions {
  const current = base ?? { ...DEFAULT_OPTIONS, now: () => new Date() };
  return {
    weekStartsOn: options?.weekStartsOn ?? current.weekStartsOn,
    dayMaxEvents: normalizePositiveInt(options?.dayMaxEvents ?? current.dayMaxEvents, 1),
    snapMinutes: normalizePositiveInt(options?.snapMinutes ?? current.snapMinutes, 1),
    slotMinutes: normalizePositiveInt(options?.slotMinutes ?? current.slotMinutes, 1),
    defaultEventMinutes: normalizePositiveInt(
      options?.defaultEventMinutes ?? current.defaultEventMinutes,
      1,
    ),
    defaultEventTitle: options?.defaultEventTitle ?? current.defaultEventTitle,
    listDays: normalizePositiveInt(options?.listDays ?? current.listDays, 1),
    multiMonthCount: normalizePositiveInt(options?.multiMonthCount ?? current.multiMonthCount, 1),
    locale: options?.locale ?? current.locale,
    hiddenWeekdays:
      options?.hiddenWeekdays !== undefined
        ? normalizeHiddenWeekdays(options.hiddenWeekdays)
        : current.hiddenWeekdays,
    now: options?.now ?? current.now,
  };
}

/**
 * 解決済みオプション同士を浅く比較する。
 * `hiddenWeekdays` は配列の中身（順序込み）で比較する。
 */
function resolvedOptionsEqual(a: ResolvedCalendarOptions, b: ResolvedCalendarOptions): boolean {
  return (
    a.weekStartsOn === b.weekStartsOn &&
    a.dayMaxEvents === b.dayMaxEvents &&
    a.snapMinutes === b.snapMinutes &&
    a.slotMinutes === b.slotMinutes &&
    a.defaultEventMinutes === b.defaultEventMinutes &&
    a.defaultEventTitle === b.defaultEventTitle &&
    a.listDays === b.listDays &&
    a.multiMonthCount === b.multiMonthCount &&
    a.locale === b.locale &&
    a.now === b.now &&
    a.hiddenWeekdays.length === b.hiddenWeekdays.length &&
    a.hiddenWeekdays.every((weekday, index) => weekday === b.hiddenWeekdays[index])
  );
}

/** タイムゾーンを検証し、不正なら例外を投げる。 */
function assertTimeZone(timeZone: TimeZoneId): void {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`不正なタイムゾーンです: '${timeZone}'`);
  }
}

/** 日付を検証し、無効（NaN）なら例外を投げる。 */
function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error('無効な日付です');
  }
}

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
export function createCalendar(options?: CalendarOptions): CalendarApi {
  let resolvedOptions = resolveOptions(options);
  let view: CalendarViewType = options?.initialView ?? 'month';
  let currentDate: Date = options?.initialDate ?? resolvedOptions.now();
  let timeZone: TimeZoneId = options?.timeZone ?? getLocalTimeZone();
  let events: readonly CalendarEvent[] = options?.events ?? [];
  let dragPreview: DragPreview | null = null;
  let onEventsChange = options?.onEventsChange;

  assertTimeZone(timeZone);
  assertValidDate(currentDate);

  const listeners = new Set<() => void>();
  /** getState 用のスナップショットキャッシュ。 */
  let stateCache: CalendarState | null = null;
  /** getViewModel 用のキャッシュ。 */
  let viewModelCache: CalendarViewModel | null = null;
  /** ID 自動採番のカウンタ。 */
  let idCounter = 0;

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
    commit(true);
    onEventsChange?.(events);
  }

  function getVisibleRange(): DateRange {
    return visibleRangeFor(view, currentDate, timeZone, {
      weekStartsOn: resolvedOptions.weekStartsOn,
      listDays: resolvedOptions.listDays,
      multiMonthCount: resolvedOptions.multiMonthCount,
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
          hiddenWeekdays: resolvedOptions.hiddenWeekdays,
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
    }
  }

  return {
    getState(): CalendarState {
      if (stateCache === null) {
        stateCache = {
          view,
          currentDate,
          timeZone,
          events,
          dragPreview,
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
      });
      commit(true);
    },

    prev(): void {
      currentDate = navigateDate(view, currentDate, -1, timeZone, {
        listDays: resolvedOptions.listDays,
        multiMonthCount: resolvedOptions.multiMonthCount,
      });
      commit(true);
    },

    today(): void {
      currentDate = resolvedOptions.now();
      commit(true);
    },

    goTo(date: Date): void {
      assertValidDate(date);
      if (date.getTime() === currentDate.getTime()) {
        return;
      }
      currentDate = date;
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

    updateOptions(patch: Partial<Omit<CalendarOptions, 'initialView' | 'initialDate'>>): void {
      let changed = false;
      if (patch.timeZone !== undefined && patch.timeZone !== timeZone) {
        assertTimeZone(patch.timeZone);
        timeZone = patch.timeZone;
        changed = true;
      }
      if (patch.events !== undefined && patch.events !== events) {
        events = patch.events;
        changed = true;
      }
      if (patch.onEventsChange !== undefined) {
        // コールバックの差し替えは state スナップショットに影響しないため通知しない
        onEventsChange = patch.onEventsChange;
      }
      const nextResolved = resolveOptions(patch, resolvedOptions);
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

    // --- イベント CRUD ---

    getEvents(): readonly CalendarEvent[] {
      return events;
    },

    setEvents(next: readonly CalendarEvent[]): void {
      if (next === events) {
        return;
      }
      // 外部同期の入口なので onEventsChange は呼ばない（呼び出しの循環防止）
      events = next;
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
    ): void {
      applyEventsChange(updateEventIn(events, id, patch, target, mutationContext()));
    },

    deleteEvent(
      id: EventId,
      target?: { occurrenceStart: Date; scope: RecurringTarget['scope'] },
    ): void {
      applyEventsChange(deleteEventIn(events, id, target, mutationContext()));
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
  };
}
