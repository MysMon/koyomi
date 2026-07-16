/**
 * year-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` / `CalendarProvider` を通した結合テストとして、
 * `container.querySelector('[data-koyomi="..."]')` で DOM 仕様を検証する。
 */
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarApi,
  CalendarEvent,
  CalendarViewType,
  YearDay,
  YearMonth,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type { CalendarInteractionCallbacks } from '../types';
import { useCalendar } from '../use-calendar';
import { YearView } from './year-view';

/** テストで使う表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** 「現在時刻」として固定する日時（東京では 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** `YearView` を `CalendarProvider` 配下で描画するテスト用ラッパ。 */
function Harness(props: {
  events?: readonly CalendarEvent[];
  initialView?: CalendarViewType;
  callbacks?: CalendarInteractionCallbacks;
  renderMonthHeader?: (month: YearMonth, defaultContent: ReactNode) => ReactNode;
  renderDayCell?: (day: YearDay, defaultContent: ReactNode) => ReactNode;
  messages?: MessageCatalogOverrides;
  apiRef?: { current: CalendarApi | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'year',
    events: props.events ?? EMPTY_EVENTS,
  });
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
    >
      <YearView
        {...(props.renderMonthHeader !== undefined
          ? { renderMonthHeader: props.renderMonthHeader }
          : {})}
        {...(props.renderDayCell !== undefined ? { renderDayCell: props.renderDayCell } : {})}
      />
    </CalendarProvider>
  );
}

/** 指定した月セクション（`data-koyomi-month`）を取得する。 */
function monthSection(container: HTMLElement, monthKey: string): HTMLElement {
  const section = container.querySelector(`[data-koyomi-month="${monthKey}"]`);
  if (!(section instanceof HTMLElement)) {
    throw new Error(`月セクションが見つかりません: ${monthKey}`);
  }
  return section;
}

/** 指定した月セクション内から日セルボタン（`data-koyomi-date`）を取得する。 */
function dayButton(section: HTMLElement, dateKey: string): HTMLElement {
  const button = section.querySelector(`[data-koyomi-date="${dateKey}"]`);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`日セルボタンが見つかりません: ${dateKey}`);
  }
  return button;
}

describe('YearView - viewModel ガード', () => {
  it('viewModel.type が year 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" />);
    expect(container.querySelector('[data-koyomi="year"]')).toBeNull();
  });

  it('viewModel.type が year のときは data-koyomi="year" のルートを描画する', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-koyomi="year"]')).not.toBeNull();
  });
});

describe('YearView - DOM 構造（2026 年・東京）', () => {
  it('12 ヶ月分の data-koyomi="year-month" セクションが month キー順に描画される', () => {
    const { container } = render(<Harness />);
    const sections = container.querySelectorAll('[data-koyomi="year-month"]');
    expect(sections).toHaveLength(12);
    expect(
      Array.from(sections).map((section) => section.getAttribute('data-koyomi-month')),
    ).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('各月に月見出し・曜日ヘッダー・ARIA grid が描画される', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    expect(july.querySelector('[data-koyomi="year-month-title"]')?.textContent).toBe('7月');
    expect(july.querySelectorAll('[data-koyomi="year-weekday"]')).toHaveLength(7);
    expect(july.querySelector('[data-koyomi="year-month-grid"]')).toHaveAttribute('role', 'grid');
    const weekdayHeader = july.querySelector('[data-koyomi="year-weekdays"]');
    expect(weekdayHeader).toHaveAttribute('role', 'row');
    expect(july.querySelector('[data-koyomi="year-weekday"]')).toHaveAttribute(
      'role',
      'columnheader',
    );
  });

  it('日セルは role="gridcell" の中の button[data-koyomi="year-day"] になる', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    const cell = july
      .querySelector('[data-koyomi-date="2026-07-10"]')
      ?.closest('[data-koyomi="year-day-cell"]');
    expect(cell).toHaveAttribute('role', 'gridcell');
    const button = dayButton(july, '2026-07-10');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('data-koyomi', 'year-day');
  });

  it('2026 年（週開始=日曜）は全月合計 427 セル（61 週 × 7 日）で構成される', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('[data-koyomi="year-day"]')).toHaveLength(427);
  });

  it('7 月セクションは 5 週 × 7 日 = 35 セルで構成される', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    expect(july.querySelectorAll('[data-koyomi="year-day"]')).toHaveLength(35);
  });
});

