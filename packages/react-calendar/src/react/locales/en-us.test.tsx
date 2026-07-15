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
import type {
  CalendarEvent,
  CalendarRangeChangeInfo,
  CalendarResource,
  EventOccurrence,
  ListDay,
  YearDay,
} from '../../core/types';
import { CalendarView } from '../components/calendar-view';
import { ListView } from '../components/list-view';
import { MonthView } from '../components/month-view';
import { ResourceView } from '../components/resource-view';
import { TimelineView } from '../components/timeline-view';
import { Toolbar } from '../components/toolbar';
import { YearView } from '../components/year-view';
import { CalendarProvider } from '../context';
import type { EventChange, EventDelete, RangeSelection } from '../types';
import { useCalendar } from '../use-calendar';
import type { AnnouncerFormatterContext } from '../use-calendar-announcer';
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
      [
        'unassignedLabel',
        'emptyLabel',
        'cornerLabel',
        'eventAriaLabel',
        'resourceToggleAriaLabel',
      ].sort(),
    );
    expect(enUsLabels.timeline.unassignedLabel).toBe('Unassigned');
    expect(enUsLabels.timeline.emptyLabel).toBe('No resources');
    expect(enUsLabels.timeline.cornerLabel).toBe('Resources');
    expect(
      enUsLabels.timeline.eventAriaLabel(makeOccurrence(), '荷揚げ、7月15日 9:00〜11:00'),
    ).toBe('荷揚げ, 7月15日 9:00–11:00');
    const resource = { id: 'room-a', title: '会議室A' };
    expect(
      enUsLabels.timeline.resourceToggleAriaLabel(resource, false, '会議室A を折りたたむ'),
    ).toBe('Collapse 会議室A');
    expect(enUsLabels.timeline.resourceToggleAriaLabel(resource, true, '会議室A を展開する')).toBe(
      'Expand 会議室A',
    );
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
        'timelineResourceToggleAriaLabel',
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

  describe('recurrenceEditor グループ（useRecurrenceRuleEditor の describeRule）', () => {
    it('DAILY: interval=1 は "Daily"、interval=2 以上は "Every N days" になる', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'daily', interval: 1, end: { type: 'never' } },
          '毎日',
        ),
      ).toBe('Daily');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'daily', interval: 3, end: { type: 'never' } },
          '3日ごと',
        ),
      ).toBe('Every 3 days');
    });

    it('WEEKLY: byWeekday を指定した場合は曜日の英語略称を含む文言になる', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'weekly', interval: 1, byWeekday: [3, 1], end: { type: 'never' } },
          '毎週月・水',
        ),
      ).toBe('Weekly on Mon, Wed');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'weekly', interval: 2, byWeekday: [1], end: { type: 'never' } },
          '2週ごとの月',
        ),
      ).toBe('Every 2 weeks on Mon');
    });

    it('WEEKLY: byWeekday 省略時は曜日を欠いた文言になる（describeRule には context がないため）', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'weekly', interval: 1, end: { type: 'never' } },
          '毎週水',
        ),
      ).toBe('Weekly');
    });

    it('MONTHLY: dayOfMonth は "Monthly on day N"、nthWeekday は "Monthly on the Nth Weekday" になる', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          {
            freq: 'monthly',
            interval: 1,
            monthlyPattern: { kind: 'dayOfMonth', day: 15 },
            end: { type: 'never' },
          },
          '毎月15日',
        ),
      ).toBe('Monthly on day 15');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          {
            freq: 'monthly',
            interval: 1,
            monthlyPattern: { kind: 'dayOfMonth', day: -1 },
            end: { type: 'never' },
          },
          '毎月末日',
        ),
      ).toBe('Monthly on the last day');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          {
            freq: 'monthly',
            interval: 1,
            monthlyPattern: { kind: 'nthWeekday', ordinal: 2, weekday: 1 },
            end: { type: 'never' },
          },
          '毎月 第2月曜日',
        ),
      ).toBe('Monthly on the 2nd Monday');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          {
            freq: 'monthly',
            interval: 1,
            monthlyPattern: { kind: 'nthWeekday', ordinal: -1, weekday: 5 },
            end: { type: 'never' },
          },
          '毎月 最終金曜日',
        ),
      ).toBe('Monthly on the last Friday');
    });

    it('YEARLY: state に月日を持たないため、常に月日を欠いた文言になる', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'yearly', interval: 1, end: { type: 'never' } },
          '毎年7月1日',
        ),
      ).toBe('Annually');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'yearly', interval: 2, end: { type: 'never' } },
          '2年ごとの7月1日',
        ),
      ).toBe('Every 2 years');
    });

    it('end.type=count は末尾に " (for N occurrences)" を付加する（count=1 は単数形）', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'daily', interval: 1, end: { type: 'count', count: 1 } },
          '毎日（1回）',
        ),
      ).toBe('Daily (for 1 occurrence)');
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'daily', interval: 1, end: { type: 'count', count: 5 } },
          '毎日（5回）',
        ),
      ).toBe('Daily (for 5 occurrences)');
    });

    it('end.type=until は末尾に " (until Jul 5, 2026)" を付加する', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          {
            freq: 'daily',
            interval: 1,
            end: { type: 'until', until: new Date('2026-07-05T00:00:00Z') },
          },
          '毎日（2026年7月5日まで）',
        ),
      ).toBe('Daily (until Jul 5, 2026)');
    });

    it('end.type=never は末尾に何も付加しない', () => {
      expect(
        enUsLabels.recurrenceEditor.describeRule(
          { freq: 'daily', interval: 1, end: { type: 'never' } },
          '毎日',
        ),
      ).toBe('Daily');
    });
  });

  describe('announcer グループ（useCalendarAnnouncer の messages）', () => {
    const ctx: AnnouncerFormatterContext = {
      timeZone: 'Asia/Tokyo',
      locale: 'en-US',
      resources: [],
    };
    const ctxWithResource: AnnouncerFormatterContext = {
      timeZone: 'Asia/Tokyo',
      locale: 'en-US',
      resources: [{ id: 'r1', title: 'Room A' }],
    };

    function makeOccurrence(allDay = false): EventOccurrence {
      const start = new Date('2026-07-15T01:00:00Z'); // 東京 10:00
      const end = allDay ? new Date('2026-07-15T15:00:00Z') : new Date('2026-07-15T02:00:00Z');
      return {
        key: `e1@${start.toISOString()}`,
        eventId: 'e1',
        event: { id: 'e1', title: 'Meeting', start, end, allDay },
        start,
        end,
        allDay,
        isRecurring: false,
        originalStart: start,
      };
    }

    it('AnnouncerMessages の 4 関数をカバーする', () => {
      expect(Object.keys(enUsLabels.announcer).sort()).toEqual(
        ['eventChanged', 'eventCreated', 'eventDeleted', 'viewChanged'].sort(),
      );
    });

    it('eventChanged: duration 不変は "moved to"、duration が変わると "resized to" になる', () => {
      const moved: EventChange = {
        occurrence: makeOccurrence(),
        newRange: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
        scope: null,
        changes: [],
      };
      expect(enUsLabels.announcer.eventChanged(moved, '既定文言', ctx)).toBe(
        'Meeting moved to July 16 10:00–11:00',
      );

      const resized: EventChange = {
        occurrence: makeOccurrence(),
        newRange: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T02:30:00Z'),
        },
        allDay: false,
        scope: null,
        changes: [],
      };
      expect(enUsLabels.announcer.eventChanged(resized, '既定文言', ctx)).toBe(
        'Meeting resized to July 15 10:00–11:30',
      );
    });

    it('eventChanged: allDay が変化すると変換の文言になり、resourceId があればリソース名を付記する', () => {
      const toAllDay: EventChange = {
        occurrence: makeOccurrence(false),
        newRange: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T15:00:00Z'),
        },
        allDay: true,
        scope: null,
        resourceId: 'r1',
        changes: [],
      };
      expect(enUsLabels.announcer.eventChanged(toAllDay, '既定文言', ctxWithResource)).toBe(
        'Meeting changed to an all-day event, now on July 16 (Room A)',
      );

      const toTimed: EventChange = {
        occurrence: makeOccurrence(true),
        newRange: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
        scope: null,
        resourceId: null,
        changes: [],
      };
      expect(enUsLabels.announcer.eventChanged(toTimed, '既定文言', ctx)).toBe(
        'Meeting changed to a timed event, now at July 16 10:00–11:00 (Unassigned)',
      );
    });

    it('eventCreated: 作成イベント・選択範囲から英語文言を組み立てる', () => {
      const selection: RangeSelection = {
        range: {
          start: new Date('2026-07-16T01:00:00Z'),
          end: new Date('2026-07-16T02:00:00Z'),
        },
        allDay: false,
        resourceId: 'r1',
      };
      const event: CalendarEvent = {
        id: 'e2',
        title: 'Meeting',
        start: selection.range.start,
        end: selection.range.end,
      };
      expect(enUsLabels.announcer.eventCreated(event, selection, '既定文言', ctxWithResource)).toBe(
        'Meeting created for July 16 10:00–11:00 (Room A)',
      );
    });

    it('eventDeleted: scope ごとに付記が変わる（null は付記なし）', () => {
      const base: Omit<EventDelete, 'scope'> = { occurrence: makeOccurrence(), changes: [] };
      expect(enUsLabels.announcer.eventDeleted({ ...base, scope: null }, '既定文言', ctx)).toBe(
        'Meeting deleted',
      );
      expect(enUsLabels.announcer.eventDeleted({ ...base, scope: 'this' }, '既定文言', ctx)).toBe(
        'Meeting deleted (this event only)',
      );
      expect(
        enUsLabels.announcer.eventDeleted({ ...base, scope: 'thisAndFollowing' }, '既定文言', ctx),
      ).toBe('Meeting deleted (this and following events)');
      expect(enUsLabels.announcer.eventDeleted({ ...base, scope: 'all' }, '既定文言', ctx)).toBe(
        'Meeting deleted (all events in the series)',
      );
    });

    it('viewChanged: formatViewTitle の英語整形結果を含む文言になる', () => {
      const info: CalendarRangeChangeInfo = {
        view: 'month',
        currentDate: new Date('2026-07-15T01:00:00Z'),
        rangeStart: new Date('2026-06-30T15:00:00Z'),
        rangeEnd: new Date('2026-07-31T15:00:00Z'),
      };
      expect(enUsLabels.announcer.viewChanged(info, '既定文言', ctx)).toBe(
        'Switched view to July 2026',
      );
    });
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

    it('month グループを MonthView にスプレッドすると「+N 件」ボタンが "+2 more" になる', () => {
      // 3 件のうち dayMaxEvents=1 まで表示、残り 2 件を overflow として表現するため
      // 同日に複数の予定を用意する。
      const events: CalendarEvent[] = [
        { id: 'a', title: '予定A', start: '2026-07-16T09:00', end: '2026-07-16T09:30' },
        { id: 'b', title: '予定B', start: '2026-07-16T10:00', end: '2026-07-16T10:30' },
        { id: 'c', title: '予定C', start: '2026-07-16T11:00', end: '2026-07-16T11:30' },
      ];
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'month',
          events,
          dayMaxEvents: 1,
        });
        return (
          <CalendarProvider value={calendar}>
            <MonthView {...enUsLabels.month} />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow?.textContent).toBe('+2 more');
    });

    it('resource グループを ResourceView にスプレッドすると、未割り当て列見出しが "Unassigned"、空状態が "No resources" になる', () => {
      function HarnessWithResource(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'resource',
          events: [],
          resources: [{ id: 'r1', title: 'リソース1' } satisfies CalendarResource],
          unassignedLane: 'always',
        });
        return (
          <CalendarProvider value={calendar}>
            <ResourceView {...enUsLabels.resource} />
          </CalendarProvider>
        );
      }
      const { container: withUnassigned } = render(<HarnessWithResource />);
      const headers = withUnassigned.querySelectorAll('[data-koyomi="resource-header-cell"]');
      // 1 リソース + unassignedLane: 'always' なので、最後の列見出しが未割り当て列になる。
      const unassignedHeader = headers[headers.length - 1];
      expect(unassignedHeader?.textContent).toBe('Unassigned');

      function HarnessEmpty(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'resource',
          events: [],
          resources: [],
          unassignedLane: 'auto',
        });
        return (
          <CalendarProvider value={calendar}>
            <ResourceView {...enUsLabels.resource} />
          </CalendarProvider>
        );
      }
      const { container: empty } = render(<HarnessEmpty />);
      const emptyEl = empty.querySelector('[data-koyomi="resource-empty"]');
      expect(emptyEl?.textContent).toBe('No resources');
    });

    it('timeline グループを TimelineView にスプレッドすると、角セルの aria-label が "Resources" になる', () => {
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'timeline',
          events: [],
          resources: [{ id: 'r1', title: 'リソース1' } satisfies CalendarResource],
        });
        return (
          <CalendarProvider value={calendar}>
            <TimelineView {...enUsLabels.timeline} />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const corner = container.querySelector('[data-koyomi="timeline-corner"]');
      expect(corner?.getAttribute('aria-label')).toBe('Resources');
    });

    it('year グループを YearView にスプレッドすると、日セルの件数文言が "N events"（複数）/ "1 event"（単数）になる', () => {
      const events: CalendarEvent[] = [
        { id: 'a', title: '予定A', start: '2026-07-10T09:00', end: '2026-07-10T09:30' },
        { id: 'b', title: '予定B', start: '2026-07-10T10:00', end: '2026-07-10T10:30' },
        { id: 'c', title: '予定C', start: '2026-07-11T09:00', end: '2026-07-11T09:30' },
      ];
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'year',
          events,
        });
        return (
          <CalendarProvider value={calendar}>
            <YearView {...enUsLabels.year} />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const dayWithTwo = container.querySelector(
        '[data-koyomi="year-day"][data-koyomi-date="2026-07-10"]',
      );
      const dayWithOne = container.querySelector(
        '[data-koyomi="year-day"][data-koyomi-date="2026-07-11"]',
      );
      expect(dayWithTwo?.getAttribute('aria-label')).toContain('2 events');
      expect(dayWithOne?.getAttribute('aria-label')).toContain('1 event');
      expect(dayWithOne?.getAttribute('aria-label')).not.toContain('1 events');
    });

    it('calendarView グループを CalendarView にスプレッドすると、list ビューの空状態が "No events" になる', () => {
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'list',
          events: [],
        });
        return (
          <CalendarProvider value={calendar}>
            <CalendarView {...enUsLabels.calendarView} />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const empty = container.querySelector('[data-koyomi="list-empty"]');
      expect(empty?.textContent).toBe('No events');
    });

    it('enUsLabels を渡さない場合は既定の日本語文言のまま（MonthView の「+N 件」）', () => {
      const events: CalendarEvent[] = [
        { id: 'a', title: '予定A', start: '2026-07-16T09:00', end: '2026-07-16T09:30' },
        { id: 'b', title: '予定B', start: '2026-07-16T10:00', end: '2026-07-16T10:30' },
      ];
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'month',
          events,
          dayMaxEvents: 1,
        });
        return (
          <CalendarProvider value={calendar}>
            <MonthView />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const overflow = container.querySelector('[data-koyomi="month-overflow"]');
      expect(overflow?.textContent).toBe('+1 件');
    });

    it('locale: "ja"（既定）のまま month.eventAriaLabel を使うと、区切り記号は英語化されるが曜日表記は日本語のまま残る', () => {
      // enUsLabels の eventAriaLabel が変換するのは既定文字列中の区切り記号だけである。
      // 曜日・月名などの日付・時刻表記自体は defaultLabel の時点で Intl.DateTimeFormat
      // によりカレンダーの locale オプションで整形済みのため、enUsLabels はそれらを
      // 変換しない。locale: 'ja'（既定）のまま enUsLabels だけを渡した場合、区切り記号は
      // 英語表記になるが、曜日等の日付・時刻表記は locale に従って日本語のままになる。
      const events: CalendarEvent[] = [
        { id: 'a', title: '会議', start: '2026-07-16T09:00', end: '2026-07-16T09:30' },
      ];
      function Harness(): ReactElement {
        const calendar = useCalendar({
          timeZone: 'Asia/Tokyo',
          now: () => NOW,
          initialDate: NOW,
          initialView: 'month',
          events,
          // locale を明示的に指定しない（既定の 'ja' のまま）
        });
        return (
          <CalendarProvider value={calendar}>
            <MonthView {...enUsLabels.month} />
          </CalendarProvider>
        );
      }
      const { container } = render(<Harness />);
      const eventButton = container.querySelector('[data-koyomi="month-event"]');
      const label = eventButton?.getAttribute('aria-label') ?? '';
      // 区切り記号（「、」「〜」）は英語表記に変換される
      expect(label).not.toContain('、');
      expect(label).toContain(', ');
      // 一方、日付・時刻表記自体は locale: 'ja' の Intl 整形のままなので、
      // 「9:00」のような時刻表記に変化はない（英語ロケールの "9:00 AM" 等にはならない）
      expect(label).toContain('9:00');
    });
  });
});
