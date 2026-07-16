/**
 * use-external-drag.ts のテスト。
 *
 * 実際のビルトインコンポーネント（`MonthView` / `TimeGridView` / `ResourceView` /
 * `TimelineView`）を `CalendarProvider` 配下に描画し、`document.elementsFromPoint`
 * をモックすることで、外部要素からのドラッグがカレンダー本体の DOM
 * （`data-koyomi-*` 属性）を正しくヒットテストして日時・リソースへ解決できることを
 * 検証する（`use-resource-grid-drag.test.tsx` と同じハーネス流儀）。
 * `elementsFromPoint` は重なり順で複数要素を返すため、月ビューのイベント帯・終日行の
 * イベントのように、セルの上に重ねて描画される要素の直下にドロップされたケース
 * （セルはそれらの兄弟要素であり祖先ではない）も再現できる。
 *
 * jsdom は `document.elementsFromPoint` / `PointerEvent` を実装していないため、
 * 前者は `vi.spyOn` で固定要素列を返すようモックし、後者は `MouseEvent` で代用する。
 *
 * 「複数カレンダー」の describe ブロックでは、ページ上に同じビュー種別のカレンダーが
 * 2 つ並ぶ構成（2 つの `Harness` を個別に `render` する）を再現し、`containerRef` に
 * よるヒットテストのスコープ限定（他カレンダーの DOM への誤ヒットを無視すること）を
 * 検証する。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDateValue } from '../core/timezone';
import type { BusinessHoursRule, CalendarEvent, CalendarResource } from '../core/types';
import { ListView } from './components/list-view';
import { MonthView } from './components/month-view';
import { ResourceView } from './components/resource-view';
import { TimeGridView } from './components/time-grid-view';
import { TimelineView } from './components/timeline-view';
import { YearView } from './components/year-view';
import { CalendarProvider } from './context';
import type { UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import type { ExternalDragHandlers, ExternalDropInfo } from './use-external-drag';
import { useExternalDrag } from './use-external-drag';

// jsdom はこの環境で document.elementsFromPoint を実装していない（typeof が
// 'undefined'）。vi.spyOn は既存の関数にしかスパイできないため、既定実装
// （常に空配列＝領域外）を一度だけ用意しておく（各テストでは vi.spyOn でこれを
// 上書きし、afterEach で復元する）。
if (typeof document.elementsFromPoint !== 'function') {
  document.elementsFromPoint = () => [];
}

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events / resources 未指定時に毎レンダー同じ参照を渡し、開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];
const EMPTY_RESOURCES: readonly CalendarResource[] = [];
/** 1 リソース分の固定フィクスチャ。 */
const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A' };

/** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

/** 外部ドラッグ元に渡すテスト用ペイロード。 */
interface Payload {
  title: string;
}

/** テスト用ハーネスの props。 */
interface HarnessProps {
  view: 'month' | 'week' | 'resource' | 'timeline';
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
  unassignedLane?: 'auto' | 'always';
  snapMinutes?: number;
  defaultEventMinutes?: number;
  slotMinTime?: string;
  slotMaxTime?: string;
  eventOverlap?: boolean;
  eventConstraint?: 'businessHours' | readonly BusinessHoursRule[];
  businessHours?: readonly BusinessHoursRule[];
  onExternalDrop: (info: ExternalDropInfo<Payload>) => void;
  onError?: (error: unknown) => void;
  calendarSink?: { current: UseCalendarResult | null };
  dragSink?: { current: ExternalDragHandlers<Payload> | null };
}

/** 外部ドラッグ元要素 + 対象ビューを `CalendarProvider` 配下に描画するハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.view,
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_RESOURCES,
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
  });
  if (props.calendarSink) {
    props.calendarSink.current = calendar;
  }
  // カレンダー本体（CalendarProvider 配下）の DOM ルートへの ref。ページ上に
  // 複数のカレンダーが並ぶ構成を再現するため、外部ドラッグ元（external-source）
  // はこの div の外側に置く（実際の利用パターン＝サイドバーとカレンダーが
  // 別要素であるケースに合わせる）。
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useExternalDrag<Payload>({
    calendar,
    containerRef,
    onExternalDrop: props.onExternalDrop,
    ...(props.onError !== undefined ? { onError: props.onError } : {}),
  });
  if (props.dragSink) {
    props.dragSink.current = drag;
  }

  return (
    <div>
      <div data-testid="external-source" {...drag.getDraggableProps({ title: '外部の予定' })} />
      <div data-testid="calendar-root" ref={containerRef}>
        <CalendarProvider value={calendar} callbacks={{}}>
          {props.view === 'month' && <MonthView />}
          {props.view === 'week' && <TimeGridView />}
          {props.view === 'resource' && <ResourceView />}
          {props.view === 'timeline' && <TimelineView />}
        </CalendarProvider>
      </div>
    </div>
  );
}

/** 指定した要素の `getBoundingClientRect` を固定矩形にモックする。 */
function mockRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  vi.spyOn(element as HTMLElement, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect(rect));
}

