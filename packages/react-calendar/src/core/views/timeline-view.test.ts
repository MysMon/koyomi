/**
 * timeline-view.ts のテスト。
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
  TimelineScale,
  TimeZoneId,
  Weekday,
} from '../types';
import { buildTimelineViewModel } from './timeline-view';

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
  resourceIds?: readonly string[];
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
    ...(params.resourceIds !== undefined ? { resourceIds: params.resourceIds } : {}),
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
function resource(id: string): CalendarResource {
  return { id, title: `リソース ${id}` };
}

/** 既定パラメータでビューモデルを構築するヘルパ（表示は 2026-07-10 から）。 */
function build(params: {
  occurrences?: readonly EventOccurrence[];
  resources?: readonly CalendarResource[];
  unassignedLane?: 'auto' | 'always';
  timelineDays?: number;
  slotMinutes?: number;
  locale?: string;
  timelineScale?: TimelineScale;
  weekStartsOn?: Weekday;
  currentDate?: Date;
  now?: Date;
  timeZone?: TimeZoneId;
  businessHours?: readonly BusinessHoursRule[];
  collapsedResourceIds?: ReadonlySet<string>;
}) {
  return buildTimelineViewModel({
    currentDate: params.currentDate ?? at('2026-07-10T09:00'),
    timeZone: params.timeZone ?? TOKYO,
    occurrences: params.occurrences ?? [],
    resources: params.resources ?? [],
    unassignedLane: params.unassignedLane ?? 'auto',
    timelineDays: params.timelineDays ?? 3,
    slotMinutes: params.slotMinutes ?? 60,
    locale: params.locale ?? 'ja',
    timelineScale: params.timelineScale ?? 'hour',
    weekStartsOn: params.weekStartsOn ?? 0,
    now: params.now ?? at('2026-07-10T10:30'),
    ...(params.businessHours !== undefined ? { businessHours: params.businessHours } : {}),
    ...(params.collapsedResourceIds !== undefined
      ? { collapsedResourceIds: params.collapsedResourceIds }
      : {}),
  });
}

/** テスト用のリソースを parentId 付きで作る。 */
function resourceWithParent(id: string, parentId?: string): CalendarResource {
  return { id, title: `リソース ${id}`, ...(parentId !== undefined ? { parentId } : {}) };
}

