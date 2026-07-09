# Koyomi 新ビュー（年・複数月・リソース・タイムライン）設計案 v4

> 既存 4 ビュー（月・週・日・リスト）に、年ビュー（`year`）・複数月ビュー（`multiMonth`）・
> リソースビュー（`resource`）・タイムラインビュー（`timeline`）の 4 ビューを追加する設計。
> v1→v4 で Codex レビュー全 4 ラウンドを反映し**「承認（実装着手可）」まで収束**
> （最終ラウンドは P1/P2/P3 すべてゼロ）。
> v1 → v2 で Codex レビュー第 1 ラウンド（P1×4・P2×6・P3×2）と実コード整合検証の指摘を反映:
> ⓐ ショートカット `T` の today 衝突を解消（timeline は `L`）
> ⓑ タイムラインの `hiddenWeekdays` 対応を撤回（比例スケールの歪み・可視日ゼロの破綻を根本回避）
> ⓒ 未割り当てレーンの生成規則と「未割り当てへ戻す D&D」の自己矛盾を `unassignedLane` オプションで解消
> ⓓ `EventChange` / `buildOverride` / `moveOccurrenceIn` に関する実コードとの食い違いを修正
> ⓔ union 拡張の型レベル互換性・空状態・警告の層配置（core は警告しない）を明文化
>
> v2 → v3 で Codex レビュー第 2 ラウンド（P1×0・P2×6・P3×2、旧指摘はすべて解消判定）を反映:
> ⓕ `CalendarState` / `CalendarApi` への必須メンバー追加を破壊的変更一覧へ移動（§2.6）
> ⓖ `useCalendarShortcuts` の既定を既存 4 ビューに変更（Toolbar の opt-in 方針と統一。§8.5）
> ⓗ `timeAtTimelineOffset` の排他端を用途別に分離（§7.4）
> ⓘ タイムラインの目盛りを別型 `TimelineSlot` に（既存 `TimeSlot` の意味と衝突するため。§7.4）
> ⓙ リソースビュー終日行の作成仕様を定義（§6.4）・リソース色の適用範囲を限定（§3.1）
>
> v3 → v4 で Codex レビュー第 3 ラウンド（P1×0・P2×1・P3×1、他はすべて解消判定）を反映:
> ⓚ `timeAtTimelineOffset` のクランプに `max` / `min` を明記し、`snap > totalMinutes` の
>   退行的設定でも範囲が逆転しないことを保証（§7.4）
> ⓛ §11 難所表の目盛り数式を §7.5 と同じ `ceil` 表記に統一

## 0. 目的とスコープ

| ビュー | `CalendarViewType` | 概要 | 相当する既存プロダクト |
| --- | --- | --- | --- |
| **年** | `'year'` | 12 ヶ月分のミニ月グリッド。予定は件数（密度）のみ表示し、日付ナビゲーションが主目的 | Google カレンダーの「年」 |
| **複数月** | `'multiMonth'` | 連続する N ヶ月（既定 3）の月グリッドを縦に並べる。予定は月ビュー同様の帯表示・D&D 可 | FullCalendar の multiMonth |
| **リソース** | `'resource'` | 1 日を対象に、列＝リソース（会議室・担当者等）×縦＝時間の時間グリッド。リソース間の予定移動可 | Google カレンダーの会議室日表示 / FullCalendar の resourceTimeGridDay |
| **タイムライン** | `'timeline'` | 横＝時間軸（1〜N 日）×行＝リソース。帯状の予定を横方向に配置 | FullCalendar の resourceTimeline |

リソース・タイムラインの前提として、ライブラリに**リソースモデル**（§3）を新規導入する。
リソース概念は現状のコードベースに一切存在しないため（`resourceId` の grep 結果ゼロ）、
`CalendarEvent` / `CalendarState` / `CalendarOptions` / コールバック型の拡張を伴う。

### 非対象（§14 も参照）

- 複数リソースへの同時割当（`resourceIds` 配列）・リソースの階層/グループ化
- リソース週ビュー（リソース×複数日のマトリクス）
- タイムラインの `hiddenWeekdays` 対応（§7.2）・横方向仮想化・ズームプリセット（月/年スケール）
- リソースの CRUD API（リソースは利用者所有のデータとして `setResources` で置き換えるのみ）

## 1. 設計原則

既存アーキテクチャの原則をそのまま踏襲する。新ビュー固有の原則はない。

1. **core は React を import しない**。ビューモデル構築は `src/core/views/` の純関数、
   レイアウト計算は `src/core/layout/` の純関数（Date/TZ 非依存の数値演算）に置く。
   **開発ビルド警告は React 層の責務**（`isDevBuild` は `src/react/` の非公開モジュール。
   core は警告せず、不正入力を決定論的に安全へ倒すだけにする）。
2. **タイムゾーン計算は `core/timezone.ts` / `core/date-utils.ts` 経由のみ**。
   「加算 → `startOfDayInZone` で再正規化」の防御パターン（DST・深夜 0:00 が存在しない
   ゾーン対策）を踏襲する。
3. **ヘッドレス**。ビューモデルは構造情報（列・レーン・0〜1 割合・分オフセット・真偽フラグ）
   のみを持ち、px・色・**ロケール依存の**整形文字列を含めない（既存 `TimeSlot.label` は
   ロケール非依存の固定 `HH:MM` 形式で、この原則の範囲内）。DOM は `data-koyomi-*` 属性のみを
   フックにスタイルされ、inline style は位置決めの数値に限定する。
4. **TDD**。core ビルダー → React フック → コンポーネントの順に、実装より先に失敗する
   テストを書く。
5. **網羅性チェックを配線の安全弁にする**。`CalendarViewType` への追加を起点に、
   default 節のない switch（`visibleRangeFor` / `navigateDate` / `buildViewModel` /
   `CalendarView` / `Toolbar.title`）がコンパイルエラーで改修箇所を列挙する設計を崩さない。
6. **既存ビューの DOM・props・挙動は不変**。新ビューは追加であって変更ではない。
   既存利用者の見た目が黙って変わる箇所（Toolbar のボタン列）は既定値維持で守る（§8.4）。
   型レベルの互換性への影響は §2.6 で明示的に扱う。
7. **操作キーは概念ではなく視覚軸に従う**。既存ビューの矢印キーは「画面上でその方向に
   動く」操作に割り当てられている（時間グリッドの ↑↓ = 縦の時間軸、月ビューの ←→ = 横の日）。
   新ビューでも同じ原則で割り当てる（§6.3・§7.5）。

## 2. 共通基盤の拡張

### 2.1 型の拡張（`core/types.ts`）

```ts
export type CalendarViewType =
  | 'month' | 'week' | 'day' | 'list'          // 既存
  | 'year' | 'multiMonth' | 'resource' | 'timeline'; // 追加

export type CalendarViewModel =
  | MonthViewModel | TimeGridViewModel | ListViewModel   // 既存
  | YearViewModel | MultiMonthViewModel                  // 追加（§4・§5）
  | ResourceViewModel | TimelineViewModel;               // 追加（§6・§7）
```

### 2.2 オプション（フラットに追加。既存スタイル準拠）

| オプション | 型 | 既定値 | 対象 |
| --- | --- | --- | --- |
| `multiMonthCount` | `number` | `3` | 複数月ビューの表示月数。`normalizePositiveInt(…, 1)` で正規化。上限は設けない（性能特性は §5.4）。`1` も許容するが、前後月の日付セルに予定を出さない点で月ビューの代替にはならない（§5.2） |
| `timelineDays` | `number` | `1` | タイムラインの表示日数。同上（DOM 量の考慮は §7.5） |
| `unassignedLane` | `'auto' \| 'always'` | `'auto'` | リソース/タイムラインの未割り当てレーンの生成規則（§3.3） |

- 型定義は `core/types.ts` の `CalendarOptions`（378 行）/ `ResolvedCalendarOptions`（435 行）、
  既定値と解決は `core/calendar.ts` の `DEFAULT_OPTIONS`（40 行）/ `resolveOptions`（81 行）/
  `resolvedOptionsEqual`（110 行）にそれぞれ追加する。
- `resources` は正確には「**`ResolvedCalendarOptions` には含めない、状態初期化用オプション**」
  （`events` と完全に同型の扱い）。§3.2 で定義する。
- `slotMinutes` / `snapMinutes` / `defaultEventMinutes` / `weekStartsOn` / `dayMaxEvents` は
  新ビューでもそのまま再利用し、新しい類似オプションは作らない。

### 2.3 表示範囲とナビゲーション（`core/date-utils.ts`）

| ビュー | `visibleRangeFor` | `navigateDate` |
| --- | --- | --- |
| `year` | `[年初 0:00, 翌年初 0:00)` | ±1 年（基準日は年初に正規化） |
| `multiMonth` | `[月初 0:00, multiMonthCount ヶ月後の月初 0:00)` | ±`multiMonthCount` ヶ月（月初に正規化） |
| `resource` | `[日の開始, 翌日の開始)`（`day` と同一） | ±1 日 |
| `timeline` | `[日の開始, timelineDays 日後の開始)` | ±`timelineDays` 日 |

- 年初の算出に `startOfYearInZone(date, timeZone): Date` を `date-utils.ts` に新設する
  （`getWallClock` → 月=1・日=1 → `fromWallClock` → `startOfDayInZone` 再正規化）。
  年の加算は既存 `addMonthsInZone(date, ±12, timeZone)` を再利用し、`addYearsInZone` は作らない。
