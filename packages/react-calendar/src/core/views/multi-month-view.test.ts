import { describe, expect, it } from 'vitest';
import { fromWallClock } from '../timezone';
import type {
  CalendarEvent,
  EventOccurrence,
  EventSegment,
  MonthWeek,
  MultiMonthViewModel,
  TimeZoneId,
} from '../types';
import { buildMonthViewModel } from './month-view';
import { buildMultiMonthViewModel } from './multi-month-view';

const TOKYO: TimeZoneId = 'Asia/Tokyo';
const NEW_YORK: TimeZoneId = 'America/New_York';

/**
 * 指定タイムゾーンの現地時刻から絶対時刻を作るヘルパ。
 * テストの日時をすべて現地時刻で明示し、実行環境の TZ に依存させない。
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
 * テスト用のオカレンス（EventOccurrence）を構築するヘルパ。
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

/** buildMultiMonthViewModel の既定パラメータ（2026-07 起点・東京・週開始=日曜・3 ヶ月・now=7/7）。 */
function build(
  overrides: Partial<Parameters<typeof buildMultiMonthViewModel>[0]> = {},
): MultiMonthViewModel {
  return buildMultiMonthViewModel({
    currentDate: at(TOKYO, 2026, 7, 7),
    timeZone: TOKYO,
    occurrences: [],
    weekStartsOn: 0,
    dayMaxEvents: 4,
    multiMonthCount: 3,
    now: at(TOKYO, 2026, 7, 7, 12, 0),
    ...overrides,
  });
}

/** 週の配列を走査して、指定オカレンスキーのセグメントを（週番号つきで）収集するヘルパ。 */
function segmentsOf(
  weeks: readonly MonthWeek[],
  occurrenceKey: string,
): { week: number; segment: EventSegment }[] {
  const found: { week: number; segment: EventSegment }[] = [];
  weeks.forEach((week, index) => {
    for (const segment of week.segments) {
      if (segment.occurrence.key === occurrenceKey) {
        found.push({ week: index, segment });
      }
    }
  });
  return found;
}

