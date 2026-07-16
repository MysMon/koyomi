/**
 * @packageDocumentation
 * `resolveMessageCatalog` のテスト。
 */
import { describe, expect, it } from 'vitest';
import { enMessages } from './en';
import { jaMessages } from './ja';
import { resolveMessageCatalog } from './resolve';

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
