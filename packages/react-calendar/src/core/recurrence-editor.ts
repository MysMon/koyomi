/**
 * @packageDocumentation
 * 繰り返しルール（RRULE）の構造化編集。
 *
 * `core/recurrence.ts` の RRULE 展開エンジンとは異なり、こちらは RRULE 文字列と
 * 構造化された {@link RecurrenceRuleState} を相互変換し、フォーム入力向けの検証・
 * 説明文生成を提供する。対応範囲は `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・
 * `BYDAY`（週の曜日集合、または月の第 n 曜日）・`BYMONTHDAY`（単一値）・
 * `COUNT`/`UNTIL` のみで、範囲外の指定は {@link parseRecurrenceRule} が
 * `unsupported` として元の RRULE 文字列を保持する（内容を書き換えない）。
 */

import type { Options } from 'rrule';
import { RRule } from 'rrule';
import { fromFakeUTC, normalizeRRuleString, parseRRuleOptions, toFakeUTC } from './recurrence';
import { getWallClock, weekdayInZone } from './timezone';
import type { TimeZoneId, Weekday } from './types';

/** 繰り返しの頻度。編集エディタが対応する 4 種のみ。 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** 「第 n 曜日」の n。1〜4 は第 1〜4、-1 は最終週。 */
export type RecurrenceWeekdayOrdinal = 1 | 2 | 3 | 4 | -1;

/** MONTHLY のパターン。月内の日付指定か第 n 曜日指定のいずれか一方を表す。 */
export type MonthlyRecurrencePattern =
  | { kind: 'dayOfMonth'; day: number }
  | { kind: 'nthWeekday'; ordinal: RecurrenceWeekdayOrdinal; weekday: Weekday };

/**
 * 繰り返しの終了条件。
 *
 * `until` はイベントのタイムゾーンにおける現地時刻として解釈される絶対時刻。
 *
 * @remarks
 * `until` に、DST の終了（秋の巻き戻し）で現地時刻が 2 回出現する時間帯の時刻を
 * 指定した場合、{@link buildRecurrenceRuleString} が生成する RRULE の `UNTIL` は
 * 現地時刻の成分のみを保持し「どちらの回か」を落とすため、{@link parseRecurrenceRule}
 * で往復させると早い方のオフセット側の絶対時刻に正規化される（1 時間ずれうる）。
 * `until` を時刻ではなく日付境界で選ぶ一般的な運用では問題にならない。
 */
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'count'; count: number }
  | { type: 'until'; until: Date };

/**
 * 繰り返しルールの構造化状態。{@link CalendarEvent.rrule} 相当を表す。
 *
 * `byWeekday` は `freq: 'weekly'` のときのみ意味を持ち、`monthlyPattern` は
 * `freq: 'monthly'` のときのみ意味を持つ（{@link buildRecurrenceRuleString} は
 * 現在の `freq` に応じて無関係な方を無視する）。
 */
export interface RecurrenceRuleState {
  /** 繰り返しの頻度。 */
  freq: RecurrenceFrequency;
  /** 繰り返し間隔。1 以上の整数。既定は 1。 */
  interval: number;
  /** `freq: 'weekly'` のときの曜日集合。 */
  byWeekday?: readonly Weekday[];
  /** `freq: 'monthly'` のときの月内パターン。 */
  monthlyPattern?: MonthlyRecurrencePattern;
  /** 終了条件。 */
  end: RecurrenceEnd;
}

/** {@link validateRecurrenceRuleState} が返す検証エラー 1 件。 */
export interface RecurrenceValidationIssue {
  /** エラーの対象フィールド。 */
  field: 'interval' | 'byWeekday' | 'monthlyPattern' | 'count' | 'until';
  /** 日本語の既定エラーメッセージ。 */
  message: string;
}

/** {@link parseRecurrenceRule} の結果。 */
export type ParsedRecurrenceRule =
  | { kind: 'none' }
  | { kind: 'editable'; state: RecurrenceRuleState }
  | { kind: 'unsupported'; rawRRule: string; reason: string };

