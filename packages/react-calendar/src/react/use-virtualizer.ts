/**
 * @packageDocumentation
 * `useVirtualizer` — 縦方向ウィンドウイング（仮想化）のヘッドレスなプリミティブ。
 *
 * コア（{@link computeWindow} / {@link startForKey}）の純粋計算に、スクロール位置の購読・
 * ビューポート高とアイテム高の実測（ResizeObserver）・スクロールアンカリングといった
 * DOM 副作用を結び付ける。ビューには依存しないため、リストビューに限らず縦に長い任意の
 * リストへ適用できる。スタイルや DOM 構造は一切持たず、描画すべきアイテムと寸法だけを返す。
 *
 * 高さはライブラリが所有しない。スクロールコンテナの高さは利用者の CSS が決め、本フックは
 * その高さを ResizeObserver で実測して窓計算に用いる（境界高が無ければ全件が可視となり、
 * 実質的に仮想化なしの全件描画へ無害に縮退する）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeWindow,
  startForKey,
  type VirtualItem,
  type WindowResult,
} from '../core/virtualization';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect';

/**
 * {@link useVirtualizer} のオプション。
 */
export interface UseVirtualizerOptions {
  /** アイテム総数。 */
  count: number;
  /** インデックス → 安定キー。測定キャッシュ・フォーカス保持の基準になる。 */
  getItemKey: (index: number) => string;
  /** インデックス → 推定高（px）。実測が入るまでの暫定値。 */
  estimateSize: (index: number) => number;
  /**
   * スクロールコンテナの要素を返す関数。未マウント時は `null` を返してよい。
   * 参照は毎レンダー変わってよい（内部で最新の関数を参照する）。
   */
  getScrollElement: () => HTMLElement | null;
  /** 前後 overscan 件数。既定 3。 */
  overscan?: number;
  /** 窓外でも描画へ含めたいキー（フォーカス保持アイテム等。通常 0〜1 件）。 */
  pinnedKeys?: ReadonlySet<string>;
  /** アイテム高を ResizeObserver で実測するか。`false` なら推定固定。既定 `true`。 */
  measure?: boolean;
  /**
   * 仮想化を有効にするか。`false` の間は全件を返す（SSR・初回クライアント render では
   * `false` にし、マウント後に `true` へ切り替えることで hydration 不一致を避ける）。
   */
  enabled: boolean;
}

/**
 * {@link useVirtualizer} の戻り値。
 */
export interface Virtualizer {
  /** 通常フローに並べる連続窓（overscan 込み）。 */
  virtualItems: readonly VirtualItem[];
  /** 絶対配置で保持する窓外の pinned アイテム（通常 0〜1 件）。 */
  pinnedItems: readonly VirtualItem[];
  /** 窓の先頭より上の総高（上スペーサの高さ、px）。 */
  beforeSize: number;
  /** 窓の末尾より下の総高（下スペーサの高さ、px）。 */
  afterSize: number;
  /** 全アイテムの合計高（px）。 */
  totalSize: number;
  /** アイテム DOM を実測登録する ref コールバックを、キーごとに返す。 */
  measureElement: (key: string) => (element: HTMLElement | null) => void;
  /** 指定インデックスを可視域へスクロールする。 */
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'start' | 'center' }) => void;
}

/** スクロールコンテナから読み取る寸法。 */
interface ScrollMetrics {
  scrollOffset: number;
  viewportSize: number;
}

/** `measure=false`（推定固定）時に実測マップの代わりに使う空マップ。 */
const EMPTY_MEASURED: ReadonlyMap<string, number> = new Map();

/** ResizeObserver のエントリから高さ（px）を取り出す。 */
function heightFromEntry(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  if (borderBox !== undefined && borderBox.length > 0) {
    const first = borderBox[0];
    if (first !== undefined) {
      return first.blockSize;
    }
  }
  return entry.contentRect.height;
}

/**
 * 縦方向の仮想化を提供するフック。
 *
 * @param options - {@link UseVirtualizerOptions}
 * @returns 描画すべきアイテム・スペーサ高・スクロール操作を含む {@link Virtualizer}
 *
 * @example
 * ```tsx
 * const scrollRef = useRef<HTMLDivElement>(null);
 * const [enabled, setEnabled] = useState(false);
 * useLayoutEffect(() => setEnabled(true), []);
 * const v = useVirtualizer({
 *   count: days.length,
 *   getItemKey: (i) => days[i].key,
 *   estimateSize: () => 64,
 *   getScrollElement: () => scrollRef.current,
 *   enabled,
 * });
 * ```
 */
