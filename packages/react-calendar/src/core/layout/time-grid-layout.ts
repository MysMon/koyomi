/**
 * @packageDocumentation
 * 時間グリッドの重なりレイアウト。
 *
 * 週/日ビューで時間が重なるイベントを、Google カレンダーのように
 * 横に並べて配置するアルゴリズム。タイムゾーンや `Date` に依存しない
 * 純粋な数値演算のみを行う。位置は 0〜1 の割合で返す。
 */

/** 時間グリッドレイアウトへの入力アイテム。 */
export interface TimeGridItemInput {
  /** アイテムの識別キー（結果との対応付けに使用）。 */
  key: string;
  /** 表示開始（その日の 0:00 からの分）。 */
  startMinutes: number;
  /** 表示終了（分、排他）。`startMinutes < endMinutes` であること。 */
  endMinutes: number;
}

/** 時間グリッドレイアウトの結果（1 アイテム分）。 */
export interface TimeGridItemPlacement {
  /** 入力アイテムのキー。 */
  key: string;
  /** 左端位置（0〜1 の割合）。 */
  left: number;
  /** 幅（0〜1 の割合）。 */
  width: number;
}

/**
 * レイアウト計算の内部作業用エントリ。
 * 入力アイテムに、重なり判定用の実効終了分と配置結果を持たせたもの。
 */
interface LayoutEntry {
  /** 元の入力アイテム。 */
  readonly item: TimeGridItemInput;
  /**
   * 重なり判定に使う実効終了分。
   * `max(endMinutes, startMinutes + minSlotMinutes)` で、短いイベントも
   * 視覚上の最小長さを持つものとして扱う。
   */
  readonly effectiveEnd: number;
  /** クラスタ内で割り当てられた列番号（0 起点）。 */
  column: number;
  /** 計算結果: 左端位置（0〜1）。 */
  left: number;
  /** 計算結果: 幅（0〜1）。 */
  width: number;
}

/**
 * 2 つのエントリが重なり判定上衝突するかを返す。
 *
 * `[start, effectiveEnd)` の排他比較で判定する。実効区間が空
 * （`minSlotMinutes: 0` かつ長さ 0 以下）のエントリは何とも重ならない。
 */
function overlaps(a: LayoutEntry, b: LayoutEntry): boolean {
  return (
    a.item.startMinutes < a.effectiveEnd &&
    b.item.startMinutes < b.effectiveEnd &&
    a.item.startMinutes < b.effectiveEnd &&
    b.item.startMinutes < a.effectiveEnd
  );
}

/**
 * 時間が重なるイベント群を横並びに配置する。
 *
 * アルゴリズム（Google カレンダー方式）:
 * 1. 開始分昇順 → 長さ降順 → `key` 辞書順でソートする
 * 2. 推移的に重なるイベントを「クラスタ」にまとめる
 *    （A と B が重なり、B と C が重なるなら A・B・C は同一クラスタ。
 *    重なり判定は `[start, end)` の排他比較）
 * 3. クラスタ内で各イベントを「重ならない最小の列」に割り当てる
 * 4. クラスタの列数を `n` として、各イベントの幅は `1/n`、
 *    左端は `列番号 / n` とする
 * 5. 右隣の列に重なるイベントがない場合、幅を右方向へ拡張する
 *    （最大で次に衝突する列の手前まで）
 *
 * 比較のため、視覚上の最小長さとして `minSlotMinutes`（既定 30 分）より
 * 短いイベントは重なり判定上その長さがあるものとして扱う
 * （Google カレンダーで 15 分イベント同士が横に並ぶ挙動の再現）。
 *
 * @remarks
 * `startMinutes < endMinutes` の前提に反する入力（長さ 0 以下）でも例外は
 * 投げず、実効長のルールにより `startMinutes + minSlotMinutes` までの区間と
 * して扱う（`minSlotMinutes: 0` の場合は空区間となり何とも重ならない）。
 *
 * @param items - 入力アイテム
 * @param options.minSlotMinutes - 重なり判定上の最小長さ（分）。既定は 30
 * @returns 各アイテムの配置（入力と同数。順序は入力順を維持）
 *
 * @example
 * ```ts
 * // 10:00-11:00 と 10:30-11:30 は重なるため幅 1/2 で横並びになる
 * layoutTimeGridItems([
 *   { key: 'a', startMinutes: 600, endMinutes: 660 },
 *   { key: 'b', startMinutes: 630, endMinutes: 690 },
 * ]);
 * // => [
 * //   { key: 'a', left: 0, width: 0.5 },
 * //   { key: 'b', left: 0.5, width: 0.5 },
 * // ]
 * ```
 */
export function layoutTimeGridItems(
  items: readonly TimeGridItemInput[],
  options?: { minSlotMinutes?: number },
): TimeGridItemPlacement[] {
  const minSlotMinutes = options?.minSlotMinutes ?? 30;

  // 入力順を保持したまま作業用エントリを作る（結果はこの順序で返す）
  const entries: LayoutEntry[] = items.map((item) => ({
    item,
    effectiveEnd: Math.max(item.endMinutes, item.startMinutes + minSlotMinutes),
    column: 0,
    left: 0,
    width: 1,
  }));

  // 1. 開始分昇順 → 長さ降順 → key 辞書順でソート
  const sorted = [...entries].sort((a, b) => {
    if (a.item.startMinutes !== b.item.startMinutes) {
      return a.item.startMinutes - b.item.startMinutes;
    }
    const durationA = a.item.endMinutes - a.item.startMinutes;
    const durationB = b.item.endMinutes - b.item.startMinutes;
    if (durationA !== durationB) {
      return durationB - durationA;
    }
    if (a.item.key < b.item.key) {
      return -1;
    }
    return a.item.key > b.item.key ? 1 : 0;
  });

  // 2. 推移的に重なるエントリをクラスタにまとめる
  //    （開始順に走査し、実効終了分の最大値より前に始まるものは同一クラスタ）
  const clusters: LayoutEntry[][] = [];
  let currentCluster: LayoutEntry[] = [];
  let clusterMaxEnd = Number.NEGATIVE_INFINITY;
  for (const entry of sorted) {
    if (currentCluster.length > 0 && entry.item.startMinutes >= clusterMaxEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
    }
    currentCluster.push(entry);
    clusterMaxEnd = Math.max(clusterMaxEnd, entry.effectiveEnd);
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  for (const cluster of clusters) {
    // 3. クラスタ内で「重ならない最小の列」に割り当てる
    const columns: LayoutEntry[][] = [];
    for (const entry of cluster) {
      let column = columns.find((placed) => placed.every((other) => !overlaps(other, entry)));
      if (column === undefined) {
        column = [];
        columns.push(column);
      }
      entry.column = columns.indexOf(column);
      column.push(entry);
    }

    // 4. 幅 1/n・左端 列番号/n を基本とし、
    // 5. 右隣に衝突がない限り次に衝突する列の手前まで拡張する
    const columnCount = columns.length;
    for (const entry of cluster) {
      let endColumn = entry.column + 1;
      while (endColumn < columnCount) {
        const rightColumn = columns[endColumn];
        // noUncheckedIndexedAccess 対応のガード（範囲内なので実際には常に存在する）
        if (rightColumn === undefined || rightColumn.some((other) => overlaps(other, entry))) {
          break;
        }
        endColumn += 1;
      }
      entry.left = entry.column / columnCount;
      entry.width = (endColumn - entry.column) / columnCount;
    }
  }

  // 結果は入力順を維持して返す
  return entries.map((entry) => ({
    key: entry.item.key,
    left: entry.left,
    width: entry.width,
  }));
}
