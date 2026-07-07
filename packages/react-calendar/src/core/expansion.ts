/**
 * @packageDocumentation
 * イベントの展開（{@link CalendarEvent} → {@link EventOccurrence}）。
 *
 * ソースイベントの集合を表示範囲に対して展開し、発生（オカレンス）の
 * 一覧を生成する。繰り返しの展開、EXDATE による除外、オーバーライド
 * （「この予定のみ変更」）による置換をここで解決する。
 *
 * ## 終日イベントとタイムゾーン
 *
 * 終日イベントは「カレンダー上の日付」に紐づき、タイムゾーンに依存しない
 * （Google カレンダーと同じ挙動）。日付の解釈は `event.timeZone ??
 * displayTimeZone` で行い、`'YYYY-MM-DD'` の日付キーに正規化したうえで、
 * 展開時には表示タイムゾーンにおけるその日付の 0:00 を発生の開始絶対時刻
 * とする。表示タイムゾーンを変えても発生は常に同じ「日付」に現れる。
 */

import { rangesOverlap } from './date-utils';
import { expandRecurrence } from './recurrence';
import { addDaysInZone, dateFromKey, dateKeyInZone, parseDateValue } from './timezone';
import type { CalendarEvent, DateRange, EventId, EventOccurrence, TimeZoneId } from './types';

/** 1 分のミリ秒数。 */
const MINUTE_MS = 60 * 1000;

/** 1 日のミリ秒数（DST のない UTC の日付キー空間でのみ使用する）。 */
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * 終日イベントの日付キー空間の基準タイムゾーン。
 *
 * 終日の繰り返しはタイムゾーン非依存（日付ベース）であるため、
 * DST の存在しない UTC の 0:00 に日付キーを載せて展開・演算する。
 */
const DATE_KEY_ZONE: TimeZoneId = 'UTC';

/** 置換済み発生が 1 つもないことを表す空集合（時間指定マスター用）。 */
const NO_OVERRIDDEN_TIMES: ReadonlySet<number> = new Set();

/** 置換済み発生が 1 つもないことを表す空集合（終日マスター用）。 */
const NO_OVERRIDDEN_KEYS: ReadonlySet<string> = new Set();

/**
 * 発生の一意キーを構築する。
 *
 * @param eventId - イベント ID
 * @param start - 発生の開始（絶対時刻）
 * @returns `` `${eventId}@${startのISO文字列}` `` 形式のキー
 * @example
 * ```ts
 * occurrenceKey('e1', new Date('2026-07-01T01:00:00Z')); // => 'e1@2026-07-01T01:00:00.000Z'
 * ```
 */
export function occurrenceKey(eventId: EventId, start: Date): string {
  return `${eventId}@${start.toISOString()}`;
}

/** 時間指定イベントの `[start, end)` を絶対時刻で解決した結果。 */
interface TimedSpan {
  /** 開始（絶対時刻）。 */
  start: Date;
  /** 終了（絶対時刻、排他）。 */
  end: Date;
  /** `end - start` のミリ秒差。繰り返しの各発生でこの長さが維持される。 */
  durationMs: number;
}

/** 終日イベントを日付キー空間で解決した結果。 */
interface AllDaySpan {
  /** 開始日の日付キー（`'YYYY-MM-DD'`）。 */
  startKey: string;
  /** 日数（1 以上）。`end` は排他なのでキー差がそのまま日数になる。 */
  dayCount: number;
}

/**
 * 時間指定イベントの `start` / `end` を絶対時刻に解決する。
 * `end` 省略時は開始から `defaultEventMinutes` 分とみなす。
 */
function resolveTimedSpan(
  event: CalendarEvent,
  timeZone: TimeZoneId,
  defaultEventMinutes: number,
): TimedSpan {
  const start = parseDateValue(event.start, timeZone, false);
  const end =
    event.end === undefined
      ? new Date(start.getTime() + defaultEventMinutes * MINUTE_MS)
      : parseDateValue(event.end, timeZone, false);
  return { start, end, durationMs: end.getTime() - start.getTime() };
}

