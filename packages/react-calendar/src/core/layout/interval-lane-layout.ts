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

/** 区間レーン割当の結果。 */
export interface IntervalLaneResult {
  /** 各アイテムのレーン番号（入力と同数。順序は入力順を維持）。 */
  placements: readonly { key: string; lane: number }[];
  /** 使用レーン数（0 件なら 0）。 */
  laneCount: number;
}

/**
 * 時間が重なる区間を縦のレーンに積む。
 *
 * アルゴリズム:
 * 1. 開始昇順 → 長さ降順 → `key` 辞書順でソートする
 *    （既存の帯・時間グリッドレイアウトと同じハウスルール）
 * 2. 各区間を「既存の区間と重ならない最小のレーン」に貪欲に割り当てる
 *    （重なり判定は `[start, end)` の排他比較。接触は重ならない）
 *
 * `maxLanes` やあふれ集約は持たない（行の高さは `laneCount` に応じて伸びる。
 * 必要になったら {@link ../layout/band-layout} と同じ `hidden` + あふれ数の形で拡張する）。
 *
 * @param items - 入力アイテム
 * @returns 各アイテムの配置（入力と同数。順序は入力順を維持）
 * @example
 * ```ts
 * layoutIntervalLanes([
 *   { key: 'a', start: 0, end: 100 },
 *   { key: 'b', start: 50, end: 150 },
 * ]);
 * // => { placements: [{ key: 'a', lane: 0 }, { key: 'b', lane: 1 }], laneCount: 2 }
 * ```
 */
export function layoutIntervalLanes(items: readonly IntervalLaneInput[]): IntervalLaneResult {
  // 配置結果を入力順で確保しておき、ソート順の処理中に確定値を書き込む
  const placements: { key: string; lane: number }[] = items.map((item) => ({
    key: item.key,
    lane: 0,
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
    placements[index] = { key: item.key, lane };
  }

  return { placements, laneCount: laneEnds.length };
}
