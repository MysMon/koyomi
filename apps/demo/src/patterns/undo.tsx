/**
 * @packageDocumentation
 * `UndoPattern` — 「Undo つきエディタ」パターン。
 *
 * `useCalendarHistory`（`createEventHistory` の React 接続）に undo/redo 本体を
 * 委ね、ライブラリの履歴マネージャが `EventChangeEntry` の適用・逆適用を行う。
 * 繰り返し予定のスコープ操作（オーバーライド生成・シリーズ分割）のように
 * 1 回の操作で複数イベントが作成・変更・削除される複合変更も、`changes` を
 * そのエントリ単位で扱うため 1 回の undo/redo でまとめて反映される。
 *
 * - ドラッグ移動・リサイズ（`onEventChange`）・キーボード削除（`onEventDelete`）の
 *   `changes` を `history.push` に積む
 * - カレンダー本体上のクリック・範囲選択は、`EventDialog` を使わない自前の最小限の
 *   編集パネル（`EventEditorPanel`、本ファイル内）に委譲する。保存・削除は
 *   `api.updateEvent` / `api.deleteEvent` を直接呼び、戻り値の `changes` を積む。
 *   新規作成は `api.createEvent` の戻り値（単体の `CalendarEvent`）を
 *   `{ after: created }` という 1 件の `EventChangeEntry` に見立てて積む
 *   （before を持たないため、undo は該当イベントの削除になる）
 * - `useCalendarHistory` は `actionLabel` / `description` のような付随メタデータを
 *   持たないため、`history.push` と同じ呼び出しタイミングで自前の
 *   `undoDescriptions` / `redoDescriptions` スタックを LIFO で並行管理し、
 *   `history.undo()` / `history.redo()` の戻り値（適用できたかどうか）と
 *   連動してポップ/プッシュする。「元に戻す」「やり直す」ボタンの押下時のみ
 *   この並行管理が働く（`keyboardShortcuts: true` によるキーボード操作は
 *   ライブラリ内部で直接 `undo`/`redo` を実行するため、トースト・履歴一覧には
 *   反映されない。カレンダー自体の状態は両方の経路で正しく更新される）
 * - undo/redo スタックは最大 {@link MAX_UNDO_ENTRIES} 件
 */

import type {
  CalendarApi,
  CalendarInteractionCallbacks,
  EventChange,
  EventChangeEntry,
  EventDelete,
  EventOccurrence,
  RangeSelection,
  RecurringEditScope,
  TimeZoneId,
} from '@koyomi-cal/react';
import {
  addDaysInZone,
  CalendarProvider,
  CalendarView,
  dateFromKey,
  dateKeyInZone,
  getWallClock,
  parseDateValue,
  Toolbar,
  useCalendar,
  useCalendarHistory,
} from '@koyomi-cal/react';
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { sampleEvents } from '../sample-data';
import './undo.css';

/** undo/redo スタックの最大保持件数。これを超えると最も古いエントリから捨てられる。 */
const MAX_UNDO_ENTRIES = 20;

/** トーストの自動消去までの時間（ミリ秒）。 */
const TOAST_DURATION_MS = 4000;

/**
 * 編集パネル（{@link EventEditorPanel}）・`resolveRecurringScope` が共有する、
 * 繰り返し予定への操作の種類。`CalendarInteractionCallbacks.resolveRecurringScope`
 * の `action` 引数の型（`'move' | 'resize' | 'delete' | 'update'`）と同じもの。
 */
type ScopeAction = 'move' | 'resize' | 'delete' | 'update';

/** 編集パネルの表示モード。 */
type EditorMode =
  | { type: 'create'; selection: RangeSelection }
  | { type: 'edit'; occurrence: EventOccurrence };

/** 編集パネルのフォーム状態。日時は文字列ではなく絶対時刻（`Date`）で保持する。 */
interface EditorFormState {
  title: string;
  allDay: boolean;
  start: Date;
  end: Date;
}

/** 繰り返し予定の適用範囲を尋ねる要求。 */
interface ScopeRequest {
  occurrence: EventOccurrence;
  action: ScopeAction;
}

/** トースト 1 件分の表示内容。 */
interface ToastMessage {
  id: string;
  text: string;
}

