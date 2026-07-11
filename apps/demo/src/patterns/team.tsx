/**
 * @packageDocumentation
 * `TeamPattern` — 「チーム」パターン（準備中）。
 *
 * 多数のリソース（チームメンバー）と大量イベントを用いたリソース/タイムライン
 * ビューのデモを実装予定。データ生成には `../sample-data` の
 * `makeManyResources` / `makeManyEvents` を使う。
 */

import type { ReactElement } from 'react';

/**
 * 「チーム」パターンのプレースホルダー。
 *
 * 本実装が入るまでの間、準備中であることを示す。
 */
export function TeamPattern(): ReactElement {
  return (
    <div className="demo-main demo-placeholder">
      <p className="demo-placeholder-text">
        「チーム」パターンは準備中です。多数のリソースと大量イベントによる
        リソース/タイムラインビューのデモを実装予定です。
      </p>
    </div>
  );
}
