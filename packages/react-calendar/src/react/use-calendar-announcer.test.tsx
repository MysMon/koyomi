/**
 * @packageDocumentation
 * `useCalendarAnnouncer` のテスト。
 *
 * `calendar` は `useCalendarHistory` のテストと同じ方針で、多くのケースで
 * `createCalendar` を直接使った `UseCalendarResult` 相当のオブジェクトを渡す
 * （announcer は `calendar.api` / `calendar.state` のみを参照するため、
 * `useCalendar` 経由の購読は不要）。
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
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
import { ResourceView } from './components/resource-view';
import { TimeGridView } from './components/time-grid-view';
import { TimelineView } from './components/timeline-view';
import { CalendarProvider } from './context';
import { createDefaultEvent } from './drag-common';
import type { MessageCatalogOverrides } from './locales/types';
import type {
  CalendarInteractionCallbacks,
  OperationRejection,
  RangeSelection,
  UseCalendarResult,
} from './types';
import { useCalendar } from './use-calendar';
import type { UseCalendarAnnouncerOptions } from './use-calendar-announcer';
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

/**
 * `onSelectRange` 未指定時の既定即時作成を、ドラッグ系フックと同じ共通実装
 * （`createDefaultEvent`）で実行する。フックは作成の確定後に `callbacks.onEventCreate` を
 * 呼ぶため、`wrapCallbacks` の戻り値を渡すと作成の自動通知まで含めて再現できる。
 *
 * @param title - 作成するイベントのタイトル（各ビューが渡す `defaultEventTitle` に相当）
 */
