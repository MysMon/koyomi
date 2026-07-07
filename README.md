# Koyomi（@koyomi/react）

ヘッドレスな TypeScript/React カレンダーライブラリ。

- 📅 **4 つのビュー** — 月・週・日・リスト表示を切り替え可能
- 🖱️ **Google カレンダー相当の操作** — ドラッグでの予定作成・移動・リサイズ、繰り返し予定の「この予定のみ / これ以降 / すべて」編集、キーボード操作
- 🎨 **ヘッドレス設計** — ロジックとマークアップのみを提供し、スタイルは自由。デフォルトテーマも同梱
- 🌏 **マルチタイムゾーン** — 予定ごとのタイムゾーンと表示タイムゾーンの切り替えに対応（date-fns v4 + @date-fns/tz）
- 🔁 **RRULE 完全対応** — RFC 5545 の繰り返しルールをサポート（rrule）
- 🧪 **TDD** — Vitest によるテスト駆動開発

## ドキュメント

[docs/](./docs/) を参照してください。

- [はじめに](./docs/getting-started.md)
- [ビュー（月・週・日・リスト）](./docs/views.md)
- [予定の管理](./docs/events.md)
- [インタラクション（作成・移動・リサイズ）](./docs/interactions.md)
- [繰り返し予定](./docs/recurrence.md)
- [タイムゾーン](./docs/timezones.md)
- [テーマとスタイリング](./docs/theming.md)
- [API リファレンス](./docs/api.md)

## 開発

```bash
pnpm install
pnpm check   # Lint + 型チェック + テスト
pnpm demo    # デモアプリを起動
```

モノレポ構成やコーディング規約は [CLAUDE.md](./CLAUDE.md) を参照。
