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
 * @param items - 入力アイテム
 * @param options.minSlotMinutes - 重なり判定上の最小長さ（分）。既定は 30
 * @returns 各アイテムの配置（入力と同数。順序は入力順を維持）
 */
export function layoutTimeGridItems(
  items: readonly TimeGridItemInput[],
  options?: { minSlotMinutes?: number },
): TimeGridItemPlacement[] {
  void items;
  void options;
  throw new Error('未実装');
}
