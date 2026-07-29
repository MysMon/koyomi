/**
 * virtual-resource-view.tsx のテスト。
 *
 * jsdom はレイアウトを持たないため、スクロールコンテナ（ルート要素）の
 * `clientWidth` を明示定義し、`ResizeObserver` はモックする。
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
  TimeZoneId,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { VirtualResourceViewHandle, VirtualResourceViewProps } from './virtual-resource-view';
import { VirtualResourceView } from './virtual-resource-view';

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

const TOKYO = 'Asia/Tokyo';
/** Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

function makeResources(count: number): CalendarResource[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, title: `リソース${i}` }));
}

interface HarnessProps {
  initialView?: CalendarViewType;
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
  callbacks?: CalendarInteractionCallbacks;
  businessHours?: readonly BusinessHoursRule[];
  slotMinTime?: string;
  slotMaxTime?: string;
  resourceViewDays?: number;
  allDayMaxEvents?: number;
  timeAxisZones?: readonly TimeZoneId[];
  viewProps?: VirtualResourceViewProps;
  messages?: MessageCatalogOverrides;
  sink?: { current: UseCalendarResult | null };
  handleRef?: React.Ref<VirtualResourceViewHandle>;
}

function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'resource',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? [],
    unassignedLane: 'auto',
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
    ...(props.slotMinTime !== undefined ? { slotMinTime: props.slotMinTime } : {}),
    ...(props.slotMaxTime !== undefined ? { slotMaxTime: props.slotMaxTime } : {}),
    ...(props.resourceViewDays !== undefined ? { resourceViewDays: props.resourceViewDays } : {}),
    ...(props.allDayMaxEvents !== undefined ? { allDayMaxEvents: props.allDayMaxEvents } : {}),
    ...(props.timeAxisZones !== undefined ? { timeAxisZones: props.timeAxisZones } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks ? { callbacks: props.callbacks } : {})}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
    >
      <VirtualResourceView ref={props.handleRef} {...(props.viewProps ?? {})} />
    </CalendarProvider>
  );
}

/** 描画済みコンテナに clientWidth を定義し、scroll を発火して同期させる。 */
async function setViewport(
  container: HTMLElement,
  clientWidth: number,
  scrollLeft = 0,
): Promise<void> {
  const root = container.querySelector('[data-koyomi="resource"]');
  if (!(root instanceof HTMLElement)) {
    throw new Error('resource ルートが見つかりません');
  }
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: clientWidth });
  await act(async () => {
    root.scrollLeft = scrollLeft;
    root.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('VirtualResourceView', () => {
  it('viewModel.type が resource 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" resources={makeResources(2)} />);
    expect(container.querySelector('[data-koyomi="resource"]')).toBeNull();
  });

  it('仮想化コンテナと role 構造を描画する', () => {
    const { container } = render(<Harness resources={makeResources(3)} />);
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root?.getAttribute('data-koyomi-virtualized')).toBe('true');
    expect(root?.getAttribute('data-koyomi-columns')).toBe('3');
    expect(root).not.toHaveAttribute('role');

    expect(container.querySelector('[data-koyomi="resource-grid"]')).toHaveAttribute(
      'role',
      'grid',
    );
    const headerCells = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    expect(headerCells.length).toBeGreaterThan(0);
    for (const cell of headerCells) {
      expect(cell.getAttribute('role')).toBe('columnheader');
    }
    const bodyColumns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(bodyColumns.length).toBe(headerCells.length);
  });

  it('列見出しに data-koyomi-depth（階層の深さ）が付く', () => {
    const resources: CalendarResource[] = [
      { id: 'site', title: '本社' },
      { id: 'floor-1', title: '1F', parentId: 'site' },
      { id: 'room-x', title: '会議室X', parentId: 'floor-1' },
    ];
    const { container } = render(<Harness resources={resources} />);
    const depths = Array.from(
      container.querySelectorAll('[data-koyomi="resource-header-cell"]'),
    ).map((element) => element.getAttribute('data-koyomi-depth'));
    expect(depths).toEqual(['0', '1', '2']);
  });

  it('parentId の変更で深さが変わると data-koyomi-depth も追従する（memo が古い値を固定しない）', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness
        resources={[
          { id: 'site', title: '本社' },
          { id: 'floor-1', title: '1F', parentId: 'site' },
        ]}
        sink={sink}
      />,
    );
    const depths = (): (string | null)[] =>
      Array.from(container.querySelectorAll('[data-koyomi="resource-header-cell"]')).map(
        (element) => element.getAttribute('data-koyomi-depth'),
      );
    expect(depths()).toEqual(['0', '1']);

    // id・title・color が同じまま parentId だけ外す（depth 1 → 0）
    act(() => {
      sink.current?.api.setResources([
        { id: 'site', title: '本社' },
        { id: 'floor-1', title: '1F' },
      ]);
    });
    expect(depths()).toEqual(['0', '0']);
  });

  it('終日イベントの aria-label は通常の ResourceView と同じ形式（イベント名＋日付＋リソース名）になる', () => {
    // 回帰テスト: 仮想化版だけ aria-label がリソース名のみになっていた
    // （スクリーンリーダーにイベント内容が読み上げられない）バグの再発防止
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(2)} events={events} />);
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent).toHaveAttribute('aria-label', '休暇、7月15日、リソース0');
  });

  it('messages.common.eventAriaLabel は既定の rangeLabel（終日・時間指定の両方）と resourceLabel を parts で受け取る', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'r0',
      },
      {
        id: 'timed',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'r0',
      },
    ];
    const eventAriaLabel = (
      _occurrence: import('../../core/types').EventOccurrence,
      parts: { rangeLabel: string; resourceLabel?: string },
    ): string => `カスタム:${parts.rangeLabel}:${parts.resourceLabel}`;
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        events={events}
        messages={{ common: { eventAriaLabel } }}
      />,
    );
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent).toHaveAttribute('aria-label', 'カスタム:7月15日:リソース0');
    const timedEvent = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(timedEvent).toHaveAttribute('aria-label', 'カスタム:7月15日 10:00〜11:00:リソース0');
  });

  it('renderAllDayItem で終日アイテムの内容をカスタマイズできる（renderEvent は影響しない）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        events={events}
        viewProps={{
          renderEvent: () => <span data-testid="timed">時間指定用</span>,
          renderAllDayItem: (occurrence) => (
            <span data-testid="custom-allday">{occurrence.event.title}★</span>
          ),
        }}
      />,
    );
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent?.querySelector('[data-testid="custom-allday"]')?.textContent).toBe('休暇★');
    expect(alldayEvent?.querySelector('[data-testid="timed"]')).toBeNull();
  });

  it('renderAllDayItem 省略時は既定どおりタイトルのみが表示される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(2)} events={events} />);
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent?.textContent).toBe('休暇');
  });

  it('大量リソース時、境界幅を与えると可視範囲のみ描画される', async () => {
    const { container } = render(<Harness resources={makeResources(200)} />);
    await setViewport(container, 200, 0);

    const bodyColumns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(bodyColumns.length).toBeLessThan(200);
    expect(bodyColumns.length).toBeGreaterThan(0);

    // ヘッダー・終日行・本文の 3 箇所とも同じ可視列数になる（列幅固定のため整合する）
    const headerCells = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const alldayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(headerCells.length).toBe(bodyColumns.length);
    expect(alldayCells.length).toBe(bodyColumns.length);

    const afterSpacer = container.querySelector(
      '[data-koyomi="resource-header-spacer"][data-edge="after"]',
    );
    const afterWidth = Number.parseFloat((afterSpacer as HTMLElement | null)?.style.width ?? '0');
    expect(afterWidth).toBeGreaterThan(0);
  });

  it('列見出し・終日・本文のスペーサはそれぞれ別の data-koyomi 値を持つ（querySelector の取り違え防止）', async () => {
    const { container } = render(<Harness resources={makeResources(200)} />);
    await setViewport(container, 200, 0);

    // 見出し行・終日行・本文それぞれの spacer が別名のため、1 つのセレクタで
    // 意図せず他の行のものを拾ってしまわない（前後 2 個ずつ、計 6 個）。
    expect(container.querySelectorAll('[data-koyomi="resource-header-spacer"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-koyomi="resource-allday-spacer"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-koyomi="resource-columns-spacer"]')).toHaveLength(2);
  });

  it('軸ガター（axis-gutter）の実測幅（viewportPadding）がウィンドウ計算に反映される（jsdom は getBoundingClientRect が既定 0 のため、この統合経路を検証するには明示的にモックする必要がある）', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    // biome-ignore lint/suspicious/noExplicitAny: DOMRect 相当を簡易に用意するためのテスト専用モック
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): any {
      const width = this.getAttribute('data-koyomi') === 'timegrid-axis-gutter' ? 40 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 };
    };
    try {
      const { container } = render(
        <Harness resources={makeResources(200)} viewProps={{ columnWidth: 28 }} />,
      );
      await setViewport(container, 100, 0);

      // 列幅 28px・overscan 既定 3 のとき、clientWidth(100) をそのまま使うと
      // 可視 4 列 + overscan 後方で 7 列になる。ガター実測幅 40px を viewportPadding として
      // 差し引いた実効ビューポート 60px で計算されると、可視 3 列 + overscan で 6 列になる。
      const bodyColumns = container.querySelectorAll('[data-koyomi="resource-column"]');
      expect(bodyColumns.length).toBe(6);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it('timeAxisZones 指定時は軸の本数ぶんガター実測幅が積算されて viewportPadding に反映される', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    // biome-ignore lint/suspicious/noExplicitAny: DOMRect 相当を簡易に用意するためのテスト専用モック
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): any {
      const width = this.getAttribute('data-koyomi') === 'timegrid-axis-gutter' ? 40 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 };
    };
    try {
      const { container } = render(
        <Harness
          resources={makeResources(200)}
          timeAxisZones={['America/New_York']}
          viewProps={{ columnWidth: 28 }}
        />,
      );
      await setViewport(container, 100, 0);

      // 主軸 + NY の 2 軸で、ガター実測幅（40px）× 2 = 80px が viewportPadding になる
      // （実測 ref は先頭の軸 1 つだけに付くため、軸数を掛けて合計する）。
      // 実効ビューポート 100-80=20px は列幅 28px 未満のため可視 1 列 + overscan 既定 3 で 4 列
      const bodyColumns = container.querySelectorAll('[data-koyomi="resource-column"]');
      expect(bodyColumns.length).toBe(4);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it('境界幅が無く全件描画になる規模では開発警告を出す', async () => {
    const { container } = render(<Harness resources={makeResources(50)} />);
    await setViewport(container, 50 * 160);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('境界幅を与えて窓が絞られる場合は警告しない', async () => {
    const { container } = render(<Harness resources={makeResources(50)} />);
    await setViewport(container, 200);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('境界幅（clientWidth）が全列幅を上回る＝実質無い場合、全リソース列が描画される', async () => {
    // 境界幅が無ければ（開発警告を出すだけでなく）全件描画へのフォールバック本体が
    // 実際に働き、全リソース列が描画されるはずである。
    const resourceCount = 40;
    const { container } = render(<Harness resources={makeResources(resourceCount)} />);
    await setViewport(container, 160 * resourceCount);

    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns).toHaveLength(resourceCount);
  });

  it.each([
    ['負数', -160],
    ['0', 0],
    ['NaN', Number.NaN],
  ])('columnWidth に不正な値（%s）を渡しても例外を投げず、列が描画される', (_label, invalid) => {
    expect(() =>
      render(<Harness resources={makeResources(3)} viewProps={{ columnWidth: invalid }} />),
    ).not.toThrow();
    const { container } = render(
      <Harness resources={makeResources(3)} viewProps={{ columnWidth: invalid }} />,
    );
    expect(container.querySelectorAll('[data-koyomi="resource-column"]').length).toBeGreaterThan(0);
  });

  it('フォーカス中の列は窓外へスクロールしても 3 箇所とも pinned で残り、blur で解除される', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(200)} events={events} />);
    await setViewport(container, 200, 0);

    const firstItem = container.querySelector('[data-koyomi="timegrid-event"]');
    if (firstItem === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstItem);
    });

    await setViewport(container, 200, 20000);

    const pinnedCells = container.querySelectorAll('[data-koyomi-pinned="true"]');
    // header-cell・allday-cell・resource-column の 3 箇所が pinned になる
    expect(pinnedCells.length).toBe(3);
    for (const cell of pinnedCells) {
      expect(cell.getAttribute('data-koyomi-column-key')).toBe('r:r0');
    }

    const pinnedColumn = container.querySelector(
      '[data-koyomi="resource-column"][data-koyomi-pinned="true"]',
    );
    const pinnedItem = pinnedColumn?.querySelector('[data-koyomi="timegrid-event"]');
    if (!(pinnedItem instanceof HTMLElement)) {
      throw new Error('pinned 列の timegrid-event が見つかりません');
    }
    await act(async () => {
      fireEvent.blur(pinnedItem, { relatedTarget: document.body });
    });
    expect(container.querySelectorAll('[data-koyomi-pinned="true"]').length).toBe(0);
  });

  it('scrollToResource でルートの scrollLeft を書き換える', async () => {
    const handleRef = createRef<VirtualResourceViewHandle>();
    const { container } = render(<Harness resources={makeResources(50)} handleRef={handleRef} />);
    await setViewport(container, 200, 0);

    act(() => {
      handleRef.current?.scrollToResource('r10', { align: 'start' });
    });

    const root = container.querySelector('[data-koyomi="resource"]') as HTMLElement;
    // 10 列目 × 160px（既定列幅） = 1600px
    expect(root.scrollLeft).toBe(1600);
  });

  it('renderColumnHeader・renderEvent で内容を差し替えられる', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        events={events}
        viewProps={{
          renderColumnHeader: (column, ctx) => (
            <span data-koyomi="custom-header">
              CUSTOM:{column.key}:{ctx.defaultContent}
            </span>
          ),
          renderEvent: (item) => (
            <span data-koyomi="custom-event">EV:{item.occurrence.event.title}</span>
          ),
        }}
      />,
    );
    expect(container.querySelector('[data-koyomi="custom-header"]')?.textContent).toBe(
      'CUSTOM:r:r0:リソース0',
    );
    expect(container.querySelector('[data-koyomi="custom-event"]')?.textContent).toBe('EV:予定0');
  });

  it('矢印キー（→）で隣の列へ移動でき、onEventChange が呼ばれる（D&D 配線の確認）', () => {
    const onEventChange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness resources={makeResources(3)} events={events} callbacks={{ onEventChange }} />,
    );
    const item = container.querySelector('[data-koyomi="timegrid-event"]');
    if (item === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(onEventChange).toHaveBeenCalledTimes(1);
    expect(onEventChange.mock.calls[0]?.[0]).toMatchObject({ resourceId: 'r1' });
  });

  it('矢印キー（↓）で時間指定イベントを移動でき、onEventChange が呼ばれる（仮想化下でもキーボード操作が既存と同水準）', () => {
    const onEventChange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness resources={makeResources(3)} events={events} callbacks={{ onEventChange }} />,
    );
    const item = container.querySelector('[data-koyomi="timegrid-event"]');
    if (item === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    fireEvent.keyDown(item, { key: 'ArrowDown' });
    expect(onEventChange).toHaveBeenCalledTimes(1);
  });

  it('可視窓が絞られた状態でも窓内の列は矢印キー（→）で隣接列へ移動できる（仮想化下での D&D 配線）', async () => {
    const onEventChange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness resources={makeResources(200)} events={events} callbacks={{ onEventChange }} />,
    );
    await setViewport(container, 200, 0);

    const item = container.querySelector('[data-koyomi="timegrid-event"]');
    if (item === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(onEventChange).toHaveBeenCalledTimes(1);
    expect(onEventChange.mock.calls[0]?.[0]).toMatchObject({ resourceId: 'r1' });
  });

  it('予定が無い(列も無い)ときは resource-empty を表示し仮想化コンテナは作らない', () => {
    const { container } = render(<Harness resources={[]} />);
    expect(container.querySelector('[data-koyomi="resource-empty"]')?.textContent).toBe(
      'リソースがありません',
    );
    expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
  });

  it('columnWidth が既定(160)と異なる値でも、テーマ CSS の min-width に負けず 3 箇所の列幅が一致する', () => {
    const { container } = render(
      <Harness resources={makeResources(2)} viewProps={{ columnWidth: 90 }} />,
    );
    const headerCell = container.querySelector('[data-koyomi="resource-header-cell"]');
    const alldayCell = container.querySelector('[data-koyomi="resource-allday-cell"]');
    const column = container.querySelector('[data-koyomi="resource-column"]');
    expect((headerCell as HTMLElement | null)?.style.minWidth).toBe('90px');
    expect((alldayCell as HTMLElement | null)?.style.minWidth).toBe('90px');
    expect((column as HTMLElement | null)?.style.minWidth).toBe('90px');
  });

  it('pinned 列の終日イベントはタブ順から外れる（tabindex=-1）', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad0',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(200)} events={events} />);
    await setViewport(container, 200, 0);

    const firstAllDayEvent = container.querySelector('[data-koyomi="allday-event"]');
    if (firstAllDayEvent === null) {
      throw new Error('allday-event が見つかりません');
    }
    // 窓内の終日イベントは通常どおりタブ順に含まれる（getAllDayItemProps 既定の tabIndex=0）
    expect(firstAllDayEvent.getAttribute('tabindex')).toBe('0');

    await act(async () => {
      fireEvent.focus(firstAllDayEvent);
    });
    await setViewport(container, 200, 20000);

    const pinnedAllDayCell = container.querySelector(
      '[data-koyomi="resource-allday-cell"][data-koyomi-pinned="true"]',
    );
    const pinnedAllDayEvent = pinnedAllDayCell?.querySelector('[data-koyomi="allday-event"]');
    if (!(pinnedAllDayEvent instanceof HTMLElement)) {
      throw new Error('pinned 列の allday-event が見つかりません');
    }
    expect(pinnedAllDayEvent.getAttribute('tabindex')).toBe('-1');
  });

  it('ドラッグプレビュー: setDragPreview 後、対象列にのみ timegrid-preview が出現する', () => {
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

    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns[0]?.querySelector('[data-koyomi="timegrid-preview"]')).not.toBeNull();
    expect(columns[1]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();
  });

  it('dragPreview.invalid: true のとき timegrid-preview に data-koyomi-invalid="true" が付与される', () => {
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

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).toHaveAttribute('data-koyomi-invalid', 'true');
  });

  it('dragPreview.invalid 省略時は timegrid-preview に data-koyomi-invalid 属性が付かない', () => {
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

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute('data-koyomi-invalid');
  });

  it('終日プレビュー対象列（data-koyomi-preview-target）にも dragPreview.invalid が data-koyomi-invalid として反映される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={makeResources(2)} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'ad1@2026-07-15T00:00:00.000Z',
        range: {
          start: new Date('2026-07-14T15:00:00Z'),
          end: new Date('2026-07-15T15:00:00Z'),
        },
        allDay: true,
        resourceId: 'r1',
        invalid: true,
      });
    });

    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(allDayCells[0]).not.toHaveAttribute('data-koyomi-invalid');
    expect(allDayCells[1]).toHaveAttribute('data-koyomi-invalid', 'true');
  });
});

