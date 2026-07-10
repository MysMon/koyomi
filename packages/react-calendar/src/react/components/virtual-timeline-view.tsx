/**
 * @packageDocumentation
 * `VirtualTimelineView` — タイムラインビューの行（リソース行）を縦方向に仮想化する
 * ヘッドレスコンポーネント。
 *
 * 大量のリソースを扱う画面で行の DOM ノードが肥大するのを避けるため、可視範囲の
 * リソース行だけを描画する。仮想化のプリミティブは {@link useVirtualizer}（`VirtualListView`
 * と同じ）。DOM 構造・ARIA（`role="grid"` / `row` / `columnheader` / `rowheader` /
 * `gridcell`）は `TimelineView` と同じ方針（`docs/accessibility.md` 参照）。
 *
 * `TimelineView` 自体は変更しない別コンポーネント方式で追加する（既存の DOM・挙動は不変）。
 * ヘッダー行（日ヘッダー・時刻目盛り）は `position: sticky` でスクロールコンテナの先頭に
 * 固定されており、仮想化する行リストより「前」に同居する。そのため窓計算では
 * {@link useVirtualizer} の `viewportPadding` にヘッダーの実測高さを渡し、
 * ヘッダーが常時占有する分だけ可視ビューポートを差し引く（詳細は `useVirtualizer` の
 * TSDoc 参照）。横スクロール（時間軸）はスクロールコンテナ 1 つが担うため、
 * `TimelineView` 同様スクロール同期の JS は追加不要。
 */

import type {
  CSSProperties,
  ReactElement,
  FocusEvent as ReactFocusEvent,
  ReactNode,
  Ref,
} from 'react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TimelineItem, TimelineRow, TimeZoneId } from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import { useIsomorphicLayoutEffect } from '../use-isomorphic-layout-effect';
import type { TimelinePreviewSegment } from '../use-timeline-drag';
import { useTimelineDrag } from '../use-timeline-drag';
import { useVirtualizer } from '../use-virtualizer';
import { formatDayHeader } from './format';
import { formatEventAriaLabel, withEventColorStyle } from './month-view-parts';
import type { TimelineRowDragHandlers } from './timeline-view-parts';
import {
  DEFAULT_CORNER_LABEL,
  DEFAULT_EMPTY_LABEL,
  DEFAULT_UNASSIGNED_LABEL,
  MINUTES_PER_DAY,
  samePreviewSegment,
  sameTimelineRow,
  toDivRef,
  useStableTimelineDrag,
  withLaneCountStyle,
} from './timeline-view-parts';

/** `estimateRowHeight` 省略時の 1 レーンあたりの推定高（px、既定テーマの `--koyomi-timeline-lane-height` と同じ値）。 */
const DEFAULT_LANE_HEIGHT = 28;

/**
 * 仮想化が効いていない旨を開発警告する行数の閾値。これ未満の少ない行数は
 * 全件描画でも問題にならないため警告しない（誤検知を避ける）。
 */
const VIRTUALIZE_WARN_THRESHOLD = 40;

/** `VirtualTimelineView` の props。`TimelineView` のカスタマイズ props に仮想化固有の設定を加える。 */
export interface VirtualTimelineViewProps {
  /** 帯（タイムラインアイテム）の表示内容をカスタマイズする関数。省略時はタイトルのみ。 */
  renderEvent?: (item: TimelineItem) => ReactNode;
  /** 行見出しの内容をカスタマイズする関数（第 2 引数に既定内容）。 */
  renderRowHeader?: (row: TimelineRow, defaultContent: ReactNode) => ReactNode;
  /** 未割り当て行の見出しラベル。省略時は「未割り当て」。 */
  unassignedLabel?: ReactNode;
  /** 空状態（行が 1 つもない）のメッセージ。省略時は「リソースがありません」。 */
  emptyLabel?: ReactNode;
  /** ヘッダー行の角セルの `aria-label`。省略時は「リソース」。 */
  cornerLabel?: string;
  /**
   * 行 1 件分の推定高（px）。件数に応じて変えたい場合は関数で渡す。
   * 実測（ResizeObserver）が入るまでの暫定値。既定はレーン数 × 28px
   * （既定テーマの `--koyomi-timeline-lane-height` と同じ）。
   */
  estimateRowHeight?: number | ((row: TimelineRow, index: number) => number);
  /** 前後 overscan 行数。既定 3。 */
  overscan?: number;
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
  unassignedLabel: ReactNode;
  renderEvent: ((item: TimelineItem) => ReactNode) | undefined;
  renderRowHeader: ((row: TimelineRow, defaultContent: ReactNode) => ReactNode) | undefined;
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
}

