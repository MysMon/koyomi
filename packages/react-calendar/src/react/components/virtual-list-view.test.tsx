/**
 * virtual-list-view.tsx のテスト。
 *
 * jsdom はレイアウトを持たないため `clientHeight` を明示定義し、`ResizeObserver` は
 * モックする。共有レンダラ {@link ListDaySection} を使うため、DOM 構造は `ListView` と
 * 一致する（`docs/internal/components-dom.md` の「リストビュー」＋仮想化拡張）。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, EventOccurrence, ListDay } from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type {
  CalendarInteractionCallbacks,
  EventContentContext,
  EventContentRenderer,
  SlotRenderContext,
  UseCalendarResult,
} from '../types';
import { useCalendar } from '../use-calendar';
import type { VirtualListViewProps } from './virtual-list-view';
import { VirtualListView } from './virtual-list-view';

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
  // 開発警告を捕捉しつつ stderr への出力は抑える。
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 東京の 2026-07-15 10:00 を固定「現在時刻」にする。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** 連続する日に 1 件ずつ予定を持つイベント列を作る（2026-07-16 から、月跨ぎに対応）。 */
function makeDailyEvents(dayCount: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (let day = 0; day < dayCount; day += 1) {
    // UTC 正午を基準に day 日進め、日付部分だけを取り出す（TZ 差でのずれを避ける）。
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

function TestVirtualList(props: {
  events?: readonly CalendarEvent[];
  callbacks?: CalendarInteractionCallbacks;
  listDays?: number;
  estimateDayHeight?: VirtualListViewProps['estimateDayHeight'];
  messages?: MessageCatalogOverrides;
  viewProps?: VirtualListViewProps;
  renderEventContent?: EventContentRenderer;
  initialView?: 'list' | 'month';
  /** マウント後に calendar API（`setEvents` 等）を呼べるよう、生成結果を親へ渡す。 */
  onCalendarReady?: (calendar: UseCalendarResult) => void;
}): ReactElement {
  const calendar = useCalendar({
    timeZone: 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'list',
    events: props.events ?? [],
    ...(props.listDays !== undefined ? { listDays: props.listDays } : {}),
  });
  props.onCalendarReady?.(calendar);
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
      {...(props.renderEventContent !== undefined
        ? { renderEventContent: props.renderEventContent }
        : {})}
    >
      <VirtualListView
        estimateDayHeight={props.estimateDayHeight ?? 50}
        {...(props.viewProps ?? {})}
      />
    </CalendarProvider>
  );
}

/** 描画済みコンテナに clientHeight を定義し、scroll を発火して同期させる。 */
async function setViewport(
  container: HTMLElement,
  clientHeight: number,
  scrollTop = 0,
): Promise<void> {
  const list = container.querySelector('[data-koyomi="list"]');
  if (!(list instanceof HTMLElement)) {
    throw new Error('list コンテナが見つかりません');
  }
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: clientHeight });
  await act(async () => {
    list.scrollTop = scrollTop;
    list.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('VirtualListView', () => {
  it('仮想化コンテナと spacer・role 構造を描画する', () => {
    const { container } = render(<TestVirtualList events={makeDailyEvents(3)} listDays={40} />);

    const list = container.querySelector('[data-koyomi="list"]');
    expect(list?.getAttribute('data-koyomi-virtualized')).toBe('true');
    expect(list?.getAttribute('role')).toBe('list');
    expect(list?.getAttribute('tabindex')).toBe('0');

    const spacers = container.querySelectorAll('[data-koyomi="list-spacer"]');
    expect(spacers).toHaveLength(2);
    expect(spacers[0]?.getAttribute('data-edge')).toBe('before');
    expect(spacers[0]?.getAttribute('role')).toBe('presentation');
    expect(spacers[1]?.getAttribute('data-edge')).toBe('after');

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]?.getAttribute('role')).toBe('listitem');
  });

  it('日セクションの aria-label に件数を含む', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '朝会', start: '2026-07-16T09:00:00', end: '2026-07-16T09:30:00' },
      { id: 'b', title: '昼会', start: '2026-07-16T12:00:00', end: '2026-07-16T12:30:00' },
    ];
    const { container } = render(<TestVirtualList events={events} listDays={40} />);
    const section = container.querySelector('[data-koyomi-date="2026-07-16"]');
    expect(section?.getAttribute('aria-label')).toBe('7月16日(木) 予定2件');
  });

  it('messages.list.dayAriaLabel は整形済みの日付見出し（dateLabel）を受け取り、返り値がそのまま aria-label になる', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '朝会', start: '2026-07-16T09:00:00', end: '2026-07-16T09:30:00' },
    ];
    const dayAriaLabel = vi.fn(
      (day: ListDay, dateLabel: string) => `カスタム:${day.key}:${dateLabel}`,
    );
    const { container } = render(
      <TestVirtualList events={events} listDays={40} messages={{ list: { dayAriaLabel } }} />,
    );
    const section = container.querySelector('[data-koyomi-date="2026-07-16"]');
    expect(section?.getAttribute('aria-label')).toBe('カスタム:2026-07-16:7月16日(木)');
  });

  it('イベント行には既定の aria-label（ListView と同じ形式）が付き、messages.common.eventAriaLabel で置き換えられる', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '朝会', start: '2026-07-16T09:00:00', end: '2026-07-16T09:30:00' },
    ];
    const { container: withoutOverride } = render(
      <TestVirtualList events={events} listDays={40} />,
    );
    expect(
      withoutOverride.querySelector('[data-koyomi="list-event"]')?.getAttribute('aria-label'),
    ).toBe('朝会、7月16日 9:00〜9:30');

    const eventAriaLabel = vi.fn(
      (_occurrence: EventOccurrence, parts: { rangeLabel: string; resourceLabel?: string }) =>
        `カスタム:${parts.rangeLabel}`,
    );
    const { container } = render(
      <TestVirtualList events={events} listDays={40} messages={{ common: { eventAriaLabel } }} />,
    );
    expect(container.querySelector('[data-koyomi="list-event"]')).toHaveAttribute(
      'aria-label',
      'カスタム:7月16日 9:00〜9:30',
    );
  });

  it('境界高を与えると全件のうち一部の日セクションだけを描画する（窓の外は spacer）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    // 初期は全件（enabled 切替直後の同期前）。境界高 100px を与えて窓を絞る。
    await setViewport(container, 100, 0);

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections.length).toBeLessThan(40);
    expect(sections.length).toBeGreaterThan(0);

    // 窓より下に残りがあるため after spacer に高さがある
    const afterSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="after"]');
    const afterHeight = Number.parseFloat((afterSpacer as HTMLElement | null)?.style.height ?? '0');
    expect(afterHeight).toBeGreaterThan(0);
  });

  it('スクロールすると before spacer に高さが付く', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 500);

    const beforeSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="before"]');
    const beforeHeight = Number.parseFloat(
      (beforeSpacer as HTMLElement | null)?.style.height ?? '0',
    );
    expect(beforeHeight).toBeGreaterThan(0);
  });

  it('予定が無いときは list-empty を表示し仮想化コンテナは作らない', () => {
    const { container } = render(<TestVirtualList events={[]} />);
    expect(container.querySelector('[data-koyomi="list-empty"]')?.textContent).toBe(
      '予定はありません',
    );
    expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
  });

  it('現在のビューが list 以外のときは何も描画しない（viewModel.type が list 以外）', () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(5)} listDays={40} initialView="month" />,
    );
    expect(container.querySelector('[data-koyomi="list"]')).toBeNull();
    expect(container.querySelector('[data-koyomi="list-empty"]')).toBeNull();
  });

  it('1 件のみの日セクションでも仮想化コンテナを描画し、windowStart/windowEnd の境界で破綻しない', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(1)} listDays={10} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections).toHaveLength(1);
    const afterSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="after"]');
    expect((afterSpacer as HTMLElement | null)?.style.height).toBe('0px');
  });

  it('スクロールを末尾ちょうどまで進めると after spacer が 0 になる（下端の境界）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    // 全高 40*50=2000px、viewport 100px → 末尾ちょうど（scrollTop=1900）で after は 0 になる
    await setViewport(container, 100, 1900);

    const afterSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="after"]');
    expect((afterSpacer as HTMLElement | null)?.style.height).toBe('0px');
    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(container.querySelector('[data-koyomi-date="2026-08-24"]')).not.toBeNull();
    expect(sections.length).toBeGreaterThan(0);
  });

  it('件数が動的に変化しても windows が再計算される（calendar.setEvents で日数が減る）', async () => {
    let calendar: UseCalendarResult | undefined;
    const { container } = render(
      <TestVirtualList
        events={makeDailyEvents(40)}
        listDays={60}
        estimateDayHeight={50}
        onCalendarReady={(api) => {
          calendar = api;
        }}
      />,
    );
    await setViewport(container, 100, 0);
    expect(container.querySelectorAll('[data-koyomi="list-day"]').length).toBeLessThan(40);

    if (calendar === undefined) {
      throw new Error('calendar が取得できません');
    }
    await act(async () => {
      calendar?.api.setEvents(makeDailyEvents(3));
    });
    // 3 日分に減った後は全件が窓に収まり、spacer は両方とも 0 になる
    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections).toHaveLength(3);
    const afterSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="after"]');
    expect((afterSpacer as HTMLElement | null)?.style.height).toBe('0px');
  });

  it('estimateDayHeight を関数で渡すと、日と index を受け取って日ごとの推定高に使われる', async () => {
    const estimateDayHeight = vi.fn((_day: ListDay, index: number) => 20 + index * 10);
    const { container } = render(
      <TestVirtualList
        events={makeDailyEvents(5)}
        listDays={10}
        estimateDayHeight={estimateDayHeight}
      />,
    );
    await setViewport(container, 100, 0);

    expect(estimateDayHeight).toHaveBeenCalled();
    const [dayArg, indexArg] = estimateDayHeight.mock.calls[0] as [ListDay, number];
    expect(dayArg.key).toBe('2026-07-16');
    expect(indexArg).toBe(0);
    // 推定高が日ごとに異なるため、合計高（totalSize 相当）は一律 64px 換算とは一致しない
    const afterSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="after"]');
    const beforeSpacer = container.querySelector('[data-koyomi="list-spacer"][data-edge="before"]');
    const total =
      Number.parseFloat((afterSpacer as HTMLElement | null)?.style.height ?? '0') +
      Number.parseFloat((beforeSpacer as HTMLElement | null)?.style.height ?? '0');
    // 20+30+40+50+60 = 200（全件描画かつ scrollTop=0 のため before=0、after は末尾以降=0 のはず）
    expect(total).toBe(0);
  });

  it('overscan を指定すると窓の前後に描画される件数が増える', async () => {
    const withDefaultOverscan = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(withDefaultOverscan.container, 100, 500);
    const defaultCount = withDefaultOverscan.container.querySelectorAll(
      '[data-koyomi="list-day"]',
    ).length;

    const withLargeOverscan = render(
      <TestVirtualList
        events={makeDailyEvents(40)}
        listDays={60}
        estimateDayHeight={50}
        viewProps={{ overscan: 10 }}
      />,
    );
    await setViewport(withLargeOverscan.container, 100, 500);
    const largeCount = withLargeOverscan.container.querySelectorAll(
      '[data-koyomi="list-day"]',
    ).length;

    expect(largeCount).toBeGreaterThan(defaultCount);
  });

  it('イベント行クリックで onEventClick が発火する（共有レンダラの配線確認）', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestVirtualList events={events} listDays={40} callbacks={{ onEventClick }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event が見つかりません');
    }
    fireEvent.click(button);
    expect(onEventClick).toHaveBeenCalledTimes(1);
    const [occurrence] = onEventClick.mock.calls[0] as [EventOccurrence, MouseEvent];
    expect(occurrence.eventId).toBe('e1');
  });

  it('ダブルクリックで onEventDoubleClick が発火する（共有レンダラの配線確認）', () => {
    const onEventDoubleClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestVirtualList events={events} listDays={40} callbacks={{ onEventDoubleClick }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event が見つかりません');
    }
    fireEvent.dblClick(button);
    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('イベント行で Enter キーを押すとクリック相当（onEventClick）が発火する', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestVirtualList events={events} listDays={40} callbacks={{ onEventClick }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event が見つかりません');
    }
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('イベント行で Space キーを押すとクリック相当が発火し、それ以外のキーでは発火しない', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestVirtualList events={events} listDays={40} callbacks={{ onEventClick }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event が見つかりません');
    }
    fireEvent.keyDown(button, { key: 'a' });
    expect(onEventClick).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: ' ' });
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('フォーカス中の日セクションは窓外へスクロールしても pinned で残り、blur で解除される', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    // 先頭日（7/16）の予定にフォーカス → その日セクションを pin 対象にする
    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });

    // 窓外まで大きくスクロールしても、フォーカス中の 7/16 は pinned として残る
    await setViewport(container, 100, 1500);
    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    expect(pinned?.getAttribute('data-koyomi-date')).toBe('2026-07-16');

    // フォーカスがリスト外（body）へ抜けると pinned は解除される。
    // スクロールで pinned 側へ再マウントされているため、現在の DOM から取り直す。
    const pinnedButton = pinned?.querySelector('[data-koyomi="list-event"]');
    if (!(pinnedButton instanceof HTMLElement)) {
      throw new Error('pinned セクションの list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.blur(pinnedButton, { relatedTarget: document.body });
    });
    expect(container.querySelector('[data-koyomi-pinned="true"]')).toBeNull();
  });

  it('日セクションの外側（コンテナ自身）にフォーカスしても pinned は変化しない', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });

    // コンテナ自身（どの日セクションにも属さない要素）へのフォーカスは無視される
    const list = container.querySelector('[data-koyomi="list"]');
    if (list === null) {
      throw new Error('list コンテナが見つかりません');
    }
    await act(async () => {
      fireEvent.focus(list);
    });

    // 直前に pin された 7/16 がそのまま維持される（上書き・解除されない）
    await setViewport(container, 100, 1500);
    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    expect(pinned?.getAttribute('data-koyomi-date')).toBe('2026-07-16');
  });

  it('フォーカス移動先がコンテナ内にあるときは blur しても pinned を維持する', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });
    await setViewport(container, 100, 1500);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    const pinnedButton = pinned?.querySelector('[data-koyomi="list-event"]');
    if (!(pinnedButton instanceof HTMLElement)) {
      throw new Error('pinned セクションの list-event が見つかりません');
    }
    const list = container.querySelector('[data-koyomi="list"]');
    if (list === null) {
      throw new Error('list コンテナが見つかりません');
    }
    // relatedTarget（フォーカスの移動先）がコンテナ自身＝コンテナ内なので pinned は解除されない
    await act(async () => {
      fireEvent.blur(pinnedButton, { relatedTarget: list });
    });
    expect(
      container.querySelector('[data-koyomi-pinned="true"]')?.getAttribute('data-koyomi-date'),
    ).toBe('2026-07-16');
  });

  it('HTMLElement でない要素（SVG 等）へフォーカスしても例外にならず pinned は変化しない', async () => {
    const renderDayHeader = (day: ListDay, ctx: SlotRenderContext): ReactElement => (
      <>
        {ctx.defaultContent}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: テスト用途で HTMLElement でない要素（SVGElement）へ実際にフォーカスさせるため tabIndex が必要 */}
        <svg data-testid={`svg-${day.key}`} tabIndex={0} />
      </>
    );
    const { container } = render(
      <TestVirtualList
        events={makeDailyEvents(1)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ renderDayHeader }}
      />,
    );
    const svg = container.querySelector('[data-testid="svg-2026-07-16"]');
    if (svg === null) {
      throw new Error('svg 要素が見つかりません');
    }
    expect(() => {
      act(() => {
        fireEvent.focus(svg);
      });
    }).not.toThrow();
    // SVGElement は HTMLElement ではないため無視され、pinned は発生しない
    expect(container.querySelector('[data-koyomi-pinned="true"]')).toBeNull();
  });

  it('pinned セクションは絶対配置の inline style を持つ（テーマ CSS 非依存でも通常フローに割り込まない）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });
    await setViewport(container, 100, 1500);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    // 位置決めに必須のスタイルは inline で出力する（ヘッドレス原則）。テーマ CSS を
    // 読み込まない利用者でも、pinned セクションが通常フローに割り込んで日セクションの
    // 重複表示・高さ跳ねを起こさないよう、position: absolute を inline に持つ
    // （VirtualTimelineView の pinned style / VirtualResourceView の columnPositionStyle と同じ方針）
    if (!(pinned instanceof HTMLElement)) {
      throw new Error('pinned セクションが見つかりません');
    }
    expect(pinned.style.position).toBe('absolute');
    expect(pinned.style.insetInlineStart).toBe('0px');
    expect(pinned.style.width).toBe('100%');
    expect(pinned.style.top).not.toBe('');
  });

  it('pinned セクションのイベント行はタブ順から外れる（tabindex=-1）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);
    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    // 窓内のイベント行は tabindex を持たない（通常のタブ順）
    expect(firstButton.hasAttribute('tabindex')).toBe(false);

    await act(async () => {
      fireEvent.focus(firstButton);
    });
    await setViewport(container, 100, 1500);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    const pinnedButton = pinned?.querySelector('[data-koyomi="list-event"]');
    expect(pinnedButton?.getAttribute('tabindex')).toBe('-1');
  });

  it('フォーカス中の日セクションが窓内にあるときは pinned の複製を作らない（重複描画しない）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });

    // フォーカス中の日（7/16）は窓内にとどまったまま（スクロールしていない）
    expect(container.querySelector('[data-koyomi-pinned="true"]')).toBeNull();
    const sections = container.querySelectorAll('[data-koyomi-date="2026-07-16"]');
    expect(sections).toHaveLength(1);
  });

  it('境界高が無く全件描画になる規模では開発警告を出す', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(50)} listDays={60} estimateDayHeight={50} />,
    );
    // 全件が可視になる大きな clientHeight（境界高なしで内容全高に伸びた状態を模擬）
    await setViewport(container, 50 * 60);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('境界高を与えて窓が絞られる場合は警告しない', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(50)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('仮想化の効果が出ていません'));
  });

  it('SSR（renderToString）で例外にならず全件を描画する', () => {
    const events = makeDailyEvents(5);
    const html = renderToString(<TestVirtualList events={events} listDays={40} />);
    // enabled=false 相当（マウント前）なので全 5 日が含まれる
    const dateMatches = html.match(/data-koyomi-date=/g) ?? [];
    expect(dateMatches.length).toBe(5);
  });

  it('境界高（clientHeight）が全内容を上回る＝実質無い場合、全日セクションが描画される', async () => {
    // 境界高が無ければ（開発警告を出すだけでなく）全件描画へのフォールバック本体が
    // 実際に働き、全日セクションが描画されるはずである。
    const dayCount = 50;
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(dayCount)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 50 * dayCount);

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections).toHaveLength(dayCount);
  });

  it('estimateDayHeight に負数を渡しても例外を投げず、日セクションが描画される', () => {
    expect(() =>
      render(
        <TestVirtualList events={makeDailyEvents(5)} listDays={10} estimateDayHeight={-100} />,
      ),
    ).not.toThrow();
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(5)} listDays={10} estimateDayHeight={-100} />,
    );
    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('estimateDayHeight に NaN を渡しても例外を投げない', () => {
    expect(() =>
      render(
        <TestVirtualList
          events={makeDailyEvents(5)}
          listDays={10}
          estimateDayHeight={Number.NaN}
        />,
      ),
    ).not.toThrow();
  });
});

