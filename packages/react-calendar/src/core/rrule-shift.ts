/**
 * @packageDocumentation
 * 繰り返しの開始日時の移動に合わせた RRULE の書き換え。
 *
 * シリーズ全体・「これ以降」の開始日時を動かすと、開始日時を言い換えている RRULE の
 * 指定（`BYDAY=WE` の毎週水曜、`BYMONTHDAY=15` の毎月 15 日など）や、現地時刻で
 * 表された終了条件（`UNTIL`）が新しい開始と噛み合わなくなる。噛み合わないまま残すと、
 * 動かした先にオカレンスが現れない・最後のオカレンスが欠ける結果になるため、
 * 開始と同じだけ移動する。
 */

/** 1 日のミリ秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** RRULE の曜日コード（月曜始まり。RFC 5545 の既定の週の開始に合わせる）。 */
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** `Date#getUTCDay()`（日曜 = 0）から {@link WEEKDAY_CODES} の添字（月曜 = 0）への変換。 */
function weekdayIndexOf(wallMs: number): number {
  return (new Date(wallMs).getUTCDay() + 6) % 7;
}

/** 曜日コードの添字（月曜 = 0）。曜日コードでなければ `-1`。 */
function weekdayCodeIndex(code: string): number {
  return WEEKDAY_CODES.findIndex((candidate) => candidate === code);
}

/** 現地時刻（UTC ミリ秒として組み立てたもの）の日の開始。 */
function floorToDay(wallMs: number): number {
  return Math.floor(wallMs / DAY_MS) * DAY_MS;
}

/** 月の中で何回目のその曜日か（1〜5）。 */
function nthWeekdayOfMonth(wallMs: number): number {
  return Math.ceil(new Date(wallMs).getUTCDate() / 7);
}

/** その月の最後のその曜日か（7 日後が翌月になるか）。 */
function isLastWeekdayOfMonth(wallMs: number): boolean {
  return new Date(wallMs + 7 * DAY_MS).getUTCMonth() !== new Date(wallMs).getUTCMonth();
}

/** 2 桁にゼロ埋めする。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `UNTIL` の値（`YYYYMMDD` または `YYYYMMDDTHHMMSS[Z]`）。 */
const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/i;

/** 第 N 曜日の指定（`2TU` / `-1FR` / `+1MO`）。 */
const ORDINAL_WEEKDAY_PATTERN = /^([+-]?\d)([A-Z]{2})$/;

/** `UNTIL` の値を移動する。解釈できない値はそのまま返す。 */
function shiftUntil(value: string, wallDeltaMs: number, dayDelta: number): string {
  const match = UNTIL_PATTERN.exec(value);
  if (match === null) {
    return value;
  }
  const [, year, month, day, hours, minutes, seconds, zSuffix] = match;
  const base = new Date(0);
  base.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (hours === undefined) {
    // 日付のみの UNTIL は開始日の移動日数だけ移動する
    base.setUTCHours(0, 0, 0, 0);
    const shifted = new Date(base.getTime() + dayDelta * DAY_MS);
    return formatUntilDate(shifted);
  }
  base.setUTCHours(Number(hours), Number(minutes), Number(seconds), 0);
  const shifted = new Date(base.getTime() + wallDeltaMs);
  const time = `${pad2(shifted.getUTCHours())}${pad2(shifted.getUTCMinutes())}${pad2(shifted.getUTCSeconds())}`;
  return `${formatUntilDate(shifted)}T${time}${zSuffix ?? ''}`;
}

