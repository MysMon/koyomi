/**
 * @packageDocumentation
 * `@koyomi/react` — ヘッドレスな TypeScript/React カレンダーライブラリ。
 *
 * 公開 API のエントリポイント。コア（フレームワーク非依存）と
 * React バインディングの両方をここから re-export する。
 */

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
