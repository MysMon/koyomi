# Koyomi 仮想化（virtualization）設計案 v4

> v1→v3 で Codex レビューを反映し「承認（実装着手可）」まで収束。
> v4 は**ヘッドレス純度**の 2 逸脱を是正し、**提供形態**を確定する:
> ⓐ `height` プロップを廃止 → 高さは利用者 CSS が所有し、フックが実測する
> ⓑ `overflow`/`position` などの構造 CSS を inline から**デフォルトテーマ**（data 属性フック）へ移す
> ⓒ 提供形態を **hook-first**（`useVirtualizer` プリミティブ ＋ 別 opt-in コンポーネント
>   `VirtualListView`）に確定。既存 `ListView` にプロップを足さない（§4.0）。

## 0. 目的とスコープ

大量イベント／長期間表示時の DOM ノード肥大を抑え、描画・スクロール性能を確保する。
既存のヘッドレス設計（core は React 非依存、react は `data-koyomi-*` 属性フックのみ、
状態は `createCalendar` 購読モデル）を壊さずに導入する。

### 対象ビュー（実測に基づく）

| ビュー | 現状 | 仮想化 |
| --- | --- | --- |
| **List（アジェンダ）** | スクロールコンテナ無しで `days × occurrences` を全件フラット描画。各 day は `section`（ヘッダ＋予定行 button）。ドラッグ無し | **本設計の唯一の対象（P0）** |
| TimeGrid（週/日） | 既に `overflow-y:auto`（640px 窓／1152px 内容）。% 絶対配置。ドラッグ・オートスクロールあり | **非対象**（§5。実測後の別提案） |
| Month（月） | 最大 6 週 42 セル・有界、セル内は集約済み | 対象外 |

## 1. 設計原則

1. **core は DOM を知らない**。純粋な算数のみ `src/core/virtualization.ts` に純関数で置く。
   DOM 実測（ResizeObserver / scroll / rAF）は `src/react/` に閉じる。
2. **オプトイン**。既定は現状どおり全件描画。
3. **`data-koyomi-*` は「拡張」であって「破壊」ではない**。仮想化時のみラッパ・spacer と
   `data-koyomi-virtualized="true"` を**追加**する。差分は `docs/internal/components-dom.md`
   に「opt-in 時の DOM 拡張」として明記（既存の非仮想化 DOM は不変）。
4. **アクセシビリティを退行させない**（§6）。
5. **スコープを小さく保つ＝自作の許容条件**（§8）。

## 2. コア層: 純粋ウィンドウ計算

`src/core/virtualization.ts`（新規・React 非依存・純関数のみ）

