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

`CalendarProvider` の配下でこのフックを使う場合、`locale` / `messages` を省略すると Provider の `locale`（`state.options.locale`）・`messages`（`recurrenceEditor` グループの上書き）に自動で連動します。Provider の `locale` を切り替えれば、このフックの `description` / `errors[].message` / `unsupported.message` も追従します。

```tsx
import { CalendarProvider, useCalendar, useRecurrenceRuleEditor } from '@koyomi-cal/react';

function RecurrenceForm({ start, timeZone }: { start: Date; timeZone: string }) {
  // calendar.state.options.locale が 'en-US' なら、editor.description も英語になる
  const editor = useRecurrenceRuleEditor({ start, timeZone });
  return <p>{editor.description}</p>;
}

function App() {
  const calendar = useCalendar({ locale: 'en-US' });
  return (
    <CalendarProvider value={calendar}>
      <RecurrenceForm start={new Date()} timeZone="Asia/Tokyo" />
    </CalendarProvider>
  );
}
```

`locale` を明示的に指定した場合はその値が Provider より優先されます。`CalendarProvider` の配下でない場合は、明示指定しない限り `'ja'` が既定になります。詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

### 週の開始曜日（weekStartsOn）と WKST

`INTERVAL` が 2 以上の `FREQ=WEEKLY` では、「どの曜日で週が始まるか」（RRULE の `WKST`、既定は月曜）によって隔週の対象週の区切りが変わります。たとえば `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU` は、月曜始まりでは火曜とその後の日曜が同じ週に入りますが、日曜始まり（`WKST=SU`）では日曜が週の先頭になるため、同じルールでも展開される実日付列が変わります（`expandRecurrence` は `WKST` 付きの RRULE をそのまま正しく展開します）。

カレンダーの表示上の週の開始曜日（`weekStartsOn`、既定 `0` = 日曜）と RRULE の週境界を一致させるため、`parseRecurrenceRule` / `buildRecurrenceRuleString` は `weekStartsOn` を受け取れます。

```ts
const dtstart = new Date('2026-07-01T00:00:00Z');

// 生成: weekStartsOn が月曜（1）以外なら、freq によらず WKST を常に明示出力する
buildRecurrenceRuleString({
  state: { freq: 'weekly', interval: 2, byWeekday: [0, 2], end: { type: 'never' } },
  dtstart,
  timeZone: 'Asia/Tokyo',
  weekStartsOn: 0,
});
// => 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU'

// 受理: ルールの WKST が weekStartsOn と一致すれば editable
parseRecurrenceRule({ rrule: 'FREQ=WEEKLY;WKST=SU', dtstart, timeZone: 'Asia/Tokyo', weekStartsOn: 0 });
// => kind: 'editable'

// 不一致の明示 WKST は unsupported（reason: { code: 'unsupportedWkst' }）
parseRecurrenceRule({ rrule: 'FREQ=WEEKLY;WKST=SU', dtstart, timeZone: 'Asia/Tokyo', weekStartsOn: 1 });
// => kind: 'unsupported'

// 期待される動作:
// - weekStartsOn を省略すると、生成は WKST を出力せず、受理は WKST=MO の明示のみ許容する
//   （RRULE の既定の週開始が月曜のため）
// - weekStartsOn が月曜（1）のときも WKST は出力しない（既定と同じため）
// - WKST を持たないルールは weekStartsOn の値によらず受理される
```

`useRecurrenceRuleEditor` では `weekStartsOn` オプションで同じ接続ができます。`locale` と同様に作成時限定ではなく、変更のたびに `rruleString` の `WKST` 出力へ再反映されます（`rrule` の受理判定にはマウント時または `reset` 呼び出し時点の値が使われます）。`CalendarProvider` の配下では、省略時に Provider の `weekStartsOn`（`state.options.weekStartsOn`、既定 `0` = 日曜）に自動で連動し、明示的に指定した場合はその値が Provider より優先されます。

```tsx
// カレンダー本体と同じ週の開始曜日で WKST を出力する
const editor = useRecurrenceRuleEditor({ start, timeZone, weekStartsOn: 0 });
// editor.rruleString => 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU' のような WKST 付きの文字列

// CalendarProvider の配下では省略するだけでよい（Provider の weekStartsOn に連動する）
function RecurrenceForm({ start, timeZone }: { start: Date; timeZone: string }) {
  const editor = useRecurrenceRuleEditor({ start, timeZone });
  return <p>{editor.rruleString}</p>;
}
```

