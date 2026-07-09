/**
 * @packageDocumentation
 * 繰り返しルール（RFC 5545 RRULE）の展開。
 *
 * `rrule` パッケージをラップし、タイムゾーンを考慮した繰り返し展開を提供する。
 *
 * ## タイムゾーンの扱い（重要）
 *
 * 繰り返しは「イベントのタイムゾーンにおける現地時刻」を維持して展開される。
 * 例えば `America/New_York` の毎日 9:00 の予定は、DST の切り替えを跨いでも
 * 常に現地 9:00 に発生する（絶対時刻としての UTC オフセットは変わる）。
 *
 * 実装には rrule の「fake-UTC」手法を用いる: dtstart をイベント TZ の現地時刻の成分で
 * `Date.UTC` に載せ替えて RRule に渡し、得られた日時の UTC 成分を現地時刻として
 * イベント TZ の絶対時刻に戻す。
 */

import type { Options } from 'rrule';
import { RRule } from 'rrule';
import { fromWallClock, getWallClock } from './timezone';
import type { DateRange, TimeZoneId } from './types';

/** RRULE 文字列のプレフィックス。 */
const RRULE_PREFIX = 'RRULE:';

/**
 * fake-UTC 空間と絶対時刻のずれを安全に覆う余白（ミリ秒）。
 *
 * fake-UTC 変換は現地時刻ベースのため、DST 切替の前後では絶対時刻の順序と
 * fake-UTC の順序が最大でオフセット差の分だけずれ得る。境界での取りこぼしを
 * 防ぐため、rrule への問い合わせ範囲をこの余白だけ広げ、最終的に絶対時刻で
 * 厳密に再フィルタする。
 */
const FAKE_UTC_MARGIN_MS = 25 * 60 * 60 * 1000;

/** `'RRULE:'` プレフィックスがあれば剥がす。 */
function stripRRulePrefix(text: string): string {
  return text.startsWith(RRULE_PREFIX) ? text.slice(RRULE_PREFIX.length) : text;
}

/** 例外からメッセージ文字列を取り出す。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 絶対時刻を fake-UTC 日時に変換する。
 *
 * イベント TZ における現地時刻の成分を、そのまま UTC の成分として持つ `Date` を作る。
 * rrule は UTC 成分だけを見て規則を評価するため、この日時を渡すことで
 * 「現地時刻基準の繰り返し」を計算できる。
 * ミリ秒も往復させる（{@link fromFakeUTC} と対で使う）。ミリ秒を落とすと
 * dtstart 自身が最初のオカレンスとして一致しなくなったり、ミリ秒付き exdate の
 * 一致判定が常に失敗したりするため。
 */
function toFakeUTC(date: Date, timeZone: TimeZoneId): Date {
  const wall = getWallClock(date, timeZone);
  return new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hours,
      wall.minutes,
      wall.seconds,
      wall.milliseconds,
    ),
  );
}

/**
 * fake-UTC 日時を絶対時刻に戻す。
 *
 * fake-UTC の UTC 成分をイベント TZ の現地時刻と見なして絶対時刻を再構築する。
 */
function fromFakeUTC(fake: Date, timeZone: TimeZoneId): Date {
  return fromWallClock(
    {
      year: fake.getUTCFullYear(),
      month: fake.getUTCMonth() + 1,
      day: fake.getUTCDate(),
      hours: fake.getUTCHours(),
      minutes: fake.getUTCMinutes(),
      seconds: fake.getUTCSeconds(),
      milliseconds: fake.getUTCMilliseconds(),
    },
    timeZone,
  );
}

/**
 * RRULE 文字列をパース・検証して rrule のオプションに変換する。
 *
 * `RRule.parseString` は FREQ の欠落や値の不正（`FREQ=BOGUS` など）を例外に
 * しないため、ここで明示的に検証する。BYDAY の不正値などは `new RRule` の
 * 構築時に検出されるので、試験的に構築して検証する。
 */
function parseRRuleOptions(rrule: string): Partial<Options> {
  const body = stripRRulePrefix(rrule.trim());
  let parsed: Partial<Options>;
  try {
    parsed = RRule.parseString(body);
  } catch (cause) {
    throw new Error(`不正な RRULE です: '${rrule}'（${errorMessage(cause)}）`);
  }
  if (typeof parsed.freq !== 'number' || !(parsed.freq in RRule.FREQUENCIES)) {
    throw new Error(`不正な RRULE です: '${rrule}'（FREQ が指定されていないか値が不正です）`);
  }
  // DTSTART 行や TZID が混入していても、このモジュールでは dtstart を
  // 引数から与えるため無視する（RRULE 本体のみを扱う）
  delete parsed.dtstart;
  delete parsed.tzid;
  try {
    // BYDAY の不正値（例: 'BYDAY=mo'）などは RRule の構築時に例外になる
    void new RRule({ ...parsed });
  } catch (cause) {
    throw new Error(`不正な RRULE です: '${rrule}'（${errorMessage(cause)}）`);
  }
  return parsed;
}

