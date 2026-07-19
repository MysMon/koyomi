# コントリビューションガイド

Koyomi (`@koyomi-cal/react`) への貢献に関心を持っていただきありがとうございます。
このドキュメントは、コードの変更を提案する際に守ってほしいルールをまとめたものです。

## 開発環境のセットアップ

```bash
pnpm install
pnpm demo   # デモアプリ（Vite）を起動して動作を確認する
```

Node.js は `packages/react-calendar/package.json` の `engines`（`>=20.19.0`）を満たす
バージョンを使ってください。

## 変更を加える前に

- リポジトリ直下の `CLAUDE.md` に開発ルールとコマンド一覧がまとまっています。まず目を
  通してください
- テストの位置づけ・書き方は `docs/internal/testing.md`、利用者向けドキュメントの文体は
  `docs/internal/docs-style.md`、訳語の方針は `docs/internal/terminology.md` に従います

## TDD（テスト駆動開発）

Koyomi では **実装より先に失敗するテストを書く**（Red → Green → Refactor）ことを必須と
しています。

1. 期待する振る舞いをテストとして書き、失敗する（Red）ことを確認する
2. テストが通る最小限の実装を書く（Green）
3. 必要であれば実装を整理する（Refactor。テストが通り続けることを確認しながら行う）

テストは実装ファイルと同じディレクトリに `*.test.ts(x)` として置きます（1 実装ファイル
につき 1 テストファイル）。詳細な規約（`describe` の分類方針、境界条件の考え方など）は
`docs/internal/testing.md` を参照してください。

## コーディング規約

- **日本語**: コメント・TSDoc・ドキュメント・コミットメッセージはすべて日本語で書きます
- **`any` 禁止**: Biome の設定でエラーになります
- **`as` キャスト原則禁止**: どうしても必要な場合は、その理由をコメントで併記します
- **タイムゾーンの扱い**: タイムゾーン依存の計算は必ず `src/core/timezone.ts` の
  ユーティリティ経由で行います。素の `new Date()` の暗黙のローカルタイムゾーンに依存した
  ロジックを `src/core/` に書かないでください
- **公開 API を追加する場合**: 日本語 TSDoc（`@param`/`@returns`/`@example`）を付け、
  `src/index.ts`（core のものは `src/core.ts` も）から export し、`docs/api.md` に
  追記します。`docs/api.md` の見出し数は公開 export 数と 1:1 対応させてください

## 用語の統一

直訳調・不正確な訳語（例: 「壁時計」ではなく「現地時刻」）を避け、`docs/internal/terminology.md`
にまとまった推奨語を使ってください。新しい直訳調の語を見つけた場合は、推奨語を決めた上で
用語集と `scripts/check-terms.mjs` の両方に追記してください。

## ドキュメントは日本語が正

`docs/` 配下と TSDoc は日本語で記述したものが正式なドキュメントです。英訳は `docs/en/`
配下と `README.en.md` に置き、日本語版に追従させます。日本語版と英訳が食い違う場合は
日本語版を正としてください。

英訳の対応範囲は次のとおりです。

- `README.md` ⇔ `README.en.md`: 全訳
- `docs/getting-started.md` ⇔ `docs/en/getting-started.md`: 全訳
- `docs/en/README.md`: 英語ドキュメントの目次と主要概念のサマリ（個別ページの全訳では
  ない）。`docs/api.md` 等の他ページは見出しレベルの索引と日本語版へのリンクに留める
- 上記以外のページは英訳を用意していません。日本語版のみ参照してください

英訳を追加・更新する場合は、対象を `scripts/check-docs-translation-pairs.mjs` の
`TRANSLATION_PAIRS` に追記してください（`pnpm docs:en-pairs` / `pnpm check` が対応する
英語ファイルの存在を機械的に確認します。内容の一致までは検証しないため、日本語版を
更新した際は英訳側も追従させる必要があります）。翻訳の提案は歓迎しますが、日本語版との
内容の一致を保守できる体制を明示してください。

## コミット前の確認

