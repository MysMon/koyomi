/**
 * `CalendarView` のテスト。ビューに応じた出し分けとルート要素の属性を検証する。
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarResource, CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
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

    it('monthEventAriaLabel が MonthView の eventAriaLabel へ転送される', () => {
      const { container } = renderView('month', {
        monthEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}`,
      });

      const event = container.querySelector('[data-koyomi="month-event"]');
      expect(event?.getAttribute('aria-label')).toBe('カスタム:会議、7月15日 10:00〜11:00');
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

    it('timeGridEventAriaLabel が TimeGridView の eventAriaLabel へ転送される', () => {
      const { container } = renderView('week', {
        timeGridEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}`,
      });

      const event = container.querySelector('[data-koyomi="timegrid-event"]');
      expect(event?.getAttribute('aria-label')).toBe('カスタム:会議、7月15日 10:00〜11:00');
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

    it('renderListEvent が ListView へ転送される', () => {
      const { container } = renderView('list', {
        renderListEvent: (occurrence) => (
          <span data-testid="custom-list">{occurrence.event.title}カスタム</span>
        ),
      });

      const event = container.querySelector('[data-koyomi="list-event"]');
      expect(event?.querySelector('[data-testid="custom-list"]')?.textContent).toBe('会議カスタム');
    });

    it('listAllDayLabel が ListView の allDayLabel へ転送される', () => {
      const events: CalendarEvent[] = [
        {
          id: 'allday',
          title: '終日イベント',
          start: '2026-07-16',
          end: '2026-07-17',
          allDay: true,
        },
      ];
      const { container } = renderView('list', { listAllDayLabel: 'All day' }, events);

      const time = container.querySelector('[data-koyomi="list-event-time"]');
      expect(time?.textContent).toBe('All day');
    });

    it('listEmptyLabel が ListView の emptyLabel へ転送される', () => {
      const { container } = renderView('list', { listEmptyLabel: 'No events' }, []);

      const empty = container.querySelector('[data-koyomi="list-empty"]');
      expect(empty?.textContent).toBe('No events');
    });

    it('renderListDayHeader が ListView の renderDayHeader へ転送される', () => {
      const { container } = renderView('list', {
        renderListDayHeader: (day, defaultContent) => (
          <span data-testid="custom-header">
            {day.key}:{defaultContent}
          </span>
        ),
      });

      const header = container.querySelector('[data-koyomi="list-day-header"]');
      expect(header?.querySelector('[data-testid="custom-header"]')?.textContent).toBe(
        '2026-07-15:7月15日(水)',
      );
    });

    it('listEventAriaLabel が ListView / VirtualListView の eventAriaLabel へ転送される', () => {
      const nonVirtual = renderView('list', {
        listEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}`,
      });
      expect(
        nonVirtual.container
          .querySelector('[data-koyomi="list-event"]')
          ?.getAttribute('aria-label'),
      ).toBe('カスタム:会議、7月15日 10:00〜11:00');

      const virtual = renderView('list', {
        virtualizeList: true,
        listEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}`,
      });
      expect(
        virtual.container.querySelector('[data-koyomi="list-event"]')?.getAttribute('aria-label'),
      ).toBe('カスタム:会議、7月15日 10:00〜11:00');
    });

    it('listDayAriaLabel が ListView / VirtualListView の dayAriaLabel へ転送される', () => {
      const nonVirtual = renderView('list', {
        listDayAriaLabel: (day, defaultLabel) => `カスタム:${day.key}:${defaultLabel}`,
      });
      expect(
        nonVirtual.container.querySelector('[data-koyomi="list-day"]')?.getAttribute('aria-label'),
      ).toBe('カスタム:2026-07-15:7月15日(水) 予定1件');

      const virtual = renderView('list', {
        virtualizeList: true,
        listDayAriaLabel: (day, defaultLabel) => `カスタム:${day.key}:${defaultLabel}`,
      });
      expect(
        virtual.container.querySelector('[data-koyomi="list-day"]')?.getAttribute('aria-label'),
      ).toBe('カスタム:2026-07-15:7月15日(水) 予定1件');
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
        renderMonthDayCell: (day, defaultContent) => (
          <span data-testid={`custom-cell-${day.key}`}>{defaultContent}★</span>
        ),
      });

      const cell = container.querySelector('[data-testid="custom-cell-2026-07-15"]');
      expect(cell).not.toBeNull();
      expect(cell?.textContent).toContain('★');
    });

    it('monthOverflowLabel が MonthView の overflowLabel へ転送される', () => {
      // dayMaxEvents 既定 4 を超えるイベントを同日に 6 件並べて「+N 件」を発生させる
      const events: CalendarEvent[] = Array.from({ length: 6 }, (_, index) => ({
        id: `ov-${index}`,
        title: `予定${index}`,
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
      }));
      const { container } = renderView(
        'month',
        { monthOverflowLabel: (count) => `他 ${count} 件を表示` },
        events,
      );

      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow?.textContent).toContain('他');
      expect(overflow?.textContent).toContain('件を表示');
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
        renderTimeGridDayHeader: (day, defaultContent) => (
          <span data-testid={`custom-day-header-${day.key}`}>{defaultContent}◎</span>
        ),
      });

      const header = container.querySelector('[data-testid="custom-day-header-2026-07-15"]');
      expect(header).not.toBeNull();
      expect(header?.textContent).toContain('◎');
    });

    it('renderYearMonthHeader が YearView へ転送される', () => {
      const { container } = renderView('year', {
        renderYearMonthHeader: (month, defaultContent) => (
          <div data-testid={`custom-year-header-${month.key}`}>{defaultContent}★</div>
        ),
      });

      const header = container.querySelector('[data-testid="custom-year-header-2026-07"]');
      expect(header).not.toBeNull();
      expect(header?.textContent).toContain('★');
    });

    it('renderYearDayCell が YearView へ転送される', () => {
      const { container } = renderView('year', {
        renderYearDayCell: (day, defaultContent) => (
          <span data-testid={`custom-year-day-${day.key}`}>{defaultContent}☆</span>
        ),
      });

      const cell = container.querySelector('[data-testid="custom-year-day-2026-07-15"]');
      expect(cell).not.toBeNull();
      expect(cell?.textContent).toContain('☆');
    });

    it('yearDayCountLabel が YearView の dayCountLabel へ転送される', () => {
      const { container } = renderView('year', {
        yearDayCountLabel: (count) => `${count} events`,
      });

      const day = container.querySelector('[data-koyomi-date="2026-07-15"]');
      expect(day).toHaveAttribute('aria-label', '7月15日 1 events');
    });

    it('yearDayAriaLabel が YearView の dayAriaLabel へ転送される', () => {
      const { container } = renderView('year', {
        yearDayAriaLabel: (day, defaultLabel) => `カスタム:${day.key}:${defaultLabel}`,
      });

      const day = container.querySelector('[data-koyomi-date="2026-07-15"]');
      expect(day).toHaveAttribute('aria-label', 'カスタム:2026-07-15:7月15日 予定1件');
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

    it('multiMonthOverflowLabel が MultiMonthView の overflowLabel へ転送される', () => {
      // dayMaxEvents 既定 4 を超えるイベントを同日に 6 件並べて「+N 件」を発生させる
      const events: CalendarEvent[] = Array.from({ length: 6 }, (_, index) => ({
        id: `mm-ov-${index}`,
        title: `予定${index}`,
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
      }));
      const { container } = renderView(
        'multiMonth',
        { multiMonthOverflowLabel: (count) => `他 ${count} 件を表示` },
        events,
      );

      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow?.textContent).toContain('他');
      expect(overflow?.textContent).toContain('件を表示');
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

    it('multiMonthEventAriaLabel が MultiMonthView の eventAriaLabel へ転送される', () => {
      const { container } = renderView('multiMonth', {
        multiMonthEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}`,
      });

      const event = container.querySelector('[data-koyomi="month-event"]');
      expect(event?.getAttribute('aria-label')).toBe('カスタム:会議、7月15日 10:00〜11:00');
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

    it('resourceUnassignedLabel が ResourceView の unassignedLabel へ転送される', () => {
      const resources: CalendarResource[] = [{ id: 'room-a', title: '会議室A' }];
      // DEFAULT_EVENTS は resourceId 未指定 → unassignedLane 既定 'auto' でも
      // 未割り当て列が作られる（resource-view.test.tsx と同じ理由）
      const { container } = renderView(
        'resource',
        { resourceUnassignedLabel: '担当未定' },
        DEFAULT_EVENTS,
        resources,
      );

      const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
      const unassignedHeader = headers[headers.length - 1];
      expect(unassignedHeader?.textContent).toBe('担当未定');
    });

    it('resourceEventAriaLabel が ResourceView の eventAriaLabel へ転送される', () => {
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
        { resourceEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}` },
        events,
        resources,
      );

      const event = container.querySelector('[data-koyomi="timegrid-event"]');
      expect(event?.getAttribute('aria-label')).toBe(
        'カスタム:会議、7月15日 10:00〜11:00、会議室A',
      );
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

    it('timelineEventAriaLabel が TimelineView の eventAriaLabel へ転送される', () => {
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
        { timelineEventAriaLabel: (_occurrence, defaultLabel) => `カスタム:${defaultLabel}` },
        events,
        resources,
      );

      const event = container.querySelector('[data-koyomi="timeline-item"]');
      expect(event?.getAttribute('aria-label')).toBe(
        'カスタム:会議、7月15日 10:00〜11:00、会議室A',
      );
    });

    it('timelineEmptyLabel が TimelineView の emptyLabel へ転送される', () => {
      const { container } = renderView(
        'timeline',
        { timelineEmptyLabel: '担当者がいません' },
        [],
        [],
      );

      const empty = container.querySelector('[data-koyomi="timeline-empty"]');
      expect(empty?.textContent).toBe('担当者がいません');
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
});
