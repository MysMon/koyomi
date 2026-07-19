/**
 * @packageDocumentation
 * `OverflowPopover` — 月ビューの「+N 件」ボタンから開く、隠れた予定の一覧ポップオーバー。
 *
 * `overflowPopoverButtonProps`（「+N 件」ボタンの ARIA 属性一式を組み立てるヘルパー）と
 * 組み合わせて使う、自前ポップオーバーの完成例。位置決めは外部ライブラリを使わず、
 * 起点となった「+N 件」ボタン（`data-koyomi="month-overflow"`）の `getBoundingClientRect`
 * から素朴に計算する。開閉は `EventDialog` / `ScopeDialog` と同じくモードレスの
 * `<dialog>`（`show()`）で行い、`close` イベントで起点ボタンへのフォーカス復帰を一括して扱う。
 */

import type { EventOccurrence, MonthDay, TimeZoneId } from '@koyomi-cal/react';
import { getWallClock } from '@koyomi-cal/react';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_EVENT_COLOR } from './EventDialog';

/** `OverflowPopover` の `id`（「+N 件」ボタンの `aria-controls` の参照先）。 */
export const OVERFLOW_POPOVER_ID = 'demo-overflow-popover';

/** ポップオーバーの想定幅（px）。ビューポート端でのはみ出し防止の位置計算にも使う。 */
const POPOVER_WIDTH = 260;

/** `OverflowPopover` が表示すべき状態。 */
export interface OverflowPopoverState {
  /** 起点になった日。 */
  day: MonthDay;
  /** その日の全オカレンス（表示中＋「+N 件」に集約された分、開始時刻順）。 */
  occurrences: readonly EventOccurrence[];
}

