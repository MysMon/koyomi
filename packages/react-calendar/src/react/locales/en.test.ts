/**
 * @packageDocumentation
 * `enMessages`（英語のメッセージカタログ）のテスト。
 *
 * `describeRule` の一部は旧 `en-us.ts`（`describeRecurrenceRuleEn`）のテストから
 * 新シグネチャ（`defaultDescription` 引数を持たない）へ調整して移設したもの。
 */
import { describe, expect, it } from 'vitest';
import type {
  RecurrenceUnsupportedReason,
  RecurrenceValidationIssue,
} from '../../core/recurrence-editor';
import type { CalendarEvent, EventOccurrence, ListDay, YearDay } from '../../core/types';
import { enMessages } from './en';
import { jaMessages } from './ja';

describe('enMessages.recurrenceEditor.describeRule', () => {
  const { describeRule } = enMessages.recurrenceEditor;

  it('DAILY: interval=1 は "Daily"、interval=2 以上は "Every N days" になる', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('Daily');
    expect(describeRule({ freq: 'daily', interval: 3, end: { type: 'never' } })).toBe(
      'Every 3 days',
    );
  });

  it('WEEKLY: byWeekday を指定した場合は曜日の英語略称を含む文言になる', () => {
    expect(
      describeRule({ freq: 'weekly', interval: 1, byWeekday: [3, 1], end: { type: 'never' } }),
    ).toBe('Weekly on Mon, Wed');
    expect(
      describeRule({ freq: 'weekly', interval: 2, byWeekday: [1], end: { type: 'never' } }),
    ).toBe('Every 2 weeks on Mon');
  });

  it('WEEKLY: byWeekday 省略時は曜日を欠いた文言になる（context を渡しても使用しない）', () => {
    expect(describeRule({ freq: 'weekly', interval: 1, end: { type: 'never' } })).toBe('Weekly');
  });

  it('WEEKLY: byWeekday 省略・interval>1 は "Every N weeks" になる（曜日を欠いた文言）', () => {
    expect(describeRule({ freq: 'weekly', interval: 2, end: { type: 'never' } })).toBe(
      'Every 2 weeks',
    );
  });

  it('WEEKLY: byWeekday の全曜日略称（Sun〜Sat）を昇順に連結する', () => {
    expect(
      describeRule({
        freq: 'weekly',
        interval: 1,
        byWeekday: [6, 0, 5, 1, 4, 2, 3],
        end: { type: 'never' },
      }),
    ).toBe('Weekly on Sun, Mon, Tue, Wed, Thu, Fri, Sat');
  });

  it('MONTHLY: dayOfMonth は "Monthly on day N"、nthWeekday は "Monthly on the Nth Weekday" になる', () => {
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: 15 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on day 15');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: -1 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the last day');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 1 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the 2nd Monday');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the last Friday');
  });

  it('MONTHLY: monthlyPattern の全序数（1st〜4th）・全曜日フルネーム（Sunday〜Saturday）を網羅する', () => {
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 1, weekday: 0 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the 1st Sunday');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 3, weekday: 2 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the 3rd Tuesday');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 4, weekday: 3 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the 4th Wednesday');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 4 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the last Thursday');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 1, weekday: 6 },
        end: { type: 'never' },
      }),
    ).toBe('Monthly on the 1st Saturday');
  });

  it('MONTHLY: monthlyPattern 省略時は interval=1 が "Monthly"、interval>1 が "Every N months" になる', () => {
    expect(describeRule({ freq: 'monthly', interval: 1, end: { type: 'never' } })).toBe('Monthly');
    expect(describeRule({ freq: 'monthly', interval: 3, end: { type: 'never' } })).toBe(
      'Every 3 months',
    );
  });

  it('MONTHLY: monthlyPattern 指定・interval>1 は "Every N months on パターン" になる', () => {
    expect(
      describeRule({
        freq: 'monthly',
        interval: 2,
        monthlyPattern: { kind: 'dayOfMonth', day: 15 },
        end: { type: 'never' },
      }),
    ).toBe('Every 2 months on day 15');
  });

  it('interval が 0 以下・非整数の場合は表示上 1 として扱う', () => {
    expect(describeRule({ freq: 'daily', interval: 0, end: { type: 'never' } })).toBe('Daily');
  });

  it('YEARLY: state に月日を持たないため、context を渡しても常に月日を欠いた文言になる', () => {
    expect(
      describeRule(
        { freq: 'yearly', interval: 1, end: { type: 'never' } },
        { dtstart: new Date('2026-07-01T00:00:00Z'), timeZone: 'Asia/Tokyo' },
      ),
    ).toBe('Annually');
    expect(describeRule({ freq: 'yearly', interval: 2, end: { type: 'never' } })).toBe(
      'Every 2 years',
    );
  });

  it('end.type=count は末尾に " (for N occurrences)" を付加する（count=1 は単数形）', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'count', count: 1 } })).toBe(
      'Daily (for 1 occurrence)',
    );
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'count', count: 5 } })).toBe(
      'Daily (for 5 occurrences)',
    );
  });

  it('end.type=until は末尾に " (until Jul 5, 2026)" を付加する', () => {
    expect(
      describeRule({
        freq: 'daily',
        interval: 1,
        end: { type: 'until', until: new Date('2026-07-05T00:00:00Z') },
      }),
    ).toBe('Daily (until Jul 5, 2026)');
  });

  it.each([
    ['2026-01-05T00:00:00Z', 'Jan 5, 2026'],
    ['2026-02-05T00:00:00Z', 'Feb 5, 2026'],
    ['2026-03-05T00:00:00Z', 'Mar 5, 2026'],
    ['2026-04-05T00:00:00Z', 'Apr 5, 2026'],
    ['2026-05-05T00:00:00Z', 'May 5, 2026'],
    ['2026-06-05T00:00:00Z', 'Jun 5, 2026'],
    ['2026-07-05T00:00:00Z', 'Jul 5, 2026'],
    ['2026-08-05T00:00:00Z', 'Aug 5, 2026'],
    ['2026-09-05T00:00:00Z', 'Sep 5, 2026'],
    ['2026-10-05T00:00:00Z', 'Oct 5, 2026'],
    ['2026-11-05T00:00:00Z', 'Nov 5, 2026'],
    ['2026-12-05T00:00:00Z', 'Dec 5, 2026'],
  ] satisfies ReadonlyArray<
    [string, string]
  >)('end.type=until の日付整形が全 12 か月の略称を正しく使う（%s → %s）', (untilIso, expectedDate) => {
    expect(
      describeRule({
        freq: 'daily',
        interval: 1,
        end: { type: 'until', until: new Date(untilIso) },
      }),
    ).toBe(`Daily (until ${expectedDate})`);
  });

  it('end.type=never は末尾に何も付加しない', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('Daily');
  });
});

