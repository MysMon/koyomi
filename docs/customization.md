# カスタマイズガイド

Koyomi のビルトインコンポーネントは、目的に応じて 3 つの層でカスタマイズできます。本ページでは層の選び方、カスタム描画スロット（render prop）の共通ルール、イベント内容の分解済みパーツ（`parts`）、ビュー横断の一括定義（`renderEventContent`）、そして構造そのものを変えたい場合の自作ビューについて説明します。

## カスタマイズの 3 層

| 層 | 手段 | 変えられるもの | 参照 |
| --- | --- | --- | --- |
| 1. スタイル | CSS 変数・`data-koyomi-*` 属性セレクタ | 配色・寸法・フォントなど見た目のすべて | [テーマとスタイリング](./theming.md) |
| 2. コンテンツ | カスタム描画スロット（render prop）と `renderEventContent` | インタラクティブ要素の**内側**の内容（イベントの表示内容、日セルへの差し込み等） | このページ |
| 3. 構造 | `viewModel` ＋ D&D フックで自作ビュー | DOM 構造そのもの | [構造そのものを変えたい場合](#構造そのものを変えたい場合自作ビュー) |

迷ったら上の層から検討してください。見た目だけなら CSS（層 1）で足ります。「タイトルの上に別の情報を出したい」「場所や参加者を追記したい」のような内容の変更は層 2 で書けます。レイアウトや DOM 構造ごと変えたい場合だけ層 3 に進みます。

## カスタム描画スロットの共通ルール

ビルトインコンポーネントの render prop（一覧は [ビュー: ビューコンポーネントのカスタマイズ props](./views.md#ビューコンポーネントのカスタマイズ-props)）は、すべて次の形をとります。

```ts
(item, ctx) => ReactNode
```

- `item` — スロットに応じた対象（オカレンス・セグメント・日・列など）
- `ctx.defaultContent` — 省略時にライブラリが描画する既定の内容。そのまま返せば省略時と同じ表示になり、前後に要素を足す・独自の要素でラップするといった「既定＋差分」のカスタマイズが、既定の整形を再構築せずに書けます

```tsx
// 例: 月ビューの日セルに、既定の内容（日番号・「+N 件」）を保ったままバッジを足す
<MonthView
  renderDayCell={(day, ctx) => (
    <>
      {ctx.defaultContent}
      {day.isToday && <span className="today-badge">今日</span>}
    </>
  )}
/>
```

### 差し替えの境界（仕様）

render prop が置き換えるのは**インタラクティブ要素の内側の内容だけ**です。次のものはライブラリが常に保持し、カスタマイズの影響を受けません。

- 外側の要素そのもの（`<button data-koyomi="month-event">` 等）と `data-koyomi-*` 属性
- `aria-label` などのアクセシビリティ属性
- クリック・ドラッグ・キーボード操作の配線
- リサイズハンドル（`month-event-resize` / `timegrid-resize` 等）

つまり、どれだけ内容をカスタマイズしても、テーマ CSS のセレクタ・スクリーンリーダーの読み上げ・ドラッグ操作は壊れません。逆に、外側の要素や操作の挙動そのものを変えるための差し替え口は提供していません（意図的な設計です。ボタン要素・ARIA・ドラッグ配線の正しさはライブラリが保証する不変条件であり、これを差し替え可能にすると利用者側にその保証責任が移ってしまうため）。構造ごと変えたい場合は[自作ビュー](#構造そのものを変えたい場合自作ビュー)を使ってください。

## イベント内容のカスタマイズ（ctx.parts と ctx.slot）

イベントの表示内容を差し替えるスロット（各ビューの `renderEvent` / `renderAllDayEvent` / `renderAllDayItem`、および後述の `renderEventContent`）には、`ctx.defaultContent` に加えて次が渡されます（`EventContentContext` 型）。

- `ctx.slot` — どの描画枠に対する描画か（`EventContentSlot` 型）。値は外側要素の `data-koyomi` 部位名と同じ語彙です

  | `ctx.slot` | 描画枠 |
  | --- | --- |
  | `'month-event'` | 月ビュー・複数月ビューの帯 |
  | `'timegrid-event'` | 週/日ビュー・リソースビューの時間指定ブロック |
  | `'allday-event'` | 週/日ビューの終日行の帯・リソースビューの終日アイテム |
  | `'list-event'` | リストビュー（仮想化含む）の予定行 |
  | `'timeline-item'` | タイムラインビュー（仮想化含む）の帯 |

- `ctx.view` — どのビューでの描画か（`CalendarViewType`）。同じスロットを複数のビューが使うため（`'timegrid-event'` は週/日ビューとリソースビュー、`'month-event'` は月ビューと複数月ビュー）、スロットが同じでもビューごとに内容を出し分けたいときの判別子に使います

- `ctx.parts` — 既定内容を分解したパーツ（`EventContentParts` 型）。「時刻とタイトルの順序を入れ替える」「間に追加情報を挟む」を、既定の時刻整形や `data-koyomi` 部位を自前で再構築せずに書くための部品です

  | フィールド | 内容 |
  | --- | --- |
  | `timeText` | 整形済みの時刻テキスト（`string`）。形式はスロットにより異なる（`month-event` は開始時刻 `'10:00'`、`timegrid-event`・`list-event`・`timeline-item` は範囲 `'10:00〜11:00'` 等）。`timeline-item` は既定内容に時刻を表示しないが、時間指定イベントでは整形済みの範囲がここに渡る（複数日にまたがる場合は日付付き `'7月15日 22:00〜7月16日 2:00'`）。時刻を表示しないもの（終日イベント・複数日にまたがる月の帯など）では `null` |
  | `titleText` | タイトル文字列（`event.title` そのまま） |
  | `time` | 時刻の既定部位。リスト行では `data-koyomi="list-event-time"` の要素、部位要素を持たないスロットでは `timeText` と同じ文字列 |
  | `swatch` | 色見本の既定部位（リスト行の `data-koyomi="list-event-swatch"` のみ。他スロットは `null`） |
  | `title` | タイトルの既定部位。リスト行では `data-koyomi="list-event-title"` の要素、部位要素を持たないスロットではタイトル文字列そのもの |

```tsx
// 例: リストビューで、data-koyomi 部位（テーマ CSS のフック）を保ったまま
// タイトルを時刻より前に出す
<ListView
  renderEvent={(occurrence, ctx) => (
    <>
      {ctx.parts.title}
      {ctx.parts.swatch}
      {ctx.parts.time}
    </>
  )}
/>
```

## ビュー横断で一括定義する（renderEventContent）

アプリの情報設計（何をどの優先度で出すか）はビューを跨いで一貫していることが多いため、`CalendarProvider` の `renderEventContent` prop で**すべてのビューのイベント内容を 1 箇所で定義**できます。対象は上表の 5 スロットすべてです（年ビューはイベント内容そのものを描画せず、日セルに件数マーカーを出すだけのため対象外です。年ビューの日セルは `renderDayCell` でカスタマイズできます）。

```tsx
import type { EventContentRenderer } from '@koyomi-cal/react';

// コンポーネント外の定数、または useCallback の結果として渡す（messages と同じく、
// 毎レンダー新しい関数を渡すと配下コンポーネントが不要に再レンダーされる）
const renderEventContent: EventContentRenderer = (occurrence, ctx) => (
  <>
    {ctx.defaultContent}
    {occurrence.event.location !== undefined && <span>＠{occurrence.event.location}</span>}
  </>
);

function App() {
  const calendar = useCalendar({ events });
  return (
    <CalendarProvider value={calendar} renderEventContent={renderEventContent}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 月・週/日・リスト・複数月・リソース・タイムラインの全ビューで、イベント内容の
//   後ろに「＠場所」が付く（既定の時刻表示・タイトルは ctx.defaultContent 経由でそのまま）
// - aria-label・ドラッグ操作・リサイズハンドルは影響を受けない（差し替えの境界を参照）
// - 描画枠ごとに内容を変えたい場合は ctx.slot で分岐できる
```

解決の優先順位は次のとおりです。

1. ビュー個別の render prop（`renderEvent` / `renderAllDayEvent` / `renderAllDayItem`）
2. `CalendarProvider` の `renderEventContent`
3. 既定内容

優先順位はスロット単位で判定されます。たとえば `TimeGridView` に `renderEvent` だけを渡した場合、時間指定ブロックは `renderEvent` が、終日行の帯は引き続き `renderEventContent` が描画します。

## レシピ

### タイトルより上に別の情報を出す

```tsx
<CalendarProvider
  value={calendar}
  renderEventContent={(occurrence, ctx) => (
    <>
      <strong>{occurrence.event.location}</strong> {ctx.parts.title}
    </>
  )}
>
```

### 既定の内容にバッジを足す

```tsx
<MonthView
  renderEvent={(segment, ctx) => (
    <>
      {ctx.defaultContent}
      {segment.occurrence.isRecurring && <span className="repeat-badge">定期</span>}
    </>
  )}
/>
```

### 「+N 件」に集約された予定を色付きドットで示す

「+N 件」ボタンのラベルは `renderOverflowLabel`（`CalendarView` 経由では
`renderMonthOverflowLabel` / `renderMultiMonthOverflowLabel`）で差し替えられます。
ボタン要素・クリック配線（`onOverflowClick`）は保持され、内側だけが差し替わります。

```tsx
<MonthView
  renderOverflowLabel={(day, ctx) => (
    <>
      {ctx.defaultContent}
      {ctx.hiddenOccurrences.map((occurrence) => (
        <span key={occurrence.key} className="dot" style={{ background: occurrence.event.color }} />
      ))}
    </>
  )}
/>
```

文言（「+N 件」の表記そのもの）だけを変えたい場合は、このスロットではなく中央メッセージカタログ（`messages.month.overflow` / `messages.multiMonth.overflow`）を使ってください。

### 完成形のレシピ（コピー&ペースト用）

ヘッドレスなフック・コールバックの上に UI 一式を組んだ、そのままコピー&ペーストして使える完成形は次の各ページに掲載しています（実装はデモアプリ `apps/demo/src/` に含まれる、実際に動作するコードそのものです）。

- [繰り返しルールエディタ UI（`useRecurrenceRuleEditor` のフォーム一式）](./recurrence.md#完成形-繰り返しルールエディタ-uiコピーペースト用)
- [繰り返し予定の適用範囲選択ダイアログ（`resolveRecurringScope` の選択 UI）](./interactions.md#完成形-適用範囲選択ダイアログコピーペースト用)
- [「+N 件」ポップオーバー（`overflowPopoverButtonProps` とフォーカス復帰）](./interactions.md#完成形-外部ライブラリ不要のフォーカス復帰込み実装コピーペースト用)

### ビューによって情報量を変える

```tsx
const renderEventContent: EventContentRenderer = (occurrence, ctx) => {
  if (ctx.slot === 'month-event') {
    // 月の帯は狭いのでタイトルのみ
    return ctx.parts.title;
  }
  if (ctx.view === 'resource') {
    // 同じ 'timegrid-event' スロットでも、リソースビューだけ場所を追記する
    return (
      <>
        {ctx.defaultContent}
        <span>{occurrence.event.location}</span>
      </>
    );
  }
  return (
    <>
      {ctx.defaultContent}
      <span>{occurrence.event.description}</span>
    </>
  );
};
```

## 構造そのものを変えたい場合（自作ビュー）

DOM 構造やレイアウトごと変えたい場合は、ビルトインのビューコンポーネントを使わず、`useCalendar` が返す `viewModel`（月・週/日・リスト・年・複数月・リソース・タイムラインの各ビューモデル）から自前のビューを組み立てられます。ドラッグ操作も公開フック（`useDayDrag` / `useTimeGridDrag` / `useResourceGridDrag` / `useTimelineDrag` / `useExternalDrag`）のプロップゲッター（`getDayCellProps` / `getEventProps` 等）を自作の要素に展開することで配線できます。

```tsx
import { CalendarProvider, useCalendar } from '@koyomi-cal/react';

function MyMonthView() {
  const calendar = useCalendar({ initialView: 'month', events });
  const { viewModel } = calendar;
  if (viewModel.type !== 'month') {
    return null;
  }
  return (
    <table>
      <tbody>
        {viewModel.weeks.map((week) => (
          <tr key={week.days[0]?.key}>
            {week.days.map((day) => (
              <td key={day.key}>{day.date.getDate()}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

ビューモデルの構造は [API リファレンス](./api.md)、D&D フックの使い方は [インタラクション](./interactions.md) を参照してください。

## 関連ページ

- [テーマとスタイリング（CSS 変数・data-koyomi 属性）](./theming.md)
- [ビュー: ビューコンポーネントのカスタマイズ props（スロット一覧）](./views.md#ビューコンポーネントのカスタマイズ-props)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [API リファレンス](./api.md)