/** 検証済みの RRULE と fake-UTC 化した dtstart から RRule インスタンスを構築する。 */
function buildFakeUTCRule(rrule: string, dtstart: Date, timeZone: TimeZoneId): RRule {
  const parsed = parseRRuleOptions(rrule);
  return new RRule({ ...parsed, dtstart: toFakeUTC(dtstart, timeZone) });
}

/**
 * RRULE 文字列を検証し、正規化された本体（`FREQ=...` 形式）を返す。
 *
 * `'RRULE:'` プレフィックスの有無を吸収する。パースできない場合は例外を投げる。
 *
 * @param rrule - RRULE 文字列（`'FREQ=WEEKLY;BYDAY=MO'` または `'RRULE:FREQ=WEEKLY;BYDAY=MO'`）
 * @returns 正規化された RRULE 本体
 * @throws 不正な RRULE の場合は `Error`（メッセージに原因を含む）
 * @example
 * ```ts
 * normalizeRRuleString('RRULE:FREQ=WEEKLY;BYDAY=MO,WE'); // => 'FREQ=WEEKLY;BYDAY=MO,WE'
 * normalizeRRuleString('freq=daily;count=3'); // => 'FREQ=DAILY;COUNT=3'
 * normalizeRRuleString('FOO=BAR'); // => Error を投げる
 * ```
 */
export function normalizeRRuleString(rrule: string): string {
  const parsed = parseRRuleOptions(rrule);
  return stripRRulePrefix(RRule.optionsToString(parsed));
}

/**
 * 繰り返しを展開し、指定範囲内に開始するオカレンスの開始時刻（絶対時刻）を返す。
 *
 * - `dtstart` 自身も繰り返しの最初のオカレンスとして扱われる（RRULE の仕様どおり）
 * - `COUNT` / `UNTIL` を尊重する（`UNTIL` はイベント TZ の現地時刻として解釈される）
 * - `exdates` に含まれる開始時刻のオカレンスは除外する（ミリ秒単位の一致で判定）
 * - オカレンスは昇順で返す
 * - 春の DST 切替で存在しない現地時刻（例: `BYHOUR=2,3` の 2:30 と 3:30 が
 *   ともに 3:30 に繰り上がる）により複数の候補が同一絶対時刻に一致した
 *   場合は、重複を除いて 1 件にまとめる（オカレンスの一意キーの衝突を防ぐため）
 *
 * @param params.rrule - RRULE 文字列
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン（現地時刻の維持の基準）
 * @param params.exdates - 除外するオカレンスの開始時刻
 * @param params.range - 展開範囲（`end` 排他）。範囲内に **開始** するオカレンスのみ返す
 * @returns オカレンスの開始時刻の昇順配列
 * @throws 不正な RRULE の場合は `Error`
 * @example
 * ```ts
 * // America/New_York の毎日 9:00 は DST を跨いでも現地 9:00 に発生する
 * expandRecurrence({
 *   rrule: 'FREQ=DAILY',
 *   dtstart: new Date('2026-03-07T14:00:00Z'), // 3/7 9:00 EST
 *   timeZone: 'America/New_York',
 *   range: { start: new Date('2026-03-07T14:00:00Z'), end: new Date('2026-03-09T04:00:00Z') },
 * });
 * // => [2026-03-07T14:00:00.000Z, 2026-03-08T13:00:00.000Z]（切替後は 13:00Z = 9:00 EDT）
 * ```
 */
export function expandRecurrence(params: {
  rrule: string;
  dtstart: Date;
  timeZone: TimeZoneId;
  exdates?: readonly Date[];
  range: DateRange;
}): Date[] {
  const { rrule, dtstart, timeZone, exdates = [], range } = params;
  const rule = buildFakeUTCRule(rrule, dtstart, timeZone);
  if (range.end.getTime() <= range.start.getTime()) {
    return [];
  }
  // 範囲境界も現地時刻→fake-UTC に変換する。DST による順序ずれの取りこぼしを
  // 防ぐため余白を付けて広めに問い合わせ、絶対時刻で厳密に再フィルタする
  const fakeStart = new Date(toFakeUTC(range.start, timeZone).getTime() - FAKE_UTC_MARGIN_MS);
  const fakeEnd = new Date(toFakeUTC(range.end, timeZone).getTime() + FAKE_UTC_MARGIN_MS);
  const excludedTimes = new Set(exdates.map((exdate) => exdate.getTime()));

  const occurrences: Date[] = [];
  for (const fake of rule.between(fakeStart, fakeEnd, true)) {
    const instant = fromFakeUTC(fake, timeZone);
    const time = instant.getTime();
    // [range.start, range.end) — end は排他
    if (time < range.start.getTime() || time >= range.end.getTime()) {
      continue;
    }
    if (excludedTimes.has(time)) {
      continue;
    }
    occurrences.push(instant);
  }
  // DST の秋切替（現地時刻が巻き戻る）では fake-UTC の昇順と絶対時刻の昇順が
  // 局所的に入れ替わり得るため、絶対時刻で並べ直して昇順を保証する
  occurrences.sort((a, b) => a.getTime() - b.getTime());
  // 春の DST 切替で存在しない現地時刻が繰り上がると、別の BY* 候補と
  // 絶対時刻が一致することがある（例: BYHOUR=2,3;BYMINUTE=30 で 2:30 が
  // 3:30 に繰り上がる）。ソート済みなので隣接比較だけで重複を除去できる
  const deduped: Date[] = [];
  for (const occurrence of occurrences) {
    const last = deduped.at(-1);
    if (last === undefined || last.getTime() !== occurrence.getTime()) {
      deduped.push(occurrence);
    }
  }
  return deduped;
}

