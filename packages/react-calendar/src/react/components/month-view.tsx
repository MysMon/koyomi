/**
 * @packageDocumentation
 * `MonthView` — 月ビュー（グリッド表示）を描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の契約は `docs/internal/components-dom.md` の
 * 「月ビュー（MonthView）」節を参照。スタイルは属性フックのみで当て、
 * 位置決めに必須の数値（%・calc）だけを inline style として出力する。
 * 日セル・帯セグメントのドラッグ操作は {@link useDayDrag} に委譲する。
 */

import type {
  CSSProperties,
  ReactElement,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { addDaysInZone } from '../../core/timezone';
import type {
  DateRange,
  EventOccurrence,
  EventSegment,
  MonthDay,
  MonthWeek,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { DayDragHandlers } from '../use-day-drag';
import { useDayDrag } from '../use-day-drag';

/** `MonthView` の props。 */
export interface MonthViewProps {
  /**
   * イベントセグメントの表示内容をカスタマイズする関数。
   * 省略時は、終日・複数日にまたがるセグメントはタイトルのみ、単日の時間指定
   * セグメント（`span === 1` かつ非終日）は開始時刻（`'H:mm'`）＋タイトルを表示する。
   */
  renderEvent?: (segment: EventSegment) => ReactNode;
}

/** 曜日ラベル（例: `'水'`）を Intl で生成する。 */
function formatWeekdayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(date);
}

/** 日番号ラベル（例: `'15'`）を Intl で生成する。 */
function formatDayNumberLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric' }).format(date);
}

/** 時刻ラベル（`'H:mm'`、時は非ゼロ埋めの 24 時間制）を Intl で生成する。 */
function formatTimeLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** 日付ラベル（`'M月d日'` 相当）を Intl で生成する。 */
function formatDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, month: 'long', day: 'numeric' }).format(date);
}

/**
 * 発生の表示上の最終日に含まれる瞬間を返す。
 * `end` は排他的なので、`end` の 1 ミリ秒前が属する日を終了日とする。
 */
function inclusiveEndInstant(occurrence: EventOccurrence): Date {
  return occurrence.end.getTime() > occurrence.start.getTime()
    ? new Date(occurrence.end.getTime() - 1)
    : occurrence.start;
}

/**
 * イベントの aria-label を Intl（表示 TZ）で生成する。
 * 終日イベントは日付範囲（`'タイトル、M月d日〜M月d日'`、単日なら日付 1 つのみ）、
 * 時間指定イベントは `'タイトル、M月d日 H:mm〜H:mm'` の形式になる。
 */
function formatEventAriaLabel(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
): string {
  const title = occurrence.event.title;
  if (occurrence.allDay) {
    const startLabel = formatDateLabel(occurrence.start, timeZone, locale);
    const endLabel = formatDateLabel(inclusiveEndInstant(occurrence), timeZone, locale);
    return startLabel === endLabel
      ? `${title}、${startLabel}`
      : `${title}、${startLabel}〜${endLabel}`;
  }
  const startDateLabel = formatDateLabel(occurrence.start, timeZone, locale);
  const endDateLabel = formatDateLabel(occurrence.end, timeZone, locale);
  const startTime = formatTimeLabel(occurrence.start, timeZone, locale);
  const endTime = formatTimeLabel(occurrence.end, timeZone, locale);
  // 複数日にまたがる場合は終了側にも日付を含める（読み上げの欠落防止）
  return startDateLabel === endDateLabel
    ? `${title}、${startDateLabel} ${startTime}〜${endTime}`
    : `${title}、${startDateLabel} ${startTime}〜${endDateLabel} ${endTime}`;
}

/**
 * イベントセグメントの既定の表示内容を組み立てる。
 * 終日・複数日にまたがるセグメント（`span > 1`）はタイトルのみ、
 * 単日の時間指定セグメントは開始時刻＋タイトルにする。
 */
