/**
 * @packageDocumentation
 * `Toolbar` — カレンダーの操作ツールバー。
 *
 * 「今日」「前へ」「次へ」のナビゲーション、期間タイトル、
 * ビュー切替（月・週・日・リスト）を提供するヘッドレスコンポーネント。
 * DOM 構造と data 属性は `docs/internal/components-dom.md` の契約に従う。
 */

import type { ReactElement } from 'react';
import type { CalendarViewType } from '../../core/types';
import { useCalendarContext } from '../context';
import { formatDayTitle, formatMonthTitle, formatRangeTitle } from './format';

/** ビュー切替ボタンの定義（表示順は DOM 契約どおり）。 */
const VIEW_BUTTONS: readonly { view: CalendarViewType; action: string; label: string }[] = [
  { view: 'month', action: 'view-month', label: '月' },
  { view: 'week', action: 'view-week', label: '週' },
  { view: 'day', action: 'view-day', label: '日' },
  { view: 'list', action: 'view-list', label: 'リスト' },
];

/**
 * カレンダーの操作ツールバー。
 *
 * `CalendarProvider` の配下で使用する。タイトルは現在のビューに応じて
 * 変わる（月 = 「2026年7月」、日 = 「2026年7月15日(水)」、
 * 週・リスト = 表示範囲の「7月12日〜7月18日」形式）。
 *
 * @example
 * ```tsx
 * <CalendarProvider value={calendar}>
 *   <Toolbar />
 *   <CalendarView />
 * </CalendarProvider>
 * ```
 */
export function Toolbar(): ReactElement {
  const { api, state } = useCalendarContext();
  const { view, currentDate, timeZone } = state;
  const locale = state.options.locale;

  /** 現在のビューに応じた期間タイトルを組み立てる。 */
  function title(): string {
    switch (view) {
      case 'month':
        return formatMonthTitle(currentDate, timeZone, locale);
      case 'day':
        return formatDayTitle(currentDate, timeZone, locale);
      case 'week':
      case 'list':
        return formatRangeTitle(api.getVisibleRange(), timeZone, locale);
    }
  }

  return (
    <div data-koyomi="toolbar">
      <div data-koyomi="toolbar-nav">
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="today"
          aria-label="今日"
          onClick={() => api.today()}
        >
          今日
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="prev"
          aria-label="前へ"
          onClick={() => api.prev()}
        >
          ‹
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="next"
          aria-label="次へ"
          onClick={() => api.next()}
        >
          ›
        </button>
      </div>
      <h2 data-koyomi="title">{title()}</h2>
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 契約（components-dom.md）で
          toolbar-views は div[role="group"] と定めている。fieldset はテーマなしでの
          既定描画（枠線・余白）が大きく変わるためヘッドレス用途に不向き */}
      <div data-koyomi="toolbar-views" role="group" aria-label="表示切替">
        {VIEW_BUTTONS.map((button) => (
          <button
            key={button.view}
            type="button"
            data-koyomi="button"
            data-koyomi-action={button.action}
            aria-pressed={view === button.view}
            onClick={() => api.setView(button.view)}
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}
