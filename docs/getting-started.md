# はじめに

`@koyomi-cal/react` は、TypeScript/React 製のヘッドレスなカレンダーライブラリです。このページでは、インストールから最小構成のカレンダー表示、予定データの受け渡し、クリック・ドラッグでの操作までを順を追って説明します。

## Koyomi とは

Koyomi はロジックとマークアップのみを提供する**ヘッドレス**なカレンダーライブラリで、見た目は利用側が自由に決められます（デフォルトテーマも同梱）。月・週・日・リスト・年・複数月・リソース・タイムラインの 8 つのビュー（後者 4 つは opt-in）を切り替えられ、ドラッグでの予定作成・移動・リサイズや繰り返し予定の編集スコープ選択など、Google カレンダー相当の操作を標準でサポートします。予定ごとのタイムゾーンと表示タイムゾーンを切り替えられるマルチタイムゾーン対応に加え、RFC 5545 の RRULE（繰り返しパターン言語）に完全対応し、RDATE / EXDATE 相当の追加・除外指定（`rdates` / `exdates`）もサポートします。キーボードのみでの予定操作や SSR（Next.js 等）にも対応しています。

## インストール

```bash
pnpm add @koyomi-cal/react
```

`react` と `react-dom` は peerDependencies です。バージョン 19 系が必要です。

```json
{
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

## 最小の使い方

カレンダーの状態は `useCalendar` フックで作成し、`CalendarProvider` で配下のビルトインコンポーネント（`Toolbar` / `CalendarView` など）に共有します。デフォルトの見た目を使う場合は `@koyomi-cal/react/theme.css` を読み込みます。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar();

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - Toolbar に「今日」「‹」「›」と期間タイトル、月/週/日/リストの切替ボタンが表示される
// - CalendarView が現在のビュー（既定は 'month'）に応じて MonthView などを描画する
```

`useCalendar` はカレンダーエンジンを作成し、`api`（操作用の安定した API）・`state`（現在の状態）・`viewModel`（現在のビューに対応する描画用データ）を返します。`CalendarProvider` の `value` にそのまま渡してください。

## イベントを与える

予定は `CalendarEvent` の配列として `useCalendar` に渡します。最小限必要なのは `id` / `title` / `start` です（`end` は省略可能で、省略時は時間指定イベントは `defaultEventMinutes`（既定 60 分）後、終日イベントは 1 日後になります）。日時は `Date` でも ISO 8601 文字列でも構いません。

```tsx
import type { CalendarEvent } from '@koyomi-cal/react';
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

const events: CalendarEvent[] = [
  {
    id: '1',
    title: '定例ミーティング',
    start: '2026-07-08T10:00:00',
    end: '2026-07-08T11:00:00',
  },
];

function App() {
  const calendar = useCalendar({ events });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 2026年7月8日のセル（月ビュー）に「10:00 定例ミーティング」が表示される
```

`events` は `useCalendar` の**初期値**として一度だけ使われます。後から動的に入れ替える場合（サーバーから fetch した結果を反映する場合など）は `calendar.api.setEvents(nextEvents)` を使ってください（詳細は [予定の管理](./events.md) を参照）。マウント後に異なる `events` を props として渡し続けても反映されず、開発ビルドでは一度だけ警告が表示されます。

## クリック・ドラッグで作成できるようにする

月ビュー・週/日ビューでは、空き領域をクリックまたはドラッグすると新規予定の範囲選択ができます。`CalendarProvider` の `callbacks` に `onSelectRange` を渡すと、選択が確定した時点でその内容（`range` / `allDay`）を受け取れます。

```tsx
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

function App() {
  const calendar = useCalendar();

  function handleSelectRange(selection: RangeSelection) {
    // ここで作成ダイアログを開く、または直接 API で作成する
    calendar.api.createEvent({
      title: '新しい予定',
      start: selection.range.start,
      end: selection.range.end,
      allDay: selection.allDay,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 月ビューの日セルや週/日ビューの時間帯をドラッグして離すと handleSelectRange が呼ばれる
// - selection.range.start / selection.range.end が選択した日時範囲（end は排他的）
// - selection.allDay は終日枠（月ビューのセル・終日行）での選択なら true
```

