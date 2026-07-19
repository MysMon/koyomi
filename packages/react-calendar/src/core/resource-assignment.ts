/**
 * @packageDocumentation
 * イベントのリソース割当（`resourceId` / `resourceIds`）の解決規則。
 *
 * 優先規則: {@link CalendarEvent.resourceIds} が指定されている場合（空配列を含む）は
 * それを採用し、{@link CalendarEvent.resourceId} は無視する。`resourceIds` 未指定時は
 * `resourceId`（単一割当）に従う。
 *
 * リソース/タイムラインビューのバケット分け（{@link ./views/resource-view} /
 * {@link ./views/timeline-view}）と、D&D・キーボード操作のレーン間移動パッチの構築
 * （react 層のドラッグ系フック）が同じ規則を共有するため、このモジュールに集約する。
 */

import type { CalendarEvent, CalendarEventPatch } from './types';

/**
 * {@link effectiveResourceIds} 等が参照する、リソース割当フィールドのみの部分型。
 * `CalendarEvent` 全体を要求しないことで、テスト・呼び出し側の記述を簡潔にする。
 */
export type ResourceAssignmentFields = Pick<CalendarEvent, 'resourceId' | 'resourceIds'>;

/**
 * イベントの実効的な割当リソース ID の一覧（重複除去済み・指定順）を返す。
 *
 * - `resourceIds` 指定時（空配列を含む）— `resourceIds` の重複を先勝ちで除いた一覧。
 *   `resourceId` は無視する
 * - `resourceIds` 未指定時 — `resourceId` があれば 1 件の一覧、なければ空配列
 *
 * @param event - 対象イベント（割当フィールドのみ参照する）
 * @returns 割当リソース ID の一覧。未割り当てなら空配列
 * @example
 * ```ts
 * effectiveResourceIds({ resourceId: 'a', resourceIds: ['b', 'c'] }); // => ['b', 'c']
 * effectiveResourceIds({ resourceId: 'a' }); // => ['a']
 * ```
 */
export function effectiveResourceIds(event: ResourceAssignmentFields): readonly string[] {
  if (event.resourceIds !== undefined) {
    return [...new Set(event.resourceIds)];
  }
  return event.resourceId !== undefined ? [event.resourceId] : [];
}

/**
 * イベントが属するレーン ID の一覧（`null` = 未割り当てレーン）を返す。
 *
 * 実効的な割当（{@link effectiveResourceIds}）のうち `knownResourceIds` に存在する
 * ID だけをレーンにする。存在する ID が 1 件もない場合（割当なし、またはすべて
 * 参照先のない ID）は未割り当てレーン（`[null]`）に 1 回だけ合流する
 * （黙って非表示にしない。従来の `resourceId` 単一割当と同じ規則）。
 *
 * @param event - 対象イベント（割当フィールドのみ参照する）
 * @param knownResourceIds - 存在するリソース ID の集合（ID 重複除去後）
 * @returns レーン ID の一覧（1 件以上）。未割り当ては `[null]`
 */
export function assignedLaneIds(
  event: ResourceAssignmentFields,
  knownResourceIds: { has(id: string): boolean },
): readonly (string | null)[] {
  const known = effectiveResourceIds(event).filter((id) => knownResourceIds.has(id));
  return known.length > 0 ? known : [null];
}

/**
 * レーン間移動（D&D・キーボード操作）による割当変更のパッチを構築する。
 *
 * 「操作したレーンの割当だけを変更する」規則で、移動元レーン以外の割当は保持する:
 *
 * - 単一割当（`resourceIds` 未指定）— `resourceId` を移動先へ差し替える。
 *   未割り当てへの移動はフィールド削除（キーが存在し値が `undefined`）になる
 * - 複数割当（`resourceIds` 指定）— 移動元レーンの ID だけを移動先の ID に置き換える。
 *   移動先がすでに割当済みなら統合する（重複させない）。未割り当てへの移動は
 *   移動元レーンの ID だけを取り除く（最後の 1 件を外すと空配列 = 未割り当てになる）。
 *   参照先のない ID は変更されずそのまま保持される
 *
 * @param event - 対象イベント（割当フィールドのみ参照する）
 * @param sourceLaneId - 操作を開始したレーンのリソース ID（未割り当てレーンは `null`）
 * @param targetLaneId - 移動先レーンのリソース ID（未割り当てレーンは `null`）
 * @returns 割当変更のパッチ。変更が不要な場合は空オブジェクト
 * @example
 * ```ts
 * resourceLanePatch({ resourceIds: ['a', 'c'] }, 'a', 'b'); // => { resourceIds: ['b', 'c'] }
 * resourceLanePatch({ resourceId: 'a' }, 'a', null); // => { resourceId: undefined }（削除）
 * ```
 */
export function resourceLanePatch(
  event: ResourceAssignmentFields,
  sourceLaneId: string | null,
  targetLaneId: string | null,
): CalendarEventPatch {
  if (sourceLaneId === targetLaneId) {
    return {};
  }

  if (event.resourceIds === undefined) {
    // 単一割当: 従来どおり resourceId の差し替え。
    // 未割り当てへの移動は「キーが存在し値が undefined = フィールド削除」の
    // パッチセマンティクスに従う
    return { resourceId: targetLaneId ?? undefined };
  }

  const base = effectiveResourceIds(event);
  let next: string[];
  if (targetLaneId === null) {
    // 未割り当てへの移動: 移動元レーンの割当だけを取り除く
    next = base.filter((id) => id !== sourceLaneId);
  } else if (sourceLaneId === null || !base.includes(sourceLaneId)) {
    // 未割り当てレーンからの移動（または移動元が割当に見つからない防御的分岐）: 追加する
    next = base.includes(targetLaneId) ? [...base] : [...base, targetLaneId];
  } else {
    // 移動元レーンの ID を移動先へ置き換え、重複を先勝ちで除く（統合）
    next = [...new Set(base.map((id) => (id === sourceLaneId ? targetLaneId : id)))];
  }

  if (next.length === base.length && next.every((id, index) => id === base[index])) {
    return {};
  }
  return { resourceIds: next };
}
