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
 * a11y: 行＝リソース・列＝時間トラックという 2 列固定の構造なので `role="grid"` で
 * grid/row/columnheader/rowheader/gridcell を完全に構成できる（他ビューと異なり本文にも
 * grid を適用する。理由は各行が「行見出し + 時間トラック 1 セル」の 2 セル固定で、
 * 週/日・リソースビューのような日単位の離散列を持たないため）。帯自体は `<button>` +
 * 完全な `aria-label`（日時 + リソース名）とする（判断根拠の詳細は `docs/accessibility.md` 参照）。
 */

import type { ReactElement, ReactNode } from 'react';
import { memo } from 'react';
import type {
  BusinessHourRange,
  EventOccurrence,
  TimelineItem,
  TimelineRow,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { TimelinePreviewSegment } from '../use-timeline-drag';
import { useTimelineDrag } from '../use-timeline-drag';
import { formatDayHeader } from './format';
import {
  formatEventAriaLabel,
  resolveEventAriaLabel,
  withEventColorStyle,
} from './month-view-parts';
import type { TimelineRowDragHandlers } from './timeline-view-parts';
import {
  DEFAULT_CORNER_LABEL,
  DEFAULT_EMPTY_LABEL,
  DEFAULT_UNASSIGNED_LABEL,
  MINUTES_PER_DAY,
  sameBusinessHourRanges,
  samePreviewSegment,
  sameTimelineRow,
  toDivRef,
  useStableTimelineDrag,
  withLaneCountStyle,
} from './timeline-view-parts';

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
  /**
   * ヘッダー行の角セル（行見出し列の列見出し）の `aria-label`。省略時は「リソース」。
   * 角セルは視覚上は空だが、本文行の行見出し（`rowheader`）列に対応する
   * `columnheader` として支援技術に公開される（列対応のずれを防ぐため）。
   */
  cornerLabel?: string;
  /**
   * 帯（タイムラインアイテム）の aria-label をカスタマイズする関数。
   * 第 2 引数に既定の aria-label 文字列（日時＋リソース名）を渡すので、
   * それを加工・置換して返せる。省略時は既定文字列をそのまま使う。
   * @param occurrence - 対象のオカレンス
   * @param defaultLabel - 既定の aria-label 文字列
   */
  eventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
}

/** 目盛り数の警告を出したかどうか（モジュールで一度だけ）。 */
let warnedSlotCount = false;

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
    cornerLabel = DEFAULT_CORNER_LABEL,
    eventAriaLabel,
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

  const { days, slots, rows, totalMinutes, nowIndicatorMinutes, isEmpty, businessHourRanges } =
    viewModel;
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
    // biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA grid（TimeGridView と同じ方針。<table> はテーマ CSS と噛み合わないため不採用）
    <div data-koyomi="timeline" data-koyomi-days={String(days.length)} role="grid">
      {/* grid と row の間に挟まるスクロールコンテナ。role="presentation" で
          所有関係を透過させる（grid の required owned elements 違反を避ける） */}
      <div data-koyomi="timeline-body" role="presentation">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 columnheader が担う） */}
        <div data-koyomi="timeline-header-row" role="row">
          {/* 角セル（行見出し列の列見出し）。presentation で隠すとヘッダー行と本文行で
              公開される列数がずれる（本文 = rowheader + gridcell の 2 列）ため、
              視覚上は空でも columnheader として公開する */}
          {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない） */}
          <div data-koyomi="timeline-corner" role="columnheader" aria-label={cornerLabel} />
          {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader（日ヘッダー・時刻目盛りをまとめた 1 セル） */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない） */}
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
        {rows.map((row) => (
          <TimelineRowGroup
            key={row.key}
            row={row}
            timeZone={timeZone}
            locale={locale}
            totalMinutes={totalMinutes}
            nowIndicatorMinutes={nowIndicatorMinutes}
            businessHourRanges={businessHourRanges}
            unassignedLabel={unassignedLabel}
            renderEvent={renderEvent}
            renderRowHeader={renderRowHeader}
            drag={stableDrag}
            isDragging={drag.isDragging}
            preview={drag.previewFor(row)}
            eventAriaLabel={eventAriaLabel}
          />
        ))}
      </div>
    </div>
  );
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
  renderEvent: ((item: TimelineItem) => ReactNode) | undefined;
  renderRowHeader: ((row: TimelineRow, defaultContent: ReactNode) => ReactNode) | undefined;
  drag: TimelineRowDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link TimelineRowGroup} 参照）。 */
  isDragging: boolean;
  preview: TimelinePreviewSegment | null;
  /** 帯の aria-label のカスタマイズ関数（省略時は既定文字列をそのまま使う）。 */
  eventAriaLabel: ((occurrence: EventOccurrence, defaultLabel: string) => string) | undefined;
}

/** タイムラインの 1 行分（行見出し + 帯トラック）。 */
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
    renderRowHeader,
    drag,
    preview,
    eventAriaLabel,
  } = props;
  const { ref, ...rowProps } = drag.getRowProps(row);
  const headerContent = row.resource?.title ?? unassignedLabel;

  return (
    // biome-ignore lint/a11y/useSemanticElements: 上記ヘッダー行と同様、div ベースの ARIA row
    // biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは rowheader/gridcell 内の各要素が担う）
    <div data-koyomi="timeline-row-group" role="row">
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA rowheader */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない） */}
      <div
        data-koyomi="timeline-resource-header"
        role="rowheader"
        {...(row.resource !== null ? { 'data-koyomi-resource-id': row.resource.id } : {})}
        style={withEventColorStyle({}, row.resource?.color)}
      >
        {renderRowHeader ? renderRowHeader(row, headerContent) : headerContent}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA gridcell（時間トラック 1 本を 1 セルとして扱う） */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: gridcell 自体はフォーカス対象にしない（内部の帯ボタンが個別にフォーカス可能） */}
      <div
        {...rowProps}
        ref={toDivRef(ref)}
        data-koyomi="timeline-row"
        role="gridcell"
        style={withLaneCountStyle(row.laneCount)}
      >
        {businessHourRanges.map((range) => (
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
          const defaultAriaLabel =
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
              aria-label={resolveEventAriaLabel(occurrence, defaultAriaLabel, eventAriaLabel)}
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
    sameBusinessHourRanges(prev.businessHourRanges, next.businessHourRanges) &&
    prev.unassignedLabel === next.unassignedLabel &&
    prev.renderEvent === next.renderEvent &&
    prev.renderRowHeader === next.renderRowHeader &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview) &&
    prev.eventAriaLabel === next.eventAriaLabel
  );
});
