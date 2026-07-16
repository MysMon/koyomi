/**
 * @packageDocumentation
 * 日本語 (ja) の既定メッセージカタログ。
 *
 * `CalendarOptions.locale` の既定値であり、`resolveMessageCatalog` が
 * フォールバック先としても使う既定カタログ。
 */

import type {
  RecurrenceEnd,
  RecurrenceRuleState,
  RecurrenceUnsupportedField,
  RecurrenceUnsupportedReason,
  RecurrenceValidationIssue,
  RecurrenceWeekdayOrdinal,
} from '../../core/recurrence-editor';
import { getWallClock, weekdayInZone } from '../../core/timezone';
import type { RecurringEditScope, TimeZoneId, Weekday } from '../../core/types';
import type { EventChangeVerb, MessageCatalog } from './types';

/** {@link Weekday} の日本語 1 文字表記。 */
function weekdayNameJa(weekday: Weekday): string {
  switch (weekday) {
    case 0:
      return '日';
    case 1:
      return '月';
    case 2:
      return '火';
    case 3:
      return '水';
    case 4:
      return '木';
    case 5:
      return '金';
    case 6:
      return '土';
  }
}

/** {@link RecurrenceWeekdayOrdinal} の日本語表記（「第1」「最終」等）。 */
function ordinalLabelJa(ordinal: RecurrenceWeekdayOrdinal): string {
  switch (ordinal) {
    case 1:
      return '第1';
    case 2:
      return '第2';
    case 3:
      return '第3';
    case 4:
      return '第4';
    case -1:
      return '最終';
  }
}

/** `describeRule` の `context` パラメータの型。 */
type DescribeContext = { dtstart?: Date; timeZone?: TimeZoneId } | undefined;

/** WEEKLY の曜日部分のテキスト（「月・水」等）。情報がなければ `null`。 */
function weeklyWeekdaysJa(state: RecurrenceRuleState, context: DescribeContext): string | null {
  const byWeekday = state.byWeekday;
  if (byWeekday !== undefined && byWeekday.length > 0) {
    return [...byWeekday]
      .sort((a, b) => a - b)
      .map((weekday) => weekdayNameJa(weekday))
      .join('・');
  }
  if (context?.dtstart !== undefined && context.timeZone !== undefined) {
    return weekdayNameJa(weekdayInZone(context.dtstart, context.timeZone));
  }
  return null;
}

/** 月内日付のテキスト（「15日」「末日」）。 */
function dayOfMonthTextJa(day: number): string {
  return day === -1 ? '末日' : `${day}日`;
}

/** MONTHLY のパターン部分のテキスト（「15日」「第2月曜日」等）。情報がなければ `null`。 */
function monthlyPatternTextJa(state: RecurrenceRuleState, context: DescribeContext): string | null {
  const monthlyPattern = state.monthlyPattern;
  if (monthlyPattern !== undefined) {
    if (monthlyPattern.kind === 'dayOfMonth') {
      return dayOfMonthTextJa(monthlyPattern.day);
    }
    const { ordinal, weekday } = monthlyPattern;
    return `${ordinalLabelJa(ordinal)}${weekdayNameJa(weekday)}曜日`;
  }
  if (context?.dtstart !== undefined && context.timeZone !== undefined) {
    return dayOfMonthTextJa(getWallClock(context.dtstart, context.timeZone).day);
  }
  return null;
}

/** YEARLY の月日部分のテキスト（「7月1日」）。`context` がなければ `null`。 */
function yearlyMonthDayTextJa(context: DescribeContext): string | null {
  if (context?.dtstart === undefined || context.timeZone === undefined) {
    return null;
  }
  const wall = getWallClock(context.dtstart, context.timeZone);
  return `${wall.month}月${wall.day}日`;
}