describe('VirtualResourceView - businessHours（営業時間）', () => {
  it('省略時（既定 []）は data-koyomi-business-hours 属性が付かない', () => {
    const { container } = render(<Harness resources={makeResources(2)} />);
    expect(container.querySelectorAll('[data-koyomi-business-hours]')).toHaveLength(0);
  });

  it('businessHours 省略時も timegrid-slot 罫線は常時描画される（非仮想化の ResourceView と同一の DOM）', () => {
    // 以前は businessHours 指定時のみ罫線を描画していたが、「営業時間を付けたら
    // 罫線まで増える」という非仮想版との視覚的な非対称を解消し、常時描画に統一した
    const { container } = render(<Harness resources={makeResources(2)} />);
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      // slotMinutes 既定 60 分 → 24 本
      expect(column.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(24);
    }
    // 属性は businessHours 指定時のみ（既定では 1 つも付かない）
    expect(container.querySelectorAll('[data-koyomi-business-hours]')).toHaveLength(0);
  });

  it('指定した時間帯のスロットにのみ data-koyomi-business-hours 属性が付き、可視列全てに共通で反映される（2026-07-15 は水曜）', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    ];
    const { container } = render(
      <Harness resources={makeResources(2)} businessHours={businessHours} />,
    );
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      const slots = column.querySelectorAll('[data-koyomi="timegrid-slot"]');
      // slotMinutes 既定 60 分: インデックス 9 = 9:00、17 = 17:00
      expect(slots[9]).toHaveAttribute('data-koyomi-business-hours', 'true');
      expect(slots[17]).not.toHaveAttribute('data-koyomi-business-hours');
      expect(slots[8]).not.toHaveAttribute('data-koyomi-business-hours');
    }
  });
});

