import { describe, expect, it } from 'vitest';
import { fromWallClock } from '../timezone';
import type {
  CalendarEvent,
  EventOccurrence,
  TimeZoneId,
  Weekday,
  YearDay,
  YearMonth,
} from '../types';
import { buildYearViewModel } from './year-view';

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

/** buildYearViewModel の既定パラメータ（2026 年・東京・週開始=日曜・now=7/7）。 */
function build(
  overrides: Partial<Parameters<typeof buildYearViewModel>[0]> = {},
): ReturnType<typeof buildYearViewModel> {
  return buildYearViewModel({
    currentDate: at(TOKYO, 2026, 7, 7),
    timeZone: TOKYO,
    occurrences: [],
    weekStartsOn: 0,
    now: at(TOKYO, 2026, 7, 7, 12, 0),
    ...overrides,
  });
}

/** 月のすべての日セルをフラットな配列にする。 */
function daysOfMonth(month: YearMonth | undefined): readonly YearDay[] {
  return month === undefined ? [] : month.weeks.flat();
}

/** 指定した月オブジェクト内から、指定キーの日セルを探す。 */
function findDay(month: YearMonth | undefined, key: string): YearDay | undefined {
  return daysOfMonth(month).find((day) => day.key === key);
}

describe('buildYearViewModel', () => {
  describe('12 ヶ月構造（2026 年・東京・週開始=日曜）', () => {
    it('12 ヶ月分生成され、type/anchor/月キーが正しい', () => {
      const vm = build();
      expect(vm.type).toBe('year');
      expect(vm.anchor.getTime()).toBe(at(TOKYO, 2026, 1, 1).getTime());
      expect(vm.months).toHaveLength(12);
      expect(vm.months.map((month) => month.key)).toEqual([
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
        '2026-11',
        '2026-12',
      ]);
      expect(vm.months[6]?.anchor.getTime()).toBe(at(TOKYO, 2026, 7, 1).getTime());
    });

    it('各週は 7 日で構成される（hiddenWeekdays は存在せず常に 7 列）', () => {
      const vm = build();
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week).toHaveLength(7);
        }
      }
    });

    it('各月の週数は月ビューと同じグリッド規則で決まる（2026 年・週開始=日曜）', () => {
      const vm = build();
      // Google カレンダー式の動的行数（4〜6 週）。2026-07 が 5 週なのは
      // 既存の month-view.test.ts と同じ検証済みの値
      const expectedWeeks = [5, 4, 5, 5, 6, 5, 5, 6, 5, 5, 5, 5];
      expect(vm.months.map((month) => month.weeks.length)).toEqual(expectedWeeks);
    });

    it('weekdays は週開始曜日（日曜）から始まる 7 曜日になる', () => {
      const vm = build();
      expect(vm.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe('inCurrentMonth と前後月セル', () => {
    it('1 月グリッドの前月（2025 年）の日付セルは inCurrentMonth: false になる', () => {
      const vm = build();
      const jan = vm.months[0];
      const leadingDay = findDay(jan, '2025-12-29');
      expect(leadingDay).toBeDefined();
      expect(leadingDay?.inCurrentMonth).toBe(false);
    });

    it('前後月セルは eventCount が実際の予定件数に関わらず 0 に固定される', () => {
      // 6/29 に予定を 1 件配置。6 月自身のグリッドでは inCurrentMonth: true で
      // eventCount: 1 になるが、7 月グリッドの前月セル（6/29）は
      // inCurrentMonth: false のため、同じ日でも eventCount は 0 に固定される
      const occ = makeOccurrence('jun29', at(TOKYO, 2026, 6, 29, 10), at(TOKYO, 2026, 6, 29, 11));
      const vm = build({ occurrences: [occ] });

      const june = vm.months[5];
      const juneDay = findDay(june, '2026-06-29');
      expect(juneDay?.inCurrentMonth).toBe(true);
      expect(juneDay?.eventCount).toBe(1);

      const july = vm.months[6];
      const julyLeadingDay = findDay(july, '2026-06-29');
      expect(julyLeadingDay?.inCurrentMonth).toBe(false);
      expect(julyLeadingDay?.eventCount).toBe(0);
    });
  });

  describe('eventCount の集計', () => {
    it('空オカレンスなら、すべての日の eventCount が 0 になる', () => {
      const vm = build({ occurrences: [] });
      for (const month of vm.months) {
        for (const day of daysOfMonth(month)) {
          expect(day.eventCount).toBe(0);
        }
      }
    });

    it('複数日にまたがるオカレンスは覆う各日にカウントされる', () => {
      // 3/5 0:00 〜 3/8 0:00（end 排他）= 3/5・3/6・3/7 の 3 日間
      const occ = makeOccurrence('multi', at(TOKYO, 2026, 3, 5), at(TOKYO, 2026, 3, 8), true);
      const vm = build({ occurrences: [occ] });
      const march = vm.months[2];

      expect(findDay(march, '2026-03-04')?.eventCount).toBe(0);
      expect(findDay(march, '2026-03-05')?.eventCount).toBe(1);
      expect(findDay(march, '2026-03-06')?.eventCount).toBe(1);
      expect(findDay(march, '2026-03-07')?.eventCount).toBe(1);
      expect(findDay(march, '2026-03-08')?.eventCount).toBe(0);
    });

    it('長さ 0（start === end）のオカレンスは開始日に 1 カウントされる', () => {
      const instant = at(TOKYO, 2026, 5, 15, 10);
      const occ = makeOccurrence('zero', instant, instant);
      const vm = build({ occurrences: [occ] });
      const may = vm.months[4];
      expect(findDay(may, '2026-05-15')?.eventCount).toBe(1);
      expect(findDay(may, '2026-05-14')?.eventCount).toBe(0);
    });

    it('同じ日に複数のオカレンスがあれば eventCount が積み上がる', () => {
      const occA = makeOccurrence('a', at(TOKYO, 2026, 9, 10, 9), at(TOKYO, 2026, 9, 10, 10));
      const occB = makeOccurrence('b', at(TOKYO, 2026, 9, 10, 14), at(TOKYO, 2026, 9, 10, 15));
      const vm = build({ occurrences: [occA, occB] });
      const sep = vm.months[8];
      expect(findDay(sep, '2026-09-10')?.eventCount).toBe(2);
    });

    it('1 件の日と 100 件の日のどちらも eventCount > 0 になる（密度マーカーの表示判定は件数によらず二値）', () => {
      // 密度ドットは「予定が1件以上あるか」の二値表示であり、コアのビューモデルは
      // eventCount（実数）を返す。閲覧側の「表示あり/なし」判定（eventCount > 0）は
      // 1 件・100 件のどちらでも同じ結果になる（DOM 上の二値表示自体は
      // react/components/year-view.test.tsx で検証する）。
      const oneEventOcc = makeOccurrence(
        'one',
        at(TOKYO, 2026, 7, 10, 9),
        at(TOKYO, 2026, 7, 10, 10),
      );
      const manyOccurrences: EventOccurrence[] = Array.from({ length: 100 }, (_, i) =>
        makeOccurrence(`many-${i}`, at(TOKYO, 2026, 7, 20, 9), at(TOKYO, 2026, 7, 20, 9, 30)),
      );
      const vm = build({ occurrences: [oneEventOcc, ...manyOccurrences] });
      const july = vm.months[6];
      expect(findDay(july, '2026-07-10')?.eventCount).toBe(1);
      expect(findDay(july, '2026-07-20')?.eventCount).toBe(100);
    });

    it('年境界をまたぐ複数日オカレンス（2025-12-30〜2026-01-03）は年内の日（1/1, 1/2）にのみ加算される', () => {
      // end 排他: 12/30, 12/31, 1/1, 1/2 の 4 日間スパン。うち年内は 1/1・1/2 のみ
      const occ = makeOccurrence(
        'cross-year',
        at(TOKYO, 2025, 12, 30),
        at(TOKYO, 2026, 1, 3),
        true,
      );
      const vm = build({ occurrences: [occ] });
      const jan = vm.months[0];

      // 年内の日は正しく加算される
      expect(findDay(jan, '2026-01-01')?.eventCount).toBe(1);
      expect(findDay(jan, '2026-01-02')?.eventCount).toBe(1);
      // 年外の日（1 月グリッドの前月セルとして現れる 12/30, 12/31）は
      // inCurrentMonth: false のため 0 に固定される
      expect(findDay(jan, '2025-12-30')?.eventCount).toBe(0);
      expect(findDay(jan, '2025-12-31')?.eventCount).toBe(0);
    });

    it('年の全期間より前後に大きくはみ出すオカレンスも年内の全日に加算される', () => {
      const occ = makeOccurrence('huge', at(TOKYO, 2020, 1, 1), at(TOKYO, 2030, 1, 1), true);
      const vm = build({ occurrences: [occ] });
      const jan1 = findDay(vm.months[0], '2026-01-01');
      const dec31 = findDay(vm.months[11], '2026-12-31');
      expect(jan1?.eventCount).toBe(1);
      expect(dec31?.eventCount).toBe(1);
    });
  });

  describe('isToday', () => {
    it('now の日（7/7）のみ isToday: true になる', () => {
      const vm = build();
      const allDays = vm.months.flatMap((month) => daysOfMonth(month));
      const todays = allDays.filter((day) => day.isToday);
      // 7 月自身のグリッドで 1 回だけ現れる（他月の前後月セルとして 7/7 が
      // 現れることはない構造上の理由でここでは重複しない）
      expect(todays).toHaveLength(1);
      expect(todays[0]?.key).toBe('2026-07-07');
    });
  });

  describe('weekStartsOn の変更', () => {
    it('週開始=月曜のとき weekdays は月曜始まりになり、1 月グリッドは 2025-12-29 始まりになる', () => {
      const weekStartsOn: Weekday = 1;
      const vm = build({ weekStartsOn });
      expect(vm.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
      const jan = vm.months[0];
      expect(jan?.weeks[0]?.[0]?.key).toBe('2025-12-29');
      // 各週は引き続き 7 日
      for (const week of jan?.weeks ?? []) {
        expect(week).toHaveLength(7);
      }
    });
  });

  describe('マルチタイムゾーン', () => {
    it('America/New_York では同じ瞬間が東京より前年の日付になり、年内に加算されない', () => {
      // 東京 2026-01-01 2:00 = NY（EST, UTC-5）2025-12-31 12:00
      const instant = at(TOKYO, 2026, 1, 1, 2, 0);
      const occ = makeOccurrence('cross-tz', instant, instant);

      const tokyoVm = build({ occurrences: [occ] });
      expect(findDay(tokyoVm.months[0], '2026-01-01')?.eventCount).toBe(1);

      const nyVm = build({
        timeZone: NEW_YORK,
        currentDate: at(NEW_YORK, 2026, 7, 7),
        now: at(NEW_YORK, 2026, 7, 7, 12, 0),
        occurrences: [occ],
      });
      const nyTotal = nyVm.months
        .flatMap((month) => daysOfMonth(month))
        .reduce((sum, day) => sum + day.eventCount, 0);
      // NY では同じ瞬間が 2025-12-31（前年）に属するため、2026 年のどの日にも加算されない
      expect(nyTotal).toBe(0);
    });

    it('NY 表示でも 1 月グリッドの anchor は NY の月初 0:00 になる', () => {
      const vm = build({
        timeZone: NEW_YORK,
        currentDate: at(NEW_YORK, 2026, 7, 7),
        now: at(NEW_YORK, 2026, 7, 7, 12, 0),
      });
      expect(vm.anchor.getTime()).toBe(at(NEW_YORK, 2026, 1, 1).getTime());
      expect(vm.months[0]?.anchor.getTime()).toBe(at(NEW_YORK, 2026, 1, 1).getTime());
    });
  });
});
