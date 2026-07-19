/**
 * 性能ベンチマークスイート（`pnpm bench`）。
 *
 * デモアプリの「ストレステスト」パターン（`#/stress`、本番ビルド）を
 * 代表構成（イベント件数 × リソース件数）ごとに開き直し、次を計測する。
 *
 * - **初回描画時間** — マウント開始〜ペイント完了（`data-stress-render-ms`）。
 *   構成 × ビューごとに {@link RUNS} 回計測し、中央値を採用する
 * - **スクロール性能** — リソース/タイムラインビューのスクロールコンテナを
 *   1 フレームごとに一定量スクロールしたときのフレーム時間（平均・最大）
 *
 * 結果は `bench/results/latest.json`（機械可読）と `bench/results/latest.md`
 * （`docs/performance.md` へ転記できる Markdown 表）に保存し、標準出力にも表示する。
 * このスイートは計測のみで性能の合否判定はしない（閾値チェックは
 * `bench/regression.spec.ts`）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import {
  measureInitialRender,
  measureScroll,
  median,
  type ScrollMetrics,
  type StressView,
} from './measure';

/** 構成 × ビューごとの初回描画の計測回数（中央値を採用する）。 */
const RUNS = 3;

/** 計測する代表構成（イベント件数 × リソース件数）。 */
const CONFIGS: readonly { events: number; resources: number }[] = [
  { events: 1_000, resources: 100 },
  { events: 10_000, resources: 100 },
  { events: 1_000, resources: 1_000 },
  { events: 10_000, resources: 1_000 },
];

/** 計測するビュー。 */
const VIEWS: readonly StressView[] = ['resource', 'timeline', 'list'];

/** スクロール計測で採取するフレーム数。 */
const SCROLL_FRAMES = 90;

/** 初回描画の計測結果 1 行分。 */
interface RenderResult {
  kind: 'render';
  events: number;
  resources: number;
  view: StressView;
  /** データ生成時間の中央値（ミリ秒）。 */
  generateMs: number;
  /** 初回描画時間の中央値（ミリ秒）。 */
  renderMs: number;
  /** 各回の初回描画時間（ミリ秒）。 */
  renderSamplesMs: number[];
}

/** スクロールの計測結果 1 行分。 */
interface ScrollResult extends ScrollMetrics {
  kind: 'scroll';
  events: number;
  resources: number;
  view: StressView;
  /** スクロール方向の説明。 */
  direction: string;
}

const renderResults: RenderResult[] = [];
const scrollResults: ScrollResult[] = [];
let browserVersion = '';

test.describe.configure({ mode: 'serial' });

for (const config of CONFIGS) {
  for (const view of VIEWS) {
    test(`初回描画: ${view} / イベント ${config.events} 件 × リソース ${config.resources} 件`, async ({
      page,
    }) => {
      browserVersion = page.context().browser()?.version() ?? '';
      const samples = [];
      for (let run = 0; run < RUNS; run += 1) {
        samples.push(await measureInitialRender(page, { ...config, view }));
      }
      renderResults.push({
        kind: 'render',
        events: config.events,
        resources: config.resources,
        view,
        generateMs: median(samples.map((sample) => sample.generateMs)),
        renderMs: median(samples.map((sample) => sample.renderMs)),
        renderSamplesMs: samples.map((sample) => sample.renderMs),
      });
    });
  }

  test(`スクロール: timeline / イベント ${config.events} 件 × リソース ${config.resources} 件`, async ({
    page,
  }) => {
    await measureInitialRender(page, { ...config, view: 'timeline' });
    // 縦（行 = リソース）と横（時間軸）を同時にスクロールし、二軸仮想化の
    // 可視ウィンドウ更新を含むフレーム時間を測る
    const metrics = await measureScroll(
      page,
      '[data-koyomi="timeline-body"]',
      96,
      48,
      SCROLL_FRAMES,
    );
    scrollResults.push({
      kind: 'scroll',
      events: config.events,
      resources: config.resources,
      view: 'timeline',
      direction: '縦 48px + 横 96px / フレーム',
      ...metrics,
    });
  });

  test(`スクロール: resource / イベント ${config.events} 件 × リソース ${config.resources} 件`, async ({
    page,
  }) => {
    await measureInitialRender(page, { ...config, view: 'resource' });
    // 横（リソース列）方向の仮想化スクロール
    const metrics = await measureScroll(page, '[data-koyomi="resource"]', 96, 0, SCROLL_FRAMES);
    scrollResults.push({
      kind: 'scroll',
      events: config.events,
      resources: config.resources,
      view: 'resource',
      direction: '横 96px / フレーム',
      ...metrics,
    });
  });
}

test.afterAll(() => {
  if (renderResults.length === 0 && scrollResults.length === 0) {
    return;
  }
  const cpu = cpus()[0];
  const environment = {
    date: new Date().toISOString(),
    os: `Linux ${release()}`,
    cpu: cpu === undefined ? '不明' : `${cpu.model} × ${cpus().length}`,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    browser: `Chromium ${browserVersion}（ヘッドレス）`,
    build: 'vite build（本番ビルド）',
  };

  const renderTable = [
    '| イベント件数 | リソース件数 | ビュー | データ生成 (ms) | 初回描画 (ms) |',
    '| ---: | ---: | --- | ---: | ---: |',
    ...renderResults.map(
      (row) =>
        `| ${row.events.toLocaleString('ja-JP')} | ${row.resources.toLocaleString('ja-JP')} | ${row.view} | ${row.generateMs.toFixed(0)} | ${row.renderMs.toFixed(0)} |`,
    ),
  ].join('\n');
  const scrollTable = [
    '| イベント件数 | リソース件数 | ビュー | スクロール量 | 平均フレーム (ms) | 最大フレーム (ms) |',
    '| ---: | ---: | --- | --- | ---: | ---: |',
    ...scrollResults.map(
      (row) =>
        `| ${row.events.toLocaleString('ja-JP')} | ${row.resources.toLocaleString('ja-JP')} | ${row.view} | ${row.direction} | ${row.avgFrameMs.toFixed(1)} | ${row.maxFrameMs.toFixed(1)} |`,
    ),
  ].join('\n');

  const markdown = [
    '# ベンチマーク結果',
    '',
    `- 計測日時: ${environment.date}`,
    `- OS: ${environment.os}`,
    `- CPU: ${environment.cpu}`,
    `- メモリ: ${environment.memoryGiB} GiB`,
    `- Node: ${environment.node}`,
    `- ブラウザ: ${environment.browser}`,
    `- ビルド: ${environment.build}`,
    '',
    `## 初回描画時間（${RUNS} 回の中央値）`,
    '',
    renderTable,
    '',
    `## スクロール性能（${SCROLL_FRAMES} フレーム連続スクロール）`,
    '',
    scrollTable,
    '',
  ].join('\n');

  // `pnpm bench` はリポジトリルートで実行する規約（CLAUDE.md）のため、
  // カレントディレクトリ基準で results の場所を決める
  const resultsDir = join(process.cwd(), 'bench', 'results');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, 'latest.json'),
    `${JSON.stringify({ environment, runs: RUNS, renderResults, scrollResults }, null, 2)}\n`,
  );
  writeFileSync(join(resultsDir, 'latest.md'), markdown);

  console.log(`\n${markdown}`);
  console.log(`結果を保存しました: ${join(resultsDir, 'latest.json')} / latest.md`);
});
