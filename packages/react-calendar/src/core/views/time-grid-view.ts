/**
 * @packageDocumentation
 * 週/日ビュー（時間グリッド）のビューモデル構築。
 *
 * オカレンスを「終日行」（帯）と「時間グリッド」（縦配置）に振り分け、
 * 日ごとに重なりレイアウトを適用する。
 */

import {
  eachDayInRange,
  isoWeekNumberOfWeek,
  rangesOverlap,
  startOfWeekInZone,
} from '../date-utils';
import type { BandItemInput } from '../layout/band-layout';
import { layoutBandItems } from '../layout/band-layout';
import type { TimeGridItemInput } from '../layout/time-grid-layout';
import { layoutTimeGridItems } from '../layout/time-grid-layout';
import {
  addDaysInZone,
  addMinutesInZone,
  dateKeyInZone,
  formatSlotLabel,
  isSameDayInZone,
  minutesOfDayInZone,
  parseSlotBoundaryTime,
  parseTimeOfDay,
  startOfDayInZone,
  weekdayInZone,
} from '../timezone';
import type {
  BusinessHourSlot,
  BusinessHoursRule,
  EventOccurrence,
  EventSegment,
  PositionedOccurrence,
  TimeAxis,
  TimeGridDay,
  TimeGridViewModel,
  TimeSlot,
  TimeZoneId,
  Weekday,
} from '../types';

/** 1 日の分（24:00 = 1440 分）。DST 日でも表示グリッドは 24 時間として扱う。 */
const MINUTES_PER_DAY = 1440;

/** 時間指定イベントを終日行へ振り分ける最小継続時間（24 時間、ミリ秒）。 */
const ALL_DAY_ROW_MIN_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * オカレンスを終日行（帯）に振り分けるべきかを判定する。
 *
 * 振り分けルール:
 * - `allDay: true` のオカレンスは常に終日行
 * - 時間指定イベントでも、表示タイムゾーンで複数日にまたがり
 *   （`dateKeyInZone(start)` と「`end` の 1ms 前」の日付キーが異なる）、
 *   かつ 24 時間以上続くオカレンスは終日行に入る
 * - 24 時間未満で日をまたぐオカレンス（例: 22:00〜翌 2:00）は時間グリッド側で
 *   日ごとに分割表示する（{@link buildDayItems} が
 *   `continuesBefore` / `continuesAfter` を立てて 0 / 1440 分にクランプする）
 * - 長さ 0（以下）のオカレンスは単日扱い（時間グリッド）
 *
 * @param occurrence - 判定するオカレンス
 * @param timeZone - 表示タイムゾーン
 * @returns 終日行に入れるべきなら `true`
 *
 * @remarks リソースビュー（`resource-view.ts`）も同じ振り分け規則を使うため
 * モジュール間で共有する（`index.ts` からは公開しない）。
 */
export function belongsToAllDayRow(occurrence: EventOccurrence, timeZone: TimeZoneId): boolean {
  if (occurrence.allDay) {
    return true;
  }
  const durationMs = occurrence.end.getTime() - occurrence.start.getTime();
  if (durationMs < ALL_DAY_ROW_MIN_DURATION_MS) {
    return false;
  }
  // end は排他的なので、1ms 前の時点が属する日と開始日を比較して複数日判定する
  return (
    dateKeyInZone(occurrence.start, timeZone) !==
    dateKeyInZone(new Date(occurrence.end.getTime() - 1), timeZone)
  );
}

/**
 * 終日行のセグメントを帯レイアウト（月ビューと同じ方式）で構築する。
 *
 * 表示範囲全体（週なら 7 列、日なら 1 列）を 1 つの帯として扱い、
 * {@link layoutBandItems} でレーンを割り当てる。`allDayMaxEvents` を指定すると
 * レーン数がその値までに制限され、超過したセグメントは `hidden: true` になり
 * 列ごとのあふれ件数（`overflowByCol`）に計上される（省略時は無制限）。
 *
 * `hiddenWeekdays` により一部の列が非表示の場合、`columnIndexByKey` で得た
 * 「元の列」インデックスを `visibleColByOrigCol` で「可視列」インデックスへ
 * 変換してからレイアウトする（月ビューと同じ規則）。非表示曜日を跨ぐオカレンスは
 * 可視列上で連続した 1 本のセグメントになり、可視列を 1 つも含まないオカレンス
 * （非表示曜日にしか存在しないオカレンス）はセグメントを生成しない。
 *
 * @param occurrences - 終日行に振り分けられたオカレンス
 * @param params.rangeStart - 表示範囲の開始（最初の日の 0:00）
 * @param params.rangeEnd - 表示範囲の終了（排他）
 * @param params.columnIndexByKey - 日付キー → 元の列番号（非表示曜日を含む全列）の索引
 * @param params.visibleColByOrigCol - 元の列番号 → 可視列インデックスの対応表
 * @param params.columnCount - 可視列数（結果の `startCol` / `span` はこの座標系）
 * @param params.timeZone - 表示タイムゾーン
 * @param params.allDayMaxEvents - 表示する最大レーン数
 *   （{@link CalendarOptions.allDayMaxEvents}）。省略時は無制限
 * @returns セグメント一覧・使用レーン数・可視列ごとのあふれ件数
 */
