/**
 * @packageDocumentation
 * React 層の共有型定義。
 *
 * インタラクション（クリック・ドラッグ・キーボード）のコールバックの取り決めを定義する。
 * ライブラリはヘッドレスであり、ダイアログやポップアップなどの UI は提供しない。
 * 代わりにこれらのコールバックでアプリケーション側の UI に委譲する。
 */

import type {
  CalendarApi,
  CalendarState,
  CalendarViewModel,
  DateRange,
  EventChangeEntry,
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