`onSelectRange` を**省略した場合**は、既定動作として `defaultEventTitle` オプション（既定 `'(タイトルなし)'`）のタイトルの予定がその場で即時作成されます。作成ダイアログを出したい場合など、既定動作を止めたいときは `onSelectRange` を指定してください。

## 予定クリックで詳細を出す

予定（イベント）がクリックされたときは `onEventClick` が呼ばれます。クリックされた予定のオカレンス（`EventOccurrence`）と元の `MouseEvent` を受け取れるので、詳細パネルや編集ダイアログを開く起点として使えます。

```tsx
import { useState } from 'react';
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent, EventOccurrence } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

const events: CalendarEvent[] = [
  { id: '1', title: '定例ミーティング', start: '2026-07-08T10:00:00', end: '2026-07-08T11:00:00' },
];

function App() {
  const calendar = useCalendar({ events });
  const [selected, setSelected] = useState<EventOccurrence | null>(null);

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{ onEventClick: (occurrence) => setSelected(occurrence) }}
    >
      <Toolbar />
      <CalendarView />
      {selected && <p>選択中: {selected.event.title}</p>}
    </CalendarProvider>
  );
}

// 期待される動作:
// - 予定をクリックすると setSelected が呼ばれ、「選択中: 定例ミーティング」が表示される
```

`onEventClick` を省略した場合は何も起こりません（既定動作なし）。ダイアログや詳細パネルの実装は利用側の自由です。Koyomi はそれらの UI を提供しません。

## SSR / Next.js で使う

`useCalendar` は SSR（`renderToString` / Next.js の App Router 等）でも例外なく初期状態を描画できます。次の 2 点に注意してください。

- ドラッグ操作などブラウザ API を使うコンポーネントを含むため、Next.js の App Router ではカレンダーを使うコンポーネントに **`'use client'` ディレクティブ**が必要です
- 「今日」の判定はレンダリング時の `now()` に依存するため、サーバーとクライアントで日付境界をまたいだ瞬間にはハイドレーション差分が起きる可能性があります。厳密に避けたい場合は `initialDate` と `now` を明示的に固定してください
- **`timeZone` を明示指定してください**。省略時は実行環境の `Intl` ローカルタイムゾーンが使われるため、サーバー（例: `UTC`）とクライアント（例: `Asia/Tokyo`）で異なると、「今日」・日付キー・イベント配置・時刻ラベルがハイドレーション前後でずれます。SSR では `useCalendar({ timeZone: 'Asia/Tokyo' })` のように固定するのが安全です

## React に依存しないコアだけを使う

`createCalendar` を含むカレンダーエンジン（`src/core/` 配下の公開 API）は、React を一切 import しない専用エントリ `@koyomi-cal/react/core` からも利用できます。React を持たない Node.js 環境（サーバーサイドのバッチ処理・CLI ツール等）や他の UI フレームワークから使う場合はこちらを使ってください。

```ts
import { createCalendar } from '@koyomi-cal/react/core';

const calendar = createCalendar({ timeZone: 'Asia/Tokyo' });
console.log(calendar.getViewModel().type); // => 'month'
```

`react` / `react-dom` は `package.json` の `peerDependencies` ですが、`@koyomi-cal/react/core` のみを使う場合は未インストールでも実行時エラーにはなりません（インストール時のピア依存の警告は無視できます。pnpm の `strict-peer-dependencies=true` 設定下ではエラーになるため、その場合は設定の緩和か react のインストールが必要です）。詳細は [API リファレンス](./api.md#koyomi-calreactcorereact-非依存の単体エントリ) を参照してください。

## 次に読む

- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [繰り返し予定](./recurrence.md)
- [アクセシビリティ](./accessibility.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
