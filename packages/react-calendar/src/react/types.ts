/**
 * @packageDocumentation
 * React 層の共有型定義。
 *
 * インタラクション（クリック・ドラッグ・キーボード）のコールバックの取り決めを定義する。
 * ライブラリはヘッドレスであり、ダイアログやポップアップなどの UI は提供しない。
 * 代わりにこれらのコールバックでアプリケーション側の UI に委譲する。
 */

import type { ReactNode } from 'react';
import type {
  CalendarApi,
  CalendarState,
  CalendarViewModel,
  CalendarViewType,
  DateRange,
  EventChangeEntry,
  EventOccurrence,
  MonthDay,
  RecurringEditScope,
} from '../core/types';
import type { MessageCatalog } from './locales/types';

/**
 * すべてのカスタム描画スロット（render prop）に共通で渡されるコンテキスト。
 *
 * ビルトインコンポーネントの render prop はすべて `(item, ctx) => ReactNode` の
 * 形をとり、`ctx` には省略時にライブラリが描画する既定の内容
 * （{@link SlotRenderContext.defaultContent}）が必ず含まれる。既定内容をそのまま
 * 返せば省略時と同じ表示になり、前後に要素を足す・独自の要素でラップするといった
 * 「既定＋差分」のカスタマイズを、既定の整形を再構築せずに書ける。
 *
 * render prop が差し替えるのは**インタラクティブ要素の内側の内容だけ**である。
 * 外側の要素（`<button>` 等）と `data-koyomi-*` 属性・`aria-label`・
 * クリック/ドラッグの配線・リサイズハンドルはライブラリが常に保持する。
 *
 * @example
 * ```tsx
 * <MonthView
 *   renderDayCell={(day, ctx) => (
 *     <>
 *       {ctx.defaultContent}
 *       {day.isToday && <span data-holiday-badge>今日</span>}
 *     </>
 *   )}
 * />
 * ```
 */
export interface SlotRenderContext {
  /** 省略時にライブラリが描画する既定の内容。 */
  defaultContent: ReactNode;
}

/**
 * イベント内容スロットの種別。
 *
 * どの描画枠（外側要素の `data-koyomi` 部位名と同じ語彙）に対する描画かを表す。
 * {@link EventContentRenderer} でビュー横断のイベント内容を 1 箇所で定義するとき、
 * 描画枠に応じて内容を出し分ける判別子として使う。
 *
 * - `'month-event'` — 月ビュー・複数月ビューの帯
 * - `'timegrid-event'` — 週/日ビュー・リソースビューの時間指定ブロック
 * - `'allday-event'` — 週/日ビューの終日行の帯・リソースビューの終日アイテム
 * - `'list-event'` — リストビュー（仮想化含む）の予定行
 * - `'timeline-item'` — タイムラインビュー（仮想化含む）の帯
 */
export type EventContentSlot =
  | 'month-event'
  | 'timegrid-event'
  | 'allday-event'
  | 'list-event'
  | 'timeline-item';

/**
 * イベント内容スロットの既定内容を分解したパーツ。
 *
 * 「時刻とタイトルの順序を入れ替える」「間に追加情報を挟む」といった
 * 並べ替え・差し込みを、既定の時刻整形や `data-koyomi` 部位を自前で
 * 再構築せずに書くための部品。`xxxText` は整形済みの文字列、`time` /
 * `swatch` / `title` は既定内容を構成するノードそのもの。
 *
 * @example リストビューでタイトルの前に場所を出す
 * ```tsx
 * renderEvent={(occurrence, ctx) => (
 *   <>
 *     {ctx.parts.time}
 *     {ctx.parts.swatch}
 *     <span>{occurrence.event.location}</span>
 *     {ctx.parts.title}
 *   </>
 * )}
 * ```
 */
