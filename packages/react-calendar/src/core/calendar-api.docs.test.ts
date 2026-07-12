/**
 * `docs/api.md` の「カレンダーエンジン（createCalendar / CalendarApi）」
 * 「@koyomi-cal/react/core（React 非依存の単体エントリ）」「useCalendar」
 * 「onRangeChange」「オプション（CalendarOptions）」の各節の記述のみから
 * 導出した仕様由来テストである。実装ファイル（*.test.* 以外）は参照して
 * いない。既存テスト（calendar.test.ts / core.test.ts 等）は「その仕様が
 * 既にテスト済みか」の照合のためだけに読み、期待値の根拠にはしていない。
 *
 * 各テストの先頭コメントに出典（docs/api.md の該当記述の要約）を付す。
 */
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import type { CalendarEvent } from './types';

describe('CalendarApi（docs/api.md 由来の追加仕様）', () => {
  it("id 省略時の自動採番は空の状態から作成すると koyomi-1 になる（api.md #createCalendar 具体例: 「id 省略時は 'koyomi-1' のような連番 ID が自動採番される」）", () => {
    const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
    const created = calendar.createEvent({
      title: '会議',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
    });
    expect(created.id).toBe('koyomi-1');
  });

  it('getOccurrences は範囲内のオカレンスを開始時刻順（昇順）で返す（api.md #CalendarApi 表: 「指定範囲のオカレンス一覧を開始時刻順で返す」）', () => {
    // 意図的に開始時刻の降順で登録し、返り値が昇順に並び替わることを確認する。
    const late: CalendarEvent = {
      id: 'late',
      title: '遅い予定',
      start: '2026-07-15T18:00',
      end: '2026-07-15T19:00',
    };
    const early: CalendarEvent = {
      id: 'early',
      title: '早い予定',
      start: '2026-07-15T09:00',
      end: '2026-07-15T10:00',
    };
    const middle: CalendarEvent = {
      id: 'middle',
      title: '中間の予定',
      start: '2026-07-15T13:00',
      end: '2026-07-15T14:00',
    };
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      events: [late, early, middle],
    });

    const occurrences = calendar.getOccurrences({
      start: new Date('2026-07-14T15:00:00Z'), // 東京 7/15 0:00
      end: new Date('2026-07-15T15:00:00Z'), // 東京 7/16 0:00
    });

    expect(occurrences.map((o) => o.eventId)).toEqual(['early', 'middle', 'late']);
  });
});

describe('CalendarOptions の既定値（docs/api.md #オプション 由来）', () => {
  it("defaultEventTitle 省略時の既定値は '(タイトルなし)' になる（api.md オプション表: defaultEventTitle 既定 '(タイトルなし)'）", () => {
    const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
    expect(calendar.getState().options.defaultEventTitle).toBe('(タイトルなし)');
  });

  it('now 省略時の既定値は呼び出すと現在時刻に近い Date を返す関数になる（api.md オプション表: now 既定 `() => new Date()`）', () => {
    const before = Date.now();
    const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
    const { now } = calendar.getState().options;
    expect(typeof now).toBe('function');
    const evaluated = now().getTime();
    const after = Date.now();
    // 実行時刻の前後 1 秒以内（now() 呼び出しは同期的に行われるため十分な余裕）。
    expect(evaluated).toBeGreaterThanOrEqual(before - 1000);
    expect(evaluated).toBeLessThanOrEqual(after + 1000);
  });

  it('initialDate 省略時は現在時刻になる（api.md オプション表: initialDate 既定「現在時刻」）', () => {
    const before = Date.now();
    const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
    const after = Date.now();
    const currentDate = calendar.getState().currentDate.getTime();
    expect(currentDate).toBeGreaterThanOrEqual(before - 1000);
    expect(currentDate).toBeLessThanOrEqual(after + 1000);
  });

  it('resources は ResolvedCalendarOptions に含まれない（api.md: 「resources は... ResolvedCalendarOptions には含まれません」）', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      resources: [{ id: 'r1', title: '会議室' }],
    });
    expect('resources' in calendar.getState().options).toBe(false);
  });
});

describe('timeZone オプション本体の不正な IANA タイムゾーン ID（docs/api.md #オプション 由来。本追記分）', () => {
  // 出典: docs/api.md オプション表（本追記分）:
  // 「timeZone?: TimeZoneId | 実行環境のローカルタイムゾーン（不正な IANA タイムゾーン ID を
  //  指定すると createCalendar 呼び出し自体が Error を投げる。setTimeZone と同じ検証規則）」
  it('createCalendar({ timeZone: 不正な値 }) は Error を投げる', () => {
    expect(() => createCalendar({ timeZone: 'Invalid/Zone' })).toThrow();
  });
});

describe('hiddenWeekdays に 7 曜日すべてを指定した場合の挙動（docs/api.md #オプション 由来。本追記分）', () => {
  // 出典: docs/api.md オプション表（本追記分）:
  // 「hiddenWeekdays?: readonly Weekday[] | []（非表示にする曜日。7 曜日全指定は無効な
  //  設定として無視され、既定の空配列（すべて表示）にフォールバックする。...）」
  it('hiddenWeekdays に 7 曜日すべてを指定すると無効な設定として無視され、既定の空配列にフォールバックする', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(calendar.getState().options.hiddenWeekdays).toEqual([]);
  });
});