/**
 * 2026-07-16 の 1 日に `count` 件の予定を作る（00:00 から 1 分刻み・各 30 秒。
 * 開始時刻順のオカレンス順序がタイトルの連番と一致する）。
 */
function makeSingleDayEvents(count: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const hh = String(Math.floor(index / 60)).padStart(2, '0');
    const mm = String(index % 60).padStart(2, '0');
    events.push({
      id: `m${index}`,
      title: `多数${index}`,
      start: `2026-07-16T${hh}:${mm}:00`,
      end: `2026-07-16T${hh}:${mm}:30`,
    });
  }
  return events;
}

describe('VirtualListView - セクション内ウィンドウ描画', () => {
  it('既定の閾値（50 件）以下のセクションは全件描画し、アイテムスペーサーを作らない', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(50)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    expect(container.querySelectorAll('[data-koyomi="list-event"]')).toHaveLength(50);
    expect(container.querySelector('[data-koyomi="list-event-spacer"]')).toBeNull();
    // 閾値以下では挙動不変: イベント行にオカレンスキー属性も付かない
    expect(
      container.querySelector('[data-koyomi="list-event"][data-koyomi-occurrence]'),
    ).toBeNull();
  });

  it('閾値を超えるセクションは可視範囲のアイテムだけを描画し、上下にスペーサーを置く', async () => {
    const itemCount = 60;
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(itemCount)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    const buttons = container.querySelectorAll('[data-koyomi="list-event"]');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(itemCount);
    // 先頭のアイテムは描画され、末尾のアイテムは描画されない
    expect(container.textContent).toContain('多数0');
    expect(container.textContent).not.toContain('多数59');

    // 描画されないアイテム分は上下スペーサーの推定高で置き換わる
    const before = container.querySelector('[data-koyomi="list-event-spacer"][data-edge="before"]');
    const after = container.querySelector('[data-koyomi="list-event-spacer"][data-edge="after"]');
    const beforeHeight = Number.parseFloat((before as HTMLElement | null)?.style.height ?? '0');
    const afterHeight = Number.parseFloat((after as HTMLElement | null)?.style.height ?? '0');
    expect(beforeHeight).toBe(0); // 先頭表示なので上は 0
    expect(afterHeight).toBeGreaterThan(0);
    expect(beforeHeight + afterHeight).toBe((itemCount - buttons.length) * 20);
    // スペーサーは role を持たない
    expect(before?.hasAttribute('role')).toBe(false);
    expect(after?.hasAttribute('role')).toBe(false);
  });

  it('スクロールすると描画されるアイテム範囲が追従して動く', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(60)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 600);

    // スクロール位置（600px 付近 = index 30 前後）のアイテムだけが描画される
    expect(container.textContent).not.toContain('多数0');
    expect(container.textContent).toContain('多数30');
    expect(container.textContent).not.toContain('多数59');
    const before = container.querySelector('[data-koyomi="list-event-spacer"][data-edge="before"]');
    expect(Number.parseFloat((before as HTMLElement | null)?.style.height ?? '0')).toBeGreaterThan(
      0,
    );
  });

  it('閾値超過セクションのイベント行にはオカレンスキー属性（data-koyomi-occurrence）が付く', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(60)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button?.getAttribute('data-koyomi-occurrence')).toBeTruthy();
  });

  it('フォーカス中のアイテムは範囲外へスクロールしても描画され続け、blur で解除される', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(60)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    // 先頭アイテム（多数0）にフォーカスして pin 対象にする
    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    expect(firstButton.textContent).toContain('多数0');
    await act(async () => {
      fireEvent.focus(firstButton);
    });

    // 範囲外（index 30 付近）へスクロールしても多数0 は pinned で残る
    await setViewport(container, 100, 600);
    const pinnedButton = container.querySelector(
      '[data-koyomi="list-event"][data-koyomi-pinned="true"]',
    );
    if (!(pinnedButton instanceof HTMLElement)) {
      throw new Error('pinned のイベント行が見つかりません');
    }
    expect(pinnedButton.textContent).toContain('多数0');
    // 範囲外の pinned アイテムはタブ順から外れ、スペーサー内で絶対配置される
    expect(pinnedButton.getAttribute('tabindex')).toBe('-1');
    expect(pinnedButton.style.position).toBe('absolute');
    expect(pinnedButton.style.top).toBe('0px'); // index 0 = 上スペーサー内の先頭

    // フォーカスがリスト外へ抜けると pinned は解除される
    await act(async () => {
      fireEvent.blur(pinnedButton, { relatedTarget: document.body });
    });
    expect(
      container.querySelector('[data-koyomi="list-event"][data-koyomi-pinned="true"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('多数0');
  });

  it('sectionItemWindowThreshold で適用境界を変えられる（閾値ちょうどは全件描画）', async () => {
    const windowed = render(
      <TestVirtualList
        events={makeSingleDayEvents(12)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20, sectionItemWindowThreshold: 10 }}
      />,
    );
    await setViewport(windowed.container, 100, 0);
    expect(windowed.container.querySelectorAll('[data-koyomi="list-event"]').length).toBeLessThan(
      12,
    );
    expect(windowed.container.querySelector('[data-koyomi="list-event-spacer"]')).not.toBeNull();

    const full = render(
      <TestVirtualList
        events={makeSingleDayEvents(12)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20, sectionItemWindowThreshold: 12 }}
      />,
    );
    await setViewport(full.container, 100, 0);
    expect(full.container.querySelectorAll('[data-koyomi="list-event"]')).toHaveLength(12);
    expect(full.container.querySelector('[data-koyomi="list-event-spacer"]')).toBeNull();
  });

  it('複数日のうち閾値超過の日だけウィンドウ描画され、他の日は全件描画のまま', async () => {
    const events = [...makeSingleDayEvents(60), ...makeDailyEvents(3).slice(1)]; // 7/17, 7/18 に 1 件ずつ
    const { container } = render(
      <TestVirtualList
        events={events}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20, overscan: 10 }}
      />,
    );
    await setViewport(container, 100, 0);

    const largeSection = container.querySelector('[data-koyomi-date="2026-07-16"]');
    const smallSection = container.querySelector('[data-koyomi-date="2026-07-17"]');
    expect(largeSection?.querySelector('[data-koyomi="list-event-spacer"]')).not.toBeNull();
    expect(largeSection?.querySelectorAll('[data-koyomi="list-event"]').length).toBeLessThan(60);
    expect(smallSection?.querySelector('[data-koyomi="list-event-spacer"]')).toBeNull();
    expect(smallSection?.querySelectorAll('[data-koyomi="list-event"]')).toHaveLength(1);
  });

  it('ウィンドウ描画中も日セクションの aria-label は日全体の件数を保つ', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(60)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    const section = container.querySelector('[data-koyomi-date="2026-07-16"]');
    expect(section?.getAttribute('aria-label')).toBe('7月16日(木) 予定60件');
  });

  it('フォーカスした日セクションごと窓外へ出た場合も、pinned セクション内でフォーカス中アイテムが描画される', async () => {
    // 7/16 に 60+1 件（閾値超過）、以降の日に 1 件ずつ（日セクションのスクロールを作る）
    const events = [...makeSingleDayEvents(60), ...makeDailyEvents(40)];
    const { container } = render(
      <TestVirtualList
        events={events}
        listDays={60}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: 20 }}
      />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    expect(firstButton.textContent).toContain('多数0');
    await act(async () => {
      fireEvent.focus(firstButton);
    });

    // 日セクションごと窓外へ（7/16 は pinned セクションになる）
    await setViewport(container, 100, 1500);
    const pinnedSection = container.querySelector(
      '[data-koyomi="list-day"][data-koyomi-pinned="true"]',
    );
    if (!(pinnedSection instanceof HTMLElement)) {
      throw new Error('pinned の日セクションが見つかりません');
    }
    expect(pinnedSection.getAttribute('data-koyomi-date')).toBe('2026-07-16');
    // pinned セクションの中でも全 61 件は描画せず、フォーカス中の多数0 は保持する
    const pinnedButtons = pinnedSection.querySelectorAll('[data-koyomi="list-event"]');
    expect(pinnedButtons.length).toBeLessThan(61);
    expect(pinnedSection.textContent).toContain('多数0');
  });

  it('estimateItemHeight に不正な値（NaN）を渡しても例外にならず全件描画へ縮退する', async () => {
    const { container } = render(
      <TestVirtualList
        events={makeSingleDayEvents(60)}
        listDays={10}
        estimateDayHeight={50}
        viewProps={{ estimateItemHeight: Number.NaN }}
      />,
    );
    await setViewport(container, 100, 0);
    expect(container.querySelectorAll('[data-koyomi="list-event"]')).toHaveLength(60);
  });
});

