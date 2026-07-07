/**
 * month-view.tsx のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `useCalendar` / `CalendarProvider` を通した結合テストとして、
 * `container.querySelector('[data-koyomi="..."]')` で DOM 契約を検証する。
 */
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarApi, CalendarEvent, CalendarViewType, EventSegment } from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks } from '../types';
import { useCalendar } from '../use-calendar';
import { MonthView } from './month-view';

/** テストで使う表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** 「現在時刻」として固定する日時（東京では 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** `MonthView` を `CalendarProvider` 配下で描画するテスト用ラッパ。 */
function Harness(props: {
  events?: readonly CalendarEvent[];
  initialView?: CalendarViewType;
  callbacks?: CalendarInteractionCallbacks;
  dayMaxEvents?: number;
  renderEvent?: (segment: EventSegment) => ReactElement;
  apiRef?: { current: CalendarApi | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'month',
    events: props.events ?? [],
    // exactOptionalPropertyTypes 下では、値が undefined になり得るプロパティを
    // そのままキーに設定できない（省略とキー存在+undefinedが区別される）ため、
    // 未指定時はキー自体を省く
    ...(props.dayMaxEvents !== undefined ? { dayMaxEvents: props.dayMaxEvents } : {}),
  });
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
    >
      <MonthView {...(props.renderEvent !== undefined ? { renderEvent: props.renderEvent } : {})} />
    </CalendarProvider>
  );
}

describe('MonthView - グリッド構造', () => {
  it('2026年7月（東京）は5週×7日で描画され、data-koyomi-date/data-today/data-outsideが正しい', () => {
    const { container } = render(<Harness />);

    expect(container.querySelectorAll('[data-koyomi="month-week"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-koyomi="month-day"]')).toHaveLength(35);

    // 前月の埋め草（6/28）は data-outside が立つ
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
    expect(segment.style.left).toBe(`${(3 / 7) * 100}%`);
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

  it('イベントクリックで callbacks.onEventClick が発生を受け取る', () => {
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
