/**
 * @packageDocumentation
 * `VirtualListView` — リストビューを縦方向に仮想化するヘッドレスコンポーネント。
 *
 * 大量の予定・長期間表示で DOM ノードが肥大するのを避けるため、可視範囲の日セクション
 * だけを描画する。さらに 1 日の予定件数が `sectionItemWindowThreshold` を超えるセクションでは、
 * セクション内でも可視範囲のイベント行だけを描画する（{@link sectionItemWindow} による
 * 二段目のウィンドウ描画。閾値以下のセクションは全件描画で挙動不変）。描画内容
 * （`data-koyomi-*` の構造）は `ListView` と共有レンダラ {@link ListDaySection} を通じて
 * 完全に一致する。仮想化のプリミティブは {@link useVirtualizer}。
 *
 * ヘッドレスの原則に従い、寸法はこのコンポーネントが持たない。スクロールコンテナの高さは
 * 利用者の CSS（`[data-koyomi="list"][data-koyomi-virtualized]`）が決め、`overflow`/`position`
 * などの構造 CSS はデフォルトテーマ（`@koyomi-cal/react/theme.css`）が `data-koyomi-virtualized`
 * 属性に対して当てる。ただし pinned セクションの絶対配置（`position`/`insetInlineStart`/`width`/
 * `top`）はテーマ CSS を読み込まない利用者でも通常フローへ割り込まないよう inline で出力する
 * （`VirtualTimelineView` の pinned style / `VirtualResourceView` の columnPositionStyle と同じ方針）。
 */

import type { CSSProperties, ReactElement, FocusEvent as ReactFocusEvent, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDaysInZone } from '../../core/timezone';
import type { EventOccurrence, ListDay } from '../../core/types';
import {
  sameVisibleWindowRange,
  sectionItemWindow,
  type VirtualItem,
  type VisibleWindowRange,
  visibleWindowRange,
} from '../../core/virtualization';
import { useCalendarContext } from '../context';
import { isDevBuild } from '../is-dev-build';
import type { EventContentContext, SlotRenderContext } from '../types';
import { useVirtualizer } from '../use-virtualizer';
import { type ListDayItemWindow, ListDaySection } from './list-view-parts';

/** `estimateDayHeight` 省略時の 1 日セクションの推定高（px）。 */
const DEFAULT_ESTIMATE_DAY_HEIGHT = 64;

/**
 * `estimateItemHeight` 省略時のイベント行 1 件の推定高（px）。
 * デフォルトテーマの行実寸（1 行テキスト約 20px ＋ 上下 padding 6px ずつ）に合わせる。
 */
const DEFAULT_ESTIMATE_ITEM_HEIGHT = 32;

/** `sectionItemWindowThreshold` 省略時の既定値。 */
const DEFAULT_SECTION_ITEM_WINDOW_THRESHOLD = 50;

/**
 * セクション内ウィンドウ描画で用いる日付見出し（`list-day-header`）の推定高（px）。
 * デフォルトテーマの見出し実寸（約 20px ＋ margin 4px）に合わせる。多少ずれても
 * 描画範囲が overscan 分ずれるだけで、レイアウトは詰め物（推定高基準）で保たれる。
 */
const LIST_DAY_HEADER_ESTIMATE = 24;

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
  renderEvent?: (occurrence: EventOccurrence, ctx: EventContentContext) => ReactNode;
  /** 日付見出しの内容をカスタム描画する関数（第 2 引数の ctx に既定内容。{@link ListView} と同じ）。 */
  renderDayHeader?: (day: ListDay, ctx: SlotRenderContext) => ReactNode;
  /**
   * 日セクション 1 件の推定高（px）。件数に応じて変えたい場合は関数で渡す。
   * 実測（ResizeObserver）が入るまでの暫定値。既定 64。
   */
  estimateDayHeight?: number | ((day: ListDay, index: number) => number);
  /** 前後 overscan 日数。既定 3。 */
  overscan?: number;
  /**
   * イベント行 1 件の推定高（px）。既定 32。
   * セクション内ウィンドウ描画（`sectionItemWindowThreshold` 超過セクション）での
   * 描画範囲とスペーサー高の計算に使う。行の実寸がカスタム描画等で大きく異なる場合に
   * 合わせて調整する。
   */
  estimateItemHeight?: number;
  /**
   * セクション内ウィンドウ描画を適用する 1 日あたりの予定件数の閾値。既定 50。
   * この件数以下のセクションは全イベント行を描画し、超えるセクションは可視範囲
   * ＋overscan のイベント行だけを描画して残りを推定高のスペーサーで置き換える
   * （「1 日に数百件」のようなセクションでも DOM が肥大しない）。
   */
  sectionItemWindowThreshold?: number;
  /**
   * 可視ウィンドウ（日セクションの可視範囲）が変わったときに呼ばれるコールバック。
   *
   * `CalendarOptions.onRangeChange` と同じ流儀で、可視範囲の計算結果（日セクションの
   * インデックス範囲とキー範囲）が直前の通知内容と異なる場合のみ 1 回発火する。
   * マウント直後にも現在の可視範囲を 1 回通知する（初回の増分データ取得に使えるように
   * するため）。スクロール・表示範囲の移動・日一覧の変更など発火の契機は問わず、
   * 内容が同じ間は再通知しない。ビューモデルが `'list'` 以外のときは発火しない。
   */
  onVisibleRangeChange?: (info: ListVisibleRangeChangeInfo) => void;
}

