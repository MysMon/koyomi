/**
 * `CalendarView` のテスト。ビューに応じた出し分けとルート要素の属性を検証する。
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarResource, CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import type { EventContentRenderer } from '../types';
import { useCalendar } from '../use-calendar';
import type { CalendarViewProps } from './calendar-view';
import { CalendarView } from './calendar-view';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** `renderView` の既定イベント（2026-07-15 の会議 1 件）。 */
const DEFAULT_EVENTS: readonly CalendarEvent[] = [
  { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
];

/** `renderView` の既定リソース（リソース未指定時は空配列で固定参照を渡す）。 */
const EMPTY_RESOURCES: readonly CalendarResource[] = [];

/** `CalendarView` を指定ビューで描画するテスト用ラッパ。 */
function renderView(
  initialView: CalendarViewType,
  props?: CalendarViewProps,
  events?: readonly CalendarEvent[],
  resources?: readonly CalendarResource[],
) {
  function Harness(): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      initialView,
      events: events ?? DEFAULT_EVENTS,
      resources: resources ?? EMPTY_RESOURCES,
    });
    return (
      <CalendarProvider value={calendar}>
        <CalendarView {...(props ?? {})} />
      </CalendarProvider>
    );
  }
  return render(<Harness />);
}

describe('CalendarView', () => {
  it('ルート要素に data-koyomi="root" と data-koyomi-view が付く', () => {
    const { container } = renderView('month');
    const root = container.querySelector('[data-koyomi="root"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-koyomi-view')).toBe('month');
  });

  it.each([
    ['month', 'month'],
    ['week', 'timegrid'],
    ['day', 'timegrid'],
    ['list', 'list'],
    ['year', 'year'],
    ['multiMonth', 'multimonth'],
    ['resource', 'resource'],
    ['timeline', 'timeline'],
  ] as const)('ビュー %s では data-koyomi="%s" のビューが描画される', (view, expected) => {
    const { container } = renderView(view);
    expect(container.querySelector(`[data-koyomi="${expected}"]`)).not.toBeNull();
    expect(container.querySelector('[data-koyomi="root"]')?.getAttribute('data-koyomi-view')).toBe(
      view,
    );
  });

  describe('render prop / ラベル props の転送', () => {
    it('renderMonthEvent が MonthView へ転送される', () => {
      const { container } = renderView('month', {
        renderMonthEvent: (segment) => (
          <span data-testid="custom-month">{segment.occurrence.event.title}カスタム</span>
        ),
      });

      const event = container.querySelector('[data-koyomi="month-event"]');
      expect(event?.querySelector('[data-testid="custom-month"]')?.textContent).toBe(
        '会議カスタム',
      );
    });

    it('renderMonthOverflowLabel が MonthView の renderOverflowLabel へ転送される', () => {
      const events: CalendarEvent[] = [
        { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
        { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
        { id: 'e3', title: 'C', start: '2026-07-08T11:00', end: '2026-07-08T11:30' },
        { id: 'e4', title: 'D', start: '2026-07-08T12:00', end: '2026-07-08T12:30' },
        { id: 'e5', title: 'E', start: '2026-07-08T13:00', end: '2026-07-08T13:30' },
      ];
      const { container } = renderView(
        'month',
        {
          renderMonthOverflowLabel: (_day, ctx) => (
            <span data-testid="custom-overflow">残り{ctx.hiddenOccurrences.length}件</span>
          ),
        },
        events,
      );
      const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflowButton?.querySelector('[data-testid="custom-overflow"]')?.textContent).toBe(
        '残り1件',
      );
    });

    it('renderMultiMonthOverflowLabel が MultiMonthView の renderOverflowLabel へ転送される', () => {
      const events: CalendarEvent[] = [
        { id: 'e1', title: 'A', start: '2026-07-08T09:00', end: '2026-07-08T09:30' },
        { id: 'e2', title: 'B', start: '2026-07-08T10:00', end: '2026-07-08T10:30' },
        { id: 'e3', title: 'C', start: '2026-07-08T11:00', end: '2026-07-08T11:30' },
        { id: 'e4', title: 'D', start: '2026-07-08T12:00', end: '2026-07-08T12:30' },
        { id: 'e5', title: 'E', start: '2026-07-08T13:00', end: '2026-07-08T13:30' },
      ];
      const { container } = renderView(
        'multiMonth',
        {
          renderMultiMonthOverflowLabel: (_day, ctx) => (
            <span data-testid="custom-overflow">残り{ctx.hiddenOccurrences.length}件</span>
          ),
        },
        events,
      );
      const overflowButton = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflowButton?.querySelector('[data-testid="custom-overflow"]')?.textContent).toBe(
        '残り1件',
      );
    });

    it('renderTimeGridEvent が TimeGridView へ転送される', () => {
      const { container } = renderView('week', {
        renderTimeGridEvent: (item) => (
          <span data-testid="custom-timegrid">{item.occurrence.event.title}カスタム</span>
        ),
      });

      const event = container.querySelector('[data-koyomi="timegrid-event"]');
      expect(event?.querySelector('[data-testid="custom-timegrid"]')?.textContent).toBe(
        '会議カスタム',
      );
    });

    it('renderTimeGridAllDayEvent が TimeGridView の renderAllDayEvent へ転送される', () => {
      const events: CalendarEvent[] = [
        { id: 'ad1', title: '休暇', start: '2026-07-14', end: '2026-07-15', allDay: true },
      ];
      const { container } = renderView(
        'week',
        {
          renderTimeGridAllDayEvent: (segment) => (
            <span data-testid="custom-allday">{segment.occurrence.event.title}カスタム</span>
          ),
        },
        events,
      );

      const segment = container.querySelector('[data-koyomi="allday-event"]');
      expect(segment?.querySelector('[data-testid="custom-allday"]')?.textContent).toBe(
        '休暇カスタム',
      );
    });

    describe('timeGridInitialScrollTime（TimeGridView への initialScrollTime 転送）', () => {
      /** jsdom は scrollHeight を常に 0 として扱うため、テスト内で固定値へ差し替える。 */
      let scrollHeightDescriptor: PropertyDescriptor | undefined;

      beforeEach(() => {
        scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          'scrollHeight',
        );
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

      it('timeGridInitialScrollTime が TimeGridView の initialScrollTime へ転送される', () => {
        const { container } = renderView('week', { timeGridInitialScrollTime: '09:00' });
        const body = container.querySelector('[data-koyomi="timegrid-body"]');
        expect(body).not.toBeNull();
        expect((body as HTMLElement).scrollTop).toBe((540 / 1440) * 2000);
      });

      it('省略時は scrollTop が変化しない（回帰ペア）', () => {
        const { container } = renderView('week');
        const body = container.querySelector('[data-koyomi="timegrid-body"]');
        expect((body as HTMLElement).scrollTop).toBe(0);
      });
    });

    it('renderListEvent が ListView へ転送される', () => {
      const { container } = renderView('list', {
        renderListEvent: (occurrence) => (
          <span data-testid="custom-list">{occurrence.event.title}カスタム</span>
        ),
      });

      const event = container.querySelector('[data-koyomi="list-event"]');
      expect(event?.querySelector('[data-testid="custom-list"]')?.textContent).toBe('会議カスタム');
    });

    it('renderListDayHeader が ListView の renderDayHeader へ転送される', () => {
      const { container } = renderView('list', {
        renderListDayHeader: (day, ctx) => (
          <span data-testid="custom-header">
            {day.key}:{ctx.defaultContent}
          </span>
        ),
      });

      const header = container.querySelector('[data-koyomi="list-day-header"]');
      expect(header?.querySelector('[data-testid="custom-header"]')?.textContent).toBe(
        '2026-07-15:7月15日(水)',
      );
    });

    it('既定では list は ListView（非仮想化）で描画される', () => {
      const { container } = renderView('list');
      expect(container.querySelector('[data-koyomi="list"]')).not.toBeNull();
      expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
    });

    it('virtualizeList=true で VirtualListView（仮想化）に切り替わりリスト props も転送される', () => {
      const { container } = renderView('list', {
        virtualizeList: true,
        renderListEvent: (occurrence) => <span data-testid="v">{occurrence.event.title}</span>,
      });
      expect(container.querySelector('[data-koyomi-virtualized="true"]')).not.toBeNull();
      // list 系 props（renderListEvent）が VirtualListView へ転送される
      expect(container.querySelector('[data-testid="v"]')?.textContent).toBe('会議');
    });

    it('renderMonthDayCell が MonthView の renderDayCell へ転送される', () => {
      const { container } = renderView('month', {
        renderMonthDayCell: (day, ctx) => (
          <span data-testid={`custom-cell-${day.key}`}>{ctx.defaultContent}★</span>
        ),
      });

      const cell = container.querySelector('[data-testid="custom-cell-2026-07-15"]');
      expect(cell).not.toBeNull();
      expect(cell?.textContent).toContain('★');
    });

    it('monthOverflowButtonProps が MonthView の overflowButtonProps へ転送される', () => {
      const events: CalendarEvent[] = Array.from({ length: 6 }, (_, index) => ({
        id: `ov-${index}`,
        title: `予定${index}`,
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
      }));
      const { container } = renderView(
        'month',
        { monthOverflowButtonProps: () => ({ 'aria-haspopup': 'true', 'aria-expanded': false }) },
        events,
      );

      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow).toHaveAttribute('aria-haspopup', 'true');
      expect(overflow).toHaveAttribute('aria-expanded', 'false');
    });

    it('renderTimeGridDayHeader が TimeGridView の renderDayHeader へ転送される', () => {
      const { container } = renderView('week', {
        renderTimeGridDayHeader: (day, ctx) => (
          <span data-testid={`custom-day-header-${day.key}`}>{ctx.defaultContent}◎</span>
        ),
      });

      const header = container.querySelector('[data-testid="custom-day-header-2026-07-15"]');
      expect(header).not.toBeNull();
      expect(header?.textContent).toContain('◎');
    });

    it('renderYearMonthHeader が YearView へ転送される', () => {
      const { container } = renderView('year', {
        renderYearMonthHeader: (month, ctx) => (
          <div data-testid={`custom-year-header-${month.key}`}>{ctx.defaultContent}★</div>
        ),
      });

      const header = container.querySelector('[data-testid="custom-year-header-2026-07"]');
      expect(header).not.toBeNull();
      expect(header?.textContent).toContain('★');
    });

    it('renderYearDayCell が YearView へ転送される', () => {
      const { container } = renderView('year', {
        renderYearDayCell: (day, ctx) => (
          <span data-testid={`custom-year-day-${day.key}`}>{ctx.defaultContent}☆</span>
        ),
      });

      const cell = container.querySelector('[data-testid="custom-year-day-2026-07-15"]');
      expect(cell).not.toBeNull();
      expect(cell?.textContent).toContain('☆');
    });

    it('renderMultiMonthEvent が MultiMonthView へ転送される', () => {
      const { container } = renderView('multiMonth', {
        renderMultiMonthEvent: (segment) => (
          <span data-testid="custom-multimonth">{segment.occurrence.event.title}カスタム</span>
        ),
      });

      const event = container.querySelector('[data-koyomi="month-event"]');
      expect(event?.querySelector('[data-testid="custom-multimonth"]')?.textContent).toBe(
        '会議カスタム',
      );
    });

    it('multiMonthOverflowButtonProps が MultiMonthView の overflowButtonProps へ転送される', () => {
      const events: CalendarEvent[] = Array.from({ length: 6 }, (_, index) => ({
        id: `mm-ov-${index}`,
        title: `予定${index}`,
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
      }));
      const { container } = renderView(
        'multiMonth',
        {
          multiMonthOverflowButtonProps: () => ({
            'aria-haspopup': 'true',
            'aria-expanded': false,
          }),
        },
        events,
      );

      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow).toHaveAttribute('aria-haspopup', 'true');
      expect(overflow).toHaveAttribute('aria-expanded', 'false');
    });

    it('renderResourceEvent が ResourceView へ転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: '会議',
          start: '2026-07-15T10:00',
          end: '2026-07-15T11:00',
          resourceId: 'room-a',
        },
      ];
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView(
        'resource',
        {
          renderResourceEvent: (item) => (
            <span data-testid="custom-resource">{item.occurrence.event.title}カスタム</span>
          ),
        },
        events,
        resources,
      );

      const event = container.querySelector('[data-koyomi="timegrid-event"]');
      expect(event?.querySelector('[data-testid="custom-resource"]')?.textContent).toBe(
        '会議カスタム',
      );
    });

    it('renderResourceAllDayItem が ResourceView の renderAllDayItem へ転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'ad1',
          title: '休暇',
          start: '2026-07-15',
          end: '2026-07-16',
          allDay: true,
          resourceId: 'room-a',
        },
      ];
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView(
        'resource',
        {
          renderResourceAllDayItem: (occurrence) => (
            <span data-testid="custom-resource-allday">{occurrence.event.title}カスタム</span>
          ),
        },
        events,
        resources,
      );

      const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
      expect(
        alldayEvent?.querySelector('[data-testid="custom-resource-allday"]')?.textContent,
      ).toBe('休暇カスタム');
    });

    describe('resourceInitialScrollTime（ResourceView への initialScrollTime 転送）', () => {
      /** jsdom は scrollHeight を常に 0 として扱うため、テスト内で固定値へ差し替える。 */
      let scrollHeightDescriptor: PropertyDescriptor | undefined;

      beforeEach(() => {
        scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          'scrollHeight',
        );
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

      it('resourceInitialScrollTime が ResourceView の initialScrollTime へ転送される', () => {
        const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
        const { container } = renderView(
          'resource',
          { resourceInitialScrollTime: '09:00' },
          DEFAULT_EVENTS,
          resources,
        );
        // 縦スクロールはルート（[data-koyomi="resource"]）が担う（見出し行は sticky）
        const scroller = container.querySelector('[data-koyomi="resource"]');
        expect(scroller).not.toBeNull();
        expect((scroller as HTMLElement).scrollTop).toBe((540 / 1440) * 2000);
      });

      it('省略時は scrollTop が変化しない（回帰ペア）', () => {
        const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
        const { container } = renderView('resource', {}, DEFAULT_EVENTS, resources);
        const scroller = container.querySelector('[data-koyomi="resource"]');
        expect((scroller as HTMLElement).scrollTop).toBe(0);
      });
    });

    it('既定では resource は ResourceView（非仮想化）で描画される', () => {
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView('resource', {}, DEFAULT_EVENTS, resources);
      expect(container.querySelector('[data-koyomi="resource"]')).not.toBeNull();
      expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
    });

    it('virtualizeResource=true で VirtualResourceView（仮想化）に切り替わりリソース系 props も転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: '会議',
          start: '2026-07-15T10:00',
          end: '2026-07-15T11:00',
          resourceId: 'room-a',
        },
      ];
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView(
        'resource',
        {
          virtualizeResource: true,
          renderResourceEvent: (item) => <span data-testid="v">{item.occurrence.event.title}</span>,
        },
        events,
        resources,
      );
      expect(container.querySelector('[data-koyomi-virtualized="true"]')).not.toBeNull();
      // resource 系 props（renderResourceEvent）が VirtualResourceView へ転送される
      expect(container.querySelector('[data-testid="v"]')?.textContent).toBe('会議');
    });

    it('renderTimelineEvent が TimelineView へ転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: '会議',
          start: '2026-07-15T10:00',
          end: '2026-07-15T11:00',
          resourceId: 'room-a',
        },
      ];
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView(
        'timeline',
        {
          renderTimelineEvent: (item) => (
            <span data-testid="custom-timeline">{item.occurrence.event.title}カスタム</span>
          ),
        },
        events,
        resources,
      );

      const event = container.querySelector('[data-koyomi="timeline-item"]');
      expect(event?.querySelector('[data-testid="custom-timeline"]')?.textContent).toBe(
        '会議カスタム',
      );
    });

    it('既定では timeline は TimelineView（非仮想化）で描画される', () => {
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView('timeline', {}, DEFAULT_EVENTS, resources);
      expect(container.querySelector('[data-koyomi="timeline"]')).not.toBeNull();
      expect(container.querySelector('[data-koyomi-virtualized]')).toBeNull();
    });

    it('virtualizeTimeline=true で VirtualTimelineView（仮想化）に切り替わりタイムライン系 props も転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: '会議',
          start: '2026-07-15T10:00',
          end: '2026-07-15T11:00',
          resourceId: 'room-a',
        },
      ];
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      const { container } = renderView(
        'timeline',
        {
          virtualizeTimeline: true,
          renderTimelineEvent: (item) => <span data-testid="v">{item.occurrence.event.title}</span>,
        },
        events,
        resources,
      );
      expect(container.querySelector('[data-koyomi-virtualized="true"]')).not.toBeNull();
      // timeline 系 props（renderTimelineEvent）が VirtualTimelineView へ転送される
      expect(container.querySelector('[data-testid="v"]')?.textContent).toBe('会議');
    });
  });

  describe('CalendarProvider.renderEventContent（ビュー横断のイベント内容レンダラー）', () => {
    /** 中央定義 1 箇所: 既定内容の後ろに場所を添える（docs のレシピと同じ形）。 */
    const withLocation: EventContentRenderer = (occurrence, ctx) => (
      <>
        {ctx.defaultContent}
        <span data-testid="loc">＠{occurrence.event.location}</span>
      </>
    );

    /** 場所付きイベント（リソース/タイムラインでも表示されるよう resourceId を持つ）。 */
    const EVENTS: readonly CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        location: '会議室A',
        resourceId: 'room-a',
      },
    ];
    const RESOURCES: readonly CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];

    /** `renderEventContent` 付きで `CalendarView` を描画する。 */
    function renderWithCentral(
      initialView: CalendarViewType,
      events: readonly CalendarEvent[] = EVENTS,
    ) {
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView,
          events,
          resources: RESOURCES,
        });
        return (
          <CalendarProvider value={calendar} renderEventContent={withLocation}>
            <CalendarView />
          </CalendarProvider>
        );
      }
      return render(<Harness />);
    }

    it.each([
      ['month', 'month-event', '10:00 会議＠会議室A'],
      ['week', 'timegrid-event', '10:00〜11:00 会議＠会議室A'],
      ['list', 'list-event', '10:00〜11:00会議＠会議室A'],
      ['multiMonth', 'month-event', '10:00 会議＠会議室A'],
      ['resource', 'timegrid-event', '10:00〜11:00 会議＠会議室A'],
      ['timeline', 'timeline-item', '会議＠会議室A'],
    ] as const)('中央定義 1 箇所が %s ビューのイベント内容に適用され、既定の時刻表示も保たれる', (view, part, expected) => {
      const { container } = renderWithCentral(view);
      const eventEl = container.querySelector(`[data-koyomi="${part}"]`);
      expect(eventEl?.querySelector('[data-testid="loc"]')?.textContent).toBe('＠会議室A');
      expect(eventEl?.textContent).toBe(expected);
    });

    it.each([
      ['month', 'month'],
      ['week', 'week'],
      ['day', 'day'],
      ['list', 'list'],
      ['multiMonth', 'multiMonth'],
      ['resource', 'resource'],
      ['timeline', 'timeline'],
    ] as const)('%s ビューでは ctx.view に %s が渡り、スロットが同じでもビューを判別できる', (view, expected) => {
      const seenViews = new Set<string>();
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: view,
          events: EVENTS,
          resources: RESOURCES,
        });
        return (
          <CalendarProvider
            value={calendar}
            renderEventContent={(_occurrence, ctx) => {
              seenViews.add(ctx.view);
              return ctx.defaultContent;
            }}
          >
            <CalendarView />
          </CalendarProvider>
        );
      }
      render(<Harness />);
      expect(Array.from(seenViews)).toEqual([expected]);
    });

    it('renderEventContent を使っても aria-label とリサイズハンドル（ドラッグ配線）は保たれる', () => {
      const { container: monthContainer } = renderWithCentral('month');
      const monthEvent = monthContainer.querySelector('[data-koyomi="month-event"]');
      expect(monthEvent).toHaveAttribute('aria-label', '会議、7月15日 10:00〜11:00');
      expect(monthEvent?.querySelectorAll('[data-koyomi="month-event-resize"]')).toHaveLength(2);

      const { container: weekContainer } = renderWithCentral('week');
      const weekEvent = weekContainer.querySelector('[data-koyomi="timegrid-event"]');
      expect(weekEvent).toHaveAttribute('aria-label', '会議、7月15日 10:00〜11:00');
      expect(weekEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(2);
    });

    it('renderEventContent を使っても、リスト行・リソースのブロック・タイムラインの帯で境界（ボタン要素・aria-label・リサイズハンドル）は保たれる', () => {
      const { container: listContainer } = renderWithCentral('list');
      const listEvent = listContainer.querySelector('[data-koyomi="list-event"]');
      expect(listEvent?.tagName).toBe('BUTTON');
      expect(listEvent).toHaveAttribute('aria-label', '会議、7月15日 10:00〜11:00');

      const { container: resourceContainer } = renderWithCentral('resource');
      const resourceEvent = resourceContainer.querySelector('[data-koyomi="timegrid-event"]');
      expect(resourceEvent?.tagName).toBe('BUTTON');
      expect(resourceEvent).toHaveAttribute('aria-label', '会議、7月15日 10:00〜11:00、会議室A');
      expect(resourceEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(2);

      const { container: timelineContainer } = renderWithCentral('timeline');
      const timelineItem = timelineContainer.querySelector('[data-koyomi="timeline-item"]');
      expect(timelineItem?.tagName).toBe('BUTTON');
      expect(timelineItem).toHaveAttribute('aria-label', '会議、7月15日 10:00〜11:00、会議室A');
      expect(timelineItem?.querySelectorAll('[data-koyomi="timeline-resize"]')).toHaveLength(2);
    });

    it('renderEventContent を使っても、終日帯（allday-event）の aria-label とリサイズハンドルは保たれる', () => {
      const allDayEvents: readonly CalendarEvent[] = [
        {
          id: 'ad1',
          title: '休暇',
          start: '2026-07-14',
          end: '2026-07-16',
          allDay: true,
          location: '軽井沢',
          resourceId: 'room-a',
        },
      ];
      const { container } = renderWithCentral('week', allDayEvents);
      const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
      expect(alldayEvent?.tagName).toBe('BUTTON');
      // 中央定義（＠場所）が終日帯にも適用されている
      expect(alldayEvent?.querySelector('[data-testid="loc"]')?.textContent).toBe('＠軽井沢');
      expect(alldayEvent).toHaveAttribute('aria-label', '休暇、7月14日〜7月15日');
      expect(alldayEvent?.querySelectorAll('[data-koyomi="allday-resize"]')).toHaveLength(2);
    });
  });
});
