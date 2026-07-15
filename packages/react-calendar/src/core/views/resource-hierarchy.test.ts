/**
 * resource-hierarchy.ts のテスト。
 */
import { describe, expect, it } from 'vitest';
import type { CalendarResource } from '../types';
import { buildResourceTree, filterVisibleResourceTree } from './resource-hierarchy';

/** テスト用のリソースを作る。 */
function resource(id: string, parentId?: string): CalendarResource {
  return { id, title: `リソース ${id}`, ...(parentId !== undefined ? { parentId } : {}) };
}

describe('buildResourceTree', () => {
  it('全員 parentId 省略なら元の配列順・全員 depth 0・hasChildren false になる（既存挙動と一致）', () => {
    const tree = buildResourceTree([resource('a'), resource('b'), resource('c')]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['a', 'b', 'c']);
    expect(tree.every((entry) => entry.depth === 0)).toBe(true);
    expect(tree.every((entry) => entry.hasChildren === false)).toBe(true);
  });

  it('2 段の階層で親の直後に子が続く行き掛け順になる', () => {
    const tree = buildResourceTree([resource('parent'), resource('child', 'parent')]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['parent', 'child']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1]);
    expect(tree[0]?.hasChildren).toBe(true);
    expect(tree[1]?.hasChildren).toBe(false);
  });

  it('3 段の階層で depth が段ごとに 1 増える', () => {
    const tree = buildResourceTree([
      resource('site'),
      resource('floor', 'site'),
      resource('room', 'floor'),
    ]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['site', 'floor', 'room']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1, 2]);
    expect(tree.map((entry) => entry.hasChildren)).toEqual([true, true, false]);
  });

  it('親の直後にその子の全部が続き、次の兄弟の前に子孫が終わる（行き掛け順）', () => {
    const tree = buildResourceTree([
      resource('p1'),
      resource('p1-c1', 'p1'),
      resource('p2'),
      resource('p2-c1', 'p2'),
    ]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['p1', 'p1-c1', 'p2', 'p2-c1']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1, 0, 1]);
  });

  it('親が複数の子を持つ場合、子同士の並びは resources 配列内の元の順序を保つ', () => {
    const tree = buildResourceTree([
      resource('parent'),
      resource('child-b', 'parent'),
      resource('child-a', 'parent'),
    ]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['parent', 'child-b', 'child-a']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1, 1]);
  });

  it('parentId が存在しない ID を指す場合、対象リソースは深さ 0 のルートになる', () => {
    const tree = buildResourceTree([resource('a', 'ghost')]);
    expect(tree.map((entry) => entry.depth)).toEqual([0]);
    expect(tree.map((entry) => entry.hasChildren)).toEqual([false]);
  });

  it('parentId が自分自身の ID（自己参照）の場合、深さ 0 のルートになり hasChildren は実際の子の有無で決まる', () => {
    const tree = buildResourceTree([resource('a', 'a'), resource('b', 'a')]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['a', 'b']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1]);
    expect(tree.map((entry) => entry.hasChildren)).toEqual([true, false]);
  });

  it('2 ノードの循環（相互参照）は、先に出現する側が強制的にルート化され、全リソースが欠落せず出力される', () => {
    const tree = buildResourceTree([resource('a', 'b'), resource('b', 'a')]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['a', 'b']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1]);
    // a が強制ルート化され、b は a の子として配置される。
    // b から見た a は既に配置済みのため、b の hasChildren は false になる
    // （循環を切られた側）。
    expect(tree.map((entry) => entry.hasChildren)).toEqual([true, false]);
  });

  it('3 ノード以上の循環でも全リソースが欠落せず出力される', () => {
    const tree = buildResourceTree([resource('a', 'c'), resource('b', 'a'), resource('c', 'b')]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['a', 'b', 'c']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1, 2]);
    expect(tree.map((entry) => entry.hasChildren)).toEqual([true, true, false]);
  });

  it('ID 重複は先勝ちで 1 件のみ扱われ、後続の重複への parentId 参照は先勝ちの 1 件に解決される', () => {
    const tree = buildResourceTree([
      resource('dup'),
      resource('dup', 'ghost-parent'), // 2 件目の 'dup' は無視される
      resource('child', 'dup'),
    ]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['dup', 'child']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 1]);
  });

  it('自然なルート（a・b）は先にすべて処理され、循環（c・d）はそのあとに配列順で強制ルート化される', () => {
    // c → d は互いに循環しているが、a・b はどちらとも無関係な自然なルート。
    // 自然なルートから辿れるかどうかは全ての自然なルートを辿り切るまで確定しない
    // ため、循環メンバーは常に自然なルート一巡のあとに処理される
    // （＝配列内の見た目の位置に関わらず、自然なルート → 循環 の順になる）
    const tree = buildResourceTree([
      resource('a'),
      resource('c', 'd'),
      resource('d', 'c'),
      resource('b'),
    ]);
    expect(tree.map((entry) => entry.resource.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(tree.map((entry) => entry.depth)).toEqual([0, 0, 0, 1]);
  });
});