function createByDefault(
  calendar: UseCalendarAnnouncerOptions['calendar'],
  callbacks: CalendarInteractionCallbacks,
  selection: RangeSelection,
  title?: string,
): void {
  createDefaultEvent(calendar.api, selection, title, callbacks);
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

    it('callbacks.onSelectRange が未指定の場合、onSelectRange は定義されず、既定即時作成の確定を「作成しました」で announce する', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});
      // 定義すると、ドラッグ系フックが「アプリが作成を引き受けた」と判断してしまう
      expect(wrapped.onSelectRange).toBeUndefined();

      act(() => {
        createByDefault(calendar, wrapped, {
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

    it('selection.resourceId が null のときは作成イベントに resourceId を付けず、未割り当てとして announce する', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        createByDefault(calendar, wrapped, {
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

    it('selection.resourceId が文字列のときは作成イベントに resourceId が付き、リソース名で announce する', () => {
      const resources: CalendarResource[] = [{ id: 'r1', title: '会議室A' }];
      const calendar = makeCalendar({ resources });
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        createByDefault(calendar, wrapped, {
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
        createByDefault(calendar, wrapped, {
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
        createByDefault(calendar, wrapped, {
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

    it('callbacks.onEventCreate が指定されている場合、既定即時作成の確定後に作成イベント・changes・selection 付きで呼ばれる', () => {
      const calendar = makeCalendar();
      const onEventCreate = vi.fn();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({ onEventCreate });
      const selection = {
        range: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
      };

      act(() => {
        createByDefault(calendar, wrapped, selection);
      });

      const events = calendar.api.getEvents();
      expect(events).toHaveLength(1);
      expect(onEventCreate).toHaveBeenCalledWith({
        event: events[0],
        changes: [{ after: events[0], index: 0 }],
        selection,
      });
    });

    it('callbacks.onSelectRange が指定済みの場合、onEventCreate は呼ばれない（既定即時作成自体が行われないため）', () => {
      const calendar = makeCalendar();
      const onSelectRange = vi.fn();
      const onEventCreate = vi.fn();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({ onSelectRange, onEventCreate });
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
      expect(onEventCreate).not.toHaveBeenCalled();
      expect(calendar.api.getEvents()).toHaveLength(0);
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

  describe('wrapCallbacks - onOperationRejected', () => {
    it('reason: "constraint"（occurrence あり）の既定文言になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onOperationRejected?.({
          action: 'move',
          reason: 'constraint',
          occurrence: makeOccurrence(),
        });
      });

      expect(result.current.message).toBe('会議の移動は配置の制約により行われませんでした');
    });

    it('reason: "rejected"（occurrence 省略・create）の既定文言になる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        wrapped.onOperationRejected?.({ action: 'create', reason: 'rejected' });
      });

      expect(result.current.message).toBe('作成は許可されなかったため行われませんでした');
    });

    it('元の onOperationRejected が呼ばれる。announce: { rejection: false } なら announce されない', () => {
      const calendar = makeCalendar();
      const onOperationRejected = vi.fn();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { rejection: false } }),
      );
      const wrapped = result.current.wrapCallbacks({ onOperationRejected });
      const rejection: OperationRejection = { action: 'delete', reason: 'rejected' };

      act(() => {
        wrapped.onOperationRejected?.(rejection);
      });

      expect(onOperationRejected).toHaveBeenCalledTimes(1);
      expect(onOperationRejected).toHaveBeenCalledWith(rejection);
      expect(result.current.message).toBe('');
    });

    it('announce.rejection の切替は、wrapCallbacks を呼び直さなくても次の呼び出しから反映される', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(
        ({ rejection }: { rejection: boolean }) =>
          useCalendarAnnouncer({ calendar, announce: { rejection } }),
        { initialProps: { rejection: false } },
      );

      const wrapped = result.current.wrapCallbacks({});
      rerender({ rejection: true });
      act(() => {
        wrapped.onOperationRejected?.({ action: 'create', reason: 'constraint' });
      });

      expect(result.current.message).toBe('作成は配置の制約により行われませんでした');
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

    it('callbacks 省略時は onEventChange/onEventDelete/onEventCreate/onOperationRejected 以外のキーを持たない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      const wrapped = result.current.wrapCallbacks();

      expect(Object.keys(wrapped).sort()).toEqual(
        ['onEventChange', 'onEventCreate', 'onEventDelete', 'onOperationRejected'].sort(),
      );
    });
  });

  describe('announceOperationRejected（手動呼び出し）', () => {
    it('info から既定の文言を組み立てて announce する', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      act(() => {
        result.current.announceOperationRejected({
          action: 'delete',
          reason: 'rejected',
          occurrence: makeOccurrence(),
        });
      });

      expect(result.current.message).toBe('会議の削除は許可されなかったため行われませんでした');
    });

    it('announce: { rejection: false } のときは何もしない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { rejection: false } }),
      );

      act(() => {
        result.current.announceOperationRejected({ action: 'create', reason: 'constraint' });
      });

      expect(result.current.message).toBe('');
    });
  });

  describe('ビュー変更の自動通知（calendar への内部購読）', () => {
    const VIEWS: readonly CalendarViewType[] = [
      'month',
      'week',
      'day',
      'list',
      'year',
      'multiMonth',
      'resource',
      'timeline',
    ];

    it.each(VIEWS)(
      'announce: { viewChange: true } のとき、view=%s への setView 後に formatViewTitle 相当の文言で announce される',
      (view) => {
        // 対象の view が既定（'month'）と同じだと setView が no-op になるため、
        // 異なる初期 view から始める
        const initialView = view === 'week' ? 'month' : 'week';
        const calendar = makeCalendar({ initialView });
        const { result } = renderHook(() =>
          useCalendarAnnouncer({ calendar, announce: { viewChange: true } }),
        );

        act(() => {
          calendar.api.setView(view);
        });

        const state = calendar.api.getState();
        const range = calendar.api.getVisibleRange();
        const title = formatViewTitle(
          state.view,
          state.currentDate,
          range,
          'Asia/Tokyo',
          'ja',
          '〜',
        );
        expect(result.current.message).toBe(`表示を${title}に切り替えました`);
      },
    );

    it('locale が en-US のとき、viewChange 通知のタイトルは中央カタログの rangeSeparator（"–"）を使う（〜のハードコードを使わない）', () => {
      const calendar = makeCalendar({ locale: 'en-US', initialView: 'month' });
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true } }),
      );

      act(() => {
        calendar.api.setView('week');
      });

      const state = calendar.api.getState();
      const range = calendar.api.getVisibleRange();
      const title = formatViewTitle(
        state.view,
        state.currentDate,
        range,
        'Asia/Tokyo',
        'en-US',
        '–',
      );
      expect(title).toContain('–');
      expect(title).not.toContain('〜');
      expect(result.current.message).toBe(`Switched view to ${title}`);
    });

    it('messages.common.rangeSeparator を部分上書きすると viewChange 通知のタイトルへ反映される', () => {
      const calendar = makeCalendar({ initialView: 'month' });
      const messages: MessageCatalogOverrides = { common: { rangeSeparator: ' – ' } };
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true }, messages }),
      );

      act(() => {
        calendar.api.setView('week');
      });

      const state = calendar.api.getState();
      const range = calendar.api.getVisibleRange();
      const title = formatViewTitle(
        state.view,
        state.currentDate,
        range,
        'Asia/Tokyo',
        'ja',
        ' – ',
      );
      expect(result.current.message).toBe(`表示を${title}に切り替えました`);
    });

    it('announce: { viewChange: true } のとき、goTo（基準日変更）後にも announce される', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true } }),
      );

      act(() => {
        calendar.api.goTo(new Date('2026-08-15T01:00:00Z'));
      });

      const state = calendar.api.getState();
      const range = calendar.api.getVisibleRange();
      const title = formatViewTitle(state.view, state.currentDate, range, 'Asia/Tokyo', 'ja', '〜');
      expect(result.current.message).toBe(`表示を${title}に切り替えました`);
    });

    it('announce.viewChange を省略（既定 false）すると setView しても announce されない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));

      act(() => {
        calendar.api.setView('week');
      });

      expect(result.current.message).toBe('');
    });

    it('announce: { viewChange: false } を明示指定した場合も同様に announce されない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: false } }),
      );

      act(() => {
        calendar.api.setView('week');
      });

      expect(result.current.message).toBe('');
    });

    it('初期マウント時点では announce されない（マウント後の変化のみが対象）', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true } }),
      );

      expect(result.current.message).toBe('');
    });

    it('ビュー・基準日・表示範囲のいずれも変わらない操作（イベント追加）では announce されない', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true } }),
      );

      act(() => {
        calendar.api.createEvent({
          title: '新規予定',
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        });
      });

      expect(result.current.message).toBe('');
    });

    it('messages.announcer.viewChanged を指定すると setView 後にカスタム文言・info が渡って announce される', () => {
      const calendar = makeCalendar();
      const viewChanged = vi.fn(
        (_info: CalendarRangeChangeInfo, _title: string) => 'カスタム表示切替文言',
      );
      const messages: MessageCatalogOverrides = { announcer: { viewChanged } };
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true }, messages }),
      );

      act(() => {
        calendar.api.setView('week');
      });

      expect(viewChanged).toHaveBeenCalledTimes(1);
      const call = viewChanged.mock.calls[0];
      if (call === undefined) {
        throw new Error('viewChanged が呼ばれていません');
      }
      const [infoArg] = call;
      expect(infoArg.view).toBe('week');
      expect(result.current.message).toBe('カスタム表示切替文言');
    });

    it('announce.viewChange の切替は、次の変化から反映される（購読は張りっぱなし）', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(
        ({ viewChange }: { viewChange: boolean }) =>
          useCalendarAnnouncer({ calendar, announce: { viewChange } }),
        { initialProps: { viewChange: false } },
      );

      // viewChange: false の間は setView しても announce されない
      act(() => {
        calendar.api.setView('week');
      });
      expect(result.current.message).toBe('');

      // true に切り替えた後の変化からは announce される
      rerender({ viewChange: true });
      act(() => {
        calendar.api.setView('day');
      });
      expect(result.current.message).not.toBe('');
    });
  });

  describe('messages によるカスタマイズ（中央メッセージカタログの announcer グループ）', () => {
    it('messages.announcer.eventChanged を指定すると、change・verb・rangeLabel・resourceLabel が渡り、戻り値が announce される', () => {
      const resources: CalendarResource[] = [{ id: 'r1', title: '会議室A' }];
      const calendar = makeCalendar({ resources, locale: 'ja' });
      const eventChanged = vi.fn(() => 'カスタム文言');
      const messages: MessageCatalogOverrides = { announcer: { eventChanged } };
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
        resourceId: 'r1',
        changes: [],
      };

      act(() => {
        wrapped.onEventChange?.(change);
      });

      expect(eventChanged).toHaveBeenCalledWith(change, 'moved', '7月16日 10:00〜11:00', '会議室A');
      expect(result.current.message).toBe('カスタム文言');
    });

    it('messages.announcer.eventCreated を指定すると、event・selection・rangeLabel・resourceLabel が渡る', () => {
      const calendar = makeCalendar();
      const eventCreated = vi.fn(
        (
          _event: CalendarEvent,
          _selection: RangeSelection,
          _rangeLabel: string,
          _resourceLabel: string | null,
        ) => 'カスタム作成文言',
      );
      const messages: MessageCatalogOverrides = { announcer: { eventCreated } };
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar, messages }));
      const wrapped = result.current.wrapCallbacks({});
      const selection = {
        range: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
      };

      act(() => {
        createByDefault(calendar, wrapped, selection);
      });

      expect(eventCreated).toHaveBeenCalledTimes(1);
      const call = eventCreated.mock.calls[0];
      if (call === undefined) {
        throw new Error('eventCreated が呼ばれていません');
      }
      const [createdArg, selectionArg, rangeLabelArg, resourceLabelArg] = call;
      expect(createdArg.title).toBe('(タイトルなし)');
      expect(selectionArg).toBe(selection);
      expect(rangeLabelArg).toBe('7月16日 10:00〜11:00');
      expect(resourceLabelArg).toBeNull();
      expect(result.current.message).toBe('カスタム作成文言');
    });

    it('messages.announcer.eventDeleted を指定すると、deletion が渡る', () => {
      const calendar = makeCalendar();
      const eventDeleted = vi.fn(() => 'カスタム削除文言');
      const messages: MessageCatalogOverrides = { announcer: { eventDeleted } };
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar, messages }));
      const wrapped = result.current.wrapCallbacks({});
      const deletion = { occurrence: makeOccurrence(), scope: 'this' as const, changes: [] };

      act(() => {
        wrapped.onEventDelete?.(deletion);
      });

      expect(eventDeleted).toHaveBeenCalledWith(deletion);
      expect(result.current.message).toBe('カスタム削除文言');
    });

    it('messages.announcer.viewChanged を指定すると、info・整形済みタイトルが渡る', () => {
      const calendar = makeCalendar();
      const viewChanged = vi.fn(() => 'カスタム表示切替文言');
      const messages: MessageCatalogOverrides = { announcer: { viewChanged } };
      const { result } = renderHook(() =>
        useCalendarAnnouncer({ calendar, announce: { viewChange: true }, messages }),
      );

      act(() => {
        calendar.api.goTo(new Date('2026-07-15T01:00:00Z'));
      });

      const state = calendar.api.getState();
      const range = calendar.api.getVisibleRange();
      const expectedInfo: CalendarRangeChangeInfo = {
        view: state.view,
        currentDate: state.currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      };

      expect(viewChanged).toHaveBeenCalledWith(expectedInfo, '2026年7月');
      expect(result.current.message).toBe('カスタム表示切替文言');
    });

    it('既定即時作成の通知は、作成されたイベントのタイトル（作成側が渡した既定タイトル）を読み上げる', () => {
      const calendar = makeCalendar();
      const { result } = renderHook(() => useCalendarAnnouncer({ calendar }));
      const wrapped = result.current.wrapCallbacks({});

      act(() => {
        createByDefault(
          calendar,
          wrapped,
          {
            range: {
              start: new Date('2026-07-16T01:00:00Z'),
              end: new Date('2026-07-16T02:00:00Z'),
            },
            allDay: false,
          },
          '（無題）',
        );
      });

      const events = calendar.api.getEvents();
      expect(events[0]?.title).toBe('（無題）');
      expect(result.current.message).toBe('（無題） を 7月16日 10:00〜11:00 に作成しました');
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
    it('wrapCallbacks / announce は再レンダーを跨いで同一参照を保つ', () => {
      const calendar = makeCalendar();
      const { result, rerender } = renderHook(() => useCalendarAnnouncer({ calendar }));

      const { wrapCallbacks, announce } = result.current;
      rerender();

      expect(result.current.wrapCallbacks).toBe(wrapCallbacks);
      expect(result.current.announce).toBe(announce);
    });
  });
});

