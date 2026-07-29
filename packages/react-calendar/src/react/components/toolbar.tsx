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
import type { ToolbarMessages } from '../locales/types';
import { formatViewTitle } from './format';

/** ビュー切替ボタンの定義（`view` → ボタン属性）。表示文字列は `messages.toolbar[view]` から取得する。 */
const VIEW_BUTTON_DEFS: Record<CalendarViewType, { action: string }> = {
  month: { action: 'view-month' },
  week: { action: 'view-week' },
  day: { action: 'view-day' },
  list: { action: 'view-list' },
  year: { action: 'view-year' },
  multiMonth: { action: 'view-multimonth' },
  resource: { action: 'view-resource' },
  timeline: { action: 'view-timeline' },
};

/**
 * ビュー切替ボタンの既定の表示対象と並び順。
 * 既存 4 ビューのみ（新ビューのボタンは `views` prop での opt-in。既定の見た目は従来と不変）。
 */
const DEFAULT_TOOLBAR_VIEWS: readonly CalendarViewType[] = ['month', 'week', 'day', 'list'];

/**
 * {@link ToolbarProps.renderTitle} に渡されるコンテキスト。
 */
export interface ToolbarTitleContext {
  /** 省略時にライブラリが描画する既定の内容（整形済みのタイトル文字列）。 */
  defaultContent: ReactNode;
  /** タイトルの対象となっている現在のビュー。 */
  view: CalendarViewType;
  /** 整形済みのタイトル文字列（`defaultContent` と同じ内容）。 */
  title: string;
}

/**
 * {@link ToolbarProps.renderNavButtonContent} に渡されるコンテキスト。
 */
export interface ToolbarNavButtonContext {
  /** どのナビゲーションボタンに対する描画か。 */
  action: 'today' | 'prev' | 'next';
  /** 省略時にライブラリが描画する既定の内容。 */
  defaultContent: ReactNode;
}

/**
 * {@link ToolbarProps.renderViewButtonContent} に渡されるコンテキスト。
 */
export interface ToolbarViewButtonContext {
  /** ボタンが切り替える対象のビュー。 */
  view: CalendarViewType;
  /** このビューが現在選択中か（ボタンの `aria-pressed` と同じ値）。 */
  active: boolean;
  /** 省略時にライブラリが描画する既定の内容。 */
  defaultContent: ReactNode;
}

/** {@link Toolbar} の props。 */
export interface ToolbarProps {
  /**
   * ビュー切替ボタンとして表示するビューの一覧（並び順もこの配列に従う）。
   * 既定は `['month', 'week', 'day', 'list']`（既存 4 ビュー。既定の見た目は従来と不変）。
   * 新ビューのボタンを出す場合はここに含める（例: `['month', 'week', 'day', 'list', 'year']`）。
   */
  views?: readonly CalendarViewType[];

  /**
   * タイトル（`h2[data-koyomi="title"]`）の内側の内容を差し替える。
   *
   * 外側の `<h2>` 要素と `data-koyomi="title"` 属性は保持される（差し替わるのは内側の内容のみ）。
   * 省略時は整形済みのタイトル文字列がそのまま描画される（既定の見た目は不変）。
   *
   * @example タイトルの前にアイコンを添える
   * ```tsx
   * <Toolbar
   *   renderTitle={(ctx) => (
   *     <>
   *       <CalendarIcon />
   *       {ctx.defaultContent}
   *     </>
   *   )}
   * />
   * ```
   */
  renderTitle?: (ctx: ToolbarTitleContext) => ReactNode;

  /**
   * today/prev/next ナビゲーションボタンの内側の内容を差し替える。
   *
   * 外側の `<button>` 要素・`data-koyomi-action` 属性・`aria-label`・クリック配線は
   * 保持される（差し替わるのは内側の内容のみ）。省略時は既定の内容
   * （today は `messages.toolbar.today`、prev/next は `‹`/`›`）がそのまま描画される。
   *
   * @example prev/next を矢印アイコンに差し替える
   * ```tsx
   * <Toolbar
   *   renderNavButtonContent={(ctx) => {
   *     if (ctx.action === 'prev') return <ChevronLeftIcon />;
   *     if (ctx.action === 'next') return <ChevronRightIcon />;
   *     return ctx.defaultContent;
   *   }}
   * />
   * ```
   */
  renderNavButtonContent?: (ctx: ToolbarNavButtonContext) => ReactNode;

