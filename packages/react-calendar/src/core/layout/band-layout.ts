/**
 * @packageDocumentation
 * 帯レイアウト（週単位のレーン割当）。
 *
 * 月ビューの各週と、週/日ビューの終日イベント行で使う、
 * 帯状イベントの縦方向レーン割当とあふれ（「+N 件」）計算。
 * タイムゾーンや `Date` に依存しない純粋な整数演算のみを行う。
 */

/** 帯レイアウトへの入力アイテム。 */
export interface BandItemInput {
  /** アイテムの識別キー（結果との対応付けに使用）。 */
  key: string;
  /** 週内での開始列（0 起点）。 */
  startCol: number;
  /** 専有する列数（1 以上）。`startCol + span` は列数以下であること。 */
  span: number;
  /**
   * ソート用の開始時刻（エポックミリ秒など単調な数値）。
   * 小さいほど先（上のレーン）に配置される。
   *
   * `startCol` と同じ時間軸から導出した値であること（ソート順で並べたときに
   * `startCol` が単調非減少になること）。開始時刻が早いほど開始列も先（以左）に
   * なるという対応は、開始時刻と列を同じ表示範囲から導出するビュー側の呼び出しでは
   * 常に成立し、レーン割当の衝突判定（レーン末尾の終了列との比較）が前提とする。
   */
  sortStart: number;
  /**
   * ソート用の継続時間（ミリ秒など単調な数値）。
   * `sortStart` が同じ場合、大きい（長い）ほど先に配置される。
   * それも同じ場合は `key` の辞書順。
   */
  sortDuration: number;
}

/** 帯レイアウトの結果（1 アイテム分）。 */
export interface BandItemPlacement {
  /** 入力アイテムのキー。 */
  key: string;
  /** 割り当てられたレーン番号（0 起点）。 */
  lane: number;
  /** あふれにより非表示にすべきか（`lane >= maxLanes` の場合 `true`）。 */
  hidden: boolean;
}

/** 帯レイアウトの結果全体。 */
export interface BandLayoutResult {
  /** 各アイテムの配置（入力と同数。順序は入力順を維持）。 */
  placements: BandItemPlacement[];
  /** 表示されるレーンの数（非表示アイテムを除いた最大レーン + 1、0 件なら 0）。 */
  laneCount: number;
  /**
   * 列ごとのあふれ件数（長さ `columnCount` の配列）。
   * `overflowByCol[c]` = 列 `c` を覆う非表示アイテムの数。「+N 件」表示に使う。
   */
  overflowByCol: number[];
}

/**
 * 帯アイテムにレーンを割り当てる。
 *
 * アルゴリズム:
 * 1. `sortStart` 昇順 → `sortDuration` 降順 → `key` 辞書順でソートする
 *    （Google カレンダーと同様、早く始まり長く続くイベントが上に来る）
 * 2. 各アイテムを、レーン末尾（そのレーンに最後に置いた帯の終了列）が
 *    `startCol` 以下である最小のレーンに配置する。処理順で `startCol` が
 *    単調に進む（{@link BandItemInput.sortStart} の入力条件）ため、これは
 *    「列区間 `[startCol, startCol + span)` が既存アイテムと重ならない
 *    最小のレーン」と一致する（{@link ../layout/interval-lane-layout} と同じ方式）
 * 3. `maxLanes` が指定された場合、レーン番号が `maxLanes` 以上になった
 *    アイテムは `hidden: true` とし、覆っている各列のあふれ数に加算する
 *
 * 補足:
 * - 列区間の終端は排他的なので、`[0, 2)` と `[2, 4)` は重ならず同一レーンに入る
 * - `hidden` になったアイテムもレーンを専有するため、後続アイテムが
 *   そのレーンに割り込むことはない
 * - {@link BandLayoutResult.laneCount} は表示アイテムが乗るレーンのみ数える
 *   （`hidden` だけが乗るレーンは含めない）
 *
 * @param items - 入力アイテム
 * @param columnCount - 列数（週なら 7）
 * @param maxLanes - 表示する最大レーン数。省略時は無制限
 * @returns 配置結果
 * @example
 * ```ts
 * const result = layoutBandItems(
 *   [
 *     { key: 'a', startCol: 0, span: 3, sortStart: 0, sortDuration: 3 },
 *     { key: 'b', startCol: 1, span: 2, sortStart: 1, sortDuration: 2 },
 *     { key: 'c', startCol: 1, span: 1, sortStart: 1, sortDuration: 1 },
 *   ],
 *   7,
 *   2,
 * );
 * // a → レーン 0、b → レーン 1、c → レーン 2（maxLanes=2 のため hidden）
 * result.placements;
 * // => [
 * //   { key: 'a', lane: 0, hidden: false },
 * //   { key: 'b', lane: 1, hidden: false },
 * //   { key: 'c', lane: 2, hidden: true },
 * // ]
 * result.laneCount; // => 2
 * result.overflowByCol; // => [0, 1, 0, 0, 0, 0, 0]
 * ```
 */
