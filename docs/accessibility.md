# アクセシビリティ

Koyomi の各ビューが実装している WAI-ARIA パターン、キーボード操作、既知の制限をまとめます。ヘッドレスライブラリという性質上、色・フォーカスリング等の**視覚的な**アクセシビリティはテーマ CSS（利用側）の責務ですが、DOM 構造・ARIA 属性・キーボード操作はライブラリ本体が保証します。

## 全体方針

- 日付・リソースが**離散的な行/列として並ぶ部分**（月・年・複数月ビューのグリッド全体、週/日・リソースビューの日ヘッダー行と終日行、タイムラインビュー全体）には [WAI-ARIA grid パターン](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)（`role="grid"` / `row` / `columnheader` / `rowheader` / `gridcell`）を適用します
- 予定が**連続的な時間軸上に自由配置**される部分（週/日・リソースビューの本文、すなわち時間軸＋日/リソース列）は、離散セルへの対応付けが構造上できないため grid 化しません。理由の詳細は [ビューごとの ARIA パターン](#ビューごとの-aria-パターン) を参照してください
- 「今日」を表す要素には `aria-current="date"` を、全ビューで一貫して付与します（[今日・現在の状態表現](#今日現在の状態表現) 参照）
- キーボード操作は Tab/Shift+Tab による通常のフォーカス移動 + フォーカス中の予定・日セルでのショートカット（矢印キーでの移動・リサイズ、Enter/Space での確定・作成）です。APG の grid パターンが定める矢印キーでのセル間移動（roving tabindex）は実装していません（[既知の制限](#既知の制限) 参照）
- デフォルトテーマは `prefers-reduced-motion: reduce` に追従し、視差効果を減らす設定のユーザーには `transition` / `animation` を無効化します（詳細は [テーマとスタイリング: motion の削減](./theming.md#motion-の削減prefers-reduced-motion) 参照）

## ビューごとの ARIA パターン

### 月ビュー（MonthView）・複数月ビュー（MultiMonthView）

`role="grid"` の中に、曜日見出し行（`row` + `columnheader` × 7）と週の行（`rowgroup` の中に `row` × 4〜6、各 `row` の中に日セル `gridcell`）が入る、教科書どおりの grid パターンです。週ごとのレイアウト用ラッパー（`month-week`）は `rowgroup` と `row` の間に挟まるため `role="presentation"` で所有関係を透過させます。イベントの帯（セグメント）は複数日にまたがり得ますが、DOM 上は**開始日の日セル（`gridcell`）の子**として所有させます（週/日ビューの終日の帯と同じ方針。帯は `<button>` + 完全な `aria-label` で読み上げ可能で、視覚上の列スパンは positioned ancestor が `month-week` のため所有セルと無関係に絶対配置で実現されます）。複数月ビューは月ビューと同一の DOM 実装（`month-view-parts.tsx`）を共有するため、ARIA も完全に同一です。

### 年ビュー（YearView）

ミニ月グリッド 1 つずつが月ビューと同じ grid パターン（`grid` / `row` / `columnheader` / `gridcell`）を持ちます。年全体を覆う単一の grid ではなく、月ごとに独立した grid が 12 個並ぶ構成です（月と月の間に行/列の連続性がないため、これらを 1 つの grid にまとめる意味がありません）。

### 週/日ビュー（TimeGridView）・リソースビュー（ResourceView）

日ヘッダー行（TimeGridView）・リソース列見出し行（ResourceView）と、終日行はどちらも「1 日（またはリソース）= 1 セル」の離散的な構造なので、両者だけをまとめた専用のラッパー（`timegrid-grid` / `resource-grid`）の `role="grid"` の中で row/columnheader/gridcell を構成します。

- 複数タイムゾーンの軸（`timeAxisZones`）分だけ並ぶ左端の余白列（`timegrid-axis-gutter`）は、見出しでもデータでもない純粋な空きスペースなので `role="presentation"` にします
- 終日の帯（`allday-event`）は複数日/複数列にまたがり得ますが、DOM 上は**開始日の `allday-cell`（`gridcell`）の子**として所有させます（ResourceView の終日アイテムと同じ正当なネスト）。帯を `role="presentation"` のレイヤーに置く方式は、レイヤー自身の意味論しか消えず内部の focusable なボタンが grid の子孫として露出したままになるため採用しません。帯ボタンの positioned ancestor はセルではなく `allday-cells`（`position: relative`）なので、視覚上の列スパンはセルの所有関係と無関係に絶対配置で実現されます。範囲選択プレビュー（`day-selection`）も `allday-cells` 直下に置かれ、focusable を含まないため `aria-hidden` でアクセシビリティツリーから除外されます
- **本文（時間軸 + 日/リソース列）は grid 化しません。** 時間指定の予定は「その日/リソースの列内で、開始〜終了分に応じた % 位置に絶対配置される」ため、月ビューの日セルのような「1 つの離散セル」に対応付けられません。行に相当するもの（時刻）を刻み分（`slotMinutes`）ごとの実セルとして DOM 化することも理論上は可能ですが、既存の「列 1 つ = 1 つの `<div>`、予定はその中に絶対配置」という実装を丸ごと再構成する必要があり、ドラッグ操作の座標計算・既存テスト・パフォーマンスへの影響が大きいため見送りました。
  `role="grid"` の owned elements（実際に子孫として許される要素）は WAI-ARIA の grid パターン上 row / rowgroup に限られます。本文コンテナに `role="presentation"` を付けるだけでは、内部の `<button>`（予定・リサイズハンドル等）はそれ自身の役割を保ったままアクセシビリティツリーに残り、`role="presentation"` の要素は「素通しの層」としてツリーから除かれるため、結果として `<button>` が grid の直接の子孫であるかのように扱われてしまいます（row/rowgroup 以外の要素が grid の子孫になる、無効な構造）。これを避けるため、日ヘッダー行・終日行だけを専用のラッパー要素（`timegrid-grid` / `resource-grid`）にまとめてそこにだけ `role="grid"` を付け、本文（`timegrid-body` / `resource-body`）はこのラッパーの**外側**（兄弟要素）に置いています。本文コンテナ自体には role を付けません（そもそも grid の子孫ではないため、presentation で打ち消す必要がない）。内部の予定ボタン・日/リソースセルは role なし + 完全な `aria-label` で個別に読み上げられます

### リストビュー（ListView / VirtualListView）

行・列からなる表形式ではなく、日付ごとに独立した `<section>`（見出し + 予定ボタンの単純な縦並び）の一覧なので、grid パターンは適用しません。仮想化版（`VirtualListView`）は `role="list"` / `role="listitem"` の [ARIA list パターン](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) 相当の属性を持ちます（非仮想化の `ListView` は素の `<section>` の並びで、明示的な `role="list"` は付けません。文書の一部として自然にセクションの連なりが読み上げられるため）。

### タイムラインビュー（TimelineView）

行 = リソース、列 = 時間という構造ですが、週/日・リソースビューと異なり**列が「時間トラック 1 本」の 1 種類しかありません**（日ごとに区切られた離散列を持たない）。そのため各行は「行見出し（`rowheader`）+ 時間トラック（`gridcell`）」という固定 2 セルの単純な形になり、他ビューでは grid 化を見送った「連続時間軸の本文」も含めて `role="grid"` で完全に構成できます。

- ヘッダー行: `timeline-corner`（左上の空き、`role="presentation"`）+ `timeline-axis`（日ヘッダーと時刻目盛りをまとめた 1 つの `columnheader`）
- 各行: `timeline-resource-header`（`rowheader`）+ `timeline-row`（`gridcell`。中に複数の帯 `<button>` を含む。1 つのセルが複数の focusable な要素を持つこと自体は APG のグリッドパターンで許容されています）

## 今日・現在の状態表現

「今日」を表す要素には、ビューを問わず `aria-current="date"` を付けます。

| ビュー | 対象要素 |
| --- | --- |
| 月・複数月ビュー | 今日の日セル（`role="gridcell"` の `div`） |
| 週/日ビュー | 今日の日ヘッダー（`role="columnheader"` の `div`） |
| 年ビュー | 今日の日番号ボタン（`button[data-koyomi="year-day"]`） |
| リストビュー | 今日の日セクション（`section[data-koyomi="list-day"]`） |
| タイムラインビュー | 今日の日ヘッダー（`div[data-koyomi="timeline-day-header"]`） |
| リソースビュー | 付与しません（[既知の制限](#既知の制限) 参照） |

現在時刻そのもの（週/日・リソースビューの `now-indicator`、タイムラインビューの縦線）は装飾的な視覚要素なので `aria-hidden="true"` を付け、読み上げ対象から除外しています（時刻はイベントの `aria-label` 自体に含まれるため、別途読み上げる必要がありません）。

## キーボード操作

予定の作成・移動・リサイズ・削除に関するキーボード操作の詳細（フォーカス対象ごとのキー割り当て、`resolveRecurringScope` との連携、`editable: false` の扱いなど）は [インタラクション（作成・移動・リサイズ）](./interactions.md#キーボードのみでの予定操作) にまとめています。要点だけ抜粋すると次のとおりです。

- 予定要素・日セルはすべて `tabIndex={0}` で通常の Tab 順に含まれ、フォーカスは実装固有の roving tabindex ではなく**ブラウザ標準のフォーカス移動**に従います
- フォーカス中の予定に対する矢印キーは「画面上でその方向に動く」操作（移動・リサイズ）に割り当てられており、[インタラクション](./interactions.md#リソースビュータイムラインビューのドラッグ操作) にビューごとの対応表があります
- ビュー切替・日付移動などのグローバルなショートカットは `useCalendarShortcuts` が提供します（[インタラクション](./interactions.md#キーボードショートカット) 参照）

## 変更の読み上げ通知（useCalendarAnnouncer）

予定の移動・リサイズ・既定即時作成・削除、およびビュー・基準日・表示範囲の変更を `aria-live` リージョンで通知したい場合は `useCalendarAnnouncer` フックが使えます。`CalendarProvider` の `callbacks` をラップするヘルパーを返し、加えて `calendar` の状態変更を内部で購読する、opt-in のヘッドレスなフックです。

```tsx
import { CalendarProvider, CalendarView, useCalendar, useCalendarAnnouncer } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  const announcer = useCalendarAnnouncer({ calendar, announce: { viewChange: true } });

  return (
    <div>
      <div {...announcer.liveRegionProps}>{announcer.message}</div>
      <CalendarProvider value={calendar} callbacks={announcer.wrapCallbacks(myCallbacks)}>
        <CalendarView />
      </CalendarProvider>
    </div>
  );
}

// 期待される動作:
// - 予定をドラッグ移動すると announcer.message が「会議 を 7月16日 10:00〜11:00 に
//   移動しました」のような日本語文言に更新される
// - ビューを切り替えると（announce.viewChange: true のため）announcer.message が
//   「表示を2026年7月に切り替えました」のような文言に更新される
// - live region 要素（role="status" aria-live="polite"）はデフォルトテーマの sr-only
//   スタイルで視覚的には非表示になる
```

- **自動通知の対象** — `wrapCallbacks` でラップした `onEventChange`（移動・リサイズ・終日⇔時間指定変換）・`onEventDelete`（キーボード削除）・`onSelectRange` 未指定時の既定即時作成、いずれも確定後に通知します（`announce` オプションの `eventChange` / `eventCreate` / `eventDelete` で個別に無効化できます。既定はすべて `true`）。**カスタムの `onSelectRange`（ダイアログ等）を使う経路では、作成が確定したかどうかをアプリ側しか把握できないため自動通知しません**。作成確定時に `announcer.announce(text)` を手動で呼んでください
- **ビュー変更の通知** — `announce: { viewChange: true }` を指定すると、`calendar` への内部購読によってビュー・基準日・表示範囲の変更後（マウント後の変化のみ。初期マウント自体は通知しません）に自動で通知されます。他の 3 項目と異なり**既定は `false`**（opt-in）です。配線に `useCalendar` の `onRangeChange` は不要です（内部で `calendar.api.subscribe` を直接購読するため、`useCalendar` の `onRangeChange` 枠とは独立です）
- **`politeness`**（既定 `'polite'`）— `'assertive'` にすると `role="alert"` / `aria-live="assertive"` になります
- **通知文言** — `calendar` の `state.options.locale` から自動的に中央メッセージカタログ（`messages.announcer`）が解決されるため、`useCalendar` の `locale` を切り替えれば通知文言も追従します。`messages`（`MessageCatalogOverrides`）を渡すと `announcer` グループの文言を部分的に上書きできます（`CalendarProvider` の `messages` prop とは独立して解決されるため、揃えたい場合は同じ値を両方に渡してください）。カスタム関数は `eventChanged(change, verb, rangeLabel, resourceLabel)` のように、既に整形済みの日時範囲ラベル・リソース名・変更種別（`EventChangeVerb`）を直接受け取って全文を組み立てます。詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください
- 同一文言の連続通知（同じ予定を同じ内容で 2 回移動した場合等）でも、末尾に不可視トークンが交互に付くことでスクリーンリーダーが再読み上げできます
- live region 要素は `CalendarProvider` の配下に置く必要はありません（`calendar` 以外への依存を持たないため、DOM 上の配置に制約はありません）

undo/redo 操作自体の通知文言は `useCalendarAnnouncer` の対象外です（`announcer.announce` を [undo/redo 履歴マネージャ](./events.md#undo元に戻すを実装する)側から呼ぶことは可能です）。

## 既知の制限

- **矢印キーによる grid 内セル間移動（roving tabindex）は実装していません。** `role="grid"` は視覚的・論理的な構造を支援技術に伝えるためのものですが、Google カレンダー等のネイティブアプリのようにフォーカス中のセルから矢印キーで隣のセルへ移動する操作は提供していません（フォーカス移動は Tab 順のみ）。フォーカス中の予定要素に対する矢印キーは、セル移動ではなく「予定の移動・リサイズ」という異なる意味で割り当てられています
- **リソースビューの列見出し・列全体には `aria-current` を付けません。** リソースビューは常に 1 日固定で、列はリソースを表すため、月・週/日ビューのような「日付としての現在」を表す対象が列見出しには存在しません。「今日」であること自体は現在時刻線（`now-indicator`）と列の `data-today` 属性で表現します
- **リソースビューの終日セルはクリック専用で、キーボードでの直接作成には未対応です。** 週/日ビュー・月ビューの日セル（`allday-cell` / `month-day`）は `tabIndex={0}` + Enter/Space で終日予定を作成できますが、リソースビューの終日セル（`resource-allday-cell`）は現状クリックのみです
- **「+N 件」ポップオーバーは自前実装が前提です。** ヘッドレスの方針上、開閉状態の `aria-expanded` 等は `overflowButtonProps` で利用側が付与する必要があります。詳細は [インタラクション: 「+N 件」のポップオーバーを自前で組む](./interactions.md#n-件のポップオーバーを自前で組む) を参照してください
- **色だけに依存した情報伝達はありません。** イベントの色（`event.color` / `resource.color`）は視覚的な区別のためのみに使い、色分けの内容（タイトル・時刻・リソース名等）は常に `aria-label` のテキストとしても提供します
- **カスタム予定色のコントラストはテーマ側で確認してください。** `event.color` / `resource.color` は任意の CSS 色を受け付けるため、背景色と `--koyomi-event-fg` の組み合わせが WCAG AA（通常文字は 4.5:1 以上）を満たすように選んでください。デモの色パレットは白文字との組み合わせでこの基準を満たす濃色に限定しています

## 読み上げ文言のカスタマイズ

`aria-label`（例:「会議、7月16日 10:00〜11:00」）を含むすべての文言は `CalendarProvider` の中央メッセージカタログから組み立てられ、コンポーネントごとの `*AriaLabel` 系 props はありません。ロケールに応じて自動的に切り替わり、`messages` prop で部分的に上書きできます。

- **イベントボタンを持つ全ビュー**（`MonthView` / `MultiMonthView` / `TimeGridView`（終日行含む） / `ListView` / `VirtualListView` / `ResourceView` / `VirtualResourceView` / `TimelineView` / `VirtualTimelineView`）の aria-label は `messages.common.eventAriaLabel(occurrence, parts)` で組み立てられます（`parts.rangeLabel` は日時範囲ラベル、`parts.resourceLabel` はリソース名を含むビューのみ渡ります）
- **年ビュー（YearView）** は日セルの件数文言「予定N件」部分を `messages.year.dayCount(count)` で、aria-label 全体を `messages.year.dayAriaLabel(day, parts)`（`parts.dateLabel` と、`dayCount` の結果である `parts.countLabel`。予定が 0 件の日は `null`）で組み立てます
- **リストビュー（ListView / VirtualListView）** は日セクションの aria-label（例:「7月16日(木) 予定2件」）を `messages.list.dayAriaLabel(day, dateLabel)` で組み立てます。両ビューの既定 aria-label は同じ形式なので、仮想化の有無で読み上げが変わることはありません
- **`Toolbar`** はビュー切替ボタングループ（`toolbar-views`）の `aria-label` を `messages.toolbar.viewsGroup`（既定「表示切替」）で差し替えられます

カスタマイズ方法・自前ロケールの作り方の詳細は [テーマとスタイリング: 多言語対応（メッセージカタログ）](./theming.md#多言語対応メッセージカタログ) を参照してください。

## テスト

各ビューの `role` / `aria-label` / `aria-current` は `@testing-library/react` を使った結合テストで検証しています（`packages/react-calendar/src/react/components/*.test.tsx`）。DOM 構造・ARIA 属性の正式な仕様は内部設計書 [`docs/internal/components-dom.md`](./internal/components-dom.md) にビューごとの ASCII 図として記載しています。

## 関連ページ

- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [インタラクション（作成・移動・リサイズ）](./interactions.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
