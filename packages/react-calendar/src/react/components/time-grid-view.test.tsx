/**
 * time-grid-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `TimeGridView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarViewType,
  EventOccurrence,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import { overflowPopoverButtonProps } from '../overflow-popover-props';
import type { CalendarInteractionCallbacks, UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { TimeGridViewHandle, TimeGridViewProps } from './time-grid-view';
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
  /** 週番号表示（{@link CalendarOptions.showWeekNumbers}）。 */
  showWeekNumbers?: boolean;
  /** 営業時間の指定（{@link CalendarOptions.businessHours}）。 */
  businessHours?: readonly BusinessHoursRule[];
  /** 表示時間帯の開始（{@link CalendarOptions.slotMinTime}）。 */
  slotMinTime?: string;
  /** 表示時間帯の終了（{@link CalendarOptions.slotMaxTime}）。 */
  slotMaxTime?: string;
  /** 終日行に表示する最大イベント数（{@link CalendarOptions.allDayMaxEvents}）。 */
  allDayMaxEvents?: number;
  /** 書式ロケール（{@link CalendarOptions.locale}）。 */
  locale?: string;
  /** `CalendarProvider` の `messages` prop。 */
  messages?: MessageCatalogOverrides;
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
    ...(props.showWeekNumbers !== undefined ? { showWeekNumbers: props.showWeekNumbers } : {}),
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
    ...(props.slotMinTime !== undefined ? { slotMinTime: props.slotMinTime } : {}),
    ...(props.slotMaxTime !== undefined ? { slotMaxTime: props.slotMaxTime } : {}),
    ...(props.allDayMaxEvents !== undefined ? { allDayMaxEvents: props.allDayMaxEvents } : {}),
    ...(props.locale !== undefined ? { locale: props.locale } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider
      value={calendar}
      callbacks={props.callbacks ?? {}}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
    >
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

  it('messages.common.eventAriaLabel をオーバーライドすると aria-label がカスタマイズされる（終日行・時間指定行の両方、resourceLabel は undefined）', () => {
    const events: CalendarEvent[] = [
      { id: 'allday', title: '合宿', start: '2026-07-15', end: '2026-07-17', allDay: true },
      { id: 'timed', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const eventAriaLabel = vi.fn(
      (_occurrence: EventOccurrence, parts: { rangeLabel: string; resourceLabel?: string }) => {
        expect(parts.resourceLabel).toBeUndefined();
        return `カスタム:${parts.rangeLabel}`;
      },
    );
    const { container } = render(
      <Harness initialView="week" events={events} messages={{ common: { eventAriaLabel } }} />,
    );

    const alldaySegment = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldaySegment).toHaveAttribute('aria-label', 'カスタム:7月15日〜7月16日');

    const timedEvent = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(timedEvent).toHaveAttribute('aria-label', 'カスタム:7月15日 10:00〜11:00');

    expect(eventAriaLabel).toHaveBeenCalledTimes(2);
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

  it("locale='en-US' では時間指定イベントの既定表示が 12h/AM-PM 表記になり、区切りも en カタログの rangeSeparator（–）になる", () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'Meeting', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} locale="en-US" />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl?.textContent).toContain('10:00 AM–11:00 AM');
    expect(eventEl?.textContent).toContain('Meeting');
  });

  it("locale='en-US' では timegrid-event の既定 aria-label（rangeLabel）の時刻部分も 12h/AM-PM 表記になる", () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: 'Meeting', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} locale="en-US" />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).toHaveAttribute('aria-label', 'Meeting, July 15 10:00 AM–11:00 AM');
  });

  it('event.color を指定していない場合、timegrid-event の inline style は背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const item = container.querySelector('[data-koyomi="timegrid-event"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('timegrid-event が見つかりません');
    }
    expect(item.style.position).toBe('');
    expect(item.style.backgroundColor).toBe('');
    expect(item.style.color).toBe('');
    expect(item.style.border).toBe('');
    expect(item.style.getPropertyValue('--koyomi-event-color')).toBe('');
  });

  it('event.color を指定していない場合、allday-event の inline style は背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '休暇', start: '2026-07-15', end: '2026-07-16', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const item = container.querySelector('[data-koyomi="allday-event"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('allday-event が見つかりません');
    }
    expect(item.style.position).toBe('');
    expect(item.style.backgroundColor).toBe('');
    expect(item.style.color).toBe('');
    expect(item.style.border).toBe('');
    expect(item.style.getPropertyValue('--koyomi-event-color')).toBe('');
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

  it('renderAllDayEvent で終日行の帯の内容をカスタマイズできる（renderEvent は影響しない）', () => {
    const events: CalendarEvent[] = [
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const { container } = render(
      <Harness
        initialView="week"
        events={events}
        viewProps={{
          renderEvent: () => <span data-testid="timed">時間指定用</span>,
          renderAllDayEvent: (segment) => (
            <span data-testid="custom-allday">{segment.occurrence.event.title}★</span>
          ),
        }}
      />,
    );
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment?.querySelector('[data-testid="custom-allday"]')?.textContent).toBe('休暇★');
    expect(segment?.querySelector('[data-testid="timed"]')).toBeNull();
  });

  it('renderAllDayEvent 省略時は既定どおりタイトルのみが表示される', () => {
    const events: CalendarEvent[] = [
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment?.textContent).toBe('休暇');
  });

  it('renderEvent の第 2 引数 ctx から既定内容・スロット種別・分解済みパーツを参照できる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(
      <Harness
        initialView="week"
        events={events}
        viewProps={{
          renderEvent: (_item, ctx) => (
            <span>
              {ctx.slot}|{ctx.parts.timeText}|{ctx.parts.titleText}|{ctx.defaultContent}
            </span>
          ),
        }}
      />,
    );
    const content = container.querySelector('[data-koyomi="timegrid-event-content"]');
    expect(content?.textContent).toBe('timegrid-event|10:00〜11:00|会議|10:00〜11:00 会議');
  });

  it('renderAllDayEvent の ctx はタイトルのみの既定内容を持ち、時刻パーツは null になる', () => {
    const events: CalendarEvent[] = [
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const { container } = render(
      <Harness
        initialView="week"
        events={events}
        viewProps={{
          renderAllDayEvent: (_segment, ctx) => (
            <span>
              {ctx.slot}|{ctx.parts.timeText === null ? 'null' : 'x'}|{ctx.defaultContent}
            </span>
          ),
        }}
      />,
    );
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment?.textContent).toBe('allday-event|null|休暇');
  });

  it('CalendarProvider の renderEventContent が時間指定ブロックと終日の帯の両方に適用され、slot で判別できる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];
    const calendarSink: { current: UseCalendarResult | null } = { current: null };

    /** renderEventContent を CalendarProvider へ渡すためのローカルハーネス。 */
    function CentralHarness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'week',
        events,
      });
      calendarSink.current = calendar;
      return (
        <CalendarProvider
          value={calendar}
          renderEventContent={(occurrence, ctx) => (
            <span>
              {ctx.slot}:{occurrence.event.title}
            </span>
          )}
        >
          <TimeGridView />
        </CalendarProvider>
      );
    }

    const { container } = render(<CentralHarness />);
    expect(container.querySelector('[data-koyomi="timegrid-event-content"]')?.textContent).toBe(
      'timegrid-event:会議',
    );
    expect(container.querySelector('[data-koyomi="allday-event"]')?.textContent).toBe(
      'allday-event:休暇',
    );
  });

  it('renderEvent は時間指定ブロックのみで renderEventContent より優先され、終日の帯には中央レンダラーが適用され続ける', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
      { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
    ];

    /** renderEvent（個別）と renderEventContent（中央）を同時に渡すローカルハーネス。 */
    function MixedHarness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'week',
        events,
      });
      return (
        <CalendarProvider value={calendar} renderEventContent={() => <span>中央</span>}>
          <TimeGridView renderEvent={() => <span>個別</span>} />
        </CalendarProvider>
      );
    }

    const { container } = render(<MixedHarness />);
    expect(container.querySelector('[data-koyomi="timegrid-event-content"]')?.textContent).toBe(
      '個別',
    );
    expect(container.querySelector('[data-koyomi="allday-event"]')?.textContent).toBe('中央');
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

  it('ヘッダーのガター列に各軸のタイムゾーンラベル（GMT オフセット）が表示される', () => {
    const { container } = render(
      <Harness initialView="day" timeAxisZones={['America/New_York']} />,
    );
    const header = container.querySelector('[data-koyomi="timegrid-header"]');
    const labels = header?.querySelectorAll('[data-koyomi="time-axis-label"]');
    expect(labels).toHaveLength(2);
    expect(labels?.[0]?.textContent).toBe('GMT+9');
    // NOW（2026-07-15）は夏時間中のため NY は GMT-4
    expect(labels?.[1]?.textContent).toBe('GMT-4');
    // ラベルは視覚的な補助情報（列見出しの読み上げには含めない）
    expect(labels?.[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('タイムゾーンラベルはヘッダー行にのみ表示される（終日行のガターには出ない）', () => {
    const { container } = render(<Harness initialView="day" />);
    const alldayRow = container.querySelector('[data-koyomi="allday-row"]');
    expect(alldayRow?.querySelector('[data-koyomi="time-axis-label"]')).toBeNull();
    const header = container.querySelector('[data-koyomi="timegrid-header"]');
    expect(header?.querySelectorAll('[data-koyomi="time-axis-label"]')).toHaveLength(1);
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

  it('onDayNumberClick が指定されていればそれが呼ばれ、既定の画面遷移は行われない', () => {
    const onDayNumberClick = vi.fn();
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness initialView="week" callbacks={{ onDayNumberClick }} sink={sink} />,
    );

    const targetHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-14"]',
    );
    const dayNumberButton = targetHeader?.querySelector('[data-koyomi="timegrid-day-number"]');
    expect(dayNumberButton).not.toBeNull();
    if (dayNumberButton !== null && dayNumberButton !== undefined) {
      fireEvent.click(dayNumberButton);
    }

    expect(onDayNumberClick).toHaveBeenCalledTimes(1);
    expect(onDayNumberClick.mock.calls[0]?.[0]?.getTime()).toBe(
      new Date('2026-07-13T15:00:00.000Z').getTime(),
    );
    expect(sink.current?.api.getState().view).toBe('week');
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

  it('renderDayHeader で日ヘッダーの表示内容をカスタマイズでき、ctx.defaultContent には既定の内容が渡る', () => {
    const { container } = render(
      <Harness
        initialView="week"
        viewProps={{
          renderDayHeader: (day, ctx) => (
            <div data-testid={`custom-header-${day.key}`}>{ctx.defaultContent}</div>
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

  it('dragPreview.invalid: true のとき timegrid-preview に data-koyomi-invalid="true" が付与される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness initialView="day" sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        invalid: true,
      });
    });

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).toHaveAttribute('data-koyomi-invalid', 'true');
  });

  it('dragPreview.invalid 省略時は timegrid-preview に data-koyomi-invalid 属性が付かない', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness initialView="day" sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
      });
    });

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute('data-koyomi-invalid');
  });

  it('終日行の day-selection（allDay プレビュー）にも dragPreview.invalid が data-koyomi-invalid として反映される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness initialView="week" sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: {
          start: new Date('2026-07-14T15:00:00Z'), // 2026-07-15 0:00 JST
          end: new Date('2026-07-15T15:00:00Z'), // 2026-07-16 0:00 JST
        },
        allDay: true,
        invalid: true,
      });
    });

    const selection = container.querySelector('[data-koyomi="day-selection"]');
    expect(selection).toHaveAttribute('data-koyomi-invalid', 'true');
  });
});

