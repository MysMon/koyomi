/**
 * @packageDocumentation
 * `useCalendarAnnouncer` — aria-live 通知フック（ヘッドレスな announcer）。
 *
 * `CalendarProvider` の `callbacks`（{@link CalendarInteractionCallbacks}）と
 * `useCalendar` の `onRangeChange` をラップするヘルパーを返す。予定の移動・
 * リサイズ・既定即時作成・削除の確定後、およびビュー・基準日・表示範囲の変更後に、
 * 既定の日本語文言（差し替え可）を aria-live リージョンへ通知する。
 *
 * 完全に opt-in なモジュールで、既存のコンポーネント・フックの挙動・DOM は
 * 一切変更しない。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CalendarEvent,
  CalendarRangeChangeInfo,
  CalendarResource,
  EventOccurrence,
  RecurringEditScope,
  TimeZoneId,
} from '../core/types';
import { formatViewTitle } from './components/format';
import { formatOccurrenceRangeLabel } from './components/month-view-parts';
import { createDefaultEvent } from './drag-common';
import type {
  CalendarInteractionCallbacks,
  EventChange,
  EventDelete,
  RangeSelection,
  UseCalendarResult,
} from './types';

/**
 * live region 要素に spread する props。`politeness` に応じて `role` / `aria-live` が切り替わる。
 * `data-koyomi` の値は {@link _LIVE_REGION_SELECTOR} が対応する `default.css` のセレクタと揃える。
 */
export interface LiveRegionProps {
  /** スタイルフック（`default.css` の sr-only 相当のスタイルが対象とする）。 */
  'data-koyomi': 'live-region';
  /** `politeness` が `'assertive'` なら `'alert'`、それ以外は `'status'`。 */
  role: 'status' | 'alert';
  /** `politeness` の値そのまま。 */
  'aria-live': 'polite' | 'assertive';
  /** 要素全体をひとまとまりの更新として読み上げさせる。 */
  'aria-atomic': 'true';
}

/**
 * 既定文言のフォーマッタに渡される整形コンテキスト。
 */
export interface AnnouncerFormatterContext {
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** ロケール。 */
  locale: string;
  /** `resourceId` からリソース名を解決するための現在のリソース一覧。 */
  resources: readonly CalendarResource[];
}

/**
 * 既定文言のオーバーライド。省略したキーは既定（日本語）のフォーマッタを使う。
 *
 * 各関数は「(対象データ, 既定文言, ctx)」を受け取り、`aria-label` 系 props と同じ
 * 「既定文字列を受け取って加工・置換する」規約に従う。`ctx` には日時整形に使う
 * `timeZone` / `locale` / `resources` を渡す（英語プリセット等、既定文言の語順自体を
 * 変える場合は `defaultMessage` を使わず `ctx` と対象データから組み直せる）。
 */
export interface AnnouncerMessages {
  /** `onEventChange`（ドラッグ・キーボードでの移動/リサイズ/終日変換の確定）。 */
  eventChanged?: (
    change: EventChange,
    defaultMessage: string,
    ctx: AnnouncerFormatterContext,
  ) => string;
  /** `onSelectRange` の既定即時作成が確定した直後（カスタム `onSelectRange` 経路では発火しない）。 */
  eventCreated?: (
    event: CalendarEvent,
    selection: RangeSelection,
    defaultMessage: string,
    ctx: AnnouncerFormatterContext,
  ) => string;
  /** `onEventDelete`（キーボード削除の確定）。 */
  eventDeleted?: (
    deletion: EventDelete,
    defaultMessage: string,
    ctx: AnnouncerFormatterContext,
  ) => string;
  /** `onRangeChange`（ビュー・基準日・表示範囲の変更）。`wrapRangeChange` 経由でのみ発火。 */
  viewChanged?: (
    info: CalendarRangeChangeInfo,
    defaultMessage: string,
    ctx: AnnouncerFormatterContext,
  ) => string;
}

/**
 * 自動通知の対象。省略キーは既定 `true`。
 * ビュー変更（`viewChanged`）は `wrapRangeChange` の呼び出し自体が opt-in なため対象に含まない。
 */
export interface AnnouncerTargets {
  /** `onEventChange` を自動通知するか。既定 `true`。 */
  eventChange?: boolean;
  /** `onSelectRange` の既定即時作成を自動通知するか。既定 `true`。 */
  eventCreate?: boolean;
  /** `onEventDelete` を自動通知するか。既定 `true`。 */
  eventDelete?: boolean;
}

