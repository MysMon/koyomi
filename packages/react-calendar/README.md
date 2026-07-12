# @koyomi-cal/react

ヘッドレスな TypeScript/React カレンダーライブラリ **Koyomi（暦）**。

- 📅 **8 つのビュー** — 月・週・日・リストに加え、年・複数月・リソース・タイムライン（後者 4 つは opt-in）を切り替え可能（`hiddenWeekdays` で週末非表示も）
- 🖱️ **Google カレンダー相当の操作** — ドラッグでの予定作成・移動・両端リサイズ、終日 ⇔ 時間指定のドラッグ変換、繰り返し予定の「この予定のみ / これ以降 / すべて」編集、タッチ・オートスクロール対応
- ⌨️ **キーボード対応** — ショートカット（t/m/w/d/a/y/q/r/l/j/k/c）に加え、フォーカス中の予定への矢印キーでの移動・リサイズ・削除・作成
- 🎨 **ヘッドレス設計** — クラス名を持たず、`data-koyomi-*` 属性のみを出力。スタイルは自由に当てられ、デフォルトテーマ（ダークモード・RTL 対応）も同梱。UI 文言はすべて props で差し替え可能
- 🌏 **マルチタイムゾーン** — 予定ごとのタイムゾーンと表示タイムゾーンの切り替え、DST に完全対応（date-fns v4 + @date-fns/tz）
- 🔁 **RRULE 対応** — RFC 5545 の主要な繰り返しパターンに加え、RDATE / EXDATE 相当（`rdates` / `exdates`）をサポート（rrule）
- ♿ **アクセシブル** — WAI-ARIA grid ロール、完全な日付の `aria-label`、フォーカスリング、主要な予定操作のキーボード対応（既知の制限は [アクセシビリティ](https://github.com/koyomi-cal/koyomi/blob/main/docs/accessibility.md) を参照）
- 🖥️ **SSR 対応** — Next.js 等のサーバーレンダリングでも例外なく初期描画が可能
- 📜 **大量の予定に対応** — 可視範囲だけを描画するリストの仮想化（`VirtualListView`、opt-in）

## インストール

```bash
pnpm add @koyomi-cal/react
# npm install @koyomi-cal/react / yarn add @koyomi-cal/react
```

`react` / `react-dom` 19 系が peerDependencies です。ESM のみで配布しています。

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
- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](https://github.com/koyomi-cal/koyomi/blob/main/docs/views.md)
- [予定の管理](https://github.com/koyomi-cal/koyomi/blob/main/docs/events.md)
- [インタラクション（作成・移動・リサイズ）](https://github.com/koyomi-cal/koyomi/blob/main/docs/interactions.md)
- [繰り返し予定](https://github.com/koyomi-cal/koyomi/blob/main/docs/recurrence.md)
- [アクセシビリティ](https://github.com/koyomi-cal/koyomi/blob/main/docs/accessibility.md)
- [タイムゾーン](https://github.com/koyomi-cal/koyomi/blob/main/docs/timezones.md)
- [テーマとスタイリング](https://github.com/koyomi-cal/koyomi/blob/main/docs/theming.md)
- [API リファレンス](https://github.com/koyomi-cal/koyomi/blob/main/docs/api.md)

## ライセンス

[MIT](./LICENSE) © Yutaro Fujikawa
