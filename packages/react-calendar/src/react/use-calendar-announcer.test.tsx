/**
 * @packageDocumentation
 * `useCalendarAnnouncer` のテスト。
 *
 * `calendar` は `useCalendarHistory` のテストと同じ方針で、多くのケースで
 * `createCalendar` を直接使った `UseCalendarResult` 相当のオブジェクトを渡す
 * （announcer は `calendar.api` / `calendar.state` のみを参照するため、
 * `useCalendar` 経由の購読は不要）。
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import type {
  CalendarEvent,
  CalendarRangeChangeInfo,
  CalendarResource,
  CalendarViewType,
  EventOccurrence,
} from '../core/types';
import { formatViewTitle } from './components/format';
import type { RangeSelection } from './types';
import type {
  AnnouncerFormatterContext,
  AnnouncerMessages,
  UseCalendarAnnouncerOptions,
} from './use-calendar-announcer';
import { useCalendarAnnouncer } from './use-calendar-announcer';

/** announce の連続通知対策が付与する不可視トークン（U+2060 WORD JOINER）。 */
const REPEAT_TOKEN_FOR_TEST = '⁠';

/** `createCalendar` を直接使った `UseCalendarResult` 相当のオブジェクトを作る。 */
function makeCalendar(
  options?: Parameters<typeof createCalendar>[0],
): UseCalendarAnnouncerOptions['calendar'] {
  const api = createCalendar({ timeZone: 'Asia/Tokyo', locale: 'ja', ...options });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

/** テスト用の最小限のオカレンス。 */
function makeOccurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  const start = new Date('2026-07-15T01:00:00Z'); // 東京 10:00
  const end = new Date('2026-07-15T02:00:00Z'); // 東京 11:00
  const event: CalendarEvent = { id: 'e1', title: '会議', start, end };
  return {
    key: `e1@${start.toISOString()}`,
    eventId: 'e1',
    event,
    start,
    end,
    allDay: false,
    isRecurring: false,
    originalStart: start,
    ...overrides,
  };
}

