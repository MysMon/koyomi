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
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  CalendarViewType,
  EventOccurrence,
} from '../core/types';
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

/** `makeCalendar` に渡せる宣言的制約関連のオプション（{@link CalendarOptions} の部分集合）。 */
interface CalendarConstraintOverrides {
  /** {@link CalendarOptions.eventOverlap}。 */
  eventOverlap?: boolean;
  /** {@link CalendarOptions.eventConstraint}。 */
  eventConstraint?: 'businessHours' | readonly BusinessHoursRule[];
  /** {@link CalendarOptions.businessHours}。 */
  businessHours?: readonly BusinessHoursRule[];
  /** {@link CalendarOptions.initialView}。 */
  initialView?: CalendarViewType;
  /** {@link CalendarOptions.resources}。 */
  resources?: readonly CalendarResource[];
}

/** 固定タイムゾーン・固定基準日の `UseCalendarResult` 相当のオブジェクトを作るヘルパ。 */
function makeCalendar(
  events: readonly CalendarEvent[] = [],
  overrides: CalendarConstraintOverrides = {},
): UseCalendarResult {
  const api = createCalendar({
    timeZone: TOKYO,
    events,
    initialDate: NOW,
    now: () => NOW,
    defaultEventMinutes: 60,
    ...overrides,
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

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
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

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
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

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
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
      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
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

  describe('宣言的制約・適用前フックの通過（isDragCandidateValid / onBeforeSelectRange）', () => {
    it('eventOverlap: false のとき、既存オカレンスと重なる貼り付けは作成されず reason: "constraint" で onPasteRejected が呼ばれる', () => {
      const calendar = makeCalendar([makeSingle()], { eventOverlap: false });
      const onPasteRejected = vi.fn();
      const push = vi.fn();
      const onPaste = vi.fn();
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, onPasteRejected, history: { push }, onPaste }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
      act(() => {
        // newStart 省略 → コピー元と同じ枠（既存オカレンスと完全に重なる）へ貼り付けようとする
        created = result.current.paste();
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(onPasteRejected).toHaveBeenCalledWith({
        reason: 'constraint',
        input: expect.objectContaining({ title: '打ち合わせ' }),
        start: new Date('2026-07-01T00:00:00Z'),
        allDay: false,
      });
      expect(push).not.toHaveBeenCalled();
      expect(onPaste).not.toHaveBeenCalled();
    });

    it('イベント個別の timeZone を持つオカレンスでも、eventOverlap: false で同じ枠への貼り付けが拒否される', () => {
      // NY の 10:00〜11:00（= 14:00Z〜15:00Z）。オフセットなし文字列の start / end は
      // イベント自身の timeZone（America/New_York）の現地時刻を表す。
      // 表示タイムゾーン（東京）で解釈すると 01:00Z〜02:00Z になり重なりを見逃す
      const calendar = makeCalendar(
        [
          makeSingle({
            start: '2026-07-15T10:00',
            end: '2026-07-15T11:00',
            timeZone: 'America/New_York',
          }),
        ],
        { eventOverlap: false },
      );
      const onPasteRejected = vi.fn();
      const { result } = renderHook(() => useCalendarClipboard({ calendar, onPasteRejected }));
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
      act(() => {
        // newStart 省略 → コピー元と同じ枠（既存オカレンスと完全に重なる）へ貼り付けようとする
        created = result.current.paste();
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(onPasteRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'constraint' }),
      );
    });

    it('eventConstraint: "businessHours" のとき、営業時間外への貼り付けは作成されず reason: "constraint" で onPasteRejected が呼ばれる', () => {
      // 水曜日 9:00〜17:00 のみが営業時間（NOW の 7/1 は水曜日、貼り付け先の 7/2 は木曜日）
      const businessHours: BusinessHoursRule[] = [
        { daysOfWeek: [3], startTime: '09:00', endTime: '17:00' },
      ];
      const calendar = makeCalendar([makeSingle()], {
        eventConstraint: 'businessHours',
        businessHours,
      });
      const onPasteRejected = vi.fn();
      const { result } = renderHook(() => useCalendarClipboard({ calendar, onPasteRejected }));
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
      act(() => {
        created = result.current.paste(new Date('2026-07-02T00:00:00Z')); // 木曜 9:00（営業時間外）
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(onPasteRejected).toHaveBeenCalledWith({
        reason: 'constraint',
        input: expect.objectContaining({ title: '打ち合わせ' }),
        start: new Date('2026-07-02T00:00:00Z'),
        allDay: false,
      });
    });

    it('onBeforeSelectRange が同期的に false を返すと貼り付けは作成されず、reason: "rejected" で onPasteRejected が呼ばれる', () => {
      const calendar = makeCalendar([makeSingle()]);
      const onBeforeSelectRange = vi.fn().mockReturnValue(false);
      const onPasteRejected = vi.fn();
      const push = vi.fn();
      const onPaste = vi.fn();
      const { result } = renderHook(() =>
        useCalendarClipboard({
          calendar,
          callbacks: { onBeforeSelectRange },
          onPasteRejected,
          history: { push },
          onPaste,
        }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      let created: CalendarEvent | null | Promise<CalendarEvent | null> = null;
      act(() => {
        created = result.current.paste();
      });

      expect(created).toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(onBeforeSelectRange).toHaveBeenCalledWith({
        range: { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-01T01:00:00Z') },
        allDay: false,
      });
      expect(onPasteRejected).toHaveBeenCalledWith({
        reason: 'rejected',
        input: expect.objectContaining({ title: '打ち合わせ' }),
        start: new Date('2026-07-01T00:00:00Z'),
        allDay: false,
      });
      expect(push).not.toHaveBeenCalled();
      expect(onPaste).not.toHaveBeenCalled();
    });

    it('onBeforeSelectRange が Promise<true> を返す場合、解決を待ってから作成され history/onPaste が呼ばれる', async () => {
      const calendar = makeCalendar([makeSingle()]);
      const onBeforeSelectRange = vi.fn().mockResolvedValue(true);
      const push = vi.fn();
      const onPaste = vi.fn();
      const { result } = renderHook(() =>
        useCalendarClipboard({
          calendar,
          callbacks: { onBeforeSelectRange },
          history: { push },
          onPaste,
        }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });

      let pending: CalendarEvent | null | Promise<CalendarEvent | null> = null;
      act(() => {
        pending = result.current.paste();
      });
      expect(pending).toBeInstanceOf(Promise);

      let created: CalendarEvent | null = null;
      await act(async () => {
        created = await pending;
      });

      expect(created).not.toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(2);
      expect(push).toHaveBeenCalledWith([{ after: created, index: 1 }]);
      expect(onPaste).toHaveBeenCalledWith(created);
    });

    it('Ctrl+V 経路でも eventOverlap: false による拒否が働き、イベントは作成されない', () => {
      const calendar = makeCalendar([makeSingle()], { eventOverlap: false });
      const onPasteRejected = vi.fn();
      const { result } = renderHook(() =>
        useCalendarClipboard({ calendar, keyboardShortcuts: true, onPasteRejected }),
      );
      act(() => {
        result.current.copy(firstOccurrence(calendar));
      });
      // 同じ日付セル（コピー元と同じ日）へ貼り付け、既存オカレンスと重ねる
      const cell = mountDateCellElement('2026-07-01');

      fireEvent.keyDown(cell, { key: 'v', ctrlKey: true });

      expect(calendar.api.getEvents()).toHaveLength(1);
      expect(onPasteRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'constraint' }),
      );
    });
  });

  describe('宣言的制約の判定内容（イベント個別の constraint / overlap・レーン）', () => {
    /** 全曜日 9:00〜18:00 の営業時間。 */
    const HOURS: BusinessHoursRule[] = [
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' },
    ];

    /** 指定 ID のイベントの（表示範囲内の）オカレンスを取得する。 */
    function occurrenceOf(calendar: UseCalendarResult, eventId: string): EventOccurrence {
      const occurrence = calendar.api
        .getOccurrences(calendar.api.getVisibleRange())
        .find((item) => item.eventId === eventId);
      if (occurrence === undefined) {
        throw new Error(`オカレンスが見つかりません: ${eventId}`);
      }
      return occurrence;
    }

    /** `eventId` のオカレンスをコピーし、`newStart`（省略時は同じ日時）へ貼り付けた結果を返す。 */
    function copyAndPaste(
      calendar: UseCalendarResult,
      eventId: string,
      newStart?: Date,
    ): { created: CalendarEvent | null; onPasteRejected: ReturnType<typeof vi.fn> } {
      const onPasteRejected = vi.fn();
      const { result } = renderHook(() => useCalendarClipboard({ calendar, onPasteRejected }));
      act(() => {
        result.current.copy(occurrenceOf(calendar, eventId));
      });
      // コールバック内での代入は型の絞り込みに反映されないため、入れ物経由で受け取る
      const outcome: { value: CalendarEvent | null | Promise<CalendarEvent | null> } = {
        value: null,
      };
      act(() => {
        outcome.value = result.current.paste(newStart);
      });
      if (outcome.value instanceof Promise) {
        throw new Error('同期的に完結するはずの貼り付けが Promise を返しました');
      }
      return { created: outcome.value, onPasteRejected };
    }

    it('イベント個別の constraint: "businessHours" を持つ予定は、eventConstraint 未指定でも営業時間外へ貼り付けできない', () => {
      const calendar = makeCalendar([makeSingle({ constraint: 'businessHours' })], {
        businessHours: HOURS,
      });

      // 東京 7/1 20:00（営業時間外）
      const { created, onPasteRejected } = copyAndPaste(
        calendar,
        'single-1',
        new Date('2026-07-01T11:00:00Z'),
      );

      expect(created).toBeNull();
      expect(onPasteRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'constraint' }),
      );
    });

    it('イベント個別の constraint は eventConstraint より優先され、個別のルールに収まる貼り付けは通る', () => {
      // 全体は営業時間（9:00〜18:00）に制限するが、この予定は個別に 0:00〜24:00 を許可する
      const calendar = makeCalendar(
        [
          makeSingle({
            constraint: [
              { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '24:00' },
            ],
          }),
        ],
        { eventConstraint: 'businessHours', businessHours: HOURS },
      );

      const { created } = copyAndPaste(calendar, 'single-1', new Date('2026-07-01T11:00:00Z'));

      expect(created).not.toBeNull();
    });

    it('overlap: true の予定同士は、eventOverlap: false でも重ねて貼り付けできる', () => {
      const calendar = makeCalendar([makeSingle({ overlap: true })], { eventOverlap: false });

      // newStart 省略 → コピー元（overlap: true）と完全に重なる枠へ貼り付ける
      const { created } = copyAndPaste(calendar, 'single-1');

      expect(created).not.toBeNull();
      expect(calendar.api.getEvents()).toHaveLength(2);
    });

    it('overlap: false の予定は、eventOverlap が既定（true）でも既存の予定に重ねて貼り付けできない', () => {
      const calendar = makeCalendar([
        makeSingle({ overlap: false }),
        makeSingle({
          id: 'other',
          start: new Date('2026-07-01T03:00:00Z'), // 東京 12:00
          end: new Date('2026-07-01T04:00:00Z'),
        }),
      ]);

      const { created, onPasteRejected } = copyAndPaste(
        calendar,
        'single-1',
        new Date('2026-07-01T03:00:00Z'),
      );

      expect(created).toBeNull();
      expect(onPasteRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'constraint' }),
      );
    });

    describe.each(['resource', 'timeline'] as const)(
      '%s ビュー（レーンごとの重なり判定）',
      (initialView) => {
        const RESOURCES: CalendarResource[] = [
          { id: 'r1', title: 'R1' },
          { id: 'r2', title: 'R2' },
        ];
        /** r1 の 9:00〜10:00・r2 の 12:00〜13:00・r1 の 15:00〜16:00（いずれも東京 7/1）。 */
        const EVENTS: CalendarEvent[] = [
          makeSingle({ resourceId: 'r1' }),
          makeSingle({
            id: 'other-lane',
            resourceId: 'r2',
            start: new Date('2026-07-01T03:00:00Z'),
            end: new Date('2026-07-01T04:00:00Z'),
          }),
          makeSingle({
            id: 'same-lane',
            resourceId: 'r1',
            start: new Date('2026-07-01T06:00:00Z'),
            end: new Date('2026-07-01T07:00:00Z'),
          }),
        ];

        it('eventOverlap: false でも、別のレーンの予定と同じ時間帯へは貼り付けできる', () => {
          const calendar = makeCalendar(EVENTS, {
            eventOverlap: false,
            initialView,
            resources: RESOURCES,
          });

          // r1 の予定を、r2 の予定と同じ 12:00 へ貼り付ける（貼り付け先のレーンは r1）
          const { created } = copyAndPaste(calendar, 'single-1', new Date('2026-07-01T03:00:00Z'));

          expect(created).toMatchObject({ resourceId: 'r1' });
        });

        it('eventOverlap: false のとき、同じレーンの予定と重なる貼り付けは拒否される', () => {
          const calendar = makeCalendar(EVENTS, {
            eventOverlap: false,
            initialView,
            resources: RESOURCES,
          });

          // r1 の予定を、同じ r1 の予定がある 15:00 へ貼り付ける
          const { created, onPasteRejected } = copyAndPaste(
            calendar,
            'single-1',
            new Date('2026-07-01T06:00:00Z'),
          );

          expect(created).toBeNull();
          expect(onPasteRejected).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'constraint' }),
          );
        });
      },
    );

    it('レーンを持たないビュー（週ビュー）では、resourceId が違っても同じ時間帯の予定と重なり扱いになる', () => {
      const calendar = makeCalendar(
        [
          makeSingle({ resourceId: 'r1' }),
          makeSingle({
            id: 'other-lane',
            resourceId: 'r2',
            start: new Date('2026-07-01T03:00:00Z'),
            end: new Date('2026-07-01T04:00:00Z'),
          }),
        ],
        {
          eventOverlap: false,
          initialView: 'week',
          resources: [
            { id: 'r1', title: 'R1' },
            { id: 'r2', title: 'R2' },
          ],
        },
      );

      const { created } = copyAndPaste(calendar, 'single-1', new Date('2026-07-01T03:00:00Z'));

      expect(created).toBeNull();
    });
  });
});
