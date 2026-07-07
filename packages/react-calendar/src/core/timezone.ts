/**
 * @packageDocumentation
 * タイムゾーンユーティリティ。
 *
 * タイムゾーン依存の日時計算はすべてこのモジュールを経由して行う。
 * 内部的には date-fns v4 と `@date-fns/tz` の {@link TZDate} を利用する。
 *
 * 「絶対時刻（インスタント）」= `Date` が指す UTC 時点。
 * 「壁時計（wall clock）」= あるタイムゾーンで時計が示す年月日・時分。
 */

import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';
import type { TimeZoneId, Weekday } from './types';

/**
 * 壁時計の成分表現。
 * `month` は 1〜12（`Date` の 0 起点とは異なる）ことに注意。
 */
export interface WallClockParts {
  /** 年（西暦）。 */
  year: number;
  /** 月（1〜12）。 */
  month: number;
  /** 日（1〜31）。 */
  day: number;
  /** 時（0〜23）。既定は 0。 */
  hours?: number;
  /** 分（0〜59）。既定は 0。 */
  minutes?: number;
  /** 秒（0〜59）。既定は 0。 */
  seconds?: number;
}

/** `'YYYY-MM-DD'` 形式の日付キー。 */
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** オフセット付き ISO 8601（`Z` または `±hh:mm` で終わる）。 */
const OFFSET_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** オフセットなし ISO 8601（壁時計として解釈する。秒・小数秒は省略可）。 */
const LOCAL_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/;

/**
 * 年月日が暦上実在するかを検証する。
 *
 * `Date` の setter による正規化（例: 2/30 → 3/2）を利用し、
 * 設定後の成分が入力と一致するかで判定する。
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  // 0〜99 年が 1900 年代に解釈されるのを避けるため、Date.UTC ではなく setter を使う
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 実行環境のローカルタイムゾーン ID を返す。
 *
 * @returns IANA タイムゾーン ID（例: `'Asia/Tokyo'`）
 */
export function getLocalTimeZone(): TimeZoneId {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * 文字列が有効な IANA タイムゾーン ID かどうかを判定する。
 *
 * @param timeZone - 検証する文字列
 * @returns 有効なら `true`
 * @example
 * ```ts
 * isValidTimeZone('Asia/Tokyo'); // => true
 * isValidTimeZone('Invalid/Zone'); // => false
 * ```
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 絶対時刻を、指定タイムゾーンにおける壁時計の成分に分解する。
 *
 * @param date - 絶対時刻
 * @param timeZone - タイムゾーン
 * @returns 壁時計成分（`month` は 1〜12）
 */
export function getWallClock(date: Date, timeZone: TimeZoneId): Required<WallClockParts> {
  const zoned = new TZDate(date.getTime(), timeZone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hours: zoned.getHours(),
    minutes: zoned.getMinutes(),
    seconds: zoned.getSeconds(),
  };
}

/**
 * 壁時計成分から絶対時刻を構築する。
 *
 * DST の切り替えで存在しない時刻が指定された場合は前方（後の時刻）に解決し、
 * 曖昧な時刻（2 回現れる時刻）は早い方のオフセットで解決する。
 *
 * @param parts - 壁時計成分
 * @param timeZone - タイムゾーン
 * @returns 対応する絶対時刻
 * @example
 * ```ts
 * // Asia/Tokyo の 2026-07-01 10:00 → 2026-07-01T01:00:00.000Z
 * fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, 'Asia/Tokyo');
 * ```
 */
export function fromWallClock(parts: WallClockParts, timeZone: TimeZoneId): Date {
  const { year, month, day, hours = 0, minutes = 0, seconds = 0 } = parts;
  const zoned = new TZDate(year, month - 1, day, hours, minutes, seconds, 0, timeZone);
  return new Date(zoned.getTime());
}

/**
 * 指定タイムゾーンにおける、その日の 0:00 の絶対時刻を返す。
 *
 * @param date - 基準となる絶対時刻
 * @param timeZone - タイムゾーン
 */
export function startOfDayInZone(date: Date, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  return fromWallClock({ year: wall.year, month: wall.month, day: wall.day }, timeZone);
}

/**
 * 指定タイムゾーンの壁時計基準で日数を加算する。
 *
 * DST を跨いでも壁時計時刻が維持される（例: 9:00 の予定は加算後も 9:00）。
 *
 * @param date - 基準となる絶対時刻
 * @param amount - 加算する日数（負数で減算）
 * @param timeZone - タイムゾーン
 */
export function addDaysInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  // TZDate に対する date-fns の addDays は指定 TZ の壁時計を維持して日を進める
  const zoned = addDays(new TZDate(date.getTime(), timeZone), amount);
  return new Date(zoned.getTime());
}