/** タイムラインの 1 行分（行見出し + 帯トラック）を描画する（`TimelineView` と同じ DOM 仕様）。 */
function TimelineRowGroupImpl(props: TimelineRowGroupProps): ReactElement {
  const {
    row,
    timeZone,
    locale,
    totalMinutes,
    nowIndicatorMinutes,
    unassignedLabel,
    renderEvent,
    renderRowHeader,
    drag,
    preview,
    rowRef,
    pinned,
    style,
    itemTabbable,
  } = props;
  const { ref, ...rowProps } = drag.getRowProps(row);
  const headerContent = row.resource?.title ?? unassignedLabel;

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
        {...(row.resource !== null ? { 'data-koyomi-resource-id': row.resource.id } : {})}
        style={withEventColorStyle({}, row.resource?.color)}
      >
        {renderRowHeader ? renderRowHeader(row, headerContent) : headerContent}
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
        {row.items.map((item) => {
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
          const ariaLabel =
            row.resource === null
              ? formatEventAriaLabel(occurrence, timeZone, locale)
              : `${formatEventAriaLabel(occurrence, timeZone, locale)}、${row.resource.title}`;
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
              aria-label={ariaLabel}
              {...(itemTabbable === false ? { tabIndex: -1 } : {})}
            >
              <div data-koyomi="timeline-item-content">
                {renderEvent ? renderEvent(item) : occurrence.event.title}
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
    prev.unassignedLabel === next.unassignedLabel &&
    prev.renderEvent === next.renderEvent &&
    prev.renderRowHeader === next.renderRowHeader &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview) &&
    prev.rowRef === next.rowRef &&
    prev.pinned === next.pinned &&
    prev.style === next.style &&
    prev.itemTabbable === next.itemTabbable
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
export const VirtualTimelineView = forwardRef<VirtualTimelineViewHandle, VirtualTimelineViewProps>(
  function VirtualTimelineView(props, ref): ReactElement | null {
    const {
      renderEvent,
      renderRowHeader,
      unassignedLabel = DEFAULT_UNASSIGNED_LABEL,
      emptyLabel = DEFAULT_EMPTY_LABEL,
      cornerLabel = DEFAULT_CORNER_LABEL,
      estimateRowHeight,
      overscan,
    } = props;
    const { api, state, viewModel, callbacks } = useCalendarContext();
    const calendar = { api, state, viewModel };
    const drag = useTimelineDrag({ calendar, callbacks });
    const stableDrag = useStableTimelineDrag(drag);

    const rows: readonly TimelineRow[] = viewModel.type === 'timeline' ? viewModel.rows : [];

    const scrollRef = useRef<HTMLDivElement>(null);
    // SSR・初回クライアント render は非仮想化（全件）。マウント後に仮想化へ切り替える
    // ことで hydration 不一致を避ける（VirtualListView と同じ）。
    const [enabled, setEnabled] = useState(false);
    useIsomorphicLayoutEffect(() => {
      setEnabled(true);
    }, []);

    // ヘッダー行（sticky）の実測高。スクロールコンテナ内で行リストより前に同居するため、
    // その分だけ可視ビューポートを差し引く（useVirtualizer の viewportPadding）。
    const headerRef = useRef<HTMLDivElement>(null);
    const [headerHeight, setHeaderHeight] = useState(0);
    useIsomorphicLayoutEffect(() => {
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

    // フォーカス中の行のキー。窓外へスクロールしても DOM を保持し続け、
    // フォーカス喪失を防ぐため pinnedKeys に渡す（VirtualListView と同じ方式）。
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
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
      if (
        rows.length > VIRTUALIZE_WARN_THRESHOLD &&
        virtualizer.virtualItems.length >= rows.length
      ) {
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
        setFocusedKey(key);
      }
    }, []);

    /** フォーカスがタイムライン外へ抜けたら pinned を解除する。 */
    const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) {
        return;
      }
      setFocusedKey(null);
    }, []);

    if (viewModel.type !== 'timeline') {
      return null;
    }

    const { days, slots, totalMinutes, nowIndicatorMinutes, isEmpty } = viewModel;
    const { timeZone, options } = state;
    const { locale } = options;

    if (isEmpty) {
      return (
        <div data-koyomi="timeline">
          <div data-koyomi="timeline-empty">{emptyLabel}</div>
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
        unassignedLabel={unassignedLabel}
        renderEvent={renderEvent}
        renderRowHeader={renderRowHeader}
        drag={stableDrag}
        isDragging={drag.isDragging}
        preview={drag.previewFor(row)}
        rowRef={virtualizer.measureElement(row.key)}
        {...(extra.pinned === true ? { pinned: true, itemTabbable: false } : {})}
        {...(extra.style !== undefined ? { style: extra.style } : {})}
      />
    );

    return (
      // biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA grid（TimelineView と同じ方針）
      <div
        data-koyomi="timeline"
        data-koyomi-virtualized="true"
        data-koyomi-days={String(days.length)}
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
            <div data-koyomi="timeline-corner" role="columnheader" aria-label={cornerLabel} />
            {/* biome-ignore lint/a11y/useSemanticElements: div ベースの ARIA columnheader */}
            {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない */}
            <div data-koyomi="timeline-axis" role="columnheader">
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
  },
);
