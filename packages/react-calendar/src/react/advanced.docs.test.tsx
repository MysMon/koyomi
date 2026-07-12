/**
 * @packageDocumentation
 * 仕様由来テスト（advanced-react ドメイン）。
 *
 * このファイルは次の 4 節の記述のみから導出した期待値でテストを書いており、
 * 実装ファイル（*.test.* 以外）は一切参照していない。
 *
 * - `docs/views.md` の「リストの仮想化（大量の予定・長期間）」「レーンの仮想化
 *   （リソース・タイムラインビュー）」節
 * - `docs/interactions.md` の「外部ドラッグ受け入れ（カレンダー外からのドラッグ）」節
 * - `docs/theming.md` の「英語ロケール（既定文言の英語化）」節
 * - `docs/api.md` の `useExternalDrag` / `useVirtualizer` / `VirtualListView` /
 *   `VirtualResourceView` / `VirtualTimelineView` / `enUsLabels` の該当節
 *
 * 各 `it` の先頭コメントに出典（ファイル名・見出し・該当記述の要約）を付す。
 * 既存テスト（`virtual-list-view.test.tsx` 等）で既にカバーされている観点
 * （境界寸法があるときの窓の絞り込み、pinned のタブ順除外、Escape/pointercancel
 * によるキャンセル、対応ビューでの日時/リソース解決など）は重複させない。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarResource } from '../core/types';
import { CalendarView } from './components/calendar-view';
import { ListView } from './components/list-view';
import { MonthView } from './components/month-view';
import { ResourceView } from './components/resource-view';
import { TimelineView } from './components/timeline-view';
import { VirtualListView } from './components/virtual-list-view';
import { VirtualResourceView } from './components/virtual-resource-view';
import { VirtualTimelineView } from './components/virtual-timeline-view';
import { YearView } from './components/year-view';
import { CalendarProvider } from './context';
import { enUsLabels } from './locales/en-us';
import type { UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import type { ExternalDragHandlers, ExternalDropInfo } from './use-external-drag';
import { useExternalDrag } from './use-external-drag';

/** 表示タイムゾーン。全テスト共通。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
const EMPTY_EVENTS: readonly CalendarEvent[] = [];
const EMPTY_RESOURCES: readonly CalendarResource[] = [];

// ResizeObserver は jsdom に無いため、仮想化 3 ビュー共通で no-op モックを用意する。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});
// 仮想化 3 ビューの開発警告（境界寸法なし等）を抑制するだけで、内容は検証しない
// （警告の有無自体は既存テストで検証済みのため、ここでは stderr 出力の抑制のみ）。
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 連続する日に 1 件ずつ予定を持つイベント列を作る（月跨ぎに対応するよう UTC 正午基準）。 */
function makeDailyEvents(dayCount: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (let day = 0; day < dayCount; day += 1) {
    const base = new Date(Date.UTC(2026, 6, 16 + day, 12, 0, 0));
    const iso = base.toISOString().slice(0, 10);
    events.push({
      id: `e${day}`,
      title: `予定${day}`,
      start: `${iso}T10:00:00`,
      end: `${iso}T11:00:00`,
    });
  }
  return events;
}

function makeResources(count: number): CalendarResource[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, title: `リソース${i}` }));
}

// ============================================================================
// 仮想化 3 ビュー: 境界寸法が無い場合の無害フォールバック
//
// 出典: docs/views.md「リストの仮想化」399 行目付近
//   「境界高が無いと仮想化は無害に無効化されます（開発ビルドで一度警告します）」
// 出典: docs/views.md「レーンの仮想化」435 行目付近
//   「どちらも境界寸法は CSS で指定します。(中略) 境界寸法が無い環境では仮想化は
//    無害に無効化され、全件描画へフォールバックします（開発ビルドで一度警告します）」
//
// 既存テスト（virtual-*-view.test.tsx）は「境界寸法が無い規模で開発警告を出す」
// ことは検証済みだが、「実際に全件が描画される（フォールバック本体）」ことまでは
// 検証していない（警告の有無のみを assert している）。ここではその欠落を補う。
// ============================================================================