- **年・複数月の範囲はグリッド範囲ではなく「月/年の本体」**である点が月ビュー
  （`monthGridRange` = 前後月の日付を含む）と異なる。理由: 両ビューとも前後月の日付セルには
  予定を表示しない（§4.2・§5.2）ため、範囲を広げる必要がなく、`getVisibleRange()` の
  「表示している範囲」という意味にも忠実になる。
- `visibleRangeFor` / `navigateDate` の `options` 引数に `multiMonthCount` / `timelineDays` を追加する
  （既存の `listDays` と同列）。

### 2.4 エンジン配線（`core/calendar.ts`）

`buildViewModel()` の switch に 4 case を追加し、各ビルダーへ委譲する。オカレンスは既存どおり
**表示範囲全体に対して `expandEvents` を 1 回だけ**呼んで渡す（セル単位・月単位で再展開しない。
`expandRecurrence` は呼び出しごとに RRule を再構築するため、分割呼び出しはコスト重複になる）。
リソース/タイムラインのビルダー内でも、オカレンス → レーンの振り分けは
`Map<string | null, EventOccurrence[]>` への **1 パスのバケット分け**で行い、
「レーンごとに全オカレンスをフィルタ」する O(リソース数 × オカレンス数) の走査はしない。

### 2.5 配線チェックリスト（実装時の更新対象）

型追加で機械的に発見される箇所に加え、網羅性チェックの効かない箇所を明記する:

1. `core/types.ts` — `CalendarViewType` / `CalendarViewModel` / 新 ViewModel 型 /
   `CalendarResource` / `CalendarEvent.resourceId` / `DragPreview.resourceId` /
   `CalendarOptions` / `ResolvedCalendarOptions` / `CalendarState.resources` / `CalendarApi`
2. `core/date-utils.ts` — `visibleRangeFor` / `navigateDate` / `startOfYearInZone`
3. `core/calendar.ts` — `buildViewModel` / `DEFAULT_OPTIONS` / `resolveOptions` /
   `resolvedOptionsEqual` / `resources` 状態と API
4. `core/mutations.ts` — `buildOverride` の継承フィールドに `resourceId` を追加（§3.4）
5. `core/interaction.ts` — `CalendarShortcut` / `shortcutForKey`（§8.5）/
   `timeAtTimelineOffset`（§7.4）
6. `core/views/` — `year-view.ts` / `multi-month-view.ts` / `resource-view.ts` /
   `timeline-view.ts`（新規）/ `month-view.ts`（`segmentRange` 追加。§5.2）
7. `core/layout/` — `interval-lane-layout.ts`（新規。§7.3）
8. `react/components/` — `year-view.tsx` / `multi-month-view.tsx` / `resource-view.tsx` /
   `timeline-view.tsx`（新規）/ `month-view-parts.tsx`（抽出。§5.3）/
   `calendar-view.tsx`（switch + props 転送）/ `toolbar.tsx`（§8.4）
9. `react/components/` の **memo 比較関数の点検** — `samePositionedOccurrence` /
   `sameTimeGridDay` 等は比較フィールドを手動列挙しており、`resourceId` の変更が
   カスタム `renderEvent` に反映されるよう `occurrence.event` の参照比較（または
   `resourceId` の追加）へ更新する（§3.4）
10. `react/` — `use-resource-grid-drag.ts` / `use-timeline-drag.ts`（新規）/
    `types.ts`（`RangeSelection` / `EventChange` 拡張。§3.4）/ `use-calendar.ts`
    （`resources` の参照変化警告。§3.2）/ `use-calendar-shortcuts.ts`
11. `src/index.ts` — 公開 API（§10）
12. `docs/` — `views.md`（「4 つのビュー」→ 8 つ）/ `api.md` / `interactions.md`
    （ショートカット表）/ `internal/components-dom.md`（新ビューの DOM 木）/
    `internal/terminology.md`（§13）
13. `theme/default.css` — 新 `data-koyomi-*` 属性へのデフォルトテーマ
14. `apps/demo` — 新ビューの動作確認 UI

### 2.6 互換性

- **型レベルの破壊的変更**（SemVer 上は破壊的変更として扱い、v0.x のマイナーバージョン
  アップ（0.x では慣例上破壊的変更を運べる）+ CHANGELOG での明示 + 移行手順を必須とする）:
  1. `CalendarViewType` / `CalendarViewModel` の union メンバー追加 — 利用者が default 節の
     ない網羅 switch を書いている場合（本ライブラリ自身が推奨するパターン）、コンパイル
     エラーを生む。移行は switch への case 追加のみ。ランタイム挙動・DOM は不変。
  2. `CalendarState.resources`（必須フィールド）と `CalendarApi.getResources` /
     `setResources`（必須メソッド）の追加 — これらのインターフェースを**実装・モック**
     している利用者コード（テストダブル等）はコンパイルエラーになる。読み取るだけの
     利用者には影響しない。移行はフィールド/メソッドの追加のみ。
- **非破壊の拡張**: `CalendarEvent.resourceId` / `RangeSelection.resourceId` /
  `EventChange.resourceId` / `DragPreview.resourceId` / `CalendarOptions` の新オプションは
  すべて省略可能フィールドの追加で、既存利用者コードを壊さない。
- **`ToolbarLabels` の新キーは省略可能**（既存キーもすべて省略可能であり、独自の i18n
  オブジェクトを渡している利用者はコンパイルエラーにならない）。
- Toolbar のボタン列・既存ショートカットキーの挙動は不変（§8.4・§8.5）。

## 3. リソースモデル

### 3.1 型（`core/types.ts` に新設）

```ts
/** カレンダーのリソース（会議室・設備・担当者など、予定の割当先）。 */
export interface CalendarResource {
  /** 一意な ID。 */
  id: string;
  /** 表示名。 */
  title: string;
  /** 表示色（CSS の color 値）。リソースに属する予定の既定色にもなる。 */
  color?: string;
  /** 利用者定義の任意データ。ライブラリは内容に関知しない。 */
  extendedProps?: Record<string, unknown>;
}
```

- **表示順は `resources` 配列の並び順**。`order` フィールドは設けない
  （配列がそのまま順序を表現でき、余計な正規化が不要）。
- **`color` の適用範囲はリソース/タイムラインビューに限定**する。両ビューの列/行見出しと、
  そのビュー内で `event.color` 未指定のイベント帯の既定色になる（イベント自身の `color` が
  常に優先）。**既存ビュー（月/週/日/リスト）の描画は不変**で、従来どおり
  `occurrence.event.color` のみを参照し続ける（原則 6。リソース色を全ビューへ反映する
  拡張は将来の別提案とする）。
- `CalendarEvent` に `resourceId?: string` を追加する。`color` / `location` と同じ
  フラットな省略可能フィールド（`extendedProps` のジェネリクス化を見送った既存哲学と整合。
  ライブラリが意味を理解すべき概念は正式フィールドにする）。
- 複数リソース割当（`resourceIds`）は非対象。オカレンスキー
  `` `${eventId}@${start}` `` が「1 オカレンス = 1 レーン」の一意性を保てる範囲に留める。

### 3.2 状態と API（`events` と同型の扱い）

```ts
export interface CalendarState {
  // 既存フィールドに加えて
  /** すべてのリソース（表示順）。 */
  resources: readonly CalendarResource[];
}

export interface CalendarApi {
  // 既存メソッドに加えて
  /** すべてのリソースを返す。 */
  getResources(): readonly CalendarResource[];
  /** リソース一覧を置き換える（外部ストアとの同期用）。 */
  setResources(resources: readonly CalendarResource[]): void;
}
```

- `events` と完全に同型: 初期値は `CalendarOptions.resources`（既定 `[]`）で
  **`ResolvedCalendarOptions` には含めない**。`updateOptions({ resources })` も `events` と
  同様に参照比較で受け付ける。変更は `commit(true)`（ビューモデルに影響する）。
- `useCalendar` は、マウント後に異なる `resources` 参照が渡された場合に開発ビルドで
  一度だけ警告する（既存の `events` 参照警告と同じ実装・同じ文言スタイル）。
- **ID 重複の扱い**: core は警告せず、ビルダーが**先勝ちで決定論的に**処理する
  （2 つ目以降の同 ID リソースはレーンを作らず、`resourceId` の解決は先頭のリソースに一致する）。
  開発ビルドの警告は React 層（`ResourceView` / `TimelineView` が `state.resources` を検査）で
  一度だけ出す（§1 原則 1: core は警告しない）。

### 3.3 未割り当てレーンと参照先のない resourceId

- `resourceId` を持たないイベントは、リソース・タイムラインビューでは
  **「未割り当て」レーン**（ビューモデル上は `resource: null`）に表示する。
- `resourceId` が `resources` に存在しない ID を指す場合（参照先のない resourceId）は、
  未割り当てレーンに合流させる。黙って非表示にしない（予定が消えたように見える事故を防ぐ）。
  開発ビルドの警告は React 層で一度だけ出す（コンポーネントが `state.events` の
  `resourceId` 集合と `state.resources` を突き合わせる。O(N) の 1 パス）。
