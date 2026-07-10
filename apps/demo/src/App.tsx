/**
 * @packageDocumentation
 * `App` — Koyomi デモアプリのルートコンポーネント。
 *
 * ヘッダーで表示タイムゾーン・週開始曜日・ダークモードを切り替えられる。
 * カレンダー本体上の操作のうち、範囲選択・予定クリックは `EventDialog` に、
 * 繰り返し予定の編集スコープ選択は `ScopeDialog` に委譲する。ドラッグ移動/リサイズ
 * による変更は `handleEventChange` が直接適用し、変更ログへ記録する。
 */

import type {
  CalendarInteractionCallbacks,
  CalendarViewType,
  EventChange,
  EventDelete,
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
import { type ScopeAction, ScopeDialog, type ScopeRequest } from './ScopeDialog';
import { sampleEvents, sampleResources } from './sample-events';

/** ツールバー・ショートカットで有効にするビュー（全 8 ビュー）。 */
const ALL_VIEWS: readonly CalendarViewType[] = [
  'month',
  'week',
  'day',
  'list',
  'year',
  'multiMonth',
  'resource',
  'timeline',
];

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
    resources: sampleResources,
    timeZone: 'Asia/Tokyo',
    // タイムラインビューは 3 日分を表示する
    timelineDays: 3,
    // 現在時刻線・「今日」判定を 1 分ごとに追従させる
    refreshSeconds: 60,
  });
  const { api, state } = calendar;

  const [darkMode, setDarkMode] = useState(false);
  const [hideWeekends, setHideWeekends] = useState(false);
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

  /** ドラッグ移動・リサイズおよびキーボード操作（矢印キー）による変更をログに追記する（最新 {@link MAX_LOG_ENTRIES} 件）。 */
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

  /** キーボード削除（Delete/Backspace）の適用をログに追記する。 */
  const handleEventDelete = useCallback((deletion: EventDelete) => {
    const scopeLabel =
      deletion.scope === null
        ? ''
        : `（${deletion.scope === 'this' ? 'この予定のみ' : deletion.scope === 'thisAndFollowing' ? 'これ以降' : 'すべて'}）`;
    setLogEntries((prev) =>
      [
        { id: crypto.randomUUID(), text: `削除: ${deletion.occurrence.event.title}${scopeLabel}` },
        ...prev,
      ].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  /** インタラクション中の想定外エラーをログに出す。 */
  const handleError = useCallback((error: unknown) => {
    setLogEntries((prev) =>
      [{ id: crypto.randomUUID(), text: `エラー: ${String(error)}` }, ...prev].slice(
        0,
        MAX_LOG_ENTRIES,
      ),
    );
  }, []);

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
      onEventDelete: handleEventDelete,
      onError: handleError,
    }),
    [resolveRecurringScope, handleEventChange, handleEventDelete, handleError],
  );

  useCalendarShortcuts({
    calendar,
    views: ALL_VIEWS,
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
          <label className="demo-control" htmlFor="demo-hide-weekends">
            <input
              id="demo-hide-weekends"
              type="checkbox"
              name="hideWeekends"
              checked={hideWeekends}
              onChange={(event) => {
                const next = event.target.checked;
                setHideWeekends(next);
                // 週末（日曜=0・土曜=6）を月・週ビューの列から除外する
                api.updateOptions({ hiddenWeekdays: next ? [0, 6] : [] });
              }}
            />
            <span>週末を隠す</span>
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
          <Toolbar views={ALL_VIEWS} />
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
        <p className="demo-log-hint">
          キーボード操作: 予定にフォーカスして矢印キーで移動（Shift+矢印でリサイズ、 Delete
          で削除）、日セルで Enter で作成。ショートカット: t=今日 /
          m・w・d・a・y・q・r・l=ビュー切替 / j・k=前後の期間 / c=作成
        </p>
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
