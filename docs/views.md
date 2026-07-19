# ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）

Koyomi は月・週・日・リスト（スケジュール）・年・複数月・リソース・タイムラインの 8 つのビューを切り替えて表示できます。本ページでは各ビューの画面構成、切り替え方法、ナビゲーション、そしてビューモデルを直接使った上級者向けの使い方を説明します。

## 8 つのビュー

### 月ビュー（month）

`MonthView` が描画します。曜日の見出し行の下に、月によって 4〜6 週の行が並びます（Google カレンダーと同様、週数は月ごとに変わる動的な行数です）。各日セルには日番号のボタンがあり、クリックするとその日の日ビューに切り替わります（`callbacks.onDayNumberClick` を指定すると既定の画面遷移を差し替えられます。[インタラクション](./interactions.md) 参照）。予定は週内に「帯」（セグメント）として重ならないよう配置され、`dayMaxEvents`（既定 `4`）を超える分はその日の「+N 件」ボタンに集約されます。

### 週/日ビュー（week / day）

`TimeGridView` が描画します。上部に日ヘッダー（曜日と日番号のボタン）、その下に終日イベント行、本体には時間軸（`slotMinutes` 間隔の目盛り）と日列が並びます。日ヘッダーの日番号ボタンをクリックするとその日の日ビューに切り替わります（`callbacks.onDayNumberClick` を指定すると既定の画面遷移を差し替えられます。[インタラクション](./interactions.md) 参照）。日列には時間指定の予定がブロックとして配置され、上端・下端にリサイズ用のハンドルがあります。表示範囲に「今日」が含まれる場合は現在時刻を示す線も表示されます。`week` は 7 日分（`hiddenWeekdays` 指定時はその分少ない列数）、`day` は 1 日分の列になります。

