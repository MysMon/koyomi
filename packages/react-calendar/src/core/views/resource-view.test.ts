/**
 * resource-view.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' を明示して行う。
 */
import { describe, expect, it } from 'vitest';
import { parseDateValue } from '../timezone';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  EventOccurrence,
  TimeZoneId,
} from '../types';
import { buildResourceViewModel } from './resource-view';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

/** 指定タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string, timeZone: TimeZoneId = TOKYO): Date {
  return parseDateValue(isoLocal, timeZone, false);
}

/** テスト用の EventOccurrence を構築するヘルパ。 */
function makeOccurrence(params: {
  start: Date;
  end: Date;
  eventId?: string;
  allDay?: boolean;
  resourceId?: string;
}): EventOccurrence {
  const eventId = params.eventId ?? 'ev-1';
  const allDay = params.allDay ?? false;
  const event: CalendarEvent = {
    id: eventId,
    title: 'テスト予定',
    start: params.start,
    end: params.end,
    allDay,
    ...(params.resourceId !== undefined ? { resourceId: params.resourceId } : {}),
  };
  return {
    key: `${eventId}@${params.start.toISOString()}`,
    eventId,
    event,
    start: params.start,
    end: params.end,
    allDay,
    isRecurring: false,
    originalStart: params.start,
  };
}

/** テスト用のリソースを作る。 */
function resource(id: string, title?: string): CalendarResource {
  return { id, title: title ?? `リソース ${id}` };
}

/** 既定パラメータでビューモデルを構築するヘルパ。 */
function build(params: {
  occurrences?: readonly EventOccurrence[];
  resources?: readonly CalendarResource[];
  unassignedLane?: 'auto' | 'always';
  currentDate?: Date;
  now?: Date;
  timeZone?: TimeZoneId;
  slotMinutes?: number;
  businessHours?: readonly BusinessHoursRule[];
}) {
  return buildResourceViewModel({
    currentDate: params.currentDate ?? at('2026-07-10T09:00'),
    timeZone: params.timeZone ?? TOKYO,
    occurrences: params.occurrences ?? [],
    resources: params.resources ?? [],
    unassignedLane: params.unassignedLane ?? 'auto',
    slotMinutes: params.slotMinutes ?? 60,
    now: params.now ?? at('2026-07-10T10:30'),
    ...(params.businessHours !== undefined ? { businessHours: params.businessHours } : {}),
  });
}

