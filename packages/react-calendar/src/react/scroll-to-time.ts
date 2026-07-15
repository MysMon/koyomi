/**
 * @packageDocumentation
 * 時間グリッド・リソースビューの初期スクロール位置（`initialScrollTime` /
 * `scrollToTime`）で使う純粋関数と副作用関数。
 *
 * `CalendarOptions.slotMinTime`/`slotMaxTime` による表示時間帯制限とは独立して
 * 機能する（表示範囲が制限されていても、その範囲内の割合として計算する）。
 */

import { parseSlotBoundaryTime } from '../core/timezone';

/**
 * `'HH:mm'` 形式の時刻を、表示範囲（`rangeStartMinutes`〜`rangeEndMinutes`）に対する
 * 0〜1 の割合へ変換する。
 *
 * `time` が範囲外の時刻を指す場合は範囲の境界（0 または 1）にクランプする。
 * `time` が `'HH:mm'` として解析できない場合は例外を投げず `null` を返す
 * （`initialScrollTime` / `scrollToTime` は UI コマンドであり、`CalendarOptions` の
 * 検証とは異なり不正な入力を静かに無視する）。
 *
 * @param time - `'HH:mm'` 形式の時刻文字列（`'24:00'` も可）
 * @param rangeStartMinutes - 表示範囲の開始（分）
 * @param rangeEndMinutes - 表示範囲の終了（分）
 * @returns 0〜1 の割合。`time` が解析できない場合は `null`
 * @example
 * ```ts
 * scrollFractionForTime('09:00', 0, 1440); // => 0.375
 * scrollFractionForTime('07:00', 480, 1200); // => 0（範囲より前はクランプ）
 * ```
 */
export function scrollFractionForTime(
  time: string,
  rangeStartMinutes: number,
  rangeEndMinutes: number,
): number | null {
  let minutes: number;
  try {
    minutes = parseSlotBoundaryTime(time);
  } catch {
    return null;
  }
  // 退行的な範囲（終了が開始以下）では 0 除算になるため 0 を返す
  if (rangeEndMinutes <= rangeStartMinutes) {
    return 0;
  }
  const clamped = Math.min(Math.max(minutes, rangeStartMinutes), rangeEndMinutes);
  return (clamped - rangeStartMinutes) / (rangeEndMinutes - rangeStartMinutes);
}

/**
 * スクロールコンテナを指定時刻の位置へスクロールする（`scrollTop` への書き込み）。
 *
 * `time` が解析できない場合、または `element.scrollHeight` が 0（非表示など）の場合は
 * 何もしない（0 除算・無意味な `scrollTop = 0` 書き込みの防御）。
 *
 * @param element - スクロールコンテナ要素
 * @param time - `'HH:mm'` 形式の時刻文字列
 * @param rangeStartMinutes - 表示範囲の開始（分）
 * @param rangeEndMinutes - 表示範囲の終了（分）
 */
export function scrollContainerToTime(
  element: HTMLElement,
  time: string,
  rangeStartMinutes: number,
  rangeEndMinutes: number,
): void {
  const fraction = scrollFractionForTime(time, rangeStartMinutes, rangeEndMinutes);
  if (fraction === null || element.scrollHeight <= 0) {
    return;
  }
  element.scrollTop = fraction * element.scrollHeight;
}
