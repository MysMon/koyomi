# API リファレンス

`@koyomi-cal/react` が公開する API の全体リファレンスです。カレンダーエンジン・React フック・コンポーネント・型・低レベルユーティリティをカテゴリ別に一覧します。各機能の詳しい使い方や設計意図は、末尾の関連ページを参照してください。

## カレンダーエンジン

### `createCalendar`

```ts
function createCalendar(options?: CalendarOptions): CalendarApi
```

フレームワーク非依存のカレンダーエンジンを作成します。状態（ビュー・基準日・タイムゾーン・イベント・ドラッグプレビュー）を保持し、購読モデルで変更を通知します。React からは `useCalendar` 経由で使うのが基本ですが、`CalendarApi` 自体は React に依存しないため単体でも利用できます。

- `getState()` が返すスナップショットは、状態が変わらない限り同一のオブジェクト参照を返します（`useSyncExternalStore` との整合のため）。
- `getViewModel()` の結果は、ビューモデルに影響する状態が変わるまでキャッシュされます。`setDragPreview` はキャッシュを無効化しません。
- `createEvent` / `updateEvent` / `deleteEvent` が呼ばれるたびに `CalendarOptions.onEventsChange` が呼ばれます（`setEvents` では呼ばれません）。
- `createEvent` で `id` を省略した場合は `'koyomi-1'` のような連番 ID を採番します。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  initialView: 'month',
  timeZone: 'Asia/Tokyo',
  events: [{ id: '1', title: '会議', start: '2026-07-01T10:00', end: '2026-07-01T11:00' }],
});

let notified = 0;
const unsubscribe = calendar.subscribe(() => {
  notified += 1;
});

calendar.setView('week');
// => view が 'week' に変わり、subscribe のリスナーが呼ばれる
console.log(calendar.getState().view); // => 'week'
console.log(notified); // => 1

unsubscribe();
```

### `CalendarApi`

`createCalendar` が返すオブジェクトの型です。

| メソッド | シグネチャ | 説明 |
| --- | --- | --- |
| `getState` | `(): CalendarState` | 現在の状態のスナップショットを返す |
| `subscribe` | `(listener: () => void): () => void` | 状態変更の通知を購読する。戻り値で購読解除 |
| `setView` | `(view: CalendarViewType): void` | ビューを切り替える |
| `next` | `(): void` | 現在のビュー単位で次の期間へ移動する |
| `prev` | `(): void` | 現在のビュー単位で前の期間へ移動する |
| `today` | `(): void` | 今日へ移動する |
| `goTo` | `(date: Date): void` | 指定日へ移動する |
| `setTimeZone` | `(timeZone: TimeZoneId): void` | 表示タイムゾーンを変更する |
| `updateOptions` | `(patch: Partial<Omit<CalendarOptions, 'initialView' \| 'initialDate'>>): void` | オプションを部分的に更新する（`initialView` / `initialDate` は作成時専用のため型レベルで受け付けない） |
| `refresh` | `(): void` | 状態を変えずにビューモデルを再構築して通知する（`now()` の再評価。現在時刻線の追従用） |
| `getEvents` | `(): readonly CalendarEvent[]` | すべてのソースイベントを返す |
| `setEvents` | `(events: readonly CalendarEvent[]): void` | イベント一覧を置き換える（外部ストア同期用。`onEventsChange` は呼ばれない） |
| `createEvent` | `(input: CalendarEventInput): CalendarEvent` | イベントを作成し、`id` 確定済みのイベントを返す |
| `updateEvent` | `(id: EventId, patch: CalendarEventPatch, target?: { occurrenceStart: Date; scope: RecurringEditScope }): void` | イベントを更新する。繰り返しは `target` でスコープを指定 |
| `deleteEvent` | `(id: EventId, target?: { occurrenceStart: Date; scope: RecurringEditScope }): void` | イベントを削除する |
| `getViewModel` | `(): CalendarViewModel` | 現在のビューに対応するビューモデルを構築して返す |
| `getVisibleRange` | `(): DateRange` | 現在のビューが表示している日時範囲を返す |
| `getOccurrences` | `(range: DateRange): readonly EventOccurrence[]` | 指定範囲のオカレンス一覧を開始時刻順で返す |
| `setDragPreview` | `(preview: DragPreview | null): void` | ドラッグ操作のプレビューを設定する（`null` で解除） |

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

const created = calendar.createEvent({
  title: '会議',
  start: '2026-07-01T10:00',
  end: '2026-07-01T11:00',
});
// => id 省略時は 'koyomi-1' のような連番 ID が自動採番される
console.log(created.id); // => 'koyomi-1'

calendar.updateEvent(created.id, { title: '会議（変更）' });
console.log(calendar.getEvents()[0]?.title); // => '会議（変更）'

calendar.deleteEvent(created.id);
console.log(calendar.getEvents().length); // => 0
```

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  initialView: 'day',
  initialDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  events: [{ id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' }],
});

const viewModel = calendar.getViewModel();
console.log(viewModel.type); // => 'timeGrid'

const range = calendar.getVisibleRange();
const occurrences = calendar.getOccurrences(range);
console.log(occurrences.length); // => 1
console.log(occurrences[0]?.event.title); // => '会議'
```

値が実際に変わらない設定操作（同じ view / timeZone / 日時、同一のイベント配列参照、内容が同じオプションパッチなど）は通知自体を発生させません。`getState()` のスナップショットは状態が変わらない限り同一参照を返します（`useSyncExternalStore` と整合）。

繰り返しイベントの `updateEvent` / `deleteEvent` におけるスコープの意味づけ、`moveOccurrenceIn` のような便利関数の詳細は [予定の管理](./events.md) と [繰り返し予定](./recurrence.md) を参照してください。

## React フック

### `useCalendar`

```ts
function useCalendar(options?: UseCalendarOptions): UseCalendarResult

