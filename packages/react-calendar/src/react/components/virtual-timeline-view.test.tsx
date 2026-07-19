/**
 * virtual-timeline-view.tsx のテスト。
 *
 * jsdom はレイアウトを持たないため、スクロールコンテナ（`timeline-body`）の
 * `clientHeight` を明示定義し、`ResizeObserver` はモックする。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createRef } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  CalendarViewType,
  TimelineItem,
  TimelineScale,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type {
  CalendarInteractionCallbacks,
  EventContentContext,
  EventContentRenderer,
  UseCalendarResult,
} from '../types';
import { useCalendar } from '../use-calendar';
import type { VirtualTimelineViewHandle, VirtualTimelineViewProps } from './virtual-timeline-view';
import { VirtualTimelineView } from './virtual-timeline-view';

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
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** N 件のリソースを作る。 */
function makeResources(count: number): CalendarResource[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    title: `リソース${i}`,
  }));
}

interface HarnessProps {
  initialView?: CalendarViewType;
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
  timelineDays?: number;
  timelineScale?: TimelineScale;
  businessHours?: readonly BusinessHoursRule[];
  callbacks?: CalendarInteractionCallbacks;
  viewProps?: VirtualTimelineViewProps;
  messages?: MessageCatalogOverrides;
  renderEventContent?: EventContentRenderer;
  sink?: { current: UseCalendarResult | null };
  handleRef?: React.Ref<VirtualTimelineViewHandle>;
}

function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'timeline',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? [],
    unassignedLane: 'auto',
    ...(props.timelineDays !== undefined ? { timelineDays: props.timelineDays } : {}),
    ...(props.timelineScale !== undefined ? { timelineScale: props.timelineScale } : {}),
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks ? { callbacks: props.callbacks } : {})}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
      {...(props.renderEventContent !== undefined
        ? { renderEventContent: props.renderEventContent }
        : {})}
    >
      <VirtualTimelineView ref={props.handleRef} {...(props.viewProps ?? {})} />
    </CalendarProvider>
  );
}

