/**
 * バンドルサイズ検証用の全ビューアプリ。
 *
 * `CalendarView`（全ビューの切り替えコンポーネント）と `Toolbar` を使い、
 * ライブラリのほぼ全体が含まれる場合のバンドルサイズの上限側を計測する
 * 入力になる。`scripts/check-bundle-size.mjs` からのみ使う。
 */
import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

/** ツールバー付きで全ビューを切り替えられるコンポーネント */
function App() {
  const calendar = useCalendar({});
  return createElement(
    CalendarProvider,
    { value: calendar },
    createElement(Toolbar),
    createElement(CalendarView),
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(createElement(App));
}
