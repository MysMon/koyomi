/**
 * @packageDocumentation
 * `Toolbar` — カレンダーの操作ツールバー。
 *
 * 「今日」「前へ」「次へ」のナビゲーション、期間タイトル、
 * ビュー切替（月・週・日・リスト）を提供するヘッドレスコンポーネント。
 * DOM 構造と data 属性は `docs/internal/components-dom.md` の仕様に従う。
 */

import type { ReactElement, ReactNode } from 'react';
import type { CalendarViewType } from '../../core/types';
import { useCalendarContext } from '../context';
import { formatViewTitle } from './format';

/** ビュー切替ボタンの定義（`view` → ボタン属性・既定文字列）。既定文字列は `labels` で差し替えられる。 */
const VIEW_BUTTON_DEFS: Record<CalendarViewType, { action: string; defaultLabel: string }> = {
  month: { action: 'view-month', defaultLabel: '月' },
  week: { action: 'view-week', defaultLabel: '週' },
  day: { action: 'view-day', defaultLabel: '日' },
  list: { action: 'view-list', defaultLabel: 'リスト' },
  year: { action: 'view-year', defaultLabel: '年' },
  multiMonth: { action: 'view-multimonth', defaultLabel: '複数月' },
  resource: { action: 'view-resource', defaultLabel: 'リソース' },
  timeline: { action: 'view-timeline', defaultLabel: 'タイムライン' },
};

/**
 * ビュー切替ボタンの既定の表示対象と並び順。
 * 既存 4 ビューのみ（新ビューのボタンは `views` prop での opt-in。既定の見た目は従来と不変）。
 */
const DEFAULT_TOOLBAR_VIEWS: readonly CalendarViewType[] = ['month', 'week', 'day', 'list'];

/** `today` / `prev` / `next` ボタンの既定ラベル（表示文字列 兼 aria-label の既定値）。 */
const DEFAULT_TODAY_LABEL = '今日';
const DEFAULT_PREV_LABEL = '前へ';
const DEFAULT_NEXT_LABEL = '次へ';
/** ビュー切替ボタングループの既定 `aria-label`。 */
const DEFAULT_VIEWS_GROUP_LABEL = '表示切替';

/**
 * {@link Toolbar} の固定文字列を差し替えるためのラベル集合。
 * 各キーを省略した場合は既定の日本語文字列を使う（後方互換）。
 */
export interface ToolbarLabels {
  /** 月ビュー切替ボタンの表示文字列。省略時は「月」。 */
  month?: ReactNode;
  /** 週ビュー切替ボタンの表示文字列。省略時は「週」。 */
  week?: ReactNode;
  /** 日ビュー切替ボタンの表示文字列。省略時は「日」。 */
  day?: ReactNode;
  /** リストビュー切替ボタンの表示文字列。省略時は「リスト」。 */
  list?: ReactNode;
  /** 年ビュー切替ボタンの表示文字列。省略時は「年」。 */
  year?: ReactNode;
  /** 複数月ビュー切替ボタンの表示文字列。省略時は「複数月」。 */
  multiMonth?: ReactNode;
  /** リソースビュー切替ボタンの表示文字列。省略時は「リソース」。 */
  resource?: ReactNode;
  /** タイムラインビュー切替ボタンの表示文字列。省略時は「タイムライン」。 */
  timeline?: ReactNode;
  /** 「今日」ボタンの表示文字列（aria-label にも使う）。省略時は「今日」。 */
  today?: ReactNode;
  /**
   * 「前へ」ボタンの aria-label。表示アイコン（`‹`）自体は変わらない。
   * 文字列以外（JSX 等）を渡した場合は aria-label には反映されず既定文字列のままになる。
   * 省略時は「前へ」。
   */
  prev?: ReactNode;
  /**
   * 「次へ」ボタンの aria-label。表示アイコン（`›`）自体は変わらない。
   * 文字列以外（JSX 等）を渡した場合は aria-label には反映されず既定文字列のままになる。
   * 省略時は「次へ」。
   */
  next?: ReactNode;
  /**
   * ビュー切替ボタングループ（`toolbar-views`）の `aria-label`。
   * 省略時は「表示切替」。
   */
  viewsGroup?: string;
}

