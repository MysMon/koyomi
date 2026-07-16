/**
 * @packageDocumentation
 * カレンダーコンテキスト。
 *
 * `CalendarProvider` で {@link UseCalendarResult} とインタラクション
 * コールバックを配下のコンポーネント（`MonthView` など）に共有する。
 */

import type { ReactElement, ReactNode } from 'react';
import { createContext, createElement, useContext, useMemo } from 'react';
import { resolveMessageCatalog } from './locales/resolve';
import type { MessageCatalogOverrides } from './locales/types';
import type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
  EventContentRenderer,
  UseCalendarResult,
} from './types';

/**
 * カレンダーコンテキストの内部実体。
 * 利用者はこれを直接参照せず、`useCalendarContext` 経由でアクセスする。
 */
const CalendarContext = createContext<CalendarContextValue | null>(null);

/** `callbacks` 省略時に使う安定した空オブジェクト（毎レンダーで新規生成しない）。 */
const EMPTY_CALLBACKS: CalendarInteractionCallbacks = {};

/**
 * `CalendarProvider` の props。
 */
export interface CalendarProviderProps {
  /** `useCalendar` の戻り値。 */
  value: UseCalendarResult;
  /** インタラクションのコールバック集。 */
  callbacks?: CalendarInteractionCallbacks;
  /**
   * 中央メッセージカタログの部分上書き。
   *
   * `value.state.options.locale` の言語サブタグで選ばれる同梱カタログ
   * （`ja` / `en`、未対応言語は `ja` にフォールバック）へ、グループ単位で
   * 浅くマージされる。**呼び出しのたびに新しいオブジェクトを渡さず、安定した
   * 参照（コンポーネント外の定数、または `useMemo` の結果）で渡すこと**
   * （毎レンダー新規オブジェクトだとコンテキスト値の参照が安定せず、
   * 配下コンポーネントの不要な再レンダーを招く）。
   */
  messages?: MessageCatalogOverrides;
  /**
   * ビュー横断のイベント内容レンダラー。
   *
   * すべてのビューのイベント内容（帯・ブロック・行の内側）を 1 箇所で定義する。
   * `ctx.slot` で描画枠の種別（`'month-event'` / `'timegrid-event'` /
   * `'allday-event'` / `'list-event'` / `'timeline-item'`）を判別でき、
   * `ctx.defaultContent` / `ctx.parts` で既定の整形を再利用できる。
   * ビュー個別の `renderEvent` 系 render prop が指定されているスロットでは
   * そちらが優先される（個別 > 中央 > 既定）。
   *
   * `messages` と同じく、**毎レンダー新しい関数を渡さず、安定した参照
   * （コンポーネント外の関数、または `useCallback` の結果）で渡すこと**
   * （参照が変わるとコンテキスト値が変わり、配下コンポーネントの不要な
   * 再レンダーを招く）。
   */
  renderEventContent?: EventContentRenderer;
  /** 子要素。 */
  children?: ReactNode;
}

/**
 * カレンダーのコンテキストプロバイダ。
 *
 * ビルトインのビューコンポーネント（`CalendarView` / `MonthView` /
 * `TimeGridView` / `ListView` / `Toolbar`）はこのプロバイダの配下で使う。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar();
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick: openDetail }}>
 *     <Toolbar />
 *     <CalendarView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function CalendarProvider(props: CalendarProviderProps): ReactElement {
  const { value, callbacks, messages, renderEventContent, children } = props;
  const resolvedCallbacks = callbacks ?? EMPTY_CALLBACKS;
  const { api, state, viewModel } = value;

  const resolvedMessages = useMemo(
    () => resolveMessageCatalog(state.options.locale, messages),
    [state.options.locale, messages],
  );

  /**
   * 依存を `value` オブジェクトの参照ではなくフィールド単位（`api` / `state` /
   * `viewModel` / 解決済み `callbacks` / 解決済み `messages`）に分解する。
   * `value` は呼び出し側で毎レンダー新規生成されがちだが、中身が変わって
   * いなければコンテキスト値の参照を保ち、配下コンポーネントの不要な
   * 再レンダーを避ける。
   */
  const contextValue = useMemo<CalendarContextValue>(
    () => ({
      api,
      state,
      viewModel,
      callbacks: resolvedCallbacks,
      messages: resolvedMessages,
      renderEventContent,
    }),
    [api, state, viewModel, resolvedCallbacks, resolvedMessages, renderEventContent],
  );

  return createElement(CalendarContext, { value: contextValue }, children);
}

/**
 * カレンダーコンテキストを取得する。
 *
 * @throws `CalendarProvider` の配下で呼ばれていない場合は `Error`
 */
export function useCalendarContext(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (value === null) {
    throw new Error('useCalendarContext は CalendarProvider の配下で使用してください');
  }
  return value;
}
