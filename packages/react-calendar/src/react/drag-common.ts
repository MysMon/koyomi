/**
 * @packageDocumentation
 * 時間グリッド／リソースビュー／タイムラインの3つのドラッグ系フック
 * （`use-time-grid-drag` / `use-resource-grid-drag` / `use-timeline-drag`）が
 * 共有する内部ヘルパー。ライブラリの公開 API ではない（`index.ts` からは
 * 再エクスポートしない。利用側は各フックが返すハンドラ経由でのみ機能を使う）。
 *
 * ここに置いているのは、3フックで実装が一字一句同一だった、あるいは
 * 「ビュー固有の処理をコールバックとして注入するだけで吸収できる」と
 * 判断できたロジックに限る:
 *
 * - {@link laneResourceIdOf} — オカレンスの現在のレーンのリソース ID を求める
 *   （リソースビュー・タイムラインの2フックで共有）
 * - {@link resolveScopeForRecurring} — 繰り返しオカレンスのスコープ解決（3フック共通）
 * - {@link checkBeforeEventChange} / {@link checkBeforeSelectRange} /
 *   {@link checkBeforeEventDelete} — 適用前フック（`onBeforeEventChange` 等）の
 *   判定（4フック共通。`use-day-drag.ts` を含む）
 * - {@link autoScrollVelocity} — オートスクロールの速度計算（3フック共通）
 * - {@link createAutoScrollLoop} — オートスクロールの rAF ループ管理（3フック共通。
 *   軸（縦/横）だけが違う）
 * - {@link attachDragSessionListeners} — pointermove/pointerup/pointercancel/keydown の
 *   document リスナー配線・解除（3フック共通）
 * - {@link eventNotificationProps} — 追加通知系ハンドラ（`onEventDoubleClick` /
 *   `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`）の配線
 *   （3フックに加え `use-day-drag.ts` と `list-view-parts.tsx` も含む 5 箇所共通）
 *
 * 逆に、`startSession` 本体（`DragSession` の構造・pointermove 時の座標→日時変換や
 * レーン追従ロジック・`cancelSession`/`commitSession` の中身）は意図的に共通化して
 * いない。3フックで保持する状態が異なり（例: 終日変換プレビューは時間グリッドのみ、
 * 対象リソース ID の追跡はリソースビュー/タイムラインのみ、終日の帯の日単位移動用の
 * 基準日はタイムラインのみ）、無理に1つのヘルパーへ吸収しようとすると分岐用の
 * オプション引数が増殖してしまうため（このプロジェクトが避けたい過剰抽象化）。
 */

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { EventOccurrence, RecurringEditScope } from '../core/types';
import type { CalendarInteractionCallbacks, EventChangeProposal, RangeSelection } from './types';

/**
 * オカレンスの現在のレーンのリソース ID（未割り当ては `null`）を返す。
 *
 * `resources` に存在しない ID（参照先を失った resourceId）はビュービルダーが
 * 未割り当てレーン／行へ合流させるため、ここでも `null` に正規化する。
 * 正規化しないと、キーボードでの列・行移動が現在のレーンを見つけられず、
 * 変更検出も表示上のレーンと食い違う。
 *
 * リソースビュー（`use-resource-grid-drag`）・タイムライン（`use-timeline-drag`）の
 * 両方から共通で使う（週/日ビューにはレーンの概念がないため対象外）。
 *
 * @param occurrence - 対象のオカレンス
 * @param resources - 現在の表示対象リソース一覧（`id` のみ参照する）
 * @returns 正規化済みのリソース ID。未割り当てなら `null`
 */
export function laneResourceIdOf(
  occurrence: EventOccurrence,
  resources: readonly { id: string }[],
): string | null {
  const resourceId = occurrence.event.resourceId;
  if (resourceId === undefined) {
    return null;
  }
  return resources.some((resource) => resource.id === resourceId) ? resourceId : null;
}

/**
 * 繰り返しオカレンスのスコープを解決する。呼び出し元は `occurrence.isRecurring` が
 * `true` の場合にのみ呼ぶこと（単発オカレンスは呼び出し元で `null` 固定とし、
 * この関数を経由しない＝ `await` を発生させない。ドラッグ確定直後にブラウザが
 * 発火するネイティブ `click` に対する抑制フラグの設定を間に合わせるため）。
 *
 * @param callbacks - インタラクションコールバック。`resolveRecurringScope` が
 *   未指定なら常に `'this'`（既定スコープ）を返す
 * @param occurrence - 対象のオカレンス
 * @param action - 操作の種別
 * @returns 解決されたスコープ。キャンセルされた場合は `null`
 */
