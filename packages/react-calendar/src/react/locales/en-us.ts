/**
 * @packageDocumentation
 * 英語 (en-US) の既定文言プリセット。
 *
 * ビルトインコンポーネントの `*Label` 系 props（既定値は日本語）を英語化した
 * 値の集合をコンポーネント単位でまとめる。既定値（日本語）自体は変更しない
 * 後方互換なプリセットで、英語 UI にしたい場合にのみ明示的にこの値を渡す。
 *
 * ロケールプリセットの命名規則: BCP 47 タグをキャメルケース化した
 * `<言語><地域>Labels`（地域は先頭のみ大文字。例: `enUsLabels`、将来追加するなら
 * `deDeLabels` / `zhCnLabels`）。ファイルは `locales/<bcp47小文字>.ts` に置く。
 */

import type { ReactNode } from 'react';
import type {
  CalendarEvent,
  CalendarRangeChangeInfo,
  CalendarResource,
  EventOccurrence,
  ListDay,
  YearDay,
} from '../../core/types';
import type { CalendarViewProps } from '../components/calendar-view';
import { formatViewTitle } from '../components/format';
import type { ListViewProps } from '../components/list-view';
import type { MonthViewProps } from '../components/month-view';
import { formatOccurrenceRangeLabel } from '../components/month-view-parts';
import type { MultiMonthViewProps } from '../components/multi-month-view';
import type { ResourceViewProps } from '../components/resource-view';
import type { TimelineViewProps } from '../components/timeline-view';
import type { ToolbarLabels } from '../components/toolbar';
import type { VirtualListViewProps } from '../components/virtual-list-view';
import type { VirtualResourceViewProps } from '../components/virtual-resource-view';
import type { VirtualTimelineViewProps } from '../components/virtual-timeline-view';
import type { YearViewProps } from '../components/year-view';
import type { EventChange, EventDelete, RangeSelection } from '../types';
import type { AnnouncerFormatterContext, AnnouncerMessages } from '../use-calendar-announcer';

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

/**
 * イベントボタン系（`formatEventAriaLabel` / `ariaLabelWithResource`）の既定 aria-label 文字列は、
 * 日時・タイトル・リソース名の区切りに日本語の読点「、」と波ダッシュ「〜」を使う
 * （calendar の `locale` オプションに関わらず固定）。英語プリセットではこれを
 * 英語表記の区切り（カンマ・en dash）に置き換える。日付・時刻自体は Intl（`locale`）で
 * 既に整形済みのため、ここでは区切り記号だけを置換すればよい。
 * `eventAriaLabel` の型（`(occurrence, defaultLabel) => string`）に対応する全ビュー
 * （`MonthView` / `MultiMonthView` / `ListView` / `VirtualListView` / `ResourceView` /
 * `VirtualResourceView` / `TimelineView` / `VirtualTimelineView`）で共通に使える。
 */
function eventAriaLabelEn(_occurrence: EventOccurrence, defaultLabel: string): string {
  return defaultLabel.replace(/、/g, ', ').replace(/〜/g, '–');
}

/**
 * `TimelineView` / `VirtualTimelineView` の `resourceToggleAriaLabel` の英語版。
 * `collapsed`（現在の折りたたみ状態）に応じて、押すと何が起こるかを案内する文言にする
 * （`defaultResourceToggleAriaLabel` の日本語版と同じ判定軸）。
 */
function resourceToggleAriaLabelEn(
  resource: CalendarResource,
  collapsed: boolean,
  _defaultLabel: string,
): string {
  return collapsed ? `Expand ${resource.title}` : `Collapse ${resource.title}`;
}

/** `YearView` の `dayCountLabel` 既定文字列（`'予定N件'`）と同じ形式の英語版。単数形に対応する。 */
function dayCountLabelEn(count: number): string {
  return count === 1 ? '1 event' : `${count} events`;
}

/**
 * `YearView` の `dayAriaLabel`（日セル aria-label 全体の差し替え）英語版。
 * `dayCountLabel`（上記 `dayCountLabelEn`）が既に「予定N件」部分を英語化した
 * `defaultLabel` を渡してくるため、追加の変換は不要（そのまま返す）。
 */
