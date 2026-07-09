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

/** `process` らしきオブジェクトの最小形。 */
interface ProcessLike {
  env?: { NODE_ENV?: string };
}

/** `globalThis` が `process` を持つかどうかの型ガード。 */
function hasProcess(value: object): value is { process: ProcessLike } {
  return 'process' in value;
}

/**
 * 開発ビルドかどうかを返す。`process.env.NODE_ENV !== 'production'` なら開発扱い。
 * `process` が存在しない環境では `true`（開発扱い）を返す。
 */
export function isDevBuild(): boolean {
  const globalObject: object = globalThis;
  if (hasProcess(globalObject)) {
    return globalObject.process.env?.NODE_ENV !== 'production';
  }
  return true;
}
