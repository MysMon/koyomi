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
| `timeZone` | `string`（省略可） | このイベントのタイムゾーン（IANA ID）。繰り返しの展開（現地時刻の維持、DST 跨ぎ）に使用します。省略時はカレンダーの表示タイムゾーン。不正な IANA タイムゾーン ID を指定すると `Error` になります。 |
| `rrule` | `string`（省略可） | RFC 5545 の繰り返しルール。詳細は [繰り返し予定](./recurrence.md) を参照。 |
| `exdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しから除外するオカレンスの開始日時（EXDATE 相当）。 |
| `rdates` | `readonly (Date \| string)[]`（省略可） | 繰り返しに追加するオカレンスの開始日時（RDATE 相当）。`rrule` と併用可。 |
| `recurringEventId` | `string`（省略可） | 繰り返し例外イベントの場合、元となる繰り返しイベントの ID。 |
| `originalStart` | `Date \| string`（省略可） | 繰り返し例外イベントの場合、置き換え対象となるオカレンスの本来の開始日時。 |
| `color` | `string`（省略可） | 表示色。デフォルトテーマでは背景色として使用される（CSS の color 値）。 |
| `location` | `string`（省略可） | 場所。 |
| `description` | `string`（省略可） | 説明文。 |
| `editable` | `boolean`（省略可） | 変更操作を許可するか。既定は `true`。`false` の場合、表示・クリックは可能だがドラッグ移動・リサイズ・キーボードでの移動/リサイズ/削除はすべて無効になります。 |
| `resourceId` | `string`（省略可） | 割当先リソースの ID（[リソース](#リソース)を参照）。リソース/タイムラインビューで使用します。`resourceIds` 指定時は無視されます。 |
| `resourceIds` | `readonly string[]`（省略可） | 割当先リソース ID の一覧（複数リソース割当）。指定すると割当先の各レーンに同一オカレンスが表示されます。詳細は [複数リソース割当](#複数リソース割当resourceids) を参照。 |
| `overlap` | `boolean`（省略可） | このイベントに他のイベントを重ねてよいか。省略時は `CalendarOptions.eventOverlap`（既定 `true`）に従います。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照。 |
| `constraint` | `'businessHours' \| readonly BusinessHoursRule[]`（省略可） | このイベントのドロップ先を制限します。省略時は `CalendarOptions.eventConstraint` に従います。終日イベントには適用されません。詳細は [インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint) を参照。 |
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

`CalendarResource` は会議室・設備・担当者など、予定の割当先を表す型です。`CalendarEvent.resourceId`（単一割当）または `CalendarEvent.resourceIds`（[複数リソース割当](#複数リソース割当resourceids)）でイベントをリソースに割り当てます。リソース/タイムラインビューで使用します。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | `string` | 一意な ID。重複する場合は先頭のリソースが優先されます（先勝ち）。 |
| `title` | `string` | 表示名。 |
| `color` | `string`（省略可） | 表示色（CSS の color 値）。リソース/タイムラインビューの列/行見出しと、そのビュー内で `event.color` 未指定のイベントの既定色になります（イベント自身の `color` が常に優先。既存ビューの描画には影響しません）。 |
| `parentId` | `string`（省略可） | 親リソースの ID。リソース/タイムラインビューでこのリソースを子としてツリー内に配置します（深さは任意段。タイムラインは行のツリー、リソースビューはツリー順の列＋列グループ見出し行）。参照先のない ID・循環参照（自己参照含む）は孤立したルート（深さ 0）として扱われます。詳細は [ビュー: リソースの階層グルーピング](./views.md#リソースの階層グルーピングparentid折りたたみ) を参照。 |
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

`events` と同様、`resources`（初期値）・`setResources` に渡した配列、
`getResources()` の戻り値の配列、それぞれに含まれる各 `CalendarResource`
オブジェクトは、渡した後・受け取った後に変更しないでください。

### 複数リソース割当（resourceIds）

`CalendarEvent.resourceIds` に複数のリソース ID を渡すと、1 件の予定を複数のリソースへ同時に割り当てられます（Google カレンダーで 1 つの予定に複数の会議室を割り当てるのと同じ考え方）。リソース/タイムラインビューでは、割当先の各レーン（列/行）に同一オカレンスが表示されます。

```ts
calendar.createEvent({
  title: '全体会議',
  start: '2026-07-01T10:00',
  end: '2026-07-01T11:00',
  resourceIds: ['room-a', 'room-b'], // 会議室A と会議室B の両方の列に表示される
});
```

`resourceId`（単一割当）との優先規則は次のとおりです。

- `resourceIds` を**指定した場合（空配列を含む）は `resourceIds` を採用**し、`resourceId` は無視されます。空配列は「未割り当て」を意味します
- `resourceIds` 未指定時は `resourceId`（単一割当）に従います
- `resourceIds` 内の重複 ID は 1 件として扱われます（同じレーンに二重表示されません）
- 割当のうち `resources` に存在する ID だけがレーンになります。存在する ID が 1 件もない場合（割当なし、またはすべて参照先のない ID）のみ、未割り当てレーンに 1 回だけ表示されます

D&D・キーボード操作でレーン間を移動した場合は、**操作したレーンの割当だけが移動先に変わり**、他のレーンの割当は保持されます（詳細は [インタラクション](./interactions.md) と [ビュー](./views.md) の各ビューの説明を参照）。未割り当てレーンへ移動すると操作したレーンの割当だけが外れ、最後の 1 件を外すと予定全体が未割り当てになります。移動先がすでに割当済みのレーンの場合は割当が統合されます（重複しません）。

コアの解決規則は `effectiveResourceIds` / `assignedLaneIds` / `resourceLanePatch`（[API リファレンス](./api.md#リソース割当の解決coreresource-assignment)）として公開されており、独自 UI からも同じ規則を再利用できます。

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

`events`（初期値）・`setEvents` に渡した配列、`getEvents()` の戻り値の配列、
それぞれに含まれる各 `CalendarEvent` オブジェクトは、カレンダーに渡した後・
受け取った後に変更しないでください。変更してもカレンダー内部の状態には
反映されず、`state` や表示との食い違いを招きます。動的に変更する場合は、
新しい配列・オブジェクトを作って `setEvents` / `updateEvent` などに渡してください。

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

## 複製とコピー&ペースト

イベントの複製・コピー&ペーストは `core/mutations` の純粋関数として提供されます
（`CalendarApi` のメソッドではありません）。

- `buildOccurrenceCopy(events, id, params, context)` — コピー。イベント（またはオカレンス）の
  複製を新規作成の入力（`CalendarEventInput`。`id` を持たない）として構築する
- `placeEventInputAt(input, params, context)` — 配置。入力を貼り付け先の日時
  （`params.newStart`）へ移した入力を返す（長さは維持）
- `pasteEventIn(events, input, params, context)` — 貼り付け。配置した入力をイベント一覧に
  追加する（`id` は常に採番。同じクリップボード内容を複数回貼り付けられる）
- `duplicateEventIn(events, id, params, context)` — 複製。同じ日時のまま新しいイベントとして
  追加する

**繰り返しイベントのコピーは、シリーズ全体ではなく当該オカレンスの単発化です**
（Google カレンダーのコピーと同じ扱い）。`params.occurrenceStart` で指定したオカレンスの
日時に配置された、`rrule` / `exdates` / `rdates` を持たない単発イベントの複製になります。
対象オカレンスがオーバーライド済みの場合（またはオーバーライドの `id` を直接渡した場合）は、
オーバーライドの現在の内容（移動後の日時・変更後のタイトル等）がコピーされ、
`recurringEventId` / `originalStart` は引き継がれません。シリーズ全体を複製したい場合は、
`getEvents()` から取得したイベントの `rrule` を含むフィールドを自前で組み立てて
`createEvent` に渡してください。

`pasteEventInWithChanges` / `duplicateEventInWithChanges` は、追加後の一覧に加えて
影響を受けたイベントの before/after 一覧（`changes`）も返します。これを
[undo/redo 履歴](#undo元に戻すを実装する)（`createEventHistory` / `useCalendarHistory` の
`push`）へ渡すと、貼り付け・複製も取り消し（undo）・やり直し（redo）の対象になります。

```ts
import { buildOccurrenceCopy, pasteEventInWithChanges } from '@koyomi-cal/react';
import type { MutationContext } from '@koyomi-cal/react';

