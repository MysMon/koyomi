/**
 * use-resource-grid-drag.ts のテスト。
 *
 * `ResourceView` を `CalendarProvider` 配下で描画し、実際の DOM に対する
 * pointerdown → pointermove → pointerup / keydown のディスパッチを通じて
 * フックの挙動を検証する（`resource-view.test.tsx` と同じハーネス流儀）。
 *
 * 列（`data-koyomi="resource-column"`）の `getBoundingClientRect` をモックし、
 * 列の幅 100px・高さ 1440px（= 1 分 1px）として、clientX で列、clientY で
 * 日内の分を指定できるようにする（`use-time-grid-drag.test.tsx` の手法を踏襲）。
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseDateValue } from '../core/timezone';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  RecurringEditScope,
} from '../core/types';
import { ResourceView } from './components/resource-view';
import { CalendarProvider } from './context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import { useResourceGridDrag } from './use-resource-grid-drag';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** リソースビューの表示日（NOW の属する日）。 */
const DAY = '2026-07-15';
/** DAY の前日（日をまたぐオカレンスの検証用）。 */
const PREV_DAY = '2026-07-14';
/** DAY の翌日（日をまたぐオカレンスの検証用）。 */
const NEXT_DAY = '2026-07-16';

/** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** 2 リソース分の固定フィクスチャ。 */
const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A' };
const ROOM_B: CalendarResource = { id: 'room-b', title: '会議室B' };
const ROOM_C: CalendarResource = { id: 'room-c', title: '会議室C' };

/** 列の幅（px）。列ごとに重ならない範囲を割り当てる。 */
const COLUMN_WIDTH = 100;
/** 列の高さ（px）。1440px = 24h とし、clientY(px) がそのまま「日内の分」になるようにする。 */
const COLUMN_HEIGHT = 1440;

/** テスト用ハーネスの props。 */
interface HarnessProps {
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
  unassignedLane?: 'auto' | 'always';
  callbacks?: CalendarInteractionCallbacks;
  snapMinutes?: number;
  defaultEventMinutes?: number;
  slotMinTime?: string;
  slotMaxTime?: string;
  eventOverlap?: boolean;
  eventConstraint?: 'businessHours' | readonly BusinessHoursRule[];
  businessHours?: readonly BusinessHoursRule[];
  resourceViewDays?: number;
  sink?: { current: UseCalendarResult | null };
}

/** `ResourceView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'resource',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_EVENTS,
    unassignedLane: props.unassignedLane ?? 'auto',
    ...(props.snapMinutes !== undefined ? { snapMinutes: props.snapMinutes } : {}),
    ...(props.defaultEventMinutes !== undefined
      ? { defaultEventMinutes: props.defaultEventMinutes }
      : {}),
    ...(props.slotMinTime !== undefined ? { slotMinTime: props.slotMinTime } : {}),
    ...(props.slotMaxTime !== undefined ? { slotMaxTime: props.slotMaxTime } : {}),
    ...(props.eventOverlap !== undefined ? { eventOverlap: props.eventOverlap } : {}),
    ...(props.eventConstraint !== undefined ? { eventConstraint: props.eventConstraint } : {}),
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
    ...(props.resourceViewDays !== undefined ? { resourceViewDays: props.resourceViewDays } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <ResourceView />
    </CalendarProvider>
  );
}

/** テスト用カレンダー＋ハーネスを描画するヘルパ。 */
function renderHarness(options: HarnessProps = {}): {
  container: HTMLElement;
  sink: { current: UseCalendarResult | null };
} {
  const sink: { current: UseCalendarResult | null } = { current: null };
  const { container } = render(<Harness {...options} sink={sink} />);
  return { container, sink };
}

/** 列（`resource-column`）の `getBoundingClientRect` を固定矩形にモックする（DOM 順 = 列順）。 */
function mockAllColumnRects(container: HTMLElement): void {
  const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
  columns.forEach((element, index) => {
    vi.spyOn(element as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        x: index * COLUMN_WIDTH,
        y: 0,
        width: COLUMN_WIDTH,
        height: COLUMN_HEIGHT,
      }),
    );
  });
}

/** 指定インデックスの列の中心 clientX を返す。 */
function columnCenterX(index: number): number {
  return index * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

/** オカレンスキー（`${eventId}@${開始時刻の ISO 文字列}`）から要素を取得する。 */
function getEventElement(container: HTMLElement, eventId: string, startIso: string): HTMLElement {
  const key = `${eventId}@${at(startIso).toISOString()}`;
  const element = container.querySelector(`[data-koyomi-occurrence="${key}"]`);
  if (element === null) {
    throw new Error(`イベント要素が見つかりません: ${key}`);
  }
  return element as HTMLElement;
}

/**
 * React 要素への pointerdown ディスパッチ。
 * jsdom は `PointerEvent` 未実装のため、`MouseEvent` を `'pointerdown'` として
 * 明示的に生成しディスパッチする（`use-time-grid-drag.test.tsx` と同じ手法）。
 */
function firePointerDown(element: Element, clientX: number, clientY: number): void {
  fireEvent(
    element,
    new MouseEvent('pointerdown', { clientX, clientY, button: 0, bubbles: true, cancelable: true }),
  );
}

/** document への pointermove ディスパッチ（同期）。 */
function movePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
  });
}

/** document への pointerup ディスパッチ（同期）。 */
function releasePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, bubbles: true }));
  });
}

/** document への Escape キー押下ディスパッチ。 */
function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** document への pointercancel ディスパッチ（`use-time-grid-drag.test.tsx` と同じ手法）。 */
function firePointerCancel(): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
  });
}