/**
 * 指定した要素列を `document.elementsFromPoint` の戻り値としてモックする。
 * 実ブラウザは重なり順（手前から奥）で複数要素を返すため、月ビューのイベント帯
 * （`month-event`）や終日行のイベント（`allday-event`）のように、セルの「上に
 * 重ねて」描画される要素の直下にドロップされたケースを再現するために使う
 * （セルはイベント要素の兄弟であり祖先ではないため、単一要素の
 * `elementFromPoint` では再現できない）。
 */
function mockElementsFromPoint(elements: readonly Element[]): void {
  vi.spyOn(document, 'elementsFromPoint').mockReturnValue([...elements]);
}

/** 外部要素への pointerdown ディスパッチ（jsdom は PointerEvent 未実装のため MouseEvent で代用）。 */
function firePointerDown(element: Element, clientX = 0, clientY = 0, button = 0): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', { clientX, clientY, button, bubbles: true }),
    );
  });
}

/** document への pointermove ディスパッチ。 */
function movePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
  });
}

/** document への pointerup ディスパッチ。 */
function releasePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, bubbles: true }));
  });
}

/** document への pointercancel ディスパッチ。 */
function firePointerCancel(): void {
  act(() => {
    document.dispatchEvent(new Event('pointercancel', { bubbles: true }));
  });
}