describe('仮想化 3 ビュー: 境界寸法なしでの全件描画フォールバック', () => {
  function ListHarness(props: {
    events: readonly CalendarEvent[];
    listDays: number;
  }): ReactElement {
    const calendar = useCalendar({
      timeZone: TOKYO,
      now: () => NOW,
      initialDate: NOW,
      initialView: 'list',
      events: props.events,
      listDays: props.listDays,
    });
    return (
      <CalendarProvider value={calendar}>
        <VirtualListView estimateDayHeight={50} />
      </CalendarProvider>
    );
  }

  it('VirtualListView: 境界高（clientHeight）が全内容を上回る＝実質無い場合、全日セクションが描画される', async () => {
    // ListView は「予定がある日だけ」をセクション化する（views.md「リストビュー」節）
    // ため、ここでは連続 50 日すべてに 1 件ずつ予定を置き、window（±listDays＝120 日分）
    // の中に収まるようにする。境界高が無ければ、この 50 日分すべてがセクションとして
    // 描画されるはずである。
    const dayCount = 50;
    const { container } = render(<ListHarness events={makeDailyEvents(dayCount)} listDays={60} />);
    const list = container.querySelector('[data-koyomi="list"]');
    if (!(list instanceof HTMLElement)) throw new Error('list コンテナが見つかりません');
    // 全日セクション分の高さ以上の clientHeight を与え、「境界高が無い（内容全高に
    // 伸びた）」状態を模擬する（既存テストの開発警告アサーションと同じ手法）。
    await act(async () => {
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 50 * dayCount });
      list.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections).toHaveLength(dayCount);
  });

  it('VirtualResourceView: 境界幅（clientWidth）が全列幅を上回る＝実質無い場合、全リソース列が描画される', async () => {
    const resourceCount = 40;
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'resource',
        events: EMPTY_EVENTS,
        resources: makeResources(resourceCount),
        unassignedLane: 'auto',
      });
      return (
        <CalendarProvider value={calendar}>
          <VirtualResourceView />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const root = container.querySelector('[data-koyomi="resource"]');
    if (!(root instanceof HTMLElement)) throw new Error('resource ルートが見つかりません');
    await act(async () => {
      Object.defineProperty(root, 'clientWidth', {
        configurable: true,
        value: 160 * resourceCount,
      });
      root.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns).toHaveLength(resourceCount);
  });

  it('VirtualTimelineView: 境界高（clientHeight）が全行高を上回る＝実質無い場合、全リソース行が描画される', async () => {
    const resourceCount = 40;
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'timeline',
        events: EMPTY_EVENTS,
        resources: makeResources(resourceCount),
        unassignedLane: 'auto',
      });
      return (
        <CalendarProvider value={calendar}>
          <VirtualTimelineView />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const body = container.querySelector('[data-koyomi="timeline-body"]');
    if (!(body instanceof HTMLElement)) throw new Error('timeline-body が見つかりません');
    await act(async () => {
      Object.defineProperty(body, 'clientHeight', {
        configurable: true,
        value: 28 * resourceCount,
      });
      body.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
    expect(rowGroups).toHaveLength(resourceCount);
  });
});

// ============================================================================
// useExternalDrag: 対応ビュー/非対応ビューの区別・containerRef スコープ・onError
//
// 出典: docs/interactions.md「外部ドラッグ受け入れ」559 行目
//   「リスト・年・複数月ビューには対応しません（ドロップ先が解決できずキャンセル
//    扱いになります）。」
// 出典: docs/api.md `useExternalDrag` 378 行目
//   「`current` が `null` の間（マウント前など）はキャンセル扱いになります。」
// 出典: docs/interactions.md「外部ドラッグ受け入れ」618 行目
//   「`onError` を渡すと、`onExternalDrop` が投げた例外をハンドリングできます
//    （省略時は `console.error` に出力）」
// ============================================================================

interface Payload {
  title: string;
}

if (typeof document.elementsFromPoint !== 'function') {
  document.elementsFromPoint = () => [];
}

function mockElementsFromPoint(elements: readonly Element[]): void {
  vi.spyOn(document, 'elementsFromPoint').mockReturnValue([...elements]);
}

function firePointerDown(element: Element, clientX = 0, clientY = 0): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', { clientX, clientY, button: 0, bubbles: true }),
    );
  });
}
function movePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
  });
}
function releasePointer(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, bubbles: true }));
  });
}

