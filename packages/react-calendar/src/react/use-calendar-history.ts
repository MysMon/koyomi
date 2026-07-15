/**
 * @packageDocumentation
 * `useCalendarHistory` — イベント変更の undo/redo 履歴を React に接続するフック。
 *
 * - `Ctrl/Cmd+Z` — 取り消し（undo）
 * - `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` — やり直し（redo）
 *
 * （いずれも `keyboardShortcuts: true` の場合のみ。既定は無効）
 * 入力欄（input / textarea / select / contentEditable）にフォーカスがある間は無効。
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createEventHistory } from '../core/history';
import type { EventChangeEntry } from '../core/types';
import type { UseCalendarResult } from './types';
import { isIgnoredTarget } from './use-calendar-shortcuts';

/** `useCalendarHistory` のオプション。 */
export interface UseCalendarHistoryOptions {
  /** `useCalendar` の戻り値。 */
  calendar: UseCalendarResult;
  /**
   * 履歴の最大保持数（{@link createEventHistory} と同じ）。
   * **マウント時のみ有効**（`useCalendar` の `options.events` と同じ「初期値のみ有効」規約）。
   */
  limit?: number;
  /**
   * `Ctrl+Z`（undo）／`Ctrl+Shift+Z`・`Ctrl+Y`（redo）のキーボードショートカットを
   * 有効にするか（macOS では `Cmd` も同様）。既定は `false`（opt-in）。
   * input/textarea/select/contentEditable にフォーカスがある間は無効。
   */
  keyboardShortcuts?: boolean;
}

/** `useCalendarHistory` の戻り値。 */
export interface UseCalendarHistoryResult {
  /** undo 可能かどうか（購読済みで再レンダーに反映される）。 */
  canUndo: boolean;
  /** redo 可能かどうか（購読済みで再レンダーに反映される）。 */
  canRedo: boolean;
  /** 直前の操作を取り消す。適用した場合は `true`、対象がない場合は `false`。 */
  undo(): boolean;
  /** 取り消した操作をやり直す。適用した場合は `true`、対象がない場合は `false`。 */
  redo(): boolean;
  /**
   * 1 操作分の変更を履歴に積む。`onEventChange` / `onEventDelete` 内、または
   * `api.createEvent` / `updateEvent` / `deleteEvent` の戻り値を得た直後に呼ぶ。
   */
  push(changes: readonly EventChangeEntry[]): void;
  /** 履歴を空にする。 */
  clear(): void;
}

/** `Ctrl+Z` / `Cmd+Z`（undo）のキー入力かどうかを判定する。 */
function isUndoShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
}

/** `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y` / `Cmd+Y`（redo）のキー入力かどうかを判定する。 */
function isRedoShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) {
    return false;
  }
  const key = event.key.toLowerCase();
  return (event.shiftKey && key === 'z') || (!event.shiftKey && key === 'y');
}

/**
 * イベント変更の undo/redo 履歴を React に接続する。
 *
 * `createEventHistory`（フレームワーク非依存のスタック管理）をマウント時に一度だけ
 * 作成し、`canUndo` / `canRedo` を `useSyncExternalStore` で購読する。UI は提供しない
 * （ヘッドレス）。undo/redo ボタン等は利用側で組み、`push` は `onEventChange` /
 * `onEventDelete` コールバック内などから明示的に呼ぶ運用を想定する。
 *
 * @param options - {@link UseCalendarHistoryOptions}
 * @returns {@link UseCalendarHistoryResult}
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar();
 *   const history = useCalendarHistory({ calendar, keyboardShortcuts: true });
 *   return (
 *     <div>
 *       <button type="button" disabled={!history.canUndo} onClick={() => history.undo()}>
 *         元に戻す
 *       </button>
 *       <CalendarProvider
 *         value={calendar}
 *         callbacks={{ onEventChange: (change) => history.push(change.changes) }}
 *       >
 *         <CalendarView />
 *       </CalendarProvider>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCalendarHistory(options: UseCalendarHistoryOptions): UseCalendarHistoryResult {
  const { calendar, keyboardShortcuts = false } = options;
  const { api } = calendar;

  // limit は初期値としてのみ有効（マウント時に 1 度だけ createEventHistory に渡す）。
  const historyRef = useRef<ReturnType<typeof createEventHistory> | null>(null);
  if (historyRef.current === null) {
    // exactOptionalPropertyTypes 下では limit: undefined を明示的に渡せないため、
    // 未指定の場合はキー自体を省略する
    historyRef.current =
      options.limit === undefined
        ? createEventHistory({ api })
        : createEventHistory({ api, limit: options.limit });
  }
  const history = historyRef.current;

  const canUndo = useSyncExternalStore(history.subscribe, history.canUndo, history.canUndo);
  const canRedo = useSyncExternalStore(history.subscribe, history.canRedo, history.canRedo);

  useEffect(() => {
    if (!keyboardShortcuts) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isIgnoredTarget(event.target)) {
        return;
      }
      if (isUndoShortcut(event)) {
        event.preventDefault();
        history.undo();
      } else if (isRedoShortcut(event)) {
        event.preventDefault();
        history.redo();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [keyboardShortcuts, history]);

  return useMemo(
    () => ({
      canUndo,
      canRedo,
      undo: history.undo,
      redo: history.redo,
      push: history.push,
      clear: history.clear,
    }),
    [canUndo, canRedo, history],
  );
}
