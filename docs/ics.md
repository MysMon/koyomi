# iCalendar（ICS）入出力

Koyomi は、イベントの配列（`CalendarEvent[]`）と iCalendar（RFC 5545、いわゆる `.ics` ファイル）の
文字列を相互変換する関数を提供します。Google カレンダーや Outlook など、iCalendar 形式で
エクスポート・インポートできるカレンダーとのデータ交換に使えます。

- **`eventsToIcs(events, options?)`** — `CalendarEvent[]` → `VCALENDAR`/`VEVENT` 文字列
- **`eventsFromIcs(ics)`** — `.ics` テキスト → `CalendarEvent[]`

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
| `STATUS:CANCELLED` + `RECURRENCE-ID` | 「そのオカレンスの削除」として、同じ `UID` のマスターの `exdates` に変換される（マスターが同じ ICS 内にない場合は無視）。`RECURRENCE-ID` のない `STATUS:CANCELLED` の VEVENT は取り込まれない |

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
| `RECURRENCE-ID` の `RANGE=THISANDFUTURE` パラメータ | 無視（常に単一オカレンスのオーバーライドとして扱う） |
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
