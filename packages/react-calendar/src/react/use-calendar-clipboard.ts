/**
 * @packageDocumentation
 * `useCalendarClipboard` — イベントのコピー&ペースト（複製）を React に接続するフック。
 *
 * - `Ctrl/Cmd+C` — フォーカス中のオカレンス（`data-koyomi-occurrence` 要素）をコピー
 * - `Ctrl/Cmd+V` — フォーカス中の日付セル（`data-koyomi-date` 要素）へ貼り付け
 *
 * （いずれも `keyboardShortcuts: true` の場合のみ。既定は無効）
 * 入力欄（input / textarea / select / contentEditable）にフォーカスがある間は無効。
 *
 * コピーの内容は `core/mutations` の {@link buildOccurrenceCopy} で構築する。
 * **繰り返しイベントのコピーはシリーズ全体ではなく当該オカレンスの単発化**になる
 * （`rrule` / `exdates` / `rdates` は引き継がない。Google カレンダーのコピーと同じ扱い）。
 *
 * 貼り付けは `calendar.api.createEvent` を呼ぶ前に、宣言的制約
 * （`eventOverlap` / `eventConstraint` / `businessHours`。判定は `core/constraints` の
 * {@link isDragCandidateValid} が唯一の入口）と、適用前フック
 * {@link UseCalendarClipboardOptions.callbacks}.`onBeforeSelectRange` の両方を通過するかを
 * 判定する（他のドラッグ系フックの新規作成と同じ判定順序・同じ判定内容）。いずれかで
 * 拒否された場合はイベントを作成せず {@link UseCalendarClipboardOptions.onPasteRejected} を
 * 呼ぶ。`onBeforeSelectRange` が `Promise` を返す場合のみ {@link UseCalendarClipboardResult.paste}
 * の戻り値も `Promise` になり、それ以外（宣言的制約による拒否・同期的な
 * `onBeforeSelectRange` の判定）は同期的に完結する。
 *
 * `history` を渡すと、貼り付けが成功した場合にのみ作成分の {@link EventChangeEntry} が
 * 履歴に積まれて undo/redo の対象になる（`onPaste` も成功時のみ呼ばれる）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { isDragCandidateValid, resolveConstraintRules } from '../core/constraints';
import {
  buildOccurrenceCopy,
  type MutationReadContext,
  placeEventInputAt,
} from '../core/mutations';
import {
  addDaysInZone,
  addMinutesInZone,
  dateFromKey,
  minutesOfDayInZone,
  parseDateValue,
} from '../core/timezone';
import type {
  CalendarEvent,
  CalendarEventInput,
  DateRange,
  EventChangeEntry,
  EventOccurrence,
  TimeZoneId,
} from '../core/types';
import {
  checkBeforeSelectRange,
  collectOverlapBlockersInRange,
  createOverlapBlockerCache,
} from './drag-common';
import type { CalendarInteractionCallbacks, RangeSelection, UseCalendarResult } from './types';
import { isIgnoredTarget } from './use-calendar-shortcuts';

/** クリップボードに保持するコピー内容（内部用）。 */
interface ClipboardSnapshot {
  /** 貼り付けに使う入力（`id` を持たない。単発化済み）。 */
  input: CalendarEventInput;
  /** コピー元オカレンスの開始（絶対時刻）。日付セルへの貼り付けで時刻の維持に使う。 */
  start: Date;
  /** コピー元オカレンスが終日かどうか。 */
  allDay: boolean;
}

/**
 * {@link UseCalendarClipboardOptions.onPasteRejected} に渡される、拒否された
 * 貼り付けの内容。
 */
export interface PasteRejectedInfo {
  /**
   * 拒否の理由。
   * - `'constraint'` — 宣言的制約（`eventOverlap` / `eventConstraint`）による拒否
   * - `'rejected'` — `onBeforeSelectRange` が `false`（または `Promise<false>`）を返した
   */
  reason: 'constraint' | 'rejected';
  /** 貼り付け先へ配置しようとした入力（`id` を持たない）。 */
  input: CalendarEventInput;
  /** 貼り付け先の開始（絶対時刻）。 */
  start: Date;
  /** 終日としての貼り付けかどうか。 */
  allDay: boolean;
}

