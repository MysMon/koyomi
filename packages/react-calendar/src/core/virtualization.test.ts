/**
 * virtualization.ts のテスト。
 *
 * 縦方向ウィンドウイングの純粋計算（{@link computeWindow} / {@link startForKey}）を
 * 検証する。DOM・タイムゾーンに依存しない数値のみのテスト。
 */
import { describe, expect, it } from 'vitest';
import {
  computeWindow,
  sameVisibleWindowRange,
  startForKey,
  type VisibleWindowRange,
  visibleWindowRange,
  type WindowInput,
} from './virtualization';

/**
 * テスト用の入力を組み立てるヘルパ。
 * 既定は「全 10 件・各 20px・実測なし」。必要な項目だけ上書きする。
 */
function makeInput(overrides: Partial<WindowInput> = {}): WindowInput {
  return {
    count: 10,
    getKey: (index) => `k${index}`,
    estimateSize: () => 20,
    measured: new Map(),
    scrollOffset: 0,
    viewportSize: 100,
    ...overrides,
  };
}

describe('computeWindow', () => {
  it('count=0 のとき空の結果を返す', () => {
    const result = computeWindow(makeInput({ count: 0 }));
    expect(result.items).toEqual([]);
    expect(result.pinnedItems).toEqual([]);
    expect(result.beforeSize).toBe(0);
    expect(result.afterSize).toBe(0);
    expect(result.totalSize).toBe(0);
    expect(result.startIndex).toBe(-1);
    expect(result.endIndex).toBe(-1);
  });

  it('等高: 総高はアイテム数×高さ', () => {
    const result = computeWindow(makeInput({ overscan: 0 }));
    expect(result.totalSize).toBe(200); // 10 × 20
  });

  it('等高・overscan=0: 先頭で可視範囲だけを返す（100px 窓 = 5 件）', () => {
    const result = computeWindow(makeInput({ overscan: 0, scrollOffset: 0, viewportSize: 100 }));
    // 0..99px に start を持つ／またがるのは index 0〜4（0,20,40,60,80）
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(4);
    expect(result.items.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.beforeSize).toBe(0);
    expect(result.afterSize).toBe(100); // 残り 5 件 × 20
  });

  it('overscan が前後に指定件数を足す（端でクランプ）', () => {
    const result = computeWindow(makeInput({ overscan: 2, scrollOffset: 100, viewportSize: 40 }));
    // 可視: 100〜139px → index 5,6。overscan 2 で 3..8。
    expect(result.startIndex).toBe(5);
    expect(result.endIndex).toBe(6);
    expect(result.items.map((item) => item.index)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(result.beforeSize).toBe(60); // index 0..2 = 3×20
    expect(result.afterSize).toBe(20); // index 9 = 1×20
  });

  it('恒等式: beforeSize + Σsize(items) + afterSize == totalSize', () => {
    const result = computeWindow(makeInput({ overscan: 1, scrollOffset: 70, viewportSize: 55 }));
    const windowSum = result.items.reduce((sum, item) => sum + item.size, 0);
    expect(result.beforeSize + windowSum + result.afterSize).toBe(result.totalSize);
  });

  it('可変高: measured（key 基準）が estimate より優先される', () => {
    const measured = new Map<string, number>([
      ['k0', 50],
      ['k1', 50],
    ]);
    const result = computeWindow(
      makeInput({ measured, overscan: 0, scrollOffset: 0, viewportSize: 100 }),
    );
    // k0=50, k1=50 で 100px を埋める → index 0,1 が可視
    expect(result.items.map((item) => item.index)).toEqual([0, 1]);
    expect(result.items[0]?.measured).toBe(true);
    expect(result.items[1]?.measured).toBe(true);
    // 総高: 50+50 + 8×20 = 260
    expect(result.totalSize).toBe(260);
  });

  it('start は measured/estimate の累積で単調増加する', () => {
    const measured = new Map<string, number>([['k2', 100]]);
    const result = computeWindow(makeInput({ measured, overscan: 10, viewportSize: 1000 }));
    for (let i = 1; i < result.items.length; i += 1) {
      const prev = result.items[i - 1];
      const curr = result.items[i];
      expect(prev !== undefined && curr !== undefined).toBe(true);
      if (prev !== undefined && curr !== undefined) {
        expect(curr.start).toBe(prev.start + prev.size);
      }
    }
  });

  it('末尾より先へスクロールしても最低 1 件を返し恒等式を保つ', () => {
    const result = computeWindow(makeInput({ overscan: 0, scrollOffset: 500, viewportSize: 100 }));
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const windowSum = result.items.reduce((sum, item) => sum + item.size, 0);
    expect(result.beforeSize + windowSum + result.afterSize).toBe(result.totalSize);
  });

  it('pinnedKeys のうち窓外のものだけを pinnedItems に入れ、items と素になる', () => {
    const result = computeWindow(
      makeInput({
        overscan: 0,
        scrollOffset: 0,
        viewportSize: 40, // 可視 index 0,1
        pinnedKeys: new Set(['k1', 'k9']), // k1 は窓内、k9 は窓外
      }),
    );
    const itemIndices = result.items.map((item) => item.index);
    const pinnedIndices = result.pinnedItems.map((item) => item.index);
    expect(pinnedIndices).toEqual([9]); // 窓内の k1 は除外され、窓外の k9 のみ
    // items と pinnedItems は key で互いに素
    const itemKeys = new Set(result.items.map((item) => item.key));
    for (const pinned of result.pinnedItems) {
      expect(itemKeys.has(pinned.key)).toBe(false);
    }
    expect(itemIndices).toContain(1);
  });

  it('推定高が Infinity / NaN のときは 0 に丸め、totalSize / spacer に伝播させない', () => {
    const infinite = computeWindow(
      makeInput({ estimateSize: () => Number.POSITIVE_INFINITY, overscan: 0 }),
    );
    expect(Number.isFinite(infinite.totalSize)).toBe(true);
    expect(Number.isFinite(infinite.beforeSize)).toBe(true);
    expect(Number.isFinite(infinite.afterSize)).toBe(true);
    expect(infinite.totalSize).toBe(0); // 全件 0 高扱い

    const nan = computeWindow(makeInput({ estimateSize: () => Number.NaN }));
    expect(Number.isNaN(nan.afterSize)).toBe(false);
    expect(Number.isNaN(nan.totalSize)).toBe(false);
  });

  it('overscan が負値でも可視範囲は欠落せず 0 として扱われる', () => {
    const result = computeWindow(makeInput({ overscan: -1, scrollOffset: 0, viewportSize: 100 }));
    // 可視 0..4 は必ず含まれる（負の overscan で内側に削られない）
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(4);
    expect(result.items.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('pinnedItems の start は全体座標系での正しいオフセット', () => {
    const result = computeWindow(
      makeInput({ overscan: 0, viewportSize: 20, pinnedKeys: new Set(['k9']) }),
    );
    expect(result.pinnedItems[0]?.start).toBe(180); // index 9 = 9×20
  });
});

describe('startForKey', () => {
  it('measured/estimate 混在でも指定 key の start を返す', () => {
    const measured = new Map<string, number>([['k0', 30]]);
    const input = {
      count: 5,
      getKey: (index: number) => `k${index}`,
      estimateSize: () => 20,
      measured,
    };
    expect(startForKey(input, 'k0')).toBe(0);
    expect(startForKey(input, 'k1')).toBe(30); // k0=30
    expect(startForKey(input, 'k2')).toBe(50); // 30+20
  });

  it('存在しない key には null を返す', () => {
    const input = {
      count: 3,
      getKey: (index: number) => `k${index}`,
      estimateSize: () => 20,
      measured: new Map<string, number>(),
    };
    expect(startForKey(input, 'missing')).toBeNull();
  });
});

describe('visibleWindowRange', () => {
  it('computeWindow の可視範囲（overscan を除く）からキー付きの範囲を組み立てる', () => {
    const result = computeWindow(makeInput({ overscan: 3, scrollOffset: 100, viewportSize: 40 }));
    // 可視: 100〜139px → index 5,6（overscan は含めない）
    const range = visibleWindowRange(result, (index) => `k${index}`);
    expect(range).toEqual({
      startIndex: 5,
      endIndex: 6,
      startKey: 'k5',
      endKey: 'k6',
    } satisfies VisibleWindowRange);
  });

  it('count=0（startIndex/endIndex が -1）のときはキーを null にする', () => {
    const result = computeWindow(makeInput({ count: 0 }));
    const range = visibleWindowRange(result, (index) => `k${index}`);
    expect(range).toEqual({
      startIndex: -1,
      endIndex: -1,
      startKey: null,
      endKey: null,
    } satisfies VisibleWindowRange);
  });
});

describe('sameVisibleWindowRange', () => {
  const base: VisibleWindowRange = { startIndex: 2, endIndex: 5, startKey: 'k2', endKey: 'k5' };

  it('インデックス・キーがすべて等しいときのみ true を返す', () => {
    expect(sameVisibleWindowRange(base, { ...base })).toBe(true);
    expect(sameVisibleWindowRange(base, { ...base, endIndex: 6 })).toBe(false);
    expect(sameVisibleWindowRange(base, { ...base, startIndex: 3 })).toBe(false);
    // インデックスが同じでもキーが変われば別内容（表示範囲の移動・並びの変更を検出する）
    expect(sameVisibleWindowRange(base, { ...base, startKey: 'k9' })).toBe(false);
    expect(sameVisibleWindowRange(base, { ...base, endKey: 'k9' })).toBe(false);
  });

  it('null は「まだ範囲を記録していない」を表し、非 null とは常に不一致になる', () => {
    expect(sameVisibleWindowRange(null, base)).toBe(false);
    expect(sameVisibleWindowRange(base, null)).toBe(false);
    expect(sameVisibleWindowRange(null, null)).toBe(true);
  });
});
