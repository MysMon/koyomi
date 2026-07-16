/**
 * @packageDocumentation
 * リストビューの内部共有レンダラ。
 *
 * `ListView`（全件描画）と `VirtualListView`（仮想化）の両方が使う日セクションの
 * 描画をここに集約する。これにより DOM 仕様（`docs/internal/components-dom.md` の
 * 「リストビュー」）が 1 箇所に定義され、両コンポーネントで完全に一致する。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

import type {
  CSSProperties,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from 'react';
import { formatSlotLabel, minutesOfDayInZone } from '../../core/timezone';
import type { EventOccurrence, ListDay, TimeZoneId } from '../../core/types';
import { eventNotificationProps } from '../drag-common';
import type { CalendarInteractionCallbacks } from '../types';
import { formatEventAriaLabel, resolveEventAriaLabel } from './month-view-parts';

/** `allDayLabel` 省略時の既定表示（終日イベントの時刻ラベル）。 */
export const DEFAULT_ALL_DAY_LABEL = '終日';

/** `emptyLabel` 省略時の既定表示（予定が 1 件もない場合のメッセージ）。 */
export const DEFAULT_EMPTY_LABEL = '予定はありません';

/**
 * 日セクションの既定 aria-label（例: `'7月16日(木) 予定2件'`）を組み立てる。
 * `ListView` / `VirtualListView` の両方で使う共通の既定文字列。予定が 0 件でも
 * 「予定0件」を含める（`VirtualListView` の既存挙動を踏襲）。
 *
 * @param defaultDayHeader - 日付見出しの既定内容（`'M月d日(曜)'` 形式）
 * @param occurrenceCount - その日の予定件数
 * @returns 既定の aria-label 文字列
 */
export function defaultListDayAriaLabel(defaultDayHeader: string, occurrenceCount: number): string {
  return `${defaultDayHeader} 予定${occurrenceCount}件`;
}

/**
 * 時間指定イベントの時刻ラベルを作る（表示タイムゾーンにおける、ロケールに応じた時刻表記の範囲）。
 * 終日イベントのラベルは呼び出し側で `allDayLabel` を直接使うため、ここでは扱わない。
 */
