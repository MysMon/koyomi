# 繰り返し予定

RFC 5545 の RRULE 文字列による繰り返し予定の指定方法と、Google カレンダー
準拠の「この予定のみ / これ以降のすべての予定 / すべての予定」編集・削除の
セマンティクスを説明します。

## RRULE 文字列の指定方法

`CalendarEvent.rrule` には次のいずれかの形式で RRULE を指定します。

- 本体のみ: `'FREQ=WEEKLY;BYDAY=MO,WE'`
- `'RRULE:'` プレフィックス付き: `'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'`

`DTSTART`（繰り返しの起点）は自分で書く必要はありません。`CalendarEvent.start`
から自動的に補われます。

`start` は RRULE の評価起点です。`BYDAY` / `BYMONTHDAY` などを指定した場合、
`start` 自身がその条件と一致すれば最初のオカレンスに含まれます。一致しない場合は
RRULE が生成する最初の日時から始まり、`start` を別のオカレンスとして合成しません。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'daily',
  title: '毎日',
  start: '2026-07-01T09:00:00',
  rrule: 'FREQ=DAILY;COUNT=3', // DTSTART を書く必要はない（start から補われる）
});

const occurrences = calendar.getOccurrences({
  start: new Date('2026-07-01T00:00:00Z'),
  end: new Date('2026-07-10T00:00:00Z'),
});
// occurrences は 7/1・7/2・7/3 の 3 回（DTSTART = start の 2026-07-01T09:00 JST）
```

不正な RRULE（`FREQ` の欠落や不正な値など）を指定して `createEvent` を呼ぶと
例外が投げられます。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
try {
  calendar.createEvent({ title: '不正な例', start: '2026-07-01T09:00:00', rrule: 'FOO=BAR' });
} catch (error) {
  // Error: 不正な RRULE です: 'FOO=BAR'（...）
}
```

RRULE 文字列を単体で検証・正規化したい場合は `normalizeRRuleString` が
使えます。大文字小文字を吸収し、`'RRULE:'` プレフィックスを取り除いた
正規形（`'FREQ=...'`）を返します。

```ts
import { normalizeRRuleString } from '@koyomi-cal/react';

normalizeRRuleString('RRULE:FREQ=WEEKLY;BYDAY=MO,WE'); // => 'FREQ=WEEKLY;BYDAY=MO,WE'
normalizeRRuleString('freq=daily;count=3'); // => 'FREQ=DAILY;COUNT=3'
// normalizeRRuleString('FOO=BAR'); // => Error を投げる（FREQ が指定されていない）
```

## 対応していないもの: EXRULE・複数 RRULE

`CalendarEvent.rrule` は単一の RRULE 文字列のみを受け付けます。RFC 5545 が定める
次の仕様には対応していません。

- **EXRULE**（除外用の繰り返しルール） — 「毎日発生するが、毎週月曜だけは除外する」
  のような、繰り返しパターンで除外を表現する指定
- **複数の RRULE の合成**（RRULESET 相当） — 1 つの予定に複数の RRULE を組み合わせて
  1 つの繰り返し系列とする指定

これらが必要な場合は、次のいずれかの方法で代替してください。