interface UseCalendarOptions extends CalendarOptions {
  /** 指定秒数ごとに api.refresh() を呼び、現在時刻線・「今日」判定を追従させる（既定: 自動更新なし） */
  refreshSeconds?: number;
}
```

カレンダーエンジンを作成し、React の状態として購読するメインフックです。エンジンはマウント時に一度だけ作成され、`useSyncExternalStore` で購読されます。

- `options` は**初期値として一度だけ**使われます（後から変更しても反映されません。動的に変更する場合は `api.updateOptions` / `api.setEvents` / `api.setTimeZone` を使います）。マウント後に異なる `events` 参照を渡し続けた場合、開発ビルドでは一度だけ警告が表示されます。
- `onEventsChange` コールバックと `refreshSeconds` だけは常に最新の値が反映されます。
- 戻り値の `api` は再レンダリングを跨いで安定した参照です（`useEffect` の依存に安全に使えます）。
- SSR（`renderToString` / Next.js）でも例外なく初期状態を描画できます（`getServerSnapshot` 対応済み）。Next.js App Router では `'use client'` が必要です。

```tsx
import { CalendarProvider, CalendarView, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}
// => ルート要素に data-koyomi="root" と data-koyomi-view="month" が付く
```

### `useCalendarShortcuts`

```ts
function useCalendarShortcuts(params: {
  calendar: UseCalendarResult;
  enabled?: boolean;
  onCreate?: () => void;
  views?: readonly CalendarViewType[];
}): void
```

Google カレンダー準拠のキーボードショートカットを有効にします。`document` に `keydown` リスナーを登録し、アンマウント時に解除します。`enabled`（既定 `true`）で一時的に無効化できます。`input` / `textarea` / `select` / `contentEditable` にフォーカスがある間は無効です。

| キー | 動作 |
| --- | --- |
| `M` / `W` / `D` / `A` | 月 / 週 / 日 / リスト表示に切り替え |
| `Y` | 年表示に切り替え（`views` に `'year'` を含む場合のみ。既定では無効） |
| `T` | 今日へ移動 |
| `J`, `N` | 次の期間へ |
| `K`, `P` | 前の期間へ |
| `C` | `onCreate` を呼ぶ（予定作成 UI の起点） |

`views`（既定 `['month', 'week', 'day', 'list']`）でビュー切替キーの対象ビューを制限します。新ビュー（年 等）のキーは opt-in で、既定では無効です。`Toolbar` の `views` prop（下記）と同じ既定値・同じ opt-in 方針です。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  useCalendarShortcuts({ calendar });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}
// => document 上で 'w' キーを押すと data-koyomi-view が 'week' に変わる
```

### `useDayDrag`

```ts
function useDayDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): DayDragHandlers
```

日単位のドラッグインタラクション（月ビューのセル・終日行）を提供する低レベルフックです。`MonthView` と `TimeGridView`（終日行）が内部で使用しています。独自のビューを組み立てる場合を除き、通常は直接呼び出す必要はありません。

**戻り値 `DayDragHandlers`**

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `getDayCellProps` | `(day: { date: Date; key: string }): DayCellProps` | 日セル要素に付与する props を返す |
| `getSegmentProps` | `(segment: EventSegment): SegmentProps` | 帯セグメント要素に付与する props を返す |
| `getSegmentResizeHandleProps` | `(segment: EventSegment, edge: 'start' \| 'end'): SegmentResizeHandleProps` | 帯の左右端リサイズハンドル用の props を返す |
| `previewRange` | `DateRange | null` | 現在のドラッグプレビューの日範囲（時間グリッドへの変換プレビュー中は `null`） |
| `isDragging` | `boolean` | ドラッグ操作が進行中か |

**関連する props 型**

| 型 | フィールド |
| --- | --- |
| `DayCellProps` | `ref`, `onPointerDown`, `onKeyDown`, `tabIndex`, `'data-koyomi-date'` |
| `SegmentProps` | `onPointerDown`, `onClick`, `onKeyDown`, `tabIndex`, `'data-koyomi-occurrence'`, `'data-koyomi-dragging'?` |
| `SegmentResizeHandleProps` | `onPointerDown`, `onClick`, `'data-koyomi-resize-handle': 'start' \| 'end'` |

```tsx
import { renderHook } from '@testing-library/react';
import { useCalendar, useDayDrag } from '@koyomi-cal/react';

const { result } = renderHook(() => {
  const calendar = useCalendar({ initialView: 'month' });
  return useDayDrag({ calendar });
});

const cellProps = result.current.getDayCellProps({
  date: new Date('2026-07-01T00:00:00+09:00'),
  key: '2026-07-01',
});
console.log(cellProps['data-koyomi-date']); // => '2026-07-01'
```

### `useTimeGridDrag`

```ts
function useTimeGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimeGridDragHandlers
```

時間グリッド（週/日ビュー）のドラッグインタラクション（新規作成・移動・リサイズ）を提供する低レベルフックです。`TimeGridView` が内部で使用しています。変更の適用はライブラリが行い、繰り返しイベントは `callbacks.resolveRecurringScope` でスコープを解決してから適用します。

**戻り値 `TimeGridDragHandlers`**

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `getDayProps` | `(day: TimeGridDay): TimeGridDayProps` | 日列要素に付与する props を返す |
| `getEventProps` | `(item: PositionedOccurrence): TimeGridEventProps` | イベントブロック要素に付与する props を返す |
| `getResizeHandleProps` | `(item: PositionedOccurrence, edge?: 'start' \| 'end'): TimeGridResizeHandleProps` | リサイズハンドル用の props を返す（`'start'` = 上端、省略時 `'end'` = 下端） |
| `previewFor` | `(day: TimeGridDay): TimeGridPreviewSegment | null` | 指定日のドラッグプレビュー区間を返す（終日行への変換プレビュー中は `null`） |
| `isDragging` | `boolean` | ドラッグ操作が進行中か |

**関連する props 型**

| 型 | フィールド |
| --- | --- |
| `TimeGridDayProps` | `ref`, `onPointerDown`, `'data-koyomi-date'` |
| `TimeGridEventProps` | `onPointerDown`, `onClick`, `onKeyDown`, `tabIndex`, `'data-koyomi-occurrence'`, `'data-koyomi-dragging'?` |
| `TimeGridResizeHandleProps` | `onPointerDown`, `onClick`, `'data-koyomi-resize-handle': 'start' \| 'end'` |
| `TimeGridPreviewSegment` | `kind: 'create' | 'move' | 'resize'`, `startMinutes: number`, `endMinutes: number` |

```tsx
import { renderHook } from '@testing-library/react';
import { useCalendar, useTimeGridDrag } from '@koyomi-cal/react';

const { result } = renderHook(() => {
  const calendar = useCalendar({ initialView: 'day' });
  return useTimeGridDrag({ calendar });
});

const dayProps = result.current.getDayProps({
  date: new Date('2026-07-01T00:00:00+09:00'),
  key: '2026-07-01',
  isToday: false,
  weekday: 3,
  items: [],
});
console.log(dayProps['data-koyomi-date']); // => '2026-07-01'
```

