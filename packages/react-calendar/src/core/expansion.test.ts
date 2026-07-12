/**
 * expansion.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York'（NY）を displayTimeZone や
 * event.timeZone に明示して行う。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST → EDT、UTC-5 → UTC-4。02:00〜02:59 は存在しない）
 * - 終了: 2026-11-01 02:00（EDT → EST）
 */
import { describe, expect, it } from 'vitest';
import { expandEvents, occurrenceKey, resolveOccurrence } from './expansion';
import { dateKeyInZone } from './timezone';
import type { CalendarEvent, EventOccurrence, TimeZoneId } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

/** `title` を省略可能にしたテスト用イベントファクトリ（省略時は `id` を流用）。 */
function makeEvent(props: Omit<CalendarEvent, 'title'> & { title?: string }): CalendarEvent {
  const { title, ...rest } = props;
  return { ...rest, title: title ?? rest.id };
}

/** ISO 文字列の範囲指定で expandEvents を呼ぶテスト用ヘルパー。 */
function expand(
  events: readonly CalendarEvent[],
  range: { start: string; end: string },
  displayTimeZone: TimeZoneId = TOKYO,
  defaultEventMinutes = 60,
): EventOccurrence[] {
  return expandEvents({
    events,
    range: { start: new Date(range.start), end: new Date(range.end) },
    displayTimeZone,
    defaultEventMinutes,
  });
}

/** ISO 文字列のオカレンスの開始指定で resolveOccurrence を呼ぶテスト用ヘルパー。 */
function resolve(
  event: CalendarEvent,
  occurrenceStart: string,
  displayTimeZone: TimeZoneId = TOKYO,
  defaultEventMinutes = 60,
): EventOccurrence | null {
  return resolveOccurrence({
    event,
    occurrenceStart: new Date(occurrenceStart),
    displayTimeZone,
    defaultEventMinutes,
  });
}

describe('occurrenceKey', () => {
  it('`eventId@startのISO文字列` 形式のキーを返す（TSDoc の @example）', () => {
    expect(occurrenceKey('e1', new Date('2026-07-01T01:00:00Z'))).toBe(
      'e1@2026-07-01T01:00:00.000Z',
    );
  });

  it('ミリ秒を含む UTC の ISO 文字列で表現される', () => {
    expect(occurrenceKey('ev', new Date('2026-12-31T23:59:59.123Z'))).toBe(
      'ev@2026-12-31T23:59:59.123Z',
    );
  });
});

