/**
 * @packageDocumentation
 * `MonthView` — 月ビュー（グリッド表示）を描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
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
import { memo, useCallback } from 'react';
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
  /**
   * 「+N 件」（あふれ集約）ラベルのカスタマイズ関数。i18n 用途。
   * 省略時は `'+N 件'` 形式になる。
   * @param count - 「+N 件」に集約された非表示イベント数
   */
  overflowLabel?: (count: number) => ReactNode;
  /**
   * 日セルの内容をカスタマイズするスロット。祝日ラベルやバッジの注入に使う。
   * `defaultContent` は既定の内容（日番号ボタン＋（あれば）「+N 件」ボタン）であり、
   * そのまま包んで使うことも、完全に差し替えることもできる。省略時は既定内容をそのまま描画する。
   * @param day - 対象の日
   * @param defaultContent - 既定の内容
   */
  renderDayCell?: (day: MonthDay, defaultContent: ReactNode) => ReactNode;
}

/** `Intl.DateTimeFormat` インスタンスのキャッシュ（`locale|timeZone|種別` をキーにする）。 */
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * キャッシュ済みの `Intl.DateTimeFormat` を返す（未生成なら作ってキャッシュする）。
 * `new Intl.DateTimeFormat(...)` はロケールデータの解決コストがあるため、
 * 同じ locale・timeZone・用途の組み合わせでは再レンダーのたびに作り直さない。
 */
