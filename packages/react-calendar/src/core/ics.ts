/**
 * @packageDocumentation
 * iCalendar（RFC 5545、ICS）入出力。
 *
 * {@link CalendarEvent} の配列と iCalendar 文字列（VCALENDAR / VEVENT）を相互変換する。
 * 行の折り返し（75 オクテット）と TEXT 値のエスケープは RFC 5545 に従う。
 *
 * ## 日時の表現の対応
 *
 * | Koyomi 側 | iCalendar 側 |
 * | --- | --- |
 * | 終日イベント（`allDay: true`） | `DTSTART;VALUE=DATE` / `DTEND;VALUE=DATE`（`end` 排他） |
 * | `timeZone` のあるイベント | `DTSTART;TZID=...:現地時刻` |
 * | `timeZone` がなくオフセットなし文字列 | フローティング（TZID も `Z` もない現地時刻） |
 * | それ以外（`Date` / オフセット付き文字列） | UTC（末尾 `Z`） |
 *
 * 繰り返しは `rrule` → `RRULE`、`exdates` → `EXDATE`、`rdates` → `RDATE`、
 * オーバーライド（`recurringEventId` + `originalStart`）→ マスターと同じ `UID` +
 * `RECURRENCE-ID` として表現する。取り込み時の `RECURRENCE-ID;RANGE=THISANDFUTURE` は
 * 「これ以降」のシリーズ分割になる。対応範囲・非対応構文の扱いの詳細は docs/ics.md を参照。
 */

import { deleteEventIn, updateEventIn } from './mutations';
import { normalizeRRuleString } from './recurrence';
import {
  addDaysInZone,
  dateFromKey,
  dateKeyInZone,
  fromWallClock,
  getLocalTimeZone,
  getWallClock,
  isValidTimeZone,
  parseDateValue,
  type WallClockParts,
} from './timezone';
import type { CalendarEvent, CalendarEventPatch, EventId, TimeZoneId } from './types';

/** iCalendar の行区切り（RFC 5545）。 */
const CRLF = '\r\n';

/** 1 行の最大オクテット数（RFC 5545。改行は含まない）。 */
const MAX_LINE_OCTETS = 75;

/** 既定の PRODID。 */
const DEFAULT_PROD_ID = '-//koyomi-cal//react-calendar//JA';

/** 折り返し計算（UTF-8 オクテット数）に使うエンコーダ。 */
const utf8Encoder = new TextEncoder();

/** iCalendar の DATE 値（`YYYYMMDD`）。 */
const DATE_DIGITS_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

/** iCalendar の DATE-TIME 値（`YYYYMMDDTHHMMSS`、UTC は末尾 `Z`）。 */
const DATE_TIME_DIGITS_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** オフセットなし ISO 8601（`timeZone` 未指定なら現地時刻＝フローティングとして扱う文字列）。 */
const LOCAL_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

/** RRULE 文字列内の UNTIL 値。 */
const UNTIL_PATTERN = /(^|;)UNTIL=([0-9TZ]+)/;

/**
 * {@link eventsToIcs} のオプション。
 */
export interface EventsToIcsOptions {
  /**
   * `timeZone` を持たないイベントの `start` / `end` / `exdates` / `rdates` の解釈に
   * 用いるタイムゾーン（カレンダーの表示タイムゾーンに相当）。
   * 省略時は実行環境のローカルタイムゾーン。
   */
  timeZone?: TimeZoneId;
  /**
   * `end` 省略時の時間指定イベントの長さ（分）。DTEND の算出に使う。既定は `60`
   * （{@link ResolvedCalendarOptions.defaultEventMinutes} の既定値と同じ）。
   */
  defaultEventMinutes?: number;
  /**
   * 各 VEVENT の `DTSTAMP` に書き込む時刻。省略時は現在時刻。
   * 出力を決定的にしたい場合（テスト・差分比較）に固定値を渡す。
   */
  dtstamp?: Date;
  /** `PRODID` の値。省略時は Koyomi 自身を表す既定値。 */
  prodId?: string;
}

/**
 * {@link eventsFromIcs} / {@link eventsFromIcsWithIssues} のオプション。
 */
export interface EventsFromIcsOptions {
  /**
   * `TZID` を持たない日時の解釈に用いるタイムゾーン（カレンダーの表示タイムゾーンに
   * 相当）。UTC 形式の `DTSTART` を持つ VEVENT の `UNTIL` の変換と、フローティング・
   * 終日のシリーズ分割点（`RECURRENCE-ID;RANGE=THISANDFUTURE`）の解釈に使う。
   * {@link eventsToIcs} の `timeZone` と同じ値を渡すと往復変換が対称になる。
   * 省略時は実行環境のローカルタイムゾーン。
   */
  timeZone?: TimeZoneId;
}

// ---------------------------------------------------------------------------
// 共通: 書式・エスケープ・折り返し
// ---------------------------------------------------------------------------

/** 指定桁数のゼロ埋め。 */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** 現地時刻の成分を iCalendar の DATE-TIME 値（`YYYYMMDDTHHMMSS`）にする。 */
function formatWallDigits(wall: Required<WallClockParts>): string {
  return `${pad(wall.year, 4)}${pad(wall.month, 2)}${pad(wall.day, 2)}T${pad(wall.hours, 2)}${pad(
    wall.minutes,
    2,
  )}${pad(wall.seconds, 2)}`;
}

/** `'YYYY-MM-DD'` の日付キーを iCalendar の DATE 値（`YYYYMMDD`）にする。 */
function formatDateDigits(key: string): string {
  return key.replaceAll('-', '');
}

/** 絶対時刻を iCalendar の UTC 表記（`YYYYMMDDTHHMMSSZ`）にする。 */
function formatUtcDigits(instant: Date): string {
  return `${formatWallDigits(getWallClock(instant, 'UTC'))}Z`;
}

/**
 * TEXT 値をエスケープする（RFC 5545 §3.3.11）。
 * `\` → `\\`、`;` → `\;`、`,` → `\,`、改行 → `\n`。
 */
function escapeTextValue(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** エスケープされた TEXT 値を復元する（{@link escapeTextValue} の逆変換）。 */
function unescapeTextValue(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    const next = text[i + 1];
    if (ch === '\\' && next !== undefined) {
      if (next === 'n' || next === 'N') {
        result += '\n';
        i += 2;
        continue;
      }
      if (next === '\\' || next === ';' || next === ',') {
        result += next;
        i += 2;
        continue;
      }
    }
    result += ch;
    i += 1;
  }
  return result;
}

/**
 * 75 オクテットを超えるコンテンツ行を折り返す（RFC 5545 §3.1）。
 * 継続行は先頭のスペース 1 つを含めて 75 オクテット以内にし、
 * マルチバイト文字（UTF-8）の途中では分断しない。
 */
