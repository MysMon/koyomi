/**
 * use-virtualizer.ts のテスト。
 *
 * jsdom はレイアウトを持たないため、スクロールコンテナの `clientHeight` を明示定義し、
 * `ResizeObserver` はモックする。ビューポート高はマウント時と scroll 時に `clientHeight` を
 * 読むため、モックの発火に頼らず検証できる。
 */
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('overscan を除いた可視範囲を startIndex/endIndex として返す', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    // 可視 0..4（100px / 20px）。overscan 3 は virtualItems にのみ含まれる
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(4);

    await act(async () => {
      element.scrollTop = 100;
      element.dispatchEvent(new Event('scroll'));
      await nextFrame();
    });

    // 可視 5..9（100〜199px）
    expect(result.current.startIndex).toBe(5);
    expect(result.current.endIndex).toBe(9);
  });

  it('count=0 のとき startIndex/endIndex は -1 になる', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer({ ...baseOptions(element, true), count: 0 }));

    expect(result.current.startIndex).toBe(-1);
    expect(result.current.endIndex).toBe(-1);
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

  it('scrollToIndex(align="center") が対象をビューポート中央に置くスクロール位置になる', () => {
    const element = scrollElement(100); // viewport 100px、itemSize 20px
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    act(() => {
      result.current.scrollToIndex(9, { align: 'center' });
    });

    // start(180) - (viewport(100) - itemSize(20)) / 2 = 180 - 40 = 140
    expect(element.scrollTop).toBe(140);
  });

  describe('scrollToIndex(既定値 align="auto")', () => {
    it('対象が可視域より下にあるときは、対象の下端がちょうど収まる位置まで最小限スクロールする', () => {
      const element = scrollElement(100); // viewport 100px（可視 0..4）
      const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

      act(() => {
        // align 省略 → 既定値 'auto'
        result.current.scrollToIndex(9);
      });

      // index9 の start=180・end=200。end(200) が可視域下端(0+100=100)を超えるため
      // end - viewport = 200 - 100 = 100 まで（start の 180 までは飛ばさない）
      expect(element.scrollTop).toBe(100);
    });

    it('対象が可視域より上にあるときは、対象の start までスクロールする', () => {
      const element = scrollElement(100);
      const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
      element.scrollTop = 200; // 可視域を下（index 10..14 相当）へ動かしておく

      act(() => {
        result.current.scrollToIndex(0);
      });

      // index0 の start=0 は現在の scrollTop(200) より上にあるため、start までスクロールする
      expect(element.scrollTop).toBe(0);
    });

    it('対象が既に可視域内にあるときは何もスクロールしない', () => {
      const element = scrollElement(100); // viewport 100px（可視 0..4）
      const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

      act(() => {
        // index2 は start=40・end=60 で、現在の可視域 0..100 に完全に収まっている
        result.current.scrollToIndex(2);
      });

      expect(element.scrollTop).toBe(0);
    });
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

  describe("axis='horizontal'", () => {
    /** clientWidth を固定した横スクロールコンテナ要素を body に用意する。 */
    function horizontalScrollElement(clientWidth: number): HTMLDivElement {
      const element = document.createElement('div');
      Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
      document.body.appendChild(element);
      created.push(element);
      return element;
    }

    it('scrollLeft/clientWidth を使って可視窓を計算する', () => {
      const element = horizontalScrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );
      // 可視 0..4（100px / 20px）＋ overscan 3 → 0..7
      const indices = result.current.virtualItems.map((item) => item.index);
      expect(indices[0]).toBe(0);
      expect(indices.at(-1)).toBe(7);
    });

    it('横スクロールすると可視窓が移動する', async () => {
      const element = horizontalScrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );

      await act(async () => {
        element.scrollLeft = 100;
        element.dispatchEvent(new Event('scroll'));
        await nextFrame();
      });

      const indices = result.current.virtualItems.map((item) => item.index);
      expect(indices).toContain(5);
      expect(indices).toContain(9);
      expect(result.current.beforeSize).toBeGreaterThan(0);
    });

    it('scrollToIndex は scrollLeft を書き換える（縦軸の scrollTop は変えない）', () => {
      const element = horizontalScrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );

      act(() => {
        result.current.scrollToIndex(9, { align: 'start' });
      });

      expect(element.scrollLeft).toBe(180); // index 9 = 9×20
      expect(element.scrollTop).toBe(0);
    });

    it('RTL では負の scrollLeft を論理オフセットとして解釈して可視窓を計算する', async () => {
      // CSSOM View の標準挙動: dir=rtl の水平スクロールは開始位置が scrollLeft=0 で、
      // 奥（より多くの列がある方向）へ進むほど負の値になる
      const element = horizontalScrollElement(100);
      element.style.direction = 'rtl';
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );

      await act(async () => {
        element.scrollLeft = -100;
        element.dispatchEvent(new Event('scroll'));
        await nextFrame();
      });

      const indices = result.current.virtualItems.map((item) => item.index);
      expect(indices).toContain(5);
      expect(indices).toContain(9);
      expect(result.current.beforeSize).toBeGreaterThan(0);
    });

    it('RTL では scrollToIndex が負の scrollLeft を書き込む', () => {
      const element = horizontalScrollElement(100);
      element.style.direction = 'rtl';
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );

      act(() => {
        result.current.scrollToIndex(9, { align: 'start' });
      });

      expect(element.scrollLeft).toBe(-180); // index 9 = 9×20 の論理オフセットを RTL の座標系へ
      expect(element.scrollTop).toBe(0);
    });
  });

  describe('viewportPadding', () => {
    it('可視ビューポートの先頭から viewportPadding 分を差し引いて窓を計算する', () => {
      // clientHeight=100・viewportPadding=40 → 実効ビューポートは 60px 相当（可視 0..2 + overscan）
      const element = scrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), viewportPadding: 40, overscan: 0 }),
      );
      const indices = result.current.virtualItems.map((item) => item.index);
      // 60px 分（0..2）だけが可視になる（40px 分の余白を無視しなければ 0..4 になってしまう）
      expect(indices).toEqual([0, 1, 2]);
    });

    it('scrollToIndex(align="center") は viewportPadding を差し引いた実効ビューポートを使う', () => {
      // 実効ビューポート = 100 - 40 = 60px、itemSize 20px
      const element = scrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), viewportPadding: 40 }),
      );
      act(() => {
        result.current.scrollToIndex(9, { align: 'center' });
      });
      // start(180) - (60 - 20) / 2 = 180 - 20 = 160
      expect(element.scrollTop).toBe(160);
    });
  });
});

