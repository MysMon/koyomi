/**
 * @packageDocumentation
 * 英語 (en) のメッセージカタログ。
 *
 * `CalendarOptions.locale` の言語サブタグが `en`（`'en-US'`・`'en-GB'` 等）の
 * ときに `resolveMessageCatalog` が選択する同梱カタログ。
 */

import type {
  RecurrenceEnd,
  RecurrenceRuleState,
  RecurrenceUnsupportedField,
  RecurrenceUnsupportedReason,
  RecurrenceValidationIssue,
  RecurrenceWeekdayOrdinal,
} from '../../core/recurrence-editor';
import type { RecurringEditScope, Weekday } from '../../core/types';
import type { EventChangeVerb, MessageCatalog } from './types';

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

/**
 * 頻度ごとの基本文言を組み立てる（終了条件は含まない）。
 *
 * `YEARLY` の月日は `state` に持たないため、DTSTART を渡さずに呼ばれる限り
 * 常に月日を欠いた文言（`Annually` / `Every N years`）になる（日本語版が
 * `context` なしで曜日・日にちを欠いた文言にフォールバックするのと同じ制約）。
 */
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
 * `state` を英語の人間可読な説明文にする。
 *
 * `context`（DTSTART・タイムゾーン）は受け取るが使用しない。`YEARLY` の月日を
 * 含む文言化には曜日・月日名の英訳判断が別途必要になるため、現状は `state` に
 * 保持された情報のみから組み立てる（日本語版との既知の差）。
 */
function describeRecurrenceRuleEn(state: RecurrenceRuleState): string {
  const interval = Number.isInteger(state.interval) && state.interval >= 1 ? state.interval : 1;
  return `${describeBaseEn(state, interval)}${describeEndSuffixEn(state.end)}`;
}

/** {@link validateRecurrenceRuleState} の検証エラー 1 件の英語文言。 */
function validationMessageEn(issue: RecurrenceValidationIssue): string {
  switch (issue.field) {
    case 'interval':
      return 'Repeat interval must be an integer of 1 or greater.';
    case 'byWeekday':
      switch (issue.code) {
        case 'empty':
          return 'Select at least one weekday.';
        case 'duplicate':
          return 'The same weekday cannot be selected more than once.';
        case 'outOfRange':
          return 'Weekday must be between 0 (Sunday) and 6 (Saturday).';
      }
      break;
    case 'monthlyPattern':
      switch (issue.code) {
        case 'dayOfMonthInvalid':
          return 'Day of month must be between 1 and 31, or -1 (last day).';
        case 'ordinalInvalid':
          return 'Week ordinal must be between 1 and 4, or -1 (last).';
        case 'weekdayInvalid':
          return 'Weekday must be between 0 (Sunday) and 6 (Saturday).';
      }
      break;
    case 'count':
      return 'Count must be an integer of 1 or greater.';
    case 'until':
      return 'Specify a valid date and time for the end date.';
  }
}

/** 対応していない RRULE フィールド（{@link RecurrenceUnsupportedField}）の英語表示名。 */
function unsupportedFieldLabelEn(field: RecurrenceUnsupportedField): string {
  switch (field) {
    case 'BYSETPOS':
      return 'BYSETPOS';
    case 'BYMONTH':
      return 'BYMONTH';
    case 'BYYEARDAY':
      return 'BYYEARDAY';
    case 'BYWEEKNO':
      return 'BYWEEKNO';
    case 'BYHOUR':
      return 'BYHOUR';
    case 'BYMINUTE':
      return 'BYMINUTE';
    case 'BYSECOND':
      return 'BYSECOND';
    case 'BYEASTER':
      return 'BYEASTER';
    case 'BYDAY_EXPANDED':
      return 'the expanded BYDAY form';
    case 'BYMONTHDAY_EXPANDED':
      return 'the expanded BYMONTHDAY form';
  }
}

/** {@link parseRecurrenceRule} の非対応理由（{@link RecurrenceUnsupportedReason}）の英語文言。 */
function unsupportedReasonEn(reason: RecurrenceUnsupportedReason): string {
  switch (reason.code) {
    case 'unsupportedField':
      return `Unsupported RRULE field (${unsupportedFieldLabelEn(reason.field)}).`;
    case 'unsupportedWkst':
      return 'Unsupported RRULE field (WKST other than Monday).';
    case 'unsupportedFrequency':
      return 'Only DAILY, WEEKLY, MONTHLY, and YEARLY frequencies are supported by the editor.';
    case 'countAndUntilBothSpecified':
      return 'COUNT and UNTIL cannot be specified together.';
    case 'byDayFormatUnrecognized':
      return 'Could not parse the BYDAY format.';
    case 'dailyByDayOrByMonthDayUnsupported':
      return 'BYDAY and BYMONTHDAY are not supported by the editor for DAILY.';
    case 'yearlyByDayOrByMonthDayUnsupported':
      return 'BYDAY and BYMONTHDAY are not supported by the editor for YEARLY.';
    case 'weeklyByMonthDayUnsupported':
      return 'BYMONTHDAY is not supported by the editor for WEEKLY.';
    case 'weeklyByDayOrdinalUnsupported':
      return 'A week ordinal in BYDAY is not allowed for WEEKLY.';
    case 'monthlyByDayAndByMonthDayConflict':
      return 'BYDAY and BYMONTHDAY cannot be specified together for MONTHLY.';
    case 'monthlyByMonthDayMultipleValuesUnsupported':
      return 'Only a single BYMONTHDAY value is supported by the editor for MONTHLY.';
    case 'monthlyByDayMultipleTokensUnsupported':
      return 'Only a single weekday in BYDAY is supported by the editor for MONTHLY.';
    case 'monthlyByDayOrdinalRequired':
      return 'BYDAY for MONTHLY requires a week ordinal.';
    case 'monthlyByDayOrdinalOutOfRange':
      return 'The week ordinal in BYDAY must be between 1 and 4, or -1 (last), for MONTHLY.';
    case 'invalidRRuleSyntax':
      return `Failed to parse RRULE (${reason.detail}).`;
  }
}

