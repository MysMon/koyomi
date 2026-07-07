/**
 * @packageDocumentation
 * カレンダーエンジン（フレームワーク非依存）。
 *
 * カレンダーの状態（ビュー・基準日・タイムゾーン・イベント・ドラッグプレビュー）を
 * 保持し、購読モデルで変更を通知する。React からは `useCalendar` フックが
 * `useSyncExternalStore` でこのエンジンを購読する。
 *
 * 状態の変更操作は {@link ../mutations} の純粋関数に委譲し、
 * ビューモデルの構築は {@link ../views} の各ビルダーに委譲する。
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
} from './types';
import { buildListViewModel } from './views/list-view';
import { buildMonthViewModel } from './views/month-view';
import { buildTimeGridViewModel } from './views/time-grid-view';

/** 解決済みオプションの既定値。 */
const DEFAULT_OPTIONS: Omit<ResolvedCalendarOptions, 'now'> = {
  weekStartsOn: 0,
  dayMaxEvents: 4,
  snapMinutes: 15,
  slotMinutes: 60,
  defaultEventMinutes: 60,
  listDays: 30,
  locale: 'ja',
};

/** 自動採番 ID のプレフィックス。 */
const ID_PREFIX = 'koyomi-';

/**
 * `CalendarOptions` から解決済みオプションを構築する。
 * 未指定のフィールドには既定値を適用する。
 */
function resolveOptions(
  options: CalendarOptions | undefined,
  base?: ResolvedCalendarOptions,
): ResolvedCalendarOptions {
  const current = base ?? { ...DEFAULT_OPTIONS, now: () => new Date() };
  return {
    weekStartsOn: options?.weekStartsOn ?? current.weekStartsOn,
    dayMaxEvents: options?.dayMaxEvents ?? current.dayMaxEvents,
    snapMinutes: options?.snapMinutes ?? current.snapMinutes,
    slotMinutes: options?.slotMinutes ?? current.slotMinutes,
    defaultEventMinutes: options?.defaultEventMinutes ?? current.defaultEventMinutes,
    listDays: options?.listDays ?? current.listDays,
    locale: options?.locale ?? current.locale,
    now: options?.now ?? current.now,
  };
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
 *   オブジェクト参照を返す（`useSyncExternalStore` との整合のため）
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
      });
      commit(true);
    },

    prev(): void {
      currentDate = navigateDate(view, currentDate, -1, timeZone, {
        listDays: resolvedOptions.listDays,
      });
      commit(true);
    },

    today(): void {
      currentDate = resolvedOptions.now();
      commit(true);
    },

    goTo(date: Date): void {
      assertValidDate(date);
      currentDate = date;
      commit(true);
    },

    setTimeZone(next: TimeZoneId): void {
      assertTimeZone(next);
      timeZone = next;
      commit(true);
    },

    updateOptions(patch: Partial<CalendarOptions>): void {
      if (patch.timeZone !== undefined) {
        assertTimeZone(patch.timeZone);
        timeZone = patch.timeZone;
      }
      if (patch.events !== undefined) {
        events = patch.events;
      }
      if (patch.onEventsChange !== undefined) {
        onEventsChange = patch.onEventsChange;
      }
      resolvedOptions = resolveOptions(patch, resolvedOptions);
      commit(true);
    },

    // --- イベント CRUD ---

    getEvents(): readonly CalendarEvent[] {
      return events;
    },

    setEvents(next: readonly CalendarEvent[]): void {
      // 外部同期の入口なので onEventsChange は呼ばない（エコーループ防止）
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
      dragPreview = preview;
      // プレビューはビューモデルに影響しない（オーバーレイ描画用）
      commit(false);
    },
  };
}