- **個別の除外日時に展開できる場合**: EXRULE が生成する除外日時をあらかじめ計算し、
  `CalendarEvent.exdates`（EXDATE 相当。[exdates / recurringEventId / originalStart](#exdates--recurringeventid--originalstart上級-外部データとの同期) 参照）に列挙する
- **複数の繰り返しパターンを合成したい場合**: それぞれのパターンを別々の
  `rrule` を持つ複数の `CalendarEvent`（同じ内容で `id` だけ異なる別イベント）として
  `setEvents`/`createEvent` に渡す。オカレンスの重複を避けたい場合は、各パターンの
  `exdates` で他方のパターンが生成する日時を除外する

```ts
calendar.setEvents([
  {
    id: 'standup-mon-fri',
    title: '朝会',
    start: '2026-07-06T09:00:00', // 月曜
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', // 平日毎日
    exdates: ['2026-07-20T09:00:00'], // EXRULE 相当（第3月曜を個別に除外）
  },
]);
// 期待される動作:
// - 平日の毎日 9:00 のオカレンスが展開されるが、7/20（月）だけは exdates により除外される
```

## 繰り返しルールエディタ（構造化状態での編集）

RRULE 文字列を直接組み立てる代わりに、フォーム入力向けの構造化された状態として繰り返しルールを編集したい場合は、`parseRecurrenceRule` / `validateRecurrenceRuleState` / `buildRecurrenceRuleString`（`core/recurrence-editor`）と、それらを React の状態管理に接続した `useRecurrenceRuleEditor` フックが使えます。検証エラー・非対応理由は `core/recurrence-editor` 側では機械可読なコード（`RecurrenceValidationIssue` の `field`/`code`、`RecurrenceUnsupportedReason`）として返り、文言化（説明文・検証エラー・非対応理由のメッセージ）は `@koyomi-cal/react` の中央メッセージカタログ（`resolveMessageCatalog`）が担います。

対応範囲は `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・`BYDAY`（週の曜日集合、または月の第 n 曜日）・`BYMONTHDAY`（単一値）・`COUNT`/`UNTIL` のみです。

```ts
interface RecurrenceRuleState {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number; // 1 以上の整数。既定 1
  byWeekday?: readonly Weekday[]; // freq: 'weekly' のときのみ意味を持つ
  monthlyPattern?: MonthlyRecurrencePattern; // freq: 'monthly' のときのみ意味を持つ
  end: RecurrenceEnd;
}

type MonthlyRecurrencePattern =
  | { kind: 'dayOfMonth'; day: number } // 1〜31 または -1（月末）
  | { kind: 'nthWeekday'; ordinal: 1 | 2 | 3 | 4 | -1; weekday: Weekday }; // -1 は最終週

type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'count'; count: number }
  | { type: 'until'; until: Date }; // イベント TZ の現地時刻として解釈される（後述の UNTIL と同じ規則）
```

`parseRecurrenceRule` は RRULE 文字列をこの構造化状態に変換します。対応範囲外の指定（`BYSETPOS` や複数の `BYMONTHDAY` など）、不正な RRULE は `kind: 'unsupported'` として元の文字列（`rawRRule`）をそのまま保持します（書き換えません）。

```ts
import { buildRecurrenceRuleString, parseRecurrenceRule, resolveMessageCatalog } from '@koyomi-cal/react';

const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00（水曜日）
const parsed = parseRecurrenceRule({
  rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  dtstart,
  timeZone: 'Asia/Tokyo',
});
// parsed.kind === 'editable'
// parsed.state === { freq: 'weekly', interval: 1, byWeekday: [1, 3], end: { type: 'never' } }

if (parsed.kind === 'editable') {
  buildRecurrenceRuleString({ state: parsed.state, dtstart, timeZone: 'Asia/Tokyo' });
  // => 'FREQ=WEEKLY;BYDAY=MO,WE'
  resolveMessageCatalog('ja').recurrenceEditor.describeRule(parsed.state, { dtstart, timeZone: 'Asia/Tokyo' });
  // => '毎週月・水'
}

const unsupported = parseRecurrenceRule({
  rrule: 'FREQ=DAILY;BYSETPOS=1;BYMONTH=1',
  dtstart,
  timeZone: 'Asia/Tokyo',
});
// unsupported.kind === 'unsupported'
// unsupported.rawRRule === 'FREQ=DAILY;BYSETPOS=1;BYMONTH=1'（元の文字列そのまま）
// unsupported.reason === { code: 'unsupportedField', field: 'BYSETPOS' }（機械可読なコード）
resolveMessageCatalog('ja').recurrenceEditor.unsupportedReason(unsupported.reason);
// => '対応していない RRULE の指定です（BYSETPOS）'

