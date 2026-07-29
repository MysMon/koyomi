/**
 * @packageDocumentation
 * `useCalendarDuplicate` — イベント（オカレンス）の複製を React に接続するフック。
 *
 * 複製は `core/mutations` の {@link buildOccurrenceCopy} で複製用の入力（新規作成の
 * `CalendarEventInput`）を組み立て、`calendar.api.createEvent` で同じ日時のまま
 * 新しいイベントとして作成する（`useCalendarClipboard` の貼り付けと異なり、複製先は
 * 常に複製元と同じ日時であり利用者が宛先を選び直さないため、宣言的制約
 * （`eventOverlap` / `eventConstraint` / `businessHours`）・`onBeforeSelectRange` の
 * 判定は行わない。複製元イベントは既にその日時に存在しており、複製元自身との
 * 重なりを拒否対象にする意味がないため）。
 *
 * **繰り返しイベントのオカレンスの複製は、シリーズ全体ではなく当該オカレンスの
 * 単発化**になる（`rrule` / `exdates` / `rdates` は引き継がない。
 * {@link buildOccurrenceCopy} のコピー規則、`useCalendarClipboard` のコピーと同じ扱い）。
 *
 * `history` を渡すと、複製が成功した場合にのみ作成分の {@link EventChangeEntry} が
 * 履歴に積まれて undo/redo の対象になる（`onDuplicate` も成功時のみ呼ばれる）。
 *
 * キーボードショートカットは提供しない（ブラウザ既定の `Ctrl/Cmd+D`（ブックマーク
 * 登録）と衝突するため）。ショートカットを割り当てたい場合は利用側で `duplicate` を
 * 呼び出すハンドラを組んでください。
 */

import { useMemo, useRef } from 'react';
import { buildOccurrenceCopy, type MutationReadContext } from '../core/mutations';
import type { CalendarEvent, EventChangeEntry, EventOccurrence } from '../core/types';
import type { UseCalendarResult } from './types';

/** `useCalendarDuplicate` のオプション。 */
export interface UseCalendarDuplicateOptions {
  /** `useCalendar` の戻り値。 */
  calendar: UseCalendarResult;
  /**
   * 複製で作成されたイベントの変更（{@link EventChangeEntry}）を積む履歴。
   * `useCalendarHistory` の戻り値（または `createEventHistory`）をそのまま渡せる。
   * 渡すと複製が undo/redo の対象になる。
   */
  history?: { push(changes: readonly EventChangeEntry[]): void };
  /** 複製でイベントが作成されたときに呼ばれる。 */
  onDuplicate?: (created: CalendarEvent) => void;
}

/** `useCalendarDuplicate` の戻り値。 */
export interface UseCalendarDuplicateResult {
  /**
   * オカレンスを複製する。複製元と同じ日時のまま新しいイベントとして作成する
   * （繰り返しイベントのオカレンスは単発化された複製になる。
   * {@link buildOccurrenceCopy} のコピー規則を参照）。
   *
   * @param occurrence - 複製対象のオカレンス
   * @returns 作成されたイベント。対象オカレンスの元イベントが（呼び出し時点の
   *   最新のイベント一覧から）既に削除されている場合はイベントを作成せず `null`
   *   を返す
   */
  duplicate(occurrence: EventOccurrence): CalendarEvent | null;
}

/**
 * イベント（オカレンス）の複製を React に接続するフック。
 *
 * コピー＆ペーストと違い、複製元と貼り付け先が同一（同じ日時）のため、内部的な
 * クリップボード状態は持たず `duplicate` の呼び出し 1 回で完結する。UI は提供しない
 * （ヘッドレス）。
 *
 * @param options - {@link UseCalendarDuplicateOptions}
 * @returns {@link UseCalendarDuplicateResult}
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar();
 *   const history = useCalendarHistory({ calendar, keyboardShortcuts: true });
 *   const { duplicate } = useCalendarDuplicate({ calendar, history });
 *   return (
 *     <CalendarProvider value={calendar}>
 *       <button type="button" onClick={() => duplicate(someOccurrence)}>
 *         複製
 *       </button>
 *       <CalendarView />
 *     </CalendarProvider>
 *   );
 * }
 * // ボタン押下でそのオカレンスの複製が作成され、Ctrl+Z で取り消せる
 * ```
 */
export function useCalendarDuplicate(
  options: UseCalendarDuplicateOptions,
): UseCalendarDuplicateResult {
  // calendar / history / onDuplicate はホスト側で毎レンダー新規参照になりがちなため、
  // ref 経由で最新値を参照する（use-calendar-clipboard.ts と同じパターン）。
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 安定参照の duplicate。 */
  const stable = useRef({
    duplicate(occurrence: EventOccurrence): CalendarEvent | null {
      const { calendar, history, onDuplicate } = optionsRef.current;
      const { api, state } = calendar;
      const events = api.getEvents();
      // occurrence が古い参照（呼び出し時点で元イベントが既に削除済み）の場合は
      // buildOccurrenceCopy の例外に頼らず、複製せず null を返す
      if (!events.some((event) => event.id === occurrence.eventId)) {
        return null;
      }
      const context: MutationReadContext = {
        displayTimeZone: state.timeZone,
        defaultEventMinutes: state.options.defaultEventMinutes,
      };
      const input = buildOccurrenceCopy(
        events,
        occurrence.eventId,
        { occurrenceStart: occurrence.originalStart },
        context,
      );
      const created = api.createEvent(input);
      // createEvent は末尾に追加するため、挿入位置は追加後の末尾になる
      history?.push([{ after: created, index: api.getEvents().length - 1 }]);
      onDuplicate?.(created);
      return created;
    },
  }).current;

  return useMemo(() => ({ duplicate: stable.duplicate }), [stable]);
}
