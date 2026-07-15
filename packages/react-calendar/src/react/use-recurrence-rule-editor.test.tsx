/**
 * @packageDocumentation
 * `useRecurrenceRuleEditor` のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecurrenceRuleEditor } from './use-recurrence-rule-editor';

const TOKYO = 'Asia/Tokyo';
/** 東京 7/1 9:00（水曜日）の絶対時刻。 */
const START = new Date('2026-07-01T00:00:00Z');

describe('useRecurrenceRuleEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rrule 省略時は state・rruleString・description がすべて null になる', () => {
    const { result } = renderHook(() => useRecurrenceRuleEditor({ start: START, timeZone: TOKYO }));

    expect(result.current.state).toBeNull();
    expect(result.current.unsupported).toBeNull();
    expect(result.current.rruleString).toBeNull();
    expect(result.current.description).toBeNull();
    expect(result.current.errors).toEqual([]);
  });

  it('既存の rrule を渡すと parseRecurrenceRule と一致する state になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }),
    );

    expect(result.current.state).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3],
      end: { type: 'never' },
    });
    expect(result.current.unsupported).toBeNull();
    expect(result.current.rruleString).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('対応範囲外の rrule を渡すと state は null、unsupported.rawRRule が元の文字列と一致する', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=HOURLY' }),
    );

    expect(result.current.state).toBeNull();
    expect(result.current.unsupported).not.toBeNull();
    expect(result.current.unsupported?.rawRRule).toBe('FREQ=HOURLY');
  });

  it('setFrequency("weekly") で byWeekday 未設定なら dtstart の曜日が補われる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    act(() => {
      result.current.setFrequency('weekly');
    });

    // START（2026-07-01, 東京）は水曜日 = 3
    expect(result.current.state?.freq).toBe('weekly');
    expect(result.current.state?.byWeekday).toEqual([3]);
  });

  it('daily に切替後に再度 weekly へ切り替えると byWeekday は前回の選択を保持せず既定値になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({
        start: START,
        timeZone: TOKYO,
        rrule: 'FREQ=WEEKLY;BYDAY=MO,FR',
      }),
    );
    expect(result.current.state?.byWeekday).toEqual([1, 5]);

    act(() => {
      result.current.setFrequency('daily');
    });
    expect(result.current.state).toEqual({ freq: 'daily', interval: 1, end: { type: 'never' } });

    act(() => {
      result.current.setFrequency('weekly');
    });
    // MO,FR は daily への切替時に失われているため、既定値（dtstart の曜日）に戻る
    expect(result.current.state?.byWeekday).toEqual([3]);
  });

  it('setInterval(0) を呼ぶと state は更新され errors に反映されるが rruleString は null になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    act(() => {
      result.current.setInterval(0);
    });

    expect(result.current.state?.interval).toBe(0);
    expect(result.current.errors.some((issue) => issue.field === 'interval')).toBe(true);
    expect(result.current.rruleString).toBeNull();
  });

  it('enable() を unsupported 状態から呼ぶと unsupported が null になり既定 state が入る', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=HOURLY' }),
    );
    expect(result.current.unsupported).not.toBeNull();

    act(() => {
      result.current.enable();
    });

    expect(result.current.unsupported).toBeNull();
    expect(result.current.state).toEqual({ freq: 'daily', interval: 1, end: { type: 'never' } });
  });

  it('enable() は既に state がある場合は何もしない', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
    );
    const before = result.current.state;

    act(() => {
      result.current.enable();
    });

    expect(result.current.state).toEqual(before);
  });

  it('clear() で state・unsupported の両方が null に戻る', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
    );
    expect(result.current.state).not.toBeNull();

    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toBeNull();
    expect(result.current.unsupported).toBeNull();
  });

  it('options.describeRule を渡すと description がその戻り値になる', () => {
    const describeRule = vi.fn().mockReturnValue('カスタム説明文');
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY', describeRule }),
    );

    expect(result.current.description).toBe('カスタム説明文');
    expect(describeRule).toHaveBeenCalledWith(result.current.state, '毎日');
  });

  it('options.describeRule 省略時は core 既定の日本語文言になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    expect(result.current.description).toBe('毎日');
  });

  describe('初期値のみ有効の規約', () => {
    it('マウント後に rrule を変更しても state は追従しない', () => {
      const { result, rerender } = renderHook(
        (props: { rrule: string }) =>
          useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: props.rrule }),
        { initialProps: { rrule: 'FREQ=DAILY' } },
      );
      expect(result.current.state?.freq).toBe('daily');

      rerender({ rrule: 'FREQ=WEEKLY;BYDAY=MO' });

      expect(result.current.state?.freq).toBe('daily');
    });

    it('マウント後に異なる rrule を渡すと console.warn で一度だけ警告する', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { rerender } = renderHook(
        (props: { rrule: string }) =>
          useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: props.rrule }),
        { initialProps: { rrule: 'FREQ=DAILY' } },
      );

      expect(warn).not.toHaveBeenCalled();

      rerender({ rrule: 'FREQ=WEEKLY;BYDAY=MO' });
      rerender({ rrule: 'FREQ=WEEKLY;BYDAY=MO' });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('key');
    });
  });

  it('setter群の参照は再レンダーで安定している', () => {
    const { result, rerender } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    const first = result.current;
    rerender();

    expect(result.current.setFrequency).toBe(first.setFrequency);
    expect(result.current.setInterval).toBe(first.setInterval);
    expect(result.current.setByWeekday).toBe(first.setByWeekday);
    expect(result.current.setMonthlyPattern).toBe(first.setMonthlyPattern);
    expect(result.current.setEnd).toBe(first.setEnd);
    expect(result.current.enable).toBe(first.enable);
    expect(result.current.clear).toBe(first.clear);
  });

  it('状態が変わらない再レンダーでは戻り値オブジェクトの参照が同一になる', () => {
    const { result, rerender } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