/** 描画済みコンテナに clientHeight を定義し、scroll を発火して同期させる。 */
async function setViewport(
  container: HTMLElement,
  clientHeight: number,
  scrollTop = 0,
): Promise<void> {
  const body = container.querySelector('[data-koyomi="timeline-body"]');
  if (!(body instanceof HTMLElement)) {
    throw new Error('timeline-body コンテナが見つかりません');
  }
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: clientHeight });
  await act(async () => {
    body.scrollTop = scrollTop;
    body.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('VirtualTimelineView', () => {
  it('viewModel.type が timeline 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" resources={makeResources(2)} />);
    expect(container.querySelector('[data-koyomi="timeline"]')).toBeNull();
  });

  it('仮想化コンテナと spacer・role 構造を描画する', () => {
    const { container } = render(<Harness resources={makeResources(3)} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root?.getAttribute('data-koyomi-virtualized')).toBe('true');
    expect(root?.getAttribute('role')).toBe('grid');
    // トラック幅計算が参照する表示日数の CSS 変数（TimelineView と同じ。既定 timelineDays = 1）
    expect(root?.getAttribute('style')).toContain('--koyomi-timeline-days: 1');

    const spacers = container.querySelectorAll('[data-koyomi="timeline-row-spacer"]');
    expect(spacers).toHaveLength(2);
    expect(spacers[0]?.getAttribute('data-edge')).toBe('before');
    expect(spacers[1]?.getAttribute('data-edge')).toBe('after');

    const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
    expect(rowGroups.length).toBeGreaterThan(0);
    for (const group of rowGroups) {
      expect(group.getAttribute('role')).toBe('row');
      expect(group.querySelector('[data-koyomi="timeline-resource-header"]')).toHaveAttribute(
        'role',
        'rowheader',
      );
      expect(group.querySelector('[data-koyomi="timeline-row"]')).toHaveAttribute(
        'role',
        'gridcell',
      );
    }
  });

  it('timeline-rows ラッパーは role="grid" の owned elements 規約に従い role="presentation" を持つ', () => {
    const { container } = render(<Harness resources={makeResources(3)} />);
    const rowsWrapper = container.querySelector('[data-koyomi="timeline-rows"]');
    expect(rowsWrapper).toHaveAttribute('role', 'presentation');
  });

  it('大量リソース時、境界高を与えると可視範囲のみ描画される', async () => {
    const { container } = render(<Harness resources={makeResources(200)} />);
    await setViewport(container, 100, 0);

    const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
    expect(rowGroups.length).toBeLessThan(200);
    expect(rowGroups.length).toBeGreaterThan(0);

    const afterSpacer = container.querySelector(
      '[data-koyomi="timeline-row-spacer"][data-edge="after"]',
    );
    const afterHeight = Number.parseFloat((afterSpacer as HTMLElement | null)?.style.height ?? '0');
    expect(afterHeight).toBeGreaterThan(0);
  });

  it('ヘッダー行の実測高（viewportPadding）がウィンドウ計算に反映される（jsdom は getBoundingClientRect が既定 0 のため、この統合経路を検証するには明示的にモックする必要がある）', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    // biome-ignore lint/suspicious/noExplicitAny: DOMRect 相当を簡易に用意するためのテスト専用モック
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): any {
      const height = this.getAttribute('data-koyomi') === 'timeline-header-row' ? 40 : 0;
      return { width: 0, height, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 };
    };
    try {
      const { container } = render(<Harness resources={makeResources(200)} />);
      await setViewport(container, 100, 0);

      // レーン高 28px・overscan 既定 3 のとき、clientHeight(100) をそのまま使うと
      // 可視 4 行 + overscan 前後で 7 行になる。ヘッダー実測高 40px を viewportPadding として
      // 差し引いた実効ビューポート 60px で計算されると、可視 3 行 + overscan で 6 行になる。
      const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
      expect(rowGroups.length).toBe(6);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it('境界高が無く全件描画になる規模では開発警告を出す', async () => {
    const { container } = render(<Harness resources={makeResources(50)} />);
    await setViewport(container, 50 * 28);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('境界高を与えて窓が絞られる場合は警告しない', async () => {
    const { container } = render(<Harness resources={makeResources(50)} />);
    await setViewport(container, 100);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('境界高（clientHeight）が全行高を上回る＝実質無い場合、全リソース行が描画される', async () => {
    // 境界高が無ければ（開発警告を出すだけでなく）全件描画へのフォールバック本体が
    // 実際に働き、全リソース行が描画されるはずである。
    const resourceCount = 40;
    const { container } = render(<Harness resources={makeResources(resourceCount)} />);
    await setViewport(container, 28 * resourceCount);

    const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
    expect(rowGroups).toHaveLength(resourceCount);
  });

  it.each([
    ['負数', -28],
    ['0', 0],
    ['NaN', Number.NaN],
  ])('estimateRowHeight に不正な値（%s）を渡しても例外を投げず、行が描画される', (_label, invalid) => {
    expect(() =>
      render(<Harness resources={makeResources(3)} viewProps={{ estimateRowHeight: invalid }} />),
    ).not.toThrow();
    const { container } = render(
      <Harness resources={makeResources(3)} viewProps={{ estimateRowHeight: invalid }} />,
    );
    expect(container.querySelectorAll('[data-koyomi="timeline-row-group"]').length).toBeGreaterThan(
      0,
    );
  });

  it('フォーカス中の行は窓外へスクロールしても pinned で残り、blur で解除される', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '作業0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(200)} events={events} />);
    await setViewport(container, 100, 0);

    const firstItem = container.querySelector('[data-koyomi="timeline-item"]');
    if (firstItem === null) {
      throw new Error('timeline-item が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstItem);
    });

    await setViewport(container, 100, 5000);
    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    expect(pinned?.getAttribute('data-koyomi-row-key')).toBe('r:r0');

    // 位置決めに必須のスタイルは inline で出力する（ヘッドレス原則）。テーマ CSS を
    // 読み込まない利用者でも、pinned 行が通常フローに割り込んで行の重複表示や
    // 高さ跳ねを起こさないよう、position: absolute を inline に持つ（VirtualResourceView と同じ）
    if (!(pinned instanceof HTMLElement)) {
      throw new Error('pinned 行が見つかりません');
    }
    expect(pinned.style.position).toBe('absolute');
    expect(pinned.style.top).not.toBe('');

    const pinnedItem = pinned?.querySelector('[data-koyomi="timeline-item"]');
    if (!(pinnedItem instanceof HTMLElement)) {
      throw new Error('pinned 行の timeline-item が見つかりません');
    }
    await act(async () => {
      fireEvent.blur(pinnedItem, { relatedTarget: document.body });
    });
    expect(container.querySelector('[data-koyomi-pinned="true"]')).toBeNull();
  });

  it('pinned 行の帯はタブ順から外れる（tabindex=-1）', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '作業0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(200)} events={events} />);
    await setViewport(container, 100, 0);
    const firstItem = container.querySelector('[data-koyomi="timeline-item"]');
    if (firstItem === null) {
      throw new Error('timeline-item が見つかりません');
    }
    // 窓内の帯は通常どおり tabIndex=0（getItemProps が既定で付与する値）
    expect(firstItem.getAttribute('tabindex')).toBe('0');

    await act(async () => {
      fireEvent.focus(firstItem);
    });
    await setViewport(container, 100, 5000);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    const pinnedItem = pinned?.querySelector('[data-koyomi="timeline-item"]');
    expect(pinnedItem?.getAttribute('tabindex')).toBe('-1');
  });

  it('scrollToResource でリソース行の scrollTop を書き換える', async () => {
    const handleRef = createRef<VirtualTimelineViewHandle>();
    const { container } = render(<Harness resources={makeResources(50)} handleRef={handleRef} />);
    await setViewport(container, 100, 0);

    act(() => {
      handleRef.current?.scrollToResource('r40', { align: 'start' });
    });

    const body = container.querySelector('[data-koyomi="timeline-body"]') as HTMLElement;
    // 40 行目 × 28px（既定レーン高 × 1 レーン）= 1120px
    expect(body.scrollTop).toBe(1120);
  });

  it('scrollToResource(null) は未割り当て行へスクロールする', async () => {
    const handleRef = createRef<VirtualTimelineViewHandle>();
    const events: CalendarEvent[] = [
      { id: 'u1', title: '未割当', start: '2026-07-15T09:00', end: '2026-07-15T10:00' },
    ];
    const { container } = render(
      <Harness resources={makeResources(3)} events={events} handleRef={handleRef} />,
    );
    await setViewport(container, 100, 0);

    act(() => {
      handleRef.current?.scrollToResource(null, { align: 'start' });
    });

    const body = container.querySelector('[data-koyomi="timeline-body"]') as HTMLElement;
    // 未割り当て行は末尾（index 3）→ 3 × 28px = 84px
    expect(body.scrollTop).toBe(84);
  });

  it('messages.common.eventAriaLabel をオーバーライドすると、resourceLabel を含む parts ごとカスタマイズできる（区切りの混在が起きない）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '作業0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const eventAriaLabel = (
      _occurrence: import('../../core/types').EventOccurrence,
      parts: { rangeLabel: string; resourceLabel?: string },
    ): string => `カスタム:${parts.rangeLabel}:${parts.resourceLabel}`;
    const { container } = render(
      <Harness
        resources={makeResources(3)}
        events={events}
        messages={{ common: { eventAriaLabel } }}
      />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item).toHaveAttribute('aria-label', 'カスタム:7月15日 9:00〜10:00:リソース0');
  });

  it('矢印キー（→）で帯を移動でき、onEventChange が呼ばれる（D&D 配線の確認）', () => {
    const onEventChange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '作業0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness resources={makeResources(3)} events={events} callbacks={{ onEventChange }} />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    if (item === null) {
      throw new Error('timeline-item が見つかりません');
    }
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });

  it('予定が無いときは timeline-empty を表示し仮想化コンテナは作らない', () => {
    const { container } = render(<Harness resources={[]} />);
    expect(container.querySelector('[data-koyomi="timeline-empty"]')?.textContent).toBe(
      'リソースがありません',
    );
    expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
  });
});

/**
 * 時間軸（横方向）の窓計算が参照する実測幅（`timeline-axis` のトラック幅・
 * `timeline-corner` の行見出し列幅）をモックする。戻り値は解除関数。
 */
function mockTimelineWidths(axisWidth: number, cornerWidth = 0): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  // biome-ignore lint/suspicious/noExplicitAny: DOMRect 相当を簡易に用意するためのテスト専用モック
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): any {
    const kind = this.getAttribute('data-koyomi');
    const width =
      kind === 'timeline-axis' ? axisWidth : kind === 'timeline-corner' ? cornerWidth : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 };
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

/** 描画済みコンテナに clientWidth を定義し、scroll を発火して横スクロールを同期させる。 */
async function setHorizontalViewport(
  container: HTMLElement,
  clientWidth: number,
  scrollLeft = 0,
): Promise<void> {
  const body = container.querySelector('[data-koyomi="timeline-body"]');
  if (!(body instanceof HTMLElement)) {
    throw new Error('timeline-body コンテナが見つかりません');
  }
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: clientWidth });
  await act(async () => {
    body.scrollLeft = scrollLeft;
    body.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('VirtualTimelineView - 時間軸（横方向）の仮想化', () => {
  /** timelineDays=5（2026-07-15〜19）。先頭日と末尾日に 1 件ずつ帯を置く。 */
  const HORIZONTAL_EVENTS: readonly CalendarEvent[] = [
    {
      id: 'e-first',
      title: '初日',
      start: '2026-07-15T09:00',
      end: '2026-07-15T10:00',
      resourceId: 'r0',
    },
    {
      id: 'e-last',
      title: '末日',
      start: '2026-07-19T09:00',
      end: '2026-07-19T10:00',
      resourceId: 'r0',
    },
  ];

  it('横の境界幅を与えると、可視の日の範囲だけ目盛り・日ヘッダー・帯が描画される', async () => {
    // トラック幅 3600px（720px × 5 日）・ビューポート 720px → 可視は初日のみ、
    // 前後 overscan 1 日（既定）で 2 日分が窓に入る
    const restore = mockTimelineWidths(3600);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
      );
      await setHorizontalViewport(container, 720, 0);

      // 日ヘッダー: 5 日中 2 日のみ
      const dayHeaders = container.querySelectorAll('[data-koyomi="timeline-day-header"]');
      expect(dayHeaders).toHaveLength(2);
      expect(dayHeaders[0]?.textContent).toContain('15');
      // 時刻目盛り: 全 5 日 × 24 件（1 時間刻み）中、窓内 2 日分の 48 件のみ
      expect(container.querySelectorAll('[data-koyomi="timeline-slot-label"]')).toHaveLength(48);
      // 帯: 初日の帯のみ描画され、末日（窓外）の帯は DOM から外れる
      expect(container.querySelector('[data-koyomi-occurrence^="e-first@"]')).not.toBeNull();
      expect(container.querySelector('[data-koyomi-occurrence^="e-last@"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('窓の後方に日が残る場合、日ヘッダーの後スペーサが残りの日数分の % 幅を持つ', async () => {
    const restore = mockTimelineWidths(3600);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
      );
      await setHorizontalViewport(container, 720, 0);

      // 窓は先頭 2 日 → 前スペーサなし・後スペーサ 3 日分（3/5 = 60%）
      expect(
        container.querySelector('[data-koyomi="timeline-header-spacer"][data-edge="before"]'),
      ).toBeNull();
      const after = container.querySelector(
        '[data-koyomi="timeline-header-spacer"][data-edge="after"]',
      );
      expect(after).toHaveAttribute('aria-hidden', 'true');
      expect((after as HTMLElement).style.flexBasis).toBe('60%');
    } finally {
      restore();
    }
  });

  it('横スクロールで窓が追従し、末尾の日が現れて先頭の日が窓の外へ出る', async () => {
    const restore = mockTimelineWidths(3600);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
      );
      // 末尾（day4 の先頭 = 2880px）までスクロール → 窓は day3..day4
      await setHorizontalViewport(container, 720, 2880);

      const dayHeaders = container.querySelectorAll('[data-koyomi="timeline-day-header"]');
      expect(dayHeaders).toHaveLength(2);
      expect(dayHeaders[dayHeaders.length - 1]?.textContent).toContain('19');
      expect(container.querySelector('[data-koyomi-occurrence^="e-last@"]')).not.toBeNull();
      expect(container.querySelector('[data-koyomi-occurrence^="e-first@"]')).toBeNull();

      // 前スペーサ 3 日分（60%）・後スペーサなし
      const before = container.querySelector(
        '[data-koyomi="timeline-header-spacer"][data-edge="before"]',
      );
      expect((before as HTMLElement).style.flexBasis).toBe('60%');
      expect(
        container.querySelector('[data-koyomi="timeline-header-spacer"][data-edge="after"]'),
      ).toBeNull();
    } finally {
      restore();
    }
  });

  it('行見出し列（timeline-corner）の実測幅が横の実効ビューポートから差し引かれる', async () => {
    // corner 幅 720px を差し引くと実効ビューポートは 720px になり、
    // corner 幅 0・ビューポート 720px の場合と同じ 2 日窓になる
    const restore = mockTimelineWidths(3600, 720);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
      );
      await setHorizontalViewport(container, 1440, 0);

      expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('overscanDays で横 overscan の日数を変えられる', async () => {
    const restore = mockTimelineWidths(3600);
    try {
      const { container } = render(
        <Harness
          resources={makeResources(2)}
          timelineDays={5}
          events={HORIZONTAL_EVENTS}
          viewProps={{ overscanDays: 0 }}
        />,
      );
      await setHorizontalViewport(container, 720, 0);

      expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('トラック幅の実測が無い（幅 0）ときは全日を描画へフォールバックする', async () => {
    const { container } = render(
      <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
    );
    await setHorizontalViewport(container, 720, 0);

    expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-koyomi="timeline-slot-label"]')).toHaveLength(120);
    expect(container.querySelector('[data-koyomi-occurrence^="e-first@"]')).not.toBeNull();
    expect(container.querySelector('[data-koyomi-occurrence^="e-last@"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-koyomi="timeline-header-spacer"]')).toHaveLength(0);
  });

  it('フォーカス中の帯は横窓外へスクロールしても DOM に残り、blur で解除される', async () => {
    const restore = mockTimelineWidths(3600);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={5} events={HORIZONTAL_EVENTS} />,
      );
      await setHorizontalViewport(container, 720, 0);

      const firstItem = container.querySelector('[data-koyomi-occurrence^="e-first@"]');
      if (firstItem === null) {
        throw new Error('初日の帯が見つかりません');
      }
      await act(async () => {
        fireEvent.focus(firstItem);
      });

      // 末尾へスクロールしても、フォーカス中の帯は横窓の外でも描画され続ける
      await setHorizontalViewport(container, 720, 2880);
      const kept = container.querySelector('[data-koyomi-occurrence^="e-first@"]');
      expect(kept).not.toBeNull();

      await act(async () => {
        fireEvent.blur(kept as HTMLElement, { relatedTarget: document.body });
      });
      expect(container.querySelector('[data-koyomi-occurrence^="e-first@"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('week スケールではグループ見出しも横 windowing され、窓外のグループ分は % 幅スペーサになる', async () => {
    // timelineDays=84・週スケール → トラック幅 84 × 96px = 8064px
    const restore = mockTimelineWidths(8064);
    try {
      const { container } = render(
        <Harness resources={makeResources(2)} timelineDays={84} timelineScale="week" />,
      );
      // ビューポート 960px → 可視 10 日 ＋ overscan 前後 1 日
      await setHorizontalViewport(container, 960, 0);

      const groups = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
      expect(groups.length).toBeGreaterThan(0);
      // 84 日 ＝ 13 週前後のうち、可視 11 日に重なる 2〜3 グループのみ
      expect(groups.length).toBeLessThan(5);
      const after = container.querySelector(
        '[data-koyomi="timeline-header-spacer"][data-edge="after"]',
      );
      expect(after).not.toBeNull();
    } finally {
      restore();
    }
  });
});

describe('VirtualTimelineView - onVisibleRangeChange（可視範囲の変更通知）', () => {
  it('マウント後に現在の可視範囲（行・日・日付範囲・リソース）が通知される', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <Harness
        resources={makeResources(5)}
        timelineDays={5}
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    await setViewport(container, 1000, 0);

    expect(onVisibleRangeChange).toHaveBeenCalled();
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    // 行: 境界高 1000px に全 5 行（各 28px）が収まる
    expect(info.rows).toEqual({ startIndex: 0, endIndex: 4, startKey: 'r:r0', endKey: 'r:r4' });
    // 日: 横の境界幅が無いため全 5 日が可視扱い
    expect(info.days).toEqual({
      startIndex: 0,
      endIndex: 4,
      startKey: '2026-07-15',
      endKey: '2026-07-19',
    });
    // 日付範囲: 表示タイムゾーン（Asia/Tokyo）の日境界。end は排他（7/20 の 0:00）
    expect(info.rangeStart.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    expect(info.rangeEnd.toISOString()).toBe('2026-07-19T15:00:00.000Z');
    // リソース: 可視行の順に並ぶ
    expect(info.resources.map((r: CalendarResource | null) => r?.id ?? null)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4',
    ]);
  });

  it('縦スクロールで可視行が変わると通知され、同じ範囲では再通知されない', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <Harness resources={makeResources(200)} viewProps={{ onVisibleRangeChange }} />,
    );
    await setViewport(container, 100, 0);
    const callsAtTop = onVisibleRangeChange.mock.calls.length;

    // 100 行分（100 × 28px = 2800px）スクロール → 可視行 100〜103
    await setViewport(container, 100, 2800);
    expect(onVisibleRangeChange.mock.calls.length).toBeGreaterThan(callsAtTop);
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    expect(info.rows.startIndex).toBe(100);
    expect(info.rows.startKey).toBe('r:r100');
    expect(info.resources[0]?.id).toBe('r100');

    // 同じスクロール位置の scroll イベントでは再通知しない
    const callsAfterScroll = onVisibleRangeChange.mock.calls.length;
    await setViewport(container, 100, 2800);
    expect(onVisibleRangeChange.mock.calls.length).toBe(callsAfterScroll);
  });

  it('横スクロールで可視日が変わると days と日付範囲が更新される', async () => {
    const restore = mockTimelineWidths(3600);
    try {
      const onVisibleRangeChange = vi.fn();
      const { container } = render(
        <Harness
          resources={makeResources(2)}
          timelineDays={5}
          viewProps={{ onVisibleRangeChange }}
        />,
      );
      // 末尾（day4 の先頭 = 2880px）まで横スクロール → 可視日は 7/19 のみ
      await setHorizontalViewport(container, 720, 2880);

      const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
      expect(info.days).toEqual({
        startIndex: 4,
        endIndex: 4,
        startKey: '2026-07-19',
        endKey: '2026-07-19',
      });
      expect(info.rangeStart.toISOString()).toBe('2026-07-18T15:00:00.000Z');
      expect(info.rangeEnd.toISOString()).toBe('2026-07-19T15:00:00.000Z');
    } finally {
      restore();
    }
  });

  it('viewModel が timeline 以外のときは通知しない', () => {
    const onVisibleRangeChange = vi.fn();
    render(
      <Harness
        initialView="month"
        resources={makeResources(3)}
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    expect(onVisibleRangeChange).not.toHaveBeenCalled();
  });
});

describe('VirtualTimelineView - timelineScale（ズーム粒度）', () => {
  it("既定（省略時）は data-koyomi-scale='hour' で、日ヘッダー DOM は TimelineView と同一", () => {
    const { container } = render(<Harness resources={makeResources(2)} timelineDays={3} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'hour');
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).not.toBeNull();
    expect(container.querySelector('[data-koyomi="timeline-group-headers"]')).toBeNull();
  });

  it('week スケールでは日ヘッダーの代わりに週グループ見出しが出る', () => {
    const { container } = render(
      <Harness resources={makeResources(2)} timelineDays={10} timelineScale="week" />,
    );
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'week');
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-koyomi="timeline-group-header"]').length,
    ).toBeGreaterThan(0);
  });

  it('messages.common.rangeSeparator を部分上書きすると週グループ見出しの区切り記号が反映される（〜のハードコードを使わない）', () => {
    // NOW=2026-07-15(水) から 10 日間、weekStartsOn 既定（0=日曜始まり）
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        timelineDays={10}
        timelineScale="week"
        messages={{ common: { rangeSeparator: ' – ' } }}
      />,
    );
    const groupHeaders = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
    expect(Array.from(groupHeaders).map((el) => el.textContent)).toEqual([
      '7月15日 – 7月18日',
      '7月19日 – 7月24日',
    ]);
  });

  it('空状態でも data-koyomi-scale は常に出力される', () => {
    const { container } = render(<Harness resources={[]} timelineScale="month" />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'month');
  });
});

