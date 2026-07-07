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

/** ISO 文字列の発生開始指定で resolveOccurrence を呼ぶテスト用ヘルパー。 */
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
    it('範囲内の単発イベントを 1 件の発生に展開し、全フィールドを設定する', () => {
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

    it('オフセットなしの日時文字列は event.timeZone の壁時計として解釈される', () => {
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

    it('各発生の長さはマスターの start/end のミリ秒差を維持する（DST 跨ぎ）', () => {
      // NY の 1:30〜3:30（2 時間）。3/8 の発生は DST 開始（2:00→3:00）を跨ぐ
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
      // 2 回目も開始からちょうど 2 時間（壁時計では 4:30 終了になる）
      expect(result.map((o) => o.end.toISOString())).toEqual([
        '2026-03-07T08:30:00.000Z',
        '2026-03-08T08:30:00.000Z',
      ]);
    });

    it('発生の開始はイベント TZ の壁時計時刻を DST を跨いで維持する（NY 毎日 9:00）', () => {
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

    it('範囲開始前に始まり範囲に食い込む発生も含まれる', () => {
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

    it('範囲 start ちょうどに終わる発生は含まれない（発生 end 排他）', () => {
      const source = makeEvent({
        id: 'late',
        start: '2026-07-01T23:00:00',
        end: '2026-07-02T01:00:00',
        rrule: 'FREQ=DAILY;COUNT=5',
      });
      // 範囲 start = 東京 7/3 1:00（7/2 の発生の終了ちょうど）
      const result = expand([source], {
        start: '2026-07-02T16:00:00Z',
        end: '2026-07-03T15:00:00Z',
      });
      expect(result.map((o) => o.start.toISOString())).toEqual(['2026-07-03T14:00:00.000Z']);
    });

    it('exdates の発生が開始時刻のミリ秒一致で除外される', () => {
      const base = {
        id: 'ex',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T11:00:00',
        rrule: 'FREQ=DAILY;COUNT=3',
      };
      const range = { start: '2026-06-30T15:00:00Z', end: '2026-07-04T15:00:00Z' };
      // 文字列（イベント TZ の壁時計）でも Date（絶対時刻）でも除外できる
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

    it('UNTIL はイベント TZ の壁時計として解釈される（truncateRRule と整合する意図的仕様）', () => {
      // 東京の毎日 10:00。UNTIL=20260702T090000Z を「東京の壁時計 7/2 9:00」と
      // 解釈するため 7/2 10:00 の発生は含まれない（RFC 5545 の UTC 解釈なら
      // 7/2 18:00 東京となり 7/2 の発生が含まれてしまう）
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
      // 元発生 7/5 10:00 は範囲外 → 7/3 20:00（範囲内）へ移動 → 表示される
      const movedIn = makeEvent({
        id: 'o-in',
        recurringEventId: 'm1',
        originalStart: '2026-07-05T10:00:00',
        start: '2026-07-03T20:00:00',
        end: '2026-07-03T21:00:00',
      });
      // 元発生 7/4 10:00 は範囲内 → 7/10（範囲外）へ移動 → 表示されない
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
      // オーバーライドの originalStart は置換した元発生の開始時刻
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

    it('日付の解釈は event.timeZone で行い、日付キーに正規化してから表示 TZ に射影する', () => {
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
      // 発生の開始はそれぞれの表示 TZ における 0:00
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
      // 7/8 の発生を 7/9 へ移動
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

    it('範囲内に発生がなければ空配列を返す', () => {
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

    it('開始時刻がミリ秒単位で一致すれば発生を返す', () => {
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

    it('有効な発生の時刻なら発生を返す', () => {
      const occ = resolve(master, '2026-07-02T01:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.key).toBe('m1@2026-07-02T01:00:00.000Z');
      expect(occ?.end).toEqual(new Date('2026-07-02T02:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      expect(occ?.originalStart).toEqual(new Date('2026-07-02T01:00:00Z'));
    });

    it('発生ではない時刻には null を返す', () => {
      expect(resolve(master, '2026-07-02T01:30:00Z')).toBeNull();
    });

    it('exdates で除外された発生には null を返す', () => {
      expect(resolve(master, '2026-07-03T01:00:00Z')).toBeNull();
    });

    it('dtstart より前・COUNT 超過の時刻には null を返す', () => {
      expect(resolve(master, '2026-06-30T01:00:00Z')).toBeNull(); // dtstart より前
      expect(resolve(master, '2026-07-06T01:00:00Z')).toBeNull(); // COUNT=5 の範囲外（6 回目）
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

    it('現在の開始時刻に一致すれば発生を返し、originalStart は元発生の時刻になる', () => {
      const occ = resolve(override, '2026-07-03T06:00:00Z');
      expect(occ).not.toBeNull();
      expect(occ?.start).toEqual(new Date('2026-07-03T06:00:00Z'));
      expect(occ?.end).toEqual(new Date('2026-07-03T07:00:00Z'));
      expect(occ?.isRecurring).toBe(true);
      expect(occ?.originalStart).toEqual(new Date('2026-07-03T01:00:00Z'));
    });

    it('オーバーライドされた元発生の時刻には null を返す（移動済みで存在しない）', () => {
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

    it('終日の繰り返しは有効な日付の 0:00 のみ発生として解決する', () => {
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
      // 7/9 は発生日ではない
      expect(resolve(weekly, '2026-07-08T15:00:00Z')).toBeNull();
      // 7/15 は exdate（日付キー一致）で除外済み
      expect(resolve(weekly, '2026-07-14T15:00:00Z')).toBeNull();
      // 発生日でも 0:00 ちょうどでなければ無効
      expect(resolve(weekly, '2026-07-07T16:00:00Z')).toBeNull();
      // NY 表示なら NY の 0:00 で一致する
      const inNy = resolve(weekly, '2026-07-08T04:00:00Z', NY);
      expect(inNy).not.toBeNull();
      expect(inNy?.end).toEqual(new Date('2026-07-09T04:00:00Z'));
    });
  });
});