describe('buildTimelineViewModel', () => {
  describe('表示日と目盛り', () => {
    it('timelineDays 日分の連続した表示日と totalMinutes を生成する', () => {
      const vm = build({ timelineDays: 3 });
      expect(vm.type).toBe('timeline');
      expect(vm.days.map((day) => day.key)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12']);
      expect(vm.days.map((day) => day.weekday)).toEqual([5, 6, 0]);
      expect(vm.days[0]?.isToday).toBe(true);
      expect(vm.totalMinutes).toBe(3 * 1440);
    });

    it('slots は全表示日分を連結し、minutes は表示分・label は日内時刻・dayKey を持つ', () => {
      const vm = build({ timelineDays: 2, slotMinutes: 720 });
      expect(vm.slots.map((slot) => slot.minutes)).toEqual([0, 720, 1440, 2160]);
      expect(vm.slots.map((slot) => slot.label)).toEqual(['00:00', '12:00', '00:00', '12:00']);
      expect(vm.slots.map((slot) => slot.dayKey)).toEqual([
        '2026-07-10',
        '2026-07-10',
        '2026-07-11',
        '2026-07-11',
      ]);
    });

    it('1440 の非約数の slotMinutes では日ごとの目盛り数が切り上げになる', () => {
      // 1440 / 550 = 2.6… → 1 日あたり 3 個（0, 550, 1100）
      const vm = build({ timelineDays: 2, slotMinutes: 550 });
      expect(vm.slots).toHaveLength(6);
      expect(vm.slots.map((slot) => slot.minutes)).toEqual([0, 550, 1100, 1440, 1990, 2540]);
    });

    it("locale: 'en-US' を指定すると 'hour' スケールのラベルが 12h/AM-PM 表記になる", () => {
      const vm = build({ timelineDays: 1, slotMinutes: 720, locale: 'en-US' });
      expect(vm.slots.map((slot) => slot.label)).toEqual(['12:00 AM', '12:00 PM']);
    });
  });

  describe('行の生成', () => {
    it('resources の並び順で行を生成し、未割り当ては auto 規則で末尾に付く', () => {
      const vm = build({
        resources: [resource('r1'), resource('r2')],
        occurrences: [
          makeOccurrence({ start: at('2026-07-10T10:00'), end: at('2026-07-10T11:00') }),
        ],
      });
      expect(vm.rows.map((row) => row.key)).toEqual(['r:r1', 'r:r2', 'unassigned']);
      expect(vm.rows[2]?.resource).toBeNull();
      expect(vm.isEmpty).toBe(false);
    });

    it('リソースがなく未割り当ても生成されなければ isEmpty になる', () => {
      const vm = build({});
      expect(vm.rows).toEqual([]);
      expect(vm.isEmpty).toBe(true);
    });

    it('参照先のない resourceId は未割り当て行に合流する', () => {
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
      expect(vm.rows.map((row) => row.key)).toEqual(['r:r1', 'unassigned']);
      expect(vm.rows[1]?.items).toHaveLength(1);
    });

    it('resourceIds の各リソースの行に同一オカレンスが表示される（resourceId は無視される）', () => {
      const occurrence = makeOccurrence({
        start: at('2026-07-10T10:00'),
        end: at('2026-07-10T11:00'),
        resourceId: 'r3',
        resourceIds: ['r1', 'r2'],
      });
      const vm = build({
        resources: [resource('r1'), resource('r2'), resource('r3')],
        occurrences: [occurrence],
      });
      expect(vm.rows.map((row) => row.items.length)).toEqual([1, 1, 0]);
      expect(vm.rows[0]?.items[0]?.occurrence).toBe(occurrence);
      expect(vm.rows[1]?.items[0]?.occurrence).toBe(occurrence);
    });

    it('resourceIds が空配列・すべて参照先のない ID の場合は未割り当て行に 1 回だけ合流する', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            eventId: 'empty',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceIds: [],
          }),
          makeOccurrence({
            eventId: 'ghosts',
            start: at('2026-07-10T12:00'),
            end: at('2026-07-10T13:00'),
            resourceIds: ['ghost-1', 'ghost-2'],
          }),
        ],
      });
      expect(vm.rows.map((row) => row.key)).toEqual(['r:r1', 'unassigned']);
      expect(vm.rows[1]?.items).toHaveLength(2);
    });
  });

  describe('帯の配置（表示分）', () => {
    it('時間指定オカレンスが表示分に変換される（2 日目は 1440 分から）', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-11T10:00'),
            end: at('2026-07-11T12:00'),
            resourceId: 'r1',
          }),
        ],
      });
      const item = vm.rows[0]?.items[0];
      expect(item?.startMinutes).toBe(1440 + 600);
      expect(item?.endMinutes).toBe(1440 + 720);
      expect(item?.continuesBefore).toBe(false);
      expect(item?.continuesAfter).toBe(false);
    });

    it('日をまたぐオカレンスは連続した 1 本の帯になる（時間グリッドのような日分割をしない）', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-10T22:00'),
            end: at('2026-07-11T02:00'),
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.rows[0]?.items).toHaveLength(1);
      const item = vm.rows[0]?.items[0];
      expect(item?.startMinutes).toBe(22 * 60);
      expect(item?.endMinutes).toBe(1440 + 120);
    });

    it('表示範囲の外へ続くオカレンスはクランプされ continuesBefore/After が立つ', () => {
      const vm = build({
        timelineDays: 1,
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-09T12:00'),
            end: at('2026-07-11T12:00'),
            resourceId: 'r1',
          }),
        ],
      });
      const item = vm.rows[0]?.items[0];
      expect(item?.startMinutes).toBe(0);
      expect(item?.endMinutes).toBe(1440);
      expect(item?.continuesBefore).toBe(true);
      expect(item?.continuesAfter).toBe(true);
    });

    it('終日オカレンスは覆う表示日の全幅（0 分〜1440 分単位）の帯になる', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-11T00:00'),
            end: at('2026-07-12T00:00'),
            allDay: true,
            resourceId: 'r1',
          }),
        ],
      });
      const item = vm.rows[0]?.items[0];
      expect(item?.startMinutes).toBe(1440);
      expect(item?.endMinutes).toBe(2880);
    });

    it('長さ 0 のオカレンスは実効 30 分の帯として扱う', () => {
      const point = at('2026-07-10T09:00');
      const vm = build({
        resources: [resource('r1')],
        occurrences: [makeOccurrence({ start: point, end: point, resourceId: 'r1' })],
      });
      const item = vm.rows[0]?.items[0];
      expect(item?.startMinutes).toBe(540);
      expect(item?.endMinutes).toBe(570);
    });

    it('重なる帯はレーンに積まれ、items は表示分の開始昇順で並ぶ', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            eventId: 'b',
            start: at('2026-07-10T10:30'),
            end: at('2026-07-10T11:30'),
            resourceId: 'r1',
          }),
          makeOccurrence({
            eventId: 'a',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'r1',
          }),
        ],
      });
      const row = vm.rows[0];
      expect(row?.items.map((item) => item.occurrence.eventId)).toEqual(['a', 'b']);
      expect(row?.items.map((item) => item.lane)).toEqual([0, 1]);
      expect(row?.laneCount).toBe(2);
    });

    it('終日と時間指定は同じレーン空間に配置される', () => {
      const vm = build({
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            eventId: 'allday',
            start: at('2026-07-10T00:00'),
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
      const row = vm.rows[0];
      expect(row?.laneCount).toBe(2);
      const lanes = new Map(row?.items.map((item) => [item.occurrence.eventId, item.lane]));
      expect(lanes.get('allday')).not.toBe(lanes.get('timed'));
    });
  });

  describe('現在時刻線', () => {
    it('「今」が表示範囲内なら表示分を返す', () => {
      const vm = build({ now: at('2026-07-11T10:30') });
      expect(vm.nowIndicatorMinutes).toBe(1440 + 630);
    });

    it('「今」が表示範囲外なら null を返す', () => {
      const vm = build({ now: at('2026-07-20T10:30') });
      expect(vm.nowIndicatorMinutes).toBeNull();
    });
  });

  describe('businessHours（営業時間）', () => {
    it('省略時（既定 []）は businessHourRanges が空配列になり、常に同じ参照を返す', () => {
      const vm1 = build({});
      const vm2 = build({});
      expect(vm1.businessHourRanges).toEqual([]);
      expect(vm1.businessHourRanges).toBe(vm2.businessHourRanges);
    });

    it('該当曜日の日だけ、日オフセット付きの表示分の区間に変換される', () => {
      // 表示日: 2026-07-10(金,5) / 07-11(土,6) / 07-12(日,0)。金曜だけを営業日にする
      const vm = build({
        businessHours: [{ daysOfWeek: [5], startTime: '09:00', endTime: '18:00' }],
      });
      expect(vm.businessHourRanges).toEqual([{ startMinutes: 540, endMinutes: 1080 }]);
    });

    it('複数日にわたる場合、各日の区間が日オフセット付きで並ぶ', () => {
      const vm = build({
        businessHours: [{ daysOfWeek: [5, 6], startTime: '09:00', endTime: '18:00' }],
      });
      expect(vm.businessHourRanges).toEqual([
        { startMinutes: 540, endMinutes: 1080 }, // 金曜（日オフセット 0）
        { startMinutes: 1440 + 540, endMinutes: 1440 + 1080 }, // 土曜（日オフセット 1440）
      ]);
    });

    it('同日内で隣接する複数ルールの区間はマージされる', () => {
      const vm = build({
        businessHours: [
          { daysOfWeek: [5], startTime: '09:00', endTime: '13:00' },
          { daysOfWeek: [5], startTime: '13:00', endTime: '18:00' },
        ],
      });
      expect(vm.businessHourRanges).toEqual([{ startMinutes: 540, endMinutes: 1080 }]);
    });

    it('同日内で重複する複数ルールの区間はマージされる', () => {
      const vm = build({
        businessHours: [
          { daysOfWeek: [5], startTime: '09:00', endTime: '15:00' },
          { daysOfWeek: [5], startTime: '13:00', endTime: '18:00' },
        ],
      });
      expect(vm.businessHourRanges).toEqual([{ startMinutes: 540, endMinutes: 1080 }]);
    });

    it('離れた区間はマージされず、開始分昇順で並ぶ', () => {
      const vm = build({
        businessHours: [
          { daysOfWeek: [5], startTime: '15:00', endTime: '18:00' },
          { daysOfWeek: [5], startTime: '09:00', endTime: '12:00' },
        ],
      });
      expect(vm.businessHourRanges).toEqual([
        { startMinutes: 540, endMinutes: 720 },
        { startMinutes: 900, endMinutes: 1080 },
      ]);
    });

    it("endTime '24:00'（日の終端）の区間は翌日 00:00 始まりの区間と連続とみなされマージされる", () => {
      // 金曜 22:00〜24:00 と土曜 00:00〜02:00 は表示分座標系で連続する 1 本の帯になる
      const vm = build({
        businessHours: [
          { daysOfWeek: [5], startTime: '22:00', endTime: '24:00' },
          { daysOfWeek: [6], startTime: '00:00', endTime: '02:00' },
        ],
      });
      expect(vm.businessHourRanges).toEqual([{ startMinutes: 1320, endMinutes: 1440 + 120 }]);
    });

    it('daysOfWeek に表示日の曜日が含まれない場合は区間が生成されない', () => {
      const vm = build({
        businessHours: [{ daysOfWeek: [1, 2, 3, 4], startTime: '09:00', endTime: '18:00' }],
      });
      expect(vm.businessHourRanges).toEqual([]);
    });
  });

  describe('マルチタイムゾーン', () => {
    it('DST 開始日（実時間 23 時間）でも各日は 1440 分の等幅として扱われる', () => {
      // 2026-03-08 は NY の DST 開始日
      const vm = build({
        timeZone: NY,
        timelineDays: 2,
        currentDate: at('2026-03-08T00:00', NY),
        now: at('2026-03-09T10:00', NY),
        resources: [resource('r1')],
        occurrences: [
          makeOccurrence({
            start: at('2026-03-09T10:00', NY),
            end: at('2026-03-09T11:00', NY),
            resourceId: 'r1',
          }),
        ],
      });
      expect(vm.totalMinutes).toBe(2880);
      const item = vm.rows[0]?.items[0];
      // 2 日目の現地時刻 10:00 = 表示分 1440 + 600（実時間の 23 時間は影響しない）
      expect(item?.startMinutes).toBe(1440 + 600);
      expect(vm.nowIndicatorMinutes).toBe(1440 + 600);
    });
  });

  describe('timelineScale（ズーム粒度）', () => {
    it("省略時は既定 'hour' になり、headerGroups は null（既存挙動の回帰確認）", () => {
      const vm = build({});
      expect(vm.scale).toBe('hour');
      expect(vm.headerGroups).toBeNull();
    });

    it('day スケールでは slots が常に空配列、headerGroups は null、days は不変', () => {
      const vm = build({ timelineScale: 'day', timelineDays: 3, slotMinutes: 60 });
      expect(vm.scale).toBe('day');
      expect(vm.slots).toEqual([]);
      expect(vm.headerGroups).toBeNull();
      expect(vm.days).toHaveLength(3);
    });

    it('day/hour スケールでは weekStartsOn に関係なく headerGroups が null', () => {
      const vmDay = build({ timelineScale: 'day', weekStartsOn: 3 });
      const vmHour = build({ timelineScale: 'hour', weekStartsOn: 3 });
      expect(vmDay.headerGroups).toBeNull();
      expect(vmHour.headerGroups).toBeNull();
    });

    describe('week スケール', () => {
      it('weekStartsOn=0 で週境界ごとにグループ化し、先頭/末尾が部分週になる', () => {
        // 表示: 2026-07-10(金)〜07-19（10日間）。weekStartsOn=0（日曜始まり）
        const vm = build({
          timelineScale: 'week',
          weekStartsOn: 0,
          currentDate: at('2026-07-10T00:00'),
          timelineDays: 10,
        });
        expect(vm.scale).toBe('week');
        const groups = vm.headerGroups;
        expect(groups).not.toBeNull();
        expect(groups?.map((g) => g.key)).toEqual(['2026-07-10', '2026-07-12', '2026-07-19']);
        expect(groups?.map((g) => [g.startMinutes, g.endMinutes])).toEqual([
          [0, 2 * 1440],
          [2 * 1440, 9 * 1440],
          [9 * 1440, 10 * 1440],
        ]);
        expect(groups?.[0]?.start.getTime()).toBe(at('2026-07-10T00:00').getTime());
        expect(groups?.[2]?.end.getTime()).toBe(at('2026-07-20T00:00').getTime());
      });

      it('weekStartsOn を変えるとグループ境界がずれる', () => {
        const vm = build({
          timelineScale: 'week',
          weekStartsOn: 1,
          currentDate: at('2026-07-10T00:00'),
          timelineDays: 10,
        });
        expect(vm.headerGroups?.map((g) => g.key)).toEqual(['2026-07-10', '2026-07-13']);
      });

      it('containsToday はグループ内に「今日」を含むかで決まる', () => {
        const vm = build({
          timelineScale: 'week',
          weekStartsOn: 0,
          currentDate: at('2026-07-10T00:00'),
          timelineDays: 10,
          now: at('2026-07-15T10:00'), // 第 2 グループ（07-12〜07-18）内
        });
        expect(vm.headerGroups?.map((g) => g.containsToday)).toEqual([false, true, false]);
      });
    });

    describe('month スケール', () => {
      it('月境界でグループ化し、部分月がクランプされる（31日と28日の月が混在）', () => {
        // 2027 年は平年（2月28日）。表示: 2027-01-20〜（45日間） = 1/20-31(12日)+2月(28日)+3/1-5(5日)
        const vm = build({
          timelineScale: 'month',
          currentDate: at('2027-01-20T00:00'),
          timelineDays: 45,
        });
        expect(vm.scale).toBe('month');
        const groups = vm.headerGroups;
        expect(groups?.map((g) => g.key)).toEqual(['2027-01-20', '2027-02-01', '2027-03-01']);
        expect((groups?.[0]?.endMinutes ?? 0) - (groups?.[0]?.startMinutes ?? 0)).toBe(12 * 1440);
        expect((groups?.[1]?.endMinutes ?? 0) - (groups?.[1]?.startMinutes ?? 0)).toBe(28 * 1440);
        expect((groups?.[2]?.endMinutes ?? 0) - (groups?.[2]?.startMinutes ?? 0)).toBe(5 * 1440);
      });
    });

    describe('slots（週/月スケールの日番号目盛り）', () => {
      it('week/month スケールでは 1 日 1 件、label が日番号の文字列になる', () => {
        const vm = build({
          timelineScale: 'month',
          currentDate: at('2027-01-30T00:00'),
          timelineDays: 3, // 1/30, 1/31, 2/1
        });
        expect(vm.slots.map((s) => s.label)).toEqual(['30', '31', '1']);
        expect(vm.slots.map((s) => s.minutes)).toEqual([0, 1440, 2880]);
        expect(vm.slots.map((s) => s.dayKey)).toEqual(['2027-01-30', '2027-01-31', '2027-02-01']);
      });
    });
  });

  describe('リソースの階層グルーピング（parentId）', () => {
    it('parentId 未使用時は depth=0・hasChildren=false・collapsed=false になる（既存挙動の回帰確認）', () => {
      const vm = build({ resources: [resource('r1'), resource('r2')] });
      for (const row of vm.rows) {
        expect(row.depth).toBe(0);
        expect(row.hasChildren).toBe(false);
        expect(row.collapsed).toBe(false);
      }
    });

    it('parentId 併用時に rows がツリー順＋深さで並び、未割り当て行は常に末尾になる', () => {
      const vm = build({
        resources: [
          resourceWithParent('site'),
          resourceWithParent('floor-1', 'site'),
          resourceWithParent('room-101', 'floor-1'),
        ],
        occurrences: [
          makeOccurrence({
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
          }),
        ],
        unassignedLane: 'always',
      });
      expect(vm.rows.map((row) => row.key)).toEqual([
        'r:site',
        'r:floor-1',
        'r:room-101',
        'unassigned',
      ]);
      expect(vm.rows.map((row) => row.depth)).toEqual([0, 1, 2, 0]);
      expect(vm.rows.map((row) => row.hasChildren)).toEqual([true, true, false, false]);
    });

    it('親リソース自身に割り当てた予定が親の行の items に現れる（子の予定と混ざらない）', () => {
      const vm = build({
        resources: [resourceWithParent('parent'), resourceWithParent('child', 'parent')],
        occurrences: [
          makeOccurrence({
            eventId: 'ev-parent',
            start: at('2026-07-10T10:00'),
            end: at('2026-07-10T11:00'),
            resourceId: 'parent',
          }),
          makeOccurrence({
            eventId: 'ev-child',
            start: at('2026-07-10T13:00'),
            end: at('2026-07-10T14:00'),
            resourceId: 'child',
          }),
        ],
      });
      const parentRow = vm.rows.find((row) => row.key === 'r:parent');
      const childRow = vm.rows.find((row) => row.key === 'r:child');
      expect(parentRow?.items.map((item) => item.occurrence.eventId)).toEqual(['ev-parent']);
      expect(childRow?.items.map((item) => item.occurrence.eventId)).toEqual(['ev-child']);
    });

    it('collapsedResourceIds が空のときは全行が可視になる（既定挙動）', () => {
      const vm = build({
        resources: [resourceWithParent('parent'), resourceWithParent('child', 'parent')],
      });
      expect(vm.rows.map((row) => row.key)).toEqual(['r:parent', 'r:child']);
      expect(vm.rows.find((row) => row.key === 'r:parent')?.collapsed).toBe(false);
    });

    it('親を折りたたむと、その子孫行が rows から除外される（親自身は残り collapsed=true になる）', () => {
      const vm = build({
        resources: [resourceWithParent('parent'), resourceWithParent('child', 'parent')],
        collapsedResourceIds: new Set(['parent']),
      });
      expect(vm.rows.map((row) => row.key)).toEqual(['r:parent']);
      expect(vm.rows[0]?.collapsed).toBe(true);
    });

    it('祖父母を折りたたむと、親・子の 2 段下まで rows から除外される', () => {
      const vm = build({
        resources: [
          resourceWithParent('grandparent'),
          resourceWithParent('parent', 'grandparent'),
          resourceWithParent('child', 'parent'),
        ],
        collapsedResourceIds: new Set(['grandparent']),
      });
      expect(vm.rows.map((row) => row.key)).toEqual(['r:grandparent']);
    });

    it('折りたたみで非表示になった行の帯は rows に含まれず、isEmpty の判定にも影響する', () => {
      const vm = build({
        resources: [resourceWithParent('parent'), resourceWithParent('child', 'parent')],
        collapsedResourceIds: new Set(['parent']),
        unassignedLane: 'auto',
      });
      expect(vm.isEmpty).toBe(false);
      expect(vm.rows).toHaveLength(1);
    });

    it('未割り当て行は常に depth=0・hasChildren=false・collapsed=false になる', () => {
      const vm = build({
        resources: [resourceWithParent('parent'), resourceWithParent('child', 'parent')],
        occurrences: [
          makeOccurrence({ start: at('2026-07-10T10:00'), end: at('2026-07-10T11:00') }),
        ],
        unassignedLane: 'always',
      });
      const unassigned = vm.rows.find((row) => row.key === 'unassigned');
      expect(unassigned?.depth).toBe(0);
      expect(unassigned?.hasChildren).toBe(false);
      expect(unassigned?.collapsed).toBe(false);
    });
  });
});