/**
 * `history.push` と並行管理する、undo/redo スタックの 1 エントリのメタデータ。
 * 1 回の操作（繰り返しのスコープ操作による複合変更を含む）をまとめて表す。
 *
 * `useCalendarHistory` 自身はこのようなメタデータを持たない（`changes` の
 * before/after のみを扱う）ため、トースト・履歴一覧の表示専用にデモ側で
 * 保持する。
 */
interface UndoDescription {
  /** React の `key` 用の一意な ID。 */
  id: string;
  /** 「元に戻す」「やり直す」実行時のトースト・履歴一覧で共通して使う、操作の短い名詞句（例:「会議 の移動」）。 */
  actionLabel: string;
  /** 履歴一覧に表示する説明文（過去形。例:「会議 を移動しました」）。 */
  description: string;
  /** この操作で影響を受けたイベントの件数（`changes.length`）。 */
  changeCount: number;
  /** すべてのエントリが `before` を持たない（新規作成のみ）操作かどうか。 */
  isCreationOnly: boolean;
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

/** モードに応じた編集パネルの初期フォーム状態を組み立てる。 */
function buildEditorForm(mode: EditorMode): EditorFormState {
  if (mode.type === 'create') {
    const { range, allDay } = mode.selection;
    return { title: '', allDay, start: range.start, end: range.end };
  }
  const { event, start, end, allDay } = mode.occurrence;
  return { title: event.title, allDay, start, end };
}

/** 繰り返し予定への操作の種類を日本語の動詞に変換する（スコープ選択パネルの見出し用）。 */
function scopeActionVerb(action: ScopeAction): string {
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

/** 適用されたスコープを、履歴・トースト文言に添える日本語の補足に変換する。 */
function scopeSuffix(scope: RecurringEditScope): string {
  switch (scope) {
    case 'this':
      return '（この予定のみ）';
    case 'thisAndFollowing':
      return '（これ以降のすべての予定・シリーズ分割）';
    case 'all':
      return '（すべての予定）';
  }
}

/**
 * ドラッグによる変更（{@link EventChange}）の内容を、表示用の短い日本語の動詞句に
 * 変換する（移動・リサイズ・終日変換・リソース間移動の判別）。
 *
 * @remarks
 * これは履歴・トーストの表示専用のヒューリスティックであり、undo 自体の正しさは
 * `change.changes`（before/after のスナップショット）にのみ依存する。この関数の
 * 判定を誤っても undo の動作自体には影響しない。
 */
function describeDragChange(change: EventChange): string {
  const { occurrence, newRange, allDay } = change;
  if (occurrence.allDay !== allDay) {
    return allDay ? '終日への変換' : '時間指定への変換';
  }
  const startChanged = occurrence.start.getTime() !== newRange.start.getTime();
  const endChanged = occurrence.end.getTime() !== newRange.end.getTime();
  const resourceChanged =
    'resourceId' in change && change.resourceId !== occurrence.event.resourceId;
  if (startChanged && endChanged) {
    return resourceChanged ? '別リソースへの移動' : '移動';
  }
  if (startChanged || endChanged) {
    return 'リサイズ';
  }
  if (resourceChanged) {
    return '別リソースへの移動';
  }
  return '変更';
}

/**
 * undo/redo 実行時のトースト文言を組み立てる。
 *
 * 影響件数（`entry.changeCount`）を添えるが、そのエントリが「新規作成のみ」
 * （`entry.isCreationOnly`）の場合は undo で「取消」・redo で「再作成」、
 * それ以外（変更・削除を含む）の場合は undo で「復元」・redo で「再適用」
 * という言葉を使う。
 */
function buildUndoToastText(entry: UndoDescription, direction: 'undo' | 'redo'): string {
  const countLabel =
    direction === 'undo'
      ? entry.isCreationOnly
        ? `${entry.changeCount}件取消`
        : `${entry.changeCount}件復元`
      : entry.isCreationOnly
        ? `${entry.changeCount}件再作成`
        : `${entry.changeCount}件再適用`;
  const verb = direction === 'undo' ? '元に戻しました' : 'やり直しました';
  return `${entry.actionLabel}を${verb}（${countLabel}）`;
}

/**
 * 繰り返し予定の適用範囲（この予定のみ / これ以降のすべての予定 / すべての予定）を
 * 選択させる最小限のオーバーレイパネル。`ScopeDialog`（パターン 1）とは独立に、
 * このパターン専用に自前で実装する。
 */
function ScopePrompt(props: {
  request: ScopeRequest | null;
  onChoose: (scope: RecurringEditScope | null) => void;
}): ReactElement | null {
  const { request, onChoose } = props;

  useEffect(() => {
    if (request === null) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onChoose(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [request, onChoose]);

  if (request === null) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背景クリックによるキャンセルは Escape キーでも同等に行える
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className="undo-scope-overlay"
      onClick={(event) => {
        // 背景（オーバーレイ自身）を直接クリックした場合のみキャンセル扱いにする
        // （パネル内クリックがバブリングして誤ってキャンセルされるのを防ぐ）
        if (event.target === event.currentTarget) {
          onChoose(null);
        }
      }}
    >
      <div
        className="demo-dialog undo-scope-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="undo-scope-title"
      >
        <h2 id="undo-scope-title" className="demo-dialog-title">
          繰り返し予定の{scopeActionVerb(request.action)}
        </h2>
        <p className="demo-scope-description">
          「{request.occurrence.event.title}」は繰り返し予定です。どの範囲に適用しますか？
        </p>
        <div className="demo-scope-options">
          <button type="button" className="demo-button" onClick={() => onChoose('this')}>
            この予定のみ
          </button>
          <button
            type="button"
            className="demo-button"
            onClick={() => onChoose('thisAndFollowing')}
          >
            これ以降のすべての予定
          </button>
          <button type="button" className="demo-button" onClick={() => onChoose('all')}>
            すべての予定
          </button>
        </div>
        <div className="demo-dialog-actions">
          <button
            type="button"
            className="demo-button demo-button-text"
            onClick={() => onChoose(null)}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

/** {@link EventEditorPanel} の props。 */
interface EventEditorPanelProps {
  /** 表示するモード。`null` なら非表示。 */
  mode: EditorMode | null;
  /** 現在の表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** カレンダーエンジンの API。保存・削除の実行に使う。 */
  api: CalendarApi;
  /** 繰り返し予定の適用範囲を尋ねる（`CalendarInteractionCallbacks.resolveRecurringScope` と共用）。 */
  resolveRecurringScope: (
    occurrence: EventOccurrence,
    action: ScopeAction,
  ) => Promise<RecurringEditScope | null>;
  /** パネルを閉じるべきときに呼ばれる。 */
  onClose: () => void;
  /** 保存・削除・作成が確定したときに呼ばれる（undo スタックへの記録用）。 */
  onRecorded: (entry: {
    actionLabel: string;
    description: string;
    changes: readonly EventChangeEntry[];
  }) => void;
}

/**
 * `EventDialog` を使わない、このパターン専用の最小限の予定編集パネル。
 *
 * タイトル・開始・終了だけを扱う（色・場所・説明・繰り返しルールの編集は
 * 提供しない。繰り返し予定自体はサンプルデータ側で用意する）。
 *
 * - 新規作成: 保存で `api.createEvent`。戻り値（作成された `CalendarEvent`）を
 *   `{ after: created }` の 1 件として `onRecorded` に渡す
 * - 単発予定の編集・削除: `api.updateEvent` / `api.deleteEvent` の戻り値
 *   （`changes`）をそのまま `onRecorded` に渡す
 * - 繰り返しオカレンスの編集・削除: 保存・削除の前に `resolveRecurringScope` で
 *   適用範囲を確認する（キャンセルなら何もしない）
 * - `editable: false` の予定は読み取り専用として表示する
 */
function EventEditorPanel(props: EventEditorPanelProps): ReactElement | null {
  const { mode, timeZone, api, resolveRecurringScope, onClose, onRecorded } = props;
  const baseId = useId();
  const [form, setForm] = useState<EditorFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // mode が新しく設定されるたびにフォームを初期化する
  useEffect(() => {
    if (mode !== null) {
      setForm(buildEditorForm(mode));
      setError(null);
    }
  }, [mode]);

  // Escape キーで閉じる（native <dialog> を使わないため自前で処理する）
  useEffect(() => {
    if (mode === null) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, onClose]);

  if (mode === null || form === null) {
    return null;
  }

  const occurrence = mode.type === 'edit' ? mode.occurrence : null;
  const isReadOnly = occurrence !== null && occurrence.event.editable === false;

  /** フォーム状態を部分更新する。 */
  const patchForm = (patch: Partial<EditorFormState>): void => {
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }));
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

    // CalendarEventPatch は Partial のため型注釈すると全フィールドが optional になり、
    // CalendarEventInput の必須フィールド（title / start）を満たせなくなる。
    // ここでは注釈せずリテラル型（全フィールド確定値）のまま推論させる
    // （EventDialog と同じ理由。docs/events.md のパッチ規則を参照）。
    const commonFields = {
      title: form.title,
      start: form.start,
      end: form.end,
      allDay: form.allDay,
    };

    if (mode.type === 'create') {
      const created = api.createEvent(commonFields);
      onRecorded({
        actionLabel: `${created.title} の作成`,
        description: `${created.title} を作成しました`,
        changes: [{ after: created }],
      });
      onClose();
      return;
    }

    const target = mode.occurrence;
    const title = target.event.title;

    if (!target.isRecurring) {
      const changes = api.updateEvent(target.eventId, commonFields);
      onRecorded({
        actionLabel: `${title} の更新`,
        description: `${title} を更新しました`,
        changes,
      });
      onClose();
      return;
    }

    const scope = await resolveRecurringScope(target, 'update');
    if (scope === null) {
      // キャンセル: 何もしない（パネルは開いたまま）
      return;
    }
    const changes = api.updateEvent(target.eventId, commonFields, {
      occurrenceStart: target.originalStart,
      scope,
    });
    onRecorded({
      actionLabel: `${title} の更新${scopeSuffix(scope)}`,
      description: `${title} を更新しました${scopeSuffix(scope)}`,
      changes,
    });
    onClose();
  };

  /** 削除。 */
  const handleDelete = async (): Promise<void> => {
    if (mode.type !== 'edit' || isReadOnly) {
      return;
    }
    const target = mode.occurrence;
    const title = target.event.title;

    if (!target.isRecurring) {
      const changes = api.deleteEvent(target.eventId);
      onRecorded({
        actionLabel: `${title} の削除`,
        description: `${title} を削除しました`,
        changes,
      });
      onClose();
      return;
    }

    const scope = await resolveRecurringScope(target, 'delete');
    if (scope === null) {
      // キャンセル: 何もしない（パネルは開いたまま）
      return;
    }
    const changes = api.deleteEvent(target.eventId, {
      occurrenceStart: target.originalStart,
      scope,
    });
    onRecorded({
      actionLabel: `${title} の削除${scopeSuffix(scope)}`,
      description: `${title} を削除しました${scopeSuffix(scope)}`,
      changes,
    });
    onClose();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背景クリックによるキャンセルは Escape キーでも同等に行える
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className="undo-editor-overlay"
      onClick={(event) => {
        // 背景（オーバーレイ自身）を直接クリックした場合のみ閉じる
        // （パネル内クリックがバブリングして誤って閉じるのを防ぐ）
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="demo-dialog undo-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title-heading`}
      >
        <form
          className="demo-form"
          onSubmit={(formEvent) => {
            void handleSubmit(formEvent);
          }}
        >
          <h2 id={`${baseId}-title-heading`} className="demo-dialog-title">
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

          {occurrence?.isRecurring && (
            <p className="demo-field-hint">
              この予定は繰り返し予定です。保存・削除の直前に適用範囲（この予定のみ / これ以降 /
              すべて）を確認します。
            </p>
          )}

          {error !== null && <p className="demo-error">{error}</p>}

          <div className="demo-dialog-actions">
            {isReadOnly ? (
              <button type="button" className="demo-button" onClick={onClose}>
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
                <button type="button" className="demo-button demo-button-text" onClick={onClose}>
                  キャンセル
                </button>
                <button type="submit" className="demo-button demo-button-primary">
                  保存
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * 「Undo つきエディタ」パターンのルートコンポーネント。
 *
 * カレンダー本体（ドラッグ移動・リサイズ・キーボード削除）と自前の最小編集パネル
 * の両方から発生する変更を、共通の `useCalendarHistory` へ積む。「元に戻す」
 * 「やり直す」ボタン、または `keyboardShortcuts: true` によるキーボード操作
 * （Ctrl/Cmd+Z・Ctrl/Cmd+Shift+Z・Ctrl/Cmd+Y）で undo/redo できる。
 */
export function UndoPattern(): ReactElement {
  const calendar = useCalendar({
    initialView: 'week',
    locale: 'ja',
    events: sampleEvents,
    timeZone: 'Asia/Tokyo',
  });
  const { api, state } = calendar;
  const history = useCalendarHistory({
    calendar,
    limit: MAX_UNDO_ENTRIES,
    keyboardShortcuts: true,
  });

  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest | null>(null);
  // history.push と同じ呼び出しタイミングで並行管理する、表示専用のメタデータスタック。
  const [undoDescriptions, setUndoDescriptions] = useState<readonly UndoDescription[]>([]);
  const [redoDescriptions, setRedoDescriptions] = useState<readonly UndoDescription[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const scopeResolverRef = useRef<((scope: RecurringEditScope | null) => void) | null>(null);

  /** トーストを表示する（{@link TOAST_DURATION_MS} 後に自動で消える）。 */
  const showToast = useCallback((text: string) => {
    setToast({ id: crypto.randomUUID(), text });
  }, []);

  useEffect(() => {
    if (toast === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /**
   * `history.push` に 1 操作分の変更を積み、同じタイミングで `undoDescriptions` にも
   * 表示用メタデータを積む（`changes` が空なら両方とも何もしない）。新しい操作を
   * 積むと redo 履歴は無効になる（`createEventHistory.push` と同じ規約）ため
   * `redoDescriptions` も空にする。
   */
  const pushUndo = useCallback(
    (actionLabel: string, description: string, changes: readonly EventChangeEntry[]) => {
      if (changes.length === 0) {
        return;
      }
      history.push(changes);
      const isCreationOnly = changes.every((change) => change.before === undefined);
      setUndoDescriptions((prev) => [
        {
          id: crypto.randomUUID(),
          actionLabel,
          description,
          changeCount: changes.length,
          isCreationOnly,
        },
        ...prev,
      ]);
      setRedoDescriptions([]);
    },
    [history],
  );

  /**
   * 繰り返し予定の適用範囲をパネルで選択させる。
   * `CalendarProvider` の `callbacks` と `EventEditorPanel` の両方から共用する。
   */
  const resolveRecurringScope = useCallback(
    (occurrence: EventOccurrence, action: ScopeAction): Promise<RecurringEditScope | null> => {
      return new Promise((resolve) => {
        scopeResolverRef.current = resolve;
        setScopeRequest({ occurrence, action });
      });
    },
    [],
  );

  /** `ScopePrompt` からの選択結果を、待機中の Promise に伝える。 */
  function handleScopeChoice(scope: RecurringEditScope | null): void {
    const resolve = scopeResolverRef.current;
    scopeResolverRef.current = null;
    setScopeRequest(null);
    resolve?.(scope);
  }

  /** ドラッグ移動・リサイズ（矢印キーでの移動・リサイズを含む）が確定したときに undo スタックへ積む。 */
  const handleEventChange = useCallback(
    (change: EventChange) => {
      const title = change.occurrence.event.title;
      const verb = describeDragChange(change);
      const suffix = change.scope !== null ? scopeSuffix(change.scope) : '';
      pushUndo(`${title} の${verb}`, `${title} を${verb}しました${suffix}`, change.changes);
    },
    [pushUndo],
  );

  /** キーボード削除（Delete/Backspace）が確定したときに undo スタックへ積む。 */
  const handleEventDelete = useCallback(
    (deletion: EventDelete) => {
      const title = deletion.occurrence.event.title;
      const suffix = deletion.scope !== null ? scopeSuffix(deletion.scope) : '';
      pushUndo(`${title} の削除`, `${title} を削除しました${suffix}`, deletion.changes);
    },
    [pushUndo],
  );

  /** インタラクション中の想定外エラーをトーストで通知する。 */
  const handleError = useCallback(
    (error: unknown) => {
      showToast(`エラーが発生しました: ${String(error)}`);
    },
    [showToast],
  );

  /** 編集パネル（作成・更新・削除）からの確定を undo スタックへ積む。 */
  const handleRecorded = useCallback(
    (entry: { actionLabel: string; description: string; changes: readonly EventChangeEntry[] }) => {
      pushUndo(entry.actionLabel, entry.description, entry.changes);
    },
    [pushUndo],
  );

  /**
   * 「元に戻す」を実行する。`history.undo()` に実際の適用（`api.setEvents` 経由の
   * 逆適用）を委ね、戻り値（適用できたかどうか）を見て `undoDescriptions` の先頭を
   * `redoDescriptions` へ移す。
   */
  const handleUndo = useCallback(() => {
    const latest = undoDescriptions[0];
    const applied = history.undo();
    if (!applied || latest === undefined) {
      return;
    }
    setUndoDescriptions((prev) => prev.slice(1));
    setRedoDescriptions((prev) => [latest, ...prev]);
    showToast(buildUndoToastText(latest, 'undo'));
  }, [history, undoDescriptions, showToast]);

  /**
   * 「やり直す」を実行する。`history.redo()` に実際の適用を委ね、戻り値を見て
   * `redoDescriptions` の先頭を `undoDescriptions` へ戻す。
   */
  const handleRedo = useCallback(() => {
    const latest = redoDescriptions[0];
    const applied = history.redo();
    if (!applied || latest === undefined) {
      return;
    }
    setRedoDescriptions((prev) => prev.slice(1));
    setUndoDescriptions((prev) => [latest, ...prev]);
    showToast(buildUndoToastText(latest, 'redo'));
  }, [history, redoDescriptions, showToast]);

  const callbacks: CalendarInteractionCallbacks = useMemo(
    () => ({
      onSelectRange: (selection: RangeSelection) => {
        setEditorMode({ type: 'create', selection });
      },
      onEventClick: (occurrence: EventOccurrence) => {
        setEditorMode({ type: 'edit', occurrence });
      },
      resolveRecurringScope,
      onEventChange: handleEventChange,
      onEventDelete: handleEventDelete,
      onError: handleError,
    }),
    [resolveRecurringScope, handleEventChange, handleEventDelete, handleError],
  );

  return (
    <div className="demo-app demo-undo-pattern">
      <header className="demo-header">
        <h2 className="demo-title">Undo つきエディタ</h2>
        <div className="undo-toolbar-actions">
          <button
            type="button"
            className="demo-button"
            disabled={!history.canUndo}
            onClick={handleUndo}
          >
            ↶ 元に戻す{undoDescriptions.length > 0 ? `（あと${undoDescriptions.length}件）` : ''}
          </button>
          <button
            type="button"
            className="demo-button"
            disabled={!history.canRedo}
            onClick={handleRedo}
          >
            ↷ やり直す{redoDescriptions.length > 0 ? `（あと${redoDescriptions.length}件）` : ''}
          </button>
          <span className="undo-shortcut-hint">
            Ctrl/Cmd+Z で元に戻す、Ctrl/Cmd+Shift+Z・Ctrl/Cmd+Y でやり直せます
          </span>
        </div>
      </header>

      <main className="demo-main">
        <CalendarProvider value={calendar} callbacks={callbacks}>
          <Toolbar />
          <CalendarView />
        </CalendarProvider>
      </main>

      <section className="demo-log" aria-live="polite">
        <h2 className="demo-log-title">直近の操作履歴</h2>
        {undoDescriptions.length === 0 ? (
          <p className="demo-log-empty">
            まだ操作はありません。予定をドラッグして移動・リサイズしたり、空き領域を
            クリック/ドラッグして作成、予定をクリックして編集・削除してみてください。
          </p>
        ) : (
          <ul className="demo-log-list">
            {undoDescriptions.map((entry) => (
              <li key={entry.id}>
                {entry.description}
                <span className="undo-history-count">（{entry.changeCount}件の変更）</span>
              </li>
            ))}
          </ul>
        )}
        <p className="demo-log-hint">
          矢印キーで移動（Shift+矢印でリサイズ、Delete で削除）。繰り返し予定の
          シリーズ分割など複合的な変更も、1 回の「元に戻す」「やり直す」でまとめて
          反映されます。undo/redo スタックは最大 {MAX_UNDO_ENTRIES} 件保持します。
          キーボード操作によるやり直し・元に戻すはカレンダーの状態には正しく反映されますが、
          この履歴表示・トーストはボタン操作時のみ更新されます。
        </p>
      </section>

      <EventEditorPanel
        mode={editorMode}
        timeZone={state.timeZone}
        api={api}
        resolveRecurringScope={resolveRecurringScope}
        onClose={() => setEditorMode(null)}
        onRecorded={handleRecorded}
      />
      <ScopePrompt request={scopeRequest} onChoose={handleScopeChoice} />

      {toast !== null && (
        <div className="undo-toast" role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
