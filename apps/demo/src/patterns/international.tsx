/**
 * @packageDocumentation
 * `InternationalPattern` — 「国際化」パターン。
 *
 * 東京拠点のチームが NY・ロンドン拠点と協業する想定のデモ。週ビューを中心に、
 * 次の 4 点を確認できる。
 *
 * 1. **複数タイムゾーン軸**（`timeAxisZones`） — 「なし / NY / NY+ロンドン」を
 *    切り替え、週/日ビューの時間軸に追加のタイムゾーン列を出し分ける
 * 2. **言語切替**（`locale`） — 日本語 / English をワンスイッチで切替え、
 *    `locale` の更新（`api.updateOptions`）と `enUsLabels`（`Toolbar` の
 *    `labels` および `CalendarView` の各 `*Label` props）の適用を同時に行う
 * 3. **週番号**（`showWeekNumbers`） — 常時有効化し、月・週ビューの左端に
 *    パターン専用 CSS（`./international.css`）で `data-koyomi-week-number`
 *    属性をバッジとして可視化する
 * 4. **RTL 切替** — このパターンのルート要素に `dir="rtl"` を付け外しし、
 *    論理プロパティ（`insetInlineStart` 等）によるレイアウト反転を確認する
 *
 * ビュー切替は `Toolbar` + `CalendarView`（月・週・日・リストの 4 ビュー）。
 * インタラクションのコールバックはあえて指定しない。範囲選択・繰り返し予定の
 * 編集スコープはいずれも既定動作（即時作成 / スコープ `'this'`）に委ねる
 * （`docs/interactions.md` 参照）。
 */

import type {
  CalendarEvent,
  CalendarViewProps,
  CalendarViewType,
  TimeZoneId,
  ToolbarLabels,
} from '@koyomi-cal/react';
import {
  addDaysInZone,
  CalendarProvider,
  CalendarView,
  dateKeyInZone,
  enUsLabels,
  Toolbar,
  useCalendar,
} from '@koyomi-cal/react';
import { type ReactElement, useState } from 'react';
import { sampleEvents } from '../sample-data';
import './international.css';

/** ツールバー・ビュー切替で有効にするビュー（月・週・日・リスト）。 */
const VIEWS: readonly CalendarViewType[] = ['month', 'week', 'day', 'list'];

/** このパターンの拠点タイムゾーン（東京）。表示タイムゾーンは固定し、追加軸だけを切り替える。 */
const HOME_TIME_ZONE: TimeZoneId = 'Asia/Tokyo';

/** 表示言語の識別子。 */
type LanguageId = 'ja' | 'en';

/**
 * 言語切替の選択肢。`locale`（BCP 47 タグ）とワンスイッチ用ボタンの表示文字列を
 * 対応付ける。ボタンの文字列はこのパターンの言語切替に限り、切替先の言語で
 * 表示する（日本語固定ではない）。
 */
const LANGUAGE_OPTIONS: Readonly<Record<LanguageId, { locale: string; switchLabel: string }>> = {
  ja: { locale: 'ja', switchLabel: '🌐 Switch to English' },
  en: { locale: 'en-US', switchLabel: '🌐 日本語に切替' },
};

/** 複数タイムゾーン軸（`timeAxisZones`）切替の選択肢識別子。 */
type TimeAxisModeId = 'none' | 'ny' | 'ny-london';

/** 複数タイムゾーン軸切替の選択肢（`timeAxisZones` に渡す配列と対応付ける）。 */
const TIME_AXIS_OPTIONS: readonly {
  value: TimeAxisModeId;
  label: string;
  zones: readonly TimeZoneId[];
}[] = [
  { value: 'none', label: 'なし（主軸のみ）', zones: [] },
  { value: 'ny', label: 'NY', zones: ['America/New_York'] },
  { value: 'ny-london', label: 'NY + ロンドン', zones: ['America/New_York', 'Europe/London'] },
];

/** 初期表示のタイムゾーン軸モード（NY + ロンドンの 2 軸から始め、複数軸表示を最初から見せる）。 */
const INITIAL_TIME_AXIS_MODE: TimeAxisModeId = 'ny-london';

/** {@link INITIAL_TIME_AXIS_MODE} に対応する `timeAxisZones` の初期値。 */
const INITIAL_TIME_AXIS_ZONES: readonly TimeZoneId[] = ['America/New_York', 'Europe/London'];

/**
 * 今日から `offsetDays` 日後の日付キー（`'YYYY-MM-DD'`、`HOME_TIME_ZONE` 基準）を返す。
 */
function dayKey(offsetDays: number): string {
  return dateKeyInZone(addDaysInZone(new Date(), offsetDays, HOME_TIME_ZONE), HOME_TIME_ZONE);
}

/**
 * 「国際化」パターン専用の追加サンプル予定。
 *
 * `../sample-data` の共通セット（`sampleEvents`）に、NY・ロンドン拠点の予定を
 * 追加し、`timeAxisZones` 切替の効果を確認しやすくする。
 */
