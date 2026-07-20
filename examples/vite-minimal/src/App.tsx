import '@koyomi-cal/react/theme.css';
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
 * Koyomi の最小構成デモ。
 * 月ビューを表示するだけで、予定のドラッグ移動・端のドラッグでのリサイズ・
 * 空き領域のドラッグでの新規作成は Koyomi の既定動作としてそのまま有効になる。
 */
export function App() {
  const events = useMemo(createSampleEvents, []);
  const calendar = useCalendar({ events });

  return (
    <CalendarProvider value={calendar}>
      <div style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Koyomi 最小構成デモ</h1>
        <p>予定のドラッグ移動・リサイズ・空き領域のドラッグでの新規作成を試せます。</p>
        <Toolbar />
        <CalendarView />
      </div>
    </CalendarProvider>
  );
}
