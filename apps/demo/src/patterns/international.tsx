/**
 * @packageDocumentation
 * `InternationalPattern` — 「国際化」パターン。
 *
 * 東京拠点のチームが NY・ロンドン拠点と協業する想定のデモ。週ビューを中心に、
 * 次の 5 点を確認できる。
 *
 * 1. **複数タイムゾーン軸**（`timeAxisZones`） — 「なし / NY / NY+ロンドン」を
 *    切り替え、週/日ビューの時間軸に追加のタイムゾーン列を出し分ける
 * 2. **言語切替**（`locale`） — 日本語 / English をワンスイッチで切替え、
 *    `locale` の更新（`api.updateOptions`）を行う。`Toolbar` / `CalendarView`
 *    はいずれも `locale` に連動して中央メッセージカタログから自動で文言・
 *    aria-label・時間軸の時刻表記（24 時間制 / 12 時間制 AM・PM）まで一括で
 *    切り替わる（追加の文言 props は不要）
 * 3. **文言の部分上書き**（`messages`） — 「社内呼称」トグルで、`CalendarProvider`
 *    の `messages` prop により「今日」ボタンと空状態メッセージだけを社内独自の
 *    呼称に差し替える例を示す。上書きは言語ごとに用意しており、言語切替と
 *    独立に組み合わせられる（他の文言は選択中の言語の既定カタログのまま）
 * 4. **週番号**（`showWeekNumbers`） — 常時有効化し、月・週ビューの左端に
 *    パターン専用 CSS（`./international.css`）で `data-koyomi-week-number`
 *    属性をバッジとして可視化する
 * 5. **RTL 切替** — このパターンのルート要素に `dir="rtl"` を付け外しし、
 *    論理プロパティ（`insetInlineStart` 等）によるレイアウト反転を確認する
 *
 * ビュー切替は `Toolbar` + `CalendarView`（月・週・日・リストの 4 ビュー）。
 * インタラクションのコールバックはあえて指定しない。範囲選択・繰り返し予定の
 * 編集スコープはいずれも既定動作（即時作成 / スコープ `'this'`）に委ねる
 * （`docs/interactions.md` 参照）。
 */

import type {
  CalendarEvent,
  CalendarViewType,
  MessageCatalogOverrides,
  TimeZoneId,
} from '@koyomi-cal/react';
import {
  addDaysInZone,
  CalendarProvider,
  CalendarView,
  dateKeyInZone,
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

/**
 * 「社内呼称」トグル ON 時に使う `messages` の部分上書き（言語ごと）。
 *
 * `toolbar.today` と `list.empty` の 2 か所だけを社内独自の呼称に差し替える例。
 * 他の文言（ビュー切替ボタン・aria-label 等）は選択中の言語の既定カタログの
 * ままになる（グループ単位の浅いマージ）。`language`（{@link LanguageId}）の
 * 切替と独立に、このトグル自体も on/off できる。
 */
const CUSTOM_MESSAGES: Readonly<Record<LanguageId, MessageCatalogOverrides>> = {
  ja: {
    toolbar: { today: '🏠 本社基準日' },
    list: { empty: '🌏 選択中の拠点に予定はありません' },
  },
  en: {
    toolbar: { today: '🏠 HQ Today' },
    list: { empty: '🌏 No events for the selected offices' },
  },
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
  const [customMessages, setCustomMessages] = useState(false);

  /** 言語切替（ワンスイッチ）。`locale` の更新（`api.updateOptions`）のみで文言も追従する。 */
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

          <label className="demo-control" htmlFor="intl-custom-messages-toggle">
            <input
              id="intl-custom-messages-toggle"
              type="checkbox"
              name="customMessages"
              checked={customMessages}
              onChange={(event) => setCustomMessages(event.target.checked)}
            />
            <span>社内呼称（messages 部分上書き）</span>
          </label>
        </div>
      </header>

      <main className="demo-main">
        <CalendarProvider
          value={calendar}
          // exactOptionalPropertyTypes: true の下では messages: undefined を明示できないため、
          // OFF 時は prop 自体を渡さない。
          {...(customMessages ? { messages: CUSTOM_MESSAGES[language] } : {})}
        >
          <Toolbar views={VIEWS} />
          <CalendarView />
        </CalendarProvider>
      </main>

      <p className="international-hint">
        週番号（<code>showWeekNumbers</code>）は常に有効です。月・週ビューの左端のバッジで
        <code>data-koyomi-week-number</code> 属性を確認できます（詳細は docs/views.md
        の「週番号（showWeekNumbers）」を参照）。「社内呼称」を有効にすると、
        <code>messages</code> prop で「今日」ボタンと空状態メッセージだけが社内独自の
        呼称に差し替わります（他の文言は選択中の言語の既定のまま）。
      </p>
    </div>
  );
}
