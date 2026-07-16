/**
 * @packageDocumentation
 * `useCalendarAnnouncer` — aria-live 通知フック（ヘッドレスな announcer）。
 *
 * `CalendarProvider` の `callbacks`（{@link CalendarInteractionCallbacks}）をラップする
 * ヘルパー（`wrapCallbacks`）を返し、加えて `calendar` の状態を内部で購読する。予定の
 * 移動・リサイズ・既定即時作成・削除の確定後、および（`announce.viewChange: true` の
 * ときのみ）ビュー・基準日・表示範囲の変更後に、中央メッセージカタログ
 * （`messages.announcer`、`messages` オプションで部分上書き可）の文言を aria-live
 * リージョンへ通知する。
 *
 * 完全に opt-in なモジュールで、既存のコンポーネント・フックの挙動・DOM は
 * 一切変更しない。`CalendarProvider` に依存せず自前でカタログを解決するため、
 * Provider の配下に置く必要はない。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalendarRangeChangeInfo,
  CalendarResource,
  EventOccurrence,
  TimeZoneId,
} from '../core/types';
import { formatViewTitle } from './components/format';
import { formatOccurrenceRangeLabel } from './components/month-view-parts';
import { createDefaultEvent } from './drag-common';
import { resolveMessageCatalog } from './locales/resolve';
import type { EventChangeVerb, MessageCatalogOverrides } from './locales/types';
import type { CalendarInteractionCallbacks, EventChange, UseCalendarResult } from './types';

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
 * 通知文言を組み立てる際に参照する現在の整形コンテキスト（`calendar` から都度求める）。
 */
interface AnnouncerContext {
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** ロケール。 */
  locale: string;
  /** `resourceId` からリソース名を解決するための現在のリソース一覧。 */
  resources: readonly CalendarResource[];
}

/**
 * 自動通知の対象。`viewChange` を除き、省略キーは既定 `true`。
 */
export interface AnnouncerTargets {
  /** `onEventChange` を自動通知するか。既定 `true`。 */
  eventChange?: boolean;
  /** `onSelectRange` の既定即時作成を自動通知するか。既定 `true`。 */
  eventCreate?: boolean;
  /** `onEventDelete` を自動通知するか。既定 `true`。 */
  eventDelete?: boolean;
  /**
   * ビュー・基準日・表示範囲の変更（`calendar` への内部購読で検知）を自動通知するか。
   *
   * **既定 `false`**。他の 3 項目とは既定値が異なる opt-in 項目
   * （ビュー変更はナビゲーション操作のたびに発生し得るため、常時通知が
   * 要るとは限らない）。
   */
  viewChange?: boolean;
}

