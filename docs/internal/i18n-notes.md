# i18n 実装ノート（内部）

中央メッセージカタログ（`react/locales/*`）移行後の既知の残課題を記録する。利用者向け文書（`docs/*.md`・TSDoc）には書かない内部事情。

## aria-label 内の時刻表記が locale に追従しない（解消済み）

- 経緯: `formatSlotLabel`（`core/timezone.ts`）と `formatClockLabel`（`react/components/format.ts`、時間グリッドのイベント既定表示内容）は `Intl.DateTimeFormat(locale, { hour: ..., minute: '2-digit' })` を `hourCycle` 指定なしで使うため、`locale` の慣習（`en-US` なら 12 時間制 AM/PM）に追従していた。一方、aria-label の組み立てに使う時刻整形（`react/components/time-grid-view.tsx` の `formatTimeOfDayLabel`（`DATE_TIME_FORMAT_OPTIONS.timeOfDay`）と `react/components/month-view-parts.tsx` の `formatTimeLabel`）は `hourCycle: 'h23'` を固定しており、`locale: 'en-US'` でも aria-label 内の時刻・月ビューの単日時間指定セグメントの既定表示内容（`'H:mm タイトル'`）は常に 24 時間制のままになっていた。
- 対応: `formatTimeOfDayLabel` / `formatTimeLabel` の両方から `hourCycle: 'h23'` の固定指定を外し、`formatSlotLabel` / `formatClockLabel` と同じく `locale` の慣習に委ねる形にした。`ja` はロケールの既定が 24 時間制のため表示は変わらず、`en-US` では aria-label・月ビューの時刻表示が 12 時間制 AM/PM になる。

## タイムライン week/month スケールの日番号が数字体系に追従しない（解消済み）

- 経緯: `core/views/timeline-view.ts` の週/月グループヘッダー配下の日番号目盛り（`TimelineSlot.label`）は `String(getWallClock(day.date, timeZone).day)` で組み立てており、`Intl.NumberFormat` を経由しない素の 10 進数字文字列になっていた。そのため `ar`（アラビア・インド数字体系）等、ラテン数字以外の数字体系を使うロケールでも日番号は常に半角アラビア数字（0-9）のまま変わらず、同じ日番号でも `hour`/`day` スケールの日ヘッダー（`formatDayHeader`、`Intl.DateTimeFormat` 経由）は数字体系に追従するため、スケール切り替えで数字体系の一貫性が崩れていた。
- 対応: 日番号（整数）を `Intl.NumberFormat(locale)` で整形する `formatTimelineDayNumberLabel`（`core/views/timeline-view.ts` 内のモジュール内関数）を追加し、`TimelineSlot.label` の組み立てをこれ経由に変更した。`Intl.DateTimeFormat` の日単体スケルトン（`day: 'numeric'`）は使っていない。ロケールによっては CLDR の標準パターンに接尾辞が付き（例: `ja` では `'30日'`）、素の日番号ラベルとして使うと既存表示（`ja` の `'30'`）が変わってしまうため。

## ビュー外フック（announcer / 繰り返しエディタ）の locale 配線

- `useCalendarAnnouncer` は `options.calendar`（`useCalendar` の戻り値）の `state.options.locale` からカタログを自動解決するため、`useCalendar` の `locale` を切り替えれば通知文言も追従する。カタログの上書きは自身の `messages` オプションのみが対象で、`CalendarProvider` の `messages` prop は反映されない（announcer は Provider 外でも使える設計のため）。
- `useRecurrenceRuleEditor` は `locale` 省略時、`CalendarProvider` 配下なら Provider の `locale` と解決済みカタログ（Provider の `messages` 上書きを含む）に追従する。Provider の外・`locale` 明示時は単独で解決する（既定 `'ja'`。Provider の `messages` 上書きは、Provider の `locale` を使わない解決には引き継がない）。
- 利用者向けの記述は [theming.md: 多言語対応（メッセージカタログ）](../theming.md#多言語対応メッセージカタログ) の「useCalendarAnnouncer / useRecurrenceRuleEditor の locale / messages」節を参照。
