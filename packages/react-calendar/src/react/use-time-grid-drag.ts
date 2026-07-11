/**
 * @packageDocumentation
 * 時間グリッド（週/日ビュー）のドラッグインタラクション。
 *
 * - 空き領域のクリック / ドラッグ → 範囲選択（新規作成）
 * - イベント本体のドラッグ → 移動（列をまたぐ移動・スナップ対応）
 * - 下端・上端ハンドルのドラッグ → リサイズ（終了・開始時刻の変更）
 * - 矢印キーによる移動・リサイズ（フォーカス中のオカレンスに対して）
 * - ドラッグ中は Escape / pointercancel でキャンセルし、画面端に近づくと自動スクロールする
 * - イベント本体の移動ドラッグ中にポインタが終日行（`use-day-drag.ts` が担当する領域）に
 *   乗ると、終日イベントへの変換プレビューに切り替わる（Google カレンダー相当の
 *   「時間指定 ⇔ 終日」変換。反対方向の変換は `use-day-drag.ts` が担当する）
 *
 * プロップゲッターパターンを採用する。コンポーネントは
 * {@link TimeGridDragHandlers.getDayProps} などを対応する要素に
 * スプレッドするだけでインタラクションが有効になる。
 *
 * DOM 座標から日時への変換は、日列要素の矩形（`getBoundingClientRect`）と
 * {@link timeAtGridPosition} で行う。列要素は `getDayProps` が返す
 * `ref` コールバックで内部レジストリに登録される。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { dragPreviewRange, timeAtGridPosition } from '../core/interaction';
import {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  dateKeyInZone,
  minutesOfDayInZone,
  startOfDayInZone,
} from '../core/timezone';
import type {
  DateRange,
  EventOccurrence,
  PositionedOccurrence,
  RecurringEditScope,
  TimeGridDay,
  TimeZoneId,
} from '../core/types';
import {
  attachDragSessionListeners,
  autoScrollVelocity,
  checkBeforeEventChange,
  checkBeforeEventDelete,
  checkBeforeSelectRange,
  createAutoScrollLoop,
  resolveScopeForRecurring,
} from './drag-common';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/** 日列要素に付与する props。 */
export interface TimeGridDayProps {
  /** 列要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空き領域での作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** 日付キー（スタイルフック・ヒットテスト用）。 */
  'data-koyomi-date': string;
}

