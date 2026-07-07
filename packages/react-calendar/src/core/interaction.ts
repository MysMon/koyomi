/**
 * @packageDocumentation
 * インタラクションの純粋計算。
 *
 * ドラッグによる予定の作成・移動・リサイズで必要になる
 * 「ポインタ位置 → 日時」の変換とプレビュー範囲の計算を、
 * DOM に依存しない純粋関数として提供する。React 層のフックは
 * ポインタイベントから座標割合を求め、このモジュールに委譲する。
 */

import type { DateRange, EventOccurrence, TimeZoneId } from './types';

/**
 * 分数を指定間隔にスナップする（最近傍への丸め）。
 *
 * @param minutes - 対象の分数
 * @param snap - スナップ間隔（分、1 以上）
 * @example
 * ```ts
 * snapToInterval(37, 15); // => 30
 * snapToInterval(38, 15); // => 45
 * ```
 */
export function snapToInterval(minutes: number, snap: number): number {
  void minutes;
  void snap;
  throw new Error('未実装');
}

/**
 * 時間グリッドの列内の縦位置（0〜1）から、その列の日における日時を計算する。
 *
 * 縦位置は列の高さ全体を 0:00〜24:00 に対応づけ、`snap` 間隔に
 * スナップした壁時計時刻を返す。結果は `[日の 0:00, 24:00 - snap]` に
 * クランプされる。
 *
 * @param params.day - 対象列の日の 0:00（絶対時刻）
 * @param params.fractionY - 列内の縦位置（0 = 0:00、1 = 24:00）
 * @param params.timeZone - 表示タイムゾーン
 * @param params.snap - スナップ間隔（分）
 */
export function timeAtGridPosition(params: {
  day: Date;
  fractionY: number;
  timeZone: TimeZoneId;
  snap: number;
}): Date {
  void params;
  throw new Error('未実装');
}

/**
 * 時間グリッドのドラッグ操作の種類。
 *
 * - `create` — 空き領域のドラッグによる新規作成
 * - `move` — イベント本体のドラッグによる移動
 * - `resize` — 下端ハンドルのドラッグによる終了時刻の変更
 */
export type TimeGridDragMode = 'create' | 'move' | 'resize';

/**
 * 時間グリッドのドラッグ操作の状態（開始時に固定される情報）。
 */
export interface TimeGridDragState {
  /** 操作の種類。 */
  mode: TimeGridDragMode;
  /** 対象の発生（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。 */
  anchor: Date;
}

/**
 * ドラッグ中のポインタ日時からプレビュー範囲を計算する。
 *
 * 計算ルール:
 * - `create` — `anchor` とポインタの早い方を開始、遅い方を終了とする。
 *   同時刻（クリック相当）の場合は `snap` 分の長さにする
 * - `move` — 発生の開始を「`anchor` からポインタまでの移動量」だけずらす。
 *   長さ（ミリ秒）は維持される
 * - `resize` — 発生の開始は固定し、終了をポインタ位置（スナップ済み）にする。
 *   最小でも `開始 + snap 分` の長さを保つ
 *
 * @param state - ドラッグ状態
 * @param pointer - 現在のポインタ位置に対応する日時（スナップ済み）
 * @param context.timeZone - 表示タイムゾーン
 * @param context.snap - スナップ間隔（分）
 * @returns プレビューの日時範囲
 */
export function dragPreviewRange(
  state: TimeGridDragState,
  pointer: Date,
  context: { timeZone: TimeZoneId; snap: number },
): DateRange {
  void state;
  void pointer;
  void context;
  throw new Error('未実装');
}

/**
 * 日単位ドラッグ（月ビュー・終日行）のプレビュー範囲を計算する。
 *
 * - `create` — アンカー日とポインタ日の早い方から遅い方まで（end は翌日 0:00 で排他）
 * - `move` — 発生の開始日を「アンカー日からポインタ日までの日数差」だけずらす。
 *   日数（期間）は維持される。時間指定イベントの場合は壁時計時刻も維持される
 *
 * @param state - ドラッグ状態（`resize` は日単位ドラッグでは未対応）
 * @param pointerDay - 現在ポインタが乗っている日の 0:00（絶対時刻）
 * @param anchorDay - ドラッグを開始した日の 0:00（絶対時刻）
 * @param timeZone - 表示タイムゾーン
 */
export function dayDragPreviewRange(
  state: { mode: 'create' | 'move'; occurrence: EventOccurrence | null },
  pointerDay: Date,
  anchorDay: Date,
  timeZone: TimeZoneId,
): DateRange {
  void state;
  void pointerDay;
  void anchorDay;
  void timeZone;
  throw new Error('未実装');
}

/**
 * キーボードショートカットの操作種別。Google カレンダーのショートカットに準拠する。
 */
export type CalendarShortcut =
  | { type: 'view'; view: 'month' | 'week' | 'day' | 'list' }
  | { type: 'today' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'create' };

/**
 * キー入力を Google カレンダー準拠のショートカットに解釈する。
 *
 * - `M` → 月、`W` → 週、`D` → 日、`A` → リスト（スケジュール）
 * - `T` → 今日
 * - `J` / `N` → 次の期間、`K` / `P` → 前の期間
 * - `C` → 予定作成
 *
 * 大文字小文字は区別しない。修飾キー（Ctrl/Meta/Alt）付きや
 * 該当しないキーは `null` を返す。
 *
 * @param key - `KeyboardEvent.key` の値
 * @param modifiers - 修飾キーの押下状態
 */
export function shortcutForKey(
  key: string,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): CalendarShortcut | null {
  void key;
  void modifiers;
  throw new Error('未実装');
}