- **生成規則（`unassignedLane` オプション）**:
  - `'auto'`（既定）— 対象範囲に該当オカレンスがある場合のみ末尾に生成する
    （空のレーンで画面を占有しない）。
  - `'always'` — 常に生成する。**「予定をリソースから外して未割り当てへ戻す」D&D を
    運用したい利用者はこちらを使う**。`'auto'` では未割り当てオカレンスが 1 件もないとき
    レーン（＝ドロップ先）が存在せず、この操作は実行できない。この制約は docs に明記する。
  - ドラッグ**中**にレーンが消えることはない: `setDragPreview` は `commit(false)` で
    ビューモデルを再構築しないため、レーン構成はドラッグ確定（`updateEvent`）まで安定している。
- 未割り当てレーンへの D&D 移動は、`CalendarEventPatch` の削除セマンティクス
  （キーが存在し値が `undefined` = フィールド削除）に従い `{ resourceId: undefined }`
  のパッチを発行する。
- **空状態**: `resources` が空かつ未割り当てレーンも生成されない場合、`columns` / `rows` は
  空配列になり、ビューモデルの `isEmpty` が `true` になる（`ListViewModel.isEmpty` の前例に従う）。
  React 側は空状態メッセージ（`emptyLabel`、既定「リソースがありません」）を表示する。
  この状態ではドロップ先レーンが存在しないため D&D 作成もできない。回避したい利用者は
  `resources` を与えるか `unassignedLane: 'always'` を指定する（docs に明記）。

### 3.4 変更操作とコールバック

- `resourceId` の変更は既存 `updateEvent(id, patch, target?)` で完結する。
  `applyPatch`（`mutations.ts:108`）はキー汎用のマージ/削除を行い、
  `CalendarEventPatch` は `CalendarEvent` からの Mapped Type（`types.ts:176`）なので
  型も自動で追随する。繰り返し予定のリソース移動も既存の `RecurringEditScope`
  （this / thisAndFollowing / all）がそのまま機能する。
- ただし **`buildOverride`（`mutations.ts:303`）の継承フィールドに `resourceId` を追加する**。
  「この予定のみ変更」のオーバーライドはマスターの表示系フィールド
  （`color` / `location` 等）を明示的にコピーしており、追加しないと時間だけを変更した
  オカレンスが未割り当て化する。`splitSeries`（thisAndFollowing）は `{ ...master }`
  スプレッドで継承するため無改修でよい。mutations.ts の変更はこの 1 箇所。
- **確定時の適用経路**: 既存の D&D フックは `moveOccurrenceIn` を使わず、自前でパッチを
  組み立てて `calendar.api.updateEvent` を直接呼んでいる（`use-time-grid-drag.ts:519` の
  `applyOccurrenceRange` 等）。新フックも同じ流儀で、時間の変更と `resourceId` の変更を
  **1 つのパッチに合成して 1 回の `updateEvent`** にする（`moveOccurrenceIn` は経由しない。
  同関数は公開 API として現状維持し、リソース対応の拡張はしない）。
- `react/types.ts` のコールバック型は**省略可能フィールドの追加**で後方互換に拡張する:

```ts
export interface RangeSelection {
  range: DateRange;
  allDay: boolean;
  /** 選択が行われたレーンのリソース ID。リソース/タイムラインビューでのみ設定される。
      `null` は未割り当てレーンを表す。 */
  resourceId?: string | null;
}

export interface EventChange {
  occurrence: EventOccurrence;
  newRange: DateRange;
  allDay: boolean;
  scope: RecurringEditScope | null;
  /** 変更後の割当先リソース ID。リソース/タイムラインビューでの変更時のみ設定される。
      `null` は未割り当てを表す。 */
  resourceId?: string | null;
}
```

  （現行 `EventChange` は `occurrence` / `newRange` / `allDay` / `scope` のみで
  パッチを持たないため、リソース移動を通知するにはこの拡張が必須。）
- **既定作成（`onSelectRange` 未指定時の即時作成）**: リソース/タイムラインの新フックは
  既定作成でも選択レーンの `resourceId` を `createEvent` の入力に含める
  （未割り当てレーンでは `resourceId` を付けない）。これを設計しないと、リソース列で
  作成した予定が未割り当てになる。
- `DragPreview`（`core/types.ts`）に `resourceId?: string | null` を追加する
  （リソース/タイムラインでのプレビュー描画先レーンの特定用。既存ビューでは常に省略）。
- **memo 比較関数の点検**（§2.5 項目 9）: `resourceId` の変更で `occurrence.event` は
  新しいオブジェクトになるが、`samePositionedOccurrence` 等の手動フィールド列挙比較が
  それを「同じ」と判定するとカスタム `renderEvent` が再描画されない。比較関数に
  `occurrence.event` の参照比較を加える（実装時に既存比較関数を全数点検する）。

## 4. 年ビュー（`year`）

### 4.1 位置づけ

**日付ナビゲーションと予定密度の俯瞰**が目的。予定の帯・タイトルは表示せず、D&D もない。
日セルのクリックで該当日へ移動する（月ビューの日番号ボタンと同じ `goTo` + `setView('day')`）。

### 4.2 ビューモデル（`core/views/year-view.ts`）

```ts
/** 年ビューのミニ月グリッドの 1 日分。 */
export interface YearDay {
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示タイムゾーンにおける `'YYYY-MM-DD'` 形式のキー。 */
  key: string;
  /** 表示中の月に属する日かどうか（前後月の日付は `false`）。 */
  inCurrentMonth: boolean;
  /** 今日かどうか（表示タイムゾーン基準）。 */
  isToday: boolean;
  /** その日に発生する予定の件数（前後月の日付は常に 0）。 */
  eventCount: number;
}

/** 年ビューの 1 ヶ月分。 */
export interface YearMonth {
  /** 月初の絶対時刻（表示タイムゾーンベース）。 */
  anchor: Date;
  /** `'YYYY-MM'` 形式のキー。 */
  key: string;
  /** 週の配列（4〜6 週、各週は 7 日）。 */
  weeks: readonly (readonly YearDay[])[];
}

/** 年ビューのビューモデル。 */
export interface YearViewModel {
  type: 'year';
  /** 表示対象年の 1 月 1 日（表示タイムゾーンベース）。 */
  anchor: Date;
  /** 12 ヶ月分。 */
  months: readonly YearMonth[];
  /** 曜日ヘッダー（週開始曜日の設定順）。全ミニ月グリッド共通。 */
  weekdays: readonly Weekday[];
}
```

ビルダー: `buildYearViewModel(params: { currentDate, timeZone, occurrences, weekStartsOn, now }): YearViewModel`

- `eventCount` の集計規則:
  1. 各オカレンスの日スパンを **`[年初, 翌年初)` にクランプ**してから日付キーで
     1 パスのバケット集計する。`expandEvents` は範囲と重なるオカレンスを**実際の開始/終了の
     まま**返すため（`expansion.ts:219` の `rangesOverlap` 判定）、年境界をまたぐ複数日
     オカレンス（例: 12/30〜1/3）はクランプしないと範囲外の日に加算されてしまう。
  2. 複数日にまたがるオカレンスは、クランプ後に覆う各日にカウントする
     （月ビューで帯が各日に現れるのと同じ考え方）。
  3. 長さ 0（`start === end`）のオカレンスは開始日にカウントする（リストビューの
     特別扱いと同じ）。
  4. **`inCurrentMonth: false` のセルは集計結果に関わらず `eventCount: 0` に固定する**
     （1 のクランプにより年内の日はすべて正確、年外の日はデータ不足で正確に出せないため、
     見せない）。React 側も `data-outside` セルには件数マーカーを描画しない。
- **`hiddenWeekdays` は無視する**（ミニ月グリッドは常に 7 列）。日ビューが
  `hiddenWeekdays` を無視する先例（`time-grid-view.ts:411`）に倣った意図的な非対称。
  年ビューは予定表示ではなく日付ナビゲーションが主目的で、曜日を欠いたミニカレンダーは
  日付の読み取りをかえって阻害する。
- `dayMaxEvents` は使わない（帯を表示しないため）。

### 4.3 React（`react/components/year-view.tsx`）

- ルート `data-koyomi="year"`。月ごとに `data-koyomi="year-month"`（見出し + ミニグリッド）。
  日セルは `<button type="button" data-koyomi="year-day">`、`data-today` / `data-outside` /
  `data-has-events`（`eventCount > 0`）を付与。件数は `data-koyomi="year-day-count"` の
  マーカー要素（既定テーマではドット表示。数値表示にしたい利用者は `renderDayCell` で差し替え）。
- a11y: 月ビューと同じ div ベースの ARIA grid パターン（ミニ月単位で `role="grid"`、
  `month-view.tsx:353-479` の前例）。日セルの `aria-label` は「7月10日 予定3件」形式
  （Intl キャッシュは既存の `format.ts` パターン）。今日に `aria-current="date"`。
- カスタム描画 props（ローカル名は無接頭辞。§8.1 の転送規則）:
  `renderMonthHeader?(month, defaultContent)` / `renderDayCell?(day, defaultContent)`。

### 4.4 性能

1 年分の `expandEvents` 1 回 + オカレンス数 O(N) のバケット集計のみ。帯レイアウトが不要なため
月ビュー 12 回分より軽い。週次繰り返し 1 件 ≒ 52 オカレンス程度で、数百イベントでも実用域。
懸念が出た場合の緩和策（件数集計の opt-out）は実測後の別提案とする。

