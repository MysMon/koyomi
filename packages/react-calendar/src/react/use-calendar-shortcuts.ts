/**
 * @packageDocumentation
 * キーボードショートカット（Google カレンダー準拠）。
 *
 * - `M` / `W` / `D` / `A` — 月 / 週 / 日 / リスト表示に切り替え
 * - `Y` / `Q` / `R` / `L` — 年 / 複数月 / リソース / タイムライン表示に切り替え
 *   （いずれも `views` で有効化した場合のみ。既定は無効）
 * - `T` — 今日へ移動
 * - `J` / `N` — 次の期間、`K` / `P` — 前の期間
 * - `C` — 予定の作成（`onCreate` コールバック）
 *
 * 入力欄（input / textarea / select / contentEditable）にフォーカスがある間は無効。
 */

import { useEffect } from 'react';
import { shortcutForKey } from '../core/interaction';
import type { CalendarViewType } from '../core/types';
import type { UseCalendarResult } from './types';

/**
 * ビュー切替ショートカットの既定の対象ビュー。
 * 既存 4 ビューのみ（新ビューのキーは opt-in。`Toolbar` の `views` 既定と同じ方針）。
 */
const DEFAULT_SHORTCUT_VIEWS: readonly CalendarViewType[] = ['month', 'week', 'day', 'list'];

/**
 * `contenteditable` 属性を持つ要素かどうかを判定するセレクタ。
 * 値が `"false"` の場合は編集不可を表すため除外する
 * （`contenteditable=""` は仕様上 `"true"` と同義）。
 *
 * `contenteditable` は HTML の enumerated attribute であり値の大文字小文字を
 * 区別しないため、属性セレクタの `i` フラグ（大文字小文字を無視して比較する）
 * を付けて `"FALSE"` / `"False"` なども編集不可として正しく除外する。
 */
const CONTENT_EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false" i])';

/**
 * ショートカットを無視すべきイベントターゲットかどうかを判定する。
 *
 * - `target` が `Element` でない場合（例: `document` 自体がターゲット）
 * - `input` / `textarea` / `select` 要素
 * - `contentEditable` 要素の内側
 */
function isIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  const tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  return target.closest(CONTENT_EDITABLE_SELECTOR) !== null;
}

/**
 * キーボードショートカットを有効にするフック。
 *
 * `document` に `keydown` リスナーを登録し、アンマウント時に解除する。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.enabled - 一時的に無効化する場合は `false`。既定は `true`
 * @param params.onCreate - `C` キーが押されたときに呼ばれる（作成 UI の起点）。
 *   省略時は何もしない
 * @param params.views - ビュー切替キーを有効にするビューの一覧。
 *   既定は `['month', 'week', 'day', 'list']`（既存 4 ビュー。既定挙動は従来と不変）。
 *   新ビューのキー（`Y` / `Q` / `R` / `L`）を使う場合はここに含める
 *   （`Toolbar` の `views` と同じ opt-in）
 *
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar();
 *   useCalendarShortcuts({ calendar, onCreate: () => setCreateDialogOpen(true) });
 *   return <CalendarProvider value={calendar}><CalendarView /></CalendarProvider>;
 * }
 * ```
 */
export function useCalendarShortcuts(params: {
  calendar: UseCalendarResult;
  enabled?: boolean;
  onCreate?: () => void;
  views?: readonly CalendarViewType[];
}): void {
  const { calendar, enabled = true, onCreate, views } = params;
  const { api } = calendar;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isIgnoredTarget(event.target)) {
        return;
      }
      const shortcut = shortcutForKey(event.key, {
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      if (shortcut === null) {
        return;
      }
      // 対象外ビューへの切替キーは「ショートカットなし」として扱う
      // （preventDefault もしない。既定では新ビューのキーが無効になる）
      if (shortcut.type === 'view' && !(views ?? DEFAULT_SHORTCUT_VIEWS).includes(shortcut.view)) {
        return;
      }
      event.preventDefault();
      switch (shortcut.type) {
        case 'view':
          api.setView(shortcut.view);
          break;
        case 'today':
          api.today();
          break;
        case 'next':
          api.next();
          break;
        case 'prev':
          api.prev();
          break;
        case 'create':
          onCreate?.();
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [api, enabled, onCreate, views]);
}