### 完成形: 繰り返しルールエディタ UI（コピー&ペースト用）

上の例は最小構成です。頻度セレクト・（`weekly` 時のみ）曜日チェックボックス群・（`monthly` 時のみ）日付/第 n 曜日ラジオ・終了条件（なし/回数/日付）ラジオ・interval 数値入力までを素の HTML 要素で組んだ、そのまま使える完成形が以下です（デモアプリ `apps/demo/src/EventDialog.tsx` で実際に動作しているコードそのものです）。編集対象（新規作成 / 既存オカレンスの編集）が切り替わるたびに、呼び出し側が一意な `key` を指定してこのコンポーネントを再マウントする前提です。

```tsx
import type {
  MonthlyRecurrencePattern,
  RecurrenceEnd,
  RecurrenceFrequency,
  RecurrenceWeekdayOrdinal,
  TimeZoneId,
  Weekday,
} from '@koyomi-cal/react';
import { dateFromKey, dateKeyInZone, getWallClock, useRecurrenceRuleEditor, weekdayInZone } from '@koyomi-cal/react';
import { type ReactElement, useEffect, useId, useRef } from 'react';

/** 繰り返し頻度 select の選択肢一覧。 */
const FREQUENCY_OPTIONS: readonly { value: RecurrenceFrequency; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

/** 曜日チェックボックス群・月内パターンの曜日 select で共通して使う選択肢一覧（月曜始まり表示）。 */
const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

/** 月内パターンの「第 n 週」select の選択肢一覧。 */
const ORDINAL_OPTIONS: readonly { value: RecurrenceWeekdayOrdinal; label: string }[] = [
  { value: 1, label: '第1' },
  { value: 2, label: '第2' },
  { value: 3, label: '第3' },
  { value: 4, label: '第4' },
  { value: -1, label: '最終' },
];

/** 文字列が {@link RecurrenceFrequency} の値かどうかを判定する（`<select>` の値検証用）。 */
function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return FREQUENCY_OPTIONS.some((option) => option.value === value);
}

/**
 * `<select>` の曜日の値を検証しつつ {@link Weekday} に変換する。
 *
 * @throws `WEEKDAY_OPTIONS` にない値の場合は `Error`
 */
function parseWeekdayOption(value: string): Weekday {
  const parsed = Number(value);
  if (WEEKDAY_OPTIONS.some((option) => option.value === parsed)) {
    // 上の判定で WEEKDAY_OPTIONS の値（Weekday）のいずれかと一致することを確認済み
    return parsed as Weekday;
  }
  throw new Error(`不正な曜日の値です: '${value}'`);
}

/**
 * `<select>` の「第 n 週」の値を検証しつつ {@link RecurrenceWeekdayOrdinal} に変換する。
 *
 * @throws `ORDINAL_OPTIONS` にない値の場合は `Error`
 */
function parseOrdinalOption(value: string): RecurrenceWeekdayOrdinal {
  const parsed = Number(value);
  if (ORDINAL_OPTIONS.some((option) => option.value === parsed)) {
    // 上の判定で ORDINAL_OPTIONS の値（RecurrenceWeekdayOrdinal）のいずれかと一致することを確認済み
    return parsed as RecurrenceWeekdayOrdinal;
  }
  throw new Error(`不正な第 n 週の値です: '${value}'`);
}

/** {@link MonthlyPatternFields} の props。 */
interface MonthlyPatternFieldsProps {
  pattern: MonthlyRecurrencePattern | undefined;
  disabled: boolean;
  fallbackDay: number;
  fallbackWeekday: Weekday;
  onChange: (pattern: MonthlyRecurrencePattern) => void;
}

/**
 * 「毎月」の月内パターン（日付指定 / 第 n 曜日指定）を選ぶラジオ群。
 *
 * `pattern` が未設定（DTSTART に暗黙依存している状態）の間は、ラジオの現在値として
 * 「日付指定」を仮定して表示するが、実際に切り替えるまで `pattern` 自体は変更しない。
 */
function MonthlyPatternFields(props: MonthlyPatternFieldsProps): ReactElement {
  const { pattern, disabled, fallbackDay, fallbackWeekday, onChange } = props;
  const baseId = useId();
  const kind = pattern?.kind ?? 'dayOfMonth';

  return (
    <div className="demo-form-field">
      <span className="demo-field-label" id={`${baseId}-monthly-label`}>
        月内パターン
      </span>
      <div className="demo-radio-group" role="radiogroup" aria-labelledby={`${baseId}-monthly-label`}>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-monthly-kind`}
            disabled={disabled}
            checked={kind === 'dayOfMonth'}
            onChange={() => onChange({ kind: 'dayOfMonth', day: fallbackDay })}
          />
          日付指定
          {pattern?.kind === 'dayOfMonth' && (
            <input
              type="number"
              className="demo-inline-number"
              min={-1}
              max={31}
              disabled={disabled}
              value={pattern.day}
              onChange={(event) => onChange({ kind: 'dayOfMonth', day: Number(event.target.value) })}
            />
          )}
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-monthly-kind`}
            disabled={disabled}
            checked={kind === 'nthWeekday'}
            onChange={() => onChange({ kind: 'nthWeekday', ordinal: 1, weekday: fallbackWeekday })}
          />
          第 n 曜日指定
          {pattern?.kind === 'nthWeekday' && (
            <>
              <select
                disabled={disabled}
                value={pattern.ordinal}
                onChange={(event) =>
                  onChange({
                    kind: 'nthWeekday',
                    ordinal: parseOrdinalOption(event.target.value),
                    weekday: pattern.weekday,
                  })
                }
              >
                {ORDINAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                disabled={disabled}
                value={pattern.weekday}
                onChange={(event) =>
                  onChange({
                    kind: 'nthWeekday',
                    ordinal: pattern.ordinal,
                    weekday: parseWeekdayOption(event.target.value),
                  })
                }
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

/** {@link RecurrenceEndFields} の props。 */
interface RecurrenceEndFieldsProps {
  end: RecurrenceEnd;
  disabled: boolean;
  timeZone: TimeZoneId;
  onChange: (end: RecurrenceEnd) => void;
}

/** 繰り返しの終了条件（なし / 回数 / 日付）を選ぶラジオ群。 */
function RecurrenceEndFields(props: RecurrenceEndFieldsProps): ReactElement {
  const { end, disabled, timeZone, onChange } = props;
  const baseId = useId();

  return (
    <div className="demo-form-field">
      <span className="demo-field-label" id={`${baseId}-end-label`}>
        終了条件
      </span>
      <div className="demo-radio-group" role="radiogroup" aria-labelledby={`${baseId}-end-label`}>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'never'}
            onChange={() => onChange({ type: 'never' })}
          />
          なし
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'count'}
            onChange={() => onChange({ type: 'count', count: end.type === 'count' ? end.count : 5 })}
          />
          回数
          {end.type === 'count' && (
            <input
              type="number"
              className="demo-inline-number"
              min={1}
              disabled={disabled}
              value={end.count}
              onChange={(event) => onChange({ type: 'count', count: Number(event.target.value) })}
            />
          )}
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'until'}
            onChange={() =>
              onChange({ type: 'until', until: end.type === 'until' ? end.until : new Date() })
            }
          />
          日付
          {end.type === 'until' && (
            <input
              type="date"
              disabled={disabled}
              value={dateKeyInZone(end.until, timeZone)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '') {
                  return;
                }
                onChange({ type: 'until', until: dateFromKey(value, timeZone) });
              }}
            />
          )}
        </label>
      </div>
    </div>
  );
}

/** {@link RecurrenceRuleFields} が親へ通知する、現在の実効的な結果。 */
interface RecurrenceFieldsResult {
  /** 現在の実効的な RRULE 文字列。繰り返しなしは `undefined`。 */
  rrule: string | undefined;
  /** 保存を妨げる検証エラーがあるか。 */
  hasErrors: boolean;
}

/** {@link RecurrenceRuleFields} の props。 */
interface RecurrenceRuleFieldsProps {
  /** DTSTART。`useRecurrenceRuleEditor` の規約どおり初期値としてのみ使う。 */
  start: Date;
  /** イベントのタイムゾーン。初期値としてのみ使う。 */
  timeZone: TimeZoneId;
  /** 編集対象の既存 RRULE 文字列。初期値としてのみ使う。 */
  initialRRule: string | undefined;
  /** `editable: false` の予定を読み取り専用表示にする。 */
  disabled: boolean;
  /** 現在の実効的な結果が変わるたびに呼ばれる。 */
  onResultChange: (result: RecurrenceFieldsResult) => void;
}

/**
 * `useRecurrenceRuleEditor` による繰り返しルールの編集フォーム。
 *
 * 対応範囲外の RRULE を読み込んだ場合（`editor.unsupported`）は、読み取り専用の
 * 案内文と元の RRULE 文字列をそのまま表示する。
 *
 * `start` / `timeZone` / `initialRRule` は `useRecurrenceRuleEditor` の規約により
 * 初期値としてのみ有効なため、呼び出し側は編集対象が切り替わるたびに一意な `key` を
 * 指定してこのコンポーネントを再マウントすること。
 */
function RecurrenceRuleFields(props: RecurrenceRuleFieldsProps): ReactElement {
  const { start, timeZone, initialRRule, disabled, onResultChange } = props;
  const baseId = useId();
  const editor = useRecurrenceRuleEditor(
    initialRRule === undefined ? { start, timeZone } : { start, timeZone, rrule: initialRRule },
  );

  // 親が渡す onResultChange はレンダーごとに新しい参照になりうるため、ref 経由で
  // 最新を読み、effect の依存には含めない（含めると、この effect が呼ぶ親の
  // setState による再レンダーで参照が変わり無限ループになる）。
  const onResultChangeRef = useRef(onResultChange);
  onResultChangeRef.current = onResultChange;
  // 直近に親へ送った結果。値が実際に変わったときだけ通知して不要な再描画を防ぐ。
  const lastSentRef = useRef<RecurrenceFieldsResult | null>(null);

  useEffect(() => {
    let next: RecurrenceFieldsResult;
    if (editor.unsupported !== null) {
      next = { rrule: editor.unsupported.rawRRule, hasErrors: false };
    } else if (editor.state === null) {
      next = { rrule: undefined, hasErrors: false };
    } else {
      next = {
        rrule: editor.errors.length === 0 ? (editor.rruleString ?? undefined) : undefined,
        hasErrors: editor.errors.length > 0,
      };
    }
    const last = lastSentRef.current;
    if (last !== null && last.rrule === next.rrule && last.hasErrors === next.hasErrors) {
      return;
    }
    lastSentRef.current = next;
    onResultChangeRef.current(next);
  }, [editor.unsupported, editor.state, editor.errors, editor.rruleString]);

  if (editor.unsupported !== null) {
    return (
      <div className="demo-form-field">
        <span className="demo-field-label">繰り返し</span>
        <p className="demo-readonly-notice">
          このRRULEは編集できません（{editor.unsupported.message}）。
        </p>
        <pre className="demo-recurrence-raw">{editor.unsupported.rawRRule}</pre>
        <button type="button" className="demo-button demo-button-text" disabled={disabled} onClick={editor.clear}>
          繰り返しを解除
        </button>
      </div>
    );
  }

  if (editor.state === null) {
    return (
      <div className="demo-form-field">
        <span className="demo-field-label">繰り返し</span>
        <button type="button" className="demo-button" disabled={disabled} onClick={editor.enable}>
          繰り返しを設定
        </button>
      </div>
    );
  }

  const { state } = editor;

  return (
    <div className="demo-form-field demo-recurrence-fields">
      <span className="demo-field-label" id={`${baseId}-recurrence-label`}>
        繰り返し
      </span>

      <div className="demo-form-row">
        <div className="demo-form-field">
          <label htmlFor={`${baseId}-freq`}>頻度</label>
          <select
            id={`${baseId}-freq`}
            disabled={disabled}
            value={state.freq}
            onChange={(event) => {
              const raw = event.target.value;
              if (isRecurrenceFrequency(raw)) {
                editor.setFrequency(raw);
              }
            }}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="demo-form-field">
          <label htmlFor={`${baseId}-interval`}>間隔</label>
          <input
            id={`${baseId}-interval`}
            type="number"
            min={1}
            disabled={disabled}
            value={state.interval}
            onChange={(event) => editor.setInterval(Number(event.target.value))}
          />
        </div>
      </div>

      {state.freq === 'weekly' && (
        <fieldset className="demo-form-field demo-weekday-fieldset">
          <legend className="demo-field-label">曜日</legend>
          <div className="demo-weekday-checkboxes">
            {WEEKDAY_OPTIONS.map((option) => {
              const checked = state.byWeekday?.includes(option.value) ?? false;
              return (
                <label key={option.value} className="demo-weekday-checkbox">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(event) => {
                      const current = state.byWeekday ?? [];
                      const next = event.target.checked
                        ? [...current, option.value]
                        : current.filter((weekday) => weekday !== option.value);
                      editor.setByWeekday(next);
                    }}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {state.freq === 'monthly' && (
        <MonthlyPatternFields
          pattern={state.monthlyPattern}
          disabled={disabled}
          fallbackDay={getWallClock(start, timeZone).day}
          fallbackWeekday={weekdayInZone(start, timeZone)}
          onChange={editor.setMonthlyPattern}
        />
      )}

      <RecurrenceEndFields end={state.end} disabled={disabled} timeZone={timeZone} onChange={editor.setEnd} />

      {editor.errors.length > 0 && (
        <ul className="demo-recurrence-errors">
          {editor.errors.map((issue) => (
            <li key={issue.field}>{issue.message}</li>
          ))}
        </ul>
      )}

      {editor.description !== null && <p className="demo-field-hint">{editor.description}</p>}

      <button type="button" className="demo-button demo-button-text" disabled={disabled} onClick={editor.clear}>
        繰り返しを解除
      </button>
    </div>
  );
}

// 使用例:
// <RecurrenceRuleFields
//   key={recurrenceEditorKeyFor(mode)} // 編集対象の切り替えごとに一意な key で再マウントする
//   start={start}
//   timeZone={timeZone}
//   initialRRule={existingRRuleOrUndefined}
//   disabled={false}
//   onResultChange={(result) => setForm((prev) => ({ ...prev, ...result }))}
// />

// 期待される動作:
// - editor.state が null の間は「繰り返しを設定」ボタンのみ表示される
// - freq を 'weekly' に切り替えると曜日チェックボックス群が、'monthly' に切り替えると
//   月内パターンのラジオ群が表示される
// - editor.unsupported が非 null の RRULE を initialRRule に渡すと、読み取り専用の
//   案内文と元の RRULE 文字列が表示され、フォーム入力は表示されない
```

