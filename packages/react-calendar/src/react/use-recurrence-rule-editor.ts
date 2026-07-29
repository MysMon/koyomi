/**
 * @packageDocumentation
 * `useRecurrenceRuleEditor` — 繰り返しルールをフォーム入力向けの構造化状態として
 * 編集する React フック。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildRecurrenceRuleString,
  type MonthlyRecurrencePattern,
  parseRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceRuleState,
  type RecurrenceUnsupportedReason,
  type RecurrenceValidationIssue,
  validateRecurrenceRuleState,
} from '../core/recurrence-editor';
import { getWallClock, weekdayInZone } from '../core/timezone';
import type { TimeZoneId, Weekday } from '../core/types';
import { useOptionalCalendarContext } from './context';
import { isDevBuild } from './is-dev-build';
import { createMessageCatalog, resolveMessageCatalog } from './locales/resolve';
import type { MessageCatalogOverrides } from './locales/types';

/**
 * `useRecurrenceRuleEditor` のオプション。
 *
 * @remarks
 * `start` / `timeZone` / `rrule` は **作成時のみ有効**（`useCalendar` の
 * `options.events` と同じ規約）。マウント後にこれらを変更しても反映されない。
 * 編集対象（新規作成 / 既存オカレンス編集）を切り替える場合は
 * {@link UseRecurrenceRuleEditorResult.reset} を呼ぶ（このフックを使う
 * コンポーネントに一意な `key` を指定して再マウントする方法も引き続き使える）。
 */
export interface UseRecurrenceRuleEditorOptions {
  /** DTSTART。初期値としてのみ使用（切り替えは `reset`）。 */
  start: Date;
  /** イベントのタイムゾーン。初期値としてのみ使用（切り替えは `reset`）。 */
  timeZone: TimeZoneId;
  /**
   * 編集対象の既存 RRULE 文字列。省略時は「繰り返しなし」。初期値としてのみ
   * 使用（切り替えは `reset`）。
   */
  rrule?: string;
  /**
   * 文言を解決するロケール。`resolveMessageCatalog` と同じ規約で、言語サブタグ
   * （`-` より前）を大文字・小文字を無視して比較し、同梱カタログにない言語は
   * `'ja'` にフォールバックする。
   *
   * `start` / `timeZone` / `rrule` と異なり初期値限定ではなく、変更するたびに
   * 再解決される（編集対象の切り替えではなく表示言語の切り替えのため）。
   *
   * 省略時、`CalendarProvider` の配下では `state.options.locale` に自動で
   * 連動する（Provider の `locale` を切り替えるとこのフックの文言も追従する）。
   * `CalendarProvider` の配下でない場合、または明示的に指定した場合は `'ja'`
   * （既定）またはその指定値になる。
   */
  locale?: string;
  /**
   * 既定の文言（{@link UseRecurrenceRuleEditorResult.description} 等）を
   * 部分的に差し替える。`locale` と同様、変更するたびに再解決される。
   *
   * 省略時、`CalendarProvider` の配下かつ `locale` も省略している場合に限り、
   * Provider が解決した `recurrenceEditor` グループの文言（Provider 自身の
   * `messages` による上書きを含む）に自動で連動する。`locale` を明示的に
   * 指定した場合、または `CalendarProvider` の配下でない場合は既定文言
   * （上書きなし）が基準になる。この `messages` 自体を明示的に指定した場合は、
   * その指定値を基準カタログ（Provider 連動時は Provider のカタログ、それ以外
   * は既定カタログ）へ重ねてマージする。
   */
  messages?: MessageCatalogOverrides;
  /**
   * カレンダーの週の開始曜日。RRULE の `WKST` の出力
   * （{@link buildRecurrenceRuleString}）と受理判定（{@link parseRecurrenceRule}）
   * に使う。月曜（`1`）以外を指定すると {@link UseRecurrenceRuleEditorResult.rruleString}
   * に `WKST` が明示出力され、隔週（`INTERVAL` が 2 以上の weekly）の週境界が
   * カレンダーの表示と一致する。
   *
   * `start` / `timeZone` / `rrule` と異なり初期値限定ではなく、変更するたびに
   * `rruleString` の `WKST` 出力へ再反映される（`rrule` の受理判定には、マウント時
   * または {@link UseRecurrenceRuleEditorResult.reset} 呼び出し時点の値が使われる）。
   *
   * 省略時、`CalendarProvider` の配下では Provider の `state.options.weekStartsOn`
   * に自動で連動する（Provider の `weekStartsOn` を切り替えると `WKST` も追従する）。
   * `CalendarProvider` の配下でない場合は、RRULE 既定の月曜相当として扱う
   * （`WKST` を出力せず、`WKST=MO` の明示のみ受理する）。
   */
  weekStartsOn?: Weekday;
}

/** 編集対象（start/timeZone/rrule）の組。フックの内部状態と `reset` の引数で共有する。 */
type RecurrenceRuleEditorTarget = Pick<
  UseRecurrenceRuleEditorOptions,
  'start' | 'timeZone' | 'rrule'
>;

