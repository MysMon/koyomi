/**
 * @packageDocumentation
 * `MultiMonthView` — 複数月ビュー（月ビューを `multiMonthCount` ヶ月分連結表示）を
 * 描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「月ビュー（MonthView）」節に準拠する（月ごとのグリッド部分は `MonthView` と
 * byte-identical）。週行・イベント帯・日セルの描画は月ビューと共有の非公開パーツ
 * {@link MonthWeekRow}（`./month-view-parts`）に委譲する。
 *
 * 前後月の日付セルは非インタラクティブにする（`interactiveOutsideDays: false`）。
 * 同じ日付が隣接する月グリッドの前後月セルとして二重に現れても、どちらか一方
 * （その月自身のグリッド）でのみ `getDayCellProps` を呼ぶことで、日付キーの
 * 二重登録・二重フォーカス対象化を防ぐ（詳細は
 * `docs/internal/views-expansion-design.md` §5.3）。
 *
 * `useDayDrag` はコンポーネント全体で 1 インスタンスにする。全月の（前後月を
 * 除く）日セルが単一のセルレジストリに登録されるため、日付キーは全月グリッド
 * 横断で一意になり、月境界をまたぐドラッグ（例: 7/31 → 8/2）のヒットテストも
 * そのまま解決できる。
 */

