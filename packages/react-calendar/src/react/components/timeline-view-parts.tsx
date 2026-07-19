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
 * 両ビューで同一の DOM のため、{@link TimelineAxisHeader} として統合する。
 * 仮想化版だけが使う時間軸（横方向）の windowing は `timeWindow`（省略可能）で
 * opt-in し、省略時（`TimelineView`）は全範囲を描画する（DOM 出力は不変）。
 */

import type { CSSProperties, ReactElement, Ref } from 'react';
import { memo, useRef, useState } from 'react';
import type {
  BusinessHourRange,
  CalendarResource,
  EventOccurrence,
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
import { formatDateLabel, formatTimeLabel } from './month-view-parts';

/**
 * タイムラインの帯（`timeline-item`）の `parts.timeText` 用に、時間指定イベントの
 * 整形済み時刻範囲を組み立てる。
 *
 * 既定内容（タイトルのみ）には表示しないが、カスタム描画スロット・中央
 * `renderEventContent` から既定の整形を再構築せずに時刻を差し込めるようにする。
 * 単日なら時刻のみ（`'9:00〜11:00'`）、複数日にまたがる場合は日付付き
 * （`'7月15日 22:00〜7月16日 2:00'`）。終日イベントは時刻を持たないため `null`。
 *
 * @param occurrence - 対象のオカレンス
 * @param timeZone - 表示タイムゾーン
 * @param locale - ロケール
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}）
 * @returns 整形済みの時刻範囲テキスト（終日イベントは `null`）
 */
export function formatTimelineItemTimeText(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string | null {
  if (occurrence.allDay) {
    return null;
  }
  const startDateLabel = formatDateLabel(occurrence.start, timeZone, locale);
  const endDateLabel = formatDateLabel(occurrence.end, timeZone, locale);
  const startTime = formatTimeLabel(occurrence.start, timeZone, locale);
  const endTime = formatTimeLabel(occurrence.end, timeZone, locale);
  return startDateLabel === endDateLabel
    ? `${startTime}${rangeSeparator}${endTime}`
    : `${startDateLabel} ${startTime}${rangeSeparator}${endDateLabel} ${endTime}`;
}

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
 * 表示日数を CSS 変数 `--koyomi-timeline-days` として style にする。
 * テーマ CSS がトラック幅（`timeline-axis` / `timeline-row` の `min-width`）の
 * 計算に参照する（{@link withLaneCountStyle} と同じ、位置決めの数値のみを
 * inline に出す既存規約の範囲内）。
 */
export function withTimelineDaysStyle(days: number): CSSProperties {
  // 'as' 使用理由: 上記 withLaneCountStyle と同様（--koyomi-timeline-days も
  // CSSProperties の型定義に含まれない）。
  return { '--koyomi-timeline-days': String(Math.max(1, days)) } as CSSProperties;
}

/**
 * ツリー内の深さを CSS 変数 `--koyomi-timeline-row-depth` として `style` に加える。
 * テーマ CSS 側の階層インデント計算（{@link withLaneCountStyle} と同じ、位置決めの
 * 数値のみを inline に出す既存規約の範囲内）が参照する。
 */
export function withDepthStyle(style: CSSProperties, depth: number): CSSProperties {
  // 'as' 使用理由: 上記 withLaneCountStyle と同様（--koyomi-timeline-row-depth も
  // CSSProperties の型定義に含まれない）。
  return { ...style, '--koyomi-timeline-row-depth': String(depth) } as CSSProperties;
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

/**
 * 時間軸（横方向）の可視ウィンドウ（表示分。overscan 込み）。
 *
 * `VirtualTimelineView` が横スクロール位置から算出し、時間軸セル（日ヘッダー・
 * グループ見出し・時刻目盛り）と帯（`timeline-item`）の横 windowing に使う。
 * `undefined`（未指定）は「全範囲を描画する」（非仮想化の `TimelineView`、および
 * 横の境界幅が無く横仮想化が無効なとき）。
 */
export interface TimelineTimeWindow {
  /** ウィンドウの開始（表示分）。 */
  startMinutes: number;
  /** ウィンドウの終了（表示分、排他）。 */
  endMinutes: number;
}

/** `TimelineTimeWindow` の内容が等しいかどうかを比較する（`memo` 用）。 */
export function sameTimeWindow(
  a: TimelineTimeWindow | undefined,
  b: TimelineTimeWindow | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
}

/**
 * 帯・営業時間帯などの表示分区画がウィンドウに重なるかどうかを判定する。
 * ウィンドウ未指定（`undefined`）は常に重なる（全範囲を描画する）扱い。
 */
export function overlapsTimeWindow(
  startMinutes: number,
  endMinutes: number,
  timeWindow: TimelineTimeWindow | undefined,
): boolean {
  if (timeWindow === undefined) {
    return true;
  }
  return endMinutes > timeWindow.startMinutes && startMinutes < timeWindow.endMinutes;
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
    a.depth === b.depth &&
    a.hasChildren === b.hasChildren &&
    a.collapsed === b.collapsed &&
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
  /**
   * 週グループ見出しの開始側・終了側を連結する区切り記号
   *（{@link MessageCatalog.common.rangeSeparator}）。
   */
  rangeSeparator: string;
  /**
   * 時間軸（横方向）の可視ウィンドウ。指定時は日ヘッダー・グループ見出し・
   * 時刻目盛りをウィンドウに重なる範囲だけ描画し、窓外の日ヘッダー/グループ
   * 見出し分は % 幅のスペーサ（`timeline-header-spacer`）へ置き換える。
   * 省略時は全範囲を描画する（`TimelineView` と同一の DOM）。
   */
  timeWindow?: TimelineTimeWindow | undefined;
  /**
   * 時間軸ルート（`timeline-axis`）へ渡す ref。`VirtualTimelineView` が
   * トラック幅の実測（1 日分の幅の算出）に使う。
   */
  axisRef?: Ref<HTMLDivElement> | undefined;
}

/**
 * 窓外の日ヘッダー/グループ見出し分を置き換える % 幅スペーサ。
 * 幅 0 のときは描画しない（ウィンドウが先頭/末尾に接しているとき、
 * `:first-child` 基準の罫線など非仮想化版の見た目を保つ）。
 */
function headerSpacer(edge: 'before' | 'after', percent: number): ReactElement | null {
  if (percent <= 0) {
    return null;
  }
  return (
    <div
      data-koyomi="timeline-header-spacer"
      data-edge={edge}
      aria-hidden="true"
      style={{ flexGrow: 0, flexShrink: 0, flexBasis: `${percent}%` }}
    />
  );
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
  const {
    days,
    slots,
    headerGroups,
    scale,
    totalMinutes,
    timeZone,
    locale,
    rangeSeparator,
    timeWindow,
    axisRef,
  } = props;
  // 日ヘッダーの描画範囲（日インデックス、両端含む）。ウィンドウ未指定なら全日。
  let firstDayIndex = 0;
  let lastDayIndex = days.length - 1;
  if (timeWindow !== undefined && days.length > 0) {
    firstDayIndex = Math.min(
      days.length - 1,
      Math.max(0, Math.floor(timeWindow.startMinutes / MINUTES_PER_DAY)),
    );
    lastDayIndex = Math.min(
      days.length - 1,
      Math.max(firstDayIndex, Math.ceil(timeWindow.endMinutes / MINUTES_PER_DAY) - 1),
    );
  }
  // グループ見出しの描画対象（ウィンドウに重なるものだけ）。
  const visibleGroups =
    headerGroups === null
      ? null
      : headerGroups.filter((group) =>
          overlapsTimeWindow(group.startMinutes, group.endMinutes, timeWindow),
        );
  const visibleSlots =
    timeWindow === undefined
      ? slots
      : slots.filter(
          (slot) => slot.minutes >= timeWindow.startMinutes && slot.minutes < timeWindow.endMinutes,
        );
  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA columnheader（TimelineView と同じ方針。日ヘッダー・時刻目盛りをまとめた1セル）
    // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
    <div ref={axisRef} data-koyomi="timeline-axis" role="columnheader">
      {visibleGroups === null ? (
        <div data-koyomi="timeline-day-headers">
          {timeWindow !== undefined &&
            headerSpacer('before', ((firstDayIndex * MINUTES_PER_DAY) / totalMinutes) * 100)}
          {days.slice(firstDayIndex, lastDayIndex + 1).map((day) => (
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
          {timeWindow !== undefined &&
            headerSpacer(
              'after',
              (((days.length - 1 - lastDayIndex) * MINUTES_PER_DAY) / totalMinutes) * 100,
            )}
        </div>
      ) : (
        <div data-koyomi="timeline-group-headers">
          {timeWindow !== undefined &&
            headerSpacer('before', ((visibleGroups[0]?.startMinutes ?? 0) / totalMinutes) * 100)}
          {visibleGroups.map((group) => (
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
                : formatRangeTitle(
                    { start: group.start, end: group.end },
                    timeZone,
                    locale,
                    rangeSeparator,
                  )}
            </div>
          ))}
          {timeWindow !== undefined &&
            headerSpacer(
              'after',
              ((totalMinutes - (visibleGroups.at(-1)?.endMinutes ?? totalMinutes)) / totalMinutes) *
                100,
            )}
        </div>
      )}
      <div data-koyomi="timeline-slots">
        {visibleSlots.map((slot) => (
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
    prev.locale === next.locale &&
    prev.rangeSeparator === next.rangeSeparator &&
    sameTimeWindow(prev.timeWindow, next.timeWindow) &&
    prev.axisRef === next.axisRef
  );
});
