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
- **仮想化ウィンドウの変化**（スクロールによる可視範囲の移動）は、
  `VirtualTimelineView` の `onVisibleRangeChange` で検知します。表示範囲全体では
  なく「いま実際に見えている行（リソース）× 日」だけが分かるため、表示範囲が
  広い・リソースが多い画面でも可視範囲のデータだけを増分取得できます

`onVisibleRangeChange` は可視ウィンドウの内容（行・日それぞれのキー範囲）が変わった
ときだけ 1 回発火し、マウント直後にも現在の可視範囲を 1 回通知します（初回取得に
使えます）。通知には可視の日付範囲（`rangeStart`〜`rangeEnd`、`rangeEnd` は排他）と
可視行のリソース一覧が含まれます。

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

## 関連ページ

- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [API リファレンス](./api.md)
