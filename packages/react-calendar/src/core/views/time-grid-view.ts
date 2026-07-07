/**
 * @packageDocumentation
 * 週/日ビュー（時間グリッド）のビューモデル構築。
 *
 * 発生を「終日行」（帯）と「時間グリッド」（縦配置）に振り分け、
 * 日ごとに重なりレイアウトを適用する。
 */

import type { EventOccurrence, TimeGridViewModel, TimeZoneId, Weekday } from '../types';

/**
 * 週/日ビューのビューモデルを構築する。
 *
 * 振り分けルール（Google カレンダーと同じ）:
 * - `allDay: true` の発生、または表示タイムゾーンで複数日にまたがる発生は
 *   終日行のセグメントになる（帯レイアウトでレーン割当。あふれ制限はなし）
 * - それ以外（同一日内の時間指定イベント）は該当日の時間グリッドに配置される
 *
 * 時間グリッドの配置:
 * - 発生の日内位置は `minutesOfDayInZone` による壁時計の分で決まる
 * - 日をまたいでクランプされた場合は `continuesBefore` / `continuesAfter` が立ち、
 *   終了は 1440 分（24:00）になる
 * - 同じ日で重なる発生は {@link layoutTimeGridItems} で横並びになる
 *
 * @param params.currentDate - 基準日
 * @param params.viewType - `'week'`（7 日）または `'day'`（1 日）
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みの発生一覧
 * @param params.weekStartsOn - 週の開始曜日（`'week'` のときのみ使用）
 * @param params.slotMinutes - 時間軸の目盛り間隔（分）
 * @param params.now - 現在時刻（`isToday` 判定と現在時刻線に使用）
 */
export function buildTimeGridViewModel(params: {
  currentDate: Date;
  viewType: 'week' | 'day';
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  slotMinutes: number;
  now: Date;
}): TimeGridViewModel {
  void params;
  throw new Error('未実装');
}
