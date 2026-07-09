# ビュー（月・週・日・リスト・年）

Koyomi は月・週・日・リスト（スケジュール）・年の 5 つのビューを切り替えて表示できます。本ページでは各ビューの画面構成、切り替え方法、ナビゲーション、そしてビューモデルを直接使った上級者向けの使い方を説明します。

## 5 つのビュー

### 月ビュー（month）

`MonthView` が描画します。曜日の見出し行の下に、月によって 4〜6 週の行が並びます（Google カレンダーと同様、週数は月ごとに変わる動的な行数です）。各日セルには日番号のボタンがあり、クリックするとその日の日ビューに切り替わります。予定は週内に「帯」（セグメント）として重ならないよう配置され、`dayMaxEvents`（既定 `4`）を超える分はその日の「+N 件」ボタンに集約されます。

### 週/日ビュー（week / day）

`TimeGridView` が描画します。上部に日ヘッダー（曜日と日番号のボタン）、その下に終日イベント行、本体には時間軸（`slotMinutes` 間隔の目盛り）と日列が並びます。日列には時間指定の予定がブロックとして配置され、上端・下端にリサイズ用のハンドルがあります。表示範囲に「今日」が含まれる場合は現在時刻を示す線も表示されます。`week` は 7 日分（`hiddenWeekdays` 指定時はその分少ない列数）、`day` は 1 日分の列になります。

### リストビュー（list）

`ListView` が描画します。予定がある日だけを対象に、日付ごとのセクションとして一覧表示します（Google カレンダーの「スケジュール」表示相当）。各セクションには日付の見出しと予定の行（時刻ラベル・色見本・タイトル）が並びます。表示範囲（`listDays` 日分、既定 `30`）に予定が 1 件もない場合は空状態のメッセージを表示します。月・週・日ビューと異なり、リストビューにドラッグ操作はありません。

### 年ビュー（year）

`YearView` が描画します。表示対象年の 1 月〜12 月分のミニ月グリッドを、レスポンシブなグリッドレイアウトで並べます（Google カレンダーの「年」表示相当）。各ミニ月グリッドは月見出しと曜日の見出し行、4〜6 週の日セルで構成され、`weekStartsOn` に従う週の並びは月ビューと共通です。各日セルはボタンで、日番号を表示し、予定がある日には小さなドットマーカーが付きます（件数の数値ではなく密度のみを示します）。日セルをクリックするとその日の日ビューに切り替わります。予定の帯・タイトルは表示せず、ドラッグ操作もありません（日付ナビゲーションと予定密度の俯瞰が目的のビューです）。前後月の日付セルは減光表示され、予定件数は常に 0 として扱われます。`hiddenWeekdays` は日ビューと同じく無視されます（ミニ月グリッドは常に 7 列）。

年ビューは `Toolbar` のビュー切替ボタン・`useCalendarShortcuts` の `Y` キーとも既定では無効な opt-in のビューです（詳細は次節）。

いずれのビューも、既定の見た目を使うには `@koyomi-cal/react/theme.css` を読み込みます。DOM 構造や CSS でのカスタマイズ方法は [テーマとスタイリング](./theming.md) を参照してください。

## ビューの切り替え

ビューは次の 3 通りで切り替えられます。

1. `Toolbar` のビュー切替ボタン（既定は月・週・日・リスト。年ビューは `views` prop での opt-in）
2. `calendar.api.setView(view)` を直接呼ぶ
3. `useCalendarShortcuts` によるキーボード操作（既定は `M` / `W` / `D` / `A`。年ビューの `Y` は `views` オプションでの opt-in。詳細は [インタラクション](./interactions.md) を参照）

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'month' });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 初期表示は月ビュー
// - Toolbar の「週」ボタンをクリックすると週ビューに切り替わる
// - calendar.api.setView('day') を直接呼んでも同様に切り替わる
```

キーボードで切り替えたい場合は `useCalendarShortcuts` を併用します。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  useCalendarShortcuts({ calendar });

  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - D キーで日ビュー、A キーでリストビュー、M キーで月ビューに切り替わる
// - input / textarea / select やフォーカス中の contenteditable 要素の中では無効
```

### 年ビューなど新ビューを有効にする（opt-in）

