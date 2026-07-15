/**
 * @packageDocumentation
 * `ResourceView` — リソースビュー（1 日、列 = リソース × 縦 = 時間）を描画する
 * ヘッドレスコンポーネント。
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

import type { ReactElement, ReactNode, Ref } from 'react';
import { memo, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type {
  BusinessHourSlot,
  EventOccurrence,
  PositionedOccurrence,
  ResourceColumn,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import { scrollContainerToTime } from '../scroll-to-time';
import type { ResourceGridDragHandlers, ResourcePreviewSegment } from '../use-resource-grid-drag';
import { useResourceGridDrag } from '../use-resource-grid-drag';
import {
  percentOfSlotRange,
  resolveEventAriaLabel,
  withEventColorStyle,
  withTimegridHoursStyle,
} from './month-view-parts';
import {
  ariaLabelText,
  ariaLabelWithResource,
  DEFAULT_EMPTY_LABEL,
  DEFAULT_UNASSIGNED_LABEL,
  defaultAllDayContent,
  defaultTimedContent,
  MINUTES_PER_DAY,
  sameBusinessHourSlots,
  sameEventOccurrence,
  samePositionedOccurrences,
  samePreviewSegment,
  sameResource,
  sameSlots,
  toDivRef,
} from './resource-view-parts';

/**
 * `ResourceView` の props。
 *
 * 時間指定イベントの表示内容は `renderEvent`、終日アイテムの表示内容は
 * `renderAllDayItem` でそれぞれ独立にカスタマイズする。
 */
