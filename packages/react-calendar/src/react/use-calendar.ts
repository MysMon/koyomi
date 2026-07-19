/**
 * @packageDocumentation
 * `useCalendar` — カレンダーエンジンを React に接続するメインフック。
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createCalendar } from '../core/calendar';
import type { CalendarEvent, CalendarOptions, CalendarRangeChangeInfo } from '../core/types';
import { warnIfLowContrastEventColor } from './event-color-contrast';
import { isDevBuild } from './is-dev-build';
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
 * カレンダーエンジンを作成し、React の状態として購読する。
 *
 * エンジン（{@link createCalendar}）はマウント時に一度だけ作成され、
 * `useSyncExternalStore` で購読される。状態が変わるたびに再レンダリングされ、
 * `state` / `viewModel` が新しいスナップショットになる。
 *
 * @param options - カレンダーのオプション。**初期値として一度だけ** 使われる
 *   （後から変更しても反映されない。動的に変更する場合は
 *   `api.updateOptions` / `api.setEvents` / `api.setTimeZone` を使う）。
 *   ただし `onEventsChange` / `onRangeChange` コールバックと `refreshSeconds` は
 *   例外で、常に最新の値が反映される。
 *
 * `onRangeChange` はマウント後（`useEffect` 内）に登録され、登録直後に現在の
 * ビュー・基準日・表示範囲で 1 回呼ばれる。そのためレンダー中や SSR
 * （`renderToString`）では呼ばれない。以後は `setView` / `goTo` / `next` /
 * `prev` など表示範囲に影響する操作のたびに呼ばれる。
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

  /** 最新の `onRangeChange` を保持する参照。マウント後の effect から安定ラッパ経由で登録する。 */
  const onRangeChangeRef = useRef(options?.onRangeChange);
  onRangeChangeRef.current = options?.onRangeChange;

  /**
   * エンジンをマウント時に一度だけ生成する。
   * `options` は初回値のみが使われ、以後の変更は無視する
   * （`onEventsChange` / `onRangeChange` だけは安定ラッパ経由で常に最新を呼ぶ）。
   *
   * `onRangeChange` はここでは渡さない。`createCalendar` は作成直後に
   * `onRangeChange` を同期的に呼ぶため、ここで渡すとレンダー本体（あるいは
   * SSR 中）に副作用が発生してしまう。代わりにマウント後の `useEffect` で
   * 登録する（下記）。
   */
  const apiRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  if (apiRef.current === null) {
    // options.onRangeChange はスプレッドに含めない（下の effect が登録するまで未設定にする）
    const { onRangeChange: _initialOnRangeChange, ...engineOptions } = options ?? {};
    apiRef.current = createCalendar({
      ...engineOptions,
      onEventsChange: (events: readonly CalendarEvent[]) => {
        onEventsChangeRef.current?.(events);
      },
    });
  }
  const api = apiRef.current;

  // onRangeChange はマウント後に登録し、登録直後に現在の表示範囲を 1 回通知する。
  // レンダー中・SSR では副作用を起こさないため。アンマウント時は解除する。
  // Strict Mode の開発時再マウントでは、このエフェクトも再実行される
  // （解除 → 再登録・再通知）。これは effect の標準的な挙動であり、
  // 初期通知が複数回になり得る点は許容する。
  useEffect(() => {
    const rangeChangeWrapper = (info: CalendarRangeChangeInfo) => {
      onRangeChangeRef.current?.(info);
    };
    api.updateOptions({ onRangeChange: rangeChangeWrapper });
    api.notifyRangeChange();
    return () => {
      api.updateOptions({ onRangeChange: null });
    };
  }, [api]);

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

  // resources も events と同じ「初期値のみ有効」仕様のため、同様に一度だけ警告する
  const initialResourcesRef = useRef(options?.resources);
  const warnedResourcesRef = useRef(false);
  if (
    isDevBuild() &&
    !warnedResourcesRef.current &&
    options?.resources !== undefined &&
    options.resources !== initialResourcesRef.current
  ) {
    warnedResourcesRef.current = true;
    // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
    console.warn(
      '[koyomi] useCalendar の options.resources は初期値としてのみ使われ、マウント後の変更は反映されません。' +
        'リソースを動的に更新するには calendar.api.setResources(nextResources) を使ってください。',
    );
  }

  // 第三引数（getServerSnapshot）を渡すことで SSR（renderToString / Next.js 等）でも
  // 例外にならず初期スナップショットを描画できる。スナップショットは
  // キャッシュされた同一参照を返すため、サーバーレンダー中の一貫性も保たれる。
  const state = useSyncExternalStore(api.subscribe, api.getState, api.getState);
  const viewModel = api.getViewModel();

  // event.color / resource.color の WCAG AA コントラスト警告（開発ビルド限定）。
  // 同じ色を何度も警告しないよう、警告済みの色をマウント中保持する Set に積む
  // （docs/accessibility.md 参照）。
  const warnedColorsRef = useRef<Set<string> | null>(null);
  if (isDevBuild()) {
    warnedColorsRef.current ??= new Set();
    const warned = warnedColorsRef.current;
    for (const event of state.events) {
      if (event.color !== undefined) {
        warnIfLowContrastEventColor(event.color, warned);
      }
    }
    for (const resource of state.resources) {
      if (resource.color !== undefined) {
        warnIfLowContrastEventColor(resource.color, warned);
      }
    }
  }

  // refreshSeconds による現在時刻の自動追従（0 以下なら何もしない）。
  // onEventsChange と同様に、レンダーごとの最新値が反映される
  const refreshSeconds = options?.refreshSeconds ?? 0;
  useEffect(() => {
    // 有限かつ正のときだけ自動更新する。NaN / Infinity / 0 以下は無効
    // （NaN は `<= 0` を通り抜けて setInterval(NaN)=実質 0ms の暴走ループになるため明示排除）。
    if (!Number.isFinite(refreshSeconds) || refreshSeconds <= 0) {
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