/** `useCalendarClipboard` のオプション。 */
export interface UseCalendarClipboardOptions {
  /** `useCalendar` の戻り値。 */
  calendar: UseCalendarResult;
  /**
   * `Ctrl+C`（コピー）／`Ctrl+V`（貼り付け）のキーボードショートカットを有効にするか
   * （macOS では `Cmd` も同様）。既定は `false`（opt-in）。
   * input/textarea/select/contentEditable にフォーカスがある間は無効。
   *
   * `Ctrl/Cmd+C` はフォーカス（イベントターゲット）が `data-koyomi-occurrence`
   * 属性を持つ要素の内側にある場合のみ動作し、それ以外では `preventDefault` も
   * 行わない（ページ上のテキストコピーを妨げない）。`Ctrl/Cmd+V` はフォーカスが
   * カレンダーの DOM（`data-koyomi-*` 属性を持つ要素）の内側にある場合のみ動作する。
   */
  keyboardShortcuts?: boolean;
  /**
   * 貼り付けで作成されたイベントの変更（{@link EventChangeEntry}）を積む履歴。
   * `useCalendarHistory` の戻り値（または `createEventHistory`）をそのまま渡せる。
   * 渡すと貼り付けが undo/redo の対象になる。
   */
  history?: { push(changes: readonly EventChangeEntry[]): void };
  /**
   * 貼り付け先の適用前フックの判定に使うコールバック。
   * `onBeforeSelectRange`（{@link CalendarInteractionCallbacks.onBeforeSelectRange}）
   * のみを受け付け、未指定なら常に許可する。
   */
  callbacks?: Pick<CalendarInteractionCallbacks, 'onBeforeSelectRange'>;
  /** コピーが行われたときに呼ばれる。 */
  onCopy?: (occurrence: EventOccurrence) => void;
  /** 貼り付けでイベントが作成されたときに呼ばれる。 */
  onPaste?: (created: CalendarEvent) => void;
  /**
   * 貼り付けが拒否されたときに呼ばれる（宣言的制約への違反、または
   * `onBeforeSelectRange` による拒否）。
   */
  onPasteRejected?: (info: PasteRejectedInfo) => void;
}

/** `useCalendarClipboard` の戻り値。 */
export interface UseCalendarClipboardResult {
  /** クリップボードにコピー内容があるか（再レンダーに反映される）。 */
  hasClipboard: boolean;
  /**
   * オカレンスをコピーする。繰り返しイベントのオカレンスは単発化された内容になる
   * （{@link buildOccurrenceCopy} のコピー規則）。
   */
  copy(occurrence: EventOccurrence): void;
  /**
   * クリップボードの内容を貼り付けてイベントを作成する。
   *
   * 作成前に、貼り付け先の範囲が宣言的制約（`eventOverlap` / `eventConstraint` /
   * `businessHours`。判定は {@link isDragCandidateValid}）に違反していないか、
   * 続けて {@link UseCalendarClipboardOptions.callbacks}.`onBeforeSelectRange`
   * （指定時のみ）を通過するかを判定する。いずれかで拒否された場合はイベントを
   * 作成せず {@link UseCalendarClipboardOptions.onPasteRejected} を呼び、`null`
   * を返す（`onBeforeSelectRange` が `Promise` を返した場合は `Promise<null>`）。
   *
   * `onBeforeSelectRange` が同期的な `boolean` を返す場合（未指定を含む）は常に
   * 同期的に完結する。`Promise` を返した場合のみ戻り値も `Promise` になる。
   *
   * @param newStart - 貼り付け先の開始時刻。省略時はコピー元と同じ日時に複製する
   * @returns 作成されたイベント。クリップボードが空、または拒否された場合は `null`
   *   （`onBeforeSelectRange` が `Promise` を返した場合は `Promise<CalendarEvent | null>`）
   */
  paste(newStart?: Date): CalendarEvent | null | Promise<CalendarEvent | null>;
  /** クリップボードを空にする。 */
  clear(): void;
}

/**
 * 貼り付け先の入力から、宣言的制約の判定に使う絶対時刻の範囲を求める。
 *
 * `end` が省略されている場合は、実際にオカレンスとして展開されるときと同じ
 * 既定の長さ（終日は 1 日、時間指定は `defaultEventMinutes` 分）を補う
 * （`core/expansion` の `end` 省略時の解釈と揃える）。
 *
 * @param placed - 貼り付け先へ配置済みの入力（{@link placeEventInputAt} の戻り値、
 *   または `newStart` 省略時はコピー内容そのもの）
 * @param displayTimeZone - `timeZone` を持たない入力の解釈に使う表示タイムゾーン
 * @param defaultEventMinutes - `end` 省略時の既定の長さ（分）
 * @returns 絶対時刻の範囲
 */
