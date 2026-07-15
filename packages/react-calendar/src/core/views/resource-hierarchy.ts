/**
 * @packageDocumentation
 * リソースの階層グルーピング（{@link CalendarResource.parentId} による親子ツリー）。
 *
 * タイムラインビュー（{@link ./timeline-view}）のみが利用する。リソースビューは
 * 常にフラット（並べ替えなし）のため、このモジュールを参照しない。
 *
 * ツリー構築は反復（スタック）で行う（極端に深いチェーンでの呼び出し深さの問題を避けるため）。
 */

import type { CalendarResource } from '../types';

/** {@link buildResourceTree} が返す 1 件分（深さ優先の行き掛け順）。 */
export interface ResourceTreeEntry {
  /** 対応するリソース。 */
  resource: CalendarResource;
  /** ツリー内の深さ（0 起点）。 */
  depth: number;
  /** 子リソースを持つか（実際にこのノードの子として配置された数のみで判定）。 */
  hasChildren: boolean;
}

/** {@link filterVisibleResourceTree} が返す 1 件分。 */
export interface VisibleResourceTreeEntry extends ResourceTreeEntry {
  /** 折りたたみ状態。`hasChildren` が `false` のときは常に `false`。 */
  collapsed: boolean;
}

/**
 * リソースの「実効的な親 ID」を解決する。
 * 次のいずれかに該当する場合は親を持たない（ルート）と判定する:
 * - `parentId` 省略
 * - 自己参照（`parentId === id`）
 * - 参照先のない ID（重複除去後の `resources` に存在しない）
 *
 * @param resource - 対象リソース
 * @param byId - ID 重複を先勝ちで除去済みのリソースマップ
 * @returns 実効的な親 ID。ルートの場合は `undefined`
 */
function resolvedParentIdOf(
  resource: CalendarResource,
  byId: ReadonlyMap<string, CalendarResource>,
): string | undefined {
  const { parentId } = resource;
  if (parentId === undefined || parentId === resource.id || !byId.has(parentId)) {
    return undefined;
  }
  return parentId;
}

/**
 * ID 重複を先勝ちで除いたうえで {@link CalendarResource.parentId} からツリー順
 * （深さ優先の行き掛け順）に並べる。
 *
 * 循環参照（自己参照を除く。2 ノード以上の相互参照）は、`resources` 配列内で
 * 先に出現するノードから強制的にルート化することで、対象リソースを一件も
 * 欠落させずに全て出力する。強制ルート化によって「子として配置されなかった」
 * ノードの `hasChildren` は `false` になる（循環を切られた側）。
 *
 * @param resources - リソース一覧（表示順）
 * @returns ツリー順に並んだエントリ一覧
 * @example
 * ```ts
 * const tree = buildResourceTree([
 *   { id: 'site', title: '本社' },
 *   { id: 'floor-1', title: '1F', parentId: 'site' },
 * ]);
 * tree.map((entry) => entry.depth); // => [0, 1]
 * ```
 */