## 5. 複数月ビュー（`multiMonth`）

### 5.1 位置づけ

月ビューの N ヶ月連結。予定は帯（セグメント）表示・「+N 件」あふれ・D&D（作成/移動/リサイズ）
すべて月ビューと同等。四半期・半期のプランニング用途。

### 5.2 ビューモデル（`core/views/multi-month-view.ts`）

```ts
/** 複数月ビューの 1 ヶ月分。 */
export interface MultiMonthMonth {
  /** 月初の絶対時刻（表示タイムゾーンベース）。 */
  anchor: Date;
  /** `'YYYY-MM'` 形式のキー。 */
  key: string;
  /** 週の配列（4〜6 週）。 */
  weeks: readonly MonthWeek[];
}

/** 複数月ビューのビューモデル。 */
export interface MultiMonthViewModel {
  type: 'multiMonth';
  /** 先頭月の 1 日（表示タイムゾーンベース）。 */
  anchor: Date;
  /** `multiMonthCount` ヶ月分（表示順）。 */
  months: readonly MultiMonthMonth[];
  /** 曜日ヘッダー（全月共通）。 */
  weekdays: readonly Weekday[];
}
```

ビルダー: `buildMultiMonthViewModel(params: { currentDate, timeZone, occurrences, weekStartsOn, dayMaxEvents, hiddenWeekdays, multiMonthCount, now }): MultiMonthViewModel`

- 内部で月ごとに `buildMonthViewModel` を呼び、結果の `weeks` を束ねる
  （帯レイアウト・`hiddenWeekdays` の可視列変換・あふれ計算の実装を重複させない）。
  渡すオカレンスは月ごとにフィルタせず全量を渡してよい（月ビルダーはグリッド範囲外を
  自然に除外する）。
- **前後月の日付セルには予定を表示しない**（セルは日番号のみの `data-outside` 表示）。
  隣接する月グリッド間で同じ日付が二重に描画される問題（例: 7/31 が 7 月グリッドの本体と
  8 月グリッドの前月はみ出しの両方に現れる）を、「予定は自分の月のグリッドにのみ描画する」
  規則で解消する。月境界をまたぐ帯は月ごとにクランプされ、`continuesBefore/After` で
  「←続く / 続く→」を表示する。
- 実現手段: `buildMonthViewModel` の `params` に省略可能な `segmentRange?: DateRange` を追加する。
  現行実装のクランプは「グリッド全域でのスパン生成」（`month-view.ts:142-161`）と
  「週境界でのクランプ + `continuesBefore/After` 判定」（同 177-213）の 2 段であり、
  `segmentRange` は**第 3 の境界**としてスパン生成段に組み込む:
  スパンの日付キー範囲を `segmentRange` と交差させ、交差が空ならセグメントを生成しない
  （あふれにも数えない）。`continuesBefore/After` は「実際の日スパンが `segmentRange` の
  外へ続くか」も OR 条件に加える（週境界判定はそのまま）。
  **既定（`segmentRange` 省略）はこの追加処理を一切通らず、既存の月ビューの挙動・DOM は
  不変**（既存 `month-view.test.ts` 全件 + DOM 不変のリグレッションテストで保証する。§12）。
- `hiddenWeekdays` は月ビューと同じ規則で適用する。`dayMaxEvents` も共通。

### 5.3 React（`react/components/multi-month-view.tsx`）

- ルート `data-koyomi="multimonth"`（属性値は小文字連結。既存の `timegrid-day` 等の流儀）。
  月ごとに `data-koyomi="multimonth-month"`（見出し `multimonth-title` + 月グリッド）。
  月グリッド内部の DOM は月ビューと同一構造（週行・日セル・帯）。
- 実装は月ビューの週行レンダラを共有する。`ListView` / `VirtualListView` の
  `list-view-parts.tsx` と同じ手法で、月ビューの週行・帯・日セル描画を非公開の
  `month-view-parts.tsx` に切り出し、`MonthView` と `MultiMonthView` の両方がそれを使う
  （月ビューの DOM は byte-identical に保つ。抽出リファクタは挙動不変の独立 PR にする）。
- **共有 parts の「前後月セルの登録可否」分岐**: 現行 `MonthView` は前後月セルも含めて
  無条件に `getDayCellProps` を呼んでおり（`month-view.tsx:433`）、前後月セルも
  インタラクティブである。この挙動は単体 `MonthView` では**維持**しなければならない
  （原則 6）。そこで共有 parts に `interactiveOutsideDays: boolean` 相当のパラメータを
  設け、`MonthView` は `true`（従来どおり）、`MultiMonthView` は `false`
  （前後月セルには `getDayCellProps` を呼ばず、tabIndex・ハンドラ・`data-koyomi-date` を
  付与しない）を渡す。
- **D&D は `useDayDrag` を再利用**する。設計上の明示事項:
  - **フックインスタンスは `MultiMonthView` 全体で 1 つ**。全月の日セルが単一の
    セルレジストリ（`Map<dateKey, …>`）に登録される。前後月セルを登録しないため、
    日付キーは全グリッド横断で一意になり衝突しない。単一レジストリなので
    月境界をまたぐドラッグ（7/31 → 8/2 等）のヒットテストもそのまま解決できる。
  - 月をまたぐ移動・リサイズのプレビュー範囲は `dayDragPreviewRange` が日付キー基準で
    月に依存しないためそのまま動く。プレビュー帯は各月の週行に既存のオーバーレイ機構で
    描画され、各月の `segmentRange` 相当（月本体）でクランプされる。
  - **React key の一意化**: 月境界をまたぐ帯は隣接する 2 つの月グリッドにそれぞれ
    セグメントとして現れる（どちらも同じ `occurrence.key`）。週行・セグメントの描画キーは
    月キーで修飾して全域一意にする（例: `` `${month.key}:${weekIndex}` `` +
    セグメントは週内で `occurrence.key` 一意）。D&D の操作対象の識別は従来どおり
    オカレンス単位（どのセグメントを掴んでも同じ `occurrenceKey` への操作になる。
    月ビューの複数週セグメントと同じ既存セマンティクス）。
- a11y・キーボード操作は月ビューと同一（矢印 = 日移動、Shift+矢印 = リサイズ、
  Delete = 削除、Enter/Space = クリック相当）。

### 5.4 性能

構築コストは月ビューのほぼ N 倍（月ごとの帯レイアウト + 全オカレンスのスパン生成が
月数分）。`multiMonthCount` に上限は設けないが、想定上限は 12（年間プランナー用途）で、
それを超える指定は表示密度としても実用性が乏しい。12 ヶ月時のコストは
「年ビューより重く、月ビュー 12 回分と同等」であり、`viewModelCache`（ビュー 1 個分の
スナップショットキャッシュ）により再レンダーごとの再計算は発生しない。実測で問題になる
場合の月単位メモ化は別提案とする。

## 6. リソースビュー（`resource`）

### 6.1 位置づけ

**1 日の時間グリッドを「列 = リソース」で描く**。週/日ビューの「列 = 日」を
「列 = リソース」に置き換えたもの。表示日は 1 日固定（リソース×複数日は非対象）。
`hiddenWeekdays` は日ビューと同じく無視する。

### 6.2 ビューモデル（`core/views/resource-view.ts`）

```ts
/** リソースビューの 1 列分（1 リソース）。 */
export interface ResourceColumn {
  /** 対応するリソース。未割り当てレーンは `null`。 */
  resource: CalendarResource | null;
  /** 列を一意に識別するキー。 */
  key: string;
  /** この列に配置された時間指定イベント（週/日ビューと同じ配置計算）。 */
  items: readonly PositionedOccurrence[];
  /** この列の終日イベント（開始順。レーン = 配列順に縦積み）。 */
  allDayItems: readonly EventOccurrence[];
}

/** リソースビューのビューモデル。 */
export interface ResourceViewModel {
  type: 'resource';
  /** 表示日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示日の `'YYYY-MM-DD'` キー。 */
  dateKey: string;
  /** 今日かどうか。 */
  isToday: boolean;
  /** リソース列（`resources` の並び順。§3.3 の規則で末尾に未割り当て列）。 */
  columns: readonly ResourceColumn[];
  /** 列が 1 つもないか（§3.3 の空状態）。 */
  isEmpty: boolean;
  /** 時間軸の目盛り（`slotMinutes` 間隔。週/日ビューと同じ `TimeSlot`）。 */
  slots: readonly TimeSlot[];
  /** 現在時刻線の位置（その日の 0:00 からの分）。表示日が今日でなければ `null`。 */
  nowIndicatorMinutes: number | null;
}
```

ビルダー: `buildResourceViewModel(params: { currentDate, timeZone, occurrences, resources, unassignedLane, slotMinutes, now }): ResourceViewModel`

- 列キー: リソース列は `` `r:${resource.id}` ``、未割り当て列は `'unassigned'` とする。
  素の `resource.id` を key に流用しない（`'unassigned'` という ID のリソースとの衝突回避）。
- オカレンスの振り分け: `Map<string | null, EventOccurrence[]>` への 1 パスのバケット分け
  （§2.4）。`event.resourceId` → 該当列（重複 ID は先勝ち。§3.2）、`undefined` または
  参照先のない ID → 未割り当て列（§3.3）。
