/**
 * @packageDocumentation
 * `resolveMessageCatalog` のテスト。
 */
import { describe, expect, it } from 'vitest';
import { enMessages } from './en';
import { jaMessages } from './ja';
import { createMessageCatalog, resolveMessageCatalog } from './resolve';
import type { MessageCatalogOverrides } from './types';

describe('resolveMessageCatalog', () => {
  it('locale: "ja" は jaMessages をそのまま返す（overrides 省略）', () => {
    expect(resolveMessageCatalog('ja')).toBe(jaMessages);
  });

  it('locale: "en-US" は enMessages をそのまま返す（overrides 省略）', () => {
    expect(resolveMessageCatalog('en-US')).toBe(enMessages);
  });

  it('locale: "en-GB" は言語サブタグ "en" として enMessages を選ぶ', () => {
    expect(resolveMessageCatalog('en-GB')).toBe(enMessages);
    expect(resolveMessageCatalog('en-GB').toolbar.today).toBe('Today');
  });

  it('大文字小文字を無視する（"EN-us" も enMessages を選ぶ）', () => {
    expect(resolveMessageCatalog('EN-us')).toBe(enMessages);
  });

  it('同梱していない言語（"fr"）は ja にフォールバックする', () => {
    expect(resolveMessageCatalog('fr')).toBe(jaMessages);
  });

  it('overrides を渡すと該当グループのリーフだけが差し替わり、他のグループは既定のまま', () => {
    const resolved = resolveMessageCatalog('ja', {
      month: { overflow: (count) => `他${count}件` },
    });
    expect(resolved.month.overflow(3)).toBe('他3件');
    expect(resolved.list).toBe(jaMessages.list);
    expect(resolved.toolbar).toBe(jaMessages.toolbar);
  });

  it('overrides はグループ内の一部のリーフだけを指定でき、同グループの他のリーフは既定のまま', () => {
    const resolved = resolveMessageCatalog('ja', {
      list: { empty: 'カスタム空状態' },
    });
    expect(resolved.list.empty).toBe('カスタム空状態');
    expect(resolved.list.allDay).toBe(jaMessages.list.allDay);
    expect(resolved.list.dayAriaLabel).toBe(jaMessages.list.dayAriaLabel);
  });

  it('overrides を英語カタログに適用しても他のグループは enMessages の既定のまま', () => {
    const resolved = resolveMessageCatalog('en-US', {
      toolbar: { today: 'Today!' },
    });
    expect(resolved.toolbar.today).toBe('Today!');
    expect(resolved.toolbar.prev).toBe(enMessages.toolbar.prev);
    expect(resolved.list).toBe(enMessages.list);
  });

  it('overrides が空オブジェクトのグループを含む場合、そのグループは既定のまま', () => {
    const resolved = resolveMessageCatalog('ja', { month: {} });
    expect(resolved.month.overflow(1)).toBe(jaMessages.month.overflow(1));
  });
});

describe('resolveMessageCatalog: fallbackLanguage', () => {
  it('fallbackLanguage 省略時は現行互換の ja にフォールバックする', () => {
    expect(resolveMessageCatalog('fr')).toBe(jaMessages);
  });

  it('fallbackLanguage を指定すると、同梱していない言語はそのカタログにフォールバックする', () => {
    expect(resolveMessageCatalog('fr', undefined, 'en')).toBe(enMessages);
  });

  it('fallbackLanguage も言語サブタグだけを比較する（"en-US" でも en を選ぶ）', () => {
    expect(resolveMessageCatalog('fr', undefined, 'en-US')).toBe(enMessages);
  });

  it('fallbackLanguage 自体が同梱していない言語の場合は ja（安全側の既定）にフォールバックする', () => {
    expect(resolveMessageCatalog('fr', undefined, 'xx')).toBe(jaMessages);
  });

  it('locale が同梱済みの言語のときは fallbackLanguage を使わない', () => {
    expect(resolveMessageCatalog('en', undefined, 'ja')).toBe(enMessages);
  });

  it('fallbackLanguage 指定時も overrides は通常どおりグループ単位でマージされる', () => {
    const resolved = resolveMessageCatalog('fr', { toolbar: { today: "Aujourd'hui" } }, 'en');
    expect(resolved.toolbar.today).toBe("Aujourd'hui");
    expect(resolved.toolbar.prev).toBe(enMessages.toolbar.prev);
    expect(resolved.list).toBe(enMessages.list);
  });
});

describe('createMessageCatalog', () => {
  it('overrides を渡さない場合は base をそのまま返す（参照を維持する）', () => {
    expect(createMessageCatalog(jaMessages)).toBe(jaMessages);
  });

  it('base のグループへ overrides をグループ単位で浅くマージした完全なカタログを返す', () => {
    const overrides: MessageCatalogOverrides = { toolbar: { today: 'カスタム今日' } };
    const resolved = createMessageCatalog(jaMessages, overrides);
    expect(resolved.toolbar.today).toBe('カスタム今日');
    expect(resolved.toolbar.prev).toBe(jaMessages.toolbar.prev);
    expect(resolved.list).toBe(jaMessages.list);
  });

  it('同梱の jaMessages / enMessages 以外の任意のカタログを base にできる', () => {
    const overrides: MessageCatalogOverrides = { toolbar: { today: "Today's schedule" } };
    const resolved = createMessageCatalog(enMessages, overrides);
    expect(resolved.toolbar.today).toBe("Today's schedule");
    expect(resolved.toolbar.week).toBe(enMessages.toolbar.week);
    expect(resolved.common).toBe(enMessages.common);
  });

  it('overrides が空オブジェクトのグループを含む場合、そのグループは base のまま', () => {
    const resolved = createMessageCatalog(jaMessages, { month: {} });
    expect(resolved.month.overflow(1)).toBe(jaMessages.month.overflow(1));
  });

  it('resolveMessageCatalog の overrides 適用結果と同じ合成結果になる（内部実装を共有する）', () => {
    const overrides: MessageCatalogOverrides = { month: { overflow: (count) => `他${count}件` } };
    const direct = createMessageCatalog(jaMessages, overrides);
    const viaResolve = resolveMessageCatalog('ja', overrides);
    expect(direct.month.overflow(3)).toBe(viaResolve.month.overflow(3));
    expect(direct.list).toBe(viaResolve.list);
  });
});
