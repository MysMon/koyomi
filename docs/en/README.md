# Koyomi Documentation (English)

The [Japanese documentation](../) is canonical. This page is an English table of contents plus a summary of Koyomi's key concepts, so English-speaking readers can navigate the Japanese docs even before every page has a translation. Two pages currently have a full English translation:

- [Getting Started](./getting-started.md) — a full translation of [はじめに](../getting-started.md)
- This page — an English table of contents and concept summary, not a translation of a single Japanese page

Everything else below links to the Japanese original. If you can read Japanese, the linked page is always the most complete and up to date source.

## Key concepts

- **Headless.** Koyomi provides logic and markup only. Every styling hook is a `data-koyomi-*` attribute; the bundled default theme (dark mode and RTL included) is plain CSS against those attributes and can be replaced entirely.
- **Framework-independent core, subscribed from React.** State lives in a framework-independent engine created by `createCalendar` (a subscription model), importable on its own from `@koyomi-cal/react/core` with no React dependency. The React bindings (`useCalendar`, components, hooks) subscribe to that engine with `useSyncExternalStore`. `core` never imports React — the dependency is one-directional (core → react).
- **8 views.** Month, week, day, and list are always available; year, multi-month, resource, and timeline are opt-in. See [Views](../views.md).
- **DST- and timezone-safe.** Timezone-dependent computation always goes through explicit utilities (`core/timezone.ts`) rather than ambient local-clock `Date` arithmetic, so recurrence expansion and interactions resolve correctly across DST transitions and when an event's own timezone differs from the calendar's display timezone. See [Timezones](../timezones.md).
- **Google Calendar-equivalent recurring-event editing.** Updating or deleting a recurring event accepts a `scope` of `'this'`, `'thisAndFollowing'`, or `'all'`. See [Recurring events](../recurrence.md).
- **RRULE support.** The major recurrence patterns of RFC 5545 (`FREQ`/`INTERVAL`/`BYDAY`/`BYMONTHDAY`/`COUNT`/`UNTIL`, etc.), plus RDATE/EXDATE equivalents (`rdates` / `exdates`). See [Recurring events](../recurrence.md).
- **Multi-timezone.** An event's own timezone and the calendar's display timezone are independent and can each be switched at runtime. See [Timezones](../timezones.md).
- **Accessibility.** WAI-ARIA grid patterns, keyboard operation, and `aria-live` announcements of event changes via `useCalendarAnnouncer`. See [Accessibility](../accessibility.md).
- **Virtualization for large datasets.** `VirtualListView` / `VirtualResourceView` / `VirtualTimelineView` (all opt-in) render only the visible range. See [Performance](../performance.md).
- **Undo/redo.** `useCalendarHistory` provides an operation history with undo/redo (keyboard shortcuts are opt-in). See [Managing events](../events.md).
- **Every feature is MIT-licensed**, with no paid tier. Drag-to-create/move/resize, recurring-event editing, resource and timeline views, virtualization, accessibility, and multi-timezone handling are all part of the single MIT-licensed package — none gated behind a paid tier.

## Documentation index