// 期待される動作:
// - buildRecurrenceRuleString は state に検証エラー（validateRecurrenceRuleState の結果が
//   非空）があると Error を投げる
// - catalog.recurrenceEditor.describeRule は検証を要求しない best-effort な整形で、
//   context（dtstart/timeZone）を渡さない場合、byWeekday/monthlyPattern が未指定の
//   説明文は曜日・日にちを欠いた曖昧な文言（「毎週」「毎月」等）になる
```

`until` の解釈は [タイムゾーンとの関係](#タイムゾーンとの関係) の `UNTIL` と同じ「イベント TZ の現地時刻」の規則に従います。

### useRecurrenceRuleEditor（React）

`useRecurrenceRuleEditor({ start, timeZone, rrule })` は、上記の純関数を React の状態として保持し、setter・検証エラー・生成される RRULE 文字列・説明文を返すヘッドレスなフックです（UI は提供しません）。

```tsx
import { useRecurrenceRuleEditor } from '@koyomi-cal/react';

function RecurrenceForm({ start, timeZone }: { start: Date; timeZone: string }) {
  const editor = useRecurrenceRuleEditor({ start, timeZone });

  if (editor.state === null) {
    return (
      <button type="button" onClick={editor.enable}>
        繰り返しを設定
      </button>
    );
  }

  return (
    <div>
      <select
        value={editor.state.freq}
        onChange={(event) => editor.setFrequency(event.target.value as never)}
      >
        <option value="daily">毎日</option>
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
        <option value="yearly">毎年</option>
      </select>
      <p>{editor.description}</p>
      {editor.errors.map((issue) => (
        <p key={issue.field}>{issue.message}</p>
      ))}
      <button type="button" onClick={editor.clear}>
        繰り返しを解除
      </button>
    </div>
  );
}

// 期待される動作:
// - editor.state が null の間は「繰り返しを設定」ボタンのみ表示される
// - enable() を呼ぶと既定値（毎日・interval 1・終了条件なし）で state が有効になる
// - setFrequency('weekly') を呼ぶと byWeekday 未設定時に [start の曜日] が補われる
// - errors が空でない間、editor.rruleString は null になる
```

`start` / `timeZone` / `rrule` は **作成時のみ有効**です（`useCalendar` の `events` と同じ規約）。編集対象（新規作成 / 既存オカレンス編集）を切り替える場合は `reset({ start, timeZone, rrule })` を呼んでください。エディタ全体が新しい編集対象で初期化し直され（編集中の `state` は引き継がれません。`rrule` 省略時は「繰り返しなし」）、以後の `rruleString` / `description` / `setFrequency` の既定値補完も新しい `start` / `timeZone` を基準に計算されます。既存予定の編集ダイアログを 1 つ用意して予定ごとに使い回す構成では、対象の予定が変わったタイミングで `reset` を呼べば再マウントは不要です。

```tsx
import { useEffect } from 'react';
import { useRecurrenceRuleEditor } from '@koyomi-cal/react';

// 既存予定の編集ダイアログ: 対象の予定が変わったら reset で切り替える（再マウント不要）
function RecurrenceDialog({ start, rrule }: { start: Date; rrule?: string }) {
  const editor = useRecurrenceRuleEditor({ start, timeZone: 'Asia/Tokyo', rrule });
  const { reset } = editor;
  useEffect(() => {
    reset({ start, timeZone: 'Asia/Tokyo', rrule });
  }, [reset, start, rrule]);
  return <p>{editor.description}</p>;
}

