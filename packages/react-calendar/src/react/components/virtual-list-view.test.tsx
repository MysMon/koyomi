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