function yearDayAriaLabelEn(_day: YearDay, defaultLabel: string): string {
  return defaultLabel;
}

/**
 * `ListView` / `VirtualListView` の `dayAriaLabel`（日セクション aria-label 全体の差し替え）
 * 英語版。既定文字列（例:「7月16日(木) 予定2件」）の末尾「予定N件」部分だけを
 * 英語の件数文言に置き換える（日付見出し部分は `locale` により Intl で整形済みのため触れない）。
 */
function listDayAriaLabelEn(day: ListDay, defaultLabel: string): string {
  const header = defaultLabel.replace(/\s*予定\d+件$/, '');
  return `${header} ${dayCountLabelEn(day.occurrences.length)}`;
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
  viewsGroup: 'View switcher',
} satisfies Required<ToolbarLabels>;

const list = {
  allDayLabel: 'All day',
  emptyLabel: 'No events',
  eventAriaLabel: eventAriaLabelEn,
  dayAriaLabel: listDayAriaLabelEn,
} satisfies RequiredLabels<ListViewProps> & RequiredLabels<VirtualListViewProps>;

const month = {
  overflowLabel: overflowLabelEn,
  eventAriaLabel: eventAriaLabelEn,
} satisfies RequiredLabels<MonthViewProps>;

const multiMonth = {
  overflowLabel: overflowLabelEn,
  eventAriaLabel: eventAriaLabelEn,
} satisfies RequiredLabels<MultiMonthViewProps>;

const resource = {
  unassignedLabel: 'Unassigned',
  emptyLabel: 'No resources',
  eventAriaLabel: eventAriaLabelEn,
} satisfies RequiredLabels<ResourceViewProps> & RequiredLabels<VirtualResourceViewProps>;

const timeline = {
  unassignedLabel: 'Unassigned',
  emptyLabel: 'No resources',
  cornerLabel: 'Resources',
  eventAriaLabel: eventAriaLabelEn,
  resourceToggleAriaLabel: resourceToggleAriaLabelEn,
} satisfies RequiredLabels<TimelineViewProps> & RequiredLabels<VirtualTimelineViewProps>;

const year = {
  dayCountLabel: dayCountLabelEn,
  dayAriaLabel: yearDayAriaLabelEn,
} satisfies RequiredLabels<YearViewProps>;

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
  monthEventAriaLabel: eventAriaLabelEn,
  timeGridEventAriaLabel: eventAriaLabelEn,
  listEventAriaLabel: eventAriaLabelEn,
  listDayAriaLabel: listDayAriaLabelEn,
  multiMonthEventAriaLabel: eventAriaLabelEn,
  resourceEventAriaLabel: eventAriaLabelEn,
  timelineEventAriaLabel: eventAriaLabelEn,
  timelineResourceToggleAriaLabel: resourceToggleAriaLabelEn,
  yearDayCountLabel: dayCountLabelEn,
  yearDayAriaLabel: yearDayAriaLabelEn,
} satisfies RequiredLabels<CalendarViewProps>;

/**
 * `formatOccurrenceRangeLabel` の結果から、日本語特有の連結記号（`〜`）を
 * 英語表記（en dash）に変換する（`eventAriaLabelEn` と同じ区切り記号の置換方針）。
 */
function toEnDash(label: string): string {
  return label.replace(/〜/g, '–');
}

/**
 * `useCalendarAnnouncer` の `resolveResourceLabel` の英語版。
 * `resourceId` が `undefined`（リソース対象外）なら `null`（付記なし）を返す。
 */
function resolveResourceLabelEn(
  resourceId: string | null | undefined,
  resources: readonly { id: string; title: string }[],
): string | null {
  if (resourceId === undefined) {
    return null;
  }
  if (resourceId === null) {
    return 'Unassigned';
  }
  const resource = resources.find((candidate) => candidate.id === resourceId);
  return resource?.title ?? 'Unassigned';
}

/** `RecurringEditScope` の英語の付記文言（`null` は付記なし）。 */
function describeScopeEn(scope: EventDelete['scope']): string | null {
  switch (scope) {
    case 'this':
      return 'this event only';
    case 'thisAndFollowing':
      return 'this and following events';
    case 'all':
      return 'all events in the series';
    case null:
      return null;
  }
}

