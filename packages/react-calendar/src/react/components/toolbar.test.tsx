/**
 * @packageDocumentation
 * `Toolbar` コンポーネントのテスト。
 *
 * `docs/internal/components-dom.md` の「ルート / ツールバー」仕様
 * （DOM 構造・data 属性・aria 属性）を検証する。
 */

import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { visibleRangeFor } from '../../core/date-utils';
import type { CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type { UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import { formatDayTitle, formatMonthTitle, formatRangeTitle, formatYearTitle } from './format';
import type { ToolbarProps } from './toolbar';
import { Toolbar } from './toolbar';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** render props（`renderTitle` 等）のうちテストで使うものだけを束ねた型。 */
type ToolbarRenderProps = Pick<
  ToolbarProps,
  'renderTitle' | 'renderNavButtonContent' | 'renderViewButtonContent'
>;

/**
 * `useCalendar` を呼び出し `Toolbar` を包んで描画するテスト用ラッパ。
 * `capture.current` から最新の `UseCalendarResult` を取得できる。
 */
function renderToolbar(
  initialView?: CalendarViewType,
  messages?: MessageCatalogOverrides,
  views?: ToolbarProps['views'],
  multiMonthCount?: number,
  timelineDays?: number,
  locale?: string,
  renderProps?: ToolbarRenderProps,
) {
  const capture: { current: UseCalendarResult | null } = { current: null };

  function Harness(): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      // exactOptionalPropertyTypes 下では undefined 値のキーを直接書けないため省略する
      ...(initialView !== undefined ? { initialView } : {}),
      ...(multiMonthCount !== undefined ? { multiMonthCount } : {}),
      ...(timelineDays !== undefined ? { timelineDays } : {}),
      locale: locale ?? 'ja',
    });
    capture.current = calendar;
    return (
      <CalendarProvider value={calendar} {...(messages !== undefined ? { messages } : {})}>
        <Toolbar {...(views !== undefined ? { views } : {})} {...(renderProps ?? {})} />
      </CalendarProvider>
    );
  }

  const view = render(<Harness />);
  return { ...view, capture };
}

/** ビュー切替ボタンの `data-koyomi-action` 一覧（DOM 仕様順）。 */
const VIEW_ACTIONS = ['view-month', 'view-week', 'view-day', 'view-list'] as const;