  /**
   * ビュー切替ボタン（`toolbar-views` 配下）の内側の内容を差し替える。
   *
   * 外側の `<button>` 要素・`data-koyomi-action` 属性・`aria-pressed`・クリック配線は
   * 保持される（差し替わるのは内側の内容のみ）。省略時は既定の表示文字列
   * （`messages.toolbar[view]`）がそのまま描画される。
   *
   * @example 選択中のビューのボタンにチェックマークを添える
   * ```tsx
   * <Toolbar
   *   renderViewButtonContent={(ctx) => (
   *     <>
   *       {ctx.defaultContent}
   *       {ctx.active && <CheckIcon />}
   *     </>
   *   )}
   * />
   * ```
   */
  renderViewButtonContent?: (ctx: ToolbarViewButtonContext) => ReactNode;
}

/**
 * `ReactNode` のラベルが文字列であれば `aria-label` 属性用にそのまま使う。
 * `aria-label` は文字列しか受け付けないため、文字列でない（JSX 等の）場合は
 * `undefined`（属性自体を省略）を返す。
 */
function ariaLabelText(label: ReactNode): string | undefined {
  return typeof label === 'string' ? label : undefined;
}

/**
 * カレンダーの操作ツールバー。
 *
 * `CalendarProvider` の配下で使用する。タイトルは現在のビューに応じて
 * 変わる（月 = 「2026年7月」、日 = 「2026年7月15日(水)」、
 * 週・リスト = 表示範囲の「7月12日〜7月18日」形式）。
 * ボタンの表示文字列は `CalendarProvider` の `messages` prop（`messages.toolbar`）
 * で差し替えられる（省略時は `state.options.locale` に対応する既定カタログ）。
 *
 * @example
 * ```tsx
 * <CalendarProvider value={calendar} messages={{ toolbar: { today: 'Today' } }}>
 *   <Toolbar />
 *   <CalendarView />
 * </CalendarProvider>
 * ```
 */
export function Toolbar(props: ToolbarProps): ReactElement {
  const { api, state, messages } = useCalendarContext();
  const { view, currentDate, timeZone } = state;
  const locale = state.options.locale;
  const toolbarMessages: ToolbarMessages = messages.toolbar;
  const title = formatViewTitle(
    view,
    currentDate,
    api.getVisibleRange(),
    timeZone,
    locale,
    messages.common.rangeSeparator,
  );

  return (
    <div data-koyomi="toolbar">
      <div data-koyomi="toolbar-nav">
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="today"
          aria-label={ariaLabelText(toolbarMessages.today)}
          onClick={() => api.today()}
        >
          {props.renderNavButtonContent
            ? props.renderNavButtonContent({
                action: 'today',
                defaultContent: toolbarMessages.today,
              })
            : toolbarMessages.today}
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="prev"
          aria-label={toolbarMessages.prev}
          onClick={() => api.prev()}
        >
          {props.renderNavButtonContent
            ? props.renderNavButtonContent({ action: 'prev', defaultContent: '‹' })
            : '‹'}
        </button>
        <button
          type="button"
          data-koyomi="button"
          data-koyomi-action="next"
          aria-label={toolbarMessages.next}
          onClick={() => api.next()}
        >
          {props.renderNavButtonContent
            ? props.renderNavButtonContent({ action: 'next', defaultContent: '›' })
            : '›'}
        </button>
      </div>
      <h2 data-koyomi="title">
        {props.renderTitle ? props.renderTitle({ defaultContent: title, view, title }) : title}
      </h2>
      {/* biome-ignore lint/a11y/useSemanticElements: DOM 仕様（components-dom.md）で
          toolbar-views は div[role="group"] と定めている。fieldset はテーマなしでの
          既定描画（枠線・余白）が大きく変わるためヘッドレス用途に不向き */}
      <div data-koyomi="toolbar-views" role="group" aria-label={toolbarMessages.viewsGroup}>
        {(props.views ?? DEFAULT_TOOLBAR_VIEWS).map((buttonView) => {
          const def = VIEW_BUTTON_DEFS[buttonView];
          const active = view === buttonView;
          const defaultContent = toolbarMessages[buttonView];
          return (
            <button
              key={buttonView}
              type="button"
              data-koyomi="button"
              data-koyomi-action={def.action}
              aria-pressed={active}
              onClick={() => api.setView(buttonView)}
            >
              {props.renderViewButtonContent
                ? props.renderViewButtonContent({ view: buttonView, active, defaultContent })
                : defaultContent}
            </button>
          );
        })}
      </div>
    </div>
  );
}