function buildAllDaySegments(
  occurrences: readonly EventOccurrence[],
  params: {
    rangeStart: Date;
    rangeEnd: Date;
    columnIndexByKey: ReadonlyMap<string, number>;
    visibleColByOrigCol: ReadonlyMap<number, number>;
    columnCount: number;
    timeZone: TimeZoneId;
    allDayMaxEvents?: number;
  },
): { segments: EventSegment[]; laneCount: number; overflowByCol: readonly number[] } {
  const {
    rangeStart,
    rangeEnd,
    columnIndexByKey,
    visibleColByOrigCol,
    columnCount,
    timeZone,
    allDayMaxEvents,
  } = params;

  const bandInputs: BandItemInput[] = [];
  const metas: {
    occurrence: EventOccurrence;
    startCol: number;
    span: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
  }[] = [];

  for (const occurrence of occurrences) {
    // 長さ 0 のオカレンスでも開始日 1 日分の帯として扱えるよう、終端を最低 1ms 確保する
    const effectiveEndMs = Math.max(occurrence.end.getTime(), occurrence.start.getTime() + 1);
    // 表示範囲と重ならないオカレンスは無視する（範囲展開済みの入力に対する防御）
    if (
      occurrence.start.getTime() >= rangeEnd.getTime() ||
      effectiveEndMs <= rangeStart.getTime()
    ) {
      continue;
    }
    const clampedStart = new Date(Math.max(occurrence.start.getTime(), rangeStart.getTime()));
    // 終端は排他的なので、1ms 前の時点が属する日が最終列になる
    const clampedLast = new Date(Math.min(effectiveEndMs, rangeEnd.getTime()) - 1);
    const origStartCol = columnIndexByKey.get(dateKeyInZone(clampedStart, timeZone));
    const origEndCol = columnIndexByKey.get(dateKeyInZone(clampedLast, timeZone));
    if (origStartCol === undefined || origEndCol === undefined) {
      // 表示範囲にクランプ済みのため必ず見つかるはずだが、防御的にスキップする
      continue;
    }

    // 元の列範囲のうち可視列のみを対象に startCol/span を求め直す
    let startCol: number | undefined;
    let endCol: number | undefined;
    for (let col = origStartCol; col <= origEndCol; col += 1) {
      const visibleCol = visibleColByOrigCol.get(col);
      if (visibleCol === undefined) {
        continue;
      }
      startCol ??= visibleCol;
      endCol = visibleCol;
    }
    if (startCol === undefined || endCol === undefined) {
      // 非表示曜日にしか存在しないオカレンスなのでセグメントを生成しない
      continue;
    }

    const span = endCol - startCol + 1;
    bandInputs.push({
      key: occurrence.key,
      startCol,
      span,
      sortStart: occurrence.start.getTime(),
      sortDuration: occurrence.end.getTime() - occurrence.start.getTime(),
    });
    metas.push({
      occurrence,
      startCol,
      span,
      continuesBefore: occurrence.start.getTime() < rangeStart.getTime(),
      continuesAfter: occurrence.end.getTime() > rangeEnd.getTime(),
    });
  }

  const layout = layoutBandItems(bandInputs, columnCount, allDayMaxEvents);
  const segments: EventSegment[] = metas.map((meta, index) => {
    // placements は入力と同数・同順のため index で対応付く（undefined は防御）
    const placement = layout.placements[index];
    return {
      occurrence: meta.occurrence,
      startCol: meta.startCol,
      span: meta.span,
      lane: placement?.lane ?? 0,
      continuesBefore: meta.continuesBefore,
      continuesAfter: meta.continuesAfter,
      hidden: placement?.hidden ?? false,
    };
  });

  return { segments, laneCount: layout.laneCount, overflowByCol: layout.overflowByCol };
}

