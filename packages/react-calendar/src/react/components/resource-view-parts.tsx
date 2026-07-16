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
import type { CommonMessages } from '../locales/types';
import type { EventContentContext } from '../types';
import type { ResourcePreviewSegment } from '../use-resource-grid-drag';
import { timedTextEventContentContext, titleOnlyEventContentContext } from './event-content';
import { formatOccurrenceRangeLabel, formatTimeLabel } from './month-view-parts';

/** 1 日の分（24:00 = 1440 分）。 */
export const MINUTES_PER_DAY = 1440;

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
 * `ReactNode` のラベルが文字列であれば `aria-label` 属性用にそのまま使う。
 * `aria-label` は文字列しか受け付けないため、文字列でない（JSX 等の）場合は
 * `undefined`（属性自体を省略）を返す（`toolbar.tsx` の同名ヘルパと同じ方針）。
 */
export function ariaLabelText(label: ReactNode): string | undefined {
  return typeof label === 'string' ? label : undefined;
}

/**
 * リソース名を含めてイベントの aria-label 全文を組み立てる（例: `'会議、7月10日 10:00〜11:00、会議室A'`）。
 *
 * 区切り記号を含む全文の組み立ては `commonMessages.eventAriaLabel` 自体に一任し、
 * ここではリソース名を `resourceLabel` として渡すだけにする（呼び出し側で区切り記号を
 * 後から付け足すと、区切り記号を上書きしたときに一部の区切りにしか反映されない
 * 混在が起きるため）。
 *
 * @param occurrence - 対象のオカレンス
 * @param resourceTitle - リソース名（対象外・未割り当ての場合は `undefined`）
 * @param timeZone - 表示タイムゾーン
 * @param locale - ロケール
 * @param commonMessages - 中央メッセージカタログの `common` グループ
 */
export function ariaLabelWithResource(
  occurrence: EventOccurrence,
  resourceTitle: string | undefined,
  timeZone: TimeZoneId,
  locale: string,
  commonMessages: CommonMessages,
): string {
  const rangeLabel = formatOccurrenceRangeLabel(
    occurrence,
    occurrence.allDay,
    timeZone,
    locale,
    commonMessages.rangeSeparator,
  );
  return commonMessages.eventAriaLabel(
    occurrence,
    resourceTitle === undefined ? { rangeLabel } : { rangeLabel, resourceLabel: resourceTitle },
  );
}

/**
 * リソースビューの時間指定イベント（`timegrid-event`）のイベント内容コンテキストを
 * 組み立てる。既定内容は開始時刻 + タイトル（`'H:mm タイトル'`）。
 */
export function resourceTimedContentContext(
  item: PositionedOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): EventContentContext {
  return timedTextEventContentContext(
    'timegrid-event',
    formatTimeLabel(item.occurrence.start, timeZone, locale),
    item.occurrence.event.title,
  );
}

/**
 * リソースビューの終日アイテム（`allday-event`）のイベント内容コンテキストを
 * 組み立てる。既定内容はタイトルのみ。
 */
export function resourceAllDayContentContext(occurrence: EventOccurrence): EventContentContext {
  return titleOnlyEventContentContext('allday-event', occurrence.event.title);
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
  return (
    a.kind === b.kind &&
    a.startMinutes === b.startMinutes &&
    a.endMinutes === b.endMinutes &&
    (a.invalid ?? false) === (b.invalid ?? false)
  );
}
