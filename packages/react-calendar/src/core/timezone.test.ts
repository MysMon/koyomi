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
  isoWeekNumberInZone,
  isSameDayInZone,
  isValidTimeZone,
  minutesOfDayInZone,
  parseDateValue,
  parseSlotBoundaryTime,
  parseTimeOfDay,
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
  it('同一の絶対時刻をタイムゾーンごとの現地時刻の成分に分解する', () => {
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

  it('分・秒も現地時刻として返す', () => {
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

  it('ミリ秒も現地時刻の成分として返す', () => {
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

  it('存在しない時刻（2026-03-08 02:30 America/New_York）は 03:30 EDT に繰り上げて解決する', () => {
    const gap = fromWallClock({ year: 2026, month: 3, day: 8, hours: 2, minutes: 30 }, NY);
    expect(gap.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 繰り上げ解決の一貫性: 02:30 と 03:30 は同じ絶対時刻に解決される
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

  describe('曖昧な時刻の解決方法（disambiguation）', () => {
    it("'earlier' を明示しても省略時と同じ結果になる（既定 'earlier'）", () => {
      const parts = { year: 2026, month: 11, day: 1, hours: 1, minutes: 30 };
      expect(fromWallClock(parts, NY, 'earlier').getTime()).toBe(
        fromWallClock(parts, NY).getTime(),
      );
    });

    it("'later' は曖昧な時刻（2026-11-01 01:30 America/New_York）を遅い方のオフセット（EST）で解決する", () => {
      const result = fromWallClock(
        { year: 2026, month: 11, day: 1, hours: 1, minutes: 30 },
        NY,
        'later',
      );
      // EDT（UTC-4）の 05:30Z ではなく、切替後の EST（UTC-5）の 06:30Z
      expect(result.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    });

    it("'later' でも曖昧でない時刻は 'earlier' と同じ結果になる", () => {
      const summer = { year: 2026, month: 7, day: 1, hours: 10 };
      expect(fromWallClock(summer, NY, 'later').getTime()).toBe(
        fromWallClock(summer, NY).getTime(),
      );
      // 切替日でも曖昧な範囲（01:00〜02:00）の外は同じ
      const beforeWindow = { year: 2026, month: 11, day: 1, hours: 0, minutes: 30 };
      expect(fromWallClock(beforeWindow, NY, 'later').getTime()).toBe(
        fromWallClock(beforeWindow, NY).getTime(),
      );
      const afterWindow = { year: 2026, month: 11, day: 1, hours: 2 };
      expect(fromWallClock(afterWindow, NY, 'later').getTime()).toBe(
        fromWallClock(afterWindow, NY).getTime(),
      );
    });

    it("'later' でも存在しない時刻（春の切替）は直後の実在時刻に繰り上げて解決する", () => {
      const gap = fromWallClock(
        { year: 2026, month: 3, day: 8, hours: 2, minutes: 30 },
        NY,
        'later',
      );
      expect(gap.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it("'later' は 30 分単位のオフセット切替（Australia/Lord_Howe）でも遅い方に解決する", () => {
      // Lord Howe は 2026-04-05 02:00（+11）に時計を 01:30（+10:30）へ 30 分巻き戻す。
      // 01:45 は曖昧で、遅い方（+10:30）の解決は 2026-04-04T15:15Z
      const parts = { year: 2026, month: 4, day: 5, hours: 1, minutes: 45 };
      expect(fromWallClock(parts, 'Australia/Lord_Howe', 'later').toISOString()).toBe(
        '2026-04-04T15:15:00.000Z',
      );
    });

    it("'later' の結果も getWallClock で往復すると同じ現地時刻の成分になる", () => {
      const parts = {
        year: 2026,
        month: 11,
        day: 1,
        hours: 1,
        minutes: 30,
        seconds: 15,
        milliseconds: 250,
      };
      expect(getWallClock(fromWallClock(parts, NY, 'later'), NY)).toEqual(parts);
    });

    it("'later' でも不正な IANA タイムゾーン ID では Error を投げず Invalid Date を返す", () => {
      const result = fromWallClock({ year: 2026, month: 7, day: 1 }, 'Not/AZone', 'later');
      expect(Number.isNaN(result.getTime())).toBe(true);
    });
  });
});

describe('fromWallClock / getWallClock: 不正な IANA タイムゾーン ID', () => {
  // fromWallClock / getWallClock に不正な IANA タイムゾーン ID（存在しない ID など）を
  // 渡した場合は、setTimeZone や timeAxisZones とは異なり Error にはならず、無言で
  // NaN を返す。
  //
  // 空文字列 '' はこの一覧から意図的に除外している: @date-fns/tz の tzOffset は
  // オフセット文字列をキーにしたグローバルキャッシュを持ち、'UTC' の解決結果
  // （ICU 環境によっては "GMT" 接尾辞が空文字列になる）が '' というキーで
  // キャッシュされることがある。本ファイルは他のテストで 'UTC' を広く使うため、
  // '' を無効なタイムゾーンとして渡しても、その副作用でオフセット 0（有効な UTC 相当）
  // に解決されてしまい、NaN にならない（このファイル内の実行順序に依存する
  // ライブラリ側の挙動であり、本仕様が検証したい「不正な ID の拒否」とは無関係）。
  it.each([
    'Not/AZone',
    'garbage',
    'Asia/Nonexistent',
    'XYZ',
  ])('fromWallClock は不正な IANA タイムゾーン ID %s で Error を投げず、time が NaN の Invalid Date を返す', (invalidTimeZone) => {
    const instant = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, invalidTimeZone);
    expect(Number.isNaN(instant.getTime())).toBe(true);
  });

  it.each([
    'Not/AZone',
    'garbage',
    'Asia/Nonexistent',
    'XYZ',
  ])('getWallClock は不正な IANA タイムゾーン ID %s で Error を投げず、全成分が NaN の WallClockParts を返す', (invalidTimeZone) => {
    const wall = getWallClock(new Date('2026-07-01T00:00:00Z'), invalidTimeZone);
    expect(Number.isNaN(wall.year)).toBe(true);
    expect(Number.isNaN(wall.month)).toBe(true);
    expect(Number.isNaN(wall.day)).toBe(true);
    expect(Number.isNaN(wall.hours)).toBe(true);
    expect(Number.isNaN(wall.minutes)).toBe(true);
    expect(Number.isNaN(wall.seconds)).toBe(true);
    expect(Number.isNaN(wall.milliseconds)).toBe(true);
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

describe('fromWallClock: WallClockParts のオーバーフロー正規化', () => {
  // WallClockParts の各成分に暦上の範囲外の値（month: 13 や day: 32、day: 0 など）を
  // 渡した場合は Error にはならず、Date の setter と同じ繰り上げ/繰り下げ
  // （オーバーフロー）で正規化される。
  it('day: 32 を指定すると翌月の 1 日として解決される（例: 2026-01-32 → 2026-02-01）', () => {
    const instant = fromWallClock({ year: 2026, month: 1, day: 32 }, TOKYO);
    const wall = getWallClock(instant, TOKYO);
    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(2);
    expect(wall.day).toBe(1);
  });

  it('month: 13 を指定すると翌年の 1 月として解決される', () => {
    const instant = fromWallClock({ year: 2026, month: 13, day: 1 }, TOKYO);
    const wall = getWallClock(instant, TOKYO);
    expect(wall.year).toBe(2027);
    expect(wall.month).toBe(1);
    expect(wall.day).toBe(1);
  });

  it('day: 0 を指定すると前月の末日として解決される', () => {
    const instant = fromWallClock({ year: 2026, month: 1, day: 0 }, TOKYO);
    const wall = getWallClock(instant, TOKYO);
    expect(wall.year).toBe(2025);
    expect(wall.month).toBe(12);
    expect(wall.day).toBe(31);
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

  it('その日の 0:00 が DST により存在しない場合、直後の実在時刻（1:00）に繰り上げて解決する', () => {
    // America/Santiago は 2026-09-06 の 0:00 → 1:00 に夏時間へ切り替わる。
    const startOfDay = startOfDayInZone(new Date('2026-09-06T12:00:00Z'), 'America/Santiago');
    const wall = getWallClock(startOfDay, 'America/Santiago');
    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(9);
    expect(wall.day).toBe(6);
    expect(wall.hours).toBe(1);
    expect(wall.minutes).toBe(0);
  });
});

describe('addDaysInZone', () => {
  it('通常の日は 24 時間進む', () => {
    const date = new Date('2026-07-01T01:00:00Z'); // 7/1 10:00 JST
    expect(addDaysInZone(date, 1, TOKYO).toISOString()).toBe('2026-07-02T01:00:00.000Z');
  });

  it('DST 開始を跨いでも現地時刻が維持される（絶対差は 23 時間）', () => {
    const date = new Date('2026-03-07T14:00:00Z'); // 3/7 9:00 EST
    const next = addDaysInZone(date, 1, NY);
    expect(next.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // 3/8 9:00 EDT
    expect(getWallClock(next, NY).hours).toBe(9);
    expect(next.getTime() - date.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('DST 終了を跨いでも現地時刻が維持される（絶対差は 25 時間）', () => {
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

  it('年末（12/31）をまたぐと翌年 1/1 になる', () => {
    const date = new Date('2025-12-31T05:00:00Z'); // 東京 12/31 14:00
    const next = addDaysInZone(date, 1, TOKYO);
    const wall = getWallClock(next, TOKYO);
    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(1);
    expect(wall.day).toBe(1);
    expect(wall.hours).toBe(14);
  });

  it('うるう年の 2/28 をまたぐと 2/29 になる（2028 年はうるう年）', () => {
    const date = new Date('2028-02-28T05:00:00Z'); // 東京 2/28 14:00
    const next = addDaysInZone(date, 1, TOKYO);
    const wall = getWallClock(next, TOKYO);
    expect(wall.year).toBe(2028);
    expect(wall.month).toBe(2);
    expect(wall.day).toBe(29);
  });

  it('平年（うるう年でない）の 2/28 をまたぐと 3/1 になる（2026 年は平年）', () => {
    const date = new Date('2026-02-28T05:00:00Z'); // 東京 2/28 14:00
    const next = addDaysInZone(date, 1, TOKYO);
    const wall = getWallClock(next, TOKYO);
    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(3);
    expect(wall.day).toBe(1);
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

  it('現地時刻基準の加算のため、DST 開始跨ぎでは絶対時刻の差が指定分数と異なる', () => {
    const date = new Date('2026-03-08T05:00:00Z'); // 3/8 0:00 EST
    const result = addMinutesInZone(date, 180, NY);
    // 現地時刻は 0:00 + 180 分 = 3:00（EDT）。絶対差は 120 分になる
    expect(result.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(minutesOfDayInZone(result, NY)).toBe(180);
    expect(result.getTime() - date.getTime()).toBe(120 * 60 * 1000);
  });

  it('加算結果が存在しない時刻になる場合は繰り上げて解決される', () => {
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

  it('DST 開始日はスキップされた現地時刻を反映する', () => {
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
    it('タイムゾーンの現地時刻として解釈される', () => {
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

    it('存在しない時刻（DST の谷間）は繰り上げて解決される', () => {
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

describe('isoWeekNumberInZone', () => {
  it('1月初週: 2026-01-01（木曜）は 2026 年第 1 週', () => {
    // 2026-01-01 は木曜日（date-utils.test.ts の「2026-02-01 は日曜」と整合）
    expect(isoWeekNumberInZone(new Date('2026-01-01T00:00:00Z'), UTC)).toBe(1);
  });

  it('12月末週: 2024-12-31（火曜）は翌年（2025 年）第 1 週に属する', () => {
    expect(isoWeekNumberInZone(new Date('2024-12-31T00:00:00Z'), UTC)).toBe(1);
  });

  it('1月初週の逆パターン: 2023-01-01（日曜）は前年（2022 年）第 52 週に属する', () => {
    expect(isoWeekNumberInZone(new Date('2023-01-01T00:30:00Z'), UTC)).toBe(52);
  });

  it('タイムゾーンによって週番号が変わる（同一時点でも現地日付が異なれば ISO 週も異なる）', () => {
    const instant = new Date('2023-01-01T23:30:00Z');
    // UTC では 2023-01-01（日曜）で 2022 年第 52 週
    expect(isoWeekNumberInZone(instant, UTC)).toBe(52);
    // 東京では 2023-01-02（月曜）で 2023 年第 1 週
    expect(isoWeekNumberInZone(instant, TOKYO)).toBe(1);
  });

  it('通常週（年をまたがない）の週番号', () => {
    // 2026-07-01（水）を含む週の木曜日は 2026-07-02
    expect(isoWeekNumberInZone(new Date('2026-07-01T15:00:00Z'), UTC)).toBe(27);
  });
});

describe('parseTimeOfDay', () => {
  it("'09:00' は 540 分になる", () => {
    expect(parseTimeOfDay('09:00')).toBe(540);
  });

  it('境界値: 00:00 と 23:59', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('不正な形式は Error になる', () => {
    expect(() => parseTimeOfDay('9:00')).toThrow();
    expect(() => parseTimeOfDay('24:00')).toThrow();
    expect(() => parseTimeOfDay('12:60')).toThrow();
    expect(() => parseTimeOfDay('not-a-time')).toThrow();
  });
});

describe('parseSlotBoundaryTime', () => {
  it("'24:00' は特例で 1440 になる（parseTimeOfDay は 24:00 を Error にするが、こちらは許容する）", () => {
    expect(parseSlotBoundaryTime('24:00')).toBe(1440);
  });

  it("'24:00' 以外は parseTimeOfDay と同じ結果になる", () => {
    expect(parseSlotBoundaryTime('09:00')).toBe(parseTimeOfDay('09:00'));
    expect(parseSlotBoundaryTime('00:00')).toBe(parseTimeOfDay('00:00'));
    expect(parseSlotBoundaryTime('23:59')).toBe(parseTimeOfDay('23:59'));
  });

  it('不正な形式は Error になる（24:00 の特例以外は parseTimeOfDay に委譲）', () => {
    expect(() => parseSlotBoundaryTime('9:00')).toThrow();
    expect(() => parseSlotBoundaryTime('24:30')).toThrow();
    expect(() => parseSlotBoundaryTime('25:00')).toThrow();
    expect(() => parseSlotBoundaryTime('not-a-time')).toThrow();
  });
});

describe('formatSlotLabel', () => {
  describe("locale='ja'（既存の pad2 実装と完全一致する）", () => {
    it("540 分は '09:00' になる（TSDoc の @example）", () => {
      expect(formatSlotLabel(540, 'ja')).toBe('09:00');
    });

    it('境界値: 0 分と 1439 分', () => {
      expect(formatSlotLabel(0, 'ja')).toBe('00:00');
      expect(formatSlotLabel(1439, 'ja')).toBe('23:59');
    });

    it('1 桁の時・分はゼロ埋めされる', () => {
      expect(formatSlotLabel(65, 'ja')).toBe('01:05');
    });
  });

  describe("locale='en-US'（12h/AM-PM 表記になる）", () => {
    it("540 分は '09:00 AM' になる（TSDoc の @example）", () => {
      expect(formatSlotLabel(540, 'en-US')).toBe('09:00 AM');
    });

    it('境界値: 0 分は正午 12 時始まりの表記、1439 分は午後 11:59 になる', () => {
      expect(formatSlotLabel(0, 'en-US')).toBe('12:00 AM');
      expect(formatSlotLabel(1439, 'en-US')).toBe('11:59 PM');
    });

    it('1 桁の時・分はゼロ埋めされる', () => {
      expect(formatSlotLabel(65, 'en-US')).toBe('01:05 AM');
    });
  });
});
