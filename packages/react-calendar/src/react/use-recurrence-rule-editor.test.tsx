/**
 * @packageDocumentation
 * `useRecurrenceRuleEditor` のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { act, render, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecurrenceRuleEditor } from './use-recurrence-rule-editor';

const TOKYO = 'Asia/Tokyo';
const NEW_YORK = 'America/New_York';
/** 東京 7/1 9:00（水曜日）の絶対時刻。 */
const START = new Date('2026-07-01T00:00:00Z');
/** ニューヨーク 7/6 22:00（月曜日）＝ 東京 7/7 11:00（火曜日）の絶対時刻。 */
const NY_MONDAY_NIGHT = new Date('2026-07-07T02:00:00Z');

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

  it('options.messages.recurrenceEditor.describeRule を渡すと description がその戻り値になる', () => {
    const describeRule = vi.fn().mockReturnValue('カスタム説明文');
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({
        start: START,
        timeZone: TOKYO,
        rrule: 'FREQ=DAILY',
        messages: { recurrenceEditor: { describeRule } },
      }),
    );

    expect(result.current.description).toBe('カスタム説明文');
    expect(describeRule).toHaveBeenCalledWith(result.current.state, {
      dtstart: START,
      timeZone: TOKYO,
    });
  });

  it('options.locale / options.messages 省略時は ja の既定文言になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    expect(result.current.description).toBe('毎日');
  });

  it('options.locale: "en-US" を指定すると description が英語になる', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({
        start: START,
        timeZone: TOKYO,
        rrule: 'FREQ=DAILY',
        locale: 'en-US',
      }),
    );

    expect(result.current.description).toBe('Daily');
  });

  it('errors[].message に解決済みロケールの検証エラー文言が入る', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
    );

    act(() => {
      result.current.setInterval(0);
    });

    expect(result.current.errors).toEqual([
      {
        field: 'interval',
        code: 'invalid',
        message: '繰り返し間隔（interval）は 1 以上の整数で指定してください',
      },
    ]);
  });

  it('unsupported.message に解決済みロケールの非対応理由の文言が入る', () => {
    const { result } = renderHook(() =>
      useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=HOURLY' }),
    );

    expect(result.current.unsupported).toEqual({
      rawRRule: 'FREQ=HOURLY',
      reason: { code: 'unsupportedFrequency' },
      message: 'DAILY・WEEKLY・MONTHLY・YEARLY 以外の頻度は編集エディタでは扱えません',
    });
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

    it('マウント後に異なる rrule を渡すと console.warn で一度だけ警告し、文言が reset を案内する', () => {
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
      expect(warn.mock.calls[0]?.[0]).toContain('reset');
      expect(warn.mock.calls[0]?.[0]).toContain('key');
    });
  });

  describe('reset による編集対象の切り替え', () => {
    it('reset で新しい start/timeZone/rrule が反映され、rruleString も新しい編集対象で再計算される', () => {
      const { result } = renderHook(() =>
        useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
      );
      expect(result.current.state?.freq).toBe('daily');

      act(() => {
        result.current.reset({
          start: NY_MONDAY_NIGHT,
          timeZone: NEW_YORK,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
        });
      });

      expect(result.current.state).toEqual({
        freq: 'weekly',
        interval: 1,
        byWeekday: [1],
        end: { type: 'never' },
      });
      expect(result.current.unsupported).toBeNull();
      expect(result.current.rruleString).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('reset 後の setFrequency("weekly") の既定曜日は新しい start/timeZone から算出される', () => {
      const { result } = renderHook(() =>
        useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
      );

      act(() => {
        result.current.reset({ start: NY_MONDAY_NIGHT, timeZone: NEW_YORK, rrule: 'FREQ=DAILY' });
      });
      act(() => {
        result.current.setFrequency('weekly');
      });

      // NY_MONDAY_NIGHT はニューヨークでは月曜（1）、東京では火曜（2）。
      // 旧 timeZone（東京）が使われると [2] になるため、[1] で新 timeZone の使用を確認する
      expect(result.current.state?.byWeekday).toEqual([1]);
    });

    it('reset で rrule を省略すると「繰り返しなし」に初期化される', () => {
      const { result } = renderHook(() =>
        useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
      );
      expect(result.current.state).not.toBeNull();

      act(() => {
        result.current.reset({ start: START, timeZone: TOKYO });
      });

      expect(result.current.state).toBeNull();
      expect(result.current.unsupported).toBeNull();
      expect(result.current.rruleString).toBeNull();
      expect(result.current.description).toBeNull();
    });

    it('reset で対応範囲外の rrule を渡すと unsupported になり、編集中の state は引き継がれない', () => {
      const { result } = renderHook(() =>
        useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
      );

      act(() => {
        result.current.reset({ start: START, timeZone: TOKYO, rrule: 'FREQ=HOURLY' });
      });

      expect(result.current.state).toBeNull();
      expect(result.current.unsupported?.rawRRule).toBe('FREQ=HOURLY');
    });

    it('reset を呼んだ後は options の変更を検出する開発時警告が出ない', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result, rerender } = renderHook(
        (props: { rrule: string }) =>
          useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: props.rrule }),
        { initialProps: { rrule: 'FREQ=DAILY' } },
      );

      act(() => {
        result.current.reset({ start: START, timeZone: TOKYO, rrule: 'FREQ=WEEKLY;BYDAY=MO' });
      });
      // props 側は reset に追随してもしなくても警告しない（reset が編集対象の切り替え手段のため）
      rerender({ rrule: 'FREQ=WEEKLY;BYDAY=MO' });
      rerender({ rrule: 'FREQ=DAILY' });

      expect(warn).not.toHaveBeenCalled();
    });

    it('reset の参照は再レンダーで安定している', () => {
      const { result, rerender } = renderHook(() =>
        useRecurrenceRuleEditor({ start: START, timeZone: TOKYO, rrule: 'FREQ=DAILY' }),
      );

      const first = result.current.reset;
      rerender();

      expect(result.current.reset).toBe(first);
    });

    it('既存予定の編集ダイアログを再マウントせずに reset で編集対象を切り替えられる', () => {
      // key 再マウントの代わりに、props の変化に応じて reset を呼ぶダイアログ相当のコンポーネント
      function RecurrenceDialog({ start, rrule }: { start: Date; rrule: string }) {
        const editor = useRecurrenceRuleEditor({ start, timeZone: TOKYO, rrule });
        const { reset } = editor;
        useEffect(() => {
          reset({ start, timeZone: TOKYO, rrule });
        }, [reset, start, rrule]);
        return <p>{editor.description}</p>;
      }

      const { container, rerender } = render(<RecurrenceDialog start={START} rrule="FREQ=DAILY" />);
      expect(container.textContent).toBe('毎日');

      rerender(<RecurrenceDialog start={START} rrule="FREQ=WEEKLY;BYDAY=MO,WE" />);

      expect(container.textContent).toBe('毎週月・水');
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
