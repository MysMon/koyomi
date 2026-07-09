/**
 * @packageDocumentation
 * 年ビューのビューモデル構築。
 *
 * 12 ヶ月分のミニ月グリッド（各 4〜6 週 × 7 日）を並べ、各日に発生する予定の
 * 件数のみを集計する。月ビューと異なり帯（セグメント）や D&D は持たず、
 * 日付ナビゲーションと予定密度の俯瞰が目的。
 */

import { addMonthsInZone, eachDayInRange, monthGridRange, startOfYearInZone } from '../date-utils';
import { dateKeyInZone, getWallClock, isSameDayInZone, weekdayInZone } from '../timezone';
import type {
  EventOccurrence,
  TimeZoneId,
  Weekday,
  YearDay,
  YearMonth,
  YearViewModel,
} from '../types';

/**
 * オカレンスの「日付スパン」。表示タイムゾーンにおける開始日・終了日の
 * `'YYYY-MM-DD'` キーで表す（両端とも含む）。
 *
 * @remarks
 * `month-view.ts` の同名ロジック（`daySpanOf`）と全く同じ規則を年ビュー用に
 * 複製したもの。`end` は排他的なので、終了日は「`end` の 1 ミリ秒前」が
 * 属する日とする（22:00〜24:00 の予定が翌日に漏れないため）。長さ 0
 * （`start === end`）のオカレンスは開始日のみのスパンとして扱う。
 */
interface OccurrenceDaySpan {
  /** 開始日のキー（表示タイムゾーン基準）。 */
  startKey: string;
  /** 終了日のキー（表示タイムゾーン基準、この日を含む）。 */
  endKey: string;
}

function daySpanOf(occurrence: EventOccurrence, timeZone: TimeZoneId): OccurrenceDaySpan {
  const startKey = dateKeyInZone(occurrence.start, timeZone);
  const lastInstant =
    occurrence.end.getTime() > occurrence.start.getTime()
      ? new Date(occurrence.end.getTime() - 1)
      : occurrence.start;
  const endKey = dateKeyInZone(lastInstant, timeZone);
  // 長さ 0 などで endKey が startKey より前になった場合は開始日のみとする
  return { startKey, endKey: endKey < startKey ? startKey : endKey };
}

/**
 * 年ビューのビューモデルを構築する。
 *
 * 処理内容:
 * - {@link startOfYearInZone} で年初（表示タイムゾーン基準）を求め、
 *   翌年初までの 12 ヶ月分について {@link monthGridRange} でミニ月グリッドの
 *   範囲を決め、{@link eachDayInRange} で日を列挙して 7 日ずつの週に分割する
 * - 各オカレンスの日付スパンを `[年初, 翌年初)` にクランプしたうえで、
 *   日付キーで 1 パスのバケット集計を行い、`eventCount` を求める。
 *   `expandEvents` は範囲と重なるオカレンスを実際の開始/終了のまま返すため、
 *   年境界をまたぐ複数日オカレンス（例: 12/30〜1/3）はクランプしないと
 *   年外の日にも加算されてしまう。複数日にまたがるオカレンスはクランプ後に
 *   覆う各日にカウントし、長さ 0 のオカレンスは開始日に 1 カウントする
 * - `inCurrentMonth: false` のセル（ミニ月グリッドの前後月の日付）は、
 *   集計結果に関わらず `eventCount: 0` に固定する（年内の日は 1 の
 *   クランプにより正確だが、年外の日はデータ不足で正確に出せないため見せない）
 * - `weekdays` は `weekStartsOn` から始まる 7 曜日（`hiddenWeekdays` は無視する。
 *   年ビューは予定表示ではなく日付ナビゲーションが主目的で、曜日を欠いた
 *   ミニカレンダーは日付の読み取りをかえって阻害するため）
 *
 * @param params.currentDate - 表示対象年に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 年グリッド範囲で展開済みのオカレンス一覧
 * @param params.weekStartsOn - 週の開始曜日
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 * @returns 年ビューのビューモデル
 * @example
 * ```ts
 * const viewModel = buildYearViewModel({
 *   currentDate: new Date('2026-07-10T00:00:00+09:00'),
 *   timeZone: 'Asia/Tokyo',
 *   occurrences,
 *   weekStartsOn: 0,
 *   now: new Date(),
 * });
 * viewModel.months[6]?.key; // => '2026-07'
 * ```
 */
