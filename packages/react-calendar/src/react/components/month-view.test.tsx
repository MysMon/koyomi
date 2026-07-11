/**
 * month-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` / `CalendarProvider` を通した結合テストとして、
 * `container.querySelector('[data-koyomi="..."]')` で DOM 仕様を検証する。
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
import type { CalendarInteractionCallbacks, MonthOverflowButtonProps } from '../types';
import { useCalendar } from '../use-calendar';
import type { DayDragHandlers } from '../use-day-drag';
import { MonthView } from './month-view';
import type { MonthDayDragHandlers } from './month-view-parts';
import { useStableDayDrag } from './month-view-parts';

/** テストで使う表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** 「現在時刻」として固定する日時（東京では 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** `MonthView` を `CalendarProvider` 配下で描画するテスト用ラッパ。 */
function Harness(props: {
  events?: readonly CalendarEvent[];
  initialView?: CalendarViewType;
  callbacks?: CalendarInteractionCallbacks;
  dayMaxEvents?: number;
  hiddenWeekdays?: readonly Weekday[];
  showWeekNumbers?: boolean;
  renderEvent?: (segment: EventSegment) => ReactElement;
  overflowLabel?: (count: number) => ReactNode;
  renderDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
  overflowButtonProps?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
  apiRef?: { current: CalendarApi | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'month',
    events: props.events ?? EMPTY_EVENTS,
    // exactOptionalPropertyTypes 下では、値が undefined になり得るプロパティを
    // そのままキーに設定できない（省略とキー存在+undefinedが区別される）ため、
    // 未指定時はキー自体を省く
    ...(props.dayMaxEvents !== undefined ? { dayMaxEvents: props.dayMaxEvents } : {}),
    ...(props.hiddenWeekdays !== undefined ? { hiddenWeekdays: props.hiddenWeekdays } : {}),
    ...(props.showWeekNumbers !== undefined ? { showWeekNumbers: props.showWeekNumbers } : {}),
  });
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
    >
      <MonthView
        {...(props.renderEvent !== undefined ? { renderEvent: props.renderEvent } : {})}
        {...(props.overflowLabel !== undefined ? { overflowLabel: props.overflowLabel } : {})}
        {...(props.renderDayCell !== undefined ? { renderDayCell: props.renderDayCell } : {})}
        {...(props.overflowButtonProps !== undefined
          ? { overflowButtonProps: props.overflowButtonProps }
          : {})}
      />
    </CalendarProvider>
  );
}

describe('MonthView - グリッド構造', () => {
  it('2026年7月（東京）は5週×7日で描画され、data-koyomi-date/data-today/data-outsideが正しい', () => {
    const { container } = render(<Harness />);

    expect(container.querySelectorAll('[data-koyomi="month-week"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-koyomi="month-day"]')).toHaveLength(35);

    // 前月の日付（6/28）は data-outside が立つ
    const outsideDay = container.querySelector('[data-koyomi-date="2026-06-28"]');
    expect(outsideDay).toHaveAttribute('data-outside', 'true');

    // 当月の日（7/1）には data-outside が付かない
    const inMonthDay = container.querySelector('[data-koyomi-date="2026-07-01"]');
    expect(inMonthDay).not.toBeNull();
    expect(inMonthDay).not.toHaveAttribute('data-outside');

    // 「現在時刻」の日（7/15）には data-today が立つ
    const todayCell = container.querySelector('[data-koyomi-date="2026-07-15"]');
    expect(todayCell).toHaveAttribute('data-today', 'true');

    // それ以外の日には data-today が付かない
    const otherCell = container.querySelector('[data-koyomi-date="2026-07-14"]');
    expect(otherCell).not.toHaveAttribute('data-today');

    // 曜日ヘッダーは週開始（日曜）順で 7 件
    expect(container.querySelectorAll('[data-koyomi="month-weekday"]')).toHaveLength(7);
  });

  it('viewModel.type が month 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="week" />);
    expect(container.querySelector('[data-koyomi="month"]')).toBeNull();
  });

  it('前後月セル（data-outside）は当月セルと同様にインタラクティブである（tabIndex・data-koyomi-date を持つ）', () => {
    // 単体 MonthView は月ビューパーツ抽出後も interactiveOutsideDays=true 固定であり、
    // 前後月セルの getDayCellProps 呼び出し（tabIndex・data-koyomi-date の付与）は
    // 抽出前と完全に同一でなければならない
    const { container } = render(<Harness />);

    const outsideDay = container.querySelector('[data-koyomi-date="2026-06-28"]');
    expect(outsideDay).toHaveAttribute('data-outside', 'true');
    expect(outsideDay).toHaveAttribute('tabIndex', '0');

    const inMonthDay = container.querySelector('[data-koyomi-date="2026-07-01"]');
    expect(inMonthDay).not.toHaveAttribute('data-outside');
    expect(inMonthDay).toHaveAttribute('tabIndex', '0');
  });

  it('前後月セルの日番号クリックでも day ビューへ切り替わる（getDayCellProps 経由の登録に加え、日番号ボタン自体も従来どおり機能する）', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);

    const outsideDay = container.querySelector('[data-koyomi-date="2026-06-28"]');
    expect(outsideDay).toBeInstanceOf(HTMLElement);
    if (!(outsideDay instanceof HTMLElement)) {
      throw new Error('前月セルが見つかりません');
    }
    const dayNumberButton = outsideDay.querySelector('[data-koyomi="month-day-number"]');
    expect(dayNumberButton).toBeInstanceOf(HTMLElement);
    if (!(dayNumberButton instanceof HTMLElement)) {
      throw new Error('日番号ボタンが見つかりません');
    }

    fireEvent.click(dayNumberButton);

    expect(apiRef.current?.getState().view).toBe('day');
    expect(apiRef.current?.getState().currentDate.getTime()).toBe(
      new Date('2026-06-27T15:00:00Z').getTime(), // 2026-06-28 0:00 JST
    );
  });
});

