import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EventOccurrence, ListDay } from '../../core/types';
import { jaMessages } from '../locales/ja';
import {
  eventSwatchStyle,
  formatTimedEventTimeLabel,
  type ListDayItemWindow,
  ListDaySection,
  type ListDaySectionProps,
  sameListDay,
  sameListDayItemWindow,
} from './list-view-parts';

function occurrence(): EventOccurrence {
  const start = new Date('2026-07-15T01:05:00Z');
  return {
    key: 'e1@2026-07-15T01:05:00.000Z',
    eventId: 'e1',
    event: { id: 'e1', title: '会議', start, end: new Date('2026-07-15T02:35:00Z') },
    start,
    end: new Date('2026-07-15T02:35:00Z'),
    allDay: false,
    isRecurring: false,
    originalStart: start,
  };
}

/** `ListDaySection` の memo 化テスト用のオカレンスを作る。 */
function makeOccurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  const start = new Date('2026-07-16T01:00:00Z');
  const end = new Date('2026-07-16T02:00:00Z');
  return {
    key: 'e1@2026-07-16T01:00:00.000Z',
    eventId: 'e1',
    event: { id: 'e1', title: '会議', start, end },
    start,
    end,
    allDay: false,
    isRecurring: false,
    originalStart: start,
    ...overrides,
  };
}

/** `ListDaySection` の memo 化テスト用の `ListDay` を作る。 */
function makeDay(overrides: Partial<ListDay> = {}): ListDay {
  return {
    date: new Date('2026-07-16T00:00:00+09:00'),
    key: '2026-07-16',
    isToday: false,
    occurrences: [makeOccurrence()],
    ...overrides,
  };
}

/** `ListDaySection` の memo 化テスト用の props を作る。 */
function makeSectionProps(overrides: Partial<ListDaySectionProps> = {}): ListDaySectionProps {
  return {
    day: makeDay(),
    timeZone: 'Asia/Tokyo',
    locale: 'ja',
    defaultDayHeader: '7月16日(木)',
    allDayLabel: jaMessages.list.allDay,
    commonMessages: jaMessages.common,
    onEventClick: () => {},
    onEventKeyDown: () => {},
    callbacks: {},
    ...overrides,
  };
}

describe('list-view-parts', () => {
  it('時間指定イベントを表示タイムゾーンの時刻範囲へ整形する（locale=ja）', () => {
    expect(formatTimedEventTimeLabel(occurrence(), 'Asia/Tokyo', 'ja', '〜')).toBe('10:05〜11:35');
  });

  it('locale=en-US では 12h/AM-PM 表記の時刻範囲になる', () => {
    expect(formatTimedEventTimeLabel(occurrence(), 'Asia/Tokyo', 'en-US', '–')).toBe(
      '10:05 AM–11:35 AM',
    );
  });

  it('rangeSeparator を差し替えると区切り記号が変わる', () => {
    expect(formatTimedEventTimeLabel(occurrence(), 'Asia/Tokyo', 'ja', '-')).toBe('10:05-11:35');
  });

  it('色指定時だけイベント色 CSS 変数を返す', () => {
    expect(eventSwatchStyle(undefined)).toBeUndefined();
    expect(eventSwatchStyle('#123456')).toEqual({ '--koyomi-event-color': '#123456' });
  });
});

describe('sameListDay', () => {
  it('key・isToday・occurrences の内容が同じなら、参照が違っても true', () => {
    const day = makeDay();
    const other: ListDay = {
      ...day,
      date: new Date(day.date.getTime()),
      occurrences: day.occurrences.map((item) => ({ ...item, event: { ...item.event } })),
    };
    expect(sameListDay(day, other)).toBe(true);
  });

  it('isToday が異なれば false', () => {
    const day = makeDay({ isToday: false });
    const other: ListDay = { ...day, isToday: true };
    expect(sameListDay(day, other)).toBe(false);
  });

  it('occurrences の件数が異なれば false', () => {
    const day = makeDay();
    const other: ListDay = {
      ...day,
      occurrences: [...day.occurrences, makeOccurrence({ key: 'e2@x', eventId: 'e2' })],
    };
    expect(sameListDay(day, other)).toBe(false);
  });

  it('occurrence のタイトル・色・編集可否・開始/終了時刻いずれかが異なれば false', () => {
    const day = makeDay();
    expect(
      sameListDay(day, {
        ...day,
        occurrences: [
          { ...makeOccurrence(), event: { ...makeOccurrence().event, title: '別タイトル' } },
        ],
      }),
    ).toBe(false);
    expect(
      sameListDay(day, {
        ...day,
        occurrences: [{ ...makeOccurrence(), event: { ...makeOccurrence().event, color: '#fff' } }],
      }),
    ).toBe(false);
    expect(
      sameListDay(day, {
        ...day,
        occurrences: [
          { ...makeOccurrence(), event: { ...makeOccurrence().event, editable: false } },
        ],
      }),
    ).toBe(false);
    expect(
      sameListDay(day, {
        ...day,
        occurrences: [
          { ...makeOccurrence(), end: new Date(makeOccurrence().end.getTime() + 60_000) },
        ],
      }),
    ).toBe(false);
  });
});