表示する時間帯は `slotMinTime`/`slotMaxTime` で制限でき、初期スクロール位置は `initialScrollTime`/`scrollToTime` で指定できます（詳細は [表示時間帯（slotMinTime/slotMaxTime）](#表示時間帯slotmintimeslotmaxtime) と [初期スクロール位置（initialScrollTime / scrollToTime）](#初期スクロール位置initialscrolltime--scrolltotime) を参照）。

### リストビュー（list）

`ListView` が描画します。予定がある日だけを対象に、日付ごとのセクションとして一覧表示します（Google カレンダーの「スケジュール」表示相当）。各セクションには日付の見出しと予定の行（時刻ラベル・色見本・タイトル）が並びます。表示範囲（`listDays` 日分、既定 `30`）に予定が 1 件もない場合は空状態のメッセージを表示します。月・週・日ビューと異なり、リストビューにドラッグ操作はありません。`hiddenWeekdays` は対象外です（`buildListViewModel` / `ListView` はそもそも `hiddenWeekdays` を受け取らないため、非表示曜日にしか予定が無い日もセクションとして表示されます）。

### 年ビュー（year）

`YearView` が描画します。表示対象年の 1 月〜12 月分のミニ月グリッドを、レスポンシブなグリッドレイアウトで並べます（Google カレンダーの「年」表示相当）。各ミニ月グリッドは月見出しと曜日の見出し行、4〜6 週の日セルで構成され、`weekStartsOn` に従う週の並びは月ビューと共通です。各日セルはボタンで、日番号を表示し、予定がある日には小さなドットマーカーが付きます（件数の数値ではなく密度のみを示します）。ドットは「予定が1件以上あるか」の二値表示で、件数が1件でも100件でも見た目は同じ1個のドットのままです。日セルをクリックするとその日の日ビューに切り替わります（`callbacks.onDayNumberClick` を指定すると既定の画面遷移を差し替えられます。[インタラクション](./interactions.md) 参照）。予定の帯・タイトルは表示せず、ドラッグ操作もありません（日付ナビゲーションと予定密度の俯瞰が目的のビューです）。前後月の日付セルは減光表示され、予定件数は常に 0 として扱われます。`hiddenWeekdays` は日ビューと同じく無視されます（ミニ月グリッドは常に 7 列）。

年ビューは `Toolbar` のビュー切替ボタン・`useCalendarShortcuts` の `Y` キーとも既定では無効な opt-in のビューです（詳細は次節）。

### 複数月ビュー（multiMonth）

`MultiMonthView` が描画します。連続する `multiMonthCount`（既定 `3`）ヶ月分の月グリッドを縦に並べます（四半期・半期のプランニング用途。FullCalendar の multiMonth 相当）。各月グリッドの構成・週の並び・帯（セグメント）表示・「+N 件」あふれ・ドラッグ操作（作成・移動・リサイズ）は、いずれも月ビューと完全に同等です（日番号クリックの既定遷移も `callbacks.onDayNumberClick` で同様に差し替えられます）。

月ビューとの違いは、**前後月の日付セルに予定を表示しない**（かつ日番号のみのクリック不可な表示になる）点だけです。連続する月グリッドを縦に並べると、同じ日付（例: 7/31）が 7 月グリッドの本体と 8 月グリッドの前月はみ出しの両方に現れて二重に描画されてしまうため、「予定は自分の月のグリッドにのみ描画する」規則で解消しています。月境界をまたぐ帯は月ごとにクランプされ、「←続く／続く→」（`continuesBefore` / `continuesAfter`）で表示されます。

複数月ビューも `Toolbar` のビュー切替ボタン・`useCalendarShortcuts` の `Q` キーとも既定では無効な opt-in のビューです（詳細は次節）。

### リソースビュー（resource）

`ResourceView` が描画します。時間グリッドを「列 = リソース」で描きます（週/日ビューの「列 = 日」をリソースに置き換えたもの。Google カレンダーの会議室日表示相当）。表示日数は `resourceViewDays`（既定 `1`）で指定でき、`2` 以上にすると列が**リソース × 日の直積**になります。グルーピング順は**リソース優先**（各リソースの中に日が昇順で並ぶ。FullCalendar の resourceTimeGrid の既定 `datesAboveResources: false` と同じ一般的な並び）です。`hiddenWeekdays` は日ビューと同じく無視され、常に `resourceViewDays` 日の連続した並びになります。

構成は週/日ビューに準じます。上部にリソース列見出し行（`resources` の並び順。列見出しにはリソースの `color` が反映され、複数日表示では「リソース名 + 日ラベル」（例: `会議室A 15 (水)`）になります）、その下に終日行、本体には時間軸と各リソースの時間指定イベント列が並びます。`resourceId` を持たない予定、または `resources` に存在しない ID を指す予定（参照先のない `resourceId`）は「未割り当て」列に表示されます。未割り当て列は既定（`unassignedLane: 'auto'`）では該当する予定があるときだけ末尾に現れ、`unassignedLane: 'always'` を指定すると常に表示されます（詳細は下記の[関連オプション](#関連オプション)）。

インタラクションは `useResourceGridDrag` が提供します。縦方向（時間）は週/日ビューと同じ操作、横方向はドラッグで別の列へ移動できます。複数日表示では別の日の列への移動が日付の変更（日数シフト）になり、予定の作成・移動・リサイズが確定すると、時間・日付の変更と `resourceId` の変更が 1 回の更新にまとめて適用されます（作成・リサイズの対象日は開始列の日に固定されます）。キーボードは `↑`/`↓` が時間の移動・`Shift+↑`/`Shift+↓` がリサイズ、**`←`/`→` が隣の列への移動**です（画面上の視覚軸に対応する操作。複数日表示では同一リソース内の隣の日 → リソース境界では隣のリソースの端の日、の順に移ります。詳細は [インタラクション](./interactions.md) を参照）。終日 ⇔ 時間指定の変換ドラッグは提供しません。

`CalendarResource.parentId` はリソースビューには影響しません。列順は常に `resources` 配列の順（フラット）で、ツリー表示・折りたたみはタイムラインビュー専用です。

表示する時間帯は `slotMinTime`/`slotMaxTime` で制限でき、初期スクロール位置は `initialScrollTime`/`scrollToTime` で指定できます（詳細は [表示時間帯（slotMinTime/slotMaxTime）](#表示時間帯slotmintimeslotmaxtime) と [初期スクロール位置（initialScrollTime / scrollToTime）](#初期スクロール位置initialscrolltime--scrolltotime) を参照）。

### タイムラインビュー（timeline）

`TimelineView` が描画します。横 = 時間、行 = リソースの帯表示で、`timelineDays`（既定 `1`）日分を横に連結します（FullCalendar の resourceTimeline 相当）。`hiddenWeekdays` は無視され、常に `timelineDays` 日の連続した並びになります。

構成は、左にリソース行見出し列（`position: sticky` で固定）、右に横スクロールする本体（日ヘッダー・時間目盛り・各リソース行の帯）です。行の考え方はリソースビューと同じで、`resourceId` が対応しない予定は「未割り当て」行に入り、`unassignedLane` オプションで生成規則を制御します。終日イベントはその日の全幅の帯として、時間指定イベントと同じレーン空間に配置されます。

インタラクションは `useTimelineDrag` が提供します。横方向（時間）へのドラッグで移動・リサイズ、縦方向（行）へのドラッグでリソース間の移動ができます。キーボードは `←`/`→` が時間の移動・`Shift+←`/`Shift+→` がリサイズ、**`↑`/`↓` が隣の行への移動**です（リソースビューとは軸が異なりますが、いずれも「画面上でその方向に動く」という同じ原則によるものです）。終日 ⇔ 時間指定の変換ドラッグは提供しません。

`CalendarResource.parentId` を指定すると、リソースを親子関係のツリーとして表示できます（会議室を「拠点 > フロア > 会議室」のように階層化する用途）。詳細は [リソースの階層グルーピング](#リソースの階層グルーピングparentid折りたたみ) を参照してください。横軸の表示単位は `timelineScale` で時刻・日・週・月に切り替えられます（詳細は [タイムラインのズーム粒度](#タイムラインのズーム粒度timelinescale) を参照）。

リソースビュー・タイムラインビューはいずれも `Toolbar` のビュー切替ボタン・`useCalendarShortcuts` のキー（`R` / `L`）とも既定では無効な opt-in のビューです（詳細は次節）。

いずれのビューも、既定の見た目を使うには `@koyomi-cal/react/theme.css` を読み込みます。DOM 構造や CSS でのカスタマイズ方法は [テーマとスタイリング](./theming.md) を参照してください。

## ビューの切り替え

ビューは次の 3 通りで切り替えられます。

1. `Toolbar` のビュー切替ボタン（既定は月・週・日・リスト。年・複数月・リソース・タイムラインビューは `views` prop での opt-in）
2. `calendar.api.setView(view)` を直接呼ぶ
3. `useCalendarShortcuts` によるキーボード操作（既定は `M` / `W` / `D` / `A`。年ビューの `Y`・複数月ビューの `Q`・リソースビューの `R`・タイムラインビューの `L` は `views` オプションでの opt-in。詳細は [インタラクション](./interactions.md) を参照）

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

### 年・複数月・リソース・タイムラインビューを有効にする（opt-in）

年・複数月・リソース・タイムラインビューは既定では `Toolbar` のボタン列にも `useCalendarShortcuts` のキーにも現れません。有効にするには、両方に `views` を渡します。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  useCalendarShortcuts({
    calendar,
    views: ['month', 'week', 'day', 'list', 'year', 'multiMonth', 'resource', 'timeline'],
  });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar views={['month', 'week', 'day', 'list', 'year', 'multiMonth', 'resource', 'timeline']} />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - Toolbar に「年」「複数月」「リソース」「タイムライン」ボタンが追加され、
//   クリックでそれぞれのビューに切り替わる
// - Y キーを押すと年ビューに、Q キーを押すと複数月ビューに、
//   R キーを押すとリソースビューに、L キーを押すとタイムラインビューに切り替わる
// - views を省略した（または対象のビュー名を含めない）場合、そのビューへの切替キーは効かない
```

リソースビュー・タイムラインビューを使う場合は `resources` オプションでリソース一覧も渡します（省略時は空配列で、両ビューとも「未割り当て」レーンのみになります）。

```tsx
const calendar = useCalendar({
  initialView: 'resource',
  resources: [
    { id: 'room-a', title: '会議室A' },
    { id: 'room-b', title: '会議室B' },
  ],
});
```

**注意**:

- 「未割り当てへ戻す」D&D（リソース列/行から `resourceId` を外す操作）を運用したい場合は `unassignedLane: 'always'` を指定してください。既定の `'auto'` では、未割り当ての予定が 1 件もない間は未割り当てレーン（＝ドロップ先）自体が存在せず、この操作ができません。
- `resources` が空かつ未割り当てレーンも生成されない場合（`unassignedLane: 'auto'` で未割り当ての予定も無い場合）、リソース/タイムラインビューは列/行が 1 つもない空状態になります（`messages.resource.empty` / `messages.timeline.empty` のメッセージを表示）。この状態ではドロップ先のレーンが存在しないため D&D による作成もできません。回避するには `resources` を渡すか `unassignedLane: 'always'` を指定してください。

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
| `multiMonth` | ±`multiMonthCount` ヶ月（基準日は月初に正規化される） |
| `resource` | ±`resourceViewDays` 日（既定 `1` = `day` と同一） |
| `timeline` | ±`timelineDays` 日 |

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
//   list ビューでは ±listDays 日（既定 30）、year ビューでは ±1 年、
//   multiMonth ビューでは ±multiMonthCount ヶ月（既定 3）、
//   resource ビューでは ±resourceViewDays 日（既定 1）、
//   timeline ビューでは ±timelineDays 日（既定 1）で
//   currentDate（および getVisibleRange()）が動く
```

## ビューモデルを直接使う（上級編）

`calendar.api.getViewModel()`（React では `useCalendar()` の戻り値の `viewModel`）は、現在のビューに対応する描画用データを返します。型は `CalendarViewModel = MonthViewModel | TimeGridViewModel | ListViewModel | YearViewModel | MultiMonthViewModel | ResourceViewModel | TimelineViewModel` で、`type` フィールドにより判別できる判別共用体です。

| 型 | `type` | 主なフィールド |
| --- | --- | --- |
| `MonthViewModel` | `'month'` | `anchor`（表示対象月の1日）、`weeks`（`MonthWeek[]`、4〜6件）、`weekdays`（曜日の並び） |
| `TimeGridViewModel` | `'timeGrid'` | `viewType`（`'week' \| 'day'`）、`days`（`TimeGridDay[]`）、`allDaySegments` / `allDayLaneCount`（終日行）、`slots`（主軸の時間軸の目盛り）、`timeAxes`（主軸＋追加軸の時間軸配列、[複数タイムゾーン軸](#複数タイムゾーン軸timeaxiszones)参照）、`nowIndicator`（現在時刻線の位置、対象日がなければ `null`） |
| `ListViewModel` | `'list'` | `days`（予定がある日だけの `ListDay[]`）、`isEmpty` |
| `YearViewModel` | `'year'` | `anchor`（表示対象年の1月1日）、`months`（`YearMonth[]`、12件）、`weekdays`（曜日の並び） |
| `MultiMonthViewModel` | `'multiMonth'` | `anchor`（先頭月の1日）、`months`（`MultiMonthMonth[]`、`multiMonthCount` 件）、`weekdays`（曜日の並び） |
| `ResourceViewModel` | `'resource'` | `date`（先頭日）、`days`（`ResourceViewDay[]`、`resourceViewDays` 日分）、`columns`（`ResourceColumn[]`。リソース × 日の直積。リソースは `resources` の並び順＋末尾に未割り当て列）、`isEmpty`、`slots`（時間軸の目盛り）、`nowIndicatorMinutes` |
| `TimelineViewModel` | `'timeline'` | `days`（`timelineDays` 日分）、`rows`（`TimelineRow[]`。`resources` の並び順＋末尾に未割り当て行）、`isEmpty`、`slots`（`TimelineSlot[]`）、`totalMinutes`、`nowIndicatorMinutes` |

`MonthWeek.days` は `MonthDay[]`（各日の `date` / `key` / `inCurrentMonth` / `isToday` / `overflowCount` など）、`TimeGridDay.items` は `PositionedOccurrence[]`（`startMinutes` / `endMinutes` / `left` / `width` など割合ベースの配置情報）を持ちます。`YearMonth.weeks` は `YearDay[][]`（各日の `date` / `key` / `inCurrentMonth` / `isToday` / `eventCount` を持ち、前後月の日付は `eventCount: 0` に固定）です。`MultiMonthMonth.weeks` は月ビューと同じ `MonthWeek[]` です（前後月の日付セルにはセグメントを配置しない点だけが月ビューと異なります）。`ResourceColumn`（`resource` / `key` / `date` / `dayKey` / `isToday` / `dayIndex` / `items`（`PositionedOccurrence[]`）/ `allDayItems`）は週/日ビューと同じ配置計算を列（リソース × 日）ごとに行った結果です。`TimelineRow`（`resource` / `key` / `items`（`TimelineItem[]`）/ `laneCount`）の `TimelineItem` は `startMinutes` / `endMinutes` が「表示分」（範囲先頭からの分。全日を等幅 1440 分として扱う座標系）で表され、`lane` で行内の縦位置を示します。詳細なフィールドは各型の TSDoc を参照してください。

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
    case 'multiMonth':
      return `複数月ビュー: ${viewModel.months.length} ヶ月`;
    case 'resource':
      return `リソースビュー: ${viewModel.columns.length} 列`;
    case 'timeline':
      return `タイムラインビュー: ${viewModel.rows.length} 行`;
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
| `weekStartsOn` | `Weekday`（`0`〜`6`、`0` = 日曜） | `0` | 月ビューの週の並び、週ビューの開始曜日、年ビューのミニ月グリッドの週の並び、複数月ビューの各月グリッドの週の並び、ナビゲーションの起点 |
| `dayMaxEvents` | `number` | `4` | 月ビュー・複数月ビューで 1 日に表示する予定の最大数。超過分は「+N 件」に集約される |
| `slotMinutes` | `number` | `60` | 週/日ビュー（時間グリッド）の時間軸の目盛り間隔（分） |
| `timeAxisZones` | `readonly TimeZoneId[]` | `[]` | 週/日ビューの時間軸に並べる追加のタイムゾーン（Google カレンダーのセカンダリタイムゾーン相当）。詳細は [複数タイムゾーン軸](#複数タイムゾーン軸timeaxiszones) を参照 |
| `listDays` | `number` | `30` | リストビューが表示する日数。`next()`/`prev()` の移動単位にもなる |
| `multiMonthCount` | `number` | `3` | 複数月ビューが表示する月数。`next()`/`prev()` の移動単位にもなる |
| `hiddenWeekdays` | `readonly Weekday[]` | `[]` | 月・週・複数月ビューの列から除外する曜日（下記参照）。年・日・リソース・タイムラインビューは無視する。リストビューは対象外（そもそも受け取らない） |
| `resources` | `readonly CalendarResource[]` | `[]` | リソースビュー・タイムラインビューの列/行になるリソース一覧（表示順）。他ビューには影響しない。詳細は [予定の管理: リソース](./events.md#リソース) を参照 |
| `resourceViewDays` | `number` | `1` | リソースビューが表示する日数。`2` 以上で列がリソース × 日の直積（リソース優先のグルーピング順）になる。`next()`/`prev()` の移動単位にもなる |
| `timelineDays` | `number` | `1` | タイムラインビューが表示する日数。`next()`/`prev()` の移動単位にもなる |
| `timelineScale` | `'hour' \| 'day' \| 'week' \| 'month'` | `'hour'` | タイムラインビューの横軸のズーム粒度。詳細は [タイムラインのズーム粒度](#タイムラインのズーム粒度timelinescale) を参照 |
| `unassignedLane` | `'auto' \| 'always'` | `'auto'` | リソース/タイムラインビューの未割り当てレーンの生成規則。`'auto'` は該当する予定があるときのみ末尾に生成、`'always'` は常に生成する（「未割り当てへ戻す」D&D を使う場合に必要。詳細は [対象ビューを有効にする](#年複数月リソースタイムラインビューを有効にするopt-in) を参照） |
| `showWeekNumbers` | `boolean` | `false` | 月ビューの週行・週ビューのヘッダーに ISO 8601 週番号を表示するか。複数月ビューは対象外（週番号は算出されない）。詳細は [週番号](#週番号showweeknumbers) を参照 |
| `businessHours` | `readonly BusinessHoursRule[]` | `[]` | 週/日・リソース・タイムラインビューの営業時間の指定。詳細は [営業時間](#営業時間businesshours) を参照 |
| `eventOverlap` | `boolean` | `true` | イベントの重なりを許可するかどうかの既定値。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照 |
| `eventConstraint` | `'businessHours' \| readonly BusinessHoursRule[]` | 未指定 | イベントのドロップ先を制限する既定値。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照 |
| `slotMinTime` / `slotMaxTime` | `string`（`'HH:mm'`） | `'00:00'` / `'24:00'` | 週/日・リソースビューで表示する時間帯。詳細は [表示時間帯](#表示時間帯slotmintimeslotmaxtime) を参照 |
| `initialCollapsedResourceIds` | `readonly string[]` | `[]` | タイムラインビューで初期状態から折りたたむリソース ID。詳細は [リソースの階層グルーピング](#リソースの階層グルーピングparentid折りたたみ) を参照 |

## 週末などの曜日を隠す（hiddenWeekdays）

`hiddenWeekdays` に曜日番号の配列を渡すと、月ビューと週ビューの列からその曜日が除外されます（Google カレンダーの「週末を表示しない」相当）。複数月ビューの各月グリッドも月ビューと同じ規則で除外されます。

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
// - 複数月ビューは月ビューと同じく列が除外される（各月グリッドが月〜金の 5 列になる）
// - リソースビューも hiddenWeekdays を無視する（日ビューと同じ扱い。
//   常に resourceViewDays 日の連続した並びになる）
// - タイムラインビューも hiddenWeekdays を無視する（比例スケールの歪みを避けるため。
//   常に timelineDays 日の連続した並びになる）
// - リストビューは hiddenWeekdays を受け取らない（対象外）ため、非表示曜日にしか
//   予定が無い日もセクションとして表示される
// - 「今日」が非表示曜日の場合、現在時刻線（nowIndicator）は表示されない
```

7 曜日すべてを指定した場合は無効な設定として無視されます（すべて表示のまま）。

## ビューコンポーネントのカスタマイズ props

各ビューには、コンテンツの差し込みのためのカスタム描画スロット（render prop）があります（すべて省略可能）。`CalendarView` 経由で使う場合はビュー名を接頭辞にした名前で転送されます（括弧内）。

すべてのスロットは `(item, ctx) => ReactNode` の形をとり、`ctx.defaultContent` に省略時の内容が渡されます（そのまま返せば省略時と同じ表示。既定に足す・ラップする用途に使えます）。イベント内容のスロット（`renderEvent` / `renderAllDayEvent` / `renderAllDayItem`）にはさらに `ctx.slot`（描画枠の種別）・`ctx.view`（どのビューでの描画か）・`ctx.parts`（整形済みの時刻テキスト・タイトル等の分解済みパーツ）が渡されます。共通ルール・差し替えの境界・レシピは [カスタマイズガイド](./customization.md) を参照してください。

| コンポーネント | prop | 用途 |
| --- | --- | --- |
| `MonthView` | `renderEvent`（`renderMonthEvent`） | セグメントの表示内容 |
| `MonthView` | `renderDayCell`（`renderMonthDayCell`） | 日セルに祝日ラベルやバッジ等を差し込み |
| `MonthView` | `overflowButtonProps`（`monthOverflowButtonProps`） | 「+N 件」ボタンに追加する props（`aria-haspopup` / `aria-expanded` 等）。自前のポップオーバーと連携する用途（詳細は[インタラクション](./interactions.md)） |
| `MonthView` | `renderOverflowLabel`（`renderMonthOverflowLabel`） | 「+N 件」ラベルの内容。ボタン要素・クリック配線は保持したまま内側だけを差し替える（`ctx.hiddenOccurrences` に集約された非表示オカレンス一覧が渡る） |
| `TimeGridView` | `renderEvent`（`renderTimeGridEvent`） | 時間指定イベントブロックの表示内容（終日行は対象外。終日行は `renderAllDayEvent` を使う） |
| `TimeGridView` | `renderAllDayEvent`（`renderTimeGridAllDayEvent`） | 終日行の帯の表示内容（既定はタイトルのみ） |
| `TimeGridView` | `renderDayHeader`（`renderTimeGridDayHeader`） | 日ヘッダーの内容 |
| `ListView` | `renderEvent`（`renderListEvent`） | 予定行の表示内容（`ctx.parts` に時刻・色見本・タイトルの部位ノードが渡される） |
| `ListView` | `renderDayHeader`（`renderListDayHeader`） | 日付見出しの内容 |
| `YearView` | `renderMonthHeader`（`renderYearMonthHeader`） | ミニ月グリッドの見出しの内容 |
| `YearView` | `renderDayCell`（`renderYearDayCell`） | 日セルの内容（日番号＋件数マーカー）をラップ・置換 |
| `MultiMonthView` | `renderEvent`（`renderMultiMonthEvent`） | セグメントの表示内容（既定は `MonthView` と同じ） |
| `MultiMonthView` | `renderDayCell`（`renderMultiMonthDayCell`） | 日セルに祝日ラベルやバッジ等を差し込み（前後月の日付セルはインタラクティブでないため適用されない） |
| `MultiMonthView` | `overflowButtonProps`（`multiMonthOverflowButtonProps`） | 「+N 件」ボタンに追加する props（`MonthView` と同じ） |
| `MultiMonthView` | `renderOverflowLabel`（`renderMultiMonthOverflowLabel`） | 「+N 件」ラベルの内容（`MonthView` と同じ仕様） |
| `ResourceView` | `renderEvent`（`renderResourceEvent`） | 時間指定イベントブロックの表示内容（時間指定は `renderEvent`・終日は `renderAllDayItem`） |
| `ResourceView` | `renderAllDayItem`（`renderResourceAllDayItem`） | 終日アイテムの表示内容（既定はタイトルのみ）。`VirtualResourceView` にも同じ prop がある |
| `ResourceView` | `renderColumnHeader`（`renderResourceColumnHeader`） | 列見出しの内容（リソース名、または未割り当て列は `messages.resource.unassigned`）をラップ・置換 |
| `TimelineView` | `renderEvent`（`renderTimelineEvent`） | 帯（タイムラインアイテム）の表示内容 |
| `TimelineView` | `renderRowHeader`（`renderTimelineRowHeader`） | 行見出しの内容（リソース名、または未割り当て行は `messages.timeline.unassigned`）をラップ・置換 |
| `Toolbar` | `views`（`readonly CalendarViewType[]`） | ビュー切替ボタンとして表示するビューの一覧・並び順（既定 `['month', 'week', 'day', 'list']`。年・複数月・リソース・タイムラインビューは opt-in） |

イベント内容を全ビュー共通で一括定義したい場合は、ビュー個別の render prop の代わりに `CalendarProvider` の `renderEventContent` prop が使えます（優先順位はビュー個別 > 中央 > 既定。年ビューはイベント内容を描画しないため対象外。詳細は [カスタマイズガイド: ビュー横断で一括定義する](./customization.md#ビュー横断で一括定義するrendereventcontent)）。

「+N 件」の文言・空状態のメッセージ・未割り当てラベル・イベントや日セクションの aria-label・`Toolbar` のボタン表示文字列は、上記の props ではなく `CalendarProvider` の中央メッセージカタログ（`messages` prop）から解決されます。ロケール連動・部分上書き・自前ロケールの作り方は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

```tsx
<Toolbar views={['month', 'week', 'day', 'list', 'year', 'multiMonth', 'resource', 'timeline']} />
<CalendarView
  renderYearDayCell={(day, ctx) =>
    day.isToday ? <strong>{ctx.defaultContent}</strong> : ctx.defaultContent
  }
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

- `estimateDayHeight`（数値または `(day, index) => number`）は実測が入るまでの推定高です。実際の高さは ResizeObserver で自動測定・補正されます。`overscan`（既定 3）で前後の追加描画日数を調整できます。負数・`0`・`NaN` 等の不正な値（関数が返す値を含む）は `0` として扱われ、レイアウト計算（合計高・スペーサ高）が壊れないよう安全側にクランプされます。
- `CalendarView` を使っている場合は、`<CalendarView virtualizeList />`（必要に応じて `listEstimateDayHeight` / `listOverscan`）で list ビューだけを仮想化に切り替えられます。`renderListEvent` などのリスト系 props はそのまま転送されます。
- `data-koyomi-virtualized="true"` が付き、`role="list"` / 日セクションの `role="listitem"` と件数入りの `aria-label` が付与されます。日セクションの内容（`data-koyomi-*` 構造）は `ListView` と完全に一致します。
- フォーカス中の日セクションは、スクロールで可視窓の外に出ても DOM を保持し続けます（pinned セクション）。この pinned セクション内の操作要素は `tabIndex={-1}` になりタブ順から外れます（窓内に戻ると既定の `tabIndex` に戻ります）。`VirtualResourceView` / `VirtualTimelineView` の pinned 列・行も同じ規則です。
- **注意**: 仮想化中はブラウザのページ内検索（Ctrl+F）が窓の外の予定に届きません。また「1 日あたり数百件」のような 1 セクション内の大量予定は仮想化の対象外です。

### 独自 UI へ組み込む（useVirtualizer）

`VirtualListView` はプリミティブ `useVirtualizer` の薄いラッパです。完全に独自のマークアップで仮想化したい場合は、`buildListViewModel`（[ビューモデルを直接使う](#ビューモデルを直接使う上級編)）と `useVirtualizer` を直接組み合わせられます。`useVirtualizer` はビューに依存しない汎用のウィンドウイングを提供し、`axis: 'vertical' | 'horizontal'`（既定 `'vertical'`）で縦・横どちらの軸でも使えます（詳細は [API リファレンス](./api.md)）。

## レーンの仮想化（リソース・タイムラインビュー）

数十〜数百件のリソースを扱う画面では、`VirtualResourceView` / `VirtualTimelineView` で可視範囲のリソースだけを描画できます。既定の `ResourceView` / `TimelineView` は全件描画のままで、仮想化は完全に opt-in の別コンポーネントです（DOM 構造・ARIA・`renderEvent` 等のカスタマイズ props は元のビューと同じ）。

```tsx
import { CalendarProvider, VirtualTimelineView, useCalendar } from '@koyomi-cal/react';

function CraneSchedule() {
  const calendar = useCalendar({ initialView: 'timeline', resources: manyCranes, timelineDays: 7 });
  return (
    <CalendarProvider value={calendar} callbacks={{ onEventChange: applyChange }}>
      <VirtualTimelineView />
    </CalendarProvider>
  );
}
```

- **`VirtualTimelineView`** はリソース行を縦方向に仮想化します（`TimelineView` の行と同じ `role="row"`/`rowheader`/`gridcell` 構造）。行 1 件分の推定高は `estimateRowHeight`（既定はレーン数 × 28px）。
- **`VirtualResourceView`** はリソース列を横方向に仮想化します（`ResourceView` の列と同じ `role="columnheader"`/`gridcell` 構造）。`ResourceView` 自体は列数が多いと横スクロールに任せる方針（`docs/internal/components-dom.md` 参照）ですが、数百列規模の極端なケース向けに `VirtualResourceView` が windowing を提供します。列幅は固定（`columnWidth`、既定 160px = `--koyomi-resource-column-width` の既定値と同じ）です。 `estimateRowHeight` / `columnWidth` に負数・`0`・`NaN` 等の不正な値を渡した場合も、窓の計算内では `0` として扱われ安全側にクランプされます（`VirtualListView` の `estimateDayHeight` と同じ規則）。ただし `columnWidth` は列の inline style（`flex` / `min-width`）にもそのまま使われるため、不正な値は描画される列幅自体にも影響します。
- どちらも **境界寸法は CSS で指定します**。`VirtualTimelineView` は `[data-koyomi="timeline-body"]` の `max-height`（既定テーマは 640px）、`VirtualResourceView` はルート `[data-koyomi="resource"]` の境界幅（横スクロールを担う要素）です。境界寸法が無い環境では仮想化は無害に無効化され、全件描画へフォールバックします（開発ビルドで一度警告します）。
- フォーカス中のリソース（行・列）は、スクロールで可視窓の外に出ても DOM を保持し続けます（`VirtualListView` の pinned 日セクションと同じ方式）。`VirtualResourceView` は列見出し・終日セル・本文列の 3 箇所がまとめて保持されます。 pinned 状態の行・列に含まれるイベントボタン等の操作要素は `tabIndex={-1}` になりタブ順から外れます（窓内へ戻ると既定の `tabIndex` に戻ります。列見出し・行見出し自体はもともと操作対象ではないため対象外）。
- `ref` 経由で `scrollToResource(resourceId, options?)`（`resourceId` は未割り当てへは `null`、`options.align` は `'auto' | 'start' | 'center'`）を呼べます。
- `CalendarView` を使っている場合は、`<CalendarView virtualizeResource />` / `<CalendarView virtualizeTimeline />` でリソース・タイムラインビューだけを仮想化に切り替えられます。`renderResourceEvent` / `renderResourceAllDayItem` / `renderTimelineEvent` などの既存のカスタマイズ props はそのまま転送されます（`virtualizeList` と同じ方式）。

```tsx
const handleRef = useRef<VirtualTimelineViewHandle>(null);
// ...
<VirtualTimelineView ref={handleRef} />;
// ...
handleRef.current?.scrollToResource('crane-5');
```

## 複数タイムゾーン軸（timeAxisZones）

週/日ビュー（時間グリッド）の時間軸に、表示タイムゾーン以外の時間軸を並べて表示できます（Google カレンダーのセカンダリタイムゾーン相当）。`CalendarOptions.timeAxisZones` に IANA タイムゾーン ID の配列を渡すと、その順番で追加の軸が主軸（表示タイムゾーン）の右に並びます。省略時は主軸のみです。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'week',
    timeZone: 'Asia/Tokyo',
    timeAxisZones: ['America/New_York'],
  });

  return (
    <CalendarProvider value={calendar}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 時間軸に「東京の時刻」列と「NY の時刻」列の 2 本が並ぶ
// - 各軸の DOM には data-koyomi="time-axis" data-koyomi-timezone="<IANA タイムゾーン ID>" が付き、
//   どのタイムゾーンの軸かを CSS/テストから識別できる
// - 不正な IANA タイムゾーン ID を含めると Error になる（timeZone と同じ検証規則）
```

`buildTimeGridViewModel` の結果（`TimeGridViewModel.timeAxes`）は、先頭が主軸（`slots` と同内容）、以降が `timeAxisZones` の指定順の追加軸です。各追加軸のラベルは、表示範囲の最初の日を基準に主軸の現地時刻を維持した絶対時刻を算出し、それを追加軸のタイムゾーンへ変換して求めます。固定オフセットの加算ではなく実際のタイムゾーン変換のため、その日が追加軸側の DST 切替日であれば、切替前後でラベルのオフセットも正しく変わります。

ただし `TimeGridViewModel.timeAxes` は週全体で 1 組だけ（表示範囲の最初の日基準）を共有するため、`viewType: 'week'` で追加軸のタイムゾーンが表示範囲の途中に DST 切替を挟む場合、切替後の日については実際のオフセットとずれます（`TimeGridView` が単一の軸列しか描画しないための制約）。日ごとに正しいオフセットが必要な場合は各日の `TimeGridDay.timeAxes`（その日自身の 0:00 を基準に個別算出）を使ってください。

`timeAxisZones` 未指定時は `timeAxes`（`TimeGridViewModel` / 各 `TimeGridDay` とも）が主軸のみの 1 要素配列になります。

## 週番号（showWeekNumbers）

`CalendarOptions.showWeekNumbers`（既定 `false`）を `true` にすると、月ビューは各週行に、週ビューはヘッダー行に ISO 8601 週番号（月曜始まりで数える週番号）が表示されます。

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'month', showWeekNumbers: true });
  return (
    <CalendarProvider value={calendar}>
      <MonthView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 各週行（[data-koyomi="month-week"]）に data-koyomi-week-number="<週番号>" が付く
// - 週ビューでは [data-koyomi="timegrid-header"] に同じ属性が付く（日ビューには付かない）
```

週番号は表示タイムゾーン基準で、週内の木曜日を基準に算出します（ISO 8601 の規則どおり、その週の木曜日が属する年・週で数える）。`weekStartsOn`（週開始曜日）の値によらず、同じ 7 日間には常に同じ週番号が付きます。年をまたぐ週（例: 1 月上旬が前年の最終週になる、12 月下旬が翌年の第 1 週になる）も正しく計算されます。

なお、一意なのは「7 日間の週」に対する番号であって、週の区切り方自体は `weekStartsOn` に依存します。そのため同じ日付でも、週の区切りが変われば異なる番号の週の行に表示されることがあります（顕著なのは `weekStartsOn: 4`（木曜始まり）で、月曜始まりの ISO 週と区切りが大きくずれるため、例えば 2026-07-01 は他の週開始曜日では第 27 週の行に入るのに対し、木曜始まりでは第 26 週の行に入ります）。これは月曜週前提の ISO 週番号を任意区切りの週に割り当てることに固有の性質です。

`MonthWeek.weekNumber` / `TimeGridViewModel.weekNumber`（`viewType: 'day'` では常に `null`）としてビューモデルからも参照できます。属性のみを付与するヘッドレスな設計のため、実際に数字を表示するには CSS（`content: attr(data-koyomi-week-number)` 等）や `renderDayCell` 等のカスタム描画スロットを使ってください。`showWeekNumbers` 未指定時（既定）は `weekNumber` が常に `null` で、DOM 属性も出力されません。

複数月ビュー（MultiMonthView）は showWeekNumbers の対象外です。`buildMultiMonthViewModel` は showWeekNumbers を受け取らず内部の `buildMonthViewModel` 呼び出しにも渡さないため、`showWeekNumbers: true` を指定していても各月グリッドの `MonthWeek.weekNumber` は常に `null` のままで、`data-koyomi-week-number` 属性も出力されません。

## 営業時間（businessHours）

`CalendarOptions.businessHours`（既定 `[]`）に曜日・時間帯の指定を渡すと、週/日・リソース・タイムラインビューの該当する時間帯が営業時間内としてハイライトされます。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'week',
    businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 月〜金の 9:00〜18:00 のスロット（[data-koyomi="timegrid-slot"]）に
//   data-koyomi-business-hours="true" が付き、デフォルトテーマでは控えめな背景色になる
// - 土日、および平日でも 9:00 より前・18:00 以降のスロットには属性が付かない
```

`daysOfWeek` に該当する曜日について、`startTime`〜`endTime`（ともに `'HH:mm'` 形式）を営業時間として扱います（`endTime` は排他的。`startTime` ちょうどは営業時間内、`endTime` ちょうどは営業時間外）。`endTime` には日の終端を表す特例として `'24:00'` も指定できます（`startTime` には指定できません）。複数件を配列で渡すと OR 判定になるため、曜日ごとに異なる時間帯を指定できます。

```tsx
businessHours: [
  { daysOfWeek: [6], startTime: '10:00', endTime: '13:00' }, // 土曜だけ午前のみ
  { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }, // 平日
]
```

### 週/日ビュー（TimeGridView）

ハイライトの判定はスロット単位（各スロットの開始時刻が営業時間内かどうか）で行います。そのため `startTime` / `endTime` が `slotMinutes` の区切りに合っていない場合（例: `slotMinutes: 30` で `startTime: '09:15'`）、ハイライトは次のスロット境界（9:30）から始まります。スロットより細かい粒度の表現が必要な場合は、`TimeGridDay.businessHourSlots` を参照して独自に描画してください。

`TimeGridDay.businessHourSlots`（`slots` と同じ並びの `{ minutes, isBusinessHours }[]`）としてビューモデルからも参照できます。`businessHours` 未指定時（既定 `[]`）はすべてのスロットが `isBusinessHours: false` になり、DOM 属性も出力されません。`startTime` が `endTime` 以降、または `'HH:mm'` 形式でない値を指定すると `Error` になります。

`startTime` が `endTime` より前であることが必須のため、1 件の `BusinessHoursRule` で日をまたぐ営業時間（例: 22:00〜翌 2:00）を直接表現することはできません（指定すると Error になります）。日をまたぐ営業時間は、判定が曜日ごとの独立したスロット列で行われることを利用し、日をまたいで2件のルールに分けて指定します（初日側の `endTime` に `'24:00'` を使うと、日の終端まで途切れなくカバーできます）。

```tsx
businessHours: [
  { daysOfWeek: [2], startTime: '22:00', endTime: '24:00' }, // 火曜の遅い時間帯（日の終端まで）
  { daysOfWeek: [3], startTime: '00:00', endTime: '02:00' }, // 水曜の早い時間帯（火曜深夜からの続き）
]
```

### リソースビュー（ResourceView / VirtualResourceView）

リソースビューは表示日ごとにその日の曜日を基準に判定したスロット列（`ResourceViewDay.businessHourSlots`）を持ち、各列にはその列の日のものが適用されます（`ResourceViewModel.businessHourSlots` は先頭日の値です。既定の単日表示では全列共通の 1 本になります）。DOM 上は週/日ビューと同じ `[data-koyomi="timegrid-slot"][data-koyomi-business-hours]` が各列に描画され、デフォルトテーマの見た目も共通です。

### タイムラインビュー（TimelineView / VirtualTimelineView）

タイムラインは横軸が「表示分」（範囲先頭からの分、全日を等幅 1440 分として扱う座標系）のため、スロット単位ではなく区間そのものを描画します。表示日ごとに該当曜日のルールを日オフセット付きの表示分の区間へ変換し、隣接・重複する区間はマージしたうえで、各行の時間トラック内に `[data-koyomi="timeline-business-hours"]`（`aria-hidden`）という下敷きの帯を `insetInlineStart` / `width`（% 指定）で描画します。帯はイベントの帯（`timeline-item`）より背面に表示されます。

`TimelineViewModel.businessHourRanges`（`{ startMinutes, endMinutes }[]`、開始分昇順・マージ済み）としてビューモデルからも参照できます。`businessHours` 未指定時（既定 `[]`）は空配列になり、DOM 要素も描画されません。

## 表示時間帯（slotMinTime/slotMaxTime）

`CalendarOptions.slotMinTime`/`slotMaxTime`（ともに `'HH:mm'` 形式）で、週/日ビュー・リソースビューが表示する時間帯を制限できます。既定は `'00:00'`〜`'24:00'`（終日）です。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'week',
    slotMinTime: '07:00',
    slotMaxTime: '21:00',
  });
  return (
    <CalendarProvider value={calendar}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 時間軸の目盛りが 7:00〜21:00 の範囲のみになる
// - 7:00 より前・21:00 以降にしか存在しない予定は表示されない
// - 範囲の一部が 7:00〜21:00 に重なる予定はその部分だけが表示され、
//   はみ出す側は「←続く」「続く→」（continuesBefore/continuesAfter）で示される
// - ポインタでの作成・移動・リサイズ・終日⇔時間指定変換は 7:00〜21:00 の範囲内にクランプされる
//   （範囲外の領域自体が描画されないため）
// - 矢印キーによる移動・リサイズは範囲外へもそのまま移動できる（意図的な仕様。
//   実データの時刻は変更されるが、表示上は範囲外にクリップ/非表示になる）
```

`slotMaxTime` には 1 日の終わりを表す特例として `'24:00'` も指定できます。`slotMinTime` は `slotMaxTime` より前である必要があり、そうでない場合（`slotMinTime >= slotMaxTime`）は `Error` になります。日をまたぐ時間帯（例: 22:00〜翌 2:00）は表現できません。

`slotMinTime`/`slotMaxTime` が `slotMinutes` の倍数に整列していない場合、目盛りは `slotMinTime` ちょうどから開始し、次のスロット境界へスナップしません（`businessHours` のハイライトがスロット境界にスナップするのとは異なる挙動です）。

`TimeGridViewModel`/`ResourceViewModel` の `slotMinTimeMinutes`/`slotMaxTimeMinutes`（分換算の数値、既定では `0`/`1440`）としてビューモデルからも参照できます。表示時間帯の外に現在時刻がある場合、`nowIndicator`/`nowIndicatorMinutes` は `null` になります。

## 初期スクロール位置（initialScrollTime / scrollToTime）

週/日ビュー・リソースビューは、マウント時に一度だけ指定時刻の位置へスクロールする `initialScrollTime` prop を持ちます（`CalendarOptions` ではなく、`TimeGridView`/`ResourceView`/`VirtualResourceView` それぞれの props です）。表示時間帯制限（`slotMinTime`/`slotMaxTime`）とは独立して機能し、両方を併用できます。

```tsx
import { useRef } from 'react';
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { TimeGridViewHandle } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({ initialView: 'week' });
  const handleRef = useRef<TimeGridViewHandle>(null);

  return (
    <CalendarProvider value={calendar}>
      <TimeGridView ref={handleRef} initialScrollTime="09:00" />
      <button type="button" onClick={() => handleRef.current?.scrollToTime('13:00')}>
        13:00 へスクロール
      </button>
    </CalendarProvider>
  );
}

// 期待される動作:
// - マウント時に本体（[data-koyomi="timegrid-body"]）が 9:00 の位置へ一度だけスクロールする
// - initialScrollTime を事後に変更しても再適用されない（ref.current.scrollToTime を使う）
// - ボタンをクリックすると 13:00 の位置へスクロールする
```

`initialScrollTime`/`scrollToTime` の対象時刻が表示時間帯（`slotMinTime`/`slotMaxTime`）の範囲外の場合は最も近い境界へクランプされ、`'HH:mm'` として解析できない値を渡した場合は何もしません（例外を投げない防御的な既定動作）。`ref` 経由で取得できる `TimeGridViewHandle`/`ResourceViewHandle`/`VirtualResourceViewHandle` はいずれも `scrollToTime(time)` を持ちます。`CalendarView` 経由では `timeGridInitialScrollTime`/`resourceInitialScrollTime` prop で転送できます（`ref` の転送は行いません）。

## 宣言的な重なり・配置制約（eventOverlap / eventConstraint）

予定の重なりやドロップ先を宣言的に制限できます。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照してください。`eventConstraint: 'businessHours'` を指定すると、この節で説明した `businessHours` の範囲内にのみドロップを許可できます（`BusinessHoursRule` の配列を渡せば独自の範囲を指定することもできます）。

## タイムラインのズーム粒度（timelineScale）

`CalendarOptions.timelineScale`（既定 `'hour'`）でタイムラインビューの横軸の粒度を切り替えられます。表示分の座標系（`totalMinutes` 等）自体は変わらず、ヘッダー・目盛り・ドラッグのスナップ粒度だけが変わります。

```tsx
import { CalendarProvider, TimelineView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'timeline',
    timelineDays: 84,
    timelineScale: 'week',
    weekStartsOn: 0,
  });
  return (
    <CalendarProvider value={calendar}>
      <TimelineView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - ヘッダーが週単位のグループ見出し（[data-koyomi="timeline-group-header"]）＋
//   日番号の目盛りになる
// - ドラッグ・キーボードでの移動・リサイズが日単位スナップになる（±1日）
```

各値の内容:

- `'hour'` — 時刻目盛り（`slotMinutes` 間隔）。既定の挙動と同一
- `'day'` — 日単位。時刻目盛りは表示しない（`TimelineViewModel.slots` が常に空配列になる）
- `'week'` — 週単位のグループ見出し＋日番号の目盛り
- `'month'` — 月単位のグループ見出し＋日番号の目盛り

`'week'`/`'month'` では `TimelineViewModel.headerGroups`（`TimelineHeaderGroup[]`）にグループ一覧が入ります（`'hour'`/`'day'` では `null` で、`days` をそのままヘッダーに使います）。グループは表示範囲でクランプされるため、`timelineDays` が週/月境界と揃っていない場合は先頭・末尾が部分週・部分月になります。`'week'` のグループ境界は `weekStartsOn` に従います。`week`/`month` スケールを使う場合は `timelineDays` を粒度に見合った値（例: 週なら 84 日、月なら 180〜365 日）に設定することを推奨します（`timelineDays: 1` のまま指定してもエラーにはならず、部分グループが 1 件だけの見た目になります）。

`timelineScale` が `'hour'` 以外のとき、終日イベントに加えて時間指定イベントのドラッグ・キーボード操作も日単位スナップ（`daySnap`）になります。ドラッグ中に `updateOptions` で `timelineScale` を変更しても、進行中のセッションには反映されません（次回のドラッグから新しい設定が使われます）。

DOM 上はルート要素に `data-koyomi-scale="hour\|day\|week\|month"` が付き、CSS 変数 `--koyomi-timeline-slot-width`（既定 `96px`。`'hour'` 以外のときの 1 日分の幅）が既存の `--koyomi-timeline-day-width`（`'hour'` のときの 1 日分の幅）と役割分担します。詳細は [テーマとスタイリング](./theming.md) を参照してください。

## リソースの階層グルーピング（parentId・折りたたみ）

`CalendarResource.parentId` に親リソースの ID を指定すると、タイムラインビューでリソースを親子関係のツリーとして表示できます（任意の深さ）。リソースビューは常にフラットのまま変わりません。

```tsx
import { CalendarProvider, TimelineView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar({
    initialView: 'timeline',
    resources: [
      { id: 'site-a', title: '本社' },
      { id: 'floor-1', title: '1F', parentId: 'site-a' },
      { id: 'room-101', title: '会議室101', parentId: 'floor-1' },
    ],
  });
  return (
    <CalendarProvider value={calendar}>
      <TimelineView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「本社」の行に子を持つことを示す折りたたみボタン（▸）が表示される
// - ボタンをクリックすると「1F」「会議室101」の行が隠れ、再クリックで再表示される
// - 「1F」の行にも折りたたみボタンが表示される（子リソースを持つため）
```

参照先のない `parentId`・循環参照（自己参照を含む）は、そのリソースを孤立したルート（深さ 0）として扱います（対象リソースが表示から欠落することはありません）。未割り当て行はツリーの対象外で、常に末尾に表示されます。

折りたたみ状態は `CalendarState.collapsedResourceIds`（`ReadonlySet<string>`）で保持し、`CalendarApi.toggleResourceCollapsed(resourceId)` でトグルします。初期状態で折りたたむリソースは `CalendarOptions.initialCollapsedResourceIds`（作成時のみ有効）で指定できます。

```ts
calendar.api.toggleResourceCollapsed('site-a'); // 「本社」を折りたたむ
calendar.api.toggleResourceCollapsed('site-a'); // 再度呼ぶと展開に戻る
```

祖父母を折りたたむと、その子・孫の行が一括で非表示になります（各行自身の折りたたみ状態は保持されるため、祖父母を再展開すると、以前個別に折りたたんでいた子の行は非表示のまま復元されます）。折りたたみで非表示になった行は、`↑`/`↓` でのリソース間移動・仮想化（`VirtualTimelineView`）・`scrollToResource` からも「存在しない行」として扱われます（詳細は [インタラクション](./interactions.md) を参照）。

折りたたみボタンの `aria-label`（既定は「〈リソース名〉を折りたたむ」/「〈リソース名〉を展開する」）は `CalendarProvider` の `messages` prop（`messages.timeline.resourceToggleAriaLabel`）でカスタマイズできます。DOM 上は `button[data-koyomi="timeline-row-toggle"][aria-expanded]` が子を持つ行にのみ描画され、行見出しには階層の深さを示す `data-koyomi-depth` 属性が付きます（詳細は [テーマとスタイリング](./theming.md) を参照）。

## 関連ページ

- [はじめに](./getting-started.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [アクセシビリティ](./accessibility.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [カスタマイズガイド](./customization.md)
- [API リファレンス](./api.md)