describe('useResourceGridDrag - 作成', () => {
  it('空き領域のクリック（移動なし）で defaultEventMinutes 分の長さの既定作成に選択列の resourceId が付く', () => {
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      defaultEventMinutes: 45,
    });
    mockAllColumnRects(container);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    const roomBColumn = columns[1];
    if (roomBColumn === undefined) {
      throw new Error('room-b 列が見つかりません');
    }
    const x = columnCenterX(1);

    firePointerDown(roomBColumn, x, 600); // 10:00
    releasePointer(x, 600); // 移動なし → クリック扱い

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      end: at(`${DAY}T10:45`),
      resourceId: 'room-b',
    });
  });

  it('onSelectRange 指定時は選択列の resourceId 付きの RangeSelection で呼ばれ、既定作成は行われない', () => {
    const onSelectRange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      callbacks: { onSelectRange },
    });
    mockAllColumnRects(container);
    const roomAColumn = container.querySelectorAll('[data-koyomi="resource-column"]')[0];
    if (roomAColumn === undefined) {
      throw new Error('room-a 列が見つかりません');
    }
    const x = columnCenterX(0);

    firePointerDown(roomAColumn, x, 600); // 10:00
    movePointer(x, 690); // 11:30
    releasePointer(x, 690);

    expect(onSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${DAY}T10:00`), end: at(`${DAY}T11:30`) },
      allDay: false,
      resourceId: 'room-a',
    });
    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });

  it('終日セルのクリックで allDay: true・当日 1 日・選択列の resourceId 付きのイベントが作成される', () => {
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B] });
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    const roomBCell = allDayCells[1];
    if (roomBCell === undefined) {
      throw new Error('room-b の終日セルが見つかりません');
    }

    fireEvent.click(roomBCell);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${DAY}T00:00`),
      end: at('2026-07-16T00:00'),
      resourceId: 'room-b',
    });
  });

  it('終日セルはフォーカス可能で、Enter を押すと allDay: true・当日 1 日・選択列の resourceId 付きのイベントが作成される', () => {
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B] });
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    const roomBCell = allDayCells[1];
    if (roomBCell === undefined) {
      throw new Error('room-b の終日セルが見つかりません');
    }
    expect(roomBCell).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(roomBCell, { key: 'Enter' });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${DAY}T00:00`),
      end: at('2026-07-16T00:00'),
      resourceId: 'room-b',
    });
  });

  it('終日セルで Space キーを押しても同様にイベントが作成される', () => {
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B] });
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    const roomBCell = allDayCells[1];
    if (roomBCell === undefined) {
      throw new Error('room-b の終日セルが見つかりません');
    }

    fireEvent.keyDown(roomBCell, { key: ' ' });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${DAY}T00:00`),
      end: at('2026-07-16T00:00'),
      resourceId: 'room-b',
    });
  });

  it('終日アイテムのボタンで Enter を押しても、セル（終日セル）の作成は二重発火しない', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-keep',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const onEventClick = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onEventClick },
    });
    const allDayItemEl = container.querySelector('[data-koyomi="allday-event"]');
    if (allDayItemEl === null) {
      throw new Error('終日アイテムが見つかりません');
    }

    fireEvent.keyDown(allDayItemEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    // セル側の作成が二重発火していれば room-a に当日分の新規イベントが増える
    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });
});

describe('useResourceGridDrag - 移動・リサイズ', () => {
  it('イベントドラッグで列をまたぐと時間と resourceId の変更が 1 回の updateEvent に合成され、onEventChange にも resourceId が入る', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-move',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-move', `${DAY}T10:00`);
    if (sink.current === null) {
      throw new Error('sink が設定されていません');
    }
    const updateEventSpy = vi.spyOn(sink.current.api, 'updateEvent');

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a 列 10:00 を掴む
    movePointer(columnCenterX(1), 660); // room-b 列 11:00 へ（+1h）
    releasePointer(columnCenterX(1), 660);

    expect(updateEventSpy).toHaveBeenCalledTimes(1);
    expect(updateEventSpy).toHaveBeenCalledWith(
      'ev-move',
      { start: at(`${DAY}T11:00`), end: at(`${DAY}T12:00`), resourceId: 'room-b' },
      undefined,
    );
    const events = sink.current.api.getEvents();
    expect(events[0]).toMatchObject({
      resourceId: 'room-b',
      start: at(`${DAY}T11:00`),
      end: at(`${DAY}T12:00`),
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-move' }),
      newRange: { start: at(`${DAY}T11:00`), end: at(`${DAY}T12:00`) },
      allDay: false,
      scope: null,
      resourceId: 'room-b',
      // 単発イベントの移動では、変更前（event）・変更後（events[0]）の
      // before/after が 1 件のみ含まれる
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('未割り当て列へドロップすると resourceId がパッチで削除される（イベントから resourceId が消える）', () => {
    const event: CalendarEvent = {
      id: 'ev-unassign',
      title: '会議',
      start: `${DAY}T09:00`,
      end: `${DAY}T10:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      unassignedLane: 'always',
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-unassign', `${DAY}T09:00`);

    firePointerDown(eventEl, columnCenterX(0), 540); // room-a 列 9:00
    movePointer(columnCenterX(1), 540); // 未割り当て列（時間は変えない）
    releasePointer(columnCenterX(1), 540);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('resourceId');
    expect(events[0]).toMatchObject({ start: at(`${DAY}T09:00`), end: at(`${DAY}T10:00`) });
  });

  it('リサイズは時間のみ変更し、ポインタが別列に入っても resourceId は不変', () => {
    const event: CalendarEvent = {
      id: 'ev-resize',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-resize', `${DAY}T10:00`);
    const handleEl = eventEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handleEl === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    firePointerDown(handleEl, columnCenterX(0), 660); // room-a 列 11:00（終了端）
    movePointer(columnCenterX(1), 720); // room-b 列 12:00 へ（列は無視される）
    releasePointer(columnCenterX(1), 720);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      end: at(`${DAY}T12:00`),
      resourceId: 'room-a',
    });
  });

  it('editable: false のイベントはドラッグを開始しない（変更されない）', () => {
    const event: CalendarEvent = {
      id: 'ev-locked',
      title: '固定',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
      editable: false,
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-locked', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600);
    movePointer(columnCenterX(1), 720);
    releasePointer(columnCenterX(1), 720);

    const events = sink.current?.api.getEvents() ?? [];
    // 変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    });
    expect(sink.current?.state.dragPreview).toBeNull();
  });
});

describe('useResourceGridDrag - 複数リソース割当（resourceIds）', () => {
  /** 指定レーンの列内にあるオカレンス要素を取得する（複数レーンに同一オカレンスが表示されるため）。 */
  function getEventElementInLane(
    container: HTMLElement,
    laneKey: string,
    eventId: string,
    startIso: string,
  ): HTMLElement {
    const key = `${eventId}@${at(startIso).toISOString()}`;
    const element = container.querySelector(
      `[data-koyomi="resource-column"][data-koyomi-resource="${laneKey}"] [data-koyomi-occurrence="${key}"]`,
    );
    if (element === null) {
      throw new Error(`レーン ${laneKey} 内にイベント要素が見つかりません: ${key}`);
    }
    return element as HTMLElement;
  }

  it('ドラッグしたレーンの割当だけが移動先に変わり、他のレーンの割当は保持される', () => {
    const event: CalendarEvent = {
      id: 'ev-multi',
      title: '全体会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceIds: ['room-a', 'room-c'],
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B, ROOM_C],
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElementInLane(container, 'r:room-a', 'ev-multi', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a 列 10:00 を掴む
    movePointer(columnCenterX(1), 600); // room-b 列へ（時間は不変）
    releasePointer(columnCenterX(1), 600);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]?.resourceIds).toEqual(['room-b', 'room-c']);
    expect(events[0]).not.toHaveProperty('resourceId');
  });

  it('未割り当て列へドロップするとドラッグしたレーンの割当だけが外れる', () => {
    const event: CalendarEvent = {
      id: 'ev-multi-unassign',
      title: '全体会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceIds: ['room-a', 'room-b'],
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      unassignedLane: 'always',
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElementInLane(
      container,
      'r:room-b',
      'ev-multi-unassign',
      `${DAY}T10:00`,
    );

    firePointerDown(eventEl, columnCenterX(1), 600); // room-b 列を掴む
    movePointer(columnCenterX(2), 600); // 未割り当て列へ
    releasePointer(columnCenterX(2), 600);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]?.resourceIds).toEqual(['room-a']);
  });

  it('ArrowRight でフォーカス中のレーンの割当だけが隣の列へ移る', async () => {
    const event: CalendarEvent = {
      id: 'ev-multi-key',
      title: '全体会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceIds: ['room-a', 'room-c'],
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B, ROOM_C],
      events: [event],
    });
    const eventEl = getEventElementInLane(container, 'r:room-a', 'ev-multi-key', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]?.resourceIds).toEqual(['room-b', 'room-c']);
    // 時間は不変
    expect(events[0]).toMatchObject({ start: `${DAY}T10:00`, end: `${DAY}T11:00` });
  });

  it('移動先がすでに割当済みのレーンなら割当が統合される（重複しない）', async () => {
    const event: CalendarEvent = {
      id: 'ev-multi-merge',
      title: '全体会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceIds: ['room-a', 'room-b'],
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
    });
    const eventEl = getEventElementInLane(container, 'r:room-a', 'ev-multi-merge', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]?.resourceIds).toEqual(['room-b']);
  });
});

describe('useResourceGridDrag - 表示時間帯制限（slotMinTime/slotMaxTime）', () => {
  it('空き領域のクリック位置が範囲外でも、作成位置は slotMinTime にクランプされる', () => {
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      slotMinTime: '08:00',
      slotMaxTime: '20:00',
    });
    mockAllColumnRects(container);
    const column = container.querySelector('[data-koyomi="resource-column"]');
    if (column === null) {
      throw new Error('room-a 列が見つかりません');
    }
    const x = columnCenterX(0);

    firePointerDown(column, x, 0); // 範囲外なら 00:00 だが 08:00 にクランプされるはず
    releasePointer(x, 0);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T08:00`),
      end: at(`${DAY}T09:00`),
      resourceId: 'room-a',
    });
  });

  it('既存イベントのリサイズ（下端）で範囲外までドラッグしても終了時刻が slotMaxTime 未満にクランプされる', () => {
    const event: CalendarEvent = {
      id: 'ev-resource-clamp-resize',
      title: '会議',
      start: `${DAY}T18:00`,
      end: `${DAY}T19:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      slotMinTime: '08:00',
      slotMaxTime: '20:00',
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-resource-clamp-resize', `${DAY}T18:00`);
    const resizeHandle = eventEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (resizeHandle === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }
    const x = columnCenterX(0);

    firePointerDown(resizeHandle, x, 1080);
    movePointer(x, 1440); // 範囲外（24:00 相当）だが 19:45 にクランプされるはず
    releasePointer(x, 1440);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T18:00`), end: at(`${DAY}T19:45`) });
  });

  it('矢印キーによる移動は slotMinTime/slotMaxTime の範囲外でも適用される（意図的にクランプしない）', () => {
    const event: CalendarEvent = {
      id: 'ev-resource-arrow-no-clamp',
      title: '会議',
      start: `${DAY}T19:45`,
      end: `${DAY}T20:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      slotMinTime: '08:00',
      slotMaxTime: '20:00',
    });
    const eventEl = getEventElement(container, 'ev-resource-arrow-no-clamp', `${DAY}T19:45`);

    act(() => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' }); // +15 分 → 20:00〜20:15（表示時間帯の外）
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T20:00`), end: at(`${DAY}T20:15`) });
  });
});

