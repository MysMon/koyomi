/**
 * `CalendarView` のテスト。ビューに応じた出し分けとルート要素の属性を検証する。
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarViewType } from '../../core/types';
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

/** `CalendarView` を指定ビューで描画するテスト用ラッパ。 */
function renderView(
  initialView: CalendarViewType,
  props?: CalendarViewProps,
  events?: readonly CalendarEvent[],
) {
  function Harness(): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      initialView,
      events: events ?? DEFAULT_EVENTS,
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
  });
});
