/**
 * use-day-drag.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar`（React 層の他フック）は別エージェントが並行実装中のため、
 * ここでは `createCalendar` を `useSyncExternalStore` で購読する簡易ハーネスを
 * 用意し、`UseCalendarResult` を自前で構築してテストする。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement, Ref } from 'react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { dateFromKey } from '../core/timezone';
import type { CalendarApi, EventOccurrence, EventSegment } from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import type { DayDragHandlers } from './use-day-drag';
import { useDayDrag } from './use-day-drag';

// jsdom はこの環境で document.elementFromPoint を実装していない（typeof が 'undefined'）。
// vi.spyOn は既存の関数にしかスパイできないため、既定実装（常に null＝領域外）を
// 一度だけ用意しておく（各テストでは vi.spyOn でこれを上書きし、既存の afterEach で復元される）。
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

const TOKYO = 'Asia/Tokyo';
const NOW = new Date('2026-07-15T01:00:00Z');

/** テスト全体で使う日セル（2026-07-06〜2026-07-14）の日付キー。 */
const DAY_KEYS = [
  '2026-07-06',
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
  '2026-07-12',
  '2026-07-13',
  '2026-07-14',
];

/** 各セルの幅（px）。日付キーの配列インデックス × CELL_WIDTH が左端になる。 */
const CELL_WIDTH = 100;

/** 指定インデックスのセル中心の clientX（clientY は固定で 25）。 */
function cellCenterX(index: number): number {
  return index * CELL_WIDTH + CELL_WIDTH / 2;
}

/** 指定した DOM 要素の `getBoundingClientRect` を固定のセル矩形にモックする。 */
function mockCellRect(element: HTMLElement, index: number): void {
  const left = index * CELL_WIDTH;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + CELL_WIDTH,
    top: 0,
    bottom: 50,
    width: CELL_WIDTH,
    height: 50,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

/**
 * テスト用の時間グリッド日列要素（`data-koyomi="timegrid-day"` /
 * `data-koyomi-date`）を作る。`document.elementFromPoint` のモック戻り値として使う。
 * DOM に接続しなくても `Element#closest` は自身の祖先チェーンだけを辿るため機能する。
 *
 * `rect` は 1px = 1 分に対応する矩形（`top` からの高さ 1440px で 24 時間分）で、
 * `dispatchPointerMove` の `clientY` をそのまま「日内の分」として扱えるようにする。
 */
function makeTimeGridDayElement(
  dateKey: string,
  rect: { top: number; height: number },
): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-koyomi', 'timegrid-day');
  element.setAttribute('data-koyomi-date', dateKey);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: CELL_WIDTH,
    top: rect.top,
    bottom: rect.top + rect.height,
    width: CELL_WIDTH,
    height: rect.height,
    x: 0,
    y: rect.top,
    toJSON: () => ({}),
  });
  return element;
}

/** document に pointermove をディスパッチする（jsdom は PointerEvent 未実装のため MouseEvent で代用）。 */
function dispatchPointerMove(clientX: number, clientY = 25): void {
  document.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
}

/** document に pointerup をディスパッチする。 */
function dispatchPointerUp(clientX: number, clientY = 25): void {
  document.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, bubbles: true }));
}

/** document に pointercancel をディスパッチする（jsdom は PointerEvent 未実装のため Event で代用）。 */
function dispatchPointerCancel(): void {
  document.dispatchEvent(new Event('pointercancel', { bubbles: true }));
}

/** document に Escape キーの keydown をディスパッチする。 */
function dispatchEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** マイクロタスク・タスクキューを 1 巡フラッシュする（非同期の resolveRecurringScope 待ち用）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** テスト用カレンダーを作成する。 */
function makeCalendarApi(options: Parameters<typeof createCalendar>[0]): CalendarApi {
  return createCalendar(options);
}

