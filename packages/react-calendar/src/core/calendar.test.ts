import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import type { CalendarEvent, CalendarResource, CalendarViewType } from './types';

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
      expect(updateChanges).toEqual([{ before: created, after: { ...created, title: 'b' } }]);

      const deleteChanges = calendar.deleteEvent(created.id);
      expect(deleteChanges).toEqual([{ before: { ...created, title: 'b' } }]);
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
  });
});
