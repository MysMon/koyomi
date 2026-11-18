/**
 * @packageDocumentation
 * `memo` の比較関数で共通に使う、オカレンスの同値判定。
 */

import type { EventOccurrence } from '../../core/types';

/**
 * 2 つのオカレンスが、描画内容とイベントハンドラへ渡す値の両方について同じとみなせるかを返す。
 *
 * 元イベント（`event`）は**参照**で比較する。イベントストアは変更のないイベントの
 * オブジェクトを使い回し、変更したイベントだけを新しいオブジェクトへ差し替えるため、
 * 参照が同じならタイトル・色に限らずすべての項目（`location` / `rrule` / `extendedProps` 等）が
 * 同じであり、参照が違えば何らかの項目が変わっている。項目ごとの比較と違い、
 * カスタムレンダラーやコールバックが読む項目を取りこぼさない。
 *
 * オカレンス固有の値（キー・開始/終了・終日区分・繰り返し区分・元の開始時刻）は
 * ビューモデルの再構築のたびに新しいオブジェクトになるため、値で比較する。
 *
 * @param a - 比較するオカレンス
 * @param b - 比較するオカレンス
 * @returns 同じとみなせる場合は `true`
 */
export function sameOccurrence(a: EventOccurrence, b: EventOccurrence): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    a.event === b.event &&
    a.allDay === b.allDay &&
    a.isRecurring === b.isRecurring &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    a.originalStart.getTime() === b.originalStart.getTime()
  );
}
