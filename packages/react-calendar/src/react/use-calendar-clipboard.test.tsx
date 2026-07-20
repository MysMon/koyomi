/**
 * @packageDocumentation
 * `useCalendarClipboard` のテスト。
 *
 * `calendar` は（`useCalendarHistory` のテストと同じ方針で）`createCalendar` を
 * 直接使った安定な `UseCalendarResult` 相当のオブジェクトを渡す（このフックは
 * `calendar.api` と `calendar.state` のみを使うため、`useCalendar` 経由の購読は不要）。
 *
 * キーボードショートカットのテストは、jsdom 上に `data-koyomi-occurrence` /
 * `data-koyomi-date` 属性を持つ要素を作り、そこから keydown を発火して検証する。
 */
import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, EventOccurrence } from '../core/types';
import type { UseCalendarResult } from './types';
import { useCalendarClipboard } from './use-calendar-clipboard';

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

/** 表示範囲の先頭のオカレンスを取得する（見つからなければ失敗させる）。 */
function firstOccurrence(calendar: UseCalendarResult): EventOccurrence {
  const occurrence = calendar.api.getOccurrences(calendar.api.getVisibleRange())[0];
  if (occurrence === undefined) {
    throw new Error('テスト対象のオカレンスが見つかりません');
  }
  return occurrence;
}

/** `data-koyomi-occurrence` 属性を持つボタンを body に追加する。 */
function mountOccurrenceElement(occurrenceKey: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('data-koyomi-occurrence', occurrenceKey);
  document.body.appendChild(button);
  return button;
}

/** `data-koyomi-date` 属性を持つセル相当の要素を body に追加する。 */
function mountDateCellElement(dateKey: string): HTMLDivElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-koyomi', 'month-day');
  cell.setAttribute('data-koyomi-date', dateKey);
  cell.tabIndex = 0;
  document.body.appendChild(cell);
  return cell;
}

