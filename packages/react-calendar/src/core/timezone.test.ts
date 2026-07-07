/**
 * timezone.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' や 'UTC' を引数で明示して行う。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST → EDT、02:00〜02:59 は存在しない）
 * - 終了: 2026-11-01 02:00（EDT → EST、01:00〜01:59 は 2 回現れる）
 */
import { describe, expect, it } from 'vitest';
import {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  dateKeyInZone,
  formatSlotLabel,
  fromWallClock,
  getLocalTimeZone,
  getWallClock,
  isSameDayInZone,
  isValidTimeZone,
  minutesOfDayInZone,
  parseDateValue,
  startOfDayInZone,
  weekdayInZone,
} from './timezone';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const UTC = 'UTC';

describe('getLocalTimeZone', () => {
  it('実行環境のローカルタイムゾーン ID を返す（テストは TZ=Asia/Tokyo 固定）', () => {
    expect(getLocalTimeZone()).toBe('Asia/Tokyo');
  });

  it('返り値は有効な IANA タイムゾーン ID である', () => {
    expect(isValidTimeZone(getLocalTimeZone())).toBe(true);
  });
});

describe('isValidTimeZone', () => {
  it('有効な IANA タイムゾーン ID に true を返す', () => {
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('無効な文字列に false を返す', () => {
    expect(isValidTimeZone('Invalid/Zone')).toBe(false);
    expect(isValidTimeZone('こよみ')).toBe(false);
    expect(isValidTimeZone('Asia/Tokyo Japan')).toBe(false);
  });

  it('空文字に false を返す', () => {
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('getWallClock', () => {
  it('同一の絶対時刻をタイムゾーンごとの壁時計成分に分解する', () => {
    const date = new Date('2026-06-30T20:00:00Z');
    expect(getWallClock(date, TOKYO)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hours: 5,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    expect(getWallClock(date, NY)).toEqual({
      year: 2026,
      month: 6,
      day: 30,
      hours: 16,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    expect(getWallClock(date, UTC)).toEqual({
      year: 2026,
      month: 6,
      day: 30,
      hours: 20,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it('分・秒も壁時計として返す', () => {
    const date = new Date('2026-07-01T01:23:45Z');
    expect(getWallClock(date, TOKYO)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hours: 10,
      minutes: 23,
      seconds: 45,
      milliseconds: 0,
    });
  });

  it('ミリ秒も壁時計成分として返す', () => {
    const date = new Date('2026-07-01T01:23:45.678Z');
    expect(getWallClock(date, TOKYO)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hours: 10,
      minutes: 23,
      seconds: 45,
      milliseconds: 678,
    });
  });
});

describe('fromWallClock', () => {
  it('東京の 2026-07-01 10:00 は 2026-07-01T01:00:00Z になる（TSDoc の @example）', () => {
    const result = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, TOKYO);
    expect(result.toISOString()).toBe('2026-07-01T01:00:00.000Z');
  });

  it('時・分・秒を省略すると 0 として扱う', () => {
    const result = fromWallClock({ year: 2026, month: 7, day: 1 }, TOKYO);
    expect(result.toISOString()).toBe('2026-06-30T15:00:00.000Z');
  });

  it('America/New_York の DST 開始直前（EST, UTC-5）を正しく解決する', () => {
    const result = fromWallClock({ year: 2026, month: 3, day: 8, hours: 1, minutes: 59 }, NY);
    expect(result.toISOString()).toBe('2026-03-08T06:59:00.000Z');
  });

  it('America/New_York の DST 開始直後（EDT, UTC-4）を正しく解決する', () => {
    const result = fromWallClock({ year: 2026, month: 3, day: 8, hours: 3 }, NY);
    expect(result.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('存在しない時刻（2026-03-08 02:30 America/New_York）は前方（03:30 EDT）に解決する', () => {
    const gap = fromWallClock({ year: 2026, month: 3, day: 8, hours: 2, minutes: 30 }, NY);
    expect(gap.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 前方解決の一貫性: 02:30 と 03:30 は同じ絶対時刻に解決される
    const after = fromWallClock({ year: 2026, month: 3, day: 8, hours: 3, minutes: 30 }, NY);
    expect(gap.getTime()).toBe(after.getTime());
  });

  it('曖昧な時刻（2026-11-01 01:30 America/New_York）は早い方のオフセット（EDT）で解決する', () => {
    const result = fromWallClock({ year: 2026, month: 11, day: 1, hours: 1, minutes: 30 }, NY);
    expect(result.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('America/New_York の DST 終了前後の非曖昧な時刻を正しく解決する', () => {
    // 00:30 はまだ EDT（UTC-4）
    expect(
      fromWallClock({ year: 2026, month: 11, day: 1, hours: 0, minutes: 30 }, NY).toISOString(),
    ).toBe('2026-11-01T04:30:00.000Z');
    // 02:00 は EST（UTC-5）
    expect(fromWallClock({ year: 2026, month: 11, day: 1, hours: 2 }, NY).toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    );
  });

  it('getWallClock と往復できる（通常の時刻、ミリ秒も含む）', () => {
    const parts = {
      year: 2026,
      month: 7,
      day: 1,
      hours: 10,
      minutes: 30,
      seconds: 15,
      milliseconds: 250,
    };
    for (const tz of [TOKYO, NY, UTC]) {
      expect(getWallClock(fromWallClock(parts, tz), tz)).toEqual(parts);
    }
  });

  it('ミリ秒を省略すると 0 として扱う', () => {
    const result = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, UTC);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe('fromWallClock: 年 0〜99 の 2 桁年変換バグ回帰', () => {
  // TZDate の数値引数コンストラクタは Date コンストラクタの 2 桁年マッピング
  // （0〜99 年を 1900〜1999 年とみなす）を引き継いでしまう。
  // 過去の日付（例: 歴史イベントの記録）を UTC で扱うユースケースを想定し、
  // 2 桁年が誤って 19xx 年へ変換されないことを検証する。
  it('年 50 を 1950 年に変換しない', () => {
    const result = fromWallClock({ year: 50, month: 1, day: 1 }, UTC);
    expect(result.toISOString()).toBe('0050-01-01T00:00:00.000Z');
    expect(result.getUTCFullYear()).toBe(50);
  });

  it('年 0（西暦 0 年）も正しく扱う', () => {
    const result = fromWallClock({ year: 0, month: 1, day: 1 }, UTC);
    expect(result.getUTCFullYear()).toBe(0);
  });

  it('年 99 も正しく扱う', () => {
    const result = fromWallClock({ year: 99, month: 12, day: 31 }, UTC);
    expect(result.getUTCFullYear()).toBe(99);
    expect(result.getUTCMonth()).toBe(11);
    expect(result.getUTCDate()).toBe(31);
  });

  it('年 100 以降には影響しない（回帰確認）', () => {
    const result = fromWallClock({ year: 100, month: 1, day: 1 }, UTC);
    expect(result.getUTCFullYear()).toBe(100);
  });
});

describe('startOfDayInZone', () => {
  it('タイムゾーンごとに、その絶対時刻が属する日の 0:00 を返す', () => {
    const date = new Date('2026-06-30T20:00:00Z');
    // 東京では 7/1 5:00 → 7/1 0:00 JST
    expect(startOfDayInZone(date, TOKYO).toISOString()).toBe('2026-06-30T15:00:00.000Z');
    // New York では 6/30 16:00 EDT → 6/30 0:00 EDT
    expect(startOfDayInZone(date, NY).toISOString()).toBe('2026-06-30T04:00:00.000Z');
    // UTC では 6/30 0:00
    expect(startOfDayInZone(date, UTC).toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('DST 開始日（2026-03-08 America/New_York）の 0:00 は EST（UTC-5）である', () => {
    const date = new Date('2026-03-08T13:00:00Z'); // 3/8 9:00 EDT
    expect(startOfDayInZone(date, NY).toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('DST 終了日（2026-11-01 America/New_York）の 0:00 は EDT（UTC-4）である', () => {
    const date = new Date('2026-11-01T14:00:00Z'); // 11/1 9:00 EST
    expect(startOfDayInZone(date, NY).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('すでに 0:00 の時刻はそのままの絶対時刻を返す', () => {
    const midnight = new Date('2026-06-30T15:00:00Z'); // 7/1 0:00 JST
    expect(startOfDayInZone(midnight, TOKYO).getTime()).toBe(midnight.getTime());
  });
});

describe('addDaysInZone', () => {
  it('通常の日は 24 時間進む', () => {
    const date = new Date('2026-07-01T01:00:00Z'); // 7/1 10:00 JST
    expect(addDaysInZone(date, 1, TOKYO).toISOString()).toBe('2026-07-02T01:00:00.000Z');
  });

  it('DST 開始を跨いでも壁時計時刻が維持される（絶対差は 23 時間）', () => {
    const date = new Date('2026-03-07T14:00:00Z'); // 3/7 9:00 EST
    const next = addDaysInZone(date, 1, NY);
    expect(next.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // 3/8 9:00 EDT
    expect(getWallClock(next, NY).hours).toBe(9);
    expect(next.getTime() - date.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('DST 終了を跨いでも壁時計時刻が維持される（絶対差は 25 時間）', () => {
    const date = new Date('2026-10-31T13:00:00Z'); // 10/31 9:00 EDT
    const next = addDaysInZone(date, 1, NY);
    expect(next.toISOString()).toBe('2026-11-01T14:00:00.000Z'); // 11/1 9:00 EST
    expect(next.getTime() - date.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('負数で減算できる', () => {
    const date = new Date('2026-03-08T13:00:00Z'); // 3/8 9:00 EDT
    expect(addDaysInZone(date, -1, NY).toISOString()).toBe('2026-03-07T14:00:00.000Z');
  });

  it('0 を加算すると同じ絶対時刻を返す', () => {
    const date = new Date('2026-07-01T01:00:00Z');
    expect(addDaysInZone(date, 0, TOKYO).getTime()).toBe(date.getTime());
  });

  it('複数日をまとめて加算できる', () => {
    const date = new Date('2026-06-30T15:00:00Z'); // 7/1 0:00 JST
    expect(addDaysInZone(date, 30, TOKYO).toISOString()).toBe('2026-07-30T15:00:00.000Z');
  });
});

describe('addMinutesInZone', () => {
  it('通常の時間帯では絶対時刻の加算と一致する', () => {
    const date = new Date('2026-07-01T01:00:00Z'); // 7/1 10:00 JST
    expect(addMinutesInZone(date, 90, TOKYO).toISOString()).toBe('2026-07-01T02:30:00.000Z');
  });

  it('日を跨ぐ加算が正しく繰り上がる', () => {
    const date = new Date('2026-07-01T14:30:00Z'); // 7/1 23:30 JST
    const result = addMinutesInZone(date, 60, TOKYO);
    expect(getWallClock(result, TOKYO)).toEqual({
      year: 2026,
      month: 7,
      day: 2,
      hours: 0,
      minutes: 30,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it('0 分を加算するとミリ秒を含めて同じ絶対時刻を返す（回帰）', () => {
    const date = new Date('2026-07-01T01:00:00.123Z');
    expect(addMinutesInZone(date, 0, TOKYO).getTime()).toBe(date.getTime());
  });

  it('加算してもミリ秒が保持される', () => {
    const date = new Date('2026-07-01T01:00:00.123Z');
    const result = addMinutesInZone(date, 30, TOKYO);
    expect(result.getUTCMilliseconds()).toBe(123);
    expect(result.toISOString()).toBe('2026-07-01T01:30:00.123Z');
  });

  it('壁時計基準の加算のため、DST 開始跨ぎでは絶対時刻の差が指定分数と異なる', () => {
    const date = new Date('2026-03-08T05:00:00Z'); // 3/8 0:00 EST
    const result = addMinutesInZone(date, 180, NY);
    // 壁時計は 0:00 + 180 分 = 3:00（EDT）。絶対差は 120 分になる
    expect(result.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(minutesOfDayInZone(result, NY)).toBe(180);
    expect(result.getTime() - date.getTime()).toBe(120 * 60 * 1000);
  });

  it('加算結果が存在しない時刻になる場合は前方に解決される', () => {
    const date = new Date('2026-03-08T06:30:00Z'); // 3/8 1:30 EST
    // 1:30 + 60 分 = 2:30（存在しない）→ 3:30 EDT
    expect(addMinutesInZone(date, 60, NY).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('加算結果が曖昧な時刻になる場合は早い方のオフセットで解決される', () => {
    const date = new Date('2026-11-01T04:30:00Z'); // 11/1 0:30 EDT
    // 0:30 + 60 分 = 1:30（曖昧）→ EDT 側
    expect(addMinutesInZone(date, 60, NY).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('負数で減算できる', () => {
    const date = new Date('2026-07-01T01:00:00Z');
    expect(addMinutesInZone(date, -60, TOKYO).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('dateKeyInZone', () => {
  it('UTC の 2026-06-30T20:00Z は東京では 2026-07-01、New York では 2026-06-30 になる', () => {
    const date = new Date('2026-06-30T20:00:00Z');
    expect(dateKeyInZone(date, TOKYO)).toBe('2026-07-01');
    expect(dateKeyInZone(date, NY)).toBe('2026-06-30');
    expect(dateKeyInZone(date, UTC)).toBe('2026-06-30');
  });

  it('月・日が 1 桁の場合はゼロ埋めされる', () => {
    const date = new Date('2026-01-05T00:00:00Z');
    expect(dateKeyInZone(date, UTC)).toBe('2026-01-05');
  });
});

describe('dateFromKey', () => {
  it('日付キーからタイムゾーンにおけるその日の 0:00 を返す', () => {
    expect(dateFromKey('2026-07-01', TOKYO).toISOString()).toBe('2026-06-30T15:00:00.000Z');
    expect(dateFromKey('2026-07-01', NY).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(dateFromKey('2026-07-01', UTC).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('DST 開始日でも 0:00（EST）を返す', () => {
    expect(dateFromKey('2026-03-08', NY).toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('dateKeyInZone と往復できる', () => {
    for (const tz of [TOKYO, NY, UTC]) {
      expect(dateKeyInZone(dateFromKey('2026-07-01', tz), tz)).toBe('2026-07-01');
    }
  });

  it('形式が不正な場合は Error を投げる', () => {
    expect(() => dateFromKey('2026/07/01', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('2026-7-1', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('20260701', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('あいうえお', TOKYO)).toThrow(Error);
  });

  it('暦上存在しない日付は Error を投げる', () => {
    expect(() => dateFromKey('2026-02-30', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('2026-13-01', TOKYO)).toThrow(Error);
    expect(() => dateFromKey('2026-00-10', TOKYO)).toThrow(Error);
  });

  it('うるう年の 2/29 は有効', () => {
    expect(dateFromKey('2028-02-29', UTC).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(() => dateFromKey('2026-02-29', UTC)).toThrow(Error);
  });

  it('年 0〜99 の日付キーを 1900 年代へ変換しない（回帰）', () => {
    expect(dateFromKey('0050-01-01', UTC).toISOString()).toBe('0050-01-01T00:00:00.000Z');
    expect(dateFromKey('0001-06-15', UTC).toISOString()).toBe('0001-06-15T00:00:00.000Z');
  });
});

describe('minutesOfDayInZone', () => {
  it('同一の絶対時刻でもタイムゾーンごとに異なる分数を返す', () => {
    const date = new Date('2026-07-01T01:00:00Z');
    expect(minutesOfDayInZone(date, TOKYO)).toBe(600); // 10:00 JST
    expect(minutesOfDayInZone(date, NY)).toBe(1260); // 前日 21:00 EDT
    expect(minutesOfDayInZone(date, UTC)).toBe(60);
  });

  it('境界値: 0:00 は 0、23:59 は 1439 を返す', () => {
    expect(minutesOfDayInZone(new Date('2026-06-30T15:00:00Z'), TOKYO)).toBe(0);
    expect(minutesOfDayInZone(new Date('2026-07-01T14:59:00Z'), TOKYO)).toBe(1439);
  });

  it('DST 開始日はスキップされた壁時計時刻を反映する', () => {
    // 2026-03-08T07:00Z = 3:00 EDT（2:00〜2:59 は存在しない）
    expect(minutesOfDayInZone(new Date('2026-03-08T07:00:00Z'), NY)).toBe(180);
  });
});

describe('isSameDayInZone', () => {
  it('タイムゾーンによって同日判定が変わる', () => {
    const a = new Date('2026-06-30T20:00:00Z'); // 東京 7/1 5:00 / NY 6/30 16:00
    const b = new Date('2026-07-01T10:00:00Z'); // 東京 7/1 19:00 / NY 7/1 6:00
    expect(isSameDayInZone(a, b, TOKYO)).toBe(true);
    expect(isSameDayInZone(a, b, NY)).toBe(false);
  });

  it('同じ日の 0:00 と 23:59 は同日', () => {
    const start = new Date('2026-06-30T15:00:00Z'); // 7/1 0:00 JST
    const end = new Date('2026-07-01T14:59:59Z'); // 7/1 23:59:59 JST
    expect(isSameDayInZone(start, end, TOKYO)).toBe(true);
  });

  it('翌日の 0:00 は同日ではない（日境界は排他）', () => {
    const end = new Date('2026-07-01T14:59:59Z'); // 7/1 23:59:59 JST
    const nextMidnight = new Date('2026-07-01T15:00:00Z'); // 7/2 0:00 JST
    expect(isSameDayInZone(end, nextMidnight, TOKYO)).toBe(false);
  });
});

describe('weekdayInZone', () => {
  it('タイムゾーンによって曜日が変わる', () => {
    const date = new Date('2026-06-30T20:00:00Z');
    expect(weekdayInZone(date, TOKYO)).toBe(3); // 7/1 水曜
    expect(weekdayInZone(date, NY)).toBe(2); // 6/30 火曜
    expect(weekdayInZone(date, UTC)).toBe(2);
  });

  it('日曜は 0、土曜は 6 を返す', () => {
    expect(weekdayInZone(new Date('2026-07-05T00:00:00Z'), UTC)).toBe(0); // 日曜
    expect(weekdayInZone(new Date('2026-07-04T00:00:00Z'), UTC)).toBe(6); // 土曜
  });
});

describe('parseDateValue', () => {
  describe('Date 型', () => {
    it('そのまま絶対時刻として扱う', () => {
      const date = new Date('2026-07-01T10:00:00Z');
      expect(parseDateValue(date, TOKYO, false).getTime()).toBe(date.getTime());
    });

    it('allDay の場合はタイムゾーンにおけるその日の 0:00 に切り捨てる', () => {
      const date = new Date('2026-06-30T20:00:00Z');
      // 東京では 7/1 → 7/1 0:00 JST
      expect(parseDateValue(date, TOKYO, true).toISOString()).toBe('2026-06-30T15:00:00.000Z');
      // NY では 6/30 → 6/30 0:00 EDT
      expect(parseDateValue(date, NY, true).toISOString()).toBe('2026-06-30T04:00:00.000Z');
    });

    it('無効な Date（NaN）は Error を投げる', () => {
      expect(() => parseDateValue(new Date(Number.NaN), TOKYO, false)).toThrow(Error);
    });
  });

  describe('YYYY-MM-DD 形式', () => {
    it('タイムゾーンにおけるその日の 0:00 になる', () => {
      expect(parseDateValue('2026-07-01', TOKYO, false).toISOString()).toBe(
        '2026-06-30T15:00:00.000Z',
      );
      expect(parseDateValue('2026-07-01', NY, false).toISOString()).toBe(
        '2026-07-01T04:00:00.000Z',
      );
    });

    it('allDay でも同じ結果になる', () => {
      expect(parseDateValue('2026-07-01', TOKYO, true).toISOString()).toBe(
        '2026-06-30T15:00:00.000Z',
      );
    });

    it('暦上存在しない日付は Error を投げる', () => {
      expect(() => parseDateValue('2026-02-30', TOKYO, false)).toThrow(Error);
    });

    it('年 0〜99 を 1900 年代へ変換しない（回帰）', () => {
      expect(parseDateValue('0050-01-01', UTC, false).toISOString()).toBe(
        '0050-01-01T00:00:00.000Z',
      );
    });
  });

  describe('オフセット付き ISO 8601', () => {
    it('Z 付きは記載どおりの絶対時刻になる', () => {
      expect(parseDateValue('2026-07-01T10:00:00Z', TOKYO, false).toISOString()).toBe(
        '2026-07-01T10:00:00.000Z',
      );
    });

    it('±hh:mm 付きは記載どおりの絶対時刻になる（タイムゾーン引数の影響を受けない）', () => {
      expect(parseDateValue('2026-07-01T10:00:00+09:00', NY, false).toISOString()).toBe(
        '2026-07-01T01:00:00.000Z',
      );
      expect(parseDateValue('2026-07-01T10:00:00-04:00', TOKYO, false).toISOString()).toBe(
        '2026-07-01T14:00:00.000Z',
      );
    });

    it('ミリ秒付きも解釈できる', () => {
      expect(parseDateValue('2026-07-01T10:00:00.500Z', TOKYO, false).toISOString()).toBe(
        '2026-07-01T10:00:00.500Z',
      );
    });

    it('allDay の場合はタイムゾーンにおけるその日の 0:00 に切り捨てる', () => {
      // 2026-06-30T20:00Z は東京では 7/1
      expect(parseDateValue('2026-06-30T20:00:00Z', TOKYO, true).toISOString()).toBe(
        '2026-06-30T15:00:00.000Z',
      );
    });
  });

  describe('オフセットなし ISO 8601', () => {
    it('タイムゾーンの壁時計として解釈される', () => {
      expect(parseDateValue('2026-07-01T10:00', TOKYO, false).toISOString()).toBe(
        '2026-07-01T01:00:00.000Z',
      );
      expect(parseDateValue('2026-07-01T10:00', NY, false).toISOString()).toBe(
        '2026-07-01T14:00:00.000Z',
      );
    });

    it('秒付きも解釈できる', () => {
      expect(parseDateValue('2026-07-01T10:00:30', TOKYO, false).toISOString()).toBe(
        '2026-07-01T01:00:30.000Z',
      );
    });

    it('存在しない時刻（DST の谷間）は前方に解決される', () => {
      expect(parseDateValue('2026-03-08T02:30', NY, false).toISOString()).toBe(
        '2026-03-08T07:30:00.000Z',
      );
    });

    it('allDay の場合はその日の 0:00 に切り捨てる', () => {
      expect(parseDateValue('2026-07-01T10:00', TOKYO, true).toISOString()).toBe(
        '2026-06-30T15:00:00.000Z',
      );
    });

    it('時刻成分が範囲外の場合は Error を投げる', () => {
      expect(() => parseDateValue('2026-07-01T24:00', TOKYO, false)).toThrow(Error);
      expect(() => parseDateValue('2026-07-01T10:60', TOKYO, false)).toThrow(Error);
      expect(() => parseDateValue('2026-07-01T10:00:60', TOKYO, false)).toThrow(Error);
    });

    it('年 0〜99 を 1900 年代へ変換しない（回帰）', () => {
      expect(parseDateValue('0050-01-01T10:00', UTC, false).toISOString()).toBe(
        '0050-01-01T10:00:00.000Z',
      );
    });

    it('小数秒（ミリ秒）を解釈する（回帰: 従来は無警告で破棄されていた）', () => {
      expect(parseDateValue('2026-07-01T10:00:00.5', TOKYO, false).toISOString()).toBe(
        '2026-07-01T01:00:00.500Z',
      );
    });

    it('小数秒は 3 桁までに切り捨てられる', () => {
      expect(parseDateValue('2026-07-01T10:00:00.123456', TOKYO, false).toISOString()).toBe(
        '2026-07-01T01:00:00.123Z',
      );
    });

    it('小数秒の解釈はオフセット付き ISO 8601 と一貫する', () => {
      expect(parseDateValue('2026-07-01T10:00:00.500', TOKYO, false).getTime()).toBe(
        parseDateValue('2026-07-01T10:00:00.500+09:00', TOKYO, false).getTime(),
      );
    });
  });

  describe('不正入力', () => {
    it('解釈できない文字列は Error を投げる', () => {
      expect(() => parseDateValue('not-a-date', TOKYO, false)).toThrow(Error);
      expect(() => parseDateValue('', TOKYO, false)).toThrow(Error);
      expect(() => parseDateValue('2026-07-01 10:00', TOKYO, false)).toThrow(Error);
      expect(() => parseDateValue('2026-13-01T10:00:00Z', TOKYO, false)).toThrow(Error);
    });
  });
});

describe('formatSlotLabel', () => {
  it("540 分は '09:00' になる（TSDoc の @example）", () => {
    expect(formatSlotLabel(540)).toBe('09:00');
  });

  it('境界値: 0 分と 1439 分', () => {
    expect(formatSlotLabel(0)).toBe('00:00');
    expect(formatSlotLabel(1439)).toBe('23:59');
  });

  it('1 桁の時・分はゼロ埋めされる', () => {
    expect(formatSlotLabel(65)).toBe('01:05');
  });
});