/** `UNTIL` の日付部分（`YYYYMMDD`）を作る。 */
function formatUntilDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return `${year}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

/**
 * 曜日コードだけの `BYDAY`（`MO,WE`）を `dayDelta` 日ずらす。
 * 第 N 曜日の指定を含む場合は `null`（この関数の対象外）。
 */
function rotateWeekdays(value: string, dayDelta: number): string | null {
  const indexes: number[] = [];
  for (const token of value.toUpperCase().split(',')) {
    const index = weekdayCodeIndex(token);
    if (index < 0) {
      return null;
    }
    indexes.push((((index + dayDelta) % 7) + 7) % 7);
  }
  const unique = [...new Set(indexes)].sort((a, b) => a - b);
  return unique.map((index) => WEEKDAY_CODES[index]).join(',');
}

/**
 * 開始が表す第 N 曜日の `BYDAY`（`2TU` / `-1FR`）を、移動先の第 N 曜日に書き換える。
 * 単一の第 N 曜日でない、または開始と一致しない指定は `null`（この関数の対象外）。
 */
function rewriteOrdinalWeekday(value: string, oldWallMs: number, newWallMs: number): string | null {
  const match = ORDINAL_WEEKDAY_PATTERN.exec(value.toUpperCase());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const ordinal = Number(match[1]);
  const matchesOldStart =
    weekdayCodeIndex(match[2]) === weekdayIndexOf(oldWallMs) &&
    (ordinal === -1 ? isLastWeekdayOfMonth(oldWallMs) : ordinal === nthWeekdayOfMonth(oldWallMs));
  if (!matchesOldStart) {
    return null;
  }
  const nth = nthWeekdayOfMonth(newWallMs);
  // 最終曜日の指定は移動先も最終週なら保つ。第 5 曜日は存在しない月があるため最終曜日にする
  const nextOrdinal = (ordinal === -1 && isLastWeekdayOfMonth(newWallMs)) || nth === 5 ? -1 : nth;
  return `${nextOrdinal}${WEEKDAY_CODES[weekdayIndexOf(newWallMs)]}`;
}

/**
 * 繰り返しの開始日時を動かしたときに、RRULE を新しい開始に合わせて書き換える。
 *
 * 引数の開始日時は、イベントのタイムゾーンの現地時刻の成分を UTC のミリ秒として
 * 組み立てた値（終日は日付の 0:00）で渡す。次の指定を開始と同じだけ移動する:
 *
 * - `UNTIL` — 日時形式は現地時刻差、日付のみの形式は開始日の移動日数
 * - 曜日コードだけの `BYDAY`（`BYSETPOS` を伴わない、`FREQ=DAILY` 以外）— 各曜日を
 *   開始日の移動日数だけずらす
 * - 開始が表す第 N 曜日の `BYDAY`（単一値。`2TU` / `-1FR`）— 移動先の第 N 曜日
 * - 開始の日と一致する単一の正の `BYMONTHDAY`、開始の月と一致する単一の `BYMONTH` —
 *   移動先の日・月
 *
 * 開始と一致しない指定・複数値の `BYMONTHDAY` など、開始の言い換えではない指定は変えない。
 *
 * @param rrule - RRULE 文字列（`'RRULE:'` プレフィックスの有無・大文字小文字は問わない）
 * @param oldStartWallMs - 移動前の開始の現地時刻（UTC ミリ秒として組み立てた値）
 * @param newStartWallMs - 移動後の開始の現地時刻（同上）
 * @returns 書き換えた RRULE 文字列。変更がなければ `rrule` をそのまま返す
 * @example
 * ```ts
 * // 毎週水曜 9:00 の予定を金曜 10:00 へ動かす
 * shiftRRuleForStart(
 *   'FREQ=WEEKLY;BYDAY=WE;UNTIL=20260729T090000Z',
 *   Date.UTC(2026, 6, 8, 9),
 *   Date.UTC(2026, 6, 10, 10),
 * ); // => 'FREQ=WEEKLY;BYDAY=FR;UNTIL=20260731T100000Z'
 * ```
 */
export function shiftRRuleForStart(
  rrule: string,
  oldStartWallMs: number,
  newStartWallMs: number,
): string {
  const wallDeltaMs = newStartWallMs - oldStartWallMs;
  if (wallDeltaMs === 0) {
    return rrule;
  }
  const dayDelta = Math.round((floorToDay(newStartWallMs) - floorToDay(oldStartWallMs)) / DAY_MS);
  const prefixMatch = /^RRULE:/i.exec(rrule);
  const prefix = prefixMatch === null ? '' : prefixMatch[0];
  const parts = rrule
    .slice(prefix.length)
    .split(';')
    .map((part) => {
      const separator = part.indexOf('=');
      return separator < 0
        ? { name: part, key: part.toUpperCase(), value: undefined }
        : {
            name: part.slice(0, separator),
            key: part.slice(0, separator).toUpperCase(),
            value: part.slice(separator + 1),
          };
    });
  const partValue = (key: string): string | undefined =>
    parts.find((part) => part.key === key)?.value;
  const frequency = partValue('FREQ')?.toUpperCase();
  const hasSetPos = partValue('BYSETPOS') !== undefined;
  const byDay = partValue('BYDAY');
  const byMonthDay = partValue('BYMONTHDAY');
  const oldDate = new Date(oldStartWallMs);
  const newDate = new Date(newStartWallMs);

  // 書き換え後の値（キー → 値）。対象外のキーは載せない
  const next = new Map<string, string>();
  const until = partValue('UNTIL');
  if (until !== undefined) {
    next.set('UNTIL', shiftUntil(until, wallDeltaMs, dayDelta));
  }
  if (dayDelta !== 0 && !hasSetPos && frequency !== 'DAILY') {
    let ordinalRewritten = false;
    if (byDay !== undefined) {
      const rotated = dayDelta % 7 === 0 ? null : rotateWeekdays(byDay, dayDelta);
      if (rotated !== null) {
        next.set('BYDAY', rotated);
      } else if (byMonthDay === undefined) {
        const rewritten = rewriteOrdinalWeekday(byDay, oldStartWallMs, newStartWallMs);
        if (rewritten !== null) {
          next.set('BYDAY', rewritten);
          ordinalRewritten = true;
        }
      }
    }
    const monthDayRewritten =
      byDay === undefined &&
      byMonthDay !== undefined &&
      /^\d+$/.test(byMonthDay) &&
      Number(byMonthDay) === oldDate.getUTCDate();
    if (monthDayRewritten) {
      next.set('BYMONTHDAY', String(newDate.getUTCDate()));
    }
    // BYMONTH は、日の指定（BYMONTHDAY / 第 N 曜日）を開始に合わせて書き換えた場合、
    // または日の指定がない場合に限って、開始の月に合わせる
    const byMonth = partValue('BYMONTH');
    const dayPartFollowsStart =
      monthDayRewritten || ordinalRewritten || (byDay === undefined && byMonthDay === undefined);
    if (
      byMonth !== undefined &&
      dayPartFollowsStart &&
      /^\d+$/.test(byMonth) &&
      Number(byMonth) === oldDate.getUTCMonth() + 1
    ) {
      next.set('BYMONTH', String(newDate.getUTCMonth() + 1));
    }
  }

  let changed = false;
  const rebuilt = parts.map((part) => {
    const replacement = next.get(part.key);
    if (replacement === undefined || replacement === part.value) {
      return part.value === undefined ? part.name : `${part.name}=${part.value}`;
    }
    changed = true;
    return `${part.name}=${replacement}`;
  });
  return changed ? `${prefix}${rebuilt.join(';')}` : rrule;
}
