/**
 * @packageDocumentation
 * `EventDialog` — 予定の作成・編集ダイアログ。
 *
 * `<dialog>` 要素をネイティブモーダルとして使用する。新規作成（範囲選択から）と
 * 編集（オカレンスクリックから）の両方をこのコンポーネントで扱う。繰り返し予定の
 * 変更・削除は、保存・削除の直前に `resolveRecurringScope` で適用範囲を確認する。
 * 編集対象イベントが `extendedProps` を持つ場合、その内容を読み取り専用で表示する。
 */

import type {
  CalendarApi,
  CalendarEventInput,
  CalendarEventPatch,
  EventOccurrence,
  RangeSelection,
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
}

/** 繰り返しの種類（フォーム上の選択肢）。 */
type RecurrenceOption =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'weekdays';

/** 繰り返し select の選択肢一覧。 */
const RECURRENCE_OPTIONS: readonly { value: RecurrenceOption; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'biweekly', label: '隔週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
  { value: 'weekdays', label: '平日（月〜金）' },
];

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
  recurrence: RecurrenceOption;
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

/** 曜日番号を RRULE の `BYDAY` コードに変換する。 */
function byDayCode(weekday: Weekday): string {
  const codes: Record<Weekday, string> = {
    0: 'SU',
    1: 'MO',
    2: 'TU',
    3: 'WE',
    4: 'TH',
    5: 'FR',
    6: 'SA',
  };
  return codes[weekday];
}

/**
 * 繰り返しの選択肢を RRULE 文字列に変換する（`'none'` は `undefined`）。
 * `DTSTART` は保存時に `start` から自動的に補われるため、`FREQ=MONTHLY` /
 * `FREQ=YEARLY` には `BY*` を付けず開始日の日・月に暗黙的に従わせる。
 */
function rruleForRecurrence(
  option: RecurrenceOption,
  start: Date,
  timeZone: TimeZoneId,
): string | undefined {
  switch (option) {
    case 'none':
      return undefined;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${byDayCode(weekdayInZone(start, timeZone))}`;
    case 'biweekly':
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byDayCode(weekdayInZone(start, timeZone))}`;
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'yearly':
      return 'FREQ=YEARLY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  }
}

/**
 * 既存イベントの RRULE から、対応する繰り返し選択肢を推定する。
 * `COUNT` / `UNTIL` などの付加パラメータは無視して大まかな種類のみ判定する
 * （このデモの作成 UI が生成する RRULE の逆変換ができれば十分なため）。
 */
function recurrenceOptionForRRule(rrule: string | undefined): RecurrenceOption {
  if (rrule === undefined) {
    return 'none';
  }
  const normalized = rrule.replace(/^RRULE:/i, '').toUpperCase();
  if (normalized.includes('BYDAY=MO,TU,WE,TH,FR')) {
    return 'weekdays';
  }
  if (normalized.startsWith('FREQ=WEEKLY') && normalized.includes('INTERVAL=2')) {
    return 'biweekly';
  }
  if (normalized.startsWith('FREQ=WEEKLY')) {
    return 'weekly';
  }
  if (normalized.startsWith('FREQ=DAILY')) {
    return 'daily';
  }
  if (normalized.startsWith('FREQ=MONTHLY')) {
    return 'monthly';
  }
  if (normalized.startsWith('FREQ=YEARLY')) {
    return 'yearly';
  }
  return 'none';
}

/** 文字列が {@link RecurrenceOption} の値かどうかを判定する（`<select>` の値検証用）。 */
function isRecurrenceOption(value: string): value is RecurrenceOption {
  return RECURRENCE_OPTIONS.some((option) => option.value === value);
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
      recurrence: 'none',
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
    recurrence: recurrenceOptionForRRule(event.rrule),
  };
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
  const { mode, timeZone, api, resolveRecurringScope, onClose } = props;
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
    setError(null);

    const rrule = rruleForRecurrence(form.recurrence, form.start, timeZone);
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
      api.createEvent(input);
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

        <div className="demo-form-field">
          <label htmlFor={`${baseId}-recurrence`}>繰り返し</label>
          <select
            id={`${baseId}-recurrence`}
            disabled={isReadOnly}
            value={form.recurrence}
            onChange={(changeEvent) => {
              const raw = changeEvent.target.value;
              if (isRecurrenceOption(raw)) {
                patchForm({ recurrence: raw });
              }
            }}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {occurrence?.isRecurring && (
            <p className="demo-field-hint">
              繰り返しの種類の変更は「すべての予定」を選んだ場合のみ反映されます。
            </p>
          )}
        </div>

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
              <button type="submit" className="demo-button demo-button-primary">
                保存
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