/**
 * 編集対象の浅いコピーを作る。呼び出し側のオブジェクトを後から変更されても
 * 内部状態が影響を受けないようにする（`rrule` 省略時はキー自体を持たない）。
 */
function copyTarget(target: RecurrenceRuleEditorTarget): RecurrenceRuleEditorTarget {
  return {
    start: target.start,
    timeZone: target.timeZone,
    ...(target.rrule !== undefined ? { rrule: target.rrule } : {}),
  };
}

/** `useRecurrenceRuleEditor` の戻り値。 */
export interface UseRecurrenceRuleEditorResult {
  /** 現在の構造化状態。`null` は「繰り返しなし」。 */
  state: RecurrenceRuleState | null;
  /** 対応範囲外の RRULE を読み込んだ場合の元情報。`state` が有効な間は `null`。 */
  unsupported: { rawRRule: string; reason: RecurrenceUnsupportedReason; message: string } | null;
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
  /**
   * 編集対象（`start` / `timeZone` / `rrule`）を切り替え、エディタ全体を
   * 新しい編集対象で初期化し直す。既存予定の編集ダイアログを再マウントせずに
   * 使い回す用途に使う（コンポーネントへの `key` 指定による再マウントと同等）。
   *
   * 編集中の `state` / `unsupported` は引き継がれず、渡した `rrule` の
   * `parseRecurrenceRule` の結果で置き換えられる（`rrule` 省略時は
   * 「繰り返しなし」）。以後の `rruleString` / `description` / `setFrequency` の
   * 既定値補完は、新しい `start` / `timeZone` を基準に計算される。
   *
   * @param target - 新しい編集対象（`start` / `timeZone` は必須、`rrule` は省略可）
   */
  reset(target: Pick<UseRecurrenceRuleEditorOptions, 'start' | 'timeZone' | 'rrule'>): void;
  /** `state` の検証エラー（空配列なら有効）。`message` は解決済みロケールの文言。 */
  errors: readonly (RecurrenceValidationIssue & { message: string })[];
  /** 現在の状態から生成された RRULE 文字列。`state` が `null` または検証エラーがある場合は `null`。 */
  rruleString: string | null;
  /** 現在の状態の説明文。`state` が `null` の場合は `null`。 */
  description: string | null;
}

