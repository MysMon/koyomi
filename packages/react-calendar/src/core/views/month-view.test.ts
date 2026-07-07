import { describe, expect, it } from 'vitest';
import { fromWallClock } from '../timezone';
import type {
  CalendarEvent,
  EventOccurrence,
  EventSegment,
  MonthViewModel,
  TimeZoneId,
  Weekday,
} from '../types';
import { buildMonthViewModel } from './month-view';

const TOKYO: TimeZoneId = 'Asia/Tokyo';
const NEW_YORK: TimeZoneId = 'America/New_York';

/**
 * 指定タイムゾーンの壁時計から絶対時刻を作るヘルパ。
 * テストの日時をすべて壁時計で明示し、実行環境の TZ に依存させない。
 */
function at(
  timeZone: TimeZoneId,
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
): Date {
  return fromWallClock({ year, month, day, hours, minutes }, timeZone);
}

/**
 * テスト用の発生（EventOccurrence）を構築するヘルパ。
 * `key` は `'<eventId>@<startISO>'` 形式にする。
 */
function makeOccurrence(id: string, start: Date, end: Date, allDay = false): EventOccurrence {
  const event: CalendarEvent = { id, title: `イベント ${id}`, start, end, allDay };
  return {
    key: `${id}@${start.toISOString()}`,
    eventId: id,
    event,
    start,
    end,
    allDay,
    isRecurring: false,
    originalStart: start,
  };
}

/** buildMonthViewModel の既定パラメータ（2026-07・東京・週開始=日曜・now=7/7）。 */
function build(overrides: Partial<Parameters<typeof buildMonthViewModel>[0]> = {}): MonthViewModel {
  return buildMonthViewModel({
    currentDate: at(TOKYO, 2026, 7, 7),
    timeZone: TOKYO,
    occurrences: [],
    weekStartsOn: 0,
    dayMaxEvents: 4,
    now: at(TOKYO, 2026, 7, 7, 12, 0),
    ...overrides,
  });
}

/** 全週を走査して、指定発生キーのセグメントを（週番号つきで）収集するヘルパ。 */
function segmentsOf(
  viewModel: MonthViewModel,
  occurrenceKey: string,
): { week: number; segment: EventSegment }[] {
  const found: { week: number; segment: EventSegment }[] = [];
  viewModel.weeks.forEach((week, index) => {
    for (const segment of week.segments) {
      if (segment.occurrence.key === occurrenceKey) {
        found.push({ week: index, segment });
      }
    }
  });
  return found;
}

