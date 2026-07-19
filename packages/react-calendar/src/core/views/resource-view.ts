/**
 * @packageDocumentation
 * リソースビューのビューモデル構築。
 *
 * 時間グリッドを「列 = リソース × 日」で描くためのビューモデルを構築する。
 * 表示日数は {@link CalendarOptions.resourceViewDays}（既定 1）で、
 * 2 以上の場合は列がリソース優先（リソースごとに日を昇順で並べる）の直積になる。
 * 列内の配置計算（日内クランプ・重なりの横並び）は週/日ビューと共有の
 * ヘルパ（{@link ./time-grid-view} の `buildDayItems` 等）に委譲する。
 *
 * オカレンス → レーンの振り分けは割当リソース ID（{@link assignedLaneIds}。
 * `resourceIds` が優先、未指定時は `resourceId`）に基づく 1 パスのバケット分けで行い、
 * 「列ごとに全オカレンスをフィルタ」する O(列数 × 全件) の走査はしない
 * （レーン内の日別振り分けは日数分の走査のみ）。複数リソース割当のオカレンスは
 * 割当先の各レーンに同一オカレンスとして表示される。
 */

import { eachDayInRange } from '../date-utils';
import { assignedLaneIds } from '../resource-assignment';
import {
  addDaysInZone,
  dateKeyInZone,
  isSameDayInZone,
  minutesOfDayInZone,
  parseSlotBoundaryTime,
  startOfDayInZone,
  weekdayInZone,
} from '../timezone';
import type {
  BusinessHoursRule,
  CalendarResource,
  EventOccurrence,
  ResourceColumn,
  ResourceViewDay,
  ResourceViewModel,
  TimeZoneId,
} from '../types';
import { laneDayColumnKey, laneKeyForResource, UNASSIGNED_LANE_KEY } from './lane-key';
import {
  belongsToAllDayRow,
  buildBusinessHourSlots,
  buildDayItems,
  buildSlots,
} from './time-grid-view';

/** 未割り当て列のキー（{@link UNASSIGNED_LANE_KEY} の別名。既存コードの可読性のため）。 */
const UNASSIGNED_KEY = UNASSIGNED_LANE_KEY;

/**
 * リソース列のキーを組み立てる（{@link laneKeyForResource} の別名）。
 * 形式は core/views/lane-key.ts が encode/decode の対で管理する。
 */
const resourceColumnKey = laneKeyForResource;

/**
 * 終日アイテムの並び順（開始昇順 → 長い順 → キー辞書順。既存レイアウトと同じハウスルール）。
 */
function compareAllDayItems(a: EventOccurrence, b: EventOccurrence): number {
  if (a.start.getTime() !== b.start.getTime()) {
    return a.start.getTime() - b.start.getTime();
  }
  const durationA = a.end.getTime() - a.start.getTime();
  const durationB = b.end.getTime() - b.start.getTime();
  if (durationA !== durationB) {
    return durationB - durationA;
  }
  if (a.key < b.key) {
    return -1;
  }
  return a.key > b.key ? 1 : 0;
}

/**
 * 終日アイテムが `[dayStart, dayEnd)` の日と重なるかを判定する。
 * 長さ 0 のオカレンスでも開始日 1 日分として扱えるよう、終端を最低 1ms 確保する
 * （週/日ビューの終日行セグメント構築と同じ規則）。
 */
function allDayItemOverlapsDay(occurrence: EventOccurrence, dayStart: Date, dayEnd: Date): boolean {
  const effectiveEndMs = Math.max(occurrence.end.getTime(), occurrence.start.getTime() + 1);
  return occurrence.start.getTime() < dayEnd.getTime() && effectiveEndMs > dayStart.getTime();
}

