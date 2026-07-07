/**
 * @packageDocumentation
 * イベント集合に対する純粋な変更操作。
 *
 * Google カレンダーの編集・削除操作（繰り返しの「この予定のみ /
 * これ以降のすべての予定 / すべての予定」を含む）を、
 * `readonly CalendarEvent[]` を受け取り新しい配列を返す **純粋関数** として提供する。
 * 状態は持たない。エンジン（`createCalendar`）がこれらを呼び出して状態を更新する。
 *
 * ## 繰り返し編集のセマンティクス（Google カレンダー準拠）
 *
 * - **この予定のみ（`this`）** — 対象発生をオーバーライドイベント
 *   （`recurringEventId` + `originalStart` を持つ単発イベント）に切り出して変更する。
 *   既にオーバーライド済みの発生への再変更は、そのオーバーライドに直接適用する。
 * - **これ以降（`thisAndFollowing`）** — 元の繰り返しを対象発生の直前で打ち切り
 *   （UNTIL 設定）、対象発生以降を新しい繰り返しイベントとして分割する。
 *   `COUNT` は消化済み回数を差し引いて引き継ぐ。対象発生以降の
 *   オーバーライド・EXDATE は新イベントに付け替える。
 *   対象が最初の発生の場合は「すべての予定」と同じ扱いになる。
 * - **すべて（`all`）** — 元イベント自体を変更する。既存のオーバーライドは維持される。
 */

import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  EventId,
  RecurringEditScope,
  TimeZoneId,
} from './types';

/**
 * 変更操作の共通コンテキスト。
 */
export interface MutationContext {
  /** 表示タイムゾーン（日時文字列の解釈と発生時刻の計算に使用）。 */
  displayTimeZone: TimeZoneId;
  /** `end` 省略時の既定の長さ（分）。 */
  defaultEventMinutes: number;
  /**
   * 新規イベント ID の生成関数。
   * テストで決定的な ID を使うために注入できる。
   */
  generateId: () => EventId;
}

/**
 * 繰り返しイベントの操作対象を指定する。
 */
export interface RecurringTarget {
  /** 対象発生の開始時刻（オーバーライド済みの場合は現在の開始時刻）。 */
  occurrenceStart: Date;
  /** 適用範囲。 */
  scope: RecurringEditScope;
}

/**
 * イベントを作成した結果。
 */
export interface CreateEventResult {
  /** 作成後のイベント一覧。 */
  events: CalendarEvent[];
  /** 作成されたイベント（`id` 確定済み）。 */
  created: CalendarEvent;
}

/**
 * イベントを追加する。
 *
 * `input.id` が省略された場合は `context.generateId()` で採番する。
 * 既存イベントと同じ ID が指定された場合は例外を投げる。
 *
 * @param events - 現在のイベント一覧
 * @param input - 追加するイベント
 * @param context - 変更コンテキスト
 */
export function createEventIn(
  events: readonly CalendarEvent[],
  input: CalendarEventInput,
  context: MutationContext,
): CreateEventResult {
  void events;
  void input;
  void context;
  throw new Error('未実装');
}

/**
 * イベントを更新する。
 *
 * - 単発イベント、または `target` 省略時 — `patch` をそのまま適用する
 * - 繰り返しイベント + `target` あり — スコープに応じて
 *   オーバーライド作成・シリーズ分割・全体変更を行う（モジュール概要を参照）
 *
 * 対象 ID のイベントが存在しない場合は例外を投げる。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（オーバーライドの ID でもよい。
 *   その場合 `scope: 'this'` はオーバーライド自体を変更し、
 *   `'thisAndFollowing'` / `'all'` は親シリーズに対して適用される）
 * @param patch - 変更内容
 * @param target - 繰り返しの対象発生とスコープ（単発イベントでは省略）
 * @param context - 変更コンテキスト
 * @returns 更新後のイベント一覧
 */
export function updateEventIn(
  events: readonly CalendarEvent[],
  id: EventId,
  patch: CalendarEventPatch,
  target: RecurringTarget | undefined,
  context: MutationContext,
): CalendarEvent[] {
  void events;
  void id;
  void patch;
  void target;
  void context;
  throw new Error('未実装');
}

/**
 * イベントを削除する。
 *
 * - 単発イベント、または `target` 省略時 — イベントを取り除く
 *   （繰り返しイベントで `target` 省略時は繰り返し全体と、
 *   それを参照するオーバーライドをすべて取り除く）
 * - `scope: 'this'` — 対象発生を EXDATE に追加する。対象がオーバーライド
 *   済みの発生の場合はオーバーライドを取り除き、元発生の EXDATE に追加する
 * - `scope: 'thisAndFollowing'` — 対象発生の直前で繰り返しを打ち切り、
 *   対象発生以降のオーバーライド・EXDATE を取り除く。
 *   対象が最初の発生なら繰り返し全体を削除する
 * - `scope: 'all'` — 繰り返し全体と、それを参照するオーバーライドを取り除く
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（オーバーライドの ID でもよい）
 * @param target - 繰り返しの対象発生とスコープ（単発イベントでは省略）
 * @param context - 変更コンテキスト
 * @returns 削除後のイベント一覧
 */
export function deleteEventIn(
  events: readonly CalendarEvent[],
  id: EventId,
  target: RecurringTarget | undefined,
  context: MutationContext,
): CalendarEvent[] {
  void events;
  void id;
  void target;
  void context;
  throw new Error('未実装');
}

/**
 * 発生の移動（ドラッグ＆ドロップ）を適用する。
 *
 * `updateEventIn` の便利ラッパ。発生の新しい開始時刻から `start` / `end` の
 * パッチを構築して適用する。長さは元の発生の長さを維持する。
 * 繰り返しイベントの場合はスコープに従う。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID
 * @param params.occurrenceStart - 対象発生の現在の開始時刻
 * @param params.newStart - 移動先の開始時刻
 * @param params.newEnd - 移動先の終了時刻（リサイズ時に指定。省略時は長さ維持）
 * @param params.allDay - 移動先が終日枠かどうか（時間⇔終日の変換に使用。省略時は変更しない）
 * @param params.scope - 繰り返しの適用範囲（繰り返しイベントの場合は必須）
 * @param context - 変更コンテキスト
 * @returns 移動後のイベント一覧
 */
export function moveOccurrenceIn(
  events: readonly CalendarEvent[],
  id: EventId,
  params: {
    occurrenceStart: Date;
    newStart: Date;
    newEnd?: Date;
    allDay?: boolean;
    scope?: RecurringEditScope;
  },
  context: MutationContext,
): CalendarEvent[] {
  void events;
  void id;
  void params;
  void context;
  throw new Error('未実装');
}
