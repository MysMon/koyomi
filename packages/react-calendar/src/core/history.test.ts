/**
 * @packageDocumentation
 * `createEventHistory` のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `CalendarApi` は実際の `createCalendar` を使い、必要な箇所のみ `vi.spyOn` で監視する
 * （既存の `useCalendarShortcuts` 等のテストと同じ方針）。
 */
import { describe, expect, it, vi } from 'vitest';
import { createCalendar } from './calendar';
import { createEventHistory } from './history';
import { applyEventChangeEntries } from './mutations';
import type { CalendarEvent, EventChangeEntry } from './types';

/** テスト用の最小イベント。 */
function ev(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `イベント${id}`,
    start: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

/** テスト用に固定タイムゾーンの `createCalendar` を作るヘルパ。 */
function makeApi(events: readonly CalendarEvent[]) {
  return createCalendar({ timeZone: 'Asia/Tokyo', events });
}

describe('createEventHistory: push', () => {
  it('push([]) は canUndo/canRedo を変えず subscribe も呼ばない', () => {
    const api = makeApi([]);
    const history = createEventHistory({ api });
    const listener = vi.fn();
    history.subscribe(listener);

    history.push([]);

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('push(changes) 後は canUndo=true・canRedo=false になる', () => {
    const api = makeApi([ev('a')]);
    const history = createEventHistory({ api });
    const listener = vi.fn();
    history.subscribe(listener);

    history.push([{ before: ev('a', { title: '変更前' }), after: ev('a') }]);

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('push は直前の undo による redoStack を破棄する（push 後に canRedo=false）', () => {
    const api = makeApi([ev('a')]);
    const history = createEventHistory({ api });
    const changes: readonly EventChangeEntry[] = [
      { before: ev('a', { title: '変更前' }), after: ev('a') },
    ];

    history.push(changes);
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push([{ before: ev('b', { title: 'b-変更前' }), after: ev('b') }]);

    expect(history.canRedo()).toBe(false);
  });

  it('limit 件を超えて push すると最古のエントリが破棄される（limit+1 回目の push 後、undo は limit 回しか実行できない）', () => {
    const api = makeApi([]);
    const history = createEventHistory({ api, limit: 2 });

    history.push([{ after: ev('a') }]);
    history.push([{ after: ev('b') }]);
    history.push([{ after: ev('c') }]);

    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
  });

  it('limit 省略時の既定は 100（101 回 push すると undo は 100 回しか実行できない）', () => {
    const api = makeApi([]);
    const history = createEventHistory({ api });

    for (let index = 0; index < 101; index += 1) {
      history.push([{ after: ev(`e${index}`) }]);
    }

    let undoCount = 0;
    while (history.undo()) {
      undoCount += 1;
    }
    expect(undoCount).toBe(100);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('limit に %s を指定すると 1 にクランプされる（2 回目の push で最古のエントリが破棄される）', (limit) => {
    const api = makeApi([]);
    const history = createEventHistory({ api, limit });

    history.push([{ after: ev('a') }]);
    history.push([{ after: ev('b') }]);

    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
  });
});

describe('createEventHistory: undo/redo', () => {
  it('履歴が空のとき undo()/redo() は false を返し setEvents を呼ばない', () => {
    const api = makeApi([ev('a')]);
    const setEventsSpy = vi.spyOn(api, 'setEvents');
    const history = createEventHistory({ api });

    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(setEventsSpy).not.toHaveBeenCalled();
  });

  it("undo() は true を返し、api.setEvents が applyEventChangeEntries(events, changes, 'before') 相当の配列で呼ばれる", () => {
    const before = ev('a', { title: '変更前' });
    const after = ev('a', { title: '変更後' });
    const api = makeApi([after]);
    const history = createEventHistory({ api });
    const changes: readonly EventChangeEntry[] = [{ before, after }];
    history.push(changes);
    const eventsSnapshot = api.getEvents();
    const setEventsSpy = vi.spyOn(api, 'setEvents');

    const result = history.undo();

    expect(result).toBe(true);
    expect(setEventsSpy).toHaveBeenCalledWith(
      applyEventChangeEntries(eventsSnapshot, changes, 'before'),
    );
    expect(api.getEvents()).toEqual([before]);
  });

  it('undo→redo で after 方向に再適用され、redo 後の canRedo=false・canUndo=true に戻る', () => {
    const before = ev('a', { title: '変更前' });
    const after = ev('a', { title: '変更後' });
    const api = makeApi([after]);
    const history = createEventHistory({ api });
    history.push([{ before, after }]);

    history.undo();
    const redoResult = history.redo();

    expect(redoResult).toBe(true);
    expect(api.getEvents()).toEqual([after]);
    expect(history.canRedo()).toBe(false);
    expect(history.canUndo()).toBe(true);
  });

  it('対象イベントが getEvents() に存在しない状態で undo しても例外を投げず、他の無関係なエントリは正しく適用される', () => {
    // id 'a' は外部要因（history を経由しない setEvents）で既に一覧から消えている想定
    const missingBefore = ev('a', { title: 'a-変更前' });
    const missingAfter = ev('a', { title: 'a-変更後' });
    const presentBefore = ev('b', { title: 'b-変更前' });
    const presentAfter = ev('b', { title: 'b-変更後' });
    const api = makeApi([missingAfter, presentAfter]);
    const history = createEventHistory({ api });
    history.push([
      { before: missingBefore, after: missingAfter },
      { before: presentBefore, after: presentAfter },
    ]);
    // history を経由せず id 'a' を一覧から取り除く（想定外の外部同期を模す）
    api.setEvents([presentAfter]);

    expect(() => history.undo()).not.toThrow();
    expect(api.getEvents()).toEqual([presentBefore]);
  });

  it('実際の createCalendar と組み合わせ、undo/redo の適用が onEventsChange を発火させない（既存の非対称仕様の維持）', () => {
    const onEventsChange = vi.fn();
    const api = createCalendar({
      timeZone: 'Asia/Tokyo',
      events: [ev('a', { title: '変更後' })],
      onEventsChange,
    });
    const history = createEventHistory({ api });
    history.push([{ before: ev('a', { title: '変更前' }), after: ev('a', { title: '変更後' }) }]);
    onEventsChange.mockClear();

    history.undo();
    history.redo();

    expect(onEventsChange).not.toHaveBeenCalled();
  });
});

describe('createEventHistory: canUndo/canRedo', () => {
  it('初期状態では canUndo/canRedo ともに false', () => {
    const api = makeApi([]);
    const history = createEventHistory({ api });

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});

describe('createEventHistory: clear', () => {
  it('空でない履歴を空にし notify する', () => {
    const api = makeApi([ev('a')]);
    const history = createEventHistory({ api });
    history.push([{ after: ev('a') }]);
    const listener = vi.fn();
    history.subscribe(listener);

    history.clear();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('既に空の履歴に対しては notify しない', () => {
    const api = makeApi([]);
    const history = createEventHistory({ api });
    const listener = vi.fn();
    history.subscribe(listener);

    history.clear();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createEventHistory: subscribe', () => {
  it('購読解除後はリスナーが呼ばれない', () => {
    const api = makeApi([ev('a')]);
    const history = createEventHistory({ api });
    const listener = vi.fn();
    const unsubscribe = history.subscribe(listener);

    unsubscribe();
    history.push([{ after: ev('a') }]);

    expect(listener).not.toHaveBeenCalled();
  });
});
