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
import { addDaysInZone, dateFromKey, dateKeyInZone, parseDateValue } from './timezone';
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  EventChangeEntry,
  EventId,
  RecurringEditScope,
  TimeZoneId,
} from './types';

// undo（元に戻す）UI 向けに before/after 情報を扱う側からも `./mutations` から
// 直接インポートできるよう、型定義の実体（`./types`）を re-export する。
export type { EventChangeEntry } from './types';

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
 * ID 採番を伴わない操作のコンテキスト（{@link MutationContext} の部分型）。
 *
 * {@link buildOccurrenceCopy} / {@link placeEventInputAt} のようにイベント配列へ
 * 追加を行わない純粋関数が受け取る。`MutationContext` はそのまま渡せる。
 */
export type MutationReadContext = Omit<MutationContext, 'generateId'>;

/**
 * 繰り返しイベントの操作対象を指定する。
 */
export interface RecurringTarget {
  /**
   * 対象オカレンスの本来の開始時刻。オーバーライド済みの場合は
   * `originalStart`（移動・変更される前の位置）を指定する。現在の開始時刻
   * （オーバーライドで移動済みの位置）ではない点に注意。
   */
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

/** 終日の日付キー演算に使う、DST のない基準タイムゾーン。 */
const DATE_KEY_ZONE: TimeZoneId = 'UTC';

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
  context: MutationReadContext,
  master?: CalendarEvent,
): TimeZoneId {
  return event.timeZone ?? master?.timeZone ?? context.displayTimeZone;
}

/** RRULE または RDATE により複数オカレンスへ展開されるイベントか。 */
function hasRecurrence(event: CalendarEvent): boolean {
  return event.rrule !== undefined || (event.rdates?.length ?? 0) > 0;
}

/** 終日の入力値を、解釈に用いるタイムゾーンにおける日付キーへ変換する。 */
function allDayKeyFromValue(value: Date | string, timeZone: TimeZoneId): string {
  return dateKeyInZone(parseDateValue(value, timeZone, true), timeZone);
}

/** 表示中の終日オカレンスの絶対時刻を、表示上の日付キーへ変換する。 */
function targetAllDayKey(occurrenceStart: Date, context: MutationReadContext): string {
  return dateKeyInZone(occurrenceStart, context.displayTimeZone);
}

/** 日付キーに暦日数を加えた日付キーを返す。 */
function addDaysToKey(key: string, amount: number): string {
  return dateKeyInZone(
    addDaysInZone(dateFromKey(key, DATE_KEY_ZONE), amount, DATE_KEY_ZONE),
    DATE_KEY_ZONE,
  );
}

/** 終日イベント 1 オカレンス分の日数を返す。 */
function occurrenceDayCount(
  event: CalendarEvent,
  context: MutationReadContext,
  master?: CalendarEvent,
): number {
  if (event.end === undefined) {
    return 1;
  }
  const timeZone = resolveTimeZone(event, context, master);
  const startKey = allDayKeyFromValue(event.start, timeZone);
  const endKey = allDayKeyFromValue(event.end, timeZone);
  return Math.round(
    (dateFromKey(endKey, DATE_KEY_ZONE).getTime() -
      dateFromKey(startKey, DATE_KEY_ZONE).getTime()) /
      DAY_MS,
  );
}

