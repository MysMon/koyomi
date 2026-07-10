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
div[data-koyomi="root"][data-koyomi-view="month|week|day|list|year|multiMonth|resource|timeline"]
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
    button[data-koyomi="button"][data-koyomi-action="view-year"][aria-pressed]?  … ToolbarProps.views に 'year' を含めた場合のみ
    button[data-koyomi="button"][data-koyomi-action="view-multimonth"][aria-pressed]?  … ToolbarProps.views に 'multiMonth' を含めた場合のみ
    button[data-koyomi="button"][data-koyomi-action="view-resource"][aria-pressed]?  … ToolbarProps.views に 'resource' を含めた場合のみ
    button[data-koyomi="button"][data-koyomi-action="view-timeline"][aria-pressed]?  … ToolbarProps.views に 'timeline' を含めた場合のみ
```

タイトルの書式は `Intl.DateTimeFormat(locale, { timeZone, ... })`:
月 = 年+月、週 = 開始日〜終了日、日 = 年月日（曜日付き）、リスト = 開始日〜終了日、年 = 年のみ、
複数月 = 表示範囲の開始月・終了月をそれぞれ月の書式で整形して連結（例:「2026年7月〜2026年9月」。同一月なら単一表記）、
リソース = 日と同じ書式、タイムライン = `timelineDays: 1` なら日と同じ書式・複数日なら開始日〜終了日の範囲書式。

`toolbar-views` 配下のボタンは既定で月/週/日/リストの 4 つ（`ToolbarProps.views` 省略時）。並び順・表示対象はすべて `views` に従い、新ビュー（`view-year` / `view-multimonth` / `view-resource` / `view-timeline` 等）は明示的に含めない限り現れない（opt-in。既存利用者の既定の見た目は不変）。

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
        曜日ラベルは span[data-koyomi="timegrid-weekday"]（Intl、month-weekday/year-weekday と同じ流儀）
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

## 年ビュー（YearView）

予定の帯・タイトルは表示せず、ドラッグ操作もない（日付ナビゲーションと予定密度の俯瞰が目的）。
`hiddenWeekdays` は無視する（ミニ月グリッドは常に 7 列。日ビューと同じ扱い）。

```
div[data-koyomi="year"]
  section[data-koyomi="year-month"][data-koyomi-month="YYYY-MM"] × 12   … 1 月〜12 月
    div[data-koyomi="year-month-title"]                      … 月見出し（例:「7月」。renderMonthHeader で差し替え可。
                                                                 既定内容ごと置換される）
    div[data-koyomi="year-month-grid"] (role="grid")
      div[data-koyomi="year-weekdays"] (role="row")
        div[data-koyomi="year-weekday"] (role="columnheader") × 7
                                                        … 曜日ラベル（Intl、週開始順。全ミニ月グリッド共通）
      div[data-koyomi="year-weeks"] (role="rowgroup")
        div[data-koyomi="year-week"] (role="row") × 4..6
          div[data-koyomi="year-day-cell"] (role="gridcell")   … グリッドの1マス。フォーカス対象ではない
            button[data-koyomi="year-day"][data-koyomi-date="YYYY-MM-DD"]
               (aria-label=完全な日付+予定件数, aria-current="date"?)
               [data-today?][data-outside?][data-has-events?]
               … 実際の操作・フォーカス対象。クリックで goTo(date) + setView('day')。
                 内容は renderDayCell で差し替え可能（既定は以下）
              … 既定内容: 日番号のテキスト
              span[data-koyomi="year-day-count"][aria-hidden="true"]?
                                                        … eventCount > 0 かつ inCurrentMonth のときのみ
                                                          （既定テーマはドットマーカー、件数の数値は表示しない）
```

- `data-has-events` は `eventCount > 0` のときのみ付与する。前後月の日付（`data-outside`）は
  `eventCount` が常に `0` のため付与されない
- 日セルの `aria-label` は「7月10日 予定3件」形式（`eventCount === 0` のときは件数部分を省略）
- `role="gridcell"` は `year-day-cell`（div）に付き、実際にフォーカス・操作可能なのはその内側の
  `button[data-koyomi="year-day"]`（月ビューの複合ウィジェットパターンと同様、role を持つ要素と
  フォーカス対象を分離している）
- ミニ月単位で WAI-ARIA grid ロール（`role="grid"` / `row` / `columnheader` / `gridcell`）を持つ、
  月ビューと同じパターン

## 複数月ビュー（MultiMonthView）

月ビューの `multiMonthCount` ヶ月連結。月グリッド部分（`data-koyomi="month"` 以下）は月ビューと
同じ共有レンダラ（`month-view-parts.tsx`）を使うため、「月ビュー（MonthView）」節の DOM 構造と
完全に一致する（週行・日セル・帯セグメント・ARIA grid ロールもすべて同一）。

```
div[data-koyomi="multimonth"]
  div[data-koyomi="multimonth-month"] × multiMonthCount
    h3[data-koyomi="multimonth-title"]     … 月見出し（例:「2026年7月」）
    ( … 月グリッド。中身は「月ビュー（MonthView）」節と同一 … )
