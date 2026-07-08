/**
 * use-time-grid-drag.ts のテスト。
 *
 * `useCalendar` は未実装のため、`createCalendar` と `useSyncExternalStore` を
 * 直接組み合わせた最小限のテストハーネスで `UseCalendarResult` 相当の値を作る。
 *
 * jsdom は PointerEvent 未実装のことがあるため、document へのポインタ操作の
 * ディスパッチには `MouseEvent` を使う。列要素の矩形は `getBoundingClientRect` を
 * モックして固定する（列の幅 100px・高さ 1440px = 1 分 1px として clientY を分に
 * 対応させる）。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, Ref } from 'react';
import { useRef, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { parseDateValue } from '../core/timezone';
import type {
  CalendarApi,
  CalendarEvent,
  EventOccurrence,
  RecurringEditScope,
  TimeGridDay,
} from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import type { TimeGridDragHandlers } from './use-time-grid-drag';
import { autoScrollVelocity, useTimeGridDrag } from './use-time-grid-drag';

// jsdom はこの環境で document.elementFromPoint を実装していない（typeof が 'undefined'）。
// vi.spyOn は既存の関数にしかスパイできないため、既定実装（常に null＝領域外）を
// 一度だけ用意しておく（各テストでは vi.spyOn でこれを上書きし、afterEach で復元する）。
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

const TOKYO = 'Asia/Tokyo';
const NOW = new Date('2026-07-15T01:00:00Z');

/** 東京タイムゾーンの壁時計 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

// 表示週（weekStartsOn: 0）は 2026-07-12（日）〜 2026-07-18（土）。
const SUN = '2026-07-12';
const MON = '2026-07-13';
const TUE = '2026-07-14';
const WED = '2026-07-15';
const THU = '2026-07-16';
const FRI = '2026-07-17';
const SAT = '2026-07-18';
const WEEK_KEYS = [SUN, MON, TUE, WED, THU, FRI, SAT];

/** 列の幅（px）。列ごとに重ならない範囲を割り当てる。 */
const COLUMN_WIDTH = 100;
/** 列の高さ（px）。1440px = 24h とし、clientY(px) がそのまま「日内の分」になるようにする。 */
const COLUMN_HEIGHT = 1440;

