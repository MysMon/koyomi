/**
 * @packageDocumentation
 * `VirtualResourceView` — リソースビューの列（リソース列）を横方向に仮想化する
 * ヘッドレスコンポーネント。
 *
 * 大量のリソースを扱う画面で列の DOM ノードが肥大するのを避けるため、可視範囲の
 * リソース列だけを描画する。仮想化のプリミティブは {@link useVirtualizer}（`VirtualListView`
 * と同じだが `axis: 'horizontal'` で使う）。DOM 構造・ARIA（`role="grid"` / `row` /
 * `columnheader` / `gridcell`、中間ラッパーは `role="presentation"`）は `ResourceView` と
 * 同じ方針（`docs/accessibility.md` 参照）。
 *
 * `ResourceView` 自体は変更しない別コンポーネント方式で追加する（既存の DOM・挙動は不変）。
 * `ResourceView` の非仮想化版は「列方向の仮想化は非目標、横スクロールで対応」という
 * 既存方針（`theme/default.css` の該当コメント参照）だが、本コンポーネントは数百列規模の
 * 極端なケース向けに windowing を提供する opt-in の別実装として追加する。
 *
 * リソース列は列見出し行（`resource-header`）・終日行（`allday-row`）・本文
 * （`resource-columns`）の 3 箇所に分かれて描画されるが、列幅はどれも
 * `columnWidth` で固定（CSS 変数 `--koyomi-resource-column-width` と同じ既定 160px）のため、
 * 3 箇所とも同じ {@link useVirtualizer} の計算結果（可視インデックス・スペーサ幅）を
 * 使い回すことで整合させる。時間軸の余白列（`timegrid-axis-gutter` / `time-axis`）は
 * スクロールコンテナ（ルート）内でリソース列より「前」に同居する固定表示の列なので、
 * `viewportPadding` にその実測幅を渡して差し引く（詳細は `useVirtualizer` の TSDoc参照）。
 */

import type {
  CSSProperties,
  ReactElement,
  FocusEvent as ReactFocusEvent,
  ReactNode,
  Ref,
} from 'react';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  BusinessHourSlot,
  EventOccurrence,
  PositionedOccurrence,
  ResourceColumn,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { CommonMessages } from '../locales/types';
import { scrollContainerToTime } from '../scroll-to-time';
import type { EventContentContext, EventContentRenderer, SlotRenderContext } from '../types';
import type { ResourceGridDragHandlers, ResourcePreviewSegment } from '../use-resource-grid-drag';
import { useResourceGridDrag } from '../use-resource-grid-drag';
import { useVirtualizer } from '../use-virtualizer';
import { resolveEventContent } from './event-content';
import {
  percentOfSlotRange,
  withEventColorStyle,
  withTimegridHoursStyle,
} from './month-view-parts';
import {
  ariaLabelWithResource,
  businessHourSlotsForColumn,
  isMultiDayResourceView,
  MINUTES_PER_DAY,
  resourceAllDayContentContext,
  resourceColumnAriaLabel,
  resourceColumnHeaderContent,
  resourceTimedContentContext,
  sameBusinessHourSlots,
  sameEventOccurrence,
  samePositionedOccurrences,
  samePreviewSegment,
  sameResource,
  sameSlots,
  toDivRef,
} from './resource-view-parts';

/** `columnWidth` 省略時の列幅（px、既定テーマの `--koyomi-resource-column-width` と同じ値）。 */
const DEFAULT_COLUMN_WIDTH = 160;

/**
 * 仮想化が効いていない旨を開発警告する列数の閾値。これ未満の少ない列数は
 * 全件描画でも問題にならないため警告しない（誤検知を避ける）。
 */
const VIRTUALIZE_WARN_THRESHOLD = 40;

/**
 * `VirtualResourceView` の props。`ResourceView` のカスタマイズ props に仮想化固有の設定を加える。
 *
 * 時間指定イベントの表示内容は `renderEvent`、終日アイテムの表示内容は
 * `renderAllDayItem` でそれぞれ独立にカスタマイズする（`ResourceView` と同じ）。
 */
