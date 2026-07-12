/**
 * docs/interactions.md の記述のみから導出した仕様由来テストである。
 * 実装ファイル（*.test.* 以外）は「仕様抽出」段階では一切参照していない。
 * 既存の *.test.ts(x) は「その仕様がすでにテストされているか」の照合のためだけに
 * 読み、期待値の根拠にはしていない（期待値はすべて docs/interactions.md の記述から導出）。
 *
 * このファイルは既存テストとの照合で見つかった「未カバーの仕様・境界」を補うものであり、
 * 既存のカバレッジ（例: 移動/リサイズの基本動作、Escape/pointercancel、
 * onBefore* フックの大半、useCalendarShortcuts のビュー切替）は重複して書かない。
 *
 * 対象（出典は各 it 内のコメントに引用）:
 * - リソース/タイムラインビューのキーボード操作表（Enter/Space・Delete・矢印キーの
 *   未検証方向・resolveRecurringScope フローがリソース/タイムライン移動にも乗ること）
 * - useCalendarShortcuts の「input/textarea/select」「Ctrl/Cmd/Alt」の未検証パターン
 * - useExternalDrag の onError ハンドリング
 * - リストビューが Enter/Space のクリックのみに対応し、他のキーでは何も起きないこと
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendar } from '../core/calendar';
import { parseDateValue } from '../core/timezone';
import type { CalendarEvent, CalendarResource, RecurringEditScope } from '../core/types';
import { ListView } from './components/list-view';
import { MonthView } from './components/month-view';
import { ResourceView } from './components/resource-view';
import { TimelineView } from './components/timeline-view';
import { CalendarProvider } from './context';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';
import { useCalendar } from './use-calendar';
import { useCalendarShortcuts } from './use-calendar-shortcuts';
import type { ExternalDropInfo } from './use-external-drag';
import { useExternalDrag } from './use-external-drag';

// jsdom はこの環境で document.elementsFromPoint を実装していないことがある。
// 既存テスト（use-external-drag.test.tsx）と同じ理由で既定実装を用意する。
if (typeof document.elementsFromPoint !== 'function') {
  document.elementsFromPoint = () => [];
}

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** リソース/タイムラインビューの表示日（NOW の属する日、水曜）。 */
const DAY = '2026-07-15';

/** 東京タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string): Date {
  return parseDateValue(isoLocal, TOKYO, false);
}

/** events / resources 未指定時に毎レンダー同じ参照を渡し、開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// リソースビュー: 予定要素にフォーカスした状態のキーボード操作表
// 出典: docs/interactions.md
//   「リソースビュー・タイムラインビューのドラッグ操作」節の
//   「予定要素にフォーカスした状態（リソース/タイムラインビュー）」表
// ============================================================

const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A' };
const ROOM_B: CalendarResource = { id: 'room-b', title: '会議室B' };
const ROOM_C: CalendarResource = { id: 'room-c', title: '会議室C' };

interface ResourceHarnessProps {
  events: readonly CalendarEvent[];
  resources: readonly CalendarResource[];
  callbacks?: CalendarInteractionCallbacks;
  sink?: { current: UseCalendarResult | null };
}

/** `ResourceView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function ResourceHarness(props: ResourceHarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'resource',
    events: props.events,
    resources: props.resources,
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <ResourceView />
    </CalendarProvider>
  );
}

function renderResourceHarness(options: {
  events: readonly CalendarEvent[];
  resources: readonly CalendarResource[];
  callbacks?: CalendarInteractionCallbacks;
}): { container: HTMLElement; sink: { current: UseCalendarResult | null } } {
  const sink: { current: UseCalendarResult | null } = { current: null };
  const { container } = render(<ResourceHarness {...options} sink={sink} />);
  return { container, sink };
}

/** オカレンスキー（`${eventId}@${開始時刻の ISO 文字列}`）からリソース列内の要素を取得する。 */
function getResourceEventElement(
  container: HTMLElement,
  eventId: string,
  startIso: string,
): HTMLElement {
  const key = `${eventId}@${at(startIso).toISOString()}`;
  const element = container.querySelector(`[data-koyomi-occurrence="${key}"]`);
  if (element === null) {
    throw new Error(`イベント要素が見つかりません: ${key}`);
  }
  return element as HTMLElement;
}

