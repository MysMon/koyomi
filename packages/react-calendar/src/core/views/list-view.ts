/**
 * @packageDocumentation
 * リストビューのビューモデル構築。
 *
 * 表示範囲内のオカレンスを日付ごとにグループ化する。Google カレンダーの
 * 「スケジュール」表示と同様、複数日にまたがるオカレンスは重なる各日に出現する。
 */

import { eachDayInRange } from '../date-utils';
import { addDaysInZone, dateKeyInZone, startOfDayInZone } from '../timezone';
import type { EventOccurrence, ListDay, ListViewModel, TimeZoneId } from '../types';

/**
 * リストビューのビューモデルを構築する。
 *
 * - 表示範囲（基準日から `listDays` 日間）の各日について、その日と重なる
 *   オカレンスを集める。オカレンスが 1 件もない日は出力しない
 * - 範囲は表示タイムゾーンにおける基準日の 0:00 から始まり、日の重なり判定は
 *   `[その日の 0:00, 翌日の 0:00)` との交差（`end` 排他）で行う。
 *   したがって、ちょうど 0:00 に終わるオカレンスはその日には出現しない
 * - `start === end`（長さ 0、リマインダー等）のオカレンスは区間交差では常に
 *   「重なりなし」と判定されてしまうため特別扱いする。`start` が属する日
 *   （`[その日の 0:00, 翌日の 0:00)` に含まれる日）に 1 件として表示する
 * - 日内の並び順: 終日イベントが先、その後は開始時刻昇順（同時刻は長い方が先、
 *   それも同じ場合は `eventId` の辞書順）
 * - `isToday` は `now` が表示タイムゾーンで同じ日かどうかで判定する
 *
 * @param params.currentDate - 基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みのオカレンス一覧
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

  // 表示範囲: 基準日の 0:00 から listDays 日間（現地時刻基準で加算）
  const rangeStart = startOfDayInZone(currentDate, timeZone);
  const rangeEnd = addDaysInZone(rangeStart, listDays, timeZone);
  const dayStarts = eachDayInRange({ start: rangeStart, end: rangeEnd }, timeZone);

  const todayKey = dateKeyInZone(now, timeZone);

  // 各日の [開始, 終了) 境界を事前計算する。
  // addDaysInZone は加算前の現地時刻を維持するため、dayStart が深夜 0:00 の
  // 存在しないゾーン（例: America/Havana）の切替日で繰り上げられた時刻（例: 1:00）を
  // 持っていると、そのまま加算した dayEnd も同じ時刻になり翌日の本来の 0:00〜1:00 分だけ
  // 範囲が伸びてしまう。startOfDayInZone で日の開始へ再正規化して防ぐ。
  const dayEnds = dayStarts.map((dayStart) =>
    startOfDayInZone(addDaysInZone(dayStart, 1, timeZone), timeZone),
  );
  const dayEndTimes = dayEnds.map((dayEnd) => dayEnd.getTime());
  const dayStartTimes = dayStarts.map((dayStart) => dayStart.getTime());

  // 各日のバケットへオカレンスを振り分ける。全日 × 全予定の総当たり（O(日数×予定数)）を避け、
  // 二分探索で「その予定と重なり始める最初の日」を求めてから前方走査する。
  const buckets: EventOccurrence[][] = dayStarts.map(() => []);
  for (const occurrence of occurrences) {
    const startTime = occurrence.start.getTime();
    const endTime = occurrence.end.getTime();
    // 「dayEnd > 予定開始」を満たす最初の日（それ以前の日は予定開始までに終わっている）。
    const firstIndex = lowerBoundGreaterThan(dayEndTimes, startTime);
    if (firstIndex >= dayStarts.length) {
      continue;
    }
    // start === end（長さ 0、リマインダー等）は区間交差では常に「重なりなし」になるため、
    // start が属する日 1 つにだけ割り当てる。
    if (startTime === endTime) {
      const dayStartTime = dayStartTimes[firstIndex];
      if (dayStartTime !== undefined && startTime >= dayStartTime) {
        buckets[firstIndex]?.push(occurrence);
      }
      continue;
    }
    // 通常の予定: dayStart < 予定終了 を満たす日へ順に割り当てる（end 排他の交差）。
    for (let index = firstIndex; index < dayStarts.length; index += 1) {
      const dayStartTime = dayStartTimes[index];
      if (dayStartTime === undefined || dayStartTime >= endTime) {
        break;
      }
      buckets[index]?.push(occurrence);
    }
  }

  const days: ListDay[] = [];
  for (let index = 0; index < dayStarts.length; index += 1) {
    const dayOccurrences = buckets[index];
    const dayStart = dayStarts[index];
    // オカレンスが 1 件もない日は出力しない
    if (dayOccurrences === undefined || dayOccurrences.length === 0 || dayStart === undefined) {
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
 * 昇順ソート済み配列 `sorted` に対し、`sorted[i] > value` を満たす最小の添字 `i` を返す。
 * すべて `value` 以下なら配列長を返す（二分探索、O(log n)）。
 */
function lowerBoundGreaterThan(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const midValue = sorted[mid];
    if (midValue !== undefined && midValue > value) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/**
 * リストビューの日内でのオカレンスの並び順を決める比較関数。
 *
 * 終日イベントが先 → 開始時刻昇順 → 長い方が先 → `eventId` の辞書順。
 *
 * @param a - 比較対象のオカレンス
 * @param b - 比較対象のオカレンス
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
