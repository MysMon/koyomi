/**
 * docs/timezones.md の記述のみから導出した仕様由来テスト。
 *
 * 本ファイルは実装（timezone.ts / calendar.ts 等の実装コード）を参照せずに書かれている。
 * 期待値はすべて docs/timezones.md 本文中の断定記述・コード例のコンソール出力コメントから
 * 導出したものであり、既存テスト（*.test.ts）の期待値を根拠にしていない。
 *
 * 既存テスト（timezone.test.ts / calendar.test.ts / expansion.test.ts / recurrence.test.ts /
 * views/time-grid-view.test.ts 等）との照合により、docs/timezones.md の記述の大半は
 * 既にテスト済みであることを確認した。本ファイルは照合の結果見つかった未カバーの仕様
 * （後述のテスト群）のみを追加する。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * 他タイムゾーンの検証は IANA タイムゾーン ID を明示して行う（既存テストの流儀）。
 */
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import { addDaysInZone, fromWallClock, getWallClock, startOfDayInZone } from './timezone';
import type { CalendarEvent } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

describe('CalendarEvent.timeZone 省略時のフォールバック', () => {
  // 出典: docs/timezones.md「イベントごとのタイムゾーン」
  // 「`CalendarEvent.timeZone` を指定すると、そのイベント固有のタイムゾーンとして扱われます。
  //   省略時はカレンダーの表示タイムゾーンが使われます。」
  // 「オフセットなし（例: '2026-07-01T10:00'）— timeZone（イベントの timeZone、なければ表示 TZ）
  //   における現地時刻として解釈される」
  //
  // 既存テストは「event.timeZone を明示した場合」（expansion.test.ts）と
  // 「event.timeZone 省略・表示 TZ も既定の Asia/Tokyo」（calendar.test.ts の MEETING）
  // の組み合わせのみを検証しており、表示 TZ を変えたときに実際にフォールバック先が
  // 変わることまでは直接確認していない。ここでは同一のイベント定義（timeZone 省略）を
  // 表示 TZ だけ変えた 2 つのカレンダーで解決し、絶対時刻が表示 TZ に追従することを確認する。
  it('非終日イベントの timeZone 省略時、オフセットなし文字列は表示タイムゾーンの現地時刻として解釈される', () => {
    const event: CalendarEvent = {
      id: 'no-tz',
      title: 'タイムゾーン省略イベント',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
    };

    const tokyoCalendar = createCalendar({ timeZone: TOKYO, events: [event] });
    const nyCalendar = createCalendar({ timeZone: NY, events: [event] });

    const range = {
      start: new Date('2026-07-01T00:00:00Z'),
      end: new Date('2026-07-02T00:00:00Z'),
    };
    const [tokyoOcc] = tokyoCalendar.getOccurrences(range);
    const [nyOcc] = nyCalendar.getOccurrences(range);

    // 東京 10:00 = UTC 01:00（JST は UTC+9、DST なし）
    expect(tokyoOcc?.start.toISOString()).toBe('2026-07-01T01:00:00.000Z');
    // NY 10:00 = UTC 14:00（2026-07-01 は夏時間中で EDT = UTC-4）
    expect(nyOcc?.start.toISOString()).toBe('2026-07-01T14:00:00.000Z');
  });
});

