import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テストの決定性のためタイムゾーンを固定する。
    // マルチタイムゾーンの検証は @date-fns/tz の TZDate を用いて明示的に行う。
    env: {
      TZ: 'Asia/Tokyo',
    },
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/index.ts', 'src/core.ts'],
      // 大幅な劣化を CI で検知するための下限。実測値からおよそ 0.5〜1 ポイント
      // 差し引いた値。src/core/ は React 非依存のコアロジックのため、
      // より高い個別下限を課す。
      thresholds: {
        statements: 92,
        branches: 82.5,
        functions: 96.5,
        lines: 92,
        'src/core/**': {
          statements: 96.3,
          branches: 90,
          functions: 97.7,
          lines: 96.2,
        },
      },
    },
  },
});
