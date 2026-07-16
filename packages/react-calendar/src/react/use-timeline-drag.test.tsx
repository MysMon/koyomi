/**
 * use-timeline-drag.ts のテスト。
 *
 * `TimelineView` を `CalendarProvider` 配下で描画し、実際の DOM に対する
 * pointerdown → pointermove → pointerup / keydown のディスパッチを通じて
 * フックの挙動を検証する（`timeline-view.test.tsx` と同じハーネス流儀、
 * ドラッグ操作のシミュレーションは `use-resource-grid-drag.test.tsx` の手法を踏襲）。
 *
 * 行（`data-koyomi="timeline-row"`）の `getBoundingClientRect` をモックし、
 * 幅を `timelineDays * 1440`px（= 表示分 1 分 1px）にすることで、clientX が
 * そのまま「表示分」になるようにする（§7.2 の座標系）。
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
  TimelineScale,
} from '../core/types';
import { TimelineView } from './components/timeline-view';
import { CalendarProvider } from './context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import { useTimelineDrag } from './use-timeline-drag';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** タイムラインの表示 1 日目（NOW の属する日）。 */
const DAY0 = '2026-07-15';
/** タイムラインの表示 2 日目（`timelineDays: 2` のときのみ使用）。 */
const DAY1 = '2026-07-16';
/** DAY0 の前日（日をまたぐオカレンスの検証用）。 */
const PREV_DAY = '2026-07-14';

/** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** 2 リソース分の固定フィクスチャ。 */
const CRANE_1: CalendarResource = { id: 'crane-1', title: 'クレーン1号機' };
const CRANE_2: CalendarResource = { id: 'crane-2', title: 'クレーン2号機' };

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;
/** 行の高さ（px）。行ごとに重ならない範囲を割り当てる。 */
const ROW_HEIGHT = 100;

/** テスト用ハーネスの props。 */
interface HarnessProps {
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
  unassignedLane?: 'auto' | 'always';
  timelineDays?: number;
  timelineScale?: TimelineScale;
  callbacks?: CalendarInteractionCallbacks;
  snapMinutes?: number;
  defaultEventMinutes?: number;
  eventOverlap?: boolean;
  eventConstraint?: 'businessHours' | readonly BusinessHoursRule[];
  businessHours?: readonly BusinessHoursRule[];
  sink?: { current: UseCalendarResult | null };
}

/** `TimelineView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'timeline',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_EVENTS,
    unassignedLane: props.unassignedLane ?? 'auto',
    ...(props.timelineDays !== undefined ? { timelineDays: props.timelineDays } : {}),
    ...(props.timelineScale !== undefined ? { timelineScale: props.timelineScale } : {}),
    ...(props.snapMinutes !== undefined ? { snapMinutes: props.snapMinutes } : {}),
    ...(props.defaultEventMinutes !== undefined
      ? { defaultEventMinutes: props.defaultEventMinutes }
      : {}),
    ...(props.eventOverlap !== undefined ? { eventOverlap: props.eventOverlap } : {}),
    ...(props.eventConstraint !== undefined ? { eventConstraint: props.eventConstraint } : {}),
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <TimelineView />
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

/**
 * 行（`timeline-row`）の `getBoundingClientRect` を固定矩形にモックする（DOM 順 = 行順）。
 * 幅を `timelineDays * 1440`px にすることで、clientX(px) がそのまま表示分になる。
 */
function mockAllRowRects(container: HTMLElement, timelineDays: number): void {
  const totalMinutes = timelineDays * MINUTES_PER_DAY;
  const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
  rows.forEach((element, index) => {
    vi.spyOn(element as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: index * ROW_HEIGHT, width: totalMinutes, height: ROW_HEIGHT }),
    );
  });
}

/** 指定インデックスの行の中心 clientY を返す。 */
function rowCenterY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** 表示分（`dayIndex 日目の hh:mm`）から clientX（px = 表示分）を返す。 */
function dm(dayIndex: number, hh: number, mm: number): number {
  return dayIndex * MINUTES_PER_DAY + hh * 60 + mm;
}

/** オカレンスキー（`${eventId}@${開始時刻の ISO 文字列}`）から帯要素を取得する。 */
function getItemElement(container: HTMLElement, eventId: string, startIso: string): HTMLElement {
  const key = `${eventId}@${at(startIso).toISOString()}`;
  const element = container.querySelector(`[data-koyomi-occurrence="${key}"]`);
  if (element === null) {
    throw new Error(`帯要素が見つかりません: ${key}`);
  }
  return element as HTMLElement;
}

