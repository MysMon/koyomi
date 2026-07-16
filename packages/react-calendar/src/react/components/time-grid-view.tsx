/**
 * @packageDocumentation
 * `TimeGridView` — 週/日ビュー（時間グリッド）を描画するヘッドレスコンポーネント。
 *
 * DOM 構造・`data-koyomi-*` 属性の仕様は `docs/internal/components-dom.md` の
 * 「週/日ビュー（TimeGridView）」節を参照。スタイルは属性フックのみで当て、
 * 位置決めに必須の数値（%・calc）だけを inline style として出力する。
 *
 * a11y: 日ヘッダー行・終日行は日単位の離散セルなので、両者だけをまとめた
 * `timegrid-grid`（`role="grid"`）の中で row/columnheader/gridcell を構成する
 * （MonthView と同じ方針）。本文（時間軸 + 日列）は連続的な時間位置決めで離散セルに
 * 対応しないため grid 化しない。`role="grid"` の owned elements は row/rowgroup に
 * 限られる（WAI-ARIA grid パターン）ため、本文は grid 化しないだけでなく
 * `timegrid-grid` の**外側**（兄弟要素）に置き、内部の予定ボタンが grid の子孫として
 * アクセシビリティツリーに漏れ出さないようにする。終日イベントの帯
 * （`AllDaySegmentButton`）は複数日にまたがり得るが、DOM 上は**開始日の gridcell
 * （`allday-cell`）の子**として所有させる（ResourceView の終日アイテムと同じ正当な
 * ネスト。`role="presentation"` のレイヤーに置く方式は、レイヤー自身の意味論しか
 * 消えず内部の focusable なボタンが grid の子孫として露出したままになるため不可）。
 * ボタンの positioned ancestor はセルではなく `allday-cells`（position: relative）
 * なので、視覚上の列スパンはセルの所有関係と無関係に絶対配置で実現できる。
 * 範囲選択プレビュー（`day-selection`）も `allday-cells` 直下に置き、% オフセットが
 * テーマ変数に依存せず列位置と一致する不変条件を保つ（focusable を含まないため
 * aria-hidden で除外。判断根拠・既知の制限の詳細は `docs/accessibility.md` 参照）。
 */

import type { ReactElement, ReactNode, Ref } from 'react';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { addDaysInZone, startOfDayInZone } from '../../core/timezone';
import type {
  BusinessHourSlot,
  DateRange,
  EventOccurrence,
  EventSegment,
  PositionedOccurrence,
  TimeAxis,
  TimeGridDay,
  TimeSlot,
  TimeZoneId,
} from '../../core/types';
import { useCalendarContext } from '../context';
import type { CommonMessages } from '../locales/types';
import { scrollContainerToTime } from '../scroll-to-time';
import type { EventContentContext, EventContentRenderer, SlotRenderContext } from '../types';
import type { DayDragHandlers } from '../use-day-drag';
import { useDayDrag } from '../use-day-drag';
import type { TimeGridDragHandlers, TimeGridPreviewSegment } from '../use-time-grid-drag';
import { useTimeGridDrag } from '../use-time-grid-drag';
import {
  resolveEventContent,
  timedTextEventContentContext,
  titleOnlyEventContentContext,
} from './event-content';
import { formatTimeZoneLabel, formatWeekday } from './format';
import {
  percentOfSlotRange,
  withEventColorStyle,
  withTimegridHoursStyle,
} from './month-view-parts';

/** 1 日の分（24:00）。 */
const MINUTES_PER_DAY = 1440;