/** {@link Toolbar} の props。 */
export interface ToolbarProps {
  /** 固定文字列の差し替え。省略したキーは既定の日本語文字列のまま。 */
  labels?: ToolbarLabels;
  /**
   * ビュー切替ボタンとして表示するビューの一覧（並び順もこの配列に従う）。
   * 既定は `['month', 'week', 'day', 'list']`（既存 4 ビュー。既定の見た目は従来と不変）。
   * 新ビューのボタンを出す場合はここに含める（例: `['month', 'week', 'day', 'list', 'year']`）。
   */
  views?: readonly CalendarViewType[];
}

/**
 * `ReactNode` のラベルを `aria-label` 属性用の文字列に変換する。
 * `aria-label` は文字列しか受け付けないため、`label` が文字列でない
 * （JSX 等が渡された）場合は `fallback` を使う。
 */
function ariaLabelText(label: ReactNode, fallback: string): string {
  return typeof label === 'string' ? label : fallback;
}

/**
 * カレンダーの操作ツールバー。
 *
 * `CalendarProvider` の配下で使用する。タイトルは現在のビューに応じて
 * 変わる（月 = 「2026年7月」、日 = 「2026年7月15日(水)」、
 * 週・リスト = 表示範囲の「7月12日〜7月18日」形式）。
 * ボタンの表示文字列は `labels` prop で差し替えられる（省略時は日本語）。
 *
 * @example
 * ```tsx
 * <CalendarProvider value={calendar}>
 *   <Toolbar labels={{ today: 'Today', prev: 'Previous', next: 'Next' }} />
 *   <CalendarView />
 * </CalendarProvider>
 * ```
 */
export function Toolbar(props: ToolbarProps): ReactElement {
  const { api, state } = useCalendarContext();
  const { view, currentDate, timeZone } = state;
  const locale = state.options.locale;
  const labels = props.labels;
  const todayLabel = labels?.today ?? DEFAULT_TODAY_LABEL;
  const prevLabel = labels?.prev ?? DEFAULT_PREV_LABEL;
  const nextLabel = labels?.next ?? DEFAULT_NEXT_LABEL;
  const viewsGroupLabel = labels?.viewsGroup ?? DEFAULT_VIEWS_GROUP_LABEL;
  const title = formatViewTitle(view, currentDate, api.getVisibleRange(), timeZone, locale);

  return (
    <div data-koyomi="toolbar">
      <div data-koyomi="toolbar-nav">
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="today"
          aria-label={ariaLabelText(todayLabel, DEFAULT_TODAY_LABEL)}
          onClick={() => api.today()}
        >
          {todayLabel}
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="prev"
          aria-label={ariaLabelText(prevLabel, DEFAULT_PREV_LABEL)}
          onClick={() => api.prev()}
        >
          ‹
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="next"
          aria-label={ariaLabelText(nextLabel, DEFAULT_NEXT_LABEL)}
          onClick={() => api.next()}
        >
          ›
        </button>
      </div>
      <h2 data-koyomi="title">{title}</h2>
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様（components-dom.md）で
          toolbar-views は div[role="group"] と定めている。fieldset はテーマなしでの
          既定描画（枠線・余白）が大きく変わるためヘッドレス用途に不向き */}
      <div data-koyomi="toolbar-views" role="group" aria-label={viewsGroupLabel}>
        {(props.views ?? DEFAULT_TOOLBAR_VIEWS).map((buttonView) => {
          const def = VIEW_BUTTON_DEFS[buttonView];
          return (
            <button
              key={buttonView}
              type="button"
              data-koyomi="button"
              data-koyomi-action={def.action}
              aria-pressed={view === buttonView}
              onClick={() => api.setView(buttonView)}
            >
              {labels?.[buttonView] ?? def.defaultLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