/** 時間グリッド 1 日分の作業用エントリ。 */
interface GridEntry {
  /** 対応するオカレンス。 */
  occurrence: EventOccurrence;
  /** 日内での表示開始（分）。 */
  startMinutes: number;
  /** 日内での表示終了（分、排他）。 */
  endMinutes: number;
  /** オカレンスがこの日より前から続いているか。 */
  continuesBefore: boolean;
  /** オカレンスがこの日より後に続くか。 */
  continuesAfter: boolean;
}

/**
 * 時間グリッドのエントリの表示順を決める比較関数。
 * `startMinutes` 昇順 → 表示上の長さ降順 → `key` 辞書順。
 */
function compareGridEntries(a: GridEntry, b: GridEntry): number {
  if (a.startMinutes !== b.startMinutes) {
    return a.startMinutes - b.startMinutes;
  }
  const durationA = a.endMinutes - a.startMinutes;
  const durationB = b.endMinutes - b.startMinutes;
  if (durationA !== durationB) {
    return durationB - durationA;
  }
  if (a.occurrence.key < b.occurrence.key) {
    return -1;
  }
  if (a.occurrence.key > b.occurrence.key) {
    return 1;
  }
  return 0;
}

/**
 * 1 日分の時間グリッド配置を構築する。
 *
 * `[dayStart, dayEnd)` と重なるオカレンスについて:
 * - その日に始まるオカレンスは `minutesOfDayInZone(start)`（現地時刻基準）、
 *   前日から続くオカレンスは 0 分から表示し `continuesBefore` を立てる
 * - `end` が翌日 0:00 以降なら 1440 分（24:00）にクランプし、
 *   翌日 0:00 より後に続く場合は `continuesAfter` を立てる
 * - 長さ 0（以下）のオカレンスは開始時点の 1 点として単日扱いする
 *
 * `displayStartMinutes`/`displayEndMinutes`（表示時間帯、既定 0/1440）で追加のクランプを行う:
 * - 日境界クランプ後の区間が表示時間帯と重ならないオカレンスは結果に含めない
 * - 一部が重なる区間は表示時間帯内にクランプし、開始側がクランプされれば
 *   `continuesBefore`、終了側がクランプされれば `continuesAfter` を追加で立てる
 *   （日境界によるクランプと OR で合成される）
 * - 長さ 0（点）のオカレンスはクランプせず、表示時間帯内（`displayStartMinutes` 以上
 *   `displayEndMinutes` 未満）にあるかどうかの二値判定のみ行う
 *
 * 重なりの横並びは {@link layoutTimeGridItems}（既定の `minSlotMinutes`）で計算する。
 *
 * @param occurrences - 時間グリッドに振り分けられたオカレンス
 * @param params.dayStart - 対象日の 0:00（絶対時刻）
 * @param params.dayEnd - 翌日の 0:00（絶対時刻、排他）
 * @param params.timeZone - 表示タイムゾーン
 * @param params.displayStartMinutes - 表示時間帯の開始（分）。省略時は `0`
 * @param params.displayEndMinutes - 表示時間帯の終了（分、排他的）。省略時は `1440`
 * @returns 表示順（開始分昇順 → 長い方が先 → key）に並んだ配置済みオカレンス
 *
 * @remarks リソースビュー（`resource-view.ts`）も「列ごとに 1 日分を配置する」
 * 同じ計算を使うためモジュール間で共有する（`index.ts` からは公開しない）。
 */