export interface ResourceViewProps {
  /**
   * 時間指定イベントブロックの表示内容をカスタマイズする関数。
   * 省略時は開始〜終了時刻とタイトルを表示する。終日アイテムには適用されない
   * （終日アイテムの内容は {@link ResourceViewProps.renderAllDayItem} を使う）。
   */
  renderEvent?: (item: PositionedOccurrence) => ReactNode;
  /**
   * 終日アイテムの表示内容をカスタマイズする関数。省略時はタイトルのみを表示する。
   */
  renderAllDayItem?: (occurrence: EventOccurrence) => ReactNode;
  /**
   * 列見出しの内容をカスタマイズする関数。
   * `defaultContent` は既定の内容（リソース名、未割り当て列は `unassignedLabel`）。
   * @param column - 対象の列
   * @param defaultContent - 既定の内容
   */
  renderColumnHeader?: (column: ResourceColumn, defaultContent: ReactNode) => ReactNode;
  /** 未割り当て列の見出しラベル。省略時は「未割り当て」。 */
  unassignedLabel?: ReactNode;
  /** 空状態（列が 1 つもない）のメッセージ。省略時は「リソースがありません」。 */
  emptyLabel?: ReactNode;
  /**
   * イベントブロックの aria-label をカスタマイズする関数。
   * 第 2 引数に既定の aria-label 文字列（日時＋リソース名、`ariaLabelWithResource` の結果）
   * を渡すので、それを加工・置換して返せる。省略時は既定文字列をそのまま使う。
   * @param occurrence - 対象のオカレンス
   * @param defaultLabel - 既定の aria-label 文字列
   */
  eventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
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
   * `[data-koyomi="resource-body"]` を指定時刻の位置へスクロールする。
   * 時刻が表示時間帯の外側の場合は最も近い境界へクランプする。`'HH:mm'` として
   * 解析できない場合は何もしない。
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
    unassignedLabel = DEFAULT_UNASSIGNED_LABEL,
    emptyLabel = DEFAULT_EMPTY_LABEL,
    eventAriaLabel,
    initialScrollTime,
    ref,
  } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const drag = useResourceGridDrag({ calendar, callbacks });
  // `drag` は毎レンダー新しいオブジェクトになるため、列・終日アイテムの
  // memo 化が効くよう、参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableResourceDrag(drag);

  // viewModel.type !== 'resource'（早期 return 前）でもフックは無条件に呼ぶ必要があるため、
  // スクロール計算に使う表示時間帯（分）は安全な既定値へフォールバックする
  // （TimeGridView と同じ方針）。
  const slotMinTimeMinutes = viewModel.type === 'resource' ? viewModel.slotMinTimeMinutes : 0;
  const slotMaxTimeMinutes =
    viewModel.type === 'resource' ? viewModel.slotMaxTimeMinutes : MINUTES_PER_DAY;

  const bodyRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    (): ResourceViewHandle => ({
      scrollToTime(time: string) {
        if (bodyRef.current !== null) {
          scrollContainerToTime(bodyRef.current, time, slotMinTimeMinutes, slotMaxTimeMinutes);
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
    if (initialScrollTime !== undefined && bodyRef.current !== null) {
      scrollContainerToTime(
        bodyRef.current,
        initialScrollTime,
        slotMinTimeMinutes,
        slotMaxTimeMinutes,
      );
    }
  }, []);

  if (viewModel.type !== 'resource') {
    return null;
  }

  const { columns, slots, nowIndicatorMinutes, isToday, isEmpty, businessHourSlots } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;

  if (isEmpty) {
    return (
      <div data-koyomi="resource">
        <div data-koyomi="resource-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div
      data-koyomi="resource"
      data-koyomi-columns={String(columns.length)}
      style={withTimegridHoursStyle(slotMinTimeMinutes, slotMaxTimeMinutes)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA grid（TimeGridView と同じ方針。<table> はテーマ CSS と噛み合わないため不採用） */}
      <div data-koyomi="resource-grid" role="grid">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 columnheader/gridcell が担う） */}
        <div data-koyomi="resource-header" role="row">
          <div data-koyomi="timegrid-axis-gutter" role="presentation" />
          {/* row と columnheader の間に挟まるレイアウト用ラッパー。role="presentation" で
              所有関係を透過させる（row の required owned elements 違反を避ける） */}
          <div data-koyomi="resource-headers" role="presentation">
            {columns.map((column) => {
              const defaultContent = column.resource?.title ?? unassignedLabel;
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
                // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
                <div
                  key={column.key}
                  data-koyomi="resource-header-cell"
                  role="columnheader"
                  {...(column.resource !== null
                    ? { 'data-koyomi-resource-id': column.resource.id }
                    : {})}
                  style={withEventColorStyle({}, column.resource?.color)}
                >
                  {renderColumnHeader ? renderColumnHeader(column, defaultContent) : defaultContent}
                </div>
              );
            })}
          </div>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
        <div data-koyomi="allday-row" role="row">
          <div data-koyomi="timegrid-axis-gutter" role="presentation" />
          {/* row と gridcell の間に挟まるレイアウト用ラッパー。role="presentation" で
              所有関係を透過させる（row の required owned elements 違反を避ける） */}
          <div data-koyomi="resource-allday-cells" role="presentation">
            {columns.map((column) => {
              const isPreviewTarget = drag.isAllDayPreviewTarget(column);
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA gridcell
                // biome-ignore lint/a11y/useFocusableInteractive: 現状クリック専用でキーボード操作に未対応（既知の制限。docs/accessibility.md 参照）
                <div
                  key={column.key}
                  {...drag.getAllDayCellProps(column)}
                  data-koyomi="resource-allday-cell"
                  role="gridcell"
                  aria-label={
                    column.resource?.title ??
                    ariaLabelText(unassignedLabel, DEFAULT_UNASSIGNED_LABEL)
                  }
                  data-koyomi-preview-target={isPreviewTarget ? 'true' : undefined}
                  data-koyomi-invalid={
                    isPreviewTarget && (state.dragPreview?.invalid ?? false) ? 'true' : undefined
                  }
                  // 終日アイテムはレーン（配列順）で縦積みするため、レーン数分の高さを確保する
                  // （週/日ビューの allday-cells の minHeight と同じ方式）
                  style={{
                    minHeight: `calc(${Math.max(2, column.allDayItems.length)} * var(--koyomi-lane-height, 24px))`,
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
                      drag={stableDrag}
                      isDragging={drag.isDragging}
                      eventAriaLabel={eventAriaLabel}
                    />
                  ))}
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
        <div data-koyomi="time-axis">
          {slots.map((slot) => (
            <div key={slot.minutes} data-koyomi="time-slot-label">
              {slot.label}
            </div>
          ))}
        </div>
        <div data-koyomi="resource-columns">
          {columns.map((column) => (
            <ResourceColumnBody
              key={column.key}
              column={column}
              slots={slots}
              businessHourSlots={businessHourSlots}
              timeZone={timeZone}
              locale={locale}
              slotMinTimeMinutes={slotMinTimeMinutes}
              slotMaxTimeMinutes={slotMaxTimeMinutes}
              isToday={isToday}
              nowIndicatorMinutes={nowIndicatorMinutes}
              renderEvent={renderEvent}
              drag={stableDrag}
              isDragging={drag.isDragging}
              preview={drag.previewFor(column)}
              eventAriaLabel={eventAriaLabel}
            />
          ))}
        </div>
      </div>
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
  renderAllDayItem: ((occurrence: EventOccurrence) => ReactNode) | undefined;
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link AllDayItemButton} 参照）。 */
  isDragging: boolean;
  /** イベントボタンの aria-label のカスタマイズ関数（省略時は既定文字列をそのまま使う）。 */
  eventAriaLabel: ((occurrence: EventOccurrence, defaultLabel: string) => string) | undefined;
}

/** リソースビューの終日アイテム 1 件分のボタン（列間移動のみ）。 */
function AllDayItemButtonImpl(props: AllDayItemButtonProps): ReactElement {
  const { occurrence, column, lane, timeZone, locale, renderAllDayItem, drag, eventAriaLabel } =
    props;
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
      aria-label={resolveEventAriaLabel(
        occurrence,
        ariaLabelWithResource(occurrence, column.resource?.title, timeZone, locale),
        eventAriaLabel,
      )}
    >
      {renderAllDayItem ? renderAllDayItem(occurrence) : defaultAllDayContent(occurrence)}
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
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    prev.eventAriaLabel === next.eventAriaLabel
  );
});