// 期待される動作:
// - start / rrule が別の予定の値に変わると、reset により editor.state・description が
//   新しい予定の内容へ切り替わる（コンポーネントの key 再マウントは不要）
// - reset を呼んでいる間、マウント後の options 変更に対する開発ビルドの警告は表示されない
```

このフックを使うコンポーネントに一意な `key` を指定して再マウントする方法も引き続き使えます。`reset` を呼ばずにマウント後の `start` / `timeZone` / `rrule` へ異なる値を渡した場合は反映されず、開発ビルドでは一度だけ警告が表示されます。

`locale` オプション（既定 `'ja'`）で `description` / `errors[].message` / `unsupported.message` の言語を切り替えられます。同梱にない言語は `'ja'` にフォールバックします。`start`/`timeZone`/`rrule` と異なり作成時限定ではなく、変更のたびに再解決されます。`messages` オプション（`MessageCatalogOverrides`）を渡すと `recurrenceEditor` グループの文言を部分的に上書きできます。

```tsx
useRecurrenceRuleEditor({ start, timeZone, locale: 'en-US' });
// => description が "Weekly on Mon, Wed" のような英語文言になる
```

`locale` は `CalendarProvider` や `useCalendar` の `locale` オプションとは連動しません（このフックは `Provider` に依存しないため）。カレンダー本体と表示言語を揃えたい場合は、`calendar.state.options.locale` を明示的に渡してください。詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

## 対応する主なパターン例

`rrule` パッケージ（RFC 5545 実装）をラップしているため、標準的な RRULE の
パターンをそのまま利用できます。以下は代表的な例です（`expandRecurrence`
はオカレンスの開始時刻を計算する低レベル API で、`getOccurrences` や各種ビュー
はこれを内部で利用しています）。

```ts
import { expandRecurrence } from '@koyomi-cal/react';

const dtstart = new Date('2026-07-01T00:00:00Z'); // 東京 7/1 9:00（水曜日）
const oneMonth = { start: dtstart, end: new Date('2026-08-01T00:00:00Z') };

// 毎日
expandRecurrence({ rrule: 'FREQ=DAILY', dtstart, timeZone: 'Asia/Tokyo', range: oneMonth });
// => 7/1, 7/2, 7/3, ...（毎日 9:00 JST、31 回）

// 毎週 月・水（BYDAY）
expandRecurrence({
  rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: oneMonth,
});
// => 7/1(水), 7/6(月), 7/8(水), 7/13(月), ...

// 隔週（INTERVAL=2）
expandRecurrence({
  rrule: 'FREQ=WEEKLY;INTERVAL=2',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: oneMonth,
});
// => 7/1, 7/15, 7/29（2 週間おき）

// 毎月（同じ日）。範囲を半年分に広げる
expandRecurrence({
  rrule: 'FREQ=MONTHLY',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') },
});
// => 7/1, 8/1, 9/1, 10/1, 11/1, 12/1

// 毎年。範囲を 2 年半分に広げる
expandRecurrence({
  rrule: 'FREQ=YEARLY',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: { start: dtstart, end: new Date('2029-01-01T00:00:00Z') },
});
// => 2026-07-01, 2027-07-01, 2028-07-01

// COUNT（回数指定）。範囲がどれだけ広くても COUNT で指定した回数しか出ない
expandRecurrence({
  rrule: 'FREQ=DAILY;COUNT=5',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: oneMonth,
});
// => ちょうど 5 回