export function buildDayItems(
  occurrences: readonly EventOccurrence[],
  params: {
    dayStart: Date;
    dayEnd: Date;
    timeZone: TimeZoneId;
    displayStartMinutes?: number;
    displayEndMinutes?: number;
  },
): PositionedOccurrence[] {
  const {
    dayStart,
    dayEnd,
    timeZone,
    displayStartMinutes = 0,
    displayEndMinutes = MINUTES_PER_DAY,
  } = params;
  const entries: GridEntry[] = [];

  for (const occurrence of occurrences) {
    const startMs = occurrence.start.getTime();
    const endMs = occurrence.end.getTime();

    if (endMs <= startMs) {
      // 長さ 0（以下）のオカレンスは開始時点の 1 点として単日扱いする
      if (startMs < dayStart.getTime() || startMs >= dayEnd.getTime()) {
        continue;
      }
      const minutes = minutesOfDayInZone(occurrence.start, timeZone);
      // 表示時間帯外の点は除外する（点はクランプせず、含む/除外の二値判定のみ）
      if (minutes < displayStartMinutes || minutes >= displayEndMinutes) {
        continue;
      }
      entries.push({
        occurrence,
        startMinutes: minutes,
        endMinutes: minutes,
        continuesBefore: false,
        continuesAfter: false,
      });
      continue;
    }

    if (
      !rangesOverlap(
        { start: occurrence.start, end: occurrence.end },
        { start: dayStart, end: dayEnd },
      )
    ) {
      continue;
    }

    const startsInDay = startMs >= dayStart.getTime();
    const endsAtOrAfterDayEnd = endMs >= dayEnd.getTime();
    const dayClampedStartMinutes = startsInDay ? minutesOfDayInZone(occurrence.start, timeZone) : 0;
    const dayClampedEndMinutes = endsAtOrAfterDayEnd
      ? MINUTES_PER_DAY
      : minutesOfDayInZone(occurrence.end, timeZone);

    // 日境界クランプ後の区間が表示時間帯と重ならなければ除外する
    if (
      dayClampedEndMinutes <= displayStartMinutes ||
      dayClampedStartMinutes >= displayEndMinutes
    ) {
      continue;
    }
    const clampedStartMinutes = Math.max(dayClampedStartMinutes, displayStartMinutes);
    const clampedEndMinutes = Math.min(dayClampedEndMinutes, displayEndMinutes);
    entries.push({
      occurrence,
      startMinutes: clampedStartMinutes,
      endMinutes: clampedEndMinutes,
      continuesBefore: !startsInDay || clampedStartMinutes > dayClampedStartMinutes,
      continuesAfter: endMs > dayEnd.getTime() || clampedEndMinutes < dayClampedEndMinutes,
    });
  }

  entries.sort(compareGridEntries);

  const inputs: TimeGridItemInput[] = entries.map((entry) => ({
    key: entry.occurrence.key,
    startMinutes: entry.startMinutes,
    endMinutes: entry.endMinutes,
  }));
  const placements = layoutTimeGridItems(inputs);

  return entries.map((entry, index) => {
    // placements は入力と同数・同順のため index で対応付く（undefined は防御）
    const placement = placements[index];
    return {
      occurrence: entry.occurrence,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      left: placement?.left ?? 0,
      width: placement?.width ?? 1,
      continuesBefore: entry.continuesBefore,
      continuesAfter: entry.continuesAfter,
    };
  });
}

/**
 * 時間軸の目盛りを生成する。
 *
 * `startMinutes` から `endMinutes` 分未満まで `slotMinutes` 刻みで生成し、
 * ラベルは {@link formatSlotLabel}（ロケールに応じた時刻表記）で付ける。`startMinutes` が
 * `slotMinutes` の倍数に整列していない場合でも、次のスロット境界へスナップせず
 * `startMinutes` ちょうどから素直に開始する。
 *
 * @param slotMinutes - 目盛り間隔（分）。0 以下・非有限の場合は空配列を返す
 * @param locale - ラベルの整形に使うロケール
 * @param startMinutes - 生成開始（分）。省略時は `0`
 * @param endMinutes - 生成終了（分、排他的）。省略時は `1440`
 *
 * @remarks リソースビュー（`resource-view.ts`）も同じ目盛りを使うため
 * モジュール間で共有する（`index.ts` からは公開しない）。
 */
export function buildSlots(
  slotMinutes: number,
  locale: string,
  startMinutes: number = 0,
  endMinutes: number = MINUTES_PER_DAY,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  // 不正な間隔（0 以下・非有限）では無限ループになるため空配列で防御する
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
    return slots;
  }
  for (let minutes = startMinutes; minutes < endMinutes; minutes += slotMinutes) {
    slots.push({ minutes, label: formatSlotLabel(minutes, locale) });
  }
  return slots;
}

/**
 * 営業時間フラグ付きスロット（{@link BusinessHourSlot}）を構築する。
 *
 * `businessHours` のうち `weekday` を `daysOfWeek` に含むルールだけを対象に、
 * 各スロットの開始分が `[startTime, endTime)`（分換算、終了は排他的）に
 * 含まれるかどうかを判定する（複数ルールが該当する場合は OR）。
 *
 * @param slots - 対象スロット一覧（{@link buildSlots} の結果）
 * @param weekday - 判定対象の日の曜日
 * @param businessHours - 営業時間の指定一覧。空配列ならすべて `isBusinessHours: false`
 * @returns `slots` と同じ並びの {@link BusinessHourSlot} 配列
 *
 * @remarks リソースビュー等、時間グリッド以外のビューは対象外（`index.ts` からは
 * 公開しない）。
 */
