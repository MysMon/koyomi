/**
 * @packageDocumentation
 * React 層の共有型定義。
 *
 * インタラクション（クリック・ドラッグ・キーボード）のコールバック契約を定義する。
 * ライブラリはヘッドレスであり、ダイアログやポップアップなどの UI は提供しない。
 * 代わりにこれらのコールバックでアプリケーション側の UI に委譲する。
 */

import type {
  CalendarApi,
  CalendarState,
  CalendarViewModel,
  DateRange,
  EventOccurrence,
  MonthDay,
  RecurringEditScope,
} from '../core/types';

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
}

/**
 * ドラッグ・リサイズによるイベント変更の内容。
 */
export interface EventChange {
  /** 変更対象の発生。 */
  occurrence: EventOccurrence;
  /** 変更後の日時範囲。 */
  newRange: DateRange;
  /** 変更後に終日イベントになるか。 */
  allDay: boolean;
  /** 繰り返しイベントの場合に適用されたスコープ（単発は `null`）。 */
  scope: RecurringEditScope | null;
}

/**
 * キーボード操作（Delete/Backspace）によるイベント削除の内容。
 */
export interface EventDelete {
  /** 削除された発生。 */
  occurrence: EventOccurrence;
  /** 繰り返しイベントの場合に適用されたスコープ（単発は `null`）。 */
  scope: RecurringEditScope | null;
}

/**
 * インタラクションのコールバック集。
 *
 * すべて省略可能で、省略時は次の既定動作になる:
 * - `onSelectRange` — {@link CalendarOptions.defaultEventTitle}
 *   （既定 `'(タイトルなし)'`）のタイトルでイベントを即時作成する
 * - `onEventClick` — 何もしない
 * - `resolveRecurringScope` — `'this'`（この予定のみ）を返す
 * - `onEventChange` — 通知のみの用途（変更の適用はライブラリが行う）
 * - `onEventDelete` — 通知のみの用途（削除の適用はライブラリが行う）
 * - `onError` — console.error に出力する
 * - `onOverflowClick` — その日の日ビューに切り替える
 */
export interface CalendarInteractionCallbacks {
  /**
   * 予定がクリックされたときに呼ばれる。
   * 詳細表示や編集ダイアログの起点に使う。
   */
  onEventClick?: (occurrence: EventOccurrence, domEvent: MouseEvent) => void;
  /**
   * 空き領域のクリック・ドラッグで範囲が選択されたときに呼ばれる。
   * 作成ダイアログの起点に使う。指定した場合、既定の即時作成は行われない。
   */
  onSelectRange?: (selection: RangeSelection) => void;
  /**
   * ドラッグ移動・リサイズが確定し、変更が適用された後に呼ばれる。
   */
  onEventChange?: (change: EventChange) => void;
  /**
   * キーボード操作（Delete/Backspace）による削除が適用された後に呼ばれる。
   * undo（元に戻す）UI やトースト表示の起点に使う。
   */
  onEventDelete?: (deletion: EventDelete) => void;
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
   * @param occurrence - 対象の発生
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
   * @param hiddenOccurrences - その日で「+N 件」に集約された非表示の発生一覧
   *   （開始時刻順）。ポップオーバーで隠れた予定を一覧表示する用途に使える
   */
  onOverflowClick?: (day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => void;
}

/**
 * `CalendarProvider` が配下のコンポーネントに提供するコンテキスト値。
 */
export interface CalendarContextValue extends UseCalendarResult {
  /** インタラクションのコールバック集（解決済み）。 */
  callbacks: CalendarInteractionCallbacks;
}

// re-export（React 層の利用者が core を直接 import しなくて済むように）
export type { CalendarApi, CalendarState, CalendarViewModel };
