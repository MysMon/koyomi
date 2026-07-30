# Koyomi + Next.js App Router 例

[`@koyomi-cal/react`](https://www.npmjs.com/package/@koyomi-cal/react) を Next.js の App Router 上で SSR しながら使う最小構成の例です。

## `'use client'` 境界

Koyomi はドラッグ操作や「今日」の判定などブラウザ実行時の情報に依存するため、カレンダー本体は `'use client'` を付けたコンポーネントに切り出す必要があります。

- `app/page.tsx` — サーバーコンポーネント。ページの外枠のみを描画する
- `app/calendar-client.tsx` — `'use client'` を付けたクライアントコンポーネント。`useCalendar` / `CalendarProvider` / `Toolbar` / `CalendarView` はここに置く

`useCalendar` 自体は SSR 中の初回描画にも対応していますが、サーバーとクライアントで「今日」の判定がずれるハイドレーション差分を避けるため、`calendar-client.tsx` では `timeZone: 'Asia/Tokyo'` のように明示指定しています。

## `theme.css` の読み込み方

`@koyomi-cal/react/theme.css` はグローバルスタイルシートです。App Router ではグローバル CSS の import はルートレイアウト（`app/layout.tsx`）でのみ許可されるため、`layout.tsx` の先頭で import しています。

```tsx
// app/layout.tsx
import '@koyomi-cal/react/theme.css';
import './globals.css';
```

## オンラインで開く

このディレクトリは独立した `package.json` を持つため、StackBlitz / CodeSandbox でこのまま開けます。

- StackBlitz: `https://stackblitz.com/github/MysMon/koyomi/tree/main/examples/nextjs-app-router`
- CodeSandbox: `https://codesandbox.io/p/sandbox/github/MysMon/koyomi/tree/main/examples/nextjs-app-router`

## ローカルで実行する

```bash
cd examples/nextjs-app-router
npm install
npm run dev
```

`npm run build` で本番ビルド（SSR + 静的最適化）、`npm run start` でビルド結果の起動ができます。

他のビューへの切り替えやイベントハンドラの追加は [はじめに](../../docs/getting-started.md) を参照してください。
