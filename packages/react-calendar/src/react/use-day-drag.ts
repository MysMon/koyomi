/**
 * @packageDocumentation
 * 日単位のドラッグインタラクション（月ビューのセル・終日行）。
 *
 * - セルのクリック / ドラッグ / キーボード（Enter・Space） → 日範囲の選択（終日イベントの新規作成）
 * - 帯セグメントのドラッグ → 日単位の移動（期間・現地時刻は維持）
 * - 帯セグメントの左右端ハンドルのドラッグ → 日単位のリサイズ（開始日・終了日の変更）
 * - 帯セグメントのキーボード操作（矢印キー） → 日単位の移動・リサイズ
 * - ドラッグ中は Escape または pointercancel でキャンセル
 * - 帯セグメントの移動ドラッグ中にポインタが時間グリッドの日列（`use-time-grid-drag.ts`
 *   が担当する領域）に乗ると、時間指定イベントへの変換プレビューに切り替わる
 *   （Google カレンダー相当の「終日 ⇔ 時間指定」変換。反対方向の変換は
 *   `use-time-grid-drag.ts` が担当する）
 * - フォーカス中の終日の帯の A キー → 時間指定イベントへの変換（変換ドラッグと同じ
 *   `action: 'convert'` のキーボード経路。opt-in の `keyboardTimedConversion` を
 *   指定した場合（週/日ビューの終日行）のみ有効で、月ビューでは何もしない）
 *
 * 時間グリッドと同様のプロップゲッターパターン。セル要素は
 * `getDayCellProps` の `ref` でレジストリに登録され、ポインタ座標から
 * 現在乗っている日を判定する。
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  isDragCandidateValid,
  occurrenceBlocksOverlap,
  resolveConstraintRules,
} from '../core/constraints';
import type { DayDragMode } from '../core/interaction';
import { dayDragPreviewRange, timeAtGridPosition } from '../core/interaction';
import {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  parseSlotBoundaryTime,
  startOfDayInZone,
} from '../core/timezone';
import type {
  BusinessHoursRule,
  DateRange,
  EventChangeEntry,
  EventOccurrence,
  EventSegment,
  RecurringEditScope,
  ResolvedCalendarOptions,
} from '../core/types';
import {
  allDayPatchRange,
  captureOccurrenceDeleteFocusContext,
  checkBeforeEventChange,
  checkBeforeEventDelete,
  checkBeforeSelectRange,
  collectOverlapBlockersInRange,
  createDefaultEvent,
  createOccurrenceDeleteFocusController,
  createOverlapBlockerCache,
  type EventNotificationProps,
  eventNotificationProps,
  type OccurrenceDeleteFocusContext,
  reportOperationRejected,
} from './drag-common';
import type { CalendarInteractionCallbacks, UseCalendarResult } from './types';

/**
 * このフックが担当するビュー（月・複数月ビュー、週/日ビューの終日行）のルート要素の
 * セレクタ。`captureOccurrenceDeleteFocusContext` の `viewRootSelector` に渡す。
 * 月・複数月ビューはどちらもルートに `data-koyomi="month"` を持ち
 * （複数月ビューは月ごとのセクション単位）、週/日ビューの終日行は `use-time-grid-drag.ts`
 * と共有するビュー全体のルート `data-koyomi="timegrid"` の内側にある。
 */
const DAY_DRAG_VIEW_ROOT_SELECTOR = '[data-koyomi="month"], [data-koyomi="timegrid"]';

/** 日セル要素に付与する props。 */
export interface DayCellProps {
  /** セル要素の登録用 ref。 */
  ref: Ref<HTMLElement>;
  /** 空きセルでの作成ドラッグを開始する。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** キーボード操作（Enter・Space = その日 1 日分の範囲選択）。 */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** 日付キー。 */
  'data-koyomi-date': string;
}

/** 帯セグメント要素に付与する props。 */
export interface SegmentProps extends EventNotificationProps {
  /** 移動ドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** クリック（ドラッグに至らなかった場合）で `onEventClick` を呼ぶ。 */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * キーボード操作。
   * - Enter / Space = クリック相当
   * - Delete / Backspace = 削除
   * - A = 時間指定イベントへの変換（opt-in の `keyboardTimedConversion` 指定時、
   *   終日のオカレンスのみ）
   * - ArrowLeft / ArrowRight = 1 日移動
   * - ArrowUp / ArrowDown = 7 日移動
   * - Shift+ArrowLeft / Shift+ArrowRight = 終了日を 1 日リサイズ（最低 1 日分の長さを維持）
   */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカス可能にする。 */
  tabIndex: number;
  /** オカレンスキー。 */
  'data-koyomi-occurrence': string;
  /** ドラッグ中の対象なら `'true'`。 */
  'data-koyomi-dragging'?: 'true';
}

/** 帯セグメントのリサイズハンドル要素に付与する props。 */
export interface SegmentResizeHandleProps {
  /** リサイズドラッグを開始する（`editable: false` の場合は何もしない）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * クリックの伝播を止める。移動のない pointerdown → pointerup の後に
   * 発生する click が親のセグメント要素まで伝わり、誤って `onEventClick` を
   * 発火させてしまうのを防ぐ。
   */
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** スタイルフック。どちらの端のハンドルかを示す。 */
  'data-koyomi-resize-handle': 'start' | 'end';
}