export interface EventContentParts {
  /**
   * 整形済みの時刻テキスト。形式はスロットにより異なる（月の帯は開始時刻
   * `'10:00'`、時間指定ブロック・リスト行・タイムラインの帯は範囲
   * `'10:00〜11:00'` 等）。タイムラインの帯は既定内容に時刻を表示しないが、
   * 時間指定イベントでは整形済みの範囲がここに渡る（複数日にまたがる場合は
   * 日付付き `'7月15日 22:00〜7月16日 2:00'`）。時刻を表示しないもの
   * （終日イベント・複数日にまたがる月の帯セグメントなど）では `null`。
   */
  timeText: string | null;
  /** タイトル文字列（`event.title` そのまま）。 */
  titleText: string;
  /**
   * 時刻の既定部位。リスト行では `data-koyomi="list-event-time"` の要素、
   * 部位要素を持たないスロットでは {@link EventContentParts.timeText} と同じ文字列。
   * 既定内容が時刻を表示しない場合は `null`。
   */
  time: ReactNode;
  /** 色見本の既定部位（リスト行の `data-koyomi="list-event-swatch"` のみ。他スロットは `null`）。 */
  swatch: ReactNode;
  /**
   * タイトルの既定部位。リスト行では `data-koyomi="list-event-title"` の要素、
   * 部位要素を持たないスロットではタイトル文字列そのもの。
   */
  title: ReactNode;
}

/**
 * イベント内容スロット（`renderEvent` 系 render prop と
 * {@link EventContentRenderer}）に渡されるコンテキスト。
 *
 * {@link SlotRenderContext.defaultContent} に加えて、描画枠の種別
 * （{@link EventContentContext.slot}）と分解済みパーツ
 * （{@link EventContentContext.parts}）を持つ。
 */
export interface EventContentContext extends SlotRenderContext {
  /** どの描画枠に対する描画か。 */
  slot: EventContentSlot;
  /**
   * どのビューでの描画か。
   *
   * 同じスロットを複数のビューが使うため（`'timegrid-event'` は週/日ビューと
   * リソースビュー、`'month-event'` は月ビューと複数月ビュー）、
   * {@link EventContentRenderer} でスロットが同じでもビューごとに内容を
   * 出し分けたいときの判別子として使う。
   */
  view: CalendarViewType;
  /** 既定内容を分解したパーツ。 */
  parts: EventContentParts;
}

/**
 * ビュー横断のイベント内容レンダラー（`CalendarProvider` の
 * `renderEventContent` prop）。
 *
 * すべてのビューのイベント内容を 1 箇所で定義する。ビュー個別の `renderEvent`
 * 系 render prop が指定されているスロットではそちらが優先され、どちらも
 * 無ければ既定内容が描画される（個別 > 中央 > 既定）。
 *
 * @param occurrence - 描画対象のオカレンス
 * @param ctx - 描画枠の種別・既定内容・分解済みパーツ
 * @returns イベント要素の内側に描画する内容
 * @example 全ビュー共通でタイトルの後ろに場所を添える
 * ```tsx
 * <CalendarProvider
 *   value={calendar}
 *   renderEventContent={(occurrence, ctx) => (
 *     <>
 *       {ctx.defaultContent}
 *       <span data-location>{occurrence.event.location}</span>
 *     </>
 *   )}
 * >
 * ```
 */
export type EventContentRenderer = (
  occurrence: EventOccurrence,
  ctx: EventContentContext,
) => ReactNode;

/**
 * `useCalendar` の戻り値。
 *
 * `state` / `viewModel` は React の再レンダリングと連動するスナップショットで、
 * `api` は安定参照のエンジン API（`useEffect` の依存に安全に使える）。
 */
export interface UseCalendarResult {
  /** カレンダーエンジンの API（参照は再レンダリングを跨いで安定）。 */
  api: CalendarApi;
  /** 現在の状態スナップショット。 */
  state: CalendarState;
  /** 現在のビューモデル。 */
  viewModel: CalendarViewModel;
}

/**
 * 範囲選択（クリック・ドラッグによる新規作成操作）の内容。
 */
export interface RangeSelection {
  /** 選択された日時範囲（`end` 排他）。 */
  range: DateRange;
  /** 終日枠（月ビューのセル・終日行）での選択かどうか。 */
  allDay: boolean;
  /**
   * 選択が行われたレーンのリソース ID。リソース/タイムラインビューでの
   * 選択時のみ設定される（`null` は未割り当てレーン）。既存ビューでは省略。
   */
  resourceId?: string | null;
}