/**
 * `Ref<HTMLElement>` を `Ref<HTMLDivElement>` として使うためのアダプタ。
 * `getDayCellProps` の `ref` は要素の型をコンポーネント非依存にするため
 * `HTMLElement` で宣言されているが、テストでは `<div>` に割り当てるために
 * コールバック形式であることを前提に橋渡しする（`RefObject` は渡さない）。
 */
function attachDivRef(ref: Ref<HTMLElement>): Ref<HTMLDivElement> {
  return (element: HTMLDivElement | null) => {
    if (typeof ref === 'function') {
      ref(element);
    }
  };
}

/** `useDayDrag` を呼び出し、セル・セグメントを描画するテスト用コンポーネント。 */
function TestGrid(props: {
  api: CalendarApi;
  segments?: readonly EventSegment[];
  callbacks?: CalendarInteractionCallbacks;
  resultRef: { current: DayDragHandlers | null };
  /** 各セグメントの左右端にリサイズハンドルを描画するか。 */
  renderResizeHandles?: boolean;
}): ReactElement {
  const state = useSyncExternalStore(props.api.subscribe, props.api.getState);
  const viewModel = props.api.getViewModel();
  const calendar: UseCalendarResult = { api: props.api, state, viewModel };
  const handlers = useDayDrag(
    props.callbacks === undefined ? { calendar } : { calendar, callbacks: props.callbacks },
  );
  props.resultRef.current = handlers;

  return (
    <div>
      {DAY_KEYS.map((key) => {
        const cellProps = handlers.getDayCellProps({ date: dateFromKey(key, TOKYO), key });
        return (
          <div
            key={key}
            data-testid={`cell-${key}`}
            {...cellProps}
            ref={attachDivRef(cellProps.ref)}
          />
        );
      })}
      {(props.segments ?? []).map((segment) => {
        const segmentProps = handlers.getSegmentProps(segment);
        return (
          <div
            key={segment.occurrence.key}
            data-testid={`seg-${segment.occurrence.key}`}
            {...segmentProps}
          >
            {props.renderResizeHandles === true && (
              <>
                <div
                  data-testid={`resize-start-${segment.occurrence.key}`}
                  {...handlers.getSegmentResizeHandleProps(segment, 'start')}
                />
                <div
                  data-testid={`resize-end-${segment.occurrence.key}`}
                  {...handlers.getSegmentResizeHandleProps(segment, 'end')}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** レンダー後、全セルの矩形をインデックス順に固定する。 */
function setupCellRects(container: HTMLElement): void {
  DAY_KEYS.forEach((key, index) => {
    const element = container.querySelector(`[data-testid="cell-${key}"]`);
    if (element instanceof HTMLElement) {
      mockCellRect(element, index);
    }
  });
}

/** `EventSegment` を組み立てる（レイアウト情報はテストでは意味を持たないダミー値）。 */
function makeSegment(occurrence: EventOccurrence): EventSegment {
  return {
    occurrence,
    startCol: 0,
    span: 1,
    lane: 0,
    continuesBefore: false,
    continuesAfter: false,
    hidden: false,
  };
}

/**
 * 更新後の `start`/`end` が `Date`（`updateEvent` の patch 適用結果は文字列ではなく
 * `Date` になる）であることを確認しつつ、日付キー基準で期待値と比較する。
 */
function expectDateKey(value: Date | string | undefined, expectedKey: string): void {
  expect(value).toBeInstanceOf(Date);
  if (!(value instanceof Date)) {
    throw new Error('Date ではありません');
  }
  expect(value.getTime()).toBe(dateFromKey(expectedKey, TOKYO).getTime());
}

const WIDE_RANGE = {
  start: dateFromKey('2026-07-01', TOKYO),
  end: dateFromKey('2026-08-01', TOKYO),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDayDrag - セルのドラッグによる範囲選択', () => {
  it('7/10 セルから 7/12 セルへドラッグすると、7/10 0:00〜7/13 0:00 の範囲で onSelectRange が呼ばれる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell710 = container.querySelector('[data-testid="cell-2026-07-10"]');
    expect(cell710).toBeInstanceOf(HTMLElement);
    if (!(cell710 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell710.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(4),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(6));
    });

    // ドラッグ中は previewRange / isDragging に反映される
    expect(resultRef.current?.isDragging).toBe(true);
    expect(resultRef.current?.previewRange?.start.getTime()).toBe(
      dateFromKey('2026-07-10', TOKYO).getTime(),
    );
    expect(resultRef.current?.previewRange?.end.getTime()).toBe(
      dateFromKey('2026-07-13', TOKYO).getTime(),
    );

    act(() => {
      dispatchPointerUp(cellCenterX(6));
    });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.allDay).toBe(true);
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-13', TOKYO).getTime());

    // ドラッグ終了後は previewRange / isDragging がリセットされる
    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();
  });

  it('非左クリック（button !== 0）ではセル選択もセグメント移動も開始されない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell710 = container.querySelector('[data-testid="cell-2026-07-10"]');
    if (!(cell710 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell710.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(4),
          clientY: 25,
          button: 2,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(6));
    });

    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();

    act(() => {
      dispatchPointerUp(cellCenterX(6));
    });
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('反転ドラッグ（7/12 → 7/10）でも同じ範囲になる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell712 = container.querySelector('[data-testid="cell-2026-07-12"]');
    if (!(cell712 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell712.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(6),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-13', TOKYO).getTime());
  });

  it('ドラッグせずクリックした場合は 1 日分の範囲になる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell709 = container.querySelector('[data-testid="cell-2026-07-09"]');
    if (!(cell709 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell709.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(3),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerUp(cellCenterX(3));
    });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.allDay).toBe(true);
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-09', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
  });

  it('コールバック省略時は allDay イベントが既定タイトルで即時作成される', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(<TestGrid api={api} resultRef={resultRef} />);
    setupCellRects(container);

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerUp(cellCenterX(2));
    });

    const events = api.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('(タイトルなし)');
    expect(events[0]?.allDay).toBe(true);
  });
});

