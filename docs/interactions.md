# インタラクション（作成・移動・リサイズ）

クリック・ドラッグ・キーボードによる予定の作成・移動・リサイズと、それらに紐づくコールバックについて説明します。Koyomi はダイアログやポップアップなどの UI を提供しないヘッドレスライブラリなので、確定後の見た目（作成ダイアログや詳細パネルなど）はここで説明するコールバックを起点にアプリケーション側で実装します。

## クリック・ドラッグでの予定作成

空き領域のクリック・ドラッグで範囲が選択されると `onSelectRange` が呼ばれます。**省略した場合**は既定動作として、`'(タイトルなし)'` というタイトルの予定がその場で即時作成されます（`createEvent` 相当）。

コールバックには `RangeSelection` が渡されます。

- `range`（`DateRange`） — 選択された日時範囲（`end` は排他的）
- `allDay`（`boolean`） — 終日枠（月ビューのセル・終日行）での選択なら `true`

### 時間グリッド（週/日ビュー）

- **範囲ドラッグ** — ドラッグした始点〜終点がそのまま選択範囲になる（`snapMinutes` 単位でスナップ）
- **クリックのみ（移動なし）** — `defaultEventMinutes` 分の長さの範囲になる

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi/react';
import type { RangeSelection } from '@koyomi/react';

