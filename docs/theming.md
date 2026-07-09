# テーマとスタイリング

Koyomi のビルトインコンポーネントはヘッドレスです。ロジックと DOM 構造だけを提供し、見た目は `data-koyomi-*` 属性をフックにした CSS で自由に組み立てられます。本ページでは、ヘッドレス設計の考え方、同梱のデフォルトテーマの当て方、CSS 変数によるカスタマイズ、ダークモード、`data-koyomi-*` 属性の一覧、そして自前スタイルを書く際の注意点を説明します。

## ヘッドレスの考え方

ビルトインコンポーネント（`Toolbar` / `CalendarView` / `MonthView` / `TimeGridView` / `ListView`）はクラス名を一切生成しません。すべての要素は `data-koyomi="<部位名>"` という属性を持ち、状態は追加の data 属性（`data-today` / `data-outside` / `data-koyomi-dragging` など）で表されます。CSS はこの属性だけをセレクタにして書きます。

インラインの `style` は、位置決めに必須の数値（%・`calc()`）だけに限定されています。色・境界線・余白などの見た目は inline style に出力されません。唯一の例外は `event.color` を指定したイベント要素で、この場合のみ CSS 変数 `--koyomi-event-color` が inline で設定されます（テーマ側は `var(--koyomi-event-color, 既定色)` で参照します）。

クリック・キーボード操作が可能な要素（イベント・日番号・ツールバーのボタンなど）は、すべて `<button type="button">` として描画されます。

## デフォルトテーマの適用

そのまま使えるデフォルトテーマが同梱されています。エントリポイントで一度 CSS を読み込むだけで、`data-koyomi="root"` を持つ要素（`CalendarView` が描画するルート要素）配下に見た目が適用されます。

```ts
import '@koyomi-cal/react/theme.css';
```

デフォルトテーマは `[data-koyomi="root"]` 配下すべてに `box-sizing: border-box` を適用し、ボタンのブラウザ既定スタイル（余白・枠線など）をリセットしたうえで、各部位の見た目を組み立てます。フォーカス時のアウトライン（`:focus-visible`）やドラッグ中の半透明表示（`[data-koyomi-dragging="true"]`）もここに含まれます。

## CSS 変数一覧

デフォルトテーマは `[data-koyomi="root"]` スコープで以下の CSS 変数を定義しています。同じセレクタで上書きすれば、コンポーネントの構造やクラスに触れずに配色・寸法をカスタマイズできます。

| 変数 | 概要 | 既定値（ライト） |
| --- | --- | --- |
| `--koyomi-bg` | 背景色 | `#ffffff` |
| `--koyomi-fg` | 文字色 | `#1f1f1f` |
| `--koyomi-border` | 罫線色 | `#e0e0e0` |
| `--koyomi-muted` | 補助テキスト色（曜日ラベル・時刻ラベルなど） | `#70757a` |
| `--koyomi-accent` | アクセント色（選択中のビュー・今日の日付など） | `#1a73e8` |
| `--koyomi-today-bg` | 「今日」のセル背景色 | `#e8f0fe` |
| `--koyomi-event-color` | イベントの既定色。`event.color` を持つイベントは要素に inline で同名の変数が設定され、そちらが優先される | `#1a73e8` |
| `--koyomi-event-fg` | イベント本体の文字色 | `#ffffff` |
| `--koyomi-radius` | 角丸の半径（ボタン・イベント共通） | `4px` |
| `--koyomi-font-size` | 基準フォントサイズ | `13px` |
| `--koyomi-month-header-height` | 月セルの日番号行の高さ（イベント帯の上端オフセットにも使用） | `24px` |
| `--koyomi-lane-height` | 帯セグメント 1 レーンの高さ | `24px` |
| `--koyomi-hour-height` | 時間グリッド 1 時間分の高さ | `48px` |
| `--koyomi-time-axis-width` | 時間グリッドの時刻軸幅（ヘッダー・終日行・本体で揃えるための内部変数） | `56px` |