describe('VirtualResourceView - 複数タイムゾーン軸（timeAxisZones）', () => {
  it('timeAxisZones 未指定時は時間軸の列が 1 つだけ描画される（互換維持）', () => {
    const { container } = render(<Harness resources={makeResources(2)} />);
    expect(container.querySelectorAll('[data-koyomi="time-axis"]')).toHaveLength(1);
    // ヘッダー行 + 終日行の 2 箇所にガター列が 1 つずつ
    expect(container.querySelectorAll('[data-koyomi="timegrid-axis-gutter"]')).toHaveLength(2);
  });

  it('timeAxisZones を指定すると追加の時間軸列が描画され、data-koyomi-timezone で識別できる', () => {
    const { container } = render(
      <Harness resources={makeResources(2)} timeAxisZones={['America/New_York']} />,
    );
    const axes = container.querySelectorAll('[data-koyomi="time-axis"]');
    expect(axes).toHaveLength(2);
    expect(axes[0]).toHaveAttribute('data-koyomi-timezone', TOKYO);
    expect(axes[1]).toHaveAttribute('data-koyomi-timezone', 'America/New_York');
    expect(container.querySelectorAll('[data-koyomi="timegrid-axis-gutter"]')).toHaveLength(4);
  });

  it('ヘッダーのガター列に各軸のタイムゾーンラベル（GMT オフセット）が表示され、終日行のガターには出ない', () => {
    const { container } = render(
      <Harness resources={makeResources(2)} timeAxisZones={['America/New_York']} />,
    );
    const header = container.querySelector('[data-koyomi="resource-header"]');
    const labels = header?.querySelectorAll('[data-koyomi="time-axis-label"]');
    expect(labels).toHaveLength(2);
    expect(labels?.[0]?.textContent).toBe('GMT+9');
    // NOW（2026-07-15）は夏時間中のため NY は GMT-4
    expect(labels?.[1]?.textContent).toBe('GMT-4');
    const alldayRow = container.querySelector('[data-koyomi="allday-row"]');
    expect(alldayRow?.querySelector('[data-koyomi="time-axis-label"]')).toBeNull();
  });
});

