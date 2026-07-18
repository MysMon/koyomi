/**
 * @packageDocumentation
 * 月ビューの内部共有レンダラ。
 *
 * `MonthView`（単体の月ビュー）と複数月ビュー（`MultiMonthView`）の両方が使う
 * 週行（日セル行・イベント帯・選択帯）の描画をここに集約する。これにより DOM 仕様
 * （`docs/internal/components-dom.md` の「月ビュー」節）が 1 箇所に定義され、
 * 両コンポーネントで完全に一致する。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 * 一部のヘルパ（`withEventColorStyle` / `formatTimeLabel` / `formatDateLabel`）は
 * リソースビュー・タイムラインビューのコンポーネントとも共有する。
 */

import type {
  CSSProperties,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { memo, useRef, useState } from 'react';
import { addDaysInZone, startOfDayInZone } from '../../core/timezone';
import type {
  CalendarViewType,
  DateRange,
  EventOccurrence,
  EventSegment,
  MonthDay,
  MonthWeek,
  TimeZoneId,
} from '../../core/types';
import type { CommonMessages } from '../locales/types';
import type {
  EventContentContext,
  EventContentRenderer,
  MonthOverflowButtonProps,
  MonthOverflowLabelContext,
  SlotRenderContext,
} from '../types';
import type { DayCellProps, DayDragHandlers } from '../use-day-drag';
import {
  resolveEventContent,
  timedTextEventContentContext,
  titleOnlyEventContentContext,
} from './event-content';

/**
 * `MonthWeekRow` / `MonthEventButton` が実際に必要とするドラッグハンドラだけを
 * 抜き出した型。`previewRange` / `isDragging` はここに含めない（`MonthView` /
 * `MultiMonthView` 側で解決済みの値を個別の prop（`selectionSpan` 等）として
 * 渡すため）。
 */
export interface MonthDayDragHandlers {
  getDayCellProps: DayDragHandlers['getDayCellProps'];
  getSegmentProps: DayDragHandlers['getSegmentProps'];
  getSegmentResizeHandleProps: DayDragHandlers['getSegmentResizeHandleProps'];
}

/**
 * `useDayDrag` の戻り値は毎レンダー新しいオブジェクト（関数含む）になるため、
 * そのまま `memo` 化した子コンポーネント（`MonthWeekRow` / `MonthEventButton`）の
 * props に渡すと再レンダー抑制が効かない。ここで参照が変わらないラッパーを
 * 1 度だけ作り、呼び出し時に ref 経由で常に最新のハンドラへ委譲することで、
 * props の同一性を保ったまま最新の挙動を保証する
 * （`time-grid-view.tsx` の `useStableColumnDrag` と同じパターン。`MonthView` と
 * `MultiMonthView` の両方から使う）。
 */
export function useStableDayDrag(dayDrag: DayDragHandlers): MonthDayDragHandlers {
  const dragRef = useRef(dayDrag);
  dragRef.current = dayDrag;
  const [stable] = useState<MonthDayDragHandlers>(() => ({
    getDayCellProps: (day) => dragRef.current.getDayCellProps(day),
    getSegmentProps: (segment) => dragRef.current.getSegmentProps(segment),
    getSegmentResizeHandleProps: (segment, edge) =>
      dragRef.current.getSegmentResizeHandleProps(segment, edge),
  }));
  return stable;
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
export function formatWeekdayLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
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
export function formatTimeLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
  return getDateTimeFormat(locale, timeZone, 'time', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** 日付ラベル（`'M月d日'` 相当）を Intl で生成する。 */
export function formatDateLabel(date: Date, timeZone: TimeZoneId, locale: string): string {
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

/**
 * 日時範囲の表示上の最終日に含まれる瞬間を返す。
 * `end` は排他的なので、`end` の 1 ミリ秒前が属する日を終了日とする。
 */
function inclusiveEndInstant(range: DateRange): Date {
  return range.end.getTime() > range.start.getTime()
    ? new Date(range.end.getTime() - 1)
    : range.start;
}

/**
 * オカレンスの日時範囲ラベルを Intl（表示 TZ）で生成する。
 *
 * 終日イベントは日付範囲（`'M月d日〜M月d日'`、単日なら日付 1 つのみ）、
 * 時間指定イベントは `'M月d日 H:mm〜H:mm'`（複数日にまたがる場合は終了側にも日付を
 * 含める）の形式になる。`useCalendarAnnouncer` の既定のイベント変更・作成通知の
 * 日時整形でも共通に使う。
 *
 * @param range - 対象の日時範囲（`end` 排他）
 * @param allDay - 終日として整形するか
 * @param timeZone - 表示に使うタイムゾーン
 * @param locale - ロケール
 * @param rangeSeparator - 開始側・終了側を連結する区切り記号
 *   （{@link MessageCatalog.common.rangeSeparator}）
 * @returns 例（`ja`）: `'7月15日〜7月16日'`（終日・複数日）、`'7月15日 10:00〜11:00'`（時間指定・単日）
 * @example
 * ```ts
 * formatOccurrenceRangeLabel(
 *   { start: new Date('2026-07-15T01:00:00Z'), end: new Date('2026-07-15T02:00:00Z') },
 *   false,
 *   'Asia/Tokyo',
 *   'ja',
 *   '〜',
 * ); // => '7月15日 10:00〜11:00'
 * ```
 */
export function formatOccurrenceRangeLabel(
  range: DateRange,
  allDay: boolean,
  timeZone: TimeZoneId,
  locale: string,
  rangeSeparator: string,
): string {
  if (allDay) {
    const startLabel = formatDateLabel(range.start, timeZone, locale);
    const endLabel = formatDateLabel(inclusiveEndInstant(range), timeZone, locale);
    return startLabel === endLabel ? startLabel : `${startLabel}${rangeSeparator}${endLabel}`;
  }
  const startDateLabel = formatDateLabel(range.start, timeZone, locale);
  const endDateLabel = formatDateLabel(range.end, timeZone, locale);
  const startTime = formatTimeLabel(range.start, timeZone, locale);
  const endTime = formatTimeLabel(range.end, timeZone, locale);
  // 複数日にまたがる場合は終了側にも日付を含める（読み上げの欠落防止）
  return startDateLabel === endDateLabel
    ? `${startDateLabel} ${startTime}${rangeSeparator}${endTime}`
    : `${startDateLabel} ${startTime}${rangeSeparator}${endDateLabel} ${endTime}`;
}

/**
 * 月ビューの帯（`month-event`）のイベント内容コンテキストを組み立てる。
 * 終日・複数日にまたがるセグメント（`span > 1`）はタイトルのみ、
 * 単日の時間指定セグメントは開始時刻＋タイトルを既定内容とする。
 */
function monthSegmentContentContext(
  segment: EventSegment,
  timeZone: TimeZoneId,
  locale: string,
  view: CalendarViewType,
): EventContentContext {
  const occurrence = segment.occurrence;
  if (occurrence.allDay || segment.span > 1) {
    return titleOnlyEventContentContext('month-event', view, occurrence.event.title);
  }
  return timedTextEventContentContext(
    'month-event',
    view,
    formatTimeLabel(occurrence.start, timeZone, locale),
    occurrence.event.title,
  );
}

/**
 * `dayMaxEvents` を CSS 変数 `--koyomi-month-lanes` として返す
 * （タイムラインの `--koyomi-timeline-lanes` と同じ方式）。
 *
 * テーマ CSS は月の週行（`month-days`）の最小高さを
 * `var(--koyomi-month-lanes, 4)` で計算する。固定レーン数のままだと
 * `dayMaxEvents` を既定より大きくしたとき帯が行から溢れるため、
 * 実際の設定値をコンポーネントが供給する。
 *
 * @param dayMaxEvents - 月セルに表示する最大レーン数（{@link CalendarOptions.dayMaxEvents}）
 * @returns ルート要素に付与する style オブジェクト
 */
export function withMonthLanesStyle(dayMaxEvents: number): CSSProperties {
  // 'as' 使用理由: CSS カスタムプロパティ（--koyomi-month-lanes）は CSSProperties の
  // 型定義に含まれないため（withEventColorStyle と同じ許容箇所）
  return { '--koyomi-month-lanes': String(Math.max(1, dayMaxEvents)) } as CSSProperties;
}

/**
 * 時間グリッド系ビュー（週/日ビュー・リソースビュー・その仮想化版）が共有する、
 * 表示範囲（`slotMinTimeMinutes`〜`slotMaxTimeMinutes`）に対する分の割合（%）計算。
 *
 * 2 つの用途で使う:
 * - **絶対位置（top）**: `value` に分の絶対値（例: `item.startMinutes`）、
 *   `rangeStartMinutes`/`rangeEndMinutes` に表示範囲の境界を渡す
 * - **区間の長さ（height）**: `value` に長さ（例:
 *   `item.endMinutes - item.startMinutes`）、`rangeStartMinutes` に `0`、
 *   `rangeEndMinutes` に表示範囲の幅（`slotMaxTimeMinutes - slotMinTimeMinutes`）を渡す
 *
 * 表示範囲が既定（`0`〜`1440`）のときは、どちらの用途でも従来の
 * `(minutes / 1440) * 100` 相当の式と数値的に完全一致する（`rangeStartMinutes` が
 * `0` のため減算が値を変えず、加減乗除の順序が従来の式と変わらないため）。
 *
 * @param value - 絶対位置の分、または区間の長さ（分）
 * @param rangeStartMinutes - 表示範囲の開始（分）。区間の長さを渡す場合は `0`
 * @param rangeEndMinutes - 表示範囲の終了（分）。区間の長さを渡す場合は範囲の幅
 * @returns 0〜100 の割合（%）
 * @example
 * ```ts
 * percentOfSlotRange(item.startMinutes, 480, 1200); // top 用
 * percentOfSlotRange(item.endMinutes - item.startMinutes, 0, 1200 - 480); // height 用
 * ```
 */
export function percentOfSlotRange(
  value: number,
  rangeStartMinutes: number,
  rangeEndMinutes: number,
): number {
  return ((value - rangeStartMinutes) / (rangeEndMinutes - rangeStartMinutes)) * 100;
}

/**
 * 表示時間帯の時間数（`(slotMaxTimeMinutes - slotMinTimeMinutes) / 60`）を
 * CSS 変数 `--koyomi-timegrid-hours` として返す（{@link withMonthLanesStyle} と同じ方式）。
 *
 * テーマ CSS は時間グリッドの日列・リソース列の高さを
 * `calc(var(--koyomi-timegrid-hours, 24) * var(--koyomi-hour-height))` で計算する。
 * 表示時間帯（`slotMinTime`/`slotMaxTime`）を制限すると全体の高さも変わるため、
 * 実際の時間数をコンポーネントが inline で供給する。
 *
 * @param slotMinTimeMinutes - {@link TimeGridViewModel.slotMinTimeMinutes} /
 *   {@link ResourceViewModel.slotMinTimeMinutes}
 * @param slotMaxTimeMinutes - {@link TimeGridViewModel.slotMaxTimeMinutes} /
 *   {@link ResourceViewModel.slotMaxTimeMinutes}
 * @returns ルート要素に付与する style オブジェクト
 */
export function withTimegridHoursStyle(
  slotMinTimeMinutes: number,
  slotMaxTimeMinutes: number,
): CSSProperties {
  // 'as' 使用理由: withMonthLanesStyle と同じ（CSS カスタムプロパティは CSSProperties
  // の型定義に含まれないため）。
  return {
    '--koyomi-timegrid-hours': String((slotMaxTimeMinutes - slotMinTimeMinutes) / 60),
  } as CSSProperties;
}

/**
 * イベント色を CSS 変数 `--koyomi-event-color` として style に加える。
 *
 * `CSSProperties` の型定義にはカスタムプロパティが含まれないため、ここでのみ
 * `as` によるキャストを行う（CLAUDE.md に記載された唯一の許容箇所）。
 */
export function withEventColorStyle(
  style: CSSProperties,
  color: string | undefined,
): CSSProperties {
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
 * Enter / Space をクリック相当として扱う。
 * jsdom を含む DOM 実装は `<button>` へのキーボード操作を自動で click に
 * 変換しないため、明示的に `click()` を呼んで `onClick` へ橋渡しする
 * （`list-view.tsx` の `handleEventKeyDown` と同じ対策）。
 *
 * また、親の日セル（`getDayCellProps` の `onKeyDown`）まで keydown が伝播すると、
 * 日セル側も Enter/Space を「その日を選択して確定」として処理してしまい、
 * `onOverflowClick` に加えて `onSelectRange` の発火（または既定タイトルでの終日
 * イベント作成）という意図しない副作用が起きる。pointerdown 側は
 * `stopPropagation`（本ファイルの `stopPropagation` 関数）で対策済みだが、
 * keydown 側にも同様に伝播を止める必要がある。
 */
function handleOverflowKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.click();
}

// 条件付きスプレッドで付与する data / ARIA 属性。明示的な型注釈でリテラル型を確定させ、
// `as const` を使わずに `aria-current` の union（'date'）へ適合させる。
const TODAY_CELL_ATTRS: { 'data-today': 'true'; 'aria-current': 'date' } = {
  'data-today': 'true',
  'aria-current': 'date',
};
const OUTSIDE_CELL_ATTRS: { 'data-outside': 'true' } = { 'data-outside': 'true' };
const ALL_DAY_EVENT_ATTRS: { 'data-all-day': 'true' } = { 'data-all-day': 'true' };

/** 週内での選択（ドラッグプレビュー）帯の可視列範囲。 */
export interface WeekSelectionSpan {
  /** 開始列（可視列インデックス、0 起点）。 */
  startCol: number;
  /** 専有する列数。 */
  span: number;
}

/**
 * 週の可視列（`week.days`）のうち、`range` と交差する列範囲を求める。
 * 交差しなければ `null` を返す。
 *
 * @param days - 対象週の可視列（`hiddenWeekdays` 適用後）
 * @param range - 交差判定するドラッグプレビュー範囲
 * @param timeZone - 表示タイムゾーン
 * @param includeOutsideDays - 前後月セル（`day.inCurrentMonth === false`）も交差判定の
 * 対象にするか。既定 `true`（単体 `MonthView` は全日対象のまま）。複数月ビューでは
 * 前後月セルを非インタラクティブにするため `false` を渡し、それらの列を選択帯の
 * 交差判定から除外する。
 */
export function computeWeekSelectionSpan(
  days: readonly MonthDay[],
  range: DateRange,
  timeZone: TimeZoneId,
  includeOutsideDays: boolean = true,
): WeekSelectionSpan | null {
  let startCol: number | null = null;
  let endCol: number | null = null;
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (day === undefined) {
      continue;
    }
    if (!includeOutsideDays && !day.inCurrentMonth) {
      continue;
    }
    const dayStart = day.date;
    // 各セルは「その日 1 日」だけを表す。hiddenWeekdays で非表示日が挟まっても、
    // 隣の表示日までの区間として扱わない（そうすると非表示日の選択が隣接表示日へ
    // 誤ってはみ出す）。翌日の 0:00 を正規化して用いる（存在しない 0:00 のゾーン対策）。
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
 * 月ビューの週行（`MonthWeekRow`）の props。
 */
interface MonthWeekRowProps {
  /** 描画する週。 */
  week: MonthWeek;
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** ロケール。 */
  locale: string;
  /** 選択（ドラッグプレビュー）帯の可視列範囲。交差しなければ `null`。 */
  selectionSpan: WeekSelectionSpan | null;
  /**
   * 選択（ドラッグプレビュー）帯が宣言的制約（`eventOverlap` / `eventConstraint`）に
   * 違反しているか。`selectionSpan` が `null` の週では無視される。
   */
  selectionInvalid: boolean;
  /**
   * 日セル・帯セグメントのドラッグ操作ハンドラ。`useStableDayDrag` で参照を
   * 安定化させたものを渡すこと（そのまま `useDayDrag` の戻り値を渡すと、
   * 毎レンダー新規参照になり本コンポーネントの `memo` 化が効かなくなる）。
   */
  dayDrag: MonthDayDragHandlers;
  /** イベントセグメントの表示内容のカスタマイズ関数。 */
  renderEvent: ((segment: EventSegment, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** どのビューでの描画か（`EventContentContext.view` に渡す）。 */
  view: CalendarViewType;
  /** 「+N 件」ラベルの既定内容（中央メッセージカタログの `overflow` で整形）。 */
  overflowLabel: (count: number) => ReactNode;
  /**
   * 「+N 件」ラベルの内容のカスタマイズ関数。ボタンの内側の内容だけを差し替え、
   * ボタン要素・クリック配線は保持される。
   */
  renderOverflowLabel: ((day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode) | undefined;
  /** 日セルの内容のカスタマイズ関数。 */
  renderDayCell: ((day: MonthDay, ctx: SlotRenderContext) => ReactNode) | undefined;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  /** 日番号クリック時のハンドラ。 */
  onDayNumberClick: (date: Date) => void;
  /**
   * 「+N 件」クリック時のハンドラ。
   * @param day - 対象の日
   * @param hiddenOccurrences - その日の非表示（あふれ）のオカレンス一覧（開始時刻順）
   * @param visibleOccurrences - その日の表示中のオカレンス一覧（開始時刻順）
   */
  onOverflowClick: (
    day: MonthDay,
    hiddenOccurrences: readonly EventOccurrence[],
    visibleOccurrences: readonly EventOccurrence[],
  ) => void;
  /**
   * 「+N 件」ボタンに追加する props を返す関数（`aria-haspopup` / `aria-expanded` など）。
   * 省略時は追加の props を付与しない。
   */
  overflowButtonProps:
    | ((day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => MonthOverflowButtonProps)
    | undefined;
  /**
   * 前後月セル（`day.inCurrentMonth === false`）をインタラクティブにするか。
   *
   * - `true`: 単体 `MonthView` が渡す既定値。全セルで `dayDrag.getDayCellProps` を
   *   呼び、前後月セルも当月セルと同様にクリック・ドラッグ・キーボード操作の対象にする
   *   （従来の `MonthView` の挙動と完全に同一）。
   * - `false`: 複数月ビュー（`MultiMonthView`）用。前後月セルには
   *   `dayDrag.getDayCellProps` を呼ばず、`ref` 登録・`tabIndex`・
   *   `data-koyomi-date` を一切付与しない（日番号ボタンや `aria-label`・
   *   `data-outside` などの表示は変えない）。同じ日が隣接する月グリッドの
   *   両方に前後月セルとして現れる場合の二重登録・二重フォーカス対象化を防ぐ。
   */
  interactiveOutsideDays: boolean;
}

/** 月ビューの 1 週分（日セル行・イベント層・選択帯）。 */
export const MonthWeekRow = memo(function MonthWeekRow(props: MonthWeekRowProps): ReactElement {
  const {
    week,
    timeZone,
    locale,
    selectionSpan,
    selectionInvalid,
    dayDrag,
    renderEvent,
    renderEventContent,
    view,
    overflowLabel,
    renderOverflowLabel,
    renderDayCell,
    commonMessages,
    onDayNumberClick,
    onOverflowClick,
    overflowButtonProps,
    interactiveOutsideDays,
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

  /** 指定列（可視列インデックス）を覆う表示中セグメントのオカレンス一覧を開始時刻順で返す。 */
  function visibleOccurrencesAt(col: number): readonly EventOccurrence[] {
    return visibleSegments
      .filter((segment) => col >= segment.startCol && col < segment.startCol + segment.span)
      .map((segment) => segment.occurrence)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return (
    // rowgroup（month-weeks）と row（month-days）の間に挟まるレイアウト用ラッパー。
    // role="presentation" で所有関係を透過させる（grid の required owned elements
    // 違反を避ける。帯・選択ハイライトの絶対配置の基準でもある）
    <div
      data-koyomi="month-week"
      role="presentation"
      {...(week.weekNumber !== null ? { 'data-koyomi-week-number': String(week.weekNumber) } : {})}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 月ビューの DOM 仕様が定める div ベースの ARIA row（<table> は不採用、MonthView 側の理由と同じ） */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: row 自体はフォーカス対象にしない（フォーカスは各 gridcell が担う） */}
      <div data-koyomi="month-days" role="row">
        {week.days.map((day, dayCol) => {
          const cellIsInteractive = interactiveOutsideDays || day.inCurrentMonth;
          let cellProps: Omit<DayCellProps, 'ref'> | Record<string, never> = {};
          let cellRef: ((element: HTMLDivElement | null) => void) | undefined;
          if (cellIsInteractive) {
            const { ref, ...rest } = dayDrag.getDayCellProps(day);
            cellProps = rest;
            cellRef = toDivRef(ref);
          }
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
                  {...(overflowButtonProps?.(day, hiddenOccurrencesAt(dayCol)) ?? {})}
                  // 通常フロー配置にすると、month-days が確保する末尾の予約領域
                  // （オーバーフロー行の余白）を使わず日番号の直後に描画されてしまい、
                  // 絶対配置のイベント帯（レーン0）が DOM 順で後にあるためクリックを
                  // 奪ってしまう（既知バグの修正）。イベント帯（MonthEventButton）と
                  // 同じ方式で絶対配置し、positioned ancestor の month-week を基準に
                  // 最下部（bottom: 0）へ固定する。DOM 上の位置（gridcell の子）は
                  // 変えない
                  style={{
                    position: 'absolute',
                    insetInlineStart: `${(dayCol / columnCount) * 100}%`,
                    width: `${(1 / columnCount) * 100}%`,
                    bottom: 0,
                  }}
                  onPointerDown={stopPropagation}
                  onKeyDown={handleOverflowKeyDown}
                  onClick={() =>
                    onOverflowClick(day, hiddenOccurrencesAt(dayCol), visibleOccurrencesAt(dayCol))
                  }
                >
                  {renderOverflowLabel
                    ? renderOverflowLabel(day, {
                        defaultContent: overflowLabel(day.overflowCount),
                        hiddenOccurrences: hiddenOccurrencesAt(dayCol),
                      })
                    : overflowLabel(day.overflowCount)}
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
              ref={cellRef}
              data-koyomi="month-day"
              role="gridcell"
              aria-label={formatFullDateLabel(day.date, timeZone, locale)}
              {...(day.isToday ? TODAY_CELL_ATTRS : {})}
              {...(!day.inCurrentMonth ? OUTSIDE_CELL_ATTRS : {})}
            >
              {renderDayCell ? renderDayCell(day, { defaultContent }) : defaultContent}
              {/* イベントの帯は複数日にまたがり得るが、DOM 上は開始日の gridcell が
                  所有する（grid の子孫の focusable を row/gridcell の所有関係の外に
                  置かないため。週/日ビューの終日帯と同じ方針）。ボタンは絶対配置で、
                  positioned ancestor はセルではなく month-week（position: relative）
                  なので、列をまたぐ視覚上のスパンと座標計算は旧レイヤー方式と変わらず、
                  month-day の overflow: hidden にもクリップされない（containing block
                  の外側にある static 祖先の overflow は絶対配置に適用されない） */}
              {visibleSegments
                .filter((segment) => segment.startCol === dayCol)
                .map((segment) => (
                  <MonthEventButton
                    key={segment.occurrence.key}
                    segment={segment}
                    timeZone={timeZone}
                    locale={locale}
                    columnCount={columnCount}
                    renderEvent={renderEvent}
                    renderEventContent={renderEventContent}
                    view={view}
                    commonMessages={commonMessages}
                    dayDrag={dayDrag}
                  />
                ))}
            </div>
          );
        })}
      </div>
      {selectionSpan !== null && (
        <div
          data-koyomi="day-selection"
          aria-hidden="true"
          {...(selectionInvalid ? { 'data-koyomi-invalid': 'true' } : {})}
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
  renderEvent: ((segment: EventSegment, ctx: EventContentContext) => ReactNode) | undefined;
  /** ビュー横断のイベント内容レンダラー（`CalendarProvider` の `renderEventContent`）。 */
  renderEventContent: EventContentRenderer | undefined;
  /** どのビューでの描画か（`EventContentContext.view` に渡す）。 */
  view: CalendarViewType;
  /** 中央メッセージカタログの `common` グループ（イベント aria-label・区切り記号の組み立てに使う）。 */
  commonMessages: CommonMessages;
  dayDrag: MonthDayDragHandlers;
}): ReactElement {
  const {
    segment,
    timeZone,
    locale,
    columnCount,
    renderEvent,
    renderEventContent,
    view,
    commonMessages,
    dayDrag,
  } = props;
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
      {...(occurrence.allDay ? ALL_DAY_EVENT_ATTRS : {})}
      data-koyomi="month-event"
      style={style}
      aria-label={commonMessages.eventAriaLabel(occurrence, {
        rangeLabel: formatOccurrenceRangeLabel(
          occurrence,
          occurrence.allDay,
          timeZone,
          locale,
          commonMessages.rangeSeparator,
        ),
      })}
    >
      {resolveEventContent(
        renderEvent,
        renderEventContent,
        segment,
        occurrence,
        monthSegmentContentContext(segment, timeZone, locale, view),
      )}
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
