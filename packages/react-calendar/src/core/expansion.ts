/**
 * @packageDocumentation
 * イベントの展開（{@link CalendarEvent} → {@link EventOccurrence}）。
 *
 * ソースイベントの集合を表示範囲に対して展開し、オカレンスの
 * 一覧を生成する。繰り返しの展開、EXDATE による除外、RDATE による追加、
 * オーバーライド（「この予定のみ変更」）による置換をここで算出する。
 *
 * ## 終日イベントとタイムゾーン
 *
 * 終日イベントは「カレンダー上の日付」に紐づき、タイムゾーンに依存しない
 * （Google カレンダーと同じ挙動）。日付の解釈は `event.timeZone ??
 * displayTimeZone` で行い、`'YYYY-MM-DD'` の日付キーに正規化したうえで、
 * 展開時には表示タイムゾーンにおけるその日付の 0:00 をオカレンスの開始絶対時刻
 * とする。表示タイムゾーンを変えてもオカレンスは常に同じ「日付」に現れる。
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

/** 置換済みオカレンスが 1 つもないことを表す空集合（時間指定マスター用）。 */
const NO_OVERRIDDEN_TIMES: ReadonlySet<number> = new Set();

/** 置換済みオカレンスが 1 つもないことを表す空集合（終日マスター用）。 */
const NO_OVERRIDDEN_KEYS: ReadonlySet<string> = new Set();

/**
 * オカレンスの一意キーを構築する。
 *
 * @param eventId - イベント ID
 * @param start - オカレンスの開始（絶対時刻）
 * @returns `` `${eventId}@${startのISO文字列}` `` 形式のキー
 * @example
 * ```ts
 * occurrenceKey('e1', new Date('2026-07-01T01:00:00Z')); // => 'e1@2026-07-01T01:00:00.000Z'
 * ```
 */
export function occurrenceKey(eventId: EventId, start: Date): string {
  return `${eventId}@${start.toISOString()}`;
}

/** 時間指定イベントの `[start, end)` を絶対時刻に変換した結果。 */
interface TimedSpan {
  /** 開始（絶対時刻）。 */
  start: Date;
  /** 終了（絶対時刻、排他）。 */
  end: Date;
  /** `end - start` のミリ秒差。繰り返しの各オカレンスでこの長さが維持される。 */
  durationMs: number;
}

/** 終日イベントを日付キー空間に変換した結果。 */
interface AllDaySpan {
  /** 開始日の日付キー（`'YYYY-MM-DD'`）。 */
  startKey: string;
  /** 日数（1 以上）。`end` は排他なのでキー差がそのまま日数になる。 */
  dayCount: number;
}

/**
 * 時間指定イベントの `start` / `end` を絶対時刻に変換する。
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
 * 終日イベントの `start` / `end` を日付キーと日数に変換する。
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

/** 日付キー起点の終日スパンを、表示タイムゾーンの絶対時刻範囲に変換する。 */
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
 * exdates を終日イベント用の「除外日付キー」集合に変換する。
 * `'YYYY-MM-DD'` でも、その日のどこかを指す `Date` でも同じキーになる。
 */
function resolveExcludedKeys(event: CalendarEvent, interpretTimeZone: TimeZoneId): Set<string> {
  const keys = new Set<string>();
  for (const exdate of event.exdates ?? []) {
    keys.add(dateKeyInZone(parseDateValue(exdate, interpretTimeZone, true), interpretTimeZone));
  }
  return keys;
}

/** exdates を時間指定イベント用の絶対時刻に変換する。 */
function resolveExcludedInstants(event: CalendarEvent, interpretTimeZone: TimeZoneId): Date[] {
  return (event.exdates ?? []).map((exdate) => parseDateValue(exdate, interpretTimeZone, false));
}

/**
 * rdates を終日イベント用の「追加日付キー」配列に変換する。
 * 形式は {@link resolveExcludedKeys} と同じ（`'YYYY-MM-DD'` でも、その日の
 * どこかを指す `Date` でも同じキーになる）。
 */