// UNTIL（終了日時指定。イベント TZ の現地時刻として解釈される。後述）
expandRecurrence({
  rrule: 'FREQ=DAILY;UNTIL=20260705T090000Z',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: oneMonth,
});
// => 7/1, 7/2, 7/3, 7/4, 7/5（UNTIL のオカレンス自身を含む、5 回）
```

## 繰り返しの編集・削除とスコープ

`updateEvent(id, patch, target)` / `deleteEvent(id, target)` の `target`
パラメータ（`{ occurrenceStart, scope }`）で、繰り返し予定のどの範囲に
変更・削除を適用するかを指定します。単発イベントでは `target` を省略します。

- `occurrenceStart` — 対象オカレンスの**本来の**開始時刻。既にオーバーライド済みのオカレンスの場合は、移動・変更される前の元の開始時刻（`originalStart`）を渡す（オーバーライドで移動済みの現在の開始時刻ではない点に注意）
- `scope` — `'this'`（この予定のみ）/ `'thisAndFollowing'`（これ以降のすべて）/ `'all'`（すべて）

単発イベント（`rrule` も `recurringEventId` も持たないイベント）に対して `target` を
明示的に渡しても無視され、`updateEvent` は `patch` をそのまま適用し、`deleteEvent` は
`target` の内容にかかわらずイベントを取り除きます。

`occurrenceStart` に、実在するオカレンスの本来の開始時刻と一致しない値（範囲外の値や、
既にオーバーライドされたオカレンスの**移動後の現在の開始時刻**を誤って渡した場合など）
を指定した場合、「一致するオーバーライドが無い」ものとして扱われます。

- `updateEvent` の `scope: 'this'` — 渡した `occurrenceStart` を `originalStart` と
  する新しいオーバーライドイベントが作成されます（既存のオーバーライドや繰り返し
  本体は変更されません。対応する実際のオカレンスが存在しないため、このオーバーライドは
  「参照先はあるが対応するオカレンスの無い」孤立した単発イベントとして振る舞います）
- `deleteEvent` の `scope: 'this'` — 渡した `occurrenceStart` の値がそのままマスターの
  `exdates` に追加されます。対応する実際のオカレンスが存在しない場合、この EXDATE は
  将来同じ時刻にオカレンスが生成されない限り実質的な効果を持ちません

いずれも `Error` にはならず、`occurrenceStart` には常に対象オカレンスの本来の開始時刻を
正確に渡す必要があります。

### scope: 'this' — この予定のみ

対象オカレンスを、`recurringEventId`（マスターの ID）と `originalStart`（本来の
開始日時）を持つ**単発のオーバーライドイベント**として切り出します。マスター
自身は変更されません。既にオーバーライド済みのオカレンスへの再変更は、新しい
オーバーライドを作らずそのオーバーライドに直接適用されます。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'standup',
  title: '朝会',
  start: '2026-07-01T09:00:00',
  end: '2026-07-01T09:15:00',
  rrule: 'FREQ=DAILY;COUNT=5', // 7/1〜7/5 の 5 回
});

// 7/3 のオカレンスだけ 10:00 に変更する（occurrenceStart は 7/3 09:00 JST の絶対時刻）
calendar.updateEvent(
  'standup',
  { start: '2026-07-03T10:00:00', end: '2026-07-03T10:15:00' },
  { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
);

const events = calendar.getEvents();
// マスター（変更なし）＋ 新しいオーバーライド（単発イベント）の 2 件になる
const override = events.find((e) => e.recurringEventId === 'standup');
// override.originalStart === 7/3 09:00 JST（置き換えた元のオカレンスの時刻）
// override.start === '2026-07-03T10:00:00'（patch した値がそのまま入る）

// 既にオーバーライド済みのオカレンスを直接編集する場合は、単発イベントと同様に
// target を省略できる（scope: 'this' を明示しても同じ結果になる）
calendar.updateEvent(override!.id, { title: '朝会（社内向け）' });
```

`id` にオーバーライド自身の ID を渡した場合、`scope: 'this'`（または
`target` 省略）は**そのオーバーライドを直接変更**します。一方 `scope:
'thisAndFollowing'` / `'all'` を指定すると**親シリーズに対して適用**され、
`'thisAndFollowing'` の分割点にはそのオーバーライドの `originalStart`
が使われます。

### scope: 'thisAndFollowing' — これ以降のすべて

元の繰り返しを対象オカレンスの直前で打ち切り（`UNTIL` を設定）、対象オカレンス以降を
**新しい繰り返しイベント（新しい ID）として分割**します。`COUNT` が
指定されている場合は消化済み回数を差し引いた値を新シリーズに引き継ぎます。
対象オカレンス以降（`>=`）の EXDATE・オーバーライドは新シリーズに付け替えられます。

**対象が最初のオカレンスの場合は `'all'` と同じ扱い**になり、シリーズ分割は
起きません。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'standup',
  title: '朝会',
  start: '2026-07-01T09:00:00',
  end: '2026-07-01T09:15:00',
  rrule: 'FREQ=DAILY;COUNT=5', // 7/1〜7/5 の 5 回
});

