/**
 * @packageDocumentation
 * `MonthView` — 月ビュー（グリッド表示）を描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「月ビュー（MonthView）」節を参照。スタイルは属性フックのみで当て、
 * 位置決めに必須の数値（%・calc）だけを inline style として出力する。
 * 日セル・帯セグメントのドラッグ操作は {@link useDayDrag} に委譲する。
 *
 * 週行・イベント帯・日セルの描画は非公開の共有パーツ
 * {@link MonthWeekRow}（`./month-view-parts`）に委譲する。
 */

import type { ReactElement, ReactNode } from 'react';
import { useCallback } from 'react';
import type { EventOccurrence, EventSegment, MonthDay } from '../../core/types';
import { useCalendarContext } from '../context';
import type { MonthOverflowButtonProps } from '../types';
import { useDayDrag } from '../use-day-drag';
import {
  computeWeekSelectionSpan,
  formatWeekdayLabel,
  MonthWeekRow,
  useStableDayDrag,
  withMonthLanesStyle,
} from './month-view-parts';

/** `MonthView` の props。 */
export interface MonthViewProps {
  /**
   * イベントセグメントの表示内容をカスタマイズする関数。
   * 省略時は、終日・複数日にまたがるセグメントはタイトルのみ、単日の時間指定
   * セグメント（`span === 1` かつ非終日）は開始時刻（`'H:mm'`）＋タイトルを表示する。
   */
  renderEvent?: (segment: EventSegment) => ReactNode;
  /**
   * 「+N 件」（あふれ集約）ラベルのカスタマイズ関数。i18n 用途。
   * 省略時は `'+N 件'` 形式になる。
   * @param count - 「+N 件」に集約された非表示イベント数
   */
  overflowLabel?: (count: number) => ReactNode;
  /**
   * 日セルの内容をカスタマイズするスロット。祝日ラベルやバッジの注入に使う。
   * `defaultContent` は既定の内容（日番号ボタン＋（あれば）「+N 件」ボタン）であり、
   * そのまま包んで使うことも、完全に差し替えることもできる。省略時は既定内容をそのまま描画する。
   * @param day - 対象の日
   * @param defaultContent - 既定の内容
   */
  renderDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
  /**
   * 「+N 件」ボタンに追加する props を返す関数。`aria-haspopup` / `aria-expanded` など、
   * 自前のポップオーバー UI と連携するための ARIA 属性を付与する用途に使う。
   * 省略時は追加の props を付与しない。
   * @param day - 対象の日
   * @param hiddenOccurrences - その日で「+N 件」に集約された非表示のオカレンス一覧
   */
  overflowButtonProps?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
}

/** 「+N 件」の既定ラベル。 */
function defaultOverflowLabel(count: number): ReactNode {
  return `+${count} 件`;
}

/**
 * 月ビュー（`MonthView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'month'`
 * の場合は何も描画しない（`null` を返す）。日セル・帯セグメントのドラッグ操作は
 * {@link useDayDrag} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'month' });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick: openDetail }}>
 *     <MonthView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function MonthView(props: MonthViewProps): ReactElement | null {
  const {
    renderEvent,
    overflowLabel = defaultOverflowLabel,
    renderDayCell,
    overflowButtonProps,
  } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const dayDrag = useDayDrag({ calendar, callbacks });
  // dayDrag は毎レンダー新しいオブジェクトになるため、MonthWeekRow（memo化済み）への
  // 再レンダー抑制が効くよう、参照が変わらないラッパー経由で渡す（詳細は
  // useStableDayDrag のコメントを参照）。
  const stableDayDrag = useStableDayDrag(dayDrag);

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
    (
      day: MonthDay,
      hiddenOccurrences: readonly EventOccurrence[],
      visibleOccurrences: readonly EventOccurrence[],
    ): void => {
      if (onOverflowClickCallback !== undefined) {
        onOverflowClickCallback(day, hiddenOccurrences, { visibleOccurrences });
        return;
      }
      goToDay(day.date);
    },
    [onOverflowClickCallback, goToDay],
  );

  const onDayNumberClickCallback = callbacks.onDayNumberClick;
  /** 日番号クリック。`onDayNumberClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  const handleDayNumberClick = useCallback(
    (date: Date): void => {
      if (onDayNumberClickCallback !== undefined) {
        onDayNumberClickCallback(date);
        return;
      }
      goToDay(date);
    },
    [onDayNumberClickCallback, goToDay],
  );

  if (viewModel.type !== 'month') {
    return null;
  }

  const { weeks } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const firstWeek = weeks[0];
  const previewRange = dayDrag.previewRange;

  // ドラッグプレビューとの交差判定は週ごとに一度だけここで行い、交差しない週には
  // 常に同じ `null` を渡す。これにより MonthWeekRow（memo化済み）は、無関係な週を
  // 「selectionSpan が変わっていない」として再レンダーせずに済む。
  // ただし、この最適化が実際に効くのは dayDrag も参照安定である場合に限る
  // （`dayDrag` prop が毎レンダー新規参照だと、selectionSpan が同じでも memo の
  // 浅い比較が常に不一致になり無関係な週まで再レンダーされてしまう）。そのため
  // 下記では `useDayDrag` の生の戻り値ではなく `stableDayDrag`（`useStableDayDrag`
  // でラップ済み）を渡す。
  const weeksWithSelection = weeks.map((week) => ({
    week,
    selectionSpan:
      previewRange !== null ? computeWeekSelectionSpan(week.days, previewRange, timeZone) : null,
  }));

  return (
    // biome-ignore lint/a11y/useSemanticElements: DOM 仕様（components-dom.md）が定める div ベースの ARIA grid（<table> はテーマ CSS と噛み合わないため不採用）
    <div data-koyomi="month" role="grid" style={withMonthLanesStyle(options.dayMaxEvents)}>
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
            key={week.days[0]?.key ?? ''}
            week={week}
            timeZone={timeZone}
            locale={locale}
            selectionSpan={selectionSpan}
            dayDrag={stableDayDrag}
            renderEvent={renderEvent}
            overflowLabel={overflowLabel}
            renderDayCell={renderDayCell}
            onDayNumberClick={handleDayNumberClick}
            onOverflowClick={handleOverflowClick}
            overflowButtonProps={overflowButtonProps}
            interactiveOutsideDays={true}
          />
        ))}
      </div>
    </div>
  );
}
