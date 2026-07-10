# 変更履歴

このプロジェクトは [セマンティックバージョニング](https://semver.org/lang/ja/) に従います。
0.x の間は API が破壊的に変わる可能性があります。

## @koyomi-cal/react 0.2.0（未リリース）

全面監査（8 観点の並列レビューと逆説的検証）に基づく修正・拡張。

### 修正

- **[重要]** 週/日ビューのキーボード削除（Delete/Backspace）が `editable: false` を無視して予定を削除する問題を修正
- **[重要]** オーバーライドオカレンスの日時解釈を展開時と同じ「イベント TZ → マスター TZ → 表示 TZ」のフォールバック順に統一。マスターに明示 TZ がありオーバーライドが TZ を持たない外部同期パターンで、分割点・EXDATE が数時間ずれる問題を修正
- **[重要]** rrule（CJS-only）を dist にバンドルし、バンドラなしの Node ESM から import すると読み込み時に失敗する問題を修正
- **[重要]** `useCalendar` に `getServerSnapshot` を追加し、SSR（`renderToString` / Next.js）で例外になる問題を修正
- Escape キャンセル直後のネイティブ click による `onEventClick` 誤発火を抑制
- `resolveRecurringScope` が reject した場合にドラッグプレビューが残留する問題を修正（try/finally + `onError` 通知）
- `pointercancel` 未処理によりタッチ中断後にドラッグが復帰しない問題を修正
- リストビューで長さ 0 のオカレンス（リマインダー等）が表示されない問題を修正
- 値が変わらない設定操作（同じ timeZone・同一イベント配列参照・空パッチ等）で不要な再通知が発生する問題を修正
- **[重要]** 繰り返しの「この予定のみ」編集・削除（`updateEvent` / `deleteEvent` の `scope: 'this'`、`moveOccurrenceIn` の長さ解決）で、あるオーバーライドの移動先の時刻が別オカレンスの本来の開始時刻（`originalStart`）と偶然一致すると、無関係なオーバーライドを誤って書き換える／削除してしまう問題を修正。`originalStart` を持つオーバーライドは常に `originalStart` の一致でのみ判定し、現在の `start` へのフォールバックは行わないようにした
- **[重要]** オーバーライドイベントが `timeZone` を省略した場合、展開結果に表示タイムゾーンで誤解釈される問題を修正。展開時の `originalStart` 解釈と同じ「イベント TZ → マスター TZ → 表示 TZ」の 3 段フォールバックを、オーバーライド自身の `start`/`end` の解釈にも適用した。`resolveOccurrence` に任意の `master` パラメータを追加し、同じフォールバックを外部からも利用できるようにした
- `moveOccurrenceIn` で `newEnd` を省略しつつ `allDay` を変換（時間指定 ⇔ 終日）すると、変換前の実ミリ秒差がそのまま新しい長さに使われ意図せず複数日にまたがることがある問題を修正。終日化はちょうど 1 日、時間指定化は `defaultEventMinutes` を既定の長さとして使うようにした（ドラッグ操作は常に `newEnd` を明示するため、UI 上の挙動への影響はない）

### 機能

- **年・複数月・リソース・タイムラインビュー**（すべて opt-in）: `YearView`（12 ヶ月分のミニ月グリッド）、`MultiMonthView`（`multiMonthCount` ヶ月分の月グリッドを縦に連結）、`ResourceView`（1 日・列 = リソース）、`TimelineView`（横 = 時間・行 = リソース）を追加。`CalendarResource` 型、`resources` / `unassignedLane` / `multiMonthCount` / `timelineDays` オプション、`getResources` / `setResources` API を追加。低レベルフック `useResourceGridDrag` / `useTimelineDrag` を追加。`Toolbar` / `useCalendarShortcuts` は `views` prop・オプションで対象ビューを opt-in できる（既定は月・週・日・リストのままで、既存利用者の見た目・挙動は不変）。キーボードショートカット `Y`（年）/ `Q`（複数月）/ `R`（リソース）/ `L`（タイムライン）を追加
- **リストの仮想化**: 可視範囲の日セクションだけを描画する `VirtualListView`（opt-in）と、ビュー非依存の縦方向ウィンドウイングのプリミティブ `useVirtualizer` を追加。大量の予定・長期間表示での DOM 肥大を抑える。高さは利用者 CSS が所有し（`[data-koyomi-virtualized]`）、`role="list"`/`listitem` と件数入り `aria-label` を付与。既定の `ListView`（全件描画）は不変
- **リサイズ拡張**: 時間グリッドの上端リサイズ（開始時刻）、月ビュー・終日行の帯の左右端リサイズ（開始日・終了日）
- **終日 ⇔ 時間指定のドラッグ変換**: 週/日ビューで終日行と時間グリッドをまたいでドラッグすると相互に変換
- **キーボードのみでの予定操作**: 矢印キーでの移動（±snap 分 / ±1 日 / ±7 日）、Shift+矢印でのリサイズ、日セルの Enter/Space 作成
- **RDATE 対応**: `CalendarEvent.rdates` によるパターン外オカレンスの追加（シリーズ分割時の振り分けも対応）
- **hiddenWeekdays オプション**: 月・週ビューの列から任意の曜日を除外（週末非表示等）
- **defaultEventTitle オプション**: 既定作成のタイトルを差し替え可能に
- **現在時刻線の追従**: `CalendarApi.refresh()` と `useCalendar` の `refreshSeconds`
- **新コールバック**: `onEventDelete`（削除通知）、`onError`（エラー通知）。`onOverflowClick` に非表示オカレンス一覧（第 2 引数）を追加
- **UI 文言の差し替え**: `Toolbar.labels`、`ListView.allDayLabel/emptyLabel`、`MonthView.overflowLabel` 等（i18n 対応）
- **スロット**: `MonthView.renderDayCell`、`TimeGridView.renderDayHeader`、`ListView.renderDayHeader`（`CalendarView` からも転送可能）
- **ドラッグ中のオートスクロール**（時間グリッド）、ドラッグ起点への `touch-action: none`（デフォルトテーマ）
- **アクセシビリティ**: 月ビューに WAI-ARIA grid ロール、日セルに完全な日付の `aria-label` と `aria-current="date"`、フォーカスリング
- **RTL 対応**: コンポーネントの位置決めを論理プロパティ（`insetInlineStart`）化、テーマ CSS を論理プロパティで記述
- **パフォーマンス**: `Intl.DateTimeFormat` のキャッシュ、ビュー行・列・イベントの `memo` 化。時間グリッド（`time-grid-layout.ts`）・帯（`band-layout.ts`）のレーン/列割当アルゴリズムを、同一時間帯に多数の予定が重なる場合の計算量 O(n²) からほぼ線形に改善。週ビューの日別振り分け（`time-grid-view.ts`）も二分探索によるスイープに変更し重複走査を削減（出力結果・挙動は変更なし）
- **公開 API 追加**: `SegmentResizeHandleProps`（`useDayDrag` の帯リサイズハンドル props 型）、`timeAtTimelineOffset`（タイムラインの表示分→日時変換）、`startOfMonthInZone` / `addMonthsInZone`（月単位の日付ユーティリティ）
- **テーマ**: CSS 変数 `--koyomi-now-color`（現在時刻線の色。既定 `#ea4335`）を追加。週/日ビューの曜日ラベルに `data-koyomi="timegrid-weekday"` を追加（月・年ビューの曜日ラベルと同様のスタイルフック）。ボタン/見出しのブラウザ既定リセットのセレクタを `data-koyomi` 属性を持つ要素に限定し、`renderDayCell` 等でユーザーが差し込む独自の button/見出し要素へ波及しないようにした（見た目・詳細度は変更なし）

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