インタラクションのコールバック（`onEventClick` / `onSelectRange` / `onEventChange` / `onEventDelete` / `onError` / `resolveRecurringScope` / `onOverflowClick`）の詳細は [インタラクション](./interactions.md) を参照してください。

### `useVirtualizer`

```ts
function useVirtualizer(options: UseVirtualizerOptions): Virtualizer
```

縦方向のリストを仮想化する、ビュー非依存のヘッドレスなプリミティブです。`VirtualListView` が内部で使用します。DOM・スタイルは持たず、コア（`computeWindow` / `startForKey`）の純粋計算に、スクロール位置の購読・高さの実測（`ResizeObserver`）・スクロールアンカリングを結び付けて「描画すべきアイテムと寸法」だけを返します。独自 UI で仮想化したいときに使います。

**オプション `UseVirtualizerOptions`**

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `count` | `number` | アイテム総数 |
| `getItemKey` | `(index: number) => string` | インデックス → 安定キー（測定キャッシュ・フォーカス保持の基準） |
| `estimateSize` | `(index: number) => number` | インデックス → 推定高（px）。実測が入るまでの暫定値 |
| `getScrollElement` | `() => HTMLElement \| null` | スクロールコンテナを返す。戻り値は変わってよい（差し替えに追従） |
| `overscan?` | `number` | 前後の追加描画数（既定 3） |
| `pinnedKeys?` | `ReadonlySet<string>` | 窓外でも保持するキー（フォーカス中アイテム等） |
| `measure?` | `boolean` | `ResizeObserver` で実測するか。`false` で推定固定（既定 `true`） |
| `enabled` | `boolean` | 仮想化の有効化。SSR・初回は `false`、マウント後 `true`（hydration 不一致回避） |

**戻り値 `Virtualizer`**

| メンバー | 型 | 説明 |
| --- | --- | --- |
| `virtualItems` | `readonly VirtualItem[]` | 通常フローに並べる可視窓（overscan 込み） |
| `pinnedItems` | `readonly VirtualItem[]` | 窓外で保持する pinned（絶対配置。通常 0〜1 件） |
| `beforeSize` / `afterSize` | `number` | 上下スペーサの高さ（px） |
| `totalSize` | `number` | 全アイテムの合計高（px） |
| `measureElement` | `(key: string) => (el: HTMLElement \| null) => void` | アイテム DOM の実測登録 ref コールバック |
| `scrollToIndex` | `(index, opts?) => void` | 指定インデックスを可視域へスクロール |

`VirtualItem` は `{ index, key, start, size, measured }`。高さはライブラリが所有せず、スクロールコンテナの高さは利用者 CSS が決めます（本フックは実測するだけ）。

## コンポーネント

すべてヘッドレス（スタイルなし）で、DOM 構造・`data-koyomi-*` 属性は固定の仕様に従います。詳細なスタイリングは [テーマとスタイリング](./theming.md) を参照してください。

### `CalendarProvider`

```ts
function CalendarProvider(props: CalendarProviderProps): ReactElement
function useCalendarContext(): CalendarContextValue
```

`useCalendar` の戻り値とインタラクションコールバックを配下のコンポーネントに共有するコンテキストプロバイダです。ビルトインの各ビューコンポーネント・`Toolbar` はこの配下で使います。`useCalendarContext` は `CalendarProvider` の配下でなければ `Error` を投げます。

| 型 / 関数 | シグネチャ |
| --- | --- |
| `CalendarProviderProps` | `{ value: UseCalendarResult; callbacks?: CalendarInteractionCallbacks; children?: ReactNode }` |
| `useCalendarContext` | `(): CalendarContextValue` |

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({
    events: [{ id: '1', title: '会議', start: '2026-07-08T10:00:00', end: '2026-07-08T11:00:00' }],
  });

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{ onEventClick: (occurrence) => console.log(occurrence.event.title) }}
    >
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}
// => 予定（'10:00 会議'）をクリックすると onEventClick(occurrence, domEvent) が呼ばれ、'会議' がログに出る
```

### `CalendarView`

```ts
function CalendarView(props: CalendarViewProps): ReactElement
```

現在のビュー（`state.view`）に応じて `MonthView` / `TimeGridView` / `ListView` / `YearView` を出し分けるスイッチコンポーネントです。ルート要素に `data-koyomi="root"` と `data-koyomi-view` が付きます。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderMonthEvent` | `(segment: EventSegment) => ReactNode` | 月ビューのセグメントのカスタム描画 |
| `renderMonthDayCell` | `(day: MonthDay, defaultContent: ReactNode) => ReactNode` | 月ビューの日セルのカスタム描画（`MonthView.renderDayCell` へ転送） |
| `monthOverflowLabel` | `(count: number) => ReactNode` | 月ビューの「+N 件」の文言（`MonthView.overflowLabel` へ転送） |
| `renderTimeGridEvent` | `(item: PositionedOccurrence) => ReactNode` | 週/日ビューのイベントブロックのカスタム描画 |
| `renderTimeGridDayHeader` | `(day: TimeGridDay, defaultContent: ReactNode) => ReactNode` | 週/日ビューの日ヘッダーのカスタム描画（`TimeGridView.renderDayHeader` へ転送） |
| `renderListEvent` | `(occurrence: EventOccurrence) => ReactNode` | リストビューのイベント行のカスタム描画 |
| `listAllDayLabel` | `ReactNode` | リストビューの終日ラベル（既定「終日」） |
| `listEmptyLabel` | `ReactNode` | リストビューの空状態メッセージ（既定「予定はありません」） |
| `renderListDayHeader` | `(day: ListDay, defaultContent: ReactNode) => ReactNode` | リストビューの日付見出しのカスタム描画 |
| `virtualizeList` | `boolean` | リストビューを仮想化する（`ListView` の代わりに `VirtualListView`）。既定 `false` |
| `listEstimateDayHeight` | `number \| ((day: ListDay, index: number) => number)` | 仮想化時の日セクション推定高（`VirtualListView.estimateDayHeight` へ転送） |
| `listOverscan` | `number` | 仮想化時の前後 overscan 日数（`VirtualListView.overscan` へ転送） |
| `renderYearMonthHeader` | `(month: YearMonth, defaultContent: ReactNode) => ReactNode` | 年ビューのミニ月グリッドの見出しのカスタム描画（`YearView.renderMonthHeader` へ転送） |
| `renderYearDayCell` | `(day: YearDay, defaultContent: ReactNode) => ReactNode` | 年ビューの日セルのカスタム描画（`YearView.renderDayCell` へ転送） |