describe('enMessages.recurrenceEditor.validationMessage', () => {
  const { validationMessage } = enMessages.recurrenceEditor;

  it.each([
    [{ field: 'interval', code: 'invalid' }, 'Repeat interval must be an integer of 1 or greater.'],
    [{ field: 'byWeekday', code: 'empty' }, 'Select at least one weekday.'],
    [
      { field: 'byWeekday', code: 'duplicate' },
      'The same weekday cannot be selected more than once.',
    ],
    [
      { field: 'byWeekday', code: 'outOfRange' },
      'Weekday must be between 0 (Sunday) and 6 (Saturday).',
    ],
    [
      { field: 'monthlyPattern', code: 'dayOfMonthInvalid' },
      'Day of month must be between 1 and 31, or -1 (last day).',
    ],
    [
      { field: 'monthlyPattern', code: 'ordinalInvalid' },
      'Week ordinal must be between 1 and 4, or -1 (last).',
    ],
    [
      { field: 'monthlyPattern', code: 'weekdayInvalid' },
      'Weekday must be between 0 (Sunday) and 6 (Saturday).',
    ],
    [{ field: 'count', code: 'invalid' }, 'Count must be an integer of 1 or greater.'],
    [{ field: 'until', code: 'invalid' }, 'Specify a valid date and time for the end date.'],
  ] satisfies ReadonlyArray<[RecurrenceValidationIssue, string]>)('%j → %s', (issue, expected) => {
    expect(validationMessage(issue)).toBe(expected);
  });
});

