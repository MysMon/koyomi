import { describe, expect, it } from 'vitest';
import { parseDateValue } from '../timezone';
import type {
  CalendarEvent,
  EventOccurrence,
  TimeGridDay,
  TimeGridViewModel,
  TimeZoneId,
} from '../types';
import { buildTimeGridViewModel } from './time-grid-view';

const TOKYO: TimeZoneId = 'Asia/Tokyo';
const NEW_YORK: TimeZoneId = 'America/New_York';
const UTC: TimeZoneId = 'UTC';

/**
 * オフセットなし ISO 文字列を、指定タイムゾーンの壁時計として絶対時刻にする。
 * テストの日時指定を TZ 明示で行うためのヘルパー。
 */
function at(isoLocal: string, timeZone: TimeZoneId): Date {
  return parseDateValue(isoLocal, timeZone, false);
}

/**
 * テスト用の発生（EventOccurrence）を構築する。
 * `key` は `<eventId>@<startISO>` 形式にする。
 */
function occurrence(params: {
  id: string;
  start: Date;
  end: Date;
  allDay?: boolean;
}): EventOccurrence {
  const { id, start, end, allDay = false } = params;
  const event: CalendarEvent = {
    id,
    title: `イベント ${id}`,
    start,
    end,
    allDay,
  };
  return {
    key: `${id}@${start.toISOString()}`,
    eventId: id,
    event,
    start,
    end,
    allDay,
    isRecurring: false,
    originalStart: start,
  };
}

/** 既定パラメータ（東京・2026-07-01 を含む週・日曜開始）でビューモデルを構築する。 */
function build(
  overrides: Partial<Parameters<typeof buildTimeGridViewModel>[0]> = {},
): TimeGridViewModel {
  return buildTimeGridViewModel({
    currentDate: at('2026-07-01T00:00', TOKYO),
    viewType: 'week',
    timeZone: TOKYO,
    occurrences: [],
    weekStartsOn: 0,
    slotMinutes: 60,
    now: at('2026-07-01T10:30', TOKYO),
    ...overrides,
  });
}

/** 指定キーの日を取り出す（存在しなければテスト失敗）。 */
function dayByKey(model: TimeGridViewModel, key: string): TimeGridDay {
  const day = model.days.find((d) => d.key === key);
  if (day === undefined) {
    throw new Error(`key=${key} の日が見つかりません`);
  }
  return day;
}