/** 指定した日付キーの列の中心 clientX を返す。 */
function columnCenterX(key: string): number {
  const index = WEEK_KEYS.indexOf(key);
  return index * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

/** テストで `useTimeGridDrag` の戻り値と `UseCalendarResult` を横取りするための入れ物。 */
interface Sink {
  calendar: UseCalendarResult;
  drag: TimeGridDragHandlers;
}

/** `createCalendar` を一度だけ作成し、`useSyncExternalStore` で購読する最小ハーネス。 */
function useHarnessCalendar(factory: () => CalendarApi): UseCalendarResult {
  const apiRef = useRef<CalendarApi | null>(null);
  if (apiRef.current === null) {
    apiRef.current = factory();
  }
  const api = apiRef.current;
  const state = useSyncExternalStore(api.subscribe, api.getState);
  return { api, state, viewModel: api.getViewModel() };
}

/**
 * `Ref<HTMLElement>` を `<div>`（`Ref<HTMLDivElement>`）にそのまま渡せるようにする
 * テスト用アダプタ。`getDayProps` の `ref` は要素の具体的なタグ名を問わないため
 * `HTMLElement` 型だが、JSX の `<div ref={...}>` は `HTMLDivElement` を要求する。
 */
function toDivRef(ref: Ref<HTMLElement>): (element: HTMLDivElement | null) => void {
  return (element) => {
    if (typeof ref === 'function') {
      ref(element);
      return;
    }
    if (ref !== null) {
      ref.current = element;
    }
  };
}

/** 週ビューを描画し、各日列とその中の予定・リサイズハンドルに props をスプレッドするハーネス。 */
function Harness(props: {
  factory: () => CalendarApi;
  callbacks?: CalendarInteractionCallbacks;
  sink: { current: Sink | null };
}): ReactElement {
  const calendar = useHarnessCalendar(props.factory);
  const drag = useTimeGridDrag(
    props.callbacks === undefined ? { calendar } : { calendar, callbacks: props.callbacks },
  );
  props.sink.current = { calendar, drag };

  const { viewModel } = calendar;
  if (viewModel.type !== 'timeGrid') {
    throw new Error('テストは時間グリッドビューを前提とする');
  }

  return (
    <div data-koyomi="timegrid-body" data-testid="timegrid-body">
      {viewModel.days.map((day) => {
        const { ref: dayRef, ...dayProps } = drag.getDayProps(day);
        return (
          <div key={day.key} {...dayProps} ref={toDivRef(dayRef)} data-testid={`day-${day.key}`}>
            {day.items.map((item) => {
              const eventProps = drag.getEventProps(item);
              const endResizeProps = drag.getResizeHandleProps(item);
              const startResizeProps = drag.getResizeHandleProps(item, 'start');
              return (
                <div
                  key={item.occurrence.key}
                  {...eventProps}
                  data-testid={`event-${item.occurrence.key}`}
                >
                  <div {...startResizeProps} data-testid={`resize-start-${item.occurrence.key}`} />
                  <div {...endResizeProps} data-testid={`resize-${item.occurrence.key}`} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** 各日列の `getBoundingClientRect` をモックし、列ごとに重ならない矩形を割り当てる。 */
function mockAllColumnRects(): void {
  WEEK_KEYS.forEach((key, index) => {
    const element = screen.getByTestId(`day-${key}`);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        x: index * COLUMN_WIDTH,
        y: 0,
        width: COLUMN_WIDTH,
        height: COLUMN_HEIGHT,
      }),
    );
  });
}

/** テスト用カレンダー＋ハーネスを描画するヘルパ。 */
function renderHarness(
  options: {
    events?: readonly CalendarEvent[];
    callbacks?: CalendarInteractionCallbacks;
    snapMinutes?: number;
    defaultEventMinutes?: number;
  } = {},
): { sink: { current: Sink | null }; unmount: () => void } {
  const { events = [], callbacks, snapMinutes = 15, defaultEventMinutes = 60 } = options;
  const sink: { current: Sink | null } = { current: null };
  const factory = (): CalendarApi =>
    createCalendar({
      timeZone: TOKYO,
      initialView: 'week',
      weekStartsOn: 0,
      initialDate: NOW,
      now: () => NOW,
      events,
      snapMinutes,
      defaultEventMinutes,
    });

  const view =
    callbacks === undefined
      ? render(<Harness factory={factory} sink={sink} />)
      : render(<Harness factory={factory} sink={sink} callbacks={callbacks} />);

  mockAllColumnRects();
  return { sink, unmount: view.unmount };
}

/**
 * React 要素への pointerdown ディスパッチ。
 *
 * jsdom 26 は `PointerEvent` 未実装のため、`fireEvent.pointerDown` は内部で
 * `Event` にフォールバックし `clientX` / `clientY` / `button` が失われる。
 * ここでは `MouseEvent` を `'pointerdown'` として明示的に生成し、それらの
 * プロパティを確実に持たせた上でディスパッチする。
 */
function firePointerDown(element: Element, clientX: number, clientY: number): void {
  fireEvent(
    element,
    new MouseEvent('pointerdown', { clientX, clientY, button: 0, bubbles: true, cancelable: true }),
  );
}

/** 非左ボタン（右クリック等）の pointerdown ディスパッチ。 */
function fireNonPrimaryPointerDown(element: Element, clientX: number, clientY: number): void {
  fireEvent(
    element,
    new MouseEvent('pointerdown', { clientX, clientY, button: 2, bubbles: true, cancelable: true }),
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

/** document への pointerup ディスパッチ（繰り返しのスコープ解決など非同期処理を待つ版）。 */
async function releasePointerAsync(clientX: number, clientY: number): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, bubbles: true }));
  });
}

/** document への Escape キー押下ディスパッチ。 */
function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** document への pointercancel ディスパッチ。 */
function firePointerCancel(): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
  });
}

/**
 * テスト用の終日行の要素（`data-koyomi="allday-cell"`）を作る。
 * `document.elementFromPoint` のモック戻り値として使う。DOM に接続しなくても
 * `Element#closest` は自身の祖先チェーンだけを辿るため機能する。
 */
function makeAlldayCellElement(): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-koyomi', 'allday-cell');
  return element;
}

/** ハーネスが描画している時間グリッドビューの `days` を取得する。 */
function getTimeGridDays(sink: Sink): readonly TimeGridDay[] {
  const { viewModel } = sink.calendar;
  if (viewModel.type !== 'timeGrid') {
    throw new Error('テストは時間グリッドビューを前提とする');
  }
  return viewModel.days;
}