describe('MonthView - イベントセグメント', () => {
  it('単日の時間指定イベントが正しい data 属性・style・既定内容で描画される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(<Harness events={events} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    // 2026-07-08（水）は第2週の 4 列目（週開始=日曜、startCol=3）
    expect(segment.style.insetInlineStart).toBe(`${(3 / 7) * 100}%`);
    expect(segment.style.width).toBe(`${(1 / 7) * 100}%`);
    expect(segment).not.toHaveAttribute('data-all-day');
    expect(segment).not.toHaveAttribute('data-continues-before');
    expect(segment).not.toHaveAttribute('data-continues-after');
    // 単日・時間指定（span 1）は開始時刻＋タイトル
    expect(segment.textContent).toBe('9:00 朝会');
    expect(segment).toHaveAttribute('aria-label', '朝会、7月8日 9:00〜9:30');
  });

  it('renderEvent を渡すとセグメントの内容がカスタム描画になる', () => {
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

  it('複数日にまたがる時間指定イベントの aria-label に終了日が含まれる', () => {
    // 7/15 22:00 〜 7/17 2:00 JST の時間指定イベント（表示上は帯になる）
    const events: CalendarEvent[] = [
      { id: 'trip', title: '夜行', start: '2026-07-15T22:00', end: '2026-07-17T02:00' },
    ];
    const { container } = render(<Harness events={events} />);
    const segment = container.querySelector('[data-koyomi="month-event"]');
    const label = segment?.getAttribute('aria-label') ?? '';
    expect(label).toBe('夜行、7月15日 22:00〜7月17日 2:00');
  });

  it('終日イベントはタイトルのみを表示する', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '休暇', start: '2026-07-08', end: '2026-07-09', allDay: true },
    ];
    const { container } = render(<Harness events={events} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment?.textContent).toBe('休暇');
    expect(segment).toHaveAttribute('data-all-day', 'true');
    expect(segment).toHaveAttribute('aria-label', '休暇、7月8日');
  });

  it('週をまたぐ終日イベントは 2 つの週に分かれ、continues 属性が付く', () => {
    // 7/3(金)〜7/6(月, 排他的終了なので実際は 7/3〜7/5) にまたがる終日イベント。
    // 第1週(6/28〜7/4)と第2週(7/5〜7/11)に分割される
    const events: CalendarEvent[] = [
      { id: 'e2', title: '出張', start: '2026-07-03', end: '2026-07-06', allDay: true },
    ];
    const { container } = render(<Harness events={events} />);

    const segments = container.querySelectorAll('[data-koyomi="month-event"]');
    expect(segments).toHaveLength(2);

    const first = segments[0];
    const second = segments[1];
    expect(first).toHaveAttribute('data-continues-after', 'true');
    expect(first).not.toHaveAttribute('data-continues-before');
    expect(second).toHaveAttribute('data-continues-before', 'true');
    expect(second).not.toHaveAttribute('data-continues-after');
  });

  it('hidden セグメントは DOM に描画されない（dayMaxEvents 超過分）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
      { id: 'e3', title: 'C', start: '2026-07-08T11:00', end: '2026-07-08T11:30' },
    ];
    const { container } = render(<Harness events={events} dayMaxEvents={1} />);

    // 3 件中 1 件のみ表示され、2 件は「+2 件」に集約される
    expect(container.querySelectorAll('[data-koyomi="month-event"]')).toHaveLength(1);
    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).not.toBeNull();
    expect(overflowButton?.textContent).toBe('+2 件');
  });
});