describe('Toolbar', () => {
  it('DOM 仕様どおりの構造（toolbar > toolbar-nav / title / toolbar-views）を持つ', () => {
    const { container } = renderToolbar('month');

    const toolbar = container.querySelector('[data-koyomi="toolbar"]');
    expect(toolbar).not.toBeNull();

    const nav = toolbar?.querySelector(':scope > [data-koyomi="toolbar-nav"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('[data-koyomi-action="today"]')).not.toBeNull();
    expect(nav?.querySelector('[data-koyomi-action="prev"]')).not.toBeNull();
    expect(nav?.querySelector('[data-koyomi-action="next"]')).not.toBeNull();

    const title = toolbar?.querySelector(':scope > [data-koyomi="title"]');
    expect(title?.tagName).toBe('H2');

    const views = toolbar?.querySelector(':scope > [data-koyomi="toolbar-views"]');
    expect(views).not.toBeNull();
    expect(views?.getAttribute('role')).toBe('group');
    for (const action of VIEW_ACTIONS) {
      expect(views?.querySelector(`[data-koyomi-action="${action}"]`)).not.toBeNull();
    }
  });

  it('ビュー切替グループ（toolbar-views）には既定で「表示切替」の aria-label が付く', () => {
    const { container } = renderToolbar('month');
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    expect(viewsGroup).toHaveAttribute('aria-label', '表示切替');
  });

  it('messages.toolbar.viewsGroup を指定するとビュー切替グループの aria-label が差し替わる', () => {
    const { container } = renderToolbar('month', { toolbar: { viewsGroup: 'View switcher' } });
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    expect(viewsGroup).toHaveAttribute('aria-label', 'View switcher');
  });

  it('today/prev/next ボタンは type="button" と日本語の aria-label を持つ', () => {
    const { container } = renderToolbar('month');

    const today = container.querySelector('[data-koyomi-action="today"]');
    const prev = container.querySelector('[data-koyomi-action="prev"]');
    const next = container.querySelector('[data-koyomi-action="next"]');

    expect(today?.getAttribute('type')).toBe('button');
    expect(today?.getAttribute('aria-label')).toBe('今日');
    expect(prev?.getAttribute('type')).toBe('button');
    expect(prev?.getAttribute('aria-label')).toBe('前へ');
    expect(next?.getAttribute('type')).toBe('button');
    expect(next?.getAttribute('aria-label')).toBe('次へ');
  });

  it('月ビューのタイトルは formatMonthTitle と同じ「2026年7月」になる', () => {
    const { container } = renderToolbar('month');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatMonthTitle(NOW, 'Asia/Tokyo', 'ja'));
    expect(title?.textContent).toBe('2026年7月');
  });

  it('日ビューのタイトルは formatDayTitle と同じ「2026年7月15日(水)」になる', () => {
    const { container } = renderToolbar('day');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatDayTitle(NOW, 'Asia/Tokyo', 'ja'));
    expect(title?.textContent).toBe('2026年7月15日(水)');
  });

  it('週ビューのタイトルは getVisibleRange を formatRangeTitle した文字列になる', () => {
    const { container, capture } = renderToolbar('week');
    const range = visibleRangeFor('week', NOW, 'Asia/Tokyo', {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
      timelineDays: 1,
    });
    expect(capture.current?.api.getVisibleRange()).toEqual(range);

    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '〜'));
  });

  it('リストビューのタイトルは getVisibleRange を formatRangeTitle した文字列になる', () => {
    const { container } = renderToolbar('list');
    const range = visibleRangeFor('list', NOW, 'Asia/Tokyo', {
      weekStartsOn: 0,
      listDays: 30,
      multiMonthCount: 3,
      timelineDays: 1,
    });

    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '〜'));
  });

  it('next / prev クリックで currentDate が移動し、title も追従する', () => {
    const { container, capture } = renderToolbar('month');
    const next = container.querySelector('[data-koyomi-action="next"]');
    const prev = container.querySelector('[data-koyomi-action="prev"]');
    const title = () => container.querySelector('[data-koyomi="title"]')?.textContent;

    expect(title()).toBe('2026年7月');

    if (next === null) {
      throw new Error('next ボタンが見つかりません');
    }
    fireEvent.click(next);
    expect(title()).toBe('2026年8月');
    expect(capture.current?.api.getState().view).toBe('month');

    if (prev === null) {
      throw new Error('prev ボタンが見つかりません');
    }
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(title()).toBe('2026年6月');
  });

  it('today クリックで現在時刻（now）の月に戻る', () => {
    const { container, capture } = renderToolbar('month');
    const next = container.querySelector('[data-koyomi-action="next"]');
    const today = container.querySelector('[data-koyomi-action="today"]');
    if (next === null || today === null) {
      throw new Error('ボタンが見つかりません');
    }

    fireEvent.click(next);
    fireEvent.click(next);
    expect(container.querySelector('[data-koyomi="title"]')?.textContent).toBe('2026年9月');

    fireEvent.click(today);
    expect(container.querySelector('[data-koyomi="title"]')?.textContent).toBe('2026年7月');
    expect(capture.current?.api.getState().currentDate).toEqual(NOW);
  });

  it('初期ビューでは対応するボタンのみ aria-pressed="true" になる', () => {
    const { container } = renderToolbar('month');

    const monthButton = container.querySelector('[data-koyomi-action="view-month"]');
    const weekButton = container.querySelector('[data-koyomi-action="view-week"]');
    const dayButton = container.querySelector('[data-koyomi-action="view-day"]');
    const listButton = container.querySelector('[data-koyomi-action="view-list"]');

    expect(monthButton?.getAttribute('aria-pressed')).toBe('true');
    expect(weekButton?.getAttribute('aria-pressed')).toBe('false');
    expect(dayButton?.getAttribute('aria-pressed')).toBe('false');
    expect(listButton?.getAttribute('aria-pressed')).toBe('false');
  });

  it('ビュー切替ボタンをクリックすると view が変わり aria-pressed が移動する', () => {
    const { container, capture } = renderToolbar('month');

    const weekButton = container.querySelector('[data-koyomi-action="view-week"]');
    if (weekButton === null) {
      throw new Error('view-week ボタンが見つかりません');
    }
    fireEvent.click(weekButton);

    expect(capture.current?.api.getState().view).toBe('week');
    expect(
      container.querySelector('[data-koyomi-action="view-week"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector('[data-koyomi-action="view-month"]')?.getAttribute('aria-pressed'),
    ).toBe('false');

    const listButton = container.querySelector('[data-koyomi-action="view-list"]');
    if (listButton === null) {
      throw new Error('view-list ボタンが見つかりません');
    }
    fireEvent.click(listButton);

    expect(capture.current?.api.getState().view).toBe('list');
    expect(
      container.querySelector('[data-koyomi-action="view-list"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector('[data-koyomi-action="view-week"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('ビュー切替ボタンはすべて type="button" を持つ', () => {
    const { container } = renderToolbar('month');
    for (const action of VIEW_ACTIONS) {
      const button = container.querySelector(`[data-koyomi-action="${action}"]`);
      expect(button?.getAttribute('type')).toBe('button');
    }
  });

  it('messages.toolbar でビュー切替ボタンの表示文字列を差し替えられる（省略時は既定の日本語）', () => {
    const { container } = renderToolbar('month', {
      toolbar: { month: 'Month', week: 'Week', day: 'Day', list: 'List' },
    });

    expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('Month');
    expect(container.querySelector('[data-koyomi-action="view-week"]')?.textContent).toBe('Week');
    expect(container.querySelector('[data-koyomi-action="view-day"]')?.textContent).toBe('Day');
    expect(container.querySelector('[data-koyomi-action="view-list"]')?.textContent).toBe('List');
  });

  it('messages.toolbar.today を指定すると today ボタンの表示文字列と aria-label が差し替わる', () => {
    const { container } = renderToolbar('month', { toolbar: { today: 'Today' } });
    const today = container.querySelector('[data-koyomi-action="today"]');
    expect(today?.textContent).toBe('Today');
    expect(today?.getAttribute('aria-label')).toBe('Today');
  });

  it('messages.toolbar.prev / .next を指定すると aria-label のみ差し替わり、表示アイコンは変わらない', () => {
    const { container } = renderToolbar('month', { toolbar: { prev: 'Previous', next: 'Next' } });
    const prev = container.querySelector('[data-koyomi-action="prev"]');
    const next = container.querySelector('[data-koyomi-action="next"]');

    expect(prev?.getAttribute('aria-label')).toBe('Previous');
    expect(prev?.textContent).toBe('‹');
    expect(next?.getAttribute('aria-label')).toBe('Next');
    expect(next?.textContent).toBe('›');
  });

  it('messages を省略すると既定の日本語文字列のまま', () => {
    const { container } = renderToolbar('month');
    expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('月');
    expect(
      container.querySelector('[data-koyomi-action="today"]')?.getAttribute('aria-label'),
    ).toBe('今日');
  });

  it("locale='en-US' では messages 省略時に Toolbar が Month/Today の英語表示になる", () => {
    const { container } = renderToolbar(
      'month',
      undefined,
      undefined,
      undefined,
      undefined,
      'en-US',
    );
    expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('Month');
    expect(container.querySelector('[data-koyomi-action="today"]')?.textContent).toBe('Today');
    expect(
      container.querySelector('[data-koyomi-action="today"]')?.getAttribute('aria-label'),
    ).toBe('Today');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatMonthTitle(NOW, 'Asia/Tokyo', 'en-US'));
  });

  it('views 未指定では従来どおり月/週/日/リストの4ボタンのみになる（year ボタンは出ない。回帰ガード）', () => {
    const { container } = renderToolbar('month');
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    const buttons = viewsGroup?.querySelectorAll('[data-koyomi="button"]') ?? [];
    expect(buttons).toHaveLength(4);
    expect(container.querySelector('[data-koyomi-action="view-year"]')).toBeNull();
  });

  it("views={['month', 'year']} を指定すると2ボタンになり、年ボタンのクリックで setView('year') が呼ばれる", () => {
    const { container, capture } = renderToolbar('month', undefined, ['month', 'year']);
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    const buttons = viewsGroup?.querySelectorAll('[data-koyomi="button"]') ?? [];
    expect(buttons).toHaveLength(2);

    const yearButton = container.querySelector('[data-koyomi-action="view-year"]');
    expect(yearButton).not.toBeNull();
    if (yearButton === null) {
      throw new Error('view-year ボタンが見つかりません');
    }
    fireEvent.click(yearButton);
    expect(capture.current?.api.getState().view).toBe('year');
  });

  it('messages.toolbar.year で年ビュー切替ボタンの表示文字列を差し替えられる', () => {
    const { container } = renderToolbar('month', { toolbar: { year: 'Year' } }, ['month', 'year']);
    expect(container.querySelector('[data-koyomi-action="view-year"]')?.textContent).toBe('Year');
  });

  it('年ビューのタイトルは formatYearTitle と同じ「2026年」になる', () => {
    const { container } = renderToolbar('year');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatYearTitle(NOW, 'Asia/Tokyo', 'ja'));
    expect(title?.textContent).toBe('2026年');
  });

  it("views={['month', 'multiMonth']} を指定すると2ボタンになり、複数月ボタンのクリックで setView('multiMonth') が呼ばれる", () => {
    const { container, capture } = renderToolbar('month', undefined, ['month', 'multiMonth']);
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    const buttons = viewsGroup?.querySelectorAll('[data-koyomi="button"]') ?? [];
    expect(buttons).toHaveLength(2);

    const multiMonthButton = container.querySelector('[data-koyomi-action="view-multimonth"]');
    expect(multiMonthButton).not.toBeNull();
    if (multiMonthButton === null) {
      throw new Error('view-multimonth ボタンが見つかりません');
    }
    fireEvent.click(multiMonthButton);
    expect(capture.current?.api.getState().view).toBe('multiMonth');
  });

  it('messages.toolbar.multiMonth で複数月ビュー切替ボタンの表示文字列を差し替えられる', () => {
    const { container } = renderToolbar('month', { toolbar: { multiMonth: '複数月表示' } }, [
      'month',
      'multiMonth',
    ]);
    expect(container.querySelector('[data-koyomi-action="view-multimonth"]')?.textContent).toBe(
      '複数月表示',
    );
  });

  it('複数月ビューのタイトルは「2026年7月〜2026年9月」形式になる（既定 multiMonthCount=3）', () => {
    const { container } = renderToolbar('multiMonth');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe('2026年7月〜2026年9月');
  });

  it('multiMonthCount:1 の複数月ビューのタイトルは単月と同じ「2026年7月」単独になる', () => {
    const { container } = renderToolbar('multiMonth', undefined, undefined, 1);
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe('2026年7月');
  });

  it('views 未指定では従来どおりリソース/タイムラインのボタンも出ない（回帰ガード）', () => {
    const { container } = renderToolbar('month');
    expect(container.querySelector('[data-koyomi-action="view-resource"]')).toBeNull();
    expect(container.querySelector('[data-koyomi-action="view-timeline"]')).toBeNull();
  });

  it("views={['month', 'resource', 'timeline']} を指定すると3ボタンになり、各ボタンのクリックで setView が呼ばれる", () => {
    const { container, capture } = renderToolbar('month', undefined, [
      'month',
      'resource',
      'timeline',
    ]);
    const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
    const buttons = viewsGroup?.querySelectorAll('[data-koyomi="button"]') ?? [];
    expect(buttons).toHaveLength(3);

    const resourceButton = container.querySelector('[data-koyomi-action="view-resource"]');
    expect(resourceButton).not.toBeNull();
    if (resourceButton === null) {
      throw new Error('view-resource ボタンが見つかりません');
    }
    fireEvent.click(resourceButton);
    expect(capture.current?.api.getState().view).toBe('resource');

    const timelineButton = container.querySelector('[data-koyomi-action="view-timeline"]');
    expect(timelineButton).not.toBeNull();
    if (timelineButton === null) {
      throw new Error('view-timeline ボタンが見つかりません');
    }
    fireEvent.click(timelineButton);
    expect(capture.current?.api.getState().view).toBe('timeline');
  });

  it('messages.toolbar.resource / .timeline でリソース/タイムラインビュー切替ボタンの表示文字列を差し替えられる', () => {
    const { container } = renderToolbar(
      'month',
      { toolbar: { resource: 'Resources', timeline: 'Timeline' } },
      ['month', 'resource', 'timeline'],
    );
    expect(container.querySelector('[data-koyomi-action="view-resource"]')?.textContent).toBe(
      'Resources',
    );
    expect(container.querySelector('[data-koyomi-action="view-timeline"]')?.textContent).toBe(
      'Timeline',
    );
  });

  it('messages を省略するとリソース/タイムラインのボタンも既定の日本語文字列になる', () => {
    const { container } = renderToolbar('month', undefined, ['month', 'resource', 'timeline']);
    expect(container.querySelector('[data-koyomi-action="view-resource"]')?.textContent).toBe(
      'リソース',
    );
    expect(container.querySelector('[data-koyomi-action="view-timeline"]')?.textContent).toBe(
      'タイムライン',
    );
  });

  it('リソースビューのタイトルは日ビューと同じ「2026年7月15日(水)」形式になる', () => {
    const { container } = renderToolbar('resource');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatDayTitle(NOW, 'Asia/Tokyo', 'ja'));
    expect(title?.textContent).toBe('2026年7月15日(水)');
  });

  it('タイムラインのタイトルは既定（timelineDays=1）では日ビューと同じ「2026年7月15日(水)」形式になる', () => {
    const { container } = renderToolbar('timeline');
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatDayTitle(NOW, 'Asia/Tokyo', 'ja'));
    expect(title?.textContent).toBe('2026年7月15日(水)');
  });

  it('タイムラインのタイトルは timelineDays:7 では表示範囲の「7月15日〜7月21日」のような範囲形式になる', () => {
    const { container, capture } = renderToolbar('timeline', undefined, undefined, undefined, 7);
    const title = container.querySelector('[data-koyomi="title"]');
    const range = capture.current?.api.getVisibleRange();
    expect(range).toBeDefined();
    if (range === undefined) throw new Error('unreachable');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '〜'));
    expect(title?.textContent).not.toBe(formatDayTitle(NOW, 'Asia/Tokyo', 'ja'));
  });

  it("locale='en-US' の週ビュータイトルは中央カタログの rangeSeparator（'–'）を使う「July 12–July 18」形式になる（〜のハードコードを使わない）", () => {
    const { container, capture } = renderToolbar(
      'week',
      undefined,
      undefined,
      undefined,
      undefined,
      'en-US',
    );
    const range = capture.current?.api.getVisibleRange();
    expect(range).toBeDefined();
    if (range === undefined) throw new Error('unreachable');

    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'en-US', '–'));
    expect(title?.textContent).toBe('July 12–July 18');
  });

  it('messages.common.rangeSeparator を部分上書きすると週ビュータイトルの区切り記号が反映される', () => {
    const { container } = renderToolbar('week', { common: { rangeSeparator: ' – ' } });
    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe('7月12日 – 7月18日');
  });

  describe('renderTitle（タイトルの内側の内容を差し替える render prop）', () => {
    it('renderTitle を指定すると渡された ctx（defaultContent/view/title）でタイトルの内側を差し替えられる', () => {
      const { container } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          renderTitle: (ctx) => `[${ctx.view}] ${ctx.defaultContent} / ${ctx.title}`,
        },
      );
      const title = container.querySelector('[data-koyomi="title"]');
      expect(title?.textContent).toBe('[month] 2026年7月 / 2026年7月');
    });

    it('renderTitle を指定しても外側の h2 要素と data-koyomi="title" 属性は保持される', () => {
      const { container } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          renderTitle: (ctx) => <strong>{ctx.defaultContent}</strong>,
        },
      );
      const title = container.querySelector('[data-koyomi="title"]');
      expect(title?.tagName).toBe('H2');
      expect(title?.querySelector('strong')?.textContent).toBe('2026年7月');
    });

    it('renderTitle 省略時は既定のタイトル文字列がそのまま描画される（回帰）', () => {
      const { container } = renderToolbar('month');
      const title = container.querySelector('[data-koyomi="title"]');
      expect(title?.textContent).toBe('2026年7月');
    });
  });

  describe('renderNavButtonContent（today/prev/next ボタンの内側の内容を差し替える render prop）', () => {
    it('renderNavButtonContent を指定すると today/prev/next それぞれの ctx.action と ctx.defaultContent が渡り、内側を差し替えられる', () => {
      const { container } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          renderNavButtonContent: (ctx) => `<${ctx.action}:${ctx.defaultContent}>`,
        },
      );
      expect(container.querySelector('[data-koyomi-action="today"]')?.textContent).toBe(
        '<today:今日>',
      );
      expect(container.querySelector('[data-koyomi-action="prev"]')?.textContent).toBe('<prev:‹>');
      expect(container.querySelector('[data-koyomi-action="next"]')?.textContent).toBe('<next:›>');
    });

    it('renderNavButtonContent を指定しても外側の aria-label・data-koyomi-action・クリック配線は保持される', () => {
      const { container, capture } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { renderNavButtonContent: () => 'カスタム' },
      );
      const today = container.querySelector('[data-koyomi-action="today"]');
      expect(today?.getAttribute('aria-label')).toBe('今日');
      expect(today?.textContent).toBe('カスタム');

      const next = container.querySelector('[data-koyomi-action="next"]');
      if (next === null) {
        throw new Error('next ボタンが見つかりません');
      }
      fireEvent.click(next);
      // クリック配線（api.next()）は保持され、内側の内容（「カスタム」）はそのまま
      expect(capture.current?.api.getState().currentDate).not.toEqual(NOW);
      expect(container.querySelector('[data-koyomi-action="next"]')?.textContent).toBe('カスタム');
    });

    it('renderNavButtonContent 省略時は既定の内容（today の文言・‹/›）がそのまま描画される（回帰）', () => {
      const { container } = renderToolbar('month');
      expect(container.querySelector('[data-koyomi-action="today"]')?.textContent).toBe('今日');
      expect(container.querySelector('[data-koyomi-action="prev"]')?.textContent).toBe('‹');
      expect(container.querySelector('[data-koyomi-action="next"]')?.textContent).toBe('›');
    });
  });

  describe('renderViewButtonContent（ビュー切替ボタンの内側の内容を差し替える render prop）', () => {
    it('renderViewButtonContent を指定すると ctx.view/ctx.active/ctx.defaultContent が渡り、選択中のボタンだけ内容を出し分けられる', () => {
      const { container } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          renderViewButtonContent: (ctx) =>
            `${ctx.defaultContent}${ctx.active ? '(active)' : ''}[${ctx.view}]`,
        },
      );
      expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe(
        '月(active)[month]',
      );
      expect(container.querySelector('[data-koyomi-action="view-week"]')?.textContent).toBe(
        '週[week]',
      );
    });

    it('renderViewButtonContent を指定しても外側の aria-pressed・data-koyomi-action・クリック配線（setView）は保持される', () => {
      const { container, capture } = renderToolbar(
        'month',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { renderViewButtonContent: (ctx) => `カスタム:${ctx.view}` },
      );
      const weekButton = container.querySelector('[data-koyomi-action="view-week"]');
      expect(weekButton?.getAttribute('aria-pressed')).toBe('false');
      expect(weekButton?.textContent).toBe('カスタム:week');

      if (weekButton === null) {
        throw new Error('view-week ボタンが見つかりません');
      }
      fireEvent.click(weekButton);
      expect(capture.current?.api.getState().view).toBe('week');
      expect(
        container.querySelector('[data-koyomi-action="view-week"]')?.getAttribute('aria-pressed'),
      ).toBe('true');
    });

    it('renderViewButtonContent 省略時は既定の表示文字列がそのまま描画される（回帰）', () => {
      const { container } = renderToolbar('month');
      expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('月');
      expect(container.querySelector('[data-koyomi-action="view-week"]')?.textContent).toBe('週');
    });
  });
});
