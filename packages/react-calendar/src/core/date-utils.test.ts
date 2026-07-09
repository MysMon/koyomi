/**
 * date-utils.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' や 'UTC' を引数で明示して行う。
 *
 * 2026 年のカレンダー事実:
 * - 2026-02-01 は日曜、2026-02-28 は土曜（週開始=日曜だとちょうど 4 週）
 * - 2026-07-01 は水曜（週開始=日曜だと 5 週）
 * - 2026-08-01 は土曜、2026-08-31 は月曜（週開始=日曜だと 6 週）
 * - America/New_York の DST は 2026-03-08 に開始、2026-11-01 に終了
 * - America/Santiago の DST は 2026-09-06 の現地 0:00 に開始する（0:00〜0:59 が
 *   存在せず 1:00 に繰り上げられる。他の多くのゾーンと異なり深夜に切り替わる）。
 *   2026-09-06 は日曜日
 */
import { describe, expect, it } from 'vitest';
import {
  addMonthsInZone,
  eachDayInRange,
  monthGridRange,
  navigateDate,
  rangesOverlap,
  startOfMonthInZone,
  startOfWeekInZone,
  startOfYearInZone,
  visibleRangeFor,
} from './date-utils';
import { dateKeyInZone, minutesOfDayInZone } from './timezone';
import type { DateRange } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const UTC = 'UTC';
const SANTIAGO = 'America/Santiago';
// America/Lima は 1990-01-01 の現地 0:00 に DST が開始し、0:00〜0:59 が存在せず
// 1:00 に繰り上げられる（1989-12-31 23:59 -05:00 の直後が 1990-01-01 01:00 -04:00）。
const LIMA = 'America/Lima';

describe('startOfWeekInZone', () => {
  it('週開始=日曜: 水曜の日時から直前の日曜 0:00 を返す', () => {
    const date = new Date('2026-07-01T01:00:00Z'); // 7/1(水) 10:00 JST
    expect(startOfWeekInZone(date, TOKYO, 0).toISOString()).toBe('2026-06-27T15:00:00.000Z'); // 6/28(日) 0:00 JST
  });

  it('週開始=月曜: 水曜の日時から直前の月曜 0:00 を返す', () => {
    const date = new Date('2026-07-01T01:00:00Z');
    expect(startOfWeekInZone(date, TOKYO, 1).toISOString()).toBe('2026-06-28T15:00:00.000Z'); // 6/29(月) 0:00 JST
  });

  it('週開始=土曜: 水曜の日時から直前の土曜 0:00 を返す', () => {
    const date = new Date('2026-07-01T01:00:00Z');
    expect(startOfWeekInZone(date, TOKYO, 6).toISOString()).toBe('2026-06-26T15:00:00.000Z'); // 6/27(土) 0:00 JST
  });

  it('基準日がすでに週開始曜日の場合はその日の 0:00 を返す', () => {
    const sunday = new Date('2026-06-28T01:00:00Z'); // 6/28(日) 10:00 JST
    expect(startOfWeekInZone(sunday, TOKYO, 0).toISOString()).toBe('2026-06-27T15:00:00.000Z');
  });

  it('タイムゾーンによって週の開始日が変わる', () => {
    // 2026-06-28T02:00Z は東京では 6/28(日) 11:00、NY では 6/27(土) 22:00
    const date = new Date('2026-06-28T02:00:00Z');
    expect(dateKeyInZone(startOfWeekInZone(date, TOKYO, 0), TOKYO)).toBe('2026-06-28');
    expect(dateKeyInZone(startOfWeekInZone(date, NY, 0), NY)).toBe('2026-06-21');
  });
});