describe('useDayDrag - セグメントのドラッグによる移動', () => {
  it('2 日間の終日イベントを +2 日ドラッグすると、期間を維持したまま開始・終了が 2 日ずれる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4)); // 7/10（+2日）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBeInstanceOf(Date);
    const start = updated?.start;
    const end = updated?.end;
    if (!(start instanceof Date) || !(end instanceof Date)) {
      throw new Error('更新後の start/end が Date ではありません');
    }
    expect(start.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
    expect(end.getTime()).toBe(dateFromKey('2026-07-12', TOKYO).getTime());
  });

  it('時間指定イベント（span 1 セグメント）の日移動では壁時計時刻が維持される', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: 'MTG',
      start: '2026-07-08T09:00',
      end: '2026-07-08T10:30',
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4)); // 7/10（+2日）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    const start = updated?.start;
    const end = updated?.end;
    if (!(start instanceof Date) || !(end instanceof Date)) {
      throw new Error('更新後の start/end が Date ではありません');
    }
    // 壁時計時刻（09:00 / 10:30）を維持したまま日付だけ 7/10 にずれる
    expect(start.getTime()).toBe(
      new Date(occurrence.start.getTime() + 2 * 24 * 60 * 60 * 1000).getTime(),
    );
    expect(end.getTime()).toBe(
      new Date(occurrence.end.getTime() + 2 * 24 * 60 * 60 * 1000).getTime(),
    );
  });

  it('繰り返しセグメントの移動では resolveRecurringScope が呼ばれ、解決したスコープで更新される', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }
    expect(occurrence.isRecurring).toBe(true);

    const resolveRecurringScope = vi.fn().mockResolvedValue('this');
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(3)); // 7/9（+1日）
    });
    await act(async () => {
      dispatchPointerUp(cellCenterX(3));
      await flush();
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(occurrence, 'move');
    // scope: 'this' はオーバーライドイベントを新規作成する
    const overrides = api.getEvents().filter((event) => event.recurringEventId === created.id);
    expect(overrides).toHaveLength(1);
    expect(onEventChange).toHaveBeenCalledTimes(1);
    const change = onEventChange.mock.calls[0]?.[0];
    expect(change?.scope).toBe('this');
  });

  it('resolveRecurringScope が null を返すとキャンセルされ、イベントは変更されない', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue(null);
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const eventsBefore = api.getEvents();

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(3));
    });
    await act(async () => {
      dispatchPointerUp(cellCenterX(3));
      await flush();
    });

    expect(resolveRecurringScope).toHaveBeenCalledTimes(1);
    expect(api.getEvents()).toEqual(eventsBefore);
    expect(onEventChange).not.toHaveBeenCalled();
  });
});