function foldContentLine(line: string): string {
  const folded: string[] = [];
  let current = '';
  let currentOctets = 0;
  for (const ch of line) {
    const octets = utf8Encoder.encode(ch).length;
    if (currentOctets + octets > MAX_LINE_OCTETS) {
      folded.push(current);
      current = ` ${ch}`;
      currentOctets = 1 + octets;
    } else {
      current += ch;
      currentOctets += octets;
    }
  }
  folded.push(current);
  return folded.join(CRLF);
}

/** RRULE 文字列内の UNTIL 値だけを変換する（UNTIL がなければそのまま返す）。 */
function replaceUntilValue(rrule: string, convert: (value: string) => string): string {
  return rrule.replace(
    UNTIL_PATTERN,
    (_match, prefix: string, value: string) => `${prefix}UNTIL=${convert(value)}`,
  );
}

/**
 * UNTIL の DATE-TIME 値（`YYYYMMDDTHHMMSS[Z]`）を現地時刻の成分にする。
 *
 * {@link normalizeRRuleString} を通した RRULE の UNTIL は常にこの形式になるため、
 * 呼び出し側でその前提が保証されていることを条件に、桁位置の切り出しだけで変換する。
 */
function wallPartsFromUntilDigits(value: string): Required<WallClockParts> {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(4, 6)),
    day: Number(value.slice(6, 8)),
    hours: Number(value.slice(9, 11)),
    minutes: Number(value.slice(11, 13)),
    seconds: Number(value.slice(13, 15)),
    milliseconds: 0,
  };
}

// ---------------------------------------------------------------------------
// エクスポート（CalendarEvent[] → ICS）
// ---------------------------------------------------------------------------

/** 時間指定の日時値の出力形式。 */
type TimedValueStyle = { kind: 'zoned'; tzid: TimeZoneId } | { kind: 'utc' } | { kind: 'floating' };

/**
 * 日時値の出力形式を決める。イベントに TZID があれば TZID 付きの現地時刻、
 * なければ「オフセットなし文字列はフローティング、それ以外は UTC」。
 */
function timedStyleFor(value: Date | string, tzid: TimeZoneId | undefined): TimedValueStyle {
  if (tzid !== undefined) {
    return { kind: 'zoned', tzid };
  }
  if (typeof value === 'string' && LOCAL_ISO_PATTERN.test(value)) {
    return { kind: 'floating' };
  }
  return { kind: 'utc' };
}

/** 絶対時刻を出力形式に従ってプロパティ行（`NAME[;TZID=...]:値`）にする。 */
function formatTimedProperty(
  name: string,
  instant: Date,
  style: TimedValueStyle,
  fallbackTimeZone: TimeZoneId,
): string {
  switch (style.kind) {
    case 'zoned':
      return `${name};TZID=${style.tzid}:${formatWallDigits(getWallClock(instant, style.tzid))}`;
    case 'floating':
      return `${name}:${formatWallDigits(getWallClock(instant, fallbackTimeZone))}`;
    case 'utc':
      return `${name}:${formatUtcDigits(instant)}`;
  }
}

/** 日付キーに日数を加算した日付キーを返す（DST のない UTC 空間で演算）。 */
function addDaysToDateKey(key: string, amount: number): string {
  return dateKeyInZone(addDaysInZone(dateFromKey(key, 'UTC'), amount, 'UTC'), 'UTC');
}

/**
 * RRULE の UNTIL を出力用に変換する。
 *
 * Koyomi の rrule 文字列の UNTIL はイベント TZ（`timeZone` のないイベントは
 * 表示 TZ = `fallbackTimeZone`）の現地時刻を表す。RFC 5545 §3.3.10 は UNTIL の型を
 * DTSTART と揃えることを要求するため、DTSTART の出力形式に合わせて変換する:
 *
 * - 終日イベント: 日付形式（`YYYYMMDD`）に切り詰める
 * - フローティング: DTSTART と同じ現地時刻形式（`Z` なし）にする
 * - TZID 付き / UTC: 解釈に用いたタイムゾーンの現地時刻から UTC 表記へ変換する
 */
function untilForExport(
  normalizedRRule: string,
  allDay: boolean,
  startStyle: TimedValueStyle,
  fallbackTimeZone: TimeZoneId,
): string {
  return replaceUntilValue(normalizedRRule, (value) => {
    if (allDay) {
      return value.slice(0, 8);
    }
    if (startStyle.kind === 'floating') {
      // 正規化済みの UNTIL は常に末尾 Z 付きのため、Z を除いて現地時刻形式にする
      return value.endsWith('Z') ? value.slice(0, -1) : value;
    }
    const timeZone = startStyle.kind === 'zoned' ? startStyle.tzid : fallbackTimeZone;
    return formatUtcDigits(fromWallClock(wallPartsFromUntilDigits(value), timeZone));
  });
}

/**
 * RRULE の UNTIL を取り込み用に変換する（{@link untilForExport} の逆変換）。
 *
 * UTC 表記の UNTIL を、Koyomi の rrule 文字列の解釈（イベント TZ の現地時刻。
 * `timeZone` のないイベントは表示 TZ の現地時刻）に合わせて DTSTART の形式ごとに変換する:
 *
 * - 終日イベント（DATE 形式の DTSTART）: 日付形式へ切り詰める
 * - フローティングの DTSTART: UNTIL も現地時刻を表すため数字をそのまま使う
 * - TZID 付きの DTSTART: UTC 表記からイベント TZ の現地時刻へ変換する
 * - UTC 形式の DTSTART: UTC 表記から表示タイムゾーン（`displayTimeZone`）の
 *   現地時刻へ変換する
 */
function untilForImport(
  normalizedRRule: string,
  dtstart: IcsDateValue,
  displayTimeZone: TimeZoneId,
): string {
  return replaceUntilValue(normalizedRRule, (value) => {
    if (dtstart.type === 'date') {
      return value.slice(0, 8);
    }
    if (dtstart.type === 'floating' || !value.endsWith('Z')) {
      return value;
    }
    const timeZone = dtstart.type === 'zoned' ? dtstart.tzid : displayTimeZone;
    // UTC 表記の成分から絶対時刻を組み立て、現地時刻へ変換する
    const instant = fromWallClock(wallPartsFromUntilDigits(value), 'UTC');
    return `${formatWallDigits(getWallClock(instant, timeZone))}Z`;
  });
}

/** VEVENT 1 件のシリアライズに使う文脈。 */
interface SerializeContext {
  /** `id` → イベント（オーバーライドからマスターを引くため）。 */
  eventsById: ReadonlyMap<string, CalendarEvent>;
  /** `timeZone` を持たないイベントの解釈に用いるタイムゾーン。 */
  fallbackTimeZone: TimeZoneId;
  /** `end` 省略時の長さ（分）。 */
  defaultEventMinutes: number;
  /** 全 VEVENT 共通の DTSTAMP 行。 */
  dtstampLine: string;
}

