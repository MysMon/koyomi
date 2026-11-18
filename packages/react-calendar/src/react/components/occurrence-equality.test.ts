import { describe, expect, it } from 'vitest';
import type { CalendarEvent, EventOccurrence } from '../../core/types';
import { sameOccurrence } from './occurrence-equality';

const EVENT: CalendarEvent = {
  id: 'e1',
  title: '会議',
  start: '2026-07-15T10:00',
  end: '2026-07-15T11:00',
};

/** テスト用のオカレンスを作る（`event` は既定で共有の {@link EVENT} を参照する）。 */
function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    key: 'e1@2026-07-15T01:00:00.000Z',
    eventId: 'e1',
    event: EVENT,
    start: new Date('2026-07-15T01:00:00Z'),
    end: new Date('2026-07-15T02:00:00Z'),
    originalStart: new Date('2026-07-15T01:00:00Z'),
    allDay: false,
    isRecurring: false,
    ...overrides,
  };
}

describe('sameOccurrence', () => {
  it('同じ参照なら true', () => {
    const target = occurrence();
    expect(sameOccurrence(target, target)).toBe(true);
  });

  it('オカレンスの参照が違っても、event の参照と各値が同じなら true（ビューモデル再構築時の再レンダー抑制）', () => {
    expect(sameOccurrence(occurrence(), occurrence())).toBe(true);
  });

  it('event の参照が違えば、内容が同じでも false（イベントの全項目の変更を検出するため参照で比較する）', () => {
    expect(sameOccurrence(occurrence(), occurrence({ event: { ...EVENT } }))).toBe(false);
  });

  it('タイトル・色以外の項目（location）だけが違う event でも false', () => {
    expect(
      sameOccurrence(occurrence(), occurrence({ event: { ...EVENT, location: '会議室2' } })),
    ).toBe(false);
  });

  it('key・allDay・isRecurring のいずれかが異なれば false', () => {
    expect(sameOccurrence(occurrence(), occurrence({ key: 'e1@other' }))).toBe(false);
    expect(sameOccurrence(occurrence(), occurrence({ allDay: true }))).toBe(false);
    expect(sameOccurrence(occurrence(), occurrence({ isRecurring: true }))).toBe(false);
  });

  it('start・end・originalStart のいずれかの時刻が異なれば false', () => {
    const later = new Date('2026-07-15T03:00:00Z');
    expect(sameOccurrence(occurrence(), occurrence({ start: later }))).toBe(false);
    expect(sameOccurrence(occurrence(), occurrence({ end: later }))).toBe(false);
    expect(sameOccurrence(occurrence(), occurrence({ originalStart: later }))).toBe(false);
  });
});