describe('sameListDayItemWindow', () => {
  const baseWindow: ListDayItemWindow = {
    startIndex: 0,
    endIndex: 4,
    topPad: 0,
    bottomPad: 100,
    estimateItemSize: 32,
  };

  it('未指定同士は true、片方だけ未指定なら false', () => {
    expect(sameListDayItemWindow(undefined, undefined)).toBe(true);
    expect(sameListDayItemWindow(baseWindow, undefined)).toBe(false);
    expect(sameListDayItemWindow(undefined, baseWindow)).toBe(false);
  });

  it('内容が同じなら参照が違っても true', () => {
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow })).toBe(true);
  });

  it('startIndex/endIndex/topPad/bottomPad/estimateItemSize のいずれかが異なれば false', () => {
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow, startIndex: 1 })).toBe(false);
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow, endIndex: 5 })).toBe(false);
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow, topPad: 32 })).toBe(false);
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow, bottomPad: 50 })).toBe(false);
    expect(sameListDayItemWindow(baseWindow, { ...baseWindow, estimateItemSize: 40 })).toBe(false);
  });

  it('pinnedKeys の内容が同じなら参照が違っても true、内容が異なれば false', () => {
    const withPinned: ListDayItemWindow = { ...baseWindow, pinnedKeys: new Set(['k1']) };
    expect(sameListDayItemWindow(withPinned, { ...baseWindow, pinnedKeys: new Set(['k1']) })).toBe(
      true,
    );
    expect(sameListDayItemWindow(withPinned, { ...baseWindow, pinnedKeys: new Set(['k2']) })).toBe(
      false,
    );
    expect(sameListDayItemWindow(withPinned, baseWindow)).toBe(false);
  });
});

describe('ListDaySection のメモ化', () => {
  it(
    '内容が同じでも参照が新しい day（viewModel 再構築を模す）を渡した再レンダーでは、' +
      '内部実装が再実行されない（renderEvent の呼び出し回数で確認する性能ピン留め）',
    () => {
      const renderEvent = vi.fn((occurrence: EventOccurrence) => (
        <span>{occurrence.event.title}</span>
      ));
      const day = makeDay();
      const props = makeSectionProps({ day, renderEvent });
      const { rerender } = render(<ListDaySection {...props} />);
      expect(renderEvent).toHaveBeenCalledTimes(1);

      const sameContentDay: ListDay = {
        ...day,
        occurrences: day.occurrences.map((item) => ({ ...item, event: { ...item.event } })),
      };
      rerender(<ListDaySection {...props} day={sameContentDay} />);

      expect(renderEvent).toHaveBeenCalledTimes(1);
    },
  );

  it('occurrence の内容（タイトル）が変わった場合は再レンダーされる', () => {
    const renderEvent = vi.fn((occurrence: EventOccurrence) => (
      <span>{occurrence.event.title}</span>
    ));
    const day = makeDay();
    const props = makeSectionProps({ day, renderEvent });
    const { rerender } = render(<ListDaySection {...props} />);
    expect(renderEvent).toHaveBeenCalledTimes(1);

    const changedDay: ListDay = {
      ...day,
      occurrences: [
        { ...makeOccurrence(), event: { ...makeOccurrence().event, title: '別タイトル' } },
      ],
    };
    rerender(<ListDaySection {...props} day={changedDay} />);

    expect(renderEvent).toHaveBeenCalledTimes(2);
  });

  it('itemWindow の内容が同じでも参照が新しい再レンダーでは再実行されない（セクション内ウィンドウ描画）', () => {
    const renderEvent = vi.fn((occurrence: EventOccurrence) => (
      <span>{occurrence.event.title}</span>
    ));
    const day = makeDay();
    const itemWindow: ListDayItemWindow = {
      startIndex: 0,
      endIndex: 0,
      topPad: 0,
      bottomPad: 0,
      estimateItemSize: 32,
    };
    const props = makeSectionProps({ day, renderEvent, itemWindow });
    const { rerender } = render(<ListDaySection {...props} />);
    expect(renderEvent).toHaveBeenCalledTimes(1);

    rerender(<ListDaySection {...props} itemWindow={{ ...itemWindow }} />);

    expect(renderEvent).toHaveBeenCalledTimes(1);
  });

  it('itemWindow の描画範囲が変わった場合は再レンダーされる', () => {
    const renderEvent = vi.fn((occurrence: EventOccurrence) => (
      <span>{occurrence.event.title}</span>
    ));
    const day = makeDay({
      occurrences: [
        makeOccurrence(),
        makeOccurrence({ key: 'e2@2026-07-16T03:00:00.000Z', eventId: 'e2' }),
      ],
    });
    const itemWindow: ListDayItemWindow = {
      startIndex: 0,
      endIndex: 0,
      topPad: 0,
      bottomPad: 32,
      estimateItemSize: 32,
    };
    const props = makeSectionProps({ day, renderEvent, itemWindow });
    const { rerender } = render(<ListDaySection {...props} />);
    expect(renderEvent).toHaveBeenCalledTimes(1);
    expect(renderEvent.mock.calls[0]?.[0]?.eventId).toBe('e1');

    rerender(
      <ListDaySection
        {...props}
        itemWindow={{ ...itemWindow, startIndex: 1, endIndex: 1, topPad: 32, bottomPad: 0 }}
      />,
    );

    // 描画範囲が変わったので再実行され、描画対象が occurrences[0] から [1] に変わる
    expect(renderEvent).toHaveBeenCalledTimes(2);
    expect(renderEvent.mock.calls[1]?.[0]?.eventId).toBe('e2');
  });

  it('無関係な props（callbacks の参照違い）は同じ内容でも再レンダーの引き金になる（memo は参照比較のため）', () => {
    const renderEvent = vi.fn((occurrence: EventOccurrence) => (
      <span>{occurrence.event.title}</span>
    ));
    const day = makeDay();
    const props = makeSectionProps({ day, renderEvent });
    const { rerender } = render(<ListDaySection {...props} />);
    expect(renderEvent).toHaveBeenCalledTimes(1);

    // callbacks は内容が同じでも新しいオブジェクト参照なので再レンダーされる
    rerender(<ListDaySection {...props} callbacks={{}} />);

    expect(renderEvent).toHaveBeenCalledTimes(2);
  });
});
