/**
 * @packageDocumentation
 * `ScopeDialog` — 繰り返し予定の変更・削除の適用範囲を選択するダイアログ。
 *
 * Google カレンダーの「この予定 / これ以降のすべての予定 / すべての予定」に
 * 相当する選択肢を提示する。`CalendarInteractionCallbacks.resolveRecurringScope`
 * および `EventDialog` からの保存・削除の両方から共通で利用する。
 */

import type { EventOccurrence, RecurringEditScope } from '@koyomi/react';
import { type ReactElement, useEffect, useRef } from 'react';

/** スコープ選択が要求された操作の種類。 */
export type ScopeAction = 'move' | 'resize' | 'delete' | 'update';

/** `ScopeDialog` が表示すべき要求内容。 */
export interface ScopeRequest {
  /** 対象の発生。 */
  occurrence: EventOccurrence;
  /** 操作の種類。 */
  action: ScopeAction;
}

/** `ScopeDialog` の props。 */
export interface ScopeDialogProps {
  /** 表示中の要求。`null` なら非表示。 */
  request: ScopeRequest | null;
  /**
   * 選択結果を通知する。
   * ユーザーがキャンセル（Esc・背景クリック・キャンセルボタン）した場合は `null`。
   */
  onResolve: (scope: RecurringEditScope | null) => void;
}

/** 操作の種類を日本語の動詞に変換する。 */
function actionLabel(action: ScopeAction): string {
  switch (action) {
    case 'move':
      return '移動';
    case 'resize':
      return '時間の変更';
    case 'delete':
      return '削除';
    case 'update':
      return '変更';
  }
}

/**
 * 繰り返し予定の適用範囲を選択させるダイアログ。
 *
 * `<dialog>` 要素を使い、`request` が非 `null` になると `showModal()` で開く。
 * Esc キー・背景クリックでキャンセル扱い（`onResolve(null)`）になる。
 *
 * @example
 * ```tsx
 * <ScopeDialog request={scopeRequest} onResolve={handleScopeResolve} />
 * ```
 */
export function ScopeDialog(props: ScopeDialogProps): ReactElement {
  const { request, onResolve } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // 選択ボタン経由で close() した場合に、close イベントでの
  // 「キャンセル扱い」への二重通知を防ぐためのフラグ。
  const resolvedRef = useRef(false);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return;
    }
    if (request !== null && !dialogEl.open) {
      dialogEl.showModal();
    } else if (request === null && dialogEl.open) {
      dialogEl.close();
    }
  }, [request]);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return undefined;
    }
    /** Esc キー・背景クリックによるネイティブな close はキャンセル扱いにする。 */
    function handleClose(): void {
      if (!resolvedRef.current) {
        onResolve(null);
      }
      resolvedRef.current = false;
    }
    dialogEl.addEventListener('close', handleClose);
    return () => dialogEl.removeEventListener('close', handleClose);
  }, [onResolve]);

  /** 選択肢ボタンが押されたときの処理。 */
  function choose(scope: RecurringEditScope): void {
    resolvedRef.current = true;
    onResolve(scope);
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} className="demo-dialog demo-scope-dialog">
      {request !== null && (
        <div className="demo-dialog-body">
          <h2 className="demo-dialog-title">繰り返し予定の{actionLabel(request.action)}</h2>
          <p className="demo-scope-description">
            「{request.occurrence.event.title}」は繰り返し予定です。どの範囲に適用しますか？
          </p>
          <div className="demo-scope-options">
            <button type="button" className="demo-button" onClick={() => choose('this')}>
              この予定のみ
            </button>
            <button
              type="button"
              className="demo-button"
              onClick={() => choose('thisAndFollowing')}
            >
              これ以降のすべての予定
            </button>
            <button type="button" className="demo-button" onClick={() => choose('all')}>
              すべての予定
            </button>
          </div>
          <div className="demo-dialog-actions">
            <button
              type="button"
              className="demo-button demo-button-text"
              onClick={() => dialogRef.current?.close()}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