/** `TimeGridView` の props。 */
export interface TimeGridViewProps {
  /**
   * 時間グリッド上のイベント（時間指定）の表示内容をカスタマイズする。
   * 省略時は `'H:mm〜H:mm タイトル'` を表示する。
   * 終日行（`allday-event`）の内容はこの prop では変更できない。終日行の内容を
   * カスタマイズしたい場合は {@link TimeGridViewProps.renderAllDayEvent} を使う。
   *
   * `ctx.defaultContent` に省略時の内容、`ctx.parts` に分解済みパーツ
   * （整形済みの時刻範囲テキスト・タイトル）が渡される。指定した場合は
   * `CalendarProvider` の `renderEventContent` より優先される。
   * @param item - 対象の配置済みオカレンス
   * @param ctx - 既定内容・スロット種別・分解済みパーツ
   */
  renderEvent?: (item: PositionedOccurrence, ctx: EventContentContext) => ReactNode;
  /**
   * 終日行（`allday-event`）の帯の表示内容をカスタマイズする。
   * 省略時はタイトルのみを表示する（既定のまま）。指定した場合は
   * `CalendarProvider` の `renderEventContent` より優先される。
   * @param segment - 対象のセグメント
   * @param ctx - 既定内容・スロット種別・分解済みパーツ
   */
  renderAllDayEvent?: (segment: EventSegment, ctx: EventContentContext) => ReactNode;
  /**
   * 日ヘッダー（曜日ラベル＋日番号ボタン）の表示内容をカスタマイズする。
   * `ctx.defaultContent` には省略時の内容（曜日ラベルと日番号ボタン）が渡されるので、
   * それをラップしたり前後に要素を足したりする用途に使える。省略時は
   * 既定内容をそのまま表示する。
   *
   * @example
   * ```tsx
   * <TimeGridView
   *   renderDayHeader={(day, ctx) => (
   *     <>
   *       {ctx.defaultContent}
   *       {day.isToday && <span data-koyomi="today-badge">今日</span>}
   *     </>
   *   )}
   * />
   * ```
   */
  renderDayHeader?: (day: TimeGridDay, ctx: SlotRenderContext) => ReactNode;
  /**
   * マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置（`'HH:mm'`）。
   * 表示時間帯制限（{@link CalendarOptions.slotMinTime}/{@link CalendarOptions.slotMaxTime}）とは
   * 独立して機能する。事後に値を変更しても再適用されない（`ref.current.scrollToTime` を使うこと）。
   */
  initialScrollTime?: string;
  /**
   * {@link TimeGridViewHandle}（`scrollToTime` などの命令的 API）を受け取る ref。
   */
  // React 本体の RefAttributes と同じく明示的な undefined を許容する
  // （exactOptionalPropertyTypes 下で `ref={maybeUndefined}` を書けるようにするため）
  ref?: Ref<TimeGridViewHandle> | undefined;
}

/** {@link TimeGridView} が `ref` 経由で公開する命令的 API。 */
export interface TimeGridViewHandle {
  /**
   * `[data-koyomi="timegrid-body"]` を指定時刻の位置へスクロールする。
   * 時刻が表示時間帯の外側の場合は最も近い境界へクランプする。`'HH:mm'` として
   * 解析できない場合は何もしない。
   */
  scrollToTime(time: string): void;
}

/**
 * {@link formatClockLabel} が使う `Intl.DateTimeFormat` インスタンスのキャッシュ。
 * ロケールごとに 1 つだけ生成して使い回す。
 */
const clockLabelFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * `formatClockLabel` 用の `Intl.DateTimeFormat` をロケールごとにキャッシュして返す。
 */
function getClockLabelFormatter(locale: string): Intl.DateTimeFormat {
  const cached = clockLabelFormatterCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    // 実行環境のローカル TZ の影響を受けないよう、日付部分を固定した「架空の UTC 時刻」
    // として整形する（時刻の大小関係のみが意味を持つ値のため、実際の年月日は無関係）。
    timeZone: 'UTC',
  });
  clockLabelFormatterCache.set(locale, formatter);
  return formatter;
}

/** 分（0〜1440）を、ロケールに応じた時刻ラベル（時は非ゼロ埋め）にする。 */
function formatClockLabel(minutes: number, locale: string): string {
  const fakeUtcDate = new Date(Date.UTC(2000, 0, 1, 0, 0) + minutes * 60_000);
  return getClockLabelFormatter(locale).format(fakeUtcDate);
}

/**
 * 時間指定イベント（`timegrid-event`）のイベント内容コンテキストを組み立てる。
 * 既定内容は `'H:mm〜H:mm タイトル'`。
 */
function timegridEventContentContext(
  item: PositionedOccurrence,
  locale: string,
): EventContentContext {
  return timedTextEventContentContext(
    'timegrid-event',
    `${formatClockLabel(item.startMinutes, locale)}〜${formatClockLabel(item.endMinutes, locale)}`,
    item.occurrence.event.title,
  );
}

/** キャッシュする `Intl.DateTimeFormat` の種別。 */
type DateTimeFormatterKind = 'dayNumber' | 'date' | 'fullDate' | 'timeOfDay';

