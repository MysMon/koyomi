import { afterEach, describe, expect, it } from 'vitest';
import { inlineStartFraction, isRtl, readingOrderArrowKey } from './text-direction';

/** `dir` 属性を持つ祖先の下に子要素を作り、子要素を返す。 */
function childOf(dir: 'ltr' | 'rtl' | null): HTMLElement {
  const parent = document.createElement('div');
  if (dir !== null) {
    parent.setAttribute('dir', dir);
  }
  const child = document.createElement('button');
  parent.appendChild(child);
  document.body.appendChild(parent);
  return child;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('isRtl', () => {
  it('書字方向の指定がなければ false', () => {
    expect(isRtl(childOf(null))).toBe(false);
  });

  it('祖先に dir="rtl" があれば true、dir="ltr" なら false', () => {
    expect(isRtl(childOf('rtl'))).toBe(true);
    expect(isRtl(childOf('ltr'))).toBe(false);
  });

  it('要素自身の direction スタイルでも判定される', () => {
    const element = childOf(null);
    element.style.direction = 'rtl';
    expect(isRtl(element)).toBe(true);
  });
});

describe('inlineStartFraction', () => {
  const rect = { left: 100, width: 400 };

  it('LTR では左端からの距離の割合になる', () => {
    expect(inlineStartFraction(rect, 100, false)).toBe(0);
    expect(inlineStartFraction(rect, 200, false)).toBe(0.25);
    expect(inlineStartFraction(rect, 500, false)).toBe(1);
  });

  it('RTL では右端からの距離の割合になる', () => {
    expect(inlineStartFraction(rect, 500, true)).toBe(0);
    expect(inlineStartFraction(rect, 200, true)).toBe(0.75);
    expect(inlineStartFraction(rect, 100, true)).toBe(1);
  });

  it('矩形の外の座標は範囲外の値（負・1 超）をそのまま返す', () => {
    expect(inlineStartFraction(rect, 0, false)).toBe(-0.25);
    expect(inlineStartFraction(rect, 0, true)).toBe(1.25);
  });

  it('幅が 0 以下なら書字方向によらず 0', () => {
    expect(inlineStartFraction({ left: 100, width: 0 }, 150, false)).toBe(0);
    expect(inlineStartFraction({ left: 100, width: 0 }, 150, true)).toBe(0);
  });
});

describe('readingOrderArrowKey', () => {
  it('LTR では ←/→ をそのまま返す', () => {
    const element = childOf('ltr');
    expect(readingOrderArrowKey('ArrowLeft', element)).toBe('ArrowLeft');
    expect(readingOrderArrowKey('ArrowRight', element)).toBe('ArrowRight');
  });

  it('RTL では ←/→ を入れ替えて返す', () => {
    const element = childOf('rtl');
    expect(readingOrderArrowKey('ArrowLeft', element)).toBe('ArrowRight');
    expect(readingOrderArrowKey('ArrowRight', element)).toBe('ArrowLeft');
  });

  it('←/→ 以外のキーは RTL でもそのまま返す', () => {
    const element = childOf('rtl');
    expect(readingOrderArrowKey('ArrowUp', element)).toBe('ArrowUp');
    expect(readingOrderArrowKey('ArrowDown', element)).toBe('ArrowDown');
    expect(readingOrderArrowKey('Enter', element)).toBe('Enter');
  });
});
