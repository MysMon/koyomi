/**
 * @packageDocumentation
 * `Toolbar` コンポーネントのテスト。
 *
 * `docs/internal/components-dom.md` の「ルート / ツールバー」契約
 * （DOM 構造・data 属性・aria 属性）を検証する。
 */

import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { visibleRangeFor } from '../../core/date-utils';
import type { CalendarViewType } from '../../core/types';
import { CalendarProvider } from '../context';
import type { UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import { formatDayTitle, formatMonthTitle, formatRangeTitle } from './format';
import type { ToolbarProps } from './toolbar';
import { Toolbar } from './toolbar';

/** テスト用の固定「現在時刻」。東京の 2026-07-15 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/**
 * `useCalendar` を呼び出し `Toolbar` を包んで描画するテスト用ラッパ。
 * `capture.current` から最新の `UseCalendarResult` を取得できる。
 */
function renderToolbar(initialView?: CalendarViewType, labels?: ToolbarProps['labels']) {
  const capture: { current: UseCalendarResult | null } = { current: null };

  function Harness(): ReactElement {
    const calendar = useCalendar({
      timeZone: 'Asia/Tokyo',
      now: () => NOW,
      initialDate: NOW,
      // exactOptionalPropertyTypes 下では undefined 値のキーを直接書けないため省略する
      ...(initialView !== undefined ? { initialView } : {}),
      locale: 'ja',
    });
    capture.current = calendar;
    return (
      <CalendarProvider value={calendar}>
        <Toolbar {...(labels !== undefined ? { labels } : {})} />
      </CalendarProvider>
    );
  }

  const view = render(<Harness />);
  return { ...view, capture };
}

/** ビュー切替ボタンの `data-koyomi-action` 一覧（DOM 契約順）。 */
const VIEW_ACTIONS = ['view-month', 'view-week', 'view-day', 'view-list'] as const;

describe('Toolbar', () => {
  it('DOM 契約どおりの構造（toolbar > toolbar-nav / title / toolbar-views）を持つ', () => {
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
    const range = visibleRangeFor('week', NOW, 'Asia/Tokyo', { weekStartsOn: 0, listDays: 30 });
    expect(capture.current?.api.getVisibleRange()).toEqual(range);

    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'ja'));
  });

  it('リストビューのタイトルは getVisibleRange を formatRangeTitle した文字列になる', () => {
    const { container } = renderToolbar('list');
    const range = visibleRangeFor('list', NOW, 'Asia/Tokyo', { weekStartsOn: 0, listDays: 30 });

    const title = container.querySelector('[data-koyomi="title"]');
    expect(title?.textContent).toBe(formatRangeTitle(range, 'Asia/Tokyo', 'ja'));
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

  it('labels でビュー切替ボタンの表示文字列を差し替えられる（省略時は既定の日本語）', () => {
    const { container } = renderToolbar('month', {
      month: 'Month',
      week: 'Week',
      day: 'Day',
      list: 'List',
    });

    expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('Month');
    expect(container.querySelector('[data-koyomi-action="view-week"]')?.textContent).toBe('Week');
    expect(container.querySelector('[data-koyomi-action="view-day"]')?.textContent).toBe('Day');
    expect(container.querySelector('[data-koyomi-action="view-list"]')?.textContent).toBe('List');
  });

  it('labels.today を指定すると today ボタンの表示文字列と aria-label が差し替わる', () => {
    const { container } = renderToolbar('month', { today: 'Today' });
    const today = container.querySelector('[data-koyomi-action="today"]');
    expect(today?.textContent).toBe('Today');
    expect(today?.getAttribute('aria-label')).toBe('Today');
  });

  it('labels.prev / labels.next を指定すると aria-label のみ差し替わり、表示アイコンは変わらない', () => {
    const { container } = renderToolbar('month', { prev: 'Previous', next: 'Next' });
    const prev = container.querySelector('[data-koyomi-action="prev"]');
    const next = container.querySelector('[data-koyomi-action="next"]');

    expect(prev?.getAttribute('aria-label')).toBe('Previous');
    expect(prev?.textContent).toBe('‹');
    expect(next?.getAttribute('aria-label')).toBe('Next');
    expect(next?.textContent).toBe('›');
  });

  it('labels を省略すると既定の日本語文字列のまま（後方互換）', () => {
    const { container } = renderToolbar('month');
    expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe('月');
    expect(
      container.querySelector('[data-koyomi-action="today"]')?.getAttribute('aria-label'),
    ).toBe('今日');
  });
});