describe('useDayDrag - ドラッグプレビューの allDay フラグ', () => {
  it('時間指定・複数日にまたがるセグメントの移動中は、dragPreview.allDay が true になる（帯としての見た目のフラグであり occurrence.allDay とは独立）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '夜間出張',
      start: '2026-07-08T22:00',
      end: '2026-07-10T02:00',
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }
    // 前提: 時間指定イベントなので occurrence.allDay は false
    expect(occurrence.allDay).toBe(false);

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4)); // 7/10（+2日）
    });

    expect(api.getState().dragPreview?.allDay).toBe(true);

    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });
  });
});

describe('useDayDrag - セグメントのクリックと onEventClick', () => {
  it('ドラッグせずクリックした場合は onEventClick が呼ばれる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventClick = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventClick }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerUp(cellCenterX(2));
    });
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toBe(occurrence);
  });

  it('セグメントのドラッグ移動が確定した直後の click では onEventClick が発火しない（ブラウザの pointerup 後の自動 click を抑制）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventClick = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventClick }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4)); // 7/10（+2日、実際に移動）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });
    // ブラウザは pointerup 直後に click を自動発火する（jsdom では手動で再現する）
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onEventClick).not.toHaveBeenCalled();

    // 抑制は 1 回限り。次のクリックは通常どおり発火する
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('同じセル内での微小なポインタ移動（開始日と同じ日）はドラッグ移動として確定されず、続く click で onEventClick が呼ばれる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventClick = vi.fn();
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventClick, onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8 のセル中心
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      // 同じセル（7/8）内での小さな揺れ。日は変わらない
      dispatchPointerMove(cellCenterX(2) + 5);
    });
    act(() => {
      dispatchPointerUp(cellCenterX(2) + 5);
    });
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 開始日と同じ日にとどまっているため「移動」扱いにならず、イベント変更は起きない
    expect(onEventChange).not.toHaveBeenCalled();
    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBe('2026-07-08');
    // クリックとして扱われ onEventClick が呼ばれる
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });
});

describe('useDayDrag - editable: false / Escape / previewRange / アンマウント', () => {
  it('editable: false のイベントはドラッグを開始しない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '固定予定',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
      editable: false,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });

    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();

    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBe('2026-07-08');
    expect(onEventChange).not.toHaveBeenCalled();
  });

  it('ドラッグ中に Escape を押すとキャンセルされ、イベントは作成されない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });
    expect(resultRef.current?.isDragging).toBe(true);

    act(() => {
      dispatchEscape();
    });
    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();

    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    expect(onSelectRange).not.toHaveBeenCalled();
    expect(api.getEvents()).toHaveLength(0);
  });

  it('previewRange と isDragging は、ドラッグ開始前・中・終了後で正しく変化する', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(<TestGrid api={api} resultRef={resultRef} />);
    setupCellRects(container);

    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(2));
    });

    expect(resultRef.current?.isDragging).toBe(true);
    expect(resultRef.current?.previewRange?.start.getTime()).toBe(
      dateFromKey('2026-07-08', TOKYO).getTime(),
    );

    act(() => {
      dispatchPointerUp(cellCenterX(2));
    });

    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();
  });

  it('アンマウントするとドラッグ中の document リスナーが解除される', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container, unmount } = render(<TestGrid api={api} resultRef={resultRef} />);
    setupCellRects(container);

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });

    act(() => {
      unmount();
    });

    // アンマウント後に pointerup が届いても、リスナーは解除済みのため何も起きない
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    expect(api.getEvents()).toHaveLength(0);
  });
});