/**
 * 指定時刻より前の最後のオカレンスの開始時刻を返す。
 *
 * 「これ以降のすべての予定」を編集・削除する際、元の繰り返しを直前のオカレンスで
 * 打ち切る（UNTIL を設定する）ために使用する。
 *
 * @param params.rrule - RRULE 文字列
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン
 * @param params.before - この時刻より前（排他）のオカレンスを探す
 * @returns 直前のオカレンスの開始時刻。存在しなければ `null`
 * @throws 不正な RRULE の場合は `Error`
 * @example
 * ```ts
 * // 毎日 9:00（東京）の繰り返しで、7/4 9:00 のオカレンス「より前」の最後のオカレンス
 * previousOccurrenceStart({
 *   rrule: 'FREQ=DAILY',
 *   dtstart: new Date('2026-07-01T00:00:00Z'), // 東京 7/1 9:00
 *   timeZone: 'Asia/Tokyo',
 *   before: new Date('2026-07-04T00:00:00Z'), // 東京 7/4 9:00（排他）
 * });
 * // => 2026-07-03T00:00:00.000Z（東京 7/3 9:00）
 * ```
 */
export function previousOccurrenceStart(params: {
  rrule: string;
  dtstart: Date;
  timeZone: TimeZoneId;
  before: Date;
}): Date | null {
  const { rrule, dtstart, timeZone, before } = params;
  const rule = buildFakeUTCRule(rrule, dtstart, timeZone);
  const fakeBefore = toFakeUTC(before, timeZone);
  // fake-UTC 空間では before 前後のオカレンスの順序が絶対時刻とずれ得るため、
  // before の近傍を余白付きで列挙し、絶対時刻で before 未満の最大値を選ぶ
  const windowStart = new Date(fakeBefore.getTime() - FAKE_UTC_MARGIN_MS);
  const windowEnd = new Date(fakeBefore.getTime() + FAKE_UTC_MARGIN_MS);
  const candidates = rule.between(windowStart, windowEnd, true);
  // 近傍にオカレンスがない疎なルール（例: 年次）に備え、探索範囲より前の最後のオカレンスも候補に加える
  const beforeWindow = rule.before(windowStart, false);
  if (beforeWindow !== null) {
    candidates.push(beforeWindow);
  }

  let latest: Date | null = null;
  for (const fake of candidates) {
    const instant = fromFakeUTC(fake, timeZone);
    if (instant.getTime() >= before.getTime()) {
      continue; // before ちょうどのオカレンスは含まない（排他）
    }
    if (latest === null || instant.getTime() > latest.getTime()) {
      latest = instant;
    }
  }
  return latest;
}

/**
 * fake-UTC 時刻を、直後の整数秒（ミリ秒 0）へ切り上げる。
 *
 * RRULE の `UNTIL` は秒精度までしか表現できない（`RRule.optionsToString` は
 * ミリ秒を切り捨てて文字列化する）。ミリ秒を持つオカレンスをちょうど含めるために
 * そのオカレンスの fake-UTC 時刻をそのまま `UNTIL` にすると、文字列化の際にミリ秒が
 * 切り捨てられて「UNTIL がそのオカレンス自身の時刻未満になり、そのオカレンスが除外される」結果になる。
 * 直後の整数秒に切り上げることで、このオカレンスを含みつつ次のオカレンス（fake-UTC 空間で
 * 常に 1 秒以上先）は含まない境界にできる。
 */
function ceilFakeUTCToWholeSecond(fake: Date): Date {
  const remainderMs = fake.getTime() % 1000;
  return remainderMs === 0 ? fake : new Date(fake.getTime() + (1000 - remainderMs));
}

