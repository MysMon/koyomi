/**
 * @packageDocumentation
 * `useCalendar` — カレンダーエンジンを React に接続するメインフック。
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, CalendarOptions } from '../core/types';
import type { UseCalendarResult } from './types';

/**
 * `useCalendar` のオプション。{@link CalendarOptions} に React 層固有の
 * 設定を加えたもの。
 */
export interface UseCalendarOptions extends CalendarOptions {
  /**
   * 指定秒数ごとに {@link CalendarApi.refresh} を呼び、「今日」の判定と
   * 現在時刻線を時間経過に追従させる。省略時（または 0 以下）は自動更新しない。
   * 現在時刻線の分解能は分単位なので、通常は `60` で十分。
   */
  refreshSeconds?: number;
}

/**
 * 開発ビルドかどうか。バンドラなしのブラウザ実行（`process` 未定義）では
 * 安全側に倒して開発扱いにする（警告は本番最適化ビルドでのみ除去される）。
 */
function isDevBuild(): boolean {
  return typeof process === 'undefined' || process.env['NODE_ENV'] !== 'production';
}

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
 *   ただし `onEventsChange` コールバックと `refreshSeconds` は例外で、
 *   常に最新の値が反映される。
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
export function useCalendar(options?: UseCalendarOptions): UseCalendarResult {
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

  // 「events はマウント時の初期値のみ有効」という仕様は、fetch した配列を
  // そのまま props として渡し続ける利用者が黙ってハマりやすい。開発時のみ、
  // 初回と異なる events 参照が渡されたことを一度だけ警告する。
  const initialEventsRef = useRef(options?.events);
  const warnedEventsRef = useRef(false);
  if (
    isDevBuild() &&
    !warnedEventsRef.current &&
    options?.events !== undefined &&
    options.events !== initialEventsRef.current
  ) {
    warnedEventsRef.current = true;
    // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
    console.warn(
      '[koyomi] useCalendar の options.events は初期値としてのみ使われ、マウント後の変更は反映されません。' +
        'イベントを動的に更新するには calendar.api.setEvents(nextEvents) を使ってください。',
    );
  }

  // 第三引数（getServerSnapshot）を渡すことで SSR（renderToString / Next.js 等）でも
  // 例外にならず初期スナップショットを描画できる。スナップショットは
  // キャッシュされた同一参照を返すため、サーバーレンダー中の一貫性も保たれる。
  const state = useSyncExternalStore(api.subscribe, api.getState, api.getState);
  const viewModel = api.getViewModel();

  // refreshSeconds による現在時刻の自動追従（0 以下なら何もしない）。
  // onEventsChange と同様に、レンダーごとの最新値が反映される
  const refreshSeconds = options?.refreshSeconds ?? 0;
  useEffect(() => {
    if (refreshSeconds <= 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      api.refresh();
    }, refreshSeconds * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [refreshSeconds, api]);

  /**
   * `api` / `state` / `viewModel` はいずれも安定（不変なら参照が変わらない）だが、
   * それらを束ねるオブジェクト自体を毎レンダー新規生成すると、この戻り値を
   * 依存に使う下流のメモ化（`useMemo` / `React.memo` 等）が無効になってしまう。
   * 束ねたオブジェクトも `useMemo` で安定させ、中身が変わらない限り同一参照を返す。
   */
  return useMemo(() => ({ api, state, viewModel }), [api, state, viewModel]);
}