describe('useDayDrag - beginDrag の自己回復', () => {
  it('前のセッションが finish/cancel を経ずに残っていても、新しいドラッグを開始できる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    const cell710 = container.querySelector('[data-testid="cell-2026-07-10"]');
    if (!(cell708 instanceof HTMLElement) || !(cell710 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    // 1 つ目のドラッグを開始するが、pointerup/Escape/pointercancel を一切経由せず放置する
    act(() => {
      cell708.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    // dragPreview は pointermove で初めて設定されるため、まず動かして「進行中」を確定させる
    act(() => {
      dispatchPointerMove(cellCenterX(2));
    });
    expect(resultRef.current?.isDragging).toBe(true);

    // 2 つ目のドラッグ開始（早期 return ガードだけだと、以前のセッションが残り無視されていた）
    act(() => {
      cell710.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(4),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });
    expect(resultRef.current?.isDragging).toBe(true);
    expect(resultRef.current?.previewRange?.start.getTime()).toBe(
      dateFromKey('2026-07-10', TOKYO).getTime(),
    );

    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    // 新しいセッション（7/10 起点）のみが確定する
    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-11', TOKYO).getTime());
  });
});

describe('useDayDrag - pointercancel によるキャンセル', () => {
  it('ドラッグ中に pointercancel が発生するとキャンセルされ、イベントは変更されない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });
    expect(resultRef.current?.isDragging).toBe(true);

    act(() => {
      dispatchPointerCancel();
    });

    expect(resultRef.current?.isDragging).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();
    expect(onEventChange).not.toHaveBeenCalled();
    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBe('2026-07-08');

    // キャンセル後に pointerup が届いても、リスナーは解除済みのため何も起きない
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });
    expect(onEventChange).not.toHaveBeenCalled();
  });
});

describe('useDayDrag - Escape キャンセル直後の click 抑制', () => {
  it('ドラッグ中に Escape でキャンセルした直後の click では onEventClick が発火しない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventClick = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventClick }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4));
    });
    act(() => {
      dispatchEscape();
    });
    // Escape 後、ブラウザが自動発火する click が届いても抑制される
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onEventClick).not.toHaveBeenCalled();

    // 抑制は 1 回限り。次のクリックは通常どおり発火する
    act(() => {
      segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });
});

describe('useDayDrag - 非同期コミットのエラー処理', () => {
  it('繰り返し発生の移動確定で resolveRecurringScope が失敗した場合、onError に委譲される', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const boom = new Error('scope resolution failed');
    const resolveRecurringScope = vi.fn().mockRejectedValue(boom);
    const onError = vi.fn();
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onError, onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(3));
    });
    await act(async () => {
      dispatchPointerUp(cellCenterX(3));
      await flush();
    });

    expect(onError).toHaveBeenCalledWith(boom);
    expect(onEventChange).not.toHaveBeenCalled();
    // ドラッグプレビューは確定処理の成否によらず残らない
    expect(api.getState().dragPreview).toBeNull();
  });

  it('onError が未指定の場合は console.error に既定動作として出力される', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const boom = new Error('scope resolution failed');
    const resolveRecurringScope = vi.fn().mockRejectedValue(boom);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(3));
    });
    await act(async () => {
      dispatchPointerUp(cellCenterX(3));
      await flush();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(boom);
  });
});

