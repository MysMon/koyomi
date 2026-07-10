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
 * オフセットなし ISO 文字列を、指定タイムゾーンの現地時刻として絶対時刻にする。
 * テストの日時指定を TZ 明示で行うためのヘルパー。
 */
function at(isoLocal: string, timeZone: TimeZoneId): Date {
  return parseDateValue(isoLocal, timeZone, false);
}

/**
 * テスト用のオカレンス（EventOccurrence）を構築する。
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

      // 両日とも同じオカレンスを参照し、終日行には入らない
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

    it('slotMinutes が 0 以下・非有限の場合は空配列になる（無限ループ防止ガード）', () => {
      expect(build({ slotMinutes: 0 }).slots).toEqual([]);
      expect(build({ slotMinutes: -15 }).slots).toEqual([]);
      expect(build({ slotMinutes: Number.NaN }).slots).toEqual([]);
      expect(build({ slotMinutes: Number.POSITIVE_INFINITY }).slots).toEqual([]);
    });
  });

  describe('timeAxes（複数タイムゾーン軸）', () => {
    it('timeAxisZones 未指定時は主軸のみの 1 要素配列になり、内容は slots と同一', () => {
      const model = build({ slotMinutes: 60 });
      expect(model.timeAxes).toHaveLength(1);
      expect(model.timeAxes[0]?.timeZone).toBe(TOKYO);
      expect(model.timeAxes[0]?.slots).toEqual(model.slots);
    });

    it('追加軸は timeZone と各スロットの現地時刻ラベルを持つ', () => {
      // 表示 TZ は東京（JST=UTC+9）、追加軸は NY（この期間は EDT=UTC-4）。
      // 東京 9:00（週最初の日の 0:00 から 540 分）は NY では前日 20:00
      const model = build({
        slotMinutes: 60,
        timeAxisZones: [NEW_YORK],
      });
      expect(model.timeAxes).toHaveLength(2);
      expect(model.timeAxes[0]?.timeZone).toBe(TOKYO);
      expect(model.timeAxes[1]?.timeZone).toBe(NEW_YORK);
      const nyAxisSlot9 = model.timeAxes[1]?.slots.find((slot) => slot.minutes === 540);
      expect(nyAxisSlot9).toEqual({ minutes: 540, label: '20:00' });
    });

    it('複数の追加軸を指定順に並べられる', () => {
      const model = build({
        slotMinutes: 60,
        timeAxisZones: [NEW_YORK, UTC],
      });
      expect(model.timeAxes.map((axis) => axis.timeZone)).toEqual([TOKYO, NEW_YORK, UTC]);
    });

    it('週ビューでは各日が自身の日付を基準にした timeAxes を持ち、週の途中の DST 切替後も正しいラベルになる', () => {
      // 表示 TZ は東京、追加軸は NY。週は 2026-03-08（日）始まり＝ NY が
      // 2:00→3:00（EST→EDT）へ切り替わる日を含む。東京 9:00 = 該当日 0:00 UTC なので、
      // 日曜（切替前）は EST(-5) で NY 19:00（前日）、月曜以降（切替後）は EDT(-4) で NY 20:00（前日）になる。
      // 週レベルで共有される rangeStart 基準の計算だとどちらも切替前の 19:00 のままになってしまう
      // （回帰対象のバグ）。
      const model = build({
        currentDate: at('2026-03-08T00:00', TOKYO),
        timeZone: TOKYO,
        slotMinutes: 60,
        timeAxisZones: [NEW_YORK],
      });
      const sunday = dayByKey(model, '2026-03-08');
      const monday = dayByKey(model, '2026-03-09');
      expect(sunday.timeAxes).toHaveLength(2);
      expect(sunday.timeAxes[1]?.timeZone).toBe(NEW_YORK);
      expect(sunday.timeAxes[1]?.slots.find((slot) => slot.minutes === 540)).toEqual({
        minutes: 540,
        label: '19:00',
      });
      expect(monday.timeAxes[1]?.slots.find((slot) => slot.minutes === 540)).toEqual({
        minutes: 540,
        label: '20:00',
      });
    });

    it('timeAxisZones 未指定時は各日の timeAxes も主軸のみの 1 要素配列になる', () => {
      const model = build({ slotMinutes: 60 });
      for (const day of model.days) {
        expect(day.timeAxes).toHaveLength(1);
        expect(day.timeAxes[0]?.timeZone).toBe(TOKYO);
      }
    });

    it('追加軸のラベルは実際のタイムゾーン変換で決まる（固定オフセットではない、DST 切替日で検証）', () => {
      // America/New_York の 2026-03-08 は 2:00→3:00 に進む日（day ビューの基準日）。
      // 主軸を NY、追加軸を UTC にすると、UTC 側のオフセットが切替前後で
      // -5 時間 → -4 時間に変わることがラベルにそのまま現れる
      // （固定オフセットの加算では 09:00 になってしまうところ、正しくは 08:00）
      const model = build({
        viewType: 'day',
        timeZone: NEW_YORK,
        currentDate: at('2026-03-08T00:00', NEW_YORK),
        slotMinutes: 60,
        timeAxisZones: [UTC],
      });
      const utcAxis = model.timeAxes[1];
      expect(utcAxis?.timeZone).toBe(UTC);
      // 0:00 NY（切替前、EST=UTC-5）→ 05:00 UTC
      expect(utcAxis?.slots.find((slot) => slot.minutes === 0)).toEqual({
        minutes: 0,
        label: '05:00',
      });
      // 1:00 NY（切替前、EST=UTC-5）→ 06:00 UTC
      expect(utcAxis?.slots.find((slot) => slot.minutes === 60)).toEqual({
        minutes: 60,
        label: '06:00',
      });
      // 4:00 NY（切替後、EDT=UTC-4）→ 08:00 UTC（固定 -5 オフセットなら 09:00 になってしまう）
      expect(utcAxis?.slots.find((slot) => slot.minutes === 240)).toEqual({
        minutes: 240,
        label: '08:00',
      });
    });
  });

  describe('showWeekNumbers（週番号）', () => {
    it('省略時（既定 false）は viewType: week でも weekNumber が null になる', () => {
      const model = build();
      expect(model.weekNumber).toBeNull();
    });

    it("viewType: 'week' で true にすると ISO 8601 週番号が入る（2026-07-01 を含む週は第 27 週）", () => {
      const model = build({ showWeekNumbers: true });
      expect(model.weekNumber).toBe(27);
    });

    it("viewType: 'day' では true でも weekNumber は null のまま", () => {
      const model = build({ viewType: 'day', showWeekNumbers: true });
      expect(model.weekNumber).toBeNull();
    });

    it('年またぎの週: 2025-12-28（日）始まりの週は 2026 年第 1 週になる', () => {
      const model = build({
        currentDate: at('2025-12-30T00:00', TOKYO),
        showWeekNumbers: true,
      });
      expect(model.days[0]?.key).toBe('2025-12-28');
      expect(model.weekNumber).toBe(1);
    });
  });

  describe('businessHours（営業時間）', () => {
    it('省略時（既定 []）はすべてのスロットが isBusinessHours: false になる', () => {
      const model = build({ slotMinutes: 60 });
      for (const day of model.days) {
        expect(day.businessHourSlots).toHaveLength(model.slots.length);
        expect(day.businessHourSlots.every((slot) => slot.isBusinessHours === false)).toBe(true);
      }
    });

    it('境界時刻: startTime ちょうどは営業時間内、endTime ちょうどは営業時間外', () => {
      // 2026-07-01 は水曜（weekday: 3）
      const model = build({
        slotMinutes: 60,
        businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
      });
      const wednesday = dayByKey(model, '2026-07-01');
      const at9 = wednesday.businessHourSlots.find((slot) => slot.minutes === 540);
      const at17 = wednesday.businessHourSlots.find((slot) => slot.minutes === 1020);
      const at8 = wednesday.businessHourSlots.find((slot) => slot.minutes === 480);
      expect(at9?.isBusinessHours).toBe(true);
      expect(at17?.isBusinessHours).toBe(false);
      expect(at8?.isBusinessHours).toBe(false);
    });

    it('daysOfWeek に含まれない曜日は終日 isBusinessHours: false になる', () => {
      // この週（2026-06-28〜2026-07-04）の日曜は 2026-06-28。平日 [1..5] のみを営業日にする
      const model = build({
        slotMinutes: 60,
        businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
      });
      const sunday = dayByKey(model, '2026-06-28');
      expect(sunday.businessHourSlots.every((slot) => slot.isBusinessHours === false)).toBe(true);
    });

    it('複数ルールを OR で判定する（曜日ごとに異なる時間帯）', () => {
      const model = build({
        slotMinutes: 60,
        businessHours: [
          { daysOfWeek: [6], startTime: '10:00', endTime: '13:00' }, // 土曜だけ午前のみ
          { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
        ],
      });
      const saturday = dayByKey(model, '2026-07-04');
      const at10 = saturday.businessHourSlots.find((slot) => slot.minutes === 600);
      const at9 = saturday.businessHourSlots.find((slot) => slot.minutes === 540);
      expect(at10?.isBusinessHours).toBe(true);
      expect(at9?.isBusinessHours).toBe(false);
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
    it('DST 開始日の予定の分計算が現地時刻基準で正しい', () => {
      // 2026-03-08 は 2:00 → 3:00 に進む日。1:00〜5:00 は絶対時間では 3 時間だが
      // 現地時刻では 60 分〜300 分に配置される
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
      // nowIndicator も現地時刻基準（12:00 → 720 分）
      expect(model.nowIndicator).toEqual({ dayKey: '2026-03-08', minutes: 720 });
    });

    it('DST 開始日をまたぐ深夜帯の予定も現地時刻基準で分割される', () => {
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
    it('オカレンスが空でも days・slots は生成され、items と終日行は空になる', () => {
      const model = build({ occurrences: [] });
      expect(model.days).toHaveLength(7);
      expect(model.days.every((d) => d.items.length === 0)).toBe(true);
      expect(model.allDaySegments).toHaveLength(0);
      expect(model.allDayLaneCount).toBe(0);
      expect(model.slots).toHaveLength(24);
    });
  });

  describe('機能無効時のアロケーション回避（参照共有）', () => {
    it('timeAxisZones 未指定時、主軸の slots・各日の timeAxes は共有参照になる（無駄な複製を作らない）', () => {
      const model = build();
      // 主軸の slots はビューモデルの slots そのもの（内容コピーではない）
      expect(model.timeAxes[0]?.slots).toBe(model.slots);
      // 追加軸がなければ日ごとの差（DST 対応の日別算出）も生じないため、
      // 全日がトップレベルと同一の timeAxes を共有する
      for (const day of model.days) {
        expect(day.timeAxes).toBe(model.timeAxes);
      }
    });

    it('businessHours 未指定時、各日の businessHourSlots は全日で共有参照になる', () => {
      const model = build();
      const first = model.days[0]?.businessHourSlots;
      expect(first).toBeDefined();
      for (const day of model.days) {
        expect(day.businessHourSlots).toBe(first);
      }
      expect(first?.every((slot) => slot.isBusinessHours === false)).toBe(true);
    });

    it('timeAxisZones 指定時は各日の timeAxes が日別に算出される（従来どおり）', () => {
      const model = build({ timeAxisZones: ['America/New_York'] });
      expect(model.days[0]?.timeAxes).not.toBe(model.timeAxes);
      expect(model.days[0]?.timeAxes[1]?.timeZone).toBe('America/New_York');
    });
  });

  describe('hiddenWeekdays（非表示曜日）', () => {
    it('week ビューでは非表示曜日の列が days から除外される', () => {
      const model = build({ hiddenWeekdays: [0, 6] });
      expect(model.days.map((d) => d.key)).toEqual([
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
      ]);
      expect(model.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    });

    it('day ビューでは hiddenWeekdays を無視し、明示的に移動した日を表示する', () => {
      // 7/4（土）は hiddenWeekdays=[0,6] に含まれるが、day ビューでは無視される
      const model = build({
        viewType: 'day',
        currentDate: at('2026-07-04T00:00', TOKYO),
        hiddenWeekdays: [0, 6],
      });
      expect(model.days).toHaveLength(1);
      expect(model.days[0]?.key).toBe('2026-07-04');
    });

    it('非表示曜日を跨ぐ終日イベントは可視列上で連続した 1 本のセグメントになる', () => {
      // 終日イベント 6/29(月)〜7/1(水)（end 排他で 7/2 0:00）で、火曜(2)を非表示に
      // すると可視列は 日,月,水,木,金,土（6 列）になり、月・水が隣接した span:2 になる
      const occ = occurrence({
        id: 'mon-wed',
        start: at('2026-06-29T00:00', TOKYO),
        end: at('2026-07-02T00:00', TOKYO),
        allDay: true,
      });
      const model = build({ occurrences: [occ], hiddenWeekdays: [2] });
      expect(model.allDaySegments).toHaveLength(1);
      // 可視列: 日(0),月(1),水(2),木(3),金(4),土(5) → 月は列 1、水は列 2
      expect(model.allDaySegments[0]).toMatchObject({
        startCol: 1,
        span: 2,
        continuesBefore: false,
        continuesAfter: false,
      });
    });

    it('非表示曜日のみに存在する終日イベントはセグメントを生成しない', () => {
      // 土曜(7/4)のみの終日イベント。週末を非表示にすると現れない
      const occ = occurrence({
        id: 'sat-only',
        start: at('2026-07-04T00:00', TOKYO),
        end: at('2026-07-05T00:00', TOKYO),
        allDay: true,
      });
      const model = build({ occurrences: [occ], hiddenWeekdays: [0, 6] });
      expect(model.allDaySegments).toHaveLength(0);
    });

    it('あふれのない終日行レーンは可視列数（columnCount）で組まれる', () => {
      const holiday = occurrence({
        id: 'holiday',
        start: at('2026-06-29T00:00', TOKYO),
        end: at('2026-07-04T00:00', TOKYO),
        allDay: true,
      });
      const model = build({ occurrences: [holiday], hiddenWeekdays: [0, 6] });
      // 可視列は月〜金の 5 列。終日イベントは月(6/29)〜金(7/3)なので全 5 列を専有する
      expect(model.allDaySegments[0]).toMatchObject({ startCol: 0, span: 5 });
      expect(model.allDayLaneCount).toBe(1);
    });

    it('「今日」が非表示曜日なら nowIndicator は null になる', () => {
      // now を 7/4（土）にし、週末を非表示にする
      const model = build({ now: at('2026-07-04T10:00', TOKYO), hiddenWeekdays: [0, 6] });
      expect(model.nowIndicator).toBeNull();
      expect(model.days.every((d) => !d.isToday)).toBe(true);
    });

    it('時間指定イベントで非表示曜日の日に属するオカレンスは days に現れない', () => {
      const occ = occurrence({
        id: 'saturday-meeting',
        start: at('2026-07-04T10:00', TOKYO),
        end: at('2026-07-04T11:00', TOKYO),
      });
      const model = build({ occurrences: [occ], hiddenWeekdays: [0, 6] });
      expect(model.days.some((d) => d.key === '2026-07-04')).toBe(false);
      for (const day of model.days) {
        expect(day.items).toHaveLength(0);
      }
    });

    it('非表示曜日へ日跨ぎする時間指定イベントは、隣接する可視日にのみ現れる（元列単位のバケット分け境界）', () => {
      // 月(6/29) 22:00 〜 火(6/30) 02:00 で、火曜(2) を非表示にする。
      // 振り分けは非表示曜日を含む「元の」全列を単位に行うため、火曜が
      // 挟まっていても月曜には continuesAfter 付きで正しく現れ、
      // 火曜の先の水曜(7/1) まで誤って漏れ出さないことを確認する。
      const occ = occurrence({
        id: 'late-monday',
        start: at('2026-06-29T22:00', TOKYO),
        end: at('2026-06-30T02:00', TOKYO),
      });
      const model = build({ occurrences: [occ], hiddenWeekdays: [2] });
      expect(model.days.some((d) => d.key === '2026-06-30')).toBe(false);

      const monday = dayByKey(model, '2026-06-29');
      expect(monday.items).toHaveLength(1);
      expect(monday.items[0]).toMatchObject({
        startMinutes: 1320,
        endMinutes: 1440,
        continuesBefore: false,
        continuesAfter: true,
      });

      const wednesday = dayByKey(model, '2026-07-01');
      expect(wednesday.items).toHaveLength(0);
    });
  });
});