/**
 * 繰り返しルールを構造化状態として編集する。
 *
 * RRULE 文字列の相互変換・検証は `core/recurrence-editor.ts` の純関数
 * （{@link parseRecurrenceRule} 等）に、説明文・検証エラー・非対応理由の文言化は
 * メッセージカタログ（`messages.recurrenceEditor`）に委譲し、このフックは React の
 * 状態管理（`state` の保持・setter の安定化）のみを担う。UI は提供しない
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
  /**
   * 現在の編集対象（start/timeZone/rrule）。初期値は初回マウント時の options で、
   * 以後は `reset()` でのみ更新される（options の変更は無視する規約）。
   */
  const [target, setTarget] = useState<RecurrenceRuleEditorTarget>(() => copyTarget(options));
  /** setter 群から参照を安定させたまま現在の編集対象を読むためのミラー。 */
  const targetRef = useRef(target);

  /**
   * `CalendarProvider` のコンテキスト（配下でなければ `null`）。`options.locale` /
   * `options.messages` / `options.weekStartsOn` 省略時のみ参照する（明示指定時は
   * 無視して従来どおり解決する）。
   */
  const providerContext = useOptionalCalendarContext();

  /**
   * 解決済みの週の開始曜日。優先順位は「明示オプション > Provider の
   * `state.options.weekStartsOn` > 未指定（RRULE 既定の月曜相当）」。
   * `locale` と同様に初期値限定ではなく、変更のたびに再解決される。
   */
  const resolvedWeekStartsOn =
    options.weekStartsOn ??
    (providerContext !== null ? providerContext.state.options.weekStartsOn : undefined);

  /** 初回マウント時の parseRecurrenceRule の結果（state/unsupported の初期値算出に使う）。 */
  const initialParsedRef = useRef<ReturnType<typeof parseRecurrenceRule> | null>(null);
  if (initialParsedRef.current === null) {
    initialParsedRef.current = parseRecurrenceRule({
      rrule: options.rrule,
      dtstart: options.start,
      timeZone: options.timeZone,
      ...(resolvedWeekStartsOn !== undefined ? { weekStartsOn: resolvedWeekStartsOn } : {}),
    });
  }
  const initialParsed = initialParsedRef.current;

  const [state, setState] = useState<RecurrenceRuleState | null>(() =>
    initialParsed.kind === 'editable' ? initialParsed.state : null,
  );
  const [unsupportedRawRRule, setUnsupportedRawRRule] = useState<{
    rawRRule: string;
    reason: RecurrenceUnsupportedReason;
  } | null>(() =>
    initialParsed.kind === 'unsupported'
      ? { rawRRule: initialParsed.rawRRule, reason: initialParsed.reason }
      : null,
  );

  /**
   * `options.locale` / `options.messages` から解決した文言カタログ。変更のたびに再解決する。
   *
   * 優先順位は「明示オプション > Provider > 既定 `'ja'`」。`options.locale` が
   * 省略されていて `Provider` 配下にある間は、Provider の `state.options.locale` /
   * 解決済みカタログ（Provider 自身の `messages` 上書きを含む）をそのまま基準にする
   * （`options.messages` を明示指定した場合はそこへ重ねてマージする）。`options.locale`
   * を明示指定した場合は Provider に依存せず単独で解決する（Provider の `messages`
   * 上書きは、Provider の `locale` を使わない解決には引き継がない）。
   */
  const catalog = useMemo(() => {
    if (options.locale === undefined && providerContext !== null) {
      return options.messages !== undefined
        ? createMessageCatalog(providerContext.messages, options.messages)
        : providerContext.messages;
    }
    return resolveMessageCatalog(options.locale ?? 'ja', options.messages);
  }, [options.locale, options.messages, providerContext]);

  // start/timeZone/rrule は初期値としてのみ有効。開発時のみ、マウント後に異なる
  // 値が渡されたことを一度だけ警告する（reset() か key 再マウントの運用を促す）。
  // reset() を使っている場合は編集対象を意図的に管理していると分かるため警告しない。
  const warnedRef = useRef(false);
  const didResetRef = useRef(false);
  if (
    isDevBuild() &&
    !warnedRef.current &&
    !didResetRef.current &&
    (options.start !== targetRef.current.start ||
      options.timeZone !== targetRef.current.timeZone ||
      options.rrule !== targetRef.current.rrule)
  ) {
    warnedRef.current = true;
    // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
    console.warn(
      '[koyomi] useRecurrenceRuleEditor の options.start / options.timeZone / options.rrule は' +
        '初期値としてのみ使われ、マウント後の変更は反映されません。編集対象を切り替える場合は、' +
        'reset({ start, timeZone, rrule }) を呼ぶか、このフックを使うコンポーネントに一意な key を' +
        '指定して再マウントしてください。',
    );
  }

  const setFrequency = useCallback((freq: RecurrenceFrequency) => {
    setState((current) => {
      if (current === null) {
        return current;
      }
      if (freq === 'weekly') {
        const fallbackByWeekday: readonly Weekday[] = [
          weekdayInZone(targetRef.current.start, targetRef.current.timeZone),
        ];
        const byWeekday = current.byWeekday ?? fallbackByWeekday;
        return { freq, interval: current.interval, end: current.end, byWeekday };
      }
      if (freq === 'monthly') {
        const fallbackMonthlyPattern: MonthlyRecurrencePattern = {
          kind: 'dayOfMonth',
          day: getWallClock(targetRef.current.start, targetRef.current.timeZone).day,
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

  const reset = useCallback(
    (nextTarget: RecurrenceRuleEditorTarget) => {
      const normalized = copyTarget(nextTarget);
      const parsed = parseRecurrenceRule({
        rrule: normalized.rrule,
        dtstart: normalized.start,
        timeZone: normalized.timeZone,
        ...(resolvedWeekStartsOn !== undefined ? { weekStartsOn: resolvedWeekStartsOn } : {}),
      });
      didResetRef.current = true;
      targetRef.current = normalized;
      setTarget(normalized);
      setState(parsed.kind === 'editable' ? parsed.state : null);
      setUnsupportedRawRRule(
        parsed.kind === 'unsupported' ? { rawRRule: parsed.rawRRule, reason: parsed.reason } : null,
      );
    },
    [resolvedWeekStartsOn],
  );

  const errors = useMemo(() => {
    if (state === null) {
      return [];
    }
    return validateRecurrenceRuleState(state).map((issue) => ({
      ...issue,
      message: catalog.recurrenceEditor.validationMessage(issue),
    }));
  }, [state, catalog]);

  const unsupported = useMemo(() => {
    if (unsupportedRawRRule === null) {
      return null;
    }
    return {
      ...unsupportedRawRRule,
      message: catalog.recurrenceEditor.unsupportedReason(unsupportedRawRRule.reason),
    };
  }, [unsupportedRawRRule, catalog]);

  const rruleString = useMemo(() => {
    if (state === null || errors.length > 0) {
      return null;
    }
    return buildRecurrenceRuleString({
      state,
      dtstart: target.start,
      timeZone: target.timeZone,
      ...(resolvedWeekStartsOn !== undefined ? { weekStartsOn: resolvedWeekStartsOn } : {}),
    });
  }, [state, errors, target, resolvedWeekStartsOn]);

  const description = useMemo(() => {
    if (state === null) {
      return null;
    }
    return catalog.recurrenceEditor.describeRule(state, {
      dtstart: target.start,
      timeZone: target.timeZone,
    });
  }, [state, catalog, target]);

  return useMemo(
    () => ({
      state,
      unsupported,
      setFrequency,
      setInterval: setIntervalValue,
      setByWeekday,
      setMonthlyPattern,
      setEnd,
      enable,
      clear,
      reset,
      errors,
      rruleString,
      description,
    }),
    [
      state,
      unsupported,
      setFrequency,
      setIntervalValue,
      setByWeekday,
      setMonthlyPattern,
      setEnd,
      enable,
      clear,
      reset,
      errors,
      rruleString,
      description,
    ],
  );
}
