/**
 * timeline-view.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' を明示して行う。
 */
import { describe, expect, it } from 'vitest';
import { parseDateValue } from '../timezone';
import type { CalendarEvent, CalendarResource, EventOccurrence, TimeZoneId } from '../types';
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
  currentDate?: Date;
  now?: Date;
  timeZone?: TimeZoneId;
}) {
  return buildTimelineViewModel({
    currentDate: params.currentDate ?? at('2026-07-10T09:00'),
    timeZone: params.timeZone ?? TOKYO,
    occurrences: params.occurrences ?? [],
    resources: params.resources ?? [],
    unassignedLane: params.unassignedLane ?? 'auto',
    timelineDays: params.timelineDays ?? 3,
    slotMinutes: params.slotMinutes ?? 60,
    now: params.now ?? at('2026-07-10T10:30'),
  });
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
});
