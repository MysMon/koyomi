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
  isoWeekNumberInZone,
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
  if (diff === 0) {
    return dayStart;
  }
  // 基準日の 0:00 が DST 切替で存在しない日では dayStart が繰り上げ解決（0:00 以外）に
  // なるため、現地時刻を維持する addDaysInZone では週開始日の「日の開始」に戻らない。
  // 現地日付だけを暦演算で diff 日戻し、fromWallClock の解決規則で日の開始を構築する
  const wall = getWallClock(dayStart, timeZone);
  const shifted = new Date(0);
  shifted.setUTCFullYear(wall.year, wall.month - 1, wall.day - diff);
  return fromWallClock(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    timeZone,
  );
}

/**
 * 週開始曜日（{@link CalendarOptions.weekStartsOn}）に依存しない ISO 8601 週番号を返す。
 *
 * ISO 8601 週は常に月曜始まりだが、Koyomi の週の並びは `weekStartsOn` によって
 * 日曜始まり・土曜始まりなどに変わる。どの曜日で始まる 7 日間にも必ず木曜日が
 * 1 日だけ含まれるため、その木曜日を基準に {@link isoWeekNumberInZone} を呼ぶことで、
 * `weekStartsOn` の値によらず「その週」に対応する ISO 週番号を一意に返す。
 *
 * 注意: 一意なのは「与えられた 7 日間の週」に対する番号であって、個々の日付が
 * どの番号の週の行に表示されるかは週の区切り方（`weekStartsOn`）に依存する。
 * 例えば `weekStartsOn: 4`（木曜始まり）では週窓に含まれる木曜日が月曜始まりの
 * 場合と 1 週ずれることがあり、同じ日付でも他の `weekStartsOn` と異なる週番号の
 * 行に見える（例: 2026-07-01 は `weekStartsOn: 4` でのみ第 26 週の行に入る）。
 * これは月曜週前提の ISO 週番号を任意区切りの週に割り当てることに固有の性質で、
 * 実装上の不具合ではない。
 *
 * @param weekStart - 週の開始日（`weekStartsOn` に従う任意の曜日の 0:00。
 *   {@link startOfWeekInZone} の戻り値を渡す想定）
 * @param timeZone - 表示タイムゾーン
 * @returns ISO 8601 週番号（1〜53）
 * @example
 * ```ts
 * // 週開始=日曜でも週開始=月曜でも、2026-07-01 を含む週は常に第 27 週
 * isoWeekNumberOfWeek(startOfWeekInZone(anchor, 'Asia/Tokyo', 0), 'Asia/Tokyo'); // => 27
 * isoWeekNumberOfWeek(startOfWeekInZone(anchor, 'Asia/Tokyo', 1), 'Asia/Tokyo'); // => 27
 * ```
 */
export function isoWeekNumberOfWeek(weekStart: Date, timeZone: TimeZoneId): number {
  const startWeekday = weekdayInZone(weekStart, timeZone);
  // weekStart から見た木曜日（weekday === 4）までの前方日数（0〜6）。
  // 週の 7 日間には必ず木曜日が 1 日だけ含まれるため、この日数は常に非負で一意に定まる
  const daysUntilThursday = (4 - startWeekday + 7) % 7;
  const thursday = addDaysInZone(weekStart, daysUntilThursday, timeZone);
  return isoWeekNumberInZone(thursday, timeZone);
}

/**
 * 指定タイムゾーンにおける「その月の 1 日 0:00」の絶対時刻を返す。
 */
export function startOfMonthInZone(date: Date, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  return fromWallClock({ year: wall.year, month: wall.month, day: 1 }, timeZone);
}

/**
 * 指定タイムゾーンの現地時刻基準で月数を加算する。
 * 加算後に存在しない日（例: 1/31 + 1 ヶ月）は月末にクランプされる。
 */
export function addMonthsInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  // TZDate に対する date-fns の addMonths は指定 TZ の現地時刻を維持し、月末にクランプする
  const zoned = addMonths(new TZDate(date.getTime(), timeZone), amount);
  return new Date(zoned.getTime());
}

/**
 * 指定タイムゾーンにおける「その年の 1 月 1 日 0:00」の絶対時刻を返す。
 *
 * 1 月 1 日の深夜 0:00 が存在しないゾーンに備えて
 * `startOfDayInZone` で日の開始へ再正規化する。
 */
