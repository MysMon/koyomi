/**
 * @packageDocumentation
 * `jaMessages`（日本語の既定メッセージカタログ）のテスト。
 *
 * `describeRule` の 19 ケースは、旧 `core/recurrence-editor.ts` の
 * `describeRecurrenceRule` のテスト（core の code 化に伴い移設）。
 * それ以外は各グループの代表文言と、`validationMessage` / `unsupportedReason`
 * の code 網羅を検証する。
 */
import { describe, expect, it } from 'vitest';
import type {
  RecurrenceEnd,
  RecurrenceUnsupportedReason,
  RecurrenceValidationIssue,
} from '../../core/recurrence-editor';
import type { CalendarEvent, EventOccurrence, ListDay, YearDay } from '../../core/types';
import { jaMessages } from './ja';

const TOKYO = 'Asia/Tokyo';
/** 東京 7/1 9:00 の絶対時刻（水曜日）。 */
const TOKYO_JULY_1_9AM = new Date('2026-07-01T00:00:00Z');

describe('jaMessages.recurrenceEditor.describeRule', () => {
  const { describeRule } = jaMessages.recurrenceEditor;

  it('DAILY: interval=1 は「毎日」、interval=2 以上は「N日ごと」になる', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('毎日');
    expect(describeRule({ freq: 'daily', interval: 2, end: { type: 'never' } })).toBe('2日ごと');
  });

  it('WEEKLY: byWeekday を指定した場合は曜日を含む文言になる', () => {
    expect(
      describeRule({ freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } }),
    ).toBe('毎週月・水');
  });

  it('WEEKLY: byWeekday 省略・context あり → context の dtstart の曜日で補う', () => {
    // TOKYO_JULY_1_9AM（2026-07-01, 東京）は水曜日
    expect(
      describeRule(
        { freq: 'weekly', interval: 1, end: { type: 'never' } },
        { dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO },
      ),
    ).toBe('毎週水');
  });

  it('WEEKLY: byWeekday 省略・context なし → 曜日を欠いた文言になる', () => {
    expect(describeRule({ freq: 'weekly', interval: 1, end: { type: 'never' } })).toBe('毎週');
  });

  it('MONTHLY: dayOfMonth は「毎月N日」、day=-1 は「毎月末日」になる', () => {
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: 15 },
        end: { type: 'never' },
      }),
    ).toBe('毎月15日');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: -1 },
        end: { type: 'never' },
      }),
    ).toBe('毎月末日');
  });

  it('MONTHLY: nthWeekday は「毎月 第N曜日」「毎月 最終曜日」になる', () => {
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 1 },
        end: { type: 'never' },
      }),
    ).toBe('毎月 第2月曜日');
    expect(
      describeRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
        end: { type: 'never' },
      }),
    ).toBe('毎月 最終金曜日');
  });

  it('YEARLY: context から月日を補い「毎年M月D日」になる', () => {
    expect(
      describeRule(
        { freq: 'yearly', interval: 1, end: { type: 'never' } },
        { dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO },
      ),
    ).toBe('毎年7月1日');
  });

  it('YEARLY: context なしは「毎年」になる', () => {
    expect(describeRule({ freq: 'yearly', interval: 1, end: { type: 'never' } })).toBe('毎年');
  });

  it('interval<=0 は表示上 1 として扱う', () => {
    expect(describeRule({ freq: 'daily', interval: 0, end: { type: 'never' } })).toBe('毎日');
  });

  it('end.type=count は末尾に「（N回）」を付加する（count=1 も単数表現で問題ない）', () => {
    const end: RecurrenceEnd = { type: 'count', count: 1 };
    expect(describeRule({ freq: 'daily', interval: 1, end })).toBe('毎日（1回）');
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'count', count: 5 } })).toBe(
      '毎日（5回）',
    );
  });

  it('end.type=until は timeZone 指定時は現地日付、省略時は UTC 成分で整形する', () => {
    const until = new Date('2026-07-05T00:00:00Z');
    expect(
      describeRule(
        { freq: 'daily', interval: 1, end: { type: 'until', until } },
        { timeZone: TOKYO },
      ),
    ).toBe('毎日（2026年7月5日まで）');
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'until', until } })).toBe(
      '毎日（2026年7月5日まで）',
    );
  });

  it('end.type=until は timeZone 指定の有無で日付が異なりうる（UTC 20:00 → 東京では翌日）', () => {
    const until = new Date('2026-07-05T20:00:00Z'); // 東京では 7/6 5:00
    expect(
      describeRule(
        { freq: 'daily', interval: 1, end: { type: 'until', until } },
        { timeZone: TOKYO },
      ),
    ).toBe('毎日（2026年7月6日まで）');
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'until', until } })).toBe(
      '毎日（2026年7月5日まで）',
    );
  });

  it('end.type=never は末尾に何も付加しない', () => {
    expect(describeRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('毎日');
  });
});

