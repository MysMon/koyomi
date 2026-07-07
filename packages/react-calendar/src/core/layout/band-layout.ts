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
 * 2. 各アイテムを、列区間 `[startCol, startCol + span)` が既存アイテムと
 *    重ならない最小のレーンに配置する
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

  /** 各レーンが専有している列区間 `[start, end)` のリスト。 */
  const lanes: { start: number; end: number }[][] = [];
  let laneCount = 0;

  for (const { item, index } of ordered) {
    const start = item.startCol;
    const end = item.startCol + item.span;

    // 既存アイテムと重ならない最小のレーンを探す（見つからなければ新規レーン）
    let lane = lanes.length;
    for (let i = 0; i < lanes.length; i += 1) {
      // noUncheckedIndexedAccess のため undefined を考慮する（i < lanes.length なので実際には存在する）
      const conflicts = lanes[i]?.some((interval) => interval.start < end && start < interval.end);
      if (conflicts !== true) {
        lane = i;
        break;
      }
    }

    const intervals = lanes[lane] ?? [];
    intervals.push({ start, end });
    lanes[lane] = intervals;

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
