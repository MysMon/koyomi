/**
 * @packageDocumentation
 * `UndoPattern` — 「Undo/Redo」パターン（準備中）。
 *
 * `CalendarInteractionCallbacks`（`onEventChange` / `onEventDelete` など）で
 * 変更履歴を蓄積し、取り消し・やり直しできるデモを実装予定。
 */

import type { ReactElement } from 'react';

/**
 * 「Undo/Redo」パターンのプレースホルダー。
 *
 * 本実装が入るまでの間、準備中であることを示す。
 */
export function UndoPattern(): ReactElement {
  return (
    <div className="demo-main demo-placeholder">
      <p className="demo-placeholder-text">
        「Undo/Redo」パターンは準備中です。予定の変更履歴を取り消し・やり直し
        できるデモを実装予定です。
      </p>
    </div>
  );
}