describe('useExternalDrag: 非対応ビューでのドロップはキャンセル扱い', () => {
  interface UnsupportedHarnessProps {
    view: 'list' | 'year';
    onExternalDrop: (info: ExternalDropInfo<Payload>) => void;
  }

  function UnsupportedHarness(props: UnsupportedHarnessProps): ReactElement {
    const calendar = useCalendar({
      timeZone: TOKYO,
      now: () => NOW,
      initialDate: NOW,
      initialView: props.view,
      events: makeDailyEvents(5),
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

describe('useExternalDrag: containerRef.current が null の間はキャンセル扱い', () => {
  it('マウント前相当（ref を実際の要素に接続していない）状態でドロップしても onExternalDrop は呼ばれない', () => {
    const onExternalDrop = vi.fn();
    const dragSink: { current: ExternalDragHandlers<Payload> | null } = { current: null };

    function Harness(): ReactElement {
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
      dragSink.current = drag;
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

    const { container } = render(<Harness />);
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

describe('useExternalDrag: onError', () => {
  interface OnErrorHarnessProps {
    onExternalDrop: (info: ExternalDropInfo<Payload>) => void;
    onError?: (error: unknown) => void;
    calendarSink?: { current: UseCalendarResult | null };
  }

  function OnErrorHarness(props: OnErrorHarnessProps): ReactElement {
    const calendar = useCalendar({
      timeZone: TOKYO,
      now: () => NOW,
      initialDate: NOW,
      initialView: 'month',
      events: EMPTY_EVENTS,
      resources: EMPTY_RESOURCES,
    });
    if (props.calendarSink) props.calendarSink.current = calendar;
    const containerRef = useRef<HTMLDivElement>(null);
    const drag = useExternalDrag<Payload>({
      calendar,
      containerRef,
      onExternalDrop: props.onExternalDrop,
      ...(props.onError !== undefined ? { onError: props.onError } : {}),
    });
    return (
      <div>
        <div data-testid="external-source" {...drag.getDraggableProps({ title: '外部の予定' })} />
        <div ref={containerRef}>
          <CalendarProvider value={calendar}>
            <MonthView />
          </CalendarProvider>
        </div>
      </div>
    );
  }

  it('onExternalDrop が投げた例外は onError に渡され、外へは漏れない', () => {
    const thrown = new Error('作成に失敗');
    const onExternalDrop = vi.fn(() => {
      throw thrown;
    });
    const onError = vi.fn();
    const { container } = render(
      <OnErrorHarness onExternalDrop={onExternalDrop} onError={onError} />,
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
    const { container } = render(<OnErrorHarness onExternalDrop={onExternalDrop} />);
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

// ============================================================================
// enUsLabels: 各グループが対応コンポーネントにスプレッドできる／既定は日本語のまま
//
// 出典: docs/theming.md「英語ロケール」401 行目
//   「これらをまとめて英語に差し替えるプリセット enUsLabels」
// 出典: docs/theming.md「英語ロケール」403 行目
//   「enUsLabels はコンポーネント単位のグループに分かれていて、対応する props に
//    そのままスプレッドできる」
// 出典: docs/theming.md「英語ロケール」444-450 行目（期待される動作の列挙）
//   「月/複数月ビューの「+N 件」が "+N more" になる」
//   「リソース/タイムラインビューの未割り当てラベルが "Unassigned"、空状態が
//    "No resources"、タイムラインの角セルの aria-label が "Resources" になる」
//   「年ビューの日セルの件数文言「予定N件」が "N events"（1 件なら "1 event"）になる」
// 出典: docs/theming.md「英語ロケール」453 行目
//   「enUsLabels を渡さない場合は既定の日本語文言のままです。」
// ============================================================================

describe('enUsLabels: 各グループを対応コンポーネントへスプレッド', () => {
  it('month グループを MonthView にスプレッドすると「+N 件」ボタンが "+2 more" になる', () => {
    // 3 件のうち dayMaxEvents=1 まで表示、残り 2 件を overflow として表現するため
    // 同日に複数の予定を用意する。
    const events: CalendarEvent[] = [
      { id: 'a', title: '予定A', start: '2026-07-16T09:00', end: '2026-07-16T09:30' },
      { id: 'b', title: '予定B', start: '2026-07-16T10:00', end: '2026-07-16T10:30' },
      { id: 'c', title: '予定C', start: '2026-07-16T11:00', end: '2026-07-16T11:30' },
    ];
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'month',
        events,
        dayMaxEvents: 1,
      });
      return (
        <CalendarProvider value={calendar}>
          <MonthView {...enUsLabels.month} />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const overflow = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflow?.textContent).toBe('+2 more');
  });

  it('resource グループを ResourceView にスプレッドすると、未割り当て列見出しが "Unassigned"、空状態が "No resources" になる', () => {
    function HarnessWithResource(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'resource',
        events: EMPTY_EVENTS,
        resources: makeResources(1),
        unassignedLane: 'always',
      });
      return (
        <CalendarProvider value={calendar}>
          <ResourceView {...enUsLabels.resource} />
        </CalendarProvider>
      );
    }
    const { container: withUnassigned } = render(<HarnessWithResource />);
    const headers = withUnassigned.querySelectorAll('[data-koyomi="resource-header-cell"]');
    // 1 リソース + unassignedLane: 'always' なので、最後の列見出しが未割り当て列になる。
    const unassignedHeader = headers[headers.length - 1];
    expect(unassignedHeader?.textContent).toBe('Unassigned');

    function HarnessEmpty(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'resource',
        events: EMPTY_EVENTS,
        resources: EMPTY_RESOURCES,
        unassignedLane: 'auto',
      });
      return (
        <CalendarProvider value={calendar}>
          <ResourceView {...enUsLabels.resource} />
        </CalendarProvider>
      );
    }
    const { container: empty } = render(<HarnessEmpty />);
    const emptyEl = empty.querySelector('[data-koyomi="resource-empty"]');
    expect(emptyEl?.textContent).toBe('No resources');
  });

  it('timeline グループを TimelineView にスプレッドすると、角セルの aria-label が "Resources" になる', () => {
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'timeline',
        events: EMPTY_EVENTS,
        resources: makeResources(1),
      });
      return (
        <CalendarProvider value={calendar}>
          <TimelineView {...enUsLabels.timeline} />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const corner = container.querySelector('[data-koyomi="timeline-corner"]');
    expect(corner?.getAttribute('aria-label')).toBe('Resources');
  });

  it('year グループを YearView にスプレッドすると、日セルの件数文言が "N events"（複数）/ "1 event"（単数）になる', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '予定A', start: '2026-07-10T09:00', end: '2026-07-10T09:30' },
      { id: 'b', title: '予定B', start: '2026-07-10T10:00', end: '2026-07-10T10:30' },
      { id: 'c', title: '予定C', start: '2026-07-11T09:00', end: '2026-07-11T09:30' },
    ];
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'year',
        events,
      });
      return (
        <CalendarProvider value={calendar}>
          <YearView {...enUsLabels.year} />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const dayWithTwo = container.querySelector(
      '[data-koyomi="year-day"][data-koyomi-date="2026-07-10"]',
    );
    const dayWithOne = container.querySelector(
      '[data-koyomi="year-day"][data-koyomi-date="2026-07-11"]',
    );
    // 出典の記述は件数文言（「予定N件」→ "N events"/"1 event"）の変化のみを断定して
    // おり、日付部分の表記までは規定していないため、件数文言の含有のみを検証する
    // （日付部分の正確なフォーマットは仕様の対象外）。
    expect(dayWithTwo?.getAttribute('aria-label')).toContain('2 events');
    expect(dayWithOne?.getAttribute('aria-label')).toContain('1 event');
    expect(dayWithOne?.getAttribute('aria-label')).not.toContain('1 events');
  });

  it('calendarView グループを CalendarView にスプレッドすると、list ビューの空状態が "No events" になる', () => {
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'list',
        events: EMPTY_EVENTS,
      });
      return (
        <CalendarProvider value={calendar}>
          <CalendarView {...enUsLabels.calendarView} />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const empty = container.querySelector('[data-koyomi="list-empty"]');
    expect(empty?.textContent).toBe('No events');
  });

  it('enUsLabels を渡さない場合は既定の日本語文言のまま（MonthView の「+N 件」）', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '予定A', start: '2026-07-16T09:00', end: '2026-07-16T09:30' },
      { id: 'b', title: '予定B', start: '2026-07-16T10:00', end: '2026-07-16T10:30' },
    ];
    function Harness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'month',
        events,
        dayMaxEvents: 1,
      });
      return (
        <CalendarProvider value={calendar}>
          <MonthView />
        </CalendarProvider>
      );
    }
    const { container } = render(<Harness />);
    const overflow = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflow?.textContent).toBe('+1 件');
  });
});