/** 例外からメッセージ文字列を取り出す。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** rrule.js の `Frequency` 定数を {@link RecurrenceFrequency} に変換する。対応範囲外は `null`。 */
function koyomiFrequencyFromRRule(freq: Options['freq'] | undefined): RecurrenceFrequency | null {
  switch (freq) {
    case RRule.YEARLY:
      return 'yearly';
    case RRule.MONTHLY:
      return 'monthly';
    case RRule.WEEKLY:
      return 'weekly';
    case RRule.DAILY:
      return 'daily';
    default:
      return null;
  }
}

/**
 * `parsed` に、編集エディタが対応しない RRULE の指定が含まれていないかを検証する。
 * 対応しない指定が見つかった場合はその理由（日本語）を返し、なければ `null`。
 *
 * `wkst` は月曜以外を明示指定した場合のみ対応外とする（既定と同じ月曜の明示は許容する）。
 * 判定には正規化済みテキスト（`normalizedText`）から `WKST=` を読み取る
 * （rrule.js 内部の曜日エンコーディングに依存しないための方針）。
 */
function unsupportedGenericFieldReason(
  parsed: Partial<Options>,
  normalizedText: string,
): string | null {
  if (parsed.bysetpos !== undefined && parsed.bysetpos !== null) {
    return '対応していない RRULE の指定です（BYSETPOS）';
  }
  if (parsed.bymonth !== undefined && parsed.bymonth !== null) {
    return '対応していない RRULE の指定です（BYMONTH）';
  }
  if (parsed.byyearday !== undefined && parsed.byyearday !== null) {
    return '対応していない RRULE の指定です（BYYEARDAY）';
  }
  if (parsed.byweekno !== undefined && parsed.byweekno !== null) {
    return '対応していない RRULE の指定です（BYWEEKNO）';
  }
  if (parsed.byhour !== undefined && parsed.byhour !== null) {
    return '対応していない RRULE の指定です（BYHOUR）';
  }
  if (parsed.byminute !== undefined && parsed.byminute !== null) {
    return '対応していない RRULE の指定です（BYMINUTE）';
  }
  if (parsed.bysecond !== undefined && parsed.bysecond !== null) {
    return '対応していない RRULE の指定です（BYSECOND）';
  }
  if (parsed.byeaster !== undefined && parsed.byeaster !== null) {
    return '対応していない RRULE の指定です（BYEASTER）';
  }
  if (parsed.bynweekday !== undefined && parsed.bynweekday !== null) {
    return '対応していない RRULE の指定です（BYDAY の内部展開形式）';
  }
  if (parsed.bynmonthday !== undefined && parsed.bynmonthday !== null) {
    return '対応していない RRULE の指定です（BYMONTHDAY の内部展開形式）';
  }
  const wkstMatch = /(?:^|;)WKST=([A-Z]{2})/.exec(normalizedText);
  const wkstCode = wkstMatch?.[1];
  if (wkstCode !== undefined && wkstCode !== 'MO') {
    return '対応していない RRULE の指定です（月曜以外を指定する WKST）';
  }
  return null;
}

/** BYDAY トークン 1 つ分（曜日と、月の第 n 週指定のための符号付き序数）。 */
interface ByDayToken {
  readonly ordinal: number | undefined;
  readonly weekday: Weekday;
}

