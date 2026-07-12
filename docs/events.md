# 予定の管理

カレンダーに表示する予定（`CalendarEvent`）の構造と、`createCalendar` /
`useCalendar` が提供する CRUD API の使い方を説明します。

## CalendarEvent

`CalendarEvent` は利用者がカレンダーに与える予定の定義（ソースデータ）です。
繰り返し予定の場合、1 件の `CalendarEvent` が表示範囲に応じて複数の
[`EventOccurrence`（オカレンス）](#オカレンスeventoccurrenceとは)に展開されます。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `string` | 一意な ID。繰り返し例外（オーバーライド）イベントも独自の ID を持ちます。 |
| `title` | `string` | 予定のタイトル。 |
| `start` | `Date \| string` | 開始日時。終日イベントの場合は日付（`'YYYY-MM-DD'` も可）。 |
| `end` | `Date \| string`（省略可） | 終了日時（**排他的**）。終日イベントの場合は日付（排他的）。省略時は、時間指定イベントは開始から `defaultEventMinutes` 分、終日イベントは 1 日とみなします。 |
| `allDay` | `boolean`（省略可） | 終日イベントかどうか。既定は `false`。 |
| `timeZone` | `string`（省略可） | このイベントのタイムゾーン（IANA ID）。繰り返しの展開（現地時刻の維持、DST 跨ぎ）に使用します。省略時はカレンダーの表示タイムゾーン。 |
| `rrule` | `string`（省略可） | RFC 5545 の繰り返しルール。詳細は [繰り返し予定](./recurrence.md) を参照。 |
| `exdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しから除外するオカレンスの開始日時（EXDATE 相当）。 |
| `rdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しに追加するオカレンスの開始日時（RDATE 相当）。`rrule` と併用可。 |
| `recurringEventId` | `string`（省略可） | 繰り返し例外イベントの場合、元となる繰り返しイベントの ID。 |
| `originalStart` | `Date \| string`（省略可） | 繰り返し例外イベントの場合、置き換え対象となるオカレンスの本来の開始日時。 |
| `color` | `string`（省略可） | 表示色。デフォルトテーマでは背景色として使用される（CSS の color 値）。 |
| `location` | `string`（省略可） | 場所。 |
| `description` | `string`（省略可） | 説明文。 |
| `editable` | `boolean`（省略可） | 変更操作を許可するか。既定は `true`。`false` の場合、表示・クリックは可能だがドラッグ移動・リサイズ・キーボードでの移動/リサイズ/削除はすべて無効になります。 |
| `resourceId` | `string`（省略可） | 割当先リソースの ID（[リソース](#リソース)を参照）。リソース/タイムラインビューで使用します。 |
| `extendedProps` | `Record<string, unknown>`（省略可） | 利用者定義の任意データ。ライブラリは内容に関知しません。 |

`rrule` / `exdates` / `rdates` / `recurringEventId` / `originalStart` の詳細な挙動は
[繰り返し予定](./recurrence.md) にまとめています。

### extendedProps に型を付けて使う

`extendedProps` は意図的に `Record<string, unknown>` のままにしています（型引数をライブラリ全体（`CalendarApi` / ビューモデル / 全コンポーネント props）に伝播させると利用側の型が複雑になりすぎるため）。アプリ固有の型で扱いたい場合は、読み出し側で絞り込むヘルパを 1 つ用意するのが簡単です。

```ts
import type { CalendarEvent } from '@koyomi-cal/react';

/** アプリ固有のメタデータ。 */
interface MyEventMeta {
  ownerId: string;
  category: 'work' | 'private';
}

/** extendedProps をアプリ固有の型として読み出す（キャスト不要の絞り込み）。 */
function metaOf(event: CalendarEvent): MyEventMeta | undefined {
  const meta = event.extendedProps;
  const ownerId = meta?.['ownerId'];
  const category = meta?.['category'];
  if (typeof ownerId === 'string' && (category === 'work' || category === 'private')) {
    return { ownerId, category };
  }
  return undefined;
}
```

### start / end の指定形式

`start` / `end` には次の 4 形式を指定できます。

- **`Date` オブジェクト** — そのまま絶対時刻として扱う（終日イベントの場合はタイムゾーンにおけるその日の 0:00 に切り捨て）
- **`'YYYY-MM-DD'`** — 指定タイムゾーンにおけるその日の 0:00
- **オフセット付き ISO 8601**（例: `'2026-07-01T10:00:00Z'`、`'2026-07-01T10:00:00+09:00'`） — 記載どおりの絶対時刻
- **オフセットなし ISO 8601**（例: `'2026-07-01T10:00:00'`） — `timeZone`（イベントに指定がなければカレンダーの表示タイムゾーン）の**現地時刻**として解釈

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

// 1. Date オブジェクト（絶対時刻としてそのまま解釈）
calendar.createEvent({ id: 'a', title: 'A', start: new Date('2026-07-01T01:00:00Z') });
// 2. オフセット付き ISO 8601（記載どおりの絶対時刻）
calendar.createEvent({ id: 'b', title: 'B', start: '2026-07-01T01:00:00Z' });
// 3. オフセットなし ISO 8601（timeZone の現地時刻として解釈: 東京 10:00 = UTC 01:00）
calendar.createEvent({ id: 'c', title: 'C', start: '2026-07-01T10:00:00' });

const occurrences = calendar.getOccurrences({
  start: new Date('2026-06-30T00:00:00Z'),
  end: new Date('2026-07-02T00:00:00Z'),
});
// a・b・c はいずれも同じ絶対時刻 2026-07-01T01:00:00.000Z のオカレンスになる
```

### end の排他性

`end` は時間指定・終日のどちらでも**排他的**です。時間指定イベントは
`start <= t < end` の区間を占有し、終日イベントは日付の範囲が `end` の日を
含みません（例: 7/1〜7/2 の 2 日間の予定は `start: '2026-07-01'`,
`end: '2026-07-03'`）。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'trip',
  title: '出張',
  start: '2026-07-01',
  end: '2026-07-03', // 排他的 → 7/1・7/2 の 2 日間（7/3 は含まない）
  allDay: true,
});

const [occurrence] = calendar.getOccurrences({
  start: new Date('2026-06-25T00:00:00Z'),
  end: new Date('2026-07-10T00:00:00Z'),
});
// occurrence.start と occurrence.end はちょうど 2 日分の幅を持つ
const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
// occurrence.end.getTime() - occurrence.start.getTime() === twoDaysMs
```

`start >= end`（終了が開始以前）となる不正な時刻範囲を `createEvent` / `updateEvent`
に渡しても `Error` にはならず、そのままイベントとして保存されます。ただし、そのイベントは
（範囲が空であるため）`getOccurrences` が返すオカレンス一覧には決して含まれず、
どのビューにも表示されません。

## リソース

`CalendarResource` は会議室・設備・担当者など、予定の割当先を表す型です。`CalendarEvent.resourceId` でイベントをリソースに割り当てます。リソース/タイムラインビューで使用します。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `string` | 一意な ID。重複する場合は先頭のリソースが優先されます（先勝ち）。 |
| `title` | `string` | 表示名。 |
| `color` | `string`（省略可） | 表示色（CSS の color 値）。リソース/タイムラインビューの列/行見出しと、そのビュー内で `event.color` 未指定のイベントの既定色になります（イベント自身の `color` が常に優先。既存ビューの描画には影響しません）。 |
| `extendedProps` | `Record<string, unknown>`（省略可） | 利用者定義の任意データ。ライブラリは内容に関知しません。 |

表示順は `resources` 配列の並び順です（`order` のような専用フィールドは持ちません）。

`CalendarOptions.resources`（既定 `[]`）はカレンダーが保持するリソース一覧です。`events` と完全に同型の扱いで、**作成時の初期値としてのみ有効**です（マウント後に異なる配列参照を渡しても反映されません。開発ビルドでは一度だけ警告されます）。動的に変更するには `calendar.api.setResources(nextResources)` を使います。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  resources: [
    { id: 'room-a', title: '会議室A' },
    { id: 'room-b', title: '会議室B' },
  ],
  events: [{ id: '1', title: '定例会議', start: '2026-07-01T10:00', resourceId: 'room-a' }],
});