describe('VirtualTimelineView - ドラッグプレビュー', () => {
  it('setDragPreview 後、対象行にのみ timeline-preview が出現する', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={makeResources(2)} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'resize',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'r0',
      });
    });

    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    expect(rows[0]?.querySelector('[data-koyomi="timeline-preview"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();
  });

  it('dragPreview.invalid: true のとき timeline-preview に data-koyomi-invalid="true" が付与される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={makeResources(1)} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'r0',
        invalid: true,
      });
    });

    const preview = container.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).toHaveAttribute('data-koyomi-invalid', 'true');
  });

  it('dragPreview.invalid 省略時は timeline-preview に data-koyomi-invalid 属性が付かない', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={makeResources(1)} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'r0',
      });
    });

    const preview = container.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute('data-koyomi-invalid');
  });
});

describe('VirtualTimelineView - businessHours（営業時間）', () => {
  it('省略時（既定 []）は timeline-business-hours 要素が描画されない', () => {
    const { container } = render(<Harness resources={makeResources(2)} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-business-hours"]')).toHaveLength(0);
  });

  it('指定した時間帯が insetInlineStart/width % の帯として可視行に描画される（2026-07-15 は水曜）', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
    ];
    const { container } = render(
      <Harness resources={makeResources(2)} businessHours={businessHours} />,
    );
    const bands = container.querySelectorAll('[data-koyomi="timeline-business-hours"]');
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      expect(band).toHaveAttribute('aria-hidden', 'true');
      const style = (band as HTMLElement).style;
      // 09:00 = 540 分 / 1440 分 = 37.5%、幅 = (18:00 - 09:00) = 540 分 / 1440 分 = 37.5%
      expect(style.insetInlineStart).toBe('37.5%');
      expect(style.width).toBe('37.5%');
    }
  });
});

