import { defineConfig } from 'tsup';

export default defineConfig({
  // すべてのソースファイルをエントリにして 1 ソース = 1 出力のモジュール構造を保つ。
  // 単一ファイルへ平坦化すると利用側バンドラの tree-shaking 粒度が粗くなり、
  // 未使用ビューのコードがバンドルに残るため（実測は docs/performance.md）。
  entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*', 'src/theme/default.css'],
  format: ['esm'],
  dts: {
    // 型定義は公開エントリ（. / ./core）のみ生成する
    entry: { index: 'src/index.ts', core: 'src/core.ts' },
  },
  sourcemap: true,
  clean: true,
  splitting: true,
  external: ['react', 'react-dom'],
  // rrule は CJS-only（UMD バンドル）のため、外部依存のままだと素の Node ESM から
  // `import { RRule } from 'rrule'` の named export 解決に失敗し、パッケージ全体が
  // 読み込み時に落ちる。dist にバンドルして Node 単体でも動くようにする。
  noExternal: ['rrule'],
});