describe('VirtualResourceView - 複数日表示（resourceViewDays）', () => {
  it('resourceViewDays: 2 で列がリソース×日の直積になり、見出しに日ラベルと data-koyomi-date が付く', () => {
    const { container } = render(<Harness resources={makeResources(2)} resourceViewDays={2} />);
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root).toHaveAttribute('data-koyomi-columns', '4');
    const headers = Array.from(container.querySelectorAll('[data-koyomi="resource-header-cell"]'));
    expect(headers).toHaveLength(4);
    // NOW = 2026-07-15（水）が先頭日
    expect(headers[0]?.textContent).toBe('リソース0 15 (水)');
    expect(headers[1]?.textContent).toBe('リソース0 16 (木)');
    expect(headers[0]).toHaveAttribute('data-koyomi-date', '2026-07-15');
    expect(headers[1]).toHaveAttribute('data-koyomi-date', '2026-07-16');
  });

  it('now-indicator は今日の列にだけ描画され、data-koyomi-business-hours は列ごとの日の曜日基準になる', () => {
    // NOW = 2026-07-15（水）。水曜だけ営業にする → 1 日目の列のみハイライト
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [3], startTime: '09:00', endTime: '17:00' },
    ];
    const { container } = render(
      <Harness resources={makeResources(1)} resourceViewDays={2} businessHours={businessHours} />,
    );
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns).toHaveLength(2);
    expect(columns[0]?.querySelector('[data-koyomi="now-indicator"]')).not.toBeNull();
    expect(columns[1]?.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
    expect(columns[0]?.querySelectorAll('[data-koyomi-business-hours]').length).toBeGreaterThan(0);
    expect(columns[1]?.querySelectorAll('[data-koyomi-business-hours]')).toHaveLength(0);
  });
});

