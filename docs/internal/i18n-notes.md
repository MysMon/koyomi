# i18n 実装ノート（内部）

中央メッセージカタログ（`react/locales/*`）移行後の既知の残課題を記録する。利用者向け文書（`docs/*.md`・TSDoc）には書かない内部事情。

## aria-label 内の時刻表記が locale に追従しない

- `formatSlotLabel`（`core/timezone.ts`）と `formatClockLabel`（`react/components/time-grid-view.tsx`、時間グリッドのイベント既定表示内容）は `Intl.DateTimeFormat(locale, { hour: ..., minute: '2-digit' })` を `hourCycle` 指定なしで使うため、`locale` の慣習（`en-US` なら 12 時間制 AM/PM）に追従する。
- 一方、aria-label の組み立てに使う時刻整形は `hourCycle: 'h23'` を固定している。
  - `react/components/time-grid-view.tsx` の `formatTimeOfDayLabel`（`DATE_TIME_FORMAT_OPTIONS.timeOfDay`）
  - `react/components/month-view-parts.tsx` の `formatTimeLabel`（月ビュー・リソースビューの aria-label 用範囲ラベル、および月ビューの単日時間指定セグメントの既定表示内容 `'H:mm タイトル'` にも使われる）
- 結果として、`locale: 'en-US'` では時間グリッドの目盛り・イベント表示内容は 12 時間制になるが、aria-label 内の時刻は常に 24 時間制のままになり、視覚表示と読み上げ内容の時刻表記が食い違う。
- 対応方針は未定。`hourCycle` を `locale` から自動判定するか、`formatTimeLabel`/`formatTimeOfDayLabel` にも `formatSlotLabel` と同じ「`hourCycle` 指定なし」を適用するかの判断が必要（後者は月ビューの既定イベント内容の見た目が変わる副作用がある）。

## タイムライン week/month スケールの日番号が数字体系に追従しない

- `core/views/timeline-view.ts` の週/月グループヘッダー配下の日番号目盛り（`TimelineSlot.label`）は `String(getWallClock(day.date, timeZone).day)` で組み立てており、`Intl.NumberFormat` を経由しない素の 10 進数字文字列になる。
- そのため `ar`（アラビア数字体系）等、ラテン数字以外の数字体系を使うロケールでも日番号は常に半角アラビア数字（0-9）のまま変わらない。
- 同じ日番号でも `hour`/`day` スケールの日ヘッダー（`formatDayHeader`、`Intl.DateTimeFormat` 経由）は数字体系に追従するため、スケール切り替えで数字体系の一貫性が崩れる。

## Provider に依存しないフックの locale 配線

- `useCalendarAnnouncer` は `options.calendar`（`useCalendar` の戻り値）の `state.options.locale` からカタログを自動解決するため、`useCalendar` の `locale` を切り替えれば通知文言も追従する。
- `useRecurrenceRuleEditor` は `calendar` を受け取らない設計のため、`locale`（既定 `'ja'`）は常にアプリが明示的に渡す必要がある。渡し忘れると、`CalendarProvider`/`useCalendar` の `locale` を英語化していても繰り返しエディタの文言だけ日本語のままになる。
- どちらのフックも `CalendarProvider` の `messages` prop とは独立にカタログを解決する（`resolveMessageCatalog` を各々が呼ぶ）。`CalendarProvider` に渡した `messages` の上書きは、これらのフックには自動反映されない。アプリ側で同じ `MessageCatalogOverrides` を両方に渡す運用が必要。
- 利用者向けの記述は [theming.md: 多言語対応（メッセージカタログ）](../theming.md#多言語対応メッセージカタログ) の「Provider に依存しないフックの locale / messages」節を参照。
