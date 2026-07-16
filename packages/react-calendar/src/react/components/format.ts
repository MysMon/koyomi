/**
 * @packageDocumentation
 * ビルトインコンポーネント共通の日時ラベル整形ヘルパ。
 *
 * すべて `Intl.DateTimeFormat` をベースに実装し、`timeZone` / `locale` を
 * 必須引数として受け取る（暗黙のローカルタイムゾーンには依存しない）。
 * `ja` ロケール以外は `Intl` の既定の書式に委ねる（厳密な文字列は保証しない）。
 */

import type { CalendarViewType, DateRange, TimeZoneId, Weekday } from '../../core/types';

/**
 * 曜日番号の基準日を構成する年（UTC 上、1/1 が日曜日になる年）。
 * 実在の日付には対応しないため、曜日の意味だけを取り出す目的で `UTC` 固定で使う。
 */
const WEEKDAY_REFERENCE_YEAR = 2023;

/**
 * `Intl.DateTimeFormat` インスタンスのキャッシュ。
 *
 * `Intl.DateTimeFormat` の構築はロケールデータの解決を伴いコストが高いため、
 * `locale` / `timeZone` / 書式オプションの種別が同じであれば使い回す。
 * キーは `` `${locale}|${timeZone}|${optionsKey}` `` の形式（`optionsKey` は
 * 呼び出し側が書式オプションの種別ごとに割り当てる一意な文字列）。
 */
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * `locale` / `timeZone` / `optionsKey` の組み合わせでキャッシュされた
 * `Intl.DateTimeFormat` を取得する。未生成なら `options` から新規生成してキャッシュする。
 *
 * @param locale - ロケール
 * @param timeZone - タイムゾーン
 * @param optionsKey - 書式オプションの種別を表す一意なキー（呼び出し側の関数ごとに固定値を割り当てる）
 * @param options - `Intl.DateTimeFormat` の書式オプション（`timeZone` は自動で補われる）
 * @returns キャッシュされた、または新規生成した `Intl.DateTimeFormat`
 */
