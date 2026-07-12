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
import type { CalendarViewType } from '../core/types';
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

  it('Alt 修飾キー付きは無視される', () => {
    const calendar = makeCalendar();
    calendar.api.setView('week');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('m', { altKey: true });

    expect(calendar.api.getState().view).toBe('week');
  });

  it('Cmd（Meta）修飾キー付きは無視される', () => {
    const calendar = makeCalendar();
    calendar.api.setView('week');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('m', { metaKey: true });

    expect(calendar.api.getState().view).toBe('week');
  });

  it('既定では y キーは無効（ビューが変わらず、preventDefault もされない）', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    let defaultPrevented: boolean | null = null;
    function captureListener(event: KeyboardEvent): void {
      defaultPrevented = event.defaultPrevented;
    }
    document.addEventListener('keydown', captureListener);
    pressKey('y');
    document.removeEventListener('keydown', captureListener);

    expect(calendar.api.getState().view).toBe('month');
    expect(defaultPrevented).toBe(false);
  });

  it("views に 'year' を含めると y キーで年ビューへ切り替わる", () => {
    const calendar = makeCalendar();
    renderHook(() =>
      useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'year'] }),
    );

    pressKey('y');

    expect(calendar.api.getState().view).toBe('year');
  });

  it('既定では q キーは無効（ビューが変わらず、preventDefault もされない）', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    let defaultPrevented: boolean | null = null;
    function captureListener(event: KeyboardEvent): void {
      defaultPrevented = event.defaultPrevented;
    }
    document.addEventListener('keydown', captureListener);
    pressKey('q');
    document.removeEventListener('keydown', captureListener);

    expect(calendar.api.getState().view).toBe('month');
    expect(defaultPrevented).toBe(false);
  });

  it("views に 'multiMonth' を含めると q キーで複数月ビューへ切り替わる", () => {
    const calendar = makeCalendar();
    renderHook(() =>
      useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'multiMonth'] }),
    );

    pressKey('q');

    expect(calendar.api.getState().view).toBe('multiMonth');
  });

  it('既定では r キーは無効（ビューが変わらず、preventDefault もされない）', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    let defaultPrevented: boolean | null = null;
    function captureListener(event: KeyboardEvent): void {
      defaultPrevented = event.defaultPrevented;
    }
    document.addEventListener('keydown', captureListener);
    pressKey('r');
    document.removeEventListener('keydown', captureListener);

    expect(calendar.api.getState().view).toBe('month');
    expect(defaultPrevented).toBe(false);
  });

  it("views に 'resource' を含めると r キーでリソースビューへ切り替わる", () => {
    const calendar = makeCalendar();
    renderHook(() =>
      useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'resource'] }),
    );

    pressKey('r');

    expect(calendar.api.getState().view).toBe('resource');
  });

  it('既定では l キーは無効（ビューが変わらず、preventDefault もされない）', () => {
    const calendar = makeCalendar();
    renderHook(() => useCalendarShortcuts({ calendar }));

    let defaultPrevented: boolean | null = null;
    function captureListener(event: KeyboardEvent): void {
      defaultPrevented = event.defaultPrevented;
    }
    document.addEventListener('keydown', captureListener);
    pressKey('l');
    document.removeEventListener('keydown', captureListener);

    expect(calendar.api.getState().view).toBe('month');
    expect(defaultPrevented).toBe(false);
  });

  it("views に 'timeline' を含めると l キーでタイムラインビューへ切り替わる", () => {
    const calendar = makeCalendar();
    renderHook(() =>
      useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'timeline'] }),
    );

    pressKey('l');

    expect(calendar.api.getState().view).toBe('timeline');
  });

  it('views に resource / timeline を追加しても既存の M/W/D/A/T の挙動は変わらない（回帰ガード）', () => {
    const calendar = makeCalendar();
    calendar.api.goTo(new Date('2026-01-01T00:00:00Z'));
    renderHook(() =>
      useCalendarShortcuts({
        calendar,
        views: ['month', 'week', 'day', 'list', 'resource', 'timeline'],
      }),
    );

    pressKey('w');
    expect(calendar.api.getState().view).toBe('week');

    pressKey('d');
    expect(calendar.api.getState().view).toBe('day');

    pressKey('a');
    expect(calendar.api.getState().view).toBe('list');

    pressKey('m');
    expect(calendar.api.getState().view).toBe('month');

    pressKey('t');
    const { currentDate, timeZone } = calendar.api.getState();
    // NOW（2026-07-15 東京）に戻っていること
    expect(new Intl.DateTimeFormat('en-CA', { timeZone }).format(currentDate)).toBe('2026-07-15');
  });

  it('views に year を追加しても既存の M/W/D/A/T の挙動は変わらない（回帰ガード）', () => {
    const calendar = makeCalendar();
    calendar.api.goTo(new Date('2026-01-01T00:00:00Z'));
    renderHook(() =>
      useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'year'] }),
    );

    pressKey('w');
    expect(calendar.api.getState().view).toBe('week');

    pressKey('d');
    expect(calendar.api.getState().view).toBe('day');

    pressKey('a');
    expect(calendar.api.getState().view).toBe('list');

    pressKey('m');
    expect(calendar.api.getState().view).toBe('month');

    pressKey('t');
    const { currentDate, timeZone } = calendar.api.getState();
    // NOW（2026-07-15 東京）に戻っていること
    expect(new Intl.DateTimeFormat('en-CA', { timeZone }).format(currentDate)).toBe('2026-07-15');
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

  it('textarea にフォーカス中は無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('select にフォーカス中は無視される', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const select = document.createElement('select');
    document.body.appendChild(select);
    select.focus();
    fireEvent.keyDown(select, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(select);
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

  it('onCreate / views の参照が変わっても keydown リスナーは再登録されない', () => {
    const calendar = makeCalendar();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { rerender } = renderHook(
      (props: { onCreate: () => void; views: readonly CalendarViewType[] }) =>
        useCalendarShortcuts({ calendar, onCreate: props.onCreate, views: props.views }),
      {
        initialProps: {
          onCreate: () => {},
          views: ['month', 'week', 'day', 'list'] as readonly CalendarViewType[],
        },
      },
    );

    const keydownAddCallsBefore = addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(keydownAddCallsBefore).toBe(1);

    // onCreate・views をそれぞれ新しい参照（インラインで書いた場合の典型例）に差し替えて再レンダー
    rerender({
      onCreate: () => {},
      views: ['month', 'week', 'day', 'list'] as readonly CalendarViewType[],
    });

    const keydownAddCallsAfter = addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
    const keydownRemoveCallsAfter = removeSpy.mock.calls.filter(
      ([type]) => type === 'keydown',
    ).length;

    // 依存が [api, enabled] のみになっていれば、参照が変わっても再登録は起きない
    expect(keydownAddCallsAfter).toBe(1);
    expect(keydownRemoveCallsAfter).toBe(0);
  });

  it('onCreate の参照が変わっても、再登録なしで常に最新のクロージャが呼ばれる', () => {
    const calendar = makeCalendar();
    const firstOnCreate = vi.fn();
    const secondOnCreate = vi.fn();

    const { rerender } = renderHook(
      (props: { onCreate: () => void }) =>
        useCalendarShortcuts({ calendar, onCreate: props.onCreate }),
      { initialProps: { onCreate: firstOnCreate } },
    );

    rerender({ onCreate: secondOnCreate });
    pressKey('c');

    expect(firstOnCreate).not.toHaveBeenCalled();
    expect(secondOnCreate).toHaveBeenCalledTimes(1);
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