/**
 * ドラッグ・リサイズによるイベント変更の内容。
 */
export interface EventChange {
  /** 変更対象のオカレンス。 */
  occurrence: EventOccurrence;
  /** 変更後の日時範囲。 */
  newRange: DateRange;
  /** 変更後に終日イベントになるか。 */
  allDay: boolean;
  /** 繰り返しイベントの場合に適用されたスコープ（単発は `null`）。 */
  scope: RecurringEditScope | null;
  /**
   * 変更後の割当先リソース ID。リソース/タイムラインビューでの変更時のみ
   * 設定される（`null` は未割り当てへの移動）。既存ビューでは省略。
   */
  resourceId?: string | null;
  /**
   * 影響を受けた各イベントの before/after 一覧（undo の実装に使う）。
   * 単発イベントの変更では対象イベント 1 件のみを含む。繰り返しイベントの
   * スコープ操作（`scope: 'this'` のオーバーライド生成、`scope: 'thisAndFollowing'`
   * のシリーズ分割）では、作成・変更されたイベントすべて（分割点以降の
   * オーバーライドの `recurringEventId` 付け替えを含む）を漏れなく含む。
   * `CalendarApi.updateEvent` の戻り値がそのまま渡される。
   *
   * ライブラリからの通知では常に値が入るため、意図的に必須フィールドにしている
   * （このペイロードを自前で構築しているテストコード等では、空配列 `[]` を渡せばよい）。
   */
  changes: readonly EventChangeEntry[];
}

/**
 * 適用前フック `onBeforeEventChange` に渡される、これから適用しようとしている
 * 変更（移動・リサイズ・終日⇔時間指定変換）の内容。
 *
 * FullCalendar の `eventAllow` に相当する。ドラッグ確定・キーボード操作いずれの
 * 経路でも、`resolveRecurringScope` による繰り返しスコープの問い合わせより
 * **前**に判定される。
 */
export interface EventChangeProposal {
  /** 変更しようとしている対象のオカレンス。 */
  occurrence: EventOccurrence;
  /** 適用しようとしている日時範囲。 */
  range: DateRange;
  /** 適用後に終日イベントになるか。 */
  allDay: boolean;
  /**
   * 適用後の割当先リソース ID。リソース/タイムラインビューでの変更時のみ
   * 設定される（`null` は未割り当てへの移動）。既存ビューでは省略。
   */
  resourceId?: string | null;
  /** 操作の種類。`'convert'` は終日 ⇔ 時間指定イベントの変換。 */
  action: 'move' | 'resize' | 'convert';
}

/**
 * キーボード操作（Delete/Backspace）によるイベント削除の内容。
 */
export interface EventDelete {
  /** 削除されたオカレンス。 */
  occurrence: EventOccurrence;
  /** 繰り返しイベントの場合に適用されたスコープ（単発は `null`）。 */
  scope: RecurringEditScope | null;
  /**
   * 影響を受けた各イベントの before/after 一覧（undo の実装に使う）。
   * 削除されたイベントは `after` を持たない。繰り返しイベントの `scope: 'this'` /
   * `'thisAndFollowing'` でマスターに EXDATE が追加された場合や、分割点以降の
   * オーバーライドが取り除かれた場合も、影響を受けたイベントすべてを漏れなく含む。
   * `CalendarApi.deleteEvent` の戻り値がそのまま渡される。
   *
   * ライブラリからの通知では常に値が入るため、意図的に必須フィールドにしている
   * （このペイロードを自前で構築しているテストコード等では、空配列 `[]` を渡せばよい）。
   */
  changes: readonly EventChangeEntry[];
}

/**
 * `onOverflowClick` の第 3 引数として渡す追加情報。
 *
 * 第 2 引数の `hiddenOccurrences`（「+N 件」に集約された非表示のオカレンス）と
 * 対になる情報として、その日で実際に表示中のオカレンスも渡す。両方を合わせると
 * その日の全オカレンスを「表示中／非表示」の区別付きで把握でき、ポップオーバーで
 * 全件を一覧表示する用途に使える。
 */
