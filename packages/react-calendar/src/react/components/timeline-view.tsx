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
import { memo, useCallback } from 'react';
import type { BusinessHourRange, TimelineItem, TimelineRow, TimeZoneId } from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { CommonMessages, TimelineMessages } from '../locales/types';
import type { EventContentContext, EventContentRenderer, SlotRenderContext } from '../types';
import type { TimelinePreviewSegment } from '../use-timeline-drag';
import { useTimelineDrag } from '../use-timeline-drag';
import { resolveEventContent, titleOnlyEventContentContext } from './event-content';
import { withEventColorStyle } from './month-view-parts';
import { ariaLabelText, ariaLabelWithResource } from './resource-view-parts';
import type { TimelineRowDragHandlers } from './timeline-view-parts';
import {
  formatTimelineItemTimeText,
  sameBusinessHourRanges,
  samePreviewSegment,
  sameTimelineRow,
  TimelineAxisHeader,
  toDivRef,
  useStableTimelineDrag,
  withDepthStyle,
  withLaneCountStyle,
  withTimelineDaysStyle,
} from './timeline-view-parts';

/** 開発ビルドで目盛り数の警告を出す閾値。 */
const SLOT_COUNT_WARNING_THRESHOLD = 1000;

/** `TimelineView` の props。 */
export interface TimelineViewProps {
  /**
   * 帯（タイムラインアイテム）の表示内容をカスタマイズする関数。
   * 省略時はタイトルのみを表示する。
   *
   * `ctx.defaultContent` に省略時の内容、`ctx.parts` に分解済みパーツが渡される。
   * 指定した場合は `CalendarProvider` の `renderEventContent` より優先される。
   * @param item - 対象のタイムラインアイテム
   * @param ctx - 既定内容・スロット種別・分解済みパーツ
   */
  renderEvent?: (item: TimelineItem, ctx: EventContentContext) => ReactNode;
  /**
   * 行見出しの内容をカスタマイズする関数。
   * `ctx.defaultContent` は既定の内容（リソース名、未割り当て行は `messages.timeline.unassigned`）。
   * @param row - 対象の行
   * @param ctx - 既定内容
   */
  renderRowHeader?: (row: TimelineRow, ctx: SlotRenderContext) => ReactNode;
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
  const { renderEvent, renderRowHeader } = props;
  const { api, state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const timelineMessages = messages.timeline;
  const commonMessages = messages.common;
  // 行末の「+N 件」バッジは月ビューの overflow 文言を再利用する（新規メッセージ群は追加しない）。
  const overflowLabel = messages.month.overflow;
  const calendar = { api, state, viewModel };
  const drag = useTimelineDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  // `drag` は毎レンダー新しいオブジェクトになるため、行の memo 化が効くよう、
  // 参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableTimelineDrag(drag);
  // api の参照は再レンダリングを跨いで安定するため、onToggleCollapse も安定する
  // （行の memo 化が効くようにする。stableDrag と同じ狙い）。
  const onToggleCollapse = useCallback(
    (resourceId: string) => {
      api.toggleResourceCollapsed(resourceId);
    },
    [api],
  );

  if (viewModel.type !== 'timeline') {
    return null;
  }

  const {
    days,
    slots,
    rows,
    totalMinutes,
    nowIndicatorMinutes,
    isEmpty,
    businessHourRanges,
    scale,
    headerGroups,
  } = viewModel;
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
      <div data-koyomi="timeline" data-koyomi-scale={scale}>
        <div data-koyomi="timeline-empty">{timelineMessages.empty}</div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA grid（TimeGridView と同じ方針。<table> はテーマ CSS と噛み合わないため不採用）
    <div
      data-koyomi="timeline"
      data-koyomi-scale={scale}
      data-koyomi-days={String(days.length)}
      style={withTimelineDaysStyle(days.length)}
      role="grid"
    >
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
          <div
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
          />
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
            overflowLabel={overflowLabel}
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
  renderEvent: ((item: TimelineItem, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  renderRowHeader: ((row: TimelineRow, ctx: SlotRenderContext) => ReactNode) | undefined;
  drag: TimelineRowDragHandlers;
  /** ドラッグ操作が進行中か（memo 判定に使う。詳細は {@link TimelineRowGroup} 参照）。 */
  isDragging: boolean;
  preview: TimelinePreviewSegment | null;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  /** 折りたたみトグルボタンのクリックハンドラ（`api.toggleResourceCollapsed` へ委譲）。 */
  onToggleCollapse: (resourceId: string) => void;
  /** 中央メッセージカタログの `timeline` グループ（折りたたみトグルボタンの aria-label 組み立てに使う）。 */
  timelineMessages: TimelineMessages;
  /**
   * 行末の「+N 件」バッジ（{@link TimelineRow.overflowCount}）の表示内容。
   * 月ビューの overflow 文言（`messages.month.overflow`）を再利用する。
   */
  overflowLabel: (count: number) => ReactNode;
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
    renderEventContent,
    renderRowHeader,
    drag,
    preview,
    commonMessages,
    onToggleCollapse,
    timelineMessages,
    overflowLabel,
  } = props;
  const { ref, ...rowProps } = drag.getRowProps(row);
  const resource = row.resource;
  const headerContent = resource?.title ?? unassignedLabel;
  // timelineMaxLanes のあふれで hidden になった帯は描画しない
  // （非表示分は行末の「+N 件」バッジ（timeline-overflow）に集約する）。
  const visibleItems = row.items.filter((item) => !item.hidden);

  return (
    // biome-ignore lint/a11y/useSemanticElements: 上記ヘッダー行と同様、div ベースの ARIA row
    // biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは rowheader/gridcell 内の各要素が担う）
    <div data-koyomi="timeline-row-group" role="row">
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA rowheader */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない） */}
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
          >
            ▸
          </button>
        )}
        {renderRowHeader ? renderRowHeader(row, { defaultContent: headerContent }) : headerContent}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA gridcell（時間トラック 1 本を 1 セルとして扱う） */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: tabIndex は rowProps（useTimelineDrag.getRowProps）のスプレッド経由で付与済み。静的解析ではスプレッド元を検出できないための誤検知 */}
      <div
        {...rowProps}
        ref={toDivRef(ref)}
        data-koyomi="timeline-row"
        role="gridcell"
        // 行トラックは rowProps（useTimelineDrag.getRowProps）の tabIndex でフォーカス
        // 可能になり Enter/Space のキーボード作成対象になるため、リソース名（未割り当て
        // 行は unassigned の文言）をアクセシブルネームとして与える
        aria-label={resource !== null ? resource.title : ariaLabelText(unassignedLabel)}
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
        {visibleItems.map((item) => {
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
              aria-label={ariaLabelWithResource(
                occurrence,
                row.resource?.title,
                timeZone,
                locale,
                commonMessages,
              )}
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
        {row.overflowCount > 0 && (
          // 非表示帯は行末に集約表示するだけの静的バッジ（<button> にしない）。
          // ボタン化・クリックでの一覧表示は、row.overflowCount / row.hiddenItems を
          // 受け取れる renderRowHeader 等を使ってアプリ側の render prop に委ねる
          // ヘッドレス判断（月ビューの「+N 件」ボタンのような開閉連携は持たない）。
          <span
            data-koyomi="timeline-overflow"
            style={{ position: 'absolute', insetInlineEnd: 0, top: 0 }}
          >
            {overflowLabel(row.overflowCount)}
          </span>
        )}
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
    // sameTimelineRow（timeline-view-parts.tsx）は各アイテムの hidden・行の
    // overflowCount/hiddenItems を見ない。あふれ表示だけが変わるケース（表示アイテムの
    // 他フィールドは不変）を取りこぼさないよう、ここで追加分を明示的に比較する
    prev.row.overflowCount === next.row.overflowCount &&
    sameItemHiddenFlags(prev.row.items, next.row.items) &&
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
    prev.commonMessages === next.commonMessages &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.timelineMessages === next.timelineMessages &&
    prev.overflowLabel === next.overflowLabel
  );
});

/**
 * `TimelineItem[]` の `hidden` フラグ列だけが一致するかどうかを比較する。
 *
 * `sameTimelineRow`（`timeline-view-parts.tsx`）は `hidden` を見ないため、
 * 件数・並び順が同じ前提（`sameTimelineRow` 側で `sameTimelineItems` により
 * 保証済み）で、あふれ表示の再レンダー漏れを防ぐための補助比較。
 */
function sameItemHiddenFlags(a: readonly TimelineItem[], b: readonly TimelineItem[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => item.hidden === b[index]?.hidden);
}
