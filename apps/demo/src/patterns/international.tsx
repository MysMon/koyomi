/**
 * @packageDocumentation
 * `InternationalPattern` — 「国際化」パターン（準備中）。
 *
 * 多言語ロケール（`locale`）と複数タイムゾーンの切り替えのデモを実装予定。
 */

import type { ReactElement } from 'react';

/**
 * 「国際化」パターンのプレースホルダー。
 *
 * 本実装が入るまでの間、準備中であることを示す。
 */
export function InternationalPattern(): ReactElement {
  return (
    <div className="demo-main demo-placeholder">
      <p className="demo-placeholder-text">
        「国際化」パターンは準備中です。多言語ロケールと複数タイムゾーンの
        切り替えのデモを実装予定です。
      </p>
    </div>
  );
}