/**
 * テスト用に制御可能な ResizeObserver モック。
 *
 * `NoopResizeObserver` と異なり、`trigger` で任意の {@link ResizeObserverEntry} を模した
 * 通知をコールバックへ即座に届けられる。これにより `sizeFromEntry` の分岐
 * （`borderBoxSize` の有無・軸ごとの参照先）や、通知受信時の防御的分岐
 * （実測無効時・未登録要素・サイズ 0）を検証する。
 */
class ControlledResizeObserver implements ResizeObserver {
  static instances: ControlledResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  readonly observed = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControlledResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /**
   * `target` を実測した体で、指定サイズのエントリを即座にコールバックへ通知する。
   * `borderBox` を省略すると `contentRect` のみのエントリになり、フォールバック経路を検証できる。
   */
  trigger(
    target: Element,
    contentRect: { width: number; height: number },
    borderBox?: { blockSize: number; inlineSize: number },
  ): void {
    // jsdom は ResizeObserverEntry を実装しないため、`sizeFromEntry` が実際に読む
    // target/contentRect/borderBoxSize だけを持つ最小限のスタブを用意して cast する。
    const entry = {
      target,
      contentRect,
      borderBoxSize: borderBox !== undefined ? [borderBox] : undefined,
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

/** `target` を observe している {@link ControlledResizeObserver} を探す（無ければ例外）。 */
function findObserverFor(target: Element): ControlledResizeObserver {
  const found = ControlledResizeObserver.instances.find((observer) =>
    observer.observed.has(target),
  );
  if (found === undefined) {
    throw new Error('対象要素を observe している ResizeObserver が見つかりません');
  }
  return found;
}

/** clientWidth を固定した横スクロールコンテナ要素を body に用意する（呼び出し側で remove すること）。 */
function makeHorizontalElement(clientWidth: number): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
  document.body.appendChild(element);
  return element;
}

describe('useVirtualizer - ResizeObserver によるアイテム実測の反映', () => {
  let previousResizeObserver: typeof ResizeObserver;
  beforeEach(() => {
    ControlledResizeObserver.instances.length = 0;
    previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = previousResizeObserver;
  });

  it('borderBoxSize があれば blockSize を実測高として反映する（縦軸）', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const item = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(item);
    });
    const observer = findObserverFor(item);
    await act(async () => {
      observer.trigger(item, { width: 0, height: 0 }, { blockSize: 120, inlineSize: 40 });
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(120 + 9 * 20); // k0 が実測 120px に更新される
  });

  it('borderBoxSize が無ければ contentRect.height にフォールバックする（縦軸）', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const item = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(item);
    });
    const observer = findObserverFor(item);
    await act(async () => {
      observer.trigger(item, { width: 40, height: 130 }); // borderBoxSize 省略
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(130 + 9 * 20);
  });

  it('横軸（axis="horizontal"）では borderBoxSize の inlineSize、無ければ contentRect.width を使う', async () => {
    const element = makeHorizontalElement(100);
    try {
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );
      const item0 = document.createElement('section');
      act(() => {
        result.current.measureElement('k0')(item0);
      });
      await act(async () => {
        findObserverFor(item0).trigger(
          item0,
          { width: 90, height: 0 },
          {
            blockSize: 40,
            inlineSize: 90,
          },
        );
        await nextFrame();
      });
      expect(result.current.totalSize).toBe(90 + 9 * 20);

      const item1 = document.createElement('section');
      act(() => {
        result.current.measureElement('k1')(item1);
      });
      await act(async () => {
        // borderBoxSize 省略時は contentRect.width にフォールバックする
        findObserverFor(item1).trigger(item1, { width: 77, height: 0 });
        await nextFrame();
      });
      expect(result.current.totalSize).toBe(90 + 77 + 8 * 20);
    } finally {
      element.remove();
    }
  });

