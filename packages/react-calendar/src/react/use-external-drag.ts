/**
 * @packageDocumentation
 * カレンダー外部の DOM 要素からのドラッグ受け入れ（FullCalendar の
 * `Draggable` 相当）。
 *
 * 外部要素（サイドバーの予定テンプレートなど）に `pointerdown` を起点とする
 * ドラッグセッションを開始し、カレンダー上のドロップ先を日時・（リソース/
 * タイムラインビューでは）リソースへ解決する。プレビュー表示は既存の仕組み
 * （`api.setDragPreview` / 各ビューの内部ドラッグフックが読む
 * `state.dragPreview`）をそのまま再利用する。カレンダー本体の DOM
 * （`data-koyomi-*` 属性）を `document.elementFromPoint` でヒットテストする
 * ため、対応ビューが実際に描画されている必要がある。ヒットテストの候補は
 * {@link UseExternalDragParams.containerRef} が指す要素の内側に限定する。
 * これにより、同じビュー種別のカレンダーがページ上に複数存在していても、
 * ドラッグ元とは別のカレンダーの DOM 上へのドロップを誤って受理しない。
 *
 * イベントの作成自体はこのフックの責務ではない（ヘッドレス原則）。
 * ドロップが確定すると {@link UseExternalDragParams.onExternalDrop} を呼ぶだけで、
 * `calendar.api.createEvent` を呼ぶかどうかはアプリ側に委ねる。
 *
 * 月ビューのイベント帯・終日行のイベントなど、セルの「上に重ねて」描画される
 * オーバーレイ要素はセル自体の兄弟要素であり祖先ではないため、ポインタ直下の
 * 最前面要素だけを見る `closest()` では既存イベントの上にドロップされたときに
 * セルへたどり着けない。これを避けるため、重なり順で複数要素を返す
 * `document.elementsFromPoint`（手前から奥へ）を使い、セルに到達するまで候補を
 * 順に見る（{@link resolveExternalDrop} 参照）。
 *
 * 対応ビュー: 月・週/日（時間グリッド本体＋終日行）・リソース・タイムライン。
 * リスト・年・複数月ビューは対象外（ドロップ先が解決できず常にキャンセル扱いになる）。
 *
 * Escape キー・`pointercancel`、およびドロップ先が解決できなかった場合は
 * 既存のドラッグ系フックと同じ流儀でコールバックを発火させずに中断する。
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isDragCandidateValid,
  type OverlapBlocker,
  occurrenceBlocksOverlap,
  resolveConstraintRules,
} from '../core/constraints';
import { timeAtGridPosition, timeAtTimelineOffset } from '../core/interaction';
import { addDaysInZone, addMinutesInZone, dateFromKey } from '../core/timezone';
import type { CalendarViewModel, DateRange, EventOccurrence, TimeZoneId } from '../core/types';
import { resourceIdFromLaneKey } from '../core/views/lane-key';
import { attachDragSessionListeners } from './drag-common';
import type { UseCalendarResult } from './types';

/** 1 日の分（24:00 = 1440 分）。 */
const MINUTES_PER_DAY = 1440;

/**
 * ドロップ確定・プレビュー更新時に渡す情報。
 *
 * @typeParam TPayload - {@link useExternalDrag} の呼び出し側が
 *   `getDraggableProps` に渡す任意のペイロードの型
 */
export interface ExternalDropInfo<TPayload> {
  /** ドロップ位置から解決された日時範囲（`end` は排他的）。 */
  range: DateRange;
  /** 終日枠（月ビューのセル・終日行）へのドロップかどうか。 */
  allDay: boolean;
  /**
   * ドロップ先レーンのリソース ID。リソース/タイムラインビューへの
   * ドロップ時のみ設定される（`null` は未割り当てレーン）。
   * それ以外のビューでは省略される。
   */
  resourceId?: string | null;
  /** {@link useExternalDrag} の `getDraggableProps` に渡した任意のペイロード。 */
  payload: TPayload;
}

/**
 * {@link useExternalDrag} のパラメータ。
 *
 * @typeParam TPayload - ドラッグ対象ごとに紐づける任意のペイロードの型
 */