describe('TimeGridView - A キーによる終日 ⇔ 時間指定の変換', () => {
  it('時間指定イベント上の A キーで開始日 1 日分の終日イベントに変換され、終日行の帯として描画される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const events: CalendarEvent[] = [
      { id: 'timed', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="week" events={events} sink={sink} />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    if (eventEl === null) {
      throw new Error('timegrid-event が見つかりません');
    }

    // 既定動作を抑制する（fireEvent は preventDefault されると false を返す）
    expect(fireEvent.keyDown(eventEl, { key: 'a' })).toBe(false);

    const updated = sink.current?.api.getEvents()[0];
    expect(updated?.allDay).toBe(true);
    if (!(updated?.start instanceof Date) || !(updated.end instanceof Date)) {
      throw new Error('更新後の start/end が Date ではありません');
    }
    // 2026-07-15 0:00 JST 〜 2026-07-16 0:00 JST の 1 日分
    expect(updated.start.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    expect(updated.end.toISOString()).toBe('2026-07-15T15:00:00.000Z');
    // 時間グリッドから消え、終日行の帯として描画され直す
    expect(container.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
    expect(container.querySelector('[data-koyomi="allday-event"]')).not.toBeNull();
  });

  it('終日イベントの帯上の A キーで slotMinTime から defaultEventMinutes 分の時間指定イベントに変換され、時間グリッドに描画される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const events: CalendarEvent[] = [
      { id: 'allday', title: '休暇', start: '2026-07-15', end: '2026-07-16', allDay: true },
    ];
    const { container } = render(
      <Harness initialView="week" events={events} sink={sink} slotMinTime="08:00" />,
    );
    const segmentEl = container.querySelector('[data-koyomi="allday-event"]');
    expect(segmentEl).not.toBeNull();
    if (segmentEl === null) {
      throw new Error('allday-event が見つかりません');
    }

    expect(fireEvent.keyDown(segmentEl, { key: 'a' })).toBe(false);

    const updated = sink.current?.api.getEvents()[0];
    expect(updated?.allDay).toBe(false);
    if (!(updated?.start instanceof Date) || !(updated.end instanceof Date)) {
      throw new Error('更新後の start/end が Date ではありません');
    }
    // slotMinTime（08:00 JST）から defaultEventMinutes（既定 60 分）
    expect(updated.start.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    expect(updated.end.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    // 終日行から消え、時間グリッドのイベントとして描画され直す
    expect(container.querySelector('[data-koyomi="allday-event"]')).toBeNull();
    expect(container.querySelector('[data-koyomi="timegrid-event"]')).not.toBeNull();
  });
});

describe('TimeGridView - showWeekNumbers（週番号）', () => {
  it('省略時（既定 false）は data-koyomi-week-number 属性が付かない', () => {
    const { container } = render(<Harness initialView="week" />);
    expect(container.querySelector('[data-koyomi="timegrid-header"]')).not.toHaveAttribute(
      'data-koyomi-week-number',
    );
  });

  it('true にすると週ビューのヘッダー行に data-koyomi-week-number 属性が付く（2026-07-15 を含む週は第29週）', () => {
    const { container } = render(<Harness initialView="week" showWeekNumbers />);
    expect(container.querySelector('[data-koyomi="timegrid-header"]')).toHaveAttribute(
      'data-koyomi-week-number',
      '29',
    );
  });

  it('day ビューでは true でも data-koyomi-week-number 属性が付かない', () => {
    const { container } = render(<Harness initialView="day" showWeekNumbers />);
    expect(container.querySelector('[data-koyomi="timegrid-header"]')).not.toHaveAttribute(
      'data-koyomi-week-number',
    );
  });
});

describe('TimeGridView - businessHours（営業時間）', () => {
  it('省略時（既定 []）は data-koyomi-business-hours 属性が付かない', () => {
    const { container } = render(<Harness initialView="day" />);
    expect(container.querySelectorAll('[data-koyomi-business-hours]')).toHaveLength(0);
  });

  it('指定した時間帯のスロットにのみ data-koyomi-business-hours 属性が付く（2026-07-15 は水曜）', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    ];
    const { container } = render(<Harness initialView="day" businessHours={businessHours} />);
    const dayColumn = container.querySelector('[data-koyomi="timegrid-day"]');
    expect(dayColumn).not.toBeNull();
    const slots = dayColumn?.querySelectorAll('[data-koyomi="timegrid-slot"]') ?? [];
    // slotMinutes 既定 60 分: インデックス 9 = 9:00、17 = 17:00
    expect(slots[9]).toHaveAttribute('data-koyomi-business-hours', 'true');
    expect(slots[17]).not.toHaveAttribute('data-koyomi-business-hours');
    expect(slots[8]).not.toHaveAttribute('data-koyomi-business-hours');
  });

  it('1 件のルールで 22:00〜翌 2:00 を指定すると Error になる', () => {
    // startTime が endTime より前であることが必須のため、1 件の BusinessHoursRule で
    // 日をまたぐ営業時間を直接表現することはできない。
    function BadHarness(): ReactElement {
      const calendar = useCalendar({
        timeZone: TOKYO,
        now: () => NOW,
        initialDate: NOW,
        initialView: 'week',
        events: EMPTY_EVENTS,
        businessHours: [{ daysOfWeek: [2], startTime: '22:00', endTime: '02:00' }],
      });
      return (
        <CalendarProvider value={calendar}>
          <TimeGridView />
        </CalendarProvider>
      );
    }
    expect(() => render(<BadHarness />)).toThrow();
  });

  it('日をまたいで2件のルールに分けると、当日の遅い時間帯と翌日の早い時間帯の両方に data-koyomi-business-hours が付く', () => {
    // 2026-07-15 は水曜（daysOfWeek: 3）、2026-07-16 は木曜（daysOfWeek: 4）。
    // 判定が曜日ごとの独立したスロット列で行われることを利用し、日をまたいで
    // 2 件のルールに分けて指定する。
    const { container } = render(
      <Harness
        initialView="week"
        businessHours={[
          { daysOfWeek: [3], startTime: '22:00', endTime: '23:00' },
          { daysOfWeek: [4], startTime: '00:00', endTime: '02:00' },
        ]}
      />,
    );
    const wednesday = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    const thursday = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-16"]',
    );
    expect(wednesday?.querySelectorAll('[data-koyomi-business-hours]').length).toBeGreaterThan(0);
    expect(thursday?.querySelectorAll('[data-koyomi-business-hours]').length).toBeGreaterThan(0);
  });
});

