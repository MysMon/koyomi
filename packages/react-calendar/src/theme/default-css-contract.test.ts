/**
 * デフォルトテーマ（default.css）が参照する `data-koyomi-*` 属性は、
 * すべて `src/react/` の実装が実際に出力しているものだけであることを検証する。
 *
 * CSS 側から属性セレクタ（`[data-koyomi="..."]` / `[data-koyomi-xxx]` /
 * `[data-koyomi-xxx="..."]`）を機械抽出し、`src/react/` のソースに実在する
 * `data-koyomi-*` 属性名・（`data-koyomi` については）リテラル値の集合と突き合わせる。
 * 実装から削除された部位を指す死んだセレクタが CSS に残るのを防ぐ。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const THEME_DIR = path.join(__dirname);
const REACT_SRC_DIR = path.join(__dirname, '..', 'react');

/** ブロックコメント（`/* ... *\/`）を取り除く。CSS・TS のどちらにも使える簡易実装。 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 行コメント（`// ...`）を取り除く。 */
function stripLineComments(source: string): string {
  return source.replace(/\/\/.*$/gm, '');
}

/** 指定ディレクトリ配下の `.ts` / `.tsx`（テストファイルを除く）を再帰的に列挙する。 */
function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (/\.test\.(tsx|ts)$/.test(entry)) continue;
    files.push(fullPath);
  }
  return files;
}

/** CSS の属性セレクタ 1 件（属性名 + リテラル値。値なしは `null`）。 */
interface CssAttributeSelector {
  name: string;
  value: string | null;
}

/** CSS ソースから `[data-koyomi...]` 形式の属性セレクタをすべて抽出する。 */
function extractCssAttributeSelectors(css: string): CssAttributeSelector[] {
  const withoutComments = stripBlockComments(css);
  const pattern = /\[(data-koyomi(?:-[a-zA-Z0-9-]+)?)(?:="([^"]*)")?\]/g;
  const selectors: CssAttributeSelector[] = [];
  for (const match of withoutComments.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    selectors.push({ name, value: match[2] ?? null });
  }
  return selectors;
}

/** ソースコードから実際に出力されている `data-koyomi-*` 属性名の集合を抽出する。 */
function extractSourceAttributeNames(sources: readonly string[]): Set<string> {
  const names = new Set<string>();
  const pattern = /data-koyomi(?:-[a-zA-Z0-9-]+)?/g;
  for (const source of sources) {
    const cleaned = stripLineComments(stripBlockComments(source));
    for (const match of cleaned.matchAll(pattern)) {
      names.add(match[0]);
    }
  }
  return names;
}

/** ソースコードから `data-koyomi="値"` のリテラル値（JSX 属性・オブジェクトキー双方）の集合を抽出する。 */
function extractSourceDataKoyomiValues(sources: readonly string[]): Set<string> {
  const values = new Set<string>();
  // JSX 属性形式: data-koyomi="month-day" / data-koyomi='month-day'
  const jsxPattern = /data-koyomi=["']([a-zA-Z0-9-]+)["']/g;
  for (const source of sources) {
    const cleaned = stripLineComments(stripBlockComments(source));
    for (const match of cleaned.matchAll(jsxPattern)) {
      const value = match[1];
      if (value !== undefined) values.add(value);
    }
  }
  return values;
}

/**
 * CSS 側にのみ存在し、ソースには一切現れない属性名。
 * `data-koyomi-theme` はコンポーネント自身は出力せず、利用側がルート要素・祖先要素へ
 * 明示的に付与する仕様（docs/theming.md 参照）のため、意図的な例外として除外する。
 */
const CONSUMER_SUPPLIED_ATTRIBUTE_NAMES = new Set(['data-koyomi-theme']);

describe('default.css の data-koyomi 属性はソースに実在する', () => {
  const css = readFileSync(path.join(THEME_DIR, 'default.css'), 'utf-8');
  const reactSourceFiles = listSourceFiles(REACT_SRC_DIR);
  const reactSources = reactSourceFiles.map((file) => readFileSync(file, 'utf-8'));

  const cssSelectors = extractCssAttributeSelectors(css);
  const sourceAttributeNames = extractSourceAttributeNames(reactSources);
  const sourceDataKoyomiValues = extractSourceDataKoyomiValues(reactSources);

  it('CSS が参照する属性セレクタを 1 件以上抽出できている（前提条件の健全性チェック）', () => {
    expect(cssSelectors.length).toBeGreaterThan(50);
    expect(sourceAttributeNames.size).toBeGreaterThan(0);
    expect(sourceDataKoyomiValues.size).toBeGreaterThan(50);
  });

  it.each(
    cssSelectors.filter((s) => !CONSUMER_SUPPLIED_ATTRIBUTE_NAMES.has(s.name)),
  )('$name$value は src/react に実在する', ({ name, value }) => {
    expect(sourceAttributeNames.has(name)).toBe(true);

    // `data-koyomi="<部位名>"` はリテラル値（部位名）そのものが CSS のフックなので、
    // 値まで実在するかを確認する。それ以外の属性（真偽フラグ的な data-koyomi-dragging
    // 等の列挙値）は、動的に付け外しされる値の一致まで固定すると過剰に脆くなるため、
    // 属性名レベルの照合にとどめる。
    if (name === 'data-koyomi' && value !== null && value !== '') {
      expect(sourceDataKoyomiValues.has(value)).toBe(true);
    }
  });
});