年ビューは既定では `Toolbar` のボタン列にも `useCalendarShortcuts` のキーにも現れません（既存利用者の見た目・挙動を変えないための方針）。有効にしたい場合は、両方に `views` を渡します。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  useCalendarShortcuts({ calendar, views: ['month', 'week', 'day', 'list', 'year'] });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar views={['month', 'week', 'day', 'list', 'year']} />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - Toolbar に「年」ボタンが追加され、クリックで年ビューに切り替わる
// - Y キーを押すと年ビューに切り替わる
// - views を省略した（または 'year' を含めない）場合、Y キーを押しても view は変わらない
```

## ナビゲーション

`CalendarApi` は次のナビゲーションメソッドを提供します。

- `next()` / `prev()` — 現在のビュー単位で次/前の期間へ移動する
- `today()` — 今日（`now()` が指す日、既定は現在時刻）へ移動する
- `goTo(date)` — 現在のビューを維持したまま、任意の日付を基準日にする

`next()` / `prev()` の移動単位はビューごとに異なります。

| ビュー | 移動単位 |
| --- | --- |
| `month` | ±1 ヶ月（基準日は月初に正規化される） |
| `week` | ±7 日 |
| `day` | ±1 日 |
| `list` | ±`listDays` 日 |
| `year` | ±1 年（基準日は年初に正規化される） |

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  initialView: 'month',
  initialDate: new Date('2026-07-15T01:00:00Z'), // 2026-07-15 10:00 JST
  now: () => new Date('2026-07-15T01:00:00Z'), // today() の基準時刻を固定
});

calendar.next(); // 翌月の1日へ（2026-08-01）
calendar.prev(); // 元の月へ戻る（2026-07-01）
calendar.goTo(new Date('2026-12-25T00:00:00Z')); // 任意の日付へ移動（ビューは 'month' のまま）
calendar.today(); // now() が指す日（この例では 2026-07-15）に戻る

// 期待される動作:
// - calendar.getState().currentDate が上記コメントどおりの日付になる
// - week ビューでは next()/prev() が ±7日、day ビューでは ±1日、
//   list ビューでは ±listDays 日（既定 30）、year ビューでは ±1 年で
//   currentDate（および getVisibleRange()）が動く
```

## ビューモデルを直接使う（上級編）

`calendar.api.getViewModel()`（React では `useCalendar()` の戻り値の `viewModel`）は、現在のビューに対応する描画用データを返します。型は `CalendarViewModel = MonthViewModel | TimeGridViewModel | ListViewModel | YearViewModel` で、`type` フィールドにより判別できる判別共用体です。

| 型 | `type` | 主なフィールド |
| --- | --- | --- |
| `MonthViewModel` | `'month'` | `anchor`（表示対象月の1日）、`weeks`（`MonthWeek[]`、4〜6件）、`weekdays`（曜日の並び） |
| `TimeGridViewModel` | `'timeGrid'` | `viewType`（`'week' \| 'day'`）、`days`（`TimeGridDay[]`）、`allDaySegments` / `allDayLaneCount`（終日行）、`slots`（時間軸の目盛り）、`nowIndicator`（現在時刻線の位置、対象日がなければ `null`） |
| `ListViewModel` | `'list'` | `days`（予定がある日だけの `ListDay[]`）、`isEmpty` |
| `YearViewModel` | `'year'` | `anchor`（表示対象年の1月1日）、`months`（`YearMonth[]`、12件）、`weekdays`（曜日の並び） |

`MonthWeek.days` は `MonthDay[]`（各日の `date` / `key` / `inCurrentMonth` / `isToday` / `overflowCount` など）、`TimeGridDay.items` は `PositionedOccurrence[]`（`startMinutes` / `endMinutes` / `left` / `width` など割合ベースの配置情報）を持ちます。`YearMonth.weeks` は `YearDay[][]`（各日の `date` / `key` / `inCurrentMonth` / `isToday` / `eventCount` を持ち、前後月の日付は `eventCount: 0` に固定）です。詳細なフィールドは各型の TSDoc を参照してください。

`type` で分岐すれば、ビューごとの情報を型安全に扱えます。

```ts
import type { CalendarViewModel } from '@koyomi-cal/react';

function describeViewModel(viewModel: CalendarViewModel): string {
  switch (viewModel.type) {
    case 'month':
      return `月ビュー: ${viewModel.weeks.length} 週`;
    case 'timeGrid':
      return `${viewModel.viewType}ビュー: ${viewModel.days.length} 日`;
    case 'list':
      return `リストビュー: ${viewModel.days.length} 日に予定あり`;
    case 'year':
      return `年ビュー: ${viewModel.months.length} ヶ月`;
  }
}

// 期待される動作:
// - initialView: 'week' の calendar.viewModel を渡すと 'weekビュー: 7 日' を返す
```