export interface VirtualResourceViewProps {
  /**
   * 時間指定イベントブロックの表示内容をカスタマイズする関数。終日アイテムには
   * 適用されない（終日アイテムの内容は {@link VirtualResourceViewProps.renderAllDayItem} を使う）。
   */
  renderEvent?: (item: PositionedOccurrence, ctx: EventContentContext) => ReactNode;
  /** 終日アイテムの表示内容をカスタマイズする関数。省略時はタイトルのみを表示する。 */
  renderAllDayItem?: (occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode;
  /** 列見出しの内容をカスタマイズする関数（第 2 引数に既定内容）。 */
  renderColumnHeader?: (column: ResourceColumn, ctx: SlotRenderContext) => ReactNode;
  /** 列 1 本分の幅（px）。既定 160（`--koyomi-resource-column-width` の既定値と同じ）。 */
  columnWidth?: number;
  /** 前後 overscan 列数。既定 3。 */
  overscan?: number;
  /**
   * マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置（`'HH:mm'`）。
   * 表示時間帯制限（{@link CalendarOptions.slotMinTime}/{@link CalendarOptions.slotMaxTime}）とは
   * 独立して機能する。事後に値を変更しても再適用されない（`ref.current.scrollToTime` を使うこと）。
   */
  initialScrollTime?: string;
  /**
   * {@link VirtualResourceViewHandle}（スクロール操作などの命令的 API）を受け取る ref。
   */
  // React 本体の RefAttributes と同じく明示的な undefined を許容する
  // （exactOptionalPropertyTypes 下で `ref={maybeUndefined}` を書けるようにするため）
  ref?: Ref<VirtualResourceViewHandle> | undefined;
}

/** {@link VirtualResourceView} が `ref` 経由で公開する命令的 API。 */
export interface VirtualResourceViewHandle {
  /**
   * 指定リソースの列を可視域へスクロールする。
   * @param resourceId - スクロール先のリソース ID。未割り当て列へスクロールしたい場合は `null`
   * @param options - `align` 省略時は `'auto'`（可視域の外にあるときだけ最小限スクロール）
   */
  scrollToResource(
    resourceId: string | null,
    options?: { align?: 'auto' | 'start' | 'center' },
  ): void;
  /**
   * `[data-koyomi="resource"]`（ルート、横スクロールと共有のスクロールコンテナ）を
   * 指定時刻の位置へスクロールする。時刻が表示時間帯の外側の場合は最も近い境界へ
   * クランプする。`'HH:mm'` として解析できない場合は何もしない。列方向のスクロール
   * （`scrollLeft`）には干渉しない。
   */
  scrollToTime(time: string): void;
}

/**
 * `resource-view.tsx` の `ResourceColumnDragHandlers` / `useStableResourceDrag` と
 * 同じ設計の安定ラッパーだが、こちらは終日セル（`AllDayCell`）を独立した `memo`
 * コンポーネントに分けているため、その props として渡す `getAllDayCellProps` を
 * 追加で含む（`ResourceView` は終日セルを分離しておらず `drag` から直接呼ぶため、
 * このフィールドを持たない）。この差は DOM 構造上の理由による意図的なものなので、
 * `resource-view-parts.tsx` へは統合していない。
 */
interface ResourceColumnDragHandlers {
  getColumnProps: ResourceGridDragHandlers['getColumnProps'];
  getEventProps: ResourceGridDragHandlers['getEventProps'];
  getResizeHandleProps: ResourceGridDragHandlers['getResizeHandleProps'];
  getAllDayItemProps: ResourceGridDragHandlers['getAllDayItemProps'];
  getAllDayCellProps: ResourceGridDragHandlers['getAllDayCellProps'];
}

function useStableResourceDrag(drag: ResourceGridDragHandlers): ResourceColumnDragHandlers {
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [stable] = useState<ResourceColumnDragHandlers>(() => ({
    getColumnProps: (column) => dragRef.current.getColumnProps(column),
    getEventProps: (item) => dragRef.current.getEventProps(item),
    getResizeHandleProps: (item, edge) => dragRef.current.getResizeHandleProps(item, edge),
    getAllDayItemProps: (occurrence) => dragRef.current.getAllDayItemProps(occurrence),
    getAllDayCellProps: (column) => dragRef.current.getAllDayCellProps(column),
  }));
  return stable;
}

/**
 * `EventOccurrence` 配列の内容が等しいかどうかを比較する（終日アイテム用）。
 * 終日セルを `memo` コンポーネント（`AllDayCell`）に分離している仮想化版だけが必要とする
 * 比較関数（`ResourceView` は終日セルを分離していないため配列単位の比較を持たない）。
 */
function sameEventOccurrences(
  a: readonly EventOccurrence[],
  b: readonly EventOccurrence[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && sameEventOccurrence(item, other);
  });
}

/** 仮想化: 列の絶対配置スタイル（通常フローは `undefined`、pinned 列は `left` 指定）。 */
function columnPositionStyle(extra: {
  pinned?: boolean;
  left?: number;
}): CSSProperties | undefined {
  if (extra.pinned !== true) {
    return undefined;
  }
  return { position: 'absolute', insetInlineStart: `${extra.left ?? 0}px`, top: 0, bottom: 0 };
}

/** `HeaderCellImpl` の props。 */
interface HeaderCellProps {
  column: ResourceColumn;
  unassignedLabel: ReactNode;
  renderColumnHeader: ((column: ResourceColumn, ctx: SlotRenderContext) => ReactNode) | undefined;
  columnWidth: number;
  /** 複数日表示かどうか（`true` なら既定内容に日ラベルを付ける）。 */
  multiDay: boolean;
  /** 表示タイムゾーン（日ラベルの整形に使う）。 */
  timeZone: TimeZoneId;
  /** 書式ロケール（日ラベルの整形に使う）。 */
  locale: string;
  pinned?: boolean;
  left?: number;
}

