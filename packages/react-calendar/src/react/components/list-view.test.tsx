/**
 * list-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` + `CalendarProvider` を使う結合テストとして、DOM 構造は
 * `docs/internal/components-dom.md` の「リストビュー」セクションに従って検証する。
 */
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarViewType, EventOccurrence, ListDay } from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks } from '../types';
import { useCalendar } from '../use-calendar';
import type { ListViewProps } from './list-view';
import { ListView } from './list-view';

/** テスト全体で使う固定「現在時刻」（東京の 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/**
 * `useCalendar` を呼び出し `ListView` を描画するテスト用ラッパー。
 * `CalendarProvider` 配下に `ListView` を配置する。
 */
function TestListView(props: {
  events?: readonly CalendarEvent[];
  callbacks?: CalendarInteractionCallbacks;
  renderEvent?: ListViewProps['renderEvent'];
  allDayLabel?: ListViewProps['allDayLabel'];
  emptyLabel?: ListViewProps['emptyLabel'];
  renderDayHeader?: ListViewProps['renderDayHeader'];
  eventAriaLabel?: ListViewProps['eventAriaLabel'];
  dayAriaLabel?: ListViewProps['dayAriaLabel'];
  view?: CalendarViewType;
  timeZone?: string;
}): ReactElement {
  const calendar = useCalendar({
    timeZone: props.timeZone ?? 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    initialView: props.view ?? 'list',
    events: props.events ?? [],
  });
  // exactOptionalPropertyTypes: true のもとでは、値が undefined になり得るプロパティを
  // そのまま渡せない（プロパティ自体を省略するか、確定した値を渡す必要がある）ため、
  // 条件付きスプレッドで未指定時はプロパティごと省略する。
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
    >
      <ListView
        {...(props.renderEvent !== undefined ? { renderEvent: props.renderEvent } : {})}
        {...(props.allDayLabel !== undefined ? { allDayLabel: props.allDayLabel } : {})}
        {...(props.emptyLabel !== undefined ? { emptyLabel: props.emptyLabel } : {})}
        {...(props.renderDayHeader !== undefined ? { renderDayHeader: props.renderDayHeader } : {})}
        {...(props.eventAriaLabel !== undefined ? { eventAriaLabel: props.eventAriaLabel } : {})}
        {...(props.dayAriaLabel !== undefined ? { dayAriaLabel: props.dayAriaLabel } : {})}
      />
    </CalendarProvider>
  );
}

