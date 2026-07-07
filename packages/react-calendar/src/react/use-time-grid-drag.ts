/**
 * @packageDocumentation
 * 時間グリッド（週/日ビュー）のドラッグインタラクション。
 *
 * - 空き領域のクリック / ドラッグ → 範囲選択（新規作成）
 * - イベント本体のドラッグ → 移動（列をまたぐ移動・スナップ対応）
 * - 下端ハンドルのドラッグ → リサイズ（終了時刻の変更）
 * - ドラッグ中は Escape でキャンセル
 *
 * プロップゲッターパターンを採用する。コンポーネントは
 * {@link TimeGridDragHandlers.getDayProps} などを対応する要素に
 * スプレッドするだけでインタラクションが有効になる。
 *
 * DOM 座標から日時への変換は、日列要素の矩形（`getBoundingClientRect`）と
 * {@link timeAtGridPosition} で行う。列要素は `getDayProps` が返す
 * `ref` コールバックで内部レジストリに登録される。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import type { PositionedOccurrence, TimeGridDay } from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 日列要素に付与する props。 */
export interface TimeGridDayProps {
  /** 列要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 日付キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-date': string;
}

/** イベントブロック要素に付与する props。 */
export interface TimeGridEventProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter = クリック相当、Delete = 削除）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** 発生キー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`（薄く表示するなどのスタイルフック）。 */
  'data-koyomi-dragging'?: 'true';
}

/** リサイズハンドル要素に付与する props。 */
export interface TimeGridResizeHandleProps {
  /** リサイズドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** スタイルフック。 */
  'data-koyomi-resize-handle': 'true';
}

/** 1 日分のドラッグプレビューの表示位置。 */
export interface TimeGridPreviewSegment {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 日内の表示開始（分）。 */
  startMinutes: number;
  /** 日内の表示終了（分、排他）。 */
  endMinutes: number;
}

/** `useTimeGridDrag` が返すハンドラ集。 */
export interface TimeGridDragHandlers {
  /** 日列要素用の props を返す。 */
  getDayProps(day: TimeGridDay): TimeGridDayProps;
  /** イベントブロック用の props を返す。 */
  getEventProps(item: PositionedOccurrence): TimeGridEventProps;
  /** リサイズハンドル用の props を返す。 */
  getResizeHandleProps(item: PositionedOccurrence): TimeGridResizeHandleProps;
  /**
   * 指定日のドラッグプレビュー区間を返す（その日に重ならなければ `null`）。
   * コンポーネントはこれをオーバーレイとして描画する。
   */
  previewFor(day: TimeGridDay): TimeGridPreviewSegment | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/**
 * 時間グリッドのドラッグインタラクションを提供するフック。
 *
 * 変更の適用はライブラリが行う（`api.updateEvent` 相当）。繰り返し
 * イベントの場合は `callbacks.resolveRecurringScope` でスコープを解決し、
 * `null` が返ればキャンセルする。適用後に `callbacks.onEventChange` を呼ぶ。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 */
export function useTimeGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimeGridDragHandlers {
  void params;
  throw new Error('未実装');
}