export function layoutBandItems(
  items: readonly BandItemInput[],
  columnCount: number,
  maxLanes?: number,
): BandLayoutResult {
  // 列ごとのあふれ件数。不正な columnCount（負数）には空配列で防御する。
  const overflowByCol: number[] = Array.from({ length: Math.max(0, columnCount) }, () => 0);

  // 配置結果を入力順で確保しておき、ソート順の処理中に確定値を書き込む
  const placements: BandItemPlacement[] = items.map((item) => ({
    key: item.key,
    lane: 0,
    hidden: false,
  }));

  // 入力順を保持したまま処理順を決めるため、インデックス付きでソートする
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareBandItems(a.item, b.item));

  // 各レーンの「最後に置いた帯の終了列（排他）」。処理順（sortStart 昇順）と
  // 列の並びが揃っている（BandItemInput.sortStart の入力条件）ため、
  // 新しい帯はレーン末尾の帯とだけ比較すればよく、列ごとの占有状況を持たずに
  // レーン数に比例するコストで衝突判定できる（interval-lane-layout.ts と同じ方式。
  // レーンに置くのは末尾の終了列が開始列以下のときだけなので、この値はレーン内で
  // 単調増加し、常にそのレーンの最大の終了列と一致する）
  const laneEnds: number[] = [];
  let laneCount = 0;

  for (const { item, index } of ordered) {
    const start = item.startCol;
    const end = item.startCol + item.span;

    // 既存アイテムと重ならない（= レーン末尾の終了列 <= この帯の開始列）
    // 最小のレーンを探す（見つからなければ新規レーン）
    let lane = laneEnds.length;
    for (let i = 0; i < laneEnds.length; i += 1) {
      const laneEnd = laneEnds[i];
      if (laneEnd !== undefined && laneEnd <= start) {
        lane = i;
        break;
      }
    }
    laneEnds[lane] = end;

    const hidden = maxLanes !== undefined && lane >= maxLanes;
    if (hidden) {
      // 覆っている各列のあふれ数に加算する（範囲外の列は防御的に無視）
      const first = Math.max(0, start);
      const last = Math.min(end, overflowByCol.length);
      for (let col = first; col < last; col += 1) {
        overflowByCol[col] = (overflowByCol[col] ?? 0) + 1;
      }
    } else {
      // laneCount は表示されるアイテムが乗るレーンのみ数える
      laneCount = Math.max(laneCount, lane + 1);
    }

    placements[index] = { key: item.key, lane, hidden };
  }

  return { placements, laneCount, overflowByCol };
}

/**
 * 帯アイテムの処理順を決める比較関数。
 * `sortStart` 昇順 → `sortDuration` 降順 → `key` 辞書順。
 *
 * @param a - 比較対象のアイテム
 * @param b - 比較対象のアイテム
 * @returns `a` を先に処理するなら負、`b` を先なら正、同順なら 0
 */
function compareBandItems(a: BandItemInput, b: BandItemInput): number {
  if (a.sortStart !== b.sortStart) {
    return a.sortStart - b.sortStart;
  }
  if (a.sortDuration !== b.sortDuration) {
    return b.sortDuration - a.sortDuration;
  }
  if (a.key < b.key) {
    return -1;
  }
  if (a.key > b.key) {
    return 1;
  }
  return 0;
}
