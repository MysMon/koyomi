# タイムゾーン

Koyomi は「カレンダー全体の表示タイムゾーン」と「イベントごとのタイムゾーン」を区別して扱うマルチタイムゾーン対応のカレンダーです。本ページでは、表示タイムゾーンの指定方法、イベント日時の解釈規則、終日イベントの扱い、テスト・デモでの時刻固定、そして日時計算に使えるタイムゾーンユーティリティを説明します。

## 表示タイムゾーン

カレンダーの「今日」判定・月/週/日の境界・時間グリッドの目盛りなどはすべて **表示タイムゾーン**（`CalendarState.timeZone`）を基準に計算されます。`CalendarOptions.timeZone` で指定でき、省略時は実行環境（ブラウザ）のローカルタイムゾーンが使われます。

```tsx
import { createCalendar, getLocalTimeZone } from '@koyomi-cal/react';

// timeZone を省略すると実行環境のローカルタイムゾーンが使われる
const local = createCalendar({});
console.log(local.getState().timeZone === getLocalTimeZone()); // => true

// 明示的に指定すると、その IANA タイムゾーンが表示 TZ になる
const tokyo = createCalendar({ timeZone: 'Asia/Tokyo' });
console.log(tokyo.getState().timeZone); // => 'Asia/Tokyo'
```

表示タイムゾーンは `CalendarApi.setTimeZone` で後から変更できます（`useCalendar` を使う React では `calendar.api.setTimeZone(...)`）。不正な IANA タイムゾーン ID を渡すと `Error` になります。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
calendar.setTimeZone('America/New_York');
console.log(calendar.getState().timeZone); // => 'America/New_York'

// 不正な IANA タイムゾーン ID は Error になる
try {
  calendar.setTimeZone('Invalid/Zone');
} catch (error) {
  console.log(error instanceof Error); // => true
}
```

事前に文字列を検証したい場合は後述の `isValidTimeZone` が使えます。なお `CalendarApi.updateOptions({ timeZone: ... })` でも同じように表示タイムゾーンを変更できます（他のオプションと同時に更新したい場合に便利です）。

## イベントごとのタイムゾーン

`CalendarEvent.timeZone` を指定すると、そのイベント固有のタイムゾーンとして扱われます。省略時はカレンダーの表示タイムゾーンが使われます。

`start` / `end` に文字列を渡す場合、ISO 8601 のオフセット有無で解釈が変わります。

- **オフセット付き**（`'2026-07-01T00:00:00Z'` や `'+09:00'` 終わり）— 記載どおりの絶対時刻
- **オフセットなし**（例: `'2026-07-01T10:00'`）— `timeZone`（イベントの `timeZone`、なければ表示 TZ）における**壁時計時刻**として解釈される
- **`'YYYY-MM-DD'`** — 同じく `timeZone` におけるその日の 0:00

次の例では、同じ `'2026-07-01T10:00'` という文字列でも、イベントの `timeZone` によって異なる絶対時刻に解決されます。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  events: [
    // timeZone を指定しない場合は表示 TZ（Asia/Tokyo）の壁時計として解釈される
    { id: 'jst', title: '東京オフィス定例', start: '2026-07-01T10:00' },
    // イベント個別に timeZone を指定すると、そちらの壁時計として解釈される
    {
      id: 'ny',
      title: 'NY 支社との電話会議',
      start: '2026-07-01T10:00',
      timeZone: 'America/New_York',
    },
  ],
});

const occurrences = calendar.getOccurrences({
  start: new Date('2026-07-01T00:00:00Z'),
  end: new Date('2026-07-02T00:00:00Z'),
});
const [tokyoOcc, nyOcc] = occurrences; // getOccurrences は開始時刻順

console.log(tokyoOcc?.start.toISOString()); // => '2026-07-01T01:00:00.000Z'（東京 10:00 = UTC 01:00）
console.log(nyOcc?.start.toISOString()); // => '2026-07-01T14:00:00.000Z'（NY 10:00 = UTC 14:00, EDT）
```

### 繰り返し予定と DST（壁時計の維持）

