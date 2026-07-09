import { act, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../core/types';
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
  });
});
