/**
 * @packageDocumentation
 * `VirtualListView` — リストビューを縦方向に仮想化するヘッドレスコンポーネント。
 *
 * 大量の予定・長期間表示で DOM ノードが肥大するのを避けるため、可視範囲の日セクション
 * だけを描画する。描画内容（`data-koyomi-*` の構造）は `ListView` と共有レンダラ
 * {@link ListDaySection} を通じて完全に一致する。仮想化のプリミティブは {@link useVirtualizer}。
 *
 * ヘッドレスの原則に従い、寸法はこのコンポーネントが持たない。スクロールコンテナの高さは
 * 利用者の CSS（`[data-koyomi="list"][data-koyomi-virtualized]`）が決め、`overflow`/`position`
 * などの構造 CSS はデフォルトテーマ（`@koyomi-cal/react/theme.css`）が `data-koyomi-virtualized`
 * 属性に対して当てる。ただし pinned セクションの絶対配置（`position`/`insetInlineStart`/`width`/
 * `top`）はテーマ CSS を読み込まない利用者でも通常フローへ割り込まないよう inline で出力する
 * （`VirtualTimelineView` の pinned style / `VirtualResourceView` の columnPositionStyle と同じ方針）。
 */

import type { CSSProperties, ReactElement, FocusEvent as ReactFocusEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventOccurrence, ListDay } from '../../core/types';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import { useIsomorphicLayoutEffect } from '../use-isomorphic-layout-effect';
import { useVirtualizer } from '../use-virtualizer';
import {
  DEFAULT_ALL_DAY_LABEL,
  DEFAULT_EMPTY_LABEL,
  defaultListDayAriaLabel,
  ListDaySection,
} from './list-view-parts';

/** `estimateDayHeight` 省略時の 1 日セクションの推定高（px）。 */
const DEFAULT_ESTIMATE_DAY_HEIGHT = 64;

/**
 * 仮想化が効いていない旨を開発警告する日数の閾値。これ未満の短いリストは
 * 全件描画でも問題にならないため警告しない（誤検知を避ける）。
 */
const VIRTUALIZE_WARN_THRESHOLD = 40;

/**
 * {@link VirtualListView} の props。`ListView` のカスタマイズ props に仮想化固有の設定を加える。
 */
export interface VirtualListViewProps {
  /** イベント行の内容をカスタム描画する関数（{@link ListView} と同じ）。 */
  renderEvent?: (occurrence: EventOccurrence) => ReactNode;
  /** 終日イベントの時刻ラベル。省略時は「終日」。 */
  allDayLabel?: ReactNode;
  /** 予定が 1 件もない場合の内容。省略時は「予定はありません」。 */
  emptyLabel?: ReactNode;
  /** 日付見出しの内容をカスタム描画する関数（第 2 引数に既定内容）。 */
  renderDayHeader?: (day: ListDay, defaultContent: ReactNode) => ReactNode;
  /**
   * イベント行の aria-label をカスタマイズする関数（`ListView` と同じ）。
   * 第 2 引数に既定の aria-label 文字列を渡すので、それを加工・置換して返せる。
   * 省略時は既定文字列をそのまま使う。
   */
  eventAriaLabel?: (occurrence: EventOccurrence, defaultLabel: string) => string;
  /**
   * 日セクションの aria-label をカスタマイズする関数（`ListView` と同じ）。
   * 第 2 引数に既定の aria-label 文字列（例:「7月16日(木) 予定2件」）を渡すので、
   * それを加工・置換して返せる。省略時は既定文字列をそのまま使う。
   */
  dayAriaLabel?: (day: ListDay, defaultLabel: string) => string;
  /**
   * 日セクション 1 件の推定高（px）。件数に応じて変えたい場合は関数で渡す。
   * 実測（ResizeObserver）が入るまでの暫定値。既定 64。
   */
  estimateDayHeight?: number | ((day: ListDay, index: number) => number);
  /** 前後 overscan 日数。既定 3。 */
  overscan?: number;
}