describe('MonthView - クリック操作', () => {
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
    expect(apiRef.current?.getState().view).toBe('month');
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

  it('Space キーで「+N 件」ボタンから onOverflowClick が発火する', () => {
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
    fireEvent.keyDown(overflowButton, { key: ' ' });

    expect(onOverflowClick).toHaveBeenCalledTimes(1);
  });

  it('Enter キーでの発火でも既定動作（day ビュー遷移）が働く（onOverflowClick 未指定時）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness events={events} dayMaxEvents={1} apiRef={apiRef} />);

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    fireEvent.keyDown(overflowButton, { key: 'Enter' });

    expect(apiRef.current?.getState().view).toBe('day');
  });

  it('Enter キーでの発火は親の日セルへ伝播せず、onSelectRange や既定タイトルでのイベント作成が二重発火しない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const onOverflowClick = vi.fn();
    const onSelectRange = vi.fn();
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(
      <Harness
        events={events}
        dayMaxEvents={1}
        callbacks={{ onOverflowClick, onSelectRange }}
        apiRef={apiRef}
      />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    fireEvent.keyDown(overflowButton, { key: 'Enter' });

    expect(onOverflowClick).toHaveBeenCalledTimes(1);
    expect(onSelectRange).not.toHaveBeenCalled();
    // 親の日セルの onKeyDown（commitSelection）まで伝播すると、onSelectRange 未指定時は
    // 既定タイトルの終日イベントが作成されてしまう。伝播が止まっていればイベント数は不変。
    expect(apiRef.current?.getEvents()).toHaveLength(2);
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

  it('イベントクリックで callbacks.onEventClick がオカレンスを受け取る', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const onEventClick = vi.fn();
    const { container } = render(<Harness events={events} callbacks={{ onEventClick }} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    fireEvent.click(segment);

    expect(onEventClick).toHaveBeenCalledTimes(1);
    const occurrence = onEventClick.mock.calls[0]?.[0];
    expect(occurrence?.event.title).toBe('朝会');
  });
});

describe('MonthView - 帯セグメントのリサイズハンドル', () => {
  it('editable なセグメント（継続なし）は開始・終了の両端にリサイズハンドルを描画する', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(<Harness events={events} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    const startHandle = segment.querySelector(
      '[data-koyomi="month-event-resize"][data-edge="start"]',
    );
    const endHandle = segment.querySelector('[data-koyomi="month-event-resize"][data-edge="end"]');
    expect(startHandle).not.toBeNull();
    expect(endHandle).not.toBeNull();
    // getSegmentResizeHandleProps が返す data-koyomi-resize-handle 属性もそのまま反映される
    expect(startHandle).toHaveAttribute('data-koyomi-resize-handle', 'start');
    expect(endHandle).toHaveAttribute('data-koyomi-resize-handle', 'end');
  });

  it('editable: false のセグメントにはリサイズハンドルを描画しない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '祝日',
        start: '2026-07-08T09:00',
        end: '2026-07-08T09:30',
        editable: false,
      },
    ];
    const { container } = render(<Harness events={events} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment?.querySelector('[data-koyomi="month-event-resize"]')).toBeNull();
  });

  it('週をまたぐセグメントは continuesBefore/continuesAfter に応じて片側のハンドルのみ描画する', () => {
    // 第1週(6/28〜7/4)と第2週(7/5〜7/11)に分割される終日イベント（既存テストと同一条件）
    const events: CalendarEvent[] = [
      { id: 'e2', title: '出張', start: '2026-07-03', end: '2026-07-06', allDay: true },
    ];
    const { container } = render(<Harness events={events} />);

    const segments = container.querySelectorAll('[data-koyomi="month-event"]');
    expect(segments).toHaveLength(2);
    const first = segments[0];
    const second = segments[1];
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }

    // 第1週セグメント: continuesAfter=true → end 側ハンドルなし、start 側はある
    expect(
      first.querySelector('[data-koyomi="month-event-resize"][data-edge="start"]'),
    ).not.toBeNull();
    expect(first.querySelector('[data-koyomi="month-event-resize"][data-edge="end"]')).toBeNull();

    // 第2週セグメント: continuesBefore=true → start 側ハンドルなし、end 側はある
    expect(
      second.querySelector('[data-koyomi="month-event-resize"][data-edge="start"]'),
    ).toBeNull();
    expect(
      second.querySelector('[data-koyomi="month-event-resize"][data-edge="end"]'),
    ).not.toBeNull();
  });
});