/** イベントの開始を絶対時刻として解釈する。 */
function parseStart(
  event: CalendarEvent,
  context: MutationReadContext,
  master?: CalendarEvent,
): Date {
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
  context: MutationReadContext,
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
 * 終日マスターに属するオーバーライドの本来の日付キーを返す。
 *
 * 内部生成する `originalStart` は日付キー文字列だが、既存データとの互換のため
 * `Date` も受け付ける。`Date` は {@link EventOccurrence.originalStart} と同じ
 * 「表示タイムゾーンへ投影済みの 0:00」として日付キーを取り出す。
 */
function overrideAllDayAnchorKey(
  event: CalendarEvent,
  context: MutationReadContext,
  master: CalendarEvent,
): string {
  if (event.originalStart instanceof Date) {
    return dateKeyInZone(event.originalStart, context.displayTimeZone);
  }
  if (event.originalStart !== undefined) {
    return allDayKeyFromValue(event.originalStart, resolveTimeZone(event, context, master));
  }
  if (event.allDay === true) {
    return allDayKeyFromValue(event.start, resolveTimeZone(event, context, master));
  }
  return dateKeyInZone(parseStart(event, context, master), context.displayTimeZone);
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
  context: MutationReadContext,
  master?: CalendarEvent,
): Date {
  if (master?.allDay === true) {
    return dateFromKey(overrideAllDayAnchorKey(event, context, master), context.displayTimeZone);
  }
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
  context: MutationReadContext,
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
function appendExdate(
  event: CalendarEvent,
  occurrenceStart: Date,
  context: MutationContext,
): CalendarEvent {
  return {
    ...event,
    exdates: [
      ...(event.exdates ?? []),
      event.allDay === true
        ? targetAllDayKey(occurrenceStart, context)
        : new Date(occurrenceStart.getTime()),
    ],
  };
}

/**
 * 指定オカレンスに対応する既存のオーバーライドを探す。
 *
 * `originalStart` を持つイベントは `originalStart` の一致でのみ判定し、
 * 一致しなければ（現在の `start` が偶然 `occurrenceStart` と一致していても）
 * そのイベントは対象外とする。現在の `start` へのフォールバックは、
 * `originalStart` を持たないイベントに限る（`originalStart` がパース不能な
 * 値の場合はフォールバックせず `parseDateValue` の例外がそのまま伝播する）。
 *
 * この区別がないと、あるオーバーライドが移動した先の時刻が別のオカレンスの
 * 本来の開始時刻と偶然一致した場合に、無関係なオーバーライドを誤って
 * 対応付けてしまう（配列の並び順に依存したバグになる）。
 */
function findOverrideFor(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  occurrenceStart: Date,
  context: MutationReadContext,
): CalendarEvent | undefined {
  if (master.allDay === true) {
    const key = targetAllDayKey(occurrenceStart, context);
    return events.find(
      (event) =>
        event.recurringEventId === master.id &&
        overrideAllDayAnchorKey(event, context, master) === key,
    );
  }
  const time = occurrenceStart.getTime();
  return events.find((event) => {
    if (event.recurringEventId !== master.id) {
      return false;
    }
    const original = parseOriginalStart(event, context, master);
    if (original !== null) {
      return original.getTime() === time;
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
  const base: CalendarEvent = (() => {
    if (master.allDay === true) {
      const startKey = targetAllDayKey(occurrenceStart, context);
      return {
        id: context.generateId(),
        title: master.title,
        start: startKey,
        end: addDaysToKey(startKey, occurrenceDayCount(master, context)),
        recurringEventId: master.id,
        originalStart: startKey,
      };
    }
    return {
      id: context.generateId(),
      title: master.title,
      start: new Date(occurrenceStart.getTime()),
      end: new Date(occurrenceStart.getTime() + occurrenceDurationMs(master, context)),
      recurringEventId: master.id,
      originalStart: new Date(occurrenceStart.getTime()),
    };
  })();
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
  if (master.resourceId !== undefined) {
    base.resourceId = master.resourceId;
  }
  if (master.resourceIds !== undefined) {
    base.resourceIds = master.resourceIds;
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

/** 終日 RRULE シリーズを日付キー基準で「これ以降」に分割する。 */
function splitAllDaySeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  rrule: string,
  patch: CalendarEventPatch,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  const timeZone = resolveTimeZone(master, context);
  const masterStartKey = allDayKeyFromValue(master.start, timeZone);
  const splitKey = targetAllDayKey(splitPoint, context);
  if (splitKey === masterStartKey) {
    return mapPatch(events, master.id, patch);
  }

  const oldExdates: (Date | string)[] = [];
  const movedExdates: (Date | string)[] = [];
  for (const exdate of master.exdates ?? []) {
    (allDayKeyFromValue(exdate, timeZone) < splitKey ? oldExdates : movedExdates).push(exdate);
  }
  const oldRdates: (Date | string)[] = [];
  const movedRdates: (Date | string)[] = [];
  for (const rdate of master.rdates ?? []) {
    (allDayKeyFromValue(rdate, timeZone) < splitKey ? oldRdates : movedRdates).push(rdate);
  }

  const recurrenceStart = dateFromKey(masterStartKey, DATE_KEY_ZONE);
  const recurrenceSplit = dateFromKey(splitKey, DATE_KEY_ZONE);
  const truncated = truncateRRule({
    rrule,
    dtstart: recurrenceStart,
    timeZone: DATE_KEY_ZONE,
    until: recurrenceSplit,
  });
  const oldMaster = withRdates(withExdates({ ...master, rrule: truncated }, oldExdates), oldRdates);

  const newId = context.generateId();
  const base = withRdates(
    withExdates(
      {
        ...master,
        id: newId,
        start: splitKey,
        rrule: remainingRRule(rrule, recurrenceStart, DATE_KEY_ZONE, recurrenceSplit),
      },
      movedExdates,
    ),
    movedRdates,
  );
  if (master.end !== undefined) {
    base.end = addDaysToKey(splitKey, occurrenceDayCount(master, context));
  }
  const created = applyPatch(base, patch);

  const reassigned = events.map((event) => {
    if (event.id === master.id) {
      return oldMaster;
    }
    if (event.recurringEventId !== master.id) {
      return event;
    }
    return overrideAllDayAnchorKey(event, context, master) >= splitKey
      ? { ...event, recurringEventId: newId }
      : event;
  });
  return [...reassigned, created];
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
  if (master.allDay === true) {
    return splitAllDaySeries(events, master, rrule, patch, splitPoint, context);
  }
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

/** 終日 RRULE シリーズを日付キー基準で分割点より前へ打ち切る。 */
function truncateAllDaySeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  rrule: string,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  const timeZone = resolveTimeZone(master, context);
  const masterStartKey = allDayKeyFromValue(master.start, timeZone);
  const splitKey = targetAllDayKey(splitPoint, context);
  if (splitKey === masterStartKey) {
    return events.filter((event) => event.id !== master.id && event.recurringEventId !== master.id);
  }

  const keptExdates = (master.exdates ?? []).filter(
    (exdate) => allDayKeyFromValue(exdate, timeZone) < splitKey,
  );
  const keptRdates = (master.rdates ?? []).filter(
    (rdate) => allDayKeyFromValue(rdate, timeZone) < splitKey,
  );
  const truncated = truncateRRule({
    rrule,
    dtstart: dateFromKey(masterStartKey, DATE_KEY_ZONE),
    timeZone: DATE_KEY_ZONE,
    until: dateFromKey(splitKey, DATE_KEY_ZONE),
  });
  const updatedMaster = withRdates(
    withExdates({ ...master, rrule: truncated }, keptExdates),
    keptRdates,
  );
  return events
    .filter(
      (event) =>
        event.recurringEventId !== master.id ||
        overrideAllDayAnchorKey(event, context, master) < splitKey,
    )
    .map((event) => (event.id === master.id ? updatedMaster : event));
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
  if (master.allDay === true) {
    return truncateAllDaySeries(events, master, rrule, splitPoint, context);
  }
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

/** RDATE-only シリーズ内の値が分割点より前かを判定する。 */
function seriesValueIsBefore(
  master: CalendarEvent,
  value: Date | string,
  splitPoint: Date,
  context: MutationContext,
): boolean {
  if (master.allDay === true) {
    return (
      allDayKeyFromValue(value, resolveTimeZone(master, context)) <
      targetAllDayKey(splitPoint, context)
    );
  }
  return (
    parseDateValue(value, resolveTimeZone(master, context), false).getTime() < splitPoint.getTime()
  );
}

/** RDATE-only シリーズ内の値が分割点と一致するかを判定する。 */
function seriesValueIsAt(
  master: CalendarEvent,
  value: Date | string,
  splitPoint: Date,
  context: MutationContext,
): boolean {
  if (master.allDay === true) {
    return (
      allDayKeyFromValue(value, resolveTimeZone(master, context)) ===
      targetAllDayKey(splitPoint, context)
    );
  }
  return (
    parseDateValue(value, resolveTimeZone(master, context), false).getTime() ===
    splitPoint.getTime()
  );
}

/** RDATE-only シリーズを「これ以降」に分割する。 */
function splitRdateSeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  patch: CalendarEventPatch,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  if (seriesValueIsAt(master, master.start, splitPoint, context)) {
    return mapPatch(events, master.id, patch);
  }

  const oldExdates: (Date | string)[] = [];
  const movedExdates: (Date | string)[] = [];
  for (const exdate of master.exdates ?? []) {
    (seriesValueIsBefore(master, exdate, splitPoint, context) ? oldExdates : movedExdates).push(
      exdate,
    );
  }
  const oldRdates: (Date | string)[] = [];
  const movedRdates: (Date | string)[] = [];
  for (const rdate of master.rdates ?? []) {
    if (seriesValueIsBefore(master, rdate, splitPoint, context)) {
      oldRdates.push(rdate);
    } else if (!seriesValueIsAt(master, rdate, splitPoint, context)) {
      // 分割点自身は新シリーズの start が表すため、rdates へ重複して持たせない。
      movedRdates.push(rdate);
    }
  }

  const oldMaster = withRdates(withExdates(master, oldExdates), oldRdates);
  const newId = context.generateId();
  const splitStart: Date | string =
    master.allDay === true ? targetAllDayKey(splitPoint, context) : new Date(splitPoint.getTime());
  const base = withRdates(
    withExdates({ ...master, id: newId, start: splitStart }, movedExdates),
    movedRdates,
  );
  if (master.end !== undefined) {
    base.end =
      master.allDay === true
        ? addDaysToKey(String(splitStart), occurrenceDayCount(master, context))
        : new Date(splitPoint.getTime() + occurrenceDurationMs(master, context));
  }
  const created = applyPatch(base, patch);

  const reassigned = events.map((event) => {
    if (event.id === master.id) {
      return oldMaster;
    }
    if (event.recurringEventId !== master.id) {
      return event;
    }
    const atOrAfter =
      master.allDay === true
        ? overrideAllDayAnchorKey(event, context, master) >= targetAllDayKey(splitPoint, context)
        : overrideAnchor(event, context, master).getTime() >= splitPoint.getTime();
    return atOrAfter ? { ...event, recurringEventId: newId } : event;
  });
  return [...reassigned, created];
}

/** RDATE-only シリーズを分割点より前へ打ち切る。 */
function truncateRdateSeries(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  splitPoint: Date,
  context: MutationContext,
): CalendarEvent[] {
  if (seriesValueIsAt(master, master.start, splitPoint, context)) {
    return events.filter((event) => event.id !== master.id && event.recurringEventId !== master.id);
  }
  const keptExdates = (master.exdates ?? []).filter((exdate) =>
    seriesValueIsBefore(master, exdate, splitPoint, context),
  );
  const keptRdates = (master.rdates ?? []).filter((rdate) =>
    seriesValueIsBefore(master, rdate, splitPoint, context),
  );
  const updatedMaster = withRdates(withExdates(master, keptExdates), keptRdates);
  return events
    .filter((event) => {
      if (event.recurringEventId !== master.id) {
        return true;
      }
      return master.allDay === true
        ? overrideAllDayAnchorKey(event, context, master) < targetAllDayKey(splitPoint, context)
        : overrideAnchor(event, context, master).getTime() < splitPoint.getTime();
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
  if (!hasRecurrence(event) || target === undefined) {
    return mapPatch(events, id, patch);
  }

  if (target.scope === 'all') {
    return mapPatch(events, id, patch);
  }
  if (target.scope === 'this') {
    return updateThisOccurrence(events, event, patch, target.occurrenceStart, context);
  }
  if (event.rrule === undefined) {
    return splitRdateSeries(events, event, patch, target.occurrenceStart, context);
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
        other.id === parentId ? appendExdate(other, original, context) : other,
      );
    }
    // 'thisAndFollowing' / 'all' は親シリーズに対して適用する
    // （'thisAndFollowing' の分割点はオーバーライドの originalStart）
    const parent = findEventOrThrow(events, event.recurringEventId);
    const occurrenceStart = overrideAnchor(event, context, parent);
    return deleteEventIn(events, parent.id, { occurrenceStart, scope }, context);
  }

  // 単発イベントは target にかかわらず取り除く
  if (!hasRecurrence(event)) {
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
        .map((other) => (other.id === id ? appendExdate(other, original, context) : other));
    }
    return events.map((other) =>
      other.id === id ? appendExdate(other, target.occurrenceStart, context) : other,
    );
  }

  if (event.rrule === undefined) {
    return truncateRdateSeries(events, event, target.occurrenceStart, context);
  }
  return truncateSeries(events, event, event.rrule, target.occurrenceStart, context);
}

/**
 * before/after 情報付きの変更操作の結果。
 */
export interface EventMutationResult {
  /** 操作後のイベント一覧。 */
  events: CalendarEvent[];
  /** 影響を受けた各イベントの before/after 一覧（順序は保証しない）。 */
  changes: EventChangeEntry[];
}

/**
 * 値の構造的な等価性を判定する（{@link diffEventChanges} の無変化パッチ検出専用）。
 *
 * `applyPatch` は変更の有無によらず常に新しいオブジェクト（複製）を返すため、
 * `updateEventInWithChanges(events, id, {}, ...)` のような値として無変化のパッチでも
 * 参照比較（`===`）だけでは「変更あり」と誤検出してしまう。この関数は `Date` を
 * 時刻（`getTime()`）で、配列・プレーンオブジェクト（`extendedProps` 等）を
 * 再帰的に比較することで、値としては同一な before/after を正しく「無変化」と判定する。
 */
function isStructurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => isStructurallyEqual(value, b[index]))
    );
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    // a / b はこの時点でプレーンオブジェクトと判定済みだが、キーによる動的アクセスには
    // 型情報がないため Record<string, unknown> へのキャストが必要（isStructurallyEqual
    // 自体が unknown を受け取る再帰関数のため、これ以上の型の絞り込みはできない）
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    return aKeys.every(
      (key) => Object.hasOwn(bRecord, key) && isStructurallyEqual(aRecord[key], bRecord[key]),
    );
  }
  return false;
}

/**
 * `exdates` / `rdates` を、順序に依存しない比較キーの配列（ソート済み）へ正規化する。
 *
 * 両フィールドは概念上「日付の集合」であり並び順に意味がないため、同じ集合を
 * 並び替えただけのパッチを「変更あり」と過剰検出しないようにする。`Date` は時刻値、
 * 文字列は文字列のままキー化する（同一時刻でも `Date` と文字列は別値扱い。
 * 文字列のタイムゾーン解釈を持ち込まないための安全側の判定）。
 * 未指定（`undefined`）と空配列は同じ「除外・追加なし」として扱う。
 */
function normalizedDateListKeys(list: readonly (Date | string)[] | undefined): readonly string[] {
  return (list ?? [])
    .map((value) => (value instanceof Date ? `t:${value.getTime()}` : `s:${value}`))
    .sort();
}

/**
 * イベント同士の「値としての同一性」を判定する。
 *
 * 基本は {@link isStructurallyEqual} だが、`exdates` / `rdates` だけは
 * {@link normalizedDateListKeys} で順序に依存しない集合として比較する。
 */
function isEventStructurallyEqual(a: CalendarEvent, b: CalendarEvent): boolean {
  if (
    !isStructurallyEqual(normalizedDateListKeys(a.exdates), normalizedDateListKeys(b.exdates)) ||
    !isStructurallyEqual(normalizedDateListKeys(a.rdates), normalizedDateListKeys(b.rdates))
  ) {
    return false;
  }
  const { exdates: _aExdates, rdates: _aRdates, ...aRest } = a;
  const { exdates: _bExdates, rdates: _bRdates, ...bRest } = b;
  return isStructurallyEqual(aRest, bRest);
}

/**
 * 操作前後のイベント配列を比較し、影響を受けた各イベントの before/after 一覧を返す。
 *
 * mutations.ts の各操作（`mapPatch` / `splitSeries` / `truncateSeries` などが内部で使う
 * 配列操作）は、変更していないイベントを常に同一参照のまま返す（新しい複製を作らない）。
 * そのため、id が一致し参照も同一（`===`）のイベントは「影響を受けていない」とみなし、
 * 参照比較だけで正しく差分を検出できる。
 *
 * 一方、`applyPatch` が絡む変更（`mapPatch` 経由の更新）は、パッチの内容によらず常に
 * 新しい複製を返すため、参照が異なっていても値としては無変化な場合がある
 * （例: 空パッチ `{}`、既存値と同じ値を明示指定したパッチ）。そのため参照が異なる
 * 場合は {@link isEventStructurallyEqual} で値としての差分の有無も確認し、値も同一なら
 * 「影響を受けていない」として changes に含めない。
 *
 * `index`（{@link EventChangeEntry.index}）は、`before` を持つエントリ（削除・更新）
 * には `before` 配列内での位置を、新規作成のみ（`before` なし）のエントリには
 * `after` 配列内での位置を記録する。undo（削除の取り消し）・redo（作成のやり直し）
 * が挿入位置を復元するために使う。
 *
 * @param before - 操作前のイベント配列
 * @param after - 操作後のイベント配列
 * @returns 影響を受けた各イベントの before/after 一覧（順序は保証しない）
 */
function diffEventChanges(
  before: readonly CalendarEvent[],
  after: readonly CalendarEvent[],
): EventChangeEntry[] {
  const beforeById = new Map(before.map((event) => [event.id, event]));
  const afterById = new Map(after.map((event) => [event.id, event]));
  const changes: EventChangeEntry[] = [];
  // before 配列を添字付きで走査することで、Map.get の戻り値型（number | undefined）を
  // 経由せず index を number として直接記録できる
  before.forEach((beforeEvent, index) => {
    const afterEvent = afterById.get(beforeEvent.id);
    if (afterEvent === undefined) {
      changes.push({ before: beforeEvent, index });
    } else if (afterEvent !== beforeEvent && !isEventStructurallyEqual(beforeEvent, afterEvent)) {
      changes.push({ before: beforeEvent, after: afterEvent, index });
    }
  });
  after.forEach((afterEvent, index) => {
    if (!beforeById.has(afterEvent.id)) {
      changes.push({ after: afterEvent, index });
    }
  });
  return changes;
}

/**
 * イベントを更新し、影響を受けた各イベントの before/after も返す（{@link updateEventIn} の拡張版）。
 *
 * 単発イベントの変更では対象イベント 1 件の before/after のみを返す。繰り返しイベントの
 * スコープ操作では、オーバーライド生成（`scope: 'this'`）・シリーズ分割
 * （`scope: 'thisAndFollowing'`）で作成・変更されたイベント（分割点以降のオーバーライドの
 * `recurringEventId` 付け替えを含む）をすべて含む。undo（元に戻す）UI の実装に使う。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（{@link updateEventIn} と同じ）
 * @param patch - 変更内容
 * @param target - 繰り返しの対象オカレンスとスコープ（単発イベントでは省略）
 * @param context - 変更コンテキスト
 * @returns 更新後のイベント一覧と、影響を受けた各イベントの before/after 一覧
 * @example
 * ```ts
 * const { events, changes } = updateEventInWithChanges(current, id, { title: '変更後' }, undefined, context);
 * // changes[0] は { before: 変更前のイベント, after: 変更後のイベント }
 * ```
 */
export function updateEventInWithChanges(
  events: readonly CalendarEvent[],
  id: EventId,
  patch: CalendarEventPatch,
  target: RecurringTarget | undefined,
  context: MutationContext,
): EventMutationResult {
  const next = updateEventIn(events, id, patch, target, context);
  return { events: next, changes: diffEventChanges(events, next) };
}

/**
 * イベントを削除し、影響を受けた各イベントの before/after も返す（{@link deleteEventIn} の拡張版）。
 *
 * 削除されたイベントは `after` を持たない（`before` のみ）。`scope: 'this'` / `'thisAndFollowing'`
 * でマスターに EXDATE が追加された場合や、`scope: 'thisAndFollowing'` で分割点以降の
 * オーバーライドが取り除かれた場合も、影響を受けたイベントすべてを含む。
 * undo（元に戻す）UI の実装に使う。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID（{@link deleteEventIn} と同じ）
 * @param target - 繰り返しの対象オカレンスとスコープ（単発イベントでは省略）
 * @param context - 変更コンテキスト
 * @returns 削除後のイベント一覧と、影響を受けた各イベントの before/after 一覧
 */
export function deleteEventInWithChanges(
  events: readonly CalendarEvent[],
  id: EventId,
  target: RecurringTarget | undefined,
  context: MutationContext,
): EventMutationResult {
  const next = deleteEventIn(events, id, target, context);
  return { events: next, changes: diffEventChanges(events, next) };
}

/**
 * オカレンスの移動（ドラッグ＆ドロップ）を適用する。
 *
 * `updateEventIn` の便利ラッパ。オカレンスの新しい開始時刻から `start` / `end` の
 * パッチを構築して適用する。長さは元のオカレンスの長さを維持する。
 * 繰り返しイベントの場合はスコープに従う。
 *
 * - `newEnd` 指定時はリサイズとして `end` に `newEnd` を使う
 * - `allDay` 指定時は `allDay` フラグもパッチに含める（時間 ⇔ 終日の変換）。
 *   `newEnd` を省略しつつ `allDay` が変換前の値から変化する場合、変換前の長さ
 *   （ミリ秒）はそのまま引き継がない。終日化はちょうど 1 日、時間指定化は
 *   `defaultEventMinutes` を既定の長さとして使う
 * - 繰り返しイベント（オーバーライド含む）で `scope` 未指定の場合は例外を投げる
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID
 * @param params.occurrenceStart - 対象オカレンスの本来の開始時刻（オーバーライド済みの
 *   場合は `originalStart`。現在の開始時刻ではない）
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
  const isRecurring = hasRecurrence(event) || event.recurringEventId !== undefined;
  if (isRecurring && params.scope === undefined) {
    throw new Error(`繰り返しイベントの移動には scope の指定が必要です: '${id}'`);
  }
  // マスターの ID + 本来の開始時刻（originalStart）で「オーバーライド済みのオカレンス」を
  // 移動する場合は、マスターの既定の長さではなく、そのオーバーライド固有の長さを維持する
  const override = hasRecurrence(event)
    ? findOverrideFor(events, event, params.occurrenceStart, context)
    : undefined;
  // 対象オカレンスの変換前の allDay フラグ（オーバーライド済みならオーバーライド自身の値）
  const currentAllDay = (override ?? event).allDay ?? false;
  const allDayChanges = params.allDay !== undefined && params.allDay !== currentAllDay;
  const destinationAllDay = params.allDay ?? currentAllDay;
  let patch: CalendarEventPatch;
  if (destinationAllDay) {
    const startKey = targetAllDayKey(params.newStart, context);
    const dayCount = allDayChanges
      ? 1
      : occurrenceDayCount(override ?? event, context, override === undefined ? undefined : event);
    const endKey =
      params.newEnd === undefined
        ? addDaysToKey(startKey, dayCount)
        : targetAllDayKey(params.newEnd, context);
    patch = { start: startKey, end: endKey };
  } else {
    const end =
      params.newEnd !== undefined
        ? new Date(params.newEnd.getTime())
        : allDayChanges
          ? // 終日から時間指定への変換で newEnd 省略時は defaultEventMinutes を使う
            new Date(params.newStart.getTime() + context.defaultEventMinutes * MINUTE_MS)
          : new Date(
              params.newStart.getTime() +
                (override !== undefined
                  ? occurrenceDurationMs(override, context, event)
                  : occurrenceDurationMs(event, context)),
            );
    patch = { start: new Date(params.newStart.getTime()), end };
  }
  if (params.allDay !== undefined) {
    patch.allDay = params.allDay;
  }
  const target: RecurringTarget | undefined =
    params.scope === undefined
      ? undefined
      : { occurrenceStart: params.occurrenceStart, scope: params.scope };
  return updateEventIn(events, id, patch, target, context);
}

/**
 * オカレンスの移動（ドラッグ＆ドロップ）を適用し、影響を受けた各イベントの before/after も
 * 返す（{@link moveOccurrenceIn} の拡張版）。undo（元に戻す）UI の実装に使う。
 *
 * @param events - 現在のイベント一覧
 * @param id - 対象イベントの ID
 * @param params - {@link moveOccurrenceIn} と同じ
 * @param context - 変更コンテキスト
 * @returns 移動後のイベント一覧と、影響を受けた各イベントの before/after 一覧
 */
export function moveOccurrenceInWithChanges(
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
): EventMutationResult {
  const next = moveOccurrenceIn(events, id, params, context);
  return { events: next, changes: diffEventChanges(events, next) };
}

/**
 * before/after 情報付きのイベント作成操作の結果
 * （{@link pasteEventInWithChanges} / {@link duplicateEventInWithChanges} の戻り値）。
 */
export interface CreateEventMutationResult extends EventMutationResult {
  /** 作成されたイベント（`id` 確定済み）。 */
  created: CalendarEvent;
}

/**
 * {@link buildOccurrenceCopy} / {@link duplicateEventIn} のパラメータ。
 */
export interface OccurrenceCopyParams {
  /**
   * コピー対象オカレンスの本来の開始時刻。繰り返しイベント（RRULE / RDATE を持つ
   * イベント）では必須。単発イベント・オーバーライドでは省略する（指定しても無視される）。
   * オーバーライド済みのオカレンスを指すマスター ID + `occurrenceStart` の組み合わせでは、
   * そのオーバーライドの現在の内容がコピーされる。
   */
  occurrenceStart?: Date;
}

/**
 * {@link placeEventInputAt} / {@link pasteEventIn} の貼り付け先を指定するパラメータ。
 */
export interface PasteEventParams {
  /** 貼り付け先の開始時刻（絶対時刻）。終日イベントは表示タイムゾーンの日付キーへ変換される。 */
  newStart: Date;
  /**
   * 貼り付け先が終日枠かどうか（時間指定 ⇔ 終日の変換に使用。省略時はコピー元の
   * `allDay` を維持する）。変換を伴う場合の長さは {@link moveOccurrenceIn} と同じ規則
   * （終日化はちょうど 1 日、時間指定化は `defaultEventMinutes`）になる。
   */
  allDay?: boolean;
}

/**
 * イベントから `id` と繰り返し・オーバーライド関連のフィールドを取り除いた
 * 複製用の入力を返す（{@link buildOccurrenceCopy} の共通処理）。
 */
function stripEventIdentity(event: CalendarEvent): CalendarEventInput {
  const {
    id: _id,
    rrule: _rrule,
    exdates: _exdates,
    rdates: _rdates,
    recurringEventId: _recurringEventId,
    originalStart: _originalStart,
    ...rest
  } = event;
  return rest;
}

/**
 * イベント（またはオカレンス）のコピーを、新規作成の入力（{@link CalendarEventInput}）
 * として構築する。コピー＆ペーストの「コピー」に相当する純粋関数で、イベント一覧は
 * 変更しない。
 *
 * - **単発イベント** — `id` を取り除いた複製を返す（`start` / `end` は元の値のまま）
 * - **繰り返しイベント + `occurrenceStart`** — 当該オカレンスを **単発化** した複製を
 *   返す（Google カレンダーのコピーと同じ扱い）。`start` / `end` はそのオカレンスの
 *   日時になり、`rrule` / `exdates` / `rdates` は引き継がない。対象オカレンスが
 *   オーバーライド済みの場合は、オーバーライドの現在の内容（移動後の日時・変更後の
 *   タイトル等）をコピーする
 * - **オーバーライドの ID** — オーバーライドの内容を単発イベントとして複製する
 *   （`recurringEventId` / `originalStart` は引き継がない）
 *
 * 戻り値をそのまま {@link createEventIn}（または `CalendarApi.createEvent`）に渡すと
 * 同じ日時への複製に、{@link placeEventInputAt} / {@link pasteEventIn} に渡すと
 * 別の日時への貼り付けになる。
 *
 * @param events - 現在のイベント一覧
 * @param id - コピー対象イベントの ID（オーバーライドの ID でもよい）
 * @param params - コピー対象オカレンスの指定（{@link OccurrenceCopyParams}）
 * @param context - 変更コンテキスト（ID 採番は行わないため {@link MutationReadContext} で足りる）
 * @returns 新規作成の入力として使える複製（`id` を持たない）
 * @throws 対象 ID のイベントが存在しない場合、または繰り返しイベントで
 *   `occurrenceStart` が省略された場合は `Error`
 * @example
 * ```ts
 * // 繰り返しの 7/3 のオカレンスを単発イベントとしてコピーする
 * const copy = buildOccurrenceCopy(events, 'master-1', {
 *   occurrenceStart: new Date('2026-07-03T00:00:00Z'),
 * }, context);
 * // copy.rrule は undefined（シリーズ全体はコピーされない）
 * ```
 */
export function buildOccurrenceCopy(
  events: readonly CalendarEvent[],
  id: EventId,
  params: OccurrenceCopyParams,
  context: MutationReadContext,
): CalendarEventInput {
  const event = findEventOrThrow(events, id);

  // 単発イベント・オーバーライドは現在の内容をそのまま複製する
  if (!hasRecurrence(event)) {
    return stripEventIdentity(event);
  }

  const occurrenceStart = params.occurrenceStart;
  if (occurrenceStart === undefined) {
    throw new Error(`繰り返しイベントのコピーには occurrenceStart の指定が必要です: '${id}'`);
  }

  // オーバーライド済みのオカレンスは、オーバーライドの現在の内容をコピーする
  const override = findOverrideFor(events, event, occurrenceStart, context);
  if (override !== undefined) {
    return stripEventIdentity(override);
  }

  if (event.allDay === true) {
    const startKey = targetAllDayKey(occurrenceStart, context);
    return {
      ...stripEventIdentity(event),
      start: startKey,
      end: addDaysToKey(startKey, occurrenceDayCount(event, context)),
    };
  }
  return {
    ...stripEventIdentity(event),
    start: new Date(occurrenceStart.getTime()),
    end: new Date(occurrenceStart.getTime() + occurrenceDurationMs(event, context)),
  };
}

/**
 * 新規作成の入力を貼り付け先の日時へ配置した入力を返す。コピー＆ペーストの
 * 「貼り付け先日時への配置」に相当する純粋関数で、イベント一覧には触れない。
 *
 * - 長さは元の入力の長さを維持する（`end` 省略時は終日 1 日／時間指定
 *   `defaultEventMinutes` 分とみなす）
 * - `params.allDay` で時間指定 ⇔ 終日を変換できる。変換を伴う場合の長さは
 *   {@link moveOccurrenceIn} と同じ規則（終日化はちょうど 1 日、時間指定化は
 *   `defaultEventMinutes`）になる
 * - 入力の `id` は取り除かれる（貼り付けは常に新しいイベントの作成になる）
 *
 * @param input - 配置する入力（{@link buildOccurrenceCopy} の戻り値など）
 * @param params - 貼り付け先の指定（{@link PasteEventParams}）
 * @param context - 変更コンテキスト（ID 採番は行わないため {@link MutationReadContext} で足りる）
 * @returns 貼り付け先へ配置した新しい入力（`id` を持たない）
 */
export function placeEventInputAt(
  input: CalendarEventInput,
  params: PasteEventParams,
  context: MutationReadContext,
): CalendarEventInput {
  const { id: _dropped, ...rest } = input;
  // 長さの算出ヘルパー（occurrenceDurationMs / occurrenceDayCount）は CalendarEvent を
  // 受け取るが `id` は参照しないため、仮の ID を付けた一時イベントとして扱う
  const source: CalendarEvent = { ...rest, id: '(paste-source)' };
  const sourceAllDay = input.allDay ?? false;
  const destinationAllDay = params.allDay ?? sourceAllDay;
  const allDayChanges = destinationAllDay !== sourceAllDay;

  if (destinationAllDay) {
    const startKey = targetAllDayKey(params.newStart, context);
    const dayCount = allDayChanges ? 1 : occurrenceDayCount(source, context);
    return { ...rest, start: startKey, end: addDaysToKey(startKey, dayCount), allDay: true };
  }
  const durationMs = allDayChanges
    ? context.defaultEventMinutes * MINUTE_MS
    : occurrenceDurationMs(source, context);
  const placed: CalendarEventInput = {
    ...rest,
    start: new Date(params.newStart.getTime()),
    end: new Date(params.newStart.getTime() + durationMs),
  };
  if (allDayChanges) {
    // 終日 → 時間指定の変換のみ allDay を明示する（元から時間指定なら元の値を維持）
    placed.allDay = false;
  }
  return placed;
}

/**
 * 入力を貼り付け先の日時へ配置してイベント一覧に追加する
 * （{@link placeEventInputAt} + {@link createEventIn}）。
 *
 * 入力の `id` は無視して常に `context.generateId()` で採番するため、同じ
 * クリップボード内容を複数回貼り付けられる。
 *
 * @param events - 現在のイベント一覧
 * @param input - 貼り付ける入力（{@link buildOccurrenceCopy} の戻り値など）
 * @param params - 貼り付け先の指定（{@link PasteEventParams}）
 * @param context - 変更コンテキスト
 * @returns 追加後のイベント一覧と作成されたイベント
 */
export function pasteEventIn(
  events: readonly CalendarEvent[],
  input: CalendarEventInput,
  params: PasteEventParams,
  context: MutationContext,
): CreateEventResult {
  return createEventIn(events, placeEventInputAt(input, params, context), context);
}

/**
 * イベントを貼り付け、影響を受けたイベントの before/after も返す
 * （{@link pasteEventIn} の拡張版）。`changes` は作成されたイベント 1 件
 * （`after` のみのエントリ）になり、undo（元に戻す）UI の実装に使える。
 *
 * @param events - 現在のイベント一覧
 * @param input - 貼り付ける入力（{@link pasteEventIn} と同じ）
 * @param params - 貼り付け先の指定（{@link PasteEventParams}）
 * @param context - 変更コンテキスト
 * @returns 追加後のイベント一覧・作成されたイベント・before/after 一覧
 */
export function pasteEventInWithChanges(
  events: readonly CalendarEvent[],
  input: CalendarEventInput,
  params: PasteEventParams,
  context: MutationContext,
): CreateEventMutationResult {
  const result = pasteEventIn(events, input, params, context);
  return { ...result, changes: diffEventChanges(events, result.events) };
}

/**
 * イベント（またはオカレンス）を同じ日時のまま複製する
 * （{@link buildOccurrenceCopy} + {@link createEventIn}）。
 *
 * 繰り返しイベントでは当該オカレンスの **単発化** した複製になる
 * （{@link buildOccurrenceCopy} のコピー規則を参照）。
 *
 * @param events - 現在のイベント一覧
 * @param id - 複製対象イベントの ID（オーバーライドの ID でもよい）
 * @param params - 複製対象オカレンスの指定（{@link OccurrenceCopyParams}）
 * @param context - 変更コンテキスト
 * @returns 追加後のイベント一覧と作成されたイベント
 */
export function duplicateEventIn(
  events: readonly CalendarEvent[],
  id: EventId,
  params: OccurrenceCopyParams,
  context: MutationContext,
): CreateEventResult {
  return createEventIn(events, buildOccurrenceCopy(events, id, params, context), context);
}

/**
 * イベントを複製し、影響を受けたイベントの before/after も返す
 * （{@link duplicateEventIn} の拡張版）。`changes` は作成されたイベント 1 件
 * （`after` のみのエントリ）になり、undo（元に戻す）UI の実装に使える。
 *
 * @param events - 現在のイベント一覧
 * @param id - 複製対象イベントの ID（{@link duplicateEventIn} と同じ）
 * @param params - 複製対象オカレンスの指定（{@link OccurrenceCopyParams}）
 * @param context - 変更コンテキスト
 * @returns 追加後のイベント一覧・作成されたイベント・before/after 一覧
 */
export function duplicateEventInWithChanges(
  events: readonly CalendarEvent[],
  id: EventId,
  params: OccurrenceCopyParams,
  context: MutationContext,
): CreateEventMutationResult {
  const result = duplicateEventIn(events, id, params, context);
  return { ...result, changes: diffEventChanges(events, result.events) };
}

/**
 * {@link applyEventChangeEntries} が適用する方向。
 *
 * - `'before'` — 変更前の状態へ戻す（取り消し／undo）
 * - `'after'` — 変更後の状態を適用する（やり直し／redo、または再現）
 */
export type EventChangeDirection = 'before' | 'after';

/**
 * {@link applyEventChangeEntries} / {@link applyEventChangeEntriesWithApplied} の
 * 適用結果。
 */
export interface EventChangeApplyResult {
  /** 適用後のイベント一覧。 */
  events: CalendarEvent[];
  /**
   * 実際に適用された（ドリフトによりスキップされなかった）エントリの一覧。
   * `changes` と同じ順序の部分列になる。
   *
   * 各エントリの {@link EventChangeEntry.index} は適用時点の実際の位置
   * （削除なら削除直前の一覧内での位置、挿入なら挿入後の一覧内での位置）へ
   * 更新される。これにより、一部エントリがスキップされた場合でも、この一覧を
   * 逆方向へ再適用すれば適用直前の並び順を復元できる。
   */
  applied: EventChangeEntry[];
}

/**
 * changes の各エントリを、現在のイベント一覧に対して before/after いずれかの
 * 方向へ適用する（{@link applyEventChangeEntries} / {@link applyEventChangeEntriesWithApplied}
 * の共通実装）。
 *
 * - `direction: 'before'` → 変更前の状態へ戻す（取り消し／undo）
 * - `direction: 'after'` → 変更後の状態を適用する（やり直し／redo、または再現）
 *
 * 適用直前に期待する現在の状態（`'before'` 方向なら `after` が、`'after'` 方向なら
 * `before` が、現在の一覧に存在するはず）と食い違うエントリ（対象イベントが既に
 * 消えている／想定外に存在している）は安全にスキップし、他のエントリの適用は
 * 継続する。存在の有無のみを見る判定であり、値の内容までは比較しない
 * （presence-only）。
 *
 * 現在の一覧に存在しない id を新たに書き込む（削除の取り消し・作成のやり直し）
 * 場合は、そのエントリの {@link EventChangeEntry.index} が指す位置
 * （`Math.min(index, 現在の要素数)`。省略時は末尾）に挿入する。複数の挿入がある
 * 場合は `index` の昇順に処理して安定した順序にする。既存 id への書き込み（内容の
 * 更新）は元の位置を維持する。
 *
 * `applied` の各エントリは、削除なら削除直前の一覧内での位置・挿入なら挿入後の
 * 一覧内での位置へ {@link EventChangeEntry.index} を更新して返す（一部エントリが
 * ドリフトによりスキップされた場合でも、逆方向の再適用で並び順を復元できる）。
 *
 * 入力の `events` 配列・各イベントは変更しない（純粋関数）。
 */
function applyEventChangeEntriesCore(
  events: readonly CalendarEvent[],
  changes: readonly EventChangeEntry[],
  direction: EventChangeDirection,
): EventChangeApplyResult {
  const byId = new Map(events.map((event) => [event.id, event]));
  // 削除の逆適用（再挿入）が実際の位置へ戻せるよう、適用前の一覧内での位置を控える
  const positionBefore = new Map(events.map((event, index) => [event.id, index]));
  const applied: EventChangeEntry[] = [];
  // 現在の一覧に存在しなかった id への書き込み（挿入）とその挿入位置。
  // 同じバッチ内で同じ id が「削除→挿入」を繰り返す場合は最後の状態を採用する
  const insertions = new Map<EventId, number | undefined>();
  // 挿入エントリの applied 内での位置 → id。最終的な並びが確定してから index を差し替える
  const pendingInsertPositions = new Map<number, EventId>();

  for (const change of changes) {
    const expected = direction === 'before' ? change.after : change.before;
    const write = direction === 'before' ? change.before : change.after;
    // before/after は同じイベントの id を共有するため、どちらか定義されている方から取れる
    const id = expected?.id ?? write?.id;
    if (id === undefined) {
      continue;
    }
    const shouldBePresent = expected !== undefined;
    const isPresent = byId.has(id);
    if (shouldBePresent !== isPresent) {
      // ドリフト: 対象イベントが既に消えている、または想定外に存在しているためスキップ
      continue;
    }
    if (write === undefined) {
      const position = positionBefore.get(id);
      applied.push(position === undefined ? change : { ...change, index: position });
      byId.delete(id);
      insertions.delete(id);
    } else {
      if (!isPresent) {
        insertions.set(id, change.index);
        pendingInsertPositions.set(applied.length, id);
      }
      applied.push(change);
      byId.set(id, write);
    }
  }

  // 挿入扱いではない既存 id（一覧に存在し続けている id）を元の順序で並べたベース配列
  const base: CalendarEvent[] = [];
  for (const event of events) {
    if (!insertions.has(event.id)) {
      const current = byId.get(event.id);
      if (current !== undefined) {
        base.push(current);
      }
    }
  }

  // 挿入は index 昇順に処理して安定させる（index 省略時は末尾扱い）
  const orderedInsertions = [...insertions].sort(
    ([, a], [, b]) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY),
  );
  for (const [id, index] of orderedInsertions) {
    const value = byId.get(id);
    if (value === undefined) {
      continue;
    }
    base.splice(Math.min(index ?? base.length, base.length), 0, value);
  }

  // 挿入エントリの index を実際の挿入位置（クランプ・相互の押し出しを反映した最終位置）へ差し替える
  if (pendingInsertPositions.size > 0) {
    const finalPositions = new Map(base.map((event, index) => [event.id, index]));
    for (const [appliedIndex, id] of pendingInsertPositions) {
      const position = finalPositions.get(id);
      const entry = applied[appliedIndex];
      if (position !== undefined && entry !== undefined) {
        applied[appliedIndex] = { ...entry, index: position };
      }
    }
  }

  return { events: base, applied };
}

