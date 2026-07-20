# インタラクション（作成・移動・リサイズ）

クリック・ドラッグ・キーボードによる予定の作成・移動・リサイズと、それらに紐づくコールバックについて説明します。Koyomi はダイアログやポップアップなどの UI を提供しないヘッドレスライブラリなので、確定後の見た目（作成ダイアログや詳細パネルなど）はここで説明するコールバックを起点にアプリケーション側で実装します。

## クリック・ドラッグでの予定作成

空き領域のクリック・ドラッグで範囲が選択されると `onSelectRange` が呼ばれます。**省略した場合**は既定動作として、`messages.common.untitledEvent`（既定 `'(タイトルなし)'`）のタイトルの予定がその場で即時作成されます（`createEvent` 相当）。

コールバックには `RangeSelection` が渡されます。

- `range`（`DateRange`） — 選択された日時範囲（`end` は排他的）
- `allDay`（`boolean`） — 終日枠（月ビューのセル・終日行）での選択なら `true`

### 時間グリッド（週/日ビュー）

- **範囲ドラッグ** — ドラッグした始点〜終点がそのまま選択範囲になる（`snapMinutes` 単位でスナップ）
- **クリックのみ（移動なし）** — `defaultEventMinutes` 分の長さの範囲になる

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'week', defaultEventMinutes: 30 });

  function handleSelectRange(selection: RangeSelection) {
    // ここでダイアログを開く、または直接 API で作成する
    calendar.api.createEvent({
      title: '新しい予定',
      start: selection.range.start,
      end: selection.range.end,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 10:00 から 11:00 まで範囲ドラッグすると
//   handleSelectRange({ range: { start: 10:00, end: 11:00 }, allDay: false }) が呼ばれる
// - ドラッグせずクリックだけした場合は、defaultEventMinutes（ここでは30分）の
//   長さの範囲（例: 10:00 なら { start: 10:00, end: 10:30 }）で呼ばれる
// - onSelectRange を指定すると、既定の即時作成は行われない
```

### 月ビュー・終日行

月ビューの日セル、および週/日ビューの終日行は**日単位**のドラッグになります。1 日だけクリックした場合も、2 日以上にまたがってドラッグした場合も、その日範囲がそのまま選択され、`selection.allDay` は常に `true` になります。

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'month' });

  function handleSelectRange(selection: RangeSelection) {
    calendar.api.createEvent({
      title: '新しい予定',
      start: selection.range.start,
      end: selection.range.end,
      allDay: selection.allDay,
    });
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onSelectRange: handleSelectRange }}>
      <MonthView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 日セルをドラッグして離すと handleSelectRange が呼ばれ、selection.allDay は true になる
// - onSelectRange を省略した場合は、既定動作として終日イベントがその場で即時作成される
```

## ドラッグ移動・リサイズ

予定本体をドラッグすると**移動**、ハンドルをドラッグすると**リサイズ**になります。移動・リサイズが確定すると、ライブラリが変更を適用したうえで `onEventChange` を呼びます。

- **移動** — 時間グリッドでは列をまたいだ移動が可能（`snapMinutes` 単位でスナップ）。月ビュー・終日行では日単位の移動になり、期間と現地時刻（時間指定イベントの場合）が維持される
- **リサイズ（時間グリッド）** — 予定の**下端**ハンドルで終了時刻、**上端**ハンドルで開始時刻を変更できる。いずれも最小 `snapMinutes` 分の長さが保たれる。日をまたいで表示が分割されている場合、分割された端（`continuesBefore` / `continuesAfter`）にはハンドルが出ない
- **リサイズ（月ビュー・終日行の帯）** — 帯セグメントの**左右端**ハンドルで開始日・終了日を日単位で変更できる。最低 1 日分の長さが保たれ、時間指定の複数日イベントでは現地時刻を維持したまま日数だけが変わる
- **終日 ⇔ 時間指定の変換** — 週/日ビューで、時間指定の予定を上部の終日行までドラッグすると**終日イベントに変換**され、終日行の予定を時間グリッドへドラッグすると**時間指定イベント**（ドロップ位置の時刻から `defaultEventMinutes` 分）**に変換**されます（Google カレンダーと同じ操作感）
- **`editable: false`** — 表示・クリックは通常どおりできるが、移動・リサイズ・**キーボードでの削除（Delete/Backspace）**はすべて無効になる。リサイズハンドル自体が描画されない
- **タッチデバイス** — デフォルトテーマがドラッグ起点の要素に `touch-action: none` を設定しているため、ドラッグがスクロールに奪われません。独自 CSS でテーマを構築する場合は同様の設定が必要です（[テーマとスタイリング](./theming.md) 参照）。ブラウザがポインタを中断した場合（`pointercancel`）はドラッグが安全にキャンセルされます
- **オートスクロール** — 時間グリッドの縦スクロール領域では、ドラッグ中にポインタが上下端へ近づくと自動でスクロールします
- **表示時間帯の制限（slotMinTime/slotMaxTime）** — ポインタでの作成・移動・リサイズ・終日⇔時間指定変換は表示時間帯 `[slotMinTime, slotMaxTime)` の範囲内にクランプされます（範囲外の領域自体が描画されないため）。矢印キーによる移動・リサイズはクランプされません（詳細は [ビュー: 表示時間帯](./views.md#表示時間帯slotmintimeslotmaxtime) を参照）

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent, EventChange } from '@koyomi-cal/react';

const events: CalendarEvent[] = [
  { id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
  // editable: false の予定は表示・クリックのみ可能。ドラッグでは動かせない
  { id: '2', title: '固定の予定', start: '2026-07-15T13:00', end: '2026-07-15T14:00', editable: false },
];

function App() {
  const calendar = useCalendar({ initialView: 'week', events });

  function handleEventChange(change: EventChange) {
    // change.occurrence: 変更対象のオカレンス
    // change.newRange: 変更後の日時範囲
    // change.scope: 繰り返し予定に適用したスコープ（単発なら null）
    // change.changes: 影響を受けた各イベントの before/after 一覧（undo 用途。後述）
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onEventChange: handleEventChange }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「会議」をドラッグして移動すると、移動後の範囲で calendar.api.getEvents() が更新され、
//   handleEventChange({ occurrence, newRange, allDay: false, scope: null }) が呼ばれる
// - 下端のハンドルをドラッグすると終了時刻だけが変わる（開始時刻は固定）
// - 「固定の予定」はドラッグしても位置が変わらず、リサイズハンドルも描画されない
```

`onEventChange` はドラッグ操作（`useDayDrag` / `useTimeGridDrag`、およびそれらを内部で使うビルトインコンポーネント）による移動・リサイズが確定したときにのみ呼ばれます。`calendar.api.updateEvent(...)` を直接呼んだ場合は呼ばれません。

`change.changes` は `useCalendarHistory` の `history.push(change.changes)` にそのまま渡すことで undo 履歴に積めます（`onEventDelete` の `deletion.changes` も同様）。undo（元に戻す）UI の実装方法は [予定の管理](./events.md#undo元に戻すを実装する) を参照してください。

## 予定要素への追加通知（ダブルクリック・コンテキストメニュー・ホバー）

`onEventClick` / `onEventChange` に加えて、予定要素に対する次の 4 つの通知を受け取れます。すべてのイベントビュー（月・複数月ビューの帯セグメント、週/日ビュー、リソースビュー、タイムラインビュー、リストビュー）の予定要素に配線されます。

| コールバック | 呼ばれるタイミング（DOM イベント） |
| --- | --- |
| `onEventDoubleClick` | 予定要素がダブルクリックされたとき（`dblclick`） |
| `onEventContextMenu` | 予定要素で右クリック等のコンテキストメニュー操作をしたとき（`contextmenu`） |
| `onEventHover` | ポインタが予定要素に乗ったとき（`pointerenter`） |
| `onEventHoverEnd` | ポインタが予定要素から離れたとき（`pointerleave`） |

```tsx
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent, EventOccurrence } from '@koyomi-cal/react';

const events: CalendarEvent[] = [
  { id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
];

function App() {
  const calendar = useCalendar({ initialView: 'month', events });

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{
        onEventDoubleClick: (occurrence: EventOccurrence) => {
          // 詳細表示や編集ダイアログを直接開く
        },
        onEventContextMenu: (occurrence: EventOccurrence, nativeEvent: MouseEvent) => {
          // 独自のコンテキストメニューを出す場合は自分で preventDefault する
          nativeEvent.preventDefault();
        },
        onEventHover: (occurrence: EventOccurrence) => {
          // ツールチップを表示する
        },
        onEventHoverEnd: (occurrence: EventOccurrence) => {
          // ツールチップを閉じる
        },
      }}
    >
      <MonthView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「会議」をダブルクリックすると onEventDoubleClick が呼ばれる
// - 「会議」を右クリックしてもブラウザ既定のコンテキストメニューは自動では消えない
//   （nativeEvent.preventDefault() を呼ぶかどうかはアプリ側が決める）
// - ポインタが「会議」に乗ると onEventHover、離れると onEventHoverEnd が呼ばれる
```

**`onEventContextMenu` は `preventDefault` しません**: ライブラリはコールバックを呼ぶだけで、ブラウザ既定のコンテキストメニューの抑制は行いません。カスタムメニューを出す場合はアプリ側で `nativeEvent.preventDefault()` を呼んでください。

**未指定時は DOM リスナー自体を付けない**: これら 4 つはいずれも省略可能で、省略した場合は対応する要素に `onDoubleClick` / `onContextMenu` / `onPointerEnter` / `onPointerLeave` の DOM props 自体が付きません。

## リソースビュー・タイムラインビューのドラッグ操作

リソースビュー（`useResourceGridDrag`）・タイムラインビュー（`useTimelineDrag`）は、時間の変更に加えて**リソース間の移動**をドラッグで行えます。それぞれ次の 2 軸を同時に扱います。

| ビュー | 時間の軸 | リソースの軸 |
| --- | --- | --- |
| リソースビュー | 縦（列内の上下） | 横（列＝リソース × 日） |
| タイムラインビュー | 横（行内の左右） | 縦（行＝リソース） |

- **移動** — ドラッグした先の時間とリソースの両方が同時に変わります。確定時は、時間の変更とリソース割当の変更を**1 つのパッチに合成した 1 回の `updateEvent`** として適用します（`onEventChange` には移動先レーンの `resourceId` 付きの `EventChange` が渡されます）。リソースだけが変わり時間が変わらない操作（列/行をまたぐだけの移動）も同じ経路です。リソースビューの複数日表示（`resourceViewDays` が `2` 以上）では、別の日の列への移動が日付の変更（日数シフト）として合成されます
- **複数リソース割当（`resourceIds`）の予定** — 割当先の各レーンに同一オカレンスが表示され、レーン間の移動では**操作した（掴んだ）レーンの割当だけ**が移動先に変わります（他のレーンの割当は保持されます）。移動先がすでに割当済みのレーンなら割当は統合されます（重複しません）。詳細な規則は [予定の管理: 複数リソース割当](./events.md#複数リソース割当resourceids) を参照
- **リサイズ** — 時間のみが変わり、リソースは不変です（既存の時間グリッドと同じ規則。リソースビューの複数日表示でも対象日は変わりません）
- **未割り当てへの移動** — 未割り当てレーン（`resource: null`）へ移動すると、単一割当の予定では `{ resourceId: undefined }` のパッチが発行されます（`CalendarEventPatch` の削除セマンティクスに従い、`resourceId` フィールドが削除されます）。複数リソース割当の予定では操作したレーンの割当だけが `resourceIds` から取り除かれます。未割り当てレーンが存在しない場合（`unassignedLane: 'auto'` で未割り当ての予定が 1 件も無いとき）はドロップ先が無いため、この操作はできません。運用したい場合は `unassignedLane: 'always'` を指定してください（詳細は [ビュー](./views.md#年複数月リソースタイムラインビューを有効にするopt-in) を参照）
- **既定作成（`onSelectRange` 未指定時の即時作成）** — 選択したレーンの `resourceId` が `createEvent` の入力に含まれます（未割り当てレーンでは `resourceId` を付けません）
- **終日行/終日の帯** — リソースビューの終日行はクリックでその列の日 1 日分の終日イベントを作成でき、ドラッグで列間の移動ができます（リソース変更と日数シフトの合成。リサイズはありません）。タイムラインの終日の帯は日単位スナップで横移動できます
- **allDay ⇔ 時間指定の変換** — 週/日ビューにあるような越境変換ドラッグは、リソース/タイムラインビューでは提供しません
- 繰り返し予定は既存の `resolveRecurringScope` フロー（下記）にそのまま乗ります（リソース移動も this / thisAndFollowing / all の選択対象）

**予定要素にフォーカスした状態（リソース/タイムラインビュー）:**

| キー | リソースビュー | タイムラインビュー |
| --- | --- | --- |
| `Enter` / `Space` | `onEventClick` 相当のクリック | 同左 |
| `Delete` / `Backspace` | オカレンスを削除（繰り返しはスコープ解決） | 同左 |
| `↑` / `↓` | ∓/± `snapMinutes` 分の移動（時間の軸） | 隣の行（リソース）への移動 |
| `←` / `→` | 隣の列（リソース × 日）への移動 | ∓/± `snapMinutes` 分の移動（時間の軸。終日の帯、または `timelineScale` が `'hour'` 以外のときは ∓/± 1 日） |
| `Shift+↑` / `Shift+↓` | 終了時刻を ∓/± `snapMinutes` 分リサイズ | — |
| `Shift+←` / `Shift+→` | — | 終了時刻を ∓/± `snapMinutes` 分リサイズ（`timelineScale` が `'hour'` 以外のときは終了日を ∓/± 1 日） |

矢印キーの割当は「画面上でその方向に動く」という既存ビューと同じ原則に従います。リソースビューは列＝リソース × 日なので `←`/`→` が列移動（複数日表示では同一リソース内の隣の日 → リソース境界では隣のリソースの端の日、の順。日の差分は日数シフトとして適用）、タイムラインビューは行＝リソースなので `↑`/`↓` が行移動になり、ビューごとに軸が入れ替わりますが、いずれも視覚的な配置と一致する割当です。

複数リソース割当の予定は割当先の各レーンに表示されるため、矢印キーによるレーン移動もフォーカスしている（操作した）レーンの割当だけを対象にします。

`CalendarResource.parentId` を使ってリソースを折りたたんでいる場合、レーン移動のキー（タイムラインの `↑`/`↓`・リソースビューの `←`/`→`）は非表示（祖先が折りたたまれている）行/列を候補から除外します。折りたたまれた親リソース自身は通常の行/列として作成・移動・リサイズの対象になり続けます（詳細は [ビュー: リソースの階層グルーピング](./views.md#リソースの階層グルーピングparentid折りたたみ) を参照）。

## 繰り返し予定の操作時のスコープ解決

繰り返し予定を移動・リサイズ・削除・更新しようとすると、`resolveRecurringScope(occurrence, action)` が呼ばれ、Google カレンダーの「この予定のみ / これ以降のすべての予定 / すべての予定」に相当する適用範囲を問い合わせます。`action` は `'move' | 'resize' | 'delete' | 'update'`、戻り値は `Promise<RecurringEditScope | null>` です。

- 戻り値が `'this'` / `'thisAndFollowing'` / `'all'` — その範囲で変更が適用される
- 戻り値が `null` — 操作全体がキャンセルされ、予定は変更されない
- **省略時**は常に `'this'`（この予定のみ）として扱われる

実際のアプリではダイアログを表示し、ユーザーの選択で `resolve` するのが典型的な実装です。ここでは実装を簡略化し、常に同じ値を返す例で挙動を示します。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { RecurringEditScope } from '@koyomi-cal/react';

// 実際にはここでダイアログを表示し、ユーザーの選択で resolve する。
// （この例では簡略化のため、常に「これ以降のすべての予定」を選んだことにする）
async function resolveRecurringScope(): Promise<RecurringEditScope | null> {
  return 'thisAndFollowing';
}

function App() {
  const calendar = useCalendar({ initialView: 'week' });
  return (
    <CalendarProvider value={calendar} callbacks={{ resolveRecurringScope }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 繰り返し予定をドラッグで移動しようとすると resolveRecurringScope(occurrence, 'move') が呼ばれる
// - 'thisAndFollowing' が返るとそのオカレンス以降に対して変更が適用され、
//   calendar.api.getEvents() の件数が変化する（繰り返し元の打ち切りと新規イベントの追加）
```

ダイアログでキャンセルされた場合は `null` を返します。この場合、ドラッグは確定されず `calendar.api.getEvents()` は操作前と同じ内容のまま変わりません。

```ts
async function resolveRecurringScope(): Promise<RecurringEditScope | null> {
  return null; // ユーザーがダイアログをキャンセルした場合
}

// 期待される動作:
// - 繰り返し予定をドラッグで移動しようとしても変更は適用されない
// - calendar.api.getEvents() は操作前と同じ内容のまま変わらない
```

適用結果（`rrule` の打ち切りや例外イベントの追加など）の詳細は [繰り返し予定](./recurrence.md) を参照してください。

### 完成形: 適用範囲選択ダイアログ（コピー&ペースト用）

実際に動作する完成形が以下です（デモアプリ `apps/demo/src/ScopeDialog.tsx` で実際に動作しているコードそのものです）。Google カレンダーの「この予定 / これ以降のすべての予定 / すべての予定」に相当する 3 択を、`<dialog>` 要素の `showModal()` で提示します。

```tsx
import type { EventOccurrence, RecurringEditScope } from '@koyomi-cal/react';
import { type ReactElement, useEffect, useRef } from 'react';

/** スコープ選択が要求された操作の種類。 */
export type ScopeAction = 'move' | 'resize' | 'delete' | 'update';

/** `ScopeDialog` が表示すべき要求内容。 */
export interface ScopeRequest {
  /** 対象のオカレンス。 */
  occurrence: EventOccurrence;
  /** 操作の種類。 */
  action: ScopeAction;
}

/** `ScopeDialog` の props。 */
export interface ScopeDialogProps {
  /** 表示中の要求。`null` なら非表示。 */
  request: ScopeRequest | null;
  /**
   * 選択結果を通知する。
   * ユーザーがキャンセル（Esc・背景クリック・キャンセルボタン）した場合は `null`。
   */
  onResolve: (scope: RecurringEditScope | null) => void;
}

/** 操作の種類を日本語の動詞に変換する。 */
function actionLabel(action: ScopeAction): string {
  switch (action) {
    case 'move':
      return '移動';
    case 'resize':
      return '時間の変更';
    case 'delete':
      return '削除';
    case 'update':
      return '変更';
  }
}

/**
 * 繰り返し予定の適用範囲を選択させるダイアログ。
 *
 * `<dialog>` 要素を使い、`request` が非 `null` になると `showModal()` で開く。
 * Esc キー・背景クリックでキャンセル扱い（`onResolve(null)`）になる。
 */
export function ScopeDialog(props: ScopeDialogProps): ReactElement {
  const { request, onResolve } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // 選択ボタン経由で close() した場合に、close イベントでの
  // 「キャンセル扱い」への二重通知を防ぐためのフラグ。
  const resolvedRef = useRef(false);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return;
    }
    if (request !== null && !dialogEl.open) {
      dialogEl.showModal();
    } else if (request === null && dialogEl.open) {
      dialogEl.close();
    }
  }, [request]);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return undefined;
    }
    /** Esc キー・背景クリックによるネイティブな close はキャンセル扱いにする。 */
    function handleClose(): void {
      if (!resolvedRef.current) {
        onResolve(null);
      }
      resolvedRef.current = false;
    }
    dialogEl.addEventListener('close', handleClose);
    return () => dialogEl.removeEventListener('close', handleClose);
  }, [onResolve]);

  /** 選択肢ボタンが押されたときの処理。 */
  function choose(scope: RecurringEditScope): void {
    resolvedRef.current = true;
    onResolve(scope);
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef}>
      {request !== null && (
        <div>
          <h2>繰り返し予定の{actionLabel(request.action)}</h2>
          <p>
            「{request.occurrence.event.title}」は繰り返し予定です。どの範囲に適用しますか？
          </p>
          <div>
            <button type="button" onClick={() => choose('this')}>
              この予定のみ
            </button>
            <button type="button" onClick={() => choose('thisAndFollowing')}>
              これ以降のすべての予定
            </button>
            <button type="button" onClick={() => choose('all')}>
              すべての予定
            </button>
          </div>
          <div>
            <button type="button" onClick={() => dialogRef.current?.close()}>
              キャンセル
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// 使用例:
// const [request, setRequest] = useState<ScopeRequest | null>(null);
// const resolverRef = useRef<((scope: RecurringEditScope | null) => void) | null>(null);
//
// async function resolveRecurringScope(occurrence: EventOccurrence, action: ScopeAction) {
//   return new Promise<RecurringEditScope | null>((resolve) => {
//     resolverRef.current = resolve;
//     setRequest({ occurrence, action });
//   });
// }
//
// <CalendarProvider value={calendar} callbacks={{ resolveRecurringScope }}>
//   <TimeGridView />
// </CalendarProvider>
// <ScopeDialog
//   request={request}
//   onResolve={(scope) => {
//     const resolve = resolverRef.current;
//     resolverRef.current = null;
//     setRequest(null);
//     resolve?.(scope);
//   }}
// />

// 期待される動作:
// - 繰り返し予定をドラッグで移動しようとすると request が設定され、showModal() でダイアログが開く
// - 「この予定のみ」等のボタンを押すと選択した scope で Promise が解決し、ダイアログが閉じる
// - Esc キー・背景クリックで閉じた場合は null で解決される（操作全体がキャンセルされる）
```

## 宣言的な重なり・配置制約（eventOverlap / eventConstraint）

`CalendarOptions.eventOverlap`（既定 `true`）/ `eventConstraint`（既定は未指定）で、予定の重なりやドロップ先を宣言的に制限できます。イベント個別に `CalendarEvent.overlap` / `constraint` を指定すると、そのイベントについてはオプションの既定値を上書きできます。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import '@koyomi-cal/react/theme.css';

const events = [
  { id: '1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
];

function App() {
  const calendar = useCalendar({
    initialView: 'week',
    events,
    eventOverlap: false,
    eventConstraint: 'businessHours',
    businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
  });
  return (
    <CalendarProvider value={calendar}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「会議」に重なる位置へ別の予定をドラッグしようとすると、プレビューが
//   data-koyomi-invalid="true" 付きで表示され、離しても位置は戻る（onEventChange は呼ばれない）
// - 営業時間外（9:00〜18:00 の外）へのドラッグも同様に無効表示・拒否される
```

- **eventOverlap** — `false` にすると、移動・リサイズ・作成の結果が既存イベントと重なる操作を拒否します。判定対象は同一レーンの全オカレンス（リソース/タイムラインビューは割当先レーン。`resourceIds` で複数リソースに割り当てられている予定は割当先の各レーンでブロッカーになります、それ以外のビューはレーン区分なし）で、`slotMinTime`/`slotMaxTime` の表示時間帯外や表示範囲外にあって画面に描画されていないオカレンスも含みます（矢印キーによる表示外への移動もすり抜けられません）。時間指定・終日は絶対時刻の区間 `[start, end)` として統一的に比較します。判定は「動かしている側」と「重ねられる側」双方の実効値（イベント個別の `overlap` が優先、省略時は `eventOverlap`）を見て、どちらかが `false` なら拒否します
- **eventConstraint** — `'businessHours'` を指定すると `businessHours` の範囲内にのみドロップを許可します。`BusinessHoursRule` の配列を渡すと独自の範囲を指定できます（`businessHours` と同形式）。**終日イベントには適用されません**（時間帯の制約は時間指定イベントのみが対象）。`eventConstraint: 'businessHours'` を指定したのに `businessHours` が未設定（既定 `[]`）だと常に無効になる点に注意してください（この組み合わせは開発ビルドでは `useCalendar` が `console.warn` で一度だけ警告します）。判定は日ごとに行われ、対象範囲の各日がルールに完全に収まっている必要があります。日をまたぐ時間指定イベントを許可するには、初日側の `endTime` に日の終端を表す `'24:00'` を指定したルールで各日を途切れなくカバーします（例: `[{ daysOfWeek: [0,1,2,3,4,5,6], startTime: '00:00', endTime: '24:00' }]` はすべての時間指定イベントを許可します）
- **判定順序** — 宣言的制約（`eventOverlap`/`eventConstraint`） → `onBeforeEventChange`/`onBeforeSelectRange`/`onBeforeEventDelete` → `resolveRecurringScope` の順に判定されます。宣言的制約で拒否された場合は適用前フックを呼ばずに即座に中断します
- **拒否時の挙動** — 適用前フックが `false` を返した場合と同じくサイレントです（`onEventChange`/`onSelectRange` は呼ばれず、ドラッグはその場で終了します）
- **プレビューへの反映** — ドラッグ中のプレビューは違反時に `data-koyomi-invalid="true"` が付き、デフォルトテーマでは `--koyomi-invalid-color`（既定 `#d93025`、ダークテーマは `#f28b82`）でハイライトされます（`day-selection`/`timegrid-preview`/`timeline-preview`/`resource-allday-cell` が対象。適用前フックの判定とは異なり、こちらはプレビュー表示にも反映されます）

## 適用前フックで操作を拒否する

`onBeforeEventChange` / `onBeforeSelectRange` / `onBeforeEventDelete` は、確定前の操作を「適用するかどうか」自体を判定できるフックです（FullCalendar の `eventAllow` / `selectAllow` に相当）。`resolveRecurringScope` が「どの範囲に適用するか」を決めるのに対し、これらは「そもそも適用してよいか」を決めます。

- `onBeforeEventChange?: (proposal: EventChangeProposal) => boolean | Promise<boolean>` — ドラッグ移動・リサイズ・終日⇔時間指定変換の適用前に呼ばれる。`false`（または `Promise<false>` に解決される値）を返すと変更は適用されず、`onEventChange` も呼ばれない。ドラッグ操作はその場で静かに終了し、キーボード操作（矢印キー等）では何も起きない
- `onBeforeSelectRange?: (selection: RangeSelection) => boolean | Promise<boolean>` — 空き領域のクリック・ドラッグによる範囲選択の適用前に呼ばれる。`false` を返すと `onSelectRange` は呼ばれない（省略時の既定の即時作成も行われない）
- `onBeforeEventDelete?: (occurrence: EventOccurrence) => boolean | Promise<boolean>` — キーボード操作（Delete/Backspace）による削除の適用前に呼ばれる。`false` を返すと削除されず `onEventDelete` も呼ばれない。確認ダイアログなど、ユーザーの応答を待つ必要がある UI 向けに `Promise` を返せる（`window.confirm` 相当の非同期確認）

いずれも省略時は常に許可（`true`）として扱われます。

```tsx
import { CalendarProvider, TimeGridView, useCalendar } from '@koyomi-cal/react';
import type { EventChangeProposal } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'week' });

  function onBeforeEventChange(proposal: EventChangeProposal): boolean {
    // 例: 終了済みの予定は移動・リサイズを禁止する
    return proposal.occurrence.event.title !== '確定済み';
  }

  async function onBeforeEventDelete(): Promise<boolean> {
    // 確認ダイアログの結果を待ってから削除を許可・拒否する
    return window.confirm('この予定を削除しますか？');
  }

  return (
    <CalendarProvider value={calendar} callbacks={{ onBeforeEventChange, onBeforeEventDelete }}>
      <TimeGridView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - タイトルが「確定済み」の予定をドラッグしても、移動・リサイズは適用されず
//   onEventChange も呼ばれない（ドラッグはその場で静かに終了する）
// - Delete キーを押すと確認ダイアログが表示され、キャンセルすると削除されない
```

**判定の順序**: 繰り返し予定の操作では、`onBeforeEventChange` / `onBeforeEventDelete` は `resolveRecurringScope` より**前**に判定されます。拒否された場合はスコープの問い合わせ自体が行われません（ダイアログが不要に開くのを防げます）。

**配線される操作**: `useDayDrag` / `useTimeGridDrag` / `useResourceGridDrag` / `useTimelineDrag`（およびそれらを内部で使うビルトインコンポーネント）の、移動・リサイズ・終日⇔時間指定変換・作成範囲の確定・キーボード操作・削除のすべての経路で判定されます。

**プレビュー表示は反映されない**: ドラッグ中に表示されるプレビュー（ハイライト）は、これらの適用前フックの結果を反映しません。判定は `pointerup` などで操作が確定するタイミングでのみ行われるため、「ドラッグ中は移動できそうに見えるが、離した瞬間に元の位置へ戻る」という見た目になります。ドラッグ中に禁止領域を視覚的に示したい場合は、アプリ側で `calendar.state.dragPreview` を見て独自にスタイリングしてください。

## コールバックのまとめ

| コールバック | 呼ばれるタイミング | 省略時の既定動作 |
| --- | --- | --- |
| `onSelectRange` | 空き領域のクリック・ドラッグで範囲選択が確定したとき | `messages.common.untitledEvent`（既定 `'(タイトルなし)'`）で即時作成する |
| `onBeforeSelectRange` | 範囲選択の確定前（`onSelectRange` より前） | 常に許可する（`true`） |
| `onEventClick` | 予定がクリック、または Enter・Space で選択されたとき | 何もしない |
| `onEventChange` | ドラッグ・キーボードによる移動・リサイズが確定し、変更が適用された後 | （通知のみ。変更の適用自体は常にライブラリが行う。`changes` に影響を受けた各イベントの before/after が入り undo に使える） |
| `onBeforeEventChange` | 移動・リサイズ・終日⇔時間指定変換の適用前（`resolveRecurringScope` より前） | 常に許可する（`true`） |
| `onEventDelete` | キーボード（Delete/Backspace）による削除が適用された後 | （通知のみ。undo UI やトーストの起点に使える。`changes` に影響を受けた各イベントの before/after が入る） |
| `onBeforeEventDelete` | キーボード削除の適用前（`resolveRecurringScope` より前） | 常に許可する（`true`） |
| `onError` | インタラクション中の非同期処理（スコープ解決や適用）が例外を投げたとき | `console.error` に出力する |
| `resolveRecurringScope` | 繰り返し予定の移動・リサイズ・削除・更新の適用範囲を決めるとき | 常に `'this'`（この予定のみ） |
| `onOverflowClick` | 月ビューの「+N 件」がクリックされたとき。第 2 引数で非表示のオカレンス一覧（`hiddenOccurrences`）、第 3 引数（`details`）で表示中のオカレンス一覧（`visibleOccurrences`）を受け取れる | その日の日ビューに切り替える |
| `onDayNumberClick` | 月ビュー・複数月ビュー・年ビュー・週/日ビューの日番号ボタンがクリックされたとき | その日の日ビューに切り替える |
| `onEventDoubleClick` | 予定要素がダブルクリックされたとき | 何もしない（未指定時は `onDoubleClick` リスナー自体を付けない） |
| `onEventContextMenu` | 予定要素でコンテキストメニュー操作をしたとき（`preventDefault` はしない） | 何もしない（未指定時は `onContextMenu` リスナー自体を付けない） |
| `onEventHover` | ポインタが予定要素に乗ったとき（`pointerenter`） | 何もしない（未指定時は `onPointerEnter` リスナー自体を付けない） |
| `onEventHoverEnd` | ポインタが予定要素から離れたとき（`pointerleave`） | 何もしない（未指定時は `onPointerLeave` リスナー自体を付けない） |

## キーボードショートカット

`useCalendarShortcuts` を使うと、Google カレンダー準拠のキーボードショートカットが有効になります。`document` への `keydown` を監視するため、`CalendarProvider` の外でも（コンポーネントツリーのどこでも）呼び出せます。

```tsx
import { useCalendar, useCalendarShortcuts } from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar();
  useCalendarShortcuts({
    calendar,
    onCreate: () => {
      // C キーで呼ばれる。作成ダイアログを開くなど
    },
  });
  return <div>{calendar.state.view}</div>;
}

// 期待される動作:
// - W キーを押すと calendar.state.view が 'week' になる
// - C キーを押すと onCreate が呼ばれる
// - <input> にフォーカスがある状態で W キーを押しても view は変わらない
```

| キー | 動作 |
| --- | --- |
| `M` | 月ビューに切り替え |
| `W` | 週ビューに切り替え |
| `D` | 日ビューに切り替え |
| `A` | リストビューに切り替え |
| `Y` | 年ビューに切り替え（`views` オプションに `'year'` を含めた場合のみ。既定では無効） |
| `Q` | 複数月ビューに切り替え（`views` オプションに `'multiMonth'` を含めた場合のみ。既定では無効） |
| `R` | リソースビューに切り替え（`views` オプションに `'resource'` を含めた場合のみ。既定では無効） |
| `L` | タイムラインビューに切り替え（`views` オプションに `'timeline'` を含めた場合のみ。既定では無効。`timeline` の頭文字 `T` は「今日」と衝突するため語中の `L` を使う） |
| `T` | 今日へ移動 |
| `J` または `N` | 次の期間へ移動 |
| `K` または `P` | 前の期間へ移動 |
| `C` | `onCreate` コールバックを呼ぶ（作成 UI の起点） |

大文字・小文字は区別しません。`Ctrl` / `Cmd` / `Alt` などの修飾キーを伴う場合は無視されます。`input` / `textarea` / `select` にフォーカスがある間、および `contenteditable` 要素の内側では、すべてのショートカットが無効になります。`enabled: false` を渡すと一時的に無効化できます。

年・複数月・リソース・タイムラインビューへの切替キーは既定では無効です。`views` オプション（既定 `['month', 'week', 'day', 'list']`）に対象のビューを追加すると、そのビューへの切替キーだけが有効になります（`Toolbar` の `views` prop と同じ既定値です。詳細は [ビュー](./views.md#年複数月リソースタイムラインビューを有効にするopt-in) を参照）。

```tsx
useCalendarShortcuts({
  calendar,
  views: ['month', 'week', 'day', 'list', 'year', 'multiMonth', 'resource', 'timeline'],
});

// 期待される動作:
// - Y キーを押すと calendar.state.view が 'year' に、Q キーを押すと 'multiMonth' になる
// - R キーを押すと 'resource' に、L キーを押すと 'timeline' になる
// - views に対象のビューを含めない場合、そのビューへの切替キーを押しても view は変わらない
//   （既存 M/W/D/A/T の挙動は不変）
```

## キーボードのみでの予定操作

マウスを使わなくても、予定と日セルへのフォーカスだけで一通りの操作ができます（`editable: false` の予定では移動・リサイズ・削除は無効です）。

**予定要素にフォーカスした状態:**

| キー | 時間グリッド（週/日） | 月ビュー・終日行の帯 |
| --- | --- | --- |
| `Enter` / `Space` | `onEventClick` 相当のクリック | 同左 |
| `Delete` / `Backspace` | オカレンスを削除（繰り返しはスコープ解決） | 同左 |
| `↑` / `↓` | ∓/± `snapMinutes` 分の移動 | ∓/± 7 日（1 週間）の移動 |
| `←` / `→` | ∓/± 1 日の移動 | ∓/± 1 日の移動 |
| `Shift+↑` / `Shift+↓` | 終了時刻を ∓/± `snapMinutes` 分リサイズ | — |
| `Shift+←` / `Shift+→` | — | 終了日を ∓/± 1 日リサイズ |

移動・リサイズは最小長（時間グリッドは `snapMinutes` 分、帯は 1 日）を下回る操作を無視します。繰り返し予定では `resolveRecurringScope` が呼ばれ、適用後に `onEventChange`（削除は `onEventDelete`）が通知されます。

**日セル・終日セルにフォーカスした状態（月ビュー・終日行・リソースビューの終日セル）:** `Enter` または `Space` でその日 1 日分の範囲選択（`onSelectRange`、`allDay: true`）が発火します。リソースビューの終日セル（`resource-allday-cell`）ではフォーカス中の列の `resourceId` が付きます。リストビューの予定行は Enter・Space によるクリックのみに対応します。

`CalendarProvider` の `gridNavigation` を有効にすると、日セル・終日セルでは矢印キーによるセル間移動が使えるようになり、セル内に予定がある日の `Enter` は範囲選択ではなく最初の予定へのフォーカス移動になります（`Space` の範囲選択、予定にフォーカスした状態のキー割り当ては上表のまま変わりません）。詳細は [アクセシビリティ: grid 内のキーボードナビゲーション](./accessibility.md#grid-内のキーボードナビゲーションgridnavigation) を参照してください。

## コピー&ペースト（useCalendarClipboard）

`useCalendarClipboard` を使うと、イベントのコピー&ペースト（複製）を配線できます。コピーの内容はフック内部のクリップボードに保持され（OS のクリップボードは使いません）、貼り付けは `calendar.api.createEvent` でイベントを作成します。UI は提供しません（ヘッドレス）。

- `copy(occurrence)` — オカレンスをコピーする
- `paste(newStart?)` — 貼り付けてイベントを作成する。`newStart` 省略時はコピー元と同じ日時への複製になる
- `hasClipboard` — クリップボードにコピー内容があるか（貼り付けボタンの活性化などに使う）
- `clear()` — クリップボードを空にする

**繰り返しイベントのコピーは、シリーズ全体ではなく当該オカレンスの単発化です**（Google カレンダーのコピーと同じ扱い）。コピーされた内容は `rrule` を持たない単発イベントになり、貼り付けてもシリーズは複製されません（コピー規則の詳細は [予定の管理: 複製とコピー&ペースト](./events.md#複製とコピーペースト) を参照）。

`keyboardShortcuts: true`（既定は `false` の opt-in）でキーボードショートカットが有効になります。

| キー | 動作 |
| --- | --- |
| `Ctrl/Cmd+C` | フォーカス中の予定要素（`data-koyomi-occurrence` 属性を持つ要素）のオカレンスをコピー |
| `Ctrl/Cmd+V` | フォーカス中の日付セル（`data-koyomi-date` 属性を持つ要素）の日へ貼り付け |

- `Ctrl/Cmd+C` は予定要素にフォーカスがあるときだけ動作し、それ以外では `preventDefault` も行いません（ページ上のテキストコピーを妨げません）
- `Ctrl/Cmd+V` はフォーカスがカレンダーの DOM（`data-koyomi-*` 属性を持つ要素）の内側にあるときだけ動作します。貼り付け先の日はフォーカス中の日付セルから決まり、時間指定の予定はコピー元の時刻を維持して（終日の予定は終日のまま）その日に配置されます。カレンダー内でも日付セルが特定できない位置（ツールバー等）では、コピー元と同じ日時への複製になります
- `input` / `textarea` / `select` / `contentEditable` にフォーカスがある間は無効です

`history` に `useCalendarHistory` の戻り値を渡すと、貼り付けで作成されたイベントが履歴に積まれ、`Ctrl/Cmd+Z` で取り消せるようになります。

```tsx
import {
  CalendarProvider,
  CalendarView,
  useCalendar,
  useCalendarClipboard,
  useCalendarHistory,
} from '@koyomi-cal/react';

function App() {
  const calendar = useCalendar({ initialView: 'month' });
  const history = useCalendarHistory({ calendar, keyboardShortcuts: true });
  useCalendarClipboard({ calendar, history, keyboardShortcuts: true });
  return (
    <CalendarProvider value={calendar}>
      <CalendarView />
    </CalendarProvider>
  );
}

// 期待される動作:
// - 予定ボタンにフォーカスして Ctrl+C → 別の日付セルにフォーカスして Ctrl+V すると、
//   その日にコピー元の時刻を維持した複製が作成される
// - 繰り返し予定のオカレンスをコピーした場合、貼り付けは単発イベントになる
// - Ctrl+Z で貼り付けが取り消される（history を渡した場合）
```

## 「+N 件」のポップオーバーを自前で組む

Koyomi はポップオーバー・ダイアログなどの UI を提供しません（ヘッドレスの方針）。月ビュー・複数月ビューの「+N 件」ボタンは、隠れた予定を一覧表示するポップオーバーの起点になるよう `onOverflowClick` と `overflowButtonProps` を提供しており、[Floating UI](https://floating-ui.com/) 等の位置決めライブラリと組み合わせて自前の UI を構築できます。

- `onOverflowClick(day, hiddenOccurrences, details)` — `hiddenOccurrences` が「+N 件」に集約された非表示のオカレンス一覧、`details.visibleOccurrences` がその日で表示中のオカレンス一覧（いずれも開始時刻順）。両方を合わせるとその日の全オカレンスを取得できる
- `overflowButtonProps?: (day, hiddenOccurrences) => { 'aria-haspopup'?, 'aria-expanded'?, 'aria-controls'? }` — 「+N 件」ボタンに追加する ARIA 属性を返す。ポップオーバーの開閉状態を `aria-expanded` で示す用途に使う。属性一式は `overflowPopoverButtonProps({ open, popoverId })` ヘルパーで組み立てられる
- ボタンは `Enter` / `Space` でもクリック相当が発火する（フォーカス済みの状態でキーボードのみでも開ける）
- ポップオーバーを閉じたときは「+N 件」ボタンへフォーカスを戻す（規約の詳細は [アクセシビリティ: 「+N 件」ポップオーバーの ARIA 属性とフォーカス復帰](./accessibility.md#n-件ポップオーバーの-aria-属性とフォーカス復帰) 参照）

```tsx
import { useState } from 'react';
import { useFloating, offset, flip, shift } from '@floating-ui/react';
import {
  CalendarProvider,
  MonthView,
  overflowPopoverButtonProps,
  useCalendar,
} from '@koyomi-cal/react';
import type { EventOccurrence, MonthDay } from '@koyomi-cal/react';

function MonthWithOverflowPopover() {
  const calendar = useCalendar({ initialView: 'month' });
  const [openDay, setOpenDay] = useState<MonthDay | null>(null);
  const [occurrences, setOccurrences] = useState<readonly EventOccurrence[]>([]);
  const { refs, floatingStyles } = useFloating({
    open: openDay !== null,
    onOpenChange: (open) => {
      if (!open) setOpenDay(null);
    },
    middleware: [offset(4), flip(), shift()],
  });

  return (
    <CalendarProvider
      value={calendar}
      callbacks={{
        onOverflowClick: (day, hiddenOccurrences, details) => {
          // 表示中＋非表示を合わせてその日の全件を一覧にする
          setOccurrences([...details.visibleOccurrences, ...hiddenOccurrences]);
          setOpenDay(day);
        },
      }}
    >
      <MonthView
        overflowButtonProps={(day) =>
          overflowPopoverButtonProps({
            open: openDay?.key === day.key,
            popoverId: 'overflow-popover',
          })
        }
        renderDayCell={(day, ctx) =>
          day.key === openDay?.key ? (
            <div ref={refs.setReference}>{ctx.defaultContent}</div>
          ) : (
            ctx.defaultContent
          )
        }
      />
      {openDay !== null && (
        <div ref={refs.setFloating} style={floatingStyles} role="dialog" id="overflow-popover">
          {occurrences.map((occurrence) => (
            <div key={occurrence.key}>{occurrence.event.title}</div>
          ))}
        </div>
      )}
    </CalendarProvider>
  );
}

// 期待される動作:
// - 「+N 件」をクリック（または Enter/Space）すると、その日の全予定
//   （表示中＋非表示）が Floating UI で位置決めされたポップオーバーに一覧表示される
// - ポップオーバーが開いている間、対応する「+N 件」ボタンの aria-expanded が true になり、
//   aria-controls="overflow-popover" でポップオーバー要素に関連付けられる（閉時は付かない）
```

### 完成形: 外部ライブラリ不要のフォーカス復帰込み実装（コピー&ペースト用）

位置決めライブラリを増やしたくない場合は、起点ボタンの `getBoundingClientRect` から素朴に座標を計算しても構いません。以下は実際に動作する完成形です（デモアプリ `apps/demo/src/OverflowPopover.tsx` で実際に動作しているコードそのものです）。開閉は `<dialog>` の `show()`（モードレス）で行い、開いたときの最初の focusable 要素へのフォーカス移動と、閉じたとき（Escape・外側クリック・閉じるボタン・予定選択のいずれでも）の起点ボタンへのフォーカス復帰を、`close` イベント 1 箇所に集約して扱います。

```tsx
import type { EventOccurrence, MonthDay, TimeZoneId } from '@koyomi-cal/react';
import { getWallClock } from '@koyomi-cal/react';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** ポップオーバーの `id`（「+N 件」ボタンの `aria-controls` の参照先）。 */
export const OVERFLOW_POPOVER_ID = 'demo-overflow-popover';

/** ポップオーバーの想定幅（px）。ビューポート端でのはみ出し防止の位置計算にも使う。 */
const POPOVER_WIDTH = 260;

/** `OverflowPopover` が表示すべき状態。 */
export interface OverflowPopoverState {
  /** 起点になった日。 */
  day: MonthDay;
  /** その日の全オカレンス（表示中＋「+N 件」に集約された分、開始時刻順）。 */
  occurrences: readonly EventOccurrence[];
}

/** `OverflowPopover` の props。 */
export interface OverflowPopoverProps {
  /** 表示中の状態。`null` なら非表示。 */
  state: OverflowPopoverState | null;
  /** 現在の表示タイムゾーン。時刻表示に使う。 */
  timeZone: TimeZoneId;
  /** 一覧内の予定がクリックされたときに呼ばれる（編集ダイアログを開く想定）。 */
  onOccurrenceSelect: (occurrence: EventOccurrence) => void;
  /** ポップオーバーが閉じられたときに呼ばれる（起点ボタン以外の理由すべて共通）。 */
  onClose: () => void;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDayHeading(date: Date, timeZone: TimeZoneId): string {
  return new Intl.DateTimeFormat('ja', { timeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function formatOccurrenceTime(occurrence: EventOccurrence, timeZone: TimeZoneId): string {
  if (occurrence.allDay) {
    return '終日';
  }
  const wall = getWallClock(occurrence.start, timeZone);
  return `${pad2(wall.hours)}:${pad2(wall.minutes)}`;
}

/**
 * 起点になった「+N 件」ボタン（`data-koyomi="month-overflow"`）の DOM 要素を、
 * 対応する日セル（`[data-koyomi="month-day"][data-koyomi-date]`）から探す。
 */
function findOverflowButton(dayKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-koyomi="month-day"][data-koyomi-date="${dayKey}"] [data-koyomi="month-overflow"]`,
  );
}

export function OverflowPopover(props: OverflowPopoverProps): ReactElement {
  const { state, timeZone, onOccurrenceSelect, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  // 起点になった「+N 件」ボタン。閉じたときのフォーカス復帰先として保持する。
  const triggerRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const focusPendingRef = useRef(false);

  // state が非 null になるたびに、起点ボタンの位置から表示座標を計算する。
  useLayoutEffect(() => {
    if (state === null) {
      triggerRef.current = null;
      setPosition(null);
      return;
    }
    const trigger = findOverflowButton(state.day.key);
    triggerRef.current = trigger;
    if (trigger === null) {
      setPosition(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
    setPosition({ top: rect.bottom + 4, left });
  }, [state]);

  // state の有無に応じて <dialog> の開閉を同期する。
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return;
    }
    if (state !== null && !dialogEl.open) {
      dialogEl.show();
      focusPendingRef.current = true;
    } else if (state === null && dialogEl.open) {
      dialogEl.close();
    }
  }, [state]);

  // 位置決めが終わった直後に閉じるボタンへフォーカスする。
  useEffect(() => {
    if (state !== null && position !== null && focusPendingRef.current) {
      focusPendingRef.current = false;
      closeButtonRef.current?.focus();
    }
  }, [state, position]);

  // ネイティブな close（Escape・閉じるボタン・外側クリック・予定選択いずれも close() 経由）で
  // 起点ボタンへフォーカスを戻しつつ、呼び出し元へ通知する。
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return undefined;
    }
    function handleClose(): void {
      const trigger = triggerRef.current;
      onClose();
      if (trigger?.isConnected) {
        trigger.focus();
      }
    }
    dialogEl.addEventListener('close', handleClose);
    return () => dialogEl.removeEventListener('close', handleClose);
  }, [onClose]);

  // ポップオーバー外側のポインタ押下で閉じる（起点の「+N 件」ボタン自体への
  // 押下は、そのクリックが改めて onOverflowClick を呼ぶため対象外にする）。
  useEffect(() => {
    if (state === null) {
      return undefined;
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const dialogEl = dialogRef.current;
      if (dialogEl?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest('[data-koyomi="month-overflow"]') !== null) {
        return;
      }
      dialogRef.current?.close();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [state]);

  return (
    <dialog
      ref={dialogRef}
      id={OVERFLOW_POPOVER_ID}
      aria-label={state !== null ? `${formatDayHeading(state.day.date, timeZone)}の予定一覧` : undefined}
      style={position !== null ? { position: 'fixed', margin: 0, top: position.top, left: position.left } : undefined}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          dialogRef.current?.close();
        }
      }}
    >
      {state !== null && (
        <div>
          <div>
            <span>{formatDayHeading(state.day.date, timeZone)}</span>
            <button type="button" ref={closeButtonRef} aria-label="閉じる" onClick={() => dialogRef.current?.close()}>
              ×
            </button>
          </div>
          <ul>
            {state.occurrences.map((occurrence) => (
              <li key={occurrence.key}>
                <button
                  type="button"
                  onClick={() => {
                    onOccurrenceSelect(occurrence);
                    dialogRef.current?.close();
                  }}
                >
                  <span>{formatOccurrenceTime(occurrence, timeZone)}</span>
                  <span>{occurrence.event.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}

// 使用例（呼び出し元）:
// <MonthView
//   overflowButtonProps={(day) =>
//     overflowPopoverButtonProps({
//       open: overflowState?.day.key === day.key,
//       popoverId: OVERFLOW_POPOVER_ID,
//     })
//   }
// />
// <OverflowPopover
//   state={overflowState}
//   timeZone={timeZone}
//   onOccurrenceSelect={(occurrence) => setDialogMode({ type: 'edit', occurrence })}
//   onClose={() => setOverflowState(null)}
// />
// // onOverflowClick(day, hiddenOccurrences, details) 側で、表示中＋非表示を
// // 開始時刻順にまとめて setOverflowState({ day, occurrences }) する

// 期待される動作:
// - 「+N 件」をクリックすると、その日の起点ボタン直下にポップオーバーが開き、
//   閉じるボタン（一覧内の最初の focusable な要素）へフォーカスが移る
// - Escape キー・ポップオーバー外クリック・閉じるボタンのいずれで閉じても、
//   フォーカスが起点の「+N 件」ボタンへ戻る
// - 一覧内の予定を選択すると編集ダイアログが開く（ポップオーバー自体は閉じる）
```

複数月ビュー（`MultiMonthView`）は同じ日が隣接するミニ月グリッドに重複して現れうるため、`data-koyomi-date` による起点ボタンの一意な特定ができません。この完成形は月ビュー限定です。

## Escape / pointercancel でのドラッグキャンセル

作成・移動・リサイズのドラッグ中に `Escape` キーを押すと、その場でドラッグが取り消されます。変更は一切適用されず、`onSelectRange` / `onEventChange` も呼ばれません（キャンセル直後にブラウザが発火するネイティブ `click` も抑制されるため、`onEventClick` が誤発火することもありません）。ブラウザによるポインタの強制中断（`pointercancel`。タッチ操作の割り込み等）も同じ扱いになります。この挙動は `useDayDrag` / `useTimeGridDrag`（およびそれらを使うビルトインコンポーネント）に組み込まれており、追加の設定は不要です。

## 自前 UI を作る上級編

ビルトインコンポーネントを使わず、自前の要素にドラッグ操作を組み込みたい場合は `useDayDrag` / `useTimeGridDrag` をプロップゲッターとして使います。戻り値の `get*Props` 関数が返すオブジェクトを対象の要素にスプレッドするだけで、ポインタ操作からプレビュー計算・確定・繰り返しのスコープ解決までをフックが担います。

### useDayDrag（日単位: 月ビュー・終日行相当）

`useDayDrag({ calendar, callbacks })` は次を返します。

- `getDayCellProps(day)` — 日セル用の props（`ref` / `onPointerDown` / `onKeyDown` / `tabIndex` / `data-koyomi-date`）。空きセルでの作成ドラッグと Enter/Space での作成を開始する
- `getSegmentProps(segment)` — 帯セグメント用の props（`onPointerDown` / `onClick` / `onKeyDown` / `tabIndex` / `data-koyomi-occurrence` / ドラッグ中なら `data-koyomi-dragging`）。移動ドラッグ・クリック・キーボード操作を担う
- `getSegmentResizeHandleProps(segment, edge)` — 帯の左右端リサイズハンドル用の props（`edge` は `'start' | 'end'`）
- `previewRange` — 現在のドラッグプレビューの日範囲（非ドラッグ中、および時間グリッドへの変換プレビュー中は `null`）
- `isDragging` — ドラッグ操作が進行中か

`getDayCellProps` の `ref` はコールバック形式で、要素をポインタ位置 → 日の判定に使う内部レジストリへ登録します。複数日にまたがるドラッグを正しく機能させるには、返された `ref` を実際の要素に接続する必要があります。

```tsx
import { useCalendar, useDayDrag } from '@koyomi-cal/react';
import type { RangeSelection } from '@koyomi-cal/react';

function CustomDayRow() {
  const calendar = useCalendar({ initialView: 'month' });
  const dayDrag = useDayDrag({
    calendar,
    callbacks: {
      onSelectRange: (selection: RangeSelection) => {
        // selection.allDay は常に true
      },
    },
  });
  if (calendar.viewModel.type !== 'month') return null;
  const days = calendar.viewModel.weeks[0]?.days ?? [];

  return (
    <div>
      {days.map((day) => {
        const { ref, ...cellProps } = dayDrag.getDayCellProps(day);
        return (
          <div
            key={day.key}
            {...cellProps}
            ref={(element: HTMLDivElement | null) => {
              if (typeof ref === 'function') ref(element);
            }}
          />
        );
      })}
    </div>
  );
}

// 期待される動作:
// - 1 マス目から 3 マス目までドラッグすると、3 日分の範囲（end は排他的）で
//   onSelectRange が allDay: true で呼ばれる
```

### useTimeGridDrag（時間グリッド: 週/日ビュー相当）

`useTimeGridDrag({ calendar, callbacks })` は次を返します。

- `getDayProps(day)` — 日列用の props（`ref` / `onPointerDown` / `data-koyomi-date`）。空き領域での作成ドラッグを開始する
- `getEventProps(item)` — イベントブロック用の props（`onPointerDown` / `onClick` / `onKeyDown` / `tabIndex` / `data-koyomi-occurrence` / ドラッグ中なら `data-koyomi-dragging`）。移動ドラッグ・クリック・キーボード操作を担う
- `getResizeHandleProps(item, edge?)` — リサイズハンドル用の props（`onPointerDown` / `onClick` / `data-koyomi-resize-handle`）。`edge` は `'start'`（上端 = 開始時刻）または `'end'`（下端 = 終了時刻。省略時の既定）
- `previewFor(day)` — 指定日のドラッグプレビュー区間（`{ kind, startMinutes, endMinutes }`。その日に重ならない場合と、終日行への変換プレビュー中は `null`）
- `isDragging` — ドラッグ操作が進行中か

いずれの `get*Props` も、対象の要素（`<div>` や `<button>` など）にそのままスプレッドして使います。`ref` はコールバック形式で、要素の矩形（`getBoundingClientRect`）からポインタ位置に対応する日時を計算するための内部レジストリに登録されます。

## 外部ドラッグ受け入れ（カレンダー外からのドラッグ）

サイドバーの予定テンプレートなど、カレンダーの**外側**にある DOM 要素からのドラッグでカレンダー上に予定を作成したい場合は `useExternalDrag` を使います（FullCalendar の `Draggable` に相当するヘッドレス機構）。

`useExternalDrag({ calendar, containerRef, onExternalDrop })` は次を返します。

- `getDraggableProps(payload)` — 外部要素にスプレッドする props（`onPointerDown`）を返す。`payload` にはドロップ確定時に受け取りたい任意のデータ（予定テンプレートの内容など）を渡す
- `isDragging` — 外部ドラッグが進行中か

`containerRef` には、そのカレンダーインスタンス（`CalendarProvider` とビューコンポーネント）を描画している DOM のルート要素への ref（`useRef` の戻り値）を渡します。ドロップ先のヒットテストはこの要素の内側に限定されるため、ページ上に同じビュー種別のカレンダーが複数存在しても、ドラッグ元とは別のカレンダーの DOM 上へのドロップを誤って受理することはありません。

ドラッグ中は、対応ビューが実際に描画されている前提で、ポインタ直下の（`containerRef` の内側にある）カレンダー要素から日時（・リソース/タイムラインビューではリソース ID）を解決し、既存のプレビュー機構（各ビューの通常のドラッグ操作と同じハイライト表示）でカレンダー上に表示します。ただしリストビューはドロップ先の解決のみを行い、ハイライト表示はありません（そもそもリストビューには通常のドラッグ操作自体がありません）。

| ビュー | ドロップ先 | 解決される範囲 |
| --- | --- | --- |
| 月（`month`） | 日セル | その日 1 日分の終日範囲（`allDay: true`） |
| 週/日（`week` / `day`） | 時間グリッドの日列 | ポインタ位置の時刻から `defaultEventMinutes` 分（`snapMinutes` でスナップ） |
| 週/日（`week` / `day`） | 終日行のセル | その日 1 日分の終日範囲 |
| リスト（`list`） | 日セクション | その日 1 日分の終日範囲。リストビューは予定がある日だけを日セクションとして描画するため、ドロップを受け付けるのもその上に限られます |
| 複数月（`multiMonth`） | 日セル | その日 1 日分の終日範囲（前後月の日付のセルは対象外） |
| リソース（`resource`） | 列 / 終日セル | 時間グリッド/終日行と同じ範囲 + ドロップ先レーンの `resourceId` |
| タイムライン（`timeline`） | 行 | ポインタ位置の時刻から `defaultEventMinutes` 分 + 行の `resourceId` |
| 年（`year`） | —（非対応） | ドロップ先が解決できずキャンセル扱いになります |

リソース/タイムラインビューで `resources` が 0 件かつ未割り当てレーンも生成されない
場合（`unassignedLane: 'auto'` で未割り当ての予定も 1 件も無いとき）、そのビューは
列/行を 1 つも描画しません（`ResourceViewModel.isEmpty` / `TimelineViewModel.isEmpty`）。
ドロップ先となる列/行の DOM 要素自体が存在しないため、この状態でのドロップは
年ビューと同様にドロップ先が解決できずキャンセル扱いになります
（`unassignedLane: 'always'` を指定するか、`resources` を 1 件以上渡せば列/行が
生成され、通常どおりドロップを受け付けます）。

ドロップが確定すると `onExternalDrop` が呼ばれます。**イベントの作成自体は行いません**（ヘッドレス原則）。`calendar.api.createEvent` を呼ぶかどうかはコールバック内でアプリ側が決めます。

```tsx
import { useRef } from 'react';
import { CalendarProvider, TimeGridView, useCalendar, useExternalDrag } from '@koyomi-cal/react';
import type { ExternalDropInfo } from '@koyomi-cal/react';

interface EventTemplate {
  title: string;
}

function App() {
  const calendar = useCalendar({ initialView: 'week' });
  // このカレンダーインスタンスの DOM ルート（ページ上に複数カレンダーがあっても
  // ドロップ先のヒットテストがこの要素の内側に限定される）。
  const containerRef = useRef<HTMLDivElement>(null);

  function handleExternalDrop(info: ExternalDropInfo<EventTemplate>) {
    calendar.api.createEvent({
      title: info.payload.title,
      start: info.range.start,
      end: info.range.end,
      allDay: info.allDay,
      // リソース/タイムラインビューへのドロップでは info.resourceId も渡せる
    });
  }

  const externalDrag = useExternalDrag<EventTemplate>({
    calendar,
    containerRef,
    onExternalDrop: handleExternalDrop,
  });

  return (
    <div>
      <div {...externalDrag.getDraggableProps({ title: '外部の予定' })}>外部の予定</div>
      <div ref={containerRef}>
        <CalendarProvider value={calendar}>
          <TimeGridView />
        </CalendarProvider>
      </div>
    </div>
  );
}

// 期待される動作:
// - 「外部の予定」を週ビューの 10:00 付近へドラッグ＆ドロップすると、
//   handleExternalDrop({ range: { start: 10:00, end: 10:00 + defaultEventMinutes }, allDay: false,
//   payload: { title: '外部の予定' } }) が呼ばれる
// - ドラッグ中はドロップ予定位置に既存のドラッグ操作と同じプレビューが表示される
// - Escape キー・pointercancel（タッチ操作の割り込み等）で中断した場合、
//   対応ビュー外・カレンダー外でドロップした場合、および他カレンダーの
//   containerRef の外側でドロップした場合は onExternalDrop が呼ばれない
```

- `ExternalDropInfo`（`onExternalDrop` の引数） — `range`（`DateRange`）・`allDay`・`resourceId?`（リソース/タイムラインビューへのドロップ時のみ、`null` は未割り当てレーン）・`payload`（`getDraggableProps` に渡した値）
- 外部要素自体は `containerRef` の外に置いて構いません（サイドバーとカレンダーが別要素であるケースを想定）。カレンダーの `data-koyomi-*` 属性フックの対象外（デフォルトテーマは適用されません）。タッチ操作でドラッグをスクロールに奪われないよう、外部要素には自前で `touch-action: none` を設定してください（[テーマとスタイリング](./theming.md) 参照）
- `onError` を渡すと、`onExternalDrop` が投げた例外をハンドリングできます（省略時は `console.error` に出力）

## 関連ページ

- [ビュー（月・週・日・リスト・年・複数月・リソース・タイムライン）](./views.md)
- [予定の管理](./events.md)
- [繰り返し予定](./recurrence.md)
- [アクセシビリティ](./accessibility.md)
- [タイムゾーン](./timezones.md)
- [テーマとスタイリング](./theming.md)
- [API リファレンス](./api.md)