/**
 * リソースビューのビューモデルを構築する。
 *
 * 処理内容:
 * - 表示日は `currentDate` の属する日（{@link startOfDayInZone}）から
 *   `resourceViewDays` 日分（既定 1）。`hiddenWeekdays` は日ビューと同じく適用しない
 * - リソース一覧を先頭から走査し、**ID 重複は先勝ち**で列にする
 *   （2 つ目以降の同 ID リソースは列を作らない。開発ビルドの警告は React 層の責務）
 * - 列はリソース × 日の直積（リソース優先。各リソースの中に表示日が昇順で並ぶ）。
 *   表示日数 1 の列キーは `` `r:${id}` `` / `'unassigned'`、2 以上は
 *   {@link laneDayColumnKey} による日付キー付きの形式になる
 * - オカレンスを割当リソース ID（{@link assignedLaneIds}。`resourceIds` が優先、
 *   未指定時は `resourceId`）で 1 パスのバケット分けする。複数リソース割当の
 *   オカレンスは割当先の各レーンに同一オカレンスとして入る。割当がない、または
 *   割当がすべて `resources` に存在しない ID（参照先のない ID）の場合は
 *   未割り当てレーンに合流する（黙って非表示にしない）
 * - 未割り当て列は {@link CalendarOptions.unassignedLane} の規則で生成する
 *   （`'auto'` = 該当オカレンスがある場合のみ、`'always'` = 常に。生成される場合は
 *   全表示日分の列が末尾にまとまる）
 * - 各列で、終日行行きのオカレンス（{@link belongsToAllDayRow} の判定）は
 *   その列の日と重なるものを `allDayItems` に整列して入れ、それ以外は
 *   {@link buildDayItems} で日内クランプ・重なりの横並びを計算して `items` に入れる
 *
 * @param params.currentDate - 表示範囲の先頭日に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示日範囲で展開済みのオカレンス一覧
 * @param params.resources - リソース一覧（表示順）
 * @param params.unassignedLane - 未割り当てレーンの生成規則
 * @param params.slotMinutes - 時間軸の目盛り間隔（分）
 * @param params.locale - 時間軸ラベルの整形に使うロケール
 * @param params.now - 現在時刻（`isToday` 判定・現在時刻線に使用）
 * @param params.businessHours - 営業時間の指定一覧（{@link ResourceViewDay.businessHourSlots}
 *   を各表示日の曜日基準で算出する）。省略時は `[]`（すべて `isBusinessHours: false`）
 * @param params.slotMinTime - 表示する時間帯の開始（`'HH:mm'` 形式）。省略時は `'00:00'`
 * @param params.slotMaxTime - 表示する時間帯の終了（`'HH:mm'` 形式、排他的。`'24:00'` も可）。
 *   省略時は `'24:00'`
 * @param params.resourceViewDays - 表示日数。省略時は `1`。0 以下・非整数は 1 日へ正規化する
 * @returns リソースビューのビューモデル
 * @example
 * ```ts
 * const viewModel = buildResourceViewModel({
 *   currentDate: new Date('2026-07-10T00:00:00+09:00'),
 *   timeZone: 'Asia/Tokyo',
 *   occurrences,
 *   resources: [{ id: 'room-a', title: '会議室A' }],
 *   unassignedLane: 'auto',
 *   slotMinutes: 60,
 *   locale: 'ja',
 *   now: new Date(),
 * });
 * viewModel.columns[0]?.key; // => 'r:room-a'
 * ```
 */