describe('リソースビュー - 予定要素フォーカス時のキーボード操作', () => {
  it('Enter キーで onEventClick 相当のクリックが発火する（出典: 「予定要素にフォーカスした状態（リソース/タイムラインビュー）」表 Enter/Space 行「onEventClick 相当のクリック」）', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-enter',
      title: '会議',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'room-a',
    };
    const { container } = renderResourceHarness({
      events: [event],
      resources: [ROOM_A],
      callbacks: { onEventClick },
    });
    const eventEl = getResourceEventElement(container, 'ev-enter', `${DAY}T09:00`);

    fireEvent.keyDown(eventEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ eventId: 'ev-enter' }),
    );
  });

  it('Delete キーで単発の予定が削除される（出典: 同表 Delete/Backspace 行「オカレンスを削除（繰り返しはスコープ解決）」）', () => {
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'ev-delete',
      title: '会議',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderResourceHarness({
      events: [event],
      resources: [ROOM_A],
      callbacks: { onEventDelete },
    });
    const eventEl = getResourceEventElement(container, 'ev-delete', `${DAY}T09:00`);

    fireEvent.keyDown(eventEl, { key: 'Delete' });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
    expect(onEventDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence: expect.objectContaining({ eventId: 'ev-delete' }),
        scope: null,
      }),
    );
  });

  it('ArrowUp で snapMinutes 分だけ前に移動する（出典: 同表「↑/↓ | ∓/± snapMinutes 分の移動（時間の軸）」。↓方向は他テストで確認済みのため↑方向を補う）', async () => {
    const event: CalendarEvent = {
      id: 'ev-up',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderResourceHarness({ events: [event], resources: [ROOM_A] });
    const eventEl = getResourceEventElement(container, 'ev-up', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowUp' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T09:45`), end: at(`${DAY}T10:45`) });
  });

  it('Shift+ArrowUp で終了時刻が snapMinutes 分だけ短縮される（出典: 同表「Shift+↑/Shift+↓ | 終了時刻を∓/± snapMinutes分リサイズ」。延長方向は他テストで確認済みのため短縮方向を補う）', async () => {
    const event: CalendarEvent = {
      id: 'ev-shift-up',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-a',
    };
    const { container, sink } = renderResourceHarness({ events: [event], resources: [ROOM_A] });
    const eventEl = getResourceEventElement(container, 'ev-shift-up', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowUp', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T10:00`), end: at(`${DAY}T10:45`) });
  });

  it('先頭以外の列で ArrowLeft を押すと隣（前）のリソース列へ移動する（出典: 同表「←/→ | 隣のリソース列への移動」。先頭列での無変化は他テストで確認済みのため成功する移動を補う）', async () => {
    const event: CalendarEvent = {
      id: 'ev-left',
      title: '会議',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'room-b',
    };
    const { container, sink } = renderResourceHarness({
      events: [event],
      resources: [ROOM_A, ROOM_B, ROOM_C],
    });
    const eventEl = getResourceEventElement(container, 'ev-left', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowLeft' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      resourceId: 'room-a',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
    });
  });

  it('繰り返し予定を矢印キーで移動しようとすると resolveRecurringScope が action: "move" で呼ばれる（出典: 「繰り返し予定は既存の resolveRecurringScope フローにそのまま乗ります（リソース移動も this / thisAndFollowing / all の選択対象）」）', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const event: CalendarEvent = {
      id: 'recurring-resource-move',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'room-a',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container, sink } = renderResourceHarness({
      events: [event],
      resources: [ROOM_A, ROOM_B],
      callbacks: { resolveRecurringScope },
    });
    const eventEl = getResourceEventElement(container, 'recurring-resource-move', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'ArrowDown' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-resource-move' }),
      'move',
    );
    const override = (sink.current?.api.getEvents() ?? []).find(
      (candidate) => candidate.recurringEventId === 'recurring-resource-move',
    );
    expect(override).toMatchObject({ start: at(`${DAY}T10:15`), end: at(`${DAY}T11:15`) });
  });

  it('繰り返し予定を Delete キーで削除しようとすると resolveRecurringScope が action: "delete" で呼ばれる（出典: 「繰り返し予定を移動・リサイズ・削除・更新しようとすると、resolveRecurringScope(occurrence, action) が呼ばれ」。action の全種類のうち delete がリソースビューで未検証だったため補う）', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-resource-delete',
      title: '定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'room-a',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container } = renderResourceHarness({
      events: [event],
      resources: [ROOM_A],
      callbacks: { resolveRecurringScope, onEventDelete },
    });
    const eventEl = getResourceEventElement(container, 'recurring-resource-delete', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(eventEl, { key: 'Delete' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-resource-delete' }),
      'delete',
    );
    expect(onEventDelete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'this' }));
  });
});

// ============================================================
// タイムラインビュー: 予定要素にフォーカスした状態のキーボード操作表
// 出典: docs/interactions.md 同上表（タイムラインビュー列）
// ============================================================

