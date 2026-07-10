/**
 * @packageDocumentation
 * タイムラインビューのビューモデル構築。
 *
 * 横 = 時間（`timelineDays` 日の連結）、行 = リソースの帯表示。
 * 横位置は「表示分」= `日インデックス × 1440 + その日の 0:00 からの分` の座標系で
 * 表現し、DST の 23/25 時間日も視覚上は等幅 1440 分として扱う（週/日ビューが全日を
 * 1440 分の縦トラックで描く既存規約と同じ）。`hiddenWeekdays` は適用しない
 * （比例幅を持つ分スケールから日を抜くと帯の長さが実時間から乖離するため。
 * 詳細は `docs/internal/views-expansion-design.md` §7.2）。
 *
 * 行内の重なりは {@link ../layout/interval-lane-layout} の区間レーン割当で縦に積む。
 * 終日・時間指定の区別なく同じレーン空間に配置する。
 */

import { layoutIntervalLanes } from '../layout/interval-lane-layout';
import {
  addDaysInZone,
  dateKeyInZone,
  formatSlotLabel,
  isSameDayInZone,
  minutesOfDayInZone,
  startOfDayInZone,
  weekdayInZone,
} from '../timezone';
import type {
  CalendarResource,
  EventOccurrence,
  TimelineDay,
  TimelineItem,
  TimelineRow,
  TimelineSlot,
  TimelineViewModel,
  TimeZoneId,
} from '../types';

/** 1 日の分（24:00 = 1440 分）。DST 日でも表示スケールは 24 時間として扱う。 */
const MINUTES_PER_DAY = 1440;

/**
 * 長さ 0 のオカレンスの実効長（分）。
 * 分スケールのレイアウトで短小アイテムに視覚上の最小長を与える
 * {@link ../layout/time-grid-layout} の `minSlotMinutes` 既定値と同じ値・同じ趣旨の
 * ビルダー側の固定値（ドラッグ粒度の利用者設定 `snapMinutes` とは無関係）。
 */
const ZERO_LENGTH_EFFECTIVE_MINUTES = 30;

/** 未割り当て行のキー（{@link ./resource-view} の未割り当て列と同じ形式）。 */
const UNASSIGNED_KEY = 'unassigned';

/** リソース行のキーを組み立てる（`'unassigned'` という ID のリソースと衝突しない形式）。 */
function resourceRowKey(resourceId: string): string {
  return `r:${resourceId}`;
}

