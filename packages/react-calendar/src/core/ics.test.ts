/**
 * ics.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' や 'UTC' を引数で明示して行う。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST(UTC-5) → EDT(UTC-4)、02:00〜02:59 は存在しない）
 * - 終了: 2026-11-01 02:00（EDT(UTC-4) → EST(UTC-5)、01:00〜01:59 は 2 回現れる）
 */
import { describe, expect, it } from 'vitest';
import { expandEvents } from './expansion';
import { eventsFromIcs, eventsFromIcsWithIssues, eventsToIcs } from './ics';
import type { CalendarEvent } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

/** DTSTAMP を固定して出力を決定的にするための時刻。 */
const STAMP = new Date('2026-07-01T00:00:00Z');

/** 既定オプション（DTSTAMP 固定・フォールバック TZ を東京に固定）で ICS を出力する。 */
function toIcs(events: readonly CalendarEvent[]): string {
  return eventsToIcs(events, { dtstamp: STAMP, timeZone: TOKYO });
}

/** CRLF 区切りの ICS テキストを組み立てる（末尾にも CRLF を付ける）。 */
function icsText(...lines: string[]): string {
  return `${lines.join('\r\n')}\r\n`;
}

/** Date の配列を ISO 文字列の配列に変換する（アサーションの可読性のため）。 */
function toISO(dates: readonly Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

/** 関数が投げる Error のメッセージを取り出す（投げなければテストを失敗させる）。 */
function captureErrorMessage(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('関数はエラーを投げませんでした');
}

describe('eventsToIcs', () => {
  describe('VCALENDAR/VEVENT の構造', () => {
    it('VCALENDAR で全体を包み、VERSION/PRODID/CALSCALE と CRLF 改行を出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: '打ち合わせ',
          start: new Date('2026-07-01T01:00:00Z'),
          end: new Date('2026-07-01T02:00:00Z'),
        },
      ]);
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(ics).toContain('VERSION:2.0\r\n');
      expect(ics).toContain('PRODID:');
      expect(ics).toContain('CALSCALE:GREGORIAN\r\n');
      expect(ics).toContain('BEGIN:VEVENT\r\n');
      expect(ics).toContain('END:VEVENT\r\n');
      expect(ics).toContain('UID:e1\r\n');
      expect(ics).toContain('SUMMARY:打ち合わせ\r\n');
      expect(ics).toContain('DTSTAMP:20260701T000000Z\r\n');
    });

    it('イベントが 0 件でも VCALENDAR ラッパーだけを出力する', () => {
      const ics = toIcs([]);
      expect(ics).not.toContain('BEGIN:VEVENT');
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    });

    it('dtstamp 省略時は現在時刻の DTSTAMP を出力する', () => {
      const ics = eventsToIcs([{ id: 'e1', title: 'A', start: new Date('2026-07-01T01:00:00Z') }], {
        timeZone: TOKYO,
      });
      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
    });

    it('prodId オプションで PRODID の値を差し替えられる', () => {
      const ics = eventsToIcs([], { prodId: '-//example//test//JA' });
      expect(ics).toContain('PRODID:-//example//test//JA\r\n');
    });

    it('LOCATION と DESCRIPTION は指定があるときだけ出力する', () => {
      const withBoth = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: new Date('2026-07-01T01:00:00Z'),
          location: '会議室A',
          description: 'アジェンダ',
        },
      ]);
      expect(withBoth).toContain('LOCATION:会議室A\r\n');
      expect(withBoth).toContain('DESCRIPTION:アジェンダ\r\n');
      const withoutBoth = toIcs([
        { id: 'e1', title: 'A', start: new Date('2026-07-01T01:00:00Z') },
      ]);
      expect(withoutBoth).not.toContain('LOCATION');
      expect(withoutBoth).not.toContain('DESCRIPTION');
    });
  });

  describe('日時の表現', () => {
    it('timeZone のないイベント（Date / オフセット付き文字列）は UTC（末尾 Z）で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: new Date('2026-07-01T01:00:00Z'),
          end: new Date('2026-07-01T02:00:00Z'),
        },
      ]);
      expect(ics).toContain('DTSTART:20260701T010000Z\r\n');
      expect(ics).toContain('DTEND:20260701T020000Z\r\n');
    });

    it('timeZone のあるイベントは TZID パラメータ付きの現地時刻で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-06T10:00:00',
          end: '2026-07-06T11:00:00',
          timeZone: TOKYO,
        },
      ]);
      expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260706T100000\r\n');
      expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20260706T110000\r\n');
    });

    it('Date で与えた開始時刻も、イベント TZ の現地時刻に変換して出力する', () => {
      // 2026-03-02T14:00Z = America/New_York の 09:00 EST（DST 開始 3/8 より前）
      const ics = toIcs([
        { id: 'e1', title: 'A', start: new Date('2026-03-02T14:00:00Z'), timeZone: NY },
      ]);
      expect(ics).toContain('DTSTART;TZID=America/New_York:20260302T090000\r\n');
    });

    it('timeZone がなくオフセットなし文字列のイベントは、そのままの現地時刻（Z なし）で出力する', () => {
      const ics = toIcs([{ id: 'e1', title: 'A', start: '2026-07-01T10:00' }]);
      expect(ics).toContain('DTSTART:20260701T100000\r\n');
      expect(ics).not.toContain('DTSTART:20260701T100000Z');
    });

    it('end 省略時は defaultEventMinutes（既定 60 分）を DTEND に反映する', () => {
      const withDefault = toIcs([{ id: 'e1', title: 'A', start: '2026-07-01T10:00' }]);
      expect(withDefault).toContain('DTEND:20260701T110000\r\n');
      const withOption = eventsToIcs([{ id: 'e1', title: 'A', start: '2026-07-01T10:00' }], {
        dtstamp: STAMP,
        timeZone: TOKYO,
        defaultEventMinutes: 30,
      });
      expect(withOption).toContain('DTEND:20260701T103000\r\n');
    });

    it('終日イベントは VALUE=DATE で出力し、排他的な end をそのまま DTEND にする', () => {
      const ics = toIcs([
        { id: 'e1', title: '夏休み', start: '2026-08-01', end: '2026-08-03', allDay: true },
      ]);
      expect(ics).toContain('DTSTART;VALUE=DATE:20260801\r\n');
      expect(ics).toContain('DTEND;VALUE=DATE:20260803\r\n');
    });

    it('終日イベントの end 省略時は翌日を DTEND にする（1 日の予定）', () => {
      const ics = toIcs([{ id: 'e1', title: 'A', start: '2026-08-01', allDay: true }]);
      expect(ics).toContain('DTEND;VALUE=DATE:20260802\r\n');
    });

    it('ミリ秒は切り捨て、秒までを出力する', () => {
      const ics = toIcs([{ id: 'e1', title: 'A', start: new Date('2026-07-01T01:00:30.500Z') }]);
      expect(ics).toContain('DTSTART:20260701T010030Z\r\n');
    });
  });

  describe('RRULE', () => {
    it('rrule を正規化して RRULE プロパティに出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-06T10:00:00',
          timeZone: TOKYO,
          rrule: 'RRULE:freq=weekly;byday=MO',
        },
      ]);
      expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO\r\n');
    });

    it('UNTIL はイベント TZ の現地時刻から UTC に変換して出力する（DST 跨ぎ）', () => {
      // Koyomi の rrule 文字列では UNTIL=20260310T090000Z は「NY 現地 3/10 09:00」を表す。
      // 3/10 は DST 開始（3/8）後なので EDT(UTC-4)、絶対時刻は 13:00Z になる
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: new Date('2026-03-02T14:00:00Z'), // NY 3/2 09:00 EST
          timeZone: NY,
          rrule: 'FREQ=DAILY;UNTIL=20260310T090000Z',
        },
      ]);
      expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20260310T130000Z\r\n');
    });

    it('timeZone のないイベント（UTC 形式）の UNTIL は、オプションの timeZone の現地時刻として解釈し UTC に変換して出力する', () => {
      // Koyomi の rrule 文字列では UNTIL=20260710T010000Z は「表示 TZ（ここでは東京）の 7/10 01:00」を表す。
      // 東京 7/10 01:00 = 2026-07-09T16:00:00Z
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: new Date('2026-07-01T01:00:00Z'),
          rrule: 'FREQ=DAILY;UNTIL=20260710T010000Z',
        },
      ]);
      expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20260709T160000Z\r\n');
    });

    it('timeZone がなくオフセットなし文字列のイベントの UNTIL は、DTSTART と型を揃えた現地時刻形式（Z なし）で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-01T10:00:00',
          rrule: 'FREQ=DAILY;UNTIL=20260705T100000',
        },
      ]);
      expect(ics).toContain('DTSTART:20260701T100000\r\n');
      expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20260705T100000\r\n');
      expect(ics).not.toContain('UNTIL=20260705T100000Z');
    });

    it('終日イベントの UNTIL は日付形式（YYYYMMDD）で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-08-01',
          allDay: true,
          rrule: 'FREQ=DAILY;UNTIL=20260810T000000Z',
        },
      ]);
      expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20260810\r\n');
    });
  });

  describe('EXDATE / RDATE', () => {
    it('exdates を TZID 付きの単一プロパティにカンマ結合して出力する', () => {
      // 2 つ目の exdate は Date 指定: 2026-07-27T01:00Z = 東京 10:00
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-06T10:00:00',
          timeZone: TOKYO,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          exdates: ['2026-07-20T10:00:00', new Date('2026-07-27T01:00:00Z')],
        },
      ]);
      expect(ics).toContain('EXDATE;TZID=Asia/Tokyo:20260720T100000,20260727T100000\r\n');
    });

    it('rdates を TZID 付きで出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-06T10:00:00',
          timeZone: TOKYO,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          rdates: ['2026-07-23T10:00:00'],
        },
      ]);
      expect(ics).toContain('RDATE;TZID=Asia/Tokyo:20260723T100000\r\n');
    });

    it('timeZone のないイベントの exdates は UTC で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: new Date('2026-07-01T01:00:00Z'),
          rrule: 'FREQ=DAILY',
          exdates: [new Date('2026-07-03T01:00:00Z')],
        },
      ]);
      expect(ics).toContain('EXDATE:20260703T010000Z\r\n');
    });

    it('timeZone がなくオフセットなし文字列の exdates は現地時刻（Z なし）で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-01T10:00',
          rrule: 'FREQ=DAILY',
          exdates: ['2026-07-03T10:00'],
        },
      ]);
      expect(ics).toContain('EXDATE:20260703T100000\r\n');
      expect(ics).not.toContain('EXDATE:20260703T100000Z');
    });

    it('終日イベントの exdates / rdates は VALUE=DATE で出力する', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-08-01',
          allDay: true,
          rrule: 'FREQ=DAILY',
          exdates: ['2026-08-05'],
          rdates: ['2026-09-01'],
        },
      ]);
      expect(ics).toContain('EXDATE;VALUE=DATE:20260805\r\n');
      expect(ics).toContain('RDATE;VALUE=DATE:20260901\r\n');
    });

    it('exdates / rdates が空配列・未指定なら EXDATE / RDATE を出力しない', () => {
      const ics = toIcs([
        {
          id: 'e1',
          title: 'A',
          start: '2026-07-06T10:00:00',
          timeZone: TOKYO,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          exdates: [],
        },
      ]);
      expect(ics).not.toContain('EXDATE');
      expect(ics).not.toContain('RDATE');
    });
  });

  describe('オーバーライド（RECURRENCE-ID）', () => {
    const master: CalendarEvent = {
      id: 'm1',
      title: '週次',
      start: '2026-07-06T10:00:00',
      end: '2026-07-06T11:00:00',
      timeZone: TOKYO,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    };

    it('recurringEventId + originalStart を UID（マスターの ID）+ RECURRENCE-ID で表現する', () => {
      const override: CalendarEvent = {
        id: 'ov1',
        title: '週次（時間変更）',
        start: '2026-07-13T15:00:00',
        end: '2026-07-13T16:00:00',
        timeZone: TOKYO,
        recurringEventId: 'm1',
        originalStart: '2026-07-13T10:00:00',
      };
      const ics = toIcs([master, override]);
      expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000\r\n');
      // オーバーライドの VEVENT の UID はマスターの ID になる（UID:ov1 は出力されない）
      expect(ics).not.toContain('UID:ov1');
      const veventCount = ics.split('BEGIN:VEVENT').length - 1;
      const uidM1Count = ics.split('UID:m1\r\n').length - 1;
      expect(veventCount).toBe(2);
      expect(uidM1Count).toBe(2);
    });

    it('timeZone を持たないオーバーライドはマスターの timeZone を引き継いで TZID 出力する', () => {
      const override: CalendarEvent = {
        id: 'ov1',
        title: '週次（時間変更）',
        start: '2026-07-13T15:00:00',
        recurringEventId: 'm1',
        originalStart: '2026-07-13T10:00:00',
      };
      const ics = toIcs([master, override]);
      expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260713T150000\r\n');
      expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000\r\n');
    });

    it('終日マスターのオーバーライドは RECURRENCE-ID を VALUE=DATE で出力する', () => {
      const allDayMaster: CalendarEvent = {
        id: 'ad1',
        title: '毎日',
        start: '2026-08-01',
        allDay: true,
        rrule: 'FREQ=DAILY',
      };
      const override: CalendarEvent = {
        id: 'ov1',
        title: '移動した日',
        start: '2026-08-06',
        allDay: true,
        recurringEventId: 'ad1',
        originalStart: '2026-08-05',
      };
      const ics = toIcs([allDayMaster, override]);
      expect(ics).toContain('RECURRENCE-ID;VALUE=DATE:20260805\r\n');
    });
  });

  describe('エスケープと折り返し', () => {
    it("TEXT 値の ';' ',' '\\' と改行を RFC 5545 に従ってエスケープする", () => {
      const ics = toIcs([
        { id: 'e1', title: 'A;B,C\\D\nE', start: new Date('2026-07-01T01:00:00Z') },
      ]);
      expect(ics).toContain('SUMMARY:A\\;B\\,C\\\\D\\nE\r\n');
    });

    it('75 オクテットを超える行を折り返す（マルチバイト文字を分断しない）', () => {
      const description = 'あ'.repeat(60); // 180 オクテット
      const ics = toIcs([
        { id: 'e1', title: 'A', start: new Date('2026-07-01T01:00:00Z'), description },
      ]);
      const encoder = new TextEncoder();
      for (const line of ics.split('\r\n')) {
        expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      }
      // 折り返しても取り込み時に元のテキストへ復元される
      const [event] = eventsFromIcs(ics);
      expect(event?.description).toBe(description);
    });
  });

  describe('不正な入力', () => {
    it('不正な RRULE を持つイベントには Error を投げる', () => {
      expect(() =>
        toIcs([{ id: 'e1', title: 'A', start: '2026-07-01T10:00', rrule: 'FOO=BAR' }]),
      ).toThrow(Error);
    });

    it('無効な timeZone を持つイベントには Error を投げる', () => {
      expect(() =>
        toIcs([{ id: 'e1', title: 'A', start: '2026-07-01T10:00', timeZone: 'Invalid/Zone' }]),
      ).toThrow(/タイムゾーン/);
    });

    it('オプションの timeZone が無効な場合は Error を投げる', () => {
      expect(() => eventsToIcs([], { timeZone: 'Invalid/Zone' })).toThrow(/タイムゾーン/);
    });

    it('マスターから引き継ぐ timeZone が無効な場合も Error を投げる', () => {
      // オーバーライド自身は timeZone を持たず、マスターの無効な timeZone を引き継ぐ
      const override: CalendarEvent = {
        id: 'ov1',
        title: 'A',
        start: '2026-07-13T15:00',
        recurringEventId: 'm1',
        originalStart: '2026-07-13T10:00',
      };
      const master: CalendarEvent = {
        id: 'm1',
        title: 'A',
        start: '2026-07-06T10:00',
        timeZone: 'Invalid/Zone',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      };
      expect(() => toIcs([override, master])).toThrow(/タイムゾーン/);
    });
  });
});

