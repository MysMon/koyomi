/**
 * @packageDocumentation
 * デモアプリの共通サンプルデータ層。
 *
 * 実行時の「今日」（表示タイムゾーン `Asia/Tokyo` の現地時刻）を基準に相対配置し、
 * Koyomi の主要な機能（各種の繰り返しパターン・EXDATE・繰り返しオーバーライド・
 * 終日予定・複数日にまたがる終日予定・日をまたぐ時間指定予定・他タイムゾーンの
 * 予定・編集不可・extendedProps など）を一通り確認できる基本セット
 * （{@link sampleEvents} / {@link sampleResources}）を提供する。
 *
 * これに加え、「チーム」パターン向けに大量データを決定的に生成する
 * {@link makeManyResources} / {@link makeManyEvents} を提供する。
 */

import type { CalendarEvent, CalendarResource, Weekday } from '@koyomi-cal/react';
import { addDaysInZone, dateKeyInZone, getWallClock, weekdayInZone } from '@koyomi-cal/react';

/** サンプルデータの基準タイムゾーン（デモの初期表示タイムゾーンと合わせる）。 */
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

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

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
  return BYDAY_CODES[weekdayInZone(new Date(), BASE_TIME_ZONE)];
}

/** 今日から `offsetDays` 日後の曜日に対応する RRULE の `BYDAY` コードを返す。 */
function byDayCodeForOffset(offsetDays: number): string {
  const date = addDaysInZone(new Date(), offsetDays, BASE_TIME_ZONE);
  return BYDAY_CODES[weekdayInZone(date, BASE_TIME_ZONE)];
}

/** 今日の日にち（月内の日、1〜31）を返す（`BYMONTHDAY` の生成に使う）。 */
function todayDayOfMonth(): number {
  return getWallClock(new Date(), BASE_TIME_ZONE).day;
}

/**
 * 今日から `offsetDays` 日後の日時（`BASE_TIME_ZONE` 現地時刻）を、RRULE の
 * `UNTIL` 形式（`'YYYYMMDDTHHMMSSZ'`）の文字列にする。
 *
 * @remarks
 * RFC 5545 の記法上は `Z` 付き＝ UTC 時刻を表すが、Koyomi は `UNTIL` を
 * イベントのタイムゾーンにおける現地時刻として解釈する（`docs/recurrence.md`
 * 参照）。ここでは `BASE_TIME_ZONE` の現地時刻の年月日に指定の時刻を
 * 埋め込むだけでよい。
 */
function untilAt(offsetDays: number, hours: number, minutes: number): string {
  const wall = getWallClock(addDaysInZone(new Date(), offsetDays, BASE_TIME_ZONE), BASE_TIME_ZONE);
  return `${String(wall.year).padStart(4, '0')}${pad2(wall.month)}${pad2(wall.day)}T${pad2(hours)}${pad2(minutes)}00Z`;
}

/**
 * デモの基本イベント一覧。
 *
 * 単発予定・各種の繰り返しパターン（毎日・毎週・隔週相当の EXDATE・
 * COUNT／UNTIL 付き・月次 BYMONTHDAY）・終日予定・他タイムゾーンの予定・
 * 編集不可の予定・繰り返しオーバーライド・extendedProps を含む。
 */