describe('MonthView - overflowLabel / renderDayCell', () => {
  it('overflowLabel を渡すと「+N 件」の文言がカスタマイズされる', () => {
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
          <>
            <span data-testid="badge">{day.key}</span>
            {defaultContent}
          </>
        )}
      />,
    );

    const cell = container.querySelector('[data-koyomi-date="2026-07-10"]');
    expect(cell?.querySelector('[data-testid="badge"]')?.textContent).toBe('2026-07-10');
    // 既定内容（日番号ボタン）は defaultContent 経由でそのまま描画される
    expect(cell?.querySelector('[data-koyomi="month-day-number"]')).not.toBeNull();
  });
});

describe('MonthView - オーバーフロー基盤', () => {
  it('onOverflowClick の第 3 引数（details）に表示中のオカレンス一覧が渡り、件数が dayMaxEvents と整合する', () => {
    // dayMaxEvents=1 のため、3 件中 1 件が表示・2 件が「+2 件」に集約される
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
    const [day, hiddenOccurrences, details] = onOverflowClick.mock.calls[0] as [
      MonthDay,
      readonly EventOccurrence[],
      { visibleOccurrences: readonly EventOccurrence[] },
    ];
    expect(day.key).toBe('2026-07-08');
    expect(hiddenOccurrences).toHaveLength(2);
    expect(hiddenOccurrences.map((occurrence) => occurrence.event.title)).toEqual(['B', 'C']);
    expect(details.visibleOccurrences).toHaveLength(1);
    expect(details.visibleOccurrences.map((occurrence) => occurrence.event.title)).toEqual(['A']);
    // 表示中 + 非表示 = その日の全オカレンス数
    expect(details.visibleOccurrences.length + hiddenOccurrences.length).toBe(events.length);
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
        overflowButtonProps={() => ({ 'aria-haspopup': 'true', 'aria-expanded': false })}
      />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).toHaveAttribute('aria-haspopup', 'true');
    expect(overflowButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('overflowButtonProps を渡さない場合、aria-haspopup / aria-expanded は付与されない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(<Harness events={events} dayMaxEvents={1} />);

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    expect(overflowButton).not.toHaveAttribute('aria-haspopup');
    expect(overflowButton).not.toHaveAttribute('aria-expanded');
  });

  it('「+N 件」ボタンは month-event と同じ方式（絶対配置・month-week 基準）の inline style を持つ', () => {
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
    // （month-event と同じ % 計算・positioned ancestor が month-week の配置方式）
    expect(overflowButton.style.position).toBe('absolute');
    expect(overflowButton.style.insetInlineStart).toBe(`${(3 / 7) * 100}%`);
    expect(overflowButton.style.width).toBe(`${(1 / 7) * 100}%`);
    expect(overflowButton.style.bottom).toBe('0px');
  });

  it('hiddenWeekdays で可視列数が変わっても、「+N 件」ボタンの % は可視列数を基準に計算される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
      { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
    ];
    const { container } = render(
      <Harness events={events} dayMaxEvents={1} hiddenWeekdays={[0, 6]} />,
    );

    const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('「+N件」ボタンが見つかりません');
    }
    // 7/8（水）は日・土を除いた可視列で 3 番目（月=0, 火=1, 水=2）、可視列数は 5
    expect(overflowButton.style.insetInlineStart).toBe(`${(2 / 5) * 100}%`);
    expect(overflowButton.style.width).toBe(`${(1 / 5) * 100}%`);
  });
});

