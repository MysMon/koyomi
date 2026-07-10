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
 * a11y は週/日ビューの現状（grid 系 role なし）に合わせ、操作要素は `<button>` +
 * 完全な `aria-label`（日時 + リソース名）とする。
 */

import type { ReactElement, ReactNode, Ref } from 'react';
import { memo, useRef, useState } from 'react';
import type {
  CalendarResource,
  EventOccurrence,
  PositionedOccurrence,
  ResourceColumn,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { ResourceGridDragHandlers, ResourcePreviewSegment } from '../use-resource-grid-drag';
import { useResourceGridDrag } from '../use-resource-grid-drag';
import { formatEventAriaLabel, formatTimeLabel, withEventColorStyle } from './month-view-parts';

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;

/** 未割り当てレーンの既定ラベル。 */
const DEFAULT_UNASSIGNED_LABEL = '未割り当て';

/** 空状態の既定メッセージ。 */
const DEFAULT_EMPTY_LABEL = 'リソースがありません';

/** `ResourceView` の props。 */
export interface ResourceViewProps {
  /**
   * 時間指定イベントブロックの表示内容をカスタマイズする関数。
   * 省略時は開始〜終了時刻とタイトルを表示する。
   */
  renderEvent?: (item: PositionedOccurrence) => ReactNode;
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
}

/**
 * `Ref<HTMLElement>` を `<div>` にそのまま渡せるコールバック ref に変換する
 * （`month-view-parts.tsx` の同名ヘルパと同じ橋渡し）。
 */
function toDivRef(ref: Ref<HTMLElement>): (element: HTMLDivElement | null) => void {
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
 * イベントの aria-label にリソース名を付け足す（例: `'会議、7月10日 10:00〜11:00、会議室A'`）。
 */
function ariaLabelWithResource(
  occurrence: EventOccurrence,
  resourceTitle: string | undefined,
  timeZone: TimeZoneId,
  locale: string,
): string {
  const base = formatEventAriaLabel(occurrence, timeZone, locale);
  return resourceTitle === undefined ? base : `${base}、${resourceTitle}`;
}

/** 時間指定イベントの既定の表示内容（開始時刻 + タイトル）。 */
function defaultTimedContent(
  item: PositionedOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): ReactNode {
  return `${formatTimeLabel(item.occurrence.start, timeZone, locale)} ${item.occurrence.event.title}`;
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

/** `CalendarResource | null` の、表示に影響する内容が等しいかどうかを比較する。 */
function sameResource(a: CalendarResource | null, b: CalendarResource | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.id === b.id && a.title === b.title && a.color === b.color;
}

/** `TimeSlot` 配列の内容が等しいかどうかを比較する。 */
function sameSlots(a: readonly TimeSlot[], b: readonly TimeSlot[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((slot, index) => slot.minutes === b[index]?.minutes);
}

/** `PositionedOccurrence` 1 件分の、表示に影響する内容が等しいかどうかを比較する。 */
function samePositionedOccurrence(a: PositionedOccurrence, b: PositionedOccurrence): boolean {
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
function samePositionedOccurrences(
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
function sameEventOccurrence(a: EventOccurrence, b: EventOccurrence): boolean {
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

/** `ResourcePreviewSegment` の内容が等しいかどうかを比較する。 */
function samePreviewSegment(
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
    renderColumnHeader,
    unassignedLabel = DEFAULT_UNASSIGNED_LABEL,
    emptyLabel = DEFAULT_EMPTY_LABEL,
  } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const drag = useResourceGridDrag({ calendar, callbacks });
  // `drag` は毎レンダー新しいオブジェクトになるため、列・終日アイテムの
  // memo 化が効くよう、参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableResourceDrag(drag);

  if (viewModel.type !== 'resource') {
    return null;
  }

  const { columns, slots, nowIndicatorMinutes, isToday, isEmpty } = viewModel;
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
    <div data-koyomi="resource" data-koyomi-columns={String(columns.length)}>
      <div data-koyomi="resource-header">
        <div data-koyomi="timegrid-axis-gutter" />
        <div data-koyomi="resource-headers">
          {columns.map((column) => {
            const defaultContent = column.resource?.title ?? unassignedLabel;
            return (
              <div
                key={column.key}
                data-koyomi="resource-header-cell"
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
      <div data-koyomi="allday-row">
        <div data-koyomi="timegrid-axis-gutter" />
        <div data-koyomi="resource-allday-cells">
          {columns.map((column) => (
            <div
              key={column.key}
              {...drag.getAllDayCellProps(column)}
              data-koyomi="resource-allday-cell"
              data-koyomi-preview-target={drag.isAllDayPreviewTarget(column) ? 'true' : undefined}
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
                  drag={stableDrag}
                  isDragging={drag.isDragging}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div data-koyomi="resource-body">
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
              timeZone={timeZone}
              locale={locale}
              isToday={isToday}
              nowIndicatorMinutes={nowIndicatorMinutes}
              renderEvent={renderEvent}
              drag={stableDrag}
              isDragging={drag.isDragging}
              preview={drag.previewFor(column)}
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
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link AllDayItemButton} 参照）。 */
  isDragging: boolean;
}

/** リソースビューの終日アイテム 1 件分のボタン（列間移動のみ）。 */
function AllDayItemButtonImpl(props: AllDayItemButtonProps): ReactElement {
  const { occurrence, column, lane, timeZone, locale, drag } = props;
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
      aria-label={ariaLabelWithResource(occurrence, column.resource?.title, timeZone, locale)}
    >
      {occurrence.event.title}
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
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging
  );
});

/** `ResourceColumnBodyImpl` の props。 */
interface ResourceColumnBodyProps {
  column: ResourceColumn;
  slots: readonly TimeSlot[];
  timeZone: TimeZoneId;
  locale: string;
  isToday: boolean;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence) => ReactNode) | undefined;
  drag: ResourceColumnDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link ResourceColumnBody} 参照）。 */
  isDragging: boolean;
  preview: ResourcePreviewSegment | null;
}

/** リソースビューの 1 列分（目盛り線・イベント・プレビュー・現在時刻線）。 */
function ResourceColumnBodyImpl(props: ResourceColumnBodyProps): ReactElement {
  const {
    column,
    slots,
    timeZone,
    locale,
    isToday,
    nowIndicatorMinutes,
    renderEvent,
    drag,
    preview,
  } = props;
  const { ref, ...columnProps } = drag.getColumnProps(column);

  return (
    <div
      {...columnProps}
      ref={toDivRef(ref)}
      data-koyomi="resource-column"
      data-today={isToday ? 'true' : undefined}
    >
      {slots.map((slot) => (
        <div
          key={slot.minutes}
          data-koyomi="timegrid-slot"
          style={{ top: `${(slot.minutes / MINUTES_PER_DAY) * 100}%` }}
        />
      ))}
      {column.items.map((item) => {
        const eventProps = drag.getEventProps(item);
        const isEditable = item.occurrence.event.editable !== false;
        const style = withEventColorStyle(
          {
            top: `${(item.startMinutes / MINUTES_PER_DAY) * 100}%`,
            height: `${((item.endMinutes - item.startMinutes) / MINUTES_PER_DAY) * 100}%`,
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
          style={{
            top: `${(preview.startMinutes / MINUTES_PER_DAY) * 100}%`,
            height: `${((preview.endMinutes - preview.startMinutes) / MINUTES_PER_DAY) * 100}%`,
          }}
        />
      )}
      {isToday && nowIndicatorMinutes !== null && (
        <div
          data-koyomi="now-indicator"
          aria-hidden="true"
          style={{ top: `${(nowIndicatorMinutes / MINUTES_PER_DAY) * 100}%` }}
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
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.isToday === next.isToday &&
    prev.nowIndicatorMinutes === next.nowIndicatorMinutes &&
    prev.renderEvent === next.renderEvent &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview)
  );
});