### `MonthView`

```ts
function MonthView(props: MonthViewProps): ReactElement | null
```

月ビュー（グリッド表示）を描画します。`viewModel.type !== 'month'` の場合は `null` を返します。日セル・帯セグメントのドラッグ操作は `useDayDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(segment: EventSegment) => ReactNode` | セグメントの表示内容。省略時は終日・複数日セグメントはタイトルのみ、単日の時間指定セグメントは `'H:mm タイトル'` |
| `renderDayCell` | `(day: MonthDay, defaultContent: ReactNode) => ReactNode` | 日セルの内容（日番号ボタン＋「+N 件」ボタン）をラップ・置換する。祝日ラベルやバッジの注入用 |
| `overflowLabel` | `(count: number) => ReactNode` | 「+N 件」ボタンの文言（既定 `+N 件`） |

ルート要素には WAI-ARIA の grid ロール（`grid` / `row` / `columnheader` / `gridcell`）と、各日セルへの完全な日付の `aria-label`・今日への `aria-current="date"` が付与されます。

### `TimeGridView`

```ts
function TimeGridView(props: TimeGridViewProps): ReactElement | null
```

週/日ビュー（時間グリッド）を描画します。`viewModel.type !== 'timeGrid'` の場合は `null` を返します。終日行のドラッグは `useDayDrag`、時間グリッド本体のドラッグは `useTimeGridDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(item: PositionedOccurrence) => ReactNode` | 時間指定イベントの表示内容。省略時は `'H:mm〜H:mm タイトル'`。終日行の内容はこの prop では変更できない |
| `renderDayHeader` | `(day: TimeGridDay, defaultContent: ReactNode) => ReactNode` | 日ヘッダー（曜日・日番号）の内容 |

### `ListView`

```ts
function ListView(props: ListViewProps): ReactElement | null
```

表示範囲内の予定を日付ごとの `section` にまとめて一覧表示します。`viewModel.type !== 'list'` の場合は `null` を返します。ドラッグ操作はありません。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(occurrence: EventOccurrence) => ReactNode` | イベント行の内容。省略時は時刻ラベル・色見本・タイトル |
| `allDayLabel` | `ReactNode` | 終日予定の時刻ラベル（既定「終日」） |
| `emptyLabel` | `ReactNode` | 空状態のメッセージ（既定「予定はありません」） |
| `renderDayHeader` | `(day: ListDay, defaultContent: ReactNode) => ReactNode` | 日付見出しの内容 |

### `VirtualListView`

```ts
function VirtualListView(props: VirtualListViewProps): ReactElement | null
```

`ListView` を縦方向に仮想化した opt-in コンポーネントです。可視範囲の日セクションだけを描画し、大量の予定・長期間表示での DOM 肥大を抑えます。日セクションの内容（`data-koyomi-*` 構造）は共有レンダラを通じて `ListView` と完全に一致します。内部で `useVirtualizer` を使用します。

`ListView` の props（`renderEvent` / `allDayLabel` / `emptyLabel` / `renderDayHeader`）に加えて次を受け付けます。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `estimateDayHeight` | `number \| ((day: ListDay, index: number) => number)` | 日セクションの推定高（既定 64）。実測が入るまでの暫定値 |
| `overscan` | `number` | 前後の追加描画日数（既定 3） |

**高さは CSS で指定（必須）**。ヘッドレスの原則によりコンポーネントは寸法を持ちません。スクロールコンテナ（`[data-koyomi="list"][data-koyomi-virtualized]`）に `height` / `max-height` を CSS で与えてください。境界高が無いと仮想化は無害に無効化されます（開発ビルドで一度警告）。`overflow`/`position` などの構造 CSS はデフォルトテーマが `data-koyomi-virtualized` 属性に付与します。使い方・注意点（ページ内検索・1 日大量予定）の詳細は [ビュー: リストの仮想化](./views.md#リストの仮想化大量の予定長期間) を参照してください。

`CalendarView` からは `virtualizeList` / `listEstimateDayHeight` / `listOverscan` プロップで opt-in できます（下記 `CalendarView` を参照）。

### `YearView`

```ts
function YearView(props: YearViewProps): ReactElement | null
```

年ビュー（1 月〜12 月分のミニ月グリッド）を描画します。`viewModel.type !== 'year'` の場合は `null` を返します。予定は密度（件数マーカー）のみを表示し、帯・タイトルの表示やドラッグ操作はありません。日セルのクリックでその日の日ビューに切り替わります（`goTo` + `setView('day')`）。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderMonthHeader` | `(month: YearMonth, defaultContent: ReactNode) => ReactNode` | ミニ月グリッドの見出しの内容 |
| `renderDayCell` | `(day: YearDay, defaultContent: ReactNode) => ReactNode` | 日セルの内容（日番号＋件数マーカー）をラップ・置換する |

ルート要素には月ビューと同じ WAI-ARIA grid ロール（ミニ月単位で `grid` / `row` / `columnheader` / `gridcell`）と、各日セルへの完全な日付＋件数の `aria-label`（例:「7月10日 予定3件」）・今日への `aria-current="date"` が付与されます。`hiddenWeekdays` は無視されます（常に 7 列。日ビューと同じ扱い）。

### `Toolbar`

```ts
function Toolbar(props: ToolbarProps): ReactElement

interface ToolbarProps {
  /** ボタン文言の差し替え（省略時は日本語の既定文言） */
  labels?: ToolbarLabels;
  /**
   * ビュー切替ボタンとして表示するビューの一覧（並び順もこの配列に従う）。
   * 既定は `['month', 'week', 'day', 'list']`（新ビューは opt-in）。
   */
  views?: readonly CalendarViewType[];
}

interface ToolbarLabels {
  month?: ReactNode;
  week?: ReactNode;
  day?: ReactNode;
  list?: ReactNode;
  year?: ReactNode;
  today?: ReactNode;
  prev?: ReactNode;
  next?: ReactNode;
}
```

「今日」「前へ」「次へ」のナビゲーション、期間タイトル、ビュー切替（既定は月・週・日・リスト。`views` prop で年ビュー等を追加できる opt-in）を提供します。タイトルは現在のビューに応じて `formatMonthTitle` / `formatDayTitle` / `formatRangeTitle` / `formatYearTitle` のいずれかで整形されます。`labels` で全ボタン文言を差し替えられます（i18n 対応）。

## 型

### イベント