export function buildBusinessHourSlots(
  slots: readonly TimeSlot[],
  weekday: Weekday,
  businessHours: readonly BusinessHoursRule[],
): readonly BusinessHourSlot[] {
  const ranges = businessHours
    .filter((rule) => rule.daysOfWeek.includes(weekday))
    .map((rule) => ({
      startMinutes: parseTimeOfDay(rule.startTime),
      // endTime は日の終端 '24:00'（= 1440）を許容する
      endMinutes: parseSlotBoundaryTime(rule.endTime),
    }));
  return slots.map((slot) => ({
    minutes: slot.minutes,
    isBusinessHours: ranges.some(
      (range) => slot.minutes >= range.startMinutes && slot.minutes < range.endMinutes,
    ),
  }));
}

/**
 * 主軸（表示タイムゾーン）＋追加軸（{@link CalendarOptions.timeAxisZones}）の
 * 時間軸配列を構築する（Google カレンダーのセカンダリタイムゾーン相当）。
 *
 * 追加軸の各スロットのラベルは、表示範囲の最初の日の 0:00（`rangeStart`）を基準に
 * `addMinutesInZone(rangeStart, slot.minutes, timeZone)` で主軸の現地時刻を維持した
 * 絶対時刻を算出し、それを追加軸のタイムゾーンの現地時刻へ変換して求める。
 * 固定オフセットの加算ではなく実際のタイムゾーン変換で算出するため、`rangeStart` が
 * 追加軸側の DST 切替日であれば、切替前後でラベルのオフセットも正しく変わる。
 *
 * @param params.rangeStart - 表示範囲の最初の日の 0:00（主軸のタイムゾーンにおける絶対時刻）
 * @param params.timeZone - 表示タイムゾーン（主軸）
 * @param params.slots - 主軸の目盛り（{@link buildSlots} の結果）
 * @param params.timeAxisZones - 追加軸のタイムゾーン一覧。省略時は `[]`
 * @param params.locale - ラベルの整形に使うロケール
 * @returns 主軸を先頭とする時間軸配列（`timeAxisZones` 未指定時は主軸のみの 1 要素配列）
 */
export function buildTimeAxes(params: {
  rangeStart: Date;
  timeZone: TimeZoneId;
  slots: readonly TimeSlot[];
  timeAxisZones: readonly TimeZoneId[];
  locale: string;
}): readonly TimeAxis[] {
  const { rangeStart, timeZone, slots, timeAxisZones, locale } = params;

  // 主軸は slots と同内容なので参照をそのまま共有する（readonly のため複製不要。
  // ビューモデル再構築のたびに全スロットを複製する無駄を避ける）
  const primaryAxis: TimeAxis = { timeZone, slots };

  const extraAxes: TimeAxis[] = timeAxisZones.map((zone) => ({
    timeZone: zone,
    slots: slots.map((slot) => {
      const instant = addMinutesInZone(rangeStart, slot.minutes, timeZone);
      const zonedMinutes = minutesOfDayInZone(instant, zone);
      return { minutes: slot.minutes, label: formatSlotLabel(zonedMinutes, locale) };
    }),
  }));

  return [primaryAxis, ...extraAxes];
}

/**
 * 昇順ソート済み配列 `sorted` に対し、`sorted[i] > value` を満たす最小の添字 `i` を返す。
 * すべて `value` 以下なら配列長を返す（二分探索、O(log n)）。
 *
 * @remarks `list-view.ts` の同名ヘルパーと同じ実装（オカレンスを日ごとの
 * 境界へ 1 パスで振り分けるためのスイープに使う）。モジュールをまたいだ
 * 依存を増やさないためここでも個別に定義する。
 */