describe('VirtualResourceView - 表示時間帯制限（slotMinTime/slotMaxTime）', () => {
  it('省略時は既定 00:00/24:00 として、スロット数・イベントの top/height %・--koyomi-timegrid-hours が従来どおりになる（回帰ペア）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(1)} events={events} />);
    const column = container.querySelector('[data-koyomi="resource-column"]');
    expect(column?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(24);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    expect(eventEl.style.top).toBe(`${(600 / 1440) * 100}%`);
    expect(eventEl.style.height).toBe(`${(60 / 1440) * 100}%`);

    const root = container.querySelector('[data-koyomi="resource"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('24');
  });

  it('slotMinTime/slotMaxTime を指定すると、スロット数・イベントの top/height %・--koyomi-timegrid-hours が表示時間帯基準になる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness
        resources={makeResources(1)}
        events={events}
        slotMinTime="08:00"
        slotMaxTime="20:00"
      />,
    );
    const column = container.querySelector('[data-koyomi="resource-column"]');
    expect(column?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(12);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    expect(eventEl.style.top).toBe(`${((600 - 480) / (1200 - 480)) * 100}%`);
    expect(eventEl.style.height).toBe(`${(60 / (1200 - 480)) * 100}%`);

    const root = container.querySelector('[data-koyomi="resource"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('12');
  });

  it('表示時間帯の外側にしか存在しないオカレンスは timegrid-event として描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'early',
        title: '早朝',
        start: '2026-07-15T05:00',
        end: '2026-07-15T06:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(
      <Harness
        resources={makeResources(1)}
        events={events}
        slotMinTime="08:00"
        slotMaxTime="20:00"
      />,
    );
    expect(container.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
  });
});

