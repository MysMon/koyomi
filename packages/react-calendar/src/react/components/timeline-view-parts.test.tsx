import { describe, expect, it } from 'vitest';
import type { TimelineRow } from '../../core/types';
import {
  defaultResourceToggleAriaLabel,
  resolveResourceToggleAriaLabel,
  sameBusinessHourRanges,
  samePreviewSegment,
  sameResource,
  sameTimelineRow,
  withDepthStyle,
  withLaneCountStyle,
  withTimelineDaysStyle,
} from './timeline-view-parts';

/** テスト用の TimelineRow を作る。 */
function row(overrides: Partial<TimelineRow> = {}): TimelineRow {
  return {
    resource: { id: 'r1', title: 'リソース1' },
    key: 'r:r1',
    items: [],
    laneCount: 0,
    depth: 0,
    hasChildren: false,
    collapsed: false,
    ...overrides,
  };
}

describe('timeline-view-parts', () => {
  it('レーン数を 1 以上へクランプして CSS 変数にする', () => {
    expect(withLaneCountStyle(0)).toEqual({ '--koyomi-timeline-lanes': '1' });
    expect(withLaneCountStyle(3)).toEqual({ '--koyomi-timeline-lanes': '3' });
  });

  it('表示日数を 1 以上へクランプして CSS 変数にする', () => {
    expect(withTimelineDaysStyle(0)).toEqual({ '--koyomi-timeline-days': '1' });
    expect(withTimelineDaysStyle(180)).toEqual({ '--koyomi-timeline-days': '180' });
  });

  it('リソースと営業時間帯を表示内容で比較する', () => {
    expect(sameResource({ id: 'a', title: 'A' }, { id: 'a', title: 'A' })).toBe(true);
    expect(sameResource({ id: 'a', title: 'A' }, { id: 'b', title: 'A' })).toBe(false);
    expect(
      sameBusinessHourRanges(
        [{ startMinutes: 60, endMinutes: 120 }],
        [{ startMinutes: 60, endMinutes: 120 }],
      ),
    ).toBe(true);
    expect(
      sameBusinessHourRanges(
        [{ startMinutes: 60, endMinutes: 120 }],
        [{ startMinutes: 60, endMinutes: 180 }],
      ),
    ).toBe(false);
  });

  it('プレビューの null と各表示分を比較する', () => {
    expect(samePreviewSegment(null, null)).toBe(true);
    expect(samePreviewSegment(null, { kind: 'create', startMinutes: 0, endMinutes: 30 })).toBe(
      false,
    );
    expect(
      samePreviewSegment(
        { kind: 'resize', startMinutes: 30, endMinutes: 90 },
        { kind: 'resize', startMinutes: 30, endMinutes: 90 },
      ),
    ).toBe(true);
  });

  it('深さを CSS 変数にする', () => {
    expect(withDepthStyle({}, 0)).toEqual({ '--koyomi-timeline-row-depth': '0' });
    expect(withDepthStyle({ color: 'red' }, 2)).toEqual({
      color: 'red',
      '--koyomi-timeline-row-depth': '2',
    });
  });

  it('sameTimelineRow は depth/hasChildren/collapsed の差も検出する', () => {
    expect(sameTimelineRow(row(), row())).toBe(true);
    expect(sameTimelineRow(row({ depth: 0 }), row({ depth: 1 }))).toBe(false);
    expect(sameTimelineRow(row({ hasChildren: false }), row({ hasChildren: true }))).toBe(false);
    expect(sameTimelineRow(row({ collapsed: false }), row({ collapsed: true }))).toBe(false);
  });

  it('defaultResourceToggleAriaLabel は折りたたみ状態に応じた既定文言を返す', () => {
    const resource = { id: 'r1', title: '会議室A' };
    expect(defaultResourceToggleAriaLabel(resource, false)).toBe('会議室A を折りたたむ');
    expect(defaultResourceToggleAriaLabel(resource, true)).toBe('会議室A を展開する');
  });

  it('resolveResourceToggleAriaLabel は custom 未指定時は既定文言、指定時はその戻り値を返す', () => {
    const resource = { id: 'r1', title: '会議室A' };
    expect(resolveResourceToggleAriaLabel(resource, false, undefined)).toBe('会議室A を折りたたむ');
    const custom = (r: typeof resource, collapsed: boolean, defaultLabel: string) =>
      `${r.title}/${collapsed}/${defaultLabel}`;
    expect(resolveResourceToggleAriaLabel(resource, true, custom)).toBe(
      '会議室A/true/会議室A を展開する',
    );
  });
});
