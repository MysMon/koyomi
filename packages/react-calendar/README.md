# @koyomi-cal/react

ヘッドレスな TypeScript/React カレンダーライブラリ **Koyomi（暦）**。

- 📅 **4 つのビュー** — 月・週・日・リスト表示を切り替え可能
- 🖱️ **Google カレンダー相当の操作** — ドラッグでの予定作成・移動・リサイズ、繰り返し予定の「この予定のみ / これ以降 / すべて」編集、キーボードショートカット
- 🎨 **ヘッドレス設計** — クラス名を持たず、`data-koyomi-*` 属性のみを出力。スタイルは自由に当てられ、デフォルトテーマも同梱
- 🌏 **マルチタイムゾーン** — 予定ごとのタイムゾーンと表示タイムゾーンの切り替え、DST に完全対応（date-fns v4 + @date-fns/tz）
- 🔁 **RRULE 完全対応** — RFC 5545 の繰り返しルールをサポート（rrule）
- ♿ **アクセシブル** — すべての操作要素に日本語の `aria-label` / キーボード操作を用意

## インストール

```bash
pnpm add @koyomi-cal/react
# npm install @koyomi-cal/react / yarn add @koyomi-cal/react
```

`react` / `react-dom` 18 以上が peerDependencies です。ESM のみで配布しています。

## クイックスタート

```tsx
import {
  CalendarProvider,
  CalendarView,
  Toolbar,
  useCalendar,
} from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'month',
    events: [
      { id: '1', title: '会議', start: '2026-07-01T10:00', end: '2026-07-01T11:00' },
      { id: '2', title: '合宿', start: '2026-07-08', end: '2026-07-10', allDay: true },
      { id: '3', title: '朝会', start: '2026-07-01T09:00', rrule: 'FREQ=DAILY' },
    ],
  });

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{ onEventClick: (occurrence) => console.log(occurrence.event.title) }}
    >
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}
```

これだけで、ドラッグでの予定作成・移動・リサイズ、ビュー切替、繰り返し予定の展開が動きます。

## ドキュメント

詳細は [リポジトリの docs/](https://github.com/koyomi-cal/koyomi/tree/main/docs) を参照してください。

- [はじめに](https://github.com/koyomi-cal/koyomi/blob/main/docs/getting-started.md)
- [ビュー（月・週・日・リスト）](https://github.com/koyomi-cal/koyomi/blob/main/docs/views.md)
- [予定の管理](https://github.com/koyomi-cal/koyomi/blob/main/docs/events.md)
- [インタラクション（作成・移動・リサイズ）](https://github.com/koyomi-cal/koyomi/blob/main/docs/interactions.md)
- [繰り返し予定](https://github.com/koyomi-cal/koyomi/blob/main/docs/recurrence.md)
- [タイムゾーン](https://github.com/koyomi-cal/koyomi/blob/main/docs/timezones.md)
- [テーマとスタイリング](https://github.com/koyomi-cal/koyomi/blob/main/docs/theming.md)
- [API リファレンス](https://github.com/koyomi-cal/koyomi/blob/main/docs/api.md)

## ライセンス

[MIT](./LICENSE) © Yutaro Fujikawa
