/**
 * デフォルトテーマ（default.css）の `prefers-reduced-motion: reduce` 対応を検証する。
 *
 * `transition` / `animation` を使う既存ルール（ツールバーボタンの配色変化、
 * タイムラインの折りたたみトグルの回転）を、視差効果の低減を希望する
 * ユーザー向けに一括で無効化できているかを機械的に確認する。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = path.join(__dirname, 'default.css');

/** ブロックコメント（`/* ... *\/`）を取り除く。 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * `@media (prefers-reduced-motion: reduce) { ... }` ブロックの中身（波括弧の
 * 中身）を返す。存在しなければ `null`。
 */
function extractReducedMotionBlockBody(css: string): string | null {
  const marker = '@media (prefers-reduced-motion: reduce)';
  const start = css.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const braceStart = css.indexOf('{', start);
  if (braceStart === -1) {
    return null;
  }
  let depth = 1;
  let end = braceStart + 1;
  while (end < css.length && depth > 0) {
    const char = css[end];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    end += 1;
  }
  return css.slice(braceStart + 1, end - 1);
}

describe('default.css の prefers-reduced-motion 対応', () => {
  const css = stripBlockComments(readFileSync(CSS_PATH, 'utf-8'));

  it('@media (prefers-reduced-motion: reduce) ブロックが存在する', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  const body = extractReducedMotionBlockBody(css);

  it('ブロックの中身を抽出できている（前提条件の健全性チェック）', () => {
    expect(body).not.toBeNull();
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  it('root/toolbar 配下すべての要素を対象に transition/animation を無効化する', () => {
    expect(body).toContain('[data-koyomi="root"]');
    expect(body).toContain('[data-koyomi="toolbar"]');
    expect(body).toMatch(/transition:\s*none;/);
    expect(body).toMatch(/animation:\s*none;/);
  });

  it('既存の transition 宣言（ツールバーボタン・タイムライン折りたたみトグル）は温存されている', () => {
    // `!important` は使わず（Biome の noImportantStyles に抵触するため）、
    // カスケードの「詳細度が同じ場合はソース順で後勝ち」だけで無効化する。
    // そのため既存の transition プロパティの宣言（対象プロパティ・duration・
    // easing）自体は温存され、このルールより前に置かれている必要がある
    expect(css).toMatch(/\[data-koyomi="button"\][\s\S]{0,200}transition:/);
    expect(css).toMatch(/\[data-koyomi="timeline-row-toggle"\][\s\S]{0,200}transition:/);
  });

  it('無効化ルールは transition/animation を宣言する既存ルールより後ろに置かれている（同じ詳細度でのソース順の後勝ちに依存するため）', () => {
    const reducedMotionIndex = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const buttonRuleIndex = css.indexOf('[data-koyomi="button"] {');
    const toggleRuleIndex = css.indexOf('[data-koyomi="timeline-row-toggle"] {');
    expect(reducedMotionIndex).toBeGreaterThan(buttonRuleIndex);
    expect(reducedMotionIndex).toBeGreaterThan(toggleRuleIndex);
  });

  it('!important は使わない（noImportantStyles を避けるため、カスケード順序だけで無効化する）', () => {
    expect(body).not.toContain('!important');
  });
});