describe('VirtualResourceView - 初期スクロール位置（initialScrollTime）・命令的スクロール（scrollToTime）', () => {
  /** jsdom は scrollHeight を常に 0 として扱うため、テスト内で固定値へ差し替える。 */
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 2000,
    });
  });

  afterEach(() => {
    if (scrollHeightDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    }
  });

  /**
   * 縦横のスクロールはルート（[data-koyomi="resource"]）が一括で担う（見出し行は
   * sticky）。initialScrollTime / scrollToTime はルートの scrollTop を変更しなければ
   * 実ブラウザで無効になる。
   */
  function getScroller(container: HTMLElement): HTMLElement {
    const root = container.querySelector('[data-koyomi="resource"]');
    if (!(root instanceof HTMLElement)) {
      throw new Error('resource ルートが見つかりません');
    }
    return root;
  }

  it('initialScrollTime 省略時はマウント時に scrollTop が変化しない（回帰ペア）', () => {
    const { container } = render(<Harness resources={makeResources(1)} />);
    expect(getScroller(container).scrollTop).toBe(0);
  });

  it('initialScrollTime 指定時にマウント時 1 回だけ scrollTop が設定される', () => {
    const { container } = render(
      <Harness resources={makeResources(1)} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    expect(getScroller(container).scrollTop).toBe((540 / 1440) * 2000);
  });

  it('ref.current.scrollToTime(time) で任意のタイミングにスクロールできる（scrollToResource と共存する）', () => {
    const handleRef = createRef<VirtualResourceViewHandle>();
    const { container } = render(<Harness resources={makeResources(1)} handleRef={handleRef} />);
    const body = getScroller(container);
    expect(body.scrollTop).toBe(0);

    act(() => {
      handleRef.current?.scrollToTime('12:00');
    });
    expect(body.scrollTop).toBe((720 / 1440) * 2000);
    // scrollToTime は縦スクロールのみを変更し、横スクロール（scrollLeft）には干渉しない
    expect(body.scrollLeft).toBe(0);
  });

  it('表示時間帯制限（slotMinTime/slotMaxTime）を指定していても initialScrollTime/scrollToTime は機能する（独立性の確認）', () => {
    const handleRef = createRef<VirtualResourceViewHandle>();
    const { container } = render(
      <Harness
        resources={makeResources(1)}
        slotMinTime="08:00"
        slotMaxTime="20:00"
        handleRef={handleRef}
        viewProps={{ initialScrollTime: '10:00' }}
      />,
    );
    const body = getScroller(container);
    expect(body.scrollTop).toBe(((600 - 480) / (1200 - 480)) * 2000);

    act(() => {
      handleRef.current?.scrollToTime('14:00');
    });
    expect(body.scrollTop).toBe(((840 - 480) / (1200 - 480)) * 2000);
  });

  it('アンマウント後に再マウントすると initialScrollTime が再適用される', () => {
    const { container, unmount } = render(
      <Harness resources={makeResources(1)} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    const body = getScroller(container);
    expect(body.scrollTop).toBe((540 / 1440) * 2000);
    body.scrollTop = 999;
    unmount();

    const { container: remounted } = render(
      <Harness resources={makeResources(1)} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    expect(getScroller(remounted).scrollTop).toBe((540 / 1440) * 2000);
  });
});

describe('VirtualResourceView - onVisibleRangeChange（可視範囲の変更通知）', () => {
  it('マウント後に現在の可視範囲（列・日付範囲・リソース）が通知される', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <Harness resources={makeResources(5)} viewProps={{ onVisibleRangeChange }} />,
    );
    await setViewport(container, 1000, 0);

    expect(onVisibleRangeChange).toHaveBeenCalled();
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    // 列: 境界幅 1000px に全 5 列（各 160px）が収まる
    expect(info.columns).toEqual({
      startIndex: 0,
      endIndex: 4,
      startKey: 'r:r0',
      endKey: 'r:r4',
    });
    // 日付範囲: resourceViewDays 既定（1）のため全列が同じ日（表示タイムゾーンの日境界。
    // end は排他）
    expect(info.rangeStart.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    expect(info.rangeEnd.toISOString()).toBe('2026-07-15T15:00:00.000Z');
    // リソース: 可視列の順に並ぶ
    expect(info.resources.map((r: CalendarResource | null) => r?.id ?? null)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4',
    ]);
  });

  it('横スクロールで可視列が変わると通知され、同じ範囲では再通知されない', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <Harness resources={makeResources(200)} viewProps={{ onVisibleRangeChange }} />,
    );
    await setViewport(container, 100, 0);
    const callsAtTop = onVisibleRangeChange.mock.calls.length;

    // 100 列分（100 × 160px = 16000px）スクロール → 可視列 100
    await setViewport(container, 100, 16000);
    expect(onVisibleRangeChange.mock.calls.length).toBeGreaterThan(callsAtTop);
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    expect(info.columns.startIndex).toBe(100);
    expect(info.columns.startKey).toBe('r:r100');
    expect(info.resources[0]?.id).toBe('r100');

    // 同じスクロール位置の scroll イベントでは再通知しない
    const callsAfterScroll = onVisibleRangeChange.mock.calls.length;
    await setViewport(container, 100, 16000);
    expect(onVisibleRangeChange.mock.calls.length).toBe(callsAfterScroll);
  });

  it('コールバック未指定でも比較基準は更新され、後から指定した際に古い差分で発火しない', async () => {
    const { container, rerender } = render(<Harness resources={makeResources(200)} />);
    await setViewport(container, 100, 0);
    // コールバック未登録のままスクロール（比較基準は内部で更新される）
    await setViewport(container, 100, 16000);

    const onVisibleRangeChange = vi.fn();
    rerender(<Harness resources={makeResources(200)} viewProps={{ onVisibleRangeChange }} />);
    // スクロール位置は変えていない（内部の比較基準と同じ範囲）ため発火しない
    expect(onVisibleRangeChange).not.toHaveBeenCalled();
  });

  it('viewModel が resource 以外のときは通知しない', () => {
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

  it('複数日表示（resourceViewDays）では可視列に含まれる日付の最小〜最大から日付範囲を導出する（列順は リソース×日 の直積のため単純な先頭/末尾では求まらない）', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        resourceViewDays={3}
        viewProps={{ columnWidth: 100, onVisibleRangeChange }}
      />,
    );
    // 列構成: r0@7/15, r0@7/16, r0@7/17, r1@7/15, r1@7/16, r1@7/17（各 100px）
    // scrollLeft=250, clientWidth=100 → 可視列は index 2（r0@7/17）〜3（r1@7/15）
    await setViewport(container, 100, 250);

    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    expect(info.columns).toEqual({
      startIndex: 2,
      endIndex: 3,
      startKey: 'r:r0@2026-07-17',
      endKey: 'r:r1@2026-07-15',
    });
    // 可視列の日付は 7/17（先頭）と 7/15（末尾）で並びが日付順ではないため、
    // 最小日（7/15）〜最大日（7/17）の翌日（排他）が正しい日付範囲になる
    expect(info.rangeStart.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    expect(info.rangeEnd.toISOString()).toBe('2026-07-17T15:00:00.000Z');
    expect(info.resources.map((r: CalendarResource | null) => r?.id ?? null)).toEqual(['r0', 'r1']);
  });
});