describe('useDayDrag - onEventDelete 通知', () => {
  it('単発イベントの削除確定後、scope: null で onEventDelete が呼ばれる', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventDelete = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventDelete }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    await act(async () => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await flush();
    });

    expect(api.getEvents()).toHaveLength(0);
    expect(onEventDelete).toHaveBeenCalledTimes(1);
    expect(onEventDelete.mock.calls[0]?.[0]).toEqual({ occurrence, scope: null });
  });

  it('繰り返し発生の削除確定後、解決したスコープで onEventDelete が呼ばれる', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue('all');
    const onEventDelete = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventDelete }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    await act(async () => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await flush();
    });

    expect(onEventDelete).toHaveBeenCalledTimes(1);
    expect(onEventDelete.mock.calls[0]?.[0]).toEqual({ occurrence, scope: 'all' });
  });

  it('resolveRecurringScope が null を返すとキャンセルされ、onEventDelete は呼ばれない', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue(null);
    const onEventDelete = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventDelete }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    await act(async () => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await flush();
    });

    expect(onEventDelete).not.toHaveBeenCalled();
  });
});

describe('useDayDrag - 帯セグメントの左右端リサイズ', () => {
  it('右端ハンドルのドラッグで終了日だけが伸びる（開始日は変わらない）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        renderResizeHandles
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const handle = container.querySelector(`[data-testid="resize-end-${occurrence.key}"]`);
    if (!(handle instanceof HTMLElement)) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(3), // 7/9（最終日）
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(5)); // 7/11（+2日）
    });
    // stopPropagation によりセグメント本体の 'move' セッションは開始されず、
    // ハンドル発の 'resize-end'（見た目上は 'resize'）のみが有効になっている
    expect(api.getState().dragPreview?.kind).toBe('resize');

    act(() => {
      dispatchPointerUp(cellCenterX(5));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-08');
    expectDateKey(updated?.end, '2026-07-12');
  });

  it('左端ハンドルのドラッグで開始日だけが変わる（終了日は変わらない）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        renderResizeHandles
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const handle = container.querySelector(`[data-testid="resize-start-${occurrence.key}"]`);
    if (!(handle instanceof HTMLElement)) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2), // 7/8
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(0)); // 7/6（-2日）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(0));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-06');
    expectDateKey(updated?.end, '2026-07-10');
  });

  it('最低 1 日分の長さを下回らない（開始日より前まで縮めても 1 日分は残る）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        renderResizeHandles
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const handle = container.querySelector(`[data-testid="resize-end-${occurrence.key}"]`);
    if (!(handle instanceof HTMLElement)) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(3), // 7/9（最終日）
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(0)); // 7/6（開始日より前まで縮めようとする）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(0));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-08');
    expectDateKey(updated?.end, '2026-07-09');
  });

  it('editable: false のイベントはリサイズハンドルのドラッグを開始しない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '固定予定',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
      editable: false,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        renderResizeHandles
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const handle = container.querySelector(`[data-testid="resize-end-${occurrence.key}"]`);
    if (!(handle instanceof HTMLElement)) {
      throw new Error('リサイズハンドルが見つかりません');
    }

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(3),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    expect(resultRef.current?.isDragging).toBe(false);

    act(() => {
      dispatchPointerMove(cellCenterX(5));
    });
    act(() => {
      dispatchPointerUp(cellCenterX(5));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.end).toBe('2026-07-10');
    expect(onEventChange).not.toHaveBeenCalled();
  });
});