function defaultSegmentContent(
  segment: EventSegment,
  timeZone: TimeZoneId,
  locale: string,
): ReactNode {
  const occurrence = segment.occurrence;
  if (occurrence.allDay || segment.span > 1) {
    return occurrence.event.title;
  }
  return `${formatTimeLabel(occurrence.start, timeZone, locale)} ${occurrence.event.title}`;
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
 * `getDayCellProps` が返す ref はタグ名を問わない `HTMLElement` 型だが、
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

/** 継続系の data 属性（`data-continues-before` / `data-continues-after`）を組み立てる。 */
function continuesAttrs(before: boolean, after: boolean): Record<string, 'true'> {
  const attrs: Record<string, 'true'> = {};
  if (before) {
    attrs['data-continues-before'] = 'true';
  }
  if (after) {
    attrs['data-continues-after'] = 'true';
  }
  return attrs;
}

/** pointerdown の伝播を止める（親の日セルが作成ドラッグを開始しないようにする）。 */
function stopPropagation(event: ReactPointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

/**
 * 週の 7 日（`week.days`）のうち、`range` と交差する列範囲を求める。
 * 交差しなければ `null` を返す。
 */
function computeWeekSelectionSpan(
  days: readonly MonthDay[],
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
 * 月ビュー（`MonthView`）を描画する。
 *
 * `useCalendarContext()` からビューモデルを取得し、`viewModel.type !== 'month'`
 * の場合は何も描画しない（`null` を返す）。日セル・帯セグメントのドラッグ操作は
 * {@link useDayDrag} に委譲する。
 *
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'month' });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick: openDetail }}>
 *     <MonthView />
 *   </CalendarProvider>
 * );
 * ```
 */
export function MonthView(props: MonthViewProps): ReactElement | null {
  const { renderEvent } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const dayDrag = useDayDrag({ calendar, callbacks });

  if (viewModel.type !== 'month') {
    return null;
  }

  const { weeks } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const firstWeek = weeks[0];

  /** 指定日の day ビューへ切り替える。 */
  function goToDay(date: Date): void {
    api.goTo(date);
    api.setView('day');
  }

  /** 「+N 件」クリック。`onOverflowClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  function handleOverflowClick(day: MonthDay): void {
    const onOverflowClick = callbacks.onOverflowClick;
    if (onOverflowClick !== undefined) {
      onOverflowClick(day);
      return;
    }
    goToDay(day.date);
  }

  return (
    <div data-koyomi="month">
      <div data-koyomi="month-weekdays">
        {(firstWeek?.days ?? []).map((day) => (
          <div key={day.key} data-koyomi="month-weekday">
            {formatWeekdayLabel(day.date, timeZone, locale)}
          </div>
        ))}
      </div>
      <div data-koyomi="month-weeks">
        {weeks.map((week) => (
          <MonthWeekRow
            key={week.days[0]?.key ?? ''}
            week={week}
            timeZone={timeZone}
            locale={locale}
            previewRange={dayDrag.previewRange}
            dayDrag={dayDrag}
            renderEvent={renderEvent}
            onDayNumberClick={goToDay}
            onOverflowClick={handleOverflowClick}
          />
        ))}
      </div>
    </div>
  );
}

/** 月ビューの 1 週分（日セル行・イベント層・選択帯）。 */
function MonthWeekRow(props: {
  week: MonthWeek;
  timeZone: TimeZoneId;
  locale: string;
  previewRange: DateRange | null;
  dayDrag: DayDragHandlers;
  renderEvent: ((segment: EventSegment) => ReactNode) | undefined;
  onDayNumberClick: (date: Date) => void;
  onOverflowClick: (day: MonthDay) => void;
}): ReactElement {
  const {
    week,
    timeZone,
    locale,
    previewRange,
    dayDrag,
    renderEvent,
    onDayNumberClick,
    onOverflowClick,
  } = props;

  const selectionSpan =
    previewRange !== null ? computeWeekSelectionSpan(week.days, previewRange, timeZone) : null;
  const visibleSegments = week.segments.filter((segment) => !segment.hidden);

  return (
    <div data-koyomi="month-week">
      <div data-koyomi="month-days">
        {week.days.map((day) => {
          const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
          return (
            <div
              key={day.key}
              {...cellProps}
              ref={toDivRef(ref)}
              data-koyomi="month-day"
              {...(day.isToday ? { 'data-today': 'true' as const } : {})}
              {...(!day.inCurrentMonth ? { 'data-outside': 'true' as const } : {})}
            >
              <button
                type="button"
                data-koyomi="month-day-number"
                onPointerDown={stopPropagation}
                onClick={() => onDayNumberClick(day.date)}
              >
                {formatDayNumberLabel(day.date, timeZone, locale)}
              </button>
              {day.overflowCount > 0 && (
                <button
                  type="button"
                  data-koyomi="month-overflow"
                  onPointerDown={stopPropagation}
                  onClick={() => onOverflowClick(day)}
                >
                  {`+${day.overflowCount} 件`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div data-koyomi="month-events">
        {visibleSegments.map((segment) => (
          <MonthEventButton
            key={segment.occurrence.key}
            segment={segment}
            timeZone={timeZone}
            locale={locale}
            renderEvent={renderEvent}
            dayDrag={dayDrag}
          />
        ))}
      </div>
      {selectionSpan !== null && (
        <div
          data-koyomi="day-selection"
          style={{
            left: `${(selectionSpan.startCol / 7) * 100}%`,
            width: `${(selectionSpan.span / 7) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

/** 月ビューのイベントセグメント 1 件分のボタン。 */
function MonthEventButton(props: {
  segment: EventSegment;
  timeZone: TimeZoneId;
  locale: string;
  renderEvent: ((segment: EventSegment) => ReactNode) | undefined;
  dayDrag: DayDragHandlers;
}): ReactElement {
  const { segment, timeZone, locale, renderEvent, dayDrag } = props;
  const occurrence = segment.occurrence;
  const segmentProps = dayDrag.getSegmentProps(segment);
  const style = withEventColorStyle(
    {
      left: `${(segment.startCol / 7) * 100}%`,
      width: `${(segment.span / 7) * 100}%`,
      top: `calc(var(--koyomi-month-header-height, 24px) + ${segment.lane} * var(--koyomi-lane-height, 24px))`,
    },
    occurrence.event.color,
  );

  return (
    <button
      type="button"
      {...segmentProps}
      {...continuesAttrs(segment.continuesBefore, segment.continuesAfter)}
      {...(occurrence.allDay ? { 'data-all-day': 'true' as const } : {})}
      data-koyomi="month-event"
      style={style}
      aria-label={formatEventAriaLabel(occurrence, timeZone, locale)}
    >
      {renderEvent ? renderEvent(segment) : defaultSegmentContent(segment, timeZone, locale)}
    </button>
  );
}