describe('useResourceGridDrag - 追加通知（onEventDoubleClick / onEventContextMenu / onEventHover / onEventHoverEnd）', () => {
  const EVENT: CalendarEvent = {
    id: 'ev-notify',
    title: '会議',
    start: `${DAY}T10:00`,
    end: `${DAY}T11:00`,
    resourceId: 'room-a',
  };

  it('ダブルクリックで onEventDoubleClick がオカレンスと nativeEvent を受け取る', () => {
    const onEventDoubleClick = vi.fn();
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [EVENT],
      callbacks: { onEventDoubleClick },
    });
    const eventEl = getEventElement(container, 'ev-notify', `${DAY}T10:00`);

    fireEvent.dblClick(eventEl);

    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
    expect(onEventDoubleClick.mock.calls[0]?.[0]?.event.title).toBe('会議');
    expect(onEventDoubleClick.mock.calls[0]?.[1]).toBeInstanceOf(MouseEvent);
  });

  it('コンテキストメニュー操作で onEventContextMenu が呼ばれ、ライブラリは preventDefault しない', () => {
    const onEventContextMenu = vi.fn();
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [EVENT],
      callbacks: { onEventContextMenu },
    });
    const eventEl = getEventElement(container, 'ev-notify', `${DAY}T10:00`);

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(contextMenuEvent, 'preventDefault');
    fireEvent(eventEl, contextMenuEvent);

    expect(onEventContextMenu).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('pointerover/pointerout（外部要素からの出入り）で onEventHover / onEventHoverEnd が呼ばれる', () => {
    const onEventHover = vi.fn();
    const onEventHoverEnd = vi.fn();
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [EVENT],
      callbacks: { onEventHover, onEventHoverEnd },
    });
    const eventEl = getEventElement(container, 'ev-notify', `${DAY}T10:00`);
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent(eventEl, new MouseEvent('pointerover', { bubbles: true, relatedTarget: outside }));
    expect(onEventHover).toHaveBeenCalledTimes(1);

    fireEvent(eventEl, new MouseEvent('pointerout', { bubbles: true, relatedTarget: outside }));
    expect(onEventHoverEnd).toHaveBeenCalledTimes(1);
  });

  it('コールバック未指定時は getEventProps() のキー集合が従来と完全一致する（追加通知系のキーを含まない）', () => {
    const { result } = renderHook(() => {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'resource',
        events: [EVENT],
        resources: [ROOM_A],
      });
      const drag = useResourceGridDrag({ calendar });
      return { calendar, drag };
    });

    const { viewModel } = result.current.calendar;
    if (viewModel.type !== 'resource') {
      throw new Error('テストはリソースビューを前提とする');
    }
    const item = viewModel.columns
      .flatMap((column) => column.items)
      .find((positioned) => positioned.occurrence.eventId === 'ev-notify');
    if (item === undefined) {
      throw new Error('アイテムが見つかりません');
    }

    const props = result.current.drag.getEventProps(item);

    expect(Object.keys(props).sort()).toEqual(
      ['data-koyomi-occurrence', 'onClick', 'onKeyDown', 'onPointerDown', 'tabIndex'].sort(),
    );
  });
});