function getDateTimeFormat(
  locale: string,
  timeZone: TimeZoneId,
  kind: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${kind}`;
  const cached = dateTimeFormatCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, options);
  dateTimeFormatCache.set(cacheKey, formatter);
  return formatter;
}

/** 曜日ラベル（例: `'水'`）を Intl で生成する。 */
function formatWeekdayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'weekday', { timeZone, weekday: 'short' }).format(
    date,
  );
}

/** 日番号ラベル（例: `'15'`）を Intl で生成する。 */
function formatDayNumberLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'day-number', { timeZone, day: 'numeric' }).format(
    date,
  );
}

/** 時刻ラベル（`'H:mm'`、時は非ゼロ埋めの 24 時間制）を Intl で生成する。 */
function formatTimeLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'time', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** 日付ラベル（`'M月d日'` 相当）を Intl で生成する。 */
function formatDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'date', {
    timeZone,
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * 完全な日付ラベル（`'YYYY年M月d日'` 相当）を Intl で生成する。
 * 日セルの `aria-label` に使う（前後月の日も月情報が自然に含まれる）。
 */
function formatFullDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'full-date', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** 「+N 件」の既定ラベル。 */
function defaultOverflowLabel(count: number): ReactNode {
  return `+${count} 件`;
}

/**
 * オカレンスの表示上の最終日に含まれる瞬間を返す。
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

/** 週内での選択（ドラッグプレビュー）帯の可視列範囲。 */
interface WeekSelectionSpan {
  /** 開始列（可視列インデックス、0 起点）。 */
  startCol: number;
  /** 専有する列数。 */
  span: number;
}

/**
 * 週の可視列（`week.days`）のうち、`range` と交差する列範囲を求める。
 * 交差しなければ `null` を返す。
 */
function computeWeekSelectionSpan(
  days: readonly MonthDay[],
  range: DateRange,
  timeZone: TimeZoneId,
): WeekSelectionSpan | null {
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
  const { renderEvent, overflowLabel = defaultOverflowLabel, renderDayCell } = props;
  const { api, state, viewModel, callbacks } = useCalendarContext();
  const calendar = { api, state, viewModel };
  const dayDrag = useDayDrag({ calendar, callbacks });

  /** 指定日の day ビューへ切り替える。 */
  const goToDay = useCallback(
    (date: Date): void => {
      api.goTo(date);
      api.setView('day');
    },
    [api],
  );

  const onOverflowClickCallback = callbacks.onOverflowClick;
  /** 「+N 件」クリック。`onOverflowClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  const handleOverflowClick = useCallback(
    (day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]): void => {
      if (onOverflowClickCallback !== undefined) {
        onOverflowClickCallback(day, hiddenOccurrences);
        return;
      }
      goToDay(day.date);
    },
    [onOverflowClickCallback, goToDay],
  );

  if (viewModel.type !== 'month') {
    return null;
  }

  const { weeks } = viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const firstWeek = weeks[0];
  const previewRange = dayDrag.previewRange;

  // ドラッグプレビューとの交差判定は週ごとに一度だけここで行い、交差しない週には
  // 常に同じ `null` を渡す。これにより MonthWeekRow（memo化済み）は、無関係な週を
  // 「selectionSpan が変わっていない」として再レンダーせずに済む
  const weeksWithSelection = weeks.map((week) => ({
    week,
    selectionSpan:
      previewRange !== null ? computeWeekSelectionSpan(week.days, previewRange, timeZone) : null,
  }));

  return (
    // biome-ignore lint/a11y/useSemanticElements: DOM 仕様（components-dom.md）が定める div ベースの ARIA grid（<table> はテーマ CSS と噛み合わないため不採用）
    <div data-koyomi="month" role="grid">
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
      <div data-koyomi="month-weekdays" role="row">
        {(firstWeek?.days ?? []).map((day) => (
          // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
          // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
          <div key={day.key} data-koyomi="month-weekday" role="columnheader">
            {formatWeekdayLabel(day.date, timeZone, locale)}
          </div>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA rowgroup */}
      <div data-koyomi="month-weeks" role="rowgroup">
        {weeksWithSelection.map(({ week, selectionSpan }) => (
          <MonthWeekRow
            key={week.days[0]?.key ?? ''}
            week={week}
            timeZone={timeZone}
            locale={locale}
            selectionSpan={selectionSpan}
            dayDrag={dayDrag}
            renderEvent={renderEvent}
            overflowLabel={overflowLabel}
            renderDayCell={renderDayCell}
            onDayNumberClick={goToDay}
            onOverflowClick={handleOverflowClick}
          />
        ))}
      </div>
    </div>
  );
}

/** 月ビューの 1 週分（日セル行・イベント層・選択帯）。 */
const MonthWeekRow = memo(function MonthWeekRow(props: {
  week: MonthWeek;
  timeZone: TimeZoneId;
  locale: string;
  selectionSpan: WeekSelectionSpan | null;
  dayDrag: DayDragHandlers;
  renderEvent: ((segment: EventSegment) => ReactNode) | undefined;
  overflowLabel: (count: number) => ReactNode;
  renderDayCell: ((day: MonthDay, defaultContent: ReactNode) => ReactNode) | undefined;
  onDayNumberClick: (date: Date) => void;
  onOverflowClick: (day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => void;
}): ReactElement {
  const {
    week,
    timeZone,
    locale,
    selectionSpan,
    dayDrag,
    renderEvent,
    overflowLabel,
    renderDayCell,
    onDayNumberClick,
    onOverflowClick,
  } = props;

  // week.days は hiddenWeekdays により 7 未満になり得る可視列数。同じ週内の
  // イベント帯・選択帯の幅%計算はすべてこれを基準にする（ハードコードの `/ 7` を廃止）
  const columnCount = week.days.length;
  const visibleSegments = week.segments.filter((segment) => !segment.hidden);

  /** 指定列（可視列インデックス）を覆う非表示セグメントのオカレンス一覧を開始時刻順で返す。 */
  function hiddenOccurrencesAt(col: number): readonly EventOccurrence[] {
    return week.segments
      .filter(
        (segment) =>
          segment.hidden && col >= segment.startCol && col < segment.startCol + segment.span,
      )
      .map((segment) => segment.occurrence)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return (
    <div data-koyomi="month-week">
      {/* biome-ignore lint/a11y/useSemanticElements: 月ビューの DOM 仕様が定める div ベースの ARIA row（<table> は不採用、MonthView 側の理由と同じ） */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
      <div data-koyomi="month-days" role="row">
        {week.days.map((day, dayCol) => {
          const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
          const defaultContent = (
            <>
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
                  onClick={() => onOverflowClick(day, hiddenOccurrencesAt(dayCol))}
                >
                  {overflowLabel(day.overflowCount)}
                </button>
              )}
            </>
          );
          return (
            // biome-ignore lint/a11y/useSemanticElements: 月ビューの DOM 仕様が定める div ベースの ARIA gridcell（<table> は不採用、MonthView 側の理由と同じ）
            // biome-ignore lint/a11y/useFocusableInteractive: tabIndex は cellProps（useDayDrag.getDayCellProps）のスプレッド経由で付与済み。静的解析ではスプレッド元を検出できないための誤検知
            <div
              key={day.key}
              {...cellProps}
              ref={toDivRef(ref)}
              data-koyomi="month-day"
              role="gridcell"
              aria-label={formatFullDateLabel(day.date, timeZone, locale)}
              {...(day.isToday
                ? { 'data-today': 'true' as const, 'aria-current': 'date' as const }
                : {})}
              {...(!day.inCurrentMonth ? { 'data-outside': 'true' as const } : {})}
            >
              {renderDayCell ? renderDayCell(day, defaultContent) : defaultContent}
            </div>
          );
        })}
      </div>
      {/* イベント帯はセグメント（ボタン）自体が意味を持つため row/gridcell 構造には含めず、
          role="presentation" で除外する（aria-hidden にすると内部の focusable なボタンが
          支援技術から見えなくなってしまうため使わない） */}
      <div data-koyomi="month-events" role="presentation">
        {visibleSegments.map((segment) => (
          <MonthEventButton
            key={segment.occurrence.key}
            segment={segment}
            timeZone={timeZone}
            locale={locale}
            columnCount={columnCount}
            renderEvent={renderEvent}
            dayDrag={dayDrag}
          />
        ))}
      </div>
      {selectionSpan !== null && (
        <div
          data-koyomi="day-selection"
          aria-hidden="true"
          style={{
            insetInlineStart: `${(selectionSpan.startCol / columnCount) * 100}%`,
            width: `${(selectionSpan.span / columnCount) * 100}%`,
          }}
        />
      )}
    </div>
  );
});

/** 月ビューのイベントセグメント 1 件分のボタン。 */
const MonthEventButton = memo(function MonthEventButton(props: {
  segment: EventSegment;
  timeZone: TimeZoneId;
  locale: string;
  /** この週の可視列数（幅%計算の基準）。 */
  columnCount: number;
  renderEvent: ((segment: EventSegment) => ReactNode) | undefined;
  dayDrag: DayDragHandlers;
}): ReactElement {
  const { segment, timeZone, locale, columnCount, renderEvent, dayDrag } = props;
  const occurrence = segment.occurrence;
  const segmentProps = dayDrag.getSegmentProps(segment);
  const isEditable = occurrence.event.editable !== false;
  const style = withEventColorStyle(
    {
      insetInlineStart: `${(segment.startCol / columnCount) * 100}%`,
      width: `${(segment.span / columnCount) * 100}%`,
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
      {/* 左右端のリサイズハンドル。editable:false、またはこの週で継続表示中の端では出さない */}
      {isEditable && !segment.continuesBefore && (
        <span
          {...dayDrag.getSegmentResizeHandleProps(segment, 'start')}
          data-koyomi="month-event-resize"
          data-edge="start"
        />
      )}
      {isEditable && !segment.continuesAfter && (
        <span
          {...dayDrag.getSegmentResizeHandleProps(segment, 'end')}
          data-koyomi="month-event-resize"
          data-edge="end"
        />
      )}
    </button>
  );
});
