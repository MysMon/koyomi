import { act, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarRangeChangeInfo, CalendarResource } from '../core/types';
import { useCalendar } from './use-calendar';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

describe('useCalendar', () => {
  it('初期の state と viewModel を返す', () => {
    const { result } = renderHook(() =>
      useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW }),
    );

    expect(result.current.state.view).toBe('month');
    expect(result.current.state.timeZone).toBe('Asia/Tokyo');
    expect(result.current.viewModel.type).toBe('month');
    expect(result.current.api).toBeDefined();
  });

  it('api.setView を呼ぶと再レンダリングされ state.view と viewModel.type が変わる', () => {
    const { result } = renderHook(() =>
      useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW }),
    );

    act(() => {
      result.current.api.setView('week');
    });

    expect(result.current.state.view).toBe('week');
    expect(result.current.viewModel.type).toBe('timeGrid');
  });

  it('api の参照は再レンダリングを跨いで安定する', () => {
    const { result, rerender } = renderHook(() =>
      useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW }),
    );

    const firstApi = result.current.api;
    rerender();
    expect(result.current.api).toBe(firstApi);

    act(() => {
      firstApi.setView('day');
    });
    expect(result.current.api).toBe(firstApi);
  });

  it('options は初期値としてのみ使われ、rerender で別オブジェクトを渡してもエンジンは再生成されない', () => {
    const { result, rerender } = renderHook(
      (props: { initialView: 'month' | 'week' }) =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: props.initialView,
        }),
      { initialProps: { initialView: 'month' } },
    );

    const firstApi = result.current.api;
    expect(result.current.state.view).toBe('month');

    // 2 回目以降は initialView: 'week' の新しいオプションオブジェクトを渡すが、
    // エンジンは初回生成のまま維持され、view は変わらないはず。
    rerender({ initialView: 'week' });

    expect(result.current.api).toBe(firstApi);
    expect(result.current.state.view).toBe('month');
  });

  it('状態が変わらない再レンダーでは戻り値オブジェクトの参照が同一になる', () => {
    const { result, rerender } = renderHook(() =>
      useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW }),
    );

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });

  it('onEventsChange は常に最新のクロージャで呼ばれる', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const { result, rerender } = renderHook(
      (props: { onEventsChange: (events: readonly CalendarEvent[]) => void }) =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          onEventsChange: props.onEventsChange,
        }),
      { initialProps: { onEventsChange: firstHandler } },
    );

    rerender({ onEventsChange: secondHandler });

    act(() => {
      result.current.api.createEvent({ title: '新規予定', start: '2026-07-15T10:00' });
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it('onRangeChange は常に最新のクロージャで呼ばれる', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const { result, rerender } = renderHook(
      (props: { onRangeChange: (info: CalendarRangeChangeInfo) => void }) =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          onRangeChange: props.onRangeChange,
        }),
      { initialProps: { onRangeChange: firstHandler } },
    );

    // マウント時に 1 回発火するため、差し替え前の呼び出し回数をクリアしておく
    firstHandler.mockClear();

    rerender({ onRangeChange: secondHandler });

    act(() => {
      result.current.api.next();
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it('refreshSeconds を指定すると時間経過で viewModel が再構築される（現在時刻線の追従）', () => {
    vi.useFakeTimers();
    try {
      let current = new Date('2026-07-15T01:00:00Z'); // 東京 10:00
      const { result } = renderHook(() =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          initialDate: new Date('2026-07-15T01:00:00Z'),
          initialView: 'week',
          now: () => current,
          refreshSeconds: 60,
        }),
      );

      const vmBefore = result.current.viewModel;
      if (vmBefore.type !== 'timeGrid') throw new Error('unreachable');
      expect(vmBefore.nowIndicator?.minutes).toBe(600);

      current = new Date('2026-07-15T01:05:00Z'); // 東京 10:05
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      const vmAfter = result.current.viewModel;
      if (vmAfter.type !== 'timeGrid') throw new Error('unreachable');
      expect(vmAfter.nowIndicator?.minutes).toBe(605);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshSeconds が NaN のときは自動更新タイマーを張らない（暴走ループ防止）', () => {
    vi.useFakeTimers();
    try {
      let refreshCount = 0;
      let current = new Date('2026-07-15T01:00:00Z');
      renderHook(() =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          initialDate: new Date('2026-07-15T01:00:00Z'),
          initialView: 'week',
          now: () => {
            // viewModel 構築のたびに呼ばれる。タイマー起因の再構築を検出するため
            // 進行させた時間の中で now が繰り返し呼ばれ続けないことを確認する。
            refreshCount += 1;
            return current;
          },
          refreshSeconds: Number.NaN,
        }),
      );
      const baseline = refreshCount;
      current = new Date('2026-07-15T01:05:00Z');
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // NaN では setInterval を張らないため、時間を進めても追加の refresh は起きない
      expect(refreshCount).toBe(baseline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SSR（renderToString）でも例外にならず初期状態を描画できる', () => {
    function ServerComponent(): ReactElement {
      const calendar = useCalendar({
        timeZone: 'Asia/Tokyo',
        now: () => NOW,
        initialDate: NOW,
        initialView: 'week',
      });
      return <div>{calendar.state.view}</div>;
    }

    const html = renderToString(<ServerComponent />);

    expect(html).toContain('week');
  });

  describe('onRangeChange の初期通知（マウント後）', () => {
    it('SSR（renderToString）中は onRangeChange が一度も呼ばれない', () => {
      const onRangeChange = vi.fn();
      function ServerComponent(): ReactElement {
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          onRangeChange,
        });
        return <div />;
      }

      renderToString(<ServerComponent />);

      expect(onRangeChange).not.toHaveBeenCalled();
    });

    it('マウント後（act 完了後）に初期通知が 1 回届き、view・currentDate・表示範囲が正しい', () => {
      const onRangeChange = vi.fn();

      const { result } = renderHook(() =>
        useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, onRangeChange }),
      );

      expect(onRangeChange).toHaveBeenCalledTimes(1);
      const range = result.current.api.getVisibleRange();
      expect(onRangeChange.mock.calls[0]?.[0]).toEqual({
        view: 'month',
        currentDate: result.current.state.currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
    });

    it('マウント後に api.next() を呼ぶと通知が届く（既存挙動の回帰確認）', () => {
      const onRangeChange = vi.fn();

      const { result } = renderHook(() =>
        useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, onRangeChange }),
      );
      onRangeChange.mockClear();

      act(() => {
        result.current.api.next();
      });

      expect(onRangeChange).toHaveBeenCalledTimes(1);
      expect(onRangeChange.mock.calls[0]?.[0]).toMatchObject({ view: 'month' });
    });

    it('StrictMode でラップしても例外・警告なく動作し、通知は 1 回以上・内容はすべて正しい', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onRangeChange = vi.fn();

      function Wrapper({ children }: { children: ReactNode }): ReactElement {
        return <StrictMode>{children}</StrictMode>;
      }

      const { result } = renderHook(
        () =>
          useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, onRangeChange }),
        { wrapper: Wrapper },
      );

      expect(onRangeChange.mock.calls.length).toBeGreaterThanOrEqual(1);
      const range = result.current.api.getVisibleRange();
      const expectedInfo = {
        view: 'month',
        currentDate: result.current.state.currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      };
      for (const call of onRangeChange.mock.calls) {
        expect(call[0]).toEqual(expectedInfo);
      }
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('onRangeChange 内で setState しても console.error の警告が出ない（レンダー中の副作用ではないため）', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      function TestComponent(): ReactElement {
        const [, setTick] = useState(0);
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          onRangeChange: () => {
            setTick((t) => t + 1);
          },
        });
        return <div />;
      }

      render(<TestComponent />);

      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  describe('開発時警告', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('マウント後に異なる events 配列を渡すと console.warn で一度だけ警告する', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const initialEvents: readonly CalendarEvent[] = [
        { id: '1', title: '初期', start: '2026-07-15T10:00' },
      ];
      const nextEvents: readonly CalendarEvent[] = [
        { id: '2', title: '更新', start: '2026-07-16T10:00' },
      ];

      const { rerender } = renderHook(
        (props: { events: readonly CalendarEvent[] }) =>
          useCalendar({
            timeZone: 'Asia/Tokyo',
            now: () => NOW,
            initialDate: NOW,
            events: props.events,
          }),
        { initialProps: { events: initialEvents } },
      );

      expect(warn).not.toHaveBeenCalled();

      rerender({ events: nextEvents });
      rerender({ events: nextEvents });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('setEvents');
    });

    it('マウント後に異なる resources 配列を渡すと console.warn で一度だけ警告する', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const initialResources: readonly CalendarResource[] = [{ id: 'room-1', title: '会議室A' }];
      const nextResources: readonly CalendarResource[] = [{ id: 'room-2', title: '会議室B' }];

      const { rerender } = renderHook(
        (props: { resources: readonly CalendarResource[] }) =>
          useCalendar({
            timeZone: 'Asia/Tokyo',
            now: () => NOW,
            initialDate: NOW,
            resources: props.resources,
          }),
        { initialProps: { resources: initialResources } },
      );

      expect(warn).not.toHaveBeenCalled();

      rerender({ resources: nextResources });
      rerender({ resources: nextResources });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('setResources');
    });

    it('event.color が既定前景色と WCAG AA を満たさないと console.warn する', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events: readonly CalendarEvent[] = [
        { id: '1', title: '黄色い予定', start: '2026-07-15T10:00', color: '#ffff00' },
      ];

      renderHook(() =>
        useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, events }),
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('#ffff00');
    });

    it('resource.color が既定前景色と WCAG AA を満たさないと console.warn する', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const resources: readonly CalendarResource[] = [
        { id: 'room-1', title: '会議室A', color: '#ffff00' },
      ];

      renderHook(() =>
        useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'resource',
          resources,
        }),
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('#ffff00');
    });

    it('event.color が WCAG AA を満たす色なら警告しない', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events: readonly CalendarEvent[] = [
        { id: '1', title: '予定', start: '2026-07-15T10:00', color: '#14608f' },
      ];

      renderHook(() =>
        useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, events }),
      );

      expect(warn).not.toHaveBeenCalled();
    });

    it('同じ色を持つ複数の予定が再レンダリングを跨いでも、色ごとに一度しか警告しない', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events: readonly CalendarEvent[] = [
        { id: '1', title: '黄色い予定1', start: '2026-07-15T10:00', color: '#ffff00' },
        { id: '2', title: '黄色い予定2', start: '2026-07-15T12:00', color: '#ffff00' },
      ];

      const { rerender } = renderHook(
        () => useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW, events }),
        { initialProps: {} },
      );
      rerender();

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('マウント後に api.setEvents で追加した予定の色も判定される', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useCalendar({ timeZone: 'Asia/Tokyo', now: () => NOW, initialDate: NOW }),
      );

      expect(warn).not.toHaveBeenCalled();

      act(() => {
        result.current.api.setEvents([
          { id: '1', title: '黄色い予定', start: '2026-07-15T10:00', color: '#ffff00' },
        ]);
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('#ffff00');
    });
  });
});
