# コンポーネント DOM 仕様（内部設計書）

ビルトインコンポーネントが生成する DOM 構造と `data-koyomi-*` 属性の仕様。
**テーマ CSS（`src/theme/default.css`）と利用者のカスタム CSS はこの属性のみをフックにする。**
クラス名は生成しない（ヘッドレス原則）。

## 共通原則

- すべての要素は `data-koyomi="<部位名>"` を持つ
- 状態は追加の data 属性で表す（`data-today` / `data-outside` / `data-koyomi-dragging` など、値なし属性または `'true'`）
- 位置決めに必須の数値（%・calc）のみ inline style で出力する。**色・境界線・余白などの見た目は inline style に書かない**
  - 例外: イベント色。`event.color` が指定されたイベント要素には inline で CSS 変数 `--koyomi-event-color` を設定する（テーマ側が `var(--koyomi-event-color, 既定色)` で参照）
- 操作可能要素は `<button type="button">`（イベント・日番号・ツールバー）
- テーマが参照する寸法は CSS 変数で調整可能にする（既定値は `default.css` が定義）:
  - `--koyomi-month-header-height`（月セルの日番号行の高さ、既定 24px）
  - `--koyomi-lane-height`（帯セグメント 1 レーンの高さ、既定 24px）
  - `--koyomi-hour-height`（時間グリッド 1 時間の高さ、既定 48px）

## ルート / ツールバー

```
div[data-koyomi="root"][data-koyomi-view="month|week|day|list"]
```

Toolbar（`CalendarProvider` 配下で使用）:

```
div[data-koyomi="toolbar"]
  div[data-koyomi="toolbar-nav"]
    button[data-koyomi="button"][data-koyomi-action="today"]   … 「今日」
    button[data-koyomi="button"][data-koyomi-action="prev"]    … 「前へ」(‹)
    button[data-koyomi="button"][data-koyomi-action="next"]    … 「次へ」(›)
  h2[data-koyomi="title"]                                      … 期間タイトル（例: 2026年7月）
  div[data-koyomi="toolbar-views"] (role="group")
    button[data-koyomi="button"][data-koyomi-action="view-month"][aria-pressed]
    button[data-koyomi="button"][data-koyomi-action="view-week"][aria-pressed]
    button[data-koyomi="button"][data-koyomi-action="view-day"][aria-pressed]
    button[data-koyomi="button"][data-koyomi-action="view-list"][aria-pressed]
```

タイトルの書式は `Intl.DateTimeFormat(locale, { timeZone, ... })`:
月 = 年+月、週 = 開始日〜終了日、日 = 年月日（曜日付き）、リスト = 開始日〜終了日。

## 月ビュー（MonthView）

```
div[data-koyomi="month"] (role="grid")
  div[data-koyomi="month-weekdays"] (role="row")
    div[data-koyomi="month-weekday"] (role="columnheader") × 可視列数
                                                      … 曜日ラベル（Intl、週開始順、hiddenWeekdays 除外後）
  div[data-koyomi="month-weeks"] (role="rowgroup")
    div[data-koyomi="month-week"] × 4..6            … position: relative の基準（テーマ側）
      div[data-koyomi="month-days"] (role="row")
        div[data-koyomi="month-day"][data-koyomi-date="YYYY-MM-DD"]
           (role="gridcell", tabIndex=0, aria-label=完全な日付, aria-current="date"?)
           [data-today?][data-outside?] × 可視列数    … useDayDrag.getDayCellProps を展開
                                                       （Enter/Space でその日 1 日分の範囲選択）
          … 内容は renderDayCell で差し替え可能（既定は以下）
          button[data-koyomi="month-day-number"]     … クリックでその日の day ビューへ
          button[data-koyomi="month-overflow"]?      … 「+N 件」（overflowCount > 0 のとき、
                                                        文言は overflowLabel で差し替え可）
      div[data-koyomi="month-events"] (aria-hidden への配慮は role="presentation")
        button[data-koyomi="month-event"] × n        … useDayDrag.getSegmentProps を展開
           [data-all-day?][data-continues-before?][data-continues-after?][data-koyomi-dragging?]
           style: insetInlineStart/width は %（可視列数基準）、top は
                  calc(var(--koyomi-month-header-height, 24px)
                  + lane × var(--koyomi-lane-height, 24px))
           内容既定: 時間指定は開始時刻＋タイトル、終日はタイトル
          span[data-koyomi="month-event-resize"][data-edge="start|end"]?
             … getSegmentResizeHandleProps。editable: false / continues 側には出力しない
      div[data-koyomi="day-selection"]? (aria-hidden)  … ドラッグ選択・プレビューのハイライト
           style: insetInlineStart/width %（その週と previewRange の交差から計算）
```

- `hidden: true` のセグメントは DOM に出力しない（「+N 件」に集約）
- イベントの aria-label: 「タイトル、開始〜終了」（Intl、表示 TZ）

## 週/日ビュー（TimeGridView）

`data-koyomi-days` は表示中の**可視列数**（週=7・日=1 が基本だが、`hiddenWeekdays` で列を隠すと 5 など可変）。