export const sampleEvents: CalendarEvent[] = [
  {
    // 毎日 9:00〜9:15 に繰り返される朝会。「毎日」の繰り返しの例。
    id: 'sample-daily-standup',
    title: '朝会',
    resourceId: 'room-a',
    start: `${dayKey(0)}T09:00:00`,
    end: `${dayKey(0)}T09:15:00`,
    rrule: 'FREQ=DAILY',
    color: '#8e24aa',
    location: 'オンライン (Meet)',
    description: '毎日の進捗共有ミーティング。',
  },
  {
    // sample-daily-standup の 2 日後の回だけを 10:00〜10:15 に振り替えた
    // 「オーバーライド」イベント。recurringEventId + originalStart の例。
    // マスター側は変更されないため、このオーバーライドと originalStart が
    // 一致するオカレンスだけが置き換えられる（docs/recurrence.md 参照）。
    id: 'sample-standup-override',
    title: '朝会（振替）',
    resourceId: 'room-a',
    start: `${dayKey(2)}T10:00:00`,
    end: `${dayKey(2)}T10:15:00`,
    recurringEventId: 'sample-daily-standup',
    originalStart: `${dayKey(2)}T09:00:00`,
    color: '#7b1fa2',
    location: '会議室 A',
    description: '朝会を 1 時間後ろ倒しにした回（振替）。',
  },
  {
    // 今日の曜日に毎週繰り返される定例。「BYDAY」の繰り返しの例。
    id: 'sample-weekly-sync',
    title: 'チーム定例',
    resourceId: 'room-a',
    start: `${dayKey(0)}T14:00:00`,
    end: `${dayKey(0)}T15:00:00`,
    rrule: `FREQ=WEEKLY;BYDAY=${todayByDayCode()}`,
    color: '#006b75',
    location: '会議室 A',
    description: '週次の進捗確認とふりかえり。',
  },
  {
    // 毎週の企画会議。ただし 2 週間後の回だけを EXDATE で欠席（休会）にした例。
    id: 'sample-weekly-with-exdate',
    title: '企画会議',
    resourceId: 'room-b',
    start: `${dayKey(1)}T13:00:00`,
    end: `${dayKey(1)}T14:00:00`,
    rrule: `FREQ=WEEKLY;BYDAY=${byDayCodeForOffset(1)}`,
    exdates: [`${dayKey(15)}T13:00:00`],
    color: '#2e7d32',
    location: '会議室 B',
    description: '2 週間後の回は EXDATE により休会（表示されない）。',
  },
  {
    // 5 回で終了する（COUNT 付き）ワークショップ。
    id: 'sample-count-limited',
    title: '新人研修ワークショップ',
    resourceId: 'room-b',
    start: `${dayKey(-2)}T16:00:00`,
    end: `${dayKey(-2)}T17:30:00`,
    rrule: `FREQ=WEEKLY;BYDAY=${byDayCodeForOffset(-2)};COUNT=5`,
    color: '#a14600',
    location: '会議室 B',
    description: '全 5 回のシリーズ（COUNT=5）。',
  },
  {
    // 10 日後の同時刻で打ち切られる（UNTIL 付き）キャンペーン監視。
    id: 'sample-until-limited',
    title: '施策モニタリング',
    start: `${dayKey(0)}T08:00:00`,
    end: `${dayKey(0)}T08:30:00`,
    rrule: `FREQ=DAILY;UNTIL=${untilAt(10, 8, 30)}`,
    color: '#006978',
    description: '施策終了予定日まで毎日実施（UNTIL 付き）。',
  },
  {
    // 毎月、今日と同じ日にちに繰り返される定例（BYMONTHDAY）。
    id: 'sample-monthly-bymonthday',
    title: '月次経営会議',
    resourceId: 'room-a',
    start: `${dayKey(0)}T11:00:00`,
    end: `${dayKey(0)}T12:00:00`,
    rrule: `FREQ=MONTHLY;BYMONTHDAY=${todayDayOfMonth()}`,
    color: '#5e35b1',
    location: '会議室 A',
    description: '毎月同じ日にちに開催（BYMONTHDAY）。',
  },
  {
    // 今日 10:00〜11:00 の単発会議。次のイベントと同時間帯で重なりを作る。
    // 部署情報を extendedProps に持たせた例。
    id: 'sample-meeting-a',
    title: '商談: A社様',
    resourceId: 'room-b',
    start: `${dayKey(0)}T10:00:00`,
    end: `${dayKey(0)}T11:00:00`,
    color: '#b3261e',
    location: '会議室 B',
    extendedProps: { department: '営業部', dealStage: '提案' },
  },
  {
    // sample-meeting-a と同時間帯（今日 10:00〜11:00）に重なる単発会議。
    id: 'sample-meeting-b',
    title: '採用面接',
    resourceId: 'room-b',
    start: `${dayKey(0)}T10:00:00`,
    end: `${dayKey(0)}T11:00:00`,
    color: '#c53929',
    location: '会議室 C',
    extendedProps: { department: '人事部', candidateId: 'C-1042' },
  },
  {
    // 今日の終日イベント。
    id: 'sample-all-day',
    title: '創立記念日',
    start: dayKey(0),
    end: dayKey(1),
    allDay: true,
    color: '#137333',
  },
  {
    // 明日から 3 日間にまたがる終日イベント（end は排他的なので +3 日）。
    id: 'sample-multi-day',
    title: '出張（大阪）',
    resourceId: 'car-1',
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
    // 切り替えても、この予定の実時刻（絶対時刻）は変わらず、表示時刻だけが正しく換算されることを確認できる。
    id: 'sample-ny-timezone',
    title: '海外拠点との定例',
    start: `${dayKey(1)}T21:00:00`,
    end: `${dayKey(1)}T21:30:00`,
    timeZone: 'America/New_York',
    color: '#315da8',
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
    resourceId: 'room-a',
    start: `${dayKey(1)}T15:00:00`,
    end: `${dayKey(1)}T15:30:00`,
    color: '#3f51b5',
  },
  {
    // 毎月の最終営業日（BYSETPOS）に実施する月末締め処理。BYSETPOS は
    // useRecurrenceRuleEditor の編集エディタが対応しない RRULE 指定の例
    // （EventDialog では読み取り専用の unsupported 表示になる）。
    id: 'sample-unsupported-rrule',
    title: '月末締め処理',
    resourceId: 'room-b',
    start: `${dayKey(0)}T17:00:00`,
    end: `${dayKey(0)}T18:00:00`,
    rrule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    color: '#616161',
    location: '会議室 B',
    description: '毎月の最終営業日に実施（BYSETPOS。編集フォームでは読み取り専用）。',
  },
];

