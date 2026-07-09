/**
 * @packageDocumentation
 * リストビュー（`ListView`）コンポーネント。
 *
 * 表示範囲内の予定を日付ごとの `section` にまとめて一覧表示する
 * ヘッドレスコンポーネント。DOM 構造・`data-koyomi-*` 属性の仕様は
 * `docs/internal/components-dom.md` の「リストビュー」セクションに従う。
 *
 * 月/週/日ビューと異なり、リストビューにドラッグ操作はない。
 * イベント行はクリック・Enter・Space で {@link CalendarInteractionCallbacks.onEventClick}
 * を呼び出すのみ。
 */

import type {
  CSSProperties,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { formatSlotLabel, minutesOfDayInZone } from '../../core/timezone';
import type { EventOccurrence, ListDay, TimeZoneId } from '../../core/types';
import { useCalendarContext } from '../context';

/** `allDayLabel` 省略時の既定表示（終日イベントの時刻ラベル）。 */
const DEFAULT_ALL_DAY_LABEL = '終日';

/** `emptyLabel` 省略時の既定表示（予定が 1 件もない場合のメッセージ）。 */
const DEFAULT_EMPTY_LABEL = '予定はありません';

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
 * 時間指定イベントの時刻ラベルを作る（表示タイムゾーンにおける `'HH:mm〜HH:mm'`）。
 * 終日イベントのラベルは呼び出し側で `allDayLabel` を直接使うため、ここでは扱わない。
 */
function formatTimedEventTimeLabel(occurrence: EventOccurrence, timeZone: TimeZoneId): string {
  const startLabel = formatSlotLabel(minutesOfDayInZone(occurrence.start, timeZone));
  const endLabel = formatSlotLabel(minutesOfDayInZone(occurrence.end, timeZone));
  return `${startLabel}〜${endLabel}`;
}

/**
 * 色見本（`list-event-swatch`）に設定する inline style を作る。
 *
 * `event.color` が指定されている場合のみ CSS 変数 `--koyomi-event-color` を
 * 設定する（テーマ側は `var(--koyomi-event-color, 既定色)` で参照する）。
 * このカスタムプロパティは `CSSProperties` の型に存在しないため、変数名を
 * キーにしたオブジェクトを `CSSProperties` として扱うための `as` キャストが
 * 必要になる（DOM 仕様で明示的に許可されている唯一の箇所）。
 */
function eventSwatchStyle(color: string | undefined): CSSProperties | undefined {
  if (color === undefined) {
    return undefined;
  }
  return { '--koyomi-event-color': color } as CSSProperties;
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
      {viewModel.days.map((day) => {
        const defaultDayHeader = dayHeaderFormatter.format(day.date);
        return (
          <section
            key={day.key}
            data-koyomi="list-day"
            data-koyomi-date={day.key}
            data-today={day.isToday ? 'true' : undefined}
          >
            <h3 data-koyomi="list-day-header">
              {renderDayHeader !== undefined
                ? renderDayHeader(day, defaultDayHeader)
                : defaultDayHeader}
            </h3>
            {day.occurrences.map((occurrence) => (
              <button
                key={occurrence.key}
                type="button"
                data-koyomi="list-event"
                onClick={(event) => handleEventClick(occurrence, event)}
                onKeyDown={handleEventKeyDown}
              >
                {renderEvent !== undefined ? (
                  renderEvent(occurrence)
                ) : (
                  <>
                    <span data-koyomi="list-event-time">
                      {occurrence.allDay
                        ? allDayLabel
                        : formatTimedEventTimeLabel(occurrence, timeZone)}
                    </span>
                    <span
                      data-koyomi="list-event-swatch"
                      style={eventSwatchStyle(occurrence.event.color)}
                    />
                    <span data-koyomi="list-event-title">{occurrence.event.title}</span>
                  </>
                )}
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