export async function resolveScopeForRecurring(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
  action: 'move' | 'resize' | 'delete' | 'update',
): Promise<RecurringEditScope | null> {
  const resolveRecurringScope = callbacks?.resolveRecurringScope;
  return resolveRecurringScope ? resolveRecurringScope(occurrence, action) : 'this';
}

/**
 * 変更（移動・リサイズ・終日⇔時間指定変換）の適用前フック `onBeforeEventChange`
 * を判定する（FullCalendar の `eventAllow` 相当）。呼び出し元は
 * `resolveRecurringScope` による繰り返しスコープの問い合わせより**前**に
 * これを呼ぶこと（拒否された場合にスコープ問い合わせ自体を行わないため）。
 *
 * 戻り値は次の三項演算子パターンと組み合わせて使うこと（呼び出し元の `async`
 * 関数の中に直接書く。別の `async` ヘルパー関数へ切り出さない）:
 *
 * ```ts
 * const gate = checkBeforeEventChange(callbacks, proposal);
 * const allowed = typeof gate === 'boolean' ? gate : await gate;
 * ```
 *
 * `boolean` を直接返す分岐（フック未指定、または同期的に `true`/`false` を返す
 * 実装）では `await` 式自体を評価しない。これを `await checkBeforeEventChange(...)`
 * のように毎回無条件に `await` してしまうと、フック未指定・同期 `true` 返却の
 * 場合でも呼び出し元の関数が microtask を 1 回消費してしまい、繰り返しでない
 * 単発オカレンスの操作が同期的に完結するという既存の前提（ドラッグ確定直後の
 * ネイティブ `click` 抑制のタイミング等）が崩れる。この判定を別の `async` 関数へ
 * 切り出すと、その関数呼び出し自体が常に `Promise` を返すため、`boolean` 分岐でも
 * 同じ問題が再発する（`async` 関数は本体が `await` に到達しなくても常に
 * `Promise` を返すため）。そのため、あえて関数化せず各呼び出し元にこの三項演算子
 * をそのまま書く方針にしている。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeEventChange` が
 *   未指定なら常に許可（`true`）する
 * @param proposal - 適用しようとしている変更の内容
 * @returns 適用してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeEventChange(
  callbacks: CalendarInteractionCallbacks | undefined,
  proposal: EventChangeProposal,
): boolean | Promise<boolean> {
  const onBeforeEventChange = callbacks?.onBeforeEventChange;
  return onBeforeEventChange === undefined ? true : onBeforeEventChange(proposal);
}

/**
 * 範囲選択の適用前フック `onBeforeSelectRange` を判定する
 * （FullCalendar の `selectAllow` 相当）。{@link checkBeforeEventChange} と同様、
 * 三項演算子パターンと組み合わせて使うこと。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeSelectRange` が
 *   未指定なら常に許可（`true`）する
 * @param selection - 選択された範囲
 * @returns 適用してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeSelectRange(
  callbacks: CalendarInteractionCallbacks | undefined,
  selection: RangeSelection,
): boolean | Promise<boolean> {
  const onBeforeSelectRange = callbacks?.onBeforeSelectRange;
  return onBeforeSelectRange === undefined ? true : onBeforeSelectRange(selection);
}

/**
 * 削除の適用前フック `onBeforeEventDelete` を判定する。
 * 呼び出し元は `resolveRecurringScope` より**前**にこれを呼ぶこと
 * （{@link checkBeforeEventChange} と同じ理由）。三項演算子パターンと組み合わせて使うこと。
 *
 * @param callbacks - インタラクションコールバック。`onBeforeEventDelete` が
 *   未指定なら常に許可（`true`）する
 * @param occurrence - 削除しようとしているオカレンス
 * @returns 削除してよければ `true`（または `true` に解決される `Promise`）
 */
export function checkBeforeEventDelete(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
): boolean | Promise<boolean> {
  const onBeforeEventDelete = callbacks?.onBeforeEventDelete;
  return onBeforeEventDelete === undefined ? true : onBeforeEventDelete(occurrence);
}

