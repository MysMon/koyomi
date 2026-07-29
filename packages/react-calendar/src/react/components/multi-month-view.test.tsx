/**
 * multi-month-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` / `CalendarProvider` を通した結合テストとして、
 * `container.querySelector('[data-koyomi="..."]')` で DOM 仕様を検証する
 * （`month-view.test.tsx` と同じ流儀）。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarApi,
  CalendarEvent,
  CalendarViewType,
  EventOccurrence,
  EventSegment,
  MonthDay,
  Weekday,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type {
  CalendarInteractionCallbacks,
  EventContentContext,
  EventContentRenderer,
  MonthOverflowButtonProps,
  MonthOverflowLabelContext,
  SlotRenderContext,
} from '../types';
import { useCalendar } from '../use-calendar';
import { MultiMonthView } from './multi-month-view';

// jsdom はこの環境で document.elementFromPoint を実装していない（typeof が 'undefined'）。
// useDayDrag は移動ドラッグ中に時間グリッドへの変換判定でこれを参照するため、
// 未実装環境向けの既定実装（常に null＝時間グリッド外）を用意する
// （use-day-drag.test.tsx と同じ対策）。
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

/** テストで使う表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** 「現在時刻」として固定する日時（東京では 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** `MultiMonthView` を `CalendarProvider` 配下で描画するテスト用ラッパ。 */
function Harness(props: {
  events?: readonly CalendarEvent[];
  initialView?: CalendarViewType;
  callbacks?: CalendarInteractionCallbacks;
  dayMaxEvents?: number;
  hiddenWeekdays?: readonly Weekday[];
  showWeekNumbers?: boolean;
  multiMonthCount?: number;
  renderEvent?: (segment: EventSegment, ctx: EventContentContext) => ReactElement;
  renderDayCell?: (day: MonthDay, ctx: SlotRenderContext) => ReactNode;
  renderEventContent?: EventContentRenderer;
  overflowButtonProps?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
  renderOverflowLabel?: (day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode;
  messages?: MessageCatalogOverrides;
  apiRef?: { current: CalendarApi | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'multiMonth',
    events: props.events ?? EMPTY_EVENTS,
    // exactOptionalPropertyTypes 下では、値が undefined になり得るプロパティを
    // そのままキーに設定できない（省略とキー存在+undefinedが区別される）ため、
    // 未指定時はキー自体を省く（month-view.test.tsx の Harness と同じ方針）
    ...(props.dayMaxEvents !== undefined ? { dayMaxEvents: props.dayMaxEvents } : {}),
    ...(props.hiddenWeekdays !== undefined ? { hiddenWeekdays: props.hiddenWeekdays } : {}),
    ...(props.showWeekNumbers !== undefined ? { showWeekNumbers: props.showWeekNumbers } : {}),
    ...(props.multiMonthCount !== undefined ? { multiMonthCount: props.multiMonthCount } : {}),
  });
  // apiRef 経由でテストから calendar.api を直接参照できるようにする
  // （month-view.test.tsx の Harness と同じ方針）。
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
      {...(props.renderEventContent !== undefined
        ? { renderEventContent: props.renderEventContent }
        : {})}
    >
      <MultiMonthView
        {...(props.renderEvent !== undefined ? { renderEvent: props.renderEvent } : {})}
        {...(props.renderDayCell !== undefined ? { renderDayCell: props.renderDayCell } : {})}
        {...(props.overflowButtonProps !== undefined
          ? { overflowButtonProps: props.overflowButtonProps }
          : {})}
        {...(props.renderOverflowLabel !== undefined
          ? { renderOverflowLabel: props.renderOverflowLabel }
          : {})}
      />
    </CalendarProvider>
  );
}

/** 指定した DOM 要素の `getBoundingClientRect` を固定の矩形にモックする。 */
function mockRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

describe('MultiMonthView - type ガード', () => {
  it('viewModel.type が multiMonth 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" />);
    expect(container.querySelector('[data-koyomi="multimonth"]')).toBeNull();
  });
});

