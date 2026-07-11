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
      changes: [{ before: event, after: events[0] }],
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
      changes: [{ before: event, after: events[0] }],
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
      changes: [{ before: event, after: events[0] }],
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
      changes: [{ before: event, after: events[0] }],
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
