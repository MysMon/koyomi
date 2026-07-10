/**
 * @packageDocumentation
 * 英語 (en-US) の既定文言プリセット。
 *
 * ビルトインコンポーネントの `*Label` 系 props（既定値は日本語）を英語化した
 * 値の集合をコンポーネント単位でまとめる。既定値（日本語）自体は変更しない
 * 後方互換なプリセットで、英語 UI にしたい場合にのみ明示的にこの値を渡す。
 */

import type { ReactNode } from 'react';
import type { CalendarViewProps } from '../components/calendar-view';
import type { ListViewProps } from '../components/list-view';
import type { MonthViewProps } from '../components/month-view';
import type { MultiMonthViewProps } from '../components/multi-month-view';
import type { ResourceViewProps } from '../components/resource-view';
import type { TimelineViewProps } from '../components/timeline-view';
import type { ToolbarLabels } from '../components/toolbar';
import type { VirtualListViewProps } from '../components/virtual-list-view';
import type { VirtualResourceViewProps } from '../components/virtual-resource-view';
import type { VirtualTimelineViewProps } from '../components/virtual-timeline-view';

/**
 * `T` のうち、プロパティ名が `Label` で終わるキーだけを抽出する型。
 * （`renderEvent` や `overflowButtonProps` のような非ラベル props を除外する。）
 */
type LabelKeys<T> = Extract<keyof T, `${string}Label`>;

/**
 * `T` の `*Label` 系 props をすべて必須化した型。
 *
 * プリセットのオブジェクトリテラルをこの型に対して `satisfies` すると、
 * 「必須プロパティの欠落（新しい既定文言 props の追加漏れ）」と
 * 「余分なプロパティ（存在しないキーの誤記）」の両方が型チェックの時点
 * （`pnpm typecheck` / `pnpm check`）で検出される。これが、将来コンポーネントに
 * 新しい既定文言 props が増えたときプリセットの更新漏れを機械的に見つける仕組み。
 */
type RequiredLabels<T> = Required<Pick<T, LabelKeys<T>>>;

/** `MonthView` / `MultiMonthView` の `overflowLabel` 既定文字列と同じ形式の英語版。 */
function overflowLabelEn(count: number): ReactNode {
  return `+${count} more`;
}

const toolbar = {
  month: 'Month',
  week: 'Week',
  day: 'Day',
  list: 'List',
  year: 'Year',
  multiMonth: 'Multi-month',
  resource: 'Resource',
  timeline: 'Timeline',
  today: 'Today',
  prev: 'Previous',
  next: 'Next',
} satisfies Required<ToolbarLabels>;

const list = {
  allDayLabel: 'All day',
  emptyLabel: 'No events',
} satisfies RequiredLabels<ListViewProps> & RequiredLabels<VirtualListViewProps>;

const month = {
  overflowLabel: overflowLabelEn,
} satisfies RequiredLabels<MonthViewProps>;

const multiMonth = {
  overflowLabel: overflowLabelEn,
} satisfies RequiredLabels<MultiMonthViewProps>;

const resource = {
  unassignedLabel: 'Unassigned',
  emptyLabel: 'No resources',
} satisfies RequiredLabels<ResourceViewProps> & RequiredLabels<VirtualResourceViewProps>;

const timeline = {
  unassignedLabel: 'Unassigned',
  emptyLabel: 'No resources',
  cornerLabel: 'Resources',
} satisfies RequiredLabels<TimelineViewProps> & RequiredLabels<VirtualTimelineViewProps>;

const calendarView = {
  listAllDayLabel: 'All day',
  listEmptyLabel: 'No events',
  monthOverflowLabel: overflowLabelEn,
  multiMonthOverflowLabel: overflowLabelEn,
  resourceUnassignedLabel: 'Unassigned',
  resourceEmptyLabel: 'No resources',
  timelineUnassignedLabel: 'Unassigned',
  timelineEmptyLabel: 'No resources',
  timelineCornerLabel: 'Resources',
} satisfies RequiredLabels<CalendarViewProps>;

/**
 * 英語 (en-US) の既定文言プリセット。
 *
 * キーは対象コンポーネント名ごとにまとめてあり、対応する props にそのまま
 * スプレッドできる。`calendarView` だけは `CalendarView` が各ビューへの
 * 転送用に持つプレフィックス付き props（`listAllDayLabel` 等）向けの形。
 *
 * @example
 * ```tsx
 * import { enUsLabels } from '@koyomi-cal/react';
 *
 * <Toolbar labels={enUsLabels.toolbar} />
 * <ListView {...enUsLabels.list} />
 * <MonthView {...enUsLabels.month} />
 * <MultiMonthView {...enUsLabels.multiMonth} />
 * <ResourceView {...enUsLabels.resource} />
 * <TimelineView {...enUsLabels.timeline} />
 * // CalendarView はプレフィックス付き props をまとめて受け取る
 * <CalendarView {...enUsLabels.calendarView} />
 * ```
 */
export const enUsLabels = {
  toolbar,
  list,
  month,
  multiMonth,
  resource,
  timeline,
  calendarView,
} as const;

/**
 * {@link enUsLabels} の構造を表す型。
 *
 * 他の公開 API（コンポーネントと props 型のペア）と一貫させるため、
 * `enUsLabels` の値そのものの型を named export したもの。
 * 独自の英語以外のロケールプリセットを自前で用意する場合、この型を
 * 満たすオブジェクトを作れば `enUsLabels` と同様にスプレッドして使える。
 *
 * @example
 * ```tsx
 * import type { EnUsLabels } from '@koyomi-cal/react';
 *
 * // 自前のロケールプリセットも同じ形にしておくと enUsLabels と同様に扱える
 * const myLabels: EnUsLabels = { ...enUsLabels, toolbar: { ...enUsLabels.toolbar, today: "Auj." } };
 * ```
 */
export type EnUsLabels = typeof enUsLabels;
