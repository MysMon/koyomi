/**
 * list-view.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' / 'America/Havana' を
 * 引数で明示して行う。
 *
 * 2026 年のカレンダー事実:
 * - 2026-07-01 は水曜
 * - America/New_York の DST は 2026-03-08 に開始（EST -05:00 → EDT -04:00、切替は 2:00）
 * - America/Havana の DST は 2026-03-08 に開始するが、切替が深夜 0:00 に起きる
 *   （0:00 が存在せず 1:00 に繰り上げられる。EST -05:00 → EDT -04:00）
 */
import { describe, expect, it } from 'vitest';
import type { EventOccurrence, ListViewModel, TimeZoneId } from '../types';
import { buildListViewModel } from './list-view';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const HAVANA = 'America/Havana';

/**
 * テスト用のオカレンス（EventOccurrence）を組み立てるヘルパ。
 * `key` は `'<eventId>@<startISO>'` 形式にする。
 */
function makeOccurrence(params: {
  id: string;
  start: Date | string;
  end: Date | string;
  allDay?: boolean;
}): EventOccurrence {
  const start = params.start instanceof Date ? params.start : new Date(params.start);
  const end = params.end instanceof Date ? params.end : new Date(params.end);
  const allDay = params.allDay ?? false;
  return {
    key: `${params.id}@${start.toISOString()}`,
    eventId: params.id,
    event: { id: params.id, title: params.id, start, end, allDay },
    start,
    end,
    allDay,
    isRecurring: false,
    originalStart: start,
  };
}

/** 既定値（東京・30 日・now = currentDate）を補って buildListViewModel を呼ぶヘルパ。 */
function build(params: {
  currentDate: Date | string;
  occurrences: readonly EventOccurrence[];
  timeZone?: TimeZoneId;
  listDays?: number;
  now?: Date | string;
}): ListViewModel {
  const currentDate =
    params.currentDate instanceof Date ? params.currentDate : new Date(params.currentDate);
  const now =
    params.now === undefined
      ? currentDate
      : params.now instanceof Date
        ? params.now
        : new Date(params.now);
  return buildListViewModel({
    currentDate,
    timeZone: params.timeZone ?? TOKYO,
    occurrences: params.occurrences,
    listDays: params.listDays ?? 30,
    now,
  });
}

/** 日キーの一覧を取り出すヘルパ。 */
function dayKeys(model: ListViewModel): string[] {
  return model.days.map((day) => day.key);
}

