/**
 * @packageDocumentation
 * カレンダーコンテキスト。
 *
 * `CalendarProvider` で {@link UseCalendarResult} とインタラクション
 * コールバックを配下のコンポーネント（`MonthView` など）に共有する。
 */

import type { ReactElement, ReactNode } from 'react';
import { createContext, createElement, useContext, useMemo } from 'react';
import type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
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
  const { value, callbacks, children } = props;
  const resolvedCallbacks = callbacks ?? EMPTY_CALLBACKS;
  const { api, state, viewModel } = value;

  /**
   * 依存を `value` オブジェクトの参照ではなくフィールド単位（`api` / `state` /
   * `viewModel` / 解決済み `callbacks`）に分解する。`value` は呼び出し側で
   * 毎レンダー新規生成されがちだが、中身が変わっていなければコンテキスト値の
   * 参照を保ち、配下コンポーネントの不要な再レンダーを避ける。
   */
  const contextValue = useMemo<CalendarContextValue>(
    () => ({ api, state, viewModel, callbacks: resolvedCallbacks }),
    [api, state, viewModel, resolvedCallbacks],
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