describe('VirtualResourceView - 仮想化 ARIA 列属性（aria-colcount/aria-colindex）', () => {
  it('grid に aria-colcount（総列数）が付く', () => {
    const { container } = render(<Harness resources={makeResources(5)} />);
    const grid = container.querySelector('[data-koyomi="resource-grid"]');
    expect(grid?.getAttribute('aria-colcount')).toBe('5');
  });

  it('columnheader・gridcell の aria-colindex は 1 始まりの絶対位置を持つ', async () => {
    const { container } = render(<Harness resources={makeResources(5)} />);
    // 5 列すべてが可視窓に収まるよう境界幅を与える（既定 overscan では窓が全件を含まない）
    await setViewport(container, 5 * 160, 0);
    const headerIndices = Array.from(
      container.querySelectorAll('[data-koyomi="resource-header-cell"]'),
    ).map((cell) => cell.getAttribute('aria-colindex'));
    expect(headerIndices).toEqual(['1', '2', '3', '4', '5']);

    const alldayIndices = Array.from(
      container.querySelectorAll('[data-koyomi="resource-allday-cell"]'),
    ).map((cell) => cell.getAttribute('aria-colindex'));
    expect(alldayIndices).toEqual(['1', '2', '3', '4', '5']);
  });

  it('スクロールして可視列が変わっても aria-colindex は絶対位置を保つ（相対位置に振り直されない）', async () => {
    const { container } = render(<Harness resources={makeResources(200)} />);
    // 列幅既定 160px × 100 列 = 16000px スクロール → index 100（r:r100）が可視窓に入る
    await setViewport(container, 100, 16000);

    const headerCell = container.querySelector(
      '[data-koyomi="resource-header-cell"][data-koyomi-column-key="r:r100"]',
    );
    if (headerCell === null) {
      throw new Error('r:r100 の列見出しが見つかりません');
    }
    expect(headerCell.getAttribute('aria-colindex')).toBe('101');
  });

  it('pinned 列にも正しい aria-colindex が付く（columnheader・gridcell 両方）', async () => {
    const events: CalendarEvent[] = [
      {
        id: 'e0',
        title: '予定0',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'r0',
      },
    ];
    const { container } = render(<Harness resources={makeResources(200)} events={events} />);
    await setViewport(container, 200, 0);

    const firstItem = container.querySelector('[data-koyomi="timegrid-event"]');
    if (firstItem === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstItem);
    });
    await setViewport(container, 200, 20000);

    const pinnedHeader = container.querySelector(
      '[data-koyomi="resource-header-cell"][data-koyomi-pinned="true"]',
    );
    const pinnedAllday = container.querySelector(
      '[data-koyomi="resource-allday-cell"][data-koyomi-pinned="true"]',
    );
    expect(pinnedHeader?.getAttribute('aria-colindex')).toBe('1');
    expect(pinnedAllday?.getAttribute('aria-colindex')).toBe('1');
  });

  it('resource-grid の行（見出し行・終日行）は仮想化されないため aria-rowcount/aria-rowindex は付けない', () => {
    const { container } = render(<Harness resources={makeResources(5)} />);
    const grid = container.querySelector('[data-koyomi="resource-grid"]');
    expect(grid?.hasAttribute('aria-rowcount')).toBe(false);
    const headerRow = container.querySelector('[data-koyomi="resource-header"]');
    const alldayRow = container.querySelector('[data-koyomi="allday-row"]');
    expect(headerRow?.hasAttribute('aria-rowindex')).toBe(false);
    expect(alldayRow?.hasAttribute('aria-rowindex')).toBe(false);
  });
});

