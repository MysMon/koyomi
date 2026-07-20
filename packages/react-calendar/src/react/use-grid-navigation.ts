/**
 * @packageDocumentation
 * grid 内のセル間キーボードナビゲーション（roving tabindex）。
 *
 * `CalendarProvider` の `gridNavigation` を有効にしたビルトインビュー
 * （月・複数月・年の各グリッド、週/日ビューの日ヘッダー＋終日行のグリッド）が
 * 内部で使う。[WAI-ARIA APG の grid パターン](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
 * に沿って、日セル群をビューごとに単一の Tab ストップへ集約し、
 * 矢印キー・Home/End・PageUp/PageDown でセル間を移動できるようにする。
 *
 * - 矢印キー（←/→）: 視覚方向に従い左右の対象セルへ移動（LTR では → が読み順で次、
 *   RTL では反転して → が読み順で前。行末・グリッド境界も連続移動）
 * - 矢印キー（↑/↓）: 同じ列の前後の行のセルへ移動
 * - Home / End: 行の先頭・末尾のセルへ移動
 * - Ctrl+Home / Ctrl+End: グリッド全体の先頭・末尾のセルへ移動
 * - PageUp / PageDown: 表示期間を前後へ切り替え（`CalendarApi.prev` / `next`）、
 *   新しい期間の既定セル（今日のセル、なければ先頭セル）へフォーカスを移す
 * - Enter: セルが DOM 上所有する予定（週をまたぐ帯の継続セグメントを含む）があれば
 *   最初の予定へフォーカスを移す（なければセル自身の Enter = 1 日分の範囲選択に委ねる）
 * - 予定にフォーカスがある間は矢印キーを奪わない（予定の移動・リサイズに委ねる）。
 *   Escape のみ「その予定を所有するセルへ戻る」として処理する
 *
 * 実装はイベント委譲方式: コンテナ（ビューのルート要素）にキャプチャ段階の
 * keydown / focus リスナーを付け、セルの幾何配置は DOM の `role="row"` /
 * `role="gridcell"` 構造から都度導出する。座標（`getBoundingClientRect`）には
 * 依存しない。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { UseCalendarResult } from './types';

/**
 * ナビゲーション対象（フォーカス移動先）になるセル要素のセレクタ。
 *
 * - 月・複数月ビューの日セル（`data-koyomi-date` を持つ = インタラクティブなセルのみ。
 *   複数月ビューの前後月セルは `data-koyomi-date` が付かないため対象外）
 * - 週/日ビューの終日セル
 * - 年ビューの日ボタン（前後月の日ボタンは対象外）
 */
const FOCUSABLE_CELL_SELECTOR = [
  '[data-koyomi="month-day"][data-koyomi-date]',
  '[data-koyomi="allday-cell"][data-koyomi-date]',
  '[data-koyomi="year-day"][data-koyomi-date]:not([data-outside])',
].join(', ');

/** 予定要素（およびその内部）を判定するセレクタ。 */
const OCCURRENCE_SELECTOR = '[data-koyomi-occurrence]';

/**
 * グリッドのセル行列。行は DOM 順（複数グリッドがある場合はグリッドをまたいで連結）、
 * 列は行内の `role="gridcell"` の順。ナビゲーション対象でない列（複数月ビューの
 * 前後月セル等）は `null` で表し、列インデックスの整合を保つ。
 */
type CellMatrix = readonly (readonly (HTMLElement | null)[])[];

/** {@link CellMatrix} 上の現在位置。 */
interface CellPosition {
  /** 行インデックス（0 起点）。 */
  row: number;
  /** 列インデックス（0 起点）。 */
  col: number;
}

/**
 * コンテナ配下の DOM 構造（`role="row"` / `role="gridcell"`）からセル行列を構築する。
 * ナビゲーション対象のセルを 1 つも含まない行（曜日見出し行など）は除外する。
 */
function buildCellMatrix(container: HTMLElement): CellMatrix {
  const matrix: (HTMLElement | null)[][] = [];
  for (const row of Array.from(container.querySelectorAll('[role="row"]'))) {
    const cells = Array.from(row.querySelectorAll('[role="gridcell"]'));
    if (cells.length === 0) {
      continue;
    }
    let hasFocusable = false;
    const line = cells.map((cell): HTMLElement | null => {
      // セル自身が対象（月・終日セル）か、セル内の対象要素（年ビューの日ボタン）を探す
      const target = cell.matches(FOCUSABLE_CELL_SELECTOR)
        ? cell
        : cell.querySelector(FOCUSABLE_CELL_SELECTOR);
      if (target instanceof HTMLElement) {
        hasFocusable = true;
        return target;
      }
      return null;
    });
    if (hasFocusable) {
      matrix.push(line);
    }
  }
  return matrix;
}

