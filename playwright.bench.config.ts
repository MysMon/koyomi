import { defineConfig, devices } from '@playwright/test';

/**
 * 性能ベンチマーク（`bench/`）専用の Playwright 設定。
 *
 * 通常の E2E（`playwright.config.ts` / `e2e/`）とは独立して実行する。
 * 計測ノイズを抑えるため、次の点が通常の E2E と異なる。
 *
 * - デモアプリを開発サーバーではなく**本番ビルド**（`vite build` + `vite preview`）
 *   で配信する（React の開発モード・変換のオーバーヘッドを計測に含めないため）
 * - Chromium のみ・ワーカー 1・リトライ無しで直列に実行する
 *
 * 実行コマンド: `pnpm bench`（計測スイート） / `pnpm bench:ci`（閾値チェック）
 */
export default defineConfig({
  testDir: './bench',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    screenshot: 'off',
    trace: 'off',
  },
  webServer: {
    command: 'pnpm --filter @koyomi-cal/demo bench:serve',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