/**
 * exdates / rdates を EXDATE / RDATE 行にして追加する。
 * 同じ出力形式の値は 1 プロパティにカンマ結合する。
 */
function pushDateListProperties(
  lines: string[],
  name: 'EXDATE' | 'RDATE',
  values: readonly (Date | string)[] | undefined,
  params: {
    allDay: boolean;
    tzid: TimeZoneId | undefined;
    interpretTimeZone: TimeZoneId;
    fallbackTimeZone: TimeZoneId;
  },
): void {
  if (values === undefined || values.length === 0) {
    return;
  }
  const { allDay, tzid, interpretTimeZone, fallbackTimeZone } = params;
  if (allDay) {
    const digits = values.map((value) =>
      formatDateDigits(
        dateKeyInZone(parseDateValue(value, interpretTimeZone, true), interpretTimeZone),
      ),
    );
    lines.push(`${name};VALUE=DATE:${digits.join(',')}`);
    return;
  }
  const zoned: string[] = [];
  const floating: string[] = [];
  const utc: string[] = [];
  for (const value of values) {
    const style = timedStyleFor(value, tzid);
    const instant = parseDateValue(value, interpretTimeZone, false);
    if (style.kind === 'zoned') {
      zoned.push(formatWallDigits(getWallClock(instant, style.tzid)));
    } else if (style.kind === 'floating') {
      floating.push(formatWallDigits(getWallClock(instant, fallbackTimeZone)));
    } else {
      utc.push(formatUtcDigits(instant));
    }
  }
  if (zoned.length > 0 && tzid !== undefined) {
    lines.push(`${name};TZID=${tzid}:${zoned.join(',')}`);
  }
  if (floating.length > 0) {
    lines.push(`${name}:${floating.join(',')}`);
  }
  if (utc.length > 0) {
    lines.push(`${name}:${utc.join(',')}`);
  }
}

/** 1 件のイベントを VEVENT の行配列（折り返し前）にする。 */
function serializeVEvent(event: CalendarEvent, ctx: SerializeContext): string[] {
  const master =
    event.recurringEventId !== undefined ? ctx.eventsById.get(event.recurringEventId) : undefined;
  const isOverride = event.recurringEventId !== undefined && event.originalStart !== undefined;
  const uid =
    isOverride && event.recurringEventId !== undefined ? event.recurringEventId : event.id;
  // オーバーライドが timeZone を省略した場合はマスターの timeZone を引き継ぐ
  // （展開時の「イベント TZ → マスター TZ → 表示 TZ」のフォールバックと同じ解釈）
  const tzid = event.timeZone ?? (isOverride ? master?.timeZone : undefined);
  if (tzid !== undefined && !isValidTimeZone(tzid)) {
    throw new Error(`無効なタイムゾーンです: '${tzid}'（イベント '${event.id}'）`);
  }
  const interpretTimeZone = tzid ?? ctx.fallbackTimeZone;
  const allDay = event.allDay === true;
  const startStyle = timedStyleFor(event.start, tzid);
  const lines = ['BEGIN:VEVENT', `UID:${escapeTextValue(uid)}`, ctx.dtstampLine];

  if (allDay) {
    const startKey = dateKeyInZone(
      parseDateValue(event.start, interpretTimeZone, true),
      interpretTimeZone,
    );
    const endKey =
      event.end !== undefined
        ? dateKeyInZone(parseDateValue(event.end, interpretTimeZone, true), interpretTimeZone)
        : addDaysToDateKey(startKey, 1);
    lines.push(
      `DTSTART;VALUE=DATE:${formatDateDigits(startKey)}`,
      `DTEND;VALUE=DATE:${formatDateDigits(endKey)}`,
    );
  } else {
    const startInstant = parseDateValue(event.start, interpretTimeZone, false);
    const endInstant =
      event.end !== undefined
        ? parseDateValue(event.end, interpretTimeZone, false)
        : new Date(startInstant.getTime() + ctx.defaultEventMinutes * 60_000);
    lines.push(
      formatTimedProperty('DTSTART', startInstant, startStyle, ctx.fallbackTimeZone),
      formatTimedProperty('DTEND', endInstant, startStyle, ctx.fallbackTimeZone),
    );
  }

  if (event.rrule !== undefined) {
    lines.push(
      `RRULE:${untilForExport(normalizeRRuleString(event.rrule), allDay, startStyle, ctx.fallbackTimeZone)}`,
    );
  }
  const listParams = {
    allDay,
    tzid,
    interpretTimeZone,
    fallbackTimeZone: ctx.fallbackTimeZone,
  };
  pushDateListProperties(lines, 'EXDATE', event.exdates, listParams);
  pushDateListProperties(lines, 'RDATE', event.rdates, listParams);

  if (isOverride && event.originalStart !== undefined) {
    const masterAllDay = master !== undefined ? master.allDay === true : allDay;
    if (masterAllDay) {
      const originalKey = dateKeyInZone(
        parseDateValue(event.originalStart, interpretTimeZone, true),
        interpretTimeZone,
      );
      lines.push(`RECURRENCE-ID;VALUE=DATE:${formatDateDigits(originalKey)}`);
    } else {
      lines.push(
        formatTimedProperty(
          'RECURRENCE-ID',
          parseDateValue(event.originalStart, interpretTimeZone, false),
          timedStyleFor(event.originalStart, tzid),
          ctx.fallbackTimeZone,
        ),
      );
    }
  }

  lines.push(`SUMMARY:${escapeTextValue(event.title)}`);
  if (event.location !== undefined) {
    lines.push(`LOCATION:${escapeTextValue(event.location)}`);
  }
  if (event.description !== undefined) {
    lines.push(`DESCRIPTION:${escapeTextValue(event.description)}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * イベントの配列を iCalendar（VCALENDAR/VEVENT）文字列にする。
 *
 * - 終日イベントは `VALUE=DATE`（`end` 排他のまま）で出力する
 * - `timeZone` のあるイベントは `TZID` パラメータ付きの現地時刻で出力する
 *   （`VTIMEZONE` 定義は出力せず、`TZID` は IANA タイムゾーン ID をそのまま使う）
 * - 繰り返しは `RRULE` / `EXDATE` / `RDATE`、オーバーライドはマスターと同じ `UID` +
 *   `RECURRENCE-ID` として出力する（オーバーライド自身の `id` は出力に含まれない）
 * - 75 オクテットを超える行は折り返し、TEXT 値はエスケープする（RFC 5545 準拠）
 * - `color` / `resourceId` / `extendedProps` などの表示・操作系フィールドは出力しない
 *
 * @param events - 出力するイベントの配列
 * @param options - 出力オプション（{@link EventsToIcsOptions}）
 * @returns iCalendar 文字列（CRLF 改行、末尾にも CRLF が付く）
 * @throws 不正な RRULE・無効なタイムゾーン・解釈できない日時を含む場合は `Error`
 * @example
 * ```ts
 * const ics = eventsToIcs(
 *   [
 *     {
 *       id: 'weekly',
 *       title: '週次ミーティング',
 *       start: '2026-07-06T10:00:00',
 *       end: '2026-07-06T11:00:00',
 *       timeZone: 'Asia/Tokyo',
 *       rrule: 'FREQ=WEEKLY;BYDAY=MO',
 *     },
 *   ],
 *   { timeZone: 'Asia/Tokyo' },
 * );
 * // ics には 'DTSTART;TZID=Asia/Tokyo:20260706T100000' などの行が含まれる
 * ```
 */
export function eventsToIcs(
  events: readonly CalendarEvent[],
  options: EventsToIcsOptions = {},
): string {
  const fallbackTimeZone = options.timeZone ?? getLocalTimeZone();
  if (!isValidTimeZone(fallbackTimeZone)) {
    throw new Error(`無効なタイムゾーンです: '${fallbackTimeZone}'`);
  }
  const ctx: SerializeContext = {
    eventsById: new Map(events.map((event) => [event.id, event])),
    fallbackTimeZone,
    defaultEventMinutes: options.defaultEventMinutes ?? 60,
    dtstampLine: `DTSTAMP:${formatUtcDigits(options.dtstamp ?? new Date())}`,
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${options.prodId ?? DEFAULT_PROD_ID}`,
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    lines.push(...serializeVEvent(event, ctx));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldContentLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// インポート（ICS → CalendarEvent[]）
// ---------------------------------------------------------------------------

/** 解析済みのコンテンツ行。 */
interface ContentLine {
  /** プロパティ名（大文字）。 */
  name: string;
  /** パラメータ名（大文字）→ 値（引用符は除去済み）。 */
  params: ReadonlyMap<string, string>;
  /** `':'` 以降の値（エスケープは未解決）。 */
  value: string;
}

/** 折り返された行を連結し、空行を除いた論理行の配列にする。 */
function unfoldIcsLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (raw.startsWith(' ') || raw.startsWith('\t')) {
      const last = lines.pop();
      if (last === undefined) {
        lines.push(raw);
      } else {
        lines.push(last + raw.slice(1));
      }
      continue;
    }
    lines.push(raw);
  }
  return lines.filter((line) => line !== '');
}

/** 引用符の外にある区切り文字でだけ分割する。 */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === separator && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** コンテンツ行を `名前;パラメータ:値` に分解する。 */
function parseContentLine(line: string): ContentLine {
  let colonIndex = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ':' && !inQuotes) {
      colonIndex = i;
      break;
    }
  }
  if (colonIndex === -1) {
    throw new Error(`ICS の行を解釈できません（':' がありません）: '${line}'`);
  }
  const segments = splitOutsideQuotes(line.slice(0, colonIndex), ';');
  const name = (segments[0] ?? '').toUpperCase();
  if (name === '') {
    throw new Error(`ICS の行を解釈できません（プロパティ名がありません）: '${line}'`);
  }
  const params = new Map<string, string>();
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) {
      continue; // 値のないパラメータは無視する
    }
    let paramValue = segment.slice(eqIndex + 1);
    if (paramValue.length >= 2 && paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1);
    }
    params.set(segment.slice(0, eqIndex).toUpperCase(), paramValue);
  }
  return { name, params, value: line.slice(colonIndex + 1) };
}

