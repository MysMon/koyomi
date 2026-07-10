/**
 * @packageDocumentation
 * 複数月ビューのビューモデル構築。
 *
 * 月ビューを `multiMonthCount` ヶ月分連結する。帯レイアウト・`hiddenWeekdays` の
 * 可視列変換・あふれ計算はすべて {@link buildMonthViewModel} に委譲し、重複実装を持たない。
 * 各月には `segmentRange`（`[その月初, 翌月初)`）を渡すことで
 * 「予定は自分の月のグリッドにのみ描画する」規則を実現する。月境界をまたぐ予定は
 * 月ごとにクランプされ、`continuesBefore` / `continuesAfter` で「←続く / 続く→」を示す。
 */

import { addMonthsInZone, startOfMonthInZone } from '../date-utils';
import { dateKeyInZone, startOfDayInZone } from '../timezone';
import type {
  EventOccurrence,
  MultiMonthMonth,
  MultiMonthViewModel,
  TimeZoneId,
  Weekday,
} from '../types';
import { buildMonthViewModel } from './month-view';

/**
 * 複数月ビューのビューモデルを構築する。
 *
 * 処理内容:
 * - `currentDate` を含む月の月初（{@link startOfMonthInZone}）を先頭月の `anchor` とし、
 *   `multiMonthCount` ヶ月分について月ごとに {@link buildMonthViewModel} を呼ぶ
 * - 各月の呼び出しでは `currentDate` にその月の月初（`addMonthsInZone(anchor, i, timeZone)`）を渡し、
 *   `segmentRange` に `[その月初, 翌月初)` を渡す。境界の日時は `addMonthsInZone` が
 *   現地時刻の加算であることに備えて {@link startOfDayInZone} で日の開始へ再正規化する
 *   （`monthGridRange` と同じ理由）
 * - オカレンスは月ごとにフィルタせず全量をそのまま渡す（月ビルダーが `segmentRange` と
 *   重ならないオカレンスを自然に除外するため、ここでの事前フィルタは不要）
 * - `weeks` は各月の {@link buildMonthViewModel} の結果をそのまま束ねる
 *   （前後月の日付セルは `segmentRange` によって予定が配置されないため、月をまたいで
 *   同じ日付が二重に描画される問題は生じない）
 * - `weekdays`（曜日ヘッダー）は先頭月のビューモデルのものを流用する
 *   （全月で `weekStartsOn` が共通のため、どの月から求めても同じ結果になる）
 *
 * @param params.currentDate - 表示対象の先頭月に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲全体で展開済みのオカレンス一覧
 * @param params.weekStartsOn - 週の開始曜日
 * @param params.dayMaxEvents - 1 日に表示する最大イベント数
 * @param params.hiddenWeekdays - 非表示にする曜日。省略時は `[]`（すべて表示）
 * @param params.multiMonthCount - 表示する月数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 * @returns 複数月ビューのビューモデル
 * @example
 * ```ts
 * const viewModel = buildMultiMonthViewModel({
 *   currentDate: new Date('2026-07-10T00:00:00+09:00'),
 *   timeZone: 'Asia/Tokyo',
 *   occurrences,
 *   weekStartsOn: 0,
 *   dayMaxEvents: 4,
 *   multiMonthCount: 3,
 *   now: new Date(),
 * });
 * viewModel.months.map((month) => month.key); // => ['2026-07', '2026-08', '2026-09']
 * ```
 */
export function buildMultiMonthViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  dayMaxEvents: number;
  hiddenWeekdays?: readonly Weekday[];
  multiMonthCount: number;
  now: Date;
}): MultiMonthViewModel {
  const {
    currentDate,
    timeZone,
    occurrences,
    weekStartsOn,
    dayMaxEvents,
    hiddenWeekdays,
    multiMonthCount,
    now,
  } = params;

  const anchor = startOfMonthInZone(currentDate, timeZone);

  const months: MultiMonthMonth[] = [];
  let weekdays: readonly Weekday[] = [];

  for (let index = 0; index < multiMonthCount; index += 1) {
    const monthAnchor = addMonthsInZone(anchor, index, timeZone);
    // segmentRange の境界は addMonthsInZone（現地時刻加算）のずれに備えて
    // startOfDayInZone で日の開始へ再正規化する（monthGridRange の end 計算と同じ理由）
    const monthStart = startOfDayInZone(monthAnchor, timeZone);
    const nextMonthStart = startOfDayInZone(addMonthsInZone(monthStart, 1, timeZone), timeZone);

    const monthViewModel = buildMonthViewModel({
      currentDate: monthAnchor,
      timeZone,
      occurrences,
      weekStartsOn,
      dayMaxEvents,
      now,
      segmentRange: { start: monthStart, end: nextMonthStart },
      ...(hiddenWeekdays !== undefined ? { hiddenWeekdays } : {}),
    });

    months.push({
      anchor: monthViewModel.anchor,
      key: dateKeyInZone(monthViewModel.anchor, timeZone).slice(0, 7),
      weeks: monthViewModel.weeks,
    });

    if (index === 0) {
      weekdays = monthViewModel.weekdays;
    }
  }

  return { type: 'multiMonth', anchor, months, weekdays };
}