/** 行列上での `target` の位置を探す。見つからなければ `null`。 */
function findCellPosition(matrix: CellMatrix, target: HTMLElement): CellPosition | null {
  for (let row = 0; row < matrix.length; row += 1) {
    const line = matrix[row];
    if (line === undefined) {
      continue;
    }
    const col = line.indexOf(target);
    if (col >= 0) {
      return { row, col };
    }
  }
  return null;
}

/** 行列内のナビゲーション対象セルを読み順（行→列）で平坦化する。 */
function flattenFocusableCells(matrix: CellMatrix): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (const line of matrix) {
    for (const cell of line) {
      if (cell !== null) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

/**
 * 読み順（行→列）で `delta`（±1）個先の対象セルを返す。
 * 対象外セル（`null`）はスキップし、行末・グリッド境界も連続移動する。
 * 端に達した場合は `null`。
 */
function readingOrderNeighbor(
  matrix: CellMatrix,
  position: CellPosition,
  delta: 1 | -1,
): HTMLElement | null {
  const current = matrix[position.row]?.[position.col];
  if (current === null || current === undefined) {
    return null;
  }
  const flat = flattenFocusableCells(matrix);
  const index = flat.indexOf(current);
  if (index < 0) {
    return null;
  }
  return flat[index + delta] ?? null;
}

/**
 * 同じ列で `delta`（±1）方向の行のセルを返す。その行の同列が対象外なら、
 * さらに先の行を続けて探す（月境界の前後月セルをスキップして隣の月グリッドへ渡る）。
 * 見つからなければ `null`。
 */
function verticalNeighbor(
  matrix: CellMatrix,
  position: CellPosition,
  delta: 1 | -1,
): HTMLElement | null {
  for (let row = position.row + delta; row >= 0 && row < matrix.length; row += delta) {
    const cell = matrix[row]?.[position.col];
    if (cell !== null && cell !== undefined) {
      return cell;
    }
  }
  return null;
}

/** 行内の先頭（`edge: 'first'`）または末尾（`'last'`）の対象セルを返す。 */
function rowEdgeCell(matrix: CellMatrix, row: number, edge: 'first' | 'last'): HTMLElement | null {
  const line = matrix[row];
  if (line === undefined) {
    return null;
  }
  const cells = line.filter((cell): cell is HTMLElement => cell !== null);
  return (edge === 'first' ? cells[0] : cells[cells.length - 1]) ?? null;
}

/** グリッド全体の先頭または末尾の対象セルを返す。 */
function gridEdgeCell(matrix: CellMatrix, edge: 'first' | 'last'): HTMLElement | null {
  const flat = flattenFocusableCells(matrix);
  return (edge === 'first' ? flat[0] : flat[flat.length - 1]) ?? null;
}

/** Ctrl / Meta / Alt のいずれかが押されているか。 */
function hasCtrlLikeModifier(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** コンテナの書字方向が RTL か（`use-virtualizer.ts` の判定と同じ方法）。 */
function isRtl(element: HTMLElement): boolean {
  return getComputedStyle(element).direction === 'rtl';
}

/**
 * ナビゲーションキーに対応する移動先セルを求める。
 * 対象キーでない・移動先がない場合は `null`（呼び出し側は何もしない）。
 *
 * @param rtl - コンテナの書字方向が RTL か。RTL ではセルが視覚的に右→左へ並ぶため、
 *   ←/→ の移動方向を反転して「矢印キーは視覚方向に従う」を保つ
 */
function resolveNavigationTarget(
  matrix: CellMatrix,
  position: CellPosition,
  event: ReactKeyboardEvent<HTMLElement>,
  rtl: boolean,
): HTMLElement | null {
  const ctrl = event.ctrlKey || event.metaKey;
  /** 視覚上の「右」に対応する読み順方向（RTL では読み順で 1 つ前）。 */
  const visualRight: 1 | -1 = rtl ? -1 : 1;
  switch (event.key) {
    case 'ArrowRight':
      return hasCtrlLikeModifier(event) || event.shiftKey
        ? null
        : readingOrderNeighbor(matrix, position, visualRight);
    case 'ArrowLeft':
      return hasCtrlLikeModifier(event) || event.shiftKey
        ? null
        : readingOrderNeighbor(matrix, position, visualRight === 1 ? -1 : 1);
    case 'ArrowDown':
      return hasCtrlLikeModifier(event) || event.shiftKey
        ? null
        : verticalNeighbor(matrix, position, 1);
    case 'ArrowUp':
      return hasCtrlLikeModifier(event) || event.shiftKey
        ? null
        : verticalNeighbor(matrix, position, -1);
    case 'Home':
      if (event.altKey || event.shiftKey) {
        return null;
      }
      return ctrl ? gridEdgeCell(matrix, 'first') : rowEdgeCell(matrix, position.row, 'first');
    case 'End':
      if (event.altKey || event.shiftKey) {
        return null;
      }
      return ctrl ? gridEdgeCell(matrix, 'last') : rowEdgeCell(matrix, position.row, 'last');
    default:
      return null;
  }
}

/**
 * ビューが roving tabindex の既定 Tab ストップとして使う日セルのキーを求める。
 * 今日のセルがあればそれ、なければ先頭のセル（一覧が空なら `null`）。
 *
 * @param days - ナビゲーション対象セルに対応する日の一覧（表示順）
 * @returns 既定 Tab ストップの日付キー
 */
export function defaultActiveCellKey(
  days: readonly { key: string; isToday: boolean }[],
): string | null {
  return (days.find((day) => day.isToday) ?? days[0])?.key ?? null;
}

/** コンテナ（ビューのルート要素）に付与する props。 */
export interface GridNavigationContainerProps {
  /** コンテナ要素の登録用 ref。 */
  ref: (element: HTMLElement | null) => void;
  /** キャプチャ段階のキーボード操作（セル間移動・モード分離）。 */
  onKeyDownCapture: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** フォーカスされたセルを Tab ストップとして追跡する。 */
  onFocusCapture: (event: ReactFocusEvent<HTMLElement>) => void;
}

/** {@link useGridNavigation} が返すハンドラ集。 */
export interface GridNavigationHandlers {
  /** ナビゲーションが有効か（`CalendarProvider` の `gridNavigation` 由来）。 */
  enabled: boolean;
  /**
   * 現在の Tab ストップのセルの日付キー（まだフォーカスされていなければ `null`）。
   * 表示期間の切替でセルが存在しなくなることがあるため、ビュー側は現在表示中の
   * 日に含まれるかを確認し、含まれなければ既定キー（{@link defaultActiveCellKey}）へ
   * フォールバックして tabIndex を決める。
   */
  activeKey: string | null;
  /** コンテナ（ビューのルート要素）に付与する props（参照は安定）。 */
  containerProps: GridNavigationContainerProps;
}

/**
 * grid 内のセル間キーボードナビゲーション（roving tabindex）を提供するフック。
 *
 * ビルトインビューの内部専用。`enabled: false` の間はすべてのリスナーが何もせず、
 * 既定の挙動（全セル `tabIndex=0`、矢印キーなし）が維持される。
 *
 * @param params.calendar - `useCalendar` の戻り値（`prev` / `next` とドラッグ状態の参照に使う）
 * @param params.enabled - ナビゲーションを有効にするか
 * @param params.defaultKey - 既定 Tab ストップの日付キー（{@link defaultActiveCellKey} の結果。
 *   PageUp/PageDown で表示期間を切り替えた後のフォーカス先の決定にも使う）
 */
export function useGridNavigation(params: {
  calendar: UseCalendarResult;
  enabled: boolean;
  defaultKey: string | null;
}): GridNavigationHandlers {
  const { calendar, enabled, defaultKey } = params;

  /** 現在の Tab ストップのセルの日付キー。 */
  const [activeKey, setActiveKey] = useState<string | null>(null);

  /** コンテナ要素（`containerProps.ref` で登録）。 */
  const containerRef = useRef<HTMLElement | null>(null);
  /** PageUp/PageDown による期間切替後、再レンダー後にフォーカスを移すためのフラグ。 */
  const pendingRefocusRef = useRef(false);

  // キャプチャリスナーはコンテナに 1 度だけ付ける（参照安定）ため、
  // 最新の値は ref 経由で参照する（use-day-drag.ts と同じパターン）
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const defaultKeyRef = useRef(defaultKey);
  defaultKeyRef.current = defaultKey;
  const apiRef = useRef(calendar.api);
  apiRef.current = calendar.api;
  const isDraggingRef = useRef(calendar.state.dragPreview !== null);
  isDraggingRef.current = calendar.state.dragPreview !== null;

  /** セルへフォーカスを移し、Tab ストップとして記録する。 */
  function focusCell(cell: HTMLElement): void {
    cell.focus();
    const key = cell.getAttribute('data-koyomi-date');
    if (key !== null) {
      setActiveKey(key);
    }
  }
  const focusCellRef = useRef(focusCell);
  focusCellRef.current = focusCell;

  /**
   * コンテナ内のキー操作（キャプチャ段階）。
   *
   * - 予定要素にフォーカスがある間: Escape のみ「その予定を所有するセルへ戻る」として
   *   処理し、矢印キー等は従来どおり予定側のハンドラ（移動・リサイズ）に委ねる
   * - 対象セルにフォーカスがある間: 矢印キー・Home/End でセル間移動、
   *   PageUp/PageDown で表示期間の切替、Enter でセル内の予定へ入る
   * - ドラッグ操作中（`dragPreview` あり）は何もしない（Escape はドラッグの
   *   キャンセルとして document 側のリスナーが処理する）
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (!enabledRef.current || event.defaultPrevented || isDraggingRef.current) {
      return;
    }
    const container = containerRef.current;
    const target = event.target;
    if (container === null || !(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(OCCURRENCE_SELECTOR) !== null) {
      if (event.key !== 'Escape' || hasCtrlLikeModifier(event) || event.shiftKey) {
        return;
      }
      const owningCell = target.closest<HTMLElement>(FOCUSABLE_CELL_SELECTOR);
      if (owningCell === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusCell(owningCell);
      return;
    }

    if (!target.matches(FOCUSABLE_CELL_SELECTOR)) {
      return;
    }

    if (event.key === 'Enter' && !hasCtrlLikeModifier(event) && !event.shiftKey) {
      // セルが DOM 上所有する最初の予定（週をまたぐ帯の継続セグメントを含む）へ
      // フォーカスを移す。予定がなければ何もせず、セル自身の Enter（1 日分の範囲選択）に委ねる
      const firstOccurrence = target.querySelector<HTMLElement>(OCCURRENCE_SELECTOR);
      if (firstOccurrence !== null) {
        event.preventDefault();
        event.stopPropagation();
        firstOccurrence.focus();
      }
      return;
    }

    if (event.key === 'PageUp' || event.key === 'PageDown') {
      if (hasCtrlLikeModifier(event) || event.shiftKey) {
        return;
      }
      event.preventDefault();
      // 現在のセルは期間切替でアンマウントされるため、いったんキーを破棄し、
      // 再レンダー後の effect で新しい期間の既定セルへフォーカスを移す
      pendingRefocusRef.current = true;
      setActiveKey(null);
      if (event.key === 'PageUp') {
        apiRef.current.prev();
      } else {
        apiRef.current.next();
      }
      return;
    }

    const matrix = buildCellMatrix(container);
    const position = findCellPosition(matrix, target);
    if (position === null) {
      return;
    }
    const next = resolveNavigationTarget(matrix, position, event, isRtl(container));
    if (next === null) {
      return;
    }
    event.preventDefault();
    focusCell(next);
  }
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  /** フォーカスされた対象セルを Tab ストップとして追跡する（クリックでのフォーカス等）。 */
  function handleFocus(event: ReactFocusEvent<HTMLElement>): void {
    if (!enabledRef.current) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(FOCUSABLE_CELL_SELECTOR)) {
      return;
    }
    const key = target.getAttribute('data-koyomi-date');
    if (key !== null) {
      setActiveKey(key);
    }
  }
  const handleFocusRef = useRef(handleFocus);
  handleFocusRef.current = handleFocus;

  // コンテナに渡す props は 1 度だけ生成し、呼び出し時に ref 経由で最新の
  // ハンドラへ委譲する（コンテナ要素の props 参照を安定させるため）
  const [containerProps] = useState<GridNavigationContainerProps>(() => ({
    ref: (element: HTMLElement | null) => {
      containerRef.current = element;
    },
    onKeyDownCapture: (event: ReactKeyboardEvent<HTMLElement>) => handleKeyDownRef.current(event),
    onFocusCapture: (event: ReactFocusEvent<HTMLElement>) => handleFocusRef.current(event),
  }));

  // PageUp/PageDown による期間切替の再レンダー後、新しい期間の既定セル
  // （今日のセル、なければ先頭セル）へフォーカスを移す。切替でフォーカスが
  // body へ落ちたままにならないようにするための復帰処理
  useEffect(() => {
    if (!pendingRefocusRef.current) {
      return;
    }
    pendingRefocusRef.current = false;
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const cells = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_CELL_SELECTOR));
    const preferred = cells.find(
      (cell) => cell.getAttribute('data-koyomi-date') === defaultKeyRef.current,
    );
    const targetCell = preferred ?? cells[0];
    if (targetCell !== undefined) {
      focusCellRef.current(targetCell);
    }
  });

  return { enabled, activeKey, containerProps };
}