describe('MonthView - ARIA', () => {
  it('グリッドロールと日セルの aria-label / aria-current が正しい', () => {
    const { container } = render(<Harness />);

    expect(container.querySelector('[data-koyomi="month"]')).toHaveAttribute('role', 'grid');
    expect(container.querySelector('[data-koyomi="month-weekdays"]')).toHaveAttribute(
      'role',
      'row',
    );
    expect(
      container.querySelectorAll('[data-koyomi="month-weekday"][role="columnheader"]'),
    ).toHaveLength(7);
    expect(container.querySelector('[data-koyomi="month-weeks"]')).toHaveAttribute(
      'role',
      'rowgroup',
    );
    expect(container.querySelectorAll('[data-koyomi="month-days"][role="row"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-koyomi="month-day"][role="gridcell"]')).toHaveLength(
      35,
    );
    // rowgroup → row の間に挟まる週ラッパーは role="presentation" で所有関係を透過させる
    for (const week of container.querySelectorAll('[data-koyomi="month-week"]')) {
      expect(week).toHaveAttribute('role', 'presentation');
    }

    const todayCell = container.querySelector('[data-koyomi-date="2026-07-15"]');
    expect(todayCell).toHaveAttribute('aria-label', '2026年7月15日');
    expect(todayCell).toHaveAttribute('aria-current', 'date');

    const otherCell = container.querySelector('[data-koyomi-date="2026-07-14"]');
    expect(otherCell).toHaveAttribute('aria-label', '2026年7月14日');
    expect(otherCell).not.toHaveAttribute('aria-current');

    // 前月の日付も完全な日付として読み上げられる（特別扱い不要）
    const outsideCell = container.querySelector('[data-koyomi-date="2026-06-28"]');
    expect(outsideCell).toHaveAttribute('aria-label', '2026年6月28日');
  });

  it('イベントの帯（month-event）は開始日の gridcell（month-day）の子孫として描画される', () => {
    // 週/日ビューの終日帯と同じ方針: 複数日にまたがる帯も DOM 上は開始日の gridcell が
    // 所有する（grid の子孫の focusable を row/gridcell の所有関係の外に置かないため。
    // 旧方式の role="presentation" レイヤーはレイヤー自身の意味論しか消えず、内部の
    // ボタンが grid の子孫として露出したままになる）。視覚上の列スパンは positioned
    // ancestor が month-week（position: relative）のため従来どおり
    const events: CalendarEvent[] = [
      { id: 'e1', title: '合宿', start: '2026-07-15', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(<Harness events={events} />);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment).not.toBeNull();
    const owningCell = segment?.closest('[data-koyomi="month-day"]');
    expect(owningCell).not.toBeNull();
    expect(owningCell).toHaveAttribute('role', 'gridcell');
    expect(owningCell).toHaveAttribute('data-koyomi-date', '2026-07-15');

    // 旧方式の帯レイヤー（month-events）は存在しない
    expect(container.querySelector('[data-koyomi="month-events"]')).toBeNull();

    // role="grid" の子孫のフォーカス可能要素はすべて gridcell / columnheader に属する
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    const focusables = grid?.querySelectorAll('button, [tabindex]') ?? [];
    expect(focusables.length).toBeGreaterThan(0);
    for (const focusable of focusables) {
      expect(focusable.closest('[role="gridcell"], [role="columnheader"]')).not.toBeNull();
    }
  });

  it('週をまたぐイベントは各週のセグメントがそれぞれの週の開始列の gridcell に属する', () => {
    // 7/11(土)〜7/13(月) は第2週（〜7/11）と第3週（7/12〜）に分割される
    const events: CalendarEvent[] = [
      { id: 'e1', title: '長期', start: '2026-07-11', end: '2026-07-14', allDay: true },
    ];
    const { container } = render(<Harness events={events} />);

    const segments = Array.from(container.querySelectorAll('[data-koyomi="month-event"]'));
    expect(segments).toHaveLength(2);
    const owners = segments.map((segment) =>
      segment.closest('[data-koyomi="month-day"]')?.getAttribute('data-koyomi-date'),
    );
    // 第2週のセグメントは 7/11 のセル、第3週のセグメントは週の先頭 7/12 のセルが所有する
    expect(owners.sort()).toEqual(['2026-07-11', '2026-07-12']);
  });
});

describe('MonthView - 可視列（hiddenWeekdays）', () => {
  it('hiddenWeekdays で可視列が5列になった週は、可視列数を基準に幅・位置の%が計算される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '朝会', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
    ];
    const { container } = render(<Harness events={events} hiddenWeekdays={[0, 6]} />);

    const weeks = container.querySelectorAll('[data-koyomi="month-week"]');
    const secondWeek = weeks[1];
    expect(secondWeek).toBeInstanceOf(HTMLElement);
    if (!(secondWeek instanceof HTMLElement)) {
      throw new Error('第2週が見つかりません');
    }
    expect(secondWeek.querySelectorAll('[data-koyomi="month-day"]')).toHaveLength(5);

    const segment = container.querySelector('[data-koyomi="month-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('セグメント要素が見つかりません');
    }
    // 7/8（水）は日・土を除いた可視列で 3 番目（月=0, 火=1, 水=2）、可視列数は 5
    expect(segment.style.insetInlineStart).toBe(`${(2 / 5) * 100}%`);
    expect(segment.style.width).toBe(`${(1 / 5) * 100}%`);
  });
});

