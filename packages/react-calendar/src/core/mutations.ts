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
 * - **この予定のみ（`this`）** — 対象オカレンスをオーバーライドイベント
 *   （`recurringEventId` + `originalStart` を持つ単発イベント）に切り出して変更する。
 *   既にオーバーライド済みのオカレンスへの再変更は、そのオーバーライドに直接適用する。
 * - **これ以降（`thisAndFollowing`）** — 元の繰り返しを対象オカレンスの直前で打ち切り
 *   （UNTIL 設定）、対象オカレンス以降を新しい繰り返しイベントとして分割する。
 *   `COUNT` は消化済み回数を差し引いて引き継ぐ。対象オカレンス以降の
 *   オーバーライド・EXDATE は新イベントに付け替える。
 *   対象が最初のオカレンスの場合は「すべての予定」と同じ扱いになる。
 * - **すべて（`all`）** — 元イベント自体を変更する。既存のオーバーライドは維持される。
 *
 * ## パッチ適用規則
 *
 * patch にキーが存在し値が `undefined` の場合、そのフィールドを **削除** する
 * （例: `{ rrule: undefined }` で繰り返しを解除する）。キーが存在しなければ
 * 変更しない。この規則は {@link applyPatch} として実装されている。
 */

import { countOccurrencesBefore, normalizeRRuleString, truncateRRule } from './recurrence';
import { parseDateValue } from './timezone';
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
  /** 表示タイムゾーン（日時文字列の解釈とオカレンスの時刻の計算に使用）。 */
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
  /** 対象オカレンスの開始時刻（オーバーライド済みの場合は現在の開始時刻）。 */
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

/** 1 日のミリ秒数（`end` 省略の終日イベントの既定の長さ）。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 1 分のミリ秒数。 */
const MINUTE_MS = 60 * 1000;

/** {@link applyPatch} が削除を許可しない必須フィールド。 */
const REQUIRED_KEYS: ReadonlySet<string> = new Set(['id', 'title', 'start']);

/** RRULE 文字列中の COUNT パラメータ（大文字小文字を区別しない）。 */
const COUNT_PATTERN = /COUNT=(\d+)/i;

/**
 * イベントにパッチを適用した新しいイベントを返す。
 *
 * 適用規則:
 * - patch にキーが存在し値が `undefined` の場合、そのフィールドを **削除** する
 *   （例: `{ rrule: undefined }` で繰り返しを解除できる）
 * - patch にキーが存在しなければ、そのフィールドは変更しない
 * - 必須フィールド（`id` / `title` / `start`）は `undefined` を渡しても削除されず、
 *   元の値を維持する
 *
 * 入力の `event` / `patch` は変更しない（純粋関数）。
 *
 * @param event - 元のイベント
 * @param patch - 変更内容（`undefined` 値のキーは削除指定）
 * @returns パッチ適用後の新しいイベント
 * @example
 * ```ts
 * applyPatch(event, { title: '新タイトル' }); // title のみ変更した複製を返す
 * applyPatch(event, { rrule: undefined }); // rrule フィールドを削除（繰り返し解除）
 * ```
 */
export function applyPatch(event: CalendarEvent, patch: CalendarEventPatch): CalendarEvent {
  // undefined 値のキー（削除指定）と実際の上書き値を先に分離する。
  // CalendarEventPatch は明示的な undefined を許容するため、そのままスプレッドすると
  // exactOptionalPropertyTypes 下で CalendarEvent に代入できない
  const overrides: Partial<CalendarEvent> = {};
  const deletions: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      // 必須フィールド（id / title / start）は削除対象にしない（元の値を維持）
      if (!REQUIRED_KEYS.has(key)) {
        deletions.push(key);
      }
    } else {
      Object.assign(overrides, { [key]: value });
    }
  }
  const merged: CalendarEvent = { ...event, ...overrides, id: event.id };
  for (const key of deletions) {
    // delete 演算子の代わりに Reflect を使い、キャストなしで動的キーを取り除く
    Reflect.deleteProperty(merged, key);
  }
  return merged;
}

/** ID でイベントを探し、見つからなければ例外を投げる。 */
function findEventOrThrow(events: readonly CalendarEvent[], id: EventId): CalendarEvent {
  const found = events.find((event) => event.id === id);
  if (found === undefined) {
    throw new Error(`イベントが見つかりません: '${id}'`);
  }
  return found;
}