describe('jaMessages.recurrenceEditor.validationMessage', () => {
  const { validationMessage } = jaMessages.recurrenceEditor;

  it.each([
    [
      { field: 'interval', code: 'invalid' },
      '繰り返し間隔（interval）は 1 以上の整数で指定してください',
    ],
    [{ field: 'byWeekday', code: 'empty' }, '曜日を 1 つ以上指定してください'],
    [{ field: 'byWeekday', code: 'duplicate' }, '同じ曜日を重複して指定することはできません'],
    [
      { field: 'byWeekday', code: 'outOfRange' },
      '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください',
    ],
    [
      { field: 'monthlyPattern', code: 'dayOfMonthInvalid' },
      '月内日付は 1〜31 または -1（月末）で指定してください',
    ],
    [
      { field: 'monthlyPattern', code: 'ordinalInvalid' },
      '第 n 週の指定は 1〜4 または -1（最終週）で指定してください',
    ],
    [
      { field: 'monthlyPattern', code: 'weekdayInvalid' },
      '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください',
    ],
    [{ field: 'count', code: 'invalid' }, '回数（count）は 1 以上の整数で指定してください'],
    [{ field: 'until', code: 'invalid' }, '終了日（until）に有効な日時を指定してください'],
  ] satisfies ReadonlyArray<[RecurrenceValidationIssue, string]>)('%j → %s', (issue, expected) => {
    expect(validationMessage(issue)).toBe(expected);
  });
});

