/**
 * @packageDocumentation
 * SSR 安全な `useLayoutEffect`。
 *
 * `useLayoutEffect` はサーバー（`window` 不在）では実行されず、React が
 * 「useLayoutEffect does nothing on the server」警告を出す。ブラウザでは
 * `useLayoutEffect`、サーバーでは `useEffect` に切り替えることで、
 * ペイント前の同期実行（クライアント）を保ちつつ SSR 警告を避ける。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

import { useEffect, useLayoutEffect } from 'react';

/**
 * ブラウザでは {@link useLayoutEffect}、サーバー（`window` 不在）では
 * {@link useEffect} を使う同型（isomorphic）レイアウトエフェクト。
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