```ts
/** 1 アイテムの配置情報（縦方向・px）。 */
export interface VirtualItem {
  index: number;
  /** 安定キー（測定キャッシュ・React key・フォーカス保持の基準）。 */
  key: string;
  /** コンテナ先端からのオフセット（px）。全アイテム共通の絶対座標系。 */
  start: number;
  /** 高さ（px）。measured があればそれ、無ければ estimate。 */
  size: number;
  /** 実測済みか。 */
  measured: boolean;
}

export interface WindowInput {
  count: number;
  getKey: (index: number) => string;
  estimateSize: (index: number) => number;
  /** 実測済み高（key → px）。index ではなく key 基準（並び替え・挿入で壊れない）。 */
  measured: ReadonlyMap<string, number>;
  scrollOffset: number;
  viewportSize: number;
  overscan?: number; // 既定 3
  /** 常時保持したい key（現在フォーカス中アイテム等）。窓外でも DOM を消さない。 */
  pinnedKeys?: ReadonlySet<string>;
}

/**
 * ウィンドウ計算結果。責務を分離する（Codex 指摘②の明文化）:
 * - items:       連続する可視窓（overscan 込み・index 昇順・重複なし）。通常フローに並べる。
 * - pinnedItems: pinnedKeys のうち items に**含まれない**ものだけ（窓外の保持アイテム）。
 *                通常フローに混ぜず、React 側で絶対配置（top=start）する（Codex 指摘①）。
 * - beforeSize:  items 先頭より上の総高（＝ items[0].start）。上スペーサ高。
 * - afterSize:   items 末尾より下の総高（＝ totalSize − (末尾.start + 末尾.size)）。下スペーサ高。
 * count=0 のときは items=[] / pinnedItems=[] / before=after=total=0。
 */
export interface WindowResult {
  items: VirtualItem[];
  pinnedItems: VirtualItem[];
  beforeSize: number;
  afterSize: number;
  totalSize: number;
  /** 可視範囲（overscan 除く）。到達性・scrollToIndex 用。空窓なら -1。 */
  startIndex: number;
  endIndex: number;
}

export function computeWindow(input: WindowInput): WindowResult;

/**
 * 指定 key のアイテムの start（px）を返す。無ければ null。
 * key 基準スクロールアンカリングの「新しい start」取得を core の責務として提供する
 * （Codex 指摘③）。React 側はこれで補正量 = newStart − previousStart を求める。
 * 内部は getKey で key→index を引き、measured/estimate の累積から start を得る純計算。
 */
export function startForKey(
  input: Pick<WindowInput, 'count' | 'getKey' | 'estimateSize' | 'measured'>,
  key: string,
): number | null;
```

- **重複排除規則（②）**: `items` は連続 index 範囲なので重複しない。`pinnedItems` は
  「pinnedKeys ∖ items の key 集合」だけを入れる。よって `items` と `pinnedItems` は
  key で必ず互いに素。React の描画キーも一意。
- **累積計算**: 初版は O(count) 前方走査。List のアイテム＝日数で十分軽い。将来 count が
  数万規模なら prefix-sum＋二分探索へ内部差し替え（インターフェイス不変）。
- テスト `core/virtualization.test.ts`（DOM 不要）: 等高・可変高・overscan 境界・スクロール端・
  count=0・measured の部分適用で単調増加・`beforeSize+Σsize(items)+afterSize == totalSize` の恒等・
  pinnedItems が items と素で窓外のみ・`startForKey` が measured/estimate 混在でも正しい。

## 3. React 層: ウィンドウイングフック

`src/react/use-virtualizer.ts`（新規）

```ts
export interface UseVirtualizerOptions {
  count: number;
  getItemKey: (index: number) => string;
  estimateSize: (index: number) => number;
  getScrollElement: () => HTMLElement | null;
  overscan?: number;
  /** 窓外でも保持する key（フォーカス中アイテム。通常 0〜1 件）。 */
  pinnedKeys?: ReadonlySet<string>;
  measure?: boolean; // 既定 true（ResizeObserver 実測）
  /** SSR/初回は false、マウント後に true（§4 の切替）。 */
  enabled: boolean;
}

export interface Virtualizer {
  /** 通常フローに並べる連続窓。 */
  virtualItems: readonly VirtualItem[];
  /** 絶対配置で保持する窓外 pinned（通常 0〜1 件）。 */
  pinnedItems: readonly VirtualItem[];
  beforeSize: number;
  afterSize: number;
  totalSize: number;
  measureElement: (key: string) => (el: HTMLElement | null) => void; // key 基準
  scrollToIndex: (index: number, opts?: { align?: 'auto' | 'start' | 'center' }) => void;
}

export function useVirtualizer(options: UseVirtualizerOptions): Virtualizer;
```

実装方針:
- スクロール位置は `scroll` を **rAF スロットル**で購読。高さは **ResizeObserver** で追跡し
  `measured`(key→px) を「値が変わったときだけ・rAF バッチ」で更新（measure ループ防止）。