| 型 | 説明 |
| --- | --- |
| `EventId` | `string`。イベントを一意に識別する ID |
| `TimeZoneId` | `string`。IANA タイムゾーン ID（例: `'Asia/Tokyo'`） |
| `Weekday` | `0 | 1 | 2 | 3 | 4 | 5 | 6`。0 = 日曜日 |
| `DateRange` | `{ start: Date; end: Date }`。`end` は排他的 |
| `CalendarEvent` | カレンダーイベント（ソースデータ）。下表参照 |
| `CalendarEventInput` | `Omit<CalendarEvent, 'id'> & { id?: EventId }`。`createEvent` の入力 |
| `CalendarEventPatch` | `Omit<CalendarEvent, 'id'>` の各フィールドが省略可能かつ明示的に `\| undefined` を許容する部分更新型（`exactOptionalPropertyTypes: true` でも `{ rrule: undefined }` のようなリテラルをそのまま書ける）。キーが存在し値が `undefined` の場合はそのフィールドを削除するが、必須フィールドだった `title` / `start` は削除されず元の値を維持する |
| `EventOccurrence` | イベントのオカレンス。下表参照 |
| `RecurringEditScope` | `'this' | 'thisAndFollowing' | 'all'`。繰り返しの編集・削除の適用範囲 |
| `DragPreview` | `{ kind: 'create' | 'move' | 'resize'; occurrenceKey: string | null; range: DateRange; allDay: boolean }` |

**`CalendarEvent` のフィールド**

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `EventId` | 一意な ID |
| `title` | `string` | タイトル |
| `start` | `Date | string` | 開始日時（終日イベントは日付） |
| `end?` | `Date | string` | 終了日時（排他）。省略時は時間指定は `defaultEventMinutes` 分、終日は 1 日 |
| `allDay?` | `boolean` | 終日イベントかどうか（既定 `false`） |
| `timeZone?` | `TimeZoneId` | このイベントのタイムゾーン（省略時は表示タイムゾーン） |
| `rrule?` | `string` | RFC 5545 の繰り返しルール |
| `exdates?` | `readonly (Date | string)[]` | 繰り返しから除外するオカレンスの開始日時 |
| `rdates?` | `readonly (Date | string)[]` | 繰り返しに追加するオカレンスの開始日時（RDATE 相当） |
| `recurringEventId?` | `EventId` | 繰り返し例外イベントの場合、元イベントの ID |
| `originalStart?` | `Date | string` | 繰り返し例外イベントの場合、置き換え対象のオカレンスの本来の開始日時 |
| `color?` | `string` | 表示色（CSS の color 値） |
| `location?` | `string` | 場所 |
| `description?` | `string` | 説明文 |
| `editable?` | `boolean` | 変更操作（ドラッグ・キーボードの移動/リサイズ/削除）を許可するか（既定 `true`） |
| `extendedProps?` | `Record<string, unknown>` | 利用者定義の任意データ |

**`EventOccurrence` のフィールド**

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `key` | `string` | オカレンスを一意に識別するキー（`` `${eventId}@${startのISO文字列}` ``） |
| `eventId` | `EventId` | 元イベントの ID |
| `event` | `CalendarEvent` | 元の `CalendarEvent`（オーバーライドの場合はオーバーライドイベント） |
| `start` | `Date` | このオカレンスの開始（絶対時刻） |
| `end` | `Date` | このオカレンスの終了（絶対時刻、排他的） |
| `allDay` | `boolean` | 終日イベントかどうか |
| `isRecurring` | `boolean` | 繰り返しイベント由来のオカレンスかどうか |
| `originalStart` | `Date` | 繰り返し由来の場合、このオカレンスの本来の開始日時 |

イベントの CRUD・パッチ規則・繰り返しの詳細は [予定の管理](./events.md) と [繰り返し予定](./recurrence.md) を参照してください。

### オプション

`CalendarOptions` はすべて省略可能で、省略時は `ResolvedCalendarOptions` に記載の既定値が使われます。

| フィールド | 型 | 既定値 |
| --- | --- | --- |
| `initialDate?` | `Date` | 現在時刻 |
| `initialView?` | `CalendarViewType` | `'month'` |
| `events?` | `readonly CalendarEvent[]` | `[]` |
| `timeZone?` | `TimeZoneId` | 実行環境のローカルタイムゾーン |
| `weekStartsOn?` | `Weekday` | `0`（日曜日） |
| `dayMaxEvents?` | `number` | `4` |
| `snapMinutes?` | `number` | `15` |
| `slotMinutes?` | `number` | `60` |
| `defaultEventMinutes?` | `number` | `60` |
| `defaultEventTitle?` | `string` | `'(タイトルなし)'`（既定作成時のタイトル） |
| `listDays?` | `number` | `30` |
| `locale?` | `string` | `'ja'` |
| `hiddenWeekdays?` | `readonly Weekday[]` | `[]`（非表示にする曜日。7 曜日全指定は無効） |
| `now?` | `() => Date` | `() => new Date()` |
| `onEventsChange?` | `(events: readonly CalendarEvent[]) => void` | なし |

`initialDate` / `initialView` は**作成時専用**です（`updateOptions` は型レベルで受け付けません。変更には `goTo` / `setView` を使います）。

`ResolvedCalendarOptions` は既定値適用後の型で、`onEventsChange` を除くすべてのフィールドが必須になったものです（`weekStartsOn` / `dayMaxEvents` / `snapMinutes` / `slotMinutes` / `defaultEventMinutes` / `defaultEventTitle` / `listDays` / `locale` / `hiddenWeekdays` / `now`）。`CalendarViewType` は `'month' | 'week' | 'day' | 'list' | 'year'` です。

### 状態とビューモデル