/** イベントブロック要素に付与する props。 */
export interface TimeGridEventProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** キーボード操作（Enter = クリック相当、Delete = 削除、矢印キー = 移動・リサイズ）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** オカレンスキー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`（薄く表示するなどのスタイルフック）。 */
  'data-koyomi-dragging'?: 'true';
}

/** リサイズハンドル要素に付与する props。 */
export interface TimeGridResizeHandleProps {
  /** リサイズドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * クリックの伝播を止める。移動のない pointerdown → pointerup の後に
   * 発生する click が親のイベント要素まで伝わり、誤って `onEventClick` を
   * 発火させてしまうのを防ぐ。
   */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** スタイルフック。どちらの端のハンドルかを示す。 */
  'data-koyomi-resize-handle': 'start' | 'end';
}

/** 1 日分のドラッグプレビューの表示位置。 */
export interface TimeGridPreviewSegment {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 日内の表示開始（分）。 */
  startMinutes: number;
  /** 日内の表示終了（分、排他）。 */
  endMinutes: number;
}

/** `useTimeGridDrag` が返すハンドラ集。 */
export interface TimeGridDragHandlers {
  /** 日列要素用の props を返す。 */
  getDayProps(day: TimeGridDay): TimeGridDayProps;
  /** イベントブロック用の props を返す。 */
  getEventProps(item: PositionedOccurrence): TimeGridEventProps;
  /**
   * リサイズハンドル用の props を返す。
   * @param edge - どちらの端のハンドルか。省略時は `'end'`（下端、終了時刻の変更）
   */
  getResizeHandleProps(
    item: PositionedOccurrence,
    edge?: 'start' | 'end',
  ): TimeGridResizeHandleProps;
  /**
   * 指定日のドラッグプレビュー区間を返す（その日に重ならなければ `null`）。
   * コンポーネントはこれをオーバーレイとして描画する。
   *
   * ドラッグ中のイベントが終日行への変換プレビュー中（`allDay: true`）の場合は
   * `null` を返す（そちらは `useDayDrag` 側の終日行プレビューが担当する）。
   */
  previewFor(day: TimeGridDay): TimeGridPreviewSegment | null;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録される列要素の情報。 */
interface ColumnEntry {
  /** 列の DOM 要素。 */
  element: HTMLElement;
  /** 列が表す日の 0:00（絶対時刻）。 */
  date: Date;
}

/** ドラッグセッション（開始から終了までの内部状態）。 */
interface DragSession {
  /** 操作の種類。`resize-start` は上端ハンドルによる開始時刻の変更。 */
  mode: 'create' | 'move' | 'resize' | 'resize-start';
  /** 対象のオカレンス（`create` では `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時のポインタ位置に対応する日時（スナップ済み）。 */
  anchor: Date;
  /**
   * セッション開始時点（ポインタが実質的に未移動の状態）を基準とするプレビュー範囲。
   * `create` ではクリック相当のプレビュー長（`anchor` から snap 分）、
   * `move` / `resize` / `resize-start` では対象オカレンスの現在の範囲
   * （`occurrence.start`〜`occurrence.end`）。
   * {@link DragSession.hasMoved} の判定基準として使う。
   */
  baselineRange: DateRange;
  /**
   * 実質的な移動があったか（計算された range が {@link DragSession.baselineRange} と
   * 異なったことが一度でもあるか）。
   *
   * 実ブラウザではクリック操作でも微小な pointermove が発生することがあるため、
   * 「pointermove が発生したか」ではなく「計算結果が変わったか」で判定する。
   * そうしないと通常クリックがドラッグ確定として扱われ、
   * クリック作成が `defaultEventMinutes` ではなく `snapMinutes` 長になったり、
   * クリックによる `onEventClick` が抑制されてしまったりする。
   */
  hasMoved: boolean;
  /**
   * 終日帯への変換ドラッグ中の確定用範囲。
   *
   * `mode === 'move'` のセッションでポインタが終日行（`allday-cells` /
   * `allday-cell` / `allday-row`）の上にある間だけ非 `null` になる。
   * 非 `null` の間に pointerup すると、この範囲・`allDay: true` で
   * 終日イベントへの変換として確定する（{@link TimeGridDragHandlers} 参照）。
   */
  allDayConversion: DateRange | null;
  /** document に登録したリスナーを解除し、オートスクロールを停止する。 */
  cleanup: () => void;
}

/**
 * セッション開始時点（ポインタ未移動）を基準とするプレビュー範囲を求める。
 *
 * - `create`（`occurrence === null`）— ポインタが `anchor` から動いていない場合に
 *   {@link dragPreviewRange} が返す範囲（クリック相当の snap 分の長さ）と同じ式で計算する
 * - `move` / `resize` / `resize-start`（`occurrence !== null`）— 対象オカレンスの現在の範囲そのもの。
 *   `anchor` からの移動量が 0 のときの {@link dragPreviewRange} の計算結果と一致する
 */
function baselineRangeForSession(
  occurrence: EventOccurrence | null,
  anchor: Date,
  context: { timeZone: string; snap: number },
): DateRange {
  if (occurrence === null) {
    return dragPreviewRange({ mode: 'create', occurrence: null, anchor }, anchor, context);
  }
  return { start: occurrence.start, end: occurrence.end };
}

/**
 * ドラッグセッションの種類を {@link TimeGridPreviewSegment.kind} に変換する。
 * `resize-start`（上端ハンドル）は見た目上は `resize` と同じプレビュー種別として扱う。
 */
function previewKindForMode(mode: DragSession['mode']): 'create' | 'move' | 'resize' {
  return mode === 'resize-start' ? 'resize' : mode;
}

/**
 * 列要素の矩形内でのポインタの縦位置（0〜1）を求める。
 * 矩形の高さが 0 以下の場合は 0 を返す（0 除算・NaN の防御）。
 */
function fractionYFromClientY(rect: DOMRect, clientY: number): number {
  if (rect.height <= 0) {
    return 0;
  }
  return (clientY - rect.top) / rect.height;
}

/** 1 日のミリ秒数。 */
const MS_PER_DAY = 86_400_000;

/** 終日行の領域を示す `data-koyomi` 属性のセレクタ（セル・行いずれの要素でも一致する）。 */
const ALLDAY_REGION_SELECTOR =
  '[data-koyomi="allday-cells"], [data-koyomi="allday-cell"], [data-koyomi="allday-row"]';

/**
 * ポインタ位置が終日行（`allday-cells` / `allday-cell` / `allday-row`）の上にあるかを判定する。
 *
 * `document.elementFromPoint` が存在しない環境（jsdom では未実装のことがある）では
 * 安全に「領域外」（`false`）と判定する。テストでは `vi.spyOn(document, 'elementFromPoint')`
 * でモックする。
 */