/** {@link useCalendarAnnouncer} のオプション。 */
export interface UseCalendarAnnouncerOptions {
  /**
   * `useCalendar` の戻り値。通知文言の生成（`timeZone` / `locale` / `resources` の解決、
   * 既定即時作成の代行実行）に使う。
   */
  calendar: UseCalendarResult;
  /** live region の緊急度。既定は `'polite'`（`role="status"`）。`'assertive'` は `role="alert"`。 */
  politeness?: 'polite' | 'assertive';
  /** 自動通知の対象。{@link AnnouncerTargets} を参照（`viewChange` のみ既定 `false`）。 */
  announce?: AnnouncerTargets;
  /**
   * 中央メッセージカタログの部分上書き。省略時は `calendar` の `locale` に対応する
   * 既定カタログ（`messages.announcer` グループ）をそのまま使う。
   */
  messages?: MessageCatalogOverrides;
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

/**
 * `resourceId` からリソース名を解決する（未割り当て・参照先のない ID は
 * `unassignedLabel`。呼び出し元は `catalog.announcer.unassignedResource` を渡す）。
 */
function resolveAnnouncerResourceLabel(
  resourceId: string | null | undefined,
  resources: readonly CalendarResource[],
  unassignedLabel: string,
): string | null {
  if (resourceId === undefined) {
    return null;
  }
  if (resourceId === null) {
    return unassignedLabel;
  }
  const resource = resources.find((candidate) => candidate.id === resourceId);
  return resource?.title ?? unassignedLabel;
}

/**
 * `EventChange` から移動・サイズ変更・終日⇔時間指定変換のいずれかを判定する、
 * ロケールに依存しない分類関数。
 *
 * `occurrence.allDay` と `change.allDay` が異なる場合は変換を優先する。それ以外は
 * 区間の長さ（`duration`）が変わっていなければ移動、変わっていればサイズ変更とみなす
 * （リサイズと同時にリソース間移動が起きるような稀なケースでは判定が完全に正確では
 * ないが、常に「移動」「サイズ変更」のいずれかに倒れるため意味は破綻しない）。
 *
 * @param occurrence - 変更前のオカレンス
 * @param change - 変更内容
 * @returns イベント変更の種別
 */
export function classifyEventChangeVerb(
  occurrence: EventOccurrence,
  change: EventChange,
): EventChangeVerb {
  if (occurrence.allDay !== change.allDay) {
    return change.allDay ? 'convertedToAllDay' : 'convertedToTimed';
  }
  const before = occurrence.end.getTime() - occurrence.start.getTime();
  const after = change.newRange.end.getTime() - change.newRange.start.getTime();
  return before === after ? 'moved' : 'resized';
}

/** `calendar` から現在の整形コンテキストを求める（`api.getState()` の最新値を使う）。 */
function currentCtx(calendar: UseCalendarResult): AnnouncerContext {
  const state = calendar.api.getState();
  return { timeZone: state.timeZone, locale: state.options.locale, resources: state.resources };
}

/**
 * aria-live 通知フック（ヘッドレスな announcer）。
 *
 * `CalendarProvider` の `callbacks` をラップするヘルパー
 * （{@link UseCalendarAnnouncerResult.wrapCallbacks}）を返し、加えて `calendar` の
 * 状態変更を内部で購読する。予定の移動・リサイズ・既定即時作成・削除の確定後、
 * および `announce.viewChange: true` を指定した場合はビュー・基準日・表示範囲の
 * 変更後（マウント後の変化のみ。初期マウント自体は通知しない）に、中央メッセージ
 * カタログ（`messages.announcer`、`messages` オプションで部分上書き可）の文言を
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
 *   const announcer = useCalendarAnnouncer({ calendar, announce: { viewChange: true } });
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
  // 同じく ref 経由で最新値を参照する。wrapCallbacks を安定した関数参照
  // （useCallback の空配列依存）で返すため、また下記のビュー変更購読 effect からも
  // 呼び出し時点の最新値を参照するため。
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
            const catalog = resolveMessageCatalog(ctx.locale, messagesRef.current);
            const verb = classifyEventChangeVerb(change.occurrence, change);
            const rangeLabel = formatOccurrenceRangeLabel(
              change.newRange,
              change.allDay,
              ctx.timeZone,
              ctx.locale,
              catalog.common.rangeSeparator,
            );
            const resourceLabel = resolveAnnouncerResourceLabel(
              change.resourceId,
              ctx.resources,
              catalog.announcer.unassignedResource,
            );
            announce(catalog.announcer.eventChanged(change, verb, rangeLabel, resourceLabel));
          }
        };
      }

      {
        const original = callbacks?.onEventDelete;
        wrapped.onEventDelete = (deletion) => {
          original?.(deletion);
          if (targetsRef.current?.eventDelete ?? true) {
            const ctx = currentCtx(calendarRef.current);
            const catalog = resolveMessageCatalog(ctx.locale, messagesRef.current);
            announce(catalog.announcer.eventDeleted(deletion));
          }
        };
      }

      const originalOnSelectRange = callbacks?.onSelectRange;
      wrapped.onSelectRange = (selection) => {
        if (originalOnSelectRange !== undefined) {
          originalOnSelectRange(selection);
          return;
        }
        const ctx = currentCtx(calendarRef.current);
        const catalog = resolveMessageCatalog(ctx.locale, messagesRef.current);
        const created = createDefaultEvent(
          calendarRef.current.api,
          selection,
          catalog.common.untitledEvent,
        );
        if (targetsRef.current?.eventCreate ?? true) {
          const rangeLabel = formatOccurrenceRangeLabel(
            selection.range,
            selection.allDay,
            ctx.timeZone,
            ctx.locale,
            catalog.common.rangeSeparator,
          );
          const resourceLabel = resolveAnnouncerResourceLabel(
            selection.resourceId,
            ctx.resources,
            catalog.announcer.unassignedResource,
          );
          announce(catalog.announcer.eventCreated(created, selection, rangeLabel, resourceLabel));
        }
      };

      return wrapped;
    },
    [announce],
  );

  // ビュー・基準日・表示範囲の変更を検知する内部購読。`calendar.api` に対して
  // マウント後（`useEffect` 内）に 1 度だけ登録し、以後は `api.subscribe` の
  // 通知のたびに現在値を前回値と比較する。マウント時点の値は「比較の基準値」
  // としてのみ記録し、通知は行わない（この effect 自身の初回実行では
  // announce しない）。`viewChange` が `false`（既定）の間も購読自体は張ったまま
  // にする（判定はコールバック内で行う。`targetsRef` を後から `true` へ切り替えた
  // 場合に、切り替え後の最初の変化から正しく検知できるようにするため）。
  useEffect(() => {
    const api = options.calendar.api;

    /** 比較対象のスナップショットを現在の状態から作る。 */
    const snapshot = () => {
      const state = api.getState();
      const range = api.getVisibleRange();
      return {
        view: state.view,
        currentDate: state.currentDate,
        rangeStart: range.start,
        rangeEnd: range.end,
      };
    };

    let previous = snapshot();

    const unsubscribe = api.subscribe(() => {
      const next = snapshot();
      const changed =
        next.view !== previous.view ||
        next.currentDate.getTime() !== previous.currentDate.getTime() ||
        next.rangeStart.getTime() !== previous.rangeStart.getTime() ||
        next.rangeEnd.getTime() !== previous.rangeEnd.getTime();
      previous = next;
      if (!changed || targetsRef.current?.viewChange !== true) {
        return;
      }
      const ctx = currentCtx(calendarRef.current);
      const catalog = resolveMessageCatalog(ctx.locale, messagesRef.current);
      const info: CalendarRangeChangeInfo = {
        view: next.view,
        currentDate: next.currentDate,
        rangeStart: next.rangeStart,
        rangeEnd: next.rangeEnd,
      };
      const title = formatViewTitle(
        info.view,
        info.currentDate,
        { start: info.rangeStart, end: info.rangeEnd },
        ctx.timeZone,
        ctx.locale,
      );
      announce(catalog.announcer.viewChanged(info, title));
    });

    return unsubscribe;
  }, [options.calendar.api, announce]);

  const liveRegionProps = useMemo(() => buildLiveRegionProps(politeness), [politeness]);

  return useMemo(
    () => ({ liveRegionProps, message, announce, wrapCallbacks }),
    [liveRegionProps, message, announce, wrapCallbacks],
  );
}
