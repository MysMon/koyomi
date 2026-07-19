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
  ResourceColumnGroupCell,
  ResourceViewDay,
  ResourceViewModel,
  TimeZoneId,
} from '../types';
import { laneDayColumnKey, laneKeyForResource, UNASSIGNED_LANE_KEY } from './lane-key';
import {
  buildResourceTree,
  filterVisibleResourceTree,
  type VisibleResourceTreeEntry,
} from './resource-hierarchy';
import {
  belongsToAllDayRow,
  buildBusinessHourSlots,
  buildDayItems,
  buildSlots,
} from './time-grid-view';

/** 未割り当て列のキー（{@link UNASSIGNED_LANE_KEY} の別名。既存コードの可読性のため）。 */
const UNASSIGNED_KEY = UNASSIGNED_LANE_KEY;

/**
 * `collapsedResourceIds` 未指定時に共有する空集合。
 * 呼び出しのたびに新しい `Set` を割り当てないよう、モジュールで 1 本だけ保持する
 * （{@link ./timeline-view} の同名定数と同じ短絡方針）。
 */
const EMPTY_COLLAPSED_RESOURCE_IDS: ReadonlySet<string> = new Set();

/**
 * 子を持つリソースが 1 件もない（フラット構成の）場合に共有する空のグループ行一覧。
 * 呼び出しのたびに新しい配列を割り当てないよう、モジュールで 1 本だけ保持する。
 */
const EMPTY_COLUMN_GROUP_ROWS: readonly (readonly ResourceColumnGroupCell[])[] = [];

/**
 * 可視ツリーから列グループ見出しの行（{@link ResourceViewModel.columnGroupRows}）を構築する。
 *
 * 行は深さ 0 から「子を持つ可視エントリの最大深さ」まで。各行では、可視エントリを
 * 先頭から走査し、その深さにおける「グループ所有者」（深さが一致し子を持つエントリ
 * 自身、またはその深さの祖先）が同じ連続区間を 1 つのグループセルにまとめる。
 * 所有者のない区間（フラットなリソース・グループより浅い列・末尾の未割り当て列）は
 * スペーサーセル（`resource: null`）にまとめ、各行が全列を隙間なく覆うようにする。
 *
 * @param visibleTree - 折りたたみ適用後の可視エントリ一覧（列の並びと同順）
 * @param dayCount - 表示日数（1 リソースあたりの列数）
 * @param totalColumnCount - 未割り当て列を含む全列数
 * @returns グループ見出しの行一覧。子を持つリソースがなければ空配列
 */
