import { describe, expect, it } from 'vitest';
import type { BandItemInput } from './band-layout';
import { layoutBandItems } from './band-layout';

/**
 * テスト用の入力アイテムを生成するヘルパー。
 * すべてのフィールドを明示的に指定して決定性を保つ。
 */
function band(
  key: string,
  startCol: number,
  span: number,
  sortStart: number,
  sortDuration: number,
): BandItemInput {
  return { key, startCol, span, sortStart, sortDuration };
}

/** placements から key → 配置 を引くヘルパー。 */
function byKey(result: ReturnType<typeof layoutBandItems>, key: string) {
  const placement = result.placements.find((p) => p.key === key);
  if (placement === undefined) {
    throw new Error(`key=${key} の配置が見つかりません`);
  }
  return placement;
}

describe('layoutBandItems', () => {
  describe('基本のレーン割当', () => {
    it('重ならない 2 件は同一レーン 0 に入る（列区間の end は排他的）', () => {
      // [0,2) と [2,4) は境界で接するだけで重ならない
      const result = layoutBandItems([band('a', 0, 2, 0, 2), band('b', 2, 2, 2, 2)], 7);
      expect(byKey(result, 'a').lane).toBe(0);
      expect(byKey(result, 'b').lane).toBe(0);
      expect(result.laneCount).toBe(1);
      expect(result.overflowByCol).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('互いに重なる 3 件はレーン 0/1/2 に積まれる', () => {
      const result = layoutBandItems(
        [band('a', 0, 3, 0, 3), band('b', 1, 3, 1, 3), band('c', 2, 3, 2, 3)],
        7,
      );
      expect(byKey(result, 'a').lane).toBe(0);
      expect(byKey(result, 'b').lane).toBe(1);
      expect(byKey(result, 'c').lane).toBe(2);
      expect(result.laneCount).toBe(3);
    });

    it('長い帯が先にレーン 0 を取り、後続の短い帯は空いた隙間レーンを再利用する', () => {
      const result = layoutBandItems(
        [
          // 週全体を覆う長い帯 → レーン 0
          band('long', 0, 7, 0, 7),
          // 週前半の短い帯 → レーン 1
          band('early', 0, 2, 0, 2),
          // 週後半の短い帯 → レーン 0 は long と重なるが、レーン 1 の
          // [0,2) とは重ならないためレーン 1 を再利用できる
          band('late', 3, 2, 3, 2),
        ],
        7,
      );
      expect(byKey(result, 'long').lane).toBe(0);
      expect(byKey(result, 'early').lane).toBe(1);
      expect(byKey(result, 'late').lane).toBe(1);
      expect(result.laneCount).toBe(2);
    });

    it('placements の順序は入力順を維持する（ソート順ではない）', () => {
      // ソート順は b → a → c だが、結果は入力順 c → a → b のまま
      const result = layoutBandItems(
        [band('c', 2, 1, 2, 1), band('a', 0, 1, 0, 1), band('b', 1, 1, 1, 1)],
        7,
      );
      expect(result.placements.map((p) => p.key)).toEqual(['c', 'a', 'b']);
    });
  });

  describe('ソート優先度', () => {
    it('sortStart 昇順: 早く始まるアイテムが上のレーンに入る', () => {
      // 入力順は逆でも、sortStart が小さい方がレーン 0
      const result = layoutBandItems(
        [band('later', 0, 3, 100, 3), band('earlier', 0, 3, 50, 3)],
        7,
      );
      expect(byKey(result, 'earlier').lane).toBe(0);
      expect(byKey(result, 'later').lane).toBe(1);
    });

    it('sortStart が同じなら sortDuration 降順: 長いアイテムが上のレーンに入る', () => {
      const result = layoutBandItems([band('short', 0, 1, 0, 30), band('long', 0, 3, 0, 180)], 7);
      expect(byKey(result, 'long').lane).toBe(0);
      expect(byKey(result, 'short').lane).toBe(1);
    });

    it('sortStart と sortDuration が同じなら key の辞書順で決まる', () => {
      const result = layoutBandItems([band('b', 0, 2, 0, 60), band('a', 0, 2, 0, 60)], 7);
      expect(byKey(result, 'a').lane).toBe(0);
      expect(byKey(result, 'b').lane).toBe(1);
    });
  });

  describe('あふれ（maxLanes）', () => {
    it('maxLanes=2 で 3 件重なると 3 件目が hidden になり overflowByCol に計上される', () => {
      const result = layoutBandItems(
        [band('a', 1, 2, 0, 2), band('b', 1, 2, 1, 2), band('c', 1, 2, 2, 2)],
        7,
        2,
      );
      expect(byKey(result, 'a')).toEqual({ key: 'a', lane: 0, hidden: false });
      expect(byKey(result, 'b')).toEqual({ key: 'b', lane: 1, hidden: false });
      expect(byKey(result, 'c')).toEqual({ key: 'c', lane: 2, hidden: true });
      // hidden の c は列 1, 2 を覆う
      expect(result.overflowByCol).toEqual([0, 1, 1, 0, 0, 0, 0]);
      // laneCount は表示レーンのみ（hidden の乗るレーン 2 は数えない）
      expect(result.laneCount).toBe(2);
    });

    it('複数列に跨る hidden が複数あるとき overflowByCol は列ごとに合算される', () => {
      const result = layoutBandItems(
        [
          band('a', 0, 3, 0, 3), // レーン 0（表示）
          band('b', 1, 3, 1, 3), // レーン 1（表示）
          band('c', 2, 3, 2, 3), // レーン 2 → hidden、列 2..4 を覆う
          band('d', 2, 1, 2, 1), // レーン 3 → hidden、列 2 を覆う
        ],
        7,
        2,
      );
      expect(byKey(result, 'c')).toEqual({ key: 'c', lane: 2, hidden: true });
      expect(byKey(result, 'd')).toEqual({ key: 'd', lane: 3, hidden: true });
      expect(result.overflowByCol).toEqual([0, 0, 2, 1, 1, 0, 0]);
      expect(result.laneCount).toBe(2);
    });

    it('maxLanes 未指定なら何件重なっても hidden は発生しない', () => {
      const items = [
        band('a', 0, 3, 0, 3),
        band('b', 0, 3, 1, 3),
        band('c', 0, 3, 2, 3),
        band('d', 0, 3, 3, 3),
        band('e', 0, 3, 4, 3),
      ];
      const result = layoutBandItems(items, 7);
      expect(result.placements.every((p) => !p.hidden)).toBe(true);
      expect(result.laneCount).toBe(5);
      expect(result.overflowByCol).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('使用レーンが maxLanes より少なければ laneCount は実際の使用数になる', () => {
      const result = layoutBandItems([band('a', 0, 2, 0, 2), band('b', 0, 2, 1, 2)], 7, 5);
      expect(result.laneCount).toBe(2);
      expect(result.placements.every((p) => !p.hidden)).toBe(true);
    });

    it('maxLanes=1 で hidden だけが乗るレーンは laneCount に数えない', () => {
      const result = layoutBandItems([band('a', 0, 2, 0, 2), band('b', 0, 2, 1, 2)], 7, 1);
      expect(byKey(result, 'a')).toEqual({ key: 'a', lane: 0, hidden: false });
      expect(byKey(result, 'b')).toEqual({ key: 'b', lane: 1, hidden: true });
      expect(result.laneCount).toBe(1);
      expect(result.overflowByCol).toEqual([1, 1, 0, 0, 0, 0, 0]);
    });

    it('maxLanes=0 では全件 hidden になり laneCount は 0 になる', () => {
      const result = layoutBandItems([band('a', 0, 2, 0, 2)], 7, 0);
      expect(byKey(result, 'a')).toEqual({ key: 'a', lane: 0, hidden: true });
      expect(result.laneCount).toBe(0);
      expect(result.overflowByCol).toEqual([1, 1, 0, 0, 0, 0, 0]);
    });
  });

  describe('境界値・不正入力', () => {
    it('空入力では placements 空・laneCount 0・overflowByCol は長さ columnCount の全 0 になる', () => {
      const result = layoutBandItems([], 7);
      expect(result.placements).toEqual([]);
      expect(result.laneCount).toBe(0);
      expect(result.overflowByCol).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('columnCount=0 かつ空入力では overflowByCol は空配列になる', () => {
      const result = layoutBandItems([], 0);
      expect(result.placements).toEqual([]);
      expect(result.laneCount).toBe(0);
      expect(result.overflowByCol).toEqual([]);
    });

    it('startCol + span === columnCount の帯（最終列まで専有）を正しく扱う', () => {
      const result = layoutBandItems([band('a', 5, 2, 5, 2), band('b', 5, 2, 6, 2)], 7, 1);
      expect(byKey(result, 'a')).toEqual({ key: 'a', lane: 0, hidden: false });
      expect(byKey(result, 'b')).toEqual({ key: 'b', lane: 1, hidden: true });
      // hidden の b は最終列（インデックス 6）まで計上される
      expect(result.overflowByCol).toEqual([0, 0, 0, 0, 0, 1, 1]);
    });
  });

  describe('大列数（数百列）', () => {
    it('500 列で互い違いに重なる帯（[i, i+2)）が 2 レーンに交互に割り当てられる', () => {
      // 隣同士（[i, i+2) と [i+1, i+3)）は重なるため、貪欲割当でレーンは 0/1 の交互になる
      const items = Array.from({ length: 499 }, (_, i) =>
        band(`item-${String(i).padStart(3, '0')}`, i, 2, i, 2),
      );
      const result = layoutBandItems(items, 500);
      for (const [i, item] of items.entries()) {
        expect(byKey(result, item.key).lane).toBe(i % 2);
      }
      expect(result.laneCount).toBe(2);
      expect(result.overflowByCol).toHaveLength(500);
    });

    it('300 列を覆う長い帯の下で、離れた短い帯が同一レーンを再利用する', () => {
      const result = layoutBandItems(
        [
          band('long', 0, 300, 0, 300),
          band('a', 0, 100, 0, 100),
          band('b', 100, 100, 100, 100),
          band('c', 250, 50, 250, 50),
        ],
        300,
      );
      expect(byKey(result, 'long').lane).toBe(0);
      // a / b / c は互いに重ならない（[0,100) / [100,200) / [250,300)）ためレーン 1 を共有する
      expect(byKey(result, 'a').lane).toBe(1);
      expect(byKey(result, 'b').lane).toBe(1);
      expect(byKey(result, 'c').lane).toBe(1);
      expect(result.laneCount).toBe(2);
    });

    it('400 列で hidden の帯が覆っている列にのみ overflowByCol が計上される', () => {
      const result = layoutBandItems(
        [band('base', 0, 400, 0, 400), band('over', 250, 100, 1, 100)],
        400,
        1,
      );
      expect(byKey(result, 'base')).toEqual({ key: 'base', lane: 0, hidden: false });
      expect(byKey(result, 'over')).toEqual({ key: 'over', lane: 1, hidden: true });
      const expected = Array.from({ length: 400 }, (_, col) => (col >= 250 && col < 350 ? 1 : 0));
      expect(result.overflowByCol).toEqual(expected);
      expect(result.laneCount).toBe(1);
    });

    it('数百件の帯でも同一レーン内の帯は互いに重ならない（レーン割当の不変条件）', () => {
      // 決定的な擬似乱数（LCG）で startCol / span を生成する。
      // sortStart は startCol と同じ値にして、ソート順と列の並びが
      // 一致するという入力の前提（ビュー側の呼び出しと同じ形）を保つ
      let seed = 123456789;
      const nextRandom = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const columnCount = 365;
      const items = Array.from({ length: 400 }, (_, i) => {
        const startCol = Math.floor(nextRandom() * (columnCount - 10));
        const span = 1 + Math.floor(nextRandom() * 10);
        return band(`item-${String(i).padStart(3, '0')}`, startCol, span, startCol, span);
      });
      const result = layoutBandItems(items, columnCount);

      // レーンごとに列区間を集め、同一レーン内で [start, end) が重ならないことを確認する
      const lanes = new Map<number, { start: number; end: number }[]>();
      for (const [i, placement] of result.placements.entries()) {
        const item = items[i];
        if (item === undefined) {
          throw new Error('placements は入力と同数のはず');
        }
        const intervals = lanes.get(placement.lane) ?? [];
        intervals.push({ start: item.startCol, end: item.startCol + item.span });
        lanes.set(placement.lane, intervals);
      }
      for (const intervals of lanes.values()) {
        intervals.sort((a, b) => a.start - b.start);
        for (let i = 1; i < intervals.length; i += 1) {
          const prev = intervals[i - 1];
          const current = intervals[i];
          if (prev === undefined || current === undefined) {
            throw new Error('unreachable');
          }
          expect(current.start).toBeGreaterThanOrEqual(prev.end);
        }
      }
    });
  });

  describe('TSDoc の @example', () => {
    it('@example のとおりの結果を返す', () => {
      const result = layoutBandItems(
        [
          { key: 'a', startCol: 0, span: 3, sortStart: 0, sortDuration: 3 },
          { key: 'b', startCol: 1, span: 2, sortStart: 1, sortDuration: 2 },
          { key: 'c', startCol: 1, span: 1, sortStart: 1, sortDuration: 1 },
        ],
        7,
        2,
      );
      expect(result.placements).toEqual([
        { key: 'a', lane: 0, hidden: false },
        { key: 'b', lane: 1, hidden: false },
        { key: 'c', lane: 2, hidden: true },
      ]);
      expect(result.laneCount).toBe(2);
      expect(result.overflowByCol).toEqual([0, 1, 0, 0, 0, 0, 0]);
    });
  });
});