繰り返し予定（`rrule`）は、イベントのタイムゾーンにおける**壁時計時刻を維持して展開**されます。夏時間（DST）の切り替えを跨いでも、現地時刻としては同じ時刻に発生し続けます（絶対時刻としての UTC オフセットは変わります）。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'America/New_York',
  events: [
    {
      id: 'daily-standup',
      title: 'デイリースタンドアップ',
      start: '2026-03-07T09:00', // DST 切替（2026-03-08 02:00, EST→EDT）の前日
      rrule: 'FREQ=DAILY;COUNT=3',
    },
  ],
});

const occurrences = calendar.getOccurrences({
  start: new Date('2026-03-06T00:00:00Z'),
  end: new Date('2026-03-11T00:00:00Z'),
});

// 3 回とも現地時刻は 9:00 のまま（絶対時刻の UTC オフセットは EST→EDT で変わる）
console.log(occurrences.map((o) => o.start.toISOString()));
// => [
//      '2026-03-07T14:00:00.000Z', // EST（UTC-5）: 9:00 = 14:00Z
//      '2026-03-08T13:00:00.000Z', // DST 切替日、EDT（UTC-4）: 9:00 = 13:00Z
//      '2026-03-09T13:00:00.000Z', // EDT（UTC-4）: 9:00 = 13:00Z
//    ]
```

## 終日イベント

`allDay: true` のイベントは「カレンダー上の日付」に紐づき、タイムゾーンに依存しません（Google カレンダーと同じ挙動です）。`start` / `end` は日付として解釈され、`end` は排他的です（例: 7/10〜7/11 の 2 日間なら `start: '2026-07-10'`, `end: '2026-07-12'`）。

表示タイムゾーンを変更しても、終日イベントが属する「日付」自体は変わりません（内部的には、その日付における表示 TZ の 0:00 が発生の絶対時刻になるため、絶対時刻の値は変わりますが、日付キーは変わりません）。

```tsx
import { createCalendar, dateKeyInZone } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  events: [{ id: 'trip', title: '出張', start: '2026-07-10', end: '2026-07-12', allDay: true }],
});

function firstDayKey(): string | undefined {
  const [occ] = calendar.getOccurrences({
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-08-01T00:00:00Z'),
  });
  return occ === undefined ? undefined : dateKeyInZone(occ.start, calendar.getState().timeZone);
}

console.log(firstDayKey()); // => '2026-07-10'

// 表示 TZ を変えても「日付」は変わらない
calendar.setTimeZone('America/New_York');
console.log(firstDayKey()); // => '2026-07-10'
```

## now オプション（テスト・デモでの時刻固定）

`CalendarOptions.now` は現在時刻を返す関数で、「今日」の判定（`isToday`）や時間グリッドの現在時刻線（`nowIndicator`）、`CalendarApi.today()` の移動先に使われます。省略時は `() => new Date()` です。テストやデモで日時を固定したい場合に指定します。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const fixedNow = new Date('2026-07-07T00:00:00Z');
const calendar = createCalendar({ now: () => fixedNow, initialDate: fixedNow });

// today() は now() の返り値に移動する
calendar.today();
console.log(calendar.getState().currentDate.getTime() === fixedNow.getTime()); // => true

// 月ビューの「今日」判定も now() を基準にする
const vm = calendar.getViewModel();
if (vm.type === 'month') {
  console.log(vm.weeks.flatMap((week) => week.days).some((day) => day.isToday)); // => true
}
```

## タイムゾーンユーティリティ

日時のタイムゾーン変換を自前のコード（カスタム `renderEvent` や外部同期処理など）で行いたい場合のために、Koyomi が内部で使っているタイムゾーンユーティリティも公開されています。「絶対時刻（インスタント、`Date`）」と「壁時計（あるタイムゾーンで時計が示す年月日・時分）」を相互変換するための関数群です。

