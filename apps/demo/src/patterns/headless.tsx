/**
 * @packageDocumentation
 * `HeadlessPattern` — 「ヘッドレス」パターン（準備中）。
 *
 * ビルトインのビューコンポーネントを使わず、独自 UI でカレンダーロジック
 * （`createCalendar` / ビューモデルビルダー群）のみを利用するデモを実装予定。
 */

import type { ReactElement } from 'react';

/**
 * 「ヘッドレス」パターンのプレースホルダー。
 *
 * 本実装が入るまでの間、準備中であることを示す。
 */
export function HeadlessPattern(): ReactElement {
  return (
    <div className="demo-main demo-placeholder">
      <p className="demo-placeholder-text">
        「ヘッドレス」パターンは準備中です。独自 UI でカレンダーロジックのみを
        利用するデモを実装予定です。
      </p>
    </div>
  );
}