/** 頻度ごとの基本文言を組み立てる（終了条件は含まない）。 */
function describeBaseJa(
  state: RecurrenceRuleState,
  interval: number,
  context: DescribeContext,
): string {
  switch (state.freq) {
    case 'daily':
      return interval <= 1 ? '毎日' : `${interval}日ごと`;
    case 'weekly': {
      const weekdays = weeklyWeekdaysJa(state, context);
      if (interval <= 1) {
        return weekdays === null ? '毎週' : `毎週${weekdays}`;
      }
      return weekdays === null ? `${interval}週ごと` : `${interval}週ごとの${weekdays}`;
    }
    case 'monthly': {
      const pattern = monthlyPatternTextJa(state, context);
      // 第n週指定（「第2月曜日」等）は「毎月」の直後に空白を挟む。
      // 月内日付指定（「15日」等）は空白を挟まない（既存の文言慣習に合わせる）
      const isNthWeekday = state.monthlyPattern?.kind === 'nthWeekday';
      if (interval <= 1) {
        if (pattern === null) {
          return '毎月';
        }
        return isNthWeekday ? `毎月 ${pattern}` : `毎月${pattern}`;
      }
      if (pattern === null) {
        return `${interval}ヶ月ごと`;
      }
      return isNthWeekday ? `${interval}ヶ月ごとの ${pattern}` : `${interval}ヶ月ごとの${pattern}`;
    }
    case 'yearly': {
      const monthDay = yearlyMonthDayTextJa(context);
      if (interval <= 1) {
        return monthDay === null ? '毎年' : `毎年${monthDay}`;
      }
      return monthDay === null ? `${interval}年ごと` : `${interval}年ごとの${monthDay}`;
    }
  }
}

/** `until` を日本語の日付表記（「YYYY年M月D日」）に整形する。 */
function formatUntilDateJa(until: Date, timeZone: TimeZoneId | undefined): string {
  if (timeZone !== undefined) {
    const wall = getWallClock(until, timeZone);
    return `${wall.year}年${wall.month}月${wall.day}日`;
  }
  return `${until.getUTCFullYear()}年${until.getUTCMonth() + 1}月${until.getUTCDate()}日`;
}

/** 終了条件の末尾テキスト（「（5回）」「（2026年7月5日まで）」）。`never` は空文字列。 */
function describeEndSuffixJa(end: RecurrenceEnd, timeZone: TimeZoneId | undefined): string {
  if (end.type === 'count') {
    return `（${end.count}回）`;
  }
  if (end.type === 'until') {
    return `（${formatUntilDateJa(end.until, timeZone)}まで）`;
  }
  return '';
}

/**
 * `state` を日本語の人間可読な説明文にする。
 *
 * 検証（`validateRecurrenceRuleState`）を要求しない best-effort な整形であり、
 * `interval` が 1 未満・非整数の場合は表示上 1 として扱うなど、無効な状態でも
 * 例外を投げずに整形する。`byWeekday` / `monthlyPattern` が省略されており
 * `context` も渡されない場合、曜日・日にちを欠いた曖昧な文言（「毎週」「毎月」等）
 * になる（DTSTART に暗黙依存する状態を、DTSTART を知らずに説明する以上の
 * 情報は得られないための既知の制限）。
 */
function describeRecurrenceRuleJa(
  state: RecurrenceRuleState,
  context?: { dtstart?: Date; timeZone?: TimeZoneId },
): string {
  const interval = Number.isInteger(state.interval) && state.interval >= 1 ? state.interval : 1;
  const base = describeBaseJa(state, interval, context);
  return `${base}${describeEndSuffixJa(state.end, context?.timeZone)}`;
}

