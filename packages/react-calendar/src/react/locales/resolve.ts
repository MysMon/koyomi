/**
 * @packageDocumentation
 * ロケール文字列とオーバーライドから {@link MessageCatalog} を組み立てる。
 */

import { enMessages } from './en';
import { jaMessages } from './ja';
import type { MessageCatalog, MessageCatalogOverrides } from './types';

/** 同梱するロケールカタログの一覧（言語サブタグ小文字 → カタログ）。 */
const BUILTIN_CATALOGS: Record<string, MessageCatalog> = {
  ja: jaMessages,
  en: enMessages,
};

/** 既定言語（同梱カタログにない言語サブタグへのフォールバック先）。 */
const FALLBACK_LANGUAGE = 'ja';

/**
 * BCP 47 ロケールタグから言語サブタグ（先頭の `-` 区切り要素）を小文字で取り出す。
 *
 * @param locale - ロケールタグ（例: `'en-US'`）
 * @returns 小文字化した言語サブタグ（例: `'en'`）
 */
function languageSubtag(locale: string): string {
  return (locale.split('-')[0] ?? locale).toLowerCase();
}

/**
 * `base` の 1 グループへ `override` を浅くマージする。
 * `override` が省略されたグループは `base` のグループをそのまま返す
 * （新しいオブジェクトを作らず参照を維持し、下流の不要な再計算を避ける）。
 */
function mergeGroup<Group>(base: Group, override: Partial<Group> | undefined): Group {
  return override === undefined ? base : { ...base, ...override };
}

/**
 * `base` の各グループへ `overrides` の同名グループを浅くマージする。
 *
 * `MessageCatalog` は 2 階層固定（グループ→リーフ）のため、グループ単位で
 * `{ ...base[group], ...overrides[group] }` を繰り返すだけで型安全に部分適用できる。
 * `overrides` に含まれないグループは `base` のグループ参照をそのまま使う。
 *
 * @param base - 基準となる完全なカタログ
 * @param overrides - 上書きするグループ・リーフ（省略可）
 * @returns マージ後の完全なカタログ
 */
function mergeOverrides(base: MessageCatalog, overrides: MessageCatalogOverrides): MessageCatalog {
  return {
    common: mergeGroup(base.common, overrides.common),
    toolbar: mergeGroup(base.toolbar, overrides.toolbar),
    list: mergeGroup(base.list, overrides.list),
    month: mergeGroup(base.month, overrides.month),
    multiMonth: mergeGroup(base.multiMonth, overrides.multiMonth),
    resource: mergeGroup(base.resource, overrides.resource),
    timeline: mergeGroup(base.timeline, overrides.timeline),
    year: mergeGroup(base.year, overrides.year),
    announcer: mergeGroup(base.announcer, overrides.announcer),
    recurrenceEditor: mergeGroup(base.recurrenceEditor, overrides.recurrenceEditor),
  };
}

/**
 * `locale` に対応する同梱メッセージカタログを選び、`overrides` をグループ単位で
 * 浅くマージした完全なカタログを返す。
 *
 * `locale` は言語サブタグ（`-` より前）だけを大文字・小文字を無視して比較する
 * （例: `'en-US'` と `'en-GB'` はどちらも `en`）。同梱カタログにない言語は
 * `'ja'` のカタログへフォールバックする。
 *
 * @param locale - ロケールタグ（例: `'ja'`・`'en-US'`）
 * @param overrides - 部分的に差し替える文言（省略時は同梱カタログをそのまま返す）
 * @returns 解決済みの完全なカタログ
 * @example
 * ```ts
 * resolveMessageCatalog('en-US').toolbar.today; // => 'Today'
 * resolveMessageCatalog('fr').toolbar.today; // => '今日'（未対応言語は ja にフォールバック）
 * resolveMessageCatalog('ja', { month: { overflow: (n) => `他${n}件` } }).month.overflow(3);
 * // => '他3件'（他のグループは既定のまま）
 * ```
 */
export function resolveMessageCatalog(
  locale: string,
  overrides?: MessageCatalogOverrides,
): MessageCatalog {
  const language = languageSubtag(locale);
  const base = BUILTIN_CATALOGS[language] ?? BUILTIN_CATALOGS[FALLBACK_LANGUAGE];
  // BUILTIN_CATALOGS[FALLBACK_LANGUAGE]（'ja'）は常に存在するため base は必ず定義される
  const resolvedBase: MessageCatalog = base ?? jaMessages;
  if (overrides === undefined) {
    return resolvedBase;
  }
  return mergeOverrides(resolvedBase, overrides);
}
