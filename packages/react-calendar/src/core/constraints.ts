/**
 * @packageDocumentation
 * 宣言的な重なり・配置制約（{@link CalendarOptions.eventOverlap} /
 * {@link CalendarOptions.eventConstraint}）の判定を行う純粋関数群。
 *
 * ドラッグ中のプレビュー計算（毎 pointermove）とコミット確定（移動・リサイズ・
 * 新規作成・外部ドラッグ受け入れ・キーボード操作）の両方が、判定の唯一の入口
 * {@link isDragCandidateValid} を同じ呼び方で使う。React に依存しない。
 */

import { rangesOverlap } from './date-utils';
import {
  addDaysInZone,
  minutesOfDayInZone,
  parseTimeOfDay,
  startOfDayInZone,
  weekdayInZone,
} from './timezone';
import type { BusinessHoursRule, CalendarEvent, DateRange, TimeZoneId } from './types';

/**
 * 重なり判定の対象となる既存オカレンス 1 件分（絶対時刻の区間のみ）。
 */
export interface OverlapBlocker {
  /** オカレンスのキー（{@link EventOccurrence.key}）。自分自身の除外に使う。 */
  key: string;
  /** 絶対時刻の開始。 */
  start: Date;
  /** 絶対時刻の終了（排他）。 */
  end: Date;
  /**
   * このオカレンス自身が他の重なりを拒否するか（{@link occurrenceBlocksOverlap} の結果）。
   */
  blocksOverlap: boolean;
}

/**
 * イベントの重なり許可の実効値（`event.overlap` ?? `eventOverlap`）が `false` かどうかを判定する。
 *
 * `false` の場合、そのオカレンスは他のオカレンスと重ねられることを拒否する
 * （{@link hasBlockingOverlap} の `blocker.blocksOverlap` に使う）。
 *
 * @param event - 対象のイベント
 * @param eventOverlap - {@link CalendarOptions.eventOverlap} の実効値（既定 `true`）
 * @returns このオカレンスが重なりを拒否するか
 */
export function occurrenceBlocksOverlap(event: CalendarEvent, eventOverlap: boolean): boolean {
  return (event.overlap ?? eventOverlap) === false;
}

/**
 * `candidate` が `blockers`（`excludeKey` に一致するものは除外）のいずれかと
 * 時間的に重なり、かつ拒否されるべきかどうかを判定する。
 *
 * FullCalendar の `eventOverlap` セマンティクス（このイベントを他に重ねられない・
 * 他をこのイベントに重ねられない、の両方向）に合わせ、「動かしている側
 * （`moverBlocksOverlap`）」と「重ねられる側（各 `blocker.blocksOverlap`）」の
 * どちらかが拒否（`true`）なら、その組み合わせの重なりを拒否する。
 *
 * @param candidate - 判定対象の日時範囲
 * @param excludeKey - 判定から除外するオカレンスのキー（自分自身。`null` は除外なし）
 * @param blockers - 判定対象の既存オカレンス一覧
 * @param moverBlocksOverlap - 動かしている側（ドラッグ対象、または新規作成・外部ドラッグでは
 *   {@link CalendarOptions.eventOverlap} をそのまま使う）が重なりを拒否するか
 * @returns 拒否されるべき重なりが 1 件でもあれば `true`
 * @example
 * ```ts
 * // 接触するだけ（end === start）は重なりとみなさない
 * hasBlockingOverlap(candidate, null, [blocker], true); // => false（端点が接触するのみの場合）
 * ```
 */
export function hasBlockingOverlap(
  candidate: DateRange,
  excludeKey: string | null,
  blockers: readonly OverlapBlocker[],
  moverBlocksOverlap: boolean,
): boolean {
  for (const blocker of blockers) {
    if (blocker.key === excludeKey) {
      continue;
    }
    if (!rangesOverlap(candidate, { start: blocker.start, end: blocker.end })) {
      continue;
    }
    if (moverBlocksOverlap || blocker.blocksOverlap) {
      return true;
    }
  }
  return false;
}

/**
 * `range`（終日を除く）が `rules` の和集合に完全に収まっているかどうかを判定する。
 *
 * 日ごとに走査し、各日の候補区間（現地時刻の日境界でクランプ済み）が、その日の
 * 曜日に該当するいずれかのルールの `startTime`〜`endTime` に完全に収まっているかを
 * 確認する（1 日でも収まらない部分があれば `false`）。DST の切替日でも現地時刻
 * 基準で判定するため、実際の経過時間（23/25 時間）の影響を受けない。
 *
 * `BusinessHoursRule.endTime` は `'HH:mm'` 形式のみで `'24:00'` を表現できないため、
 * 日をまたぐ候補区間はその初日が必ず日境界（24:00 相当）まで達し、どれだけ広い
 * ルールでも最後の 1 分をカバーできず常に `false` になる（複数日にまたがる
 * 時間指定イベントは実質的にこの制約を満たせない）。
 *
 * @param range - 判定対象の日時範囲（終日イベントの呼び出しは呼び出し側でスキップすること）
 * @param rules - 営業時間ルール一覧。空配列の場合は常に `false`（意図的な仕様。
 *   `eventConstraint: 'businessHours'` 指定時に `businessHours` が未設定だと
 *   常に無効になる落とし穴として、利用者向けドキュメントで明記する）
 * @param timeZone - 判定に使う現地時刻のタイムゾーン
 * @returns 完全に収まっていれば `true`
 */