describe('eventsFromIcs', () => {
  describe('基本のパース', () => {
    it('VEVENT を CalendarEvent に変換する（UID → id、SUMMARY → title）', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VCALENDAR',
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'DTEND:20260701T020000Z',
          'SUMMARY:打ち合わせ',
          'LOCATION:会議室A',
          'DESCRIPTION:アジェンダ',
          'END:VEVENT',
          'END:VCALENDAR',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: 'e1',
        title: '打ち合わせ',
        start: '2026-07-01T01:00:00Z',
        end: '2026-07-01T02:00:00Z',
        location: '会議室A',
        description: 'アジェンダ',
      });
    });

    it('LF のみの改行・VCALENDAR ラッパーなしの入力も受け付ける', () => {
      const events = eventsFromIcs(
        ['BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T010000Z', 'SUMMARY:A', 'END:VEVENT'].join(
          '\n',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe('e1');
    });

    it('VEVENT が 1 つもなければ空配列を返す', () => {
      expect(eventsFromIcs(icsText('BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR'))).toEqual([]);
    });

    it('UID がない VEVENT には出現順の ID を自動生成する', () => {
      const events = eventsFromIcs(
        icsText('BEGIN:VEVENT', 'DTSTART:20260701T010000Z', 'SUMMARY:A', 'END:VEVENT'),
      );
      expect(events[0]?.id).toBe('ics-event-1');
    });

    it('SUMMARY がない VEVENT の title は空文字になる', () => {
      const events = eventsFromIcs(
        icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T010000Z', 'END:VEVENT'),
      );
      expect(events[0]?.title).toBe('');
    });

    it('エスケープされた TEXT 値を復元する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'SUMMARY:A\\;B\\,C\\\\D\\nE',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.title).toBe('A;B,C\\D\nE');
    });

    it('先頭行が継続行（スペース始まり）でも連結先がないためそのままの行として扱う', () => {
      // コンポーネント外の行は無視されるため、取り込み結果には影響しない
      const events = eventsFromIcs(
        icsText(' X-STRAY:1', 'BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T010000Z', 'END:VEVENT'),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe('e1');
    });

    it('折り返された行（CRLF + スペース）を連結してから解釈する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'SUMMARY:とても長いタイトルの',
          ' 続きの部分',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.title).toBe('とても長いタイトルの続きの部分');
    });
  });

  describe('日時の解釈', () => {
    it('TZID 付きの日時は timeZone とオフセットなし文字列の組になる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=Asia/Tokyo:20260706T110000',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.timeZone).toBe(TOKYO);
      expect(events[0]?.start).toBe('2026-07-06T10:00:00');
      expect(events[0]?.end).toBe('2026-07-06T11:00:00');
    });

    it('VALUE=DATE は終日イベント（allDay: true と日付文字列）になる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;VALUE=DATE:20260801',
          'DTEND;VALUE=DATE:20260803',
          'SUMMARY:夏休み',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.allDay).toBe(true);
      expect(events[0]?.start).toBe('2026-08-01');
      expect(events[0]?.end).toBe('2026-08-03');
      expect(events[0]?.timeZone).toBeUndefined();
    });

    it('TZID も Z もない日時（フローティング）はオフセットなし文字列のまま取り込む', () => {
      const events = eventsFromIcs(
        icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T100000', 'SUMMARY:A', 'END:VEVENT'),
      );
      expect(events[0]?.start).toBe('2026-07-01T10:00:00');
      expect(events[0]?.timeZone).toBeUndefined();
    });

    it('引用符付きの TZID・値のないパラメータも解釈できる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;X-FLAG;TZID="Asia/Tokyo":20260706T100000',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.timeZone).toBe(TOKYO);
      expect(events[0]?.start).toBe('2026-07-06T10:00:00');
    });

    it('DTEND がなければ end を設定しない', () => {
      const events = eventsFromIcs(
        icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T010000Z', 'SUMMARY:A', 'END:VEVENT'),
      );
      expect(events[0]?.end).toBeUndefined();
    });

    it('DTSTART と DTEND の TZID が異なる場合、end は絶対時刻の Date になる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=America/New_York:20260705T220000', // 東京 7/6 11:00 と同時刻（EDT: UTC-4）
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      const end = events[0]?.end;
      expect(end).toBeInstanceOf(Date);
      // NY 7/5 22:00 EDT = 2026-07-06T02:00:00Z
      expect(end instanceof Date ? end.toISOString() : end).toBe('2026-07-06T02:00:00.000Z');
    });
  });

  describe('繰り返し関連', () => {
    it('EXDATE は複数プロパティとカンマ区切りの両方を合成して exdates にする', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE;TZID=Asia/Tokyo:20260713T100000,20260720T100000',
          'EXDATE;TZID=Asia/Tokyo:20260727T100000',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.exdates).toEqual([
        '2026-07-13T10:00:00',
        '2026-07-20T10:00:00',
        '2026-07-27T10:00:00',
      ]);
    });

    it('RDATE を rdates にする', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'RDATE;TZID=Asia/Tokyo:20260723T100000',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.rdates).toEqual(['2026-07-23T10:00:00']);
    });

    it('RECURRENCE-ID を recurringEventId + originalStart のオーバーライドに変換する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'SUMMARY:週次',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000',
          'DTSTART;TZID=Asia/Tokyo:20260713T150000',
          'SUMMARY:週次（時間変更）',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      const override = events[1];
      expect(override?.id).toBe('m1@20260713T100000');
      expect(override?.recurringEventId).toBe('m1');
      expect(override?.originalStart).toBe('2026-07-13T10:00:00');
      expect(override?.timeZone).toBe(TOKYO);
    });

    it('UNTIL（UTC）はイベント TZ の現地時刻に変換して取り込む', () => {
      // Google カレンダーの UNTIL は UTC 表記。20260726T145959Z = 東京 7/26 23:59:59
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260726T145959Z',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.rrule).toContain('UNTIL=20260726T235959Z');
      expect(events[0]?.rrule).toContain('FREQ=WEEKLY');
    });

    it('終日イベントの UNTIL は日付として取り込む', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;VALUE=DATE:20260801',
          'RRULE:FREQ=DAILY;UNTIL=20260810',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.rrule).toContain('UNTIL=20260810');
      expect(events[0]?.rrule).not.toContain('UNTIL=20260810T');
    });

    it('STATUS:CANCELLED のオーバーライドはマスターの exdates になる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'SUMMARY:週次',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000',
          'DTSTART;TZID=Asia/Tokyo:20260713T100000',
          'STATUS:CANCELLED',
          'SUMMARY:週次',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.exdates).toEqual(['2026-07-13T10:00:00']);
    });

    it('timeZone のないイベント（UTC 形式）の UNTIL は、実行環境のローカル TZ の現地時刻に変換して取り込む', () => {
      // テストプロセスのローカル TZ は Asia/Tokyo。2026-07-10T01:00Z = 東京 7/10 10:00
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'RRULE:FREQ=DAILY;UNTIL=20260710T010000Z',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.rrule).toContain('UNTIL=20260710T100000Z');
    });

    it('フローティングのイベントの UNTIL は数字を変換せずそのまま取り込む', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T100000',
          'RRULE:FREQ=DAILY;UNTIL=20260705T100000',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      // 正規化で末尾に Z が付くが、数字は表示 TZ の現地時刻としてそのまま解釈される
      expect(events[0]?.rrule).toContain('UNTIL=20260705T100000Z');
    });

    it('マスターが同じ ICS 内にない STATUS:CANCELLED のオーバーライドは無視する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000',
          'DTSTART;TZID=Asia/Tokyo:20260713T100000',
          'STATUS:CANCELLED',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events).toEqual([]);
    });

    it('STATUS:CANCELLED の単発イベントは取り込まない', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'STATUS:CANCELLED',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events).toEqual([]);
    });
  });

  describe('RECURRENCE-ID;RANGE=THISANDFUTURE のシリーズ分割', () => {
    it('時間指定シリーズを分割点で旧系列（UNTIL 打ち切り）と新系列（独立イベント）に分割する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=Asia/Tokyo:20260706T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'SUMMARY:週次',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T130000',
          'DTEND;TZID=Asia/Tokyo:20260727T140000',
          'SUMMARY:週次（午後へ変更）',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      // 旧系列: 分割点直前のオカレンス（7/20 10:00）で UNTIL 打ち切り
      expect(events[0]?.id).toBe('m1');
      expect(events[0]?.rrule).toContain('FREQ=WEEKLY');
      expect(events[0]?.rrule).toContain('UNTIL=20260720T100000Z');
      // 新系列: オーバーライドの DTSTART から始まる独立イベント（オーバーライド扱いにしない）
      expect(events[1]).toEqual({
        id: 'm1@20260727T100000',
        title: '週次（午後へ変更）',
        start: '2026-07-27T13:00:00',
        end: '2026-07-27T14:00:00',
        timeZone: TOKYO,
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
          end: new Date('2026-08-09T15:00:00Z'), // 東京 8/10 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(
        occurrences.map((o) => ({ title: o.event.title, start: o.start.toISOString() })),
      ).toEqual([
        { title: '週次', start: '2026-07-06T01:00:00.000Z' }, // 東京 10:00
        { title: '週次', start: '2026-07-13T01:00:00.000Z' },
        { title: '週次', start: '2026-07-20T01:00:00.000Z' },
        { title: '週次（午後へ変更）', start: '2026-07-27T04:00:00.000Z' }, // 東京 13:00
        { title: '週次（午後へ変更）', start: '2026-08-03T04:00:00.000Z' },
      ]);
    });

    it('COUNT ありのシリーズは消化済み回数を差し引いた COUNT を新系列に引き継ぐ', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260801T090000',
          'DTEND;TZID=Asia/Tokyo:20260801T093000',
          'RRULE:FREQ=DAILY;COUNT=10',
          'SUMMARY:朝会',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260805T090000',
          'DTSTART;TZID=Asia/Tokyo:20260805T200000',
          'DTEND;TZID=Asia/Tokyo:20260805T203000',
          'SUMMARY:夜会',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      // 旧系列: COUNT は UNTIL 打ち切りに置き換わる（8/1〜8/4 の 4 回）
      expect(events[0]?.rrule).toBe('FREQ=DAILY;UNTIL=20260804T090000Z');
      // 新系列: COUNT=10 から消化済み 4 回を差し引いた残数
      expect(events[1]?.rrule).toBe('FREQ=DAILY;COUNT=6');
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-07-31T15:00:00Z'), // 東京 8/1 0:00
          end: new Date('2026-08-14T15:00:00Z'), // 東京 8/15 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(toISO(occurrences.map((o) => o.start))).toEqual([
        '2026-08-01T00:00:00.000Z', // 東京 9:00
        '2026-08-02T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z',
        '2026-08-04T00:00:00.000Z',
        '2026-08-05T11:00:00.000Z', // 東京 20:00（新系列）
        '2026-08-06T11:00:00.000Z',
        '2026-08-07T11:00:00.000Z',
        '2026-08-08T11:00:00.000Z',
        '2026-08-09T11:00:00.000Z',
        '2026-08-10T11:00:00.000Z',
      ]);
    });

    it('終日シリーズは日付キー基準で分割し、新系列も終日イベントになる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:ad1',
          'DTSTART;VALUE=DATE:20260801',
          'DTEND;VALUE=DATE:20260802',
          'RRULE:FREQ=DAILY;COUNT=7',
          'SUMMARY:合宿',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:ad1',
          'RECURRENCE-ID;VALUE=DATE;RANGE=THISANDFUTURE:20260805',
          'DTSTART;VALUE=DATE:20260806',
          'DTEND;VALUE=DATE:20260807',
          'SUMMARY:合宿（1 日順延）',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        id: 'ad1@20260805',
        title: '合宿（1 日順延）',
        start: '2026-08-06',
        end: '2026-08-07',
        allDay: true,
        rrule: 'FREQ=DAILY;COUNT=3',
      });
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-07-31T15:00:00Z'), // 東京 8/1 0:00
          end: new Date('2026-08-09T15:00:00Z'), // 東京 8/10 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(occurrences.every((o) => o.allDay)).toBe(true);
      expect(toISO(occurrences.map((o) => o.start))).toEqual([
        '2026-07-31T15:00:00.000Z', // 東京 8/1 0:00（旧系列 8/1〜8/4）
        '2026-08-01T15:00:00.000Z',
        '2026-08-02T15:00:00.000Z',
        '2026-08-03T15:00:00.000Z',
        '2026-08-05T15:00:00.000Z', // 東京 8/6 0:00（新系列 8/6〜8/8）
        '2026-08-06T15:00:00.000Z',
        '2026-08-07T15:00:00.000Z',
      ]);
    });

    it('分割点以降の通常オーバーライド・EXDATE・RDATE は新系列に付け替える', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=Asia/Tokyo:20260706T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE;TZID=Asia/Tokyo:20260713T100000,20260810T100000',
          'RDATE;TZID=Asia/Tokyo:20260717T100000,20260814T100000',
          'SUMMARY:週次',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo:20260803T100000',
          'DTSTART;TZID=Asia/Tokyo:20260803T150000',
          'DTEND;TZID=Asia/Tokyo:20260803T160000',
          'SUMMARY:個別変更',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T100000',
          'DTEND;TZID=Asia/Tokyo:20260727T110000',
          'SUMMARY:名称変更後',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(3);
      const oldMaster = events.find((event) => event.id === 'm1');
      const override = events.find((event) => event.id === 'm1@20260803T100000');
      const newSeries = events.find((event) => event.id === 'm1@20260727T100000');
      // 分割点より前の EXDATE / RDATE は旧系列に残る
      expect(oldMaster?.exdates).toEqual(['2026-07-13T10:00:00']);
      expect(oldMaster?.rdates).toEqual(['2026-07-17T10:00:00']);
      // 分割点以降の EXDATE / RDATE は新系列へ移る
      expect(newSeries?.exdates).toEqual(['2026-08-10T10:00:00']);
      expect(newSeries?.rdates).toEqual(['2026-08-14T10:00:00']);
      // 分割点以降の通常オーバーライドは新系列を参照するようになる
      expect(override?.recurringEventId).toBe('m1@20260727T100000');
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
          end: new Date('2026-08-15T15:00:00Z'), // 東京 8/16 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(
        occurrences.map((o) => ({ title: o.event.title, start: o.start.toISOString() })),
      ).toEqual([
        { title: '週次', start: '2026-07-06T01:00:00.000Z' },
        { title: '週次', start: '2026-07-17T01:00:00.000Z' }, // RDATE（7/13 は EXDATE）
        { title: '週次', start: '2026-07-20T01:00:00.000Z' },
        { title: '名称変更後', start: '2026-07-27T01:00:00.000Z' },
        { title: '個別変更', start: '2026-08-03T06:00:00.000Z' }, // 東京 15:00（オーバーライド）
        { title: '名称変更後', start: '2026-08-14T01:00:00.000Z' }, // RDATE（8/10 は EXDATE）
      ]);
    });

    it('RDATE のみのシリーズは分割点以降の RDATE を新系列へ引き継いで分割する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m2',
          'DTSTART;TZID=Asia/Tokyo:20260701T100000',
          'DTEND;TZID=Asia/Tokyo:20260701T110000',
          'RDATE;TZID=Asia/Tokyo:20260708T100000,20260715T100000',
          'SUMMARY:不定期会',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m2',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260708T100000',
          'DTSTART;TZID=Asia/Tokyo:20260708T130000',
          'DTEND;TZID=Asia/Tokyo:20260708T140000',
          'SUMMARY:不定期会（午後）',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      // 旧系列は分割点より前の値だけを持つ（この例では start のみが残る）
      expect(events[0]?.rdates).toBeUndefined();
      // 新系列: 分割点自身は start が表し、以降の RDATE を引き継ぐ
      expect(events[1]).toEqual({
        id: 'm2@20260708T100000',
        title: '不定期会（午後）',
        start: '2026-07-08T13:00:00',
        end: '2026-07-08T14:00:00',
        timeZone: TOKYO,
        rdates: ['2026-07-15T10:00:00'],
      });
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
          end: new Date('2026-07-19T15:00:00Z'), // 東京 7/20 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(
        occurrences.map((o) => ({ title: o.event.title, start: o.start.toISOString() })),
      ).toEqual([
        { title: '不定期会', start: '2026-07-01T01:00:00.000Z' },
        { title: '不定期会（午後）', start: '2026-07-08T04:00:00.000Z' }, // 東京 13:00
        { title: '不定期会（午後）', start: '2026-07-15T01:00:00.000Z' },
      ]);
    });

    it('同じ UID に複数の分割がある場合は分割点の昇順に連鎖適用する（出現順に依存しない）', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=Asia/Tokyo:20260706T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'SUMMARY:週次',
          'END:VEVENT',
          // 分割点の遅い方を先に書き、出現順ではなく分割点昇順で適用されることを確かめる
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260803T110000',
          'DTSTART;TZID=Asia/Tokyo:20260803T140000',
          'DTEND;TZID=Asia/Tokyo:20260803T150000',
          'SUMMARY:週次（14 時に変更）',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260720T100000',
          'DTSTART;TZID=Asia/Tokyo:20260720T110000',
          'DTEND;TZID=Asia/Tokyo:20260720T120000',
          'SUMMARY:週次（11 時に変更）',
          'END:VEVENT',
        ),
      );
      // 1 回目の分割で生まれた新系列が 2 回目の分割のマスターになる
      expect(events.map((event) => event.id)).toEqual([
        'm1',
        'm1@20260720T100000',
        'm1@20260803T110000',
      ]);
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
          end: new Date('2026-08-10T15:00:00Z'), // 東京 8/11 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(
        occurrences.map((o) => ({ title: o.event.title, start: o.start.toISOString() })),
      ).toEqual([
        { title: '週次', start: '2026-07-06T01:00:00.000Z' }, // 東京 10:00
        { title: '週次', start: '2026-07-13T01:00:00.000Z' },
        { title: '週次（11 時に変更）', start: '2026-07-20T02:00:00.000Z' }, // 東京 11:00
        { title: '週次（11 時に変更）', start: '2026-07-27T02:00:00.000Z' },
        { title: '週次（14 時に変更）', start: '2026-08-03T05:00:00.000Z' }, // 東京 14:00
        { title: '週次（14 時に変更）', start: '2026-08-10T05:00:00.000Z' },
      ]);
    });

    it('マスターがオーバーライドより後に現れる ICS でも分割できる', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T130000',
          'DTEND;TZID=Asia/Tokyo:20260727T140000',
          'SUMMARY:週次（午後へ変更）',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'DTEND;TZID=Asia/Tokyo:20260706T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'SUMMARY:週次',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      const newSeries = events.find((event) => event.id === 'm1@20260727T100000');
      expect(newSeries?.recurringEventId).toBeUndefined();
      expect(newSeries?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
      expect(events.find((event) => event.id === 'm1')?.rrule).toContain('UNTIL=20260720T100000Z');
    });

    it('同じ UID の繰り返しマスターが ICS 内にない場合は単一オカレンスのオーバーライドとして取り込む', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T130000',
          'DTEND;TZID=Asia/Tokyo:20260727T140000',
          'SUMMARY:週次（午後へ変更）',
          'END:VEVENT',
        ),
      );
      expect(events).toEqual([
        {
          id: 'm1@20260727T100000',
          title: '週次（午後へ変更）',
          start: '2026-07-27T13:00:00',
          end: '2026-07-27T14:00:00',
          timeZone: TOKYO,
          recurringEventId: 'm1',
          originalStart: '2026-07-27T10:00:00',
        },
      ]);
    });

    it('同じ UID のマスターが繰り返しを持たない場合も単一オカレンスのオーバーライドとして取り込む', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'SUMMARY:単発',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T130000',
          'SUMMARY:変更後',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(2);
      expect(events[1]?.recurringEventId).toBe('m1');
      expect(events[1]?.originalStart).toBe('2026-07-27T10:00:00');
    });

    it('STATUS:CANCELLED と組み合わさった場合は「これ以降の削除」としてシリーズを打ち切る', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'DTSTART;TZID=Asia/Tokyo:20260801T090000',
          'DTEND;TZID=Asia/Tokyo:20260801T093000',
          'RRULE:FREQ=DAILY;COUNT=10',
          'SUMMARY:朝会',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260806T090000',
          'DTSTART;TZID=Asia/Tokyo:20260806T090000',
          'STATUS:CANCELLED',
          'SUMMARY:朝会',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.rrule).toBe('FREQ=DAILY;UNTIL=20260805T090000Z');
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-07-31T15:00:00Z'), // 東京 8/1 0:00
          end: new Date('2026-08-14T15:00:00Z'), // 東京 8/15 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      expect(toISO(occurrences.map((o) => o.start))).toEqual([
        '2026-08-01T00:00:00.000Z',
        '2026-08-02T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z',
        '2026-08-04T00:00:00.000Z',
        '2026-08-05T00:00:00.000Z',
      ]);
    });
  });

  describe('非対応構文の扱い', () => {
    it('VTIMEZONE 定義は無視し、TZID は IANA タイムゾーン ID として解釈する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VCALENDAR',
          'BEGIN:VTIMEZONE',
          'TZID:Asia/Tokyo',
          'BEGIN:STANDARD',
          'TZOFFSETFROM:+0900',
          'TZOFFSETTO:+0900',
          'TZNAME:JST',
          'DTSTART:19700101T000000',
          'END:STANDARD',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART;TZID=Asia/Tokyo:20260706T100000',
          'SUMMARY:A',
          'END:VEVENT',
          'END:VCALENDAR',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.timeZone).toBe(TOKYO);
    });

    it('VEVENT 内の VALARM のプロパティはイベントに混入しない', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'SUMMARY:本体',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT10M',
          'SUMMARY:アラーム側',
          'END:VALARM',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.title).toBe('本体');
    });

    it('EXRULE・DURATION・X- プロパティは無視する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'EXRULE:FREQ=WEEKLY',
          'DURATION:PT30M',
          'X-CUSTOM-PROP:value',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.end).toBeUndefined();
      expect(events[0]?.exdates).toBeUndefined();
    });

    it('VALUE=PERIOD の RDATE は無視する', () => {
      const events = eventsFromIcs(
        icsText(
          'BEGIN:VEVENT',
          'UID:e1',
          'DTSTART:20260701T010000Z',
          'RDATE;VALUE=PERIOD:20260702T010000Z/20260702T020000Z',
          'SUMMARY:A',
          'END:VEVENT',
        ),
      );
      expect(events[0]?.rdates).toBeUndefined();
    });
  });

  describe('エラー', () => {
    it('DTSTART のない VEVENT には Error を投げる', () => {
      expect(() =>
        eventsFromIcs(icsText('BEGIN:VEVENT', 'UID:e1', 'SUMMARY:A', 'END:VEVENT')),
      ).toThrow(/DTSTART/);
    });

    it('IANA として無効な TZID には Error を投げる', () => {
      expect(() =>
        eventsFromIcs(
          icsText(
            'BEGIN:VEVENT',
            'UID:e1',
            'DTSTART;TZID=Invalid/Zone:20260701T100000',
            'SUMMARY:A',
            'END:VEVENT',
          ),
        ),
      ).toThrow(/タイムゾーン/);
    });

    it('日時として解釈できない値には Error を投げる', () => {
      expect(() =>
        eventsFromIcs(icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:garbage', 'END:VEVENT')),
      ).toThrow(Error);
      expect(() =>
        eventsFromIcs(
          icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART;VALUE=DATE:20261301', 'END:VEVENT'),
        ),
      ).toThrow(Error);
      // 桁は揃っていても時刻の範囲外（25 時）は Error
      expect(() =>
        eventsFromIcs(icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T250000', 'END:VEVENT')),
      ).toThrow(Error);
    });

    it('プロパティ名のない行には Error を投げる', () => {
      expect(() => eventsFromIcs(icsText('BEGIN:VEVENT', ':値だけの行', 'END:VEVENT'))).toThrow(
        Error,
      );
    });

    it("':' のない行には Error を投げる", () => {
      expect(() => eventsFromIcs(icsText('BEGIN:VEVENT', 'UID e1', 'END:VEVENT'))).toThrow(Error);
    });

    it('対応する BEGIN のない END・閉じられていない BEGIN には Error を投げる', () => {
      expect(() => eventsFromIcs(icsText('END:VEVENT'))).toThrow(Error);
      expect(() =>
        eventsFromIcs(icsText('BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260701T010000Z')),
      ).toThrow(Error);
    });

    it('不正な RRULE には Error を投げる', () => {
      expect(() =>
        eventsFromIcs(
          icsText(
            'BEGIN:VEVENT',
            'UID:e1',
            'DTSTART:20260701T010000Z',
            'RRULE:FOO=BAR',
            'END:VEVENT',
          ),
        ),
      ).toThrow(/RRULE/);
    });
  });

  describe('Google カレンダーがエクスポートする代表的な ics', () => {
    const googleIcs = icsText(
      'BEGIN:VCALENDAR',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:仕事',
      'X-WR-TIMEZONE:Asia/Tokyo',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Tokyo',
      'X-LIC-LOCATION:Asia/Tokyo',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:JST',
      'DTSTART:19700101T000000',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Asia/Tokyo:20260706T100000',
      'DTEND;TZID=Asia/Tokyo:20260706T110000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'EXDATE;TZID=Asia/Tokyo:20260720T100000',
      'DTSTAMP:20260701T000000Z',
      'UID:abc123@google.com',
      'CREATED:20260601T000000Z',
      'DESCRIPTION:週次定例\\nアジェンダは Notion 参照',
      'LAST-MODIFIED:20260601T000000Z',
      'LOCATION:会議室A',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'SUMMARY:週次ミーティング',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Asia/Tokyo:20260713T150000',
      'DTEND;TZID=Asia/Tokyo:20260713T160000',
      'DTSTAMP:20260701T000000Z',
      'UID:abc123@google.com',
      'RECURRENCE-ID;TZID=Asia/Tokyo:20260713T100000',
      'SUMMARY:週次ミーティング（時間変更）',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260801',
      'DTEND;VALUE=DATE:20260803',
      'DTSTAMP:20260701T000000Z',
      'UID:def456@google.com',
      'SUMMARY:夏休み',
      'END:VEVENT',
      'END:VCALENDAR',
    );

    it('繰り返しマスター・オーバーライド・終日イベントを取り込める', () => {
      const events = eventsFromIcs(googleIcs);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        id: 'abc123@google.com',
        title: '週次ミーティング',
        start: '2026-07-06T10:00:00',
        end: '2026-07-06T11:00:00',
        timeZone: TOKYO,
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        exdates: ['2026-07-20T10:00:00'],
        location: '会議室A',
        description: '週次定例\nアジェンダは Notion 参照',
      });
      expect(events[1]).toEqual({
        id: 'abc123@google.com@20260713T100000',
        title: '週次ミーティング（時間変更）',
        start: '2026-07-13T15:00:00',
        end: '2026-07-13T16:00:00',
        timeZone: TOKYO,
        recurringEventId: 'abc123@google.com',
        originalStart: '2026-07-13T10:00:00',
      });
      expect(events[2]).toEqual({
        id: 'def456@google.com',
        title: '夏休み',
        start: '2026-08-01',
        end: '2026-08-03',
        allDay: true,
      });
    });

    it('取り込んだイベントを展開すると EXDATE・オーバーライドが反映される', () => {
      const events = eventsFromIcs(googleIcs);
      const occurrences = expandEvents({
        events,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
          end: new Date('2026-08-03T15:00:00Z'), // 東京 8/4 0:00
        },
        displayTimeZone: TOKYO,
        defaultEventMinutes: 60,
      });
      // 週次（月曜 10:00）: 7/6・7/13・7/20・7/27・8/3 のうち 7/20 は EXDATE で除外、
      // 7/13 は 15:00 へのオーバーライドで置換。終日の夏休みは東京 8/1 0:00 開始
      expect(toISO(occurrences.map((o) => o.start))).toEqual([
        '2026-07-06T01:00:00.000Z', // 東京 7/6 10:00
        '2026-07-13T06:00:00.000Z', // 東京 7/13 15:00（オーバーライド）
        '2026-07-27T01:00:00.000Z', // 東京 7/27 10:00
        '2026-07-31T15:00:00.000Z', // 東京 8/1 0:00（終日）
        '2026-08-03T01:00:00.000Z', // 東京 8/3 10:00
      ]);
    });
  });
});