/**
 * 終日イベントの `start` / `end` を日付キーと日数に解決する。
 * `end` 省略時は 1 日、`end` が `start` 以前の不正値でも防御的に 1 日とみなす。
 */
function resolveAllDaySpan(event: CalendarEvent, interpretTimeZone: TimeZoneId): AllDaySpan {
  const startInstant = parseDateValue(event.start, interpretTimeZone, true);
  const startKey = dateKeyInZone(startInstant, interpretTimeZone);
  if (event.end === undefined) {
    return { startKey, dayCount: 1 };
  }
  const endInstant = parseDateValue(event.end, interpretTimeZone, true);
  const endKey = dateKeyInZone(endInstant, interpretTimeZone);
  const diffDays = Math.round(
    (dateFromKey(endKey, DATE_KEY_ZONE).getTime() -
      dateFromKey(startKey, DATE_KEY_ZONE).getTime()) /
      DAY_MS,
  );
  return { startKey, dayCount: Math.max(1, diffDays) };
}

/** 日付キーに日数を加算した日付キーを返す（DST のない UTC 空間で演算）。 */
function addDaysToKey(key: string, amount: number): string {
  return dateKeyInZone(
    addDaysInZone(dateFromKey(key, DATE_KEY_ZONE), amount, DATE_KEY_ZONE),
    DATE_KEY_ZONE,
  );
}

/** 日付キー起点の終日スパンを、表示タイムゾーンの絶対時刻範囲に射影する。 */
function projectAllDaySpan(
  startKey: string,
  dayCount: number,
  displayTimeZone: TimeZoneId,
): DateRange {
  return {
    start: dateFromKey(startKey, displayTimeZone),
    end: dateFromKey(addDaysToKey(startKey, dayCount), displayTimeZone),
  };
}

/** {@link EventOccurrence} を組み立てる。 */
function buildOccurrence(params: {
  event: CalendarEvent;
  start: Date;
  end: Date;
  allDay: boolean;
  isRecurring: boolean;
  originalStart: Date;
}): EventOccurrence {
  const { event, start, end, allDay, isRecurring, originalStart } = params;
  return {
    key: occurrenceKey(event.id, start),
    eventId: event.id,
    event,
    start,
    end,
    allDay,
    isRecurring,
    originalStart,
  };
}

/**
 * exdates を終日イベント用の「除外日付キー」集合に解決する。
 * `'YYYY-MM-DD'` でも、その日のどこかを指す `Date` でも同じキーになる。
 */
function resolveExcludedKeys(event: CalendarEvent, interpretTimeZone: TimeZoneId): Set<string> {
  const keys = new Set<string>();
  for (const exdate of event.exdates ?? []) {
    keys.add(dateKeyInZone(parseDateValue(exdate, interpretTimeZone, true), interpretTimeZone));
  }
  return keys;
}

/** exdates を時間指定イベント用の絶対時刻に解決する。 */
function resolveExcludedInstants(event: CalendarEvent, interpretTimeZone: TimeZoneId): Date[] {
  return (event.exdates ?? []).map((exdate) => parseDateValue(exdate, interpretTimeZone, false));
}

/**
 * オーバーライドイベント自身を発生として展開する（範囲に重なる場合のみ）。
 * `originalStart` には置換した元発生の開始時刻（解決済み）を渡す。
 */
function expandOverrideEvent(params: {
  event: CalendarEvent;
  originalStart: Date;
  range: DateRange;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
}): EventOccurrence[] {
  const { event, originalStart, range, displayTimeZone, defaultEventMinutes } = params;
  const timeZone = event.timeZone ?? displayTimeZone;
  if (event.allDay === true) {
    const span = resolveAllDaySpan(event, timeZone);
    const projected = projectAllDaySpan(span.startKey, span.dayCount, displayTimeZone);
    if (!rangesOverlap(projected, range)) {
      return [];
    }
    return [
      buildOccurrence({
        event,
        start: projected.start,
        end: projected.end,
        allDay: true,
        isRecurring: true,
        originalStart,
      }),
    ];
  }
  const span = resolveTimedSpan(event, timeZone, defaultEventMinutes);
  if (!rangesOverlap({ start: span.start, end: span.end }, range)) {
    return [];
  }
  return [
    buildOccurrence({
      event,
      start: span.start,
      end: span.end,
      allDay: false,
      isRecurring: true,
      originalStart: originalStart,
    }),
  ];
}