export interface UseExternalDragParams<TPayload> {
  /** `useCalendar` の戻り値。 */
  calendar: UseCalendarResult;
  /**
   * このカレンダーインスタンスが描画される DOM のルート要素（`CalendarProvider`
   * を囲む `div` など）への ref。ドロップ先のヒットテスト（{@link resolveExternalDrop}）
   * は、この要素の内側にある `data-koyomi-*` 要素のみを候補にする。
   *
   * ページ上に同じビュー種別のカレンダーが複数存在する場合、これを指定しないと
   * ドラッグ元とは別のカレンダーの DOM 上へのドロップを誤って受理してしまう
   * （`document.elementsFromPoint` はカレンダーの区別なくヒットするため）。
   * `current` が `null` の間（マウント前など）はヒットテストを行わずキャンセル
   * 扱いにする。
   */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * カレンダー上へのドロップが確定したときに呼ばれる。
   * イベントの作成自体はここで行わず、呼び出し側（アプリ）に委ねる。
   */
  onExternalDrop: (info: ExternalDropInfo<TPayload>) => void;
  /**
   * `onExternalDrop` が例外を投げた場合に呼ばれる。
   * 省略時は `console.error` に出力する。
   */
  onError?: (error: unknown) => void;
}

/** 外部要素（ドラッグ元）に付与する props。 */
export interface ExternalDraggableProps {
  /** ドラッグを開始する（主ボタン以外は無視する）。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** {@link useExternalDrag} が返すハンドラ集。 */
export interface ExternalDragHandlers<TPayload> {
  /**
   * 外部要素に付与する props を返す。
   * @param payload - ドロップ確定時に {@link ExternalDropInfo.payload} として渡す任意のデータ
   */
  getDraggableProps(payload: TPayload): ExternalDraggableProps;
  /** 外部ドラッグが進行中か。 */
  isDragging: boolean;
}

/** ドロップ先の解決結果（内部用）。 */
interface ExternalDropResolution {
  /** 解決された日時範囲。 */
  range: DateRange;
  /** 終日としての解決か。 */
  allDay: boolean;
  /**
   * 解決されたリソース ID。リソース/タイムラインビューでの解決時のみ設定する
   * （`resourceId` キー自体を持たない場合は既存ビューとして扱う）。
   */
  resourceId?: string | null;
}

// 列/行キー（ResourceColumn.key / TimelineRow.key）のデコードは、エンコーダと
// 対で管理される core/views/lane-key.ts の resourceIdFromLaneKey を使う
// （リテラルの直書き再実装は形式変更時に静かに壊れるため禁止）

/** 矩形内での座標の割合（0〜1）を求める。矩形のサイズが 0 以下なら 0（0 除算防止）。 */
function fractionAlong(start: number, size: number, pointer: number): number {
  if (size <= 0) {
    return 0;
  }
  return (pointer - start) / size;
}

/**
 * ポインタ位置（`clientX`/`clientY`）の直下にある要素を、描画上の重なり順
 * （手前 → 奥）で列挙する。
 *
 * `document.elementsFromPoint` が使える環境ではそれをそのまま使う。使えない
 * 環境（旧ブラウザ等）では `document.elementFromPoint` の単一要素にフォール
 * バックする。カレンダー本体は月ビューのイベント帯・終日行のイベントなど、
 * セルの「上に重ねて」描画される要素（セルの兄弟要素）を持つため、直下の
 * 最前面要素 1 つだけでは目的のセルへ `closest()` でたどり着けないことがある。
 * 重なり順で複数候補を見ることで、それらの背後にあるセル自体にも到達できる
 * ようにする。
 *
 * @param clientX - ビューポート基準の X 座標
 * @param clientY - ビューポート基準の Y 座標
 * @returns 手前から奥への要素の配列（該当なしは空配列）
 */
function elementsAtPoint(clientX: number, clientY: number): readonly Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(clientX, clientY);
  }
  if (typeof document.elementFromPoint === 'function') {
    const element = document.elementFromPoint(clientX, clientY);
    return element === null ? [] : [element];
  }
  return [];
}

