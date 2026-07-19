# テーマとスタイリング

Koyomi のビルトインコンポーネントはヘッドレスです。ロジックと DOM 構造だけを提供し、見た目は `data-koyomi-*` 属性をフックにした CSS で自由に組み立てられます。本ページでは、ヘッドレス設計の考え方、同梱のデフォルトテーマの当て方、CSS 変数によるカスタマイズ、ダークモード、`data-koyomi-*` 属性の一覧、そして自前スタイルを書く際の注意点を説明します。

## ヘッドレスの考え方

ビルトインコンポーネント（`Toolbar` / `CalendarView` / `MonthView` / `TimeGridView` / `ListView` / `VirtualListView` / `YearView` / `MultiMonthView` / `ResourceView` / `VirtualResourceView` / `TimelineView` / `VirtualTimelineView`）はクラス名を一切生成しません。すべての要素は `data-koyomi="<部位名>"` という属性を持ち、状態は追加の data 属性（`data-today` / `data-outside` / `data-koyomi-dragging` など）で表されます。CSS はこの属性だけをセレクタにして書きます。

インラインの `style` は、位置決めに必須の数値（%・`calc()`）やレーン数・仮想化スペーサーの高さなど、レイアウトを成立させるために避けられない値に限定されています。色・境界線・余白などの見た目は inline style に出力されません。唯一の例外は CSS 変数 `--koyomi-event-color` で、`event.color` を指定したイベント要素に加え、`resource.color` を指定したリソースのリソース列見出し（`ResourceView`）・タイムライン行見出し（`TimelineView`）にも inline で設定されます（テーマ側は `var(--koyomi-event-color, 既定色)` で参照します）。

クリック・キーボード操作が可能な要素（イベント・日番号・ツールバーのボタンなど）は、すべて `<button type="button">` として描画されます。

## デフォルトテーマの適用

そのまま使えるデフォルトテーマが同梱されています。エントリポイントで一度 CSS を読み込むだけで、`data-koyomi="root"` を持つ要素（`CalendarView` が描画するルート要素）配下に見た目が適用されます。

```ts
import '@koyomi-cal/react/theme.css';
```

デフォルトテーマは `[data-koyomi="root"]` と `[data-koyomi="toolbar"]`（`Toolbar` はルートの外にスタンドアロンで置けるため独立したスコープを持つ）の配下すべてに `box-sizing: border-box` を適用し、ボタン・見出しのブラウザ既定スタイル（余白・枠線・フォントサイズなど）をリセットしたうえで、各部位の見た目を組み立てます。フォーカス時のアウトライン（`:focus-visible`）やドラッグ中の半透明表示（`[data-koyomi-dragging="true"]`）もここに含まれます。

このリセットのセレクタは `button[data-koyomi]` / `h2[data-koyomi]` / `h3[data-koyomi]` のように、要素型に加えて `data-koyomi` 属性の有無で絞り込まれています。ライブラリが描画する `<button>` / `<h2>` / `<h3>` は必ず `data-koyomi` 属性を持つため、`renderDayCell` / `renderColumnHeader` などのカスタム描画スロットで利用者が差し込む独自の `<button>` や見出し要素（`data-koyomi` 属性を持たない）にはこのリセットが一切波及しません。

## CSS 変数一覧

デフォルトテーマは `[data-koyomi="root"]` と `[data-koyomi="toolbar"]` のスコープで以下の CSS 変数を定義しています。同じセレクタで上書きすれば、コンポーネントの構造やクラスに触れずに配色・寸法をカスタマイズできます。

