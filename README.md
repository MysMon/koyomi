# Koyomi（@koyomi-cal/react）

日本語（正式なドキュメント） ・ **[English README](./README.en.md)**

ヘッドレスな TypeScript/React カレンダーライブラリ。

- 📅 **8 つのビュー** — 月・週・日・リスト・年・複数月・リソース・タイムライン。リソースの階層グルーピングとタイムラインのズーム粒度切替に対応
- 🖱️ **Google カレンダー相当の操作** — ドラッグでの作成・移動・両端リサイズ、終日 ⇔ 時間指定の変換、繰り返し予定の「この予定のみ / これ以降 / すべて」編集、コピー&ペースト・複製、タッチ対応。重なり・配置は宣言的に制限できる
- ⌨️ **キーボード完結** — マウスでできる予定の操作（作成・移動・リサイズ・終日変換・削除）はキーボードだけでも行え、削除後もフォーカスが途切れない
- ♿ **スクリーンリーダー対応** — 予定の変更・作成・削除・操作の拒否・表示切替を aria-live で通知
- ↩️ **undo/redo** — 操作履歴の取り消し・やり直し
- 🎨 **ヘッドレス設計** — ロジックとマークアップのみを提供し、スタイルは `data-koyomi-*` 属性への CSS で自由。ダークモード・RTL 対応のデフォルトテーマも同梱
- 🌐 **多言語対応** — メッセージカタログ（`ja` / `en` 同梱）の部分上書きと自前ロケールの追加、12/24 時間制の自動追従
- 🌏 **マルチタイムゾーン** — 予定ごとのタイムゾーンと表示タイムゾーンの独立した切り替え、セカンダリタイムゾーン軸の並記（date-fns v4 + @date-fns/tz）
- 🔁 **繰り返し予定** — RFC 5545 RRULE の主要パターンと RDATE / EXDATE に対応し、構造化状態のフォームエディタを同梱
- 🗓️ **iCalendar（ICS）入出力** — 繰り返し・オーバーライド・「これ以降」のシリーズ分割まで解釈する `.ics` の入出力と、不正な VEVENT を読み飛ばす部分取り込み
- 📜 **大量の予定・リソースに対応** — 可視範囲だけを描画する仮想化ビュー、あふれの「+N 件」集約、可視範囲に応じた増分データ取得
- 🧪 **TDD** — Vitest によるテスト駆動開発（3,400 超のテスト）と実ブラウザ E2E（axe による WCAG 自動検査を含む）

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
- [English documentation (docs/en/)](./docs/en/README.md)
- [サンプル（StackBlitz / CodeSandbox で開ける examples/）](./examples/)

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