/** {@link validateRecurrenceRuleState} の検証エラー 1 件の日本語文言。 */
function validationMessageJa(issue: RecurrenceValidationIssue): string {
  switch (issue.field) {
    case 'interval':
      return '繰り返し間隔（interval）は 1 以上の整数で指定してください';
    case 'byWeekday':
      switch (issue.code) {
        case 'empty':
          return '曜日を 1 つ以上指定してください';
        case 'duplicate':
          return '同じ曜日を重複して指定することはできません';
        case 'outOfRange':
          return '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください';
      }
      break;
    case 'monthlyPattern':
      switch (issue.code) {
        case 'dayOfMonthInvalid':
          return '月内日付は 1〜31 または -1（月末）で指定してください';
        case 'ordinalInvalid':
          return '第 n 週の指定は 1〜4 または -1（最終週）で指定してください';
        case 'weekdayInvalid':
          return '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください';
      }
      break;
    case 'count':
      return '回数（count）は 1 以上の整数で指定してください';
    case 'until':
      return '終了日（until）に有効な日時を指定してください';
  }
}

/** 対応していない RRULE フィールド（{@link RecurrenceUnsupportedField}）の日本語表示名。 */
function unsupportedFieldLabelJa(field: RecurrenceUnsupportedField): string {
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
      return 'BYDAY の内部展開形式';
    case 'BYMONTHDAY_EXPANDED':
      return 'BYMONTHDAY の内部展開形式';
  }
}

/** {@link parseRecurrenceRule} の非対応理由（{@link RecurrenceUnsupportedReason}）の日本語文言。 */
function unsupportedReasonJa(reason: RecurrenceUnsupportedReason): string {
  switch (reason.code) {
    case 'unsupportedField':
      return `対応していない RRULE の指定です（${unsupportedFieldLabelJa(reason.field)}）`;
    case 'unsupportedWkst':
      return '対応していない RRULE の指定です（月曜以外を指定する WKST）';
    case 'unsupportedFrequency':
      return 'DAILY・WEEKLY・MONTHLY・YEARLY 以外の頻度は編集エディタでは扱えません';
    case 'countAndUntilBothSpecified':
      return 'COUNT と UNTIL を同時に指定することはできません';
    case 'byDayFormatUnrecognized':
      return 'BYDAY の形式を解釈できません';
    case 'dailyByDayOrByMonthDayUnsupported':
      return 'DAILY では BYDAY・BYMONTHDAY を編集エディタでは扱えません';
    case 'yearlyByDayOrByMonthDayUnsupported':
      return 'YEARLY では BYDAY・BYMONTHDAY を編集エディタでは扱えません';
    case 'weeklyByMonthDayUnsupported':
      return 'WEEKLY で BYMONTHDAY を編集エディタでは扱えません';
    case 'weeklyByDayOrdinalUnsupported':
      return 'WEEKLY の BYDAY に第 n 週指定は使用できません';
    case 'monthlyByDayAndByMonthDayConflict':
      return 'MONTHLY で BYDAY と BYMONTHDAY を同時に指定することはできません';
    case 'monthlyByMonthDayMultipleValuesUnsupported':
      return 'MONTHLY の BYMONTHDAY は単一の値のみ編集エディタで扱えます';
    case 'monthlyByDayMultipleTokensUnsupported':
      return 'MONTHLY の BYDAY は単一の曜日指定のみ編集エディタで扱えます';
    case 'monthlyByDayOrdinalRequired':
      return 'MONTHLY の BYDAY には第 n 週指定が必要です';
    case 'monthlyByDayOrdinalOutOfRange':
      return 'MONTHLY の BYDAY の第 n 週指定は 1〜4 または -1（最終週）のみ編集エディタで扱えます';
    case 'invalidRRuleSyntax':
      return `RRULE の解析に失敗しました（${reason.detail}）`;
  }
}

/** イベント aria-label 内で項目（タイトル・日時範囲・リソース名）を連結する区切り記号。 */
const EVENT_ARIA_LABEL_SEPARATOR = '、';

const common: MessageCatalog['common'] = {
  untitledEvent: '(タイトルなし)',
  rangeSeparator: '〜',
  eventAriaLabel: (occurrence, parts) => {
    const base = `${occurrence.event.title}${EVENT_ARIA_LABEL_SEPARATOR}${parts.rangeLabel}`;
    return parts.resourceLabel === undefined
      ? base
      : `${base}${EVENT_ARIA_LABEL_SEPARATOR}${parts.resourceLabel}`;
  },
};