/**
 * 終日の繰り返しを日付キー空間（UTC の 0:00）で展開する。
 *
 * 表示範囲を日付キーに変換して問い合わせ範囲とし、複数日スパンが範囲に
 * 食い込む分だけ手前に広げる。exdates・オーバーライド済みは日付キー一致で
 * 除外し、最終的に表示タイムゾーンへ射影してから範囲との重なりで確定する。
 */
function expandAllDayRecurrence(params: {
  event: CalendarEvent;
  rrule: string;
  span: AllDaySpan;
  range: DateRange;
  displayTimeZone: TimeZoneId;
  interpretTimeZone: TimeZoneId;
  overriddenKeys: ReadonlySet<string>;
}): EventOccurrence[] {
  const { event, rrule, span, range, displayTimeZone, interpretTimeZone, overriddenKeys } = params;
  const excludedKeys = resolveExcludedKeys(event, interpretTimeZone);
  const queryStart = new Date(
    dateFromKey(dateKeyInZone(range.start, displayTimeZone), DATE_KEY_ZONE).getTime() -
      span.dayCount * DAY_MS,
  );
  const queryEnd = new Date(
    dateFromKey(dateKeyInZone(range.end, displayTimeZone), DATE_KEY_ZONE).getTime() + DAY_MS,
  );
  const starts = expandRecurrence({
    rrule,
    dtstart: dateFromKey(span.startKey, DATE_KEY_ZONE),
    timeZone: DATE_KEY_ZONE,
    range: { start: queryStart, end: queryEnd },
  });
  const occurrences: EventOccurrence[] = [];
  for (const startUtc of starts) {
    const key = dateKeyInZone(startUtc, DATE_KEY_ZONE);
    if (excludedKeys.has(key) || overriddenKeys.has(key)) {
      continue;
    }
    const projected = projectAllDaySpan(key, span.dayCount, displayTimeZone);
    if (!rangesOverlap(projected, range)) {
      continue;
    }
    occurrences.push(
      buildOccurrence({
        event,
        start: projected.start,
        end: projected.end,
        allDay: true,
        isRecurring: true,
        originalStart: projected.start,
      }),
    );
  }
  return occurrences;
}

/**
 * 通常イベント（オーバーライドでないもの。孤児オーバーライドを含む）を展開する。
 * `overriddenTimes` / `overriddenKeys` は、このイベントをマスターとする
 * オーバーライドによって置換済みの元発生の集合。
 */
function expandRegularEvent(params: {
  event: CalendarEvent;
  range: DateRange;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
  overriddenTimes: ReadonlySet<number>;
  overriddenKeys: ReadonlySet<string>;
}): EventOccurrence[] {
  const { event, range, displayTimeZone, defaultEventMinutes, overriddenTimes, overriddenKeys } =
    params;
  const timeZone = event.timeZone ?? displayTimeZone;

  if (event.allDay === true) {
    const span = resolveAllDaySpan(event, timeZone);
    if (event.rrule === undefined) {
      if (overriddenKeys.has(span.startKey)) {
        return [];
      }
      const projected = projectAllDaySpan(span.startKey, span.dayCount, displayTimeZone);
      if (!rangesOverlap(projected, range)) {
        return [];
      }
      return [
        buildOccurrence({
          event,
          start: projected.start,
          end: projected.end,
          allDay: true,
          isRecurring: false,
          originalStart: projected.start,
        }),
      ];
    }
    return expandAllDayRecurrence({
      event,
      rrule: event.rrule,
      span,
      range,
      displayTimeZone,
      interpretTimeZone: timeZone,
      overriddenKeys,
    });
  }

  const span = resolveTimedSpan(event, timeZone, defaultEventMinutes);
  if (event.rrule === undefined) {
    if (overriddenTimes.has(span.start.getTime())) {
      return [];
    }
    if (!rangesOverlap({ start: span.start, end: span.end }, range)) {
      return [];
    }
    return [
      buildOccurrence({
        event,
        start: span.start,
        end: span.end,
        allDay: false,
        isRecurring: false,
        originalStart: span.start,
      }),
    ];
  }

  // 範囲開始前に始まり範囲に食い込む発生を取りこぼさないよう、
  // 問い合わせ範囲をイベントの長さ分だけ手前に広げる
  const startMargin = Math.max(0, span.durationMs);
  const starts = expandRecurrence({
    rrule: event.rrule,
    dtstart: span.start,
    timeZone,
    exdates: resolveExcludedInstants(event, timeZone),
    range: { start: new Date(range.start.getTime() - startMargin), end: range.end },
  });
  const occurrences: EventOccurrence[] = [];
  for (const occStart of starts) {
    if (overriddenTimes.has(occStart.getTime())) {
      continue;
    }
    const occEnd = new Date(occStart.getTime() + span.durationMs);
    if (!rangesOverlap({ start: occStart, end: occEnd }, range)) {
      continue;
    }
    occurrences.push(
      buildOccurrence({
        event,
        start: occStart,
        end: occEnd,
        allDay: false,
        isRecurring: true,
        originalStart: occStart,
      }),
    );
  }
  return occurrences;
}