- 時間指定イベントは**列ごとに** `layoutTimeGridItems` を実行する（週/日ビューの
  「日ごとに実行」と同型。`buildDayItems`（`time-grid-view.ts:241`）の日内クランプ・
  `continuesBefore/After`・長さ 0 の特別扱いのロジックを共有ヘルパに切り出して再利用する）。
- 終日イベント: 列 = 1 日なので帯の水平スパンが常に 1。`layoutBandItems` は不要で、
  既存の並び順規約（開始昇順 → 長い順 → key 辞書順）でソートした配列を縦積みする。
- 日をまたぐオカレンス（前日 23:00〜当日 2:00 等）は週/日ビューと同じクランプ規則で
  表示日分だけを描画する。

### 6.3 React（`react/components/resource-view.tsx`）

- ルート `data-koyomi="resource"`。構造は `TimeGridView` に準じる:
  リソースヘッダー行（`data-koyomi="resource-header"` の列見出し、`data-koyomi-resource-id`
  属性付き）、終日行、時間軸 + リソース列（`data-koyomi="resource-column"`）。
  イベントブロック・リサイズハンドル・現在時刻線・プレビューは時間グリッドと同じ部位名を使う。
- リソースの `color` は列見出しとイベント既定色に CSS 変数（`--koyomi-event-color` の既存機構）で反映する。
  イベント自身の `color` が優先。
- a11y: **時間グリッドの現状に合わせる**。現行 `time-grid-view.tsx` は grid 系 role を
  持たない（`role=` 該当ゼロ。ARIA grid を持つのは月ビューのみ）ため、リソースビューも
  role なし + 操作要素は `<button>` + 完全な `aria-label`（日時 + リソース名）+
  `aria-current="date"` の構成とする。週/日・リソース/タイムラインをまとめた ARIA grid 化は
  既存ビューの改修を伴うため別提案（§14）。
- キーボード: ↑↓ = `snapMinutes` 分の移動、Shift+↑↓ = リサイズ（時間グリッドと同じ）、
  **←→ = 隣のリソース列への移動**。原則 7（キーは視覚軸に従う）による割当で、
  時間グリッドの ←→（隣の日列）と同じ「横 = 隣の列」の操作感になる。
- カスタム描画 props（ローカル名は無接頭辞。§8.1）: `renderEvent` /
  `renderColumnHeader?(column, defaultContent)` / `unassignedLabel?: ReactNode`
  （既定「未割り当て」）/ `emptyLabel?: ReactNode`（既定「リソースがありません」）。

### 6.4 D&D（`react/use-resource-grid-drag.ts`・新規フック）

`useTimeGridDrag` と同じプロップゲッター構成（`getColumnProps` / `getEventProps` /
`getResizeHandleProps` / `previewFor(column)` / `isDragging`）で新設する。既存フックの
列レジストリは `Map<dateKey, …>` で「1 日 = 1 列」前提のため流用せず、
**列レジストリを `Map<columnKey, { element, resourceId: string | null }>`** で持つ。

- 縦方向（時間）: 既存の core 純関数をそのまま使う（`fractionY` → `timeAtGridPosition` →
  `dragPreviewRange`。日は表示日固定なので `snapMinutes` 処理含め既存と同一）。
- 横方向（リソース）: ポインタの X 座標から列を特定し（既存 `findColumnForClientX` と
  同型のリソース版）、`DragPreview.resourceId` に反映する。
- 操作と確定時のパッチ:
  - **作成**: 開始列のリソースに固定し、縦ドラッグで時間範囲を選択。確定時
    `onSelectRange({ range, allDay: false, resourceId })`。**既定作成（コールバック未指定）でも
    `resourceId` を `createEvent` の入力に含める**（§3.4）。
  - **移動**: 縦 = 時間、横 = リソースの同時変更。確定時は時間と `resourceId` を
    1 つのパッチに合成した 1 回の `updateEvent`（§3.4。未割り当てへは
    `{ resourceId: undefined }`）。`onEventChange` には `resourceId` 付きの
    `EventChange` を渡す。リソースだけ変わって時間が変わらない場合も同経路。
  - **リサイズ**: 時間のみ（リソース不変）。既存と同一。
  - 繰り返し予定は既存の `resolveRecurringScope` フローに乗せる（リソース移動も
    this / thisAndFollowing / all の選択対象）。
- 終日行: **作成**と**列間移動**を提供する。作成は終日行のセル（列）のクリック/タップで
  当日 1 日の終日イベントを作る（`onSelectRange({ range: その日 1 日, allDay: true,
  resourceId })`。既定作成も選択列の `resourceId` を含める。表示日が 1 日のため複数日への
  ドラッグ拡張は存在しない）。移動は列間のリソース変更のみ（`{ resourceId }` パッチ）。
  終日イベントのリサイズは提供しない（1 日固定のため）。
  allDay⇔時間指定の越境変換（週/日ビューの機能）は**リソースビューでは提供しない**
  （両領域とも同じ日で、変換の操作意図が曖昧になるため。仕様として明記）。
- Escape / pointercancel でキャンセル、`suppressNextClickRef` のクリック抑制、
  `onError ?? console.error` のエラー報告ヘルパなど既存フックの定石を踏襲する。

### 6.5 スケール

列数はリソース数 + 1（未割り当て）に比例する。多数リソース時は横スクロール
（テーマ CSS の責務。ヘッドレスなので幅はライブラリが所有しない）。実用想定は数十列で、
列方向の仮想化は非目標（§14。タイムラインの行方向と同じ再検討トリガーに含める）。

## 7. タイムラインビュー（`timeline`）

### 7.1 位置づけ

**横 = 時間、行 = リソース**の帯表示。`timelineDays`（既定 1）日分を横に連結する。
横スクロールで時間を移動する。`resources` が空でも、未割り当てレーンが生成されれば
単一行のタイムラインとして使える（未割り当てオカレンスも無い場合は空状態。§3.3）。

### 7.2 座標系: 「表示分」

横位置は **表示分（display minutes）** = `日インデックス × 1440 + その日の 0:00 からの分`
で表現する。DST の 23/25 時間日も視覚上は等幅 1440 分として扱う（週/日ビューが全日を
1440 分の縦トラックで描く既存規約と同じ。`minutesOfDayInZone` は現地時刻ベースの
0〜1439 を返すため、この規約と整合する）。

- **`hiddenWeekdays` は無視する**（表示日は常に `timelineDays` 日の連続並び）。
  比例幅を持つ分スケールから日を抜くと、非表示日をまたぐ予定の帯の長さが実時間から
  大きく乖離し（例: 金 22:00〜月 2:00 の予定が見かけ 4 時間になる）、非表示日の内部で
  終わる予定の `continuesAfter` の意味も破綻する。日単位の一様セルである月ビューの
  可視列規則はここには持ち込めない。対応するなら不連続マーカー付きの別提案とする（§14）。
  この規則により表示日リストが空になることはなく（`timelineDays >= 1`）、
  `totalMinutes > 0` が常に成り立つ。
- 表示範囲外へ続くオカレンスは表示分にクランプし、`continuesBefore/After` を立てる。

### 7.3 レーン割当（`core/layout/interval-lane-layout.ts`・新規）

行内で時間が重なる帯を縦のレーンに積む。`layoutBandItems` は整数列インデックスと
`columnCount` 長の `overflowByCol` 配列が前提で、分単位の連続量には不向きのため、
区間ベースの姉妹関数を新設する:

```ts
/** 区間レーン割当への入力アイテム。 */
export interface IntervalLaneInput {
  /** アイテムの識別キー。 */
  key: string;
  /** 区間の開始（単調な数値。タイムラインでは表示分）。 */
  start: number;
  /** 区間の終了（排他）。`start < end` であること。 */
  end: number;
}

/** 区間レーン割当の結果。 */
export interface IntervalLaneResult {
  /** 各アイテムのレーン番号（入力と同数・同順）。 */
  placements: readonly { key: string; lane: number }[];
  /** 使用レーン数。 */
  laneCount: number;
}

export function layoutIntervalLanes(items: readonly IntervalLaneInput[]): IntervalLaneResult;
```

- ソート規則は既存と同一（開始昇順 → 長さ降順 → key 辞書順）。貪欲に最小レーンへ詰める。
- 「入力配列と同数・同順の結果」の既存規約を維持する。
- `maxLanes` / あふれ集約は v1 では持たない（行の高さは `laneCount` に応じて伸びる。
  ヘッドレスなので高さの実際の決定は利用者/テーマ CSS）。必要になったら
  `layoutBandItems` と同じ `hidden` + あふれ数の形で拡張する。
- Date/TZ 非依存の純数値演算のみ。テストも TZ 非依存で書ける。

### 7.4 ビューモデル（`core/views/timeline-view.ts`）