/** 解析済みの日時値（iCalendar の DATE / DATE-TIME）。 */
type IcsDateValue =
  | { type: 'date'; key: string }
  | { type: 'zoned'; local: string; tzid: TimeZoneId }
  | { type: 'utc'; iso: string }
  | { type: 'floating'; local: string };

/** DATE / DATE-TIME 値を解析する。値の検証（暦上の実在・時刻の範囲）も行う。 */
function parseIcsDateValue(
  raw: string,
  params: ReadonlyMap<string, string>,
  propertyName: string,
): IcsDateValue {
  const dateMatch = DATE_DIGITS_PATTERN.exec(raw);
  if (dateMatch !== null) {
    const [, year, month, day] = dateMatch;
    const key = `${year}-${month}-${day}`;
    try {
      dateFromKey(key, 'UTC');
    } catch {
      throw new Error(`${propertyName} の値を日付として解釈できません: '${raw}'`);
    }
    return { type: 'date', key };
  }
  const match = DATE_TIME_DIGITS_PATTERN.exec(raw);
  if (match === null) {
    throw new Error(`${propertyName} の値を日時として解釈できません: '${raw}'`);
  }
  const [, year, month, day, hours, minutes, seconds, zSuffix] = match;
  const local = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  try {
    // 成分の範囲検証（暦上の実在・時刻の範囲）を parseDateValue に委ねる
    parseDateValue(local, 'UTC', false);
  } catch {
    throw new Error(`${propertyName} の値を日時として解釈できません: '${raw}'`);
  }
  if (zSuffix === 'Z') {
    return { type: 'utc', iso: `${local}Z` };
  }
  const tzid = params.get('TZID');
  if (tzid !== undefined) {
    if (!isValidTimeZone(tzid)) {
      throw new Error(
        `${propertyName} の TZID が有効な IANA タイムゾーン ID ではありません: '${tzid}'`,
      );
    }
    return { type: 'zoned', local, tzid };
  }
  return { type: 'floating', local };
}

/** `'YYYY-MM-DDTHH:mm:ss'` を現地時刻の成分にする（{@link parseIcsDateValue} が作る形式専用）。 */
function wallPartsFromLocal(local: string): WallClockParts {
  return {
    year: Number(local.slice(0, 4)),
    month: Number(local.slice(5, 7)),
    day: Number(local.slice(8, 10)),
    hours: Number(local.slice(11, 13)),
    minutes: Number(local.slice(14, 16)),
    seconds: Number(local.slice(17, 19)),
  };
}

/**
 * 解析済みの日時値を {@link CalendarEvent} のフィールド値にする。
 * イベントのタイムゾーンと同じ TZID の値はオフセットなし文字列（イベント TZ の
 * 現地時刻として解釈される）、異なる TZID の値は絶対時刻の `Date` にする。
 */
function toEventValue(value: IcsDateValue, eventTimeZone: TimeZoneId | undefined): Date | string {
  switch (value.type) {
    case 'date':
      return value.key;
    case 'floating':
      return value.local;
    case 'utc':
      return value.iso;
    case 'zoned':
      if (value.tzid === eventTimeZone) {
        return value.local;
      }
      return fromWallClock(wallPartsFromLocal(value.local), value.tzid);
  }
}

