/**
 * @packageDocumentation
 * `overflowPopoverButtonProps` のテスト。
 */
import { describe, expect, it } from 'vitest';
import { overflowPopoverButtonProps } from './overflow-popover-props';
import type { MonthOverflowButtonProps } from './types';

describe('overflowPopoverButtonProps', () => {
  it('open: false では aria-haspopup（既定 "dialog"）と aria-expanded: false を返す', () => {
    expect(overflowPopoverButtonProps({ open: false })).toEqual({
      'aria-haspopup': 'dialog',
      'aria-expanded': false,
    });
  });

  it('open: true では aria-expanded: true を返す', () => {
    expect(overflowPopoverButtonProps({ open: true })).toEqual({
      'aria-haspopup': 'dialog',
      'aria-expanded': true,
    });
  });

  it('open: true かつ popoverId ありなら aria-controls にその id を返す', () => {
    expect(overflowPopoverButtonProps({ open: true, popoverId: 'overflow-popover' })).toEqual({
      'aria-haspopup': 'dialog',
      'aria-expanded': true,
      'aria-controls': 'overflow-popover',
    });
  });

  it('open: false のときは popoverId を渡しても aria-controls を含まない（閉時はポップオーバー要素が DOM に無い前提）', () => {
    const props = overflowPopoverButtonProps({ open: false, popoverId: 'overflow-popover' });

    expect(props).toEqual({ 'aria-haspopup': 'dialog', 'aria-expanded': false });
    expect('aria-controls' in props).toBe(false);
  });

  it('haspopup を指定すると aria-haspopup がその値になる', () => {
    expect(overflowPopoverButtonProps({ open: true, haspopup: 'menu' })).toEqual({
      'aria-haspopup': 'menu',
      'aria-expanded': true,
    });
  });

  it('haspopup 省略時は指定時（"dialog"）と同じ結果になる', () => {
    expect(overflowPopoverButtonProps({ open: true })).toEqual(
      overflowPopoverButtonProps({ open: true, haspopup: 'dialog' }),
    );
  });

  it('戻り値は MonthView / MultiMonthView の overflowButtonProps からそのまま返せる型になっている', () => {
    // 型レベルの互換性の固定（コンパイルできること自体が検証）
    const props: MonthOverflowButtonProps = overflowPopoverButtonProps({
      open: true,
      popoverId: 'overflow-popover',
    });

    expect(props['aria-expanded']).toBe(true);
  });
});