function App() {
  const calendar = useCalendar({ initialView: 'week', defaultEventMinutes: 30 });

  function handleSelectRange(selection: RangeSelection) {
    // ここでダイアログを開く、または直接 API で作成する
    calendar.api.createEvent({
      title: '新しい予定',
      start: selection.range.start,
      end: selection.range.end,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 10:00 から 11:00 まで範囲ドラッグすると
//   handleSelectRange({ range: { start: 10:00, end: 11:00 }, allDay: false }) が呼ばれる
// - ドラッグせずクリックだけした場合は、defaultEventMinutes（ここでは30分）の
//   長さの範囲（例: 10:00 なら { start: 10:00, end: 10:30 }）で呼ばれる
// - onSelectRange を指定すると、既定の即時作成は行われない
```

### 月ビュー・終日行

月ビューの日セル、および週/日ビューの終日行は**日単位**のドラッグになります。1 日だけクリックした場合も、2 日以上にまたがってドラッグした場合も、その日範囲がそのまま選択され、`selection.allDay` は常に `true` になります。

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi/react';
import type { RangeSelection } from '@koyomi/react';

function App() {
  const calendar = useCalendar({ initialView: 'month' });

  function handleSelectRange(selection: RangeSelection) {
    calendar.api.createEvent({
      title: '新しい予定',
      start: selection.range.start,
      end: selection.range.end,
      allDay: selection.allDay,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <MonthView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 日セルをドラッグして離すと handleSelectRange が呼ばれ、selection.allDay は true になる
// - onSelectRange を省略した場合は、既定動作として終日イベントがその場で即時作成される
```

## ドラッグ移動・リサイズ

予定本体をドラッグすると**移動**、時間グリッドの予定下端のハンドルをドラッグすると**リサイズ**（終了時刻の変更）になります。移動・リサイズが確定すると、ライブラリが変更を適用したうえで `onEventChange` を呼びます。

- **移動** — 時間グリッドでは列をまたいだ移動が可能（`snapMinutes` 単位でスナップ）。月ビュー・終日行では日単位の移動になり、期間と壁時計時刻（時間指定イベントの場合）が維持される
- **リサイズ** — 時間グリッドの予定にのみ下端のハンドルがあり、終了時刻を変更できる。最小でも `snapMinutes` 分の長さが保たれる
- **`editable: false`** — 表示・クリックは通常どおりできるが、移動・リサイズは無効になる。時間グリッドではリサイズハンドル自体が描画されない

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi/react';
import type { CalendarEvent, EventChange } from '@koyomi/react';

const events: CalendarEvent[] = [
  { id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
  // editable: false の予定は表示・クリックのみ可能。ドラッグでは動かせない
  { id: '2', title: '固定の予定', start: '2026-07-15T13:00', end: '2026-07-15T14:00', editable: false },
];

function App() {
  const calendar = useCalendar({ initialView: 'week', events });

  function handleEventChange(change: EventChange) {
    // change.occurrence: 変更対象の発生
    // change.newRange: 変更後の日時範囲
    // change.scope: 繰り返し予定に適用したスコープ（単発なら null）
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onEventChange: handleEventChange }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「会議」をドラッグして移動すると、移動後の範囲で calendar.api.getEvents() が更新され、
//   handleEventChange({ occurrence, newRange, allDay: false, scope: null }) が呼ばれる
// - 下端のハンドルをドラッグすると終了時刻だけが変わる（開始時刻は固定）
// - 「固定の予定」はドラッグしても位置が変わらず、リサイズハンドルも描画されない
```

`onEventChange` はドラッグ操作（`useDayDrag` / `useTimeGridDrag`、およびそれらを内部で使うビルトインコンポーネント）による移動・リサイズが確定したときにのみ呼ばれます。`calendar.api.updateEvent(...)` を直接呼んだ場合は呼ばれません。

## 繰り返し予定の操作時のスコープ解決

繰り返し予定を移動・リサイズ・削除・更新しようとすると、`resolveRecurringScope(occurrence, action)` が呼ばれ、Google カレンダーの「この予定のみ / これ以降のすべての予定 / すべての予定」に相当する適用範囲を問い合わせます。`action` は `'move' | 'resize' | 'delete' | 'update'`、戻り値は `Promise<RecurringEditScope | null>` です。

- 戻り値が `'this'` / `'thisAndFollowing'` / `'all'` — その範囲で変更が適用される
- 戻り値が `null` — 操作全体がキャンセルされ、予定は変更されない
- **省略時**は常に `'this'`（この予定のみ）として扱われる

実際のアプリではダイアログを表示し、ユーザーの選択で `resolve` するのが典型的な実装です。ここでは実装を簡略化し、常に同じ値を返す例で挙動を示します。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi/react';
import type { RecurringEditScope } from '@koyomi/react';

// 実際にはここでダイアログを表示し、ユーザーの選択で resolve する。
// （この例では簡略化のため、常に「これ以降のすべての予定」を選んだことにする）
async function resolveRecurringScope(): Promise<RecurringEditScope | null> {
  return 'thisAndFollowing';
}

function App() {
  const calendar = useCalendar({ initialView: 'week' });
  return (
    <CalendarProvider value={calendar} callbacks={{ resolveRecurringScope }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 繰り返し予定をドラッグで移動しようとすると resolveRecurringScope(occurrence, 'move') が呼ばれる
// - 'thisAndFollowing' が返るとその発生以降に対して変更が適用され、
//   calendar.api.getEvents() の件数が変化する（繰り返し元の打ち切りと新規イベントの追加）
```

ダイアログでキャンセルされた場合は `null` を返します。この場合、ドラッグは確定されず `calendar.api.getEvents()` は操作前と同じ内容のまま変わりません。

```ts
async function resolveRecurringScope(): Promise<RecurringEditScope | null> {
  return null; // ユーザーがダイアログをキャンセルした場合
}

// 期待される動作:
// - 繰り返し予定をドラッグで移動しようとしても変更は適用されない
// - calendar.api.getEvents() は操作前と同じ内容のまま変わらない
```

適用結果（`rrule` の打ち切りや例外イベントの追加など）の詳細は [繰り返し予定](./recurrence.md) を参照してください。

## コールバックのまとめ

| コールバック | 呼ばれるタイミング | 省略時の既定動作 |
| --- | --- | --- |
| `onSelectRange` | 空き領域のクリック・ドラッグで範囲選択が確定したとき | `'(タイトルなし)'` で即時作成する |
| `onEventClick` | 予定がクリック、または Enter・Space で選択されたとき | 何もしない |
| `onEventChange` | ドラッグによる移動・リサイズが確定し、変更が適用された後 | （通知のみ。変更の適用自体は常にライブラリが行う） |
| `resolveRecurringScope` | 繰り返し予定の移動・リサイズ・削除・更新の適用範囲を決めるとき | 常に `'this'`（この予定のみ） |
| `onOverflowClick` | 月ビューの「+N 件」がクリックされたとき | その日の日ビューに切り替える |

## キーボードショートカット

`useCalendarShortcuts` を使うと、Google カレンダー準拠のキーボードショートカットが有効になります。`document` への `keydown` を監視するため、`CalendarProvider` の外でも（コンポーネントツリーのどこでも）呼び出せます。

```tsx
import { useCalendar, useCalendarShortcuts } from '@koyomi/react';

function App() {
  const calendar = useCalendar();
  useCalendarShortcuts({
    calendar,
    onCreate: () => {
      // C キーで呼ばれる。作成ダイアログを開くなど
    },
  });
  return <div>{calendar.state.view}</div>;
}

// 期待される動作:
// - W キーを押すと calendar.state.view が 'week' になる
// - C キーを押すと onCreate が呼ばれる
// - <input> にフォーカスがある状態で W キーを押しても view は変わらない
```

| キー | 動作 |
| --- | --- |
| `M` | 月ビューに切り替え |
| `W` | 週ビューに切り替え |
| `D` | 日ビューに切り替え |
| `A` | リストビューに切り替え |
| `T` | 今日へ移動 |
| `J` または `N` | 次の期間へ移動 |
| `K` または `P` | 前の期間へ移動 |
| `C` | `onCreate` コールバックを呼ぶ（作成 UI の起点） |

大文字・小文字は区別しません。`Ctrl` / `Cmd` / `Alt` などの修飾キーを伴う場合は無視されます。`input` / `textarea` / `select` にフォーカスがある間、および `contenteditable` 要素の内側では、すべてのショートカットが無効になります。`enabled: false` を渡すと一時的に無効化できます。

なお、月・週/日ビューの予定要素自体にもキーボード操作があります。フォーカスした状態で Enter または Space を押すと `onEventClick` 相当のクリックになり、Delete または Backspace を押すとその発生を削除します（繰り返し予定の場合は上記の `resolveRecurringScope` が呼ばれます）。リストビューの予定行は Enter・Space によるクリックのみに対応します。

## Escape でのドラッグキャンセル

作成・移動・リサイズのドラッグ中に `Escape` キーを押すと、その場でドラッグが取り消されます。変更は一切適用されず、`onSelectRange` / `onEventChange` も呼ばれません。この挙動は `useDayDrag` / `useTimeGridDrag`（およびそれらを使うビルトインコンポーネント）に組み込まれており、追加の設定は不要です。

## 自前 UI を作る上級編

ビルトインコンポーネントを使わず、自前の要素にドラッグ操作を組み込みたい場合は `useDayDrag` / `useTimeGridDrag` をプロップゲッターとして使います。戻り値の `get*Props` 関数が返すオブジェクトを対象の要素にスプレッドするだけで、ポインタ操作からプレビュー計算・確定・繰り返しのスコープ解決までをフックが担います。

### useDayDrag（日単位: 月ビュー・終日行相当）

`useDayDrag({ calendar, callbacks })` は次を返します。

- `getDayCellProps(day)` — 日セル用の props（`ref` / `onPointerDown` / `data-koyomi-date`）。空きセルでの作成ドラッグを開始する
- `getSegmentProps(segment)` — 帯セグメント用の props（`onPointerDown` / `onClick` / `onKeyDown` / `tabIndex` / `data-koyomi-occurrence` / ドラッグ中なら `data-koyomi-dragging`）。移動ドラッグ・クリック・キーボード操作を担う
- `previewRange` — 現在のドラッグプレビューの日範囲（非ドラッグ中は `null`）
- `isDragging` — ドラッグ操作が進行中か

`getDayCellProps` の `ref` はコールバック形式で、要素をポインタ位置 → 日の判定に使う内部レジストリへ登録します。複数日にまたがるドラッグを正しく機能させるには、返された `ref` を実際の要素に接続する必要があります。

```tsx
import { useCalendar, useDayDrag } from '@koyomi/react';
import type { RangeSelection } from '@koyomi/react';

function CustomDayRow() {
  const calendar = useCalendar({ initialView: 'month' });
  const dayDrag = useDayDrag({
    calendar,
    callbacks: {
      onSelectRange: (selection: RangeSelection) => {
        // selection.allDay は常に true
      },
    },
  });
  if (calendar.viewModel.type !== 'month') return null;
  const days = calendar.viewModel.weeks[0]?.days ?? [];

  return (
    <div>
      {days.map((day) => {
        const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
        return (
          <div
            key={day.key}
            {...cellProps}
            ref={(element: HTMLDivElement | null) => {
              if (typeof ref === 'function') ref(element);
            }}
          />
        );
      })}
    </div>
  );
}

// 期待される動作:
// - 1 マス目から 3 マス目までドラッグすると、3 日分の範囲（end は排他的）で
//   onSelectRange が allDay: true で呼ばれる
```

### useTimeGridDrag（時間グリッド: 週/日ビュー相当）

`useTimeGridDrag({ calendar, callbacks })` は次を返します。

- `getDayProps(day)` — 日列用の props（`ref` / `onPointerDown` / `data-koyomi-date`）。空き領域での作成ドラッグを開始する
- `getEventProps(item)` — イベントブロック用の props（`onPointerDown` / `onClick` / `onKeyDown` / `tabIndex` / `data-koyomi-occurrence` / ドラッグ中なら `data-koyomi-dragging`）。移動ドラッグ・クリック・キーボード操作を担う
- `getResizeHandleProps(item)` — リサイズハンドル用の props（`onPointerDown` / `onClick` / `data-koyomi-resize-handle`）
- `previewFor(day)` — 指定日のドラッグプレビュー区間（`{ kind, startMinutes, endMinutes }`。その日に重ならなければ `null`）
- `isDragging` — ドラッグ操作が進行中か

いずれの `get*Props` も、対象の要素（`<div>` や `<button>` など）にそのままスプレッドして使います。`ref` はコールバック形式で、要素の矩形（`getBoundingClientRect`）からポインタ位置に対応する日時を計算するための内部レジストリに登録されます。

## 関連ページ

- [ビュー（月・週・日・リスト）](./views.md)
- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