describe('MultiMonthView - 月数と DOM 構造', () => {
  it('既定（multiMonthCount=3）で multimonth-month が 3 つ、月キー・見出しが月順に対応する', () => {
    const { container } = render(<Harness />);
    const sections = container.querySelectorAll('[data-koyomi="multimonth-month"]');
    expect(sections).toHaveLength(3);
    expect(Array.from(sections).map((el) => el.getAttribute('data-koyomi-month'))).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);

    const titles = container.querySelectorAll('[data-koyomi="multimonth-title"]');
    expect(Array.from(titles).map((el) => el.textContent)).toEqual([
      '2026年7月',
      '2026年8月',
      '2026年9月',
    ]);

    // 各月に role="grid" の月グリッドが 1 つずつ、月ビューと同じ内部構造で存在する
    expect(container.querySelectorAll('[data-koyomi="month"][role="grid"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="month-weekdays"]')).toHaveLength(3);
  });

  it('ルート要素に --koyomi-month-lanes が dayMaxEvents の値で inline 設定される（月ビューと同じ方式）', () => {
    const { container } = render(<Harness dayMaxEvents={6} />);
    const root = container.querySelector('[data-koyomi="multimonth"]');
    expect(root?.getAttribute('style')).toContain('--koyomi-month-lanes: 6');
  });

  it('multiMonthCount=1 では 1 ヶ月分のみ描画される', () => {
    const { container } = render(<Harness multiMonthCount={1} />);
    expect(container.querySelectorAll('[data-koyomi="multimonth-month"]')).toHaveLength(1);
    expect(
      container
        .querySelector('[data-koyomi="multimonth-month"]')
        ?.getAttribute('data-koyomi-month'),
    ).toBe('2026-07');
  });

  it('multiMonthCount=12 では 12 ヶ月分描画され、年をまたいで月キーが連続する', () => {
    const { container } = render(<Harness multiMonthCount={12} />);
    const sections = container.querySelectorAll('[data-koyomi="multimonth-month"]');
    expect(sections).toHaveLength(12);
    expect(sections[0]?.getAttribute('data-koyomi-month')).toBe('2026-07');
    expect(sections[11]?.getAttribute('data-koyomi-month')).toBe('2027-06');
  });
});