export function startOfYearInZone(date: Date, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  return startOfDayInZone(fromWallClock({ year: wall.year, month: 1, day: 1 }, timeZone), timeZone);
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
  // 月末日 = 翌月 1 日の前日（0:00 同士なので現地時刻基準で 1 日戻す）
  const nextMonthStart = addMonthsInZone(monthStart, 1, timeZone);
  const lastDay = addDaysInZone(nextMonthStart, -1, timeZone);
  // addDaysInZone は加算前の現地時刻を維持するため、週開始日に深夜 0:00 が
  // 存在しないゾーン（例: America/Santiago）を跨ぐと翌週開始日と時刻がずれる
  // おそれがある。startOfDayInZone で日の開始へ正規化して防ぐ（eachDayInRange と同じ理由）
  const end = startOfDayInZone(
    addDaysInZone(startOfWeekInZone(lastDay, timeZone, weekStartsOn), 7, timeZone),
    timeZone,
  );
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
    // addDaysInZone は加算前の現地時刻（時分秒）を維持したまま日を進める。
    // 深夜 0:00 に DST が切り替わるゾーン（例: America/Santiago）では、切替日の
    // 0:00 が存在せず 1:00 に繰り上げられるため、そのまま維持し続けると
    // 以降の全日が誤って 1:00 を引きずってしまう。毎回 startOfDayInZone で
    // 日の開始（0:00、存在しなければ 1:00 に繰り上げた時刻）へ再正規化することで防ぐ
    cursor = startOfDayInZone(addDaysInZone(cursor, 1, timeZone), timeZone);
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
 * - `month` — {@link monthGridRange}（前後月の日付を含む）
 * - `week` — 基準日を含む週（7 日間）
 * - `day` — 基準日の 1 日
 * - `list` — 基準日の 0:00 から `listDays` 日間
 * - `year` — 基準日を含む年（年初 0:00 から翌年初 0:00 まで。
 *   ミニ月グリッドの前後月の日付は含まない）
 * - `multiMonth` — 基準日を含む月の月初 0:00 から `multiMonthCount` ヶ月後の
 *   月初 0:00 まで（各月グリッドの前後月の日付は含まない）
 * - `resource` — 基準日の 0:00 から `resourceViewDays` 日間（省略時は 1 日 = `day` と同一）
 * - `timeline` — 基準日の 0:00 から `timelineDays` 日間
 *
 * @param view - ビュー種別
 * @param currentDate - 基準日
 * @param timeZone - タイムゾーン
 * @param options - 週開始曜日・リスト日数・複数月ビューの月数・タイムライン/リソースの日数
 *   （`resourceViewDays` 省略時は `1`）
 */
export function visibleRangeFor(
  view: CalendarViewType,
  currentDate: Date,
  timeZone: TimeZoneId,
  options: {
    weekStartsOn: Weekday;
    listDays: number;
    multiMonthCount: number;
    timelineDays: number;
    resourceViewDays?: number;
  },
): DateRange {
  // addDaysInZone は加算前の現地時刻を維持するため、start が深夜 0:00 の
  // 存在しないゾーン（例: America/Santiago）の切替日で繰り上げられた時刻
  // （例: 1:00）を持っていると、そのまま加算した end も同じ時刻になってしまい
  // 隣接する範囲の start（日の開始に正規化されている）と 1 時間重複する。
  // startOfDayInZone で end を日の開始へ再正規化して防ぐ
  switch (view) {
    case 'month':
      return monthGridRange(currentDate, timeZone, options.weekStartsOn);
    case 'week': {
      const start = startOfWeekInZone(currentDate, timeZone, options.weekStartsOn);
      const end = startOfDayInZone(addDaysInZone(start, 7, timeZone), timeZone);
      return { start, end };
    }
    case 'day': {
      const start = startOfDayInZone(currentDate, timeZone);
      const end = startOfDayInZone(addDaysInZone(start, 1, timeZone), timeZone);
      return { start, end };
    }
    case 'resource': {
      const start = startOfDayInZone(currentDate, timeZone);
      const end = startOfDayInZone(
        addDaysInZone(start, options.resourceViewDays ?? 1, timeZone),
        timeZone,
      );
      return { start, end };
    }
    case 'timeline': {
      const start = startOfDayInZone(currentDate, timeZone);
      const end = startOfDayInZone(addDaysInZone(start, options.timelineDays, timeZone), timeZone);
      return { start, end };
    }
    case 'list': {
      const start = startOfDayInZone(currentDate, timeZone);
      const end = startOfDayInZone(addDaysInZone(start, options.listDays, timeZone), timeZone);
      return { start, end };
    }
    case 'year': {
      const start = startOfYearInZone(currentDate, timeZone);
      // 年初 0:00 の 12 ヶ月後 = 翌年初。念のため日の開始へ再正規化する
      const end = startOfDayInZone(addMonthsInZone(start, 12, timeZone), timeZone);
      return { start, end };
    }
    case 'multiMonth': {
      const start = startOfMonthInZone(currentDate, timeZone);
      // 月初 0:00 の N ヶ月後 = 最終月の翌月初。念のため日の開始へ再正規化する
      const end = startOfDayInZone(
        addMonthsInZone(start, options.multiMonthCount, timeZone),
        timeZone,
      );
      return { start, end };
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
 * - `year` — ±1 年（日は年初に正規化）
 * - `multiMonth` — ±`multiMonthCount` ヶ月（日は月初に正規化）
 * - `resource` — ±`resourceViewDays` 日（省略時は ±1 日）
 * - `timeline` — ±`timelineDays` 日
 *
 * @param view - ビュー種別
 * @param currentDate - 現在の基準日
 * @param direction - `1`（次へ）または `-1`（前へ）
 * @param timeZone - タイムゾーン
 * @param options - リスト日数・複数月ビューの月数・タイムライン/リソースの日数
 *   （`resourceViewDays` 省略時は `1`）
 */
export function navigateDate(
  view: CalendarViewType,
  currentDate: Date,
  direction: 1 | -1,
  timeZone: TimeZoneId,
  options: {
    listDays: number;
    multiMonthCount: number;
    timelineDays: number;
    resourceViewDays?: number;
  },
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
    case 'year':
      return startOfYearInZone(
        addMonthsInZone(startOfYearInZone(currentDate, timeZone), 12 * direction, timeZone),
        timeZone,
      );
    case 'multiMonth':
      return startOfMonthInZone(
        addMonthsInZone(currentDate, options.multiMonthCount * direction, timeZone),
        timeZone,
      );
    case 'resource':
      return addDaysInZone(currentDate, (options.resourceViewDays ?? 1) * direction, timeZone);
    case 'timeline':
      return addDaysInZone(currentDate, options.timelineDays * direction, timeZone);
  }
}