/** `ResourceColumnBodyImpl` の props。 */
interface ResourceColumnBodyProps {
  column: ResourceColumn;
  slots: readonly TimeSlot[];
  /** {@link ResourceViewModel.businessHourSlots}（全列共通の 1 本）。 */
  businessHourSlots: readonly BusinessHourSlot[];
  timeZone: TimeZoneId;
  locale: string;
  /** 表示時間帯の開始（分）。既定（`slotMinTime` 未指定）は `0`。 */
  slotMinTimeMinutes: number;
  /** 表示時間帯の終了（分）。既定（`slotMaxTime` 未指定）は `1440`。 */
  slotMaxTimeMinutes: number;
  isToday: boolean;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence) => ReactNode) | undefined;
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link ResourceColumnBody} 参照）。 */
  isDragging: boolean;
  preview: ResourcePreviewSegment | null;
  /** イベントボタンの aria-label のカスタマイズ関数（省略時は既定文字列をそのまま使う）。 */
  eventAriaLabel: ((occurrence: EventOccurrence, defaultLabel: string) => string) | undefined;
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
    drag,
    preview,
    eventAriaLabel,
  } = props;
  const { ref, ...columnProps } = drag.getColumnProps(column);
  const rangeWidth = slotMaxTimeMinutes - slotMinTimeMinutes;

  return (
    <div
      {...columnProps}
      ref={toDivRef(ref)}
      data-koyomi="resource-column"
      data-today={isToday ? 'true' : undefined}
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
            aria-label={resolveEventAriaLabel(
              item.occurrence,
              ariaLabelWithResource(item.occurrence, column.resource?.title, timeZone, locale),
              eventAriaLabel,
            )}
          >
            <div data-koyomi="timegrid-event-content">
              {renderEvent ? renderEvent(item) : defaultTimedContent(item, timeZone, locale)}
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
    sameSlots(prev.slots, next.slots) &&
    sameBusinessHourSlots(prev.businessHourSlots, next.businessHourSlots) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.slotMinTimeMinutes === next.slotMinTimeMinutes &&
    prev.slotMaxTimeMinutes === next.slotMaxTimeMinutes &&
    prev.isToday === next.isToday &&
    prev.nowIndicatorMinutes === next.nowIndicatorMinutes &&
    prev.renderEvent === next.renderEvent &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview) &&
    prev.eventAriaLabel === next.eventAriaLabel
  );
});
