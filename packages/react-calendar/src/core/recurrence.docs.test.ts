/**
 * recurrence.docs.test.ts
 *
 * docs/recurrence.md（および docs/events.md の繰り返し関連節）の記述のみから
 * 導出した仕様由来テストである。実装ファイル（recurrence.ts / mutations.ts /
 * expansion.ts / calendar.ts）を参照して書いたものではない。既存の
 * *.test.ts(x) は「仕様がテスト済みかどうか」の照合のためにのみ読み、
 * その期待値をここに転用していない。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * 他 TZ の検証は 'America/New_York' / 'UTC' を明示して行う。
 */
import { describe, expect, it } from 'vitest';
import { createCalendar } from './calendar';
import { expandEvents } from './expansion';
import type { MutationContext } from './mutations';
import { updateEventIn } from './mutations';
import { expandRecurrence } from './recurrence';
import type { CalendarEvent, TimeZoneId } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const UTC = 'UTC';

/** Date の配列を ISO 文字列の配列に変換する（アサーションの可読性のため）。 */
function toISO(dates: readonly Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

/** 決定的な ID 採番を行うテスト用 MutationContext。 */
function makeContext(partial: Partial<MutationContext> = {}): MutationContext {
  let sequence = 0;
  return {
    displayTimeZone: TOKYO,
    defaultEventMinutes: 60,
    generateId: () => {
      sequence += 1;
      return `gen-${sequence}`;
    },
    ...partial,
  };
}

describe('RRULE 文字列の指定方法（docs/recurrence.md 「RRULE 文字列の指定方法」）', () => {
  it("'RRULE:' プレフィックス付き/なしのどちらでも同じオカレンスに展開される", () => {
    // 出典: docs/recurrence.md L9-13
    // 「本体のみ: 'FREQ=WEEKLY;BYDAY=MO,WE'」「'RRULE:' プレフィックス付き:
    //  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'」のいずれの形式でも CalendarEvent.rrule
    // に指定できる、という記述を expandEvents（展開の入口）で検証する。
    const range = {
      start: new Date('2026-06-30T15:00:00Z'),
      end: new Date('2026-07-10T15:00:00Z'),
    };
    const bare: CalendarEvent = {
      id: 'bare',
      title: '本体のみ',
      start: '2026-07-01T09:00:00',
      timeZone: TOKYO,
      rrule: 'FREQ=DAILY;COUNT=3',
    };
    const prefixed: CalendarEvent = {
      id: 'prefixed',
      title: 'プレフィックス付き',
      start: '2026-07-01T09:00:00',
      timeZone: TOKYO,
      rrule: 'RRULE:FREQ=DAILY;COUNT=3',
    };
    const bareStarts = expandEvents({
      events: [bare],
      range,
      displayTimeZone: TOKYO,
      defaultEventMinutes: 60,
    }).map((o) => o.start.toISOString());
    const prefixedStarts = expandEvents({
      events: [prefixed],
      range,
      displayTimeZone: TOKYO,
      defaultEventMinutes: 60,
    }).map((o) => o.start.toISOString());
    expect(prefixedStarts).toEqual(bareStarts);
    expect(bareStarts).toHaveLength(3);
  });
});

describe('DTSTART の自動補完（docs/recurrence.md 冒頭の @example）', () => {
  it('rrule に DTSTART を書かなくても CalendarEvent.start が起点として使われる', () => {
    // 出典: docs/recurrence.md L20-33
    // calendar.createEvent({ start: '2026-07-01T09:00:00', rrule: 'FREQ=DAILY;COUNT=3' })
    // → occurrences は 7/1・7/2・7/3 の 3 回（DTSTART = start の 2026-07-01T09:00 JST）
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({
      id: 'daily',
      title: '毎日',
      start: '2026-07-01T09:00:00',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const occurrences = calendar.getOccurrences({
      start: new Date('2026-07-01T00:00:00Z'),
      end: new Date('2026-07-10T00:00:00Z'),
    });
    expect(toISO(occurrences.map((o) => o.start))).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    ]);
  });
});

describe('不正な RRULE（docs/recurrence.md 「RRULE 文字列の指定方法」）', () => {
  it('createCalendar().createEvent に不正な RRULE を渡すと例外が投げられる', () => {
    // 出典: docs/recurrence.md L35-47
    // 「不正な RRULE（FREQ の欠落や不正な値など）を指定して createEvent を
    //  呼ぶと例外が投げられます」「Error: 不正な RRULE です: 'FOO=BAR'（...)」
    const calendar = createCalendar({ timeZone: TOKYO });
    expect(() =>
      calendar.createEvent({ title: '不正な例', start: '2026-07-01T09:00:00', rrule: 'FOO=BAR' }),
    ).toThrow(/不正な RRULE/);
  });
});

describe('対応する主なパターン例（docs/recurrence.md 「対応する主なパターン例」）', () => {
  it('FREQ=MONTHLY（BYMONTHDAY 省略）は同じ日を毎月返す', () => {
    // 出典: docs/recurrence.md L96-103
    // 「毎月（同じ日）。範囲を半年分に広げる」
    // => 7/1, 8/1, 9/1, 10/1, 11/1, 12/1
    const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00
    const result = expandRecurrence({
      rrule: 'FREQ=MONTHLY',
      dtstart,
      timeZone: TOKYO,
      range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
      '2026-12-01T00:00:00.000Z',
    ]);
  });

  it('FREQ=YEARLY は同じ日を毎年返す', () => {
    // 出典: docs/recurrence.md L105-112
    // 「毎年。範囲を 2 年半分に広げる」
    // => 2026-07-01, 2027-07-01, 2028-07-01
    const dtstart = new Date('2026-07-01T00:00:00Z');
    const result = expandRecurrence({
      rrule: 'FREQ=YEARLY',
      dtstart,
      timeZone: TOKYO,
      range: { start: dtstart, end: new Date('2029-01-01T00:00:00Z') },
    });
    expect(toISO(result)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2027-07-01T00:00:00.000Z',
      '2028-07-01T00:00:00.000Z',
    ]);
  });
});

