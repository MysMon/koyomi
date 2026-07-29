/**
 * @packageDocumentation
 * `ResourceView` — リソースビュー（列 = リソース × 日、縦 = 時間）を描画する
 * ヘッドレスコンポーネント。表示日数は `CalendarOptions.resourceViewDays`（既定 1）。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「リソースビュー（ResourceView）」節を参照。イベントブロック・リサイズハンドル・
 * 現在時刻線・プレビューは週/日ビューと同じ部位名（`timegrid-event` 等）を使い、
 * デフォルトテーマのスタイルを共有する。ドラッグ操作は
 * {@link useResourceGridDrag} に委譲する。
 *
 * a11y: 列見出し行・終日行はリソース単位の離散セルなので、両者だけをまとめた
 * `resource-grid`（`role="grid"`）の中で row/columnheader/gridcell を構成する
 * （TimeGridView と同じ方針）。本文（時間軸 + リソース列）は連続的な時間位置決めで
 * 離散セルに対応しないため grid 化しない。`role="grid"` の owned elements は
 * row/rowgroup に限られる（WAI-ARIA grid パターン）ため、本文は grid 化しないだけでなく
 * `resource-grid` の**外側**（兄弟要素）に置き、内部の予定ボタンが grid の子孫として
 * アクセシビリティツリーに漏れ出さないようにする。操作要素は `<button>` + 完全な
 * `aria-label`（日時 + リソース名）とする
 * （判断根拠・既知の制限の詳細は `docs/accessibility.md` 参照）。
 */