describe('useCalendarClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('copy / paste（手動 API）', () => {
    it('copy でクリップボードに積まれ hasClipboard が true になり、onCopy が呼ばれる', () => {
      const calendar = makeCalendar([makeSingle()]);
      const onCopy = vi.fn();
      const { result } = renderHook(() => useCalendarClipboard({ calendar, onCopy }));
      expect(result.current.hasClipboard).toBe(false);

      const occurrence = firstOccurrence(calendar);
      act(() => {
        result.current.copy(occurrence);
      });

      expect(result.current.hasClipboard).toBe(true);
      expect(onCopy).toHaveBeenCalledWith(occurrence);
    });

    it('paste（引数なし）はコピー元と同じ日時に新しい id で複製する', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));

      let created: CalendarEvent | null = null;
      act(() => {
        result.current.copy(firstOccurrence(calendar));
        created = result.current.paste();
      });

      const events = calendar.api.getEvents();
      expect(events).toHaveLength(2);
      expect(created).not.toBeNull();
      expect(created).toEqual(events[1]);
      const pasted = events[1];
      expect(pasted?.id).not.toBe('single-1');
      expect(pasted?.title).toBe('打ち合わせ');
      expect(pasted?.start).toEqual(new Date('2026-07-01T00:00:00Z'));
      expect(pasted?.end).toEqual(new Date('2026-07-01T01:00:00Z'));
    });

    it('paste(newStart) は貼り付け先の日時へ長さを維持して配置する', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));

      act(() => {
        result.current.copy(firstOccurrence(calendar));
        result.current.paste(new Date('2026-07-05T03:00:00Z'));
      });

      const pasted = calendar.api.getEvents()[1];
      expect(pasted?.start).toEqual(new Date('2026-07-05T03:00:00Z'));
      expect(pasted?.end).toEqual(new Date('2026-07-05T04:00:00Z'));
    });

    it('繰り返しオカレンスのコピー → 貼り付けは当該オカレンスの単発化になる（rrule を引き継がない）', () => {
      const calendar = makeCalendar([makeSingle({ id: 'master-1', rrule: 'FREQ=DAILY;COUNT=10' })]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));

      // 表示範囲 2 番目のオカレンス（7/2 9:00）をコピーする
      const occurrence = calendar.api.getOccurrences(calendar.api.getVisibleRange())[1];
      if (occurrence === undefined) {
        throw new Error('テスト対象のオカレンスが見つかりません');
      }
      act(() => {
        result.current.copy(occurrence);
        result.current.paste();
      });

      const pasted = calendar.api.getEvents()[1];
      expect(pasted?.rrule).toBeUndefined();
      expect(pasted?.recurringEventId).toBeUndefined();
      expect(pasted?.start).toEqual(new Date('2026-07-02T00:00:00Z'));
    });

    it('paste は history.push に after のみのエントリと挿入位置を渡し、onPaste を呼ぶ', () => {
      const calendar = makeCalendar([makeSingle()]);
      const push = vi.fn();
      const onPaste = vi.fn();
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, history: { push }, onPaste }),
      );

      let created: CalendarEvent | null = null;
      act(() => {
        result.current.copy(firstOccurrence(calendar));
        created = result.current.paste();
      });

      expect(push).toHaveBeenCalledWith([{ after: created, index: 1 }]);
      expect(onPaste).toHaveBeenCalledWith(created);
    });

    it('クリップボードが空のとき paste は null を返し、イベントを作成しない', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));

      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.paste();
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(1);
    });

    it('clear でクリップボードが空になる', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));

      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      expect(result.current.hasClipboard).toBe(true);

      act(() => {
        result.current.clear();
      });
      expect(result.current.hasClipboard).toBe(false);
      let created: CalendarEvent | null = null;
      act(() => {
        created = result.current.paste();
      });
      expect(created).toBeNull();
    });
  });

  describe('キーボードショートカット（Ctrl/Cmd+C / Ctrl/Cmd+V）', () => {
    it('keyboardShortcuts 省略（既定 false）のとき Ctrl+C を発火してもコピーされない', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() => useCalendarClipboard({ calendar }));
      const button = mountOccurrenceElement(firstOccurrence(calendar).key);

      fireEvent.keyDown(button, { key: 'c', ctrlKey: true });

      expect(result.current.hasClipboard).toBe(false);
    });

    it('keyboardShortcuts: true でフォーカス中のオカレンス要素からの Ctrl+C がコピーする', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      const button = mountOccurrenceElement(firstOccurrence(calendar).key);

      fireEvent.keyDown(button, { key: 'c', ctrlKey: true });

      expect(result.current.hasClipboard).toBe(true);
    });

    it('Cmd（Meta）修飾キーでも同様にコピーされる（macOS 相当）', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      const button = mountOccurrenceElement(firstOccurrence(calendar).key);

      fireEvent.keyDown(button, { key: 'c', metaKey: true });

      expect(result.current.hasClipboard).toBe(true);
    });

    it('オカレンス要素の外（body）での Ctrl+C は何もせず、preventDefault もしない（テキストコピーを妨げない）', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );

      const notPrevented = fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });

      expect(result.current.hasClipboard).toBe(false);
      expect(notPrevented).toBe(true); // preventDefault されていない
    });

    it('Ctrl+V はフォーカス中の日付セル（data-koyomi-date）へ、コピー元の時刻を維持して貼り付ける', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      const cell = mountDateCellElement('2026-07-10');

      fireEvent.keyDown(cell, { key: 'v', ctrlKey: true });

      const pasted = calendar.api.getEvents()[1];
      // 東京 7/10 9:00〜10:00（コピー元の現地時刻を維持）
      expect(pasted?.start).toEqual(new Date('2026-07-10T00:00:00Z'));
      expect(pasted?.end).toEqual(new Date('2026-07-10T01:00:00Z'));
    });

    it('終日オカレンスのコピー → 日付セルへの Ctrl+V は終日のまま対象日に貼り付ける', () => {
      const calendar = makeCalendar([
        makeSingle({ id: 'allday-1', start: '2026-07-01', end: '2026-07-03', allDay: true }),
      ]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      const cell = mountDateCellElement('2026-07-10');

      fireEvent.keyDown(cell, { key: 'v', ctrlKey: true });

      const pasted = calendar.api.getEvents()[1];
      expect(pasted?.allDay).toBe(true);
      expect(pasted?.start).toBe('2026-07-10');
      expect(pasted?.end).toBe('2026-07-12'); // 2 暦日分を維持
    });

    it('カレンダー外（data-koyomi 属性の要素の外）での Ctrl+V は貼り付けない', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });

      expect(calendar.api.getEvents()).toHaveLength(1);
    });

    it('カレンダー内でも日付セルが見つからない場合はコピー元と同じ日時に貼り付ける', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      // 日付キーを持たないカレンダー内要素（ツールバーのボタン等を想定）
      const element = document.createElement('button');
      element.setAttribute('data-koyomi', 'toolbar-button');
      document.body.appendChild(element);

      fireEvent.keyDown(element, { key: 'v', ctrlKey: true });

      const pasted = calendar.api.getEvents()[1];
      expect(pasted?.start).toEqual(new Date('2026-07-01T00:00:00Z'));
    });

    it('input 要素にフォーカスがある間は Ctrl+C / Ctrl+V が無視される', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: 'v', ctrlKey: true });

      expect(calendar.api.getEvents()).toHaveLength(1);
    });

    it('アンマウント時に keydown リスナーが解除される', () => {
      const calendar = makeCalendar([makeSingle()]);
      const { result, unmount } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      const cell = mountDateCellElement('2026-07-10');

      unmount();
      fireEvent.keyDown(cell, { key: 'v', ctrlKey: true });

      expect(calendar.api.getEvents()).toHaveLength(1);
    });
  });
});
