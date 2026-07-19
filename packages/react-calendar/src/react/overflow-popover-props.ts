/**
 * @packageDocumentation
 * `overflowPopoverButtonProps` — 月ビュー・複数月ビューの「+N 件」ボタンに
 * 自前ポップオーバーの開閉状態を伝える ARIA 属性一式を組み立てる純関数。
 */

import type { MonthOverflowButtonProps } from './types';

/**
 * {@link overflowPopoverButtonProps} のオプション。
 */
export interface OverflowPopoverButtonOptions {
  /** ポップオーバーが開いているか（`aria-expanded` にそのまま反映される）。 */
  open: boolean;
  /**
   * ポップオーバー要素の `id`。開いている間だけ `aria-controls` として
   * 関連付けられる（閉じている間はポップオーバー要素が DOM に存在しない前提の
   * ため付与しない）。省略時は `aria-controls` を付与しない。
   */
  popoverId?: string;
  /**
   * `aria-haspopup` に設定するポップアップの種類。省略時は `'dialog'`
   * （隠れた予定の一覧をダイアログとして開く、最も一般的な構成向けの既定値）。
   */
  haspopup?: MonthOverflowButtonProps['aria-haspopup'];
}

/**
 * 「+N 件」ボタンに追加する ARIA 属性一式（`aria-haspopup` / `aria-expanded` /
 * `aria-controls`）を開閉状態から組み立てる。
 *
 * `MonthView` / `MultiMonthView` の `overflowButtonProps` から戻り値をそのまま
 * 返す用途を想定したヘルパー。ポップオーバー UI 自体は提供しない（ヘッドレス）
 * ため、開閉状態の管理・位置決め・フォーカス管理は利用側の責務になる。
 * フォーカス復帰の規約など、ポップオーバー実装時のアクセシビリティ指針は
 * `docs/accessibility.md` を参照。
 *
 * @param options - 開閉状態・ポップオーバー要素の id・ポップアップの種類
 * @returns 「+N 件」ボタンにスプレッドできる {@link MonthOverflowButtonProps}
 * @example
 * ```tsx
 * <MonthView
 *   overflowButtonProps={(day) =>
 *     overflowPopoverButtonProps({
 *       open: openDay?.key === day.key,
 *       popoverId: 'koyomi-overflow-popover',
 *     })
 *   }
 * />
 * ```
 */
export function overflowPopoverButtonProps(
  options: OverflowPopoverButtonOptions,
): MonthOverflowButtonProps {
  const { open, popoverId, haspopup } = options;
  return {
    'aria-haspopup': haspopup ?? 'dialog',
    'aria-expanded': open,
    ...(open && popoverId !== undefined ? { 'aria-controls': popoverId } : {}),
  };
}
