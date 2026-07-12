/**
 * @packageDocumentation
 * 月ビューのビューモデル構築。
 *
 * 月グリッド（4〜6 週 × 7 日）の各週に対して、オカレンスを帯セグメントとして
 * 配置する。Google カレンダーの月表示と同様、時間指定の 1 日イベントも
 * 帯（span 1 のセグメント）として扱い、見た目の描き分けはコンポーネント側で行う。
 */

import {
  eachDayInRange,
  isoWeekNumberOfWeek,
  monthGridRange,
  startOfMonthInZone,
} from '../date-utils';
import type { BandItemInput } from '../layout/band-layout';
import { layoutBandItems } from '../layout/band-layout';
import { dateKeyInZone, getWallClock, isSameDayInZone, weekdayInZone } from '../timezone';
import type {
  DateRange,
  EventOccurrence,
  EventSegment,
  MonthDay,
  MonthViewModel,
  MonthWeek,
  TimeZoneId,
  Weekday,
} from '../types';

/**
 * オカレンスの「日付スパン」。表示タイムゾーンにおける開始日・終了日の
 * `'YYYY-MM-DD'` キーで表す（両端とも含む）。
 */
interface OccurrenceDaySpan {
  /** 対応するオカレンス。 */
  occurrence: EventOccurrence;
  /** 開始日のキー（表示タイムゾーン基準）。 */
  startKey: string;
  /** 終了日のキー（表示タイムゾーン基準、この日を含む）。 */
  endKey: string;
}

/**
 * オカレンスの日付スパンを計算する。
 *
 * `end` は排他的なので、終了日は「`end` の 1 ミリ秒前」が属する日とする
 * （22:00〜24:00 の予定が翌日に漏れないため）。長さ 0（`start === end`）の
 * オカレンスは開始日のみのスパンとして扱う。
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
 * - 各オカレンスを、表示タイムゾーンにおける日付スパンで週ごとのセグメントに分割する
 *   （週をまたぐオカレンスは週ごとに分かれ、`continuesBefore` / `continuesAfter` が立つ）
 * - 週ごとに帯レイアウト（{@link layoutBandItems}）でレーンを割り当て、
 *   `dayMaxEvents` を超えた分は `hidden` にして各日の `overflowCount` に集計する
 * - `hiddenWeekdays` が指定された場合、該当曜日の列をグリッドから除外する。
 *   セグメントの `startCol` / `span` は除外後の「可視列」基準で計算し直され、
 *   非表示曜日を跨ぐ複数日イベントは可視列上で連続した 1 本のセグメントになる
 *   （例: 金・月のイベントで土日を非表示にすると、金・月の 2 列分 `span: 2` になる）。
 *   オカレンスが非表示曜日のみに存在する場合はセグメントを生成せず、`overflowCount` にも数えない
 *
 * @remarks
 * レーン割当は週ごとに独立して行う（Google カレンダーと同じ）。複数週にまたがる
 * イベントは各週で {@link layoutBandItems} により再レイアウトされるため、
 * 先行週で下位レーンに配置されていても、後続週では（その週の中で最も早く始まる
 * イベントとして扱われるため）上位レーンに詰められることがある。
 * ソート順（開始時刻昇順 → 長いもの優先）により、継続中のイベントの `sortStart` は
 * 常に週の開始より前の実際の開始時刻になるため、継続中のイベントは
 * 常にその週の上位レーンに配置される。
 *
 * @param params.currentDate - 表示対象月に含まれる基準日
 * @param params.timeZone - 表示タイムゾーン
 * @param params.occurrences - 月グリッド範囲で展開済みのオカレンス一覧
 * @param params.weekStartsOn - 週の開始曜日
 * @param params.dayMaxEvents - 1 日に表示する最大イベント数
 * @param params.now - 現在時刻（`isToday` 判定に使用）
 * @param params.hiddenWeekdays - 非表示にする曜日。省略時は `[]`（すべて表示）
 * @param params.showWeekNumbers - 週行に ISO 8601 週番号（`MonthWeek.weekNumber`）を
 *   算出するか。省略時は `false`（`weekNumber` は常に `null`）
 * @param params.segmentRange - セグメント生成・あふれ計上を限定する日時範囲（`end` 排他）。
 *   複数月ビューが「予定は自分の月のグリッドにのみ描画する」規則を実現するために
 *   `[月初, 翌月初)` を渡す。範囲外へはみ出す帯はこの範囲の日にクランプされ、
 *   実際のスパンが範囲外へ続く場合は `continuesBefore` / `continuesAfter` が立つ。
 *   範囲と重ならないオカレンスはセグメントを生成せず、あふれにも数えない。
 *   **省略時はグリッド全域**が対象
 */