/**
 * changes の各エントリを、現在のイベント一覧に対して before/after いずれかの
 * 方向へ適用する。
 *
 * - `direction: 'before'` → 変更前の状態へ戻す（取り消し／undo）
 * - `direction: 'after'` → 変更後の状態を適用する（やり直し／redo、または再現）
 *
 * 適用直前に期待する現在の状態（`'before'` 方向なら `after` が、`'after'` 方向なら
 * `before` が、現在の一覧に存在するはず）と食い違うエントリ（対象イベントが既に
 * 消えている／想定外に存在している）は安全にスキップし、他のエントリの適用は
 * 継続する。存在の有無のみを見る判定であり、値の内容までは比較しない
 * （presence-only）。削除の取り消し・作成のやり直しで新たに書き込まれるイベントは
 * {@link EventChangeEntry.index} の位置に挿入される（省略時は末尾）。
 * 入力の `events` 配列・各イベントは変更しない（純粋関数）。
 *
 * 何件のエントリが実際に適用されたかを知りたい場合は
 * {@link applyEventChangeEntriesWithApplied} を使う。
 *
 * @remarks
 * presence-only のため、同じ `id` のイベントが `changes` 記録後に（この関数を経由しない
 * `setEvents` 等の外部同期で）別の内容へ更新されていても、その `id` は「存在する」と
 * 判定されて記録時のスナップショット（`before` / `after`）で丸ごと上書きされる。
 * すなわち外部同期で変わったフィールドは巻き戻る。外部同期を履歴と混在させる場合は、
 * 同期の直後に履歴を破棄すること（{@link CalendarEventHistory.clear}）。
 *
 * @param events - 現在のイベント一覧
 * @param changes - 適用する変更（{@link EventChangeEntry} の一覧）
 * @param direction - 適用する方向
 * @returns 適用後のイベント一覧
 * @example
 * ```ts
 * // undo: 直前の変更を取り消す
 * const reverted = applyEventChangeEntries(events, changes, 'before');
 * // redo: 取り消した変更をやり直す
 * const reapplied = applyEventChangeEntries(reverted, changes, 'after');
 * ```
 */
