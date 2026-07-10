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
    //
    // 元の実装は「列内の全アイテムのうち 1 つでも重なれば NG」という判定を
    // 列内の全アイテムと逐一比較して行っていたが、cluster は開始分昇順に
    // 処理されるため次の不変条件が成り立つ:
    //   ある列に置かれた実効長が正のアイテムどうしは、追加された順に
    //   effectiveEnd が非減少になる（新規アイテムは、既存の全アイテムの
    //   effectiveEnd 以上の開始分でなければその列に入れないため）。
    // したがって「列内の全アイテムと比較」は「列に置かれた最大の
    // effectiveEnd（columnEnds）と比較」に単純化できる。
    // （`Math.max` で更新するのは、実効長が 0 以下＝誰とも重ならない
    // アイテムが列の途中に挟まっても最大値を後退させないための保険）
    //
    // ただし実効長が 0 以下（`minSlotMinutes: 0` かつ長さ 0 以下）の
    // アイテムは定義上誰とも重ならないため、このアイテムに限っては列 0 に
    // 無条件で割り当てる（columnEnds との比較をすると誤って別の列に
    // 弾かれ得るため特別扱いする）。
    const columns: LayoutEntry[][] = [];
    const columnEnds: number[] = [];
    for (const entry of cluster) {
      let columnIndex: number;
      if (entry.item.startMinutes >= entry.effectiveEnd) {
        if (columns.length === 0) {
          columns.push([]);
          columnEnds.push(Number.NEGATIVE_INFINITY);
        }
        columnIndex = 0;
      } else {
        columnIndex = columnEnds.findIndex((end) => entry.item.startMinutes >= end);
        if (columnIndex === -1) {
          columnIndex = columns.length;
          columns.push([]);
          columnEnds.push(Number.NEGATIVE_INFINITY);
        }
      }
      const column = columns[columnIndex];
      // noUncheckedIndexedAccess 対応のガード（columnIndex は必ず範囲内）
      if (column === undefined) {
        continue;
      }
      entry.column = columnIndex;
      column.push(entry);
      columnEnds[columnIndex] = Math.max(
        columnEnds[columnIndex] ?? Number.NEGATIVE_INFINITY,
        entry.effectiveEnd,
      );
    }

    // 4. 幅 1/n・左端 列番号/n を基本とし、
    // 5. 右隣に衝突がない限り次に衝突する列の手前まで拡張する
    //
    // 元の実装は右隣の列に対して「列内のいずれかのアイテムと重なるか」を
    // 列内の全アイテムを毎回舐めて判定していた。この幅拡張フェーズは列の
    // 確定後に行うため、対象の列には（クラスタ内で見て）entry より後に開始する
    // アイテムも含まれ得て、3. の columnEnds のような「直近の終了分」だけの
    // 追跡では足りない（同じ列内に手前の隙間があるケースを誤って塞いでしまう）。
    // そこで列ごとに実効長が正のアイテムだけを取り出した配列（挿入順=開始分
    // 昇順のまま）を用意し、cluster を開始分昇順に処理する性質を利用して
    // 「その列で entry.startMinutes 以下の開始分を持つアイテムを消費し尽くす
    // ポインタ」と「消費済みアイテムの effectiveEnd の最大値」を列ごとに
    // 1 個ずつ保持する（実効長 0 以下のアイテムは誰とも重ならないため
    // 判定対象から除外してよい）。
    // これにより「entry より前に開始した重なり」は保持した最大値との比較、
    // 「entry より後に開始する最初のアイテムとの重なり」は次の未消費アイテム
    // 1 件との比較で判定でき、列内の総当たりが不要になる。
    const columnCount = columns.length;
    const positiveColumns: LayoutEntry[][] = columns.map((column) =>
      column.filter((entry) => entry.item.startMinutes < entry.effectiveEnd),
    );
    const consumedUpTo: number[] = new Array(columnCount).fill(0);
    const consumedMaxEnd: number[] = new Array(columnCount).fill(Number.NEGATIVE_INFINITY);

    for (const entry of cluster) {
      if (entry.item.startMinutes >= entry.effectiveEnd) {
        // 実効長 0 以下のアイテムは誰とも重ならないため無条件に最終列まで広がる
        entry.left = entry.column / columnCount;
        entry.width = (columnCount - entry.column) / columnCount;
        continue;
      }

      let endColumn = entry.column + 1;
      while (endColumn < columnCount) {
        const positives = positiveColumns[endColumn];
        if (positives === undefined) {
          break;
        }
        let ptr = consumedUpTo[endColumn] ?? 0;
        let maxEnd = consumedMaxEnd[endColumn] ?? Number.NEGATIVE_INFINITY;
        while (ptr < positives.length) {
          const candidate = positives[ptr];
          if (candidate === undefined || candidate.item.startMinutes > entry.item.startMinutes) {
            break;
          }
          maxEnd = Math.max(maxEnd, candidate.effectiveEnd);
          ptr += 1;
        }
        consumedUpTo[endColumn] = ptr;
        consumedMaxEnd[endColumn] = maxEnd;

        const blockedByEarlier = maxEnd > entry.item.startMinutes;
        const next = positives[ptr];
        const blockedByLater = next !== undefined && next.item.startMinutes < entry.effectiveEnd;
        if (blockedByEarlier || blockedByLater) {
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