describe('buildTimeGridViewModel', () => {
  describe('days（表示する日）', () => {
    it('week では週開始日からの 7 日を key・weekday・isToday 付きで返す', () => {
      const model = build();
      expect(model.type).toBe('timeGrid');
      expect(model.viewType).toBe('week');
      expect(model.days.map((d) => d.key)).toEqual([
        '2026-06-28',
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
      ]);
      expect(model.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      // isToday は now（2026-07-01）の日のみ true
      expect(model.days.map((d) => d.isToday)).toEqual([
        false,
        false,
        false,
        true,
        false,
        false,
        false,
      ]);
      // date は表示 TZ における各日 0:00 の絶対時刻
      expect(model.days[0]?.date.getTime()).toBe(at('2026-06-28T00:00', TOKYO).getTime());
      expect(model.days[6]?.date.getTime()).toBe(at('2026-07-04T00:00', TOKYO).getTime());
    });

    it('weekStartsOn=1 なら月曜開始の 7 日になる', () => {
      const model = build({ weekStartsOn: 1 });
      expect(model.days.map((d) => d.key)).toEqual([
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
      ]);
      expect(model.days[0]?.weekday).toBe(1);
    });

    it('day では基準日の 1 日だけを返す', () => {
      const model = build({
        viewType: 'day',
        currentDate: at('2026-07-01T15:00', TOKYO),
      });
      expect(model.viewType).toBe('day');
      expect(model.days).toHaveLength(1);
      expect(model.days[0]?.key).toBe('2026-07-01');
      expect(model.days[0]?.weekday).toBe(3);
      expect(model.days[0]?.date.getTime()).toBe(at('2026-07-01T00:00', TOKYO).getTime());
    });
  });

  describe('時間グリッドへの配置', () => {
    it('10:00-11:00 の予定は該当日に startMinutes=600 / endMinutes=660 で入る', () => {
      const occ = occurrence({
        id: 'meeting',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-01T11:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      const day = dayByKey(model, '2026-07-01');
      expect(day.items).toHaveLength(1);
      expect(day.items[0]).toMatchObject({
        startMinutes: 600,
        endMinutes: 660,
        left: 0,
        width: 1,
        continuesBefore: false,
        continuesAfter: false,
      });
      expect(day.items[0]?.occurrence.key).toBe(occ.key);
      // 他の日と終日行には現れない
      for (const other of model.days) {
        if (other.key !== '2026-07-01') {
          expect(other.items).toHaveLength(0);
        }
      }
      expect(model.allDaySegments).toHaveLength(0);
      expect(model.allDayLaneCount).toBe(0);
    });

    it('重なる 2 件は幅 1/2 で横並びになる', () => {
      const a = occurrence({
        id: 'a',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-01T11:00', TOKYO),
      });
      const b = occurrence({
        id: 'b',
        start: at('2026-07-01T10:30', TOKYO),
        end: at('2026-07-01T11:30', TOKYO),
      });
      const model = build({ occurrences: [b, a] });
      const items = dayByKey(model, '2026-07-01').items;
      expect(items).toHaveLength(2);
      // startMinutes 昇順で並ぶ
      expect(items[0]?.occurrence.eventId).toBe('a');
      expect(items[1]?.occurrence.eventId).toBe('b');
      expect(items[0]).toMatchObject({ left: 0, width: 0.5 });
      expect(items[1]).toMatchObject({ left: 0.5, width: 0.5 });
    });

    it('items は startMinutes 昇順 → 長い方が先 → key 辞書順で並ぶ', () => {
      const z = occurrence({
        id: 'z',
        start: at('2026-07-01T09:00', TOKYO),
        end: at('2026-07-01T09:30', TOKYO),
      });
      const x = occurrence({
        id: 'x',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-01T12:00', TOKYO),
      });
      const y = occurrence({
        id: 'y',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-01T10:30', TOKYO),
      });
      const model = build({ occurrences: [y, z, x] });
      const items = dayByKey(model, '2026-07-01').items;
      expect(items.map((item) => item.occurrence.eventId)).toEqual(['z', 'x', 'y']);

      // 開始・長さがともに同じ場合は key 辞書順
      const b = occurrence({
        id: 'b',
        start: at('2026-07-01T14:00', TOKYO),
        end: at('2026-07-01T15:00', TOKYO),
      });
      const a = occurrence({
        id: 'a',
        start: at('2026-07-01T14:00', TOKYO),
        end: at('2026-07-01T15:00', TOKYO),
      });
      const tie = build({ occurrences: [b, a] });
      expect(dayByKey(tie, '2026-07-01').items.map((item) => item.occurrence.eventId)).toEqual([
        'a',
        'b',
      ]);
    });
  });

  describe('日跨ぎの時間指定イベント（22:00〜翌 2:00）', () => {
    it('両日に分割され、初日は 1440 にクランプされて continuesAfter が立つ', () => {
      const occ = occurrence({
        id: 'overnight',
        start: at('2026-07-01T22:00', TOKYO),
        end: at('2026-07-02T02:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });

      const firstDay = dayByKey(model, '2026-07-01');
      expect(firstDay.items).toHaveLength(1);
      expect(firstDay.items[0]).toMatchObject({
        startMinutes: 1320,
        endMinutes: 1440,
        continuesBefore: false,
        continuesAfter: true,
      });

      const secondDay = dayByKey(model, '2026-07-02');
      expect(secondDay.items).toHaveLength(1);
      expect(secondDay.items[0]).toMatchObject({
        startMinutes: 0,
        endMinutes: 120,
        continuesBefore: true,
        continuesAfter: false,
      });

      // 両日とも同じ発生を参照し、終日行には入らない
      expect(firstDay.items[0]?.occurrence.key).toBe(occ.key);
      expect(secondDay.items[0]?.occurrence.key).toBe(occ.key);
      expect(model.allDaySegments).toHaveLength(0);
    });

    it('終了がちょうど翌日 0:00 の予定は単日扱いで翌日には現れない（end 排他）', () => {
      const occ = occurrence({
        id: 'until-midnight',
        start: at('2026-07-01T23:00', TOKYO),
        end: at('2026-07-02T00:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      const firstDay = dayByKey(model, '2026-07-01');
      expect(firstDay.items).toHaveLength(1);
      expect(firstDay.items[0]).toMatchObject({
        startMinutes: 1380,
        endMinutes: 1440,
        continuesBefore: false,
        continuesAfter: false,
      });
      expect(dayByKey(model, '2026-07-02').items).toHaveLength(0);
      expect(model.allDaySegments).toHaveLength(0);
    });

    it('0:00 ちょうどに始まる予定はその日にのみ入る', () => {
      const occ = occurrence({
        id: 'from-midnight',
        start: at('2026-07-02T00:00', TOKYO),
        end: at('2026-07-02T01:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      expect(dayByKey(model, '2026-07-01').items).toHaveLength(0);
      const day = dayByKey(model, '2026-07-02');
      expect(day.items[0]).toMatchObject({ startMinutes: 0, endMinutes: 60 });
    });

    it('day ビューでは表示日に重なる部分だけが表示され continuesBefore が立つ', () => {
      const occ = occurrence({
        id: 'overnight',
        start: at('2026-07-01T22:00', TOKYO),
        end: at('2026-07-02T02:00', TOKYO),
      });
      const model = build({
        viewType: 'day',
        currentDate: at('2026-07-02T00:00', TOKYO),
        occurrences: [occ],
      });
      expect(model.days).toHaveLength(1);
      expect(model.days[0]?.items[0]).toMatchObject({
        startMinutes: 0,
        endMinutes: 120,
        continuesBefore: true,
        continuesAfter: false,
      });
    });
  });

  describe('終日行（allDaySegments）', () => {
    it('終日イベントが帯セグメントになり列位置とレーンが割り当たる', () => {
      // 7/1〜7/2 の 2 日間（end は排他で 7/3 0:00）
      const occ = occurrence({
        id: 'holiday',
        start: at('2026-07-01T00:00', TOKYO),
        end: at('2026-07-03T00:00', TOKYO),
        allDay: true,
      });
      const model = build({ occurrences: [occ] });
      expect(model.allDaySegments).toHaveLength(1);
      expect(model.allDaySegments[0]).toMatchObject({
        startCol: 3,
        span: 2,
        lane: 0,
        continuesBefore: false,
        continuesAfter: false,
        hidden: false,
      });
      expect(model.allDaySegments[0]?.occurrence.key).toBe(occ.key);
      expect(model.allDayLaneCount).toBe(1);
      // 時間グリッド側には現れない
      for (const day of model.days) {
        expect(day.items).toHaveLength(0);
      }
    });

    it('24 時間以上の複数日の時間指定イベントも終日行に入り、レーンを分け合う', () => {
      const holiday = occurrence({
        id: 'holiday',
        start: at('2026-07-01T00:00', TOKYO),
        end: at('2026-07-03T00:00', TOKYO),
        allDay: true,
      });
      // 7/1 10:00 〜 7/3 12:00 の 50 時間の時間指定イベント
      const trip = occurrence({
        id: 'trip',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-03T12:00', TOKYO),
      });
      const model = build({ occurrences: [trip, holiday] });
      expect(model.allDaySegments).toHaveLength(2);
      const tripSegment = model.allDaySegments.find((s) => s.occurrence.eventId === 'trip');
      const holidaySegment = model.allDaySegments.find((s) => s.occurrence.eventId === 'holiday');
      // holiday（0:00 開始）が先にレーン 0 を取り、重なる trip はレーン 1 になる
      expect(holidaySegment).toMatchObject({ startCol: 3, span: 2, lane: 0 });
      expect(tripSegment).toMatchObject({ startCol: 3, span: 3, lane: 1 });
      expect(model.allDayLaneCount).toBe(2);
      for (const day of model.days) {
        expect(day.items).toHaveLength(0);
      }
    });

    it('表示範囲をはみ出す終日イベントはクランプされ continuesBefore/After が立つ', () => {
      const occ = occurrence({
        id: 'long-vacation',
        start: at('2026-06-20T00:00', TOKYO),
        end: at('2026-07-20T00:00', TOKYO),
        allDay: true,
      });
      const model = build({ occurrences: [occ] });
      expect(model.allDaySegments[0]).toMatchObject({
        startCol: 0,
        span: 7,
        continuesBefore: true,
        continuesAfter: true,
      });
    });

    it('day ビューでは複数日イベントが 1 列にクランプされる', () => {
      const trip = occurrence({
        id: 'trip',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-03T12:00', TOKYO),
      });
      const model = build({
        viewType: 'day',
        currentDate: at('2026-07-02T00:00', TOKYO),
        occurrences: [trip],
      });
      expect(model.allDaySegments).toHaveLength(1);
      expect(model.allDaySegments[0]).toMatchObject({
        startCol: 0,
        span: 1,
        continuesBefore: true,
        continuesAfter: true,
      });
      expect(model.allDayLaneCount).toBe(1);
    });
  });

  describe('振り分けの境界', () => {
    it('長さ 0 の予定は単日扱いで時間グリッドに入る', () => {
      const occ = occurrence({
        id: 'reminder',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-01T10:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      const day = dayByKey(model, '2026-07-01');
      expect(day.items).toHaveLength(1);
      expect(day.items[0]).toMatchObject({
        startMinutes: 600,
        endMinutes: 600,
        left: 0,
        width: 1,
        continuesBefore: false,
        continuesAfter: false,
      });
      expect(model.allDaySegments).toHaveLength(0);
    });

    it('0:00 ちょうどの長さ 0 の予定はその日にのみ入る', () => {
      const occ = occurrence({
        id: 'reminder',
        start: at('2026-07-02T00:00', TOKYO),
        end: at('2026-07-02T00:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      expect(dayByKey(model, '2026-07-01').items).toHaveLength(0);
      const day = dayByKey(model, '2026-07-02');
      expect(day.items).toHaveLength(1);
      expect(day.items[0]).toMatchObject({ startMinutes: 0, endMinutes: 0 });
    });

    it('日跨ぎでちょうど 24 時間の時間指定イベントは終日行に入る', () => {
      const occ = occurrence({
        id: 'full-day',
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-02T10:00', TOKYO),
      });
      const model = build({ occurrences: [occ] });
      expect(model.allDaySegments).toHaveLength(1);
      expect(model.allDaySegments[0]).toMatchObject({ startCol: 3, span: 2 });
      for (const day of model.days) {
        expect(day.items).toHaveLength(0);
      }
    });

    it('振り分けは表示 TZ 基準で行われる（東京では日跨ぎ分割、UTC では単日）', () => {
      // 東京の 7/1 23:00〜7/2 1:00 = UTC の 7/1 14:00〜16:00
      const occ = occurrence({
        id: 'late-night',
        start: at('2026-07-01T23:00', TOKYO),
        end: at('2026-07-02T01:00', TOKYO),
      });

      const tokyoModel = build({ occurrences: [occ] });
      expect(dayByKey(tokyoModel, '2026-07-01').items[0]).toMatchObject({
        startMinutes: 1380,
        endMinutes: 1440,
        continuesAfter: true,
      });
      expect(dayByKey(tokyoModel, '2026-07-02').items[0]).toMatchObject({
        startMinutes: 0,
        endMinutes: 60,
        continuesBefore: true,
      });

      const utcModel = build({
        timeZone: UTC,
        currentDate: at('2026-07-01T00:00', UTC),
        now: at('2026-07-01T10:30', UTC),
        occurrences: [occ],
      });
      const utcDay = dayByKey(utcModel, '2026-07-01');
      expect(utcDay.items).toHaveLength(1);
      expect(utcDay.items[0]).toMatchObject({
        startMinutes: 840,
        endMinutes: 960,
        continuesBefore: false,
        continuesAfter: false,
      });
      expect(dayByKey(utcModel, '2026-07-02').items).toHaveLength(0);
    });
  });

  describe('slots（時間軸の目盛り）', () => {
    it('slotMinutes=60 で 0:00 から 23:00 まで 24 個生成される', () => {
      const model = build({ slotMinutes: 60 });
      expect(model.slots).toHaveLength(24);
      expect(model.slots[0]).toEqual({ minutes: 0, label: '00:00' });
      expect(model.slots[9]).toEqual({ minutes: 540, label: '09:00' });
      expect(model.slots[23]).toEqual({ minutes: 1380, label: '23:00' });
    });

    it('slotMinutes=30 で 48 個生成される', () => {
      const model = build({ slotMinutes: 30 });
      expect(model.slots).toHaveLength(48);
      expect(model.slots[1]).toEqual({ minutes: 30, label: '00:30' });
      expect(model.slots[47]).toEqual({ minutes: 1410, label: '23:30' });
    });
  });

  describe('nowIndicator（現在時刻線）', () => {
    it('now が表示範囲内なら該当日のキーと分を返す', () => {
      const model = build({ now: at('2026-07-01T10:30', TOKYO) });
      expect(model.nowIndicator).toEqual({ dayKey: '2026-07-01', minutes: 630 });
    });

    it('now が表示範囲外なら null になる', () => {
      const model = build({ now: at('2026-07-10T10:00', TOKYO) });
      expect(model.nowIndicator).toBeNull();
      expect(model.days.every((d) => !d.isToday)).toBe(true);
    });

    it('now の日判定は表示タイムゾーン基準で行われる', () => {
      // 2026-07-04T20:00Z は東京では 7/5 5:00（週の範囲外）、UTC では 7/4（範囲内）
      const instant = new Date('2026-07-04T20:00:00Z');
      const tokyoModel = build({ now: instant });
      expect(tokyoModel.nowIndicator).toBeNull();

      const utcModel = build({
        timeZone: UTC,
        currentDate: at('2026-07-01T00:00', UTC),
        now: instant,
      });
      expect(utcModel.nowIndicator).toEqual({ dayKey: '2026-07-04', minutes: 1200 });
    });
  });

  describe('DST（America/New_York 2026-03-08）', () => {
    it('DST 開始日の予定の分計算が壁時計基準で正しい', () => {
      // 2026-03-08 は 2:00 → 3:00 に進む日。1:00〜5:00 は絶対時間では 3 時間だが
      // 壁時計では 60 分〜300 分に配置される
      const start = at('2026-03-08T01:00', NEW_YORK);
      const end = at('2026-03-08T05:00', NEW_YORK);
      expect(end.getTime() - start.getTime()).toBe(3 * 60 * 60 * 1000);

      const occ = occurrence({ id: 'dst-meeting', start, end });
      const model = build({
        viewType: 'day',
        timeZone: NEW_YORK,
        currentDate: at('2026-03-08T00:00', NEW_YORK),
        now: at('2026-03-08T12:00', NEW_YORK),
        occurrences: [occ],
      });
      expect(model.days[0]?.key).toBe('2026-03-08');
      expect(model.days[0]?.items[0]).toMatchObject({
        startMinutes: 60,
        endMinutes: 300,
        continuesBefore: false,
        continuesAfter: false,
      });
      // nowIndicator も壁時計基準（12:00 → 720 分）
      expect(model.nowIndicator).toEqual({ dayKey: '2026-03-08', minutes: 720 });
    });

    it('DST 開始日をまたぐ深夜帯の予定も壁時計基準で分割される', () => {
      // 3/7 23:00 〜 3/8 1:00。週は 3/8（日曜）開始なので 3/7 分は表示されない
      const occ = occurrence({
        id: 'dst-overnight',
        start: at('2026-03-07T23:00', NEW_YORK),
        end: at('2026-03-08T01:00', NEW_YORK),
      });
      const model = build({
        viewType: 'week',
        timeZone: NEW_YORK,
        currentDate: at('2026-03-08T00:00', NEW_YORK),
        now: at('2026-03-08T12:00', NEW_YORK),
        occurrences: [occ],
      });
      expect(model.days[0]?.key).toBe('2026-03-08');
      expect(model.days[0]?.items).toHaveLength(1);
      expect(model.days[0]?.items[0]).toMatchObject({
        startMinutes: 0,
        endMinutes: 60,
        continuesBefore: true,
        continuesAfter: false,
      });
    });
  });

  describe('深夜 0:00 に DST が切り替わるゾーン（America/Santiago 2026-09-06）', () => {
    it('切替日を含む週でも days は 7 日で、8 日に増えない', () => {
      // Santiago は 2026-09-06 の 0:00 → 1:00 に春時間へ切り替わる（0:00 が存在しない）。
      // rangeEnd の再正規化がないと範囲が翌日側へ 1 時間はみ出し 8 日になる（回帰テスト）
      const model = build({
        currentDate: new Date('2026-09-06T12:00:00Z'),
        timeZone: 'America/Santiago',
      });
      expect(model.days).toHaveLength(7);
      expect(model.days.map((d) => d.key)).toEqual([
        '2026-09-06',
        '2026-09-07',
        '2026-09-08',
        '2026-09-09',
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
      ]);
    });
  });

  describe('空イベント', () => {
    it('発生が空でも days・slots は生成され、items と終日行は空になる', () => {
      const model = build({ occurrences: [] });
      expect(model.days).toHaveLength(7);
      expect(model.days.every((d) => d.items.length === 0)).toBe(true);
      expect(model.allDaySegments).toHaveLength(0);
      expect(model.allDayLaneCount).toBe(0);
      expect(model.slots).toHaveLength(24);
    });
  });
});