`demo-*` の CSS クラスはスタイル指定のみで、フォームのロジックには関与しません。`data-koyomi-*` 属性はライブラリ本体のビルトインコンポーネントが提供するスタイルフックのため、この例のような利用側の自作フォームは通常の CSS クラスで構いません。実際の配色は `apps/demo/src/demo.css` を参照してください。

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

// 月の第 n 曜日（BYDAY=<ordinal><weekday>）。第 2 火曜、範囲を半年分に広げる
expandRecurrence({
  rrule: 'FREQ=MONTHLY;BYDAY=2TU',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') },
});
// => 7/14, 8/11, 9/8, 10/13, 11/10, 12/8（各月の第 2 火曜。dtstart(7/1・水)は BYDAY と
//    一致しないため評価起点にのみ使われ、オカレンスには合成されない）

// 最終週（ordinal: -1）。BYDAY=-1FR は各月の最終金曜
expandRecurrence({
  rrule: 'FREQ=MONTHLY;BYDAY=-1FR',
  dtstart,
  timeZone: 'Asia/Tokyo',
  range: { start: dtstart, end: new Date('2027-01-01T00:00:00Z') },
});
// => 7/31, 8/28, 9/25, 10/30, 11/27, 12/25（各月の最終金曜）

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

### 展開エンジンが対応する RRULE 機能の範囲