ビルトインコンポーネント（`MonthView` など）を使わず、ビューモデルから直接マークアップを組み立てることもできます。

```tsx
import { useCalendar } from '@koyomi-cal/react';

function BareMonthGrid() {
  const calendar = useCalendar({ initialView: 'month' });
  const { viewModel } = calendar;
  if (viewModel.type !== 'month') return null;

  return (
    <div>
      {viewModel.weeks.map((week) => (
        <div key={week.days[0]?.key}>
          {week.days.map((day) => (
            <span key={day.key}>{day.date.getDate()}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// 期待される動作:
// - MonthView を使わず、viewModel.weeks / week.days だけで最小限の月グリッドを描画できる
// - 各週の日数は「7 - hiddenWeekdays の数」（既定では 7）
// - 2026年7月（週開始が既定の日曜）は 5 週になる
```

ドラッグ操作などのインタラクションを自前の要素に組み込みたい場合は、ビューモデルに加えて `useDayDrag` / `useTimeGridDrag` のプロップゲッターを使います。詳しくは [インタラクション: 自前 UI を作る上級編](./interactions.md#自前-ui-を作る上級編) を参照してください。

## 関連オプション

`useCalendar` / `createCalendar` に渡す `CalendarOptions` のうち、ビュー表示に関わる主なものです。

| オプション | 型 | 既定値 | 影響 |
| --- | --- | --- | --- |
| `weekStartsOn` | `Weekday`（`0`〜`6`、`0` = 日曜） | `0` | 月ビューの週の並び、週ビューの開始曜日、年ビューのミニ月グリッドの週の並び、ナビゲーションの起点 |
| `dayMaxEvents` | `number` | `4` | 月ビューで 1 日に表示する予定の最大数。超過分は「+N 件」に集約される |
| `slotMinutes` | `number` | `60` | 週/日ビュー（時間グリッド）の時間軸の目盛り間隔（分） |
| `listDays` | `number` | `30` | リストビューが表示する日数。`next()`/`prev()` の移動単位にもなる |
| `hiddenWeekdays` | `readonly Weekday[]` | `[]` | 月・週ビューの列から除外する曜日（下記参照）。年ビュー・日ビューは無視する |

## 週末などの曜日を隠す（hiddenWeekdays）

`hiddenWeekdays` に曜日番号の配列を渡すと、月ビューと週ビューの列からその曜日が除外されます（Google カレンダーの「週末を表示しない」相当）。

```tsx
const calendar = useCalendar({ hiddenWeekdays: [0, 6] }); // 日曜・土曜を隠す

// 後から切り替える場合
calendar.api.updateOptions({ hiddenWeekdays: [0, 6] }); // 隠す
calendar.api.updateOptions({ hiddenWeekdays: [] }); // すべて表示

// 期待される動作:
// - 月ビュー・週ビューが月〜金の 5 列になる
// - 金曜〜月曜にまたがる予定は、可視列上で金・月が連続した 1 本の帯として描画される
// - 土日にしか存在しない予定は表示されず、「+N 件」にも数えられない
// - 日ビューは hiddenWeekdays を無視する（土曜へ goTo すれば表示される）
// - 年ビューも hiddenWeekdays を無視する（ミニ月グリッドは常に 7 列のまま）
// - 「今日」が非表示曜日の場合、現在時刻線（nowIndicator）は表示されない
```

7 曜日すべてを指定した場合は無効な設定として無視されます（すべて表示のまま）。

## ビューコンポーネントのカスタマイズ props

各ビューには、UI 文字列の差し替えや日単位のコンテンツの差し込みのための props があります（すべて省略可能）。`CalendarView` 経由で使う場合はビュー名を接頭辞にした名前で転送されます（括弧内）。

| コンポーネント | prop | 用途 |
| --- | --- | --- |
| `MonthView` | `renderEvent`（`renderMonthEvent`） | セグメントの表示内容 |
| `MonthView` | `renderDayCell`（`renderMonthDayCell`） | 日セルに祝日ラベルやバッジ等を差し込み（第 2 引数で既定内容を受け取る） |
| `MonthView` | `overflowLabel`（`monthOverflowLabel`） | 「+N 件」の文言（`(count) => ReactNode`） |
| `TimeGridView` | `renderEvent`（`renderTimeGridEvent`） | イベントブロックの表示内容 |
| `TimeGridView` | `renderDayHeader`（`renderTimeGridDayHeader`） | 日ヘッダーの内容 |
| `ListView` | `renderEvent`（`renderListEvent`） | 予定行の表示内容 |
| `ListView` | `allDayLabel`（`listAllDayLabel`） | 終日予定の時刻ラベル（既定「終日」） |
| `ListView` | `emptyLabel`（`listEmptyLabel`） | 空状態のメッセージ |
| `ListView` | `renderDayHeader`（`renderListDayHeader`） | 日付見出しの内容 |
| `YearView` | `renderMonthHeader`（`renderYearMonthHeader`） | ミニ月グリッドの見出しの内容（第 2 引数で既定内容を受け取る） |
| `YearView` | `renderDayCell`（`renderYearDayCell`） | 日セルの内容（日番号＋件数マーカー）をラップ・置換（第 2 引数で既定内容を受け取る） |
| `Toolbar` | `labels`（`ToolbarLabels`） | 「月/週/日/リスト/年/今日」等の全文言 |
| `Toolbar` | `views`（`readonly CalendarViewType[]`） | ビュー切替ボタンとして表示するビューの一覧・並び順（既定 `['month', 'week', 'day', 'list']`。年ビューは opt-in） |

```tsx
<Toolbar
  labels={{ month: 'Month', week: 'Week', day: 'Day', list: 'List', year: 'Year', today: 'Today' }}
  views={['month', 'week', 'day', 'list', 'year']}
/>
<CalendarView
  monthOverflowLabel={(count) => `+${count} more`}
  listAllDayLabel="All day"
  listEmptyLabel="No events"
  renderYearDayCell={(day, defaultContent) => (day.isToday ? <strong>{defaultContent}</strong> : defaultContent)}
/>
```

## リストの仮想化（大量の予定・長期間）

数ヶ月〜数年分の予定を一覧するなど、リストビューで DOM が肥大して描画・スクロールが重くなる場合は、可視範囲の日セクションだけを描画する `VirtualListView` を使えます。既定の `ListView` は全件描画のままで、仮想化は完全に opt-in です。

```tsx
import { CalendarProvider, VirtualListView, useCalendar } from '@koyomi-cal/react';

function Agenda() {
  const calendar = useCalendar({ initialView: 'list', listDays: 365, events });
  return (
    <CalendarProvider value={calendar} callbacks={{ onEventClick }}>
      <VirtualListView estimateDayHeight={72} />
    </CalendarProvider>
  );
}
```

- **高さは CSS で指定する（必須）**。ヘッドレスの原則に従い `VirtualListView` は寸法を持ちません。スクロールコンテナに境界高を CSS で与えてください。境界高が無いと仮想化は無害に無効化されます（開発ビルドで一度警告します）。

  ```css
  /* デフォルトテーマ利用時は CSS 変数でも指定できます */
  [data-koyomi="list"][data-koyomi-virtualized] { height: 600px; }
  /* または: :root { --koyomi-virtual-list-max-height: 600px; } */
  ```

- `estimateDayHeight`（数値または `(day, index) => number`）は実測が入るまでの推定高です。実際の高さは ResizeObserver で自動測定・補正されます。`overscan`（既定 3）で前後の追加描画日数を調整できます。
- `CalendarView` を使っている場合は、`<CalendarView virtualizeList />`（必要に応じて `listEstimateDayHeight` / `listOverscan`）で list ビューだけを仮想化に切り替えられます。`renderListEvent` などのリスト系 props はそのまま転送されます。
- `data-koyomi-virtualized="true"` が付き、`role="list"` / 日セクションの `role="listitem"` と件数入りの `aria-label` が付与されます。日セクションの内容（`data-koyomi-*` 構造）は `ListView` と完全に一致します。
- **注意**: 仮想化中はブラウザのページ内検索（Ctrl+F）が窓の外の予定に届きません。また「1 日あたり数百件」のような 1 セクション内の大量予定は仮想化の対象外です。

### 独自 UI へ組み込む（useVirtualizer）

`VirtualListView` はプリミティブ `useVirtualizer` の薄いラッパです。完全に独自のマークアップで仮想化したい場合は、`buildListViewModel`（[ビューモデルを直接使う](#ビューモデルを直接使う上級編)）と `useVirtualizer` を直接組み合わせられます。`useVirtualizer` はビューに依存しない汎用の縦方向ウィンドウイングを提供します（詳細は [API リファレンス](./api.md)）。

## 関連ページ

- [はじめに](./getting-started.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