| 変数 | 概要 | 既定値（ライト） |
| --- | --- | --- |
| `--koyomi-bg` | 背景色 | `#ffffff` |
| `--koyomi-fg` | 文字色 | `#1b2028` |
| `--koyomi-border` | 罫線色 | `#e6e8ef` |
| `--koyomi-muted` | 補助テキスト色（曜日ラベル・時刻ラベルなど） | `#606974` |
| `--koyomi-accent` | アクセント色（選択中のビュー・今日の日付など） | `#14608f` |
| `--koyomi-today-bg` | 「今日」のセル背景色 | `#e8f1f8` |
| `--koyomi-event-color` | イベントの既定色。`event.color` を持つイベントは要素に inline で同名の変数が設定され、そちらが優先される | `#14608f` |
| `--koyomi-event-fg` | アクセント塗りつぶし面（「今日」の日付マーカーなど）の文字色 | `#ffffff` |
| `--koyomi-event-tint` | イベントチップの背景色に混ぜるイベント色の割合。チップは「淡色背景＋濃色文字」で描画され、淡色背景は `color-mix(in srgb, イベント色 var(--koyomi-event-tint), var(--koyomi-bg))` で合成される | `14%` |
| `--koyomi-event-ink` | イベントチップの文字色に混ぜるイベント色の割合（残りは `--koyomi-fg` 側） | `65%` |
| `--koyomi-shadow` | 持ち上がり要素（選択中のビューセグメント・ホバー中のチップなど）の影 | 弱い 2 層のドロップシャドウ |
| `--koyomi-radius` | 角丸の半径（ボタン・イベント共通） | `6px` |
| `--koyomi-font-size` | 基準フォントサイズ | `13px` |
| `--koyomi-month-header-height` | 月セルの日番号行の高さ（イベント帯の上端オフセットにも使用） | `24px` |
| `--koyomi-lane-height` | 帯セグメント 1 レーンの高さ | `24px` |
| `--koyomi-hour-height` | 時間グリッド 1 時間分の高さ | `48px` |
| `--koyomi-time-axis-width` | 時間グリッドの時刻軸幅（ヘッダー・終日行・本体で揃えるための内部変数） | `56px` |
| `--koyomi-virtual-list-max-height` | `VirtualListView`（仮想化リスト）のスクロールコンテナの `max-height`。既定は `none`（無制限）で、実際の境界高は利用者が指定する | `none` |
| `--koyomi-resource-column-width` | リソースビューの列の最小幅（列数が多いと横スクロール） | `160px` |
| `--koyomi-timeline-day-width` | タイムラインビューの 1 日分のトラック幅（`timelineScale: 'hour'`、および属性なしのとき） | `720px` |
| `--koyomi-timeline-slot-width` | タイムラインビューの 1 日分のトラック幅（`timelineScale` が `'hour'` 以外、すなわち `'day'`/`'week'`/`'month'` のとき） | `96px` |
| `--koyomi-timeline-lane-height` | タイムラインビューの帯 1 レーンの高さ | `28px` |
| `--koyomi-timeline-header-width` | タイムラインビューの行見出し列（左端固定列）の幅 | `120px` |
| `--koyomi-timeline-indent-width` | タイムラインビューの階層インデント幅（`CalendarResource.parentId` 使用時、深さ 1 段あたりの余白） | `16px` |
| `--koyomi-now-color` | 現在時刻線（`now-indicator`）の色。週/日・リソース・タイムラインビュー共通 | `#ef4444` |
| `--koyomi-invalid-color` | 宣言的制約（`eventOverlap` / `eventConstraint`）に違反しているプレビュー（`[data-koyomi-invalid="true"]`）の色 | `#dc2626` |
| `--koyomi-timeline-lanes` | タイムライン行の高さ計算に使うレーン数。`--koyomi-event-color` と同様、`TimelineView` が行ごとに inline で自動設定する内部変数で、通常は利用者が直接上書きするものではない | `1`（フォールバック値） |
| `--koyomi-month-lanes` | 月ビューの週行（`month-days`）の最小高さ計算に使うレーン数。`MonthView` / `MultiMonthView` が `dayMaxEvents` の実際の値をルート要素に inline で自動設定する内部変数で、通常は利用者が直接上書きするものではない | `4`（フォールバック値） |
| `--koyomi-timegrid-hours` | 週/日・リソースビューの本体の高さ計算に使う時間帯の時間数。`slotMinTime`/`slotMaxTime` を指定した場合の実際の値を `TimeGridView` / `ResourceView` / `VirtualResourceView` がルート要素に inline で自動設定する内部変数で、通常は利用者が直接上書きするものではない | `24`（フォールバック値） |
| `--koyomi-timeline-row-depth` | タイムライン行のツリー内の深さ。`CalendarResource.parentId` 使用時の実際の値を `TimelineView` / `VirtualTimelineView` が行ごとに inline で自動設定する内部変数で、通常は利用者が直接上書きするものではない | `0`（フォールバック値） |
| `--koyomi-timeline-days` | タイムラインのトラック幅（`timeline-axis` / `timeline-row` の `min-width`）計算に使う表示日数。`timelineDays` の実際の値を `TimelineView` / `VirtualTimelineView` がルート要素に inline で自動設定する内部変数で、通常は利用者が直接上書きするものではない | `1`（フォールバック値） |

`event.color` / `resource.color` は任意の CSS 色を受け付けます。チップの背景・文字色はイベント色から `color-mix` で自動合成される（淡色背景＋濃色文字）ため、彩度のある中間〜濃色を指定すればライト/ダークの両方で十分なコントラストが得られます。ごく薄い色（パステル・ほぼ白）を指定すると文字色も薄く合成されるため、コントラスト比が WCAG AA（通常文字は 4.5:1 以上）を満たすかを確認してください。合成の割合は `--koyomi-event-tint` / `--koyomi-event-ink` で調整できます。

`--koyomi-month-header-height` / `--koyomi-lane-height` / `--koyomi-hour-height` はコンポーネント側の inline style（`calc()`）からも参照されるため、単なる見た目の変数ではなく実際のレイアウト寸法を決めます。値を変える場合は、対応する CSS（`min-height` など）も一緒に見直すことをおすすめします。

