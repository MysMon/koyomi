#!/usr/bin/env node
/**
 * 禁止用語チェック。
 *
 * 直訳調・不正確な訳語（例:「壁時計」「契約」）がコメント・TSDoc・docs・テストに
 * 再混入するのを機械的に防ぐ。用語の方針は docs/internal/terminology.md に集約する。
 *
 * `pnpm terms`（`pnpm check` からも呼ばれる）で実行し、違反があれば非ゼロ終了する。
 * 正当な例外がある行には `koyomi-terms-ok` というコメントを付けると除外される。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['packages', 'apps', 'docs'];
const EXTS = ['.ts', '.tsx', '.md'];
const EXCLUDE_DIR_NAMES = new Set(['node_modules', 'dist']);
// 用語一覧そのものを記載するファイルは対象外にする。
const EXCLUDE_FILES = new Set(['scripts/check-terms.mjs', 'docs/internal/terminology.md']);

/**
 * 禁止パターンと推奨語。
 * 動詞「発生する／し／さ／せ」は許容し、名詞の「発生」(EventOccurrence) のみ禁止する。
 */
const RULES = [
  { re: /壁時計/, preferred: '現地時刻 / 現地日時' },
  { re: /前方解決|前方に解決/, preferred: '繰り上げ（例: 直後の実在時刻に繰り上げて解決）' },
  { re: /埋め草/, preferred: '前後月の日付' },
  { re: /日初/, preferred: '日の開始' },
  { re: /名目分数/, preferred: '「1 日の分（1440 分）」など（「分数」を避ける）' },
  { re: /仮想終了分|仮想区間|仮想長/, preferred: '実効終了分 / 実効区間 / 実効長' },
  { re: /射影/, preferred: '変換' },
  { re: /孤児/, preferred: '参照先のない〜' },
  { re: /エコーループ/, preferred: '循環（呼び出し）防止' },
  { re: /コンテンツ注入/, preferred: 'コンテンツの差し込み' },
  { re: /解釈タイムゾーン/, preferred: '解釈に用いるタイムゾーン' },
  { re: /分区間/, preferred: 'その日に該当する区間' },
  { re: /インスタント/, preferred: '時点' },
  { re: /契約/, preferred: '仕様' },
  { re: /発生(?![すしさせ])/, preferred: 'オカレンス（名詞のとき。動詞「発生する」は可）' },
];

/** 走査対象ファイルを再帰的に集める。 */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIR_NAMES.has(e.name)) walk(join(dir, e.name), out);
    } else if (e.isFile() && EXTS.some((ext) => e.name.endsWith(ext))) {
      out.push(join(dir, e.name));
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

let violations = 0;
for (const abs of files) {
  const rel = relative(ROOT, abs).replaceAll('\\', '/');
  if (EXCLUDE_FILES.has(rel)) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('koyomi-terms-ok')) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        console.error(`${rel}:${i + 1}: 禁止用語 /${rule.re.source}/ → 推奨: ${rule.preferred}`);
        console.error(`    ${line.trim()}`);
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(
    `\n✖ 禁止用語が ${violations} 件見つかりました。docs/internal/terminology.md を参照してください。`,
  );
  console.error('  正当な例外は行に `koyomi-terms-ok` コメントを付けて除外できます。');
  process.exit(1);
}
console.log('✓ 用語チェック OK（禁止用語なし）');