/**
 * ドラッグ中のポインタ位置からオートスクロールの速度を計算する。
 *
 * 軸に依存しない（呼び出し側がどちらの軸で使うかを決める）。`pointer` がスクロール
 * コンテナの進行方向の始端（`edgeStart`）から `threshold` 未満の距離にあれば負
 * （始端方向へスクロール）、終端（`edgeEnd`）から `threshold` 未満の距離にあれば正
 * （終端方向へスクロール）の速度を返す。端に近いほど速く、最大でも `maxSpeed` を
 * 超えない。それ以外の範囲では `0`（スクロールしない）。
 *
 * - 縦方向（週/日ビュー・リソースビュー）: `edgeStart`/`edgeEnd` にスクロール
 *   コンテナの上端/下端、`pointer` に `clientY` を渡す
 * - 横方向（タイムライン）: `edgeStart`/`edgeEnd` にコンテナの左端/右端、
 *   `pointer` に `clientX` を渡す
 *
 * @param params.edgeStart - スクロールコンテナの進行方向の始端の座標（px）
 * @param params.edgeEnd - スクロールコンテナの進行方向の終端の座標（px）
 * @param params.pointer - 現在のポインタの座標（px、`edgeStart`/`edgeEnd` と同じ軸・
 *   同じ座標系）
 * @param params.threshold - 端からオートスクロールが始まる距離（px）。既定は `24`
 * @param params.maxSpeed - 最大スクロール速度（px/フレーム相当）。既定は `16`
 * @returns スクロール速度（負 = 始端方向へ、正 = 終端方向へ、`0` = 停止）
 * @example
 * ```ts
 * autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 0 }); // => -16（始端で最大速度）
 * autoScrollVelocity({ edgeStart: 0, edgeEnd: 600, pointer: 300 }); // => 0（中央では停止）
 * ```
 */
export function autoScrollVelocity(params: {
  edgeStart: number;
  edgeEnd: number;
  pointer: number;
  threshold?: number;
  maxSpeed?: number;
}): number {
  const { edgeStart, edgeEnd, pointer, threshold = 24, maxSpeed = 16 } = params;
  if (threshold <= 0) {
    return 0;
  }
  const startBoundary = edgeStart + threshold;
  if (pointer < startBoundary) {
    const depth = Math.min(startBoundary - pointer, threshold);
    return -(depth / threshold) * maxSpeed;
  }
  const endBoundary = edgeEnd - threshold;
  if (pointer > endBoundary) {
    const depth = Math.min(pointer - endBoundary, threshold);
    return (depth / threshold) * maxSpeed;
  }
  return 0;
}

/** {@link createAutoScrollLoop} が返すコントローラ。 */
export interface AutoScrollLoop {
  /**
   * オートスクロールの状態を更新する。`container` が `null` ならループを止める
   * （{@link AutoScrollLoop.stop} と同じ）。`velocity` が `0` ならループは止めるが、
   * 次に非 0 の速度が来たときのために直近のコンテナは保持する。
   */
  update(container: Element | null, velocity: number): void;
  /** ループを止める（ドラッグセッションの `cleanup` から呼ぶ）。 */
  stop(): void;
}

/**
 * ドラッグ中のオートスクロールの rAF ループを管理するコントローラを作る。
 *
 * 呼び出し側は pointermove のたびに、対象コンテナと {@link autoScrollVelocity} の
 * 計算結果を {@link AutoScrollLoop.update} に渡す。速度が非 0 の間だけ
 * `requestAnimationFrame` でスクロール位置を進め続け、ドラッグ終了時（`cleanup`）に
 * {@link AutoScrollLoop.stop} を呼んでループを止める。
 *
 * `axis` はフレームごとに進めるスクロール位置のプロパティを決める
 * （`'vertical'` → `scrollTop`、`'horizontal'` → `scrollLeft`）。コンテナの探索方法
 * （セレクタ）や速度計算のための矩形の取り方はビュー固有のため、この関数の外
 * （呼び出し側の pointermove ハンドラ）で行う。
 *
 * @param axis - スクロールする軸
 */
export function createAutoScrollLoop(axis: 'vertical' | 'horizontal'): AutoScrollLoop {
  let scrollContainer: Element | null = null;
  let scrollVelocity = 0;
  let scrollFrameId: number | null = null;

  const scrollStep = (): void => {
    if (scrollContainer === null || scrollVelocity === 0) {
      scrollFrameId = null;
      return;
    }
    if (axis === 'vertical') {
      scrollContainer.scrollTop += scrollVelocity;
    } else {
      scrollContainer.scrollLeft += scrollVelocity;
    }
    scrollFrameId = requestAnimationFrame(scrollStep);
  };

  const stop = (): void => {
    if (scrollFrameId !== null) {
      cancelAnimationFrame(scrollFrameId);
      scrollFrameId = null;
    }
    scrollContainer = null;
    scrollVelocity = 0;
  };

  const update = (container: Element | null, velocity: number): void => {
    if (container === null) {
      stop();
      return;
    }
    scrollContainer = container;
    scrollVelocity = velocity;
    if (velocity === 0) {
      if (scrollFrameId !== null) {
        cancelAnimationFrame(scrollFrameId);
        scrollFrameId = null;
      }
      return;
    }
    if (scrollFrameId === null) {
      scrollFrameId = requestAnimationFrame(scrollStep);
    }
  };

  return { update, stop };
}