describe('useTimeGridDrag', () => {
  it('空き領域のドラッグで onSelectRange が snap 済みの範囲で呼ばれる', () => {
    const onSelectRange = vi.fn();
    const { sink } = renderHarness({ callbacks: { onSelectRange } });
    const dayEl = screen.getByTestId(`day-${MON}`);
    const x = columnCenterX(MON);

    firePointerDown(dayEl, x, 600); // 10:00
    movePointer(x, 690); // 11:30
    releasePointer(x, 690);

    expect(onSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${MON}T10:00`), end: at(`${MON}T11:30`) },
      allDay: false,
    });
    expect(sink.current?.calendar.api.getEvents()).toHaveLength(0);
  });

  it('onSelectRange 省略時は createEvent で即時作成される', () => {
    const { sink } = renderHarness();
    const dayEl = screen.getByTestId(`day-${SUN}`);
    const x = columnCenterX(SUN);

    firePointerDown(dayEl, x, 540); // 9:00
    movePointer(x, 600); // 10:00
    releasePointer(x, 600);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: '(タイトルなし)',
      start: at(`${SUN}T09:00`),
      end: at(`${SUN}T10:00`),
    });
  });

  it('クリック（移動なし）で defaultEventMinutes の長さの範囲になる', () => {
    const onSelectRange = vi.fn();
    const { sink } = renderHarness({ callbacks: { onSelectRange }, defaultEventMinutes: 45 });
    const dayEl = screen.getByTestId(`day-${MON}`);
    const x = columnCenterX(MON);

    firePointerDown(dayEl, x, 600); // 10:00
    releasePointer(x, 600);

    expect(onSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${MON}T10:00`), end: at(`${MON}T10:45`) },
      allDay: false,
    });
    expect(sink.current?.calendar.api.getEvents()).toHaveLength(0);
  });

  it('pointerdown 直後に同一位置相当の pointermove が発生しても空き領域の作成はクリック扱いになる（defaultEventMinutes 長）', () => {
    // 実ブラウザではクリック操作でも微小な pointermove が発生することがある。
    // 座標が変わらず計算結果（プレビュー範囲）も変化しない場合は「実質的な移動なし」
    // として扱い、snapMinutes 長ではなく defaultEventMinutes 長で作成されるべき。
    const onSelectRange = vi.fn();
    const { sink } = renderHarness({ callbacks: { onSelectRange }, defaultEventMinutes: 45 });
    const dayEl = screen.getByTestId(`day-${MON}`);
    const x = columnCenterX(MON);

    firePointerDown(dayEl, x, 600); // 10:00
    movePointer(x, 600); // 同一位置相当の pointermove（実質移動なし）
    releasePointer(x, 600);

    expect(onSelectRange).toHaveBeenCalledWith({
      range: { start: at(`${MON}T10:00`), end: at(`${MON}T10:45`) },
      allDay: false,
    });
    expect(sink.current?.calendar.api.getEvents()).toHaveLength(0);
  });

  it('pointerdown 直後に同一位置相当の pointermove が発生してもイベント上のドラッグは確定せず、後続 click で onEventClick が呼ばれる', () => {
    const onEventClick = vi.fn();
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-jitter-click',
      title: '対象',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick, onEventChange } });
    const occurrenceKey = `ev-jitter-click@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    firePointerDown(eventEl, x, 540); // 09:00 を掴む
    movePointer(x, 540); // 同一位置相当の pointermove（実質移動なし）
    releasePointer(x, 540);

    // ドラッグは確定していないため、変更コールバックは呼ばれない
    expect(onEventChange).not.toHaveBeenCalled();

    // 移動確定による抑制がかからないため、click は onEventClick に委譲される
    fireEvent.click(eventEl);
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('イベントのドラッグ移動で開始・終了が更新される（単発イベント）', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-move',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event], callbacks: { onEventChange } });

    const occurrenceKey = `ev-move@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    firePointerDown(eventEl, x, 615); // 10:15 を掴む
    movePointer(x, 735); // 12:15 まで移動（+2h）
    releasePointer(x, 735);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: at(`${TUE}T12:00`), end: at(`${TUE}T13:00`) });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-move' }),
      newRange: { start: at(`${TUE}T12:00`), end: at(`${TUE}T13:00`) },
      allDay: false,
      scope: null,
    });
  });

  it('繰り返しイベントの移動で resolveRecurringScope が呼ばれ、this を選ぶとオーバーライドが作成される', async () => {
    const resolveRecurringScope = vi.fn(
      async (
        _occurrence: EventOccurrence,
        _action: 'move' | 'resize' | 'delete' | 'update',
      ): Promise<RecurringEditScope | null> => 'this',
    );
    const event: CalendarEvent = {
      id: 'recurring-1',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { sink } = renderHarness({ events: [event], callbacks: { resolveRecurringScope } });

    const occurrenceKey = `recurring-1@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(WED);

    firePointerDown(eventEl, x, 600); // 10:00
    movePointer(x, 720); // 12:00（+2h）
    await releasePointerAsync(x, 720);

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-1' }),
      'move',
    );
    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(2);
    const override = events.find((candidate) => candidate.recurringEventId === 'recurring-1');
    expect(override).toMatchObject({ start: at(`${WED}T12:00`), end: at(`${WED}T13:00`) });
  });

  it('繰り返しイベントの移動で resolveRecurringScope が null を返すとキャンセルされる', async () => {
    const resolveRecurringScope = vi.fn(
      async (
        _occurrence: EventOccurrence,
        _action: 'move' | 'resize' | 'delete' | 'update',
      ): Promise<RecurringEditScope | null> => null,
    );
    const event: CalendarEvent = {
      id: 'recurring-2',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { sink } = renderHarness({ events: [event], callbacks: { resolveRecurringScope } });

    const occurrenceKey = `recurring-2@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(WED);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    await releasePointerAsync(x, 720);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: '2026-07-01T10:00', end: '2026-07-01T11:00' });
    expect(sink.current?.calendar.state.dragPreview).toBeNull();
  });

  it('editable: false のイベントはドラッグを開始しない', () => {
    const event: CalendarEvent = {
      id: 'ev-fixed',
      title: '固定',
      start: `${THU}T10:00`,
      end: `${THU}T11:00`,
      editable: false,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-fixed@${at(`${THU}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(THU);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    releasePointer(x, 720);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: `${THU}T10:00`, end: `${THU}T11:00` });
    expect(sink.current?.calendar.state.dragPreview).toBeNull();
    expect(eventEl).not.toHaveAttribute('data-koyomi-dragging');
  });

  it('リサイズで終了時刻だけが変わる', () => {
    const event: CalendarEvent = {
      id: 'ev-resize',
      title: '会議',
      start: `${FRI}T10:00`,
      end: `${FRI}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-resize@${at(`${FRI}T10:00`).toISOString()}`;
    const handleEl = screen.getByTestId(`resize-${occurrenceKey}`);
    const x = columnCenterX(FRI);

    firePointerDown(handleEl, x, 660); // 11:00
    movePointer(x, 720); // 12:00
    releasePointer(x, 720);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: at(`${FRI}T10:00`), end: at(`${FRI}T12:00`) });
  });

  it('リサイズは最小 snap 分の長さを下回らない（開始より前に戻しても end は開始+snap 分）', () => {
    const event: CalendarEvent = {
      id: 'ev-resize-min',
      title: '会議',
      start: `${FRI}T10:00`,
      end: `${FRI}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-resize-min@${at(`${FRI}T10:00`).toISOString()}`;
    const handleEl = screen.getByTestId(`resize-${occurrenceKey}`);
    const x = columnCenterX(FRI);

    firePointerDown(handleEl, x, 660); // 11:00
    movePointer(x, 300); // 5:00（開始より前）
    releasePointer(x, 300);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${FRI}T10:00`), end: at(`${FRI}T10:15`) });
  });

  it('リサイズハンドルの単純クリックは親の onClick に伝播せず onEventClick が誤発火しない', () => {
    // pointerdown → pointerup（移動なし）の後、実ブラウザは click イベントを発火する。
    // ハンドルが click を握りつぶさないと親のイベント要素まで伝播し、
    // 誤って onEventClick が呼ばれてしまう。
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-handle-click',
      title: '対象',
      start: `${FRI}T09:00`,
      end: `${FRI}T09:30`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick } });
    const occurrenceKey = `ev-handle-click@${at(`${FRI}T09:00`).toISOString()}`;
    const handleEl = screen.getByTestId(`resize-${occurrenceKey}`);
    const x = columnCenterX(FRI);

    firePointerDown(handleEl, x, 540); // 09:00
    releasePointer(x, 540); // 移動なしで即リリース

    fireEvent.click(handleEl);

    expect(onEventClick).not.toHaveBeenCalled();
  });

  it('Escape でドラッグをキャンセルする（イベントは変更されない）', () => {
    const event: CalendarEvent = {
      id: 'ev-escape',
      title: '会議',
      start: `${SAT}T10:00`,
      end: `${SAT}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-escape@${at(`${SAT}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(SAT);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    expect(sink.current?.calendar.state.dragPreview).not.toBeNull();

    pressEscape();
    expect(sink.current?.calendar.state.dragPreview).toBeNull();

    // Escape 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(x, 720);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: `${SAT}T10:00`, end: `${SAT}T11:00` });
  });

  it('previewFor が対象日の分区間を返し、他の日は null になる', () => {
    const { sink } = renderHarness();
    const dayEl = screen.getByTestId(`day-${MON}`);
    const x = columnCenterX(MON);

    firePointerDown(dayEl, x, 600); // 10:00
    movePointer(x, 690); // 11:30

    const viewModel = sink.current?.calendar.viewModel;
    if (viewModel === undefined || viewModel.type !== 'timeGrid') {
      throw new Error('timeGrid ビューモデルを期待');
    }
    const monday = viewModel.days.find((day) => day.key === MON);
    const tuesday = viewModel.days.find((day) => day.key === TUE);
    if (monday === undefined || tuesday === undefined) {
      throw new Error('対象日が見つからない');
    }

    expect(sink.current?.drag.previewFor(monday)).toEqual({
      kind: 'create',
      startMinutes: 600,
      endMinutes: 690,
    });
    expect(sink.current?.drag.previewFor(tuesday)).toBeNull();

    releasePointer(x, 690);
  });

  it('非左クリック（button !== 0）では作成・移動・リサイズのドラッグが一切開始されない', () => {
    const event: CalendarEvent = {
      id: 'ev-rightclick',
      title: '対象',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-rightclick@${at(`${TUE}T10:00`).toISOString()}`;
    const dayEl = screen.getByTestId(`day-${MON}`);
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const handleEl = screen.getByTestId(`resize-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    // 作成
    fireNonPrimaryPointerDown(dayEl, columnCenterX(MON), 600);
    movePointer(columnCenterX(MON), 700);
    releasePointer(columnCenterX(MON), 700);
    // 移動
    fireNonPrimaryPointerDown(eventEl, x, 630);
    movePointer(x, 720);
    releasePointer(x, 720);
    // リサイズ
    fireNonPrimaryPointerDown(handleEl, x, 660);
    movePointer(x, 750);
    releasePointer(x, 750);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: `${TUE}T10:00`, end: `${TUE}T11:00` });
    expect(sink.current?.calendar.state.dragPreview).toBeNull();
  });

  it('onKeyDown: Delete で単発イベントが削除される', () => {
    const event: CalendarEvent = {
      id: 'ev-delete',
      title: '削除対象',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-delete@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(sink.current?.calendar.api.getEvents()).toHaveLength(0);
  });

  it('onKeyDown: editable: false の単発イベントは Delete でも削除されない', () => {
    const event: CalendarEvent = {
      id: 'ev-locked',
      title: '固定（削除不可）',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
      editable: false,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-locked@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });
    fireEvent.keyDown(eventEl, { key: 'Backspace' });

    expect(sink.current?.calendar.api.getEvents()).toHaveLength(1);
  });

  it('onKeyDown: editable: false の繰り返しイベントは Delete でもスコープ解決すら呼ばれない', () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('all' as RecurringEditScope);
    const event: CalendarEvent = {
      id: 'ev-locked-recurring',
      title: '固定（繰り返し・削除不可）',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=DAILY',
      editable: false,
    };
    const { sink } = renderHarness({ events: [event], callbacks: { resolveRecurringScope } });
    const occurrenceKey = `ev-locked-recurring@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(resolveRecurringScope).not.toHaveBeenCalled();
    expect(sink.current?.calendar.api.getEvents()).toHaveLength(1);
    expect(sink.current?.calendar.api.getEvents()[0]?.exdates).toBeUndefined();
  });

  it('onKeyDown: Enter で onEventClick 相当の処理が呼ばれる', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-enter',
      title: '対象',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick } });
    const occurrenceKey = `ev-enter@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    fireEvent.keyDown(eventEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'ev-enter' }),
      expect.any(MouseEvent),
    );
  });

  it('クリック（移動なしの pointerup）だけでは onEventClick は呼ばれない（onClick に委譲）', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-click-only',
      title: '対象',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick } });
    const occurrenceKey = `ev-click-only@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    firePointerDown(eventEl, x, 540);
    releasePointer(x, 540);

    expect(onEventClick).not.toHaveBeenCalled();

    fireEvent.click(eventEl);
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('ドラッグ移動を確定した直後の click は抑制される', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-suppress',
      title: '対象',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick } });
    const occurrenceKey = `ev-suppress@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 660); // 10:00 → 11:00 へ移動
    releasePointer(x, 660);

    // occurrence.key は開始時刻を含むため、移動により対応する DOM 要素も入れ替わる
    const movedKey = `ev-suppress@${at(`${TUE}T11:00`).toISOString()}`;
    const movedEl = screen.getByTestId(`event-${movedKey}`);

    // ブラウザは pointerup 後に click を発火することがあるが、直前の移動確定分は抑制される
    fireEvent.click(movedEl);
    expect(onEventClick).not.toHaveBeenCalled();

    // 抑制は 1 回限り。次のクリックは通常どおり通知される
    fireEvent.click(movedEl);
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('アンマウント後は document のポインタ操作が反映されない', () => {
    const event: CalendarEvent = {
      id: 'ev-unmount',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink, unmount } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-unmount@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720); // ドラッグ中に preview が設定される

    unmount();

    expect(() => {
      movePointer(x, 780);
      releasePointer(x, 780);
      pressEscape();
    }).not.toThrow();

    // アンマウント後の操作は無視されるため、イベントは変更されない
    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: `${TUE}T10:00`, end: `${TUE}T11:00` });
  });

  it('pointercancel でドラッグをキャンセルする（イベントは変更されない、コミットもされない）', () => {
    const event: CalendarEvent = {
      id: 'ev-cancel',
      title: '会議',
      start: `${SAT}T10:00`,
      end: `${SAT}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-cancel@${at(`${SAT}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(SAT);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    expect(sink.current?.calendar.state.dragPreview).not.toBeNull();
    expect(sink.current?.drag.isDragging).toBe(true);

    firePointerCancel();

    expect(sink.current?.calendar.state.dragPreview).toBeNull();
    expect(sink.current?.drag.isDragging).toBe(false);

    // pointercancel 後は document のリスナーが外れているため、以降の pointerup は無視される
    releasePointer(x, 720);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: `${SAT}T10:00`, end: `${SAT}T11:00` });
  });

  it('Escape キャンセル直後の click では onEventClick が呼ばれない', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-escape-click',
      title: '会議',
      start: `${SAT}T10:00`,
      end: `${SAT}T11:00`,
    };
    renderHarness({ events: [event], callbacks: { onEventClick } });
    const occurrenceKey = `ev-escape-click@${at(`${SAT}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(SAT);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    pressEscape();
    releasePointer(x, 720);

    // Escape によるキャンセル直後にブラウザが発火する click は抑制される
    fireEvent.click(eventEl);

    expect(onEventClick).not.toHaveBeenCalled();
  });

  it('resolveRecurringScope が reject した場合、dragPreview が null に戻り onError が呼ばれる', async () => {
    const boom = new Error('boom');
    const resolveRecurringScope = vi.fn().mockRejectedValue(boom);
    const onError = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-error',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { sink } = renderHarness({
      events: [event],
      callbacks: { resolveRecurringScope, onError },
    });

    const occurrenceKey = `recurring-error@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(WED);

    firePointerDown(eventEl, x, 600);
    movePointer(x, 720);
    await releasePointerAsync(x, 720);

    expect(onError).toHaveBeenCalledWith(boom);
    expect(sink.current?.calendar.state.dragPreview).toBeNull();
  });

  it('onEventDelete: 単発イベントの削除で scope: null で通知される', () => {
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-delete-notify',
      title: '削除対象',
      start: `${TUE}T09:00`,
      end: `${TUE}T09:30`,
    };
    renderHarness({ events: [event], callbacks: { onEventDelete } });
    const occurrenceKey = `ev-delete-notify@${at(`${TUE}T09:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(onEventDelete).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-delete-notify' }),
      scope: null,
    });
  });

  it('onEventDelete: 繰り返しイベントの削除でスコープ込みで通知される', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-delete-notify',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    renderHarness({ events: [event], callbacks: { resolveRecurringScope, onEventDelete } });
    const occurrenceKey = `recurring-delete-notify@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'Delete' });
    });

    expect(onEventDelete).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'recurring-delete-notify' }),
      scope: 'this',
    });
  });

  it('onEventDelete: スコープ解決がキャンセル（null）の場合は通知されない', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue(null);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-delete-cancel',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    renderHarness({ events: [event], callbacks: { resolveRecurringScope, onEventDelete } });
    const occurrenceKey = `recurring-delete-cancel@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'Delete' });
    });

    expect(onEventDelete).not.toHaveBeenCalled();
  });

  it('上端ハンドルのドラッグ（resize-start）で開始時刻だけが変わる', () => {
    const event: CalendarEvent = {
      id: 'ev-resize-start',
      title: '会議',
      start: `${FRI}T10:00`,
      end: `${FRI}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-resize-start@${at(`${FRI}T10:00`).toISOString()}`;
    const handleEl = screen.getByTestId(`resize-start-${occurrenceKey}`);
    const x = columnCenterX(FRI);

    firePointerDown(handleEl, x, 600); // 10:00
    movePointer(x, 540); // 9:00
    releasePointer(x, 540);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: at(`${FRI}T09:00`), end: at(`${FRI}T11:00`) });
  });

  it('上端ハンドルのリサイズは最小 snap 分の長さを下回らない（終了より後ろに動かしても start は終了-snap 分）', () => {
    const event: CalendarEvent = {
      id: 'ev-resize-start-min',
      title: '会議',
      start: `${FRI}T10:00`,
      end: `${FRI}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-resize-start-min@${at(`${FRI}T10:00`).toISOString()}`;
    const handleEl = screen.getByTestId(`resize-start-${occurrenceKey}`);
    const x = columnCenterX(FRI);

    firePointerDown(handleEl, x, 600); // 10:00
    movePointer(x, 900); // 15:00（終了より後ろ）
    releasePointer(x, 900);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${FRI}T10:45`), end: at(`${FRI}T11:00`) });
  });

  it('data-koyomi-resize-handle は edge に応じて start/end になる', () => {
    const event: CalendarEvent = {
      id: 'ev-resize-attr',
      title: '会議',
      start: `${FRI}T10:00`,
      end: `${FRI}T11:00`,
    };
    renderHarness({ events: [event] });
    const occurrenceKey = `ev-resize-attr@${at(`${FRI}T10:00`).toISOString()}`;
    const startHandle = screen.getByTestId(`resize-start-${occurrenceKey}`);
    const endHandle = screen.getByTestId(`resize-${occurrenceKey}`);

    expect(startHandle).toHaveAttribute('data-koyomi-resize-handle', 'start');
    expect(endHandle).toHaveAttribute('data-koyomi-resize-handle', 'end');
  });

  it('矢印キー: ArrowDown で単発イベントが snapMinutes 分だけ後ろに移動する', async () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-arrow-down',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event], callbacks: { onEventChange } });
    const occurrenceKey = `ev-arrow-down@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${TUE}T10:15`), end: at(`${TUE}T11:15`) });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-arrow-down' }),
      newRange: { start: at(`${TUE}T10:15`), end: at(`${TUE}T11:15`) },
      allDay: false,
      scope: null,
    });
  });

  it('矢印キー: Shift+ArrowDown で終了時刻が snapMinutes 分だけ延長される', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-arrow-down',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-shift-arrow-down@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown', shiftKey: true });
    });

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${TUE}T10:00`), end: at(`${TUE}T11:15`) });
  });

  it('矢印キー: Shift+ArrowUp は最小 snap 分の長さを下回る場合は変更しない', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-arrow-up-min',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T10:15`, // すでに snapMinutes（15 分）ちょうどの長さ
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-shift-arrow-up-min@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowUp', shiftKey: true });
    });

    // 変更が適用されなかったため、ソースイベントの start/end は元の文字列のまま
    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: `${TUE}T10:00`, end: `${TUE}T10:15` });
  });

  it('矢印キー: ArrowLeft/ArrowRight で 1 日単位に移動する', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-day',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-arrow-day@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowRight' });
    });

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${WED}T10:00`), end: at(`${WED}T11:00`) });
  });

  it('矢印キー: editable: false のイベントは無視される', async () => {
    const event: CalendarEvent = {
      id: 'ev-arrow-locked',
      title: '固定',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
      editable: false,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-arrow-locked@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: `${TUE}T10:00`, end: `${TUE}T11:00` });
  });

  it('矢印キー: 繰り返しイベントは resolveRecurringScope で解決される', async () => {
    const resolveRecurringScope = vi.fn(
      async (
        _occurrence: EventOccurrence,
        _action: 'move' | 'resize' | 'delete' | 'update',
      ): Promise<RecurringEditScope | null> => 'this',
    );
    const event: CalendarEvent = {
      id: 'recurring-arrow',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { sink } = renderHarness({ events: [event], callbacks: { resolveRecurringScope } });
    const occurrenceKey = `recurring-arrow@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-arrow' }),
      'move',
    );
    const events = sink.current?.calendar.api.getEvents() ?? [];
    const override = events.find((candidate) => candidate.recurringEventId === 'recurring-arrow');
    expect(override).toMatchObject({ start: at(`${WED}T10:15`), end: at(`${WED}T11:15`) });
  });

  it('ドラッグ中に自動スクロール対象領域へ移動してもクリーンアップでエラーにならない', () => {
    const event: CalendarEvent = {
      id: 'ev-autoscroll',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    renderHarness({ events: [event] });
    const bodyEl = screen.getByTestId('timegrid-body');
    vi.spyOn(bodyEl, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: COLUMN_WIDTH * WEEK_KEYS.length, height: 600 }),
    );
    const occurrenceKey = `ev-autoscroll@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    expect(() => {
      firePointerDown(eventEl, x, 600);
      movePointer(x, 0); // オートスクロール対象領域（上端）へ
      releasePointer(x, 0);
    }).not.toThrow();
  });
});

describe('useTimeGridDrag - 終日行への変換ドラッグ', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('時間指定イベントを終日行の上で離すと allDay: true・その日 1 日のイベントに変換される', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-to-allday',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event], callbacks: { onEventChange } });
    const occurrenceKey = `ev-to-allday@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(makeAlldayCellElement());

    firePointerDown(eventEl, x, 600); // 10:00 を掴む
    movePointer(x, 10); // 終日行相当の位置（elementFromPoint モックで判定）
    releasePointer(x, 10);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${TUE}T00:00`),
      end: at(`${WED}T00:00`),
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-to-allday' }),
      newRange: { start: at(`${TUE}T00:00`), end: at(`${WED}T00:00`) },
      allDay: true,
      scope: null,
    });
  });

  it('複数日にまたがる時間指定イベントを終日行の上で離すと、暦日数分の終日イベントに変換される', () => {
    const event: CalendarEvent = {
      id: 'ev-to-allday-multiday',
      title: '夜間出張',
      start: `${TUE}T22:00`,
      end: `${WED}T02:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-to-allday-multiday@${at(`${TUE}T22:00`).toISOString()}`;
    // 日をまたぐ時間指定イベントは日ごとに分割されて描画されるため、TUE 側の断片を使う。
    const eventEl = screen.getAllByTestId(`event-${occurrenceKey}`)[0];
    if (eventEl === undefined) {
      throw new Error('イベント要素が見つかりません');
    }
    const x = columnCenterX(TUE);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(makeAlldayCellElement());

    firePointerDown(eventEl, x, 1350); // TUE 22:30 相当を掴む
    movePointer(x, 10); // 終日行相当の位置（TUE 列のまま）
    releasePointer(x, 10);

    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      allDay: true,
      start: at(`${TUE}T00:00`),
      end: at(`${THU}T00:00`), // TUE・WED の 2 暦日分
    });
  });

  it('変換ドラッグ中はプレビューが allDay: true になり、時間グリッド側の previewFor は null を返す', () => {
    const event: CalendarEvent = {
      id: 'ev-preview-allday',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-preview-allday@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(makeAlldayCellElement());

    firePointerDown(eventEl, x, 600);
    movePointer(x, 10);

    if (sink.current === null) {
      throw new Error('sink が設定されていません');
    }
    const preview = sink.current.calendar.state.dragPreview;
    expect(preview?.allDay).toBe(true);
    expect(preview?.range).toEqual({ start: at(`${TUE}T00:00`), end: at(`${WED}T00:00`) });

    const tueDay = getTimeGridDays(sink.current).find((day) => day.key === TUE);
    if (tueDay === undefined) {
      throw new Error('TUE の列が見つかりません');
    }
    // allDay: true のプレビューは時間グリッド側では描画しない（useDayDrag 側が担当する）
    expect(sink.current.drag.previewFor(tueDay)).toBeNull();

    releasePointer(x, 10);
  });

  it('elementFromPoint が領域外（null）を返す場合は従来どおり時間グリッド内の移動として扱われる', () => {
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-no-conversion',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event], callbacks: { onEventChange } });
    const occurrenceKey = `ev-no-conversion@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

    firePointerDown(eventEl, x, 600); // 10:00
    movePointer(x, 720); // 12:00（+2h、同じ列内の通常移動）
    releasePointer(x, 720);

    // 通常移動は allDay を patch に含めないため、変換されていないことは
    // イベント自体に allDay: true が付与されていないことで確認する。
    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]?.allDay).not.toBe(true);
    expect(events[0]).toMatchObject({
      start: at(`${TUE}T12:00`),
      end: at(`${TUE}T13:00`),
    });
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence: expect.objectContaining({ eventId: 'ev-no-conversion' }),
      newRange: { start: at(`${TUE}T12:00`), end: at(`${TUE}T13:00`) },
      allDay: false,
      scope: null,
    });
  });

  it('終日行から時間グリッドへ戻ると通常の move プレビュー（allDay: false）に戻る', () => {
    const event: CalendarEvent = {
      id: 'ev-back-to-grid',
      title: '会議',
      start: `${TUE}T10:00`,
      end: `${TUE}T11:00`,
    };
    const { sink } = renderHarness({ events: [event] });
    const occurrenceKey = `ev-back-to-grid@${at(`${TUE}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(TUE);

    const spy = vi.spyOn(document, 'elementFromPoint');
    spy.mockReturnValue(makeAlldayCellElement());

    firePointerDown(eventEl, x, 600);
    movePointer(x, 10); // 終日行へ
    expect(sink.current?.calendar.state.dragPreview?.allDay).toBe(true);

    spy.mockReturnValue(null); // 時間グリッドへ戻る
    movePointer(x, 720); // 12:00

    const previewBack = sink.current?.calendar.state.dragPreview;
    expect(previewBack?.allDay).toBe(false);
    expect(previewBack?.range).toEqual({ start: at(`${TUE}T12:00`), end: at(`${TUE}T13:00`) });

    releasePointer(x, 720);
    const events = sink.current?.calendar.api.getEvents() ?? [];
    expect(events[0]?.allDay).not.toBe(true);
    expect(events[0]).toMatchObject({
      start: at(`${TUE}T12:00`),
      end: at(`${TUE}T13:00`),
    });
  });

  it('繰り返しイベントの終日変換では resolveRecurringScope が呼ばれ、解決したスコープで適用される', async () => {
    const resolveRecurringScope = vi.fn(
      async (
        _occurrence: EventOccurrence,
        _action: 'move' | 'resize' | 'delete' | 'update',
      ): Promise<RecurringEditScope | null> => 'this',
    );
    const onEventChange = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-to-allday',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { sink } = renderHarness({
      events: [event],
      callbacks: { resolveRecurringScope, onEventChange },
    });
    const occurrenceKey = `recurring-to-allday@${at(`${WED}T10:00`).toISOString()}`;
    const eventEl = screen.getByTestId(`event-${occurrenceKey}`);
    const x = columnCenterX(WED);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(makeAlldayCellElement());

    firePointerDown(eventEl, x, 600); // 10:00
    movePointer(x, 10); // 終日行相当
    await releasePointerAsync(x, 10);

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-to-allday' }),
      'move',
    );
    const events = sink.current?.calendar.api.getEvents() ?? [];
    const override = events.find(
      (candidate) => candidate.recurringEventId === 'recurring-to-allday',
    );
    expect(override).toMatchObject({
      allDay: true,
      start: at(`${WED}T00:00`),
      end: at(`${THU}T00:00`),
    });
    expect(onEventChange).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, scope: 'this' }),
    );
  });
});

describe('autoScrollVelocity', () => {
  it('コンテナ中央では 0 を返す', () => {
    expect(autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 300 })).toBe(0);
  });

  it('上端の threshold 境界ちょうどでは 0 を返す', () => {
    expect(autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 24 })).toBe(0);
  });

  it('上端（pointer = edgeStart）では負の最大速度を返す', () => {
    expect(autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 0 })).toBe(-16);
  });

  it('下端の threshold 境界ちょうどでは 0 を返す', () => {
    expect(autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 576 })).toBe(0);
  });

  it('下端（pointer = edgeEnd）では正の最大速度を返す', () => {
    expect(autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 600 })).toBe(16);
  });

  it('端に近いほど速度の絶対値が大きくなる（上端寄り）', () => {
    const near = autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 6 });
    const far = autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 18 });
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThan(0);
  });

  it('threshold / maxSpeed をカスタマイズできる', () => {
    expect(
      autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 0, threshold: 10, maxSpeed: 40 }),
    ).toBe(-40);
  });
});
