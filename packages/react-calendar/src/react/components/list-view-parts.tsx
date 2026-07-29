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
import { memo } from 'react';
import { formatSlotLabel, minutesOfDayInZone } from '../../core/timezone';
import type { EventOccurrence, ListDay, TimeZoneId } from '../../core/types';
import type { SectionItemWindowResult } from '../../core/virtualization';
import { eventNotificationProps } from '../drag-common';
import type { CommonMessages } from '../locales/types';
import type {
  CalendarInteractionCallbacks,
  EventContentContext,
  EventContentRenderer,
  SlotRenderContext,
} from '../types';
import { listEventContentContext, resolveEventContent } from './event-content';
import { formatOccurrenceRangeLabel } from './month-view-parts';

/**
 * 時間指定イベントの時刻ラベルを作る（表示タイムゾーンにおける、ロケールに応じた時刻表記の範囲）。
 * 終日イベントのラベルは呼び出し側で `messages.list.allDay` を直接使うため、ここでは扱わない。
 *
 * @param occurrence - 対象のオカレンス
 * @param timeZone - 表示タイムゾーン
 * @param locale - ロケール
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}）
 */
export function formatTimedEventTimeLabel(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string {
  const startLabel = formatSlotLabel(minutesOfDayInZone(occurrence.start, timeZone), locale);
  const endLabel = formatSlotLabel(minutesOfDayInZone(occurrence.end, timeZone), locale);
  return `${startLabel}${rangeSeparator}${endLabel}`;
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
 * セクション内アイテムのウィンドウ描画設定（{@link ListDaySectionProps.itemWindow}）。
 *
 * 描画範囲・詰め物（`sectionItemWindow` の結果）に、描画側で必要な情報を加えたもの。
 * `VirtualListView` が閾値超過セクションに対してのみ組み立てて渡す。
 */
export interface ListDayItemWindow extends SectionItemWindowResult {
  /**
   * イベント行 1 件の推定高（px）。範囲外に pinned で保持するアイテムを
   * スペーサー内で絶対配置する際の `top` の計算に使う。
   */
  estimateItemSize: number;
  /**
   * 範囲外でも描画を続けるオカレンスキー（フォーカス保持アイテム。通常 0〜1 件）。
   * 該当アイテムは上下スペーサー内に絶対配置され、`tabIndex=-1` でタブ順から外れる。
   */
  pinnedKeys?: ReadonlySet<string>;
}

/**
 * {@link ListDaySection} の props。
 *
 * `sectionRef` / `role` / `ariaLabel` / `ariaSetSize` / `ariaPosInSet` / `pinned` / `style` /
 * `itemWindow` は仮想化（`VirtualListView`）専用の任意項目で、省略時は `ListView` の従来 DOM と完全に一致する。
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
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
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
  renderEvent?: (occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent?: EventContentRenderer;
  /** 日付見出しの内容をカスタム描画する関数（第 2 引数の ctx に既定内容）。 */
  renderDayHeader?: (day: ListDay, ctx: SlotRenderContext) => ReactNode;
  /** 仮想化: 高さ実測用の ref コールバック。 */
  sectionRef?: Ref<HTMLElement>;
  /** 仮想化: `role="listitem"` を付与する。 */
  role?: 'listitem';
  /** 仮想化: 件数を伝える `aria-label`（例: 「7月16日(木) 予定3件」）。 */
  ariaLabel?: string;
  /**
   * 仮想化: ARIA list パターンの `aria-setsize`（全日セクション数）。
   * DOM 上には可視窓分の日セクションしか存在しないため、スクリーンリーダーが
   * 全体の集合サイズを把握できるよう明示する（{@link ariaPosInSet} とセットで使う）。
   */
  ariaSetSize?: number;
  /**
   * 仮想化: ARIA list パターンの `aria-posinset`（全日セクション中の絶対位置、1 始まり）。
   * 可視窓・pinned のいずれで描画されても、日付順の絶対位置を表す（可視範囲内の
   * 相対位置には振り直さない）。
   */
  ariaPosInSet?: number;
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
  /**
   * 仮想化: セクション内アイテムのウィンドウ描画設定。
   * 指定時は `startIndex`〜`endIndex` のイベント行だけを描画し、範囲の前後は
   * 高さ `topPad` / `bottomPad` のスペーサー（role なしの
   * `div[data-koyomi="list-event-spacer"]`）で置き換える。範囲内の各イベント行には
   * オカレンスキー属性 `data-koyomi-occurrence` が付き、`pinnedKeys` のアイテムは
   * 範囲外でもスペーサー内に絶対配置で描画され続ける（フォーカス保持）。
   * 省略時は全イベント行を描画する（`ListView` と同じ）。
   */
  itemWindow?: ListDayItemWindow;
}

/**
 * `EventOccurrence` の、リスト行の表示に影響する内容が等しいかどうかを比較する。
 * `time-grid-view.tsx` の `samePositionedOccurrence` と同じ観点（キー・タイトル・色・
 * 編集可否・開始/終了時刻）で比較する。
 */
function sameListOccurrence(a: EventOccurrence, b: EventOccurrence): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    a.event.title === b.event.title &&
    a.event.color === b.event.color &&
    a.event.editable === b.event.editable &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime()
  );
}

