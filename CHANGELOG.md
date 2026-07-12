# 変更履歴

このプロジェクトは [セマンティックバージョニング](https://semver.org/lang/ja/) に従います。
0.x の間は API が破壊的に変わる可能性があります。

## @koyomi-cal/react 0.2.0（未リリース）

全面監査（8 観点の並列レビューと逆説的検証）に基づく修正・拡張。

### 修正

- **[重要]** 終日繰り返し予定のスコープ変更を日付キーと暦日数で処理するように修正。イベント TZ と表示 TZ が異なる場合の `this` / `thisAndFollowing` の対象日ずれと、DST 開始・終了日に 24 時間固定加算でオカレンスが消失・短縮される問題を解消
- **[重要]** RRULE を持たず RDATE のみを持つ予定を変更層でも繰り返しとして扱い、`this` / `thisAndFollowing` / `all` の更新・削除・移動スコープを正しく適用。有限の RDATE 集合を分割点の前後へ振り分ける処理を追加
- 仮想化リソース／タイムラインでフォーカス中の予定を表示窓外へスクロールした際、pinned DOM は残るもののブラウザフォーカスが失われる問題を修正
- デモの予定色を白文字との組み合わせで WCAG AA を満たす濃色パレットへ変更し、ダークテーマでもカスタム予定色の文字コントラストを維持
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
- **[重要]** `useCalendar` が初期 `onRangeChange` を React のレンダー中（SSR 含む）に同期実行する問題を修正。マウント後の effect で登録し、直後に現在の表示範囲を 1 回通知するようにした（`createCalendar` 直接利用時の「作成直後に同期発火」は不変）
- **[重要]** `initialDate` / `goTo` の `Date` や `events` / `resources` / `businessHours` 等の配列を呼び出し側が後から変更すると、通知なしに内部状態・キャッシュ・表示が矛盾する問題を修正。入力・公開境界で複製し、イベント/リソースオブジェクト自体は「渡した後・受け取った後に変更しない」ことを公開仕様として明記した
- コールバックなしで作成した後に `updateOptions` で `onRangeChange` を登録すると、直後のイベント・リソース変更が範囲変更として誤通知される問題を修正
- 終日イベントの `end <= start`（終了が開始以前）が 1 日イベントに補正されて表示される問題を修正。時間指定イベントと同様、単発・RRULE・RDATE・オーバーライドの全経路でオカレンスを生成しない
- デフォルトテーマに残っていた、実装が出力しない `[data-koyomi="month-events"]` セレクタを削除（CSS セレクタと実装の `data-koyomi` 属性の突き合わせテストを追加）

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
- **複数タイムゾーン軸**: `timeAxisZones` オプションで週/日ビューにセカンダリタイムゾーンの時間軸を並べて表示（Google カレンダー相当。DST 切替日も日単位で正確）
- **「+N 件」のポップオーバー基盤**: `onOverflowClick` に表示中オカレンス一覧（第 3 引数）を追加、`overflowButtonProps` で `aria-haspopup` / `aria-expanded` 等を付与可能に（ポップオーバー UI 自体はアプリ側実装）
- **外部ドラッグ受け入れ**: `useExternalDrag` フックと `ExternalDropInfo` 型を追加。カレンダー外の DOM 要素からのドラッグを日時・リソースへ解決して `onExternalDrop` で通知（FullCalendar の Draggable 相当。イベント作成はアプリ側）
- **リソース/タイムラインの仮想化**: `VirtualResourceView` / `VirtualTimelineView` を追加（可視レーンのみ描画、フォーカス保持、`scrollToResource` / `scrollToRow`）。`useVirtualizer` を水平軸・`viewportPadding` 対応に拡張
- **ISO 週番号**: `showWeekNumbers` オプションで月・週ビューに `data-koyomi-week-number` 属性を出力（`isoWeekNumberInZone` / `isoWeekNumberOfWeek` / `parseTimeOfDay` を公開）
- **営業時間**: `businessHours` オプションで週/日・リソースビューのスロットに `data-koyomi-business-hours` 属性、タイムラインに `timeline-business-hours` 帯を出力
- **英語文言プリセット**: `enUsLabels`（Toolbar / 各ビューの `*Label` props をコンポーネント単位でまとめた en-US プリセット）
- **undo 基盤**: `onEventChange` / `onEventDelete` に影響イベントの before/after 一覧（`changes: EventChangeEntry[]`）を追加。`updateEventInWithChanges` 等の core 関数と `CalendarApi.updateEvent/deleteEvent` の戻り値でも取得可能
- **適用前フック**: `onBeforeEventChange` / `onBeforeSelectRange` / `onBeforeEventDelete`（`boolean | Promise<boolean>`、false で不適用・通知なし。FullCalendar の eventAllow/selectAllow 相当＋キーボード削除の確認用途）。`EventChangeProposal` 型を公開
- **既定挙動の差し替え**: `onDayNumberClick`（日番号クリックの day ビュー遷移を置き換え。省略時は従来どおり）
- **読み上げ文言のカスタマイズ**: 全イベントビューに `eventAriaLabel`、`YearView.dayCountLabel/dayAriaLabel`、`ListView`/`VirtualListView.dayAriaLabel`、`ToolbarLabels.viewsGroup` を追加（固定日本語文言を解消し enUsLabels で網羅）
- **通知の拡充**: `onEventDoubleClick` / `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`（未指定時はリスナー自体を付けない）、core の `onRangeChange`（表示範囲変更通知。FullCalendar の datesSet 相当）
- **React 非依存エントリ**: `@koyomi-cal/react/core`（`createCalendar`・ビューモデルビルダー・タイムゾーン/繰り返しユーティリティを React なしで利用可能）
- **ビュー利便性**: `CalendarView` に `virtualizeResource` / `virtualizeTimeline`、`TimeGridView.renderAllDayEvent`、`ResourceView`/`VirtualResourceView.renderAllDayItem`、`TimelineView.cornerLabel` を追加
- **月ビューの修正**: 「+N 件」ボタンを帯と重ならない最下部の予約領域へ配置（クリック不能バグの解消）、週行の高さが `dayMaxEvents` に追従（`--koyomi-month-lanes`）

### 変更

- **[破壊的]** 対応 React を 19 系のみに変更（`peerDependencies` を `react` / `react-dom` `^19.0.0` へ。React 18 では利用できない）
- **[破壊的]** `VirtualResourceView` / `VirtualTimelineView` の `forwardRef` を廃止し、`ref` を通常の props として受け取るように変更（`<VirtualResourceView ref={handleRef} />` という利用側の書き方は不変。型は `ForwardRefExoticComponent` から素の関数コンポーネント＋ `ref` prop になる）
- `updateOptions` の引数型を `CalendarOptionsPatch` に変更。`initialView` / `initialDate` は作成時専用のため型レベルで除外され（0.1.0 では実行時に黙って無視されていた）、`onEventsChange` / `onRangeChange` に `null` を渡すと登録済みコールバックを解除できる
- `CalendarApi.notifyRangeChange()` を追加（現在のビュー・基準日・表示範囲を差分に関わらず即時通知。React 層の初期通知にも使用）
- `useCalendar` の `events` がマウント後に変更された場合、開発ビルドで一度だけ警告を表示
- `getResizeHandleProps` の `data-koyomi-resize-handle` の値が `'true'` から `'start' | 'end'` に変更

### パッケージング・CI

- Playwright による Chromium / Firefox / WebKit の実ブラウザ E2E を追加。ポインタ・実タッチ入力、表示切替、ショートカット、RTL／多言語、仮想化スクロールとフォーカス保持、ライト／ダークの axe WCAG 2.0 A/AA 検査を CI で実行
- `exports` に `default` 条件、`engines`（Node >= 20.19）を追加
- CI にカバレッジ計測・publint・arethetypeswrong・pack スモークテスト（素の Node での import 検証）を追加
- バンドルしている `rrule` の第三者ライセンス通知（`THIRD_PARTY_NOTICES.md`）を tarball に同梱し、`rrule` を `dependencies` から外した（実行時はバンドルのみを使うため、利用者のインストールから重複コピーがなくなる）
- カバレッジに下限（全体と `src/core/` の個別下限）を設定し、CI で強制
- CI を Node 20.19.0（下限）と Node 24（最新 LTS）の 2 レグ構成に拡張。用語チェック・デモのビルド・CJS `require()` を含む pack スモークテストを追加し、publint / arethetypeswrong のバージョンを固定
- 開発時ビルドに使う esbuild を 0.28.1 以上へ固定（GHSA-g7r4-m6w7-qqqr の解消。配布物への影響はない）

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