/** `OverflowPopover` の props。 */
export interface OverflowPopoverProps {
  /** 表示中の状態。`null` なら非表示。 */
  state: OverflowPopoverState | null;
  /** 現在の表示タイムゾーン。時刻表示に使う。 */
  timeZone: TimeZoneId;
  /** 一覧内の予定がクリックされたときに呼ばれる（編集ダイアログを開く想定）。 */
  onOccurrenceSelect: (occurrence: EventOccurrence) => void;
  /**
   * ポップオーバーが閉じられたときに呼ばれる（起点ボタンのクリック以外の
   * 手段——Escape・ポップオーバー外クリック・閉じるボタン・一覧内の予定選択——
   * すべて共通）。
   */
  onClose: () => void;
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** その日の見出し（例:「7月19日(日)」）。 */
function formatDayHeading(date: Date, timeZone: TimeZoneId): string {
  return new Intl.DateTimeFormat('ja', {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

/** 一覧内の 1 件分の時刻表示（終日は「終日」、時間指定は `HH:mm`）。 */
function formatOccurrenceTime(occurrence: EventOccurrence, timeZone: TimeZoneId): string {
  if (occurrence.allDay) {
    return '終日';
  }
  const wall = getWallClock(occurrence.start, timeZone);
  return `${pad2(wall.hours)}:${pad2(wall.minutes)}`;
}

/**
 * 起点になった「+N 件」ボタン（`data-koyomi="month-overflow"`）の DOM 要素を、
 * 対応する日セル（`[data-koyomi="month-day"][data-koyomi-date]`）から探す。
 * 複数月ビューは同じ日が隣接するミニ月グリッドに重複して現れうるため対象外
 * （このデモでは月ビューの「+N 件」のみポップオーバー化している）。
 */
function findOverflowButton(dayKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-koyomi="month-day"][data-koyomi-date="${dayKey}"] [data-koyomi="month-overflow"]`,
  );
}

/**
 * 月ビューの「+N 件」ポップオーバー（モードレス表示）。
 *
 * - 開いたときにその日の起点ボタンの位置を計算し、直下に配置する
 * - 開いたら一覧内の最初の focusable な要素（閉じるボタン）へフォーカスを移す
 * - Escape・ポップオーバー外クリック・閉じるボタン・予定選択のいずれで閉じても、
 *   起点の「+N 件」ボタンへフォーカスを戻す（起点ボタンが DOM 上に残っている場合のみ）
 *
 * @example
 * ```tsx
 * <OverflowPopover
 *   state={overflowState}
 *   timeZone={state.timeZone}
 *   onOccurrenceSelect={(occurrence) => setDialogMode({ type: 'edit', occurrence })}
 *   onClose={() => setOverflowState(null)}
 * />
 * ```
 */
export function OverflowPopover(props: OverflowPopoverProps): ReactElement {
  const { state, timeZone, onOccurrenceSelect, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  // 起点になった「+N 件」ボタン。閉じたときのフォーカス復帰先として保持する。
  const triggerRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  // 開いた直後、位置決め後にフォーカスを移すためのフラグ（EventDialog と同じ方式）。
  const focusPendingRef = useRef(false);

  // state が非 null になるたびに、起点ボタンの位置から表示座標を計算する。
  useLayoutEffect(() => {
    if (state === null) {
      triggerRef.current = null;
      setPosition(null);
      return;
    }
    const trigger = findOverflowButton(state.day.key);
    triggerRef.current = trigger;
    if (trigger === null) {
      setPosition(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
    setPosition({ top: rect.bottom + 4, left });
  }, [state]);

  // state の有無に応じて <dialog> の開閉を同期する（EventDialog/ScopeDialog と同じ方式）。
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return;
    }
    if (state !== null && !dialogEl.open) {
      dialogEl.show();
      focusPendingRef.current = true;
    } else if (state === null && dialogEl.open) {
      dialogEl.close();
    }
  }, [state]);

  // 位置決めが終わった直後に閉じるボタンへフォーカスする。
  useEffect(() => {
    if (state !== null && position !== null && focusPendingRef.current) {
      focusPendingRef.current = false;
      closeButtonRef.current?.focus();
    }
  }, [state, position]);

  // ネイティブな close（Escape・閉じるボタン・外側クリック・予定選択いずれも close() 経由）で
  // 起点ボタンへフォーカスを戻しつつ、呼び出し元へ通知する。
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl === null) {
      return undefined;
    }
    function handleClose(): void {
      const trigger = triggerRef.current;
      onClose();
      // 起点ボタンが再描画等で DOM から失われている場合は何もしない
      if (trigger?.isConnected) {
        trigger.focus();
      }
    }
    dialogEl.addEventListener('close', handleClose);
    return () => dialogEl.removeEventListener('close', handleClose);
  }, [onClose]);

  // ポップオーバー外側のポインタ押下で閉じる（起点の「+N 件」ボタン自体への
  // 押下は、そのクリックが改めて onOverflowClick を呼ぶため対象外にする）。
  useEffect(() => {
    if (state === null) {
      return undefined;
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const dialogEl = dialogRef.current;
      if (dialogEl?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest('[data-koyomi="month-overflow"]') !== null) {
        return;
      }
      dialogRef.current?.close();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [state]);

  return (
    <dialog
      ref={dialogRef}
      id={OVERFLOW_POPOVER_ID}
      className="demo-dialog demo-overflow-popover"
      aria-label={
        state !== null ? `${formatDayHeading(state.day.date, timeZone)}の予定一覧` : undefined
      }
      style={position !== null ? { top: position.top, left: position.left } : undefined}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          dialogRef.current?.close();
        }
      }}
    >
      {state !== null && (
        <div className="demo-overflow-popover-body">
          <div className="demo-overflow-popover-header">
            <span className="demo-overflow-popover-title">
              {formatDayHeading(state.day.date, timeZone)}
            </span>
            <button
              type="button"
              ref={closeButtonRef}
              className="demo-overflow-popover-close"
              aria-label="閉じる"
              onClick={() => dialogRef.current?.close()}
            >
              ×
            </button>
          </div>
          <ul className="demo-overflow-popover-list">
            {state.occurrences.map((occurrence) => (
              <li key={occurrence.key}>
                <button
                  type="button"
                  className="demo-overflow-popover-item"
                  onClick={() => {
                    onOccurrenceSelect(occurrence);
                    dialogRef.current?.close();
                  }}
                >
                  <span
                    className="demo-overflow-popover-item-dot"
                    style={{ backgroundColor: occurrence.event.color ?? DEFAULT_EVENT_COLOR }}
                    aria-hidden="true"
                  />
                  <span className="demo-overflow-popover-item-time">
                    {formatOccurrenceTime(occurrence, timeZone)}
                  </span>
                  <span className="demo-overflow-popover-item-title">{occurrence.event.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}