export function isRangeWithinBusinessHours(
  range: DateRange,
  rules: readonly BusinessHoursRule[],
  timeZone: TimeZoneId,
): boolean {
  if (rules.length === 0) {
    return false;
  }
  let cursor = startOfDayInZone(range.start, timeZone);
  while (cursor.getTime() < range.end.getTime()) {
    const dayEnd = startOfDayInZone(addDaysInZone(cursor, 1, timeZone), timeZone);
    const segmentStart = range.start.getTime() > cursor.getTime() ? range.start : cursor;
    const segmentEnd = range.end.getTime() < dayEnd.getTime() ? range.end : dayEnd;
    if (segmentStart.getTime() < segmentEnd.getTime()) {
      const weekday = weekdayInZone(cursor, timeZone);
      const startMinutes = minutesOfDayInZone(segmentStart, timeZone);
      // segmentEnd がちょうど翌日 0:00（dayEnd）の場合、minutesOfDayInZone は
      // 翌日の 0 分を返してしまうため、その日の終端として 1440 に正規化する。
      const endMinutes =
        segmentEnd.getTime() === dayEnd.getTime() ? 1440 : minutesOfDayInZone(segmentEnd, timeZone);
      const coveredByAnyRule = rules.some((rule) => {
        if (!rule.daysOfWeek.includes(weekday)) {
          return false;
        }
        const ruleStart = parseTimeOfDay(rule.startTime);
        const ruleEnd = parseTimeOfDay(rule.endTime);
        return startMinutes >= ruleStart && endMinutes <= ruleEnd;
      });
      if (!coveredByAnyRule) {
        return false;
      }
    }
    cursor = dayEnd;
  }
  return true;
}

/**
 * `'businessHours'` 参照を実際のルール配列へ解決する。
 *
 * @param constraint - {@link CalendarOptions.eventConstraint} / {@link CalendarEvent.constraint} の値
 * @param businessHours - {@link CalendarOptions.businessHours} の実効値
 * @returns 未指定（`undefined` / `null`）なら `null`（制約なし）。`'businessHours'` なら
 *   `businessHours` をそのまま返す（空配列なら常に無効という落とし穴になる）。配列指定なら
 *   その配列をそのまま返す
 */
export function resolveConstraintRules(
  constraint: 'businessHours' | readonly BusinessHoursRule[] | undefined | null,
  businessHours: readonly BusinessHoursRule[],
): readonly BusinessHoursRule[] | null {
  if (constraint === undefined || constraint === null) {
    return null;
  }
  return constraint === 'businessHours' ? businessHours : constraint;
}

/**
 * 宣言的制約（`eventOverlap` / `eventConstraint`）の判定の唯一の入口。
 *
 * ドラッグ中のプレビュー計算（毎 pointermove）とコミット確定（移動・リサイズ・
 * 新規作成・外部ドラッグ受け入れ・キーボード操作）の両方が、この関数を同じ呼び方で使う。
 * 判定順序は重なり（{@link hasBlockingOverlap}）を先に見て、重なりがなければ
 * 配置制約（{@link isRangeWithinBusinessHours}、終日は対象外）を見る。
 *
 * @param params.range - 判定対象の日時範囲
 * @param params.allDay - 終日としての判定か（`true` の場合 `constraintRules` は無視される）
 * @param params.excludeKey - 判定から除外するオカレンスのキー（自分自身。`null` は除外なし）
 * @param params.moverBlocksOverlap - 動かしている側が重なりを拒否するか
 *   （{@link hasBlockingOverlap} の同名引数と同義）
 * @param params.blockers - 重なり判定の対象となる既存オカレンス一覧
 * @param params.constraintRules - {@link resolveConstraintRules} で解決済みの配置制約ルール
 *   （`null` は制約なし）
 * @param params.timeZone - 判定に使う現地時刻のタイムゾーン
 * @returns 移動・リサイズ・作成してよければ `true`
 */
export function isDragCandidateValid(params: {
  range: DateRange;
  allDay: boolean;
  excludeKey: string | null;
  moverBlocksOverlap: boolean;
  blockers: readonly OverlapBlocker[];
  constraintRules: readonly BusinessHoursRule[] | null;
  timeZone: TimeZoneId;
}): boolean {
  const { range, allDay, excludeKey, moverBlocksOverlap, blockers, constraintRules, timeZone } =
    params;
  if (hasBlockingOverlap(range, excludeKey, blockers, moverBlocksOverlap)) {
    return false;
  }
  if (!allDay && constraintRules !== null) {
    return isRangeWithinBusinessHours(range, constraintRules, timeZone);
  }
  return true;
}
