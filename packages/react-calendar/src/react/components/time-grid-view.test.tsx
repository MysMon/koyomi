/**
 * time-grid-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `TimeGridView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 */
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import { TimeGridView } from './time-grid-view';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** テスト用ハーネスの props。 */
interface HarnessProps {
  /** 初期ビュー。 */
  initialView: CalendarViewType;
  /** 初期イベント。 */
  events?: readonly CalendarEvent[];
  /** インタラクションコールバック。 */
  callbacks?: CalendarInteractionCallbacks;
  /** `useCalendar` の戻り値を外部から観測するための入れ物。 */
  sink?: { current: UseCalendarResult | null };
}

/** `TimeGridView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView,
    events: props.events ?? [],
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <TimeGridView />
    </CalendarProvider>
  );
}

describe('TimeGridView', () => {
  it('week ビューでは 7 列、day ビューでは 1 列が描画され、今日の列にだけ data-today が付く', () => {
    const { container: weekContainer } = render(<Harness initialView="week" />);
    const root = weekContainer.querySelector('[data-koyomi="timegrid"]');
    expect(root).toHaveAttribute('data-koyomi-days', '7');
    expect(weekContainer.querySelectorAll('[data-koyomi="timegrid-day-header"]')).toHaveLength(7);

    const todayHeader = weekContainer.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-15"]',
    );
    expect(todayHeader).toHaveAttribute('data-today', 'true');
    expect(todayHeader?.textContent).toContain('15');

    const otherHeader = weekContainer.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-14"]',
    );
    expect(otherHeader).not.toHaveAttribute('data-today');

    const { container: dayContainer } = render(<Harness initialView="day" />);
    expect(dayContainer.querySelector('[data-koyomi="timegrid"]')).toHaveAttribute(
      'data-koyomi-days',
      '1',
    );
    expect(dayContainer.querySelectorAll('[data-koyomi="timegrid-day-header"]')).toHaveLength(1);
  });

  it('終日イベントの aria-label は日付範囲のみで、時刻や排他終了日の余分な 1 日を含まない', () => {
    const events: CalendarEvent[] = [
      // 7/15〜7/16 の 2 日間（end 排他で 7/17 0:00）
      { id: 'allday', title: '合宿', start: '2026-07-15', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    const label = segment?.getAttribute('aria-label') ?? '';
    expect(label).toBe('合宿、7月15日〜7月16日');
  });

  it('時間指定イベントの top/height が %（分/1440）で計算される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    const style = (eventEl as HTMLElement).getAttribute('style') ?? '';
    // 10:00 = 600分 → 600/1440*100 ≈ 41.666...%、1時間 = 60分 → 60/1440*100 ≈ 4.166...%
    expect(style).toContain('41.66');
    expect(style).toContain('4.16');
    expect(eventEl?.textContent).toContain('10:00〜11:00');
    expect(eventEl?.textContent).toContain('会議');
  });

  it('時間が重なる 2 件のイベントが left/width で横並びになる', () => {
    const events: CalendarEvent[] = [
      { id: 'a', title: 'A', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
      { id: 'b', title: 'B', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const items = Array.from(container.querySelectorAll('[data-koyomi="timegrid-event"]'));
    expect(items).toHaveLength(2);
    const lefts = items.map((el) => (el as HTMLElement).style.left).sort();
    const widths = items.map((el) => (el as HTMLElement).style.width);
    expect(lefts).toEqual(['0%', '50%']);
    expect(widths.every((width) => width === '50%')).toBe(true);
  });

  it('終日イベントが allday-row に帯として描画される（クリック時タイトルのみ）', () => {
    const events: CalendarEvent[] = [
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment).not.toBeNull();
    expect(segment?.textContent).toBe('休暇');
    const style = (segment as HTMLElement).style;
    // 2026-07-14 は表示週（07-12日〜07-18土）の 3 列目（0 起点 index 2）
    expect(style.left).toBe(`${(2 / 7) * 100}%`);
    expect(style.width).toBe(`${(1 / 7) * 100}%`);
  });

  it('24 時間未満で日をまたぐイベント（22:00〜翌2:00）は allday-row に出ず、時間グリッド側で両日に分割され continues 属性が付く', () => {
    const events: CalendarEvent[] = [
      { id: 'cross', title: '夜間作業', start: '2026-07-14T22:00', end: '2026-07-15T02:00' },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);

    expect(container.querySelector('[data-koyomi="allday-event"]')).toBeNull();

    const day14 = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-14"]',
    );
    const day15 = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    const eventIn14 = day14?.querySelector('[data-koyomi="timegrid-event"]');
    const eventIn15 = day15?.querySelector('[data-koyomi="timegrid-event"]');

    expect(eventIn14).toHaveAttribute('data-continues-after', 'true');
    expect(eventIn14).not.toHaveAttribute('data-continues-before');
    expect(eventIn15).toHaveAttribute('data-continues-before', 'true');
    expect(eventIn15).not.toHaveAttribute('data-continues-after');
  });

  it('時間軸に 24 個のスロットが並び、09:00 のラベルが存在する', () => {
    const { container } = render(<Harness initialView="day" />);
    const labels = container.querySelectorAll('[data-koyomi="time-slot-label"]');
    expect(labels).toHaveLength(24);
    expect(Array.from(labels).map((el) => el.textContent)).toContain('09:00');

    const dayColumn = container.querySelector('[data-koyomi="timegrid-day"]');
    expect(dayColumn?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(24);
  });

  it('現在時刻線が今日の列にのみ表示される', () => {
    const { container } = render(<Harness initialView="week" />);
    const todayColumn = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    const otherColumn = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-14"]',
    );
    expect(todayColumn?.querySelector('[data-koyomi="now-indicator"]')).not.toBeNull();
    expect(otherColumn?.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
  });

  it('編集可能なイベントにのみリサイズハンドルが存在する', () => {
    const events: CalendarEvent[] = [
      { id: 'editable', title: '編集可', start: '2026-07-15T09:00', end: '2026-07-15T10:00' },
      {
        id: 'locked',
        title: '編集不可',
        start: '2026-07-15T11:00',
        end: '2026-07-15T12:00',
        editable: false,
      },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const editableEvent = container.querySelector('[data-koyomi-occurrence^="editable"]');
    const lockedEvent = container.querySelector('[data-koyomi-occurrence^="locked"]');
    expect(editableEvent?.querySelector('[data-koyomi="timegrid-resize"]')).not.toBeNull();
    expect(lockedEvent?.querySelector('[data-koyomi="timegrid-resize"]')).toBeNull();
  });

  it('イベントをクリックすると onEventClick が対象の発生とともに呼ばれる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const onEventClick = vi.fn();
    const { container } = render(
      <Harness initialView="day" events={events} callbacks={{ onEventClick }} />,
    );
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    if (eventEl !== null) {
      fireEvent.click(eventEl);
    }
    expect(onEventClick).toHaveBeenCalledTimes(1);
    const [occurrence] = onEventClick.mock.calls[0] as [{ eventId: string }];
    expect(occurrence.eventId).toBe('e1');
  });

  it('日番号ボタンをクリックすると、その日へ移動して day ビューに切り替わる', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness initialView="week" sink={sink} />);

    const targetHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-14"]',
    );
    const dayNumberButton = targetHeader?.querySelector('[data-koyomi="timegrid-day-number"]');
    expect(dayNumberButton).not.toBeNull();
    if (dayNumberButton !== null && dayNumberButton !== undefined) {
      fireEvent.click(dayNumberButton);
    }

    expect(sink.current?.api.getState().view).toBe('day');
    expect(sink.current?.api.getState().currentDate.toISOString()).toBe(
      new Date('2026-07-13T15:00:00.000Z').toISOString(),
    );
  });

  it('timeGrid 以外のビュー（例: month）では何も描画しない', () => {
    const { container } = render(<Harness initialView="month" />);
    expect(container.querySelector('[data-koyomi="timegrid"]')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
