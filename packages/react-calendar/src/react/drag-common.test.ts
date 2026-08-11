/**
 * drag-common.ts の {@link eventNotificationProps} / {@link collectOverlapBlockersInRange} の
 * テスト。
 *
 * ドラッグ操作を経由しない純粋なプロップゲッター・ヘルパーのため、DOM 描画を介さず
 * 直接呼び出して検証する（DOM 経由の統合テスト・pointermove 起点でのキャッシュ効果の
 * 検証は各ビューのフック・コンポーネントのテストファイル側で行う。例:
 * `use-time-grid-drag.test.tsx` の「pointermove を繰り返しても getOccurrences は
 * 1 回だけ」テスト）。
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { createEventHistory } from '../core/history';
import { parseDateValue } from '../core/timezone';
import type { CalendarApi, CalendarEvent, CalendarResource, EventOccurrence } from '../core/types';
import {
  allDayPatchRange,
  captureOccurrenceDeleteFocusContext,
  collectOverlapBlockersInRange,
  createDefaultEvent,
  createOccurrenceDeleteFocusController,
  createOverlapBlockerCache,
  eventNotificationProps,
  reportOperationRejected,
} from './drag-common';
import type { CalendarInteractionCallbacks, OperationRejection, RangeSelection } from './types';

/** テスト用の最小限のオカレンス。 */
function makeOccurrence(): EventOccurrence {
  const event: CalendarEvent = { id: 'e1', title: '会議', start: '2026-07-15T10:00' };
  return {
    key: 'e1::2026-07-15T01:00:00.000Z',
    eventId: 'e1',
    event,
    start: new Date('2026-07-15T01:00:00Z'),
    end: new Date('2026-07-15T02:00:00Z'),
    originalStart: new Date('2026-07-15T01:00:00Z'),
    allDay: false,
    isRecurring: false,
  };
}

/**
 * テスト用の最小限の `ReactMouseEvent`（`nativeEvent` のみ参照される）。
 * 本物の SyntheticEvent は React が生成するため、テストでは `nativeEvent` だけを
 * 持つ最小限の値を用意し、実装が読む唯一のプロパティであることを型で保証する
 * 手段がないためここでのみ `as` キャストを使う。
 */
function makeMouseEvent(nativeEvent: MouseEvent): ReactMouseEvent<HTMLElement> {
  return { nativeEvent } as ReactMouseEvent<HTMLElement>;
}

/** {@link makeMouseEvent} の `ReactPointerEvent` 版。 */
function makePointerEvent(nativeEvent: MouseEvent): ReactPointerEvent<HTMLElement> {
  return { nativeEvent } as ReactPointerEvent<HTMLElement>;
}

describe('allDayPatchRange', () => {
  it('表示タイムゾーンの終日範囲を日付キー文字列の start / end（排他）に変換する', () => {
    const range = {
      start: new Date('2026-07-07T15:00:00Z'), // 東京 7/8 0:00
      end: new Date('2026-07-09T15:00:00Z'), // 東京 7/10 0:00（排他）
    };
    expect(allDayPatchRange(range, 'Asia/Tokyo')).toEqual({
      start: '2026-07-08',
      end: '2026-07-10',
    });
  });

  it('深夜 0:00 に DST が切り替わる日の繰り上げ済み範囲も、その日の日付キーになる', () => {
    // America/Santiago の 2026-09-06 は 0:00 が存在せず、日の開始は 1:00（= 04:00Z）
    const range = {
      start: new Date('2026-09-06T04:00:00Z'), // 9/6 1:00（日の開始）
      end: new Date('2026-09-07T03:00:00Z'), // 9/7 0:00（排他）
    };
    expect(allDayPatchRange(range, 'America/Santiago')).toEqual({
      start: '2026-09-06',
      end: '2026-09-07',
    });
  });
});

