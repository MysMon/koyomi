import { describe, expect, it } from 'vitest';
import type { EventOccurrence } from '../../core/types';
import {
  defaultListDayAriaLabel,
  eventSwatchStyle,
  formatTimedEventTimeLabel,
} from './list-view-parts';

function occurrence(): EventOccurrence {
  const start = new Date('2026-07-15T01:05:00Z');
  return {
    key: 'e1@2026-07-15T01:05:00.000Z',
    eventId: 'e1',
    event: { id: 'e1', title: '会議', start, end: new Date('2026-07-15T02:35:00Z') },
    start,
    end: new Date('2026-07-15T02:35:00Z'),
    allDay: false,
    isRecurring: false,
    originalStart: start,
  };
}

describe('list-view-parts', () => {
  it('日セクションの既定 aria-label に予定件数を含める', () => {
    expect(defaultListDayAriaLabel('7月15日(水)', 2)).toBe('7月15日(水) 予定2件');
  });

  it('時間指定イベントを表示タイムゾーンの時刻範囲へ整形する（locale=ja）', () => {
    expect(formatTimedEventTimeLabel(occurrence(), 'Asia/Tokyo', 'ja')).toBe('10:05〜11:35');
  });

  it('locale=en-US では 12h/AM-PM 表記の時刻範囲になる', () => {
    expect(formatTimedEventTimeLabel(occurrence(), 'Asia/Tokyo', 'en-US')).toBe(
      '10:05 AM〜11:35 AM',
    );
  });

  it('色指定時だけイベント色 CSS 変数を返す', () => {
    expect(eventSwatchStyle(undefined)).toBeUndefined();
    expect(eventSwatchStyle('#123456')).toEqual({ '--koyomi-event-color': '#123456' });
  });
});