```

- 前後月の日付セルは `interactiveOutsideDays: false` で共有 parts に渡されるため、単体の
  `MonthView`（`interactiveOutsideDays: true`）と異なり**非インタラクティブ**になる
  （`tabIndex` なし・`data-koyomi-date` なし・ポインタ/キーボードハンドラなし。日番号のみ表示）
- 予定の帯（`month-event`）は自分の月グリッドにのみ描画される（`buildMonthViewModel` の
  `segmentRange` で月本体にクランプするため）。月境界をまたぐ帯は隣接する 2 つの月グリッドの
  それぞれにセグメントとして現れ、`continuesBefore` / `continuesAfter` で「←続く／続く→」を示す
- 週行・セグメントの React key は月キー（`MultiMonthMonth.key`）で修飾して全月横断で一意にする
  （DOM 上の `data-koyomi-*` 属性自体は月ビューと同一）
- D&D（`useDayDrag`）は `MultiMonthView` 全体で単一インスタンス。前後月セルを登録しないため、
  日付キーは全月共通で一意になり、月境界をまたぐドラッグ（例: 7/31 → 8/2）も解決できる

## リソースビュー（ResourceView）

1 日固定、列 = リソース。イベントブロック・リサイズハンドル・現在時刻線・プレビューは
週/日ビュー（`timegrid-event` / `timegrid-resize` / `now-indicator` / `timegrid-preview`）と
**同じ部位名**を使い、デフォルトテーマのスタイルを共有する（列ごとに `layoutTimeGridItems` を
実行した結果を、週/日ビューの日列と同じ描画で表示するだけのため）。

```
div[data-koyomi="resource"][data-koyomi-columns="<列数>"]
  div[data-koyomi="resource-header"]
    div[data-koyomi="timegrid-axis-gutter"]                … 左上の空き（時間軸幅の確保）
    div[data-koyomi="resource-headers"]
      div[data-koyomi="resource-header-cell"][data-koyomi-resource-id]? × columns
         … リソース名（renderColumnHeader で差し替え可）。未割り当て列は data-koyomi-resource-id なし。
           style: --koyomi-event-color（resource.color 指定時のみ）
  div[data-koyomi="allday-row"]
    div[data-koyomi="timegrid-axis-gutter"]
    div[data-koyomi="resource-allday-cells"]                … position: relative の基準
      div[data-koyomi="resource-allday-cell"][data-koyomi-resource][data-koyomi-preview-target?] × columns
         … getAllDayCellProps（クリックで当日 1 日分の終日イベント作成）
        button[data-koyomi="allday-event"] × n             … getAllDayItemProps（列間移動のみ）
           style: --koyomi-event-color（event.color ?? resource.color）
  div[data-koyomi="resource-body"]
    div[data-koyomi="time-axis"]
      div[data-koyomi="time-slot-label"] × slots           … 'HH:mm'
    div[data-koyomi="resource-columns"]
      div[data-koyomi="resource-column"][data-koyomi-resource][data-today?] × columns
         … getColumnProps を展開。position: relative の基準
        div[data-koyomi="timegrid-slot"] × slots           … 罫線。style: top %
        button[data-koyomi="timegrid-event"] × n           … getEventProps を展開
           [data-continues-before?][data-continues-after?][data-koyomi-dragging?]
           style: top/height/left/width すべて %
          div[data-koyomi="timegrid-event-content"]        … 内容既定: 開始時刻＋タイトル
          div[data-koyomi="timegrid-resize"][data-edge="start"]?
             … getResizeHandleProps(item, 'start')（editable: false / continuesBefore には出力しない）
          div[data-koyomi="timegrid-resize"][data-edge="end"]?
             … getResizeHandleProps(item, 'end')（editable: false / continuesAfter には出力しない）
        div[data-koyomi="timegrid-preview"][data-kind="create|move|resize"]? (aria-hidden)
           … previewFor(column) のその列に該当する区間。style: top/height %
        div[data-koyomi="now-indicator"]? (aria-hidden)    … style: top %（表示日が今日の列のみ）
  div[data-koyomi="resource-empty"]?                        … isEmpty のとき emptyLabel（既定「リソースがありません」）
