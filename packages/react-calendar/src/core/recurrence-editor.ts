/**
 * @packageDocumentation
 * 繰り返しルール（RRULE）の構造化編集。
 *
 * `core/recurrence.ts` の RRULE 展開エンジンとは異なり、こちらは RRULE 文字列と
 * 構造化された {@link RecurrenceRuleState} を相互変換し、フォーム入力向けの検証を
 * 提供する。対応範囲は `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・
 * `BYDAY`（週の曜日集合、または月の第 n 曜日）・`BYMONTHDAY`（単一値）・
 * `COUNT`/`UNTIL` のみで、範囲外の指定は {@link parseRecurrenceRule} が
 * `unsupported` として元の RRULE 文字列を保持する（内容を書き換えない）。
 * `WKST` はカレンダーの週の開始曜日（`weekStartsOn`）と接続され、
 * {@link buildRecurrenceRuleString} が出力し {@link parseRecurrenceRule} が
 * 一致判定する（詳細は各関数の説明を参照）。
 *
 * core は React に依存しないため、検証エラー・非対応理由は機械可読な判別
 * ユニオン（{@link RecurrenceValidationIssue}・{@link RecurrenceUnsupportedReason}）
 * として返し、ロケールごとの文言化は `@koyomi-cal/react` の
 * メッセージカタログ（`react/locales/*`）が担う。
 */

import type { Options } from 'rrule';
import { RRule } from 'rrule';
import { fromFakeUTC, normalizeRRuleString, parseRRuleOptions, toFakeUTC } from './recurrence';
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

/**
 * {@link validateRecurrenceRuleState} が返す検証エラー 1 件。
 *
 * `field` ごとに意味のある `code` の値域が異なる判別ユニオン。文言化は
 * `@koyomi-cal/react` のメッセージカタログ（`catalog.recurrenceEditor.validationMessage`）
 * が担う。
 */
export type RecurrenceValidationIssue =
  | { field: 'interval'; code: 'invalid' }
  | { field: 'byWeekday'; code: 'empty' | 'duplicate' | 'outOfRange' }
  | { field: 'monthlyPattern'; code: 'dayOfMonthInvalid' | 'ordinalInvalid' | 'weekdayInvalid' }
  | { field: 'count'; code: 'invalid' }
  | { field: 'until'; code: 'invalid' };

/**
 * {@link unsupportedGenericFieldReason} の `unsupportedField` が指す、対応していない
 * RRULE のフィールドの安定識別子。`BYDAY_EXPANDED` / `BYMONTHDAY_EXPANDED` は
 * rrule.js 内部の展開済み表現（`bynweekday` / `bynmonthday`）を指す。
 */
export type RecurrenceUnsupportedField =
  | 'BYSETPOS'
  | 'BYMONTH'
  | 'BYYEARDAY'
  | 'BYWEEKNO'
  | 'BYHOUR'
  | 'BYMINUTE'
  | 'BYSECOND'
  | 'BYEASTER'
  | 'BYDAY_EXPANDED'
  | 'BYMONTHDAY_EXPANDED';

/**
 * {@link parseRecurrenceRule} が編集エディタの対応範囲外と判断した理由の判別ユニオン。
 *
 * `invalidRRuleSyntax` のみ rrule.js が投げた例外由来で、`detail` に英語の原文
 * メッセージを保持する（それ以外は判定ロジックが直接返す固定コード）。文言化は
 * `@koyomi-cal/react` のメッセージカタログ（`catalog.recurrenceEditor.unsupportedReason`）
 * が担う。
 */