import type { ReactElement, ReactNode } from 'react';
import { useCallback } from 'react';
import type {
  DateRange,
  EventOccurrence,
  EventSegment,
  MonthDay,
  MultiMonthMonth,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { DayDragHandlers } from '../use-day-drag';
import { useDayDrag } from '../use-day-drag';
import { formatMonthTitle } from './format';
import { computeWeekSelectionSpan, formatWeekdayLabel, MonthWeekRow } from './month-view-parts';

/** `MultiMonthView` の props。 */
export interface MultiMonthViewProps {
  /**
   * イベントセグメントの表示内容をカスタマイズする関数。
   * 省略時の既定内容は `MonthView` と同じ（{@link MonthWeekRow} 参照）。
   */
  renderEvent?: (segment: EventSegment) => ReactNode;
  /**
   * 日セルの内容をカスタマイズするスロット。祝日ラベルやバッジの注入に使う。
   * `defaultContent` は既定の内容（日番号ボタン＋（あれば）「+N 件」ボタン）であり、
   * そのまま包んで使うことも、完全に差し替えることもできる。省略時は既定内容をそのまま描画する。
   * @param day - 対象の日
   * @param defaultContent - 既定の内容
   */
  renderDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
  /**
   * 「+N 件」（あふれ集約）ラベルのカスタマイズ関数。i18n 用途。
   * 省略時は `'+N 件'` 形式になる。
   * @param count - 「+N 件」に集約された非表示イベント数
   */
  overflowLabel?: (count: number) => ReactNode;
}

/** 「+N 件」の既定ラベル（`MonthView` と同じ）。 */
function defaultOverflowLabel(count: number): ReactNode {
  return `+${count} 件`;
}

/**
 * 複数月ビュー（`MultiMonthView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、
 * `viewModel.type !== 'multiMonth'` の場合は何も描画しない（`null` を返す）。
 * 月ごとの見出し・グリッドは {@link MultiMonthMonthSection} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'multiMonth' });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
 *     <MultiMonthView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function MultiMonthView(props: MultiMonthViewProps): ReactElement | null {
  const { renderEvent, overflowLabel = defaultOverflowLabel, renderDayCell } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  // コンポーネント全体で 1 インスタンス（モジュール冒頭の TSDoc を参照）。
  const dayDrag = useDayDrag({ calendar, callbacks });

  /** 指定日の day ビューへ切り替える。 */
  const goToDay = useCallback(
    (date: Date): void => {
      api.goTo(date);
      api.setView('day');
    },
    [api],
  );

  const onOverflowClickCallback = callbacks.onOverflowClick;
  /** 「+N 件」クリック。`onOverflowClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  const handleOverflowClick = useCallback(
    (day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]): void => {
      if (onOverflowClickCallback !== undefined) {
        onOverflowClickCallback(day, hiddenOccurrences);
        return;
      }
      goToDay(day.date);
    },
    [onOverflowClickCallback, goToDay],
  );

  if (viewModel.type !== 'multiMonth') {
    return null;
  }

  const { months } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const previewRange = dayDrag.previewRange;

  return (
    <div data-koyomi="multimonth">
      {months.map((month) => (
        <MultiMonthMonthSection
          key={month.key}
          month={month}
          timeZone={timeZone}
          locale={locale}
          previewRange={previewRange}
          dayDrag={dayDrag}
          renderEvent={renderEvent}
          overflowLabel={overflowLabel}
          renderDayCell={renderDayCell}
          onDayNumberClick={goToDay}
          onOverflowClick={handleOverflowClick}
        />
      ))}
    </div>
  );
}

/**
 * 複数月ビューの 1 ヶ月分（月見出し＋月グリッド）。
 *
 * 週行の描画は月ビューと共有の {@link MonthWeekRow} に委譲し、
 * `interactiveOutsideDays={false}` を渡すことで前後月セルを非インタラクティブにする。
 */
function MultiMonthMonthSection(props: {
  /** 描画する月。 */
  month: MultiMonthMonth;
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** ロケール。 */
  locale: string;
  /** ドラッグプレビューの日範囲（操作中でなければ `null`）。 */
  previewRange: DateRange | null;
  /** {@link DayDragHandlers}（`MultiMonthView` 全体で共有する単一インスタンス）。 */
  dayDrag: DayDragHandlers;
  /** イベントセグメントの表示内容のカスタマイズ関数。 */
  renderEvent: ((segment: EventSegment) => ReactNode) | undefined;
  /** 「+N 件」ラベルのカスタマイズ関数。 */
  overflowLabel: (count: number) => ReactNode;
  /** 日セルの内容のカスタマイズ関数。 */
  renderDayCell: ((day: MonthDay, defaultContent: ReactNode) => ReactNode) | undefined;
  /** 日番号クリック時のハンドラ。 */
  onDayNumberClick: (date: Date) => void;
  /** 「+N 件」クリック時のハンドラ。 */
  onOverflowClick: (day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => void;
}): ReactElement {
  const {
    month,
    timeZone,
    locale,
    previewRange,
    dayDrag,
    renderEvent,
    overflowLabel,
    renderDayCell,
    onDayNumberClick,
    onOverflowClick,
  } = props;

  const firstWeek = month.weeks[0];

  // ドラッグプレビューとの交差判定は月ごとに一度だけここで行う（MonthView と同じ理由）。
  // includeOutsideDays: false で前後月セルを交差判定から除外する（月本体のみが対象）。
  const weeksWithSelection = month.weeks.map((week) => ({
    week,
    selectionSpan:
      previewRange !== null
        ? computeWeekSelectionSpan(week.days, previewRange, timeZone, false)
        : null,
  }));

  return (
    <section data-koyomi="multimonth-month" data-koyomi-month={month.key}>
      <h3 data-koyomi="multimonth-title">{formatMonthTitle(month.anchor, timeZone, locale)}</h3>
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様（components-dom.md）が定める div ベースの ARIA grid（<table> はテーマ CSS と噛み合わないため不採用。MonthView と同じ理由） */}
      <div data-koyomi="month" role="grid">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
        <div data-koyomi="month-weekdays" role="row">
          {(firstWeek?.days ?? []).map((day) => (
            // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
            // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
            <div key={day.key} data-koyomi="month-weekday" role="columnheader">
              {formatWeekdayLabel(day.date, timeZone, locale)}
            </div>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA rowgroup */}
        <div data-koyomi="month-weeks" role="rowgroup">
          {weeksWithSelection.map(({ week, selectionSpan }) => (
            <MonthWeekRow
              key={`${month.key}:${week.days[0]?.key ?? ''}`}
              week={week}
              timeZone={timeZone}
              locale={locale}
              selectionSpan={selectionSpan}
              dayDrag={dayDrag}
              renderEvent={renderEvent}
              overflowLabel={overflowLabel}
              renderDayCell={renderDayCell}
              onDayNumberClick={onDayNumberClick}
              onOverflowClick={onOverflowClick}
              interactiveOutsideDays={false}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
