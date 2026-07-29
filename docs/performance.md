# パフォーマンス

大量の予定・リソースを扱う場合に検討すべき設定と、仮想化コンポーネントの使い分けを
まとめます。

## まず検討すること: 表示件数自体を減らす設定

仮想化コンポーネントを導入する前に、次の宣言的なオプションで DOM に描画する件数
自体を絞れないかを検討してください。多くのカレンダー UI ではこれだけで十分です。

### `dayMaxEvents`（月・複数月ビュー）

月ビュー・複数月ビューの 1 日セルに表示する予定の最大数です（既定 `4`）。超過分は
「+N 件」ボタンに集約され、個々の予定要素は DOM に描画されません。1 日に大量の予定が
集中する場合でも、日セルの高さと DOM 量が青天井に増えるのを防げます。

```ts
useCalendar({ dayMaxEvents: 3 });
```

詳細は [ビュー: 月ビュー](./views.md) を参照してください。

### `slotMinTime` / `slotMaxTime`（週/日・リソースビュー）

週/日ビュー・リソースビューが表示する時間帯を制限します（既定 `'00:00'`〜`'24:00'`）。
業務時間外を表示しない運用（例: `07:00`〜`21:00`）にすると、時間グリッドの高さと
そこに配置される DOM 要素数を必要な範囲だけに抑えられます。

```ts
useCalendar({ slotMinTime: '07:00', slotMaxTime: '21:00' });
```

