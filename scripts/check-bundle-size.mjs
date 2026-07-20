#!/usr/bin/env node
/**
 * バンドルサイズ検証。
 *
 * ビルド済みの dist（`pnpm build` 後）を利用側アプリの立場でバンドルし、
 * tree-shaking の実効性をチェックする。`scripts/bundle-fixtures/` の
 * 最小アプリ 2 種（月ビューのみ / 全ビュー）を esbuild でバンドルし、
 * 次の 2 点を検証して違反があれば非ゼロ終了する。
 *
 * 1. 月ビューのみの import では、未使用ビューの React コンポーネントが
 *    バンドルに含まれない（代表としてタイムライン・年ビューのマーカー文字列で判定）
 * 2. ライブラリ寄与分（react / react-dom を除く）の gzip サイズが閾値以下
 *
 * 閾値は現状の実測値（docs/performance.md に記録）に約 1 割の余裕を
 * 持たせた粗い値で、機能追加による自然な増加ではなく、ビルド構成の変更で
 * tree-shaking が壊れる明確なリグレッションだけを検出する。
 *
 * 実行: pnpm build && node scripts/check-bundle-size.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, 'packages/react-calendar');

/** ライブラリ寄与分の gzip サイズ閾値（KB）。実測値 + 約 1 割の余裕 */
const GZIP_BUDGET_KB = {
  month: 48,
  full: 78,
};

/**
 * 月ビューのみのバンドルに含まれてはならないマーカー文字列。
 * 未使用ビューの React コンポーネントだけが持つ data 属性値を使う
 * （コアのビューモデルビルダーは `createCalendar` から常に参照されるため対象外）。
 */
const FORBIDDEN_IN_MONTH_ONLY = ['timeline-day-headers', 'year-month-grid'];

/**
 * フィクスチャを dist に対してバンドルし、サイズとバンドル内容を返す。
 *
 * react / react-dom は external にして、ライブラリ寄与分だけを測る。
 *
 * @param {string} name フィクスチャ名（bundle-fixtures/app-<name>.ts）
 * @param {string} outDir 出力先ディレクトリ
 * @returns {Promise<{ name: string, rawKb: number, gzipKb: number, code: string }>}
 */
async function bundleFixture(name, outDir) {
  const outfile = join(outDir, `${name}.js`);
  await build({
    entryPoints: [join(ROOT, 'scripts/bundle-fixtures', `app-${name}.ts`)],
    bundle: true,
    format: 'esm',
    minify: true,
    outfile,
    alias: {
      // 利用側からの解決を再現するため、公開エントリの実体（dist）を直接指す
      '@koyomi-cal/react': join(PKG_DIR, 'dist/index.js'),
    },
    external: ['react', 'react-dom'],
    define: { 'process.env.NODE_ENV': '"production"' },
    // dist のチャンクは package.json の sideEffects 宣言により副作用なしと
    // 扱われるため、実行順維持のみの bare import の除去は意図どおり。警告を抑止する
    logOverride: { 'ignored-bare-import': 'silent' },
    logLevel: 'warning',
  });
  const code = readFileSync(outfile, 'utf8');
  const raw = Buffer.byteLength(code);
  const gzip = gzipSync(code, { level: 9 }).byteLength;
  return { name, rawKb: raw / 1024, gzipKb: gzip / 1024, code };
}

const outDir = mkdtempSync(join(tmpdir(), 'koyomi-bundle-'));
const failures = [];
try {
  const month = await bundleFixture('month', outDir);
  const full = await bundleFixture('full', outDir);

  console.log('ライブラリ寄与分のバンドルサイズ（react / react-dom を除く）:');
  for (const r of [month, full]) {
    const budget = GZIP_BUDGET_KB[r.name];
    console.log(
      `  app-${r.name}: raw=${r.rawKb.toFixed(1)}KB gzip=${r.gzipKb.toFixed(1)}KB（閾値 ${budget}KB）`,
    );
    if (r.gzipKb > budget) {
      failures.push(
        `app-${r.name} の gzip サイズ ${r.gzipKb.toFixed(1)}KB が閾値 ${budget}KB を超過`,
      );
    }
  }

  for (const marker of FORBIDDEN_IN_MONTH_ONLY) {
    if (month.code.includes(marker)) {
      failures.push(
        `月ビューのみのバンドルに未使用ビューのマーカー "${marker}" が含まれる（tree-shaking が壊れている）`,
      );
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\nバンドルサイズ検証に失敗:');
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}
console.log('バンドルサイズ検証 OK');