export function buildYearViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  now: Date;
}): YearViewModel {
  const { currentDate, timeZone, occurrences, weekStartsOn, now } = params;

  const anchor = startOfYearInZone(currentDate, timeZone);
  // 翌年の年初（クランプ範囲の排他側の終端）
  const nextYearStart = startOfYearInZone(addMonthsInZone(anchor, 12, timeZone), timeZone);

  // 年内の全日（365 または 366 日）。eventCount のクランプ集計における
  // 「日付キー → インデックス」解決と、集計対象日の列挙に使う
  const yearDays = eachDayInRange({ start: anchor, end: nextYearStart }, timeZone);
  const yearKeys = yearDays.map((day) => dateKeyInZone(day, timeZone));
  const yearIndexByKey = new Map<string, number>(yearKeys.map((key, index) => [key, index]));
  const firstYearKey = yearKeys[0] ?? '';
  const lastYearKey = yearKeys[yearKeys.length - 1] ?? '';

  // 各オカレンスの日スパンを [年初, 翌年初) にクランプしてから、日付キーで
  // 1 パスのバケット集計を行う
  const countByKey = new Map<string, number>();
  for (const occurrence of occurrences) {
    const span = daySpanOf(occurrence, timeZone);
    if (span.endKey < firstYearKey || span.startKey > lastYearKey) {
      // 年と重ならない（'YYYY-MM-DD' はゼロ埋めのため辞書順比較が時系列比較と一致する）
      continue;
    }
    const clampedStartKey = span.startKey < firstYearKey ? firstYearKey : span.startKey;
    const clampedEndKey = span.endKey > lastYearKey ? lastYearKey : span.endKey;
    // クランプ後のキーは必ず年内の日付なので yearIndexByKey に存在する（?? は型上の防御）
    const startIndex = yearIndexByKey.get(clampedStartKey) ?? 0;
    const endIndex = yearIndexByKey.get(clampedEndKey) ?? yearKeys.length - 1;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const key = yearKeys[index];
      if (key === undefined) {
        continue;
      }
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
  }

  // weekdays は週開始曜日から始まる 7 曜日。グリッドは常に weekStartsOn で
  // 揃っているため、どの月のミニグリッドから求めても同じ結果になる（年初の月から求める）
  const firstMonthGridDays = eachDayInRange(
    monthGridRange(anchor, timeZone, weekStartsOn),
    timeZone,
  );
  const weekdays: Weekday[] = firstMonthGridDays
    .slice(0, 7)
    .map((day) => weekdayInZone(day, timeZone));

  const months: YearMonth[] = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthAnchor = addMonthsInZone(anchor, monthIndex, timeZone);
    const monthAnchorWall = getWallClock(monthAnchor, timeZone);
    // dateKeyInZone は 'YYYY-MM-DD' 形式なので、先頭 7 文字が 'YYYY-MM' になる
    const monthKey = dateKeyInZone(monthAnchor, timeZone).slice(0, 7);

    const gridDays = eachDayInRange(monthGridRange(monthAnchor, timeZone, weekStartsOn), timeZone);
    const weekCount = Math.floor(gridDays.length / 7);

    const weeks: YearDay[][] = [];
    for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
      const week: YearDay[] = [];
      for (let col = 0; col < 7; col += 1) {
        const date = gridDays[weekIndex * 7 + col];
        if (date === undefined) {
          // monthGridRange は常に 7 の倍数の日数を返すため、ここには到達しない
          throw new Error('グリッド内の日付が見つかりません');
        }
        const key = dateKeyInZone(date, timeZone);
        const wall = getWallClock(date, timeZone);
        const inCurrentMonth =
          wall.year === monthAnchorWall.year && wall.month === monthAnchorWall.month;
        week.push({
          date,
          key,
          inCurrentMonth,
          isToday: isSameDayInZone(date, now, timeZone),
          // 前後月の日付は集計結果に関わらず 0 に固定する
          eventCount: inCurrentMonth ? (countByKey.get(key) ?? 0) : 0,
        });
      }
      weeks.push(week);
    }

    months.push({ anchor: monthAnchor, key: monthKey, weeks });
  }

  return { type: 'year', anchor, months, weekdays };
}
