import { describe, expect, it } from 'vitest';
import type { EventOccurrence } from '../../core/types';
import {
  formatEventAriaLabel,
  resolveEventAriaLabel,
  withEventColorStyle,
  withMonthLanesStyle,
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
});
