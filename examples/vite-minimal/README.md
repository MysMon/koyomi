# Koyomi 最小構成デモ（Vite）

[`@koyomi-cal/react`](https://www.npmjs.com/package/@koyomi-cal/react) を Vite + React で使う最小構成の例です。月ビューを表示するだけで、予定のドラッグ移動・端のドラッグでのリサイズ・空き領域のドラッグでの新規作成が最初から使えます。

## オンラインで開く

このディレクトリは独立した `package.json` を持つため、StackBlitz / CodeSandbox でこのまま開けます。

- StackBlitz: `https://stackblitz.com/github/MysMon/koyomi/tree/main/examples/vite-minimal`
- CodeSandbox: `https://codesandbox.io/p/sandbox/github/MysMon/koyomi/tree/main/examples/vite-minimal`

## ローカルで実行する

```bash
cd examples/vite-minimal
npm install
npm run dev
```

`npm run build` で本番ビルド、`npm run preview` でビルド結果の確認ができます。

## 構成

- `src/App.tsx` — `useCalendar` でカレンダーの状態を作成し、`CalendarProvider` 配下に `Toolbar` / `CalendarView` を配置している最小構成
- `src/main.tsx` — React のマウント処理
- `@koyomi-cal/react/theme.css` — デフォルトテーマの読み込み（`App.tsx` の先頭で import）

他のビューへの切り替えやイベントハンドラの追加は [はじめに](../../docs/getting-started.md) を参照してください。