/** リソースビューの列見出しセル 1 件分。 */
function HeaderCellImpl(props: HeaderCellProps): ReactElement {
  const {
    column,
    unassignedLabel,
    renderColumnHeader,
    columnWidth,
    multiDay,
    timeZone,
    locale,
    pinned,
    left,
  } = props;
  const defaultContent = resourceColumnHeaderContent(
    column.resource?.title ?? unassignedLabel,
    column,
    multiDay,
    timeZone,
    locale,
  );
  const style: CSSProperties = {
    ...withEventColorStyle({}, column.resource?.color),
    flex: `0 0 ${columnWidth}px`,
    // テーマ CSS 側は既定 160px（--koyomi-resource-column-width）の min-width を持つため、
    // columnWidth がそれと異なる値のときに衝突しないよう明示的に上書きする。
    minWidth: `${columnWidth}px`,
    ...columnPositionStyle({
      ...(pinned !== undefined ? { pinned } : {}),
      ...(left !== undefined ? { left } : {}),
    }),
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA columnheader（ResourceView と同じ方針）
    // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない
    <div
      data-koyomi="resource-header-cell"
      data-koyomi-column-key={column.key}
      data-koyomi-date={column.dayKey}
      data-koyomi-depth={String(column.depth)}
      role="columnheader"
      {...(column.resource !== null ? { 'data-koyomi-resource-id': column.resource.id } : {})}
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      style={style}
    >
      {renderColumnHeader ? renderColumnHeader(column, { defaultContent }) : defaultContent}
    </div>
  );
}

const HeaderCell = memo(HeaderCellImpl, (prev, next) => {
  return (
    prev.column.key === next.column.key &&
    // 単日表示では日が変わってもキーが変わらないため、日付キーも比較する
    prev.column.dayKey === next.column.dayKey &&
    // sameResource は id・title・color のみ比較するため、parentId の変更で
    // 深さだけが変わったケースを取りこぼさないよう depth も比較する
    prev.column.depth === next.column.depth &&
    sameResource(prev.column.resource, next.column.resource) &&
    prev.unassignedLabel === next.unassignedLabel &&
    prev.renderColumnHeader === next.renderColumnHeader &&
    prev.columnWidth === next.columnWidth &&
    prev.multiDay === next.multiDay &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.pinned === next.pinned &&
    prev.left === next.left
  );
});

