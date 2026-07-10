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
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseDateValue } from '../core/timezone';
import type { CalendarEvent, CalendarResource } from '../core/types';
import { ResourceView } from './components/resource-view';
import { CalendarProvider } from './context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** リソースビューの表示日（NOW の属する日）。 */
const DAY = '2026-07-15';

/** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** 2 リソース分の固定フィクスチャ。 */
const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A' };
const ROOM_B: CalendarResource = { id: 'room-b', title: '会議室B' };

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