export interface OverflowClickDetails {
  /** その日で表示中（「+N 件」に集約されていない）のオカレンス一覧（開始時刻順）。 */
  visibleOccurrences: readonly EventOccurrence[];
}

/**
 * 月ビュー・複数月ビューの「+N 件」ボタンに追加する props。
 *
 * 自前のポップオーバー UI と組み合わせる際、ボタンがポップアップを持つこと
 * （`aria-haspopup`）や開閉状態（`aria-expanded`）を支援技術に伝えるために使う。
 * `MonthView` / `MultiMonthView` の `overflowButtonProps` から返す。
 */
export interface MonthOverflowButtonProps {
  /** ボタンが何らかのポップアップ要素を持つことを示す。 */
  'aria-haspopup'?: 'true' | 'dialog' | 'menu' | 'listbox' | 'tree' | 'grid';
  /** ポップアップの開閉状態。 */
  'aria-expanded'?: boolean;
  /** 開いたポップアップ要素の id（`aria-controls` として関連付ける）。 */
  'aria-controls'?: string;
}

/**
 * 月ビュー・複数月ビューの「+N 件」ラベルのカスタム描画スロット
 * （`MonthView` / `MultiMonthView` の `renderOverflowLabel`）に渡されるコンテキスト。
 *
 * {@link SlotRenderContext.defaultContent}（既定のラベル。中央メッセージカタログの
 * `month.overflow` / `multiMonth.overflow` で整形した「+N 件」）に加えて、
 * その日で「+N 件」に集約された非表示のオカレンス一覧を持つ。差し替えるのは
 * ボタンの内側の内容だけで、ボタン要素・クリック配線
 * （{@link CalendarInteractionCallbacks.onOverflowClick}）は常に保持される。
 *
 * @example 非表示のイベントを色付きドットで示す
 * ```tsx
 * <MonthView
 *   renderOverflowLabel={(day, ctx) => (
 *     <>
 *       {ctx.defaultContent}
 *       {ctx.hiddenOccurrences.map((occurrence) => (
 *         <span key={occurrence.key} data-dot style={{ background: occurrence.event.color }} />
 *       ))}
 *     </>
 *   )}
 * />
 * ```
 */
export interface MonthOverflowLabelContext extends SlotRenderContext {
  /** その日で「+N 件」に集約された非表示のオカレンス一覧（開始時刻順）。 */
  hiddenOccurrences: readonly EventOccurrence[];
}

/**
 * インタラクションのコールバック集。
 *
 * すべて省略可能で、省略時は次の既定動作になる:
 * - `onSelectRange` — 既定タイトル（既定 `'(タイトルなし)'`。各ビューは
 *   `messages.common.untitledEvent` を渡す）でイベントを即時作成する
 * - `onEventClick` — 何もしない
 * - `resolveRecurringScope` — `'this'`（この予定のみ）を返す
 * - `onEventChange` — 通知のみの用途（変更の適用はライブラリが行う）
 * - `onEventDelete` — 通知のみの用途（削除の適用はライブラリが行う）
 * - `onError` — console.error に出力する
 * - `onOverflowClick` — その日の日ビューに切り替える
 * - `onDayNumberClick` — その日の日ビューに切り替える
 * - `onBeforeEventChange` — 常に許可する（`true`）
 * - `onBeforeSelectRange` — 常に許可する（`true`）
 * - `onBeforeEventDelete` — 常に許可する（`true`）
 * - `onEventDoubleClick` / `onEventContextMenu` / `onEventHover` / `onEventHoverEnd` —
 *   何もしない（未指定時は対応する DOM イベントリスナー自体を要素に付けない）
 */