| 関数 | 概要 |
| --- | --- |
| `getLocalTimeZone()` | 実行環境のローカルタイムゾーン ID を返す |
| `isValidTimeZone(timeZone)` | 文字列が有効な IANA タイムゾーン ID かどうかを判定する |
| `fromWallClock(parts, timeZone)` | 壁時計成分（`WallClockParts`）から絶対時刻を構築する |
| `getWallClock(date, timeZone)` | 絶対時刻を指定タイムゾーンの壁時計成分に分解する |
| `dateKeyInZone(date, timeZone)` | 絶対時刻を `'YYYY-MM-DD'` の日付キーに変換する |
| `dateFromKey(key, timeZone)` | `'YYYY-MM-DD'` の日付キーから、その日の 0:00 の絶対時刻を返す |
| `startOfDayInZone(date, timeZone)` | 指定タイムゾーンにおける、その日の 0:00 の絶対時刻を返す |
| `addDaysInZone(date, amount, timeZone)` | 壁時計基準で日数を加算する（DST を跨いでも壁時計時刻を維持） |
| `addMinutesInZone(date, amount, timeZone)` | 壁時計基準で分数を加算する |
| `minutesOfDayInZone(date, timeZone)` | その日の 0:00 からの経過分（0〜1439）を返す |
| `isSameDayInZone(a, b, timeZone)` | 2 つの絶対時刻が指定タイムゾーンの壁時計基準で同じ日か判定する |
| `weekdayInZone(date, timeZone)` | 指定タイムゾーンにおける曜日（0=日曜日〜6=土曜日）を返す |
| `formatSlotLabel(minutes)` | その日の 0:00 からの分数を `'HH:mm'` 形式のラベルにする |
| `parseDateValue(value, timeZone, allDay)` | `CalendarEvent.start` / `end` と同じ解釈規則で日時の値を絶対時刻に変換する |

```tsx
import {
  addDaysInZone,
  dateFromKey,
  dateKeyInZone,
  formatSlotLabel,
  fromWallClock,
  getWallClock,
  isSameDayInZone,
  isValidTimeZone,
  minutesOfDayInZone,
  parseDateValue,
  weekdayInZone,
} from '@koyomi-cal/react';

// 壁時計成分 ⇔ 絶対時刻
const instant = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, 'Asia/Tokyo');
console.log(instant.toISOString()); // => '2026-07-01T01:00:00.000Z'
console.log(getWallClock(instant, 'Asia/Tokyo')); // => { year: 2026, month: 7, day: 1, hours: 10, minutes: 0, ... }

// 絶対時刻 ⇔ 'YYYY-MM-DD' キー
const key = dateKeyInZone(new Date('2026-06-30T20:00:00Z'), 'Asia/Tokyo');
console.log(key); // => '2026-07-01'（UTC 20:00 は東京では翌日の 5:00）
console.log(dateFromKey(key, 'Asia/Tokyo').toISOString()); // => '2026-06-30T15:00:00.000Z'

// DST を跨ぐ日加算でも現地時刻（壁時計）は維持される
const beforeDst = fromWallClock({ year: 2026, month: 3, day: 7, hours: 9 }, 'America/New_York');
const nextDay = addDaysInZone(beforeDst, 1, 'America/New_York');
console.log(getWallClock(nextDay, 'America/New_York').hours); // => 9（DST で絶対時刻としては 23 時間後）

// その他のユーティリティ
console.log(isValidTimeZone('Invalid/Zone')); // => false
console.log(minutesOfDayInZone(instant, 'Asia/Tokyo')); // => 600
console.log(formatSlotLabel(600)); // => '10:00'
console.log(weekdayInZone(instant, 'Asia/Tokyo')); // => 3（2026-07-01 は水曜日）
console.log(isSameDayInZone(instant, new Date('2026-07-01T10:00:00Z'), 'Asia/Tokyo')); // => true

// CalendarEvent.start/end と同じ規則で汎用的に日時を解釈する
console.log(parseDateValue('2026-07-01T10:00', 'Asia/Tokyo', false).toISOString());
// => '2026-07-01T01:00:00.000Z'（オフセットなし ISO は壁時計として解釈）
```

## 関連ページ

- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [ビュー（月・週・日・リスト）](./views.md)
- [はじめに](./getting-started.md)
- [API リファレンス](./api.md)