describe('TimeGridView - 表示時間帯制限（slotMinTime/slotMaxTime）', () => {
  it('省略時は既定 00:00/24:00 として、スロット数・イベントの top/height %・--koyomi-timegrid-hours が従来どおりになる（回帰ペア）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="day" events={events} />);
    const dayColumn = container.querySelector('[data-koyomi="timegrid-day"]');
    expect(dayColumn?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(24);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    expect(eventEl.style.top).toBe(`${(600 / 1440) * 100}%`);
    expect(eventEl.style.height).toBe(`${(60 / 1440) * 100}%`);

    const root = container.querySelector('[data-koyomi="timegrid"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('24');
  });

  it('slotMinTime/slotMaxTime を指定すると、スロット数・イベントの top/height %・--koyomi-timegrid-hours が表示時間帯基準になる', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(
      <Harness initialView="day" events={events} slotMinTime="08:00" slotMaxTime="20:00" />,
    );
    const dayColumn = container.querySelector('[data-koyomi="timegrid-day"]');
    // 8:00〜19:00 の 12 スロット（20:00 は排他境界のため含まれない）
    expect(dayColumn?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(12);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    // 10:00（600分）は表示範囲 480〜1200 分基準で (600-480)/(1200-480)*100
    expect(eventEl.style.top).toBe(`${((600 - 480) / (1200 - 480)) * 100}%`);
    // 1 時間（60分）の高さは 60/(1200-480)*100
    expect(eventEl.style.height).toBe(`${(60 / (1200 - 480)) * 100}%`);

    const root = container.querySelector('[data-koyomi="timegrid"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('12');
  });

  it('表示時間帯の外側にしか存在しないオカレンスは timegrid-event として描画されない', () => {
    const events: CalendarEvent[] = [
      { id: 'early', title: '早朝', start: '2026-07-15T05:00', end: '2026-07-15T06:00' },
    ];
    const { container } = render(
      <Harness initialView="day" events={events} slotMinTime="08:00" slotMaxTime="20:00" />,
    );
    expect(container.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
  });

  it('now が表示時間帯の外側にあると now-indicator が描画されない', () => {
    const { container } = render(
      // NOW は 2026-07-15 10:00（東京）。表示時間帯を 08:00〜09:00 にして範囲外にする
      <Harness initialView="day" slotMinTime="08:00" slotMaxTime="09:00" />,
    );
    expect(container.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
  });
});

describe('TimeGridView - 初期スクロール位置（initialScrollTime）・命令的スクロール（scrollToTime）', () => {
  /** jsdom は scrollHeight を常に 0 として扱うため、テスト内で固定値へ差し替える。 */
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 2000,
    });
  });

  afterEach(() => {
    if (scrollHeightDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    }
  });

  function getBody(container: HTMLElement): HTMLElement {
    const body = container.querySelector('[data-koyomi="timegrid-body"]');
    if (!(body instanceof HTMLElement)) {
      throw new Error('timegrid-body が見つかりません');
    }
    return body;
  }

  it('initialScrollTime 省略時はマウント時に scrollTop が変化しない（回帰ペア）', () => {
    const { container } = render(<Harness initialView="day" />);
    expect(getBody(container).scrollTop).toBe(0);
  });

  it('initialScrollTime 指定時にマウント時 1 回だけ scrollTop が設定される', () => {
    const { container } = render(
      <Harness initialView="day" viewProps={{ initialScrollTime: '09:00' }} />,
    );
    // 9:00 = 540 分 → 540/1440 * 2000（モック済み scrollHeight）
    expect(getBody(container).scrollTop).toBe((540 / 1440) * 2000);
  });

  it('ref.current.scrollToTime(time) で任意のタイミングにスクロールできる', () => {
    const handleRef = createRef<TimeGridViewHandle>();
    const { container } = render(<Harness initialView="day" viewProps={{ ref: handleRef }} />);
    const body = getBody(container);
    expect(body.scrollTop).toBe(0);

    act(() => {
      handleRef.current?.scrollToTime('12:00');
    });
    // 12:00 = 720 分 → 720/1440 * 2000
    expect(body.scrollTop).toBe((720 / 1440) * 2000);
  });

  it('表示時間帯制限（slotMinTime/slotMaxTime）を指定していても initialScrollTime/scrollToTime は機能する（独立性の確認）', () => {
    const handleRef = createRef<TimeGridViewHandle>();
    const { container } = render(
      <Harness
        initialView="day"
        slotMinTime="08:00"
        slotMaxTime="20:00"
        viewProps={{ initialScrollTime: '10:00', ref: handleRef }}
      />,
    );
    const body = getBody(container);
    // 10:00（600分）は表示範囲 480〜1200 分基準で (600-480)/(1200-480) * 2000
    expect(body.scrollTop).toBe(((600 - 480) / (1200 - 480)) * 2000);

    act(() => {
      handleRef.current?.scrollToTime('14:00');
    });
    // 14:00（840分）は (840-480)/(1200-480) * 2000
    expect(body.scrollTop).toBe(((840 - 480) / (1200 - 480)) * 2000);
  });

  it('アンマウント後に再マウントすると initialScrollTime が再適用される', () => {
    const { container, unmount } = render(
      <Harness initialView="day" viewProps={{ initialScrollTime: '09:00' }} />,
    );
    const body = getBody(container);
    expect(body.scrollTop).toBe((540 / 1440) * 2000);
    body.scrollTop = 999; // 明示的に変更してから、アンマウント・再マウントの効果を確認する
    unmount();

    const { container: remounted } = render(
      <Harness initialView="day" viewProps={{ initialScrollTime: '09:00' }} />,
    );
    expect(getBody(remounted).scrollTop).toBe((540 / 1440) * 2000);
  });
});

