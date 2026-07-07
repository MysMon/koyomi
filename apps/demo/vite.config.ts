import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // ワークスペース内のライブラリをビルドせずソースのまま参照する
      '@koyomi-cal/react/theme.css': new URL(
        '../../packages/react-calendar/src/theme/default.css',
        import.meta.url,
      ).pathname,
      '@koyomi-cal/react': new URL('../../packages/react-calendar/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});