- **スクロールアンカリング（③の手順を確定）**:
  1. 測定反映（measured 更新）の**直前**に、先頭可視アイテム（`virtualItems[0]`）の
     `anchorKey` と `overshoot = scrollTop − item.start` を保存。
  2. measured 更新後、`startForKey(input, anchorKey)` で**新しい start** を取得。
  3. `scrollTop = newStart + overshoot` に補正（`useLayoutEffect` でペイント前に適用）。
  - index 基準は使わない（範囲変更・先頭挿入で破綻）。`anchorKey` が消えた場合は補正しない。
- `enabled=false`（SSR・初回クライアント）: `virtualItems=全件 / pinnedItems=[] /
  before=after=0 / totalSize=Σestimate` を返す（§4）。
- 再レンダー抑制: `startIndex/endIndex/beforeSize/afterSize/totalSize` が実質同じなら抑止。

## 4. List ビューへの適用（P0）

### 4.0 提供形態（確定）: hook-first ＋ 別 opt-in コンポーネント

**`ListView` に `virtualized` プロップは足さない。** 代わりに次の 2 段で提供する:

1. **`useVirtualizer`（プリミティブ・§3）** — ビュー非依存のヘッドレスな核。利用者は
   `buildListViewModel`（core）＋このフックで独自 DOM を完全自作できる（`useDayDrag` 等と同じ
   プロップゲッター思想の延長）。これが正式な公開 API の中心。
2. **`VirtualListView`（薄い同梱コンポーネント・バッテリー同梱の砂糖）** — `useVirtualizer` を
   使って窓描画する opt-in コンポーネント。`ListView` とは**別エクスポート・別モジュール**。

理由:
- 既存 `ListView`（全件描画）を**byte-identical に保つ**（既存テスト不変・リグレッション皆無）。
- 描画戦略の分岐を 1 コンポーネントに同居させない（discriminated union プロップの肥大回避）。
- 仮想化は横断的関心事。プロップ方式だと各ビューに prop が増殖するが、フックなら再利用可能。
- 未使用者は import しない＝tree-shaking で確実に落ちる。

**重複回避**: 日ヘッダ・予定行の描画は内部共有レンダラ（`ListDaySection` / `ListEventRow`、
非公開）に切り出し、`ListView` と `VirtualListView` の両方がそれを使う。よって DOM 仕様は
1 箇所に集約され、両コンポーネントで完全一致する。

> 命名（`VirtualListView` / `AgendaView` / `ListView.Virtual` 等）は未確定。§4.4 で扱う。

### 仮想化単位 = 「日セクション」

アイテム = 日セクション。key = `day.key`（`YYYY-MM-DD`、表示 TZ で安定）。
- **性能上限（非目標）**: 「1 日に数百件」は日セクション内で全件描画され救えない。docs に上限記載。

### SSR / ハイドレーション（**固定**）

**「SSR と初回クライアント render は非仮想化（全件）。マウント後の `useLayoutEffect` で仮想化へ切替」**。
- 既存 `useCalendar.getServerSnapshot`（全件）と整合し hydration mismatch が原理的に起きない。
- `enabled` を `useState(false)＋useLayoutEffect(()=>setEnabled(true),[])` で立てる。

### 4.1 高さの所有（ⓐ・ヘッドレス是正）

**`height` プロップは持たない。** スクロールコンテナ（`[data-koyomi="list"]`）の高さは
**利用者が自分の CSS で決める**（ヘッドレスの本義: 寸法はライブラリが所有しない）。
`useVirtualizer` は `getScrollElement()` の高さを **ResizeObserver で実測**して窓計算に使う
（元々 ResizeObserver は持つので追加コストなし）。

- **境界高が未設定のとき**: `overflow:auto` でも高さ制約が無いとコンテナは内容全高に伸び、
  窓計算上「全件が可視」になり仮想化の利得が消える（＝退行ではなく無害な全件描画に縮退）。
  この場合は**開発ビルドで一度だけ警告**（既存の `useCalendar` の dev 警告と同じ流儀）。
