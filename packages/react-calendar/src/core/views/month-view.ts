/**
 * @packageDocumentation
 * 月ビューのビューモデル構築。
 *
 * 月グリッド（4〜6 週 × 7 日）の各週に対して、発生を帯セグメントとして
 * 配置する。Google カレンダーの月表示と同様、時間指定の 1 日イベントも
 * 帯（span 1 のセグメント）として扱い、見た目の描き分けはコンポーネント側で行う。
 */

import { eachDayInRange, monthGridRange, startOfMonthInZone } from '../date-utils';
import type { BandItemInput } from '../layout/band-layout';
import { layoutBandItems } from '../layout/band-layout';
import { dateKeyInZone, getWallClock, isSameDayInZone, weekdayInZone } from '../timezone';
import type {
  EventOccurrence,
  EventSegment,
  MonthDay,
  MonthViewModel,
  MonthWeek,
  TimeZoneId,
  Weekday,
} from '../types';

/**
 * 発生の「日付スパン」。表示タイムゾーンにおける開始日・終了日の
 * `'YYYY-MM-DD'` キーで表す（両端とも含む）。
 */
interface OccurrenceDaySpan {
  /** 対応する発生。 */
  occurrence: EventOccurrence;
  /** 開始日のキー（表示タイムゾーン基準）。 */
  startKey: string;
  /** 終了日のキー（表示タイムゾーン基準、この日を含む）。 */
  endKey: string;
}

/**
 * 発生の日付スパンを計算する。
 *
 * `end` は排他的なので、終了日は「`end` の 1 ミリ秒前」が属する日とする
 * （22:00〜24:00 の予定が翌日に漏れないため）。長さ 0（`start === end`）の
 * 発生は開始日のみのスパンとして扱う。
 */
function daySpanOf(occurrence: EventOccurrence, timeZone: TimeZoneId): OccurrenceDaySpan {
  const startKey = dateKeyInZone(occurrence.start, timeZone);
  const lastInstant =
    occurrence.end.getTime() > occurrence.start.getTime()
      ? new Date(occurrence.end.getTime() - 1)
      : occurrence.start;
  const endKey = dateKeyInZone(lastInstant, timeZone);
  // 長さ 0 などで endKey が startKey より前になった場合は開始日のみとする
  return { occurrence, startKey, endKey: endKey < startKey ? startKey : endKey };
}

/**
 * 月ビューのビューモデルを構築する。
 *
 * 処理内容:
 * - {@link monthGridRange} で表示範囲（週の並び）を決め、週ごとに日を並べる
 * - 各発生を、表示タイムゾーンにおける日付スパンで週ごとのセグメントに分割する
 *   （週をまたぐ発生は週ごとに分かれ、`continuesBefore` / `continuesAfter` が立つ）
 * - 週ごとに帯レイアウト（{@link layoutBandItems}）でレーンを割り当て、
 *   `dayMaxEvents` を超えた分は `hidden` にして各日の `overflowCount` に集計する
 *
 * @param params.currentDate - 表示対象月に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 月グリッド範囲で展開済みの発生一覧
 * @param params.weekStartsOn - 週の開始曜日
 * @param params.dayMaxEvents - 1 日に表示する最大イベント数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 */