const context: MutationContext = {
  displayTimeZone: 'Asia/Tokyo',
  defaultEventMinutes: 60,
  generateId: () => 'copy-1',
};
const events = [
  {
    id: 'master-1',
    title: '朝会',
    start: new Date('2026-07-01T00:00:00Z'), // 東京 9:00
    end: new Date('2026-07-01T01:00:00Z'),
    rrule: 'FREQ=DAILY;COUNT=10',
  },
];

// 7/3 のオカレンスをコピー（単発化。copy.rrule は undefined）
const copy = buildOccurrenceCopy(
  events,
  'master-1',
  { occurrenceStart: new Date('2026-07-03T00:00:00Z') },
  context,
);

// 7/20 9:00 に貼り付け
const result = pasteEventInWithChanges(
  events,
  copy,
  { newStart: new Date('2026-07-20T00:00:00Z') },
  context,
);
// result.created.id === 'copy-1'、result.changes は after のみのエントリ 1 件
```

キーボードショートカット（`Ctrl/Cmd+C` / `Ctrl/Cmd+V`）でこれらを配線する React フック
`useCalendarClipboard` の `paste` は、`calendar.api.createEvent` を呼ぶ前に宣言的制約
（`eventOverlap` / `eventConstraint` / `businessHours`）と適用前フック `onBeforeSelectRange`
（`callbacks` オプションで指定）の両方を判定し、いずれかで拒否された場合はイベントを作成せず
`onPasteRejected` を呼びます（`history` への記録・`onPaste` の呼び出しは成功時のみ）。
詳細は [インタラクション: コピー&ペースト](./interactions.md#コピーペーストusecalendarclipboard) を
参照してください。

### 複製を配線する useCalendarDuplicate

`duplicateEventIn` / `buildOccurrenceCopy` + `calendar.api.createEvent` を React に
配線する専用フックとして `useCalendarDuplicate` があります。オカレンスを複製元と
同じ日時のまま新しいイベントとして作成する 1 回の呼び出しで完結し、
`useCalendarClipboard` と異なり内部にクリップボード状態を持ちません。

```tsx
import { useCalendar, useCalendarDuplicate, useCalendarHistory } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  const history = useCalendarHistory({ calendar });
  const { duplicate } = useCalendarDuplicate({ calendar, history });

  // occurrence は EventOccurrence（例: イベントクリックハンドラで受け取ったもの）
  function handleDuplicateClick(occurrence: EventOccurrence) {
    duplicate(occurrence); // 複製が作成され、Ctrl+Z で取り消せる
  }
  // ...
}
```

繰り返しイベントのオカレンスの複製は、コピー&ペーストと同様に**シリーズ全体では
なく当該オカレンスの単発化**になります（`rrule` / `exdates` / `rdates` を引き継がない）。
複製先は複製元と同じ日時のため、`useCalendarClipboard` の貼り付けと異なり宣言的制約
（`eventOverlap` 等）や `onBeforeSelectRange` の判定は行いません。`history` を渡すと
複製も undo/redo の対象になり、`onDuplicate` は複製が作成されたときに呼ばれます。
対象オカレンスの元イベントが呼び出し時点で既に削除されている場合、`duplicate` は
イベントを作成せず `null` を返します。キーボードショートカットは提供しません
（ブラウザ既定の `Ctrl/Cmd+D` と衝突するため）。

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

`onRangeChange` は、表示ビュー・基準日・表示範囲のいずれかが変わったときに 1 回呼ばれます（FullCalendar の `datesSet` 相当）。`useCalendar` では**マウント後に 1 回発火**します（レンダー本体・SSR では呼ばれません）。`createCalendar` を直接使う場合は**作成直後に同期的に 1 回発火**します。

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
// - コンポーネントのマウント後に 1 回発火する（初期表示分の取得に使える。
//   レンダー本体・SSR では呼ばれない）
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
  index?: number; // 挿入位置の復元に使う位置情報（後述）。省略時は末尾に挿入される
}
```

