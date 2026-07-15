/**
 * scroll-to-time.ts のテスト。
 */
import { describe, expect, it } from 'vitest';
import { scrollContainerToTime, scrollFractionForTime } from './scroll-to-time';

describe('scrollFractionForTime', () => {
  it("既定範囲(0, 1440)で '09:00' は 0.375 になる", () => {
    expect(scrollFractionForTime('09:00', 0, 1440)).toBe(0.375);
  });

  it('境界値: rangeStartMinutes ちょうどは 0、rangeEndMinutes ちょうどは 1', () => {
    expect(scrollFractionForTime('00:00', 0, 1440)).toBe(0);
    expect(scrollFractionForTime('24:00', 0, 1440)).toBe(1);
  });

  it('制限範囲(480, 1200)で範囲内の時刻は範囲に対する割合になる', () => {
    // 480 + 0.5 * (1200 - 480) = 840 分 = 14:00
    expect(scrollFractionForTime('14:00', 480, 1200)).toBe(0.5);
  });

  it('制限範囲(480, 1200)で範囲より前の時刻は 0 に、範囲より後の時刻は 1 にクランプされる', () => {
    expect(scrollFractionForTime('07:00', 480, 1200)).toBe(0);
    expect(scrollFractionForTime('21:00', 480, 1200)).toBe(1);
  });

  it("'HH:mm' として解析できない不正な形式では例外を投げず null を返す", () => {
    expect(scrollFractionForTime('9:00', 0, 1440)).toBeNull();
    expect(scrollFractionForTime('25:00', 0, 1440)).toBeNull();
    expect(scrollFractionForTime('not-a-time', 0, 1440)).toBeNull();
  });

  it('rangeEndMinutes が rangeStartMinutes 以下（退行的な範囲）では 0 を返す（0 除算の防御）', () => {
    expect(scrollFractionForTime('10:00', 480, 480)).toBe(0);
    expect(scrollFractionForTime('10:00', 600, 480)).toBe(0);
  });
});

describe('scrollContainerToTime', () => {
  /** `scrollHeight` を固定値としてモックした `HTMLElement` を作る。 */
  function makeElement(scrollHeight: number): HTMLElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      value: scrollHeight,
    });
    return element;
  }

  it('scrollTop が fraction * scrollHeight に設定される', () => {
    const element = makeElement(2000);
    scrollContainerToTime(element, '09:00', 0, 1440);
    expect(element.scrollTop).toBe(0.375 * 2000);
  });

  it('制限範囲でも同様に scrollTop が計算される', () => {
    const element = makeElement(1000);
    scrollContainerToTime(element, '14:00', 480, 1200);
    expect(element.scrollTop).toBe(500);
  });

  it("'HH:mm' として解析できない不正な形式では scrollTop を変更しない", () => {
    const element = makeElement(2000);
    element.scrollTop = 123;
    scrollContainerToTime(element, 'invalid', 0, 1440);
    expect(element.scrollTop).toBe(123);
  });

  it('scrollHeight が 0（非表示など）の場合は scrollTop を書き込まない', () => {
    const element = makeElement(0);
    element.scrollTop = 42;
    scrollContainerToTime(element, '09:00', 0, 1440);
    expect(element.scrollTop).toBe(42);
  });
});