/** 行内アイテムの表示順（表示分の開始昇順 → 長い順 → キー辞書順）。 */
interface RowEntry {
  occurrence: EventOccurrence;
  startMinutes: number;
  endMinutes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function compareRowEntries(a: RowEntry, b: RowEntry): number {
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
  return a.occurrence.key > b.occurrence.key ? 1 : 0;
}

/**
 * タイムラインビューのビューモデルを構築する。
 *
 * 処理内容:
 * - 表示日は `currentDate` の属する日から `timelineDays` 日の連続並び
 * - リソース一覧を先頭から走査し、**ID 重複は先勝ち**で行にする。
 *   オカレンスは `event.resourceId` で 1 パスのバケット分けし、未指定・
 *   参照先のない ID は未割り当て行に合流する（{@link ./resource-view} と同じ規則）
 * - 未割り当て行は {@link CalendarOptions.unassignedLane} の規則で生成する
 * - 各オカレンスを表示分の区間に変換する:
 *   - 時間指定 — 開始/終了それぞれ `日インデックス × 1440 + 現地時刻の分`。
 *     表示範囲の外へ続く側は `0` / `totalMinutes` にクランプし、
 *     `continuesBefore` / `continuesAfter` を立てる。日をまたぐオカレンスは
 *     連続した 1 本の帯になる（時間グリッドのような日分割はしない）
 *   - 終日 — 覆う表示日の `[日開始 0 分, 日終了 1440 分)` の帯
 *   - 長さ 0 — 実効 {@link ZERO_LENGTH_EFFECTIVE_MINUTES} 分の帯として扱う
 * - 行内の重なりは {@link layoutIntervalLanes} でレーンに積む
 *   （終日・時間指定の区別なく同じレーン空間）
 *
 * @param params.currentDate - 表示範囲の先頭日に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示範囲で展開済みのオカレンス一覧
 * @param params.resources - リソース一覧（表示順）
 * @param params.unassignedLane - 未割り当てレーンの生成規則
 * @param params.timelineDays - 表示日数
 * @param params.slotMinutes - 時間軸の目盛り間隔（分）
 * @param params.now - 現在時刻（`isToday` 判定・現在時刻線に使用）
 * @returns タイムラインビューのビューモデル
 * @example
 * ```ts
 * const viewModel = buildTimelineViewModel({
 *   currentDate: new Date('2026-07-10T00:00:00+09:00'),
 *   timeZone: 'Asia/Tokyo',
 *   occurrences,
 *   resources: [{ id: 'crane-1', title: 'クレーン 1 号機' }],
 *   unassignedLane: 'auto',
 *   timelineDays: 7,
 *   slotMinutes: 60,
 *   now: new Date(),
 * });
 * viewModel.totalMinutes; // => 10080
 * ```
 */
export function buildTimelineViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  resources: readonly CalendarResource[];
  unassignedLane: 'auto' | 'always';
  timelineDays: number;
  slotMinutes: number;
  now: Date;
}): TimelineViewModel {
  const {
    currentDate,
    timeZone,
    occurrences,
    resources,
    unassignedLane,
    timelineDays,
    slotMinutes,
    now,
  } = params;

  // 表示日の列挙（毎回日の開始へ再正規化する。深夜 0:00 が存在しないゾーン対策）
  const dayStarts: Date[] = [];
  let cursor = startOfDayInZone(currentDate, timeZone);
  for (let index = 0; index < Math.max(1, timelineDays); index += 1) {
    dayStarts.push(cursor);
    cursor = startOfDayInZone(addDaysInZone(cursor, 1, timeZone), timeZone);
  }
  const firstDayStart = dayStarts[0];
  if (firstDayStart === undefined) {
    // timelineDays は 1 以上に正規化済みのため到達しない
    throw new Error('タイムラインの表示日が空です');
  }
  // クロージャ（toRowEntry 等）内でも Date に確定した型で参照できるよう別名に束ねる
  const rangeStart: Date = firstDayStart;
  const rangeEnd: Date = cursor;
  const totalMinutes = dayStarts.length * MINUTES_PER_DAY;

  const days: TimelineDay[] = dayStarts.map((date) => ({
    date,
    key: dateKeyInZone(date, timeZone),
    isToday: isSameDayInZone(date, now, timeZone),
    weekday: weekdayInZone(date, timeZone),
  }));
  const dayIndexByKey = new Map<string, number>(days.map((day, index) => [day.key, index]));

  // 目盛り: 日ごとに slotMinutes 刻み（1440 の非約数では日ごとに切り上げ個数になる）
  const slots: TimelineSlot[] = [];
  if (Number.isFinite(slotMinutes) && slotMinutes > 0) {
    days.forEach((day, dayIndex) => {
      for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += slotMinutes) {
        slots.push({
          minutes: dayIndex * MINUTES_PER_DAY + minutes,
          dayKey: day.key,
          label: formatSlotLabel(minutes),
        });
      }
    });
  }

  /** 絶対時刻を表示分に変換する（範囲内である前提。日インデックス × 1440 + 日内の分）。 */
  function displayMinutesOf(instant: Date): number {
    const dayIndex = dayIndexByKey.get(dateKeyInZone(instant, timeZone));
    if (dayIndex === undefined) {
      // 呼び出し側で範囲内にクランプ済みのため到達しない（型上の防御）
      return 0;
    }
    return dayIndex * MINUTES_PER_DAY + minutesOfDayInZone(instant, timeZone);
  }

  /** オカレンスを表示分の区間（RowEntry）に変換する。表示範囲と重ならなければ `null`。 */
  function toRowEntry(occurrence: EventOccurrence): RowEntry | null {
    const startMs = occurrence.start.getTime();
    const endMs = occurrence.end.getTime();

    if (endMs <= startMs) {
      // 長さ 0（以下）のオカレンスは開始時点の 1 点として扱い、実効 30 分の帯にする
      if (startMs < rangeStart.getTime() || startMs >= rangeEnd.getTime()) {
        return null;
      }
      const startMinutes = displayMinutesOf(occurrence.start);
      return {
        occurrence,
        startMinutes,
        endMinutes: Math.min(startMinutes + ZERO_LENGTH_EFFECTIVE_MINUTES, totalMinutes),
        continuesBefore: false,
        continuesAfter: false,
      };
    }

    if (endMs <= rangeStart.getTime() || startMs >= rangeEnd.getTime()) {
      return null;
    }

    if (occurrence.allDay) {
      // 終日は覆う表示日の全幅。開始日・終了日（end の 1ms 前が属する日）を
      // 表示日の並びにクランプして日単位の帯にする
      const startKey = dateKeyInZone(
        startMs < rangeStart.getTime() ? rangeStart : occurrence.start,
        timeZone,
      );
      const lastInstantMs = Math.min(endMs - 1, rangeEnd.getTime() - 1);
      const endKey = dateKeyInZone(new Date(lastInstantMs), timeZone);
      const startIndex = dayIndexByKey.get(startKey) ?? 0;
      const endIndex = dayIndexByKey.get(endKey) ?? days.length - 1;
      return {
        occurrence,
        startMinutes: startIndex * MINUTES_PER_DAY,
        endMinutes: (endIndex + 1) * MINUTES_PER_DAY,
        continuesBefore: startMs < rangeStart.getTime(),
        continuesAfter: endMs > rangeEnd.getTime(),
      };
    }

    const startsInRange = startMs >= rangeStart.getTime();
    const endsInRange = endMs < rangeEnd.getTime();
    return {
      occurrence,
      startMinutes: startsInRange ? displayMinutesOf(occurrence.start) : 0,
      endMinutes: endsInRange ? displayMinutesOf(occurrence.end) : totalMinutes,
      continuesBefore: !startsInRange,
      continuesAfter: endMs > rangeEnd.getTime(),
    };
  }

  // ID 重複を先勝ちで除いた行の並び（resource-view と同じ規則）
  const uniqueResources: CalendarResource[] = [];
  const resourceById = new Map<string, CalendarResource>();
  for (const entry of resources) {
    if (!resourceById.has(entry.id)) {
      resourceById.set(entry.id, entry);
      uniqueResources.push(entry);
    }
  }

  // オカレンス → レーン ID の 1 パスのバケット分け
  const bucket = new Map<string | null, EventOccurrence[]>();
  for (const occurrence of occurrences) {
    const resourceId = occurrence.event.resourceId;
    const laneId = resourceId !== undefined && resourceById.has(resourceId) ? resourceId : null;
    const list = bucket.get(laneId);
    if (list === undefined) {
      bucket.set(laneId, [occurrence]);
    } else {
      list.push(occurrence);
    }
  }

  /** 1 行分のオカレンスから帯（レーン割当済み）を構築する。 */
  function buildRowItems(rowOccurrences: readonly EventOccurrence[]): {
    items: TimelineItem[];
    laneCount: number;
  } {
    const entries: RowEntry[] = [];
    for (const occurrence of rowOccurrences) {
      const entry = toRowEntry(occurrence);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    entries.sort(compareRowEntries);

    const layout = layoutIntervalLanes(
      entries.map((entry) => ({
        key: entry.occurrence.key,
        start: entry.startMinutes,
        // 長さ 0 の帯はここに来る前に実効 30 分へ変換済みだが、クランプ等で
        // 空区間になった場合に備えて最低 1 分を確保する（レーン割当の前提を守る）
        end: Math.max(entry.endMinutes, entry.startMinutes + 1),
      })),
    );

    const items: TimelineItem[] = entries.map((entry, index) => ({
      occurrence: entry.occurrence,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      lane: layout.placements[index]?.lane ?? 0,
      continuesBefore: entry.continuesBefore,
      continuesAfter: entry.continuesAfter,
    }));
    return { items, laneCount: layout.laneCount };
  }

  const rows: TimelineRow[] = uniqueResources.map((entry) => ({
    resource: entry,
    key: resourceRowKey(entry.id),
    ...buildRowItems(bucket.get(entry.id) ?? []),
  }));

  const unassignedOccurrences = bucket.get(null) ?? [];
  if (unassignedLane === 'always' || unassignedOccurrences.length > 0) {
    rows.push({
      resource: null,
      key: UNASSIGNED_KEY,
      ...buildRowItems(unassignedOccurrences),
    });
  }

  const nowInRange = now.getTime() >= rangeStart.getTime() && now.getTime() < rangeEnd.getTime();

  return {
    type: 'timeline',
    days,
    slots,
    rows,
    isEmpty: rows.length === 0,
    totalMinutes,
    nowIndicatorMinutes: nowInRange ? displayMinutesOf(now) : null,
  };
}
