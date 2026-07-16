/**
 * @packageDocumentation
 * `useCalendarHistory` のテスト。
 *
 * `calendar` は多くのテストで（`useCalendarShortcuts` のテストと同じ方針で）
 * `createCalendar` を直接使った安定な `UseCalendarResult` 相当のオブジェクトを渡す
 * （`useCalendarHistory` は `calendar.api` のみを使うため、`useCalendar` 経由の
 * 購読は不要）。`calendar.state` の更新まで検証する結合テストのみ `useCalendar` を使う。
 */
import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, EventChangeEntry } from '../core/types';
import type { UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import { useCalendarHistory } from './use-calendar-history';

/** テスト用の最小イベント。 */
function ev(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `イベント${id}`,
    start: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

/** 固定タイムゾーンの `UseCalendarResult` 相当のオブジェクトを作るヘルパ。 */
function makeCalendar(events: readonly CalendarEvent[] = []): UseCalendarResult {
  const api = createCalendar({ timeZone: 'Asia/Tokyo', events });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

/** `document.body` に対して keydown イベントを発火するヘルパ。 */
function pressKey(key: string, init?: KeyboardEventInit): void {
  fireEvent.keyDown(document.body, { key, ...init });
}

/** 1 件のイベントを 1 回だけ変更する `EventChangeEntry` のセット。 */
function makeChangeEntry(): readonly EventChangeEntry[] {
  return [{ before: ev('a', { title: '変更前' }), after: ev('a', { title: '変更後' }) }];
}

describe('useCalendarHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初期状態で canUndo=canRedo=false', () => {
    const calendar = makeCalendar([ev('a')]);
    const { result } = renderHook(() => useCalendarHistory({ calendar }));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('push後にcanUndoがtrueになり、undo()呼び出しでcalendar.state.eventsが正しく変化する（useCalendarと組み合わせたjsdom結合テスト）', () => {
    const { result } = renderHook(() => {
      const calendar = useCalendar({
        timeZone: 'Asia/Tokyo',
        events: [ev('a', { title: '変更後' })],
      });
      const history = useCalendarHistory({ calendar });
      return { calendar, history };
    });

    act(() => {
      result.current.history.push(makeChangeEntry());
    });
    expect(result.current.history.canUndo).toBe(true);

    act(() => {
      result.current.history.undo();
    });

    expect(result.current.calendar.state.events).toEqual([ev('a', { title: '変更前' })]);
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(true);
  });

  it('limitオプションを超えるpushで最古のエントリが破棄される', () => {
    // undo（'before' 方向）は creation-only エントリの対象 id が現在の一覧に
    // 存在することを前提にする（presence-only のドリフト検出）ため、
    // 実際に a/b を含む状態から始める
    const calendar = makeCalendar([ev('a'), ev('b')]);
    const { result } = renderHook(() => useCalendarHistory({ calendar, limit: 1 }));

    act(() => {
      result.current.push([{ after: ev('a') }]);
      result.current.push([{ after: ev('b') }]);
    });

    let firstUndo = false;
    act(() => {
      firstUndo = result.current.undo();
    });
    expect(firstUndo).toBe(true);

    let secondUndo = true;
    act(() => {
      secondUndo = result.current.undo();
    });
    expect(secondUndo).toBe(false);
  });

  it('keyboardShortcuts省略（既定false）のときCtrl+Zをdispatchしてもundoが呼ばれない', () => {
    const calendar = makeCalendar([ev('a', { title: '変更後' })]);
    const setEventsSpy = vi.spyOn(calendar.api, 'setEvents');
    const { result } = renderHook(() => useCalendarHistory({ calendar }));
    act(() => {
      result.current.push(makeChangeEntry());
    });

    pressKey('z', { ctrlKey: true });

    expect(setEventsSpy).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
  });

  it('keyboardShortcuts:trueでCtrl+Zがundoを、Ctrl+Shift+ZおよびCtrl+Yがredoを呼ぶ', () => {
    const calendar = makeCalendar([ev('a', { title: '変更後' })]);
    const { result } = renderHook(() => useCalendarHistory({ calendar, keyboardShortcuts: true }));
    act(() => {
      result.current.push(makeChangeEntry());
    });

    pressKey('z', { ctrlKey: true });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    pressKey('z', { ctrlKey: true, shiftKey: true });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    pressKey('z', { ctrlKey: true });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    pressKey('y', { ctrlKey: true });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('keyboardShortcuts:trueでCmd（Meta）修飾キーでも同様にundo/redoが呼ばれる（macOS 相当）', () => {
    const calendar = makeCalendar([ev('a', { title: '変更後' })]);
    const { result } = renderHook(() => useCalendarHistory({ calendar, keyboardShortcuts: true }));
    act(() => {
      result.current.push(makeChangeEntry());
    });

    pressKey('z', { metaKey: true });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    pressKey('z', { metaKey: true, shiftKey: true });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('keyboardShortcuts:true でも input 要素にフォーカスがある間はCtrl+Zが無視される', () => {
    const calendar = makeCalendar([ev('a', { title: '変更後' })]);
    const { result } = renderHook(() => useCalendarHistory({ calendar, keyboardShortcuts: true }));
    act(() => {
      result.current.push(makeChangeEntry());
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

    expect(result.current.canUndo).toBe(true);

    document.body.removeChild(input);
  });

  it('アンマウント時にkeydownリスナーが解除される（再マウント後に多重発火しない）', () => {
    const calendar = makeCalendar([ev('a', { title: '変更後' })]);
    const setEventsSpy = vi.spyOn(calendar.api, 'setEvents');
    const { result, unmount } = renderHook(() =>
      useCalendarHistory({ calendar, keyboardShortcuts: true }),
    );
    act(() => {
      result.current.push(makeChangeEntry());
    });

    unmount();
    pressKey('z', { ctrlKey: true });

    expect(setEventsSpy).not.toHaveBeenCalled();
  });

  it('push/undo/redo/clearの関数参照が再レンダーをまたいで安定している', () => {
    const calendar = makeCalendar([ev('a')]);
    const { result, rerender } = renderHook(() => useCalendarHistory({ calendar }));
    const first = {
      push: result.current.push,
      undo: result.current.undo,
      redo: result.current.redo,
      clear: result.current.clear,
    };

    rerender();

    expect(result.current.push).toBe(first.push);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.redo).toBe(first.redo);
    expect(result.current.clear).toBe(first.clear);
  });
});