/**
 * デモ用のサンプルリソース（リソースビュー・タイムラインビューで使用する）。
 *
 * `resourceId` を持たないサンプル予定（施策モニタリング・夜間バッチ監視など）は
 * 未割り当てレーンに表示される。
 */
export const sampleResources: CalendarResource[] = [
  { id: 'room-a', title: '会議室A', color: '#3f51b5' },
  { id: 'room-b', title: '会議室B', color: '#00897b' },
  { id: 'car-1', title: '社用車1号', color: '#ef6c00' },
];

/**
 * `array[index % array.length]` を安全に取り出す。
 *
 * `noUncheckedIndexedAccess` により通常の添字アクセスは `T | undefined` に
 * なるが、`% array.length` により添字は必ず範囲内に収まるため、ここでは
 * 空配列でない限り `undefined` にはならない（空配列が渡された場合のみ例外）。
 */
function cyclic<T>(array: readonly T[], index: number): T {
  const value = array[index % array.length];
  if (value === undefined) {
    throw new Error('cyclic: 空の配列には対応していません');
  }
  return value;
}

/** {@link makeManyResources} が使う姓のローテーション（決定的に命名するため）。 */
const MEMBER_SURNAMES: readonly string[] = [
  '佐藤',
  '鈴木',
  '高橋',
  '田中',
  '伊藤',
  '渡辺',
  '山本',
  '中村',
  '小林',
  '加藤',
  '吉田',
  '山田',
  '佐々木',
  '山口',
  '松本',
  '井上',
  '木村',
  '林',
  '斎藤',
  '清水',
];

