/**
 * @packageDocumentation
 * イベント内容スロットの共通ヘルパー。
 *
 * 各ビューのイベント要素（`month-event` / `timegrid-event` / `allday-event` /
 * `list-event` / `timeline-item`）がカスタム描画スロットへ渡す
 * {@link EventContentContext} の組み立てと、「ビュー個別の render prop >
 * 中央 `renderEventContent` > 既定内容」という解決順序をここに集約する。
 * これにより、コンテキストの形と解決順序がすべてのビューで完全に一致する。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

import type { ReactNode } from 'react';
import type { CalendarViewType, EventOccurrence } from '../../core/types';
import type { EventContentContext, EventContentRenderer, EventContentSlot } from '../types';

/**
 * 「時刻テキスト＋半角スペース＋タイトル」型スロットのコンテキストを組み立てる。
 *
 * 月ビューの帯（開始時刻）・時間グリッドのブロック（時刻範囲）・リソースビューの
 * 時間指定ブロック（時刻範囲）が使う。部位要素を持たないスロットのため、
 * `parts.time` / `parts.title` はテキストそのものになる。
 *
 * @param slot - 描画枠の種別
 * @param view - どのビューでの描画か
 * @param timeText - 整形済みの時刻テキスト
 * @param titleText - タイトル文字列
 * @returns 組み立てたコンテキスト
 */
export function timedTextEventContentContext(
  slot: EventContentSlot,
  view: CalendarViewType,
  timeText: string,
  titleText: string,
): EventContentContext {
  return {
    slot,
    view,
    defaultContent: `${timeText} ${titleText}`,
    parts: { timeText, titleText, time: timeText, swatch: null, title: titleText },
  };
}

/**
 * タイトルのみ型スロットのコンテキストを組み立てる。
 *
 * 終日の帯（`allday-event`）・タイムラインの帯（`timeline-item`）・月ビューの
 * 終日/複数日セグメントなど、既定内容が時刻を表示しないスロットが使う。
 *
 * @param slot - 描画枠の種別
 * @param view - どのビューでの描画か
 * @param titleText - タイトル文字列
 * @param timeText - 整形済みの時刻テキスト。既定内容には表示しないが、
 *   `parts.timeText` / `parts.time` としてカスタム描画から差し込めるようにする
 *   （タイムラインの帯の時間指定イベントが使う）。時刻を持たないスロットでは省略する
 * @returns 組み立てたコンテキスト
 */
export function titleOnlyEventContentContext(
  slot: EventContentSlot,
  view: CalendarViewType,
  titleText: string,
  timeText: string | null = null,
): EventContentContext {
  return {
    slot,
    view,
    defaultContent: titleText,
    parts: { timeText, titleText, time: timeText, swatch: null, title: titleText },
  };
}

/** {@link listEventContentContext} の引数。 */
export interface ListEventContentContextArgs {
  /** 整形済みの時刻テキスト（終日イベントは `null`）。 */
  timeText: string | null;
  /** 時刻の既定部位（`data-koyomi="list-event-time"` の要素）。 */
  time: ReactNode;
  /** 色見本の既定部位（`data-koyomi="list-event-swatch"` の要素）。 */
  swatch: ReactNode;
  /** タイトル文字列。 */
  titleText: string;
  /** タイトルの既定部位（`data-koyomi="list-event-title"` の要素）。 */
  title: ReactNode;
}

/**
 * リスト行スロット（`list-event`）のコンテキストを組み立てる。
 *
 * リスト行の既定内容は時刻・色見本・タイトルの 3 部位要素で構成されるため、
 * 各部位のノードをそのまま `parts` として渡す。既定内容はその 3 部位を
 * 時刻 → 色見本 → タイトルの順で並べたものになる。
 *
 * @param args - 各部位のノードとテキスト
 * @returns 組み立てたコンテキスト
 */
export function listEventContentContext(args: ListEventContentContextArgs): EventContentContext {
  const { timeText, time, swatch, titleText, title } = args;
  return {
    slot: 'list-event',
    // リスト行スロットはリストビュー（仮想化含む）専用のため、ビューは固定
    view: 'list',
    defaultContent: (
      <>
        {time}
        {swatch}
        {title}
      </>
    ),
    parts: { timeText, titleText, time, swatch, title },
  };
}

/**
 * イベント内容スロットの表示内容を解決する。
 *
 * 解決順序は「ビュー個別の render prop > 中央 {@link EventContentRenderer} >
 * 既定内容（`ctx.defaultContent`）」。この順序はすべてのビューで共通の仕様であり、
 * 各ビューはこの関数を経由して内容を決定する。
 *
 * @param renderEvent - ビュー個別の render prop（`renderEvent` / `renderAllDayEvent` /
 *   `renderAllDayItem` のいずれか）
 * @param renderEventContent - `CalendarProvider` の中央イベント内容レンダラー
 * @param item - ビュー固有のアイテム（`EventSegment` / `PositionedOccurrence` /
 *   `TimelineItem` / `EventOccurrence`）
 * @param occurrence - 対象のオカレンス
 * @param ctx - 組み立て済みのコンテキスト
 * @returns イベント要素の内側に描画する内容
 */
export function resolveEventContent<TItem>(
  renderEvent: ((item: TItem, ctx: EventContentContext) => ReactNode) | undefined,
  renderEventContent: EventContentRenderer | undefined,
  item: TItem,
  occurrence: EventOccurrence,
  ctx: EventContentContext,
): ReactNode {
  if (renderEvent !== undefined) {
    return renderEvent(item, ctx);
  }
  if (renderEventContent !== undefined) {
    return renderEventContent(occurrence, ctx);
  }
  return ctx.defaultContent;
}