- **デフォルトテーマは固定寸法（`max-height` の既定値）を持たない**（Codex 指摘。固定値は
  「高さは利用者所有」と衝突するため）。境界高は**利用者が当てる必須 CSS** として docs に明記する。
  テーマが便宜を図る場合も、値を強制せず CSS 変数 `--koyomi-virtual-list-max-height`（既定は
  `none`／未設定）を**参照するだけ**にし、「デフォルトテーマ利用時の便宜であって仕様上の必須寸法
  ではない」と説明する。寸法の最終決定権は常に利用者 CSS 側に残す。

### 4.2 構造 CSS の置き場所（ⓑ・ヘッドレス是正）

既存規約「**機能に必要な構造 CSS はデフォルトテーマに、inline は位置決めの数値だけ**」に合わせる
（既存の TimeGrid の `overflow-y:auto`・`touch-action:none` も default.css 側にある）。

- **デフォルトテーマ（`packages/.../theme/default.css`）**が `[data-koyomi-virtualized]` に対して
  `overflow-y:auto; position:relative`（＋既定 `max-height`）を与える。
- **inline style に残すのは動的な数値だけ**: spacer の `height`（before/after）と pinned の `top`。
  これは既存の `top`/`width` %・calc と同カテゴリで、規約に完全準拠。
- デフォルトテーマを使わない利用者は、`overflow`/`position:relative` を自分の CSS で当てる
  （＝ TimeGrid のスクロールと同じ約束。docs に必要 CSS として明記）。

### 4.3 初回全件 → 仮想化切替のレイアウトシフト抑制（⑤）

- コンテナ高は利用者 CSS で初回から確定しており（§4.1）、`overflow`/`position` もテーマで初回から
  効く（§4.2）。よって**コンテナ外形は切替前後で不変**。
- **総スクロール高も原則不変**: 切替後は `beforeSpacer + 窓 + afterSpacer` が全件高を再現するため
  スクロール可能高は保たれる。切替は `useLayoutEffect`（ペイント前）で行いちらつきを避ける。
- **既知の残差**: 実測前は estimate ベースのため、`measured` が入るまで `totalSize` に推定誤差が
  残る（スクロールバー比が微調整される）。仮想化の一般的制約として docs に明記。

### DOM 構造（opt-in 時のみ拡張。既存 DOM は不変。role/spacer は④を反映）

sticky 日ヘッダ維持のため **transform ではなくスペーサ方式**。`role="list"` の直下に
非 listitem を置かないため、**spacer は `role="presentation"`**（＋ `aria-hidden`）にする。
`overflow`/`position:relative` は inline ではなく `[data-koyomi-virtualized]` のテーマ CSS で
当てる（§4.2）。pinned はフォーカス保持専用・0〜1 件・窓内復帰時に即 `virtualItems` へ統合。

```
<!-- overflow-y/position:relative/max-height はテーマ CSS が [data-koyomi-virtualized] に付与（§4.2）。
     高さの最終決定は利用者 CSS（§4.1）。inline は spacer 高・pinned top の数値のみ。 -->
<div data-koyomi="list" data-koyomi-virtualized="true" role="list" tabindex="0">   ← スクロールコンテナ
  <div data-koyomi="list-spacer" data-edge="before"
       role="presentation" aria-hidden="true" style="height: beforeSize" />
  <section data-koyomi="list-day" role="listitem" ...> ... </section>   ← virtualItems（既存構造のまま）
  ...
  <div data-koyomi="list-spacer" data-edge="after"
       role="presentation" aria-hidden="true" style="height: afterSize" />
  <!-- 窓外 pinned（フォーカス保持）は通常フローに混ぜず絶対配置で保持（①）。top のみ inline。 -->
  <section data-koyomi="list-day" data-koyomi-pinned="true" role="listitem"
           style="top: <pinned.start>px">
    ...（フォーカス中の日セクション）
  </section>
</div>
```