/**
 * 候補要素（手前から奥の順）から `selector` にマッチするセルを解決する。
 *
 * まず「候補自身がセルにマッチするもの」を優先する。イベントの帯は DOM 上は
 * 開始日の gridcell の子として描画される（ARIA 上の所有関係の要請）ため、
 * 最前面要素（帯）から `closest()` で辿ると、ポインタが帯の何日目にあっても
 * 常に開始日のセルへ解決してしまう。`elementsFromPoint` の列挙にはポインタ
 * 直下のセル自身も含まれるので、自身マッチを優先すれば正しい日へ解決できる。
 *
 * どの候補も自身はマッチしない場合のみ、祖先を辿るフォールバックを行う
 * （セル内の日番号ボタン等だけがヒットする構成や、単一要素の
 * `elementFromPoint` しか使えない環境向け。この場合は候補がセルの子孫で
 * あることが前提なので `closest()` で正しいセルに到達できる）。
 *
 * @param elements - {@link elementsAtPoint} が返す候補（手前から奥の順）
 * @param selector - 探すセルの CSS セレクタ（`data-koyomi` 属性セレクタ）
 * @returns 解決された `HTMLElement`。どの候補からも解決できなければ `null`
 */
function closestAmong(elements: readonly Element[], selector: string): HTMLElement | null {
  for (const element of elements) {
    if (element instanceof HTMLElement && element.matches(selector)) {
      return element;
    }
  }
  for (const element of elements) {
    const match = element.closest(selector);
    if (match instanceof HTMLElement) {
      return match;
    }
  }
  return null;
}

/** 月ビューでの解決（日セル → 終日 1 日分の範囲）。対象セルが見つからなければ `null`。 */
function resolveMonthDrop(
  elements: readonly Element[],
  timeZone: TimeZoneId,
): ExternalDropResolution | null {
  const cell = closestAmong(elements, '[data-koyomi="month-day"]');
  if (cell === null) {
    return null;
  }
  const dateKey = cell.getAttribute('data-koyomi-date');
  if (dateKey === null) {
    return null;
  }
  const start = dateFromKey(dateKey, timeZone);
  return { range: { start, end: addDaysInZone(start, 1, timeZone) }, allDay: true };
}

/**
 * 週/日ビュー（時間グリッド）での解決。
 * 終日行のセル（`allday-cell`）なら終日 1 日分の範囲、時間グリッドの日列
 * （`timegrid-day`）ならポインタの縦位置から算出した時間指定の範囲を返す。
 * どちらにも該当しなければ `null`。
 */
function resolveTimeGridDrop(
  elements: readonly Element[],
  clientY: number,
  context: { timeZone: TimeZoneId; snap: number; defaultEventMinutes: number },
): ExternalDropResolution | null {
  const { timeZone, snap, defaultEventMinutes } = context;
  const alldayCell = closestAmong(elements, '[data-koyomi="allday-cell"]');
  if (alldayCell !== null) {
    const dateKey = alldayCell.getAttribute('data-koyomi-date');
    if (dateKey === null) {
      return null;
    }
    const start = dateFromKey(dateKey, timeZone);
    return { range: { start, end: addDaysInZone(start, 1, timeZone) }, allDay: true };
  }
  const dayColumn = closestAmong(elements, '[data-koyomi="timegrid-day"]');
  if (dayColumn === null) {
    return null;
  }
  const dateKey = dayColumn.getAttribute('data-koyomi-date');
  if (dateKey === null) {
    return null;
  }
  const day = dateFromKey(dateKey, timeZone);
  const rect = dayColumn.getBoundingClientRect();
  const start = timeAtGridPosition({
    day,
    fractionY: fractionAlong(rect.top, rect.height, clientY),
    timeZone,
    snap,
  });
  return {
    range: { start, end: addMinutesInZone(start, defaultEventMinutes, timeZone) },
    allDay: false,
  };
}

/**
 * リソースビューでの解決。
 * 終日行のセル（`resource-allday-cell`）なら終日 1 日分の範囲＋リソース ID、
 * 列（`resource-column`）ならポインタの縦位置から算出した時間指定の範囲＋
 * リソース ID を返す。どちらにも該当しなければ `null`。
 */
