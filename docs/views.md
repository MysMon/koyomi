# ビュー（月・週・日・リスト）

Koyomi は月・週・日・リスト（スケジュール）の 4 つのビューを切り替えて表示できます。本ページでは各ビューの画面構成、切り替え方法、ナビゲーション、そしてビューモデルを直接使った上級的な使い方を説明します。

## 4 つのビュー

### 月ビュー（month）

`MonthView` が描画します。曜日の見出し行の下に、月によって 4〜6 週の行が並びます（Google カレンダーと同様、週数は月ごとに変わる動的な行数です）。各日セルには日番号のボタンがあり、クリックするとその日の日ビューに切り替わります。予定は週内に「帯」（セグメント）として重ならないよう配置され、`dayMaxEvents`（既定 `4`）を超える分はその日の「+N 件」ボタンに集約されます。

### 週/日ビュー（week / day）

`TimeGridView` が描画します。上部に日ヘッダー（曜日と日番号のボタン）、その下に終日イベント行、本体には時間軸（`slotMinutes` 間隔の目盛り）と日列が並びます。日列には時間指定の予定がブロックとして配置され、下端にリサイズ用のハンドルがあります。表示範囲に「今日」が含まれる場合は現在時刻を示す線も表示されます。`week` は 7 日分、`day` は 1 日分の列になります。

### リストビュー（list）

`ListView` が描画します。予定がある日だけを対象に、日付ごとのセクションとして一覧表示します（Google カレンダーの「スケジュール」表示相当）。各セクションには日付の見出しと予定の行（時刻ラベル・色見本・タイトル）が並びます。表示範囲（`listDays` 日分、既定 `30`）に予定が 1 件もない場合は空状態のメッセージを表示します。月・週・日ビューと異なり、リストビューにドラッグ操作はありません。

いずれのビューも、既定の見た目を使うには `@koyomi/react/theme.css` を読み込みます。DOM 構造や CSS でのカスタマイズ方法は [テーマとスタイリング](./theming.md) を参照してください。

## ビューの切り替え

ビューは次の 3 通りで切り替えられます。

1. `Toolbar` のビュー切替ボタン（月・週・日・リスト）
2. `calendar.api.setView(view)` を直接呼ぶ
3. `useCalendarShortcuts` によるキーボード操作（`M` / `W` / `D` / `A`。詳細は [インタラクション](./interactions.md) を参照）

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi/react';
import '@koyomi/react/theme.css';

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
import { CalendarProvider, CalendarView, useCalendar, useCalendarShortcuts } from '@koyomi/react';
import '@koyomi/react/theme.css';

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

```ts
import { createCalendar } from '@koyomi/react';

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
//   list ビューでは ±listDays 日（既定 30）で currentDate（および getVisibleRange()）が動く
```

## ビューモデルを直接使う（上級編）

`calendar.api.getViewModel()`（React では `useCalendar()` の戻り値の `viewModel`）は、現在のビューに対応する描画用データを返します。型は `CalendarViewModel = MonthViewModel | TimeGridViewModel | ListViewModel` で、`type` フィールドにより判別できる判別共用体です。

| 型 | `type` | 主なフィールド |
| --- | --- | --- |
| `MonthViewModel` | `'month'` | `anchor`（表示対象月の1日）、`weeks`（`MonthWeek[]`、4〜6件）、`weekdays`（曜日の並び） |
| `TimeGridViewModel` | `'timeGrid'` | `viewType`（`'week' \| 'day'`）、`days`（`TimeGridDay[]`）、`allDaySegments` / `allDayLaneCount`（終日行）、`slots`（時間軸の目盛り）、`nowIndicator`（現在時刻線の位置、対象日がなければ `null`） |
| `ListViewModel` | `'list'` | `days`（予定がある日だけの `ListDay[]`）、`isEmpty` |

`MonthWeek.days` は `MonthDay[]`（各日の `date` / `key` / `inCurrentMonth` / `isToday` / `overflowCount` など）、`TimeGridDay.items` は `PositionedOccurrence[]`（`startMinutes` / `endMinutes` / `left` / `width` など割合ベースの配置情報）を持ちます。詳細なフィールドは各型の TSDoc を参照してください。

`type` で分岐すれば、ビューごとの情報を型安全に扱えます。

```ts
import type { CalendarViewModel } from '@koyomi/react';

function describeViewModel(viewModel: CalendarViewModel): string {
  switch (viewModel.type) {
    case 'month':
      return `月ビュー: ${viewModel.weeks.length} 週`;
    case 'timeGrid':
      return `${viewModel.viewType}ビュー: ${viewModel.days.length} 日`;
    case 'list':
      return `リストビュー: ${viewModel.days.length} 日に予定あり`;
  }
}

// 期待される動作:
// - initialView: 'week' の calendar.viewModel を渡すと 'weekビュー: 7 日' を返す
```

ビルトインコンポーネント（`MonthView` など）を使わず、ビューモデルから直接マークアップを組み立てることもできます。

```tsx
import { useCalendar } from '@koyomi/react';

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
// - 各週は必ず 7 日（week.days.length === 7）
// - 2026年7月（週開始が既定の日曜）は 5 週になる
```

ドラッグ操作などのインタラクションを自前の要素に組み込みたい場合は、ビューモデルに加えて `useDayDrag` / `useTimeGridDrag` のプロップゲッターを使います。詳しくは [インタラクション: 自前 UI を作る上級編](./interactions.md#自前-ui-を作る上級編) を参照してください。

## 関連オプション

`useCalendar` / `createCalendar` に渡す `CalendarOptions` のうち、ビュー表示に関わる主なものです。

| オプション | 型 | 既定値 | 影響 |
| --- | --- | --- | --- |
| `weekStartsOn` | `Weekday`（`0`〜`6`、`0` = 日曜） | `0` | 月ビューの週の並び、週ビューの開始曜日、ナビゲーションの起点 |
| `dayMaxEvents` | `number` | `4` | 月ビューで 1 日に表示する予定の最大数。超過分は「+N 件」に集約される |
| `slotMinutes` | `number` | `60` | 週/日ビュー（時間グリッド）の時間軸の目盛り間隔（分） |
| `listDays` | `number` | `30` | リストビューが表示する日数。`next()`/`prev()` の移動単位にもなる |

## 関連ページ

- [はじめに](./getting-started.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