- pinned セクションは絶対配置で **spacer の高さ計算・DOM フローに一切干渉しない**（①解消）。
  `position:absolute; inset-inline-start:0; width:100%` は `[data-koyomi-pinned]` のテーマ CSS で
  当て（構造 CSS はテーマ／§4.2）、inline は `top` の数値のみ。通常 0〜1 件（フォーカス中の 1 日）に
  限り、窓内に戻れば `virtualItems` 側へ統合され pinned は空。
- **非仮想化の `ListView` は従来どおり**（ラッパ・spacer・role・tabindex 無し、DOM 完全不変）。
  上記の拡張 DOM は `VirtualListView` 使用時のみ（§4.0）。

### 4.4 公開 API（hook-first。`ListView` にプロップを足さない）

```ts
// プリミティブ（§3）。これが中心。
export function useVirtualizer(options: UseVirtualizerOptions): Virtualizer;

// バッテリー同梱の砂糖。ListView とは別エクスポート・別モジュール。
export interface VirtualListViewProps extends ListViewBaseProps {
  /** 日セクションの推定高。件数依存を関数で表現可（既定 64）。 */
  estimateDayHeight?: number | ((day: ListDay, index: number) => number);
  /** 前後 overscan 日数（既定 3）。 */
  overscan?: number;
  // ※ height は持たない（§4.1: 高さは利用者 CSS が所有し、フックが実測する）
}
export function VirtualListView(props: VirtualListViewProps): ReactElement | null;

// 既存 ListView は不変（ListViewProps に仮想化系プロップは一切増えない）。
```

- `ListViewBaseProps` は現行 `ListViewProps`（`renderEvent`/`allDayLabel`/`emptyLabel`/
  `renderDayHeader`）を指し、`ListView`・`VirtualListView` が共有する。
- **命名は `VirtualListView` に確定**（Codex 推奨）。既存 `ListView`/`MonthView`/`TimeGridView` の
  「◯◯View」と一貫。`AgendaView` は `list` 概念とズレ、`ListView.Virtual` は named export／
  tree-shaking／docs で扱いづらいため不採用。

## 5. TimeGrid（本設計では非対象）

既に `overflow-y:auto`。重いのは「多数イベント」「ドラッグ中の再描画」で、スロット罫線の
間引きは費用対効果が低い（Codex 指摘）。実測で `slotMinutes` が細かい・1 日あたりイベントが
極端に多い等が確認されるまで延期し、別提案として切り出す。

## 6. アクセシビリティ（⑥・②④を反映して確定）

- 既定オフ。a11y 最優先の利用者は全件 DOM のまま。
- **role 構造（確定）**: スクロールコンテナ `role="list"`、各日セクション `role="listitem"`。
  spacer は `role="presentation"`＋`aria-hidden`（list の子が listitem のみになる／④解消）。
  - 予定行 button の `aria-setsize`/`aria-posinset`（v2 の曖昧点）は撤回。button は listitem
    ではないため誤読の恐れがある（Codex 指摘）。**予定件数は日セクション（listitem）の
    `aria-label`**（例: 「7月9日 予定3件」）で伝え、日内の個々の予定は従来どおり button として読む。
- **キーボード到達性（確定）**: コンテナ `tabindex="0"`。日／予定間はローミング tabindex で移動。
  移動先が窓外なら `scrollToIndex`→（`useLayoutEffect` で描画確定後）→`focus`。
  **不変条件: フォーカスは常に描画済み要素にある**。マウススクロールでフォーカス中要素が
  窓外に出る場合のみ、その日セクション key を `pinnedKeys`（0〜1 件）に入れて DOM を保持し、
  フォーカス喪失（フォーカスが body に落ちる）を防ぐ。
- find-in-page（Ctrl+F）が窓外に効かないのは本質的制約 → docs に明記。

## 7. 難所と対策（確定）