describe('useDayDrag - セグメントのキーボード操作（移動・リサイズ）', () => {
  it('ArrowRight で発生が 1 日後ろに移動する', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-09');
    expectDateKey(updated?.end, '2026-07-11');
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });

  it('ArrowLeft で発生が 1 日前に移動する', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-07');
    expectDateKey(updated?.end, '2026-07-09');
  });

  it('ArrowDown で発生が 7 日後ろに移動する（月グリッドの下移動に対応）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-15');
    expectDateKey(updated?.end, '2026-07-17');
  });

  it('ArrowUp で発生が 7 日前に移動する（月グリッドの上移動に対応）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-01');
    expectDateKey(updated?.end, '2026-07-03');
  });

  it('Shift+ArrowRight で終了日だけが 1 日伸びる（開始日は変わらない）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-08');
    expectDateKey(updated?.end, '2026-07-11');
  });

  it('Shift+ArrowLeft で終了日だけが 1 日縮む', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-11',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
      );
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expectDateKey(updated?.start, '2026-07-08');
    expectDateKey(updated?.end, '2026-07-10');
  });

  it('Shift+ArrowLeft は最低 1 日分の長さを下回る場合は変更しない', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-09',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
      );
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBe('2026-07-08');
    expect(updated?.end).toBe('2026-07-09');
    expect(onEventChange).not.toHaveBeenCalled();
  });

  it('editable: false の発生は矢印キー操作を無視する', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '固定予定',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
      editable: false,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    act(() => {
      segment.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.start).toBe('2026-07-08');
    expect(updated?.end).toBe('2026-07-10');
    expect(onEventChange).not.toHaveBeenCalled();
  });

  it('繰り返し発生の ArrowRight 移動は resolveRecurringScope に action: "move" で問い合わせる', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue('this');
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventChange }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    await act(async () => {
      segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush();
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(occurrence, 'move');
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });

  it('繰り返し発生の Shift+ArrowRight リサイズは resolveRecurringScope に action: "resize" で問い合わせる', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '朝会',
      start: '2026-07-08T09:00',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue('this');
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventChange }}
        resultRef={resultRef}
      />,
    );

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    await act(async () => {
      segment.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
      await flush();
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(occurrence, 'resize');
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });
});

describe('useDayDrag - 日セルのキーボード作成', () => {
  it('Enter でその日 1 日分の範囲について onSelectRange が呼ばれる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );

    const cell709 = container.querySelector('[data-testid="cell-2026-07-09"]');
    if (!(cell709 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell709.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.allDay).toBe(true);
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-09', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-10', TOKYO).getTime());
  });

  it('Space キーでも同様に範囲選択される', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const onSelectRange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} callbacks={{ onSelectRange }} resultRef={resultRef} />,
    );

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    const selection = onSelectRange.mock.calls[0]?.[0];
    expect(selection?.range.start.getTime()).toBe(dateFromKey('2026-07-08', TOKYO).getTime());
    expect(selection?.range.end.getTime()).toBe(dateFromKey('2026-07-09', TOKYO).getTime());
  });

  it('コールバック省略時は Enter で allDay イベントが既定タイトルで即時作成される', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(<TestGrid api={api} resultRef={resultRef} />);

    const cell708 = container.querySelector('[data-testid="cell-2026-07-08"]');
    if (!(cell708 instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }

    act(() => {
      cell708.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const events = api.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('(タイトルなし)');
    expect(events[0]?.allDay).toBe(true);
  });
});