/** document への Escape キー押下ディスパッチ。 */
function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useExternalDrag - 月ビュー', () => {
  it('日セルへドロップすると、その日 1 日分の終日範囲で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness view="month" onExternalDrop={onExternalDrop} calendarSink={calendarSink} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    expect(source).toBeInstanceOf(HTMLElement);
    expect(cell).toBeInstanceOf(HTMLElement);
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);

    expect(calendarSink.current?.state.dragPreview).toEqual({
      kind: 'create',
      occurrenceKey: null,
      range: { start: at('2026-07-20T00:00'), end: at('2026-07-21T00:00') },
      allDay: true,
    });

    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-20T00:00'), end: at('2026-07-21T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
    expect(calendarSink.current?.state.dragPreview).toBeNull();
  });

  it('複数日の帯の上（開始日以外の列）へドロップすると、帯の開始日ではなくポインタ直下の日へ解決される', () => {
    // 帯（month-event）は DOM 上は開始日の gridcell の子として描画されるため、
    // 最前面要素（帯）から closest() で辿ると常に開始日のセルへ解決してしまう。
    // elementsFromPoint の列挙にはポインタ直下のセル自身も含まれるので、
    // 「候補自身がセルにマッチするもの」を優先して正しい日へ解決することを保証する
    const onExternalDrop = vi.fn();
    const events: CalendarEvent[] = [
      // 7/20〜7/22 の 3 日間の帯（end 排他で 7/23 0:00）。帯は 7/20 セルの子になる
      { id: 'band', title: '合宿', start: '2026-07-20', end: '2026-07-23', allDay: true },
    ];
    const { container } = render(
      <Harness view="month" events={events} onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const band = container.querySelector('[data-koyomi="month-event"]');
    const cell22 = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-22"]',
    );
    expect(source).toBeInstanceOf(HTMLElement);
    expect(band).toBeInstanceOf(HTMLElement);
    expect(cell22).toBeInstanceOf(HTMLElement);
    if (
      !(source instanceof HTMLElement) ||
      !(band instanceof HTMLElement) ||
      !(cell22 instanceof HTMLElement)
    ) {
      throw new Error('要素が見つかりません');
    }
    // 帯は 7/20 セルの子であることを前提として確認しておく（前提が変わったらテストも見直す）
    expect(band.closest('[data-koyomi="month-day"]')).toHaveAttribute(
      'data-koyomi-date',
      '2026-07-20',
    );
    // ポインタは 7/22 の列の上にあり、直下は手前から [帯, 7/22 セル] の順
    mockElementsFromPoint([band, cell22]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-22T00:00'), end: at('2026-07-23T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
  });

  it('既存イベント（month-event）の上へドロップしても、その下のセルの終日範囲で onExternalDrop が呼ばれる', () => {
    // month-event はセル（month-day）の兄弟要素として重ねて描画されるため、
    // ポインタ直下の最前面要素は月イベントのボタンになる。実ブラウザの
    // elementsFromPoint は重なり順で複数要素（イベント→その下のセル）を返す。
    const onExternalDrop = vi.fn();
    const existingEvent: CalendarEvent = {
      id: 'existing-1',
      title: '既存の予定',
      start: '2026-07-20',
      allDay: true,
    };
    const { container } = render(
      <Harness view="month" events={[existingEvent]} onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const eventEl = container.querySelector('[data-koyomi="month-event"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    expect(source).toBeInstanceOf(HTMLElement);
    expect(eventEl).toBeInstanceOf(HTMLElement);
    expect(cell).toBeInstanceOf(HTMLElement);
    if (
      !(source instanceof HTMLElement) ||
      !(eventEl instanceof HTMLElement) ||
      !(cell instanceof HTMLElement)
    ) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([eventEl, cell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-20T00:00'), end: at('2026-07-21T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
  });
});

describe('useExternalDrag - 週ビュー（時間グリッド）', () => {
  it('日列へドロップすると、ポインタ位置の時刻から defaultEventMinutes 分の範囲で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness
        view="week"
        onExternalDrop={onExternalDrop}
        calendarSink={calendarSink}
        snapMinutes={15}
        defaultEventMinutes={60}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    // 列の高さ 1440px = 24h とし、clientY(px) がそのまま「日内の分」になるようにする。
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    firePointerDown(source);
    movePointer(50, 600); // 600 分 = 10:00

    expect(calendarSink.current?.state.dragPreview).toEqual({
      kind: 'create',
      occurrenceKey: null,
      range: { start: at('2026-07-15T10:00'), end: at('2026-07-15T11:00') },
      allDay: false,
    });

    releasePointer(50, 600);

    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-15T10:00'), end: at('2026-07-15T11:00') },
      allDay: false,
      payload: { title: '外部の予定' },
    });
  });

  it('終日行のセルへドロップすると、その日 1 日分の終日範囲で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(<Harness view="week" onExternalDrop={onExternalDrop} />);
    const source = container.querySelector('[data-testid="external-source"]');
    const alldayCell = container.querySelector(
      '[data-koyomi="allday-cell"][data-koyomi-date="2026-07-16"]',
    );
    if (!(source instanceof HTMLElement) || !(alldayCell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([alldayCell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-16T00:00'), end: at('2026-07-17T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
  });

  it('既存の終日イベント（allday-event）の上へドロップしても、その下のセルの終日範囲で onExternalDrop が呼ばれる', () => {
    // allday-event も allday-cell の兄弟要素として重ねて描画される
    // （month-event と同じ構造上の問題）。
    const onExternalDrop = vi.fn();
    const existingEvent: CalendarEvent = {
      id: 'existing-1',
      title: '既存の終日予定',
      start: '2026-07-16',
      allDay: true,
    };
    const { container } = render(
      <Harness view="week" events={[existingEvent]} onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const eventEl = container.querySelector('[data-koyomi="allday-event"]');
    const alldayCell = container.querySelector(
      '[data-koyomi="allday-cell"][data-koyomi-date="2026-07-16"]',
    );
    expect(source).toBeInstanceOf(HTMLElement);
    expect(eventEl).toBeInstanceOf(HTMLElement);
    expect(alldayCell).toBeInstanceOf(HTMLElement);
    if (
      !(source instanceof HTMLElement) ||
      !(eventEl instanceof HTMLElement) ||
      !(alldayCell instanceof HTMLElement)
    ) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([eventEl, alldayCell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-16T00:00'), end: at('2026-07-17T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
  });
});

describe('useExternalDrag - リソースビュー', () => {
  it('列へドロップすると、時刻＋リソース ID で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="resource"
        resources={[ROOM_A]}
        unassignedLane="always"
        onExternalDrop={onExternalDrop}
        snapMinutes={15}
        defaultEventMinutes={30}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="resource-column"][data-koyomi-resource="r:room-a"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    firePointerDown(source);
    movePointer(50, 540); // 540 分 = 9:00
    releasePointer(50, 540);

    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-15T09:00'), end: at('2026-07-15T09:30') },
      allDay: false,
      resourceId: 'room-a',
      payload: { title: '外部の予定' },
    });
  });

  it('未割り当て列へドロップすると resourceId が null になる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="resource"
        resources={[ROOM_A]}
        unassignedLane="always"
        onExternalDrop={onExternalDrop}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="resource-column"][data-koyomi-resource="unassigned"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    firePointerDown(source);
    movePointer(50, 0);
    releasePointer(50, 0);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    const info = onExternalDrop.mock.calls[0]?.[0] as ExternalDropInfo<Payload>;
    expect(info.resourceId).toBeNull();
  });

  it('終日行のセルへドロップすると、終日範囲＋リソース ID で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="resource"
        resources={[ROOM_A]}
        unassignedLane="always"
        onExternalDrop={onExternalDrop}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const alldayCell = container.querySelector(
      '[data-koyomi="resource-allday-cell"][data-koyomi-resource="r:room-a"]',
    );
    if (!(source instanceof HTMLElement) || !(alldayCell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([alldayCell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-15T00:00'), end: at('2026-07-16T00:00') },
      allDay: true,
      resourceId: 'room-a',
      payload: { title: '外部の予定' },
    });
  });

  it('resources: [] かつ unassignedLane: auto の場合はドロップ先の列が存在せずキャンセル扱いになる', () => {
    // resources: [] かつ unassignedLane: 'auto' のため isEmpty:true になり、
    // resource-empty のみが描画される（resource-column 等は存在しない）。
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="resource"
        resources={[]}
        unassignedLane="auto"
        onExternalDrop={onExternalDrop}
      />,
    );
    const root = container.querySelector('[data-koyomi="resource"]');
    const empty = container.querySelector('[data-koyomi="resource-empty"]');
    const source = container.querySelector('[data-testid="external-source"]');
    if (
      !(root instanceof HTMLElement) ||
      !(empty instanceof HTMLElement) ||
      !(source instanceof HTMLElement)
    ) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([empty, root]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});

describe('useExternalDrag - タイムラインビュー', () => {
  it('行へドロップすると、表示分から算出した時刻＋リソース ID で onExternalDrop が呼ばれる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="timeline"
        resources={[ROOM_A]}
        unassignedLane="always"
        onExternalDrop={onExternalDrop}
        snapMinutes={15}
        defaultEventMinutes={30}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const row = container.querySelector(
      '[data-koyomi="timeline-row"][data-koyomi-resource="r:room-a"]',
    );
    if (!(source instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    // 表示 1 日分＝1440px として、clientX(px) がそのまま「表示分」になるようにする。
    mockRect(row, { left: 0, top: 0, width: 1440, height: 40 });
    mockElementsFromPoint([row]);

    firePointerDown(source);
    movePointer(600, 20); // 600 分 = 10:00
    releasePointer(600, 20);

    expect(onExternalDrop).toHaveBeenCalledWith({
      range: { start: at('2026-07-15T10:00'), end: at('2026-07-15T10:30') },
      allDay: false,
      resourceId: 'room-a',
      payload: { title: '外部の予定' },
    });
  });

  it('未割り当て行へドロップすると resourceId が null になる', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="timeline"
        resources={[ROOM_A]}
        unassignedLane="always"
        onExternalDrop={onExternalDrop}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const row = container.querySelector(
      '[data-koyomi="timeline-row"][data-koyomi-resource="unassigned"]',
    );
    if (!(source instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(row, { left: 0, top: 0, width: 1440, height: 40 });
    mockElementsFromPoint([row]);

    firePointerDown(source);
    movePointer(0, 20);
    releasePointer(0, 20);

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    const info = onExternalDrop.mock.calls[0]?.[0] as ExternalDropInfo<Payload>;
    expect(info.resourceId).toBeNull();
  });
});

describe('useExternalDrag - 複数カレンダー', () => {
  it('別カレンダーの DOM 要素がヒットしても、自分の containerRef の外側なら無視されキャンセル扱いになる', () => {
    // ページ上に同じビュー種別のカレンダーが 2 つ並ぶ構成を再現する。カレンダー A の
    // 外部要素をドラッグ中に、（実ブラウザでポインタがカレンダー B 上にある等で）
    // document.elementsFromPoint がカレンダー B のセルを返してしまうケースでも、
    // A の containerRef の外側にある要素は候補から除外され、A の onExternalDrop は
    // B の日時では発火しない。
    const onExternalDropA = vi.fn();
    const onExternalDropB = vi.fn();
    const calendarSinkA: { current: UseCalendarResult | null } = { current: null };
    const { container: containerA } = render(
      <Harness view="month" onExternalDrop={onExternalDropA} calendarSink={calendarSinkA} />,
    );
    const { container: containerB } = render(
      <Harness view="month" onExternalDrop={onExternalDropB} />,
    );

    const sourceA = containerA.querySelector('[data-testid="external-source"]');
    const cellB = containerB.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    expect(sourceA).toBeInstanceOf(HTMLElement);
    expect(cellB).toBeInstanceOf(HTMLElement);
    if (!(sourceA instanceof HTMLElement) || !(cellB instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cellB]);

    firePointerDown(sourceA);
    movePointer(10, 10);

    // B のセルはスコープ外なので、A 側にプレビューは出ない。
    expect(calendarSinkA.current?.state.dragPreview).toBeNull();

    releasePointer(10, 10);

    expect(onExternalDropA).not.toHaveBeenCalled();
    expect(onExternalDropB).not.toHaveBeenCalled();
  });

  it('自分の containerRef の内側の要素であれば、複数カレンダーが存在してもこれまで通り解決される', () => {
    const onExternalDropA = vi.fn();
    const onExternalDropB = vi.fn();
    const { container: containerA } = render(
      <Harness view="month" onExternalDrop={onExternalDropA} />,
    );
    render(<Harness view="month" onExternalDrop={onExternalDropB} />);

    const sourceA = containerA.querySelector('[data-testid="external-source"]');
    const cellA = containerA.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(sourceA instanceof HTMLElement) || !(cellA instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cellA]);

    firePointerDown(sourceA);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDropA).toHaveBeenCalledWith({
      range: { start: at('2026-07-20T00:00'), end: at('2026-07-21T00:00') },
      allDay: true,
      payload: { title: '外部の予定' },
    });
    expect(onExternalDropB).not.toHaveBeenCalled();
  });
});

describe('useExternalDrag - キャンセル', () => {
  it('Escape キーで中断すると onExternalDrop は呼ばれず、プレビューが消える', () => {
    const onExternalDrop = vi.fn();
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const dragSink: { current: ExternalDragHandlers<Payload> | null } = { current: null };
    const { container } = render(
      <Harness
        view="month"
        onExternalDrop={onExternalDrop}
        calendarSink={calendarSink}
        dragSink={dragSink}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    expect(dragSink.current?.isDragging).toBe(true);
    expect(calendarSink.current?.state.dragPreview).not.toBeNull();

    pressEscape();

    expect(onExternalDrop).not.toHaveBeenCalled();
    expect(calendarSink.current?.state.dragPreview).toBeNull();
    expect(dragSink.current?.isDragging).toBe(false);

    // Escape 後は document リスナーが解除されているため、以後の pointerup は無視される。
    releasePointer(10, 10);
    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it('pointercancel で中断すると onExternalDrop は呼ばれない', () => {
    const onExternalDrop = vi.fn();
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness view="month" onExternalDrop={onExternalDrop} calendarSink={calendarSink} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    firePointerCancel();

    expect(onExternalDrop).not.toHaveBeenCalled();
    expect(calendarSink.current?.state.dragPreview).toBeNull();
  });

  it('ドロップ先が解決できない位置で離すと onExternalDrop は呼ばれない', () => {
    const onExternalDrop = vi.fn();
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness view="month" onExternalDrop={onExternalDrop} calendarSink={calendarSink} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    if (!(source instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([]);

    firePointerDown(source);
    movePointer(10, 10);
    expect(calendarSink.current?.state.dragPreview).toBeNull();

    releasePointer(10, 10);

    expect(onExternalDrop).not.toHaveBeenCalled();
    expect(calendarSink.current?.state.dragPreview).toBeNull();
  });

  it('主ボタン以外の pointerdown ではドラッグを開始しない', () => {
    const onExternalDrop = vi.fn();
    const dragSink: { current: ExternalDragHandlers<Payload> | null } = { current: null };
    const { container } = render(
      <Harness view="month" onExternalDrop={onExternalDrop} dragSink={dragSink} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source, 10, 10, 2); // 右クリック相当（button: 2）

    expect(dragSink.current?.isDragging).toBe(false);

    releasePointer(10, 10);
    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});

describe('useExternalDrag - 非対応ビューでのドロップはキャンセル扱い', () => {
  interface UnsupportedHarnessProps {
    view: 'list' | 'year';
    onExternalDrop: (info: ExternalDropInfo<Payload>) => void;
  }

  // ListView は「予定がある日だけ」をセクション化するため、日セクションが
  // 描画されるよう予定を用意する（YearView は予定の有無に関わらず全日を描画する）。
  const UNSUPPORTED_VIEW_EVENTS: readonly CalendarEvent[] = [
    { id: 'e1', title: '予定', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
  ];

  function UnsupportedHarness(props: UnsupportedHarnessProps): ReactElement {
    const calendar = useCalendar({
      timeZone: TOKYO,
      now: () => NOW,
      initialDate: NOW,
      initialView: props.view,
      events: UNSUPPORTED_VIEW_EVENTS,
      resources: EMPTY_RESOURCES,
    });
    const containerRef = useRef<HTMLDivElement>(null);
    const drag = useExternalDrag<Payload>({
      calendar,
      containerRef,
      onExternalDrop: props.onExternalDrop,
    });
    return (
      <div>
        <div data-testid="external-source" {...drag.getDraggableProps({ title: '外部の予定' })} />
        <div data-testid="calendar-root" ref={containerRef}>
          <CalendarProvider value={calendar}>
            {props.view === 'list' && <ListView />}
            {props.view === 'year' && <YearView />}
          </CalendarProvider>
        </div>
      </div>
    );
  }

  it('リストビュー: 日セクション上へドロップしても onExternalDrop は呼ばれない（ドロップ先解決不可でキャンセル扱い）', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <UnsupportedHarness view="list" onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const day = container.querySelector('[data-koyomi="list-day"]');
    if (!(source instanceof HTMLElement) || !(day instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([day]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it('年ビュー: 日セル上へドロップしても onExternalDrop は呼ばれない（ドロップ先解決不可でキャンセル扱い）', () => {
    const onExternalDrop = vi.fn();
    const { container } = render(
      <UnsupportedHarness view="year" onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const day = container.querySelector('[data-koyomi="year-day"]');
    if (!(source instanceof HTMLElement) || !(day instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([day]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});

describe('useExternalDrag - containerRef.current が null の間はキャンセル扱い', () => {
  it('マウント前相当（ref を実際の要素に接続していない）状態でドロップしても onExternalDrop は呼ばれない', () => {
    const onExternalDrop = vi.fn();

    function NullRefHarness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'month',
        events: EMPTY_EVENTS,
        resources: EMPTY_RESOURCES,
      });
      // 意図的に containerRef をどの要素にも接続しない（current が常に null のまま）。
      // これにより「マウント前」を模した状態を作る。
      const containerRef = useRef<HTMLDivElement>(null);
      const drag = useExternalDrag<Payload>({ calendar, containerRef, onExternalDrop });
      return (
        <div>
          <div data-testid="external-source" {...drag.getDraggableProps({ title: '外部の予定' })} />
          {/* containerRef を接続せず、別の要素の内側にカレンダーを描画する。 */}
          <div>
            <CalendarProvider value={calendar}>
              <MonthView />
            </CalendarProvider>
          </div>
        </div>
      );
    }

    const { container } = render(<NullRefHarness />);
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);

    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});

describe('useExternalDrag - onError', () => {
  it('onExternalDrop が投げた例外は onError に渡され、外へは漏れない', () => {
    const thrown = new Error('作成に失敗');
    const onExternalDrop = vi.fn(() => {
      throw thrown;
    });
    const onError = vi.fn();
    const { container } = render(
      <Harness view="month" onExternalDrop={onExternalDrop} onError={onError} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    expect(() => releasePointer(10, 10)).not.toThrow();

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(thrown);
  });

  it('onError 省略時、onExternalDrop が投げた例外は console.error に出力される', () => {
    const thrown = new Error('作成に失敗');
    const onExternalDrop = vi.fn(() => {
      throw thrown;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<Harness view="month" onExternalDrop={onExternalDrop} />);
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    expect(() => releasePointer(10, 10)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(thrown);
  });
});

describe('useExternalDrag - 宣言的な重なり・配置制約', () => {
  it('月ビューで eventOverlap: false のとき、既存の終日イベントのセルへのドロップは拒否され、dragPreview.invalid が true になる', () => {
    const onExternalDrop = vi.fn();
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: '2026-07-20',
      allDay: true,
    };
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness
        view="month"
        events={[existing]}
        onExternalDrop={onExternalDrop}
        calendarSink={calendarSink}
        eventOverlap={false}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    expect(calendarSink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(10, 10);
    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it('既定値（eventOverlap: true）では既存の終日イベントのセルへのドロップも通常どおり許可される', () => {
    const onExternalDrop = vi.fn();
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: '2026-07-20',
      allDay: true,
    };
    const { container } = render(
      <Harness view="month" events={[existing]} onExternalDrop={onExternalDrop} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockElementsFromPoint([cell]);

    firePointerDown(source);
    movePointer(10, 10);
    releasePointer(10, 10);
    expect(onExternalDrop).toHaveBeenCalledTimes(1);
  });

  it("週ビューで eventConstraint: 'businessHours' の営業時間外へのドロップは拒否される", () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' },
    ];
    const onExternalDrop = vi.fn();
    const { container } = render(
      <Harness
        view="week"
        onExternalDrop={onExternalDrop}
        eventConstraint="businessHours"
        businessHours={businessHours}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    firePointerDown(source);
    movePointer(50, 1140); // 19:00（営業時間外）
    releasePointer(50, 1140);

    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it('リソースビューで eventOverlap: false のとき、同じ列の既存イベントと重なるドロップは拒否され、別列へのドロップは許可される', () => {
    const onExternalDrop = vi.fn();
    const existing: CalendarEvent = {
      id: 'existing',
      title: '既存',
      start: '2026-07-15T09:00',
      end: '2026-07-15T10:00',
      resourceId: 'room-a',
    };
    const { container } = render(
      <Harness
        view="resource"
        resources={[ROOM_A]}
        events={[existing]}
        onExternalDrop={onExternalDrop}
        snapMinutes={15}
        defaultEventMinutes={30}
        eventOverlap={false}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="resource-column"][data-koyomi-resource="r:room-a"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    // room-a 列 9:15（既存 9:00〜10:00 と重なる） → 拒否される
    firePointerDown(source);
    movePointer(50, 555);
    releasePointer(50, 555);
    expect(onExternalDrop).not.toHaveBeenCalled();

    // room-a 列 11:00（既存とは無関係） → 許可される
    firePointerDown(source);
    movePointer(50, 660);
    releasePointer(50, 660);
    expect(onExternalDrop).toHaveBeenCalledTimes(1);
  });

  it('週ビューで slotMinTime/slotMaxTime の表示時間帯外にある既存イベントとの重なりも eventOverlap: false のもとで拒否される（ビューモデルに描画されない予定が対象）', () => {
    // 外部ドラッグのドロップ位置計算（resolveTimeGridDrop）は slotMinTime/slotMaxTime で
    // クランプされないため、表示時間帯外（20:00）へもドロップし得る。その位置にある
    // 既存イベントは day.items から除外され、ビューモデル由来のブロッカー収集では見えない。
    const onExternalDrop = vi.fn();
    const existingHidden: CalendarEvent = {
      id: 'existing-hidden',
      title: '既存（表示時間帯外）',
      start: '2026-07-15T20:00',
      end: '2026-07-15T20:30',
    };
    const calendarSink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness
        view="week"
        events={[existingHidden]}
        onExternalDrop={onExternalDrop}
        calendarSink={calendarSink}
        eventOverlap={false}
        slotMinTime="08:00"
        slotMaxTime="18:00"
        snapMinutes={15}
        defaultEventMinutes={30}
      />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const column = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    if (!(source instanceof HTMLElement) || !(column instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    mockRect(column, { left: 0, top: 0, width: 100, height: 1440 });
    mockElementsFromPoint([column]);

    firePointerDown(source);
    movePointer(50, 1200); // 20:00（表示時間帯外だがドロップ位置はクランプされない）
    expect(calendarSink.current?.state.dragPreview?.invalid).toBe(true);

    releasePointer(50, 1200);
    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});
