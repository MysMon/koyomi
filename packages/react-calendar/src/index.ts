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
// 宣言的な重なり・配置制約の判定
export {
  hasBlockingOverlap,
  isDragCandidateValid,
  isRangeWithinBusinessHours,
  type OverlapBlocker,
  occurrenceBlocksOverlap,
  resolveConstraintRules,
} from './core/constraints';
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
export {
  type CalendarEventHistory,
  type CalendarEventHistoryOptions,
  createEventHistory,
} from './core/history';
// iCalendar（ICS）入出力
export { type EventsToIcsOptions, eventsFromIcs, eventsToIcs } from './core/ics';
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
  applyEventChangeEntries,
  applyEventChangeEntriesWithApplied,
  applyPatch,
  type CreateEventResult,
  createEventIn,
  deleteEventIn,
  deleteEventInWithChanges,
  type EventChangeApplyResult,
  type EventChangeDirection,
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
// 繰り返しルールエディタ
export {
  buildRecurrenceRuleString,
  type MonthlyRecurrencePattern,
  type ParsedRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceRuleState,
  type RecurrenceUnsupportedField,
  type RecurrenceUnsupportedReason,
  type RecurrenceValidationIssue,
  type RecurrenceWeekdayOrdinal,
  validateRecurrenceRuleState,
} from './core/recurrence-editor';
// リソース割当の解決（resourceId / resourceIds）
export {
  assignedLaneIds,
  effectiveResourceIds,
  type ResourceAssignmentFields,
  resourceLanePatch,
} from './core/resource-assignment';
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
  parseSlotBoundaryTime,
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
  CalendarOptionsPatch,
  CalendarRangeChangeInfo,
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
  ResourceViewDay,
  ResourceViewModel,
  TimeAxis,
  TimeGridDay,
  TimeGridViewModel,
  TimelineDay,
  TimelineHeaderGroup,
  TimelineItem,
  TimelineRow,
  TimelineScale,
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
// リソースの階層グルーピング（タイムラインビューのみが利用する）
export {
  buildResourceTree,
  filterVisibleResourceTree,
  type ResourceTreeEntry,
  type VisibleResourceTreeEntry,
} from './core/views/resource-hierarchy';
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
  formatTimeZoneLabel,
  formatViewTitle,
  formatWeekday,
  formatYearTitle,
} from './react/components/format';
export { ListView, type ListViewProps } from './react/components/list-view';
export { MonthView, type MonthViewProps } from './react/components/month-view';
export {
  MultiMonthView,
  type MultiMonthViewProps,
} from './react/components/multi-month-view';
export {
  ResourceView,
  type ResourceViewHandle,
  type ResourceViewProps,
} from './react/components/resource-view';
export {
  TimeGridView,
  type TimeGridViewHandle,
  type TimeGridViewProps,
} from './react/components/time-grid-view';
export { TimelineView, type TimelineViewProps } from './react/components/timeline-view';
export { Toolbar, type ToolbarProps } from './react/components/toolbar';
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
// React: 中央メッセージカタログ
export { enMessages } from './react/locales/en';
export { jaMessages } from './react/locales/ja';
export { createMessageCatalog, resolveMessageCatalog } from './react/locales/resolve';
export type {
  EventChangeVerb,
  MessageCatalog,
  MessageCatalogOverrides,
} from './react/locales/types';
// React: 「+N 件」ポップオーバーの a11y props
export {
  type OverflowPopoverButtonOptions,
  overflowPopoverButtonProps,
} from './react/overflow-popover-props';
// React: スクロールユーティリティ（initialScrollTime/scrollToTime）
export { scrollContainerToTime, scrollFractionForTime } from './react/scroll-to-time';
// React: 型
export type {
  CalendarContextValue,
  CalendarInteractionCallbacks,
  EventChange,
  EventChangeProposal,
  EventContentContext,
  EventContentParts,
  EventContentRenderer,
  EventContentSlot,
  EventDelete,
  MonthOverflowButtonProps,
  MonthOverflowLabelContext,
  OverflowClickDetails,
  RangeSelection,
  SlotRenderContext,
  UseCalendarResult,
} from './react/types';
// React: フック
export { type UseCalendarOptions, useCalendar } from './react/use-calendar';
export {
  type AnnouncerTargets,
  classifyEventChangeVerb,
  type LiveRegionProps,
  type UseCalendarAnnouncerOptions,
  type UseCalendarAnnouncerResult,
  useCalendarAnnouncer,
} from './react/use-calendar-announcer';
export {
  type UseCalendarHistoryOptions,
  type UseCalendarHistoryResult,
  useCalendarHistory,
} from './react/use-calendar-history';
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
  type UseRecurrenceRuleEditorOptions,
  type UseRecurrenceRuleEditorResult,
  useRecurrenceRuleEditor,
} from './react/use-recurrence-rule-editor';
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