describe("scope: 'this'（docs/recurrence.md 「scope: 'this' — この予定のみ」）", () => {
  it('override.start には patch した値がそのまま入り（型変換されない）、originalStart は本来の開始時刻になる', () => {
    // 出典: docs/recurrence.md L149-177（standup の例そのもの）
    // 「override.originalStart === 7/3 09:00 JST（置き換えた元のオカレンスの時刻）」
    // 「override.start === '2026-07-03T10:00:00'（patch した値がそのまま入る）」
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({
      id: 'standup',
      title: '朝会',
      start: '2026-07-01T09:00:00',
      end: '2026-07-01T09:15:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    calendar.updateEvent(
      'standup',
      { start: '2026-07-03T10:00:00', end: '2026-07-03T10:15:00' },
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
    );
    const events = calendar.getEvents();
    // マスター（変更なし）＋ 新しいオーバーライドの 2 件になる
    expect(events).toHaveLength(2);
    const override = events.find((e) => e.recurringEventId === 'standup');
    expect(override).toBeDefined();
    expect(override?.start).toBe('2026-07-03T10:00:00'); // patch の値がそのまま（文字列のまま）入る
    expect(override?.originalStart).toEqual(new Date('2026-07-03T00:00:00Z')); // 本来の 7/3 09:00 JST
  });
});

describe('参照先マスターが存在しないオーバーライドの防御的な単発扱い（docs/recurrence.md 「exdates / recurringEventId / originalStart」）', () => {
  it('updateEventIn で target を省略した更新は、単発イベントと同様に直接パッチを適用する', () => {
    // 出典: docs/recurrence.md L372-373
    // 「マスターイベントが見つからない「参照先のないオーバーライド」（setEvents の
    //  一部だけを渡した場合など）は、防御的に単発イベントとして扱われます。」
    // 同 L137「単発イベントでは target を省略します」と合わせ、参照先マスターの
    // 無いオーバーライドは target 省略時に単発イベントと同じ「直接 patch 適用」に
    // なるはずである。
    const orphan: CalendarEvent = {
      id: 'orphan-1',
      title: '参照先のないオーバーライド',
      start: new Date('2026-07-03T02:00:00Z'),
      end: new Date('2026-07-03T03:00:00Z'),
      recurringEventId: 'missing-master',
      originalStart: new Date('2026-07-03T00:00:00Z'),
    };
    const result = updateEventIn(
      [orphan],
      'orphan-1',
      { title: '変更後' },
      undefined,
      makeContext(),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('変更後');
  });
});

describe('オーバーライドの日時解釈の 3 段フォールバック（docs/recurrence.md 「exdates / recurringEventId / originalStart」）', () => {
  it('オーバーライド自身に明示的な timeZone があれば、マスターの timeZone より優先される', () => {
    // 出典: docs/recurrence.md L375-379
    // 「オーバーライドの start / originalStart をオフセットなしの文字列で渡す場合、
    //  解釈に用いるタイムゾーンは「オーバーライド自身の timeZone → マスターの
    //  timeZone → 表示タイムゾーン」の順にフォールバックします。」
    // マスターは America/New_York、オーバーライドは明示的に UTC を指定。
    // マスター TZ にフォールバックしてしまうと 4 時間ずれた誤った絶対時刻になる。
    const master: CalendarEvent = {
      id: 'master-tz',
      title: 'NY 定例',
      start: '2026-07-01T10:00:00',
      end: '2026-07-01T11:00:00',
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=5',
    };
    const override: CalendarEvent = {
      id: 'ov-tz',
      title: '移動済み',
      recurringEventId: 'master-tz',
      // 絶対時刻で指定し、TZ 解釈の曖昧さを排除する（NY 7/3 10:00 EDT = 14:00Z）
      originalStart: new Date('2026-07-03T14:00:00Z'),
      // オフセットなし文字列 + 明示的な timeZone: UTC
      // → UTC 20:00 として解釈されるべき（マスターの NY にフォールバックすると
      //   2026-07-04T00:00:00Z になってしまう）
      start: '2026-07-03T20:00:00',
      end: '2026-07-03T21:00:00',
      timeZone: UTC,
    };
    const result = expandEvents({
      events: [master, override],
      range: { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-10T00:00:00Z') },
      displayTimeZone: TOKYO,
      defaultEventMinutes: 60,
    });
    const overridden = result.find((o) => o.eventId === 'ov-tz');
    expect(overridden?.start).toEqual(new Date('2026-07-03T20:00:00Z'));
  });
});

describe('単発イベントへの target 明示指定は無視される（docs/recurrence.md 「繰り返しの編集・削除とスコープ」）', () => {
  // 出典: docs/recurrence.md「繰り返しの編集・削除とスコープ」節（本追記分）:
  // 「単発イベント（rrule も recurringEventId も持たないイベント）に対して target を
  //  明示的に渡しても無視され、updateEvent は patch をそのまま適用し、deleteEvent は
  //  target の内容にかかわらずイベントを取り除きます。」
  it('単発イベントの updateEvent に target を明示的に渡しても、無視されて patch がそのまま適用される', () => {
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({ id: 'single', title: '単発予定', start: '2026-07-01T09:00:00' });
    calendar.updateEvent(
      'single',
      { title: '更新後' },
      { occurrenceStart: new Date('2026-07-05T00:00:00Z'), scope: 'this' },
    );
    expect(calendar.getEvents()).toHaveLength(1);
    expect(calendar.getEvents()[0]?.title).toBe('更新後');
  });

  it('単発イベントの deleteEvent に target を明示的に渡しても、無視されてイベントが取り除かれる', () => {
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({ id: 'single', title: '単発予定', start: '2026-07-01T09:00:00' });
    calendar.deleteEvent('single', {
      occurrenceStart: new Date('2026-07-05T00:00:00Z'),
      scope: 'all',
    });
    expect(calendar.getEvents()).toHaveLength(0);
  });
});

describe('occurrenceStart が実在するオカレンスと一致しない場合（docs/recurrence.md 「繰り返しの編集・削除とスコープ」）', () => {
  // 出典: docs/recurrence.md「繰り返しの編集・削除とスコープ」節（本追記分）:
  // 「occurrenceStart に、実在するオカレンスの本来の開始時刻と一致しない値
  //  （範囲外の値や、既にオーバーライドされたオカレンスの移動後の現在の開始時刻を
  //  誤って渡した場合など）を指定した場合、「一致するオーバーライドが無い」ものとして
  //  扱われます。updateEvent の scope: 'this' は渡した occurrenceStart を originalStart
  //  とする新しいオーバーライドイベントが作成されます（既存のオーバーライドや繰り返し
  //  本体は変更されません）。」
  it('既にオーバーライド済みのオカレンスの『移動後の現在の開始時刻』を occurrenceStart に渡すと、既存のオーバーライドは変更されず新しいオーバーライドが作られる', () => {
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({
      id: 'standup',
      title: '朝会',
      start: '2026-07-01T09:00:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    // 7/3 のオカレンスを 10:00 へ移動する（正しい occurrenceStart = 7/3 09:00 JST）
    calendar.updateEvent(
      'standup',
      { start: '2026-07-03T10:00:00', end: '2026-07-03T11:00:00' },
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
    );
    const beforeSecondUpdate = calendar.getEvents();
    expect(beforeSecondUpdate).toHaveLength(2); // マスター + 1 個目のオーバーライド

    // 誤って「移動後の現在の開始時刻」（7/3 10:00 JST）を occurrenceStart に渡す
    calendar.updateEvent(
      'standup',
      { title: '別の変更' },
      { occurrenceStart: new Date('2026-07-03T01:00:00Z'), scope: 'this' }, // 7/3 10:00 JST
    );
    const events = calendar.getEvents();
    // 一致するオーバーライドが無いものとして扱われ、新しいオーバーライドが追加される
    expect(events).toHaveLength(3);
    const firstOverride = events.find(
      (e) =>
        e.recurringEventId === 'standup' &&
        e.originalStart instanceof Date &&
        e.originalStart.getTime() === new Date('2026-07-03T00:00:00Z').getTime(),
    );
    // 既存のオーバーライドは変更されない（title は元の patch のまま）
    expect(firstOverride?.title).toBe('朝会');
    const newOverride = events.find((e) => e.title === '別の変更');
    expect(newOverride?.recurringEventId).toBe('standup');
    expect(newOverride?.originalStart).toEqual(new Date('2026-07-03T01:00:00Z'));
  });

  // 出典: docs/recurrence.md「繰り返しの編集・削除とスコープ」節（本追記分）:
  // 「deleteEvent の scope: 'this' も同様に「一致するオーバーライドが無い」ものとして
  //  扱われ、渡した occurrenceStart の値がそのままマスターの exdates に追加されます。」
  it('一致するオカレンスが無い occurrenceStart で deleteEvent(scope: this) を呼ぶと、その値がそのまま exdates に追加される', () => {
    const calendar = createCalendar({ timeZone: TOKYO });
    calendar.createEvent({
      id: 'standup',
      title: '朝会',
      start: '2026-07-01T09:00:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const bogusOccurrenceStart = new Date('2026-07-03T01:23:45Z'); // どのオカレンスの本来の開始時刻とも一致しない
    calendar.deleteEvent('standup', { occurrenceStart: bogusOccurrenceStart, scope: 'this' });

    const master = calendar.getEvents().find((e) => e.id === 'standup');
    expect(master?.exdates).toHaveLength(1);
    expect(master?.exdates?.[0]).toEqual(bogusOccurrenceStart);

    // 一致するオカレンスが元々無いため、5 回すべてがそのまま展開される（EXDATE は無害）
    const occurrences = calendar.getOccurrences({
      start: new Date('2026-07-01T00:00:00Z'),
      end: new Date('2026-07-10T00:00:00Z'),
    });
    expect(occurrences).toHaveLength(5);
  });
});

describe('RDATE のオカレンス長（docs/recurrence.md 「RDATE — パターン外のオカレンスを追加する」）', () => {
  it('マスターに end が無ければ rdate 由来のオカレンスも既定長（defaultEventMinutes）になる', () => {
    // 出典: docs/recurrence.md L389
    // 「オカレンスの長さはマスターのオカレンスと同じ（end - start、なければ既定長）」
    const displayTimeZone: TimeZoneId = TOKYO;
    const master: CalendarEvent = {
      id: 'no-end',
      title: '定例（end 省略）',
      start: '2026-07-01T09:00:00',
      timeZone: TOKYO,
      rdates: ['2026-07-03T09:00:00'],
    };
    const result = expandEvents({
      events: [master],
      range: { start: new Date('2026-06-30T15:00:00Z'), end: new Date('2026-07-10T15:00:00Z') },
      displayTimeZone,
      defaultEventMinutes: 45,
    });
    expect(result).toHaveLength(2);
    for (const occ of result) {
      expect(occ.end.getTime() - occ.start.getTime()).toBe(45 * 60 * 1000);
    }
  });
});