export function formatTimedEventTimeLabel(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): string {
  const startLabel = formatSlotLabel(minutesOfDayInZone(occurrence.start, timeZone), locale);
  const endLabel = formatSlotLabel(minutesOfDayInZone(occurrence.end, timeZone), locale);
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
export function eventSwatchStyle(color: string | undefined): CSSProperties | undefined {
  if (color === undefined) {
    return undefined;
  }
  return { '--koyomi-event-color': color } as CSSProperties;
}

/**
 * {@link ListDaySection} の props。
 *
 * `sectionRef` / `role` / `ariaLabel` / `pinned` / `style` は仮想化（`VirtualListView`）
 * 専用の任意項目で、省略時は `ListView` の従来 DOM と完全に一致する。
 */
export interface ListDaySectionProps {
  /** 描画する日。 */
  day: ListDay;
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** 書式ロケール（イベント行の aria-label 生成に使う）。 */
  locale: string;
  /** 日付見出しの既定内容（`'M月d日(曜)'` 形式。呼び出し側で整形済み）。 */
  defaultDayHeader: string;
  /** 終日イベントの時刻ラベル。 */
  allDayLabel: ReactNode;
  /** イベント行クリック時のハンドラ。 */
  onEventClick: (occurrence: EventOccurrence, event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** イベント行キーダウン時のハンドラ（Enter / Space をクリック相当に橋渡し）。 */
  onEventKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /**
   * インタラクションコールバック（追加通知系の配線に使う）。
   * `onEventDoubleClick` / `onEventContextMenu` / `onEventHover` / `onEventHoverEnd` が
   * 指定されている場合のみ、対応する DOM リスナーをイベント行に付ける
   * （{@link eventNotificationProps} 参照）。
   */
  callbacks: CalendarInteractionCallbacks;
  /** イベント行の内容をカスタム描画する関数。 */
  renderEvent?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * イベント行の aria-label をカスタマイズする関数。
   * 第 2 引数に既定の aria-label 文字列（`formatEventAriaLabel` の結果）を渡すので、
   * それを加工・置換して返せる。省略時は既定文字列をそのまま使う。
   */
  eventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /** 日付見出しの内容をカスタム描画する関数（第 2 引数に既定内容）。 */
  renderDayHeader?: (day: ListDay, defaultContent: ReactNode) => ReactNode;
  /** 仮想化: 高さ実測用の ref コールバック。 */
  sectionRef?: Ref<HTMLElement>;
  /** 仮想化: `role="listitem"` を付与する。 */
  role?: 'listitem';
  /** 仮想化: 件数を伝える `aria-label`（例: 「7月16日(木) 予定3件」）。 */
  ariaLabel?: string;
  /** 仮想化: 窓外フォーカス保持アイテム（`data-koyomi-pinned="true"`）。 */
  pinned?: boolean;
  /**
   * 仮想化: pinned セクションの絶対配置 inline style（`position`/`insetInlineStart`/
   * `width`/`top`）。窓外でフォーカスを保持する pinned セクションが通常フローへ割り込まない
   * よう、位置決めに必須のスタイルを丸ごと inline で出力する（`VirtualListView` 参照）。
   */
  style?: CSSProperties;
  /**
   * イベント行をタブ順に含めるか。既定 `true`。
   * `false` のとき各 `button` に `tabIndex=-1` を付け、タブ移動の対象から外す
   * （窓外に保持された pinned セクションの不可視フォーカスを防ぐため。フォーカス中の
   * 要素は `tabIndex=-1` でもフォーカスを保持する）。
   */
  eventTabbable?: boolean;
}

/**
 * リストビューの日セクション 1 件分（`<section>`＋日付見出し＋イベント行）を描画する。
 *
 * @param props - {@link ListDaySectionProps}
 * @returns 日セクションの要素
 */
export function ListDaySection(props: ListDaySectionProps): ReactElement {
  const {
    day,
    timeZone,
    locale,
    defaultDayHeader,
    allDayLabel,
    onEventClick,
    onEventKeyDown,
    callbacks,
    renderEvent,
    eventAriaLabel,
    renderDayHeader,
    sectionRef,
    role,
    ariaLabel,
    pinned,
    style,
    eventTabbable,
  } = props;

  return (
    <section
      ref={sectionRef}
      data-koyomi="list-day"
      data-koyomi-date={day.key}
      data-today={day.isToday ? 'true' : undefined}
      aria-current={day.isToday ? 'date' : undefined}
      {...(role !== undefined ? { role } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      {...(style !== undefined ? { style } : {})}
    >
      <h3 data-koyomi="list-day-header">
        {renderDayHeader !== undefined ? renderDayHeader(day, defaultDayHeader) : defaultDayHeader}
      </h3>
      {day.occurrences.map((occurrence) => (
        <button
          key={occurrence.key}
          type="button"
          data-koyomi="list-event"
          onClick={(event) => onEventClick(occurrence, event)}
          onKeyDown={onEventKeyDown}
          aria-label={resolveEventAriaLabel(
            occurrence,
            formatEventAriaLabel(occurrence, timeZone, locale),
            eventAriaLabel,
          )}
          {...(eventTabbable === false ? { tabIndex: -1 } : {})}
          {...eventNotificationProps(callbacks, occurrence)}
        >
          {renderEvent !== undefined ? (
            renderEvent(occurrence)
          ) : (
            <>
              <span data-koyomi="list-event-time">
                {occurrence.allDay
                  ? allDayLabel
                  : formatTimedEventTimeLabel(occurrence, timeZone, locale)}
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
}
