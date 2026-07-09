/**
 * @packageDocumentation
 * リストビュー（`ListView`）コンポーネント。
 *
 * 表示範囲内の予定を日付ごとの `section` にまとめて一覧表示する
 * ヘッドレスコンポーネント。DOM 構造・`data-koyomi-*` 属性の仕様は
 * `docs/internal/components-dom.md` の「リストビュー」セクションに従う。
 * 日セクションの描画は共有レンダラ {@link ListDaySection} に委譲する
 * （`VirtualListView` と DOM 仕様を共有するため）。
 *
 * 月/週/日ビューと異なり、リストビューにドラッグ操作はない。
 * イベント行はクリック・Enter・Space で {@link CalendarInteractionCallbacks.onEventClick}
 * を呼び出すのみ。
 *
 * 大量の予定・長期間を扱い性能が問題になる場合は、仮想化する
 * {@link VirtualListView}（または {@link useVirtualizer}）を検討する。
 */

import type {
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { EventOccurrence, ListDay } from '../../core/types';
import { useCalendarContext } from '../context';
import { DEFAULT_ALL_DAY_LABEL, DEFAULT_EMPTY_LABEL, ListDaySection } from './list-view-parts';

/**
 * {@link ListView} の props。
 */
export interface ListViewProps {
  /**
   * イベント行の内容をカスタム描画する関数。
   * 省略時は時刻ラベル・色見本・タイトルからなる既定の内容を表示する。
   * 指定した場合、行の外側（`button[data-koyomi="list-event"]` とその
   * クリック・キーボード操作）は変わらず、内容だけが置き換わる。
   */
  renderEvent?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * 終日イベントの時刻ラベル（`list-event-time`）として表示する内容。
   * 省略時は「終日」を表示する。
   */
  allDayLabel?: ReactNode;
  /**
   * 予定が 1 件もない場合（`list-empty`）に表示する内容。
   * 省略時は「予定はありません」を表示する。
   */
  emptyLabel?: ReactNode;
  /**
   * 日付見出し（`list-day-header`）の内容をカスタム描画する関数。
   * 第 2 引数に既定の内容（`'M月d日(曜)'` 形式のラベル）を渡すので、
   * それをラップして返すこともできる。省略時は既定の内容をそのまま表示する。
   */
  renderDayHeader?: (day: ListDay, defaultContent: ReactNode) => ReactNode;
}

/**
 * リストビュー（`ListView`）。
 *
 * `useCalendarContext()` から取得したビューモデルが `'list'` でない場合は
 * 何も描画しない（`null` を返す）。`CalendarView` から呼ばれる場合は
 * 自動的に出し分けられるが、単独で配置してもこの判定により安全に動作する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'list' });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick: openDetail }}>
 *     <ListView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function ListView(props: ListViewProps): ReactElement | null {
  const {
    renderEvent,
    renderDayHeader,
    allDayLabel = DEFAULT_ALL_DAY_LABEL,
    emptyLabel = DEFAULT_EMPTY_LABEL,
  } = props;
  const { state, viewModel, callbacks } = useCalendarContext();

  if (viewModel.type !== 'list') {
    return null;
  }

  const timeZone = state.timeZone;
  const dayHeaderFormatter = new Intl.DateTimeFormat(state.options.locale, {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  /** イベント行のクリックで `onEventClick` を呼ぶ。 */
  function handleEventClick(
    occurrence: EventOccurrence,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    callbacks.onEventClick?.(occurrence, event.nativeEvent);
  }

  /**
   * Enter / Space をクリック相当として扱う。
   * jsdom を含む DOM 実装は `<button>` へのキーボード操作を自動で click に
   * 変換しないため、明示的に `click()` を呼んで `onClick` へ橋渡しする。
   */
  function handleEventKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.currentTarget.click();
  }

  if (viewModel.isEmpty) {
    return (
      <div data-koyomi="list">
        <div data-koyomi="list-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div data-koyomi="list">
      {viewModel.days.map((day) => (
        <ListDaySection
          key={day.key}
          day={day}
          timeZone={timeZone}
          defaultDayHeader={dayHeaderFormatter.format(day.date)}
          allDayLabel={allDayLabel}
          onEventClick={handleEventClick}
          onEventKeyDown={handleEventKeyDown}
          {...(renderEvent !== undefined ? { renderEvent } : {})}
          {...(renderDayHeader !== undefined ? { renderDayHeader } : {})}
        />
      ))}
    </div>
  );
}
