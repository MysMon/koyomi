/**
 * @packageDocumentation
 * `HeadlessPattern` — 「ヘッドレス」パターン。
 *
 * ビルトインの見た目に頼らず、Koyomi のヘッドレスなカスタマイズ機構だけで
 * 独自 UI を組み立てる例。次の 4 点を実演する。
 *
 * 1. **「+N 件」の自前ポップオーバー** — `overflowButtonProps` で ARIA 属性を
 *    付与し、`onOverflowClick` で得た非表示/表示中オカレンスを、依存ライブラリ
 *    なしの素の `position: absolute` ポップオーバーに表示する。Escape・外側
 *    クリックで閉じる（`docs/interactions.md` の「+N 件のポップオーバーを自前で
 *    組む」レシピの、Floating UI を使わない版）。
 * 2. **カスタム描画スロット** — `renderDayCell` で月セルに「本日」バッジと
 *    土日の色分け属性を、`renderEvent` で週ビューのイベント内容（時刻・「定期」
 *    チップ・リソース名）を、`renderDayHeader` で週ビューの日ヘッダーの
 *    土日色分けを、それぞれ差し込む。
 * 3. **文言のカスタマイズ** — `CalendarProvider` の `messages` prop で `Toolbar`
 *    の文言の一部と月ビューの「+N 件」（`messages.month.overflow`）を
 *    「他 N 件…」形式に差し替える。
 * 4. **ブランドテーマ** — `headless.css` で `--koyomi-*` 変数と
 *    `[data-koyomi="..."]` を上書きし、デフォルトテーマとは明確に異なる
 *    見た目にする（このパターンのカレンダーだけに適用され、他パターンや
 *    デフォルトテーマには影響しない）。
 *
 * ビューは月・週の 2 つに絞る（「+N 件」があるのは月ビューのみ、日ヘッダーの
 * 装飾は週ビューで確認できる）。
 */

import type {
  CalendarInteractionCallbacks,
  CalendarResource,
  CalendarViewType,
  EventOccurrence,
  MessageCatalogOverrides,
  MonthDay,
  MonthOverflowButtonProps,
  PositionedOccurrence,
  SlotRenderContext,
  TimeGridDay,
  Weekday,
} from '@koyomi-cal/react';
import {
  CalendarProvider,
  CalendarView,
  formatDayTitle,
  formatTime,
  Toolbar,
  useCalendar,
  useCalendarShortcuts,
  weekdayInZone,
} from '@koyomi-cal/react';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { sampleEvents, sampleResources } from '../sample-data';
import './headless.css';

/** このパターンで有効にするビュー（「+N 件」ポップオーバーは月ビューでのみ確認できる）。 */
const VIEWS: readonly CalendarViewType[] = ['month', 'week'];

/** 自前ポップオーバーの DOM id（`aria-controls` で紐付ける）。 */
const OVERFLOW_POPOVER_ID = 'headless-overflow-popover';

/** `Toolbar` の文言の一部差し替え（手帳ブランドの言い回しに統一する）。 */
const MESSAGES: MessageCatalogOverrides = {
  toolbar: {
    today: '本日',
    month: '月間',
    week: '週間',
    prev: '前の期間へ',
    next: '次の期間へ',
  },
  month: {
    overflow: (count) => `他 ${count} 件…`,
  },
};

/** 「+N 件」ポップオーバーが開いているときの状態。 */
interface OverflowState {
  /** ポップオーバーの起点になった日。 */
  day: MonthDay;
  /** その日の全オカレンス（表示中＋非表示、開始時刻順にマージ済み）。 */
  occurrences: readonly EventOccurrence[];
}

/** ポップオーバーの絶対位置（`.headless-calendar-shell` 基準の px）。 */
interface PopoverPosition {
  top: number;
  left: number;
}

// 土日の色分け（headless.css）に使う曜日属性の値。日本の紙のカレンダーの
// 慣習（日曜=赤・土曜=青）をブランドとして再現するため、レンダースロットから
// data-headless-weekday 属性で曜日を CSS へ渡す。

/**
 * `resourceId` → `CalendarResource` の索引を作る。
 */
function indexResourcesById(resources: readonly CalendarResource[]): Map<string, CalendarResource> {
  const map = new Map<string, CalendarResource>();
  for (const resource of resources) {
    map.set(resource.id, resource);
  }
  return map;
}

/**
 * 「ヘッドレス」パターンのルートコンポーネント。
 */