describe('startOfMonthInZone', () => {
  it('月の途中の日時からその月の 1 日 0:00 を返す', () => {
    const date = new Date('2026-07-15T01:00:00Z'); // 7/15 10:00 JST
    expect(startOfMonthInZone(date, TOKYO).toISOString()).toBe('2026-06-30T15:00:00.000Z');
  });

  it('タイムゾーンによって属する月が変わる', () => {
    const date = new Date('2026-06-30T20:00:00Z'); // 東京 7/1 / NY 6/30
    expect(startOfMonthInZone(date, TOKYO).toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST
    expect(startOfMonthInZone(date, NY).toISOString()).toBe('2026-06-01T04:00:00.000Z'); // 6/1 0:00 EDT
  });
});

describe('startOfYearInZone', () => {
  it('年初(Asia/Tokyo)の日時はそのまま同じ年初 0:00 を返す', () => {
    const date = new Date('2025-12-31T15:00:00Z'); // 2026-01-01 0:00 JST
    expect(startOfYearInZone(date, TOKYO).toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('年央の日時から年初 0:00 へ正規化する', () => {
    const date = new Date('2026-07-15T01:00:00Z'); // 7/15 10:00 JST
    expect(startOfYearInZone(date, TOKYO).toISOString()).toBe('2025-12-31T15:00:00.000Z'); // 2026-01-01 0:00 JST
  });

  it('1月1日の深夜 0:00 が存在しないゾーンでは、繰り上げられた実在時刻を返す（America/Lima・startOfDayInZone 由来の挙動）', () => {
    const midYear = new Date('1990-07-15T00:00:00Z'); // 1990 年内の任意の日時
    expect(startOfYearInZone(midYear, LIMA).toISOString()).toBe('1990-01-01T05:00:00.000Z'); // 1/1 1:00（繰り上げ）
  });
});

describe('addMonthsInZone', () => {
  it('1/31 + 1 ヶ月は月末（2026-02-28）にクランプされる', () => {
    const date = new Date('2026-01-31T01:00:00Z'); // 1/31 10:00 JST
    expect(addMonthsInZone(date, 1, TOKYO).toISOString()).toBe('2026-02-28T01:00:00.000Z'); // 2/28 10:00 JST
  });

  it('うるう年は 2/29 にクランプされる', () => {
    const date = new Date('2028-01-31T01:00:00Z'); // 2028/1/31 10:00 JST
    expect(addMonthsInZone(date, 1, TOKYO).toISOString()).toBe('2028-02-29T01:00:00.000Z');
  });

  it('負数で減算でき、月末クランプも働く', () => {
    const date = new Date('2026-03-31T01:00:00Z'); // 3/31 10:00 JST
    expect(addMonthsInZone(date, -1, TOKYO).toISOString()).toBe('2026-02-28T01:00:00.000Z');
  });

  it('通常の加算は同じ日・同じ現地時刻を維持する', () => {
    const date = new Date('2026-07-15T01:00:00Z'); // 7/15 10:00 JST
    expect(addMonthsInZone(date, 1, TOKYO).toISOString()).toBe('2026-08-15T01:00:00.000Z');
  });

  it('DST を跨いでも現地時刻が維持される', () => {
    const date = new Date('2026-02-15T14:00:00Z'); // 2/15 9:00 EST
    // 3/15 9:00 EDT（UTC-4）
    expect(addMonthsInZone(date, 1, NY).toISOString()).toBe('2026-03-15T13:00:00.000Z');
  });

  it('年を跨ぐ加算ができる', () => {
    const date = new Date('2026-11-15T01:00:00Z'); // 11/15 10:00 JST
    expect(addMonthsInZone(date, 2, TOKYO).toISOString()).toBe('2027-01-15T01:00:00.000Z');
  });
});

describe('monthGridRange', () => {
  it('2026-02（週開始=日曜）はちょうど 4 週になる', () => {
    const anchor = new Date('2026-02-10T01:00:00Z'); // 2/10 10:00 JST
    const range = monthGridRange(anchor, TOKYO, 0);
    expect(range.start.toISOString()).toBe('2026-01-31T15:00:00.000Z'); // 2/1(日) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-02-28T15:00:00.000Z'); // 3/1(日) 0:00 JST（排他）
    expect(eachDayInRange(range, TOKYO)).toHaveLength(28);
  });

  it('2026-07（週開始=日曜）は 5 週になる', () => {
    const anchor = new Date('2026-07-15T01:00:00Z');
    const range = monthGridRange(anchor, TOKYO, 0);
    expect(range.start.toISOString()).toBe('2026-06-27T15:00:00.000Z'); // 6/28(日) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-08-01T15:00:00.000Z'); // 8/2(日) 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(35);
  });

  it('2026-08（週開始=日曜）は 6 週になる', () => {
    const anchor = new Date('2026-08-15T01:00:00Z');
    const range = monthGridRange(anchor, TOKYO, 0);
    expect(range.start.toISOString()).toBe('2026-07-25T15:00:00.000Z'); // 7/26(日) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-09-05T15:00:00.000Z'); // 9/6(日) 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(42);
  });

  it('2026-02（週開始=月曜）は 5 週になる', () => {
    const anchor = new Date('2026-02-10T01:00:00Z');
    const range = monthGridRange(anchor, TOKYO, 1);
    expect(range.start.toISOString()).toBe('2026-01-25T15:00:00.000Z'); // 1/26(月) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-03-01T15:00:00.000Z'); // 3/2(月) 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(35);
  });

  it('アンカーは月内のどの日時でも同じ範囲を返す', () => {
    const first = monthGridRange(new Date('2026-06-30T15:00:00Z'), TOKYO, 0); // 7/1 0:00 JST
    const last = monthGridRange(new Date('2026-07-31T14:59:59Z'), TOKYO, 0); // 7/31 23:59:59 JST
    expect(first.start.getTime()).toBe(last.start.getTime());
    expect(first.end.getTime()).toBe(last.end.getTime());
  });

  it('タイムゾーンを考慮して月を決定する（DST 跨ぎの 3 月 New York）', () => {
    const anchor = new Date('2026-03-15T12:00:00Z');
    const range = monthGridRange(anchor, NY, 0);
    // 3/1(日) 0:00 EST 〜 4/5(日) 0:00 EDT（3 月は 5 週）
    expect(range.start.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-04-05T04:00:00.000Z');
    expect(eachDayInRange(range, NY)).toHaveLength(35);
  });

  it('深夜 0:00 に DST が切り替わるゾーン（America/Santiago）を含む月でも、グリッド内の各日が正しい現地時刻 0:00 になる（回帰）', () => {
    const anchor = new Date('2026-09-15T12:00:00Z');
    const range = monthGridRange(anchor, SANTIAGO, 0);
    const days = eachDayInRange(range, SANTIAGO);
    // 切替日（9/6）だけ 1:00 に繰り上げられ、それ以外はすべて 0:00
    for (const day of days) {
      const minutes = minutesOfDayInZone(day, SANTIAGO);
      if (day.toISOString() === '2026-09-06T04:00:00.000Z') {
        expect(minutes).toBe(60);
      } else {
        expect(minutes).toBe(0);
      }
    }
  });
});

describe('eachDayInRange', () => {
  it('範囲内の各日の 0:00 を昇順で列挙する（end は排他）', () => {
    const range: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'), // 7/1 0:00 JST
      end: new Date('2026-07-03T15:00:00Z'), // 7/4 0:00 JST（排他）
    };
    const days = eachDayInRange(range, TOKYO);
    expect(days.map((d) => dateKeyInZone(d, TOKYO))).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-06-30T15:00:00.000Z',
      '2026-07-01T15:00:00.000Z',
      '2026-07-02T15:00:00.000Z',
    ]);
  });

  it('空の範囲（start === end）は空配列を返す', () => {
    const at = new Date('2026-06-30T15:00:00Z');
    expect(eachDayInRange({ start: at, end: at }, TOKYO)).toEqual([]);
  });

  it('start > end の場合も空配列を返す', () => {
    const range: DateRange = {
      start: new Date('2026-07-03T15:00:00Z'),
      end: new Date('2026-06-30T15:00:00Z'),
    };
    expect(eachDayInRange(range, TOKYO)).toEqual([]);
  });

  it('DST 開始（America/New_York の 3 月）を跨いでも 1 日ずつ正しく列挙される', () => {
    const range: DateRange = {
      start: new Date('2026-03-07T05:00:00Z'), // 3/7 0:00 EST
      end: new Date('2026-03-11T04:00:00Z'), // 3/11 0:00 EDT（排他）
    };
    const days = eachDayInRange(range, NY);
    expect(days.map((d) => dateKeyInZone(d, NY))).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    // 各要素はその日の現地時刻 0:00
    for (const day of days) {
      expect(minutesOfDayInZone(day, NY)).toBe(0);
    }
    // 3/8 は 23 時間しかない
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-03-07T05:00:00.000Z',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
      '2026-03-10T04:00:00.000Z',
    ]);
  });

  it('DST 終了（America/New_York の 11 月）を跨いでも 1 日ずつ正しく列挙される', () => {
    const range: DateRange = {
      start: new Date('2026-10-31T04:00:00Z'), // 10/31 0:00 EDT
      end: new Date('2026-11-03T05:00:00Z'), // 11/3 0:00 EST（排他）
    };
    const days = eachDayInRange(range, NY);
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-10-31T04:00:00.000Z',
      '2026-11-01T04:00:00.000Z', // 11/1 は 25 時間
      '2026-11-02T05:00:00.000Z',
    ]);
  });

  it('深夜 0:00 に DST が切り替わるゾーン（America/Santiago）を跨いでも 1 時間を引きずらない（回帰）', () => {
    // 2026-09-06 の America/Santiago は 0:00〜0:59 が存在せず 1:00 に繰り上げられる。
    // 単純にカーソルへ 1 日ずつ加算するだけだと、切替日で得た 1:00 という時刻が
    // 以降の全日に引き継がれてしまう（本来は切替翌日以降 0:00 に戻るべき）。
    const range: DateRange = {
      start: new Date('2026-09-04T04:00:00Z'), // 9/4 0:00 -04:00（切替前）
      end: new Date('2026-09-10T03:00:00Z'), // 9/10 0:00 -03:00（切替後、排他）
    };
    const days = eachDayInRange(range, SANTIAGO);
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-09-04T04:00:00.000Z', // 9/4 0:00 -04:00
      '2026-09-05T04:00:00.000Z', // 9/5 0:00 -04:00
      '2026-09-06T04:00:00.000Z', // 9/6 1:00 -03:00（0:00 が存在しないため繰り上げ）
      '2026-09-07T03:00:00.000Z', // 9/7 0:00 -03:00（切替翌日は 0:00 に戻る）
      '2026-09-08T03:00:00.000Z', // 9/8 0:00 -03:00
      '2026-09-09T03:00:00.000Z', // 9/9 0:00 -03:00
    ]);
    // 切替翌日以降はすべて現地時刻 0:00 であること
    for (const day of days.slice(3)) {
      expect(minutesOfDayInZone(day, SANTIAGO)).toBe(0);
    }
  });

  it('start が日の途中の場合、その日を含めて列挙する', () => {
    const range: DateRange = {
      start: new Date('2026-07-01T01:00:00Z'), // 7/1 10:00 JST
      end: new Date('2026-07-02T15:00:00Z'), // 7/3 0:00 JST（排他）
    };
    const days = eachDayInRange(range, TOKYO);
    expect(days.map((d) => dateKeyInZone(d, TOKYO))).toEqual(['2026-07-01', '2026-07-02']);
    expect(days[0]?.toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST
  });
});