/**
 * イベントの日時解釈に使うタイムゾーン。
 *
 * expansion.ts の展開時と同じ「イベント TZ → マスター TZ → 表示 TZ」の順で
 * フォールバックする。オーバーライドイベントが `timeZone` を持たない場合
 * （外部データ同期で timeZone フィールドを省略したケース）でも、マスターと
 * 同じ現地時刻解釈になることを保証する。
 *
 * @param master - オーバーライドの親（マスター）イベント。分かる場合のみ渡す
 */
function resolveTimeZone(
  event: CalendarEvent,
  context: MutationContext,
  master?: CalendarEvent,
): TimeZoneId {
  return event.timeZone ?? master?.timeZone ?? context.displayTimeZone;
}

/** イベントの開始を絶対時刻として解釈する。 */
function parseStart(event: CalendarEvent, context: MutationContext, master?: CalendarEvent): Date {
  return parseDateValue(
    event.start,
    resolveTimeZone(event, context, master),
    event.allDay ?? false,
  );
}

/**
 * オーバーライドの本来の開始（`originalStart`）を絶対時刻として解釈する。
 * `originalStart` を持たない場合は `null` を返す。
 */
function parseOriginalStart(
  event: CalendarEvent,
  context: MutationContext,
  master?: CalendarEvent,
): Date | null {
  if (event.originalStart === undefined) {
    return null;
  }
  return parseDateValue(
    event.originalStart,
    resolveTimeZone(event, context, master),
    event.allDay ?? false,
  );
}

/**
 * オーバーライドが対象とするオカレンスの開始時刻を返す。
 * 通常は `originalStart`、欠落している場合は現在の開始で代用する。
 *
 * @param master - オーバーライドの親イベント。日時文字列の解釈をマスター TZ に
 *   フォールバックさせるために渡す（expansion.ts の解釈と揃える）
 */
function overrideAnchor(
  event: CalendarEvent,
  context: MutationContext,
  master?: CalendarEvent,
): Date {
  return parseOriginalStart(event, context, master) ?? parseStart(event, context, master);
}

/**
 * オカレンス 1 回分の長さ（ミリ秒）を返す。
 *
 * `end` があれば `start` との差分。なければ終日イベントは 1 日、
 * 時間指定イベントは `defaultEventMinutes` 分とみなす。
 */
function occurrenceDurationMs(
  event: CalendarEvent,
  context: MutationContext,
  master?: CalendarEvent,
): number {
  const timeZone = resolveTimeZone(event, context, master);
  const allDay = event.allDay ?? false;
  if (event.end === undefined) {
    return allDay ? DAY_MS : context.defaultEventMinutes * MINUTE_MS;
  }
  const start = parseDateValue(event.start, timeZone, allDay);
  const end = parseDateValue(event.end, timeZone, allDay);
  return end.getTime() - start.getTime();
}

/** `exdates` を差し替えた複製を返す（空配列ならキー自体を持たない）。 */
function withExdates(event: CalendarEvent, exdates: readonly (Date | string)[]): CalendarEvent {
  const { exdates: _dropped, ...rest } = event;
  return exdates.length === 0 ? rest : { ...rest, exdates };
}

/** `rdates` を差し替えた複製を返す（空配列ならキー自体を持たない）。 */
function withRdates(event: CalendarEvent, rdates: readonly (Date | string)[]): CalendarEvent {
  const { rdates: _dropped, ...rest } = event;
  return rdates.length === 0 ? rest : { ...rest, rdates };
}

/** 対象オカレンスの開始を EXDATE の末尾に追加した複製を返す。 */
function appendExdate(event: CalendarEvent, occurrenceStart: Date): CalendarEvent {
  return {
    ...event,
    exdates: [...(event.exdates ?? []), new Date(occurrenceStart.getTime())],
  };
}

/**
 * 指定オカレンスに対応する既存のオーバーライドを探す。
 * `originalStart`（本来の開始）と現在の開始のどちらの一致でも対応付ける。
 */
function findOverrideFor(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  occurrenceStart: Date,
  context: MutationContext,
): CalendarEvent | undefined {
  const time = occurrenceStart.getTime();
  return events.find((event) => {
    if (event.recurringEventId !== master.id) {
      return false;
    }
    const original = parseOriginalStart(event, context, master);
    if (original !== null && original.getTime() === time) {
      return true;
    }
    return parseStart(event, context, master).getTime() === time;
  });
}

