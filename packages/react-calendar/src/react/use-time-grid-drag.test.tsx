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
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { parseDateValue } from '../core/timezone';
import type {
  CalendarApi,
  CalendarEvent,
  EventOccurrence,
  RecurringEditScope,
} from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import type { TimeGridDragHandlers } from './use-time-grid-drag';
import { useTimeGridDrag } from './use-time-grid-drag';

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
    <div>
      {viewModel.days.map((day) => {
        const { ref: dayRef, ...dayProps } = drag.getDayProps(day);
        return (
          <div key={day.key} {...dayProps} ref={toDivRef(dayRef)} data-testid={`day-${day.key}`}>
            {day.items.map((item) => {
              const eventProps = drag.getEventProps(item);
              const resizeProps = drag.getResizeHandleProps(item);
              return (
                <div
                  key={item.occurrence.key}
                  {...eventProps}
                  data-testid={`event-${item.occurrence.key}`}
                >
                  <div {...resizeProps} data-testid={`resize-${item.occurrence.key}`} />
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
});
