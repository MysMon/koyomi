/**
 * @packageDocumentation
 * 月ビューのビューモデル構築。
 *
 * 月グリッド（4〜6 週 × 7 日）の各週に対して、発生を帯セグメントとして
 * 配置する。Google カレンダーの月表示と同様、時間指定の 1 日イベントも
 * 帯（span 1 のセグメント）として扱い、見た目の描き分けはコンポーネント側で行う。
 */

import type { EventOccurrence, MonthViewModel, TimeZoneId, Weekday } from '../types';

/**
 * 月ビューのビューモデルを構築する。
 *
 * 処理内容:
 * - {@link monthGridRange} で表示範囲（週の並び）を決め、週ごとに日を並べる
 * - 各発生を、表示タイムゾーンにおける日付スパンで週ごとのセグメントに分割する
 *   （週をまたぐ発生は週ごとに分かれ、`continuesBefore` / `continuesAfter` が立つ）
 * - 週ごとに帯レイアウト（{@link layoutBandItems}）でレーンを割り当て、
 *   `dayMaxEvents` を超えた分は `hidden` にして各日の `overflowCount` に集計する
 *
 * @param params.currentDate - 表示対象月に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 月グリッド範囲で展開済みの発生一覧
 * @param params.weekStartsOn - 週の開始曜日
 * @param params.dayMaxEvents - 1 日に表示する最大イベント数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 */
export function buildMonthViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  dayMaxEvents: number;
  now: Date;
}): MonthViewModel {
  void params;
  throw new Error('未実装');
}