function resolveResourceDrop(
  elements: readonly Element[],
  clientY: number,
  context: { timeZone: TimeZoneId; snap: number; defaultEventMinutes: number; day: Date },
): ExternalDropResolution | null {
  const { timeZone, snap, defaultEventMinutes, day } = context;
  const alldayCell = closestAmong(elements, '[data-koyomi="resource-allday-cell"]');
  if (alldayCell !== null) {
    const resourceId = resourceIdFromLaneKey(alldayCell.getAttribute('data-koyomi-resource'));
    return {
      range: { start: day, end: addDaysInZone(day, 1, timeZone) },
      allDay: true,
      resourceId,
    };
  }
  const column = closestAmong(elements, '[data-koyomi="resource-column"]');
  if (column === null) {
    return null;
  }
  const resourceId = resourceIdFromLaneKey(column.getAttribute('data-koyomi-resource'));
  const rect = column.getBoundingClientRect();
  const start = timeAtGridPosition({
    day,
    fractionY: fractionAlong(rect.top, rect.height, clientY),
    timeZone,
    snap,
  });
  return {
    range: { start, end: addMinutesInZone(start, defaultEventMinutes, timeZone) },
    allDay: false,
    resourceId,
  };
}

/**
 * タイムラインビューでの解決。
 * 行（`timeline-row`）ならポインタの横位置（表示分）から算出した時間指定の
 * 範囲＋リソース ID を返す。行が見つからない・表示日が 1 日もなければ `null`。
 * タイムラインには月/週日ビューのような別枠の終日領域がないため、常に
 * 時間指定（`allDay: false`）として解決する。
 */
function resolveTimelineDrop(
  elements: readonly Element[],
  clientX: number,
  context: {
    timeZone: TimeZoneId;
    snap: number;
    defaultEventMinutes: number;
    days: readonly Date[];
  },
): ExternalDropResolution | null {
  const { timeZone, snap, defaultEventMinutes, days } = context;
  if (days.length === 0) {
    return null;
  }
  const row = closestAmong(elements, '[data-koyomi="timeline-row"]');
  if (row === null) {
    return null;
  }
  const resourceId = resourceIdFromLaneKey(row.getAttribute('data-koyomi-resource'));
  const rect = row.getBoundingClientRect();
  const fraction = fractionAlong(rect.left, rect.width, clientX);
  const displayMinutes = fraction * days.length * MINUTES_PER_DAY;
  const start = timeAtTimelineOffset({ days, displayMinutes, timeZone, snap });
  return {
    range: { start, end: addMinutesInZone(start, defaultEventMinutes, timeZone) },
    allDay: false,
    resourceId,
  };
}

/**
 * ポインタ位置の直下の要素（{@link elementsAtPoint}）のうち、`container` の
 * 内側にあるものだけを、重なり順（手前から奥）を保ったまま返す。
 *
 * `document.elementsFromPoint` はカレンダーの区別なくページ全体の要素を返す
 * ため、ページ上に同じビュー種別のカレンダーが複数存在する場合、フィルタなしでは
 * 別カレンダーの `data-koyomi-*` 要素にヒットしてしまう。`container`（そのカレンダー
 * インスタンスの DOM ルート）の子孫でない要素をここで除外することで、以降の
 * `closestAmong` によるセレクタ探索が他カレンダーの要素まで `closest()` で
 * 遡ってしまうことも防ぐ。
 *
 * @param elements - {@link elementsAtPoint} が返す候補（手前から奥の順）
 * @param container - ヒットテストの対象とするカレンダーインスタンスの DOM ルート
 * @returns `container` 自身または `container` の子孫のみに絞った要素列（順序は維持）
 */
function elementsWithinContainer(
  elements: readonly Element[],
  container: HTMLElement,
): readonly Element[] {
  return elements.filter((element) => container.contains(element));
}

/**
 * ポインタ位置の直下の要素（{@link elementsAtPoint}）から、現在のビューに
 * 応じたドロップ先（日時範囲・終日か・リソース ID）を解決する。
 * `document.elementFromPoint` / `elementsFromPoint` のいずれも使えない環境、
 * 対応ビューでない場合（リスト・年・複数月ビュー等）、`container` の内側に
 * 対応する要素が見つからない場合は `null`。
 *
 * @param container - ヒットテストの対象を限定するカレンダーインスタンスの DOM
 *   ルート（{@link UseExternalDragParams.containerRef} の `current`）。これの
 *   子孫でない要素（他カレンダーの DOM 等）はヒットテストの候補から除外する
 */
