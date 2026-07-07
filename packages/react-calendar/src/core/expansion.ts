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
 * （Google カレンダーと同じ挙動）。展開時には表示タイムゾーンにおける
 * その日付の 0:00 を発生の開始絶対時刻とする。
 */

import type { CalendarEvent, DateRange, EventId, EventOccurrence, TimeZoneId } from './types';

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
  void eventId;
  void start;
  throw new Error('未実装');
}

/**
 * イベント集合を指定範囲に展開し、発生一覧を返す。
 *
 * 処理内容:
 * - **単発イベント** — `[start, end)` が範囲と重なれば 1 件の発生になる
 * - **繰り返しイベント**（`rrule` あり）— 範囲内に開始する発生に展開する。
 *   イベントの長さ（`end - start` の壁時計上の長さ）は全発生で維持される
 * - **EXDATE**（`exdates`）— 該当する発生を除外する
 * - **オーバーライド**（`recurringEventId` + `originalStart` あり）—
 *   参照先イベントの `originalStart` の発生を置き換える。オーバーライド
 *   自身の `[start, end)` が範囲と重なれば発生として出力される
 *   （元の発生時刻が範囲外でも、移動先が範囲内なら表示される）
 * - **終日イベント** — 日付ベースで解釈し、表示タイムゾーンの 0:00 を
 *   発生の開始とする
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
  void params;
  throw new Error('未実装');
}

/**
 * 単一イベントの、指定した発生開始時刻における発生を解決する。
 *
 * ドラッグ操作やクリック時に、対象の発生の正確な `[start, end)` を
 * 再計算するために使用する。
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
  void params;
  throw new Error('未実装');
}