詳細は [ビュー: 表示時間帯（slotMinTime/slotMaxTime）](./views.md#表示時間帯slotmintimeslotmaxtime) を参照してください。

### 表示範囲外のイベントを渡さない

`useCalendar`/`api.setEvents` に渡す `events` は、表示に使わない期間の分まで含めても
描画には使われませんが、繰り返し予定の展開（`getOccurrences`）やドラッグ中の重なり
判定はイベント数に比例して重くなります。サーバーから取得する場合は
`onRangeChange`（[予定の管理: onRangeChange](./events.md#onrangechange-で表示範囲の変更を検知する)）
で現在の表示範囲を検知し、必要な期間のイベントだけを `setEvents` で渡す実装が
大量データ運用の基本です。

## 仮想化コンポーネントの使い分け

上記の設定でも DOM 量が問題になる規模（数百〜数千件の予定・リソースを同時に表示する
必要がある画面）では、可視範囲だけを描画する仮想化コンポーネントを使えます。いずれも
既定のビューとは別の **opt-in コンポーネント**で、既定のビュー（`ListView` /
`ResourceView` / `TimelineView`）は全件描画のまま変わりません。

| コンポーネント | 対象 | 仮想化する軸 | こういう場面で使う |
| --- | --- | --- | --- |
| `VirtualListView` | リストビュー | 縦方向（日セクション） | 数ヶ月〜数年分の予定を一覧するリスト画面で、日セクション数が多く DOM が肥大する場合 |
| `VirtualResourceView` | リソースビュー | 横方向（リソース列） | 数十〜数百件のリソース（会議室・設備・担当者等）を列として同時表示する場合 |
| `VirtualTimelineView` | タイムラインビュー | 縦方向（リソース行）× 横方向（時間軸） | 数十〜数百件のリソースを行として同時表示する、または `timelineDays` が大きく横に長いタイムライン（ガントチャート的な画面）の場合 |

3 つとも共通する設計です。

- **境界寸法は CSS で指定する必須事項**です。ヘッドレスの原則に従い、コンポーネント
  自身は高さ・幅を持ちません。スクロールコンテナに境界寸法（`VirtualListView`/
  `VirtualTimelineView` は高さ、`VirtualResourceView` は幅）を CSS で与えてください。
  境界寸法が無い環境では仮想化は無害に無効化され、全件描画にフォールバックします
  （開発ビルドで一度警告します）
- **推定サイズ**（`estimateDayHeight`/`estimateRowHeight`/`columnWidth`）を実際の
  描画内容に近い値に設定すると、スクロール時のガタつきが減ります。数値または
  行/日ごとに変える関数のどちらも渡せます
- **フォーカス中の行・列・日セクションは可視窓の外に出ても DOM を保持**します
  （pinned 状態）。フォーカスがユーザー操作で消えないようにするためで、
  `tabIndex={-1}` によりタブ順からは除外されます
- 独自のマークアップで仮想化したい場合は、ビュー非依存のプリミティブ
  `useVirtualizer`（縦・横どちらの軸にも対応）を `buildListViewModel` 等の
  ビューモデルビルダーと組み合わせて使えます

`VirtualListView` は日単位の仮想化に加え、1 日の予定件数が `sectionItemWindowThreshold`
（既定 50）を超える日セクションではセクション内でもウィンドウ描画を行い、可視範囲＋
overscan のイベント行だけを描画して残りをイベント行の推定高 `estimateItemHeight`
（既定 32px）に基づく高さのスペーサーで置き換えます。1 日に数百件の予定があっても
DOM のイベント行数は可視範囲程度に抑えられます。カスタム描画で行の実寸が既定と
大きく異なる場合は `estimateItemHeight` を実寸に合わせるとスクロールが安定します。

使用例:

```tsx
import { CalendarProvider, VirtualTimelineView, useCalendar } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ resources /* 数百件規模 */ });
  return (
    <CalendarProvider value={calendar}>
      <div style={{ maxHeight: 640, overflow: 'auto' }}>
        <VirtualTimelineView />
      </div>
    </CalendarProvider>
  );
}
```

詳細な props・DOM 構造は [ビュー](./views.md) と [API リファレンス](./api.md) を
参照してください。

## 増分データ取得（遅延読込）

サーバーに大量のイベントがあり全件を渡せない場合は、表示に必要な範囲のデータだけを
段階的に取得して `setEvents` で渡します。検知の手段は 2 段階あります。

- **表示範囲の変化**（ビュー切替・前後移動・`goTo`）は `onRangeChange`
  （`useCalendar` のオプション）で検知します。詳細は
  [API リファレンス](./api.md#オプション) を参照してください
- **仮想化ウィンドウの変化**（スクロールによる可視範囲の移動）は、`VirtualListView` /
  `VirtualResourceView` / `VirtualTimelineView` の `onVisibleRangeChange` で検知します。
  表示範囲全体ではなく「いま実際に見えている」日セクション・列・行（リソース）×日
  だけが分かるため、表示範囲が広い・リソースが多い画面でも可視範囲のデータだけを
  増分取得できます

3 コンポーネントとも共通の流儀です。`onVisibleRangeChange` は可視ウィンドウの内容が
変わったときだけ 1 回発火し、マウント直後にも現在の可視範囲を 1 回通知します（初回
取得に使えます）。`rangeEnd` は翌日 0:00 の排他端で、ビューモデルの `type` がそのビュー
以外のときは発火しません。渡される内容はコンポーネントごとに異なります。

- **`VirtualListView`** — `info = { days: VisibleWindowRange; rangeStart: Date; rangeEnd: Date }`。
  日セクションの可視範囲のみで、リソース情報は含みません
- **`VirtualResourceView`** — `info = { columns: VisibleWindowRange; rangeStart: Date; rangeEnd: Date; resources: readonly (CalendarResource | null)[] }`。
  `columns` は `ResourceViewModel.columns` と同じ「リソース × 日」の直積の並び
  （`resourceViewDays` が `2` 以上のときはリソース優先・日は各リソース内で昇順）のため、
  `rangeStart`/`rangeEnd` は可視列に含まれる日付の最小〜最大から導出されます
  （先頭列・末尾列の日付とは限りません）
- **`VirtualTimelineView`** — `info = { rows: VisibleWindowRange; days: VisibleWindowRange; rangeStart: Date; rangeEnd: Date; resources: readonly (CalendarResource | null)[] }`。
  可視の日付範囲（`rangeStart`〜`rangeEnd`、`rangeEnd` は排他）と可視行のリソース一覧が
  含まれます

```tsx
import { useCallback, useRef } from 'react';
import type { TimelineVisibleRangeChangeInfo } from '@koyomi-cal/react';
import { CalendarProvider, VirtualTimelineView, useCalendar } from '@koyomi-cal/react';

function LazyTimeline() {
  const calendar = useCalendar({ initialView: 'timeline', resources, timelineDays: 30 });
  const { api } = calendar;
  // 取得済みの範囲キー（日キー × リソース）を覚えておき、同じ範囲の再取得を防ぐ
  const loadedKeys = useRef(new Set<string>());

  const handleVisibleRangeChange = useCallback(
    async (info: TimelineVisibleRangeChangeInfo) => {
      const key = `${info.days.startKey}..${info.days.endKey}:${info.rows.startKey}..${info.rows.endKey}`;
      if (loadedKeys.current.has(key)) {
        return;
      }
      loadedKeys.current.add(key);
      // 可視範囲（日付範囲 × 可視リソース）のイベントだけをサーバーから取得する
      const fetched = await fetchEvents({
        from: info.rangeStart,
        to: info.rangeEnd, // 排他（可視末尾日の翌日 0:00）
        resourceIds: info.resources.flatMap((r) => (r === null ? [] : [r.id])),
      });
      // 取得済みイベントとマージして反映する（id で重複排除）
      const current = api.getEvents();
      const known = new Set(current.map((event) => event.id));
      api.setEvents([...current, ...fetched.filter((event) => !known.has(event.id))]);
    },
    [api],
  );

  return (
    <CalendarProvider value={calendar}>
      <VirtualTimelineView onVisibleRangeChange={handleVisibleRangeChange} />
    </CalendarProvider>
  );
}
```

- 通知は「可視範囲そのもの」です。先読みしたい場合は `rangeStart`/`rangeEnd` の
  前後へ任意の日数を足して取得してください（描画の overscan とは独立です）
- スクロール中の発火は可視範囲が実際に変わったときだけですが、取得処理は上記の
  ように取得済み管理・デバウンスなどで重複を抑えることを推奨します
- 前後移動などで表示範囲自体が変わったときは `onRangeChange` も併用できます
  （`onVisibleRangeChange` も日キーの変化として発火します）

## 判断の目安

| 規模の目安 | 推奨する対策 |
| --- | --- |
| 1 日あたり数件〜十数件の予定 | 既定のビューのまま。`dayMaxEvents` の既定値で十分 |
| 特定の日に予定が集中する（月次締め作業日など） | `dayMaxEvents` を調整し、「+N 件」への集約に任せる |
| 表示する時間帯が業務時間に限定される | `slotMinTime`/`slotMaxTime` で表示時間帯を絞る |
| リストビューで数ヶ月〜数年分を一覧する | `VirtualListView` に切り替える |
| 数十〜数百件のリソースを同時に列/行表示する | `VirtualResourceView` / `VirtualTimelineView` に切り替える |
| サーバーに大量のイベントが存在する | `onRangeChange` で表示範囲を検知し、その範囲のイベントだけを `setEvents` で渡す。仮想化タイムラインでは `onVisibleRangeChange` で可視範囲だけを増分取得する（[増分データ取得（遅延読込）](#増分データ取得遅延読込)） |

## 性能ベンチマーク

リポジトリには再現可能な性能ベンチマークスイート（`bench/`、Playwright ベース）が
あります。リポジトリルートで次を実行します。

```sh
pnpm bench
```

デモアプリを本番ビルド（`vite build` + `vite preview`）で起動し、ヘッドレス
Chromium で「ストレステスト」パターン（後述）を代表構成ごとに開き直して
次の 2 つを計測します。

- **初回描画時間** — カレンダーのマウント開始からペイント完了までの時間
  （データ生成 + React レンダー + ペイントの合計）。構成 × ビューごとに
  3 回計測し、中央値を採用します
- **スクロール性能** — リソース/タイムラインビューのスクロールコンテナを
  1 フレームごとに一定量スクロールし続けたときのフレーム時間（平均・最大）。
  仮想化ビューではスクロールのたびに可視ウィンドウの再計算と DOM の
  差し替えが起きるため、その負荷を含んだ値になります

結果は `bench/results/latest.json` / `latest.md` に保存され、標準出力にも
表示されます。CI では最重量構成のみを意図的に粗い閾値と比較し
（`pnpm bench:ci`）、明確な性能リグレッションだけを検出します。

### デモの「ストレステスト」パターン

デモアプリ（`pnpm demo`）の「ストレステスト」タブ（`#/stress`）では、
スライダーでイベント件数（100〜10,000）× リソース件数（10〜1,000）を変えて
仮想化 3 ビュー（`VirtualResourceView` / `VirtualTimelineView` /
`VirtualListView`）の初回描画時間をその場で計測できます。設定は URL の
クエリ（例: `#/stress?events=10000&resources=100&view=timeline`）と同期し、
URL だけで同じ構成を再現できます。データはベンチマークと同じ決定的な
生成コードを共有しているため、デモで見た構成をそのままベンチマークの
数値と突き合わせられます。

### 実測値の例

計測値は環境（CPU・メモリ・ブラウザ）に依存する参考値です。以下は次の環境での
`pnpm bench` の実測値です。

- 計測日: 2026-07-19
- OS: Linux 6.18.5
- CPU: Intel Xeon @ 2.10 GHz × 4 コア / メモリ 16 GiB
- Node: v22.22.2 / Chromium 141（ヘッドレス）
- デモアプリの本番ビルド（`vite build`）

初回描画時間（3 回の中央値）:

| イベント件数 | リソース件数 | ビュー | データ生成 (ms) | 初回描画 (ms) |
| ---: | ---: | --- | ---: | ---: |
| 1,000 | 100 | resource | 23 | 160 |
| 1,000 | 100 | timeline | 22 | 208 |
| 1,000 | 100 | list | 22 | 149 |
| 10,000 | 100 | resource | 184 | 690 |
| 10,000 | 100 | timeline | 187 | 934 |
| 10,000 | 100 | list | 191 | 925 |
| 1,000 | 1,000 | resource | 14 | 651 |
| 1,000 | 1,000 | timeline | 14 | 362 |
| 1,000 | 1,000 | list | 15 | 222 |
| 10,000 | 1,000 | resource | 201 | 1,170 |
| 10,000 | 1,000 | timeline | 186 | 1,396 |
| 10,000 | 1,000 | list | 186 | 1,180 |

スクロール性能（90 フレーム連続スクロール。ディスプレイ同期の 60 fps 環境では
平均フレーム約 16.7 ms が下限）:

| イベント件数 | リソース件数 | ビュー | スクロール量 | 平均フレーム (ms) | 最大フレーム (ms) |
| ---: | ---: | --- | --- | ---: | ---: |
| 1,000 | 100 | timeline | 縦 48px + 横 96px / フレーム | 16.5 | 17.6 |
| 1,000 | 100 | resource | 横 96px / フレーム | 16.6 | 19.9 |
| 10,000 | 100 | timeline | 縦 48px + 横 96px / フレーム | 16.6 | 30.2 |
| 10,000 | 100 | resource | 横 96px / フレーム | 16.5 | 18.2 |
| 1,000 | 1,000 | timeline | 縦 48px + 横 96px / フレーム | 16.6 | 39.5 |
| 1,000 | 1,000 | resource | 横 96px / フレーム | 16.5 | 21.2 |
| 10,000 | 1,000 | timeline | 縦 48px + 横 96px / フレーム | 16.5 | 17.8 |
| 10,000 | 1,000 | resource | 横 96px / フレーム | 16.5 | 40.4 |

いずれの構成でも平均フレーム時間は 60 fps の 1 フレーム（約 16.7 ms）に
収まっており、仮想化ビューのスクロールは件数を増やしてもフレーム落ちなしで
維持されます。初回描画時間はイベント件数・リソース件数にほぼ比例して増え、
最重量の 10,000 件 × 1,000 リソースでも 1.5 秒未満です。

### 編集操作性能の実測値の例

デモの「ストレステスト」パターンには、`createEvent`/`updateEvent`/`deleteEvent`
を 200 件ずつ一括実行して所要時間を計測する「編集操作を計測」ボタンがあります。
`pnpm bench` はこの操作も代表構成ごとに計測します。以下はクラウドコンテナ環境
での実測値です。

- 計測日: 2026-07-29
- 計測環境: クラウドコンテナ（Linux 6.18.5、Intel Xeon @ 2.10 GHz × 4 コア、
  メモリ 16 GiB）
- Node: v22.22.2 / Chromium 149（ヘッドレス）
- デモアプリの本番ビルド（`vite build`）

編集操作（3 回の中央値、いずれも 200 件一括実行）:

| イベント件数 | リソース件数 | 一括件数 | 作成 (ms) | 更新 (ms) | 削除 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 100 | 200 | 25.9 | 55.0 | 44.8 |
| 10,000 | 100 | 200 | 147.5 | 512.6 | 490.9 |
| 1,000 | 1,000 | 200 | 25.3 | 56.3 | 44.9 |
| 10,000 | 1,000 | 200 | 149.8 | 510.1 | 487.4 |

作成・更新・削除いずれの所要時間もイベント総件数にほぼ比例して増え、リソース
件数にはほとんど影響されません。最重量の 10,000 件 × 1,000 リソースでも、
200 件一括実行の合計所要時間（作成 + 更新 + 削除）は約 1.1 秒です。

## バンドルサイズと tree-shaking

`@koyomi-cal/react` は 1 ソースモジュール = 1 ファイルの ESM として公開され、
`package.json` の `sideEffects` で CSS 以外のファイルに副作用がないことを宣言して
います。このため、すべての公開 API をトップレベルエントリ（`@koyomi-cal/react`）
から import しても、実際に使った分だけがアプリのバンドルに含まれます（未使用の
ビューコンポーネント・フック・ユーティリティはバンドラの tree-shaking で除外
されます）。ビュー別のサブパスエントリはなく、import 経路の使い分けは不要です。
React に依存しない処理だけを使う場合のみ
[`@koyomi-cal/react/core`](./api.md#koyomi-calreactcorereact-非依存の単体エントリ)
を使います。

### 実測値の例

最小アプリを esbuild 0.28.1 でバンドル（minify）した際のライブラリ寄与分
（`react` / `react-dom` を external にした値。計測日: 2026-07-29）です。

| import する範囲 | raw | gzip |
| --- | ---: | ---: |
| 全ビュー + Toolbar（`CalendarView` / `Toolbar` / `useCalendar`） | 283.1 KB | 78.4 KB |
| 月ビューのみ（`MonthView` / `CalendarProvider` / `useCalendar`） | 152.5 KB | 46.0 KB |
| コアのみ（`@koyomi-cal/react/core` の `createCalendar`） | 104.8 KB | 31.4 KB |

次のものは import する範囲によらず、`createCalendar`（`useCalendar` の内部）を
使う限り常にバンドルに含まれます。tree-shaking では除外されない設計上の固定費
として見積もってください。

- **RRULE 展開エンジン**（バンドル済みの `rrule`、gzip 約 13 KB）。イベントの
  展開は `rrule` の有無によらず同じ経路を通るためです
- **全ビューのビューモデルビルダー**（`buildMonthViewModel` 等、gzip 約 4 KB）。
  `api.setOptions({ view })` でいつでもビューを切り替えられるようにするためです
- **中央メッセージカタログ**（`ja` / `en` の両方、gzip 約 5 KB）

### 再現方法

リポジトリルートで次を実行すると、`scripts/bundle-fixtures/` の最小アプリ
（月ビューのみ / 全ビュー）をビルド済み dist に対してバンドルし、未使用ビューが
除外されていることと、ライブラリ寄与分の gzip サイズが閾値以下であることを
検証できます（CI でも同じ検証を実行します）。

```sh
pnpm build && pnpm bundle:check
```

## 関連ページ

- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [API リファレンス](./api.md)