/**
 * {@link VirtualListViewProps.onVisibleRangeChange} に渡される、変更後の可視ウィンドウ。
 *
 * 可視の日セクション範囲（overscan を含まない、実際に見えている範囲）と、そこから
 * 導出した日付範囲を持つ。可視範囲のデータだけを増分取得する遅延読込
 * （`docs/performance.md` のレシピ参照）の入力に使う。
 */
export interface ListVisibleRangeChangeInfo {
  /** 日セクションの可視ウィンドウ。キーは {@link ListDay.key}（`'YYYY-MM-DD'`）。 */
  days: VisibleWindowRange;
  /** 可視範囲の先頭日の開始（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  rangeStart: Date;
  /** 可視範囲の末尾日の翌日 0:00（排他。{@link CalendarRangeChangeInfo.rangeEnd} と同じ流儀）。 */
  rangeEnd: Date;
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
    estimateDayHeight = DEFAULT_ESTIMATE_DAY_HEIGHT,
    overscan,
    estimateItemHeight = DEFAULT_ESTIMATE_ITEM_HEIGHT,
    sectionItemWindowThreshold = DEFAULT_SECTION_ITEM_WINDOW_THRESHOLD,
    onVisibleRangeChange,
  } = props;
  const { state, viewModel, callbacks, messages, renderEventContent } = useCalendarContext();
  const listMessages = messages.list;
  const commonMessages = messages.common;

  const scrollRef = useRef<HTMLDivElement>(null);
  // SSR・初回クライアント render は非仮想化（全件）。マウント後に仮想化へ切り替えることで
  // hydration 不一致を避ける。
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    setEnabled(true);
  }, []);

  // フォーカス中の日セクションのキー。窓外へスクロールしても DOM を保持し続け、
  // フォーカス喪失を防ぐため pinnedKeys に渡す。
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinnedKeys = useMemo(
    () => (focusedKey !== null ? new Set([focusedKey]) : undefined),
    [focusedKey],
  );
  // フォーカス中のイベント行のオカレンスキー。セクション内ウィンドウ描画中の
  // セクションでは、描画範囲外へ出てもこのアイテムだけ描画を続ける（日セクションの
  // focusedKey と同じ趣旨のアイテム版）。
  const [focusedOccurrenceKey, setFocusedOccurrenceKey] = useState<string | null>(null);

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

  // 可視ウィンドウの変更通知（onVisibleRangeChange）。
  // 日セクションの可視範囲（overscan を含まない）を core の純粋計算
  // （visibleWindowRange / sameVisibleWindowRange）でキー付きスナップショットにし、
  // 直前の通知内容と異なるときだけ 1 回発火する（onRangeChange と同じ流儀）。
  // 比較基準の更新はコールバックの登録有無に関わらず常に行う（未登録で作成 →
  // 後から登録、という順序でも誤発火しないようにするため）。
  // virtualizer はレンダーごとに新しいオブジェクトのため、可視範囲のフィールドだけを
  // 取り出して useMemo の依存にする（VirtualTimelineView と同じ方針）。
  const { startIndex: dayStartIndex, endIndex: dayEndIndex } = virtualizer;
  const daysRange = useMemo(
    () => visibleWindowRange({ startIndex: dayStartIndex, endIndex: dayEndIndex }, getItemKey),
    [dayStartIndex, dayEndIndex, getItemKey],
  );
  const isListView = viewModel.type === 'list';
  const timeZoneId = state.timeZone;
  const lastNotifiedDaysRangeRef = useRef<VisibleWindowRange | null>(null);
  useEffect(() => {
    if (!enabled || !isListView) {
      return;
    }
    const changed = !sameVisibleWindowRange(lastNotifiedDaysRangeRef.current, daysRange);
    lastNotifiedDaysRangeRef.current = daysRange;
    if (!changed || onVisibleRangeChange === undefined) {
      return;
    }
    const firstDay = days[Math.max(0, daysRange.startIndex)];
    const lastDay = days[Math.max(0, daysRange.endIndex)];
    if (firstDay === undefined || lastDay === undefined) {
      return;
    }
    onVisibleRangeChange({
      days: daysRange,
      // 公開境界での複製（呼び出し側が rangeStart を変更しても内部状態に影響しない
      // ようにするため。onRangeChange の currentDate と同じ扱い）
      rangeStart: new Date(firstDay.date.getTime()),
      rangeEnd: addDaysInZone(lastDay.date, 1, timeZoneId),
    });
  }, [enabled, isListView, daysRange, onVisibleRangeChange, days, timeZoneId]);

  // セクション内ウィンドウ描画用のスクロール状態。useVirtualizer は日セクションの
  // ウィンドウ計算に同じ値を内部で使うが公開しないため、閾値超過セクションがあるとき
  // だけ本コンポーネントでも購読する（rAF スロットル・ResizeObserver は useVirtualizer
  // と同じ流儀）。
  const hasWindowedSection =
    enabled && days.some((day) => day.occurrences.length > sectionItemWindowThreshold);
  const [sectionMetrics, setSectionMetrics] = useState<{
    scrollOffset: number;
    viewportSize: number;
  }>({ scrollOffset: 0, viewportSize: 0 });
  useEffect(() => {
    if (!hasWindowedSection) {
      return;
    }
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const sync = (): void => {
      setSectionMetrics((prev) =>
        prev.scrollOffset === element.scrollTop && prev.viewportSize === element.clientHeight
          ? prev
          : { scrollOffset: element.scrollTop, viewportSize: element.clientHeight },
      );
    };
    let frame: number | null = null;
    const onScroll = (): void => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    sync();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(sync);
      observer.observe(element);
    }
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
    };
  }, [hasWindowedSection]);

  /**
   * フォーカスが入った日セクションのキーを記録する（窓外へ出ても DOM を保持するため）。
   * イベント行へのフォーカスなら、そのオカレンスキー（セクション内ウィンドウ描画中の
   * セクションのイベント行が持つ `data-koyomi-occurrence`）も併せて記録する。
   */
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const section = target.closest('[data-koyomi="list-day"]');
    const key = section?.getAttribute('data-koyomi-date') ?? null;
    if (key !== null) {
      setFocusedKey(key);
      const eventRow = target.closest('[data-koyomi="list-event"]');
      setFocusedOccurrenceKey(eventRow?.getAttribute('data-koyomi-occurrence') ?? null);
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
    setFocusedOccurrenceKey(null);
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
        <div data-koyomi="list-empty">{listMessages.empty}</div>
      </div>
    );
  }

  /**
   * 閾値超過セクションのウィンドウ描画設定を組み立てる（閾値以下なら `undefined` ＝
   * 全件描画で挙動不変）。`item.start`（日セクションのウィンドウ計算と同じ絶対座標系）
   * とスクロール状態から描画すべきアイテム範囲を求め、フォーカス中のオカレンスが
   * この日のものなら範囲外でも描画を続けるよう pinnedKeys に渡す。
   */
  const buildItemWindow = (day: ListDay, item: VirtualItem): ListDayItemWindow | undefined => {
    if (!enabled || day.occurrences.length <= sectionItemWindowThreshold) {
      return undefined;
    }
    const window = sectionItemWindow({
      itemCount: day.occurrences.length,
      sectionStart: item.start,
      headerSize: LIST_DAY_HEADER_ESTIMATE,
      estimateItemSize: estimateItemHeight,
      scrollOffset: sectionMetrics.scrollOffset,
      viewportSize: sectionMetrics.viewportSize,
    });
    const pinned =
      focusedOccurrenceKey !== null && focusedKey === day.key
        ? new Set([focusedOccurrenceKey])
        : undefined;
    return {
      ...window,
      estimateItemSize: estimateItemHeight,
      ...(pinned !== undefined ? { pinnedKeys: pinned } : {}),
    };
  };

  /** 日セクションを描画する（通常フロー・pinned の両方で使う）。 */
  const renderDay = (
    day: ListDay,
    item: VirtualItem,
    extra: { pinned?: boolean; style?: CSSProperties },
  ): ReactElement => {
    const defaultDayHeader = dayHeaderFormatter.format(day.date);
    const itemWindow = buildItemWindow(day, item);
    return (
      <ListDaySection
        key={day.key}
        day={day}
        timeZone={timeZone}
        locale={state.options.locale}
        defaultDayHeader={defaultDayHeader}
        allDayLabel={listMessages.allDay}
        commonMessages={commonMessages}
        onEventClick={handleEventClick}
        onEventKeyDown={handleEventKeyDown}
        callbacks={callbacks}
        sectionRef={virtualizer.measureElement(day.key)}
        role="listitem"
        ariaLabel={listMessages.dayAriaLabel(day, defaultDayHeader)}
        // ARIA list パターンの集合サイズ属性。DOM には可視窓分の日セクションしか
        // 存在しないため、全日セクション数（days.length）と絶対位置（1 始まり）を
        // 明示する。item.index は days 配列の絶対インデックス（可視窓・pinned のどちらでも
        // 同じ座標系）なので、スクロールしても振り直されない。
        ariaSetSize={days.length}
        ariaPosInSet={item.index + 1}
        {...(extra.pinned === true ? { pinned: true, eventTabbable: false } : {})}
        {...(extra.style !== undefined ? { style: extra.style } : {})}
        {...(itemWindow !== undefined ? { itemWindow } : {})}
        {...(renderEvent !== undefined ? { renderEvent } : {})}
        {...(renderEventContent !== undefined ? { renderEventContent } : {})}
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
        return day !== undefined ? renderDay(day, item, {}) : null;
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
          ? renderDay(day, item, {
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
