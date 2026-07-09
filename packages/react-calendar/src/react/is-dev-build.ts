/**
 * @packageDocumentation
 * 開発ビルド判定。
 *
 * バンドラなしのブラウザ実行（`process` 未定義）では安全側に倒して開発扱いにする
 * （開発向けの警告は本番最適化ビルドでのみ除去される想定）。`as` キャストを使わず
 * `'process' in globalThis` の型ガードで `process.env.NODE_ENV` を参照する。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

/** オブジェクトが指定キーを持つかを判定し、その値へ安全にアクセスできるよう narrow する。 */
function hasKey<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return key in value;
}

/**
 * `process.env.NODE_ENV` を安全に読む。`as` を使わず、各段が非オブジェクト・
 * `undefined` / `null` でも例外にならないよう防御的に辿る。取得できなければ `undefined`。
 */
function readNodeEnv(): string | undefined {
  const globalObject: object = globalThis;
  if (!hasKey(globalObject, 'process')) {
    return undefined;
  }
  const process = globalObject.process;
  if (typeof process !== 'object' || process === null || !hasKey(process, 'env')) {
    return undefined;
  }
  const env = process.env;
  if (typeof env !== 'object' || env === null || !hasKey(env, 'NODE_ENV')) {
    return undefined;
  }
  const nodeEnv = env.NODE_ENV;
  return typeof nodeEnv === 'string' ? nodeEnv : undefined;
}

/**
 * 開発ビルドかどうかを返す。`process.env.NODE_ENV !== 'production'` なら開発扱い。
 * `process` が存在しない・不正な形の環境では `true`（開発扱い）を返す。
 */
export function isDevBuild(): boolean {
  return readNodeEnv() !== 'production';
}