describe('buildMonthViewModel', () => {
  describe('グリッド構造（2026-07・東京・週開始=日曜）', () => {
    it('5 週 × 7 日で構成され、anchor は月初 0:00 の絶対時刻になる', () => {
      const vm = build();
      expect(vm.type).toBe('month');
      expect(vm.weeks).toHaveLength(5);
      for (const week of vm.weeks) {
        expect(week.days).toHaveLength(7);
      }
      // 東京の 2026-07-01 0:00 = 2026-06-30T15:00:00Z
      expect(vm.anchor.getTime()).toBe(at(TOKYO, 2026, 7, 1).getTime());
    });

    it('日付キーが 2026-06-28 から 2026-08-01 まで連続する', () => {
      const vm = build();
      const keys = vm.weeks.flatMap((week) => week.days.map((day) => day.key));
      expect(keys).toHaveLength(35);
      expect(keys[0]).toBe('2026-06-28');
      expect(keys[3]).toBe('2026-07-01');
      expect(keys[34]).toBe('2026-08-01');
      // 重複がない = 連続した 35 日
      expect(new Set(keys).size).toBe(35);
    });

    it('日セルの date は表示タイムゾーンにおけるその日の 0:00 の絶対時刻になる', () => {
      const vm = build();
      const firstDay = vm.weeks[0]?.days[0];
      expect(firstDay?.date.getTime()).toBe(at(TOKYO, 2026, 6, 28).getTime());
    });

    it('inCurrentMonth は 7 月の日のみ true になる（前後月の埋め草は false）', () => {
      const vm = build();
      const days = vm.weeks.flatMap((week) => [...week.days]);
      for (const day of days) {
        const expected = day.key.startsWith('2026-07-');
        expect(day.inCurrentMonth, `key=${day.key}`).toBe(expected);
      }
      // 6/28〜6/30 と 8/1 の計 4 日が埋め草
      expect(days.filter((day) => !day.inCurrentMonth)).toHaveLength(4);
    });

    it('isToday は now の日（7/7）のみ true になる', () => {
      const vm = build();
      const days = vm.weeks.flatMap((week) => [...week.days]);
      const todays = days.filter((day) => day.isToday);
      expect(todays).toHaveLength(1);
      expect(todays[0]?.key).toBe('2026-07-07');
      // 7/5(日) 始まりの週の 3 列目（火曜）
      expect(vm.weeks[1]?.days[2]?.isToday).toBe(true);
    });

    it('weekdays は週開始曜日（日曜）から始まる 7 曜日になる', () => {
      const vm = build();
      expect(vm.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('週開始=月曜のとき weekdays は月曜始まりになり、グリッドは 6/29 始まりになる', () => {
      const weekStartsOn: Weekday = 1;
      const vm = build({ weekStartsOn });
      expect(vm.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
      expect(vm.weeks).toHaveLength(5);
      expect(vm.weeks[0]?.days[0]?.key).toBe('2026-06-29');
      expect(vm.weeks[4]?.days[6]?.key).toBe('2026-08-02');
    });
  });

  describe('セグメント配置', () => {
    it('単日イベントは該当週の該当列に span 1 で配置される', () => {
      const occ = makeOccurrence('single', at(TOKYO, 2026, 7, 7, 10), at(TOKYO, 2026, 7, 7, 11));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      const found = placed[0];
      expect(found?.week).toBe(1);
      expect(found?.segment).toMatchObject({
        startCol: 2,
        span: 1,
        lane: 0,
        continuesBefore: false,
        continuesAfter: false,
        hidden: false,
      });
      expect(vm.weeks[1]?.laneCount).toBe(1);
    });

    it('金〜火の週跨ぎイベントは 2 週に分割され continuesBefore/After が立つ', () => {
      // 7/10(金) 9:00 〜 7/14(火) 18:00
      const occ = makeOccurrence('fri-tue', at(TOKYO, 2026, 7, 10, 9), at(TOKYO, 2026, 7, 14, 18));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(2);
      // 1 週目（7/5〜7/11）: 金(5)〜土(6) の 2 列、後ろへ続く
      expect(placed[0]?.week).toBe(1);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 5,
        span: 2,
        continuesBefore: false,
        continuesAfter: true,
      });
      // 2 週目（7/12〜7/18）: 日(0)〜火(2) の 3 列、前から続く
      expect(placed[1]?.week).toBe(2);
      expect(placed[1]?.segment).toMatchObject({
        startCol: 0,
        span: 3,
        continuesBefore: true,
        continuesAfter: false,
      });
    });

    it('週内の segments はレーン昇順 → startCol 昇順で並ぶ', () => {
      // 長い帯（7/5〜7/8）がレーン 0、短い 2 件がレーン 1 の列 0 と列 2 に入る
      const long = makeOccurrence('long', at(TOKYO, 2026, 7, 5, 9), at(TOKYO, 2026, 7, 8, 10));
      const s1 = makeOccurrence('s1', at(TOKYO, 2026, 7, 5, 10), at(TOKYO, 2026, 7, 5, 11));
      const s2 = makeOccurrence('s2', at(TOKYO, 2026, 7, 7, 9), at(TOKYO, 2026, 7, 7, 10));
      // 入力順を意図的にシャッフルして、並び順が入力順に依存しないことを確認する
      const vm = build({ occurrences: [s2, long, s1] });
      const week = vm.weeks[1];
      expect(week?.segments.map((segment) => segment.occurrence.eventId)).toEqual([
        'long',
        's1',
        's2',
      ]);
      expect(week?.segments.map((segment) => segment.lane)).toEqual([0, 1, 1]);
      expect(week?.laneCount).toBe(2);
    });
  });

  describe('グリッド範囲のクリップ', () => {
    it('グリッド開始前から続くイベントは先頭列にクリップされ continuesBefore が立つ', () => {
      // 6/25 〜 6/29 12:00（グリッドは 6/28 から）
      const occ = makeOccurrence('before', at(TOKYO, 2026, 6, 25, 9), at(TOKYO, 2026, 6, 29, 12));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.week).toBe(0);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 0,
        span: 2, // 6/28, 6/29
        continuesBefore: true,
        continuesAfter: false,
      });
    });

    it('グリッド終了後まで続くイベントは末尾列にクリップされ continuesAfter が立つ', () => {
      // 7/31(金) 〜 8/3 10:00（グリッドは 8/1 まで）
      const occ = makeOccurrence('after', at(TOKYO, 2026, 7, 31, 9), at(TOKYO, 2026, 8, 3, 10));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.week).toBe(4);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 5, // 7/31 は金曜
        span: 2, // 7/31, 8/1
        continuesBefore: false,
        continuesAfter: true,
      });
    });

    it('グリッド範囲外のイベントはどの週にも現れない', () => {
      const past = makeOccurrence('past', at(TOKYO, 2026, 6, 1, 9), at(TOKYO, 2026, 6, 2, 9));
      const future = makeOccurrence('future', at(TOKYO, 2026, 8, 10, 9), at(TOKYO, 2026, 8, 11, 9));
      const vm = build({ occurrences: [past, future] });
      expect(segmentsOf(vm, past.key)).toHaveLength(0);
      expect(segmentsOf(vm, future.key)).toHaveLength(0);
    });

    it('グリッド開始 0:00 ちょうどに終わるイベントは現れない（end 排他）', () => {
      // 6/27 22:00 〜 6/28 0:00 は 6/27 のみの予定であり、グリッド（6/28〜）には現れない
      const occ = makeOccurrence('edge', at(TOKYO, 2026, 6, 27, 22), at(TOKYO, 2026, 6, 28, 0));
      const vm = build({ occurrences: [occ] });
      expect(segmentsOf(vm, occ.key)).toHaveLength(0);
    });
  });

  describe('あふれ（dayMaxEvents）', () => {
    it('dayMaxEvents=2 で 3 件重なる日は 3 件目が hidden になり overflowCount に計上される', () => {
      const a = makeOccurrence('a', at(TOKYO, 2026, 7, 7, 9), at(TOKYO, 2026, 7, 7, 10));
      const b = makeOccurrence('b', at(TOKYO, 2026, 7, 7, 10), at(TOKYO, 2026, 7, 7, 11));
      const c = makeOccurrence('c', at(TOKYO, 2026, 7, 7, 11), at(TOKYO, 2026, 7, 7, 12));
      const vm = build({ occurrences: [a, b, c], dayMaxEvents: 2 });
      const week = vm.weeks[1];
      expect(week?.segments).toHaveLength(3);
      // 開始が早い順にレーン 0, 1, 2 に積まれ、レーン 2 はあふれで hidden
      expect(
        week?.segments.map((segment) => ({
          id: segment.occurrence.eventId,
          lane: segment.lane,
          hidden: segment.hidden,
        })),
      ).toEqual([
        { id: 'a', lane: 0, hidden: false },
        { id: 'b', lane: 1, hidden: false },
        { id: 'c', lane: 2, hidden: true },
      ]);
      // laneCount は表示レーンのみ
      expect(week?.laneCount).toBe(2);
      // 7/7（列 2）の overflowCount = 1、他の日は 0
      expect(week?.days.map((day) => day.overflowCount)).toEqual([0, 0, 1, 0, 0, 0, 0]);
      // 他の週の overflowCount はすべて 0
      expect(vm.weeks[0]?.days.every((day) => day.overflowCount === 0)).toBe(true);
    });
  });

  describe('end 排他の境界', () => {
    it('22:00〜24:00 の予定は翌日に漏れない', () => {
      // end = 7/8 0:00（排他）なので 7/7 のみに表示される
      const occ = makeOccurrence('night', at(TOKYO, 2026, 7, 7, 22), at(TOKYO, 2026, 7, 8, 0));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.week).toBe(1);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 2, // 7/7（火）
        span: 1,
        continuesBefore: false,
        continuesAfter: false,
      });
    });

    it('0:00 ちょうどに終わる複数日イベントの終了日は前日になる', () => {
      // 7/6 22:00 〜 7/8 0:00 → 7/6・7/7 の 2 日間（7/8 には出ない）
      const occ = makeOccurrence('two-days', at(TOKYO, 2026, 7, 6, 22), at(TOKYO, 2026, 7, 8, 0));
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 1, // 7/6（月）
        span: 2, // 7/6, 7/7
        continuesBefore: false,
        continuesAfter: false,
      });
    });

    it('長さ 0 の発生は開始日のみに span 1 で現れる', () => {
      const instant = at(TOKYO, 2026, 7, 7, 10);
      const occ = makeOccurrence('zero', instant, instant);
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.week).toBe(1);
      expect(placed[0]?.segment).toMatchObject({ startCol: 2, span: 1 });
    });

    it('終日イベント（end 排他の日付境界）は end の前日までの帯になる', () => {
      // 7/1 0:00 〜 7/3 0:00 = 7/1・7/2 の 2 日間の終日イベント
      const occ = makeOccurrence('allday', at(TOKYO, 2026, 7, 1), at(TOKYO, 2026, 7, 3), true);
      const vm = build({ occurrences: [occ] });
      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(1);
      expect(placed[0]?.week).toBe(0);
      expect(placed[0]?.segment).toMatchObject({
        startCol: 3, // 7/1（水）
        span: 2, // 7/1, 7/2
        continuesBefore: false,
        continuesAfter: false,
      });
    });
  });

  describe('マルチタイムゾーン', () => {
    it('America/New_York では同じ瞬間が東京より前日の列に割り当てられる', () => {
      // 2026-07-06T17:00Z = 東京 7/7 2:00 = NY 7/6 13:00
      const start = new Date('2026-07-06T17:00:00Z');
      const end = new Date('2026-07-06T18:00:00Z');
      const occ = makeOccurrence('instant', start, end);

      const tokyoVm = build({ occurrences: [occ] });
      const tokyoPlaced = segmentsOf(tokyoVm, occ.key);
      expect(tokyoPlaced[0]?.week).toBe(1);
      expect(tokyoPlaced[0]?.segment.startCol).toBe(2); // 東京では 7/7（火）

      const nyVm = build({
        timeZone: NEW_YORK,
        currentDate: at(NEW_YORK, 2026, 7, 7),
        now: at(NEW_YORK, 2026, 7, 7, 12, 0),
        occurrences: [occ],
      });
      const nyPlaced = segmentsOf(nyVm, occ.key);
      expect(nyPlaced[0]?.week).toBe(1);
      expect(nyPlaced[0]?.segment.startCol).toBe(1); // NY では 7/6（月）
    });

    it('NY 表示でも 2026-07 のグリッドは 6/28 始まりで、日セルは NY の 0:00 になる', () => {
      const vm = build({
        timeZone: NEW_YORK,
        currentDate: at(NEW_YORK, 2026, 7, 7),
        now: at(NEW_YORK, 2026, 7, 7, 12, 0),
      });
      expect(vm.weeks).toHaveLength(5);
      const firstDay = vm.weeks[0]?.days[0];
      expect(firstDay?.key).toBe('2026-06-28');
      // NY（EDT, UTC-4）の 6/28 0:00 = 2026-06-28T04:00:00Z
      expect(firstDay?.date.toISOString()).toBe('2026-06-28T04:00:00.000Z');
      expect(vm.anchor.getTime()).toBe(at(NEW_YORK, 2026, 7, 1).getTime());
    });

    it('DST 開始日を跨ぐイベントも壁時計の日付どおりに配置される（2026-03 NY）', () => {
      // NY の DST は 2026-03-08 2:00 に開始。3/7(土) 20:00 〜 3/9(月) 10:00 のイベント
      const occ = makeOccurrence('dst', at(NEW_YORK, 2026, 3, 7, 20), at(NEW_YORK, 2026, 3, 9, 10));
      const vm = build({
        timeZone: NEW_YORK,
        currentDate: at(NEW_YORK, 2026, 3, 15),
        now: at(NEW_YORK, 2026, 3, 15, 12, 0),
        occurrences: [occ],
      });
      // 2026-03 は 3/1(日) 始まりの 5 週グリッド（3/1〜4/4）
      expect(vm.weeks).toHaveLength(5);
      expect(vm.weeks[0]?.days[0]?.key).toBe('2026-03-01');
      expect(vm.weeks[1]?.days[0]?.key).toBe('2026-03-08');
      expect(vm.weeks[1]?.days[1]?.key).toBe('2026-03-09');

      const placed = segmentsOf(vm, occ.key);
      expect(placed).toHaveLength(2);
      // 1 週目: 3/7(土) の 1 列のみ、後ろへ続く
      expect(placed[0]?.week).toBe(0);
      expect(placed[0]?.segment).toMatchObject({ startCol: 6, span: 1, continuesAfter: true });
      // 2 週目: 3/8(日)〜3/9(月) の 2 列、前から続く
      expect(placed[1]?.week).toBe(1);
      expect(placed[1]?.segment).toMatchObject({ startCol: 0, span: 2, continuesBefore: true });
    });
  });

  describe('空入力', () => {
    it('発生が空でも週と日は生成され、segments は空・overflowCount は 0 になる', () => {
      const vm = build({ occurrences: [] });
      expect(vm.weeks).toHaveLength(5);
      for (const week of vm.weeks) {
        expect(week.segments).toEqual([]);
        expect(week.laneCount).toBe(0);
        for (const day of week.days) {
          expect(day.overflowCount).toBe(0);
        }
      }
    });
  });
});