const internationalOnlyEvents: CalendarEvent[] = [
  {
    id: 'intl-ny-standup',
    title: 'NY オフィス朝会',
    start: `${dayKey(0)}T09:00:00`,
    end: `${dayKey(0)}T09:20:00`,
    timeZone: 'America/New_York',
    color: '#315da8',
    description: 'ニューヨークオフィスの朝会（NY 時間 9:00 開始）。',
  },
  {
    id: 'intl-london-design-review',
    title: 'ロンドン デザインレビュー',
    start: `${dayKey(1)}T15:00:00`,
    end: `${dayKey(1)}T16:00:00`,
    timeZone: 'Europe/London',
    color: '#137333',
    location: 'ロンドンオフィス',
    description: 'ロンドンオフィスとのデザインレビュー（ロンドン時間 15:00 開始）。',
  },
  {
    id: 'intl-three-region-sync',
    title: '三極定例（東京・NY・ロンドン）',
    start: `${dayKey(2)}T22:00:00`,
    end: `${dayKey(2)}T22:30:00`,
    color: '#c53929',
    description: '東京・ニューヨーク・ロンドンの三拠点が参加しやすい時間帯に設定した定例。',
  },
];

/** 「国際化」パターンで使うイベント一覧（共通サンプル + 拠点別の追加分）。 */
const internationalEvents: CalendarEvent[] = [...sampleEvents, ...internationalOnlyEvents];

/**
 * 文字列を検証しつつ {@link TimeAxisModeId} に変換する（`<select>` の値用）。
 *
 * @throws `TIME_AXIS_OPTIONS` にない値の場合は `Error`
 */
function parseTimeAxisModeId(value: string): TimeAxisModeId {
  const found = TIME_AXIS_OPTIONS.find((option) => option.value === value);
  if (found === undefined) {
    throw new Error(`不正なタイムゾーン軸指定です: '${value}'`);
  }
  return found.value;
}

/**
 * 「国際化」パターンのルートコンポーネント。
 */
export function InternationalPattern(): ReactElement {
  const calendar = useCalendar({
    initialView: 'week',
    locale: 'ja',
    timeZone: HOME_TIME_ZONE,
    events: internationalEvents,
    // 月・週ビューの週番号を有効化する（可視化は international.css 側で行う）
    showWeekNumbers: true,
    timeAxisZones: INITIAL_TIME_AXIS_ZONES,
    // 現在時刻線・「今日」判定を 1 分ごとに追従させる
    refreshSeconds: 60,
  });
  const { api } = calendar;

  const [language, setLanguage] = useState<LanguageId>('ja');
  const [timeAxisMode, setTimeAxisMode] = useState<TimeAxisModeId>(INITIAL_TIME_AXIS_MODE);
  const [rtl, setRtl] = useState(false);

  /**
   * 言語切替（ワンスイッチ）。`locale` の更新（`api.updateOptions`）と
   * `enUsLabels` の適用（`toolbarLabels` / `calendarViewLabels` の切替）を
   * 1 回のクリックで同時に反映する。
   */
  function handleLanguageToggle(): void {
    const next: LanguageId = language === 'ja' ? 'en' : 'ja';
    setLanguage(next);
    api.updateOptions({ locale: LANGUAGE_OPTIONS[next].locale });
  }

  /** 複数タイムゾーン軸（`timeAxisZones`）の切替。 */
  function handleTimeAxisModeChange(mode: TimeAxisModeId): void {
    setTimeAxisMode(mode);
    const option = TIME_AXIS_OPTIONS.find((candidate) => candidate.value === mode);
    api.updateOptions({ timeAxisZones: option?.zones ?? [] });
  }

  const toolbarLabels: ToolbarLabels = language === 'en' ? enUsLabels.toolbar : {};
  const calendarViewLabels: CalendarViewProps = language === 'en' ? enUsLabels.calendarView : {};

  return (
    <div className="koyomi-demo-international demo-app" dir={rtl ? 'rtl' : undefined}>
      <header className="demo-header">
        <h2 className="demo-title">国際チームデモ</h2>
        <div className="demo-controls">
          <button
            type="button"
            className="demo-button international-language-toggle"
            onClick={handleLanguageToggle}
          >
            {LANGUAGE_OPTIONS[language].switchLabel}
          </button>

          <label className="demo-control" htmlFor="intl-time-axis-select">
            <span>タイムゾーン軸</span>
            <select
              id="intl-time-axis-select"
              name="timeAxisZones"
              value={timeAxisMode}
              onChange={(event) =>
                handleTimeAxisModeChange(parseTimeAxisModeId(event.target.value))
              }
            >
              {TIME_AXIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="demo-control" htmlFor="intl-rtl-toggle">
            <input
              id="intl-rtl-toggle"
              type="checkbox"
              name="rtl"
              checked={rtl}
              onChange={(event) => setRtl(event.target.checked)}
            />
            <span>RTL（右から左）</span>
          </label>
        </div>
      </header>

      <main className="demo-main">
        <CalendarProvider value={calendar}>
          <Toolbar views={VIEWS} labels={toolbarLabels} />
          <CalendarView {...calendarViewLabels} />
        </CalendarProvider>
      </main>

      <p className="international-hint">
        週番号（<code>showWeekNumbers</code>）は常に有効です。月・週ビューの左端のバッジで
        <code>data-koyomi-week-number</code> 属性を確認できます（詳細は docs/views.md
        の「週番号（showWeekNumbers）」を参照）。
      </p>
    </div>
  );
}
