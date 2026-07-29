/**
 * @packageDocumentation
 * 縦方向ウィンドウイング（仮想化）の純粋計算。
 *
 * スクロール位置・ビューポート高・アイテム高（推定＋実測）から、描画すべき
 * アイテムの範囲とオフセットを求める。React・DOM には一切依存しない純関数のみで、
 * 実測（ResizeObserver）やスクロール購読といった副作用は React 層（`use-virtualizer`）が担う。
 *
 * アイテム高は「推定（`estimateSize`）」を基本とし、実測済みのものは
 * `measured`（**キー基準**）で上書きする。キー基準にすることで、表示範囲の変更・
 * 先頭挿入・並び替えでインデックスがずれても実測値が誤って別アイテムに適用されない。
 */

/**
 * ウィンドウ内に配置される 1 アイテムの縦方向レイアウト（px）。
 */
export interface VirtualItem {
  /** アイテムのインデックス（0 起点）。 */
  index: number;
  /** アイテムの安定キー。測定キャッシュ・React の key・フォーカス保持の基準。 */
  key: string;
  /** コンテナ先端からのオフセット（px、全アイテム共通の絶対座標系）。 */
  start: number;
  /** 高さ（px）。`measured` にあればその値、無ければ `estimateSize` の値。 */
  size: number;
  /** 高さが実測値かどうか（`false` なら推定値）。 */
  measured: boolean;
}

/**
 * {@link computeWindow} の入力。
 */
export interface WindowInput {
  /** アイテム総数。 */
  count: number;
  /** インデックス → 安定キー。 */
  getKey: (index: number) => string;
  /** インデックス → 推定高（px）。関数なので「件数に比例」等を表現できる。 */
  estimateSize: (index: number) => number;
  /** 実測済み高（キー → px）。インデックスではなくキー基準（並び替え・挿入に強い）。 */
  measured: ReadonlyMap<string, number>;
  /** スクロール位置（px、コンテナ先端基準）。 */
  scrollOffset: number;
  /** ビューポート（スクロールコンテナ）の可視高（px）。 */
  viewportSize: number;
  /** 前後に余分に描画するアイテム数（ちらつき防止）。既定 3。 */
  overscan?: number;
  /** 窓外でも常に描画へ含めたいキー（フォーカス保持アイテム等）。 */
  pinnedKeys?: ReadonlySet<string>;
}

/**
 * {@link computeWindow} の結果。
 *
 * - `items` — 連続する可視窓（overscan 込み・インデックス昇順・重複なし）。通常フローに並べる。
 * - `pinnedItems` — `pinnedKeys` のうち `items` に含まれない（窓外の）ものだけ。
 *   通常フローに混ぜず、絶対配置（`top = start`）で保持する。`items` とキーで互いに素。
 * - `beforeSize` — 窓の先頭より上の総高（＝ 上スペーサの高さ）。
 * - `afterSize` — 窓の末尾より下の総高（＝ 下スペーサの高さ）。
 * - `totalSize` — 全アイテムの合計高（スクロール領域の総高）。
 *   常に `beforeSize + Σsize(items) + afterSize === totalSize` が成り立つ。
 * - `startIndex` / `endIndex` — 可視範囲（overscan を除く）。`count === 0` なら共に `-1`。
 */
export interface WindowResult {
  items: VirtualItem[];
  pinnedItems: VirtualItem[];
  beforeSize: number;
  afterSize: number;
  totalSize: number;
  startIndex: number;
  endIndex: number;
}

/** overscan 未指定時の既定値。 */
const DEFAULT_OVERSCAN = 3;

/**
 * 実測（キー基準）を優先し、無ければ推定を用いた 1 アイテムの高さを返す。
 * 負値は 0 にクランプする（レイアウト計算を壊さないため）。
 */
