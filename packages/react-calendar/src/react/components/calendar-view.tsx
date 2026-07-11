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
  ResourceColumn,
  TimeGridDay,
  TimelineItem,
  TimelineRow,
  YearDay,
  YearMonth,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { MonthOverflowButtonProps } from '../types';
import { ListView } from './list-view';
import { MonthView } from './month-view';
import { MultiMonthView } from './multi-month-view';
import { ResourceView } from './resource-view';
import { TimeGridView } from './time-grid-view';
import { TimelineView } from './timeline-view';
import { VirtualListView } from './virtual-list-view';
import { VirtualResourceView } from './virtual-resource-view';
import { VirtualTimelineView } from './virtual-timeline-view';
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
  /**
   * 月ビューのイベントボタンの aria-label。既定文字列を受け取って加工・置換できる。
   * `MonthView` の `eventAriaLabel` に転送する。
   */
  monthEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /** 週/日ビューのイベントブロックのカスタム描画。`TimeGridView` の `renderEvent` に転送する。 */
  renderTimeGridEvent?: (item: PositionedOccurrence) => ReactNode;
  /**
   * 週/日ビューの終日行の帯のカスタム描画。`TimeGridView` の `renderAllDayEvent` に転送する。
   * 省略時はタイトルのみ。
   */
  renderTimeGridAllDayEvent?: (segment: EventSegment) => ReactNode;
  /**
   * 週/日ビューのイベントブロック（終日行含む）の aria-label。既定文字列を受け取って
   * 加工・置換できる。`TimeGridView` の `eventAriaLabel` に転送する。
   */
  timeGridEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /** リストビューのイベント行のカスタム描画。`ListView` の `renderEvent` に転送する。 */
  renderListEvent?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * リストビューのイベント行の aria-label。既定文字列を受け取って加工・置換できる。
   * `ListView` / `VirtualListView` の `eventAriaLabel` に転送する。
   */
  listEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /**
   * リストビューの日セクションの aria-label。既定文字列を受け取って加工・置換できる。
   * `ListView` / `VirtualListView` の `dayAriaLabel` に転送する。
   */
  listDayAriaLabel?: (day: ListDay, defaultLabel: string) => string;
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
  /**
   * 月ビューの「+N 件」ボタンに追加する props。`MonthView` の `overflowButtonProps` に転送する。
   * `aria-haspopup` / `aria-expanded` など、自前のポップオーバー UI と連携する ARIA 属性を
   * 付与する用途に使う。
   */
  monthOverflowButtonProps?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
  /** 週/日ビューの日ヘッダーのカスタム描画。`TimeGridView` の `renderDayHeader` に転送する。 */
  renderTimeGridDayHeader?: (day: TimeGridDay, defaultContent: ReactNode) => ReactNode;
  /** 年ビューの月見出しのカスタム描画。`YearView` の `renderMonthHeader` に転送する。 */
  renderYearMonthHeader?: (month: YearMonth, defaultContent: ReactNode) => ReactNode;
  /** 年ビューの日セルのカスタム描画。`YearView` の `renderDayCell` に転送する。 */
  renderYearDayCell?: (day: YearDay, defaultContent: ReactNode) => ReactNode;
  /**
   * 年ビューの日セルの aria-label に含める件数文言（「予定N件」部分）。
   * `YearView` の `dayCountLabel` に転送する。
   */
  yearDayCountLabel?: (count: number) => string;
  /**
   * 年ビューの日セルの aria-label 全体。既定文字列を受け取って加工・置換できる。
   * `YearView` の `dayAriaLabel` に転送する。
   */
  yearDayAriaLabel?: (day: YearDay, defaultLabel: string) => string;
  /** 複数月ビューのセグメントのカスタム描画。`MultiMonthView` の `renderEvent` に転送する。 */
  renderMultiMonthEvent?: (segment: EventSegment) => ReactNode;
  /**
   * 複数月ビューのイベントボタンの aria-label。既定文字列を受け取って加工・置換できる。
   * `MultiMonthView` の `eventAriaLabel` に転送する。
   */
  multiMonthEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /** 複数月ビューの日セルのカスタム描画。`MultiMonthView` の `renderDayCell` に転送する。 */
  renderMultiMonthDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
  /**
   * 複数月ビューの「+N 件」ラベル。`MultiMonthView` の `overflowLabel` に転送する。
   * 省略時は `+N 件`。
   */
  multiMonthOverflowLabel?: (count: number) => ReactNode;
  /**
   * 複数月ビューの「+N 件」ボタンに追加する props。`MultiMonthView` の
   * `overflowButtonProps` に転送する。
   */
  multiMonthOverflowButtonProps?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
  /**
   * リソースビューのイベントブロックのカスタム描画。`ResourceView` / `VirtualResourceView` の
   * `renderEvent` に転送する（時間指定のみ。終日は `renderResourceAllDayItem` を使う）。
   */
  renderResourceEvent?: (item: PositionedOccurrence) => ReactNode;
  /**
   * リソースビューの終日アイテムのカスタム描画。`ResourceView` / `VirtualResourceView` の
   * `renderAllDayItem` に転送する。省略時はタイトルのみ。
   */
  renderResourceAllDayItem?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * リソースビューの列見出しのカスタム描画。`ResourceView` / `VirtualResourceView` の
   * `renderColumnHeader` に転送する。
   */
  renderResourceColumnHeader?: (column: ResourceColumn, defaultContent: ReactNode) => ReactNode;
  /**
   * リソースビューの未割り当て列ラベル。`ResourceView` / `VirtualResourceView` の
   * `unassignedLabel` に転送する。省略時は「未割り当て」。
   */
  resourceUnassignedLabel?: ReactNode;
  /**
   * リソースビューの空状態メッセージ。`ResourceView` / `VirtualResourceView` の `emptyLabel` に
   * 転送する。省略時は「リソースがありません」。
   */
  resourceEmptyLabel?: ReactNode;
  /**
   * リソースビューのイベントブロックの aria-label。既定文字列を受け取って加工・置換できる。
   * `ResourceView` / `VirtualResourceView` の `eventAriaLabel` に転送する。
   */
  resourceEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /**
   * リソースビューを仮想化する（`ResourceView` の代わりに `VirtualResourceView` を使う）。
   * 数百列規模のリソースでの DOM 肥大を抑える。既定 `false`（全件描画の `ResourceView`）。
   * 有効時はスクロールコンテナに境界幅を CSS で与えること
   * （`[data-koyomi="resource"][data-koyomi-virtualized]`）。詳細は `VirtualResourceView` を参照。
   * リソース系のカスタム描画・ラベル（`renderResourceEvent` 等）はそのまま転送される。
   */
  virtualizeResource?: boolean;
  /** タイムラインの帯のカスタム描画。`TimelineView` の `renderEvent` に転送する。 */
  renderTimelineEvent?: (item: TimelineItem) => ReactNode;
  /** タイムラインの行見出しのカスタム描画。`TimelineView` の `renderRowHeader` に転送する。 */
  renderTimelineRowHeader?: (row: TimelineRow, defaultContent: ReactNode) => ReactNode;
  /**
   * タイムラインの未割り当て行ラベル。`TimelineView` の `unassignedLabel` に転送する。
   * 省略時は「未割り当て」。
   */
  timelineUnassignedLabel?: ReactNode;
  /**
   * タイムラインの空状態メッセージ。`TimelineView` の `emptyLabel` に転送する。
   * 省略時は「リソースがありません」。
   */
  timelineEmptyLabel?: ReactNode;
  /**
   * タイムラインのヘッダー行の角セルの `aria-label`。`TimelineView` の
   * `cornerLabel` に転送する。省略時は「リソース」。
   */
  timelineCornerLabel?: string;
  /**
   * タイムラインの帯の aria-label。既定文字列を受け取って加工・置換できる。
   * `TimelineView` / `VirtualTimelineView` の `eventAriaLabel` に転送する。
   */
  timelineEventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /**
   * タイムラインを仮想化する（`TimelineView` の代わりに `VirtualTimelineView` を使う）。
   * 数百行規模のリソースでの DOM 肥大を抑える。既定 `false`（全件描画の `TimelineView`）。
   * 有効時はスクロールコンテナに境界高を CSS で与えること（`[data-koyomi="timeline-body"]`）。
   * 詳細は `VirtualTimelineView` を参照。タイムライン系のカスタム描画・ラベル
   * （`renderTimelineEvent` 等）はそのまま転送される。
   */
  virtualizeTimeline?: boolean;
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
            {...(props.monthOverflowButtonProps
              ? { overflowButtonProps: props.monthOverflowButtonProps }
              : {})}
            {...(props.monthEventAriaLabel ? { eventAriaLabel: props.monthEventAriaLabel } : {})}
          />
        );
      case 'week':
      case 'day':
        return (
          <TimeGridView
            {...(props.renderTimeGridEvent ? { renderEvent: props.renderTimeGridEvent } : {})}
            {...(props.renderTimeGridAllDayEvent
              ? { renderAllDayEvent: props.renderTimeGridAllDayEvent }
              : {})}
            {...(props.renderTimeGridDayHeader
              ? { renderDayHeader: props.renderTimeGridDayHeader }
              : {})}
            {...(props.timeGridEventAriaLabel
              ? { eventAriaLabel: props.timeGridEventAriaLabel }
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
          ...(props.listEventAriaLabel ? { eventAriaLabel: props.listEventAriaLabel } : {}),
          ...(props.listDayAriaLabel ? { dayAriaLabel: props.listDayAriaLabel } : {}),
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
            {...(props.yearDayCountLabel ? { dayCountLabel: props.yearDayCountLabel } : {})}
            {...(props.yearDayAriaLabel ? { dayAriaLabel: props.yearDayAriaLabel } : {})}
          />
        );
      case 'multiMonth':
        return (
          <MultiMonthView
            {...(props.renderMultiMonthEvent ? { renderEvent: props.renderMultiMonthEvent } : {})}
            {...(props.renderMultiMonthDayCell
              ? { renderDayCell: props.renderMultiMonthDayCell }
              : {})}
            {...(props.multiMonthOverflowLabel
              ? { overflowLabel: props.multiMonthOverflowLabel }
              : {})}
            {...(props.multiMonthOverflowButtonProps
              ? { overflowButtonProps: props.multiMonthOverflowButtonProps }
              : {})}
            {...(props.multiMonthEventAriaLabel
              ? { eventAriaLabel: props.multiMonthEventAriaLabel }
              : {})}
          />
        );
      case 'resource': {
        // 共通のリソース系 props（ResourceView / VirtualResourceView で同じ）。
        const resourceProps = {
          ...(props.renderResourceEvent ? { renderEvent: props.renderResourceEvent } : {}),
          ...(props.renderResourceAllDayItem
            ? { renderAllDayItem: props.renderResourceAllDayItem }
            : {}),
          ...(props.renderResourceColumnHeader
            ? { renderColumnHeader: props.renderResourceColumnHeader }
            : {}),
          ...(props.resourceUnassignedLabel !== undefined
            ? { unassignedLabel: props.resourceUnassignedLabel }
            : {}),
          ...(props.resourceEmptyLabel !== undefined
            ? { emptyLabel: props.resourceEmptyLabel }
            : {}),
          ...(props.resourceEventAriaLabel ? { eventAriaLabel: props.resourceEventAriaLabel } : {}),
        };
        if (props.virtualizeResource === true) {
          return <VirtualResourceView {...resourceProps} />;
        }
        return <ResourceView {...resourceProps} />;
      }
      case 'timeline': {
        // 共通のタイムライン系 props（TimelineView / VirtualTimelineView で同じ）。
        const timelineProps = {
          ...(props.renderTimelineEvent ? { renderEvent: props.renderTimelineEvent } : {}),
          ...(props.renderTimelineRowHeader
            ? { renderRowHeader: props.renderTimelineRowHeader }
            : {}),
          ...(props.timelineUnassignedLabel !== undefined
            ? { unassignedLabel: props.timelineUnassignedLabel }
            : {}),
          ...(props.timelineCornerLabel !== undefined
            ? { cornerLabel: props.timelineCornerLabel }
            : {}),
          ...(props.timelineEmptyLabel !== undefined
            ? { emptyLabel: props.timelineEmptyLabel }
            : {}),
          ...(props.timelineEventAriaLabel ? { eventAriaLabel: props.timelineEventAriaLabel } : {}),
        };
        if (props.virtualizeTimeline === true) {
          return <VirtualTimelineView {...timelineProps} />;
        }
        return <TimelineView {...timelineProps} />;
      }
    }
  }

  return (
    <div data-koyomi="root" data-koyomi-view={state.view}>
      {view()}
    </div>
  );
}
