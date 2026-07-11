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
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from '../types';
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
  businessHours?: readonly BusinessHoursRule[];
  callbacks?: CalendarInteractionCallbacks;
  viewProps?: VirtualTimelineViewProps;
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
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} {...(props.callbacks ? { callbacks: props.callbacks } : {})}>
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