/**
 * 仮想化リストビュー（`VirtualListView`）。
 *
 * `useCalendarContext()` のビューモデルが `'list'` でない場合は `null` を返す。
 * スクロールコンテナには境界高（`height` / `max-height`）を CSS で必ず与えること。
 * 境界高が無いと全件が可視となり仮想化は無害に無効化される（開発ビルドで一度警告する）。
 *
 * @example
 * ```tsx
 * // 利用者側 CSS: [data-koyomi="list"][data-koyomi-virtualized] { height: 600px; }
 * const calendar = useCalendar({ initialView: 'list', events });
 * return (
 *   <CalendarProvider value={calendar} callbacks={{ onEventClick }}>
 *     <VirtualListView estimateDayHeight={72} />
 *   </CalendarProvider>
 * );
 * ```
 */
export function VirtualListView(props: VirtualListViewProps): ReactElement | null {
  const {
    renderEvent,
    renderDayHeader,
    allDayLabel = DEFAULT_ALL_DAY_LABEL,
    emptyLabel = DEFAULT_EMPTY_LABEL,
    eventAriaLabel,
    dayAriaLabel,
    estimateDayHeight = DEFAULT_ESTIMATE_DAY_HEIGHT,
    overscan,
  } = props;
  const { state, viewModel, callbacks } = useCalendarContext();

  const scrollRef = useRef<HTMLDivElement>(null);
  // SSR・初回クライアント render は非仮想化（全件）。マウント後に仮想化へ切り替えることで
  // hydration 不一致を避ける。
  const [enabled, setEnabled] = useState(false);
  useIsomorphicLayoutEffect(() => {
    setEnabled(true);
  }, []);

  // フォーカス中の日セクションのキー。窓外へスクロールしても DOM を保持し続け、
  // フォーカス喪失を防ぐため pinnedKeys に渡す。
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinnedKeys = useMemo(
    () => (focusedKey !== null ? new Set([focusedKey]) : undefined),
    [focusedKey],
  );

  const days: readonly ListDay[] = viewModel.type === 'list' ? viewModel.days : [];

  const getItemKey = useCallback((index: number): string => days[index]?.key ?? '', [days]);
  const estimateSize = useCallback(
    (index: number): number => {
      const day = days[index];
      if (typeof estimateDayHeight === 'function') {
        return day !== undefined ? estimateDayHeight(day, index) : DEFAULT_ESTIMATE_DAY_HEIGHT;
      }
      return estimateDayHeight;
    },
    [days, estimateDayHeight],
  );
  const getScrollElement = useCallback((): HTMLElement | null => scrollRef.current, []);

  const virtualizer = useVirtualizer({
    count: days.length,
    getItemKey,
    estimateSize,
    getScrollElement,
    enabled,
    ...(overscan !== undefined ? { overscan } : {}),
    ...(pinnedKeys !== undefined ? { pinnedKeys } : {}),
  });

  // 仮想化の効果が出ていない（多数の日があるのに窓が全件を含む）場合、開発ビルドで
  // 一度だけ警告する。`clientHeight === 0` は高さ未設定でも内容高を持てば偽になるため、
  // 「窓が全件を含む」ことを直接の指標にする。原因は境界高未設定に限らず、境界高が
  // 高すぎる・overscan 過大でも起こり得るため、警告文は症状と候補原因の形にする。
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!enabled || warnedRef.current || !isDevBuild()) {
      return;
    }
    if (days.length > VIRTUALIZE_WARN_THRESHOLD && virtualizer.virtualItems.length >= days.length) {
      warnedRef.current = true;
      // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の設定ミス警告（use-calendar と同じ流儀）
      console.warn(
        `[koyomi] VirtualListView: 全 ${days.length} 日が可視窓に入っており仮想化の効果が出ていません。` +
          'スクロールコンテナ [data-koyomi="list"][data-koyomi-virtualized] の境界高（height / max-height）未設定、' +
          '境界高が高すぎる、または overscan 過大のいずれかを確認してください。',
      );
    }
  }, [enabled, days.length, virtualizer.virtualItems.length]);

  /** フォーカスが入った日セクションのキーを記録する（窓外へ出ても DOM を保持するため）。 */
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const section = target.closest('[data-koyomi="list-day"]');
    const key = section?.getAttribute('data-koyomi-date') ?? null;
    if (key !== null) {
      setFocusedKey(key);
    }
  }, []);

  /**
   * フォーカスがリスト外へ抜けたら pinned を解除する。
   * `relatedTarget`（フォーカスの移動先）がコンテナ内なら保持を続ける。
   */
  const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    setFocusedKey(null);
  }, []);

  const timeZone = state.timeZone;
  const dayHeaderFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(state.options.locale, {
        timeZone,
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
    [state.options.locale, timeZone],
  );

  const handleEventClick = useCallback(
    (occurrence: EventOccurrence, event: { nativeEvent: MouseEvent }): void => {
      callbacks.onEventClick?.(occurrence, event.nativeEvent);
    },
    [callbacks],
  );
  const handleEventKeyDown = useCallback(
    (event: {
      key: string;
      preventDefault: () => void;
      currentTarget: HTMLButtonElement;
    }): void => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      event.currentTarget.click();
    },
    [],
  );

  if (viewModel.type !== 'list') {
    return null;
  }

  if (viewModel.isEmpty) {
    return (
      <div data-koyomi="list">
        <div data-koyomi="list-empty">{emptyLabel}</div>
      </div>
    );
  }

  /** 日セクションを描画する（通常フロー・pinned の両方で使う）。 */
  const renderDay = (
    day: ListDay,
    extra: { pinned?: boolean; style?: CSSProperties },
  ): ReactElement => {
    const defaultDayHeader = dayHeaderFormatter.format(day.date);
    const defaultDayAriaLabel = defaultListDayAriaLabel(defaultDayHeader, day.occurrences.length);
    return (
      <ListDaySection
        key={day.key}
        day={day}
        timeZone={timeZone}
        locale={state.options.locale}
        defaultDayHeader={defaultDayHeader}
        allDayLabel={allDayLabel}
        onEventClick={handleEventClick}
        onEventKeyDown={handleEventKeyDown}
        callbacks={callbacks}
        sectionRef={virtualizer.measureElement(day.key)}
        role="listitem"
        ariaLabel={dayAriaLabel ? dayAriaLabel(day, defaultDayAriaLabel) : defaultDayAriaLabel}
        {...(extra.pinned === true ? { pinned: true, eventTabbable: false } : {})}
        {...(extra.style !== undefined ? { style: extra.style } : {})}
        {...(renderEvent !== undefined ? { renderEvent } : {})}
        {...(eventAriaLabel !== undefined ? { eventAriaLabel } : {})}
        {...(renderDayHeader !== undefined ? { renderDayHeader } : {})}
      />
    );
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: DOM 仕様が定める div ベースの ARIA list（MonthView の role="grid" と同じ方針。<ul> はテーマ CSS と噛み合わない）
    <div
      ref={scrollRef}
      data-koyomi="list"
      data-koyomi-virtualized="true"
      role="list"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: スクロール可能領域はキーボードユーザーがスクロールできるようフォーカス可能にする（推奨される a11y パターン）
      tabIndex={0}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div
        data-koyomi="list-spacer"
        data-edge="before"
        role="presentation"
        aria-hidden="true"
        style={{ height: `${virtualizer.beforeSize}px` }}
      />
      {virtualizer.virtualItems.map((item) => {
        const day = days[item.index];
        return day !== undefined ? renderDay(day, {}) : null;
      })}
      <div
        data-koyomi="list-spacer"
        data-edge="after"
        role="presentation"
        aria-hidden="true"
        style={{ height: `${virtualizer.afterSize}px` }}
      />
      {virtualizer.pinnedItems.map((item) => {
        const day = days[item.index];
        // 位置決めに必須のスタイルは inline で出力する（ヘッドレス原則）。テーマ CSS を
        // 読み込まない利用者でも、pinned セクションが通常フローへ割り込んで日セクションの
        // 重複表示・高さ跳ねを起こさないよう、position: absolute を inline に持つ
        // （VirtualResourceView の columnPositionStyle と同じ方針）
        return day !== undefined
          ? renderDay(day, {
              pinned: true,
              style: {
                position: 'absolute',
                insetInlineStart: 0,
                width: '100%',
                top: `${item.start}px`,
              },
            })
          : null;
      })}
    </div>
  );
}