`--koyomi-month-header-height` / `--koyomi-lane-height` / `--koyomi-hour-height` はコンポーネント側の inline style（`calc()`）からも参照されるため、単なる見た目の変数ではなく実際のレイアウト寸法を決めます。値を変える場合は、対応する CSS（`min-height` など）も一緒に見直すことをおすすめします。

カスタマイズの例（配色の変更）:

```css
[data-koyomi="root"] {
  --koyomi-accent: #7c4dff;
  --koyomi-today-bg: #ede7f6;
  --koyomi-event-color: #7c4dff;
  --koyomi-radius: 8px;
  --koyomi-hour-height: 64px;
}
```

## ダークモード

デフォルトテーマは既定で `prefers-color-scheme: dark` に追従し、OS/ブラウザの設定に応じて自動的にダーク配色（`--koyomi-bg: #202124` など）に切り替わります。

明示的に切り替えたい場合は、`data-koyomi-theme="dark"` または `data-koyomi-theme="light"` を koyomi のルート要素、またはその祖先要素（例えば `<html>`）に付与します。これは `prefers-color-scheme` の設定に関わらず優先されます。

```html
<!-- ルート要素自身に付与する場合 -->
<div data-koyomi="root" data-koyomi-theme="dark">…</div>

<!-- 祖先要素（例: <html>）に付与する場合 -->
<html data-koyomi-theme="dark">
  <body>
    <div data-koyomi="root">…</div>
  </body>
</html>
```

```ts
// 例: ユーザーの選択に応じて <html> に data-koyomi-theme を付け外しする
document.documentElement.dataset.koyomiTheme = isDark ? 'dark' : 'light';
```

## data-koyomi 属性の一覧

ビルトインコンポーネントが出力する主な要素と `data-koyomi="<部位名>"` の対応です。カスタム CSS を書く際のセレクタ一覧として使えます。

### 共通・ツールバー

| 要素 | `data-koyomi` |
| --- | --- |
| ルート（`CalendarView`） | `root`（`data-koyomi-view="month\|week\|day\|list"` も付く） |
| ツールバー本体 | `toolbar` |
| ツールバーのナビゲーション（今日/前へ/次へ） | `toolbar-nav` |
| ツールバー内ボタン | `button`（`data-koyomi-action="today\|prev\|next\|view-month\|view-week\|view-day\|view-list"`） |
| 期間タイトル | `title` |
| ビュー切替グループ | `toolbar-views` |

### 月ビュー

| 要素 | `data-koyomi` |
| --- | --- |
| 月ビュー本体 | `month` |
| 曜日ヘッダー行 / 各ラベル | `month-weekdays` / `month-weekday` |
| 週の行 | `month-week` |
| 日セルの行 / 各日セル | `month-days` / `month-day`（`data-koyomi-date="YYYY-MM-DD"`） |
| 日番号ボタン | `month-day-number` |
| 「+N 件」ボタン | `month-overflow` |
| イベントセグメント層 / 各セグメント | `month-events` / `month-event` |
| 帯の左右端リサイズハンドル | `month-event-resize`（`data-edge="start\|end"`） |
| ドラッグ選択・プレビューの帯 | `day-selection` |

### 週/日ビュー（時間グリッド）

| 要素 | `data-koyomi` |
| --- | --- |
| 時間グリッド本体 | `timegrid`（`data-koyomi-days="7\|1"`） |
| 終日イベント行 / セル / イベント | `allday-row` / `allday-cell` / `allday-event` |
| 終日イベントの左右端リサイズハンドル | `allday-resize`（`data-edge="start\|end"`） |
| 日ヘッダー / 日番号ボタン | `timegrid-day-header`（`data-koyomi-date`）/ `timegrid-day-number` |
| 時刻軸ラベル | `time-slot-label` |
| 日列 | `timegrid-day`（`data-koyomi-date`） |
| 罫線 | `timegrid-slot` |
| 時間指定イベント / 内容 | `timegrid-event` / `timegrid-event-content` |
| 上下端リサイズハンドル | `timegrid-resize`（`data-edge="start\|end"`。`start` が上端 = 開始時刻） |
| ドラッグ・作成のプレビュー | `timegrid-preview`（`data-kind="create\|move\|resize"`） |
| 現在時刻線 | `now-indicator` |

### リストビュー

