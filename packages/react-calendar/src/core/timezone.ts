/**
 * @packageDocumentation
 * タイムゾーンユーティリティ。
 *
 * タイムゾーン依存の日時計算はすべてこのモジュールを経由して行う。
 * 内部的には date-fns v4 と `@date-fns/tz` の {@link TZDate} を利用する。
 *
 * 「絶対時刻（時点）」= `Date` が指す UTC 時点。
 * 「現地時刻（wall clock）」= あるタイムゾーンで時計が示す年月日・時分。
 */

import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';
import type { TimeZoneId, Weekday } from './types';

/**
 * 現地時刻の成分表現。
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
  /** ミリ秒（0〜999）。既定は 0。 */
  milliseconds?: number;
}

/** `'YYYY-MM-DD'` 形式の日付キー。 */
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** オフセット付き ISO 8601（`Z` または `±hh:mm` で終わる）。 */
const OFFSET_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** オフセットなし ISO 8601（現地時刻として解釈する。秒・小数秒は省略可）。 */
const LOCAL_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?$/;

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
 * ISO 8601 の小数秒部分（先頭の `.` を含む文字列。例: `'.123456'`）を
 * ミリ秒（0〜999）に変換する。3 桁を超える分は切り捨てる。
 */
function millisecondsFromFraction(fractionText: string | undefined): number {
  if (fractionText === undefined) {
    return 0;
  }
  const digits = fractionText.slice(1, 4).padEnd(3, '0');
  return Number(digits);
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
 * 絶対時刻を、指定タイムゾーンにおける現地時刻の成分に分解する。
 *
 * @param date - 絶対時刻
 * @param timeZone - タイムゾーン
 * @returns 現地時刻の成分（`month` は 1〜12）
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
    milliseconds: zoned.getMilliseconds(),
  };
}

/** 1 日のミリ秒数。 */
const DAY_IN_MS = 86_400_000;

/**
 * 現地時刻の成分を、オフセットのない UTC 上のミリ秒として組み立てる。
 *
 * 実際の絶対時刻ではなく「現地時刻の成分同士の比較・差分」のための暦演算専用
 * （{@link fromWallClock} の曖昧な時刻の判定に使う）。2 桁年の誤変換を避けるため
 * `Date.UTC` ではなく setter で組み立てる（{@link isRealCalendarDate} と同じ理由）。
 */
function wallClockAsUtcMs(wall: Required<WallClockParts>): number {
  const probe = new Date(0);
  probe.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  probe.setUTCHours(wall.hours, wall.minutes, wall.seconds, wall.milliseconds);
  return probe.getTime();
}

/**
 * 現地時刻の成分から絶対時刻を構築する。
 *
 * DST の切り替えで存在しない時刻が指定された場合は、`disambiguation` に関わらず
 * 直後の実在時刻に繰り上げて解決する。曖昧な時刻（秋の巻き戻りで 2 回現れる時刻）は
 * `disambiguation` に従って解決する。
 *
 * @param parts - 現地時刻の成分
 * @param timeZone - タイムゾーン
 * @param disambiguation - 曖昧な時刻の解決方法。`'earlier'`（既定）は早い方の
 *   オフセット（切替前）、`'later'` は遅い方のオフセット（切替後）で解決する
 * @returns 対応する絶対時刻
 * @example
 * ```ts
 * // Asia/Tokyo の 2026-07-01 10:00 → 2026-07-01T01:00:00.000Z
 * fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, 'Asia/Tokyo');
 * // America/New_York の 2026-11-01 01:30 は 2 回現れる（EDT → EST の巻き戻り）
 * fromWallClock({ year: 2026, month: 11, day: 1, hours: 1, minutes: 30 }, 'America/New_York');
 * // => 2026-11-01T05:30:00.000Z（早い方、EDT）
 * fromWallClock({ year: 2026, month: 11, day: 1, hours: 1, minutes: 30 }, 'America/New_York', 'later');
 * // => 2026-11-01T06:30:00.000Z（遅い方、EST）
 * ```
 */
