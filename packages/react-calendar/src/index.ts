/**
 * @packageDocumentation
 * `@koyomi-cal/react` — ヘッドレスな TypeScript/React カレンダーライブラリ。
 *
 * 公開 API のエントリポイント。コア（フレームワーク非依存）と
 * React バインディングの両方をここから re-export する。
 */

// カレンダーエンジン
export { createCalendar } from './core/calendar';
// 日付範囲ユーティリティ
export {
  eachDayInRange,
  monthGridRange,
  navigateDate,
  rangesOverlap,
  startOfWeekInZone,
  visibleRangeFor,
} from './core/date-utils';
// イベント展開
export { expandEvents, occurrenceKey, resolveOccurrence } from './core/expansion';
// インタラクションの純粋計算
export {
  type CalendarShortcut,
  dayDragPreviewRange,
  dragPreviewRange,
  shortcutForKey,
  snapToInterval,
  type TimeGridDragMode,
  type TimeGridDragState,
  timeAtGridPosition,
} from './core/interaction';
// イベント変更の純粋関数
export {
  applyPatch,
  type CreateEventResult,
  createEventIn,
  deleteEventIn,
  type MutationContext,
  moveOccurrenceIn,
  type RecurringTarget,
  updateEventIn,
} from './core/mutations';
// 繰り返しルール
export {
  countOccurrencesBefore,
  expandRecurrence,
  normalizeRRuleString,
  previousOccurrenceStart,
  truncateRRule,
} from './core/recurrence';
// タイムゾーンユーティリティ
export {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  dateKeyInZone,
  formatSlotLabel,
  fromWallClock,
  getLocalTimeZone,
  getWallClock,
  isSameDayInZone,
  isValidTimeZone,
  minutesOfDayInZone,
  parseDateValue,
  startOfDayInZone,
  type WallClockParts,
  weekdayInZone,
} from './core/timezone';
// コア型定義
export type {
  CalendarApi,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarOptions,
  CalendarState,
  CalendarViewModel,
  CalendarViewType,
  DateRange,
  DragPreview,
  EventId,
  EventOccurrence,
  EventSegment,
  ListDay,
  ListViewModel,
  MonthDay,
  MonthViewModel,
  MonthWeek,
  PositionedOccurrence,
  RecurringEditScope,
  ResolvedCalendarOptions,
  TimeGridDay,
  TimeGridViewModel,
  TimeSlot,
  TimeZoneId,
  Weekday,
} from './core/types';
// ビューモデルビルダー
export { buildListViewModel } from './core/views/list-view';
export { buildMonthViewModel } from './core/views/month-view';
export { buildTimeGridViewModel } from './core/views/time-grid-view';
// React: ビルトインコンポーネント（ヘッドレス）
export { CalendarView, type CalendarViewProps } from './react/components/calendar-view';
export {
  formatDayHeader,
  formatDayTitle,
  formatMonthTitle,
  formatRangeTitle,
  formatTime,
  formatWeekday,
} from './react/components/format';
export { ListView, type ListViewProps } from './react/components/list-view';
export { MonthView, type MonthViewProps } from './react/components/month-view';
export { TimeGridView, type TimeGridViewProps } from './react/components/time-grid-view';
export { Toolbar } from './react/components/toolbar';
// React: コンテキスト
export { CalendarProvider, type CalendarProviderProps, useCalendarContext } from './react/context';
// React: 型
export type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
  EventChange,
  RangeSelection,
  UseCalendarResult,
} from './react/types';
// React: フック
export { useCalendar } from './react/use-calendar';
export { useCalendarShortcuts } from './react/use-calendar-shortcuts';
export {
  type DayCellProps,
  type DayDragHandlers,
  type SegmentProps,
  useDayDrag,
} from './react/use-day-drag';
export {
  type TimeGridDayProps,
  type TimeGridDragHandlers,
  type TimeGridEventProps,
  type TimeGridPreviewSegment,
  type TimeGridResizeHandleProps,
  useTimeGridDrag,
} from './react/use-time-grid-drag';