function buildColumnGroupRows(
  visibleTree: readonly VisibleResourceTreeEntry[],
  dayCount: number,
  totalColumnCount: number,
): readonly (readonly ResourceColumnGroupCell[])[] {
  const maxGroupDepth = visibleTree.reduce(
    (max, entry) => (entry.hasChildren ? Math.max(max, entry.depth) : max),
    -1,
  );
  if (maxGroupDepth < 0) {
    return EMPTY_COLUMN_GROUP_ROWS;
  }

  const rows: (readonly ResourceColumnGroupCell[])[] = [];
  for (let depth = 0; depth <= maxGroupDepth; depth += 1) {
    const cells: ResourceColumnGroupCell[] = [];
    /** 連続する同一所有者（またはスペーサー）の区間。 */
    let run: { owner: VisibleResourceTreeEntry | null; startColumnIndex: number } | null = null;

    /** 現在の区間を `endColumnIndex`（排他）までのセルとして確定する。 */
    function flushRun(endColumnIndex: number): void {
      if (run === null || endColumnIndex <= run.startColumnIndex) {
        return;
      }
      const owner = run.owner;
      cells.push({
        resource: owner?.resource ?? null,
        key: owner !== null ? laneKeyForResource(owner.resource.id) : `gap:${run.startColumnIndex}`,
        startColumnIndex: run.startColumnIndex,
        columnCount: endColumnIndex - run.startColumnIndex,
        collapsed: owner?.collapsed ?? false,
        depth,
      });
    }

    // 各エントリのこの深さでの所有者を、祖先スタック（深さ順の直近の祖先）で求める。
    // ツリー順（深さ優先の行き掛け順）のため、深さ d のエントリの直前には必ず
    // 深さ d-1 以下の祖先が現れている
    const ancestorStack: VisibleResourceTreeEntry[] = [];
    // forEach ではなく for ループにする（コールバック内での `run` への代入は
    // TypeScript の制御フロー解析に反映されず、ループ後の絞り込みが壊れるため）
    for (let entryIndex = 0; entryIndex < visibleTree.length; entryIndex += 1) {
      const entry = visibleTree[entryIndex];
      if (entry === undefined) {
        continue;
      }
      ancestorStack.length = entry.depth;
      ancestorStack.push(entry);
      let owner: VisibleResourceTreeEntry | null = null;
      if (entry.depth === depth) {
        owner = entry.hasChildren ? entry : null;
      } else if (entry.depth > depth) {
        owner = ancestorStack[depth] ?? null;
      }
      const columnIndex = entryIndex * dayCount;
      if (run === null) {
        run = { owner, startColumnIndex: columnIndex };
      } else if (run.owner !== owner) {
        flushRun(columnIndex);
        run = { owner, startColumnIndex: columnIndex };
      }
    }
    // 末尾の未割り当て列（存在する場合）はどのグループにも属さないスペーサーで覆う
    const resourceColumnCount = visibleTree.length * dayCount;
    if (totalColumnCount > resourceColumnCount) {
      if (run === null) {
        run = { owner: null, startColumnIndex: resourceColumnCount };
      } else if (run.owner !== null) {
        flushRun(resourceColumnCount);
        run = { owner: null, startColumnIndex: resourceColumnCount };
      }
    }
    flushRun(totalColumnCount);
    rows.push(cells);
  }
  return rows;
}

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
 * - リソース一覧は {@link buildResourceTree} でツリー順（**ID 重複は先勝ち**、
 *   {@link CalendarResource.parentId} による深さ優先の行き掛け順）に並べ、
 *   {@link filterVisibleResourceTree} で `collapsedResourceIds` に含まれる祖先を持つ
 *   列（折りたたみ中の子孫）を除外する（{@link ./timeline-view} と同じ規則。
 *   `parentId` 未使用時は `resources` の並び順のフラットな列になる）
 * - 列はリソース × 日の直積（リソース優先。各リソースの中に表示日が昇順で並ぶ）。
 *   表示日数 1 の列キーは `` `r:${id}` `` / `'unassigned'`、2 以上は
 *   {@link laneDayColumnKey} による日付キー付きの形式になる
 * - 子を持つリソースがある場合、{@link buildColumnGroupRows} で列グループ見出しの
 *   行（{@link ResourceViewModel.columnGroupRows}）を構築する
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
 * @param params.collapsedResourceIds - 折りたたみ中のリソース ID の集合
 *   （{@link CalendarState.collapsedResourceIds}）。省略時は `[]`（全展開）扱い
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
  collapsedResourceIds?: ReadonlySet<string>;
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
    collapsedResourceIds = EMPTY_COLLAPSED_RESOURCE_IDS,
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

  // ID 重複を先勝ちで除いたうえで parentId によるツリー順に並べる（可視・非可視を問わず全件）
  const tree = buildResourceTree(resources);
  // resourceById は「重複除去後に実在する ID か」の判定に使う（可視性とは無関係。
  // 折りたたみで非表示中の列に割り当てられたオカレンスも、未割り当てへは合流させない）
  const resourceById = new Map<string, CalendarResource>(
    tree.map((entry) => [entry.resource.id, entry.resource]),
  );
  // 折りたたみ中の祖先を持つ列（非表示の子孫）を除いた、実際に列を生成する対象
  const visibleTree = filterVisibleResourceTree(tree, collapsedResourceIds);

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

  /**
   * 1 レーン分のオカレンスから、表示日ごとの列（リソース × 日）を構築する。
   * @param hierarchy - 階層情報（ツリー内の深さ・子の有無・折りたたみ状態）。
   *   未割り当てレーンは常に `depth: 0` / `hasChildren: false` / `collapsed: false`
   */
  function buildLaneColumns(
    resource: CalendarResource | null,
    laneKey: string,
    laneOccurrences: readonly EventOccurrence[],
    hierarchy: Pick<ResourceColumn, 'depth' | 'hasChildren' | 'collapsed'>,
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
        ...hierarchy,
      };
    });
  }

  const columns: ResourceColumn[] = visibleTree.flatMap((entry) =>
    buildLaneColumns(
      entry.resource,
      resourceColumnKey(entry.resource.id),
      bucket.get(entry.resource.id) ?? [],
      { depth: entry.depth, hasChildren: entry.hasChildren, collapsed: entry.collapsed },
    ),
  );

  const unassignedOccurrences = bucket.get(null) ?? [];
  if (unassignedLane === 'always' || unassignedOccurrences.length > 0) {
    // 未割り当て列はツリーの対象にしないため、階層に関する各フィールドは常に固定値
    columns.push(
      ...buildLaneColumns(null, UNASSIGNED_KEY, unassignedOccurrences, {
        depth: 0,
        hasChildren: false,
        collapsed: false,
      }),
    );
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
    columnGroupRows: buildColumnGroupRows(visibleTree, dayCount, columns.length),
    isEmpty: columns.length === 0,
    slots,
    slotMinTimeMinutes,
    slotMaxTimeMinutes,
    nowIndicatorMinutes,
    businessHourSlots: firstDayInfo.businessHourSlots,
  };
}