| 論点 | 対策 |
| --- | --- |
| 測定キャッシュの index ズレ | **key 基準**（`day.key`） |
| 可変高でスクロールが跳ねる | `anchorKey`＋overshoot、`startForKey` で新 start 取得→補正（§3 手順） |
| sticky 日ヘッダ | **スペーサ方式**（transform 不採用） |
| pinned と spacer の干渉 | pinned（窓外）は**絶対配置の別レイヤー**。spacer 計算と非干渉（①） |
| items/pinned の順序・重複 | core が責務分離。`items`∩`pinnedItems`=∅、恒等 `before+Σsize+after=total`（②） |
| role=list 配下 spacer | spacer は `role="presentation"`＋aria-hidden（④） |
| SSR 不一致 | 初回非仮想化→mount 後切替に固定（§4） |
| 切替レイアウトシフト | 高さは利用者 CSS 所有で初回から確定＋総高不変＋`useLayoutEffect`。残差（estimate 誤差）は docs 明記（⑤） |
| measure 無限ループ | 値変化時のみ＋rAF バッチ |
| 利用者 CSS が `list > list-day` 前提 | 拡張 DOM は `VirtualListView` 時のみ。既存 `ListView` は不変。components-dom.md 更新 |
| 高さの所有（ヘッドレス） | `height` プロップ廃止。利用者 CSS が高さを持ち、フックが ResizeObserver で実測（ⓐ/§4.1） |
| 構造 CSS の置き場所（ヘッドレス） | `overflow`/`position` はデフォルトテーマの `[data-koyomi-virtualized]`。inline は数値のみ（ⓑ/§4.2） |
| 提供形態（ヘッドレス層構造） | hook-first：`useVirtualizer` ＋ 別コンポーネント `VirtualListView`。`ListView` にプロップ足さず（ⓒ/§4.0） |

## 8. 依存判断: 自作 or TanStack Virtual

- 初回スコープが「List の日セクションのみ・機能を小さく保つ」なら**自作で許容**（追加依存回避、
  core の純関数志向と相性良）。
- **再検討トリガー（明文化）**: ①日内 2 段目仮想化 ②TimeGrid 展開 ③外部スクロールコンテナ注入／
  window スクロール連動 ④横方向仮想化 のいずれかに広がるなら TanStack Virtual 採用を再評価。

## 9. テスト計画（TDD）

- `core/virtualization.test.ts`: §2 の純粋数値テスト（DOM 不要・TZ 非依存）。恒等式・pinned 素・
  `startForKey`・count=0。
- `react/use-virtualizer.test.tsx`: jsdom で scroll／ResizeObserver をモックし、窓計算・key 基準
  measure・アンカリング補正・scrollToIndex・`enabled=false` の全件フォールバック。
- `react/components/list-view.test.tsx`: 既存 `ListView` の DOM が完全不変であることを再確認
  （リグレッションガード）。
- `react/components/virtual-list-view.test.tsx`（新規）: spacer 高（before/after）・窓分描画・
  role 構造（list/listitem/presentation）・日セクション `aria-label` の件数・sticky ヘッダ存在・
  フォーカス保持（pinned 絶対配置）・境界高未設定時の全件縮退＋dev 警告・共有レンダラで
  `ListView` と DOM が一致すること。

## 10. 段階リリース

1. **PR1**: `core/virtualization.ts`（`computeWindow`/`startForKey`）＋テスト（公開 API 露出なし）。
2. **PR2**: `use-virtualizer`＋テスト（公開プリミティブ）。
3. **PR3**: 共有内部レンダラ抽出（`ListView` を無変更で保つリファクタ）＋`VirtualListView`＋
   テーマ CSS（`[data-koyomi-virtualized]` / `list-spacer` / `[data-koyomi-pinned]`）＋docs＋デモ＋
   `components-dom.md` 更新。
4. TimeGrid は**別提案**（実測トリガー後）。

## 11. 非目標

- TimeGrid／Month の仮想化。横方向仮想化。外部スクロールコンテナ注入・window スクロール連動。
- 1 日内の予定行の 2 段目仮想化。
- 上記に踏み込む場合は §8 トリガーとして TanStack Virtual 採用を評価する。