/**
 * 発生の表示順比較関数。
 * start 昇順 → 同時刻なら長い方が先 → 同長なら `eventId` の辞書順。
 */
function compareOccurrences(a: EventOccurrence, b: EventOccurrence): number {
  const startDiff = a.start.getTime() - b.start.getTime();
  if (startDiff !== 0) {
    return startDiff;
  }
  const durationDiff = b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime());
  if (durationDiff !== 0) {
    return durationDiff;
  }
  if (a.eventId < b.eventId) {
    return -1;
  }
  if (a.eventId > b.eventId) {
    return 1;
  }
  return 0;
}

/**
 * イベント集合を指定範囲に展開し、発生一覧を返す。
 *
 * 処理内容:
 * - **単発イベント** — `[start, end)` が範囲と重なれば 1 件の発生になる
 * - **繰り返しイベント**（`rrule` あり）— 範囲と重なる発生に展開する
 *   （範囲開始前に始まり範囲に食い込む発生を含む）。各発生の長さは
 *   マスターの `start` / `end` のミリ秒差を維持し、終日の繰り返しは
 *   日数を維持する。`UNTIL` はイベント TZ の壁時計として解釈される
 * - **EXDATE**（`exdates`）— 該当する発生を除外する。時間指定イベントは
 *   発生開始のミリ秒一致、終日イベントは日付キー一致で判定する
 * - **オーバーライド**（`recurringEventId` + `originalStart` あり）—
 *   参照先イベントの `originalStart` の発生を置き換える。オーバーライド
 *   自身の `[start, end)` が範囲と重なれば発生として出力される
 *   （元の発生時刻が範囲外でも、移動先が範囲内なら表示される。逆に
 *   範囲内から範囲外へ移動した発生は表示されない）。参照先マスターが
 *   存在しない場合は防御的に単発イベントとして扱う
 * - **終日イベント** — 日付ベースで解釈し（`event.timeZone ??
 *   displayTimeZone` で日付キーに正規化）、表示タイムゾーンの 0:00 を
 *   発生の開始とする。複数日は `end` 排他で日数を維持する
 *
 * 戻り値は開始時刻の昇順（同時刻なら長い方が先、さらに同じなら
 * `eventId` の辞書順）でソートされる。
 *
 * @param params.events - ソースイベントの集合
 * @param params.range - 展開範囲（`end` 排他）
 * @param params.displayTimeZone - 表示タイムゾーン
 * @param params.defaultEventMinutes - `end` 省略時の既定の長さ（分）
 * @returns 発生の一覧（ソート済み）
 */
