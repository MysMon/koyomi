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
import { addDaysInZone, getWallClock } from './timezone';
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