  it('横軸の measureElement は登録直後に offsetWidth を即時実測する', async () => {
    const element = makeHorizontalElement(100);
    try {
      const { result } = renderHook(() =>
        useVirtualizer({ ...baseOptions(element, true), axis: 'horizontal' }),
      );
      const item = document.createElement('section');
      Object.defineProperty(item, 'offsetWidth', { configurable: true, value: 65 });
      await act(async () => {
        result.current.measureElement('k0')(item);
        await nextFrame();
      });
      expect(result.current.totalSize).toBe(65 + 9 * 20);
    } finally {
      element.remove();
    }
  });

  it('measure=false（無効化後）に届いた遅延コールバックは実測を反映しない', async () => {
    const element = scrollElement(100);
    const { result, rerender } = renderHook(
      (props: { measure: boolean }) =>
        useVirtualizer({ ...baseOptions(element, true), measure: props.measure }),
      { initialProps: { measure: true } },
    );
    const item = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(item);
    });
    const observer = findObserverFor(item);

    rerender({ measure: false }); // 実測を無効化する（内部ではオブザーバも破棄される）

    await act(async () => {
      // 破棄前に保持していた ResizeObserver の参照から、無効化後に届いた遅延通知を模す
      observer.trigger(item, { width: 0, height: 999 }, { blockSize: 999, inlineSize: 0 });
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(200); // 反映されず推定高のまま
  });