/** `id` のイベントに patch を適用した新しい配列を返す。 */
function mapPatch(
  events: readonly CalendarEvent[],
  id: EventId,
  patch: CalendarEventPatch,
): CalendarEvent[] {
  return events.map((event) => (event.id === id ? applyPatch(event, patch) : event));
}

/**
 * 分割後の新シリーズが引き継ぐ RRULE を作る。
 *
 * `COUNT` があれば消化済み回数（分割点より前のオカレンス数）を差し引いた値に置き換え、
 * それ以外（`UNTIL` など）は元の文字列をそのまま返す。
 */
function remainingRRule(
  rrule: string,
  dtstart: Date,
  timeZone: TimeZoneId,
  splitPoint: Date,
): string {
  const match = COUNT_PATTERN.exec(rrule);
  if (match === null || match[1] === undefined) {
    // COUNT なし: UNTIL などの終了条件はそのまま引き継ぐ
    return rrule;
  }
  const consumed = countOccurrencesBefore({ rrule, dtstart, timeZone, before: splitPoint });
  // COUNT は RRULE 内で一意のパラメータなので、文字列置換で安全に更新できる
  return rrule.replace(COUNT_PATTERN, `COUNT=${Number(match[1]) - consumed}`);
}

/**
 * マスターの表示系フィールドを継承したオーバーライドイベントを構築する。
 *
 * `rrule` / `exdates` は継承しない。`start` は `patch.start`（なければオカレンスの開始）、
 * `end` は `patch.end`（なければオカレンスの開始＋マスターのオカレンス 1 回分の長さ）になる。
 */
function buildOverride(
  master: CalendarEvent,
  patch: CalendarEventPatch,
  occurrenceStart: Date,
  context: MutationContext,
): CalendarEvent {
  const base: CalendarEvent = {
    id: context.generateId(),
    title: master.title,
    start: new Date(occurrenceStart.getTime()),
    end: new Date(occurrenceStart.getTime() + occurrenceDurationMs(master, context)),
    recurringEventId: master.id,
    originalStart: new Date(occurrenceStart.getTime()),
  };
  // 表示系フィールドの継承（存在するもののみコピーする）
  if (master.allDay !== undefined) {
    base.allDay = master.allDay;
  }
  if (master.timeZone !== undefined) {
    base.timeZone = master.timeZone;
  }
  if (master.color !== undefined) {
    base.color = master.color;
  }
  if (master.location !== undefined) {
    base.location = master.location;
  }
  if (master.description !== undefined) {
    base.description = master.description;
  }
  if (master.editable !== undefined) {
    base.editable = master.editable;
  }
  if (master.extendedProps !== undefined) {
    base.extendedProps = master.extendedProps;
  }
  return applyPatch(base, patch);
}

/**
 * `scope: 'this'` の更新。既存のオーバーライドがあればそれに直接適用し、
 * なければ新しいオーバーライドを作成して末尾に追加する。マスターは変更しない
 * （展開時に `originalStart` の一致でオカレンスが置き換えられる）。
 */
function updateThisOccurrence(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  patch: CalendarEventPatch,
  occurrenceStart: Date,
  context: MutationContext,
): CalendarEvent[] {
  const existing = findOverrideFor(events, master, occurrenceStart, context);
  if (existing !== undefined) {
    return mapPatch(events, existing.id, patch);
  }
  return [...events, buildOverride(master, patch, occurrenceStart, context)];
}

/**
 * `scope: 'thisAndFollowing'` の更新（シリーズ分割）。
 *
 * - 分割点が最初のオカレンス（dtstart と一致）なら `'all'` と同じ扱い
 * - 旧シリーズは分割点の直前で UNTIL 打ち切り（patch は適用しない）
 * - 新シリーズは分割点から始まり、`COUNT` は残数を引き継ぎ、patch を適用する
 * - 分割点以降（`>=`）の EXDATE・RDATE とオーバーライドは新シリーズに付け替える
 */
function splitSeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  rrule: string,
  patch: CalendarEventPatch,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  const masterStart = parseStart(master, context);
  if (splitPoint.getTime() === masterStart.getTime()) {
    return mapPatch(events, master.id, patch);
  }

  const timeZone = resolveTimeZone(master, context);
  const allDay = master.allDay ?? false;
  const splitTime = splitPoint.getTime();

  // EXDATE を分割点で振り分ける（分割点ちょうどは新シリーズへ）
  const oldExdates: (Date | string)[] = [];
  const movedExdates: (Date | string)[] = [];
  for (const exdate of master.exdates ?? []) {
    const time = parseDateValue(exdate, timeZone, allDay).getTime();
    if (time < splitTime) {
      oldExdates.push(exdate);
    } else {
      movedExdates.push(exdate);
    }
  }

  // RDATE も EXDATE と対称に分割点で振り分ける（分割点ちょうどは新シリーズへ）
  const oldRdates: (Date | string)[] = [];
  const movedRdates: (Date | string)[] = [];
  for (const rdate of master.rdates ?? []) {
    const time = parseDateValue(rdate, timeZone, allDay).getTime();
    if (time < splitTime) {
      oldRdates.push(rdate);
    } else {
      movedRdates.push(rdate);
    }
  }

  // 旧シリーズ: 分割点の直前で打ち切り。patch は適用しない
  const truncated = truncateRRule({ rrule, dtstart: masterStart, timeZone, until: splitPoint });
  const oldMaster = withRdates(withExdates({ ...master, rrule: truncated }, oldExdates), oldRdates);

  // 新シリーズ: 分割点から始まり、COUNT は残数を引き継ぎ、patch を適用する
  const newId = context.generateId();
  const base = withRdates(
    withExdates(
      {
        ...master,
        id: newId,
        start: new Date(splitTime),
        rrule: remainingRRule(rrule, masterStart, timeZone, splitPoint),
      },
      movedExdates,
    ),
    movedRdates,
  );
  if (master.end !== undefined) {
    base.end = new Date(splitTime + occurrenceDurationMs(master, context));
  }
  const created = applyPatch(base, patch);

  // 分割点以降（>=）のオーバーライドは新シリーズに付け替える
  const reassigned = events.map((event) => {
    if (event.id === master.id) {
      return oldMaster;
    }
    if (event.recurringEventId !== master.id) {
      return event;
    }
    return overrideAnchor(event, context, master).getTime() >= splitTime
      ? { ...event, recurringEventId: newId }
      : event;
  });
  return [...reassigned, created];
}

/**
 * `scope: 'thisAndFollowing'` の削除（シリーズ打ち切り）。
 *
 * - 分割点が最初のオカレンスなら繰り返し全体（＋オーバーライド）を削除する
 * - それ以外は分割点の直前で UNTIL 打ち切りし、分割点以降（`>=`）の
 *   EXDATE・RDATE とオーバーライドを取り除く
 */
function truncateSeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  rrule: string,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  const masterStart = parseStart(master, context);
  if (splitPoint.getTime() === masterStart.getTime()) {
    return events.filter((event) => event.id !== master.id && event.recurringEventId !== master.id);
  }

  const timeZone = resolveTimeZone(master, context);
  const allDay = master.allDay ?? false;
  const splitTime = splitPoint.getTime();
  const keptExdates = (master.exdates ?? []).filter(
    (exdate) => parseDateValue(exdate, timeZone, allDay).getTime() < splitTime,
  );
  const keptRdates = (master.rdates ?? []).filter(
    (rdate) => parseDateValue(rdate, timeZone, allDay).getTime() < splitTime,
  );
  const truncated = truncateRRule({ rrule, dtstart: masterStart, timeZone, until: splitPoint });
  const updatedMaster = withRdates(
    withExdates({ ...master, rrule: truncated }, keptExdates),
    keptRdates,
  );
  return events
    .filter((event) => {
      if (event.recurringEventId !== master.id) {
        return true;
      }
      return overrideAnchor(event, context, master).getTime() < splitTime;
    })
    .map((event) => (event.id === master.id ? updatedMaster : event));
}

/**
 * イベントを追加する。
 *
 * `input.id` が省略された場合は `context.generateId()` で採番する。
 * 既存イベントと同じ ID が指定された場合は例外を投げる。
 * `input.rrule` がある場合は {@link normalizeRRuleString} で検証し、
 * 不正なら例外を投げる（保存は入力の文字列のまま行う）。
 *
 * @param events - 現在のイベント一覧
 * @param input - 追加するイベント
 * @param context - 変更コンテキスト
 * @throws ID が重複している場合、または `rrule` が不正な場合は `Error`
 */