console.log(calendar.getResources().map((r) => r.title)); // => ['会議室A', '会議室B']

// resources を動的に置き換える場合は setResources を使う（events の setEvents と同じ流儀）
calendar.setResources([{ id: 'room-a', title: '会議室A（改称）' }]);
```

`resourceId` を持たないイベント、または `resources` に存在しない ID を指すイベント（参照先のないリソース ID）は「未割り当て」として扱われます。黙って非表示にはならず、リソース/タイムラインビューでは専用のレーンに表示されます。

## イベントの CRUD

`CalendarApi`（`createCalendar` の戻り値、または `useCalendar().api`）は
イベント一覧を操作する次のメソッドを提供します。

- `getEvents()` — すべてのソースイベントを返す
- `setEvents(events)` — イベント一覧を置き換える（外部ストアとの同期用）
- `createEvent(input)` — イベントを作成する（`id` 省略時は自動採番）。既存イベントと
  重複する `id` を明示的に指定した場合は `Error` を投げます（`CalendarResource.id` の
  重複が先勝ちで許容されるのとは異なる規則です）
- `updateEvent(id, patch, target?)` — イベントを更新する。影響を受けた各イベントの
  before/after 一覧（`readonly EventChangeEntry[]`）を返す
- `deleteEvent(id, target?)` — イベントを削除する。`updateEvent` と同様、影響を受けた
  各イベントの before/after 一覧を返す

繰り返しイベントに対する `updateEvent` / `deleteEvent` の第 3 引数
`target`（対象オカレンスと適用範囲）については [繰り返し予定](./recurrence.md) を
参照してください。単発イベントでは省略します。

`updateEvent` / `deleteEvent` の戻り値（`EventChangeEntry[]`）を使った
undo（元に戻す）UI の実装方法は
[undo（元に戻す）を実装する](#undo元に戻すを実装する) を参照してください。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

// id を省略すると 'koyomi-1' のような連番 ID が自動採番される
const created = calendar.createEvent({ title: '新しい予定', start: '2026-07-01T10:00:00' });
// created.id === 'koyomi-1'

calendar.updateEvent(created.id, { title: '更新後のタイトル' });
// calendar.getEvents()[0].title === '更新後のタイトル'

calendar.deleteEvent(created.id);
// calendar.getEvents() は空配列になる
```

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

