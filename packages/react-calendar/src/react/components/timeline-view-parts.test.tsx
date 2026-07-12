import { describe, expect, it } from 'vitest';
import {
  sameBusinessHourRanges,
  samePreviewSegment,
  sameResource,
  withLaneCountStyle,
} from './timeline-view-parts';

describe('timeline-view-parts', () => {
  it('レーン数を 1 以上へクランプして CSS 変数にする', () => {
    expect(withLaneCountStyle(0)).toEqual({ '--koyomi-timeline-lanes': '1' });
    expect(withLaneCountStyle(3)).toEqual({ '--koyomi-timeline-lanes': '3' });
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
});
