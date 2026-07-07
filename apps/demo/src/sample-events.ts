/**
 * @packageDocumentation
 * デモ用のサンプルイベント。
 *
 * 実行時の「今日」（表示タイムゾーン `Asia/Tokyo` の壁時計）を基準に相対配置し、
 * Koyomi の主要な機能（繰り返し予定・終日予定・複数日にまたがる終日予定・
 * 日をまたぐ時間指定予定・他タイムゾーンの予定・編集不可の予定・重なる予定）を
 * 一通り確認できるように構成している。
 */

import type { CalendarEvent, Weekday } from '@koyomi-cal/react';
import { addDaysInZone, dateKeyInZone, weekdayInZone } from '@koyomi-cal/react';

/** サンプルイベントの基準タイムゾーン（デモの初期表示タイムゾーンと合わせる）。 */
const BASE_TIME_ZONE = 'Asia/Tokyo';

/** RRULE の `BYDAY` に使う曜日コード（{@link Weekday} → 2 文字コード）。 */
const BYDAY_CODES: Record<Weekday, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
};

/**
 * 今日から `offsetDays` 日後の日付キー（`'YYYY-MM-DD'`、`BASE_TIME_ZONE` 基準）を返す。
 *
 * @param offsetDays - 今日からの日数オフセット（負数で過去方向）
 */
function dayKey(offsetDays: number): string {
  return dateKeyInZone(addDaysInZone(new Date(), offsetDays, BASE_TIME_ZONE), BASE_TIME_ZONE);
}

/** 今日の曜日に対応する RRULE の `BYDAY` コードを返す。 */
function todayByDayCode(): string {
  const code = BYDAY_CODES[weekdayInZone(new Date(), BASE_TIME_ZONE)];
  return code;
}

/** デモの初期イベント一覧。 */
export const sampleEvents: CalendarEvent[] = [
  {
    // 毎日 9:00〜9:15 に繰り返される朝会。「毎日」の繰り返しの例。
    id: 'sample-daily-standup',
    title: '朝会',
    start: `${dayKey(0)}T09:00:00`,
    end: `${dayKey(0)}T09:15:00`,
    rrule: 'FREQ=DAILY',
    color: '#8e24aa',
    location: 'オンライン (Meet)',
    description: '毎日の進捗共有ミーティング。',
  },
  {
    // 今日の曜日に毎週繰り返される定例。「BYDAY」の繰り返しの例。
    id: 'sample-weekly-sync',
    title: 'チーム定例',
    start: `${dayKey(0)}T14:00:00`,
    end: `${dayKey(0)}T15:00:00`,
    rrule: `FREQ=WEEKLY;BYDAY=${todayByDayCode()}`,
    color: '#039be5',
    location: '会議室 A',
    description: '週次の進捗確認とふりかえり。',
  },
  {
    // 今日 10:00〜11:00 の単発会議。次のイベントと同時間帯で重なりを作る。
    id: 'sample-meeting-a',
    title: '商談: A社様',
    start: `${dayKey(0)}T10:00:00`,
    end: `${dayKey(0)}T11:00:00`,
    color: '#e67c73',
    location: '会議室 B',
  },
  {
    // sample-meeting-a と同時間帯（今日 10:00〜11:00）に重なる単発会議。
    id: 'sample-meeting-b',
    title: '採用面接',
    start: `${dayKey(0)}T10:00:00`,
    end: `${dayKey(0)}T11:00:00`,
    color: '#f4511e',
    location: '会議室 C',
  },
  {
    // 今日の終日イベント。
    id: 'sample-all-day',
    title: '創立記念日',
    start: dayKey(0),
    end: dayKey(1),
    allDay: true,
    color: '#33b679',
  },
  {
    // 明日から 3 日間にまたがる終日イベント（end は排他的なので +3 日）。
    id: 'sample-multi-day',
    title: '出張（大阪）',
    start: dayKey(1),
    end: dayKey(4),
    allDay: true,
    color: '#3f51b5',
    location: '大阪支店',
  },
  {
    // 今日 22:00 から翌日 2:00 までの日をまたぐ時間指定イベント。
    id: 'sample-overnight',
    title: '夜間バッチ監視',
    start: `${dayKey(0)}T22:00:00`,
    end: `${dayKey(1)}T02:00:00`,
    color: '#616161',
    description: '深夜のバッチ処理監視当番。',
  },
  {
    // America/New_York のタイムゾーンを持つイベント。表示タイムゾーンを
    // 切り替えると、この予定の表示時刻だけ変わらず換算されることを確認できる。
    id: 'sample-ny-timezone',
    title: '海外拠点との定例',
    start: `${dayKey(1)}T21:00:00`,
    end: `${dayKey(1)}T21:30:00`,
    timeZone: 'America/New_York',
    color: '#8ab4f8',
    description: 'ニューヨークオフィスとの定例ミーティング（NY時間 21:00 開始）。',
  },
  {
    // editable: false のイベント。ドラッグ移動・リサイズができないことを確認できる。
    id: 'sample-readonly',
    title: '全社総会（予定変更不可）',
    start: `${dayKey(2)}T13:00:00`,
    end: `${dayKey(2)}T15:00:00`,
    color: '#d50000',
    editable: false,
    location: '本社大ホール',
  },
  {
    // 明日午後の単発の 1on1 面談。
    id: 'sample-one-on-one',
    title: '1on1 面談',
    start: `${dayKey(1)}T15:00:00`,
    end: `${dayKey(1)}T15:30:00`,
    color: '#7986cb',
  },
];
