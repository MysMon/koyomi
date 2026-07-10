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
import { memo } from 'react';
import type {
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
                  drag={drag}
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
              drag={drag}
              isDragging={drag.isDragging}
              preview={drag.previewFor(column)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** リソースビューの終日アイテム 1 件分のボタン（列間移動のみ）。 */
const AllDayItemButton = memo(function AllDayItemButton(props: {
  occurrence: EventOccurrence;
  column: ResourceColumn;
  /** 縦方向のレーン番号（`allDayItems` の配列順。同列内で重ならないよう縦積みする）。 */
  lane: number;
  timeZone: TimeZoneId;
  locale: string;
  drag: ResourceGridDragHandlers;
  /** ドラッグ操作が進行中か（`data-koyomi-dragging` の更新に必要）。 */
  isDragging: boolean;
}): ReactElement {
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
});

/** リソースビューの 1 列分（目盛り線・イベント・プレビュー・現在時刻線）。 */
const ResourceColumnBody = memo(function ResourceColumnBody(props: {
  column: ResourceColumn;
  slots: readonly TimeSlot[];
  timeZone: TimeZoneId;
  locale: string;
  isToday: boolean;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence) => ReactNode) | undefined;
  drag: ResourceGridDragHandlers;
  /** ドラッグ操作が進行中か（`data-koyomi-dragging` の更新に必要）。 */
  isDragging: boolean;
  preview: ResourcePreviewSegment | null;
}): ReactElement {
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
});