describe('useResourceGridDrag - 終日アイテムの列間移動', () => {
  it('終日アイテムのドラッグで列（resourceId）だけが変わり、時間は不変', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-allday',
      title: '休暇',
      start: DAY,
      end: '2026-07-16',
      allDay: true,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllColumnRects(container);
    const allDayItemEl = container.querySelector('[data-koyomi="allday-event"]');
    if (allDayItemEl === null) {
      throw new Error('終日アイテムが見つかりません');
    }

    firePointerDown(allDayItemEl, columnCenterX(0), 10);
    movePointer(columnCenterX(1), 10);
    releasePointer(columnCenterX(1), 10);

    const events = sink.current?.api.getEvents() ?? [];
    // 時間は変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      resourceId: 'room-b',
      allDay: true,
      start: DAY,
      end: '2026-07-16',
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-allday' }),
      newRange: { start: at(`${DAY}T00:00`), end: at('2026-07-16T00:00') },
      allDay: true,
      scope: null,
      resourceId: 'room-b',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });
});

describe('useResourceGridDrag - キーボード操作', () => {
  it('ArrowDown で snapMinutes 分だけ後ろに移動し、resourceId は不変', async () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-arrow-down',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onEventChange },
    });
    const eventEl = getEventElement(container, 'ev-arrow-down', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:15`),
      end: at(`${DAY}T11:15`),
      resourceId: 'room-a',
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-arrow-down' }),
      newRange: { start: at(`${DAY}T10:15`), end: at(`${DAY}T11:15`) },
      allDay: false,
      scope: null,
      resourceId: 'room-a',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('Shift+ArrowDown で終了時刻だけが snapMinutes 分延長される', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-arrow',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    const eventEl = getEventElement(container, 'ev-shift-arrow', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      end: at(`${DAY}T11:15`),
      resourceId: 'room-a',
    });
  });

  it('ArrowRight で隣のリソース列へ移動する（時間は不変）', async () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-arrow-right',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onEventChange },
    });
    const eventEl = getEventElement(container, 'ev-arrow-right', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    // 時間は変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      resourceId: 'room-b',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-arrow-right' }),
      newRange: { start: at(`${DAY}T10:00`), end: at(`${DAY}T11:00`) },
      allDay: false,
      scope: null,
      resourceId: 'room-b',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('先頭列で ArrowLeft を押しても隣列が無いため何も変更しない', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-left-boundary',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    const eventEl = getEventElement(container, 'ev-arrow-left-boundary', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowLeft' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ resourceId: 'room-a' });
  });

  it('矢印キー: editable: false のイベントは無視される', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-locked',
      title: '固定',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
      editable: false,
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    const eventEl = getEventElement(container, 'ev-arrow-locked', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });
    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    // 変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    });
  });

  it('Enter キーで onEventClick 相当のクリックが発火する', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-enter',
      title: '会議',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      callbacks: { onEventClick },
    });
    const eventEl = getEventElement(container, 'ev-enter', `${DAY}T09:00`);

    fireEvent.keyDown(eventEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ eventId: 'ev-enter' }),
    );
  });

  it('Delete キーで単発の予定が削除される', () => {
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-delete',
      title: '会議',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      callbacks: { onEventDelete },
    });
    const eventEl = getEventElement(container, 'ev-delete', `${DAY}T09:00`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
    expect(onEventDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence: expect.objectContaining({ eventId: 'ev-delete' }),
        scope: null,
      }),
    );
  });

  it('ArrowUp で snapMinutes 分だけ前に移動する', async () => {
    const event: CalendarEvent = {
      id: 'ev-up',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A], events: [event] });
    const eventEl = getEventElement(container, 'ev-up', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowUp' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T09:45`), end: at(`${DAY}T10:45`) });
  });

  it('Shift+ArrowUp で終了時刻が snapMinutes 分だけ短縮される', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-up',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A], events: [event] });
    const eventEl = getEventElement(container, 'ev-shift-up', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowUp', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T10:00`), end: at(`${DAY}T10:45`) });
  });

  it('先頭以外の列で ArrowLeft を押すと隣（前）のリソース列へ移動する', async () => {
    const event: CalendarEvent = {
      id: 'ev-left',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-b',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B, ROOM_C],
      events: [event],
    });
    const eventEl = getEventElement(container, 'ev-left', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowLeft' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      resourceId: 'room-a',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
    });
  });

  it('繰り返し予定を矢印キーで移動しようとすると resolveRecurringScope が action: "move" で呼ばれる（リソース移動も this / thisAndFollowing / all の選択対象）', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const event: CalendarEvent = {
      id: 'recurring-resource-move',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'room-a',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { resolveRecurringScope },
    });
    const eventEl = getEventElement(container, 'recurring-resource-move', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-resource-move' }),
      'move',
    );
    const override = (sink.current?.api.getEvents() ?? []).find(
      (candidate) => candidate.recurringEventId === 'recurring-resource-move',
    );
    expect(override).toMatchObject({ start: at(`${DAY}T10:15`), end: at(`${DAY}T11:15`) });
  });

  it('繰り返し予定を Delete キーで削除しようとすると resolveRecurringScope が action: "delete" で呼ばれる', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-resource-delete',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'room-a',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      callbacks: { resolveRecurringScope, onEventDelete },
    });
    const eventEl = getEventElement(container, 'recurring-resource-delete', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'Delete' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-resource-delete' }),
      'delete',
    );
    expect(onEventDelete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'this' }));
  });
});

describe('useResourceGridDrag - Escape キャンセル', () => {
  it('Escape でドラッグをキャンセルする（イベントは変更されない）', () => {
    const event: CalendarEvent = {
      id: 'ev-escape',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-escape', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600);
    movePointer(columnCenterX(1), 720);
    expect(sink.current?.state.dragPreview).not.toBeNull();

    pressEscape();
    expect(sink.current?.state.dragPreview).toBeNull();

    // Escape 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(columnCenterX(1), 720);

    const events = sink.current?.api.getEvents() ?? [];
    // 変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    });
  });
});

describe('useResourceGridDrag - 参照先のない resourceId の正規化（Codex 再レビュー回帰）', () => {
  it('参照先のないリソース ID を持つ予定は未割り当てレーン扱いになり、←キーで隣のリソース列へ移動できる', () => {
    // resources に存在しない 'ghost' を持つ予定 → 未割り当て列（末尾）に表示される。
    // 現在レーン = 未割り当て（null）と正規化されていれば、← で左隣（room-b）へ移動できる
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [
        {
          id: 'orphan-1',
          title: '会議',
          start: `${DAY}T10:00`,
          end: `${DAY}T11:00`,
          resourceId: 'ghost',
        },
      ],
    });
    const eventButton = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventButton).toBeInstanceOf(HTMLElement);
    if (!(eventButton instanceof HTMLElement)) {
      throw new Error('イベントが見つかりません');
    }
    fireEvent.keyDown(eventButton, { key: 'ArrowLeft' });
    // 単発イベントのキーボード変更は同期的に完結するため、直接検証できる
    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]?.resourceId).toBe('room-b');
  });
});