`VirtualListView` を使う場合は、`--koyomi-virtual-list-max-height` を設定するか `[data-koyomi="list"][data-koyomi-virtualized]` に直接 `height` / `max-height` を当てて、スクロールの境界高を必ず与えてください（境界高が無いと仮想化は無効化されます）。詳細は [ビュー: リストの仮想化](./views.md#リストの仮想化大量の予定長期間) を参照。

カスタマイズの例（配色の変更）:

```css
[data-koyomi="root"] {
  --koyomi-accent: #7c4dff;
  --koyomi-today-bg: #ede7f6;
  --koyomi-event-color: #7c4dff;
  --koyomi-radius: 8px;
  --koyomi-hour-height: 64px;
}
```

## ダークモード

デフォルトテーマは既定で `prefers-color-scheme: dark` に追従し、OS/ブラウザの設定に応じて自動的にダーク配色（`--koyomi-bg: #1c1f26` など）に切り替わります。

明示的に切り替えたい場合は、`data-koyomi-theme="dark"` または `data-koyomi-theme="light"` を koyomi のルート要素、またはその祖先要素（例えば `<html>`）に付与します。これは `prefers-color-scheme` の設定に関わらず優先されます。

```html
<!-- ルート要素自身に付与する場合 -->
<div data-koyomi="root" data-koyomi-theme="dark">…</div>

<!-- 祖先要素（例: <html>）に付与する場合 -->
<html data-koyomi-theme="dark">
  <body>
    <div data-koyomi="root">…</div>
  </body>
</html>
```

```ts
// 例: ユーザーの選択に応じて <html> に data-koyomi-theme を付け外しする
document.documentElement.dataset.koyomiTheme = isDark ? 'dark' : 'light';
```

## motion の削減（prefers-reduced-motion）

デフォルトテーマは `prefers-color-scheme` と同様に `prefers-reduced-motion: reduce` にも自動で追従します。OS/ブラウザで「視差効果を減らす」等の設定を有効にしているユーザーには、ボタンの配色変化やタイムラインの折りたたみトグルの回転といった `transition` がすべて無効化されます（瞬時に切り替わります）。この対応はデフォルトテーマの CSS のみで完結しており、追加の設定は不要です。

## data-koyomi 属性の一覧

ビルトインコンポーネントが出力する主な要素と `data-koyomi="<部位名>"` の対応です。カスタム CSS を書く際のセレクタ一覧として使えます。

### 共通・ツールバー

| 要素 | `data-koyomi` |
| --- | --- |
| ルート（`CalendarView`） | `root`（`data-koyomi-view="month\|week\|day\|list\|year\|multiMonth\|resource\|timeline"` も付く） |
| ツールバー本体 | `toolbar` |
| ツールバーのナビゲーション（今日/前へ/次へ） | `toolbar-nav` |
| ツールバー内ボタン | `button`（`data-koyomi-action="today\|prev\|next\|view-month\|view-week\|view-day\|view-list"`） |
| 期間タイトル | `title` |
| ビュー切替グループ | `toolbar-views` |
| ライブリージョン（`useCalendarAnnouncer` の `liveRegionProps`） | `live-region`（`role="status"\|"alert"`、`aria-live="polite"\|"assertive"`。視覚的には sr-only 相当で非表示） |

### 月ビュー

| 要素 | `data-koyomi` |
| --- | --- |
| 月ビュー本体 | `month` |
| 曜日ヘッダー行 / 各ラベル | `month-weekdays` / `month-weekday` |
| 週の行 | `month-week`（ISO 週番号の表示時のみ `data-koyomi-week-number`） |
| 日セルの行 / 各日セル | `month-days` / `month-day`（`data-koyomi-date="YYYY-MM-DD"`） |
| 日番号ボタン | `month-day-number` |
| 「+N 件」ボタン | `month-overflow` |
| イベントの帯（開始日の `month-day` の子） | `month-event` |
| 帯の左右端リサイズハンドル | `month-event-resize`（`data-edge="start\|end"`） |
| ドラッグ選択・プレビューの帯 | `day-selection`（宣言的制約違反時は `data-koyomi-invalid="true"` も付く） |

### 週/日ビュー（時間グリッド）

| 要素 | `data-koyomi` |
| --- | --- |
| 時間グリッド本体 | `timegrid`（`data-koyomi-days="7\|1"`） |
| ヘッダー行（日ヘッダー群の親、grid row） | `timegrid-header`（ISO 週番号の表示時のみ `data-koyomi-week-number`） |
| 時間軸の余白列（ヘッダー/終日行に同居） / 時間軸本体 | `timegrid-axis-gutter` / `time-axis`（複数タイムゾーン軸。`timeAxisZones` 指定時は軸の数だけ並び、各軸に `data-koyomi-timezone="<TZ>"` が付く） |
| 時間軸のタイムゾーンラベル（ヘッダーの余白列内、`GMT+9` など） | `time-axis-label`（`formatTimeZoneLabel` による GMT オフセット表記。夏時間を反映した表示範囲時点の値） |
| 終日イベント行 / セル / イベント | `allday-row` / `allday-cell` / `allday-event` |
| 終日イベントの左右端リサイズハンドル | `allday-resize`（`data-edge="start\|end"`） |
| 日ヘッダー / 日番号ボタン | `timegrid-day-header`（`data-koyomi-date`）/ `timegrid-day-number` |
| 時刻軸ラベル | `time-slot-label` |
| 日列 | `timegrid-day`（`data-koyomi-date`） |
| 罫線 | `timegrid-slot`（営業時間内スロットは `data-koyomi-business-hours="true"` も付く） |
| 時間指定イベント / 内容 | `timegrid-event` / `timegrid-event-content` |
| 上下端リサイズハンドル | `timegrid-resize`（`data-edge="start\|end"`。`start` が上端 = 開始時刻） |
| ドラッグ・作成のプレビュー | `timegrid-preview`（`data-kind="create\|move\|resize"`、宣言的制約違反時は `data-koyomi-invalid="true"` も付く） |
| 現在時刻線 | `now-indicator` |

### リストビュー

| 要素 | `data-koyomi` |
| --- | --- |
| リスト本体 | `list` |
| 日ごとのセクション / 見出し | `list-day`（`data-koyomi-date`）/ `list-day-header` |
| イベント行 / 時刻 / 色見本 / タイトル | `list-event` / `list-event-time` / `list-event-swatch` / `list-event-title` |
| 予定なしの表示 | `list-empty` |

### 年ビュー

| 要素 | `data-koyomi` |
| --- | --- |
| 年ビュー本体 | `year` |
| 月セクション | `year-month`（`data-koyomi-month="YYYY-MM"`） |
| 月見出し | `year-month-title` |
| ミニ月グリッド | `year-month-grid` |
| 曜日ヘッダー行 / 各ラベル | `year-weekdays` / `year-weekday` |
| 週の行グループ / 各週の行 | `year-weeks` / `year-week` |
| 日セル（gridcell） | `year-day-cell` |
| 日番号ボタン | `year-day`（`data-koyomi-date="YYYY-MM-DD"`） |
| 予定ありマーカー（件数ではなく密度のみ） | `year-day-count` |

### 複数月ビュー

| 要素 | `data-koyomi` |
| --- | --- |
| 複数月ビュー本体 | `multimonth` |
| 月セクション | `multimonth-month`（`data-koyomi-month="YYYY-MM"`） |
| 月見出し（`<h3>`） | `multimonth-title` |
| 各月のグリッド以下（曜日ヘッダー・週・日セル・イベント帯・「+N 件」・ドラッグ選択） | 月ビューと共通の部位名を使う（`month` / `month-weekdays` / `month-weekday` / `month-weeks` / `month-week` / `month-days` / `month-day` / `month-day-number` / `month-overflow` / `month-event` / `month-event-resize` / `day-selection`） |

前後月の日付セル（`data-outside`）は非インタラクティブ（`tabindex` なし）なため、複数月ビューでは日番号ボタン自体が描画されません。

### リソースビュー

| 要素 | `data-koyomi` |
| --- | --- |
| リソースビュー本体 | `resource`（`data-koyomi-columns="N"`） |
| 空状態（列が 1 つもない）の表示 | `resource-empty` |
| 列見出し行（role="row"） / 各見出しセル | `resource-header` / `resource-header-cell`（`role="columnheader"`。リソースに対応する列のみ `data-koyomi-resource-id`） |
| 終日イベント行 / セル | `allday-row` / `resource-allday-cell`（`data-koyomi-resource`、終日ドラッグプレビューの対象列は `data-koyomi-preview-target="true"`、宣言的制約違反時は `data-koyomi-invalid="true"` も付く） |
| 終日アイテム | `allday-event` |
| 本体 / 時刻軸ラベル | `resource-body` / `time-slot-label` |
| リソース列群 / 各列 | `resource-columns` / `resource-column`（`data-koyomi-resource`） |
| 罫線 | `timegrid-slot`（営業時間内スロットは `data-koyomi-business-hours="true"` も付く） |
| 時間指定イベント / 内容 | `timegrid-event` / `timegrid-event-content` |
| 上下端リサイズハンドル | `timegrid-resize`（`data-edge="start\|end"`） |
| ドラッグ・作成のプレビュー | `timegrid-preview`（`data-kind="create\|move\|resize"`、宣言的制約違反時は `data-koyomi-invalid="true"` も付く） |
| 現在時刻線 | `now-indicator` |

`resource-header`（`role="row"`）と各 `resource-header-cell`（`role="columnheader"`）の間には、`resource-headers` という `role="presentation"` の透過的なラッパー要素が挟まります（ARIA の row の必須所有関係を壊さないためのレイアウト用ラッパーで、それ自体は見出しセルではありません）。終日行も同様に `allday-row`（`role="row"`）と各 `resource-allday-cell`（`role="gridcell"`）の間に `resource-allday-cells` という同じ役割の透過ラッパーを挟みます（本体の `resource-columns` は `resource-body` 配下にあり `role="row"` を持たないため、この row/gridcell 間の透過ラッパーには該当しません）。

`data-koyomi-resource` はドラッグ操作の列識別子（`ResourceColumn.key`。`` `r:${id}` `` または `'unassigned'`）で、`timegrid-day` の `data-koyomi-date` に相当します。実際のリソース ID を指す `data-koyomi-resource-id` とは別の属性です。イベントブロック・リサイズハンドル・現在時刻線・プレビューは週/日ビューと同じ部位名を使い、デフォルトテーマのスタイルを共有します。

### タイムラインビュー

| 要素 | `data-koyomi` |
| --- | --- |
| タイムラインビュー本体 | `timeline`（`data-koyomi-days="N"`、`data-koyomi-scale="hour\|day\|week\|month"`） |
| 空状態（行が 1 つもない）の表示 | `timeline-empty` |
| 本体（横スクロールコンテナ） | `timeline-body` |
| ヘッダー行 / 左上の隅 / 軸 | `timeline-header-row` / `timeline-corner` / `timeline-axis` |
| 日ヘッダー行 / 各日ヘッダー（`timelineScale` が `'hour'`/`'day'` のとき） | `timeline-day-headers` / `timeline-day-header`（`data-today`） |
| 週/月グループ見出し行 / 各見出し（`timelineScale` が `'week'`/`'month'` のときのみ） | `timeline-group-headers` / `timeline-group-header`（`data-today`） |
| 時刻目盛りラベル群 / 各ラベル | `timeline-slots` / `timeline-slot-label`（`timelineScale: 'day'` では空） |
| 行グループ（見出し＋帯トラック） | `timeline-row-group` |
| 行見出し | `timeline-resource-header`（リソースに対応する行のみ `data-koyomi-resource-id`。`data-koyomi-depth="N"` で `CalendarResource.parentId` によるツリー内の深さを示す） |
| 折りたたみトグルボタン（`TimelineRow.hasChildren` が `true` の行のみ） | `timeline-row-toggle`（`aria-expanded`） |
| 帯トラック | `timeline-row`（`data-koyomi-resource`） |
| 営業時間内区間の下敷き帯 | `timeline-business-hours` |
| 帯（アイテム） / 内容 | `timeline-item`（`data-koyomi-lane="N"`、終日イベントは `data-all-day`） / `timeline-item-content` |
| 左右端リサイズハンドル（終日の帯には付かない） | `timeline-resize`（`data-edge="start\|end"`） |
| ドラッグ・作成のプレビュー | `timeline-preview`（`data-kind="create\|move\|resize"`、宣言的制約違反時は `data-koyomi-invalid="true"` も付く） |
| 現在時刻線 | `now-indicator` |

### リソース/タイムラインビューの仮想化（VirtualResourceView / VirtualTimelineView）

`VirtualResourceView` / `VirtualTimelineView` は、それぞれ `ResourceView` / `TimelineView` と同じ部位名・DOM 構造・ARIA を使う別コンポーネントです（`data-koyomi="resource"` / `data-koyomi="timeline"` 以下の既存の部位名はすべて共通）。仮想化に伴い追加されるのは次の部位・属性のみです。

| 要素 | `data-koyomi` |
| --- | --- |
| 仮想化ルートである印 | ルート（`resource` / `timeline`）に付く `data-koyomi-virtualized="true"`（`data-koyomi-columns` / `data-koyomi-days` は非仮想化版と同じ） |
| リソース: 列見出し行 / 終日行 / 本体列群の前後スペーサ | `resource-header-spacer` / `resource-allday-spacer` / `resource-columns-spacer`（各 `data-edge="before\|after"`） |
| タイムライン: 行リストの前後スペーサ | `timeline-row-spacer`（`data-edge="before\|after"`） |
| 窓外へスクロールしてもフォーカス保持のため描画され続ける列/行 | 該当要素に `data-koyomi-pinned="true"` が付く（`resource-header-cell` / `resource-allday-cell` / `resource-column` / `timeline-row-group`） |

pinned な列/行は通常フローから外れて `position: absolute` で元の位置に固定表示されます（詳細は次節「自前スタイルをゼロから当てる場合の注意」を参照）。それ以外の見た目（イベントブロック・リサイズハンドル・現在時刻線・プレビュー等）は非仮想化版と完全に同じ部位名・スタイルを共有します。

### 状態を表す data 属性

構造上の `data-koyomi` に加えて、以下の状態属性が値なし（または `'true'`）で付与されます。

| 属性 | 意味 | 付与される要素 |
| --- | --- | --- |
| `data-today` | 今日である | `month-day` / `timegrid-day-header` / `timegrid-day` / `list-day` / `year-day` / `resource-column` / `timeline-day-header` |
| `data-outside` | 表示中の月に属さない日（前後月の日付） | `month-day` / `year-day` |
| `data-has-events` | 予定が 1 件以上ある日（年ビューの密度マーカー表示のトリガー） | `year-day` |
| `data-koyomi-dragging` | ドラッグ移動・リサイズ中のイベント | `month-event` / `allday-event` / `timegrid-event` / `timeline-item` |
| `data-continues-before` | イベントの実際の開始がこの週・この日より前にある（「←続く」） | `month-event` / `allday-event` / `timegrid-event` / `timeline-item` |
| `data-continues-after` | イベントの実際の終了がこの週・この日より後にある（「続く→」） | `month-event` / `allday-event` / `timegrid-event` / `timeline-item` |
| `data-all-day` | 終日イベントのセグメント | `month-event` / `timeline-item` |
| `data-koyomi-preview-target` | 終日ドラッグプレビューの対象列（リソースビュー） | `resource-allday-cell` |
| `data-koyomi-invalid` | ドラッグ中のプレビューが宣言的制約（`eventOverlap`/`eventConstraint`）に違反している | `day-selection` / `timegrid-preview` / `timeline-preview` / `resource-allday-cell` |
| `aria-pressed` | 選択中のビュー・トグル状態 | ツールバーのビュー切替ボタン |

各コンポーネントが実際に描画する DOM 構造をそのまま検証したい場合は、次のように `render` してから属性を確認できます。

```tsx
import { render } from '@testing-library/react';
import { CalendarProvider, CalendarView, useCalendar } from '@koyomi-cal/react';

function Demo() {
  const calendar = useCalendar({
    initialView: 'month',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00', color: '#e67c73' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}

const { container } = render(<Demo />);

const root = container.querySelector('[data-koyomi="root"]');
console.log(root?.getAttribute('data-koyomi-view')); // => 'month'

const eventEl = container.querySelector('[data-koyomi="month-event"]') as HTMLElement | null;
console.log(eventEl?.style.getPropertyValue('--koyomi-event-color')); // => '#e67c73'
```

## 自前スタイルをゼロから当てる場合の注意

デフォルトテーマを使わず、`data-koyomi-*` 属性だけを頼りに独自の CSS を組み立てる場合、次の点に注意してください。

- **`position: absolute` 自体はテーマ側の責務です**: 位置決めに必須の数値（`top` / `left` / `insetInlineStart` / `width` / `height` など、すべて %）だけが inline style で出力され、`position: absolute` そのものはデフォルトテーマの CSS が当てています（ヘッドレスの原則: 数値のみ inline、`position` の値自体は見た目の一部としてテーマ側が担当）。自前 CSS では次の要素すべてに `position: absolute` を明示的に当ててください（`src/theme/default.css` と実装を突き合わせた一覧です）。
  - `month-event` / `day-selection` / `allday-event`（月・終日行の帯とドラッグ選択）
  - `timegrid-slot` / `timegrid-event` / `timegrid-resize` / `timegrid-preview` / `now-indicator`（週/日・リソース共通の時間グリッド部位）
  - `month-event-resize` / `allday-resize` / `timeline-resize`（帯セグメントの左右端リサイズハンドル。月/終日行/タイムラインで共有）
  - `year-day-count`（年ビューの密度マーカー）
  - `timeline-slot-label` / `timeline-business-hours` / `timeline-item` / `timeline-preview`（タイムライン固有の部位）
  - 例外（inline で `position` を持つ要素）: 月ビューの「+N 件」ボタン（`month-overflow`。`insetInlineStart` / `width` / `bottom` とあわせて `position: absolute` 自体もコンポーネントが inline で出力します）と、仮想化 3 ビュー（`VirtualListView` / `VirtualResourceView` / `VirtualTimelineView`）の pinned 要素（窓外でフォーカス保持中の日セクション/列/行。`data-koyomi-pinned="true"` が付く要素。テーマ CSS を読み込まない環境でも通常フローへ割り込まないよう、コンポーネント自身が inline で `position: absolute` を出力します）
- **`position: relative` が必要な要素**: イベントは絶対配置（`position: absolute`）の inline style（`left` / `width` / `top` など、すべて %）で位置決めされます。これらは最も近い `position: relative`（または他の配置コンテキスト）の祖先を基準に解決されるため、次の要素には必ず `position: relative` を当ててください。
  - `[data-koyomi="month-week"]`（月ビューのイベント帯 `month-event` の基準）
  - `[data-koyomi="allday-cells"]`（終日イベント行の帯 `allday-event` の基準）
  - `[data-koyomi="timegrid-day"]`（時間グリッド本体のイベント・目盛り・プレビュー・現在時刻線の基準）
  - `[data-koyomi="resource-allday-cells"]`（リソースビューの終日イベント行の帯 `allday-event` の基準。`allday-cells` と同じ役割）
  - `[data-koyomi="resource-column"]`（リソースビュー本体のイベント・目盛り・プレビュー・現在時刻線の基準。`timegrid-day` と同じ役割）
  - `[data-koyomi="timeline-row"]`（タイムラインビューの帯 `timeline-item`・営業時間帯 `timeline-business-hours`・プレビュー・現在時刻線（縦線）の基準）
- **逆に、日セルを positioned にしないでください**: 月ビューの帯（`month-event`）・終日行の帯（`allday-event`）は、複数日にまたがっても DOM 上は**開始日のセル（`month-day` / `allday-cell`）の子**として描画されます（アクセシビリティ上の所有関係の要請）。帯の % 座標は上記の週行/セル列コンテナ（`month-week` / `allday-cells`）を基準に計算されているため、セル自体に `position: relative` 等を当てると帯の基準がセルに変わり、複数日の帯が 1 セル幅に潰れて壊れます。バッジ等をセル内で絶対配置したい場合は、セルではなく `renderDayCell` で差し込む自前のラッパー要素に `position: relative` を当ててください。
- **`renderDayCell` の `ctx.defaultContent` を positioned な自前ラッパーの内側に入れないでください**: 月ビューの「+N 件」ボタン（`month-overflow`）も `month-event` と同じ方式で絶対配置され（positioned ancestor は `month-day` ではなく `month-week`）、`insetInlineStart` / `width` はその週の可視列数を基準にした % で計算されています。`ctx.defaultContent`（`month-day-number` と `month-overflow` を含む）を `position: relative` な自前のラッパー要素で丸ごと囲むと、`month-overflow` の絶対配置がその自前ラッパー基準に変わってしまい、% がセル 1 個分の幅に対する割合として解決されるため配置が崩れます。バッジ等の装飾で positioned なラッパーが必要な場合は、`ctx.defaultContent` とは別の兄弟要素として差し込んでください（`ctx.defaultContent` 自体はラップせずそのまま返す）。
- **inline の % は祖先の実寸に依存する**: 上記の基準要素には、% が正しく解決されるよう明示的な高さ（または `min-height`）が必要です。例えば `[data-koyomi="timegrid-day"]` の `top` / `height` は 1 日（1440 分）に対する割合なので、その要素の高さが 0 のままだとイベントは潰れて表示されます（デフォルトテーマでは `height: calc(24 * var(--koyomi-hour-height))` を設定しています）。同様に月ビューの `[data-koyomi="month-days"]` にも `dayMaxEvents` のレーン数を見込んだ `min-height` が必要です。
- **終日行コンテナの `min-height`**: 終日イベントの帯（`allday-event`）はレーン（縦位置）ごとに積み重なりますが、実際のレーン数はビューモデル側でしか把握できません。そのためコンテナ（`[data-koyomi="allday-cells"]` / `[data-koyomi="resource-allday-cells"]`）には既定で 2 レーン分の `min-height`（フォールバック）が必要です。週/日ビューはさらに実際のレーン数（`allDayLaneCount`）に応じた `min-height` をコンテナ自身に inline で上書きしますが、リソースビューは列ごとの `resource-allday-cell` 側にレーン数に応じた `min-height` を inline で持たせる方式のため、コンテナの `min-height` は常にこのフォールバック値のままです。
- **リソースビューのスクロールと固定表示**: リソース列は数十〜数百列に増えうるため、縦横のスクロールはルート `[data-koyomi="resource"]` だけが担います（`overflow: auto`。行ごとに個別のスクロールコンテナを作ると、横スクロール位置や縦スクロールバー分の列幅がずれます）。列見出し行＋終日行（`resource-grid`）は縦スクロール中も上端に固定されるよう `position: sticky; top: 0;`＋背景色が、時間軸の余白列（`timegrid-axis-gutter`）と時間軸本体（`time-axis`）は横スクロール中も左端に固定されるよう `position: sticky; inset-inline-start: 0;` が必要です（タイムラインビューの行見出し列と同じ手法）。
- **仮想化 3 ビューは境界寸法が必須**: `VirtualListView` はスクロールコンテナ（`[data-koyomi="list"][data-koyomi-virtualized]`）に `height` / `max-height`、`VirtualTimelineView` は `[data-koyomi="timeline-body"]` に `max-height`、`VirtualResourceView` はルート `[data-koyomi="resource"]`（横スクロールを担う要素）に境界幅が、それぞれ CSS で与えられている必要があります。境界寸法が無いと可視ウィンドウを計算できず、仮想化は無害に全件描画へフォールバックします（開発ビルドでは一度警告します）。
- **クラス名は生成されない**: セレクタは常に `[data-koyomi="..."]` 属性セレクタを使います。子孫の見た目（罫線・余白・フォントなど）はすべて自分で用意する必要があります（デフォルトテーマの `src/theme/default.css` を出発点にすると早く済みます）。
- **イベント色**: `event.color` を持つイベントには inline で `--koyomi-event-color` が設定されるだけなので、それを使うかどうか（`background-color: var(--koyomi-event-color, 既定色)` のように参照するか）は自前 CSS 側で決める必要があります。
- **タッチデバイスの `touch-action`**: ドラッグ起点となる要素（`month-day` / `month-event` / `allday-cell` / `allday-event` / `timegrid-day` / `timegrid-event` / `resource-allday-cell` / `resource-column` / `timeline-row` / `timeline-item` / 各リサイズハンドル）には `touch-action: none` が必要です。これがないとタッチ操作のドラッグがブラウザのスクロールに奪われます（デフォルトテーマでは設定済み）。
- **キーボードフォーカス**: 予定要素と日セルは `tabindex` によりフォーカス可能です。`:focus-visible` のアウトライン等、フォーカスリングのスタイルを必ず用意してください（デフォルトテーマでは設定済み）。
- **RTL（右書き言語）**: イベントの水平位置はデフォルトコンポーネントが `insetInlineStart`（論理プロパティ）で出力するため、`dir="rtl"` の文書では自動で反転します。自前 CSS でも `border-inline-start` などの論理プロパティを使うと RTL 対応が保たれます（デフォルトテーマは論理プロパティで記述されています）。
- **`data-edge` は 2 つの語彙で使われます**: `data-edge="start|end"` はリサイズハンドル（`month-event-resize` / `allday-resize` / `timegrid-resize` / `timeline-resize`）の左右・上下端を表すのに対し、`data-edge="before|after"` は仮想化のスペーサ（`list-spacer` / `resource-header-spacer` / `resource-allday-spacer` / `resource-columns-spacer` / `timeline-row-spacer`）が窓の前後どちら側かを表します。同じ属性名ですが意味の異なる別々の語彙なので、`[data-edge="start"]` のようなセレクタが両方の文脈に意図せずマッチしないよう注意してください。

## renderEvent によるイベント内容のカスタマイズ

`MonthView` / `TimeGridView` / `ListView` は、それぞれ `renderEvent` prop でイベントの**内容**（ボタン内部の中身）だけをカスタマイズできます。ボタン要素自体（`data-koyomi-*` 属性、クリック・ドラッグの挙動）は変わりません。

- `MonthView`: `renderEvent?: (segment: EventSegment, ctx: EventContentContext) => ReactNode`
- `TimeGridView`: `renderEvent?: (item: PositionedOccurrence, ctx: EventContentContext) => ReactNode`（終日行のイベント内容は `renderAllDayEvent` を使う）
- `ListView`: `renderEvent?: (occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode`

第 2 引数の `ctx` には、省略時の内容（`ctx.defaultContent`）・描画枠の種別（`ctx.slot`）・ビュー種別（`ctx.view`）・分解済みパーツ（`ctx.parts`。整形済みの時刻テキストやタイトル）が渡されるため、「既定に足す」「時刻とタイトルを並べ替える」が既定の整形を再構築せずに書けます。全ビュー共通で一括定義したい場合は `CalendarProvider` の `renderEventContent` prop が使えます。詳細・レシピは [カスタマイズガイド](./customization.md) を参照してください。

イベント以外にも、日セルへのコンテンツの差し込み（`renderDayCell`）、日ヘッダー・日付見出し（`renderDayHeader`）を差し替えられます。一覧は [ビュー: ビューコンポーネントのカスタマイズ props](./views.md#ビューコンポーネントのカスタマイズ-props) を参照してください。

「+N 件」等の UI 文字列や、スクリーンリーダー等が読み上げる `aria-label` は、コンポーネントごとの props ではなく `CalendarProvider` の中央メッセージカタログで一括管理されています。イベントの aria-label は `messages.common.eventAriaLabel`、年ビューの日セルの件数文言・aria-label は `messages.year.dayCount` / `messages.year.dayAriaLabel`、リストビューの日セクションの aria-label は `messages.list.dayAriaLabel` から組み立てられます（`ListView` / `VirtualListView` の既定 aria-label は同じ形式なので、仮想化の有無で読み上げは変わりません）。カスタマイズ方法は次節を参照してください。

`CalendarView` を使う場合は、`renderMonthEvent` / `renderTimeGridEvent` / `renderListEvent` prop がそれぞれのビューへ転送されます。aria-label・件数文言等は props の転送ではなく、`CalendarProvider` の `messages` prop（中央メッセージカタログ）から全ビュー共通に解決されます。

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';

function MonthDemo() {
  const calendar = useCalendar({
    initialView: 'month',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* 既定の内容（開始時刻＋タイトル）の前に絵文字を付ける */}
      <MonthView renderEvent={(_segment, ctx) => <>★ {ctx.defaultContent}</>} />
    </CalendarProvider>
  );
}
```

```tsx
import { CalendarProvider, ListView, useCalendar } from '@koyomi-cal/react';

function ListDemo() {
  const calendar = useCalendar({
    initialView: 'list',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* 既定の時刻・色見本の部位を保ったまま、タイトルだけ太字にする */}
      <ListView
        renderEvent={(occurrence, ctx) => (
          <>
            {ctx.parts.time}
            {ctx.parts.swatch}
            <strong data-koyomi="list-event-title">{occurrence.event.title}</strong>
          </>
        )}
      />
    </CalendarProvider>
  );
}
```

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';

function DayDemo() {
  const calendar = useCalendar({
    initialView: 'day',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* 開始分（0:00 からの経過分）を添える */}
      <TimeGridView
        renderEvent={(item) => `${item.occurrence.event.title}（${item.startMinutes}分〜）`}
      />
      {/* ctx を使う場合: 既定の時刻範囲テキストを再利用してタイトルの後ろへ回す */}
      {/* <TimeGridView renderEvent={(item, ctx) => `${ctx.parts.titleText} ${ctx.parts.timeText}`} /> */}
    </CalendarProvider>
  );
}
```

`CalendarView` でビューを出し分けている場合は、3 つの render prop をまとめて渡せます。

```tsx
import { CalendarProvider, CalendarView, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({
    initialView: 'month',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView
        renderMonthEvent={(segment) => `月: ${segment.occurrence.event.title}`}
        renderTimeGridEvent={(item) => `週日: ${item.occurrence.event.title}`}
        renderListEvent={(occurrence) => `一覧: ${occurrence.event.title}`}
      />
    </CalendarProvider>
  );
}
```

## 多言語対応（メッセージカタログ）

ビルトインコンポーネント・フックが表示するすべての文言（ボタンの表示文字列、「+N 件」、空状態のメッセージ、イベント・日セクションの `aria-label`、繰り返しルールの説明文・検証エラー文言、読み上げ通知の文面）は、コンポーネントごとの `*Label` props ではなく、`CalendarProvider` の `messages` prop と `CalendarOptions.locale` から解決される単一の中央メッセージカタログ（`MessageCatalog`）にまとまっています。

### ロケールに連動する既定文言

`CalendarOptions.locale`（既定 `'ja'`）の言語サブタグ（`-` より前の部分。大文字小文字は区別しない）に応じて、同梱の `jaMessages` / `enMessages` のいずれかが自動的に選ばれます。同梱していない言語は `jaMessages` にフォールバックします。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ locale: 'en-US' });
  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - Toolbar の「今日」ボタンが "Today"、月/週/日/リストの切替ボタンが
