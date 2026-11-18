import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarInteractionCallbacks } from '../types';
import { useStableHandlers } from './stable-handlers';

/** テスト用のハンドラ集（参照の同一性だけを見る）。 */
interface Handlers {
  id: number;
}

/** 呼び出しのたびに新しいハンドラ集を返す `create` を作る。 */
function makeCreate() {
  let next = 0;
  return vi.fn((): Handlers => {
    next += 1;
    return { id: next };
  });
}

describe('useStableHandlers', () => {
  it('callbacks が同じ参照のままの再レンダーでは、同じ参照を返し create も呼び直さない（memo の再レンダー抑制のための固定）', () => {
    const create = makeCreate();
    const callbacks: CalendarInteractionCallbacks = {};
    const { result, rerender } = renderHook(() => useStableHandlers(create, callbacks));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('追加通知コールバックの関数が差し替わっただけ（指定の有無は同じ）なら、同じ参照を返す', () => {
    const create = makeCreate();
    const { result, rerender } = renderHook(
      (callbacks: CalendarInteractionCallbacks) => useStableHandlers(create, callbacks),
      { initialProps: { onEventDoubleClick: () => {} } },
    );
    const first = result.current;

    rerender({ onEventDoubleClick: () => {} });

    expect(result.current).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('追加通知以外のコールバック（onEventClick）の追加では、同じ参照を返す', () => {
    const create = makeCreate();
    const { result, rerender } = renderHook(
      (callbacks: CalendarInteractionCallbacks) => useStableHandlers(create, callbacks),
      { initialProps: {} },
    );
    const first = result.current;

    rerender({ onEventClick: () => {} });

    expect(result.current).toBe(first);
  });

  it('追加通知コールバックが追加されると、新しい参照を返す', () => {
    const create = makeCreate();
    const { result, rerender } = renderHook(
      (callbacks: CalendarInteractionCallbacks) => useStableHandlers(create, callbacks),
      { initialProps: {} },
    );
    const first = result.current;

    rerender({ onEventContextMenu: () => {} });

    expect(result.current).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('追加通知コールバックが削除されると、新しい参照を返す', () => {
    const create = makeCreate();
    const withHover: CalendarInteractionCallbacks = { onEventHover: () => {} };
    const { result, rerender } = renderHook(
      (callbacks: CalendarInteractionCallbacks) => useStableHandlers(create, callbacks),
      { initialProps: withHover },
    );
    const first = result.current;

    rerender({});

    expect(result.current).not.toBe(first);
  });

  it('callbacks が undefined でも動作し、空オブジェクトへの変更では参照を保つ', () => {
    const create = makeCreate();
    const { result, rerender } = renderHook(
      (callbacks: CalendarInteractionCallbacks | undefined) => useStableHandlers(create, callbacks),
      { initialProps: undefined },
    );
    const first = result.current;

    rerender({});

    expect(result.current).toBe(first);
  });
});