/** VEVENT 1 件分のプロパティの集約結果。 */
interface CollectedVEvent {
  uid: string | undefined;
  summary: string | undefined;
  location: string | undefined;
  description: string | undefined;
  status: string | undefined;
  dtstart: IcsDateValue | undefined;
  dtend: IcsDateValue | undefined;
  rruleRaw: string | undefined;
  exdates: IcsDateValue[];
  rdates: IcsDateValue[];
  recurrenceId: { value: IcsDateValue; raw: string; thisAndFuture: boolean } | undefined;
}

/** VEVENT のプロパティ行を集約する。対応しないプロパティは無視する。 */
function collectVEventProperties(props: readonly ContentLine[]): CollectedVEvent {
  const collected: CollectedVEvent = {
    uid: undefined,
    summary: undefined,
    location: undefined,
    description: undefined,
    status: undefined,
    dtstart: undefined,
    dtend: undefined,
    rruleRaw: undefined,
    exdates: [],
    rdates: [],
    recurrenceId: undefined,
  };
  for (const prop of props) {
    switch (prop.name) {
      case 'UID':
        collected.uid = unescapeTextValue(prop.value);
        break;
      case 'SUMMARY':
        collected.summary = unescapeTextValue(prop.value);
        break;
      case 'LOCATION':
        collected.location = unescapeTextValue(prop.value);
        break;
      case 'DESCRIPTION':
        collected.description = unescapeTextValue(prop.value);
        break;
      case 'STATUS':
        collected.status = prop.value.toUpperCase();
        break;
      case 'DTSTART':
        collected.dtstart = parseIcsDateValue(prop.value, prop.params, 'DTSTART');
        break;
      case 'DTEND':
        collected.dtend = parseIcsDateValue(prop.value, prop.params, 'DTEND');
        break;
      case 'RRULE':
        collected.rruleRaw = prop.value;
        break;
      case 'EXDATE':
        for (const value of prop.value.split(',')) {
          collected.exdates.push(parseIcsDateValue(value, prop.params, 'EXDATE'));
        }
        break;
      case 'RDATE':
        if (prop.params.get('VALUE') === 'PERIOD') {
          break; // VALUE=PERIOD の RDATE は無視する
        }
        for (const value of prop.value.split(',')) {
          collected.rdates.push(parseIcsDateValue(value, prop.params, 'RDATE'));
        }
        break;
      case 'RECURRENCE-ID':
        collected.recurrenceId = {
          value: parseIcsDateValue(prop.value, prop.params, 'RECURRENCE-ID'),
          raw: prop.value,
          thisAndFuture: prop.params.get('RANGE')?.toUpperCase() === 'THISANDFUTURE',
        };
        break;
      default:
        // EXRULE・DURATION・DTSTAMP・X- プロパティなど対応しないものは無視する
        break;
    }
  }
  return collected;
}

/** ICS テキストから VEVENT ごとのプロパティ行を取り出す。 */
function extractVEventBlocks(ics: string): ContentLine[][] {
  const stack: string[] = [];
  const rawEvents: ContentLine[][] = [];
  let currentEvent: ContentLine[] | null = null;
  let eventDepth = 0;
  for (const line of unfoldIcsLines(ics)) {
    const content = parseContentLine(line);
    if (content.name === 'BEGIN') {
      stack.push(content.value.toUpperCase());
      if (content.value.toUpperCase() === 'VEVENT' && currentEvent === null) {
        currentEvent = [];
        eventDepth = stack.length;
      }
      continue;
    }
    if (content.name === 'END') {
      const component = content.value.toUpperCase();
      const top = stack.pop();
      if (top !== component) {
        throw new Error(
          `ICS のコンポーネント構造が不正です（END:${component} に対応する BEGIN がありません）`,
        );
      }
      if (component === 'VEVENT' && currentEvent !== null && stack.length < eventDepth) {
        rawEvents.push(currentEvent);
        currentEvent = null;
      }
      continue;
    }
    // VEVENT 直下のプロパティのみを集める（VALARM 等の内側は無視する）
    if (currentEvent !== null && stack.length === eventDepth) {
      currentEvent.push(content);
    }
  }
  if (stack.length > 0) {
    throw new Error(
      `ICS のコンポーネント構造が不正です（BEGIN:${stack.at(-1)} が閉じられていません）`,
    );
  }
  return rawEvents;
}

/**
 * `RECURRENCE-ID;RANGE=THISANDFUTURE` の VEVENT が要求する「これ以降」の適用内容。
 * 全 VEVENT の組み立て後に {@link applyThisAndFutureRequests} が処理する。
 */
type ThisAndFutureRequest =
  | {
      /** 分割点以降を変更する（シリーズ分割）。 */
      kind: 'update';
      /** 対象マスターの `UID`。 */
      uid: string;
      /** `RECURRENCE-ID` の値（分割点）。 */
      value: IcsDateValue;
      /** オーバーライド VEVENT から作られたイベントの ID。分割後の新シリーズの ID になる。 */
      overrideId: EventId;
      /** 新シリーズへ反映するパッチ（オーバーライド VEVENT に存在したプロパティのみ）。 */
      patch: CalendarEventPatch;
    }
  | {
      /** 分割点以降を削除する（`STATUS:CANCELLED` との組み合わせ）。 */
      kind: 'cancel';
      /** 対象マスターの `UID`。 */
      uid: string;
      /** `RECURRENCE-ID` の値（分割点）。 */
      value: IcsDateValue;
    };

/** VEVENT 1 件を処理した結果（{@link buildEventFromVEvent} の戻り値）。 */
type VEventOutcome =
  | { kind: 'event'; event: CalendarEvent; splitRequest?: ThisAndFutureRequest }
  | { kind: 'cancelledOverride'; uid: string; value: IcsDateValue; thisAndFuture: boolean }
  | { kind: 'skipped' };

/**
 * VEVENT 1 件分のプロパティ行から {@link CalendarEvent} を構成する
 * （{@link eventsFromIcs} / {@link eventsFromIcsWithIssues} で共通の処理）。
 *
 * `STATUS:CANCELLED` の VEVENT は `RECURRENCE-ID` があればマスターの `exdates`
 * へ変換すべきオーバーライドとして、なければ読み飛ばすものとして返す。
 * `RECURRENCE-ID` に `RANGE=THISANDFUTURE` が付いた VEVENT は、組み立てたイベントに
 * 加えて「これ以降」のシリーズ分割の要求（`splitRequest`）を添えて返す。
 *
 * @param props - VEVENT 直下のプロパティ行
 * @param index - ICS 内の VEVENT の出現順（0 始まり。`UID` 省略時の自動生成 ID に使う）
 * @param displayTimeZone - UTC 形式の `DTSTART` を持つ VEVENT の `UNTIL` の解釈に使う
 *   表示タイムゾーン
 * @throws `DTSTART` がない、日時・`TZID`・`RRULE` を解釈できない場合は `Error`
 */