export function fromWallClock(
  parts: WallClockParts,
  timeZone: TimeZoneId,
  disambiguation: 'earlier' | 'later' = 'earlier',
): Date {
  const { year, month, day, hours = 0, minutes = 0, seconds = 0, milliseconds = 0 } = parts;
  // TZDate の数値引数コンストラクタは Date コンストラクタの 2 桁年マッピング
  // （0〜99 年を 1900〜1999 年とみなす）をそのまま引き継いでしまう。
  // isRealCalendarDate と同様に setter 経由で組み立てることでこれを回避する。
  const zoned = TZDate.tz(timeZone);
  zoned.setFullYear(year, month - 1, day);
  zoned.setHours(hours, minutes, seconds, milliseconds);
  const earlier = new Date(zoned.getTime());
  if (disambiguation === 'earlier') {
    return earlier;
  }
  // 'later': 同じ現地時刻が切替後のオフセットでも実在するかを検証する。
  // 曖昧な時刻の 2 回目は必ず切替後のオフセットで現れるため、切替を確実に
  // 越えている 24 時間後のオフセット（隣接する切替は数か月離れているため、
  // 24 時間以内に 2 度目の切替はない）で候補の絶対時刻を逆算し、往復して
  // 現地時刻が一致する場合のみ採用する（一致しなければ曖昧な時刻ではないので
  // 'earlier' と同じ解決になる。不正なタイムゾーンでは NaN 比較が成立せず、
  // 'earlier' と同じ Invalid Date を返す）
  const wallMs = wallClockAsUtcMs(getWallClock(earlier, timeZone));
  const probeInstant = earlier.getTime() + DAY_IN_MS;
  const laterOffsetMs =
    wallClockAsUtcMs(getWallClock(new Date(probeInstant), timeZone)) - probeInstant;
  const candidate = new Date(wallMs - laterOffsetMs);
  if (
    candidate.getTime() > earlier.getTime() &&
    wallClockAsUtcMs(getWallClock(candidate, timeZone)) === wallMs
  ) {
    return candidate;
  }
  return earlier;
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
 * 指定タイムゾーンの現地時刻基準で日数を加算する。
 *
 * DST を跨いでも現地時刻が維持される（例: 9:00 の予定は加算後も 9:00）。
 *
 * @param date - 基準となる絶対時刻
 * @param amount - 加算する日数（負数で減算）
 * @param timeZone - タイムゾーン
 */
export function addDaysInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  // TZDate に対する date-fns の addDays は指定 TZ の現地時刻を維持して日を進める
  const zoned = addDays(new TZDate(date.getTime(), timeZone), amount);
  return new Date(zoned.getTime());
}

/**
 * 指定タイムゾーンの現地時刻基準で分数を加算する。
 *
 * 単純な絶対時刻への加算ではなく現地時刻に対する加算のため、
 * DST 跨ぎでは絶対時刻の差が指定分数と異なる場合がある。
 * 加算結果が存在しない時刻になる場合は繰り上げて、曖昧な時刻になる場合は
 * 早い方のオフセットで解決される（{@link fromWallClock} と同じ規則）。
 *
 * @param date - 基準となる絶対時刻
 * @param amount - 加算する分数（負数で減算）
 * @param timeZone - タイムゾーン
 */
export function addMinutesInZone(date: Date, amount: number, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  // 現地時刻の成分をオフセットのない UTC 上の日時として組み立ててから分を加算し、
  // 日・月・年への繰り上がり/繰り下がりを Date の正規化に任せる
  // （ミリ秒も保持し、加算前後で恒等性が保たれるようにする）
  const shifted = new Date(0);
  shifted.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  shifted.setUTCHours(wall.hours, wall.minutes + amount, wall.seconds, wall.milliseconds);
  return fromWallClock(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hours: shifted.getUTCHours(),
      minutes: shifted.getUTCMinutes(),
      seconds: shifted.getUTCSeconds(),
      milliseconds: shifted.getUTCMilliseconds(),
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
 * 指定タイムゾーンにおける、その日の 0:00 からの経過分（現地時刻基準）を返す。
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
 * 2 つの絶対時刻が、指定タイムゾーンの現地時刻基準で同じ日かどうかを判定する。
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
 * - オフセットなし ISO 8601（例: `'2026-07-01T10:00'`）— `timeZone` の現地時刻として解釈
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

  // オフセットなし ISO 8601 — timeZone の現地時刻として解釈
  const local = LOCAL_ISO_PATTERN.exec(value);
  if (local !== null) {
    const [, yearText, monthText, dayText, hoursText, minutesText, secondsText, fractionText] =
      local;
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
    const milliseconds = millisecondsFromFraction(fractionText);
    if (!isRealCalendarDate(year, month, day) || hours > 23 || minutes > 59 || seconds > 59) {
      throw new Error(`日時として解釈できない値です: '${value}'`);
    }
    const instant = fromWallClock(
      { year, month, day, hours, minutes, seconds, milliseconds },
      timeZone,
    );
    return allDay ? startOfDayInZone(instant, timeZone) : instant;
  }

  throw new Error(`日時として解釈できない値です: '${value}'`);
}

/**
 * {@link formatSlotLabel} が使う `Intl.DateTimeFormat` インスタンスのキャッシュ。
 * ロケールごとに 1 つだけ生成して使い回す（生成コストのある `Intl.DateTimeFormat` を
 * スロットの数だけ毎回 `new` しないため）。
 */
const slotLabelFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * `formatSlotLabel` 用の `Intl.DateTimeFormat` をロケールごとにキャッシュして返す。
 */
function getSlotLabelFormatter(locale: string): Intl.DateTimeFormat {
  const cached = slotLabelFormatterCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    // 実行環境のローカル TZ の影響を受けないよう、日付部分を固定した「架空の UTC 時刻」
    // として整形する（時刻の大小関係のみが意味を持つ値のため、実際の年月日は無関係）。
    timeZone: 'UTC',
  });
  slotLabelFormatterCache.set(locale, formatter);
  return formatter;
}

