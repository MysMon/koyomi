# Koyomi — ヘッドレス React カレンダーライブラリ

TypeScript/React 製のヘッドレスカレンダーライブラリのモノレポ。月・週・日・リスト表示、Google カレンダー相当のインタラクティブ操作（ドラッグ作成・移動・リサイズ、繰り返し予定の編集スコープ等）、マルチタイムゾーン、RRULE 完全対応を提供する。

## コマンド

すべてリポジトリルートで実行する。

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | Lint + 型チェック + テストを一括実行（コミット前に必須） |
| `pnpm test` | ライブラリのテストを一度実行 |
| `pnpm test:watch` | テストをウォッチモードで実行 |
| `pnpm typecheck` | 全パッケージの型チェック（`tsc --noEmit`） |
| `pnpm lint` / `pnpm lint:fix` | Biome によるチェック / 自動修正 |
| `pnpm build` | ライブラリを tsup でビルド |
| `pnpm demo` | デモアプリ（Vite）を起動 |

単一テストファイルの実行: `pnpm --filter @koyomi/react exec vitest run src/core/date-utils.test.ts`

## 構成

- `packages/react-calendar/` — ライブラリ本体（公開パッケージ `@koyomi/react`）
  - `src/core/` — **React 非依存**のコアロジック。日付/タイムゾーンユーティリティ、RRULE 展開、イベントストア、ビューモデル生成、レイアウトアルゴリズム
  - `src/react/` — React バインディング。フック、インタラクション（D&D 等）、ヘッドレスコンポーネント
  - `src/theme/` — デフォルトテーマ CSS（`@koyomi/react/theme.css` として公開）
- `apps/demo/` — Vite デモアプリ。ライブラリのソースを alias で直接参照する
- `docs/` — 利用者向けドキュメント（日本語）

### アーキテクチャの原則

- **core は React を import しない**。core → react の一方向依存のみ許可
- 状態管理はフレームワーク非依存の `createCalendar`（購読モデル）に集約し、React 側は `useSyncExternalStore` で購読する
- コンポーネントはヘッドレス。スタイルは `data-koyomi-*` 属性をフックにして当てる。デフォルトテーマはその属性に対する CSS のみで実現する

## 開発ルール

- **TDD 必須**: 実装より先に失敗するテストを書く（Red → Green → Refactor）。テストは実装ファイルと同階層の `*.test.ts(x)`
- **日本語**: コメント・TSDoc・ドキュメント・コミットメッセージはすべて日本語
- **TSDoc 必須**: `export` するすべての型・関数・コンポーネントに日本語 TSDoc（`@param` / `@returns` / `@example` を適切に）
- **型の厳しさ**: `any` 禁止（Biome でエラー）。`as` キャストは原則禁止、必要なら理由をコメントで併記。`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 有効
- **日付の扱い**: タイムゾーン依存の計算は必ず `src/core/timezone.ts` のユーティリティ経由で行う。素の `new Date()` の暗黙ローカル TZ に依存したロジックを core に書かない。テストは `TZ=Asia/Tokyo` 固定（`vitest.config.ts`）＋ `TZDate` で他 TZ を明示検証
- コミット前に `pnpm check` を通すこと