export function buildResourceViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  resources: readonly CalendarResource[];
  unassignedLane: 'auto' | 'always';
  slotMinutes: number;
  locale: string;
  now: Date;
  businessHours?: readonly BusinessHoursRule[];
  slotMinTime?: string;
  slotMaxTime?: string;
  resourceViewDays?: number;
}): ResourceViewModel {
  const {
    currentDate,
    timeZone,
    occurrences,
    resources,
    unassignedLane,
    slotMinutes,
    locale,
    now,
    businessHours = [],
    slotMinTime = '00:00',
    slotMaxTime = '24:00',
    resourceViewDays = 1,
  } = params;
  const slotMinTimeMinutes = parseSlotBoundaryTime(slotMinTime);
  const slotMaxTimeMinutes = parseSlotBoundaryTime(slotMaxTime);
  // 0 以下・非有限・小数は 1 日以上の整数へ正規化する（壊れた表示を作らない防御。
  // createCalendar 経由では resolveOptions が正規化済みだが、直接呼び出しにも備える）
  const dayCount = Number.isFinite(resourceViewDays)
    ? Math.max(1, Math.floor(resourceViewDays))
    : 1;

  const firstDay = startOfDayInZone(currentDate, timeZone);
  // 範囲終端（排他）。深夜 0:00 が存在しないゾーンに備えて日の開始へ再正規化する
  const rangeEnd = startOfDayInZone(addDaysInZone(firstDay, dayCount, timeZone), timeZone);
  const dayStarts = eachDayInRange({ start: firstDay, end: rangeEnd }, timeZone);
  // 各日の翌日 0:00（排他端）。最終日は範囲終端と一致する
  const dayEnds: Date[] = dayStarts.map((_, index) => dayStarts[index + 1] ?? rangeEnd);

  const slots = buildSlots(slotMinutes, locale, slotMinTimeMinutes, slotMaxTimeMinutes);
  // businessHours 未指定時は曜日によらず全スロット false になるため、
  // 1 本だけ生成して全日で共有する（週/日ビューと同じ最適化）
  const sharedBusinessHourSlots =
    businessHours.length === 0 ? buildBusinessHourSlots(slots, 0, businessHours) : null;

  const days: ResourceViewDay[] = dayStarts.map((dayStart) => ({
    date: dayStart,
    key: dateKeyInZone(dayStart, timeZone),
    isToday: isSameDayInZone(dayStart, now, timeZone),
    businessHourSlots:
      sharedBusinessHourSlots ??
      buildBusinessHourSlots(slots, weekdayInZone(dayStart, timeZone), businessHours),
  }));
  const firstDayInfo = days[0];
  if (firstDayInfo === undefined) {
    // dayCount は 1 以上に正規化済みのためここには到達しない
    throw new Error('リソースビューの表示日が構築できません');
  }

  // ID 重複を先勝ちで除いたリソース列の並び
  const uniqueResources: CalendarResource[] = [];
  const resourceById = new Map<string, CalendarResource>();
  for (const entry of resources) {
    if (!resourceById.has(entry.id)) {
      resourceById.set(entry.id, entry);
      uniqueResources.push(entry);
    }
  }

  // オカレンス → レーン ID（リソース ID または null = 未割り当て）の 1 パスのバケット分け。
  // 複数リソース割当（resourceIds）のオカレンスは割当先の各レーンに入る
  const bucket = new Map<string | null, EventOccurrence[]>();
  for (const occurrence of occurrences) {
    for (const laneId of assignedLaneIds(occurrence.event, resourceById)) {
      const list = bucket.get(laneId);
      if (list === undefined) {
        bucket.set(laneId, [occurrence]);
      } else {
        list.push(occurrence);
      }
    }
  }

  /** 1 レーン分のオカレンスから、表示日ごとの列（リソース × 日）を構築する。 */
  function buildLaneColumns(
    resource: CalendarResource | null,
    laneKey: string,
    laneOccurrences: readonly EventOccurrence[],
  ): ResourceColumn[] {
    // 終日行行きと時間指定の振り分けはレーンにつき 1 回だけ行う
    const allDay: EventOccurrence[] = [];
    const timed: EventOccurrence[] = [];
    for (const occurrence of laneOccurrences) {
      if (belongsToAllDayRow(occurrence, timeZone)) {
        allDay.push(occurrence);
      } else {
        timed.push(occurrence);
      }
    }
    return days.map((day, dayIndex) => {
      const dayEnd = dayEnds[dayIndex] ?? rangeEnd;
      const allDayItems = allDay
        .filter((occurrence) => allDayItemOverlapsDay(occurrence, day.date, dayEnd))
        .sort(compareAllDayItems);
      return {
        resource,
        // 表示日数 1 のときは従来の単日キーのまま（`r:${id}` / 'unassigned'）
        key: dayCount === 1 ? laneKey : laneDayColumnKey(laneKey, day.key),
        date: day.date,
        dayKey: day.key,
        isToday: day.isToday,
        dayIndex,
        items: buildDayItems(timed, {
          dayStart: day.date,
          dayEnd,
          timeZone,
          displayStartMinutes: slotMinTimeMinutes,
          displayEndMinutes: slotMaxTimeMinutes,
        }),
        allDayItems,
      };
    });
  }

  const columns: ResourceColumn[] = uniqueResources.flatMap((entry) =>
    buildLaneColumns(entry, resourceColumnKey(entry.id), bucket.get(entry.id) ?? []),
  );

  const unassignedOccurrences = bucket.get(null) ?? [];
  if (unassignedLane === 'always' || unassignedOccurrences.length > 0) {
    columns.push(...buildLaneColumns(null, UNASSIGNED_KEY, unassignedOccurrences));
  }

  // 現在時刻線: 表示範囲に今日が含まれ、かつ現在時刻が表示時間帯
  // （slotMinTimeMinutes〜slotMaxTimeMinutes）の内側にある場合のみ分を返す。
  // 描画対象の列（今日の列）は ResourceColumn.isToday で判定する
  const todayInRange = days.some((day) => day.isToday);
  const nowMinutes = minutesOfDayInZone(now, timeZone);
  const nowIndicatorMinutes =
    todayInRange && nowMinutes >= slotMinTimeMinutes && nowMinutes < slotMaxTimeMinutes
      ? nowMinutes
      : null;

  return {
    type: 'resource',
    date: firstDayInfo.date,
    dateKey: firstDayInfo.key,
    isToday: firstDayInfo.isToday,
    days,
    columns,
    isEmpty: columns.length === 0,
    slots,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    nowIndicatorMinutes,
    businessHourSlots: firstDayInfo.businessHourSlots,
  };
}