function resolvePlacedRange(
  placed: CalendarEventInput,
  displayTimeZone: TimeZoneId,
  defaultEventMinutes: number,
): DateRange {
  const allDay = placed.allDay ?? false;
  // オフセットなしの日時文字列は、入力自身の timeZone があればその現地時刻として
  // 解釈する（core/expansion の解釈と揃える。表示タイムゾーンで解釈すると
  // timeZone 付きイベントの制約判定だけがオカレンスの実時刻とずれる）
  const timeZone = placed.timeZone ?? displayTimeZone;
  const start = parseDateValue(placed.start, timeZone, allDay);
  if (placed.end !== undefined) {
    return { start, end: parseDateValue(placed.end, timeZone, allDay) };
  }
  const end = allDay
    ? addDaysInZone(start, 1, timeZone)
    : new Date(start.getTime() + defaultEventMinutes * 60_000);
  return { start, end };
}

/**
 * イベントのコピー&ペースト（複製）を React に接続するフック。
 *
 * コピーはイベント一覧を変更せず、コピー内容をフック内部のクリップボードに保持する
 * （OS のクリップボードは使わない）。貼り付けは `calendar.api.createEvent` を呼んで
 * イベントを作成する。UI は提供しない（ヘッドレス）。
 *
 * キーボードショートカット（opt-in）では、`Ctrl/Cmd+C` がフォーカス中のオカレンス
 * （`data-koyomi-occurrence` 属性を持つ要素）をコピーし、`Ctrl/Cmd+V` がフォーカス中の
 * 日付セル（`data-koyomi-date` 属性を持つ要素）の日へ、コピー元の時刻（終日イベントは
 * 終日のまま）を維持して貼り付ける。カレンダー内でも日付セルが特定できない位置に
 * フォーカスがある場合は、コピー元と同じ日時に複製する。
 *
 * @param options - {@link UseCalendarClipboardOptions}
 * @returns {@link UseCalendarClipboardResult}
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar();
 *   const history = useCalendarHistory({ calendar, keyboardShortcuts: true });
 *   const clipboard = useCalendarClipboard({ calendar, history, keyboardShortcuts: true });
 *   return (
 *     <CalendarProvider value={calendar}>
 *       <CalendarView />
 *     </CalendarProvider>
 *   );
 * }
 * // 予定ボタンにフォーカスして Ctrl+C → 別の日付セルにフォーカスして Ctrl+V で
 * // その日に複製が作成され、Ctrl+Z で取り消せる
 * ```
 */
