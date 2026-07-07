/**
 * @packageDocumentation
 * `TimeGridView` — 週/日ビュー（時間グリッド）を描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の契約は `docs/internal/components-dom.md` の
 * 「週/日ビュー（TimeGridView）」節を参照。スタイルは属性フックのみで当て、
 * 位置決めに必須の数値（%・calc）だけを inline style として出力する。
 */

import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { addDaysInZone } from '../../core/timezone';
import type {
  DateRange,
  EventOccurrence,
  EventSegment,
  PositionedOccurrence,
  TimeGridDay,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { DayDragHandlers } from '../use-day-drag';
import { useDayDrag } from '../use-day-drag';
import type { TimeGridDragHandlers } from '../use-time-grid-drag';
import { useTimeGridDrag } from '../use-time-grid-drag';
import { formatWeekday } from './format';

/** 1 日の名目分数（24:00）。 */
const MINUTES_PER_DAY = 1440;

/** `TimeGridView` の props。 */
export interface TimeGridViewProps {
  /**
   * 時間グリッド上のイベント（時間指定）の表示内容をカスタマイズする。
   * 省略時は `'H:mm〜H:mm タイトル'` を表示する。
   * 終日行（`allday-event`）の内容はこの prop では変更できない（既定でタイトルのみ）。
   */
  renderEvent?: (item: PositionedOccurrence) => ReactNode;
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 分（0〜1440）を `'H:mm'` 形式（時は非ゼロ埋め）のラベルにする。 */
function formatClockLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${pad2(mins)}`;
}

/** 時間指定イベントの既定の表示内容（`'H:mm〜H:mm タイトル'`）。 */
function defaultTimedEventContent(item: PositionedOccurrence): string {
  return `${formatClockLabel(item.startMinutes)}〜${formatClockLabel(item.endMinutes)} ${item.occurrence.event.title}`;
}

/** 日番号ラベル（例: `'15'`）を Intl で生成する。 */
function formatDayNumberLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric' }).format(date);
}

/** 日付ラベル（`'M月d日'` 相当）を Intl で生成する。 */
function formatDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, month: 'long', day: 'numeric' }).format(date);
}

/** 時刻ラベル（`'H:mm'`、時は非ゼロ埋めの 24 時間制）を Intl で生成する。 */
function formatTimeOfDayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * イベントの aria-label を Intl（表示 TZ）で生成する。
 * 終日イベントは日付範囲のみ（`'タイトル、M月d日〜M月d日'`、単日なら日付 1 つ。
 * `end` は排他的なので 1 ミリ秒前が属する日を終了日とする）、
 * 時間指定イベントは `'タイトル、M月d日 H:mm〜H:mm'`
 * （複数日にまたがる場合は終了側にも日付を含める）。
 */
function formatOccurrenceAriaLabel(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): string {
  const title = occurrence.event.title;
  if (occurrence.allDay) {
    const inclusiveEnd =
      occurrence.end.getTime() > occurrence.start.getTime()
        ? new Date(occurrence.end.getTime() - 1)
        : occurrence.start;
    const startLabel = formatDateLabel(occurrence.start, timeZone, locale);
    const endLabel = formatDateLabel(inclusiveEnd, timeZone, locale);
    return startLabel === endLabel
      ? `${title}、${startLabel}`
      : `${title}、${startLabel}〜${endLabel}`;
  }
  const startDateLabel = formatDateLabel(occurrence.start, timeZone, locale);
  const endDateLabel = formatDateLabel(occurrence.end, timeZone, locale);
  const startTime = formatTimeOfDayLabel(occurrence.start, timeZone, locale);
  const endTime = formatTimeOfDayLabel(occurrence.end, timeZone, locale);
  return startDateLabel === endDateLabel
    ? `${title}、${startDateLabel} ${startTime}〜${endTime}`
    : `${title}、${startDateLabel} ${startTime}〜${endDateLabel} ${endTime}`;
}

/**
 * イベント色を CSS 変数 `--koyomi-event-color` として style に加える。
 *
 * `CSSProperties` の型定義にはカスタムプロパティが含まれないため、ここでのみ
 * `as` によるキャストを行う（CLAUDE.md に記載された唯一の許容箇所）。
 */
function withEventColorStyle(style: CSSProperties, color: string | undefined): CSSProperties {
  if (color === undefined) {
    return style;
  }
  // 'as' 使用理由: CSS カスタムプロパティ（--koyomi-event-color）は CSSProperties の
  // 型定義に含まれないため、ここでのみ許容されたキャストを行う（CLAUDE.md 参照）。
  return { ...style, '--koyomi-event-color': color } as CSSProperties;
}

/**
 * `Ref<HTMLElement>` を `<div>` にそのまま渡せる `Ref<HTMLDivElement>` に変換する。
 * `getDayCellProps` / `getDayProps` が返す ref はタグ名を問わない `HTMLElement` 型だが、
 * JSX の `<div ref={...}>` は `HTMLDivElement` 用のコールバックを要求するための橋渡し。
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
 * 日範囲（`range`）が表示中の `days` のどの列範囲と交差するかを求める。
 * 交差しなければ `null` を返す。
 */
function computeDaySpan(
  days: readonly TimeGridDay[],
  range: DateRange,
  timeZone: TimeZoneId,
): { startCol: number; span: number } | null {
  let startCol: number | null = null;
  let endCol: number | null = null;
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (day === undefined) {
      continue;
    }
    const dayStart = day.date;
    const nextDay = days[index + 1];
    const dayEnd = nextDay !== undefined ? nextDay.date : addDaysInZone(dayStart, 1, timeZone);
    if (range.end.getTime() <= dayStart.getTime() || range.start.getTime() >= dayEnd.getTime()) {
      continue;
    }
    if (startCol === null) {
      startCol = index;
    }
    endCol = index;
  }
  if (startCol === null || endCol === null) {
    return null;
  }
  return { startCol, span: endCol - startCol + 1 };
}

/**
 * 週/日ビュー（時間グリッド）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'timeGrid'`
 * の場合は何も描画しない（`null` を返す）。終日行のドラッグ操作は
 * {@link useDayDrag} に、時間グリッド本体のドラッグ操作は {@link useTimeGridDrag} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'week' });
 * return (
 *   <CalendarProvider value={calendar}>
 *     <TimeGridView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function TimeGridView(props: TimeGridViewProps): ReactElement | null {
  const { renderEvent } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const dayDrag = useDayDrag({ calendar, callbacks });
  const timeGridDrag = useTimeGridDrag({ calendar, callbacks });

  if (viewModel.type !== 'timeGrid') {
    return null;
  }

  const { days, allDaySegments, allDayLaneCount, slots, nowIndicator } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const columnCount = days.length;

  const selectAndGoToDay = (date: Date): void => {
    api.goTo(date);
    api.setView('day');
  };

  const alldayPreviewRange = state.dragPreview?.allDay ? state.dragPreview.range : null;
  const alldaySelectionSpan =
    alldayPreviewRange !== null ? computeDaySpan(days, alldayPreviewRange, timeZone) : null;

  return (
    <div data-koyomi="timegrid" data-koyomi-days={String(columnCount)}>
      <div data-koyomi="timegrid-header">
        <div data-koyomi="timegrid-axis-gutter" />
        {days.map((day) => (
          <div
            key={day.key}
            data-koyomi="timegrid-day-header"
            data-koyomi-date={day.key}
            data-today={day.isToday ? 'true' : undefined}
          >
            <span>{formatWeekday(day.weekday, locale)}</span>
            <button
              type="button"
              data-koyomi="timegrid-day-number"
              onClick={() => selectAndGoToDay(day.date)}
            >
              {formatDayNumberLabel(day.date, timeZone, locale)}
            </button>
          </div>
        ))}
      </div>

      <div data-koyomi="allday-row">
        <div data-koyomi="timegrid-axis-gutter" />
        <div
          data-koyomi="allday-cells"
          style={{ minHeight: `calc(${allDayLaneCount} * var(--koyomi-lane-height, 24px))` }}
        >
          {days.map((day) => {
            const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
            return (
              <div key={day.key} {...cellProps} ref={toDivRef(ref)} data-koyomi="allday-cell" />
            );
          })}
          {allDaySegments.map((segment) => (
            <AllDaySegmentButton
              key={segment.occurrence.key}
              segment={segment}
              columnCount={columnCount}
              timeZone={timeZone}
              locale={locale}
              dayDrag={dayDrag}
            />
          ))}
          {alldaySelectionSpan !== null && (
            <div
              data-koyomi="day-selection"
              style={{
                left: `${(alldaySelectionSpan.startCol / columnCount) * 100}%`,
                width: `${(alldaySelectionSpan.span / columnCount) * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      <div data-koyomi="timegrid-body">
        <div data-koyomi="time-axis">
          {slots.map((slot) => (
            <div key={slot.minutes} data-koyomi="time-slot-label">
              {slot.label}
            </div>
          ))}
        </div>
        <div data-koyomi="timegrid-days">
          {days.map((day) => (
            <TimeGridDayColumn
              key={day.key}
              day={day}
              slots={slots}
              timeZone={timeZone}
              locale={locale}
              nowIndicatorDayKey={nowIndicator?.dayKey ?? null}
              nowIndicatorMinutes={nowIndicator?.minutes ?? null}
              renderEvent={renderEvent}
              drag={timeGridDrag}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 終日行の帯セグメント 1 件分のボタン。 */
function AllDaySegmentButton(props: {
  segment: EventSegment;
  columnCount: number;
  timeZone: TimeZoneId;
  locale: string;
  dayDrag: DayDragHandlers;
}): ReactElement {
  const { segment, columnCount, timeZone, locale, dayDrag } = props;
  const occurrence = segment.occurrence;
  const segmentProps = dayDrag.getSegmentProps(segment);
  const style = withEventColorStyle(
    {
      left: `${(segment.startCol / columnCount) * 100}%`,
      width: `${(segment.span / columnCount) * 100}%`,
      top: `calc(${segment.lane} * var(--koyomi-lane-height, 24px))`,
    },
    occurrence.event.color,
  );

  return (
    <button
      type="button"
      {...segmentProps}
      data-koyomi="allday-event"
      data-continues-before={segment.continuesBefore ? 'true' : undefined}
      data-continues-after={segment.continuesAfter ? 'true' : undefined}
      style={style}
      aria-label={formatOccurrenceAriaLabel(occurrence, timeZone, locale)}
    >
      {occurrence.event.title}
    </button>
  );
}

/** 時間グリッドの日列（1 列分）。罫線・イベント・プレビュー・現在時刻線を描画する。 */
function TimeGridDayColumn(props: {
  day: TimeGridDay;
  slots: readonly TimeSlot[];
  timeZone: TimeZoneId;
  locale: string;
  nowIndicatorDayKey: string | null;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence) => ReactNode) | undefined;
  drag: TimeGridDragHandlers;
}): ReactElement {
  const {
    day,
    slots,
    timeZone,
    locale,
    nowIndicatorDayKey,
    nowIndicatorMinutes,
    renderEvent,
    drag,
  } = props;
  const { ref, ...dayProps } = drag.getDayProps(day);
  const preview = drag.previewFor(day);
  const showNowIndicator = nowIndicatorDayKey === day.key && nowIndicatorMinutes !== null;

  return (
    <div
      {...dayProps}
      ref={toDivRef(ref)}
      data-koyomi="timegrid-day"
      data-today={day.isToday ? 'true' : undefined}
    >
      {slots.map((slot) => (
        <div
          key={slot.minutes}
          data-koyomi="timegrid-slot"
          style={{ top: `${(slot.minutes / MINUTES_PER_DAY) * 100}%` }}
        />
      ))}
      {day.items.map((item) => (
        <TimeGridEventButton
          key={item.occurrence.key}
          item={item}
          timeZone={timeZone}
          locale={locale}
          renderEvent={renderEvent}
          drag={drag}
        />
      ))}
      {preview !== null && (
        <div
          data-koyomi="timegrid-preview"
          data-kind={preview.kind}
          style={{
            top: `${(preview.startMinutes / MINUTES_PER_DAY) * 100}%`,
            height: `${((preview.endMinutes - preview.startMinutes) / MINUTES_PER_DAY) * 100}%`,
          }}
        />
      )}
      {showNowIndicator && nowIndicatorMinutes !== null && (
        <div
          data-koyomi="now-indicator"
          style={{ top: `${(nowIndicatorMinutes / MINUTES_PER_DAY) * 100}%` }}
        />
      )}
    </div>
  );
}

/** 時間グリッド内の時間指定イベント 1 件分のボタン（リサイズハンドルを含む）。 */
function TimeGridEventButton(props: {
  item: PositionedOccurrence;
  timeZone: TimeZoneId;
  locale: string;
  renderEvent: ((item: PositionedOccurrence) => ReactNode) | undefined;
  drag: TimeGridDragHandlers;
}): ReactElement {
  const { item, timeZone, locale, renderEvent, drag } = props;
  const occurrence = item.occurrence;
  const eventProps = drag.getEventProps(item);
  const isEditable = occurrence.event.editable !== false;
  const style = withEventColorStyle(
    {
      top: `${(item.startMinutes / MINUTES_PER_DAY) * 100}%`,
      height: `${((item.endMinutes - item.startMinutes) / MINUTES_PER_DAY) * 100}%`,
      left: `${item.left * 100}%`,
      width: `${item.width * 100}%`,
    },
    occurrence.event.color,
  );

  return (
    <button
      type="button"
      {...eventProps}
      data-koyomi="timegrid-event"
      data-continues-before={item.continuesBefore ? 'true' : undefined}
      data-continues-after={item.continuesAfter ? 'true' : undefined}
      style={style}
      aria-label={formatOccurrenceAriaLabel(occurrence, timeZone, locale)}
    >
      <div data-koyomi="timegrid-event-content">
        {renderEvent ? renderEvent(item) : defaultTimedEventContent(item)}
      </div>
      {isEditable && <div data-koyomi="timegrid-resize" {...drag.getResizeHandleProps(item)} />}
    </button>
  );
}
