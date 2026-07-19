/**
 * use-grid-navigation.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * `CalendarProvider` の `gridNavigation` を有効にしたビルトインビュー
 * （月・複数月・年・週/日の終日行）を通した結合テストとして、
 * roving tabindex（単一 Tab ストップ）と矢印キーによるセル間移動、
 * セル/予定のモード分離（Enter・Escape）を検証する。
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarApi, CalendarEvent, CalendarViewType } from '../core/types';
import { CalendarView } from './components/calendar-view';
import { CalendarProvider } from './context';
import type { CalendarInteractionCallbacks } from './types';
import { useCalendar } from './use-calendar';

/** テストで使う表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** 「現在時刻」として固定する日時（東京では 2026-07-15（水）10:00）。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/** `CalendarView` を `CalendarProvider` 配下で描画するテスト用ラッパ。 */
function Harness(props: {
  gridNavigation?: boolean;
  initialView?: CalendarViewType;
  events?: readonly CalendarEvent[];
  callbacks?: CalendarInteractionCallbacks;
  apiRef?: { current: CalendarApi | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: props.initialView ?? 'month',
    events: props.events ?? EMPTY_EVENTS,
  });
  if (props.apiRef !== undefined) {
    props.apiRef.current = calendar.api;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.callbacks !== undefined ? { callbacks: props.callbacks } : {})}
      {...(props.gridNavigation !== undefined ? { gridNavigation: props.gridNavigation } : {})}
    >
      <CalendarView />
    </CalendarProvider>
  );
}