/** {@link useCalendarAnnouncer} のオプション。 */
export interface UseCalendarAnnouncerOptions {
  /**
   * `useCalendar` の戻り値。既定文言の生成（`timeZone` / `locale` / `resources` の解決、
   * 既定即時作成の代行実行）に使う。
   */
  calendar: UseCalendarResult;
  /** live region の緊急度。既定は `'polite'`（`role="status"`）。`'assertive'` は `role="alert"`。 */
  politeness?: 'polite' | 'assertive';
  /** 自動通知の対象。省略キーは既定 `true`。 */
  announce?: AnnouncerTargets;
  /** 既定文言のオーバーライド。省略キーは既定（日本語）。 */
  messages?: AnnouncerMessages;
}

/** {@link useCalendarAnnouncer} の戻り値。 */
export interface UseCalendarAnnouncerResult {
  /** live region 要素に spread する props。 */
  liveRegionProps: LiveRegionProps;
  /**
   * 現在の通知テキスト（live region の children にそのまま渡す）。
   *
   * 同一文言の連続通知では末尾に不可視トークン（U+2060 WORD JOINER）が交互に付き、
   * 見た目・意味上は同じ文言のままスクリーンリーダーへの再読み上げを促す。
   */
  message: string;
  /** 手動で通知する（カスタム `onSelectRange` 経路での作成確定時など）。 */
  announce: (text: string) => void;
  /**
   * `CalendarInteractionCallbacks` をラップし、対象イベントの確定後に自動で `announce` する
   * 新しいコールバック集を返す。`CalendarProvider` の `callbacks` に渡す。
   *
   * `onSelectRange` は常に上書きする（`callbacks.onSelectRange` が未指定のときのみ、
   * 4 つのドラッグ系フックと同じ既定即時作成（`calendar.api.createEvent`）を代行してから
   * 通知する。指定済みならそれを呼ぶだけで、通知は行わない＝作成の確定はアプリ側の責務）。
   *
   * 安定した関数参照（`useCallback`）を返すため、呼び出し側の `useMemo` 依存に安全に使える。
   */
  wrapCallbacks: (callbacks?: CalendarInteractionCallbacks) => CalendarInteractionCallbacks;
  /**
   * `CalendarOptions.onRangeChange` をラップし、ビュー・基準日・表示範囲の変更後に
   * 自動で `announce` する新しいコールバックを返す。`useCalendar({ onRangeChange: ... })` に渡す
   * （`useCalendar` の `onRangeChange` は 1 枠のみのため、このフックが直接奪うことはしない）。
   */
  wrapRangeChange: (
    onRangeChange?: (info: CalendarRangeChangeInfo) => void,
  ) => (info: CalendarRangeChangeInfo) => void;
}

/**
 * live region 要素の識別子（`data-koyomi` 属性値）。`default.css` の
 * `[data-koyomi="live-region"]`（sr-only 相当のスタイル）と対応する。
 *
 * 本フックは live region 要素自体を DOM 検索する必要がないため実行時には使用しないが、
 * CSS と実装の対応関係を検証するテスト（`default-css-contract.test.ts`）がこの
 * `data-koyomi` 値の実在をソースコードから機械的に確認するため、リテラルとして保持する。
 */
const _LIVE_REGION_SELECTOR = '[data-koyomi="live-region"]';

/** 同一文言の連続通知を再読み上げさせるための不可視トークン（U+2060 WORD JOINER）。 */
const REPEAT_TOKEN = '⁠';

/** `politeness` から {@link LiveRegionProps} を組み立てる。 */
function buildLiveRegionProps(politeness: 'polite' | 'assertive'): LiveRegionProps {
  return politeness === 'assertive'
    ? {
        'data-koyomi': 'live-region',
        role: 'alert',
        'aria-live': 'assertive',
        'aria-atomic': 'true',
      }
    : {
        'data-koyomi': 'live-region',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      };
}

/** `resourceId` からリソース名を解決する（未割り当て・参照先のない ID は「未割り当て」）。 */
function resolveResourceLabel(
  resourceId: string | null | undefined,
  resources: readonly CalendarResource[],
): string | null {
  if (resourceId === undefined) {
    return null;
  }
  if (resourceId === null) {
    return '未割り当て';
  }
  const resource = resources.find((candidate) => candidate.id === resourceId);
  return resource?.title ?? '未割り当て';
}

/** {@link RecurringEditScope} の既定の付記文言（`null` は付記なし）。 */
function describeScope(scope: RecurringEditScope | null): string | null {
  switch (scope) {
    case 'this':
      return 'この予定のみ';
    case 'thisAndFollowing':
      return 'これ以降のすべての予定';
    case 'all':
      return 'すべての予定';
    case null:
      return null;
  }
}

