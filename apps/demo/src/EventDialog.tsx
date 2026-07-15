/**
 * @packageDocumentation
 * `EventDialog` — 予定の作成・編集ダイアログ。
 *
 * `<dialog>` 要素をネイティブモーダルとして使用する。新規作成（範囲選択から）と
 * 編集（オカレンスクリックから）の両方をこのコンポーネントで扱う。繰り返し予定の
 * 変更・削除は、保存・削除の直前に `resolveRecurringScope` で適用範囲を確認する。
 * 編集対象イベントが `extendedProps` を持つ場合、その内容を読み取り専用で表示する。
 * 繰り返しルールの編集フォームは `useRecurrenceRuleEditor`（{@link RecurrenceRuleFields}）
 * に委ねる。
 */

import type {
  CalendarApi,
  CalendarEventInput,
  CalendarEventPatch,
  EventOccurrence,
  MonthlyRecurrencePattern,
  RangeSelection,
  RecurrenceEnd,
  RecurrenceFrequency,
  RecurrenceWeekdayOrdinal,
  RecurringEditScope,
  TimeZoneId,
  Weekday,
} from '@koyomi-cal/react';
import {
  addDaysInZone,
  dateFromKey,
  dateKeyInZone,
  fromWallClock,
  getWallClock,
  parseDateValue,
  useRecurrenceRuleEditor,
  weekdayInZone,
} from '@koyomi-cal/react';
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import type { ScopeAction } from './ScopeDialog';

/**
 * ダイアログの表示モード。
 * `create` は範囲選択からの新規作成、`edit` はオカレンスクリックからの編集。
 */
export type EventDialogMode =
  | { type: 'create'; selection: RangeSelection }
  | { type: 'edit'; occurrence: EventOccurrence };

/** `EventDialog` の props。 */
export interface EventDialogProps {
  /** 表示するモード。`null` なら非表示（内容は描画しないが `<dialog>` 自体は常にマウントする）。 */
  mode: EventDialogMode | null;
  /** 現在の表示タイムゾーン。フォームの日時入力はこのタイムゾーンの現地時刻として解釈・表示する。 */
  timeZone: TimeZoneId;
  /** カレンダーエンジンの API。保存・削除の実行に使う。 */
  api: CalendarApi;
  /**
   * 繰り返し予定の適用範囲を尋ねる。`CalendarInteractionCallbacks.resolveRecurringScope`
   * と同じ関数を流用する想定（呼び出し元でダイアログ UI を共有する）。
   */
  resolveRecurringScope: (
    occurrence: EventOccurrence,
    action: ScopeAction,
  ) => Promise<RecurringEditScope | null>;
  /** ダイアログが閉じられたときに呼ばれる（保存・削除・キャンセル・Esc すべて共通）。 */
  onClose: () => void;
  /**
   * 新規作成が確定した直後に呼ばれる（`useCalendarAnnouncer` の `announce` を渡す想定）。
   * このダイアログは `onSelectRange` を自前実装しているため、`wrapCallbacks` の
   * 既定即時作成向け自動通知は発火しない。作成確定はこのダイアログの責務のため、
   * ここで明示的に通知する。省略時は何も通知しない。
   */
  announce?: (text: string) => void;
}

/** 既定の予定の色（スウォッチの先頭）。 */
const DEFAULT_EVENT_COLOR = '#3f51b5';

/** 色スウォッチの選択肢一覧。 */
const EVENT_COLORS: readonly { value: string; label: string }[] = [
  { value: DEFAULT_EVENT_COLOR, label: 'ブルーベリー' },
  { value: '#137333', label: 'セージ' },
  { value: '#8e24aa', label: 'グレープ' },
  { value: '#b3261e', label: 'フラミンゴ' },
  { value: '#8d6e00', label: 'バナナ' },
  { value: '#c53929', label: 'タンジェリン' },
  { value: '#006b75', label: 'ピーコック' },
  { value: '#616161', label: 'グラファイト' },
];