describe('VirtualResourceView - 終日行のあふれ（allDayMaxEvents）', () => {
  /** 2026-07-15 を覆う単日の終日イベント（r0 割当）を `count` 件生成する。 */
  function alldayEvents(count: number): CalendarEvent[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `allday-${index}`,
      title: `終日 ${index}`,
      start: '2026-07-15',
      end: '2026-07-16',
      allDay: true,
      resourceId: 'r0',
    }));
  }

  it('上限を超過した終日アイテムは描画されず、「+N 件」ボタンのクリックで onAllDayOverflowClick が対象列付きで呼ばれる', () => {
    const onAllDayOverflowClick = vi.fn();
    const { container } = render(
      <Harness
        resources={makeResources(2)}
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        callbacks={{ onAllDayOverflowClick }}
      />,
    );
    expect(container.querySelectorAll('[data-koyomi="allday-event"]')).toHaveLength(2);
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('overflow button not found');
    }
    expect(overflowButton.textContent).toBe('+1 件');

    fireEvent.click(overflowButton);
    expect(onAllDayOverflowClick).toHaveBeenCalledTimes(1);
    const [info, hiddenOccurrences, details] = onAllDayOverflowClick.mock.calls[0] ?? [];
    expect(info).toMatchObject({ dayKey: '2026-07-15', view: 'resource' });
    expect(info.column?.key).toBe('r:r0');
    expect(hiddenOccurrences).toHaveLength(1);
    expect(details.visibleOccurrences).toHaveLength(2);
  });

  it('既定（allDayMaxEvents 未指定）では全件が描画され、あふれボタンは描画されない（対検証）', () => {
    const { container } = render(<Harness resources={makeResources(2)} events={alldayEvents(4)} />);
    expect(container.querySelectorAll('[data-koyomi="allday-event"]')).toHaveLength(4);
    expect(container.querySelector('[data-koyomi="allday-overflow"]')).toBeNull();
    const cell = container.querySelector('[data-koyomi="resource-allday-cell"]');
    expect(cell).toHaveStyle({ minHeight: 'calc(4 * var(--koyomi-lane-height, 24px))' });
  });

  it('renderOverflowLabel と overflowButtonProps がボタンに反映される', () => {
    const { container } = render(
      <Harness
        resources={makeResources(1)}
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        viewProps={{
          renderOverflowLabel: (column, ctx) => (
            <span data-testid="custom-allday-overflow">
              {column.dayKey}:他{ctx.hiddenOccurrences.length}件
            </span>
          ),
          overflowButtonProps: () => ({ 'aria-haspopup': 'dialog', 'aria-expanded': false }),
        }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    expect(overflowButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(overflowButton).toHaveAttribute('aria-expanded', 'false');
    expect(
      overflowButton?.querySelector('[data-testid="custom-allday-overflow"]')?.textContent,
    ).toBe('2026-07-15:他1件');
  });
});