// setEvents はイベント一覧を丸ごと置き換える（外部ストアとの同期の入口）
calendar.setEvents([
  { id: 'x1', title: 'X1', start: '2026-07-01T09:00:00' },
  { id: 'x2', title: 'X2', start: '2026-07-02T09:00:00' },
]);

// getEvents() は setEvents で渡した内容をそのまま返す
const events = calendar.getEvents();
// events.map((e) => e.id) は ['x1', 'x2']
```

## パッチ規則（applyPatch）

`updateEvent` の `patch` は部分更新（`CalendarEventPatch`）です。適用規則は
次のとおりです。

- patch に**キーが存在し値が `undefined`** の場合、そのフィールドを**削除**する（例: `{ rrule: undefined }` で繰り返しを解除する）
- patch に**キーが存在しなければ**、そのフィールドは変更しない
- 必須フィールド（`id` / `title` / `start`）は `undefined` を渡しても削除されず、元の値を維持する
- `CalendarEventPatch` の各フィールドは明示的に `| undefined` を許容する型になっているため、`exactOptionalPropertyTypes: true` を有効にした利用者コードでも `{ rrule: undefined }` のようなリテラルをそのまま型エラーなく書けます

この規則はコアの純粋関数 `applyPatch` として実装されており、単体でも利用できます。

```ts
import { applyPatch, type CalendarEvent } from '@koyomi-cal/react';

const event: CalendarEvent = {
  id: 'e1',
  title: '会議',
  start: '2026-07-01T10:00:00',
  rrule: 'FREQ=WEEKLY',
};

// キーが存在し値が undefined → フィールドを削除する（繰り返しの解除）
const withoutRrule = applyPatch(event, { rrule: undefined });
// 'rrule' in withoutRrule === false