describe('useDayDrag - 時間グリッドへの変換ドラッグ', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('終日イベントを時間グリッドの日列上で離すと、スナップされた時刻＋defaultEventMinutes の時間指定イベント（allDay: false）に変換される', () => {
    const api = makeCalendarApi({
      timeZone: TOKYO,
      now: () => NOW,
      initialDate: NOW,
      snapMinutes: 15,
      defaultEventMinutes: 30,
    });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const timeGridDay = makeTimeGridDayElement('2026-07-11', { top: 0, height: 1440 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(timeGridDay);

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(2), 600); // 10:00 相当（timegrid-day のモック矩形基準）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(2), 600);
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.allDay).toBe(false);
    const start = updated?.start;
    const end = updated?.end;
    if (!(start instanceof Date) || !(end instanceof Date)) {
      throw new Error('更新後の start/end が Date ではありません');
    }
    const expectedStart = dateFromKey('2026-07-11', TOKYO).getTime() + 10 * 60 * 60 * 1000;
    expect(start.getTime()).toBe(expectedStart);
    expect(end.getTime()).toBe(expectedStart + 30 * 60 * 1000);
    expect(onEventChange).toHaveBeenCalledWith({
      occurrence,
      newRange: { start, end },
      allDay: false,
      scope: null,
    });
  });

  it('時間グリッドへの変換ドラッグ中は dragPreview.allDay が false になり、previewRange は null を返す', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid api={api} segments={[makeSegment(occurrence)]} resultRef={resultRef} />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const timeGridDay = makeTimeGridDayElement('2026-07-09', { top: 0, height: 1440 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(timeGridDay);

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(2), 540); // 9:00 相当
    });

    expect(api.getState().dragPreview?.allDay).toBe(false);
    expect(resultRef.current?.previewRange).toBeNull();

    act(() => {
      dispatchPointerUp(cellCenterX(2), 540);
    });
  });

  it('elementFromPoint が領域外（null）を返す場合は従来どおり日単位の移動として扱われる', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '出張',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(4)); // 7/10（+2日、通常の日移動）
    });
    act(() => {
      dispatchPointerUp(cellCenterX(4));
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.allDay).toBe(true);
    expectDateKey(updated?.start, '2026-07-10');
    expectDateKey(updated?.end, '2026-07-12');
    expect(onEventChange).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, scope: null }),
    );
  });

  it('繰り返し発生の時間グリッド変換では resolveRecurringScope が呼ばれ、解決したスコープで適用される', async () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '休暇',
      start: '2026-07-08',
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const occurrence = api
      .getOccurrences(WIDE_RANGE)
      .find(
        (occ) => occ.eventId === created.id && occ.originalStart.getTime() === occ.start.getTime(),
      );
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const resolveRecurringScope = vi.fn().mockResolvedValue('this');
    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ resolveRecurringScope, onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const timeGridDay = makeTimeGridDayElement('2026-07-09', { top: 0, height: 1440 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(timeGridDay);

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(2), 540);
    });
    await act(async () => {
      dispatchPointerUp(cellCenterX(2), 540);
      await flush();
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(occurrence, 'move');
    const overrides = api.getEvents().filter((event) => event.recurringEventId === created.id);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.allDay).toBe(false);
    expect(onEventChange).toHaveBeenCalledTimes(1);
    const change = onEventChange.mock.calls[0]?.[0];
    expect(change?.allDay).toBe(false);
    expect(change?.scope).toBe('this');
  });

  it('editable: false の終日発生は時間グリッド上でもドラッグが開始されない（変換も起きない）', () => {
    const api = makeCalendarApi({ timeZone: TOKYO, now: () => NOW, initialDate: NOW });
    const created = api.createEvent({
      title: '固定予定',
      start: '2026-07-08',
      end: '2026-07-10',
      allDay: true,
      editable: false,
    });
    const occurrence = api.getOccurrences(WIDE_RANGE).find((occ) => occ.eventId === created.id);
    if (occurrence === undefined) {
      throw new Error('発生が見つかりません');
    }

    const onEventChange = vi.fn();
    const resultRef: { current: DayDragHandlers | null } = { current: null };
    const { container } = render(
      <TestGrid
        api={api}
        segments={[makeSegment(occurrence)]}
        callbacks={{ onEventChange }}
        resultRef={resultRef}
      />,
    );
    setupCellRects(container);

    const segment = container.querySelector(`[data-testid="seg-${occurrence.key}"]`);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const timeGridDay = makeTimeGridDayElement('2026-07-09', { top: 0, height: 1440 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(timeGridDay);

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: cellCenterX(2),
          clientY: 25,
          button: 0,
          bubbles: true,
        }),
      );
    });
    act(() => {
      dispatchPointerMove(cellCenterX(2), 540);
    });

    expect(resultRef.current?.isDragging).toBe(false);

    act(() => {
      dispatchPointerUp(cellCenterX(2), 540);
    });

    const updated = api.getEvents().find((event) => event.id === created.id);
    expect(updated?.allDay).toBe(true);
    expect(updated?.start).toBe('2026-07-08');
    expect(onEventChange).not.toHaveBeenCalled();
  });
});
