/**
 * @packageDocumentation
 * イベント変更の undo/redo 履歴マネージャ（フレームワーク非依存）。
 *
 * 「1 操作 = 1 履歴単位」で {@link EventChangeEntry} の一覧をスタックに積み、
 * 取り消し（undo）／やり直し（redo）を行う。適用は {@link CalendarApi.setEvents}
 * 経由で行う（`setEvents` は {@link CalendarOptions.onEventsChange} を発火させない
 * 既存仕様のため、適用自体が新たな履歴を生まない）。
 */

import { applyEventChangeEntriesWithApplied } from './mutations';
import type { CalendarApi, EventChangeEntry } from './types';

/** {@link createEventHistory} のオプション。 */
export interface CalendarEventHistoryOptions {
  /** undo/redo の適用（`setEvents` 経由）に使う {@link CalendarApi}。 */
  api: CalendarApi;
  /**
   * 履歴（undo スタック）の最大保持数。既定は 100。
   * 1 未満・非有限値（`NaN` 等）は 1 にクランプする。
   */
  limit?: number;
}

/** {@link createEventHistory} が返す undo/redo 履歴マネージャ。 */
export interface CalendarEventHistory {
  /**
   * 1 操作分の変更を履歴に積む。`changes` が空配列なら何もしない。
   * redo スタックは破棄される。
   */
  push(changes: readonly EventChangeEntry[]): void;
  /**
   * 直前の操作を取り消す。
   *
   * 1 件以上のエントリを適用できた場合は `true`。対象がない場合、または
   * すべてのエントリがドリフト（対象イベントの不在・想定外の存在）により
   * スキップされた場合は `false` を返す。後者の場合、そのエントリは
   * 履歴（undo スタック）から破棄され、redo スタックへは積まれない。
   */
  undo(): boolean;
  /**
   * 取り消した操作をやり直す。
   *
   * 1 件以上のエントリを適用できた場合は `true`。対象がない場合、または
   * すべてのエントリがドリフトによりスキップされた場合は `false` を返す。
   * 後者の場合、そのエントリは履歴（redo スタック）から破棄され、undo
   * スタックへは積まれない。
   */
  redo(): boolean;
  /** undo 可能かどうか。 */
  canUndo(): boolean;
  /** redo 可能かどうか。 */
  canRedo(): boolean;
  /**
   * undo/redo スタックを両方空にする。
   * 外部同期（`setEvents`）の直後に呼ぶことを推奨する。
   */
  clear(): void;
  /** push/undo/redo/clear のたびに呼ばれるリスナーを購読する。 */
  subscribe(listener: () => void): () => void;
}

/** 履歴の最大保持数の既定値（`limit` 省略時）。 */
const DEFAULT_LIMIT = 100;

/**
 * `limit` を正の整数へ正規化する。
 * 非有限値（`NaN` / `Infinity` 等）・1 未満の値は 1 にクランプする。
 */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isFinite(limit)) {
    return 1;
  }
  return Math.max(1, Math.floor(limit));
}

/**
 * イベント変更の undo/redo 履歴マネージャを作成する。
 *
 * @param options - {@link CalendarEventHistoryOptions}
 * @returns {@link CalendarEventHistory}
 *
 * @remarks
 * - `undo` / `redo` は {@link applyEventChangeEntriesWithApplied} を `api.getEvents()`
 *   の呼び出し時点の内容に適用し、1 件以上適用できた場合のみ結果を `api.setEvents()`
 *   に渡す。対象イベントが想定と食い違うエントリ（presence-only のドリフト検出）は
 *   安全にスキップされる。1 件も適用できなかった場合はそのエントリを履歴から破棄し
 *   `setEvents` は呼ばない。一部のみ適用できた場合は、実際に適用できたエントリだけを
 *   反対のスタック（undo → redo、redo → undo）に積む。積まれるエントリの `index` は
 *   適用時点の実際の位置へ更新されているため、逆方向の再適用は適用直前の並び順を復元する
 * - `api.subscribe` は監視しない。`setEvents` 以外の要因による状態変化の
 *   自動的なドリフト検出は行わない
 *
 * @example
 * ```ts
 * const history = createEventHistory({ api: calendar.api });
 * const changes = calendar.api.updateEvent(id, { title: '変更後' });
 * history.push(changes);
 * history.undo(); // タイトルを元に戻す
 * history.redo(); // もう一度変更後の状態にする
 * ```
 */
export function createEventHistory(options: CalendarEventHistoryOptions): CalendarEventHistory {
  const { api } = options;
  const limit = normalizeLimit(options.limit);

  let undoStack: (readonly EventChangeEntry[])[] = [];
  let redoStack: (readonly EventChangeEntry[])[] = [];
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * スタックから取り出した 1 履歴単位を指定方向へ適用する。
   *
   * 1 件も適用できなかった場合は `api.setEvents` を呼ばず `false` を返す
   * （そのエントリは呼び出し側でスタックから破棄済み・積み直さない）。
   * 1 件以上適用できた場合は `api.setEvents` を呼び、実際に適用できたエントリ
   * （`applied`）を返す（呼び出し側が反対のスタックへ積む）。
   */
  function apply(
    changes: readonly EventChangeEntry[],
    direction: 'before' | 'after',
  ): readonly EventChangeEntry[] | undefined {
    const { events, applied } = applyEventChangeEntriesWithApplied(
      api.getEvents(),
      changes,
      direction,
    );
    if (applied.length === 0) {
      return undefined;
    }
    api.setEvents(events);
    return applied;
  }

  return {
    push(changes: readonly EventChangeEntry[]): void {
      if (changes.length === 0) {
        return;
      }
      const next = [...undoStack, changes];
      // limit 超過分は最古（先頭）から破棄する
      undoStack = next.length > limit ? next.slice(next.length - limit) : next;
      redoStack = [];
      notify();
    },

    undo(): boolean {
      const changes = undoStack.at(-1);
      if (changes === undefined) {
        return false;
      }
      // 適用の成否によらず、このエントリはスタックから取り除く
      // （1 件も適用できなかった場合はそのまま破棄し、積み直さない）
      undoStack = undoStack.slice(0, -1);
      const applied = apply(changes, 'before');
      if (applied === undefined) {
        notify();
        return false;
      }
      redoStack = [...redoStack, applied];
      notify();
      return true;
    },

    redo(): boolean {
      const changes = redoStack.at(-1);
      if (changes === undefined) {
        return false;
      }
      redoStack = redoStack.slice(0, -1);
      const applied = apply(changes, 'after');
      if (applied === undefined) {
        notify();
        return false;
      }
      undoStack = [...undoStack, applied];
      notify();
      return true;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clear(): void {
      if (undoStack.length === 0 && redoStack.length === 0) {
        return;
      }
      undoStack = [];
      redoStack = [];
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