/**
 * 指定タイムゾーンの壁時計基準で分数を加算する。
 *
 * 単純な絶対時刻への加算ではなく壁時計に対する加算のため、
 * DST 跨ぎでは絶対時刻の差が指定分数と異なる場合がある。
 * 加算結果が存在しない時刻になる場合は前方に、曖昧な時刻になる場合は
 * 早い方のオフセットで解決される（{@link fromWallClock} と同じ規則）。
 *
 * @param date - 基準となる絶対時刻
 * @param amount - 加算する分数（負数で減算）
 * @param timeZone - タイムゾーン
 */
export function addMinutesInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  // 壁時計成分をオフセットのない UTC 上の日時として組み立ててから分を加算し、
  // 日・月・年への繰り上がり/繰り下がりを Date の正規化に任せる
  const shifted = new Date(0);
  shifted.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  shifted.setUTCHours(wall.hours, wall.minutes + amount, wall.seconds, 0);
  return fromWallClock(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hours: shifted.getUTCHours(),
      minutes: shifted.getUTCMinutes(),
      seconds: shifted.getUTCSeconds(),
    },
    timeZone,
  );
}

/**
 * 指定タイムゾーンにおける `'YYYY-MM-DD'` 形式の日付キーを返す。
 *
 * @param date - 絶対時刻
 * @param timeZone - タイムゾーン
 * @example
 * ```ts
 * // UTC の 2026-06-30T20:00Z は東京では 7/1
 * dateKeyInZone(new Date('2026-06-30T20:00:00Z'), 'Asia/Tokyo'); // => '2026-07-01'
 * ```
 */
export function dateKeyInZone(date: Date, timeZone: TimeZoneId): string {
  const wall = getWallClock(date, timeZone);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/**
 * `'YYYY-MM-DD'` 形式の日付キーから、指定タイムゾーンにおける
 * その日の 0:00 の絶対時刻を返す。
 *
 * @param key - `'YYYY-MM-DD'` 形式の日付キー
 * @param timeZone - タイムゾーン
 * @throws 形式が不正な場合、または暦上存在しない日付の場合は `Error`
 */
export function dateFromKey(key: string, timeZone: TimeZoneId): Date {
  const match = DATE_KEY_PATTERN.exec(key);
  if (match === null) {
    throw new Error(`日付キーの形式が不正です（'YYYY-MM-DD' 形式が必要）: '${key}'`);
  }
  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw new Error(`日付キーの形式が不正です（'YYYY-MM-DD' 形式が必要）: '${key}'`);
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isRealCalendarDate(year, month, day)) {
    throw new Error(`暦上存在しない日付です: '${key}'`);
  }
  return fromWallClock({ year, month, day }, timeZone);
}

/**
 * 指定タイムゾーンにおける、その日の 0:00 からの経過分（壁時計）を返す。
 *
 * @param date - 絶対時刻
 * @param timeZone - タイムゾーン
 * @returns 0〜1439 の分数
 */
