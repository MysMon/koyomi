/**
 * @packageDocumentation
 * `useRecurrenceRuleEditor` — 繰り返しルールをフォーム入力向けの構造化状態として
 * 編集する React フック。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildRecurrenceRuleString,
  describeRecurrenceRule,
  type MonthlyRecurrencePattern,
  parseRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceRuleState,
  type RecurrenceValidationIssue,
  validateRecurrenceRuleState,
} from '../core/recurrence-editor';
import { getWallClock, weekdayInZone } from '../core/timezone';
import type { TimeZoneId, Weekday } from '../core/types';
import { isDevBuild } from './is-dev-build';

/**
 * `useRecurrenceRuleEditor` のオプション。
 *
 * @remarks
 * `start` / `timeZone` / `rrule` は **作成時のみ有効**（`useCalendar` の
 * `options.events` と同じ規約）。マウント後にこれらを変更しても反映されない。
 * 編集対象（新規作成 / 既存オカレンス編集）を切り替える場合は、このフックを
 * 使うコンポーネントに一意な `key` を指定して再マウントすること。
 */
export interface UseRecurrenceRuleEditorOptions {
  /** DTSTART。初期値としてのみ使用。 */
  start: Date;
  /** イベントのタイムゾーン。初期値としてのみ使用。 */
  timeZone: TimeZoneId;
  /** 編集対象の既存 RRULE 文字列。省略時は「繰り返しなし」。初期値としてのみ使用。 */
  rrule?: string;
  /**
   * 説明文（{@link UseRecurrenceRuleEditorResult.description}）を差し替える関数。
   * 省略時は {@link describeRecurrenceRule} が生成する日本語の既定文言をそのまま使う。
   *
   * @param state - 現在の状態
   * @param defaultDescription - core が生成した既定の説明文（日本語）
   */
  describeRule?: (state: RecurrenceRuleState, defaultDescription: string) => string;
}

/** `useRecurrenceRuleEditor` の戻り値。 */
export interface UseRecurrenceRuleEditorResult {
  /** 現在の構造化状態。`null` は「繰り返しなし」。 */
  state: RecurrenceRuleState | null;
  /** 対応範囲外の RRULE を読み込んだ場合の元情報。`state` が有効な間は `null`。 */
  unsupported: { rawRRule: string; reason: string } | null;
  /**
   * 頻度を変更する。
   *
   * `state` が `null`（未 enable・unsupported）の間は何もしない。
   * `weekly` へ切り替えて `byWeekday` が未設定の場合は `[dtstart の曜日]` を、
   * `monthly` へ切り替えて `monthlyPattern` が未設定の場合は
   * `{ kind: 'dayOfMonth', day: dtstart の日 }` を補う。他の頻度へ切り替えた場合、
   * その頻度に無関係なフィールド（`byWeekday` / `monthlyPattern`）は保持しない。
   */
  setFrequency(freq: RecurrenceFrequency): void;
  /** 繰り返し間隔を設定する。値の妥当性チェックは行わない（`errors` に反映される）。 */
  setInterval(interval: number): void;
  /** `freq: 'weekly'` の曜日集合を設定する。 */
  setByWeekday(weekdays: readonly Weekday[]): void;
  /** `freq: 'monthly'` の月内パターンを設定する。 */
  setMonthlyPattern(pattern: MonthlyRecurrencePattern): void;
  /** 終了条件を設定する。 */
  setEnd(end: RecurrenceEnd): void;
  /**
   * 繰り返しを有効化する。`state` が `null`（未 enable・unsupported）のときのみ
   * 既定値（`{ freq: 'daily', interval: 1, end: { type: 'never' } }`）を設定する。
   * 元の {@link UseRecurrenceRuleEditorResult.unsupported} は破棄される。
   */
  enable(): void;
  /** 繰り返しを解除する（`state` / `unsupported` の両方を `null` に戻す）。 */
  clear(): void;
  /** `state` の検証エラー（空配列なら有効）。 */
  errors: readonly RecurrenceValidationIssue[];
  /** 現在の状態から生成された RRULE 文字列。`state` が `null` または検証エラーがある場合は `null`。 */
  rruleString: string | null;
  /** 現在の状態の説明文。`state` が `null` の場合は `null`。 */
  description: string | null;
}

/** `options.describeRule` 省略時の既定実装（`defaultDescription` をそのまま返す）。 */
function defaultDescribeRule(_state: RecurrenceRuleState, defaultDescription: string): string {
  return defaultDescription;
}