export function useVirtualizer(options: UseVirtualizerOptions): Virtualizer {
  const {
    count,
    getItemKey,
    estimateSize,
    getScrollElement,
    overscan,
    pinnedKeys,
    measure = true,
    enabled,
  } = options;

  // getScrollElement は毎レンダー変わり得るため、購読の再登録を避けて ref に保持する。
  const getScrollElementRef = useRef(getScrollElement);
  getScrollElementRef.current = getScrollElement;

  // 現在のスクロール要素を state で追跡する。`getScrollElement` の戻り値が変わったとき
  // （null→要素、A→B の差し替え）に購読 effect を貼り直せるようにする。
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useIsomorphicLayoutEffect(() => {
    const next = getScrollElementRef.current();
    setScrollElement((prev) => (prev === next ? prev : next));
  });

  const [metrics, setMetrics] = useState<ScrollMetrics>({ scrollOffset: 0, viewportSize: 0 });
  // 実測済み高（キー → px）。値の変化は measureVersion の更新で描画へ反映する。
  const measuredRef = useRef<Map<string, number>>(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);

  // 実測の rAF バッチ用フラグ（同一フレーム内の複数変化を 1 回の再描画にまとめる）。
  const flushFrameRef = useRef<number | null>(null);
  const scheduleMeasureFlush = useCallback(() => {
    if (flushFrameRef.current !== null) {
      return;
    }
    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      setMeasureVersion((version) => version + 1);
    });
  }, []);

  // アイテム実測用の単一 ResizeObserver と、要素 ⇔ キーの相互マップ。
  const itemObserverRef = useRef<ResizeObserver | null>(null);
  const elementByKeyRef = useRef<Map<string, HTMLElement>>(new Map());
  const keyByElementRef = useRef<Map<Element, string>>(new Map());
  // 実測の有効・無効はレンダーごとに変わり得るため ref に保持し、コールバックが
  // 生成時の値を閉じ込めて古くならない（stale closure しない）ようにする。
  const measureEnabled = measure && enabled;
  const measureEnabledRef = useRef(measureEnabled);
  measureEnabledRef.current = measureEnabled;

  const ensureItemObserver = useCallback((): ResizeObserver | null => {
    if (!measureEnabledRef.current || typeof ResizeObserver === 'undefined') {
      return null;
    }
    if (itemObserverRef.current === null) {
      itemObserverRef.current = new ResizeObserver((entries) => {
        // measure=false に切り替わった後の遅延コールバックでは測定を更新しない。
        if (!measureEnabledRef.current) {
          return;
        }
        let changed = false;
        for (const entry of entries) {
          const key = keyByElementRef.current.get(entry.target);
          if (key === undefined) {
            continue;
          }
          const height = heightFromEntry(entry);
          if (height > 0 && measuredRef.current.get(key) !== height) {
            measuredRef.current.set(key, height);
            changed = true;
          }
        }
        if (changed) {
          scheduleMeasureFlush();
        }
      });
    }
    return itemObserverRef.current;
  }, [scheduleMeasureFlush]);

  // 1 つの要素を実測登録／即時測定する（`measureElement` の実体）。
  const observeElement = useCallback(
    (key: string, element: HTMLElement | null): void => {
      const observer = ensureItemObserver();
      const previous = elementByKeyRef.current.get(key);
      if (previous !== undefined && previous !== element) {
        observer?.unobserve(previous);
        keyByElementRef.current.delete(previous);
        elementByKeyRef.current.delete(key);
      }
      if (element === null) {
        return;
      }
      elementByKeyRef.current.set(key, element);
      keyByElementRef.current.set(element, key);
      if (observer === null) {
        // measure=false（実測無効）のときは推定固定にするため測定しない。
        return;
      }
      observer.observe(element);
      // ResizeObserver の初回コールバックを待たずに一度だけ即時測定する。
      const height = element.offsetHeight;
      if (height > 0 && measuredRef.current.get(key) !== height) {
        measuredRef.current.set(key, height);
        scheduleMeasureFlush();
      }
    },
    [ensureItemObserver, scheduleMeasureFlush],
  );

  // キーごとの ref コールバックをキャッシュし、参照を安定させる（毎レンダーの
  // ref 付け替えによる observe/unobserve のやり直しを防ぐ）。中身は最新の
  // observeElement へ委譲するため、enabled の切替後も正しく動作する。
  const refCallbackCacheRef = useRef<Map<string, (element: HTMLElement | null) => void>>(new Map());
  const observeElementRef = useRef(observeElement);
  observeElementRef.current = observeElement;
  const measureElement = useCallback((key: string): ((element: HTMLElement | null) => void) => {
    const cache = refCallbackCacheRef.current;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const callback = (element: HTMLElement | null): void => {
      observeElementRef.current(key, element);
    };
    cache.set(key, callback);
    return callback;
  }, []);

  // 実測の有効・無効に追従する。
  // - 有効化時: 既にマウント済み（enabled=false の間に ref 登録済み）の要素をまとめて
  //   observe し直し、即時測定する。
  // - 無効化時: オブザーバを破棄して測定更新を完全に止める（推定固定に戻す）。
  useEffect(() => {
    if (!measureEnabled) {
      itemObserverRef.current?.disconnect();
      itemObserverRef.current = null;
      return;
    }
    const observer = ensureItemObserver();
    if (observer === null) {
      return;
    }
    let changed = false;
    for (const [key, element] of elementByKeyRef.current) {
      observer.observe(element);
      const height = element.offsetHeight;
      if (height > 0 && measuredRef.current.get(key) !== height) {
        measuredRef.current.set(key, height);
        changed = true;
      }
    }
    if (changed) {
      scheduleMeasureFlush();
    }
  }, [measureEnabled, ensureItemObserver, scheduleMeasureFlush]);

  // count / getItemKey が変わったとき（表示範囲の移動など）、現在のキー集合に含まれない
  // 過去のエントリを各キャッシュ（実測値・ref コールバック・要素マップ）から削除する。
  // これがないと長期間レンジを移動し続ける長寿命画面でメモリが単調増加する。
  useEffect(() => {
    const currentKeys = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      currentKeys.add(getItemKey(index));
    }
    for (const key of [...measuredRef.current.keys()]) {
      if (!currentKeys.has(key)) {
        measuredRef.current.delete(key);
      }
    }
    for (const key of [...refCallbackCacheRef.current.keys()]) {
      if (!currentKeys.has(key)) {
        refCallbackCacheRef.current.delete(key);
      }
    }
    for (const [key, element] of [...elementByKeyRef.current]) {
      if (!currentKeys.has(key)) {
        itemObserverRef.current?.unobserve(element);
        elementByKeyRef.current.delete(key);
        keyByElementRef.current.delete(element);
      }
    }
  }, [count, getItemKey]);

  // アンマウント時にオブザーバと保留フレームを片付ける。
  useEffect(() => {
    return () => {
      itemObserverRef.current?.disconnect();
      itemObserverRef.current = null;
      elementByKeyRef.current.clear();
      keyByElementRef.current.clear();
      refCallbackCacheRef.current.clear();
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, []);

  // スクロール位置の購読（rAF スロットル）＋初期同期。
  useEffect(() => {
    if (!enabled || scrollElement === null) {
      return;
    }
    const element = scrollElement;
    const sync = (): void => {
      setMetrics({ scrollOffset: element.scrollTop, viewportSize: element.clientHeight });
    };
    let frame: number | null = null;
    const onScroll = (): void => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    sync();
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [enabled, scrollElement]);

  // ビューポート高の追跡（ResizeObserver）。
  useEffect(() => {
    if (!enabled || scrollElement === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const element = scrollElement;
    const observer = new ResizeObserver(() => {
      setMetrics({ scrollOffset: element.scrollTop, viewportSize: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, scrollElement]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: measureVersion は measuredRef.current（ref）の変化を再計算へ反映するための意図的なトリガー
  const result: WindowResult = useMemo(() => {
    // measure=false（推定固定）のときは実測マップを使わず推定高だけで計算する。
    const measured = measure ? measuredRef.current : EMPTY_MEASURED;
    if (!enabled) {
      // 全件を返す（viewportSize を無限大にすると全アイテムが可視窓に入る）。
      return computeWindow({
        count,
        getKey: getItemKey,
        estimateSize,
        measured,
        scrollOffset: 0,
        viewportSize: Number.POSITIVE_INFINITY,
        overscan: 0,
      });
    }
    return computeWindow({
      count,
      getKey: getItemKey,
      estimateSize,
      measured,
      scrollOffset: metrics.scrollOffset,
      viewportSize: metrics.viewportSize,
      ...(overscan !== undefined ? { overscan } : {}),
      ...(pinnedKeys !== undefined ? { pinnedKeys } : {}),
    });
    // measureVersion は measuredRef.current の変化を描画へ反映するためのトリガー。
  }, [
    enabled,
    measure,
    count,
    getItemKey,
    estimateSize,
    metrics.scrollOffset,
    metrics.viewportSize,
    overscan,
    pinnedKeys,
    measureVersion,
  ]);

  // スクロールアンカリング用に、先頭可視アイテムのキーとめり込み量を保持する。
  const anchorRef = useRef<{ key: string; overshoot: number } | null>(null);
  useEffect(() => {
    if (!enabled || result.startIndex < 0) {
      anchorRef.current = null;
      return;
    }
    const anchor = result.items.find((item) => item.index === result.startIndex);
    if (anchor !== undefined) {
      anchorRef.current = { key: anchor.key, overshoot: metrics.scrollOffset - anchor.start };
    }
  }, [enabled, result, metrics.scrollOffset]);

  // 実測反映（measureVersion 変化）時のみ、アイテム高のズレ分だけアンカーが動かないよう
  // スクロール位置を補正する（count/getItemKey/estimateSize は補正計算に読むが、スクロール毎の
  // 再実行を避けるため依存は measureVersion/enabled に絞る）。
  useIsomorphicLayoutEffect(() => {
    if (!enabled || measureVersion === 0) {
      return;
    }
    const anchor = anchorRef.current;
    const element = getScrollElementRef.current();
    if (anchor === null || element === null) {
      return;
    }
    const newStart = startForKey(
      {
        count,
        getKey: getItemKey,
        estimateSize,
        measured: measure ? measuredRef.current : EMPTY_MEASURED,
      },
      anchor.key,
    );
    if (newStart === null) {
      return;
    }
    const target = newStart + anchor.overshoot;
    if (Math.abs(element.scrollTop - target) >= 1) {
      element.scrollTop = target;
    }
    // measureVersion のみを依存にし、実測反映時だけ補正する（スクロール毎には走らせない）。
  }, [measureVersion, enabled]);

  const scrollToIndex = useCallback(
    (index: number, scrollOptions?: { align?: 'auto' | 'start' | 'center' }): void => {
      const element = getScrollElementRef.current();
      if (element === null || index < 0 || index >= count) {
        return;
      }
      // measure=false（推定固定）のときは実測マップを使わない。
      const measured = measure ? measuredRef.current : EMPTY_MEASURED;
      const targetStart = startForKey(
        { count, getKey: getItemKey, estimateSize, measured },
        getItemKey(index),
      );
      if (targetStart === null) {
        return;
      }
      const align = scrollOptions?.align ?? 'auto';
      const viewport = element.clientHeight;
      const itemSize = measured.get(getItemKey(index)) ?? estimateSize(index);
      if (align === 'start') {
        element.scrollTop = targetStart;
        return;
      }
      if (align === 'center') {
        element.scrollTop = targetStart - Math.max(0, (viewport - itemSize) / 2);
        return;
      }
      // auto: 可視域の外にあるときだけ、最小限スクロールして収める。
      const current = element.scrollTop;
      if (targetStart < current) {
        element.scrollTop = targetStart;
      } else if (targetStart + itemSize > current + viewport) {
        element.scrollTop = targetStart + itemSize - viewport;
      }
    },
    [count, getItemKey, estimateSize, measure],
  );

  return {
    virtualItems: result.items,
    pinnedItems: result.pinnedItems,
    beforeSize: result.beforeSize,
    afterSize: result.afterSize,
    totalSize: result.totalSize,
    measureElement,
    scrollToIndex,
  };
}