/** {@link MessageCatalog.common.itemSeparator} の値（イベント aria-label 組み立てで使う）。 */
const ITEM_SEPARATOR = ', ';

const common: MessageCatalog['common'] = {
  untitledEvent: 'Untitled event',
  rangeSeparator: '–',
  itemSeparator: ITEM_SEPARATOR,
  eventAriaLabel: (occurrence, rangeLabel) =>
    `${occurrence.event.title}${ITEM_SEPARATOR}${rangeLabel}`,
};

const toolbar: MessageCatalog['toolbar'] = {
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
};

/** {@link MessageCatalog.year.dayCount} の英語実装（単数形に対応、`list.dayAriaLabel` 相当と同じ判断軸）。 */
function eventCountTextEn(count: number): string {
  return count === 1 ? '1 event' : `${count} events`;
}

const list: MessageCatalog['list'] = {
  allDay: 'All day',
  empty: 'No events',
  dayAriaLabel: (day, dateLabel) => `${dateLabel} ${eventCountTextEn(day.occurrences.length)}`,
};

const month: MessageCatalog['month'] = {
  overflow: (count) => `+${count} more`,
};

const multiMonth: MessageCatalog['multiMonth'] = {
  overflow: (count) => `+${count} more`,
};

const resource: MessageCatalog['resource'] = {
  unassigned: 'Unassigned',
  empty: 'No resources',
};

const timeline: MessageCatalog['timeline'] = {
  unassigned: 'Unassigned',
  empty: 'No resources',
  corner: 'Resources',
  resourceToggleAriaLabel: (toggleTarget, collapsed) =>
    collapsed ? `Expand ${toggleTarget.title}` : `Collapse ${toggleTarget.title}`,
};

const year: MessageCatalog['year'] = {
  dayCount: eventCountTextEn,
  dayAriaLabel: (day, dateLabel) =>
    day.eventCount > 0 ? `${dateLabel} ${eventCountTextEn(day.eventCount)}` : dateLabel,
};

/** {@link EventChangeVerb} の英語表記（`eventChanged` の文中に埋め込む）。 */
function verbTextEn(verb: EventChangeVerb): string {
  switch (verb) {
    case 'moved':
      return 'moved to';
    case 'resized':
      return 'resized to';
    case 'convertedToAllDay':
      return 'changed to an all-day event, now on';
    case 'convertedToTimed':
      return 'changed to a timed event, now at';
  }
}

/** `RecurringEditScope` の英語の付記文言（`null` は付記なし）。 */
function describeScopeEn(scope: RecurringEditScope | null): string | null {
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

const announcer: MessageCatalog['announcer'] = {
  unassignedResource: 'Unassigned',
  eventChanged: (change, verb, rangeLabel, resourceLabel) => {
    const base = `${change.occurrence.event.title} ${verbTextEn(verb)} ${rangeLabel}`;
    return resourceLabel === null ? base : `${base} (${resourceLabel})`;
  },
  eventCreated: (event, _selection, rangeLabel, resourceLabel) => {
    const base = `${event.title} created for ${rangeLabel}`;
    return resourceLabel === null ? base : `${base} (${resourceLabel})`;
  },
  eventDeleted: (deletion) => {
    const scopeLabel = describeScopeEn(deletion.scope);
    const base = `${deletion.occurrence.event.title} deleted`;
    return scopeLabel === null ? base : `${base} (${scopeLabel})`;
  },
  viewChanged: (_info, title) => `Switched view to ${title}`,
};

const recurrenceEditor: MessageCatalog['recurrenceEditor'] = {
  describeRule: describeRecurrenceRuleEn,
  validationMessage: validationMessageEn,
  unsupportedReason: unsupportedReasonEn,
};

/**
 * 英語 (en) のメッセージカタログ。
 *
 * `CalendarOptions.locale` の言語サブタグが `en`（大文字・小文字を問わない
 * `'en-US'`・`'en-GB'` 等）のときに `resolveMessageCatalog` が選択する。
 */
export const enMessages: MessageCatalog = {
  common,
  toolbar,
  list,
  month,
  multiMonth,
  resource,
  timeline,
  year,
  announcer,
  recurrenceEditor,
};