describe('MultiMonthView - 前後月セルの非インタラクティブ性', () => {
  it('前後月セルは data-koyomi-date・tabIndex を持たず、当月セルはインタラクティブなまま', () => {
    const { container } = render(<Harness multiMonthCount={2} />);
    const julySection = container.querySelector('[data-koyomi-month="2026-07"]');
    const augustSection = container.querySelector('[data-koyomi-month="2026-08"]');
    if (!(julySection instanceof HTMLElement) || !(augustSection instanceof HTMLElement)) {
      throw new Error('月セクションが見つかりません');
    }

    // 7 月グリッドの当月セル（7/1）はインタラクティブ
    const julyDay1 = julySection.querySelector('[data-koyomi-date="2026-07-01"]');
    expect(julyDay1).toBeInstanceOf(HTMLElement);
    expect(julyDay1).toHaveAttribute('tabIndex', '0');

    // 7 月グリッドの前後月セル（8/1、trailing）は data-outside は立つが、
    // data-koyomi-date・tabIndex を持たない（非インタラクティブ）
    const julyTrailingCells = Array.from(
      julySection.querySelectorAll('[data-koyomi="month-day"]'),
    ).filter((el) => el.getAttribute('aria-label') === '2026年8月1日');
    expect(julyTrailingCells).toHaveLength(1);
    expect(julyTrailingCells[0]).toHaveAttribute('data-outside', 'true');
    expect(julyTrailingCells[0]).not.toHaveAttribute('data-koyomi-date');
    expect(julyTrailingCells[0]).not.toHaveAttribute('tabIndex');

    // 8 月グリッドの前後月セル（7/31、leading）も同様に非インタラクティブ
    const augustLeadingCells = Array.from(
      augustSection.querySelectorAll('[data-koyomi="month-day"]'),
    ).filter((el) => el.getAttribute('aria-label') === '2026年7月31日');
    expect(augustLeadingCells).toHaveLength(1);
    expect(augustLeadingCells[0]).toHaveAttribute('data-outside', 'true');
    expect(augustLeadingCells[0]).not.toHaveAttribute('data-koyomi-date');
    expect(augustLeadingCells[0]).not.toHaveAttribute('tabIndex');

    // 全体で見ても、7/31・8/1 それぞれ data-koyomi-date を持つセルは 1 箇所だけ
    // （同じ日付が前後月セルとして重複して現れる側は登録されない）
    expect(container.querySelectorAll('[data-koyomi-date="2026-07-31"]')).toHaveLength(1);
    expect(julySection.querySelector('[data-koyomi-date="2026-07-31"]')).toBeInstanceOf(
      HTMLElement,
    );
    expect(container.querySelectorAll('[data-koyomi-date="2026-08-01"]')).toHaveLength(1);
    expect(augustSection.querySelector('[data-koyomi-date="2026-08-01"]')).toBeInstanceOf(
      HTMLElement,
    );
  });

  it('前後月の日付セルが「今日」と一致する場合、非インタラクティブでも data-today と aria-current="date" が付く', () => {
    // data-today / aria-current="date" は interactiveOutsideDays に関わらず付与されるため、
    // 前後月の日付セル（data-outside）がたまたま「今日」と一致する場合も、他の可視日と
    // 同様に aria-current="date" が付く。
    // 2026-08 のミニ月グリッドの前月はみ出し部分（7/26〜7/31 あたり）に「今日」を置く。
    // 東京 2026-07-31 を「今日」とし、2 ヶ月表示にして 8 月グリッドの前月セルとして
    // 7/31 が現れるようにする。
    const todayNow = new Date('2026-07-31T01:00:00Z'); // 東京 7/31 10:00
    function TodayOutsideHarness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => todayNow,
        initialDate: todayNow,
        initialView: 'multiMonth',
        multiMonthCount: 2,
        events: EMPTY_EVENTS,
      });
      return (
        <CalendarProvider value={calendar}>
          <MultiMonthView />
        </CalendarProvider>
      );
    }
    const { container } = render(<TodayOutsideHarness />);
    // 2 つ目の月グリッド（8 月）の前月はみ出しセルのうち、日番号ボタンのテキストが
    // '31' のものを探す（非インタラクティブセルは data-koyomi-date を持たないため、
    // month セクション単位で絞り込む）。
    const months = container.querySelectorAll('[data-koyomi="multimonth-month"]');
    expect(months).toHaveLength(2);
    const augustSection = months[1];
    const outsideCells = augustSection?.querySelectorAll('[data-koyomi="month-day"][data-outside]');
    const todayOutsideCell = Array.from(outsideCells ?? []).find((cell) =>
      cell.hasAttribute('data-today'),
    );
    expect(todayOutsideCell).toBeDefined();
    expect(todayOutsideCell).toHaveAttribute('aria-current', 'date');
    // 非インタラクティブであることも合わせて確認する（tabIndex なし・data-koyomi-date なし）
    expect(todayOutsideCell).not.toHaveAttribute('tabindex');
    expect(todayOutsideCell).not.toHaveAttribute('data-koyomi-date');
  });
});

describe('MultiMonthView - 月境界をまたぐ帯', () => {
  it('月境界をまたぐイベントは両月にクランプされて現れ、continuesBefore/After が立つ', () => {
    const events: CalendarEvent[] = [
      { id: 'boundary', title: '越境', start: '2026-07-31T09:00', end: '2026-08-01T18:00' },
    ];
    const { container } = render(<Harness events={events} multiMonthCount={2} />);
    const julySection = container.querySelector('[data-koyomi-month="2026-07"]');
    const augustSection = container.querySelector('[data-koyomi-month="2026-08"]');
    if (!(julySection instanceof HTMLElement) || !(augustSection instanceof HTMLElement)) {
      throw new Error('月セクションが見つかりません');
    }

    const julySegments = julySection.querySelectorAll('[data-koyomi="month-event"]');
    expect(julySegments).toHaveLength(1);
    expect(julySegments[0]).not.toHaveAttribute('data-continues-before');
    expect(julySegments[0]).toHaveAttribute('data-continues-after', 'true');

    const augustSegments = augustSection.querySelectorAll('[data-koyomi="month-event"]');
    expect(augustSegments).toHaveLength(1);
    expect(augustSegments[0]).toHaveAttribute('data-continues-before', 'true');
    expect(augustSegments[0]).not.toHaveAttribute('data-continues-after');

    // 全体でもこのオカレンスのセグメントは 2 本のみ（両月に 1 本ずつ）
    expect(container.querySelectorAll('[data-koyomi="month-event"]')).toHaveLength(2);
  });
});