describe('useCalendarAnnouncer - ビルトインビューでのキーボード作成', () => {
  const NOW = new Date('2026-07-15T01:00:00Z'); // 東京 2026-07-15 10:00
  const NO_EVENTS: readonly CalendarEvent[] = [];
  const RESOURCES: readonly CalendarResource[] = [{ id: 'r1', title: '会議室A' }];

  /** `wrapCallbacks({})` を `CalendarProvider` に渡してビューを描画するハーネス。 */
  function Harness(props: {
    view: 'day' | 'resource' | 'timeline';
    sink: { current: UseCalendarResult | null };
  }): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      initialView: props.view,
      events: NO_EVENTS,
      resources: RESOURCES,
    });
    props.sink.current = calendar;
    const announcer = useCalendarAnnouncer({ calendar });
    const callbacks = useMemo(() => announcer.wrapCallbacks({}), [announcer.wrapCallbacks]);
    return (
      <>
        <div data-testid="live" {...announcer.liveRegionProps}>
          {announcer.message}
        </div>
        <CalendarProvider value={calendar} callbacks={callbacks}>
          {props.view === 'day' && <TimeGridView />}
          {props.view === 'resource' && <ResourceView />}
          {props.view === 'timeline' && <TimelineView />}
        </CalendarProvider>
      </>
    );
  }

  it.each([
    ['day', '[data-koyomi="timegrid-day"]', '(タイトルなし) を 7月15日 0:00〜1:00 に作成しました'],
    [
      'resource',
      '[data-koyomi="resource-column"]',
      '(タイトルなし) を 7月15日 0:00〜1:00 に作成しました（会議室A）',
    ],
    [
      'timeline',
      '[data-koyomi="timeline-row"]',
      '(タイトルなし) を 7月15日 0:00〜1:00 に作成しました（会議室A）',
    ],
  ] as const)(
    '%s ビュー: 列・行の Enter による既定即時作成の後、新規予定へフォーカスが移り、作成が通知される',
    (view, selector, expectedMessage) => {
      const sink: { current: UseCalendarResult | null } = { current: null };
      const { container, getByTestId } = render(<Harness view={view} sink={sink} />);
      const track = container.querySelector<HTMLElement>(selector);
      if (track === null) {
        throw new Error(`作成対象の要素が見つかりません: ${selector}`);
      }

      act(() => track.focus());
      fireEvent.keyDown(track, { key: 'Enter' });

      expect(sink.current?.api.getEvents()).toHaveLength(1);
      const created = container.querySelector('[data-koyomi-occurrence]');
      expect(created).not.toBeNull();
      expect(document.activeElement).toBe(created);
      expect(getByTestId('live').textContent).toBe(expectedMessage);
    },
  );
});