const CRANE_1: CalendarResource = { id: 'crane-1', title: 'クレーン1号機' };
const CRANE_2: CalendarResource = { id: 'crane-2', title: 'クレーン2号機' };

interface TimelineHarnessProps {
  events: readonly CalendarEvent[];
  resources: readonly CalendarResource[];
  callbacks?: CalendarInteractionCallbacks;
  sink?: { current: UseCalendarResult | null };
}

/** `TimelineView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function TimelineHarness(props: TimelineHarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'timeline',
    events: props.events,
    resources: props.resources,
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks ?? {}}>
      <TimelineView />
    </CalendarProvider>
  );
}

function renderTimelineHarness(options: {
  events: readonly CalendarEvent[];
  resources: readonly CalendarResource[];
  callbacks?: CalendarInteractionCallbacks;
}): { container: HTMLElement; sink: { current: UseCalendarResult | null } } {
  const sink: { current: UseCalendarResult | null } = { current: null };
  const { container } = render(<TimelineHarness {...options} sink={sink} />);
  return { container, sink };
}

/** オカレンスキー（`${eventId}@${開始時刻の ISO 文字列}`）からタイムライン行内の帯要素を取得する。 */
function getTimelineItemElement(
  container: HTMLElement,
  eventId: string,
  startIso: string,
): HTMLElement {
  const key = `${eventId}@${at(startIso).toISOString()}`;
  const element = container.querySelector(`[data-koyomi-occurrence="${key}"]`);
  if (element === null) {
    throw new Error(`帯要素が見つかりません: ${key}`);
  }
  return element as HTMLElement;
}

describe('タイムラインビュー - 予定要素フォーカス時のキーボード操作', () => {
  it('Enter キーで onEventClick 相当のクリックが発火する（出典: 同表 Enter/Space 行「同左」）', () => {
    const onEventClick = vi.fn();
    const event: CalendarEvent = {
      id: 'tl-enter',
      title: '作業',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'crane-1',
    };
    const { container } = renderTimelineHarness({
      events: [event],
      resources: [CRANE_1],
      callbacks: { onEventClick },
    });
    const itemEl = getTimelineItemElement(container, 'tl-enter', `${DAY}T09:00`);

    fireEvent.keyDown(itemEl, { key: 'Enter' });

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ eventId: 'tl-enter' }),
    );
  });

  it('Delete キーで単発の予定が削除される（出典: 同表 Delete/Backspace 行「同左」）', () => {
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'tl-delete',
      title: '作業',
      start: `${DAY}T09:00`,
      end: `${DAY}T09:30`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderTimelineHarness({
      events: [event],
      resources: [CRANE_1],
      callbacks: { onEventDelete },
    });
    const itemEl = getTimelineItemElement(container, 'tl-delete', `${DAY}T09:00`);

    fireEvent.keyDown(itemEl, { key: 'Delete' });

    expect(sink.current?.api.getEvents()).toHaveLength(0);
    expect(onEventDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence: expect.objectContaining({ eventId: 'tl-delete' }),
        scope: null,
      }),
    );
  });

  it('ArrowLeft で snapMinutes 分だけ過去方向に移動する（出典: 同表「←/→ | ∓/± snapMinutes 分の移動（時間の軸）」。→方向は他テストで確認済みのため←方向を補う）', async () => {
    const event: CalendarEvent = {
      id: 'tl-left',
      title: '作業',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderTimelineHarness({ events: [event], resources: [CRANE_1] });
    const itemEl = getTimelineItemElement(container, 'tl-left', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowLeft' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T09:45`), end: at(`${DAY}T10:45`) });
  });

  it('Shift+ArrowLeft で終了時刻が snapMinutes 分だけ短縮される（出典: 同表「Shift+←/Shift+→ | 終了時刻を∓/± snapMinutes分リサイズ」。延長方向は他テストで確認済みのため短縮方向を補う）', async () => {
    const event: CalendarEvent = {
      id: 'tl-shift-left',
      title: '作業',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'crane-1',
    };
    const { container, sink } = renderTimelineHarness({ events: [event], resources: [CRANE_1] });
    const itemEl = getTimelineItemElement(container, 'tl-shift-left', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowLeft', shiftKey: true });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({ start: at(`${DAY}T10:00`), end: at(`${DAY}T10:45`) });
  });

  it('2 行目の帯で ArrowUp を押すと隣（前）の行（リソース）へ移動する（出典: 同表「↑/↓ | 隣の行（リソース）への移動」。↓方向は他テストで確認済みのため↑方向を補う）', async () => {
    const event: CalendarEvent = {
      id: 'tl-up',
      title: '作業',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      resourceId: 'crane-2',
    };
    const { container, sink } = renderTimelineHarness({
      events: [event],
      resources: [CRANE_1, CRANE_2],
    });
    const itemEl = getTimelineItemElement(container, 'tl-up', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowUp' });
    });

    const events = sink.current?.api.getEvents() ?? [];
    expect(events[0]).toMatchObject({
      resourceId: 'crane-1',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
    });
  });

  it('繰り返し予定を矢印キーで移動しようとすると resolveRecurringScope が action: "move" で呼ばれる（出典: 「繰り返し予定は既存の resolveRecurringScope フローにそのまま乗ります」）', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const event: CalendarEvent = {
      id: 'recurring-timeline-move',
      title: '定例作業',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'crane-1',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container, sink } = renderTimelineHarness({
      events: [event],
      resources: [CRANE_1, CRANE_2],
      callbacks: { resolveRecurringScope },
    });
    const itemEl = getTimelineItemElement(container, 'recurring-timeline-move', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'ArrowRight' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-timeline-move' }),
      'move',
    );
    const override = (sink.current?.api.getEvents() ?? []).find(
      (candidate) => candidate.recurringEventId === 'recurring-timeline-move',
    );
    expect(override).toMatchObject({ start: at(`${DAY}T10:15`), end: at(`${DAY}T11:15`) });
  });

  it('繰り返し予定を Delete キーで削除しようとすると resolveRecurringScope が action: "delete" で呼ばれる（出典: 「resolveRecurringScope(occurrence, action) が呼ばれ」。action の全種類のうち delete がタイムラインビューで未検証だったため補う）', async () => {
    const resolveRecurringScope = vi.fn().mockResolvedValue('this' as RecurringEditScope);
    const onEventDelete = vi.fn();
    const event: CalendarEvent = {
      id: 'recurring-timeline-delete',
      title: '定例作業',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      resourceId: 'crane-1',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    };
    const { container } = renderTimelineHarness({
      events: [event],
      resources: [CRANE_1],
      callbacks: { resolveRecurringScope, onEventDelete },
    });
    const itemEl = getTimelineItemElement(container, 'recurring-timeline-delete', `${DAY}T10:00`);

    await act(async () => {
      fireEvent.keyDown(itemEl, { key: 'Delete' });
    });

    expect(resolveRecurringScope).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'recurring-timeline-delete' }),
      'delete',
    );
    expect(onEventDelete).toHaveBeenCalledWith(expect.objectContaining({ scope: 'this' }));
  });
});