describe('MultiMonthView - カスタム描画 props', () => {
  it('renderEvent でセグメントの内容をカスタマイズできる（ctx から既定内容とパーツを参照できる）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        renderEvent={(_segment, ctx) => (
          <span>
            {ctx.slot}|{ctx.parts.timeText}|{ctx.defaultContent}
          </span>
        )}
      />,
    );
    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment?.textContent).toBe('month-event|9:00|9:00 朝会');
  });

  it('CalendarProvider の renderEventContent が複数月ビューの帯にも適用される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        renderEventContent={(_occurrence, ctx) => <>中央:{ctx.defaultContent}</>}
      />,
    );
    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment?.textContent).toBe('中央:9:00 朝会');
  });

  it('messages.common.eventAriaLabel をオーバーライドするとイベントセグメントの aria-label が変わる（省略時は既定文字列のまま）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container: withoutOverride } = render(<Harness events={events} />);
    expect(
      withoutOverride.querySelector('[data-koyomi="month-event"]')?.getAttribute('aria-label'),
    ).toBe('朝会、7月8日 9:00〜9:30');

    const eventAriaLabel = vi.fn(
      (_occurrence: EventOccurrence, parts: { rangeLabel: string; resourceLabel?: string }) =>
        `カスタム:${parts.rangeLabel}`,
    );
    const { container } = render(
      <Harness events={events} messages={{ common: { eventAriaLabel } }} />,
    );
    expect(eventAriaLabel).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1' }), {
      rangeLabel: '7月8日 9:00〜9:30',
    });
    expect(container.querySelector('[data-koyomi="month-event"]')).toHaveAttribute(
      'aria-label',
      'カスタム:7月8日 9:00〜9:30',
    );
  });

  it('messages.multiMonth.overflow で「+N 件」の文言をカスタマイズできる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        dayMaxEvents={1}
        messages={{ multiMonth: { overflow: (count) => `他${count}件` } }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton?.textContent).toBe('他1件');
  });

  it('複数月ビューでも「+N 件」ボタンは MonthView と同じ絶対配置の inline style を持つ（実装共有の確認）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(<Harness events={events} dayMaxEvents={1} />);
    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).toBeInstanceOf(HTMLElement);
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    // 2026-07-08（水）は週開始=日曜で 4 列目（dayCol=3）、可視列数は 7
    expect(overflowButton.style.position).toBe('absolute');
    expect(overflowButton.style.insetInlineStart).toBe(`${(3 / 7) * 100}%`);
    expect(overflowButton.style.width).toBe(`${(1 / 7) * 100}%`);
    expect(overflowButton.style.bottom).toBe('0px');
  });

  it('renderDayCell で日セルの内容を拡張できる（既定内容は ctx.defaultContent でそのまま利用可能）', () => {
    const { container } = render(
      <Harness
        renderDayCell={(day, ctx) => (
          <div data-testid={`custom-${day.key}`}>{ctx.defaultContent}</div>
        )}
      />,
    );
    const customCell = container.querySelector('[data-testid="custom-2026-07-01"]');
    expect(customCell).toBeInstanceOf(HTMLElement);
    expect(customCell?.querySelector('[data-koyomi="month-day-number"]')).toBeInstanceOf(
      HTMLElement,
    );
  });
});

