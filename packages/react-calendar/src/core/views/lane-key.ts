/**
 * @packageDocumentation
 * リソースレーンのキー形式（encode/decode の対）。
 *
 * リソースビューの列キー（{@link ResourceColumn.key}）とタイムラインビューの
 * 行キー（{@link TimelineRow.key}）は同じ形式を共有する。形式はこのモジュールに
 * 閉じ込め、生成（encode）と復元（decode）を必ず対で管理する。利用側
 * （例: 外部ドラッグの `useExternalDrag`）がリテラルを直書きして再実装すると、
 * 形式変更時に静かに壊れるため、必ずここの関数を使うこと。
 */

/**
 * 未割り当てレーン（リソースに紐づかないイベントの列/行）のキー。
 * リソース ID には {@link laneKeyForResource} で `r:` 接頭辞が付くため、
 * `'unassigned'` という ID のリソースとは衝突しない。
 */
export const UNASSIGNED_LANE_KEY = 'unassigned';

/**
 * リソース ID からレーンキーを組み立てる。
 *
 * @param resourceId - リソース ID
 * @returns `` `r:${resourceId}` `` 形式のキー
 */
export function laneKeyForResource(resourceId: string): string {
  return `r:${resourceId}`;
}

/**
 * レーンキーからリソース ID を復元する（{@link laneKeyForResource} の逆変換）。
 *
 * @param key - レーンキー（`null` 可）
 * @returns リソース ID。未割り当て（{@link UNASSIGNED_LANE_KEY}）・`null`・
 *   解釈できない形式の値は `null` に正規化する
 */
export function resourceIdFromLaneKey(key: string | null): string | null {
  if (key === null || key === UNASSIGNED_LANE_KEY) {
    return null;
  }
  return key.startsWith('r:') ? key.slice(2) : null;
}