describe('VirtualListView - カスタム描画 props', () => {
  it('renderEvent で行の内容を差し替えられ、ctx.parts の部位ノード（data-koyomi 付き）を並べ替えに使える', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '朝会', start: '2026-07-16T09:00:00', end: '2026-07-16T09:30:00' },
    ];
    const renderEvent = (_occurrence: EventOccurrence, ctx: EventContentContext): ReactElement => (
      <>
        {ctx.parts.title}
        {ctx.parts.time}
      </>
    );
    const { container } = render(
      <TestVirtualList events={events} listDays={40} viewProps={{ renderEvent }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).not.toBeNull();
    // タイトル → 時刻の順に並べ替えられ、data-koyomi 部位はそのまま
    const parts = Array.from(button?.querySelectorAll('[data-koyomi]') ?? []).map((el) =>
      el.getAttribute('data-koyomi'),
    );
    expect(parts).toEqual(['list-event-title', 'list-event-time']);
    expect(button?.textContent).toBe('朝会09:00〜09:30');
  });

  it('renderDayHeader で日付見出しの内容を差し替えられ、ctx.defaultContent で既定内容にアクセスできる', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: '朝会', start: '2026-07-16T09:00:00', end: '2026-07-16T09:30:00' },
    ];
    const renderDayHeader = vi.fn((day: ListDay, ctx: SlotRenderContext) => (
      <>
        見出し:{day.key}（{ctx.defaultContent}）
      </>
    ));
    const { container } = render(
      <TestVirtualList events={events} listDays={40} viewProps={{ renderDayHeader }} />,
    );
    expect(renderDayHeader).toHaveBeenCalled();
    const header = container.querySelector('[data-koyomi="list-day-header"]');
    expect(header?.textContent).toBe('見出し:2026-07-16（7月16日(木)）');
  });

  it('CalendarProvider の renderEventContent が行に適用され、ボタン要素と aria-label は保たれる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'a',
        title: '朝会',
        start: '2026-07-16T09:00:00',
        end: '2026-07-16T09:30:00',
        location: '第1会議室',
      },
    ];
    const { container } = render(
      <TestVirtualList
        events={events}
        listDays={40}
        renderEventContent={(occurrence, ctx) => (
          <>
            {ctx.defaultContent}
            <span data-testid="loc">＠{occurrence.event.location}</span>
          </>
        )}
      />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.querySelector('[data-testid="loc"]')?.textContent).toBe('＠第1会議室');
    expect(button).toHaveAttribute('aria-label', '朝会、7月16日 9:00〜9:30');
  });
});

