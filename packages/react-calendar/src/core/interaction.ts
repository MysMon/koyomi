/**
 * @packageDocumentation
 * インタラクションの純粋計算。
 *
 * ドラッグによる予定の作成・移動・リサイズで必要になる
 * 「ポインタ位置 → 日時」の変換とプレビュー範囲の計算を、
 * DOM に依存しない純粋関数として提供する。React 層のフックは
 * ポインタイベントから座標割合を求め、このモジュールに委譲する。
 */

import { addDaysInZone, addMinutesInZone, dateKeyInZone } from './timezone';
import type { DateRange, EventOccurrence, TimeZoneId } from './types';

/** 1 日のミリ秒数。 */
const MS_PER_DAY = 86_400_000;

/** 1 日の分数。 */
const MINUTES_PER_DAY = 1440;

/**
 * スナップ間隔を正規化する。1 未満（0・負数・小数）は 1 として扱う。
 */
function normalizeSnap(snap: number): number {
  return snap < 1 ? 1 : snap;
}

/**
 * `'YYYY-MM-DD'` 形式の日付キーを UTC 0:00 のエポックミリ秒に変換する。
 *
 * タイムゾーンの UTC オフセット（DST 切り替えを含む）の影響を受けずに
 * 暦上の日数差を求めるための内部ヘルパ。
 */
function dateKeyToUtcMs(key: string): number {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

/**
 * 分数を指定間隔にスナップする（最近傍への丸め）。
 *
 * `snap` が 1 未満の場合は 1 として扱う。
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
  const interval = normalizeSnap(snap);
  return Math.round(minutes / interval) * interval;
}

/**
 * 時間グリッドの列内の縦位置（0〜1）から、その列の日における日時を計算する。
 *
 * 縦位置は列の高さ全体を 0:00〜24:00 に対応づけ、`snap` 間隔に
 * スナップした壁時計時刻を返す。結果は `[日の 0:00, 24:00 - snap]` に
 * クランプされる。
 *
 * 壁時計への分加算（{@link addMinutesInZone}）で日時化するため、
 * DST の切り替え日でも縦位置と壁時計時刻の対応が保たれる
 * （存在しない時刻は前方に解決される）。
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
  const { day, fractionY, timeZone, snap } = params;
  const interval = normalizeSnap(snap);
  const snapped = snapToInterval(fractionY * MINUTES_PER_DAY, interval);
  const minutes = Math.min(Math.max(snapped, 0), MINUTES_PER_DAY - interval);
  return addMinutesInZone(day, minutes, timeZone);
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
 * @throws `move` / `resize` で `state.occurrence` が `null` の場合は `Error`
 */
export function dragPreviewRange(
  state: TimeGridDragState,
  pointer: Date,
  context: { timeZone: TimeZoneId; snap: number },
): DateRange {
  const { timeZone, snap } = context;
  switch (state.mode) {
    case 'create': {
      const anchorMs = state.anchor.getTime();
      const pointerMs = pointer.getTime();
      if (anchorMs === pointerMs) {
        // クリック相当: snap 分の長さのプレビューにする
        const start = new Date(anchorMs);
        return { start, end: addMinutesInZone(start, snap, timeZone) };
      }
      return {
        start: new Date(Math.min(anchorMs, pointerMs)),
        end: new Date(Math.max(anchorMs, pointerMs)),
      };
    }
    case 'move': {
      if (state.occurrence === null) {
        throw new Error('move 操作には対象の発生（occurrence）が必要です');
      }
      // 移動量・長さとも絶対時刻（ミリ秒）で計算する
      const deltaMs = pointer.getTime() - state.anchor.getTime();
      const durationMs = state.occurrence.end.getTime() - state.occurrence.start.getTime();
      const startMs = state.occurrence.start.getTime() + deltaMs;
      return { start: new Date(startMs), end: new Date(startMs + durationMs) };
    }
    case 'resize': {
      if (state.occurrence === null) {
        throw new Error('resize 操作には対象の発生（occurrence）が必要です');
      }
      const start = new Date(state.occurrence.start.getTime());
      // 最小でも snap 分の長さを保つ
      const minEnd = addMinutesInZone(start, snap, timeZone);
      const end = pointer.getTime() > minEnd.getTime() ? new Date(pointer.getTime()) : minEnd;
      return { start, end };
    }
  }
}

/**
 * 日単位ドラッグ（月ビュー・終日行）のプレビュー範囲を計算する。
 *
 * - `create` — アンカー日とポインタ日の早い方から遅い方まで（end は翌日 0:00 で排他）
 * - `move` — 発生の開始日を「アンカー日からポインタ日までの日数差」だけずらす。
 *   日数（期間）は維持される。時間指定イベントの場合は壁時計時刻も維持される
 *
 * 日数差は日付キーを UTC に載せた差分で求めるため、DST 切り替えで
 * 1 日が 23/25 時間になっても暦上の日数として正しく計算される。
 *
 * @param state - ドラッグ状態（`resize` は日単位ドラッグでは未対応）
 * @param pointerDay - 現在ポインタが乗っている日の 0:00（絶対時刻）
 * @param anchorDay - ドラッグを開始した日の 0:00（絶対時刻）
 * @param timeZone - 表示タイムゾーン
 * @throws `move` で `state.occurrence` が `null` の場合は `Error`
 */
export function dayDragPreviewRange(
  state: { mode: 'create' | 'move'; occurrence: EventOccurrence | null },
  pointerDay: Date,
  anchorDay: Date,
  timeZone: TimeZoneId,
): DateRange {
  switch (state.mode) {
    case 'create': {
      // どちらも同じ TZ の 0:00 の絶対時刻なので、大小比較で日順が決まる
      const startDay = pointerDay.getTime() <= anchorDay.getTime() ? pointerDay : anchorDay;
      const endDay = pointerDay.getTime() <= anchorDay.getTime() ? anchorDay : pointerDay;
      return {
        start: new Date(startDay.getTime()),
        end: addDaysInZone(endDay, 1, timeZone),
      };
    }
    case 'move': {
      if (state.occurrence === null) {
        throw new Error('move 操作には対象の発生（occurrence）が必要です');
      }
      // 日数差は日付キー同士を UTC に載せて求める（DST 安全）
      const dayDiff =
        (dateKeyToUtcMs(dateKeyInZone(pointerDay, timeZone)) -
          dateKeyToUtcMs(dateKeyInZone(anchorDay, timeZone))) /
        MS_PER_DAY;
      return {
        start: addDaysInZone(state.occurrence.start, dayDiff, timeZone),
        end: addDaysInZone(state.occurrence.end, dayDiff, timeZone),
      };
    }
  }
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
  if (
    modifiers !== undefined &&
    (modifiers.ctrlKey === true || modifiers.metaKey === true || modifiers.altKey === true)
  ) {
    return null;
  }
  switch (key.toLowerCase()) {
    case 'm':
      return { type: 'view', view: 'month' };
    case 'w':
      return { type: 'view', view: 'week' };
    case 'd':
      return { type: 'view', view: 'day' };
    case 'a':
      return { type: 'view', view: 'list' };
    case 't':
      return { type: 'today' };
    case 'j':
    case 'n':
      return { type: 'next' };
    case 'k':
    case 'p':
      return { type: 'prev' };
    case 'c':
      return { type: 'create' };
    default:
      return null;
  }
}