function isOverAlldayRegion(clientX: number, clientY: number): boolean {
  if (typeof document.elementFromPoint !== 'function') {
    return false;
  }
  const target = document.elementFromPoint(clientX, clientY);
  return target?.closest(ALLDAY_REGION_SELECTOR) != null;
}

/**
 * 日時範囲が表示タイムゾーンで何暦日にまたがるかを求める（最低でも 1）。
 *
 * `end` は排他的なので、`end` の 1 ミリ秒前が属する日を最終日とする
 * （終日変換時、時間指定オカレンスの複数日にまたがる長さを終日の日数に換算するために使う）。
 * 日数差は日付キーを UTC 0:00 に載せて求めるため、DST 切り替えの影響を受けない。
 */
function calendarDaySpan(range: DateRange, timeZone: TimeZoneId): number {
  const startKey = dateKeyInZone(range.start, timeZone);
  const lastInstant =
    range.end.getTime() > range.start.getTime() ? new Date(range.end.getTime() - 1) : range.start;
  const endKey = dateKeyInZone(lastInstant, timeZone);
  const startUtcMs = dateFromKey(startKey, 'UTC').getTime();
  const endUtcMs = dateFromKey(endKey, 'UTC').getTime();
  const diffDays = Math.round((endUtcMs - startUtcMs) / MS_PER_DAY);
  return Math.max(1, diffDays + 1);
}

/**
 * 矢印キー操作に対応する「操作種別・変更後の日時範囲」を計算する。
 * 対象外のキーなら `null` を返す。
 *
 * - `ArrowUp` / `ArrowDown` — オカレンスを ∓/± `snap` 分移動する（開始・終了とも現地時刻での移動）
 * - `Shift+ArrowUp` / `Shift+ArrowDown` — 終了時刻を ∓/± `snap` 分リサイズする。
 *   最小長 `snap` 分を下回る場合は変更しない（`range` は現状の範囲のまま返す）
 * - `ArrowLeft` / `ArrowRight` — オカレンスを ∓/± 1 日移動する
 */
function arrowKeyChange(
  occurrence: EventOccurrence,
  key: string,
  shiftKey: boolean,
  context: { timeZone: string; snap: number },
): { action: 'move' | 'resize'; range: DateRange } | null {
  const { timeZone, snap } = context;
  switch (key) {
    case 'ArrowUp':
      if (shiftKey) {
        const minEnd = addMinutesInZone(occurrence.start, snap, timeZone);
        const candidate = addMinutesInZone(occurrence.end, -snap, timeZone);
        const end = candidate.getTime() < minEnd.getTime() ? occurrence.end : candidate;
        return { action: 'resize', range: { start: occurrence.start, end } };
      }
      return {
        action: 'move',
        range: {
          start: addMinutesInZone(occurrence.start, -snap, timeZone),
          end: addMinutesInZone(occurrence.end, -snap, timeZone),
        },
      };
    case 'ArrowDown':
      if (shiftKey) {
        return {
          action: 'resize',
          range: {
            start: occurrence.start,
            end: addMinutesInZone(occurrence.end, snap, timeZone),
          },
        };
      }
      return {
        action: 'move',
        range: {
          start: addMinutesInZone(occurrence.start, snap, timeZone),
          end: addMinutesInZone(occurrence.end, snap, timeZone),
        },
      };
    case 'ArrowLeft':
      return {
        action: 'move',
        range: {
          start: addDaysInZone(occurrence.start, -1, timeZone),
          end: addDaysInZone(occurrence.end, -1, timeZone),
        },
      };
    case 'ArrowRight':
      return {
        action: 'move',
        range: {
          start: addDaysInZone(occurrence.start, 1, timeZone),
          end: addDaysInZone(occurrence.end, 1, timeZone),
        },
      };
    default:
      return null;
  }
}

/**
 * 時間グリッドのドラッグインタラクションを提供するフック。
 *
 * 変更の適用はライブラリが行う（`api.updateEvent` 相当）。繰り返し
 * イベントの場合は `callbacks.resolveRecurringScope` でスコープを解決し、
 * `null` が返ればキャンセルする。適用後に `callbacks.onEventChange` を呼ぶ。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 */
