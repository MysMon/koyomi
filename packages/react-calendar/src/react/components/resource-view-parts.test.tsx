import { describe, expect, it } from 'vitest';
import {
  ariaLabelText,
  sameBusinessHourSlots,
  samePreviewSegment,
  sameResource,
  sameSlots,
} from './resource-view-parts';

describe('resource-view-parts', () => {
  it('文字列ラベルはそのまま aria-label に使い、文字列でない ReactNode は undefined（属性省略）になる', () => {
    expect(ariaLabelText('会議室')).toBe('会議室');
    expect(ariaLabelText(123)).toBeUndefined();
  });

  it('リソースの表示フィールドを比較する', () => {
    expect(sameResource(null, null)).toBe(true);
    expect(sameResource(null, { id: 'a', title: 'A' })).toBe(false);
    expect(sameResource({ id: 'a', title: 'A' }, { id: 'a', title: 'A' })).toBe(true);
    expect(sameResource({ id: 'a', title: 'A' }, { id: 'a', title: 'B' })).toBe(false);
  });

  it('スロット・営業時間・プレビューを内容で比較する', () => {
    expect(sameSlots([{ minutes: 0, label: '00:00' }], [{ minutes: 0, label: '別' }])).toBe(true);
    expect(sameSlots([{ minutes: 0, label: '00:00' }], [])).toBe(false);
    expect(
      sameBusinessHourSlots(
        [{ minutes: 60, isBusinessHours: true }],
        [{ minutes: 60, isBusinessHours: true }],
      ),
    ).toBe(true);
    expect(
      sameBusinessHourSlots(
        [{ minutes: 60, isBusinessHours: true }],
        [{ minutes: 60, isBusinessHours: false }],
      ),
    ).toBe(false);
    expect(samePreviewSegment(null, null)).toBe(true);
    expect(samePreviewSegment(null, { kind: 'create', startMinutes: 0, endMinutes: 60 })).toBe(
      false,
    );
    expect(
      samePreviewSegment(
        { kind: 'move', startMinutes: 60, endMinutes: 120 },
        { kind: 'move', startMinutes: 60, endMinutes: 120 },
      ),
    ).toBe(true);
  });
});