/** フォームの入力状態。日時は文字列ではなく絶対時刻（`Date`）で保持する。 */
interface FormState {
  title: string;
  allDay: boolean;
  start: Date;
  end: Date;
  color: string;
  location: string;
  description: string;
  /**
   * 繰り返しルールの現在の実効的な RRULE 文字列（{@link RecurrenceRuleFields} からの
   * 通知を反映）。繰り返しなしは `undefined`。unsupported な RRULE を編集中の場合は
   * その元の文字列をそのまま保持する（読み取り専用表示のため変更しない）。
   */
  rrule: string | undefined;
  /** 繰り返しルールの検証エラーがあるか（`true` の間は保存を無効化する）。 */
  recurrenceHasErrors: boolean;
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `datetime-local` input の value 用に、指定タイムゾーンの現地時刻を
 * `'YYYY-MM-DDTHH:mm'` 形式にする。
 */
function formatDateTimeLocalValue(date: Date, timeZone: TimeZoneId): string {
  const wall = getWallClock(date, timeZone);
  return `${String(wall.year).padStart(4, '0')}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hours)}:${pad2(wall.minutes)}`;
}

/**
 * `extendedProps` の値（型不明）を読み取り専用表示用の文字列にする。
 * ライブラリは内容に関知しないため、プリミティブはそのまま文字列化し、
 * それ以外（オブジェクト・配列など）は JSON 表現にフォールバックする。
 */
function formatExtendedPropValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '(なし)';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** モードに応じた初期フォーム状態を組み立てる。 */
function buildFormState(mode: EventDialogMode): FormState {
  if (mode.type === 'create') {
    const { range, allDay } = mode.selection;
    return {
      title: '',
      allDay,
      start: range.start,
      end: range.end,
      color: DEFAULT_EVENT_COLOR,
      location: '',
      description: '',
      rrule: undefined,
      recurrenceHasErrors: false,
    };
  }
  const { event, start, end, allDay } = mode.occurrence;
  return {
    title: event.title,
    allDay,
    start,
    end,
    color: event.color ?? DEFAULT_EVENT_COLOR,
    location: event.location ?? '',
    description: event.description ?? '',
    rrule: event.rrule,
    recurrenceHasErrors: false,
  };
}

/**
 * {@link buildFormState} と対応する、{@link RecurrenceRuleFields} を
 * mode の変更ごとに再マウントするための `key`。
 *
 * `useRecurrenceRuleEditor` の `start` / `timeZone` / `rrule` は作成時のみ有効な
 * ため、編集対象（新規作成 / 既存オカレンス編集）が切り替わるたびに一意な `key` で
 * 再マウントする必要がある（`docs` の規約どおり、フックの TSDoc に従う）。
 */
function recurrenceEditorKeyFor(mode: EventDialogMode): string {
  if (mode.type === 'create') {
    return `create-${mode.selection.range.start.getTime()}-${mode.selection.range.end.getTime()}`;
  }
  return `edit-${mode.occurrence.key}`;
}

/**
 * `rrule` を含めたパッチを組み立てる。
 *
 * `CalendarEventPatch` の各フィールドは明示的に `| undefined` を許容するため、
 * `exactOptionalPropertyTypes: true` の下でもキャストなしでリテラルのまま
 * `rrule: undefined` を書ける。`rrule` が `undefined`（繰り返し解除）の場合、
 * ライブラリの `applyPatch` は「キーが存在し値が `undefined`」をフィールド削除
 * として扱う（`packages/react-calendar/src/core/mutations.ts` 参照）。
 */
function withRRule(patch: CalendarEventPatch, rrule: string | undefined): CalendarEventPatch {
  return { ...patch, rrule };
}

/** 繰り返し頻度 select の選択肢一覧。 */
const FREQUENCY_OPTIONS: readonly { value: RecurrenceFrequency; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

/** 曜日チェックボックス群・月内パターンの曜日 select で共通して使う選択肢一覧（月曜始まり表示）。 */
const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

/** 月内パターンの「第 n 週」select の選択肢一覧。 */
const ORDINAL_OPTIONS: readonly { value: RecurrenceWeekdayOrdinal; label: string }[] = [
  { value: 1, label: '第1' },
  { value: 2, label: '第2' },
  { value: 3, label: '第3' },
  { value: 4, label: '第4' },
  { value: -1, label: '最終' },
];

/** 文字列が {@link RecurrenceFrequency} の値かどうかを判定する（`<select>` の値検証用）。 */
function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return FREQUENCY_OPTIONS.some((option) => option.value === value);
}

/**
 * `<select>` の曜日の値を検証しつつ {@link Weekday} に変換する。
 *
 * @throws `WEEKDAY_OPTIONS` にない値の場合は `Error`
 */
function parseWeekdayOption(value: string): Weekday {
  const parsed = Number(value);
  if (WEEKDAY_OPTIONS.some((option) => option.value === parsed)) {
    // 上の判定で WEEKDAY_OPTIONS の値（Weekday）のいずれかと一致することを確認済み
    return parsed as Weekday;
  }
  throw new Error(`不正な曜日の値です: '${value}'`);
}

/**
 * `<select>` の「第 n 週」の値を検証しつつ {@link RecurrenceWeekdayOrdinal} に変換する。
 *
 * @throws `ORDINAL_OPTIONS` にない値の場合は `Error`
 */
function parseOrdinalOption(value: string): RecurrenceWeekdayOrdinal {
  const parsed = Number(value);
  if (ORDINAL_OPTIONS.some((option) => option.value === parsed)) {
    // 上の判定で ORDINAL_OPTIONS の値（RecurrenceWeekdayOrdinal）のいずれかと一致することを確認済み
    return parsed as RecurrenceWeekdayOrdinal;
  }
  throw new Error(`不正な第 n 週の値です: '${value}'`);
}

/** {@link RecurrenceRuleFields} が親（{@link EventDialog}）へ通知する、現在の実効的な結果。 */
interface RecurrenceFieldsResult {
  /** 現在の実効的な RRULE 文字列。繰り返しなしは `undefined`。 */
  rrule: string | undefined;
  /** 保存を妨げる検証エラーがあるか。 */
  hasErrors: boolean;
}

/** {@link MonthlyPatternFields} の props。 */
interface MonthlyPatternFieldsProps {
  pattern: MonthlyRecurrencePattern | undefined;
  disabled: boolean;
  fallbackDay: number;
  fallbackWeekday: Weekday;
  onChange: (pattern: MonthlyRecurrencePattern) => void;
}

/**
 * 「毎月」の月内パターン（日付指定 / 第 n 曜日指定）を選ぶラジオ群。
 *
 * `pattern` が未設定（DTSTART に暗黙依存している状態）の間は、ラジオの現在値として
 * 「日付指定」を仮定して表示するが、実際に切り替えるまで `pattern` 自体は変更しない。
 */
function MonthlyPatternFields(props: MonthlyPatternFieldsProps): ReactElement {
  const { pattern, disabled, fallbackDay, fallbackWeekday, onChange } = props;
  const baseId = useId();
  const kind = pattern?.kind ?? 'dayOfMonth';

  return (
    <div className="demo-form-field">
      <span className="demo-field-label" id={`${baseId}-monthly-label`}>
        月内パターン
      </span>
      <div
        className="demo-radio-group"
        role="radiogroup"
        aria-labelledby={`${baseId}-monthly-label`}
      >
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-monthly-kind`}
            disabled={disabled}
            checked={kind === 'dayOfMonth'}
            onChange={() => onChange({ kind: 'dayOfMonth', day: fallbackDay })}
          />
          日付指定
          {pattern?.kind === 'dayOfMonth' && (
            <input
              type="number"
              className="demo-inline-number"
              min={-1}
              max={31}
              disabled={disabled}
              value={pattern.day}
              onChange={(event) =>
                onChange({ kind: 'dayOfMonth', day: Number(event.target.value) })
              }
            />
          )}
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-monthly-kind`}
            disabled={disabled}
            checked={kind === 'nthWeekday'}
            onChange={() => onChange({ kind: 'nthWeekday', ordinal: 1, weekday: fallbackWeekday })}
          />
          第 n 曜日指定
          {pattern?.kind === 'nthWeekday' && (
            <>
              <select
                disabled={disabled}
                value={pattern.ordinal}
                onChange={(event) =>
                  onChange({
                    kind: 'nthWeekday',
                    ordinal: parseOrdinalOption(event.target.value),
                    weekday: pattern.weekday,
                  })
                }
              >
                {ORDINAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                disabled={disabled}
                value={pattern.weekday}
                onChange={(event) =>
                  onChange({
                    kind: 'nthWeekday',
                    ordinal: pattern.ordinal,
                    weekday: parseWeekdayOption(event.target.value),
                  })
                }
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

/** {@link RecurrenceEndFields} の props。 */
interface RecurrenceEndFieldsProps {
  end: RecurrenceEnd;
  disabled: boolean;
  timeZone: TimeZoneId;
  onChange: (end: RecurrenceEnd) => void;
}

/** 繰り返しの終了条件（なし / 回数 / 日付）を選ぶラジオ群。 */
function RecurrenceEndFields(props: RecurrenceEndFieldsProps): ReactElement {
  const { end, disabled, timeZone, onChange } = props;
  const baseId = useId();

  return (
    <div className="demo-form-field">
      <span className="demo-field-label" id={`${baseId}-end-label`}>
        終了条件
      </span>
      <div className="demo-radio-group" role="radiogroup" aria-labelledby={`${baseId}-end-label`}>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'never'}
            onChange={() => onChange({ type: 'never' })}
          />
          なし
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'count'}
            onChange={() =>
              onChange({ type: 'count', count: end.type === 'count' ? end.count : 5 })
            }
          />
          回数
          {end.type === 'count' && (
            <input
              type="number"
              className="demo-inline-number"
              min={1}
              disabled={disabled}
              value={end.count}
              onChange={(event) => onChange({ type: 'count', count: Number(event.target.value) })}
            />
          )}
        </label>
        <label className="demo-radio-option">
          <input
            type="radio"
            name={`${baseId}-end-type`}
            disabled={disabled}
            checked={end.type === 'until'}
            onChange={() =>
              onChange({ type: 'until', until: end.type === 'until' ? end.until : new Date() })
            }
          />
          日付
          {end.type === 'until' && (
            <input
              type="date"
              disabled={disabled}
              value={dateKeyInZone(end.until, timeZone)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '') {
                  return;
                }
                onChange({ type: 'until', until: dateFromKey(value, timeZone) });
              }}
            />
          )}
        </label>
      </div>
    </div>
  );
}

/** {@link RecurrenceRuleFields} の props。 */
interface RecurrenceRuleFieldsProps {
  /** DTSTART。`useRecurrenceRuleEditor` の規約どおり初期値としてのみ使う。 */
  start: Date;
  /** イベントのタイムゾーン。初期値としてのみ使う。 */
  timeZone: TimeZoneId;
  /** 編集対象の既存 RRULE 文字列。初期値としてのみ使う。 */
  initialRRule: string | undefined;
  /** `editable: false` の予定を読み取り専用表示にする。 */
  disabled: boolean;
  /** 現在の実効的な結果が変わるたびに呼ばれる。 */
  onResultChange: (result: RecurrenceFieldsResult) => void;
}

/**
 * `useRecurrenceRuleEditor` による繰り返しルールの編集フォーム。
 *
 * 頻度セレクト＋（`weekly` 時のみ）曜日チェックボックス群＋（`monthly` 時のみ）
 * 日付/第 n 曜日ラジオ＋終了条件（なし/回数/日付）ラジオ＋ interval 数値入力を、
 * 素の HTML 要素で組む（ヘッドレスなフックをそのまま UI 化する最小構成の例）。
 * 対応範囲外の RRULE を読み込んだ場合（`editor.unsupported`）は、読み取り専用の
 * 案内文と元の RRULE 文字列をそのまま表示する。
 *
 * `start` / `timeZone` / `initialRRule` は `useRecurrenceRuleEditor` の規約により
 * 初期値としてのみ有効なため、呼び出し側（{@link EventDialog}）は編集対象が
 * 切り替わるたびに一意な `key` を指定してこのコンポーネントを再マウントすること。
 */
function RecurrenceRuleFields(props: RecurrenceRuleFieldsProps): ReactElement {
  const { start, timeZone, initialRRule, disabled, onResultChange } = props;
  const baseId = useId();
  // exactOptionalPropertyTypes: true の下では `rrule: undefined` を明示できないため、
  // 初期 RRULE が無い場合はキー自体を省略する。
  const editor = useRecurrenceRuleEditor(
    initialRRule === undefined ? { start, timeZone } : { start, timeZone, rrule: initialRRule },
  );

  // 親（EventDialog）が渡す onResultChange はレンダーごとに新しい参照になりうるため、
  // ref 経由で最新を読み、effect の依存には含めない（依存に含めると、この effect が
  // 呼ぶ親の setForm による再レンダーで参照が変わり無限ループになる）。
  const onResultChangeRef = useRef(onResultChange);
  onResultChangeRef.current = onResultChange;
  // 直近に親へ送った結果。値が実際に変わったときだけ通知して不要な再描画を防ぐ。
  const lastSentRef = useRef<RecurrenceFieldsResult | null>(null);

  // editor の実効的な結果が変わるたびに親（EventDialog のフォーム状態）へ伝える。
  useEffect(() => {
    let next: RecurrenceFieldsResult;
    if (editor.unsupported !== null) {
      // 対応範囲外の RRULE は編集できないため、元の文字列をそのまま維持する。
      next = { rrule: editor.unsupported.rawRRule, hasErrors: false };
    } else if (editor.state === null) {
      next = { rrule: undefined, hasErrors: false };
    } else {
      next = {
        rrule: editor.errors.length === 0 ? (editor.rruleString ?? undefined) : undefined,
        hasErrors: editor.errors.length > 0,
      };
    }
    const last = lastSentRef.current;
    if (last !== null && last.rrule === next.rrule && last.hasErrors === next.hasErrors) {
      return;
    }
    lastSentRef.current = next;
    onResultChangeRef.current(next);
  }, [editor.unsupported, editor.state, editor.errors, editor.rruleString]);

  if (editor.unsupported !== null) {
    return (
      <div className="demo-form-field">
        <span className="demo-field-label">繰り返し</span>
        <p className="demo-readonly-notice">
          このRRULEは編集できません（{editor.unsupported.reason}）。
        </p>
        <pre className="demo-recurrence-raw">{editor.unsupported.rawRRule}</pre>
        <button
          type="button"
          className="demo-button demo-button-text"
          disabled={disabled}
          onClick={editor.clear}
        >
          繰り返しを解除
        </button>
      </div>
    );
  }

  if (editor.state === null) {
    return (
      <div className="demo-form-field">
        <span className="demo-field-label">繰り返し</span>
        <button type="button" className="demo-button" disabled={disabled} onClick={editor.enable}>
          繰り返しを設定
        </button>
      </div>
    );
  }

  const { state } = editor;

  return (
    <div className="demo-form-field demo-recurrence-fields">
      <span className="demo-field-label" id={`${baseId}-recurrence-label`}>
        繰り返し
      </span>

      <div className="demo-form-row">
        <div className="demo-form-field">
          <label htmlFor={`${baseId}-freq`}>頻度</label>
          <select
            id={`${baseId}-freq`}
            disabled={disabled}
            value={state.freq}
            onChange={(event) => {
              const raw = event.target.value;
              if (isRecurrenceFrequency(raw)) {
                editor.setFrequency(raw);
              }
            }}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="demo-form-field">
          <label htmlFor={`${baseId}-interval`}>間隔</label>
          <input
            id={`${baseId}-interval`}
            type="number"
            min={1}
            disabled={disabled}
            value={state.interval}
            onChange={(event) => editor.setInterval(Number(event.target.value))}
          />
        </div>
      </div>

      {state.freq === 'weekly' && (
        <fieldset className="demo-form-field demo-weekday-fieldset">
          <legend className="demo-field-label">曜日</legend>
          <div className="demo-weekday-checkboxes">
            {WEEKDAY_OPTIONS.map((option) => {
              const checked = state.byWeekday?.includes(option.value) ?? false;
              return (
                <label key={option.value} className="demo-weekday-checkbox">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(event) => {
                      const current = state.byWeekday ?? [];
                      const next = event.target.checked
                        ? [...current, option.value]
                        : current.filter((weekday) => weekday !== option.value);
                      editor.setByWeekday(next);
                    }}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {state.freq === 'monthly' && (
        <MonthlyPatternFields
          pattern={state.monthlyPattern}
          disabled={disabled}
          fallbackDay={getWallClock(start, timeZone).day}
          fallbackWeekday={weekdayInZone(start, timeZone)}
          onChange={editor.setMonthlyPattern}
        />
      )}

      <RecurrenceEndFields
        end={state.end}
        disabled={disabled}
        timeZone={timeZone}
        onChange={editor.setEnd}
      />

      {editor.errors.length > 0 && (
        <ul className="demo-recurrence-errors">
          {editor.errors.map((issue) => (
            <li key={issue.field}>{issue.message}</li>
          ))}
        </ul>
      )}

      {editor.description !== null && <p className="demo-field-hint">{editor.description}</p>}

      <button
        type="button"
        className="demo-button demo-button-text"
        disabled={disabled}
        onClick={editor.clear}
      >
        繰り返しを解除
      </button>
    </div>
  );
}

/**
 * 予定の作成・編集ダイアログ。
 *
 * - 新規作成: 保存で `api.createEvent`
 * - 単発予定の編集: 保存で `api.updateEvent` / 削除で `api.deleteEvent`
 * - 繰り返しオカレンスの編集: 保存・削除の前に `resolveRecurringScope` で適用範囲を
 *   確認する。キャンセル（`null`）の場合は何もせずダイアログを開いたままにする。
 *   繰り返しルール自体の変更は `scope: 'all'` のときのみ反映する
 * - `editable: false` の予定は読み取り専用として表示する
 * - `extendedProps` を持つ予定は、その内容を編集不可の一覧として表示する
 *
 * @example
 * ```tsx
 * <EventDialog
 *   mode={dialogMode}
 *   timeZone={state.timeZone}
 *   api={api}
 *   resolveRecurringScope={resolveRecurringScope}
 *   onClose={() => setDialogMode(null)}
 * />
 * ```
 */
export function EventDialog(props: EventDialogProps): ReactElement {
  const { mode, timeZone, api, resolveRecurringScope, onClose, announce } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const baseId = useId();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // mode が新しく設定されるたびにフォームを初期化する
  useEffect(() => {
    if (mode !== null) {
      setForm(buildFormState(mode));
      setError(null);
    }
  }, [mode]);

  // mode の有無に応じて <dialog> の開閉を同期する
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return;
    }
    if (mode !== null && !dialogEl.open) {
      dialogEl.showModal();
    } else if (mode === null && dialogEl.open) {
      dialogEl.close();
    }
  }, [mode]);

  // ネイティブな close（Esc・保存・キャンセルボタンいずれも close() 経由）を
  // 呼び出し元の状態クリアに伝える
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return undefined;
    }
    function handleClose(): void {
      onClose();
    }
    dialogEl.addEventListener('close', handleClose);
    return () => dialogEl.removeEventListener('close', handleClose);
  }, [onClose]);

