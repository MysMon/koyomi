# npm 公開手順

`@koyomi-cal/react` を npm に公開するためのメンテナー向け手順です。

## 前提

- npm アカウントが `@koyomi-cal` スコープ（organization）への publish 権限を持っていること。
  スコープが未作成の場合は npm 上で organization `koyomi-cal` を先に作成します
- `pnpm login`（または `npm login`）でログイン済みであること

## 公開前チェックリスト

1. すべてのチェックが通ること:

   ```bash
   pnpm check   # Lint + 型チェック + テスト
   pnpm build   # tsup ビルド（dist/ を再生成）
   ```

2. バージョンの更新（必要な場合）:

   ```bash
   # packages/react-calendar/package.json の version を更新し、
   # CHANGELOG.md に変更内容を追記する
   ```

3. 梱包内容の確認（tarball に何が入るかを公開せずに確認）:

   ```bash
   pnpm --filter @koyomi-cal/react exec npm pack --dry-run
   ```

   含まれるべきもの: `dist/`（index.js / index.d.ts / theme.css / sourcemap）、
   `README.md`、`LICENSE`、`package.json`。`src/` やテストが含まれていたら
   `files` フィールドを確認してください。

## 公開

```bash
pnpm --filter @koyomi-cal/react publish
```

- `prepublishOnly` スクリプトが型チェック → テスト → ビルドを自動実行します
- 初回公開時、スコープ付きパッケージは既定で private 扱いになりますが、
  `publishConfig.access: "public"` を設定済みのためフラグの指定は不要です
- git の作業ツリーが汚れていると pnpm が拒否します。コミット後に実行するか、
  意図的な場合のみ `--no-git-checks` を付けてください

公開後の確認:

```bash
npm view @koyomi-cal/react
```

## dry-run（公開せずに一連の流れを確認）

```bash
pnpm --filter @koyomi-cal/react publish --dry-run
```

## 補足

- **配布形式**: ESM のみ（`type: "module"`、`exports` マップ）。CommonJS は提供しません
- **workspace 依存**: デモアプリの `workspace:*` 依存は publish 時に pnpm が
  実バージョンへ自動置換しますが、デモは `private: true` のため公開対象外です
- **GitHub Actions での自動公開**（任意）: タグ push で publish するワークフローを
  追加する場合は、リポジトリの Secrets に `NPM_TOKEN` を設定し、
  `pnpm publish --filter @koyomi-cal/react --no-git-checks` を実行するジョブを
  `.github/workflows/release.yml` に定義してください。npm provenance を使う場合は
  `permissions: id-token: write` と `publishConfig.provenance: true` が必要です