/**
 * `EventChange` から移動・サイズ変更・終日⇔時間指定変換のいずれかを判定する。
 *
 * `occurrence.allDay` と `change.allDay` が異なる場合は変換を優先する。それ以外は
 * 区間の長さ（`duration`）が変わっていなければ移動、変わっていればサイズ変更とみなす
 * （リサイズと同時にリソース間移動が起きるような稀なケースでは判定が完全に正確では
 * ないが、常に「移動」「サイズ変更」のいずれかに倒れるため意味は破綻しない）。
 */
function describeChangeVerb(occurrence: EventOccurrence, change: EventChange): string {
  if (occurrence.allDay !== change.allDay) {
    return change.allDay ? '終日予定に変更' : '時間指定予定に変更';
  }
  const before = occurrence.end.getTime() - occurrence.start.getTime();
  const after = change.newRange.end.getTime() - change.newRange.start.getTime();
  return before === after ? '移動' : 'サイズ変更';
}

/** `EventChange` の既定（日本語）文言。 */
function defaultEventChangedMessage(change: EventChange, ctx: AnnouncerFormatterContext): string {
  const { occurrence, newRange, resourceId } = change;
  const verb = describeChangeVerb(occurrence, change);
  const rangeLabel = formatOccurrenceRangeLabel(newRange, change.allDay, ctx.timeZone, ctx.locale);
  const resourceLabel = resolveResourceLabel(resourceId, ctx.resources);
  const base = `${occurrence.event.title} を ${rangeLabel} に${verb}しました`;
  return resourceLabel === null ? base : `${base}（${resourceLabel}）`;
}

/** 既定即時作成で作られたイベントの既定（日本語）文言。 */
function defaultEventCreatedMessage(
  event: CalendarEvent,
  selection: RangeSelection,
  ctx: AnnouncerFormatterContext,
): string {
  const rangeLabel = formatOccurrenceRangeLabel(
    selection.range,
    selection.allDay,
    ctx.timeZone,
    ctx.locale,
  );
  const resourceLabel = resolveResourceLabel(selection.resourceId, ctx.resources);
  const base = `${event.title} を ${rangeLabel} に作成しました`;
  return resourceLabel === null ? base : `${base}（${resourceLabel}）`;
}

/** `EventDelete` の既定（日本語）文言。 */
function defaultEventDeletedMessage(deletion: EventDelete): string {
  const scopeLabel = describeScope(deletion.scope);
  const base = `${deletion.occurrence.event.title} を削除しました`;
  return scopeLabel === null ? base : `${base}（${scopeLabel}）`;
}

/** `CalendarRangeChangeInfo` の既定（日本語）文言。 */
function defaultViewChangedMessage(
  info: CalendarRangeChangeInfo,
  ctx: AnnouncerFormatterContext,
): string {
  const title = formatViewTitle(
    info.view,
    info.currentDate,
    { start: info.rangeStart, end: info.rangeEnd },
    ctx.timeZone,
    ctx.locale,
  );
  return `表示を${title}に切り替えました`;
}

/** `calendar` から現在の整形コンテキストを求める（`api.getState()` の最新値を使う）。 */
function currentCtx(calendar: UseCalendarResult): AnnouncerFormatterContext {
  const state = calendar.api.getState();
  return { timeZone: state.timeZone, locale: state.options.locale, resources: state.resources };
}

