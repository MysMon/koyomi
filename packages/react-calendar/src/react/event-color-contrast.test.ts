import { afterEach, describe, expect, it, vi } from 'vitest';
import { contrastRatio, warnIfLowContrastEventColor } from './event-color-contrast';

describe('contrastRatio', () => {
  it('黒と白のコントラスト比は 21:1（WCAG の理論上の最大値）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('同一色のコントラスト比は 1:1', () => {
    expect(contrastRatio('#14608f', '#14608f')).toBeCloseTo(1, 5);
  });

  it('3 桁 省略形（#rgb）も 6 桁形式と同じ結果になる', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(contrastRatio('#000000', '#ffffff') ?? 0, 5);
  });

  it('koyomi の既定アクセント色（#14608f）と白は WCAG AA（4.5:1）を満たす', () => {
    const ratio = contrastRatio('#14608f', '#ffffff');
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it('黄色（#ffff00）と白は WCAG AA（4.5:1）を満たさない', () => {
    const ratio = contrastRatio('#ffff00', '#ffffff');
    expect(ratio).not.toBeNull();
    expect(ratio ?? 999).toBeLessThan(4.5);
  });

  it('16 進カラーコード以外（named color 等）はパースできず null を返す', () => {
    expect(contrastRatio('red', '#ffffff')).toBeNull();
    expect(contrastRatio('#14608f', 'rgb(255, 255, 255)')).toBeNull();
  });
});

describe('warnIfLowContrastEventColor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('WCAG AA 未満のとき console.warn し、色を warned に積む', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<string>();

    warnIfLowContrastEventColor('#ffff00', warned);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('#ffff00');
    expect(warned.has('#ffff00')).toBe(true);
  });

  it('WCAG AA を満たす色では警告しない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<string>();

    warnIfLowContrastEventColor('#14608f', warned);

    expect(warn).not.toHaveBeenCalled();
    expect(warned.size).toBe(0);
  });

  it('同じ色は 2 回目以降 warned 済みとして再警告しない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<string>();

    warnIfLowContrastEventColor('#ffff00', warned);
    warnIfLowContrastEventColor('#ffff00', warned);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('パースできない色（named color 等）は判定できないため警告しない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<string>();

    warnIfLowContrastEventColor('red', warned);

    expect(warn).not.toHaveBeenCalled();
  });
});
