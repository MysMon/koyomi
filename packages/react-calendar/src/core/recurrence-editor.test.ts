/**
 * recurrence-editor.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceRuleString,
  describeRecurrenceRule,
  type MonthlyRecurrencePattern,
  parseRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceRuleState,
  validateRecurrenceRuleState,
} from './recurrence-editor';

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

  it('FREQ=HOURLY は unsupported になる', () => {
    const result = parseRecurrenceRule({
      rrule: 'FREQ=HOURLY',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
  });

  it('不正な RRULE（FOO=BAR）は unsupported になり、reason にパースエラーの原因を含む', () => {
    const result = parseRecurrenceRule({
      rrule: 'FOO=BAR',
      dtstart: TOKYO_JULY_1_9AM,
      timeZone: TOKYO,
    });
    expect(result.kind).toBe('unsupported');
    expect(result.kind === 'unsupported' && result.reason.length).toBeGreaterThan(0);
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

describe('describeRecurrenceRule', () => {
  it('DAILY: interval=1 は「毎日」、interval=2 以上は「N日ごと」になる', () => {
    expect(describeRecurrenceRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe(
      '毎日',
    );
    expect(describeRecurrenceRule({ freq: 'daily', interval: 2, end: { type: 'never' } })).toBe(
      '2日ごと',
    );
  });

  it('WEEKLY: byWeekday を指定した場合は曜日を含む文言になる', () => {
    expect(
      describeRecurrenceRule({
        freq: 'weekly',
        interval: 1,
        byWeekday: [1, 3],
        end: { type: 'never' },
      }),
    ).toBe('毎週月・水');
  });

  it('WEEKLY: byWeekday 省略・context あり → context の dtstart の曜日で補う', () => {
    // TOKYO_JULY_1_9AM（2026-07-01, 東京）は水曜日
    expect(
      describeRecurrenceRule(
        { freq: 'weekly', interval: 1, end: { type: 'never' } },
        { dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO },
      ),
    ).toBe('毎週水');
  });

  it('WEEKLY: byWeekday 省略・context なし → 曜日を欠いた文言になる', () => {
    expect(describeRecurrenceRule({ freq: 'weekly', interval: 1, end: { type: 'never' } })).toBe(
      '毎週',
    );
  });

  it('MONTHLY: dayOfMonth は「毎月N日」、day=-1 は「毎月末日」になる', () => {
    expect(
      describeRecurrenceRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: 15 },
        end: { type: 'never' },
      }),
    ).toBe('毎月15日');
    expect(
      describeRecurrenceRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'dayOfMonth', day: -1 },
        end: { type: 'never' },
      }),
    ).toBe('毎月末日');
  });

  it('MONTHLY: nthWeekday は「毎月 第N曜日」「毎月 最終曜日」になる', () => {
    expect(
      describeRecurrenceRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 1 },
        end: { type: 'never' },
      }),
    ).toBe('毎月 第2月曜日');
    expect(
      describeRecurrenceRule({
        freq: 'monthly',
        interval: 1,
        monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
        end: { type: 'never' },
      }),
    ).toBe('毎月 最終金曜日');
  });

  it('YEARLY: context から月日を補い「毎年M月D日」になる', () => {
    expect(
      describeRecurrenceRule(
        { freq: 'yearly', interval: 1, end: { type: 'never' } },
        { dtstart: TOKYO_JULY_1_9AM, timeZone: TOKYO },
      ),
    ).toBe('毎年7月1日');
  });

  it('YEARLY: context なしは「毎年」になる', () => {
    expect(describeRecurrenceRule({ freq: 'yearly', interval: 1, end: { type: 'never' } })).toBe(
      '毎年',
    );
  });

  it('interval<=0 は表示上 1 として扱う', () => {
    expect(describeRecurrenceRule({ freq: 'daily', interval: 0, end: { type: 'never' } })).toBe(
      '毎日',
    );
  });

  it('end.type=count は末尾に「（N回）」を付加する（count=1 も単数表現で問題ない）', () => {
    const end: RecurrenceEnd = { type: 'count', count: 1 };
    expect(describeRecurrenceRule({ freq: 'daily', interval: 1, end })).toBe('毎日（1回）');
    expect(
      describeRecurrenceRule({ freq: 'daily', interval: 1, end: { type: 'count', count: 5 } }),
    ).toBe('毎日（5回）');
  });

  it('end.type=until は timeZone 指定時は現地日付、省略時は UTC 成分で整形する', () => {
    const until = new Date('2026-07-05T00:00:00Z');
    expect(
      describeRecurrenceRule(
        { freq: 'daily', interval: 1, end: { type: 'until', until } },
        { timeZone: TOKYO },
      ),
    ).toBe('毎日（2026年7月5日まで）');
    expect(
      describeRecurrenceRule({ freq: 'daily', interval: 1, end: { type: 'until', until } }),
    ).toBe('毎日（2026年7月5日まで）');
  });

  it('end.type=until は timeZone 指定の有無で日付が異なりうる（UTC 20:00 → 東京では翌日）', () => {
    const until = new Date('2026-07-05T20:00:00Z'); // 東京では 7/6 5:00
    expect(
      describeRecurrenceRule(
        { freq: 'daily', interval: 1, end: { type: 'until', until } },
        { timeZone: TOKYO },
      ),
    ).toBe('毎日（2026年7月6日まで）');
    expect(
      describeRecurrenceRule({ freq: 'daily', interval: 1, end: { type: 'until', until } }),
    ).toBe('毎日（2026年7月5日まで）');
  });

  it('end.type=never は末尾に何も付加しない', () => {
    expect(describeRecurrenceRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe(
      '毎日',
    );
  });
});