export type RecurrenceUnsupportedReason =
  | { code: 'unsupportedField'; field: RecurrenceUnsupportedField }
  | { code: 'unsupportedWkst' }
  | { code: 'unsupportedFrequency' }
  | { code: 'countAndUntilBothSpecified' }
  | { code: 'byDayFormatUnrecognized' }
  | { code: 'dailyByDayOrByMonthDayUnsupported' }
  | { code: 'yearlyByDayOrByMonthDayUnsupported' }
  | { code: 'weeklyByMonthDayUnsupported' }
  | { code: 'weeklyByDayOrdinalUnsupported' }
  | { code: 'monthlyByDayAndByMonthDayConflict' }
  | { code: 'monthlyByMonthDayMultipleValuesUnsupported' }
  | { code: 'monthlyByDayMultipleTokensUnsupported' }
  | { code: 'monthlyByDayOrdinalRequired' }
  | { code: 'monthlyByDayOrdinalOutOfRange' }
  | { code: 'invalidRRuleSyntax'; detail: string };

/** {@link parseRecurrenceRule} の結果。 */
export type ParsedRecurrenceRule =
  | { kind: 'none' }
  | { kind: 'editable'; state: RecurrenceRuleState }
  | { kind: 'unsupported'; rawRRule: string; reason: RecurrenceUnsupportedReason };

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
 * `wkst` は、明示指定が週の開始曜日（`weekStartsOn`、省略時は RRULE 既定の月曜）と
 * 一致する場合のみ許容し、不一致の明示指定を対応外とする（`WKST` の省略は常に許容する）。
 * 判定には正規化済みテキスト（`normalizedText`）から `WKST=` を読み取る
 * （rrule.js 内部の曜日エンコーディングに依存しないための方針）。
 */