export function useCalendarClipboard(
  options: UseCalendarClipboardOptions,
): UseCalendarClipboardResult {
  const { keyboardShortcuts = false } = options;

  // calendar / history / コールバックはホスト側で毎レンダー新規参照になりがちなため、
  // ref 経由で最新値を参照する（use-calendar-shortcuts.ts と同じパターン）。
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [clipboard, setClipboard] = useState<ClipboardSnapshot | null>(null);
  // keydown リスナー（document 登録のため state のクロージャが古くなる）から
  // 最新のクリップボード内容を読むためのミラー。
  const clipboardRef = useRef<ClipboardSnapshot | null>(null);
  clipboardRef.current = clipboard;
  // paste の宣言的制約判定（collectOverlapBlockersInRange）用の展開結果キャッシュ。
  const overlapCacheRef = useRef(createOverlapBlockerCache());

  /** 現在の表示タイムゾーン・既定の長さから変更コンテキストを構築する。 */
  function readContext(): MutationReadContext {
    const { state } = optionsRef.current.calendar;
    return {
      displayTimeZone: state.timeZone,
      defaultEventMinutes: state.options.defaultEventMinutes,
    };
  }

  /** 安定参照の copy / paste / clear（keydown リスナーからも使う）。 */
  const stable = useRef({
    copy(occurrence: EventOccurrence): void {
      const { calendar, onCopy } = optionsRef.current;
      const input = buildOccurrenceCopy(
        calendar.api.getEvents(),
        occurrence.eventId,
        { occurrenceStart: occurrence.originalStart },
        readContext(),
      );
      const snapshot: ClipboardSnapshot = {
        input,
        start: new Date(occurrence.start.getTime()),
        allDay: occurrence.allDay,
      };
      clipboardRef.current = snapshot;
      setClipboard(snapshot);
      onCopy?.(occurrence);
    },
    paste(newStart?: Date): CalendarEvent | null | Promise<CalendarEvent | null> {
      const current = clipboardRef.current;
      if (current === null) {
        return null;
      }
      const { calendar, history, callbacks, onPaste, onPasteRejected } = optionsRef.current;
      const context = readContext();
      // 省略時はコピー元と同じ日時（コピー内容は既にその日時に配置済み）
      const placed =
        newStart === undefined
          ? current.input
          : placeEventInputAt(current.input, { newStart }, context);
      const allDay = placed.allDay ?? false;
      const { state, api } = calendar;
      const range = resolvePlacedRange(placed, state.timeZone, context.defaultEventMinutes);

      /** 拒否を通知し `null` を返す（{@link PasteRejectedInfo} を組み立てる共通処理）。 */
      function rejectFor(reason: PasteRejectedInfo['reason']): null {
        onPasteRejected?.({ reason, input: placed, start: range.start, allDay });
        return null;
      }

      const blockers = collectOverlapBlockersInRange(
        api,
        overlapCacheRef.current,
        range,
        state.options.eventOverlap,
      );
      const constraintValid = isDragCandidateValid({
        range,
        allDay,
        excludeKey: null,
        moverBlocksOverlap: state.options.eventOverlap === false,
        blockers,
        constraintRules: resolveConstraintRules(
          state.options.eventConstraint,
          state.options.businessHours,
        ),
        timeZone: state.timeZone,
      });
      if (!constraintValid) {
        return rejectFor('constraint');
      }

      /** 貼り付けを確定する（作成 + history + onPaste。許可された場合のみ呼ぶ）。 */
      function commit(): CalendarEvent {
        const created = api.createEvent(placed);
        // createEvent は末尾に追加するため、挿入位置は追加後の末尾になる
        history?.push([{ after: created, index: api.getEvents().length - 1 }]);
        onPaste?.(created);
        return created;
      }

      const selection: RangeSelection = { range, allDay };
      const gate = checkBeforeSelectRange(callbacks, selection);
      if (typeof gate === 'boolean') {
        return gate ? commit() : rejectFor('rejected');
      }
      return gate.then((allowed) => (allowed ? commit() : rejectFor('rejected')));
    },
    clear(): void {
      clipboardRef.current = null;
      setClipboard(null);
    },
  }).current;

  useEffect(() => {
    if (!keyboardShortcuts) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isIgnoredTarget(event.target)) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') {
        return;
      }
      // isIgnoredTarget 通過後の target は Element であることが保証される
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (key === 'c') {
        // フォーカス中のオカレンス要素からのみコピーする。それ以外では
        // preventDefault もしない（ページ上のテキストコピーを妨げない）
        const occurrenceKey = target
          .closest('[data-koyomi-occurrence]')
          ?.getAttribute('data-koyomi-occurrence');
        if (occurrenceKey === undefined || occurrenceKey === null) {
          return;
        }
        const { api } = optionsRef.current.calendar;
        const occurrence = api
          .getOccurrences(api.getVisibleRange())
          .find((candidate) => candidate.key === occurrenceKey);
        if (occurrence === undefined) {
          return;
        }
        event.preventDefault();
        stable.copy(occurrence);
        return;
      }

      // 貼り付け: フォーカスがカレンダーの DOM（data-koyomi-* 属性を持つ要素）の
      // 内側にある場合のみ動作する（ページ側の貼り付け操作を妨げない）
      const current = clipboardRef.current;
      if (current === null) {
        return;
      }
      if (target.closest('[data-koyomi], [data-koyomi-occurrence], [data-koyomi-date]') === null) {
        return;
      }
      event.preventDefault();
      const dateKey = target.closest('[data-koyomi-date]')?.getAttribute('data-koyomi-date');
      if (dateKey === undefined || dateKey === null) {
        // 日付セルが特定できない位置（ツールバー等）ではコピー元と同じ日時に複製する
        stable.paste();
        return;
      }
      const timeZone = optionsRef.current.calendar.state.timeZone;
      const day = dateFromKey(dateKey, timeZone);
      // 終日はその日へ、時間指定はコピー元の「その日の 0:00 からの分」を維持して貼り付ける
      const newStart = current.allDay
        ? day
        : addMinutesInZone(day, minutesOfDayInZone(current.start, timeZone), timeZone);
      stable.paste(newStart);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [keyboardShortcuts, stable]);

  return useMemo(
    () => ({
      hasClipboard: clipboard !== null,
      copy: stable.copy,
      paste: stable.paste,
      clear: stable.clear,
    }),
    [clipboard, stable],
  );
}