const toolbar: MessageCatalog['toolbar'] = {
  month: '月',
  week: '週',
  day: '日',
  list: 'リスト',
  year: '年',
  multiMonth: '複数月',
  resource: 'リソース',
  timeline: 'タイムライン',
  today: '今日',
  prev: '前へ',
  next: '次へ',
  viewsGroup: '表示切替',
};

const list: MessageCatalog['list'] = {
  allDay: '終日',
  empty: '予定はありません',
  dayAriaLabel: (day, dateLabel) => `${dateLabel} 予定${day.occurrences.length}件`,
};

const month: MessageCatalog['month'] = {
  overflow: (count) => `+${count} 件`,
};

const multiMonth: MessageCatalog['multiMonth'] = {
  overflow: (count) => `+${count} 件`,
};

const resource: MessageCatalog['resource'] = {
  unassigned: '未割り当て',
  empty: 'リソースがありません',
};

const timeline: MessageCatalog['timeline'] = {
  unassigned: '未割り当て',
  empty: 'リソースがありません',
  corner: 'リソース',
  resourceToggleAriaLabel: (toggleTarget, collapsed) =>
    collapsed ? `${toggleTarget.title} を展開する` : `${toggleTarget.title} を折りたたむ`,
};

/** {@link MessageCatalog.year.dayCount} の日本語実装。 */
function yearDayCountJa(count: number): string {
  return `予定${count}件`;
}

const year: MessageCatalog['year'] = {
  dayCount: yearDayCountJa,
  dayAriaLabel: (_day, parts) =>
    parts.countLabel === null ? parts.dateLabel : `${parts.dateLabel} ${parts.countLabel}`,
};

/** {@link EventChangeVerb} の日本語表記（`eventChanged` の文中に埋め込む）。 */
function verbTextJa(verb: EventChangeVerb): string {
  switch (verb) {
    case 'moved':
      return '移動';
    case 'resized':
      return 'サイズ変更';
    case 'convertedToAllDay':
      return '終日予定に変更';
    case 'convertedToTimed':
      return '時間指定予定に変更';
  }
}

/** `RecurringEditScope` の日本語の付記文言（`null` は付記なし）。 */
function describeScopeJa(scope: RecurringEditScope | null): string | null {
  switch (scope) {
    case 'this':
      return 'この予定のみ';
    case 'thisAndFollowing':
      return 'これ以降のすべての予定';
    case 'all':
      return 'すべての予定';
    case null:
      return null;
  }
}

const announcer: MessageCatalog['announcer'] = {
  unassignedResource: '未割り当て',
  eventChanged: (change, verb, rangeLabel, resourceLabel) => {
    const base = `${change.occurrence.event.title} を ${rangeLabel} に${verbTextJa(verb)}しました`;
    return resourceLabel === null ? base : `${base}（${resourceLabel}）`;
  },
  eventCreated: (event, _selection, rangeLabel, resourceLabel) => {
    const base = `${event.title} を ${rangeLabel} に作成しました`;
    return resourceLabel === null ? base : `${base}（${resourceLabel}）`;
  },
  eventDeleted: (deletion) => {
    const scopeLabel = describeScopeJa(deletion.scope);
    const base = `${deletion.occurrence.event.title} を削除しました`;
    return scopeLabel === null ? base : `${base}（${scopeLabel}）`;
  },
  viewChanged: (_info, title) => `表示を${title}に切り替えました`,
};

const recurrenceEditor: MessageCatalog['recurrenceEditor'] = {
  describeRule: describeRecurrenceRuleJa,
  validationMessage: validationMessageJa,
  unsupportedReason: unsupportedReasonJa,
};

/**
 * 日本語 (ja) の既定メッセージカタログ。
 *
 * `CalendarOptions.locale` の既定値（`'ja'`）に対応し、`resolveMessageCatalog`
 * が同梱ロケール未対応時のフォールバック先としても使う。
 */
export const jaMessages: MessageCatalog = {
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
