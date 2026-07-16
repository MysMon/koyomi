/**
 * デフォルトテーマ（default.css）のカスケード上の不変条件を検証する。
 *
 * 1. ブラウザ既定リセット（`button[data-koyomi]` / `h2[data-koyomi]` /
 *    `h3[data-koyomi]` を対象にするルール）は詳細度ゼロ（`:where()` で全体を包む）で
 *    宣言される。部位ごとの見た目は `[data-koyomi="<部位名>"]`（詳細度 0,1,0）の
 *    セレクタで当てるため、リセットの詳細度が (0,1,1) 以上だと
 *    `background-color` 等の部位スタイルがリセットに负けて消える
 *    （例: `[data-koyomi="timegrid-event"]` のイベント背景色）。
 * 2. `--koyomi-*` CSS 変数の定義ブロックは `[data-koyomi="root"]` と
 *    `[data-koyomi="toolbar"]` の両方をスコープにする。`Toolbar` は
 *    `CalendarView`（root を描画する）の外側・兄弟として置く構成が標準のため、
 *    root だけに変数を定義するとスタンドアロン配置の Toolbar で変数が解決されず、
 *    ボタンの押下状態などの見た目が壊れる。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = path.join(__dirname, 'default.css');

/** ブロックコメント（`/* ... *\/`）を取り除く。 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** CSS ルール 1 件（セレクタ + 宣言ブロック本文）。 */
interface CssRule {
  selector: string;
  body: string;
}

/**
 * CSS ソースから通常ルールを抽出する（`@media` 等の条件付きグループは中身へ再帰する）。
 * default.css の構文（ネストなし・単純なルールの羅列）を前提にした簡易パーサ。
 */
function extractRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let index = 0;
  while (index < css.length) {
    const braceIndex = css.indexOf('{', index);
    if (braceIndex === -1) break;
    const selector = css.slice(index, braceIndex).trim();
    let depth = 1;
    let end = braceIndex + 1;
    while (end < css.length && depth > 0) {
      const char = css[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      end += 1;
    }
    const body = css.slice(braceIndex + 1, end - 1);
    if (selector.startsWith('@')) {
      rules.push(...extractRules(body));
    } else {
      rules.push({ selector, body });
    }
    index = end;
  }
  return rules;
}

/**
 * セレクタ 1 本（カンマ区切りの 1 要素）の詳細度を `[id, class, type]` で計算する。
 * `:where(...)` の中身は仕様どおり詳細度に数えない。default.css で使われる
 * 構文（属性・擬似クラス・擬似要素・要素型・結合子）を対象にした簡易実装。
 */
function specificity(selectorPart: string): [number, number, number] {
  // :where(...) は詳細度ゼロなので丸ごと取り除く（括弧の入れ子は 1 段まで対応）
  let rest = selectorPart.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ' ');
  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  rest = rest.replace(/#[\w-]+/g, ' ');
  // 擬似要素（::before 等）は type 扱い。先に数えて取り除く
  const pseudoElements = (rest.match(/::[\w-]+/g) ?? []).length;
  rest = rest.replace(/::[\w-]+/g, ' ');
  const attributes = (rest.match(/\[[^\]]*\]/g) ?? []).length;
  rest = rest.replace(/\[[^\]]*\]/g, ' ');
  const classes = (rest.match(/\.[\w-]+/g) ?? []).length;
  rest = rest.replace(/\.[\w-]+/g, ' ');
  // 擬似クラス（:not(...) は中身も 1 個の擬似クラス相当として概算する）
  const pseudoClasses = (rest.match(/:[\w-]+/g) ?? []).length;
  rest = rest.replace(/:[\w-]+(\([^)]*\))?/g, ' ');
  const types = (rest.match(/(?:^|[\s>+~,(])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, attributes + classes + pseudoClasses, types + pseudoElements];
}

/** セレクタリストを括弧の外側のカンマだけで分割する（`:where(a, b)` の内側は分割しない）。 */
function splitTopLevel(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** セレクタが素の要素型 `button` / `h2` / `h3` を参照しているかを判定する。 */
function referencesBareElement(selector: string): boolean {
  // 属性セレクタの値（"button" 等のリテラル）を除いてから要素型トークンを探す
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '');
  return /(^|[\s>+~(,])(button|h2|h3)\b/.test(withoutAttributes);
}

describe('default.css のカスケード不変条件', () => {
  const css = stripBlockComments(readFileSync(CSS_PATH, 'utf-8'));
  const rules = extractRules(css);

  it('ルールを抽出できている（前提条件の健全性チェック）', () => {
    expect(rules.length).toBeGreaterThan(50);
  });

  describe('ブラウザ既定リセットは部位スタイル（詳細度 0,1,0）に勝たない', () => {
    const resetRules = rules.filter((rule) => referencesBareElement(rule.selector));

    it('リセットルール（button/h2/h3 対象）が存在する', () => {
      expect(resetRules.length).toBeGreaterThanOrEqual(2);
    });

    it.each(resetRules)('$selector の各セレクタは属性 1 個分より弱い詳細度を持つ', ({
      selector,
    }) => {
      for (const part of splitTopLevel(selector)) {
        const [ids, classLike, types] = specificity(part);
        expect(ids).toBe(0);
        // (0,1,0) の部位セレクタが常に勝てるよう、リセット本体は (0,0,0) を要求する。
        // 例外として、フォーカスリング用の :focus-visible 1 個分（0,1,0）までは許容する
        // （outline は部位スタイルと競合しないため）。
        const pseudoAllowance = /:focus-visible/.test(part) ? 1 : 0;
        expect(classLike).toBeLessThanOrEqual(pseudoAllowance);
        expect(types).toBe(0);
      }
    });
  });

  describe('CSS 変数の定義スコープはスタンドアロン配置の Toolbar にも届く', () => {
    const variableRules = rules.filter((rule) => rule.body.includes('--koyomi-bg:'));

    it('変数定義ブロックが存在する（前提条件の健全性チェック）', () => {
      // 既定・prefers-color-scheme: dark・強制 dark・強制 light の 4 ブロック
      expect(variableRules.length).toBeGreaterThanOrEqual(4);
    });

    it.each(variableRules)('$selector は [data-koyomi="toolbar"] も対象に含む', ({ selector }) => {
      expect(selector).toContain('[data-koyomi="toolbar"]');
    });
  });
});