export function applyEventChangeEntries(
  events: readonly CalendarEvent[],
  changes: readonly EventChangeEntry[],
  direction: EventChangeDirection,
): CalendarEvent[] {
  return applyEventChangeEntriesCore(events, changes, direction).events;
}

/**
 * {@link applyEventChangeEntries} の拡張版。適用後のイベント一覧に加えて、
 * 実際に適用された（ドリフトによりスキップされなかった）エントリの一覧も返す。
 *
 * 1 件も適用されなかったかどうか（`applied.length === 0`）の判定と、逆方向の
 * 再適用（undo ↔ redo）に `applied` を使う（{@link createEventHistory} の実装を
 * 参照）。`applied` の各エントリは {@link EventChangeEntry.index} が適用時点の
 * 実際の位置へ更新されているため、そのまま逆方向へ適用すれば適用直前の並び順を
 * 復元できる。
 *
 * @param events - 現在のイベント一覧
 * @param changes - 適用する変更（{@link EventChangeEntry} の一覧）
 * @param direction - 適用する方向
 * @returns 適用後のイベント一覧と、実際に適用されたエントリの一覧
 */
export function applyEventChangeEntriesWithApplied(
  events: readonly CalendarEvent[],
  changes: readonly EventChangeEntry[],
  direction: EventChangeDirection,
): EventChangeApplyResult {
  return applyEventChangeEntriesCore(events, changes, direction);
}