//   "Month"/"Week"/"Day"/"List" になる（「前へ」「次へ」の表示アイコン ‹/› 自体は
//   変わらず、aria-label のみ "Previous"/"Next" になる）
// - リストビューの終日ラベルが "All day"、空状態が "No events" になる
// - 月/複数月ビューの「+N 件」が "+N more" になる
// - リソース/タイムラインビューの未割り当てラベルが "Unassigned"、空状態が
//   "No resources"、タイムラインの角セルの aria-label が "Resources" になる
// - イベントの aria-label の区切り記号（読点「、」・波ダッシュ「〜」）が
//   カンマ・en dash になる
// - 年ビューの日セルの件数文言「予定N件」が "N events"（1 件なら "1 event"）になる
// - locale が同梱していない言語（例: 'fr'）の場合は 'ja' のカタログにフォールバックする
```

### messages prop での部分上書き

`CalendarProvider` の `messages` prop（`MessageCatalogOverrides` 型）は、`MessageCatalog` の各グループ（`common` / `toolbar` / `list` / `month` / `multiMonth` / `resource` / `timeline` / `year` / `announcer` / `recurrenceEditor`）単位で既定カタログに浅くマージされます。グループ自体を省略すればそのグループ全体が既定のまま、グループの一部のリーフだけを指定すればそのリーフだけが差し替わります。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { MessageCatalogOverrides } from '@koyomi-cal/react';

// コンポーネント外の定数、または useMemo の結果として渡す（毎レンダー新しい
// オブジェクトを渡すと CalendarProvider のコンテキスト値の参照が安定せず、
// 配下コンポーネントが不要に再レンダーされる）
const messages: MessageCatalogOverrides = {
  toolbar: { today: '本日' },
  month: { overflow: (count) => `他${count}件` },
};

function App() {
  const calendar = useCalendar();
  return (
    <CalendarProvider value={calendar} messages={messages}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「今日」ボタンの表示が「本日」になる
// - 月ビューの「+N 件」が「他N件」になる
// - 指定していない他の文言（週/日ボタン、リストの空状態など）は既定のまま
```

