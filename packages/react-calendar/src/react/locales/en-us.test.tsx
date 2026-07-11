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
import type { CalendarEvent, EventOccurrence, ListDay, YearDay } from '../../core/types';
import { ListView } from '../components/list-view';
import { Toolbar } from '../components/toolbar';
import { CalendarProvider } from '../context';
import { useCalendar } from '../use-calendar';
import type { EnUsLabels } from './en-us';
import { enUsLabels } from './en-us';

/** 統合テスト用の固定「現在時刻」（東京の 2026-07-15 10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');

/**
 * `eventAriaLabel` 系関数の単体テスト用に、最小限の妥当な `EventOccurrence` を作る。
 * 各関数はいずれも `occurrence` 自体の中身は参照しない（`defaultLabel` の文字列変換のみ）ため、
 * 内容は問わず型を満たすだけでよい。
 */
function makeOccurrence(): EventOccurrence {
  const start = new Date('2026-07-16T01:00:00Z');
  const end = new Date('2026-07-16T02:00:00Z');
  const event: CalendarEvent = { id: 'e1', title: '会議', start, end };
  return {
    key: `e1@${start.toISOString()}`,
    eventId: 'e1',
    event,
    start,
    end,
    allDay: false,
    isRecurring: false,
    originalStart: start,
  };
}

/** `list.dayAriaLabel` の単体テスト用に、最小限の妥当な `ListDay` を作る（件数のみ使う）。 */
function makeListDay(occurrenceCount: number): ListDay {
  return {
    date: new Date('2026-07-16T00:00:00+09:00'),
    key: '2026-07-16',
    isToday: false,
    occurrences: Array.from({ length: occurrenceCount }, () => makeOccurrence()),
  };
}

/** `year.dayAriaLabel` の単体テスト用に、最小限の妥当な `YearDay` を作る（未使用だが型を満たす）。 */
function makeYearDay(): YearDay {
  return {
    date: new Date('2026-07-10T00:00:00+09:00'),
    key: '2026-07-10',
    inCurrentMonth: true,
    isToday: false,
    eventCount: 3,
  };
}

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
        'viewsGroup',
      ].sort(),
    );
    for (const value of Object.values(enUsLabels.toolbar)) {
      expect(typeof value).toBe('string');
    }
    expect(enUsLabels.toolbar.viewsGroup).toBe('View switcher');
  });

  it('list グループが ListView/VirtualListView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.list).sort()).toEqual(
      ['allDayLabel', 'emptyLabel', 'eventAriaLabel', 'dayAriaLabel'].sort(),
    );
    expect(enUsLabels.list.allDayLabel).toBe('All day');
    expect(enUsLabels.list.emptyLabel).toBe('No events');
    expect(enUsLabels.list.eventAriaLabel(makeOccurrence(), '会議、7月16日 10:00〜11:00')).toBe(
      '会議, 7月16日 10:00–11:00',
    );
    expect(enUsLabels.list.dayAriaLabel(makeListDay(2), '7月16日(木) 予定2件')).toBe(
      '7月16日(木) 2 events',
    );
  });

  it('month グループが MonthView の overflowLabel / eventAriaLabel をカバーする', () => {
    expect(Object.keys(enUsLabels.month).sort()).toEqual(
      ['overflowLabel', 'eventAriaLabel'].sort(),
    );
    expect(enUsLabels.month.overflowLabel(3)).toBe('+3 more');
    expect(enUsLabels.month.eventAriaLabel(makeOccurrence(), '会議、7月16日 10:00〜11:00')).toBe(
      '会議, 7月16日 10:00–11:00',
    );
  });

  it('multiMonth グループが MultiMonthView の overflowLabel / eventAriaLabel をカバーする', () => {
    expect(Object.keys(enUsLabels.multiMonth).sort()).toEqual(
      ['overflowLabel', 'eventAriaLabel'].sort(),
    );
    expect(enUsLabels.multiMonth.overflowLabel(5)).toBe('+5 more');
    expect(enUsLabels.multiMonth.eventAriaLabel(makeOccurrence(), '会議、7月16日')).toBe(
      '会議, 7月16日',
    );
  });

  it('resource グループが ResourceView/VirtualResourceView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.resource).sort()).toEqual(
      ['unassignedLabel', 'emptyLabel', 'eventAriaLabel'].sort(),
    );
    expect(enUsLabels.resource.unassignedLabel).toBe('Unassigned');
    expect(enUsLabels.resource.emptyLabel).toBe('No resources');
    expect(
      enUsLabels.resource.eventAriaLabel(makeOccurrence(), '会議、7月16日 10:00〜11:00、会議室A'),
    ).toBe('会議, 7月16日 10:00–11:00, 会議室A');
  });

  it('timeline グループが TimelineView/VirtualTimelineView の *Label props をカバーする', () => {
    expect(Object.keys(enUsLabels.timeline).sort()).toEqual(
      ['unassignedLabel', 'emptyLabel', 'cornerLabel', 'eventAriaLabel'].sort(),
    );
    expect(enUsLabels.timeline.unassignedLabel).toBe('Unassigned');
    expect(enUsLabels.timeline.emptyLabel).toBe('No resources');
    expect(enUsLabels.timeline.cornerLabel).toBe('Resources');
    expect(
      enUsLabels.timeline.eventAriaLabel(makeOccurrence(), '荷揚げ、7月15日 9:00〜11:00'),
    ).toBe('荷揚げ, 7月15日 9:00–11:00');
  });

  it('year グループが YearView の dayCountLabel / dayAriaLabel をカバーする', () => {
    expect(Object.keys(enUsLabels.year).sort()).toEqual(['dayCountLabel', 'dayAriaLabel'].sort());
    expect(enUsLabels.year.dayCountLabel(1)).toBe('1 event');
    expect(enUsLabels.year.dayCountLabel(3)).toBe('3 events');
    // dayAriaLabel は dayCountLabel 適用後の defaultLabel をそのまま返す（追加の変換不要）
    expect(enUsLabels.year.dayAriaLabel(makeYearDay(), '7月10日 3 events')).toBe(
      '7月10日 3 events',
    );
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
        'monthEventAriaLabel',
        'timeGridEventAriaLabel',
        'listEventAriaLabel',
        'listDayAriaLabel',
        'multiMonthEventAriaLabel',
        'resourceEventAriaLabel',
        'timelineEventAriaLabel',
        'yearDayCountLabel',
        'yearDayAriaLabel',
      ].sort(),
    );
    expect(enUsLabels.calendarView.listAllDayLabel).toBe('All day');
    expect(enUsLabels.calendarView.timelineCornerLabel).toBe('Resources');
    expect(enUsLabels.calendarView.monthOverflowLabel(2)).toBe('+2 more');
    expect(enUsLabels.calendarView.yearDayCountLabel(1)).toBe('1 event');
    expect(
      enUsLabels.calendarView.monthEventAriaLabel(makeOccurrence(), '会議、7月16日 10:00〜11:00'),
    ).toBe('会議, 7月16日 10:00–11:00');
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

      const viewsGroup = container.querySelector('[data-koyomi="toolbar-views"]');
      expect(viewsGroup?.getAttribute('aria-label')).toBe('View switcher');
    });

    it('enUsLabels.list を ListView に渡すと、空状態の表示文字列が "No events" になる', () => {
      const { container } = render(<EnUsLabelsHarness />);

      expect(container.querySelector('[data-koyomi="list-empty"]')?.textContent).toBe('No events');
    });
  });
});
