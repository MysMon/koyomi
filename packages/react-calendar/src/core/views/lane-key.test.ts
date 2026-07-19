/**
 * lane-key.ts のテスト。
 *
 * リソースレーン（リソースビューの列・タイムラインビューの行）のキー形式は
 * ここで encode/decode を対で管理する。形式を変える場合は両方を同時に変える。
 */
import { describe, expect, it } from 'vitest';
import {
  laneDayColumnKey,
  laneKeyForResource,
  resourceIdFromLaneKey,
  UNASSIGNED_LANE_KEY,
} from './lane-key';

describe('laneKeyForResource / resourceIdFromLaneKey', () => {
  it('エンコードしたキーをデコードすると元のリソース ID に戻る（往復）', () => {
    expect(resourceIdFromLaneKey(laneKeyForResource('room-a'))).toBe('room-a');
    expect(resourceIdFromLaneKey(laneKeyForResource(''))).toBe('');
  });

  it("ID が 'unassigned' のリソースは未割り当てレーンと衝突しない", () => {
    const key = laneKeyForResource('unassigned');
    expect(key).not.toBe(UNASSIGNED_LANE_KEY);
    expect(resourceIdFromLaneKey(key)).toBe('unassigned');
  });

  it('未割り当てレーンのキーは null（リソースなし）にデコードされる', () => {
    expect(resourceIdFromLaneKey(UNASSIGNED_LANE_KEY)).toBeNull();
  });

  it('null・解釈できない値は null に正規化される', () => {
    expect(resourceIdFromLaneKey(null)).toBeNull();
    expect(resourceIdFromLaneKey('unknown-format')).toBeNull();
  });
});

describe('laneDayColumnKey', () => {
  it("レーンキーと日付キーを '@' で連結した列キーを組み立てる", () => {
    expect(laneDayColumnKey(laneKeyForResource('room-a'), '2026-07-10')).toBe(
      'r:room-a@2026-07-10',
    );
    expect(laneDayColumnKey(UNASSIGNED_LANE_KEY, '2026-07-10')).toBe('unassigned@2026-07-10');
  });

  it('日付が異なれば同じレーンでも異なるキーになる（リソース×日で一意）', () => {
    const key1 = laneDayColumnKey(laneKeyForResource('room-a'), '2026-07-10');
    const key2 = laneDayColumnKey(laneKeyForResource('room-a'), '2026-07-11');
    expect(key1).not.toBe(key2);
  });
});