/** 種別ごとの `Intl.DateTimeFormat` オプション（`timeZone` は取得時に合成する）。 */
const DATE_TIME_FORMAT_OPTIONS: Record<DateTimeFormatterKind, Intl.DateTimeFormatOptions> = {
  dayNumber: { day: 'numeric' },
  date: { month: 'long', day: 'numeric' },
  fullDate: { year: 'numeric', month: 'long', day: 'numeric' },
  timeOfDay: { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' },
};

/**
 * `Intl.DateTimeFormat` インスタンスをモジュールレベルでキャッシュする。
 *
 * 生成コストのある `Intl.DateTimeFormat` を、時間グリッドのセル・イベントの数だけ
 * 描画のたびに毎回 `new` してしまうのを避けるため、`ロケール・タイムゾーン・種別`
 * の組ごとに 1 つだけ生成して使い回す。
 */
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * キャッシュ済みの `Intl.DateTimeFormat` を取得する（未生成ならキャッシュに追加する）。
 * キーは `${locale}|${timeZone}|${種別}`。
 */
function getDateTimeFormatter(
  locale: string,
  timeZone: TimeZoneId,
  kind: DateTimeFormatterKind,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${kind}`;
  const cached = dateTimeFormatterCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    ...DATE_TIME_FORMAT_OPTIONS[kind],
    timeZone,
  });
  dateTimeFormatterCache.set(cacheKey, formatter);
  return formatter;
}

/** 日番号ラベル（例: `'15'`）を Intl で生成する。 */
function formatDayNumberLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormatter(locale, timeZone, 'dayNumber').format(date);
}

/** 日付ラベル（`'M月d日'` 相当）を Intl で生成する。 */
function formatDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormatter(locale, timeZone, 'date').format(date);
}

/**
 * 完全な日付ラベル（`'YYYY年M月d日'` 相当、年を含む）を Intl で生成する。
 * 日ヘッダーの日番号ボタンの `aria-label` に使う。
 */
function formatFullDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormatter(locale, timeZone, 'fullDate').format(date);
}

/** 時刻ラベル（`'H:mm'`、時は非ゼロ埋めの 24 時間制）を Intl で生成する。 */
function formatTimeOfDayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormatter(locale, timeZone, 'timeOfDay').format(date);
}

/**
 * イベントの日時範囲ラベルを Intl（表示 TZ）で生成する。
 * 終日イベントは日付範囲のみ（`'M月d日〜M月d日'`、単日なら日付 1 つ。
 * `end` は排他的なので 1 ミリ秒前が属する日を終了日とする）、
 * 時間指定イベントは `'M月d日 H:mm〜H:mm'`
 * （複数日にまたがる場合は終了側にも日付を含める）。
 *
 * 時刻部分は `formatTimeOfDayLabel`（`hourCycle: 'h23'` 固定）で整形する
 * （`month-view-parts.tsx` の `formatTimeLabel` と異なり、`locale` の慣習に
 * かかわらず常に 24 時間制になる。既知の制限として今回のスコープ外）。
 *
 * @param occurrence - 対象のオカレンス
 * @param timeZone - 表示タイムゾーン
 * @param locale - ロケール
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}）
 */
function formatTimeGridRangeLabel(
  occurrence: EventOccurrence,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string {
  if (occurrence.allDay) {
    const inclusiveEnd =
      occurrence.end.getTime() > occurrence.start.getTime()
        ? new Date(occurrence.end.getTime() - 1)
        : occurrence.start;
    const startLabel = formatDateLabel(occurrence.start, timeZone, locale);
    const endLabel = formatDateLabel(inclusiveEnd, timeZone, locale);
    return startLabel === endLabel ? startLabel : `${startLabel}${rangeSeparator}${endLabel}`;
  }
  const startDateLabel = formatDateLabel(occurrence.start, timeZone, locale);
  const endDateLabel = formatDateLabel(occurrence.end, timeZone, locale);
  const startTime = formatTimeOfDayLabel(occurrence.start, timeZone, locale);
  const endTime = formatTimeOfDayLabel(occurrence.end, timeZone, locale);
  return startDateLabel === endDateLabel
    ? `${startDateLabel} ${startTime}${rangeSeparator}${endTime}`
    : `${startDateLabel} ${startTime}${rangeSeparator}${endDateLabel} ${endTime}`;
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
    // 各列は「その日 1 日」だけを表す。hiddenWeekdays で非表示日が挟まっても隣の
    // 表示日までの区間として扱わない（非表示日の選択が隣接表示列へ誤ってはみ出すのを防ぐ）。
    const dayEnd = startOfDayInZone(addDaysInZone(dayStart, 1, timeZone), timeZone);
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
 * `TimeGridDayColumn` / `TimeGridEventButton` が実際に必要とするドラッグハンドラだけを
 * 抜き出した型。`previewFor` はここに含めない（{@link TimeGridView} 側で解決済みの値を
 * `preview` prop として渡すため）。
 */
interface TimeGridColumnDragHandlers {
  getDayProps: TimeGridDragHandlers['getDayProps'];
  getEventProps: TimeGridDragHandlers['getEventProps'];
  getResizeHandleProps: TimeGridDragHandlers['getResizeHandleProps'];
}

/**
 * `useTimeGridDrag` の戻り値は毎レンダー新しいオブジェクト（関数含む）になるため、
 * そのまま `memo` 化した子コンポーネントの props に渡すと再レンダー抑制が効かない。
 * ここで参照が変わらないラッパーを 1 度だけ作り、呼び出し時に ref 経由で常に最新の
 * ハンドラへ委譲することで、props の同一性を保ったまま最新の挙動を保証する。
 */
function useStableColumnDrag(drag: TimeGridDragHandlers): TimeGridColumnDragHandlers {
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [stable] = useState<TimeGridColumnDragHandlers>(() => ({
    getDayProps: (day) => dragRef.current.getDayProps(day),
    getEventProps: (item) => dragRef.current.getEventProps(item),
    getResizeHandleProps: (item, edge) => dragRef.current.getResizeHandleProps(item, edge),
  }));
  return stable;
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

/** `BusinessHourSlot` 配列の内容が等しいかどうかを比較する。 */
function sameBusinessHourSlots(
  a: readonly BusinessHourSlot[],
  b: readonly BusinessHourSlot[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((slot, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      slot.minutes === other.minutes &&
      slot.isBusinessHours === other.isBusinessHours
    );
  });
}

/** `TimeGridDay` の、表示に影響する内容が等しいかどうかを比較する。 */
function sameTimeGridDay(a: TimeGridDay, b: TimeGridDay): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.key === b.key &&
    a.isToday === b.isToday &&
    a.weekday === b.weekday &&
    a.date.getTime() === b.date.getTime() &&
    samePositionedOccurrences(a.items, b.items) &&
    sameBusinessHourSlots(a.businessHourSlots, b.businessHourSlots)
  );
}

/** `TimeGridPreviewSegment` の内容が等しいかどうかを比較する。 */
function samePreviewSegment(
  a: TimeGridPreviewSegment | null,
  b: TimeGridPreviewSegment | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return (
    a.kind === b.kind &&
    a.startMinutes === b.startMinutes &&
    a.endMinutes === b.endMinutes &&
    (a.invalid ?? false) === (b.invalid ?? false)
  );
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
  const { renderEvent, renderAllDayEvent, renderDayHeader, initialScrollTime, ref } = props;
  const { api, state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const commonMessages = messages.common;
  const calendar = { api, state, viewModel };
  const dayDrag = useDayDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  const timeGridDrag = useTimeGridDrag({
    calendar,
    callbacks,
    defaultEventTitle: commonMessages.untitledEvent,
  });
  // `timeGridDrag` は毎レンダー新しいオブジェクトになるため、日列・イベントボタンの
  // memo 化が効くよう、参照が変わらないラッパー経由で渡す（詳細は関数コメント参照）。
  const stableDrag = useStableColumnDrag(timeGridDrag);

  // viewModel.type !== 'timeGrid'（早期 return 前）でもフックは無条件に呼ぶ必要があるため、
  // スクロール計算に使う表示時間帯（分）は安全な既定値へフォールバックする
  // （VirtualResourceView の columns フォールバックと同じ方針）。
  const slotMinTimeMinutes = viewModel.type === 'timeGrid' ? viewModel.slotMinTimeMinutes : 0;
  const slotMaxTimeMinutes =
    viewModel.type === 'timeGrid' ? viewModel.slotMaxTimeMinutes : MINUTES_PER_DAY;

  const bodyRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    (): TimeGridViewHandle => ({
      scrollToTime(time: string) {
        if (bodyRef.current !== null) {
          scrollContainerToTime(bodyRef.current, time, slotMinTimeMinutes, slotMaxTimeMinutes);
        }
      },
    }),
    [slotMinTimeMinutes, slotMaxTimeMinutes],
  );

  // マウント時に一度だけ initialScrollTime を適用する（VirtualResourceView の
  // useImperativeHandle 実装と同型。事後の initialScrollTime / 表示時間帯の変更では
  // 再適用しない意図的な設計のため、依存配列は空にする）。
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

  const selectAndGoToDay = useCallback(
    (date: Date): void => {
      api.goTo(date);
      api.setView('day');
    },
    [api],
  );

  const onDayNumberClickCallback = callbacks.onDayNumberClick;
  /** 日番号クリック。`onDayNumberClick` があればそれを呼び、なければ day ビューへ切り替える。 */
  const handleDayNumberClick = useCallback(
    (date: Date): void => {
      if (onDayNumberClickCallback !== undefined) {
        onDayNumberClickCallback(date);
        return;
      }
      selectAndGoToDay(date);
    },
    [onDayNumberClickCallback, selectAndGoToDay],
  );

  if (viewModel.type !== 'timeGrid') {
    return null;
  }

  const { days, allDaySegments, allDayLaneCount, slots, timeAxes, nowIndicator, weekNumber } =
    viewModel;
  const { timeZone, options } = state;
  const { locale } = options;
  const columnCount = days.length;

  const alldayPreviewRange = state.dragPreview?.allDay ? state.dragPreview.range : null;
  const alldaySelectionSpan =
    alldayPreviewRange !== null ? computeDaySpan(days, alldayPreviewRange, timeZone) : null;
  const alldaySelectionInvalid = state.dragPreview?.invalid ?? false;

  return (
    <div
      data-koyomi="timegrid"
      data-koyomi-days={String(columnCount)}
      style={withTimegridHoursStyle(slotMinTimeMinutes, slotMaxTimeMinutes)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA grid（MonthView と同じ方針。<table> はテーマ CSS と噛み合わないため不採用） */}
      <div data-koyomi="timegrid-grid" role="grid">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 columnheader/gridcell が担う） */}
        <div
          data-koyomi="timegrid-header"
          role="row"
          {...(weekNumber !== null ? { 'data-koyomi-week-number': String(weekNumber) } : {})}
        >
          {timeAxes.map((axis, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: timeAxes は options 由来の固定順の配列（並べ替わらない）
              key={`${index}-${axis.timeZone}`}
              data-koyomi="timegrid-axis-gutter"
              data-koyomi-timezone={axis.timeZone}
              role="presentation"
            >
              {/* 軸がどのタイムゾーンの時刻かを示す GMT オフセットラベル（視覚補助） */}
              {days[0] !== undefined && (
                <span data-koyomi="time-axis-label" aria-hidden="true">
                  {formatTimeZoneLabel(days[0].date, axis.timeZone, locale)}
                </span>
              )}
            </div>
          ))}
          {days.map((day) => {
            const defaultDayHeaderContent = (
              <>
                <span data-koyomi="timegrid-weekday">{formatWeekday(day.weekday, locale)}</span>
                <button
                  type="button"
                  data-koyomi="timegrid-day-number"
                  aria-label={formatFullDateLabel(day.date, timeZone, locale)}
                  onClick={() => handleDayNumberClick(day.date)}
                >
                  {formatDayNumberLabel(day.date, timeZone, locale)}
                </button>
              </>
            );
            return (
              // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA columnheader
              // biome-ignore lint/a11y/useFocusableInteractive: 見出しセルはフォーカス対象にしない（ネイティブ <th> も単体ではタブ移動対象にならない）
              <div
                key={day.key}
                data-koyomi="timegrid-day-header"
                data-koyomi-date={day.key}
                data-today={day.isToday ? 'true' : undefined}
                role="columnheader"
                aria-current={day.isToday ? 'date' : undefined}
              >
                {renderDayHeader
                  ? renderDayHeader(day, { defaultContent: defaultDayHeaderContent })
                  : defaultDayHeaderContent}
              </div>
            );
          })}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA row */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: 複合ウィジェットの row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
        <div data-koyomi="allday-row" role="row">
          {timeAxes.map((axis, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 上記ヘッダー行の gutter と同じ理由（固定順の配列）
              key={`${index}-${axis.timeZone}`}
              data-koyomi="timegrid-axis-gutter"
              data-koyomi-timezone={axis.timeZone}
              role="presentation"
            />
          ))}
          <div
            data-koyomi="allday-cells"
            role="presentation"
            style={{ minHeight: `calc(${allDayLaneCount} * var(--koyomi-lane-height, 24px))` }}
          >
            {days.map((day, col) => {
              const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記と同様、div ベースの ARIA gridcell
                // biome-ignore lint/a11y/useFocusableInteractive: tabIndex は cellProps（useDayDrag.getDayCellProps）のスプレッド経由で付与済み。静的解析ではスプレッド元を検出できないための誤検知
                <div
                  key={day.key}
                  {...cellProps}
                  ref={toDivRef(ref)}
                  data-koyomi="allday-cell"
                  role="gridcell"
                  aria-label={formatFullDateLabel(day.date, timeZone, locale)}
                >
                  {/* 帯セグメントは複数日にまたがり得るが、DOM 上は開始日の gridcell が
                        所有する（grid の子孫の focusable を row/gridcell の所有関係の外に
                        置かないため）。ボタンは absolute 配置で、positioned ancestor は
                        セルではなく allday-cells（position: relative）なので、列をまたぐ
                        視覚上のスパンと座標計算はレイヤー方式と変わらない */}
                  {allDaySegments
                    .filter((segment) => segment.startCol === col)
                    .map((segment) => (
                      <AllDaySegmentButton
                        key={segment.occurrence.key}
                        segment={segment}
                        columnCount={columnCount}
                        timeZone={timeZone}
                        locale={locale}
                        dayDrag={dayDrag}
                        renderAllDayEvent={renderAllDayEvent}
                        renderEventContent={renderEventContent}
                        commonMessages={commonMessages}
                      />
                    ))}
                </div>
              );
            })}
            {/* 範囲選択プレビュー。allday-cells（position: relative）直下に置くことで、
                  % オフセットがテーマ変数（ガター幅）に依存せず常に列位置と一致する。
                  focusable を含まないため aria-hidden でアクセシビリティツリーから除外
                  され、grid の owned elements にも現れない */}
            {alldaySelectionSpan !== null && (
              <div
                data-koyomi="day-selection"
                aria-hidden="true"
                {...(alldaySelectionInvalid ? { 'data-koyomi-invalid': 'true' } : {})}
                style={{
                  insetInlineStart: `${(alldaySelectionSpan.startCol / columnCount) * 100}%`,
                  width: `${(alldaySelectionSpan.span / columnCount) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 本文（時間軸 + 日列）は連続的な時間位置決めで離散セルに対応しないため grid 化しない
          （詳細は docs/accessibility.md 参照）。role="grid" の owned elements は row/rowgroup
          に限られる（WAI-ARIA grid パターン）ため、grid 化しないだけでなく上の timegrid-grid の
          外側（兄弟要素）に置く。role は付けない（grid の子孫ではないため presentation で
          打ち消す必要がない） */}
      <div data-koyomi="timegrid-body" ref={bodyRef}>
        {timeAxes.map((axis, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 上記ヘッダー行の gutter と同じ理由（固定順の配列）
          <TimeAxisColumn key={`${index}-${axis.timeZone}`} axis={axis} />
        ))}
        <div data-koyomi="timegrid-days">
          {days.map((day) => (
            <TimeGridDayColumn
              key={day.key}
              day={day}
              slots={slots}
              timeZone={timeZone}
              locale={locale}
              slotMinTimeMinutes={slotMinTimeMinutes}
              slotMaxTimeMinutes={slotMaxTimeMinutes}
              nowIndicatorDayKey={nowIndicator?.dayKey ?? null}
              nowIndicatorMinutes={nowIndicator?.minutes ?? null}
              renderEvent={renderEvent}
              renderEventContent={renderEventContent}
              commonMessages={commonMessages}
              drag={stableDrag}
              isDragging={timeGridDrag.isDragging}
              preview={timeGridDrag.previewFor(day)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 時間軸の列 1 本分（主軸または {@link CalendarOptions.timeAxisZones} の追加軸）。
 * `data-koyomi-timezone` でどのタイムゾーンの軸かを識別できる。
 */
function TimeAxisColumn(props: { axis: TimeAxis }): ReactElement {
  const { axis } = props;
  return (
    <div data-koyomi="time-axis" data-koyomi-timezone={axis.timeZone}>
      {axis.slots.map((slot) => (
        <div key={slot.minutes} data-koyomi="time-slot-label">
          {slot.label}
        </div>
      ))}
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
  /** 終日行の帯の表示内容のカスタマイズ関数（省略時はタイトルのみ）。 */
  renderAllDayEvent: ((segment: EventSegment, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
}): ReactElement {
  const {
    segment,
    columnCount,
    timeZone,
    locale,
    dayDrag,
    renderAllDayEvent,
    renderEventContent,
    commonMessages,
  } = props;
  const occurrence = segment.occurrence;
  const segmentProps = dayDrag.getSegmentProps(segment);
  const isEditable = occurrence.event.editable !== false;
  const style = withEventColorStyle(
    {
      insetInlineStart: `${(segment.startCol / columnCount) * 100}%`,
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
      aria-label={commonMessages.eventAriaLabel(occurrence, {
        rangeLabel: formatTimeGridRangeLabel(
          occurrence,
          timeZone,
          locale,
          commonMessages.rangeSeparator,
        ),
      })}
    >
      {resolveEventContent(
        renderAllDayEvent,
        renderEventContent,
        segment,
        occurrence,
        titleOnlyEventContentContext('allday-event', occurrence.event.title),
      )}
      {isEditable && !segment.continuesBefore && (
        <span
          {...dayDrag.getSegmentResizeHandleProps(segment, 'start')}
          data-koyomi="allday-resize"
          data-edge="start"
        />
      )}
      {isEditable && !segment.continuesAfter && (
        <span
          {...dayDrag.getSegmentResizeHandleProps(segment, 'end')}
          data-koyomi="allday-resize"
          data-edge="end"
        />
      )}
    </button>
  );
}

/** 時間グリッドの日列（1 列分）。罫線・イベント・プレビュー・現在時刻線を描画する。 */
function TimeGridDayColumnImpl(props: {
  day: TimeGridDay;
  slots: readonly TimeSlot[];
  timeZone: TimeZoneId;
  locale: string;
  /** 表示時間帯の開始（分）。既定（`slotMinTime` 未指定）は `0`。 */
  slotMinTimeMinutes: number;
  /** 表示時間帯の終了（分）。既定（`slotMaxTime` 未指定）は `1440`。 */
  slotMaxTimeMinutes: number;
  nowIndicatorDayKey: string | null;
  nowIndicatorMinutes: number | null;
  renderEvent: ((item: PositionedOccurrence, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  drag: TimeGridColumnDragHandlers;
  /** ドラッグ操作が進行中か（{@link TimeGridEventButton} の memo 判定に使う）。 */
  isDragging: boolean;
  /** この日に表示すべきドラッグプレビュー区間（親側で解決済み、交差しなければ `null`）。 */
  preview: TimeGridPreviewSegment | null;
}): ReactElement {
  const {
    day,
    slots,
    timeZone,
    locale,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    nowIndicatorDayKey,
    nowIndicatorMinutes,
    renderEvent,
    renderEventContent,
    commonMessages,
    drag,
    isDragging,
    preview,
  } = props;
  const { ref, ...dayProps } = drag.getDayProps(day);
  const showNowIndicator = nowIndicatorDayKey === day.key && nowIndicatorMinutes !== null;
  const rangeWidth = slotMaxTimeMinutes - slotMinTimeMinutes;

  return (
    <div
      {...dayProps}
      ref={toDivRef(ref)}
      data-koyomi="timegrid-day"
      data-today={day.isToday ? 'true' : undefined}
    >
      {slots.map((slot, index) => {
        // isBusinessHours なスロットのみ、次のスロット（無ければ表示時間帯の終端）までの
        // 高さを追加で持たせて背景を敷けるようにする。既定（businessHours 未指定）では
        // 従来どおり top のみの罫線用スタイルのまま（DOM 出力を完全一致させるため）
        const isBusinessHours = day.businessHourSlots[index]?.isBusinessHours ?? false;
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
      {day.items.map((item) => (
        <TimeGridEventButton
          key={item.occurrence.key}
          item={item}
          timeZone={timeZone}
          locale={locale}
          slotMinTimeMinutes={slotMinTimeMinutes}
          slotMaxTimeMinutes={slotMaxTimeMinutes}
          renderEvent={renderEvent}
          renderEventContent={renderEventContent}
          commonMessages={commonMessages}
          drag={drag}
          isDragging={isDragging}
        />
      ))}
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
      {showNowIndicator && nowIndicatorMinutes !== null && (
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

/**
 * {@link TimeGridDayColumnImpl} を `memo` でラップしたもの。
 *
 * `viewModel` は状態が変わるたびに丸ごと再構築されるため、既定の浅い比較（参照比較）
 * では `day` / `slots` が常に「変わった」ことになり意味がない。表示に影響する値だけを
 * 比較するカスタム比較関数を使うことで、ドラッグ中に無関係な列が再レンダーされない
 * ようにする（`isDragging` はドラッグ開始・終了の瞬間だけ変化するので、その際は
 * 全列が 1 回だけ再評価され、対象イベントの `data-koyomi-dragging` 表示が正しく更新される）。
 */
const TimeGridDayColumn = memo(TimeGridDayColumnImpl, (prev, next) => {
  return (
    sameTimeGridDay(prev.day, next.day) &&
    sameSlots(prev.slots, next.slots) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.slotMinTimeMinutes === next.slotMinTimeMinutes &&
    prev.slotMaxTimeMinutes === next.slotMaxTimeMinutes &&
    prev.nowIndicatorDayKey === next.nowIndicatorDayKey &&
    prev.nowIndicatorMinutes === next.nowIndicatorMinutes &&
    prev.renderEvent === next.renderEvent &&
    prev.renderEventContent === next.renderEventContent &&
    prev.commonMessages === next.commonMessages &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging &&
    samePreviewSegment(prev.preview, next.preview)
  );
});

/** 時間グリッド内の時間指定イベント 1 件分のボタン（リサイズハンドルを含む）。 */
function TimeGridEventButtonImpl(props: {
  item: PositionedOccurrence;
  timeZone: TimeZoneId;
  locale: string;
  /** 表示時間帯の開始（分）。既定（`slotMinTime` 未指定）は `0`。 */
  slotMinTimeMinutes: number;
  /** 表示時間帯の終了（分）。既定（`slotMaxTime` 未指定）は `1440`。 */
  slotMaxTimeMinutes: number;
  renderEvent: ((item: PositionedOccurrence, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  drag: TimeGridColumnDragHandlers;
  /** ドラッグ操作が進行中か（このコンポーネント自体は使わないが、memo 判定に必要）。 */
  isDragging: boolean;
}): ReactElement {
  const {
    item,
    timeZone,
    locale,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    renderEvent,
    renderEventContent,
    commonMessages,
    drag,
  } = props;
  const occurrence = item.occurrence;
  const eventProps = drag.getEventProps(item);
  const isEditable = occurrence.event.editable !== false;
  const style = withEventColorStyle(
    {
      top: `${percentOfSlotRange(item.startMinutes, slotMinTimeMinutes, slotMaxTimeMinutes)}%`,
      height: `${percentOfSlotRange(item.endMinutes - item.startMinutes, 0, slotMaxTimeMinutes - slotMinTimeMinutes)}%`,
      insetInlineStart: `${item.left * 100}%`,
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
      aria-label={commonMessages.eventAriaLabel(occurrence, {
        rangeLabel: formatTimeGridRangeLabel(
          occurrence,
          timeZone,
          locale,
          commonMessages.rangeSeparator,
        ),
      })}
    >
      <div data-koyomi="timegrid-event-content">
        {resolveEventContent(
          renderEvent,
          renderEventContent,
          item,
          occurrence,
          timegridEventContentContext(item, locale),
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
}

/**
 * {@link TimeGridEventButtonImpl} を `memo` でラップしたもの。
 * `item`（`PositionedOccurrence`）は `viewModel` 再構築のたびに新しい参照になるため、
 * 内容が等しいかどうかを {@link samePositionedOccurrence} で比較する。`isDragging` は
 * ドラッグ開始・終了の瞬間だけ変化する値で、変化時には全イベントボタンを再評価させ、
 * ドラッグ対象になった／外れたイベントの `data-koyomi-dragging` を正しく反映させる。
 */
const TimeGridEventButton = memo(TimeGridEventButtonImpl, (prev, next) => {
  return (
    samePositionedOccurrence(prev.item, next.item) &&
    prev.timeZone === next.timeZone &&
    prev.locale === next.locale &&
    prev.slotMinTimeMinutes === next.slotMinTimeMinutes &&
    prev.slotMaxTimeMinutes === next.slotMaxTimeMinutes &&
    prev.renderEvent === next.renderEvent &&
    prev.renderEventContent === next.renderEventContent &&
    prev.commonMessages === next.commonMessages &&
    prev.drag === next.drag &&
    prev.isDragging === next.isDragging
  );
});