describe('TimeGridView - ARIA', () => {
  it('日ヘッダー行・終日行は role="grid" の中で row/columnheader/gridcell を構成する', () => {
    const { container } = render(<Harness initialView="week" />);

    // 日ヘッダー行・終日行だけをまとめた専用ラッパー（timegrid-grid）に role="grid" が付く
    expect(container.querySelector('[data-koyomi="timegrid"]')).not.toHaveAttribute('role');
    expect(container.querySelector('[data-koyomi="timegrid-grid"]')).toHaveAttribute(
      'role',
      'grid',
    );
    expect(container.querySelector('[data-koyomi="timegrid-header"]')).toHaveAttribute(
      'role',
      'row',
    );
    expect(
      container.querySelectorAll('[data-koyomi="timegrid-day-header"][role="columnheader"]'),
    ).toHaveLength(7);
    expect(container.querySelector('[data-koyomi="allday-row"]')).toHaveAttribute('role', 'row');
    expect(container.querySelectorAll('[data-koyomi="allday-cell"][role="gridcell"]')).toHaveLength(
      7,
    );

    // 時間軸ガター（複数タイムゾーン用の余白列）は grid のセルではないため presentation
    const gutters = container.querySelectorAll('[data-koyomi="timegrid-axis-gutter"]');
    expect(gutters.length).toBeGreaterThan(0);
    for (const gutter of gutters) {
      expect(gutter).toHaveAttribute('role', 'presentation');
    }

    // row → gridcell の間に挟まるレイアウト用ラッパーは role="presentation" で
    // 所有関係を透過させる（required owned elements 違反を避ける）。
    // allday-row 自体は timegrid-grid の直接の子（余計なラッパーを挟まない）
    expect(container.querySelector('[data-koyomi="allday-row"]')?.parentElement).toBe(
      container.querySelector('[data-koyomi="timegrid-grid"]'),
    );
    expect(container.querySelector('[data-koyomi="allday-cells"]')).toHaveAttribute(
      'role',
      'presentation',
    );

    // 本文（時間軸 + 日列）は連続的な時間位置決めで離散セルに対応しないため grid 化せず、
    // role="grid" の owned elements（row/rowgroup）違反を避けるため timegrid-grid の
    // 外側（兄弟要素）に置かれる。role は付かない
    expect(container.querySelector('[data-koyomi="timegrid-body"]')).not.toHaveAttribute('role');
  });

  it('role="grid" の要素は本文の予定ボタンを子孫に含まない（WAI-ARIA grid パターンの owned elements 違反を避ける）', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);

    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    // role="grid" の直接・間接の子孫として row/rowgroup 以外の要素（予定ボタン）が
    // 現れてはいけない（role="presentation" は自身の役割を消すだけで、内部の
    // <button> はアクセシビリティツリー上 grid の子孫として露出してしまうため）
    expect(grid?.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
    // 本文コンテナ自体も role="grid" の外側（子孫ではない）に置く
    expect(grid?.querySelector('[data-koyomi="timegrid-body"]')).toBeNull();
  });

  it('終日イベントの帯（allday-event）は開始日の gridcell（allday-cell）の子孫として描画される', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '合宿', start: '2026-07-15', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(<Harness initialView="week" events={events} />);

    // 帯ボタンは複数日にまたがっても DOM 上は開始日の gridcell が所有する
    // （grid の子孫の focusable は必ず gridcell/columnheader に属するという
    // WAI-ARIA grid パターンの owned elements 要件を満たすため。視覚上のスパンは
    // allday-cells を基準にした絶対配置で実現する）
    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment).not.toBeNull();
    const owningCell = segment?.closest('[data-koyomi="allday-cell"]');
    expect(owningCell).not.toBeNull();
    expect(owningCell).toHaveAttribute('role', 'gridcell');
    expect(owningCell).toHaveAttribute('data-koyomi-date', '2026-07-15');

    // role="grid" の子孫のフォーカス可能要素はすべて gridcell / columnheader に属する
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    const focusables = grid?.querySelectorAll('button, [tabindex]') ?? [];
    expect(focusables.length).toBeGreaterThan(0);
    for (const focusable of focusables) {
      expect(focusable.closest('[role="gridcell"], [role="columnheader"]')).not.toBeNull();
    }

    // 旧方式の帯レイヤー（allday-events）は存在しない。範囲選択プレビュー
    // （day-selection、aria-hidden）は allday-cells 直下に置かれ、% オフセットが
    // テーマ変数に依存せず常に列位置と一致する
    expect(container.querySelector('[data-koyomi="allday-events"]')).toBeNull();
  });

  it('終日イベントのボタンで Enter を押してもセル（gridcell）の範囲選択は発火しない', () => {
    // 帯ボタンが gridcell の子になったため、ボタンで処理したキー操作がセルの
    // onKeyDown（Enter/Space = その日 1 日分の範囲選択）へバブルしないことを保証する
    const onSelectRange = vi.fn();
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '合宿', start: '2026-07-15', end: '2026-07-17', allDay: true },
    ];
    const { container } = render(
      <Harness initialView="week" events={events} callbacks={{ onSelectRange, onEventClick }} />,
    );

    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('終日イベントのボタンが見つかりません');
    }
    fireEvent.keyDown(segment, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('editable: false の終日イベント上の pointerdown はセルの作成ドラッグを開始しない', () => {
    // 帯ボタンが gridcell の子になったため、ボタン側で処理しない pointerdown
    // （editable: false）もセルの onPointerDown（作成ドラッグ）を誤発火させないことを保証する
    const onSelectRange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '祝日',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        editable: false,
      },
    ];
    const { container } = render(
      <Harness initialView="week" events={events} callbacks={{ onSelectRange }} />,
    );

    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('終日イベントのボタンが見つかりません');
    }
    act(() => {
      segment.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('予定ボタン上の pointerdown / keydown はカレンダー外側の祖先には従来どおり伝播する', () => {
    // 二重発火の抑止は「セル側がイベントの由来を確認して無視する」方式で行い、ボタン側で
    // stopPropagation しない。外側のラッパーの pointerdown でポップオーバーを閉じる等の
    // 利用側リスナーに届かなくなる回帰を防ぐ（editable: false でも同様）
    const onSelectRange = vi.fn();
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '祝日',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        editable: false,
      },
    ];
    const { container } = render(
      <Harness initialView="week" events={events} callbacks={{ onSelectRange }} />,
    );

    const outerPointerDown = vi.fn();
    container.addEventListener('pointerdown', outerPointerDown);

    const segment = container.querySelector('[data-koyomi="allday-event"]');
    expect(segment).toBeInstanceOf(HTMLElement);
    if (!(segment instanceof HTMLElement)) {
      throw new Error('終日イベントのボタンが見つかりません');
    }
    act(() => {
      segment.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    });

    expect(outerPointerDown).toHaveBeenCalledTimes(1);
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('終日セルの aria-label はその日の完全な日付になる', () => {
    const { container } = render(<Harness initialView="week" />);
    const cell = container.querySelector(
      '[data-koyomi="allday-cell"][data-koyomi-date="2026-07-15"]',
    );
    expect(cell).toHaveAttribute('aria-label', '2026年7月15日');
  });

  it('今日の日ヘッダーに role="columnheader" と aria-current="date" が両方付く', () => {
    const { container } = render(<Harness initialView="week" />);
    const todayHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-15"]',
    );
    expect(todayHeader).toHaveAttribute('role', 'columnheader');
    expect(todayHeader).toHaveAttribute('aria-current', 'date');

    const otherHeader = container.querySelector(
      '[data-koyomi="timegrid-day-header"][data-koyomi-date="2026-07-14"]',
    );
    expect(otherHeader).toHaveAttribute('role', 'columnheader');
    expect(otherHeader).not.toHaveAttribute('aria-current');
  });
});

