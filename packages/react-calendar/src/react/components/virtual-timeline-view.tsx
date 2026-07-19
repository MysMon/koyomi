/**
 * @packageDocumentation
 * `VirtualTimelineView` — タイムラインビューを行（縦方向）× 時間軸（横方向）の
 * 二軸で仮想化するヘッドレスコンポーネント。
 *
 * 大量のリソース・長い表示期間を扱う画面で DOM ノードが肥大するのを避けるため、
 * 可視範囲のリソース行と、横スクロールの可視範囲に重なる日の時間軸セル・帯だけを
 * 描画する。仮想化のプリミティブはどちらも {@link useVirtualizer}（縦は `VirtualListView`、
 * 横は `VirtualResourceView` の `axis: 'horizontal'` と同じ）。DOM 構造・ARIA
 * （`role="grid"` / `row` / `columnheader` / `rowheader` / `gridcell`）は `TimelineView` と
 * 同じ方針（`docs/accessibility.md` 参照）。
 *
 * `TimelineView` 自体は変更しない別コンポーネント方式で追加する（既存の DOM・挙動は不変）。
 * ヘッダー行（日ヘッダー・時刻目盛り）は `position: sticky` でスクロールコンテナの先頭に
 * 固定されており、仮想化する行リストより「前」に同居する。そのため窓計算では
 * {@link useVirtualizer} の `viewportPadding` にヘッダーの実測高さを渡し、
 * ヘッダーが常時占有する分だけ可視ビューポートを差し引く（詳細は `useVirtualizer` の
 * TSDoc 参照）。横スクロール（時間軸）はスクロールコンテナ 1 つが担うため、
 * `TimelineView` 同様スクロール同期の JS は追加不要。
 *
 * 時間軸（横方向）の仮想化は「1 日 = 1 アイテム」の windowing で行う。帯・時刻目盛り・
 * 営業時間帯はトラック（全表示日分の幅を持つ要素）に対する % 座標の絶対配置のため、
 * 横窓の描画は px スペーサへの置き換えではなく「窓に重なるものだけを描画対象にする」
 * フィルタで実現でき、スクロール位置・座標系には影響しない。フロー配置の日ヘッダー・
 * グループ見出しのみ、窓外の分を % 幅スペーサ（`timeline-header-spacer`）へ置き換える。
 * 行見出し列（左端固定列）は横スクロールでも sticky で常時占有するため、その実測幅を
 * 横方向の `viewportPadding` として差し引く。
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
import type { BusinessHourRange, TimelineItem, TimelineRow, TimeZoneId } from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { CommonMessages, TimelineMessages } from '../locales/types';
import type { EventContentContext, EventContentRenderer, SlotRenderContext } from '../types';
import type { TimelinePreviewSegment } from '../use-timeline-drag';
import { useTimelineDrag } from '../use-timeline-drag';
import { useVirtualizer } from '../use-virtualizer';
import { resolveEventContent, titleOnlyEventContentContext } from './event-content';
import { withEventColorStyle } from './month-view-parts';
import { ariaLabelWithResource } from './resource-view-parts';
import type { TimelineRowDragHandlers } from './timeline-view-parts';
import {
  formatTimelineItemTimeText,
  MINUTES_PER_DAY,
  overlapsTimeWindow,
  sameBusinessHourRanges,
  samePreviewSegment,
  sameTimelineRow,
  sameTimeWindow,
  TimelineAxisHeader,
  type TimelineTimeWindow,
  toDivRef,
  useStableTimelineDrag,
  withDepthStyle,
  withLaneCountStyle,
  withTimelineDaysStyle,
} from './timeline-view-parts';

/** `estimateRowHeight` 省略時の 1 レーンあたりの推定高（px、既定テーマの `--koyomi-timeline-lane-height` と同じ値）。 */
const DEFAULT_LANE_HEIGHT = 28;

/**
 * `overscanDays` 省略時の既定値。時間軸（横方向）は 1 日分の幅が大きい
 * （既定テーマで 720px）ため、行方向の既定（3）より小さくする。
 */
const DEFAULT_OVERSCAN_DAYS = 1;

/**
 * 仮想化が効いていない旨を開発警告する行数の閾値。これ未満の少ない行数は
 * 全件描画でも問題にならないため警告しない（誤検知を避ける）。
 */