describe('enMessages.recurrenceEditor.unsupportedReason', () => {
  const { unsupportedReason } = enMessages.recurrenceEditor;

  it.each([
    [{ code: 'unsupportedField', field: 'BYSETPOS' }, 'Unsupported RRULE field (BYSETPOS).'],
    [{ code: 'unsupportedField', field: 'BYMONTH' }, 'Unsupported RRULE field (BYMONTH).'],
    [{ code: 'unsupportedField', field: 'BYYEARDAY' }, 'Unsupported RRULE field (BYYEARDAY).'],
    [{ code: 'unsupportedField', field: 'BYWEEKNO' }, 'Unsupported RRULE field (BYWEEKNO).'],
    [{ code: 'unsupportedField', field: 'BYHOUR' }, 'Unsupported RRULE field (BYHOUR).'],
    [{ code: 'unsupportedField', field: 'BYMINUTE' }, 'Unsupported RRULE field (BYMINUTE).'],
    [{ code: 'unsupportedField', field: 'BYSECOND' }, 'Unsupported RRULE field (BYSECOND).'],
    [{ code: 'unsupportedField', field: 'BYEASTER' }, 'Unsupported RRULE field (BYEASTER).'],
    [
      { code: 'unsupportedField', field: 'BYDAY_EXPANDED' },
      'Unsupported RRULE field (the expanded BYDAY form).',
    ],
    [
      { code: 'unsupportedField', field: 'BYMONTHDAY_EXPANDED' },
      'Unsupported RRULE field (the expanded BYMONTHDAY form).',
    ],
    [{ code: 'unsupportedWkst' }, 'Unsupported RRULE field (WKST other than Monday).'],
    [
      { code: 'unsupportedFrequency' },
      'Only DAILY, WEEKLY, MONTHLY, and YEARLY frequencies are supported by the editor.',
    ],
    [{ code: 'countAndUntilBothSpecified' }, 'COUNT and UNTIL cannot be specified together.'],
    [{ code: 'byDayFormatUnrecognized' }, 'Could not parse the BYDAY format.'],
    [
      { code: 'dailyByDayOrByMonthDayUnsupported' },
      'BYDAY and BYMONTHDAY are not supported by the editor for DAILY.',
    ],
    [
      { code: 'yearlyByDayOrByMonthDayUnsupported' },
      'BYDAY and BYMONTHDAY are not supported by the editor for YEARLY.',
    ],
    [
      { code: 'weeklyByMonthDayUnsupported' },
      'BYMONTHDAY is not supported by the editor for WEEKLY.',
    ],
    [
      { code: 'weeklyByDayOrdinalUnsupported' },
      'A week ordinal in BYDAY is not allowed for WEEKLY.',
    ],
    [
      { code: 'monthlyByDayAndByMonthDayConflict' },
      'BYDAY and BYMONTHDAY cannot be specified together for MONTHLY.',
    ],
    [
      { code: 'monthlyByMonthDayMultipleValuesUnsupported' },
      'Only a single BYMONTHDAY value is supported by the editor for MONTHLY.',
    ],
    [
      { code: 'monthlyByDayMultipleTokensUnsupported' },
      'Only a single weekday in BYDAY is supported by the editor for MONTHLY.',
    ],
    [{ code: 'monthlyByDayOrdinalRequired' }, 'BYDAY for MONTHLY requires a week ordinal.'],
    [
      { code: 'monthlyByDayOrdinalOutOfRange' },
      'The week ordinal in BYDAY must be between 1 and 4, or -1 (last), for MONTHLY.',
    ],
    [
      { code: 'invalidRRuleSyntax', detail: 'unexpected token' },
      'Failed to parse RRULE (unexpected token).',
    ],
  ] satisfies ReadonlyArray<
    [RecurrenceUnsupportedReason, string]
  >)('%j → %s', (reason, expected) => {
    expect(unsupportedReason(reason)).toBe(expected);
  });
});