```ts
/** タイムラインの時間軸の目盛り 1 つ分。 */
export interface TimelineSlot {
  /** 表示分（範囲先頭からの分。§7.2 の座標系）。 */
  minutes: number;
  /** 属する表示日の `'YYYY-MM-DD'` キー。 */
  dayKey: string;
  /** 表示ラベル（日内の時刻。例: `'09:00'`）。 */
  label: string;
}

/** タイムラインに配置された帯。 */
export interface TimelineItem {
  /** 対応するオカレンス。 */
  occurrence: EventOccurrence;
  /** 表示開始（表示分。範囲外から続く場合はクランプ済み）。 */
  startMinutes: number;
  /** 表示終了（表示分、排他。範囲外へ続く場合はクランプ済み）。 */
  endMinutes: number;
  /** 縦方向のレーン番号（行内 0 起点）。 */
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** タイムラインの 1 行分（1 リソース）。 */
export interface TimelineRow {
  /** 対応するリソース。未割り当て行は `null`。 */
  resource: CalendarResource | null;
  /** 行キー（§6.2 と同じ `r:${id}` / `'unassigned'` 形式）。 */
  key: string;
  /** この行の帯（終日・時間指定の区別なく同じレーン空間に配置）。 */
  items: readonly TimelineItem[];
  /** この行のレーン数。 */
  laneCount: number;
}

/** タイムラインビューのビューモデル。 */
export interface TimelineViewModel {
  type: 'timeline';
  /** 表示日（ヘッダー用。`timelineDays` 日の連続並び）。 */
  days: readonly { date: Date; key: string; isToday: boolean; weekday: Weekday }[];
  /**
   * 時間軸の目盛り（全表示日分を連結）。
   * 既存 `TimeSlot` は「その日の 0:00 からの分」+ `HH:MM` ラベルという日内前提の型のため
   * 流用せず（複数日では `minutes > 1439` が生じ意味が壊れる）、表示分基準の
   * `TimelineSlot` を別型として定義する。ラベルは日内時刻（`minutes % 1440` を
   * `formatSlotLabel` で整形）で、日の区別は `dayKey` と日ヘッダーが担う。
   */
  slots: readonly TimelineSlot[];
  /** 行（`resources` の並び順。§3.3 の規則で末尾に未割り当て行）。 */
  rows: readonly TimelineRow[];
  /** 行が 1 つもないか（§3.3 の空状態）。 */
  isEmpty: boolean;
  /** 表示分の総量（`days.length × 1440`。常に正）。横幅スケールの分母。 */
  totalMinutes: number;
  /** 現在時刻線の位置（表示分）。表示範囲に「今」がなければ `null`。 */
  nowIndicatorMinutes: number | null;
}
```

ビルダー: `buildTimelineViewModel(params: { currentDate, timeZone, occurrences, resources, unassignedLane, timelineDays, slotMinutes, now }): TimelineViewModel`

- 終日イベントは覆う表示日の `[日開始 0 分, 日終了 1440 分)` の帯として同じレーン空間に置く
  （行を終日/時間指定で分割しない。FullCalendar timeline と同様の一体表示）。
- オカレンス → 表示分の変換は `dateKeyInZone` / `minutesOfDayInZone` を用い、
  表示日リスト上のインデックスから算出する（素の差分演算をしない）。
- **長さ 0 のオカレンスの実効区間**: レーン割当とビューモデル上の幅は
  `[start, start + 30 分)` として扱う。この 30 分は `layoutTimeGridItems` の
  `minSlotMinutes` 既定値（`time-grid-layout.ts:110`）と同じ**ビルダー側の固定値**であり、
  「分スケールのレイアウトで短小アイテムに視覚上の最小長を与える」という同一の
  ハウスルールに揃える。ドラッグの粒度を決める利用者設定 `snapMinutes` とは無関係
  （`layoutIntervalLanes` 自体は汎用のまま保ち、実効区間の適用はビルダーの責務）。
- core の座標変換純関数を `interaction.ts` に追加する:

```ts
timeAtTimelineOffset(params: {
  /** 表示日の開始時刻の配列（昇順・1 日以上）。 */
  days: readonly Date[];
  /** 表示分。範囲外はクランプされる（下記の境界仕様）。 */
  displayMinutes: number;
  timeZone: TimeZoneId;
  /** スナップ間隔（分）。 */
  snap: number;
  /** 排他端（totalMinutes ちょうど）を許容するか。リサイズの終了端でのみ true。既定 false。 */
  allowExclusiveEnd?: boolean;
}): Date
```

  - 表示分 → 絶対時刻。D&D とクリック作成の共通基盤。逆方向（絶対時刻 → 表示分）は
    ビルダーが担うため公開しない。
  - **境界仕様は用途別**（既存 `timeAtGridPosition` が開始時刻用途として 1440 未満に
    クランプする規則（`interaction.ts:83`）に準拠）:
    - 既定（作成の起点・移動先の開始）: `snapToInterval` 適用後に
      `[0, max(0, totalMinutes − snap)]` へクランプし、**排他端を返さない**（開始時刻が
      範囲の終端ちょうどになる無効な予定を作らせない）。
    - `allowExclusiveEnd: true`（リサイズの終了端）: `[min(snap, totalMinutes),
      totalMinutes]` へクランプし、上端（排他端）を許容する。
    - `snapMinutes` は正整数への正規化のみで上限がない（`calendar.ts:89`）ため、
      `snap > totalMinutes` の退行的な設定でも上下限は `max` / `min` により逆転しない
      （既定用途は 0、リサイズ終了端は `totalMinutes` に倒れる。既存
      `timeAtGridPosition` の `Math.max(0, …)` と同じ安全側の倒し方）。
  - `days` が空の場合は仕様違反として扱わない（§7.2 により空にならない。
    ビルダー/フックが常に 1 日以上を渡す）。

### 7.5 React（`react/components/timeline-view.tsx`）

- ルート `data-koyomi="timeline"`。左に行見出し列（`data-koyomi="timeline-resource-header"`）、
  右に横スクロールコンテナ（`data-koyomi="timeline-body"`）。日ヘッダー
  （`timeline-day-header`）+ 時間目盛り（`timeline-slots`）+ 行（`timeline-row`）。
  帯は `data-koyomi="timeline-item"` の `<button>`、水平位置は
  `left: ${startMinutes / totalMinutes * 100}%` / `width: %` の inline 数値のみ
  （`totalMinutes > 0` は §7.2 で保証）。レーンは `data-koyomi-lane` 属性 +
  テーマ CSS で縦位置を決める。
- スクロールは**単一の横スクロールコンテナ**に行見出し列を `position: sticky` で固定する
  （二重スクロール同期の JS を持たない。構造 CSS はデフォルトテーマの
  `[data-koyomi="timeline-body"]` 等に置く既存規約どおり）。
- **横方向の DOM 量**: 目盛りは `timelineDays × ceil(1440 / slotMinutes)` 個
  （既定 1 日 × 24 個、7 日 × 60 分でも 168 個。`slotMinutes` は正整数への正規化のみで
  1440 の約数とは限らないため、日ごとの目盛り数は既存の `minutes < 1440` ループと同じ
  切り上げで数える）。`slotMinutes` を細かくし `timelineDays` を大きくすると積は容易に
  膨らむ（例: 5 分 × 30 日 = 8,640 個）ため、**目盛りが 1,000 個を超える構成では
  開発ビルドで一度だけ警告**し、docs に「粗い `slotMinutes` × 長期間」か
  「細かい `slotMinutes` × 短期間」を推奨する旨を明記する。
  横方向仮想化は非対象（`virtualization-design.md` §8 の再検討トリガー「④横方向仮想化」。
  必要になった時点で TanStack Virtual 採用を含め別提案）。
- a11y: リソースビューと同じく**時間グリッドの現状に合わせる**（grid 系 role なし。§6.3）。
  帯は `<button>` + 完全な日時・リソース名入り `aria-label`。行見出しはテキスト表示
  （ARIA grid 化は別提案）。
- キーボード: ←→ = `snapMinutes` 分の移動、Shift+←→ = リサイズ、**↑↓ = 行（リソース）移動**。
  原則 7（キーは視覚軸に従う）による割当。リソースビュー（列 = リソースなので ←→）とは
  キーが異なるが、これは「リソースという概念」ではなく「画面上の移動方向」にキーを
  割り当てる既存原則の帰結であり、ビューごとの視覚配置と常に一致する。
- カスタム描画 props（ローカル名は無接頭辞。§8.1）: `renderEvent` /
  `renderRowHeader?(row, defaultContent)` / `unassignedLabel?` / `emptyLabel?`。

### 7.6 D&D（`react/use-timeline-drag.ts`・新規フック）

- 行レジストリ `Map<rowKey, { element, resourceId: string | null }>` + ボディ要素の
  矩形から X → 表示分（`timeAtTimelineOffset` でスナップ・クランプ）、Y → 行を解決する。
- 操作: 作成（空き領域を横ドラッグ。行 = 開始行に固定）/ 移動（横 = 時間、縦 = 行）/
  リサイズ（左右端ハンドル）。確定時のパッチとコールバック・既定作成の `resourceId` 付与は
  リソースビュー（§6.4）と同一規則。
- 終日オカレンスの帯を時間指定へ変える越境変換は提供しない（§6.4 と同じ判断）。
  終日帯の横移動は日単位スナップ（`dayDragPreviewRange` の日数差計算を再利用）。
- オートスクロール: 既存の `autoScrollVelocity` を横方向に再利用する
  （**core ではなく `react/use-time-grid-drag.ts` のモジュールレベル export**。
  新フックは兄弟モジュールから import する。core 純関数と混同しない）。

## 8. ビュー横断の統合

### 8.1 `CalendarView` の転送 props（命名規則: ローカル名は無接頭辞、転送名はビュー名接頭辞）

