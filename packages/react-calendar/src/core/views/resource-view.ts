/**
 * @packageDocumentation
 * リソースビューのビューモデル構築。
 *
 * 1 日の時間グリッドを「列 = リソース」で描くためのビューモデルを構築する。
 * 週/日ビューの「列 = 日」を「列 = リソース」に置き換えたもので、
 * 列内の配置計算（日内クランプ・重なりの横並び）は週/日ビューと共有の
 * ヘルパ（{@link ./time-grid-view} の `buildDayItems` 等）に委譲する。
 *
 * オカレンス → 列の振り分けは `event.resourceId` に基づく 1 パスのバケット分けで行い、
 * 「列ごとに全オカレンスをフィルタ」する O(列数 × 全件) の走査はしない。
 */

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
  ResourceViewModel,
  TimeZoneId,
} from '../types';
import { laneKeyForResource, UNASSIGNED_LANE_KEY } from './lane-key';
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
 * リソースビューのビューモデルを構築する。
 *
 * 処理内容:
 * - 表示日は `currentDate` の属する日（{@link startOfDayInZone}）の 1 日固定。
 *   `hiddenWeekdays` は日ビューと同じく適用しない
 * - リソース一覧を先頭から走査し、**ID 重複は先勝ち**で列にする
 *   （2 つ目以降の同 ID リソースは列を作らない。開発ビルドの警告は React 層の責務）
 * - オカレンスを `event.resourceId` で 1 パスのバケット分けする。
 *   `resourceId` が未指定、または `resources` に存在しない ID（参照先のない
 *   resourceId）の場合は未割り当てレーンに合流する（黙って非表示にしない）
 * - 未割り当て列は {@link CalendarOptions.unassignedLane} の規則で生成する
 *   （`'auto'` = 該当オカレンスがある場合のみ、`'always'` = 常に）
 * - 各列で、終日行行きのオカレンス（{@link belongsToAllDayRow} の判定）は
 *   `allDayItems` に整列して入れ、それ以外は {@link buildDayItems} で
 *   日内クランプ・重なりの横並びを計算して `items` に入れる
 *
 * @param params.currentDate - 表示日に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 表示日範囲で展開済みのオカレンス一覧
 * @param params.resources - リソース一覧（表示順）
 * @param params.unassignedLane - 未割り当てレーンの生成規則
 * @param params.slotMinutes - 時間軸の目盛り間隔（分）
 * @param params.now - 現在時刻（`isToday` 判定・現在時刻線に使用）
 * @param params.businessHours - 営業時間の指定一覧（{@link ResourceViewModel.businessHourSlots}
 *   を算出する）。リソースビューは表示日が単日のため、表示日の曜日を基準に 1 本だけ生成し
 *   全列で共有する。省略時は `[]`（すべて `isBusinessHours: false`）
 * @param params.slotMinTime - 表示する時間帯の開始（`'HH:mm'` 形式）。省略時は `'00:00'`
 * @param params.slotMaxTime - 表示する時間帯の終了（`'HH:mm'` 形式、排他的。`'24:00'` も可）。
 *   省略時は `'24:00'`
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
  now: Date;
  businessHours?: readonly BusinessHoursRule[];
  slotMinTime?: string;
  slotMaxTime?: string;
}): ResourceViewModel {
  const {
    currentDate,
    timeZone,
    occurrences,
    resources,
    unassignedLane,
    slotMinutes,
    now,
    businessHours = [],
    slotMinTime = '00:00',
    slotMaxTime = '24:00',
  } = params;
  const slotMinTimeMinutes = parseSlotBoundaryTime(slotMinTime);
  const slotMaxTimeMinutes = parseSlotBoundaryTime(slotMaxTime);

  const date = startOfDayInZone(currentDate, timeZone);
  const dateKey = dateKeyInZone(date, timeZone);
  // 翌日の 0:00（排他端）。深夜 0:00 が存在しないゾーンに備えて日の開始へ再正規化する
  const dayEnd = startOfDayInZone(addDaysInZone(date, 1, timeZone), timeZone);
  const isToday = isSameDayInZone(date, now, timeZone);

  // ID 重複を先勝ちで除いたリソース列の並び
  const uniqueResources: CalendarResource[] = [];
  const resourceById = new Map<string, CalendarResource>();
  for (const entry of resources) {
    if (!resourceById.has(entry.id)) {
      resourceById.set(entry.id, entry);
      uniqueResources.push(entry);
    }
  }

  // オカレンス → レーン ID（リソース ID または null = 未割り当て）の 1 パスのバケット分け
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

  /** 1 レーン分のオカレンスから列の中身（終日・時間指定）を構築する。 */
  function buildColumnItems(laneOccurrences: readonly EventOccurrence[]): {
    items: ResourceColumn['items'];
    allDayItems: ResourceColumn['allDayItems'];
  } {
    const allDayItems: EventOccurrence[] = [];
    const timed: EventOccurrence[] = [];
    for (const occurrence of laneOccurrences) {
      if (belongsToAllDayRow(occurrence, timeZone)) {
        allDayItems.push(occurrence);
      } else {
        timed.push(occurrence);
      }
    }
    allDayItems.sort(compareAllDayItems);
    return {
      items: buildDayItems(timed, {
        dayStart: date,
        dayEnd,
        timeZone,
        displayStartMinutes: slotMinTimeMinutes,
        displayEndMinutes: slotMaxTimeMinutes,
      }),
      allDayItems,
    };
  }

  const columns: ResourceColumn[] = uniqueResources.map((entry) => ({
    resource: entry,
    key: resourceColumnKey(entry.id),
    ...buildColumnItems(bucket.get(entry.id) ?? []),
  }));

  const unassignedOccurrences = bucket.get(null) ?? [];
  if (unassignedLane === 'always' || unassignedOccurrences.length > 0) {
    columns.push({
      resource: null,
      key: UNASSIGNED_KEY,
      ...buildColumnItems(unassignedOccurrences),
    });
  }

  const slots = buildSlots(slotMinutes, slotMinTimeMinutes, slotMaxTimeMinutes);
  // リソースビューは表示日が単日のため、その日の曜日を基準に 1 本だけ生成し全列で共有する
  // （列ごとの再計算はしない。businessHours 未指定時は buildBusinessHourSlots がすべて
  // isBusinessHours: false の配列を返すため、追加の分岐なしで従来の出力と一致する）
  const businessHourSlots = buildBusinessHourSlots(
    slots,
    weekdayInZone(date, timeZone),
    businessHours,
  );

  // 現在時刻線: 表示日が今日、かつ現在時刻が表示時間帯
  // （slotMinTimeMinutes〜slotMaxTimeMinutes）の内側にある場合のみ分を返す。
  const nowMinutes = minutesOfDayInZone(now, timeZone);
  const nowIndicatorMinutes =
    isToday && nowMinutes >= slotMinTimeMinutes && nowMinutes < slotMaxTimeMinutes
      ? nowMinutes
      : null;

  return {
    type: 'resource',
    date,
    dateKey,
    isToday,
    columns,
    isEmpty: columns.length === 0,
    slots,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    nowIndicatorMinutes,
    businessHourSlots,
  };
}