function lowerBoundGreaterThan(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const midValue = sorted[mid];
    if (midValue !== undefined && midValue > value) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/**
 * 週/日ビューのビューモデルを構築する。
 *
 * 振り分けルール（Google カレンダーと同じ帯方式）:
 * - `allDay: true` のオカレンス、または表示タイムゾーンで複数日にまたがり
 *   （開始の日付キーと「終了の 1ms 前」の日付キーが異なる。長さ 0 は単日扱い）
 *   かつ 24 時間以上続くオカレンスは終日行のセグメントになる
 *   （帯レイアウトでレーン割当。`allDayMaxEvents` 指定時はレーン数が制限され、
 *   超過分は `hidden: true` になって各日の `allDayOverflowCount` に集約される。
 *   省略時はあふれ制限なし）
 * - それ以外（24 時間未満の時間指定イベント）は該当日の時間グリッドに配置される。
 *   日をまたぐもの（例: 22:00〜翌 2:00）は日ごとに分割される
 *
 * 時間グリッドの配置:
 * - オカレンスの日内位置は `minutesOfDayInZone` による現地時刻の分で決まる
 * - 日をまたいでクランプされた場合は `continuesBefore` / `continuesAfter` が立ち、
 *   終了は 1440 分（24:00）になる
 * - 同じ日で重なるオカレンスは {@link layoutTimeGridItems} で横並びになる
 *
 * `hiddenWeekdays`（非表示曜日）:
 * - `viewType: 'week'` のとき、該当曜日の列を `days` から除外する。
 *   終日行（`allDaySegments`）の帯レイアウトも可視列基準になり、非表示曜日を
 *   跨ぐオカレンスは可視列上で連続した 1 本のセグメントとして扱われる（月ビューと同じ規則）
 * - `viewType: 'day'` のときは `hiddenWeekdays` を無視する（明示的にその日へ
 *   移動した場合は表示する。Google カレンダーと同じ挙動）
 * - 「今日」が非表示曜日で `days` に含まれない場合、`nowIndicator` は `null` になる
 *
 * @param params.currentDate - 基準日
 * @param params.viewType - `'week'`（7 日）または `'day'`（1 日）
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みのオカレンス一覧
 * @param params.weekStartsOn - 週の開始曜日（`'week'` のときのみ使用）
 * @param params.slotMinutes - 時間軸の目盛り間隔（分）
 * @param params.locale - 時間軸ラベルの整形に使うロケール
 * @param params.now - 現在時刻（`isToday` 判定と現在時刻線に使用）
 * @param params.hiddenWeekdays - 非表示にする曜日（`'week'` のときのみ有効）。省略時は `[]`
 * @param params.timeAxisZones - 時間軸に並べる追加のタイムゾーン（{@link buildTimeAxes} 参照）。省略時は `[]`
 * @param params.showWeekNumbers - `viewType: 'week'` のとき、ISO 8601 週番号
 *   （`TimeGridViewModel.weekNumber`）を算出するか。省略時は `false`
 *   （`weekNumber` は常に `null`。`viewType: 'day'` では常に `null`）
 * @param params.businessHours - 各日の時間グリッドのスロットに営業時間内フラグ
 *   （`TimeGridDay.businessHourSlots`）を付与する指定。省略時は `[]`（すべて `false`）
 * @param params.slotMinTime - 表示する時間帯の開始（`'HH:mm'` 形式）。省略時は `'00:00'`
 * @param params.slotMaxTime - 表示する時間帯の終了（`'HH:mm'` 形式、排他的。`'24:00'` も可）。
 *   省略時は `'24:00'`
 * @param params.allDayMaxEvents - 終日行に表示する最大レーン数
 *   （{@link CalendarOptions.allDayMaxEvents}）。省略時は無制限。指定時は超過した
 *   セグメントを `hidden: true` にし、各日の `TimeGridDay.allDayOverflowCount` に集計する
 */
export function buildTimeGridViewModel(params: {
  currentDate: Date;
  viewType: 'week' | 'day';
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  slotMinutes: number;
  locale: string;
  now: Date;
  hiddenWeekdays?: readonly Weekday[];
  timeAxisZones?: readonly TimeZoneId[];
  showWeekNumbers?: boolean;
  businessHours?: readonly BusinessHoursRule[];
  slotMinTime?: string;
  slotMaxTime?: string;
  allDayMaxEvents?: number;
}): TimeGridViewModel {
  const {
    currentDate,
    viewType,
    timeZone,
    occurrences,
    weekStartsOn,
    slotMinutes,
    locale,
    now,
    hiddenWeekdays = [],
    timeAxisZones = [],
    showWeekNumbers = false,
    businessHours = [],
    slotMinTime = '00:00',
    slotMaxTime = '24:00',
    allDayMaxEvents,
  } = params;
  const slotMinTimeMinutes = parseSlotBoundaryTime(slotMinTime);
  const slotMaxTimeMinutes = parseSlotBoundaryTime(slotMaxTime);

  // 表示範囲: week は週開始日から 7 日、day は基準日の 1 日
  const rangeStart =
    viewType === 'week'
      ? startOfWeekInZone(currentDate, timeZone, weekStartsOn)
      : startOfDayInZone(currentDate, timeZone);
  const dayCount = viewType === 'week' ? 7 : 1;
  // addDaysInZone は加算前の現地時刻を維持するため、深夜 0:00 に DST が切り替わる
  // ゾーン（例: America/Santiago）で rangeStart が 1:00 に繰り上げられていると
  // 範囲が翌日側へ 1 時間はみ出し、日数が 1 日増えてしまう。日の開始へ再正規化する
  const rangeEnd = startOfDayInZone(addDaysInZone(rangeStart, dayCount, timeZone), timeZone);
  // dayStarts / dayKeys / columnIndexByKey は非表示曜日を含む「元の」列（全 dayCount 列）。
  // 終日行のレイアウトはここから可視列へ変換するため、まずは全列で構築しておく
  const dayStarts = eachDayInRange({ start: rangeStart, end: rangeEnd }, timeZone);

  const dayKeys = dayStarts.map((dayStart) => dateKeyInZone(dayStart, timeZone));
  const columnIndexByKey = new Map<string, number>(dayKeys.map((key, index) => [key, index]));

  // 可視列（非表示曜日を除いた列）のインデックス一覧。day ビューでは
  // hiddenWeekdays を無視し、常に全列（1 列）を可視として扱う
  const hiddenWeekdaySet = new Set(hiddenWeekdays);
  const visibleDayIndices: number[] = [];
  dayStarts.forEach((dayStart, index) => {
    if (viewType === 'day' || !hiddenWeekdaySet.has(weekdayInZone(dayStart, timeZone))) {
      visibleDayIndices.push(index);
    }
  });
  const visibleColByOrigCol = new Map<number, number>(
    visibleDayIndices.map((origIndex, visibleIndex) => [origIndex, visibleIndex]),
  );

  // オカレンスを終日行と時間グリッドに振り分ける
  const allDayRowOccurrences: EventOccurrence[] = [];
  const timedOccurrences: EventOccurrence[] = [];
  for (const occurrence of occurrences) {
    if (belongsToAllDayRow(occurrence, timeZone)) {
      allDayRowOccurrences.push(occurrence);
    } else {
      timedOccurrences.push(occurrence);
    }
  }

  const {
    segments: allDaySegments,
    laneCount: allDayLaneCount,
    overflowByCol: allDayOverflowByCol,
  } = buildAllDaySegments(allDayRowOccurrences, {
    rangeStart,
    rangeEnd,
    columnIndexByKey,
    visibleColByOrigCol,
    columnCount: visibleDayIndices.length,
    timeZone,
    ...(allDayMaxEvents !== undefined ? { allDayMaxEvents } : {}),
  });

  // 各元列（非表示曜日を含む全 dayCount 列）の次の日の 0:00（排他端）。
  // 最終列は範囲終端と一致する。可視列側の buildDayItems 呼び出しと
  // 下のバケット分けの両方で使うため 1 度だけ計算する
  const dayEnds: Date[] = dayStarts.map((_, index) => dayStarts[index + 1] ?? rangeEnd);

  // timedOccurrences を元列（全 dayCount 列）ごとのバケットへ 1 パスで振り分ける。
  // 可視列ごとに timedOccurrences 全体を buildDayItems へ渡すと（週ビューで
  // 最大 7 回）同じオカレンス集合を毎回フルスキャンすることになるため、
  // list-view.ts の lowerBoundGreaterThan によるスイープと同じ方式で、
  // 各日の [dayStart, dayEnd) 境界に対して二分探索 + 前方走査を行い、
  // buildDayItems が内部で行うのと同じ重なり判定規則（zero 長は開始時点の
  // 属する日のみ、それ以外は end 排他の区間交差）で事前に振り分けておく
  const dayStartTimes = dayStarts.map((dayStart) => dayStart.getTime());
  const dayEndTimes = dayEnds.map((dayEnd) => dayEnd.getTime());
  const timedByOrigDay: EventOccurrence[][] = dayStarts.map(() => []);
  for (const occurrence of timedOccurrences) {
    const startMs = occurrence.start.getTime();
    const endMs = occurrence.end.getTime();
    // 「dayEnd > 開始」を満たす最初の日（それ以前の日は開始までに終わっている）
    const firstIndex = lowerBoundGreaterThan(dayEndTimes, startMs);
    if (firstIndex >= dayStarts.length) {
      continue;
    }
    if (endMs <= startMs) {
      // 長さ 0（以下）のオカレンスは開始時点が属する日 1 つにだけ割り当てる
      // （buildDayItems 内の単日扱いと同じ規則）
      const dayStartTime = dayStartTimes[firstIndex];
      if (dayStartTime !== undefined && startMs >= dayStartTime) {
        timedByOrigDay[firstIndex]?.push(occurrence);
      }
      continue;
    }
    // 通常のオカレンス: dayStart < 終了 を満たす日へ順に割り当てる（end 排他の交差）
    for (let index = firstIndex; index < dayStarts.length; index += 1) {
      const dayStartTime = dayStartTimes[index];
      if (dayStartTime === undefined || dayStartTime >= endMs) {
        break;
      }
      timedByOrigDay[index]?.push(occurrence);
    }
  }

  // days（timeAxes を含む）より前に計算する必要がある
  const slots = buildSlots(slotMinutes, locale, slotMinTimeMinutes, slotMaxTimeMinutes);

  // 週で共有する時間軸（rangeStart 基準）。追加軸がなければ日別の差
  // （DST 対応の日別算出）は生じないため、全日でこの配列を共有し、
  // 日ごとの無駄なアロケーションを避ける
  const sharedTimeAxes = buildTimeAxes({ rangeStart, timeZone, slots, timeAxisZones, locale });
  // businessHours 未指定時は曜日によらず全スロット false になるため、
  // 1 本だけ生成して全日で共有する
  const sharedBusinessHourSlots =
    businessHours.length === 0 ? buildBusinessHourSlots(slots, 0, businessHours) : null;

  const days: TimeGridDay[] = visibleDayIndices.map((index, visibleCol) => {
    const dayStart = dayStarts[index];
    if (dayStart === undefined) {
      // visibleDayIndices は dayStarts の添字から作られるためここには到達しない
      throw new Error('表示範囲内の日付が見つかりません');
    }
    return {
      date: dayStart,
      key: dayKeys[index] ?? dateKeyInZone(dayStart, timeZone),
      isToday: isSameDayInZone(dayStart, now, timeZone),
      weekday: weekdayInZone(dayStart, timeZone),
      // 終日行のあふれ件数（allDayMaxEvents 未指定時は全列 0）。
      // overflowByCol は可視列の座標系なので visibleCol で対応付く
      allDayOverflowCount: allDayOverflowByCol[visibleCol] ?? 0,
      items: buildDayItems(timedByOrigDay[index] ?? [], {
        dayStart,
        // 次の日の 0:00（非表示曜日で間引く前の、暦上連続する翌日の境界）。
        // 最終日の翌日 0:00 は範囲終端と一致する
        dayEnd: dayEnds[index] ?? rangeEnd,
        timeZone,
        displayStartMinutes: slotMinTimeMinutes,
        displayEndMinutes: slotMaxTimeMinutes,
      }),
      // 追加軸がある場合のみ、この日自身の 0:00 を基準に日別算出する。追加軸の
      // タイムゾーンで週の途中に DST 切替があっても、切替後の日は正しいオフセットに
      // なる（TimeGridDay.timeAxes の TSDoc を参照）。追加軸がなければ日別の差は
      // 生じないため、週共有の配列を使う
      timeAxes:
        timeAxisZones.length === 0
          ? sharedTimeAxes
          : buildTimeAxes({ rangeStart: dayStart, timeZone, slots, timeAxisZones, locale }),
      // この日の曜日を基準に営業時間内フラグを付与する。businessHours 未指定時は
      // 全スロット false の共有配列を使う
      businessHourSlots:
        sharedBusinessHourSlots ??
        buildBusinessHourSlots(slots, weekdayInZone(dayStart, timeZone), businessHours),
    };
  });

  // 現在時刻線: 「今日」が可視列に含まれ、かつ現在時刻が表示時間帯
  // （slotMinTimeMinutes〜slotMaxTimeMinutes）の内側にある場合のみその列と
  // 現地時刻の分を返す。非表示曜日で days から除外された場合は自然に null になる
  const visibleDayKeys = new Set(visibleDayIndices.map((index) => dayKeys[index]));
  const todayKey = dateKeyInZone(now, timeZone);
  const nowMinutes = minutesOfDayInZone(now, timeZone);
  const nowIndicator =
    visibleDayKeys.has(todayKey) &&
    nowMinutes >= slotMinTimeMinutes &&
    nowMinutes < slotMaxTimeMinutes
      ? { dayKey: todayKey, minutes: nowMinutes }
      : null;

  // 週番号は viewType: 'week' かつ showWeekNumbers のときのみ算出する（週内の木曜日を
  // 基準にするため weekStartsOn の値によらない。詳細は isoWeekNumberOfWeek を参照）
  const weekNumber =
    viewType === 'week' && showWeekNumbers ? isoWeekNumberOfWeek(rangeStart, timeZone) : null;

  return {
    type: 'timeGrid',
    viewType,
    days,
    allDaySegments,
    allDayLaneCount,
    slots,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    timeAxes: sharedTimeAxes,
    nowIndicator,
    weekNumber,
  };
}
