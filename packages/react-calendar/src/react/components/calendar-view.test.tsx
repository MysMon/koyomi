/**
 * `CalendarView` のテスト。ビューに応じた出し分けとルート要素の属性を検証する。
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import { useCalendar } from '../use-calendar';
import { CalendarView } from './calendar-view';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** `CalendarView` を指定ビューで描画するテスト用ラッパ。 */
function renderView(initialView: CalendarViewType) {
  function Harness(): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      initialView,
      events: [{ id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' }],
    });
    return (
      <CalendarProvider value={calendar}>
        <CalendarView />
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
});
