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

- **オフセット付き**（`'2026-07-01T00:00:00Z'` や `'+09:00'` で終わるもの）— 記載どおりの絶対時刻
- **オフセットなし**（例: `'2026-07-01T10:00'`）— `timeZone`（イベントの `timeZone`、なければ表示 TZ）における**現地時刻**として解釈される
- **`'YYYY-MM-DD'`** — 同じく `timeZone` におけるその日の 0:00

次の例では、同じ `'2026-07-01T10:00'` という文字列でも、イベントの `timeZone` によって異なる絶対時刻に解決されます。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  events: [
    // timeZone を指定しない場合は表示 TZ（Asia/Tokyo）の現地時刻として解釈される
    { id: 'jst', title: '東京オフィス定例', start: '2026-07-01T10:00' },
    // イベント個別に timeZone を指定すると、そちらの現地時刻として解釈される
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

### 繰り返し予定と DST（現地時刻の維持）

繰り返し予定（`rrule`）は、イベントのタイムゾーンにおける**現地時刻を維持して展開**されます。夏時間（DST）の切り替えを跨いでも、現地時刻としては同じ時刻に発生し続けます（絶対時刻としての UTC オフセットは変わります）。

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

表示タイムゾーンを変更しても、終日イベントが属する「日付」自体は変わりません（内部的には、その日付における表示 TZ の 0:00 がオカレンスの絶対時刻になるため、絶対時刻の値は変わりますが、日付キーは変わりません）。

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

## 複数タイムゾーン軸（secondary time zone）

週/日ビュー（時間グリッド）の時間軸に、表示タイムゾーン以外のタイムゾーンを軸として並べられます（Google カレンダーのセカンダリタイムゾーン相当）。`CalendarOptions.timeAxisZones` に IANA タイムゾーン ID の配列を渡します（検証は `timeZone` と同じ `isValidTimeZone` の流儀で、不正な値を含むと `Error` になります）。

```tsx
import { createCalendar } from '@koyomi-cal/react';

const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  initialView: 'week',
  timeAxisZones: ['America/New_York'],
});

const vm = calendar.getViewModel();
if (vm.type === 'timeGrid') {
  console.log(vm.timeAxes.map((axis) => axis.timeZone));
  // => ['Asia/Tokyo', 'America/New_York']（先頭が主軸、以降が指定順の追加軸）
}
```

各追加軸のラベル（`TimeAxis.slots`）は固定オフセットの加算ではなく、実際のタイムゾーン変換で算出されます。具体的には、表示範囲の最初の日を基準に `addMinutesInZone` で主軸の現地時刻を維持した絶対時刻を求め、それを追加軸のタイムゾーンの現地時刻へ変換します。そのため、基準日が追加軸側の DST 切替日であれば、切替前後でラベルのオフセットも正しく変わります。

```tsx
import { createCalendar } from '@koyomi-cal/react';

// America/New_York は 2026-03-08 の 2:00 → 3:00 に夏時間へ切り替わる
const calendar = createCalendar({
  timeZone: 'America/New_York',
  initialView: 'day',
  initialDate: new Date('2026-03-08T05:00:00Z'), // NY 0:00（切替前、EST=UTC-5）
  timeAxisZones: ['UTC'],
});

const vm = calendar.getViewModel();
if (vm.type === 'timeGrid') {
  const utcAxis = vm.timeAxes[1];
  console.log(utcAxis?.slots.find((slot) => slot.minutes === 60)?.label); // => '06:00'（NY 1:00、EST）
  console.log(utcAxis?.slots.find((slot) => slot.minutes === 240)?.label); // => '08:00'（NY 4:00、EDT。
  // 固定 -5 オフセットの加算では '09:00' になってしまうところ、切替後のオフセット -4 が正しく反映される）
}
```

`timeAxisZones` を省略した場合は従来どおり主軸のみで、`TimeGridViewModel.timeAxes` は主軸 1 要素の配列になり `slots` の内容と一致します（既存の挙動と完全互換）。`TimeGridView` は `timeAxes` の数だけ時間軸の列を描画し、各列に `data-koyomi-timezone` 属性でどのタイムゾーンの軸かを識別できます（詳細は [ビュー: 複数タイムゾーン軸](./views.md#複数タイムゾーン軸timeaxiszones) を参照）。

`TimeGridViewModel.timeAxes` は週全体で共有する 1 組の値で、表示範囲の**最初の日**を基準に算出します。そのため `viewType: 'week'` で追加軸のタイムゾーンが表示範囲の途中に DST 切替を挟む週では、切替後の日については実際のオフセットとずれます（既定の `TimeGridView` が単一の軸列しか描画しないための制約）。日ごとに正しいオフセットが必要な場合は、各日の `TimeGridDay.timeAxes`（その日自身の 0:00 を基準に個別算出）を使います。

```tsx
// Asia/Tokyo 主軸・America/New_York 追加軸、NY が 2026-03-08 に夏時間へ切り替わる週
const calendar = createCalendar({
  timeZone: 'Asia/Tokyo',
  initialView: 'week',
  initialDate: new Date('2026-03-08T00:00:00+09:00'), // 週開始日（日曜）
  timeAxisZones: ['America/New_York'],
});

const vm = calendar.getViewModel();
if (vm.type === 'timeGrid') {
  const sunday = vm.days.find((day) => day.key === '2026-03-08');
  const monday = vm.days.find((day) => day.key === '2026-03-09');
  // 東京 9:00 は日曜（切替前、EST=UTC-5）では NY 19:00、月曜（切替後、EDT=UTC-4）では NY 20:00
  console.log(sunday?.timeAxes[1]?.slots.find((slot) => slot.minutes === 540)?.label); // => '19:00'
  console.log(monday?.timeAxes[1]?.slots.find((slot) => slot.minutes === 540)?.label); // => '20:00'
}
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

### 現在時刻線を時間経過に追従させる（refresh / refreshSeconds）

`now()` はビューモデルの構築時にのみ評価されるため、状態が変わらない限り現在時刻線や「今日」の判定は自動では動きません。時間経過に追従させるには次のいずれかを使います。

- **React**: `useCalendar` の `refreshSeconds` オプション。指定秒数ごとにビューモデルを再構築します（現在時刻線の分解能は分単位なので通常は `60` で十分）

  ```tsx
  const calendar = useCalendar({ initialView: 'week', refreshSeconds: 60 });
  ```

- **フレームワーク非依存**: `calendar.refresh()` を任意のタイミング（`setInterval` や `visibilitychange` など）で呼びます。状態は変えずに `now()` を再評価して購読者に通知します

## タイムゾーンユーティリティ

日時のタイムゾーン変換を自前のコード（カスタム `renderEvent` や外部同期処理など）で行いたい場合のために、Koyomi が内部で使っているタイムゾーンユーティリティも公開されています。「絶対時刻（時点、`Date`）」と「現地時刻（あるタイムゾーンで時計が示す年月日・時分）」を相互変換するための関数群です。

| 関数 | 概要 |
| --- | --- |
| `getLocalTimeZone()` | 実行環境のローカルタイムゾーン ID を返す |
| `isValidTimeZone(timeZone)` | 文字列が有効な IANA タイムゾーン ID かどうかを判定する |
| `fromWallClock(parts, timeZone)` | 現地時刻の成分（`WallClockParts`）から絶対時刻を構築する |
| `getWallClock(date, timeZone)` | 絶対時刻を指定タイムゾーンの現地時刻の成分に分解する |
| `dateKeyInZone(date, timeZone)` | 絶対時刻を `'YYYY-MM-DD'` の日付キーに変換する |
| `dateFromKey(key, timeZone)` | `'YYYY-MM-DD'` の日付キーから、その日の 0:00 の絶対時刻を返す |
| `startOfDayInZone(date, timeZone)` | 指定タイムゾーンにおける、その日の 0:00 の絶対時刻を返す |
| `addDaysInZone(date, amount, timeZone)` | 現地時刻基準で日数を加算する（DST を跨いでも現地時刻を維持） |
| `addMinutesInZone(date, amount, timeZone)` | 現地時刻基準で分数を加算する |
| `minutesOfDayInZone(date, timeZone)` | その日の 0:00 からの経過分（0〜1439）を返す |
| `isSameDayInZone(a, b, timeZone)` | 2 つの絶対時刻が指定タイムゾーンの現地時刻基準で同じ日か判定する |
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

// 現地時刻の成分 ⇔ 絶対時刻
const instant = fromWallClock({ year: 2026, month: 7, day: 1, hours: 10 }, 'Asia/Tokyo');
console.log(instant.toISOString()); // => '2026-07-01T01:00:00.000Z'
console.log(getWallClock(instant, 'Asia/Tokyo')); // => { year: 2026, month: 7, day: 1, hours: 10, minutes: 0, ... }

// 絶対時刻 ⇔ 'YYYY-MM-DD' キー
const key = dateKeyInZone(new Date('2026-06-30T20:00:00Z'), 'Asia/Tokyo');
console.log(key); // => '2026-07-01'（UTC 20:00 は東京では翌日の 5:00）
console.log(dateFromKey(key, 'Asia/Tokyo').toISOString()); // => '2026-06-30T15:00:00.000Z'

// DST を跨ぐ日加算でも現地時刻は維持される
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
// => '2026-07-01T01:00:00.000Z'（オフセットなし ISO は現地時刻として解釈）
```

## 関連ページ

- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [はじめに](./getting-started.md)
- [API リファレンス](./api.md)