describe('MonthView - showWeekNumbers（週番号）', () => {
  it('省略時（既定 false）は data-koyomi-week-number 属性が付かない', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('[data-koyomi-week-number]')).toHaveLength(0);
  });

  it('true にすると各週行に data-koyomi-week-number 属性が付く（2026-07 は第27〜31週）', () => {
    const { container } = render(<Harness showWeekNumbers />);
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

describe('MonthView - ドラッグプレビューの選択帯', () => {
  it('setDragPreview で該当週に day-selection が描画され、insetInlineStart/width が交差範囲どおりになる', () => {
    const apiRef: { current: CalendarApi | null } = { current: null };
    const { container } = render(<Harness apiRef={apiRef} />);

    expect(container.querySelector('[data-koyomi="day-selection"]')).toBeNull();

    act(() => {
      apiRef.current?.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-07-07T15:00:00Z'), // 2026-07-08 0:00 JST
          end: new Date('2026-07-08T15:00:00Z'), // 2026-07-09 0:00 JST
        },
        allDay: true,
      });
    });

    const selections = container.querySelectorAll('[data-koyomi="day-selection"]');
    expect(selections).toHaveLength(1);
    const selection = selections[0];
    if (!(selection instanceof HTMLElement)) {
      throw new Error('選択帯が見つかりません');
    }
    // 2026-07-08（水）は第2週の 4 列目（週開始=日曜、startCol=3、可視列数7）
    expect(selection.style.insetInlineStart).toBe(`${(3 / 7) * 100}%`);
    expect(selection.style.width).toBe(`${(1 / 7) * 100}%`);
    expect(selection).toHaveAttribute('aria-hidden', 'true');

    act(() => {
      apiRef.current?.setDragPreview(null);
    });
    expect(container.querySelector('[data-koyomi="day-selection"]')).toBeNull();
  });
});

/**
 * テスト用の最小限の `DayDragHandlers` を作る。`getDayCellProps` だけ差し替え可能にし、
 * 他のメソッドはダミー実装（呼び出されない前提）にする。
 */
function makeFakeDayDrag(
  getDayCellProps: DayDragHandlers['getDayCellProps'] = () => ({
    ref: () => {},
    onPointerDown: () => {},
    onKeyDown: () => {},
    tabIndex: 0,
    'data-koyomi-date': 'stub',
  }),
): DayDragHandlers {
  return {
    getDayCellProps,
    getSegmentProps: () => ({
      onPointerDown: () => {},
      onClick: () => {},
      onKeyDown: () => {},
      tabIndex: 0,
      'data-koyomi-occurrence': 'stub',
    }),
    getSegmentResizeHandleProps: () => ({
      onPointerDown: () => {},
      onClick: () => {},
      'data-koyomi-resize-handle': 'start',
    }),
    previewRange: null,
    isDragging: false,
  };
}

/** `useStableDayDrag` の戻り値を呼び出し元へ通知するだけのテスト用ハーネス。 */
function StableDayDragHarness(props: {
  dayDrag: DayDragHandlers;
  onStable: (stable: MonthDayDragHandlers) => void;
}): null {
  const stable = useStableDayDrag(props.dayDrag);
  props.onStable(stable);
  return null;
}