describe('eventNotificationProps', () => {
  it('コールバックが 1 つも指定されていない場合、キーを 1 つも含まないオブジェクトを返す', () => {
    const occurrence = makeOccurrence();
    const props = eventNotificationProps(undefined, occurrence);
    expect(Object.keys(props)).toEqual([]);
  });

  it('onEventDoubleClick のみ指定時、onDoubleClick だけを含み、オカレンスと nativeEvent を渡す', () => {
    const occurrence = makeOccurrence();
    const onEventDoubleClick = vi.fn();
    const callbacks: CalendarInteractionCallbacks = { onEventDoubleClick };
    const props = eventNotificationProps(callbacks, occurrence);

    expect(Object.keys(props)).toEqual(['onDoubleClick']);
    const nativeEvent = new MouseEvent('dblclick');
    props.onDoubleClick?.(makeMouseEvent(nativeEvent));
    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
    expect(onEventDoubleClick).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('onEventContextMenu のみ指定時、onContextMenu だけを含み、preventDefault は呼ばれない', () => {
    const occurrence = makeOccurrence();
    const onEventContextMenu = vi.fn();
    const props = eventNotificationProps({ onEventContextMenu }, occurrence);

    expect(Object.keys(props)).toEqual(['onContextMenu']);
    const nativeEvent = new MouseEvent('contextmenu', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(nativeEvent, 'preventDefault');
    props.onContextMenu?.(makeMouseEvent(nativeEvent));

    expect(onEventContextMenu).toHaveBeenCalledTimes(1);
    expect(onEventContextMenu).toHaveBeenCalledWith(occurrence, nativeEvent);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('onEventHover のみ指定時、onPointerEnter だけを含む', () => {
    const occurrence = makeOccurrence();
    const onEventHover = vi.fn();
    const props = eventNotificationProps({ onEventHover }, occurrence);

    expect(Object.keys(props)).toEqual(['onPointerEnter']);
    const nativeEvent = new MouseEvent('pointerover');
    props.onPointerEnter?.(makePointerEvent(nativeEvent));
    expect(onEventHover).toHaveBeenCalledTimes(1);
    expect(onEventHover).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('onEventHoverEnd のみ指定時、onPointerLeave だけを含む', () => {
    const occurrence = makeOccurrence();
    const onEventHoverEnd = vi.fn();
    const props = eventNotificationProps({ onEventHoverEnd }, occurrence);

    expect(Object.keys(props)).toEqual(['onPointerLeave']);
    const nativeEvent = new MouseEvent('pointerout');
    props.onPointerLeave?.(makePointerEvent(nativeEvent));
    expect(onEventHoverEnd).toHaveBeenCalledTimes(1);
    expect(onEventHoverEnd).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('4 つとも指定時、4 つのキーすべてを含む', () => {
    const occurrence = makeOccurrence();
    const callbacks: CalendarInteractionCallbacks = {
      onEventDoubleClick: vi.fn(),
      onEventContextMenu: vi.fn(),
      onEventHover: vi.fn(),
      onEventHoverEnd: vi.fn(),
    };
    const props = eventNotificationProps(callbacks, occurrence);
    expect(Object.keys(props).sort()).toEqual(
      ['onContextMenu', 'onDoubleClick', 'onPointerEnter', 'onPointerLeave'].sort(),
    );
  });
});

describe('createDefaultEvent', () => {
  const range = {
    start: new Date('2026-07-16T01:00:00Z'),
    end: new Date('2026-07-16T02:00:00Z'),
  };

  it('第3引数（defaultEventTitle）・range.start/end で作成し、allDay と resourceId は既定では省略する', () => {
    const api = createCalendar();
    const selection: RangeSelection = { range, allDay: false };

    const created = createDefaultEvent(api, selection, '（無題）');

    expect(created).toMatchObject({ title: '（無題）', start: range.start, end: range.end });
    expect(created.allDay).toBeUndefined();
    expect(created.resourceId).toBeUndefined();
    expect(api.getEvents()).toEqual([created]);
  });

  it('defaultEventTitle 省略時は既定値 "(タイトルなし)" になる', () => {
    const api = createCalendar();
    const selection: RangeSelection = { range, allDay: false };

    const created = createDefaultEvent(api, selection);

    expect(created.title).toBe('(タイトルなし)');
  });

  it('allDay: true の選択では作成イベントにも allDay: true を付与する', () => {
    const api = createCalendar();
    const selection: RangeSelection = { range, allDay: true };

    const created = createDefaultEvent(api, selection);

    expect(created.allDay).toBe(true);
  });

  it('resourceId が文字列のときのみ作成イベントに含め、null/undefined のときは含めない', () => {
    const api = createCalendar();

    const withResource = createDefaultEvent(api, { range, allDay: false, resourceId: 'r1' });
    expect(withResource.resourceId).toBe('r1');

    const unassigned = createDefaultEvent(api, { range, allDay: false, resourceId: null });
    expect(unassigned.resourceId).toBeUndefined();

    const notApplicable = createDefaultEvent(api, { range, allDay: false });
    expect(notApplicable.resourceId).toBeUndefined();
  });

  it('callbacks.onEventCreate が指定されている場合、作成後に作成イベント・changes・selection を渡して呼ぶ', () => {
    const api = createCalendar();
    const selection: RangeSelection = { range, allDay: false };
    const onEventCreate = vi.fn();

    const created = createDefaultEvent(api, selection, '（無題）', { onEventCreate });

    expect(onEventCreate).toHaveBeenCalledTimes(1);
    expect(onEventCreate).toHaveBeenCalledWith({
      event: created,
      changes: [{ after: created, index: 0 }],
      selection,
    });
  });

  it('callbacks.onEventCreate 省略時は呼ばれず、例外にもならない', () => {
    const api = createCalendar();
    const selection: RangeSelection = { range, allDay: false };

    expect(() => createDefaultEvent(api, selection, '（無題）', {})).not.toThrow();
    expect(() => createDefaultEvent(api, selection, '（無題）')).not.toThrow();
  });

  it('既存イベントがある状態で作成した場合、changes.index は作成後の末尾位置になる', () => {
    const api = createCalendar();
    api.createEvent({ title: '既存1', start: range.start, end: range.end });
    api.createEvent({ title: '既存2', start: range.start, end: range.end });
    const selection: RangeSelection = { range, allDay: false };
    const onEventCreate = vi.fn();

    const created = createDefaultEvent(api, selection, '（無題）', { onEventCreate });

    expect(onEventCreate).toHaveBeenCalledWith({
      event: created,
      changes: [{ after: created, index: 2 }],
      selection,
    });
  });

  it('onEventCreate が積んだ changes を history.push に渡すと、undo で作成したイベントが消える', () => {
    const api = createCalendar();
    const history = createEventHistory({ api });
    const selection: RangeSelection = { range, allDay: false };
    const onEventCreate: NonNullable<CalendarInteractionCallbacks['onEventCreate']> = (info) => {
      history.push(info.changes);
    };

    createDefaultEvent(api, selection, '（無題）', { onEventCreate });
    expect(api.getEvents()).toHaveLength(1);

    const undone = history.undo();

    expect(undone).toBe(true);
    expect(api.getEvents()).toHaveLength(0);
  });
});

describe('collectOverlapBlockersInRange', () => {
  const TOKYO = 'Asia/Tokyo';
  // 2026-07-15T10:00 JST（水）。
  const NOW = new Date('2026-07-15T01:00:00Z');

  /** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
  function at(isoLocal: string): Date {
    return parseDateValue(isoLocal, TOKYO, false);
  }

  /**
   * テスト用カレンダーを作る（週ビュー、表示週は 2026-07-12（日）〜 2026-07-18（土））。
   * 対象範囲の合成（`getVisibleRange()` との union）の挙動を検証しやすくするため、
   * 全テストで週ビュー・同じ基準日に固定する。
   */
  function makeWeekCalendar(options: {
    events?: readonly CalendarEvent[];
    resources?: readonly CalendarResource[];
  }): CalendarApi {
    return createCalendar({
      timeZone: TOKYO,
      initialView: 'week',
      weekStartsOn: 0,
      initialDate: NOW,
      now: () => NOW,
      events: options.events ?? [],
      resources: options.resources ?? [],
    });
  }

  it('同一イベント状態で候補範囲を変えて連続 2 回呼んでも展開は 1 回だけ走り、2 回目もフィルタ結果が正しい', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: '2026-07-13T10:00',
      end: '2026-07-13T11:00',
    };
    const api = makeWeekCalendar({ events: [existing] });
    const getOccurrencesSpy = vi.spyOn(api, 'getOccurrences');
    const cache = createOverlapBlockerCache();

    const overlapping = collectOverlapBlockersInRange(
      api,
      cache,
      { start: at('2026-07-13T10:30'), end: at('2026-07-13T11:30') },
      true,
    );
    const notOverlapping = collectOverlapBlockersInRange(
      api,
      cache,
      { start: at('2026-07-13T13:00'), end: at('2026-07-13T14:00') },
      true,
    );

    expect(getOccurrencesSpy).toHaveBeenCalledTimes(1);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0]?.key).toContain('existing@');
    expect(notOverlapping).toEqual([]);
  });

  it('api.setEvents でイベント配列が置き換わると再展開され、新しいイベントが blocker に反映される', () => {
    const api = makeWeekCalendar({});
    const getOccurrencesSpy = vi.spyOn(api, 'getOccurrences');
    const cache = createOverlapBlockerCache();
    const range = { start: at('2026-07-13T10:00'), end: at('2026-07-13T11:00') };

    const before = collectOverlapBlockersInRange(api, cache, range, true);
    expect(before).toEqual([]);

    const added: CalendarEvent = {
      id: 'added',
      title: '追加',
      start: '2026-07-13T10:00',
      end: '2026-07-13T11:00',
    };
    api.setEvents([added]);
    const after = collectOverlapBlockersInRange(api, cache, range, true);

    expect(getOccurrencesSpy).toHaveBeenCalledTimes(2);
    expect(after).toHaveLength(1);
    expect(after[0]?.key).toContain('added@');
  });

  it('表示範囲外の候補（前日の範囲など）では対象日を含めて再展開され、そこにある非表示イベントとの重なりを検出できる', () => {
    // 表示週は 2026-07-12（日）〜 2026-07-18（土）。前日の 7/11（表示範囲外）にある
    // 既存イベントは getVisibleRange の展開結果には含まれない。
    const hidden: CalendarEvent = {
      id: 'hidden',
      title: '前週の既存イベント',
      start: '2026-07-11T10:00',
      end: '2026-07-11T11:00',
    };
    const api = makeWeekCalendar({ events: [hidden] });
    const getOccurrencesSpy = vi.spyOn(api, 'getOccurrences');
    const cache = createOverlapBlockerCache();

    // まず表示範囲内の候補で 1 回展開させ、対象範囲を「表示範囲」に固定する
    collectOverlapBlockersInRange(
      api,
      cache,
      { start: at('2026-07-13T10:00'), end: at('2026-07-13T11:00') },
      true,
    );
    expect(getOccurrencesSpy).toHaveBeenCalledTimes(1);

    const blockers = collectOverlapBlockersInRange(
      api,
      cache,
      { start: at('2026-07-11T10:00'), end: at('2026-07-11T11:00') },
      true,
    );

    expect(getOccurrencesSpy).toHaveBeenCalledTimes(2);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.key).toContain('hidden@');
  });

  it('対象範囲に複数の既存オカレンスが展開されても、実際の候補範囲に重ならないものは blocker に含まれない', () => {
    const morning: CalendarEvent = {
      id: 'morning',
      title: '午前',
      start: '2026-07-13T10:00',
      end: '2026-07-13T11:00',
    };
    const afternoon: CalendarEvent = {
      id: 'afternoon',
      title: '午後',
      start: '2026-07-13T15:00',
      end: '2026-07-13T16:00',
    };
    const api = makeWeekCalendar({ events: [morning, afternoon] });
    const cache = createOverlapBlockerCache();

    const blockers = collectOverlapBlockersInRange(
      api,
      cache,
      { start: at('2026-07-13T10:30'), end: at('2026-07-13T10:45') },
      true,
    );

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.key).toContain('morning@');
  });

  it('lane 指定はキャッシュヒット時にも呼び出しごとに正しく適用される（同一キャッシュで laneId を変えて 2 回呼ぶ）', () => {
    const resources: readonly CalendarResource[] = [
      { id: 'r1', title: '会議室 A' },
      { id: 'r2', title: '会議室 B' },
    ];
    const inRoomA: CalendarEvent = {
      id: 'in-room-a',
      title: 'A の予定',
      start: '2026-07-13T10:00',
      end: '2026-07-13T11:00',
      resourceId: 'r1',
    };
    const inRoomB: CalendarEvent = {
      id: 'in-room-b',
      title: 'B の予定',
      start: '2026-07-13T10:00',
      end: '2026-07-13T11:00',
      resourceId: 'r2',
    };
    const api = makeWeekCalendar({ events: [inRoomA, inRoomB], resources });
    const getOccurrencesSpy = vi.spyOn(api, 'getOccurrences');
    const cache = createOverlapBlockerCache();
    const range = { start: at('2026-07-13T10:00'), end: at('2026-07-13T11:00') };

    const roomA = collectOverlapBlockersInRange(api, cache, range, true, {
      resources,
      laneId: 'r1',
    });
    const roomB = collectOverlapBlockersInRange(api, cache, range, true, {
      resources,
      laneId: 'r2',
    });

    expect(getOccurrencesSpy).toHaveBeenCalledTimes(1);
    expect(roomA).toHaveLength(1);
    expect(roomA[0]?.key).toContain('in-room-a@');
    expect(roomB).toHaveLength(1);
    expect(roomB[0]?.key).toContain('in-room-b@');
  });
});

describe('captureOccurrenceDeleteFocusContext', () => {
  /** `data-koyomi-occurrence` を持つ最小限の要素を作る。 */
  function makeOccurrenceElement(key: string): HTMLDivElement {
    const element = document.createElement('div');
    element.setAttribute('data-koyomi-occurrence', key);
    return element;
  }

  it('target が Element でない場合、null を返す', () => {
    const result = captureOccurrenceDeleteFocusContext({
      target: null,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="month"]',
    });
    expect(result).toBeNull();
  });

  it('viewRootSelector に一致する祖先が見つからない場合、null を返す', () => {
    const root = document.createElement('div'); // data-koyomi 属性なし
    const target = makeOccurrenceElement('a');
    root.appendChild(target);

    const result = captureOccurrenceDeleteFocusContext({
      target,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="month"]',
    });
    expect(result).toBeNull();
  });

  it('DOM 順で対象キーの前後をそれぞれ次/前の予定として記録する', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'month');
    const a = makeOccurrenceElement('a');
    const b = makeOccurrenceElement('b');
    const c = makeOccurrenceElement('c');
    root.append(a, b, c);

    const result = captureOccurrenceDeleteFocusContext({
      target: b,
      occurrenceKey: 'b',
      viewRootSelector: '[data-koyomi="month"]',
    });

    expect(result?.viewRoot).toBe(root);
    expect(result?.nextKey).toBe('c');
    expect(result?.prevKey).toBe('a');
  });

  it('削除対象が DOM 順の先頭の場合、前の予定は null になる', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'month');
    const a = makeOccurrenceElement('a');
    const b = makeOccurrenceElement('b');
    root.append(a, b);

    const result = captureOccurrenceDeleteFocusContext({
      target: a,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="month"]',
    });

    expect(result?.nextKey).toBe('b');
    expect(result?.prevKey).toBeNull();
  });

  it('削除対象が DOM 順の末尾の場合、次の予定は null になる', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'month');
    const a = makeOccurrenceElement('a');
    const b = makeOccurrenceElement('b');
    root.append(a, b);

    const result = captureOccurrenceDeleteFocusContext({
      target: b,
      occurrenceKey: 'b',
      viewRootSelector: '[data-koyomi="month"]',
    });

    expect(result?.nextKey).toBeNull();
    expect(result?.prevKey).toBe('a');
  });

  it('同じキーが複数の DOM 要素に現れる場合（週またぎの帯等）、重複を排除してから前後を求める', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'month');
    const aWeek1 = makeOccurrenceElement('a'); // 週をまたぐ帯の 1 週目
    const b = makeOccurrenceElement('b');
    const aWeek2 = makeOccurrenceElement('a'); // 同じオカレンスの 2 週目
    const c = makeOccurrenceElement('c');
    root.append(aWeek1, b, aWeek2, c);

    const result = captureOccurrenceDeleteFocusContext({
      target: aWeek1,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="month"]',
    });

    // 重複排除後の並びは [a, b, c] になるため、次は b・前はなし
    expect(result?.nextKey).toBe('b');
    expect(result?.prevKey).toBeNull();
  });

  it('FOCUSABLE セルに一致する祖先があれば fallbackCell として記録する', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'month');
    const cell = document.createElement('div');
    cell.setAttribute('data-koyomi', 'month-day');
    cell.setAttribute('data-koyomi-date', '2026-07-08');
    const segment = makeOccurrenceElement('a');
    cell.appendChild(segment);
    root.appendChild(cell);

    const result = captureOccurrenceDeleteFocusContext({
      target: segment,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="month"]',
    });

    expect(result?.fallbackCell).toBe(cell);
  });

  it('FOCUSABLE セルに一致する祖先がなければ fallbackCell は null になる', () => {
    const root = document.createElement('div');
    root.setAttribute('data-koyomi', 'timegrid');
    const segment = makeOccurrenceElement('a');
    root.appendChild(segment);

    const result = captureOccurrenceDeleteFocusContext({
      target: segment,
      occurrenceKey: 'a',
      viewRootSelector: '[data-koyomi="timegrid"]',
    });

    expect(result?.fallbackCell).toBeNull();
  });
});