describe('buildListViewModel', () => {
  describe('日のグループ化', () => {
    it('予定のある日のみが日付順に並ぶ', () => {
      // 入力順をシャッフルしても、出力は日付昇順になる
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'ev-10',
            start: '2026-07-10T09:00:00+09:00',
            end: '2026-07-10T10:00:00+09:00',
          }),
          makeOccurrence({
            id: 'ev-01',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T10:00:00+09:00',
          }),
          makeOccurrence({
            id: 'ev-03',
            start: '2026-07-03T09:00:00+09:00',
            end: '2026-07-03T10:00:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-01', '2026-07-03', '2026-07-10']);
      expect(model.isEmpty).toBe(false);
    });

    it('日の date はその日の 0:00 の絶対時刻、key は YYYY-MM-DD になる', () => {
      const model = build({
        currentDate: '2026-07-01T10:30:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'ev',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T10:00:00+09:00',
          }),
        ],
      });
      expect(model.days).toHaveLength(1);
      // 東京の 7/1 0:00 = 2026-06-30T15:00:00Z
      expect(model.days[0]?.date.toISOString()).toBe('2026-06-30T15:00:00.000Z');
      expect(model.days[0]?.key).toBe('2026-07-01');
    });

    it('オカレンスが 1 件もない場合は days が空で isEmpty が true になる', () => {
      const model = build({ currentDate: '2026-07-01T00:00:00+09:00', occurrences: [] });
      expect(model.type).toBe('list');
      expect(model.days).toEqual([]);
      expect(model.isEmpty).toBe(true);
    });

    it('範囲内にオカレンスが 1 件もない（すべて範囲外）場合も isEmpty が true になる', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        listDays: 7,
        occurrences: [
          makeOccurrence({
            id: 'outside',
            start: '2026-08-01T09:00:00+09:00',
            end: '2026-08-01T10:00:00+09:00',
          }),
        ],
      });
      expect(model.days).toEqual([]);
      expect(model.isEmpty).toBe(true);
    });

    it('listDays が 0 の場合は days が空で isEmpty が true になる', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        listDays: 0,
        occurrences: [
          makeOccurrence({
            id: 'ev',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T10:00:00+09:00',
          }),
        ],
      });
      expect(model.days).toEqual([]);
      expect(model.isEmpty).toBe(true);
    });
  });

  describe('複数日イベント', () => {
    it('複数日にまたがる時間指定のオカレンスは重なる各日に出現する', () => {
      const occurrence = makeOccurrence({
        id: 'span',
        start: '2026-07-01T22:00:00+09:00',
        end: '2026-07-03T00:00:00+09:00',
      });
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [occurrence],
      });
      expect(dayKeys(model)).toEqual(['2026-07-01', '2026-07-02']);
      for (const day of model.days) {
        expect(day.occurrences.map((o) => o.key)).toEqual(['span@2026-07-01T13:00:00.000Z']);
      }
    });

    it('終了が 0:00 ちょうどのオカレンスは終了日には出現しない（end 排他）', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'until-midnight',
            start: '2026-07-02T23:00:00+09:00',
            end: '2026-07-03T00:00:00+09:00',
          }),
        ],
      });
      // 7/3 0:00 ちょうどに終わるので 7/3 には出ない
      expect(dayKeys(model)).toEqual(['2026-07-02']);
    });

    it('終日の複数日イベントも重なる各日に出現し、排他的な終了日には出ない', () => {
      // 7/5〜7/6 の 2 日間（end は排他的に 7/7 0:00）
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'allday-span',
            start: '2026-07-05T00:00:00+09:00',
            end: '2026-07-07T00:00:00+09:00',
            allDay: true,
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-05', '2026-07-06']);
    });

    it('0:00 ちょうどに始まるオカレンスはその日に出現する', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'at-midnight',
            start: '2026-07-02T00:00:00+09:00',
            end: '2026-07-02T01:00:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-02']);
    });
  });

  describe('長さ 0 のオカレンス（リマインダー等）', () => {
    it('長さ 0 のオカレンスは start が属する日に表示される', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'reminder',
            start: '2026-07-02T09:00:00+09:00',
            end: '2026-07-02T09:00:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-02']);
      expect(model.days[0]?.occurrences.map((o) => o.eventId)).toEqual(['reminder']);
    });

    it('長さ 0 のオカレンスがちょうど日の 0:00 の場合はその日に表示され、前日には出現しない', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'at-midnight',
            start: '2026-07-02T00:00:00+09:00',
            end: '2026-07-02T00:00:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-02']);
    });
  });

  describe('日内の並び順', () => {
    it('終日イベントは、より早く始まる時間指定イベントよりも先に並ぶ', () => {
      // 時間指定は前日 23:00 から続いており、開始時刻は終日（7/1 0:00）より早い
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'timed-early',
            start: '2026-06-30T23:00:00+09:00',
            end: '2026-07-01T02:00:00+09:00',
          }),
          makeOccurrence({
            id: 'allday',
            start: '2026-07-01T00:00:00+09:00',
            end: '2026-07-02T00:00:00+09:00',
            allDay: true,
          }),
        ],
      });
      const day = model.days.find((d) => d.key === '2026-07-01');
      expect(day?.occurrences.map((o) => o.eventId)).toEqual(['allday', 'timed-early']);
    });

    it('時間指定イベントは開始時刻の昇順に並ぶ', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'later',
            start: '2026-07-01T10:00:00+09:00',
            end: '2026-07-01T11:00:00+09:00',
          }),
          makeOccurrence({
            id: 'earlier',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T09:30:00+09:00',
          }),
        ],
      });
      expect(model.days[0]?.occurrences.map((o) => o.eventId)).toEqual(['earlier', 'later']);
    });

    it('開始が同時刻の場合は長い方が先に並ぶ', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'short',
            start: '2026-07-01T10:00:00+09:00',
            end: '2026-07-01T11:00:00+09:00',
          }),
          makeOccurrence({
            id: 'long',
            start: '2026-07-01T10:00:00+09:00',
            end: '2026-07-01T12:00:00+09:00',
          }),
        ],
      });
      expect(model.days[0]?.occurrences.map((o) => o.eventId)).toEqual(['long', 'short']);
    });

    it('終日・開始・長さがすべて同じ場合は eventId の辞書順に並ぶ', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'b-event',
            start: '2026-07-01T10:00:00+09:00',
            end: '2026-07-01T11:00:00+09:00',
          }),
          makeOccurrence({
            id: 'a-event',
            start: '2026-07-01T10:00:00+09:00',
            end: '2026-07-01T11:00:00+09:00',
          }),
        ],
      });
      expect(model.days[0]?.occurrences.map((o) => o.eventId)).toEqual(['a-event', 'b-event']);
    });

    it('終日どうしは開始昇順 → 長い方が先に並ぶ', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'one-day',
            start: '2026-07-01T00:00:00+09:00',
            end: '2026-07-02T00:00:00+09:00',
            allDay: true,
          }),
          makeOccurrence({
            id: 'two-days',
            start: '2026-07-01T00:00:00+09:00',
            end: '2026-07-03T00:00:00+09:00',
            allDay: true,
          }),
          makeOccurrence({
            id: 'from-yesterday',
            start: '2026-06-30T00:00:00+09:00',
            end: '2026-07-02T00:00:00+09:00',
            allDay: true,
          }),
        ],
      });
      const day = model.days.find((d) => d.key === '2026-07-01');
      expect(day?.occurrences.map((o) => o.eventId)).toEqual([
        'from-yesterday',
        'two-days',
        'one-day',
      ]);
    });
  });

  describe('表示範囲の境界（listDays）', () => {
    it('範囲より前・範囲終了（排他）以降の予定は含まれない', () => {
      // 範囲: 7/1 0:00 〜 7/8 0:00（排他）
      const model = build({
        currentDate: '2026-07-01T10:30:00+09:00', // 日の途中でも 0:00 から範囲が始まる
        listDays: 7,
        occurrences: [
          makeOccurrence({
            id: 'before',
            start: '2026-06-30T10:00:00+09:00',
            end: '2026-06-30T11:00:00+09:00',
          }),
          makeOccurrence({
            id: 'at-range-end',
            start: '2026-07-08T00:00:00+09:00',
            end: '2026-07-08T01:00:00+09:00',
          }),
          makeOccurrence({
            id: 'last-night',
            start: '2026-07-07T23:30:00+09:00',
            end: '2026-07-07T23:45:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-07']);
      expect(model.days[0]?.occurrences.map((o) => o.eventId)).toEqual(['last-night']);
    });

    it('範囲開始 0:00 ちょうどに終わる予定は含まれない（end 排他）', () => {
      const model = build({
        currentDate: '2026-07-01T10:30:00+09:00',
        listDays: 7,
        occurrences: [
          makeOccurrence({
            id: 'ends-at-start',
            start: '2026-06-30T23:00:00+09:00',
            end: '2026-07-01T00:00:00+09:00',
          }),
        ],
      });
      expect(model.isEmpty).toBe(true);
    });

    it('範囲開始より前から続いて初日に食い込む予定は初日に含まれる', () => {
      const model = build({
        currentDate: '2026-07-01T10:30:00+09:00',
        listDays: 7,
        occurrences: [
          makeOccurrence({
            id: 'spans-in',
            start: '2026-06-30T23:00:00+09:00',
            end: '2026-07-01T01:00:00+09:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-07-01']);
    });
  });

  describe('isToday 判定', () => {
    it('now と同じ日（表示 TZ 基準）の日だけ isToday が true になる', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        now: '2026-07-03T08:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'ev-01',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T10:00:00+09:00',
          }),
          makeOccurrence({
            id: 'ev-03',
            start: '2026-07-03T09:00:00+09:00',
            end: '2026-07-03T10:00:00+09:00',
          }),
        ],
      });
      expect(model.days.map((day) => [day.key, day.isToday])).toEqual([
        ['2026-07-01', false],
        ['2026-07-03', true],
      ]);
    });

    it('now が表示範囲外の場合はすべての日で isToday が false になる', () => {
      const model = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        now: '2026-08-15T12:00:00+09:00',
        occurrences: [
          makeOccurrence({
            id: 'ev',
            start: '2026-07-01T09:00:00+09:00',
            end: '2026-07-01T10:00:00+09:00',
          }),
        ],
      });
      expect(model.days.every((day) => day.isToday === false)).toBe(true);
    });
  });

  describe('タイムゾーン', () => {
    it('同じオカレンスでも表示 TZ によって属する日付が変わる（America/New_York）', () => {
      // NY の 7/1 23:00（= 東京の 7/2 12:00）のオカレンス
      const occurrence = makeOccurrence({
        id: 'ny-evening',
        start: '2026-07-01T23:00:00-04:00',
        end: '2026-07-01T23:30:00-04:00',
      });
      const nyModel = build({
        currentDate: '2026-07-01T00:00:00-04:00',
        timeZone: NY,
        listDays: 7,
        occurrences: [occurrence],
      });
      const tokyoModel = build({
        currentDate: '2026-07-01T00:00:00+09:00',
        timeZone: TOKYO,
        listDays: 7,
        occurrences: [occurrence],
      });
      expect(dayKeys(nyModel)).toEqual(['2026-07-01']);
      expect(dayKeys(tokyoModel)).toEqual(['2026-07-02']);
      // date も表示 TZ の 0:00 の絶対時刻になる（NY 7/1 0:00 = 04:00Z）
      expect(nyModel.days[0]?.date.toISOString()).toBe('2026-07-01T04:00:00.000Z');
    });

    it('DST 開始日（America/New_York 2026-03-08）を跨いでも日が正しく列挙される', () => {
      const model = build({
        currentDate: '2026-03-07T12:00:00-05:00',
        timeZone: NY,
        listDays: 3,
        occurrences: [
          makeOccurrence({
            id: 'on-dst-day',
            start: '2026-03-08T09:00:00-04:00', // DST 切替後の 9:00 EDT
            end: '2026-03-08T10:00:00-04:00',
          }),
          makeOccurrence({
            id: 'after-dst',
            start: '2026-03-09T09:00:00-04:00',
            end: '2026-03-09T10:00:00-04:00',
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-03-08', '2026-03-09']);
      // 3/8 0:00 は EST（-05:00）、3/9 0:00 は EDT（-04:00）
      expect(model.days[0]?.date.toISOString()).toBe('2026-03-08T05:00:00.000Z');
      expect(model.days[1]?.date.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    });

    it('DST を跨ぐ複数日イベントは重なる各日に出現する', () => {
      const model = build({
        currentDate: '2026-03-07T12:00:00-05:00',
        timeZone: NY,
        listDays: 3,
        occurrences: [
          makeOccurrence({
            id: 'across-dst',
            start: '2026-03-07T22:00:00-05:00', // EST
            end: '2026-03-09T01:00:00-04:00', // EDT
          }),
        ],
      });
      expect(dayKeys(model)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    });

    it('深夜 0:00 に DST が切り替わるゾーン（America/Havana）では切替翌日の 0:00〜1:00 のオカレンスが翌日にのみ出現する', () => {
      // Havana は 2026-03-08 の 0:00 が存在せず 1:00 に繰り上げられる。
      // dayEnd の計算が現地時刻の維持のままだと 3/8 の終端が本来より 1 時間
      // 後ろにずれ、3/9 0:00〜1:00 のオカレンスが 3/8 にも重複出現してしまう
      const model = build({
        currentDate: '2026-03-07T12:00:00-05:00',
        timeZone: HAVANA,
        listDays: 3,
        occurrences: [
          makeOccurrence({
            id: 'after-switch-midnight',
            start: '2026-03-09T00:30:00-04:00',
            end: '2026-03-09T00:45:00-04:00',
          }),
        ],
      });
      // 3/9 にのみ出現し、3/8 には重複出現しない
      expect(dayKeys(model)).toEqual(['2026-03-09']);
    });

    it('深夜 0:00 に DST が切り替わるゾーンでも切替翌日の ListDay.date は現地 0:00 の絶対時刻になる', () => {
      const model = build({
        currentDate: '2026-03-07T12:00:00-05:00',
        timeZone: HAVANA,
        listDays: 3,
        occurrences: [
          makeOccurrence({
            id: 'ev',
            start: '2026-03-09T09:00:00-04:00',
            end: '2026-03-09T10:00:00-04:00',
          }),
        ],
      });
      const day = model.days.find((d) => d.key === '2026-03-09');
      // 3/9 0:00 は EDT（-04:00）: DST 切替翌日で通常どおり 0:00 が存在する
      expect(day?.date.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    });
  });
});
