/**
 * @packageDocumentation
 * カレンダーエンジン（フレームワーク非依存）。
 *
 * カレンダーの状態（ビュー・基準日・タイムゾーン・イベント・ドラッグプレビュー）を
 * 保持し、購読モデルで変更を通知する。React からは `useCalendar` フックが
 * `useSyncExternalStore` でこのエンジンを購読する。
 *
 * 状態の変更操作は {@link ../mutations} の純粋関数に委譲し、
 * ビューモデルの構築は {@link ../views} の各ビルダーに委譲する。
 */

import type { CalendarApi, CalendarOptions } from './types';

/**
 * カレンダーエンジンを作成する。
 *
 * @param options - カレンダーのオプション（省略時はすべて既定値）
 * @returns カレンダー API（{@link CalendarApi}）
 *
 * @remarks
 * - `getState()` が返すスナップショットは、状態が変わらない限り同一の
 *   オブジェクト参照を返す（`useSyncExternalStore` との整合のため）
 * - `getViewModel()` の結果は状態が変わるまでキャッシュされる
 * - イベントの変更操作（create/update/delete/setEvents）が行われるたびに
 *   {@link CalendarOptions.onEventsChange} が呼ばれる
 * - `createEvent` で `id` を省略した場合は `'koyomi-1'` のような連番 ID を
 *   採番する（既存 ID と衝突しない番号まで進む）
 *
 * @example
 * ```ts
 * const calendar = createCalendar({
 *   initialView: 'month',
 *   timeZone: 'Asia/Tokyo',
 *   events: [{ id: '1', title: '会議', start: '2026-07-01T10:00', end: '2026-07-01T11:00' }],
 * });
 * const unsubscribe = calendar.subscribe(() => {
 *   console.log('状態が変わりました', calendar.getState().view);
 * });
 * calendar.setView('week');
 * ```
 */
export function createCalendar(options?: CalendarOptions): CalendarApi {
  void options;
  throw new Error('未実装');
}