const VIRTUALIZE_WARN_THRESHOLD = 40;

/** `VirtualTimelineView` の props。`TimelineView` のカスタマイズ props に仮想化固有の設定を加える。 */
export interface VirtualTimelineViewProps {
  /** 帯（タイムラインアイテム）の表示内容をカスタマイズする関数。省略時はタイトルのみ（{@link TimelineView} と同じ）。 */
  renderEvent?: (item: TimelineItem, ctx: EventContentContext) => ReactNode;
  /** 行見出しの内容をカスタマイズする関数（第 2 引数の ctx に既定内容。{@link TimelineView} と同じ）。 */
  renderRowHeader?: (row: TimelineRow, ctx: SlotRenderContext) => ReactNode;
  /**
   * 行 1 件分の推定高（px）。件数に応じて変えたい場合は関数で渡す。
   * 実測（ResizeObserver）が入るまでの暫定値。既定はレーン数 × 28px
   * （既定テーマの `--koyomi-timeline-lane-height` と同じ）。
   */
  estimateRowHeight?: number | ((row: TimelineRow, index: number) => number);
  /** 前後 overscan 行数。既定 3。 */
  overscan?: number;
  /**
   * 時間軸（横方向）の前後 overscan 日数。既定 1。
   * 時間軸の仮想化は横スクロールの可視範囲に重なる日の時間軸セル
   * （日ヘッダー・グループ見出し・時刻目盛り）と帯だけを描画する。
   */
  overscanDays?: number;
  /**
   * {@link VirtualTimelineViewHandle}（スクロール操作などの命令的 API）を受け取る ref。
   */
  // React 本体の RefAttributes と同じく明示的な undefined を許容する
  // （exactOptionalPropertyTypes 下で `ref={maybeUndefined}` を書けるようにするため）
  ref?: Ref<VirtualTimelineViewHandle> | undefined;
}

/** {@link VirtualTimelineView} が `ref` 経由で公開する命令的 API。 */
export interface VirtualTimelineViewHandle {
  /**
   * 指定リソースの行を可視域へスクロールする。
   * @param resourceId - スクロール先のリソース ID。未割り当て行へスクロールしたい場合は `null`
   * @param options - `align` 省略時は `'auto'`（可視域の外にあるときだけ最小限スクロール）
   */
  scrollToResource(
    resourceId: string | null,
    options?: { align?: 'auto' | 'start' | 'center' },
  ): void;
}