describe('TimeGridView - 日列のアクセシブルネーム', () => {
  it('本文の日列（timegrid-day）に role="group" と完全な日付の aria-label が付く', () => {
    const { container } = render(<Harness initialView="week" />);
    const column = container.querySelector(
      '[data-koyomi="timegrid-day"][data-koyomi-date="2026-07-15"]',
    );
    expect(column).toHaveAttribute('role', 'group');
    expect(column).toHaveAttribute('aria-label', '2026年7月15日');
  });
});

describe('TimeGridView - 終日行のあふれ（allDayMaxEvents）', () => {
  /** 2026-07-15 を覆う単日の終日イベントを `count` 件生成する。 */
  function alldayEvents(count: number): CalendarEvent[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `allday-${index}`,
      title: `終日 ${index}`,
      start: '2026-07-15',
      end: '2026-07-16',
      allDay: true,
    }));
  }

  it('上限を超過した終日セグメントは描画されず、あふれのある日に「+N 件」ボタンが表示される', () => {
    const { container, getByRole } = render(
      <Harness initialView="week" events={alldayEvents(3)} allDayMaxEvents={2} />,
    );
    expect(container.querySelectorAll('[data-koyomi="allday-event"]')).toHaveLength(2);

    const overflowButtons = container.querySelectorAll('[data-koyomi="allday-overflow"]');
    expect(overflowButtons).toHaveLength(1);
    expect(overflowButtons[0]?.textContent).toBe('+1 件');
    // アクセシブルネームはラベル（「+N 件」）から決まる
    expect(getByRole('button', { name: '+1 件' })).toBe(overflowButtons[0]);
  });

  it('既定（allDayMaxEvents 未指定）では全セグメントが描画され、あふれボタンも高さの変化もない（対検証）', () => {
    const { container } = render(<Harness initialView="week" events={alldayEvents(5)} />);
    expect(container.querySelectorAll('[data-koyomi="allday-event"]')).toHaveLength(5);
    expect(container.querySelector('[data-koyomi="allday-overflow"]')).toBeNull();
    const cells = container.querySelector('[data-koyomi="allday-cells"]');
    expect(cells).toHaveStyle({ minHeight: 'calc(5 * var(--koyomi-lane-height, 24px))' });
  });

  it('終日行の高さ（allday-cells の minHeight）は表示レーン数＋あふれボタン行に追従する', () => {
    const { container } = render(
      <Harness initialView="week" events={alldayEvents(3)} allDayMaxEvents={2} />,
    );
    const cells = container.querySelector('[data-koyomi="allday-cells"]');
    // 表示レーン 2 本 + あふれボタン行 1 本
    expect(cells).toHaveStyle({ minHeight: 'calc(3 * var(--koyomi-lane-height, 24px))' });
  });

  it('クリックで onAllDayOverflowClick が対象日・非表示・表示中のオカレンス一覧付きで呼ばれる', () => {
    const onAllDayOverflowClick = vi.fn();
    const { container } = render(
      <Harness
        initialView="week"
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        callbacks={{ onAllDayOverflowClick }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('overflow button not found');
    }
    fireEvent.click(overflowButton);
    expect(onAllDayOverflowClick).toHaveBeenCalledTimes(1);
    const [info, hiddenOccurrences, details] = onAllDayOverflowClick.mock.calls[0] ?? [];
    expect(info).toMatchObject({ dayKey: '2026-07-15', view: 'week' });
    expect(hiddenOccurrences).toHaveLength(1);
    expect(hiddenOccurrences[0]?.eventId).toBe('allday-2');
    expect(details.visibleOccurrences).toHaveLength(2);
  });

  it('onAllDayOverflowClick 未指定なら、クリックでその日の日ビューへ切り替わる（月ビューの既定と同じ）', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness initialView="week" events={alldayEvents(3)} allDayMaxEvents={2} sink={sink} />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('overflow button not found');
    }
    fireEvent.click(overflowButton);
    expect(sink.current?.state.view).toBe('day');
  });

  it('Enter キーはクリック相当になり、親の終日セルの範囲選択（イベント作成）は発火しない', () => {
    const onAllDayOverflowClick = vi.fn();
    const onSelectRange = vi.fn();
    const { container } = render(
      <Harness
        initialView="week"
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        callbacks={{ onAllDayOverflowClick, onSelectRange }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    if (!(overflowButton instanceof HTMLElement)) {
      throw new Error('overflow button not found');
    }
    fireEvent.keyDown(overflowButton, { key: 'Enter' });
    expect(onAllDayOverflowClick).toHaveBeenCalledTimes(1);
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('overflowButtonProps の戻り値（overflowPopoverButtonProps）がボタンに反映される', () => {
    const { container } = render(
      <Harness
        initialView="week"
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        viewProps={{
          overflowButtonProps: () =>
            overflowPopoverButtonProps({ open: true, popoverId: 'allday-popover' }),
        }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    expect(overflowButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(overflowButton).toHaveAttribute('aria-expanded', 'true');
    expect(overflowButton).toHaveAttribute('aria-controls', 'allday-popover');
  });

  it('renderOverflowLabel はボタンの内側の内容だけを差し替え、ボタン要素と非表示一覧の受け渡しは保持される', () => {
    const { container } = render(
      <Harness
        initialView="week"
        events={alldayEvents(3)}
        allDayMaxEvents={2}
        viewProps={{
          renderOverflowLabel: (day, ctx) => (
            <span data-testid="custom-allday-overflow">
              {day.key}:他{ctx.hiddenOccurrences.length}件
            </span>
          ),
        }}
      />,
    );
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    expect(overflowButton).not.toBeNull();
    expect(
      overflowButton?.querySelector('[data-testid="custom-allday-overflow"]')?.textContent,
    ).toBe('2026-07-15:他1件');
  });

  it('day ビューでも同じあふれ集約が働き、ボタンは 1 列分の幅で表示される', () => {
    const { container } = render(
      <Harness initialView="day" events={alldayEvents(3)} allDayMaxEvents={2} />,
    );
    expect(container.querySelectorAll('[data-koyomi="allday-event"]')).toHaveLength(2);
    const overflowButton = container.querySelector('[data-koyomi="allday-overflow"]');
    expect(overflowButton?.textContent).toBe('+1 件');
  });
});