/** テスト用の最小限の妥当な `EventOccurrence` を作る。 */
function makeOccurrence(): EventOccurrence {
  const start = new Date('2026-07-16T01:00:00Z');
  const end = new Date('2026-07-16T02:00:00Z');
  const event: CalendarEvent = { id: 'e1', title: 'Meeting', start, end };
  return {
    key: `e1@${start.toISOString()}`,
    eventId: 'e1',
    event,
    start,
    end,
    allDay: false,
    isRecurring: false,
    originalStart: start,
  };
}

/** テスト用の最小限の妥当な `ListDay` を作る。 */
function makeListDay(occurrenceCount: number): ListDay {
  return {
    date: new Date('2026-07-16T00:00:00+09:00'),
    key: '2026-07-16',
    isToday: false,
    occurrences: Array.from({ length: occurrenceCount }, () => makeOccurrence()),
  };
}

/** テスト用の最小限の妥当な `YearDay` を作る。 */
function makeYearDay(eventCount: number): YearDay {
  return {
    date: new Date('2026-07-10T00:00:00+09:00'),
    key: '2026-07-10',
    inCurrentMonth: true,
    isToday: false,
    eventCount,
  };
}

describe('enMessages.common', () => {
  it('untitledEvent / rangeSeparator が英語文言になる', () => {
    expect(enMessages.common.untitledEvent).toBe('Untitled event');
    expect(enMessages.common.rangeSeparator).toBe('–');
  });

  it('eventAriaLabel はタイトルと rangeLabel を ", " で連結する（resourceLabel 省略時）', () => {
    expect(
      enMessages.common.eventAriaLabel(makeOccurrence(), { rangeLabel: 'July 16 10:00–11:00' }),
    ).toBe('Meeting, July 16 10:00–11:00');
  });

  it('eventAriaLabel は resourceLabel 指定時、末尾に同じ区切り記号で連結する（区切りの混在を防ぐ）', () => {
    expect(
      enMessages.common.eventAriaLabel(makeOccurrence(), {
        rangeLabel: 'July 16 10:00–11:00',
        resourceLabel: 'Room A',
      }),
    ).toBe('Meeting, July 16 10:00–11:00, Room A');
  });
});

describe('enMessages.toolbar', () => {
  it('8 ビュー名 + today/prev/next/viewsGroup が英語文言になる', () => {
    expect(enMessages.toolbar).toEqual({
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
    });
  });
});

describe('enMessages.list', () => {
  it('allDay / empty が英語文言になる', () => {
    expect(enMessages.list.allDay).toBe('All day');
    expect(enMessages.list.empty).toBe('No events');
  });

  it('dayAriaLabel は件数の単数/複数を切り替える', () => {
    expect(enMessages.list.dayAriaLabel(makeListDay(1), 'July 16')).toBe('July 16 1 event');
    expect(enMessages.list.dayAriaLabel(makeListDay(2), 'July 16')).toBe('July 16 2 events');
  });
});

describe('enMessages.month / multiMonth', () => {
  it('overflow が "+N more" になる', () => {
    expect(enMessages.month.overflow(3)).toBe('+3 more');
    expect(enMessages.multiMonth.overflow(5)).toBe('+5 more');
  });
});

describe('enMessages.resource / timeline', () => {
  it('unassigned / empty / corner が英語文言になる', () => {
    expect(enMessages.resource.unassigned).toBe('Unassigned');
    expect(enMessages.resource.empty).toBe('No resources');
    expect(enMessages.timeline.unassigned).toBe('Unassigned');
    expect(enMessages.timeline.empty).toBe('No resources');
    expect(enMessages.timeline.corner).toBe('Resources');
  });

  it('resourceToggleAriaLabel は collapsed に応じて Expand/Collapse になる', () => {
    const resource = { id: 'room-a', title: 'Room A' };
    expect(enMessages.timeline.resourceToggleAriaLabel(resource, false)).toBe('Collapse Room A');
    expect(enMessages.timeline.resourceToggleAriaLabel(resource, true)).toBe('Expand Room A');
  });
});