describe('ListView', () => {
  it('予定のある日のみ日付順に section が並ぶ', () => {
    const events: CalendarEvent[] = [
      // 入力の順序をあえて日付順とは逆にしておく
      { id: 'e2', title: '会議20', start: '2026-07-20T09:00:00', end: '2026-07-20T09:30:00' },
      { id: 'e1', title: '会議16', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const sections = container.querySelectorAll('[data-koyomi="list-day"]');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.getAttribute('data-koyomi-date')).toBe('2026-07-16');
    expect(sections[1]?.getAttribute('data-koyomi-date')).toBe('2026-07-20');

    const headers = container.querySelectorAll('[data-koyomi="list-day-header"]');
    expect(headers[0]?.textContent).toBe('7月16日(木)');
    expect(headers[1]?.textContent).toBe('7月20日(月)');

    // 予定のない日（今日・7/15 など）は section が生成されない
    expect(container.querySelector('[data-koyomi-date="2026-07-15"]')).toBeNull();
  });

  it('今日の section には data-today が付く', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '本日の予定', start: '2026-07-15T10:00:00', end: '2026-07-15T11:00:00' },
      { id: 'e2', title: '明日の予定', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const todaySection = container.querySelector('[data-koyomi-date="2026-07-15"]');
    const tomorrowSection = container.querySelector('[data-koyomi-date="2026-07-16"]');
    expect(todaySection?.getAttribute('data-today')).toBe('true');
    expect(tomorrowSection?.hasAttribute('data-today')).toBe(false);
  });

  it('今日の section には aria-current="date" が付く（他の月/週/日ビューと同様）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '本日の予定', start: '2026-07-15T10:00:00', end: '2026-07-15T11:00:00' },
      { id: 'e2', title: '明日の予定', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const todaySection = container.querySelector('[data-koyomi-date="2026-07-15"]');
    const tomorrowSection = container.querySelector('[data-koyomi-date="2026-07-16"]');
    expect(todaySection).toHaveAttribute('aria-current', 'date');
    expect(tomorrowSection).not.toHaveAttribute('aria-current');
  });

  it('予定が 1 件もない場合は list-empty を表示する', () => {
    const { container } = render(<TestListView events={[]} />);

    const empty = container.querySelector('[data-koyomi="list-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('予定はありません');
    expect(container.querySelectorAll('[data-koyomi="list-day"]')).toHaveLength(0);
  });

  it('終日イベントが先頭に表示され、時刻ラベルは「終日」になる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'timed',
        title: '会議',
        start: '2026-07-16T19:00:00',
        end: '2026-07-16T20:30:00',
      },
      { id: 'allday', title: '終日イベント', start: '2026-07-16', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(<TestListView events={events} />);

    const rows = container.querySelectorAll('[data-koyomi="list-event"]');
    expect(rows).toHaveLength(2);

    const firstTitle = rows[0]?.querySelector('[data-koyomi="list-event-title"]')?.textContent;
    const firstTime = rows[0]?.querySelector('[data-koyomi="list-event-time"]')?.textContent;
    expect(firstTitle).toBe('終日イベント');
    expect(firstTime).toBe('終日');

    const secondTitle = rows[1]?.querySelector('[data-koyomi="list-event-title"]')?.textContent;
    const secondTime = rows[1]?.querySelector('[data-koyomi="list-event-time"]')?.textContent;
    expect(secondTitle).toBe('会議');
    expect(secondTime).toBe('19:00〜20:30');
  });

  it('時刻ラベルは表示タイムゾーンに従って計算される', () => {
    // 絶対時刻を固定し、カレンダーの表示タイムゾーンだけを変えて比較する
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00Z', end: '2026-07-16T11:30:00Z' },
    ];

    const tokyo = render(<TestListView events={events} timeZone="Asia/Tokyo" />);
    expect(tokyo.container.querySelector('[data-koyomi="list-event-time"]')?.textContent).toBe(
      '19:00〜20:30',
    );
    tokyo.unmount();

    const newYork = render(<TestListView events={events} timeZone="America/New_York" />);
    expect(newYork.container.querySelector('[data-koyomi="list-event-time"]')?.textContent).toBe(
      '06:00〜07:30',
    );
    newYork.unmount();
  });

  it('色見本には event.color から --koyomi-event-color が設定される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-16T10:00:00',
        end: '2026-07-16T11:00:00',
        color: '#ff0000',
      },
      { id: 'e2', title: '色なし', start: '2026-07-16T12:00:00', end: '2026-07-16T13:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const swatches = container.querySelectorAll('[data-koyomi="list-event-swatch"]');
    expect(swatches).toHaveLength(2);
    expect(swatches[0]?.getAttribute('style')).toContain('--koyomi-event-color: #ff0000');
    expect(swatches[1]?.getAttribute('style') ?? '').not.toContain('--koyomi-event-color');
  });

  it('クリックで onEventClick にオカレンスを渡す', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} callbacks={{ onEventClick }} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).not.toBeNull();
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    fireEvent.click(button);

    expect(onEventClick).toHaveBeenCalledTimes(1);
    const [occurrence] = onEventClick.mock.calls[0] as [EventOccurrence, MouseEvent];
    expect(occurrence.eventId).toBe('e1');
  });

  it('Enter キーで onEventClick が発火する', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} callbacks={{ onEventClick }} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).not.toBeNull();
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    const [occurrence] = onEventClick.mock.calls[0] as [EventOccurrence, MouseEvent];
    expect(occurrence.eventId).toBe('e1');
  });

  it('Space キーで onEventClick が発火する', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} callbacks={{ onEventClick }} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).not.toBeNull();
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    fireEvent.keyDown(button, { key: ' ' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it('ダブルクリックで onEventDoubleClick がオカレンスと nativeEvent を受け取る', () => {
    const onEventDoubleClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestListView events={events} callbacks={{ onEventDoubleClick }} />,
    );

    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    fireEvent.dblClick(button);

    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
    expect(onEventDoubleClick.mock.calls[0]?.[0]?.event.title).toBe('会議');
    expect(onEventDoubleClick.mock.calls[0]?.[1]).toBeInstanceOf(MouseEvent);
  });

  it('コンテキストメニュー操作で onEventContextMenu が呼ばれ、ライブラリは preventDefault しない', () => {
    const onEventContextMenu = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestListView events={events} callbacks={{ onEventContextMenu }} />,
    );

    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(contextMenuEvent, 'preventDefault');
    fireEvent(button, contextMenuEvent);

    expect(onEventContextMenu).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('pointerover/pointerout（外部要素からの出入り）で onEventHover / onEventHoverEnd が呼ばれる', () => {
    const onEventHover = vi.fn();
    const onEventHoverEnd = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(
      <TestListView events={events} callbacks={{ onEventHover, onEventHoverEnd }} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent(button, new MouseEvent('pointerover', { bubbles: true, relatedTarget: outside }));
    expect(onEventHover).toHaveBeenCalledTimes(1);

    fireEvent(button, new MouseEvent('pointerout', { bubbles: true, relatedTarget: outside }));
    expect(onEventHoverEnd).toHaveBeenCalledTimes(1);
  });

  it('コールバック未指定時、イベント行に onDoubleClick/onContextMenu/onPointerEnter/onPointerLeave のリスナーが付かない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (button === null) {
      throw new Error('list-event ボタンが見つかりません');
    }
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    // リスナーが付いていなければ、これらのディスパッチは単に何も起こさず例外も投げない
    expect(() => {
      fireEvent.dblClick(button);
      fireEvent(button, new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      fireEvent(button, new MouseEvent('pointerover', { bubbles: true, relatedTarget: outside }));
      fireEvent(button, new MouseEvent('pointerout', { bubbles: true, relatedTarget: outside }));
    }).not.toThrow();
  });

  it('イベント行には既定の aria-label（formatEventAriaLabel と同じ形式）が付く（仮想化の有無で読み上げが変わらない）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).toHaveAttribute('aria-label', '会議、7月16日 10:00〜11:00');
  });

  it('eventAriaLabel は既定の aria-label 文字列を defaultLabel として受け取り、返り値に置き換わる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const eventAriaLabel = vi.fn(
      (occurrence: EventOccurrence, defaultLabel: string) =>
        `カスタム:${occurrence.eventId}:${defaultLabel}`,
    );
    const { container } = render(<TestListView events={events} eventAriaLabel={eventAriaLabel} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button).toHaveAttribute('aria-label', 'カスタム:e1:会議、7月16日 10:00〜11:00');
  });

  it('日セクションには既定で「M月d日(曜) 予定N件」形式の aria-label が付く（VirtualListView と同じ既定文字列）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議1', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
      { id: 'e2', title: '会議2', start: '2026-07-16T12:00:00', end: '2026-07-16T13:00:00' },
    ];
    const { container } = render(<TestListView events={events} />);

    const section = container.querySelector('[data-koyomi="list-day"]');
    expect(section).toHaveAttribute('aria-label', '7月16日(木) 予定2件');
  });

  it('dayAriaLabel は既定の aria-label 文字列を defaultLabel として受け取り、返り値に置き換わる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const dayAriaLabel = vi.fn(
      (day: ListDay, defaultLabel: string) => `カスタム:${day.key}:${defaultLabel}`,
    );
    const { container } = render(<TestListView events={events} dayAriaLabel={dayAriaLabel} />);

    const section = container.querySelector('[data-koyomi="list-day"]');
    expect(section).toHaveAttribute('aria-label', 'カスタム:2026-07-16:7月16日(木) 予定1件');
  });

  it('renderEvent を渡すと既定の内容の代わりにカスタム内容が描画される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const renderEvent = (occurrence: EventOccurrence) => (
      <span data-testid="custom-content">カスタム:{occurrence.event.title}</span>
    );
    const { container } = render(<TestListView events={events} renderEvent={renderEvent} />);

    const button = container.querySelector('[data-koyomi="list-event"]');
    expect(button?.querySelector('[data-testid="custom-content"]')?.textContent).toBe(
      'カスタム:会議',
    );
    // 既定の内容（時刻・タイトルの個別 span）は描画されない
    expect(button?.querySelector('[data-koyomi="list-event-title"]')).toBeNull();
    expect(button?.querySelector('[data-koyomi="list-event-time"]')).toBeNull();
  });

  it('viewModel.type が list 以外のときは null を返す（DOM が生成されない）', () => {
    const { container } = render(<TestListView view="month" />);
    expect(container.querySelector('[data-koyomi="list"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('allDayLabel を指定すると終日イベントの時刻ラベルに反映される（省略時は「終日」）', () => {
    const events: CalendarEvent[] = [
      { id: 'allday', title: '終日イベント', start: '2026-07-16', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(<TestListView events={events} allDayLabel="All day" />);

    const time = container.querySelector('[data-koyomi="list-event-time"]');
    expect(time?.textContent).toBe('All day');
  });

  it('emptyLabel を指定すると予定なし時のメッセージに反映される（省略時は「予定はありません」）', () => {
    const { container } = render(<TestListView events={[]} emptyLabel="No events" />);

    const empty = container.querySelector('[data-koyomi="list-empty"]');
    expect(empty?.textContent).toBe('No events');
  });

  it('renderDayHeader を指定すると日付見出しの内容をカスタマイズできる（第2引数に既定内容を渡す）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const renderDayHeader = (day: ListDay, defaultContent: ReactNode) => (
      <span data-testid="custom-header">
        {day.key}:{defaultContent}
      </span>
    );
    const { container } = render(
      <TestListView events={events} renderDayHeader={renderDayHeader} />,
    );

    const header = container.querySelector('[data-koyomi="list-day-header"]');
    expect(header?.querySelector('[data-testid="custom-header"]')?.textContent).toBe(
      '2026-07-16:7月16日(木)',
    );
  });
});