describe('filterVisibleResourceTree', () => {
  it('collapsedResourceIds が空なら buildResourceTree の全件をそのまま返し、collapsed は全件 false になる', () => {
    const tree = buildResourceTree([resource('parent'), resource('child', 'parent')]);
    const visible = filterVisibleResourceTree(tree, new Set());
    expect(visible.map((entry) => entry.resource.id)).toEqual(['parent', 'child']);
    expect(visible.every((entry) => entry.collapsed === false)).toBe(true);
  });

  it('親を折りたたむと、その子孫行のみ除外され、兄弟・親自身は残る', () => {
    const tree = buildResourceTree([
      resource('p1'),
      resource('p1-c1', 'p1'),
      resource('p2'),
      resource('p2-c1', 'p2'),
    ]);
    const visible = filterVisibleResourceTree(tree, new Set(['p1']));
    expect(visible.map((entry) => entry.resource.id)).toEqual(['p1', 'p2', 'p2-c1']);
    expect(visible.find((entry) => entry.resource.id === 'p1')?.collapsed).toBe(true);
  });

  it('祖父母を折りたたむと、親・子の 2 段下まで一括で非表示になる', () => {
    const tree = buildResourceTree([
      resource('grandparent'),
      resource('parent', 'grandparent'),
      resource('child', 'parent'),
    ]);
    const visible = filterVisibleResourceTree(tree, new Set(['grandparent']));
    expect(visible.map((entry) => entry.resource.id)).toEqual(['grandparent']);
  });

  it('祖父母を折りたたむと、孫の折りたたみ状態に関わらず孫も隠れる', () => {
    const tree = buildResourceTree([
      resource('grandparent'),
      resource('parent', 'grandparent'),
      resource('child', 'parent'),
    ]);
    // child 自身も個別に折りたたみ指定しているが、child には子がいないため無関係。
    // ここでは親と祖父母の両方を折りたたむケースで孫（今回は child が末端）が隠れることを検証する
    const visible = filterVisibleResourceTree(tree, new Set(['grandparent', 'parent']));
    expect(visible.map((entry) => entry.resource.id)).toEqual(['grandparent']);
  });

  it('折りたたんだ祖父母を再展開すると、以前に個別に折りたたんでいた子の行は非表示のまま復元される', () => {
    const tree = buildResourceTree([
      resource('grandparent'),
      resource('parent', 'grandparent'),
      resource('child', 'parent'),
    ]);
    // grandparent は展開済み（collapsedResourceIds に含めない）だが、
    // parent は個別に折りたたみ済みのまま
    const visible = filterVisibleResourceTree(tree, new Set(['parent']));
    expect(visible.map((entry) => entry.resource.id)).toEqual(['grandparent', 'parent']);
    expect(visible.find((entry) => entry.resource.id === 'parent')?.collapsed).toBe(true);
  });

  it('hasChildren が false の行は collapsedResourceIds に含まれていても collapsed は常に false', () => {
    const tree = buildResourceTree([resource('leaf')]);
    const visible = filterVisibleResourceTree(tree, new Set(['leaf']));
    expect(visible[0]?.collapsed).toBe(false);
  });

  it('複数の兄弟が同時に折りたたまれても、互いに影響せず正しく非表示になる', () => {
    const tree = buildResourceTree([
      resource('p1'),
      resource('p1-c1', 'p1'),
      resource('p2'),
      resource('p2-c1', 'p2'),
      resource('p3'),
    ]);
    const visible = filterVisibleResourceTree(tree, new Set(['p1', 'p2']));
    expect(visible.map((entry) => entry.resource.id)).toEqual(['p1', 'p2', 'p3']);
  });
});