/** `EventOccurrence` 配列の内容が等しいかどうかを比較する。 */
function sameListOccurrences(
  a: readonly EventOccurrence[],
  b: readonly EventOccurrence[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((occurrence, index) => {
    const other = b[index];
    return other !== undefined && sameListOccurrence(occurrence, other);
  });
}

/**
 * `ListDay` の、日セクションの表示に影響する内容が等しいかどうかを比較する。
 *
 * `viewModel` は状態が変わるたびに丸ごと再構築されるため、既定の浅い比較（参照比較）
 * では無関係な変更（他の日の予定編集など）でも `day` が常に「変わった」ことになり
 * 意味がない（`time-grid-view.tsx` の `sameTimeGridDay` と同じ理由）。
 */
export function sameListDay(a: ListDay, b: ListDay): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key && a.isToday === b.isToday && sameListOccurrences(a.occurrences, b.occurrences)
  );
}

/** {@link ListDayItemWindow.pinnedKeys} の内容が等しいかどうかを比較する。 */
function samePinnedKeys(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.size !== b.size) {
    return false;
  }
  for (const key of a) {
    if (!b.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * {@link ListDayItemWindow} の内容が等しいかどうかを比較する。
 *
 * `VirtualListView` はスクロール位置に応じてこのオブジェクトを毎レンダー新規生成するため、
 * 既定の参照比較では描画範囲が変わっていなくても常に「変わった」ことになってしまう。
 */
export function sameListDayItemWindow(
  a: ListDayItemWindow | undefined,
  b: ListDayItemWindow | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return (
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.topPad === b.topPad &&
    a.bottomPad === b.bottomPad &&
    a.estimateItemSize === b.estimateItemSize &&
    samePinnedKeys(a.pinnedKeys, b.pinnedKeys)
  );
}

/**
 * リストビューの日セクション 1 件分（`<section>`＋日付見出し＋イベント行）を描画する。
 *
 * @param props - {@link ListDaySectionProps}
 * @returns 日セクションの要素
 */
function ListDaySectionImpl(props: ListDaySectionProps): ReactElement {
  const {
    day,
    timeZone,
    locale,
    defaultDayHeader,
    allDayLabel,
    commonMessages,
    onEventClick,
    onEventKeyDown,
    callbacks,
    renderEvent,
    renderEventContent,
    renderDayHeader,
    sectionRef,
    role,
    ariaLabel,
    ariaSetSize,
    ariaPosInSet,
    pinned,
    style,
    eventTabbable,
    itemWindow,
  } = props;

  /** イベント行 1 件を描画する（全件描画・ウィンドウ描画・pinned の全経路で使う）。 */
  const renderOccurrence = (
    occurrence: EventOccurrence,
    extra: { pinned?: boolean; style?: CSSProperties } = {},
  ): ReactElement => {
    // 既定内容の 3 部位（時刻・色見本・タイトル）。カスタム描画スロットへは
    // ctx.parts としてこのノードをそのまま渡し、並べ替え・差し込みでも
    // data-koyomi 部位（テーマ CSS のフック）が保たれるようにする
    const timeText = occurrence.allDay
      ? null
      : formatTimedEventTimeLabel(occurrence, timeZone, locale, commonMessages.rangeSeparator);
    const ctx = listEventContentContext({
      timeText,
      time: <span data-koyomi="list-event-time">{occurrence.allDay ? allDayLabel : timeText}</span>,
      swatch: (
        <span data-koyomi="list-event-swatch" style={eventSwatchStyle(occurrence.event.color)} />
      ),
      titleText: occurrence.event.title,
      title: <span data-koyomi="list-event-title">{occurrence.event.title}</span>,
    });
    return (
      <button
        key={occurrence.key}
        type="button"
        data-koyomi="list-event"
        onClick={(event) => onEventClick(occurrence, event)}
        onKeyDown={onEventKeyDown}
        aria-label={commonMessages.eventAriaLabel(occurrence, {
          rangeLabel: formatOccurrenceRangeLabel(
            occurrence,
            occurrence.allDay,
            timeZone,
            locale,
            commonMessages.rangeSeparator,
          ),
        })}
        {...(itemWindow !== undefined ? { 'data-koyomi-occurrence': occurrence.key } : {})}
        {...(extra.pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
        {...(extra.style !== undefined ? { style: extra.style } : {})}
        {...(eventTabbable === false || extra.pinned === true ? { tabIndex: -1 } : {})}
        {...eventNotificationProps(callbacks, occurrence)}
      >
        {resolveEventContent(renderEvent, renderEventContent, occurrence, occurrence, ctx)}
      </button>
    );
  };

  /**
   * ウィンドウ描画: 範囲内のイベント行と上下スペーサーを描画する。
   * `pinnedKeys` の範囲外アイテムは、そのアイテムの推定位置を含む側のスペーサー内に
   * 絶対配置で保持する（スペーサー高は推定高の合計と一致するため、スペーサー先頭からの
   * オフセットも同じ推定で求まる。通常フローに影響させないため絶対配置にする）。
   */
  const renderWindowedOccurrences = (window: ListDayItemWindow): ReactElement => {
    const { startIndex, endIndex, topPad, bottomPad, estimateItemSize, pinnedKeys } = window;
    const inRange: ReactElement[] = [];
    const pinnedBefore: ReactElement[] = [];
    const pinnedAfter: ReactElement[] = [];
    day.occurrences.forEach((occurrence, index) => {
      if (index >= startIndex && index <= endIndex) {
        inRange.push(renderOccurrence(occurrence));
        return;
      }
      if (pinnedKeys?.has(occurrence.key) !== true) {
        return;
      }
      const before = index < startIndex;
      const offset = (before ? index : index - endIndex - 1) * estimateItemSize;
      const target = before ? pinnedBefore : pinnedAfter;
      target.push(
        renderOccurrence(occurrence, {
          pinned: true,
          // 位置決めに必須のスタイルは inline で出力する（pinned 日セクションと同じ方針）
          style: {
            position: 'absolute',
            insetInlineStart: 0,
            width: '100%',
            top: `${offset}px`,
          },
        }),
      );
    });
    return (
      <>
        <div
          data-koyomi="list-event-spacer"
          data-edge="before"
          style={{ height: `${topPad}px`, position: 'relative' }}
        >
          {pinnedBefore}
        </div>
        {inRange}
        <div
          data-koyomi="list-event-spacer"
          data-edge="after"
          style={{ height: `${bottomPad}px`, position: 'relative' }}
        >
          {pinnedAfter}
        </div>
      </>
    );
  };

  return (
    <section
      ref={sectionRef}
      data-koyomi="list-day"
      data-koyomi-date={day.key}
      data-today={day.isToday ? 'true' : undefined}
      aria-current={day.isToday ? 'date' : undefined}
      {...(role !== undefined ? { role } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      {...(ariaSetSize !== undefined ? { 'aria-setsize': ariaSetSize } : {})}
      {...(ariaPosInSet !== undefined ? { 'aria-posinset': ariaPosInSet } : {})}
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      {...(style !== undefined ? { style } : {})}
    >
      <h3 data-koyomi="list-day-header">
        {renderDayHeader !== undefined
          ? renderDayHeader(day, { defaultContent: defaultDayHeader })
          : defaultDayHeader}
      </h3>
      {itemWindow === undefined
        ? day.occurrences.map((occurrence) => renderOccurrence(occurrence))
        : renderWindowedOccurrences(itemWindow)}
    </section>
  );
}

/**
 * {@link ListDaySectionImpl} を `memo` でラップしたもの。
 *
 * `viewModel` は状態が変わるたびに丸ごと再構築されるため、既定の浅い比較（参照比較）
 * では `day` が常に「変わった」ことになり意味がない。表示に影響する内容だけを
 * 比較するカスタム比較関数を使うことで、無関係な日の予定編集などで日セクションが
 * 再レンダーされないようにする（`time-grid-view.tsx` の `TimeGridDayColumn`、
 * `timeline-view.tsx` の `TimelineRowGroup` と同じ設計）。
 *
 * `sectionRef` / `role` / `ariaLabel` / `ariaSetSize` / `ariaPosInSet` / `pinned` / `style` /
 * `eventTabbable` は仮想化（`VirtualListView`）専用の props で、いずれも参照・値がレンダー間で
 * 安定している（`sectionRef` は `useVirtualizer` がキー単位でキャッシュしたコールバック、
 * `ariaLabel` 等の文字列・数値はプリミティブ値のため内容が同じなら `===` が成立する）ため
 * 単純な参照比較で十分。`itemWindow`（セクション内アイテムのウィンドウ描画設定）だけは
 * スクロールのたびに新規オブジェクトとして渡されるため、{@link sameListDayItemWindow} で
 * 内容を比較する。
 */
export const ListDaySection = memo(ListDaySectionImpl, (prev, next) => {
  return (
    sameListDay(prev.day, next.day) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.defaultDayHeader === next.defaultDayHeader &&
    prev.allDayLabel === next.allDayLabel &&
    prev.commonMessages === next.commonMessages &&
    prev.onEventClick === next.onEventClick &&
    prev.onEventKeyDown === next.onEventKeyDown &&
    prev.callbacks === next.callbacks &&
    prev.renderEvent === next.renderEvent &&
    prev.renderEventContent === next.renderEventContent &&
    prev.renderDayHeader === next.renderDayHeader &&
    prev.sectionRef === next.sectionRef &&
    prev.role === next.role &&
    prev.ariaLabel === next.ariaLabel &&
    prev.ariaSetSize === next.ariaSetSize &&
    prev.ariaPosInSet === next.ariaPosInSet &&
    prev.pinned === next.pinned &&
    prev.style === next.style &&
    prev.eventTabbable === next.eventTabbable &&
    sameListDayItemWindow(prev.itemWindow, next.itemWindow)
  );
});