import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type {
  BusinessHourSlot,
  EventOccurrence,
  PositionedOccurrence,
  ResourceColumn,
  ResourceColumnGroupCell,
  TimeAxis,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { CommonMessages } from '../locales/types';
import { scrollContainerToTime } from '../scroll-to-time';
import type {
  EventContentContext,
  EventContentRenderer,
  MonthOverflowButtonProps,
  MonthOverflowLabelContext,
  SlotRenderContext,
} from '../types';
import type { ResourceGridDragHandlers, ResourcePreviewSegment } from '../use-resource-grid-drag';
import { useResourceGridDrag } from '../use-resource-grid-drag';
import { resolveEventContent } from './event-content';
import { formatTimeZoneLabel } from './format';
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
import { AllDayOverflowButton } from './time-grid-view';

/**
 * `ResourceView` の props。
 *
 * 時間指定イベントの表示内容は `renderEvent`、終日アイテムの表示内容は
 * `renderAllDayItem` でそれぞれ独立にカスタマイズする。
 */
export interface ResourceViewProps {
  /**
   * 時間指定イベントブロックの表示内容をカスタマイズする関数。
   * 省略時は時刻範囲（`'H:mm〜H:mm'`。週/日ビューと同じ形式）とタイトルを表示する。
   * 終日アイテムには適用されない
   * （終日アイテムの内容は {@link ResourceViewProps.renderAllDayItem} を使う）。
   *
   * `ctx.defaultContent` に省略時の内容、`ctx.parts` に分解済みパーツが渡される。
   * 指定した場合は `CalendarProvider` の `renderEventContent` より優先される。
   * @param item - 対象の配置済みオカレンス
   * @param ctx - 既定内容・スロット種別・分解済みパーツ
   */
  renderEvent?: (item: PositionedOccurrence, ctx: EventContentContext) => ReactNode;
  /**
   * 終日アイテムの表示内容をカスタマイズする関数。省略時はタイトルのみを表示する。
   * 指定した場合は `CalendarProvider` の `renderEventContent` より優先される。
   * @param occurrence - 対象のオカレンス
   * @param ctx - 既定内容・スロット種別・分解済みパーツ
   */
  renderAllDayItem?: (occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode;
  /**
   * 列見出しの内容をカスタマイズする関数。
   * `ctx.defaultContent` は既定の内容（リソース名、未割り当て列は `messages.resource.unassigned`）。
   * @param column - 対象の列
   * @param ctx - 既定内容
   */
  renderColumnHeader?: (column: ResourceColumn, ctx: SlotRenderContext) => ReactNode;
  /**
   * 終日行の「+N 件」ボタン（`allday-overflow`。
   * {@link CalendarOptions.allDayMaxEvents} 指定時のみ描画される）のラベル内容を
   * カスタマイズする。差し替えるのはボタンの内側の内容だけで、ボタン要素・
   * クリック配線（{@link CalendarInteractionCallbacks.onAllDayOverflowClick}）は
   * 保持される。省略時は中央メッセージカタログの `month.overflow`
   * （既定は「+N 件」）で整形した既定ラベルを表示する。
   * @param column - あふれのある列
   * @param ctx - 既定ラベルと非表示のオカレンス一覧
   */
  renderOverflowLabel?: (column: ResourceColumn, ctx: MonthOverflowLabelContext) => ReactNode;
  /**
   * 終日行の「+N 件」ボタンに追加する props を返す関数
   * （`aria-haspopup` / `aria-expanded` など。月ビューの同名 prop と同じ連携面で、
   * {@link overflowPopoverButtonProps} の戻り値をそのまま返せる）。
   * 省略時は追加の props を付与しない。
   * @param column - あふれのある列
   * @param hiddenOccurrences - 「+N 件」に集約された非表示のオカレンス一覧
   */
  overflowButtonProps?: (
    column: ResourceColumn,
    hiddenOccurrences: readonly EventOccurrence[],
  ) => MonthOverflowButtonProps;
  /**
   * マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置（`'HH:mm'`）。
   * 表示時間帯制限（{@link CalendarOptions.slotMinTime}/{@link CalendarOptions.slotMaxTime}）とは
   * 独立して機能する。事後に値を変更しても再適用されない（`ref.current.scrollToTime` を使うこと）。
   */
  initialScrollTime?: string;
  /**
   * {@link ResourceViewHandle}（`scrollToTime` などの命令的 API）を受け取る ref。
   */
  // React 本体の RefAttributes と同じく明示的な undefined を許容する
  // （exactOptionalPropertyTypes 下で `ref={maybeUndefined}` を書けるようにするため）
  ref?: Ref<ResourceViewHandle> | undefined;
}

/** {@link ResourceView} が `ref` 経由で公開する命令的 API。 */
export interface ResourceViewHandle {
  /**
   * スクロールコンテナ（`[data-koyomi="resource"]`）を指定時刻の位置へ
   * 縦スクロールする。時刻が表示時間帯の外側の場合は最も近い境界へクランプする。
   * `'HH:mm'` として解析できない場合は何もしない。
   */
  scrollToTime(time: string): void;
}

/**
 * `ResourceColumnBody` / `AllDayItemButton` が実際に必要とするドラッグハンドラだけを
 * 抜き出した型。`previewFor` / `isAllDayPreviewTarget` はここに含めない（{@link ResourceView}
 * 側で解決済みの値を `preview` / `data-koyomi-preview-target` として渡すため）。
 */
interface ResourceColumnDragHandlers {
  getColumnProps: ResourceGridDragHandlers['getColumnProps'];
  getEventProps: ResourceGridDragHandlers['getEventProps'];
  getResizeHandleProps: ResourceGridDragHandlers['getResizeHandleProps'];
  getAllDayItemProps: ResourceGridDragHandlers['getAllDayItemProps'];
}

/**
 * `useResourceGridDrag` の戻り値は毎レンダー新しいオブジェクト（関数含む）になるため、
 * そのまま `memo` 化した子コンポーネントの props に渡すと再レンダー抑制が効かない。
 * ここで参照が変わらないラッパーを 1 度だけ作り、呼び出し時に ref 経由で常に最新の
 * ハンドラへ委譲することで、props の同一性を保ったまま最新の挙動を保証する
 * （`time-grid-view.tsx` の `useStableColumnDrag` と同じ設計）。
 *
 * `virtual-resource-view.tsx` にもほぼ同じ関数・型があるが、`ResourceView` は
 * 終日セルの `getAllDayCellProps` を（`AllDayCell` を独立コンポーネント化していないため）
 * `drag` から直接呼んでおり、`stableDrag` 経由では渡さない。そのため
 * `ResourceColumnDragHandlers` にはこのフィールドを含めない。仮想化版は終日セルを
 * `memo` 化した独立コンポーネント（`AllDayCell`）に分けており、その props として
 * `getAllDayCellProps` を安定参照で渡す必要があるため 1 フィールド多い。
 * この差は DOM 構造上の理由による意図的なものなので、`resource-view-parts.tsx` へは
 * 統合していない。
 */
function useStableResourceDrag(drag: ResourceGridDragHandlers): ResourceColumnDragHandlers {
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [stable] = useState<ResourceColumnDragHandlers>(() => ({
    getColumnProps: (column) => dragRef.current.getColumnProps(column),
    getEventProps: (item) => dragRef.current.getEventProps(item),
    getResizeHandleProps: (item, edge) => dragRef.current.getResizeHandleProps(item, edge),
    getAllDayItemProps: (occurrence) => dragRef.current.getAllDayItemProps(occurrence),
  }));
  return stable;
}

/**
 * 列グループ見出しセル（{@link ResourceColumnGroupCell}）の列スパンに応じた幅スタイルを返す。
 *
 * 列見出しセルはテーマ CSS で `flex: 1 1 var(--koyomi-resource-column-width)` の等幅
 * 配分になるため、`columnCount` 列を覆うセルには同じ列幅変数の `columnCount` 倍を
 * 与えて下の列見出し行と水平位置を揃える（位置決めの数値のみを inline で出力する
 * 既存方針に従う）。
 */
function groupCellSpanStyle(columnCount: number): { flex: string; minWidth: string } {
  const width = `calc(${columnCount} * var(--koyomi-resource-column-width, 160px))`;
  return { flex: `${columnCount} ${columnCount} ${width}`, minWidth: width };
}

/**
 * 時間軸ガター（`timegrid-axis-gutter` / `time-axis`）の sticky 位置を、軸のインデックスに
 * 応じてずらすための inline style。
 *
 * デフォルトテーマ（`theme/default.css`）はこれらの要素を一律 `inset-inline-start: 0` の
 * sticky として扱う（単一の軸だけを描画していた既存の週/日ビュー・リソースビューでは
 * 問題にならなかった）。`timeAxisZones` で軸が複数になると、すべての軸が同じ位置に
 * 固定されて重なってしまうため、2 本目以降は自身より前の軸の幅（`--koyomi-time-axis-width`
 * の `index` 倍）だけ右にずらす。inline style は CSS の同名プロパティより優先されるため、
 * テーマ側の指定を上書きできる。
 *
 * @param index - `TimeAxis` 配列中のこの軸のインデックス（0 が主軸）
 */
function axisStickyOffsetStyle(index: number): CSSProperties {
  return { insetInlineStart: `calc(${index} * var(--koyomi-time-axis-width, 56px))` };
}

/**
 * リソースビュー（`ResourceView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'resource'`
 * の場合は何も描画しない（`null` を返す）。列・イベントのドラッグ操作は
 * {@link useResourceGridDrag} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'resource', resources });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
 *     <ResourceView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function ResourceView(props: ResourceViewProps): ReactElement | null {
  const {
    renderEvent,
    renderAllDayItem,
    renderColumnHeader,
    renderOverflowLabel,
    overflowButtonProps,
    initialScrollTime,
    ref,
  } = props;
  const { api, state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const resourceMessages = messages.resource;
  const commonMessages = messages.common;
  const overflowLabel = messages.month.overflow;
  const calendar = { api, state, viewModel };
  const drag = useResourceGridDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  // `drag` は毎レンダー新しいオブジェクトになるため、列・終日アイテムの
  // memo 化が効くよう、参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableResourceDrag(drag);
  // api の参照は再レンダリングを跨いで安定するため、onToggleCollapse も安定する
  // （TimelineView の同名コールバックと同じ狙い）。
  const onToggleCollapse = useCallback(
    (resourceId: string) => {
      api.toggleResourceCollapsed(resourceId);
    },
    [api],
  );

  // viewModel.type !== 'resource'（早期 return 前）でもフックは無条件に呼ぶ必要があるため、
  // スクロール計算に使う表示時間帯（分）は安全な既定値へフォールバックする
  // （TimeGridView と同じ方針）。
  const slotMinTimeMinutes = viewModel.type === 'resource' ? viewModel.slotMinTimeMinutes : 0;
  const slotMaxTimeMinutes =
    viewModel.type === 'resource' ? viewModel.slotMaxTimeMinutes : MINUTES_PER_DAY;

  // 縦横のスクロールはルート（[data-koyomi="resource"]）が一括で担う（見出し行は
  // sticky）。スクロール量の基準は見出しを除いた本文（resource-body）の高さ
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    (): ResourceViewHandle => ({
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
    [slotMinTimeMinutes, slotMaxTimeMinutes],
  );

  // マウント時に一度だけ initialScrollTime を適用する（TimeGridView と同型。
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

  if (viewModel.type !== 'resource') {
    return null;
  }

  const { days, columns, columnGroupRows, slots, timeAxes, nowIndicatorMinutes, isEmpty } =
    viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  // 複数日表示（resourceViewDays >= 2）では列見出し・終日セルの aria-label に日ラベルを付ける
  const multiDay = isMultiDayResourceView(viewModel);

  /**
   * 終日行の「+N 件」クリック。`onAllDayOverflowClick` があれば対象列付きで呼ぶ
   * （省略時は何もしない。切り替え先の既定ビューが定まらないため）。
   */
  function handleAllDayOverflowClick(column: ResourceColumn): void {
    callbacks.onAllDayOverflowClick?.(
      { date: column.date, dayKey: column.dayKey, view: 'resource', column },
      column.hiddenAllDayItems,
      { visibleOccurrences: column.allDayItems },
    );
  }

  if (isEmpty) {
    return (
      <div data-koyomi="resource">
        <div data-koyomi="resource-empty">{resourceMessages.empty}</div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-koyomi="resource"
      data-koyomi-columns={String(columns.length)}
      style={withTimegridHoursStyle(slotMinTimeMinutes, slotMaxTimeMinutes)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA grid（TimeGridView と同じ方針。<table> はテーマ CSS と噛み合わないため不採用） */}
      <div data-koyomi="resource-grid" role="grid">
        {/* 列グループ見出し行（parentId で子を持つリソースがある場合のみ）。
            親リソースのグループセルが自身＋可視の子孫の列を覆い、グループに属さない
            区間は空の columnheader（スペーサー）で覆う。グループ関係は各セルの
            aria-colspan で列見出し行と対応づける */}
        {columnGroupRows.map((groupCells) => (
          // biome-ignore lint/a11y/useSemanticElements: 下の見出し行と同様、div ベースの ARIA row
          // biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない
          <div key={groupCells[0]?.depth ?? 0} data-koyomi="resource-group-header-row" role="row">
            {timeAxes.map((axis, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: timeAxes は options 由来の固定順の配列（並べ替わらない）
                key={`${index}-${axis.timeZone}`}
                data-koyomi="timegrid-axis-gutter"
                data-koyomi-timezone={axis.timeZone}
                role="presentation"
                style={axisStickyOffsetStyle(index)}
              />
            ))}
            {/* row と columnheader の間に挟まるレイアウト用ラッパー（見出し行と同構造） */}
            <div data-koyomi="resource-headers" role="presentation">
              {groupCells.map((cell) =>
                cell.resource === null ? (
                  // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
                  // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない
                  <div
                    key={cell.key}
                    data-koyomi="resource-group-header-gap"
                    role="columnheader"
                    aria-colspan={cell.columnCount}
                    style={groupCellSpanStyle(cell.columnCount)}
                  />
                ) : (
                  // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
                  // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない
                  <div
                    key={cell.key}
                    data-koyomi="resource-group-header-cell"
                    role="columnheader"
                    aria-colspan={cell.columnCount}
                    data-koyomi-resource-id={cell.resource.id}
                    data-koyomi-depth={String(cell.depth)}
                    style={withEventColorStyle(
                      groupCellSpanStyle(cell.columnCount),
                      cell.resource.color,
                    )}
                  >
                    {cell.resource.title}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 columnheader/gridcell が担う） */}
        <div data-koyomi="resource-header" role="row">
          {timeAxes.map((axis, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: timeAxes は options 由来の固定順の配列（並べ替わらない）
              key={`${index}-${axis.timeZone}`}
              data-koyomi="timegrid-axis-gutter"
              data-koyomi-timezone={axis.timeZone}
              role="presentation"
              style={axisStickyOffsetStyle(index)}
            >
              {/* 軸がどのタイムゾーンの時刻かを示す GMT オフセットラベル（視覚補助。
                  週/日ビューの timegrid-header と同じ規則） */}
              {days[0] !== undefined && (
                <span data-koyomi="time-axis-label" aria-hidden="true">
                  {formatTimeZoneLabel(days[0].date, axis.timeZone, locale)}
                </span>
              )}
            </div>
          ))}
          {/* row と columnheader の間に挟まるレイアウト用ラッパー。role="presentation" で
              所有関係を透過させる（row の required owned elements 違反を避ける） */}
          <div data-koyomi="resource-headers" role="presentation">
            {columns.map((column) => {
              const defaultContent = resourceColumnHeaderContent(
                column.resource?.title ?? resourceMessages.unassigned,
                column,
                multiDay,
                timeZone,
                locale,
              );
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
                // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
                <div
                  key={column.key}
                  data-koyomi="resource-header-cell"
                  data-koyomi-date={column.dayKey}
                  data-koyomi-depth={String(column.depth)}
                  role="columnheader"
                  {...(column.resource !== null
                    ? { 'data-koyomi-resource-id': column.resource.id }
                    : {})}
                  style={withEventColorStyle({}, column.resource?.color)}
                >
                  {/* 折りたたみトグルは子を持つリソースの先頭日の列にのみ描画する
                      （複数日表示で同じリソースの列が日ごとに並んでも 1 つに絞る） */}
                  {column.hasChildren && column.resource !== null && column.dayIndex === 0 && (
                    <button
                      type="button"
                      data-koyomi="resource-column-toggle"
                      aria-expanded={!column.collapsed}
                      aria-label={resourceMessages.resourceToggleAriaLabel(
                        column.resource,
                        column.collapsed,
                      )}
                      onClick={() => {
                        if (column.resource !== null) {
                          onToggleCollapse(column.resource.id);
                        }
                      }}
                    >
                      ▸
                    </button>
                  )}
                  {renderColumnHeader
                    ? renderColumnHeader(column, { defaultContent })
                    : defaultContent}
                </div>
              );
            })}
          </div>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
        <div data-koyomi="allday-row" role="row">
          {timeAxes.map((axis, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 上記見出し行の gutter と同じ理由（固定順の配列）
              key={`${index}-${axis.timeZone}`}
              data-koyomi="timegrid-axis-gutter"
              data-koyomi-timezone={axis.timeZone}
              role="presentation"
              style={axisStickyOffsetStyle(index)}
            />
          ))}
          {/* row と gridcell の間に挟まるレイアウト用ラッパー。role="presentation" で
              所有関係を透過させる（row の required owned elements 違反を避ける） */}
          <div data-koyomi="resource-allday-cells" role="presentation">
            {columns.map((column) => {
              const isPreviewTarget = drag.isAllDayPreviewTarget(column);
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA gridcell
                // biome-ignore lint/a11y/useFocusableInteractive: tabIndex は drag.getAllDayCellProps（useResourceGridDrag）のスプレッド経由で付与済み。静的解析ではスプレッド元を検出できないための誤検知
                <div
                  key={column.key}
                  {...drag.getAllDayCellProps(column)}
                  data-koyomi="resource-allday-cell"
                  role="gridcell"
                  aria-label={resourceColumnAriaLabel(
                    column.resource?.title ?? resourceMessages.unassigned,
                    column,
                    multiDay,
                    timeZone,
                    locale,
                  )}
                  data-koyomi-preview-target={isPreviewTarget ? 'true' : undefined}
                  data-koyomi-invalid={
                    isPreviewTarget && (state.dragPreview?.invalid ?? false) ? 'true' : undefined
                  }
                  // 終日アイテムはレーン（配列順）で縦積みするため、レーン数分の高さを確保する
                  // （週/日ビューの allday-cells の minHeight と同じ方式）。あふれ
                  // （allDayMaxEvents 超過）がある列は「+N 件」ボタンの 1 行分を追加する
                  style={{
                    minHeight: `calc(${Math.max(2, column.allDayItems.length + (column.allDayOverflowCount > 0 ? 1 : 0))} * var(--koyomi-lane-height, 24px))`,
                  }}
                >
                  {column.allDayItems.map((occurrence, lane) => (
                    <AllDayItemButton
                      key={occurrence.key}
                      occurrence={occurrence}
                      column={column}
                      lane={lane}
                      timeZone={timeZone}
                      locale={locale}
                      renderAllDayItem={renderAllDayItem}
                      renderEventContent={renderEventContent}
                      drag={stableDrag}
                      isDragging={drag.isDragging}
                      commonMessages={commonMessages}
                    />
                  ))}
                  {/* あふれ（allDayMaxEvents 超過）のある列の「+N 件」ボタン。
                      終日アイテムと同じく絶対配置で、表示アイテムの直下の行に置く */}
                  {column.allDayOverflowCount > 0 && (
                    <AllDayOverflowButton
                      style={{
                        position: 'absolute',
                        insetInlineStart: '0%',
                        width: '100%',
                        top: `calc(${column.allDayItems.length} * var(--koyomi-lane-height, 24px))`,
                      }}
                      buttonProps={overflowButtonProps?.(column, column.hiddenAllDayItems)}
                      onActivate={() => handleAllDayOverflowClick(column)}
                    >
                      {renderOverflowLabel
                        ? renderOverflowLabel(column, {
                            defaultContent: overflowLabel(column.allDayOverflowCount),
                            hiddenOccurrences: column.hiddenAllDayItems,
                          })
                        : overflowLabel(column.allDayOverflowCount)}
                    </AllDayOverflowButton>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* 本文（時間軸 + リソース列）は連続的な時間位置決めで離散セルに対応しないため grid 化しない
          （詳細は docs/accessibility.md 参照）。role="grid" の owned elements は row/rowgroup
          に限られる（WAI-ARIA grid パターン）ため、grid 化しないだけでなく上の resource-grid の
          外側（兄弟要素）に置く。role は付けない（grid の子孫ではないため presentation で
          打ち消す必要がない） */}
      <div data-koyomi="resource-body" ref={bodyRef}>
        {timeAxes.map((axis, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 上記見出し行の gutter と同じ理由（固定順の配列）
          <TimeAxisColumn key={`${index}-${axis.timeZone}`} axis={axis} index={index} />
        ))}
        <div data-koyomi="resource-columns">
          {columns.map((column) => (
            <ResourceColumnBody
              key={column.key}
              column={column}
              // 列は columnProps（useResourceGridDrag.getColumnProps）の tabIndex で
              // フォーカス可能になり Enter/Space のキーボード作成対象になるため、
              // 終日セルと同じ規則のアクセシブルネームを与える
              ariaLabel={resourceColumnAriaLabel(
                column.resource?.title ?? resourceMessages.unassigned,
                column,
                multiDay,
                timeZone,
                locale,
              )}
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
              commonMessages={commonMessages}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 時間軸の列 1 本分（主軸または {@link CalendarOptions.timeAxisZones} の追加軸）。
 * `data-koyomi-timezone` でどのタイムゾーンの軸かを識別できる（週/日ビューの
 * `TimeAxisColumn` と同じ構造）。
 */
function TimeAxisColumn(props: { axis: TimeAxis; index: number }): ReactElement {
  const { axis, index } = props;
  return (
    <div
      data-koyomi="time-axis"
      data-koyomi-timezone={axis.timeZone}
      style={axisStickyOffsetStyle(index)}
    >
      {axis.slots.map((slot) => (
        <div key={slot.minutes} data-koyomi="time-slot-label">
          {slot.label}
        </div>
      ))}
    </div>
  );
}

/** `AllDayItemButtonImpl` の props。 */
interface AllDayItemButtonProps {
  occurrence: EventOccurrence;
  column: ResourceColumn;
  /** 縦方向のレーン番号（`allDayItems` の配列順。同列内で重ならないよう縦積みする）。 */
  lane: number;
  timeZone: TimeZoneId;
  locale: string;
  /** 終日アイテムの表示内容のカスタマイズ関数（省略時はタイトルのみ）。 */
  renderAllDayItem:
    | ((occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode)
    | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link AllDayItemButton} 参照）。 */
  isDragging: boolean;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}

/** リソースビューの終日アイテム 1 件分のボタン（列間移動のみ）。 */
function AllDayItemButtonImpl(props: AllDayItemButtonProps): ReactElement {
  const {
    occurrence,
    column,
    lane,
    timeZone,
    locale,
    renderAllDayItem,
    renderEventContent,
    drag,
    commonMessages,
  } = props;
  const style = withEventColorStyle(
    // 週/日ビューの終日セグメントと同じ位置決め。列 = 1 日のため水平スパンは
    // 常に列幅いっぱい（週/日ビューの startCol/span に相当する % は 0%/100% 固定）
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

/**
 * {@link AllDayItemButtonImpl} を `memo` でラップしたもの。
 *
 * `column`（`ResourceColumn`）は `viewModel` 再構築のたびに新しい参照になるため、
 * 表示に影響する値（`occurrence` / リソースの id・title・color）だけを比較する
 * カスタム比較関数を使う。`isDragging` はドラッグ開始・終了の瞬間だけ変化する値で、
 * 変化時には全終日アイテムを再評価させ、`data-koyomi-dragging` を正しく反映させる
 * （`time-grid-view.tsx` の `TimeGridEventButton` と同じ設計）。
 */
const AllDayItemButton = memo(AllDayItemButtonImpl, (prev, next) => {
  return (
    sameEventOccurrence(prev.occurrence, next.occurrence) &&
    sameResource(prev.column.resource, next.column.resource) &&
    prev.lane === next.lane &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.renderAllDayItem === next.renderAllDayItem &&
    prev.renderEventContent === next.renderEventContent &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    prev.commonMessages === next.commonMessages
  );
});

/** `ResourceColumnBodyImpl` の props。 */
interface ResourceColumnBodyProps {
  column: ResourceColumn;
  /**
   * 列の aria-label（終日セルと同じ規則で親が組み立てた値。
   * リソース名が文字列でない場合は `undefined` = 属性を付けない）。
   */
  ariaLabel: string | undefined;
  slots: readonly TimeSlot[];
  /** この列の日の営業時間内フラグ（{@link ResourceViewDay.businessHourSlots}）。 */
  businessHourSlots: readonly BusinessHourSlot[];
  timeZone: TimeZoneId;
  locale: string;
  /** 表示時間帯の開始（分）。既定（`slotMinTime` 未指定）は `0`。 */
  slotMinTimeMinutes: number;
  /** 表示時間帯の終了（分）。既定（`slotMaxTime` 未指定）は `1440`。 */
  slotMaxTimeMinutes: number;
  /** この列の日が今日かどうか（{@link ResourceColumn.isToday}。現在時刻線の描画対象の判定）。 */
  isToday: boolean;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link ResourceColumnBody} 参照）。 */
  isDragging: boolean;
  preview: ResourcePreviewSegment | null;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}

/** リソースビューの 1 列分（目盛り線・イベント・プレビュー・現在時刻線）。 */
function ResourceColumnBodyImpl(props: ResourceColumnBodyProps): ReactElement {
  const {
    column,
    ariaLabel,
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
    commonMessages,
  } = props;
  const { ref, ...columnProps } = drag.getColumnProps(column);
  const rangeWidth = slotMaxTimeMinutes - slotMinTimeMinutes;

  return (
    // biome-ignore lint/a11y/useSemanticElements: 本文は grid 化しない方針（ファイル冒頭コメント参照）のため、列は「そのレーンの予定をまとめる」div ベースの ARIA group にする
    <div
      {...columnProps}
      ref={toDivRef(ref)}
      data-koyomi="resource-column"
      data-today={isToday ? 'true' : undefined}
      // 列は columnProps（useResourceGridDrag.getColumnProps）の tabIndex でフォーカス
      // 可能になり Enter/Space のキーボード作成対象になるため、そのレーンの予定を
      // まとめる group としてアクセシブルネームを与える（aria-label は role なしの
      // generic ではサポートされないため、role とセットで付ける）
      role="group"
      aria-label={ariaLabel}
    >
      {slots.map((slot, index) => {
        // isBusinessHours なスロットのみ、次のスロット（無ければ表示時間帯の終端）までの
        // 高さを追加で持たせて背景を敷ける（週/日ビューの timegrid-slot と同じ規則。
        // 既定（businessHours 未指定）では従来どおり top のみのスタイルのまま）
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
        const style = withEventColorStyle(
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
            style={style}
            aria-label={ariaLabelWithResource(
              item.occurrence,
              column.resource?.title,
              timeZone,
              locale,
              commonMessages,
            )}
          >
            <div data-koyomi="timegrid-event-content">
              {resolveEventContent(
                renderEvent,
                renderEventContent,
                item,
                item.occurrence,
                resourceTimedContentContext(item, locale, commonMessages.rangeSeparator),
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

/**
 * {@link ResourceColumnBodyImpl} を `memo` でラップしたもの。
 *
 * `viewModel` は状態が変わるたびに丸ごと再構築されるため、既定の浅い比較（参照比較）
 * では `column` / `slots` が常に「変わった」ことになり意味がない。表示に影響する値だけを
 * 比較するカスタム比較関数を使うことで、ドラッグ中に無関係な列が再レンダーされない
 * ようにする（`isDragging` はドラッグ開始・終了の瞬間だけ変化するので、その際は
 * 全列が 1 回だけ再評価され、対象イベントの `data-koyomi-dragging` 表示が正しく更新される。
 * `time-grid-view.tsx` の `TimeGridDayColumn` と同じ設計）。
 */
const ResourceColumnBody = memo(ResourceColumnBodyImpl, (prev, next) => {
  return (
    sameResourceColumnForBody(prev.column, next.column) &&
    prev.ariaLabel === next.ariaLabel &&
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
    prev.commonMessages === next.commonMessages
  );
});
