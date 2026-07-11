/**
 * @packageDocumentation
 * リソースビューの内部共有ヘルパー。
 *
 * `ResourceView`（`./resource-view`）と、その列仮想化版 `VirtualResourceView`
 * （`./virtual-resource-view`）の両方が使う、DOM 構造に依存しない小さな
 * ヘルパー・定数・比較関数（`memo` 用）をここに集約する。これにより
 * 「片方だけ修正して挙動が乖離する」（例: 比較関数への新フィールド追加漏れ）
 * を防ぐ（`month-view-parts.tsx` と同じ狙い）。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 *
 * 両ビューで DOM 構造・ドラッグ配線の都合により微妙に異なる部分
 * （`ResourceColumnDragHandlers` / `useStableResourceDrag` は仮想化版のみ
 * `getAllDayCellProps` を追加で必要とする。`AllDayItemButton` は仮想化版のみ
 * `tabbable` 制御を持ち aria-label の組み立ても異なる）は無理に統合せず、
 * それぞれのファイルに残している。
 */

import type { ReactNode, Ref } from 'react';
import type {
  BusinessHourSlot,
  CalendarResource,
  EventOccurrence,
  PositionedOccurrence,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import type { ResourcePreviewSegment } from '../use-resource-grid-drag';
import { formatEventAriaLabel, formatTimeLabel } from './month-view-parts';

/** 1 日の分（24:00 = 1440 分）。 */
export const MINUTES_PER_DAY = 1440;

/** 未割り当てレーンの既定ラベル。 */
export const DEFAULT_UNASSIGNED_LABEL = '未割り当て';

/** 空状態の既定メッセージ。 */
export const DEFAULT_EMPTY_LABEL = 'リソースがありません';

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
      ref.current = element;
    }
  };
}

/**
 * `ReactNode` のラベルを `aria-label` 属性用の文字列に変換する。
 * `aria-label` は文字列しか受け付けないため、`label` が文字列でない
 * （JSX 等が渡された）場合は `fallback` を使う（`toolbar.tsx` の同名ヘルパと同じ方針）。
 */
export function ariaLabelText(label: ReactNode, fallback: string): string {
  return typeof label === 'string' ? label : fallback;
}

/**
 * イベントの aria-label にリソース名を付け足す（例: `'会議、7月10日 10:00〜11:00、会議室A'`）。
 */
export function ariaLabelWithResource(
  occurrence: EventOccurrence,
  resourceTitle: string | undefined,
  timeZone: TimeZoneId,
  locale: string,
): string {
  const base = formatEventAriaLabel(occurrence, timeZone, locale);
  return resourceTitle === undefined ? base : `${base}、${resourceTitle}`;
}

/** 時間指定イベントの既定の表示内容（開始時刻 + タイトル）。 */
export function defaultTimedContent(
  item: PositionedOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): ReactNode {
  return `${formatTimeLabel(item.occurrence.start, timeZone, locale)} ${item.occurrence.event.title}`;
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

/** `PositionedOccurrence` 1 件分の、表示に影響する内容が等しいかどうかを比較する。 */
export function samePositionedOccurrence(
  a: PositionedOccurrence,
  b: PositionedOccurrence,
): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.occurrence.key === b.occurrence.key &&
    a.occurrence.event.title === b.occurrence.event.title &&
    a.occurrence.event.color === b.occurrence.event.color &&
    a.occurrence.event.resourceId === b.occurrence.event.resourceId &&
    a.occurrence.event.editable === b.occurrence.event.editable &&
    a.occurrence.start.getTime() === b.occurrence.start.getTime() &&
    a.occurrence.end.getTime() === b.occurrence.end.getTime() &&
    a.startMinutes === b.startMinutes &&
    a.endMinutes === b.endMinutes &&
    a.left === b.left &&
    a.width === b.width &&
    a.continuesBefore === b.continuesBefore &&
    a.continuesAfter === b.continuesAfter
  );
}

/** `PositionedOccurrence` 配列の内容が等しいかどうかを比較する。 */
export function samePositionedOccurrences(
  a: readonly PositionedOccurrence[],
  b: readonly PositionedOccurrence[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && samePositionedOccurrence(item, other);
  });
}

/** `EventOccurrence` 1 件分の、表示に影響する内容が等しいかどうかを比較する（終日アイテム用）。 */
export function sameEventOccurrence(a: EventOccurrence, b: EventOccurrence): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    a.event.title === b.event.title &&
    a.event.color === b.event.color &&
    a.event.resourceId === b.event.resourceId &&
    a.event.editable === b.event.editable &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime()
  );
}

/** `TimeSlot` 配列の内容が等しいかどうかを比較する（`ResourceView` / `VirtualResourceView` 共通）。 */
export function sameSlots(a: readonly TimeSlot[], b: readonly TimeSlot[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((slot, index) => slot.minutes === b[index]?.minutes);
}

/**
 * `BusinessHourSlot` 配列の内容が等しいかどうかを比較する
 * （`time-grid-view.tsx` の同名ヘルパと同じ判定。リソースビューは 1 本を全列で共有するため
 * 通常は参照比較で早期に一致するが、`memo` の安全側フォールバックとして内容比較も行う）。
 */
export function sameBusinessHourSlots(
  a: readonly BusinessHourSlot[],
  b: readonly BusinessHourSlot[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((slot, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      slot.minutes === other.minutes &&
      slot.isBusinessHours === other.isBusinessHours
    );
  });
}

/** `ResourcePreviewSegment` の内容が等しいかどうかを比較する。 */
export function samePreviewSegment(
  a: ResourcePreviewSegment | null,
  b: ResourcePreviewSegment | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.kind === b.kind && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
}
