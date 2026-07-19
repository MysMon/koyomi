# Getting Started

*This is an English translation of [はじめに](../getting-started.md). The Japanese document is the source of truth; if the two disagree, follow the Japanese version. See [docs/en/README.md](./README.md) for translation coverage.*

`@koyomi-cal/react` is a headless TypeScript/React calendar library. This page walks through installation, rendering a minimal calendar, passing in event data, and click/drag interactions.

## What Koyomi is

Koyomi is a **headless** calendar library that provides logic and markup only — the look is entirely up to you (a default theme is also bundled). You can switch between 8 views (month, week, day, list, year, multi-month, resource, timeline — the last 4 are opt-in), and it supports Google Calendar-equivalent interactions out of the box, such as drag-to-create/move/resize and choosing an edit scope for recurring events. It supports multi-timezone use (switching independently between an event's own timezone and the display timezone), the major RRULE (recurrence rule) patterns from RFC 5545, and RDATE/EXDATE equivalents (`rdates` / `exdates`). Keyboard-only event operation and SSR (e.g. Next.js) are also supported.

## Installation

```bash
pnpm add @koyomi-cal/react
```

`react` and `react-dom` are peerDependencies. Version 19.x is required.

```json
{
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

## Minimal usage

Calendar state is created with the `useCalendar` hook and shared with the built-in components underneath (`Toolbar` / `CalendarView`, etc.) via `CalendarProvider`. To use the default look, load `@koyomi-cal/react/theme.css`.

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar();

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// Expected behavior:
// - The Toolbar shows "Today", "‹", "›", the period title, and month/week/day/list switch buttons
// - CalendarView renders MonthView etc. according to the current view (default: 'month')
```

`useCalendar` creates the calendar engine and returns `api` (a stable operation API), `state` (the current state), and `viewModel` (render data for the current view). Pass it straight through as `CalendarProvider`'s `value`.

## Providing events

Events are passed to `useCalendar` as an array of `CalendarEvent`. The minimum required fields are `id` / `title` / `start` (`end` is optional; when omitted, timed events default to `defaultEventMinutes` (60 minutes by default) later, and all-day events default to 1 day later). Dates can be either `Date` objects or ISO 8601 strings.

```tsx
import type { CalendarEvent } from '@koyomi-cal/react';
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

const events: CalendarEvent[] = [
  {
    id: '1',
    title: 'Team sync',
    start: '2026-07-08T10:00:00',
    end: '2026-07-08T11:00:00',
  },
];

function App() {
  const calendar = useCalendar({ events });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// Expected behavior:
// - The cell for July 8, 2026 (month view) shows "10:00 Team sync"
```

`events` is used only as the **initial value** for `useCalendar` — it is read once. To swap events afterward (e.g. to reflect data fetched from a server), use `calendar.api.setEvents(nextEvents)` instead (see [Managing events](../events.md) for details, currently Japanese only). Continuing to pass a different `events` prop after mount has no effect and triggers a one-time warning in development builds.

## Enabling click/drag creation

In the month, week, and day views, clicking or dragging an empty area lets the user select a range for a new event. Pass `onSelectRange` to `CalendarProvider`'s `callbacks` to receive the selection (`range` / `allDay`) once it's confirmed.

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar();

  function handleSelectRange(selection: RangeSelection) {
    // Open a creation dialog here, or create the event directly via the API
    calendar.api.createEvent({
      title: 'New event',
      start: selection.range.start,
      end: selection.range.end,
      allDay: selection.allDay,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// Expected behavior:
// - Dragging and releasing over a day cell (month view) or a time slot (week/day view) calls handleSelectRange
// - selection.range.start / selection.range.end is the selected date/time range (end is exclusive)
// - selection.allDay is true for a selection made in an all-day area (a month-view day cell, or the all-day row)
```

If `onSelectRange` is **omitted**, the default behavior creates an event immediately, titled with `messages.common.untitledEvent` (default `'Untitled event'`). To change the title, use `CalendarProvider`'s `messages` prop (see [Theming and styling: internationalization (message catalog)](../theming.md#多言語対応メッセージカタログ), currently Japanese only). Pass `onSelectRange` if you want to stop this default behavior — for example, to show a creation dialog instead.

## Showing details on event click

`onEventClick` is called when an event is clicked. It receives the clicked event's occurrence (`EventOccurrence`) and the original `MouseEvent`, so you can use it as the entry point for a details panel or edit dialog.

```tsx
import { useState } from 'react';
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent, EventOccurrence } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

const events: CalendarEvent[] = [
  { id: '1', title: 'Team sync', start: '2026-07-08T10:00:00', end: '2026-07-08T11:00:00' },
];

function App() {
  const calendar = useCalendar({ events });
  const [selected, setSelected] = useState<EventOccurrence | null>(null);

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{ onEventClick: (occurrence) => setSelected(occurrence) }}
    >
      <Toolbar />
      <CalendarView />
      {selected && <p>Selected: {selected.event.title}</p>}
    </CalendarProvider>
  );
}

// Expected behavior:
// - Clicking an event calls setSelected, and "Selected: Team sync" is displayed
```

If `onEventClick` is omitted, nothing happens (there is no default behavior). Implementing a dialog or details panel is entirely up to you — Koyomi does not provide that UI.

## Import paths and bundle size

All public API is imported from the single top-level entry point `@koyomi-cal/react`. The package is published as ESM with one source module per file, so any view component or hook you don't use is excluded from your app's bundle by your bundler's tree-shaking. There's no need to import per-view subpaths for bundle size (no per-view subpath entries exist).

- `@koyomi-cal/react` — all public API (core + React bindings)
- `@koyomi-cal/react/core` — the framework-independent core only (see [Using just the framework-independent core](#using-just-the-framework-independent-core))
- `@koyomi-cal/react/theme.css` — the default theme CSS

For measured examples, see [Performance: bundle size and tree-shaking](../performance.md#バンドルサイズと-tree-shaking) (currently Japanese only).

## Using with SSR / Next.js

`useCalendar` renders an initial state without throwing under SSR (`renderToString` / the Next.js App Router, etc.). Keep two things in mind:

- Because it includes components that use browser APIs (drag interactions, etc.), components that use the calendar need the **`'use client'` directive** under the Next.js App Router
- "Today" is determined from `now()` at render time, so a hydration mismatch is possible at the instant the date boundary is crossed between server and client. If you need to avoid this strictly, fix `initialDate` and `now` explicitly
- **Specify `timeZone` explicitly.** When omitted, the runtime environment's `Intl` local timezone is used, so if the server (e.g. `UTC`) and client (e.g. `Asia/Tokyo`) differ, "today", date keys, event placement, and time labels can shift across hydration. For SSR, pin it explicitly, e.g. `useCalendar({ timeZone: 'Asia/Tokyo' })`

## Using just the framework-independent core

The calendar engine, including `createCalendar` (the public API under `src/core/`), is also available from the dedicated entry point `@koyomi-cal/react/core`, which imports no React at all. Use this entry point in Node.js environments without React (server-side batch processing, CLI tools, etc.) or from other UI frameworks.

```ts
import { createCalendar } from '@koyomi-cal/react/core';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
console.log(calendar.getViewModel().type); // => 'month'
```

`react` / `react-dom` are `peerDependencies` in `package.json`, but if you only use `@koyomi-cal/react/core`, it works at runtime even without them installed (the peer-dependency warning at install time can be ignored — though under pnpm's `strict-peer-dependencies=true` setting it becomes an error, in which case you need to relax that setting or install react). For details, see [API Reference](../api.md#koyomi-calreactcorereact-非依存の単体エントリ) (currently Japanese only).

## Props that are only valid as initial values

Some props on Koyomi's hooks are used **only as the initial value at mount time**. Continuing to pass different values afterward is not reflected in re-renders (if changed after mount, development builds show a one-time warning). To change these dynamically, use the corresponding imperative API instead.

| Hook | Props valid only as initial values | How to change dynamically |
| --- | --- | --- |
| `useCalendar` | `events` / `resources` (also applies generally to other `CalendarOptions` options) | `calendar.api.setEvents(nextEvents)` / `calendar.api.setResources(nextResources)`. The view, reference date, and timezone use `calendar.api.setView` / `goTo` / `setTimeZone`; other options use `calendar.api.updateOptions(patch)` |
| `useRecurrenceRuleEditor` | `start` / `timeZone` / `rrule` | To switch the item being edited, give the component that uses this hook a unique `key` so it remounts |
| `useCalendarHistory` | `limit` (also applies to `createEventHistory`'s `options.limit`) | There is no way to change this dynamically. To change the limit, remount the component (e.g. by changing its `key`) |

Why these are initial-value-only: `useCalendar`'s `events`/`resources` are used only as the **seed** for the calendar engine's internal mutable state (the event store); after that, the state managed by the engine itself is authoritative. If React props were synced on every render, external changes via `setEvents` and changes via props could conflict, leaving it undefined which one wins — so the convention is deliberately "initial value only". `useRecurrenceRuleEditor`'s `start`/`timeZone`/`rrule` similarly fix the starting point of an editing session as internal hook state, once, for the same reason.

## What to read next

- [Views (month, week, day, list, year, multi-month, resource, timeline)](../views.md) (Japanese)
- [Managing events](../events.md) (Japanese)
- [Interactions (create, move, resize)](../interactions.md) (Japanese)
- [Recurring events](../recurrence.md) (Japanese)
- [Accessibility](../accessibility.md) (Japanese)
- [Timezones](../timezones.md) (Japanese)
- [Theming and styling](../theming.md) (Japanese)
- [Customization guide](../customization.md) (Japanese)
- [API Reference](../api.md) (Japanese) — see also the [English heading index](./README.md#api-reference-heading-index)
