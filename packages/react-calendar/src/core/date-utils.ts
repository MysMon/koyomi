/**
 * @packageDocumentation
 * 日付範囲・グリッド計算ユーティリティ。
 *
 * ビュー（月・週・日・リスト）の表示範囲やナビゲーションに関わる
 * 日付演算を提供する。タイムゾーン依存の基礎演算は {@link ./timezone} に委譲する。
 */

import { TZDate } from '@date-fns/tz';
import { addMonths } from 'date-fns';
import {
  addDaysInZone,
  fromWallClock,
  getWallClock,
  startOfDayInZone,
  weekdayInZone,
} from './timezone';
import type { CalendarViewType, DateRange, TimeZoneId, Weekday } from './types';

/**
 * 指定タイムゾーン・週開始曜日における「その週の開始日 0:00」の絶対時刻を返す。
 *
 * @param date - 基準となる絶対時刻
 * @param timeZone - タイムゾーン
 * @param weekStartsOn - 週の開始曜日
 */
export function startOfWeekInZone(date: Date, timeZone: TimeZoneId, weekStartsOn: Weekday): Date {
  const dayStart = startOfDayInZone(date, timeZone);
  const weekday = weekdayInZone(dayStart, timeZone);
  const diff = (weekday - weekStartsOn + 7) % 7;
  return diff === 0 ? dayStart : addDaysInZone(dayStart, -diff, timeZone);
}

/**
 * 指定タイムゾーンにおける「その月の 1 日 0:00」の絶対時刻を返す。
 */
export function startOfMonthInZone(date: Date, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  return fromWallClock({ year: wall.year, month: wall.month, day: 1 }, timeZone);
}

/**
 * 指定タイムゾーンの壁時計基準で月数を加算する。
 * 加算後に存在しない日（例: 1/31 + 1 ヶ月）は月末にクランプされる。
 */
export function addMonthsInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  // TZDate に対する date-fns の addMonths は指定 TZ の壁時計を維持し、月末にクランプする
  const zoned = addMonths(new TZDate(date.getTime(), timeZone), amount);
  return new Date(zoned.getTime());
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
  const monthStart = startOfMonthInZone(anchor, timeZone);
  const start = startOfWeekInZone(monthStart, timeZone, weekStartsOn);
  // 月末日 = 翌月 1 日の前日（0:00 同士なので壁時計基準で 1 日戻す）
  const nextMonthStart = addMonthsInZone(monthStart, 1, timeZone);
  const lastDay = addDaysInZone(nextMonthStart, -1, timeZone);
  const end = addDaysInZone(startOfWeekInZone(lastDay, timeZone, weekStartsOn), 7, timeZone);
  return { start, end };
}

/**
 * 範囲内の各日の開始時刻（指定タイムゾーンにおける 0:00）を列挙する。
 *
 * `range.start` が日の途中の場合、その日（`range.start` が属する日）の 0:00 から
 * 列挙を開始する。
 *
 * @param range - 対象範囲（`end` 排他）
 * @param timeZone - タイムゾーン
 * @returns 日付昇順の配列
 */
export function eachDayInRange(range: DateRange, timeZone: TimeZoneId): Date[] {
  const days: Date[] = [];
  if (range.start.getTime() >= range.end.getTime()) {
    return days;
  }
  let cursor = startOfDayInZone(range.start, timeZone);
  while (cursor.getTime() < range.end.getTime()) {
    days.push(cursor);
    cursor = addDaysInZone(cursor, 1, timeZone);
  }
  return days;
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
  // 共通部分 [max(start), min(end)) が空でないかで判定する。
  // この形は空範囲（start === end）が何とも重ならないことを正しく扱える
  return (
    Math.max(a.start.getTime(), b.start.getTime()) < Math.min(a.end.getTime(), b.end.getTime())
  );
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
  switch (view) {
    case 'month':
      return monthGridRange(currentDate, timeZone, options.weekStartsOn);
    case 'week': {
      const start = startOfWeekInZone(currentDate, timeZone, options.weekStartsOn);
      return { start, end: addDaysInZone(start, 7, timeZone) };
    }
    case 'day': {
      const start = startOfDayInZone(currentDate, timeZone);
      return { start, end: addDaysInZone(start, 1, timeZone) };
    }
    case 'list': {
      const start = startOfDayInZone(currentDate, timeZone);
      return { start, end: addDaysInZone(start, options.listDays, timeZone) };
    }
  }
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
  switch (view) {
    case 'month':
      return startOfMonthInZone(addMonthsInZone(currentDate, direction, timeZone), timeZone);
    case 'week':
      return addDaysInZone(currentDate, 7 * direction, timeZone);
    case 'day':
      return addDaysInZone(currentDate, direction, timeZone);
    case 'list':
      return addDaysInZone(currentDate, options.listDays * direction, timeZone);
  }
}