/** {@link attachDragSessionListeners} に渡すハンドラ集。 */
export interface DragSessionListenerHandlers {
  /** `pointermove`。jsdom の PointerEvent 未実装環境も考慮し `MouseEvent` で受ける。 */
  pointermove: (event: MouseEvent) => void;
  /** `pointerup`。`pointermove` と同じ理由で `MouseEvent` で受ける。 */
  pointerup: (event: MouseEvent) => void;
  /** `pointercancel`。 */
  pointercancel: (event: PointerEvent) => void;
  /** `keydown`（主に Escape によるキャンセル用）。 */
  keydown: (event: KeyboardEvent) => void;
}

/**
 * ドラッグセッション用の document レベルのリスナー
 * （pointermove/pointerup/pointercancel/keydown）をまとめて登録する。
 *
 * 3フックの `startSession` はいずれも同じ4イベントを同じ配線パターンで登録・解除
 * するため、その配線部分だけを共通化する（各イベントのハンドラの中身＝
 * ドラッグ座標の解釈やコミット処理はビュー固有のまま、フック側で定義する）。
 *
 * @param handlers - 各イベントのハンドラ
 * @returns 登録した4つのリスナーをすべて解除する関数（セッションの `cleanup` から呼ぶ）
 */
export function attachDragSessionListeners(handlers: DragSessionListenerHandlers): () => void {
  document.addEventListener('pointermove', handlers.pointermove);
  document.addEventListener('pointerup', handlers.pointerup);
  document.addEventListener('pointercancel', handlers.pointercancel);
  document.addEventListener('keydown', handlers.keydown);
  return () => {
    document.removeEventListener('pointermove', handlers.pointermove);
    document.removeEventListener('pointerup', handlers.pointerup);
    document.removeEventListener('pointercancel', handlers.pointercancel);
    document.removeEventListener('keydown', handlers.keydown);
  };
}

/**
 * イベント要素に付与する追加通知系ハンドラ（`onDoubleClick` / `onContextMenu` /
 * `onPointerEnter` / `onPointerLeave`）。対応するコールバック
 * （`onEventDoubleClick` 等）が未指定のキーは {@link eventNotificationProps} の
 * 戻り値に含まれない。
 */
export interface EventNotificationProps {
  /** ダブルクリックで `onEventDoubleClick` を呼ぶ。 */
  onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** コンテキストメニュー操作で `onEventContextMenu` を呼ぶ（`preventDefault` はしない）。 */
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** `pointerenter` で `onEventHover` を呼ぶ。 */
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** `pointerleave` で `onEventHoverEnd` を呼ぶ。 */
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * イベント要素に付与する追加通知系ハンドラ（`onEventDoubleClick` /
 * `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`）を、対応する
 * コールバックが指定されている場合のみ含むオブジェクトとして返す。
 *
 * コールバック未指定時はキー自体を含めない。月ビュー（帯セグメント）・週/日ビュー・
 * リソースビュー・タイムライン・リストビューの `getEventProps` 系の戻り値に
 * スプレッドすることで、各ビューの「省略時は DOM props を追加しない」という仕様を
 * 1 箇所の実装で保証する。
 *
 * @param callbacks - インタラクションコールバック
 * @param occurrence - 対象のオカレンス
 * @returns 追加通知系ハンドラ（該当コールバック未指定のキーは含まない）
 */
export function eventNotificationProps(
  callbacks: CalendarInteractionCallbacks | undefined,
  occurrence: EventOccurrence,
): EventNotificationProps {
  const props: EventNotificationProps = {};
  const onEventDoubleClick = callbacks?.onEventDoubleClick;
  if (onEventDoubleClick !== undefined) {
    props.onDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
      onEventDoubleClick(occurrence, event.nativeEvent);
    };
  }
  const onEventContextMenu = callbacks?.onEventContextMenu;
  if (onEventContextMenu !== undefined) {
    props.onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
      onEventContextMenu(occurrence, event.nativeEvent);
    };
  }
  const onEventHover = callbacks?.onEventHover;
  if (onEventHover !== undefined) {
    props.onPointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
      onEventHover(occurrence, event.nativeEvent);
    };
  }
  const onEventHoverEnd = callbacks?.onEventHoverEnd;
  if (onEventHoverEnd !== undefined) {
    props.onPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
      onEventHoverEnd(occurrence, event.nativeEvent);
    };
  }
  return props;
}
