/**
 * @packageDocumentation
 * 日付範囲・グリッド計算ユーティリティ。
 *
 * ビュー（月・週・日・リスト）の表示範囲やナビゲーションに関わる
 * 日付演算を提供する。タイムゾーン依存の基礎演算は {@link ./timezone} に委譲する。
 */

import type { CalendarViewType, DateRange, TimeZoneId, Weekday } from './types';

/**
 * 指定タイムゾーン・週開始曜日における「その週の開始日 0:00」の絶対時刻を返す。
 *
 * @param date - 基準となる絶対時刻
 * @param timeZone - タイムゾーン
 * @param weekStartsOn - 週の開始曜日
 */
export function startOfWeekInZone(date: Date, timeZone: TimeZoneId, weekStartsOn: Weekday): Date {
  void date;
  void timeZone;
  void weekStartsOn;
  throw new Error('未実装');
}

/**
 * 指定タイムゾーンにおける「その月の 1 日 0:00」の絶対時刻を返す。
 */
export function startOfMonthInZone(date: Date, timeZone: TimeZoneId): Date {
  void date;
  void timeZone;
  throw new Error('未実装');
}

/**
 * 指定タイムゾーンの壁時計基準で月数を加算する。
 * 加算後に存在しない日（例: 1/31 + 1 ヶ月）は月末にクランプされる。
 */
export function addMonthsInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  void date;
  void amount;
  void timeZone;
  throw new Error('未実装');
}

/**
 * 月ビューのグリッド範囲を返す。
 *
 * 「月初を含む週の開始日 0:00」から「月末を含む週の翌週開始日 0:00（排他）」まで。
 * 週数は月によって 4〜6 週になる（Google カレンダーと同じ動的行数）。
 *
 * @param anchor - 表示対象月に含まれる任意の日時
 * @param timeZone - タイムゾーン
 * @param weekStartsOn - 週の開始曜日
 */
export function monthGridRange(
  anchor: Date,
  timeZone: TimeZoneId,
  weekStartsOn: Weekday,
): DateRange {
  void anchor;
  void timeZone;
  void weekStartsOn;
  throw new Error('未実装');
}

/**
 * 範囲内の各日の開始時刻（指定タイムゾーンにおける 0:00）を列挙する。
 *
 * @param range - 対象範囲（`end` 排他）
 * @param timeZone - タイムゾーン
 * @returns 日付昇順の配列
 */
export function eachDayInRange(range: DateRange, timeZone: TimeZoneId): Date[] {
  void range;
  void timeZone;
  throw new Error('未実装');
}

/**
 * 2 つの範囲が重なるかどうかを判定する（`end` は排他）。
 *
 * @example
 * ```ts
 * // [10:00, 11:00) と [11:00, 12:00) は重ならない
 * rangesOverlap(a, b); // => false
 * ```
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  void a;
  void b;
  throw new Error('未実装');
}

/**
 * ビューごとの表示日時範囲を返す。
 *
 * - `month` — {@link monthGridRange}（前後月の埋め草を含む）
 * - `week` — 基準日を含む週（7 日間）
 * - `day` — 基準日の 1 日
 * - `list` — 基準日の 0:00 から `listDays` 日間
 *
 * @param view - ビュー種別
 * @param currentDate - 基準日
 * @param timeZone - タイムゾーン
 * @param options - 週開始曜日とリスト日数
 */
export function visibleRangeFor(
  view: CalendarViewType,
  currentDate: Date,
  timeZone: TimeZoneId,
  options: { weekStartsOn: Weekday; listDays: number },
): DateRange {
  void view;
  void currentDate;
  void timeZone;
  void options;
  throw new Error('未実装');
}

/**
 * 「次へ / 前へ」ナビゲーションの移動先の基準日を返す。
 *
 * - `month` — ±1 ヶ月（日は月初に正規化）
 * - `week` — ±7 日
 * - `day` — ±1 日
 * - `list` — ±`listDays` 日
 *
 * @param view - ビュー種別
 * @param currentDate - 現在の基準日
 * @param direction - `1`（次へ）または `-1`（前へ）
 * @param timeZone - タイムゾーン
 * @param options - リスト日数
 */
export function navigateDate(
  view: CalendarViewType,
  currentDate: Date,
  direction: 1 | -1,
  timeZone: TimeZoneId,
  options: { listDays: number },
): Date {
  void view;
  void currentDate;
  void direction;
  void timeZone;
  void options;
  throw new Error('未実装');
}
