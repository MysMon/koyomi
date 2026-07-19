/**
 * @packageDocumentation
 * ロケール文字列とオーバーライドから {@link MessageCatalog} を組み立てる
 * （{@link resolveMessageCatalog}）。任意のベースカタログと差分からも組み立てられる
 * （{@link createMessageCatalog}）。
 */

import { enMessages } from './en';
import { jaMessages } from './ja';
import type { MessageCatalog, MessageCatalogOverrides } from './types';

/** 同梱するロケールカタログの一覧（言語サブタグ小文字 → カタログ）。 */
const BUILTIN_CATALOGS: Record<string, MessageCatalog> = {
  ja: jaMessages,
  en: enMessages,
};

/** `fallbackLanguage` 省略時の既定値（現行互換の `'ja'`）。 */
const DEFAULT_FALLBACK_LANGUAGE = 'ja';

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
 * ベースとなる完全なカタログへ `overrides` をグループ単位で浅くマージし、
 * 完全な {@link MessageCatalog} を合成する。
 *
 * `MessageCatalog` は 2 階層固定（グループ→リーフ）のため、グループ単位で
 * `{ ...base[group], ...overrides[group] }` を繰り返すだけで型安全に部分適用できる。
 * `overrides` に含まれないグループ・リーフは `base` の値をそのまま使う
 * （グループ自体を省略した場合は参照も維持する）。
 *
 * `base` には同梱の {@link jaMessages} / {@link enMessages} に限らず、任意の
 * 完全なカタログを渡せる。既存の言語に近いカタログを追加したい場合、この関数で
 * 近い言語を `base` にして異なるリーフだけを `overrides` に指定すれば、
 * 全リーフを書き直さずに 1 つの完全なカタログを合成できる。
 *
 * @param base - 基準となる完全なカタログ
 * @param overrides - 上書きするグループ・リーフ（省略時は `base` をそのまま返す）
 * @returns 合成後の完全なカタログ
 * @example
 * ```ts
 * import { createMessageCatalog, enMessages } from '@koyomi-cal/react';
 *
 * // en に近い独自ロケールを、異なる文言だけ書いて作る
 * const customMessages = createMessageCatalog(enMessages, {
 *   toolbar: { today: "Today's schedule" },
 * });
 * customMessages.toolbar.week; // => 'Week'（enMessages のまま）
 * ```
 */
export function createMessageCatalog(
  base: MessageCatalog,
  overrides?: MessageCatalogOverrides,
): MessageCatalog {
  if (overrides === undefined) {
    return base;
  }
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
 * `fallbackLanguage`（同じく言語サブタグで比較）のカタログへフォールバックし、
 * `fallbackLanguage` 自体も同梱にない場合はさらに `'ja'` へフォールバックする
 * （`fallbackLanguage` を省略した場合の既定値も `'ja'` のため、省略時の挙動は
 * 常に `'ja'` フォールバックになる）。
 *
 * @param locale - ロケールタグ（例: `'ja'`・`'en-US'`）
 * @param overrides - 部分的に差し替える文言（省略時は同梱カタログをそのまま返す）
 * @param fallbackLanguage - 同梱にない言語のフォールバック先（既定 `'ja'`）
 * @returns 解決済みの完全なカタログ
 * @example
 * ```ts
 * resolveMessageCatalog('en-US').toolbar.today; // => 'Today'
 * resolveMessageCatalog('fr').toolbar.today; // => '今日'（未対応言語は既定で ja にフォールバック）
 * resolveMessageCatalog('fr', undefined, 'en').toolbar.today; // => 'Today'（フォールバック先を en に変更）
 * resolveMessageCatalog('ja', { month: { overflow: (n) => `他${n}件` } }).month.overflow(3);
 * // => '他3件'（他のグループは既定のまま）
 * ```
 */
export function resolveMessageCatalog(
  locale: string,
  overrides?: MessageCatalogOverrides,
  fallbackLanguage: string = DEFAULT_FALLBACK_LANGUAGE,
): MessageCatalog {
  const language = languageSubtag(locale);
  const base =
    BUILTIN_CATALOGS[language] ??
    BUILTIN_CATALOGS[languageSubtag(fallbackLanguage)] ??
    BUILTIN_CATALOGS[DEFAULT_FALLBACK_LANGUAGE];
  // BUILTIN_CATALOGS[DEFAULT_FALLBACK_LANGUAGE]（'ja'）は常に存在するため base は必ず定義される
  const resolvedBase: MessageCatalog = base ?? jaMessages;
  return createMessageCatalog(resolvedBase, overrides);
}
