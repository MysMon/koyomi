# コンポーネント DOM 契約（内部設計書）

ビルトインコンポーネントが生成する DOM 構造と `data-koyomi-*` 属性の契約。
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
div[data-koyomi="month"]
  div[data-koyomi="month-weekdays"]
    div[data-koyomi="month-weekday"] × 7            … 曜日ラベル（Intl、週開始順）
  div[data-koyomi="month-weeks"]
    div[data-koyomi="month-week"] × 4..6            … position: relative の基準（テーマ側）
      div[data-koyomi="month-days"]
        div[data-koyomi="month-day"][data-koyomi-date="YYYY-MM-DD"]
           [data-today?][data-outside?] × 7          … useDayDrag.getDayCellProps を展開
          button[data-koyomi="month-day-number"]     … クリックでその日の day ビューへ
          button[data-koyomi="month-overflow"]?      … 「+N 件」（overflowCount > 0 のとき）
      div[data-koyomi="month-events"]                … セグメント層（クリックを透過させる）
        button[data-koyomi="month-event"] × n        … useDayDrag.getSegmentProps を展開
           [data-all-day?][data-continues-before?][data-continues-after?][data-koyomi-dragging?]
           style: left/width は %、top は calc(var(--koyomi-month-header-height, 24px)
                  + lane × var(--koyomi-lane-height, 24px))
           内容既定: 時間指定は開始時刻＋タイトル、終日はタイトル
      div[data-koyomi="day-selection"]?              … ドラッグ選択・プレビューのハイライト
           style: left/width %（その週と previewRange の交差から計算）
```

- `hidden: true` のセグメントは DOM に出力しない（「+N 件」に集約）
- イベントの aria-label: 「タイトル、開始〜終了」（Intl、表示 TZ）

## 週/日ビュー（TimeGridView）

```
div[data-koyomi="timegrid"][data-koyomi-days="7|1"]
  div[data-koyomi="timegrid-header"]
    div[data-koyomi="timegrid-axis-gutter"]          … 左上の空き（時間軸幅の確保）
    div[data-koyomi="timegrid-day-header"][data-koyomi-date][data-today?] × days
      … 曜日＋日番号。日番号は button[data-koyomi="timegrid-day-number"]（day ビューへ）
  div[data-koyomi="allday-row"]
    div[data-koyomi="timegrid-axis-gutter"]
    div[data-koyomi="allday-cells"]                  … position: relative の基準
      div[data-koyomi="allday-cell"][data-koyomi-date] × days   … getDayCellProps（allDay 作成用）
      button[data-koyomi="allday-event"] × n         … getSegmentProps。style: left/width %、
           top: lane × var(--koyomi-lane-height, 24px)。continues/dragging 属性は月と同じ
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
          div[data-koyomi="timegrid-resize"]?        … getResizeHandleProps を展開
                                                       （editable: false のイベントには出力しない）
        div[data-koyomi="timegrid-preview"][data-kind="create|move|resize"]?
           … previewFor(day) の分区間。style: top/height %
        div[data-koyomi="now-indicator"]?            … style: top %（nowIndicator の日のみ）
```

## リストビュー（ListView）

```
div[data-koyomi="list"]
  section[data-koyomi="list-day"][data-koyomi-date][data-today?] × n
    h3[data-koyomi="list-day-header"]                … 日付ラベル（Intl）
    button[data-koyomi="list-event"] × n
      span[data-koyomi="list-event-time"]            … 「終日」または「HH:mm〜HH:mm」
      span[data-koyomi="list-event-swatch"]          … 色見本（--koyomi-event-color）
      span[data-koyomi="list-event-title"]
  div[data-koyomi="list-empty"]?                     … isEmpty のとき「予定はありません」
```

- リストのイベントはクリックで `onEventClick`（ドラッグなし）。Enter/Space も同様

## CalendarView

`state.view` に応じて `MonthView` / `TimeGridView` / `ListView` を出し分けるだけのスイッチ。
props（renderEvent 等）は各ビューへ転送する。