describe('createOccurrenceDeleteFocusController', () => {
  /** `data-koyomi-occurrence` とフォーカス可能にする `tabIndex` を持つ要素を作る。 */
  function makeOccurrenceElement(key: string): HTMLDivElement {
    const element = document.createElement('div');
    element.setAttribute('data-koyomi-occurrence', key);
    element.tabIndex = 0;
    return element;
  }

  it('consume: 次の予定が DOM に見つかれば、そこへフォーカスを移す', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const b = makeOccurrenceElement('b');
    root.appendChild(b);
    const controller = createOccurrenceDeleteFocusController();

    controller.arm({ viewRoot: root, nextKey: 'b', prevKey: null, fallbackCell: null });
    controller.consume();

    expect(document.activeElement).toBe(b);
    root.remove();
  });

  it('consume: 次の予定が見つからなければ前の予定へフォーカスを移す', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = makeOccurrenceElement('a');
    root.appendChild(a);
    const controller = createOccurrenceDeleteFocusController();

    // next（'b'）は同じオカレンスの削除で DOM から既に消えている想定
    controller.arm({ viewRoot: root, nextKey: 'b', prevKey: 'a', fallbackCell: null });
    controller.consume();

    expect(document.activeElement).toBe(a);
    root.remove();
  });

  it('consume: 次・前のどちらも見つからない場合、fallbackCell（接続中）へフォーカスを移す', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cell = document.createElement('div');
    cell.tabIndex = 0;
    root.appendChild(cell);
    const controller = createOccurrenceDeleteFocusController();

    controller.arm({ viewRoot: root, nextKey: null, prevKey: null, fallbackCell: cell });
    controller.consume();

    expect(document.activeElement).toBe(cell);
    root.remove();
  });

  it('consume: fallbackCell が DOM から切り離されている場合、フォーカスを移さない', () => {
    const root = document.createElement('div');
    root.tabIndex = 0;
    document.body.appendChild(root);
    root.focus();
    expect(document.activeElement).toBe(root);

    const detachedCell = document.createElement('div');
    detachedCell.tabIndex = 0;
    const controller = createOccurrenceDeleteFocusController();

    controller.arm({ viewRoot: root, nextKey: null, prevKey: null, fallbackCell: detachedCell });
    controller.consume();

    expect(document.activeElement).toBe(root); // 変化しない
    root.remove();
  });

  it('arm(null) の場合、consume は何もしない', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = makeOccurrenceElement('a');
    root.appendChild(a);
    a.focus();
    const controller = createOccurrenceDeleteFocusController();

    controller.arm(null);
    controller.consume();

    expect(document.activeElement).toBe(a); // 変化しない
    root.remove();
  });

  it('consume は予約を 1 回消費すると、再度呼んでも何もしない', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = makeOccurrenceElement('a');
    const b = makeOccurrenceElement('b');
    root.append(a, b);
    const controller = createOccurrenceDeleteFocusController();

    controller.arm({ viewRoot: root, nextKey: 'b', prevKey: null, fallbackCell: null });
    controller.consume();
    expect(document.activeElement).toBe(b);

    a.focus(); // フォーカスを a に戻す
    controller.consume(); // 予約は既に消費済みのため何もしない

    expect(document.activeElement).toBe(a);
    root.remove();
  });
});

describe('reportOperationRejected', () => {
  it('onOperationRejected が指定されていれば、渡された拒否内容でそのまま呼ばれる', () => {
    const onOperationRejected = vi.fn();
    const occurrence = makeOccurrence();
    const rejection: OperationRejection = { action: 'move', reason: 'constraint', occurrence };

    reportOperationRejected({ onOperationRejected }, rejection);

    expect(onOperationRejected).toHaveBeenCalledTimes(1);
    expect(onOperationRejected).toHaveBeenCalledWith(rejection);
  });

  it('occurrence を持たない拒否内容（action: "create"）もそのまま渡す', () => {
    const onOperationRejected = vi.fn();
    const rejection: OperationRejection = { action: 'create', reason: 'rejected' };

    reportOperationRejected({ onOperationRejected }, rejection);

    expect(onOperationRejected).toHaveBeenCalledWith(rejection);
  });

  it('onOperationRejected 未指定、または callbacks 自体が省略されている場合は何もしない（例外を投げない）', () => {
    const rejection: OperationRejection = { action: 'delete', reason: 'rejected' };

    expect(() => reportOperationRejected({}, rejection)).not.toThrow();
    expect(() => reportOperationRejected(undefined, rejection)).not.toThrow();
  });
});
