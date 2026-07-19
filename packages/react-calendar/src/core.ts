/**
 * @packageDocumentation
 * `@koyomi-cal/react/core` — React に依存しない単体エントリ。
 *
 * カレンダーエンジン（`createCalendar`）・ビューモデルビルダー・イベント展開・
 * 繰り返しルール展開・タイムゾーンユーティリティなど、`src/core/` 配下の
 * フレームワーク非依存な公開 API のみを再エクスポートする。React / react-dom を
 * import グラフに一切含まないため、Node.js 単体（サーバーサイドのバッチ処理・
 * CLI ツール等）や他の UI フレームワークからも利用できる。
 *
 * このエントリが再エクスポートする集合は `./index.ts` が同じ `./core/*` から
 * 再エクスポートしている集合と一致する（React 層のフック・コンポーネント・
 * 型は含まない）。
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
  ResourceColumnGroupCell,
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