/** {@link makeManyResources} / {@link makeManyEvents} が使う色のローテーション。 */
const MEMBER_COLORS: readonly string[] = [
  '#3f51b5',
  '#00695c',
  '#a64200',
  '#8e24aa',
  '#006b75',
  '#b3261e',
  '#2e7d32',
  '#5e35b1',
  '#a14600',
  '#006978',
];

/**
 * 「チームメンバー」風のリソースを `count` 件、決定的に生成する。
 *
 * 姓を {@link MEMBER_SURNAMES} からローテーションし、一覧を一巡した場合は
 * 連番を付けて一意にする（例: 21 人目は「佐藤さん2」）。
 *
 * @param count - 生成するリソース件数
 * @example
 * ```ts
 * const resources = makeManyResources(40);
 * // resources.length === 40
 * ```
 */
export function makeManyResources(count: number): CalendarResource[] {
  return Array.from({ length: count }, (_, index) => {
    const surname = cyclic(MEMBER_SURNAMES, index);
    const cycle = Math.floor(index / MEMBER_SURNAMES.length);
    const title = cycle === 0 ? `${surname}さん` : `${surname}さん${cycle + 1}`;
    return {
      id: `member-${index + 1}`,
      title,
      color: cyclic(MEMBER_COLORS, index),
    };
  });
}

/** {@link makeManyEvents} が使う予定タイトルのローテーション。 */
const MANY_EVENT_TITLES: readonly string[] = [
  '定例MTG',
  '1on1',
  '設計レビュー',
  '顧客商談',
  '進捗確認',
  'コードレビュー',
  '企画会議',
  '採用面接',
  'ワークショップ',
  '振り返り',
];

/** {@link makeManyEvents} が使う開始時刻（時）のローテーション。 */
const MANY_EVENT_START_HOURS: readonly number[] = [9, 10, 11, 13, 14, 15, 16, 17];

/**
 * `hour:minute` に `addMinutes` 分を加えた時刻を返す（同日内に収まる前提）。
 */
function addMinutesToHourMinute(
  hour: number,
  minute: number,
  addMinutes: number,
): { hour: number; minute: number } {
  const total = hour * 60 + minute + addMinutes;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

/**
 * 大量イベント（数百〜千件規模）を、乱数を使わず決定的に生成する。
 *
 * 各リソースについて `days` 日分、1 日あたり 1〜3 件の予定を規則的
 * （インデックスの剰余）に配置する。予定の色は指定せず、リソース自身の色
 * （{@link CalendarResource.color}）にフォールバックさせる。
 *
 * @param resources - 予定を割り当てるリソース一覧（{@link makeManyResources} の結果を想定）
 * @param days - 今日を起点に生成する日数
 * @example
 * ```ts
 * const resources = makeManyResources(40);
 * const events = makeManyEvents(resources, 14); // 800〜1000 件程度
 * ```
 */
export function makeManyEvents(
  resources: readonly CalendarResource[],
  days: number,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  resources.forEach((resource, resourceIndex) => {
    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const key = dayKey(dayOffset);
      const eventsPerDay = 1 + ((resourceIndex + dayOffset) % 3);

      for (let slot = 0; slot < eventsPerDay; slot += 1) {
        const hourIndex = resourceIndex * 2 + dayOffset * 3 + slot;
        const startHour = cyclic(MANY_EVENT_START_HOURS, hourIndex);
        const durationMinutes = 30 + ((resourceIndex + slot) % 3) * 30;
        const { hour: endHour, minute: endMinute } = addMinutesToHourMinute(
          startHour,
          0,
          durationMinutes,
        );
        const title = cyclic(MANY_EVENT_TITLES, resourceIndex + dayOffset + slot);

        events.push({
          id: `many-${resource.id}-${dayOffset}-${slot}`,
          title: `${title}（${resource.title}）`,
          resourceId: resource.id,
          start: `${key}T${pad2(startHour)}:00:00`,
          end: `${key}T${pad2(endHour)}:${pad2(endMinute)}:00`,
        });
      }
    }
  });

  return events;
}