function unsupportedGenericFieldReason(
  parsed: Partial<Options>,
  normalizedText: string,
  weekStartsOn: Weekday | undefined,
): RecurrenceUnsupportedReason | null {
  if (parsed.bysetpos !== undefined && parsed.bysetpos !== null) {
    return { code: 'unsupportedField', field: 'BYSETPOS' };
  }
  if (parsed.bymonth !== undefined && parsed.bymonth !== null) {
    return { code: 'unsupportedField', field: 'BYMONTH' };
  }
  if (parsed.byyearday !== undefined && parsed.byyearday !== null) {
    return { code: 'unsupportedField', field: 'BYYEARDAY' };
  }
  if (parsed.byweekno !== undefined && parsed.byweekno !== null) {
    return { code: 'unsupportedField', field: 'BYWEEKNO' };
  }
  if (parsed.byhour !== undefined && parsed.byhour !== null) {
    return { code: 'unsupportedField', field: 'BYHOUR' };
  }
  if (parsed.byminute !== undefined && parsed.byminute !== null) {
    return { code: 'unsupportedField', field: 'BYMINUTE' };
  }
  if (parsed.bysecond !== undefined && parsed.bysecond !== null) {
    return { code: 'unsupportedField', field: 'BYSECOND' };
  }
  if (parsed.byeaster !== undefined && parsed.byeaster !== null) {
    return { code: 'unsupportedField', field: 'BYEASTER' };
  }
  if (parsed.bynweekday !== undefined && parsed.bynweekday !== null) {
    return { code: 'unsupportedField', field: 'BYDAY_EXPANDED' };
  }
  if (parsed.bynmonthday !== undefined && parsed.bynmonthday !== null) {
    return { code: 'unsupportedField', field: 'BYMONTHDAY_EXPANDED' };
  }
  const wkstMatch = /(?:^|;)WKST=([A-Z]{2})/.exec(normalizedText);
  const wkstCode = wkstMatch?.[1];
  if (wkstCode !== undefined && wkstCode !== byDayCodeForWeekday(weekStartsOn ?? 1)) {
    return { code: 'unsupportedWkst' };
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
  | { ok: false; reason: RecurrenceUnsupportedReason };

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
      return { ok: false, reason: { code: 'dailyByDayOrByMonthDayUnsupported' } };
    }
    return { ok: true, extra: {} };
  }

  if (freq === 'yearly') {
    if (hasByDay || (byMonthDay !== undefined && byMonthDay !== null)) {
      return { ok: false, reason: { code: 'yearlyByDayOrByMonthDayUnsupported' } };
    }
    return { ok: true, extra: {} };
  }

  if (freq === 'weekly') {
    if (byMonthDay !== undefined && byMonthDay !== null) {
      return { ok: false, reason: { code: 'weeklyByMonthDayUnsupported' } };
    }
    if (!hasByDay) {
      return { ok: true, extra: {} };
    }
    if (byDayTokens.some((token) => token.ordinal !== undefined)) {
      return { ok: false, reason: { code: 'weeklyByDayOrdinalUnsupported' } };
    }
    return { ok: true, extra: { byWeekday: byDayTokens.map((token) => token.weekday) } };
  }

  // freq === 'monthly'
  if (hasByDay && byMonthDay !== undefined && byMonthDay !== null) {
    return { ok: false, reason: { code: 'monthlyByDayAndByMonthDayConflict' } };
  }
  if (byMonthDay !== undefined && byMonthDay !== null) {
    if (Array.isArray(byMonthDay)) {
      return { ok: false, reason: { code: 'monthlyByMonthDayMultipleValuesUnsupported' } };
    }
    return { ok: true, extra: { monthlyPattern: { kind: 'dayOfMonth', day: byMonthDay } } };
  }
  if (hasByDay) {
    if (byDayTokens.length > 1) {
      return { ok: false, reason: { code: 'monthlyByDayMultipleTokensUnsupported' } };
    }
    const [token] = byDayTokens;
    if (token === undefined) {
      return { ok: false, reason: { code: 'monthlyByDayOrdinalRequired' } };
    }
    const { ordinal, weekday } = token;
    if (ordinal === undefined) {
      return { ok: false, reason: { code: 'monthlyByDayOrdinalRequired' } };
    }
    if (!isSupportedOrdinal(ordinal)) {
      return { ok: false, reason: { code: 'monthlyByDayOrdinalOutOfRange' } };
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
 * `WKST` は、カレンダーの週の開始曜日（`weekStartsOn`、省略時は RRULE 既定の月曜）と
 * 一致する明示指定のみ受理し、不一致の明示指定は `kind: 'unsupported'` にする
 * （`WKST` を持たないルールは `weekStartsOn` の値によらず受理する）。
 *
 * @param params.rrule - RRULE 文字列。`undefined` は「繰り返しなし」を表す
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン（`UNTIL` の解釈に使用）
 * @param params.weekStartsOn - カレンダーの週の開始曜日（`WKST` の受理判定に使用）。
 *   省略時は RRULE 既定の月曜（`1`）として扱う
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
  weekStartsOn?: Weekday;
}): ParsedRecurrenceRule {
  const { rrule, dtstart, timeZone, weekStartsOn } = params;
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
    return {
      kind: 'unsupported',
      rawRRule: rrule,
      reason: { code: 'invalidRRuleSyntax', detail: errorMessage(cause) },
    };
  }

  const freq = koyomiFrequencyFromRRule(parsed.freq);
  if (freq === null) {
    return {
      kind: 'unsupported',
      rawRRule: rrule,
      reason: { code: 'unsupportedFrequency' },
    };
  }

  const normalizedText = normalizeRRuleString(rrule);

  const genericFieldReason = unsupportedGenericFieldReason(parsed, normalizedText, weekStartsOn);
  if (genericFieldReason !== null) {
    return { kind: 'unsupported', rawRRule: rrule, reason: genericFieldReason };
  }

  if (typeof parsed.count === 'number' && parsed.until instanceof Date) {
    return {
      kind: 'unsupported',
      rawRRule: rrule,
      reason: { code: 'countAndUntilBothSpecified' },
    };
  }

  const byDayTokens = decodeByDayTokens(normalizedText);
  if (byDayTokens === null) {
    return { kind: 'unsupported', rawRRule: rrule, reason: { code: 'byDayFormatUnrecognized' } };
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
    issues.push({ field: 'interval', code: 'invalid' });
  }

  const byWeekday = state.byWeekday;
  if (byWeekday !== undefined) {
    if (byWeekday.length === 0) {
      issues.push({ field: 'byWeekday', code: 'empty' });
    } else if (new Set(byWeekday).size !== byWeekday.length) {
      issues.push({ field: 'byWeekday', code: 'duplicate' });
    } else if (
      byWeekday.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    ) {
      issues.push({ field: 'byWeekday', code: 'outOfRange' });
    }
  }

  const monthlyPattern = state.monthlyPattern;
  if (monthlyPattern !== undefined) {
    if (monthlyPattern.kind === 'dayOfMonth') {
      const { day } = monthlyPattern;
      if (!Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31))) {
        issues.push({ field: 'monthlyPattern', code: 'dayOfMonthInvalid' });
      }
    } else {
      const { ordinal, weekday } = monthlyPattern;
      if (ordinal !== -1 && ordinal !== 1 && ordinal !== 2 && ordinal !== 3 && ordinal !== 4) {
        issues.push({ field: 'monthlyPattern', code: 'ordinalInvalid' });
      }
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        issues.push({ field: 'monthlyPattern', code: 'weekdayInvalid' });
      }
    }
  }

  if (state.end.type === 'count') {
    if (!Number.isInteger(state.end.count) || state.end.count < 1) {
      issues.push({ field: 'count', code: 'invalid' });
    }
  } else if (state.end.type === 'until') {
    const { until } = state.end;
    if (!(until instanceof Date) || Number.isNaN(until.getTime())) {
      issues.push({ field: 'until', code: 'invalid' });
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
function buildRawRRuleText(
  state: RecurrenceRuleState,
  timeZone: TimeZoneId,
  weekStartsOn: Weekday | undefined,
): string {
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
  // 週の開始曜日が月曜（RRULE の既定）以外なら、freq や interval によらず WKST を
  // 常に明示出力する（weekly 以外では展開結果に影響しない無害な指定だが、週境界の
  // 前提をルール自体に残すことで、他アプリへ渡しても解釈がずれないようにする）
  if (weekStartsOn !== undefined && weekStartsOn !== 1) {
    parts.push(`WKST=${byDayCodeForWeekday(weekStartsOn)}`);
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
 * `weekStartsOn` に月曜（`1`）以外を指定すると、`freq` によらず `WKST` を常に
 * 明示出力し、カレンダーの表示上の週境界と RRULE の週境界（`INTERVAL` が 2 以上の
 * `FREQ=WEEKLY` の対象週の区切り）を一致させる。月曜または省略時は `WKST` を
 * 出力しない（RRULE の既定の週開始が月曜のため）。
 *
 * @param params.state - 変換対象の状態
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン（`UNTIL` の変換に使用）
 * @param params.weekStartsOn - カレンダーの週の開始曜日（`WKST` の出力に使用）
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
 *
 * buildRecurrenceRuleString({
 *   state: { freq: 'weekly', interval: 2, byWeekday: [0, 2], end: { type: 'never' } },
 *   dtstart: new Date('2026-07-01T00:00:00Z'),
 *   timeZone: 'Asia/Tokyo',
 *   weekStartsOn: 0,
 * });
 * // => 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU'
 * ```
 */
export function buildRecurrenceRuleString(params: {
  state: RecurrenceRuleState;
  dtstart: Date;
  timeZone: TimeZoneId;
  weekStartsOn?: Weekday;
}): string {
  const { state, dtstart, timeZone, weekStartsOn } = params;
  const issues = validateRecurrenceRuleState(state);
  if (issues.length > 0) {
    throw new Error(
      `不正な繰り返しルールの状態です: ${issues.map((issue) => `${issue.field}:${issue.code}`).join('、')}`,
    );
  }
  const normalized = normalizeRRuleString(buildRawRRuleText(state, timeZone, weekStartsOn));
  const parsedWithDtstart = parseRRuleOptions(normalized);
  void new RRule({ ...parsedWithDtstart, dtstart: toFakeUTC(dtstart, timeZone) });
  return normalized;
}
