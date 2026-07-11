/**
 * @packageDocumentation
 * `App` — デモアプリのシェル。
 *
 * ハッシュルーティング（`#/basic` など）でデモパターンを切り替えるタブ UI を
 * 提供する。ダークモードの切替は全パターン共通の機能としてここに集約し、
 * `<html data-koyomi-theme>` 属性として反映する（`@koyomi-cal/react/theme.css`
 * がこの属性を見て配色を切り替える）。各パターン本体は `./patterns/*` に実装する。
 */

import { type ReactElement, useEffect, useState } from 'react';
import { BasicPattern } from './patterns/basic';
import { HeadlessPattern } from './patterns/headless';
import { InternationalPattern } from './patterns/international';
import { TeamPattern } from './patterns/team';
import { UndoPattern } from './patterns/undo';
import { PATTERNS, type PatternId, useHashRoute } from './router';

/** パターン ID → 描画するコンポーネントの対応表。 */
const PATTERN_COMPONENTS: Record<PatternId, () => ReactElement> = {
  basic: BasicPattern,
  team: TeamPattern,
  international: InternationalPattern,
  headless: HeadlessPattern,
  undo: UndoPattern,
};

/**
 * Koyomi デモアプリのルートコンポーネント（シェル）。
 *
 * `useHashRoute` で選択中のパターンを求め、対応するコンポーネントを描画する。
 */
export function App(): ReactElement {
  const route = useHashRoute();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-koyomi-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const PatternComponent = PATTERN_COMPONENTS[route];

  return (
    <div className="demo-shell">
      <header className="demo-shell-header">
        <div className="demo-shell-titlebar">
          <h1 className="demo-title">Koyomi デモ</h1>
          <button
            type="button"
            className="demo-theme-toggle"
            onClick={() => setDarkMode((prev) => !prev)}
          >
            {darkMode ? '☀️ ライトモード' : '🌙 ダークモード'}
          </button>
        </div>

        <nav className="demo-pattern-tabs" aria-label="デモパターン切替">
          {PATTERNS.map((pattern) => (
            <a
              key={pattern.id}
              href={pattern.hash}
              className="demo-pattern-tab"
              aria-current={route === pattern.id ? 'page' : undefined}
            >
              <span className="demo-pattern-tab-label">{pattern.label}</span>
              <span className="demo-pattern-tab-description">{pattern.description}</span>
            </a>
          ))}
        </nav>
      </header>

      <PatternComponent />
    </div>
  );
}
