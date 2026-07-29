/**
 * virtualization.ts のテスト。
 *
 * 縦方向ウィンドウイングの純粋計算（{@link computeWindow} / {@link startForKey}）を
 * 検証する。DOM・タイムゾーンに依存しない数値のみのテスト。
 */
import { describe, expect, it } from 'vitest';
import {
  computeWindow,
  type SectionItemWindowInput,
  sameVisibleWindowRange,
  sectionItemWindow,
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

/**
 * {@link sectionItemWindow} 用の入力を組み立てるヘルパ。
 * 既定は「100 件・各 10px・見出し 20px・セクション先頭 0px・ビューポート 100px・overscan 0」。
 */
function makeSectionInput(overrides: Partial<SectionItemWindowInput> = {}): SectionItemWindowInput {
  return {
    itemCount: 100,
    sectionStart: 0,
    headerSize: 20,
    estimateItemSize: 10,
    scrollOffset: 0,
    viewportSize: 100,
    overscan: 0,
    ...overrides,
  };
}

describe('sectionItemWindow', () => {
  it('itemCount=0 のとき空の範囲（-1/-1）とゼロ詰め物を返す', () => {
    const result = sectionItemWindow(makeSectionInput({ itemCount: 0 }));
    expect(result).toEqual({ startIndex: -1, endIndex: -1, topPad: 0, bottomPad: 0 });
  });

  it('セクション先頭がビューポート先頭にあるとき、見出しの下に見えるアイテムだけを範囲にする', () => {
    // アイテム列は 20px（見出し）から始まる。可視 0〜100px → アイテム列ローカル -20〜80px
    // → index 0〜7（80px ちょうどに start を持つ index 8 は含まない）
    const result = sectionItemWindow(makeSectionInput());
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(7);
    expect(result.topPad).toBe(0);
    expect(result.bottomPad).toBe((100 - 8) * 10);
  });

  it('セクション途中へスクロールすると範囲が移動し、恒等式 topPad + 範囲件数×高さ + bottomPad = 全件×高さ を保つ', () => {
    // 可視 520〜620px → アイテム列ローカル 500〜600px → index 50〜59
    const result = sectionItemWindow(makeSectionInput({ scrollOffset: 520 }));
    expect(result.startIndex).toBe(50);
    expect(result.endIndex).toBe(59);
    expect(result.topPad).toBe(500);
    expect(result.bottomPad).toBe(400);
    const rendered = (result.endIndex - result.startIndex + 1) * 10;
    expect(result.topPad + rendered + result.bottomPad).toBe(100 * 10);
  });

  it('境界ちょうど: end == scrollOffset のアイテムは含まず、start == viewportEnd のアイテムも含まない', () => {
    // headerSize 0・est 10。可視 50〜80px → index 4（end=50）は含まず index 5 から、
    // index 8（start=80）は含まず index 7 まで（computeWindow と同じ排他規約）
    const result = sectionItemWindow(
      makeSectionInput({ headerSize: 0, scrollOffset: 50, viewportSize: 30 }),
    );
    expect(result.startIndex).toBe(5);
    expect(result.endIndex).toBe(7);
  });

  it('ビューポートがセクション全体を覆うときは全件が範囲になり詰め物は 0', () => {
    const result = sectionItemWindow(makeSectionInput({ viewportSize: 5000 }));
    expect(result).toEqual({ startIndex: 0, endIndex: 99, topPad: 0, bottomPad: 0 });
  });

  it('セクションが完全にビューポートより上（下方向へ通過済み）でも最低 1 件（末尾）を返す', () => {
    // セクションは 0〜1020px（見出し 20 + 100×10）。可視 2000〜2100px → 完全に範囲外
    const result = sectionItemWindow(makeSectionInput({ scrollOffset: 2000 }));
    expect(result.startIndex).toBe(99);
    expect(result.endIndex).toBe(99);
    expect(result.topPad).toBe(990);
    expect(result.bottomPad).toBe(0);
  });

  it('セクションが完全にビューポートより下（未到達）でも最低 1 件（先頭）を返す', () => {
    const result = sectionItemWindow(makeSectionInput({ sectionStart: 5000 }));
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
    expect(result.topPad).toBe(0);
    expect(result.bottomPad).toBe(990);
  });

  it('overscan が前後に指定件数を足し、端でクランプされる', () => {
    const middle = sectionItemWindow(makeSectionInput({ scrollOffset: 520, overscan: 5 }));
    expect(middle.startIndex).toBe(45);
    expect(middle.endIndex).toBe(64);
    expect(middle.topPad).toBe(450);
    expect(middle.bottomPad).toBe((100 - 65) * 10);

    const edge = sectionItemWindow(makeSectionInput({ overscan: 5 }));
    expect(edge.startIndex).toBe(0); // 先頭より前へは広がらない
    expect(edge.endIndex).toBe(12); // 可視末尾 7 + 5
  });

  it('overscan 省略時は既定（3 件）が前後に付く', () => {
    const result = sectionItemWindow(makeSectionInput({ scrollOffset: 520, overscan: undefined }));
    expect(result.startIndex).toBe(47);
    expect(result.endIndex).toBe(62);
  });

  it('overscan が負値でも可視範囲は欠落せず 0 として扱われる', () => {
    const result = sectionItemWindow(makeSectionInput({ scrollOffset: 520, overscan: -4 }));
    expect(result.startIndex).toBe(50);
    expect(result.endIndex).toBe(59);
  });

  it('headerSize の分だけアイテム列の開始位置が下へずれる', () => {
    // headerSize 100: 可視 50〜110px → アイテム列ローカル -50〜10px → index 0 のみ
    const withHeader = sectionItemWindow(
      makeSectionInput({ headerSize: 100, scrollOffset: 50, viewportSize: 60 }),
    );
    expect(withHeader.startIndex).toBe(0);
    expect(withHeader.endIndex).toBe(0);
    // headerSize 0: 可視 50〜110px → index 5〜10
    const withoutHeader = sectionItemWindow(
      makeSectionInput({ headerSize: 0, scrollOffset: 50, viewportSize: 60 }),
    );
    expect(withoutHeader.startIndex).toBe(5);
    expect(withoutHeader.endIndex).toBe(10);
  });

  it('estimateItemSize が 0・負値・NaN・Infinity のときは全件描画へ安全に縮退する', () => {
    for (const estimateItemSize of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = sectionItemWindow(makeSectionInput({ estimateItemSize }));
      expect(result).toEqual({ startIndex: 0, endIndex: 99, topPad: 0, bottomPad: 0 });
    }
  });

  it('viewportSize が 0 でもスクロール位置のアイテム 1 件以上を返す', () => {
    const result = sectionItemWindow(makeSectionInput({ scrollOffset: 520, viewportSize: 0 }));
    expect(result.endIndex).toBeGreaterThanOrEqual(result.startIndex);
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
    const rendered = (result.endIndex - result.startIndex + 1) * 10;
    expect(result.topPad + rendered + result.bottomPad).toBe(1000);
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
