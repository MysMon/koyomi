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
} from '../../core/types';
import { CalendarProvider } from '../context';
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
  viewProps?: VirtualResourceViewProps;
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
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} {...(props.callbacks ? { callbacks: props.callbacks } : {})}>
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

  it('eventAriaLabel は既定の aria-label 文字列（終日・時間指定の両方）を defaultLabel として受け取る', () => {
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
      defaultLabel: string,
    ): string => `カスタム:${defaultLabel}`;
    const { container } = render(
      <Harness resources={makeResources(2)} events={events} viewProps={{ eventAriaLabel }} />,
    );
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent).toHaveAttribute('aria-label', 'カスタム:休暇、7月15日、リソース0');
    const timedEvent = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(timedEvent).toHaveAttribute(
      'aria-label',
      'カスタム:会議、7月15日 10:00〜11:00、リソース0',
    );
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
          renderColumnHeader: (column, defaultContent) => (
            <span data-koyomi="custom-header">
              CUSTOM:{column.key}:{defaultContent}
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
