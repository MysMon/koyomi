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
 *
 * ヘッダー軸（日ヘッダー or 週/月グループヘッダー ＋ 時刻/日番号の目盛り）は
 * 両ビューで完全に同一の DOM のため、{@link TimelineAxisHeader} として統合する。
 */

import type { CSSProperties, ReactElement, Ref } from 'react';
import { memo, useRef, useState } from 'react';
import type {
  BusinessHourRange,
  CalendarResource,
  TimelineDay,
  TimelineHeaderGroup,
  TimelineItem,
  TimelineRow,
  TimelineScale,
  TimelineSlot,
  TimeZoneId,
} from '../../core/types';
import type { TimelineDragHandlers, TimelinePreviewSegment } from '../use-timeline-drag';
import { formatDayHeader, formatMonthTitle, formatRangeTitle } from './format';

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
      ref.current = element;
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
  return (
    a.kind === b.kind &&
    a.startMinutes === b.startMinutes &&
    a.endMinutes === b.endMinutes &&
    (a.invalid ?? false) === (b.invalid ?? false)
  );
}

/** `TimelineDay` 配列の、ヘッダー表示に影響する内容が等しいかどうかを比較する。 */
export function sameTimelineDays(a: readonly TimelineDay[], b: readonly TimelineDay[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((day, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      day.key === other.key &&
      day.isToday === other.isToday &&
      day.date.getTime() === other.date.getTime()
    );
  });
}

/** `TimelineSlot` 配列の内容が等しいかどうかを比較する。 */
export function sameTimelineSlots(a: readonly TimelineSlot[], b: readonly TimelineSlot[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((slot, index) => {
    const other = b[index];
    return other !== undefined && slot.minutes === other.minutes && slot.label === other.label;
  });
}

/**
 * `TimelineViewModel.headerGroups` の内容が等しいかどうかを比較する
 * （`sameBusinessHourRanges` と同型）。
 */
export function sameHeaderGroups(
  a: readonly TimelineHeaderGroup[] | null,
  b: readonly TimelineHeaderGroup[] | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((group, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      group.key === other.key &&
      group.startMinutes === other.startMinutes &&
      group.endMinutes === other.endMinutes &&
      group.containsToday === other.containsToday
    );
  });
}

/** {@link TimelineAxisHeaderImpl} の props。 */
interface TimelineAxisHeaderProps {
  /** 表示日一覧（`headerGroups` が `null` のときの日ヘッダーに使う）。 */
  days: readonly TimelineDay[];
  /** 時間軸の目盛り（内容は `scale` 依存）。 */
  slots: readonly TimelineSlot[];
  /** ヘッダー上段のグループ（`scale` が `'week'`/`'month'` のときのみ非 `null`）。 */
  headerGroups: readonly TimelineHeaderGroup[] | null;
  /** 適用中のズーム粒度（グループ見出しの書式選択に使う）。 */
  scale: TimelineScale;
  totalMinutes: number;
  timeZone: TimeZoneId;
  locale: string;
}

/**
 * タイムラインのヘッダー軸（日ヘッダー or 週/月グループヘッダー ＋ 時刻/日番号の目盛り）。
 *
 * `headerGroups` が `null`（`scale` が `'hour'`/`'day'`）のときは日ヘッダー
 * （`timeline-day-headers`/`timeline-day-header`。既存 DOM と同一）、それ以外
 * （`'week'`/`'month'`）のときは週/月グループ見出し（`timeline-group-headers`/
 * `timeline-group-header`）に切り替わる（両者は排他。同時には出さない）。
 * 目盛り（`timeline-slots`）は常に描画し、内容のみ `slots` に従う。
 */
function TimelineAxisHeaderImpl(props: TimelineAxisHeaderProps): ReactElement {
  const { days, slots, headerGroups, scale, totalMinutes, timeZone, locale } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA columnheader（TimelineView と同じ方針。日ヘッダー・時刻目盛りをまとめた1セル）
    // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
    <div data-koyomi="timeline-axis" role="columnheader">
      {headerGroups === null ? (
        <div data-koyomi="timeline-day-headers">
          {days.map((day) => (
            <div
              key={day.key}
              data-koyomi="timeline-day-header"
              data-today={day.isToday ? 'true' : undefined}
              aria-current={day.isToday ? 'date' : undefined}
              style={{ width: `${(MINUTES_PER_DAY / totalMinutes) * 100}%` }}
            >
              {formatDayHeader(day.date, timeZone, locale)}
            </div>
          ))}
        </div>
      ) : (
        <div data-koyomi="timeline-group-headers">
          {headerGroups.map((group) => (
            <div
              key={group.key}
              data-koyomi="timeline-group-header"
              data-koyomi-group-start={group.key}
              data-today={group.containsToday ? 'true' : undefined}
              aria-current={group.containsToday ? 'date' : undefined}
              style={{
                width: `${((group.endMinutes - group.startMinutes) / totalMinutes) * 100}%`,
              }}
            >
              {scale === 'month'
                ? formatMonthTitle(group.start, timeZone, locale)
                : formatRangeTitle({ start: group.start, end: group.end }, timeZone, locale)}
            </div>
          ))}
        </div>
      )}
      <div data-koyomi="timeline-slots">
        {slots.map((slot) => (
          <div
            key={slot.minutes}
            data-koyomi="timeline-slot-label"
            style={{ insetInlineStart: `${(slot.minutes / totalMinutes) * 100}%` }}
          >
            {slot.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * {@link TimelineAxisHeaderImpl} を `memo` でラップしたもの。
 *
 * ヘッダー軸は行のドラッグ状態など無関係な再レンダーの影響を受けないよう、
 * 表示に影響する値だけを比較するカスタム比較関数を使う
 * （`TimelineRowGroup` と同じ設計）。
 */
export const TimelineAxisHeader = memo(TimelineAxisHeaderImpl, (prev, next) => {
  return (
    sameTimelineDays(prev.days, next.days) &&
    sameTimelineSlots(prev.slots, next.slots) &&
    sameHeaderGroups(prev.headerGroups, next.headerGroups) &&
    prev.scale === next.scale &&
    prev.totalMinutes === next.totalMinutes &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale
  );
});