| 型 | 説明 |
| --- | --- |
| `CalendarState` | `{ view; currentDate; timeZone; events; dragPreview; options: ResolvedCalendarOptions }`。`getState()` の戻り値 |
| `CalendarViewModel` | `MonthViewModel | TimeGridViewModel | ListViewModel | YearViewModel`。`getViewModel()` の戻り値 |
| `MonthViewModel` | `{ type: 'month'; anchor: Date; weeks: readonly MonthWeek[]; weekdays: readonly Weekday[] }` |
| `MonthWeek` | `{ days: readonly MonthDay[]; segments: readonly EventSegment[]; laneCount: number }` |
| `MonthDay` | `{ date; key; inCurrentMonth; isToday; overflowCount }` |
| `EventSegment` | `{ occurrence; startCol; span; lane; continuesBefore; continuesAfter; hidden }`。月ビュー・終日行の帯セグメント |
| `TimeGridViewModel` | `{ type: 'timeGrid'; viewType: 'week' | 'day'; days; allDaySegments; allDayLaneCount; slots; nowIndicator }` |
| `TimeGridDay` | `{ date; key; isToday; weekday; items: readonly PositionedOccurrence[] }` |
| `TimeSlot` | `{ minutes: number; label: string }` |
| `PositionedOccurrence` | `{ occurrence; startMinutes; endMinutes; left; width; continuesBefore; continuesAfter }`。時間グリッドに配置されたオカレンス（割合・分単位） |
| `ListViewModel` | `{ type: 'list'; days: readonly ListDay[]; isEmpty: boolean }` |
| `ListDay` | `{ date; key; isToday; occurrences: readonly EventOccurrence[] }` |
| `YearViewModel` | `{ type: 'year'; anchor: Date; months: readonly YearMonth[]; weekdays: readonly Weekday[] }` |
| `YearMonth` | `{ anchor: Date; key: string; weeks: readonly (readonly YearDay[])[] }`。週数は 4〜6 |
| `YearDay` | `{ date; key; inCurrentMonth; isToday; eventCount }`。前後月の日付（`inCurrentMonth: false`）は常に `eventCount: 0` |

`nowIndicator` は `{ dayKey: string; minutes: number } | null`（表示範囲内に「今日」がない場合は `null`）です。ビューごとの表示仕様は [ビュー](./views.md) を参照してください。

### React 型（コールバック等）

| 型 | シグネチャ | 説明 |
| --- | --- | --- |
| `UseCalendarResult` | `{ api: CalendarApi; state: CalendarState; viewModel: CalendarViewModel }` | `useCalendar` の戻り値 |
| `CalendarContextValue` | `UseCalendarResult & { callbacks: CalendarInteractionCallbacks }` | `useCalendarContext()` の戻り値 |
| `RangeSelection` | `{ range: DateRange; allDay: boolean }` | 範囲選択（新規作成操作）の内容 |
| `EventChange` | `{ occurrence: EventOccurrence; newRange: DateRange; allDay: boolean; scope: RecurringEditScope | null }` | ドラッグ・キーボードによるイベント変更の内容 |
| `EventDelete` | `{ occurrence: EventOccurrence; scope: RecurringEditScope | null }` | キーボード削除の内容 |
| `CalendarInteractionCallbacks` | 下表参照 | インタラクションのコールバック集 |

**`CalendarInteractionCallbacks` のフィールド**（すべて省略可能）

| フィールド | シグネチャ | 既定動作 |
| --- | --- | --- |
| `onEventClick?` | `(occurrence: EventOccurrence, domEvent: MouseEvent) => void` | 何もしない |
| `onSelectRange?` | `(selection: RangeSelection) => void` | `defaultEventTitle`（既定 `'(タイトルなし)'`）のタイトルでイベントを即時作成する |
| `onEventChange?` | `(change: EventChange) => void` | 変更の適用はライブラリが行うため、これは通知のみ |
| `onEventDelete?` | `(deletion: EventDelete) => void` | 削除の適用はライブラリが行うため、これは通知のみ |
| `onError?` | `(error: unknown) => void` | `console.error` に出力する |
| `resolveRecurringScope?` | `(occurrence: EventOccurrence, action: 'move' | 'resize' | 'delete' | 'update') => Promise<RecurringEditScope | null>` | `'this'`（この予定のみ）を返す |
| `onOverflowClick?` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => void` | その日の日ビューに切り替える |

## 低レベルユーティリティ

ビューコンポーネントやフックが内部で使う、フレームワーク非依存の純粋関数です。独自のビューやインタラクションを組み立てる場合に利用できます。

### タイムゾーン（`core/timezone`）

| 関数 / 型 | 説明 |
| --- | --- |
| `getLocalTimeZone(): TimeZoneId` | 実行環境のローカルタイムゾーン ID を返す |
| `isValidTimeZone(timeZone: string): boolean` | 有効な IANA タイムゾーン ID かどうかを判定する |
| `getWallClock(date, timeZone): Required<WallClockParts>` | 絶対時刻を指定タイムゾーンの現地時刻の成分に分解する |
| `fromWallClock(parts, timeZone): Date` | 現地時刻の成分から絶対時刻を構築する（存在しない時刻は直後の実在時刻に繰り上げ） |
| `startOfDayInZone(date, timeZone): Date` | 指定タイムゾーンにおけるその日の 0:00 の絶対時刻を返す |
| `addDaysInZone(date, amount, timeZone): Date` | 現地時刻基準で日数を加算する（DST を跨いでも時刻を維持） |
| `addMinutesInZone(date, amount, timeZone): Date` | 現地時刻基準で分数を加算する |
| `dateKeyInZone(date, timeZone): string` | 指定タイムゾーンにおける `'YYYY-MM-DD'` の日付キーを返す |
| `dateFromKey(key, timeZone): Date` | 日付キーからその日の 0:00 の絶対時刻を返す |
| `minutesOfDayInZone(date, timeZone): number` | その日の 0:00 からの経過分（0〜1439）を返す |
| `isSameDayInZone(a, b, timeZone): boolean` | 現地時刻基準で同じ日かどうかを判定する |
| `weekdayInZone(date, timeZone): Weekday` | 指定タイムゾーンにおける曜日を返す |
| `parseDateValue(value, timeZone, allDay): Date` | `CalendarEvent` の `start`/`end` 値を絶対時刻に解釈する |
| `formatSlotLabel(minutes: number): string` | 分数を `'HH:mm'` 形式のラベルにする |
| `WallClockParts`（型） | `{ year; month; day; hours?; minutes?; seconds?; milliseconds? }` |

```ts
import { addDaysInZone, dateKeyInZone, isValidTimeZone, startOfDayInZone } from '@koyomi-cal/react';

console.log(isValidTimeZone('Asia/Tokyo')); // => true
console.log(isValidTimeZone('Invalid/Zone')); // => false

const day = startOfDayInZone(new Date('2026-07-01T15:00:00Z'), 'Asia/Tokyo');
console.log(dateKeyInZone(day, 'Asia/Tokyo')); // => '2026-07-02'（UTC 15:00 = 東京 7/2 0:00）

