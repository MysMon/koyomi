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
  RecurrenceEnd,
  RecurrenceRuleState,
  RecurrenceWeekdayOrdinal,
} from '../../core/recurrence-editor';
import type { EventOccurrence, ListDay, Weekday, YearDay } from '../../core/types';
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
import type { YearViewProps } from '../components/year-view';
import type { UseRecurrenceRuleEditorOptions } from '../use-recurrence-rule-editor';

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

/** {@link Weekday} の英語 3 文字略称。 */
function weekdayAbbrEn(weekday: Weekday): string {
  switch (weekday) {
    case 0:
      return 'Sun';
    case 1:
      return 'Mon';
    case 2:
      return 'Tue';
    case 3:
      return 'Wed';
    case 4:
      return 'Thu';
    case 5:
      return 'Fri';
    case 6:
      return 'Sat';
  }
}

/** {@link Weekday} の英語のフルネーム。 */
function weekdayFullEn(weekday: Weekday): string {
  switch (weekday) {
    case 0:
      return 'Sunday';
    case 1:
      return 'Monday';
    case 2:
      return 'Tuesday';
    case 3:
      return 'Wednesday';
    case 4:
      return 'Thursday';
    case 5:
      return 'Friday';
    case 6:
      return 'Saturday';
  }
}

/** {@link RecurrenceWeekdayOrdinal} の英語の序数表記（"1st"・"last" 等）。 */
function ordinalWordEn(ordinal: RecurrenceWeekdayOrdinal): string {
  switch (ordinal) {
    case 1:
      return '1st';
    case 2:
      return '2nd';
    case 3:
      return '3rd';
    case 4:
      return '4th';
    case -1:
      return 'last';
  }
}

/** UTC の月番号（0 起点）から英語の月略称（"Jan" 等）を返す。 */
function monthAbbrEn(monthIndexZeroBased: number): string {
  switch (monthIndexZeroBased) {
    case 0:
      return 'Jan';
    case 1:
      return 'Feb';
    case 2:
      return 'Mar';
    case 3:
      return 'Apr';
    case 4:
      return 'May';
    case 5:
      return 'Jun';
    case 6:
      return 'Jul';
    case 7:
      return 'Aug';
    case 8:
      return 'Sep';
    case 9:
      return 'Oct';
    case 10:
      return 'Nov';
    case 11:
      return 'Dec';
    default:
      // Date#getUTCMonth は常に 0〜11 を返すため、ここには到達しない
      return String(monthIndexZeroBased + 1);
  }
}

/** WEEKLY の曜日部分のテキスト（"Mon, Wed" 等）。情報がなければ `null`。 */
function weeklyWeekdaysEn(state: RecurrenceRuleState): string | null {
  const byWeekday = state.byWeekday;
  if (byWeekday === undefined || byWeekday.length === 0) {
    return null;
  }
  return [...byWeekday]
    .sort((a, b) => a - b)
    .map((weekday) => weekdayAbbrEn(weekday))
    .join(', ');
}

/** MONTHLY のパターン部分のテキスト（"day 15"・"the 2nd Monday" 等）。情報がなければ `null`。 */
function monthlyPatternTextEn(state: RecurrenceRuleState): string | null {
  const monthlyPattern = state.monthlyPattern;
  if (monthlyPattern === undefined) {
    return null;
  }
  if (monthlyPattern.kind === 'dayOfMonth') {
    return monthlyPattern.day === -1 ? 'the last day' : `day ${monthlyPattern.day}`;
  }
  const { ordinal, weekday } = monthlyPattern;
  return `the ${ordinalWordEn(ordinal)} ${weekdayFullEn(weekday)}`;
}

/** 頻度ごとの基本文言を組み立てる（終了条件は含まない）。 */
function describeBaseEn(state: RecurrenceRuleState, interval: number): string {
  switch (state.freq) {
    case 'daily':
      return interval <= 1 ? 'Daily' : `Every ${interval} days`;
    case 'weekly': {
      const weekdays = weeklyWeekdaysEn(state);
      if (interval <= 1) {
        return weekdays === null ? 'Weekly' : `Weekly on ${weekdays}`;
      }
      return weekdays === null
        ? `Every ${interval} weeks`
        : `Every ${interval} weeks on ${weekdays}`;
    }
    case 'monthly': {
      const pattern = monthlyPatternTextEn(state);
      if (interval <= 1) {
        return pattern === null ? 'Monthly' : `Monthly on ${pattern}`;
      }
      return pattern === null
        ? `Every ${interval} months`
        : `Every ${interval} months on ${pattern}`;
    }
    case 'yearly':
      return interval <= 1 ? 'Annually' : `Every ${interval} years`;
  }
}

/** `until` を英語の日付表記（"Jul 5, 2026"）に整形する（UTC 成分を使用）。 */
function formatUntilDateEn(until: Date): string {
  return `${monthAbbrEn(until.getUTCMonth())} ${until.getUTCDate()}, ${until.getUTCFullYear()}`;
}

/** 終了条件の末尾テキスト（" (for 5 occurrences)"・" (until Jul 5, 2026)" 等）。`never` は空文字列。 */
function describeEndSuffixEn(end: RecurrenceEnd): string {
  if (end.type === 'count') {
    return end.count === 1 ? ' (for 1 occurrence)' : ` (for ${end.count} occurrences)`;
  }
  if (end.type === 'until') {
    return ` (until ${formatUntilDateEn(end.until)})`;
  }
  return '';
}

/**
 * `useRecurrenceRuleEditor` の `describeRule` オプション用の英語実装。
 *
 * `eventAriaLabelEn` 等のような `defaultDescription`（日本語）の文字列後処理では
 * 自然な英語にならないため、`state` から直接英語文を組み立てる（`defaultDescription`
 * は使用しない）。`YEARLY` の月日は `state` に持たないため、`context` を持たない
 * このコールバックの制約上、常に月日を欠いた文言（`Annually` / `Every N years`）になる
 * （`describeRecurrenceRule` の日本語版が `context` なしで曜日・日にちを欠いた
 * 文言にフォールバックするのと同じ制約）。
 */
function describeRecurrenceRuleEn(state: RecurrenceRuleState, _defaultDescription: string): string {
  const interval = Number.isInteger(state.interval) && state.interval >= 1 ? state.interval : 1;
  return `${describeBaseEn(state, interval)}${describeEndSuffixEn(state.end)}`;
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
  yearDayCountLabel: dayCountLabelEn,
  yearDayAriaLabel: yearDayAriaLabelEn,
} satisfies RequiredLabels<CalendarViewProps>;

/**
 * `useRecurrenceRuleEditor` の `describeRule` オプションと同じ形の英語文言。
 *
 * `RequiredLabels<T>`（`*Label` で終わる props 名を対象にした網羅性チェック）とは
 * 異なり、フックの単一オプション（`describeRule`）が対象のため、
 * `UseRecurrenceRuleEditorOptions` から直接その型を取り出して `satisfies` する
 * （このモジュール内でのみ使用する軽量なキー網羅性チェック）。
 */
interface RecurrenceEditorLabels {
  describeRule: NonNullable<UseRecurrenceRuleEditorOptions['describeRule']>;
}

const recurrenceEditor = {
  describeRule: describeRecurrenceRuleEn,
} satisfies RecurrenceEditorLabels;

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
 * // useRecurrenceRuleEditor の describeRule には recurrenceEditor.describeRule を渡す
 * useRecurrenceRuleEditor({ start, timeZone, describeRule: enUsLabels.recurrenceEditor.describeRule });
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
  recurrenceEditor,
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