  it('登録済みでない要素からの通知は無視する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const registered = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(registered);
    });
    const observer = findObserverFor(registered);
    const stranger = document.createElement('section'); // measureElement で登録していない要素

    await act(async () => {
      observer.trigger(stranger, { width: 0, height: 500 }, { blockSize: 500, inlineSize: 0 });
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(200); // 未登録要素の通知は無視され推定高のまま
  });

  it('サイズ 0（不正な実測値）の通知は無視する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const item = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(item);
    });
    const observer = findObserverFor(item);

    await act(async () => {
      observer.trigger(item, { width: 0, height: 0 }, { blockSize: 0, inlineSize: 0 });
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(200); // 0px は無視され推定高のまま
  });

  it('同じキーに別要素が登録されると、古い要素の観測を解除する（DOM 差し替え）', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const first = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(first);
    });
    const observer = findObserverFor(first);
    expect(observer.observed.has(first)).toBe(true);

    const second = document.createElement('section');
    Object.defineProperty(second, 'offsetHeight', { configurable: true, value: 88 });
    await act(async () => {
      result.current.measureElement('k0')(second); // 同じキーへ別要素を登録（DOM 差し替え）
      await nextFrame();
    });
    expect(observer.observed.has(first)).toBe(false); // 古い要素の観測は解除される
    expect(observer.observed.has(second)).toBe(true);
    expect(result.current.totalSize).toBe(88 + 9 * 20);
  });

  it('ビューポートの ResizeObserver 通知を受けるとビューポート寸法を再取得する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const viewportObserver = findObserverFor(element);

    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
    await act(async () => {
      viewportObserver.trigger(element, { width: 0, height: 300 });
    });
    // ビューポートが 300px に広がったことで、可視窓（0..14 + overscan）がより多くの
    // アイテムを含むようになる
    const indices = result.current.virtualItems.map((item) => item.index);
    expect(indices.at(-1)).toBe(9); // count=10 のため末尾（index9）まで含まれる
  });
});

describe('useVirtualizer - ResizeObserver 自体が存在しない環境', () => {
  it('グローバルに ResizeObserver が無くても実測をスキップして推定高のまま動作する', () => {
    const previousResizeObserver = globalThis.ResizeObserver;
    // jsdom より古いブラウザ相当（ResizeObserver 未実装）を再現するための一時的な cast。
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    try {
      const element = scrollElement(100);
      let hookResult: ReturnType<typeof useVirtualizer> | undefined;
      expect(() => {
        const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
        hookResult = result.current;
        act(() => {
          result.current.measureElement('k0')(document.createElement('section'));
        });
      }).not.toThrow();
      expect(hookResult?.totalSize).toBe(200); // 推定高のみで計算される
    } finally {
      globalThis.ResizeObserver = previousResizeObserver;
    }
  });
});

describe('useVirtualizer - enabled=false の間に登録された要素の遅延実測', () => {
  it('enabled=false の間に measureElement で登録した要素は、enabled=true になった時点でまとめて実測される', async () => {
    const element = scrollElement(100);
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) => useVirtualizer(baseOptions(element, props.enabled)),
      { initialProps: { enabled: false } },
    );
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 80 });
    // サイズ 0（無効値）の要素も同時に登録し、まとめ実測時に「変化なし」の分岐も通す
    const invalidSizeItem = document.createElement('section');
    act(() => {
      result.current.measureElement('k0')(item); // enabled=false のうちに登録（観測はまだされない）
      result.current.measureElement('k1')(invalidSizeItem);
    });
    expect(result.current.totalSize).toBe(200); // enabled=false は全件推定表示（実測は反映されない）

    await act(async () => {
      rerender({ enabled: true });
      await nextFrame();
    });
    // k0 は実測 80 が反映され、offsetHeight=0 の k1 は無視されて推定 20 のまま
    expect(result.current.totalSize).toBe(80 + 8 * 20 + 20);
  });
});