export function minutesOfDayInZone(date: Date, timeZone: TimeZoneId): number {
  const wall = getWallClock(date, timeZone);
  return wall.hours * 60 + wall.minutes;
}

/**
 * 2 つの絶対時刻が、指定タイムゾーンの壁時計基準で同じ日かどうかを判定する。
 */
export function isSameDayInZone(a: Date, b: Date, timeZone: TimeZoneId): boolean {
  return dateKeyInZone(a, timeZone) === dateKeyInZone(b, timeZone);
}

/**
 * 指定タイムゾーンにおける曜日を返す。
 *
 * @returns 0 = 日曜日、…、6 = 土曜日
 */
export function weekdayInZone(date: Date, timeZone: TimeZoneId): Weekday {
  const day = new TZDate(date.getTime(), timeZone).getDay();
  switch (day) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return day;
    default:
      // Date#getDay は常に 0〜6 を返すため、ここには到達しない
      throw new Error(`曜日の値が不正です: ${day}`);
  }
}

/**
 * イベントの `start` / `end` に指定された値を絶対時刻に解釈する。
 *
 * 解釈ルール:
 * - `Date` — そのまま絶対時刻として扱う（`allDay` の場合は `timeZone` における
 *   その日の 0:00 に切り捨てる）
 * - `'YYYY-MM-DD'` — `timeZone` におけるその日の 0:00
 * - オフセット付き ISO 8601（`Z` や `+09:00`）— 記載どおりの絶対時刻
 *   （`allDay` の場合はさらに 0:00 に切り捨てる）
 * - オフセットなし ISO 8601（例: `'2026-07-01T10:00'`）— `timeZone` の壁時計として解釈
 *
 * @param value - 日時の値
 * @param timeZone - 解釈に使うタイムゾーン（イベント TZ、なければ表示 TZ）
 * @param allDay - 終日イベントかどうか
 * @throws 解釈できない文字列の場合は `Error`
 */
export function parseDateValue(value: Date | string, timeZone: TimeZoneId, allDay: boolean): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('無効な Date が指定されました');
    }
    return allDay ? startOfDayInZone(value, timeZone) : new Date(value.getTime());
  }

  // 'YYYY-MM-DD' — timeZone におけるその日の 0:00
  if (DATE_KEY_PATTERN.test(value)) {
    return dateFromKey(value, timeZone);
  }

  // オフセット付き ISO 8601 — 記載どおりの絶対時刻
  if (OFFSET_ISO_PATTERN.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`日時として解釈できない値です: '${value}'`);
    }
    return allDay ? startOfDayInZone(parsed, timeZone) : parsed;
  }

  // オフセットなし ISO 8601 — timeZone の壁時計として解釈
  const local = LOCAL_ISO_PATTERN.exec(value);
  if (local !== null) {
    const [, yearText, monthText, dayText, hoursText, minutesText, secondsText] = local;
    if (
      yearText === undefined ||
      monthText === undefined ||
      dayText === undefined ||
      hoursText === undefined ||
      minutesText === undefined
    ) {
      throw new Error(`日時として解釈できない値です: '${value}'`);
    }
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    const seconds = secondsText === undefined ? 0 : Number(secondsText);
    if (!isRealCalendarDate(year, month, day) || hours > 23 || minutes > 59 || seconds > 59) {
      throw new Error(`日時として解釈できない値です: '${value}'`);
    }
    const instant = fromWallClock({ year, month, day, hours, minutes, seconds }, timeZone);
    return allDay ? startOfDayInZone(instant, timeZone) : instant;
  }

  throw new Error(`日時として解釈できない値です: '${value}'`);
}

/**
 * その日の 0:00 からの分数を `'HH:mm'` 形式のラベルにする。
 *
 * @param minutes - 0〜1439 の分数
 * @example
 * ```ts
 * formatSlotLabel(540); // => '09:00'
 * ```
 */
export function formatSlotLabel(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}