describe('jaMessages.recurrenceEditor.unsupportedReason', () => {
  const { unsupportedReason } = jaMessages.recurrenceEditor;

  it.each([
    [
      { code: 'unsupportedField', field: 'BYSETPOS' },
      '対応していない RRULE の指定です（BYSETPOS）',
    ],
    [{ code: 'unsupportedField', field: 'BYMONTH' }, '対応していない RRULE の指定です（BYMONTH）'],
    [
      { code: 'unsupportedField', field: 'BYYEARDAY' },
      '対応していない RRULE の指定です（BYYEARDAY）',
    ],
    [
      { code: 'unsupportedField', field: 'BYWEEKNO' },
      '対応していない RRULE の指定です（BYWEEKNO）',
    ],
    [{ code: 'unsupportedField', field: 'BYHOUR' }, '対応していない RRULE の指定です（BYHOUR）'],
    [
      { code: 'unsupportedField', field: 'BYMINUTE' },
      '対応していない RRULE の指定です（BYMINUTE）',
    ],
    [
      { code: 'unsupportedField', field: 'BYSECOND' },
      '対応していない RRULE の指定です（BYSECOND）',
    ],
    [
      { code: 'unsupportedField', field: 'BYEASTER' },
      '対応していない RRULE の指定です（BYEASTER）',
    ],
    [
      { code: 'unsupportedField', field: 'BYDAY_EXPANDED' },
      '対応していない RRULE の指定です（BYDAY の内部展開形式）',
    ],
    [
      { code: 'unsupportedField', field: 'BYMONTHDAY_EXPANDED' },
      '対応していない RRULE の指定です（BYMONTHDAY の内部展開形式）',
    ],
    [{ code: 'unsupportedWkst' }, '対応していない RRULE の指定です（月曜以外を指定する WKST）'],
    [
      { code: 'unsupportedFrequency' },
      'DAILY・WEEKLY・MONTHLY・YEARLY 以外の頻度は編集エディタでは扱えません',
    ],
    [{ code: 'countAndUntilBothSpecified' }, 'COUNT と UNTIL を同時に指定することはできません'],
    [{ code: 'byDayFormatUnrecognized' }, 'BYDAY の形式を解釈できません'],
    [
      { code: 'dailyByDayOrByMonthDayUnsupported' },
      'DAILY では BYDAY・BYMONTHDAY を編集エディタでは扱えません',
    ],
    [
      { code: 'yearlyByDayOrByMonthDayUnsupported' },
      'YEARLY では BYDAY・BYMONTHDAY を編集エディタでは扱えません',
    ],
    [{ code: 'weeklyByMonthDayUnsupported' }, 'WEEKLY で BYMONTHDAY を編集エディタでは扱えません'],
    [{ code: 'weeklyByDayOrdinalUnsupported' }, 'WEEKLY の BYDAY に第 n 週指定は使用できません'],
    [
      { code: 'monthlyByDayAndByMonthDayConflict' },
      'MONTHLY で BYDAY と BYMONTHDAY を同時に指定することはできません',
    ],
    [
      { code: 'monthlyByMonthDayMultipleValuesUnsupported' },
      'MONTHLY の BYMONTHDAY は単一の値のみ編集エディタで扱えます',
    ],
    [
      { code: 'monthlyByDayMultipleTokensUnsupported' },
      'MONTHLY の BYDAY は単一の曜日指定のみ編集エディタで扱えます',
    ],
    [{ code: 'monthlyByDayOrdinalRequired' }, 'MONTHLY の BYDAY には第 n 週指定が必要です'],
    [
      { code: 'monthlyByDayOrdinalOutOfRange' },
      'MONTHLY の BYDAY の第 n 週指定は 1〜4 または -1（最終週）のみ編集エディタで扱えます',
    ],
    [
      { code: 'invalidRRuleSyntax', detail: 'unexpected token' },
      'RRULE の解析に失敗しました（unexpected token）',
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
  const event: CalendarEvent = { id: 'e1', title: '会議', start, end };
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

describe('jaMessages.common', () => {
  it('untitledEvent / rangeSeparator が既定の日本語文言になる', () => {
    expect(jaMessages.common.untitledEvent).toBe('(タイトルなし)');
    expect(jaMessages.common.rangeSeparator).toBe('〜');
  });

  it('eventAriaLabel はタイトルと rangeLabel を「、」で連結する（resourceLabel 省略時）', () => {
    expect(
      jaMessages.common.eventAriaLabel(makeOccurrence(), { rangeLabel: '7月16日 10:00〜11:00' }),
    ).toBe('会議、7月16日 10:00〜11:00');
  });

  it('eventAriaLabel は resourceLabel 指定時、末尾に同じ区切り記号で連結する（区切りの混在を防ぐ）', () => {
    expect(
      jaMessages.common.eventAriaLabel(makeOccurrence(), {
        rangeLabel: '7月16日 10:00〜11:00',
        resourceLabel: '会議室A',
      }),
    ).toBe('会議、7月16日 10:00〜11:00、会議室A');
  });
});

describe('jaMessages.toolbar', () => {
  it('8 ビュー名 + today/prev/next/viewsGroup が既定の日本語文言になる', () => {
    expect(jaMessages.toolbar).toEqual({
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
    });
  });
});

describe('jaMessages.list', () => {
  it('allDay / empty が既定の日本語文言になる', () => {
    expect(jaMessages.list.allDay).toBe('終日');
    expect(jaMessages.list.empty).toBe('予定はありません');
  });

  it('dayAriaLabel は日付ラベルと件数を連結する（0 件でも「予定0件」を含める）', () => {
    expect(jaMessages.list.dayAriaLabel(makeListDay(2), '7月16日(木)')).toBe('7月16日(木) 予定2件');
    expect(jaMessages.list.dayAriaLabel(makeListDay(0), '7月16日(木)')).toBe('7月16日(木) 予定0件');
  });
});

describe('jaMessages.month / multiMonth', () => {
  it('overflow が「+N 件」になる', () => {
    expect(jaMessages.month.overflow(3)).toBe('+3 件');
    expect(jaMessages.multiMonth.overflow(5)).toBe('+5 件');
  });
});

describe('jaMessages.resource', () => {
  it('unassigned / empty が既定の日本語文言になる', () => {
    expect(jaMessages.resource.unassigned).toBe('未割り当て');
    expect(jaMessages.resource.empty).toBe('リソースがありません');
  });

  it('resourceToggleAriaLabel は collapsed に応じて展開/折りたたみの案内文になる（タイムラインと同文）', () => {
    const resource = { id: 'room-a', title: '会議室A' };
    expect(jaMessages.resource.resourceToggleAriaLabel(resource, false)).toBe(
      '会議室A を折りたたむ',
    );
    expect(jaMessages.resource.resourceToggleAriaLabel(resource, true)).toBe('会議室A を展開する');
  });
});

describe('jaMessages.timeline', () => {
  it('unassigned / empty / corner が既定の日本語文言になる', () => {
    expect(jaMessages.timeline.unassigned).toBe('未割り当て');
    expect(jaMessages.timeline.empty).toBe('リソースがありません');
    expect(jaMessages.timeline.corner).toBe('リソース');
  });

  it('resourceToggleAriaLabel は collapsed に応じて展開/折りたたみの案内文になる', () => {
    const resource = { id: 'room-a', title: '会議室A' };
    expect(jaMessages.timeline.resourceToggleAriaLabel(resource, false)).toBe(
      '会議室A を折りたたむ',
    );
    expect(jaMessages.timeline.resourceToggleAriaLabel(resource, true)).toBe('会議室A を展開する');
  });
});

describe('jaMessages.year', () => {
  it('dayCount が「予定N件」になる', () => {
    expect(jaMessages.year.dayCount(3)).toBe('予定3件');
  });

  it('dayAriaLabel は countLabel が非 null のときのみ件数文言を付加する（自身では dayCount を呼ばず、渡された countLabel をそのまま使う）', () => {
    expect(
      jaMessages.year.dayAriaLabel(makeYearDay(3), {
        dateLabel: '7月10日',
        countLabel: jaMessages.year.dayCount(3),
      }),
    ).toBe('7月10日 予定3件');
    expect(
      jaMessages.year.dayAriaLabel(makeYearDay(0), { dateLabel: '7月10日', countLabel: null }),
    ).toBe('7月10日');
  });
});

describe('jaMessages.announcer', () => {
  it('unassignedResource が既定の日本語文言になる', () => {
    expect(jaMessages.announcer.unassignedResource).toBe('未割り当て');
  });

  it('eventChanged は verb ごとの文言＋resourceLabel の付記を組み立てる', () => {
    const change = {
      occurrence: makeOccurrence(),
      newRange: { start: new Date('2026-07-16T01:00:00Z'), end: new Date('2026-07-16T02:00:00Z') },
      allDay: false,
      scope: null,
      changes: [],
    };
    expect(jaMessages.announcer.eventChanged(change, 'moved', '7月16日 10:00〜11:00', null)).toBe(
      '会議 を 7月16日 10:00〜11:00 に移動しました',
    );
    expect(jaMessages.announcer.eventChanged(change, 'resized', '7月16日 10:00〜11:30', null)).toBe(
      '会議 を 7月16日 10:00〜11:30 にサイズ変更しました',
    );
    expect(jaMessages.announcer.eventChanged(change, 'convertedToAllDay', '7月16日', null)).toBe(
      '会議 を 7月16日 に終日予定に変更しました',
    );
    expect(
      jaMessages.announcer.eventChanged(
        change,
        'convertedToTimed',
        '7月16日 10:00〜11:00',
        '会議室A',
      ),
    ).toBe('会議 を 7月16日 10:00〜11:00 に時間指定予定に変更しました（会議室A）');
  });

  it('eventCreated は「タイトル を rangeLabel に作成しました」＋resourceLabel の付記を組み立てる', () => {
    const start = new Date('2026-07-16T01:00:00Z');
    const end = new Date('2026-07-16T02:00:00Z');
    const event: CalendarEvent = { id: 'e2', title: '会議', start, end };
    const selection = {
      range: { start, end },
      allDay: false,
      resourceId: 'r1',
    };
    expect(jaMessages.announcer.eventCreated(event, selection, '7月16日 10:00〜11:00', null)).toBe(
      '会議 を 7月16日 10:00〜11:00 に作成しました',
    );
    expect(
      jaMessages.announcer.eventCreated(event, selection, '7月16日 10:00〜11:00', '会議室A'),
    ).toBe('会議 を 7月16日 10:00〜11:00 に作成しました（会議室A）');
  });

  it('eventDeleted は scope ごとに付記が変わる（null は付記なし）', () => {
    const deletion = { occurrence: makeOccurrence(), changes: [] };
    expect(jaMessages.announcer.eventDeleted({ ...deletion, scope: null })).toBe(
      '会議 を削除しました',
    );
    expect(jaMessages.announcer.eventDeleted({ ...deletion, scope: 'this' })).toBe(
      '会議 を削除しました（この予定のみ）',
    );
    expect(jaMessages.announcer.eventDeleted({ ...deletion, scope: 'thisAndFollowing' })).toBe(
      '会議 を削除しました（これ以降のすべての予定）',
    );
    expect(jaMessages.announcer.eventDeleted({ ...deletion, scope: 'all' })).toBe(
      '会議 を削除しました（すべての予定）',
    );
  });

  it('viewChanged は「表示をtitleに切り替えました」になる', () => {
    const info = {
      view: 'month' as const,
      currentDate: new Date('2026-07-15T01:00:00Z'),
      rangeStart: new Date('2026-06-30T15:00:00Z'),
      rangeEnd: new Date('2026-07-31T15:00:00Z'),
    };
    expect(jaMessages.announcer.viewChanged(info, '2026年7月')).toBe(
      '表示を2026年7月に切り替えました',
    );
  });
});