/**
 * React 要素への pointerdown ディスパッチ。
 * jsdom は `PointerEvent` 未実装のため、`MouseEvent` を `'pointerdown'` として
 * 明示的に生成しディスパッチする（`use-resource-grid-drag.test.tsx` と同じ手法）。
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

describe('useTimelineDrag - 作成', () => {
  it('行の横ドラッグで onSelectRange が選択行の resourceId 付きで呼ばれる', () => {
    const onSelectRange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      callbacks: { onSelectRange },
    });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneTwoRow = rows[1];
    if (craneTwoRow === undefined) {
      throw new Error('crane-2 行が見つかりません');
    }
    const y = rowCenterY(1);

    firePointerDown(craneTwoRow, dm(0, 10, 0), y); // 10:00
    movePointer(dm(0, 11, 30), y); // 11:30
    releasePointer(dm(0, 11, 30), y);

    expect(onSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:30`) },
      allDay: false,
      resourceId: 'crane-2',
    });
    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });
});

describe('useTimelineDrag - 移動・リサイズ', () => {
  it('帯の横ドラッグで行をまたぐと時間と resourceId の変更が 1 回の updateEvent に合成される', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-move',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-move', `${DAY0}T09:00`);
    if (sink.current === null) {
      throw new Error('sink が設定されていません');
    }
    const updateEventSpy = vi.spyOn(sink.current.api, 'updateEvent');

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0)); // crane-1 行 9:00 を掴む
    movePointer(dm(0, 10, 0), rowCenterY(1)); // crane-2 行 10:00 へ（+1h）
    releasePointer(dm(0, 10, 0), rowCenterY(1));

    expect(updateEventSpy).toHaveBeenCalledTimes(1);
    expect(updateEventSpy).toHaveBeenCalledWith(
      'ev-move',
      { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:00`), resourceId: 'crane-2' },
      undefined,
    );
    const events = sink.current.api.getEvents();
    expect(events[0]).toMatchObject({
      resourceId: 'crane-2',
      start: at(`${DAY0}T10:00`),
      end: at(`${DAY0}T11:00`),
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-move' }),
      newRange: { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:00`) },
      allDay: false,
      scope: null,
      resourceId: 'crane-2',
      // 単発イベントの移動では、変更前（event）・変更後（events[0]）の
      // before/after が 1 件のみ含まれる
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('右端リサイズで終了時刻だけが変わり、resourceId は不変', () => {
    const event: CalendarEvent = {
      id: 'ev-resize',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-resize', `${DAY0}T09:00`);
    const handleEl = itemEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handleEl === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    firePointerDown(handleEl, dm(0, 10, 0), rowCenterY(0)); // 10:00（終了端）
    movePointer(dm(0, 11, 0), rowCenterY(0)); // 11:00
    releasePointer(dm(0, 11, 0), rowCenterY(0));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY0}T09:00`),
      end: at(`${DAY0}T11:00`),
      resourceId: 'crane-1',
    });
  });

  it('editable: false の帯はドラッグを開始しない（変更されない）', () => {
    const event: CalendarEvent = {
      id: 'ev-locked',
      title: '固定',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
      editable: false,
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-locked', `${DAY0}T09:00`);

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0));
    movePointer(dm(0, 11, 0), rowCenterY(1));
    releasePointer(dm(0, 11, 0), rowCenterY(1));

    const events = sink.current?.api.getEvents() ?? [];
    // 変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    });
    expect(sink.current?.state.dragPreview).toBeNull();
  });
});

describe('useTimelineDrag - 追加通知（onEventDoubleClick / onEventContextMenu / onEventHover / onEventHoverEnd）', () => {
  const EVENT: CalendarEvent = {
    id: 'ev-notify',
    title: '会議',
    start: `${DAY0}T10:00`,
    end: `${DAY0}T11:00`,
    resourceId: 'crane-1',
  };

  it('ダブルクリックで onEventDoubleClick がオカレンスと nativeEvent を受け取る', () => {
    const onEventDoubleClick = vi.fn();
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [EVENT],
      callbacks: { onEventDoubleClick },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-notify', `${DAY0}T10:00`);

    fireEvent.dblClick(itemEl);

    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
    expect(onEventDoubleClick.mock.calls[0]?.[0]?.event.title).toBe('会議');
    expect(onEventDoubleClick.mock.calls[0]?.[1]).toBeInstanceOf(MouseEvent);
  });

  it('コンテキストメニュー操作で onEventContextMenu が呼ばれ、ライブラリは preventDefault しない', () => {
    const onEventContextMenu = vi.fn();
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [EVENT],
      callbacks: { onEventContextMenu },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-notify', `${DAY0}T10:00`);

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(contextMenuEvent, 'preventDefault');
    fireEvent(itemEl, contextMenuEvent);

    expect(onEventContextMenu).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('pointerover/pointerout（外部要素からの出入り）で onEventHover / onEventHoverEnd が呼ばれる', () => {
    const onEventHover = vi.fn();
    const onEventHoverEnd = vi.fn();
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [EVENT],
      callbacks: { onEventHover, onEventHoverEnd },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-notify', `${DAY0}T10:00`);
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent(itemEl, new MouseEvent('pointerover', { bubbles: true, relatedTarget: outside }));
    expect(onEventHover).toHaveBeenCalledTimes(1);

    fireEvent(itemEl, new MouseEvent('pointerout', { bubbles: true, relatedTarget: outside }));
    expect(onEventHoverEnd).toHaveBeenCalledTimes(1);
  });

  it('コールバック未指定時は getItemProps() のキー集合が従来と完全一致する（追加通知系のキーを含まない）', () => {
    const { result } = renderHook(() => {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'timeline',
        events: [EVENT],
        resources: [CRANE_1],
        timelineDays: 1,
      });
      const drag = useTimelineDrag({ calendar });
      return { calendar, drag };
    });

    const { viewModel } = result.current.calendar;
    if (viewModel.type !== 'timeline') {
      throw new Error('テストはタイムラインビューを前提とする');
    }
    const item = viewModel.rows
      .flatMap((row) => row.items)
      .find((positioned) => positioned.occurrence.eventId === 'ev-notify');
    if (item === undefined) {
      throw new Error('アイテムが見つかりません');
    }

    const props = result.current.drag.getItemProps(item);

    expect(Object.keys(props).sort()).toEqual(
      ['data-koyomi-occurrence', 'onClick', 'onKeyDown', 'onPointerDown', 'tabIndex'].sort(),
    );
  });
});

describe('useTimelineDrag - 終日帯の日単位移動', () => {
  it('終日帯の横ドラッグは日単位でスナップ移動する', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-allday',
      title: '定期点検',
      start: DAY0,
      end: DAY1,
      allDay: true,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 2,
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllRowRects(container, 2);
    const itemEl = container.querySelector('[data-koyomi="timeline-item"][data-all-day="true"]');
    if (itemEl === null) {
      throw new Error('終日の帯が見つかりません');
    }

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0)); // 1 日目 10:00 を掴む
    movePointer(dm(1, 10, 0), rowCenterY(0)); // 2 日目 10:00（+1 日）
    releasePointer(dm(1, 10, 0), rowCenterY(0));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      allDay: true,
      resourceId: 'crane-1',
      start: at(`${DAY1}T00:00`),
      end: at('2026-07-17T00:00'),
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-allday' }),
      newRange: { start: at(`${DAY1}T00:00`), end: at('2026-07-17T00:00') },
      allDay: true,
      scope: null,
      resourceId: 'crane-1',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });
});

describe("useTimelineDrag - timelineScale !== 'hour' の日単位スナップ", () => {
  it('時間指定の帯をドラッグすると日単位スナップで移動する（時刻は維持）', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-week-move',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllRowRects(container, 3);
    const itemEl = getItemElement(container, 'ev-week-move', `${DAY0}T10:00`);

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(1, 15, 0), rowCenterY(0)); // 2 日目のどこでも 1 日分の移動になる（分は無視）
    releasePointer(dm(1, 15, 0), rowCenterY(0));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY1}T10:00`),
      end: at(`${DAY1}T11:00`),
      resourceId: 'crane-1',
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-week-move' }),
      newRange: { start: at(`${DAY1}T10:00`), end: at(`${DAY1}T11:00`) },
      allDay: false,
      scope: null,
      resourceId: 'crane-1',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('新規作成のドラッグは日単位（終日ドラッグ相当の計算）になる（作成イベント自体は allDay: false）', () => {
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
    });
    mockAllRowRects(container, 3);
    const rowEl = container.querySelector('[data-koyomi="timeline-row"]');
    if (rowEl === null) {
      throw new Error('行が見つかりません');
    }

    firePointerDown(rowEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(1, 15, 0), rowCenterY(0));
    releasePointer(dm(1, 15, 0), rowCenterY(0));

    const events = sink.current?.api.getEvents() ?? [];
    // allDay: false は既定作成の付与規則により省略される（createDefaultEvent）
    expect(events[0]).not.toHaveProperty('allDay');
    expect(events[0]).toMatchObject({
      start: at(`${DAY0}T00:00`),
      end: at('2026-07-17T00:00'),
    });
  });

  it('複数日にまたがる帯の終了ハンドルを掴んでも動かさなければ変更されない（アンカー日は掴んだ位置の日）', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-multiday-resize-nomove',
      title: '長期作業',
      start: `${DAY0}T10:00`,
      end: `${DAY1}T11:00`, // 1 日目 10:00 〜 2 日目 11:00（日をまたぐ）
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
      callbacks: { onEventChange },
    });
    mockAllRowRects(container, 3);
    const itemEl = getItemElement(container, 'ev-multiday-resize-nomove', `${DAY0}T10:00`);
    const handle = itemEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handle === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    firePointerDown(handle, dm(1, 11, 0), rowCenterY(0)); // 終了（2 日目 11:00）の位置を掴む
    movePointer(dm(1, 11, 0), rowCenterY(0)); // 動かさない
    releasePointer(dm(1, 11, 0), rowCenterY(0));

    expect(onEventChange).not.toHaveBeenCalled();
    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: `${DAY0}T10:00`, end: `${DAY1}T11:00` });
  });

  it('複数日にまたがる帯の終了ハンドルを 1 日先へドラッグすると終了日が 1 日延長される（時刻は維持）', () => {
    const event: CalendarEvent = {
      id: 'ev-multiday-resize-move',
      title: '長期作業',
      start: `${DAY0}T10:00`,
      end: `${DAY1}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
    });
    mockAllRowRects(container, 3);
    const itemEl = getItemElement(container, 'ev-multiday-resize-move', `${DAY0}T10:00`);
    const handle = itemEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handle === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    firePointerDown(handle, dm(1, 11, 0), rowCenterY(0));
    movePointer(dm(2, 11, 0), rowCenterY(0)); // 3 日目へ（+1 日）
    releasePointer(dm(2, 11, 0), rowCenterY(0));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY0}T10:00`),
      end: at('2026-07-17T11:00'),
    });
  });

  it('非終日アイテムも ArrowRight で 1 日先へ移動する（hour スケールの ±snapMinutes 分から変わる）', async () => {
    const event: CalendarEvent = {
      id: 'ev-week-arrow',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
    });
    const itemEl = getItemElement(container, 'ev-week-arrow', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY1}T10:00`), end: at(`${DAY1}T11:00`) });
  });

  it('非終日アイテムの Shift+ArrowRight は終了日を 1 日延長する（新規: hour スケールでは分単位）', async () => {
    const event: CalendarEvent = {
      id: 'ev-week-shift-arrow',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
    });
    const itemEl = getItemElement(container, 'ev-week-shift-arrow', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY0}T10:00`), end: at(`${DAY1}T11:00`) });
  });

  it('終日アイテムは timelineScale に関わらず Shift+矢印キーのリサイズを提供しない（既存の制限を維持）', async () => {
    const event: CalendarEvent = {
      id: 'ev-week-allday-shift',
      title: '定期点検',
      start: DAY0,
      end: DAY1,
      allDay: true,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 3,
      timelineScale: 'week',
      events: [event],
    });
    const itemEl = container.querySelector('[data-koyomi="timeline-item"][data-all-day="true"]');
    if (itemEl === null) {
      throw new Error('終日の帯が見つかりません');
    }

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: DAY0, end: DAY1 });
  });
});

describe('useTimelineDrag - キーボード操作', () => {
  it('ArrowRight で snapMinutes 分だけ未来方向に移動する', async () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-arrow-right',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventChange },
    });
    const itemEl = getItemElement(container, 'ev-arrow-right', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY0}T10:15`),
      end: at(`${DAY0}T11:15`),
      resourceId: 'crane-1',
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-arrow-right' }),
      newRange: { start: at(`${DAY0}T10:15`), end: at(`${DAY0}T11:15`) },
      allDay: false,
      scope: null,
      resourceId: 'crane-1',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('Shift+ArrowRight で終了時刻だけが snapMinutes 分延長される', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-arrow',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
    });
    const itemEl = getItemElement(container, 'ev-shift-arrow', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: at(`${DAY0}T10:00`),
      end: at(`${DAY0}T11:15`),
    });
  });

  it('ArrowDown で隣の行（リソース）へ移動する（時間は不変）', async () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-row',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventChange },
    });
    const itemEl = getItemElement(container, 'ev-row', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowDown' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    // 時間は変更されていないため、ソースイベントの start/end は元の文字列のまま
    expect(events[0]).toMatchObject({
      resourceId: 'crane-2',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-row' }),
      newRange: { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:00`) },
      allDay: false,
      scope: null,
      resourceId: 'crane-2',
      changes: [{ before: event, after: events[0], index: 0 }],
    });
  });

  it('終日の帯は矢印キーで 1 日単位に移動する', async () => {
    const event: CalendarEvent = {
      id: 'ev-allday-arrow',
      title: '定期点検',
      start: DAY0,
      end: DAY1,
      allDay: true,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 2,
      events: [event],
    });
    const itemEl = container.querySelector('[data-koyomi="timeline-item"][data-all-day="true"]');
    if (itemEl === null) {
      throw new Error('終日の帯が見つかりません');
    }

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${DAY1}T00:00`),
      end: at('2026-07-17T00:00'),
    });
  });

  it('矢印キー: editable: false の帯は無視される', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-locked',
      title: '固定',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
      editable: false,
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    const itemEl = getItemElement(container, 'ev-arrow-locked', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });
    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowDown' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    });
  });

  it('Enter キーで onEventClick 相当のクリックが発火する', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'tl-enter',
      title: '作業',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T09:30`,
      resourceId: 'crane-1',
    };
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventClick },
    });
    const itemEl = getItemElement(container, 'tl-enter', `${DAY0}T09:00`);

    fireEvent.keyDown(itemEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ eventId: 'tl-enter' }),
    );
  });

  it('Delete キーで単発の予定が削除される', () => {
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'tl-delete',
      title: '作業',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T09:30`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventDelete },
    });
    const itemEl = getItemElement(container, 'tl-delete', `${DAY0}T09:00`);

    fireEvent.keyDown(itemEl, { key: 'Delete' });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
    expect(onEventDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence: expect.objectContaining({ eventId: 'tl-delete' }),
        scope: null,
      }),
    );
  });

  it('ArrowLeft で snapMinutes 分だけ過去方向に移動する', async () => {
    const event: CalendarEvent = {
      id: 'tl-left',
      title: '作業',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
    });
    const itemEl = getItemElement(container, 'tl-left', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowLeft' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY0}T09:45`), end: at(`${DAY0}T10:45`) });
  });

  it('Shift+ArrowLeft で終了時刻が snapMinutes 分だけ短縮される', async () => {
    const event: CalendarEvent = {
      id: 'tl-shift-left',
      title: '作業',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
    });
    const itemEl = getItemElement(container, 'tl-shift-left', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowLeft', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY0}T10:00`), end: at(`${DAY0}T10:45`) });
  });

  it('2 行目の帯で ArrowUp を押すと隣（前）の行（リソース）へ移動する', async () => {
    const event: CalendarEvent = {
      id: 'tl-up',
      title: '作業',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-2',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    const itemEl = getItemElement(container, 'tl-up', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowUp' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      resourceId: 'crane-1',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
    });
  });

  it('繰り返し予定を矢印キーで移動しようとすると resolveRecurringScope が action: "move" で呼ばれる', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const event: CalendarEvent = {
      id: 'recurring-timeline-move',
      title: '定例作業',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'crane-1',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
      callbacks: { resolveRecurringScope },
    });
    const itemEl = getItemElement(container, 'recurring-timeline-move', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-timeline-move' }),
      'move',
    );
    const override = (sink.current?.api.getEvents() ?? []).find(
      (candidate) => candidate.recurringEventId === 'recurring-timeline-move',
    );
    expect(override).toMatchObject({ start: at(`${DAY0}T10:15`), end: at(`${DAY0}T11:15`) });
  });

  it('繰り返し予定を Delete キーで削除しようとすると resolveRecurringScope が action: "delete" で呼ばれる', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-timeline-delete',
      title: '定例作業',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'crane-1',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { resolveRecurringScope, onEventDelete },
    });
    const itemEl = getItemElement(container, 'recurring-timeline-delete', `${DAY0}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'Delete' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-timeline-delete' }),
      'delete',
    );
    expect(onEventDelete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'this' }));
  });
});

describe('useTimelineDrag - Escape キャンセル', () => {
  it('Escape でドラッグをキャンセルする（イベントは変更されない）', () => {
    const event: CalendarEvent = {
      id: 'ev-escape',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-escape', `${DAY0}T10:00`);

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(0, 12, 0), rowCenterY(1));
    expect(sink.current?.state.dragPreview).not.toBeNull();

    pressEscape();
    expect(sink.current?.state.dragPreview).toBeNull();

    // Escape 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(dm(0, 12, 0), rowCenterY(1));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    });
  });
});

describe('useTimelineDrag - previewFor（ドラッグプレビューの行別表示）', () => {
  it('作成ドラッグ中、対象行にのみ timeline-preview が出現し、対象外の行には出ない', () => {
    const { container } = renderHarness({ resources: [CRANE_1, CRANE_2], timelineDays: 1 });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneTwoRow = rows[1];
    if (craneTwoRow === undefined) {
      throw new Error('crane-2 行が見つかりません');
    }
    const y = rowCenterY(1);

    firePointerDown(craneTwoRow, dm(0, 10, 0), y); // 10:00
    movePointer(dm(0, 11, 30), y); // 11:30

    const preview = craneTwoRow.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'create');
    const style = (preview as HTMLElement).style;
    expect(style.insetInlineStart).toContain('41.66');
    expect(style.width).toBe('6.25%'); // (690-600)/1440*100

    // 対象外の行（crane-1）にはプレビューが出ない
    expect(rows[0]?.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();

    releasePointer(dm(0, 11, 30), y);
  });

  it('移動ドラッグで行をまたぐと、元の行のプレビューは消え、移動先の行にのみ出現する', () => {
    const event: CalendarEvent = {
      id: 'ev-move-preview',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-move-preview', `${DAY0}T09:00`);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0)); // crane-1 行 9:00 を掴む
    movePointer(dm(0, 10, 0), rowCenterY(1)); // crane-2 行 10:00 へ（+1h）

    // 元の行（crane-1）にはプレビューが残らない
    expect(rows[0]?.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();
    const preview = rows[1]?.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'move');
    const style = (preview as HTMLElement).style;
    expect(style.insetInlineStart).toContain('41.66');
    expect(style.width).toContain('4.16');

    releasePointer(dm(0, 10, 0), rowCenterY(1));
  });

  it('前日から続く帯をリサイズすると、プレビュー開始が範囲先頭（insetInlineStart 0%）にクランプされる', () => {
    const event: CalendarEvent = {
      id: 'ev-continues-before',
      title: '夜間作業',
      start: `${PREV_DAY}T22:00`,
      end: `${DAY0}T02:00`,
      resourceId: 'crane-1',
    };
    const { container } = renderHarness({ resources: [CRANE_1], timelineDays: 1, events: [event] });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-continues-before', `${PREV_DAY}T22:00`);
    const handleEl = itemEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handleEl === null) {
      throw new Error('終了端のリサイズハンドルが見つかりません');
    }
    const row = container.querySelector('[data-koyomi="timeline-row"]');
    if (row === null) {
      throw new Error('行が見つかりません');
    }

    firePointerDown(handleEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(0, 12, 0), rowCenterY(0)); // 12:00

    const preview = row.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    const style = (preview as HTMLElement).style;
    // 実際の開始（前日22:00）は表示範囲より前のため 0% にクランプされる
    expect(style.insetInlineStart).toBe('0%');
    expect(style.width).toBe('50%'); // (720-0)/1440*100

    releasePointer(dm(0, 12, 0), rowCenterY(0));
  });

  it('翌日へ続く帯をリサイズすると、プレビュー終了が範囲終端（width 込みで 100%）にクランプされる', () => {
    const event: CalendarEvent = {
      id: 'ev-continues-after',
      title: '夜間作業',
      start: `${DAY0}T22:00`,
      end: `${DAY1}T02:00`,
      resourceId: 'crane-1',
    };
    const { container } = renderHarness({ resources: [CRANE_1], timelineDays: 1, events: [event] });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-continues-after', `${DAY0}T22:00`);
    const handleEl = itemEl.querySelector('[data-koyomi-resize-handle="start"]');
    if (handleEl === null) {
      throw new Error('開始端のリサイズハンドルが見つかりません');
    }
    const row = container.querySelector('[data-koyomi="timeline-row"]');
    if (row === null) {
      throw new Error('行が見つかりません');
    }

    firePointerDown(handleEl, dm(0, 22, 0), rowCenterY(0));
    movePointer(dm(0, 18, 0), rowCenterY(0)); // 18:00

    const preview = row.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    const style = (preview as HTMLElement).style;
    expect(style.insetInlineStart).toBe('75%'); // 1080/1440*100
    // 実際の終了（翌日02:00）は表示範囲より後のため終端（width 込みで 100%）にクランプされる
    expect(style.width).toBe('25%'); // (1440-1080)/1440*100

    releasePointer(dm(0, 18, 0), rowCenterY(0));
  });

  it('終日帯の日単位移動中、移動先行にのみプレビューが出る', () => {
    const event: CalendarEvent = {
      id: 'ev-allday-preview',
      title: '定期点検',
      start: DAY0,
      end: DAY1,
      allDay: true,
      resourceId: 'crane-1',
    };
    const { container } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 2,
      events: [event],
    });
    mockAllRowRects(container, 2);
    const itemEl = container.querySelector('[data-koyomi="timeline-item"][data-all-day="true"]');
    if (itemEl === null) {
      throw new Error('終日の帯が見つかりません');
    }
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0)); // 1 日目 10:00 を掴む
    movePointer(dm(1, 10, 0), rowCenterY(1)); // 2 日目 10:00・crane-2 行へ

    expect(rows[0]?.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();
    const preview = rows[1]?.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'move');
    const style = (preview as HTMLElement).style;
    expect(style.insetInlineStart).toBe('50%'); // 1440/2880*100
    expect(style.width).toBe('50%'); // (2880-1440)/2880*100

    releasePointer(dm(1, 10, 0), rowCenterY(1));
  });
});

describe('useTimelineDrag - pointercancel によるキャンセル', () => {
  it('ドラッグ中に pointercancel が発生するとキャンセルされ、イベントは変更されない（コミットもされない）', () => {
    const event: CalendarEvent = {
      id: 'ev-pointercancel',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-pointercancel', `${DAY0}T10:00`);

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(0, 12, 0), rowCenterY(1));
    expect(sink.current?.state.dragPreview).not.toBeNull();

    firePointerCancel();

    expect(sink.current?.state.dragPreview).toBeNull();

    // pointercancel 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(dm(0, 12, 0), rowCenterY(1));

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    });
  });
});

describe('useTimelineDrag - 適用前フック（onBeforeSelectRange / onBeforeEventChange / onBeforeEventDelete）', () => {
  it('onBeforeSelectRange が false を返すと、行の横ドラッグによる作成は行われず onSelectRange も呼ばれない', () => {
    const onBeforeSelectRange = vi.fn().mockReturnValue(false);
    const onSelectRange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      callbacks: { onBeforeSelectRange, onSelectRange },
    });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneTwoRow = rows[1];
    if (craneTwoRow === undefined) {
      throw new Error('crane-2 行が見つかりません');
    }
    const y = rowCenterY(1);

    firePointerDown(craneTwoRow, dm(0, 10, 0), y); // 10:00
    movePointer(dm(0, 11, 30), y); // 11:30
    releasePointer(dm(0, 11, 30), y);

    expect(onBeforeSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:30`) },
      allDay: false,
      resourceId: 'crane-2',
    });
    expect(onSelectRange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });

  it('onBeforeSelectRange が Promise<false> を返す場合も、既定の即時作成が拒否される', async () => {
    const onBeforeSelectRange = vi.fn().mockResolvedValue(false);
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      callbacks: { onBeforeSelectRange },
    });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneOneRow = rows[0];
    if (craneOneRow === undefined) {
      throw new Error('crane-1 行が見つかりません');
    }
    const y = rowCenterY(0);

    firePointerDown(craneOneRow, dm(0, 9, 0), y); // 9:00
    movePointer(dm(0, 10, 0), y); // 10:00
    await act(async () => {
      releasePointer(dm(0, 10, 0), y);
    });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
  });

  it('onBeforeSelectRange が true を返す（または省略する）と従来どおり作成される', () => {
    const onBeforeSelectRange = vi.fn().mockReturnValue(true);
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      callbacks: { onBeforeSelectRange },
    });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneOneRow = rows[0];
    if (craneOneRow === undefined) {
      throw new Error('crane-1 行が見つかりません');
    }
    const y = rowCenterY(0);

    firePointerDown(craneOneRow, dm(0, 9, 0), y);
    movePointer(dm(0, 10, 0), y);
    releasePointer(dm(0, 10, 0), y);

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('onBeforeEventChange が false を返すと、行をまたぐ移動は適用されず onEventChange も呼ばれない', () => {
    const onBeforeEventChange = vi.fn().mockReturnValue(false);
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-change-move',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
      callbacks: { onBeforeEventChange, onEventChange },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-before-change-move', `${DAY0}T09:00`);

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0)); // crane-1 9:00
    movePointer(dm(0, 10, 0), rowCenterY(1)); // crane-2 10:00
    releasePointer(dm(0, 10, 0), rowCenterY(1));

    expect(onBeforeEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-before-change-move' }),
      range: { start: at(`${DAY0}T10:00`), end: at(`${DAY0}T11:00`) },
      allDay: false,
      resourceId: 'crane-2',
      action: 'move',
    });
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toEqual([event]);
  });

  it('帯のリサイズで onBeforeEventChange が Promise<false> を返すと適用されない（action: "resize"）', async () => {
    const onBeforeEventChange = vi.fn().mockResolvedValue(false);
    const event: CalendarEvent = {
      id: 'ev-before-change-resize',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onBeforeEventChange },
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'ev-before-change-resize', `${DAY0}T09:00`);
    const handleEl = itemEl.querySelector('[data-koyomi-resize-handle="end"]');
    if (handleEl === null) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    firePointerDown(handleEl, dm(0, 10, 0), rowCenterY(0)); // 10:00（終了端）
    movePointer(dm(0, 11, 0), rowCenterY(0)); // 11:00
    await act(async () => {
      releasePointer(dm(0, 11, 0), rowCenterY(0));
    });

    expect(onBeforeEventChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'resize' }));
    expect(sink.current?.api.getEvents()).toEqual([event]);
  });

  it('onBeforeEventChange が false を返すと、矢印キーによる移動（キーボード）も適用されない', async () => {
    const onBeforeEventChange = vi.fn().mockReturnValue(false);
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-before-change-arrow',
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1, CRANE_2],
      timelineDays: 1,
      events: [event],
      callbacks: { onBeforeEventChange, onEventChange },
    });
    const itemEl = getItemElement(container, 'ev-before-change-arrow', `${DAY0}T09:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
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
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onBeforeEventDelete, onEventDelete },
    });
    const itemEl = getItemElement(container, 'ev-before-delete', `${DAY0}T09:00`);

    fireEvent.keyDown(itemEl, { key: 'Delete' });

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
      title: '荷揚げ',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onBeforeEventDelete },
    });
    const itemEl = getItemElement(container, 'ev-before-delete-async', `${DAY0}T09:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'Backspace' });
    });

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });
});

describe('useTimelineDrag - 宣言的な重なり・配置制約', () => {
  it('eventOverlap: false では同一行内で既存イベントと重なる移動が拒否され、dragPreview.invalid が true になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY0}T11:00`,
      end: `${DAY0}T12:00`,
      resourceId: 'crane-1',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'moving', `${DAY0}T09:00`);

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0));
    movePointer(dm(0, 11, 0), rowCenterY(0)); // crane-1 行 11:00（既存と重なる）
    expect(sink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(dm(0, 11, 0), rowCenterY(0));
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving')).toMatchObject({
      start: `${DAY0}T09:00`,
    });
  });

  it('動かす側・重ねられる側の両方が overlap: true なら、eventOverlap: false でも同一行内で重ねられる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY0}T11:00`,
      end: `${DAY0}T12:00`,
      resourceId: 'crane-1',
      overlap: true,
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY0}T09:00`,
      end: `${DAY0}T10:00`,
      resourceId: 'crane-1',
      overlap: true,
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'moving', `${DAY0}T09:00`);

    firePointerDown(itemEl, dm(0, 9, 0), rowCenterY(0));
    movePointer(dm(0, 11, 0), rowCenterY(0));
    releasePointer(dm(0, 11, 0), rowCenterY(0));

    expect(onEventChange).toHaveBeenCalledTimes(1);
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving')).toMatchObject({
      start: at(`${DAY0}T11:00`),
    });
  });

  it("eventConstraint: 'businessHours' で営業時間外への移動は拒否される", () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' },
    ];
    const event: CalendarEvent = {
      id: 'constrained',
      title: '荷揚げ',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [event],
      callbacks: { onEventChange },
      eventConstraint: 'businessHours',
      businessHours,
    });
    mockAllRowRects(container, 1);
    const itemEl = getItemElement(container, 'constrained', `${DAY0}T10:00`);

    firePointerDown(itemEl, dm(0, 10, 0), rowCenterY(0));
    movePointer(dm(0, 19, 0), rowCenterY(0)); // 19:00（営業時間外）
    expect(sink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(dm(0, 19, 0), rowCenterY(0));
    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'constrained')).toMatchObject({
      start: `${DAY0}T10:00`,
    });
  });

  it('終日の帯の日単位移動でも eventOverlap: false による拒否の対象になる', () => {
    const existingAllDay: CalendarEvent = {
      id: 'existing-allday',
      title: '既存終日',
      start: DAY1,
      end: '2026-07-17',
      allDay: true,
      resourceId: 'crane-1',
    };
    const movingAllDay: CalendarEvent = {
      id: 'moving-allday',
      title: '対象終日',
      start: DAY0,
      end: DAY1,
      allDay: true,
      resourceId: 'crane-1',
    };
    const onEventChange = vi.fn();
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 2,
      events: [existingAllDay, movingAllDay],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    mockAllRowRects(container, 2);
    const itemEl = getItemElement(container, 'moving-allday', DAY0);

    // 終日帯は日単位でスナップ移動する（+1 日で DAY1 の既存終日と重なる）
    firePointerDown(itemEl, dm(0, 12, 0), rowCenterY(0));
    movePointer(dm(1, 12, 0), rowCenterY(0));
    releasePointer(dm(1, 12, 0), rowCenterY(0));

    expect(onEventChange).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents().find((e) => e.id === 'moving-allday')).toMatchObject({
      start: DAY0,
    });
  });

  it('空き領域からの新規作成も eventOverlap: false による拒否の対象になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [existing],
      eventOverlap: false,
    });
    mockAllRowRects(container, 1);
    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const craneRow = rows[0];
    if (craneRow === undefined) {
      throw new Error('行が見つかりません');
    }

    firePointerDown(craneRow, dm(0, 10, 30), rowCenterY(0)); // 10:30（既存と重なる）
    releasePointer(dm(0, 10, 30), rowCenterY(0));

    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('矢印キーによる移動も eventOverlap: false による拒否の対象になる', () => {
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: `${DAY0}T11:00`,
      end: `${DAY0}T12:00`,
      resourceId: 'crane-1',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: `${DAY0}T10:00`,
      end: `${DAY0}T11:00`,
      resourceId: 'crane-1',
    };
    const onEventChange = vi.fn();
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [existing, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
      snapMinutes: 60,
    });
    const itemEl = getItemElement(container, 'moving', `${DAY0}T10:00`);

    // ArrowRight で +60 分（10:00〜11:00 → 11:00〜12:00）。既存イベントと重なるため拒否される
    fireEvent.keyDown(itemEl, { key: 'ArrowRight' });

    expect(onEventChange).not.toHaveBeenCalled();
  });

  it('矢印キーによる移動は表示範囲（タイムラインの表示日数）外の日にある既存イベントとの重なりも拒否される（ビューモデルに含まれない日が対象）', () => {
    // timelineDays: 1 の表示範囲は DAY0 のみ。前日（PREV_DAY）に終始する既存の
    // 終日イベントは row.items に現れず、ビューモデル由来のブロッカー収集では見えない。
    const existingHidden: CalendarEvent = {
      id: 'existing-hidden',
      title: '既存（表示範囲外）',
      start: PREV_DAY,
      end: DAY0,
      allDay: true,
      resourceId: 'crane-1',
    };
    const moving: CalendarEvent = {
      id: 'moving',
      title: '対象',
      start: DAY0,
      end: '2026-07-16',
      allDay: true,
      resourceId: 'crane-1',
    };
    const onEventChange = vi.fn();
    const { container } = renderHarness({
      resources: [CRANE_1],
      timelineDays: 1,
      events: [existingHidden, moving],
      callbacks: { onEventChange },
      eventOverlap: false,
    });
    const itemEl = getItemElement(container, 'moving', DAY0);

    // ArrowLeft で前日（表示範囲外）へ移動。終日の帯は daySnap のため 1 日単位で
    // 移動し、前日には重なる既存の終日イベントがあるため拒否される
    fireEvent.keyDown(itemEl, { key: 'ArrowLeft' });

    expect(onEventChange).not.toHaveBeenCalled();
  });
});