function resolveExternalDrop(
  clientX: number,
  clientY: number,
  calendar: UseCalendarResult,
  container: HTMLElement,
): ExternalDropResolution | null {
  const elements = elementsWithinContainer(elementsAtPoint(clientX, clientY), container);
  if (elements.length === 0) {
    return null;
  }
  const { state, viewModel } = calendar;
  const { timeZone, options } = state;
  const context = {
    timeZone,
    snap: options.snapMinutes,
    defaultEventMinutes: options.defaultEventMinutes,
  };
  switch (viewModel.type) {
    case 'month':
      return resolveMonthDrop(elements, timeZone);
    case 'timeGrid':
      return resolveTimeGridDrop(elements, clientY, context);
    case 'resource':
      return resolveResourceDrop(elements, clientY, { ...context, day: viewModel.date });
    case 'timeline':
      return resolveTimelineDrop(elements, clientX, {
        ...context,
        days: viewModel.days.map((day) => day.date),
      });
    default:
      return null;
  }
}

/**
 * レーンの区別がないビュー（月・週/日・複数月）の重なり判定用ブロッカー一覧
 * （表示中の全オカレンス）を構築する。時間指定・終日の両方を対象にする。
 */
function collectFlatBlockers(
  viewModel: CalendarViewModel,
  eventOverlap: boolean,
): readonly OverlapBlocker[] {
  const blockers = new Map<string, OverlapBlocker>();
  const addOccurrence = (occurrence: EventOccurrence): void => {
    if (blockers.has(occurrence.key)) {
      return;
    }
    blockers.set(occurrence.key, {
      key: occurrence.key,
      start: occurrence.start,
      end: occurrence.end,
      blocksOverlap: occurrenceBlocksOverlap(occurrence.event, eventOverlap),
    });
  };
  if (viewModel.type === 'month') {
    for (const week of viewModel.weeks) {
      for (const segment of week.segments) {
        addOccurrence(segment.occurrence);
      }
    }
  } else if (viewModel.type === 'multiMonth') {
    for (const month of viewModel.months) {
      for (const week of month.weeks) {
        for (const segment of week.segments) {
          addOccurrence(segment.occurrence);
        }
      }
    }
  } else if (viewModel.type === 'timeGrid') {
    for (const day of viewModel.days) {
      for (const item of day.items) {
        addOccurrence(item.occurrence);
      }
    }
    for (const segment of viewModel.allDaySegments) {
      addOccurrence(segment.occurrence);
    }
  }
  return [...blockers.values()];
}

/**
 * レーン（リソース ID。未割り当ては `null`）ごとの重なり判定用ブロッカー一覧を構築する
 * （リソース/タイムラインビュー専用）。
 */
function collectBlockersByLane(
  viewModel: CalendarViewModel,
  eventOverlap: boolean,
): Map<string | null, readonly OverlapBlocker[]> {
  const result = new Map<string | null, readonly OverlapBlocker[]>();
  const buildLane = (
    laneId: string | null,
    occurrences: readonly EventOccurrence[],
    existing: readonly EventOccurrence[],
  ): void => {
    const lane = new Map<string, OverlapBlocker>();
    const addOccurrence = (occurrence: EventOccurrence): void => {
      if (lane.has(occurrence.key)) {
        return;
      }
      lane.set(occurrence.key, {
        key: occurrence.key,
        start: occurrence.start,
        end: occurrence.end,
        blocksOverlap: occurrenceBlocksOverlap(occurrence.event, eventOverlap),
      });
    };
    for (const occurrence of occurrences) {
      addOccurrence(occurrence);
    }
    for (const occurrence of existing) {
      addOccurrence(occurrence);
    }
    result.set(laneId, [...lane.values()]);
  };
  if (viewModel.type === 'resource') {
    for (const column of viewModel.columns) {
      buildLane(
        column.resource?.id ?? null,
        column.items.map((item) => item.occurrence),
        column.allDayItems,
      );
    }
  } else if (viewModel.type === 'timeline') {
    for (const row of viewModel.rows) {
      buildLane(
        row.resource?.id ?? null,
        row.items.map((item) => item.occurrence),
        [],
      );
    }
  }
  return result;
}