export interface CalendarInteractionCallbacks {
  /**
   * 予定がクリックされたときに呼ばれる。
   * 詳細表示や編集ダイアログの起点に使う。
   */
  onEventClick?: (occurrence: EventOccurrence, domEvent: MouseEvent) => void;
  /**
   * 予定がダブルクリックされたときに呼ばれる。
   * 詳細表示や編集ダイアログを直接開く起点に使う。
   *
   * 未指定の場合、対応する要素に `onDoubleClick` リスナー自体を付けない
   * （省略時は対応する DOM props 自体を付けない）。
   */
  onEventDoubleClick?: (occurrence: EventOccurrence, nativeEvent: MouseEvent) => void;
  /**
   * 予定が右クリック等でコンテキストメニュー操作されたときに呼ばれる
   * （`contextmenu` イベント）。
   *
   * ライブラリはこのコールバックを呼ぶだけで、ブラウザ既定のコンテキストメニューの
   * 抑制（`preventDefault`）は行わない。カスタムメニューを出す場合はアプリ側で
   * `nativeEvent.preventDefault()` を呼ぶこと。
   *
   * 未指定の場合、対応する要素に `onContextMenu` リスナー自体を付けない
   * （省略時は対応する DOM props 自体を付けない）。
   */
  onEventContextMenu?: (occurrence: EventOccurrence, nativeEvent: MouseEvent) => void;
  /**
   * ポインタが予定の要素に乗ったときに呼ばれる（`pointerenter` イベント）。
   * ツールチップ表示の起点に使う。
   *
   * 未指定の場合、対応する要素に `onPointerEnter` リスナー自体を付けない
   * （省略時は対応する DOM props 自体を付けない）。
   */
  onEventHover?: (occurrence: EventOccurrence, nativeEvent: MouseEvent) => void;
  /**
   * ポインタが予定の要素から離れたときに呼ばれる（`pointerleave` イベント）。
   * {@link CalendarInteractionCallbacks.onEventHover} で表示したツールチップを
   * 閉じる起点に使う。
   *
   * 未指定の場合、対応する要素に `onPointerLeave` リスナー自体を付けない
   * （省略時は対応する DOM props 自体を付けない）。
   */
  onEventHoverEnd?: (occurrence: EventOccurrence, nativeEvent: MouseEvent) => void;
  /**
   * 空き領域のクリック・ドラッグで範囲が選択されたときに呼ばれる。
   * 作成ダイアログの起点に使う。指定した場合、既定の即時作成は行われない。
   */
  onSelectRange?: (selection: RangeSelection) => void;
  /**
   * 空き領域のクリック・ドラッグによる範囲選択の適用前に呼ばれる
   * （FullCalendar の `selectAllow` に相当）。
   *
   * `false`（または `Promise<false>`）を返すと `onSelectRange` は呼ばれない
   * （省略時の既定の即時作成も行われない）。`true` または省略時は従来どおり
   * 選択が確定する。
   *
   * ドラッグ中のプレビュー表示はこの判定結果を反映しない（`pointerup` などで
   * 選択が確定するタイミングでのみ判定する）。
   *
   * @param selection - 選択された範囲
   */
  onBeforeSelectRange?: (selection: RangeSelection) => boolean | Promise<boolean>;
  /**
   * ドラッグ移動・リサイズが確定し、変更が適用された後に呼ばれる。
   */
  onEventChange?: (change: EventChange) => void;
  /**
   * ドラッグ移動・リサイズ・終日⇔時間指定変換の適用前に呼ばれる
   * （FullCalendar の `eventAllow` に相当）。
   *
   * `false`（または `Promise<false>`）を返すと変更は適用されず、
   * `onEventChange` も呼ばれない。ドラッグ操作はその場で静かに終了し、
   * キーボード操作（矢印キー等）では何も起きない。`true` または省略時は
   * 従来どおり変更が適用される。
   *
   * 繰り返しイベントの場合は `resolveRecurringScope` による適用範囲の
   * 問い合わせより**前**に判定される（拒否された場合はスコープの問い合わせ
   * 自体を行わない）。
   *
   * ドラッグ中のプレビュー表示はこの判定結果を反映しない（確定時にのみ
   * 判定する）。
   *
   * @param proposal - 適用しようとしている変更の内容
   */
  onBeforeEventChange?: (proposal: EventChangeProposal) => boolean | Promise<boolean>;
  /**
   * キーボード操作（Delete/Backspace）による削除が適用された後に呼ばれる。
   * undo（元に戻す）UI やトースト表示の起点に使う。
   */
  onEventDelete?: (deletion: EventDelete) => void;
  /**
   * キーボード操作（Delete/Backspace）による削除の適用前に呼ばれる。
   *
   * `false`（または `Promise<false>`）を返すと削除は適用されず、
   * `onEventDelete` も呼ばれない。確認ダイアログなど、ユーザーの応答を
   * 待つ必要がある UI 向けに `Promise` を返せる。`true` または省略時は
   * 従来どおり削除が適用される。
   *
   * 繰り返しイベントの場合は `resolveRecurringScope` による適用範囲の
   * 問い合わせより**前**に判定される（拒否された場合はスコープの問い合わせ
   * 自体を行わない）。
   *
   * @param occurrence - 削除しようとしているオカレンス
   */
  onBeforeEventDelete?: (occurrence: EventOccurrence) => boolean | Promise<boolean>;
  /**
   * インタラクション中の非同期処理（`resolveRecurringScope` や変更の適用）が
   * 例外を投げた場合に呼ばれる。省略時は console.error に出力される。
   */
  onError?: (error: unknown) => void;
  /**
   * 繰り返しイベントの変更・削除時に、適用範囲（この予定のみ / これ以降 /
   * すべて）を決めるために呼ばれる。ダイアログを表示して選択させる用途。
   * `null` を返すと操作はキャンセルされる。
   *
   * @param occurrence - 対象のオカレンス
   * @param action - 操作の種類
   */
  resolveRecurringScope?: (
    occurrence: EventOccurrence,
    action: 'move' | 'resize' | 'delete' | 'update',
  ) => Promise<RecurringEditScope | null>;
  /**
   * 月ビューの「+N 件」がクリックされたときに呼ばれる。
   *
   * @param day - 対象の日
   * @param hiddenOccurrences - その日で「+N 件」に集約された非表示のオカレンス一覧
   *   （開始時刻順）。ポップオーバーで隠れた予定を一覧表示する用途に使える
   * @param details - 追加情報（表示中のオカレンス一覧 `visibleOccurrences` など）。
   *   `hiddenOccurrences` と組み合わせることで、その日の全オカレンスを
   *   表示中／非表示の区別付きで取得できる
   */
  onOverflowClick?: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
    details: OverflowClickDetails,
  ) => void;
  /**
   * 月ビュー・複数月ビュー・年ビュー・週/日ビューの日番号ボタンがクリックされたときに呼ばれる。
   *
   * 指定した場合、既定の day ビューへの画面遷移（{@link CalendarApi.goTo} +
   * {@link CalendarApi.setView} による `'day'` への切り替え）は行われず、この
   * コールバックのみが呼ばれる。省略時は従来どおり day ビューへ切り替わる。
   *
   * @param date - クリックされた日番号ボタンが表す日
   */
  onDayNumberClick?: (date: Date) => void;
}

/**
 * `CalendarProvider` が配下のコンポーネントに提供するコンテキスト値。
 */
export interface CalendarContextValue extends UseCalendarResult {
  /** インタラクションのコールバック集（解決済み）。 */
  callbacks: CalendarInteractionCallbacks;
  /**
   * 解決済みの中央メッセージカタログ。
   *
   * `state.options.locale` と `CalendarProviderProps.messages` から
   * `resolveMessageCatalog` によって解決される。ビルトインのビュー
   * コンポーネントはこれを参照して文言を決定する。
   */
  messages: MessageCatalog;
  /**
   * ビュー横断のイベント内容レンダラー（`CalendarProviderProps.renderEventContent`）。
   * 未指定時は `undefined`。ビルトインのビューコンポーネントは、ビュー個別の
   * `renderEvent` 系 render prop が無いスロットでこれを使う（個別 > 中央 > 既定）。
   */
  renderEventContent: EventContentRenderer | undefined;
}

// re-export（React 層の利用者が core を直接 import しなくて済むように）
export type { CalendarApi, CalendarState, CalendarViewModel };
