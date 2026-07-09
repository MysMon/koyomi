/**
 * @packageDocumentation
 * `useCalendarShortcuts` のテスト。
 *
 * `document` への `keydown` ディスパッチで各ショートカットが
 * 対応する `CalendarApi` 操作を呼び出すこと、入力欄フォーカス中や
 * `enabled: false` では無効化されることを検証する。
 */

import { fireEvent, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import type { UseCalendarResult } from './types';
import { useCalendarShortcuts } from './use-calendar-shortcuts';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** 固定時刻・東京 TZ の `UseCalendarResult` 相当のオブジェクトを作るヘルパ。 */
function makeCalendar(overrides?: Parameters<typeof createCalendar>[0]): UseCalendarResult {
  const api = createCalendar({
    timeZone: 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    initialView: 'month',
    ...overrides,
  });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

/** `document.body` に対して keydown イベントを発火するヘルパ。 */
function pressKey(key: string, init?: KeyboardEventInit): void {
  fireEvent.keyDown(document.body, { key, ...init });
}

describe('useCalendarShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('m / w / d / a キーでビューが切り替わる', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('w');
    expect(calendar.api.getState().view).toBe('week');

    pressKey('d');
    expect(calendar.api.getState().view).toBe('day');

    pressKey('a');
    expect(calendar.api.getState().view).toBe('list');

    pressKey('m');
    expect(calendar.api.getState().view).toBe('month');
  });

  it('t キーで今日（現在時刻の日）に移動する', () => {
    const calendar = makeCalendar();
    calendar.api.goTo(new Date('2026-01-01T00:00:00Z'));
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('t');

    const { currentDate, timeZone } = calendar.api.getState();
    // NOW（2026-07-15 東京）に戻っていること
    expect(new Intl.DateTimeFormat('en-CA', { timeZone }).format(currentDate)).toBe('2026-07-15');
  });

  it('j / n キーで次の期間、k / p キーで前の期間に移動する', () => {
    const calendar = makeCalendar();
    const nextSpy = vi.spyOn(calendar.api, 'next');
    const prevSpy = vi.spyOn(calendar.api, 'prev');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('j');
    pressKey('n');
    pressKey('k');
    pressKey('p');

    expect(nextSpy).toHaveBeenCalledTimes(2);
    expect(prevSpy).toHaveBeenCalledTimes(2);
  });

  it('大文字キー（M）でもビュー切替が効く', () => {
    const calendar = makeCalendar();
    calendar.api.setView('day');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('W');

    expect(calendar.api.getState().view).toBe('week');
  });

  it('Ctrl 修飾キー付きは無視される', () => {
    const calendar = makeCalendar();
    calendar.api.setView('week');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('m', { ctrlKey: true });

    expect(calendar.api.getState().view).toBe('week');
  });

  it('無関係なキーは無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    const todaySpy = vi.spyOn(calendar.api, 'today');
    const nextSpy = vi.spyOn(calendar.api, 'next');
    const prevSpy = vi.spyOn(calendar.api, 'prev');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('z');
    pressKey('Enter');

    expect(setViewSpy).not.toHaveBeenCalled();
    expect(todaySpy).not.toHaveBeenCalled();
    expect(nextSpy).not.toHaveBeenCalled();
    expect(prevSpy).not.toHaveBeenCalled();
  });

  it('input にフォーカス中（target が input）は無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('contentEditable 要素の内側では無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const editable = document.createElement('div');
    // jsdom は `contentEditable` プロパティを属性に反映しないため、
    // `closest` で検出できるよう属性を直接設定する（実ブラウザではプロパティ代入でも反映される）
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);

    fireEvent.keyDown(inner, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(editable);
  });

  it('contenteditable="" （値省略）の要素内でも無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', '');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);

    fireEvent.keyDown(inner, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(editable);
  });

  it('contenteditable="TRUE"（大文字）の要素内でも無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'TRUE');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);

    fireEvent.keyDown(inner, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(editable);
  });

  it('contenteditable="FALSE"（大文字の "false"）の要素内ではショートカットが効く', () => {
    const calendar = makeCalendar();
    calendar.api.setView('day');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const notEditable = document.createElement('div');
    notEditable.setAttribute('contenteditable', 'FALSE');
    const inner = document.createElement('span');
    notEditable.appendChild(inner);
    document.body.appendChild(notEditable);

    fireEvent.keyDown(inner, { key: 'w' });

    expect(calendar.api.getState().view).toBe('week');

    document.body.removeChild(notEditable);
  });

  it('c キーで onCreate が呼ばれる', () => {
    const calendar = makeCalendar();
    const onCreate = vi.fn();
    renderHook(() => useCalendarShortcuts({ calendar, onCreate }));

    pressKey('c');

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('onCreate 未指定で c キーを押しても何も起きない（例外にならない）', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    expect(() => pressKey('c')).not.toThrow();
  });

  it('enabled: false のときは反応しない', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar, enabled: false }));

    pressKey('w');

    expect(setViewSpy).not.toHaveBeenCalled();
    expect(calendar.api.getState().view).toBe('month');
  });

  it('アンマウント後はリスナーが解除され反応しない', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    const { unmount } = renderHook(() => useCalendarShortcuts({ calendar }));

    unmount();
    pressKey('w');

    expect(setViewSpy).not.toHaveBeenCalled();
  });

  it('コンポーネントツリー内での使用でも動作する（React コンポーネント経由）', () => {
    const calendar = makeCalendar();

    function TestComponent(): ReturnType<typeof createElement> {
      useCalendarShortcuts({ calendar });
      return createElement('div', null, calendar.api.getState().view);
    }

    render(createElement(TestComponent));

    pressKey('d');

    expect(calendar.api.getState().view).toBe('day');
  });
});
