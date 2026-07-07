/**
 * @packageDocumentation
 * 日単位のドラッグインタラクション（月ビューのセル・終日行）。
 *
 * - セルのクリック / ドラッグ → 日範囲の選択（終日イベントの新規作成）
 * - 帯セグメントのドラッグ → 日単位の移動（期間・壁時計時刻は維持）
 * - ドラッグ中は Escape でキャンセル
 *
 * 時間グリッドと同様のプロップゲッターパターン。セル要素は
 * `getDayCellProps` の `ref` でレジストリに登録され、ポインタ座標から
 * 現在乗っている日を判定する。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import type { DateRange, EventSegment } from '../core/types';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 日セル要素に付与する props。 */
export interface DayCellProps {
  /** セル要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空きセルでの作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 日付キー。 */
  'data-koyomi-date': string;
}

/** 帯セグメント要素に付与する props。 */
export interface SegmentProps {
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
  /** ドラッグ中の対象なら `'true'`。 */
  'data-koyomi-dragging'?: 'true';
}

/** `useDayDrag` が返すハンドラ集。 */
export interface DayDragHandlers {
  /** 日セル用の props を返す。 */
  getDayCellProps(day: { date: Date; key: string }): DayCellProps;
  /** 帯セグメント用の props を返す。 */
  getSegmentProps(segment: EventSegment): SegmentProps;
  /**
   * 現在のドラッグプレビューの日範囲（日 0:00 起点、`end` 排他）。
   * コンポーネントは各週に投影してハイライトを描画する。
   */
  previewRange: DateRange | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/**
 * 日単位ドラッグのインタラクションを提供するフック。
 *
 * 月ビューでは時間指定イベントの帯（span 1）も日単位で移動できる
 * （Google カレンダーの月ビューと同じ。壁時計時刻は維持される）。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 */
export function useDayDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): DayDragHandlers {
  void params;
  throw new Error('未実装');
}