describe('VirtualTimelineView - リソースの階層グルーピング（parentId）', () => {
  const PARENT: CalendarResource = { id: 'parent', title: '本社' };
  const CHILD: CalendarResource = { id: 'child', title: '1F会議室', parentId: 'parent' };

  it('parentId 未使用時は timeline-row-toggle が 1 つも描画されない（既存挙動の回帰確認）', () => {
    const { container } = render(<Harness resources={makeResources(2)} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-row-toggle"]')).toHaveLength(0);
  });

  it('hasChildren な行にのみ timeline-row-toggle が描画され、aria-expanded が collapsed と整合する', () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers).toHaveLength(2);
    expect(headers[0]?.querySelector('[data-koyomi="timeline-row-toggle"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(headers[1]?.querySelector('[data-koyomi="timeline-row-toggle"]')).toBeNull();
  });

  it('timeline-resource-header に data-koyomi-depth 属性が付き、深さに応じた値になる', () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers[0]).toHaveAttribute('data-koyomi-depth', '0');
    expect(headers[1]).toHaveAttribute('data-koyomi-depth', '1');
  });

  it('トグルボタンをクリックすると子孫行が非表示になり、可視行数が再計算される', async () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-row-group"]')).toHaveLength(2);
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(toggle).not.toBeNull();

    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });

    expect(container.querySelectorAll('[data-koyomi="timeline-row-group"]')).toHaveLength(1);
  });

  it('messages.timeline.resourceToggleAriaLabel をオーバーライドすると aria-label をカスタマイズできる', () => {
    const { container } = render(
      <Harness
        resources={[PARENT, CHILD]}
        messages={{
          timeline: {
            resourceToggleAriaLabel: (resource, collapsed) => `${resource.title}/${collapsed}`,
          },
        }}
      />,
    );
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(toggle).toHaveAttribute('aria-label', '本社/false');
  });

  it('pinned 行のトグルボタンはタブ順から外れる（tabindex=-1）', async () => {
    // 既存の pinned テスト（'pinned 行の帯はタブ順から外れる'）と同じ手法:
    // 先頭行（PARENT）にフォーカスしてから窓外へスクロールし pinned 化させる
    const resources = [PARENT, CHILD, ...makeResources(200)];
    const { container } = render(<Harness resources={resources} />);
    await setViewport(container, 100, 0);
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('トグルボタンが見つかりません');
    }
    await act(async () => {
      fireEvent.focus(toggle);
    });
    await setViewport(container, 100, 5000);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    expect(pinned?.getAttribute('data-koyomi-row-key')).toBe('r:parent');
    const pinnedToggle = pinned?.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(pinnedToggle?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('VirtualTimelineView - カスタム描画 props', () => {
  const CRANE: CalendarResource = { id: 'crane-1', title: 'クレーン1' };
  const EVENTS: readonly CalendarEvent[] = [
    {
      id: 'e1',
      title: '荷揚げ',
      start: '2026-07-15T09:00',
      end: '2026-07-15T11:00',
      resourceId: 'crane-1',
    },
  ];

  it('renderEvent で帯の内容を差し替えられ、parts.timeText に整形済み時刻範囲が渡る', () => {
    const renderEvent = (item: TimelineItem, ctx: EventContentContext): ReactElement => (
      <span data-testid="custom-item">
        {ctx.slot}|{ctx.view}|{ctx.parts.timeText}|{item.occurrence.event.title}
      </span>
    );
    const { container } = render(
      <Harness resources={[CRANE]} events={EVENTS} viewProps={{ renderEvent }} />,
    );
    expect(container.querySelector('[data-testid="custom-item"]')?.textContent).toBe(
      'timeline-item|timeline|9:00〜11:00|荷揚げ',
    );
  });

  it('CalendarProvider の renderEventContent が帯に適用され、境界（ボタン・aria-label・リサイズハンドル）は保たれる', () => {
    const { container } = render(
      <Harness
        resources={[CRANE]}
        events={EVENTS}
        renderEventContent={(occurrence, ctx) => (
          <>
            {ctx.defaultContent}
            <span data-testid="badge">{occurrence.isRecurring ? '定期' : '単発'}</span>
          </>
        )}
      />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item?.tagName).toBe('BUTTON');
    expect(item?.querySelector('[data-testid="badge"]')?.textContent).toBe('単発');
    expect(item).toHaveAttribute('aria-label', '荷揚げ、7月15日 9:00〜11:00、クレーン1');
    expect(item?.querySelectorAll('[data-koyomi="timeline-resize"]')).toHaveLength(2);
  });

  it('ビュー個別の renderEvent は中央 renderEventContent より優先される', () => {
    const renderEvent = (_item: TimelineItem, _ctx: EventContentContext): ReactElement => (
      <span data-testid="individual">個別</span>
    );
    const { container } = render(
      <Harness
        resources={[CRANE]}
        events={EVENTS}
        viewProps={{ renderEvent }}
        renderEventContent={() => <span data-testid="central">中央</span>}
      />,
    );
    expect(container.querySelector('[data-testid="individual"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="central"]')).toBeNull();
  });
});
