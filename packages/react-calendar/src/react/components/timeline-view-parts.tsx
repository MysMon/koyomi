/**
 * @packageDocumentation
 * タイムラインビューの内部共有ヘルパー。
 *
 * `TimelineView`（`./timeline-view`）と、その行仮想化版 `VirtualTimelineView`
 * （`./virtual-timeline-view`）の両方が使う、DOM 構造に依存しない小さな
 * ヘルパー・定数・比較関数（`memo` 用）をここに集約する。これにより
 * 「片方だけ修正して挙動が乖離する」（例: 比較関数への新フィールド追加漏れ）
 * を防ぐ（`month-view-parts.tsx` と同じ狙い）。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 *
 * `TimelineRowGroupImpl`（行見出し + 帯トラック本体）は、仮想化版が高さ実測用の
 * `rowRef` / 窓外フォーカス保持の `pinned` / 絶対配置の `style` / タブ順制御の
 * `itemTabbable` という仮想化専用の追加 props を持つため、DOM 構造・props が
 * 完全には一致しない。無理に統合せずそれぞれのファイルに残している。
 */

import type { CSSProperties, Ref } from 'react';
import { useRef, useState } from 'react';
import type {
  BusinessHourRange,
  CalendarResource,
  TimelineItem,
  TimelineRow,
} from '../../core/types';
import type { TimelineDragHandlers, TimelinePreviewSegment } from '../use-timeline-drag';

/** 1 日の分（24:00 = 1440 分）。 */
export const MINUTES_PER_DAY = 1440;

/** 未割り当て行の既定ラベル。 */
export const DEFAULT_UNASSIGNED_LABEL = '未割り当て';

/** 空状態の既定メッセージ。 */
export const DEFAULT_EMPTY_LABEL = 'リソースがありません';

/** ヘッダー行の角セル（行見出し列の列見出し）の既定 `aria-label`。 */
export const DEFAULT_CORNER_LABEL = 'リソース';

/**
 * `Ref<HTMLElement>` を `<div>` にそのまま渡せるコールバック ref に変換する
 * （`month-view-parts.tsx` の同名ヘルパと同じ橋渡し）。
 */
export function toDivRef(ref: Ref<HTMLElement>): (element: HTMLDivElement | null) => void {
  return (element) => {
    if (typeof ref === 'function') {
      ref(element);
      return;
    }
    if (ref !== null) {
      // React 18 の型定義では RefObject.current が readonly になるため、
      // 直接代入の代わりに Object.assign で書き込む（ref オブジェクト自体は実行時には可変）。
      Object.assign(ref, { current: element });
    }
  };
}

/**
 * レーン数を CSS 変数 `--koyomi-timeline-lanes` として style に加える。
 * 行の高さ計算のフック（テーマ CSS が参照する数値）で、位置決めの数値のみを
 * inline に出す既存規約の範囲内。
 */
export function withLaneCountStyle(laneCount: number): CSSProperties {
  // 'as' 使用理由: CSS カスタムプロパティ（--koyomi-timeline-lanes）は CSSProperties の
  // 型定義に含まれないため、ここでのみ許容されたキャストを行う（CLAUDE.md 参照）。
  return { '--koyomi-timeline-lanes': String(Math.max(1, laneCount)) } as CSSProperties;
}

/**
 * `TimelineRowGroup` が実際に必要とするドラッグハンドラだけを抜き出した型。
 * `previewFor` はここに含めない（`TimelineView` / `VirtualTimelineView` 側で
 * 解決済みの値を `preview` prop として渡すため）。
 */
export interface TimelineRowDragHandlers {
  getRowProps: TimelineDragHandlers['getRowProps'];
  getItemProps: TimelineDragHandlers['getItemProps'];
  getResizeHandleProps: TimelineDragHandlers['getResizeHandleProps'];
}

/**
 * `useTimelineDrag` の戻り値は毎レンダー新しいオブジェクト（関数含む）になるため、
 * そのまま `memo` 化した子コンポーネントの props に渡すと再レンダー抑制が効かない。
 * ここで参照が変わらないラッパーを 1 度だけ作り、呼び出し時に ref 経由で常に最新の
 * ハンドラへ委譲することで、props の同一性を保ったまま最新の挙動を保証する
 * （`time-grid-view.tsx` の `useStableColumnDrag` と同じ設計）。
 */
export function useStableTimelineDrag(drag: TimelineDragHandlers): TimelineRowDragHandlers {
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [stable] = useState<TimelineRowDragHandlers>(() => ({
    getRowProps: (row) => dragRef.current.getRowProps(row),
    getItemProps: (item) => dragRef.current.getItemProps(item),
    getResizeHandleProps: (item, edge) => dragRef.current.getResizeHandleProps(item, edge),
  }));
  return stable;
}

/** `CalendarResource | null` の、表示に影響する内容が等しいかどうかを比較する。 */
export function sameResource(a: CalendarResource | null, b: CalendarResource | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.id === b.id && a.title === b.title && a.color === b.color;
}

/** `TimelineItem` 1 件分の、表示に影響する内容が等しいかどうかを比較する。 */
export function sameTimelineItem(a: TimelineItem, b: TimelineItem): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.occurrence.key === b.occurrence.key &&
    a.occurrence.event.title === b.occurrence.event.title &&
    a.occurrence.event.color === b.occurrence.event.color &&
    a.occurrence.event.resourceId === b.occurrence.event.resourceId &&
    a.occurrence.event.editable === b.occurrence.event.editable &&
    a.occurrence.allDay === b.occurrence.allDay &&
    a.occurrence.start.getTime() === b.occurrence.start.getTime() &&
    a.occurrence.end.getTime() === b.occurrence.end.getTime() &&
    a.startMinutes === b.startMinutes &&
    a.endMinutes === b.endMinutes &&
    a.lane === b.lane &&
    a.continuesBefore === b.continuesBefore &&
    a.continuesAfter === b.continuesAfter
  );
}

/** `TimelineItem` 配列の内容が等しいかどうかを比較する。 */
export function sameTimelineItems(a: readonly TimelineItem[], b: readonly TimelineItem[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && sameTimelineItem(item, other);
  });
}

/** `TimelineRow` の、`TimelineRowGroup` の表示に影響する内容が等しいかどうかを比較する。 */
export function sameTimelineRow(a: TimelineRow, b: TimelineRow): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    sameResource(a.resource, b.resource) &&
    a.laneCount === b.laneCount &&
    sameTimelineItems(a.items, b.items)
  );
}

/**
 * `TimelineViewModel.businessHourRanges` の内容が等しいかどうかを比較する。
 * ビューモデル全体で共有する 1 本の配列（全行共通）のため、通常は参照比較で
 * 早期に一致するが、`memo` の安全側フォールバックとして内容比較も行う。
 */
export function sameBusinessHourRanges(
  a: readonly BusinessHourRange[],
  b: readonly BusinessHourRange[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((range, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      range.startMinutes === other.startMinutes &&
      range.endMinutes === other.endMinutes
    );
  });
}

/** `TimelinePreviewSegment` の内容が等しいかどうかを比較する。 */
export function samePreviewSegment(
  a: TimelinePreviewSegment | null,
  b: TimelinePreviewSegment | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.kind === b.kind && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
}