// 7/3 以降の朝会をすべて 10:00 に変更する
calendar.updateEvent(
  'standup',
  { start: '2026-07-03T10:00:00', end: '2026-07-03T10:15:00' },
  { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'thisAndFollowing' },
);

const events = calendar.getEvents();
// 旧シリーズ（id: 'standup'、7/1・7/2 の 2 回に打ち切り）＋
// 新シリーズ（新しい ID、7/3 開始、10:00）の 2 件になる
const oldSeries = events.find((e) => e.id === 'standup');
// oldSeries.rrule === 'FREQ=DAILY;UNTIL=20260702T090000Z'
const newSeries = events.find((e) => e.id !== 'standup');
// newSeries.rrule === 'FREQ=DAILY;COUNT=3'（5 - 2〔消化済み〕= 3）
```

最初のオカレンスを対象にした場合は分割が起きません。

```ts
// 最初のオカレンス（7/1）を対象に thisAndFollowing を指定すると 'all' と同じ扱いになる
calendar.updateEvent(
  'standup',
  { title: '朝会（改称）' },
  { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'thisAndFollowing' },
);
// シリーズ分割は起きず、イベントは 1 件のまま
```

### scope: 'all' — すべて

マスターのイベント自体を直接変更します。既存のオーバーライドはそのまま
維持されます。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'standup',
  title: '朝会',
  start: '2026-07-01T09:00:00',
  rrule: 'FREQ=DAILY;COUNT=3',
});
// 7/2 のオカレンスをあらかじめオーバーライドしておく
calendar.updateEvent(
  'standup',
  { title: '朝会（7/2 特別回）' },
  { occurrenceStart: new Date('2026-07-02T00:00:00Z'), scope: 'this' },
);

// シリーズ全体のタイトルを変更する
calendar.updateEvent(
  'standup',
  { title: '朝会（改称）' },
  { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'all' },
);

const events = calendar.getEvents();
// events.find(e => e.id === 'standup').title === '朝会（改称）'
// 既存のオーバーライドは維持される: 
// events.find(e => e.recurringEventId === 'standup').title === '朝会（7/2 特別回）'
```

### 削除のスコープ

`deleteEvent(id, target)` も同じ 3 段階のスコープに従います。

- `target` 省略（または `scope: 'all'`）— 繰り返し全体と、それを参照する
  すべてのオーバーライドを取り除く
- `scope: 'this'` — 対象オカレンスを **EXDATE に追加**する。対象が既にオーバー
  ライド済みのオカレンスの場合は、そのオーバーライドを取り除いて元オカレンスの EXDATE
  に追加する
- `scope: 'thisAndFollowing'` — 対象オカレンスの直前で繰り返しを打ち切り、対象
  オカレンス以降のオーバーライド・EXDATE を取り除く。対象が最初のオカレンスなら
  繰り返し全体を削除する

`id` にオーバーライドの ID を渡した場合、`scope: 'this'`（または `target`
省略）は**そのオーバーライドを取り除き、元オカレンス（`originalStart`）を親の
EXDATE に追加**します（`updateEvent` と異なり、`target` を省略しても
`'this'` 相当の挙動になります）。`'thisAndFollowing'` / `'all'` は親
シリーズに対して適用されます。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.createEvent({
  id: 'standup',
  title: '朝会',
  start: '2026-07-01T09:00:00',
  rrule: 'FREQ=DAILY;COUNT=3',
});

// 7/2 のオカレンスだけ削除する（EXDATE に追加される）
calendar.deleteEvent('standup', {
  occurrenceStart: new Date('2026-07-02T00:00:00Z'),
  scope: 'this',
});
// getOccurrences すると 7/1・7/3 の 2 回だけになる
// calendar.getEvents()[0].exdates に 1 件追加されている