function buildEventFromVEvent(
  props: readonly ContentLine[],
  index: number,
  displayTimeZone: TimeZoneId,
): VEventOutcome {
  const collected = collectVEventProperties(props);
  const uid = collected.uid ?? `ics-event-${index + 1}`;
  if (collected.dtstart === undefined) {
    throw new Error(`DTSTART のない VEVENT は取り込めません（UID: '${uid}'）`);
  }
  if (collected.status === 'CANCELLED') {
    // キャンセルされたオーバーライドは「そのオカレンスの削除」= マスターの EXDATE 相当。
    // RANGE=THISANDFUTURE 付きは「これ以降の削除」としてシリーズの打ち切りに変換する
    if (collected.recurrenceId !== undefined) {
      return {
        kind: 'cancelledOverride',
        uid,
        value: collected.recurrenceId.value,
        thisAndFuture: collected.recurrenceId.thisAndFuture,
      };
    }
    return { kind: 'skipped' };
  }
  const allDay = collected.dtstart.type === 'date';
  const timeZone = collected.dtstart.type === 'zoned' ? collected.dtstart.tzid : undefined;
  const event: CalendarEvent = {
    id: collected.recurrenceId !== undefined ? `${uid}@${collected.recurrenceId.raw}` : uid,
    title: collected.summary ?? '',
    start: toEventValue(collected.dtstart, timeZone),
  };
  if (allDay) {
    event.allDay = true;
  }
  if (timeZone !== undefined) {
    event.timeZone = timeZone;
  }
  if (collected.dtend !== undefined) {
    event.end = toEventValue(collected.dtend, timeZone);
  }
  if (collected.rruleRaw !== undefined) {
    event.rrule = untilForImport(
      normalizeRRuleString(collected.rruleRaw),
      collected.dtstart,
      displayTimeZone,
    );
  }
  if (collected.exdates.length > 0) {
    event.exdates = collected.exdates.map((value) => toEventValue(value, timeZone));
  }
  if (collected.rdates.length > 0) {
    event.rdates = collected.rdates.map((value) => toEventValue(value, timeZone));
  }
  if (collected.recurrenceId !== undefined) {
    event.recurringEventId = uid;
    event.originalStart = toEventValue(collected.recurrenceId.value, timeZone);
  }
  if (collected.location !== undefined) {
    event.location = collected.location;
  }
  if (collected.description !== undefined) {
    event.description = collected.description;
  }
  if (collected.recurrenceId?.thisAndFuture === true) {
    // RANGE=THISANDFUTURE はシリーズ分割の要求として返す。イベント自体は
    // 単一オカレンスのオーバーライドのまま組み立てておき、同じ UID の
    // 繰り返しマスターが見つからない場合のフォールバックとして使う
    return {
      kind: 'event',
      event,
      splitRequest: {
        kind: 'update',
        uid,
        value: collected.recurrenceId.value,
        overrideId: event.id,
        patch: thisAndFuturePatch(collected, event),
      },
    };
  }
  return { kind: 'event', event };
}

/**
 * `RANGE=THISANDFUTURE` のオーバーライド VEVENT から、分割後の新シリーズへ反映する
 * パッチを作る。VEVENT に存在したプロパティだけを反映し、存在しないプロパティは
 * 分割元（マスター）の値を新シリーズへ引き継がせる。`timeZone` / `allDay` は
 * `DTSTART` の形式そのものを表すため常にパッチへ含める（オーバーライドが `TZID` や
 * `VALUE=DATE` を持たない場合、明示的な `undefined` でマスターの値を引き継がせない）。
 */
function thisAndFuturePatch(collected: CollectedVEvent, event: CalendarEvent): CalendarEventPatch {
  return {
    start: event.start,
    timeZone: event.timeZone,
    allDay: event.allDay,
    ...(collected.dtend !== undefined ? { end: event.end } : {}),
    ...(collected.summary !== undefined ? { title: collected.summary } : {}),
    ...(collected.location !== undefined ? { location: event.location } : {}),
    ...(collected.description !== undefined ? { description: event.description } : {}),
    ...(collected.rruleRaw !== undefined ? { rrule: event.rrule } : {}),
    ...(collected.exdates.length > 0 ? { exdates: event.exdates } : {}),
    ...(collected.rdates.length > 0 ? { rdates: event.rdates } : {}),
  };
}

/** 解析済みの日時値を絶対時刻にする（分割点の整列・比較に使う）。 */
function icsDateValueToInstant(value: IcsDateValue, displayTimeZone: TimeZoneId): Date {
  switch (value.type) {
    case 'date':
      // 終日の分割点は表示タイムゾーンにおけるその日付の 0:00
      return dateFromKey(value.key, displayTimeZone);
    case 'zoned':
      return fromWallClock(wallPartsFromLocal(value.local), value.tzid);
    case 'utc':
      return parseDateValue(value.iso, displayTimeZone, false);
    case 'floating':
      return fromWallClock(wallPartsFromLocal(value.local), displayTimeZone);
  }
}

/**
 * `RECURRENCE-ID;RANGE=THISANDFUTURE` の VEVENT を「これ以降」のシリーズ分割・
 * 打ち切りとして適用する（{@link eventsFromIcs} / {@link eventsFromIcsWithIssues} で
 * 共通の後処理）。
 *
 * 同じ `UID` のマスター（`rrule` または `rdates` を持つイベント）に対し、対話操作の
 * `scope: 'thisAndFollowing'`（{@link updateEventIn} / {@link deleteEventIn}）と同じ
 * 意味論で適用する:
 *
 * - 旧シリーズは分割点の直前で打ち切られ、新シリーズ（ID はオーバーライドと同じ
 *   「`UID@RECURRENCE-ID の値`」）が分割点以降を引き継ぐ。`COUNT` は消化済み回数を
 *   差し引いた残数になる
 * - 分割点以降の通常オーバーライド・`EXDATE`・`RDATE` は新シリーズへ付け替えられる
 * - 同じ `UID` に複数の分割がある場合は分割点の昇順に連鎖適用され、前の分割で
 *   生まれた新シリーズが次の分割の対象になる
 * - `STATUS:CANCELLED` との組み合わせは「これ以降の削除」としてシリーズを打ち切る
 *
 * マスターが見つからない・繰り返しを持たない場合はフォールバックとして、`update` は
 * 単一オカレンスのオーバーライドのまま残し、`cancel` は単一オカレンスの取り消し
 * （マスターの `exdates` への追加）にする。
 *
 * フローティング・終日の分割点は、`UNTIL` の取り込みと同じく表示タイムゾーン
 * （`displayTimeZone`）の現地時刻として解釈する。
 */