describe('buildMultiMonthViewModel', () => {
  describe('月数と月キー', () => {
    it('multiMonthCount=3 で 3 ヶ月分になり、月キーが連続する', () => {
      const vm = build({ multiMonthCount: 3 });
      expect(vm.type).toBe('multiMonth');
      expect(vm.months).toHaveLength(3);
      expect(vm.months.map((month) => month.key)).toEqual(['2026-07', '2026-08', '2026-09']);
      // 先頭月の anchor が全体の anchor と一致する
      expect(vm.anchor.getTime()).toBe(at(TOKYO, 2026, 7, 1).getTime());
      expect(vm.months[0]?.anchor.getTime()).toBe(at(TOKYO, 2026, 7, 1).getTime());
    });

    it('multiMonthCount=1 で 1 ヶ月分になる', () => {
      const vm = build({ multiMonthCount: 1 });
      expect(vm.months).toHaveLength(1);
      expect(vm.months.map((month) => month.key)).toEqual(['2026-07']);
    });

    it('multiMonthCount=12 で 12 ヶ月分になり、年をまたいで月キーが連続する', () => {
      const vm = build({ multiMonthCount: 12 });
      expect(vm.months).toHaveLength(12);
      expect(vm.months[0]?.key).toBe('2026-07');
      expect(vm.months[5]?.key).toBe('2026-12');
      expect(vm.months[6]?.key).toBe('2027-01');
      expect(vm.months[11]?.key).toBe('2027-06');
    });

    it('各月の anchor はその月の月初 0:00 の絶対時刻になる', () => {
      const vm = build({ multiMonthCount: 3 });
      expect(vm.months[1]?.anchor.getTime()).toBe(at(TOKYO, 2026, 8, 1).getTime());
      expect(vm.months[2]?.anchor.getTime()).toBe(at(TOKYO, 2026, 9, 1).getTime());
    });

    it('weekdays は先頭月のビューモデルのものを流用する', () => {
      const vm = build({ weekStartsOn: 1 });
      expect(vm.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });
  });

  describe('月境界をまたぐ帯のクランプ', () => {
    // 7/31(金) 9:00 〜 8/1(土) 18:00。2026-08-01 は土曜であり、
    // 週開始=日曜のグリッドでは 7/26(日)〜8/1(土) が「7 月グリッドの最終週」であり、
    // 同時に「8 月グリッドの先頭週」でもある（週の途中に月境界がある週）
    it('週の途中に月境界がある週でも、両月にクランプされて現れ continuesBefore/After が立つ', () => {
      const occ = makeOccurrence('boundary', at(TOKYO, 2026, 7, 31, 9), at(TOKYO, 2026, 8, 1, 18));
      const vm = build({ occurrences: [occ], multiMonthCount: 2 });

      const julyMonth = vm.months[0];
      const augustMonth = vm.months[1];
      expect(julyMonth?.key).toBe('2026-07');
      expect(augustMonth?.key).toBe('2026-08');

      // 7 月側: 7/31 のみの span:1 になり、実際の終了(8/1)が segmentRange の
      // 終端(7/31)より後なので continuesAfter が立つ。週境界だけを見れば
      // 8/1 も同じ週に含まれるため、segmentRange の OR 条件がなければ検出できない
      const julyPlaced = segmentsOf(julyMonth?.weeks ?? [], occ.key);
      expect(julyPlaced).toHaveLength(1);
      expect(julyPlaced[0]?.segment).toMatchObject({
        span: 1,
        continuesBefore: false,
        continuesAfter: true,
      });

      // 8 月側: 8/1 のみの span:1 になり、実際の開始(7/31)が segmentRange の
      // 開始(8/1)より前なので continuesBefore が立つ。週境界だけを見れば
      // 7/31 も同じ週に含まれるため、これも OR 条件がなければ検出できない
      const augustPlaced = segmentsOf(augustMonth?.weeks ?? [], occ.key);
      expect(augustPlaced).toHaveLength(1);
      expect(augustPlaced[0]?.segment).toMatchObject({
        span: 1,
        continuesBefore: true,
        continuesAfter: false,
      });

      // どちらの月グリッドも「週の途中に月境界がある同じ暦週」（7/26〜8/1）に
      // このイベントを配置する。7 月グリッドではその週が最終週（週数 5 の週4）、
      // 8 月グリッドでは先頭週（週0）になる（月が変われば grid 内の週インデックスは
      // 変わるが、暦週としては同一）
      expect(julyPlaced[0]?.week).toBe((julyMonth?.weeks.length ?? 0) - 1);
      expect(augustPlaced[0]?.week).toBe(0);
    });

    it('前後月の日付セルに対応する位置にはセグメントが出ない', () => {
      const occ = makeOccurrence('boundary', at(TOKYO, 2026, 7, 31, 9), at(TOKYO, 2026, 8, 1, 18));
      const vm = build({ occurrences: [occ], multiMonthCount: 2 });
      const julyMonth = vm.months[0];
      const augustMonth = vm.months[1];

      // 7 月グリッドの最終週には前後月の日付として 8/1 が含まれるが、
      // そのセルにこのオカレンスのセグメントは現れない
      const julyLastWeek = julyMonth?.weeks[julyMonth.weeks.length - 1];
      const augFirstCol = julyLastWeek?.days.findIndex((day) => day.key === '2026-08-01') ?? -1;
      expect(augFirstCol).toBeGreaterThanOrEqual(0);
      for (const segment of julyLastWeek?.segments ?? []) {
        expect(segment.startCol + segment.span - 1).toBeLessThan(augFirstCol);
      }

      // 8 月グリッドの先頭週には前後月の日付として 7/31 が含まれるが、
      // そのセルにもこのオカレンスのセグメントは現れない
      const augFirstWeek = augustMonth?.weeks[0];
      const julyLastCol = augFirstWeek?.days.findIndex((day) => day.key === '2026-07-31') ?? -1;
      expect(julyLastCol).toBeGreaterThanOrEqual(0);
      for (const segment of augFirstWeek?.segments ?? []) {
        expect(segment.startCol).toBeGreaterThan(julyLastCol);
      }
    });

    it('前後月にのみ存在するオカレンスはセグメントを生成せず、あふれにも数えない', () => {
      // 6/28(グリッドの先頭日、7 月の前月日付)に 2 件重ねる
      const a = makeOccurrence('a', at(TOKYO, 2026, 6, 28, 9), at(TOKYO, 2026, 6, 28, 10));
      const b = makeOccurrence('b', at(TOKYO, 2026, 6, 28, 10), at(TOKYO, 2026, 6, 28, 11));
      const vm = build({ occurrences: [a, b], multiMonthCount: 1, dayMaxEvents: 1 });
      const julyMonth = vm.months[0];
      expect(segmentsOf(julyMonth?.weeks ?? [], a.key)).toHaveLength(0);
      expect(segmentsOf(julyMonth?.weeks ?? [], b.key)).toHaveLength(0);
      const firstWeek = julyMonth?.weeks[0];
      expect(firstWeek?.days[0]?.key).toBe('2026-06-28');
      expect(firstWeek?.days[0]?.overflowCount).toBe(0);
    });
  });

  describe('hiddenWeekdays（非表示曜日）', () => {
    it('全月に適用され、weekdays・各週の列数が揃って縮む', () => {
      const vm = build({ hiddenWeekdays: [0, 6], multiMonthCount: 2 });
      expect(vm.weekdays).toEqual([1, 2, 3, 4, 5]);
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week.days).toHaveLength(5);
        }
      }
    });
  });

  describe('showWeekNumbers（週番号）', () => {
    it('省略時（既定 false）は全月で各週の weekNumber が null になる', () => {
      const vm = build({ multiMonthCount: 2 });
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week.weekNumber).toBeNull();
        }
      }
    });

    it('false を明示しても全月で各週の weekNumber が null になる', () => {
      const vm = build({ showWeekNumbers: false, multiMonthCount: 2 });
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week.weekNumber).toBeNull();
        }
      }
    });

    it('true にすると各月の各週に ISO 8601 週番号が設定される（2026-07 は第27〜31週）', () => {
      const vm = build({ showWeekNumbers: true, multiMonthCount: 1 });
      const julyMonth = vm.months[0];
      expect(julyMonth?.weeks.map((week) => week.weekNumber)).toEqual([27, 28, 29, 30, 31]);
    });

    it('年跨ぎの月境界でも ISO 週番号が正しく算出される（2026-12→2027-01）', () => {
      const vm = buildMultiMonthViewModel({
        currentDate: at(TOKYO, 2026, 12, 7),
        timeZone: TOKYO,
        occurrences: [],
        weekStartsOn: 0,
        dayMaxEvents: 4,
        showWeekNumbers: true,
        multiMonthCount: 2,
        now: at(TOKYO, 2026, 12, 7, 12, 0),
      });
      const decMonth = vm.months[0];
      const janMonth = vm.months[1];
      expect(decMonth?.key).toBe('2026-12');
      expect(janMonth?.key).toBe('2027-01');
      // 2026-12-31(木) を含む週は ISO 週番号で 2026年第53週
      expect(decMonth?.weeks.at(-1)?.weekNumber).toBe(53);
      // 2027-01-01(金) を含む週も同じ暦週（12/28〜1/3）であり、木曜(12/31)が
      // 2026年に属するため、1 月グリッドの先頭週も 2026年第53週として現れる
      expect(janMonth?.weeks[0]?.weekNumber).toBe(53);
    });
  });

  describe('multiMonthCount: 1 と単体月ビューの違い', () => {
    it('月境界をまたぐ帯が前後月へ伸びない点で、同じ月を表示する月ビューと異なる', () => {
      const occ = makeOccurrence('boundary', at(TOKYO, 2026, 7, 31, 9), at(TOKYO, 2026, 8, 1, 18));

      // 月ビュー単体: 7/31〜8/1 はどちらもグリッド内（7 月グリッドは 6/28〜8/1）に
      // 収まるため、span:2 の 1 本の帯としてクランプされずに現れる
      const plainMonthVm = buildMonthViewModel({
        currentDate: at(TOKYO, 2026, 7, 7),
        timeZone: TOKYO,
        occurrences: [occ],
        weekStartsOn: 0,
        dayMaxEvents: 4,
        now: at(TOKYO, 2026, 7, 7, 12, 0),
      });
      const plainPlaced = segmentsOf(plainMonthVm.weeks, occ.key);
      expect(plainPlaced).toHaveLength(1);
      expect(plainPlaced[0]?.segment).toMatchObject({
        span: 2,
        continuesBefore: false,
        continuesAfter: false,
      });

      // 複数月ビュー（multiMonthCount: 1）: 同じ月を表示していても、
      // 予定は月本体（segmentRange）にクランプされ、8/1 へは伸びない
      const vm = build({ occurrences: [occ], multiMonthCount: 1 });
      const multiPlaced = segmentsOf(vm.months[0]?.weeks ?? [], occ.key);
      expect(multiPlaced).toHaveLength(1);
      expect(multiPlaced[0]?.segment).toMatchObject({
        span: 1,
        continuesBefore: false,
        continuesAfter: true,
      });
    });
  });

  describe('マルチタイムゾーン', () => {
    it('America/New_York でも月キー・各月の月初アンカーが現地時刻基準で計算される', () => {
      const vm = buildMultiMonthViewModel({
        currentDate: at(NEW_YORK, 2026, 7, 7),
        timeZone: NEW_YORK,
        occurrences: [],
        weekStartsOn: 0,
        dayMaxEvents: 4,
        multiMonthCount: 2,
        now: at(NEW_YORK, 2026, 7, 7, 12, 0),
      });
      expect(vm.months.map((month) => month.key)).toEqual(['2026-07', '2026-08']);
      expect(vm.anchor.getTime()).toBe(at(NEW_YORK, 2026, 7, 1).getTime());
      expect(vm.months[1]?.anchor.getTime()).toBe(at(NEW_YORK, 2026, 8, 1).getTime());
    });

    it('DST を跨ぐ月境界の帯も現地時刻の日付どおりにクランプされる（2026-03 NY）', () => {
      // NY の DST は 2026-03-08 2:00 に開始。2/28(土) 20:00 〜 3/2(月) 10:00 のイベント
      const occ = makeOccurrence(
        'dst',
        at(NEW_YORK, 2026, 2, 28, 20),
        at(NEW_YORK, 2026, 3, 2, 10),
      );
      const vm = buildMultiMonthViewModel({
        currentDate: at(NEW_YORK, 2026, 2, 15),
        timeZone: NEW_YORK,
        occurrences: [occ],
        weekStartsOn: 0,
        dayMaxEvents: 4,
        multiMonthCount: 2,
        now: at(NEW_YORK, 2026, 2, 15, 12, 0),
      });
      const febMonth = vm.months[0];
      const marMonth = vm.months[1];
      expect(febMonth?.key).toBe('2026-02');
      expect(marMonth?.key).toBe('2026-03');

      const febPlaced = segmentsOf(febMonth?.weeks ?? [], occ.key);
      expect(febPlaced).toHaveLength(1);
      expect(febPlaced[0]?.segment).toMatchObject({ continuesBefore: false, continuesAfter: true });

      const marPlaced = segmentsOf(marMonth?.weeks ?? [], occ.key);
      expect(marPlaced).toHaveLength(1);
      expect(marPlaced[0]?.segment).toMatchObject({ continuesBefore: true, continuesAfter: false });
    });
  });
});
