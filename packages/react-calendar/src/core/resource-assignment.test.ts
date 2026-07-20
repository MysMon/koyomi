/**
 * resource-assignment.ts のテスト。
 *
 * `resourceIds`（複数リソース割当）と `resourceId`（単一割当）の優先規則、
 * レーンへの振り分け、レーン間移動時のパッチ構築の仕様を固定する。
 */
import { describe, expect, it } from 'vitest';
import { assignedLaneIds, effectiveResourceIds, resourceLanePatch } from './resource-assignment';

describe('effectiveResourceIds', () => {
  it('resourceIds 未指定なら resourceId を 1 件の一覧として返す', () => {
    expect(effectiveResourceIds({ resourceId: 'room-a' })).toEqual(['room-a']);
  });

  it('resourceId も resourceIds も未指定なら空配列を返す', () => {
    expect(effectiveResourceIds({})).toEqual([]);
  });

  it('resourceIds 指定時は resourceIds を採用し、resourceId は無視する（優先規則）', () => {
    expect(
      effectiveResourceIds({ resourceId: 'room-a', resourceIds: ['room-b', 'room-c'] }),
    ).toEqual(['room-b', 'room-c']);
  });

  it('resourceIds が空配列なら resourceId があっても未割り当て（空配列）になる', () => {
    expect(effectiveResourceIds({ resourceId: 'room-a', resourceIds: [] })).toEqual([]);
  });

  it('resourceIds 内の重複 ID は先勝ちで除かれる', () => {
    expect(effectiveResourceIds({ resourceIds: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
  });
});

describe('assignedLaneIds', () => {
  const known = new Set(['room-a', 'room-b']);

  it('割当のないイベントは未割り当てレーン（[null]）になる', () => {
    expect(assignedLaneIds({}, known)).toEqual([null]);
  });

  it('存在する ID のみのレーン一覧になる（参照先のない ID は除外）', () => {
    expect(assignedLaneIds({ resourceIds: ['room-a', 'ghost', 'room-b'] }, known)).toEqual([
      'room-a',
      'room-b',
    ]);
  });

  it('割当がすべて参照先のない ID の場合は未割り当てレーンに合流する', () => {
    expect(assignedLaneIds({ resourceIds: ['ghost-1', 'ghost-2'] }, known)).toEqual([null]);
  });

  it('resourceIds が空配列なら未割り当てレーンになる', () => {
    expect(assignedLaneIds({ resourceIds: [] }, known)).toEqual([null]);
  });

  it('単一割当（resourceId のみ）でも同じ規則で 1 レーンになる', () => {
    expect(assignedLaneIds({ resourceId: 'room-b' }, known)).toEqual(['room-b']);
    expect(assignedLaneIds({ resourceId: 'ghost' }, known)).toEqual([null]);
  });
});

describe('resourceLanePatch', () => {
  describe('単一割当（resourceIds 未指定）', () => {
    it('移動元と移動先が同じレーンなら空パッチを返す', () => {
      expect(resourceLanePatch({ resourceId: 'a' }, 'a', 'a')).toEqual({});
    });

    it('別リソースへの移動は resourceId を差し替える', () => {
      expect(resourceLanePatch({ resourceId: 'a' }, 'a', 'b')).toEqual({ resourceId: 'b' });
    });

    it('未割り当てへの移動は resourceId の削除（undefined 値のキー）になる', () => {
      const patch = resourceLanePatch({ resourceId: 'a' }, 'a', null);
      expect(Object.keys(patch)).toEqual(['resourceId']);
      expect(patch.resourceId).toBeUndefined();
    });

    it('未割り当てからリソースへの移動は resourceId を設定する', () => {
      expect(resourceLanePatch({}, null, 'b')).toEqual({ resourceId: 'b' });
    });
  });

  describe('複数割当（resourceIds 指定）', () => {
    it('移動元レーンの割当だけが移動先に置き換わり、他の割当は保持される', () => {
      expect(resourceLanePatch({ resourceIds: ['a', 'c'] }, 'a', 'b')).toEqual({
        resourceIds: ['b', 'c'],
      });
    });

    it('移動先がすでに割当済みなら重複させず統合する（Google カレンダーの会議室割当と同じ）', () => {
      expect(resourceLanePatch({ resourceIds: ['a', 'b'] }, 'a', 'b')).toEqual({
        resourceIds: ['b'],
      });
    });

    it('未割り当てへの移動は移動元レーンの割当だけを取り除く', () => {
      expect(resourceLanePatch({ resourceIds: ['a', 'c'] }, 'a', null)).toEqual({
        resourceIds: ['c'],
      });
    });

    it('最後の割当を未割り当てへ移動すると resourceIds が空配列になる', () => {
      expect(resourceLanePatch({ resourceIds: ['a'] }, 'a', null)).toEqual({ resourceIds: [] });
    });

    it('未割り当てレーンからリソースへの移動は割当を追加する', () => {
      expect(resourceLanePatch({ resourceIds: [] }, null, 'b')).toEqual({ resourceIds: ['b'] });
    });

    it('参照先のない ID は移動後もそのまま保持される', () => {
      expect(resourceLanePatch({ resourceIds: ['a', 'ghost'] }, 'a', 'b')).toEqual({
        resourceIds: ['b', 'ghost'],
      });
    });

    it('移動元と移動先が同じレーンなら空パッチを返す', () => {
      expect(resourceLanePatch({ resourceIds: ['a', 'c'] }, 'a', 'a')).toEqual({});
    });
  });
});
