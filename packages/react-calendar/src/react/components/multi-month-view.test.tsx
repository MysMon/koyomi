/**
 * multi-month-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` / `CalendarProvider` を通した結合テストとして、
 * `container.querySelector('[data-koyomi="..."]')` で DOM 仕様を検証する
 * （`month-view.test.tsx` と同じ流儀）。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarApi,
  CalendarEvent,
  CalendarViewType,
  EventSegment,
  MonthDay,
  Weekday,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks } from '../types';
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
  multiMonthCount?: number;
  renderEvent?: (segment: EventSegment) => ReactElement;
  overflowLabel?: (count: number) => ReactNode;
  renderDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
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
    ...(props.multiMonthCount !== undefined ? { multiMonthCount: props.multiMonthCount } : {}),
  });
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
    >
      <MultiMonthView
        {...(props.renderEvent !== undefined ? { renderEvent: props.renderEvent } : {})}
        {...(props.overflowLabel !== undefined ? { overflowLabel: props.overflowLabel } : {})}
        {...(props.renderDayCell !== undefined ? { renderDayCell: props.renderDayCell } : {})}
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
  it('renderEvent でセグメントの内容をカスタマイズできる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(
      <Harness
        events={events}
        renderEvent={(segment) => <span>CUSTOM:{segment.occurrence.event.title}</span>}
      />,
    );
    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment?.textContent).toBe('CUSTOM:朝会');
  });

  it('overflowLabel で「+N 件」の文言をカスタマイズできる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(
      <Harness events={events} dayMaxEvents={1} overflowLabel={(count) => `他${count}件`} />,
    );
    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton?.textContent).toBe('他1件');
  });

  it('renderDayCell で日セルの内容を拡張できる（既定内容はそのまま利用可能）', () => {
    const { container } = render(
      <Harness
        renderDayCell={(day, defaultContent) => (
          <div data-testid={`custom-${day.key}`}>{defaultContent}</div>
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