`expandRecurrence` / `previousOccurrenceStart` / `truncateRRule` / `countOccurrencesBefore` は `rrule` パッケージ（RFC 5545 実装）への委譲のため、上の代表例に載らない RRULE の構成要素も展開できます。

- **`FREQ`**: `SECONDLY` / `MINUTELY` / `HOURLY` / `DAILY` / `WEEKLY` / `MONTHLY` / `YEARLY` のすべて
- **`INTERVAL`**: 任意の正整数（`FREQ` の単位ごとの間隔）
- **`BYDAY`**: 曜日集合（`MO,TU,...`）、および `FREQ=MONTHLY` / `YEARLY` での第 n 曜日指定（`2TU`・`-1FR` 等）
- **`BYMONTHDAY`** / **`BYYEARDAY`**: 正負両方の値（負値は月末・年末からの逆順、複数値の指定も可）
- **`BYMONTH`**: 対象月による絞り込み
- **`BYWEEKNO`**: ISO 8601 の週番号（`WKST=MO` が前提）。ISO 週 1 の月曜が前年 12 月に属する年もその年の週として正しく展開されます
- **`BYSETPOS`**: `BYDAY` 等が生成した候補集合内での順序選択（正負・複数値の指定も可）。例えば `BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` は「月内の最終平日」を表します
- **`BYHOUR`** / **`BYMINUTE`** / **`BYSECOND`**: 時刻による絞り込み
- **`WKST`**: 週の開始曜日（既定 `MO`）。`INTERVAL` を伴う `WEEKLY` の週境界に影響します（[週の開始曜日（weekStartsOn）と WKST](#週の開始曜日weekstartsonと-wkst) 参照）
- **`COUNT`** / **`UNTIL`**: 終了条件（両者は排他。`UNTIL` の現地時刻としての解釈は [タイムゾーンとの関係](#タイムゾーンとの関係) 参照）

これは「繰り返しルールエディタ（構造化状態での編集）」節で説明した構造化編集の対応範囲（`FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`・`INTERVAL`・`BYDAY`・`BYMONTHDAY`（単一値）・`COUNT`/`UNTIL` のみ）より広いものです。エディタの対応範囲外の RRULE（`BYSETPOS`・`BYMONTH`・`BYYEARDAY`・`BYWEEKNO` などを含むもの）は `parseRecurrenceRule` が `kind: 'unsupported'` として元の文字列をそのまま保持し構造化編集の対象外にしますが、展開そのもの（`getOccurrences` を含む表示・移動・削除などカレンダー全体の基盤）は上記の範囲内であれば正しく行われます。ICS インポートなどで外部からこれらの RRULE を持つ予定を取り込んだ場合も、オカレンスの展開・操作は通常どおり機能し、構造化エディタでの再編集のみが対応外になります。

展開エンジンが対応しないのは「対応していないもの: EXRULE・複数 RRULE」節に挙げた EXRULE・複数 RRULE の合成のみです。

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
指定されている場合は消化済み回数を差し引いた値を新シリーズに引き継ぎます
（消化済み回数は RRULE 由来のオカレンスだけを数え、`rdates` による臨時回は
数えません）。分割の起点オカレンスが既にオーバーライド済みの場合、パッチで
`end` を指定しない限り、そのオーバーライドの長さが新シリーズの予定の長さに
なります。
対象オカレンス以降（`>=`）の EXDATE・オーバーライドは新シリーズに付け替えられます。
パッチが開始日時を変える場合、付け替えられる EXDATE・RDATE とオーバーライドの
`originalStart` も同じ現地時刻差（終日は同じ日数）だけ移動し、除外・置換が
新シリーズの対応するオカレンスに効き続けます（オーバーライド自身の
`start` / `end` は変わりません）。

対象オカレンスが `rdates` 由来（RRULE のパターン外の臨時回）の場合も同様に
分割でき、新シリーズの起点（`INTERVAL` などの位相の基準）はその分割点になります。
分割点ちょうどの RDATE は新シリーズの `start` が表すため引き継がれません。

**対象が最初のオカレンスの場合は `'all'` と同じ扱い**になり、シリーズ分割は
起きません。ICS の `RECURRENCE-ID;RANGE=THISANDFUTURE` インポートも同じ意味論でシリーズを
分割します（詳細は [iCalendar（ICS）入出力: シリーズ分割](./ics.md#シリーズ分割recurrence-idrangethisandfuture) を参照）。

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

分割点ちょうどのオカレンスが既にオーバーライドされている場合、そのオーバーライドは
`recurringEventId` が新シリーズの ID に付け替わるだけで、`thisAndFollowing` の patch は
オーバーライド自身には適用されません。patch が適用されるのは新シリーズの最初の
オカレンス（マスター相当のイベント）のみです。

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
// 7/3 のオカレンスをあらかじめオーバーライドしておく
calendar.updateEvent(
  'standup',
  { title: '朝会（7/3 特別回）' },
  { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
);

// 7/3 を分割点にして以降のタイトルを変更する（分割点がオーバーライド済みのオカレンスと重なる）
calendar.updateEvent(
  'standup',
  { title: '朝会（改称）' },
  { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'thisAndFollowing' },
);

const events = calendar.getEvents();
const overridden = events.find((e) => e.recurringEventId !== undefined);
// overridden.recurringEventId は新シリーズの ID に付け替わる
// overridden.title === '朝会（7/3 特別回）'（patch の '朝会（改称）' はオーバーライドには適用されない）
const newSeries = events.find((e) => e.id !== 'standup' && e.recurringEventId === undefined);
// newSeries.title === '朝会（改称）'（patch は新シリーズの最初のオカレンスに適用される）
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
  されます（同じオカレンスへの削除を繰り返しても重複しては追加されません）。
  時間指定イベントは開始時刻のミリ秒一致、終日イベントは日付
  キー一致で判定されます。オフセットなしの日時文字列は常に DST の早い方の
  オフセットで解釈されるため、秋の巻き戻りで 2 回現れる時刻の 2 回目だけを
  除外するには、絶対時刻の `Date` を渡します。
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