| 要素 | `data-koyomi` |
| --- | --- |
| リスト本体 | `list` |
| 日ごとのセクション / 見出し | `list-day`（`data-koyomi-date`）/ `list-day-header` |
| イベント行 / 時刻 / 色見本 / タイトル | `list-event` / `list-event-time` / `list-event-swatch` / `list-event-title` |
| 予定なしの表示 | `list-empty` |

### 状態を表す data 属性

構造上の `data-koyomi` に加えて、以下の状態属性が値なし（または `'true'`）で付与されます。

| 属性 | 意味 | 付与される要素 |
| --- | --- | --- |
| `data-today` | 今日である | `month-day` / `timegrid-day-header` / `timegrid-day` / `list-day` |
| `data-outside` | 表示中の月に属さない日（前後月の日付） | `month-day` |
| `data-koyomi-dragging` | ドラッグ移動・リサイズ中のイベント | `month-event` / `allday-event` / `timegrid-event` |
| `data-continues-before` | イベントの実際の開始がこの週・この日より前にある（「←続く」） | `month-event` / `allday-event` / `timegrid-event` |
| `data-continues-after` | イベントの実際の終了がこの週・この日より後にある（「続く→」） | `month-event` / `allday-event` / `timegrid-event` |
| `data-all-day` | 終日イベントのセグメント | `month-event` |
| `aria-pressed` | 選択中のビュー・トグル状態 | ツールバーのビュー切替ボタン |

各コンポーネントが実際に描画する DOM 構造をそのまま検証したい場合は、次のように `render` してから属性を確認できます。

```tsx
import { render } from '@testing-library/react';
import { CalendarProvider, CalendarView, useCalendar } from '@koyomi-cal/react';

function Demo() {
  const calendar = useCalendar({
    initialView: 'month',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00', color: '#e67c73' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}

const { container } = render(<Demo />);

const root = container.querySelector('[data-koyomi="root"]');
console.log(root?.getAttribute('data-koyomi-view')); // => 'month'

const eventEl = container.querySelector('[data-koyomi="month-event"]') as HTMLElement | null;
console.log(eventEl?.style.getPropertyValue('--koyomi-event-color')); // => '#e67c73'
```

## 自前スタイルをゼロから当てる場合の注意

デフォルトテーマを使わず、`data-koyomi-*` 属性だけを頼りに独自の CSS を組み立てる場合、次の点に注意してください。

- **`position: relative` が必要な要素**: イベントは絶対配置（`position: absolute`）の inline style（`left` / `width` / `top` など、すべて %）で位置決めされます。これらは最も近い `position: relative`（または他の配置コンテキスト）の祖先を基準に解決されるため、次の要素には必ず `position: relative` を当ててください。
  - `[data-koyomi="month-week"]`（月ビューの `month-events` 層の基準）
  - `[data-koyomi="allday-cells"]`（終日イベント行の基準）
  - `[data-koyomi="timegrid-day"]`（時間グリッド本体のイベント・目盛り・プレビュー・現在時刻線の基準）
- **inline の % は祖先の実寸に依存する**: 上記の基準要素には、% が正しく解決されるよう明示的な高さ（または `min-height`）が必要です。例えば `[data-koyomi="timegrid-day"]` の `top` / `height` は 1 日（1440 分）に対する割合なので、その要素の高さが 0 のままだとイベントは潰れて表示されます（デフォルトテーマでは `height: calc(24 * var(--koyomi-hour-height))` を設定しています）。同様に月ビューの `[data-koyomi="month-days"]` にも `dayMaxEvents` のレーン数を見込んだ `min-height` が必要です。
- **クラス名は生成されない**: セレクタは常に `[data-koyomi="..."]` 属性セレクタを使います。子孫の見た目（罫線・余白・フォントなど）はすべて自分で用意する必要があります（デフォルトテーマの `src/theme/default.css` を出発点にすると早く済みます）。
- **イベント色**: `event.color` を持つイベントには inline で `--koyomi-event-color` が設定されるだけなので、それを使うかどうか（`background-color: var(--koyomi-event-color, 既定色)` のように参照するか）は自前 CSS 側で決める必要があります。
- **タッチデバイスの `touch-action`**: ドラッグ起点となる要素（`month-day` / `month-event` / `allday-cell` / `allday-event` / `timegrid-day` / `timegrid-event` / 各リサイズハンドル）には `touch-action: none` が必要です。これがないとタッチ操作のドラッグがブラウザのスクロールに奪われます（デフォルトテーマでは設定済み）。
- **キーボードフォーカス**: 予定要素と日セルは `tabindex` によりフォーカス可能です。`:focus-visible` のアウトライン等、フォーカスリングのスタイルを必ず用意してください（デフォルトテーマでは設定済み）。
- **RTL（右書き言語）**: イベントの水平位置はデフォルトコンポーネントが `insetInlineStart`（論理プロパティ）で出力するため、`dir="rtl"` の文書では自動で反転します。自前 CSS でも `border-inline-start` などの論理プロパティを使うと RTL 対応が保たれます（デフォルトテーマは論理プロパティで記述されています）。