// target を省略すると繰り返し全体（＋オーバーライド）を削除する
calendar.deleteEvent('standup');
// calendar.getEvents() は空配列になる
```

ドラッグ＆ドロップによるオカレンスの移動・リサイズも内部的には `updateEvent` を
呼び出しており、同じスコープ規則に従います。独自のドラッグ操作を実装する
場合は、`updateEvent` 呼び出し用の patch を組み立てる便利関数
`moveOccurrenceIn`（`updateEventIn` のラッパ）も公開されています。詳細は
[インタラクション](./interactions.md) を参照してください。

`eventOverlap` / `eventConstraint`（[インタラクション: 宣言的な重なり・配置制約](./interactions.md#宣言的な重なり配置制約eventoverlap--eventconstraint)）による判定は、繰り返し予定のドラッグ中は**そのオカレンス単体**のみを対象にします。`thisAndFollowing` / `all` でスコープを確定した後、影響を受けた他のオカレンスとの重なり・配置制約の整合性は検証しません。

## exdates / recurringEventId / originalStart（上級: 外部データとの同期）

繰り返し予定をサーバーなどの外部データと同期する場合、これらのフィールドの
役割を理解しておくと役立ちます。

- **`exdates`** — マスターイベントが持つ、繰り返しから除外するオカレンスの開始
  日時の配列（EXDATE 相当）。「この予定のみ削除」したオカレンスがここに追加
  されます。時間指定イベントは開始時刻のミリ秒一致、終日イベントは日付
  キー一致で判定されます。
- **`recurringEventId`** — オーバーライドイベント（「この予定のみ変更」した
  結果の単発イベント）が持つ、元の繰り返しイベントの ID への参照。
- **`originalStart`** — オーバーライドイベントが持つ、置き換え対象となる
  オカレンスの本来の開始日時。イベント展開時にはマスターのオカレンスのうち
  `originalStart` に一致するものがこのオーバーライドの内容で置き換えられ、
  「この予定のみ変更/削除」の照合キーとして使われます。

外部ストアからイベントを読み込む場合、マスター（`rrule` を持つ行）と
オーバーライド（`recurringEventId` + `originalStart` を持つ行）を別々の
レコードとして保存し、`setEvents` でまとめてカレンダーに渡す形が典型的です。

```ts
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });

// サーバーから読み込んだイベント一覧を想定
calendar.setEvents([
  {
    id: 'standup',
    title: '朝会',
    start: '2026-07-01T09:00:00',
    rrule: 'FREQ=DAILY;COUNT=3',
    exdates: ['2026-07-02T09:00:00'], // 7/2 は削除済み
  },
  {
    // 7/3 のオカレンスだけ変更した「オーバーライド」イベント
    id: 'standup-override-1',
    title: '朝会（特別回）',
    start: '2026-07-03T11:00:00',
    end: '2026-07-03T11:30:00',
    recurringEventId: 'standup',
    originalStart: '2026-07-03T09:00:00',
  },
]);

const occurrences = calendar.getOccurrences({
  start: new Date('2026-07-01T00:00:00Z'),
  end: new Date('2026-07-10T00:00:00Z'),
});
// 7/1（通常）と 7/3（オーバーライド後の 11:00〜11:30）の 2 件になる
// （7/2 は exdates により除外される）
```

マスターイベントが見つからない「参照先のないオーバーライド」（`setEvents`
の一部だけを渡した場合など）は、防御的に単発イベントとして扱われます。

オーバーライドの `start` / `originalStart` を**オフセットなしの文字列**で渡す
場合、解釈に用いるタイムゾーンは「オーバーライド自身の `timeZone` → マスターの
`timeZone` → 表示タイムゾーン」の順にフォールバックします。マスターに明示的な
`timeZone` を設定している場合、オーバーライド側で `timeZone` を省略しても
マスターと同じ現地時刻の解釈になります（展開時・編集時とも同じ規則）。

## RDATE — パターン外のオカレンスを追加する（rdates）

`rrule` のパターンに乗らない日時へオカレンスを**追加**したい場合は、`rdates`
（RFC 5545 の RDATE 相当）を使います。`exdates` と対になるフィールドです。

- `rrule` と併用でき、`rrule` なしで `rdates` のみの指定も可能
  （その場合は `start` のオカレンス ＋ 各 `rdates` のオカレンスに展開されます）
- `exdates` と同じ日時が指定された場合は**除外が優先**されます
- オカレンスの長さはマスターのオカレンスと同じ（`end - start`、なければ既定長）
- 「これ以降を編集/削除」でシリーズを分割した場合、`rdates` も分割点で
  旧シリーズ・新シリーズに振り分けられます（`exdates` と同じ規則）
- `rdates` のみの場合も各オカレンスは繰り返し扱いになり、「この予定のみ」では
  オーバーライド/EXDATE、「これ以降」では有限の RDATE 集合の前後分割が行われます

```ts
calendar.setEvents([
  {
    id: 'meeting',
    title: '定例',
    start: '2026-07-01T09:00:00',
    end: '2026-07-01T10:00:00',
    rrule: 'FREQ=WEEKLY;BYDAY=WE', // 毎週水曜
    rdates: ['2026-07-03T09:00:00'], // 金曜に 1 回だけ臨時開催を追加
  },
]);

