/**
 * @packageDocumentation
 * カレンダーコンテキスト。
 *
 * `CalendarProvider` で {@link UseCalendarResult} とインタラクション
 * コールバックを配下のコンポーネント（`MonthView` など）に共有する。
 */

import type { ReactElement, ReactNode } from 'react';
import type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
  UseCalendarResult,
} from './types';

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
  void props;
  throw new Error('未実装');
}

/**
 * カレンダーコンテキストを取得する。
 *
 * @throws `CalendarProvider` の配下で呼ばれていない場合は `Error`
 */
export function useCalendarContext(): CalendarContextValue {
  throw new Error('未実装');
}
