import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import type { BusinessHoursRule, CalendarEvent, CalendarResource, CalendarViewType } from './types';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** 固定時刻・東京 TZ のカレンダーを作るヘルパ。 */
function makeCalendar(overrides?: Parameters<typeof createCalendar>[0]) {
  return createCalendar({
    timeZone: 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    ...overrides,
  });
}

/** テスト用の単発イベント。 */
const MEETING: CalendarEvent = {
  id: 'meeting',
  title: '会議',
  start: '2026-07-15T10:00',
  end: '2026-07-15T11:00',
};

/** テスト用の繰り返しイベント（毎日 9:00、東京）。 */
const DAILY: CalendarEvent = {
  id: 'daily',
  title: '朝会',
  start: '2026-07-01T09:00',
  end: '2026-07-01T09:30',
  rrule: 'FREQ=DAILY',
  timeZone: 'Asia/Tokyo',
};

/** テスト用のリソース。 */
const ROOM: CalendarResource = { id: 'room-1', title: '会議室A' };

describe('createCalendar', () => {
  describe('初期状態', () => {
    it('既定値が適用される（ビュー month・オプション解決済み）', () => {
      const calendar = makeCalendar();
      const state = calendar.getState();
      expect(state.view).toBe('month');
      expect(state.timeZone).toBe('Asia/Tokyo');
      expect(state.events).toEqual([]);
      expect(state.dragPreview).toBeNull();
      expect(state.options).toMatchObject({
        weekStartsOn: 0,
        dayMaxEvents: 4,
        snapMinutes: 15,
        slotMinutes: 60,
        defaultEventMinutes: 60,
        listDays: 30,
        locale: 'ja',
        hiddenWeekdays: [],
      });
    });

    it('initialView / initialDate / events が反映される', () => {
      const calendar = makeCalendar({ initialView: 'week', events: [MEETING] });
      expect(calendar.getState().view).toBe('week');
      expect(calendar.getEvents()).toEqual([MEETING]);
    });

    it('壊れた表示を作る数値オプション（0・負値・小数）は正の整数へ正規化される', () => {
      const calendar = makeCalendar({
        slotMinutes: 0,
        snapMinutes: -5,
        listDays: 0,
        defaultEventMinutes: 0,
        dayMaxEvents: 0,
      });
      const { options } = calendar.getState();
      expect(options.slotMinutes).toBe(1);
      expect(options.snapMinutes).toBe(1);
      expect(options.listDays).toBe(1);
      expect(options.defaultEventMinutes).toBe(1);
      expect(options.dayMaxEvents).toBe(1);
    });

    it('数値オプションの小数は切り捨てられる', () => {
      const calendar = makeCalendar({ slotMinutes: 30.9, listDays: 7.5 });
      expect(calendar.getState().options.slotMinutes).toBe(30);
      expect(calendar.getState().options.listDays).toBe(7);
    });

    it('updateOptions 経由でも数値オプションが正規化される', () => {
      const calendar = makeCalendar();
      calendar.updateOptions({ slotMinutes: 0 });
      expect(calendar.getState().options.slotMinutes).toBe(1);
    });

    it('timeZone 省略時はローカルタイムゾーンになる', () => {
      const calendar = createCalendar({ now: () => NOW });
      // テストは TZ=Asia/Tokyo で実行される（vitest.config.ts）
      expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
    });

    it('不正な timeZone は Error になる', () => {
      expect(() => createCalendar({ timeZone: 'Invalid/Zone' })).toThrow();
    });

    it('timeAxisZones 省略時は既定で空配列になり、不正なタイムゾーンを含むと Error になる', () => {
      const calendar = makeCalendar();
      expect(calendar.getState().options.timeAxisZones).toEqual([]);
      expect(() =>
        createCalendar({ timeZone: 'Asia/Tokyo', timeAxisZones: ['Invalid/Zone'] }),
      ).toThrow();
    });

    it('showWeekNumbers / businessHours は省略時にそれぞれ false / 空配列になる', () => {
      const calendar = makeCalendar();
      expect(calendar.getState().options.showWeekNumbers).toBe(false);
      expect(calendar.getState().options.businessHours).toEqual([]);
    });

    it('businessHours の startTime が endTime 以降だと Error になる', () => {
      expect(() =>
        createCalendar({
          timeZone: 'Asia/Tokyo',
          businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '17:00', endTime: '09:00' }],
        }),
      ).toThrow();
    });

    it("businessHours の時刻が 'HH:mm' 形式でないと Error になる", () => {
      expect(() =>
        createCalendar({
          timeZone: 'Asia/Tokyo',
          businessHours: [{ daysOfWeek: [1], startTime: '9:00', endTime: '17:00' }],
        }),
      ).toThrow();
    });

    it("businessHours の endTime には日の終端を表す '24:00' を指定できる", () => {
      const calendar = makeCalendar({
        businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '24:00' }],
      });
      expect(calendar.getState().options.businessHours[0]?.endTime).toBe('24:00');
    });

    it("businessHours の startTime に '24:00' を指定すると Error になる（'24:00' は endTime 専用）", () => {
      expect(() =>
        createCalendar({
          timeZone: 'Asia/Tokyo',
          businessHours: [{ daysOfWeek: [1], startTime: '24:00', endTime: '24:00' }],
        }),
      ).toThrow();
    });

    it("businessHours の endTime の '24:00' 超（'24:01' など）は Error になる", () => {
      expect(() =>
        createCalendar({
          timeZone: 'Asia/Tokyo',
          businessHours: [{ daysOfWeek: [1], startTime: '09:00', endTime: '24:01' }],
        }),
      ).toThrow();
    });

    it('eventOverlap / eventConstraint は省略時にそれぞれ true / null になる', () => {
      const calendar = makeCalendar();
      expect(calendar.getState().options.eventOverlap).toBe(true);
      expect(calendar.getState().options.eventConstraint).toBeNull();
    });

    it("eventConstraint に 'businessHours' を指定できる", () => {
      const calendar = makeCalendar({ eventConstraint: 'businessHours' });
      expect(calendar.getState().options.eventConstraint).toBe('businessHours');
    });

    it('eventConstraint に配列を指定できる（businessHours とは独立）', () => {
      const rules: BusinessHoursRule[] = [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
      ];
      const calendar = makeCalendar({ eventConstraint: rules });
      expect(calendar.getState().options.eventConstraint).toEqual(rules);
    });

    it('eventConstraint 配列の startTime が endTime 以降だと Error になる（businessHours と同じ検証）', () => {
      expect(() =>
        createCalendar({
          timeZone: 'Asia/Tokyo',
          eventConstraint: [{ daysOfWeek: [1], startTime: '18:00', endTime: '09:00' }],
        }),
      ).toThrow();
    });

    it("eventConstraint 配列の endTime にも '24:00' を指定できる（businessHours と同じ検証）", () => {
      const calendar = makeCalendar({
        eventConstraint: [{ daysOfWeek: [1], startTime: '18:00', endTime: '24:00' }],
      });
      expect(calendar.getState().options.eventConstraint).toEqual([
        { daysOfWeek: [1], startTime: '18:00', endTime: '24:00' },
      ]);
    });

    it('slotMinTime/slotMaxTime は省略時に既定 00:00/24:00 になる', () => {
      const calendar = makeCalendar();
      expect(calendar.getState().options.slotMinTime).toBe('00:00');
      expect(calendar.getState().options.slotMaxTime).toBe('24:00');
    });

    it('slotMinTime が slotMaxTime 以降だと Error になる', () => {
      expect(() =>
        createCalendar({ timeZone: 'Asia/Tokyo', slotMinTime: '20:00', slotMaxTime: '08:00' }),
      ).toThrow();
      expect(() =>
        createCalendar({ timeZone: 'Asia/Tokyo', slotMinTime: '09:00', slotMaxTime: '09:00' }),
      ).toThrow();
    });

    it("slotMinTime/slotMaxTime が 'HH:mm' 形式でないと Error になる（slotMaxTime の '24:00' 特例を除く）", () => {
      expect(() => createCalendar({ timeZone: 'Asia/Tokyo', slotMinTime: '9:00' })).toThrow();
      expect(() => createCalendar({ timeZone: 'Asia/Tokyo', slotMaxTime: '24:30' })).toThrow();
      expect(() => createCalendar({ timeZone: 'Asia/Tokyo', slotMinTime: '24:00' })).toThrow(); // 文字列としては解析できるが start(1440) >= end で無効
    });

    it("slotMaxTime: '24:00' は特例で許可される", () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        slotMinTime: '08:00',
        slotMaxTime: '24:00',
      });
      expect(calendar.getState().options.slotMaxTime).toBe('24:00');
    });

    it('now 省略時の既定値は呼び出すと現在時刻に近い Date を返す関数になる', () => {
      const before = Date.now();
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      const { now } = calendar.getState().options;
      expect(typeof now).toBe('function');
      const evaluated = now().getTime();
      const after = Date.now();
      // 実行時刻の前後 1 秒以内（now() 呼び出しは同期的に行われるため十分な余裕）。
      expect(evaluated).toBeGreaterThanOrEqual(before - 1000);
      expect(evaluated).toBeLessThanOrEqual(after + 1000);
    });

    it('now を省略すると実行時の現在時刻（new Date()）が使われる', () => {
      const systemNow = new Date('2026-07-07T00:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(systemNow);
      try {
        const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
        calendar.today();
        expect(calendar.getState().currentDate.getTime()).toBe(systemNow.getTime());
      } finally {
        vi.useRealTimers();
      }
    });

    it('initialDate 省略時は現在時刻になる', () => {
      const before = Date.now();
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      const after = Date.now();
      const currentDate = calendar.getState().currentDate.getTime();
      expect(currentDate).toBeGreaterThanOrEqual(before - 1000);
      expect(currentDate).toBeLessThanOrEqual(after + 1000);
    });

    it('resources は ResolvedCalendarOptions に含まれない', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        resources: [{ id: 'r1', title: '会議室' }],
      });
      expect('resources' in calendar.getState().options).toBe(false);
    });

    it('hiddenWeekdays に 7 曜日すべてを指定すると無効な設定として無視され、既定の空配列にフォールバックする', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });
      expect(calendar.getState().options.hiddenWeekdays).toEqual([]);
    });
  });

  describe('購読と状態スナップショット', () => {
    it('状態が変わるとリスナーが呼ばれ、解除後は呼ばれない', () => {
      const calendar = makeCalendar();
      const listener = vi.fn();
      const unsubscribe = calendar.subscribe(listener);
      calendar.setView('day');
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      calendar.setView('week');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('getState は状態が変わらない限り同一参照を返す', () => {
      const calendar = makeCalendar();
      const a = calendar.getState();
      const b = calendar.getState();
      expect(a).toBe(b);
      calendar.setView('week');
      expect(calendar.getState()).not.toBe(a);
      expect(calendar.getState().view).toBe('week');
    });

    it('値が変わらない設定操作では通知されず getState の参照も維持される', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      calendar.setView('month'); // 既に month
      calendar.setTimeZone('Asia/Tokyo'); // 既に Asia/Tokyo
      calendar.goTo(new Date(NOW.getTime())); // 同じ日時（別インスタンス）
      calendar.setEvents(calendar.getEvents()); // 同一配列参照
      calendar.setDragPreview(null); // 既に null
      calendar.updateOptions({}); // 空パッチ
      calendar.updateOptions({ dayMaxEvents: 4, locale: 'ja' }); // 既定値と同じ
      calendar.updateOptions({ eventOverlap: true }); // 既定値と同じ
      calendar.updateOptions({ timelineScale: 'hour' }); // 既定値と同じ

      expect(listener).not.toHaveBeenCalled();
      expect(calendar.getState()).toBe(before);
    });

    it('eventConstraint が同一内容（配列の中身が同じ）なら通知されない', () => {
      const rules: BusinessHoursRule[] = [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
      ];
      const calendar = makeCalendar({ eventConstraint: rules });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      calendar.updateOptions({
        eventConstraint: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
      });

      expect(listener).not.toHaveBeenCalled();
      expect(calendar.getState()).toBe(before);
    });

    it('値が実際に変わる設定操作では従来どおり通知される', () => {
      const calendar = makeCalendar();
      const listener = vi.fn();
      calendar.subscribe(listener);

      calendar.setTimeZone('America/New_York');
      calendar.updateOptions({ dayMaxEvents: 2 });
      calendar.setEvents([MEETING]);

      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('refresh はビューモデルを再構築して通知する（now の再評価）', () => {
      let current = new Date('2026-07-15T01:00:00Z'); // 東京 7/15 10:00
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'week',
        now: () => current,
      });
      const listener = vi.fn();
      calendar.subscribe(listener);

      const vmBefore = calendar.getViewModel();
      if (vmBefore.type !== 'timeGrid') throw new Error('unreachable');
      expect(vmBefore.nowIndicator?.minutes).toBe(600); // 10:00

      current = new Date('2026-07-15T02:30:00Z'); // 東京 11:30 に進める
      calendar.refresh();

      expect(listener).toHaveBeenCalledTimes(1);
      const vmAfter = calendar.getViewModel();
      if (vmAfter.type !== 'timeGrid') throw new Error('unreachable');
      expect(vmAfter.nowIndicator?.minutes).toBe(690); // 11:30
    });
  });

  describe('ナビゲーション', () => {
    it('setView でビューが切り替わる', () => {
      const calendar = makeCalendar();
      calendar.setView('list');
      expect(calendar.getState().view).toBe('list');
    });

    it('setView に未知のビュー名を渡すと Error になり、状態は変わらない', () => {
      // JS からの呼び出しなど型チェックを経ない不正値は、後続の getViewModel() で
      // 原因の分かりにくい TypeError になる前に、渡した時点で失敗させる
      const calendar = makeCalendar();
      // 'as' 使用理由: 型上あり得ない不正値を意図的に渡すテストのため
      expect(() => calendar.setView('agenda' as CalendarViewType)).toThrow(/agenda/);
      expect(calendar.getState().view).toBe('month');
      expect(() => calendar.getViewModel()).not.toThrow();
    });

    it('initialView に未知のビュー名を渡すと作成時に Error になる', () => {
      // 'as' 使用理由: 同上（型を欺く不正値の防御を検証する）
      expect(() =>
        createCalendar({ initialView: 'agenda' as CalendarViewType, now: () => NOW }),
      ).toThrow(/agenda/);
    });

    it('next / prev は月ビューで前後の月に移動する', () => {
      const calendar = makeCalendar();
      calendar.next();
      expect(calendar.getViewModel()).toMatchObject({ type: 'month' });
      // 8 月の月初を含む
      const vm = calendar.getViewModel();
      if (vm.type !== 'month') throw new Error('unreachable');
      expect(vm.weeks.flatMap((w) => w.days).some((d) => d.key === '2026-08-01')).toBe(true);
      calendar.prev();
      calendar.prev();
      const vm2 = calendar.getViewModel();
      if (vm2.type !== 'month') throw new Error('unreachable');
      expect(vm2.weeks.flatMap((w) => w.days).some((d) => d.key === '2026-06-15')).toBe(true);
    });

    describe('next / prev の移動幅はビューごとに異なる', () => {
      const START = new Date('2026-07-15T00:00:00+09:00');

      it('month ビューの next() は 1 ヶ月分（月初基準）進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'month',
          initialDate: START,
        });
        calendar.next();
        expect(calendar.getState().currentDate.toISOString()).toBe('2026-07-31T15:00:00.000Z'); // 東京 8/1 0:00
      });

      it('week ビューの next() は 7 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'week',
          initialDate: START,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(7 * 24 * 60 * 60 * 1000);
      });

      it('day ビューの next() は 1 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'day',
          initialDate: START,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(24 * 60 * 60 * 1000);
      });

      it('list ビューの next() は listDays 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'list',
          initialDate: START,
          listDays: 10,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(10 * 24 * 60 * 60 * 1000);
      });

      it('year ビューの next() は 1 年分（年初基準）進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'year',
          initialDate: START,
        });
        calendar.next();
        expect(calendar.getState().currentDate.toISOString()).toBe('2026-12-31T15:00:00.000Z'); // 東京 2027-01-01 0:00
      });

      it('multiMonth ビューの next() は multiMonthCount ヶ月分（月初基準）進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'multiMonth',
          initialDate: START,
          multiMonthCount: 2,
        });
        calendar.next();
        expect(calendar.getState().currentDate.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // 東京 9/1 0:00
      });

      it('resource ビューの next() は day ビューと同じく 1 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'resource',
          initialDate: START,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(24 * 60 * 60 * 1000);
      });

      it('resource ビューの next() は resourceViewDays 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'resource',
          initialDate: START,
          resourceViewDays: 3,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(3 * 24 * 60 * 60 * 1000);
      });

      it('timeline ビューの next() は timelineDays 日進む', () => {
        const calendar = createCalendar({
          timeZone: 'Asia/Tokyo',
          initialView: 'timeline',
          initialDate: START,
          timelineDays: 5,
        });
        const before = calendar.getState().currentDate.getTime();
        calendar.next();
        expect(calendar.getState().currentDate.getTime() - before).toBe(5 * 24 * 60 * 60 * 1000);
      });
    });

    it('today で現在日時（now）に戻る', () => {
      const calendar = makeCalendar();
      calendar.next();
      calendar.today();
      expect(calendar.getState().currentDate.getTime()).toBe(NOW.getTime());
    });

    it('goTo で指定日に移動し、無効な日付は Error になる', () => {
      const calendar = makeCalendar();
      const target = new Date('2026-12-01T00:00:00Z');
      calendar.goTo(target);
      expect(calendar.getState().currentDate.getTime()).toBe(target.getTime());
      expect(() => calendar.goTo(new Date(Number.NaN))).toThrow();
    });

    it('setTimeZone で表示タイムゾーンが変わり、不正な値は Error になる', () => {
      const calendar = makeCalendar();
      calendar.setTimeZone('America/New_York');
      expect(calendar.getState().timeZone).toBe('America/New_York');
      expect(() => calendar.setTimeZone('Invalid/Zone')).toThrow();
    });

    it('updateOptions でオプションを部分更新できる', () => {
      const calendar = makeCalendar();
      calendar.updateOptions({ dayMaxEvents: 2, snapMinutes: 30 });
      expect(calendar.getState().options.dayMaxEvents).toBe(2);
      expect(calendar.getState().options.snapMinutes).toBe(30);
      // 未指定のオプションは維持される
      expect(calendar.getState().options.slotMinutes).toBe(60);
    });

    it('updateOptions({ eventConstraint: null }) で配置制約を解除できる', () => {
      const calendar = makeCalendar({ eventConstraint: 'businessHours' });
      expect(calendar.getState().options.eventConstraint).toBe('businessHours');
      calendar.updateOptions({ eventConstraint: null });
      expect(calendar.getState().options.eventConstraint).toBeNull();
      // 省略した場合は「変更しない」（null クリア後もそのまま）
      calendar.updateOptions({ dayMaxEvents: 2 });
      expect(calendar.getState().options.eventConstraint).toBeNull();
    });

    it('updateOptions({ events }) でイベント一覧を差し替えられる（onEventsChange は呼ばれない）', () => {
      const onEventsChange = vi.fn();
      const calendar = makeCalendar({ onEventsChange });
      calendar.updateOptions({ events: [MEETING] });
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(onEventsChange).not.toHaveBeenCalled();
    });

    it('updateOptions({ onEventsChange }) でコールバックを差し替えられる', () => {
      const first = vi.fn();
      const second = vi.fn();
      const calendar = makeCalendar({ onEventsChange: first });
      calendar.updateOptions({ onEventsChange: second });
      calendar.createEvent({ title: '追加', start: '2026-07-15T13:00' });
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('updateOptions({ timeZone }) は表示タイムゾーンを変更し、不正な値は Error になる', () => {
      const calendar = makeCalendar();
      calendar.updateOptions({ timeZone: 'America/New_York' });
      expect(calendar.getState().timeZone).toBe('America/New_York');
      expect(() => calendar.updateOptions({ timeZone: 'Invalid/Zone' })).toThrow();
    });

    it('updateOptions は不正な timeAxisZones を含むパッチ全体を原子的に拒否する（他フィールドも巻き戻る）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      expect(() =>
        calendar.updateOptions({
          timeZone: 'America/New_York',
          events: [],
          resources: [ROOM],
          timeAxisZones: ['Invalid/Zone'],
        }),
      ).toThrow();

      // バリデーション失敗時は timeZone/events/resources も一切変更されず、通知もされない
      expect(calendar.getState()).toBe(before);
      expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(calendar.getResources()).toEqual([]);
      expect(listener).not.toHaveBeenCalled();
    });

    it('updateOptions は不正な businessHours を含むパッチ全体を原子的に拒否する（他フィールドも巻き戻る）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      expect(() =>
        calendar.updateOptions({
          timeZone: 'America/New_York',
          events: [],
          businessHours: [{ daysOfWeek: [1], startTime: '17:00', endTime: '09:00' }],
        }),
      ).toThrow();

      expect(calendar.getState()).toBe(before);
      expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(listener).not.toHaveBeenCalled();
    });

    it('updateOptions({ eventOverlap, eventConstraint }) で反映される', () => {
      const calendar = makeCalendar();
      calendar.updateOptions({ eventOverlap: false, eventConstraint: 'businessHours' });
      expect(calendar.getState().options.eventOverlap).toBe(false);
      expect(calendar.getState().options.eventConstraint).toBe('businessHours');
    });

    it('updateOptions は不正な eventConstraint 配列を含むパッチ全体を原子的に拒否する（他フィールドも巻き戻る）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      expect(() =>
        calendar.updateOptions({
          timeZone: 'America/New_York',
          events: [],
          eventConstraint: [{ daysOfWeek: [1], startTime: '18:00', endTime: '09:00' }],
        }),
      ).toThrow();

      expect(calendar.getState()).toBe(before);
      expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(listener).not.toHaveBeenCalled();
    });

    it('updateOptions は不正な slotMinTime/slotMaxTime を含むパッチ全体を原子的に拒否する（他フィールドも巻き戻る）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      const before = calendar.getState();

      expect(() =>
        calendar.updateOptions({
          timeZone: 'America/New_York',
          events: [],
          slotMinTime: '20:00',
          slotMaxTime: '08:00',
        }),
      ).toThrow();

      expect(calendar.getState()).toBe(before);
      expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('イベント CRUD', () => {
    it('createEvent は id を自動採番し、既存 id と衝突しない', () => {
      const calendar = makeCalendar({
        events: [{ id: 'koyomi-1', title: '既存', start: '2026-07-15T09:00' }],
      });
      const created = calendar.createEvent({ title: '新規', start: '2026-07-15T13:00' });
      expect(created.id).not.toBe('koyomi-1');
      expect(calendar.getEvents()).toHaveLength(2);
      expect(calendar.getEvents().some((e) => e.id === created.id)).toBe(true);
    });

    it('イベント変更で onEventsChange が呼ばれる', () => {
      const onEventsChange = vi.fn();
      const calendar = makeCalendar({ onEventsChange });
      const created = calendar.createEvent({ title: 'a', start: '2026-07-15T13:00' });
      expect(onEventsChange).toHaveBeenCalledTimes(1);
      calendar.updateEvent(created.id, { title: 'b' });
      expect(onEventsChange).toHaveBeenCalledTimes(2);
      calendar.deleteEvent(created.id);
      expect(onEventsChange).toHaveBeenCalledTimes(3);
      expect(calendar.getEvents()).toEqual([]);
    });

    it('updateEvent / deleteEvent は影響を受けたイベントの before/after 一覧を返す（undo 基盤）', () => {
      const calendar = makeCalendar();
      const created = calendar.createEvent({ title: 'a', start: '2026-07-15T13:00' });

      const updateChanges = calendar.updateEvent(created.id, { title: 'b' });
      expect(updateChanges).toEqual([
        { before: created, after: { ...created, title: 'b' }, index: 0 },
      ]);

      const deleteChanges = calendar.deleteEvent(created.id);
      expect(deleteChanges).toEqual([{ before: { ...created, title: 'b' }, index: 0 }]);
      expect(calendar.getEvents()).toEqual([]);
    });

    it('setEvents は一覧を置き換えるが onEventsChange は呼ばない', () => {
      const onEventsChange = vi.fn();
      const calendar = makeCalendar({ onEventsChange });
      calendar.setEvents([MEETING]);
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(onEventsChange).not.toHaveBeenCalled();
    });

    it('繰り返しの「この予定のみ」更新でオーバーライドがオカレンスに反映される', () => {
      const calendar = makeCalendar({ events: [DAILY] });
      // 7/15 9:00 JST のオカレンスを 14:00 に移動
      const occurrenceStart = new Date('2026-07-15T00:00:00Z');
      calendar.updateEvent(
        'daily',
        { start: new Date('2026-07-15T05:00:00Z'), end: new Date('2026-07-15T05:30:00Z') },
        { occurrenceStart, scope: 'this' },
      );
      const range = {
        start: new Date('2026-07-14T15:00:00Z'), // 東京 7/15 0:00
        end: new Date('2026-07-15T15:00:00Z'), // 東京 7/16 0:00
      };
      const occurrences = calendar.getOccurrences(range);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]?.start.toISOString()).toBe('2026-07-15T05:00:00.000Z');
      // 元イベントは 2 件になっている（マスター＋オーバーライド）
      expect(calendar.getEvents()).toHaveLength(2);
    });

    it('繰り返しの「これ以降」削除で以降のオカレンスが消える', () => {
      const calendar = makeCalendar({ events: [DAILY] });
      calendar.deleteEvent('daily', {
        occurrenceStart: new Date('2026-07-15T00:00:00Z'),
        scope: 'thisAndFollowing',
      });
      const occurrences = calendar.getOccurrences({
        start: new Date('2026-07-01T00:00:00Z'),
        end: new Date('2026-07-31T00:00:00Z'),
      });
      const last = occurrences.at(-1);
      expect(last?.start.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    });

    it('新規カレンダーで id を省略して作成すると最初の呼び出しは koyomi-1 になる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      const created = calendar.createEvent({ title: '新しい予定', start: '2026-07-01T10:00:00' });
      expect(created.id).toBe('koyomi-1');
    });

    it('id を省略して 2 回作成すると koyomi-1・koyomi-2 と連番になる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      const first = calendar.createEvent({ title: 'A', start: '2026-07-01T10:00:00' });
      const second = calendar.createEvent({ title: 'B', start: '2026-07-02T10:00:00' });
      expect(first.id).toBe('koyomi-1');
      expect(second.id).toBe('koyomi-2');
    });

    it('既存イベントと重複する id を指定して createEvent を呼ぶと Error を投げる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        events: [{ id: 'dup', title: '既存', start: '2026-07-01T09:00:00' }],
      });
      expect(() =>
        calendar.createEvent({ id: 'dup', title: '新規', start: '2026-07-02T09:00:00' }),
      ).toThrow();
    });

    it('rrule に DTSTART を書かなくても CalendarEvent.start が起点として使われる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
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
      expect(occurrences.map((o) => o.start.toISOString())).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z',
        '2026-07-03T00:00:00.000Z',
      ]);
    });

    it('createEvent に不正な RRULE を渡すと例外が投げられる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      expect(() =>
        calendar.createEvent({ title: '不正な例', start: '2026-07-01T09:00:00', rrule: 'FOO=BAR' }),
      ).toThrow(/不正な RRULE/);
    });

    it('override.start には patch した値がそのまま入り（型変換されない）、originalStart は本来の開始時刻になる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
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

    it('単発イベントの updateEvent に target を明示的に渡しても、無視されて patch がそのまま適用される', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
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
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      calendar.createEvent({ id: 'single', title: '単発予定', start: '2026-07-01T09:00:00' });
      calendar.deleteEvent('single', {
        occurrenceStart: new Date('2026-07-05T00:00:00Z'),
        scope: 'all',
      });
      expect(calendar.getEvents()).toHaveLength(0);
    });

    it('既にオーバーライド済みのオカレンスの『移動後の現在の開始時刻』を occurrenceStart に渡すと、既存のオーバーライドは変更されず新しいオーバーライドが作られる', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
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

    it('一致するオカレンスが無い occurrenceStart で deleteEvent(scope: this) を呼ぶと、その値がそのまま exdates に追加される', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
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

    it('editable: false のイベントに updateEvent を直接呼んでも通常どおり更新される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        events: [
          { id: 'locked', title: '固定予定', start: '2026-07-01T10:00:00', editable: false },
        ],
      });
      calendar.updateEvent('locked', { title: '更新後' });
      expect(calendar.getEvents()[0]?.title).toBe('更新後');
    });

    it('editable: false のイベントに deleteEvent を直接呼んでも通常どおり削除される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        events: [
          { id: 'locked', title: '固定予定', start: '2026-07-01T10:00:00', editable: false },
        ],
      });
      calendar.deleteEvent('locked');
      expect(calendar.getEvents()).toHaveLength(0);
    });

    it('start >= end のイベントは Error にならず保存されるが、getOccurrences には含まれない', () => {
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
      const created = calendar.createEvent({
        id: 'inverted',
        title: '不正な範囲',
        start: '2026-07-01T10:00:00',
        end: '2026-07-01T09:00:00',
      });
      expect(calendar.getEvents()).toContainEqual(created);

      const occurrences = calendar.getOccurrences({
        start: new Date('2026-06-25T00:00:00Z'),
        end: new Date('2026-07-10T00:00:00Z'),
      });
      expect(occurrences.some((o) => o.eventId === 'inverted')).toBe(false);
    });

    it('update + delete が混在する操作後も、changes を逆再生すれば操作前の状態に完全復元できる', () => {
      const initialEvents: readonly CalendarEvent[] = [
        { id: 'a', title: 'A', start: '2026-07-01T10:00:00' },
        { id: 'b', title: 'B', start: '2026-07-02T10:00:00' },
      ];
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo', events: initialEvents });

      const updateChanges = calendar.updateEvent('a', { title: 'A（更新）' });
      const deleteChanges = calendar.deleteEvent('b');

      // 操作後の状態は初期状態と異なる
      expect(calendar.getEvents()).not.toEqual(initialEvents);

      // changes を新しい順に逆再生して復元する（before/after の集合から state を再構築する）
      const byId = new Map(calendar.getEvents().map((event) => [event.id, event]));
      for (const change of [...deleteChanges, ...updateChanges]) {
        if (change.after !== undefined) {
          byId.delete(change.after.id);
        }
      }
      for (const change of [...deleteChanges, ...updateChanges]) {
        if (change.before !== undefined) {
          byId.set(change.before.id, change.before);
        }
      }
      calendar.setEvents([...byId.values()]);

      const restored = [...calendar.getEvents()].sort((x, y) => x.id.localeCompare(y.id));
      const expected = [...initialEvents].sort((x, y) => x.id.localeCompare(y.id));
      expect(restored).toEqual(expected);
    });

    it('無変化な patch（空パッチ・既存値と同じ値のパッチ）を渡すと changes は空になる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        events: [{ id: 'e1', title: '会議', start: '2026-07-01T10:00:00' }],
      });
      expect(calendar.updateEvent('e1', {})).toHaveLength(0);
      expect(calendar.updateEvent('e1', { title: '会議' })).toHaveLength(0);
    });

    it('exdates を並び替えただけの patch は無変化として扱われ changes は空になる', () => {
      const a = new Date('2026-07-02T00:00:00Z');
      const b = new Date('2026-07-03T00:00:00Z');
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        events: [
          {
            id: 'e1',
            title: '定例',
            start: '2026-07-01T09:00:00',
            rrule: 'FREQ=DAILY;COUNT=5',
            exdates: [a, b],
          },
        ],
      });
      // 並び順だけが異なる（集合としては同一の）exdates を渡す
      expect(calendar.updateEvent('e1', { exdates: [b, a] })).toHaveLength(0);
    });

    it('非終日イベントの timeZone 省略時、オフセットなし文字列は表示タイムゾーンの現地時刻として解釈される', () => {
      const event: CalendarEvent = {
        id: 'no-tz',
        title: 'タイムゾーン省略イベント',
        start: '2026-07-01T10:00',
        end: '2026-07-01T11:00',
      };

      const tokyoCalendar = createCalendar({ timeZone: 'Asia/Tokyo', events: [event] });
      const nyCalendar = createCalendar({ timeZone: 'America/New_York', events: [event] });

      const range = {
        start: new Date('2026-07-01T00:00:00Z'),
        end: new Date('2026-07-02T00:00:00Z'),
      };
      const [tokyoOcc] = tokyoCalendar.getOccurrences(range);
      const [nyOcc] = nyCalendar.getOccurrences(range);

      // 東京 10:00 = UTC 01:00（JST は UTC+9、DST なし）
      expect(tokyoOcc?.start.toISOString()).toBe('2026-07-01T01:00:00.000Z');
      // NY 10:00 = UTC 14:00（2026-07-01 は夏時間中で EDT = UTC-4）
      expect(nyOcc?.start.toISOString()).toBe('2026-07-01T14:00:00.000Z');
    });
  });

  describe('リソース', () => {
    it('resources 初期値は省略時 []、指定時はその配列が反映される', () => {
      const withoutResources = makeCalendar();
      expect(withoutResources.getResources()).toEqual([]);
      expect(withoutResources.getState().resources).toEqual([]);

      const withResources = makeCalendar({ resources: [ROOM] });
      expect(withResources.getResources()).toEqual([ROOM]);
      expect(withResources.getState().resources).toEqual([ROOM]);
    });

    it('setResources は一覧を置き換える', () => {
      const calendar = makeCalendar();
      calendar.setResources([ROOM]);
      expect(calendar.getResources()).toEqual([ROOM]);
    });

    it('setResources は同一参照を渡しても通知されない（events と同じ参照比較）', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      calendar.setResources(calendar.getResources());
      expect(listener).not.toHaveBeenCalled();
    });

    it('setResources は内容が同じでも異なる配列参照を渡せば通知される', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      calendar.setResources([{ ...ROOM }]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(calendar.getResources()).toEqual([ROOM]);
    });

    it('updateOptions({ resources }) でリソース一覧を差し替えられる', () => {
      const calendar = makeCalendar();
      const listener = vi.fn();
      calendar.subscribe(listener);
      calendar.updateOptions({ resources: [ROOM] });
      expect(calendar.getResources()).toEqual([ROOM]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('updateOptions({ resources }) に同一参照を渡しても通知されない', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      const listener = vi.fn();
      calendar.subscribe(listener);
      calendar.updateOptions({ resources: calendar.getResources() });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('ビューモデル', () => {
    it('ビューに応じた型のビューモデルを返す', () => {
      const calendar = makeCalendar();
      expect(calendar.getViewModel().type).toBe('month');
      calendar.setView('week');
      const week = calendar.getViewModel();
      expect(week).toMatchObject({ type: 'timeGrid', viewType: 'week' });
      if (week.type !== 'timeGrid') throw new Error('unreachable');
      expect(week.days).toHaveLength(7);
      calendar.setView('day');
      const day = calendar.getViewModel();
      expect(day).toMatchObject({ type: 'timeGrid', viewType: 'day' });
      if (day.type !== 'timeGrid') throw new Error('unreachable');
      expect(day.days).toHaveLength(1);
      calendar.setView('list');
      expect(calendar.getViewModel().type).toBe('list');
    });

    it('timeAxisZones を指定すると週/日ビューの timeAxes に追加軸が反映される', () => {
      const calendar = makeCalendar({
        initialView: 'week',
        timeAxisZones: ['America/New_York'],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeGrid') throw new Error('unreachable');
      expect(vm.timeAxes.map((axis) => axis.timeZone)).toEqual(['Asia/Tokyo', 'America/New_York']);

      calendar.updateOptions({ timeAxisZones: [] });
      const vmAfter = calendar.getViewModel();
      if (vmAfter.type !== 'timeGrid') throw new Error('unreachable');
      expect(vmAfter.timeAxes).toHaveLength(1);
    });

    it('showWeekNumbers 省略時は月・週ビューとも weekNumber が null（従来どおりの出力）', () => {
      const calendar = makeCalendar({ initialView: 'month' });
      const monthVm = calendar.getViewModel();
      if (monthVm.type !== 'month') throw new Error('unreachable');
      expect(monthVm.weeks.every((week) => week.weekNumber === null)).toBe(true);

      calendar.setView('week');
      const weekVm = calendar.getViewModel();
      if (weekVm.type !== 'timeGrid') throw new Error('unreachable');
      expect(weekVm.weekNumber).toBeNull();
    });

    it('showWeekNumbers: true にすると月・週ビューの weekNumber に値が入る', () => {
      const calendar = makeCalendar({ initialView: 'month', showWeekNumbers: true });
      const monthVm = calendar.getViewModel();
      if (monthVm.type !== 'month') throw new Error('unreachable');
      expect(monthVm.weeks.some((week) => week.weekNumber !== null)).toBe(true);

      calendar.setView('week');
      const weekVm = calendar.getViewModel();
      if (weekVm.type !== 'timeGrid') throw new Error('unreachable');
      expect(weekVm.weekNumber).not.toBeNull();
    });

    it('複数月ビューは showWeekNumbers: true を指定しても各月グリッドの weekNumber が常に null になる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-07T12:00:00Z'),
        initialDate: new Date('2026-07-07T12:00:00Z'),
        initialView: 'multiMonth',
        showWeekNumbers: true,
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'multiMonth') throw new Error('unreachable');
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week.weekNumber).toBeNull();
        }
      }
    });

    it('月ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、全曜日が表示される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'month',
        hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'month') throw new Error('unreachable');
      expect(vm.weekdays).toHaveLength(7);
      for (const week of vm.weeks) {
        expect(week.days).toHaveLength(7);
      }
    });

    it('週ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、7 日とも表示される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'week',
        hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeGrid') throw new Error('unreachable');
      expect(vm.days).toHaveLength(7);
    });

    it('複数月ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、各月グリッドが全曜日表示になる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'multiMonth',
        hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'multiMonth') throw new Error('unreachable');
      expect(vm.weekdays).toHaveLength(7);
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week.days).toHaveLength(7);
        }
      }
    });

    it('年ビューは hiddenWeekdays を無視し、ミニ月グリッドは常に 7 列のままになる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'year',
        hiddenWeekdays: [0, 6],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'year') throw new Error('unreachable');
      expect(vm.weekdays).toHaveLength(7);
      for (const month of vm.months) {
        for (const week of month.weeks) {
          expect(week).toHaveLength(7);
        }
      }
    });

    it('リソースビューは hiddenWeekdays を無視し、非表示曜日へ goTo した日もそのまま表示日になる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'resource',
        hiddenWeekdays: [0, 6],
      });
      // 2026-07-04 は土曜（非表示曜日に指定されている）
      calendar.goTo(new Date('2026-07-03T15:00:00Z'));
      const vm = calendar.getViewModel();
      if (vm.type !== 'resource') throw new Error('unreachable');
      expect(vm.dateKey).toBe('2026-07-04');
    });

    it('resourceViewDays を指定するとリソースビューの表示日数・列数に反映される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'resource',
        resources: [{ id: 'r1', title: '会議室' }],
        resourceViewDays: 2,
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'resource') throw new Error('unreachable');
      expect(vm.days.map((day) => day.key)).toEqual(['2026-07-15', '2026-07-16']);
      expect(vm.columns.map((column) => column.key)).toEqual([
        'r:r1@2026-07-15',
        'r:r1@2026-07-16',
      ]);
      // 表示範囲もイベント展開と同じ 2 日分になる
      const range = calendar.getVisibleRange();
      expect(range.end.getTime() - range.start.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    });

    it('resourceViewDays を updateOptions で変更するとリソースビューの表示日数に反映され、0 以下は 1 へ正規化される', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'resource',
        resources: [{ id: 'r1', title: '会議室' }],
      });
      calendar.updateOptions({ resourceViewDays: 3 });
      const vm = calendar.getViewModel();
      if (vm.type !== 'resource') throw new Error('unreachable');
      expect(vm.days).toHaveLength(3);
      expect(calendar.getState().options.resourceViewDays).toBe(3);

      calendar.updateOptions({ resourceViewDays: 0 });
      expect(calendar.getState().options.resourceViewDays).toBe(1);
      const normalized = calendar.getViewModel();
      if (normalized.type !== 'resource') throw new Error('unreachable');
      expect(normalized.days).toHaveLength(1);
    });

    it('タイムラインビューは hiddenWeekdays を無視し、常に timelineDays 日の連続した並びになる', () => {
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-15T01:00:00Z'),
        initialDate: new Date('2026-07-15T01:00:00Z'),
        initialView: 'timeline',
        hiddenWeekdays: [0, 6],
        timelineDays: 3,
      });
      // 2026-07-04(土)〜2026-07-06(月) を表示日にする。土日が非表示曜日でも欠けずに並ぶ。
      calendar.goTo(new Date('2026-07-03T15:00:00Z'));
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.days.map((day) => day.key)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06']);
    });

    it('hiddenWeekdays はリストビューでは受け取れず、非表示曜日にしか予定が無い日もセクションとして表示される', () => {
      // 2026-07-04 は土曜日（hiddenWeekdays: [0, 6] に含まれる想定の曜日）。
      const calendar = createCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => new Date('2026-07-01T01:00:00Z'),
        initialDate: new Date('2026-07-01T01:00:00Z'),
        initialView: 'list',
        listDays: 7,
        hiddenWeekdays: [0, 6],
        events: [
          {
            id: 'sat-only',
            title: '土曜のみの予定',
            start: '2026-07-04T09:00',
            end: '2026-07-04T10:00',
          },
        ],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'list') throw new Error('unreachable');
      expect(vm.days.some((day) => day.key === '2026-07-04')).toBe(true);
    });

    it('businessHours 省略時は週/日ビューの businessHourSlots がすべて false（従来どおりの出力）', () => {
      const calendar = makeCalendar({ initialView: 'week' });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeGrid') throw new Error('unreachable');
      expect(
        vm.days.every((day) => day.businessHourSlots.every((slot) => !slot.isBusinessHours)),
      ).toBe(true);
    });

    it('businessHours を指定すると該当スロットの isBusinessHours が true になる', () => {
      const calendar = makeCalendar({
        initialView: 'day',
        businessHours: [
          { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '17:00' },
        ],
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeGrid') throw new Error('unreachable');
      const day = vm.days[0];
      expect(day?.businessHourSlots.find((slot) => slot.minutes === 540)?.isBusinessHours).toBe(
        true,
      );
      expect(day?.businessHourSlots.find((slot) => slot.minutes === 480)?.isBusinessHours).toBe(
        false,
      );
    });

    it('businessHours はリソース/タイムラインビューの businessHourSlots/businessHourRanges にも反映される', () => {
      const calendar = makeCalendar({
        resources: [ROOM],
        businessHours: [
          { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '17:00' },
        ],
      });

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(
        resourceVm.businessHourSlots.find((slot) => slot.minutes === 540)?.isBusinessHours,
      ).toBe(true);

      calendar.setView('timeline');
      const timelineVm = calendar.getViewModel();
      if (timelineVm.type !== 'timeline') throw new Error('unreachable');
      expect(timelineVm.businessHourRanges.length).toBeGreaterThan(0);
    });

    it('slotMinTime/slotMaxTime 省略時は週/日・リソースビューの slotMinTimeMinutes/slotMaxTimeMinutes が 0/1440 になる（回帰ペア）', () => {
      const calendar = makeCalendar({ initialView: 'week', resources: [ROOM] });
      const weekVm = calendar.getViewModel();
      if (weekVm.type !== 'timeGrid') throw new Error('unreachable');
      expect(weekVm.slotMinTimeMinutes).toBe(0);
      expect(weekVm.slotMaxTimeMinutes).toBe(1440);

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(resourceVm.slotMinTimeMinutes).toBe(0);
      expect(resourceVm.slotMaxTimeMinutes).toBe(1440);
    });

    it('slotMinTime/slotMaxTime を指定すると週/日・リソースビューの slotMinTimeMinutes/slotMaxTimeMinutes に反映される', () => {
      const calendar = makeCalendar({
        initialView: 'day',
        resources: [ROOM],
        slotMinTime: '08:00',
        slotMaxTime: '20:00',
      });
      const dayVm = calendar.getViewModel();
      if (dayVm.type !== 'timeGrid') throw new Error('unreachable');
      expect(dayVm.slotMinTimeMinutes).toBe(480);
      expect(dayVm.slotMaxTimeMinutes).toBe(1200);

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(resourceVm.slotMinTimeMinutes).toBe(480);
      expect(resourceVm.slotMaxTimeMinutes).toBe(1200);
    });

    it('slotMinTime/slotMaxTime を指定すると表示時間帯外のオカレンスが週/日ビューの items から消え、範囲外の now では nowIndicator が null になる', () => {
      const earlyMeeting: CalendarEvent = {
        id: 'early',
        title: '早朝ミーティング',
        start: '2026-07-15T05:00',
        end: '2026-07-15T06:00',
      };
      const calendar = makeCalendar({
        initialView: 'day',
        events: [earlyMeeting, MEETING],
        slotMinTime: '08:00',
        slotMaxTime: '09:00', // now（10:00）を範囲外にする
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeGrid') throw new Error('unreachable');
      const day = vm.days[0];
      expect(day?.items.some((item) => item.occurrence.eventId === 'early')).toBe(false);
      expect(day?.items.some((item) => item.occurrence.eventId === 'meeting')).toBe(false);
      expect(vm.nowIndicator).toBeNull();
    });

    it('slotMinTime/slotMaxTime はリソースビューにも反映される（items からの除外・nowIndicatorMinutes の null 化）', () => {
      const calendar = makeCalendar({
        initialView: 'resource',
        resources: [ROOM],
        events: [{ ...MEETING, resourceId: ROOM.id }],
        slotMinTime: '08:00',
        slotMaxTime: '09:00',
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'resource') throw new Error('unreachable');
      expect(vm.columns[0]?.items).toHaveLength(0);
      expect(vm.nowIndicatorMinutes).toBeNull();
    });

    it("setView('year') 後は年ビューのビューモデル（12 ヶ月分）を返す", () => {
      const calendar = makeCalendar();
      calendar.setView('year');
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('year');
      if (vm.type !== 'year') throw new Error('unreachable');
      expect(vm.months).toHaveLength(12);
    });

    it('年ビューの getVisibleRange は年初 0:00 〜翌年初 0:00 の範囲になる', () => {
      const calendar = makeCalendar();
      calendar.setView('year');
      const range = calendar.getVisibleRange();
      // 東京の 2026-01-01 0:00 〜 2027-01-01 0:00
      expect(range.start.toISOString()).toBe('2025-12-31T15:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    });

    it("setView('multiMonth') 後は複数月ビューのビューモデル（既定 multiMonthCount=3 ヶ月分）を返す", () => {
      const calendar = makeCalendar();
      calendar.setView('multiMonth');
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('multiMonth');
      if (vm.type !== 'multiMonth') throw new Error('unreachable');
      expect(vm.months).toHaveLength(3);
    });

    it('multiMonthCount を updateOptions で変更すると複数月ビューの月数に反映される', () => {
      const calendar = makeCalendar();
      calendar.setView('multiMonth');
      calendar.updateOptions({ multiMonthCount: 6 });
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('multiMonth');
      if (vm.type !== 'multiMonth') throw new Error('unreachable');
      expect(vm.months).toHaveLength(6);
      expect(calendar.getState().options.multiMonthCount).toBe(6);
    });

    it('multiMonthCount に 0 以下を渡すと 1 へ正規化される', () => {
      const calendar = makeCalendar({ multiMonthCount: 0 });
      expect(calendar.getState().options.multiMonthCount).toBe(1);

      calendar.updateOptions({ multiMonthCount: -5 });
      expect(calendar.getState().options.multiMonthCount).toBe(1);
    });

    it('複数月ビューの getVisibleRange は月初 0:00 〜 multiMonthCount ヶ月後の月初 0:00 の範囲になる', () => {
      const calendar = makeCalendar();
      calendar.setView('multiMonth');
      const range = calendar.getVisibleRange();
      // 東京の 2026-07-01 0:00 〜 2026-10-01 0:00（既定 multiMonthCount=3）
      expect(range.start.toISOString()).toBe('2026-06-30T15:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    });

    it("setView('resource') 後はリソースビューのビューモデル（列 = リソース）を返す", () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      calendar.setView('resource');
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('resource');
      if (vm.type !== 'resource') throw new Error('unreachable');
      expect(vm.columns).toHaveLength(1);
      expect(vm.columns[0]?.resource).toEqual(ROOM);
      expect(vm.columns[0]?.key).toBe('r:room-1');
    });

    it("setView('timeline') 後はタイムラインビューのビューモデル（行 = リソース）を返す", () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      calendar.setView('timeline');
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('timeline');
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.rows).toHaveLength(1);
      expect(vm.rows[0]?.resource).toEqual(ROOM);
      expect(vm.rows[0]?.key).toBe('r:room-1');
      expect(vm.days).toHaveLength(1); // 既定 timelineDays=1
      expect(vm.totalMinutes).toBe(1440);
    });

    it('timelineDays を updateOptions で変更するとタイムラインの表示日数に反映される', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      calendar.setView('timeline');
      calendar.updateOptions({ timelineDays: 7 });
      const vm = calendar.getViewModel();
      expect(vm.type).toBe('timeline');
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.days).toHaveLength(7);
      expect(vm.totalMinutes).toBe(7 * 1440);
      expect(calendar.getState().options.timelineDays).toBe(7);
    });

    it('timelineDays に 0 以下を渡すと 1 へ正規化される', () => {
      const calendar = makeCalendar({ timelineDays: 0 });
      expect(calendar.getState().options.timelineDays).toBe(1);

      calendar.updateOptions({ timelineDays: -3 });
      expect(calendar.getState().options.timelineDays).toBe(1);
    });

    it("timelineScale の既定は 'hour' で、既存挙動（headerGroups なし）と一致する", () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      calendar.setView('timeline');
      expect(calendar.getState().options.timelineScale).toBe('hour');
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.scale).toBe('hour');
      expect(vm.headerGroups).toBeNull();
    });

    it('timelineScale を updateOptions で変更するとタイムラインビューモデルに反映される', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      calendar.setView('timeline');
      calendar.updateOptions({ timelineDays: 10, timelineScale: 'week' });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.scale).toBe('week');
      expect(vm.headerGroups).not.toBeNull();
      expect(calendar.getState().options.timelineScale).toBe('week');
    });

    it("unassignedLane の既定は 'auto'（該当オカレンスがなければ未割り当て列/行を生成しない）", () => {
      const calendar = makeCalendar();
      expect(calendar.getState().options.unassignedLane).toBe('auto');

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      expect(resourceVm.type).toBe('resource');
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(resourceVm.columns).toHaveLength(0);
      expect(resourceVm.isEmpty).toBe(true);
    });

    it("unassignedLane: 'always' を指定すると未割り当て列/行が該当オカレンスがなくても常に生成される", () => {
      const calendar = makeCalendar({ unassignedLane: 'always' });
      expect(calendar.getState().options.unassignedLane).toBe('always');

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      expect(resourceVm.type).toBe('resource');
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(resourceVm.columns).toHaveLength(1);
      expect(resourceVm.columns[0]?.resource).toBeNull();
      expect(resourceVm.columns[0]?.key).toBe('unassigned');
      expect(resourceVm.isEmpty).toBe(false);

      calendar.setView('timeline');
      const timelineVm = calendar.getViewModel();
      expect(timelineVm.type).toBe('timeline');
      if (timelineVm.type !== 'timeline') throw new Error('unreachable');
      expect(timelineVm.rows).toHaveLength(1);
      expect(timelineVm.rows[0]?.resource).toBeNull();
      expect(timelineVm.isEmpty).toBe(false);
    });

    it('resources がリソース/タイムラインビューモデルの列/行に反映される（setResources 経由）', () => {
      const calendar = makeCalendar();
      calendar.setResources([ROOM]);

      calendar.setView('resource');
      const resourceVm = calendar.getViewModel();
      expect(resourceVm.type).toBe('resource');
      if (resourceVm.type !== 'resource') throw new Error('unreachable');
      expect(resourceVm.columns.map((c) => c.resource?.id)).toEqual(['room-1']);

      calendar.setView('timeline');
      const timelineVm = calendar.getViewModel();
      expect(timelineVm.type).toBe('timeline');
      if (timelineVm.type !== 'timeline') throw new Error('unreachable');
      expect(timelineVm.rows.map((r) => r.resource?.id)).toEqual(['room-1']);
    });

    it('toggleResourceCollapsed を 2 回呼ぶと元の状態（可視）に戻る', () => {
      const calendar = makeCalendar({
        resources: [ROOM, { id: 'room-2', title: '会議室B', parentId: 'room-1' }],
      });
      calendar.setView('timeline');
      const before = calendar.getViewModel();
      if (before.type !== 'timeline') throw new Error('unreachable');
      expect(before.rows.map((r) => r.key)).toEqual(['r:room-1', 'r:room-2']);

      calendar.toggleResourceCollapsed('room-1');
      const collapsed = calendar.getViewModel();
      if (collapsed.type !== 'timeline') throw new Error('unreachable');
      expect(collapsed.rows.map((r) => r.key)).toEqual(['r:room-1']);

      calendar.toggleResourceCollapsed('room-1');
      const restored = calendar.getViewModel();
      if (restored.type !== 'timeline') throw new Error('unreachable');
      expect(restored.rows.map((r) => r.key)).toEqual(['r:room-1', 'r:room-2']);
    });

    it('toggleResourceCollapsed は getViewModel のキャッシュを破棄する', () => {
      const calendar = makeCalendar({
        resources: [ROOM, { id: 'room-2', title: '会議室B', parentId: 'room-1' }],
      });
      calendar.setView('timeline');
      const vm = calendar.getViewModel();
      calendar.toggleResourceCollapsed('room-1');
      expect(calendar.getViewModel()).not.toBe(vm);
    });

    it('toggleResourceCollapsed は resources に存在しない ID を渡しても例外にならない', () => {
      const calendar = makeCalendar();
      expect(() => calendar.toggleResourceCollapsed('ghost')).not.toThrow();
    });

    it('initialCollapsedResourceIds を指定すると、タイムラインの初回ビューモデルが該当行を隠す', () => {
      const calendar = makeCalendar({
        resources: [ROOM, { id: 'room-2', title: '会議室B', parentId: 'room-1' }],
        initialCollapsedResourceIds: ['room-1'],
        initialView: 'timeline',
      });
      const vm = calendar.getViewModel();
      if (vm.type !== 'timeline') throw new Error('unreachable');
      expect(vm.rows.map((r) => r.key)).toEqual(['r:room-1']);
    });

    it('getState().collapsedResourceIds に折りたたみ状態が反映される', () => {
      const calendar = makeCalendar({ resources: [ROOM] });
      expect(calendar.getState().collapsedResourceIds.size).toBe(0);
      calendar.toggleResourceCollapsed('room-1');
      expect(calendar.getState().collapsedResourceIds.has('room-1')).toBe(true);
    });

    it('状態が変わらない限りビューモデルはキャッシュされる（同一参照）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const a = calendar.getViewModel();
      expect(calendar.getViewModel()).toBe(a);
      calendar.next();
      expect(calendar.getViewModel()).not.toBe(a);
    });

    it('setDragPreview は状態を変えるがビューモデルのキャッシュは保つ', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const vm = calendar.getViewModel();
      const stateBefore = calendar.getState();
      calendar.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: { start: NOW, end: new Date(NOW.getTime() + 3600_000) },
        allDay: false,
      });
      expect(calendar.getState()).not.toBe(stateBefore);
      expect(calendar.getState().dragPreview?.kind).toBe('create');
      expect(calendar.getViewModel()).toBe(vm);
      calendar.setDragPreview(null);
      expect(calendar.getState().dragPreview).toBeNull();
    });

    it('イベントがビューモデルに反映される（月ビュー）', () => {
      const calendar = makeCalendar({ events: [MEETING] });
      const vm = calendar.getViewModel();
      if (vm.type !== 'month') throw new Error('unreachable');
      const segments = vm.weeks.flatMap((w) => [...w.segments]);
      expect(segments.some((s) => s.occurrence.eventId === 'meeting')).toBe(true);
    });

    it('getVisibleRange はビューに応じた範囲を返す', () => {
      const calendar = makeCalendar();
      calendar.setView('day');
      const range = calendar.getVisibleRange();
      // 東京の 7/15 0:00 〜 7/16 0:00
      expect(range.start.toISOString()).toBe('2026-07-14T15:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-07-15T15:00:00.000Z');
    });

    it('getOccurrences が範囲内のオカレンスを返す', () => {
      const calendar = makeCalendar({ events: [DAILY] });
      const occurrences = calendar.getOccurrences({
        start: new Date('2026-07-14T15:00:00Z'),
        end: new Date('2026-07-16T15:00:00Z'),
      });
      expect(occurrences).toHaveLength(2);
    });

    it('getOccurrences は範囲内のオカレンスを開始時刻順（昇順）で返す', () => {
      // 意図的に開始時刻の降順で登録し、返り値が昇順に並び替わることを確認する。
      const late: CalendarEvent = {
        id: 'late',
        title: '遅い予定',
        start: '2026-07-15T18:00',
        end: '2026-07-15T19:00',
      };
      const early: CalendarEvent = {
        id: 'early',
        title: '早い予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      };
      const middle: CalendarEvent = {
        id: 'middle',
        title: '中間の予定',
        start: '2026-07-15T13:00',
        end: '2026-07-15T14:00',
      };
      const calendar = makeCalendar({ events: [late, early, middle] });

      const occurrences = calendar.getOccurrences({
        start: new Date('2026-07-14T15:00:00Z'), // 東京 7/15 0:00
        end: new Date('2026-07-15T15:00:00Z'), // 東京 7/16 0:00
      });

      expect(occurrences.map((o) => o.eventId)).toEqual(['early', 'middle', 'late']);
    });
  });

  describe('onRangeChange', () => {
    it('作成時に 1 回発火し、現在のビュー・基準日・表示範囲を渡す（FullCalendar の datesSet 相当）', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });

      expect(onRangeChange).toHaveBeenCalledTimes(1);
      const info = onRangeChange.mock.calls[0]?.[0];
      const range = calendar.getVisibleRange();
      expect(info).toEqual({
        view: 'month',
        currentDate: calendar.getState().currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
    });

    it('setView でビューが変わるたびに発火する', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.setView('week');
      expect(onRangeChange).toHaveBeenCalledTimes(1);
      expect(onRangeChange.mock.calls[0]?.[0]).toMatchObject({ view: 'week' });
    });

    it('goTo で基準日が変わるたびに発火する', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      const target = new Date('2026-08-01T00:00:00Z');
      calendar.goTo(target);
      expect(onRangeChange).toHaveBeenCalledTimes(1);
      expect(onRangeChange.mock.calls[0]?.[0]?.currentDate.getTime()).toBe(target.getTime());
    });

    it('next / prev で表示範囲が変わるたびに発火する', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.next();
      expect(onRangeChange).toHaveBeenCalledTimes(1);
      calendar.prev();
      expect(onRangeChange).toHaveBeenCalledTimes(2);
    });

    it('同じ view への setView など、実質的に無変化な呼び出しでは発火しない', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.setView('month'); // 既に month のため無効
      const same = calendar.getState().currentDate;
      calendar.goTo(same); // 同一時刻のため無効
      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it('イベント CRUD・setEvents・setResources・setDragPreview・refresh など範囲に無関係な更新では発火しない', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      const created = calendar.createEvent({ title: '追加', start: '2026-07-15T13:00' });
      calendar.updateEvent(created.id, { title: '変更後' });
      calendar.deleteEvent(created.id);
      calendar.setEvents([MEETING]);
      calendar.setResources([ROOM]);
      calendar.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: { start: NOW, end: NOW },
        allDay: true,
      });
      calendar.setDragPreview(null);
      calendar.refresh();

      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it('setTimeZone で表示範囲が変わると発火する', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.setTimeZone('America/New_York');
      expect(onRangeChange).toHaveBeenCalledTimes(1);
    });

    it('updateOptions({ weekStartsOn }) など表示範囲を変える指定では発火し、dayMaxEvents など無関係な指定では発火しない', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ initialView: 'week', onRangeChange });
      onRangeChange.mockClear();

      calendar.updateOptions({ dayMaxEvents: 10 });
      expect(onRangeChange).not.toHaveBeenCalled();

      calendar.updateOptions({ weekStartsOn: 1 });
      expect(onRangeChange).toHaveBeenCalledTimes(1);
    });

    it('updateOptions({ onRangeChange }) でコールバックを差し替えられる（差し替え自体では発火しない）', () => {
      const first = vi.fn();
      const second = vi.fn();
      const calendar = makeCalendar({ onRangeChange: first });
      first.mockClear();

      calendar.updateOptions({ onRangeChange: second });
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      calendar.next();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('onRangeChange 未指定時は何も起きない（既定動作）', () => {
      const calendar = makeCalendar();
      expect(() => {
        calendar.next();
        calendar.setView('week');
      }).not.toThrow();
    });

    it('onRangeChange は subscribe リスナー通知の後に呼ばれる（onEventsChange と同じ発火タイミングの規約）', () => {
      const order: string[] = [];
      const onRangeChange = vi.fn(() => {
        order.push('onRangeChange');
      });
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();
      order.length = 0; // 作成時（初期化）の 1 回分の発火はここでは対象外
      calendar.subscribe(() => {
        order.push('listener');
      });

      calendar.next();

      expect(order).toEqual(['listener', 'onRangeChange']);
    });

    it('コールバックなしで作成し後から updateOptions で登録しても、範囲に無関係な操作では発火しない', () => {
      const calendar = makeCalendar();
      const onRangeChange = vi.fn();
      calendar.updateOptions({ onRangeChange });

      const created = calendar.createEvent({ title: '追加', start: '2026-07-15T13:00' });
      calendar.updateEvent(created.id, { title: '変更後' });
      calendar.deleteEvent(created.id);
      calendar.setEvents([MEETING]);
      calendar.setResources([ROOM]);
      calendar.refresh();

      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it('コールバックなしで作成し後から updateOptions で登録した場合、setView / goTo / next / prev / setTimeZone では発火する', () => {
      const calendar = makeCalendar();
      const onRangeChange = vi.fn();
      calendar.updateOptions({ onRangeChange });

      calendar.setView('week');
      expect(onRangeChange).toHaveBeenCalledTimes(1);

      calendar.next();
      expect(onRangeChange).toHaveBeenCalledTimes(2);

      calendar.prev();
      expect(onRangeChange).toHaveBeenCalledTimes(3);

      calendar.goTo(new Date('2026-09-01T00:00:00Z'));
      expect(onRangeChange).toHaveBeenCalledTimes(4);

      calendar.setTimeZone('America/New_York');
      expect(onRangeChange).toHaveBeenCalledTimes(5);
    });
  });

  describe('コールバックの解除（updateOptions に null を渡す）', () => {
    it('onEventsChange を null で解除すると、以後のイベント変更で呼ばれなくなる', () => {
      const onEventsChange = vi.fn();
      const calendar = makeCalendar({ onEventsChange });

      calendar.updateOptions({ onEventsChange: null });
      calendar.createEvent({ title: '追加', start: '2026-07-15T13:00' });

      expect(onEventsChange).not.toHaveBeenCalled();
    });

    it('onRangeChange を null で解除すると、以後の範囲変更で呼ばれなくなる', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.updateOptions({ onRangeChange: null });
      calendar.next();

      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it('null で解除した後に再度 updateOptions で登録し直すと、また発火するようになる', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.updateOptions({ onRangeChange: null });
      calendar.updateOptions({ onRangeChange });
      calendar.next();

      expect(onRangeChange).toHaveBeenCalledTimes(1);
    });

    it('null 解除自体は状態変更として通知されない', () => {
      const calendar = makeCalendar({ onEventsChange: vi.fn(), onRangeChange: vi.fn() });
      const listener = vi.fn();
      calendar.subscribe(listener);

      calendar.updateOptions({ onEventsChange: null, onRangeChange: null });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('notifyRangeChange', () => {
    it('onRangeChange が未登録でも例外にならない', () => {
      const calendar = makeCalendar();
      expect(() => calendar.notifyRangeChange()).not.toThrow();
    });

    it('登録済みなら現在のビュー・基準日・表示範囲を即時通知する', () => {
      const calendar = makeCalendar();
      const onRangeChange = vi.fn();
      calendar.updateOptions({ onRangeChange });

      calendar.notifyRangeChange();

      expect(onRangeChange).toHaveBeenCalledTimes(1);
      const range = calendar.getVisibleRange();
      expect(onRangeChange.mock.calls[0]?.[0]).toEqual({
        view: calendar.getState().view,
        currentDate: calendar.getState().currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
    });

    it('差分がなくても呼ぶたびに毎回通知する（notifyRangeChangeIfNeeded との違い）', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });
      onRangeChange.mockClear();

      calendar.notifyRangeChange();
      calendar.notifyRangeChange();

      expect(onRangeChange).toHaveBeenCalledTimes(2);
    });

    it('呼び出し後は比較基準が更新され、実質無変化な操作での重複発火が起きない', () => {
      const onRangeChange = vi.fn();
      const calendar = makeCalendar({ onRangeChange });

      calendar.notifyRangeChange();
      onRangeChange.mockClear();

      calendar.setView('month'); // 既に month
      expect(onRangeChange).not.toHaveBeenCalled();
    });
  });

  describe('可変参照からの保護（入力・公開境界の複製）', () => {
    it('initialDate に渡した Date を後から変更しても state / getVisibleRange / getViewModel が変わらない', () => {
      const date = new Date('2026-07-15T00:00:00Z');
      const calendar = createCalendar({ timeZone: 'UTC', initialDate: date });
      const viewModelBefore = calendar.getViewModel();
      const rangeBefore = calendar.getVisibleRange();

      date.setUTCMonth(7); // 呼び出し側で 8 月へ変更

      expect(calendar.getState().currentDate.toISOString()).toBe('2026-07-15T00:00:00.000Z');
      expect(calendar.getVisibleRange()).toEqual(rangeBefore);
      expect(calendar.getViewModel()).toBe(viewModelBefore);
    });

    it('goTo に渡した Date を後から変更しても内部状態に影響しない', () => {
      const calendar = makeCalendar();
      const target = new Date('2026-08-01T00:00:00Z');
      calendar.goTo(target);

      target.setUTCMonth(11);

      expect(calendar.getState().currentDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    it('getState().currentDate を変更しても内部の基準日は汚染されない（次のナビゲーションが元の基準日から計算される）', () => {
      const calendar = makeCalendar(); // NOW = 2026-07-15（東京）
      const state = calendar.getState();

      state.currentDate.setUTCFullYear(2000); // 戻り値を書き換える（内部には反映されないはず）

      calendar.next(); // 内部の currentDate（東京 2026-07-15 10:00）を基準に翌月初へ進む
      const after = calendar.getState().currentDate;
      // 内部が 2000 年に汚染されていれば無関係な日時になるが、
      // 実際は NOW（東京 2026-07-15）の翌月初（東京 2026-08-01 0:00 = UTC 2026-07-31T15:00）になる
      expect(after.toISOString()).toBe('2026-07-31T15:00:00.000Z');
    });

    it('events / resources の入力配列へ後から push しても反映されず、通知も起きない', () => {
      const events: CalendarEvent[] = [MEETING];
      const resources: CalendarResource[] = [ROOM];
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo', events, resources });
      const listener = vi.fn();
      calendar.subscribe(listener);

      events.push({ id: 'sneaked-in', title: '追加', start: '2026-07-16T09:00' });
      resources.push({ id: 'room-2', title: '会議室B' });

      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(calendar.getResources()).toEqual([ROOM]);
      expect(listener).not.toHaveBeenCalled();
    });

    it('now オプションが同一 Date インスタンスを返し続けても today() が壊れない', () => {
      const shared = new Date('2026-07-20T00:00:00Z');
      const calendar = createCalendar({ timeZone: 'UTC', now: () => shared });

      calendar.today();
      const capturedTime = calendar.getState().currentDate.getTime();
      shared.setUTCFullYear(2000); // now() が返した共有インスタンスを後から変更

      expect(calendar.getState().currentDate.getTime()).toBe(capturedTime);
    });

    it('businessHours / timeAxisZones を事後変更しても反映されない', () => {
      const businessHours: BusinessHoursRule[] = [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
      ];
      const timeAxisZones = ['America/New_York'];
      const calendar = makeCalendar({ initialView: 'week', businessHours, timeAxisZones });

      businessHours.push({ daysOfWeek: [0, 6], startTime: '10:00', endTime: '12:00' });
      timeAxisZones.push('Europe/London');

      expect(calendar.getState().options.businessHours).toHaveLength(1);
      expect(calendar.getState().options.timeAxisZones).toEqual(['America/New_York']);
    });

    it('updateOptions に渡した businessHours 配列を事後変更しても反映されない', () => {
      const calendar = makeCalendar({ initialView: 'day' });
      const businessHours: BusinessHoursRule[] = [
        { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' },
      ];
      calendar.updateOptions({ businessHours });

      businessHours.push({ daysOfWeek: [2], startTime: '10:00', endTime: '11:00' });

      expect(calendar.getState().options.businessHours).toHaveLength(1);
    });

    it('eventConstraint に渡した配列を事後変更しても反映されない（businessHours と同じ複製規則）', () => {
      const rules: BusinessHoursRule[] = [
        { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' },
      ];
      const calendar = makeCalendar({ eventConstraint: rules });

      rules.push({ daysOfWeek: [2], startTime: '10:00', endTime: '11:00' });

      expect(calendar.getState().options.eventConstraint).toEqual([
        { daysOfWeek: [1], startTime: '09:00', endTime: '17:00' },
      ]);
    });

    it('setEvents に同一参照を渡すと no-op、createEvent 後に同じ入力配列を渡し直すと反映される（高速パスの無効化）', () => {
      const arr: CalendarEvent[] = [MEETING];
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

      calendar.setEvents(arr);
      const listener = vi.fn();
      calendar.subscribe(listener);

      calendar.setEvents(arr); // 同一参照 → no-op
      expect(listener).not.toHaveBeenCalled();

      calendar.createEvent({ title: '追加', start: '2026-07-16T09:00' });
      expect(calendar.getEvents()).toHaveLength(2);
      listener.mockClear();

      calendar.setEvents(arr); // 内部変更後に同じ入力配列を渡し直す → 反映される（高速パス無効化）
      expect(calendar.getEvents()).toEqual([MEETING]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('setResources に同一参照を渡すと no-op になる（setEvents と同じ高速パス）', () => {
      const arr: CalendarResource[] = [ROOM];
      const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

      calendar.setResources(arr);
      const listener = vi.fn();
      calendar.subscribe(listener);

      calendar.setResources(arr); // 同一参照 → no-op

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