describe('useStableDayDrag - dayDrag の参照安定化', () => {
  it('親が再レンダーして dayDrag オブジェクトの参照が変わっても、返すラッパーは同じ参照のままになる', () => {
    const dayDragA = makeFakeDayDrag();
    const dayDragB = makeFakeDayDrag();
    expect(dayDragA).not.toBe(dayDragB); // 前提: useDayDrag は毎レンダー新しいオブジェクトを返す

    const seen: MonthDayDragHandlers[] = [];
    const onStable = (stable: MonthDayDragHandlers): void => {
      seen.push(stable);
    };

    const { rerender } = render(<StableDayDragHarness dayDrag={dayDragA} onStable={onStable} />);
    rerender(<StableDayDragHarness dayDrag={dayDragB} onStable={onStable} />);

    expect(seen).toHaveLength(2);
    // ラッパー自体の参照は dayDrag の入力が変わっても同じであり続ける
    expect(seen[0]).toBe(seen[1]);
  });

  it('ラッパー経由の呼び出しは常に最新の dayDrag のハンドラへ委譲する（古い dayDrag には委譲しない）', () => {
    const getDayCellPropsA = vi.fn(() => ({
      ref: () => {},
      onPointerDown: () => {},
      onKeyDown: () => {},
      tabIndex: 0,
      'data-koyomi-date': 'A',
    }));
    const getDayCellPropsB = vi.fn(() => ({
      ref: () => {},
      onPointerDown: () => {},
      onKeyDown: () => {},
      tabIndex: 0,
      'data-koyomi-date': 'B',
    }));
    const dayDragA = makeFakeDayDrag(getDayCellPropsA);
    const dayDragB = makeFakeDayDrag(getDayCellPropsB);

    const stableRef: { current: MonthDayDragHandlers | null } = { current: null };
    const onStable = (value: MonthDayDragHandlers): void => {
      stableRef.current = value;
    };

    const { rerender } = render(<StableDayDragHarness dayDrag={dayDragA} onStable={onStable} />);
    rerender(<StableDayDragHarness dayDrag={dayDragB} onStable={onStable} />);

    const day = { date: NOW, key: '2026-07-15' };
    stableRef.current?.getDayCellProps(day);

    expect(getDayCellPropsA).not.toHaveBeenCalled();
    expect(getDayCellPropsB).toHaveBeenCalledWith(day);
  });
});

describe('MonthView - dayDrag 参照安定化による再レンダー抑制', () => {
  it('drag プレビューが更新されても、交差しない週の MonthWeekRow は再レンダーされない', () => {
    const calls: string[] = [];
    const renderDayCell = vi.fn((day: MonthDay, defaultContent: ReactNode) => {
      calls.push(day.key);
      return defaultContent;
    });
    const apiRef: { current: CalendarApi | null } = { current: null };
    render(<Harness apiRef={apiRef} renderDayCell={renderDayCell} />);

    const countFor = (key: string): number => calls.filter((k) => k === key).length;

    // 前提: 初回レンダーで両方の週の日セルが少なくとも 1 回描画されている
    const baselineWeek1 = countFor('2026-07-01'); // 第1週（これからドラッグ対象にする週）
    const baselineWeek5 = countFor('2026-07-29'); // 第5週（ドラッグと無関係な週）
    expect(baselineWeek1).toBeGreaterThan(0);
    expect(baselineWeek5).toBeGreaterThan(0);

    // 第1週（7/1）とだけ交差するドラッグプレビューへ更新する。
    // useDayDrag の戻り値（dayDrag）は毎レンダー新規オブジェクトになるが、
    // useStableDayDrag でラップ済みのため、selectionSpan が変わらない週の
    // MonthWeekRow へは同一参照の props が渡り続けるはず。
    act(() => {
      apiRef.current?.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-06-30T15:00:00Z'), // 2026-07-01 0:00 JST
          end: new Date('2026-07-01T15:00:00Z'), // 2026-07-02 0:00 JST
        },
        allDay: true,
      });
    });

    // 第1週は selectionSpan が変化するため再レンダーされ、renderDayCell が再度呼ばれる
    expect(countFor('2026-07-01')).toBeGreaterThan(baselineWeek1);
    // 第5週は selectionSpan が null のまま、dayDrag も参照安定であるため
    // MonthWeekRow の memo が効き、再レンダーされない（renderDayCell も再度呼ばれない）
    expect(countFor('2026-07-29')).toBe(baselineWeek5);
  });
});
