/**
 * @packageDocumentation
 * `TimelineView` — タイムラインビュー（横 = 時間 × 行 = リソース）を描画する
 * ヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「タイムラインビュー（TimelineView）」節を参照。スクロールは単一の横スクロール
 * コンテナ（`timeline-body`）で行い、行見出しはテーマ CSS の `position: sticky` で
 * 固定する（スクロール同期の JS は持たない）。ドラッグ操作は
 * {@link useTimelineDrag} に委譲する。
 *
 * 水平位置は `表示分 / totalMinutes` の % を inline で出力する（位置決めの数値のみ）。
 * トラックの実際の幅・レーンの高さはテーマ/利用者 CSS の責務で、行の
 * `--koyomi-timeline-lanes`（レーン数）・ルートの `data-koyomi-days`（表示日数）を
 * フックに計算できる。
 *
 * a11y は週/日ビューの現状（grid 系 role なし）に合わせ、帯は `<button>` +
 * 完全な `aria-label`（日時 + リソース名）とする。
 */

import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { memo, useRef, useState } from 'react';
import type { CalendarResource, TimelineItem, TimelineRow, TimeZoneId } from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { TimelineDragHandlers, TimelinePreviewSegment } from '../use-timeline-drag';
import { useTimelineDrag } from '../use-timeline-drag';
import { formatDayHeader } from './format';
import { formatEventAriaLabel, withEventColorStyle } from './month-view-parts';

/** 未割り当て行の既定ラベル。 */
const DEFAULT_UNASSIGNED_LABEL = '未割り当て';

/** 空状態の既定メッセージ。 */
const DEFAULT_EMPTY_LABEL = 'リソースがありません';

/** 開発ビルドで目盛り数の警告を出す閾値。 */
const SLOT_COUNT_WARNING_THRESHOLD = 1000;

