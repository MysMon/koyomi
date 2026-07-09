import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import type { CalendarEvent } from './types';

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
});