/**
 * 繰り返しルールを構造化状態として編集する。
 *
 * RRULE 文字列の相互変換・検証・説明文生成は `core/recurrence-editor.ts` の
 * 純関数（{@link parseRecurrenceRule} 等）に委譲し、このフックは React の状態
 * 管理（`state` の保持・setter の安定化）のみを担う。UI は提供しない
 * （ヘッドレス）。
 *
 * @param options - フックのオプション
 * @returns {@link UseRecurrenceRuleEditorResult}
 * @example
 * ```tsx
 * function RecurrenceForm({ start, timeZone }: { start: Date; timeZone: string }) {
 *   const editor = useRecurrenceRuleEditor({ start, timeZone });
 *   if (editor.state === null) {
 *     return <button type="button" onClick={editor.enable}>繰り返しを設定</button>;
 *   }
 *   return (
 *     <div>
 *       <p>{editor.description}</p>
 *       <button type="button" onClick={editor.clear}>繰り返しを解除</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRecurrenceRuleEditor(
  options: UseRecurrenceRuleEditorOptions,
): UseRecurrenceRuleEditorResult {
  /** start/timeZone/rrule の初回値。以後は変更を無視する（初期値のみ有効の規約）。 */
  const initialOptionsRef = useRef({
    start: options.start,
    timeZone: options.timeZone,
    rrule: options.rrule,
  });
  const initialOptions = initialOptionsRef.current;

  /** 初回マウント時の parseRecurrenceRule の結果（state/unsupported の初期値算出に使う）。 */
  const initialParsedRef = useRef<ReturnType<typeof parseRecurrenceRule> | null>(null);
  if (initialParsedRef.current === null) {
    initialParsedRef.current = parseRecurrenceRule({
      rrule: initialOptions.rrule,
      dtstart: initialOptions.start,
      timeZone: initialOptions.timeZone,
    });
  }
  const initialParsed = initialParsedRef.current;

  const [state, setState] = useState<RecurrenceRuleState | null>(() =>
    initialParsed.kind === 'editable' ? initialParsed.state : null,
  );
  const [unsupportedRawRRule, setUnsupportedRawRRule] = useState<{
    rawRRule: string;
    reason: string;
  } | null>(() =>
    initialParsed.kind === 'unsupported'
      ? { rawRRule: initialParsed.rawRRule, reason: initialParsed.reason }
      : null,
  );

  // start/timeZone/rrule は初期値としてのみ有効。開発時のみ、マウント後に異なる
  // 値が渡されたことを一度だけ警告する（key を付けて再マウントする運用を促す）。
  const warnedRef = useRef(false);
  if (
    isDevBuild() &&
    !warnedRef.current &&
    (options.start !== initialOptions.start ||
      options.timeZone !== initialOptions.timeZone ||
      options.rrule !== initialOptions.rrule)
  ) {
    warnedRef.current = true;
    // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
    console.warn(
      '[koyomi] useRecurrenceRuleEditor の options.start / options.timeZone / options.rrule は' +
        '初期値としてのみ使われ、マウント後の変更は反映されません。編集対象を切り替える場合は、' +
        'このフックを使うコンポーネントに一意な key を指定して再マウントしてください。',
    );
  }

  const setFrequency = useCallback((freq: RecurrenceFrequency) => {
    setState((current) => {
      if (current === null) {
        return current;
      }
      if (freq === 'weekly') {
        const fallbackByWeekday: readonly Weekday[] = [
          weekdayInZone(initialOptionsRef.current.start, initialOptionsRef.current.timeZone),
        ];
        const byWeekday = current.byWeekday ?? fallbackByWeekday;
        return { freq, interval: current.interval, end: current.end, byWeekday };
      }
      if (freq === 'monthly') {
        const fallbackMonthlyPattern: MonthlyRecurrencePattern = {
          kind: 'dayOfMonth',
          day: getWallClock(initialOptionsRef.current.start, initialOptionsRef.current.timeZone)
            .day,
        };
        const monthlyPattern = current.monthlyPattern ?? fallbackMonthlyPattern;
        return { freq, interval: current.interval, end: current.end, monthlyPattern };
      }
      return { freq, interval: current.interval, end: current.end };
    });
  }, []);

  const setIntervalValue = useCallback((interval: number) => {
    setState((current) => (current === null ? current : { ...current, interval }));
  }, []);

  const setByWeekday = useCallback((weekdays: readonly Weekday[]) => {
    setState((current) => (current === null ? current : { ...current, byWeekday: weekdays }));
  }, []);

  const setMonthlyPattern = useCallback((pattern: MonthlyRecurrencePattern) => {
    setState((current) => (current === null ? current : { ...current, monthlyPattern: pattern }));
  }, []);

  const setEnd = useCallback((end: RecurrenceEnd) => {
    setState((current) => (current === null ? current : { ...current, end }));
  }, []);

  const enable = useCallback(() => {
    setState((current) => {
      if (current !== null) {
        return current;
      }
      return { freq: 'daily', interval: 1, end: { type: 'never' } };
    });
    setUnsupportedRawRRule(null);
  }, []);

  const clear = useCallback(() => {
    setState(null);
    setUnsupportedRawRRule(null);
  }, []);

  const errors = useMemo(() => (state === null ? [] : validateRecurrenceRuleState(state)), [state]);

  const rruleString = useMemo(() => {
    if (state === null || errors.length > 0) {
      return null;
    }
    return buildRecurrenceRuleString({
      state,
      dtstart: initialOptionsRef.current.start,
      timeZone: initialOptionsRef.current.timeZone,
    });
  }, [state, errors]);

  const description = useMemo(() => {
    if (state === null) {
      return null;
    }
    const defaultDescription = describeRecurrenceRule(state, {
      dtstart: initialOptionsRef.current.start,
      timeZone: initialOptionsRef.current.timeZone,
    });
    return (options.describeRule ?? defaultDescribeRule)(state, defaultDescription);
  }, [state, options.describeRule]);

  return useMemo(
    () => ({
      state,
      unsupported: unsupportedRawRRule,
      setFrequency,
      setInterval: setIntervalValue,
      setByWeekday,
      setMonthlyPattern,
      setEnd,
      enable,
      clear,
      errors,
      rruleString,
      description,
    }),
    [
      state,
      unsupportedRawRRule,
      setFrequency,
      setIntervalValue,
      setByWeekday,
      setMonthlyPattern,
      setEnd,
      enable,
      clear,
      errors,
      rruleString,
      description,
    ],
  );
}