既存規約（例: `ListView.renderEvent` ← `CalendarView.renderListEvent`）に従い、
各ビューコンポーネントのローカル prop 名には接頭辞を付けず、`CalendarViewProps` での
転送名にのみビュー名接頭辞を付ける:

| 転送先 | ローカル prop | `CalendarViewProps` での転送名 |
| --- | --- | --- |
| `YearView` | `renderMonthHeader` / `renderDayCell` | `renderYearMonthHeader` / `renderYearDayCell` |
| `MultiMonthView` | `renderEvent` / `renderDayCell` / `overflowLabel` | `renderMultiMonthEvent` / `renderMultiMonthDayCell` / `multiMonthOverflowLabel` |
| `ResourceView` | `renderEvent` / `renderColumnHeader` / `unassignedLabel` / `emptyLabel` | `renderResourceEvent` / `renderResourceColumnHeader` / `resourceUnassignedLabel` / `resourceEmptyLabel` |
| `TimelineView` | `renderEvent` / `renderRowHeader` / `unassignedLabel` / `emptyLabel` | `renderTimelineEvent` / `renderTimelineRowHeader` / `timelineUnassignedLabel` / `timelineEmptyLabel` |

### 8.2 ドラッグプレビューの一貫性

すべての新 D&D は既存どおり `api.setDragPreview(preview)` を経由し（`commit(false)` /
ビューモデル非破壊）、プレビュー描画はビュー側のオーバーレイ（`aria-hidden`）で行う。
`DragPreview.resourceId` は §3.4 のとおり。

### 8.3 越境変換のポリシー（明文化）

allDay⇔時間指定のドラッグ変換は**週/日ビュー内の機能に限定**する。年（D&D なし）・
複数月（終日帯の日単位操作のみ = 月ビューと同一）・リソース/タイムライン（§6.4・§7.6）では
提供しない。将来提供する場合も本設計の範囲外の別提案とする。

### 8.4 Toolbar（後方互換）

`ToolbarProps` に `views?: readonly CalendarViewType[]`（既定
`['month', 'week', 'day', 'list']`）を追加する。**既定値が従来と同一のため、既存利用者の
ボタン列は不変**。新ビューを出したい利用者が明示的に並びを指定する。
`ToolbarLabels` に `year` / `multiMonth` / `resource` / `timeline` を**省略可能キー**として
追加（既定「年 / 複数月 / リソース / タイムライン」。既存キーもすべて省略可能で、
型互換を壊さない。§2.6）。`title()` は年「2026年」、複数月「2026年7月〜2026年9月」、
リソース = 日ビューと同一、タイムライン「2026年7月10日〜7月16日」（1 日なら日ビューと同一）。

### 8.5 キーボードショートカット（後方互換）

`CalendarShortcut` の `view` を新 4 種に拡張し、`shortcutForKey` に
**Y（year）/ Q（multiMonth）/ R（resource）/ L（timeline）** を追加する。

- 割当の根拠: 既存の割当済みキーは M/W/D/A（ビュー）、**T（今日）**、J・N（次）、
  K・P（前）、C（作成）。`timeline` の頭文字 T は **today と衝突するため使えず**、
  残る候補から語中の L（time**l**ine）を採る。Q は既定 3 ヶ月 = 四半期（quarter）の連想。
- 既存キーの割当・挙動はすべて不変。
- `useCalendarShortcuts` には `views?: readonly CalendarViewType[]` を追加し、
  ビュー切替キーはこのリストに含まれるビューに対してのみ働く。
  **既定は `['month', 'week', 'day', 'list']`（既存 4 ビュー）**とし、Toolbar の `views`
  既定（§8.4）と揃える。新ビューを Toolbar に出していない既存利用者が Y/Q/R/L で
  意図せず新ビューへ遷移することはなく、既定挙動は現行と完全に一致する。
  新キーを使いたい利用者は `views` に新ビューを含める（Toolbar と同じ opt-in）。
  `shortcutForKey`（core）自体は Y/Q/R/L を常に解釈し、フィルタは React フック側の責務。

## 9. a11y（要約）

- **年/複数月**: 月ビューの ARIA grid パターン（`role="grid"` / `row` / `columnheader` /
  `gridcell`、div ベース。`month-view.tsx` の前例）を踏襲する。
- **リソース/タイムライン**: 時間グリッドの現状（grid 系 role なし）に合わせ、
  操作要素 = `<button>` + 完全な `aria-label`（日時・件数・リソース名）を徹底する。
  週/日ビューを含めた ARIA grid 化の一括改善は別提案（§14）。
- 装飾オーバーレイ（プレビュー・現在時刻線）は `aria-hidden="true"`、
  フォーカス可能要素を含む層は `role="presentation"` の既存使い分けを踏襲。
- 全ビューで Enter/Space = クリック相当（`currentTarget.click()` 明示呼び）、
  Delete/Backspace = 削除、Escape = ドラッグキャンセル。
- 既知の制約: 未割り当てレーン（`'auto'`）や外部の `setEvents` / `setResources` により
  フォーカス中の要素が DOM から消えるとフォーカスは body に落ちる。これは既存ビュー
  （`setEvents` で予定が消える場合）と同種の挙動で、フォーカス復帰の仕組みは非目標（§14）。

## 10. 公開 API（`src/index.ts`）

virtualization の前例（core 関数がすべて公開されるわけではない）に従い、公開面を明示する:

**公開する**
- 型: `CalendarResource`、4 つの ViewModel 型とその構成型（`YearDay` / `YearMonth` /
  `MultiMonthMonth` / `ResourceColumn` / `TimelineRow` / `TimelineItem` / `TimelineSlot`）
- core: `buildYearViewModel` / `buildMultiMonthViewModel` / `buildResourceViewModel` /
  `buildTimelineViewModel`（既存ビルダー公開の前例に一致。独自 DOM 自作者向け）
- react: `YearView` / `MultiMonthView` / `ResourceView` / `TimelineView`、
  `useResourceGridDrag` / `useTimelineDrag`（`useDayDrag` / `useTimeGridDrag` 公開の前例に一致）

**公開しない**
- `layoutIntervalLanes`（`layoutBandItems` / `layoutTimeGridItems` が非公開である前例に一致）
- `timeAtTimelineOffset` / `startOfYearInZone` などの内部ユーティリティ
- `month-view-parts.tsx` などの共有内部レンダラ

## 11. 難所と対策

| 論点 | 対策 |
| --- | --- |
| `CalendarViewType` 拡張の配線漏れ | default 節なし switch の網羅性チェック + §2.5 チェックリスト（網羅性の効かない Toolbar 既定・ショートカット・docs・memo 比較関数を明記） |
| union 拡張の型レベル互換性 | 破壊的変更として扱い、v0.x マイナー + CHANGELOG + 移行手順を明記（§2.6） |
| `CalendarState` / `CalendarApi` の必須メンバー追加 | 実装・モック側に対する破壊的変更として §2.6 の一覧に明記（読み取り側は無影響） |
| リソース色の適用範囲 | リソース/タイムラインビュー限定。既存ビューの描画は `event.color` のみで不変（§3.1） |
| 広い範囲の展開コスト（年） | 範囲全体で `expandEvents` 1 回。年ビューは帯レイアウト無しの件数集計のみ（§4.4）。複数月は月ビュー×N と明示（§5.4） |
| 年境界をまたぐオカレンスの件数混入 | 日スパンを `[年初, 翌年初)` にクランプしてから集計 + 前後月セルは 0 固定（§4.2） |
| 複数月での日付セル二重描画 | 前後月の日付セルは予定なし・D&D 登録なし。帯は月本体にクランプ + `continuesBefore/After`（§5.2-5.3） |
| `useDayDrag` のレジストリキー衝突（複数月） | 単一フックインスタンス + 前後月セルを登録しない規則で日付キー全域一意（§5.3） |
| 月ビュー DOM・挙動の不変性 | 共有 parts に前後月セルの登録可否パラメータを設け、`MonthView` は従来値。抽出リファクタは挙動不変の独立 PR（§5.3・§15） |
| `segmentRange` と既存 2 段クランプの相互作用 | スパン生成段の第 3 境界として定義し、`continuesBefore/After` は OR 条件で拡張。既定経路は不変でリグレッションテスト必須（§5.2・§12） |
| リソース概念の不在 | `CalendarResource` + `CalendarEvent.resourceId` + `resources` 状態。`applyPatch` は無改修、**`buildOverride` の継承リストのみ 1 箇所改修**（§3.4） |
| リソース移動の通知手段 | `EventChange.resourceId?` / `RangeSelection.resourceId?` を省略可能追加（§3.4） |
| 未割り当てへ戻す D&D とレーン生成の両立 | `unassignedLane: 'auto' \| 'always'`。ドラッグ中はビューモデル非再構築でレーン安定（§3.3） |
| 空状態（リソースなし・該当予定なし） | `isEmpty` + `emptyLabel`。D&D 不能の制約と回避策を docs 明記（§3.3） |
| 参照先のない `resourceId` | 未割り当てレーンに合流（黙って消さない）+ React 層で開発ビルド警告（§3.3） |
| 警告の層配置 | core は決定論的な安全側処理のみ。`isDevBuild` 警告は React 層（§1 原則 1・§3.2-3.3） |
| 列/行キーとリソース ID の衝突 | `r:${id}` / `'unassigned'` の判別子付きキー形式（§6.2） |
| 既存 D&D フックの「1 日 = 1 列」前提 | 流用せず新フック（列/行レジストリを `resourceId` 込みで再設計）。core 純関数（`timeAtGridPosition` / `dragPreviewRange` / `snapToInterval`）は再利用。`autoScrollVelocity` は react 層の export を再利用（§6.4・§7.6） |
| DST と横軸の整合（タイムライン） | 「表示分」座標系（全日 1440 分）で週/日ビューの既存規約と統一（§7.2） |
| タイムラインの `hiddenWeekdays` | 非対応（比例スケールの歪み・`continuesAfter` の意味破綻・表示日ゼロを根本回避）。将来は不連続マーカー付き別提案（§7.2・§14） |
| `timeAtTimelineOffset` の境界 | 用途別クランプ（開始用途は排他端を返さない / `allowExclusiveEnd` でリサイズ終了端のみ許容）。`days` は常に 1 日以上（§7.4） |
| 既存 `TimeSlot` との意味衝突 | 複数日で `minutes > 1439` になるため流用せず、表示分基準の `TimelineSlot` を別型で定義（§7.4） |
| 帯レイアウトの分単位転用 | `overflowByCol` を持つ `layoutBandItems` を転用せず、区間ベースの `layoutIntervalLanes` を新設（§7.3） |
| タイムラインの DOM 量 | 目盛り数 = `timelineDays × ceil(1440 / slotMinutes)`。1,000 超で開発ビルド警告 + docs 推奨（§7.5）。横仮想化は再検討トリガー |
| Toolbar / ショートカットの既定挙動変更 | Toolbar・`useCalendarShortcuts` とも既定は既存 4 ビューで完全不変（新ビューは両方 opt-in）。**T は today と衝突のため timeline = L**（§8.4-8.5） |
| 横スクロール同期 | 単一スクロールコンテナ + sticky 行見出し（同期 JS なし）（§7.5） |
| 越境変換（allDay⇔時間指定）の適用範囲 | 週/日ビュー限定と明文化（§8.3） |

