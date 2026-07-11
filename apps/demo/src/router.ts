/**
 * @packageDocumentation
 * デモアプリのハッシュルーティング。
 *
 * `location.hash`（例: `#/basic`）だけを状態源とし、`useSyncExternalStore` で
 * 購読する素朴な実装。ルーティングライブラリは追加しない。不明なハッシュは
 * `'#/basic'` にフォールバックする。
 */

import { useEffect, useSyncExternalStore } from 'react';

/** デモパターンの識別子。 */
export type PatternId = 'basic' | 'team' | 'international' | 'headless' | 'undo';

/** パターン切替タブに表示するメタ情報。 */
export interface PatternMeta {
  /** パターン識別子。 */
  id: PatternId;
  /** 対応するハッシュ（例: `'#/basic'`）。 */
  hash: string;
  /** タブに表示する名前。 */
  label: string;
  /** タブに添える一言説明。 */
  description: string;
}

/** 不明なハッシュのフォールバック先。 */
const DEFAULT_PATTERN: PatternId = 'basic';

/** 有効なパターン一覧（この順序でタブに表示する）。 */
export const PATTERNS: readonly PatternMeta[] = [
  {
    id: 'basic',
    hash: '#/basic',
    label: 'ベーシック',
    description: '全ビュー切替・D&D 編集・繰り返し予定の編集スコープの基本デモ',
  },
  {
    id: 'team',
    hash: '#/team',
    label: 'チーム',
    description: '多数のリソースと大量イベントでのリソース/タイムライン表示',
  },
  {
    id: 'international',
    hash: '#/international',
    label: '国際化',
    description: '多言語ロケールと複数タイムゾーンの切り替え',
  },
  {
    id: 'headless',
    hash: '#/headless',
    label: 'ヘッドレス',
    description: '独自 UI でカレンダーロジックのみを利用する例',
  },
  {
    id: 'undo',
    hash: '#/undo',
    label: 'Undo/Redo',
    description: '予定の変更履歴を取り消し・やり直しする例',
  },
];

/** `location.hash` から先頭の `#/` を除いたセグメントを取り出す。 */
function currentHashSegment(): string {
  return window.location.hash.replace(/^#\/?/, '');
}

/** 文字列が有効な {@link PatternId} かどうかを判定する型ガード。 */
function isPatternId(value: string): value is PatternId {
  return PATTERNS.some((pattern) => pattern.id === value);
}

/** 現在のハッシュに対応するパターン ID を返す（不明なら {@link DEFAULT_PATTERN}）。 */
function getSnapshot(): PatternId {
  const segment = currentHashSegment();
  return isPatternId(segment) ? segment : DEFAULT_PATTERN;
}

/** `hashchange` イベントを購読する（`useSyncExternalStore` 用）。 */
function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/**
 * 現在のハッシュから選択中のデモパターンを求めるフック。
 *
 * `location.hash` が空、または {@link PATTERNS} にないパターン名の場合は、
 * `location.hash` を `'#/basic'` へ書き換えて正規化する（URL 上でも常に
 * どのパターンを表示しているかが分かるようにするため）。ハッシュが書き換わる
 * たびに再評価するため、初回表示だけでなく、以降に不明なハッシュへ手動で
 * 書き換えられた場合も同様に正規化される。
 */
export function useHashRoute(): PatternId {
  const route = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!isPatternId(currentHashSegment())) {
      window.location.hash = '#/basic';
    }
  });

  return route;
}
