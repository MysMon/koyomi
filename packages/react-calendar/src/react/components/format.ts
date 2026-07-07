/**
 * @packageDocumentation
 * ビルトインコンポーネント共通の日時ラベル整形ヘルパ。
 *
 * すべて `Intl.DateTimeFormat` をベースに実装し、`timeZone` / `locale` を
 * 必須引数として受け取る（暗黙のローカルタイムゾーンには依存しない）。
 * `ja` ロケール以外は `Intl` の既定の書式に委ねる（厳密な文字列は保証しない）。
 */

import type { DateRange, TimeZoneId, Weekday } from '../../core/types';

/**
 * 曜日番号の基準日を構成する年（UTC 上、1/1 が日曜日になる年）。
 * 実在の日付には対応しないため、曜日の意味だけを取り出す目的で `UTC` 固定で使う。
 */
const WEEKDAY_REFERENCE_YEAR = 2023;

/**
 * 指定した書式オプションで整形した際の、特定の日付要素（年・月・日など）の
 * 値のみを取り出す。
 *
 * @param date - 対象の絶対時刻
 * @param timeZone - タイムゾーン
 * @param locale - ロケール
 * @param options - `Intl.DateTimeFormat` の書式オプション
 * @param partType - 取り出す要素の種別（例: `'day'`）
 * @returns 該当要素の文字列（該当なしの場合は空文字列）
 */
function extractPart(
  date: Date,
  timeZone: TimeZoneId,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  partType: Intl.DateTimeFormatPartTypes,
): string {
  const parts = new Intl.DateTimeFormat(locale, { ...options, timeZone }).formatToParts(date);
  const part = parts.find((candidate) => candidate.type === partType);
  return part?.value ?? '';
}

/**
 * 時刻を `'H:mm'` 形式（0 埋めなしの時、24 時間制）で整形する。
 *
 * @param date - 対象の絶対時刻
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'9:05'`、`'0:00'`
 * @example
 * ```ts
 * formatTime(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => '10:00'
 * ```
 */
export function formatTime(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * 月ビューのタイトル（年+月）を整形する。
 *
 * @param date - 表示対象月に含まれる絶対時刻
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'2026年7月'`（`ja`）
 * @example
 * ```ts
 * formatMonthTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => '2026年7月'
 * ```
 */
export function formatMonthTitle(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'long' }).format(date);
}

/**
 * 日ビューのタイトル（年月日+曜日）を整形する。
 *
 * @param date - 表示対象日に含まれる絶対時刻
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'2026年7月15日(水)'`（`ja`）
 * @example
 * ```ts
 * formatDayTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => '2026年7月15日(水)'
 * ```
 */
export function formatDayTitle(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

/**
 * 週/リストビューのタイトル（期間の開始日〜終了日）を整形する。
 *
 * `range.end` は排他的なので、終了日には `range.end` の 1 ミリ秒前
 * （範囲に含まれる最後の瞬間）が属する日を使う。開始日と終了日が
 * 同じ年なら年は 1 回だけ、年をまたぐ場合は両端に年を表示する。
 *
 * @param range - 表示対象範囲（`end` 排他）
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'7月5日〜7月11日'`、年をまたぐ場合は `'2025年12月29日〜2026年1月4日'`（`ja`）
 * @example
 * ```ts
 * formatRangeTitle(
 *   { start: new Date('2026-07-04T15:00:00Z'), end: new Date('2026-07-11T15:00:00Z') },
 *   'Asia/Tokyo',
 *   'ja',
 * ); // => '7月5日〜7月11日'
 * ```
 */
export function formatRangeTitle(range: DateRange, timeZone: TimeZoneId, locale: string): string {
  const startDate = range.start;
  // end は排他的なので、範囲に含まれる最後の瞬間（1ms 前）が属する日を終了日とする
  const endDate = new Date(range.end.getTime() - 1);

  const yearFormatter = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric' });
  const sameYear = yearFormatter.format(startDate) === yearFormatter.format(endDate);

  const options: Intl.DateTimeFormatOptions = sameYear
    ? { timeZone, month: 'long', day: 'numeric' }
    : { timeZone, year: 'numeric', month: 'long', day: 'numeric' };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return `${formatter.format(startDate)}〜${formatter.format(endDate)}`;
}

/**
 * 曜日番号を短縮ラベルに変換する。
 *
 * 実在の日付に依存させず、曜日の意味のみを取り出すために `UTC` 上の
 * 固定基準日（{@link WEEKDAY_REFERENCE_YEAR} 年 1 月 1 日 = 日曜日）を使う。
 *
 * @param weekday - 曜日番号（0 = 日曜日、…、6 = 土曜日）
 * @param locale - ロケール
 * @returns 例: `'日'`、`'月'`、…（`ja`）
 * @example
 * ```ts
 * formatWeekday(0, 'ja'); // => '日'
 * ```
 */
export function formatWeekday(weekday: Weekday, locale: string): string {
  const reference = new Date(Date.UTC(WEEKDAY_REFERENCE_YEAR, 0, 1 + weekday));
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(reference);
}

/**
 * 時間グリッドの日ヘッダー用ラベル（日番号+曜日）を整形する。
 *
 * @param date - 対象日に含まれる絶対時刻
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'15 (水)'`（`ja`）
 * @example
 * ```ts
 * formatDayHeader(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => '15 (水)'
 * ```
 */
export function formatDayHeader(date: Date, timeZone: TimeZoneId, locale: string): string {
  const dayNumber = extractPart(date, timeZone, locale, { day: 'numeric' }, 'day');
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(date);
  return `${dayNumber} (${weekday})`;
}
