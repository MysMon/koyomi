# Koyomi (@koyomi-cal/react)

**[日本語 README](./README.md)** ・ English (this document is a translation; the Japanese README is the source of truth)

A headless TypeScript/React calendar library.

## Why Koyomi

- **DST- and timezone-safe by construction.** Every date computation in the core goes through explicit timezone-aware utilities (`core/timezone.ts`) instead of ambient `new Date()` / local-clock arithmetic. Recurrence expansion, drag interactions, and recurring-event edit scopes all resolve correctly across DST transitions and when an event's own timezone differs from the calendar's display timezone. See [docs/timezones.md](./docs/timezones.md) (Japanese; English translation planned).
- **Google Calendar-equivalent recurring-event edit scopes.** Updating or deleting a recurring event lets the caller choose `'this'` (this occurrence only), `'thisAndFollowing'` (this and all following occurrences), or `'all'` (every occurrence) — matching the semantics users already know from Google Calendar, including RDATE-only series and drag-to-move. See [docs/recurrence.md](./docs/recurrence.md) (Japanese).
- **Every feature is free under MIT.** Drag-to-create/move/resize, recurring-event editing, resource and timeline views, virtualization for large datasets, accessibility support, and multi-timezone handling are all part of the single MIT-licensed package — none of them are gated behind a paid tier.
- **Fully headless.** Koyomi ships logic and markup only; every styling hook is a `data-koyomi-*` attribute. The bundled default theme (dark mode and RTL included) is implemented purely as CSS against those attributes, so you can replace it entirely without touching the library's behavior.

## Features

- 📅 **8 views** — Month, week, day, list, year, multi-month, resource, and timeline. Resources support hierarchical grouping; the timeline view supports zoom-level switching
- 🖱️ **Google Calendar-equivalent interactions** — Drag to create/move/resize (from both ends), conversion between all-day and timed events, recurring-event editing with "this / this and following / all" scope, copy & paste and duplicate, and touch support. Overlap and placement can be restricted declaratively
- ⌨️ **Keyboard-complete** — Everything the mouse can do to an event (create, move, resize, all-day conversion, delete) can be done with the keyboard alone, and focus survives deletion
- ♿ **Screen reader support** — Event changes, creation, deletion, rejected operations, and view switches are announced via aria-live
- ↩️ **Undo/redo** — Undo and redo of the operation history
- 🎨 **Headless design** — Logic and markup only; styling is entirely up to you via CSS against `data-koyomi-*` attributes. A default theme (dark mode and RTL included) is bundled
- 🌐 **Internationalization** — A message catalog (`ja` / `en` bundled) with partial overrides and custom locales, and automatic 12/24-hour format
- 🌏 **Multi-timezone support** — Independent per-event and display timezones, plus secondary timezone axes (built on date-fns v4 + @date-fns/tz)
- 🔁 **Recurring events** — The major RRULE patterns of RFC 5545 plus RDATE / EXDATE, with a structured-state form editor included
- 🗓️ **iCalendar (ICS) import/export** — `.ics` input/output that understands recurrence, overrides, and "this and following" series splits, plus partial import that skips malformed VEVENTs
- 📜 **Large event sets and resource lists** — Virtualized views that only render the visible range, "+N more" overflow aggregation, and incremental data fetching driven by the visible range
- 🧪 **TDD** — Test-driven development with Vitest (3,400+ tests) and real-browser E2E (including automated WCAG checks with axe)

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

Contributions, including documentation translations, are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Yutaro Fujikawa