describe('next / prev の移動幅（docs/api.md #CalendarApi 由来。本追記分）', () => {
  // 出典: docs/api.md「next / prev の移動幅はビューごとに異なります」表（本追記分）:
  // month=1 ヶ月・week=7 日・day=1 日・list=listDays 日・year=1 年・
  // multiMonth=multiMonthCount ヶ月・resource=1 日・timeline=timelineDays 日
  const START = new Date('2026-07-15T00:00:00+09:00');

  it('month ビューの next() は 1 ヶ月分（月初基準）進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'month',
      initialDate: START,
    });
    calendar.next();
    expect(calendar.getState().currentDate.toISOString()).toBe('2026-07-31T15:00:00.000Z'); // 東京 8/1 0:00
  });

  it('week ビューの next() は 7 日進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'week',
      initialDate: START,
    });
    const before = calendar.getState().currentDate.getTime();
    calendar.next();
    expect(calendar.getState().currentDate.getTime() - before).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('day ビューの next() は 1 日進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'day',
      initialDate: START,
    });
    const before = calendar.getState().currentDate.getTime();
    calendar.next();
    expect(calendar.getState().currentDate.getTime() - before).toBe(24 * 60 * 60 * 1000);
  });

  it('list ビューの next() は listDays 日進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'list',
      initialDate: START,
      listDays: 10,
    });
    const before = calendar.getState().currentDate.getTime();
    calendar.next();
    expect(calendar.getState().currentDate.getTime() - before).toBe(10 * 24 * 60 * 60 * 1000);
  });

  it('year ビューの next() は 1 年分（年初基準）進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'year',
      initialDate: START,
    });
    calendar.next();
    expect(calendar.getState().currentDate.toISOString()).toBe('2026-12-31T15:00:00.000Z'); // 東京 2027-01-01 0:00
  });

  it('multiMonth ビューの next() は multiMonthCount ヶ月分（月初基準）進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'multiMonth',
      initialDate: START,
      multiMonthCount: 2,
    });
    calendar.next();
    expect(calendar.getState().currentDate.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // 東京 9/1 0:00
  });

  it('resource ビューの next() は day ビューと同じく 1 日進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'resource',
      initialDate: START,
    });
    const before = calendar.getState().currentDate.getTime();
    calendar.next();
    expect(calendar.getState().currentDate.getTime() - before).toBe(24 * 60 * 60 * 1000);
  });

  it('timeline ビューの next() は timelineDays 日進む', () => {
    const calendar = createCalendar({
      timeZone: 'Asia/Tokyo',
      initialView: 'timeline',
      initialDate: START,
      timelineDays: 5,
    });
    const before = calendar.getState().currentDate.getTime();
    calendar.next();
    expect(calendar.getState().currentDate.getTime() - before).toBe(5 * 24 * 60 * 60 * 1000);
  });
});

describe('onEventsChange / onRangeChange の発火規約（docs/api.md 由来。既存テストとの重複を避け未カバー分のみ）', () => {
  it('setEvents 単体では通知されるが onEventsChange は呼ばれない（api.md #createCalendar: 「setEvents では呼ばれません」）', () => {
    const onEventsChange = vi.fn();
    const listener = vi.fn();
    const calendar = createCalendar({ timeZone: 'Asia/Tokyo', onEventsChange });
    calendar.subscribe(listener);

    calendar.setEvents([
      { id: 'a', title: 'A', start: '2026-07-15T09:00', end: '2026-07-15T10:00' },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(onEventsChange).not.toHaveBeenCalled();
  });
});

describe('@koyomi-cal/react/core（React 非依存の単体エントリ、api.md #core エントリ 由来）', () => {
  it('React コンポーネント・フックは再エクスポートされない（api.md: 「React コンポーネント・フックは含まれません」）', async () => {
    const coreEntry: Record<string, unknown> = await import('../core');

    for (const reactOnlySymbol of [
      'useCalendar',
      'useCalendarShortcuts',
      'useDayDrag',
      'useTimeGridDrag',
      'useResourceGridDrag',
      'useTimelineDrag',
      'useExternalDrag',
      'useVirtualizer',
      'CalendarProvider',
      'CalendarView',
      'MonthView',
      'TimeGridView',
      'Toolbar',
    ]) {
      expect(coreEntry[reactOnlySymbol]).toBeUndefined();
    }
  });

  it('createCalendar は @koyomi-cal/react/core からも同じ挙動で利用できる（api.md #core エントリ 具体例）', async () => {
    const { createCalendar: createCalendarFromCoreEntry } = await import('../core');
    const calendar = createCalendarFromCoreEntry({ timeZone: 'Asia/Tokyo' });
    calendar.setView('week');
    expect(calendar.getState().view).toBe('week');
  });
});
