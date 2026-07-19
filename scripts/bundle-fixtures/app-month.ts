/**
 * バンドルサイズ検証用の最小アプリ（月ビューのみ）。
 *
 * バレル（`@koyomi-cal/react`）から月ビュー関連だけを import した場合に、
 * 未使用のビューコンポーネントが利用側バンドラの tree-shaking で
 * バンドルから除外されることを検証する入力になる。
 * `scripts/check-bundle-size.mjs` からのみ使う。アプリとしては実行しない。
 */
import { CalendarProvider, MonthView, useCalendar } from '@koyomi-cal/react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

/** 月ビューだけを描画するコンポーネント */
function App() {
  const calendar = useCalendar({});
  return createElement(CalendarProvider, { value: calendar }, createElement(MonthView));
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(createElement(App));
}
