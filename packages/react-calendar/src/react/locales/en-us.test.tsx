/**
 * @packageDocumentation
 * `enUsLabels`（英語ロケールの既定文言プリセット）のテスト。
 *
 * プリセットの各グループが、対応するコンポーネントの `*Label` 系 props を
 * 過不足なくカバーしていることを検証する。キー集合のずれは
 * `en-us.ts` 側の型レベルの網羅性チェック（`RequiredLabels<T>`）で
 * コンパイル時に検出されるが、ここでは実行時にも同じことを担保し、
 * 将来ラベルが増減した際にテストが失敗して気付けるようにする。
 *
 * 加えて、実際に `Toolbar` / `ListView` へスプレッドして描画し、
 * 表示文字列・aria-label が期待どおりになることを確認する統合テストも含む
 * （静的なキー集合の一致だけでは、実際のコンポーネントへ正しく渡って
 * 描画されるかまでは担保できないため）。
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ListView } from '../components/list-view';
import { Toolbar } from '../components/toolbar';
import { CalendarProvider } from '../context';
import { useCalendar } from '../use-calendar';
import type { EnUsLabels } from './en-us';
import { enUsLabels } from './en-us';

/** 統合テスト用の固定「現在時刻」（東京の 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/** `Toolbar` と `ListView` に `enUsLabels` をスプレッドして描画するテスト用ハーネス。 */
function EnUsLabelsHarness(): ReactElement {
  const calendar = useCalendar({
    timeZone: 'Asia/Tokyo',
    now: () => NOW,
    initialDate: NOW,
    initialView: 'list',
    events: [],
  });
  return (
    <CalendarProvider value={calendar}>
      <Toolbar labels={enUsLabels.toolbar} />
      <ListView {...enUsLabels.list} />
    </CalendarProvider>
  );
}

describe('enUsLabels', () => {
  it('toolbar グループが ToolbarLabels の全キーを英語文言でカバーする', () => {
    expect(Object.keys(enUsLabels.toolbar).sort()).toEqual(
      [
        'month',
        'week',
        'day',
        'list',
        'year',
        'multiMonth',
        'resource',
        'timeline',
        'today',
        'prev',
        'next',
      ].sort(),
    );
    for (const value of Object.values(enUsLabels.toolbar)) {
      expect(typeof value).toBe('string');
    }
  });

  it('list グループが ListView/VirtualListView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.list).sort()).toEqual(['allDayLabel', 'emptyLabel'].sort());
    expect(enUsLabels.list.allDayLabel).toBe('All day');
    expect(enUsLabels.list.emptyLabel).toBe('No events');
  });

  it('month グループが MonthView の overflowLabel をカバーする', () => {
    expect(Object.keys(enUsLabels.month).sort()).toEqual(['overflowLabel']);
    expect(enUsLabels.month.overflowLabel(3)).toBe('+3 more');
  });

  it('multiMonth グループが MultiMonthView の overflowLabel をカバーする', () => {
    expect(Object.keys(enUsLabels.multiMonth).sort()).toEqual(['overflowLabel']);
    expect(enUsLabels.multiMonth.overflowLabel(5)).toBe('+5 more');
  });

  it('resource グループが ResourceView/VirtualResourceView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.resource).sort()).toEqual(
      ['unassignedLabel', 'emptyLabel'].sort(),
    );
    expect(enUsLabels.resource.unassignedLabel).toBe('Unassigned');
    expect(enUsLabels.resource.emptyLabel).toBe('No resources');
  });

  it('timeline グループが TimelineView/VirtualTimelineView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.timeline).sort()).toEqual(
      ['unassignedLabel', 'emptyLabel', 'cornerLabel'].sort(),
    );
    expect(enUsLabels.timeline.unassignedLabel).toBe('Unassigned');
    expect(enUsLabels.timeline.emptyLabel).toBe('No resources');
    expect(enUsLabels.timeline.cornerLabel).toBe('Resources');
  });

  it('calendarView グループが CalendarView の転送用 *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.calendarView).sort()).toEqual(
      [
        'listAllDayLabel',
        'listEmptyLabel',
        'monthOverflowLabel',
        'multiMonthOverflowLabel',
        'resourceUnassignedLabel',
        'resourceEmptyLabel',
        'timelineUnassignedLabel',
        'timelineEmptyLabel',
        'timelineCornerLabel',
      ].sort(),
    );
    expect(enUsLabels.calendarView.listAllDayLabel).toBe('All day');
    expect(enUsLabels.calendarView.timelineCornerLabel).toBe('Resources');
    expect(enUsLabels.calendarView.monthOverflowLabel(2)).toBe('+2 more');
  });

  it('既定値（日本語）と異なる文言になっている', () => {
    expect(enUsLabels.toolbar.today).not.toBe('今日');
    expect(enUsLabels.list.emptyLabel).not.toBe('予定はありません');
    expect(enUsLabels.resource.unassignedLabel).not.toBe('未割り当て');
    expect(enUsLabels.timeline.cornerLabel).not.toBe('リソース');
  });

  it('EnUsLabels 型で enUsLabels を受け取れる（構造の named export として機能する）', () => {
    const value: EnUsLabels = enUsLabels;
    expect(value).toBe(enUsLabels);
  });

  describe('統合テスト（実際のコンポーネントへスプレッドして描画）', () => {
    it('enUsLabels.toolbar を Toolbar に渡すと、today ボタンの表示文字列が "Today" になり、prev/next は aria-label のみ英語になる（表示アイコンは不変）', () => {
      const { container } = render(<EnUsLabelsHarness />);

      const today = container.querySelector('[data-koyomi-action="today"]');
      expect(today?.textContent).toBe('Today');
      expect(today?.getAttribute('aria-label')).toBe('Today');

      const prev = container.querySelector('[data-koyomi-action="prev"]');
      expect(prev?.textContent).toBe('‹');
      expect(prev?.getAttribute('aria-label')).toBe('Previous');

      const next = container.querySelector('[data-koyomi-action="next"]');
      expect(next?.textContent).toBe('›');
      expect(next?.getAttribute('aria-label')).toBe('Next');

      expect(container.querySelector('[data-koyomi-action="view-month"]')?.textContent).toBe(
        'Month',
      );
    });

    it('enUsLabels.list を ListView に渡すと、空状態の表示文字列が "No events" になる', () => {
      const { container } = render(<EnUsLabelsHarness />);

      expect(container.querySelector('[data-koyomi="list-empty"]')?.textContent).toBe('No events');
    });
  });
});