function getCachedDateTimeFormat(
  locale: string,
  timeZone: TimeZoneId,
  optionsKey: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${optionsKey}`;
  const cached = dateTimeFormatCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  dateTimeFormatCache.set(cacheKey, formatter);
  return formatter;
}

/**
 * 指定した書式オプションで整形した際の、特定の日付要素（年・月・日など）の
 * 値のみを取り出す。
 *
 * @param date - 対象の絶対時刻
 * @param timeZone - タイムゾーン
 * @param locale - ロケール
 * @param optionsKey - `options` に対応する一意なキー（キャッシュ用）
 * @param options - `Intl.DateTimeFormat` の書式オプション
 * @param partType - 取り出す要素の種別（例: `'day'`）
 * @returns 該当要素の文字列（該当なしの場合は空文字列）
 */
function extractPart(
  date: Date,
  timeZone: TimeZoneId,
  locale: string,
  optionsKey: string,
  options: Intl.DateTimeFormatOptions,
  partType: Intl.DateTimeFormatPartTypes,
): string {
  const parts = getCachedDateTimeFormat(locale, timeZone, optionsKey, options).formatToParts(date);
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
  return getCachedDateTimeFormat(locale, timeZone, 'time', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * タイムゾーンを GMT オフセットの短縮ラベル（`'GMT+9'` / `'GMT-4'` など）にする。
 *
 * 週/日ビューの時間軸の見出し（どのタイムゾーンの時刻かを示すラベル）に使う。
 * オフセットは `date` 時点の値で算出するため、夏時間（DST）を正しく反映する。
 *
 * @param date - オフセット算出の基準になる絶対時刻
 * @param timeZone - 対象のタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'GMT+9'`（東京）、`'GMT-4'`（夏時間中のニューヨーク）、`'GMT'`（UTC）
 * @example
 * ```ts
 * formatTimeZoneLabel(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => 'GMT+9'
 * ```
 */
export function formatTimeZoneLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  const parts = getCachedDateTimeFormat(locale, timeZone, 'timezone-label', {
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  // オフセット 0 のラベルは ICU（Intl の実装データ）のバージョンにより
  // 'GMT' / 'GMT+0' のどちらにも整形されうるため、実行環境に依存しない
  // 安定した表示になるよう 'GMT' へ正規化する
  return /^GMT[+-]0{1,2}(?::00)?$/.test(label) ? 'GMT' : label;
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
  return getCachedDateTimeFormat(locale, timeZone, 'month-title', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

/**
 * 年ビューのタイトル（年のみ）を整形する。
 *
 * @param date - 表示対象年に含まれる絶対時刻
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @returns 例: `'2026年'`（`ja`）
 * @example
 * ```ts
 * formatYearTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja'); // => '2026年'
 * ```
 */
export function formatYearTitle(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getCachedDateTimeFormat(locale, timeZone, 'year-title', {
    year: 'numeric',
  }).format(date);
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
  return getCachedDateTimeFormat(locale, timeZone, 'day-title', {
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
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}）
 * @returns 例: `'7月5日〜7月11日'`、年をまたぐ場合は `'2025年12月29日〜2026年1月4日'`（`ja`）
 * @example
 * ```ts
 * formatRangeTitle(
 *   { start: new Date('2026-07-04T15:00:00Z'), end: new Date('2026-07-11T15:00:00Z') },
 *   'Asia/Tokyo',
 *   'ja',
 *   '〜',
 * ); // => '7月5日〜7月11日'
 * ```
 */
export function formatRangeTitle(
  range: DateRange,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string {
  const startDate = range.start;
  // end は排他的なので、範囲に含まれる最後の瞬間（1ms 前）が属する日を終了日とする
  const endDate = new Date(range.end.getTime() - 1);

  const yearFormatter = getCachedDateTimeFormat(locale, timeZone, 'range-year', {
    year: 'numeric',
  });
  const sameYear = yearFormatter.format(startDate) === yearFormatter.format(endDate);

  const formatter = sameYear
    ? getCachedDateTimeFormat(locale, timeZone, 'range-same-year', {
        month: 'long',
        day: 'numeric',
      })
    : getCachedDateTimeFormat(locale, timeZone, 'range-diff-year', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
  return `${formatter.format(startDate)}${rangeSeparator}${formatter.format(endDate)}`;
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
  return getCachedDateTimeFormat(locale, 'UTC', 'weekday-short', { weekday: 'short' }).format(
    reference,
  );
}

/**
 * 現在のビューに応じた期間タイトルを整形する。
 *
 * `Toolbar` の見出しと `useCalendarAnnouncer` の既定のビュー変更通知（`announce.viewChange`）の
 * 両方から共通で使う。
 *
 * @param view - 対象のビュー
 * @param currentDate - 表示の基準日
 * @param range - 表示範囲（`end` 排他）
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}。週・リスト・複数日タイムライン・
 *   複数月ビューでのみ使う）
 * @returns 例: `'2026年7月'`（月）、`'2026年7月15日(水)'`（日・リソース）、
 *   `'7月12日〜7月18日'`（週・リスト）、`'2026年'`（年）（`ja`）
 * @example
 * ```ts
 * formatViewTitle(
 *   'month',
 *   new Date('2026-07-15T01:00:00Z'),
 *   { start: new Date('2026-07-01T00:00:00+09:00'), end: new Date('2026-08-01T00:00:00+09:00') },
 *   'Asia/Tokyo',
 *   'ja',
 *   '〜',
 * ); // => '2026年7月'
 * ```
 */
export function formatViewTitle(
  view: CalendarViewType,
  currentDate: Date,
  range: DateRange,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string {
  switch (view) {
    case 'month':
      return formatMonthTitle(currentDate, timeZone, locale);
    case 'day':
    case 'resource':
      return formatDayTitle(currentDate, timeZone, locale);
    case 'week':
    case 'list':
      return formatRangeTitle(range, timeZone, locale, rangeSeparator);
    case 'timeline': {
      // 1 日表示なら日ビューと同じ形式、複数日なら範囲形式
      const lastInstant = new Date(range.end.getTime() - 1);
      return formatDayTitle(range.start, timeZone, locale) ===
        formatDayTitle(lastInstant, timeZone, locale)
        ? formatDayTitle(currentDate, timeZone, locale)
        : formatRangeTitle(range, timeZone, locale, rangeSeparator);
    }
    case 'year':
      return formatYearTitle(currentDate, timeZone, locale);
    case 'multiMonth': {
      // 「2026年7月〜2026年9月」形式。表示範囲の end は排他（最終月の翌月初）なので
      // 1 ミリ秒前で最終月に含まれる時点を得る
      const lastMonthInstant = new Date(range.end.getTime() - 1);
      const startTitle = formatMonthTitle(range.start, timeZone, locale);
      const endTitle = formatMonthTitle(lastMonthInstant, timeZone, locale);
      return startTitle === endTitle ? startTitle : `${startTitle}${rangeSeparator}${endTitle}`;
    }
  }
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
  const dayNumber = extractPart(date, timeZone, locale, 'day-number', { day: 'numeric' }, 'day');
  const weekday = getCachedDateTimeFormat(locale, timeZone, 'weekday-short', {
    weekday: 'short',
  }).format(date);
  return `${dayNumber} (${weekday})`;
}