```

- `isEmpty` の場合は `div[data-koyomi="resource"]` の直下に `resource-empty` のみを描画する（上記の内部構造は出力しない）
- イベントの aria-label は「タイトル、開始〜終了、リソース名」（週/日ビューの aria-label にリソース名を付け足した形。未割り当て列はリソース名部分を省略）
- a11y は週/日ビューの現状（grid 系 role なし）に合わせ、role なし + 操作要素は `<button>`

## タイムラインビュー（TimelineView）

横 = 時間（`timelineDays` 日の連結）、行 = リソース。水平位置は `表示分 / totalMinutes` の
% を inline で出力する（位置決めの数値のみ）。スクロールは単一の横スクロールコンテナ
（`timeline-body`）で行い、行見出し（`timeline-resource-header`）はテーマ CSS の
`position: sticky` で固定する（二重スクロール同期の JS は持たない）。

```
div[data-koyomi="timeline"][data-koyomi-days="<表示日数>"]
  div[data-koyomi="timeline-body"]                          … 横スクロールコンテナ
    div[data-koyomi="timeline-header-row"]
      div[data-koyomi="timeline-corner"]                    … 左上の空き（行見出し幅の確保）
      div[data-koyomi="timeline-axis"]
        div[data-koyomi="timeline-day-headers"]
          div[data-koyomi="timeline-day-header"][data-today?] × days
             … 日付見出し（formatDayHeader）。style: width %（1440 / totalMinutes）
        div[data-koyomi="timeline-slots"]
          div[data-koyomi="timeline-slot-label"] × slots    … 日内時刻（TimelineSlot.label）。
                                                                style: insetInlineStart %
    div[data-koyomi="timeline-row-group"] × rows
      div[data-koyomi="timeline-resource-header"][data-koyomi-resource-id]?
         … リソース名（renderRowHeader で差し替え可）。未割り当て行は data-koyomi-resource-id なし。
           style: --koyomi-event-color（resource.color 指定時のみ）。position: sticky（テーマ側）
      div[data-koyomi="timeline-row"][data-koyomi-resource] × rows
         … getRowProps を展開。position: relative の基準。style: --koyomi-timeline-lanes（行のレーン数）
        button[data-koyomi="timeline-item"] × n             … getItemProps を展開
           [data-koyomi-lane][data-all-day?][data-continues-before?][data-continues-after?][data-koyomi-dragging?]
           style: insetInlineStart/width は %（表示分 / totalMinutes）、
                  top は calc(lane × var(--koyomi-timeline-lane-height, 28px))
          div[data-koyomi="timeline-item-content"]          … 内容既定: タイトルのみ
          div[data-koyomi="timeline-resize"][data-edge="start"]?
             … getResizeHandleProps(item, 'start')（editable: false / 終日 / continuesBefore には出力しない）
          div[data-koyomi="timeline-resize"][data-edge="end"]?
             … getResizeHandleProps(item, 'end')（editable: false / 終日 / continuesAfter には出力しない）
        div[data-koyomi="timeline-preview"][data-kind="create|move|resize"]? (aria-hidden)
           … previewFor(row) のその行に該当する区間。style: insetInlineStart/width %
        div[data-koyomi="now-indicator"][data-orientation="vertical"]? (aria-hidden)
           … style: insetInlineStart %（表示範囲内に「今」がある場合のみ）
  div[data-koyomi="timeline-empty"]?                         … isEmpty のとき emptyLabel（既定「リソースがありません」）
```

- `isEmpty` の場合は `div[data-koyomi="timeline"]` の直下に `timeline-empty` のみを描画する
- イベントの aria-label は「タイトル、開始〜終了、リソース名」（未割り当て行はリソース名部分を省略）
- 目盛り（`timeline-slot-label`）の総数が `SLOT_COUNT_WARNING_THRESHOLD`（1,000）を超える場合、
  開発ビルドで一度だけ `console.warn` する（`timelineDays × ceil(1440 / slotMinutes)` が大きい構成）
- `now-indicator` は週/日ビュー・リソースビューと同じ部位名だが、こちらは縦線
  （`data-orientation="vertical"`）として描画される点が異なる
- a11y は週/日ビューの現状（grid 系 role なし）に合わせ、role なし + 操作要素は `<button>`

## CalendarView

`state.view` に応じて `MonthView` / `TimeGridView` / `ListView` / `YearView` / `MultiMonthView` /
`ResourceView` / `TimelineView` を出し分けるだけのスイッチ。props はビュー名を接頭辞にした名前で
各ビューへ転送する（`renderMonthEvent` / `renderMonthDayCell` / `monthOverflowLabel` /
`renderTimeGridEvent` / `renderTimeGridDayHeader` / `renderListEvent` / `listAllDayLabel` /
`listEmptyLabel` / `renderListDayHeader` / `renderYearMonthHeader` / `renderYearDayCell` /
`renderMultiMonthEvent` / `renderMultiMonthDayCell` / `multiMonthOverflowLabel` /
`renderResourceEvent` / `renderResourceColumnHeader` / `resourceUnassignedLabel` /
`resourceEmptyLabel` / `renderTimelineEvent` / `renderTimelineRowHeader` /
`timelineUnassignedLabel` / `timelineEmptyLabel`）。`virtualizeList` を渡すと list ビューは
`ListView` の代わりに `VirtualListView` で描画され、`listEstimateDayHeight` / `listOverscan` が
そちらへ転送される。

## Toolbar の文言

`ToolbarProps.labels`（`ToolbarLabels`）で「今日 / ‹ / › / 月 / 週 / 日 / リスト / 年 / 複数月 /
リソース / タイムライン」の全文言を差し替えられる。prev/next の表示アイコン（‹/›）は固定で、
`labels` の値が文字列の場合のみ aria-label に反映する。
