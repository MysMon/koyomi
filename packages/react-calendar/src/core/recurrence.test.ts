/**
 * recurrence.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' や 'UTC' を引数で明示して行う。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST(UTC-5) → EDT(UTC-4)、02:00〜02:59 は存在しない）
 * - 終了: 2026-11-01 02:00（EDT(UTC-4) → EST(UTC-5)、01:00〜01:59 は 2 回現れる）
 */
import { describe, expect, it } from 'vitest';
import {
  countOccurrencesBefore,
  expandRecurrence,
  normalizeRRuleString,
  previousOccurrenceStart,
  truncateRRule,
} from './recurrence';
import { getWallClock } from './timezone';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const UTC = 'UTC';

/** Date の配列を ISO 文字列の配列に変換する（アサーションの可読性のため）。 */
function toISO(dates: readonly Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

describe('normalizeRRuleString', () => {
  it("'RRULE:' プレフィックスなしの本体をそのまま正規化して返す", () => {
    expect(normalizeRRuleString('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it("'RRULE:' プレフィックス付きの文字列からプレフィックスを剥がした本体を返す", () => {
    expect(normalizeRRuleString('RRULE:FREQ=WEEKLY;BYDAY=MO,WE')).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('小文字のキー・値を大文字に正規化する', () => {
    expect(normalizeRRuleString('freq=daily;count=3')).toBe('FREQ=DAILY;COUNT=3');
  });

  it('INTERVAL や UNTIL を含むルールを保持する', () => {
    expect(normalizeRRuleString('FREQ=WEEKLY;INTERVAL=2')).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(normalizeRRuleString('FREQ=DAILY;UNTIL=20260705T100000Z')).toBe(
      'FREQ=DAILY;UNTIL=20260705T100000Z',
    );
  });

  it('不明なプロパティを含む文字列には Error を投げる', () => {
    expect(() => normalizeRRuleString('FOO=BAR')).toThrow(Error);
    expect(() => normalizeRRuleString('こんにちは')).toThrow(Error);
  });

  it('FREQ を欠く文字列には Error を投げる', () => {
    expect(() => normalizeRRuleString('')).toThrow(Error);
    expect(() => normalizeRRuleString('COUNT=3')).toThrow(Error);
  });

  it('FREQ の値が不正な場合は Error を投げる', () => {
    expect(() => normalizeRRuleString('FREQ=BOGUS')).toThrow(Error);
  });

  it('BYDAY の値が不正な場合は Error を投げる', () => {
    expect(() => normalizeRRuleString('FREQ=WEEKLY;BYDAY=mo')).toThrow(Error);
  });
});

describe('expandRecurrence', () => {
  describe('FREQ=DAILY を America/New_York の 9:00 で DST を跨いで展開する', () => {
    it('春の DST 切替（2026-03-08）を跨いでも常に現地 9:00 に発生する（14:00Z → 13:00Z）', () => {
      // 2026-03-06T09:00 EST = 14:00Z（切替前）、切替後の 9:00 EDT = 13:00Z
      const dtstart = new Date('2026-03-06T14:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: NY,
        range: { start: dtstart, end: new Date('2026-03-10T04:00:00Z') },
      });
      expect(toISO(result)).toEqual([
        '2026-03-06T14:00:00.000Z',
        '2026-03-07T14:00:00.000Z',
        '2026-03-08T13:00:00.000Z',
        '2026-03-09T13:00:00.000Z',
      ]);
      for (const occurrence of result) {
        const wall = getWallClock(occurrence, NY);
        expect([wall.hours, wall.minutes]).toEqual([9, 0]);
      }
    });

    it('秋の DST 切替（2026-11-01）を跨いでも常に現地 9:00 に発生する（13:00Z → 14:00Z）', () => {
      // 2026-10-30T09:00 EDT = 13:00Z（切替前）、切替後の 9:00 EST = 14:00Z
      const dtstart = new Date('2026-10-30T13:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: NY,
        range: { start: dtstart, end: new Date('2026-11-03T05:00:00Z') },
      });
      expect(toISO(result)).toEqual([
        '2026-10-30T13:00:00.000Z',
        '2026-10-31T13:00:00.000Z',
        '2026-11-01T14:00:00.000Z',
        '2026-11-02T14:00:00.000Z',
      ]);
      for (const occurrence of result) {
        const wall = getWallClock(occurrence, NY);
        expect([wall.hours, wall.minutes]).toEqual([9, 0]);
      }
    });

    it('春の DST 切替で存在しない現地時刻が繰り上げられ同じ絶対時刻に重複しても、1 件に統合する', () => {
      // BYHOUR=2,3;BYMINUTE=30 は毎日 2:30 と 3:30 の 2 回発生するはずだが、
      // 2026-03-08 は 2:00〜2:59 が存在しないため 2:30 が 3:30 EDT に繰り上げられて
      // （07:30Z）に一致し、3:30 のオカレンスと絶対時刻が重複する
      const dtstart = new Date('2026-03-01T07:30:00Z'); // NY 3/1 2:30 EST
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY;BYHOUR=2,3;BYMINUTE=30',
        dtstart,
        timeZone: NY,
        range: { start: new Date('2026-03-07T00:00:00Z'), end: new Date('2026-03-10T00:00:00Z') },
      });
      // 3/8 は絶対時刻が重複するため 1 件のみ（3/7 は通常どおり 2 件）
      expect(toISO(result)).toEqual([
        '2026-03-07T07:30:00.000Z',
        '2026-03-07T08:30:00.000Z',
        '2026-03-08T07:30:00.000Z',
        '2026-03-09T06:30:00.000Z',
        '2026-03-09T07:30:00.000Z',
      ]);
      // 重複除去後も絶対時刻に重複がないことを確認する
      const times = result.map((d) => d.getTime());
      expect(new Set(times).size).toBe(times.length);
    });
  });

  it('FREQ=WEEKLY;BYDAY=MO,WE は月曜・水曜のオカレンスを返す', () => {
    // 2026-07-06 は月曜日。dtstart = 東京 10:00 = 01:00Z
    const dtstart = new Date('2026-07-06T01:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      dtstart,
      timeZone: TOKYO,
      // 東京の 7/6 10:00 〜 7/20 0:00（排他）
      range: { start: dtstart, end: new Date('2026-07-19T15:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-06T01:00:00.000Z', // 月
      '2026-07-08T01:00:00.000Z', // 水
      '2026-07-13T01:00:00.000Z', // 月
      '2026-07-15T01:00:00.000Z', // 水
    ]);
  });

  it('FREQ=WEEKLY;INTERVAL=2 は隔週のオカレンスを返す', () => {
    const dtstart = new Date('2026-07-06T01:00:00Z'); // 東京 7/6（月）10:00
    const result = expandRecurrence({
      rrule: 'FREQ=WEEKLY;INTERVAL=2',
      dtstart,
      timeZone: TOKYO,
      // 東京の 7/1 0:00 〜 9/1 0:00（排他）
      range: { start: new Date('2026-06-30T15:00:00Z'), end: new Date('2026-08-31T15:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-06T01:00:00.000Z',
      '2026-07-20T01:00:00.000Z',
      '2026-08-03T01:00:00.000Z',
      '2026-08-17T01:00:00.000Z',
      '2026-08-31T01:00:00.000Z',
    ]);
  });

  it('COUNT=5 は範囲が広くても 5 回で打ち切られる', () => {
    const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=5',
      dtstart,
      timeZone: TOKYO,
      range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
      '2026-07-04T00:00:00.000Z',
      '2026-07-05T00:00:00.000Z',
    ]);
  });

  it('UNTIL はイベント TZ の現地時刻として解釈され、UNTIL ちょうどのオカレンスは含まれる', () => {
    // UNTIL=20260705T100000Z は fake-UTC 空間の値、つまり「東京の現地時刻 2026-07-05 10:00 まで」
    const dtstart = new Date('2026-07-01T01:00:00Z'); // 東京 7/1 10:00
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY;UNTIL=20260705T100000Z',
      dtstart,
      timeZone: TOKYO,
      range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T01:00:00.000Z',
      '2026-07-02T01:00:00.000Z',
      '2026-07-03T01:00:00.000Z',
      '2026-07-04T01:00:00.000Z',
      '2026-07-05T01:00:00.000Z', // UNTIL ちょうど（含む）
    ]);
  });

  it('FREQ=MONTHLY;BYMONTHDAY=31 は 31 日がない月をスキップする', () => {
    const dtstart = new Date('2026-01-31T00:00:00Z'); // 東京 1/31 9:00
    const result = expandRecurrence({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
      dtstart,
      timeZone: TOKYO,
      // 東京の 2026-01-01 0:00 〜 2027-01-01 0:00（排他）
      range: { start: new Date('2025-12-31T15:00:00Z'), end: new Date('2026-12-31T15:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z', // 2 月はスキップ
      '2026-05-31T00:00:00.000Z', // 4 月はスキップ
      '2026-07-31T00:00:00.000Z', // 6 月はスキップ
      '2026-08-31T00:00:00.000Z',
      '2026-10-31T00:00:00.000Z', // 9 月はスキップ
      '2026-12-31T00:00:00.000Z', // 11 月はスキップ
    ]);
  });

  it('dtstart 自身が最初のオカレンスとして含まれる（範囲 start ちょうども含む）', () => {
    const dtstart = new Date('2026-07-01T00:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      range: { start: dtstart, end: new Date('2026-07-03T00:00:00Z') },
    });
    expect(toISO(result)[0]).toBe('2026-07-01T00:00:00.000Z');
  });

  it('範囲 end は排他であり、end ちょうどに開始するオカレンスは含まれない', () => {
    const dtstart = new Date('2026-07-01T00:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      // end = 7/3 のオカレンスの開始時刻ちょうど
      range: { start: dtstart, end: new Date('2026-07-03T00:00:00Z') },
    });
    expect(toISO(result)).toEqual(['2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z']);
  });

  it('UTC をイベント TZ とした場合はそのままの UTC 時刻で展開される', () => {
    const dtstart = new Date('2026-07-01T10:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=3',
      dtstart,
      timeZone: UTC,
      range: { start: dtstart, end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T10:00:00.000Z',
      '2026-07-02T10:00:00.000Z',
      '2026-07-03T10:00:00.000Z',
    ]);
  });

  describe('ミリ秒を持つ dtstart の扱い（fake-UTC 変換のミリ秒往復）', () => {
    it('dtstart にミリ秒がある場合でも COUNT=3 は 3 件返り、最初のオカレンスが dtstart とミリ秒まで一致する', () => {
      const dtstart = new Date('2026-07-01T00:00:00.500Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY;COUNT=3',
        dtstart,
        timeZone: TOKYO,
        // range.start を dtstart ちょうどにすることで、ミリ秒切り捨てによる
        // 「最初のオカレンスが range.start 未満になり消える」不具合を検出する
        range: { start: dtstart, end: new Date('2026-08-01T00:00:00Z') },
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.getTime()).toBe(dtstart.getTime());
      expect(toISO(result)).toEqual([
        '2026-07-01T00:00:00.500Z',
        '2026-07-02T00:00:00.500Z',
        '2026-07-03T00:00:00.500Z',
      ]);
    });

    it('dtstart にミリ秒がある場合、exdates もミリ秒まで一致するオカレンスのみ正しく除外する', () => {
      const dtstart = new Date('2026-07-01T00:00:00.500Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY;COUNT=3',
        dtstart,
        timeZone: TOKYO,
        exdates: [new Date('2026-07-02T00:00:00.500Z')],
        range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
      });
      expect(toISO(result)).toEqual(['2026-07-01T00:00:00.500Z', '2026-07-03T00:00:00.500Z']);
    });
  });

  describe('exdates による除外', () => {
    it('exdates とミリ秒単位で一致するオカレンスは除外される', () => {
      const dtstart = new Date('2026-07-01T00:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: TOKYO,
        exdates: [new Date('2026-07-02T00:00:00Z')],
        range: { start: dtstart, end: new Date('2026-07-04T00:00:00Z') },
      });
      expect(toISO(result)).toEqual(['2026-07-01T00:00:00.000Z', '2026-07-03T00:00:00.000Z']);
    });

    it('1 ミリ秒でもずれた exdates はオカレンスを除外しない', () => {
      const dtstart = new Date('2026-07-01T00:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: TOKYO,
        exdates: [new Date('2026-07-02T00:00:00.001Z')],
        range: { start: dtstart, end: new Date('2026-07-04T00:00:00Z') },
      });
      expect(toISO(result)).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z',
        '2026-07-03T00:00:00.000Z',
      ]);
    });

    it('すべてのオカレンスが exdates で除外されると空配列を返す', () => {
      const dtstart = new Date('2026-07-01T00:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY;COUNT=2',
        dtstart,
        timeZone: TOKYO,
        exdates: [new Date('2026-07-01T00:00:00Z'), new Date('2026-07-02T00:00:00Z')],
        range: { start: dtstart, end: new Date('2026-08-01T00:00:00Z') },
      });
      expect(result).toEqual([]);
    });
  });

  describe('空集合になる境界', () => {
    it('範囲が dtstart より前で終わる場合は空配列を返す', () => {
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart: new Date('2026-07-01T00:00:00Z'),
        timeZone: TOKYO,
        range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-10T00:00:00Z') },
      });
      expect(result).toEqual([]);
    });

    it('範囲が COUNT による最後のオカレンスより後にある場合は空配列を返す', () => {
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY;COUNT=3',
        dtstart: new Date('2026-07-01T00:00:00Z'),
        timeZone: TOKYO,
        range: { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-09-01T00:00:00Z') },
      });
      expect(result).toEqual([]);
    });

    it('start >= end の空範囲では空配列を返す', () => {
      const dtstart = new Date('2026-07-01T00:00:00Z');
      const result = expandRecurrence({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: TOKYO,
        range: { start: dtstart, end: dtstart },
      });
      expect(result).toEqual([]);
    });
  });

  it('オカレンスは昇順で返される', () => {
    const dtstart = new Date('2026-07-01T00:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=10',
      dtstart,
      timeZone: TOKYO,
      range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    const sorted = [...result].sort((a, b) => a.getTime() - b.getTime());
    expect(toISO(result)).toEqual(toISO(sorted));
  });

  it('不正な RRULE には Error を投げる', () => {
    const dtstart = new Date('2026-07-01T00:00:00Z');
    expect(() =>
      expandRecurrence({
        rrule: 'FOO=BAR',
        dtstart,
        timeZone: TOKYO,
        range: { start: dtstart, end: new Date('2026-08-01T00:00:00Z') },
      }),
    ).toThrow(Error);
  });
});