/** BYDAY コード（`SU`〜`SA`。先頭に符号付き序数を許容）にマッチする正規表現。 */
const BYDAY_TOKEN_PATTERN = /^([+-]\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;

/** BYDAY の 2 文字コードから Koyomi の {@link Weekday}（日 = 0）への変換表。 */
const WEEKDAY_CODE_TO_WEEKDAY = new Map<string, Weekday>([
  ['SU', 0],
  ['MO', 1],
  ['TU', 2],
  ['WE', 3],
  ['TH', 4],
  ['FR', 5],
  ['SA', 6],
]);

/**
 * 正規化済みの RRULE テキストから BYDAY のトークン一覧を読み取る。
 *
 * `RRule.optionsToString` が生成する正規化テキストを直接トークナイズすることで、
 * rrule.js 内部の曜日エンコーディング（ISO 月曜 = 0 基準）に依存せず
 * Koyomi の `Weekday`（日 = 0 基準）へ変換する。BYDAY が存在しない場合は空配列、
 * 想定外の形式が含まれる場合（通常は発生しない）は `null` を返す。
 */
function decodeByDayTokens(normalizedText: string): readonly ByDayToken[] | null {
  const match = /(?:^|;)BYDAY=([^;]+)/.exec(normalizedText);
  const rawTokens = match?.[1];
  if (rawTokens === undefined) {
    return [];
  }
  const tokens: ByDayToken[] = [];
  for (const rawToken of rawTokens.split(',')) {
    const tokenMatch = BYDAY_TOKEN_PATTERN.exec(rawToken);
    if (tokenMatch === null) {
      return null;
    }
    const [, ordinalText, code] = tokenMatch;
    if (code === undefined) {
      return null;
    }
    const weekday = WEEKDAY_CODE_TO_WEEKDAY.get(code);
    if (weekday === undefined) {
      return null;
    }
    tokens.push({ ordinal: ordinalText === undefined ? undefined : Number(ordinalText), weekday });
  }
  return tokens;
}

/** {@link RecurrenceWeekdayOrdinal} の値域か判定する型ガード。 */
function isSupportedOrdinal(value: number): value is RecurrenceWeekdayOrdinal {
  return value === -1 || value === 1 || value === 2 || value === 3 || value === 4;
}

/** {@link resolvePatternForFrequency} の結果。 */
type PatternResolution =
  | { ok: true; extra: Partial<Pick<RecurrenceRuleState, 'byWeekday' | 'monthlyPattern'>> }
  | { ok: false; reason: string };

/**
 * 頻度ごとに BYDAY・BYMONTHDAY の組み合わせを検証し、`RecurrenceRuleState` の
 * `byWeekday` / `monthlyPattern` に対応する追加フィールドを組み立てる。
 * 対応範囲外の組み合わせは `ok: false` で理由を返す。
 */
function resolvePatternForFrequency(
  freq: RecurrenceFrequency,
  parsed: Partial<Options>,
  byDayTokens: readonly ByDayToken[],
): PatternResolution {
  const byMonthDay = parsed.bymonthday;
  const hasByDay = byDayTokens.length > 0;

  if (freq === 'daily') {
    if (hasByDay || (byMonthDay !== undefined && byMonthDay !== null)) {
      return { ok: false, reason: 'DAILY では BYDAY・BYMONTHDAY を編集エディタでは扱えません' };
    }
    return { ok: true, extra: {} };
  }

  if (freq === 'yearly') {
    if (hasByDay || (byMonthDay !== undefined && byMonthDay !== null)) {
      return { ok: false, reason: 'YEARLY では BYDAY・BYMONTHDAY を編集エディタでは扱えません' };
    }
    return { ok: true, extra: {} };
  }

  if (freq === 'weekly') {
    if (byMonthDay !== undefined && byMonthDay !== null) {
      return { ok: false, reason: 'WEEKLY で BYMONTHDAY を編集エディタでは扱えません' };
    }
    if (!hasByDay) {
      return { ok: true, extra: {} };
    }
    if (byDayTokens.some((token) => token.ordinal !== undefined)) {
      return { ok: false, reason: 'WEEKLY の BYDAY に第 n 週指定は使用できません' };
    }
    return { ok: true, extra: { byWeekday: byDayTokens.map((token) => token.weekday) } };
  }

  // freq === 'monthly'
  if (hasByDay && byMonthDay !== undefined && byMonthDay !== null) {
    return { ok: false, reason: 'MONTHLY で BYDAY と BYMONTHDAY を同時に指定することはできません' };
  }
  if (byMonthDay !== undefined && byMonthDay !== null) {
    if (Array.isArray(byMonthDay)) {
      return { ok: false, reason: 'MONTHLY の BYMONTHDAY は単一の値のみ編集エディタで扱えます' };
    }
    return { ok: true, extra: { monthlyPattern: { kind: 'dayOfMonth', day: byMonthDay } } };
  }
  if (hasByDay) {
    if (byDayTokens.length > 1) {
      return { ok: false, reason: 'MONTHLY の BYDAY は単一の曜日指定のみ編集エディタで扱えます' };
    }
    const [token] = byDayTokens;
    if (token === undefined) {
      return { ok: false, reason: 'MONTHLY の BYDAY には第 n 週指定が必要です' };
    }
    const { ordinal, weekday } = token;
    if (ordinal === undefined) {
      return { ok: false, reason: 'MONTHLY の BYDAY には第 n 週指定が必要です' };
    }
    if (!isSupportedOrdinal(ordinal)) {
      return {
        ok: false,
        reason:
          'MONTHLY の BYDAY の第 n 週指定は 1〜4 または -1（最終週）のみ編集エディタで扱えます',
      };
    }
    return { ok: true, extra: { monthlyPattern: { kind: 'nthWeekday', ordinal, weekday } } };
  }
  return { ok: true, extra: {} };
}

/**
 * RRULE 文字列を構造化状態に変換する。
 *
 * 対応範囲（`FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・`BYDAY`・
 * `BYMONTHDAY`・`COUNT`/`UNTIL` のみ）外の指定、または不正な RRULE は
 * `kind: 'unsupported'` として元の文字列をそのまま保持する（書き換えない）。
 *
 * @param params.rrule - RRULE 文字列。`undefined` は「繰り返しなし」を表す
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン（`UNTIL` の解釈に使用）
 * @returns 変換結果
 * @example
 * ```ts
 * parseRecurrenceRule({
 *   rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
 *   dtstart: new Date('2026-07-01T00:00:00Z'),
 *   timeZone: 'Asia/Tokyo',
 * });
 * // => { kind: 'editable', state: { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } } }
 * ```
 */
export function parseRecurrenceRule(params: {
  rrule: string | undefined;
  dtstart: Date;
  timeZone: TimeZoneId;
}): ParsedRecurrenceRule {
  const { rrule, dtstart, timeZone } = params;
  if (rrule === undefined) {
    return { kind: 'none' };
  }

  let parsed: Partial<Options>;
  try {
    parsed = parseRRuleOptions(rrule);
    // parseRRuleOptions 自体は dtstart なしで検証するため、実際の dtstart を
    // 付与して初めて構築に失敗するケースをここで拾う
    void new RRule({ ...parsed, dtstart: toFakeUTC(dtstart, timeZone) });
  } catch (cause) {
    return { kind: 'unsupported', rawRRule: rrule, reason: errorMessage(cause) };
  }

  const freq = koyomiFrequencyFromRRule(parsed.freq);
  if (freq === null) {
    return {
      kind: 'unsupported',
      rawRRule: rrule,
      reason: 'DAILY・WEEKLY・MONTHLY・YEARLY 以外の頻度は編集エディタでは扱えません',
    };
  }

  const normalizedText = normalizeRRuleString(rrule);

  const genericFieldReason = unsupportedGenericFieldReason(parsed, normalizedText);
  if (genericFieldReason !== null) {
    return { kind: 'unsupported', rawRRule: rrule, reason: genericFieldReason };
  }

  if (typeof parsed.count === 'number' && parsed.until instanceof Date) {
    return {
      kind: 'unsupported',
      rawRRule: rrule,
      reason: 'COUNT と UNTIL を同時に指定することはできません',
    };
  }

  const byDayTokens = decodeByDayTokens(normalizedText);
  if (byDayTokens === null) {
    return { kind: 'unsupported', rawRRule: rrule, reason: 'BYDAY の形式を解釈できません' };
  }

  const patternResolution = resolvePatternForFrequency(freq, parsed, byDayTokens);
  if (!patternResolution.ok) {
    return { kind: 'unsupported', rawRRule: rrule, reason: patternResolution.reason };
  }

  const interval = typeof parsed.interval === 'number' ? parsed.interval : 1;
  const end: RecurrenceEnd =
    typeof parsed.count === 'number'
      ? { type: 'count', count: parsed.count }
      : parsed.until instanceof Date
        ? { type: 'until', until: fromFakeUTC(parsed.until, timeZone) }
        : { type: 'never' };

  return {
    kind: 'editable',
    state: { freq, interval, end, ...patternResolution.extra },
  };
}

/**
 * `state` のフィールド単位の検証エラーを返す。
 *
 * 副作用・例外のない純関数。フィールドが省略されている場合はそのフィールドの
 * 検証を行わない（省略は「DTSTART に暗黙依存する」という有効な状態のため）。
 *
 * @param state - 検証対象の状態
 * @returns 検証エラーの配列（空配列なら有効）
 */
export function validateRecurrenceRuleState(
  state: RecurrenceRuleState,
): readonly RecurrenceValidationIssue[] {
  const issues: RecurrenceValidationIssue[] = [];

  if (!Number.isInteger(state.interval) || state.interval < 1) {
    issues.push({
      field: 'interval',
      message: '繰り返し間隔（interval）は 1 以上の整数で指定してください',
    });
  }

  const byWeekday = state.byWeekday;
  if (byWeekday !== undefined) {
    if (byWeekday.length === 0) {
      issues.push({ field: 'byWeekday', message: '曜日を 1 つ以上指定してください' });
    } else if (new Set(byWeekday).size !== byWeekday.length) {
      issues.push({ field: 'byWeekday', message: '同じ曜日を重複して指定することはできません' });
    } else if (
      byWeekday.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    ) {
      issues.push({
        field: 'byWeekday',
        message: '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください',
      });
    }
  }

  const monthlyPattern = state.monthlyPattern;
  if (monthlyPattern !== undefined) {
    if (monthlyPattern.kind === 'dayOfMonth') {
      const { day } = monthlyPattern;
      if (!Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31))) {
        issues.push({
          field: 'monthlyPattern',
          message: '月内日付は 1〜31 または -1（月末）で指定してください',
        });
      }
    } else {
      const { ordinal, weekday } = monthlyPattern;
      if (ordinal !== -1 && ordinal !== 1 && ordinal !== 2 && ordinal !== 3 && ordinal !== 4) {
        issues.push({
          field: 'monthlyPattern',
          message: '第 n 週の指定は 1〜4 または -1（最終週）で指定してください',
        });
      }
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        issues.push({
          field: 'monthlyPattern',
          message: '曜日は 0（日曜日）〜6（土曜日）の範囲で指定してください',
        });
      }
    }
  }

  if (state.end.type === 'count') {
    if (!Number.isInteger(state.end.count) || state.end.count < 1) {
      issues.push({ field: 'count', message: '回数（count）は 1 以上の整数で指定してください' });
    }
  } else if (state.end.type === 'until') {
    const { until } = state.end;
    if (!(until instanceof Date) || Number.isNaN(until.getTime())) {
      issues.push({ field: 'until', message: '終了日（until）に有効な日時を指定してください' });
    }
  }

  return issues;
}