- **`before` のみ（`after` なし）** — そのイベントは削除された
- **`after` のみ（`before` なし）** — そのイベントは新規作成された
  （繰り返しの `scope: 'this'` によるオーバーライド生成、`scope: 'thisAndFollowing'`
  による分割後の新シリーズなど）
- **両方あり** — そのイベントの内容が変更された（EXDATE 追加・`recurringEventId`
  の付け替えなど、他イベントの操作に伴う副次的な変更も含む）
- **`index`** — `before` を持つエントリ（削除・更新）は変更前の一覧内での位置、
  新規作成のみのエントリは変更後の一覧内での位置。`applyEventChangeEntries` が
  削除の取り消し・作成のやり直しで挿入位置を復元するために使う

単発イベントの変更・削除では対象イベント 1 件のみを含みますが、繰り返しイベントの
スコープ操作（オーバーライド生成・シリーズ分割・打ち切り）では、作成・変更・削除
されたイベントすべてを漏れなく含みます。そのため `changes` をそのまま逆再生すれば、
配列の並び順も含めて操作前の状態を完全に復元できます。

`updateEvent` に値として実質同じ（無変化な）`patch` を渡した場合、そのイベントは
`changes` に含まれません（空の `patch: {}` や、既存の値と同じ値を明示的に指定した
`patch` も同様）。`exdates` / `rdates` は日付の集合として比較されるため、要素の
並び替えのみを行う `patch`（値の集合として同一）も無変化として扱われ `changes` には
含まれません。

