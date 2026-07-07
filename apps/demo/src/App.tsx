/**
 * @packageDocumentation
 * `App` — Koyomi デモアプリのルートコンポーネント。
 *
 * ヘッダーで表示タイムゾーン・週開始曜日・ダークモードを切り替えられる。
 * カレンダー本体上の操作（範囲選択・予定クリック・ドラッグ移動/リサイズ・
 * 繰り返し予定の編集スコープ選択）はすべて `EventDialog` / `ScopeDialog` に委譲する。
 */

import type {
  CalendarInteractionCallbacks,
  EventChange,
  EventOccurrence,
  RangeSelection,
  RecurringEditScope,
  TimeZoneId,
  Weekday,
} from '@koyomi-cal/react';
import {
  CalendarProvider,
  CalendarView,
  Toolbar,
  useCalendar,
  useCalendarShortcuts,
} from '@koyomi-cal/react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventDialog, type EventDialogMode } from './EventDialog';
import { type ScopeAction, ScopeDialog } from './ScopeDialog';
import { sampleEvents } from './sample-events';

/** ヘッダーの表示タイムゾーン切替の選択肢。 */
const TIME_ZONE_OPTIONS: readonly { value: TimeZoneId; label: string }[] = [
  { value: 'Asia/Tokyo', label: '東京 (Asia/Tokyo)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'ニューヨーク (America/New_York)' },
  { value: 'Europe/London', label: 'ロンドン (Europe/London)' },
  { value: 'Australia/Sydney', label: 'シドニー (Australia/Sydney)' },
];

/** ヘッダーの週開始曜日切替の選択肢。 */
const WEEK_START_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: 0, label: '日曜始まり' },
  { value: 1, label: '月曜始まり' },
];

/** 変更ログの最大保持件数。 */
const MAX_LOG_ENTRIES = 5;

/** 変更ログの 1 エントリ。 */
interface LogEntry {
  /** React の `key` 用の一意な ID。 */
  id: string;
  /** 表示テキスト。 */
  text: string;
}

/** 繰り返し予定のスコープ選択待ちの要求。 */
interface ScopeRequest {
  occurrence: EventOccurrence;
  action: ScopeAction;
}

/**
 * `<select>` の週開始曜日の値（`'0'` / `'1'`）を検証しつつ {@link Weekday} に変換する。
 *
 * @throws `WEEK_START_OPTIONS` にない値の場合は `Error`
 */
function parseWeekday(value: string): Weekday {
  const parsed = Number(value);
  if (WEEK_START_OPTIONS.some((option) => option.value === parsed)) {
    // 上の判定で WEEK_START_OPTIONS の値（Weekday）のいずれかと一致することを確認済み
    return parsed as Weekday;
  }
  throw new Error(`不正な週開始曜日の値です: '${value}'`);
}

/**
 * Koyomi デモアプリのルートコンポーネント。
 */
export function App(): ReactElement {
  const calendar = useCalendar({
    initialView: 'month',
    locale: 'ja',
    events: sampleEvents,
    timeZone: 'Asia/Tokyo',
  });
  const { api, state } = calendar;

  const [darkMode, setDarkMode] = useState(false);
  const [dialogMode, setDialogMode] = useState<EventDialogMode | null>(null);
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest | null>(null);
  const [logEntries, setLogEntries] = useState<readonly LogEntry[]>([]);
  const scopeResolverRef = useRef<((scope: RecurringEditScope | null) => void) | null>(null);

  // ダークモード切替を data-koyomi-theme 属性としてルートに反映する
  // （@koyomi-cal/react/theme.css がこの属性を見て配色を切り替える）
  useEffect(() => {
    document.documentElement.setAttribute('data-koyomi-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  /**
   * 繰り返し予定の適用範囲をダイアログで選択させる。
   * `CalendarProvider` の `callbacks` と `EventDialog` の両方から共用する。
   */
  const resolveRecurringScope = useCallback(
    (occurrence: EventOccurrence, action: ScopeAction): Promise<RecurringEditScope | null> => {
      return new Promise((resolve) => {
        scopeResolverRef.current = resolve;
        setScopeRequest({ occurrence, action });
      });
    },
    [],
  );

  /** `ScopeDialog` からの選択結果を、待機中の Promise に伝える。 */
  function handleScopeResolve(scope: RecurringEditScope | null): void {
    const resolve = scopeResolverRef.current;
    scopeResolverRef.current = null;
    setScopeRequest(null);
    resolve?.(scope);
  }

  /** ドラッグ移動・リサイズによる変更をログに追記する（最新 {@link MAX_LOG_ENTRIES} 件）。 */
  const handleEventChange = useCallback(
    (change: EventChange) => {
      const formatter = new Intl.DateTimeFormat('ja', {
        timeZone: api.getState().timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const text = `変更: ${change.occurrence.event.title} (${formatter.format(change.newRange.start)}〜${formatter.format(change.newRange.end)})`;
      setLogEntries((prev) =>
        [{ id: crypto.randomUUID(), text }, ...prev].slice(0, MAX_LOG_ENTRIES),
      );
    },
    [api],
  );

  const callbacks: CalendarInteractionCallbacks = useMemo(
    () => ({
      onSelectRange: (selection: RangeSelection) => {
        setDialogMode({ type: 'create', selection });
      },
      onEventClick: (occurrence: EventOccurrence) => {
        setDialogMode({ type: 'edit', occurrence });
      },
      resolveRecurringScope,
      onEventChange: handleEventChange,
    }),
    [resolveRecurringScope, handleEventChange],
  );

  useCalendarShortcuts({
    calendar,
    onCreate: () => {
      const start = state.options.now();
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      setDialogMode({ type: 'create', selection: { range: { start, end }, allDay: false } });
    },
  });

  return (
    <div className="demo-app">
      <header className="demo-header">
        <h1 className="demo-title">Koyomi デモ</h1>
        <div className="demo-controls">
          <label className="demo-control" htmlFor="demo-timezone-select">
            <span>タイムゾーン</span>
            <select
              id="demo-timezone-select"
              name="timeZone"
              value={state.timeZone}
              onChange={(event) => api.setTimeZone(event.target.value)}
            >
              {TIME_ZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="demo-control" htmlFor="demo-week-start-select">
            <span>週の開始</span>
            <select
              id="demo-week-start-select"
              name="weekStartsOn"
              value={state.options.weekStartsOn}
              onChange={(event) =>
                api.updateOptions({ weekStartsOn: parseWeekday(event.target.value) })
              }
            >
              {WEEK_START_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="demo-theme-toggle"
            onClick={() => setDarkMode((prev) => !prev)}
          >
            {darkMode ? '☀️ ライトモード' : '🌙 ダークモード'}
          </button>
        </div>
      </header>

      <main className="demo-main">
        <CalendarProvider value={calendar} callbacks={callbacks}>
          <Toolbar />
          <CalendarView />
        </CalendarProvider>
      </main>

      <section className="demo-log" aria-live="polite">
        <h2 className="demo-log-title">変更ログ</h2>
        {logEntries.length === 0 ? (
          <p className="demo-log-empty">
            まだ変更はありません。予定をドラッグして移動・リサイズしてみてください。
          </p>
        ) : (
          <ul className="demo-log-list">
            {logEntries.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ul>
        )}
      </section>

      <EventDialog
        mode={dialogMode}
        timeZone={state.timeZone}
        api={api}
        resolveRecurringScope={resolveRecurringScope}
        onClose={() => setDialogMode(null)}
      />
      <ScopeDialog request={scopeRequest} onResolve={handleScopeResolve} />
    </div>
  );
}