// 期待される動作:
// - 水曜（7/1、7/8、…）のオカレンスに加えて 7/3（金）9:00 のオカレンスが展開される
// - rdate 由来のオカレンスも isRecurring: true で、「この予定のみ変更/削除」の対象になる
```

## タイムゾーンとの関係

繰り返しは「イベントのタイムゾーンにおける現地時刻」を維持して展開
されます。例えば `America/New_York` の毎日 9:00 の予定は、DST の切り替えを
跨いでも常に現地 9:00 に発生します（絶対時刻としての UTC オフセットは
変わります）。

```ts
import { expandRecurrence } from '@koyomi-cal/react';

// America/New_York の毎日 9:00 は DST を跨いでも現地 9:00 に発生する
const starts = expandRecurrence({
  rrule: 'FREQ=DAILY',
  dtstart: new Date('2026-03-07T14:00:00Z'), // 3/7 9:00 EST（UTC-5）
  timeZone: 'America/New_York',
  range: { start: new Date('2026-03-07T14:00:00Z'), end: new Date('2026-03-09T04:00:00Z') },
});
// => [2026-03-07T14:00:00.000Z, 2026-03-08T13:00:00.000Z]
// （DST 切替後は UTC 13:00 = 現地 9:00 EDT。どちらも現地時刻は 9:00）
```

**注意:** RRULE の `UNTIL` はイベントのタイムゾーンにおける**現地時刻**
として解釈されます。`UNTIL` の文字列表現は RFC 5545 の形式上 `Z`
サフィックスが付きますが、実際の UTC 時刻としては扱われません。

```ts
import { expandRecurrence } from '@koyomi-cal/react';

// dtstart: 2026-07-01 09:00 America/New_York（現地時刻）= 2026-07-01T13:00:00Z
const starts = expandRecurrence({
  rrule: 'FREQ=DAILY;UNTIL=20260705T090000Z',
  dtstart: new Date('2026-07-01T13:00:00Z'),
  timeZone: 'America/New_York',
  range: { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-10T00:00:00Z') },
});
// UNTIL の文字列は 'Z' 付きだが、実際の UTC 09:00 ではなく
// 「イベント TZ（America/New_York）の現地時刻 9:00」として扱われる。
// 7/5 9:00 EDT = 2026-07-05T13:00:00Z がちょうど境界として含まれる
// （もし本当に UTC 9:00 として解釈されるなら、7/5 13:00Z は UNTIL を
// 超えているため含まれないはず）
// starts の最後の要素は '2026-07-05T13:00:00.000Z'、全部で 5 件
```

`UNTIL` を指定する際は、打ち切りたいオカレンスの**イベント TZ での現地時刻**を
`YYYYMMDDTHHMMSSZ` 形式でそのまま書く、と考えると分かりやすいです。

## 関連ページ

- [予定の管理](./events.md)
- [iCalendar（ICS）入出力](./ics.md)
- [タイムゾーン](./timezones.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [API リファレンス](./api.md)
