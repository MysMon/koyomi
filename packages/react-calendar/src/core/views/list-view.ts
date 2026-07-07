/**
 * @packageDocumentation
 * リストビューのビューモデル構築。
 *
 * 表示範囲内の発生を日付ごとにグループ化する。Google カレンダーの
 * 「スケジュール」表示と同様、複数日にまたがる発生は重なる各日に出現する。
 */

import { eachDayInRange, rangesOverlap } from '../date-utils';
import { addDaysInZone, dateKeyInZone, startOfDayInZone } from '../timezone';
import type { EventOccurrence, ListDay, ListViewModel, TimeZoneId } from '../types';

/**
 * リストビューのビューモデルを構築する。
 *
 * - 表示範囲（基準日から `listDays` 日間）の各日について、その日と重なる
 *   発生を集める。発生が 1 件もない日は出力しない
 * - 範囲は表示タイムゾーンにおける基準日の 0:00 から始まり、日の重なり判定は
 *   `[その日の 0:00, 翌日の 0:00)` との交差（`end` 排他）で行う。
 *   したがって、ちょうど 0:00 に終わる発生はその日には出現しない
 * - 日内の並び順: 終日イベントが先、その後は開始時刻昇順（同時刻は長い方が先、
 *   それも同じ場合は `eventId` の辞書順）
 * - `isToday` は `now` が表示タイムゾーンで同じ日かどうかで判定する
 *
 * @param params.currentDate - 基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みの発生一覧
 * @param params.listDays - 表示日数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 * @returns 予定のある日だけを日付順に並べた {@link ListViewModel}。
 *   全日空の場合は `isEmpty` が `true` になる
 */
export function buildListViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  listDays: number;
  now: Date;
}): ListViewModel {
  const { currentDate, timeZone, occurrences, listDays, now } = params;

  // 表示範囲: 基準日の 0:00 から listDays 日間（壁時計基準で加算）
  const rangeStart = startOfDayInZone(currentDate, timeZone);
  const rangeEnd = addDaysInZone(rangeStart, listDays, timeZone);
  const dayStarts = eachDayInRange({ start: rangeStart, end: rangeEnd }, timeZone);

  const todayKey = dateKeyInZone(now, timeZone);
  const days: ListDay[] = [];

  for (const dayStart of dayStarts) {
    const dayEnd = addDaysInZone(dayStart, 1, timeZone);
    // [day, 翌日) と重なる発生を集める（end 排他の交差判定）
    const dayOccurrences = occurrences.filter((occurrence) =>
      rangesOverlap(
        { start: occurrence.start, end: occurrence.end },
        { start: dayStart, end: dayEnd },
      ),
    );
    // 発生が 1 件もない日は出力しない
    if (dayOccurrences.length === 0) {
      continue;
    }
    dayOccurrences.sort(compareListOccurrences);

    const key = dateKeyInZone(dayStart, timeZone);
    days.push({
      date: dayStart,
      key,
      isToday: key === todayKey,
      occurrences: dayOccurrences,
    });
  }

  return { type: 'list', days, isEmpty: days.length === 0 };
}

/**
 * リストビューの日内での発生の並び順を決める比較関数。
 *
 * 終日イベントが先 → 開始時刻昇順 → 長い方が先 → `eventId` の辞書順。
 *
 * @param a - 比較対象の発生
 * @param b - 比較対象の発生
 * @returns `a` を先に並べるなら負、`b` を先なら正、同順なら 0
 */
function compareListOccurrences(a: EventOccurrence, b: EventOccurrence): number {
  // 1. 終日イベントが先
  if (a.allDay !== b.allDay) {
    return a.allDay ? -1 : 1;
  }
  // 2. 開始時刻の昇順
  const startDiff = a.start.getTime() - b.start.getTime();
  if (startDiff !== 0) {
    return startDiff;
  }
  // 3. 同時刻は長い方が先
  const durationDiff = b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime());
  if (durationDiff !== 0) {
    return durationDiff;
  }
  // 4. eventId の辞書順
  if (a.eventId < b.eventId) {
    return -1;
  }
  if (a.eventId > b.eventId) {
    return 1;
  }
  return 0;
}