// ============================================================
// useCalendarShortcuts: input/textarea/select と Ctrl/Cmd/Alt 修飾キー
// 出典: docs/interactions.md「キーボードショートカット」節
//   「大文字・小文字は区別しません。Ctrl / Cmd / Alt などの修飾キーを伴う場合は
//    無視されます。input / textarea / select にフォーカスがある間、および
//    contenteditable 要素の内側では、すべてのショートカットが無効になります。」
// ============================================================

/** 固定時刻・東京 TZ の `UseCalendarResult` 相当のオブジェクトを作るヘルパ。 */
function makeCalendar(): UseCalendarResult {
  const api = createCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'month',
  });
  return { api, state: api.getState(), viewModel: api.getViewModel() };
}

/** `document.body` に対して keydown イベントを発火するヘルパ。 */
function pressKey(key: string, init?: KeyboardEventInit): void {
  fireEvent.keyDown(document.body, { key, ...init });
}

describe('useCalendarShortcuts - フォーカス要素種別・修飾キーの網羅', () => {
  it('textarea にフォーカス中は無視される（出典: 「input / textarea / select にフォーカスがある間...すべてのショートカットが無効になる」。input は既存テストで確認済みのため textarea を補う）', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('select にフォーカス中は無視される（出典: 同上。select を補う）', () => {
    const calendar = makeCalendar();
    const setViewSpy = vi.spyOn(calendar.api, 'setView');
    renderHook(() => useCalendarShortcuts({ calendar }));

    const select = document.createElement('select');
    document.body.appendChild(select);
    select.focus();
    fireEvent.keyDown(select, { key: 'm' });

    expect(setViewSpy).not.toHaveBeenCalled();

    document.body.removeChild(select);
  });

  it('Alt 修飾キー付きは無視される（出典: 「Ctrl / Cmd / Alt などの修飾キーを伴う場合は無視されます」。Ctrl は既存テストで確認済みのため Alt を補う）', () => {
    const calendar = makeCalendar();
    calendar.api.setView('week');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('m', { altKey: true });

    expect(calendar.api.getState().view).toBe('week');
  });

  it('Cmd（Meta）修飾キー付きは無視される（出典: 同上。Cmd を補う）', () => {
    const calendar = makeCalendar();
    calendar.api.setView('week');
    renderHook(() => useCalendarShortcuts({ calendar }));

    pressKey('m', { metaKey: true });

    expect(calendar.api.getState().view).toBe('week');
  });
});

// ============================================================
// useExternalDrag: onError ハンドリング
// 出典: docs/interactions.md「外部ドラッグ受け入れ」節
//   「`onError` を渡すと、`onExternalDrop` が投げた例外をハンドリングできます
//    （省略時は `console.error` に出力）」
// ============================================================

interface ExternalPayload {
  title: string;
}

interface ExternalHarnessProps {
  events?: readonly CalendarEvent[];
  onExternalDrop: (info: ExternalDropInfo<ExternalPayload>) => void;
  onError?: (error: unknown) => void;
}

/** 外部ドラッグ元要素 + MonthView を `CalendarProvider` 配下に描画するハーネス。 */
function ExternalDragHarness(props: ExternalHarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'month',
    events: props.events ?? EMPTY_EVENTS,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useExternalDrag<ExternalPayload>({
    calendar,
    containerRef,
    onExternalDrop: props.onExternalDrop,
    ...(props.onError !== undefined ? { onError: props.onError } : {}),
  });

  return (
    <div>
      <div data-testid="external-source" {...drag.getDraggableProps({ title: 'ペイロード' })} />
      <div ref={containerRef}>
        <CalendarProvider value={calendar} callbacks={{}}>
          <MonthView />
        </CalendarProvider>
      </div>
    </div>
  );
}

describe('useExternalDrag - onError', () => {
  it('onExternalDrop が例外を投げると onError にその例外が渡される（出典: 「onError を渡すと、onExternalDrop が投げた例外をハンドリングできます」）', () => {
    const boom = new Error('boom');
    const onExternalDrop = vi.fn(() => {
      throw boom;
    });
    const onError = vi.fn();
    const { container } = render(
      <ExternalDragHarness onExternalDrop={onExternalDrop} onError={onError} />,
    );
    const source = container.querySelector('[data-testid="external-source"]');
    const cell = container.querySelector(
      '[data-koyomi="month-day"][data-koyomi-date="2026-07-20"]',
    );
    if (!(source instanceof HTMLElement) || !(cell instanceof HTMLElement)) {
      throw new Error('要素が見つかりません');
    }
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([cell]);

    act(() => {
      source.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 0, clientY: 0, button: 0, bubbles: true }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true }),
      );
    });

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

// ============================================================
// リストビュー: Enter/Space によるクリックのみに対応する
// 出典: docs/interactions.md「キーボードのみでの予定操作」節
//   「リストビューの予定行は Enter・Space によるクリックのみに対応します。」
// ============================================================

/** `ListView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function ListDocsHarness(props: {
  events: readonly CalendarEvent[];
  callbacks: CalendarInteractionCallbacks;
  sink: { current: UseCalendarResult | null };
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'list',
    events: props.events,
  });
  props.sink.current = calendar;
  return (
    <CalendarProvider value={calendar} callbacks={props.callbacks}>
      <ListView />
    </CalendarProvider>
  );
}

describe('リストビュー - キーボードは Enter/Space のみに対応する', () => {
  it('Delete キーでは何も起きない（onEventClick が呼ばれず、予定も変更されない）（出典: 「リストビューの予定行は Enter・Space によるクリックのみに対応します。」）', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <ListDocsHarness events={events} callbacks={{ onEventClick }} sink={sink} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('list-event ボタンが見つかりません');
    }

    fireEvent.keyDown(button, { key: 'Delete' });

    expect(onEventClick).not.toHaveBeenCalled();
    expect(sink.current?.api.getEvents()).toHaveLength(1);
  });

  it('ArrowRight キーでは何も起きない（onEventClick が呼ばれない）（出典: 同上）', () => {
    const onEventClick = vi.fn();
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-16T10:00:00', end: '2026-07-16T11:00:00' },
    ];
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <ListDocsHarness events={events} callbacks={{ onEventClick }} sink={sink} />,
    );
    const button = container.querySelector('[data-koyomi="list-event"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('list-event ボタンが見つかりません');
    }

    fireEvent.keyDown(button, { key: 'ArrowRight' });

    expect(onEventClick).not.toHaveBeenCalled();
  });
});
