# インタラクション（作成・移動・リサイズ）

クリック・ドラッグ・キーボードによる予定の作成・移動・リサイズと、それらに紐づくコールバックについて説明します。Koyomi はダイアログやポップアップなどの UI を提供しないヘッドレスライブラリなので、確定後の見た目（作成ダイアログや詳細パネルなど）はここで説明するコールバックを起点にアプリケーション側で実装します。

## クリック・ドラッグでの予定作成

空き領域のクリック・ドラッグで範囲が選択されると `onSelectRange` が呼ばれます。**省略した場合**は既定動作として、`defaultEventTitle` オプション（既定 `'(タイトルなし)'`）のタイトルの予定がその場で即時作成されます（`createEvent` 相当）。

コールバックには `RangeSelection` が渡されます。

- `range`（`DateRange`） — 選択された日時範囲（`end` は排他的）
- `allDay`（`boolean`） — 終日枠（月ビューのセル・終日行）での選択なら `true`

### 時間グリッド（週/日ビュー）

- **範囲ドラッグ** — ドラッグした始点〜終点がそのまま選択範囲になる（`snapMinutes` 単位でスナップ）
- **クリックのみ（移動なし）** — `defaultEventMinutes` 分の長さの範囲になる

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

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
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

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

予定本体をドラッグすると**移動**、ハンドルをドラッグすると**リサイズ**になります。移動・リサイズが確定すると、ライブラリが変更を適用したうえで `onEventChange` を呼びます。

- **移動** — 時間グリッドでは列をまたいだ移動が可能（`snapMinutes` 単位でスナップ）。月ビュー・終日行では日単位の移動になり、期間と現地時刻（時間指定イベントの場合）が維持される
- **リサイズ（時間グリッド）** — 予定の**下端**ハンドルで終了時刻、**上端**ハンドルで開始時刻を変更できる。いずれも最小 `snapMinutes` 分の長さが保たれる。日をまたいで表示が分割されている場合、分割された端（`continuesBefore` / `continuesAfter`）にはハンドルが出ない
- **リサイズ（月ビュー・終日行の帯）** — 帯セグメントの**左右端**ハンドルで開始日・終了日を日単位で変更できる。最低 1 日分の長さが保たれ、時間指定の複数日イベントでは現地時刻を維持したまま日数だけが変わる
- **終日 ⇔ 時間指定の変換** — 週/日ビューで、時間指定の予定を上部の終日行までドラッグすると**終日イベントに変換**され、終日行の予定を時間グリッドへドラッグすると**時間指定イベント**（ドロップ位置の時刻から `defaultEventMinutes` 分）**に変換**されます（Google カレンダーと同じ操作感）
- **`editable: false`** — 表示・クリックは通常どおりできるが、移動・リサイズ・**キーボードでの削除（Delete/Backspace）**はすべて無効になる。リサイズハンドル自体が描画されない
- **タッチデバイス** — デフォルトテーマがドラッグ起点の要素に `touch-action: none` を設定しているため、ドラッグがスクロールに奪われません。独自 CSS でテーマを構築する場合は同様の設定が必要です（[テーマとスタイリング](./theming.md) 参照）。ブラウザがポインタを中断した場合（`pointercancel`）はドラッグが安全にキャンセルされます
- **オートスクロール** — 時間グリッドの縦スクロール領域では、ドラッグ中にポインタが上下端へ近づくと自動でスクロールします

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent, EventChange } from '@koyomi-cal/react';