### 変更を逆再生する（applyEventChangeEntries）

`changes` の各エントリを before/after いずれかの方向へ適用する純粋関数
`applyEventChangeEntries` が公開されています。

```ts
type EventChangeDirection = 'before' | 'after';

function applyEventChangeEntries(
  events: readonly CalendarEvent[],
  changes: readonly EventChangeEntry[],
  direction: EventChangeDirection,
): CalendarEvent[];
```

- `direction: 'before'` — 変更前の状態へ戻す（取り消し／undo）
- `direction: 'after'` — 変更後の状態を適用する（やり直し／redo、または再現）

適用直前に期待する現在の状態（`'before'` 方向なら `after` が、`'after'` 方向なら
`before` が、現在の一覧に存在するはず）と食い違うエントリ（対象イベントが既に
消えている、または想定外に存在している）は安全にスキップし、他のエントリの適用は
継続します（値の内容までは比較しない presence-only の判定）。現在の一覧に存在
しない id を新たに書き込む場合（削除の取り消し・作成のやり直し）は、そのエントリの
`index` が指す位置に挿入します（省略時は末尾）。入力の `events` 配列・各イベントは
変更しません。

何件のエントリが実際に適用されたかを知りたい場合は、`events` に加えて実際に適用
されたエントリの一覧 `applied` も返す `applyEventChangeEntriesWithApplied` が
使えます（`useCalendarHistory` / `createEventHistory` の内部実装が使っています）。
`applied` の各エントリは `index` が適用時点の実際の位置（削除なら削除直前の位置、
挿入なら挿入後の位置）へ更新されており、そのまま逆方向へ適用すれば適用直前の
並び順を復元できます。

```ts
import { applyEventChangeEntries } from '@koyomi-cal/react';

// undo: 直前の変更を取り消す
const reverted = applyEventChangeEntries(api.getEvents(), changes, 'before');
api.setEvents(reverted);

// redo: 取り消した変更をやり直す
const reapplied = applyEventChangeEntries(reverted, changes, 'after');
api.setEvents(reapplied);
```

### undo/redo 履歴マネージャ（useCalendarHistory）

`changes` を自分でスタック管理する代わりに、React では `useCalendarHistory` が
使えます（フレームワーク非依存の `createEventHistory` の薄いラッパです）。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarHistory } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  const history = useCalendarHistory({ calendar, limit: 20, keyboardShortcuts: true });

  return (
    <div>
      <button type="button" disabled={!history.canUndo} onClick={() => history.undo()}>
        元に戻す
      </button>
      <button type="button" disabled={!history.canRedo} onClick={() => history.redo()}>
        やり直す
      </button>
      <CalendarProvider
        value={calendar}
        callbacks={{
          onEventCreate: (info) => history.push(info.changes),
          onEventChange: (change) => history.push(change.changes),
          onEventDelete: (deletion) => history.push(deletion.changes),
        }}
      >
        <CalendarView />
      </CalendarProvider>
    </div>
  );
}