/**
 * カレンダー外部の DOM 要素からのドラッグを受け入れるフック。
 *
 * `getDraggableProps(payload)` が返す props を外部要素（サイドバーの予定
 * テンプレートなど）にスプレッドすると、その要素からの `pointerdown` で
 * ドラッグセッションが始まる。ドラッグ中はポインタ直下のカレンダー要素から
 * ドロップ先を解決し、既存のプレビュー機構（`api.setDragPreview`）でカレンダー
 * 上にハイライト表示する。`pointerup` でドロップ先が解決できれば
 * `onExternalDrop` を呼ぶ（`payload` はドロップ確定時にそのまま渡される）。
 *
 * Escape キー・`pointercancel`、およびドロップ先が解決できなかった場合は
 * `onExternalDrop` を呼ばずに中断する（他のドラッグ系フックと同じ流儀）。
 *
 * @param params.calendar - `useCalendar` の戻り値
 * @param params.containerRef - このカレンダーインスタンスの DOM ルートへの ref。
 *   ドロップ先のヒットテストをこの要素の内側に限定する（他カレンダーへの誤ヒット防止）
 * @param params.onExternalDrop - ドロップ確定時に呼ばれるコールバック
 * @param params.onError - `onExternalDrop` が例外を投げた場合のハンドラ（省略時は console.error）
 * @example
 * ```tsx
 * const calendar = useCalendar({ initialView: 'week' });
 * const containerRef = useRef<HTMLDivElement>(null);
 * const externalDrag = useExternalDrag({
 *   calendar,
 *   containerRef,
 *   onExternalDrop: ({ range, allDay, payload }) => {
 *     calendar.api.createEvent({ title: payload.title, start: range.start, end: range.end, allDay });
 *   },
 * });
 * return (
 *   <div>
 *     <div {...externalDrag.getDraggableProps({ title: '外部の予定' })}>外部の予定</div>
 *     <div ref={containerRef}>
 *       <CalendarProvider value={calendar}><TimeGridView /></CalendarProvider>
 *     </div>
 *   </div>
 * );
 * ```
 */