export function buildMonthViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  dayMaxEvents: number;
  now: Date;
}): MonthViewModel {
  const { currentDate, timeZone, occurrences, weekStartsOn, dayMaxEvents, now } = params;

  const anchor = startOfMonthInZone(currentDate, timeZone);
  const anchorWall = getWallClock(anchor, timeZone);

  // グリッドの全日（週数 × 7 日）。monthGridRange は常に 7 の倍数の日数を返す
  const gridDays = eachDayInRange(monthGridRange(currentDate, timeZone, weekStartsOn), timeZone);
  const gridKeys = gridDays.map((day) => dateKeyInZone(day, timeZone));
  const weekCount = Math.floor(gridDays.length / 7);

  // 日付キー → グリッド内インデックス。'YYYY-MM-DD' 形式はゼロ埋めのため
  // 辞書順比較が時系列比較と一致することを利用する
  const indexByKey = new Map<string, number>(gridKeys.map((key, index) => [key, index]));
  const firstGridKey = gridKeys[0] ?? '';
  const lastGridKey = gridKeys[gridKeys.length - 1] ?? '';

  // 各発生の日付スパンをグリッド内インデックス範囲（両端含む）に解決する。
  // グリッドと重ならない発生はここで除外する。
  // グリッド外にはみ出す側は端の日にクランプするが、continuesBefore/After の
  // 判定に使うため、クランプ前の実際のスパンをキーで保持しておく
  const spans: {
    occurrence: EventOccurrence;
    startIndex: number;
    endIndex: number;
    startKey: string;
    endKey: string;
  }[] = [];
  for (const occurrence of occurrences) {
    const span = daySpanOf(occurrence, timeZone);
    if (span.endKey < firstGridKey || span.startKey > lastGridKey) {
      continue;
    }
    // グリッドは連続した日付なので、範囲内のキーは必ず indexByKey に存在する（?? は型上の防御）
    const startIndex = span.startKey < firstGridKey ? 0 : (indexByKey.get(span.startKey) ?? 0);
    const endIndex =
      span.endKey > lastGridKey
        ? gridDays.length - 1
        : (indexByKey.get(span.endKey) ?? gridDays.length - 1);
    spans.push({ occurrence, startIndex, endIndex, startKey: span.startKey, endKey: span.endKey });
  }

  const weeks: MonthWeek[] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekStartIndex = weekIndex * 7;
    const weekEndIndex = weekStartIndex + 6;
    const weekFirstKey = gridKeys[weekStartIndex] ?? '';
    const weekLastKey = gridKeys[weekEndIndex] ?? '';

    // この週と重なる発生を帯レイアウトの入力に変換する
    const items: BandItemInput[] = [];
    const itemMeta: {
      occurrence: EventOccurrence;
      continuesBefore: boolean;
      continuesAfter: boolean;
    }[] = [];
    for (const { occurrence, startIndex, endIndex, startKey, endKey } of spans) {
      const segStart = Math.max(startIndex, weekStartIndex);
      const segEnd = Math.min(endIndex, weekEndIndex);
      if (segStart > segEnd) {
        continue;
      }
      items.push({
        key: occurrence.key,
        startCol: segStart - weekStartIndex,
        span: segEnd - segStart + 1,
        sortStart: occurrence.start.getTime(),
        sortDuration: occurrence.end.getTime() - occurrence.start.getTime(),
      });
      itemMeta.push({
        occurrence,
        // クランプ後のインデックスではなく実際の日付キーで比較することで、
        // グリッド外へはみ出しているケース（1 週目より前・最終週より後）も拾う
        continuesBefore: startKey < weekFirstKey,
        continuesAfter: endKey > weekLastKey,
      });
    }

    const layout = layoutBandItems(items, 7, dayMaxEvents);

    // placements は入力順を維持するため、items / itemMeta と同じ添字で対応付けられる
    const segments: EventSegment[] = items.map((item, index) => {
      const placement = layout.placements[index];
      const meta = itemMeta[index];
      if (placement === undefined || meta === undefined) {
        // layoutBandItems は入力と同数の placements を返すため、ここには到達しない
        throw new Error('帯レイアウトの結果が入力アイテムと対応していません');
      }
      return {
        occurrence: meta.occurrence,
        startCol: item.startCol,
        span: item.span,
        lane: placement.lane,
        continuesBefore: meta.continuesBefore,
        continuesAfter: meta.continuesAfter,
        hidden: placement.hidden,
      };
    });
    // 表示順: レーン昇順 → 週内の開始列昇順
    segments.sort((a, b) => a.lane - b.lane || a.startCol - b.startCol);

    const days: MonthDay[] = gridDays.slice(weekStartIndex, weekStartIndex + 7).map((date, col) => {
      const wall = getWallClock(date, timeZone);
      return {
        date,
        key: gridKeys[weekStartIndex + col] ?? dateKeyInZone(date, timeZone),
        inCurrentMonth: wall.year === anchorWall.year && wall.month === anchorWall.month,
        isToday: isSameDayInZone(date, now, timeZone),
        overflowCount: layout.overflowByCol[col] ?? 0,
      };
    });

    weeks.push({ days, segments, laneCount: layout.laneCount });
  }

  // 曜日ヘッダーは 1 週目の各日の曜日（= 週開始曜日から始まる 7 曜日）
  const weekdays: Weekday[] = gridDays.slice(0, 7).map((date) => weekdayInZone(date, timeZone));

  return { type: 'month', anchor, weeks, weekdays };
}