describe('now オプションの既定値', () => {
  // 出典: docs/timezones.md「now オプション（テスト・デモでの時刻固定）」
  // 「`CalendarOptions.now` は現在時刻を返す関数で......省略時は `() => new Date()` です。」
  it('now を省略すると実行時の現在時刻（new Date()）が使われる', () => {
    const systemNow = new Date('2026-07-07T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(systemNow);
    try {
      const calendar = createCalendar({ timeZone: TOKYO });
      calendar.today();
      expect(calendar.getState().currentDate.getTime()).toBe(systemNow.getTime());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('addDaysInZone: 月末・年末・うるう年の境界（現地時刻基準の加算）', () => {
  // 出典: docs/timezones.md タイムゾーンユーティリティ表
  // 「`addDaysInZone(date, amount, timeZone)` | 現地時刻基準で日数を加算する
  //   （DST を跨いでも現地時刻を維持する）」
  // この一般規則（現地時刻の年月日を維持したまま「日数を加算」する）から、
  // 月末・年末・うるう年をまたぐ場合も暦どおりに繰り上がることは記述から一意に導出できる
  // （「日を加算する」という定義自体が通常のグレゴリオ暦の日送りを意味するため）。
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
});

describe('存在しない時刻・曖昧な時刻の解決規則（docs/timezones.md 「存在しない時刻・曖昧な時刻の解決規則（DST）」）', () => {
  // 出典: docs/timezones.md（本追記分）:
  // 「存在しない時刻 — 直後の実在する時刻に繰り上げて解決します（例: 2:00 → 3:00 に
  //  進むゾーンで 2:30 を指定すると 3:30 として解決される）」
  it('DST で存在しない現地時刻（NY 2026-03-08 の 2:30）は、直後の実在時刻（3:30 EDT）に繰り上げて解決される', () => {
    const instant = fromWallClock({ year: 2026, month: 3, day: 8, hours: 2, minutes: 30 }, NY);
    const wall = getWallClock(instant, NY);
    expect(wall.hours).toBe(3);
    expect(wall.minutes).toBe(30);
  });

  // 出典: docs/timezones.md（本追記分）:
  // 「曖昧な時刻（2 回現れる時刻） — 2 回のうち早い方のオフセットで解決します」
  it('DST で二重に存在する現地時刻（NY 2026-11-01 の 1:30）は、早い方のオフセット（EDT）で解決される', () => {
    const instant = fromWallClock({ year: 2026, month: 11, day: 1, hours: 1, minutes: 30 }, NY);
    // 早い方のオフセット（EDT = UTC-4）: 2026-11-01 05:30:00Z
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  // 出典: docs/timezones.md（本追記分）:
  // 「startOfDayInZone / dateFromKey が返す「その日の 0:00」自体が、DST によりその日に
  //  存在しないケース(...)でも同じ規則が適用され、直後の実在時刻(例: 1:00)に
  //  繰り上げて解決されます。」
  // 具体例: America/Santiago は 2026-09-06 の 0:00 → 1:00 に夏時間へ切り替わる。
  it('その日の 0:00 が DST により存在しない場合、startOfDayInZone は直後の実在時刻（1:00）に繰り上げて解決する', () => {
    const startOfDay = startOfDayInZone(new Date('2026-09-06T12:00:00Z'), 'America/Santiago');
    const wall = getWallClock(startOfDay, 'America/Santiago');
    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(9);
    expect(wall.day).toBe(6);
    expect(wall.hours).toBe(1);
    expect(wall.minutes).toBe(0);
  });
});

describe('WallClockParts のオーバーフロー正規化（docs/timezones.md 「存在しない時刻・曖昧な時刻の解決規則（DST）」）', () => {
  // 出典: docs/timezones.md（本追記分）:
  // 「WallClockParts（fromWallClock の第 1 引数）の各成分に暦上の範囲外の値
  //  （month: 13 や day: 32、day: 0 など）を渡した場合は Error にはならず、Date の
  //  setter と同じ繰り上げ/繰り下げ（オーバーフロー）で正規化されます（例:
  //  { year: 2026, month: 1, day: 32 } は 2026-02-01 として解決される）。」
  it('day: 32 を指定すると翌月の 1 日として解決される（例示どおり 2026-01-32 → 2026-02-01）', () => {
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

describe('fromWallClock / getWallClock の不正な IANA タイムゾーン ID（docs/timezones.md 「存在しない時刻・曖昧な時刻の解決規則（DST）」）', () => {
  // 出典: docs/timezones.md（本追記分）:
  // 「fromWallClock / getWallClock に不正な IANA タイムゾーン ID（存在しない ID や
  //  空文字列など）を渡した場合は、setTimeZone や timeAxisZones とは異なり Error には
  //  なりません。両者とも無言で NaN を返します。」
  // 「fromWallClock — time が NaN の Invalid Date を返す」
  // 「getWallClock — 全成分（year / month / day / hours / minutes / seconds /
  //  milliseconds）が NaN の WallClockParts を返す」
  it.each([
    'Not/AZone',
    'garbage',
    '',
    'Asia/Nonexistent',
    'XYZ',
  ])('fromWallClock は不正な IANA タイムゾーン ID %s で Error を投げず、time が NaN の Invalid Date を返す', (invalidTimeZone) => {
    const instant = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, invalidTimeZone);
    expect(Number.isNaN(instant.getTime())).toBe(true);
  });

  it.each([
    'Not/AZone',
    'garbage',
    '',
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

describe('isoWeekNumberInZone / parseTimeOfDay がユーティリティ表に掲載されている（docs/timezones.md 「タイムゾーンユーティリティ」表）', () => {
  // 出典: docs/timezones.md タイムゾーンユーティリティ表（本追記分）:
  // 「isoWeekNumberInZone(date, timeZone) | 指定タイムゾーンにおける ISO 8601 週番号を返す」
  // 「parseTimeOfDay(time) | 'HH:mm' 形式の時刻文字列を、その日の 0:00 からの分
  //  (0〜1439) に変換する。formatSlotLabel の逆変換。形式が不正なら Error」
  it('isoWeekNumberInZone と parseTimeOfDay が @koyomi-cal/react から公開されている', async () => {
    const indexModule = await import('../index');
    expect(typeof indexModule.isoWeekNumberInZone).toBe('function');
    expect(typeof indexModule.parseTimeOfDay).toBe('function');
  });
});
