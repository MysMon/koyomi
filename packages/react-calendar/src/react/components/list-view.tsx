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
import { useMemo } from 'react';
import type { EventOccurrence, ListDay } from '../../core/types';
import { useCalendarContext } from '../context';
import { ListDaySection } from './list-view-parts';

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
 * 終日イベントの時刻ラベル・空状態のメッセージ・イベント行/日セクションの
 * aria-label は `CalendarProvider` の `messages` prop（`messages.list` /
 * `messages.common`）で差し替えられる（省略時は `state.options.locale` に
 * 対応する既定カタログ）。
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
  const { renderEvent, renderDayHeader } = props;
  const { state, viewModel, callbacks, messages } = useCalendarContext();
  const timeZone = state.timeZone;
  const locale = state.options.locale;
  const listMessages = messages.list;
  const commonMessages = messages.common;
  // 日付見出しの Intl.DateTimeFormat は生成コストがあるため memo 化する
  // （VirtualListView と同様。ロケール・タイムゾーンが変わらない限り再生成しない）。
  const dayHeaderFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
    [locale, timeZone],
  );

  if (viewModel.type !== 'list') {
    return null;
  }

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
        <div data-koyomi="list-empty">{listMessages.empty}</div>
      </div>
    );
  }

  return (
    <div data-koyomi="list">
      {viewModel.days.map((day) => {
        const defaultDayHeader = dayHeaderFormatter.format(day.date);
        return (
          <ListDaySection
            key={day.key}
            day={day}
            timeZone={timeZone}
            locale={locale}
            defaultDayHeader={defaultDayHeader}
            allDayLabel={listMessages.allDay}
            commonMessages={commonMessages}
            onEventClick={handleEventClick}
            onEventKeyDown={handleEventKeyDown}
            callbacks={callbacks}
            ariaLabel={listMessages.dayAriaLabel(day, defaultDayHeader)}
            {...(renderEvent !== undefined ? { renderEvent } : {})}
            {...(renderDayHeader !== undefined ? { renderDayHeader } : {})}
          />
        );
      })}
    </div>
  );
}
