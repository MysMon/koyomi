/**
 * @packageDocumentation
 * `useCalendar` — カレンダーエンジンを React に接続するメインフック。
 */

import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, CalendarOptions } from '../core/types';
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
  /** 最新の `onEventsChange` を保持する参照。エンジンには安定ラッパのみを渡す。 */
  const onEventsChangeRef = useRef(options?.onEventsChange);
  onEventsChangeRef.current = options?.onEventsChange;

  /**
   * エンジンをマウント時に一度だけ生成する。
   * `options` は初回値のみが使われ、以後の変更は無視する
   * （`onEventsChange` だけは安定ラッパ経由で常に最新を呼ぶ）。
   */
  const apiRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  if (apiRef.current === null) {
    apiRef.current = createCalendar({
      ...options,
      onEventsChange: (events: readonly CalendarEvent[]) => {
        onEventsChangeRef.current?.(events);
      },
    });
  }
  const api = apiRef.current;

  const state = useSyncExternalStore(api.subscribe, api.getState);
  const viewModel = api.getViewModel();

  /**
   * `api` / `state` / `viewModel` はいずれも安定（不変なら参照が変わらない）だが、
   * それらを束ねるオブジェクト自体を毎レンダー新規生成すると、この戻り値を
   * 依存に使う下流のメモ化（`useMemo` / `React.memo` 等）が無効になってしまう。
   * 束ねたオブジェクトも `useMemo` で安定させ、中身が変わらない限り同一参照を返す。
   */
  return useMemo(() => ({ api, state, viewModel }), [api, state, viewModel]);
}