| Page | Status |
| --- | --- |
| [Getting Started](./getting-started.md) | English translation |
| [はじめに](../getting-started.md) | Japanese (source of truth) |
| [Views (month, week, day, list, year, multi-month, resource, timeline)](../views.md) | Japanese |
| [Managing events](../events.md) | Japanese |
| [Interactions (create, move, resize)](../interactions.md) | Japanese |
| [Recurring events](../recurrence.md) | Japanese |
| [iCalendar (ICS) import/export](../ics.md) | Japanese |
| [Accessibility](../accessibility.md) | Japanese |
| [Timezones](../timezones.md) | Japanese |
| [Theming and styling](../theming.md) | Japanese |
| [Customization guide](../customization.md) | Japanese |
| [API Reference](../api.md) | Japanese (see the [heading index](#api-reference-heading-index) below) |
| [Performance](../performance.md) | Japanese |
| [Publishing](../publishing.md) | Japanese |
| [Versioning](../versioning.md) | Japanese |

## API Reference: heading index

[`docs/api.md`](../api.md) is not fully translated. This is a heading-level index in English, linking each entry through to its (Japanese-language) section — most headings are API identifiers, which read the same regardless of language.

- [Use-case guide](../api.md#ユースケース別ガイド) — look up an API by what you're trying to do, before reading the full reference
- [Import paths](../api.md#import-経路)
- **Calendar engine**
  - [`createCalendar`](../api.md#createcalendar)
  - [`CalendarApi`](../api.md#calendarapi)
  - [`createEventHistory`](../api.md#createeventhistory)
  - [`@koyomi-cal/react/core` (framework-independent entry point)](../api.md#koyomi-calreactcorereact-非依存の単体エントリ)
- **React hooks**
  - [`useCalendar`](../api.md#usecalendar)
  - [`useCalendarAnnouncer`](../api.md#usecalendarannouncer)
  - [`useCalendarHistory`](../api.md#usecalendarhistory)
  - [`useCalendarClipboard`](../api.md#usecalendarclipboard)
  - [`useCalendarDuplicate`](../api.md#usecalendarduplicate)
  - [`useRecurrenceRuleEditor`](../api.md#userecurrenceruleeditor)
  - [`useCalendarShortcuts`](../api.md#usecalendarshortcuts)
  - [`useDayDrag`](../api.md#usedaydrag)
  - [`useTimeGridDrag`](../api.md#usetimegriddrag)
  - [`useResourceGridDrag`](../api.md#useresourcegriddrag)
  - [`useTimelineDrag`](../api.md#usetimelinedrag)
  - [`useExternalDrag`](../api.md#useexternaldrag)
  - [`useVirtualizer`](../api.md#usevirtualizer)
- **Components**
  - [`CalendarProvider`](../api.md#calendarprovider)
  - [`CalendarView`](../api.md#calendarview)
  - [`MonthView`](../api.md#monthview)
  - [`TimeGridView`](../api.md#timegridview)
  - [`ListView`](../api.md#listview)
  - [`VirtualListView`](../api.md#virtuallistview)
  - [`YearView`](../api.md#yearview)
  - [`MultiMonthView`](../api.md#multimonthview)
  - [`ResourceView`](../api.md#resourceview)
  - [`TimelineView`](../api.md#timelineview)
  - [`VirtualResourceView`](../api.md#virtualresourceview)
  - [`VirtualTimelineView`](../api.md#virtualtimelineview)
  - [`Toolbar`](../api.md#toolbar)
- **Types**
  - [Events](../api.md#イベント)
  - [Options](../api.md#オプション)
  - [State and view models](../api.md#状態とビューモデル)
  - [React types (callbacks, etc.)](../api.md#react-型コールバック等)
- **Low-level utilities**
  - [Timezone (`core/timezone`)](../api.md#タイムゾーンcoretimezone)
  - [Date ranges (`core/date-utils`)](../api.md#日付範囲coredate-utils)
  - [Recurrence (`core/recurrence`)](../api.md#繰り返しcorerecurrence)
  - [Recurrence rule editor (`core/recurrence-editor`)](../api.md#繰り返しルールエディタcorerecurrence-editor)
  - [Event mutations (`core/mutations`)](../api.md#イベント変更coremutations)
  - [Resource assignment resolution (`core/resource-assignment`)](../api.md#リソース割当の解決coreresource-assignment)
  - [Event expansion (`core/expansion`)](../api.md#イベント展開coreexpansion)
  - [iCalendar import/export (`core/ics`)](../api.md#icalendar-入出力coreics)
  - [Interaction computation (`core/interaction`)](../api.md#インタラクション計算coreinteraction)
  - [Declarative constraint resolution (`core/constraints`)](../api.md#宣言的な制約の判定coreconstraints)
  - [View model builders (`core/views`)](../api.md#ビューモデルビルダーcoreviews)
  - [Resource hierarchy grouping (`core/views/resource-hierarchy`)](../api.md#リソースの階層グルーピングcoreviewsresource-hierarchy)
  - [Virtualization visible range (`core/virtualization`)](../api.md#仮想化の可視範囲corevirtualization)
  - [Date/time label formatting (`react/components/format`)](../api.md#日時ラベル整形reactcomponentsformat)
  - [Scroll utilities (`react/scroll-to-time`)](../api.md#スクロールユーティリティreactscroll-to-time)
  - [`overflowPopoverButtonProps`](../api.md#overflowpopoverbuttonprops)
- [Central message catalog (`react/locales`)](../api.md#中央メッセージカタログreactlocales)
- [Related pages](../api.md#関連ページ)

## Contributing translations

English translations are welcome. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how `docs/` (Japanese, canonical) and `docs/en/` (English translations) relate, and [scripts/check-docs-translation-pairs.mjs](../../scripts/check-docs-translation-pairs.mjs) for the (lightweight, existence-only) check that keeps translated-page pairs from silently going missing.