export function HeadlessPattern(): ReactElement {
  const calendar = useCalendar({
    initialView: 'month',
    locale: 'ja',
    events: sampleEvents,
    resources: sampleResources,
    timeZone: 'Asia/Tokyo',
  });
  const { state } = calendar;

  const [overflow, setOverflow] = useState<OverflowState | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const [selected, setSelected] = useState<EventOccurrence | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const dayCellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const resourceById = useMemo(() => indexResourcesById(state.resources), [state.resources]);

  useCalendarShortcuts({ calendar, views: VIEWS });

  /**
   * 月セル本体（`month-day`）を登録・解除する（ポップオーバーの位置計算・外側クリック判定に使う）。
   *
   * ref 自体はバッジ・アウトライン用の装飾ラッパー（`.headless-day-cell`、
   * `renderMonthDayCell` 内で defaultContent とは別の兄弟要素として描画される）に
   * 付けているが、ポップオーバーの基準にしたいのは月セル本体（`month-day`）の矩形
   * なので、ここで `parentElement`（＝ `.headless-day-cell` と defaultContent の
   * 共通の親、月セル本体）を登録する。「+N 件」ボタンも defaultContent 側の兄弟
   * 要素なので、こうすることで「+N 件」クリックも「セル内側のクリック」として
   * 正しく判定される。
   */
  const registerDayCellRef = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element === null) {
      dayCellRefs.current.delete(key);
      return;
    }
    const dayCell = element.parentElement;
    if (dayCell instanceof HTMLDivElement) {
      dayCellRefs.current.set(key, dayCell);
    }
  }, []);

  // 表示ビュー・表示期間が変わったら、古い日セルを指したままのポップオーバーを閉じる。
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.view / state.currentDate はエフェクト本体では参照しない意図的な再実行トリガー
  useEffect(() => {
    setOverflow(null);
  }, [state.view, state.currentDate.getTime()]);

  // ポップオーバーの位置を、起点の日セルの実測位置から算出する（Floating UI 等は使わない）。
  useEffect(() => {
    if (overflow === null) {
      setPopoverPosition(null);
      return;
    }
    const dayKey = overflow.day.key;

    function recalcPosition(): void {
      const anchor = dayCellRefs.current.get(dayKey);
      const shell = shellRef.current;
      if (anchor === undefined || shell === null) {
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setPopoverPosition({
        top: anchorRect.bottom - shellRect.top,
        left: anchorRect.left - shellRect.left,
      });
    }

    recalcPosition();
    window.addEventListener('resize', recalcPosition);
    return () => window.removeEventListener('resize', recalcPosition);
  }, [overflow]);

  // Escape / 外側クリックでポップオーバーを閉じる。
  useEffect(() => {
    if (overflow === null) {
      return;
    }
    const dayKey = overflow.day.key;

    function handlePointerDown(event: PointerEvent): void {
      const anchor = dayCellRefs.current.get(dayKey);
      if (anchor !== undefined && event.target instanceof Node && !anchor.contains(event.target)) {
        setOverflow(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOverflow(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [overflow]);

  const callbacks: CalendarInteractionCallbacks = useMemo(
    () => ({
      onEventClick: (occurrence) => {
        setSelected(occurrence);
      },
      onOverflowClick: (day, hiddenOccurrences, details) => {
        setOverflow((prev) => {
          // 同じ日の「+N 件」を再クリックしたらトグルで閉じる。
          if (prev !== null && prev.day.key === day.key) {
            return null;
          }
          const occurrences = [...details.visibleOccurrences, ...hiddenOccurrences]
            .slice()
            .sort((a, b) => a.start.getTime() - b.start.getTime());
          return { day, occurrences };
        });
      },
    }),
    [],
  );

  /** 「+N 件」ボタンに ARIA 属性を付与する（自前ポップオーバーとの連携用）。 */
  const monthOverflowButtonProps = useCallback(
    (day: MonthDay, _hiddenOccurrences: readonly EventOccurrence[]): MonthOverflowButtonProps => {
      const isOpen = overflow !== null && overflow.day.key === day.key;
      return isOpen
        ? { 'aria-haspopup': 'dialog', 'aria-expanded': true, 'aria-controls': OVERFLOW_POPOVER_ID }
        : { 'aria-haspopup': 'dialog', 'aria-expanded': false };
    },
    [overflow],
  );

  /**
   * 月セルに絵文字バッジ・「開いている」アウトラインを差し込む（`renderDayCell`）。
   *
   * 注意: `defaultContent`（`month-day-number` と `month-overflow` を含む）は
   * `.headless-day-cell`（position: relative の装飾ラッパー）の**内側に入れない**。
   * デフォルトテーマの「+N 件」ボタンはイベント帯（`month-event`）と同じ方式で
   * 絶対配置され、positioned ancestor はセル（`month-day`）ではなく
   * `month-week` を想定している。`defaultContent` を positioned な自前ラッパーで
   * 丸ごと囲むと「+N 件」の絶対配置の基準がそのラッパーに変わり、% がセル 1 個分の
   * 幅を基準に解決されてしまい配置が壊れる（`docs/theming.md` の「自前スタイルを
   * ゼロから当てる場合の注意」参照）。ここでは `.headless-day-cell` を
   * `defaultContent` とは別の兄弟要素として描画し、セル全体を覆う見た目
   * （バッジ位置・アウトライン）は CSS Grid のセル重複配置（`headless.css`）で
   * 実現する（`position` を使わないため、月セルを positioned にせずに済む）。
   */
  const renderMonthDayCell = useCallback(
    (day: MonthDay, ctx: SlotRenderContext): ReactNode => {
      const weekday: Weekday = weekdayInZone(day.date, state.timeZone);
      const isOpen = overflow !== null && overflow.day.key === day.key;
      return (
        <>
          <div
            className="headless-day-cell"
            data-headless-open={isOpen ? 'true' : undefined}
            data-headless-weekday={weekday}
            ref={(element) => registerDayCellRef(day.key, element)}
          >
            {day.isToday && <span className="headless-day-badge">本日</span>}
          </div>
          {ctx.defaultContent}
        </>
      );
    },
    [overflow, registerDayCellRef, state.timeZone],
  );

  /** 週ビューの日ヘッダーに曜日属性を付け、土日を色分けする（`renderDayHeader`）。 */
  const renderTimeGridDayHeader = useCallback(
    (day: TimeGridDay, ctx: SlotRenderContext): ReactNode => (
      <div className="headless-day-header" data-headless-weekday={day.weekday}>
        {ctx.defaultContent}
      </div>
    ),
    [],
  );

  /** 週ビューのイベント内容をカスタム描画する（`renderEvent`）。 */
  const renderTimeGridEvent = useCallback(
    (item: PositionedOccurrence): ReactNode => {
      const occurrence = item.occurrence;
      const resource =
        occurrence.event.resourceId !== undefined
          ? resourceById.get(occurrence.event.resourceId)
          : undefined;
      return (
        <span className="headless-event-content">
          <span className="headless-event-body">
            <span className="headless-event-time">
              {formatTime(occurrence.start, state.timeZone, state.options.locale)}
              {occurrence.isRecurring && <span className="headless-event-repeat">定期</span>}
            </span>
            <span className="headless-event-title">{occurrence.event.title}</span>
            {resource !== undefined && (
              <span className="headless-event-resource">{resource.title}</span>
            )}
          </span>
        </span>
      );
    },
    [resourceById, state.timeZone, state.options.locale],
  );

  return (
    <div className="demo-app headless-pattern">
      <header className="demo-header">
        <h2 className="demo-title">ヘッドレスレシピ</h2>
        <p className="headless-lede">
          ビルトインの見た目を使わず、カスタム描画スロット・ARIA 属性・CSS変数だけで「+N
          件」ポップオーバーとブランドテーマを自前実装する例。
        </p>
      </header>

      <div className="headless-calendar-shell" ref={shellRef}>
        <CalendarProvider value={calendar} callbacks={callbacks} messages={MESSAGES}>
          <Toolbar views={VIEWS} />
          <CalendarView
            renderMonthDayCell={renderMonthDayCell}
            monthOverflowButtonProps={monthOverflowButtonProps}
            renderTimeGridEvent={renderTimeGridEvent}
            renderTimeGridDayHeader={renderTimeGridDayHeader}
          />
        </CalendarProvider>

        {overflow !== null && popoverPosition !== null && (
          <div
            id={OVERFLOW_POPOVER_ID}
            role="dialog"
            aria-label={`${formatDayTitle(overflow.day.date, state.timeZone, state.options.locale)}の予定一覧`}
            className="headless-overflow-popover"
            style={{ top: popoverPosition.top, left: popoverPosition.left }}
          >
            <div className="headless-overflow-popover-header">
              <span>{formatDayTitle(overflow.day.date, state.timeZone, state.options.locale)}</span>
              <button
                type="button"
                className="headless-overflow-popover-close"
                onClick={() => setOverflow(null)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <ul className="headless-overflow-popover-list">
              {overflow.occurrences.map((occurrence) => {
                const resource =
                  occurrence.event.resourceId !== undefined
                    ? resourceById.get(occurrence.event.resourceId)
                    : undefined;
                return (
                  <li key={occurrence.key}>
                    <span
                      className="headless-overflow-popover-swatch"
                      style={{
                        backgroundColor: occurrence.event.color ?? 'var(--koyomi-event-color)',
                      }}
                      aria-hidden="true"
                    />
                    <span className="headless-overflow-popover-time">
                      {occurrence.allDay
                        ? '終日'
                        : formatTime(occurrence.start, state.timeZone, state.options.locale)}
                    </span>
                    <span className="headless-overflow-popover-title">
                      {occurrence.event.title}
                    </span>
                    {resource !== undefined && (
                      <span className="headless-overflow-popover-resource">{resource.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {selected !== null && (
        <aside className="headless-detail-panel" aria-live="polite">
          <div className="headless-detail-panel-header">
            <h3>{selected.event.title}</h3>
            <button
              type="button"
              className="headless-detail-panel-close"
              onClick={() => setSelected(null)}
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
          <p className="headless-detail-panel-time">
            {selected.allDay
              ? '終日'
              : `${formatTime(selected.start, state.timeZone, state.options.locale)}〜${formatTime(selected.end, state.timeZone, state.options.locale)}`}
          </p>
          {selected.event.location !== undefined && (
            <p className="headless-detail-panel-meta">📍 {selected.event.location}</p>
          )}
          {selected.event.description !== undefined && (
            <p className="headless-detail-panel-meta">{selected.event.description}</p>
          )}
        </aside>
      )}
    </div>
  );
}
