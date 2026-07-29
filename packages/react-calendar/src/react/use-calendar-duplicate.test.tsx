/**
 * @packageDocumentation
 * `useCalendarDuplicate` のテスト。
 *
 * `calendar` は（`useCalendarClipboard` のテストと同じ方針で）`createCalendar` を
 * 直接使った安定な `UseCalendarResult` 相当のオブジェクトを渡す（このフックは
 * `calendar.api` と `calendar.state` のみを使うため、`useCalendar` 経由の購読は
 * 不要）。undo との結合のみ `useCalendar` + `useCalendarHistory` を組み合わせる。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, EventOccurrence } from '../core/types';
import type { UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import { useCalendarDuplicate } from './use-calendar-duplicate';
import { useCalendarHistory } from './use-calendar-history';

const TOKYO = 'Asia/Tokyo';
/** 基準日（東京 2026-07-01）。 */
const NOW = new Date('2026-07-01T00:00:00Z');

/** 東京 7/1 9:00〜10:00 の単発イベント。 */
function makeSingle(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'single-1',
    title: '打ち合わせ',
    start: new Date('2026-07-01T00:00:00Z'), // 東京 9:00
    end: new Date('2026-07-01T01:00:00Z'),
    color: '#ef4444',
    ...overrides,
  };
}

/** 固定タイムゾーン・固定基準日の `UseCalendarResult` 相当のオブジェクトを作るヘルパ。 */
function makeCalendar(events: readonly CalendarEvent[] = []): UseCalendarResult {
  const api = createCalendar({
    timeZone: TOKYO,
    events,
    initialDate: NOW,
    now: () => NOW,
    defaultEventMinutes: 60,
  });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

/** 表示範囲の指定インデックスのオカレンスを取得する（見つからなければ失敗させる）。 */
function occurrenceAt(calendar: UseCalendarResult, index: number): EventOccurrence {
  const occurrence = calendar.api.getOccurrences(calendar.api.getVisibleRange())[index];
  if (occurrence === undefined) {
    throw new Error('テスト対象のオカレンスが見つかりません');
  }
  return occurrence;
}

describe('useCalendarDuplicate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('duplicate（単発イベント）', () => {
    it('同じ日時のまま新しい id で複製し、作成されたイベントを返す', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarDuplicate({ calendar }));

      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.duplicate(occurrenceAt(calendar, 0));
      });

      const events = calendar.api.getEvents();
      expect(events).toHaveLength(2);
      expect(created).not.toBeNull();
      expect(created).toEqual(events[1]);
      const duplicated = events[1];
      expect(duplicated?.id).not.toBe('single-1');
      expect(duplicated?.title).toBe('打ち合わせ');
      expect(duplicated?.start).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(duplicated?.end).toEqual(new Date('2026-07-01T01:00:00Z'));
    });

    it('onDuplicate が作成されたイベントとともに呼ばれる', () => {
      const calendar = makeCalendar([makeSingle()]);
      const onDuplicate = vi.fn();
      const { result } = renderHook(() => useCalendarDuplicate({ calendar, onDuplicate }));

      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.duplicate(occurrenceAt(calendar, 0));
      });

      expect(onDuplicate).toHaveBeenCalledWith(created);
    });
  });

  describe('duplicate（繰り返しオカレンス）', () => {
    it('当該オカレンスの単発化になる（rrule / recurringEventId を引き継がない）', () => {
      const calendar = makeCalendar([makeSingle({ id: 'master-1', rrule: 'FREQ=DAILY;COUNT=10' })]);
      const { result } = renderHook(() => useCalendarDuplicate({ calendar }));

      // 表示範囲 2 番目のオカレンス（7/2 9:00）を複製する
      const occurrence = occurrenceAt(calendar, 1);
      act(() => {
        result.current.duplicate(occurrence);
      });

      const duplicated = calendar.api.getEvents()[1];
      expect(duplicated?.rrule).toBeUndefined();
      expect(duplicated?.recurringEventId).toBeUndefined();
      expect(duplicated?.start).toEqual(new Date('2026-07-02T00:00:00Z'));
      expect(duplicated?.end).toEqual(new Date('2026-07-02T01:00:00Z'));
    });
  });

  describe('history 連携', () => {
    it('duplicate は history.push に after のみのエントリと挿入位置を渡す', () => {
      const calendar = makeCalendar([makeSingle()]);
      const push = vi.fn();
      const { result } = renderHook(() => useCalendarDuplicate({ calendar, history: { push } }));

      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.duplicate(occurrenceAt(calendar, 0));
      });

      expect(push).toHaveBeenCalledWith([{ after: created, index: 1 }]);
    });

    it('useCalendarHistory と組み合わせると、複製後の undo() で複製前の状態に戻る', () => {
      const { result } = renderHook(() => {
        const calendar = useCalendar({
          timeZone: TOKYO,
          events: [makeSingle()],
          initialDate: NOW,
          now: () => NOW,
          defaultEventMinutes: 60,
        });
        const history = useCalendarHistory({ calendar });
        const duplicateHook = useCalendarDuplicate({ calendar, history });
        return { calendar, history, duplicateHook };
      });

      act(() => {
        const occurrence = occurrenceAt(result.current.calendar, 0);
        result.current.duplicateHook.duplicate(occurrence);
      });
      expect(result.current.calendar.state.events).toHaveLength(2);
      expect(result.current.history.canUndo).toBe(true);

      act(() => {
        result.current.history.undo();
      });

      expect(result.current.calendar.state.events).toHaveLength(1);
      expect(result.current.history.canRedo).toBe(true);
    });
  });

  describe('元イベントが存在しない場合', () => {
    it('渡されたオカレンスの元イベントが既に削除されている場合は複製せず null を返す', () => {
      const calendar = makeCalendar([makeSingle()]);
      const occurrence = occurrenceAt(calendar, 0);
      calendar.api.deleteEvent(occurrence.eventId);
      const onDuplicate = vi.fn();
      const push = vi.fn();
      const { result } = renderHook(() =>
        useCalendarDuplicate({ calendar, history: { push }, onDuplicate }),
      );

      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.duplicate(occurrence);
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(0);
      expect(push).not.toHaveBeenCalled();
      expect(onDuplicate).not.toHaveBeenCalled();
    });
  });
});
