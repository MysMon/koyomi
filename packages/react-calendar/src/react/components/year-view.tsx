/**
 * @packageDocumentation
 * `YearView` — 年ビュー（12 ヶ月のミニ月グリッド）を描画するヘッドレスコンポーネント。
 *
 * 予定の帯・タイトルは表示せず、D&D もない。日セルのクリックで該当日の
 * day ビューへ移動する（月ビューの日番号ボタンと同じ `goTo` + `setView('day')`）。
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「年ビュー（YearView）」節を参照。
 */

import type { ReactElement, ReactNode } from 'react';
import { memo, useCallback } from 'react';
import type { TimeZoneId, Weekday, YearDay, YearMonth } from '../../core/types';
import { useCalendarContext } from '../context';
import { formatWeekday } from './format';

/** `YearView` の props。 */
export interface YearViewProps {
  /**
   * 月見出しの内容をカスタマイズする関数。
   * `defaultContent` は既定の内容（月名、例: `'7月'`）。省略時は既定内容をそのまま描画する。
   * @param month - 対象の月
   * @param defaultContent - 既定の内容
   */
  renderMonthHeader?: (month: YearMonth, defaultContent: ReactNode) => ReactNode;
  /**
   * 日セル（ボタン）の内容をカスタマイズする関数。
   * `defaultContent` は既定の内容（日番号＋（予定があれば）件数マーカー）。
   * 省略時は既定内容をそのまま描画する。
   * @param day - 対象の日
   * @param defaultContent - 既定の内容
   */
  renderDayCell?: (day: YearDay, defaultContent: ReactNode) => ReactNode;
}

/** `Intl.DateTimeFormat` インスタンスのキャッシュ（`locale|timeZone|種別` をキーにする）。 */
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * キャッシュ済みの `Intl.DateTimeFormat` を返す（未生成なら作ってキャッシュする）。
 * `month-view.tsx` と同じキャッシュの流儀（`new Intl.DateTimeFormat(...)` の
 * ロケール解決コストを、同じ locale・timeZone・用途の組み合わせでは再レンダーの
 * たびに払わないようにする）をこのファイル内で再現したもの。
 */
function getDateTimeFormat(
  locale: string,
  timeZone: TimeZoneId,
  kind: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${kind}`;
  const cached = dateTimeFormatCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, options);
  dateTimeFormatCache.set(cacheKey, formatter);
  return formatter;
}

/** 月名ラベル（例: `'7月'`）を Intl で生成する。 */
function formatMonthName(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'year-month-name', {
    timeZone,
    month: 'long',
  }).format(date);
}

/** 日番号ラベル（例: `'15'`）を Intl で生成する。 */
function formatDayNumberLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'year-day-number', {
    timeZone,
    day: 'numeric',
  }).format(date);
}

/** 日付ラベル（`'M月d日'` 形式、年は含まない）を Intl で生成する。 */
function formatMonthDayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'year-month-day', {
    timeZone,
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * 日セルの aria-label（例: `'7月10日 予定3件'`）を組み立てる。
 * 予定が 0 件の場合は件数部分を省略する。
 */
function formatDayAriaLabel(day: YearDay, timeZone: TimeZoneId, locale: string): string {
  const dateLabel = formatMonthDayLabel(day.date, timeZone, locale);
  return day.eventCount > 0 ? `${dateLabel} 予定${day.eventCount}件` : dateLabel;
}

// 条件付きスプレッドで付与する data / ARIA 属性。明示的な型注釈でリテラル型を確定させ、
// `as` を使わずに `aria-current` の union（'date'）へ適合させる（month-view.tsx と同じ方針）。
const TODAY_BUTTON_ATTRS: { 'data-today': 'true'; 'aria-current': 'date' } = {
  'data-today': 'true',
  'aria-current': 'date',
};
const OUTSIDE_BUTTON_ATTRS: { 'data-outside': 'true' } = { 'data-outside': 'true' };
const HAS_EVENTS_BUTTON_ATTRS: { 'data-has-events': 'true' } = { 'data-has-events': 'true' };

/**
 * 年ビュー（`YearView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'year'`
 * の場合は何も描画しない（`null` を返す）。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'year' });
 * return (
 *   <CalendarProvider value={calendar}>
 *     <YearView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function YearView(props: YearViewProps): ReactElement | null {
  const { renderMonthHeader, renderDayCell } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();

  /** 指定日の day ビューへ切り替える（月ビューの日番号ボタンと同じ挙動）。 */
  const goToDay = useCallback(
    (date: Date): void => {
      api.goTo(date);
      api.setView('day');
    },
    [api],
  );

  const onDayNumberClickCallback = callbacks.onDayNumberClick;
  /** 日セルクリック。`onDayNumberClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  const handleDayClick = useCallback(
    (date: Date): void => {
      if (onDayNumberClickCallback !== undefined) {
        onDayNumberClickCallback(date);
        return;
      }
      goToDay(date);
    },
    [onDayNumberClickCallback, goToDay],
  );

  if (viewModel.type !== 'year') {
    return null;
  }

  const { months, weekdays } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;

  return (
    <div data-koyomi="year">
      {months.map((month) => (
        <YearMonthSection
          key={month.key}
          month={month}
          weekdays={weekdays}
          timeZone={timeZone}
          locale={locale}
          renderMonthHeader={renderMonthHeader}
          renderDayCell={renderDayCell}
          onDayClick={handleDayClick}
        />
      ))}
    </div>
  );
}