describe('MultiMonthView - ドラッグによる月またぎ移動', () => {
  it('7/31 のセグメントを 8/5 の当月セルへドラッグすると、単一の dayDrag レジストリで解決され onEventChange が発火する', () => {
    const events: CalendarEvent[] = [
      { id: 'boundary', title: '越境', start: '2026-07-31T09:00', end: '2026-07-31T10:00' },
    ];
    const onEventChange = vi.fn();
    const { container } = render(
      <Harness events={events} multiMonthCount={2} callbacks={{ onEventChange }} />,
    );

    const julySection = container.querySelector('[data-koyomi-month="2026-07"]');
    const augustSection = container.querySelector('[data-koyomi-month="2026-08"]');
    if (!(julySection instanceof HTMLElement) || !(augustSection instanceof HTMLElement)) {
      throw new Error('月セクションが見つかりません');
    }

    const originCell = julySection.querySelector('[data-koyomi-date="2026-07-31"]');
    const destCell = augustSection.querySelector('[data-koyomi-date="2026-08-05"]');
    if (!(originCell instanceof HTMLElement) || !(destCell instanceof HTMLElement)) {
      throw new Error('セル要素が見つかりません');
    }
    mockRect(originCell, { left: 0, top: 0, width: 100, height: 50 });
    mockRect(destCell, { left: 1000, top: 0, width: 100, height: 50 });

    const segment = julySection.querySelector('[data-koyomi="month-event"]');
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    act(() => {
      segment.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 50, clientY: 25, button: 0, bubbles: true }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 1050, clientY: 25, bubbles: true }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent('pointerup', { clientX: 1050, clientY: 25, bubbles: true }),
      );
    });

    expect(onEventChange).toHaveBeenCalledTimes(1);
    const change = onEventChange.mock.calls[0]?.[0];
    expect(change?.occurrence.eventId).toBe('boundary');
    expect(change?.newRange.start.getTime()).toBe(new Date('2026-08-05T09:00').getTime());
    expect(change?.newRange.end.getTime()).toBe(new Date('2026-08-05T10:00').getTime());
  });
});

describe('MultiMonthView - ドラッグプレビューの選択帯', () => {
  it('dragPreview.invalid: true のとき day-selection に data-koyomi-invalid="true" が付与される', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);

    act(() => {
      apiRef.current?.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-07-07T15:00:00Z'), // 2026-07-08 0:00 JST
          end: new Date('2026-07-08T15:00:00Z'), // 2026-07-09 0:00 JST
        },
        allDay: true,
        invalid: true,
      });
    });

    const selection = container.querySelector('[data-koyomi="day-selection"]');
    expect(selection).toHaveAttribute('data-koyomi-invalid', 'true');
  });
});