export function buildMonthViewModel(params: {
  currentDate: Date;
  timeZone: TimeZoneId;
  occurrences: readonly EventOccurrence[];
  weekStartsOn: Weekday;
  dayMaxEvents: number;
  now: Date;
  hiddenWeekdays?: readonly Weekday[];
  showWeekNumbers?: boolean;
  segmentRange?: DateRange;
}): MonthViewModel {
  const {
    currentDate,
    timeZone,
    occurrences,
    weekStartsOn,
    dayMaxEvents,
    now,
    hiddenWeekdays = [],
    showWeekNumbers = false,
    segmentRange,
  } = params;

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

  // 週内の列（0〜6）と曜日の対応は全週で共通（グリッドは週開始曜日で揃っているため）。
  // これをもとに「可視列」（非表示曜日を除いた列）と、元の列 → 可視列インデックスの
  // 対応表を作る。hiddenWeekdays が空なら全列が可視になり、既存の挙動と完全に一致する
  const weekdayByCol: Weekday[] = gridDays.slice(0, 7).map((date) => weekdayInZone(date, timeZone));
  const hiddenWeekdaySet = new Set(hiddenWeekdays);
  const visibleCols: number[] = [];
  const weekdays: Weekday[] = [];
  weekdayByCol.forEach((weekday, col) => {
    if (!hiddenWeekdaySet.has(weekday)) {
      visibleCols.push(col);
      weekdays.push(weekday);
    }
  });
  const visibleColIndexByOrigCol = new Map<number, number>(
    visibleCols.map((col, visibleIndex) => [col, visibleIndex]),
  );
  const visibleColCount = visibleCols.length;

  // segmentRange 指定時のセグメント配置範囲（日付キー、両端含む）。
  // グリッド境界（第 1）・週境界（第 2）に続く第 3 の境界としてスパン生成段に組み込む。
  // end は排他なので、最終日は「end の 1 ミリ秒前」が属する日とする
  const segmentFirstKey =
    segmentRange === undefined ? undefined : dateKeyInZone(segmentRange.start, timeZone);
  const segmentLastKey =
    segmentRange === undefined
      ? undefined
      : dateKeyInZone(new Date(segmentRange.end.getTime() - 1), timeZone);

  // 各オカレンスの日付スパンをグリッド内インデックス範囲（両端含む）に解決する。
  // グリッド（および segmentRange）と重ならないオカレンスはここで除外する。
  // 範囲外にはみ出す側は端の日にクランプするが、continuesBefore/After の
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
    if (
      (segmentFirstKey !== undefined && span.endKey < segmentFirstKey) ||
      (segmentLastKey !== undefined && span.startKey > segmentLastKey)
    ) {
      // segmentRange と重ならないオカレンスはセグメントを生成しない（あふれにも数えない）
      continue;
    }
    // グリッド境界と segmentRange 境界の両方でクランプした日付キーを求める
    // （'YYYY-MM-DD' はゼロ埋めのため辞書順比較が時系列比較と一致する）
    let clampedStartKey = span.startKey < firstGridKey ? firstGridKey : span.startKey;
    if (segmentFirstKey !== undefined && clampedStartKey < segmentFirstKey) {
      clampedStartKey = segmentFirstKey;
    }
    let clampedEndKey = span.endKey > lastGridKey ? lastGridKey : span.endKey;
    if (segmentLastKey !== undefined && clampedEndKey > segmentLastKey) {
      clampedEndKey = segmentLastKey;
    }
    if (clampedStartKey > clampedEndKey) {
      // segmentRange がグリッドの端と交差しない場合などの防御（通常の複数月ビューでは
      // segmentRange は常にグリッド内に収まるため到達しない）
      continue;
    }
    // グリッドは連続した日付なので、クランプ後のキーは必ず indexByKey に存在する（?? は型上の防御）
    const startIndex = indexByKey.get(clampedStartKey) ?? 0;
    const endIndex = indexByKey.get(clampedEndKey) ?? gridDays.length - 1;
    spans.push({ occurrence, startIndex, endIndex, startKey: span.startKey, endKey: span.endKey });
  }

  const weeks: MonthWeek[] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekStartIndex = weekIndex * 7;
    const weekEndIndex = weekStartIndex + 6;
    const weekFirstKey = gridKeys[weekStartIndex] ?? '';
    const weekLastKey = gridKeys[weekEndIndex] ?? '';
    // 週内の木曜日を基準に ISO 週番号を求める（weekStartsOn の値によらない。
    // 詳細は isoWeekNumberOfWeek を参照）。showWeekNumbers が false（既定）なら常に null
    const weekStartDate = gridDays[weekStartIndex];
    const weekNumber =
      showWeekNumbers && weekStartDate !== undefined
        ? isoWeekNumberOfWeek(weekStartDate, timeZone)
        : null;

    // この週と重なるオカレンスを帯レイアウトの入力に変換する
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
      // 週内の元の列範囲（0〜6）のうち可視列のみを対象に startCol/span を求め直す。
      // 非表示曜日を跨ぐ場合も、可視列上で連続した 1 本のセグメントになる
      let visibleStartCol: number | undefined;
      let visibleEndCol: number | undefined;
      for (let col = segStart - weekStartIndex; col <= segEnd - weekStartIndex; col += 1) {
        const visibleIndex = visibleColIndexByOrigCol.get(col);
        if (visibleIndex === undefined) {
          continue;
        }
        visibleStartCol ??= visibleIndex;
        visibleEndCol = visibleIndex;
      }
      if (visibleStartCol === undefined || visibleEndCol === undefined) {
        // この週では非表示曜日にしか存在しないオカレンスなのでセグメントを生成しない
        continue;
      }
      items.push({
        key: occurrence.key,
        startCol: visibleStartCol,
        span: visibleEndCol - visibleStartCol + 1,
        sortStart: occurrence.start.getTime(),
        sortDuration: occurrence.end.getTime() - occurrence.start.getTime(),
      });
      itemMeta.push({
        occurrence,
        // クランプ後のインデックスではなく実際の日付キーで比較することで、
        // グリッド外へはみ出しているケース（1 週目より前・最終週より後）も拾う。
        // segmentRange 指定時は「範囲外へ続く」（月境界をまたぐ帯が月本体で
        // 打ち切られている）ケースも OR 条件で拾う（週の途中に月境界がある場合、
        // 週境界の比較だけでは検出できない）
        continuesBefore:
          startKey < weekFirstKey || (segmentFirstKey !== undefined && startKey < segmentFirstKey),
        continuesAfter:
          endKey > weekLastKey || (segmentLastKey !== undefined && endKey > segmentLastKey),
      });
    }

    const layout = layoutBandItems(items, visibleColCount, dayMaxEvents);

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

    const days: MonthDay[] = visibleCols.map((col, visibleIndex) => {
      const date = gridDays[weekStartIndex + col];
      if (date === undefined) {
        // visibleCols は 0〜6 の範囲に収まり、週は必ず 7 日分存在するためここには到達しない
        throw new Error('グリッド内の日付が見つかりません');
      }
      const wall = getWallClock(date, timeZone);
      return {
        date,
        key: gridKeys[weekStartIndex + col] ?? dateKeyInZone(date, timeZone),
        inCurrentMonth: wall.year === anchorWall.year && wall.month === anchorWall.month,
        isToday: isSameDayInZone(date, now, timeZone),
        overflowCount: layout.overflowByCol[visibleIndex] ?? 0,
      };
    });

    weeks.push({ days, segments, laneCount: layout.laneCount, weekNumber });
  }

  return { type: 'month', anchor, weeks, weekdays };
}
