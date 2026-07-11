/**
 * @packageDocumentation
 * `UndoPattern` — 「Undo つきエディタ」パターン。
 *
 * `updateEvent` / `deleteEvent`（`CalendarApi` 直接呼び出し・ドラッグ操作の両方）が
 * 返す `readonly EventChangeEntry[]` を積み上げて undo スタックを作り、「元に戻す」
 * 操作でまとめて逆適用する実用例。繰り返し予定のスコープ操作（オーバーライド生成・
 * シリーズ分割）のように 1 回の操作で複数イベントが作成・変更・削除される複合変更も、
 * `changes` をそのエントリ単位で逆再生することで 1 回の undo でまとめて元に戻る。
 *
 * - ドラッグ移動・リサイズ（`onEventChange`）・キーボード削除（`onEventDelete`）の
 *   `changes` を undo スタックに積む
 * - カレンダー本体上のクリック・範囲選択は、`EventDialog` を使わない自前の最小限の
 *   編集パネル（`EventEditorPanel`、本ファイル内）に委譲する。保存・削除は
 *   `api.updateEvent` / `api.deleteEvent` を直接呼び、戻り値の `changes` を積む。
 *   新規作成は `api.createEvent` の戻り値（単体の `CalendarEvent`）を
 *   `{ after: created }` という 1 件の `EventChangeEntry` に見立てて積む
 *   （before を持たないため、undo は該当イベントの削除になる）
 * - 「元に戻す」ボタンと Ctrl/Cmd+Z の両方で undo できる。undo すると、直前の
 *   エントリの `changes` を逆再生し（`after` を持つイベントを削除 → `before` を
 *   持つイベントをその内容で書き戻す）、結果をトーストで通知する
 * - undo スタックは最大 {@link MAX_UNDO_ENTRIES} 件。redo（やり直し）は本デモの
 *   スコープ外（実装しない）
 *
 * @remarks
 * undo の逆適用は「before の完全なイベントオブジェクトで書き戻す」方式を採る
 * （部分パッチではなく `api.setEvents` によるフル置換）。これにより、繰り返し
 * マスターの `exdates` が「もともと未設定（undefined）」だったのか「空配列
 * （`[]`）」だったのかの区別も含め、変更前の内容を過不足なく復元できる。仮に
 * ここを `updateEvent(id, patch)` のような部分パッチで組もうとすると、
 * 「`before` に無いフィールドは patch でキー省略 → 変更なし扱い」という
 * `applyPatch` の規則（`docs/api.md#パッチ規則applypatch`）により、`after` 側で
 * 追加された `exdates` のようなフィールドが消し忘れられる恐れがある
 * （`{ exdates: undefined }` のように明示的にキーを含めない限り削除されない）。
 * フル置換方式はこの落とし穴を構造的に回避する。
 */