/**
 * 繰り返しルールを「`until` より前（排他）で終了する」ように打ち切った
 * 新しい RRULE 文字列を返す。
 *
 * - 元ルールに `COUNT` がある場合は削除し、`UNTIL` に置き換える
 * - `UNTIL` は {@link previousOccurrenceStart} で求めた `until` 直前のオカレンス
 *   （絶対時刻基準）の fake-UTC 時刻にする。until-1ms を直接使わないのは、
 *   (1) そのオカレンスがミリ秒を持つ場合に秒精度への切り捨てで消えてしまう、
 *   (2) DST の曖昧時間帯では fake-UTC の順序と絶対時刻の順序がずれ、
 *   直前のオカレンスを取り違える、という 2 つの問題があるため
 * - 直前のオカレンスが存在しない場合（`until` が最初のオカレンス以前）は、
 *   従来どおり `until` の fake-UTC 時刻の 1 ミリ秒前にフォールバックする
 *   （常に空になる打ち切りを表現できればよく、直前のオカレンスがないため
 *   基準にできる絶対時刻もない）
 *
 * @param params.rrule - 元の RRULE 文字列
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン
 * @param params.until - この時刻以降（含む）のオカレンスを打ち切る
 * @returns 打ち切り後の RRULE 本体文字列
 * @throws 不正な RRULE の場合は `Error`
 * @example
 * ```ts
 * truncateRRule({
 *   rrule: 'FREQ=DAILY;COUNT=10',
 *   dtstart: new Date('2026-07-01T00:00:00Z'), // 東京 7/1 9:00
 *   timeZone: 'Asia/Tokyo',
 *   until: new Date('2026-07-05T00:00:00Z'), // 東京 7/5 9:00（5 回目のオカレンス）
 * });
 * // => 'FREQ=DAILY;UNTIL=20260704T090000Z'（直前のオカレンス＝4 回目。展開すると 7/1〜7/4 の 4 回になる）
 * ```
 */
export function truncateRRule(params: {
  rrule: string;
  dtstart: Date;
  timeZone: TimeZoneId;
  until: Date;
}): string {
  const { rrule, dtstart, timeZone, until } = params;
  const parsed = parseRRuleOptions(rrule);
  // COUNT と UNTIL は排他（RFC 5545）。打ち切りは UNTIL で表現する
  delete parsed.count;
  const previous = previousOccurrenceStart({ rrule, dtstart, timeZone, before: until });
  parsed.until =
    previous !== null
      ? ceilFakeUTCToWholeSecond(toFakeUTC(previous, timeZone))
      : // 直前のオカレンスが存在しない場合は until の 1ms 前にフォールバック
        // （until 以前にオカレンスがないため、これだけで打ち切り後は必ず空になる）
        new Date(toFakeUTC(until, timeZone).getTime() - 1);
  return stripRRulePrefix(RRule.optionsToString(parsed));
}

/**
 * `dtstart` から `before`（排他）までのオカレンス数を数える。
 *
 * 「これ以降」分割時に、新しいシリーズへ引き継ぐ `COUNT` の残数を
 * 計算するために使用する。
 *
 * @param params.rrule - RRULE 文字列
 * @param params.dtstart - 繰り返しの起点（絶対時刻）
 * @param params.timeZone - イベントのタイムゾーン
 * @param params.before - この時刻より前（排他）のオカレンスを数える
 * @throws 不正な RRULE の場合は `Error`
 * @example
 * ```ts
 * countOccurrencesBefore({
 *   rrule: 'FREQ=DAILY',
 *   dtstart: new Date('2026-07-01T00:00:00Z'), // 東京 7/1 9:00
 *   timeZone: 'Asia/Tokyo',
 *   before: new Date('2026-07-04T00:00:00Z'), // 東京 7/4 9:00（排他）
 * });
 * // => 3（7/1・7/2・7/3 のオカレンス）
 * ```
 */
export function countOccurrencesBefore(params: {
  rrule: string;
  dtstart: Date;
  timeZone: TimeZoneId;
  before: Date;
}): number {
  const { rrule, dtstart, timeZone, before } = params;
  const rule = buildFakeUTCRule(rrule, dtstart, timeZone);
  const fakeDtstart = toFakeUTC(dtstart, timeZone);
  // fake-UTC 空間の順序ずれに備えて余白付きで列挙し、絶対時刻で before 未満のみ数える
  const fakeLimit = new Date(toFakeUTC(before, timeZone).getTime() + FAKE_UTC_MARGIN_MS);
  if (fakeLimit.getTime() < fakeDtstart.getTime()) {
    return 0;
  }
  let count = 0;
  for (const fake of rule.between(fakeDtstart, fakeLimit, true)) {
    if (fromFakeUTC(fake, timeZone).getTime() < before.getTime()) {
      count += 1;
    }
  }
  return count;
}