### 自前のロケールを作る

日本語・英語以外の言語に対応する場合は、`MessageCatalog` 型を満たす完全なカタログを自前で用意し、`messages` にそのまま渡します（`MessageCatalogOverrides` は各グループを `Partial` 化した型なので、全キーを埋めたオブジェクトもそのまま代入できます）。

```ts
import type { MessageCatalog } from '@koyomi-cal/react';

// MessageCatalog の全グループ（common / toolbar / list / month / multiMonth /
// resource / timeline / year / announcer / recurrenceEditor）・全リーフを埋める
const frMessages: MessageCatalog = {
  common: {
    untitledEvent: 'Sans titre',
    rangeSeparator: '–',
    eventAriaLabel: (occurrence, { rangeLabel, resourceLabel }) =>
      resourceLabel === undefined
        ? `${occurrence.event.title}, ${rangeLabel}`
        : `${occurrence.event.title}, ${rangeLabel}, ${resourceLabel}`,
  },
  toolbar: {
    month: 'Mois',
    week: 'Semaine',
    day: 'Jour',
    list: 'Liste',
    year: 'Année',
    multiMonth: 'Multi-mois',
    resource: 'Ressource',
    timeline: 'Chronologie',
    today: "Aujourd'hui",
    prev: 'Précédent',
    next: 'Suivant',
    viewsGroup: 'Changer de vue',
  },
  // ...
};
```