describe('useResourceGridDrag - previewFor（ドラッグプレビューの列別表示）', () => {
  it('作成ドラッグ中、対象列にのみ timegrid-preview が出現し、対象外の列には出ない', () => {
    const { container } = renderHarness({ resources: [ROOM_A, ROOM_B] });
    mockAllColumnRects(container);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    const roomAColumn = columns[0];
    if (roomAColumn === undefined) {
      throw new Error('room-a 列が見つかりません');
    }
    const x = columnCenterX(0);

    firePointerDown(roomAColumn, x, 600); // 10:00
    movePointer(x, 690); // 11:30

    const preview = roomAColumn.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'create');
    const style = (preview as HTMLElement).style;
    expect(style.top).toContain('41.66');
    expect(style.height).toBe('6.25%'); // (690-600)/1440*100

    // 対象外の列（room-b）にはプレビューが出ない
    expect(columns[1]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();

    releasePointer(x, 690);
  });

  it('移動ドラッグで列をまたぐと、元の列のプレビューは消え、移動先の列にのみ出現する', () => {
    const event: CalendarEvent = {
      id: 'ev-move-preview',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-move-preview', `${DAY}T10:00`);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a 列 10:00 を掴む
    movePointer(columnCenterX(1), 660); // room-b 列 11:00 へ（+1h）

    // 元の列（room-a）にはプレビューが残らない
    expect(columns[0]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();
    const preview = columns[1]?.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'move');
    const style = (preview as HTMLElement).style;
    expect(style.top).toContain('45.83');
    expect(style.height).toContain('4.16');

    releasePointer(columnCenterX(1), 660);
  });

  it('前日から続くオカレンスをリサイズすると、プレビュー開始が日の 0 分（top: 0%）にクランプされる', () => {
    const event: CalendarEvent = {
      id: 'ev-continues-before',
      title: '夜間作業',
      start: `${PREV_DAY}T22:00`,
      end: `${DAY}T02:00`,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({ resources: [ROOM_A], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-continues-before', `${PREV_DAY}T22:00`);
    const handleEl = eventEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handleEl === null) {
      throw new Error('終了端のリサイズハンドルが見つかりません');
    }
    const column = container.querySelector('[data-koyomi="resource-column"]');
    if (column === null) {
      throw new Error('列が見つかりません');
    }

    firePointerDown(handleEl, columnCenterX(0), 600);
    movePointer(columnCenterX(0), 720); // 12:00

    const preview = column.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    const style = (preview as HTMLElement).style;
    // 実際の開始（前日22:00）は表示日より前のため 0% にクランプされる
    expect(style.top).toBe('0%');
    expect(style.height).toBe('50%'); // (720-0)/1440*100

    releasePointer(columnCenterX(0), 720);
  });

  it('翌日へ続くオカレンスをリサイズすると、プレビュー終了が終端（0〜1440 分の 1440 分側）にクランプされる', () => {
    const event: CalendarEvent = {
      id: 'ev-continues-after',
      title: '夜間作業',
      start: `${DAY}T22:00`,
      end: `${NEXT_DAY}T02:00`,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({ resources: [ROOM_A], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-continues-after', `${DAY}T22:00`);
    const handleEl = eventEl.querySelector('[data-koyomi-resize-handle="start"]');
    if (handleEl === null) {
      throw new Error('開始端のリサイズハンドルが見つかりません');
    }
    const column = container.querySelector('[data-koyomi="resource-column"]');
    if (column === null) {
      throw new Error('列が見つかりません');
    }

    firePointerDown(handleEl, columnCenterX(0), 1320);
    movePointer(columnCenterX(0), 1080); // 18:00

    const preview = column.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    const style = (preview as HTMLElement).style;
    expect(style.top).toBe('75%'); // 1080/1440*100
    // 実際の終了（翌日02:00）は表示日より後のため 1440 分側（height 込みで 100%）にクランプされる
    expect(style.height).toBe('25%'); // (1440-1080)/1440*100

    releasePointer(columnCenterX(0), 1080);
  });
});

describe('useResourceGridDrag - isAllDayPreviewTarget（終日プレビューの対象列）', () => {
  it('終日アイテムの列間移動中、移動先の列にのみ data-koyomi-preview-target が付く', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-preview',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const allDayItemEl = container.querySelector('[data-koyomi="allday-event"]');
    if (allDayItemEl === null) {
      throw new Error('終日アイテムが見つかりません');
    }
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');

    firePointerDown(allDayItemEl, columnCenterX(0), 10);
    movePointer(columnCenterX(1), 10);

    expect(allDayCells[0]).not.toHaveAttribute('data-koyomi-preview-target');
    expect(allDayCells[1]).toHaveAttribute('data-koyomi-preview-target', 'true');

    releasePointer(columnCenterX(1), 10);
  });
});

describe('useResourceGridDrag - pointercancel によるキャンセル', () => {
  it('ドラッグ中に pointercancel が発生するとキャンセルされ、イベントは変更されない（コミットもされない）', () => {
    const event: CalendarEvent = {
      id: 'ev-pointercancel',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({ resources: [ROOM_A, ROOM_B], events: [event] });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-pointercancel', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600);
    movePointer(columnCenterX(1), 720);
    expect(sink.current?.state.dragPreview).not.toBeNull();

    firePointerCancel();

    expect(sink.current?.state.dragPreview).toBeNull();

    // pointercancel 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(columnCenterX(1), 720);

    const events = sink.current?.api.getEvents() ?? [];
    // 変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    });
  });
});

describe('useResourceGridDrag - 適用前フック（onBeforeSelectRange / onBeforeEventChange / onBeforeEventDelete）', () => {
  it('onBeforeSelectRange が false を返すと、空き領域のクリック作成は行われず onSelectRange も呼ばれない', () => {
    const onBeforeSelectRange = vi.fn().mockReturnValue(false);
    const onSelectRange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      callbacks: { onBeforeSelectRange, onSelectRange },
    });
    mockAllColumnRects(container);
    const roomBColumn = container.querySelectorAll('[data-koyomi="resource-column"]')[1];
    if (roomBColumn === undefined) {
      throw new Error('room-b 列が見つかりません');
    }
    const x = columnCenterX(1);

    firePointerDown(roomBColumn, x, 600); // 10:00
    releasePointer(x, 600);

    expect(onBeforeSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${DAY}T10:00`), end: at(`${DAY}T11:00`) },
      allDay: false,
      resourceId: 'room-b',
    });
    expect(onSelectRange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });

  it('onBeforeSelectRange が Promise<false> を返す場合も、終日セルのクリック作成が拒否される', async () => {
    const onBeforeSelectRange = vi.fn().mockResolvedValue(false);
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      callbacks: { onBeforeSelectRange },
    });
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    const roomBCell = allDayCells[1];
    if (roomBCell === undefined) {
      throw new Error('room-b の終日セルが見つかりません');
    }

    await act(async () => {
      fireEvent.click(roomBCell);
    });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });

  it('onBeforeSelectRange が true を返す（または省略する）と従来どおり作成される', () => {
    const onBeforeSelectRange = vi.fn().mockReturnValue(true);
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      callbacks: { onBeforeSelectRange },
    });
    mockAllColumnRects(container);
    const roomBColumn = container.querySelectorAll('[data-koyomi="resource-column"]')[1];
    if (roomBColumn === undefined) {
      throw new Error('room-b 列が見つかりません');
    }
    const x = columnCenterX(1);

    firePointerDown(roomBColumn, x, 600);
    releasePointer(x, 600);

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('onBeforeEventChange が false を返すと、列をまたぐ移動は適用されず onEventChange も呼ばれない', () => {
    const onBeforeEventChange = vi.fn().mockReturnValue(false);
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-change-move',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onBeforeEventChange, onEventChange },
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-before-change-move', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a 10:00
    movePointer(columnCenterX(1), 660); // room-b 11:00
    releasePointer(columnCenterX(1), 660);

    expect(onBeforeEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-before-change-move' }),
      range: { start: at(`${DAY}T11:00`), end: at(`${DAY}T12:00`) },
      allDay: false,
      resourceId: 'room-b',
      action: 'move',
    });
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toEqual([event]);
  });

  it('onBeforeEventChange が Promise<false> を返すと、終日アイテムの列間移動（allday-move、action: "move"）も適用されない', async () => {
    const onBeforeEventChange = vi.fn().mockResolvedValue(false);
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-change-allday',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onBeforeEventChange, onEventChange },
    });
    mockAllColumnRects(container);
    const allDayItemEl = container.querySelector('[data-koyomi="allday-event"]');
    if (allDayItemEl === null) {
      throw new Error('終日アイテムが見つかりません');
    }

    firePointerDown(allDayItemEl, columnCenterX(0), 10);
    movePointer(columnCenterX(1), 10);
    await act(async () => {
      releasePointer(columnCenterX(1), 10);
    });

    expect(onBeforeEventChange).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, resourceId: 'room-b', action: 'move' }),
    );
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toEqual([event]);
  });

  it('onBeforeEventChange が false を返すと、矢印キーによる移動（キーボード）も適用されない', async () => {
    const onBeforeEventChange = vi.fn().mockReturnValue(false);
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-change-arrow',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onBeforeEventChange, onEventChange },
    });
    const eventEl = getEventElement(container, 'ev-before-change-arrow', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    expect(onBeforeEventChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'move' }));
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toEqual([event]);
  });

  it('onBeforeEventDelete が false を返すと、キーボード削除は適用されず onEventDelete も呼ばれない', () => {
    const onBeforeEventDelete = vi.fn().mockReturnValue(false);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-delete',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onBeforeEventDelete, onEventDelete },
    });
    const eventEl = getEventElement(container, 'ev-before-delete', `${DAY}T10:00`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(onBeforeEventDelete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'ev-before-delete' }),
    );
    expect(onEventDelete).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('onBeforeEventDelete が Promise<false> を返す場合も削除は適用されない', async () => {
    const onBeforeEventDelete = vi.fn().mockResolvedValue(false);
    const event: CalendarEvent = {
      id: 'ev-before-delete-async',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [event],
      callbacks: { onBeforeEventDelete },
    });
    const eventEl = getEventElement(container, 'ev-before-delete-async', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'Backspace' });
    });

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });
});

describe('useResourceGridDrag - 宣言的な重なり・配置制約', () => {
  it('eventOverlap: false では同一列内で既存イベントと重なる移動が拒否され、dragPreview.invalid が true になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY}T11:00`,
      end: `${DAY}T12:00`,
      resourceId: 'room-a',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY}T09:00`,
      end: `${DAY}T10:00`,
      resourceId: 'room-a',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'moving', `${DAY}T09:00`);

    firePointerDown(eventEl, columnCenterX(0), 540); // room-a 列 9:00
    movePointer(columnCenterX(0), 660); // room-a 列 11:00（既存と重なる）
    expect(sink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(columnCenterX(0), 660);
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving')).toMatchObject({
      start: `${DAY}T09:00`,
    });
  });

  it('列をまたぐ移動でも移動先の列のブロッカーで判定される（別列は重ならないため許可される）', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY}T11:00`,
      end: `${DAY}T12:00`,
      resourceId: 'room-a',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY}T11:00`,
      end: `${DAY}T12:00`,
      resourceId: 'room-b',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'moving', `${DAY}T11:00`);

    // room-b 列内（同じ時間帯だが他に何もない）で少しだけ移動させる（列は変えない）
    firePointerDown(eventEl, columnCenterX(1), 660); // room-b 列 11:00
    movePointer(columnCenterX(1), 720); // room-b 列 12:00（+1h、room-a の既存とは無関係）
    expect(sink.current?.state.dragPreview?.invalid).toBeUndefined();

    releasePointer(columnCenterX(1), 720);
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });

  it('動かす側・重ねられる側の両方が overlap: true なら、eventOverlap: false でも同一列内で重ねられる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY}T11:00`,
      end: `${DAY}T12:00`,
      resourceId: 'room-a',
      overlap: true,
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY}T09:00`,
      end: `${DAY}T10:00`,
      resourceId: 'room-a',
      overlap: true,
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'moving', `${DAY}T09:00`);

    firePointerDown(eventEl, columnCenterX(0), 540);
    movePointer(columnCenterX(0), 660);
    releasePointer(columnCenterX(0), 660);

    expect(onEventChange).toHaveBeenCalledTimes(1);
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving')).toMatchObject({
      start: at(`${DAY}T11:00`),
    });
  });

  it("eventConstraint: 'businessHours' で営業時間外への移動は拒否される", () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' },
    ];
    const event: CalendarEvent = {
      id: 'constrained',
      title: 'MTG',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [event],
      callbacks: { onEventChange },
      eventConstraint: 'businessHours',
      businessHours,
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'constrained', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600); // 10:00
    movePointer(columnCenterX(0), 1140); // 19:00（営業時間外）
    expect(sink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(columnCenterX(0), 1140);
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'constrained')).toMatchObject({
      start: `${DAY}T10:00`,
    });
  });

  it('終日アイテムの列間移動でも eventOverlap: false による拒否の対象になる', () => {
    const existingAllDay: CalendarEvent = {
      id: 'existing-allday',
      title: '既存終日',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-b',
    };
    const movingAllDay: CalendarEvent = {
      id: 'moving-allday',
      title: '対象終日',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [existingAllDay, movingAllDay],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'moving-allday', DAY);

    firePointerDown(eventEl, columnCenterX(0), 10); // room-a 列（終日行相当）
    movePointer(columnCenterX(1), 10); // room-b 列（既存終日と重なる）
    releasePointer(columnCenterX(1), 10);

    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving-allday')).toMatchObject({
      resourceId: 'room-a',
    });
  });

  it('空き領域からの新規作成も eventOverlap: false による拒否の対象になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A],
      events: [existing],
      eventOverlap: false,
    });
    mockAllColumnRects(container);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    const roomAColumn = columns[0];
    if (roomAColumn === undefined) {
      throw new Error('列が見つかりません');
    }

    firePointerDown(roomAColumn, columnCenterX(0), 630); // 10:30（既存と重なる）
    releasePointer(columnCenterX(0), 630);

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('矢印キーによる移動も eventOverlap: false による拒否の対象になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY}T11:00`,
      end: `${DAY}T12:00`,
      resourceId: 'room-a',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const onEventChange = vi.fn();
    const { container } = renderHarness({
      resources: [ROOM_A],
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
      snapMinutes: 60,
    });
    const eventEl = getEventElement(container, 'moving', `${DAY}T10:00`);

    // ArrowDown で +60 分（10:00〜11:00 → 11:00〜12:00）。既存イベントと重なるため拒否される
    fireEvent.keyDown(eventEl, { key: 'ArrowDown' });

    expect(onEventChange).not.toHaveBeenCalled();
  });

  it('矢印キーによる移動は表示時間帯（slotMinTime/slotMaxTime）外にある同一列の既存イベントとの重なりも拒否され、別列なら許可される（ビューモデルに描画されない予定が対象）', () => {
    // slotMaxTime: '18:00' の表示時間帯外（19:00〜20:00）にある既存イベントは
    // room-a 列の column.items に含まれず、ビューモデル由来のブロッカー収集では見えない。
    const existingHidden: CalendarEvent = {
      id: 'existing-hidden',
      title: '既存（表示時間帯外）',
      start: `${DAY}T19:00`,
      end: `${DAY}T20:00`,
      resourceId: 'room-a',
    };
    const movingSameRoom: CalendarEvent = {
      id: 'moving-same-room',
      title: '対象（同列）',
      start: `${DAY}T17:00`,
      end: `${DAY}T18:00`,
      resourceId: 'room-a',
    };
    const movingOtherRoom: CalendarEvent = {
      id: 'moving-other-room',
      title: '対象（別列）',
      start: `${DAY}T17:00`,
      end: `${DAY}T18:00`,
      resourceId: 'room-b',
    };
    const onEventChange = vi.fn();
    const { container } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      events: [existingHidden, movingSameRoom, movingOtherRoom],
      callbacks: { onEventChange },
      eventOverlap: false,
      slotMinTime: '08:00',
      slotMaxTime: '18:00',
      snapMinutes: 120,
    });

    // 同一列（room-a）: ArrowDown で 17:00〜18:00 → 19:00〜20:00。表示時間帯外の
    // 既存イベントと完全に重なるため拒否される
    const sameRoomEl = getEventElement(container, 'moving-same-room', `${DAY}T17:00`);
    fireEvent.keyDown(sameRoomEl, { key: 'ArrowDown' });
    expect(onEventChange).not.toHaveBeenCalled();

    // 別列（room-b）: 同じ移動でも room-a のブロッカーは対象外なので許可される
    const otherRoomEl = getEventElement(container, 'moving-other-room', `${DAY}T17:00`);
    fireEvent.keyDown(otherRoomEl, { key: 'ArrowDown' });
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });
});

