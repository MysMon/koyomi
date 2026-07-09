/**
 * use-virtualizer.ts のテスト。
 *
 * jsdom はレイアウトを持たないため、スクロールコンテナの `clientHeight` を明示定義し、
 * `ResizeObserver` はモックする。ビューポート高はマウント時と scroll 時に `clientHeight` を
 * 読むため、モックの発火に頼らず検証できる。
 */
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useVirtualizer } from './use-virtualizer';

/** テスト用の no-op ResizeObserver。 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

/** clientHeight を固定したスクロールコンテナ要素を body に用意する。 */
function makeScrollElement(clientHeight: number): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
  document.body.appendChild(element);
  return element;
}

const created: HTMLDivElement[] = [];
function scrollElement(clientHeight: number): HTMLDivElement {
  const element = makeScrollElement(clientHeight);
  created.push(element);
  return element;
}

afterEach(() => {
  for (const element of created.splice(0)) {
    element.remove();
  }
});

/** 次の rAF まで待つ（rAF スロットルのフラッシュ用）。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const baseOptions = (element: HTMLDivElement, enabled: boolean) => ({
  count: 10,
  getItemKey: (index: number) => `k${index}`,
  estimateSize: () => 20,
  getScrollElement: () => element,
  enabled,
});

describe('useVirtualizer', () => {
  it('enabled=false のとき全件を返し before/after は 0', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, false)));

    expect(result.current.virtualItems.map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(result.current.beforeSize).toBe(0);
    expect(result.current.afterSize).toBe(0);
    expect(result.current.totalSize).toBe(200);
    expect(result.current.pinnedItems).toEqual([]);
  });

  it('enabled=true で初期ビューポート高から可視窓を返す', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    // 可視 0..4（100px / 20px）＋ overscan 3 → 0..7
    const indices = result.current.virtualItems.map((item) => item.index);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(7);
    expect(result.current.beforeSize).toBe(0);
    expect(result.current.totalSize).toBe(200);
  });

  it('スクロールすると可視窓が移動する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    await act(async () => {
      element.scrollTop = 100;
      element.dispatchEvent(new Event('scroll'));
      await nextFrame();
    });

    const indices = result.current.virtualItems.map((item) => item.index);
    // 可視 5..9（100〜199px）を含む
    expect(indices).toContain(5);
    expect(indices).toContain(9);
    expect(result.current.beforeSize).toBeGreaterThan(0);
  });

  it('scrollToIndex(align="start") が対象の start へスクロールする', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    act(() => {
      result.current.scrollToIndex(9, { align: 'start' });
    });

    expect(element.scrollTop).toBe(180); // index 9 = 9×20
  });

  it('pinnedKeys の窓外アイテムを pinnedItems に含める', () => {
    const element = scrollElement(40); // 可視 0..1
    const { result } = renderHook(() =>
      useVirtualizer({ ...baseOptions(element, true), overscan: 0, pinnedKeys: new Set(['k9']) }),
    );

    expect(result.current.virtualItems.map((item) => item.index)).toEqual([0, 1]);
    expect(result.current.pinnedItems.map((item) => item.index)).toEqual([9]);
    expect(result.current.pinnedItems[0]?.start).toBe(180);
  });

  it('measure=true（既定）は要素の実測高を totalSize に反映する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 100 });
    await act(async () => {
      result.current.measureElement('k0')(item);
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(280); // 実測 100 + 推定 9×20
  });

  it('measure=false のときは実測せず推定高で固定される', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() =>
      useVirtualizer({ ...baseOptions(element, true), measure: false }),
    );
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 100 });
    await act(async () => {
      result.current.measureElement('k0')(item);
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(200); // 推定 10×20 のまま（実測しない）
  });

  it('getScrollElement の戻り値が変わると新しい要素を購読する', () => {
    const a = scrollElement(100); // viewport 100 → 可視 0..4 + overscan 3 → 0..7
    const b = scrollElement(40); // viewport 40 → 可視 0..1 + overscan 3 → 0..4
    let current = a;
    const { result, rerender } = renderHook(() =>
      useVirtualizer({
        count: 10,
        getItemKey: (index: number) => `k${index}`,
        estimateSize: () => 20,
        getScrollElement: () => current,
        enabled: true,
      }),
    );
    expect(result.current.virtualItems.at(-1)?.index).toBe(7);

    // 要素を差し替える → 購読が貼り直され B の高さを拾う
    current = b;
    rerender();
    expect(result.current.virtualItems.at(-1)?.index).toBe(4);
  });

  it('measureElement は関数（ref コールバック）を返す', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    expect(typeof result.current.measureElement('k0')).toBe('function');
    // null 渡し（アンマウント）で例外にならない
    expect(() => result.current.measureElement('k0')(null)).not.toThrow();
  });
});