## renderEvent によるイベント内容のカスタマイズ

`MonthView` / `TimeGridView` / `ListView` は、それぞれ `renderEvent` prop でイベントの**内容**（ボタン内部の中身）だけをカスタマイズできます。ボタン要素自体（`data-koyomi-*` 属性、クリック・ドラッグの挙動）は変わりません。

- `MonthView`: `renderEvent?: (segment: EventSegment) => ReactNode`
- `TimeGridView`: `renderEvent?: (item: PositionedOccurrence) => ReactNode`（終日行のイベント内容はカスタマイズ対象外）
- `ListView`: `renderEvent?: (occurrence: EventOccurrence) => ReactNode`

イベント以外にも、日セルへのコンテンツの差し込み（`renderDayCell`）、日ヘッダー・日付見出し（`renderDayHeader`）、「+N 件」等の UI 文字列（`overflowLabel` / `allDayLabel` / `emptyLabel` / `Toolbar` の `labels`）を差し替えられます。一覧は [ビュー: ビューコンポーネントのカスタマイズ props](./views.md#ビューコンポーネントのカスタマイズ-props) を参照してください。

`CalendarView` を使う場合は、`renderMonthEvent` / `renderTimeGridEvent` / `renderListEvent` prop がそれぞれのビューへ転送されます。

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';

function MonthDemo() {
  const calendar = useCalendar({
    initialView: 'month',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* セグメントのタイトルの前に絵文字を付ける */}
      <MonthView renderEvent={(segment) => `★ ${segment.occurrence.event.title}`} />
    </CalendarProvider>
  );
}
```

```tsx
import { CalendarProvider, ListView, useCalendar } from '@koyomi-cal/react';

function ListDemo() {
  const calendar = useCalendar({
    initialView: 'list',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* タイトルを太字にする */}
      <ListView renderEvent={(occurrence) => <strong>{occurrence.event.title}</strong>} />
    </CalendarProvider>
  );
}
```

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';

function DayDemo() {
  const calendar = useCalendar({
    initialView: 'day',
    initialDate: new Date('2026-07-07T00:00:00Z'),
    now: () => new Date('2026-07-07T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      {/* 開始分（0:00 からの経過分）を添える */}
      <TimeGridView
        renderEvent={(item) => `${item.occurrence.event.title}（${item.startMinutes}分〜）`}
      />
    </CalendarProvider>
  );
}
```

`CalendarView` でビューを出し分けている場合は、3 つの render prop をまとめて渡せます。

```tsx
import { CalendarProvider, CalendarView, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({
    initialView: 'month',
    events: [{ id: '1', title: '定例会議', start: '2026-07-07T10:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView
        renderMonthEvent={(segment) => `月: ${segment.occurrence.event.title}`}
        renderTimeGridEvent={(item) => `週日: ${item.occurrence.event.title}`}
        renderListEvent={(occurrence) => `一覧: ${occurrence.event.title}`}
      />
    </CalendarProvider>
  );
}
```

## 関連ページ

- [ビュー（月・週・日・リスト）](./views.md)
- [予定の管理](./events.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [はじめに](./getting-started.md)
- [API リファレンス](./api.md)