export function buildResourceTree(
  resources: readonly CalendarResource[],
): readonly ResourceTreeEntry[] {
  // ID 重複を先勝ちで除去する（既存の resource-view / timeline-view と同じ規則）
  const unique: CalendarResource[] = [];
  const byId = new Map<string, CalendarResource>();
  for (const candidate of resources) {
    if (!byId.has(candidate.id)) {
      byId.set(candidate.id, candidate);
      unique.push(candidate);
    }
  }

  // 親 ID → 子 ID 一覧（resources 配列内の元の順序を保つ）
  const childrenOf = new Map<string, string[]>();
  for (const candidate of unique) {
    const parentId = resolvedParentIdOf(candidate, byId);
    if (parentId !== undefined) {
      const list = childrenOf.get(parentId);
      if (list !== undefined) {
        list.push(candidate.id);
      } else {
        childrenOf.set(parentId, [candidate.id]);
      }
    }
  }

  const visited = new Set<string>();
  const entries: ResourceTreeEntry[] = [];

  /**
   * `rootId` を根として、反復（スタック）による深さ優先の行き掛け順で辿り、
   * `entries` に積む。`rootId` 自身の `parentId` は無視する（呼び出し元が
   * 「ここをルートとして扱う」と決めた対象のため）。
   */
  function traverseFrom(rootId: string): void {
    const stack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined || visited.has(frame.id)) {
        continue;
      }
      visited.add(frame.id);
      const resource = byId.get(frame.id);
      if (resource === undefined) {
        continue;
      }
      // このノードの子として実際に配置される（まだ visited でない）ものだけを数える。
      // すでに visited な候補は、循環の強制ルート化により別の場所へ既に配置済みのため
      // このノードの子としては数えない（循環を切られた側の hasChildren を false にする）。
      const childIds = (childrenOf.get(frame.id) ?? []).filter((id) => !visited.has(id));
      entries.push({ resource, depth: frame.depth, hasChildren: childIds.length > 0 });
      // pop で元の順序になるよう、逆順に push する
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        const childId = childIds[index];
        if (childId !== undefined) {
          stack.push({ id: childId, depth: frame.depth + 1 });
        }
      }
    }
  }

  // フェーズ 1: 自然なルート（実効的な親を持たない）を配列順に処理する
  for (const candidate of unique) {
    if (!visited.has(candidate.id) && resolvedParentIdOf(candidate, byId) === undefined) {
      traverseFrom(candidate.id);
    }
  }
  // フェーズ 2: 残り（自然なルートに到達できない循環）を配列順に強制ルート化する
  for (const candidate of unique) {
    if (!visited.has(candidate.id)) {
      traverseFrom(candidate.id);
    }
  }

  return entries;
}

/**
 * {@link buildResourceTree} の結果から、`collapsedResourceIds` に含まれる祖先を持つ行を
 * 除いた、実際に描画すべき行の一覧を返す。
 *
 * `tree` は深さ優先の行き掛け順（{@link buildResourceTree} の出力）であることを前提にする。
 * 折りたたみ中のノードを見つけたら、それ以降「深さがそのノード以下に戻るまで」の
 * エントリをすべて読み飛ばす（子・孫・曾孫…がすべて隠れる。子自身の個別の折りたたみ状態は
 * 変更しない。祖先が再展開されたときに復元できるようにするため）。
 *
 * @param tree - {@link buildResourceTree} の出力
 * @param collapsedResourceIds - 折りたたみ中のリソース ID の集合
 * @returns 実際に描画すべき行の一覧（`collapsed` フラグ付き）
 */
export function filterVisibleResourceTree(
  tree: readonly ResourceTreeEntry[],
  collapsedResourceIds: ReadonlySet<string>,
): readonly VisibleResourceTreeEntry[] {
  const result: VisibleResourceTreeEntry[] = [];
  // 現在隠れている祖先（複数階層の入れ子に対応するためスタックで持つ）の深さ一覧
  const hiddenAncestorDepths: number[] = [];

  for (const entry of tree) {
    // 深さが「隠れている祖先」の深さ以下に戻ったら、そのスコープの隠れ状態を終える
    // （行き掛け順のため、これはそのサブツリーを抜けたことを意味する）
    while (
      hiddenAncestorDepths.length > 0 &&
      entry.depth <= (hiddenAncestorDepths[hiddenAncestorDepths.length - 1] ?? -1)
    ) {
      hiddenAncestorDepths.pop();
    }
    const hidden = hiddenAncestorDepths.length > 0;
    const collapsed = entry.hasChildren && collapsedResourceIds.has(entry.resource.id);
    if (!hidden) {
      result.push({ ...entry, collapsed });
    }
    if (collapsed) {
      hiddenAncestorDepths.push(entry.depth);
    }
  }

  return result;
}