const next = addDaysInZone(day, 1, 'Asia/Tokyo');
console.log(dateKeyInZone(next, 'Asia/Tokyo')); // => '2026-07-03'
```

### 日付範囲（`core/date-utils`）

| 関数 | 説明 |
| --- | --- |
| `startOfWeekInZone(date, timeZone, weekStartsOn): Date` | その週の開始日 0:00 の絶対時刻を返す |
| `startOfYearInZone(date, timeZone): Date` | その年の 1 月 1 日 0:00 の絶対時刻を返す |
| `monthGridRange(anchor, timeZone, weekStartsOn): DateRange` | 月ビューのグリッド範囲（前後月の日付を含む、4〜6 週）を返す |
| `eachDayInRange(range, timeZone): Date[]` | 範囲内の各日の開始時刻（0:00）を列挙する |
| `rangesOverlap(a, b): boolean` | 2 つの範囲が重なるかどうかを判定する（`end` は排他） |
| `visibleRangeFor(view, currentDate, timeZone, options): DateRange` | ビューごとの表示日時範囲を返す |
| `navigateDate(view, currentDate, direction, timeZone, options): Date` | 「次へ/前へ」ナビゲーションの移動先の基準日を返す |

```ts
import { eachDayInRange, monthGridRange, rangesOverlap } from '@koyomi-cal/react';

const overlap = rangesOverlap(
  { start: new Date('2026-07-01T10:00:00+09:00'), end: new Date('2026-07-01T11:00:00+09:00') },
  { start: new Date('2026-07-01T11:00:00+09:00'), end: new Date('2026-07-01T12:00:00+09:00') },
);
console.log(overlap); // => false（end は排他的なので隣接区間は重ならない）

const gridRange = monthGridRange(new Date('2026-07-15T00:00:00+09:00'), 'Asia/Tokyo', 0);
const days = eachDayInRange(gridRange, 'Asia/Tokyo');
console.log(days.length % 7); // => 0（月ビューのグリッドは常に 7 の倍数日）
```

### 繰り返し（`core/recurrence`）

RFC 5545 の RRULE（`rrule` パッケージ）をラップし、タイムゾーンの現地時刻を維持して展開します。

| 関数 | 説明 |
| --- | --- |
| `normalizeRRuleString(rrule: string): string` | RRULE 文字列を検証し、正規化された本体を返す |
| `expandRecurrence(params): Date[]` | 繰り返しを展開し、範囲内に開始するオカレンスの開始時刻を昇順で返す |
| `previousOccurrenceStart(params): Date | null` | 指定時刻より前の最後のオカレンスの開始時刻を返す |
| `truncateRRule(params): string` | 繰り返しを `until` より前で終了するよう打ち切った RRULE 文字列を返す |
| `countOccurrencesBefore(params): number` | `dtstart` から `before`（排他）までのオカレンスの数を数える |

```ts
import { expandRecurrence, normalizeRRuleString } from '@koyomi-cal/react';

console.log(normalizeRRuleString('freq=daily;count=3')); // => 'FREQ=DAILY;COUNT=3'

