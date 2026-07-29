/**
 * 性能リグレッション検出（`pnpm bench:ci`）。
 *
 * 最重量の代表構成（イベント 10,000 件 × リソース 1,000 件）だけを 1 回計測し、
 * **意図的に粗い閾値**と比較する。閾値は手元実測の中央値（`docs/performance.md`）
 * の約 10 倍に設定してあり、CI ランナーの速度差・負荷変動では超えず、
 * 計算量が悪化するような明確な性能リグレッション（例: 仮想化の無効化、
 * O(n²) 化）だけを検出する。微小な性能変化の追跡は `pnpm bench` の
 * 計測結果（`bench/results/`）の比較で行う。
 */

import { expect, test } from '@playwright/test';
import { measureInitialRender, measureMutations, measureScroll } from './measure';

/** 閾値チェックに使う構成（計測対象の中で最重量の代表構成）。 */
const CONFIG = { events: 10_000, resources: 1_000 } as const;

/** 初回描画時間の上限（ミリ秒）。手元実測の中央値（約 1.4 秒）の約 10 倍の粗い閾値。 */
const RENDER_LIMIT_MS = 15_000;

/**
 * スクロール中の平均フレーム時間の上限（ミリ秒）。手元実測（約 16.5 ms、
 * vsync 上限で頭打ち）の約 30 倍の粗い閾値。仮想化が無効化されるなどして
 * フレームごとの再計算が件数に比例するようになった場合だけ検出する。
 */
const SCROLL_AVG_FRAME_LIMIT_MS = 500;

/**
 * 編集操作（`createEvent`/`updateEvent`/`deleteEvent` を 200 件ずつ一括実行）の
 * 合計所要時間の上限（ミリ秒）。手元実測の中央値の合計（約 1.1 秒）の約 10 倍の
 * 粗い閾値。配列コピーが件数の 2 乗に比例するようになった場合などを検出する。
 */
const MUTATION_LIMIT_MS = 12_000;

test('最重量構成の初回描画・スクロールが粗い閾値内に収まる', async ({ page }) => {
  const sample = await measureInitialRender(page, { ...CONFIG, view: 'timeline' });
  expect(sample.renderMs).toBeGreaterThan(0);
  expect(sample.renderMs).toBeLessThan(RENDER_LIMIT_MS);

  const metrics = await measureScroll(page, '[data-koyomi="timeline-body"]', 96, 48, 60);
  expect(metrics.avgFrameMs).toBeLessThan(SCROLL_AVG_FRAME_LIMIT_MS);
});

test('最重量構成の編集操作の一括実行が粗い閾値内に収まる', async ({ page }) => {
  const sample = await measureMutations(page, { ...CONFIG, view: 'list' });
  const totalMs = sample.createMs + sample.updateMs + sample.deleteMs;
  expect(totalMs).toBeGreaterThan(0);
  expect(totalMs).toBeLessThan(MUTATION_LIMIT_MS);
});