function applyThisAndFutureRequests(
  events: CalendarEvent[],
  requests: readonly ThisAndFutureRequest[],
  displayTimeZone: TimeZoneId,
): CalendarEvent[] {
  if (requests.length === 0) {
    return events;
  }
  // UID ごとにまとめ、分割点の昇順に整列する（ICS 内の出現順には依存しない）
  const byUid = new Map<string, { request: ThisAndFutureRequest; time: number }[]>();
  for (const request of requests) {
    const entry = {
      request,
      time: icsDateValueToInstant(request.value, displayTimeZone).getTime(),
    };
    const list = byUid.get(request.uid);
    if (list === undefined) {
      byUid.set(request.uid, [entry]);
    } else {
      list.push(entry);
    }
  }
  let result = events;
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.time - b.time);
    // 前の分割で生まれた新シリーズが次の分割の対象になる（連鎖適用）
    let currentMasterId: EventId = uid;
    for (const { request, time } of list) {
      const master = result.find(
        (event) => event.id === currentMasterId && event.recurringEventId === undefined,
      );
      if (
        master === undefined ||
        (master.rrule === undefined && (master.rdates?.length ?? 0) === 0)
      ) {
        // 分割対象の繰り返しマスターがない場合のフォールバック
        if (request.kind === 'cancel') {
          // 単一オカレンスの取り消し（applyCancelledOverrides と同じ変換）
          result = result.map((event) =>
            event.id === request.uid && event.recurringEventId === undefined
              ? {
                  ...event,
                  exdates: [...(event.exdates ?? []), toEventValue(request.value, event.timeZone)],
                }
              : event,
          );
        }
        // update は単一オカレンスのオーバーライドのまま残す（何もしない）
        continue;
      }
      const splitPoint = new Date(time);
      if (request.kind === 'cancel') {
        result = deleteEventIn(
          result,
          master.id,
          { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
          {
            displayTimeZone,
            defaultEventMinutes: 60,
            // 削除の経路では ID 採番は行われない（呼ばれた場合に検知できるよう例外にする）
            generateId: () => {
              throw new Error('シリーズ打ち切りで ID 採番が要求されました（想定外の経路）');
            },
          },
        );
        continue;
      }
      // オーバーライド自身は新シリーズになるため、分割前に取り除く
      result = result.filter((event) => event.id !== request.overrideId);
      let createdNewSeries = false;
      result = updateEventIn(
        result,
        master.id,
        request.patch,
        { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
        {
          displayTimeZone,
          // end 省略時の既定の長さ。分割ではマスターの end から長さを引き継ぐため
          // 実質使われないが、eventsToIcs の既定値と揃えておく
          defaultEventMinutes: 60,
          generateId: () => {
            createdNewSeries = true;
            return request.overrideId;
          },
        },
      );
      if (createdNewSeries) {
        currentMasterId = request.overrideId;
      }
      // 分割点が最初のオカレンスと一致した場合は新シリーズを作らずマスター自体が
      // 変更される（scope: 'all' 相当）ため、次の分割の対象は変わらない
    }
  }
  return result;
}

/**
 * `STATUS:CANCELLED` のオーバーライドをマスターの `exdates` へ反映する
 * （{@link eventsFromIcs} / {@link eventsFromIcsWithIssues} で共通の処理）。
 * マスターが `events` 内にない場合（同じ ICS 内にない、または取り込みに失敗した場合）は無視する。
 */
function applyCancelledOverrides(
  events: CalendarEvent[],
  cancelledOverrides: readonly { uid: string; value: IcsDateValue }[],
): void {
  for (const cancelled of cancelledOverrides) {
    const masterEvent = events.find(
      (event) => event.id === cancelled.uid && event.recurringEventId === undefined,
    );
    if (masterEvent === undefined) {
      continue;
    }
    masterEvent.exdates = [
      ...(masterEvent.exdates ?? []),
      toEventValue(cancelled.value, masterEvent.timeZone),
    ];
  }
}

/**
 * VEVENT のプロパティ行から指定した名前の TEXT 値を取り出す（最後に現れたものを採用し、
 * {@link collectVEventProperties} と同じ優先順位にする）。取り込みに失敗した VEVENT を
 * {@link IcsImportIssue} 化する際、パースに失敗していても `UID` / `SUMMARY` を拾うために使う。
 */
function findRawTextValue(props: readonly ContentLine[], name: string): string | null {
  let found: string | undefined;
  for (const prop of props) {
    if (prop.name === name) {
      found = prop.value;
    }
  }
  return found !== undefined ? unescapeTextValue(found) : null;
}

/**
 * iCalendar（VCALENDAR/VEVENT）文字列をイベントの配列にする。
 *
 * - `TZID` 付きの日時は `timeZone` とオフセットなし文字列（イベント TZ の現地時刻）になる
 * - `VALUE=DATE` は終日イベント（`allDay: true` と `'YYYY-MM-DD'`）になる
 * - `RECURRENCE-ID` を持つ VEVENT はオーバーライド（`recurringEventId` +
 *   `originalStart`）になり、`id` は「`UID` + `'@'` + `RECURRENCE-ID` の値」で生成される
 * - `RECURRENCE-ID;RANGE=THISANDFUTURE` を持つ VEVENT は「これ以降」のシリーズ分割になる。
 *   同じ `UID` のマスターの繰り返しを分割点の直前で打ち切り、分割点以降を新しい独立
 *   イベントとして取り込む（マスターが見つからない場合は単一オカレンスのオーバーライド）
 * - `EXDATE` / `RDATE` は `exdates` / `rdates` になる。`STATUS:CANCELLED` の
 *   オーバーライドは同じ `UID` のマスターの `exdates` に変換される
 *   （`RANGE=THISANDFUTURE` 付きは「これ以降の削除」としてシリーズを打ち切る）
 * - `VTIMEZONE` 定義・`EXRULE`・`VALUE=PERIOD` の `RDATE`・`DURATION`・`VALARM`・
 *   未対応プロパティは無視する（`TZID` は IANA タイムゾーン ID として解釈する）
 *
 * @param ics - iCalendar 文字列（改行は CRLF / LF のどちらでもよい）
 * @param options - 取り込みのオプション（{@link EventsFromIcsOptions}）
 * @returns 取り込んだイベントの配列（VEVENT の出現順）
 * @throws 構造が不正な場合、`DTSTART` がない場合、日時・RRULE・TZID を
 *   解釈できない場合は `Error`
 * @example
 * ```ts
 * const events = eventsFromIcs(
 *   [
 *     'BEGIN:VCALENDAR',
 *     'BEGIN:VEVENT',
 *     'UID:weekly',
 *     'DTSTART;TZID=Asia/Tokyo:20260706T100000',
 *     'RRULE:FREQ=WEEKLY;BYDAY=MO',
 *     'SUMMARY:週次ミーティング',
 *     'END:VEVENT',
 *     'END:VCALENDAR',
 *   ].join('\r\n'),
 * );
 * // => [{ id: 'weekly', title: '週次ミーティング', start: '2026-07-06T10:00:00',
 * //       timeZone: 'Asia/Tokyo', rrule: 'FREQ=WEEKLY;BYDAY=MO' }]
 * ```
 */