export function createEventIn(
  events: readonly CalendarEvent[],
  input: CalendarEventInput,
  context: MutationContext,
): CreateEventResult {
  const id = input.id ?? context.generateId();
  if (events.some((event) => event.id === id)) {
    throw new Error(`イベント ID が重複しています: '${id}'`);
  }
  if (input.rrule !== undefined) {
    // 検証のみに使う（不正な RRULE はここで例外になる）
    normalizeRRuleString(input.rrule);
  }
  const created: CalendarEvent = { ...input, id };
  return { events: [...events, created], created };
}

/**
 * イベントを更新する。
 *
 * - 単発イベント、または `target` 省略時 — `patch` をそのまま適用する
 * - 繰り返しイベント + `target` あり — スコープに応じて
 *   オーバーライド作成・シリーズ分割・全体変更を行う（モジュール概要を参照）
 *
 * 対象 ID のイベントが存在しない場合は例外を投げる。
 * patch の適用は {@link applyPatch} の規則（`undefined` 値のキーは削除）に従う。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（オーバーライドの ID でもよい。
 *   その場合 `scope: 'this'` はオーバーライド自体を変更し、
 *   `'thisAndFollowing'` / `'all'` は親シリーズに対して適用される。
 *   `'thisAndFollowing'` の分割点はオーバーライドの `originalStart` になる）
 * @param patch - 変更内容
 * @param target - 繰り返しの対象オカレンスとスコープ（単発イベントでは省略）
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
  const event = findEventOrThrow(events, id);

  // 不正な RRULE を state に混入させない（createEventIn と同じ検証。展開時に初めて
  // 例外化するのを防ぐ）。`rrule: undefined`（繰り返し解除）は検証対象外。
  if (patch.rrule !== undefined) {
    normalizeRRuleString(patch.rrule);
  }

  // オーバーライドの ID + 'thisAndFollowing' / 'all' は親シリーズへの適用に読み替える
  // （'thisAndFollowing' の分割点はオーバーライドの originalStart）
  if (event.recurringEventId !== undefined && target !== undefined && target.scope !== 'this') {
    const parent = findEventOrThrow(events, event.recurringEventId);
    const occurrenceStart = overrideAnchor(event, context, parent);
    return updateEventIn(
      events,
      parent.id,
      patch,
      { occurrenceStart, scope: target.scope },
      context,
    );
  }

  // 単発イベント（オーバーライド自身を含む）または target 省略時は直接適用する
  if (event.rrule === undefined || target === undefined) {
    return mapPatch(events, id, patch);
  }

  if (target.scope === 'all') {
    return mapPatch(events, id, patch);
  }
  if (target.scope === 'this') {
    return updateThisOccurrence(events, event, patch, target.occurrenceStart, context);
  }
  return splitSeries(events, event, event.rrule, patch, target.occurrenceStart, context);
}

/**
 * イベントを削除する。
 *
 * - 単発イベント、または `target` 省略時 — イベントを取り除く
 *   （繰り返しイベントで `target` 省略時は繰り返し全体と、
 *   それを参照するオーバーライドをすべて取り除く）
 * - `scope: 'this'` — 対象オカレンスを EXDATE に追加する。対象がオーバーライド
 *   済みのオカレンスの場合はオーバーライドを取り除き、元のオカレンスの EXDATE に追加する
 * - `scope: 'thisAndFollowing'` — 対象オカレンスの直前で繰り返しを打ち切り、
 *   対象オカレンス以降のオーバーライド・EXDATE を取り除く。
 *   対象が最初のオカレンスなら繰り返し全体を削除する
 * - `scope: 'all'` — 繰り返し全体と、それを参照するオーバーライドを取り除く
 *
 * `id` にオーバーライドの ID が渡された場合、`scope: 'this'`（または `target`
 * 省略）はオーバーライドを取り除き元のオカレンス（`originalStart`）を親の EXDATE に
 * 追加する。`'thisAndFollowing'` / `'all'` は親シリーズに対して適用される。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（オーバーライドの ID でもよい）
 * @param target - 繰り返しの対象オカレンスとスコープ（単発イベントでは省略）
 * @param context - 変更コンテキスト
 * @returns 削除後のイベント一覧
 */
