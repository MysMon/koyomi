import { describe, expect, it } from 'vitest';
import type { IntervalLaneInput } from './interval-lane-layout';
import { layoutIntervalLanes } from './interval-lane-layout';

/** テスト用の区間アイテムを作る。 */
function item(key: string, start: number, end: number): IntervalLaneInput {
  return { key, start, end };
}

describe('layoutIntervalLanes', () => {
  it('空入力では placements が空で laneCount が 0 になる', () => {
    const result = layoutIntervalLanes([]);
    expect(result.placements).toEqual([]);
    expect(result.laneCount).toBe(0);
  });

  it('重ならない区間は同じレーン 0 に詰められる', () => {
    const result = layoutIntervalLanes([item('a', 0, 60), item('b', 60, 120), item('c', 180, 240)]);
    expect(result.placements).toEqual([
      { key: 'a', lane: 0, hidden: false },
      { key: 'b', lane: 0, hidden: false },
      { key: 'c', lane: 0, hidden: false },
    ]);
    expect(result.laneCount).toBe(1);
    expect(result.overflowCount).toBe(0);
  });

  it('接触（end === start、排他境界）は重ならないとして同じレーンに入る', () => {
    const result = layoutIntervalLanes([item('a', 0, 100), item('b', 100, 200)]);
    expect(result.placements.map((p) => p.lane)).toEqual([0, 0]);
    expect(result.laneCount).toBe(1);
  });

  it('重なる区間は下のレーンへ積まれる', () => {
    const result = layoutIntervalLanes([item('a', 0, 100), item('b', 50, 150)]);
    expect(result.placements).toEqual([
      { key: 'a', lane: 0, hidden: false },
      { key: 'b', lane: 1, hidden: false },
    ]);
    expect(result.laneCount).toBe(2);
  });

  it('全件が重なる場合はレーンが件数分になる', () => {
    const result = layoutIntervalLanes([
      item('a', 0, 100),
      item('b', 10, 90),
      item('c', 20, 80),
      item('d', 30, 70),
    ]);
    expect(new Set(result.placements.map((p) => p.lane)).size).toBe(4);
    expect(result.laneCount).toBe(4);
  });

  it('レーンが空けば再利用される（貪欲な最小レーン割当）', () => {
    // a: [0,100) → レーン0、b: [50,150) → レーン1、c: [120,200) は a と重ならないのでレーン0
    const result = layoutIntervalLanes([
      item('a', 0, 100),
      item('b', 50, 150),
      item('c', 120, 200),
    ]);
    expect(result.placements).toEqual([
      { key: 'a', lane: 0, hidden: false },
      { key: 'b', lane: 1, hidden: false },
      { key: 'c', lane: 0, hidden: false },
    ]);
    expect(result.laneCount).toBe(2);
  });

  it('ソート規則: 開始昇順 → 長さ降順 → key 辞書順で処理される', () => {
    // 同時開始では長い方が先（上のレーン）。同開始・同長では key 辞書順
    const result = layoutIntervalLanes([
      item('short', 0, 50),
      item('long', 0, 200),
      item('b', 0, 50),
    ]);
    const byKey = new Map(result.placements.map((p) => [p.key, p.lane]));
    expect(byKey.get('long')).toBe(0);
    // 'b' < 'short' なので b が先に処理されレーン 1、short がレーン 2
    expect(byKey.get('b')).toBe(1);
    expect(byKey.get('short')).toBe(2);
  });

  it('結果は入力配列と同数・同順で返る（ソートは内部処理のみ）', () => {
    const inputs = [item('z', 100, 200), item('a', 0, 300), item('m', 150, 250)];
    const result = layoutIntervalLanes(inputs);
    expect(result.placements.map((p) => p.key)).toEqual(['z', 'a', 'm']);
  });

  it('推移的な重なり（a-b 重なり・b-c 重なり・a-c 非重なり）でも正しく詰められる', () => {
    // a: [0,100) レーン0、b: [50,150) レーン1、c: [100,200) は a と接触（非重なり）なのでレーン0
    const result = layoutIntervalLanes([
      item('a', 0, 100),
      item('b', 50, 150),
      item('c', 100, 200),
    ]);
    expect(result.placements).toEqual([
      { key: 'a', lane: 0, hidden: false },
      { key: 'b', lane: 1, hidden: false },
      { key: 'c', lane: 0, hidden: false },
    ]);
    expect(result.laneCount).toBe(2);
  });

  describe('maxLanes（あふれの非表示化、opt-in）', () => {
    it('maxLanes 省略時は従来どおり全アイテムが表示される（hidden は常に false）', () => {
      const result = layoutIntervalLanes([
        item('a', 0, 100),
        item('b', 10, 90),
        item('c', 20, 80),
        item('d', 30, 70),
      ]);
      expect(result.placements.every((p) => p.hidden === false)).toBe(true);
      expect(result.laneCount).toBe(4);
      expect(result.overflowCount).toBe(0);
    });

    it('使用レーン数が maxLanes ちょうど（超過なし）では、どのアイテムも hidden にならない', () => {
      const result = layoutIntervalLanes(
        [item('a', 0, 100), item('b', 10, 90)],
        2, // 使用レーン数 2 = maxLanes 2（超過なし）
      );
      expect(result.placements).toEqual([
        { key: 'a', lane: 0, hidden: false },
        { key: 'b', lane: 1, hidden: false },
      ]);
      expect(result.laneCount).toBe(2);
      expect(result.overflowCount).toBe(0);
    });

    it('使用レーン数が maxLanes を 1 超過すると、超過分だけ hidden になり overflowCount に計上される', () => {
      // 全件が重なるため a→レーン0、b→レーン1、c→レーン2。maxLanes=2 なので c だけ hidden
      const result = layoutIntervalLanes(
        [item('a', 0, 100), item('b', 10, 90), item('c', 20, 80)],
        2,
      );
      expect(result.placements).toEqual([
        { key: 'a', lane: 0, hidden: false },
        { key: 'b', lane: 1, hidden: false },
        { key: 'c', lane: 2, hidden: true },
      ]);
      // laneCount は表示レーンのみ（hidden だけが乗るレーンは含めない）
      expect(result.laneCount).toBe(2);
      expect(result.overflowCount).toBe(1);
    });

    it('hidden になったアイテムもレーンを専有し、後続アイテムが割り込まない', () => {
      // a,b,c が全件重なり maxLanes=1 → b,c が hidden。b がレーン1を専有した後、
      // b と重ならない d（[100,200)）は空いたレーン0 ではなくレーン1 を再利用できるかを検証
      const result = layoutIntervalLanes(
        [
          item('a', 0, 100),
          item('b', 0, 100),
          item('d', 100, 200), // a・b と接触（非重なり）だが c とも非重なり
        ],
        1,
      );
      const byKey = new Map(result.placements.map((p) => [p.key, p]));
      expect(byKey.get('a')).toEqual({ key: 'a', lane: 0, hidden: false });
      expect(byKey.get('b')).toEqual({ key: 'b', lane: 1, hidden: true });
      // d は a と接触（非重なり）なのでレーン0（最小の空きレーン）に入る
      expect(byKey.get('d')).toEqual({ key: 'd', lane: 0, hidden: false });
      expect(result.laneCount).toBe(1);
      expect(result.overflowCount).toBe(1);
    });
  });
});