function resolveSize(
  index: number,
  getKey: (index: number) => string,
  estimateSize: (index: number) => number,
  measured: ReadonlyMap<string, number>,
): number {
  const measuredSize = measured.get(getKey(index));
  const size = measuredSize ?? estimateSize(index);
  // 有限かつ正の値のみ採用する。NaN / Infinity / 負値は 0 に丸め、totalSize や
  // スペーサ高（before/after）に NaN / Infinity が伝播してレイアウトが壊れるのを防ぐ。
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * スクロール状態から描画すべきウィンドウを計算する純関数。
 *
 * アイテム高は実測（`measured`、キー基準）を推定（`estimateSize`）より優先し、
 * 先頭からの累積でオフセットを決める。可視範囲が空になる場合（ビューポート高 0 や
 * 末尾より先へのスクロール）でも、`count > 0` なら最低 1 件を返し恒等式を保つ。
 *
 * @param input - スクロール位置・ビューポート高・アイテム高などの入力
 * @returns 描画すべきアイテム・スペーサ高・可視範囲を含む {@link WindowResult}
 *
 * @example
 * ```ts
 * const result = computeWindow({
 *   count: 100,
 *   getKey: (i) => days[i].key,
 *   estimateSize: () => 64,
 *   measured: new Map(),
 *   scrollOffset: 320,
 *   viewportSize: 480,
 * });
 * // result.items を描画し、上下に result.beforeSize / result.afterSize のスペーサを置く
 * ```
 */
export function computeWindow(input: WindowInput): WindowResult {
  const {
    count,
    getKey,
    estimateSize,
    measured,
    scrollOffset,
    viewportSize,
    overscan = DEFAULT_OVERSCAN,
    pinnedKeys,
  } = input;

  if (count <= 0) {
    return {
      items: [],
      pinnedItems: [],
      beforeSize: 0,
      afterSize: 0,
      totalSize: 0,
      startIndex: -1,
      endIndex: -1,
    };
  }

  // 各アイテムの start / size を先頭から累積で求める（O(count)）。
  const starts: number[] = new Array(count);
  const sizes: number[] = new Array(count);
  const viewportEnd = scrollOffset + viewportSize;
  let cumulative = 0;
  let firstVisible = count; // 可視の先頭（見つからなければ count のまま）
  let lastVisible = -1; // 可視の末尾（見つからなければ -1 のまま）
  // pinnedKeys 指定時のみ、キー → インデックスを記録する。
  const pinnedIndexByKey =
    pinnedKeys !== undefined && pinnedKeys.size > 0 ? new Map<string, number>() : undefined;

  for (let index = 0; index < count; index += 1) {
    const size = resolveSize(index, getKey, estimateSize, measured);
    starts[index] = cumulative;
    sizes[index] = size;
    const end = cumulative + size;
    // end > scrollOffset を満たす最初のアイテムが可視の先頭。
    if (end > scrollOffset && firstVisible === count) {
      firstVisible = index;
    }
    // start < viewportEnd を満たす最後のアイテムが可視の末尾。
    if (cumulative < viewportEnd) {
      lastVisible = index;
    }
    if (pinnedIndexByKey !== undefined) {
      const key = getKey(index);
      if (pinnedKeys?.has(key) === true && !pinnedIndexByKey.has(key)) {
        pinnedIndexByKey.set(key, index);
      }
    }
    cumulative += size;
  }
  const totalSize = cumulative;

  // 可視範囲を [0, count-1] にクランプし、最低 1 件を保証する。
  const startIndex = Math.min(firstVisible, count - 1);
  const endIndex = Math.max(startIndex, lastVisible);

  // overscan を前後に足して窓範囲を決める（負値・小数は 0 以上の整数に正規化する）。
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const windowStart = Math.max(0, startIndex - safeOverscan);
  const windowEnd = Math.min(count - 1, endIndex + safeOverscan);

  const items: VirtualItem[] = [];
  for (let index = windowStart; index <= windowEnd; index += 1) {
    items.push(makeVirtualItem(index, getKey, starts, sizes, measured));
  }

  const firstStart = starts[windowStart] ?? 0;
  const lastStart = starts[windowEnd] ?? 0;
  const lastSize = sizes[windowEnd] ?? 0;
  const beforeSize = firstStart;
  const afterSize = totalSize - (lastStart + lastSize);

  const pinnedItems: VirtualItem[] = [];
  if (pinnedIndexByKey !== undefined) {
    const outside = [...pinnedIndexByKey.values()]
      .filter((index) => index < windowStart || index > windowEnd)
      .sort((a, b) => a - b);
    for (const index of outside) {
      pinnedItems.push(makeVirtualItem(index, getKey, starts, sizes, measured));
    }
  }

  return { items, pinnedItems, beforeSize, afterSize, totalSize, startIndex, endIndex };
}

/**
 * 累積済みの `starts` / `sizes` から {@link VirtualItem} を組み立てる。
 */
function makeVirtualItem(
  index: number,
  getKey: (index: number) => string,
  starts: readonly number[],
  sizes: readonly number[],
  measured: ReadonlyMap<string, number>,
): VirtualItem {
  const key = getKey(index);
  return {
    index,
    key,
    start: starts[index] ?? 0,
    size: sizes[index] ?? 0,
    measured: measured.has(key),
  };
}

/**
 * {@link sectionItemWindow} の入力。
 *
 * 「セクション（見出し＋等高アイテム列）」のうち、ビューポートに重なるアイテム範囲を
 * 求めるための情報。セクション自体の位置（`sectionStart`）は外側のウィンドウイング
 * （{@link computeWindow} の `VirtualItem.start`）と同じ絶対座標系（px）で渡す。
 */
export interface SectionItemWindowInput {
  /** セクション内のアイテム総数。 */
  itemCount: number;
  /** セクションの開始位置（px、スクロールコンテナ先端基準の絶対座標系）。 */
  sectionStart: number;
  /** セクション見出しの高さ（px）。アイテム列は `sectionStart + headerSize` から始まる。 */
  headerSize: number;
  /** アイテム 1 件の推定高（px）。セクション内は等高とみなして計算する。 */
  estimateItemSize: number;
  /** スクロール位置（px、コンテナ先端基準）。 */
  scrollOffset: number;
  /** ビューポート（スクロールコンテナ）の可視高（px）。 */
  viewportSize: number;
  /** 前後に余分に描画するアイテム数（ちらつき防止）。既定 3。 */
  overscan?: number | undefined;
}

/**
 * {@link sectionItemWindow} の結果。
 *
 * - `startIndex` / `endIndex` — 描画すべきアイテム範囲（overscan 込み・両端含む）。
 *   `itemCount === 0` なら共に `-1`。`itemCount > 0` なら最低 1 件を含む。
 * - `topPad` / `bottomPad` — 範囲の前後に置く詰め物の高さ（px）。常に
 *   `topPad + 範囲件数 × estimateItemSize + bottomPad === itemCount × estimateItemSize`
 *   が成り立つ（等高前提のため）。
 */
export interface SectionItemWindowResult {
  startIndex: number;
  endIndex: number;
  topPad: number;
  bottomPad: number;
}

/**
 * セクション（見出し＋等高アイテム列）内で描画すべきアイテム範囲を計算する純関数。
 *
 * 外側のウィンドウイング（{@link computeWindow}）が「どのセクションを描画するか」を
 * 決めるのに対し、本関数は「そのセクションの中のどのアイテムを描画するか」を決める。
 * 1 セクションに大量のアイテムがある場合（リストビューの 1 日に数百件の予定など）の
 * 二段目のウィンドウイングに使う。アイテムは等高（`estimateItemSize`）とみなすため、
 * 範囲・詰め物は O(1) の割り算で求まる。
 *
 * 境界の規約は {@link computeWindow} と同じ:
 * - `end > scrollOffset` を満たす最初のアイテムが可視の先頭、`start < viewportEnd` を
 *   満たす最後のアイテムが可視の末尾（両端ちょうどは含まない）。
 * - 可視アイテムが無い（セクションが完全にビューポート外）でも `itemCount > 0` なら
 *   最低 1 件を返し、恒等式を保つ。
 * - `estimateItemSize` が 0 以下・非有限のときは範囲を求められないため、全件描画へ
 *   安全に縮退する（`topPad` / `bottomPad` は 0）。
 *
 * @param input - セクション位置・アイテム高・スクロール状態（{@link SectionItemWindowInput}）
 * @returns 描画すべきアイテム範囲と前後の詰め物 px（{@link SectionItemWindowResult}）
 *
 * @example
 * ```ts
 * const window = sectionItemWindow({
 *   itemCount: 300,
 *   sectionStart: 1200,
 *   headerSize: 24,
 *   estimateItemSize: 32,
 *   scrollOffset: 1500,
 *   viewportSize: 600,
 * });
 * // items[window.startIndex..window.endIndex] を描画し、
 * // 上下に window.topPad / window.bottomPad の詰め物を置く
 * ```
 */
export function sectionItemWindow(input: SectionItemWindowInput): SectionItemWindowResult {
  const {
    itemCount,
    sectionStart,
    headerSize,
    estimateItemSize,
    scrollOffset,
    viewportSize,
    overscan = DEFAULT_OVERSCAN,
  } = input;

  if (itemCount <= 0) {
    return { startIndex: -1, endIndex: -1, topPad: 0, bottomPad: 0 };
  }
  // 推定高が 0 以下・非有限では範囲の割り算が成立しないため、全件描画へ縮退する。
  if (!Number.isFinite(estimateItemSize) || estimateItemSize <= 0) {
    return { startIndex: 0, endIndex: itemCount - 1, topPad: 0, bottomPad: 0 };
  }

  // アイテム列ローカル座標（アイテム i は [i×est, (i+1)×est) を占める）での可視範囲。
  const itemsStart = sectionStart + headerSize;
  const visibleStart = scrollOffset - itemsStart;
  const visibleEnd = visibleStart + Math.max(0, viewportSize);

  // end > visibleStart を満たす最初のアイテム / start < visibleEnd を満たす最後のアイテム
  // （computeWindow と同じ排他規約）。範囲外は [0, itemCount-1] にクランプし最低 1 件を保証する。
  const firstVisible = Math.floor(visibleStart / estimateItemSize);
  const lastVisible = Math.ceil(visibleEnd / estimateItemSize) - 1;
  const startIndex = Math.min(Math.max(0, firstVisible), itemCount - 1);
  const endIndex = Math.max(startIndex, Math.min(lastVisible, itemCount - 1));

  // overscan を前後に足す（負値・小数は 0 以上の整数に正規化する）。
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const windowStart = Math.max(0, startIndex - safeOverscan);
  const windowEnd = Math.min(itemCount - 1, endIndex + safeOverscan);

  return {
    startIndex: windowStart,
    endIndex: windowEnd,
    topPad: windowStart * estimateItemSize,
    bottomPad: (itemCount - 1 - windowEnd) * estimateItemSize,
  };
}

/**
 * 可視ウィンドウ（スクロールで実際に見えている範囲。overscan を含まない）の
 * インデックス範囲とキー範囲。
 *
 * 可視範囲の変更通知（`VirtualTimelineView` の `onVisibleRangeChange` など）で、
 * 「どこからどこまでが見えているか」をキー基準で表すために使う。キーを含めるのは、
 * 表示範囲の移動や並びの変更でインデックスが同じまま内容が入れ替わっても
 * 変化として検出できるようにするため。
 */
export interface VisibleWindowRange {
  /** 可視範囲の先頭インデックス（0 起点）。アイテムが 0 件なら `-1`。 */
  startIndex: number;
  /** 可視範囲の末尾インデックス（両端含む）。アイテムが 0 件なら `-1`。 */
  endIndex: number;
  /** 可視範囲の先頭アイテムのキー。アイテムが 0 件なら `null`。 */
  startKey: string | null;
  /** 可視範囲の末尾アイテムのキー。アイテムが 0 件なら `null`。 */
  endKey: string | null;
}

/**
 * {@link computeWindow} の結果から可視ウィンドウ（overscan を除く）の
 * {@link VisibleWindowRange} を組み立てる純関数。
 *
 * @param result - `startIndex` / `endIndex` を含む {@link WindowResult}（の部分集合）
 * @param getKey - インデックス → 安定キー（{@link WindowInput.getKey} と同じもの）
 * @returns キー付きの可視範囲。`startIndex` が負（0 件）ならキーは `null`
 */
export function visibleWindowRange(
  result: Pick<WindowResult, 'startIndex' | 'endIndex'>,
  getKey: (index: number) => string,
): VisibleWindowRange {
  const { startIndex, endIndex } = result;
  if (startIndex < 0 || endIndex < 0) {
    return { startIndex: -1, endIndex: -1, startKey: null, endKey: null };
  }
  return {
    startIndex,
    endIndex,
    startKey: getKey(startIndex),
    endKey: getKey(endIndex),
  };
}

/**
 * 2 つの {@link VisibleWindowRange} が同じ内容かどうかを判定する純関数。
 *
 * 可視範囲の変更通知の発火判定（内容が変わったときだけ 1 回通知する）に使う。
 * `null` は「まだ範囲を記録していない」を表し、非 `null` とは常に不一致
 * （＝初回は必ず「変化あり」）として扱う。
 *
 * @param a - 比較する範囲（`null` は未記録）
 * @param b - 比較する範囲（`null` は未記録）
 * @returns インデックス・キーがすべて等しければ `true`
 */
export function sameVisibleWindowRange(
  a: VisibleWindowRange | null,
  b: VisibleWindowRange | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.startKey === b.startKey &&
    a.endKey === b.endKey
  );
}

/**
 * 指定したキーを持つアイテムの `start`（px）を返す。無ければ `null`。
 *
 * 可変高でのスクロールアンカリング（測定反映後にスクロール位置を補正する）で、
 * 「アンカーとなるアイテムの新しい start」をインデックス非依存で求めるために使う。
 *
 * @param input - `count` / `getKey` / `estimateSize` / `measured`（{@link WindowInput} の部分集合）
 * @param key - start を求めたいアイテムのキー
 * @returns アイテムの `start`（px）。該当キーが無ければ `null`
 */
export function startForKey(
  input: Pick<WindowInput, 'count' | 'getKey' | 'estimateSize' | 'measured'>,
  key: string,
): number | null {
  const { count, getKey, estimateSize, measured } = input;
  let cumulative = 0;
  for (let index = 0; index < count; index += 1) {
    if (getKey(index) === key) {
      return cumulative;
    }
    cumulative += resolveSize(index, getKey, estimateSize, measured);
  }
  return null;
}
