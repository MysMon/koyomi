/**
 * @packageDocumentation
 * `memo` 化した子コンポーネントへ渡すハンドラ集の参照を安定させるフック。
 */

import { useRef } from 'react';
import { eventNotificationSignature } from '../drag-common';
import type { CalendarInteractionCallbacks } from '../types';

/**
 * ハンドラ集（props ゲッターをまとめたオブジェクト）を、再レンダーを跨いで同じ参照で返す。
 *
 * ドラッグ系フックの戻り値は毎レンダー新しいオブジェクトになるため、そのまま `memo` 化した
 * 子コンポーネントへ渡すと再レンダー抑制が効かない。各ビューは「ref 経由で最新のフックの
 * 戻り値へ委譲するだけのラッパー」を `create` で作り、本フックがその参照を保持する。
 *
 * 参照を作り直すのは、追加通知系コールバック（`onEventDoubleClick` /
 * `onEventContextMenu` / `onEventHover` / `onEventHoverEnd`）の**指定の有無**が変わった
 * ときだけ（{@link eventNotificationSignature}）。これらは未指定のとき予定要素に DOM props
 * 自体を付けない仕様のため、追加・削除されたら予定要素を再レンダーして props を増減させる
 * 必要がある。参照が変わると、`drag` を参照比較している `memo` の比較関数がすべて不一致に
 * なり、配下の予定要素が再レンダーされる。コールバックの関数が差し替わっただけ（有無は
 * 同じ）の場合は作り直さない（ハンドラは発火時に最新のコールバックを読むため不要）。
 *
 * @param create - ハンドラ集を作る関数（初回と、指定の有無が変わったときに呼ばれる）
 * @param callbacks - インタラクションコールバック
 * @returns 参照の安定したハンドラ集
 */
export function useStableHandlers<T>(
  create: () => T,
  callbacks: CalendarInteractionCallbacks | undefined,
): T {
  const signature = eventNotificationSignature(callbacks);
  const cacheRef = useRef<{ signature: number; handlers: T } | null>(null);
  if (cacheRef.current === null || cacheRef.current.signature !== signature) {
    cacheRef.current = { signature, handlers: create() };
  }
  return cacheRef.current.handlers;
}