describe('previousOccurrenceStart', () => {
  const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00

  it('before がオカレンスの開始ちょうどの場合、そのオカレンスは含まず 1 つ前を返す（排他）', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2026-07-04T00:00:00Z'), // 7/4 9:00 JST のオカレンスちょうど
    });
    expect(result?.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });

  it('before がオカレンスの間にある場合、直前のオカレンスを返す', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2026-07-04T03:00:00Z'), // 7/4 12:00 JST
    });
    expect(result?.toISOString()).toBe('2026-07-04T00:00:00.000Z');
  });

  it('before が dtstart ちょうどの場合は null を返す', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: dtstart,
    });
    expect(result).toBeNull();
  });

  it('before が dtstart より前の場合は null を返す', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2026-06-01T00:00:00Z'),
    });
    expect(result).toBeNull();
  });

  it('COUNT で打ち切られたルールでは最後のオカレンスを返す', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY;COUNT=3',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2027-01-01T00:00:00Z'),
    });
    expect(result?.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });

  it('DST 切替を跨いでも正しい直前のオカレンス（現地 9:00）を返す', () => {
    const result = previousOccurrenceStart({
      rrule: 'FREQ=DAILY',
      dtstart: new Date('2026-03-06T14:00:00Z'), // NY 3/6 9:00 EST
      timeZone: NY,
      before: new Date('2026-03-09T13:00:00Z'), // NY 3/9 9:00 EDT のオカレンスちょうど
    });
    expect(result?.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // 3/8 9:00 EDT
  });

  it('不正な RRULE には Error を投げる', () => {
    expect(() =>
      previousOccurrenceStart({
        rrule: 'FREQ=BOGUS',
        dtstart,
        timeZone: TOKYO,
        before: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toThrow(Error);
  });
});

describe('countOccurrencesBefore', () => {
  const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00

  it('before ちょうどに開始するオカレンスは数えない（排他）', () => {
    const count = countOccurrencesBefore({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2026-07-04T00:00:00Z'), // 7/4 9:00 JST のオカレンスちょうど
    });
    expect(count).toBe(3); // 7/1, 7/2, 7/3
  });

  it('before がオカレンスの間にある場合、その直前までのオカレンスを数える', () => {
    const count = countOccurrencesBefore({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2026-07-04T03:00:00Z'), // 7/4 12:00 JST
    });
    expect(count).toBe(4); // 7/1〜7/4
  });

  it('before が dtstart 以前の場合は 0 を返す', () => {
    expect(
      countOccurrencesBefore({ rrule: 'FREQ=DAILY', dtstart, timeZone: TOKYO, before: dtstart }),
    ).toBe(0);
    expect(
      countOccurrencesBefore({
        rrule: 'FREQ=DAILY',
        dtstart,
        timeZone: TOKYO,
        before: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toBe(0);
  });

  it('COUNT を超えて数えない', () => {
    const count = countOccurrencesBefore({
      rrule: 'FREQ=DAILY;COUNT=3',
      dtstart,
      timeZone: TOKYO,
      before: new Date('2027-01-01T00:00:00Z'),
    });
    expect(count).toBe(3);
  });

  it('DST 切替を跨いだオカレンスも正しく数える', () => {
    const count = countOccurrencesBefore({
      rrule: 'FREQ=DAILY',
      dtstart: new Date('2026-03-06T14:00:00Z'), // NY 3/6 9:00 EST
      timeZone: NY,
      before: new Date('2026-03-10T04:00:00Z'), // NY 3/10 0:00 EDT
    });
    expect(count).toBe(4); // 3/6, 3/7, 3/8, 3/9
  });

  it('不正な RRULE には Error を投げる', () => {
    expect(() =>
      countOccurrencesBefore({
        rrule: '',
        dtstart,
        timeZone: TOKYO,
        before: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toThrow(Error);
  });
});

describe('truncateRRule', () => {
  const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00

  it('COUNT を削除して UNTIL（until 直前のオカレンスの fake-UTC 時刻）に置き換える', () => {
    const result = truncateRRule({
      rrule: 'FREQ=DAILY;COUNT=10',
      dtstart,
      timeZone: TOKYO,
      // 5 回目のオカレンス（東京 7/5 9:00）で打ち切る
      until: new Date('2026-07-05T00:00:00Z'),
    });
    expect(result).not.toContain('COUNT');
    // until 直前のオカレンスは 4 回目（東京 7/4 9:00）。その fake-UTC 時刻を UNTIL にする
    expect(result).toBe('FREQ=DAILY;UNTIL=20260704T090000Z');
  });

  it('COUNT=10 のルールを 5 回目で打ち切ると展開結果が 4 回になる', () => {
    const truncated = truncateRRule({
      rrule: 'FREQ=DAILY;COUNT=10',
      dtstart,
      timeZone: TOKYO,
      until: new Date('2026-07-05T00:00:00Z'), // 5 回目のオカレンスの開始
    });
    const result = expandRecurrence({
      rrule: truncated,
      dtstart,
      timeZone: TOKYO,
      range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
      '2026-07-04T00:00:00.000Z',
    ]);
  });

  it('既存の UNTIL は新しい打ち切り位置で置き換えられる', () => {
    const result = truncateRRule({
      rrule: 'FREQ=DAILY;UNTIL=20260731T090000Z',
      dtstart,
      timeZone: TOKYO,
      until: new Date('2026-07-05T00:00:00Z'),
    });
    expect(result).toBe('FREQ=DAILY;UNTIL=20260704T090000Z');
  });

  it('until 以降（含む）のオカレンスを含まず、直前のオカレンスは含む', () => {
    // until をオカレンスとオカレンスの間（東京 7/5 12:00）に置くと、7/5 9:00 のオカレンスは残る
    const truncated = truncateRRule({
      rrule: 'FREQ=DAILY',
      dtstart,
      timeZone: TOKYO,
      until: new Date('2026-07-05T03:00:00Z'), // 東京 7/5 12:00
    });
    const result = expandRecurrence({
      rrule: truncated,
      dtstart,
      timeZone: TOKYO,
      range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(result).at(-1)).toBe('2026-07-05T00:00:00.000Z');
    for (const occurrence of result) {
      expect(occurrence.getTime()).toBeLessThan(new Date('2026-07-05T03:00:00Z').getTime());
    }
  });

  it('DST 切替を跨ぐ打ち切りでも現地時刻基準で正しく打ち切られる', () => {
    // NY の毎日 9:00 を、切替後最初のオカレンス（3/8 9:00 EDT = 13:00Z）で打ち切る
    const nyDtstart = new Date('2026-03-06T14:00:00Z');
    const truncated = truncateRRule({
      rrule: 'FREQ=DAILY',
      dtstart: nyDtstart,
      timeZone: NY,
      until: new Date('2026-03-08T13:00:00Z'),
    });
    // until 直前のオカレンスは 3/7 9:00 EST。その fake-UTC 時刻を UNTIL にする
    expect(truncated).toBe('FREQ=DAILY;UNTIL=20260307T090000Z');
    const result = expandRecurrence({
      rrule: truncated,
      dtstart: nyDtstart,
      timeZone: NY,
      range: { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-04-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual(['2026-03-06T14:00:00.000Z', '2026-03-07T14:00:00.000Z']);
  });

  describe('until の境界が壊れるケース（ミリ秒・DST 曖昧時刻）', () => {
    it('until にミリ秒がある場合でも、直前のオカレンス（ミリ秒付き）が消えずに残る', () => {
      // dtstart は毎日 9:00（東京）でミリ秒 .499 を持つ。5 回目のオカレンスは
      // 2026-07-05T00:00:00.499Z。until はその 1ms 後（.500Z）なので
      // 5 回目のオカレンスは「until より前」として残るべき
      const msDtstart = new Date('2026-07-01T00:00:00.499Z');
      const truncated = truncateRRule({
        rrule: 'FREQ=DAILY',
        dtstart: msDtstart,
        timeZone: TOKYO,
        until: new Date('2026-07-05T00:00:00.500Z'),
      });
      const result = expandRecurrence({
        rrule: truncated,
        dtstart: msDtstart,
        timeZone: TOKYO,
        range: { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
      });
      expect(toISO(result)).toEqual([
        '2026-07-01T00:00:00.499Z',
        '2026-07-02T00:00:00.499Z',
        '2026-07-03T00:00:00.499Z',
        '2026-07-04T00:00:00.499Z',
        '2026-07-05T00:00:00.499Z',
      ]);
    });

    it('DST 秋切替の曖昧時間帯を跨ぐ打ち切りでも、絶対時刻順序で正しく直前のオカレンスを残す', () => {
      // NY の毎日 1:30。2026-11-01 は DST 終了（EDT→EST）で 1:00〜1:59 が
      // 2 回現れる曖昧時間帯。この日の 1:30 は早い方のオフセット（EDT）で
      // 解決され、絶対時刻は 05:30Z になる
      const nyDtstart = new Date('2026-10-25T05:30:00Z'); // NY 10/25 1:30 EDT
      const truncated = truncateRRule({
        rrule: 'FREQ=DAILY',
        dtstart: nyDtstart,
        timeZone: NY,
        // 11/1 のオカレンス（05:30Z）と 11/2 のオカレンス（06:30Z）の間の絶対時刻
        until: new Date('2026-11-01T06:00:00Z'),
      });
      const result = expandRecurrence({
        rrule: truncated,
        dtstart: nyDtstart,
        timeZone: NY,
        range: { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') },
      });
      // 11/1 のオカレンス（05:30Z）は残り、11/2 以降は含まれない
      expect(toISO(result).at(-1)).toBe('2026-11-01T05:30:00.000Z');
      for (const occurrence of result) {
        expect(occurrence.getTime()).toBeLessThan(new Date('2026-11-01T06:00:00Z').getTime());
      }
    });
  });

  it('不正な RRULE には Error を投げる', () => {
    expect(() =>
      truncateRRule({
        rrule: 'FOO=BAR',
        dtstart,
        timeZone: TOKYO,
        until: new Date('2026-07-05T00:00:00Z'),
      }),
    ).toThrow(Error);
  });
});
