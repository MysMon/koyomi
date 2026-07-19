# Koyomi（@koyomi-cal/react）

ヘッドレスな TypeScript/React カレンダーライブラリ。

- 📅 **8 つのビュー** — 月・週・日・リストに加え、年・複数月・リソース・タイムライン（後者 4 つは opt-in）を切り替え可能（`hiddenWeekdays` で週末非表示も）。リソースは `parentId` で階層グルーピング・折りたたみ、タイムラインは `timelineScale` で時刻/日/週/月のズーム粒度を切替
- 🖱️ **Google カレンダー相当の操作** — ドラッグでの予定作成・移動・両端リサイズ、終日 ⇔ 時間指定のドラッグ変換、繰り返し予定の「この予定のみ / これ以降 / すべて」編集、タッチ対応。`eventOverlap` / `eventConstraint` で重なり・配置を宣言的に制限
- ⌨️ **キーボード完結** — ショートカットに加え、矢印キーでの予定の移動・リサイズ・削除・作成
- ↩️ **undo/redo** — `useCalendarHistory` で操作履歴の取り消し・やり直し（キーボードショートカットは opt-in）
- ♿ **aria-live 通知** — `useCalendarAnnouncer` で予定の変更・作成・削除・表示切替をスクリーンリーダーへ通知
- 🎨 **ヘッドレス設計** — ロジックとマークアップのみを提供し、スタイルは自由。デフォルトテーマ（ダークモード・RTL 対応）も同梱
- 🌐 **多言語対応** — 中央メッセージカタログ（`ja`/`en` 同梱）が `locale` に連動し、`CalendarProvider` の `messages` prop でグループ単位に部分上書き・自前ロケールの追加も可能。時刻ラベルは 12/24 時間制に自動追従
- 🌏 **マルチタイムゾーン** — 予定ごとのタイムゾーンと表示タイムゾーンの切り替えに対応（date-fns v4 + @date-fns/tz）
- 🔁 **RRULE 対応** — RFC 5545 の主要な繰り返しパターンに加え、RDATE / EXDATE 相当（`rdates` / `exdates`）をサポート（rrule）。`useRecurrenceRuleEditor` で構造化状態としてのフォーム編集にも対応
- 📜 **大量の予定に対応** — 可視範囲だけを描画するリストの仮想化（`VirtualListView`、opt-in）
- 🧪 **TDD** — Vitest によるテスト駆動開発（2,300 超のテスト）

## ドキュメント

[docs/](./docs/) を参照してください。

- [はじめに](./docs/getting-started.md)
- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./docs/views.md)
- [予定の管理](./docs/events.md)
- [インタラクション（作成・移動・リサイズ）](./docs/interactions.md)
- [繰り返し予定](./docs/recurrence.md)
- [iCalendar（ICS）入出力](./docs/ics.md)
- [アクセシビリティ](./docs/accessibility.md)
- [タイムゾーン](./docs/timezones.md)
- [テーマとスタイリング](./docs/theming.md)
- [カスタマイズガイド](./docs/customization.md)
- [API リファレンス](./docs/api.md)

## インストール

```bash
pnpm add @koyomi-cal/react
```

## 開発

```bash
pnpm install
pnpm check   # 用語・テスト配置 + Lint + 型チェック + Vitest
pnpm test:e2e # Playwright（Chromium / Firefox / WebKit / touch / axe）
pnpm bench   # 性能ベンチマーク（docs/performance.md に実測値の例）
pnpm demo    # デモアプリを起動
```

- モノレポ構成やコーディング規約は [CLAUDE.md](./CLAUDE.md) を参照
- 変更履歴は [CHANGELOG.md](./CHANGELOG.md) を参照
- npm への公開手順は [docs/publishing.md](./docs/publishing.md) を参照

## ライセンス

[MIT](./LICENSE) © Yutaro Fujikawa