describe('MultiMonthView - クリック操作', () => {
  // month-view.test.tsx の「MonthView - クリック操作」と同じ 3 ケースを移植する
  // （goToDay / handleOverflowClick は MonthView と同型のロジック）。
  it('「+N 件」クリックで day ビューに切り替わり、その日へ goTo される（既定動作）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness events={events} dayMaxEvents={1} apiRef={apiRef} />);

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).toBeInstanceOf(HTMLElement);
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }

    fireEvent.click(overflowButton);

    expect(apiRef.current?.getState().view).toBe('day');
    expect(apiRef.current?.getState().currentDate.getTime()).toBe(
      new Date('2026-07-07T15:00:00Z').getTime(), // 2026-07-08 0:00 JST
    );
  });

  it('onOverflowClick が指定されていればそれが呼ばれ、既定の画面遷移は行われない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const onOverflowClick = vi.fn();
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(
      <Harness events={events} dayMaxEvents={1} callbacks={{ onOverflowClick }} apiRef={apiRef} />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    fireEvent.click(overflowButton);

    expect(onOverflowClick).toHaveBeenCalledTimes(1);
    expect(onOverflowClick.mock.calls[0]?.[0]?.key).toBe('2026-07-08');
    expect(apiRef.current?.getState().view).toBe('multiMonth');
  });

  it('onOverflowClick の第 3 引数（details）に表示中のオカレンス一覧が渡る（MonthView と同型のロジック）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
      { id: 'e3', title: 'C', start: '2026-07-08T11:00', end: '2026-07-08T11:30' },
    ];
    const onOverflowClick = vi.fn();
    const { container } = render(
      <Harness events={events} dayMaxEvents={1} callbacks={{ onOverflowClick }} />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    fireEvent.click(overflowButton);

    expect(onOverflowClick).toHaveBeenCalledTimes(1);
    const [, hiddenOccurrences, details] = onOverflowClick.mock.calls[0] as [
      MonthDay,
      readonly EventOccurrence[],
      { visibleOccurrences: readonly EventOccurrence[] },
    ];
    expect(hiddenOccurrences).toHaveLength(2);
    expect(details.visibleOccurrences).toHaveLength(1);
  });

  it('Enter キーで「+N 件」ボタンから onOverflowClick が発火する', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const onOverflowClick = vi.fn();
    const { container } = render(
      <Harness events={events} dayMaxEvents={1} callbacks={{ onOverflowClick }} />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    fireEvent.keyDown(overflowButton, { key: 'Enter' });

    expect(onOverflowClick).toHaveBeenCalledTimes(1);
  });

  it('renderOverflowLabel で「+N 件」の内容を差し替えられる（MonthView と同じ仕様）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        dayMaxEvents={1}
        renderOverflowLabel={(day, ctx) => (
          <span data-testid="custom-overflow">
            {day.key}|{ctx.hiddenOccurrences.length}|{ctx.defaultContent}
          </span>
        )}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton?.querySelector('[data-testid="custom-overflow"]')?.textContent).toBe(
      '2026-07-08|1|+1 件',
    );
  });

  it('overflowButtonProps を渡すと「+N 件」ボタンに aria-haspopup / aria-expanded が付与される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        dayMaxEvents={1}
        overflowButtonProps={() => ({ 'aria-haspopup': 'true', 'aria-expanded': true })}
      />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).toHaveAttribute('aria-haspopup', 'true');
    expect(overflowButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('日番号クリックで day ビューに切り替わり、その日へ goTo される', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);

    const dayCell = container.querySelector('[data-koyomi-date="2026-07-10"]');
    expect(dayCell).toBeInstanceOf(HTMLElement);
    if (!(dayCell instanceof HTMLElement)) {
      throw new Error('日セルが見つかりません');
    }
    const dayNumberButton = dayCell.querySelector('[data-koyomi="month-day-number"]');
    expect(dayNumberButton).toBeInstanceOf(HTMLElement);
    if (!(dayNumberButton instanceof HTMLElement)) {
      throw new Error('日番号ボタンが見つかりません');
    }

    fireEvent.click(dayNumberButton);

    expect(apiRef.current?.getState().view).toBe('day');
    expect(apiRef.current?.getState().currentDate.getTime()).toBe(
      new Date('2026-07-09T15:00:00Z').getTime(), // 2026-07-10 0:00 JST
    );
    // 日番号クリックはイベント作成を伴わない（pointerdown の伝播が止められている）
    expect(apiRef.current?.getEvents()).toHaveLength(0);
  });

  it('onDayNumberClick が指定されていればそれが呼ばれ、既定の画面遷移は行われない', () => {
    const onDayNumberClick = vi.fn();
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness callbacks={{ onDayNumberClick }} apiRef={apiRef} />);

    const dayCell = container.querySelector('[data-koyomi-date="2026-07-10"]');
    if (!(dayCell instanceof HTMLElement)) {
      throw new Error('日セルが見つかりません');
    }
    const dayNumberButton = dayCell.querySelector('[data-koyomi="month-day-number"]');
    if (!(dayNumberButton instanceof HTMLElement)) {
      throw new Error('日番号ボタンが見つかりません');
    }

    fireEvent.click(dayNumberButton);

    expect(onDayNumberClick).toHaveBeenCalledTimes(1);
    expect(onDayNumberClick.mock.calls[0]?.[0]?.getTime()).toBe(
      new Date('2026-07-09T15:00:00Z').getTime(), // 2026-07-10 0:00 JST
    );
    expect(apiRef.current?.getState().view).toBe('multiMonth');
  });
});

describe('MultiMonthView - showWeekNumbers（週番号）', () => {
  it('省略時（既定 false）は data-koyomi-week-number 属性が付かない', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('[data-koyomi-week-number]')).toHaveLength(0);
  });

  it('true にすると全月の各週行に data-koyomi-week-number 属性が付く（2026-07 は第27〜31週）', () => {
    const { container } = render(<Harness showWeekNumbers multiMonthCount={1} />);
    const weeks = container.querySelectorAll('[data-koyomi="month-week"]');
    expect(Array.from(weeks).map((week) => week.getAttribute('data-koyomi-week-number'))).toEqual([
      '27',
      '28',
      '29',
      '30',
      '31',
    ]);
  });
});
