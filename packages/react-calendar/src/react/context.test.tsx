import { render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { CalendarProvider, useCalendarContext } from './context';
import { enMessages } from './locales/en';
import { jaMessages } from './locales/ja';
import type { CalendarContextValue, UseCalendarResult } from './types';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** テスト用に `useCalendar` を経由せず `UseCalendarResult` 相当を組み立てる。 */
function makeCalendarResult(locale?: string): UseCalendarResult {
  const api = createCalendar({
    timeZone: 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    ...(locale !== undefined ? { locale } : {}),
  });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

describe('CalendarProvider / useCalendarContext', () => {
  it('Provider 配下では value と callbacks（既定は {}）を返す', () => {
    const value = makeCalendarResult();

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
      return <CalendarProvider value={value}>{children}</CalendarProvider>;
    }

    const { result } = renderHook(() => useCalendarContext(), { wrapper });

    expect(result.current.api).toBe(value.api);
    expect(result.current.state).toBe(value.state);
    expect(result.current.viewModel).toBe(value.viewModel);
    expect(result.current.callbacks).toEqual({});
  });

  it('callbacks を渡すとそのまま提供される', () => {
    const value = makeCalendarResult();
    const onEventClick = vi.fn();

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
      return (
        <CalendarProvider value={value} callbacks={{ onEventClick }}>
          {children}
        </CalendarProvider>
      );
    }

    const { result } = renderHook(() => useCalendarContext(), { wrapper });

    expect(result.current.callbacks.onEventClick).toBe(onEventClick);
  });

  it('プロバイダ外で呼ぶと日本語メッセージの Error を投げる', () => {
    expect(() => renderHook(() => useCalendarContext())).toThrow(/CalendarProvider/);
  });

  it('value を新しいオブジェクトで包み直しても中身が同じならコンテキスト値の参照が変わらない', () => {
    const value = makeCalendarResult();
    const callbacks = { onEventClick: vi.fn() };
    const captured: CalendarContextValue[] = [];

    /** コンテキスト値を取得のたびに記録するだけのプローブコンポーネント。 */
    function ContextProbe(): null {
      captured.push(useCalendarContext());
      return null;
    }

    const { rerender } = render(
      <CalendarProvider value={value} callbacks={callbacks}>
        <ContextProbe />
      </CalendarProvider>,
    );

    // api/state/viewModel の中身は同じだが、包む外側のオブジェクトは新規生成する。
    const rewrapped: UseCalendarResult = {
      api: value.api,
      state: value.state,
      viewModel: value.viewModel,
    };

    rerender(
      <CalendarProvider value={rewrapped} callbacks={callbacks}>
        <ContextProbe />
      </CalendarProvider>,
    );

    expect(captured).toHaveLength(2);
    expect(captured[1]).toBe(captured[0]);
  });

  it('messages を省略すると options.locale（既定 ja）の既定カタログを提供する', () => {
    const value = makeCalendarResult();

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
      return <CalendarProvider value={value}>{children}</CalendarProvider>;
    }

    const { result } = renderHook(() => useCalendarContext(), { wrapper });

    expect(result.current.messages).toEqual(jaMessages);
  });

  it('options.locale が en-US のとき messages を省略すると英語カタログを提供する', () => {
    const value = makeCalendarResult('en-US');

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
      return <CalendarProvider value={value}>{children}</CalendarProvider>;
    }

    const { result } = renderHook(() => useCalendarContext(), { wrapper });

    expect(result.current.messages).toEqual(enMessages);
  });

  it('messages で一部のグループ・リーフだけを部分上書きできる', () => {
    const value = makeCalendarResult();

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
      return (
        <CalendarProvider value={value} messages={{ toolbar: { today: 'Heute' } }}>
          {children}
        </CalendarProvider>
      );
    }

    const { result } = renderHook(() => useCalendarContext(), { wrapper });

    expect(result.current.messages.toolbar.today).toBe('Heute');
    expect(result.current.messages.toolbar.prev).toBe(jaMessages.toolbar.prev);
    expect(result.current.messages.month).toEqual(jaMessages.month);
  });

  it('state.options.locale が変わらず messages 参照も変わらなければコンテキスト値の参照が変わらない', () => {
    const value = makeCalendarResult();
    const messages = { toolbar: { today: 'Heute' } };
    const captured: CalendarContextValue[] = [];

    /** コンテキスト値を取得のたびに記録するだけのプローブコンポーネント。 */
    function ContextProbe(): null {
      captured.push(useCalendarContext());
      return null;
    }

    const { rerender } = render(
      <CalendarProvider value={value} messages={messages}>
        <ContextProbe />
      </CalendarProvider>,
    );

    const rewrapped: UseCalendarResult = {
      api: value.api,
      state: value.state,
      viewModel: value.viewModel,
    };

    rerender(
      <CalendarProvider value={rewrapped} messages={messages}>
        <ContextProbe />
      </CalendarProvider>,
    );

    expect(captured).toHaveLength(2);
    expect(captured[1]).toBe(captured[0]);
  });
});