/**
 * `useCalendarAnnouncer` の `describeChangeVerb` の英語版。移動・サイズ変更・
 * 終日⇔時間指定変換の判定ヒューリスティック自体は日本語版と同じ（判定の詳細は
 * `use-calendar-announcer.ts` の `describeChangeVerb` を参照）。
 */
function describeChangeVerbEn(occurrence: EventOccurrence, change: EventChange): string {
  if (occurrence.allDay !== change.allDay) {
    return change.allDay
      ? 'changed to an all-day event, now on'
      : 'changed to a timed event, now at';
  }
  const before = occurrence.end.getTime() - occurrence.start.getTime();
  const after = change.newRange.end.getTime() - change.newRange.start.getTime();
  return before === after ? 'moved to' : 'resized to';
}

/**
 * `useCalendarAnnouncer` の `AnnouncerMessages` の英語プリセット。
 *
 * 日本語の既定文言（`defaultMessage`）を文字列置換するのではなく、`ctx`
 * （`timeZone` / `locale` / `resources`）と対象データから英語の語順で組み立てる
 * （日本語は SOV、英語は SVO のため語順自体が異なり、`eventAriaLabelEn` のような
 * 区切り記号の置換だけでは英語化できない）。
 */
function eventChangedEn(
  change: EventChange,
  _defaultMessage: string,
  ctx: AnnouncerFormatterContext,
): string {
  const verb = describeChangeVerbEn(change.occurrence, change);
  const rangeLabel = toEnDash(
    formatOccurrenceRangeLabel(change.newRange, change.allDay, ctx.timeZone, ctx.locale),
  );
  const resourceLabel = resolveResourceLabelEn(change.resourceId, ctx.resources);
  const base = `${change.occurrence.event.title} ${verb} ${rangeLabel}`;
  return resourceLabel === null ? base : `${base} (${resourceLabel})`;
}

/** {@link eventChangedEn} と対になる作成通知の英語版。 */
function eventCreatedEn(
  event: CalendarEvent,
  selection: RangeSelection,
  _defaultMessage: string,
  ctx: AnnouncerFormatterContext,
): string {
  const rangeLabel = toEnDash(
    formatOccurrenceRangeLabel(selection.range, selection.allDay, ctx.timeZone, ctx.locale),
  );
  const resourceLabel = resolveResourceLabelEn(selection.resourceId, ctx.resources);
  const base = `${event.title} created for ${rangeLabel}`;
  return resourceLabel === null ? base : `${base} (${resourceLabel})`;
}

/** {@link eventChangedEn} と対になる削除通知の英語版。 */
function eventDeletedEn(
  deletion: EventDelete,
  _defaultMessage: string,
  _ctx: AnnouncerFormatterContext,
): string {
  const scopeLabel = describeScopeEn(deletion.scope);
  const base = `${deletion.occurrence.event.title} deleted`;
  return scopeLabel === null ? base : `${base} (${scopeLabel})`;
}

/** {@link eventChangedEn} と対になるビュー変更通知の英語版。 */
function viewChangedEn(
  info: CalendarRangeChangeInfo,
  _defaultMessage: string,
  ctx: AnnouncerFormatterContext,
): string {
  const title = formatViewTitle(
    info.view,
    info.currentDate,
    { start: info.rangeStart, end: info.rangeEnd },
    ctx.timeZone,
    ctx.locale,
  );
  return `Switched view to ${title}`;
}

const announcer = {
  eventChanged: eventChangedEn,
  eventCreated: eventCreatedEn,
  eventDeleted: eventDeletedEn,
  viewChanged: viewChangedEn,
} satisfies Required<AnnouncerMessages>;

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
 * <YearView {...enUsLabels.year} />
 * // CalendarView はプレフィックス付き props をまとめて受け取る
 * <CalendarView {...enUsLabels.calendarView} />
 * // useCalendarAnnouncer の messages には announcer をそのまま渡す
 * useCalendarAnnouncer({ calendar, messages: enUsLabels.announcer });
 * ```
 */
export const enUsLabels = {
  toolbar,
  list,
  month,
  multiMonth,
  resource,
  timeline,
  year,
  calendarView,
  announcer,
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
