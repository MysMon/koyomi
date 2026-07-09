# 変更履歴

このプロジェクトは [セマンティックバージョニング](https://semver.org/lang/ja/) に従います。
0.x の間は API が破壊的に変わる可能性があります。

## @koyomi-cal/react 0.2.0（未リリース）

全面監査（8 観点の並列レビューと逆説的検証）に基づく修正・拡張。

### 修正

- **[重要]** 週/日ビューのキーボード削除（Delete/Backspace）が `editable: false` を無視して予定を削除する問題を修正
- **[重要]** オーバーライド発生の日時解釈を展開時と同じ「イベント TZ → マスター TZ → 表示 TZ」のフォールバック順に統一。マスターに明示 TZ がありオーバーライドが TZ を持たない外部同期パターンで、分割点・EXDATE が数時間ずれる問題を修正
- **[重要]** rrule（CJS-only）を dist にバンドルし、バンドラなしの Node ESM から import すると読み込み時に失敗する問題を修正
- **[重要]** `useCalendar` に `getServerSnapshot` を追加し、SSR（`renderToString` / Next.js）で例外になる問題を修正
- Escape キャンセル直後のネイティブ click による `onEventClick` 誤発火を抑制
- `resolveRecurringScope` が reject した場合にドラッグプレビューが残留する問題を修正（try/finally + `onError` 通知）
- `pointercancel` 未処理によりタッチ中断後にドラッグが復帰しない問題を修正
- リストビューで長さ 0 の発生（リマインダー等）が表示されない問題を修正
- 値が変わらない設定操作（同じ timeZone・同一イベント配列参照・空パッチ等）で不要な再通知が発生する問題を修正

### 機能

- **リストの仮想化**: 可視範囲の日セクションだけを描画する `VirtualListView`（opt-in）と、ビュー非依存の縦方向ウィンドウイングのプリミティブ `useVirtualizer` を追加。大量の予定・長期間表示での DOM 肥大を抑える。高さは利用者 CSS が所有し（`[data-koyomi-virtualized]`）、`role="list"`/`listitem` と件数入り `aria-label` を付与。既定の `ListView`（全件描画）は不変
- **リサイズ拡張**: 時間グリッドの上端リサイズ（開始時刻）、月ビュー・終日行の帯の左右端リサイズ（開始日・終了日）
- **終日 ⇔ 時間指定のドラッグ変換**: 週/日ビューで終日行と時間グリッドをまたいでドラッグすると相互に変換
- **キーボードのみでの予定操作**: 矢印キーでの移動（±snap 分 / ±1 日 / ±7 日）、Shift+矢印でのリサイズ、日セルの Enter/Space 作成
- **RDATE 対応**: `CalendarEvent.rdates` によるパターン外発生の追加（シリーズ分割時の振り分けも対応）
- **hiddenWeekdays オプション**: 月・週ビューの列から任意の曜日を除外（週末非表示等）
- **defaultEventTitle オプション**: 既定作成のタイトルを差し替え可能に
- **現在時刻線の追従**: `CalendarApi.refresh()` と `useCalendar` の `refreshSeconds`
- **新コールバック**: `onEventDelete`（削除通知）、`onError`（エラー通知）。`onOverflowClick` に非表示発生一覧（第 2 引数）を追加
- **UI 文言の差し替え**: `Toolbar.labels`、`ListView.allDayLabel/emptyLabel`、`MonthView.overflowLabel` 等（i18n 対応）
- **スロット**: `MonthView.renderDayCell`、`TimeGridView.renderDayHeader`、`ListView.renderDayHeader`（`CalendarView` からも転送可能）
- **ドラッグ中のオートスクロール**（時間グリッド）、ドラッグ起点への `touch-action: none`（デフォルトテーマ）
- **アクセシビリティ**: 月ビューに WAI-ARIA grid ロール、日セルに完全な日付の `aria-label` と `aria-current="date"`、フォーカスリング
- **RTL 対応**: コンポーネントの位置決めを論理プロパティ（`insetInlineStart`）化、テーマ CSS を論理プロパティで記述
- **パフォーマンス**: `Intl.DateTimeFormat` のキャッシュ、ビュー行・列・イベントの `memo` 化

### 変更

- `updateOptions` の引数型から `initialView` / `initialDate` を除外（作成時専用。実行時に黙って無視されていた型の穴を修正）
- `useCalendar` の `events` がマウント後に変更された場合、開発ビルドで一度だけ警告を表示
- `getResizeHandleProps` の `data-koyomi-resize-handle` の値が `'true'` から `'start' | 'end'` に変更

### パッケージング・CI

- `exports` に `default` 条件、`engines`（Node >= 20.19）を追加
- CI にカバレッジ計測・publint・arethetypeswrong・pack スモークテスト（素の Node での import 検証）を追加

## @koyomi-cal/react 0.1.0（2026-07-08）

初回リリース。

### 機能

- **ビュー**: 月・週・日・リストの 4 ビューと切り替え、前後移動・「今日」ナビゲーション
- **イベント**: 単発・終日・複数日・日跨ぎイベント、色・場所・説明・任意データ（`extendedProps`）、`editable` 制御
- **繰り返し**: RFC 5545 RRULE（rrule ベース）、EXDATE、オーバーライド、「この予定のみ / これ以降のすべての予定 / すべての予定」の編集・削除スコープ
- **インタラクション**: ドラッグでの予定作成・移動・下端リサイズ（時間グリッド）、日単位ドラッグ（月・終日行）、クリック作成、Escape キャンセル、Google カレンダー準拠のキーボードショートカット（M/W/D/A/T/J/K/N/P/C）
- **タイムゾーン**: 表示タイムゾーンの切り替え、イベントごとのタイムゾーン、DST 対応（深夜 0:00 切替ゾーンを含む）
- **ヘッドレス**: `data-koyomi-*` 属性によるスタイルフック、CSS 変数でカスタマイズ可能なデフォルトテーマ（ダークモード対応）、プロップゲッター型のフック（`useTimeGridDrag` / `useDayDrag`）による完全カスタム UI
- **アクセシビリティ**: イベント要素の日本語 `aria-label`、キーボード操作（Enter/Space/Delete）、`aria-pressed` によるビュー状態

### 開発

- Vitest による 600 件超のテスト（TDD）、Biome、strict TypeScript、日本語 TSDoc・ドキュメント完備