export function deleteEventIn(
  events: readonly CalendarEvent[],
  id: EventId,
  target: RecurringTarget | undefined,
  context: MutationContext,
): CalendarEvent[] {
  const event = findEventOrThrow(events, id);

  // オーバーライドの ID が渡された場合
  if (event.recurringEventId !== undefined) {
    const scope: RecurringEditScope = target?.scope ?? 'this';
    if (scope === 'this') {
      const parentId = event.recurringEventId;
      const parentEvent = events.find((other) => other.id === parentId);
      const remaining = events.filter((other) => other.id !== id);
      if (parentEvent === undefined) {
        // 親が見つからない場合はオーバーライドの除去のみ行う
        return remaining;
      }
      // オーバーライドを除去し、元のオカレンス（originalStart）を親の EXDATE に追加する
      const original = overrideAnchor(event, context, parentEvent);
      return remaining.map((other) =>
        other.id === parentId ? appendExdate(other, original) : other,
      );
    }
    // 'thisAndFollowing' / 'all' は親シリーズに対して適用する
    // （'thisAndFollowing' の分割点はオーバーライドの originalStart）
    const parent = findEventOrThrow(events, event.recurringEventId);
    const occurrenceStart = overrideAnchor(event, context, parent);
    return deleteEventIn(events, parent.id, { occurrenceStart, scope }, context);
  }

  // 単発イベントは target にかかわらず取り除く
  if (event.rrule === undefined) {
    return events.filter((other) => other.id !== id);
  }

  // 繰り返しイベント: target 省略・'all' は全体と、それを参照するオーバーライドを取り除く
  if (target === undefined || target.scope === 'all') {
    return events.filter((other) => other.id !== id && other.recurringEventId !== id);
  }

  if (target.scope === 'this') {
    const override = findOverrideFor(events, event, target.occurrenceStart, context);
    if (override !== undefined) {
      // オーバーライド済みのオカレンス: オーバーライドを除去し、元のオカレンスを EXDATE に追加する
      const original = overrideAnchor(override, context, event);
      return events
        .filter((other) => other.id !== override.id)
        .map((other) => (other.id === id ? appendExdate(other, original) : other));
    }
    return events.map((other) =>
      other.id === id ? appendExdate(other, target.occurrenceStart) : other,
    );
  }

  return truncateSeries(events, event, event.rrule, target.occurrenceStart, context);
}

/**
 * オカレンスの移動（ドラッグ＆ドロップ）を適用する。
 *
 * `updateEventIn` の便利ラッパ。オカレンスの新しい開始時刻から `start` / `end` の
 * パッチを構築して適用する。長さは元のオカレンスの長さを維持する。
 * 繰り返しイベントの場合はスコープに従う。
 *
 * - `newEnd` 指定時はリサイズとして `end` に `newEnd` を使う
 * - `allDay` 指定時は `allDay` フラグもパッチに含める（時間 ⇔ 終日の変換）
 * - 繰り返しイベント（オーバーライド含む）で `scope` 未指定の場合は例外を投げる
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID
 * @param params.occurrenceStart - 対象オカレンスの現在の開始時刻
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
  const event = findEventOrThrow(events, id);
  const isRecurring = event.rrule !== undefined || event.recurringEventId !== undefined;
  if (isRecurring && params.scope === undefined) {
    throw new Error(`繰り返しイベントの移動には scope の指定が必要です: '${id}'`);
  }
  // マスターの ID + 現在の開始時刻で「オーバーライド済みのオカレンス」を移動する場合は、
  // マスターの既定の長さではなく、そのオーバーライド固有の長さを維持する
  const override =
    event.rrule !== undefined
      ? findOverrideFor(events, event, params.occurrenceStart, context)
      : undefined;
  const end =
    params.newEnd === undefined
      ? new Date(
          params.newStart.getTime() +
            (override !== undefined
              ? occurrenceDurationMs(override, context, event)
              : occurrenceDurationMs(event, context)),
        )
      : new Date(params.newEnd.getTime());
  const patch: CalendarEventPatch = { start: new Date(params.newStart.getTime()), end };
  if (params.allDay !== undefined) {
    patch.allDay = params.allDay;
  }
  const target: RecurringTarget | undefined =
    params.scope === undefined
      ? undefined
      : { occurrenceStart: params.occurrenceStart, scope: params.scope };
  return updateEventIn(events, id, patch, target, context);
}