describe('useCalendarAnnouncer', () => {
  describe('liveRegionProps / message の初期値', () => {
    it('既定（politeness 省略）では role="status"・aria-live="polite" になり、message は空文字列', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      expect(result.current.liveRegionProps).toEqual({
        'data-koyomi': 'live-region',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      });
      expect(result.current.message).toBe('');
    });

    it('politeness: "assertive" 指定時は role="alert"・aria-live="assertive" になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, politeness: 'assertive' }),
      );

      expect(result.current.liveRegionProps).toEqual({
        'data-koyomi': 'live-region',
        role: 'alert',
        'aria-live': 'assertive',
        'aria-atomic': 'true',
      });
    });
  });

  describe('announce（同一文言の連続通知対策）', () => {
    it('同じ文言を連続で announce すると、末尾の不可視トークンが交互に付き差分が生まれる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      act(() => result.current.announce('x'));
      const first = result.current.message;
      expect(first).toBe('x');

      act(() => result.current.announce('x'));
      const second = result.current.message;
      expect(second).not.toBe(first);
      expect(second.replaceAll(REPEAT_TOKEN_FOR_TEST, '')).toBe('x');

      act(() => result.current.announce('x'));
      const third = result.current.message;
      expect(third).not.toBe(second);
      expect(third).toBe(first); // トークンが外れて元の文字列に戻る

      act(() => result.current.announce('y'));
      expect(result.current.message).toBe('y'); // 文言が変わればトークンなし
    });
  });

  describe('wrapCallbacks - onEventChange', () => {
    it('announce.eventChange の切替は、wrapCallbacks を呼び直さなくても次の呼び出しから反映される', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(
        ({ eventChange }: { eventChange: boolean }) =>
          useCalendarAnnouncer({ calendar, announce: { eventChange } }),
        { initialProps: { eventChange: true } },
      );

      // eventChange: true の時点で構築したラップ関数をそのまま使い続ける
      const wrapped = result.current.wrapCallbacks({});
      const change = {
        occurrence: makeOccurrence(),
        newRange: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
        scope: null,
        changes: [],
      };

      act(() => {
        wrapped.onEventChange?.(change);
      });
      expect(result.current.message).not.toBe('');

      // ミュートに切り替える（callbacks は不変のため wrapCallbacks は呼び直されない想定）
      rerender({ eventChange: false });
      const messageBefore = result.current.message;
      act(() => {
        wrapped.onEventChange?.({
          ...change,
          newRange: {
            start: new Date('2026-07-16T03:00:00Z'),
            end: new Date('2026-07-16T04:00:00Z'),
          },
        });
      });
      expect(result.current.message).toBe(messageBefore); // 新しい announce は発生しない
    });

    it('announce.eventDelete の切替も、wrapCallbacks を呼び直さなくても次の呼び出しから反映される', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(
        ({ eventDelete }: { eventDelete: boolean }) =>
          useCalendarAnnouncer({ calendar, announce: { eventDelete } }),
        { initialProps: { eventDelete: false } },
      );

      // ミュート時点で構築したラップ関数でも、ミュート解除後は announce される
      const wrapped = result.current.wrapCallbacks({});
      rerender({ eventDelete: true });
      act(() => {
        wrapped.onEventDelete?.({ occurrence: makeOccurrence(), scope: null, changes: [] });
      });
      expect(result.current.message).toBe('会議 を削除しました');
    });

    it('元の onEventChange が先に呼ばれた後、既定の日本語文言（移動）で announce される', () => {
      const calendar = makeCalendar();
      const onEventChange = vi.fn();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      let messageWhenOriginalCalled: string | undefined;
      onEventChange.mockImplementation(() => {
        messageWhenOriginalCalled = result.current.message;
      });

      const occurrence = makeOccurrence();
      const wrapped = result.current.wrapCallbacks({ onEventChange });

      act(() => {
        wrapped.onEventChange?.({
          occurrence,
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'), // 東京 7/16 10:00
            end: new Date('2026-07-16T02:00:00Z'), // 東京 7/16 11:00
          },
          allDay: false,
          scope: null,
          changes: [],
        });
      });

      expect(onEventChange).toHaveBeenCalledTimes(1);
      expect(messageWhenOriginalCalled).toBe(''); // announce はまだ発生していない
      expect(result.current.message).toBe('会議 を 7月16日 10:00〜11:00 に移動しました');
    });

    it('duration が変わる変更（リサイズ）は「サイズ変更」の文言になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange: {
            start: new Date('2026-07-15T01:00:00Z'), // 東京 10:00（開始不変）
            end: new Date('2026-07-15T02:30:00Z'), // 東京 11:30（60分→90分）
          },
          allDay: false,
          scope: null,
          changes: [],
        });
      });

      expect(result.current.message).toBe('会議 を 7月15日 10:00〜11:30 にサイズ変更しました');
    });

    it('allDay が変化した変更（終日化）は「終日予定に変更」の文言になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence({ allDay: false }),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T15:00:00Z'), // 東京 7/16 0:00〜7/17 0:00（終日1日分）
          },
          allDay: true,
          scope: null,
          changes: [],
        });
      });

      expect(result.current.message).toBe('会議 を 7月16日 に終日予定に変更しました');
    });

    it('allDay が変化した変更（時間指定化）は「時間指定予定に変更」の文言になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence({ allDay: true }),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'), // 東京 10:00
            end: new Date('2026-07-16T02:00:00Z'), // 東京 11:00
          },
          allDay: false,
          scope: null,
          changes: [],
        });
      });

      expect(result.current.message).toBe(
        '会議 を 7月16日 10:00〜11:00 に時間指定予定に変更しました',
      );
    });

    it('resourceId が変更されたリソース名を解決できるときはリソース名を、できないときは「未割り当て」を含める', () => {
      const resources: CalendarResource[] = [{ id: 'r1', title: '会議室A' }];
      const calendar = makeCalendar({ resources });
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});
      const newRange = {
        start: new Date('2026-07-16T01:00:00Z'),
        end: new Date('2026-07-16T02:00:00Z'),
      };

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange,
          allDay: false,
          scope: null,
          resourceId: 'r1',
          changes: [],
        });
      });
      expect(result.current.message).toBe('会議 を 7月16日 10:00〜11:00 に移動しました（会議室A）');

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange,
          allDay: false,
          scope: null,
          resourceId: null,
          changes: [],
        });
      });
      expect(result.current.message).toBe(
        '会議 を 7月16日 10:00〜11:00 に移動しました（未割り当て）',
      );

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange,
          allDay: false,
          scope: null,
          resourceId: 'no-such-resource',
          changes: [],
        });
      });
      // 直前（resourceId: null）と文言が同一（どちらも「未割り当て」）のため、
      // 連続通知対策の不可視トークンが付く（トークンを除けば同じ文言）
      expect(result.current.message.replace(REPEAT_TOKEN_FOR_TEST, '')).toBe(
        '会議 を 7月16日 10:00〜11:00 に移動しました（未割り当て）',
      );
    });

    it('resourceId 省略時（リソース対象外ビュー）はリソースの付記をしない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          scope: null,
          changes: [],
        });
      });

      expect(result.current.message).toBe('会議 を 7月16日 10:00〜11:00 に移動しました');
    });

    it('繰り返しスコープ操作で changes に複数件含まれても、対象オカレンス1件分の要約のみになる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          scope: 'thisAndFollowing',
          changes: [
            { before: makeOccurrence().event, after: { ...makeOccurrence().event, id: 'e1' } },
            { after: { ...makeOccurrence().event, id: 'e2' } },
            { after: { ...makeOccurrence().event, id: 'e3' } },
          ],
        });
      });

      expect(result.current.message).toBe('会議 を 7月16日 10:00〜11:00 に移動しました');
    });

    it('announce: { eventChange: false } を渡すと announce されないが元コールバックは呼ばれる', () => {
      const calendar = makeCalendar();
      const onEventChange = vi.fn();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { eventChange: false } }),
      );
      const wrapped = result.current.wrapCallbacks({ onEventChange });

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          scope: null,
          changes: [],
        });
      });

      expect(onEventChange).toHaveBeenCalledTimes(1);
      expect(result.current.message).toBe('');
    });
  });

  describe('wrapCallbacks - onSelectRange（既定即時作成）', () => {
    it('callbacks.onSelectRange が指定済みの場合、それが呼ばれるだけで createEvent も announce も発生しない', () => {
      const calendar = makeCalendar();
      const onSelectRange = vi.fn();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({ onSelectRange });
      const selection = {
        range: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
      };

      act(() => {
        wrapped.onSelectRange?.(selection);
      });

      expect(onSelectRange).toHaveBeenCalledWith(selection);
      expect(calendar.api.getEvents()).toHaveLength(0);
      expect(result.current.message).toBe('');
    });

    it('callbacks.onSelectRange が未指定の場合、既定即時作成を代行し「作成しました」で announce する', () => {
      const calendar = makeCalendar({ defaultEventTitle: '(タイトルなし)' });
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onSelectRange?.({
          range: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
        });
      });

      const events = calendar.api.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        title: '(タイトルなし)',
        start: new Date('2026-07-16T01:00:00Z'),
        end: new Date('2026-07-16T02:00:00Z'),
      });
      expect(events[0]?.resourceId).toBeUndefined();
      expect(result.current.message).toBe('(タイトルなし) を 7月16日 10:00〜11:00 に作成しました');
    });

    it('selection.resourceId が null のときは createEvent に resourceId キー自体を渡さない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onSelectRange?.({
          range: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          resourceId: null,
        });
      });

      const events = calendar.api.getEvents();
      expect(events[0]?.resourceId).toBeUndefined();
      expect(result.current.message).toContain('（未割り当て）');
    });

    it('selection.resourceId が文字列のときは createEvent に resourceId を渡し、リソース名で announce する', () => {
      const resources: CalendarResource[] = [{ id: 'r1', title: '会議室A' }];
      const calendar = makeCalendar({ resources });
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onSelectRange?.({
          range: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          resourceId: 'r1',
        });
      });

      const events = calendar.api.getEvents();
      expect(events[0]?.resourceId).toBe('r1');
      expect(result.current.message).toContain('（会議室A）');
    });

    it('allDay: true の選択では作成イベントにも allDay: true を付与する', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onSelectRange?.({
          range: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T15:00:00Z'),
          },
          allDay: true,
        });
      });

      expect(calendar.api.getEvents()[0]?.allDay).toBe(true);
      expect(result.current.message).toBe('(タイトルなし) を 7月16日 に作成しました');
    });

    it('announce: { eventCreate: false } を渡すと既定即時作成は行われるが announce されない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { eventCreate: false } }),
      );
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onSelectRange?.({
          range: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
        });
      });

      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(result.current.message).toBe('');
    });
  });

  describe('wrapCallbacks - onEventDelete', () => {
    it.each([
      [null, '会議 を削除しました'],
      ['this', '会議 を削除しました（この予定のみ）'],
      ['thisAndFollowing', '会議 を削除しました（これ以降のすべての予定）'],
      ['all', '会議 を削除しました（すべての予定）'],
    ] as const)('scope=%s の既定文言になる', (scope, expected) => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onEventDelete?.({ occurrence: makeOccurrence(), scope, changes: [] });
      });

      expect(result.current.message).toBe(expected);
    });

    it('元の onEventDelete が呼ばれる。announce: { eventDelete: false } なら announce されない', () => {
      const calendar = makeCalendar();
      const onEventDelete = vi.fn();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { eventDelete: false } }),
      );
      const wrapped = result.current.wrapCallbacks({ onEventDelete });

      act(() => {
        wrapped.onEventDelete?.({ occurrence: makeOccurrence(), scope: null, changes: [] });
      });

      expect(onEventDelete).toHaveBeenCalledTimes(1);
      expect(result.current.message).toBe('');
    });
  });

  describe('wrapCallbacks - 関与しないキーの素通し', () => {
    it('onEventClick 等は元の callbacks と同一参照のまま返す', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      const onEventClick = vi.fn();
      const onBeforeEventChange = vi.fn();
      const onBeforeSelectRange = vi.fn();
      const onBeforeEventDelete = vi.fn();
      const resolveRecurringScope = vi.fn();
      const onError = vi.fn();

      const wrapped = result.current.wrapCallbacks({
        onEventClick,
        onBeforeEventChange,
        onBeforeSelectRange,
        onBeforeEventDelete,
        resolveRecurringScope,
        onError,
      });

      expect(wrapped.onEventClick).toBe(onEventClick);
      expect(wrapped.onBeforeEventChange).toBe(onBeforeEventChange);
      expect(wrapped.onBeforeSelectRange).toBe(onBeforeSelectRange);
      expect(wrapped.onBeforeEventDelete).toBe(onBeforeEventDelete);
      expect(wrapped.resolveRecurringScope).toBe(resolveRecurringScope);
      expect(wrapped.onError).toBe(onError);
    });

    it('callbacks 省略時は onEventChange/onEventDelete/onSelectRange 以外のキーを持たない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      const wrapped = result.current.wrapCallbacks();

      expect(Object.keys(wrapped).sort()).toEqual(
        ['onEventChange', 'onEventDelete', 'onSelectRange'].sort(),
      );
    });
  });

  describe('wrapRangeChange', () => {
    const VIEWS_WITH_RANGES: readonly {
      view: CalendarViewType;
      currentDate: Date;
      rangeStart: Date;
      rangeEnd: Date;
    }[] = [
      {
        view: 'month',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-06-30T15:00:00Z'),
        rangeEnd: new Date('2026-07-31T15:00:00Z'),
      },
      {
        view: 'week',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-07-11T15:00:00Z'),
        rangeEnd: new Date('2026-07-18T15:00:00Z'),
      },
      {
        view: 'day',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-07-14T15:00:00Z'),
        rangeEnd: new Date('2026-07-15T15:00:00Z'),
      },
      {
        view: 'list',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-07-14T15:00:00Z'),
        rangeEnd: new Date('2026-08-13T15:00:00Z'),
      },
      {
        view: 'year',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2025-12-31T15:00:00Z'),
        rangeEnd: new Date('2026-12-31T15:00:00Z'),
      },
      {
        view: 'multiMonth',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-06-30T15:00:00Z'),
        rangeEnd: new Date('2026-09-30T15:00:00Z'),
      },
      {
        view: 'resource',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-07-14T15:00:00Z'),
        rangeEnd: new Date('2026-07-15T15:00:00Z'),
      },
      {
        view: 'timeline',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-07-14T15:00:00Z'),
        rangeEnd: new Date('2026-07-15T15:00:00Z'),
      },
    ];

    it.each(
      VIEWS_WITH_RANGES,
    )('view=$view で formatViewTitle 相当の期間タイトルを含む既定文言で announce される', ({
      view,
      currentDate,
      rangeStart,
      rangeEnd,
    }) => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const handler = result.current.wrapRangeChange();
      const title = formatViewTitle(
        view,
        currentDate,
        { start: rangeStart, end: rangeEnd },
        'Asia/Tokyo',
        'ja',
      );

      act(() => {
        handler({ view, currentDate, rangeStart, rangeEnd });
      });

      expect(result.current.message).toBe(`表示を${title}に切り替えました`);
    });

    it('month ビューで具体的な文言（表示を2026年7月に切り替えました）になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const handler = result.current.wrapRangeChange();

      act(() => {
        handler({
          view: 'month',
          currentDate: new Date('2026-07-15T01:00:00Z'),
          rangeStart: new Date('2026-06-30T15:00:00Z'),
          rangeEnd: new Date('2026-07-31T15:00:00Z'),
        });
      });

      expect(result.current.message).toBe('表示を2026年7月に切り替えました');
    });

    it('userHandler が先に呼ばれ、その後 announce される', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const userHandler = vi.fn();
      let messageWhenUserHandlerCalled: string | undefined;
      userHandler.mockImplementation(() => {
        messageWhenUserHandlerCalled = result.current.message;
      });
      const handler = result.current.wrapRangeChange(userHandler);
      const info: CalendarRangeChangeInfo = {
        view: 'month',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-06-30T15:00:00Z'),
        rangeEnd: new Date('2026-07-31T15:00:00Z'),
      };

      act(() => {
        handler(info);
      });

      expect(userHandler).toHaveBeenCalledWith(info);
      expect(messageWhenUserHandlerCalled).toBe('');
      expect(result.current.message).toBe('表示を2026年7月に切り替えました');
    });
  });

  describe('messages によるカスタマイズ', () => {
    it('messages.eventChanged を指定すると、payload・既定文言・ctx が渡り、戻り値が announce される', () => {
      const resources: CalendarResource[] = [{ id: 'r1', title: '会議室A' }];
      const calendar = makeCalendar({ resources, locale: 'ja' });
      const eventChanged = vi.fn(() => 'カスタム文言');
      const messages: AnnouncerMessages = { eventChanged };
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar, messages }));
      const wrapped = result.current.wrapCallbacks({});
      const change = {
        occurrence: makeOccurrence(),
        newRange: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
        scope: null,
        changes: [],
      };

      act(() => {
        wrapped.onEventChange?.(change);
      });

      expect(eventChanged).toHaveBeenCalledWith(
        change,
        '会議 を 7月16日 10:00〜11:00 に移動しました',
        { timeZone: 'Asia/Tokyo', locale: 'ja', resources },
      );
      expect(result.current.message).toBe('カスタム文言');
    });

    it('messages.eventCreated を指定すると、event・selection・既定文言・ctx が渡る', () => {
      const calendar = makeCalendar();
      const eventCreated = vi.fn(
        (
          _event: CalendarEvent,
          _selection: RangeSelection,
          _defaultMessage: string,
          _ctx: AnnouncerFormatterContext,
        ) => 'カスタム作成文言',
      );
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, messages: { eventCreated } }),
      );
      const wrapped = result.current.wrapCallbacks({});
      const selection = {
        range: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
      };

      act(() => {
        wrapped.onSelectRange?.(selection);
      });

      expect(eventCreated).toHaveBeenCalledTimes(1);
      const call = eventCreated.mock.calls[0];
      if (call === undefined) {
        throw new Error('eventCreated が呼ばれていません');
      }
      const [createdArg, selectionArg, defaultMessageArg, ctxArg] = call;
      expect(createdArg.title).toBe('(タイトルなし)');
      expect(selectionArg).toBe(selection);
      expect(defaultMessageArg).toBe('(タイトルなし) を 7月16日 10:00〜11:00 に作成しました');
      expect(ctxArg).toEqual({ timeZone: 'Asia/Tokyo', locale: 'ja', resources: [] });
      expect(result.current.message).toBe('カスタム作成文言');
    });

    it('messages.eventDeleted を指定すると、deletion・既定文言・ctx が渡る', () => {
      const calendar = makeCalendar();
      const eventDeleted = vi.fn(() => 'カスタム削除文言');
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, messages: { eventDeleted } }),
      );
      const wrapped = result.current.wrapCallbacks({});
      const deletion = { occurrence: makeOccurrence(), scope: 'this' as const, changes: [] };

      act(() => {
        wrapped.onEventDelete?.(deletion);
      });

      expect(eventDeleted).toHaveBeenCalledWith(deletion, '会議 を削除しました（この予定のみ）', {
        timeZone: 'Asia/Tokyo',
        locale: 'ja',
        resources: [],
      });
      expect(result.current.message).toBe('カスタム削除文言');
    });

    it('messages.viewChanged を指定すると、info・既定文言・ctx が渡る', () => {
      const calendar = makeCalendar();
      const viewChanged = vi.fn(() => 'カスタム表示切替文言');
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, messages: { viewChanged } }),
      );
      const handler = result.current.wrapRangeChange();
      const info: CalendarRangeChangeInfo = {
        view: 'month',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-06-30T15:00:00Z'),
        rangeEnd: new Date('2026-07-31T15:00:00Z'),
      };

      act(() => {
        handler(info);
      });

      expect(viewChanged).toHaveBeenCalledWith(info, '表示を2026年7月に切り替えました', {
        timeZone: 'Asia/Tokyo',
        locale: 'ja',
        resources: [],
      });
      expect(result.current.message).toBe('カスタム表示切替文言');
    });
  });

  describe('calendar の最新値の参照', () => {
    it('locale / resources は announce 実行時点の最新値を参照する（生成時点でキャプチャしない）', () => {
      const calendar = makeCalendar({ locale: 'ja' });
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      calendar.api.setResources([{ id: 'r1', title: '会議室A' }]);
      calendar.api.updateOptions({ locale: 'en-US' });

      act(() => {
        wrapped.onEventChange?.({
          occurrence: makeOccurrence(),
          newRange: {
            start: new Date('2026-07-16T01:00:00Z'),
            end: new Date('2026-07-16T02:00:00Z'),
          },
          allDay: false,
          scope: null,
          resourceId: 'r1',
          changes: [],
        });
      });

      // locale が en-US になった後の Intl 整形（月名が英語）とリソース名解決の両方に反映される
      expect(result.current.message).toContain('July 16');
      expect(result.current.message).toContain('会議室A');
    });
  });

  describe('SSR', () => {
    it('renderToString 中に呼んでも例外にならず、liveRegionProps と空の message のみが描画される', () => {
      function ServerComponent(): ReactElement {
        const calendar = makeCalendar();
        const announcer = useCalendarAnnouncer({ calendar });
        return <div {...announcer.liveRegionProps}>{announcer.message}</div>;
      }

      const html = renderToString(<ServerComponent />);

      expect(html).toContain('data-koyomi="live-region"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('安定した関数参照', () => {
    it('wrapCallbacks / wrapRangeChange / announce は再レンダーを跨いで同一参照を保つ', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(() => useCalendarAnnouncer({ calendar }));

      const { wrapCallbacks, wrapRangeChange, announce } = result.current;
      rerender();

      expect(result.current.wrapCallbacks).toBe(wrapCallbacks);
      expect(result.current.wrapRangeChange).toBe(wrapRangeChange);
      expect(result.current.announce).toBe(announce);
    });
  });
});