/** `TimelineView` の props。 */
export interface TimelineViewProps {
  /**
   * 帯（タイムラインアイテム）の表示内容をカスタマイズする関数。
   * 省略時はタイトルのみを表示する。
   */
  renderEvent?: (item: TimelineItem) => ReactNode;
  /**
   * 行見出しの内容をカスタマイズする関数。
   * `defaultContent` は既定の内容（リソース名、未割り当て行は `unassignedLabel`）。
   * @param row - 対象の行
   * @param defaultContent - 既定の内容
   */
  renderRowHeader?: (row: TimelineRow, defaultContent: ReactNode) => ReactNode;
  /** 未割り当て行の見出しラベル。省略時は「未割り当て」。 */
  unassignedLabel?: ReactNode;
  /** 空状態（行が 1 つもない）のメッセージ。省略時は「リソースがありません」。 */
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
 * レーン数を CSS 変数 `--koyomi-timeline-lanes` として style に加える。
 * 行の高さ計算のフック（テーマ CSS が参照する数値）で、位置決めの数値のみを
 * inline に出す既存規約の範囲内。
 */
function withLaneCountStyle(laneCount: number): CSSProperties {
  // 'as' 使用理由: CSS カスタムプロパティ（--koyomi-timeline-lanes）は CSSProperties の
  // 型定義に含まれないため、ここでのみ許容されたキャストを行う（CLAUDE.md 参照）。
  return { '--koyomi-timeline-lanes': String(Math.max(1, laneCount)) } as CSSProperties;
}

/** 目盛り数の警告を出したかどうか（モジュールで一度だけ）。 */
let warnedSlotCount = false;

/**
 * `TimelineRowGroup` が実際に必要とするドラッグハンドラだけを抜き出した型。
 * `previewFor` はここに含めない（{@link TimelineView} 側で解決済みの値を `preview` prop
 * として渡すため）。
 */
interface TimelineRowDragHandlers {
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
function useStableTimelineDrag(drag: TimelineDragHandlers): TimelineRowDragHandlers {
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
function sameResource(a: CalendarResource | null, b: CalendarResource | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.id === b.id && a.title === b.title && a.color === b.color;
}

/** `TimelineItem` 1 件分の、表示に影響する内容が等しいかどうかを比較する。 */
function sameTimelineItem(a: TimelineItem, b: TimelineItem): boolean {
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
function sameTimelineItems(a: readonly TimelineItem[], b: readonly TimelineItem[]): boolean {
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

/** `TimelineRow` の、{@link TimelineRowGroup} の表示に影響する内容が等しいかどうかを比較する。 */
function sameTimelineRow(a: TimelineRow, b: TimelineRow): boolean {
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

/** `TimelinePreviewSegment` の内容が等しいかどうかを比較する。 */
function samePreviewSegment(
  a: TimelinePreviewSegment | null,
  b: TimelinePreviewSegment | null,
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
 * タイムラインビュー（`TimelineView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'timeline'`
 * の場合は何も描画しない（`null` を返す）。行・帯のドラッグ操作は
 * {@link useTimelineDrag} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'timeline', resources, timelineDays: 7 });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
 *     <TimelineView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function TimelineView(props: TimelineViewProps): ReactElement | null {
  const {
    renderEvent,
    renderRowHeader,
    unassignedLabel = DEFAULT_UNASSIGNED_LABEL,
    emptyLabel = DEFAULT_EMPTY_LABEL,
  } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const drag = useTimelineDrag({ calendar, callbacks });
  // `drag` は毎レンダー新しいオブジェクトになるため、行の memo 化が効くよう、
  // 参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableTimelineDrag(drag);

  if (viewModel.type !== 'timeline') {
    return null;
  }

  const { days, slots, rows, totalMinutes, nowIndicatorMinutes, isEmpty } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;

  // 「細かい slotMinutes × 長期間」の組み合わせで目盛り DOM が肥大する構成への
  // 開発ビルド警告（一度だけ）。docs の推奨（粗い間隔 × 長期間 / 細かい間隔 × 短期間）を案内する
  if (isDevBuild() && !warnedSlotCount && slots.length > SLOT_COUNT_WARNING_THRESHOLD) {
    warnedSlotCount = true;
    // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
    console.warn(
      `[koyomi] タイムラインの目盛りが ${slots.length} 個あります（timelineDays × ceil(1440 / slotMinutes)）。` +
        '描画が重い場合は slotMinutes を粗くするか timelineDays を短くしてください。',
    );
  }

  if (isEmpty) {
    return (
      <div data-koyomi="timeline">
        <div data-koyomi="timeline-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div data-koyomi="timeline" data-koyomi-days={String(days.length)}>
      <div data-koyomi="timeline-body">
        <div data-koyomi="timeline-header-row">
          <div data-koyomi="timeline-corner" />
          <div data-koyomi="timeline-axis">
            <div data-koyomi="timeline-day-headers">
              {days.map((day) => (
                <div
                  key={day.key}
                  data-koyomi="timeline-day-header"
                  data-today={day.isToday ? 'true' : undefined}
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
        {rows.map((row) => (
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
          />
        ))}
      </div>
    </div>
  );
}

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;

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
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link TimelineRowGroup} 参照）。 */
  isDragging: boolean;
  preview: TimelinePreviewSegment | null;
}

/** タイムラインの 1 行分（行見出し + 帯トラック）。 */
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
  } = props;
  const { ref, ...rowProps } = drag.getRowProps(row);
  const headerContent = row.resource?.title ?? unassignedLabel;

  return (
    <div data-koyomi="timeline-row-group">
      <div
        data-koyomi="timeline-resource-header"
        {...(row.resource !== null ? { 'data-koyomi-resource-id': row.resource.id } : {})}
        style={withEventColorStyle({}, row.resource?.color)}
      >
        {renderRowHeader ? renderRowHeader(row, headerContent) : headerContent}
      </div>
      <div
        {...rowProps}
        ref={toDivRef(ref)}
        data-koyomi="timeline-row"
        style={withLaneCountStyle(row.laneCount)}
      >
        {row.items.map((item) => {
          const itemProps = drag.getItemProps(item);
          const occurrence = item.occurrence;
          const isEditable = occurrence.event.editable !== false;
          const style = withEventColorStyle(
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
              style={style}
              aria-label={ariaLabel}
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
 * {@link TimelineRowGroupImpl} を `memo` でラップしたもの。
 *
 * `viewModel` は状態が変わるたびに丸ごと再構築されるため、既定の浅い比較（参照比較）
 * では `row` が常に「変わった」ことになり意味がない。表示に影響する値だけを比較する
 * カスタム比較関数を使うことで、ドラッグ中に無関係な行が再レンダーされないようにする
 * （`isDragging` はドラッグ開始・終了の瞬間だけ変化するので、その際は全行が 1 回だけ
 * 再評価され、対象アイテムの `data-koyomi-dragging` 表示が正しく更新される。
 * `time-grid-view.tsx` の `TimeGridDayColumn` と同じ設計）。
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
    samePreviewSegment(prev.preview, next.preview)
  );
});