  if (mode === null || form === null) {
    // フォーム未初期化の間も <dialog> 自体は常にマウントし、ref を安定させる
    return <dialog ref={dialogRef} className="demo-dialog demo-event-dialog" />;
  }

  const occurrence = mode.type === 'edit' ? mode.occurrence : null;
  const isReadOnly = occurrence !== null && occurrence.event.editable === false;

  /** フォーム状態を部分更新する。 */
  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }));
  };

  /** 終日チェックの切り替え。時間指定 ⇔ 終日で開始・終了を作り直す。 */
  const handleAllDayToggle = (nextAllDay: boolean): void => {
    setForm((prev) => {
      if (prev === null || prev.allDay === nextAllDay) {
        return prev;
      }
      if (nextAllDay) {
        const startKey = dateKeyInZone(prev.start, timeZone);
        const lastIncludedInstant = new Date(
          Math.max(prev.end.getTime() - 1, prev.start.getTime()),
        );
        const endKey = dateKeyInZone(lastIncludedInstant, timeZone);
        const start = dateFromKey(startKey, timeZone);
        const inclusiveEnd = dateFromKey(endKey, timeZone);
        const end = addDaysInZone(
          inclusiveEnd.getTime() > start.getTime() ? inclusiveEnd : start,
          1,
          timeZone,
        );
        return { ...prev, allDay: true, start, end };
      }
      const wall = getWallClock(prev.start, timeZone);
      const dayParts = { year: wall.year, month: wall.month, day: wall.day };
      const start = fromWallClock({ ...dayParts, hours: 9 }, timeZone);
      const end = fromWallClock({ ...dayParts, hours: 10 }, timeZone);
      return { ...prev, allDay: false, start, end };
    });
  };

  /** 保存（新規作成 or 更新）。 */
  const handleSubmit = async (formEvent: FormEvent<HTMLFormElement>): Promise<void> => {
    formEvent.preventDefault();
    if (isReadOnly) {
      return;
    }
    if (form.end.getTime() <= form.start.getTime()) {
      setError('終了日時は開始日時より後になるように入力してください。');
      return;
    }
    if (form.recurrenceHasErrors) {
      setError('繰り返しルールの入力内容を確認してください。');
      return;
    }
    setError(null);

    const rrule = form.rrule;
    // CalendarEventPatch は Partial のため型注釈すると全フィールドが optional になり、
    // CalendarEventInput の必須フィールド（title / start）を満たせなくなる。
    // ここでは注釈せずリテラル型（全フィールド確定値）のまま推論させる。
    const commonFields = {
      title: form.title,
      start: form.start,
      end: form.end,
      allDay: form.allDay,
      color: form.color,
      location: form.location,
      description: form.description,
    };

    if (mode.type === 'create') {
      const input: CalendarEventInput = {
        ...commonFields,
        ...(rrule !== undefined ? { rrule } : {}),
      };
      const created = api.createEvent(input);
      announce?.(`${created.title} を作成しました`);
      dialogRef.current?.close();
      return;
    }

    const targetOccurrence = mode.occurrence;

    if (!targetOccurrence.isRecurring) {
      api.updateEvent(targetOccurrence.eventId, {
        ...commonFields,
        ...(rrule !== undefined ? { rrule } : {}),
      });
      dialogRef.current?.close();
      return;
    }

    const scope = await resolveRecurringScope(targetOccurrence, 'update');
    if (scope === null) {
      // キャンセル: 何もしない（ダイアログは開いたまま）
      return;
    }
    // 繰り返しルール自体の変更は「すべての予定」のときのみ反映する
    const patch = scope === 'all' ? withRRule(commonFields, rrule) : commonFields;
    api.updateEvent(targetOccurrence.eventId, patch, {
      occurrenceStart: targetOccurrence.originalStart,
      scope,
    });
    dialogRef.current?.close();
  };

  /** 削除。 */
  const handleDelete = async (): Promise<void> => {
    if (mode.type !== 'edit' || isReadOnly) {
      return;
    }
    const targetOccurrence = mode.occurrence;
    if (!targetOccurrence.isRecurring) {
      api.deleteEvent(targetOccurrence.eventId);
      dialogRef.current?.close();
      return;
    }
    const scope = await resolveRecurringScope(targetOccurrence, 'delete');
    if (scope === null) {
      // キャンセル: 何もしない（ダイアログは開いたまま）
      return;
    }
    api.deleteEvent(targetOccurrence.eventId, {
      occurrenceStart: targetOccurrence.originalStart,
      scope,
    });
    dialogRef.current?.close();
  };

  return (
    <dialog ref={dialogRef} className="demo-dialog demo-event-dialog">
      <form
        className="demo-form"
        onSubmit={(formEvent) => {
          void handleSubmit(formEvent);
        }}
      >
        <h2 className="demo-dialog-title">
          {mode.type === 'create' ? '予定を作成' : '予定を編集'}
        </h2>

        {isReadOnly && (
          <p className="demo-readonly-notice">
            この予定は編集できません（<code>editable: false</code>）。
          </p>
        )}

        <div className="demo-form-field">
          <label htmlFor={`${baseId}-title`}>タイトル</label>
          <input
            id={`${baseId}-title`}
            type="text"
            required
            disabled={isReadOnly}
            value={form.title}
            onChange={(changeEvent) => patchForm({ title: changeEvent.target.value })}
          />
        </div>

        <div className="demo-form-field demo-checkbox-field">
          <label htmlFor={`${baseId}-allday`}>
            <input
              id={`${baseId}-allday`}
              type="checkbox"
              disabled={isReadOnly}
              checked={form.allDay}
              onChange={(changeEvent) => handleAllDayToggle(changeEvent.target.checked)}
            />
            終日
          </label>
        </div>

        <div className="demo-form-row">
          <div className="demo-form-field">
            <label htmlFor={`${baseId}-start`}>開始</label>
            <input
              id={`${baseId}-start`}
              type={form.allDay ? 'date' : 'datetime-local'}
              required
              disabled={isReadOnly}
              value={
                form.allDay
                  ? dateKeyInZone(form.start, timeZone)
                  : formatDateTimeLocalValue(form.start, timeZone)
              }
              onChange={(changeEvent) => {
                const value = changeEvent.target.value;
                if (value === '') {
                  return;
                }
                const start = form.allDay
                  ? dateFromKey(value, timeZone)
                  : parseDateValue(value, timeZone, false);
                patchForm({ start });
              }}
            />
          </div>
          <div className="demo-form-field">
            <label htmlFor={`${baseId}-end`}>終了{form.allDay ? '日' : ''}</label>
            <input
              id={`${baseId}-end`}
              type={form.allDay ? 'date' : 'datetime-local'}
              required
              disabled={isReadOnly}
              value={
                form.allDay
                  ? dateKeyInZone(addDaysInZone(form.end, -1, timeZone), timeZone)
                  : formatDateTimeLocalValue(form.end, timeZone)
              }
              onChange={(changeEvent) => {
                const value = changeEvent.target.value;
                if (value === '') {
                  return;
                }
                const end = form.allDay
                  ? addDaysInZone(dateFromKey(value, timeZone), 1, timeZone)
                  : parseDateValue(value, timeZone, false);
                patchForm({ end });
              }}
            />
          </div>
        </div>

        <div className="demo-form-field">
          <span className="demo-field-label" id={`${baseId}-color-label`}>
            色
          </span>
          <div
            className="demo-color-swatches"
            role="radiogroup"
            aria-labelledby={`${baseId}-color-label`}
          >
            {EVENT_COLORS.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className="demo-color-swatch"
                style={{ backgroundColor: swatch.value }}
                aria-label={swatch.label}
                aria-pressed={form.color === swatch.value}
                disabled={isReadOnly}
                onClick={() => patchForm({ color: swatch.value })}
              />
            ))}
          </div>
        </div>

        <div className="demo-form-field">
          <label htmlFor={`${baseId}-location`}>場所</label>
          <input
            id={`${baseId}-location`}
            type="text"
            disabled={isReadOnly}
            value={form.location}
            onChange={(changeEvent) => patchForm({ location: changeEvent.target.value })}
          />
        </div>

        <div className="demo-form-field">
          <label htmlFor={`${baseId}-description`}>説明</label>
          <textarea
            id={`${baseId}-description`}
            rows={3}
            disabled={isReadOnly}
            value={form.description}
            onChange={(changeEvent) => patchForm({ description: changeEvent.target.value })}
          />
        </div>

        <RecurrenceRuleFields
          key={recurrenceEditorKeyFor(mode)}
          start={mode.type === 'create' ? mode.selection.range.start : mode.occurrence.start}
          timeZone={timeZone}
          initialRRule={mode.type === 'create' ? undefined : mode.occurrence.event.rrule}
          disabled={isReadOnly}
          onResultChange={(result) =>
            patchForm({ rrule: result.rrule, recurrenceHasErrors: result.hasErrors })
          }
        />
        {occurrence?.isRecurring && (
          <p className="demo-field-hint">
            繰り返しの種類の変更は「すべての予定」を選んだ場合のみ反映されます。
          </p>
        )}

        {occurrence !== null && occurrence.event.extendedProps !== undefined && (
          <div className="demo-form-field">
            <span className="demo-field-label" id={`${baseId}-extended-props-label`}>
              追加情報（extendedProps、読み取り専用）
            </span>
            <dl
              className="demo-extended-props-list"
              aria-labelledby={`${baseId}-extended-props-label`}
            >
              {Object.entries(occurrence.event.extendedProps).map(([key, value]) => (
                <div key={key} className="demo-extended-props-row">
                  <dt>{key}</dt>
                  <dd>{formatExtendedPropValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {error !== null && <p className="demo-error">{error}</p>}

        <div className="demo-dialog-actions">
          {isReadOnly ? (
            <button
              type="button"
              className="demo-button"
              onClick={() => dialogRef.current?.close()}
            >
              閉じる
            </button>
          ) : (
            <>
              {mode.type === 'edit' && (
                <button
                  type="button"
                  className="demo-button demo-button-danger"
                  onClick={() => {
                    void handleDelete();
                  }}
                >
                  削除
                </button>
              )}
              <div className="demo-dialog-actions-spacer" />
              <button
                type="button"
                className="demo-button demo-button-text"
                onClick={() => dialogRef.current?.close()}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="demo-button demo-button-primary"
                disabled={form.recurrenceHasErrors}
              >
                保存
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
