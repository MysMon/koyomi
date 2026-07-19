'use client';

import { CalendarProvider, CalendarView, Toolbar, useCalendar } from '@koyomi-cal/react';
import type { CalendarEvent } from '@koyomi-cal/react';
import { useMemo } from 'react';

/**
 * 今日を基準にしたサンプル予定を組み立てる。
 * デモをいつ開いても月ビューに予定が表示されるよう、固定日付ではなく相対日付にしている。
 */
function createSampleEvents(): CalendarEvent[] {
  const today = new Date();
  const at = (dayOffset: number, hour: number): Date => {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, 0, 0, 0);
    return date;
  };

  return [
    { id: '1', title: '定例ミーティング', start: at(0, 10), end: at(0, 11) },
    { id: '2', title: 'ランチ', start: at(1, 12), end: at(1, 13) },
    { id: '3', title: '出張', start: at(3, 0), end: at(5, 0), allDay: true },
  ];
}

/**
 * カレンダー本体。
 * ドラッグ操作や「今日」判定などブラウザ API・実行時刻に依存するため
 * `'use client'` コンポーネントとして切り出している。
 * `timeZone` を明示指定し、サーバーとクライアントで「今日」の判定がずれることによる
 * ハイドレーション差分を避けている。
 */
export function CalendarClient() {
  const events = useMemo(createSampleEvents, []);
  const calendar = useCalendar({ events, timeZone: 'Asia/Tokyo' });

  return (
    <CalendarProvider value={calendar}>
      <Toolbar />
      <CalendarView />
    </CalendarProvider>
  );
}