/** `AllDayCellImpl` の props。 */
interface AllDayCellProps {
  column: ResourceColumn;
  unassignedLabel: ReactNode;
  columnWidth: number;
  drag: ResourceColumnDragHandlers;
  isDragging: boolean;
  isPreviewTarget: boolean;
  /** `isPreviewTarget` のときに反映する `dragPreview.invalid`（省略時は `false` 相当）。 */
  isPreviewInvalid: boolean;
  /** 複数日表示かどうか（`true` ならセルの aria-label に日ラベルを付ける）。 */
  multiDay: boolean;
  /** 表示タイムゾーン（終日アイテムの aria-label 生成に使う）。 */
  timeZone: TimeZoneId;
  /** 書式ロケール（終日アイテムの aria-label 生成に使う）。 */
  locale: string;
  pinned?: boolean;
  left?: number;
  /** 仮想化: 終日アイテムをタブ順に含めるか。既定 `true`（`false` で `tabIndex=-1`）。 */
  itemTabbable?: boolean;
  /** 終日アイテムの表示内容のカスタマイズ関数（省略時はタイトルのみ）。 */
  renderAllDayItem:
    | ((occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode)
    | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}

/** リソースビューの終日セル 1 件分（内部に終日アイテムのボタンを縦積みする）。 */
function AllDayCellImpl(props: AllDayCellProps): ReactElement {
  const {
    column,
    unassignedLabel,
    columnWidth,
    drag,
    isDragging,
    isPreviewTarget,
    isPreviewInvalid,
    multiDay,
    timeZone,
    locale,
    pinned,
    left,
    itemTabbable,
    renderAllDayItem,
    renderEventContent,
    commonMessages,
  } = props;
  const style: CSSProperties = {
    flex: `0 0 ${columnWidth}px`,
    // テーマ CSS 側は既定 160px（--koyomi-resource-column-width）の min-width を持つため、
    // columnWidth がそれと異なる値のときに衝突しないよう明示的に上書きする。
    minWidth: `${columnWidth}px`,
    minHeight: `calc(${Math.max(2, column.allDayItems.length)} * var(--koyomi-lane-height, 24px))`,
    ...columnPositionStyle({
      ...(pinned !== undefined ? { pinned } : {}),
      ...(left !== undefined ? { left } : {}),
    }),
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA gridcell（ResourceView と同じ方針）
    // biome-ignore lint/a11y/useFocusableInteractive: tabIndex は drag.getAllDayCellProps（useResourceGridDrag）のスプレッド経由で付与済み。静的解析ではスプレッド元を検出できないための誤検知
    <div
      {...drag.getAllDayCellProps(column)}
      data-koyomi="resource-allday-cell"
      data-koyomi-column-key={column.key}
      role="gridcell"
      aria-label={resourceColumnAriaLabel(
        column.resource?.title ?? unassignedLabel,
        column,
        multiDay,
        timeZone,
        locale,
      )}
      data-koyomi-preview-target={isPreviewTarget ? 'true' : undefined}
      data-koyomi-invalid={isPreviewTarget && isPreviewInvalid ? 'true' : undefined}
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      style={style}
    >
      {column.allDayItems.map((occurrence, lane) => (
        <AllDayItemButton
          key={occurrence.key}
          occurrence={occurrence}
          column={column}
          lane={lane}
          drag={drag}
          isDragging={isDragging}
          timeZone={timeZone}
          locale={locale}
          renderAllDayItem={renderAllDayItem}
          renderEventContent={renderEventContent}
          commonMessages={commonMessages}
          {...(itemTabbable === false ? { tabbable: false } : {})}
        />
      ))}
    </div>
  );
}

const AllDayCell = memo(AllDayCellImpl, (prev, next) => {
  return (
    prev.column.key === next.column.key &&
    // 単日表示では日が変わってもキーが変わらないため、日付キーも比較する
    prev.column.dayKey === next.column.dayKey &&
    sameResource(prev.column.resource, next.column.resource) &&
    sameEventOccurrences(prev.column.allDayItems, next.column.allDayItems) &&
    prev.unassignedLabel === next.unassignedLabel &&
    prev.columnWidth === next.columnWidth &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    prev.isPreviewTarget === next.isPreviewTarget &&
    prev.isPreviewInvalid === next.isPreviewInvalid &&
    prev.multiDay === next.multiDay &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.pinned === next.pinned &&
    prev.left === next.left &&
    prev.itemTabbable === next.itemTabbable &&
    prev.renderAllDayItem === next.renderAllDayItem &&
    prev.renderEventContent === next.renderEventContent &&
    prev.commonMessages === next.commonMessages
  );
});

/** `AllDayItemButtonImpl` の props（`resource-view.tsx` と同じ内容に、仮想化専用の `tabbable` を加える）。 */
interface AllDayItemButtonProps {
  occurrence: EventOccurrence;
  column: ResourceColumn;
  lane: number;
  drag: ResourceColumnDragHandlers;
  isDragging: boolean;
  /** 表示タイムゾーン（aria-label 生成に使う）。 */
  timeZone: TimeZoneId;
  /** 書式ロケール（aria-label 生成に使う）。 */
  locale: string;
  /** 仮想化: タブ順に含めるか。既定 `true`（`false` で `tabIndex=-1`。pinned 列で使う）。 */
  tabbable?: boolean;
  /** 終日アイテムの表示内容のカスタマイズ関数（省略時はタイトルのみ）。 */
  renderAllDayItem:
    | ((occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode)
    | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}

/** リソースビューの終日アイテム 1 件分のボタン（列間移動のみ）。 */
function AllDayItemButtonImpl(props: AllDayItemButtonProps): ReactElement {
  const {
    occurrence,
    column,
    lane,
    drag,
    timeZone,
    locale,
    tabbable,
    renderAllDayItem,
    renderEventContent,
    commonMessages,
  } = props;
  const style = withEventColorStyle(
    {
      top: `calc(${lane} * var(--koyomi-lane-height, 24px))`,
      insetInlineStart: '0%',
      width: '100%',
    },
    occurrence.event.color ?? column.resource?.color,
  );
  return (
    <button
      type="button"
      {...drag.getAllDayItemProps(occurrence)}
      data-koyomi="allday-event"
      style={style}
      aria-label={ariaLabelWithResource(
        occurrence,
        column.resource?.title,
        timeZone,
        locale,
        commonMessages,
      )}
      {...(tabbable === false ? { tabIndex: -1 } : {})}
    >
      {resolveEventContent(
        renderAllDayItem,
        renderEventContent,
        occurrence,
        occurrence,
        resourceAllDayContentContext(occurrence),
      )}
    </button>
  );
}

const AllDayItemButton = memo(AllDayItemButtonImpl, (prev, next) => {
  return (
    sameEventOccurrence(prev.occurrence, next.occurrence) &&
    sameResource(prev.column.resource, next.column.resource) &&
    prev.lane === next.lane &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.tabbable === next.tabbable &&
    prev.renderAllDayItem === next.renderAllDayItem &&
    prev.renderEventContent === next.renderEventContent &&
    prev.commonMessages === next.commonMessages
  );
});

/** `ResourceColumnBodyImpl` の props。 */
interface ResourceColumnBodyProps {
  column: ResourceColumn;
  /** 時間軸の目盛り（{@link ResourceViewModel.slots}）。営業時間内フラグ付きスロット罫線の描画に使う。 */
  slots: readonly TimeSlot[];
  /** この列の日の営業時間内フラグ（{@link ResourceViewDay.businessHourSlots}）。 */
  businessHourSlots: readonly BusinessHourSlot[];
  timeZone: TimeZoneId;
  locale: string;
  /** 表示時間帯の開始（分）。既定（`slotMinTime` 未指定）は `0`。 */
  slotMinTimeMinutes: number;
  /** 表示時間帯の終了（分）。既定（`slotMaxTime` 未指定）は `1440`。 */
  slotMaxTimeMinutes: number;
  isToday: boolean;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  drag: ResourceColumnDragHandlers;
  isDragging: boolean;
  preview: ResourcePreviewSegment | null;
  columnWidth: number;
  pinned?: boolean;
  left?: number;
  eventTabbable?: boolean;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}

/** リソースビューの 1 列分（目盛り線・イベント・プレビュー・現在時刻線）。 */
function ResourceColumnBodyImpl(props: ResourceColumnBodyProps): ReactElement {
  const {
    column,
    slots,
    businessHourSlots,
    timeZone,
    locale,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    isToday,
    nowIndicatorMinutes,
    renderEvent,
    renderEventContent,
    drag,
    preview,
    columnWidth,
    pinned,
    left,
    eventTabbable,
    commonMessages,
  } = props;
  // 列幅は columnWidth で固定（measure: false）のため、drag.getColumnProps が返す ref を
  // そのまま使う（実測用 ref コールバックの合成は不要。measureElement 経由の配線は行わない）。
  const { ref, ...columnProps } = drag.getColumnProps(column);
  const style: CSSProperties = {
    flex: `0 0 ${columnWidth}px`,
    // テーマ CSS 側は既定 160px（--koyomi-resource-column-width）の min-width を持つため、
    // columnWidth がそれと異なる値のときに衝突しないよう明示的に上書きする。
    minWidth: `${columnWidth}px`,
    ...columnPositionStyle({
      ...(pinned !== undefined ? { pinned } : {}),
      ...(left !== undefined ? { left } : {}),
    }),
  };
  const rangeWidth = slotMaxTimeMinutes - slotMinTimeMinutes;

  return (
    <div
      {...columnProps}
      ref={toDivRef(ref)}
      data-koyomi="resource-column"
      data-koyomi-column-key={column.key}
      data-today={isToday ? 'true' : undefined}
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      style={style}
    >
      {slots.map((slot, index) => {
        // 罫線は非仮想化の ResourceView と同じく常時描画する（businessHours の
        // 有無で見た目が分岐しないよう統一）。isBusinessHours なスロットのみ、
        // 次のスロット（無ければ表示時間帯の終端）までの高さを追加で持たせて背景を敷ける
        // （週/日ビューと同じ規則）
        const isBusinessHours = businessHourSlots[index]?.isBusinessHours ?? false;
        const nextMinutes = slots[index + 1]?.minutes ?? slotMaxTimeMinutes;
        return (
          <div
            key={slot.minutes}
            data-koyomi="timegrid-slot"
            data-koyomi-business-hours={isBusinessHours ? 'true' : undefined}
            style={
              isBusinessHours
                ? {
                    top: `${percentOfSlotRange(slot.minutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
                    height: `${percentOfSlotRange(nextMinutes - slot.minutes, 0, rangeWidth)}%`,
                  }
                : {
                    top: `${percentOfSlotRange(slot.minutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
                  }
            }
          />
        );
      })}
      {column.items.map((item) => {
        const eventProps = drag.getEventProps(item);
        const isEditable = item.occurrence.event.editable !== false;
        const itemStyle = withEventColorStyle(
          {
            top: `${percentOfSlotRange(item.startMinutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
            height: `${percentOfSlotRange(item.endMinutes - item.startMinutes, 0, rangeWidth)}%`,
            insetInlineStart: `${item.left * 100}%`,
            width: `${item.width * 100}%`,
          },
          item.occurrence.event.color ?? column.resource?.color,
        );
        return (
          <button
            type="button"
            key={item.occurrence.key}
            {...eventProps}
            data-koyomi="timegrid-event"
            data-continues-before={item.continuesBefore ? 'true' : undefined}
            data-continues-after={item.continuesAfter ? 'true' : undefined}
            style={itemStyle}
            aria-label={ariaLabelWithResource(
              item.occurrence,
              column.resource?.title,
              timeZone,
              locale,
              commonMessages,
            )}
            {...(eventTabbable === false ? { tabIndex: -1 } : {})}
          >
            <div data-koyomi="timegrid-event-content">
              {resolveEventContent(
                renderEvent,
                renderEventContent,
                item,
                item.occurrence,
                resourceTimedContentContext(item, locale),
              )}
            </div>
            {isEditable && !item.continuesBefore && (
              <div
                {...drag.getResizeHandleProps(item, 'start')}
                data-koyomi="timegrid-resize"
                data-edge="start"
              />
            )}
            {isEditable && !item.continuesAfter && (
              <div
                {...drag.getResizeHandleProps(item, 'end')}
                data-koyomi="timegrid-resize"
                data-edge="end"
              />
            )}
          </button>
        );
      })}
      {preview !== null && (
        <div
          data-koyomi="timegrid-preview"
          data-kind={preview.kind}
          aria-hidden="true"
          {...(preview.invalid ? { 'data-koyomi-invalid': 'true' } : {})}
          style={{
            top: `${percentOfSlotRange(preview.startMinutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
            height: `${percentOfSlotRange(preview.endMinutes - preview.startMinutes, 0, rangeWidth)}%`,
          }}
        />
      )}
      {isToday && nowIndicatorMinutes !== null && (
        <div
          data-koyomi="now-indicator"
          aria-hidden="true"
          style={{
            top: `${percentOfSlotRange(nowIndicatorMinutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
          }}
        />
      )}
    </div>
  );
}

/** `ResourceColumn` の、{@link ResourceColumnBodyImpl} の表示に影響する内容が等しいかどうかを比較する。 */
function sameResourceColumnForBody(a: ResourceColumn, b: ResourceColumn): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    // 単日表示では日が変わってもキーが変わらないため、日付キーも比較する
    a.dayKey === b.dayKey &&
    sameResource(a.resource, b.resource) &&
    samePositionedOccurrences(a.items, b.items)
  );
}

const ResourceColumnBody = memo(ResourceColumnBodyImpl, (prev, next) => {
  return (
    sameResourceColumnForBody(prev.column, next.column) &&
    sameSlots(prev.slots, next.slots) &&
    sameBusinessHourSlots(prev.businessHourSlots, next.businessHourSlots) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.slotMinTimeMinutes === next.slotMinTimeMinutes &&
    prev.slotMaxTimeMinutes === next.slotMaxTimeMinutes &&
    prev.isToday === next.isToday &&
    prev.nowIndicatorMinutes === next.nowIndicatorMinutes &&
    prev.renderEvent === next.renderEvent &&
    prev.renderEventContent === next.renderEventContent &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview) &&
    prev.columnWidth === next.columnWidth &&
    prev.pinned === next.pinned &&
    prev.left === next.left &&
    prev.eventTabbable === next.eventTabbable &&
    prev.commonMessages === next.commonMessages
  );
});

/**
 * 仮想化リソースビュー（`VirtualResourceView`）。
 *
 * `useCalendarContext()` のビューモデルが `'resource'` でない場合は `null` を返す。
 * `ref` 経由で {@link VirtualResourceViewHandle}（`scrollToResource`）を公開する。
 *
 * @example
 * ```tsx
 * const handleRef = useRef<VirtualResourceViewHandle>(null);
 * const calendar = useCalendar({ initialView: 'resource', resources });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
 *     <VirtualResourceView ref={handleRef} />
 *   </CalendarProvider>
 * );
 * // handleRef.current?.scrollToResource('room-5');
 * ```
 */
export function VirtualResourceView(props: VirtualResourceViewProps): ReactElement | null {
  const {
    renderEvent,
    renderAllDayItem,
    renderColumnHeader,
    columnWidth = DEFAULT_COLUMN_WIDTH,
    overscan,
    initialScrollTime,
    ref,
  } = props;
  const { api, state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const resourceMessages = messages.resource;
  const commonMessages = messages.common;
  const calendar = { api, state, viewModel };
  const drag = useResourceGridDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  const stableDrag = useStableResourceDrag(drag);

  const columns: readonly ResourceColumn[] = viewModel.type === 'resource' ? viewModel.columns : [];
  // viewModel.type !== 'resource'（早期 return 前）でもフックは無条件に呼ぶ必要があるため、
  // スクロール計算に使う表示時間帯（分）は安全な既定値へフォールバックする
  // （ResourceView と同じ方針）。
  const slotMinTimeMinutes = viewModel.type === 'resource' ? viewModel.slotMinTimeMinutes : 0;
  const slotMaxTimeMinutes =
    viewModel.type === 'resource' ? viewModel.slotMaxTimeMinutes : MINUTES_PER_DAY;

  // 縦横のスクロールはルート（[data-koyomi="resource"]）が一括で担う（見出し行は
  // sticky）。scrollToTime / initialScrollTime のスクロール量は、見出しを除いた
  // 本文（resource-body、bodyRef）の高さを基準に計算する。
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    setEnabled(true);
  }, []);

  // 時間軸の余白列（axis-gutter）の実測幅。スクロールコンテナ内でリソース列より
  // 「前」に同居する固定表示の列なので、その分だけ可視ビューポートを差し引く。
  const gutterRef = useRef<HTMLDivElement>(null);
  const [gutterWidth, setGutterWidth] = useState(0);
  useLayoutEffect(() => {
    const element = gutterRef.current;
    if (element === null) {
      return;
    }
    setGutterWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setGutterWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusedOccurrenceRef = useRef<string | null>(null);
  const pinnedKeys = useMemo(
    () => (focusedKey !== null ? new Set([focusedKey]) : undefined),
    [focusedKey],
  );

  const getItemKey = useCallback((index: number): string => columns[index]?.key ?? '', [columns]);
  const estimateSize = useCallback(() => columnWidth, [columnWidth]);
  const getScrollElement = useCallback((): HTMLElement | null => rootRef.current, []);

  const virtualizer = useVirtualizer({
    count: columns.length,
    getItemKey,
    estimateSize,
    getScrollElement,
    enabled,
    axis: 'horizontal',
    measure: false,
    viewportPadding: gutterWidth,
    ...(overscan !== undefined ? { overscan } : {}),
    ...(pinnedKeys !== undefined ? { pinnedKeys } : {}),
  });

  useImperativeHandle(
    ref,
    (): VirtualResourceViewHandle => ({
      scrollToResource(resourceId, options) {
        const index = columns.findIndex((column) => (column.resource?.id ?? null) === resourceId);
        if (index >= 0) {
          virtualizer.scrollToIndex(index, options);
        }
      },
      scrollToTime(time: string) {
        if (rootRef.current !== null && bodyRef.current !== null) {
          scrollContainerToTime(
            rootRef.current,
            time,
            slotMinTimeMinutes,
            slotMaxTimeMinutes,
            bodyRef.current,
          );
        }
      },
    }),
    [columns, virtualizer, slotMinTimeMinutes, slotMaxTimeMinutes],
  );

  // マウント時に一度だけ initialScrollTime を適用する（TimeGridView/ResourceView と同型。
  // 事後の initialScrollTime / 表示時間帯の変更では再適用しない意図的な設計のため、
  // 依存配列は空にする）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時に 1 回だけ実行する意図的な設計（initialScrollTime は「初期」スクロール位置であり、事後の変更を反映しない）
  useLayoutEffect(() => {
    if (initialScrollTime !== undefined && rootRef.current !== null && bodyRef.current !== null) {
      scrollContainerToTime(
        rootRef.current,
        initialScrollTime,
        slotMinTimeMinutes,
        slotMaxTimeMinutes,
        bodyRef.current,
      );
    }
  }, []);

  const warnedRef = useRef(false);
  useEffect(() => {
    if (!enabled || warnedRef.current || !isDevBuild()) {
      return;
    }
    if (
      columns.length > VIRTUALIZE_WARN_THRESHOLD &&
      virtualizer.virtualItems.length >= columns.length
    ) {
      warnedRef.current = true;
      // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の設定ミス警告（VirtualListView と同じ流儀）
      console.warn(
        `[koyomi] VirtualResourceView: 全 ${columns.length} 列が可視窓に入っており仮想化の効果が出ていません。` +
          'スクロールコンテナ [data-koyomi="resource"] の境界幅、境界幅が広すぎる、' +
          'または overscan 過大のいずれかを確認してください。',
      );
    }
  }, [enabled, columns.length, virtualizer.virtualItems.length]);

  /** フォーカスが入った列のキーを記録する（窓外へ出ても DOM を保持するため）。 */
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const cell = target.closest('[data-koyomi-column-key]');
    const key = cell?.getAttribute('data-koyomi-column-key') ?? null;
    if (key !== null) {
      focusedOccurrenceRef.current =
        target.closest('[data-koyomi-occurrence]')?.getAttribute('data-koyomi-occurrence') ?? null;
      setFocusedKey(key);
    }
  }, []);

  /** フォーカスがリソースビュー外へ抜けたら pinned を解除する。 */
  const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    focusedOccurrenceRef.current = null;
    setFocusedKey(null);
  }, []);

  // 可視列から pinned 列へ切り替わる瞬間は同じキーの要素でも DOM が置き換わるため、
  // ブラウザが body へ戻したフォーカスを対応するオカレンスへ復元する。
  useLayoutEffect(() => {
    const root = rootRef.current;
    const occurrenceKey = focusedOccurrenceRef.current;
    if (root === null || occurrenceKey === null || root.contains(document.activeElement)) {
      return;
    }
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-koyomi-occurrence]')).find(
      (element) => element.getAttribute('data-koyomi-occurrence') === occurrenceKey,
    );
    target?.focus({ preventScroll: true });
  });

  if (viewModel.type !== 'resource') {
    return null;
  }

  const { slots, nowIndicatorMinutes, isEmpty } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  // 複数日表示（resourceViewDays >= 2）では列見出し・終日セルの aria-label に日ラベルを付ける
  const multiDay = isMultiDayResourceView(viewModel);
  // 終日プレビュー対象列（isAllDayPreviewTarget）に反映する invalid（ResourceView と同じ計算）
  const isPreviewInvalid = state.dragPreview?.invalid ?? false;
  // businessHours 未指定（既定 []）のときは `timegrid-slot` 罫線 div 自体を描画しない
  // （businessHours 拡張前の VirtualResourceView は列本文にスロット罫線を持たなかった
  // ため、既定出力を旧版と一致させる。ResourceView は元々無条件描画のためこの分岐は不要）。

  if (isEmpty) {
    return (
      <div data-koyomi="resource">
        <div data-koyomi="resource-empty">{resourceMessages.empty}</div>
      </div>
    );
  }

  const visible = virtualizer.virtualItems;
  const pinned = virtualizer.pinnedItems;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: フォーカス保持の onFocus/onBlur は列見出し・終日行・本文をまたぐルート（役割なしの ResourceView と同じ構造）に置く必要がある
    <div
      ref={rootRef}
      data-koyomi="resource"
      data-koyomi-virtualized="true"
      data-koyomi-columns={String(columns.length)}
      style={withTimegridHoursStyle(slotMinTimeMinutes, slotMaxTimeMinutes)}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA grid（ResourceView と同じ方針） */}
      <div data-koyomi="resource-grid" role="grid">
        {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない */}
        <div data-koyomi="resource-header" role="row">
          <div ref={gutterRef} data-koyomi="timegrid-axis-gutter" role="presentation" />
          <div data-koyomi="resource-headers" role="presentation">
            <div
              data-koyomi="resource-header-spacer"
              data-edge="before"
              aria-hidden="true"
              style={{ width: `${virtualizer.beforeSize}px` }}
            />
            {visible.map((item) => {
              const column = columns[item.index];
              return column !== undefined ? (
                <HeaderCell
                  key={column.key}
                  column={column}
                  unassignedLabel={resourceMessages.unassigned}
                  renderColumnHeader={renderColumnHeader}
                  columnWidth={columnWidth}
                  multiDay={multiDay}
                  timeZone={timeZone}
                  locale={locale}
                />
              ) : null;
            })}
            <div
              data-koyomi="resource-header-spacer"
              data-edge="after"
              aria-hidden="true"
              style={{ width: `${virtualizer.afterSize}px` }}
            />
            {pinned.map((item) => {
              const column = columns[item.index];
              return column !== undefined ? (
                <HeaderCell
                  key={column.key}
                  column={column}
                  unassignedLabel={resourceMessages.unassigned}
                  renderColumnHeader={renderColumnHeader}
                  columnWidth={columnWidth}
                  multiDay={multiDay}
                  timeZone={timeZone}
                  locale={locale}
                  pinned
                  left={item.start}
                />
              ) : null;
            })}
          </div>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない */}
        <div data-koyomi="allday-row" role="row">
          <div data-koyomi="timegrid-axis-gutter" role="presentation" />
          <div data-koyomi="resource-allday-cells" role="presentation">
            <div
              data-koyomi="resource-allday-spacer"
              data-edge="before"
              aria-hidden="true"
              style={{ width: `${virtualizer.beforeSize}px` }}
            />
            {visible.map((item) => {
              const column = columns[item.index];
              return column !== undefined ? (
                <AllDayCell
                  key={column.key}
                  column={column}
                  unassignedLabel={resourceMessages.unassigned}
                  columnWidth={columnWidth}
                  drag={stableDrag}
                  isDragging={drag.isDragging}
                  isPreviewTarget={drag.isAllDayPreviewTarget(column)}
                  isPreviewInvalid={isPreviewInvalid}
                  multiDay={multiDay}
                  timeZone={timeZone}
                  locale={locale}
                  renderAllDayItem={renderAllDayItem}
                  renderEventContent={renderEventContent}
                  commonMessages={commonMessages}
                />
              ) : null;
            })}
            <div
              data-koyomi="resource-allday-spacer"
              data-edge="after"
              aria-hidden="true"
              style={{ width: `${virtualizer.afterSize}px` }}
            />
            {pinned.map((item) => {
              const column = columns[item.index];
              return column !== undefined ? (
                <AllDayCell
                  key={column.key}
                  column={column}
                  unassignedLabel={resourceMessages.unassigned}
                  columnWidth={columnWidth}
                  drag={stableDrag}
                  isDragging={drag.isDragging}
                  isPreviewTarget={drag.isAllDayPreviewTarget(column)}
                  isPreviewInvalid={isPreviewInvalid}
                  multiDay={multiDay}
                  timeZone={timeZone}
                  locale={locale}
                  pinned
                  left={item.start}
                  itemTabbable={false}
                  renderAllDayItem={renderAllDayItem}
                  renderEventContent={renderEventContent}
                  commonMessages={commonMessages}
                />
              ) : null;
            })}
          </div>
        </div>
      </div>
      <div ref={bodyRef} data-koyomi="resource-body">
        <div data-koyomi="time-axis">
          {slots.map((slot) => (
            <div key={slot.minutes} data-koyomi="time-slot-label">
              {slot.label}
            </div>
          ))}
        </div>
        <div data-koyomi="resource-columns">
          <div
            data-koyomi="resource-columns-spacer"
            data-edge="before"
            aria-hidden="true"
            style={{ width: `${virtualizer.beforeSize}px` }}
          />
          {visible.map((item) => {
            const column = columns[item.index];
            return column !== undefined ? (
              <ResourceColumnBody
                key={column.key}
                column={column}
                slots={slots}
                businessHourSlots={businessHourSlotsForColumn(viewModel, column)}
                timeZone={timeZone}
                locale={locale}
                slotMinTimeMinutes={slotMinTimeMinutes}
                slotMaxTimeMinutes={slotMaxTimeMinutes}
                isToday={column.isToday}
                nowIndicatorMinutes={nowIndicatorMinutes}
                renderEvent={renderEvent}
                renderEventContent={renderEventContent}
                drag={stableDrag}
                isDragging={drag.isDragging}
                preview={drag.previewFor(column)}
                columnWidth={columnWidth}
                commonMessages={commonMessages}
              />
            ) : null;
          })}
          <div
            data-koyomi="resource-columns-spacer"
            data-edge="after"
            aria-hidden="true"
            style={{ width: `${virtualizer.afterSize}px` }}
          />
          {pinned.map((item) => {
            const column = columns[item.index];
            return column !== undefined ? (
              <ResourceColumnBody
                key={column.key}
                column={column}
                slots={slots}
                businessHourSlots={businessHourSlotsForColumn(viewModel, column)}
                timeZone={timeZone}
                locale={locale}
                slotMinTimeMinutes={slotMinTimeMinutes}
                slotMaxTimeMinutes={slotMaxTimeMinutes}
                isToday={column.isToday}
                nowIndicatorMinutes={nowIndicatorMinutes}
                renderEvent={renderEvent}
                renderEventContent={renderEventContent}
                drag={stableDrag}
                isDragging={drag.isDragging}
                preview={drag.previewFor(column)}
                columnWidth={columnWidth}
                pinned
                left={item.start}
                eventTabbable={false}
                commonMessages={commonMessages}
              />
            ) : null;
          })}
        </div>
      </div>
    </div>
  );
}
