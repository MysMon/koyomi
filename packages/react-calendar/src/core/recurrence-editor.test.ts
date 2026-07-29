/**
 * recurrence-editor.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { describe, expect, it } from 'vitest';
import { expandRecurrence } from './recurrence';
import {
  buildRecurrenceRuleString,
  type MonthlyRecurrencePattern,
  parseRecurrenceRule,
  type RecurrenceRuleState,
  type RecurrenceUnsupportedReason,
  type RecurrenceValidationIssue,
  validateRecurrenceRuleState,
} from './recurrence-editor';
import type { Weekday } from './types';

const TOKYO = 'Asia/Tokyo';

/** 東京 7/1 9:00 の絶対時刻（多くのテストの dtstart に使う）。 */
const TOKYO_JULY_1_9AM = new Date('2026-07-01T00:00:00Z');

describe('parseRecurrenceRule', () => {
  it('rrule 省略時は none を返す', () => {
    expect(
      parseRecurrenceRule({ rrule: undefined, dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO }),
    ).toEqual({ kind: 'none' });
  });

  it('FREQ=DAILY のみは interval:1・end:never の editable を返す', () => {
    expect(
      parseRecurrenceRule({ rrule: 'FREQ=DAILY', dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO }),
    ).toEqual({
      kind: 'editable',
      state: { freq: 'daily', interval: 1, end: { type: 'never' } },
    });
  });

  it('INTERVAL を保持する', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=DAILY;INTERVAL=3',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('editable');
    expect(result.kind === 'editable' && result.state.interval).toBe(3);
  });

  it('FREQ=WEEKLY;BYDAY=MO,WE は byWeekday:[1,3] になる（日=0 基準）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result).toEqual({
      kind: 'editable',
      state: { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } },
    });
  });

  it('FREQ=WEEKLY;BYDAY=SU は byWeekday:[0] になる（週境界の境界値）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result).toEqual({
      kind: 'editable',
      state: { freq: 'weekly', interval: 1, byWeekday: [0], end: { type: 'never' } },
    });
  });

  it('FREQ=WEEKLY（BYDAY 省略）は byWeekday を持たない', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=WEEKLY',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result).toEqual({
      kind: 'editable',
      state: { freq: 'weekly', interval: 1, end: { type: 'never' } },
    });
    expect(result.kind === 'editable' && 'byWeekday' in result.state).toBe(false);
  });

  it('FREQ=MONTHLY;BYMONTHDAY=15 は monthlyPattern:{kind:dayOfMonth,day:15} になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result).toEqual({
      kind: 'editable',
      state: {
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: 15 },
        end: { type: 'never' },
      },
    });
  });

  it('FREQ=MONTHLY;BYMONTHDAY=-1 は day:-1 になる（月末の境界値）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind === 'editable' && result.state.monthlyPattern).toEqual({
      kind: 'dayOfMonth',
      day: -1,
    });
  });

  it('FREQ=MONTHLY;BYDAY=2MO は monthlyPattern:{kind:nthWeekday,ordinal:2,weekday:1} になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYDAY=2MO',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind === 'editable' && result.state.monthlyPattern).toEqual({
      kind: 'nthWeekday',
      ordinal: 2,
      weekday: 1,
    });
  });

  it('FREQ=MONTHLY;BYDAY=-1FR は ordinal:-1 になる（最終週の境界値）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYDAY=-1FR',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind === 'editable' && result.state.monthlyPattern).toEqual({
      kind: 'nthWeekday',
      ordinal: -1,
      weekday: 5,
    });
  });

  it('FREQ=MONTHLY;BYDAY=5MO は unsupported になる（ordinal 範囲外の境界）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYDAY=5MO',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
    expect(result.kind === 'unsupported' && result.rawRRule).toBe('FREQ=MONTHLY;BYDAY=5MO');
  });

  it('FREQ=MONTHLY;BYDAY=MO,WE は unsupported になる（複数 BYDAY トークン）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYDAY=MO,WE',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=MONTHLY;BYMONTHDAY=1,15 は unsupported になる（BYMONTHDAY 複数値）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,15',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1 は unsupported になる（BYDAY と BYMONTHDAY の同時指定）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=DAILY;BYSETPOS=1;BYMONTH=1 は unsupported になる（非対応フィールド）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=DAILY;BYSETPOS=1;BYMONTH=1',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=WEEKLY;WKST=SU は unsupported になる（デフォルト以外の WKST 明示）', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=WEEKLY;WKST=SU',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=WEEKLY;WKST=MO（デフォルトと同じ明示）は editable のまま', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=WEEKLY;WKST=MO',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('editable');
  });

  describe('weekStartsOn と WKST の受理', () => {
    it('weekStartsOn: 0 のとき、一致する WKST=SU の明示は editable として受理される', () => {
      const result = parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(result).toEqual({
        kind: 'editable',
        state: { freq: 'weekly', interval: 2, byWeekday: [2, 0], end: { type: 'never' } },
      });
    });

    it('weekStartsOn: 0 のとき、不一致の WKST=MO の明示は unsupported（unsupportedWkst）になる', () => {
      const result = parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;WKST=MO',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' && result.reason).toEqual({ code: 'unsupportedWkst' });
    });

    it('weekStartsOn: 1 のとき、一致する WKST=MO の明示は editable として受理される', () => {
      const result = parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;WKST=MO',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 1,
      });
      expect(result.kind).toBe('editable');
    });

    it('weekStartsOn: 1 のとき、不一致の WKST=SU の明示は unsupported になる', () => {
      const result = parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;WKST=SU',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 1,
      });
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' && result.reason).toEqual({ code: 'unsupportedWkst' });
    });

    it('WKST を持たないルールは weekStartsOn: 0 でも editable として受理される', () => {
      const result = parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(result.kind).toBe('editable');
    });
  });

  it('FREQ=HOURLY は unsupported になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=HOURLY',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('不正な RRULE（FOO=BAR）は unsupported になり、reason.code が invalidRRuleSyntax・detail にパースエラーの原因を含む', () => {
    const result = parseRecurrenceRule({
      rrule: 'FOO=BAR',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
    const reason = result.kind === 'unsupported' ? result.reason : null;
    expect(reason?.code).toBe('invalidRRuleSyntax');
    expect(reason?.code === 'invalidRRuleSyntax' && reason.detail.length).toBeGreaterThan(0);
    expect(result.kind === 'unsupported' && result.rawRRule).toBe('FOO=BAR');
  });

  it('空文字列の rrule は unsupported になる', () => {
    const result = parseRecurrenceRule({ rrule: '', dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO });
    expect(result.kind).toBe('unsupported');
  });

  it('FREQ=DAILY;COUNT=5 は end:{type:count,count:5} になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=DAILY;COUNT=5',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind === 'editable' && result.state.end).toEqual({ type: 'count', count: 5 });
  });

  it('COUNT と UNTIL を同時に指定した場合は unsupported になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=DAILY;COUNT=5;UNTIL=20260705T090000Z',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('UNTIL はイベント TZ の現地時刻として絶対時刻に変換される', () => {
    // dtstart = 東京 7/1 9:00, UNTIL=20260705T090000Z は東京 7/5 9:00 相当
    const result = parseRecurrenceRule({
      rrule: 'FREQ=DAILY;UNTIL=20260705T090000Z',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('editable');
    const end = result.kind === 'editable' ? result.state.end : null;
    expect(end?.type).toBe('until');
    expect(end?.type === 'until' && end.until.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });

  it('DAILY・YEARLY に BYDAY・BYMONTHDAY があれば unsupported になる', () => {
    expect(
      parseRecurrenceRule({
        rrule: 'FREQ=DAILY;BYDAY=MO',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }).kind,
    ).toBe('unsupported');
    expect(
      parseRecurrenceRule({
        rrule: 'FREQ=YEARLY;BYMONTHDAY=1',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }).kind,
    ).toBe('unsupported');
  });

  it('WEEKLY に BYMONTHDAY があれば unsupported になる', () => {
    expect(
      parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;BYMONTHDAY=1',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }).kind,
    ).toBe('unsupported');
  });

  it('WEEKLY の BYDAY に第 n 週指定があれば unsupported になる', () => {
    expect(
      parseRecurrenceRule({
        rrule: 'FREQ=WEEKLY;BYDAY=2MO',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }).kind,
    ).toBe('unsupported');
  });

  it('MONTHLY の BYDAY に第 n 週指定がなければ unsupported になる', () => {
    expect(
      parseRecurrenceRule({
        rrule: 'FREQ=MONTHLY;BYDAY=MO',
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }).kind,
    ).toBe('unsupported');
  });

  describe('unsupported の reason コード網羅', () => {
    // `unsupportedField.field` の `BYDAY_EXPANDED` / `BYMONTHDAY_EXPANDED`、および
    // `byDayFormatUnrecognized` は、rrule.js 自身の RRULE 文字列パーサ（`RRule.parseString`）
    // と正規化（`normalizeRRuleString` が使う `RRule.optionsToString`）の往復では
    // 到達しない防御的な分岐（rrule.js のパーサは常にこれらの形式を経由せず値を返す）
    // のため、ここでは通常の RRULE 文字列からの到達を確認しない。
    const cases: readonly [string, RecurrenceUnsupportedReason][] = [
      ['FREQ=DAILY;BYSETPOS=1', { code: 'unsupportedField', field: 'BYSETPOS' }],
      ['FREQ=DAILY;BYMONTH=1', { code: 'unsupportedField', field: 'BYMONTH' }],
      ['FREQ=DAILY;BYYEARDAY=1', { code: 'unsupportedField', field: 'BYYEARDAY' }],
      ['FREQ=YEARLY;BYWEEKNO=1', { code: 'unsupportedField', field: 'BYWEEKNO' }],
      ['FREQ=DAILY;BYHOUR=9', { code: 'unsupportedField', field: 'BYHOUR' }],
      ['FREQ=DAILY;BYMINUTE=30', { code: 'unsupportedField', field: 'BYMINUTE' }],
      ['FREQ=DAILY;BYSECOND=30', { code: 'unsupportedField', field: 'BYSECOND' }],
      ['FREQ=YEARLY;BYEASTER=0', { code: 'unsupportedField', field: 'BYEASTER' }],
      ['FREQ=WEEKLY;WKST=SU', { code: 'unsupportedWkst' }],
      ['FREQ=HOURLY', { code: 'unsupportedFrequency' }],
      ['FREQ=DAILY;COUNT=5;UNTIL=20260705T090000Z', { code: 'countAndUntilBothSpecified' }],
      ['FREQ=DAILY;BYDAY=MO', { code: 'dailyByDayOrByMonthDayUnsupported' }],
      ['FREQ=YEARLY;BYMONTHDAY=1', { code: 'yearlyByDayOrByMonthDayUnsupported' }],
      ['FREQ=WEEKLY;BYMONTHDAY=1', { code: 'weeklyByMonthDayUnsupported' }],
      ['FREQ=WEEKLY;BYDAY=2MO', { code: 'weeklyByDayOrdinalUnsupported' }],
      ['FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1', { code: 'monthlyByDayAndByMonthDayConflict' }],
      ['FREQ=MONTHLY;BYMONTHDAY=1,15', { code: 'monthlyByMonthDayMultipleValuesUnsupported' }],
      ['FREQ=MONTHLY;BYDAY=MO,WE', { code: 'monthlyByDayMultipleTokensUnsupported' }],
      ['FREQ=MONTHLY;BYDAY=MO', { code: 'monthlyByDayOrdinalRequired' }],
      ['FREQ=MONTHLY;BYDAY=5MO', { code: 'monthlyByDayOrdinalOutOfRange' }],
    ];

    it.each(cases)('%s → %j', (rrule, expectedReason) => {
      const result = parseRecurrenceRule({ rrule, dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO });
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' && result.reason).toEqual(expectedReason);
    });
  });
});

describe('validateRecurrenceRuleState', () => {
  const validDaily: RecurrenceRuleState = { freq: 'daily', interval: 1, end: { type: 'never' } };

  it('有効な state は空配列を返す', () => {
    expect(validateRecurrenceRuleState(validDaily)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN])('interval が %s のときエラーになる', (interval) => {
    const issues = validateRecurrenceRuleState({ ...validDaily, interval });
    expect(issues.some((issue) => issue.field === 'interval')).toBe(true);
  });

  it('byWeekday が空配列のときエラーになる', () => {
    const issues = validateRecurrenceRuleState({
      freq: 'weekly',
      interval: 1,
      byWeekday: [],
      end: { type: 'never' },
    });
    expect(issues.some((issue) => issue.field === 'byWeekday')).toBe(true);
  });

  it('byWeekday に重複があるときエラーになる', () => {
    const issues = validateRecurrenceRuleState({
      freq: 'weekly',
      interval: 1,
      byWeekday: [3, 1, 3],
      end: { type: 'never' },
    });
    expect(issues.some((issue) => issue.field === 'byWeekday')).toBe(true);
  });

  it('byWeekday を省略してもエラーは増えない', () => {
    const issues = validateRecurrenceRuleState({
      freq: 'weekly',
      interval: 1,
      end: { type: 'never' },
    });
    expect(issues).toEqual([]);
  });

  it.each([0, 32])('monthlyPattern.dayOfMonth.day が %s のときエラーになる', (day) => {
    const pattern: MonthlyRecurrencePattern = { kind: 'dayOfMonth', day };
    const issues = validateRecurrenceRuleState({
      freq: 'monthly',
      interval: 1,
      monthlyPattern: pattern,
      end: { type: 'never' },
    });
    expect(issues.some((issue) => issue.field === 'monthlyPattern')).toBe(true);
  });

  it('monthlyPattern.dayOfMonth.day が -1（月末）のときエラーにならない', () => {
    const pattern: MonthlyRecurrencePattern = { kind: 'dayOfMonth', day: -1 };
    const issues = validateRecurrenceRuleState({
      freq: 'monthly',
      interval: 1,
      monthlyPattern: pattern,
      end: { type: 'never' },
    });
    expect(issues).toEqual([]);
  });

  it('monthlyPattern.nthWeekday.ordinal が 5 のときエラーになる', () => {
    // 型上は ordinal は 1|2|3|4|-1 に制限されるが、非 TypeScript 経由の実行時データ
    // に対する検証を確認するため、意図的に型を無視して範囲外の値を構築する
    const pattern = {
      kind: 'nthWeekday',
      ordinal: 5,
      weekday: 1,
    } as unknown as MonthlyRecurrencePattern;
    const issues = validateRecurrenceRuleState({
      freq: 'monthly',
      interval: 1,
      monthlyPattern: pattern,
      end: { type: 'never' },
    });
    expect(issues.some((issue) => issue.field === 'monthlyPattern')).toBe(true);
  });

  it('monthlyPattern を省略してもエラーは増えない', () => {
    const issues = validateRecurrenceRuleState({
      freq: 'monthly',
      interval: 1,
      end: { type: 'never' },
    });
    expect(issues).toEqual([]);
  });

  it('end.type=count で count が 0 のときエラーになる', () => {
    const issues = validateRecurrenceRuleState({
      ...validDaily,
      end: { type: 'count', count: 0 },
    });
    expect(issues.some((issue) => issue.field === 'count')).toBe(true);
  });

  it('end.type=until で無効な Date のときエラーになる', () => {
    const issues = validateRecurrenceRuleState({
      ...validDaily,
      end: { type: 'until', until: new Date(Number.NaN) },
    });
    expect(issues.some((issue) => issue.field === 'until')).toBe(true);
  });

  // ordinal:5 / weekday:7 は型上 MonthlyRecurrencePattern の値域外だが、非 TypeScript
  // 経由の実行時データに対する検証（code 網羅）を確認するため、上のテストと同じく
  // 意図的に型を無視して範囲外の値を構築する
  const outOfRangeOrdinalPattern = {
    kind: 'nthWeekday',
    ordinal: 5,
    weekday: 1,
  } as unknown as MonthlyRecurrencePattern;
  const outOfRangeWeekdayPattern = {
    kind: 'nthWeekday',
    ordinal: 1,
    weekday: 7,
  } as unknown as MonthlyRecurrencePattern;
  // 8 は型上 Weekday（0〜6）の値域外だが、非 TypeScript 経由の実行時データに対する
  // 検証（code 網羅）を確認するため、上と同じく意図的に型を無視して範囲外の値を構築する
  const outOfRangeByWeekday = [3, 8] as unknown as readonly Weekday[];

  const codeCases: ReadonlyArray<[RecurrenceRuleState, RecurrenceValidationIssue]> = [
    [
      { ...validDaily, interval: 0 },
      { field: 'interval', code: 'invalid' },
    ],
    [
      { freq: 'weekly', interval: 1, byWeekday: [], end: { type: 'never' } },
      { field: 'byWeekday', code: 'empty' },
    ],
    [
      { freq: 'weekly', interval: 1, byWeekday: [3, 1, 3], end: { type: 'never' } },
      { field: 'byWeekday', code: 'duplicate' },
    ],
    [
      { freq: 'weekly', interval: 1, byWeekday: outOfRangeByWeekday, end: { type: 'never' } },
      { field: 'byWeekday', code: 'outOfRange' },
    ],
    [
      {
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: 32 },
        end: { type: 'never' },
      },
      { field: 'monthlyPattern', code: 'dayOfMonthInvalid' },
    ],
    [
      {
        freq: 'monthly',
        interval: 1,
        monthlyPattern: outOfRangeOrdinalPattern,
        end: { type: 'never' },
      },
      { field: 'monthlyPattern', code: 'ordinalInvalid' },
    ],
    [
      {
        freq: 'monthly',
        interval: 1,
        monthlyPattern: outOfRangeWeekdayPattern,
        end: { type: 'never' },
      },
      { field: 'monthlyPattern', code: 'weekdayInvalid' },
    ],
    [
      { ...validDaily, end: { type: 'count', count: 0 } },
      { field: 'count', code: 'invalid' },
    ],
    [
      { ...validDaily, end: { type: 'until', until: new Date(Number.NaN) } },
      { field: 'until', code: 'invalid' },
    ],
  ];

  it.each(codeCases)('%#: 検証すると期待する code を含む', (state, expectedIssue) => {
    const issues = validateRecurrenceRuleState(state);
    expect(issues).toContainEqual(expectedIssue);
  });
});

describe('buildRecurrenceRuleString', () => {
  const roundTripCases: readonly RecurrenceRuleState[] = [
    { freq: 'daily', interval: 1, end: { type: 'never' } },
    { freq: 'daily', interval: 3, end: { type: 'count', count: 5 } },
    { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } },
    { freq: 'weekly', interval: 2, byWeekday: [0], end: { type: 'never' } },
    {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'dayOfMonth', day: 15 },
      end: { type: 'never' },
    },
    {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'dayOfMonth', day: -1 },
      end: { type: 'never' },
    },
    {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 1 },
      end: { type: 'never' },
    },
    {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
      end: { type: 'never' },
    },
    { freq: 'yearly', interval: 1, end: { type: 'never' } },
    { freq: 'yearly', interval: 2, end: { type: 'never' } },
    {
      freq: 'daily',
      interval: 1,
      end: { type: 'until', until: new Date('2026-07-05T00:00:00Z') },
    },
  ];

  it.each(roundTripCases)('parse→build→parse で同じ state に戻る: %j', (state) => {
    const rrule = buildRecurrenceRuleString({
      state,
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    const reparsed = parseRecurrenceRule({ rrule, dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO });
    expect(reparsed).toEqual({ kind: 'editable', state });
  });

  it('interval:1 のときは INTERVAL を明示的に出力しない', () => {
    const rrule = buildRecurrenceRuleString({
      state: { freq: 'daily', interval: 1, end: { type: 'never' } },
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(rrule).not.toContain('INTERVAL');
  });

  it('検証エラーのある state（interval:0）を渡すと Error を投げる', () => {
    expect(() =>
      buildRecurrenceRuleString({
        state: { freq: 'daily', interval: 0, end: { type: 'never' } },
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }),
    ).toThrow(Error);
  });

  it('end.until が dtstart より前でも例外にならない', () => {
    expect(() =>
      buildRecurrenceRuleString({
        state: {
          freq: 'daily',
          interval: 1,
          end: { type: 'until', until: new Date('2026-06-01T00:00:00Z') },
        },
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      }),
    ).not.toThrow();
  });

  describe('weekStartsOn による WKST の出力', () => {
    const biweeklySundayTuesday: RecurrenceRuleState = {
      freq: 'weekly',
      interval: 2,
      byWeekday: [0, 2],
      end: { type: 'never' },
    };

    it('weekStartsOn: 0（日曜始まり）のとき WKST=SU を出力する', () => {
      const rrule = buildRecurrenceRuleString({
        state: biweeklySundayTuesday,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(rrule).toContain('WKST=SU');
    });

    it('weekStartsOn: 6（土曜始まり）のとき WKST=SA を出力する', () => {
      const rrule = buildRecurrenceRuleString({
        state: biweeklySundayTuesday,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 6,
      });
      expect(rrule).toContain('WKST=SA');
    });

    it('weekStartsOn: 1（月曜始まり）のとき WKST を出力しない（RRULE の既定と同じため）', () => {
      const rrule = buildRecurrenceRuleString({
        state: biweeklySundayTuesday,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 1,
      });
      expect(rrule).not.toContain('WKST');
    });

    it('weekStartsOn 省略時は WKST を出力しない', () => {
      const rrule = buildRecurrenceRuleString({
        state: biweeklySundayTuesday,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
      });
      expect(rrule).not.toContain('WKST');
    });

    it('freq が weekly 以外（daily）でも weekStartsOn が月曜以外なら WKST を出力する', () => {
      const rrule = buildRecurrenceRuleString({
        state: { freq: 'daily', interval: 1, end: { type: 'never' } },
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(rrule).toContain('WKST=SU');
    });

    it('weekStartsOn: 0 で生成した RRULE は同じ weekStartsOn の parse で同じ state に戻る（往復）', () => {
      const rrule = buildRecurrenceRuleString({
        state: biweeklySundayTuesday,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      const reparsed = parseRecurrenceRule({
        rrule,
        dtstart: TOKYO_JULY_1_9AM,
        timeZone: TOKYO,
        weekStartsOn: 0,
      });
      expect(reparsed).toEqual({ kind: 'editable', state: biweeklySundayTuesday });
    });
  });

  it('monthlyPattern と byWeekday を両方持つ state は freq に応じて無関係な方を無視する', () => {
    const state: RecurrenceRuleState = {
      freq: 'monthly',
      interval: 1,
      byWeekday: [1, 3],
      monthlyPattern: { kind: 'dayOfMonth', day: 10 },
      end: { type: 'never' },
    };
    const rrule = buildRecurrenceRuleString({ state, dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO });
    expect(rrule).toContain('BYMONTHDAY=10');
    expect(rrule).not.toContain('BYDAY');
  });
});

describe('エディタ状態 → buildRecurrenceRuleString → expandRecurrence（フルパイプライン）', () => {
  it('monthlyPattern:{kind:nthWeekday,ordinal:2,weekday:2}（第 2 火曜）は実際に各月の第 2 火曜のオカレンスへ展開される', () => {
    const state: RecurrenceRuleState = {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 2 },
      end: { type: 'never' },
    };
    const dtstart = TOKYO_JULY_1_9AM; // 2026-07-01（水）。BYDAY と不一致のため評価起点にのみ使われる
    const rrule = buildRecurrenceRuleString({ state, dtstart, timeZone: TOKYO });
    // 正の ordinal は rrule.js の正規化で '+' が前置される
    expect(rrule).toBe('FREQ=MONTHLY;BYDAY=+2TU');

    const occurrences = expandRecurrence({
      rrule,
      dtstart,
      timeZone: TOKYO,
      range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') }, // 東京 2027-01-01 9:00 まで（排他）
    });
    // 2026 年の各月（7〜12月）の第 2 火曜日: 7/14, 8/11, 9/8, 10/13, 11/10, 12/8
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-07-14T00:00:00.000Z',
      '2026-08-11T00:00:00.000Z',
      '2026-09-08T00:00:00.000Z',
      '2026-10-13T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
      '2026-12-08T00:00:00.000Z',
    ]);
  });

  it('monthlyPattern:{kind:nthWeekday,ordinal:-1,weekday:5}（最終金曜）+ end:{type:count,count:3} は実際に 3 回で打ち切られる', () => {
    const state: RecurrenceRuleState = {
      freq: 'monthly',
      interval: 1,
      monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
      end: { type: 'count', count: 3 },
    };
    const dtstart = TOKYO_JULY_1_9AM; // 2026-07-01（水）
    const rrule = buildRecurrenceRuleString({ state, dtstart, timeZone: TOKYO });
    expect(rrule).toBe('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3');

    // 範囲を半年分に広げても COUNT=3 で打ち切られることを確認する
    const occurrences = expandRecurrence({
      rrule,
      dtstart,
      timeZone: TOKYO,
      range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') },
    });
    // 各月の最終金曜日: 7/31, 8/28, 9/25（2026 年）。COUNT=3 のため 10 月以降は含まれない
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-07-31T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
    ]);
  });
});