export function expandEvents(params: {
  events: readonly CalendarEvent[];
  range: DateRange;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
}): EventOccurrence[] {
  const { events, range, displayTimeZone, defaultEventMinutes } = params;
  if (range.end.getTime() <= range.start.getTime()) {
    return [];
  }

  const eventsById = new Map<EventId, CalendarEvent>(events.map((event) => [event.id, event]));

  // マスター ID → オーバーライドで置換済みの元発生（時間指定はミリ秒、終日は日付キー）
  const overriddenTimesByMaster = new Map<EventId, Set<number>>();
  const overriddenKeysByMaster = new Map<EventId, Set<string>>();
  // オーバーライドイベント ID → 解決済みの元発生開始時刻（発生の originalStart になる値）
  const resolvedOriginalStarts = new Map<EventId, Date>();

  for (const event of events) {
    const masterId = event.recurringEventId;
    const original = event.originalStart;
    if (masterId === undefined || original === undefined) {
      continue;
    }
    const master = eventsById.get(masterId);
    if (master === undefined) {
      // 孤児オーバーライド: 防御的に単発イベントとして扱う（通常ルートで処理）
      continue;
    }
    // originalStart はマスターの発生を指すため、オーバーライド TZ →
    // マスター TZ → 表示 TZ の順でフォールバックして壁時計を解釈する
    const interpretTimeZone = event.timeZone ?? master.timeZone ?? displayTimeZone;
    if (master.allDay === true) {
      const key = dateKeyInZone(
        parseDateValue(original, interpretTimeZone, true),
        interpretTimeZone,
      );
      let keys = overriddenKeysByMaster.get(masterId);
      if (keys === undefined) {
        keys = new Set();
        overriddenKeysByMaster.set(masterId, keys);
      }
      keys.add(key);
      // 終日の元発生は表示 TZ におけるその日付の 0:00
      resolvedOriginalStarts.set(event.id, dateFromKey(key, displayTimeZone));
    } else {
      const instant = parseDateValue(original, interpretTimeZone, false);
      let times = overriddenTimesByMaster.get(masterId);
      if (times === undefined) {
        times = new Set();
        overriddenTimesByMaster.set(masterId, times);
      }
      times.add(instant.getTime());
      resolvedOriginalStarts.set(event.id, instant);
    }
  }

  const occurrences: EventOccurrence[] = [];
  for (const event of events) {
    const resolvedOriginal = resolvedOriginalStarts.get(event.id);
    if (resolvedOriginal !== undefined) {
      occurrences.push(
        ...expandOverrideEvent({
          event,
          originalStart: resolvedOriginal,
          range,
          displayTimeZone,
          defaultEventMinutes,
        }),
      );
      continue;
    }
    occurrences.push(
      ...expandRegularEvent({
        event,
        range,
        displayTimeZone,
        defaultEventMinutes,
        overriddenTimes: overriddenTimesByMaster.get(event.id) ?? NO_OVERRIDDEN_TIMES,
        overriddenKeys: overriddenKeysByMaster.get(event.id) ?? NO_OVERRIDDEN_KEYS,
      }),
    );
  }

  occurrences.sort(compareOccurrences);
  return occurrences;
}

/**
 * 単一イベントの、指定した発生開始時刻における発生を解決する。
 *
 * ドラッグ操作やクリック時に、対象の発生の正確な `[start, end)` を
 * 再計算するために使用する。
 *
 * 解決ルール:
 * - **単発イベント** — 解釈済みの `start`（終日は表示 TZ の 0:00）が
 *   `occurrenceStart` とミリ秒単位で一致すれば発生を返す
 * - **繰り返しイベント** — `occurrenceStart` が繰り返しの有効な発生か検証する
 *   （`exdates` で除外済みの発生は `null`）。終日の繰り返しは表示 TZ の
 *   0:00 ちょうど、かつ有効な発生日の場合のみ一致する
 * - **オーバーライドイベント** — 現在の `start` に一致した場合のみ発生を返し、
 *   `originalStart` には元発生の開始時刻を設定する。オーバーライドされた
 *   元発生の時刻（移動済みで存在しない発生）には `null` を返す
 *
 * @param params.event - 対象イベント
 * @param params.occurrenceStart - 発生の開始時刻
 * @param params.displayTimeZone - 表示タイムゾーン
 * @param params.defaultEventMinutes - `end` 省略時の既定の長さ（分）
 * @returns 発生。該当する発生が存在しない場合は `null`
 */
