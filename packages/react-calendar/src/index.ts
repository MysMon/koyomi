/**
 * @packageDocumentation
 * `@koyomi-cal/react` — ヘッドレスな TypeScript/React カレンダーライブラリ。
 *
 * 公開 API のエントリポイント。コア（フレームワーク非依存）と
 * React バインディングの両方をここから re-export する。
 * React を import せずコアのみを使いたい場合は `@koyomi-cal/react/core`
 * （`./core.ts`）を使う。
 */

// カレンダーエンジン
export { createCalendar } from './core/calendar';
// 日付範囲ユーティリティ
export {
  addMonthsInZone,
  eachDayInRange,
  isoWeekNumberOfWeek,
  monthGridRange,
  navigateDate,
  rangesOverlap,
  startOfMonthInZone,
  startOfWeekInZone,
  startOfYearInZone,
  visibleRangeFor,
} from './core/date-utils';
// イベント展開
export { expandEvents, occurrenceKey, resolveOccurrence } from './core/expansion';
// インタラクションの純粋計算
export {
  type CalendarShortcut,
  type DayDragMode,
  dayDragPreviewRange,
  dragPreviewRange,
  shortcutForKey,
  snapToInterval,
  type TimeGridDragMode,
  type TimeGridDragState,
  timeAtGridPosition,
  timeAtTimelineOffset,
} from './core/interaction';
// イベント変更の純粋関数
export {
  applyPatch,
  type CreateEventResult,
  createEventIn,
  deleteEventIn,
  deleteEventInWithChanges,
  type EventChangeEntry,
  type EventMutationResult,
  type MutationContext,
  moveOccurrenceIn,
  moveOccurrenceInWithChanges,
  type RecurringTarget,
  updateEventIn,
  updateEventInWithChanges,
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
  isoWeekNumberInZone,
  isSameDayInZone,
  isValidTimeZone,
  minutesOfDayInZone,
  parseDateValue,
  parseTimeOfDay,
  startOfDayInZone,
  type WallClockParts,
  weekdayInZone,
} from './core/timezone';
// コア型定義
export type {
  BusinessHourRange,
  BusinessHourSlot,
  BusinessHoursRule,
  CalendarApi,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarOptions,
  CalendarResource,
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
  MultiMonthMonth,
  MultiMonthViewModel,
  PositionedOccurrence,
  RecurringEditScope,
  ResolvedCalendarOptions,
  ResourceColumn,
  ResourceViewModel,
  TimeAxis,
  TimeGridDay,
  TimeGridViewModel,
  TimelineDay,
  TimelineItem,
  TimelineRow,
  TimelineSlot,
  TimelineViewModel,
  TimeSlot,
  TimeZoneId,
  Weekday,
  YearDay,
  YearMonth,
  YearViewModel,
} from './core/types';
// ビューモデルビルダー
export { buildListViewModel } from './core/views/list-view';
export { buildMonthViewModel } from './core/views/month-view';
export { buildMultiMonthViewModel } from './core/views/multi-month-view';
export { buildResourceViewModel } from './core/views/resource-view';
export { buildTimeGridViewModel } from './core/views/time-grid-view';
export { buildTimelineViewModel } from './core/views/timeline-view';
export { buildYearViewModel } from './core/views/year-view';
export type { VirtualItem } from './core/virtualization';
// React: ビルトインコンポーネント（ヘッドレス）
export { CalendarView, type CalendarViewProps } from './react/components/calendar-view';
export {
  formatDayHeader,
  formatDayTitle,
  formatMonthTitle,
  formatRangeTitle,
  formatTime,
  formatWeekday,
  formatYearTitle,
} from './react/components/format';
export { ListView, type ListViewProps } from './react/components/list-view';
export { MonthView, type MonthViewProps } from './react/components/month-view';
export {
  MultiMonthView,
  type MultiMonthViewProps,
} from './react/components/multi-month-view';
export { ResourceView, type ResourceViewProps } from './react/components/resource-view';
export { TimeGridView, type TimeGridViewProps } from './react/components/time-grid-view';
export { TimelineView, type TimelineViewProps } from './react/components/timeline-view';
export { Toolbar, type ToolbarLabels, type ToolbarProps } from './react/components/toolbar';
export {
  VirtualListView,
  type VirtualListViewProps,
} from './react/components/virtual-list-view';
export {
  VirtualResourceView,
  type VirtualResourceViewHandle,
  type VirtualResourceViewProps,
} from './react/components/virtual-resource-view';
export {
  VirtualTimelineView,
  type VirtualTimelineViewHandle,
  type VirtualTimelineViewProps,
} from './react/components/virtual-timeline-view';
export { YearView, type YearViewProps } from './react/components/year-view';
// React: コンテキスト
export { CalendarProvider, type CalendarProviderProps, useCalendarContext } from './react/context';
// React: ロケールプリセット
export { type EnUsLabels, enUsLabels } from './react/locales/en-us';
// React: 型
export type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
  EventChange,
  EventChangeProposal,
  EventDelete,
  MonthOverflowButtonProps,
  OverflowClickDetails,
  RangeSelection,
  UseCalendarResult,
} from './react/types';
// React: フック
export { type UseCalendarOptions, useCalendar } from './react/use-calendar';
export { useCalendarShortcuts } from './react/use-calendar-shortcuts';
export {
  type DayCellProps,
  type DayDragHandlers,
  type SegmentProps,
  type SegmentResizeHandleProps,
  useDayDrag,
} from './react/use-day-drag';
export {
  type ExternalDraggableProps,
  type ExternalDragHandlers,
  type ExternalDropInfo,
  type UseExternalDragParams,
  useExternalDrag,
} from './react/use-external-drag';
export {
  type ResourceAllDayCellProps,
  type ResourceColumnProps,
  type ResourceEventProps,
  type ResourceGridDragHandlers,
  type ResourcePreviewSegment,
  type ResourceResizeHandleProps,
  useResourceGridDrag,
} from './react/use-resource-grid-drag';
export {
  type TimeGridDayProps,
  type TimeGridDragHandlers,
  type TimeGridEventProps,
  type TimeGridPreviewSegment,
  type TimeGridResizeHandleProps,
  useTimeGridDrag,
} from './react/use-time-grid-drag';
export {
  type TimelineDragHandlers,
  type TimelineItemProps,
  type TimelinePreviewSegment,
  type TimelineResizeHandleProps,
  type TimelineRowProps,
  useTimelineDrag,
} from './react/use-timeline-drag';
// React: 仮想化（ヘッドレスなプリミティブ）
export {
  type UseVirtualizerOptions,
  useVirtualizer,
  type Virtualizer,
} from './react/use-virtualizer';