export function useExternalDrag<TPayload>(
  params: UseExternalDragParams<TPayload>,
): ExternalDragHandlers<TPayload> {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  /** 進行中のドラッグセッションの後始末関数（非ドラッグ中は `null`）。 */
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /**
   * 重なり判定用のブロッカー一覧。レーンの区別がないビュー（月・週/日・複数月）用の
   * 平坦な一覧と、リソース/タイムラインビュー用のレーン別一覧の両方を用意する。
   * `calendar.viewModel` が変わらない限り再計算しない（毎 pointermove の再計算を避ける）。
   */
  const flatBlockers = useMemo(
    () =>
      collectFlatBlockers(params.calendar.viewModel, params.calendar.state.options.eventOverlap),
    [params.calendar.viewModel, params.calendar.state.options.eventOverlap],
  );
  const flatBlockersRef = useRef(flatBlockers);
  flatBlockersRef.current = flatBlockers;
  const blockersByLane = useMemo(
    () =>
      collectBlockersByLane(params.calendar.viewModel, params.calendar.state.options.eventOverlap),
    [params.calendar.viewModel, params.calendar.state.options.eventOverlap],
  );
  const blockersByLaneRef = useRef(blockersByLane);
  blockersByLaneRef.current = blockersByLane;

  // アンマウント時に進行中のセッションがあれば document リスナーを確実に解除する。
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  /** 例外を `onError`（なければ console.error）へ報告する。 */
  function reportError(error: unknown): void {
    const onError = paramsRef.current.onError;
    if (onError) {
      onError(error);
      return;
    }
    // biome-ignore lint/suspicious/noConsole: onError 未指定時の既定動作
    console.error(error);
  }

  /**
   * ドロップ先の解決結果が宣言的制約に違反していないかを判定する。
   * 外部ドラッグ・新規作成にはイベント個別のオーバーライドが存在しないため、
   * `options.eventOverlap` / `options.eventConstraint` のみを使う（`excludeKey` も常に `null`）。
   */
  function isResolutionValid(resolution: ExternalDropResolution): boolean {
    const { state } = paramsRef.current.calendar;
    const blockers =
      resolution.resourceId !== undefined
        ? (blockersByLaneRef.current.get(resolution.resourceId) ?? [])
        : flatBlockersRef.current;
    return isDragCandidateValid({
      range: resolution.range,
      allDay: resolution.allDay,
      excludeKey: null,
      moverBlocksOverlap: state.options.eventOverlap === false,
      blockers,
      constraintRules: resolveConstraintRules(
        state.options.eventConstraint,
        state.options.businessHours,
      ),
      timeZone: state.timeZone,
    });
  }

  /**
   * ドラッグセッションを開始する。document に pointermove / pointerup /
   * pointercancel / keydown（Escape）のリスナーを登録し、pointermove ごとに
   * ドロップ先を再解決してプレビューを更新、pointerup で確定、Escape または
   * pointercancel でキャンセルする（{@link resolveExternalDrop} 参照）。
   */
  function startSession(payload: TPayload): void {
    // 前のセッションが残っていれば（通常発生しないが）先に後始末する。
    cleanupRef.current?.();

    /** ドラッグを中断してプレビューを破棄する（コミットしない）。Escape / pointercancel 共通の経路。 */
    const cancelSession = (): void => {
      detachListeners();
      cleanupRef.current = null;
      setIsDragging(false);
      paramsRef.current.calendar.api.setDragPreview(null);
    };

    /**
     * `containerRef.current` を読み、設定されていれば {@link resolveExternalDrop} で
     * ドロップ先を解決する。`current` が `null`（マウント前などで DOM ルートが
     * まだ取得できない）の間はヒットテストを行わず、常に解決不可（`null`）として
     * 扱う。
     */
    const resolveAt = (clientX: number, clientY: number): ExternalDropResolution | null => {
      const container = paramsRef.current.containerRef.current;
      if (container === null) {
        return null;
      }
      return resolveExternalDrop(clientX, clientY, paramsRef.current.calendar, container);
    };

    // jsdom は PointerEvent 未実装のことがあるため、MouseEvent 互換の型で受け取る。
    const handlePointerMove = (nativeEvent: MouseEvent): void => {
      const resolution = resolveAt(nativeEvent.clientX, nativeEvent.clientY);
      if (resolution === null) {
        // ドロップ先が解決できない位置（対応ビュー外・カレンダー外など）では
        // プレビューを表示しない。
        paramsRef.current.calendar.api.setDragPreview(null);
        return;
      }
      const invalid = !isResolutionValid(resolution);
      paramsRef.current.calendar.api.setDragPreview({
        kind: 'create',
        occurrenceKey: null,
        range: resolution.range,
        allDay: resolution.allDay,
        ...(resolution.resourceId !== undefined ? { resourceId: resolution.resourceId } : {}),
        ...(invalid ? { invalid: true } : {}),
      });
    };

    const handlePointerUp = (nativeEvent: MouseEvent): void => {
      detachListeners();
      cleanupRef.current = null;
      setIsDragging(false);
      try {
        const resolution = resolveAt(nativeEvent.clientX, nativeEvent.clientY);
        // 宣言的制約に違反する場合は既存の「ドロップ先が解決できなかった場合」と同じ
        // 流儀でサイレントに中断する（onExternalDrop は呼ばない）。
        if (resolution !== null && isResolutionValid(resolution)) {
          paramsRef.current.onExternalDrop({
            range: resolution.range,
            allDay: resolution.allDay,
            ...(resolution.resourceId !== undefined ? { resourceId: resolution.resourceId } : {}),
            payload,
          });
        }
      } catch (error) {
        reportError(error);
      } finally {
        paramsRef.current.calendar.api.setDragPreview(null);
      }
    };

    const handlePointerCancel = (): void => {
      cancelSession();
    };

    const handleKeyDown = (nativeEvent: KeyboardEvent): void => {
      if (nativeEvent.key !== 'Escape') {
        return;
      }
      cancelSession();
    };

    const detachListeners = attachDragSessionListeners({
      pointermove: handlePointerMove,
      pointerup: handlePointerUp,
      pointercancel: handlePointerCancel,
      keydown: handleKeyDown,
    });

    cleanupRef.current = detachListeners;
    setIsDragging(true);
  }

  function getDraggableProps(payload: TPayload): ExternalDraggableProps {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        startSession(payload);
      },
    };
  }

  return { getDraggableProps, isDragging };
}