function resolveRdateKeys(event: CalendarEvent, interpretTimeZone: TimeZoneId): string[] {
  return (event.rdates ?? []).map((rdate) =>
    dateKeyInZone(parseDateValue(rdate, interpretTimeZone, true), interpretTimeZone),
  );
}

/** rdates を時間指定イベント用の絶対時刻に変換する。 */
function resolveRdateInstants(event: CalendarEvent, interpretTimeZone: TimeZoneId): Date[] {
  return (event.rdates ?? []).map((rdate) => parseDateValue(rdate, interpretTimeZone, false));
}

/**
 * オーバーライドイベント自身をオカレンスとして展開する（範囲に重なる場合のみ）。
 * `originalStart` には置換した元オカレンスの開始時刻（変換済み）を渡す。
 *
 * オーバーライド自身の `start` / `end` の解釈に用いるタイムゾーンは、この関数内で
 * originalStart を解釈する際（expandEvents 側）と同じ
 * `event.timeZone ?? masterTimeZone ?? displayTimeZone` の 3 段フォールバックに揃える。
 * こうしないと、オーバーライドが `timeZone` を省略した場合に表示 TZ で誤解釈され、
 * マスターと異なる現地時刻として扱われてしまう。
 */
function expandOverrideEvent(params: {
  event: CalendarEvent;
  originalStart: Date;
  range: DateRange;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
  /** マスターイベントの timeZone（分かる場合のみ渡す。マスターの timeZone へのフォールバックに使う）。 */
  masterTimeZone: TimeZoneId | undefined;
}): EventOccurrence[] {
  const { event, originalStart, range, displayTimeZone, defaultEventMinutes, masterTimeZone } =
    params;
  const timeZone = event.timeZone ?? masterTimeZone ?? displayTimeZone;
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
 * 食い込む分だけ手前に広げる。rdates 由来のキーを合成したうえで、
 * exdates・オーバーライド済みは日付キー一致で除外し、最終的に表示
 * タイムゾーンへ変換してから範囲との重なりで確定する。
 */
function expandAllDayRecurrence(params: {
  event: CalendarEvent;
  rrule: string;
  span: AllDaySpan;
  range: DateRange;
  displayTimeZone: TimeZoneId;
  interpretTimeZone: TimeZoneId;
  overriddenKeys: ReadonlySet<string>;
  rdateKeys: readonly string[];
}): EventOccurrence[] {
  const {
    event,
    rrule,
    span,
    range,
    displayTimeZone,
    interpretTimeZone,
    overriddenKeys,
    rdateKeys,
  } = params;
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
  // rrule 由来のオカレンスキーに rdates 由来のキーを合成する（同一日付は Set が自然に重複排除する）
  const keys = new Set(starts.map((startUtc) => dateKeyInZone(startUtc, DATE_KEY_ZONE)));
  for (const rdateKey of rdateKeys) {
    keys.add(rdateKey);
  }
  const occurrences: EventOccurrence[] = [];
  for (const key of keys) {
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
 * 通常イベント（オーバーライドでないもの。参照先のないオーバーライドを含む）を展開する。
 * `overriddenTimes` / `overriddenKeys` は、このイベントをマスターとする
 * オーバーライドによって置換済みの元オカレンスの集合。
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
    const rdateKeys = resolveRdateKeys(event, timeZone);
    if (event.rrule === undefined) {
      if (rdateKeys.length === 0) {
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
      // rrule なし・rdates ありの終日イベント: start のオカレンス + 各 rdate のオカレンスに
      // 展開する（Google カレンダー同様、rdates を持つ時点で編集スコープの
      // 対象になる繰り返し扱いとし isRecurring: true にする）
      const excludedKeys = resolveExcludedKeys(event, timeZone);
      const keys = new Set([span.startKey, ...rdateKeys]);
      const occurrences: EventOccurrence[] = [];
      for (const key of keys) {
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
    return expandAllDayRecurrence({
      event,
      rrule: event.rrule,
      span,
      range,
      displayTimeZone,
      interpretTimeZone: timeZone,
      overriddenKeys,
      rdateKeys,
    });
  }

  const span = resolveTimedSpan(event, timeZone, defaultEventMinutes);
  const rdateInstants = resolveRdateInstants(event, timeZone);
  if (event.rrule === undefined) {
    if (rdateInstants.length === 0) {
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
    // rrule なし・rdates ありの時間指定イベント: start のオカレンス + 各 rdate のオカレンスに展開する
    const excludedTimes = new Set(
      resolveExcludedInstants(event, timeZone).map((instant) => instant.getTime()),
    );
    const times = new Set([
      span.start.getTime(),
      ...rdateInstants.map((instant) => instant.getTime()),
    ]);
    const occurrences: EventOccurrence[] = [];
    for (const time of times) {
      if (excludedTimes.has(time) || overriddenTimes.has(time)) {
        continue;
      }
      const occStart = new Date(time);
      const occEnd = new Date(time + span.durationMs);
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

  // 範囲開始前に始まり範囲に食い込むオカレンスを取りこぼさないよう、
  // 問い合わせ範囲をイベントの長さ分だけ手前に広げる
  const startMargin = Math.max(0, span.durationMs);
  const excludedInstants = resolveExcludedInstants(event, timeZone);
  const excludedTimes = new Set(excludedInstants.map((instant) => instant.getTime()));
  const starts = expandRecurrence({
    rrule: event.rrule,
    dtstart: span.start,
    timeZone,
    exdates: excludedInstants,
    range: { start: new Date(range.start.getTime() - startMargin), end: range.end },
  });
  // rrule 由来のオカレンスの時刻に rdates 由来の時刻を合成する（同一ミリ秒は Set が自然に
  // 重複排除する。rdates も exdates による除外を受ける）
  const times = new Set(starts.map((occStart) => occStart.getTime()));
  for (const rdateInstant of rdateInstants) {
    const time = rdateInstant.getTime();
    if (!excludedTimes.has(time)) {
      times.add(time);
    }
  }
  const occurrences: EventOccurrence[] = [];
  for (const time of times) {
    if (overriddenTimes.has(time)) {
      continue;
    }
    const occStart = new Date(time);
    const occEnd = new Date(time + span.durationMs);
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
 * オカレンスの表示順比較関数。
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
 * イベント集合を指定範囲に展開し、オカレンス一覧を返す。
 *
 * 処理内容:
 * - **単発イベント** — `[start, end)` が範囲と重なれば 1 件のオカレンスになる
 * - **繰り返しイベント**（`rrule` あり）— 範囲と重なるオカレンスに展開する
 *   （範囲開始前に始まり範囲に食い込むオカレンスを含む）。各オカレンスの長さは
 *   マスターの `start` / `end` のミリ秒差を維持し、終日の繰り返しは
 *   日数を維持する。`UNTIL` はイベント TZ の現地時刻として解釈される
 * - **EXDATE**（`exdates`）— 該当するオカレンスを除外する。時間指定イベントは
 *   オカレンスの開始のミリ秒一致、終日イベントは日付キー一致で判定する
 * - **RDATE**（`rdates`）— `rrule` のオカレンスに追加のオカレンスを合成する。`rrule` と
 *   同一時刻の `rdate` は重複させない。`exdates` は `rdate` 由来のオカレンスにも
 *   適用される（除外が優先）。`rrule` なしで `rdates` のみを持つイベントは
 *   `start` のオカレンスと各 `rdate` のオカレンスに展開され、`isRecurring: true` になる
 *   （繰り返し扱いとして編集スコープの対象になる）
 * - **オーバーライド**（`recurringEventId` + `originalStart` あり）—
 *   参照先イベントの `originalStart` のオカレンスを置き換える。オーバーライド
 *   自身の `[start, end)` が範囲と重なればオカレンスとして出力される
 *   （元のオカレンスの時刻が範囲外でも、移動先が範囲内なら表示される。逆に
 *   範囲内から範囲外へ移動したオカレンスは表示されない）。参照先マスターが
 *   存在しない場合は防御的に単発イベントとして扱う
 * - **終日イベント** — 日付ベースで解釈し（`event.timeZone ??
 *   displayTimeZone` で日付キーに正規化）、表示タイムゾーンの 0:00 を
 *   オカレンスの開始とする。複数日は `end` 排他で日数を維持する
 *
 * 戻り値は開始時刻の昇順（同時刻なら長い方が先、さらに同じなら
 * `eventId` の辞書順）でソートされる。
 *
 * @param params.events - ソースイベントの集合
 * @param params.range - 展開範囲（`end` 排他）
 * @param params.displayTimeZone - 表示タイムゾーン
 * @param params.defaultEventMinutes - `end` 省略時の既定の長さ（分）
 * @returns オカレンスの一覧（ソート済み）
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

  // マスター ID → オーバーライドで置換済みの元オカレンス（時間指定はミリ秒、終日は日付キー）
  const overriddenTimesByMaster = new Map<EventId, Set<number>>();
  const overriddenKeysByMaster = new Map<EventId, Set<string>>();
  // オーバーライドイベント ID → 変換済みの元オカレンスの開始時刻（オカレンスの originalStart になる値）
  const resolvedOriginalStarts = new Map<EventId, Date>();
  // オーバーライドイベント ID → マスターの timeZone（オーバーライド自身の start/end 解釈の
  // フォールバックに使う。expandOverrideEvent に渡す）
  const masterTimeZoneByOverride = new Map<EventId, TimeZoneId | undefined>();

  for (const event of events) {
    const masterId = event.recurringEventId;
    const original = event.originalStart;
    if (masterId === undefined || original === undefined) {
      continue;
    }
    const master = eventsById.get(masterId);
    if (master === undefined) {
      // 参照先のないオーバーライド: 防御的に単発イベントとして扱う（通常ルートで処理）
      continue;
    }
    masterTimeZoneByOverride.set(event.id, master.timeZone);
    // originalStart はマスターのオカレンスを指すため、オーバーライド TZ →
    // マスター TZ → 表示 TZ の順でフォールバックして現地時刻を解釈する
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
      // 終日の元オカレンスは表示 TZ におけるその日付の 0:00
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
          masterTimeZone: masterTimeZoneByOverride.get(event.id),
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
 * 単一イベントの、指定したオカレンスの開始時刻におけるオカレンスを算出する。
 *
 * ドラッグ操作やクリック時に、対象のオカレンスの正確な `[start, end)` を
 * 再計算するために使用する。
 *
 * 算出ルール:
 * - **単発イベント** — 解釈済みの `start`（終日は表示 TZ の 0:00）が
 *   `occurrenceStart` とミリ秒単位で一致すればオカレンスを返す
 * - **繰り返しイベント** — `occurrenceStart` が繰り返しの有効なオカレンスか検証する
 *   （`exdates` で除外済みのオカレンスは `null`）。終日の繰り返しは表示 TZ の
 *   0:00 ちょうど、かつ有効なオカレンスの日の場合のみ一致する
 * - **オーバーライドイベント** — 現在の `start` に一致した場合のみオカレンスを返し、
 *   `originalStart` には元オカレンスの開始時刻を設定する。オーバーライドされた
 *   元オカレンスの時刻（移動済みで存在しないオカレンス）には `null` を返す
 *
 * `event.timeZone` 省略時の解釈に用いるタイムゾーンは `params.master` を渡せば
 * `event.timeZone ?? master.timeZone ?? displayTimeZone` の 3 段フォールバックになり、
 * expandEvents / expandOverrideEvent と同じ解釈になる（省略時は
 * `event.timeZone ?? displayTimeZone` の 2 段のみ。マスターの `timeZone` へは
 * 継承されない点に注意）。
 *
 * @param params.event - 対象イベント
 * @param params.occurrenceStart - オカレンスの開始時刻
 * @param params.displayTimeZone - 表示タイムゾーン
 * @param params.defaultEventMinutes - `end` 省略時の既定の長さ（分）
 * @param params.master - `event` がオーバーライドの場合の親（マスター）イベント。
 *   渡せる場合は指定すると `event.timeZone` 省略時の解釈がマスターの
 *   `timeZone` にフォールバックする（expandEvents と同じ解釈を保証するため）
 * @returns オカレンス。該当するオカレンスが存在しない場合は `null`
 */
export function resolveOccurrence(params: {
  event: CalendarEvent;
  occurrenceStart: Date;
  displayTimeZone: TimeZoneId;
  defaultEventMinutes: number;
  master?: CalendarEvent;
}): EventOccurrence | null {
  const { event, occurrenceStart, displayTimeZone, defaultEventMinutes, master } = params;
  const timeZone = event.timeZone ?? master?.timeZone ?? displayTimeZone;
  const targetTime = occurrenceStart.getTime();

  // オーバーライドイベント: 現在の start に一致した場合のみオカレンスとする
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
    const rdateKeys = resolveRdateKeys(event, timeZone);
    const excludedKeys = resolveExcludedKeys(event, timeZone);
    if (event.rrule === undefined) {
      // rrule なし: マスターの開始日 + 各 rdate の日が有効なオカレンス。
      // rdates を持つ場合は展開時と同じく isRecurring: true（編集スコープの対象）にする。
      const isRecurring = rdateKeys.length > 0;
      for (const key of new Set([span.startKey, ...rdateKeys])) {
        if (excludedKeys.has(key)) {
          continue;
        }
        const projected = projectAllDaySpan(key, span.dayCount, displayTimeZone);
        if (projected.start.getTime() === targetTime) {
          return buildOccurrence({
            event,
            start: projected.start,
            end: projected.end,
            allDay: true,
            isRecurring,
            originalStart: projected.start,
          });
        }
      }
      return null;
    }
    // 終日の繰り返し: 表示 TZ の 0:00 ちょうど、かつ「rrule 由来 or rdate 由来」の有効な日のみ一致
    const key = dateKeyInZone(occurrenceStart, displayTimeZone);
    if (dateFromKey(key, displayTimeZone).getTime() !== targetTime) {
      return null;
    }
    if (excludedKeys.has(key)) {
      return null;
    }
    let valid = rdateKeys.includes(key);
    if (!valid) {
      const keyInstant = dateFromKey(key, DATE_KEY_ZONE);
      const hits = expandRecurrence({
        rrule: event.rrule,
        dtstart: dateFromKey(span.startKey, DATE_KEY_ZONE),
        timeZone: DATE_KEY_ZONE,
        range: { start: keyInstant, end: new Date(keyInstant.getTime() + 1) },
      });
      valid = hits.length > 0;
    }
    if (!valid) {
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
  const rdateInstants = resolveRdateInstants(event, timeZone);
  const excludedTimes = new Set(
    resolveExcludedInstants(event, timeZone).map((instant) => instant.getTime()),
  );
  if (event.rrule === undefined) {
    // rrule なし: マスターの開始 + 各 rdate が有効なオカレンス（exdates で除外）。
    const validTimes = new Set([
      span.start.getTime(),
      ...rdateInstants.map((instant) => instant.getTime()),
    ]);
    if (excludedTimes.has(targetTime) || !validTimes.has(targetTime)) {
      return null;
    }
    const isRecurring = rdateInstants.length > 0;
    const start = new Date(targetTime);
    return buildOccurrence({
      event,
      start,
      end: new Date(targetTime + span.durationMs),
      allDay: false,
      isRecurring,
      originalStart: start,
    });
  }

  // 時間指定の繰り返し: occurrenceStart ちょうどに始まる「rrule 由来 or rdate 由来」の
  // 有効なオカレンスがあるか検証する（rdates も exdates による除外を受ける）
  const hits = expandRecurrence({
    rrule: event.rrule,
    dtstart: span.start,
    timeZone,
    exdates: resolveExcludedInstants(event, timeZone),
    range: { start: occurrenceStart, end: new Date(targetTime + 1) },
  });
  const validTimes = new Set(hits.map((hit) => hit.getTime()));
  for (const instant of rdateInstants) {
    const time = instant.getTime();
    if (!excludedTimes.has(time)) {
      validTimes.add(time);
    }
  }
  if (!validTimes.has(targetTime)) {
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