const events: CalendarEvent[] = [
  { id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
  // editable: false の予定は表示・クリックのみ可能。ドラッグでは動かせない
  { id: '2', title: '固定の予定', start: '2026-07-15T13:00', end: '2026-07-15T14:00', editable: false },
];

function App() {
  const calendar = useCalendar({ initialView: 'week', events });

  function handleEventChange(change: EventChange) {
    // change.occurrence: 変更対象のオカレンス
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

## リソースビュー・タイムラインビューのドラッグ操作

リソースビュー（`useResourceGridDrag`）・タイムラインビュー（`useTimelineDrag`）は、時間の変更に加えて**リソース間の移動**をドラッグで行えます。それぞれ次の 2 軸を同時に扱います。

| ビュー | 時間の軸 | リソースの軸 |
| --- | --- | --- |
| リソースビュー | 縦（列内の上下） | 横（列＝リソース） |
| タイムラインビュー | 横（行内の左右） | 縦（行＝リソース） |

- **移動** — ドラッグした先の時間とリソースの両方が同時に変わります。確定時は、時間の変更と `resourceId` の変更を**1 つのパッチに合成した 1 回の `updateEvent`** として適用します（`onEventChange` には合成後の `resourceId` 付きの `EventChange` が渡されます）。リソースだけが変わり時間が変わらない操作（列/行をまたぐだけの移動）も同じ経路です
- **リサイズ** — 時間のみが変わり、リソースは不変です（既存の時間グリッドと同じ規則）
- **未割り当てへの移動** — 未割り当てレーン（`resource: null`）へ移動すると `{ resourceId: undefined }` のパッチが発行されます（`CalendarEventPatch` の削除セマンティクスに従い、`resourceId` フィールドが削除されます）。未割り当てレーンが存在しない場合（`unassignedLane: 'auto'` で未割り当ての予定が 1 件も無いとき）はドロップ先が無いため、この操作はできません。運用したい場合は `unassignedLane: 'always'` を指定してください（詳細は [ビュー](./views.md#年ビューなど新ビューを有効にするopt-in) を参照）
- **既定作成（`onSelectRange` 未指定時の即時作成）** — 選択したレーンの `resourceId` が `createEvent` の入力に含まれます（未割り当てレーンでは `resourceId` を付けません）
- **終日行/終日の帯** — リソースビューの終日行はクリックで当日 1 日分の終日イベントを作成でき、ドラッグで列間（リソース間）の移動ができます（リサイズはありません）。タイムラインの終日の帯は日単位スナップで横移動できます
- **allDay ⇔ 時間指定の変換** — 週/日ビューにあるような越境変換ドラッグは、リソース/タイムラインビューでは提供しません
- 繰り返し予定は既存の `resolveRecurringScope` フロー（下記）にそのまま乗ります（リソース移動も this / thisAndFollowing / all の選択対象）

**予定要素にフォーカスした状態（リソース/タイムラインビュー）:**

| キー | リソースビュー | タイムラインビュー |
| --- | --- | --- |
| `Enter` / `Space` | `onEventClick` 相当のクリック | 同左 |
| `Delete` / `Backspace` | オカレンスを削除（繰り返しはスコープ解決） | 同左 |
| `↑` / `↓` | ∓/± `snapMinutes` 分の移動（時間の軸） | 隣の行（リソース）への移動 |
| `←` / `→` | 隣のリソース列への移動 | ∓/± `snapMinutes` 分の移動（時間の軸。終日の帯は ∓/± 1 日） |
| `Shift+↑` / `Shift+↓` | 終了時刻を ∓/± `snapMinutes` 分リサイズ | — |
| `Shift+←` / `Shift+→` | — | 終了時刻を ∓/± `snapMinutes` 分リサイズ |

矢印キーの割当は「画面上でその方向に動く」という既存ビューと同じ原則に従います。リソースビューは列＝リソースなので `←`/`→` が列移動、タイムラインビューは行＝リソースなので `↑`/`↓` が行移動になり、ビューごとに軸が入れ替わりますが、いずれも視覚的な配置と一致する割当です。

## 繰り返し予定の操作時のスコープ解決

繰り返し予定を移動・リサイズ・削除・更新しようとすると、`resolveRecurringScope(occurrence, action)` が呼ばれ、Google カレンダーの「この予定のみ / これ以降のすべての予定 / すべての予定」に相当する適用範囲を問い合わせます。`action` は `'move' | 'resize' | 'delete' | 'update'`、戻り値は `Promise<RecurringEditScope | null>` です。

- 戻り値が `'this'` / `'thisAndFollowing'` / `'all'` — その範囲で変更が適用される
- 戻り値が `null` — 操作全体がキャンセルされ、予定は変更されない
- **省略時**は常に `'this'`（この予定のみ）として扱われる

実際のアプリではダイアログを表示し、ユーザーの選択で `resolve` するのが典型的な実装です。ここでは実装を簡略化し、常に同じ値を返す例で挙動を示します。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { RecurringEditScope } from '@koyomi-cal/react';

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
// - 'thisAndFollowing' が返るとそのオカレンス以降に対して変更が適用され、
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
| `onSelectRange` | 空き領域のクリック・ドラッグで範囲選択が確定したとき | `defaultEventTitle`（既定 `'(タイトルなし)'`）で即時作成する |
| `onEventClick` | 予定がクリック、または Enter・Space で選択されたとき | 何もしない |
| `onEventChange` | ドラッグ・キーボードによる移動・リサイズが確定し、変更が適用された後 | （通知のみ。変更の適用自体は常にライブラリが行う） |
| `onEventDelete` | キーボード（Delete/Backspace）による削除が適用された後 | （通知のみ。undo UI やトーストの起点に使える） |
| `onError` | インタラクション中の非同期処理（スコープ解決や適用）が例外を投げたとき | `console.error` に出力する |
| `resolveRecurringScope` | 繰り返し予定の移動・リサイズ・削除・更新の適用範囲を決めるとき | 常に `'this'`（この予定のみ） |
| `onOverflowClick` | 月ビューの「+N 件」がクリックされたとき。第 2 引数で非表示のオカレンス一覧（`hiddenOccurrences`）を受け取れる | その日の日ビューに切り替える |

## キーボードショートカット

`useCalendarShortcuts` を使うと、Google カレンダー準拠のキーボードショートカットが有効になります。`document` への `keydown` を監視するため、`CalendarProvider` の外でも（コンポーネントツリーのどこでも）呼び出せます。

```tsx
import { useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';

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
| `Y` | 年ビューに切り替え（`views` オプションに `'year'` を含めた場合のみ。既定では無効） |
| `Q` | 複数月ビューに切り替え（`views` オプションに `'multiMonth'` を含めた場合のみ。既定では無効） |
| `R` | リソースビューに切り替え（`views` オプションに `'resource'` を含めた場合のみ。既定では無効） |
| `L` | タイムラインビューに切り替え（`views` オプションに `'timeline'` を含めた場合のみ。既定では無効。`timeline` の頭文字 `T` は「今日」と衝突するため語中の `L` を使う） |
| `T` | 今日へ移動 |
| `J` または `N` | 次の期間へ移動 |
| `K` または `P` | 前の期間へ移動 |
| `C` | `onCreate` コールバックを呼ぶ（作成 UI の起点） |

大文字・小文字は区別しません。`Ctrl` / `Cmd` / `Alt` などの修飾キーを伴う場合は無視されます。`input` / `textarea` / `select` にフォーカスがある間、および `contenteditable` 要素の内側では、すべてのショートカットが無効になります。`enabled: false` を渡すと一時的に無効化できます。

新ビュー（年・複数月・リソース・タイムラインビュー等）への切替キーは既定では無効です。`views` オプション（既定 `['month', 'week', 'day', 'list']`）に対象のビューを追加すると、そのビューへの切替キーだけが有効になります（`Toolbar` の `views` prop と同じ opt-in 方針。詳細は [ビュー](./views.md#年ビューなど新ビューを有効にするopt-in) を参照）。

```tsx
useCalendarShortcuts({
  calendar,
  views: ['month', 'week', 'day', 'list', 'year', 'multiMonth', 'resource', 'timeline'],
});

// 期待される動作:
// - Y キーを押すと calendar.state.view が 'year' に、Q キーを押すと 'multiMonth' になる
// - R キーを押すと 'resource' に、L キーを押すと 'timeline' になる
// - views に対象のビューを含めない場合、そのビューへの切替キーを押しても view は変わらない
//   （既存 M/W/D/A/T の挙動は不変）
```

## キーボードのみでの予定操作

マウスを使わなくても、予定と日セルへのフォーカスだけで一通りの操作ができます（`editable: false` の予定では移動・リサイズ・削除は無効です）。

**予定要素にフォーカスした状態:**

| キー | 時間グリッド（週/日） | 月ビュー・終日行の帯 |
| --- | --- | --- |
| `Enter` / `Space` | `onEventClick` 相当のクリック | 同左 |
| `Delete` / `Backspace` | オカレンスを削除（繰り返しはスコープ解決） | 同左 |
| `↑` / `↓` | ∓/± `snapMinutes` 分の移動 | ∓/± 7 日（1 週間）の移動 |
| `←` / `→` | ∓/± 1 日の移動 | ∓/± 1 日の移動 |
| `Shift+↑` / `Shift+↓` | 終了時刻を ∓/± `snapMinutes` 分リサイズ | — |
| `Shift+←` / `Shift+→` | — | 終了日を ∓/± 1 日リサイズ |

移動・リサイズは最小長（時間グリッドは `snapMinutes` 分、帯は 1 日）を下回る操作を無視します。繰り返し予定では `resolveRecurringScope` が呼ばれ、適用後に `onEventChange`（削除は `onEventDelete`）が通知されます。

**日セルにフォーカスした状態（月ビュー・終日行）:** `Enter` または `Space` でその日 1 日分の範囲選択（`onSelectRange`、`allDay: true`）が発火します。リストビューの予定行は Enter・Space によるクリックのみに対応します。

## Escape / pointercancel でのドラッグキャンセル

作成・移動・リサイズのドラッグ中に `Escape` キーを押すと、その場でドラッグが取り消されます。変更は一切適用されず、`onSelectRange` / `onEventChange` も呼ばれません（キャンセル直後にブラウザが発火するネイティブ `click` も抑制されるため、`onEventClick` が誤発火することもありません）。ブラウザによるポインタの強制中断（`pointercancel`。タッチ操作の割り込み等）も同じ扱いになります。この挙動は `useDayDrag` / `useTimeGridDrag`（およびそれらを使うビルトインコンポーネント）に組み込まれており、追加の設定は不要です。

## 自前 UI を作る上級編

ビルトインコンポーネントを使わず、自前の要素にドラッグ操作を組み込みたい場合は `useDayDrag` / `useTimeGridDrag` をプロップゲッターとして使います。戻り値の `get*Props` 関数が返すオブジェクトを対象の要素にスプレッドするだけで、ポインタ操作からプレビュー計算・確定・繰り返しのスコープ解決までをフックが担います。

### useDayDrag（日単位: 月ビュー・終日行相当）

`useDayDrag({ calendar, callbacks })` は次を返します。

- `getDayCellProps(day)` — 日セル用の props（`ref` / `onPointerDown` / `onKeyDown` / `tabIndex` / `data-koyomi-date`）。空きセルでの作成ドラッグと Enter/Space での作成を開始する
- `getSegmentProps(segment)` — 帯セグメント用の props（`onPointerDown` / `onClick` / `onKeyDown` / `tabIndex` / `data-koyomi-occurrence` / ドラッグ中なら `data-koyomi-dragging`）。移動ドラッグ・クリック・キーボード操作を担う
- `getSegmentResizeHandleProps(segment, edge)` — 帯の左右端リサイズハンドル用の props（`edge` は `'start' | 'end'`）
- `previewRange` — 現在のドラッグプレビューの日範囲（非ドラッグ中、および時間グリッドへの変換プレビュー中は `null`）
- `isDragging` — ドラッグ操作が進行中か

`getDayCellProps` の `ref` はコールバック形式で、要素をポインタ位置 → 日の判定に使う内部レジストリへ登録します。複数日にまたがるドラッグを正しく機能させるには、返された `ref` を実際の要素に接続する必要があります。

```tsx
import { useCalendar, useDayDrag } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

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
- `getResizeHandleProps(item, edge?)` — リサイズハンドル用の props（`onPointerDown` / `onClick` / `data-koyomi-resize-handle`）。`edge` は `'start'`（上端 = 開始時刻）または `'end'`（下端 = 終了時刻。省略時の既定）
- `previewFor(day)` — 指定日のドラッグプレビュー区間（`{ kind, startMinutes, endMinutes }`。その日に重ならない場合と、終日行への変換プレビュー中は `null`）
- `isDragging` — ドラッグ操作が進行中か

いずれの `get*Props` も、対象の要素（`<div>` や `<button>` など）にそのままスプレッドして使います。`ref` はコールバック形式で、要素の矩形（`getBoundingClientRect`）からポインタ位置に対応する日時を計算するための内部レジストリに登録されます。

## 関連ページ

- [ビュー（月・週・日・リスト・年・複数月）](./views.md)
- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
