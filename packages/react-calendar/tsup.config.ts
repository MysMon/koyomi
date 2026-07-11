import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core.ts',
    theme: 'src/theme/default.css',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  // rrule は CJS-only（UMD バンドル）のため、外部依存のままだと素の Node ESM から
  // `import { RRule } from 'rrule'` の named export 解決に失敗し、パッケージ全体が
  // 読み込み時に落ちる。dist にバンドルして Node 単体でも動くようにする。
  noExternal: ['rrule'],
});