describe('expandEvents', () => {
  describe('単発イベント', () => {
    it('範囲内の単発イベントを 1 件のオカレンスに展開し、全フィールドを設定する', () => {
      const source = makeEvent({
        id: 'e1',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
      });
      // 東京 7/1 0:00 〜 7/2 0:00
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-01T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      const occ = result[0]!;
      expect(occ.key).toBe('e1@2026-07-01T01:00:00.000Z');
      expect(occ.eventId).toBe('e1');
      expect(occ.event).toBe(source);
      expect(occ.start).toEqual(new Date('2026-07-01T01:00:00Z'));
      expect(occ.end).toEqual(new Date('2026-07-01T02:00:00Z'));
      expect(occ.allDay).toBe(false);
      expect(occ.isRecurring).toBe(false);
      expect(occ.originalStart).toEqual(occ.start);
    });

    it('範囲 end ちょうどに始まるイベントは含まれない（end 排他）', () => {
      const source = makeEvent({
        id: 'e1',
        start: '2026-07-01T10:00:00Z',
        end: '2026-07-01T11:00:00Z',
      });
      const result = expand([source], {
        start: '2026-07-01T00:00:00Z',
        end: '2026-07-01T10:00:00Z',
      });
      expect(result).toEqual([]);
    });

    it('範囲 start ちょうどに終わるイベントは含まれない（イベント end 排他）', () => {
      const source = makeEvent({
        id: 'e1',
        start: '2026-06-30T23:00:00Z',
        end: '2026-07-01T00:00:00Z',
      });
      const result = expand([source], {
        start: '2026-07-01T00:00:00Z',
        end: '2026-07-02T00:00:00Z',
      });
      expect(result).toEqual([]);
    });

    it('境界を 1 ミリ秒でも越えて重なれば含まれる', () => {
      // 範囲 start の 1ms 後に終わる → 含まれる
      const endsJustAfter = makeEvent({
        id: 'ends-after',
        start: '2026-06-30T23:00:00Z',
        end: '2026-07-01T00:00:00.001Z',
      });
      // 範囲 end の 1ms 前に始まる → 含まれる
      const startsJustBefore = makeEvent({
        id: 'starts-before',
        start: '2026-07-01T09:59:59.999Z',
        end: '2026-07-01T12:00:00Z',
      });
      const result = expand([endsJustAfter, startsJustBefore], {
        start: '2026-07-01T00:00:00Z',
        end: '2026-07-01T10:00:00Z',
      });
      expect(result.map((o) => o.eventId)).toEqual(['ends-after', 'starts-before']);
    });

    it('end 省略時は defaultEventMinutes が適用される', () => {
      const source = makeEvent({ id: 'e1', start: '2026-07-01T00:00:00Z' });
      const result = expand(
        [source],
        { start: '2026-07-01T00:00:00Z', end: '2026-07-02T00:00:00Z' },
        TOKYO,
        45,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.end).toEqual(new Date('2026-07-01T00:45:00Z'));
    });

    it('オフセットなしの日時文字列は event.timeZone の現地時刻として解釈される', () => {
      const source = makeEvent({
        id: 'ny',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        timeZone: NY,
      });
      // NY の 7/1 10:00 は EDT（UTC-4）なので 14:00Z
      const result = expand([source], {
        start: '2026-07-01T00:00:00Z',
        end: '2026-07-02T00:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.start).toEqual(new Date('2026-07-01T14:00:00Z'));
      expect(result[0]!.end).toEqual(new Date('2026-07-01T15:00:00Z'));
    });
  });

  describe('繰り返しイベント', () => {
    it('FREQ=DAILY;COUNT=3 を範囲内に展開する（TSDoc の @example）', () => {
      const source = makeEvent({
        id: 'e1',
        title: '毎日会議',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=3',
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-04T15:00:00Z',
      });
      expect(result.map((o) => o.key)).toEqual([
        'e1@2026-07-01T01:00:00.000Z',
        'e1@2026-07-02T01:00:00.000Z',
        'e1@2026-07-03T01:00:00.000Z',
      ]);
      for (const occ of result) {
        expect(occ.end.getTime() - occ.start.getTime()).toBe(60 * 60 * 1000);
        expect(occ.isRecurring).toBe(true);
        expect(occ.originalStart).toEqual(occ.start);
        expect(occ.event).toBe(source);
      }
    });

    it("'RRULE:' プレフィックス付き/なしのどちらでも同じオカレンスに展開される", () => {
      const range = { start: '2026-06-30T15:00:00Z', end: '2026-07-10T15:00:00Z' };
      const bare = makeEvent({
        id: 'bare',
        start: '2026-07-01T09:00:00',
        rrule: 'FREQ=DAILY;COUNT=3',
      });
      const prefixed = makeEvent({
        id: 'prefixed',
        start: '2026-07-01T09:00:00',
        rrule: 'RRULE:FREQ=DAILY;COUNT=3',
      });
      const bareStarts = expand([bare], range).map((o) => o.start.toISOString());
      const prefixedStarts = expand([prefixed], range).map((o) => o.start.toISOString());
      expect(prefixedStarts).toEqual(bareStarts);
      expect(bareStarts).toHaveLength(3);
    });

    it('各オカレンスの長さはマスターの start/end のミリ秒差を維持する（DST 跨ぎ）', () => {
      // NY の 1:30〜3:30（2 時間）。3/8 のオカレンスは DST 開始（2:00→3:00）を跨ぐ
      const source = makeEvent({
        id: 'span',
        start: '2026-03-07T01:30:00',
        end: '2026-03-07T03:30:00',
        timeZone: NY,
        rrule: 'FREQ=DAILY;COUNT=2',
      });
      const result = expand(
        [source],
        { start: '2026-03-06T00:00:00Z', end: '2026-03-10T00:00:00Z' },
        NY,
      );
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-03-07T06:30:00.000Z',
        '2026-03-08T06:30:00.000Z',
      ]);
      // 2 回目も開始からちょうど 2 時間（現地時刻では 4:30 終了になる）
      expect(result.map((o) => o.end.toISOString())).toEqual([
        '2026-03-07T08:30:00.000Z',
        '2026-03-08T08:30:00.000Z',
      ]);
    });

    it('オカレンスの開始はイベント TZ の現地時刻を DST を跨いで維持する（NY 毎日 9:00）', () => {
      const source = makeEvent({
        id: 'daily9',
        start: '2026-03-07T09:00:00',
        end: '2026-03-07T10:00:00',
        timeZone: NY,
        rrule: 'FREQ=DAILY;COUNT=3',
      });
      // 表示 TZ は絶対時刻に影響しない（東京表示で検証）
      const result = expand([source], {
        start: '2026-03-07T00:00:00Z',
        end: '2026-03-10T00:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-03-07T14:00:00.000Z', // 9:00 EST
        '2026-03-08T13:00:00.000Z', // 9:00 EDT
        '2026-03-09T13:00:00.000Z',
      ]);
    });

    it('範囲開始前に始まり範囲に食い込むオカレンスも含まれる', () => {
      // 東京の毎日 23:00〜翌 1:00
      const source = makeEvent({
        id: 'late',
        start: '2026-07-01T23:00:00',
        end: '2026-07-02T01:00:00',
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      // 東京 7/3 0:00 〜 7/4 0:00
      const result = expand([source], {
        start: '2026-07-02T15:00:00Z',
        end: '2026-07-03T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-07-02T14:00:00.000Z', // 7/2 23:00 開始（範囲前）だが 7/3 1:00 まで続く
        '2026-07-03T14:00:00.000Z',
      ]);
    });

    it('範囲 start ちょうどに終わるオカレンスは含まれない（オカレンス end 排他）', () => {
      const source = makeEvent({
        id: 'late',
        start: '2026-07-01T23:00:00',
        end: '2026-07-02T01:00:00',
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      // 範囲 start = 東京 7/3 1:00（7/2 のオカレンスの終了ちょうど）
      const result = expand([source], {
        start: '2026-07-02T16:00:00Z',
        end: '2026-07-03T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual(['2026-07-03T14:00:00.000Z']);
    });

    it('exdates のオカレンスが開始時刻のミリ秒一致で除外される', () => {
      const base = {
        id: 'ex',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=3',
      };
      const range = { start: '2026-06-30T15:00:00Z', end: '2026-07-04T15:00:00Z' };
      // 文字列（イベント TZ の現地時刻）でも Date（絶対時刻）でも除外できる
      const byString = expand([makeEvent({ ...base, exdates: ['2026-07-02T10:00:00'] })], range);
      const byDate = expand(
        [makeEvent({ ...base, exdates: [new Date('2026-07-02T01:00:00Z')] })],
        range,
      );
      const expected = ['2026-07-01T01:00:00.000Z', '2026-07-03T01:00:00.000Z'];
      expect(byString.map((o) => o.start.toISOString())).toEqual(expected);
      expect(byDate.map((o) => o.start.toISOString())).toEqual(expected);
    });

    it('不正な RRULE は例外を投げる', () => {
      const source = makeEvent({ id: 'bad', start: '2026-07-01T10:00:00', rrule: 'FOO=BAR' });
      expect(() =>
        expand([source], { start: '2026-06-30T15:00:00Z', end: '2026-07-04T15:00:00Z' }),
      ).toThrow('不正な RRULE');
    });

    it('UNTIL はイベント TZ の現地時刻として解釈される（truncateRRule と整合する意図的仕様）', () => {
      // 東京の毎日 10:00。UNTIL=20260702T090000Z を「東京の現地時刻 7/2 9:00」と
      // 解釈するため 7/2 10:00 のオカレンスは含まれない（RFC 5545 の UTC 解釈なら
      // 7/2 18:00 東京となり 7/2 のオカレンスが含まれてしまう）
      const source = makeEvent({
        id: 'until',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;UNTIL=20260702T090000Z',
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-10T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual(['2026-07-01T01:00:00.000Z']);
    });
  });

  describe('RDATE（rrule のパターン外のオカレンス追加）', () => {
    it('rrule と rdates を合成し、rrule と重複する時刻は 1 件にまとめる', () => {
      const source = makeEvent({
        id: 'e1',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=3', // 7/1・7/2・7/3
        rdates: ['2026-07-02T10:00:00', '2026-07-05T10:00:00'], // 7/2 は重複、7/5 は追加
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-06T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-07-01T01:00:00.000Z',
        '2026-07-02T01:00:00.000Z', // rrule と rdate が重複しても 1 件のみ
        '2026-07-03T01:00:00.000Z',
        '2026-07-05T01:00:00.000Z', // rdate による追加オカレンス
      ]);
      for (const occ of result) {
        expect(occ.isRecurring).toBe(true);
        expect(occ.end.getTime() - occ.start.getTime()).toBe(60 * 60 * 1000);
      }
    });

    it('rrule なしで rdates のみの場合、start のオカレンスと各 rdate のオカレンスに展開される（isRecurring: true）', () => {
      const source = makeEvent({
        id: 'e2',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-07-03T10:00:00', '2026-07-05T10:00:00'],
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-06T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-07-01T01:00:00.000Z',
        '2026-07-03T01:00:00.000Z',
        '2026-07-05T01:00:00.000Z',
      ]);
      for (const occ of result) {
        expect(occ.isRecurring).toBe(true);
        expect(occ.originalStart).toEqual(occ.start);
      }
    });

    it('rdate 由来のオカレンスも exdates で除外される（除外が優先）', () => {
      const source = makeEvent({
        id: 'e3',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-07-03T10:00:00', '2026-07-05T10:00:00'],
        exdates: ['2026-07-03T10:00:00'],
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-06T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual([
        '2026-07-01T01:00:00.000Z',
        '2026-07-05T01:00:00.000Z',
      ]);
    });

    it('rdate 由来のオカレンスにもオーバーライドが適用される', () => {
      const master = makeEvent({
        id: 'm1',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-07-05T10:00:00'],
      });
      const override = makeEvent({
        id: 'o1',
        recurringEventId: 'm1',
        originalStart: '2026-07-05T10:00:00',
        start: '2026-07-05T15:00:00',
        end: '2026-07-05T16:00:00',
      });
      const result = expand([master, override], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-06T15:00:00Z',
      });
      expect(result.map((o) => [o.eventId, o.start.toISOString()])).toEqual([
        ['m1', '2026-07-01T01:00:00.000Z'],
        ['o1', '2026-07-05T06:00:00.000Z'],
      ]);
      const overridden = result[1]!;
      expect(overridden.originalStart).toEqual(new Date('2026-07-05T01:00:00Z'));
      expect(overridden.isRecurring).toBe(true);
    });

    it('範囲外の rdate は展開結果に含まれない', () => {
      const source = makeEvent({
        id: 'e5',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-08-01T10:00:00'], // 範囲外
      });
      const result = expand([source], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-06T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual(['2026-07-01T01:00:00.000Z']);
    });

    it('終日イベントでも rrule と rdates が合成される', () => {
      const source = makeEvent({
        id: 'ad',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=2', // 7/1・7/8
        rdates: ['2026-07-04'],
      });
      const result = expand([source], {
        start: '2026-06-28T00:00:00Z',
        end: '2026-07-20T00:00:00Z',
      });
      expect(result.map((o) => dateKeyInZone(o.start, TOKYO))).toEqual([
        '2026-07-01',
        '2026-07-04',
        '2026-07-08',
      ]);
      for (const occ of result) {
        expect(occ.isRecurring).toBe(true);
        expect(occ.allDay).toBe(true);
      }
    });

    it('rrule なし・終日で rdates のみの場合も start と各 rdate のオカレンスに展開される', () => {
      const source = makeEvent({
        id: 'ad-only',
        start: '2026-07-01',
        allDay: true,
        rdates: ['2026-07-03'],
      });
      const result = expand([source], {
        start: '2026-06-28T00:00:00Z',
        end: '2026-07-10T00:00:00Z',
      });
      expect(result.map((o) => dateKeyInZone(o.start, TOKYO))).toEqual([
        '2026-07-01',
        '2026-07-03',
      ]);
      for (const occ of result) {
        expect(occ.isRecurring).toBe(true);
      }
    });

    it('マスターに end が無ければ rdate 由来のオカレンスも既定長（defaultEventMinutes）になる', () => {
      const master = makeEvent({
        id: 'no-end',
        start: '2026-07-01T09:00:00',
        rdates: ['2026-07-03T09:00:00'],
      });
      const result = expand(
        [master],
        { start: '2026-06-30T15:00:00Z', end: '2026-07-10T15:00:00Z' },
        TOKYO,
        45,
      );
      expect(result).toHaveLength(2);
      for (const occ of result) {
        expect(occ.end.getTime() - occ.start.getTime()).toBe(45 * 60 * 1000);
      }
    });
  });

  describe('オーバーライド（繰り返し例外）', () => {
    it('exdate・移動・範囲外→内への移動・範囲内→外への移動の複合を解決する', () => {
      const master = makeEvent({
        id: 'm1',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=7',
        exdates: ['2026-07-02T10:00:00'], // 7/2 はこの予定のみ削除
      });
      // 7/3 10:00 → 7/3 15:00 へ移動
      const moved = makeEvent({
        id: 'o-move',
        recurringEventId: 'm1',
        originalStart: '2026-07-03T10:00:00',
        start: '2026-07-03T15:00:00',
        end: '2026-07-03T16:00:00',
      });
      // 元のオカレンス 7/5 10:00 は範囲外 → 7/3 20:00（範囲内）へ移動 → 表示される
      const movedIn = makeEvent({
        id: 'o-in',
        recurringEventId: 'm1',
        originalStart: '2026-07-05T10:00:00',
        start: '2026-07-03T20:00:00',
        end: '2026-07-03T21:00:00',
      });
      // 元のオカレンス 7/4 10:00 は範囲内 → 7/10（範囲外）へ移動 → 表示されない
      const movedOut = makeEvent({
        id: 'o-out',
        recurringEventId: 'm1',
        originalStart: '2026-07-04T10:00:00',
        start: '2026-07-10T10:00:00',
        end: '2026-07-10T11:00:00',
      });
      // 東京 7/1 0:00 〜 7/5 0:00。イベント配列の順序には依存しない
      const result = expand([moved, master, movedIn, movedOut], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-04T15:00:00Z',
      });
      expect(result.map((o) => [o.eventId, o.start.toISOString()])).toEqual([
        ['m1', '2026-07-01T01:00:00.000Z'],
        ['o-move', '2026-07-03T06:00:00.000Z'],
        ['o-in', '2026-07-03T11:00:00.000Z'],
      ]);
      const byId = new Map(result.map((o) => [o.eventId, o]));
      // オーバーライドの originalStart は置換した元のオカレンスの開始時刻
      expect(byId.get('o-move')?.originalStart).toEqual(new Date('2026-07-03T01:00:00Z'));
      expect(byId.get('o-in')?.originalStart).toEqual(new Date('2026-07-05T01:00:00Z'));
      expect(byId.get('o-move')?.isRecurring).toBe(true);
      expect(byId.get('o-in')?.isRecurring).toBe(true);
      expect(byId.get('o-move')?.event).toBe(moved);
    });

    it('参照先マスターが存在しないオーバーライドは防御的に単発イベントとして扱う', () => {
      const orphan = makeEvent({
        id: 'orphan',
        recurringEventId: 'ghost',
        originalStart: '2026-07-01T09:00:00',
        start: '2026-07-01T13:00:00',
        end: '2026-07-01T14:00:00',
      });
      const result = expand([orphan], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-01T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      const occ = result[0]!;
      expect(occ.eventId).toBe('orphan');
      expect(occ.start).toEqual(new Date('2026-07-01T04:00:00Z'));
      expect(occ.isRecurring).toBe(false);
      expect(occ.originalStart).toEqual(occ.start);
    });

    it('recurringEventId のみで originalStart を欠くイベントは防御的に単発イベントとして扱う', () => {
      const half = makeEvent({
        id: 'half',
        recurringEventId: 'ghost',
        start: '2026-07-01T09:00:00Z',
        end: '2026-07-01T10:00:00Z',
      });
      const result = expand([half], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-01T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.isRecurring).toBe(false);
      expect(result[0]!.start).toEqual(new Date('2026-07-01T09:00:00Z'));
      expect(result[0]!.originalStart).toEqual(result[0]!.start);
    });

    it('オーバーライドが timeZone を省略した場合、表示 TZ ではなくマスターの timeZone で start/end を解釈する', () => {
      // マスターは NY 現地時刻 10:00 開始。表示 TZ は東京（マスター・オーバーライドいずれの
      // timeZone とも異なる）。オーバーライドは timeZone を省略し、NY 14:00 のつもりで
      // 現地時刻文字列を書く（外部データ同期でマスターの timeZone を継承し忘れたケースを想定）。
      const master = makeEvent({
        id: 'master-ny',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        timeZone: NY,
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      const override = makeEvent({
        id: 'ov-ny',
        // timeZone を省略（NY 14:00 のつもりの現地時刻文字列）
        start: '2026-07-03T14:00:00',
        end: '2026-07-03T15:00:00',
        recurringEventId: 'master-ny',
        originalStart: '2026-07-03T10:00:00',
      });
      const result = expand(
        [master, override],
        { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' },
        TOKYO,
      );
      const overridden = result.find((occ) => occ.eventId === 'ov-ny');
      // NY 14:00 EDT（2026 年 7 月は DST 中で UTC-4）= 18:00Z
      // 表示 TZ（東京）で誤解釈すると 05:00Z（13 時間ずれる）になってしまう
      expect(overridden?.start).toEqual(new Date('2026-07-03T18:00:00.000Z'));
      expect(overridden?.end).toEqual(new Date('2026-07-03T19:00:00.000Z'));
    });

    it('オーバーライド自身に明示的な timeZone があれば、マスターの timeZone より優先される', () => {
      // マスターは America/New_York、オーバーライドは明示的に UTC を指定。
      // マスター TZ にフォールバックしてしまうと 4 時間ずれた誤った絶対時刻になる。
      const master = makeEvent({
        id: 'master-tz',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        timeZone: NY,
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      const override = makeEvent({
        id: 'ov-tz',
        recurringEventId: 'master-tz',
        // 絶対時刻で指定し、TZ 解釈の曖昧さを排除する(NY 7/3 10:00 EDT = 14:00Z)
        originalStart: new Date('2026-07-03T14:00:00Z'),
        // オフセットなし文字列 + 明示的な timeZone: UTC
        // → UTC 20:00 として解釈されるべき(マスターの NY にフォールバックすると
        //   2026-07-04T00:00:00Z になってしまう)
        start: '2026-07-03T20:00:00',
        end: '2026-07-03T21:00:00',
        timeZone: 'UTC',
      });
      const result = expand(
        [master, override],
        { start: '2026-07-01T00:00:00Z', end: '2026-07-10T00:00:00Z' },
        TOKYO,
      );
      const overridden = result.find((o) => o.eventId === 'ov-tz');
      expect(overridden?.start).toEqual(new Date('2026-07-03T20:00:00Z'));
    });
  });

  describe('終日イベント', () => {
    it("'YYYY-MM-DD' 文字列の単日イベントは表示 TZ の 0:00 に始まる 1 日になる", () => {
      const source = makeEvent({ id: 'ad1', start: '2026-07-01', allDay: true });
      const result = expand([source], {
        start: '2026-06-29T15:00:00Z',
        end: '2026-07-05T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      const occ = result[0]!;
      expect(occ.start).toEqual(new Date('2026-06-30T15:00:00Z')); // 東京 7/1 0:00
      expect(occ.end).toEqual(new Date('2026-07-01T15:00:00Z')); // 東京 7/2 0:00（排他）
      expect(occ.allDay).toBe(true);
      expect(occ.isRecurring).toBe(false);
      expect(occ.key).toBe('ad1@2026-06-30T15:00:00.000Z');
    });

    it('複数日イベントは end 排他で日数を維持する（7/1〜end 7/3 は 2 日間）', () => {
      const source = makeEvent({
        id: 'ad2',
        start: '2026-07-01',
        end: '2026-07-03',
        allDay: true,
      });
      const result = expand([source], {
        start: '2026-06-29T15:00:00Z',
        end: '2026-07-05T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.start).toEqual(new Date('2026-06-30T15:00:00Z')); // 東京 7/1 0:00
      expect(result[0]!.end).toEqual(new Date('2026-07-02T15:00:00Z')); // 東京 7/3 0:00
    });

    it('表示 TZ を America/New_York に変えても同じ日付に出る', () => {
      const source = makeEvent({ id: 'ad1', start: '2026-07-01', allDay: true });
      const range = { start: '2026-06-29T00:00:00Z', end: '2026-07-05T00:00:00Z' };
      const inTokyo = expand([source], range, TOKYO);
      const inNy = expand([source], range, NY);
      expect(inTokyo[0]!.start).toEqual(new Date('2026-06-30T15:00:00Z')); // 東京 7/1 0:00
      expect(inNy[0]!.start).toEqual(new Date('2026-07-01T04:00:00Z')); // NY 7/1 0:00 EDT
      expect(dateKeyInZone(inTokyo[0]!.start, TOKYO)).toBe('2026-07-01');
      expect(dateKeyInZone(inNy[0]!.start, NY)).toBe('2026-07-01');
    });

    it('日付の解釈は event.timeZone で行い、日付キーに正規化してから表示 TZ に変換する', () => {
      // 2026-07-02T03:00Z は NY では 7/1 23:00 → 日付キーは '2026-07-01'
      const source = makeEvent({
        id: 'adny',
        start: new Date('2026-07-02T03:00:00Z'),
        allDay: true,
        timeZone: NY,
      });
      const result = expand([source], {
        start: '2026-06-29T15:00:00Z',
        end: '2026-07-05T15:00:00Z',
      });
      expect(result).toHaveLength(1);
      // 東京表示でも「7/1」の終日イベントとして出る
      expect(result[0]!.start).toEqual(new Date('2026-06-30T15:00:00Z'));
      expect(dateKeyInZone(result[0]!.start, TOKYO)).toBe('2026-07-01');
    });

    it('DST 切替日の終日イベントは実時間が 23 時間になる（NY 2026-03-08）', () => {
      const source = makeEvent({ id: 'dst', start: '2026-03-08', allDay: true });
      const result = expand(
        [source],
        { start: '2026-03-07T00:00:00Z', end: '2026-03-11T00:00:00Z' },
        NY,
      );
      expect(result).toHaveLength(1);
      const occ = result[0]!;
      expect(occ.start).toEqual(new Date('2026-03-08T05:00:00Z')); // NY 3/8 0:00 EST
      expect(occ.end).toEqual(new Date('2026-03-09T04:00:00Z')); // NY 3/9 0:00 EDT
      expect(occ.end.getTime() - occ.start.getTime()).toBe(23 * 60 * 60 * 1000);
    });

    it('終日の週次繰り返しが表示 TZ 非依存で同じ日付列に展開される', () => {
      const source = makeEvent({
        id: 'wk',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
      });
      const range = { start: '2026-06-28T00:00:00Z', end: '2026-07-20T00:00:00Z' };
      const inTokyo = expand([source], range, TOKYO);
      const inNy = expand([source], range, NY);
      const expectedKeys = ['2026-07-01', '2026-07-08', '2026-07-15'];
      expect(inTokyo.map((o) => dateKeyInZone(o.start, TOKYO))).toEqual(expectedKeys);
      expect(inNy.map((o) => dateKeyInZone(o.start, NY))).toEqual(expectedKeys);
      // オカレンスの開始はそれぞれの表示 TZ における 0:00
      expect(inTokyo.map((o) => o.start.toISOString())).toEqual([
        '2026-06-30T15:00:00.000Z',
        '2026-07-07T15:00:00.000Z',
        '2026-07-14T15:00:00.000Z',
      ]);
      expect(inNy.map((o) => o.start.toISOString())).toEqual([
        '2026-07-01T04:00:00.000Z',
        '2026-07-08T04:00:00.000Z',
        '2026-07-15T04:00:00.000Z',
      ]);
      for (const occ of [...inTokyo, ...inNy]) {
        expect(occ.allDay).toBe(true);
        expect(occ.isRecurring).toBe(true);
      }
    });

    it('終日繰り返しの exdates は日付キー一致で除外される', () => {
      const base = {
        id: 'wk',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
      };
      const range = { start: '2026-06-28T00:00:00Z', end: '2026-07-20T00:00:00Z' };
      // 'YYYY-MM-DD' でも、その日のどこかを指す Date でも同じ日付キーとして除外される
      const byString = expand([makeEvent({ ...base, exdates: ['2026-07-08'] })], range);
      const byDate = expand(
        [makeEvent({ ...base, exdates: [new Date('2026-07-08T10:00:00Z')] })], // 東京 7/8 19:00
        range,
      );
      const expectedKeys = ['2026-07-01', '2026-07-15'];
      expect(byString.map((o) => dateKeyInZone(o.start, TOKYO))).toEqual(expectedKeys);
      expect(byDate.map((o) => dateKeyInZone(o.start, TOKYO))).toEqual(expectedKeys);
    });

    it('範囲前から始まり食い込む複数日イベントは含まれ、範囲 start ちょうどに終わるものは含まれない', () => {
      // 6/29〜end 7/2（3 日間: 6/29・6/30・7/1）→ 範囲（7/1〜）に食い込む
      const spanning = makeEvent({
        id: 'spanning',
        start: '2026-06-29',
        end: '2026-07-02',
        allDay: true,
      });
      // 6/29〜end 7/1（2 日間）→ 東京 7/1 0:00 ちょうどに終わる（排他）
      const endsAtStart = makeEvent({
        id: 'ends-at-start',
        start: '2026-06-29',
        end: '2026-07-01',
        allDay: true,
      });
      // 東京 7/1 0:00 〜 7/8 0:00
      const result = expand([spanning, endsAtStart], {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-07T15:00:00Z',
      });
      expect(result.map((o) => o.eventId)).toEqual(['spanning']);
      expect(result[0]!.start).toEqual(new Date('2026-06-28T15:00:00Z')); // 東京 6/29 0:00
      expect(result[0]!.end).toEqual(new Date('2026-07-01T15:00:00Z')); // 東京 7/2 0:00
    });

    it('終日繰り返しのオーバーライドが元の日付を置き換える', () => {
      const master = makeEvent({
        id: 'wk',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
      });
      // 7/8 のオカレンスを 7/9 へ移動
      const override = makeEvent({
        id: 'ado',
        recurringEventId: 'wk',
        originalStart: '2026-07-08',
        start: '2026-07-09',
        allDay: true,
      });
      const result = expand([master, override], {
        start: '2026-06-28T00:00:00Z',
        end: '2026-07-20T00:00:00Z',
      });
      expect(result.map((o) => [o.eventId, dateKeyInZone(o.start, TOKYO)])).toEqual([
        ['wk', '2026-07-01'],
        ['ado', '2026-07-09'],
        ['wk', '2026-07-15'],
      ]);
      const moved = result[1]!;
      expect(moved.allDay).toBe(true);
      expect(moved.isRecurring).toBe(true);
      // originalStart は表示 TZ における元の日付（7/8）の 0:00
      expect(moved.originalStart).toEqual(new Date('2026-07-07T15:00:00Z'));
    });
  });

  describe('終日イベントの不正な範囲（end <= start、日付キー比較）', () => {
    it('単発: end === start（同日）ならオカレンスを生成しない', () => {
      const source = makeEvent({
        id: 'ad-eq',
        start: '2026-07-01',
        end: '2026-07-01',
        allDay: true,
      });
      const result = expand([source], {
        start: '2026-06-29T15:00:00Z',
        end: '2026-07-05T15:00:00Z',
      });
      expect(result).toEqual([]);
    });

    it('単発: end < start ならオカレンスを生成しない', () => {
      const source = makeEvent({
        id: 'ad-lt',
        start: '2026-07-02',
        end: '2026-07-01',
        allDay: true,
      });
      const result = expand([source], {
        start: '2026-06-29T15:00:00Z',
        end: '2026-07-05T15:00:00Z',
      });
      expect(result).toEqual([]);
    });

    it('RRULE: マスターの end <= start ならどの回もオカレンスを生成しない', () => {
      const eq = makeEvent({
        id: 'rr-eq',
        start: '2026-07-01',
        end: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
      });
      const lt = makeEvent({
        id: 'rr-lt',
        start: '2026-07-01',
        end: '2026-06-30',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
      });
      const range = { start: '2026-06-28T00:00:00Z', end: '2026-07-20T00:00:00Z' };
      expect(expand([eq], range)).toEqual([]);
      expect(expand([lt], range)).toEqual([]);
    });

    it('RDATE（rrule なし）: end <= start ならマスターの日も rdate の日もオカレンスを生成しない', () => {
      const eq = makeEvent({
        id: 'rd-eq',
        start: '2026-07-01',
        end: '2026-07-01',
        allDay: true,
        rdates: ['2026-07-03'],
      });
      const lt = makeEvent({
        id: 'rd-lt',
        start: '2026-07-02',
        end: '2026-07-01',
        allDay: true,
        rdates: ['2026-07-05'],
      });
      const range = { start: '2026-06-28T00:00:00Z', end: '2026-07-20T00:00:00Z' };
      expect(expand([eq], range)).toEqual([]);
      expect(expand([lt], range)).toEqual([]);
    });

    it('オーバーライドが単一オカレンスの end <= start を不正化した場合、そのオカレンスだけ除外される', () => {
      const master = makeEvent({
        id: 'wk',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3', // 7/1・7/8・7/15
      });
      // 7/8 のオカレンスを end <= start の不正な範囲へ書き換える
      const override = makeEvent({
        id: 'ado-invalid',
        recurringEventId: 'wk',
        originalStart: '2026-07-08',
        start: '2026-07-08',
        end: '2026-07-08',
        allDay: true,
      });
      const result = expand([master, override], {
        start: '2026-06-28T00:00:00Z',
        end: '2026-07-20T00:00:00Z',
      });
      // 7/8 はマスター側でも（オーバーライドで置換済みのため）オーバーライド側でも
      // （end <= start のため）出現せず、7/1・7/15 のみが残る
      expect(result.map((o) => [o.eventId, dateKeyInZone(o.start, TOKYO)])).toEqual([
        ['wk', '2026-07-01'],
        ['wk', '2026-07-15'],
      ]);
    });

    it('回帰: end 省略時は 1 日、正常な end は日数を維持する', () => {
      const omitted = makeEvent({ id: 'omit', start: '2026-07-01', allDay: true });
      const normal = makeEvent({
        id: 'normal',
        start: '2026-07-01',
        end: '2026-07-03',
        allDay: true,
      });
      const range = { start: '2026-06-29T15:00:00Z', end: '2026-07-05T15:00:00Z' };
      const omittedResult = expand([omitted], range);
      const normalResult = expand([normal], range);
      expect(omittedResult[0]!.end.getTime() - omittedResult[0]!.start.getTime()).toBe(DAY_MS);
      expect(normalResult[0]!.end.getTime() - normalResult[0]!.start.getTime()).toBe(2 * DAY_MS);
    });
  });

  describe('ソート順', () => {
    it('start 昇順 → 同時刻は長い方が先 → 同長は eventId の辞書順に並ぶ', () => {
      const events = [
        makeEvent({ id: 'c-short', start: '2026-07-01T00:00:00Z', end: '2026-07-01T01:00:00Z' }),
        makeEvent({ id: 'b-long', start: '2026-07-01T00:00:00Z', end: '2026-07-01T03:00:00Z' }),
        makeEvent({ id: 'a-short', start: '2026-07-01T00:00:00Z', end: '2026-07-01T01:00:00Z' }),
        makeEvent({ id: 'd-early', start: '2026-06-30T23:00:00Z', end: '2026-07-01T00:30:00Z' }),
      ];
      const result = expand(events, { start: '2026-06-30T00:00:00Z', end: '2026-07-02T00:00:00Z' });
      expect(result.map((o) => o.eventId)).toEqual(['d-early', 'b-long', 'a-short', 'c-short']);
    });
  });

  describe('空集合・不正入力', () => {
    it('イベントが空なら空配列を返す', () => {
      expect(expand([], { start: '2026-07-01T00:00:00Z', end: '2026-07-02T00:00:00Z' })).toEqual(
        [],
      );
    });

    it('空範囲（start >= end）なら空配列を返す', () => {
      const source = makeEvent({ id: 'e1', start: '2026-07-01T00:00:00Z' });
      expect(
        expand([source], { start: '2026-07-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }),
      ).toEqual([]);
      expect(
        expand([source], { start: '2026-07-02T00:00:00Z', end: '2026-07-01T00:00:00Z' }),
      ).toEqual([]);
    });

    it('範囲内にオカレンスがなければ空配列を返す', () => {
      const source = makeEvent({
        id: 'e1',
        start: '2026-07-01T10:00:00Z',
        end: '2026-07-01T11:00:00Z',
      });
      expect(
        expand([source], { start: '2026-08-01T00:00:00Z', end: '2026-08-02T00:00:00Z' }),
      ).toEqual([]);
    });

    it('解釈できない日時文字列は例外を投げる', () => {
      const source = makeEvent({ id: 'bad', start: 'こんにちは' });
      expect(() =>
        expand([source], { start: '2026-07-01T00:00:00Z', end: '2026-07-02T00:00:00Z' }),
      ).toThrow('日時として解釈できない');
    });
  });
});

describe('resolveOccurrence', () => {
  describe('単発イベント', () => {
    const single = makeEvent({
      id: 's1',
      start: '2026-07-01T10:00:00',
      end: '2026-07-01T11:00:00',
    });

    it('開始時刻がミリ秒単位で一致すればオカレンスを返す', () => {
      const occ = resolve(single, '2026-07-01T01:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.key).toBe('s1@2026-07-01T01:00:00.000Z');
      expect(occ?.start).toEqual(new Date('2026-07-01T01:00:00Z'));
      expect(occ?.end).toEqual(new Date('2026-07-01T02:00:00Z'));
      expect(occ?.allDay).toBe(false);
      expect(occ?.isRecurring).toBe(false);
      expect(occ?.originalStart).toEqual(new Date('2026-07-01T01:00:00Z'));
    });

    it('一致しない時刻には null を返す（1 ミリ秒のずれも不一致）', () => {
      expect(resolve(single, '2026-07-01T01:00:00.001Z')).toBeNull();
      expect(resolve(single, '2026-07-01T02:00:00Z')).toBeNull();
    });

    it('end 省略時は defaultEventMinutes が適用される', () => {
      const noEnd = makeEvent({ id: 's2', start: '2026-07-01T00:00:00Z' });
      const occ = resolve(noEnd, '2026-07-01T00:00:00Z', TOKYO, 30);
      expect(occ?.end).toEqual(new Date('2026-07-01T00:30:00Z'));
    });
  });

  describe('繰り返しイベント', () => {
    const master = makeEvent({
      id: 'm1',
      start: '2026-07-01T10:00:00',
      end: '2026-07-01T11:00:00',
      rrule: 'FREQ=DAILY;COUNT=5',
      exdates: ['2026-07-03T10:00:00'],
    });

    it('有効なオカレンスの時刻ならオカレンスを返す', () => {
      const occ = resolve(master, '2026-07-02T01:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.key).toBe('m1@2026-07-02T01:00:00.000Z');
      expect(occ?.end).toEqual(new Date('2026-07-02T02:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      expect(occ?.originalStart).toEqual(new Date('2026-07-02T01:00:00Z'));
    });

    it('オカレンスではない時刻には null を返す', () => {
      expect(resolve(master, '2026-07-02T01:30:00Z')).toBeNull();
    });

    it('exdates で除外されたオカレンスには null を返す', () => {
      expect(resolve(master, '2026-07-03T01:00:00Z')).toBeNull();
    });

    it('dtstart より前・COUNT 超過の時刻には null を返す', () => {
      expect(resolve(master, '2026-06-30T01:00:00Z')).toBeNull(); // dtstart より前
      expect(resolve(master, '2026-07-06T01:00:00Z')).toBeNull(); // COUNT=5 の範囲外（6 回目）
    });
  });

  describe('RDATE（パターン外オカレンスの解決）', () => {
    it('rrule なし・時間指定で rdates のオカレンスを解決できる（isRecurring: true）', () => {
      const event = makeEvent({
        id: 'r1',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-07-03T10:00:00', '2026-07-05T10:00:00'],
      });
      // マスターの開始
      expect(resolve(event, '2026-07-01T01:00:00Z')?.isRecurring).toBe(true);
      // rdate 由来のオカレンス（従来は null になっていた）
      const occ = resolve(event, '2026-07-03T01:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.end).toEqual(new Date('2026-07-03T02:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      // rdate でない日は null
      expect(resolve(event, '2026-07-04T01:00:00Z')).toBeNull();
    });

    it('rrule なし・時間指定で exdates が rdate より優先される', () => {
      const event = makeEvent({
        id: 'r2',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rdates: ['2026-07-03T10:00:00'],
        exdates: ['2026-07-03T10:00:00'],
      });
      expect(resolve(event, '2026-07-03T01:00:00Z')).toBeNull();
    });

    it('rrule と rdates を併用したとき、rrule 由来・rdate 由来の両方を解決できる', () => {
      const event = makeEvent({
        id: 'r3',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=3', // 7/1, 7/2, 7/3
        rdates: ['2026-07-10T10:00:00'], // パターン外
      });
      expect(resolve(event, '2026-07-02T01:00:00Z')).not.toBeNull(); // rrule 由来
      expect(resolve(event, '2026-07-10T01:00:00Z')).not.toBeNull(); // rdate 由来
      expect(resolve(event, '2026-07-04T01:00:00Z')).toBeNull(); // どちらでもない
    });

    it('rrule なし・終日で rdates のオカレンスを解決できる（isRecurring: true）', () => {
      const event = makeEvent({
        id: 'r4',
        start: '2026-07-01',
        end: '2026-07-02',
        allDay: true,
        rdates: ['2026-07-03'],
      });
      const master = resolve(event, '2026-06-30T15:00:00Z'); // 7/1 0:00 JST
      expect(master?.isRecurring).toBe(true);
      const occ = resolve(event, '2026-07-02T15:00:00Z'); // 7/3 0:00 JST
      expect(occ).not.toBeNull();
      expect(occ?.allDay).toBe(true);
      expect(resolve(event, '2026-07-03T15:00:00Z')).toBeNull(); // 7/4（rdate でない）
    });
  });

  describe('オーバーライドイベント', () => {
    const override = makeEvent({
      id: 'o1',
      recurringEventId: 'm1',
      originalStart: '2026-07-03T10:00:00',
      start: '2026-07-03T15:00:00',
      end: '2026-07-03T16:00:00',
    });

    it('現在の開始時刻に一致すればオカレンスを返し、originalStart は元のオカレンスの時刻になる', () => {
      const occ = resolve(override, '2026-07-03T06:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.start).toEqual(new Date('2026-07-03T06:00:00Z'));
      expect(occ?.end).toEqual(new Date('2026-07-03T07:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      expect(occ?.originalStart).toEqual(new Date('2026-07-03T01:00:00Z'));
    });

    it('オーバーライドされた元のオカレンスの時刻には null を返す（移動済みで存在しない）', () => {
      expect(resolve(override, '2026-07-03T01:00:00Z')).toBeNull();
    });

    it('終日オーバーライドは表示 TZ の 0:00 一致で解決し、originalStart は元日付の 0:00 になる', () => {
      const allDayOverride = makeEvent({
        id: 'ado',
        recurringEventId: 'wk',
        originalStart: '2026-07-08',
        start: '2026-07-09',
        allDay: true,
      });
      const occ = resolve(allDayOverride, '2026-07-08T15:00:00Z'); // 東京 7/9 0:00
      expect(occ).not.toBeNull();
      expect(occ?.end).toEqual(new Date('2026-07-09T15:00:00Z'));
      expect(occ?.allDay).toBe(true);
      expect(occ?.isRecurring).toBe(true);
      expect(occ?.originalStart).toEqual(new Date('2026-07-07T15:00:00Z')); // 東京 7/8 0:00
      // 元の日付（7/8）の 0:00 は移動済みなので null
      expect(resolve(allDayOverride, '2026-07-07T15:00:00Z')).toBeNull();
    });

    it('params.master を渡すと、event.timeZone 省略時にマスターの timeZone へフォールバックして解釈する', () => {
      // マスターは NY 現地時刻 10:00 開始。オーバーライドは timeZone を省略し、
      // NY 14:00 のつもりで現地時刻文字列を書く。
      const master: CalendarEvent = makeEvent({
        id: 'master-ny',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        timeZone: NY,
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      const overrideNoTz: CalendarEvent = makeEvent({
        id: 'ov-ny',
        start: '2026-07-03T14:00:00', // timeZone 省略。NY 14:00 のつもり
        end: '2026-07-03T15:00:00',
        recurringEventId: 'master-ny',
        originalStart: '2026-07-03T10:00:00',
      });

      // master を渡さない場合は表示 TZ（東京）2 段フォールバックで解釈され、
      // NY 14:00（18:00Z）ちょうどには一致しない
      expect(
        resolveOccurrence({
          event: overrideNoTz,
          occurrenceStart: new Date('2026-07-03T18:00:00Z'),
          displayTimeZone: TOKYO,
          defaultEventMinutes: 60,
        }),
      ).toBeNull();

      // master を渡すと 3 段フォールバックになり、NY 14:00 EDT（18:00Z）で正しく解決する
      const resolved = resolveOccurrence({
        event: overrideNoTz,
        occurrenceStart: new Date('2026-07-03T18:00:00Z'),
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
        master,
      });
      expect(resolved).not.toBeNull();
      expect(resolved?.start).toEqual(new Date('2026-07-03T18:00:00Z'));
      expect(resolved?.end).toEqual(new Date('2026-07-03T19:00:00Z'));
    });
  });

  describe('終日イベント', () => {
    it('単発の終日イベントは表示 TZ の 0:00 ちょうどのみ一致する', () => {
      const allDay = makeEvent({ id: 'ad', start: '2026-07-01', allDay: true });
      const occ = resolve(allDay, '2026-06-30T15:00:00Z'); // 東京 7/1 0:00
      expect(occ).not.toBeNull();
      expect(occ?.end).toEqual(new Date('2026-07-01T15:00:00Z'));
      expect(occ?.allDay).toBe(true);
      // UTC の 7/1 0:00 は東京の 0:00 ではないので不一致
      expect(resolve(allDay, '2026-07-01T00:00:00Z')).toBeNull();
    });

    it('表示 TZ を America/New_York にすると NY の 0:00 で一致する', () => {
      const allDay = makeEvent({ id: 'ad', start: '2026-07-01', allDay: true });
      const occ = resolve(allDay, '2026-07-01T04:00:00Z', NY); // NY 7/1 0:00 EDT
      expect(occ).not.toBeNull();
      expect(occ?.end).toEqual(new Date('2026-07-02T04:00:00Z'));
    });

    it('終日の繰り返しは有効な日付の 0:00 のみオカレンスとして解決する', () => {
      const weekly = makeEvent({
        id: 'wk',
        start: '2026-07-01',
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=3',
        exdates: ['2026-07-15'],
      });
      // 7/8（2 回目）の東京 0:00 → 有効
      const occ = resolve(weekly, '2026-07-07T15:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.end).toEqual(new Date('2026-07-08T15:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      // 7/9 はオカレンスの日ではない
      expect(resolve(weekly, '2026-07-08T15:00:00Z')).toBeNull();
      // 7/15 は exdate（日付キー一致）で除外済み
      expect(resolve(weekly, '2026-07-14T15:00:00Z')).toBeNull();
      // オカレンスの日でも 0:00 ちょうどでなければ無効
      expect(resolve(weekly, '2026-07-07T16:00:00Z')).toBeNull();
      // NY 表示なら NY の 0:00 で一致する
      const inNy = resolve(weekly, '2026-07-08T04:00:00Z', NY);
      expect(inNy).not.toBeNull();
      expect(inNy?.end).toEqual(new Date('2026-07-09T04:00:00Z'));
    });
  });
});
