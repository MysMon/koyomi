/**
 * @packageDocumentation
 * `useCalendar` — カレンダーエンジンを React に接続するメインフック。
 */

import type { CalendarOptions } from '../core/types';
import type { UseCalendarResult } from './types';

/**
 * カレンダーエンジンを作成し、React の状態として購読する。
 *
 * エンジン（{@link createCalendar}）はマウント時に一度だけ作成され、
 * `useSyncExternalStore` で購読される。状態が変わるたびに再レンダリングされ、
 * `state` / `viewModel` が新しいスナップショットになる。
 *
 * @param options - カレンダーのオプション。**初期値として一度だけ** 使われる
 *   （後から変更しても反映されない。動的に変更する場合は
 *   `api.updateOptions` / `api.setEvents` / `api.setTimeZone` を使う）。
 *   ただし `onEventsChange` コールバックは常に最新の関数が呼ばれる。
 * @returns {@link UseCalendarResult}
 *
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar({
 *     initialView: 'month',
 *     events: [{ id: '1', title: '会議', start: '2026-07-01T10:00' }],
 *   });
 *   return (
 *     <div>
 *       <button type="button" onClick={() => calendar.api.next()}>次へ</button>
 *       <CalendarProvider value={calendar}>
 *         <CalendarView />
 *       </CalendarProvider>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCalendar(options?: CalendarOptions): UseCalendarResult {
  void options;
  throw new Error('未実装');
}