/**
 * aria-live 通知フック（ヘッドレスな announcer）。
 *
 * `CalendarProvider` の `callbacks` と `useCalendar` の `onRangeChange` をラップする
 * ヘルパー（{@link UseCalendarAnnouncerResult.wrapCallbacks} /
 * {@link UseCalendarAnnouncerResult.wrapRangeChange}）を返す。予定の移動・リサイズ・
 * 既定即時作成・削除の確定後、および明示的に配線した場合はビュー変更後に、
 * 既定の日本語文言（`messages` で差し替え可、`enUsLabels.announcer` で英語化可）を
 * live region へ通知する。
 *
 * カスタムの `onSelectRange`（ダイアログ等）を使う経路では作成が確定したかどうかを
 * アプリ側しか把握できないため自動通知しない。作成確定時に
 * {@link UseCalendarAnnouncerResult.announce} を手動で呼ぶこと。
 *
 * live region 要素は `CalendarProvider` の配下に置く必要はない（`calendar` 以外への
 * 依存を持たないため、DOM 上の配置に制約はない）。
 *
 * @param options - {@link UseCalendarAnnouncerOptions}
 * @returns {@link UseCalendarAnnouncerResult}
 * @example
 * ```tsx
 * function App() {
 *   const calendar = useCalendar();
 *   const announcer = useCalendarAnnouncer({ calendar });
 *   return (
 *     <div>
 *       <div {...announcer.liveRegionProps}>{announcer.message}</div>
 *       <CalendarProvider value={calendar} callbacks={announcer.wrapCallbacks(myCallbacks)}>
 *         <CalendarView />
 *       </CalendarProvider>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCalendarAnnouncer(
  options: UseCalendarAnnouncerOptions,
): UseCalendarAnnouncerResult {
  const politeness = options.politeness ?? 'polite';

  // document リスナー等は持たないが、他のフック（use-calendar-shortcuts.ts 等）と
  // 同じく ref 経由で最新値を参照する。wrapCallbacks/wrapRangeChange を安定した
  // 関数参照（useCallback の空配列依存）で返すため。
  const calendarRef = useRef(options.calendar);
  calendarRef.current = options.calendar;
  const messagesRef = useRef(options.messages);
  messagesRef.current = options.messages;
  const targetsRef = useRef(options.announce);
  targetsRef.current = options.announce;

  const [message, setMessage] = useState('');
  /** 直前の announce({@link announce}) の呼び出し内容（同一文言の連続通知の判定用）。 */
  const previousRef = useRef<{ text: string; suffixed: boolean } | null>(null);

  const announce = useCallback((text: string) => {
    const previous = previousRef.current;
    if (previous !== null && previous.text === text) {
      const suffixed = !previous.suffixed;
      previousRef.current = { text, suffixed };
      setMessage(suffixed ? `${text}${REPEAT_TOKEN}` : text);
      return;
    }
    previousRef.current = { text, suffixed: false };
    setMessage(text);
  }, []);

  const wrapCallbacks = useCallback(
    (callbacks?: CalendarInteractionCallbacks): CalendarInteractionCallbacks => {
      const wrapped: CalendarInteractionCallbacks = { ...callbacks };

      // 通知対象（targets）の判定はラップ関数の構築時ではなく呼び出し時に行う。
      // wrapCallbacks は安定参照として呼び出し側でメモ化される想定のため、
      // 構築時に判定すると announce オプションの後からの切替が反映されない
      // （onSelectRange の eventCreate 判定と同じ規約に揃える）
      {
        const original = callbacks?.onEventChange;
        wrapped.onEventChange = (change) => {
          original?.(change);
          if (targetsRef.current?.eventChange ?? true) {
            const ctx = currentCtx(calendarRef.current);
            const defaultMessage = defaultEventChangedMessage(change, ctx);
            const custom = messagesRef.current?.eventChanged;
            announce(custom ? custom(change, defaultMessage, ctx) : defaultMessage);
          }
        };
      }

      {
        const original = callbacks?.onEventDelete;
        wrapped.onEventDelete = (deletion) => {
          original?.(deletion);
          if (targetsRef.current?.eventDelete ?? true) {
            const ctx = currentCtx(calendarRef.current);
            const defaultMessage = defaultEventDeletedMessage(deletion);
            const custom = messagesRef.current?.eventDeleted;
            announce(custom ? custom(deletion, defaultMessage, ctx) : defaultMessage);
          }
        };
      }

      const originalOnSelectRange = callbacks?.onSelectRange;
      wrapped.onSelectRange = (selection) => {
        if (originalOnSelectRange !== undefined) {
          originalOnSelectRange(selection);
          return;
        }
        const created = createDefaultEvent(calendarRef.current.api, selection);
        if (targetsRef.current?.eventCreate ?? true) {
          const ctx = currentCtx(calendarRef.current);
          const defaultMessage = defaultEventCreatedMessage(created, selection, ctx);
          const custom = messagesRef.current?.eventCreated;
          announce(custom ? custom(created, selection, defaultMessage, ctx) : defaultMessage);
        }
      };

      return wrapped;
    },
    [announce],
  );

  const wrapRangeChange = useCallback(
    (onRangeChange?: (info: CalendarRangeChangeInfo) => void) => {
      return (info: CalendarRangeChangeInfo) => {
        onRangeChange?.(info);
        const ctx = currentCtx(calendarRef.current);
        const defaultMessage = defaultViewChangedMessage(info, ctx);
        const custom = messagesRef.current?.viewChanged;
        announce(custom ? custom(info, defaultMessage, ctx) : defaultMessage);
      };
    },
    [announce],
  );

  const liveRegionProps = useMemo(() => buildLiveRegionProps(politeness), [politeness]);

  return useMemo(
    () => ({ liveRegionProps, message, announce, wrapCallbacks, wrapRangeChange }),
    [liveRegionProps, message, announce, wrapCallbacks, wrapRangeChange],
  );
}
