/**
 * @packageDocumentation
 * 区間レーン割当。
 *
 * タイムラインビューの行内で、時間が重なる帯を縦のレーンに積むための
 * 純粋関数。{@link ../layout/band-layout} の帯レイアウトが整数列インデックスと
 * 列数分の `overflowByCol` 配列を前提とするのに対し、こちらは分単位などの
 * 連続量の区間をそのまま扱う。タイムゾーンや `Date` に依存しない数値演算のみを行う。
 */

/** 区間レーン割当への入力アイテム。 */
export interface IntervalLaneInput {
  /** アイテムの識別キー（結果との対応付けに使用）。 */
  key: string;
  /** 区間の開始（単調な数値。タイムラインでは表示分）。 */
  start: number;
  /** 区間の終了（排他）。`start < end` であること。 */
  end: number;
}

/** 区間レーン割当の結果（1 アイテム分）。 */
export interface IntervalLanePlacement {
  /** 入力アイテムのキー。 */
  key: string;
  /** 割り当てられたレーン番号（0 起点）。 */
  lane: number;
  /** あふれにより非表示にすべきか（`lane >= maxLanes` の場合 `true`）。 */
  hidden: boolean;
}

/** 区間レーン割当の結果。 */
export interface IntervalLaneResult {
  /** 各アイテムの配置（入力と同数。順序は入力順を維持）。 */
  placements: readonly IntervalLanePlacement[];
  /** 表示されるレーンの数（非表示アイテムを除いた最大レーン + 1、0 件なら 0）。 */
  laneCount: number;
  /**
   * あふれにより非表示になったアイテムの総数（`maxLanes` 未指定・非超過なら 0）。
   * 区間は列を持たない連続量のため、{@link ../layout/band-layout} の
   * `overflowByCol` のような列別の内訳ではなく総数のみを返す。
   */
  overflowCount: number;
}

/**
 * 時間が重なる区間を縦のレーンに積む。
 *
 * アルゴリズム:
 * 1. 開始昇順 → 長さ降順 → `key` 辞書順でソートする
 *    （既存の帯・時間グリッドレイアウトと同じハウスルール）
 * 2. 各区間を「既存の区間と重ならない最小のレーン」に貪欲に割り当てる
 *    （重なり判定は `[start, end)` の排他比較。接触は重ならない）
 * 3. `maxLanes` が指定された場合、レーン番号が `maxLanes` 以上になった
 *    アイテムは `hidden: true` とし、`overflowCount` に加算する
 *    （{@link ../layout/band-layout} の `layoutBandItems` と同じ規則。
 *    `hidden` になったアイテムもレーンを専有するため、後続アイテムが
 *    そのレーンに割り込むことはない）
 *
 * `maxLanes` 省略時（既定）は全アイテムが `hidden: false` になり、行の高さは
 * `laneCount` に応じて伸びる。
 *
 * @param items - 入力アイテム
 * @param maxLanes - 表示する最大レーン数。省略時は無制限
 * @returns 各アイテムの配置（入力と同数。順序は入力順を維持）
 * @example
 * ```ts
 * layoutIntervalLanes([
 *   { key: 'a', start: 0, end: 100 },
 *   { key: 'b', start: 50, end: 150 },
 * ]);
 * // => {
 * //   placements: [
 * //     { key: 'a', lane: 0, hidden: false },
 * //     { key: 'b', lane: 1, hidden: false },
 * //   ],
 * //   laneCount: 2,
 * //   overflowCount: 0,
 * // }
 * ```
 * @example
 * ```ts
 * // maxLanes=1 では 2 本目の区間があふれる
 * layoutIntervalLanes(
 *   [
 *     { key: 'a', start: 0, end: 100 },
 *     { key: 'b', start: 50, end: 150 },
 *   ],
 *   1,
 * );
 * // => {
 * //   placements: [
 * //     { key: 'a', lane: 0, hidden: false },
 * //     { key: 'b', lane: 1, hidden: true },
 * //   ],
 * //   laneCount: 1,
 * //   overflowCount: 1,
 * // }
 * ```
 */
export function layoutIntervalLanes(
  items: readonly IntervalLaneInput[],
  maxLanes?: number,
): IntervalLaneResult {
  // 配置結果を入力順で確保しておき、ソート順の処理中に確定値を書き込む
  const placements: IntervalLanePlacement[] = items.map((item) => ({
    key: item.key,
    lane: 0,
    hidden: false,
  }));

  // 入力順を保持したまま処理順を決めるため、インデックス付きでソートする
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.start !== b.item.start) {
        return a.item.start - b.item.start;
      }
      const durationA = a.item.end - a.item.start;
      const durationB = b.item.end - b.item.start;
      if (durationA !== durationB) {
        return durationB - durationA;
      }
      if (a.item.key < b.item.key) {
        return -1;
      }
      return a.item.key > b.item.key ? 1 : 0;
    });

  // 各レーンの「最後に置いた区間の終了」。開始昇順で処理するため、
  // 新しい区間はレーン末尾の区間とだけ重なり判定すればよい
  const laneEnds: number[] = [];
  let laneCount = 0;
  let overflowCount = 0;

  for (const { item, index } of ordered) {
    // 既存の区間と重ならない（= レーン末尾の終了 <= この区間の開始）最小のレーンを探す
    let lane = laneEnds.length;
    for (let i = 0; i < laneEnds.length; i += 1) {
      const laneEnd = laneEnds[i];
      if (laneEnd !== undefined && laneEnd <= item.start) {
        lane = i;
        break;
      }
    }
    laneEnds[lane] = item.end;

    const hidden = maxLanes !== undefined && lane >= maxLanes;
    if (hidden) {
      overflowCount += 1;
    } else {
      // laneCount は表示されるアイテムが乗るレーンのみ数える
      laneCount = Math.max(laneCount, lane + 1);
    }

    placements[index] = { key: item.key, lane, hidden };
  }

  return { placements, laneCount, overflowCount };
}
