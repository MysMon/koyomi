/**
 * @packageDocumentation
 * リストビューのビューモデル構築。
 *
 * 表示範囲内の発生を日付ごとにグループ化する。Google カレンダーの
 * 「スケジュール」表示と同様、複数日にまたがる発生は重なる各日に出現する。
 */

import type { EventOccurrence, ListViewModel, TimeZoneId } from '../types';

/**
 * リストビューのビューモデルを構築する。
 *
 * - 表示範囲（基準日から `listDays` 日間）の各日について、その日と重なる
 *   発生を集める。発生が 1 件もない日は出力しない
 * - 日内の並び順: 終日イベントが先、その後は開始時刻昇順（同時刻は長い方が先）
 *
 * @param params.currentDate - 基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みの発生一覧
 * @param params.listDays - 表示日数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 */
export function buildListViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  listDays: number;
  now: Date;
}): ListViewModel {
  void params;
  throw new Error('未実装');
}