describe('enMessages.year', () => {
  it('dayCount が単数/複数を切り替える', () => {
    expect(enMessages.year.dayCount(1)).toBe('1 event');
    expect(enMessages.year.dayCount(3)).toBe('3 events');
  });

  it('dayAriaLabel は countLabel が非 null のときのみ件数文言を付加する（自身では dayCount を呼ばず、渡された countLabel をそのまま使う）', () => {
    expect(
      enMessages.year.dayAriaLabel(makeYearDay(3), {
        dateLabel: 'July 10',
        countLabel: enMessages.year.dayCount(3),
      }),
    ).toBe('July 10 3 events');
    expect(
      enMessages.year.dayAriaLabel(makeYearDay(0), { dateLabel: 'July 10', countLabel: null }),
    ).toBe('July 10');
  });
});

describe('enMessages.announcer', () => {
  it('unassignedResource が英語文言になる', () => {
    expect(enMessages.announcer.unassignedResource).toBe('Unassigned');
  });

  it('eventChanged は verb ごとの文言＋resourceLabel の付記を組み立てる', () => {
    const change = {
      occurrence: makeOccurrence(),
      newRange: { start: new Date('2026-07-16T01:00:00Z'), end: new Date('2026-07-16T02:00:00Z') },
      allDay: false,
      scope: null,
      changes: [],
    };
    expect(enMessages.announcer.eventChanged(change, 'moved', 'July 16 10:00–11:00', null)).toBe(
      'Meeting moved to July 16 10:00–11:00',
    );
    expect(enMessages.announcer.eventChanged(change, 'resized', 'July 16 10:00–11:30', null)).toBe(
      'Meeting resized to July 16 10:00–11:30',
    );
    expect(
      enMessages.announcer.eventChanged(change, 'convertedToAllDay', 'July 16', 'Room A'),
    ).toBe('Meeting changed to an all-day event, now on July 16 (Room A)');
    expect(
      enMessages.announcer.eventChanged(change, 'convertedToTimed', 'July 16 10:00–11:00', null),
    ).toBe('Meeting changed to a timed event, now at July 16 10:00–11:00');
  });

  it('eventCreated は "title created for rangeLabel" ＋resourceLabel の付記を組み立てる', () => {
    const start = new Date('2026-07-16T01:00:00Z');
    const end = new Date('2026-07-16T02:00:00Z');
    const event: CalendarEvent = { id: 'e2', title: 'Meeting', start, end };
    const selection = {
      range: { start, end },
      allDay: false,
      resourceId: 'r1',
    };
    expect(
      enMessages.announcer.eventCreated(event, selection, 'July 16 10:00–11:00', 'Room A'),
    ).toBe('Meeting created for July 16 10:00–11:00 (Room A)');
    expect(enMessages.announcer.eventCreated(event, selection, 'July 16 10:00–11:00', null)).toBe(
      'Meeting created for July 16 10:00–11:00',
    );
  });

  it('eventDeleted は scope ごとに付記が変わる（null は付記なし）', () => {
    const deletion = { occurrence: makeOccurrence(), changes: [] };
    expect(enMessages.announcer.eventDeleted({ ...deletion, scope: null })).toBe('Meeting deleted');
    expect(enMessages.announcer.eventDeleted({ ...deletion, scope: 'this' })).toBe(
      'Meeting deleted (this event only)',
    );
    expect(enMessages.announcer.eventDeleted({ ...deletion, scope: 'thisAndFollowing' })).toBe(
      'Meeting deleted (this and following events)',
    );
    expect(enMessages.announcer.eventDeleted({ ...deletion, scope: 'all' })).toBe(
      'Meeting deleted (all events in the series)',
    );
  });

  it('viewChanged は "Switched view to title" になる', () => {
    const info = {
      view: 'month' as const,
      currentDate: new Date('2026-07-15T01:00:00Z'),
      rangeStart: new Date('2026-06-30T15:00:00Z'),
      rangeEnd: new Date('2026-07-31T15:00:00Z'),
    };
    expect(enMessages.announcer.viewChanged(info, 'July 2026')).toBe('Switched view to July 2026');
  });
});

describe('enMessages と jaMessages のキー整合性', () => {
  it('グループ名の集合が一致する', () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(jaMessages).sort());
  });

  it.each(
    Object.keys(jaMessages) as ReadonlyArray<keyof typeof jaMessages>,
  )('%s グループのリーフ名の集合が一致する', (group) => {
    expect(Object.keys(enMessages[group]).sort()).toEqual(Object.keys(jaMessages[group]).sort());
  });
});
