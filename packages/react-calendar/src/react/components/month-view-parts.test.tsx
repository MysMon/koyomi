import { describe, expect, it } from 'vitest';
import type { DateRange, EventOccurrence } from '../../core/types';
import {
  formatEventAriaLabel,
  formatOccurrenceRangeLabel,
  percentOfSlotRange,
  resolveEventAriaLabel,
  withEventColorStyle,
  withMonthLanesStyle,
  withTimegridHoursStyle,
} from './month-view-parts';

function occurrence(allDay = false): EventOccurrence {
  const start = new Date('2026-07-15T01:00:00Z');
  return {
    key: `e1@${start.toISOString()}`,
    eventId: 'e1',
    event: { id: 'e1', title: '会議', start },
    start,
    end: allDay ? new Date('2026-07-16T15:00:00Z') : new Date('2026-07-15T02:00:00Z'),
    allDay,
    isRecurring: false,
    originalStart: start,
  };
}

describe('month-view-parts', () => {
  it('時間指定と複数日終日の aria-label を整形する', () => {
    expect(formatEventAriaLabel(occurrence(), 'Asia/Tokyo', 'ja')).toBe(
      '会議、7月15日 10:00〜11:00',
    );
    expect(formatEventAriaLabel(occurrence(true), 'Asia/Tokyo', 'ja')).toBe(
      '会議、7月15日〜7月16日',
    );
  });

  it('formatOccurrenceRangeLabel: 終日・単日は日付 1 つ、終日・複数日は日付範囲になる', () => {
    const singleDay: DateRange = {
      start: new Date('2026-07-15T01:00:00Z'),
      end: new Date('2026-07-15T15:00:00Z'), // 東京 2026-07-16 0:00（排他、終日単日）
    };
    expect(formatOccurrenceRangeLabel(singleDay, true, 'Asia/Tokyo', 'ja', '〜')).toBe('7月15日');

    const multiDay: DateRange = {
      start: new Date('2026-07-15T01:00:00Z'),
      end: new Date('2026-07-16T15:00:00Z'), // 東京 2026-07-17 0:00（排他、終日 2 日分）
    };
    expect(formatOccurrenceRangeLabel(multiDay, true, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月15日〜7月16日',
    );
  });

  it('formatOccurrenceRangeLabel: 時間指定・同日は時刻のみ、日をまたぐ場合は終了側にも日付を含める', () => {
    const sameDay: DateRange = {
      start: new Date('2026-07-15T01:00:00Z'), // 東京 10:00
      end: new Date('2026-07-15T02:00:00Z'), // 東京 11:00
    };
    expect(formatOccurrenceRangeLabel(sameDay, false, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月15日 10:00〜11:00',
    );

    const spanningMidnight: DateRange = {
      start: new Date('2026-07-15T14:00:00Z'), // 東京 2026-07-15 23:00
      end: new Date('2026-07-15T16:00:00Z'), // 東京 2026-07-16 1:00
    };
    expect(formatOccurrenceRangeLabel(spanningMidnight, false, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月15日 23:00〜7月16日 1:00',
    );
  });

  it('formatOccurrenceRangeLabel: rangeSeparator を差し替えると区切り記号が変わる', () => {
    const sameDay: DateRange = {
      start: new Date('2026-07-15T01:00:00Z'),
      end: new Date('2026-07-15T02:00:00Z'),
    };
    expect(formatOccurrenceRangeLabel(sameDay, false, 'Asia/Tokyo', 'ja', '–')).toBe(
      '7月15日 10:00–11:00',
    );
  });

  it('aria-label カスタマイザーを省略時と指定時で切り替える', () => {
    const target = occurrence();
    expect(resolveEventAriaLabel(target, '既定', undefined)).toBe('既定');
    expect(resolveEventAriaLabel(target, '既定', (_occurrence, label) => `変更:${label}`)).toBe(
      '変更:既定',
    );
  });

  it('月レーン数を 1 以上へクランプし、イベント色を必要時だけ追加する', () => {
    expect(withMonthLanesStyle(0)).toEqual({ '--koyomi-month-lanes': '1' });
    expect(withEventColorStyle({ top: '10%' }, undefined)).toEqual({ top: '10%' });
    expect(withEventColorStyle({ top: '10%' }, '#abcdef')).toEqual({
      top: '10%',
      '--koyomi-event-color': '#abcdef',
    });
  });

  describe('percentOfSlotRange', () => {
    it('既定の 0〜1440 の範囲では MINUTES_PER_DAY 基準の従来計算と数値的に完全一致する（回帰ペア）', () => {
      const cases: readonly [number, number][] = [
        [600, 660],
        [0, 1440],
        [10, 1430],
        [123, 987],
        [0, 60],
        [1380, 1440],
      ];
      for (const [start, end] of cases) {
        // top（絶対位置）: 既存の `(minutes / 1440) * 100` と完全一致
        expect(percentOfSlotRange(start, 0, 1440)).toBe((start / 1440) * 100);
        expect(percentOfSlotRange(end, 0, 1440)).toBe((end / 1440) * 100);
        // height（区間の長さ）: 区間を 0 起点の範囲として渡すことで、
        // 既存の `((end - start) / 1440) * 100` と完全一致する
        expect(percentOfSlotRange(end - start, 0, 1440)).toBe(((end - start) / 1440) * 100);
      }
    });

    it('制限範囲（480〜1200）では範囲に対する割合になる', () => {
      expect(percentOfSlotRange(480, 480, 1200)).toBe(0);
      expect(percentOfSlotRange(1200, 480, 1200)).toBe(100);
      expect(percentOfSlotRange(840, 480, 1200)).toBe(50);
    });

    it('区間の長さ（height 用）は range を 0 起点にすることで範囲幅に対する割合になる', () => {
      // 480〜1200（幅 720 分）のうち 360 分間の区間は幅の半分
      expect(percentOfSlotRange(360, 0, 1200 - 480)).toBe(50);
    });
  });

  describe('withTimegridHoursStyle', () => {
    it('既定の表示時間帯（0〜1440 分）では 24 になる', () => {
      expect(withTimegridHoursStyle(0, 1440)).toEqual({ '--koyomi-timegrid-hours': '24' });
    });

    it('表示時間帯を制限すると、その時間数（分差 / 60）になる', () => {
      expect(withTimegridHoursStyle(480, 1200)).toEqual({ '--koyomi-timegrid-hours': '12' });
    });
  });
});