/** 指定した日付キーのセル要素（`data-koyomi` 種別つき）を取得する。見つからなければ失敗。 */
function cellByKey(container: HTMLElement, koyomi: string, key: string): HTMLElement {
  const element = container.querySelector(`[data-koyomi="${koyomi}"][data-koyomi-date="${key}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`セルが見つかりません: ${koyomi} ${key}`);
  }
  return element;
}

/** 年ビューの日ボタン（前後月の日を除く）を取得する。 */
function yearDayByKey(container: HTMLElement, key: string): HTMLElement {
  const element = container.querySelector(
    `[data-koyomi="year-day"][data-koyomi-date="${key}"]:not([data-outside])`,
  );
  if (!(element instanceof HTMLElement)) {
    throw new Error(`年ビューの日ボタンが見つかりません: ${key}`);
  }
  return element;
}

describe('gridNavigation 既定（未指定）の挙動', () => {
  it('月ビューの全日セルが tabIndex=0 のままで、矢印キーでもフォーカスは移動しない', () => {
    const { container } = render(<Harness />);
    const cells = Array.from(container.querySelectorAll('[data-koyomi="month-day"]'));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell).toHaveAttribute('tabindex', '0');
    }

    const today = cellByKey(container, 'month-day', '2026-07-15');
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(today);
  });

  it('年ビューの日ボタンに tabindex 属性を付けない（ネイティブの Tab 順のまま）', () => {
    const { container } = render(<Harness initialView="year" />);
    const buttons = Array.from(container.querySelectorAll('[data-koyomi="year-day"]'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).not.toHaveAttribute('tabindex');
    }
  });
});

describe('月ビューの roving tabindex', () => {
  it('有効時は今日のセルだけが Tab ストップ（tabIndex=0）になり、他のセルは -1 になる', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const cells = Array.from(container.querySelectorAll('[data-koyomi="month-day"]'));
    for (const cell of cells) {
      const expected = cell.getAttribute('data-koyomi-date') === '2026-07-15' ? '0' : '-1';
      expect(cell).toHaveAttribute('tabindex', expected);
    }
  });

  it('ArrowRight / ArrowLeft で左右のセルへフォーカスが移り、Tab ストップが追従する', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const today = cellByKey(container, 'month-day', '2026-07-15');
    act(() => today.focus());

    fireEvent.keyDown(today, { key: 'ArrowRight' });
    const next = cellByKey(container, 'month-day', '2026-07-16');
    expect(document.activeElement).toBe(next);
    expect(next).toHaveAttribute('tabindex', '0');
    expect(today).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(next, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(today);
    expect(today).toHaveAttribute('tabindex', '0');
  });

  it('行末の ArrowRight は次の週の先頭セルへ移る（読み順の連続移動）', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const saturday = cellByKey(container, 'month-day', '2026-07-18');
    act(() => saturday.focus());
    fireEvent.keyDown(saturday, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-07-19'));
  });

  it('ArrowDown / ArrowUp は同じ曜日列の隣の週へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const today = cellByKey(container, 'month-day', '2026-07-15');
    act(() => today.focus());

    fireEvent.keyDown(today, { key: 'ArrowDown' });
    const below = cellByKey(container, 'month-day', '2026-07-22');
    expect(document.activeElement).toBe(below);

    fireEvent.keyDown(below, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(today);
  });

  it('グリッドの端では移動せずフォーカスを維持する', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const first = cellByKey(container, 'month-day', '2026-06-28');
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('Home / End は行の先頭・末尾へ、Ctrl+Home / Ctrl+End はグリッド全体の先頭・末尾へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const today = cellByKey(container, 'month-day', '2026-07-15');
    act(() => today.focus());

    fireEvent.keyDown(today, { key: 'Home' });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-07-12'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-07-18'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home', ctrlKey: true });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-06-28'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End', ctrlKey: true });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-08-01'));
  });

  it('PageDown で次の期間へ切り替わり、フォーカスは新しいグリッドの既定セル（今日がなければ先頭）へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} />);
    const today = cellByKey(container, 'month-day', '2026-07-15');
    act(() => today.focus());

    fireEvent.keyDown(today, { key: 'PageDown' });
    // 8 月のグリッド（7/26〜9/5）には今日（7/15）がないため先頭セルへ
    expect(container.querySelector('[data-koyomi-date="2026-08-15"]')).not.toBeNull();
    const augFirst = cellByKey(container, 'month-day', '2026-07-26');
    expect(document.activeElement).toBe(augFirst);
    expect(augFirst).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(augFirst, { key: 'PageUp' });
    // 7 月のグリッドには今日があるため今日のセルへ
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-07-15'));
  });
});

describe('セルと予定のモード分離', () => {
  it('予定のあるセルの Enter はセル内の最初の予定へフォーカスし、範囲選択（作成）は発火しない', () => {
    const onSelectRange = vi.fn();
    const { container } = render(
      <Harness
        gridNavigation={true}
        events={[{ id: 'e1', title: '会議', start: '2026-07-16T10:00', end: '2026-07-16T11:00' }]}
        callbacks={{ onSelectRange }}
      />,
    );
    const cell = cellByKey(container, 'month-day', '2026-07-16');
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: 'Enter' });

    const eventButton = container.querySelector('[data-koyomi="month-event"]');
    expect(document.activeElement).toBe(eventButton);
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it('予定のないセルの Enter は従来どおりその日 1 日分の範囲選択（作成）を発火する', () => {
    const onSelectRange = vi.fn();
    const { container } = render(<Harness gridNavigation={true} callbacks={{ onSelectRange }} />);
    const cell = cellByKey(container, 'month-day', '2026-07-16');
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: 'Enter' });

    expect(onSelectRange).toHaveBeenCalledTimes(1);
    expect(onSelectRange.mock.calls[0]?.[0].allDay).toBe(true);
  });

  it('予定にフォーカス中の矢印キーは従来どおり予定の移動として動作する', async () => {
    const onEventChange = vi.fn();
    const { container } = render(
      <Harness
        gridNavigation={true}
        events={[{ id: 'e1', title: '休暇', start: '2026-07-16', end: '2026-07-17', allDay: true }]}
        callbacks={{ onEventChange }}
      />,
    );
    const eventButton = container.querySelector('[data-koyomi="month-event"]');
    if (!(eventButton instanceof HTMLElement)) {
      throw new Error('予定の帯が見つかりません');
    }
    act(() => eventButton.focus());
    await act(async () => {
      fireEvent.keyDown(eventButton, { key: 'ArrowRight' });
    });

    expect(onEventChange).toHaveBeenCalledTimes(1);
    expect(onEventChange.mock.calls[0]?.[0].newRange.start).toEqual(
      new Date('2026-07-16T15:00:00Z'), // 東京の 2026-07-17 0:00
    );
  });

  it('予定にフォーカス中の Escape で開始日のセルへフォーカスが戻る', () => {
    const { container } = render(
      <Harness
        gridNavigation={true}
        events={[{ id: 'e1', title: '会議', start: '2026-07-16T10:00', end: '2026-07-16T11:00' }]}
      />,
    );
    const eventButton = container.querySelector('[data-koyomi="month-event"]');
    if (!(eventButton instanceof HTMLElement)) {
      throw new Error('予定の帯が見つかりません');
    }
    act(() => eventButton.focus());
    fireEvent.keyDown(eventButton, { key: 'Escape' });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-07-16'));
  });

  it('gridNavigation 無効時は予定の Escape で何も起きない（既定挙動の維持）', () => {
    const { container } = render(
      <Harness
        events={[{ id: 'e1', title: '会議', start: '2026-07-16T10:00', end: '2026-07-16T11:00' }]}
      />,
    );
    const eventButton = container.querySelector('[data-koyomi="month-event"]');
    if (!(eventButton instanceof HTMLElement)) {
      throw new Error('予定の帯が見つかりません');
    }
    act(() => eventButton.focus());
    fireEvent.keyDown(eventButton, { key: 'Escape' });
    expect(document.activeElement).toBe(eventButton);
  });
});

describe('週/日ビューの終日行', () => {
  it('有効時は今日の終日セルだけが Tab ストップになり、ArrowRight で隣の日へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} initialView="week" />);
    const cells = Array.from(container.querySelectorAll('[data-koyomi="allday-cell"]'));
    expect(cells).toHaveLength(7);
    for (const cell of cells) {
      const expected = cell.getAttribute('data-koyomi-date') === '2026-07-15' ? '0' : '-1';
      expect(cell).toHaveAttribute('tabindex', expected);
    }

    const today = cellByKey(container, 'allday-cell', '2026-07-15');
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellByKey(container, 'allday-cell', '2026-07-16'));
  });

  it('終日セルの Enter で終日の帯へ入り、Escape でセルへ戻る', () => {
    const { container } = render(
      <Harness
        gridNavigation={true}
        initialView="week"
        events={[{ id: 'e1', title: '休暇', start: '2026-07-15', end: '2026-07-17', allDay: true }]}
      />,
    );
    const cell = cellByKey(container, 'allday-cell', '2026-07-15');
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: 'Enter' });

    const band = container.querySelector('[data-koyomi="allday-event"]');
    expect(document.activeElement).toBe(band);

    if (!(band instanceof HTMLElement)) {
      throw new Error('終日の帯が見つかりません');
    }
    fireEvent.keyDown(band, { key: 'Escape' });
    expect(document.activeElement).toBe(cell);
  });
});

describe('年ビューの roving tabindex', () => {
  it('有効時は今日の日ボタンだけが Tab ストップになり、前後月の日ボタンは対象外（tabIndex=-1）になる', () => {
    const { container } = render(<Harness gridNavigation={true} initialView="year" />);
    const buttons = Array.from(container.querySelectorAll('[data-koyomi="year-day"]'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const isToday =
        button.getAttribute('data-koyomi-date') === '2026-07-15' &&
        !button.hasAttribute('data-outside');
      expect(button).toHaveAttribute('tabindex', isToday ? '0' : '-1');
    }
  });

  it('月末の ArrowRight は前後月の日をスキップして次のミニ月グリッドの月初へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} initialView="year" />);
    const jan31 = yearDayByKey(container, '2026-01-31');
    act(() => jan31.focus());
    fireEvent.keyDown(jan31, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(yearDayByKey(container, '2026-02-01'));
  });
});

describe('複数月ビューの roving tabindex', () => {
  it('有効時は今日のセルだけがビュー全体で単一の Tab ストップになる', () => {
    const { container } = render(<Harness gridNavigation={true} initialView="multiMonth" />);
    const cells = Array.from(
      container.querySelectorAll('[data-koyomi="month-day"][data-koyomi-date]'),
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const expected = cell.getAttribute('data-koyomi-date') === '2026-07-15' ? '0' : '-1';
      expect(cell).toHaveAttribute('tabindex', expected);
    }
  });

  it('月末の ArrowRight は非対象の前後月セルをスキップして次の月グリッドの月初へ移る', () => {
    const { container } = render(<Harness gridNavigation={true} initialView="multiMonth" />);
    const jul31 = cellByKey(container, 'month-day', '2026-07-31');
    act(() => jul31.focus());
    fireEvent.keyDown(jul31, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellByKey(container, 'month-day', '2026-08-01'));
  });
});
