# Koyomi の実行可能なサンプル

`@koyomi-cal/react` をすぐに動かして試せる、独立した構成のサンプル集です。各ディレクトリは単体の `package.json` を持ち、モノレポの `pnpm-workspace.yaml` には含まれません（`pnpm install` / `pnpm check` の対象外）。ライブラリ本体を npm から取得するので、それぞれ単独で `npm install` して動かせます。

| サンプル | 内容 |
| --- | --- |
| [vite-minimal](./vite-minimal) | Vite + React。月ビューとドラッグ操作（作成・移動・リサイズ）の最小構成 |
| [nextjs-app-router](./nextjs-app-router) | Next.js App Router。SSR セットアップと `'use client'` 境界、`theme.css` の読み込み方 |

各サンプルの README に StackBlitz / CodeSandbox で直接開くリンクとローカル実行手順を記載しています。