const starts = expandRecurrence({
  rrule: 'FREQ=DAILY;COUNT=3',
  dtstart: new Date('2026-07-01T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  range: { start: new Date('2026-07-01T00:00:00+09:00'), end: new Date('2026-07-10T00:00:00+09:00') },
});
console.log(starts.length); // => 3
```

### イベント変更（`core/mutations`）

Google カレンダーの編集・削除操作（繰り返しの「この予定のみ / これ以降 / すべて」を含む）を、イベント配列を受け取り新しい配列を返す純粋関数として提供します。`CalendarApi` の CRUD メソッドはこれらに委譲しています。

| 関数 / 型 | 説明 |
| --- | --- |
| `applyPatch(event, patch): CalendarEvent` | イベントにパッチを適用した新しいイベントを返す。パッチのキーが存在し値が `undefined` の場合はそのフィールドを削除する |
| `createEventIn(events, input, context): CreateEventResult` | イベントを追加する。`id` 省略時は `context.generateId()` で採番する |
| `updateEventIn(events, id, patch, target, context): CalendarEvent[]` | イベントを更新する（繰り返しはスコープに従う） |
| `deleteEventIn(events, id, target, context): CalendarEvent[]` | イベントを削除する（繰り返しはスコープに従う） |
| `moveOccurrenceIn(events, id, params, context): CalendarEvent[]` | オカレンスの移動（ドラッグ＆ドロップ）を `updateEventIn` 経由で適用する便利関数 |
| `MutationContext`（型） | `{ displayTimeZone: TimeZoneId; defaultEventMinutes: number; generateId: () => EventId }` |
| `RecurringTarget`（型） | `{ occurrenceStart: Date; scope: RecurringEditScope }` |
| `CreateEventResult`（型） | `{ events: CalendarEvent[]; created: CalendarEvent }` |

```ts
import { applyPatch, createEventIn } from '@koyomi-cal/react';
import type { CalendarEvent, MutationContext } from '@koyomi-cal/react';

const event: CalendarEvent = { id: '1', title: '会議', start: '2026-07-01T10:00' };
const updated = applyPatch(event, { title: '新タイトル' });
console.log(updated.title); // => '新タイトル'
console.log(event.title); // => '会議'（元のイベントは変更されない）

const context: MutationContext = {
  displayTimeZone: 'Asia/Tokyo',
  defaultEventMinutes: 60,
  generateId: () => 'e1',
};
const result = createEventIn([], { title: '会議', start: '2026-07-01T10:00' }, context);
console.log(result.created.id); // => 'e1'
console.log(result.events.length); // => 1
```

繰り返し編集のセマンティクス（この予定のみ / これ以降 / すべて）の詳細は [繰り返し予定](./recurrence.md) を参照してください。

### イベント展開（`core/expansion`）

`CalendarEvent` の集合を表示範囲に対して展開し、`EventOccurrence` の一覧を生成します。

| 関数 | 説明 |
| --- | --- |
| `expandEvents(params): EventOccurrence[]` | イベント集合を指定範囲に展開し、オカレンス一覧を開始時刻順で返す |
| `occurrenceKey(eventId, start): string` | オカレンスの一意キー（`` `${eventId}@${startのISO文字列}` ``）を組み立てる |
| `resolveOccurrence(params): EventOccurrence | null` | 単一イベントの、指定したオカレンスの開始時刻におけるオカレンスを解決する |

```ts
import { expandEvents, occurrenceKey, resolveOccurrence } from '@koyomi-cal/react';
import type { CalendarEvent } from '@koyomi-cal/react';

const events: CalendarEvent[] = [
  {
    id: 'e1',
    title: '朝会',
    start: '2026-07-01T09:00',
    end: '2026-07-01T09:30',
    rrule: 'FREQ=DAILY;COUNT=3',
  },
];
const occurrences = expandEvents({
  events,
  range: { start: new Date('2026-07-01T00:00:00+09:00'), end: new Date('2026-07-04T00:00:00+09:00') },
  displayTimeZone: 'Asia/Tokyo',
  defaultEventMinutes: 60,
});
console.log(occurrences.length); // => 3
console.log(occurrences[0]?.key === occurrenceKey('e1', occurrences[0]!.start)); // => true

const resolved = resolveOccurrence({
  event: events[0]!,
  occurrenceStart: occurrences[1]!.start,
  displayTimeZone: 'Asia/Tokyo',
  defaultEventMinutes: 60,
});
console.log(resolved?.start.getTime() === occurrences[1]!.start.getTime()); // => true
```

### インタラクション計算（`core/interaction`）

ドラッグによる予定の作成・移動・リサイズで必要な「ポインタ位置 → 日時」の変換とプレビュー範囲の計算を、DOM に依存しない純粋関数として提供します。`useDayDrag` / `useTimeGridDrag` が内部で使用しています。

| 関数 / 型 | 説明 |
| --- | --- |
| `snapToInterval(minutes, snap): number` | 分数を指定間隔にスナップする（最近傍への丸め） |
| `timeAtGridPosition(params): Date` | 時間グリッドの列内の縦位置（0〜1）から日時を計算する |
| `dragPreviewRange(state, pointer, context): DateRange` | 時間グリッドのドラッグ中のポインタ日時からプレビュー範囲を計算する |
| `dayDragPreviewRange(state, pointerDay, anchorDay, timeZone): DateRange` | 日単位ドラッグ（月ビュー・終日行）のプレビュー範囲を計算する |
| `shortcutForKey(key, modifiers?)` | キー入力を Google カレンダー準拠のショートカットに解釈する。戻り値は `CalendarShortcut` または `null` |
| `CalendarShortcut`（型） | 判別共用体。`{ type: 'view', view }` / `{ type: 'today' }` / `{ type: 'next' }` / `{ type: 'prev' }` / `{ type: 'create' }` のいずれか |
| `TimeGridDragMode`（型） | `'create'`、`'move'`、`'resize'`（下端 = 終了時刻）、`'resize-start'`（上端 = 開始時刻）のいずれか |
| `DayDragMode`（型） | `'create'`、`'move'`、`'resize-start'`（帯の左端）、`'resize-end'`（帯の右端）のいずれか |
| `TimeGridDragState`（型） | `{ mode: TimeGridDragMode, occurrence: EventOccurrence または null, anchor: Date }` |

```ts
import { shortcutForKey, snapToInterval } from '@koyomi-cal/react';

console.log(snapToInterval(37, 15)); // => 30
console.log(shortcutForKey('w')); // => { type: 'view', view: 'week' }
console.log(shortcutForKey('y')); // => { type: 'view', view: 'year' }
console.log(shortcutForKey('s')); // => null（該当なし）
```

### ビューモデルビルダー（`core/views`）

各ビューのビューモデルを構築する純粋関数です。`CalendarApi.getViewModel()` が内部で使用しており、通常は直接呼び出す必要はありません。

| 関数 | 説明 |
| --- | --- |
| `buildMonthViewModel(params): MonthViewModel` | 月ビューのビューモデル（週・日・帯セグメント）を構築する。`hiddenWeekdays` で列を除外できる |
| `buildTimeGridViewModel(params): TimeGridViewModel` | 週/日ビューのビューモデル（終日行・時間グリッド配置）を構築する。`hiddenWeekdays` 対応 |
| `buildListViewModel(params): ListViewModel` | リストビューのビューモデル（日付ごとのオカレンス一覧）を構築する |
| `buildYearViewModel(params): YearViewModel` | 年ビューのビューモデル（12 ヶ月分のミニ月グリッド・日ごとの予定件数）を構築する。`hiddenWeekdays` は無視する |

```ts
import { buildMonthViewModel } from '@koyomi-cal/react';

const model = buildMonthViewModel({
  currentDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  occurrences: [],
  weekStartsOn: 0,
  dayMaxEvents: 4,
  now: new Date('2026-07-15T00:00:00+09:00'),
});
console.log(model.type); // => 'month'
console.log(model.weeks.length >= 4 && model.weeks.length <= 6); // => true
```

```ts
import { buildYearViewModel } from '@koyomi-cal/react';

const yearModel = buildYearViewModel({
  currentDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  occurrences: [],
  weekStartsOn: 0,
  now: new Date('2026-07-15T00:00:00+09:00'),
});
console.log(yearModel.type); // => 'year'
console.log(yearModel.months.length); // => 12
```

### 日時ラベル整形（`react/components/format`）

ビルトインコンポーネントが使う `Intl.DateTimeFormat` ベースの整形ヘルパです。`timeZone` / `locale` を必須引数として受け取り、暗黙のローカルタイムゾーンには依存しません。`ja` ロケール以外は `Intl` の既定の書式に委ねます。

| 関数 | 説明 |
| --- | --- |
| `formatTime(date, timeZone, locale): string` | `'H:mm'` 形式の時刻ラベル（例: `'9:05'`） |
| `formatMonthTitle(date, timeZone, locale): string` | 月ビューのタイトル（例: `'2026年7月'`） |
| `formatDayTitle(date, timeZone, locale): string` | 日ビューのタイトル（例: `'2026年7月15日(水)'`） |
| `formatRangeTitle(range, timeZone, locale): string` | 週/リストビューのタイトル（例: `'7月5日〜7月11日'`） |
| `formatYearTitle(date, timeZone, locale): string` | 年ビューのタイトル（例: `'2026年'`） |
| `formatWeekday(weekday, locale): string` | 曜日の短縮ラベル（例: `'日'`） |
| `formatDayHeader(date, timeZone, locale): string` | 時間グリッドの日ヘッダー用ラベル（例: `'15 (水)'`） |

```ts
import { formatMonthTitle, formatTime, formatWeekday, formatYearTitle } from '@koyomi-cal/react';

console.log(formatTime(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')); // => '10:00'
console.log(formatMonthTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')); // => '2026年7月'
console.log(formatYearTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')); // => '2026年'
console.log(formatWeekday(3, 'ja')); // => '水'
```

## 関連ページ

- [はじめに](./getting-started.md)
- [ビュー（月・週・日・リスト・年）](./views.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [繰り返し予定](./recurrence.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