// キーを渡さなければ変更されない
const renamed = applyPatch(event, { title: '別タイトル' });
// renamed.rrule === 'FREQ=WEEKLY'（変更なし）
// renamed.title === '別タイトル'
```

`updateEvent` でも同じ規則が適用されるため、`calendar.updateEvent(id, { rrule: undefined })`
のように呼べば繰り返しの解除ができます。

## onEventsChange で外部ストアと同期する

`onEventsChange` は `createEvent` / `updateEvent` / `deleteEvent`
（ドラッグ操作による変更を含む）でイベント一覧が変わるたびに呼ばれます。
一方で **`setEvents` は `onEventsChange` を呼びません**。これは
「外部ストア → カレンダー」の同期をエコー（無限ループ）なしに行うための
設計です。

- カレンダー側の操作（作成・編集・削除・ドラッグ）→ `onEventsChange` で検知し、外部ストアやサーバーへ保存する
- 外部側の変更（サーバー push など）→ `calendar.api.setEvents(...)` でカレンダーに反映する（`onEventsChange` は再度呼ばれない）

```tsx
import { useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent } from '@koyomi-cal/react';

function useCalendarSyncedWithServer(initialEvents: CalendarEvent[], saveToServer: (events: readonly CalendarEvent[]) => void) {
  const calendar = useCalendar({
    events: initialEvents,
    // createEvent / updateEvent / deleteEvent のたびに呼ばれる。
    // setEvents 経由の変更では呼ばれない
    onEventsChange: (events) => {
      saveToServer(events);
    },
  });

  // サーバーからの push 通知などカレンダー外部で発生した変更を反映する場合は
  // setEvents を使う。onEventsChange は呼ばれないため、受け取った内容を
  // そのまま saveToServer へ送り返すエコーは起きない
  function applyRemoteEvents(remoteEvents: readonly CalendarEvent[]) {
    calendar.api.setEvents(remoteEvents);
  }

  return { calendar, applyRemoteEvents };
}
```

## onRangeChange で表示範囲の変更を検知する

`onRangeChange` は、表示ビュー・基準日・表示範囲のいずれかが変わったときに 1 回呼ばれます（FullCalendar の `datesSet` 相当）。**作成直後（初期化時）にも 1 回発火**します。

```tsx
import { useCalendar } from '@koyomi-cal/react';
import type { CalendarRangeChangeInfo } from '@koyomi-cal/react';

function useCalendarWithFetch() {
  const calendar = useCalendar({
    initialView: 'month',
    onRangeChange: (info: CalendarRangeChangeInfo) => {
      // info.view / info.currentDate / info.rangeStart / info.rangeEnd を使って
      // サーバーから表示範囲分のイベントを取得する、など
      fetchEvents(info.rangeStart, info.rangeEnd).then((events) => {
        calendar.api.setEvents(events);
      });
    },
  });
  return calendar;
}

// 期待される動作:
// - useCalendar() 呼び出し直後に 1 回発火する（初期表示分の取得に使える）
// - setView / goTo / next / prev のたびに、新しい表示範囲で発火する
// - createEvent / updateEvent / deleteEvent / setEvents など、
//   ビュー・基準日・表示範囲に無関係な変更では発火しない
```

`rangeStart` / `rangeEnd` は `calendar.api.getVisibleRange()` と同じ範囲です（`rangeEnd` は排他的）。実質的に無変化な呼び出し（同じビューへの `setView` や同じ日時への `goTo` など）では発火しません。

## undo（元に戻す）を実装する

`updateEvent` / `deleteEvent`（ドラッグ操作から呼ばれる場合を含む）は、
影響を受けた各イベントの変更前後のスナップショット `readonly EventChangeEntry[]`
を返します。

```ts
interface EventChangeEntry {
  before?: CalendarEvent; // 変更前のイベント。新規作成の場合は存在しない
  after?: CalendarEvent; // 変更後のイベント。削除の場合は存在しない
}
```

- **`before` のみ（`after` なし）** — そのイベントは削除された
- **`after` のみ（`before` なし）** — そのイベントは新規作成された
  （繰り返しの `scope: 'this'` によるオーバーライド生成、`scope: 'thisAndFollowing'`
  による分割後の新シリーズなど）
- **両方あり** — そのイベントの内容が変更された（EXDATE 追加・`recurringEventId`
  の付け替えなど、他イベントの操作に伴う副次的な変更も含む）

単発イベントの変更・削除では対象イベント 1 件のみを含みますが、繰り返しイベントの
スコープ操作（オーバーライド生成・シリーズ分割・打ち切り）では、作成・変更・削除
されたイベントすべてを漏れなく含みます。そのため `changes` をそのまま逆再生すれば、
操作前の状態を完全に復元できます。

`updateEvent` に値として実質同じ（無変化な）`patch` を渡した場合、そのイベントは
`changes` に含まれません（空の `patch: {}` や、既存の値と同じ値を明示的に指定した
`patch` も同様）。`exdates` / `rdates` は日付の集合として比較されるため、要素の
並び替えのみを行う `patch`（値の集合として同一）も無変化として扱われ `changes` には
含まれません。

```tsx
import type { CalendarApi, EventChangeEntry } from '@koyomi-cal/react';