コミットする前に、リポジトリルートで次のコマンドを実行し、すべて通ることを確認します。

```bash
pnpm check
```

`pnpm check` は Lint・型チェック・テストに加え、用語チェック（`pnpm terms`）と
テストファイルの対応チェック（`pnpm test:pairs`）を実行します。

## コミットメッセージ

形式は `type: 変更内容そのもの` です。

- `type` は `feat` / `fix` / `docs` / `test` / `refactor` / `perf` / `chore` / `ci` /
  `deps` のいずれか。破壊的変更を含む場合は `feat!:` のように `!` を付けます
- 件名には**変更内容そのもの**（何がどう変わるか）を書きます。「レビュー指摘を修正」
  「監査対応」のような、経緯や指摘元だけで内容が分からない件名は避けてください
- 変更の経緯・検証結果・関連 Issue へのリンクは本文に書きます

## ロケール（言語）を追加する

同梱の中央メッセージカタログ（`src/react/locales/`）は現在 `ja`（既定）・`en` の 2 言語です。
新しい言語を追加する場合は、次の手順で進めてください。

1. **既存のカタログを 1 つ選び、型を確認する**: `src/react/locales/types.ts` の
   `MessageCatalog` が、埋めるべき全グループ・全リーフの型です。`ja.ts` / `en.ts`
   のどちらかを参考実装として読むと、各リーフに何を渡せばよいか（固定文字列か、
   `occurrence` 等のドメインオブジェクトを受け取って文言を組み立てる関数か）が
   分かります
2. **`src/react/locales/<言語サブタグ>.ts` を作る**: `MessageCatalog` 型を満たす
   完全なカタログを 1 つ export します。既存言語と近い言語（例: 英語圏の別方言）
   を追加する場合は、全リーフを書き直す必要はありません。`createMessageCatalog`
   （`src/react/locales/resolve.ts` が公開するグループ単位のマージ関数）を使い、
   近い言語のカタログを `base` にして異なるリーフだけ `overrides` に渡せば
   完全なカタログを合成できます

   ```ts
   import { createMessageCatalog } from './resolve';
   import { enMessages } from './en';

   export const enGbMessages = createMessageCatalog(enMessages, {
     // en と異なるリーフだけを書く
   });
   ```
3. **`<言語サブタグ>.test.ts` を同階層に書く（TDD）**: `en.test.ts` を到達水準の
   目安にしてください。最低限、次を満たすこと
   - `describeRule` は頻度（DAILY/WEEKLY/MONTHLY/YEARLY）× interval の 1/2 以上 ×
     パターン有無の組み合わせ、および `end`（`never`/`count`/`until`）を網羅する
   - `validationMessage` / `unsupportedReason` は全 `code`（`ja.test.ts` /
     `en.test.ts` の `it.each` 一覧を参照）に対して文言を返すことを検証する
   - 既存カタログ（`jaMessages` 等）とのグループ名・リーフ名の集合が一致することを
     検証する（`en.test.ts` の「キー整合性」テストを参照。型システムでも保証されるが、
     実行時の回帰検知として置く）
4. **`resolve.ts` の `BUILTIN_CATALOGS` に登録する**: 言語サブタグ（小文字）を
   キーにして追加します
5. **`src/index.ts` から export する**: 追加したカタログの named export を追加します
6. **ドキュメントを更新する**: `docs/api.md`（中央メッセージカタログの節）と
   `docs/theming.md`（多言語対応の節）に、対応言語を追記します

## プルリクエスト

- 1 つの PR は 1 つの意味単位の変更にまとめてください（無関係な変更を混在させない）
- `pnpm check` が通っていることを確認してください
- 公開 API の変更を含む場合は `CHANGELOG.md`（Keep a Changelog 形式、日本語）への追記も
  お願いします。運用方針は [docs/versioning.md](./docs/versioning.md) を参照してください

## セキュリティ上の問題の報告

脆弱性を発見した場合は、公開の Issue ではなく [SECURITY.md](./SECURITY.md) の手順に
従って報告してください。