describe('VirtualListView - onVisibleRangeChange（可視範囲の変更通知）', () => {
  it('マウント後に現在の可視範囲（日・日付範囲）が通知される', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <TestVirtualList
        events={makeDailyEvents(5)}
        listDays={40}
        estimateDayHeight={50}
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    await setViewport(container, 1000, 0);

    expect(onVisibleRangeChange).toHaveBeenCalled();
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    // 境界高 1000px に全 5 日（各 50px）が収まる
    expect(info.days).toEqual({
      startIndex: 0,
      endIndex: 4,
      startKey: '2026-07-16',
      endKey: '2026-07-20',
    });
    // 日付範囲: 表示タイムゾーン（Asia/Tokyo）の日境界。end は排他（7/21 の 0:00）
    expect(info.rangeStart.toISOString()).toBe('2026-07-15T15:00:00.000Z');
    expect(info.rangeEnd.toISOString()).toBe('2026-07-20T15:00:00.000Z');
  });

  it('スクロールで可視日が変わると通知され、同じ範囲では再通知されない', async () => {
    const onVisibleRangeChange = vi.fn();
    const { container } = render(
      <TestVirtualList
        events={makeDailyEvents(60)}
        listDays={60}
        estimateDayHeight={50}
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    await setViewport(container, 100, 0);
    const callsAtTop = onVisibleRangeChange.mock.calls.length;

    // 30 日分（30 × 50px = 1500px）スクロール → 可視日は index 30 から
    await setViewport(container, 100, 1500);
    expect(onVisibleRangeChange.mock.calls.length).toBeGreaterThan(callsAtTop);
    const info = onVisibleRangeChange.mock.calls.at(-1)?.[0];
    expect(info.days.startIndex).toBe(30);
    expect(info.days.startKey).toBe('2026-08-15');

    // 同じスクロール位置の scroll イベントでは再通知しない
    const callsAfterScroll = onVisibleRangeChange.mock.calls.length;
    await setViewport(container, 100, 1500);
    expect(onVisibleRangeChange.mock.calls.length).toBe(callsAfterScroll);
  });

  it('コールバック未指定でも比較基準は更新され、後から指定した際に古い差分で発火しない', async () => {
    const { container, rerender } = render(
      <TestVirtualList events={makeDailyEvents(60)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);
    // コールバック未登録のままスクロール（比較基準は内部で更新される）
    await setViewport(container, 100, 1500);

    const onVisibleRangeChange = vi.fn();
    rerender(
      <TestVirtualList
        events={makeDailyEvents(60)}
        listDays={60}
        estimateDayHeight={50}
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    // スクロール位置は変えていない（内部の比較基準と同じ範囲）ため発火しない
    expect(onVisibleRangeChange).not.toHaveBeenCalled();
  });

  it('viewModel が list 以外のときは通知しない', () => {
    const onVisibleRangeChange = vi.fn();
    render(
      <TestVirtualList
        events={makeDailyEvents(3)}
        listDays={40}
        initialView="month"
        viewProps={{ onVisibleRangeChange }}
      />,
    );
    expect(onVisibleRangeChange).not.toHaveBeenCalled();
  });

  it(
    '無関係な日の予定編集では、他の日の内容再描画（renderEvent の呼び出し回数）が増えない' +
      '（ListDaySection の memo 化の性能ピン留め。共有レンダラなので ListView と同じ観点を検証する）',
    async () => {
      let calendar: UseCalendarResult | undefined;
      const renderEvent = vi.fn((occurrence: EventOccurrence) => (
        <span>{occurrence.event.title}</span>
      ));
      const { container } = render(
        <TestVirtualList
          events={makeDailyEvents(3)}
          listDays={5}
          estimateDayHeight={50}
          viewProps={{ renderEvent }}
          onCalendarReady={(api) => {
            calendar = api;
          }}
        />,
      );
      await setViewport(container, 300, 0);
      expect(container.querySelectorAll('[data-koyomi="list-day"]')).toHaveLength(3);
      expect(renderEvent).toHaveBeenCalledTimes(3);

      if (calendar === undefined) {
        throw new Error('calendar が取得できません');
      }
      await act(async () => {
        calendar?.api.updateEvent('e0', { title: '予定0改' });
      });

      // e0（7/16）の変更で再描画されるのは e0 のみ。他の 2 日は無関係なので
      // ListDaySection の内部実装は再実行されない（renderEvent が呼ばれない）
      expect(renderEvent).toHaveBeenCalledTimes(4);
      const titles = renderEvent.mock.calls.map(([occurrence]) => occurrence.event.title);
      expect(titles).toEqual(['予定0', '予定1', '予定2', '予定0改']);
    },
  );
});

describe('VirtualListView - 仮想化 ARIA 集合サイズ属性（aria-setsize/aria-posinset）', () => {
  it('可視セクションに aria-setsize（全日数）と絶対位置の aria-posinset が付く', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstSection = container.querySelector('[data-koyomi-date="2026-07-16"]');
    // days.length は「予定のある日」の数（listDays は範囲の広さであり件数ではない。
    // makeDailyEvents(40) は 40 日連続で予定があるため、60 日の範囲内でも 40 になる）
    expect(firstSection?.getAttribute('aria-setsize')).toBe('40');
    expect(firstSection?.getAttribute('aria-posinset')).toBe('1');
  });

  it('スクロールしても aria-posinset は絶対位置を保つ（可視範囲内の相対位置に振り直されない）', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    // 30 日分（30 × 50px）スクロール → 先頭に現れる日は index 30（絶対位置は 31）
    await setViewport(container, 100, 1500);

    const section = container.querySelector('[data-koyomi-date="2026-08-15"]');
    expect(section?.getAttribute('aria-posinset')).toBe('31');
    expect(section?.getAttribute('aria-setsize')).toBe('40');
  });

  it('pinned セクションにも絶対位置の aria-setsize/aria-posinset が付く', async () => {
    const { container } = render(
      <TestVirtualList events={makeDailyEvents(40)} listDays={60} estimateDayHeight={50} />,
    );
    await setViewport(container, 100, 0);

    const firstButton = container.querySelector('[data-koyomi="list-event"]');
    if (firstButton === null) {
      throw new Error('list-event が見つかりません');
    }
    await act(async () => {
      fireEvent.focus(firstButton);
    });
    await setViewport(container, 100, 1500);

    const pinned = container.querySelector('[data-koyomi-pinned="true"]');
    expect(pinned?.getAttribute('data-koyomi-date')).toBe('2026-07-16');
    expect(pinned?.getAttribute('aria-posinset')).toBe('1');
    expect(pinned?.getAttribute('aria-setsize')).toBe('40');
  });
});