import type {
  CalendarApi,
  CalendarEvent,
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

/** undo スタックの最大保持件数。これを超えると最も古いエントリから捨てられる。 */
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
 * undo スタックの 1 エントリ。1 回の操作（繰り返しのスコープ操作による複合変更を
 * 含む）をまとめて表す。
 */
interface UndoEntry {
  /** React の `key` 用の一意な ID。 */
  id: string;
  /** 「元に戻す」実行時のトースト・履歴一覧で共通して使う、操作の短い名詞句（例:「会議 の移動」）。 */
  actionLabel: string;
  /** 履歴一覧に表示する説明文（過去形。例:「会議 を移動しました」）。 */
  description: string;
  /**
   * この操作で影響を受けた各イベントの before/after 一覧。
   * `api.updateEvent` / `api.deleteEvent` の戻り値、または `onEventChange` /
   * `onEventDelete` の `changes`、あるいは `api.createEvent` の戻り値を
   * `{ after: created }` の 1 件に見立てたもの。
   */
  changes: readonly EventChangeEntry[];
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
 * `changes`（1 回の操作で影響を受けた各イベントの before/after 一覧）を、現在の
 * イベント一覧に対して逆再生し、操作前の状態に戻したイベント一覧を返す。
 *
 * `after` を持つエントリ（新規作成・変更後）はいったんすべて取り除き、その後
 * `before` を持つエントリ（変更前・削除される前）をその内容のまま書き戻す。
 * 部分パッチではなく完全なイベントオブジェクトによる置換のため、`exdates` の
 * 有無（undefined か空配列か）を含め、フィールドの過不足なく元の内容が復元される。
 *
 * @param currentEvents - 現在のイベント一覧（`api.getEvents()`）
 * @param changes - 逆再生する変更エントリ一覧
 * @returns 逆再生後のイベント一覧（`api.setEvents` にそのまま渡せる）
 */
function revertChanges(
  currentEvents: readonly CalendarEvent[],
  changes: readonly EventChangeEntry[],
): CalendarEvent[] {
  const byId = new Map(currentEvents.map((event) => [event.id, event]));
  for (const change of changes) {
    if (change.after !== undefined) {
      byId.delete(change.after.id);
    }
  }
  for (const change of changes) {
    if (change.before !== undefined) {
      byId.set(change.before.id, change.before);
    }
  }
  return [...byId.values()];
}

/**
 * undo 実行時のトースト文言を組み立てる。
 *
 * 影響件数（`entry.changes.length`）を添えるが、そのエントリが「新規作成のみ」
 * （すべてのエントリが `before` を持たない）の場合は「取り消し」、それ以外
 * （変更・削除を含む）の場合は「復元」という言葉を使う。
 */
function buildUndoToastText(entry: UndoEntry): string {
  const isCreationOnly = entry.changes.every((change) => change.before === undefined);
  const countLabel = isCreationOnly
    ? `${entry.changes.length}件取消`
    : `${entry.changes.length}件復元`;
  return `${entry.actionLabel}を元に戻しました（${countLabel}）`;
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
 * の両方から発生する変更を、共通の undo スタックへ積む。「元に戻す」ボタンまたは
 * Ctrl/Cmd+Z で、直前の操作の `changes` をまとめて逆再生する。
 */
export function UndoPattern(): ReactElement {
  const calendar = useCalendar({
    initialView: 'week',
    locale: 'ja',
    events: sampleEvents,
    timeZone: 'Asia/Tokyo',
  });
  const { api, state } = calendar;

  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest | null>(null);
  const [undoStack, setUndoStack] = useState<readonly UndoEntry[]>([]);
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

  /** undo スタックに 1 エントリを積む（`changes` が空なら何もしない）。 */
  const pushUndo = useCallback(
    (actionLabel: string, description: string, changes: readonly EventChangeEntry[]) => {
      if (changes.length === 0) {
        return;
      }
      setUndoStack((prev) =>
        [{ id: crypto.randomUUID(), actionLabel, description, changes }, ...prev].slice(
          0,
          MAX_UNDO_ENTRIES,
        ),
      );
    },
    [],
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
   * 「元に戻す」を実行する。undo スタックの先頭（直近の操作）を取り出し、
   * その `changes` を現在のイベント一覧に逆再生して `api.setEvents` で反映する。
   * `setEvents` は `onEventsChange` を呼ばない（エコー防止。docs/events.md 参照）ため、
   * この復元自体が新たな変更として記録されることはない。
   */
  const handleUndo = useCallback(() => {
    const latest = undoStack[0];
    if (latest === undefined) {
      return;
    }
    const reverted = revertChanges(api.getEvents(), latest.changes);
    api.setEvents(reverted);
    setUndoStack((prev) => prev.slice(1));
    showToast(buildUndoToastText(latest));
  }, [api, undoStack, showToast]);

  // Ctrl/Cmd+Z で「元に戻す」を実行する（redo は本デモのスコープ外のため実装しない）。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isUndoCombo =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
      if (!isUndoCombo) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          // フォーム入力中はブラウザ標準の undo に譲る
          return;
        }
      }
      event.preventDefault();
      handleUndo();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo]);

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
            disabled={undoStack.length === 0}
            onClick={handleUndo}
          >
            ↶ 元に戻す{undoStack.length > 0 ? `（あと${undoStack.length}件）` : ''}
          </button>
          <span className="undo-shortcut-hint">Ctrl/Cmd+Z でも元に戻せます</span>
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
        {undoStack.length === 0 ? (
          <p className="demo-log-empty">
            まだ操作はありません。予定をドラッグして移動・リサイズしたり、空き領域を
            クリック/ドラッグして作成、予定をクリックして編集・削除してみてください。
          </p>
        ) : (
          <ul className="demo-log-list">
            {undoStack.map((entry) => (
              <li key={entry.id}>
                {entry.description}
                <span className="undo-history-count">（{entry.changes.length}件の変更）</span>
              </li>
            ))}
          </ul>
        )}
        <p className="demo-log-hint">
          矢印キーで移動（Shift+矢印でリサイズ、Delete で削除）。繰り返し予定の
          シリーズ分割など複合的な変更も、1 回の「元に戻す」でまとめて復元されます。
          redo（やり直し）は本デモのスコープ外です。undo スタックは最大 {MAX_UNDO_ENTRIES}{' '}
          件保持します。
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
