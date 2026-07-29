import { describe, expect, it } from 'vitest';
import type { EventOccurrence, TimelineRow } from '../../core/types';
import {
  formatTimelineItemTimeText,
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
    overflowCount: 0,
    hiddenItems: [],
    depth: 0,
    hasChildren: false,
    collapsed: false,
    ...overrides,
  };
}

/** テスト用のオカレンスを作る。 */
function occurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  const base: EventOccurrence = {
    key: 'e1::2026-07-15T00:00:00.000Z',
    eventId: 'e1',
    event: { id: 'e1', title: '荷揚げ', start: '2026-07-15T09:00' },
    start: new Date('2026-07-15T00:00:00Z'), // 東京 9:00
    end: new Date('2026-07-15T02:00:00Z'), // 東京 11:00
    originalStart: new Date('2026-07-15T00:00:00Z'),
    allDay: false,
    isRecurring: false,
  };
  return { ...base, ...overrides };
}

describe('formatTimelineItemTimeText', () => {
  it('単日の時間指定イベントは時刻のみの範囲になる', () => {
    expect(formatTimelineItemTimeText(occurrence({}), 'Asia/Tokyo', 'ja', '〜')).toBe(
      '9:00〜11:00',
    );
  });

  it('複数日にまたがる時間指定イベントは日付付きの範囲になる', () => {
    const target = occurrence({
      start: new Date('2026-07-15T13:00:00Z'), // 東京 7/15 22:00
      end: new Date('2026-07-15T17:00:00Z'), // 東京 7/16 2:00
    });
    expect(formatTimelineItemTimeText(target, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月15日 22:00〜7月16日 2:00',
    );
  });

  it('終日イベントは null になる', () => {
    expect(formatTimelineItemTimeText(occurrence({ allDay: true }), 'Asia/Tokyo', 'ja', '〜')).toBe(
      null,
    );
  });

  it('区切り記号（rangeSeparator）が反映される', () => {
    expect(formatTimelineItemTimeText(occurrence({}), 'Asia/Tokyo', 'ja', ' - ')).toBe(
      '9:00 - 11:00',
    );
  });
});

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
});