describe('YearView - today / 前後月セル', () => {
  it('今日（7/15）のボタンに data-today と aria-current="date" が付く', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    const today = dayButton(july, '2026-07-15');
    expect(today).toHaveAttribute('data-today', 'true');
    expect(today).toHaveAttribute('aria-current', 'date');

    const other = dayButton(july, '2026-07-14');
    expect(other).not.toHaveAttribute('data-today');
    expect(other).not.toHaveAttribute('aria-current');
  });

  it('7 月グリッドの前月セル（6/28）は data-outside が付く', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    const outside = dayButton(july, '2026-06-28');
    expect(outside).toHaveAttribute('data-outside', 'true');

    const june = monthSection(container, '2026-06');
    const inMonth = dayButton(june, '2026-06-28');
    expect(inMonth).not.toHaveAttribute('data-outside');
  });
});

describe('YearView - 予定件数の表示', () => {
  it('予定がある日には data-has-events・件数マーカー・aria-label の件数が付く', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-10T09:00', end: '2026-07-10T09:30' },
    ];
    const { container } = render(<Harness events={events} />);
    const july = monthSection(container, '2026-07');
    const button = dayButton(july, '2026-07-10');

    expect(button).toHaveAttribute('data-has-events', 'true');
    expect(button.querySelector('[data-koyomi="year-day-count"]')).not.toBeNull();
    expect(button).toHaveAttribute('aria-label', '7月10日 予定1件');
  });

  it('密度マーカーは件数によらず同一の表示になる（1 件の日と 100 件の日で DOM が一致し、件数の数字を含まない）', () => {
    const events: CalendarEvent[] = [
      { id: 'one', title: '単発', start: '2026-07-10T09:00', end: '2026-07-10T10:00' },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `many-${i}`,
        title: `予定${i}`,
        start: '2026-07-20T09:00',
        end: '2026-07-20T09:30',
      })),
    ];
    const { container } = render(<Harness events={events} />);
    const july = monthSection(container, '2026-07');
    const oneMarker = dayButton(july, '2026-07-10').querySelector('[data-koyomi="year-day-count"]');
    const manyMarker = dayButton(july, '2026-07-20').querySelector(
      '[data-koyomi="year-day-count"]',
    );

    expect(oneMarker).not.toBeNull();
    expect(manyMarker).not.toBeNull();
    // 二値表示: マーカーの DOM は件数 1 件と 100 件で完全に同一（件数のテキストを持たない）
    expect(manyMarker?.outerHTML).toBe(oneMarker?.outerHTML);
    expect(manyMarker?.textContent).toBe('');
  });

  it('予定がない日には data-has-events が付かず、aria-label に件数が含まれない', () => {
    const { container } = render(<Harness />);
    const july = monthSection(container, '2026-07');
    const button = dayButton(july, '2026-07-11');

    expect(button).not.toHaveAttribute('data-has-events');
    expect(button.querySelector('[data-koyomi="year-day-count"]')).toBeNull();
    expect(button).toHaveAttribute('aria-label', '7月11日');
  });

  it('messages.year.dayAriaLabel をオーバーライドすると件数文言込みの aria-label 全体をカスタマイズできる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-10T09:00', end: '2026-07-10T09:30' },
    ];
    const dayAriaLabelWithCustomCount = vi.fn((day: YearDay, dateLabel: string) =>
      day.eventCount > 0 ? `${dateLabel} ${day.eventCount} events` : dateLabel,
    );
    const { container } = render(
      <Harness
        events={events}
        messages={{ year: { dayAriaLabel: dayAriaLabelWithCustomCount } }}
      />,
    );
    const july = monthSection(container, '2026-07');

    expect(dayButton(july, '2026-07-10')).toHaveAttribute('aria-label', '7月10日 1 events');
    expect(dayButton(july, '2026-07-11')).toHaveAttribute('aria-label', '7月11日');
  });

  it('messages.year.dayAriaLabel は整形済みの日付ラベル（dateLabel）を受け取り、返り値がそのまま aria-label になる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-10T09:00', end: '2026-07-10T09:30' },
    ];
    const dayAriaLabel = vi.fn(
      (day: YearDay, dateLabel: string) => `カスタム:${day.key}:${dateLabel}`,
    );
    const { container } = render(<Harness events={events} messages={{ year: { dayAriaLabel } }} />);
    const july = monthSection(container, '2026-07');

    expect(dayButton(july, '2026-07-10')).toHaveAttribute(
      'aria-label',
      'カスタム:2026-07-10:7月10日',
    );
  });

  it('前後月セル（data-outside）は実際の予定件数に関わらず件数マーカーを出さない', () => {
    // 6/28 に予定を配置。6 月自身のセルでは件数マーカーが出るが、
    // 7 月グリッドの前月セル（6/28、data-outside）では出ない
    const events: CalendarEvent[] = [
      { id: 'e1', title: '前月イベント', start: '2026-06-28T09:00', end: '2026-06-28T10:00' },
    ];
    const { container } = render(<Harness events={events} />);

    const june = monthSection(container, '2026-06');
    const inMonthButton = dayButton(june, '2026-06-28');
    expect(inMonthButton).toHaveAttribute('data-has-events', 'true');
    expect(inMonthButton.querySelector('[data-koyomi="year-day-count"]')).not.toBeNull();
    expect(inMonthButton).toHaveAttribute('aria-label', '6月28日 予定1件');

    const july = monthSection(container, '2026-07');
    const outsideButton = dayButton(july, '2026-06-28');
    expect(outsideButton).not.toHaveAttribute('data-has-events');
    expect(outsideButton.querySelector('[data-koyomi="year-day-count"]')).toBeNull();
    expect(outsideButton).toHaveAttribute('aria-label', '6月28日');
  });
});

