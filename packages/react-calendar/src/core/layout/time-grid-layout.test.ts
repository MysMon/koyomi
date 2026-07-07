import { describe, expect, it } from 'vitest';
import {
  layoutTimeGridItems,
  type TimeGridItemInput,
  type TimeGridItemPlacement,
} from './time-grid-layout';

/** 時刻を「0:00 からの分」に変換するテスト用ヘルパー。 */
const t = (hours: number, minutes = 0): number => hours * 60 + minutes;

/** 入力アイテムを簡潔に作るテスト用ヘルパー。 */
const item = (key: string, startMinutes: number, endMinutes: number): TimeGridItemInput => ({
  key,
  startMinutes,
  endMinutes,
});

/** キーで配置結果を引くテスト用ヘルパー（見つからなければ失敗させる）。 */
const placementOf = (
  placements: readonly TimeGridItemPlacement[],
  key: string,
): TimeGridItemPlacement => {
  const found = placements.find((p) => p.key === key);
  if (found === undefined) {
    throw new Error(`配置が見つかりません: ${key}`);
  }
  return found;
};

describe('layoutTimeGridItems', () => {
  describe('空入力・単一入力', () => {
    it('空配列を渡すと空配列を返す', () => {
      expect(layoutTimeGridItems([])).toEqual([]);
    });

    it('1 件のみの場合は全幅（left=0, width=1）になる', () => {
      const result = layoutTimeGridItems([item('a', t(10), t(11))]);
      expect(result).toHaveLength(1);
      const a = placementOf(result, 'a');
      expect(a.left).toBeCloseTo(0);
      expect(a.width).toBeCloseTo(1);
    });
  });

  describe('重ならないイベント', () => {
    it('時間が離れた 2 件はどちらも left=0, width=1 になる', () => {
      const result = layoutTimeGridItems([item('a', t(10), t(11)), item('b', t(12), t(13))]);
      expect(result).toHaveLength(2);
      for (const key of ['a', 'b']) {
        const p = placementOf(result, key);
        expect(p.left).toBeCloseTo(0);
        expect(p.width).toBeCloseTo(1);
      }
    });

    it('[start, end) の排他比較により 10:00-11:00 と 11:00-12:00 は重ならない', () => {
      const result = layoutTimeGridItems([item('a', t(10), t(11)), item('b', t(11), t(12))]);
      for (const key of ['a', 'b']) {
        const p = placementOf(result, key);
        expect(p.left).toBeCloseTo(0);
        expect(p.width).toBeCloseTo(1);
      }
    });
  });

  describe('2 件の重なり', () => {
    it('重なる 2 件は幅 1/2 で横並びになり、開始が早い方が左に来る', () => {
      const result = layoutTimeGridItems([
        item('a', t(10), t(11)),
        item('b', t(10, 30), t(11, 30)),
      ]);
      const a = placementOf(result, 'a');
      const b = placementOf(result, 'b');
      expect(a.left).toBeCloseTo(0);
      expect(a.width).toBeCloseTo(1 / 2);
      expect(b.left).toBeCloseTo(1 / 2);
      expect(b.width).toBeCloseTo(1 / 2);
    });

    it('開始が同じ場合は長い方が左に来る', () => {
      const result = layoutTimeGridItems([item('short', t(10), t(11)), item('long', t(10), t(12))]);
      expect(placementOf(result, 'long').left).toBeCloseTo(0);
      expect(placementOf(result, 'short').left).toBeCloseTo(1 / 2);
    });

    it('開始も長さも同じ場合は key の辞書順で左から並ぶ', () => {
      const result = layoutTimeGridItems([item('b', t(10), t(11)), item('a', t(10), t(11))]);
      expect(placementOf(result, 'a').left).toBeCloseTo(0);
      expect(placementOf(result, 'b').left).toBeCloseTo(1 / 2);
    });
  });

  describe('推移的クラスタ', () => {
    it('A∩B, B∩C, A∦C のとき 3 件とも同一クラスタとなり、A と C は同じ列を再利用する', () => {
      // A: 10:00-11:00, B: 10:30-11:30, C: 11:00-12:00
      // A と C は重ならない（end 排他）が、B を介して同一クラスタになる。
      const result = layoutTimeGridItems([
        item('a', t(10), t(11)),
        item('b', t(10, 30), t(11, 30)),
        item('c', t(11), t(12)),
      ]);
      const a = placementOf(result, 'a');
      const b = placementOf(result, 'b');
      const c = placementOf(result, 'c');
      // クラスタの列数は 2 なので全員幅 1/2（C は右隣の B と衝突するため拡張されない）
      expect(a.left).toBeCloseTo(0);
      expect(a.width).toBeCloseTo(1 / 2);
      expect(b.left).toBeCloseTo(1 / 2);
      expect(b.width).toBeCloseTo(1 / 2);
      // C は A の列（列 0）を再利用する
      expect(c.left).toBeCloseTo(0);
      expect(c.width).toBeCloseTo(1 / 2);
    });

    it('列を再利用したイベントは右隣に衝突がなければ幅拡張で広がる', () => {
      // A: 10:00-13:00（列 0）、B: 10:00-11:00（列 1）、D: 10:00-11:00（列 2）
      // C: 11:30-12:30 → A と衝突するが B とは衝突しないため B の列（列 1）を再利用し、
      // さらに右隣の列 2（D は 11:00 終了で衝突しない）を越えて右端まで広がる。
      const result = layoutTimeGridItems([
        item('a', t(10), t(13)),
        item('b', t(10), t(11)),
        item('d', t(10), t(11)),
        item('c', t(11, 30), t(12, 30)),
      ]);
      const a = placementOf(result, 'a');
      const b = placementOf(result, 'b');
      const d = placementOf(result, 'd');
      const c = placementOf(result, 'c');
      // クラスタの列数は 3
      expect(a.left).toBeCloseTo(0);
      expect(a.width).toBeCloseTo(1 / 3);
      expect(b.left).toBeCloseTo(1 / 3);
      expect(b.width).toBeCloseTo(1 / 3);
      expect(d.left).toBeCloseTo(2 / 3);
      expect(d.width).toBeCloseTo(1 / 3);
      // C は列 1 を再利用し、幅拡張で 2/3 に広がる
      expect(c.left).toBeCloseTo(1 / 3);
      expect(c.width).toBeCloseTo(2 / 3);
    });
  });

  describe('幅拡張', () => {
    it('右方向の拡張は次に衝突する列の手前で止まる', () => {
      // 列 0: l (9:00-14:00), 列 1: b1 (9:00-11:00), 列 2: b2 (9:00-10:00),
      // 列 3: q (9:30-14:00)
      // x (11:00-12:00) は列 1 に入り、列 2 の b2 とは衝突しないが
      // 列 3 の q と衝突するため、列 2 まで（幅 2/4）拡張される。
      const result = layoutTimeGridItems([
        item('l', t(9), t(14)),
        item('b1', t(9), t(11)),
        item('b2', t(9), t(10)),
        item('q', t(9, 30), t(14)),
        item('x', t(11), t(12)),
      ]);
      expect(placementOf(result, 'l').left).toBeCloseTo(0);
      expect(placementOf(result, 'l').width).toBeCloseTo(1 / 4);
      expect(placementOf(result, 'b1').left).toBeCloseTo(1 / 4);
      expect(placementOf(result, 'b1').width).toBeCloseTo(1 / 4);
      expect(placementOf(result, 'b2').left).toBeCloseTo(2 / 4);
      expect(placementOf(result, 'b2').width).toBeCloseTo(1 / 4);
      expect(placementOf(result, 'q').left).toBeCloseTo(3 / 4);
      expect(placementOf(result, 'q').width).toBeCloseTo(1 / 4);
      const x = placementOf(result, 'x');
      expect(x.left).toBeCloseTo(1 / 4);
      expect(x.width).toBeCloseTo(2 / 4);
    });

    it('右隣の列に衝突がある場合は拡張されない', () => {
      const result = layoutTimeGridItems([
        item('a', t(10), t(11)),
        item('b', t(10, 30), t(11, 30)),
      ]);
      expect(placementOf(result, 'a').width).toBeCloseTo(1 / 2);
    });
  });

  describe('minSlotMinutes（重なり判定上の最小長さ）', () => {
    it('既定 30 分の仮想長により 15 分イベント 2 件（10:00-10:15 と 10:20-10:35）が横並びになる', () => {
      // 実時間では重ならないが、仮想長 30 分（10:00-10:30 と 10:20-10:50）では重なる。
      const result = layoutTimeGridItems([
        item('a', t(10), t(10, 15)),
        item('b', t(10, 20), t(10, 35)),
      ]);
      const a = placementOf(result, 'a');
      const b = placementOf(result, 'b');
      expect(a.left).toBeCloseTo(0);
      expect(a.width).toBeCloseTo(1 / 2);
      expect(b.left).toBeCloseTo(1 / 2);
      expect(b.width).toBeCloseTo(1 / 2);
    });

    it('minSlotMinutes: 0 なら同じ 2 件は重ならず全幅になる', () => {
      const result = layoutTimeGridItems(
        [item('a', t(10), t(10, 15)), item('b', t(10, 20), t(10, 35))],
        { minSlotMinutes: 0 },
      );
      for (const key of ['a', 'b']) {
        const p = placementOf(result, key);
        expect(p.left).toBeCloseTo(0);
        expect(p.width).toBeCloseTo(1);
      }
    });

    it('仮想長どうしの比較も [start, end) 排他（15 分イベントが 30 分ちょうど離れていれば重ならない）', () => {
      // a の仮想区間は 10:00-10:30。b は 10:30 開始なので排他比較で重ならない。
      const result = layoutTimeGridItems([
        item('a', t(10), t(10, 15)),
        item('b', t(10, 30), t(10, 45)),
      ]);
      for (const key of ['a', 'b']) {
        const p = placementOf(result, key);
        expect(p.left).toBeCloseTo(0);
        expect(p.width).toBeCloseTo(1);
      }
    });

    it('minSlotMinutes を明示指定した場合はその値が使われる', () => {
      // 仮想長 60 分: a は 10:00-11:00 とみなされ b (10:45-11:45) と重なる。
      const result = layoutTimeGridItems(
        [item('a', t(10), t(10, 15)), item('b', t(10, 45), t(11, 45))],
        { minSlotMinutes: 60 },
      );
      expect(placementOf(result, 'a').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'b').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'b').left).toBeCloseTo(1 / 2);
    });

    it('minSlotMinutes より長いイベントの重なり判定は実際の長さで行われる', () => {
      // 60 分イベントどうしが連続しても重ならない（仮想長の影響を受けない）。
      const result = layoutTimeGridItems([item('a', t(10), t(11)), item('b', t(11), t(12))], {
        minSlotMinutes: 30,
      });
      expect(placementOf(result, 'a').width).toBeCloseTo(1);
      expect(placementOf(result, 'b').width).toBeCloseTo(1);
    });
  });

  describe('不正入力（startMinutes < endMinutes の前提違反）', () => {
    it('長さ 0 のアイテムは例外を投げず、仮想長 30 分として扱われる', () => {
      // z (10:00-10:00) は仮想的に 10:00-10:30 とみなされ、a (10:15-11:15) と横並びになる。
      const result = layoutTimeGridItems([
        item('z', t(10), t(10)),
        item('a', t(10, 15), t(11, 15)),
      ]);
      expect(placementOf(result, 'z').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'a').width).toBeCloseTo(1 / 2);
    });

    it('minSlotMinutes: 0 のとき長さ 0 のアイテムは何とも重ならず全幅になる', () => {
      const result = layoutTimeGridItems([item('z', t(10), t(10)), item('a', t(10), t(11))], {
        minSlotMinutes: 0,
      });
      expect(placementOf(result, 'z').left).toBeCloseTo(0);
      expect(placementOf(result, 'z').width).toBeCloseTo(1);
      expect(placementOf(result, 'a').left).toBeCloseTo(0);
      expect(placementOf(result, 'a').width).toBeCloseTo(1);
    });
  });

  describe('結果の順序', () => {
    it('結果はソート順ではなく入力順を維持する', () => {
      const result = layoutTimeGridItems([
        item('late', t(10, 30), t(11, 30)),
        item('early', t(10), t(11)),
      ]);
      expect(result.map((p) => p.key)).toEqual(['late', 'early']);
      // 配置自体はソート順（early が左）
      expect(placementOf(result, 'early').left).toBeCloseTo(0);
      expect(placementOf(result, 'late').left).toBeCloseTo(1 / 2);
    });

    it('入力と同数の結果を返す', () => {
      const items = [
        item('a', t(9), t(10)),
        item('b', t(9, 30), t(10, 30)),
        item('c', t(12), t(13)),
        item('d', t(22), t(23)),
      ];
      expect(layoutTimeGridItems(items)).toHaveLength(items.length);
    });
  });

  describe('複数クラスタの独立性', () => {
    it('離れたクラスタは互いの列数に影響しない', () => {
      // 午前クラスタ: 3 件重なり（幅 1/3）、午後クラスタ: 2 件重なり（幅 1/2）
      const result = layoutTimeGridItems([
        item('m1', t(9), t(11)),
        item('m2', t(9, 30), t(11, 30)),
        item('m3', t(10), t(12)),
        item('p1', t(14), t(15)),
        item('p2', t(14, 30), t(15, 30)),
      ]);
      expect(placementOf(result, 'm1').width).toBeCloseTo(1 / 3);
      expect(placementOf(result, 'm2').width).toBeCloseTo(1 / 3);
      expect(placementOf(result, 'm3').width).toBeCloseTo(1 / 3);
      expect(placementOf(result, 'p1').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'p2').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'p1').left).toBeCloseTo(0);
      expect(placementOf(result, 'p2').left).toBeCloseTo(1 / 2);
    });
  });

  describe('境界を超える分値（DST の 25 時間日などを想定）', () => {
    it('1440 分（24:00）を超える値でも正しく重なり判定される', () => {
      // 秋の DST 切り替え日は 25 時間（0〜1500 分）になり得る。
      // 23:00-25:00 と 24:00-25:00 は重なる。
      const result = layoutTimeGridItems([item('a', t(23), t(25)), item('b', t(24), t(25))]);
      expect(placementOf(result, 'a').left).toBeCloseTo(0);
      expect(placementOf(result, 'a').width).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'b').left).toBeCloseTo(1 / 2);
      expect(placementOf(result, 'b').width).toBeCloseTo(1 / 2);
    });
  });
});