describe('buildResourceViewModel', () => {
  describe('列の生成', () => {
    it('resources の並び順どおりに列を生成し、キーは r: 接頭辞付きの形式になる', () => {
      const vm = build({ resources: [resource('room-b'), resource('room-a')] });
      expect(vm.type).toBe('resource');
      expect(vm.columns.map((column) => column.key)).toEqual(['r:room-b', 'r:room-a']);
      expect(vm.columns.map((column) => column.resource?.id)).toEqual(['room-b', 'room-a']);
    });

    it('ID が重複するリソースは先勝ちで 1 列になる', () => {
      const vm = build({
        resources: [resource('room', '先'), resource('room', '後')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'room',
          }),
        ],
      });
      expect(vm.columns).toHaveLength(1);
      expect(vm.columns[0]?.resource?.title).toBe('先');
      expect(vm.columns[0]?.items).toHaveLength(1);
    });

    it("unassignedLane: 'auto' では未割り当てオカレンスがある場合のみ末尾に未割り当て列が付く", () => {
      const withUnassigned = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({ start: at('2026-07-10T10:00'), end: at('2026-07-10T11:00') }),
        ],
      });
      expect(withUnassigned.columns.map((column) => column.key)).toEqual(['r:r1', 'unassigned']);
      expect(withUnassigned.columns[1]?.resource).toBeNull();

      const withoutUnassigned = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'r1',
          }),
        ],
      });
      expect(withoutUnassigned.columns.map((column) => column.key)).toEqual(['r:r1']);
    });

    it("unassignedLane: 'always' では該当オカレンスがなくても未割り当て列が付く", () => {
      const vm = build({ resources: [resource('r1')], unassignedLane: 'always' });
      expect(vm.columns.map((column) => column.key)).toEqual(['r:r1', 'unassigned']);
    });

    it('参照先のない resourceId のオカレンスは未割り当て列に合流する', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'ghost',
          }),
        ],
      });
      expect(vm.columns.map((column) => column.key)).toEqual(['r:r1', 'unassigned']);
      expect(vm.columns[1]?.items).toHaveLength(1);
    });

    it("'unassigned' という ID のリソースがあっても未割り当て列とキーが衝突しない", () => {
      const vm = build({
        resources: [resource('unassigned', '会議室U')],
        occurrences: [
          makeOccurrence({ start: at('2026-07-10T10:00'), end: at('2026-07-10T11:00') }),
        ],
      });
      expect(vm.columns.map((column) => column.key)).toEqual(['r:unassigned', 'unassigned']);
      expect(vm.columns[0]?.resource?.title).toBe('会議室U');
      expect(vm.columns[1]?.resource).toBeNull();
    });
  });

  describe('空状態', () => {
    it('リソースがなく未割り当ても生成されない場合は isEmpty: true で columns が空になる', () => {
      const vm = build({});
      expect(vm.columns).toEqual([]);
      expect(vm.isEmpty).toBe(true);
    });

    it("unassignedLane: 'always' なら isEmpty にならない", () => {
      const vm = build({ unassignedLane: 'always' });
      expect(vm.columns).toHaveLength(1);
      expect(vm.isEmpty).toBe(false);
    });
  });

  describe('時間指定イベントの配置', () => {
    it('同じ列内で重なるイベントは横並びになり、別の列とは独立してレイアウトされる', () => {
      const vm = build({
        resources: [resource('r1'), resource('r2')],
        occurrences: [
          makeOccurrence({
            eventId: 'a',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'b',
            start: at('2026-07-10T10:30'),
            end: at('2026-07-10T11:30'),
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'c',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'r2',
          }),
        ],
      });
      const r1 = vm.columns[0];
      expect(r1?.items.map((item) => item.width)).toEqual([0.5, 0.5]);
      // r2 の予定は r1 と重なっていても幅 1（列ごとに独立）
      const r2 = vm.columns[1];
      expect(r2?.items.map((item) => item.width)).toEqual([1]);
    });

    it('日をまたぐオカレンスは表示日分にクランプされ continuesBefore/After が立つ', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-09T22:00'),
            end: at('2026-07-10T02:00'),
            resourceId: 'r1',
          }),
        ],
      });
      const item = vm.columns[0]?.items[0];
      expect(item?.startMinutes).toBe(0);
      expect(item?.endMinutes).toBe(120);
      expect(item?.continuesBefore).toBe(true);
      expect(item?.continuesAfter).toBe(false);
    });
  });

  describe('終日イベント', () => {
    it('allDay のオカレンスは allDayItems に入り、時間指定は items に入る', () => {
      const dayStart = at('2026-07-10T00:00');
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            eventId: 'allday',
            start: dayStart,
            end: at('2026-07-11T00:00'),
            allDay: true,
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'timed',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.columns[0]?.allDayItems.map((occurrence) => occurrence.eventId)).toEqual([
        'allday',
      ]);
      expect(vm.columns[0]?.items.map((item) => item.occurrence.eventId)).toEqual(['timed']);
    });

    it('allDayItems は開始昇順 → 長い順 → キー辞書順で並ぶ', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            eventId: 'short',
            start: at('2026-07-10T00:00'),
            end: at('2026-07-11T00:00'),
            allDay: true,
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'long',
            start: at('2026-07-10T00:00'),
            end: at('2026-07-12T00:00'),
            allDay: true,
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'early',
            start: at('2026-07-09T00:00'),
            end: at('2026-07-11T00:00'),
            allDay: true,
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.columns[0]?.allDayItems.map((occurrence) => occurrence.eventId)).toEqual([
        'early',
        'long',
        'short',
      ]);
    });

    it('24 時間以上の複数日の時間指定オカレンスも終日行に入る（週/日ビューと同じ振り分け）', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-09T12:00'),
            end: at('2026-07-10T13:00'),
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.columns[0]?.allDayItems).toHaveLength(1);
      expect(vm.columns[0]?.items).toHaveLength(0);
    });
  });

  describe('日付・現在時刻線・目盛り', () => {
    it('date/dateKey/isToday が表示日を表す', () => {
      const vm = build({});
      expect(vm.dateKey).toBe('2026-07-10');
      expect(vm.date).toEqual(at('2026-07-10T00:00'));
      expect(vm.isToday).toBe(true);
    });

    it('表示日が今日なら nowIndicatorMinutes が現地時刻の分になる', () => {
      const vm = build({ now: at('2026-07-10T10:30') });
      expect(vm.nowIndicatorMinutes).toBe(10 * 60 + 30);
    });

    it('表示日が今日でなければ nowIndicatorMinutes は null になる', () => {
      const vm = build({ now: at('2026-07-11T10:30') });
      expect(vm.nowIndicatorMinutes).toBeNull();
    });

    it('slots は slotMinutes 間隔で 1440 分未満まで生成される', () => {
      const vm = build({ slotMinutes: 360 });
      expect(vm.slots.map((slot) => slot.minutes)).toEqual([0, 360, 720, 1080]);
      expect(vm.slots[1]?.label).toBe('06:00');
    });
  });

  describe('マルチタイムゾーン', () => {
    it('America/New_York の DST 開始日でも表示日の 0:00 と分計算が現地時刻基準になる', () => {
      // 2026-03-08 は NY の DST 開始日（2:00 → 3:00）
      const vm = build({
        timeZone: NY,
        currentDate: at('2026-03-08T12:00', NY),
        now: at('2026-03-08T12:00', NY),
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-03-08T10:00', NY),
            end: at('2026-03-08T11:00', NY),
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.dateKey).toBe('2026-03-08');
      const item = vm.columns[0]?.items[0];
      expect(item?.startMinutes).toBe(600);
      expect(item?.endMinutes).toBe(660);
      expect(vm.nowIndicatorMinutes).toBe(720);
    });
  });

  describe('businessHours（営業時間）', () => {
    it('省略時（既定 []）はすべてのスロットが isBusinessHours: false になる', () => {
      const vm = build({ slotMinutes: 60 });
      expect(vm.businessHourSlots).toHaveLength(vm.slots.length);
      expect(vm.businessHourSlots.every((slot) => slot.isBusinessHours === false)).toBe(true);
    });

    it('表示日（列共通）の曜日を基準に該当スロットが isBusinessHours: true になる', () => {
      // 2026-07-10 は金曜（weekday: 5）
      const vm = build({
        slotMinutes: 60,
        businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
      });
      const at9 = vm.businessHourSlots.find((slot) => slot.minutes === 540);
      const at18 = vm.businessHourSlots.find((slot) => slot.minutes === 1080);
      const at8 = vm.businessHourSlots.find((slot) => slot.minutes === 480);
      expect(at9?.isBusinessHours).toBe(true);
      expect(at18?.isBusinessHours).toBe(false);
      expect(at8?.isBusinessHours).toBe(false);
    });

    it('daysOfWeek に表示日の曜日が含まれない場合は終日 isBusinessHours: false になる', () => {
      // 2026-07-10 は金曜（weekday: 5）。日曜だけを営業日にする
      const vm = build({
        slotMinutes: 60,
        businessHours: [{ daysOfWeek: [0], startTime: '09:00', endTime: '18:00' }],
      });
      expect(vm.businessHourSlots.every((slot) => slot.isBusinessHours === false)).toBe(true);
    });

    it('列が複数あっても businessHourSlots は全列共通の 1 本（列ごとの再計算をしない）', () => {
      const vm = build({
        resources: [resource('r1'), resource('r2')],
        businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
      });
      expect(vm.columns).toHaveLength(2);
      // ResourceViewModel 自体に 1 本だけ存在し、列ごとの businessHourSlots は持たない
      expect(vm.businessHourSlots.some((slot) => slot.isBusinessHours)).toBe(true);
    });
  });
});
