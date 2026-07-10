/**
 * time-grid-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `TimeGridView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { TimeGridViewProps } from './time-grid-view';
import { TimeGridView } from './time-grid-view';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

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
  /** `TimeGridView` へそのまま渡す追加 props（`renderEvent` / `renderDayHeader` など）。 */
  viewProps?: TimeGridViewProps;
  /** 追加の時間軸タイムゾーン（{@link CalendarOptions.timeAxisZones}）。 */
  timeAxisZones?: readonly string[];
}

/** `TimeGridView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView,
    events: props.events ?? EMPTY_EVENTS,
    ...(props.timeAxisZones !== undefined ? { timeAxisZones: props.timeAxisZones } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <TimeGridView {...(props.viewProps ?? {})} />
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

  it('日ヘッダー内の曜日ラベルに data-koyomi="timegrid-weekday" が付く（MonthView/YearView と同じ流儀）', () => {
    const { container } = render(<Harness initialView="week" />);
    const weekdayLabels = container.querySelectorAll('[data-koyomi="timegrid-weekday"]');
    expect(weekdayLabels).toHaveLength(7);

    // 2026-07-15（水）の列には曜日ラベルとして「水」を含むテキストが入る
    const todayHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-15"]',
    );
    const todayWeekdayLabel = todayHeader?.querySelector('[data-koyomi="timegrid-weekday"]');
    expect(todayWeekdayLabel?.textContent).toContain('水');
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
    // RTL 対応のため水平位置は insetInlineStart（論理プロパティ）で指定する
    const insetStarts = items.map((el) => (el as HTMLElement).style.insetInlineStart).sort();
    const widths = items.map((el) => (el as HTMLElement).style.width);
    expect(insetStarts).toEqual(['0%', '50%']);
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
    // RTL 対応のため水平位置は insetInlineStart（論理プロパティ）で指定する
    expect(style.insetInlineStart).toBe(`${(2 / 7) * 100}%`);
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

  it('timeAxisZones 未指定時は時間軸の列が 1 つだけ描画される（互換維持）', () => {
    const { container } = render(<Harness initialView="day" />);
    expect(container.querySelectorAll('[data-koyomi="time-axis"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-koyomi="timegrid-axis-gutter"]')).toHaveLength(2); // header + allday-row
  });

  it('timeAxisZones を指定すると追加の時間軸列が描画され、data-koyomi-timezone で識別できる', () => {
    const { container } = render(
      <Harness initialView="day" timeAxisZones={['America/New_York']} />,
    );
    const axes = container.querySelectorAll('[data-koyomi="time-axis"]');
    expect(axes).toHaveLength(2);
    expect(axes[0]).toHaveAttribute('data-koyomi-timezone', TOKYO);
    expect(axes[1]).toHaveAttribute('data-koyomi-timezone', 'America/New_York');
    // ヘッダー・終日行のガター列も軸数ぶん描画され、幅が揃う
    expect(container.querySelectorAll('[data-koyomi="timegrid-axis-gutter"]')).toHaveLength(4);

    const nyAxisLabels = axes[1]?.querySelectorAll('[data-koyomi="time-slot-label"]');
    expect(nyAxisLabels).toHaveLength(24);
  });

  it('現在時刻線が今日の列にのみ表示される', () => {
    const { container } = render(<Harness initialView="week" />);
    const todayColumn = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    const otherColumn = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-14"]',
    );
    const nowIndicator = todayColumn?.querySelector('[data-koyomi="now-indicator"]');
    expect(nowIndicator).not.toBeNull();
    // 現在時刻線は視覚的な装飾であり、スクリーンリーダーには読み上げさせない
    expect(nowIndicator).toHaveAttribute('aria-hidden', 'true');
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

  it('イベントをクリックすると onEventClick が対象のオカレンスとともに呼ばれる', () => {
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

  it('イベント上の Enter / Space は既定動作を抑制し、onEventClick を 1 回だけ呼ぶ', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const onEventClick = vi.fn();
    const { container } = render(
      <Harness initialView="day" events={events} callbacks={{ onEventClick }} />,
    );
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    if (eventEl === null) {
      throw new Error('timegrid-event が見つかりません');
    }

    expect(fireEvent.keyDown(eventEl, { key: 'Enter' })).toBe(false);
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(eventEl, { key: ' ' })).toBe(false);
    expect(onEventClick).toHaveBeenCalledTimes(2);
  });

  it('イベント上の Delete / Backspace は既定動作を抑制し、削除操作に使われる', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const events: CalendarEvent[] = [
      { id: 'e1', title: '削除対象', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} sink={sink} />);
    const deleteTarget = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(deleteTarget).not.toBeNull();
    if (deleteTarget === null) {
      throw new Error('timegrid-event が見つかりません');
    }

    expect(fireEvent.keyDown(deleteTarget, { key: 'Delete' })).toBe(false);
    expect(sink.current?.api.getEvents()).toHaveLength(0);

    act(() => {
      sink.current?.api.setEvents(events);
    });
    const backspaceTarget = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(backspaceTarget).not.toBeNull();
    if (backspaceTarget === null) {
      throw new Error('timegrid-event が見つかりません');
    }
    expect(fireEvent.keyDown(backspaceTarget, { key: 'Backspace' })).toBe(false);
    expect(sink.current?.api.getEvents()).toHaveLength(0);
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

  it('編集可能なイベントには上端・下端の両方にリサイズハンドルが描画され、data-edge で区別できる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const eventEl = container.querySelector('[data-koyomi-occurrence^="e1"]');
    const handles = eventEl?.querySelectorAll('[data-koyomi="timegrid-resize"]');
    expect(handles).toHaveLength(2);
    expect(
      eventEl?.querySelector('[data-koyomi="timegrid-resize"][data-edge="start"]'),
    ).not.toBeNull();
    expect(
      eventEl?.querySelector('[data-koyomi="timegrid-resize"][data-edge="end"]'),
    ).not.toBeNull();
  });

  it('editable: false のイベントには上端・下端どちらのリサイズハンドルも描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'locked',
        title: '編集不可',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        editable: false,
      },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const eventEl = container.querySelector('[data-koyomi-occurrence^="locked"]');
    expect(eventEl?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(0);
  });

  it('日をまたぐイベントは continuesAfter 側の下端ハンドルと continuesBefore 側の上端ハンドルが出ない', () => {
    const events: CalendarEvent[] = [
      { id: 'cross', title: '夜間作業', start: '2026-07-14T22:00', end: '2026-07-15T02:00' },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const day14Event = container
      .querySelector('[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-14"]')
      ?.querySelector('[data-koyomi="timegrid-event"]');
    const day15Event = container
      .querySelector('[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]')
      ?.querySelector('[data-koyomi="timegrid-event"]');

    // 14 日側（continuesAfter）: 上端ハンドルはあるが下端ハンドルはない
    expect(
      day14Event?.querySelector('[data-koyomi="timegrid-resize"][data-edge="start"]'),
    ).not.toBeNull();
    expect(
      day14Event?.querySelector('[data-koyomi="timegrid-resize"][data-edge="end"]'),
    ).toBeNull();

    // 15 日側（continuesBefore）: 下端ハンドルはあるが上端ハンドルはない
    expect(
      day15Event?.querySelector('[data-koyomi="timegrid-resize"][data-edge="start"]'),
    ).toBeNull();
    expect(
      day15Event?.querySelector('[data-koyomi="timegrid-resize"][data-edge="end"]'),
    ).not.toBeNull();
  });

  it('終日イベントの帯には左右にリサイズハンドルが描画される', () => {
    const events: CalendarEvent[] = [
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(
      segment?.querySelector('[data-koyomi="allday-resize"][data-edge="start"]'),
    ).not.toBeNull();
    expect(segment?.querySelector('[data-koyomi="allday-resize"][data-edge="end"]')).not.toBeNull();
  });

  it('editable: false の終日イベントには帯のリサイズハンドルが描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad-locked',
        title: '固定休暇',
        start: '2026-07-14',
        end: '2026-07-15',
        allDay: true,
        editable: false,
      },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment?.querySelectorAll('[data-koyomi="allday-resize"]')).toHaveLength(0);
  });

  it('renderDayHeader で日ヘッダーの表示内容をカスタマイズでき、defaultContent には既定の内容が渡る', () => {
    const { container } = render(
      <Harness
        initialView="week"
        viewProps={{
          renderDayHeader: (day, defaultContent) => (
            <div data-testid={`custom-header-${day.key}`}>{defaultContent}</div>
          ),
        }}
      />,
    );
    const custom = container.querySelector('[data-testid="custom-header-2026-07-15"]');
    expect(custom).not.toBeNull();
    // 既定内容（曜日ラベル・日番号ボタン）がそのまま渡され描画されている
    expect(custom?.querySelector('[data-koyomi="timegrid-day-number"]')?.textContent).toContain(
      '15',
    );
  });

  it('日番号ボタンに完全な日付の aria-label が付き、今日の列ヘッダーにのみ aria-current="date" が付く', () => {
    const { container } = render(<Harness initialView="week" />);
    const todayHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-15"]',
    );
    expect(todayHeader).toHaveAttribute('aria-current', 'date');

    const otherHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-14"]',
    );
    expect(otherHeader).not.toHaveAttribute('aria-current');

    const dayNumberButton = todayHeader?.querySelector('[data-koyomi="timegrid-day-number"]');
    expect(dayNumberButton).toHaveAttribute('aria-label', '2026年7月15日');
  });

  it('setDragPreview 後、交差する列にのみ timegrid-preview が data-kind・top・height 付きで出現する', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} sink={sink} />);

    expect(container.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'resize',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'), // 10:00 JST
          end: new Date('2026-07-15T03:00:00Z'), // 12:00 JST
        },
        allDay: false,
      });
    });

    const dayColumn = container.querySelector('[data-koyomi="timegrid-day"]');
    const preview = dayColumn?.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    // ドラッグプレビューは装飾要素なので読み上げ対象から外す
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    const style = (preview as HTMLElement).style;
    // 10:00 = 600分 → 600/1440*100 ≈ 41.66...%、12:00 = 720分 → 高さ 120/1440*100 ≈ 8.33...%
    expect(style.top).toContain('41.66');
    expect(style.height).toContain('8.33');
  });
});