export function resolveOccurrence(params: {
  event: CalendarEvent;
  occurrenceStart: Date;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
}): EventOccurrence | null {
  const { event, occurrenceStart, displayTimeZone, defaultEventMinutes } = params;
  const timeZone = event.timeZone ?? displayTimeZone;
  const targetTime = occurrenceStart.getTime();

  // オーバーライドイベント: 現在の start に一致した場合のみ発生
  const original = event.originalStart;
  if (event.recurringEventId !== undefined && original !== undefined) {
    if (event.allDay === true) {
      const span = resolveAllDaySpan(event, timeZone);
      const projected = projectAllDaySpan(span.startKey, span.dayCount, displayTimeZone);
      if (projected.start.getTime() !== targetTime) {
        return null;
      }
      const originalKey = dateKeyInZone(parseDateValue(original, timeZone, true), timeZone);
      return buildOccurrence({
        event,
        start: projected.start,
        end: projected.end,
        allDay: true,
        isRecurring: true,
        originalStart: dateFromKey(originalKey, displayTimeZone),
      });
    }
    const span = resolveTimedSpan(event, timeZone, defaultEventMinutes);
    if (span.start.getTime() !== targetTime) {
      return null;
    }
    return buildOccurrence({
      event,
      start: span.start,
      end: span.end,
      allDay: false,
      isRecurring: true,
      originalStart: parseDateValue(original, timeZone, false),
    });
  }

  if (event.allDay === true) {
    const span = resolveAllDaySpan(event, timeZone);
    if (event.rrule === undefined) {
      const projected = projectAllDaySpan(span.startKey, span.dayCount, displayTimeZone);
      if (projected.start.getTime() !== targetTime) {
        return null;
      }
      return buildOccurrence({
        event,
        start: projected.start,
        end: projected.end,
        allDay: true,
        isRecurring: false,
        originalStart: projected.start,
      });
    }
    // 終日の繰り返し: 表示 TZ の 0:00 ちょうど、かつ有効な発生日のみ一致
    const key = dateKeyInZone(occurrenceStart, displayTimeZone);
    if (dateFromKey(key, displayTimeZone).getTime() !== targetTime) {
      return null;
    }
    if (resolveExcludedKeys(event, timeZone).has(key)) {
      return null;
    }
    const keyInstant = dateFromKey(key, DATE_KEY_ZONE);
    const hits = expandRecurrence({
      rrule: event.rrule,
      dtstart: dateFromKey(span.startKey, DATE_KEY_ZONE),
      timeZone: DATE_KEY_ZONE,
      range: { start: keyInstant, end: new Date(keyInstant.getTime() + 1) },
    });
    if (hits.length === 0) {
      return null;
    }
    const projected = projectAllDaySpan(key, span.dayCount, displayTimeZone);
    return buildOccurrence({
      event,
      start: projected.start,
      end: projected.end,
      allDay: true,
      isRecurring: true,
      originalStart: projected.start,
    });
  }

  const span = resolveTimedSpan(event, timeZone, defaultEventMinutes);
  if (event.rrule === undefined) {
    if (span.start.getTime() !== targetTime) {
      return null;
    }
    return buildOccurrence({
      event,
      start: span.start,
      end: span.end,
      allDay: false,
      isRecurring: false,
      originalStart: span.start,
    });
  }

  // 時間指定の繰り返し: occurrenceStart ちょうどに始まる有効な発生があるか検証
  const hits = expandRecurrence({
    rrule: event.rrule,
    dtstart: span.start,
    timeZone,
    exdates: resolveExcludedInstants(event, timeZone),
    range: { start: occurrenceStart, end: new Date(targetTime + 1) },
  });
  if (!hits.some((hit) => hit.getTime() === targetTime)) {
    return null;
  }
  const start = new Date(targetTime);
  return buildOccurrence({
    event,
    start,
    end: new Date(targetTime + span.durationMs),
    allDay: false,
    isRecurring: true,
    originalStart: start,
  });
}