/** 年ビューの 1 ヶ月分（月見出し＋ミニ月グリッド）。 */
const YearMonthSection = memo(function YearMonthSection(props: {
  month: YearMonth;
  weekdays: readonly Weekday[];
  timeZone: TimeZoneId;
  locale: string;
  renderMonthHeader: ((month: YearMonth, defaultContent: ReactNode) => ReactNode) | undefined;
  renderDayCell: ((day: YearDay, defaultContent: ReactNode) => ReactNode) | undefined;
  onDayClick: (date: Date) => void;
}): ReactElement {
  const { month, weekdays, timeZone, locale, renderMonthHeader, renderDayCell, onDayClick } = props;

  const defaultHeaderContent = (
    <div data-koyomi="year-month-title">{formatMonthName(month.anchor, timeZone, locale)}</div>
  );

  return (
    <section data-koyomi="year-month" data-koyomi-month={month.key}>
      {renderMonthHeader ? renderMonthHeader(month, defaultHeaderContent) : defaultHeaderContent}
      {/* biome-ignore lint/a11y/useSemanticElements: 月ビューの DOM 仕様に合わせた div ベースの ARIA grid（<table> はテーマ CSS と噛み合わないため不採用） */}
      <div data-koyomi="year-month-grid" role="grid">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
        <div data-koyomi="year-weekdays" role="row">
          {weekdays.map((weekday) => (
            // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
            // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
            <div key={weekday} data-koyomi="year-weekday" role="columnheader">
              {formatWeekday(weekday, locale)}
            </div>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA rowgroup */}
        <div data-koyomi="year-weeks" role="rowgroup">
          {month.weeks.map((week, weekIndex) => (
            // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row
            // biome-ignore lint/a11y/useFocusableInteractive: row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う）
            <div key={week[0]?.key ?? weekIndex} data-koyomi="year-week" role="row">
              {week.map((day) => (
                <YearDayCell
                  key={day.key}
                  day={day}
                  timeZone={timeZone}
                  locale={locale}
                  renderDayCell={renderDayCell}
                  onDayClick={onDayClick}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

/** 年ビューの日セル 1 件分（`role="gridcell"` の中の日番号ボタン）。 */
const YearDayCell = memo(function YearDayCell(props: {
  day: YearDay;
  timeZone: TimeZoneId;
  locale: string;
  renderDayCell: ((day: YearDay, defaultContent: ReactNode) => ReactNode) | undefined;
  onDayClick: (date: Date) => void;
}): ReactElement {
  const { day, timeZone, locale, renderDayCell, onDayClick } = props;

  const defaultButtonContent = (
    <>
      {formatDayNumberLabel(day.date, timeZone, locale)}
      {day.eventCount > 0 && day.inCurrentMonth && (
        <span data-koyomi="year-day-count" aria-hidden="true" />
      )}
    </>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: 月ビューの DOM 仕様に合わせた div ベースの ARIA gridcell（<table> は不採用、YearMonthSection 側の理由と同じ）
    // biome-ignore lint/a11y/useFocusableInteractive: gridcell 自体はフォーカス対象にしない（実際の操作対象は内側の button[data-koyomi="year-day"]）
    <div data-koyomi="year-day-cell" role="gridcell">
      <button
        type="button"
        data-koyomi="year-day"
        data-koyomi-date={day.key}
        aria-label={formatDayAriaLabel(day, timeZone, locale)}
        {...(day.isToday ? TODAY_BUTTON_ATTRS : {})}
        {...(!day.inCurrentMonth ? OUTSIDE_BUTTON_ATTRS : {})}
        {...(day.eventCount > 0 ? HAS_EVENTS_BUTTON_ATTRS : {})}
        onClick={() => onDayClick(day.date)}
      >
        {renderDayCell ? renderDayCell(day, defaultButtonContent) : defaultButtonContent}
      </button>
    </div>
  );
});