describe('useVirtualizer - count/getItemKey の変化に伴うキャッシュ整理', () => {
  it('count が減って対象キーが範囲外になると、実測キャッシュ・要素キャッシュから該当キーを削除する', async () => {
    const element = scrollElement(100);
    const { result, rerender } = renderHook(
      (props: { count: number }) =>
        useVirtualizer({
          count: props.count,
          getItemKey: (index: number) => `k${index}`,
          estimateSize: () => 20,
          getScrollElement: () => element,
          enabled: true,
        }),
      { initialProps: { count: 10 } },
    );
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 999 });
    await act(async () => {
      result.current.measureElement('k9')(item); // 末尾（index9）を実測登録
      await nextFrame();
    });
    expect(result.current.totalSize).toBe(9 * 20 + 999);

    act(() => {
      rerender({ count: 5 }); // k9（index9）は新しい範囲（0..4）に存在しなくなる
    });
    // 該当キーの実測値はキャッシュから削除され、以降は推定高だけで計算される
    expect(result.current.totalSize).toBe(5 * 20);
  });
});

describe('useVirtualizer - スクロール・rAF スロットルの後始末', () => {
  it('同一フレーム内に複数キーの実測が変化しても、実測フラッシュの rAF は一度だけ予約される', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const itemA = document.createElement('section');
    Object.defineProperty(itemA, 'offsetHeight', { configurable: true, value: 90 });
    const itemB = document.createElement('section');
    Object.defineProperty(itemB, 'offsetHeight', { configurable: true, value: 70 });

    await act(async () => {
      result.current.measureElement('k0')(itemA); // rAF を予約
      result.current.measureElement('k1')(itemB); // 直前の rAF が未発火のため二重予約されない
      await nextFrame();
    });
    // 1 回のフラッシュで両方の実測が反映される
    expect(result.current.totalSize).toBe(90 + 70 + 8 * 20);
  });

  it('同一フレーム内の連続スクロールイベントは rAF を一度だけ予約する', async () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    await act(async () => {
      element.scrollTop = 40;
      element.dispatchEvent(new Event('scroll'));
      element.scrollTop = 80; // 直前の rAF がまだ発火していないため二重予約されない
      element.dispatchEvent(new Event('scroll'));
      await nextFrame();
    });
    // 最終的な scrollTop（80）を反映した窓になる
    const indices = result.current.virtualItems.map((item) => item.index);
    expect(indices).toContain(4); // 80px/20px = index4 が可視の先頭
  });

  it('スクロール発火で rAF 予約中にアンマウントすると、保留中のフレームをキャンセルする', () => {
    const element = scrollElement(100);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { unmount } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    act(() => {
      element.scrollTop = 50;
      element.dispatchEvent(new Event('scroll')); // rAF を予約するが発火前
    });
    unmount();

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('measureElement で rAF 予約中にアンマウントすると、保留中の実測フラッシュをキャンセルする', () => {
    const element = scrollElement(100);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { result, unmount } = renderHook(() => useVirtualizer(baseOptions(element, true)));
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 999 });

    act(() => {
      result.current.measureElement('k0')(item); // 実測フラッシュの rAF を予約するが発火前
    });
    unmount();

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });
});