describe('eventsFromIcsWithIssues', () => {
  describe('正常・不正が混在する ICS', () => {
    it('不正な VEVENT を issue にして残りを取り込む', () => {
      const ics = icsText(
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:valid1',
        'DTSTART:20260701T010000Z',
        'SUMMARY:正常1',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:bad1',
        'SUMMARY:壊れたイベント',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:valid2',
        'DTSTART:20260702T010000Z',
        'SUMMARY:正常2',
        'END:VEVENT',
        'END:VCALENDAR',
      );
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(events.map((event) => event.id)).toEqual(['valid1', 'valid2']);
      expect(issues).toEqual([
        {
          index: 1,
          uid: 'bad1',
          summary: '壊れたイベント',
          message: expect.stringMatching(/DTSTART/),
        },
      ]);
    });

    it('UID・SUMMARY のない不正な VEVENT は issue の該当項目が null になる', () => {
      const ics = icsText('BEGIN:VEVENT', 'LOCATION:どこか', 'END:VEVENT');
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(events).toEqual([]);
      expect(issues).toEqual([
        { index: 0, uid: null, summary: null, message: expect.stringMatching(/DTSTART/) },
      ]);
    });
  });

  describe('全件が不正な ICS', () => {
    it('すべての VEVENT が issue になり events は空になる', () => {
      const ics = icsText(
        'BEGIN:VEVENT',
        'UID:bad1',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:bad2',
        'END:VEVENT',
      );
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(events).toEqual([]);
      expect(issues.map((issue) => ({ index: issue.index, uid: issue.uid }))).toEqual([
        { index: 0, uid: 'bad1' },
        { index: 1, uid: 'bad2' },
      ]);
    });
  });

  describe('正常な ICS のみの場合', () => {
    it('issues が空になり、events は eventsFromIcs と同じ結果になる', () => {
      const ics = icsText(
        'BEGIN:VEVENT',
        'UID:weekly',
        'DTSTART;TZID=Asia/Tokyo:20260706T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'SUMMARY:週次ミーティング',
        'END:VEVENT',
      );
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(issues).toEqual([]);
      expect(events).toEqual(eventsFromIcs(ics));
    });
  });

  describe('eventsFromIcs との整合性', () => {
    it('eventsFromIcs は従来どおり最初の不正な VEVENT で Error を投げる（メッセージも不変）', () => {
      const ics = icsText('BEGIN:VEVENT', 'UID:bad1', 'SUMMARY:壊れたイベント', 'END:VEVENT');
      const thrownMessage = captureErrorMessage(() => eventsFromIcs(ics));
      expect(thrownMessage).toMatch(/DTSTART/);
      const { issues } = eventsFromIcsWithIssues(ics);
      expect(issues[0]?.message).toBe(thrownMessage);
    });

    it('BEGIN/END の対応が取れない構造は従来どおり両 API とも Error を投げる', () => {
      const ics = icsText('END:VEVENT');
      expect(() => eventsFromIcs(ics)).toThrow(Error);
      expect(() => eventsFromIcsWithIssues(ics)).toThrow(Error);
    });
  });

  describe('RECURRENCE-ID;RANGE=THISANDFUTURE のシリーズ分割', () => {
    it('eventsFromIcs と同じ分割結果になる', () => {
      const ics = icsText(
        'BEGIN:VEVENT',
        'UID:m1',
        'DTSTART;TZID=Asia/Tokyo:20260706T100000',
        'DTEND;TZID=Asia/Tokyo:20260706T110000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'SUMMARY:週次',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:m1',
        'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
        'DTSTART;TZID=Asia/Tokyo:20260727T130000',
        'DTEND;TZID=Asia/Tokyo:20260727T140000',
        'SUMMARY:週次（午後へ変更）',
        'END:VEVENT',
      );
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(issues).toEqual([]);
      expect(events).toEqual(eventsFromIcs(ics));
    });

    it('マスターが不正で issue に回った場合は単一オカレンスのオーバーライドとして取り込む', () => {
      const { events, issues } = eventsFromIcsWithIssues(
        icsText(
          'BEGIN:VEVENT',
          'UID:m1',
          'SUMMARY:壊れたマスター',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:m1',
          'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
          'DTSTART;TZID=Asia/Tokyo:20260727T130000',
          'SUMMARY:変更後',
          'END:VEVENT',
        ),
      );
      expect(issues).toEqual([
        {
          index: 0,
          uid: 'm1',
          summary: '壊れたマスター',
          message: expect.stringMatching(/DTSTART/),
        },
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe('m1@20260727T100000');
      expect(events[0]?.recurringEventId).toBe('m1');
      expect(events[0]?.originalStart).toBe('2026-07-27T10:00:00');
    });
  });

  describe('STATUS:CANCELLED のオーバーライドとの組み合わせ', () => {
    it('マスターが不正で取り込めない場合、対応する CANCELLED オーバーライドは無視される', () => {
      const ics = icsText(
        'BEGIN:VEVENT',
        'UID:weekly',
        'SUMMARY:壊れたマスター',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly',
        'RECURRENCE-ID:20260713T100000Z',
        'DTSTART:20260713T100000Z',
        'STATUS:CANCELLED',
        'END:VEVENT',
      );
      const { events, issues } = eventsFromIcsWithIssues(ics);
      expect(events).toEqual([]);
      expect(issues).toEqual([
        {
          index: 0,
          uid: 'weekly',
          summary: '壊れたマスター',
          message: expect.stringMatching(/DTSTART/),
        },
      ]);
    });
  });
});

describe('往復変換（round-trip）', () => {
  const source: readonly CalendarEvent[] = [
    {
      id: 'm1',
      title: '週次',
      start: '2026-07-06T10:00:00',
      end: '2026-07-06T11:00:00',
      timeZone: TOKYO,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-07-20T10:00:00'],
      rdates: ['2026-07-23T10:00:00'],
    },
    {
      id: 'ov1',
      title: '週次（時間変更）',
      start: '2026-07-13T15:00:00',
      end: '2026-07-13T16:00:00',
      timeZone: TOKYO,
      recurringEventId: 'm1',
      originalStart: '2026-07-13T10:00:00',
    },
    { id: 'ad1', title: '休暇', start: '2026-08-01', end: '2026-08-03', allDay: true },
    {
      id: 'utc1',
      title: '絶対時刻の予定',
      start: new Date('2026-07-02T03:00:00Z'),
      end: new Date('2026-07-02T04:00:00Z'),
    },
  ];

  it('エクスポート → インポートでフィールドの意味が保たれる', () => {
    const round = eventsFromIcs(eventsToIcs(source, { dtstamp: STAMP, timeZone: TOKYO }));
    expect(round).toHaveLength(4);
    expect(round[0]).toEqual({
      id: 'm1',
      title: '週次',
      start: '2026-07-06T10:00:00',
      end: '2026-07-06T11:00:00',
      timeZone: TOKYO,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-07-20T10:00:00'],
      rdates: ['2026-07-23T10:00:00'],
    });
    // オーバーライドの ID は「マスター ID@RECURRENCE-ID 値」に置き換わる（UID はマスターと共有のため）
    expect(round[1]).toEqual({
      id: 'm1@20260713T100000',
      title: '週次（時間変更）',
      start: '2026-07-13T15:00:00',
      end: '2026-07-13T16:00:00',
      timeZone: TOKYO,
      recurringEventId: 'm1',
      originalStart: '2026-07-13T10:00:00',
    });
    expect(round[2]).toEqual({
      id: 'ad1',
      title: '休暇',
      start: '2026-08-01',
      end: '2026-08-03',
      allDay: true,
    });
    expect(round[3]).toEqual({
      id: 'utc1',
      title: '絶対時刻の予定',
      start: '2026-07-02T03:00:00Z',
      end: '2026-07-02T04:00:00Z',
    });
  });

  it('往復後もオカレンス展開の結果（絶対時刻）が一致する', () => {
    const round = eventsFromIcs(eventsToIcs(source, { dtstamp: STAMP, timeZone: TOKYO }));
    const range = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
      end: new Date('2026-08-09T15:00:00Z'), // 東京 8/10 0:00
    };
    const summarize = (events: readonly CalendarEvent[]) =>
      expandEvents({ events, range, displayTimeZone: TOKYO, defaultEventMinutes: 60 }).map((o) => ({
        title: o.event.title,
        start: o.start.toISOString(),
        end: o.end.toISOString(),
        allDay: o.allDay,
      }));
    expect(summarize(round)).toEqual(summarize(source));
  });

  it('インポート → エクスポート → インポートで結果が安定する（不動点）', () => {
    const first = eventsFromIcs(eventsToIcs(source, { dtstamp: STAMP, timeZone: TOKYO }));
    const second = eventsFromIcs(eventsToIcs(first, { dtstamp: STAMP, timeZone: TOKYO }));
    expect(second).toEqual(first);
  });

  it('DST を跨ぐ繰り返しの往復後も現地時刻が維持される', () => {
    // NY の毎週月曜 9:00。DST 開始（2026-03-08）を跨ぐと絶対時刻は 14:00Z → 13:00Z に変わる
    const nyWeekly: CalendarEvent[] = [
      {
        id: 'ny1',
        title: 'NY 週次',
        start: new Date('2026-03-02T14:00:00Z'), // NY 3/2 09:00 EST
        end: new Date('2026-03-02T15:00:00Z'),
        timeZone: NY,
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      },
    ];
    const round = eventsFromIcs(eventsToIcs(nyWeekly, { dtstamp: STAMP, timeZone: TOKYO }));
    expect(round[0]?.start).toBe('2026-03-02T09:00:00');
    expect(round[0]?.timeZone).toBe(NY);
    const occurrences = expandEvents({
      events: round,
      range: { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-17T00:00:00Z') },
      displayTimeZone: NY,
      defaultEventMinutes: 60,
    });
    expect(toISO(occurrences.map((o) => o.start))).toEqual([
      '2026-03-02T14:00:00.000Z', // EST（UTC-5）
      '2026-03-09T13:00:00.000Z', // EDT（UTC-4、DST 開始後）
      '2026-03-16T13:00:00.000Z',
    ]);
  });

  it('timeZone のないイベントの UNTIL が往復で安定する（フローティング / UTC 形式）', () => {
    const noTzSource: readonly CalendarEvent[] = [
      {
        id: 'f1',
        title: 'フローティング',
        start: '2026-07-01T10:00:00',
        rrule: 'FREQ=DAILY;UNTIL=20260705T100000',
      },
      {
        id: 'u1',
        title: '絶対時刻',
        start: new Date('2026-07-01T01:00:00Z'),
        rrule: 'FREQ=DAILY;UNTIL=20260705T010000Z',
      },
    ];
    // 実行環境のローカル TZ（テストプロセスは Asia/Tokyo）を出力側の timeZone にも使い、
    // エクスポート（東京の現地時刻 → UTC）とインポート（UTC → 東京の現地時刻）を対にする
    const round = eventsFromIcs(eventsToIcs(noTzSource, { dtstamp: STAMP, timeZone: TOKYO }));
    expect(round[0]?.rrule).toBe('FREQ=DAILY;UNTIL=20260705T100000Z');
    expect(round[1]?.rrule).toBe('FREQ=DAILY;UNTIL=20260705T010000Z');
    const range = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
      end: new Date('2026-07-09T15:00:00Z'), // 東京 7/10 0:00
    };
    const summarize = (events: readonly CalendarEvent[]) =>
      expandEvents({ events, range, displayTimeZone: TOKYO, defaultEventMinutes: 60 }).map((o) => ({
        title: o.event.title,
        start: o.start.toISOString(),
      }));
    expect(summarize(round)).toEqual(summarize(noTzSource));
    // 再エクスポート → 再インポートでも安定する（不動点）
    expect(eventsFromIcs(eventsToIcs(round, { dtstamp: STAMP, timeZone: TOKYO }))).toEqual(round);
  });

  it('RANGE=THISANDFUTURE で分割した 2 系列は独立イベントとして書き出され、再インポートで安定する', () => {
    const first = eventsFromIcs(
      icsText(
        'BEGIN:VEVENT',
        'UID:m1',
        'DTSTART;TZID=Asia/Tokyo:20260801T090000',
        'DTEND;TZID=Asia/Tokyo:20260801T093000',
        'RRULE:FREQ=DAILY;COUNT=10',
        'SUMMARY:朝会',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:m1',
        'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260805T090000',
        'DTSTART;TZID=Asia/Tokyo:20260805T200000',
        'DTEND;TZID=Asia/Tokyo:20260805T203000',
        'SUMMARY:夜会',
        'END:VEVENT',
      ),
    );
    const exported = eventsToIcs(first, { dtstamp: STAMP, timeZone: TOKYO });
    // 分割後の 2 系列はそれぞれ独立した UID の VEVENT になる（RANGE=THISANDFUTURE は出力しない）
    expect(exported).toContain('UID:m1\r\n');
    expect(exported).toContain('UID:m1@20260805T090000\r\n');
    expect(exported).not.toContain('RANGE=THISANDFUTURE');
    expect(eventsFromIcs(exported)).toEqual(first);
  });

  it('RANGE=THISANDFUTURE の分割で付け替えたオーバーライド・EXDATE・RDATE も往復でオカレンス列が保たれる', () => {
    const first = eventsFromIcs(
      icsText(
        'BEGIN:VEVENT',
        'UID:m1',
        'DTSTART;TZID=Asia/Tokyo:20260706T100000',
        'DTEND;TZID=Asia/Tokyo:20260706T110000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'EXDATE;TZID=Asia/Tokyo:20260713T100000,20260810T100000',
        'RDATE;TZID=Asia/Tokyo:20260717T100000,20260814T100000',
        'SUMMARY:週次',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:m1',
        'RECURRENCE-ID;TZID=Asia/Tokyo:20260803T100000',
        'DTSTART;TZID=Asia/Tokyo:20260803T150000',
        'DTEND;TZID=Asia/Tokyo:20260803T160000',
        'SUMMARY:個別変更',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:m1',
        'RECURRENCE-ID;TZID=Asia/Tokyo;RANGE=THISANDFUTURE:20260727T100000',
        'DTSTART;TZID=Asia/Tokyo:20260727T100000',
        'DTEND;TZID=Asia/Tokyo:20260727T110000',
        'SUMMARY:名称変更後',
        'END:VEVENT',
      ),
    );
    const round = eventsFromIcs(eventsToIcs(first, { dtstamp: STAMP, timeZone: TOKYO }));
    const range = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
      end: new Date('2026-08-15T15:00:00Z'), // 東京 8/16 0:00
    };
    const summarize = (events: readonly CalendarEvent[]) =>
      expandEvents({ events, range, displayTimeZone: TOKYO, defaultEventMinutes: 60 }).map((o) => ({
        title: o.event.title,
        start: o.start.toISOString(),
        end: o.end.toISOString(),
      }));
    expect(summarize(round)).toEqual(summarize(first));
    // 再エクスポート → 再インポートでも安定する（不動点）
    expect(eventsFromIcs(eventsToIcs(round, { dtstamp: STAMP, timeZone: TOKYO }))).toEqual(round);
  });

  it('UNTIL の UTC 変換が往復で安定する（Google 形式の UNTIL の取り込み → 再出力）', () => {
    const ics = icsText(
      'BEGIN:VEVENT',
      'UID:e1',
      'DTSTART;TZID=Asia/Tokyo:20260706T100000',
      'DTEND;TZID=Asia/Tokyo:20260706T110000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260726T145959Z',
      'SUMMARY:A',
      'END:VEVENT',
    );
    const first = eventsFromIcs(ics);
    const exported = eventsToIcs(first, { dtstamp: STAMP, timeZone: TOKYO });
    // 内部表現（東京 23:59:59）から UTC（14:59:59Z）へ戻して出力される
    expect(exported).toContain('UNTIL=20260726T145959Z');
    expect(eventsFromIcs(exported)).toEqual(first);
  });
});
