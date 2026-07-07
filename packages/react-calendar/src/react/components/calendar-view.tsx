/**
 * @packageDocumentation
 * `CalendarView` — 現在のビューに応じてビューコンポーネントを出し分けるスイッチ。
 */

import type { ReactElement, ReactNode } from 'react';
import type { EventOccurrence, EventSegment, PositionedOccurrence } from '../../core/types';
import { useCalendarContext } from '../context';
import { ListView } from './list-view';
import { MonthView } from './month-view';
import { TimeGridView } from './time-grid-view';

/** `CalendarView` の props。各ビューのカスタム描画関数を転送する。 */
export interface CalendarViewProps {
  /** 月ビューのセグメントのカスタム描画。 */
  renderMonthEvent?: (segment: EventSegment) => ReactNode;
  /** 週/日ビューのイベントブロックのカスタム描画。 */
  renderTimeGridEvent?: (item: PositionedOccurrence) => ReactNode;
  /** リストビューのイベント行のカスタム描画。 */
  renderListEvent?: (occurrence: EventOccurrence) => ReactNode;
}

/**
 * 現在のビュー（`state.view`）に応じて `MonthView` / `TimeGridView` /
 * `ListView` を出し分けるコンポーネント。
 *
 * `CalendarProvider` の配下で使用する。ルート要素には
 * `data-koyomi="root"` と `data-koyomi-view` が付き、デフォルトテーマの
 * 適用起点になる。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar();
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick: openDetail }}>
 *     <Toolbar />
 *     <CalendarView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function CalendarView(props: CalendarViewProps): ReactElement {
  const { state } = useCalendarContext();

  /** 現在のビューに対応するコンポーネントを返す。 */
  function view(): ReactElement | null {
    switch (state.view) {
      case 'month':
        return (
          <MonthView {...(props.renderMonthEvent ? { renderEvent: props.renderMonthEvent } : {})} />
        );
      case 'week':
      case 'day':
        return (
          <TimeGridView
            {...(props.renderTimeGridEvent ? { renderEvent: props.renderTimeGridEvent } : {})}
          />
        );
      case 'list':
        return (
          <ListView {...(props.renderListEvent ? { renderEvent: props.renderListEvent } : {})} />
        );
    }
  }

  return (
    <div data-koyomi="root" data-koyomi-view={state.view}>
      {view()}
    </div>
  );
}
