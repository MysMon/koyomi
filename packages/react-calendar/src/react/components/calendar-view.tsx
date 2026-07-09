/**
 * @packageDocumentation
 * `CalendarView` — 現在のビューに応じてビューコンポーネントを出し分けるスイッチ。
 */

import type { ReactElement, ReactNode } from 'react';
import type {
  EventOccurrence,
  EventSegment,
  ListDay,
  MonthDay,
  PositionedOccurrence,
  TimeGridDay,
  YearDay,
  YearMonth,
} from '../../core/types';
import { useCalendarContext } from '../context';
import { ListView } from './list-view';
import { MonthView } from './month-view';
import { TimeGridView } from './time-grid-view';
import { VirtualListView } from './virtual-list-view';
import { YearView } from './year-view';

/**
 * `CalendarView` の props。各ビューのカスタム描画関数・ラベル props を転送する。
 *
 * 命名は転送先のビュー名を接頭辞に持つ（例: `renderListEvent` → `ListView`
 * の `renderEvent`）。これは複数のビューが同名の prop（例: 各ビューの
 * `renderDayHeader`）を持ちうるため、1 つの `CalendarViewProps` 内で
 * 衝突しないようにする命名規則。
 */
export interface CalendarViewProps {
  /** 月ビューのセグメントのカスタム描画。`MonthView` の `renderEvent` に転送する。 */
  renderMonthEvent?: (segment: EventSegment) => ReactNode;
  /** 週/日ビューのイベントブロックのカスタム描画。`TimeGridView` の `renderEvent` に転送する。 */
  renderTimeGridEvent?: (item: PositionedOccurrence) => ReactNode;
  /** リストビューのイベント行のカスタム描画。`ListView` の `renderEvent` に転送する。 */
  renderListEvent?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * リストビューの終日イベント時刻ラベル。`ListView` の `allDayLabel` に転送する。
   * 省略時は「終日」。
   */
  listAllDayLabel?: ReactNode;
  /**
   * リストビューの空状態メッセージ。`ListView` の `emptyLabel` に転送する。
   * 省略時は「予定はありません」。
   */
  listEmptyLabel?: ReactNode;
  /** リストビューの日付見出しのカスタム描画。`ListView` の `renderDayHeader` に転送する。 */
  renderListDayHeader?: (day: ListDay, defaultContent: ReactNode) => ReactNode;
  /**
   * リストビューを仮想化する（`ListView` の代わりに `VirtualListView` を使う）。
   * 大量の予定・長期間表示での DOM 肥大を抑える。既定 `false`（全件描画の `ListView`）。
   * 有効時はスクロールコンテナに境界高を CSS で与えること
   * （`[data-koyomi="list"][data-koyomi-virtualized]`）。詳細は `VirtualListView` を参照。
   * リスト系のカスタム描画・ラベル（`renderListEvent` 等）はそのまま転送される。
   */
  virtualizeList?: boolean;
  /** 仮想化時の日セクション推定高。`VirtualListView` の `estimateDayHeight` に転送する。 */
  listEstimateDayHeight?: number | ((day: ListDay, index: number) => number);
  /** 仮想化時の前後 overscan 日数。`VirtualListView` の `overscan` に転送する。 */
  listOverscan?: number;
  /** 月ビューの日セルのカスタム描画。`MonthView` の `renderDayCell` に転送する。 */
  renderMonthDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
  /**
   * 月ビューの「+N 件」ラベル。`MonthView` の `overflowLabel` に転送する。
   * 省略時は `+N 件`。
   */
  monthOverflowLabel?: (count: number) => ReactNode;
  /** 週/日ビューの日ヘッダーのカスタム描画。`TimeGridView` の `renderDayHeader` に転送する。 */
  renderTimeGridDayHeader?: (day: TimeGridDay, defaultContent: ReactNode) => ReactNode;
  /** 年ビューの月見出しのカスタム描画。`YearView` の `renderMonthHeader` に転送する。 */
  renderYearMonthHeader?: (month: YearMonth, defaultContent: ReactNode) => ReactNode;
  /** 年ビューの日セルのカスタム描画。`YearView` の `renderDayCell` に転送する。 */
  renderYearDayCell?: (day: YearDay, defaultContent: ReactNode) => ReactNode;
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
          <MonthView
            {...(props.renderMonthEvent ? { renderEvent: props.renderMonthEvent } : {})}
            {...(props.renderMonthDayCell ? { renderDayCell: props.renderMonthDayCell } : {})}
            {...(props.monthOverflowLabel ? { overflowLabel: props.monthOverflowLabel } : {})}
          />
        );
      case 'week':
      case 'day':
        return (
          <TimeGridView
            {...(props.renderTimeGridEvent ? { renderEvent: props.renderTimeGridEvent } : {})}
            {...(props.renderTimeGridDayHeader
              ? { renderDayHeader: props.renderTimeGridDayHeader }
              : {})}
          />
        );
      case 'list': {
        // 共通のリスト系 props（ListView / VirtualListView で同じ）。
        const listProps = {
          ...(props.renderListEvent ? { renderEvent: props.renderListEvent } : {}),
          ...(props.listAllDayLabel !== undefined ? { allDayLabel: props.listAllDayLabel } : {}),
          ...(props.listEmptyLabel !== undefined ? { emptyLabel: props.listEmptyLabel } : {}),
          ...(props.renderListDayHeader ? { renderDayHeader: props.renderListDayHeader } : {}),
        };
        if (props.virtualizeList === true) {
          return (
            <VirtualListView
              {...listProps}
              {...(props.listEstimateDayHeight !== undefined
                ? { estimateDayHeight: props.listEstimateDayHeight }
                : {})}
              {...(props.listOverscan !== undefined ? { overscan: props.listOverscan } : {})}
            />
          );
        }
        return <ListView {...listProps} />;
      }
      case 'year':
        return (
          <YearView
            {...(props.renderYearMonthHeader
              ? { renderMonthHeader: props.renderYearMonthHeader }
              : {})}
            {...(props.renderYearDayCell ? { renderDayCell: props.renderYearDayCell } : {})}
          />
        );
    }
  }

  return (
    <div data-koyomi="root" data-koyomi-view={state.view}>
      {view()}
    </div>
  );
}