## 12. テスト計画（TDD）

- `core/date-utils.test.ts`（追記）: `startOfYearInZone`（年初・DST ゾーン・深夜 0:00 不在ゾーン）、
  `visibleRangeFor` / `navigateDate` の 4 ビュー（年またぎ・月末アンカー・`timelineDays` /
  `multiMonthCount` 反映）。
- `core/views/year-view.test.ts`: 12 ヶ月構造・週数・前後月セルの `eventCount: 0`
  （**年境界をまたぐ複数日オカレンスが範囲外の日に加算されないこと**を含む）・
  複数日オカレンスの日別カウント・長さ 0・`weekStartsOn`・`hiddenWeekdays` 無視・
  他 TZ（`TZDate`）・today 判定。
- `core/views/month-view.test.ts`（追記）: `segmentRange` 指定時のクランプ・
  `continuesBefore/After`・あふれ非計上、**省略時に既存全ケースが不変**（リグレッションガード）。
- `core/views/multi-month-view.test.ts`: 月数・月またぎ帯の分割と `continuesBefore/After`・
  前後月セルに帯が出ない・`hiddenWeekdays`・あふれ・`multiMonthCount: 1`。
- `core/mutations.test.ts`（追記）: `buildOverride` が `resourceId` を継承する・
  `splitSeries` がスプレッドで継承する・`{ resourceId: undefined }` パッチで削除される。
- `core/views/resource-view.test.ts`: 列生成（並び順・`unassignedLane` 両値での未割り当て列の
  有無・ID 重複の先勝ち）・参照先のない `resourceId` の合流・列ごとの重なり配置・
  日またぎクランプ・現在時刻線・`isEmpty`。
- `core/layout/interval-lane-layout.test.ts`: レーン割当・同数同順規約・ソート規則・
  空入力・全件重なり・接触（排他境界）は重ならない。
- `core/views/timeline-view.test.ts`: 表示分変換（DST 日・複数日）・終日帯の日スパン・
  行生成・クランプと `continuesBefore/After`・長さ 0 の実効 30 分・`totalMinutes`・
  `hiddenWeekdays` 無視・`isEmpty`・`TimelineSlot`（`dayKey` / 日内ラベル /
  1440 の非約数 `slotMinutes` での日ごとの切り上げ目盛り数）。
- `core/interaction.test.ts`（追記）: `timeAtTimelineOffset`（スナップ・日境界・DST・
  既定クランプが排他端を返さない・`allowExclusiveEnd: true` での上端許容・
  `snap > totalMinutes` の退行的設定で範囲が逆転しない）、
  `shortcutForKey` の Y/Q/R/L と **T が today のままであること**。
- `core/calendar.test.ts`（追記）: `resources` 状態と `setResources` 通知・
  `updateOptions({ resources })`・4 ビューの `getViewModel` 配線・新オプションの正規化。
- `react/use-calendar.test.tsx`（追記）: `resources` 参照変化の開発ビルド警告。
- `react/use-resource-grid-drag.test.tsx` / `react/use-timeline-drag.test.tsx`: 作成/移動/
  リサイズ/キャンセル・リソース間移動のパッチ内容（時間 + `resourceId` の合成 1 回・
  `{ resourceId: undefined }`）・`EventChange.resourceId` の通知・既定作成の `resourceId`・
  終日行の作成（`allDay: true` + `resourceId`）と列間移動・繰り返しスコープ解決・
  キーボード操作。
- `react/components/{year,multi-month,resource,timeline}-view.test.tsx`: DOM 仕様
  （`data-koyomi-*`）・aria-label・カスタム描画 props・空状態（`emptyLabel`）・
  開発ビルド警告（ID 重複・参照先のない `resourceId`・タイムライン目盛り数）。
- `react/components/month-view.test.tsx`（追記）: parts 抽出後の DOM 不変・
  前後月セルのインタラクティブ性維持（リグレッションガード）。
- `react/components/toolbar.test.tsx`（追記）: `views` 既定の不変・指定時のボタン列・新ラベル。
- `react/use-calendar-shortcuts.test.tsx`（追記）: 既定で Y/Q/R/L が働かないこと・
  `views` に新ビューを含めた場合のみ働くこと・既存 M/W/D/A/T の挙動不変。

## 13. 用語（`terminology.md` への追記候補）

- リソース（resource）/ 未割り当て（unassigned）/ 参照先のない resourceId（orphan は既存規約どおり「参照先のない」）
- 表示分（display minutes。タイムラインの横軸座標系）
- 行（row。タイムラインのリソース行）・レーン（lane。既存語を踏襲。「スイムレーン」は使わない）
- ミニ月グリッド（年ビューの月グリッド）

## 14. 非目標

- 複数リソース割当（`resourceIds`）・リソース階層/グループ・リソースの CRUD API と変更通知
- リソース×複数日のマトリクスビュー（リソース週ビュー）
- タイムラインの `hiddenWeekdays` 対応（不連続マーカー付きの別提案とする。§7.2）
- タイムラインの横方向仮想化（`virtualization-design.md` §8 トリガー④）・ズームプリセット・
  行（リソース）方向・リソースビューの列方向の仮想化
- 週/日・リソース/タイムラインの ARIA grid 化（既存ビュー改修を伴う一括 a11y 改善として別提案）
- レーン消失時のフォーカス復帰（既存ビューと同種の制約。§9）
- 年ビューでの帯表示・D&D、年ビュー件数集計の opt-out（実測後の別提案）
- 複数月の表示月数を超えるスクロール連結（ページングのみ）・月単位メモ化（§5.4）
- 新ビューでの allDay⇔時間指定の越境ドラッグ変換（§8.3）

## 15. 段階リリース

1. **PR1（年）**: 型拡張（`year` のみ）+ `startOfYearInZone` + `buildYearViewModel` +
   `YearView` + Toolbar/ショートカット拡張の土台（`views` prop・`ToolbarLabels`・Y キー）+ docs。
   D&D なし・リソース非依存で最小の縦貫通。§2.6 の互換性方針（CHANGELOG・移行手順）も
   この PR で確立する。
2. **PR2（月ビュー parts 抽出）**: `month-view-parts.tsx` への挙動不変リファクタ
   （既存テスト全通過 + DOM 不変・前後月セルのインタラクティブ性維持を確認）。
3. **PR3（複数月）**: `multiMonth` 型拡張 + `segmentRange` + `buildMultiMonthViewModel` +
   `MultiMonthView`（単一 `useDayDrag` 再利用）+ Q キー + docs。
4. **PR4（リソースモデル）**: `CalendarResource` / `CalendarEvent.resourceId` /
   `resources` 状態と API / `buildOverride` 継承 / コールバック・`DragPreview` 拡張 /
   `useCalendar` 警告 / memo 比較関数の点検。ビュー追加なし（純粋なモデル拡張）。
5. **PR5（リソースビュー）**: `resource` 型拡張 + `buildResourceViewModel` +
   `ResourceView` + `useResourceGridDrag` + `unassignedLane` オプション + R キー + docs。
6. **PR6（タイムライン）**: `timeline` 型拡張 + `layoutIntervalLanes` +
   `timeAtTimelineOffset` + `buildTimelineViewModel` + `TimelineView` +
   `useTimelineDrag` + L キー + docs。
7. 各 PR で `components-dom.md` / `views.md` / `terminology.md` / デモを同時更新し、
   `pnpm check` を通す。