describe('YearView - クリック操作', () => {
  it('日セルクリックで day ビューに切り替わり、その日へ goTo される', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);
    const july = monthSection(container, '2026-07');
    const button = dayButton(july, '2026-07-10');

    fireEvent.click(button);

    expect(apiRef.current?.getState().view).toBe('day');
    expect(apiRef.current?.getState().currentDate.getTime()).toBe(
      new Date('2026-07-09T15:00:00Z').getTime(), // 2026-07-10 0:00 JST
    );
  });

  it('前後月セル（data-outside）クリックでも同じ日付ナビゲーションが働く', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);
    const july = monthSection(container, '2026-07');
    const outsideButton = dayButton(july, '2026-06-28');

    fireEvent.click(outsideButton);

    expect(apiRef.current?.getState().view).toBe('day');
    expect(apiRef.current?.getState().currentDate.getTime()).toBe(
      new Date('2026-06-27T15:00:00Z').getTime(), // 2026-06-28 0:00 JST
    );
  });

  it('onDayNumberClick が指定されていればそれが呼ばれ、既定の画面遷移は行われない', () => {
    const onDayNumberClick = vi.fn();
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness callbacks={{ onDayNumberClick }} apiRef={apiRef} />);
    const july = monthSection(container, '2026-07');
    const button = dayButton(july, '2026-07-10');

    fireEvent.click(button);

    expect(onDayNumberClick).toHaveBeenCalledTimes(1);
    expect(onDayNumberClick.mock.calls[0]?.[0]?.getTime()).toBe(
      new Date('2026-07-09T15:00:00Z').getTime(), // 2026-07-10 0:00 JST
    );
    expect(apiRef.current?.getState().view).toBe('year');
  });
});

describe('YearView - カスタム描画 props', () => {
  it('renderMonthHeader で月見出しの内容を差し替えられる', () => {
    const { container } = render(
      <Harness
        renderMonthHeader={(month, defaultContent) => (
          <div data-koyomi="custom-month-header">
            CUSTOM:{month.key}
            {defaultContent}
          </div>
        )}
      />,
    );
    const july = monthSection(container, '2026-07');
    const custom = july.querySelector('[data-koyomi="custom-month-header"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe('CUSTOM:2026-077月');
  });

  it('renderDayCell で日セルボタンの内容を差し替えられる', () => {
    const { container } = render(
      <Harness
        renderDayCell={(day, defaultContent) => (
          <span data-koyomi="custom-day-cell">
            CUSTOM:{day.key}
            {defaultContent}
          </span>
        )}
      />,
    );
    const july = monthSection(container, '2026-07');
    const button = dayButton(july, '2026-07-10');
    const custom = button.querySelector('[data-koyomi="custom-day-cell"]');
    expect(custom).not.toBeNull();
    // 日番号ラベルは Intl（ja ロケール）の仕様で '10日' になる（month-view.tsx の
    // formatDayNumberLabel と同じ書式オプション由来）
    expect(custom?.textContent).toBe('CUSTOM:2026-07-1010日');
  });
});