```
div[data-koyomi="timegrid"][data-koyomi-days="<可視列数>"]
  div[data-koyomi="timegrid-header"]
    div[data-koyomi="timegrid-axis-gutter"]          … 左上の空き（時間軸幅の確保）
    div[data-koyomi="timegrid-day-header"][data-koyomi-date][data-today?][aria-current="date"?] × days
      … 曜日＋日番号（renderDayHeader で差し替え可）。
        日番号は button[data-koyomi="timegrid-day-number"]（aria-label=完全な日付、day ビューへ）
  div[data-koyomi="allday-row"]
    div[data-koyomi="timegrid-axis-gutter"]
    div[data-koyomi="allday-cells"]                  … position: relative の基準
      div[data-koyomi="allday-cell"][data-koyomi-date] × days   … getDayCellProps（allDay 作成用）
      button[data-koyomi="allday-event"] × n         … getSegmentProps。style: insetInlineStart/width %、
           top: lane × var(--koyomi-lane-height, 24px)。continues/dragging 属性は月と同じ
        span[data-koyomi="allday-resize"][data-edge="start|end"]?
           … getSegmentResizeHandleProps（editable: false / continues 側には出力しない）
      div[data-koyomi="day-selection"]?              … allDay プレビュー
  div[data-koyomi="timegrid-body"]
    div[data-koyomi="time-axis"]
      div[data-koyomi="time-slot-label"] × slots     … 'HH:mm'
    div[data-koyomi="timegrid-days"]
      div[data-koyomi="timegrid-day"][data-koyomi-date][data-today?] × days
         … useTimeGridDrag.getDayProps を展開。position: relative の基準
        div[data-koyomi="timegrid-slot"] × slots     … 罫線。style: top %
        button[data-koyomi="timegrid-event"] × n     … getEventProps を展開
           [data-continues-before?][data-continues-after?][data-koyomi-dragging?]
           style: top/height/left/width すべて %（top = startMinutes/1440 など）
          div[data-koyomi="timegrid-event-content"]  … 内容既定: 時刻範囲＋タイトル
          div[data-koyomi="timegrid-resize"][data-edge="start"]?
             … getResizeHandleProps(item, 'start')。上端 = 開始時刻の変更
               （editable: false / continuesBefore のイベントには出力しない）
          div[data-koyomi="timegrid-resize"][data-edge="end"]?
             … getResizeHandleProps(item, 'end')。下端 = 終了時刻の変更
               （editable: false / continuesAfter のイベントには出力しない）
        div[data-koyomi="timegrid-preview"][data-kind="create|move|resize"]? (aria-hidden)
           … previewFor(day) のその日に該当する区間。style: top/height %
        div[data-koyomi="now-indicator"]? (aria-hidden) … style: top %（nowIndicator の日のみ）
```

## リストビュー（ListView）

```
div[data-koyomi="list"]
  section[data-koyomi="list-day"][data-koyomi-date][data-today?] × n
    h3[data-koyomi="list-day-header"]                … 日付ラベル（Intl、renderDayHeader で差し替え可）
    button[data-koyomi="list-event"] × n
      span[data-koyomi="list-event-time"]            … allDayLabel（既定「終日」）または「HH:mm〜HH:mm」
      span[data-koyomi="list-event-swatch"]          … 色見本（--koyomi-event-color）
      span[data-koyomi="list-event-title"]
  div[data-koyomi="list-empty"]?                     … isEmpty のとき emptyLabel（既定「予定はありません」）
```

- リストのイベントはクリックで `onEventClick`（ドラッグなし）。Enter/Space も同様

### 仮想化（VirtualListView）— opt-in 時の DOM 拡張

`VirtualListView` は上記の非仮想化 DOM を**壊さず拡張**する（`ListView` の DOM は不変）。
日セクションの中身は共有レンダラ `ListDaySection` で `ListView` と完全一致する。

```
div[data-koyomi="list"][data-koyomi-virtualized="true"][role="list"][tabindex="0"]
  div[data-koyomi="list-spacer"][data-edge="before"][role="presentation"][aria-hidden]   … 上スペーサ（inline: height）
  section[data-koyomi="list-day"][role="listitem"][aria-label] × 可視分            … 窓内の日セクション
  div[data-koyomi="list-spacer"][data-edge="after"][role="presentation"][aria-hidden]    … 下スペーサ（inline: height）
  section[data-koyomi="list-day"][data-koyomi-pinned="true"][role="listitem"] × 0〜1     … 窓外のフォーカス保持（inline: top）
```

- `data-koyomi-virtualized` に対して `overflow-y:auto` / `position:relative` / `max-height`
  （`--koyomi-virtual-list-max-height`、既定 none）をデフォルトテーマが当てる。**高さは利用者 CSS が所有**する。
- inline style として出力するのはスペーサの `height`・pinned の `top` の数値のみ（既存の %/calc と同カテゴリ）。
- 日セクションの `aria-label` は「7月16日(木) 予定3件」形式で件数を伝える。
- 仮想化のプリミティブは `useVirtualizer`（ビュー非依存）。`VirtualListView` はその薄いラッパ。

## CalendarView

`state.view` に応じて `MonthView` / `TimeGridView` / `ListView` を出し分けるだけのスイッチ。
props はビュー名を接頭辞にした名前で各ビューへ転送する（`renderMonthEvent` /
`renderMonthDayCell` / `monthOverflowLabel` / `renderTimeGridEvent` /
`renderTimeGridDayHeader` / `renderListEvent` / `listAllDayLabel` / `listEmptyLabel` /
`renderListDayHeader`）。`virtualizeList` を渡すと list ビューは `ListView` の代わりに
`VirtualListView` で描画され、`listEstimateDayHeight` / `listOverscan` がそちらへ転送される。

## Toolbar の文言

`ToolbarProps.labels`（`ToolbarLabels`）で「今日 / ‹ / › / 月 / 週 / 日 / リスト」の
全文言を差し替えられる。prev/next の表示アイコン（‹/›）は固定で、`labels` の値が
文字列の場合のみ aria-label に反映する。