export function eventsFromIcs(ics: string, options: EventsFromIcsOptions = {}): CalendarEvent[] {
  const displayTimeZone = options.timeZone ?? getLocalTimeZone();
  const rawEvents = extractVEventBlocks(ics);
  const events: CalendarEvent[] = [];
  const seenIds = new Set<string>();
  const cancelledOverrides: { uid: string; value: IcsDateValue }[] = [];
  const splitRequests: ThisAndFutureRequest[] = [];

  for (const [index, props] of rawEvents.entries()) {
    const outcome = buildEventFromVEvent(props, index, displayTimeZone);
    if (outcome.kind === 'event') {
      // 同じ id になる VEVENT（`RECURRENCE-ID` のない同一 UID の重複など）は
      // 最初の 1 件を優先して読み飛ばし、`id` が重複した配列を返さない
      if (seenIds.has(outcome.event.id)) {
        continue;
      }
      seenIds.add(outcome.event.id);
      events.push(outcome.event);
      if (outcome.splitRequest !== undefined) {
        splitRequests.push(outcome.splitRequest);
      }
    } else if (outcome.kind === 'cancelledOverride') {
      if (outcome.thisAndFuture) {
        splitRequests.push({ kind: 'cancel', uid: outcome.uid, value: outcome.value });
      } else {
        cancelledOverrides.push({ uid: outcome.uid, value: outcome.value });
      }
    }
  }

  applyCancelledOverrides(events, cancelledOverrides);
  return applyThisAndFutureRequests(events, splitRequests, displayTimeZone);
}

/**
 * {@link eventsFromIcsWithIssues} が VEVENT 単位で報告する取り込み不能の内容。
 */
export interface IcsImportIssue {
  /** ICS 内の VEVENT の出現順（0 始まり）。 */
  index: number;
  /** 取り込みに失敗した VEVENT の `UID`（省略されていた場合は `null`）。 */
  uid: string | null;
  /** 取り込みに失敗した VEVENT の `SUMMARY`（省略されていた場合は `null`）。 */
  summary: string | null;
  /** 取り込みに失敗した理由（{@link eventsFromIcs} が投げるものと同じ `Error` のメッセージ）。 */
  message: string;
}

/**
 * iCalendar 文字列をイベントの配列にする（{@link eventsFromIcs} の部分取り込み版）。
 *
 * {@link eventsFromIcs} と同じ変換規則を使うが、VEVENT 単位の不正（`DTSTART` 欠落、
 * 日時・`TZID`・`RRULE` を解釈できない等）は例外を投げる代わりに、その VEVENT を
 * 読み飛ばして `issues` に記録し、残りの VEVENT は取り込みを続ける。
 *
 * `BEGIN`/`END` の対応が取れないコンポーネント構造・`':'` のない行など、VEVENT
 * 単位に閉じない ICS 全体の構造の不正は {@link eventsFromIcs} と同様に `Error` を投げる
 * （個々の VEVENT の issue には変換しない）。
 *
 * `STATUS:CANCELLED` のオーバーライドは {@link eventsFromIcs} と同じくマスターの
 * `exdates` へ変換されるが、マスターの VEVENT 自体が取り込みに失敗して `issues` 側に
 * 回っている場合は、反映先がないため無視される。`RECURRENCE-ID;RANGE=THISANDFUTURE` の
 * シリーズ分割も同様で、マスターが `issues` 側に回っている場合は分割せず
 * 単一オカレンスのオーバーライドとして取り込む。
 *
 * @param ics - iCalendar 文字列（改行は CRLF / LF のどちらでもよい）
 * @param options - 取り込みのオプション（{@link EventsFromIcsOptions}）
 * @returns 取り込めたイベントの配列（`events`）と、読み飛ばした VEVENT ごとの
 *   {@link IcsImportIssue}（`issues`、VEVENT の出現順）
 * @throws ICS 全体の構造が不正な場合は `Error`（{@link eventsFromIcs} と同じ条件）
 * @example
 * ```ts
 * const { events, issues } = eventsFromIcsWithIssues(icsText);
 * for (const issue of issues) {
 *   console.warn(`VEVENT #${issue.index}（UID: ${issue.uid ?? '不明'}）を読み飛ばしました: ${issue.message}`);
 * }
 * ```
 */
export function eventsFromIcsWithIssues(
  ics: string,
  options: EventsFromIcsOptions = {},
): {
  events: CalendarEvent[];
  issues: readonly IcsImportIssue[];
} {
  const displayTimeZone = options.timeZone ?? getLocalTimeZone();
  const rawEvents = extractVEventBlocks(ics);
  const events: CalendarEvent[] = [];
  const seenIds = new Set<string>();
  const cancelledOverrides: { uid: string; value: IcsDateValue }[] = [];
  const splitRequests: ThisAndFutureRequest[] = [];
  const issues: IcsImportIssue[] = [];

  for (const [index, props] of rawEvents.entries()) {
    try {
      const outcome = buildEventFromVEvent(props, index, displayTimeZone);
      if (outcome.kind === 'event') {
        // 同じ id になる VEVENT は最初の 1 件を優先し、2 件目以降は issue に記録する
        // （{@link eventsFromIcs} と同じ規則）
        if (seenIds.has(outcome.event.id)) {
          issues.push({
            index,
            uid: findRawTextValue(props, 'UID'),
            summary: findRawTextValue(props, 'SUMMARY'),
            message: `同じ UID のイベントを既に取り込んでいます（id: '${outcome.event.id}'）`,
          });
          continue;
        }
        seenIds.add(outcome.event.id);
        events.push(outcome.event);
        if (outcome.splitRequest !== undefined) {
          splitRequests.push(outcome.splitRequest);
        }
      } else if (outcome.kind === 'cancelledOverride') {
        if (outcome.thisAndFuture) {
          splitRequests.push({ kind: 'cancel', uid: outcome.uid, value: outcome.value });
        } else {
          cancelledOverrides.push({ uid: outcome.uid, value: outcome.value });
        }
      }
    } catch (error) {
      issues.push({
        index,
        uid: findRawTextValue(props, 'UID'),
        summary: findRawTextValue(props, 'SUMMARY'),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  applyCancelledOverrides(events, cancelledOverrides);
  return { events: applyThisAndFutureRequests(events, splitRequests, displayTimeZone), issues };
}