/** `TimelineRowGroupImpl` の props。 */
interface TimelineRowGroupProps {
  row: TimelineRow;
  timeZone: TimeZoneId;
  locale: string;
  totalMinutes: number;
  nowIndicatorMinutes: number | null;
  /** {@link TimelineViewModel.businessHourRanges}（全行共通）。 */
  businessHourRanges: readonly BusinessHourRange[];
  unassignedLabel: ReactNode;
  renderEvent: ((item: TimelineItem, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  renderRowHeader: ((row: TimelineRow, ctx: SlotRenderContext) => ReactNode) | undefined;
  drag: TimelineRowDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う）。 */
  isDragging: boolean;
  preview: TimelinePreviewSegment | null;
  /** 仮想化: 高さ実測用の ref コールバック。 */
  rowRef?: Ref<HTMLElement>;
  /** 仮想化: 窓外フォーカス保持行（`data-koyomi-pinned="true"`）。 */
  pinned?: boolean;
  /** 仮想化: 絶対配置の `top` など、位置決めの数値のみを持つ inline style。 */
  style?: CSSProperties;
  /** 仮想化: 帯をタブ順に含めるか。既定 `true`（`false` で `tabIndex=-1`）。 */
  itemTabbable?: boolean;
  /**
   * 仮想化: 時間軸（横方向）の可視ウィンドウ。指定時はウィンドウに重なる帯・
   * 営業時間帯だけを描画する。省略時は全範囲を描画する。
   */
  timeWindow?: TimelineTimeWindow;
  /**
   * 仮想化: 横窓外でも描画し続ける帯のオカレンスキー（フォーカス保持用。通常 0〜1 件）。
   * 帯は % 座標の絶対配置のため、pinned 行のような位置決めスタイルの追加は不要で、
   * 描画対象へ含めるだけで同じ位置に表示される。
   */
  pinnedItemKey?: string | null;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  /** 折りたたみトグルボタンのクリックハンドラ（`api.toggleResourceCollapsed` へ委譲）。 */
  onToggleCollapse: (resourceId: string) => void;
  /** 中央メッセージカタログの `timeline` グループ（折りたたみトグルボタンの aria-label 組み立てに使う）。 */
  timelineMessages: TimelineMessages;
}

/** タイムラインの 1 行分（行見出し + 帯トラック）を描画する（`TimelineView` と同じ DOM 仕様）。 */
function TimelineRowGroupImpl(props: TimelineRowGroupProps): ReactElement {
  const {
    row,
    timeZone,
    locale,
    totalMinutes,
    nowIndicatorMinutes,
    businessHourRanges,
    unassignedLabel,
    renderEvent,
    renderEventContent,
    renderRowHeader,
    drag,
    preview,
    rowRef,
    pinned,
    style,
    itemTabbable,
    timeWindow,
    pinnedItemKey,
    commonMessages,
    onToggleCollapse,
    timelineMessages,
  } = props;
  const { ref, ...rowProps } = drag.getRowProps(row);
  const resource = row.resource;
  const headerContent = resource?.title ?? unassignedLabel;
  // 時間軸（横方向）の windowing: ウィンドウに重なる帯＋フォーカス保持の帯だけを描画する。
  const visibleItems =
    timeWindow === undefined
      ? row.items
      : row.items.filter(
          (item) =>
            overlapsTimeWindow(item.startMinutes, item.endMinutes, timeWindow) ||
            item.occurrence.key === pinnedItemKey,
        );
  const visibleBusinessHourRanges =
    timeWindow === undefined
      ? businessHourRanges
      : businessHourRanges.filter((range) =>
          overlapsTimeWindow(range.startMinutes, range.endMinutes, timeWindow),
        );

  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA row（TimelineView と同じ方針）
    // biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない
    <div
      ref={rowRef !== undefined ? toDivRef(rowRef) : undefined}
      data-koyomi="timeline-row-group"
      data-koyomi-row-key={row.key}
      role="row"
      {...(pinned === true ? { 'data-koyomi-pinned': 'true' } : {})}
      {...(style !== undefined ? { style } : {})}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA rowheader */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない */}
      <div
        data-koyomi="timeline-resource-header"
        role="rowheader"
        data-koyomi-depth={String(row.depth)}
        {...(resource !== null ? { 'data-koyomi-resource-id': resource.id } : {})}
        style={withDepthStyle(withEventColorStyle({}, resource?.color), row.depth)}
      >
        {row.hasChildren && resource !== null && (
          <button
            type="button"
            data-koyomi="timeline-row-toggle"
            aria-expanded={!row.collapsed}
            aria-label={timelineMessages.resourceToggleAriaLabel(resource, row.collapsed)}
            onClick={() => onToggleCollapse(resource.id)}
            {...(itemTabbable === false ? { tabIndex: -1 } : {})}
          >
            ▸
          </button>
        )}
        {renderRowHeader ? renderRowHeader(row, { defaultContent: headerContent }) : headerContent}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA gridcell */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: gridcell 自体はフォーカス対象にしない */}
      <div
        {...rowProps}
        ref={toDivRef(ref)}
        data-koyomi="timeline-row"
        role="gridcell"
        style={withLaneCountStyle(row.laneCount)}
      >
        {visibleBusinessHourRanges.map((range) => (
          <div
            key={`${range.startMinutes}-${range.endMinutes}`}
            data-koyomi="timeline-business-hours"
            aria-hidden="true"
            style={{
              insetInlineStart: `${(range.startMinutes / totalMinutes) * 100}%`,
              width: `${((range.endMinutes - range.startMinutes) / totalMinutes) * 100}%`,
            }}
          />
        ))}
        {visibleItems.map((item) => {
          const itemProps = drag.getItemProps(item);
          const occurrence = item.occurrence;
          const isEditable = occurrence.event.editable !== false;
          const itemStyle = withEventColorStyle(
            {
              insetInlineStart: `${(item.startMinutes / totalMinutes) * 100}%`,
              width: `${((item.endMinutes - item.startMinutes) / totalMinutes) * 100}%`,
              top: `calc(${item.lane} * var(--koyomi-timeline-lane-height, 28px))`,
            },
            occurrence.event.color ?? row.resource?.color,
          );
          return (
            <button
              type="button"
              key={occurrence.key}
              {...itemProps}
              data-koyomi="timeline-item"
              data-koyomi-lane={String(item.lane)}
              data-all-day={occurrence.allDay ? 'true' : undefined}
              data-continues-before={item.continuesBefore ? 'true' : undefined}
              data-continues-after={item.continuesAfter ? 'true' : undefined}
              style={itemStyle}
              aria-label={ariaLabelWithResource(
                occurrence,
                row.resource?.title,
                timeZone,
                locale,
                commonMessages,
              )}
              {...(itemTabbable === false ? { tabIndex: -1 } : {})}
            >
              <div data-koyomi="timeline-item-content">
                {resolveEventContent(
                  renderEvent,
                  renderEventContent,
                  item,
                  occurrence,
                  titleOnlyEventContentContext(
                    'timeline-item',
                    'timeline',
                    occurrence.event.title,
                    formatTimelineItemTimeText(
                      occurrence,
                      timeZone,
                      locale,
                      commonMessages.rangeSeparator,
                    ),
                  ),
                )}
              </div>
              {isEditable && !occurrence.allDay && !item.continuesBefore && (
                <div
                  {...drag.getResizeHandleProps(item, 'start')}
                  data-koyomi="timeline-resize"
                  data-edge="start"
                />
              )}
              {isEditable && !occurrence.allDay && !item.continuesAfter && (
                <div
                  {...drag.getResizeHandleProps(item, 'end')}
                  data-koyomi="timeline-resize"
                  data-edge="end"
                />
              )}
            </button>
          );
        })}
        {preview !== null && (
          <div
            data-koyomi="timeline-preview"
            data-kind={preview.kind}
            aria-hidden="true"
            {...(preview.invalid ? { 'data-koyomi-invalid': 'true' } : {})}
            style={{
              insetInlineStart: `${(preview.startMinutes / totalMinutes) * 100}%`,
              width: `${((preview.endMinutes - preview.startMinutes) / totalMinutes) * 100}%`,
            }}
          />
        )}
        {nowIndicatorMinutes !== null && (
          <div
            data-koyomi="now-indicator"
            data-orientation="vertical"
            aria-hidden="true"
            style={{ insetInlineStart: `${(nowIndicatorMinutes / totalMinutes) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * {@link TimelineRowGroupImpl} を `memo` でラップしたもの（`timeline-view.tsx` の
 * `TimelineRowGroup` と同じ設計。`rowRef`/`pinned`/`style`/`itemTabbable` は
 * 仮想化専用の追加項目のため比較に含める）。
 */
const TimelineRowGroup = memo(TimelineRowGroupImpl, (prev, next) => {
  return (
    sameTimelineRow(prev.row, next.row) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.totalMinutes === next.totalMinutes &&
    prev.nowIndicatorMinutes === next.nowIndicatorMinutes &&
    sameBusinessHourRanges(prev.businessHourRanges, next.businessHourRanges) &&
    prev.unassignedLabel === next.unassignedLabel &&
    prev.renderEvent === next.renderEvent &&
    prev.renderEventContent === next.renderEventContent &&
    prev.renderRowHeader === next.renderRowHeader &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview) &&
    prev.rowRef === next.rowRef &&
    prev.pinned === next.pinned &&
    prev.style === next.style &&
    prev.itemTabbable === next.itemTabbable &&
    sameTimeWindow(prev.timeWindow, next.timeWindow) &&
    prev.pinnedItemKey === next.pinnedItemKey &&
    prev.commonMessages === next.commonMessages &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.timelineMessages === next.timelineMessages
  );
});

/**
 * 仮想化タイムラインビュー（`VirtualTimelineView`）。
 *
 * `useCalendarContext()` のビューモデルが `'timeline'` でない場合は `null` を返す。
 * `ref` 経由で {@link VirtualTimelineViewHandle}（`scrollToResource`）を公開する。
 *
 * @example
 * ```tsx
 * const handleRef = useRef<VirtualTimelineViewHandle>(null);
 * const calendar = useCalendar({ initialView: 'timeline', resources, timelineDays: 7 });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
 *     <VirtualTimelineView ref={handleRef} />
 *   </CalendarProvider>
 * );
 * // handleRef.current?.scrollToResource('room-5');
 * ```
 */
export function VirtualTimelineView(props: VirtualTimelineViewProps): ReactElement | null {
  const { renderEvent, renderRowHeader, estimateRowHeight, overscan, overscanDays, ref } = props;
  const { api, state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const timelineMessages = messages.timeline;
  const commonMessages = messages.common;
  const calendar = { api, state, viewModel };
  const drag = useTimelineDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  const stableDrag = useStableTimelineDrag(drag);
  // api の参照は再レンダリングを跨いで安定するため、onToggleCollapse も安定する
  // （`TimelineView` と同じ狙い）。
  const onToggleCollapse = useCallback(
    (resourceId: string) => {
      api.toggleResourceCollapsed(resourceId);
    },
    [api],
  );

  const rows: readonly TimelineRow[] = viewModel.type === 'timeline' ? viewModel.rows : [];
  const days = viewModel.type === 'timeline' ? viewModel.days : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  // SSR・初回クライアント render は非仮想化（全件）。マウント後に仮想化へ切り替える
  // ことで hydration 不一致を避ける（VirtualListView と同じ）。
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    setEnabled(true);
  }, []);

  // ヘッダー行（sticky）の実測高。スクロールコンテナ内で行リストより前に同居するため、
  // その分だけ可視ビューポートを差し引く（useVirtualizer の viewportPadding）。
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (element === null) {
      return;
    }
    setHeaderHeight(element.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setHeaderHeight(element.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 時間軸（timeline-axis）のトラック実測幅。1 日分の幅（トラック幅 ÷ 表示日数）の
  // 算出に使う。トラック幅は利用者 CSS（既定テーマは 1 日 720px の min-width）が決めるため、
  // ここでは実測するだけ（useVirtualizer と同じ「寸法を所有しない」方針）。
  const axisRef = useRef<HTMLDivElement>(null);
  const [axisWidth, setAxisWidth] = useState(0);
  useLayoutEffect(() => {
    const element = axisRef.current;
    if (element === null) {
      return;
    }
    setAxisWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setAxisWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 行見出し列（左端固定列）の実測幅。スクロールコンテナ内で時間軸トラックより
  // 「前」に同居する sticky 列なので、横の可視ビューポートからその分を差し引く
  // （横方向の viewportPadding。ヘッダー実測高と同じ扱い）。
  const cornerRef = useRef<HTMLDivElement>(null);
  const [cornerWidth, setCornerWidth] = useState(0);
  useLayoutEffect(() => {
    const element = cornerRef.current;
    if (element === null) {
      return;
    }
    setCornerWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setCornerWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // フォーカス中の行のキー。窓外へスクロールしても DOM を保持し続け、
  // フォーカス喪失を防ぐため pinnedKeys に渡す（VirtualListView と同じ方式）。
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // フォーカス中の帯のオカレンスキー。横窓外へスクロールしても帯の DOM を
  // 保持し続けるため、フォーカス行の TimelineRowGroup へ pinnedItemKey として渡す。
  const [focusedItemKey, setFocusedItemKey] = useState<string | null>(null);
  const focusedOccurrenceRef = useRef<string | null>(null);
  const pinnedKeys = useMemo(
    () => (focusedKey !== null ? new Set([focusedKey]) : undefined),
    [focusedKey],
  );

  const getItemKey = useCallback((index: number): string => rows[index]?.key ?? '', [rows]);
  const estimateSize = useCallback(
    (index: number): number => {
      const row = rows[index];
      if (typeof estimateRowHeight === 'function') {
        return row !== undefined ? estimateRowHeight(row, index) : DEFAULT_LANE_HEIGHT;
      }
      if (estimateRowHeight !== undefined) {
        return estimateRowHeight;
      }
      return row !== undefined
        ? Math.max(1, row.laneCount) * DEFAULT_LANE_HEIGHT
        : DEFAULT_LANE_HEIGHT;
    },
    [rows, estimateRowHeight],
  );
  const getScrollElement = useCallback((): HTMLElement | null => scrollRef.current, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey,
    estimateSize,
    getScrollElement,
    enabled,
    viewportPadding: headerHeight,
    ...(overscan !== undefined ? { overscan } : {}),
    ...(pinnedKeys !== undefined ? { pinnedKeys } : {}),
  });

  // 時間軸（横方向）の仮想化。1 日を 1 アイテムとして同じスクロールコンテナの
  // 横方向を windowing する（行仮想化との二軸構成）。1 日分の幅はトラック実測幅から
  // 均等割りで求まる固定値のため実測しない（measure: false。日幅は CSS が決める）。
  // トラック幅が未実測（0）の間は無効にし、全日描画へ無害に縮退する。
  const daySize = days.length > 0 ? axisWidth / days.length : 0;
  const getDayKey = useCallback((index: number): string => days[index]?.key ?? '', [days]);
  const estimateDaySize = useCallback((): number => daySize, [daySize]);
  const timeAxisEnabled = enabled && daySize > 0;
  const dayVirtualizer = useVirtualizer({
    count: days.length,
    getItemKey: getDayKey,
    estimateSize: estimateDaySize,
    getScrollElement,
    enabled: timeAxisEnabled,
    axis: 'horizontal',
    measure: false,
    viewportPadding: cornerWidth,
    overscan: overscanDays ?? DEFAULT_OVERSCAN_DAYS,
  });

  // 横窓（overscan 込みの日インデックス範囲）を表示分のウィンドウへ変換する。
  // 全日が窓に入るときは undefined（＝全範囲描画。TimelineView と同一 DOM）に落とし、
  // 帯・目盛りのフィルタ処理とスペーサ描画を丸ごと省く。
  // スクロールアンカリング: 日幅は CSS 由来の固定値（実測更新なし）のため、
  // 窓の移動でスクロール位置がずれることはなく、横方向の補正は不要。
  const dayItems = dayVirtualizer.virtualItems;
  const timeWindow = useMemo((): TimelineTimeWindow | undefined => {
    if (!timeAxisEnabled || dayItems.length === 0 || dayItems.length >= days.length) {
      return undefined;
    }
    const first = dayItems[0];
    const last = dayItems[dayItems.length - 1];
    if (first === undefined || last === undefined) {
      return undefined;
    }
    return {
      startMinutes: first.index * MINUTES_PER_DAY,
      endMinutes: (last.index + 1) * MINUTES_PER_DAY,
    };
  }, [timeAxisEnabled, dayItems, days.length]);

  useImperativeHandle(
    ref,
    (): VirtualTimelineViewHandle => ({
      scrollToResource(resourceId, options) {
        const index = rows.findIndex((row) => (row.resource?.id ?? null) === resourceId);
        if (index >= 0) {
          virtualizer.scrollToIndex(index, options);
        }
      },
    }),
    [rows, virtualizer],
  );

  // 仮想化の効果が出ていない場合、開発ビルドで一度だけ警告する（VirtualListView と同じ方針）。
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!enabled || warnedRef.current || !isDevBuild()) {
      return;
    }
    if (rows.length > VIRTUALIZE_WARN_THRESHOLD && virtualizer.virtualItems.length >= rows.length) {
      warnedRef.current = true;
      // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の設定ミス警告（VirtualListView と同じ流儀）
      console.warn(
        `[koyomi] VirtualTimelineView: 全 ${rows.length} 行が可視窓に入っており仮想化の効果が出ていません。` +
          'スクロールコンテナ [data-koyomi="timeline-body"] の境界高（max-height 等）未設定、' +
          '境界高が高すぎる、または overscan 過大のいずれかを確認してください。',
      );
    }
  }, [enabled, rows.length, virtualizer.virtualItems.length]);

  /** フォーカスが入った行のキーを記録する（窓外へ出ても DOM を保持するため）。 */
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const rowGroup = target.closest('[data-koyomi="timeline-row-group"]');
    const key = rowGroup?.getAttribute('data-koyomi-row-key') ?? null;
    if (key !== null) {
      const occurrenceKey =
        target.closest('[data-koyomi-occurrence]')?.getAttribute('data-koyomi-occurrence') ?? null;
      focusedOccurrenceRef.current = occurrenceKey;
      setFocusedItemKey(occurrenceKey);
      setFocusedKey(key);
    }
  }, []);

  /** フォーカスがタイムライン外へ抜けたら pinned を解除する。 */
  const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    focusedOccurrenceRef.current = null;
    setFocusedItemKey(null);
    setFocusedKey(null);
  }, []);

  // 可視行から pinned 行への DOM 置換で失われたイベントフォーカスを復元する。
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const occurrenceKey = focusedOccurrenceRef.current;
    if (root === null || occurrenceKey === null || root.contains(document.activeElement)) {
      return;
    }
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-koyomi-occurrence]')).find(
      (element) => element.getAttribute('data-koyomi-occurrence') === occurrenceKey,
    );
    target?.focus({ preventScroll: true });
  });

  if (viewModel.type !== 'timeline') {
    return null;
  }

  const {
    slots,
    totalMinutes,
    nowIndicatorMinutes,
    isEmpty,
    businessHourRanges,
    scale,
    headerGroups,
  } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;

  if (isEmpty) {
    return (
      <div data-koyomi="timeline" data-koyomi-scale={scale}>
        <div data-koyomi="timeline-empty">{timelineMessages.empty}</div>
      </div>
    );
  }

  /** 行を描画する（通常フロー・pinned の両方で使う）。 */
  const renderRow = (
    row: TimelineRow,
    extra: { pinned?: boolean; style?: CSSProperties },
  ): ReactElement => (
    <TimelineRowGroup
      key={row.key}
      row={row}
      timeZone={timeZone}
      locale={locale}
      totalMinutes={totalMinutes}
      nowIndicatorMinutes={nowIndicatorMinutes}
      businessHourRanges={businessHourRanges}
      unassignedLabel={timelineMessages.unassigned}
      renderEvent={renderEvent}
      renderEventContent={renderEventContent}
      renderRowHeader={renderRowHeader}
      drag={stableDrag}
      isDragging={drag.isDragging}
      preview={drag.previewFor(row)}
      commonMessages={commonMessages}
      onToggleCollapse={onToggleCollapse}
      timelineMessages={timelineMessages}
      rowRef={virtualizer.measureElement(row.key)}
      {...(timeWindow !== undefined ? { timeWindow } : {})}
      {...(row.key === focusedKey && focusedItemKey !== null
        ? { pinnedItemKey: focusedItemKey }
        : {})}
      {...(extra.pinned === true ? { pinned: true, itemTabbable: false } : {})}
      {...(extra.style !== undefined ? { style: extra.style } : {})}
    />
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA grid（TimelineView と同じ方針）
    <div
      data-koyomi="timeline"
      data-koyomi-scale={scale}
      data-koyomi-virtualized="true"
      data-koyomi-days={String(days.length)}
      style={withTimelineDaysStyle(days.length)}
      role="grid"
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div ref={scrollRef} data-koyomi="timeline-body" role="presentation">
        {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない */}
        <div ref={headerRef} data-koyomi="timeline-header-row" role="row">
          {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA columnheader */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない */}
          <div
            ref={cornerRef}
            data-koyomi="timeline-corner"
            role="columnheader"
            aria-label={timelineMessages.corner}
          />
          <TimelineAxisHeader
            days={days}
            slots={slots}
            headerGroups={headerGroups}
            scale={scale}
            totalMinutes={totalMinutes}
            timeZone={timeZone}
            locale={locale}
            rangeSeparator={commonMessages.rangeSeparator}
            axisRef={axisRef}
            {...(timeWindow !== undefined ? { timeWindow } : {})}
          />
        </div>
        <div data-koyomi="timeline-rows" role="presentation">
          <div
            data-koyomi="timeline-row-spacer"
            data-edge="before"
            aria-hidden="true"
            style={{ height: `${virtualizer.beforeSize}px` }}
          />
          {virtualizer.virtualItems.map((item) => {
            const row = rows[item.index];
            return row !== undefined ? renderRow(row, {}) : null;
          })}
          <div
            data-koyomi="timeline-row-spacer"
            data-edge="after"
            aria-hidden="true"
            style={{ height: `${virtualizer.afterSize}px` }}
          />
          {virtualizer.pinnedItems.map((item) => {
            const row = rows[item.index];
            // 位置決めに必須のスタイルは inline で出力する（ヘッドレス原則）。
            // position: absolute をテーマ CSS 任せにすると、独自 CSS の利用者では
            // pinned 行が通常フローへ割り込み、行の重複表示・高さ跳ねが起きる
            // （VirtualResourceView の columnPositionStyle と同じ方針）
            return row !== undefined
              ? renderRow(row, {
                  pinned: true,
                  style: {
                    position: 'absolute',
                    top: `${item.start}px`,
                    insetInlineStart: 0,
                    width: '100%',
                  },
                })
              : null;
          })}
        </div>
      </div>
    </div>
  );
}