describe('useResourceGridDrag - 複数日表示（resourceViewDays）', () => {
  // resources: [ROOM_A, ROOM_B]、resourceViewDays: 2 のとき、列は
  // [room-a@7/15, room-a@7/16, room-b@7/15, room-b@7/16] の並び（DOM 順 = 列順）

  it('イベントドラッグで別リソースの別日の列へ移動すると、日付と resourceId の変更が 1 回の updateEvent に合成される', () => {
    const event: CalendarEvent = {
      id: 'ev-cross-day-move',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-cross-day-move', `${DAY}T10:00`);
    if (sink.current === null) {
      throw new Error('sink が設定されていません');
    }
    const updateEventSpy = vi.spyOn(sink.current.api, 'updateEvent');

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a@7/15 の 10:00 を掴む
    movePointer(columnCenterX(3), 600); // room-b@7/16 の 10:00 へ（時刻は同じ）
    releasePointer(columnCenterX(3), 600);

    expect(updateEventSpy).toHaveBeenCalledTimes(1);
    expect(updateEventSpy).toHaveBeenCalledWith(
      'ev-cross-day-move',
      { start: at(`${NEXT_DAY}T10:00`), end: at(`${NEXT_DAY}T11:00`), resourceId: 'room-b' },
      undefined,
    );
  });

  it('同一リソース内の別日の列への移動は日付だけが変わる（resourceId は不変）', () => {
    const event: CalendarEvent = {
      id: 'ev-same-resource-day-move',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-same-resource-day-move', `${DAY}T10:00`);

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a@7/15 の 10:00
    movePointer(columnCenterX(1), 600); // room-a@7/16 の 10:00
    releasePointer(columnCenterX(1), 600);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T10:00`),
      end: at(`${NEXT_DAY}T11:00`),
      resourceId: 'room-a',
    });
  });

  it('終日アイテムのドラッグで別日の列へ移動すると開始・終了が日数分シフトする', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-day-move',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const allDayItems = container.querySelectorAll('[data-koyomi="allday-event"]');
    const firstItem = allDayItems[0];
    if (firstItem === undefined) {
      throw new Error('終日アイテムが見つかりません');
    }

    firePointerDown(firstItem, columnCenterX(0), 10); // room-a@7/15
    movePointer(columnCenterX(1), 10); // room-a@7/16
    releasePointer(columnCenterX(1), 10);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T00:00`),
      end: at('2026-07-17T00:00'),
      allDay: true,
      resourceId: 'room-a',
    });
  });

  it('終日アイテムのドラッグで別リソースの別日の列へ移動すると、日数シフトと resourceId 変更が合成される', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-cross-move',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const firstItem = container.querySelector('[data-koyomi="allday-event"]');
    if (firstItem === null) {
      throw new Error('終日アイテムが見つかりません');
    }

    firePointerDown(firstItem, columnCenterX(0), 10); // room-a@7/15
    movePointer(columnCenterX(3), 10); // room-b@7/16
    releasePointer(columnCenterX(3), 10);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T00:00`),
      end: at('2026-07-17T00:00'),
      allDay: true,
      resourceId: 'room-b',
    });
  });

  it('作成ドラッグは開始列の日に固定される（ポインタが別日の列へ入っても日は変わらない）', () => {
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
    });
    mockAllColumnRects(container);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    const secondDayColumn = columns[1]; // room-a@7/16
    if (secondDayColumn === undefined) {
      throw new Error('room-a@7/16 列が見つかりません');
    }

    firePointerDown(secondDayColumn, columnCenterX(1), 600); // 7/16 10:00
    movePointer(columnCenterX(0), 690); // 別日の列（room-a@7/15）の 11:30 相当へ
    releasePointer(columnCenterX(0), 690);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    // 日は開始列（7/16）に固定され、縦方向の 11:30 だけが反映される
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T10:00`),
      end: at(`${NEXT_DAY}T11:30`),
      resourceId: 'room-a',
    });
  });

  it('終日セルのクリックはその列の日の 1 日分の終日イベントを作成する', () => {
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
    });
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    const secondDayCell = allDayCells[1]; // room-a@7/16
    if (secondDayCell === undefined) {
      throw new Error('room-a@7/16 の終日セルが見つかりません');
    }

    fireEvent.click(secondDayCell);

    const events = sink.current?.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${NEXT_DAY}T00:00`),
      end: at('2026-07-17T00:00'),
      resourceId: 'room-a',
    });
  });

  it('移動ドラッグ中のプレビューは移動先の（リソース, 日）の列にのみ出現する', () => {
    const event: CalendarEvent = {
      id: 'ev-preview-day',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const eventEl = getEventElement(container, 'ev-preview-day', `${DAY}T10:00`);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');

    firePointerDown(eventEl, columnCenterX(0), 600); // room-a@7/15 の 10:00
    movePointer(columnCenterX(1), 600); // room-a@7/16 の 10:00

    expect(columns[0]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();
    expect(columns[1]?.querySelector('[data-koyomi="timegrid-preview"]')).not.toBeNull();
    expect(columns[2]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();
    expect(columns[3]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();

    releasePointer(columnCenterX(1), 600);
  });

  it('ArrowRight は同一リソース内の翌日の列へ移動する（時間帯は同じまま日付 +1）', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-next-day',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    const eventEl = getEventElement(container, 'ev-arrow-next-day', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T10:00`),
      end: at(`${NEXT_DAY}T11:00`),
      resourceId: 'room-a',
    });
  });

  it('リソースの最終日の列で ArrowRight を押すと、次のリソースの先頭日の列へ移動する（視覚上の隣の列）', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-next-resource',
      title: '会議',
      start: `${NEXT_DAY}T10:00`,
      end: `${NEXT_DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    const eventEl = getEventElement(container, 'ev-arrow-next-resource', `${NEXT_DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    // room-a@7/16 の視覚上の右隣は room-b@7/15（日付 -1・リソース変更が合成される）
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      end: at(`${DAY}T11:00`),
      resourceId: 'room-b',
    });
  });

  it('ArrowLeft は同一リソース内の前日の列へ移動し、先頭の列では何も変更しない', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-prev-day',
      title: '会議',
      start: `${NEXT_DAY}T10:00`,
      end: `${NEXT_DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    const eventEl = getEventElement(container, 'ev-arrow-prev-day', `${NEXT_DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowLeft' });
    });

    let events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      end: at(`${DAY}T11:00`),
      resourceId: 'room-a',
    });

    // 先頭の列（room-a@7/15）でさらに ArrowLeft → 隣が無いため変更されない
    const movedEl = getEventElement(container, 'ev-arrow-prev-day', `${DAY}T10:00`);
    await act(async () => {
      fireEvent.keyDown(movedEl, { key: 'ArrowLeft' });
    });
    events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY}T10:00`),
      resourceId: 'room-a',
    });
  });

  it('終日アイテムの ArrowRight も翌日の列へ移動する（日数シフト）', async () => {
    const event: CalendarEvent = {
      id: 'ev-allday-arrow',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container, sink } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    const firstItem = container.querySelector('[data-koyomi="allday-event"]');
    if (firstItem === null) {
      throw new Error('終日アイテムが見つかりません');
    }

    await act(async () => {
      fireEvent.keyDown(firstItem, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${NEXT_DAY}T00:00`),
      end: at('2026-07-17T00:00'),
      allDay: true,
      resourceId: 'room-a',
    });
  });

  it('終日アイテムの列間移動中、日をまたぐプレビュー対象の終日セルにのみ data-koyomi-preview-target が付く', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-preview-day',
      title: '休暇',
      start: DAY,
      end: NEXT_DAY,
      allDay: true,
      resourceId: 'room-a',
    };
    const { container } = renderHarness({
      resources: [ROOM_A, ROOM_B],
      resourceViewDays: 2,
      events: [event],
    });
    mockAllColumnRects(container);
    const firstItem = container.querySelector('[data-koyomi="allday-event"]');
    if (firstItem === null) {
      throw new Error('終日アイテムが見つかりません');
    }
    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');

    firePointerDown(firstItem, columnCenterX(0), 10); // room-a@7/15
    movePointer(columnCenterX(1), 10); // room-a@7/16 へ（+1 日）

    // シフト後の範囲（7/16〜7/17）は room-a@7/16 の列にのみ重なる
    expect(allDayCells[0]).not.toHaveAttribute('data-koyomi-preview-target');
    expect(allDayCells[1]).toHaveAttribute('data-koyomi-preview-target', 'true');
    expect(allDayCells[2]).not.toHaveAttribute('data-koyomi-preview-target');
    expect(allDayCells[3]).not.toHaveAttribute('data-koyomi-preview-target');

    releasePointer(columnCenterX(1), 10);
  });

  it('resource-column / resource-allday-cell には列の日付キーが data-koyomi-date として付く', () => {
    const { container } = renderHarness({
      resources: [ROOM_A],
      resourceViewDays: 2,
      unassignedLane: 'always',
    });
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns[0]).toHaveAttribute('data-koyomi-date', DAY);
    expect(columns[1]).toHaveAttribute('data-koyomi-date', NEXT_DAY);
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(cells[0]).toHaveAttribute('data-koyomi-date', DAY);
    expect(cells[1]).toHaveAttribute('data-koyomi-date', NEXT_DAY);
  });
});
