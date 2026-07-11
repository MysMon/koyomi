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
    },
  },
});
