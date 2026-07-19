# API リファレンス

`@koyomi-cal/react` が公開する API の全体リファレンスです。カレンダーエンジン・React フック・コンポーネント・型・低レベルユーティリティをカテゴリ別に一覧します。各機能の詳しい使い方や設計意図は、末尾の関連ページを参照してください。

## ユースケース別ガイド

やりたいことから、使う API と詳しい解説ページを引けます。API の全量を把握する前に、まずここから必要な項目だけ拾い読みしてください。

| やりたいこと | 使う API | 詳しくは |
| --- | --- | --- |
| 最初の1画面を表示する | [`useCalendar`](#usecalendar)・[`CalendarProvider`](#calendarprovider)・[`CalendarView`](#calendarview)・[`Toolbar`](#toolbar) | [はじめに](./getting-started.md) |
| クリック・ドラッグで予定を作成する | `callbacks.onSelectRange`・[`useDayDrag`](#usedaydrag)・[`useTimeGridDrag`](#usetimegriddrag)・[`useExternalDrag`](#useexternaldrag)（外部要素からのドロップ） | [インタラクション](./interactions.md) |
| 予定の移動・リサイズに対応する | [`useDayDrag`](#usedaydrag)・[`useTimeGridDrag`](#usetimegriddrag)・[`useResourceGridDrag`](#useresourcegriddrag)・[`useTimelineDrag`](#usetimelinedrag)・`moveOccurrenceIn`・`eventOverlap`/`eventConstraint` | [インタラクション](./interactions.md) |
| 繰り返し予定に対応する | `CalendarEvent.rrule`/`rdates`/`exdates`・[`useRecurrenceRuleEditor`](#userecurrenceruleeditor)・`updateEvent`/`deleteEvent` の `scope` | [繰り返し予定](./recurrence.md) |
| undo/redo を実装する | [`createEventHistory`](#createeventhistory)・[`useCalendarHistory`](#usecalendarhistory)・`onEventChange`/`onEventDelete` の `changes` | [予定の管理: undo（元に戻す）を実装する](./events.md#undo元に戻すを実装する) |
| リソース・タイムラインを表示する | `CalendarResource`・`resources` オプション・[`ResourceView`](#resourceview)・[`TimelineView`](#timelineview) | [ビュー](./views.md) |
| 大量の予定・リソースを描画する（仮想化） | `dayMaxEvents`・`slotMinTime`/`slotMaxTime`・[`VirtualListView`](#virtuallistview)・[`VirtualResourceView`](#virtualresourceview)・[`VirtualTimelineView`](#virtualtimelineview)・[`useVirtualizer`](#usevirtualizer) | [パフォーマンス](./performance.md) |
| 多言語対応・読み上げ文言をカスタマイズする | `CalendarOptions.locale`・`CalendarProvider` の `messages`・[`useCalendarAnnouncer`](#usecalendarannouncer) | [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) |
| React に依存せずカレンダーエンジンだけを使う | [`@koyomi-cal/react/core`](#koyomi-calreactcorereact-非依存の単体エントリ) | [はじめに: React に依存しないコアだけを使う](./getting-started.md#react-に依存しないコアだけを使う) |
| iCalendar（`.ics`）でエクスポート・インポートする | [`eventsToIcs` / `eventsFromIcs`](#icalendar-入出力coreics) | [iCalendar（ICS）入出力](./ics.md) |

## カレンダーエンジン

### `createCalendar`

```ts
function createCalendar(options?: CalendarOptions): CalendarApi
```

フレームワーク非依存のカレンダーエンジンを作成します。状態（ビュー・基準日・タイムゾーン・イベント・ドラッグプレビュー）を保持し、購読モデルで変更を通知します。React からは `useCalendar` 経由で使うのが基本ですが、`CalendarApi` 自体は React に依存しないため単体でも利用できます。React を import しない単体利用には、React を一切含まない `@koyomi-cal/react/core` エントリを使ってください（詳細後述）。

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
| `setView` | `(view: CalendarViewType): void` | ビューを切り替える。未知のビュー名は `Error`（`initialView` も同じ検証） |
| `next` | `(): void` | 現在のビュー単位で次の期間へ移動する（移動幅は下記参照） |
| `prev` | `(): void` | 現在のビュー単位で前の期間へ移動する（移動幅は下記参照） |
| `today` | `(): void` | 今日へ移動する |
| `goTo` | `(date: Date): void` | 指定日へ移動する |
| `setTimeZone` | `(timeZone: TimeZoneId): void` | 表示タイムゾーンを変更する |
| `updateOptions` | `(patch: CalendarOptionsPatch): void` | オプションを部分的に更新する（`initialView` / `initialDate` は作成時専用のため型レベルで受け付けない。`onEventsChange` / `onRangeChange` は `null` で解除できる） |
| `refresh` | `(): void` | 状態を変えずにビューモデルを再構築して通知する（`now()` の再評価。現在時刻線の追従用） |
| `notifyRangeChange` | `(): void` | 現在のビュー・基準日・表示範囲を、直前の通知内容との差分に関わらず `onRangeChange` へ即時通知する（比較基準も更新される。未登録なら基準の更新のみ） |
| `getEvents` | `(): readonly CalendarEvent[]` | すべてのソースイベントを返す（戻り値の配列・各イベントオブジェクトは変更しないこと） |
| `setEvents` | `(events: readonly CalendarEvent[]): void` | イベント一覧を置き換える（外部ストア同期用。`onEventsChange` は呼ばれない。渡した配列・各イベントオブジェクトは以後変更しないこと） |
| `getResources` | `(): readonly CalendarResource[]` | すべてのリソースを返す（表示順。戻り値の配列・各リソースオブジェクトは変更しないこと） |
| `setResources` | `(resources: readonly CalendarResource[]): void` | リソース一覧を置き換える（外部ストア同期用。`events`/`setEvents` と同じ流儀。渡した配列・各リソースオブジェクトは以後変更しないこと） |
| `createEvent` | `(input: CalendarEventInput): CalendarEvent` | イベントを作成し、`id` 確定済みのイベントを返す |
| `updateEvent` | `(id: EventId, patch: CalendarEventPatch, target?: { occurrenceStart: Date; scope: RecurringEditScope }): readonly EventChangeEntry[]` | イベントを更新する。繰り返しは `target` でスコープを指定。戻り値は影響を受けた各イベントの before/after 一覧（undo 用途） |
| `deleteEvent` | `(id: EventId, target?: { occurrenceStart: Date; scope: RecurringEditScope }): readonly EventChangeEntry[]` | イベントを削除する。戻り値は `updateEvent` と同様 |
| `getViewModel` | `(): CalendarViewModel` | 現在のビューに対応するビューモデルを構築して返す |
| `getVisibleRange` | `(): DateRange` | 現在のビューが表示している日時範囲を返す |
| `getOccurrences` | `(range: DateRange): readonly EventOccurrence[]` | 指定範囲のオカレンス一覧を開始時刻順で返す |
| `setDragPreview` | `(preview: DragPreview | null): void` | ドラッグ操作のプレビューを設定する（`null` で解除） |
| `toggleResourceCollapsed` | `(resourceId: string): void` | リソースの折りたたみ状態をトグルする（タイムラインビューのみに影響）。対象が現在のリソース一覧に存在しない ID でも例外を投げない |

`next` / `prev` の移動幅はビューごとに異なります。

| ビュー | 移動幅 |
| --- | --- |
| `month` | 1 ヶ月（月初基準） |
| `week` | 7 日 |
| `day` | 1 日 |
| `list` | `listDays` 日 |
| `year` | 1 年（年初基準） |
| `multiMonth` | `multiMonthCount` ヶ月（月初基準） |
| `resource` | 1 日（`day` と同じ） |
| `timeline` | `timelineDays` 日 |

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

### `createEventHistory`

```ts
function createEventHistory(options: CalendarEventHistoryOptions): CalendarEventHistory

interface CalendarEventHistoryOptions {
  api: CalendarApi;
  limit?: number; // 既定 100。1 未満・非有限値（NaN 等）は 1 にクランプする
}

interface CalendarEventHistory {
  push(changes: readonly EventChangeEntry[]): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  subscribe(listener: () => void): () => void;
}
```

イベント変更の undo/redo 履歴マネージャです（フレームワーク非依存）。「1 操作 = 1 履歴単位」で `EventChangeEntry` の一覧をスタックに積み、`undo`/`redo` は `applyEventChangeEntriesWithApplied` を `api.getEvents()` の内容へ適用し、1 件以上適用できた場合のみ結果を `api.setEvents()` に渡します（`setEvents` は `onEventsChange` を発火させないため、適用自体が新たな履歴を生みません）。React では薄いラッパー `useCalendarHistory` を使うのが基本です。

```ts
import { createEventHistory } from '@koyomi-cal/react';

const history = createEventHistory({ api: calendar.api });
const changes = calendar.api.updateEvent(id, { title: '変更後' });
history.push(changes);
history.undo(); // タイトルを元に戻す
history.redo(); // もう一度変更後の状態にする
```

- `push` — `changes` が空配列なら何もしない。非空なら積み、`redo` スタックを破棄する。`limit` 超過分は最古のエントリから破棄する
- `undo`/`redo` — 対象がなければ `false` を返す。適用直前に期待する状態と食い違うエントリ（ドリフト検出）は安全にスキップする。**1 件も適用できなかった場合は `false` を返し、そのエントリは履歴から破棄される**（反対のスタックには積まれない）。**一部のみ適用できた場合は `true` を返し、実際に適用できたエントリだけが反対のスタックに積まれる**。削除の取り消しは `EventChangeEntry.index` により元の位置に復元される
- `api.subscribe` は監視しない（`setEvents` 以外の要因による状態変化は自動検出しない）

詳細な運用（`push` を呼ぶタイミング、`clear()` を呼ぶべきタイミングなど）は [予定の管理: undo（元に戻す）を実装する](./events.md#undo元に戻すを実装する) を参照してください。

### `@koyomi-cal/react/core`（React 非依存の単体エントリ）

`createCalendar` / `CalendarApi` を含む `src/core/` 配下の公開 API は、`@koyomi-cal/react` のトップレベルエントリだけでなく、**React を一切 import しない**専用エントリ `@koyomi-cal/react/core` からも利用できます。`createCalendar`・`buildXxxViewModel`（月・週日・年・複数月・リソース・タイムライン・リストの全 7 種）・`expandEvents` / `occurrenceKey` / `resolveOccurrence`・繰り返しルールユーティリティ（`expandRecurrence` 等）・タイムゾーンユーティリティ（`fromWallClock` 等）・iCalendar 入出力（`eventsToIcs` / `eventsFromIcs`）・`applyPatch` や `*InWithChanges` 系のイベント変更関数・関連する公開型（`CalendarApi` / `CalendarEvent` / `EventChangeEntry` 等）を再エクスポートしており、`@koyomi-cal/react` のトップレベルエントリが `./core/*` から再エクスポートしている集合と一致します（React コンポーネント・フックは含まれません）。

```ts
import { createCalendar } from '@koyomi-cal/react/core';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.setView('week');
console.log(calendar.getState().view); // => 'week'
```

React を持たない Node.js 環境（サーバーサイドのバッチ処理・CLI ツール等）や他の UI フレームワークから使う場合に利用してください。`react` / `react-dom` は `package.json` の `peerDependencies` として宣言されていますが、`@koyomi-cal/react/core` のみを使う場合は未インストールでも実行時エラーにはなりません。インストール時に出るピア依存の警告は無視して問題ありません。

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

- `options` は**初期値として一度だけ**使われます（後から変更しても反映されません。動的に変更する場合は `api.updateOptions` / `api.setEvents` / `api.setResources` / `api.setTimeZone` を使います）。マウント後に異なる `events` / `resources` 参照を渡し続けた場合、開発ビルドではそれぞれ一度だけ警告が表示されます。
- `onEventsChange` / `onRangeChange` コールバックと `refreshSeconds` だけは常に最新の値が反映されます。
- `onRangeChange` はマウント後（`useEffect` 内）に登録され、登録直後に現在のビュー・基準日・表示範囲で 1 回呼ばれます。レンダー中・SSR（`renderToString`）では呼ばれません。以後は表示範囲に影響する操作のたびに呼ばれます（詳細は [予定の管理: onRangeChange](./events.md#onrangechange-で表示範囲の変更を検知する) を参照）。
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

### `useCalendarAnnouncer`

```ts
function useCalendarAnnouncer(options: UseCalendarAnnouncerOptions): UseCalendarAnnouncerResult

interface UseCalendarAnnouncerOptions {
  calendar: UseCalendarResult;
  politeness?: 'polite' | 'assertive'; // 既定 'polite'
  announce?: AnnouncerTargets;
  messages?: MessageCatalogOverrides;
}

interface UseCalendarAnnouncerResult {
  liveRegionProps: LiveRegionProps;
  message: string;
  announce: (text: string) => void;
  wrapCallbacks: (callbacks?: CalendarInteractionCallbacks) => CalendarInteractionCallbacks;
}

function classifyEventChangeVerb(occurrence: EventOccurrence, change: EventChange): EventChangeVerb
```

予定の変更・作成・削除、およびビュー・基準日・表示範囲の変更を `aria-live` リージョンへ通知するヘッドレスなフックです。`CalendarProvider` の `callbacks` を `wrapCallbacks` でラップし、加えて `calendar` の状態変更を内部で購読します（`announce: { viewChange: true }` のときのみビュー変更を通知）。通知文言は `calendar` の `state.options.locale` から自動的に解決され、`messages`（`MessageCatalogOverrides`）でカタログの `announcer` グループを部分上書きできます（`CalendarProvider` の `messages` prop とは独立に解決されるため、揃えたい場合は同じ値を両方に渡してください）。`classifyEventChangeVerb` は移動・サイズ変更・終日⇔時間指定変換のいずれかをロケールに依存せず判定するヘルパー関数で、`messages.announcer.eventChanged` のようなカスタム文言関数の内部で種別を再利用したい場合に使えます。詳細・カスタマイズ方法は [アクセシビリティ: 変更の読み上げ通知](./accessibility.md#変更の読み上げ通知usecalendarannouncer) を参照してください。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarAnnouncer } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  const announcer = useCalendarAnnouncer({ calendar, announce: { viewChange: true } });
  return (
    <div>
      <div {...announcer.liveRegionProps}>{announcer.message}</div>
      <CalendarProvider value={calendar} callbacks={announcer.wrapCallbacks()}>
        <CalendarView />
      </CalendarProvider>
    </div>
  );
}
```

### `useCalendarHistory`

```ts
function useCalendarHistory(options: UseCalendarHistoryOptions): UseCalendarHistoryResult

interface UseCalendarHistoryOptions {
  calendar: UseCalendarResult;
  limit?: number; // createEventHistory と同じ。マウント時のみ有効
  keyboardShortcuts?: boolean; // 既定 false
}

interface UseCalendarHistoryResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  push(changes: readonly EventChangeEntry[]): void;
  clear(): void;
}
```

イベント変更の undo/redo 履歴（`createEventHistory`）を React に接続するフックです。`canUndo`/`canRedo` は `useSyncExternalStore` で購読され再レンダーに反映されます。`keyboardShortcuts: true` にすると `Ctrl/Cmd+Z`（undo）・`Ctrl/Cmd+Shift+Z` または `Ctrl/Cmd+Y`（redo）が有効になります（`input`/`textarea`/`select`/`contentEditable` にフォーカス中は無効）。UI は提供しないため、undo/redo ボタン等は利用側で組み、`push` は `onEventChange`/`onEventDelete` コールバック内などから明示的に呼びます。詳細は [予定の管理: undo（元に戻す）を実装する](./events.md#undo元に戻すを実装する) を参照してください。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarHistory } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  const history = useCalendarHistory({ calendar, keyboardShortcuts: true });
  return (
    <div>
      <button type="button" disabled={!history.canUndo} onClick={() => history.undo()}>
        元に戻す
      </button>
      <CalendarProvider
        value={calendar}
        callbacks={{ onEventChange: (change) => history.push(change.changes) }}
      >
        <CalendarView />
      </CalendarProvider>
    </div>
  );
}
```

### `useRecurrenceRuleEditor`

```ts
function useRecurrenceRuleEditor(options: UseRecurrenceRuleEditorOptions): UseRecurrenceRuleEditorResult

interface UseRecurrenceRuleEditorOptions {
  start: Date; // 作成時のみ有効（切り替えは reset）
  timeZone: TimeZoneId; // 作成時のみ有効（切り替えは reset）
  rrule?: string; // 作成時のみ有効（切り替えは reset）。省略時は「繰り返しなし」
  locale?: string; // 文言を解決するロケール。既定 'ja'。変更のたびに再解決される
  messages?: MessageCatalogOverrides; // recurrenceEditor グループの部分上書き
}

interface UseRecurrenceRuleEditorResult {
  state: RecurrenceRuleState | null; // null は「繰り返しなし」
  unsupported: { rawRRule: string; reason: RecurrenceUnsupportedReason; message: string } | null;
  setFrequency(freq: RecurrenceFrequency): void;
  setInterval(interval: number): void;
  setByWeekday(weekdays: readonly Weekday[]): void;
  setMonthlyPattern(pattern: MonthlyRecurrencePattern): void;
  setEnd(end: RecurrenceEnd): void;
  enable(): void;
  clear(): void;
  reset(target: Pick<UseRecurrenceRuleEditorOptions, 'start' | 'timeZone' | 'rrule'>): void;
  errors: readonly (RecurrenceValidationIssue & { message: string })[];
  rruleString: string | null;
  description: string | null;
}
```

繰り返しルールをフォーム入力向けの構造化状態として編集するヘッドレスなフックです。RRULE 文字列の相互変換・検証は `core/recurrence-editor` の純関数（`parseRecurrenceRule` 等）に委譲し、このフックは React の状態管理（`state` の保持・setter の安定化）に加えて、`locale` / `messages` から解決した中央メッセージカタログで `errors[].message` / `unsupported.message` / `description` を組み立てます。`start`/`timeZone`/`rrule` は作成時のみ有効（`useCalendar` の `events` と同じ規約）で、編集対象を切り替える場合は `reset({ start, timeZone, rrule })` を呼びます（エディタ全体が新しい編集対象で初期化し直されるため、再マウントは不要です。このフックを使うコンポーネントに一意な `key` を指定して再マウントする方法も引き続き使えます）。`locale` は `Provider` に依存せず、渡さない場合は既定 `'ja'` になります（`useCalendar` の `locale` オプションとは連動しません）。対応範囲・使用例の詳細は [繰り返し予定: 繰り返しルールエディタ](./recurrence.md#繰り返しルールエディタ構造化状態での編集) を参照してください。

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
| `Q` | 複数月表示に切り替え（`views` に `'multiMonth'` を含む場合のみ。既定では無効） |
| `R` | リソース表示に切り替え（`views` に `'resource'` を含む場合のみ。既定では無効） |
| `L` | タイムライン表示に切り替え（`views` に `'timeline'` を含む場合のみ。既定では無効） |
| `T` | 今日へ移動 |
| `J`, `N` | 次の期間へ |
| `K`, `P` | 前の期間へ |
| `C` | `onCreate` を呼ぶ（予定作成 UI の起点） |

`views`（既定 `['month', 'week', 'day', 'list']`）でビュー切替キーの対象ビューを制限します。年・複数月・リソース・タイムラインビューのキーは既定では無効で、`views` に追加すると有効になります（`Toolbar` の `views` prop（下記）と同じ既定値です）。

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
| `previewInvalid` | `boolean` | プレビューが宣言的制約（`eventOverlap`/`eventConstraint`）に違反しているか（`previewRange` が `null` の間は常に `false`） |
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
| `TimeGridPreviewSegment` | `kind: 'create' | 'move' | 'resize'`, `startMinutes: number`, `endMinutes: number`, `invalid?: boolean`（宣言的制約違反時のみ `true`） |

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

インタラクションのコールバック（`onEventClick` / `onSelectRange` / `onBeforeSelectRange` / `onEventChange` / `onBeforeEventChange` / `onEventDelete` / `onBeforeEventDelete` / `onError` / `resolveRecurringScope` / `onOverflowClick` / `onDayNumberClick`）の詳細は [インタラクション](./interactions.md) を参照してください。

### `useResourceGridDrag`

```ts
function useResourceGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): ResourceGridDragHandlers
```

リソースビュー（列 = リソース × 日、縦 = 時間）のドラッグインタラクション（新規作成・移動・リサイズ・列間の移動）を提供する低レベルフックです。`ResourceView` が内部で使用しています。確定時は時間・日付の変更と `resourceId` の変更を 1 つのパッチに合成し、1 回の `updateEvent` を呼びます（複数日表示では別の日の列への移動が日数シフトになります）。

**戻り値 `ResourceGridDragHandlers`**

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `getColumnProps` | `(column: ResourceColumn): ResourceColumnProps` | リソース列要素に付与する props を返す |
| `getAllDayCellProps` | `(column: ResourceColumn): ResourceAllDayCellProps` | 終日行のセル要素に付与する props を返す |
| `getEventProps` | `(item: PositionedOccurrence): ResourceEventProps` | 時間指定イベントブロック用の props を返す |
| `getAllDayItemProps` | `(occurrence: EventOccurrence): ResourceEventProps` | 終日アイテム用の props を返す（列間移動のみ。リサイズなし） |
| `getResizeHandleProps` | `(item: PositionedOccurrence, edge?: 'start' \| 'end'): ResourceResizeHandleProps` | リサイズハンドル用の props を返す（`edge` 省略時は `'end'`） |
| `previewFor` | `(column: ResourceColumn): ResourcePreviewSegment \| null` | 指定列の時間指定ドラッグプレビュー区間を返す |
| `isAllDayPreviewTarget` | `(column: ResourceColumn): boolean` | 指定列が終日プレビューの対象かを返す |
| `isDragging` | `boolean` | ドラッグ操作が進行中か |

**関連する props 型**

| 型 | フィールド |
| --- | --- |
| `ResourceColumnProps` | `ref`, `onPointerDown`, `'data-koyomi-resource'`（レーンキー）, `'data-koyomi-date'`（列の日付キー） |
| `ResourceAllDayCellProps` | `onClick`, `onKeyDown`, `tabIndex`, `'data-koyomi-resource'`（レーンキー）, `'data-koyomi-date'`（列の日付キー） |
| `ResourceEventProps` | `onPointerDown`, `onClick`, `onKeyDown`, `tabIndex`, `'data-koyomi-occurrence'`, `'data-koyomi-dragging'?` |
| `ResourceResizeHandleProps` | `onPointerDown`, `onClick`, `'data-koyomi-resize-handle': 'start' \| 'end'` |
| `ResourcePreviewSegment` | `kind: 'create' | 'move' | 'resize'`, `startMinutes: number`, `endMinutes: number`, `invalid?: boolean`（宣言的制約違反時のみ `true`） |

### `useTimelineDrag`

```ts
function useTimelineDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimelineDragHandlers
```

タイムラインビュー（横 = 時間 × 行 = リソース）のドラッグインタラクション（新規作成・移動・リサイズ・行間のリソース移動）を提供する低レベルフックです。`TimelineView` が内部で使用しています。横位置は「表示分」（`timeAtTimelineOffset` の座標系）で扱い、確定時は `useResourceGridDrag` と同じく時間と `resourceId` の変更を 1 回の `updateEvent` に合成します。

**戻り値 `TimelineDragHandlers`**

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `getRowProps` | `(row: TimelineRow): TimelineRowProps` | リソース行要素に付与する props を返す |
| `getItemProps` | `(item: TimelineItem): TimelineItemProps` | 帯（タイムラインアイテム）用の props を返す |
| `getResizeHandleProps` | `(item: TimelineItem, edge?: 'start' \| 'end'): TimelineResizeHandleProps` | リサイズハンドル用の props を返す（終日の帯には付けない。`edge` 省略時は `'end'`） |
| `previewFor` | `(row: TimelineRow): TimelinePreviewSegment \| null` | 指定行のドラッグプレビュー区間（表示分）を返す |
| `isDragging` | `boolean` | ドラッグ操作が進行中か |

**関連する props 型**

| 型 | フィールド |
| --- | --- |
| `TimelineRowProps` | `ref`, `onPointerDown`, `'data-koyomi-resource'` |
| `TimelineItemProps` | `onPointerDown`, `onClick`, `onKeyDown`, `tabIndex`, `'data-koyomi-occurrence'`, `'data-koyomi-dragging'?` |
| `TimelineResizeHandleProps` | `onPointerDown`, `onClick`, `'data-koyomi-resize-handle': 'start' \| 'end'` |
| `TimelinePreviewSegment` | `kind: 'create' | 'move' | 'resize'`, `startMinutes: number`, `endMinutes: number`, `invalid?: boolean`（宣言的制約違反時のみ `true`） |

リソース/タイムラインの D&D の縦横の軸・合成パッチ・キーボード操作の詳細は [インタラクション: リソースビュー・タイムラインビューのドラッグ操作](./interactions.md#リソースビュータイムラインビューのドラッグ操作) を参照してください。

### `useExternalDrag`

```ts
function useExternalDrag<TPayload>(params: {
  calendar: UseCalendarResult;
  containerRef: RefObject<HTMLElement | null>;
  onExternalDrop: (info: ExternalDropInfo<TPayload>) => void;
  onError?: (error: unknown) => void;
}): ExternalDragHandlers<TPayload>
```

カレンダー外部の DOM 要素からのドラッグを受け入れるフックです（FullCalendar の `Draggable` 相当）。対応ビュー（月・週/日の時間グリッド＋終日行・リソース・タイムライン）が描画されている前提で、ポインタ直下の（`containerRef` の内側にある）カレンダー要素から日時・（リソース/タイムラインビューでは）リソース ID を解決し、既存のプレビュー機構（`api.setDragPreview`）で表示します。イベントの作成自体は行わず、ドロップ確定時に `onExternalDrop` を呼ぶだけです（ヘッドレス原則）。`callbacks`（`CalendarInteractionCallbacks`）は使わず、`onExternalDrop` / `onError` を直接パラメータとして受け取ります（`payload` の型はドラッグ元ごとに異なりうるため）。

`containerRef` は、そのカレンダーインスタンス（`CalendarProvider` とビューコンポーネント）を描画している DOM のルート要素への ref です。ドロップ先のヒットテストはこの要素の内側に限定されるため、ページ上に同じビュー種別のカレンダーが複数存在しても、ドラッグ元とは別のカレンダーの DOM 上へのドロップを誤って受理しません。`current` が `null` の間（マウント前など）はキャンセル扱いになります。

**戻り値 `ExternalDragHandlers<TPayload>`**

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `getDraggableProps` | `(payload: TPayload): ExternalDraggableProps` | 外部要素に付与する props を返す。`payload` はドロップ確定時に `ExternalDropInfo.payload` として渡される |
| `isDragging` | `boolean` | 外部ドラッグが進行中か |

**関連する型**

| 型 | フィールド |
| --- | --- |
| `UseExternalDragParams<TPayload>` | `calendar: UseCalendarResult`, `containerRef: RefObject<HTMLElement \| null>`, `onExternalDrop: (info: ExternalDropInfo<TPayload>) => void`, `onError?: (error: unknown) => void` |
| `ExternalDraggableProps` | `onPointerDown` |
| `ExternalDropInfo<TPayload>` | `range: DateRange`, `allDay: boolean`, `resourceId?: string \| null`, `payload: TPayload` |

外部要素は `data-koyomi-*` 属性フックの対象外（デフォルトテーマは適用されない）で、タッチ対応には自前で `touch-action: none` の指定が必要です。詳細・キャンセル挙動・使用例は [インタラクション: 外部ドラッグ受け入れ](./interactions.md#外部ドラッグ受け入れカレンダー外からのドラッグ) を参照してください。

### `useVirtualizer`

```ts
function useVirtualizer(options: UseVirtualizerOptions): Virtualizer
```

縦・横方向のリストを仮想化する、ビュー非依存のヘッドレスなプリミティブです。`VirtualListView` / `VirtualTimelineView`（縦）・`VirtualResourceView`（横）が内部で使用します。DOM・スタイルは持たず、コア（`computeWindow` / `startForKey`）の純粋計算に、スクロール位置の購読・寸法の実測（`ResizeObserver`）・スクロールアンカリングを結び付けて「描画すべきアイテムと寸法」だけを返します。独自 UI で仮想化したいときに使います。

**オプション `UseVirtualizerOptions`**

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `count` | `number` | アイテム総数 |
| `getItemKey` | `(index: number) => string` | インデックス → 安定キー（測定キャッシュ・フォーカス保持の基準） |
| `estimateSize` | `(index: number) => number` | インデックス → 推定高/幅（px）。実測が入るまでの暫定値 |
| `getScrollElement` | `() => HTMLElement \| null` | スクロールコンテナを返す。戻り値は変わってよい（差し替えに追従） |
| `overscan?` | `number` | 前後の追加描画数（既定 3） |
| `pinnedKeys?` | `ReadonlySet<string>` | 窓外でも保持するキー（フォーカス中アイテム等） |
| `measure?` | `boolean` | `ResizeObserver` で実測するか。`false` で推定固定（既定 `true`） |
| `enabled` | `boolean` | 仮想化の有効化。SSR・初回は `false`、マウント後 `true`（hydration 不一致回避） |
| `axis?` | `'vertical' \| 'horizontal'` | ウィンドウイングする軸（既定 `'vertical'`）。`'horizontal'` は `scrollLeft`/`clientWidth` を使う（`VirtualResourceView` の列方向で使用） |
| `viewportPadding?` | `number` | 可視ビューポートの先頭から差し引く余白（px、既定 0）。スクロールコンテナ内でアイテム列より前に同居する固定表示の見出し（sticky なヘッダー・ガター）の実測寸法を渡す |

**戻り値 `Virtualizer`**

| メンバー | 型 | 説明 |
| --- | --- | --- |
| `virtualItems` | `readonly VirtualItem[]` | 通常フローに並べる可視窓（overscan 込み） |
| `pinnedItems` | `readonly VirtualItem[]` | 窓外で保持する pinned（絶対配置。通常 0〜1 件） |
| `beforeSize` / `afterSize` | `number` | 前後スペーサの高さ/幅（px） |
| `totalSize` | `number` | 全アイテムの合計高/幅（px） |
| `measureElement` | `(key: string) => (el: HTMLElement \| null) => void` | アイテム DOM の実測登録 ref コールバック |
| `scrollToIndex` | `(index, opts?) => void` | 指定インデックスを可視域へスクロール |

`VirtualItem` は `{ index, key, start, size, measured }`。寸法はライブラリが所有せず、スクロールコンテナの寸法は利用者 CSS が決めます（本フックは実測するだけ）。

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
| `CalendarProviderProps` | `{ value: UseCalendarResult; callbacks?: CalendarInteractionCallbacks; messages?: MessageCatalogOverrides; renderEventContent?: EventContentRenderer; children?: ReactNode }` |
| `useCalendarContext` | `(): CalendarContextValue` |

`messages`（`MessageCatalogOverrides`）は、`value.state.options.locale` の言語サブタグで選ばれる同梱カタログ（`ja` / `en`、未対応言語は `ja` にフォールバック）へグループ単位で浅くマージされ、配下の全ビューコンポーネントの文言・aria-label に反映されます。呼び出しのたびに新しいオブジェクトを渡さず、安定した参照（コンポーネント外の定数、または `useMemo` の結果）で渡してください。詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を、全リーフの一覧は [中央メッセージカタログ](#中央メッセージカタログreactlocales) を参照してください。

`renderEventContent`（`EventContentRenderer`）は、配下の全ビューのイベント内容を 1 箇所で定義するビュー横断のイベント内容レンダラーです。年ビューはイベント内容そのものを描画しない（件数マーカーのみ）ため対象外です。ビュー個別の `renderEvent` 系 render prop が指定されているスロットではそちらが優先されます（個別 > 中央 > 既定）。`messages` と同じく安定した参照で渡してください。詳細は [カスタマイズガイド: ビュー横断で一括定義する](./customization.md#ビュー横断で一括定義するrendereventcontent) を参照してください。

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

現在のビュー（`state.view`）に応じて `MonthView` / `TimeGridView` / `ListView` / `YearView` / `MultiMonthView` / `ResourceView` / `TimelineView` を出し分けるスイッチコンポーネントです。ルート要素に `data-koyomi="root"` と `data-koyomi-view` が付きます。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderMonthEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | 月ビューのセグメントのカスタム描画 |
| `renderMonthDayCell` | `(day: MonthDay, ctx: SlotRenderContext) => ReactNode` | 月ビューの日セルのカスタム描画（`MonthView.renderDayCell` へ転送） |
| `monthOverflowButtonProps` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => MonthOverflowButtonProps` | 月ビューの「+N 件」ボタンに追加する props（`MonthView.overflowButtonProps` へ転送） |
| `renderMonthOverflowLabel` | `(day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode` | 月ビューの「+N 件」ラベル内容のカスタム描画（`MonthView.renderOverflowLabel` へ転送） |
| `renderTimeGridEvent` | `(item: PositionedOccurrence, ctx: EventContentContext) => ReactNode` | 週/日ビューのイベントブロックのカスタム描画（時間指定のみ。終日行は `renderTimeGridAllDayEvent` へ） |
| `renderTimeGridAllDayEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | 週/日ビューの終日行の帯のカスタム描画（`TimeGridView.renderAllDayEvent` へ転送）。省略時はタイトルのみ |
| `renderTimeGridDayHeader` | `(day: TimeGridDay, ctx: SlotRenderContext) => ReactNode` | 週/日ビューの日ヘッダーのカスタム描画（`TimeGridView.renderDayHeader` へ転送） |
| `timeGridInitialScrollTime` | `string`（`'HH:mm'`） | 週/日ビューの初期スクロール位置（`TimeGridView.initialScrollTime` へ転送）。`ref` は転送されない |
| `renderListEvent` | `(occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode` | リストビューのイベント行のカスタム描画 |
| `renderListDayHeader` | `(day: ListDay, ctx: SlotRenderContext) => ReactNode` | リストビューの日付見出しのカスタム描画 |
| `virtualizeList` | `boolean` | リストビューを仮想化する（`ListView` の代わりに `VirtualListView`）。既定 `false` |
| `listEstimateDayHeight` | `number \| ((day: ListDay, index: number) => number)` | 仮想化時の日セクション推定高（`VirtualListView.estimateDayHeight` へ転送） |
| `listOverscan` | `number` | 仮想化時の前後 overscan 日数（`VirtualListView.overscan` へ転送） |
| `renderYearMonthHeader` | `(month: YearMonth, ctx: SlotRenderContext) => ReactNode` | 年ビューのミニ月グリッドの見出しのカスタム描画（`YearView.renderMonthHeader` へ転送） |
| `renderYearDayCell` | `(day: YearDay, ctx: SlotRenderContext) => ReactNode` | 年ビューの日セルのカスタム描画（`YearView.renderDayCell` へ転送） |
| `renderMultiMonthEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | 複数月ビューのセグメントのカスタム描画（`MultiMonthView.renderEvent` へ転送） |
| `renderMultiMonthDayCell` | `(day: MonthDay, ctx: SlotRenderContext) => ReactNode` | 複数月ビューの日セルのカスタム描画（`MultiMonthView.renderDayCell` へ転送） |
| `multiMonthOverflowButtonProps` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => MonthOverflowButtonProps` | 複数月ビューの「+N 件」ボタンに追加する props（`MultiMonthView.overflowButtonProps` へ転送） |
| `renderMultiMonthOverflowLabel` | `(day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode` | 複数月ビューの「+N 件」ラベル内容のカスタム描画（`MultiMonthView.renderOverflowLabel` へ転送） |
| `renderResourceEvent` | `(item: PositionedOccurrence, ctx: EventContentContext) => ReactNode` | リソースビューの時間指定イベントブロックのカスタム描画（`ResourceView` / `VirtualResourceView` の `renderEvent` へ転送。終日アイテムは `renderResourceAllDayItem` へ） |
| `renderResourceAllDayItem` | `(occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode` | リソースビューの終日アイテムのカスタム描画（`ResourceView` / `VirtualResourceView` の `renderAllDayItem` へ転送）。省略時はタイトルのみ |
| `renderResourceColumnHeader` | `(column: ResourceColumn, ctx: SlotRenderContext) => ReactNode` | リソースビューの列見出しのカスタム描画（`ResourceView` / `VirtualResourceView` の `renderColumnHeader` へ転送） |
| `resourceInitialScrollTime` | `string`（`'HH:mm'`） | リソースビューの初期スクロール位置（`ResourceView` / `VirtualResourceView` の `initialScrollTime` へ転送）。`ref` は転送されない |
| `virtualizeResource` | `boolean` | リソースビューを仮想化する（`ResourceView` の代わりに `VirtualResourceView`）。既定 `false` |
| `renderTimelineEvent` | `(item: TimelineItem, ctx: EventContentContext) => ReactNode` | タイムラインの帯のカスタム描画（`TimelineView` / `VirtualTimelineView` の `renderEvent` へ転送） |
| `renderTimelineRowHeader` | `(row: TimelineRow, ctx: SlotRenderContext) => ReactNode` | タイムラインの行見出しのカスタム描画（`TimelineView` / `VirtualTimelineView` の `renderRowHeader` へ転送） |
| `virtualizeTimeline` | `boolean` | タイムラインを仮想化する（`TimelineView` の代わりに `VirtualTimelineView`）。既定 `false` |

各ビューの「+N 件」の文言・空状態のメッセージ・未割り当てラベル・イベントや日セクションの aria-label は、`CalendarView` の props ではなく `CalendarProvider` の中央メッセージカタログ（`messages` prop）から解決されます。詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

### `MonthView`

```ts
function MonthView(props: MonthViewProps): ReactElement | null
```

月ビュー（グリッド表示）を描画します。`viewModel.type !== 'month'` の場合は `null` を返します。日セル・帯セグメントのドラッグ操作は `useDayDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | セグメントの表示内容。省略時は終日・複数日セグメントはタイトルのみ、単日の時間指定セグメントは `'H:mm タイトル'` |
| `renderDayCell` | `(day: MonthDay, ctx: SlotRenderContext) => ReactNode` | 日セルの内容（日番号ボタン＋「+N 件」ボタン）をラップ・置換する。祝日ラベルやバッジの注入用 |
| `overflowButtonProps` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => MonthOverflowButtonProps` | 「+N 件」ボタンに追加する props（`aria-haspopup` / `aria-expanded` 等）。省略時は追加の props を付与しない |
| `renderOverflowLabel` | `(day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode` | 「+N 件」ラベルの内容。ボタン要素・クリック配線は保持され、内側だけが差し替わる。`ctx.hiddenOccurrences` に集約された非表示オカレンス一覧が渡る。文言だけの変更は `messages` を使う |

「+N 件」の文言（既定 `messages.month.overflow`）とイベントボタンの aria-label（`messages.common.eventAriaLabel`）は `CalendarProvider` の `messages` prop で差し替えます（[テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) 参照）。ルート要素には WAI-ARIA の grid ロール（`grid` / `row` / `columnheader` / `gridcell`）と、各日セルへの完全な日付の `aria-label`・今日への `aria-current="date"` が付与されます。

### `TimeGridView`

```ts
function TimeGridView(props: TimeGridViewProps): ReactElement | null
```

週/日ビュー（時間グリッド）を描画します。`viewModel.type !== 'timeGrid'` の場合は `null` を返します。終日行のドラッグは `useDayDrag`、時間グリッド本体のドラッグは `useTimeGridDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(item: PositionedOccurrence, ctx: EventContentContext) => ReactNode` | 時間指定イベントの表示内容。省略時は `'H:mm〜H:mm タイトル'`。終日行の内容はこの prop では変更できない（`renderAllDayEvent` を使う） |
| `renderAllDayEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | 終日行（`allday-event`）の帯の表示内容。省略時はタイトルのみ |
| `renderDayHeader` | `(day: TimeGridDay, ctx: SlotRenderContext) => ReactNode` | 日ヘッダー（曜日・日番号）の内容 |
| `initialScrollTime` | `string`（`'HH:mm'`） | マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置。事後の変更は再適用されない |
| `ref` | `Ref<TimeGridViewHandle>` | `scrollToTime(time: string): void` を公開する命令的 API（`[data-koyomi="timegrid-body"]` を対象にスクロール） |

イベントボタン（時間指定・終日行の両方）の aria-label は `messages.common.eventAriaLabel`（`CalendarProvider` の `messages` prop）で差し替えます。

### `ListView`

```ts
function ListView(props: ListViewProps): ReactElement | null
```

表示範囲内の予定を日付ごとの `section` にまとめて一覧表示します。`viewModel.type !== 'list'` の場合は `null` を返します。ドラッグ操作はありません。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode` | イベント行の内容。省略時は時刻ラベル・色見本・タイトル（`ctx.parts` に各部位のノードが渡される） |
| `renderDayHeader` | `(day: ListDay, ctx: SlotRenderContext) => ReactNode` | 日付見出しの内容 |

終日予定の時刻ラベル（既定 `messages.list.allDay`）、空状態のメッセージ（既定 `messages.list.empty`）、イベント行の aria-label（`messages.common.eventAriaLabel`）、日セクションの aria-label（`messages.list.dayAriaLabel`）は `CalendarProvider` の `messages` prop で差し替えます。

### `VirtualListView`

```ts
function VirtualListView(props: VirtualListViewProps): ReactElement | null
```

`ListView` を縦方向に仮想化した opt-in コンポーネントです。可視範囲の日セクションだけを描画し、大量の予定・長期間表示での DOM 肥大を抑えます。日セクションの内容（`data-koyomi-*` 構造）は共有レンダラを通じて `ListView` と完全に一致します（日セクションの既定 aria-label も同じ形式で、仮想化の有無で読み上げは変わりません）。内部で `useVirtualizer` を使用します。

`ListView` の props（`renderEvent` / `renderDayHeader`）に加えて次を受け付けます。

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
| `renderMonthHeader` | `(month: YearMonth, ctx: SlotRenderContext) => ReactNode` | ミニ月グリッドの見出しの内容 |
| `renderDayCell` | `(day: YearDay, ctx: SlotRenderContext) => ReactNode` | 日セルの内容（日番号＋件数マーカー）をラップ・置換する |

日セルの aria-label に含める件数文言「予定N件」部分（既定 `messages.year.dayCount`、予定が 0 件の日には呼ばれない）と aria-label 全体（`messages.year.dayAriaLabel`）は `CalendarProvider` の `messages` prop で差し替えます。ルート要素には月ビューと同じ WAI-ARIA grid ロール（ミニ月単位で `grid` / `row` / `columnheader` / `gridcell`）と、各日セルへの完全な日付＋件数の `aria-label`（例:「7月10日 予定3件」）・今日への `aria-current="date"` が付与されます。`hiddenWeekdays` は無視されます（常に 7 列。日ビューと同じ扱い）。

### `MultiMonthView`

```ts
function MultiMonthView(props: MultiMonthViewProps): ReactElement | null
```

複数月ビュー（`multiMonthCount` ヶ月分の月グリッドを縦に並べたもの）を描画します。`viewModel.type !== 'multiMonth'` の場合は `null` を返します。各月グリッドの内部構造・帯（セグメント）表示・「+N 件」あふれ・ドラッグ操作（作成・移動・リサイズ）は `MonthView` と共有のレンダラを使っており完全に同等です（`useDayDrag` は `MultiMonthView` 全体で単一インスタンス。月境界をまたぐ移動・リサイズも扱えます）。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(segment: EventSegment, ctx: EventContentContext) => ReactNode` | セグメントの表示内容。既定内容は `MonthView` と同じ |
| `renderDayCell` | `(day: MonthDay, ctx: SlotRenderContext) => ReactNode` | 日セルの内容をラップ・置換する。前後月の日付セル（`data-outside`）はインタラクティブでないため適用されない |
| `overflowButtonProps` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[]) => MonthOverflowButtonProps` | 「+N 件」ボタンに追加する props（`MonthView` と同じ） |
| `renderOverflowLabel` | `(day: MonthDay, ctx: MonthOverflowLabelContext) => ReactNode` | 「+N 件」ラベルの内容（`MonthView` と同じ仕様。既定ラベルの整形には `multiMonth.overflow` が使われる） |

「+N 件」の文言（既定 `messages.multiMonth.overflow`）とイベントボタンの aria-label（`messages.common.eventAriaLabel`、`MonthView` と同じ）は `CalendarProvider` の `messages` prop で差し替えます。`MonthView` との違いは、前後月の日付セルに予定を表示しない点だけです。月境界をまたぐ帯は月ごとにクランプされ、`continuesBefore` / `continuesAfter` で「←続く／続く→」を示します（月ビューの複数週セグメントと同じセマンティクス）。前後月の日付セルはクリック・キーボード操作の対象になりません（`tabIndex` なし）。

### `ResourceView`

```ts
function ResourceView(props: ResourceViewProps): ReactElement | null
```

リソースビュー（1 日、列 = リソース × 縦 = 時間）を描画します。`viewModel.type !== 'resource'` の場合は `null` を返します。列・イベントのドラッグ操作は `useResourceGridDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(item: PositionedOccurrence, ctx: EventContentContext) => ReactNode` | 時間指定イベントブロックの表示内容。省略時は `'H:mm〜H:mm タイトル'`（週/日ビューと同じ形式）。終日アイテムには適用されない（`renderAllDayItem` を使う） |
| `renderAllDayItem` | `(occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode` | 終日アイテムの表示内容。省略時はタイトルのみ |
| `renderColumnHeader` | `(column: ResourceColumn, ctx: SlotRenderContext) => ReactNode` | 列見出しの内容（`ctx.defaultContent` はリソース名、または未割り当て列は `messages.resource.unassigned`）をラップ・置換する |
| `initialScrollTime` | `string`（`'HH:mm'`） | マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置。事後の変更は再適用されない |
| `ref` | `Ref<ResourceViewHandle>` | `scrollToTime(time: string): void` を公開する命令的 API（`[data-koyomi="resource-body"]` を対象にスクロール） |

未割り当て列の見出しラベル（既定 `messages.resource.unassigned`）、空状態（列が 1 つもない）のメッセージ（既定 `messages.resource.empty`）、イベントブロックの aria-label（`messages.common.eventAriaLabel`。日時＋リソース名）は `CalendarProvider` の `messages` prop で差し替えます。イベントブロック・リサイズハンドル・現在時刻線・プレビューは週/日ビューと同じ部位名（`timegrid-event` 等）を使い、デフォルトテーマのスタイルを共有します。列見出し行と終日行は `resource-grid` の `role="grid"` 内で `row` / `columnheader` / `gridcell` を構成し、連続時間軸の本文は grid の外に置きます。操作要素は `<button>` + 完全な `aria-label`（日時＋リソース名）です。

### `TimelineView`

```ts
function TimelineView(props: TimelineViewProps): ReactElement | null
```

タイムラインビュー（横 = 時間 × 行 = リソース）を描画します。`viewModel.type !== 'timeline'` の場合は `null` を返します。行・帯のドラッグ操作は `useTimelineDrag` に委譲しています。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `renderEvent` | `(item: TimelineItem, ctx: EventContentContext) => ReactNode` | 帯（タイムラインアイテム）の表示内容。省略時はタイトルのみ（時間指定イベントでは `ctx.parts.timeText` に整形済みの時刻範囲が渡る） |
| `renderRowHeader` | `(row: TimelineRow, ctx: SlotRenderContext) => ReactNode` | 行見出しの内容（`ctx.defaultContent` はリソース名、または未割り当て行は `messages.timeline.unassigned`）をラップ・置換する |

未割り当て行の見出しラベル（既定 `messages.timeline.unassigned`）、空状態（行が 1 つもない）のメッセージ（既定 `messages.timeline.empty`）、ヘッダー行の角セル（行見出し列の列見出し）の `aria-label`（既定 `messages.timeline.corner`）、帯の aria-label（`messages.common.eventAriaLabel`。日時＋リソース名）、折りたたみトグルボタン（`TimelineRow.hasChildren` が `true` の行のみ）の aria-label（`messages.timeline.resourceToggleAriaLabel`）は `CalendarProvider` の `messages` prop で差し替えます。

水平位置は `表示分 / totalMinutes` の % を inline で出力します（位置決めの数値のみ）。スクロールは単一の横スクロールコンテナ（`timeline-body`）で行い、行見出しはテーマ CSS の `position: sticky` で固定します（スクロール同期の JS は持ちません）。目盛りが 1,000 個を超える構成（`timelineDays × ceil(1440 / slotMinutes)`）では開発ビルドで一度だけ警告します。ビュー全体が `role="grid"` で、各行は `rowheader` と時間トラックの `gridcell` を持ちます。帯は `<button>` + 完全な `aria-label`（日時＋リソース名）です。

### `VirtualResourceView`

```ts
function VirtualResourceView(props: VirtualResourceViewProps): ReactElement | null
```

`ResourceView` の列（リソース列）を横方向に仮想化した opt-in の別コンポーネントです（`ResourceView` 自体は変更しません）。可視範囲のリソース列だけを描画し、数百列規模の DOM 肥大を抑えます。DOM 構造・ARIA（`role="grid"` / `row` / `columnheader` / `gridcell`）は `ResourceView` と同じです。内部で `useVirtualizer`（`axis: 'horizontal'`）を使用します。`ref` 経由で `VirtualResourceViewHandle` を公開します。

`ResourceView` の props（`renderEvent` / `renderAllDayItem` / `renderColumnHeader`）に加えて次を受け付けます。時間指定は `renderEvent`、終日アイテムは `renderAllDayItem` でそれぞれ独立にカスタマイズします（`ResourceView` と同じ）。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `columnWidth` | `number` | 列 1 本分の幅（px、既定 160 = `--koyomi-resource-column-width` の既定値と同じ）。列幅は固定 |
| `overscan` | `number` | 前後の追加描画列数（既定 3） |
| `initialScrollTime` | `string`（`'HH:mm'`） | マウント時に一度だけ `scrollToTime` 相当を実行する初期スクロール位置。事後の変更は再適用されない |

**`VirtualResourceViewHandle`**（`ref` で取得）

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `scrollToResource` | `(resourceId: string \| null, options?: { align?: 'auto' \| 'start' \| 'center' }) => void` | 指定リソースの列を可視域へスクロールする（`resourceId: null` は未割り当て列） |
| `scrollToTime` | `(time: string) => void` | ルート `[data-koyomi="resource"]`（横スクロールと共有）を指定時刻の位置へスクロールする |

**境界幅は CSS で指定（必須）**。スクロールコンテナはルート `[data-koyomi="resource"][data-koyomi-virtualized]`（横スクロールを担う要素は非仮想化版と同じ）です。境界幅が無いと仮想化は無害に無効化されます（開発ビルドで一度警告）。フォーカス中の列は窓外へスクロールしても列見出し・終日セル・本文列の 3 箇所がまとめて DOM を保持します。詳細は [ビュー: レーンの仮想化](./views.md#レーンの仮想化リソースタイムラインビュー) を参照してください。

### `VirtualTimelineView`

```ts
function VirtualTimelineView(props: VirtualTimelineViewProps): ReactElement | null
```

`TimelineView` の行（リソース行）を縦方向に仮想化した opt-in の別コンポーネントです（`TimelineView` 自体は変更しません）。可視範囲のリソース行だけを描画し、数百行規模の DOM 肥大を抑えます。DOM 構造・ARIA（`role="grid"` / `row` / `rowheader` / `gridcell`）は `TimelineView` と同じです。内部で `useVirtualizer` を使用します。`ref` 経由で `VirtualTimelineViewHandle` を公開します。

`TimelineView` の props（`renderEvent` / `renderRowHeader`）に加えて次を受け付けます。

| プロパティ | シグネチャ | 説明 |
| --- | --- | --- |
| `estimateRowHeight` | `number \| ((row: TimelineRow, index: number) => number)` | 行の推定高（既定はレーン数 × 28px）。実測が入るまでの暫定値 |
| `overscan` | `number` | 前後の追加描画行数（既定 3） |

**`VirtualTimelineViewHandle`**（`ref` で取得）

| メンバー | シグネチャ | 説明 |
| --- | --- | --- |
| `scrollToResource` | `(resourceId: string \| null, options?: { align?: 'auto' \| 'start' \| 'center' }) => void` | 指定リソースの行を可視域へスクロールする（`resourceId: null` は未割り当て行） |

**境界高は CSS で指定（必須）**。スクロールコンテナは `[data-koyomi="timeline-body"]`（非仮想化版と同じ、既定テーマは `max-height: 640px`）です。境界高が無いと仮想化は無害に無効化されます（開発ビルドで一度警告）。ヘッダー行（日ヘッダー・時刻目盛り）は sticky でスクロールコンテナの先頭に同居するため、`useVirtualizer` の `viewportPadding` にヘッダーの実測高を渡して可視ビューポートから差し引きます。詳細は [ビュー: レーンの仮想化](./views.md#レーンの仮想化リソースタイムラインビュー) を参照してください。

### `Toolbar`

```ts
function Toolbar(props: ToolbarProps): ReactElement

interface ToolbarProps {
  /**
   * ビュー切替ボタンとして表示するビューの一覧（並び順もこの配列に従う）。
   * 既定は `['month', 'week', 'day', 'list']`。年・複数月・リソース・タイムラインは追加した場合のみ有効。
   */
  views?: readonly CalendarViewType[];
}
```

「今日」「前へ」「次へ」のナビゲーション、期間タイトル、ビュー切替（既定は月・週・日・リスト。`views` prop で年・複数月・リソース・タイムラインビュー等を追加できる opt-in）を提供します。タイトルは現在のビューに応じて `formatMonthTitle` / `formatDayTitle` / `formatRangeTitle` / `formatYearTitle` のいずれかで整形されます（複数月ビューは表示範囲の開始月・終了月をそれぞれ `formatMonthTitle` で整形し、「2026年7月〜2026年9月」のように連結します。同一月なら単一表記。リソースビューは日ビューと同じ `formatDayTitle`。タイムラインビューは `timelineDays: 1` なら日ビューと同じ形式、複数日なら `formatRangeTitle` による範囲形式「2026年7月15日〜7月21日」）。範囲タイトルの区切り記号（既定 ja は `'〜'`、en は `'–'`）は `messages.common.rangeSeparator` に従います。ボタンの表示文字列は `CalendarProvider` の `messages` prop（`messages.toolbar`）で差し替えられます（i18n 対応）。ビュー切替ボタングループ（`toolbar-views`）の `aria-label` は `messages.toolbar.viewsGroup` で差し替えられます（既定「表示切替」）。

各コンポーネントの文言をまとめて差し替えたい場合は、`CalendarProvider` の `messages` prop に中央メッセージカタログの部分上書きを渡します（詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照）。

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
| `EventChangeEntry` | `{ before?: CalendarEvent; after?: CalendarEvent; index?: number }`。1 件のイベントの変更前後のスナップショット（undo 用途）。`before` のみは削除、`after` のみは新規作成、両方ありは変更を表す。`index` は挿入位置の復元に使う位置情報（`before` を持つエントリは変更前の一覧内での位置、新規作成のみのエントリは変更後の一覧内での位置） |
| `EventOccurrence` | イベントのオカレンス。下表参照 |
| `RecurringEditScope` | `'this' | 'thisAndFollowing' | 'all'`。繰り返しの編集・削除の適用範囲 |
| `CalendarResource` | カレンダーのリソース（会議室・設備・担当者など、予定の割当先）。下表参照 |
| `DragPreview` | `{ kind: 'create' | 'move' | 'resize'; occurrenceKey: string | null; range: DateRange; allDay: boolean; resourceId?: string | null; invalid?: boolean }`。`resourceId` はリソース/タイムラインビューでの操作時のみ設定される（既存ビューでは省略）。`invalid` は宣言的制約（`eventOverlap`/`eventConstraint`）に違反しているか（省略時は `false` 相当） |

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
| `resourceId?` | `string` | 割当先リソースの ID（[予定の管理: リソース](./events.md#リソース)を参照） |
| `overlap?` | `boolean` | このイベントに他のイベントを重ねてよいか。省略時は `CalendarOptions.eventOverlap`（既定 `true`）に従う |
| `constraint?` | `'businessHours' \| readonly BusinessHoursRule[]` | このイベントのドロップ先を制限する。省略時は `CalendarOptions.eventConstraint` に従う。終日イベントには適用されない |
| `extendedProps?` | `Record<string, unknown>` | 利用者定義の任意データ |

**`CalendarResource` のフィールド**

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `string` | 一意な ID。重複時は先頭のリソースが優先される（先勝ち） |
| `title` | `string` | 表示名 |
| `color?` | `string` | 表示色（CSS の color 値）。リソース/タイムラインビューの列/行見出しと既定色に使用（イベント自身の `color` が優先） |
| `parentId?` | `string` | 親リソースの ID。タイムラインビューでこのリソースを子としてツリー内に配置する（深さは任意段）。参照先のない ID・循環参照（自己参照含む）は孤立したルート（深さ 0）として扱う。リソースビューの列順には影響しない（常にフラット） |
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
| `events?` | `readonly CalendarEvent[]` | `[]`（渡した配列・各イベントオブジェクトは渡した後は変更しないこと） |
| `resources?` | `readonly CalendarResource[]` | `[]`（渡した配列・各リソースオブジェクトは渡した後は変更しないこと） |
| `initialCollapsedResourceIds?` | `readonly string[]` | `[]`（初期状態で折りたたむリソース ID。**作成時専用**。詳細は [ビュー: リソースの階層グルーピング](./views.md#リソースの階層グルーピングparentid折りたたみ) を参照） |
| `timeZone?` | `TimeZoneId` | 実行環境のローカルタイムゾーン（不正な IANA タイムゾーン ID を指定すると `createCalendar` 呼び出し自体が `Error` を投げる。`setTimeZone` と同じ検証規則） |
| `weekStartsOn?` | `Weekday` | `0`（日曜日） |
| `dayMaxEvents?` | `number` | `4` |
| `snapMinutes?` | `number` | `15` |
| `slotMinutes?` | `number` | `60` |
| `timeAxisZones?` | `readonly TimeZoneId[]` | `[]`（週/日ビューの時間軸に並べる追加のタイムゾーン。不正な IANA タイムゾーン ID は `Error`） |
| `defaultEventMinutes?` | `number` | `60` |
| `listDays?` | `number` | `30` |
| `multiMonthCount?` | `number` | `3` |
| `timelineDays?` | `number` | `1` |
| `resourceViewDays?` | `number` | `1`（リソースビューが表示する日数。`2` 以上で列がリソース × 日の直積になる。詳細は [ビュー: リソースビュー](./views.md#リソースビューresource) を参照） |
| `timelineScale?` | `TimelineScale`（`'hour' \| 'day' \| 'week' \| 'month'`） | `'hour'`（タイムラインビューの横軸のズーム粒度。詳細は [ビュー: タイムラインのズーム粒度](./views.md#タイムラインのズーム粒度timelinescale) を参照） |
| `unassignedLane?` | `'auto' \| 'always'` | `'auto'` |
| `locale?` | `string` | `'ja'` |
| `hiddenWeekdays?` | `readonly Weekday[]` | `[]`（非表示にする曜日。7 曜日全指定は無効な設定として無視され、既定の空配列（すべて表示）にフォールバックする。詳細は [ビュー: hiddenWeekdays](./views.md#週末などの曜日を隠すhiddenweekdays) を参照） |
| `showWeekNumbers?` | `boolean` | `false`（月・週ビューに ISO 8601 週番号を表示するか。詳細は [ビュー: 週番号](./views.md#週番号showweeknumbers) を参照） |
| `businessHours?` | `readonly BusinessHoursRule[]` | `[]`（週/日・リソース・タイムラインビューの営業時間の指定。詳細は [ビュー: 営業時間](./views.md#営業時間businesshours) を参照） |
| `eventOverlap?` | `boolean` | `true`（イベントの重なりを許可するかどうかの既定値。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照） |
| `eventConstraint?` | `'businessHours' \| readonly BusinessHoursRule[]` | 未指定（制約なし。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照） |
| `slotMinTime?` | `string`（`'HH:mm'`） | `'00:00'`（週/日・リソースビューで表示する時間帯の開始。詳細は [ビュー: 表示時間帯](./views.md#表示時間帯slotmintimeslotmaxtime) を参照） |
| `slotMaxTime?` | `string`（`'HH:mm'`） | `'24:00'`（表示する時間帯の終了、排他的。`'24:00'` も指定可） |
| `now?` | `() => Date` | `() => new Date()` |
| `onEventsChange?` | `(events: readonly CalendarEvent[]) => void` | なし |
| `onRangeChange?` | `(info: CalendarRangeChangeInfo) => void` | なし（ビュー・基準日・表示範囲のいずれかが変わるたびに 1 回発火。作成直後にも 1 回発火する。FullCalendar の `datesSet` 相当。詳細は [イベントの管理: onRangeChange](./events.md#onrangechange-で表示範囲の変更を検知する) を参照） |

`initialDate` / `initialView` は**作成時専用**です（`updateOptions` は型レベルで受け付けません。変更には `goTo` / `setView` を使います）。

`updateOptions` の引数は `CalendarOptions` そのものではなく `CalendarOptionsPatch` 型です。`initialView` / `initialDate` を受け付けない点は同じですが、`onEventsChange` / `onRangeChange` の 2 フィールドだけは型が異なり、`null` を渡すと登録済みのコールバックを解除できます（フィールドを省略した場合は「変更しない」、`null` を渡した場合は「解除する」の意味になります）。

`resources` は `events` と完全に同型の扱いです（状態の初期値。`ResolvedCalendarOptions` には含まれません）。動的な変更には `getResources` / `setResources`（[予定の管理: リソース](./events.md#リソース)を参照）を使います。

`timelineDays` はタイムラインビュー、`resourceViewDays` はリソースビューの表示日数（いずれも `next()`/`prev()` の移動単位を兼ねる）、`unassignedLane` はリソース/タイムラインビューの未割り当てレーンの生成規則です（`'auto'` = 該当する予定があるときのみ末尾に生成、`'always'` = 常に生成。詳細は [ビュー](./views.md#年複数月リソースタイムラインビューを有効にするopt-in) を参照）。

`ResolvedCalendarOptions` は、表示・展開に使う既定値適用後のオプションだけを持つ型です（`weekStartsOn` / `dayMaxEvents` / `snapMinutes` / `slotMinutes` / `timeAxisZones` / `defaultEventMinutes` / `listDays` / `multiMonthCount` / `timelineDays` / `resourceViewDays` / `timelineScale` / `unassignedLane` / `locale` / `hiddenWeekdays` / `showWeekNumbers` / `businessHours` / `eventOverlap` / `eventConstraint`（未指定は `null`） / `slotMinTime` / `slotMaxTime` / `now`。コールバック類や `initialView` / `initialDate` / `resources` / `initialCollapsedResourceIds` は含みません）。`CalendarViewType` は `'month' | 'week' | 'day' | 'list' | 'year' | 'multiMonth' | 'resource' | 'timeline'` です。

`BusinessHoursRule` は `{ daysOfWeek: readonly Weekday[]; startTime: string; endTime: string }`（`startTime` / `endTime` は `'HH:mm'` 形式。`endTime` のみ日の終端を表す `'24:00'` も指定可。`startTime` が `endTime` 以降、または形式が不正だと `Error`）です。

`CalendarRangeChangeInfo` は `{ view: CalendarViewType; currentDate: Date; rangeStart: Date; rangeEnd: Date }`（`onRangeChange` に渡される変更後のビュー・基準日・表示範囲。`rangeStart`/`rangeEnd` は `getVisibleRange()` と同じ範囲で `rangeEnd` は排他的）です。

### 状態とビューモデル

| 型 | 説明 |
| --- | --- |
| `CalendarState` | `{ view; currentDate; timeZone; events; resources; dragPreview; collapsedResourceIds: ReadonlySet<string>; options: ResolvedCalendarOptions }`。`getState()` の戻り値。`collapsedResourceIds` は折りたたみ中のリソース ID の集合（タイムラインビューのみが参照。`toggleResourceCollapsed` で変更） |
| `CalendarViewModel` | `MonthViewModel | TimeGridViewModel | ListViewModel | YearViewModel | MultiMonthViewModel | ResourceViewModel | TimelineViewModel`。`getViewModel()` の戻り値 |
| `MonthViewModel` | `{ type: 'month'; anchor: Date; weeks: readonly MonthWeek[]; weekdays: readonly Weekday[] }` |
| `MonthWeek` | `{ days: readonly MonthDay[]; segments: readonly EventSegment[]; laneCount: number; weekNumber: number \| null }`。`weekNumber` は `showWeekNumbers: true` のときだけ ISO 8601 週番号が入る（既定 `null`） |
| `MonthDay` | `{ date; key; inCurrentMonth; isToday; overflowCount }` |
| `EventSegment` | `{ occurrence; startCol; span; lane; continuesBefore; continuesAfter; hidden }`。月ビュー・終日行・複数月ビューの帯セグメント |
| `TimeGridViewModel` | `{ type: 'timeGrid'; viewType: 'week' | 'day'; days; allDaySegments; allDayLaneCount; slots; slotMinTimeMinutes: number; slotMaxTimeMinutes: number; timeAxes: readonly TimeAxis[]; nowIndicator; weekNumber: number \| null }`。`weekNumber` は `viewType: 'week'` かつ `showWeekNumbers: true` のときだけ ISO 8601 週番号が入る（それ以外は `null`）。`slotMinTimeMinutes`/`slotMaxTimeMinutes` は `slotMinTime`/`slotMaxTime` を分に変換した値（既定 `0`/`1440`） |
| `TimeGridDay` | `{ date; key; isToday; weekday; items: readonly PositionedOccurrence[]; timeAxes: readonly TimeAxis[]; businessHourSlots: readonly BusinessHourSlot[] }`。`timeAxes` はこの日自身の 0:00 基準（`TimeGridViewModel.timeAxes` は週全体で共有する表示範囲最初の日基準。両者の違いは [タイムゾーン: 複数 TZ 軸](./timezones.md#複数タイムゾーン軸secondary-time-zone)を参照）。`businessHourSlots` は `slots` と同じ並びの営業時間内フラグ（`businessHours` 未指定時はすべて `false`） |
| `BusinessHourSlot` | `{ minutes: number; isBusinessHours: boolean }`。`minutes` は `TimeSlot.minutes` と同じ並び |
| `TimeSlot` | `{ minutes: number; label: string }` |
| `TimeAxis` | `{ timeZone: TimeZoneId; slots: readonly TimeSlot[] }`。時間グリッドの時間軸 1 本分。`timeAxes` は先頭が主軸（表示 TZ、`slots` と同内容）、以降が `timeAxisZones` の指定順の追加軸（[タイムゾーン: 複数 TZ 軸](./timezones.md#複数タイムゾーン軸secondary-time-zone)を参照） |
| `PositionedOccurrence` | `{ occurrence; startMinutes; endMinutes; left; width; continuesBefore; continuesAfter }`。時間グリッドに配置されたオカレンス（割合・分単位）。`continuesBefore`/`continuesAfter` は日境界に加え、表示時間帯（`slotMinTime`/`slotMaxTime`）の境界でも付与される |
| `ListViewModel` | `{ type: 'list'; days: readonly ListDay[]; isEmpty: boolean }` |
| `ListDay` | `{ date; key; isToday; occurrences: readonly EventOccurrence[] }` |
| `YearViewModel` | `{ type: 'year'; anchor: Date; months: readonly YearMonth[]; weekdays: readonly Weekday[] }` |
| `YearMonth` | `{ anchor: Date; key: string; weeks: readonly (readonly YearDay[])[] }`。週数は 4〜6 |
| `YearDay` | `{ date; key; inCurrentMonth; isToday; eventCount }`。前後月の日付（`inCurrentMonth: false`）は常に `eventCount: 0` |
| `MultiMonthViewModel` | `{ type: 'multiMonth'; anchor: Date; months: readonly MultiMonthMonth[]; weekdays: readonly Weekday[] }` |
| `MultiMonthMonth` | `{ anchor: Date; key: string; weeks: readonly MonthWeek[] }`。`weeks` は月ビューと同じ `MonthWeek` だが、前後月の日付セルにはセグメントを配置しない |
| `ResourceViewModel` | `{ type: 'resource'; date: Date; dateKey: string; isToday: boolean; days: readonly ResourceViewDay[]; columns: readonly ResourceColumn[]; isEmpty: boolean; slots: readonly TimeSlot[]; slotMinTimeMinutes: number; slotMaxTimeMinutes: number; nowIndicatorMinutes: number \| null; businessHourSlots: readonly BusinessHourSlot[] }`。`date`/`dateKey`/`isToday` は先頭日、`days` は `resourceViewDays` 日分の表示日一覧。`columns` はリソース × 日の直積（リソース優先で日が昇順に並ぶ）。`businessHourSlots` は先頭日の営業時間内フラグ（日ごとの値は `days[].businessHourSlots`）。`nowIndicatorMinutes` は表示範囲に今日が含まれない場合 `null`。`slotMinTimeMinutes`/`slotMaxTimeMinutes` は `TimeGridViewModel` と同じ意味 |
| `ResourceViewDay` | `{ date: Date; key: string; isToday: boolean; businessHourSlots: readonly BusinessHourSlot[] }`。リソースビューの表示日 1 日分のメタデータ（`businessHourSlots` はその日の曜日基準） |
| `ResourceColumn` | `{ resource: CalendarResource \| null; key: string; date: Date; dayKey: string; isToday: boolean; dayIndex: number; items: readonly PositionedOccurrence[]; allDayItems: readonly EventOccurrence[] }`。`resource: null` は未割り当て列。`key` は単日表示では `` `r:${id}` `` または `'unassigned'`、複数日表示（`resourceViewDays` が `2` 以上）では `` `r:${id}@YYYY-MM-DD` `` / `` `unassigned@YYYY-MM-DD` ``。`date`/`dayKey`/`isToday`/`dayIndex` は列が表す日の情報 |
| `TimelineViewModel` | `{ type: 'timeline'; days: readonly TimelineDay[]; slots: readonly TimelineSlot[]; rows: readonly TimelineRow[]; isEmpty: boolean; totalMinutes: number; nowIndicatorMinutes: number \| null; businessHourRanges: readonly BusinessHourRange[]; scale: TimelineScale; headerGroups: readonly TimelineHeaderGroup[] \| null }`。`businessHourRanges` は営業時間を表示分座標系へ変換し、隣接・重複をマージした区間一覧（開始分昇順。`businessHours` 未指定時は `[]`）。`scale` は適用中のズーム粒度、`headerGroups` は `scale` が `'week'`/`'month'` のときのみ配列（それ以外は `null`） |
| `TimelineScale` | `'hour' \| 'day' \| 'week' \| 'month'`。タイムラインビューの横軸のズーム粒度 |
| `TimelineHeaderGroup` | `{ start: Date; end: Date; key: string; startMinutes: number; endMinutes: number; containsToday: boolean }`。`TimelineViewModel.headerGroups` の要素（週/月単位のヘッダー見出し 1 本分）。`start`/`end` は表示範囲でクランプ済み |
| `BusinessHourRange` | `{ startMinutes: number; endMinutes: number }`。表示分座標系（範囲先頭からの分）の営業時間帯 1 本分。`endMinutes` は排他的 |
| `TimelineDay` | `{ date: Date; key: string; isToday: boolean; weekday: Weekday }` |
| `TimelineSlot` | `{ minutes: number; dayKey: string; label: string }`。`minutes` は「表示分」（範囲先頭からの分。既存 `TimeSlot` と異なり複数日で 1439 を超えうる）。`scale: 'day'` のときは常に空配列 |
| `TimelineRow` | `{ resource: CalendarResource \| null; key: string; items: readonly TimelineItem[]; laneCount: number; depth: number; hasChildren: boolean; collapsed: boolean }`。`resource: null` は未割り当て行。`depth`/`hasChildren`/`collapsed` は `CalendarResource.parentId` によるツリー内の情報（`parentId` 未使用時・未割り当て行は常に `depth: 0`/`hasChildren: false`/`collapsed: false`） |
| `TimelineItem` | `{ occurrence: EventOccurrence; startMinutes: number; endMinutes: number; lane: number; continuesBefore: boolean; continuesAfter: boolean }`。`startMinutes` / `endMinutes` は表示分 |

`nowIndicator` は `{ dayKey: string; minutes: number } | null`（表示範囲内に「今日」がない場合は `null`）です。ビューごとの表示仕様は [ビュー](./views.md) を参照してください。

### React 型（コールバック等）

| 型 | シグネチャ | 説明 |
| --- | --- | --- |
| `UseCalendarResult` | `{ api: CalendarApi; state: CalendarState; viewModel: CalendarViewModel }` | `useCalendar` の戻り値 |
| `CalendarContextValue` | `UseCalendarResult & { callbacks: CalendarInteractionCallbacks; messages: MessageCatalog; renderEventContent: EventContentRenderer \| undefined }` | `useCalendarContext()` の戻り値。`messages` は `state.options.locale` と `CalendarProviderProps.messages` から解決済みの中央メッセージカタログ |
| `SlotRenderContext` | `{ defaultContent: ReactNode }` | すべてのカスタム描画スロットの第 2 引数。`defaultContent` は省略時にライブラリが描画する既定の内容 |
| `EventContentSlot` | `'month-event' \| 'timegrid-event' \| 'allday-event' \| 'list-event' \| 'timeline-item'` | イベント内容スロットの描画枠の種別（外側要素の `data-koyomi` 部位名と同じ語彙） |
| `EventContentParts` | `{ timeText: string \| null; titleText: string; time: ReactNode; swatch: ReactNode; title: ReactNode }` | イベント内容の既定内容を分解したパーツ（詳細は [カスタマイズガイド](./customization.md#イベント内容のカスタマイズctxparts-と-ctxslot)） |
| `EventContentContext` | `SlotRenderContext & { slot: EventContentSlot; view: CalendarViewType; parts: EventContentParts }` | イベント内容スロット（`renderEvent` 系・`renderEventContent`）の第 2 引数。`view` はどのビューでの描画か（同じスロットを複数ビューが使うため、ビュー単位の出し分けに使う） |
| `EventContentRenderer` | `(occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode` | ビュー横断のイベント内容レンダラー（`CalendarProviderProps.renderEventContent`）。優先順位はビュー個別の render prop > 中央 > 既定内容 |
| `RangeSelection` | `{ range: DateRange; allDay: boolean; resourceId?: string | null }` | 範囲選択（新規作成操作）の内容。`resourceId` はリソース/タイムラインビューでの選択時のみ設定される（`null` は未割り当てレーン） |
| `EventChange` | `{ occurrence: EventOccurrence; newRange: DateRange; allDay: boolean; scope: RecurringEditScope | null; resourceId?: string | null; changes: readonly EventChangeEntry[] }` | ドラッグ・キーボードによるイベント変更の内容。`resourceId` はリソース/タイムラインビューでの変更時のみ設定される（`null` は未割り当てへの移動）。`changes` は影響を受けた各イベントの before/after 一覧（undo 用途） |
| `EventChangeProposal` | `{ occurrence: EventOccurrence; range: DateRange; allDay: boolean; resourceId?: string | null; action: 'move' | 'resize' | 'convert' }` | `onBeforeEventChange` の引数。これから適用しようとしている変更の内容（`resourceId` はリソース/タイムラインビューでの変更時のみ設定） |
| `EventDelete` | `{ occurrence: EventOccurrence; scope: RecurringEditScope | null; changes: readonly EventChangeEntry[] }` | キーボード削除の内容。`changes` は `EventChange` と同様 |
| `OverflowClickDetails` | `{ visibleOccurrences: readonly EventOccurrence[] }` | `onOverflowClick` の第 3 引数。その日で表示中のオカレンス一覧（`hiddenOccurrences` と組み合わせて全件を把握できる） |
| `MonthOverflowButtonProps` | `{ 'aria-haspopup'?: 'true' | 'dialog' | 'menu' | 'listbox' | 'tree' | 'grid'; 'aria-expanded'?: boolean; 'aria-controls'?: string }` | 「+N 件」ボタンに追加する props（`overflowButtonProps` の戻り値） |
| `MonthOverflowLabelContext` | `SlotRenderContext & { hiddenOccurrences: readonly EventOccurrence[] }` | 「+N 件」ラベルのカスタム描画スロット（`renderOverflowLabel`）の第 2 引数 |
| `CalendarInteractionCallbacks` | 下表参照 | インタラクションのコールバック集 |

**`CalendarInteractionCallbacks` のフィールド**（すべて省略可能）

| フィールド | シグネチャ | 既定動作 |
| --- | --- | --- |
| `onEventClick?` | `(occurrence: EventOccurrence, domEvent: MouseEvent) => void` | 何もしない |
| `onSelectRange?` | `(selection: RangeSelection) => void` | `messages.common.untitledEvent`（既定 `'(タイトルなし)'`）のタイトルでイベントを即時作成する |
| `onBeforeSelectRange?` | `(selection: RangeSelection) => boolean | Promise<boolean>` | 常に許可する（`true`） |
| `onEventChange?` | `(change: EventChange) => void` | 変更の適用はライブラリが行うため、これは通知のみ |
| `onBeforeEventChange?` | `(proposal: EventChangeProposal) => boolean | Promise<boolean>` | 常に許可する（`true`） |
| `onEventDelete?` | `(deletion: EventDelete) => void` | 削除の適用はライブラリが行うため、これは通知のみ |
| `onBeforeEventDelete?` | `(occurrence: EventOccurrence) => boolean | Promise<boolean>` | 常に許可する（`true`） |
| `onError?` | `(error: unknown) => void` | `console.error` に出力する |
| `resolveRecurringScope?` | `(occurrence: EventOccurrence, action: 'move' | 'resize' | 'delete' | 'update') => Promise<RecurringEditScope | null>` | `'this'`（この予定のみ）を返す |
| `onOverflowClick?` | `(day: MonthDay, hiddenOccurrences: readonly EventOccurrence[], details: OverflowClickDetails) => void` | その日の日ビューに切り替える |
| `onDayNumberClick?` | `(date: Date) => void` | その日の日ビューに切り替える |
| `onEventDoubleClick?` | `(occurrence: EventOccurrence, nativeEvent: MouseEvent) => void` | 何もしない（未指定時は `onDoubleClick` リスナー自体を要素に付けない） |
| `onEventContextMenu?` | `(occurrence: EventOccurrence, nativeEvent: MouseEvent) => void` | 何もしない（`preventDefault` はしない。未指定時は `onContextMenu` リスナー自体を要素に付けない） |
| `onEventHover?` | `(occurrence: EventOccurrence, nativeEvent: MouseEvent) => void` | 何もしない（`pointerenter`。未指定時は `onPointerEnter` リスナー自体を要素に付けない） |
| `onEventHoverEnd?` | `(occurrence: EventOccurrence, nativeEvent: MouseEvent) => void` | 何もしない（`pointerleave`。未指定時は `onPointerLeave` リスナー自体を要素に付けない） |

## 低レベルユーティリティ

ビューコンポーネントやフックが内部で使う、フレームワーク非依存の純粋関数です。独自のビューやインタラクションを組み立てる場合に利用できます。

### タイムゾーン（`core/timezone`）

| 関数 / 型 | 説明 |
| --- | --- |
| `getLocalTimeZone(): TimeZoneId` | 実行環境のローカルタイムゾーン ID を返す |
| `isValidTimeZone(timeZone: string): boolean` | 有効な IANA タイムゾーン ID かどうかを判定する |
| `getWallClock(date, timeZone): Required<WallClockParts>` | 絶対時刻を指定タイムゾーンの現地時刻の成分に分解する |
| `fromWallClock(parts, timeZone, disambiguation?): Date` | 現地時刻の成分から絶対時刻を構築する（存在しない時刻は直後の実在時刻に繰り上げ）。`disambiguation`（`'earlier' \| 'later'`、既定 `'earlier'`）で DST の曖昧な時刻を早い方/遅い方のどちらのオフセットで解決するかを選べる（詳細は [タイムゾーン: 存在しない時刻・曖昧な時刻の解決規則](./timezones.md#存在しない時刻曖昧な時刻の解決規則dst) を参照） |
| `startOfDayInZone(date, timeZone): Date` | 指定タイムゾーンにおけるその日の 0:00 の絶対時刻を返す |
| `addDaysInZone(date, amount, timeZone): Date` | 現地時刻基準で日数を加算する（DST を跨いでも時刻を維持） |
| `addMinutesInZone(date, amount, timeZone): Date` | 現地時刻基準で分数を加算する |
| `dateKeyInZone(date, timeZone): string` | 指定タイムゾーンにおける `'YYYY-MM-DD'` の日付キーを返す |
| `dateFromKey(key, timeZone): Date` | 日付キーからその日の 0:00 の絶対時刻を返す |
| `minutesOfDayInZone(date, timeZone): number` | その日の 0:00 からの経過分（0〜1439）を返す |
| `isSameDayInZone(a, b, timeZone): boolean` | 現地時刻基準で同じ日かどうかを判定する |
| `weekdayInZone(date, timeZone): Weekday` | 指定タイムゾーンにおける曜日を返す |
| `parseDateValue(value, timeZone, allDay): Date` | `CalendarEvent` の `start`/`end` 値を絶対時刻に解釈する |
| `formatSlotLabel(minutes: number, locale: string): string` | 分数を、ロケールに応じた時刻ラベル（`Intl.DateTimeFormat` 整形。`ja` は `'HH:mm'`、`en-US` は `'HH:mm AM/PM'` 等）にする |
| `isoWeekNumberInZone(date, timeZone): number` | 指定タイムゾーンにおける ISO 8601 週番号を返す |
| `parseTimeOfDay(time: string): number` | `'HH:mm'` 形式の時刻文字列をその日の 0:00 からの分に変換する（`formatSlotLabel` の逆変換） |
| `parseSlotBoundaryTime(time: string): number` | `'HH:mm'` を分に変換する（`slotMinTime`/`slotMaxTime` や `BusinessHoursRule.endTime` など日内の時間帯の境界用）。`'24:00'` のみ特例で `1440` を返し、それ以外は `parseTimeOfDay` と同じ |
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
| `isoWeekNumberOfWeek(weekStart, timeZone): number` | 週開始曜日（`weekStartsOn`）に依存しない ISO 8601 週番号を返す（週内の木曜日を基準に算出） |
| `startOfMonthInZone(date, timeZone): Date` | その月の 1 日 0:00 の絶対時刻を返す |
| `addMonthsInZone(date, amount, timeZone): Date` | 指定タイムゾーンの現地時刻を維持したまま月数を加算する（加算後に存在しない日は月末にクランプ。複数月ビューのナビゲーションに使用） |
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

### 繰り返しルールエディタ（`core/recurrence-editor`）

RRULE 文字列とフォーム入力向けの構造化状態（`RecurrenceRuleState`）を相互変換する純粋関数です。対応範囲は `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・`BYDAY`（週の曜日集合、または月の第 n 曜日）・`BYMONTHDAY`（単一値）・`COUNT`/`UNTIL` のみで、範囲外の指定は `parseRecurrenceRule` が `unsupported` として元の文字列を保持します。core は React に依存しないため、検証エラー・非対応理由は機械可読な判別ユニオン（`RecurrenceValidationIssue` / `RecurrenceUnsupportedReason`）として返り、文言化（説明文・検証エラー・非対応理由のメッセージ）は `@koyomi-cal/react` の[中央メッセージカタログ](#中央メッセージカタログreactlocales)（`catalog.recurrenceEditor`）が担います。React では `useRecurrenceRuleEditor` がこれらをまとめてラップします。使用例・対応範囲の詳細は [繰り返し予定: 繰り返しルールエディタ](./recurrence.md#繰り返しルールエディタ構造化状態での編集) を参照してください。

| 関数 / 型 | 説明 |
| --- | --- |
| `parseRecurrenceRule(params): ParsedRecurrenceRule` | RRULE 文字列を構造化状態に変換する（`params.rrule`/`dtstart`/`timeZone`）。対応範囲外・不正な RRULE は `{ kind: 'unsupported', rawRRule, reason }` |
| `validateRecurrenceRuleState(state): readonly RecurrenceValidationIssue[]` | `state` のフィールド単位の検証エラーを返す（空配列なら有効）。副作用・例外のない純関数 |
| `buildRecurrenceRuleString(params): string` | `state` を RRULE 本体文字列に変換する（`params.state`/`dtstart`/`timeZone`）。検証エラーがあると `Error` を投げる |
| `RecurrenceFrequency`（型） | `'daily' \| 'weekly' \| 'monthly' \| 'yearly'` |
| `RecurrenceWeekdayOrdinal`（型） | `1 \| 2 \| 3 \| 4 \| -1`（第 n 週。`-1` は最終週） |
| `MonthlyRecurrencePattern`（型） | `{ kind: 'dayOfMonth'; day: number } \| { kind: 'nthWeekday'; ordinal: RecurrenceWeekdayOrdinal; weekday: Weekday }` |
| `RecurrenceEnd`（型） | `{ type: 'never' } \| { type: 'count'; count: number } \| { type: 'until'; until: Date }`。`until` はイベント TZ の現地時刻として解釈される |
| `RecurrenceRuleState`（型） | `{ freq: RecurrenceFrequency; interval: number; byWeekday?: readonly Weekday[]; monthlyPattern?: MonthlyRecurrencePattern; end: RecurrenceEnd }` |
| `RecurrenceValidationIssue`（型） | 判別ユニオン。`{ field: 'interval'; code: 'invalid' } \| { field: 'byWeekday'; code: 'empty' \| 'duplicate' \| 'outOfRange' } \| { field: 'monthlyPattern'; code: 'dayOfMonthInvalid' \| 'ordinalInvalid' \| 'weekdayInvalid' } \| { field: 'count'; code: 'invalid' } \| { field: 'until'; code: 'invalid' }` |
| `RecurrenceUnsupportedField`（型） | 対応していない RRULE フィールドの安定識別子（`'BYSETPOS' \| 'BYMONTH' \| 'BYYEARDAY' \| 'BYWEEKNO' \| 'BYHOUR' \| 'BYMINUTE' \| 'BYSECOND' \| 'BYEASTER' \| 'BYDAY_EXPANDED' \| 'BYMONTHDAY_EXPANDED'`） |
| `RecurrenceUnsupportedReason`（型） | `parseRecurrenceRule` が対応範囲外と判断した理由の判別ユニオン（`{ code: 'unsupportedField'; field: RecurrenceUnsupportedField }` 等 14 種。`invalidRRuleSyntax` のみ `detail: string` に rrule.js の例外原文を保持） |
| `ParsedRecurrenceRule`（型） | `{ kind: 'none' } \| { kind: 'editable'; state: RecurrenceRuleState } \| { kind: 'unsupported'; rawRRule: string; reason: RecurrenceUnsupportedReason }` |

```ts
import { buildRecurrenceRuleString, parseRecurrenceRule } from '@koyomi-cal/react';

const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00
const parsed = parseRecurrenceRule({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', dtstart, timeZone: 'Asia/Tokyo' });
if (parsed.kind === 'editable') {
  buildRecurrenceRuleString({ state: parsed.state, dtstart, timeZone: 'Asia/Tokyo' });
  // => 'FREQ=WEEKLY;BYDAY=MO,WE'
}
```

### イベント変更（`core/mutations`）

Google カレンダーの編集・削除操作（繰り返しの「この予定のみ / これ以降 / すべて」を含む）を、イベント配列を受け取り新しい配列を返す純粋関数として提供します。`CalendarApi` の CRUD メソッドはこれらに委譲しています。

| 関数 / 型 | 説明 |
| --- | --- |
| `applyPatch(event, patch): CalendarEvent` | イベントにパッチを適用した新しいイベントを返す。パッチのキーが存在し値が `undefined` の場合はそのフィールドを削除する |
| `createEventIn(events, input, context): CreateEventResult` | イベントを追加する。`id` 省略時は `context.generateId()` で採番する |
| `updateEventIn(events, id, patch, target, context): CalendarEvent[]` | イベントを更新する（繰り返しはスコープに従う） |
| `deleteEventIn(events, id, target, context): CalendarEvent[]` | イベントを削除する（繰り返しはスコープに従う） |
| `moveOccurrenceIn(events, id, params, context): CalendarEvent[]` | オカレンスの移動（ドラッグ＆ドロップ）を `updateEventIn` 経由で適用する便利関数。長さは既定で元のオカレンスの長さを維持するが、`newEnd` を省略しつつ `allDay` が変換前の値から変化する場合（時間指定 ⇔ 終日の変換）は、変換前の長さ（ミリ秒）をそのまま引き継がず、終日化はちょうど 1 日・時間指定化は `defaultEventMinutes` を既定の長さとして使う |
| `updateEventInWithChanges(events, id, patch, target, context): EventMutationResult` | `updateEventIn` の拡張版。影響を受けた各イベントの before/after（`changes`）も返す（undo 用途） |
| `deleteEventInWithChanges(events, id, target, context): EventMutationResult` | `deleteEventIn` の拡張版。`changes` も返す |
| `moveOccurrenceInWithChanges(events, id, params, context): EventMutationResult` | `moveOccurrenceIn` の拡張版。`changes` も返す |
| `MutationContext`（型） | `{ displayTimeZone: TimeZoneId; defaultEventMinutes: number; generateId: () => EventId }` |
| `RecurringTarget`（型） | `{ occurrenceStart: Date; scope: RecurringEditScope }` |
| `CreateEventResult`（型） | `{ events: CalendarEvent[]; created: CalendarEvent }` |
| `EventMutationResult`（型） | `{ events: CalendarEvent[]; changes: EventChangeEntry[] }` |
| `EventChangeEntry`（型） | `{ before?: CalendarEvent; after?: CalendarEvent; index?: number }`。`before` のみは削除、`after` のみは新規作成、両方ありは変更を表す。`index` は挿入位置の復元に使う位置情報 |
| `applyEventChangeEntries(events, changes, direction): CalendarEvent[]` | `changes` の各エントリを `direction`（`'before'` = 取り消し／`'after'` = やり直し・再現）の方向へ適用する。対象イベントが想定と食い違うエントリ（presence-only のドリフト検出）は安全にスキップする。現在の一覧に存在しない id を新たに書き込む場合（削除の取り消し・作成のやり直し）は `index` が指す位置に挿入する（省略時は末尾）。undo/redo の実装に使う（詳細は [予定の管理: undo（元に戻す）を実装する](./events.md#undo元に戻すを実装する) を参照） |
| `applyEventChangeEntriesWithApplied(events, changes, direction): EventChangeApplyResult` | `applyEventChangeEntries` の拡張版。適用後のイベント一覧に加えて、実際に適用された（ドリフトによりスキップされなかった）エントリの一覧 `applied` も返す |
| `EventChangeApplyResult`（型） | `{ events: CalendarEvent[]; applied: EventChangeEntry[] }` |
| `EventChangeDirection`（型） | `'before' \| 'after'` |

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
| `resolveOccurrence(params): EventOccurrence | null` | 単一イベントの、指定したオカレンスの開始時刻におけるオカレンスを解決する。任意の `params.master`（`event` がオーバーライドの場合の親イベント）を渡すと、`event.timeZone` 省略時の解釈が `event.timeZone ?? master.timeZone ?? displayTimeZone` の 3 段フォールバックになり、`expandEvents` と同じ解釈が保証される（省略時は `event.timeZone ?? displayTimeZone` の 2 段のみで、マスターの `timeZone` へは継承されない） |

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

### iCalendar 入出力（`core/ics`）

`CalendarEvent[]` と iCalendar（RFC 5545、`.ics`）文字列を相互変換します。終日イベント（`VALUE=DATE`）、イベントごとのタイムゾーン（`TZID`）、繰り返し（`RRULE` / `EXDATE` / `RDATE`）、オーバーライド（`RECURRENCE-ID`）に対応し、行の折り返し（75 オクテット）と TEXT 値のエスケープは RFC 5545 に準拠します。日時・繰り返しの表現の対応と非対応構文の扱いの詳細は [iCalendar（ICS）入出力](./ics.md) を参照してください。

| 関数 / 型 | 説明 |
| --- | --- |
| `eventsToIcs(events, options?): string` | イベントの配列を `VCALENDAR`/`VEVENT` 文字列にする（CRLF 改行） |
| `eventsFromIcs(ics): CalendarEvent[]` | `.ics` テキストをイベントの配列にする（`RECURRENCE-ID` はオーバーライドに変換） |
| `EventsToIcsOptions`（型） | `eventsToIcs` のオプション。`timeZone`（`timeZone` を持たないイベントの解釈に用いるタイムゾーン）/ `defaultEventMinutes` / `dtstamp` / `prodId` |

```ts
import { eventsFromIcs, eventsToIcs } from '@koyomi-cal/react';

const ics = eventsToIcs(
  [
    {
      id: 'weekly',
      title: '週次ミーティング',
      start: '2026-07-06T10:00:00',
      end: '2026-07-06T11:00:00',
      timeZone: 'Asia/Tokyo',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    },
  ],
  { timeZone: 'Asia/Tokyo' },
);
console.log(ics.includes('DTSTART;TZID=Asia/Tokyo:20260706T100000')); // => true

const events = eventsFromIcs(ics);
console.log(events[0]?.rrule); // => 'FREQ=WEEKLY;BYDAY=MO'
```

### インタラクション計算（`core/interaction`）

ドラッグによる予定の作成・移動・リサイズで必要な「ポインタ位置 → 日時」の変換とプレビュー範囲の計算を、DOM に依存しない純粋関数として提供します。`useDayDrag` / `useTimeGridDrag` が内部で使用しています。

| 関数 / 型 | 説明 |
| --- | --- |
| `snapToInterval(minutes, snap): number` | 分数を指定間隔にスナップする（最近傍への丸め） |
| `timeAtGridPosition(params): Date` | 時間グリッドの列内の縦位置（0〜1）から日時を計算する |
| `timeAtTimelineOffset(params): Date` | タイムラインビューの表示分（横位置。範囲先頭からの分、DST を跨いでも現地時刻を維持）から日時を計算する（`timeAtGridPosition` の水平版。`useTimelineDrag` が内部で使用） |
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
console.log(shortcutForKey('q')); // => { type: 'view', view: 'multiMonth' }
console.log(shortcutForKey('r')); // => { type: 'view', view: 'resource' }
console.log(shortcutForKey('l')); // => { type: 'view', view: 'timeline' }
console.log(shortcutForKey('s')); // => null（該当なし）
```

### 宣言的な制約の判定（`core/constraints`）

`eventOverlap` / `eventConstraint` の判定を行う純粋関数群です。ドラッグ中のプレビュー計算（毎 pointermove）とコミット確定（移動・リサイズ・新規作成・外部ドラッグ受け入れ・キーボード操作）の両方が、判定の唯一の入口 `isDragCandidateValid` を同じ呼び方で使います。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照してください。

| 関数 / 型 | 説明 |
| --- | --- |
| `isDragCandidateValid(params): boolean` | 判定の唯一の入口。重なり（`hasBlockingOverlap`）を先に見て、重なりがなければ配置制約（`isRangeWithinBusinessHours`、終日は対象外）を見る |
| `hasBlockingOverlap(candidate, excludeKey, blockers, moverBlocksOverlap): boolean` | `candidate` が `blockers`（`excludeKey` は除外）のいずれかと時間的に重なり、かつ拒否されるべきかを判定する。接触するだけ（`end === start`）は重なりとみなさない |
| `occurrenceBlocksOverlap(event, eventOverlap): boolean` | イベントの重なり許可の実効値（`event.overlap ?? eventOverlap`）が `false` かどうかを判定する |
| `isRangeWithinBusinessHours(range, rules, timeZone): boolean` | `range`（終日を除く）が `rules` の和集合に完全に収まっているか判定する。`rules` が空配列の場合は常に `false` |
| `resolveConstraintRules(constraint, businessHours): readonly BusinessHoursRule[] \| null` | `'businessHours'` 参照を実際のルール配列へ解決する。未指定なら `null` |
| `OverlapBlocker`（型） | `{ key: string; start: Date; end: Date; blocksOverlap: boolean }`。重なり判定の対象となる既存オカレンス 1 件分 |

```ts
import { isDragCandidateValid } from '@koyomi-cal/react';

const valid = isDragCandidateValid({
  range: { start: new Date('2026-07-15T10:00:00+09:00'), end: new Date('2026-07-15T11:00:00+09:00') },
  allDay: false,
  excludeKey: null,
  moverBlocksOverlap: true,
  blockers: [],
  constraintRules: null,
  timeZone: 'Asia/Tokyo',
});
console.log(valid); // => true（重なり・配置制約とも対象がないため常に有効）
```

### ビューモデルビルダー（`core/views`）

各ビューのビューモデルを構築する純粋関数です。`CalendarApi.getViewModel()` が内部で使用しており、通常は直接呼び出す必要はありません。

| 関数 | 説明 |
| --- | --- |
| `buildMonthViewModel(params): MonthViewModel` | 月ビューのビューモデル（週・日・帯セグメント）を構築する。`hiddenWeekdays` で列を除外できる。`params.showWeekNumbers`（省略時 `false`）で各週の `weekNumber` を算出する。`params.segmentRange`（省略可）でセグメント生成と「+N 件」の計上を指定範囲の日に限定できる（省略時はグリッド全域が対象。複数月表示のように月ごとにセグメントを区切りたい場合に使う） |
| `buildTimeGridViewModel(params): TimeGridViewModel` | 週/日ビューのビューモデル（終日行・時間グリッド配置）を構築する。`hiddenWeekdays` 対応。`params.showWeekNumbers`（省略時 `false`）で `viewType: 'week'` のときの `weekNumber` を算出し、`params.businessHours`（省略時 `[]`）で各日の `businessHourSlots` を算出する |
| `buildListViewModel(params): ListViewModel` | リストビューのビューモデル（日付ごとのオカレンス一覧）を構築する |
| `buildYearViewModel(params): YearViewModel` | 年ビューのビューモデル（12 ヶ月分のミニ月グリッド・日ごとの予定件数）を構築する。`hiddenWeekdays` は無視する |
| `buildMultiMonthViewModel(params): MultiMonthViewModel` | 複数月ビューのビューモデル（`multiMonthCount` ヶ月分の月グリッド）を構築する。内部で月ごとに `buildMonthViewModel` を呼び、`segmentRange` を各月本体にクランプすることで前後月の日付セルに予定を出さない |
| `buildResourceViewModel(params): ResourceViewModel` | リソースビューのビューモデル（列 = リソース、列ごとの時間グリッド配置）を構築する。`hiddenWeekdays` は無視する。`params.resources` / `params.unassignedLane` で未割り当て列の生成規則を制御し、`params.businessHours`（省略時 `[]`）で全列共通の `businessHourSlots` を算出する。`params.slotMinTime`/`slotMaxTime`（省略時 `'00:00'`/`'24:00'`）で表示時間帯を制限する |
| `buildTimelineViewModel(params): TimelineViewModel` | タイムラインビューのビューモデル（`params.timelineDays` 日分の「表示分」座標系、行 = リソース、区間レーン割当）を構築する。`hiddenWeekdays` は無視する。`params.businessHours`（省略時 `[]`）で `businessHourRanges`（表示分の区間・マージ済み）を算出する。リソース一覧は内部で `buildResourceTree`/`filterVisibleResourceTree` によりツリー順・折りたたみ済みに整形される（`params.collapsedResourceIds`、省略時 `[]`）。`params.timelineScale`（省略時 `'hour'`）でズーム粒度を切り替える |

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

```ts
import { buildMultiMonthViewModel } from '@koyomi-cal/react';

const multiMonthModel = buildMultiMonthViewModel({
  currentDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  occurrences: [],
  weekStartsOn: 0,
  dayMaxEvents: 4,
  multiMonthCount: 3,
  now: new Date('2026-07-15T00:00:00+09:00'),
});
console.log(multiMonthModel.type); // => 'multiMonth'
console.log(multiMonthModel.months.length); // => 3（7月・8月・9月）
console.log(multiMonthModel.months[0]?.key); // => '2026-07'
```

```ts
import { buildResourceViewModel } from '@koyomi-cal/react';

const resourceModel = buildResourceViewModel({
  currentDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  occurrences: [],
  resources: [{ id: 'room-a', title: '会議室A' }],
  unassignedLane: 'auto',
  slotMinutes: 60,
  now: new Date('2026-07-15T00:00:00+09:00'),
});
console.log(resourceModel.type); // => 'resource'
console.log(resourceModel.columns[0]?.key); // => 'r:room-a'
// resourceViewDays: 2 を渡すと columns はリソース × 日の直積になり、
// キーは 'r:room-a@2026-07-15' / 'r:room-a@2026-07-16' の形式になる
```

```ts
import { buildTimelineViewModel } from '@koyomi-cal/react';

const timelineModel = buildTimelineViewModel({
  currentDate: new Date('2026-07-15T00:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
  occurrences: [],
  resources: [{ id: 'crane-1', title: 'クレーン 1 号機' }],
  unassignedLane: 'auto',
  timelineDays: 7,
  slotMinutes: 60,
  now: new Date('2026-07-15T00:00:00+09:00'),
});
console.log(timelineModel.type); // => 'timeline'
console.log(timelineModel.totalMinutes); // => 10080（7 日 × 1440 分）
```

### リソースの階層グルーピング（`core/views/resource-hierarchy`）

`CalendarResource.parentId` によるツリー構築・折りたたみ表示の絞り込みを行う純粋関数です。タイムラインビュー（`buildTimelineViewModel`）のみが内部で使用します（リソースビューは常にフラットのため参照しません）。

| 関数 / 型 | 説明 |
| --- | --- |
| `buildResourceTree(resources): readonly ResourceTreeEntry[]` | ID 重複を先勝ちで除いたうえで `parentId` からツリー順（深さ優先の行き掛け順）に並べる。循環参照（自己参照含む）は `resources` 配列内で先に出現する側を強制的にルート化し、全リソースを一件も欠落させずに出力する |
| `filterVisibleResourceTree(tree, collapsedResourceIds): readonly VisibleResourceTreeEntry[]` | `tree` から、`collapsedResourceIds` に含まれる祖先を持つ行（折りたたみ中の子孫）を除いた、実際に描画すべき行の一覧を返す |
| `ResourceTreeEntry`（型） | `{ resource: CalendarResource; depth: number; hasChildren: boolean }` |
| `VisibleResourceTreeEntry`（型） | `ResourceTreeEntry & { collapsed: boolean }`。`hasChildren` が `false` のときは常に `collapsed: false` |

```ts
import { buildResourceTree } from '@koyomi-cal/react';

const tree = buildResourceTree([
  { id: 'site', title: '本社' },
  { id: 'floor-1', title: '1F', parentId: 'site' },
]);
console.log(tree.map((entry) => entry.depth)); // => [0, 1]
```

### 日時ラベル整形（`react/components/format`）

ビルトインコンポーネントが使う `Intl.DateTimeFormat` ベースの整形ヘルパです。`timeZone` / `locale` を必須引数として受け取り、暗黙のローカルタイムゾーンには依存しません。`ja` ロケール以外は `Intl` の既定の書式に委ねます。

| 関数 | 説明 |
| --- | --- |
| `formatTime(date, timeZone, locale): string` | `'H:mm'` 形式の時刻ラベル（例: `'9:05'`） |
| `formatMonthTitle(date, timeZone, locale): string` | 月ビューのタイトル（例: `'2026年7月'`） |
| `formatDayTitle(date, timeZone, locale): string` | 日ビューのタイトル（例: `'2026年7月15日(水)'`） |
| `formatRangeTitle(range, timeZone, locale, rangeSeparator): string` | 週/リストビューのタイトル（例: `'7月5日〜7月11日'`）。`rangeSeparator` は開始側・終了側を連結する区切り記号（ビルトインコンポーネントは `messages.common.rangeSeparator` を渡す） |
| `formatViewTitle(view, currentDate, range, timeZone, locale, rangeSeparator): string` | 現在のビューに応じたタイトル。月/日/年は `formatMonthTitle` / `formatDayTitle` / `formatYearTitle` に、週/リスト/複数日表示のリソース・タイムラインは `formatRangeTitle` に委譲し、複数月は開始月・終了月を `rangeSeparator` で連結する（`Toolbar` のタイトルと同じ整形） |
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

### スクロールユーティリティ（`react/scroll-to-time`）

`initialScrollTime`/`scrollToTime`（週/日・リソースビュー）が内部で使う、DOM に依存しない計算部分と副作用部分です。

| 関数 | 説明 |
| --- | --- |
| `scrollFractionForTime(time, rangeStartMinutes, rangeEndMinutes): number \| null` | `'HH:mm'` を範囲内クランプ後の 0〜1 の割合に変換する。`'HH:mm'` として解析できない場合は `null`（例外を投げない） |
| `scrollContainerToTime(element, time, rangeStartMinutes, rangeEndMinutes): void` | スクロールコンテナ（`element`）を指定時刻の位置へスクロールする（`scrollTop` への書き込み）。時刻が解析できない、または `element.scrollHeight` が `0` の場合は何もしない |

```ts
import { scrollFractionForTime } from '@koyomi-cal/react';

console.log(scrollFractionForTime('09:00', 0, 1440)); // => 0.375
console.log(scrollFractionForTime('07:00', 480, 1200)); // => 0（範囲より前はクランプ）
```

詳細は [ビュー: 初期スクロール位置](./views.md#初期スクロール位置initialscrolltime--scrolltotime) を参照してください。

### `overflowPopoverButtonProps`

```ts
function overflowPopoverButtonProps(options: OverflowPopoverButtonOptions): MonthOverflowButtonProps

interface OverflowPopoverButtonOptions {
  open: boolean; // ポップオーバーの開閉状態（aria-expanded にそのまま反映）
  popoverId?: string; // ポップオーバー要素の id。開いている間だけ aria-controls として付与
  haspopup?: MonthOverflowButtonProps['aria-haspopup']; // 既定 'dialog'
}
```

月ビュー・複数月ビューの「+N 件」ボタンに、自前ポップオーバーの開閉状態を伝える ARIA 属性一式（`aria-haspopup` / `aria-expanded` / `aria-controls`）を組み立てる純関数です。`MonthView` / `MultiMonthView` の `overflowButtonProps` から戻り値をそのまま返す用途を想定しています。`aria-controls` は `open: true` かつ `popoverId` 指定時のみ付与されます（閉じている間はポップオーバー要素が DOM に存在しない前提のため）。

```ts
import { overflowPopoverButtonProps } from '@koyomi-cal/react';

console.log(overflowPopoverButtonProps({ open: false, popoverId: 'popover' }));
// => { 'aria-haspopup': 'dialog', 'aria-expanded': false }
console.log(overflowPopoverButtonProps({ open: true, popoverId: 'popover' }));
// => { 'aria-haspopup': 'dialog', 'aria-expanded': true, 'aria-controls': 'popover' }
```

フォーカス復帰の規約などポップオーバー実装時の指針は [アクセシビリティ: 「+N 件」ポップオーバーの ARIA 属性とフォーカス復帰](./accessibility.md#n-件ポップオーバーの-aria-属性とフォーカス復帰) を、開閉状態の配線例は [インタラクション: 「+N 件」のポップオーバーを自前で組む](./interactions.md#n-件のポップオーバーを自前で組む) を参照してください。

## 中央メッセージカタログ（`react/locales`）

ビルトインコンポーネント・フックが表示するすべての文言は、`CalendarOptions.locale` と `CalendarProvider` の `messages` prop から解決される単一の `MessageCatalog` にまとまっています。使い方・具体例は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

```ts
function resolveMessageCatalog(
  locale: string,
  overrides?: MessageCatalogOverrides,
  fallbackLanguage?: string,
): MessageCatalog

function createMessageCatalog(base: MessageCatalog, overrides?: MessageCatalogOverrides): MessageCatalog

const jaMessages: MessageCatalog; // CalendarOptions.locale の既定値（'ja'）に対応する同梱カタログ
const enMessages: MessageCatalog; // 言語サブタグが 'en' のときに選ばれる同梱カタログ

type EventChangeVerb = 'moved' | 'resized' | 'convertedToAllDay' | 'convertedToTimed';
```

`resolveMessageCatalog(locale, overrides?, fallbackLanguage?)` は、`locale` の言語サブタグ（`-` より前、大文字小文字は区別しない）で `jaMessages` / `enMessages` のいずれかを選び（同梱にない言語は `fallbackLanguage` のカタログへフォールバック。`fallbackLanguage` も省略時・同梱にない場合は `'ja'` へフォールバック）、`overrides`（`MessageCatalogOverrides`）を各グループ単位で浅くマージした完全なカタログを返します。`CalendarProvider` の `messages` prop、`useCalendarAnnouncer` / `useRecurrenceRuleEditor` の `messages` オプションは、いずれも内部でこの関数を使ってカタログを解決します。

`createMessageCatalog(base, overrides?)` は、`resolveMessageCatalog` が内部で使うグループ単位のマージをそのまま公開したヘルパーです。`base` には `jaMessages` / `enMessages` に限らず任意の完全なカタログを渡せるため、既存の言語に近いカタログを `base` にして異なるリーフだけを `overrides` に指定すれば、全リーフを書き直さずに新しい言語のカタログを合成できます。

`MessageCatalog` は次のグループを持つ 2 階層固定（グループ→リーフ）の型です。グループ自体は個別に named export されていないため、`MessageCatalog['グループ名']`（例: `MessageCatalog['toolbar']`）として参照してください。

| グループ | 対応するコンポーネント/フック | 主なリーフ |
| --- | --- | --- |
| `common` | 全ビュー共通 | `untitledEvent`（既定即時作成のタイトル）、`rangeSeparator`（日時範囲の区切り、既定 `'〜'`）、`eventAriaLabel(occurrence, parts)`（イベントの aria-label 全文。`parts.rangeLabel`・リソース名を含むビューのみ渡る `parts.resourceLabel`） |
| `toolbar` | `Toolbar` | `month`/`week`/`day`/`list`/`year`/`multiMonth`/`resource`/`timeline`/`today`/`prev`/`next`（表示文字列・aria-label）、`viewsGroup`（ビュー切替グループの aria-label） |
| `list` | `ListView` / `VirtualListView` | `allDay`（終日ラベル）、`empty`（空状態）、`dayAriaLabel(day, dateLabel)`（日セクションの aria-label） |
| `month` | `MonthView` | `overflow(count)`（「+N 件」の表示内容） |
| `multiMonth` | `MultiMonthView` | `overflow(count)`（「+N 件」の表示内容） |
| `resource` | `ResourceView` / `VirtualResourceView` | `unassigned`（未割り当て列ラベル）、`empty`（空状態） |
| `timeline` | `TimelineView` / `VirtualTimelineView` | `unassigned`（未割り当て行ラベル）、`empty`（空状態）、`corner`（角セルの aria-label）、`resourceToggleAriaLabel(resource, collapsed)`（折りたたみボタンの aria-label） |
| `year` | `YearView` | `dayCount(count)`（件数文言「予定N件」部分）、`dayAriaLabel(day, parts)`（日セルの aria-label 全体。`parts.dateLabel`・`parts.countLabel`（`dayCount` の結果、0 件の日は `null`）） |
| `announcer` | `useCalendarAnnouncer` | `unassignedResource`、`eventChanged(change, verb, rangeLabel, resourceLabel)`、`eventCreated(event, selection, rangeLabel, resourceLabel)`、`eventDeleted(deletion)`、`viewChanged(info, title)` |
| `recurrenceEditor` | `useRecurrenceRuleEditor` | `describeRule(state, context?)`（説明文）、`validationMessage(issue)`（検証エラー文言）、`unsupportedReason(reason)`（非対応理由の文言） |

`EventChangeVerb` は、移動・サイズ変更・終日⇔時間指定変換のいずれかを表す、ロケールに依存しない判定結果です。`messages.announcer.eventChanged` のようなカスタム文言関数の第 2 引数として渡され、`useCalendarAnnouncer` からは `classifyEventChangeVerb` としても公開されています。

```ts
import { createMessageCatalog, enMessages, resolveMessageCatalog } from '@koyomi-cal/react';

resolveMessageCatalog('en-US').toolbar.today; // => 'Today'
resolveMessageCatalog('fr').toolbar.today; // => '今日'（未対応言語は 'ja' にフォールバック）
resolveMessageCatalog('fr', undefined, 'en').toolbar.today; // => 'Today'（フォールバック先を 'en' に変更）
resolveMessageCatalog('ja', { month: { overflow: (count) => `他${count}件` } }).month.overflow(3);
// => '他3件'（他のグループは既定のまま）

// en に近い独自のカタログを、異なる文言だけ書いて合成する
const customMessages = createMessageCatalog(enMessages, {
  toolbar: { today: "Today's schedule" },
});
customMessages.toolbar.week; // => 'Week'（enMessages のまま）
```

## 関連ページ

- [はじめに](./getting-started.md)
- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [繰り返し予定](./recurrence.md)
- [iCalendar（ICS）入出力](./ics.md)
- [アクセシビリティ](./accessibility.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
