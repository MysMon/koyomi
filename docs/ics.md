# iCalendar（ICS）入出力

Koyomi は、イベントの配列（`CalendarEvent[]`）と iCalendar（RFC 5545、いわゆる `.ics` ファイル）の
文字列を相互変換する関数を提供します。Google カレンダーや Outlook など、iCalendar 形式で
エクスポート・インポートできるカレンダーとのデータ交換に使えます。

- **`eventsToIcs(events, options?)`** — `CalendarEvent[]` → `VCALENDAR`/`VEVENT` 文字列
- **`eventsFromIcs(ics)`** — `.ics` テキスト → `CalendarEvent[]`
- **`eventsFromIcsWithIssues(ics)`** — `.ics` テキスト →
  `{ events: CalendarEvent[]; issues: IcsImportIssue[] }`（不正な VEVENT を個別に
  読み飛ばして残りを取り込む版。詳細は
  [部分取り込みとエラー収集](#部分取り込みとエラー収集eventsfromicswithissues) を参照）

どちらも React に依存しないコア関数で、`@koyomi-cal/react` と
[`@koyomi-cal/react/core`](./api.md#koyomi-calreactcorereact-非依存の単体エントリ) の
両方のエントリから import できます。行の折り返し（75 オクテット。UTF-8 の文字を分断しない）と
TEXT 値のエスケープは RFC 5545 に準拠します。

```ts
import { eventsFromIcs, eventsToIcs } from '@koyomi-cal/react/core';

// エクスポート
const ics = eventsToIcs(calendar.getEvents(), { timeZone: 'Asia/Tokyo' });

// インポート
const events = eventsFromIcs(icsText);
calendar.setEvents(events);
```

## エクスポート（eventsToIcs）

```ts
const ics = eventsToIcs(
  [
    {
      id: 'weekly',
      title: '週次ミーティング',
      start: '2026-07-06T10:00:00',
      end: '2026-07-06T11:00:00',
      timeZone: 'Asia/Tokyo',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-07-20T10:00:00'],
    },
  ],
  { timeZone: 'Asia/Tokyo' },
);
// BEGIN:VCALENDAR
// VERSION:2.0
// PRODID:-//koyomi-cal//react-calendar//JA
// CALSCALE:GREGORIAN
// BEGIN:VEVENT
// UID:weekly
// DTSTAMP:20260701T000000Z
// DTSTART;TZID=Asia/Tokyo:20260706T100000
// DTEND;TZID=Asia/Tokyo:20260706T110000
// RRULE:FREQ=WEEKLY;BYDAY=MO
// EXDATE;TZID=Asia/Tokyo:20260720T100000
// SUMMARY:週次ミーティング
// END:VEVENT
// END:VCALENDAR
```

### オプション

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `timeZone` | 実行環境のローカル TZ | `timeZone` を持たないイベントの日時の解釈に用いるタイムゾーン（カレンダーの表示タイムゾーンに相当） |
| `defaultEventMinutes` | `60` | `end` 省略時の時間指定イベントの長さ（分）。DTEND は常に明示的に出力される |
| `dtstamp` | 現在時刻 | 各 VEVENT の `DTSTAMP` に書く時刻。テストや差分比較で出力を固定したい場合に指定する |
| `prodId` | `-//koyomi-cal//react-calendar//JA` | `PRODID` の値 |

### 日時の表現

| イベントの状態 | 出力 |
| --- | --- |
| 終日（`allDay: true`） | `DTSTART;VALUE=DATE:20260801` 形式。`end` は排他のままなので、Koyomi の `end` の値がそのまま `DTEND` になる（`end` 省略時は翌日） |
| `timeZone` あり | `DTSTART;TZID=Asia/Tokyo:20260706T100000` 形式（イベント TZ の現地時刻）。`VTIMEZONE` 定義は出力せず、`TZID` には IANA タイムゾーン ID をそのまま使う |
| `timeZone` なし・オフセットなし文字列 | フローティング時刻（`DTSTART:20260701T100000`）。取り込んだ側のタイムゾーンで解釈される、Koyomi の「オフセットなし文字列」と同じ意味 |
| `timeZone` なし・`Date` / オフセット付き文字列 | UTC（`DTSTART:20260701T010000Z`） |

ミリ秒は秒へ切り捨てられます（iCalendar の日時は秒精度のため）。

### 繰り返しの表現

| Koyomi 側 | iCalendar 側 |
| --- | --- |
| `rrule` | `RRULE`。`UNTIL` は RFC 5545 の要求どおり `DTSTART` と型を揃えて出力される。`timeZone` のあるイベントは Koyomi の「イベント TZ の現地時刻」（[繰り返し予定: タイムゾーンとの関係](./recurrence.md#タイムゾーンとの関係) を参照）から UTC 表記へ、`timeZone` のない UTC 形式のイベントはオプションの `timeZone` の現地時刻として解釈して UTC 表記へ変換される。フローティングのイベントは現地時刻形式（`Z` なし）で出力される。終日イベントの `UNTIL` は日付形式になる |
| `exdates` | `EXDATE`（`TZID` / `VALUE=DATE` 付き。同じ形式の値はカンマ結合） |
| `rdates` | `RDATE`（同上） |
| オーバーライド（`recurringEventId` + `originalStart`） | マスターと同じ `UID` を持つ VEVENT + `RECURRENCE-ID`。オーバーライド自身の `id` は iCalendar に対応する表現がないため出力に含まれない。`timeZone` を省略したオーバーライドはマスターの `timeZone` を引き継いで出力される |

### 出力されないフィールド

`color` / `resourceId` / `editable` / `overlap` / `constraint` / `extendedProps` は
表示・操作のための Koyomi 固有フィールドのため、iCalendar には出力されません。

## インポート（eventsFromIcs）

```ts
const events = eventsFromIcs(icsText);
// TZID 付きの日時 → timeZone とオフセットなし文字列の組
// events[0] = {
//   id: 'weekly',
//   title: '週次ミーティング',
//   start: '2026-07-06T10:00:00',
//   end: '2026-07-06T11:00:00',
//   timeZone: 'Asia/Tokyo',
//   rrule: 'FREQ=WEEKLY;BYDAY=MO',
//   exdates: ['2026-07-20T10:00:00'],
// }
```

変換規則はエクスポートの逆です。

| iCalendar 側 | Koyomi 側 |
| --- | --- |
| `UID` | `id`。`UID` がない VEVENT には出現順の `ics-event-1` のような ID を自動生成する |
| `SUMMARY` / `LOCATION` / `DESCRIPTION` | `title`（ない場合は空文字）/ `location` / `description` |
| `VALUE=DATE` の `DTSTART`/`DTEND` | `allDay: true` と `'YYYY-MM-DD'` 文字列 |
| `TZID` 付きの日時 | `timeZone`（`DTSTART` の TZID）とオフセットなし文字列。`DTSTART` と異なる TZID の値（`DTEND` 等）は絶対時刻の `Date` になる |
| UTC（末尾 `Z`）の日時 | `'2026-07-01T01:00:00Z'` 形式のオフセット付き文字列 |
| フローティング時刻 | オフセットなし文字列（表示タイムゾーンで解釈される） |
| `RRULE` | `rrule`。UTC 表記の `UNTIL` はイベント TZ（`timeZone` のない UTC 形式のイベントは実行環境のローカルタイムゾーン）の現地時刻へ変換される。フローティングのイベントの `UNTIL` は現地時刻のまま取り込まれる |
| `EXDATE` / `RDATE` | `exdates` / `rdates`（複数プロパティ・カンマ区切りの両方を合成） |
| `RECURRENCE-ID` 付きの VEVENT | オーバーライド。`recurringEventId` に `UID`、`originalStart` に `RECURRENCE-ID` の値が入り、`id` は「`UID@RECURRENCE-ID の値`」（例: `weekly@20260713T100000`）で生成される |
| `RECURRENCE-ID;RANGE=THISANDFUTURE` 付きの VEVENT | 「これ以降」のシリーズ分割。同じ `UID` のマスターの繰り返しを分割点の直前で打ち切り、分割点以降を新しい独立イベントとして取り込む。詳細は [シリーズ分割](#シリーズ分割recurrence-idrangethisandfuture) を参照 |
| `STATUS:CANCELLED` + `RECURRENCE-ID` | 「そのオカレンスの削除」として、同じ `UID` のマスターの `exdates` に変換される（マスターが同じ ICS 内にない場合は無視）。`RANGE=THISANDFUTURE` が付いている場合は「これ以降の削除」としてシリーズを打ち切る。`RECURRENCE-ID` のない `STATUS:CANCELLED` の VEVENT は取り込まれない |

### シリーズ分割（RECURRENCE-ID;RANGE=THISANDFUTURE）

`RECURRENCE-ID` に `RANGE=THISANDFUTURE` パラメータが付いた VEVENT は、単一オカレンスの
オーバーライドではなく「この予定とそれ以降」の変更として取り込まれます。カレンダー上の
対話操作（[繰り返し予定](./recurrence.md) の「これ以降のすべての予定」）と同じ意味論で、
同じ `UID` のマスターをシリーズ分割に変換します。

- **旧シリーズ** — マスターの `rrule` を分割点（`RECURRENCE-ID` の値）の直前の
  オカレンスで `UNTIL` 打ち切りにする（`COUNT` は `UNTIL` に置き換わる）
- **新シリーズ** — 分割点以降を引き継ぐ独立イベントになる。`id` は
  「`UID@RECURRENCE-ID の値`」（単一オーバーライドの `id` と同じ規則）で、
  `recurringEventId` / `originalStart` は持たない
  - `start` はオーバーライド VEVENT の `DTSTART`（分割点から日時をずらす変更を表現できる）
  - `rrule` はマスターの値を引き継ぎ、`COUNT` は消化済み回数（分割点より前の
    オカレンス数）を差し引いた残数になる。オーバーライド VEVENT 自体に `RRULE` が
    ある場合はその値を使う
  - `SUMMARY` / `DTEND` / `LOCATION` / `DESCRIPTION` / `EXDATE` / `RDATE` は
    オーバーライド VEVENT にあればその値を、なければマスターの値を引き継ぐ
- **付け替え** — 分割点以降（分割点ちょうどを含む）の通常オーバーライド・`EXDATE`・
  `RDATE` は新シリーズへ付け替えられる。分割点より前のものは旧シリーズに残る
- **複数の分割** — 同じ `UID` に複数の `RANGE=THISANDFUTURE` がある場合は分割点の
  昇順に連鎖適用され、前の分割で生まれた新シリーズが次の分割の対象になる
  （ICS 内の出現順には依存しない）
- **`STATUS:CANCELLED` との組み合わせ** — 「これ以降の削除」として、マスターを
  分割点の直前で打ち切り、分割点以降のオーバーライド・`EXDATE`・`RDATE` を取り除く
- **`RRULE` のないマスター** — `RDATE` のみで繰り返すマスターは、分割点より前の
  `RDATE` を旧シリーズに、以降の `RDATE` を新シリーズに振り分けて分割する

同じ `UID` のマスター（`RRULE` または `RDATE` を持つ VEVENT）が同じ ICS 内に
見つからない場合、または `eventsFromIcsWithIssues` でマスターが `issues` 側に
回っている場合は、分割せず単一オカレンスのオーバーライドとして取り込まれます
（`STATUS:CANCELLED` 付きなら単一オカレンスの削除として `exdates` に変換されます）。

分割点の日時は `RECURRENCE-ID` の形式に従って解釈されます。`TZID` 付きはそのタイムゾーンの
現地時刻、UTC（末尾 `Z`）は絶対時刻、フローティングと日付形式（終日）は `UNTIL` の取り込みと
同じく実行環境のローカルタイムゾーン（表示タイムゾーンに相当）で解釈されます。

分割結果の 2 系列は独立したイベントのため、`eventsToIcs` ではそれぞれ別の `UID` の
VEVENT として書き出されます（`RANGE=THISANDFUTURE` は出力されません）。書き出した ICS を
再インポートしても、オカレンス展開の結果は変わりません。

## 部分取り込みとエラー収集（eventsFromIcsWithIssues）

`eventsFromIcs` は VEVENT 単位の不正（後述の「エラーにする」表に該当するもの）が
1 件でもあると ICS 全体を `Error` として投げます。外部カレンダーからエクスポート
された ICS の一部だけが壊れている場合に、正常な VEVENT だけでも取り込みたいときは
`eventsFromIcsWithIssues(ics)` を使います。

```ts
import { eventsFromIcsWithIssues } from '@koyomi-cal/react/core';

const { events, issues } = eventsFromIcsWithIssues(icsText);
calendar.setEvents(events);
for (const issue of issues) {
  console.warn(`VEVENT #${issue.index}（UID: ${issue.uid ?? '不明'}）を読み飛ばしました: ${issue.message}`);
}
```

- `events` — 取り込めた `CalendarEvent[]`（不正な VEVENT はスキップ）
- `issues` — 読み飛ばした VEVENT ごとの `IcsImportIssue` の配列（ICS 内の出現順）
  - `index` — ICS 内の VEVENT の出現順（0 始まり）
  - `uid` — 対象 VEVENT の `UID`（省略されていた場合は `null`）
  - `summary` — 対象 VEVENT の `SUMMARY`（省略されていた場合は `null`）
  - `message` — 読み飛ばした理由（`eventsFromIcs` が投げるものと同じ `Error` のメッセージ）

`STATUS:CANCELLED` のオーバーライドは `eventsFromIcs` と同じくマスターの `exdates` に
変換されますが、マスターの VEVENT 自体が不正で `issues` 側に回っている場合は反映先が
ないため無視されます。

`BEGIN`/`END` の対応が取れないコンポーネント構造・`':'` のない行など、特定の VEVENT
に閉じない ICS 全体の構造の不正は、`eventsFromIcs` と同様に `eventsFromIcsWithIssues`
でも `Error` を投げます（`issues` には積まれません）。次の「非対応構文の扱い」の
「エラーにする」表のうち、`DTSTART` のない VEVENT・無効な `TZID`・解釈できない日時値・
不正な `RRULE` の 4 つが VEVENT 単位の issue に変換される対象で、残り 2 つ（構造の不正）
は両 API とも常に `Error` になります。

## 非対応構文の扱い

RFC 5545 のうち Koyomi のイベントモデルに対応する表現がない構文は、
「無視する」ものと「エラーにする」ものに分かれます。

**無視する**（該当部分を読み飛ばし、残りは正常に取り込む）:

| 構文 | 扱い |
| --- | --- |
| `VTIMEZONE` 定義 | 無視。`TZID` は独自定義ではなく IANA タイムゾーン ID として解釈する（Google カレンダー・Outlook の IANA ID 出力と互換） |
| `EXRULE` | 無視（RFC 5545 で廃止されたプロパティ） |
| `VALUE=PERIOD` の `RDATE` | 無視（期間付き RDATE は表現できないため） |
| `DURATION` | 無視（`DTEND` がなければ `end` なしになり、表示時は `defaultEventMinutes` が適用される） |
| `VALARM`、`VTODO` / `VJOURNAL` / `VFREEBUSY` などの VEVENT 以外のコンポーネント | 無視 |
| `DTSTAMP` / `SEQUENCE` / `ORGANIZER` / `ATTENDEE` / `X-` プロパティなどの未対応プロパティ | 無視 |

**エラーにする**（`Error` を投げる）:

| 条件 | 理由 |
| --- | --- |
| `DTSTART` のない VEVENT | 開始日時がないと `CalendarEvent` を構成できない |
| IANA として無効な `TZID`（Outlook の独自タイムゾーン名等） | 黙って別のタイムゾーンで解釈すると日時が静かにずれるため |
| 解釈できない日時値・不正な `RRULE` | 同上 |
| `':'` のない行、`BEGIN`/`END` の対応が取れないコンポーネント構造 | iCalendar として不正なため |

## 往復変換（round-trip）の注意

エクスポート → インポートで**オカレンス展開の結果（絶対時刻・タイトル・終日区分）は維持されます**が、
フィールドの表現は次の点で正規化されます。

- オーバーライドの `id` は「`UID@RECURRENCE-ID の値`」に置き換わる（iCalendar ではオーバーライドがマスターと `UID` を共有するため）
- `end` を省略したイベントは、明示的な `end`（時間指定は `defaultEventMinutes` 分後、終日は翌日）を持つようになる
- 日時は文字列表現に正規化される（`Date` → `'...Z'` 文字列、秒の補完、ミリ秒の切り捨て）
- `rrule` は正規化される（大文字化、`RRULE:` プレフィックスの除去）

## 関連ページ

- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [タイムゾーン](./timezones.md)
- [API リファレンス](./api.md)