export function useTimeGridDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
}): TimeGridDragHandlers {
  // document レベルのリスナーはクロージャで最新の params を参照する必要があるため、
  // 常に最新値を保持する ref を経由してアクセスする（レンダーの度に同期する）。
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 日付キー → 列要素の登録レジストリ。 */
  const registryRef = useRef(new Map<string, ColumnEntry>());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const dragSessionRef = useRef<DragSession | null>(null);
  /** 直後の click イベントを 1 回だけ抑制するフラグ（ドラッグ確定・Escape キャンセル直後用）。 */
  const suppressNextClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // アンマウント時に進行中のセッションがあれば document リスナーを確実に解除する。
  useEffect(() => {
    return () => {
      dragSessionRef.current?.cleanup();
      dragSessionRef.current = null;
    };
  }, []);

  /**
   * インタラクション中の非同期処理で発生した例外を報告する。
   * `callbacks.onError` があればそれを呼び、なければ console.error に出力する
   * （{@link CalendarInteractionCallbacks.onError} の既定動作）。
   */
  function reportError(error: unknown): void {
    const onError = paramsRef.current.callbacks?.onError;
    if (onError) {
      onError(error);
      return;
    }
    // biome-ignore lint/suspicious/noConsole: onError 未指定時の既定動作
    console.error(error);
  }

  /**
   * clientX を含む列（なければ中心距離が最も近い列）を探す。
   * レジストリが空なら `null` を返す。
   */
  function findColumnForClientX(clientX: number): ColumnEntry | null {
    let containing: ColumnEntry | null = null;
    let nearest: ColumnEntry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of registryRef.current.values()) {
      const rect = entry.element.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        containing = entry;
        break;
      }
      const center = (rect.left + rect.right) / 2;
      const distance = Math.abs(clientX - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    return containing ?? nearest;
  }

  /** ポインタ位置に対応する列の日時（スナップ済み）を返す。列が見つからなければ `null`。 */
  function pointerDateAt(clientX: number, clientY: number): Date | null {
    const column = findColumnForClientX(clientX);
    if (column === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return timeAtGridPosition({
      day: column.date,
      fractionY: fractionYFromClientY(column.element.getBoundingClientRect(), clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
  }

  /** 現在のセッションとポインタ位置からプレビュー範囲を計算する。列が見つからなければ `null`。 */
  function computeRangeFromEvent(
    session: DragSession,
    clientX: number,
    clientY: number,
  ): DateRange | null {
    const pointer = pointerDateAt(clientX, clientY);
    if (pointer === null) {
      return null;
    }
    const { state } = paramsRef.current.calendar;
    return dragPreviewRange(
      { mode: session.mode, occurrence: session.occurrence, anchor: session.anchor },
      pointer,
      { timeZone: state.timeZone, snap: state.options.snapMinutes },
    );
  }

  /** クリック（移動なし）による新規作成範囲（`defaultEventMinutes` 分の長さ）を返す。 */
  function clickRangeForCreate(anchor: Date): DateRange {
    const { state } = paramsRef.current.calendar;
    return {
      start: anchor,
      end: addMinutesInZone(anchor, state.options.defaultEventMinutes, state.timeZone),
    };
  }

  /**
   * 作成ドラッグ（`create`）の確定処理。`onBeforeSelectRange` で拒否されなければ
   * 確定する。`onBeforeSelectRange` / `onSelectRange` / `createEvent` がアプリ側で
   * 例外を投げても、`finally` で必ずプレビューを消し、例外は `reportError`
   * （`onError`）へ流す（選択オーバーレイの残留防止）。
   */
  async function commitCreate(session: DragSession, nativeEvent: MouseEvent): Promise<void> {
    try {
      const range = session.hasMoved
        ? computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY)
        : clickRangeForCreate(session.anchor);
      if (range !== null) {
        const gate = checkBeforeSelectRange(paramsRef.current.callbacks, {
          range,
          allDay: false,
        });
        const allowed = typeof gate === 'boolean' ? gate : await gate;
        if (allowed) {
          const { calendar, callbacks } = paramsRef.current;
          if (callbacks?.onSelectRange) {
            callbacks.onSelectRange({ range, allDay: false });
          } else {
            calendar.api.createEvent({
              title: calendar.state.options.defaultEventTitle,
              start: range.start,
              end: range.end,
            });
          }
        }
      }
    } catch (error) {
      reportError(error);
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /**
   * オカレンスの日時範囲変更を実際に適用し、`onEventChange` を通知する（スコープ解決済みの前提）。
   *
   * 常に同期的に完結させる（`async` にしない）。`resolveRecurringScope` の解決を
   * ここに含めて `await` してしまうと、繰り返しでないオカレンスに対しても呼び出し元
   * （{@link commitMoveOrResize}）の完了が 1 マイクロタスク遅れてしまい、
   * ドラッグ確定直後にブラウザが発火するネイティブ `click` に対する
   * `suppressNextClickRef` の設定が間に合わなくなる。
   * ドラッグ確定（{@link commitMoveOrResize}）とキーボード操作の両方から共通で使う。
   */
  function applyOccurrenceRange(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange,
  ): void {
    const changes = paramsRef.current.calendar.api.updateEvent(
      occurrence.eventId,
      { start: range.start, end: range.end },
      recurringScope === null
        ? undefined
        : { occurrenceStart: occurrence.originalStart, scope: recurringScope },
    );
    paramsRef.current.callbacks?.onEventChange?.({
      occurrence,
      newRange: range,
      allDay: false,
      scope: recurringScope,
      changes,
    });
  }

  /**
   * 時間指定のオカレンスを終日イベントに変換して適用し、`onEventChange`（`allDay: true`）を
   * 通知する（スコープ解決済みの前提）。{@link applyOccurrenceRange} と同様、常に
   * 同期的に完結させる（理由も同じ）。
   */
  function applyAllDayConversion(
    occurrence: EventOccurrence,
    recurringScope: RecurringEditScope | null,
    range: DateRange,
  ): void {
    const changes = paramsRef.current.calendar.api.updateEvent(
      occurrence.eventId,
      { start: range.start, end: range.end, allDay: true },
      recurringScope === null
        ? undefined
        : { occurrenceStart: occurrence.originalStart, scope: recurringScope },
    );
    paramsRef.current.callbacks?.onEventChange?.({
      occurrence,
      newRange: range,
      allDay: true,
      scope: recurringScope,
      changes,
    });
  }

  /**
   * 移動・リサイズドラッグの確定処理。移動がなかった場合は何もしない（クリックは onClick に任せる）。
   *
   * `session.allDayConversion` が非 `null`（'move' セッション中にポインタが終日行の
   * 上で確定した）の場合は、その範囲・`allDay: true` で終日イベントへの変換として
   * 確定する（{@link applyAllDayConversion}）。それ以外は通常どおり時間指定のまま
   * 移動・リサイズを確定する。
   *
   * 単発オカレンス（繰り返しでない）の場合は `await` が一度も発生せず同期的に完結する
   * （{@link applyOccurrenceRange} 参照）。これは、ドラッグ確定直後にブラウザが
   * 発火するネイティブ `click` に対して `suppressNextClickRef` の設定を間に合わせるために
   * 必要（繰り返しオカレンスの場合のみ `resolveRecurringScope` の解決を待つ）。
   *
   * `finally` で必ず `setDragPreview(null)` を呼ぶ。`resolveRecurringScope` が
   * 例外を投げた場合や途中で早期リターンした場合でもプレビューが残留しないようにするため。
   */
  async function commitMoveOrResize(session: DragSession, nativeEvent: MouseEvent): Promise<void> {
    try {
      if (!session.hasMoved) {
        return;
      }
      const occurrence = session.occurrence;
      if (occurrence === null) {
        return;
      }
      // ネイティブ click の抑止フラグは、繰り返しの scope 解決（`await`）より前に
      // 同期で立てる。await 後だと click が抑止前に到達し onEventClick が誤発火し得る
      // （day drag と同じ扱い）。ドラッグで移動した以上、後続 click は常に抑止してよい。
      suppressNextClickRef.current = true;
      if (session.allDayConversion !== null) {
        const conversionRange = session.allDayConversion;
        const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
          occurrence,
          range: conversionRange,
          allDay: true,
          action: 'convert',
        });
        const allowed = typeof gate === 'boolean' ? gate : await gate;
        if (!allowed) {
          return;
        }
        let conversionScope: RecurringEditScope | null = null;
        if (occurrence.isRecurring) {
          const resolved = await resolveScopeForRecurring(
            paramsRef.current.callbacks,
            occurrence,
            'move',
          );
          if (resolved === null) {
            return;
          }
          conversionScope = resolved;
        }
        applyAllDayConversion(occurrence, conversionScope, conversionRange);
        return;
      }
      const range = computeRangeFromEvent(session, nativeEvent.clientX, nativeEvent.clientY);
      if (range === null) {
        return;
      }
      const action: 'move' | 'resize' = session.mode === 'move' ? 'move' : 'resize';
      const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
        occurrence,
        range,
        allDay: false,
        action,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        return;
      }
      let recurringScope: RecurringEditScope | null = null;
      if (occurrence.isRecurring) {
        const resolved = await resolveScopeForRecurring(
          paramsRef.current.callbacks,
          occurrence,
          action,
        );
        if (resolved === null) {
          return;
        }
        recurringScope = resolved;
      }
      applyOccurrenceRange(occurrence, recurringScope, range);
    } finally {
      paramsRef.current.calendar.api.setDragPreview(null);
    }
  }

  /** セッションの種類に応じて確定処理を振り分ける。 */
  function commitSession(session: DragSession, nativeEvent: MouseEvent): void {
    if (session.mode === 'create') {
      void commitCreate(session, nativeEvent).catch(reportError);
      return;
    }
    void commitMoveOrResize(session, nativeEvent).catch(reportError);
  }

  /**
   * ドラッグセッションを開始する。document に pointermove / pointerup / pointercancel /
   * keydown のリスナーを登録し、`cleanup` でそれらを解除できるようにする。
   */
  function startSession(
    mode: DragSession['mode'],
    occurrence: EventOccurrence | null,
    anchor: Date,
  ): void {
    // 前のセッションが残っていれば（通常発生しないが）先に後始末する。
    dragSessionRef.current?.cleanup();

    const { state } = paramsRef.current.calendar;
    const baselineRange = baselineRangeForSession(occurrence, anchor, {
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });

    // オートスクロール用のループ。セッションごとに独立させるため startSession の
    // クロージャ内に閉じ込める（同時に有効なドラッグセッションは 1 つだけなので安全）。
    const autoScroll = createAutoScrollLoop('vertical');

    /** ポインタ位置からオートスクロールの要否・速度を求め、必要なら rAF ループを開始する。 */
    const updateAutoScroll = (clientX: number, clientY: number): void => {
      const column = findColumnForClientX(clientX);
      const container = column?.element.closest('[data-koyomi="timegrid-body"]') ?? null;
      if (container === null) {
        autoScroll.stop();
        return;
      }
      const rect = container.getBoundingClientRect();
      autoScroll.update(
        container,
        autoScrollVelocity({ edgeStart: rect.top, edgeEnd: rect.bottom, pointer: clientY }),
      );
    };

    const session: DragSession = {
      mode,
      occurrence,
      anchor,
      baselineRange,
      hasMoved: false,
      allDayConversion: null,
      cleanup: () => {
        detachListeners();
        autoScroll.stop();
      },
    };

    /** ドラッグを中断してプレビューを破棄する（コミットしない）。Escape / pointercancel 共通の経路。 */
    const cancelSession = (): void => {
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      paramsRef.current.calendar.api.setDragPreview(null);
    };

    // jsdom は PointerEvent 未実装のことがあるため、MouseEvent 互換の型で受け取る。
    const handlePointerMove = (nativeEvent: MouseEvent): void => {
      const { clientX, clientY } = nativeEvent;

      // 'move' セッション中にポインタが終日行の上にあれば、終日帯への変換プレビューに切り替える。
      if (
        session.mode === 'move' &&
        session.occurrence !== null &&
        isOverAlldayRegion(clientX, clientY)
      ) {
        const column = findColumnForClientX(clientX);
        if (column !== null) {
          // 終日行の上ではグリッド本体のオートスクロールは不要。
          autoScroll.stop();
          const { state } = paramsRef.current.calendar;
          const occurrence = session.occurrence;
          const dayCount = calendarDaySpan(
            { start: occurrence.start, end: occurrence.end },
            state.timeZone,
          );
          const range: DateRange = {
            start: column.date,
            end: addDaysInZone(column.date, dayCount, state.timeZone),
          };
          session.hasMoved = true;
          session.allDayConversion = range;
          paramsRef.current.calendar.api.setDragPreview({
            kind: 'move',
            occurrenceKey: occurrence.key,
            range,
            allDay: true,
          });
          return;
        }
      }

      // 終日行の外に戻った（または最初から終日行上でない）場合は変換を解除する。
      session.allDayConversion = null;
      updateAutoScroll(clientX, clientY);
      const range = computeRangeFromEvent(session, clientX, clientY);
      if (range === null) {
        return;
      }
      if (
        range.start.getTime() !== session.baselineRange.start.getTime() ||
        range.end.getTime() !== session.baselineRange.end.getTime()
      ) {
        session.hasMoved = true;
      }
      paramsRef.current.calendar.api.setDragPreview({
        kind: previewKindForMode(session.mode),
        occurrenceKey: session.occurrence?.key ?? null,
        range,
        allDay: false,
      });
    };

    const handlePointerUp = (nativeEvent: MouseEvent): void => {
      session.cleanup();
      dragSessionRef.current = null;
      setIsDragging(false);
      commitSession(session, nativeEvent);
    };

    const handlePointerCancel = (): void => {
      cancelSession();
    };

    const handleKeyDown = (nativeEvent: KeyboardEvent): void => {
      if (nativeEvent.key !== 'Escape') {
        return;
      }
      // 直後に発火するネイティブ click で onEventClick が誤って発火しないようにする。
      suppressNextClickRef.current = true;
      cancelSession();
    };

    const detachListeners = attachDragSessionListeners({
      pointermove: handlePointerMove,
      pointerup: handlePointerUp,
      pointercancel: handlePointerCancel,
      keydown: handleKeyDown,
    });

    dragSessionRef.current = session;
    setIsDragging(true);
  }

  /** 空き領域での作成ドラッグを開始する。 */
  function handleDayPointerDown(day: TimeGridDay, event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const { state } = paramsRef.current.calendar;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = timeAtGridPosition({
      day: day.date,
      fractionY: fractionYFromClientY(rect, event.clientY),
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
    startSession('create', null, anchor);
  }

  /** ポインタ位置が乗っている列を基準にアンカー日時を求める（列が未登録なら fallback を使う）。 */
  function anchorFromPointer(event: ReactPointerEvent<HTMLElement>, fallback: Date): Date {
    return pointerDateAt(event.clientX, event.clientY) ?? fallback;
  }

  /**
   * イベント本体のドラッグ（移動）を開始する。`editable: false` の場合は開始しない。
   *
   * `stopPropagation` は開始の可否によらず常に呼ぶ。呼ばないと `editable: false`
   * のイベントでポインタ操作が列（`getDayProps`）まで伝播し、意図せず
   * その列の作成ドラッグが始まってしまう。
   */
  function handleEventPointerDown(
    occurrence: EventOccurrence,
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    startSession('move', occurrence, anchorFromPointer(event, occurrence.start));
  }

  /**
   * リサイズハンドルのドラッグを開始する。`editable: false` の場合は開始しない。
   * `stopPropagation` を常に呼ぶ理由は {@link handleEventPointerDown} と同じ。
   *
   * @param edge - `'end'`（下端、終了時刻の変更）か `'start'`（上端、開始時刻の変更）か
   */
  function handleResizePointerDown(
    occurrence: EventOccurrence,
    edge: 'start' | 'end',
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    event.stopPropagation();
    if (occurrence.event.editable === false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (edge === 'start') {
      startSession('resize-start', occurrence, anchorFromPointer(event, occurrence.start));
      return;
    }
    startSession('resize', occurrence, anchorFromPointer(event, occurrence.end));
  }

  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。ドラッグ確定直後は 1 回だけ抑制する。 */
  function handleEventClick(
    occurrence: EventOccurrence,
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    paramsRef.current.callbacks?.onEventClick?.(occurrence, event.nativeEvent);
  }

  /**
   * 繰り返しオカレンスの削除。スコープ解決が必要な場合は解決してから削除する。
   * `editable: false` のイベントは削除しない（ドラッグ移動・リサイズと同じ扱い）。
   * 削除が実際に適用された後（スコープ解決がキャンセルでなかった場合）に
   * `callbacks.onEventDelete` を通知する。
   */
  async function deleteOccurrence(occurrence: EventOccurrence): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    const gate = checkBeforeEventDelete(paramsRef.current.callbacks, occurrence);
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      return;
    }
    if (!occurrence.isRecurring) {
      const changes = paramsRef.current.calendar.api.deleteEvent(occurrence.eventId);
      paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope: null, changes });
      return;
    }
    const scope = await resolveScopeForRecurring(paramsRef.current.callbacks, occurrence, 'delete');
    if (scope === null) {
      return;
    }
    const changes = paramsRef.current.calendar.api.deleteEvent(occurrence.eventId, {
      occurrenceStart: occurrence.originalStart,
      scope,
    });
    paramsRef.current.callbacks?.onEventDelete?.({ occurrence, scope, changes });
  }

  /**
   * 矢印キー操作による変更を確定する。単発オカレンスの場合は `await` を発生させず
   * 同期的に完結する（{@link commitMoveOrResize} と同じ理由）。
   */
  async function commitArrowKeyChange(
    occurrence: EventOccurrence,
    action: 'move' | 'resize',
    range: DateRange,
  ): Promise<void> {
    const gate = checkBeforeEventChange(paramsRef.current.callbacks, {
      occurrence,
      range,
      allDay: false,
      action,
    });
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      return;
    }
    let recurringScope: RecurringEditScope | null = null;
    if (occurrence.isRecurring) {
      const resolved = await resolveScopeForRecurring(
        paramsRef.current.callbacks,
        occurrence,
        action,
      );
      if (resolved === null) {
        return;
      }
      recurringScope = resolved;
    }
    applyOccurrenceRange(occurrence, recurringScope, range);
  }

  /**
   * キーボード操作。
   * - `Enter` / `Space` — クリック相当（`onEventClick` を呼ぶ）
   * - `Delete` / `Backspace` — 削除
   * - `ArrowUp` / `ArrowDown` — ± `snapMinutes` 分移動、`Shift` 併用で終了時刻を
   *   ∓/± `snapMinutes` 分リサイズ
   * - `ArrowLeft` / `ArrowRight` — ∓/± 1 日移動
   *
   * 矢印キーの操作は認識した時点で `preventDefault` を呼ぶ。`editable: false` の
   * オカレンスには適用しない。繰り返しオカレンスは `resolveRecurringScope` で解決し、
   * `null` ならキャンセルする。
   */
  function handleEventKeyDown(
    occurrence: EventOccurrence,
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void deleteOccurrence(occurrence).catch(reportError);
      return;
    }

    const { state } = paramsRef.current.calendar;
    const change = arrowKeyChange(occurrence, event.key, event.shiftKey, {
      timeZone: state.timeZone,
      snap: state.options.snapMinutes,
    });
    if (change === null) {
      return;
    }
    event.preventDefault();
    if (occurrence.event.editable === false) {
      return;
    }
    if (
      change.range.start.getTime() === occurrence.start.getTime() &&
      change.range.end.getTime() === occurrence.end.getTime()
    ) {
      // 最小長のクランプなどで実質的な変更がない場合は何もしない
      return;
    }
    void commitArrowKeyChange(occurrence, change.action, change.range).catch(reportError);
  }

  function getDayProps(day: TimeGridDay): TimeGridDayProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(day.key);
        } else {
          registryRef.current.set(day.key, { element, date: day.date });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleDayPointerDown(day, event);
      },
      'data-koyomi-date': day.key,
    };
  }

  function getEventProps(item: PositionedOccurrence): TimeGridEventProps {
    const occurrence = item.occurrence;
    const base: TimeGridEventProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleEventPointerDown(occurrence, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        handleEventClick(occurrence, event);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        handleEventKeyDown(occurrence, event);
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
    };
    if (dragSessionRef.current?.occurrence?.key === occurrence.key) {
      return { ...base, 'data-koyomi-dragging': 'true' };
    }
    return base;
  }

  function getResizeHandleProps(
    item: PositionedOccurrence,
    edge: 'start' | 'end' = 'end',
  ): TimeGridResizeHandleProps {
    const occurrence = item.occurrence;
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        handleResizePointerDown(occurrence, edge, event);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      'data-koyomi-resize-handle': edge,
    };
  }

  function previewFor(day: TimeGridDay): TimeGridPreviewSegment | null {
    const { state } = paramsRef.current.calendar;
    const preview = state.dragPreview;
    if (preview === null || preview.allDay) {
      return null;
    }
    const timeZone = state.timeZone;
    const dayStart = day.date;
    // 翌日の 0:00 を正規化して用いる（深夜 0:00 が存在しない DST 切替日で、
    // 翌日 0:00 台のプレビューが前日列へ交差するのを防ぐ）。
    const dayEnd = startOfDayInZone(addDaysInZone(dayStart, 1, timeZone), timeZone);
    if (
      preview.range.end.getTime() <= dayStart.getTime() ||
      preview.range.start.getTime() >= dayEnd.getTime()
    ) {
      return null;
    }
    const startsInDay = preview.range.start.getTime() >= dayStart.getTime();
    const endsAtOrAfterDayEnd = preview.range.end.getTime() >= dayEnd.getTime();
    return {
      kind: preview.kind,
      startMinutes: startsInDay ? minutesOfDayInZone(preview.range.start, timeZone) : 0,
      endMinutes: endsAtOrAfterDayEnd ? 1440 : minutesOfDayInZone(preview.range.end, timeZone),
    };
  }

  return {
    getDayProps,
    getEventProps,
    getResizeHandleProps,
    previewFor,
    isDragging,
  };
}