describe('rangesOverlap', () => {
  const range = (start: string, end: string): DateRange => ({
    start: new Date(start),
    end: new Date(end),
  });

  it('[10:00, 11:00) と [11:00, 12:00) は重ならない（end は排他、TSDoc の @example）', () => {
    const a = range('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z');
    const b = range('2026-07-01T11:00:00Z', '2026-07-01T12:00:00Z');
    expect(rangesOverlap(a, b)).toBe(false);
    expect(rangesOverlap(b, a)).toBe(false);
  });

  it('部分的に重なる範囲は true', () => {
    const a = range('2026-07-01T10:00:00Z', '2026-07-01T11:30:00Z');
    const b = range('2026-07-01T11:00:00Z', '2026-07-01T12:00:00Z');
    expect(rangesOverlap(a, b)).toBe(true);
    expect(rangesOverlap(b, a)).toBe(true);
  });

  it('片方がもう片方を包含する場合は true', () => {
    const outer = range('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
    const inner = range('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z');
    expect(rangesOverlap(outer, inner)).toBe(true);
    expect(rangesOverlap(inner, outer)).toBe(true);
  });

  it('同一範囲は true', () => {
    const a = range('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z');
    expect(rangesOverlap(a, a)).toBe(true);
  });

  it('完全に離れた範囲は false', () => {
    const a = range('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z');
    const b = range('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z');
    expect(rangesOverlap(a, b)).toBe(false);
  });

  it('空範囲（start === end）はどの範囲とも重ならない', () => {
    const empty = range('2026-07-01T10:30:00Z', '2026-07-01T10:30:00Z');
    const around = range('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z');
    expect(rangesOverlap(empty, around)).toBe(false);
    expect(rangesOverlap(around, empty)).toBe(false);
  });
});

describe('visibleRangeFor', () => {
  const options = { weekStartsOn: 0, listDays: 30, multiMonthCount: 3 } as const;
  const current = new Date('2026-07-01T01:00:00Z'); // 7/1(水) 10:00 JST

  it('month: monthGridRange と一致する', () => {
    const range = visibleRangeFor('month', current, TOKYO, options);
    const grid = monthGridRange(current, TOKYO, 0);
    expect(range.start.getTime()).toBe(grid.start.getTime());
    expect(range.end.getTime()).toBe(grid.end.getTime());
  });

  it('week: 基準日を含む週の 7 日間', () => {
    const range = visibleRangeFor('week', current, TOKYO, options);
    expect(range.start.toISOString()).toBe('2026-06-27T15:00:00.000Z'); // 6/28(日) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-07-04T15:00:00.000Z'); // 7/5(日) 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(7);
  });

  it('week: 週開始=月曜を反映する', () => {
    const range = visibleRangeFor('week', current, TOKYO, {
      weekStartsOn: 1,
      listDays: 30,
      multiMonthCount: 3,
    });
    expect(range.start.toISOString()).toBe('2026-06-28T15:00:00.000Z'); // 6/29(月) 0:00 JST
    expect(range.end.toISOString()).toBe('2026-07-05T15:00:00.000Z'); // 7/6(月) 0:00 JST
  });

  it('day: 基準日の 1 日（0:00 から翌 0:00）', () => {
    const range = visibleRangeFor('day', current, TOKYO, options);
    expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });

  it('day: DST 開始日（America/New_York）は 23 時間になる', () => {
    const dstDay = new Date('2026-03-08T13:00:00Z'); // 3/8 9:00 EDT
    const range = visibleRangeFor('day', dstDay, NY, options);
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(range.end.getTime() - range.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('list: 基準日の 0:00 から listDays 日間', () => {
    const range = visibleRangeFor('list', current, TOKYO, options);
    expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST
    expect(range.end.toISOString()).toBe('2026-07-30T15:00:00.000Z'); // 7/31 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(30);
  });

  it('list: listDays の値を反映し、DST を跨いでも日数が正しい', () => {
    const start = new Date('2026-03-05T05:00:00Z'); // 3/5 0:00 EST
    const range = visibleRangeFor('list', start, NY, {
      weekStartsOn: 0,
      listDays: 7,
      multiMonthCount: 3,
    });
    expect(range.start.toISOString()).toBe('2026-03-05T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-12T04:00:00.000Z'); // 3/12 0:00 EDT
    expect(eachDayInRange(range, NY)).toHaveLength(7);
  });

  it('week: 週開始日に 0:00 が存在しない場合でも隣接週が 1 時間重複しない（America/Santiago 回帰）', () => {
    // 2026-09-06（日）は週開始日だが現地 0:00 が存在せず 1:00 に繰り上げられる。
    // end を日の開始へ正規化しないと、翌週の start と 1 時間重複してしまう。
    const week1Anchor = new Date('2026-09-08T12:00:00Z'); // 切替週の火曜（現地時間）
    const week2Anchor = new Date('2026-09-15T12:00:00Z'); // 翌週の火曜
    const week1 = visibleRangeFor('week', week1Anchor, SANTIAGO, {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
    });
    const week2 = visibleRangeFor('week', week2Anchor, SANTIAGO, {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
    });
    expect(week1.start.toISOString()).toBe('2026-09-06T04:00:00.000Z'); // 9/6 1:00（繰り上げ）
    expect(week1.end.getTime()).toBe(week2.start.getTime());
    expect(week1.end.toISOString()).toBe('2026-09-13T03:00:00.000Z'); // 9/13 0:00
  });

  it('day: 深夜 0:00 に DST が切り替わる日を跨いでも前日の end と当日の start が一致する（回帰）', () => {
    const beforeSwitch = new Date('2026-09-05T12:00:00Z'); // 9/5（切替前日）
    const onSwitchDay = new Date('2026-09-06T12:00:00Z'); // 9/6（切替当日）
    const dayBefore = visibleRangeFor('day', beforeSwitch, SANTIAGO, options);
    const dayOf = visibleRangeFor('day', onSwitchDay, SANTIAGO, options);
    expect(dayBefore.end.getTime()).toBe(dayOf.start.getTime());
  });

  it('list: 週開始日に 0:00 が存在しない場合でも end が正しく日の開始へ正規化される（回帰）', () => {
    // start がちょうど切替日（9/6, 1:00 に繰り上げ）になるよう anchor を選ぶ
    const anchor = new Date('2026-09-06T12:00:00Z');
    const range = visibleRangeFor('list', anchor, SANTIAGO, {
      weekStartsOn: 0,
      listDays: 7,
      multiMonthCount: 3,
    });
    expect(range.start.toISOString()).toBe('2026-09-06T04:00:00.000Z'); // 9/6 1:00（繰り上げ）
    expect(range.end.toISOString()).toBe('2026-09-13T03:00:00.000Z'); // 9/13 0:00
    expect(minutesOfDayInZone(range.end, SANTIAGO)).toBe(0);
  });

  it('year: 基準日を含む年（年初 0:00 から翌年初 0:00 まで）', () => {
    const range = visibleRangeFor('year', current, TOKYO, options);
    expect(range.start.toISOString()).toBe('2025-12-31T15:00:00.000Z'); // 2026-01-01 0:00 JST
    expect(range.end.toISOString()).toBe('2026-12-31T15:00:00.000Z'); // 2027-01-01 0:00 JST
  });

  it('year: 年またぎ（12/31）の基準日でも同じ年の範囲になる', () => {
    const dec31 = new Date('2026-12-31T01:00:00Z'); // 12/31(木) 10:00 JST
    const range = visibleRangeFor('year', dec31, TOKYO, options);
    expect(range.start.toISOString()).toBe('2025-12-31T15:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('year: うるう年（2024 年）でも年初〜翌年初の範囲になり、366 日ある', () => {
    const leapMid = new Date('2024-02-20T01:00:00Z'); // 2024/2/20(火) 10:00 JST
    const range = visibleRangeFor('year', leapMid, TOKYO, options);
    expect(range.start.toISOString()).toBe('2023-12-31T15:00:00.000Z'); // 2024-01-01 0:00 JST
    expect(range.end.toISOString()).toBe('2024-12-31T15:00:00.000Z'); // 2025-01-01 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(366);
  });

  it('multiMonth: 基準日を含む月の月初 0:00 から multiMonthCount ヶ月後の月初 0:00 まで', () => {
    const range = visibleRangeFor('multiMonth', current, TOKYO, {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
    });
    expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST
    expect(range.end.toISOString()).toBe('2026-09-30T15:00:00.000Z'); // 10/1 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(31 + 31 + 30); // 7月+8月+9月
  });

  it('multiMonth: multiMonthCount の値を反映する（1 なら翌月初までの 1 ヶ月分）', () => {
    const range = visibleRangeFor('multiMonth', current, TOKYO, {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 1,
    });
    expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST
    expect(range.end.toISOString()).toBe('2026-07-31T15:00:00.000Z'); // 8/1 0:00 JST
    expect(eachDayInRange(range, TOKYO)).toHaveLength(31);
  });

  it('multiMonth: 月末の基準日でもその月の月初から始まる範囲になる（月末アンカー）', () => {
    const monthEndAnchor = new Date('2026-07-31T01:00:00Z'); // 7/31(金) 10:00 JST
    const range = visibleRangeFor('multiMonth', monthEndAnchor, TOKYO, {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
    });
    expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z'); // 7/1 0:00 JST（7/31 ではない）
    expect(range.end.toISOString()).toBe('2026-09-30T15:00:00.000Z'); // 10/1 0:00 JST
  });
});

describe('navigateDate', () => {
  const options = { listDays: 30, multiMonthCount: 3 };
  const current = new Date('2026-07-15T01:00:00Z'); // 7/15 10:00 JST

  it('month: +1 は翌月の月初 0:00 に正規化される', () => {
    expect(navigateDate('month', current, 1, TOKYO, options).toISOString()).toBe(
      '2026-07-31T15:00:00.000Z', // 8/1 0:00 JST
    );
  });

  it('month: -1 は前月の月初 0:00 に正規化される', () => {
    expect(navigateDate('month', current, -1, TOKYO, options).toISOString()).toBe(
      '2026-05-31T15:00:00.000Z', // 6/1 0:00 JST
    );
  });

  it('month: 1/31 から +1 でも 2/1 になる（月末クランプ後に月初へ正規化）', () => {
    const jan31 = new Date('2026-01-31T01:00:00Z'); // 1/31 10:00 JST
    expect(navigateDate('month', jan31, 1, TOKYO, options).toISOString()).toBe(
      '2026-01-31T15:00:00.000Z', // 2/1 0:00 JST
    );
  });

  it('week: ±7 日移動し、現地時刻を維持する', () => {
    expect(navigateDate('week', current, 1, TOKYO, options).toISOString()).toBe(
      '2026-07-22T01:00:00.000Z',
    );
    expect(navigateDate('week', current, -1, TOKYO, options).toISOString()).toBe(
      '2026-07-08T01:00:00.000Z',
    );
  });

  it('week: DST 開始を跨いでも現地時刻を維持する（America/New_York）', () => {
    const beforeDst = new Date('2026-03-04T14:00:00Z'); // 3/4(水) 9:00 EST
    expect(navigateDate('week', beforeDst, 1, NY, options).toISOString()).toBe(
      '2026-03-11T13:00:00.000Z', // 3/11(水) 9:00 EDT
    );
  });

  it('day: ±1 日移動する', () => {
    expect(navigateDate('day', current, 1, TOKYO, options).toISOString()).toBe(
      '2026-07-16T01:00:00.000Z',
    );
    expect(navigateDate('day', current, -1, TOKYO, options).toISOString()).toBe(
      '2026-07-14T01:00:00.000Z',
    );
  });

  it('day: DST 開始日を跨ぐ移動でも現地時刻を維持する', () => {
    const beforeDst = new Date('2026-03-07T14:00:00Z'); // 3/7 9:00 EST
    expect(navigateDate('day', beforeDst, 1, NY, options).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z', // 3/8 9:00 EDT
    );
  });

  it('list: ±listDays 日移動する', () => {
    const start = new Date('2026-07-01T01:00:00Z'); // 7/1 10:00 JST
    expect(navigateDate('list', start, 1, TOKYO, options).toISOString()).toBe(
      '2026-07-31T01:00:00.000Z',
    );
    expect(navigateDate('list', start, -1, TOKYO, options).toISOString()).toBe(
      '2026-06-01T01:00:00.000Z',
    );
  });

  it('list: listDays の値を反映する', () => {
    const start = new Date('2026-07-01T01:00:00Z');
    expect(
      navigateDate('list', start, 1, TOKYO, { listDays: 7, multiMonthCount: 3 }).toISOString(),
    ).toBe('2026-07-08T01:00:00.000Z');
  });

  it('UTC でも正しく動作する', () => {
    const utcDate = new Date('2026-07-01T00:00:00Z');
    expect(navigateDate('day', utcDate, 1, UTC, options).toISOString()).toBe(
      '2026-07-02T00:00:00.000Z',
    );
    expect(navigateDate('month', utcDate, 1, UTC, options).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('year: 年央の日付から +1 で翌年 1/1 0:00 に正規化される', () => {
    expect(navigateDate('year', current, 1, TOKYO, options).toISOString()).toBe(
      '2026-12-31T15:00:00.000Z', // 2027-01-01 0:00 JST
    );
  });

  it('year: 年央の日付から -1 で前年 1/1 0:00 に正規化される', () => {
    expect(navigateDate('year', current, -1, TOKYO, options).toISOString()).toBe(
      '2024-12-31T15:00:00.000Z', // 2025-01-01 0:00 JST
    );
  });

  it('multiMonth: +1 で multiMonthCount ヶ月後の月初 0:00 に正規化される', () => {
    expect(
      navigateDate('multiMonth', current, 1, TOKYO, {
        listDays: 30,
        multiMonthCount: 3,
      }).toISOString(),
    ).toBe('2026-09-30T15:00:00.000Z'); // 7/15 + 3ヶ月 → 10/1 0:00 JST
  });

  it('multiMonth: -1 で multiMonthCount ヶ月前の月初 0:00 に正規化される', () => {
    expect(
      navigateDate('multiMonth', current, -1, TOKYO, {
        listDays: 30,
        multiMonthCount: 3,
      }).toISOString(),
    ).toBe('2026-03-31T15:00:00.000Z'); // 7/15 - 3ヶ月 → 4/1 0:00 JST
  });

  it('multiMonth: multiMonthCount の値を反映する（1 なら ±1 ヶ月移動）', () => {
    expect(
      navigateDate('multiMonth', current, 1, TOKYO, {
        listDays: 30,
        multiMonthCount: 1,
      }).toISOString(),
    ).toBe('2026-07-31T15:00:00.000Z'); // 7/15 + 1ヶ月 → 8/1 0:00 JST
  });

  it('multiMonth: 月末の基準日から移動しても月初へ正規化される（1/31 から +1 でも 2/1 になる。month と同じクランプ挙動）', () => {
    const jan31 = new Date('2026-01-31T01:00:00Z'); // 1/31 10:00 JST
    expect(
      navigateDate('multiMonth', jan31, 1, TOKYO, {
        listDays: 30,
        multiMonthCount: 1,
      }).toISOString(),
    ).toBe('2026-01-31T15:00:00.000Z'); // 2/1 0:00 JST
  });
});
