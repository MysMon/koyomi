/**
 * ベンチマーク計測の共通ヘルパー。
 *
 * デモアプリの「ストレステスト」パターン（`#/stress`）をクエリパラメータ付きで
 * 開き、パターンが `data-stress-*` 属性として公開する計測結果
 * （データ生成時間・初回描画時間）を読み取る。データ生成はデモアプリ側の
 * `makeManyResources` / `makeStressEvents`（`apps/demo/src/sample-data.ts`）が
 * 行うため、ストレステストパターンとベンチマークは常に同じデータで動く。
 */

import { expect, type Page } from '@playwright/test';

/** ベンチマークで計測対象にするビュー（いずれも仮想化コンポーネント）。 */
export type StressView = 'resource' | 'timeline' | 'list';

/** 計測 1 構成分の指定（イベント件数 × リソース件数 × ビュー）。 */
export interface StressConfig {
  /** 生成するイベント総件数。 */
  events: number;
  /** 生成するリソース件数。 */
  resources: number;
  /** 表示するビュー。 */
  view: StressView;
}

/** ストレステストパターンを指定構成で開く URL（`baseURL` からの相対）。 */
export function stressUrl(config: StressConfig): string {
  return `/#/stress?events=${config.events}&resources=${config.resources}&view=${config.view}`;
}

/** 初回描画計測の 1 サンプル。 */
export interface RenderSample {
  /** データ生成の所要時間（ミリ秒）。 */
  generateMs: number;
  /** 初回描画の所要時間（マウント開始〜ペイント完了。ミリ秒）。 */
  renderMs: number;
}

/**
 * 指定構成でページを開き直し、初回描画の計測結果を 1 サンプル取得する。
 *
 * @param page - Playwright のページ
 * @param config - 計測する構成
 * @param timeoutMs - 描画完了（`data-stress-ready`）を待つ上限（ミリ秒）
 */
export async function measureInitialRender(
  page: Page,
  config: StressConfig,
  timeoutMs = 120_000,
): Promise<RenderSample> {
  // 同一ページ内のハッシュ遷移にならないよう、毎回 about:blank を経由して
  // フルロードで開き直す
  await page.goto('about:blank');
  await page.goto(stressUrl(config));
  const frame = page.locator('[data-stress-frame]');
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: timeoutMs });
  return {
    generateMs: Number(await frame.getAttribute('data-stress-generate-ms')),
    renderMs: Number(await frame.getAttribute('data-stress-render-ms')),
  };
}

/** スクロール計測の集計結果。 */
export interface ScrollMetrics {
  /** 採取したフレーム数。 */
  frames: number;
  /** 1 フレームあたりの平均所要時間（ミリ秒）。 */
  avgFrameMs: number;
  /** 最も遅かったフレームの所要時間（ミリ秒）。 */
  maxFrameMs: number;
}

/**
 * スクロールコンテナを 1 フレームごとに一定量ずつスクロールし、
 * フレーム時間（rAF 間隔）を採取して集計する。
 *
 * 仮想化ビューではスクロールのたびに可視ウィンドウの再計算・DOM の
 * 差し替えが起きるため、フレーム時間がそのままスクロール性能の指標になる。
 *
 * @param page - Playwright のページ
 * @param selector - スクロールコンテナのセレクタ（例: `[data-koyomi="timeline-body"]`）
 * @param deltaX - 1 フレームあたりの横スクロール量（ピクセル）
 * @param deltaY - 1 フレームあたりの縦スクロール量（ピクセル）
 * @param frameCount - 採取するフレーム数
 */
export async function measureScroll(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY: number,
  frameCount = 90,
): Promise<ScrollMetrics> {
  const durations = await page.evaluate(
    (args) =>
      new Promise<number[]>((resolve, reject) => {
        const element = document.querySelector(args.selector);
        if (!(element instanceof HTMLElement)) {
          reject(new Error(`スクロールコンテナが見つかりません: ${args.selector}`));
          return;
        }
        const sampled: number[] = [];
        let last = performance.now();
        let index = 0;
        const step = (): void => {
          element.scrollLeft += args.deltaX;
          element.scrollTop += args.deltaY;
          requestAnimationFrame(() => {
            const now = performance.now();
            sampled.push(now - last);
            last = now;
            index += 1;
            if (index < args.frameCount) {
              step();
            } else {
              resolve(sampled);
            }
          });
        };
        step();
      }),
    { selector, deltaX, deltaY, frameCount },
  );
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    frames: durations.length,
    avgFrameMs: total / durations.length,
    maxFrameMs: Math.max(...durations),
  };
}

/** 編集操作ベンチマーク 1 回分の計測結果。 */
export interface MutationSample {
  /** 一括実行した件数（作成・更新・削除それぞれ）。 */
  count: number;
  /** `createEvent` を一括実行した合計所要時間（ミリ秒）。 */
  createMs: number;
  /** `updateEvent` を一括実行した合計所要時間（ミリ秒）。 */
  updateMs: number;
  /** `deleteEvent` を一括実行した合計所要時間（ミリ秒）。 */
  deleteMs: number;
}

/**
 * 指定構成でページを開き直し、編集操作（`createEvent`/`updateEvent`/
 * `deleteEvent` の一括実行）の所要時間を 1 サンプル取得する。
 *
 * ストレステストパターンの「編集操作を計測」ボタン（`[data-stress-mutate]`）を
 * クリックしてベンチマークを開始し、結果が `data-stress-mutate-*` 属性に
 * 反映されるのを待つ。計測対象はカレンダーの状態規模（`config.events` /
 * `config.resources`）であり、`config.view` は初回描画のみに影響する。
 *
 * @param page - Playwright のページ
 * @param config - 計測する構成
 * @param timeoutMs - 初回描画・計測完了を待つ上限（ミリ秒）
 */
export async function measureMutations(
  page: Page,
  config: StressConfig,
  timeoutMs = 120_000,
): Promise<MutationSample> {
  await page.goto('about:blank');
  await page.goto(stressUrl(config));
  const frame = page.locator('[data-stress-frame]');
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: timeoutMs });
  await page.locator('[data-stress-mutate]').click();
  await expect(frame).toHaveAttribute('data-stress-mutate-create-ms', /.+/, {
    timeout: timeoutMs,
  });
  return {
    count: Number(await frame.getAttribute('data-stress-mutate-count')),
    createMs: Number(await frame.getAttribute('data-stress-mutate-create-ms')),
    updateMs: Number(await frame.getAttribute('data-stress-mutate-update-ms')),
    deleteMs: Number(await frame.getAttribute('data-stress-mutate-delete-ms')),
  };
}

/** 数値配列の中央値を返す（偶数個のときは中央 2 値の平均）。 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) {
    throw new Error('median: 空の配列には対応していません');
  }
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}
