/**
 * @packageDocumentation
 * キーボードショートカット（Google カレンダー準拠）。
 *
 * - `M` / `W` / `D` / `A` — 月 / 週 / 日 / リスト表示に切り替え
 * - `T` — 今日へ移動
 * - `J` / `N` — 次の期間、`K` / `P` — 前の期間
 * - `C` — 予定の作成（`onCreate` コールバック）
 *
 * 入力欄（input / textarea / contentEditable）にフォーカスがある間は無効。
 */

import type { UseCalendarResult } from './types';

/**
 * キーボードショートカットを有効にするフック。
 *
 * `document` に `keydown` リスナーを登録し、アンマウント時に解除する。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.enabled - 一時的に無効化する場合は `false`。既定は `true`
 * @param params.onCreate - `C` キーが押されたときに呼ばれる（作成 UI の起点）。
 *   省略時は何もしない
 */
export function useCalendarShortcuts(params: {
  calendar: UseCalendarResult;
  enabled?: boolean;
  onCreate?: () => void;
}): void {
  void params;
  throw new Error('未実装');
}