`locale` オプション自体は同梱カタログを選ぶ言語サブタグとしてのみ使われるため、任意の文字列（例: `'fr'`）を指定して構いません（同梱にない言語は既定では `jaMessages` にフォールバックしますが、`messages` に完全なカタログを渡せばそちらが優先されます）。各グループのリーフの型（`CommonMessages` / `ToolbarMessages` / `ListMessages` / `MonthMessages` / `MultiMonthMessages` / `ResourceMessages` / `TimelineMessages` / `YearMessages` / `AnnouncerMessages` / `RecurrenceEditorMessages`）は `MessageCatalog` の対応するグループとして参照できます。全リーフの一覧は [API リファレンス: 中央メッセージカタログ](./api.md#中央メッセージカタログreactlocales) を参照してください。

### Provider に依存しないフックの locale / messages

`useCalendarAnnouncer` は自身が保持する `calendar`（`useCalendar` の戻り値）の `state.options.locale` から自動的にカタログを解決するため、`useCalendar` の `locale` を切り替えれば通知文言も追従します。一方 `useRecurrenceRuleEditor` は `calendar` を受け取らないため、`locale`（既定 `'ja'`）はオプションとして明示的に渡す必要があります。

```tsx
useRecurrenceRuleEditor({ start, timeZone, locale: 'en-US' });
// => description が "Weekly on Mon, Wed" のような英語文言になる
```

どちらのフックも `CalendarProvider` の `messages` prop とは独立して自身の `messages` オプションでカタログを部分上書きします。`CalendarProvider` に渡した上書きをこれらのフックにも反映したい場合は、同じ `MessageCatalogOverrides` を両方に渡してください。

### 時刻ラベルの 12h/24h 表記

時間グリッドの時刻軸目盛り（`formatSlotLabel`）は `Intl.DateTimeFormat` で整形され、`locale` の慣習に従って 12 時間制（AM/PM）・24 時間制が自動的に切り替わります。

```ts
import { formatSlotLabel } from '@koyomi-cal/react';

formatSlotLabel(540, 'ja'); // => '09:00'
formatSlotLabel(540, 'en-US'); // => '09:00 AM'
```

## 関連ページ

- [カスタマイズガイド（render prop・renderEventContent・自作ビュー）](./customization.md)
- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [はじめに](./getting-started.md)
- [API リファレンス](./api.md)