/** `useDayDrag` が返すハンドラ集。 */
export interface DayDragHandlers {
  /** 日セル用の props を返す。 */
  getDayCellProps(day: { date: Date; key: string }): DayCellProps;
  /** 帯セグメント用の props を返す。 */
  getSegmentProps(segment: EventSegment): SegmentProps;
  /** 帯セグメントの左右端リサイズハンドル用の props を返す。 */
  getSegmentResizeHandleProps(
    segment: EventSegment,
    edge: 'start' | 'end',
  ): SegmentResizeHandleProps;
  /**
   * 現在のドラッグプレビューの日範囲（日 0:00 起点、`end` 排他）。
   * コンポーネントは各週に投影してハイライトを描画する。
   *
   * ドラッグ中のイベントが時間グリッドへの変換プレビュー中（`allDay: false`）の
   * 場合は `null` を返す（そちらは `useTimeGridDrag` 側のプレビューが担当する）。
   */
  previewRange: DateRange | null;
  /**
   * 現在のドラッグプレビューが宣言的制約（`eventOverlap` / `eventConstraint`）に
   * 違反しているか。ドラッグ中でない、または時間グリッドへの変換プレビュー中は常に `false`。
   */
  previewInvalid: boolean;
  /** ドラッグ操作が進行中か。 */
  isDragging: boolean;
}

/** レジストリに登録された日セルの情報。 */
interface RegisteredDayCell {
  /** セルの DOM 要素。 */
  element: HTMLElement;
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
}

/** 進行中のドラッグセッションの内部状態。 */
interface DragSession {
  /** 作成・移動・リサイズ（左右端）のいずれか。 */
  kind: DayDragMode;
  /** 移動ドラッグの対象オカレンス（作成ドラッグでは `null`）。 */
  occurrence: EventOccurrence | null;
  /** ドラッグ開始時に確定した基準日（その日の 0:00）。 */
  anchorDay: Date;
  /**
   * ポインタが実際に動いたか（クリックとの区別に使う）。
   * 基準日（`anchorDay`）と異なる日に一度でも乗った場合にのみ `true` にする。
   * 単に pointermove が発火しただけ（同じセル内の微小な揺れ）では `true` にしない。
   */
  moved: boolean;
  /**
   * 時間グリッドへの変換ドラッグ中の確定用範囲。
   *
   * `kind === 'move'` のセッションでポインタが時間グリッドの日列
   * （`timegrid-day`）の上にある間だけ非 `null` になる。非 `null` の間に
   * pointerup すると、この範囲・`allDay: false` で時間指定イベントへの
   * 変換として確定する（`use-time-grid-drag.ts` 側の終日変換と対になる機能）。
   */
  timedConversion: DateRange | null;
  /** このセッションが登録した document リスナーを解除する関数。 */
  cleanup: () => void;
}

/** 時間グリッドの日列要素を示す `data-koyomi` 属性のセレクタ。 */
const TIMEGRID_DAY_SELECTOR = '[data-koyomi="timegrid-day"]';

/**
 * ポインタ位置が時間グリッドの日列（`timegrid-day`）の上にあれば、その列要素を返す。
 * 月ビューには `timegrid-day` が存在しないため、月ビューでは常に `null` になる。
 *
 * `document.elementFromPoint` が存在しない環境（jsdom では未実装のことがある）では
 * 安全に「領域外」（`null`）と判定する。テストでは `vi.spyOn(document, 'elementFromPoint')`
 * でモックする。
 */
function findTimeGridDayColumn(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') {
    return null;
  }
  const target = document.elementFromPoint(clientX, clientY);
  const match = target?.closest(TIMEGRID_DAY_SELECTOR) ?? null;
  return match instanceof HTMLElement ? match : null;
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

/**
 * 動かしている側の overlap 実効値（重なりを拒否するか）を求める。
 * 新規作成（`occurrence` が `null`）では動かしている側の個別設定が存在しないため、
 * グローバル `eventOverlap` をそのまま動かしている側の値として使う。
 */
function resolveMoverBlocksOverlap(
  occurrence: EventOccurrence | null,
  eventOverlap: boolean,
): boolean {
  return occurrence === null
    ? eventOverlap === false
    : occurrenceBlocksOverlap(occurrence.event, eventOverlap);
}

/**
 * 対象（新規作成は `null`）に適用される配置制約の実効ルールを解決する。
 * イベント個別の `constraint` が優先され、未指定ならグローバル `eventConstraint` を使う。
 */
function resolveConstraintRulesForOccurrence(
  occurrence: EventOccurrence | null,
  eventConstraint: ResolvedCalendarOptions['eventConstraint'],
  businessHours: readonly BusinessHoursRule[],
): readonly BusinessHoursRule[] | null {
  return resolveConstraintRules(occurrence?.event.constraint ?? eventConstraint, businessHours);
}