describe('useVirtualizer - スクロールアンカリングの境界', () => {
  it('手前のアイテムの実測サイズが変わりアンカーの位置がずれると、スクロール位置を補正する', async () => {
    const element = scrollElement(100); // viewport 100px
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    await act(async () => {
      element.scrollTop = 100; // 可視の先頭は index5（100px / 20px）、アンカーの overshoot は 0
      element.dispatchEvent(new Event('scroll'));
      await nextFrame();
    });

    const beforeAnchorItem = document.createElement('section');
    Object.defineProperty(beforeAnchorItem, 'offsetHeight', { configurable: true, value: 100 });
    await act(async () => {
      // アンカー（k5）より手前の k2 が 20px → 100px（+80px）に伸びる
      result.current.measureElement('k2')(beforeAnchorItem);
      await nextFrame();
    });

    // k5 の新しい start は 100 + 80 = 180px。ズレが 1px 以上あるためスクロール位置を補正する
    expect(element.scrollTop).toBe(180);
  });

  it('補正実行時にスクロール要素が取得できない場合は何もしない（例外にならない）', async () => {
    const element = scrollElement(100);
    let currentElement: HTMLDivElement | null = element;
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 10,
        getItemKey: (index: number) => `k${index}`,
        estimateSize: () => 20,
        getScrollElement: () => currentElement,
        enabled: true,
      }),
    );

    // スクロール要素が失われた状態を模す（アンマウント直後の一瞬等）
    currentElement = null;
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 999 });
    await expect(
      act(async () => {
        result.current.measureElement('k0')(item);
        await nextFrame();
      }),
    ).resolves.not.toThrow();
    expect(element.scrollTop).toBe(0); // 要素が無いため何も書き換わらない
  });

  describe('getItemKey が呼び出しごとに異なるキーを返す場合の防御的な挙動', () => {
    it('アンカーのキーが見失われても例外を投げず、スクロール補正をスキップする', async () => {
      let counter = 0;
      const element = scrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({
          count: 10,
          getItemKey: () => `k${counter++}`, // 呼び出すたびに異なるキーを返す（不正な実装を模す）
          estimateSize: () => 20,
          getScrollElement: () => element,
          enabled: true,
        }),
      );
      const item = document.createElement('section');
      Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 50 });
      await expect(
        act(async () => {
          result.current.measureElement('k0')(item); // 実測フラッシュの rAF を予約する
          await nextFrame();
        }),
      ).resolves.not.toThrow();
      // マウント時に記録したアンカーのキーが、以後のどの getItemKey 呼び出し結果とも
      // 一致しないため startForKey が見つからず、スクロール位置は書き換わらない
      expect(element.scrollTop).toBe(0);
    });

    it('scrollToIndex はアンカー探索に失敗しても例外を投げず何もしない', () => {
      let counter = 0;
      const element = scrollElement(100);
      const { result } = renderHook(() =>
        useVirtualizer({
          count: 10,
          getItemKey: () => `k${counter++}`,
          estimateSize: () => 20,
          getScrollElement: () => element,
          enabled: true,
        }),
      );
      expect(() => {
        act(() => {
          result.current.scrollToIndex(5, { align: 'start' });
        });
      }).not.toThrow();
      expect(element.scrollTop).toBe(0);
    });
  });
});

describe('useVirtualizer - scrollToIndex の防御的な入力', () => {
  it('範囲外の index（負数・count 以上）を渡しても何もしない', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() => useVirtualizer(baseOptions(element, true)));

    act(() => {
      result.current.scrollToIndex(-1);
      result.current.scrollToIndex(10); // count=10 のため範囲外
    });
    expect(element.scrollTop).toBe(0);
  });

  it('getScrollElement が null を返す間は scrollToIndex が何もしない', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 10,
        getItemKey: (index: number) => `k${index}`,
        estimateSize: () => 20,
        getScrollElement: () => null,
        enabled: true,
      }),
    );
    expect(() => {
      act(() => {
        result.current.scrollToIndex(3);
      });
    }).not.toThrow();
  });

  it('measure=false のときは scrollToIndex も実測を使わず推定高で計算する', () => {
    const element = scrollElement(100);
    const { result } = renderHook(() =>
      useVirtualizer({ ...baseOptions(element, true), measure: false }),
    );
    const item = document.createElement('section');
    Object.defineProperty(item, 'offsetHeight', { configurable: true, value: 999 }); // 無視されるはず
    act(() => {
      result.current.measureElement('k9')(item);
      result.current.scrollToIndex(9, { align: 'start' });
    });
    expect(element.scrollTop).toBe(180); // 実測(999)ではなく推定(9×20)通りの位置
  });
});