// 期待される動作:
// - 予定をドラッグ移動すると history.canUndo が true になる
//   （onSelectRange を省略した場合の既定即時作成でも history.canUndo が true になる）
// - 「元に戻す」を押すと移動前の状態に戻り、history.canRedo が true になる
// - keyboardShortcuts: true のため Ctrl/Cmd+Z（undo）・Ctrl/Cmd+Shift+Z または
//   Ctrl/Cmd+Y（redo）でも同じ操作ができる（input 等にフォーカス中は無効）
```

- **`push(changes)`** — 1 操作分の変更を履歴に積む。`onEventChange` / `onEventDelete`
  内、または `api.updateEvent` / `deleteEvent` の戻り値（`EventChangeEntry[]`）を得た
  直後に呼びます。`api.createEvent` の戻り値は作成された `CalendarEvent` 単体なので、
  `history.push([{ after: created }])` のように 1 件のエントリに包んで積みます。
  `changes` が空配列なら何もしません。`onSelectRange` を省略した場合の既定即時作成は、
  `onEventCreate` コールバック（`CalendarInteractionCallbacks.onEventCreate`）が
  `event`・`changes`・`selection` を受け取れるため、`history.push(info.changes)` で
  履歴に積めます（`onEventCreate` は `onSelectRange` を指定した場合は呼ばれません）
- **`undo()` / `redo()`** — 直前の操作を取り消す・やり直す。`push` を呼んだ直後に
  `undo` すると `redo` が使えるようになり、`undo` を跨いで新たに `push` すると
  `redo` スタックは破棄されます
- **`limit`**（既定 100）— 履歴（undo スタック）の最大保持数。マウント時のみ有効
- **`clear()`** — 履歴を空にする。`api.setEvents` で外部ストアの内容を丸ごと反映した
  直後など、履歴の前提が崩れるタイミングで呼ぶことを推奨します
- undo/redo の適用は `api.setEvents` 経由で行われるため、`onEventsChange` は
  発火しません（外部ストアとの同期の既存仕様と一貫）。また `onBeforeEventChange` /
  `onBeforeEventDelete` 等の適用前フックも経由しません
- **削除の取り消しは元の位置に復元される**: `EventChangeEntry.index` により、
  配列の途中にあったイベントを削除して `undo` した場合も、元の位置に挿入されます
  （末尾に追加し直されることはありません）
- **`undo()` / `redo()` の戻り値**: 1 件以上のエントリを適用できた場合は `true`。
  記録されたエントリが 1 件も適用できなかった場合（対象イベントがすべて消えている・
  想定外に存在しているなどのドリフト）は `false` を返し、**そのエントリは履歴から
  破棄されます**（反対のスタックには積まれません）。一部のみ適用できた場合は `true`
  を返し、**実際に適用できたエントリだけ**が反対のスタック（undo → redo、
  redo → undo）に積まれます。積まれるエントリの `index` は適用時点の実際の位置へ
  更新されるため、一部がスキップされた場合でも undo→redo の往復で並び順が復元されます
- **外部同期との整合**: `undo` / `redo` は履歴に記録した時点のイベントの
  スナップショットを丸ごと適用します。対象イベントが履歴の記録後に消えている・
  新たに現れている場合はそのエントリを安全に読み飛ばしますが、**同じ `id` の
  イベントが履歴を経由しない `setEvents`（外部同期など）で別の内容に更新されていた
  場合、その `id` については判定を行わず記録時のスナップショットで丸ごと上書きします**
  （外部同期で変わったフィールドが undo で巻き戻ります）。history 経由でない
  `setEvents` を挟む運用では、その直後に `clear()` を呼んで履歴を破棄してください

React 層の `onEventChange` / `onEventDelete` コールバック（`EventChange` /
`EventDelete` の `changes` フィールド）は `applyEventChangeEntries` /
`useCalendarHistory` と同じ `EventChangeEntry[]` を渡すため、ドラッグ操作の undo にも
そのまま使えます。詳細は
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
- [iCalendar（ICS）入出力](./ics.md)
- [タイムゾーン](./timezones.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [API リファレンス](./api.md)