/**
 * 終日 ⇔ 時間指定変換のキーボードトグル（A キー）かどうかを判定する。
 *
 * 大文字（Shift や CapsLock による `'A'`）も対象にする。Ctrl / Cmd / Alt を伴う場合は
 * ブラウザ・OS のショートカット（Ctrl+A の全選択等）を奪わないため対象外にする
 * （Shift は大文字の `'A'` を入力する手段そのものなので除外しない）。
 * `use-time-grid-drag.ts` の同名関数と対の実装（判定を変える場合は両方を同期させること。
 * 共有ヘルパー化しないのは、判定 1 つのために内部モジュール間の依存を増やさないため）。
 */
function isConversionToggleKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    (event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

/**
 * A キーによる終日 → 時間指定変換（キーボード経路）の opt-in 設定
 * （{@link useDayDrag} の `keyboardTimedConversion`）。
 *
 * 指定すると、フォーカス中の終日イベントの帯で A キー（大文字小文字とも。
 * Ctrl / Cmd / Alt 併用は対象外）を押したとき、開始日の {@link rangeStartMinutes} から
 * `defaultEventMinutes` 分の時間指定イベントへ変換する（ポインタの変換ドラッグと同じ
 * `action: 'convert'` として適用前フック・拒否通知が配線される）。未指定のビュー
 * （月・複数月ビュー）では A キーは何もしない。
 */
export interface DayDragKeyboardTimedConversion {
  /**
   * 変換先の開始時刻（日の 0:00 からの分）。週/日ビューでは表示時間帯の開始
   * （`slotMinTime` の分換算）を渡す。
   */
  rangeStartMinutes: number;
}

/**
 * 日単位ドラッグのインタラクションを提供するフック。
 *
 * 月ビューでは時間指定イベントの帯（span 1）も日単位で移動できる
 * （Google カレンダーの月ビューと同じ。現地時刻は維持される）。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.callbacks - インタラクションコールバック
 * @param params.defaultEventTitle - 既定即時作成（空きセルのクリック/ドラッグ）で使うイベントタイトル。
 *   省略時は {@link createDefaultEvent} の既定値
 * @param params.keyboardTimedConversion - A キーによる終日 → 時間指定変換の opt-in 設定
 *   （{@link DayDragKeyboardTimedConversion}）。週/日ビューの終日行（`TimeGridView`）が
 *   指定する。省略時（月・複数月ビュー）は A キーは何もしない
 */
export function useDayDrag(params: {
  calendar: UseCalendarResult;
  callbacks?: CalendarInteractionCallbacks;
  defaultEventTitle?: string;
  keyboardTimedConversion?: DayDragKeyboardTimedConversion;
}): DayDragHandlers {
  const { calendar, callbacks } = params;

  /** ポインタ座標 → 日の判定に使う、登録済みセルのレジストリ。 */
  const registryRef = useRef<Map<string, RegisteredDayCell>>(new Map());
  /** {@link collectOverlapBlockersInRange} の展開結果キャッシュ（本フック内で使い回す）。 */
  const overlapCacheRef = useRef(createOverlapBlockerCache());
  /** 進行中のドラッグセッション（非ドラッグ中は `null`）。 */
  const sessionRef = useRef<DragSession | null>(null);
  /**
   * 直後の click イベントを 1 回だけ抑制するフラグ。
   * ブラウザは pointerup の後に click を自動発火するため、ドラッグ移動が確定した
   * 直後のその click では `onEventClick` を誤って発火させたくない
   * （`use-time-grid-drag.ts` の `suppressNextClickRef` と同じパターン）。
   */
  const suppressNextClickRef = useRef(false);
  /** キーボード削除後のフォーカス復帰を管理するコントローラ（本フック内で使い回す）。 */
  const deleteFocusControllerRef = useRef(createOccurrenceDeleteFocusController());

  // document に登録するリスナーは pointerdown 発火時点でクロージャとして
  // 生成されるため、常に最新の api / timeZone / callbacks を参照できるよう ref に保持する
  const apiRef = useRef(calendar.api);
  apiRef.current = calendar.api;
  const timeZoneRef = useRef(calendar.state.timeZone);
  timeZoneRef.current = calendar.state.timeZone;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  /** 時間グリッドへの変換ドラッグ（`snapMinutes` / `defaultEventMinutes`）で参照する。 */
  const optionsRef = useRef<ResolvedCalendarOptions>(calendar.state.options);
  optionsRef.current = calendar.state.options;
  const defaultEventTitleRef = useRef(params.defaultEventTitle);
  defaultEventTitleRef.current = params.defaultEventTitle;
  /** A キーによる終日 → 時間指定変換の opt-in 設定（未指定なら A キーは何もしない）。 */
  const keyboardTimedConversionRef = useRef(params.keyboardTimedConversion);
  keyboardTimedConversionRef.current = params.keyboardTimedConversion;

  // アンマウント時、ドラッグ中であれば document リスナーを解除する
  useEffect(() => {
    return () => {
      sessionRef.current?.cleanup();
      sessionRef.current = null;
    };
  }, []);

  // キーボード削除確定後、DOM 更新完了後（再レンダー後）に一度だけフォーカス解決を試みる
  // （`virtual-resource-view.tsx` の pinned フォーカス復元と同じ「無条件・毎レンダーの
  // useLayoutEffect」パターン）。
  useLayoutEffect(() => {
    deleteFocusControllerRef.current.consume();
  });

  /**
   * clientX/clientY の位置に対応する日を、登録済みセルから探す。
   * 矩形に座標が含まれるセルを優先し、なければ中心距離が最も近いセルを返す。
   * セルが 1 件も登録されていない場合は `null` を返す。
   */
  function locateDay(clientX: number, clientY: number): Date | null {
    let containing: Date | null = null;
    let nearest: Date | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const cell of registryRef.current.values()) {
      const rect = cell.element.getBoundingClientRect();
      if (
        containing === null &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        containing = cell.date;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = (clientX - centerX) ** 2 + (clientY - centerY) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = cell.date;
      }
    }
    return containing ?? nearest;
  }

  /**
   * インタラクション中の非同期処理が失敗した場合のエラー処理。
   * `callbacks.onError` があればそれに委譲し、なければ既定動作として
   * console.error に出力する。
   */
  function reportError(error: unknown): void {
    const onError = callbacksRef.current?.onError;
    if (onError !== undefined) {
      onError(error);
      return;
    }
    // biome-ignore lint/suspicious/noConsole: onError 未指定時の既定動作
    console.error(error);
  }

  /** `DayDragMode` を見た目上のプレビュー種別に変換する（左右端リサイズはどちらも `'resize'`）。 */
  function toPreviewKind(mode: DayDragMode): 'create' | 'move' | 'resize' {
    if (mode === 'create') {
      return 'create';
    }
    if (mode === 'move') {
      return 'move';
    }
    return 'resize';
  }

  /** オカレンスを指定日数だけずらした範囲を返す（時間指定なら現地時刻を維持）。 */
  function shiftedRange(occurrence: EventOccurrence, days: number): DateRange {
    const timeZone = timeZoneRef.current;
    return {
      start: addDaysInZone(occurrence.start, days, timeZone),
      end: addDaysInZone(occurrence.end, days, timeZone),
    };
  }

  /**
   * 範囲選択を確定する（`onBeforeSelectRange` で拒否されなければ、`onSelectRange` が
   * あればそれを呼び、なければ即時作成する）。
   */
  async function commitSelection(range: DateRange): Promise<void> {
    const options = optionsRef.current;
    const valid = isDragCandidateValid({
      range,
      allDay: true,
      excludeKey: null,
      moverBlocksOverlap: resolveMoverBlocksOverlap(null, options.eventOverlap),
      blockers: collectOverlapBlockersInRange(
        apiRef.current,
        overlapCacheRef.current,
        range,
        options.eventOverlap,
      ),
      constraintRules: resolveConstraintRulesForOccurrence(
        null,
        options.eventConstraint,
        options.businessHours,
      ),
      timeZone: timeZoneRef.current,
    });
    if (!valid) {
      reportOperationRejected(callbacksRef.current, { action: 'create', reason: 'constraint' });
      return;
    }
    const gate = checkBeforeSelectRange(callbacksRef.current, { range, allDay: true });
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      reportOperationRejected(callbacksRef.current, { action: 'create', reason: 'rejected' });
      return;
    }
    const onSelectRange = callbacksRef.current?.onSelectRange;
    if (onSelectRange !== undefined) {
      onSelectRange({ range, allDay: true });
      return;
    }
    createDefaultEvent(
      apiRef.current,
      { range, allDay: true },
      defaultEventTitleRef.current,
      callbacksRef.current,
    );
  }

  /**
   * オカレンスの範囲変更（移動・リサイズ）を確定する（繰り返しならスコープを解決してから適用する）。
   * `action` は `resolveRecurringScope` に渡す操作種別（既定は `'move'`）。
   * 失敗時にドラッグプレビューが残らないよう、`finally` で確実に解除する
   * （ドラッグ確定経路では呼び出し前に同期的にも解除しているため二重になるが、
   * キーボード操作など他の経路から呼ばれた場合の安全策として保持する）。
   */
  async function commitMove(
    occurrence: EventOccurrence,
    range: DateRange,
    action: 'move' | 'resize' = 'move',
  ): Promise<void> {
    try {
      const options = optionsRef.current;
      const valid = isDragCandidateValid({
        range,
        allDay: occurrence.allDay,
        excludeKey: occurrence.key,
        moverBlocksOverlap: resolveMoverBlocksOverlap(occurrence, options.eventOverlap),
        blockers: collectOverlapBlockersInRange(
          apiRef.current,
          overlapCacheRef.current,
          range,
          options.eventOverlap,
        ),
        constraintRules: resolveConstraintRulesForOccurrence(
          occurrence,
          options.eventConstraint,
          options.businessHours,
        ),
        timeZone: timeZoneRef.current,
      });
      if (!valid) {
        reportOperationRejected(callbacksRef.current, { action, reason: 'constraint', occurrence });
        return;
      }
      const gate = checkBeforeEventChange(callbacksRef.current, {
        occurrence,
        range,
        allDay: occurrence.allDay,
        action,
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        reportOperationRejected(callbacksRef.current, { action, reason: 'rejected', occurrence });
        return;
      }
      let scope: RecurringEditScope | null = null;
      let changes: readonly EventChangeEntry[];
      // 終日イベントの移動はタイムゾーンに依存しない日付キー文字列で書き込む
      // （表示 TZ の絶対時刻のままだと timeZone を持つイベントで日付がずれる）
      const patchRange = occurrence.allDay
        ? allDayPatchRange(range, timeZoneRef.current)
        : { start: range.start, end: range.end };
      if (occurrence.isRecurring) {
        const resolveRecurringScope = callbacksRef.current?.resolveRecurringScope;
        scope =
          resolveRecurringScope === undefined
            ? 'this'
            : await resolveRecurringScope(occurrence, action);
        if (scope === null) {
          return;
        }
        changes = apiRef.current.updateEvent(occurrence.eventId, patchRange, {
          occurrenceStart: occurrence.originalStart,
          scope,
        });
      } else {
        changes = apiRef.current.updateEvent(occurrence.eventId, patchRange);
      }
      callbacksRef.current?.onEventChange?.({
        occurrence,
        newRange: range,
        allDay: occurrence.allDay,
        scope,
        changes,
      });
    } finally {
      apiRef.current.setDragPreview(null);
    }
  }

  /**
   * オカレンスを時間指定イベントに変換して適用する（繰り返しならスコープを解決してから適用する）。
   * `commitMove` と異なり、変更後は常に `allDay: false` にする（`occurrence.allDay` が
   * `true`（変換元）であっても上書きする）。失敗時にドラッグプレビューが残らないよう
   * `finally` で確実に解除する（`commitMove` と同じ理由）。
   */
  async function commitTimedConversion(
    occurrence: EventOccurrence,
    range: DateRange,
  ): Promise<void> {
    try {
      const options = optionsRef.current;
      const valid = isDragCandidateValid({
        range,
        allDay: false,
        excludeKey: occurrence.key,
        moverBlocksOverlap: resolveMoverBlocksOverlap(occurrence, options.eventOverlap),
        blockers: collectOverlapBlockersInRange(
          apiRef.current,
          overlapCacheRef.current,
          range,
          options.eventOverlap,
        ),
        constraintRules: resolveConstraintRulesForOccurrence(
          occurrence,
          options.eventConstraint,
          options.businessHours,
        ),
        timeZone: timeZoneRef.current,
      });
      if (!valid) {
        reportOperationRejected(callbacksRef.current, {
          action: 'convert',
          reason: 'constraint',
          occurrence,
        });
        return;
      }
      const gate = checkBeforeEventChange(callbacksRef.current, {
        occurrence,
        range,
        allDay: false,
        action: 'convert',
      });
      const allowed = typeof gate === 'boolean' ? gate : await gate;
      if (!allowed) {
        reportOperationRejected(callbacksRef.current, {
          action: 'convert',
          reason: 'rejected',
          occurrence,
        });
        return;
      }
      let scope: RecurringEditScope | null = null;
      let changes: readonly EventChangeEntry[];
      if (occurrence.isRecurring) {
        const resolveRecurringScope = callbacksRef.current?.resolveRecurringScope;
        scope =
          resolveRecurringScope === undefined
            ? 'this'
            : await resolveRecurringScope(occurrence, 'move');
        if (scope === null) {
          return;
        }
        changes = apiRef.current.updateEvent(
          occurrence.eventId,
          { start: range.start, end: range.end, allDay: false },
          { occurrenceStart: occurrence.originalStart, scope },
        );
      } else {
        changes = apiRef.current.updateEvent(occurrence.eventId, {
          start: range.start,
          end: range.end,
          allDay: false,
        });
      }
      callbacksRef.current?.onEventChange?.({
        occurrence,
        newRange: range,
        allDay: false,
        scope,
        changes,
      });
    } finally {
      apiRef.current.setDragPreview(null);
    }
  }

  /**
   * オカレンスの削除を確定する（繰り返しならスコープを解決してから適用する）。
   * 削除が適用された場合のみ `callbacks.onEventDelete` を呼び、削除後のフォーカス復帰
   * （`focusContext`。呼び出し元が Delete/Backspace のキーダウン時点で
   * {@link captureOccurrenceDeleteFocusContext} を使って作る）を予約する
   * （スコープ解決が `null` でキャンセルされた場合はどちらも行わない）。
   */
  async function commitDelete(
    occurrence: EventOccurrence,
    focusContext: OccurrenceDeleteFocusContext | null,
  ): Promise<void> {
    if (occurrence.event.editable === false) {
      return;
    }
    const gate = checkBeforeEventDelete(callbacksRef.current, occurrence);
    const allowed = typeof gate === 'boolean' ? gate : await gate;
    if (!allowed) {
      reportOperationRejected(callbacksRef.current, {
        action: 'delete',
        reason: 'rejected',
        occurrence,
      });
      return;
    }
    let scope: RecurringEditScope | null = null;
    let changes: readonly EventChangeEntry[];
    if (occurrence.isRecurring) {
      const resolveRecurringScope = callbacksRef.current?.resolveRecurringScope;
      scope =
        resolveRecurringScope === undefined
          ? 'this'
          : await resolveRecurringScope(occurrence, 'delete');
      if (scope === null) {
        return;
      }
      changes = apiRef.current.deleteEvent(occurrence.eventId, {
        occurrenceStart: occurrence.originalStart,
        scope,
      });
    } else {
      changes = apiRef.current.deleteEvent(occurrence.eventId);
    }
    deleteFocusControllerRef.current.arm(focusContext);
    callbacksRef.current?.onEventDelete?.({ occurrence, scope, changes });
  }

  /**
   * ドラッグ（作成・移動・リサイズ）を開始する。
   *
   * document に pointermove / pointerup / pointercancel / keydown（Escape）の
   * リスナーを登録し、pointermove ごとにプレビューを更新、pointerup で確定、
   * Escape または pointercancel でキャンセルする。
   *
   * 前のセッションが残っていた場合（pointercancel 未対応のブラウザ挙動などで
   * まれに finish/cancel を経由せず終わった場合）は、先にその後始末をしてから
   * 新しいセッションを開始する。早期 return で無視すると、以後ドラッグが
   * 恒久的に無効化されてしまうため。
   */
  function beginDrag(kind: DayDragMode, occurrence: EventOccurrence | null, anchorDay: Date): void {
    sessionRef.current?.cleanup();

    const computeRange = (pointerDay: Date): DateRange =>
      dayDragPreviewRange({ mode: kind, occurrence }, pointerDay, anchorDay, timeZoneRef.current);

    const handlePointerMove = (event: PointerEvent): void => {
      const session = sessionRef.current;
      if (session === null) {
        return;
      }

      // 'move' セッション中にポインタが時間グリッドの日列上にあれば、
      // 時間指定イベントへの変換プレビューに切り替える。
      if (kind === 'move' && occurrence !== null) {
        const column = findTimeGridDayColumn(event.clientX, event.clientY);
        const dateKey = column?.getAttribute('data-koyomi-date') ?? null;
        if (column !== null && dateKey !== null) {
          const timeZone = timeZoneRef.current;
          const day = dateFromKey(dateKey, timeZone);
          const fractionY = fractionYFromClientY(column.getBoundingClientRect(), event.clientY);
          const time = timeAtGridPosition({
            day,
            fractionY,
            timeZone,
            snap: optionsRef.current.snapMinutes,
            rangeStartMinutes: parseSlotBoundaryTime(optionsRef.current.slotMinTime),
            rangeEndMinutes: parseSlotBoundaryTime(optionsRef.current.slotMaxTime),
          });
          const range: DateRange = {
            start: time,
            end: addMinutesInZone(time, optionsRef.current.defaultEventMinutes, timeZone),
          };
          session.moved = true;
          session.timedConversion = range;
          const options = optionsRef.current;
          const invalid = !isDragCandidateValid({
            range,
            allDay: false,
            excludeKey: occurrence.key,
            moverBlocksOverlap: resolveMoverBlocksOverlap(occurrence, options.eventOverlap),
            blockers: collectOverlapBlockersInRange(
              apiRef.current,
              overlapCacheRef.current,
              range,
              options.eventOverlap,
            ),
            constraintRules: resolveConstraintRulesForOccurrence(
              occurrence,
              options.eventConstraint,
              options.businessHours,
            ),
            timeZone,
          });
          apiRef.current.setDragPreview({
            kind: 'move',
            occurrenceKey: occurrence.key,
            range,
            allDay: false,
            ...(invalid ? { invalid: true } : {}),
          });
          return;
        }
      }

      // 時間グリッドの外に戻った（または最初から時間グリッド上でない）場合は変換を解除する。
      session.timedConversion = null;
      const pointerDay = locateDay(event.clientX, event.clientY) ?? anchorDay;
      const range = computeRange(pointerDay);
      // 基準日と異なる日に乗った場合にのみ「移動した」とみなす。
      // 同じセル内での微小な揺れ（pointermove は発火するが日は変わらない）は
      // クリック相当として扱いたいため、ここでは moved にしない。
      if (pointerDay.getTime() !== anchorDay.getTime()) {
        session.moved = true;
      }
      const options = optionsRef.current;
      // 制約判定の allDay は「候補の最終的な allDay らしさ」を使う（見た目は常に帯だが、
      // 元イベントが時間指定なら occurrence.allDay === false のまま維持される）。
      const finalAllDay = occurrence === null ? true : occurrence.allDay;
      const invalid = !isDragCandidateValid({
        range,
        allDay: finalAllDay,
        excludeKey: occurrence?.key ?? null,
        moverBlocksOverlap: resolveMoverBlocksOverlap(occurrence, options.eventOverlap),
        blockers: collectOverlapBlockersInRange(
          apiRef.current,
          overlapCacheRef.current,
          range,
          options.eventOverlap,
        ),
        constraintRules: resolveConstraintRulesForOccurrence(
          occurrence,
          options.eventConstraint,
          options.businessHours,
        ),
        timeZone: timeZoneRef.current,
      });
      apiRef.current.setDragPreview({
        kind: toPreviewKind(kind),
        occurrenceKey: occurrence?.key ?? null,
        range,
        // 本フックは常に「日単位の帯」を扱うため、プレビューは常に帯としての
        // 見た目にする。ここでの allDay は「帯としてのプレビューか」を表す
        // 見た目のフラグであり、イベント自体の allDay 属性とは独立している
        // （時間指定だが複数日にまたがるセグメントの移動でも帯として見せる）。
        allDay: true,
        ...(invalid ? { invalid: true } : {}),
      });
    };

    /**
     * ドラッグ確定処理。`event` には pointerup イベント自身を渡すこと。
     *
     * pointermove は高頻度移動時の間引きや coalescing で pointerup 直前の座標を
     * 反映していないことがあるため、確定範囲は必ずここで `event.clientX/clientY`
     * から再計算する（`session.lastRange` のような「直前の pointermove 時点の
     * キャッシュ」には依存しない）。他 3 フック（`use-time-grid-drag.ts` 等）の
     * `commitSession` と同じ方針。
     *
     * 一方、時間グリッドへの変換中か（`session.timedConversion`）は pointermove
     * 時点の判定を維持する（`use-time-grid-drag.ts` の `allDayConversion` と同じ
     * 扱い）。pointerup 時点で再判定すると、変換領域の境界ぎりぎりで離した際に
     * pointermove 中に見えていたプレビューと異なる結果で確定してしまうため。
     */
    const finish = (event: PointerEvent): void => {
      const session = sessionRef.current;
      cleanup();
      sessionRef.current = null;
      apiRef.current.setDragPreview(null);
      if (session === null) {
        return;
      }
      const pointerDay = locateDay(event.clientX, event.clientY) ?? anchorDay;
      const finalRange = computeRange(pointerDay);
      if (kind === 'create') {
        void commitSelection(finalRange).catch(reportError);
        return;
      }
      if (!session.moved || occurrence === null) {
        return;
      }
      // 移動・リサイズが確定した直後、ブラウザが自動発火する click を 1 回だけ抑制する。
      // resolveRecurringScope の解決を待つ前（同期のうち）にフラグを立てることで、
      // 確定処理が非同期でも click 到達前に確実に反映されるようにする。
      suppressNextClickRef.current = true;
      if (session.timedConversion !== null) {
        void commitTimedConversion(occurrence, session.timedConversion).catch(reportError);
        return;
      }
      const action: 'move' | 'resize' = kind === 'move' ? 'move' : 'resize';
      void commitMove(occurrence, finalRange, action).catch(reportError);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      finish(event);
    };

    /** Escape / pointercancel によるキャンセル。コミットせず後始末のみ行う。 */
    const cancelSession = (): void => {
      cleanup();
      sessionRef.current = null;
      apiRef.current.setDragPreview(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      // Escape 押下時にポインタボタンがまだ離されていない場合、直後の pointerup で
      // ブラウザが自動発火する click により onEventClick が誤発火し得るため抑制する。
      suppressNextClickRef.current = true;
      cancelSession();
    };

    /**
     * pointercancel（他の入力への割り込みなどでブラウザがポインタ操作を打ち切った場合）。
     * Escape と同じくコミットせずセッションを破棄する。
     */
    const handlePointerCancel = (): void => {
      cancelSession();
    };

    function cleanup(): void {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      document.removeEventListener('keydown', handleKeyDown);
    }

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
    document.addEventListener('keydown', handleKeyDown);

    sessionRef.current = {
      kind,
      occurrence,
      anchorDay,
      moved: false,
      timedConversion: null,
      cleanup,
    };
  }

  /**
   * セルへバブルしてきたイベントが、セル内にネストされた予定ボタン
   * （`data-koyomi-occurrence` 属性を持つ要素）由来かどうかを判定する。
   *
   * 帯ボタンは ARIA 上の所有関係の要請で開始日の gridcell の子として描画される。
   * ボタン側で stopPropagation する方式はカレンダー外側の祖先（ポップオーバーを
   * 閉じる等の利用側リスナー）にも届かなくなるため、伝播は止めずにセル側で
   * イベントの由来を確認して無視する。
   */
  function originatesFromSegment(event: { target: EventTarget }): boolean {
    return (
      event.target instanceof Element && event.target.closest('[data-koyomi-occurrence]') !== null
    );
  }

  function getDayCellProps(day: { date: Date; key: string }): DayCellProps {
    return {
      ref: (element: HTMLElement | null) => {
        if (element === null) {
          registryRef.current.delete(day.key);
        } else {
          registryRef.current.set(day.key, { element, date: day.date });
        }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // 帯ボタン（データ属性 data-koyomi-occurrence）はセルの子として描画されるため、
        // ボタン由来の pointerdown がここへバブルしてくる。ボタン側で伝播を止める方式は
        // カレンダー外側の祖先（ポップオーバーを閉じる等の利用側リスナー）にも届かなく
        // なるため採らず、セル側でイベントの由来を確認して無視する
        if (originatesFromSegment(event)) {
          return;
        }
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        beginDrag('create', null, day.date);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        // pointerdown と同じ理由で、帯ボタン由来のキー操作（Enter/Space 等）を
        // セルの範囲選択として二重処理しない
        if (originatesFromSegment(event)) {
          return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        void commitSelection({
          start: day.date,
          end: addDaysInZone(day.date, 1, timeZoneRef.current),
        }).catch(reportError);
      },
      tabIndex: 0,
      'data-koyomi-date': day.key,
    };
  }

  function getSegmentProps(segment: EventSegment): SegmentProps {
    const occurrence = segment.occurrence;
    const dragPreview = calendar.state.dragPreview;
    const isDraggingThis =
      dragPreview !== null &&
      dragPreview.kind === 'move' &&
      dragPreview.occurrenceKey === occurrence.key;

    const base: SegmentProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // editable: false や副ボタンでは何もせず、伝播も止めない（外側の祖先の
        // 利用側リスナーへそのまま届ける）。セルの作成ドラッグとの二重処理は
        // getDayCellProps 側が由来（data-koyomi-occurrence）を確認して防ぐ
        if (event.button !== 0 || occurrence.event.editable === false) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        const anchorDay =
          locateDay(event.clientX, event.clientY) ??
          startOfDayInZone(occurrence.start, timeZoneRef.current);
        beginDrag('move', occurrence, anchorDay);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        callbacksRef.current?.onEventClick?.(occurrence, event.nativeEvent);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        // 伝播は止めない（外側の祖先の利用側リスナーへそのまま届ける）。セルの
        // Enter/Space（範囲選択）との二重発火は getDayCellProps 側がイベントの
        // 由来（data-koyomi-occurrence）を確認して防ぐ
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          const focusContext = captureOccurrenceDeleteFocusContext({
            target: event.target,
            occurrenceKey: occurrence.key,
            viewRootSelector: DAY_DRAG_VIEW_ROOT_SELECTOR,
          });
          void commitDelete(occurrence, focusContext).catch(reportError);
          return;
        }
        if (isConversionToggleKey(event)) {
          const conversion = keyboardTimedConversionRef.current;
          // opt-in（週/日ビューの終日行）でのみ有効。未指定（月ビュー等）と、終日でない帯
          // （複数日にまたがる時間指定の予定）では既定動作を抑制せず、A キーを他の
          // リスナー（`useCalendarShortcuts` のビュー切替等）へそのまま委ねる
          if (conversion === undefined || !occurrence.allDay) {
            return;
          }
          event.preventDefault();
          if (occurrence.event.editable === false) {
            return;
          }
          const timeZone = timeZoneRef.current;
          // 変換先はオカレンスの開始日 × rangeStartMinutes から defaultEventMinutes 分
          //（ポインタの変換ドラッグと同じ長さ規則。確定処理も同じ commitTimedConversion）
          const start = addMinutesInZone(
            startOfDayInZone(occurrence.start, timeZone),
            conversion.rangeStartMinutes,
            timeZone,
          );
          void commitTimedConversion(occurrence, {
            start,
            end: addMinutesInZone(start, optionsRef.current.defaultEventMinutes, timeZone),
          }).catch(reportError);
          return;
        }
        if (occurrence.event.editable === false) {
          return;
        }
        switch (event.key) {
          case 'ArrowLeft': {
            event.preventDefault();
            if (event.shiftKey) {
              const end = addDaysInZone(occurrence.end, -1, timeZoneRef.current);
              if (end.getTime() > occurrence.start.getTime()) {
                void commitMove(occurrence, { start: occurrence.start, end }, 'resize').catch(
                  reportError,
                );
              }
            } else {
              void commitMove(occurrence, shiftedRange(occurrence, -1), 'move').catch(reportError);
            }
            return;
          }
          case 'ArrowRight': {
            event.preventDefault();
            if (event.shiftKey) {
              const end = addDaysInZone(occurrence.end, 1, timeZoneRef.current);
              void commitMove(occurrence, { start: occurrence.start, end }, 'resize').catch(
                reportError,
              );
            } else {
              void commitMove(occurrence, shiftedRange(occurrence, 1), 'move').catch(reportError);
            }
            return;
          }
          case 'ArrowUp': {
            event.preventDefault();
            void commitMove(occurrence, shiftedRange(occurrence, -7), 'move').catch(reportError);
            return;
          }
          case 'ArrowDown': {
            event.preventDefault();
            void commitMove(occurrence, shiftedRange(occurrence, 7), 'move').catch(reportError);
            return;
          }
          default:
            return;
        }
      },
      tabIndex: 0,
      'data-koyomi-occurrence': occurrence.key,
      ...eventNotificationProps(callbacksRef.current, occurrence),
    };
    return isDraggingThis ? { ...base, 'data-koyomi-dragging': 'true' } : base;
  }

  function getSegmentResizeHandleProps(
    segment: EventSegment,
    edge: 'start' | 'end',
  ): SegmentResizeHandleProps {
    const occurrence = segment.occurrence;
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (occurrence.event.editable === false) {
          return;
        }
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        const anchorDay =
          locateDay(event.clientX, event.clientY) ??
          startOfDayInZone(
            edge === 'start' ? occurrence.start : new Date(occurrence.end.getTime() - 1),
            timeZoneRef.current,
          );
        beginDrag(edge === 'start' ? 'resize-start' : 'resize-end', occurrence, anchorDay);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation();
      },
      'data-koyomi-resize-handle': edge,
    };
  }

  const dragPreview = calendar.state.dragPreview;

  return {
    getDayCellProps,
    getSegmentProps,
    getSegmentResizeHandleProps,
    // allDay: false（時間グリッドへの変換中）のプレビューは本フックの領域（帯）では
    // 描画しない。そちらは `useTimeGridDrag` 側の `previewFor` が担当する。
    previewRange: dragPreview?.allDay ? dragPreview.range : null,
    previewInvalid: dragPreview?.allDay ? (dragPreview.invalid ?? false) : false,
    isDragging: dragPreview !== null,
  };
}