/**
 * その日の 0:00 からの分数を、ロケールに応じた時刻ラベルにする。
 *
 * @param minutes - 0〜1439 の分数
 * @param locale - 整形に使うロケール（例: `'ja'`、`'en-US'`）
 * @example
 * ```ts
 * formatSlotLabel(540, 'ja'); // => '09:00'
 * formatSlotLabel(540, 'en-US'); // => '09:00 AM'
 * ```
 */
export function formatSlotLabel(minutes: number, locale: string): string {
  const fakeUtcDate = new Date(Date.UTC(2000, 0, 1, 0, 0) + minutes * 60_000);
  return getSlotLabelFormatter(locale).format(fakeUtcDate);
}

/**
 * 指定タイムゾーンにおける ISO 8601 週番号を返す。
 *
 * ISO 8601 は月曜始まりで週を数え、その週の木曜日が属する年を「ISO 週年」とする
 * （年始・年末の数日は、暦上の年と ISO 週年がずれることがある）。
 * ホスト実行環境のローカルタイムゾーンに依存しないよう、現地時刻の年月日成分だけを
 * 取り出し、`Date.UTC` 上の値として演算する（{@link fromWallClock} の 2 桁年対策と
 * 同様、実際の絶対時刻ではなく年月日の暦演算にのみ使う）。
 *
 * @param date - 絶対時刻
 * @param timeZone - タイムゾーン
 * @returns ISO 8601 週番号（1〜53）
 * @example
 * ```ts
 * // 2026-01-01（UTC）は木曜日で、2026 年第 1 週に属する
 * isoWeekNumberInZone(new Date('2026-01-01T00:00:00Z'), 'UTC'); // => 1
 * ```
 */
export function isoWeekNumberInZone(date: Date, timeZone: TimeZoneId): number {
  const wall = getWallClock(date, timeZone);
  const asUtcDate = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  // ISO 8601 の曜日（月=0, 火=1, …, 日=6）。Date#getUTCDay は日曜=0 始まりのため変換する
  const isoWeekday = (asUtcDate.getUTCDay() + 6) % 7;
  // その週の木曜日（ISO 週番号は木曜日が属する年で数える）
  const thursday = new Date(asUtcDate.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + (3 - isoWeekday));
  const isoYearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const daysSinceIsoYearStart = Math.round((thursday.getTime() - isoYearStart) / 86_400_000);
  return Math.floor(daysSinceIsoYearStart / 7) + 1;
}

/** `'HH:mm'` 形式（0 埋め 2 桁の時・分）にマッチする正規表現。 */
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `'HH:mm'` 形式の時刻文字列を、その日の 0:00 からの分（0〜1439）に変換する。
 * {@link formatSlotLabel} の逆変換にあたる。
 *
 * @param time - `'HH:mm'` 形式の時刻文字列（例: `'09:00'`）
 * @returns 0〜1439 の分数
 * @throws 形式が不正な場合は `Error`
 * @example
 * ```ts
 * parseTimeOfDay('09:00'); // => 540
 * ```
 */
export function parseTimeOfDay(time: string): number {
  const match = TIME_OF_DAY_PATTERN.exec(time);
  if (match === null) {
    throw new Error(`時刻として解釈できない値です（'HH:mm' 形式が必要）: '${time}'`);
  }
  const [, hoursText, minutesText] = match;
  if (hoursText === undefined || minutesText === undefined) {
    throw new Error(`時刻として解釈できない値です（'HH:mm' 形式が必要）: '${time}'`);
  }
  return Number(hoursText) * 60 + Number(minutesText);
}

/**
 * `'HH:mm'` 形式の時刻文字列を、日内の時間帯の境界（{@link CalendarOptions.slotMinTime} /
 * {@link CalendarOptions.slotMaxTime} や {@link BusinessHoursRule.endTime}）用に
 * 分（0〜1440）へ変換する。
 *
 * `'24:00'` のみ特例として `1440` を返す（{@link parseTimeOfDay} は日内の時刻専用のため
 * `'24:00'` を無効な時刻として `Error` にするが、排他的な終了境界は日の終端
 * `'24:00'` を指定できる必要がある）。それ以外の値は {@link parseTimeOfDay} に委譲する。
 *
 * @param time - `'HH:mm'` 形式の時刻文字列（例: `'09:00'`、`'24:00'`）
 * @returns 0〜1440 の分数
 * @throws 形式が不正な場合は `Error`
 * @example
 * ```ts
 * parseSlotBoundaryTime('24:00'); // => 1440
 * parseSlotBoundaryTime('09:00'); // => 540
 * ```
 */
export function parseSlotBoundaryTime(time: string): number {
  if (time === '24:00') {
    return 1440;
  }
  return parseTimeOfDay(time);
}