/** {@link Weekday} を BYDAY の 2 文字コードに変換する。 */
function byDayCodeForWeekday(weekday: Weekday): string {
  switch (weekday) {
    case 0:
      return 'SU';
    case 1:
      return 'MO';
    case 2:
      return 'TU';
    case 3:
      return 'WE';
    case 4:
      return 'TH';
    case 5:
      return 'FR';
    case 6:
      return 'SA';
  }
}

/**
 * fake-UTC 時刻を、直前の整数秒（ミリ秒 0）へ切り下げる。
 *
 * RRULE の UNTIL は秒精度までしか表現できない。エディタの新規 UNTIL 入力では
 * `recurrence.ts` の `truncateRRule`（切り上げ）と異なり、単純な切り捨てで十分
 * （「オカレンスをちょうど含める」ための特別な補正は編集スコープ分割特有の要求のため）。
 */
function floorFakeUTCToWholeSecond(fake: Date): Date {
  const remainderMs = fake.getTime() % 1000;
  return remainderMs === 0 ? fake : new Date(fake.getTime() - remainderMs);
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** fake-UTC 時刻を RRULE の UNTIL 形式（`YYYYMMDDTHHMMSSZ`）に整形する。 */
function formatFakeUTCAsUntil(fake: Date): string {
  const year = fake.getUTCFullYear();
  const month = pad2(fake.getUTCMonth() + 1);
  const day = pad2(fake.getUTCDate());
  const hours = pad2(fake.getUTCHours());
  const minutes = pad2(fake.getUTCMinutes());
  const seconds = pad2(fake.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/** `state` から RRULE 本体のテキストを手組みする（検証済みであることを前提とする）。 */
function buildRawRRuleText(state: RecurrenceRuleState, timeZone: TimeZoneId): string {
  const parts: string[] = [`FREQ=${state.freq.toUpperCase()}`];
  if (state.interval !== 1) {
    parts.push(`INTERVAL=${state.interval}`);
  }
  if (state.freq === 'weekly' && state.byWeekday !== undefined && state.byWeekday.length > 0) {
    parts.push(`BYDAY=${state.byWeekday.map((weekday) => byDayCodeForWeekday(weekday)).join(',')}`);
  }
  if (state.freq === 'monthly' && state.monthlyPattern !== undefined) {
    if (state.monthlyPattern.kind === 'dayOfMonth') {
      parts.push(`BYMONTHDAY=${state.monthlyPattern.day}`);
    } else {
      const { ordinal, weekday } = state.monthlyPattern;
      parts.push(`BYDAY=${ordinal}${byDayCodeForWeekday(weekday)}`);
    }
  }
  if (state.end.type === 'count') {
    parts.push(`COUNT=${state.end.count}`);
  } else if (state.end.type === 'until') {
    const fake = floorFakeUTCToWholeSecond(toFakeUTC(state.end.until, timeZone));
    parts.push(`UNTIL=${formatFakeUTCAsUntil(fake)}`);
  }
  return parts.join(';');
}

/**
 * `state` を {@link CalendarEvent.rrule} にそのまま渡せる RRULE 本体文字列に変換する。
 *
 * `state` を手組みの RRULE テキストにしたうえで {@link normalizeRRuleString} を
 * 通し、rrule.js 自身の妥当性確認と正規化を経由させる。さらに実際の `dtstart` を
 * 付与して構築できることも確認する（`until` が `dtstart` より前でも例外にはしない）。
 *
 * @param params.state - 変換対象の状態
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン（`UNTIL` の変換に使用）
 * @returns RRULE 本体文字列
 * @throws `state` に検証エラーがある場合は `Error`
 * @example
 * ```ts
 * buildRecurrenceRuleString({
 *   state: { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } },
 *   dtstart: new Date('2026-07-01T00:00:00Z'),
 *   timeZone: 'Asia/Tokyo',
 * });
 * // => 'FREQ=WEEKLY;BYDAY=MO,WE'
 * ```
 */
export function buildRecurrenceRuleString(params: {
  state: RecurrenceRuleState;
  dtstart: Date;
  timeZone: TimeZoneId;
}): string {
  const { state, dtstart, timeZone } = params;
  const issues = validateRecurrenceRuleState(state);
  if (issues.length > 0) {
    throw new Error(
      `不正な繰り返しルールの状態です: ${issues.map((issue) => issue.message).join('、')}`,
    );
  }
  const normalized = normalizeRRuleString(buildRawRRuleText(state, timeZone));
  const parsedWithDtstart = parseRRuleOptions(normalized);
  void new RRule({ ...parsedWithDtstart, dtstart: toFakeUTC(dtstart, timeZone) });
  return normalized;
}

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

/** `describeRecurrenceRule` の `context` パラメータの型。 */
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
 * 検証（{@link validateRecurrenceRuleState}）を要求しない best-effort な整形であり、
 * `interval` が 1 未満・非整数の場合は表示上 1 として扱うなど、無効な状態でも
 * 例外を投げずに整形する。`byWeekday` / `monthlyPattern` が省略されており
 * `context` も渡されない場合、曜日・日にちを欠いた曖昧な文言（「毎週」「毎月」等）
 * になる（DTSTART に暗黙依存する状態を、DTSTART を知らずに説明する以上の
 * 情報は得られないための既知の制限）。
 *
 * @param state - 説明文を生成する対象の状態
 * @param context - 曜日・月内日付・年内の月日を補うための DTSTART とタイムゾーン（省略可）
 * @returns 日本語の説明文
 * @example
 * ```ts
 * describeRecurrenceRule({
 *   freq: 'weekly',
 *   interval: 1,
 *   byWeekday: [1, 3],
 *   end: { type: 'count', count: 5 },
 * });
 * // => '毎週月・水（5回）'
 * ```
 */
export function describeRecurrenceRule(
  state: RecurrenceRuleState,
  context?: { dtstart?: Date; timeZone?: TimeZoneId },
): string {
  const interval = Number.isInteger(state.interval) && state.interval >= 1 ? state.interval : 1;
  const base = describeBaseJa(state, interval, context);
  return `${base}${describeEndSuffixJa(state.end, context?.timeZone)}`;
}
