# 予定の管理

カレンダーに表示する予定（`CalendarEvent`）の構造と、`createCalendar` /
`useCalendar` が提供する CRUD API の使い方を説明します。

## CalendarEvent

`CalendarEvent` は利用者がカレンダーに与える予定の定義（ソースデータ）です。
繰り返し予定の場合、1 件の `CalendarEvent` が表示範囲に応じて複数の
[`EventOccurrence`（発生）](#発生eventoccurrenceとは)に展開されます。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `string` | 一意な ID。繰り返し例外（オーバーライド）イベントも独自の ID を持ちます。 |
| `title` | `string` | 予定のタイトル。 |
| `start` | `Date \| string` | 開始日時。終日イベントの場合は日付（`'YYYY-MM-DD'` も可）。 |
| `end` | `Date \| string`（省略可） | 終了日時（**排他的**）。終日イベントの場合は日付（排他的）。省略時は、時間指定イベントは開始から `defaultEventMinutes` 分、終日イベントは 1 日とみなします。 |
| `allDay` | `boolean`（省略可） | 終日イベントかどうか。既定は `false`。 |
| `timeZone` | `string`（省略可） | このイベントのタイムゾーン（IANA ID）。繰り返しの展開（壁時計維持、DST 跨ぎ）に使用します。省略時はカレンダーの表示タイムゾーン。 |
| `rrule` | `string`（省略可） | RFC 5545 の繰り返しルール。詳細は [繰り返し予定](./recurrence.md) を参照。 |
| `exdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しから除外する発生の開始日時（EXDATE 相当）。 |
| `rdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しに追加する発生の開始日時（RDATE 相当）。`rrule` と併用可。 |
| `recurringEventId` | `string`（省略可） | 繰り返し例外イベントの場合、元となる繰り返しイベントの ID。 |
| `originalStart` | `Date \| string`（省略可） | 繰り返し例外イベントの場合、置き換え対象となる発生の本来の開始日時。 |
| `color` | `string`（省略可） | 表示色。デフォルトテーマでは背景色として使用される（CSS の color 値）。 |
| `location` | `string`（省略可） | 場所。 |
| `description` | `string`（省略可） | 説明文。 |
| `editable` | `boolean`（省略可） | 変更操作を許可するか。既定は `true`。`false` の場合、表示・クリックは可能だがドラッグ移動・リサイズ・キーボードでの移動/リサイズ/削除はすべて無効になります。 |
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
- **オフセットなし ISO 8601**（例: `'2026-07-01T10:00:00'`） — `timeZone`（イベントに指定がなければカレンダーの表示タイムゾーン）の**壁時計時刻**として解釈

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

// 1. Date オブジェクト（絶対時刻としてそのまま解釈）
calendar.createEvent({ id: 'a', title: 'A', start: new Date('2026-07-01T01:00:00Z') });
// 2. オフセット付き ISO 8601（記載どおりの絶対時刻）
calendar.createEvent({ id: 'b', title: 'B', start: '2026-07-01T01:00:00Z' });
// 3. オフセットなし ISO 8601（timeZone の壁時計として解釈: 東京 10:00 = UTC 01:00）
calendar.createEvent({ id: 'c', title: 'C', start: '2026-07-01T10:00:00' });

const occurrences = calendar.getOccurrences({
  start: new Date('2026-06-30T00:00:00Z'),
  end: new Date('2026-07-02T00:00:00Z'),
});
// a・b・c はいずれも同じ絶対時刻 2026-07-01T01:00:00.000Z の発生になる
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

## イベントの CRUD

`CalendarApi`（`createCalendar` の戻り値、または `useCalendar().api`）は
イベント一覧を操作する次のメソッドを提供します。

- `getEvents()` — すべてのソースイベントを返す
- `setEvents(events)` — イベント一覧を置き換える（外部ストアとの同期用）
- `createEvent(input)` — イベントを作成する（`id` 省略時は自動採番）
- `updateEvent(id, patch, target?)` — イベントを更新する
- `deleteEvent(id, target?)` — イベントを削除する

繰り返しイベントに対する `updateEvent` / `deleteEvent` の第 3 引数
`target`（対象発生と適用範囲）については [繰り返し予定](./recurrence.md) を
参照してください。単発イベントでは省略します。

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

## 発生（EventOccurrence）とは

`CalendarEvent` はあくまでソースデータであり、そのままでは「特定の日に
表示される 1 回分の予定」を表しません。カレンダーは表示範囲に対して
イベントを**展開**し、`EventOccurrence`（発生）の一覧を生成します。

- 単発イベントは 1 件の発生になります
- 繰り返しイベント（`rrule` あり）は、範囲内に開始する回数分の発生になります
- 各発生は `key`（形式: `` `${eventId}@${startのISO文字列}` ``、React の `key`
  などに使える一意な文字列）、元イベント参照 `event`、絶対時刻の `start` /
  `end`、`isRecurring`、そして「この予定のみ変更/削除」の照合キーとなる
  `originalStart` を持ちます

`getOccurrences(range)` で任意の範囲の発生一覧を取得できます（開始時刻順）。

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
