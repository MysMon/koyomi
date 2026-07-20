# Koyomi (@koyomi-cal/react)

**[日本語 README](./README.md)** ・ English (this document is a translation; the Japanese README is the source of truth)

A headless TypeScript/React calendar library.

## Why Koyomi

- **DST- and timezone-safe by construction.** Every date computation in the core goes through explicit timezone-aware utilities (`core/timezone.ts`) instead of ambient `new Date()` / local-clock arithmetic. Recurrence expansion, drag interactions, and recurring-event edit scopes all resolve correctly across DST transitions and when an event's own timezone differs from the calendar's display timezone. See [docs/timezones.md](./docs/timezones.md) (Japanese; English translation planned).
- **Google Calendar-equivalent recurring-event edit scopes.** Updating or deleting a recurring event lets the caller choose `'this'` (this occurrence only), `'thisAndFollowing'` (this and all following occurrences), or `'all'` (every occurrence) — matching the semantics users already know from Google Calendar, including RDATE-only series and drag-to-move. See [docs/recurrence.md](./docs/recurrence.md) (Japanese).
- **Every feature is free under MIT.** Drag-to-create/move/resize, recurring-event editing, resource and timeline views, virtualization for large datasets, accessibility support, and multi-timezone handling are all part of the single MIT-licensed package — none of them are gated behind a paid tier. See [docs/comparison.md](./docs/comparison.md) (Japanese) for a feature-and-licensing comparison against other React calendar/scheduler libraries.
- **Fully headless.** Koyomi ships logic and markup only; every styling hook is a `data-koyomi-*` attribute. The bundled default theme (dark mode and RTL included) is implemented purely as CSS against those attributes, so you can replace it entirely without touching the library's behavior.

## Features

- 📅 **8 views** — Month, week, day, and list, plus opt-in year, multi-month, resource, and timeline views (with weekend/day hiding via `hiddenWeekdays`). Resources support `parentId` hierarchical grouping and collapsing; the timeline view supports hour/day/week/month zoom levels via `timelineScale`
- 🖱️ **Google Calendar-equivalent interactions** — Drag to create/move/resize events (including resizing from both ends), drag conversion between all-day and timed events, recurring-event editing with `'this' / 'thisAndFollowing' / 'all'` scope, and touch support. `eventOverlap` / `eventConstraint` declaratively restrict overlap and placement
- ⌨️ **Full keyboard support** — Shortcuts plus arrow-key move/resize/delete/create for events
- ↩️ **Undo/redo** — `useCalendarHistory` provides an undo/redo history of operations (keyboard shortcuts are opt-in)
- ♿ **aria-live announcements** — `useCalendarAnnouncer` announces event changes, creation, deletion, and view switches to screen readers
- 🎨 **Headless design** — Logic and markup only; styling is entirely up to you. A default theme (dark mode and RTL included) is bundled
- 🌐 **Internationalization** — A central message catalog (`ja`/`en` bundled) follows `locale`, can be partially overridden per group via `CalendarProvider`'s `messages` prop, and supports adding your own locale. Time labels automatically follow 12/24-hour format
- 🌏 **Multi-timezone support** — Independently switch an event's own timezone and the calendar's display timezone (built on date-fns v4 + @date-fns/tz)
- 🔁 **RRULE support** — The major recurrence patterns of RFC 5545, plus RDATE/EXDATE equivalents (`rdates` / `exdates`) via rrule. `useRecurrenceRuleEditor` also supports editing recurrence as structured form state
- 📜 **Large event sets** — Virtualized list rendering that only draws the visible range (`VirtualListView`, opt-in)
- 🧪 **TDD** — Test-driven development with Vitest (2,300+ tests)

## Documentation

The canonical documentation is in Japanese: see [docs/](./docs/). An English documentation index and getting-started guide are available at [docs/en/](./docs/en/README.md) — see that page for translation coverage and status.

- [Getting Started (English)](./docs/en/getting-started.md)
- [Documentation index and key concepts (English)](./docs/en/README.md)
- [はじめに (Japanese)](./docs/getting-started.md)
- [API リファレンス / API Reference (Japanese)](./docs/api.md)
- [Examples (runnable in StackBlitz / CodeSandbox)](./examples/)

## Installation

```bash
pnpm add @koyomi-cal/react
```

## Development

```bash
pnpm install
pnpm check   # terminology + test-file pairing checks, lint, typecheck, Vitest
pnpm test:e2e # Playwright (Chromium / Firefox / WebKit / touch / axe)
pnpm bench   # performance benchmarks (see docs/performance.md for measured results)
pnpm demo    # start the demo app
```

- See [CLAUDE.md](./CLAUDE.md) for the monorepo layout and coding conventions (Japanese; this is the internal contributor guide)
- See [CHANGELOG.md](./CHANGELOG.md) for the change history (Japanese)
- See [docs/publishing.md](./docs/publishing.md) for the npm publishing process (Japanese)

Contributions, including documentation translations, are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Yutaro Fujikawa
