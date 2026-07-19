#!/usr/bin/env node
/**
 * 英訳ファイルの対応関係チェック。
 *
 * `docs/` 配下の日本語ドキュメントは正式版であり、英訳は `docs/en/` に同期する
 * （方針は CONTRIBUTING.md を参照）。本スクリプトは、英訳を用意すると決めた
 * ページについて対応する英語ファイルが実在するかどうかだけを機械的に確認する
 * （内容が日本語版と一致しているかまでは検証しない、軽量なチェック）。
 *
 * `pnpm docs:en-pairs`（`pnpm check` からも呼ばれる）で実行し、対応ファイルが
 * 欠けていれば非ゼロ終了する。
 */
import { existsSync } from 'node:fs';

/**
 * 全訳を用意する日本語ドキュメントと、対応する英語ファイルの組。
 * 新しく全訳を追加する場合はここに追記する。
 */
const TRANSLATION_PAIRS = [
  { ja: 'README.md', en: 'README.en.md' },
  { ja: 'docs/getting-started.md', en: 'docs/en/getting-started.md' },
];

/**
 * 特定の日本語ファイルの全訳ではなく、英語ドキュメントの入り口として
 * 独立に必須のファイル（目次+主要概念サマリ、API リファレンスの見出し索引 等）。
 */
const REQUIRED_EN_ENTRY_POINTS = ['docs/en/README.md'];

let missing = 0;

for (const { ja, en } of TRANSLATION_PAIRS) {
  if (!existsSync(ja)) {
    console.error(`✖ ${ja} が見つかりません（TRANSLATION_PAIRS の設定を確認してください）`);
    missing++;
    continue;
  }
  if (!existsSync(en)) {
    console.error(`✖ ${ja} に対応する英訳 ${en} が見つかりません`);
    missing++;
  }
}

for (const en of REQUIRED_EN_ENTRY_POINTS) {
  if (!existsSync(en)) {
    console.error(`✖ 英語ドキュメントの入り口 ${en} が見つかりません`);
    missing++;
  }
}

if (missing > 0) {
  console.error(`\n✖ 英訳ファイルの対応関係チェックに失敗しました（${missing} 件）`);
  process.exit(1);
}
console.log('✓ 英訳ファイルの対応関係 OK');