/**
 * changes を逆再生してイベント一覧を操作前の状態に戻す。
 * `setEvents` は onEventsChange を呼ばない（エコー防止）ため、
 * undo による復元自体をアプリ側の保存処理へ送り返すことはない。
 */
function undoChanges(api: CalendarApi, changes: readonly EventChangeEntry[]): void {
  const byId = new Map(api.getEvents().map((event) => [event.id, event]));
  for (const change of changes) {
    if (change.after !== undefined) {
      byId.delete(change.after.id); // 新規作成されたイベントを取り除く
    }
  }
  for (const change of changes) {
    if (change.before !== undefined) {
      byId.set(change.before.id, change.before); // 変更前の内容に戻す
    }
  }
  api.setEvents([...byId.values()]);
}

// 使用例: 変更確定後に受け取った changes を保持しておき、
// 「元に戻す」ボタンが押されたら undoChanges(api, changes) を呼ぶ
```

React 層の `onEventChange` / `onEventDelete` コールバック（`EventChange` /
`EventDelete` の `changes` フィールド）も同じ `EventChangeEntry[]` を渡すため、
ドラッグ操作の undo にもそのまま使えます。詳細は
[インタラクション](./interactions.md#ドラッグ移動リサイズ) を参照してください。

## オカレンス（EventOccurrence）とは

`CalendarEvent` はあくまでソースデータであり、そのままでは「特定の日に
表示される 1 回分の予定」を表しません。カレンダーは表示範囲に対して
イベントを**展開**し、`EventOccurrence`（オカレンス）の一覧を生成します。

- 単発イベントは 1 件のオカレンスになります
- 繰り返しイベント（`rrule` あり）は、範囲内に開始する回数分のオカレンスになります
- 各オカレンスは `key`（形式: `` `${eventId}@${startのISO文字列}` ``、React の `key`
  などに使える一意な文字列）、元イベント参照 `event`、絶対時刻の `start` /
  `end`、`isRecurring`、そして「この予定のみ変更/削除」の照合キーとなる
  `originalStart` を持ちます

`getOccurrences(range)` で任意の範囲のオカレンス一覧を取得できます（開始時刻順）。

```ts
import { createCalendar, occurrenceKey } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'daily',
  title: '毎日会議',
  start: '2026-07-01T09:00:00',
  end: '2026-07-01T09:30:00',
  rrule: 'FREQ=DAILY;COUNT=3',
});

const occurrences = calendar.getOccurrences({
  start: new Date('2026-07-01T00:00:00Z'),
  end: new Date('2026-07-05T00:00:00Z'),
});
// occurrences.length === 3（7/1・7/2・7/3 の 3 回）
// occurrences[0].key === occurrenceKey('daily', occurrences[0].start)
// occurrences[0].isRecurring === true
// occurrences[0].originalStart.getTime() === occurrences[0].start.getTime()
```

繰り返しの展開の詳細（RRULE の指定方法、編集・削除のスコープなど）は
[繰り返し予定](./recurrence.md) を参照してください。

## 関連ページ

- [繰り返し予定](./recurrence.md)
- [タイムゾーン](./timezones.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [API リファレンス](./api.md)
