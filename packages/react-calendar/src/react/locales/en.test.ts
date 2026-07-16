/**
 * @packageDocumentation
 * `enMessages`（英語のメッセージカタログ）のテスト。
 *
 * `describeRule` の一部は旧 `en-us.ts`（`describeRecurrenceRuleEn`）のテストから
 * 新シグネチャ（`defaultDescription` 引数を持たない）へ調整して移設したもの。
 */
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, EventOccurrence, ListDay, YearDay } from '../../core/types';
import { enMessages } from './en';

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

  it('end.type=never は末尾に何も付加しない', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('Daily');
  });
});

describe('enMessages.recurrenceEditor.validationMessage / unsupportedReason', () => {
  it('validationMessage が全 code に対して英語文言を返す', () => {
    const { validationMessage } = enMessages.recurrenceEditor;
    expect(validationMessage({ field: 'interval', code: 'invalid' })).toBe(
      'Repeat interval must be an integer of 1 or greater.',
    );
    expect(validationMessage({ field: 'byWeekday', code: 'empty' })).toBe(
      'Select at least one weekday.',
    );
    expect(validationMessage({ field: 'count', code: 'invalid' })).toBe(
      'Count must be an integer of 1 or greater.',
    );
    expect(validationMessage({ field: 'until', code: 'invalid' })).toBe(
      'Specify a valid date and time for the end date.',
    );
  });

  it('unsupportedReason が代表的な code に対して英語文言を返す', () => {
    const { unsupportedReason } = enMessages.recurrenceEditor;
    expect(unsupportedReason({ code: 'unsupportedField', field: 'BYSETPOS' })).toBe(
      'Unsupported RRULE field (BYSETPOS).',
    );
    expect(unsupportedReason({ code: 'unsupportedFrequency' })).toBe(
      'Only DAILY, WEEKLY, MONTHLY, and YEARLY frequencies are supported by the editor.',
    );
    expect(unsupportedReason({ code: 'invalidRRuleSyntax', detail: 'unexpected token' })).toBe(
      'Failed to parse RRULE (unexpected token).',
    );
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
