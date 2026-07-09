/**
 * interaction.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' や 'UTC' を明示して行う。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST → EDT、02:00〜02:59 は存在しない）
 * - 終了: 2026-11-01 02:00（EDT → EST、01:00〜01:59 は 2 回現れる）
 */
import { describe, expect, it } from 'vitest';
import type { TimeGridDragState } from './interaction';
import {
  dayDragPreviewRange,
  dragPreviewRange,
  shortcutForKey,
  snapToInterval,
  timeAtGridPosition,
} from './interaction';
import { dateFromKey, getWallClock, parseDateValue } from './timezone';
import type { CalendarEvent, EventOccurrence, TimeZoneId } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
const UTC = 'UTC';

/**
 * 指定タイムゾーンの現地時刻 `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。
 */
function at(isoLocal: string, timeZone: TimeZoneId): Date {
  return parseDateValue(isoLocal, timeZone, false);
}

/**
 * テスト用の EventOccurrence を構築するヘルパ。
 * `key` は `'<eventId>@<startISO>'` 形式にする。
 */
function makeOccurrence(params: {
  start: Date;
  end: Date;
  eventId?: string;
  allDay?: boolean;
}): EventOccurrence {
  const eventId = params.eventId ?? 'ev-1';
  const allDay = params.allDay ?? false;
  const event: CalendarEvent = {
    id: eventId,
    title: 'テスト予定',
    start: params.start,
    end: params.end,
    allDay,
  };
  return {
    key: `${eventId}@${params.start.toISOString()}`,
    eventId,
    event,
    start: params.start,
    end: params.end,
    allDay,
    isRecurring: false,
    originalStart: params.start,
  };
}

describe('snapToInterval', () => {
  it('15 分間隔で最近傍に丸める（37 → 30、38 → 45）', () => {
    expect(snapToInterval(37, 15)).toBe(30);
    expect(snapToInterval(38, 15)).toBe(45);
  });

  it('中間値（7.5）は Math.round の規則で切り上げ側に丸める', () => {
    expect(snapToInterval(7.5, 15)).toBe(15);
    expect(snapToInterval(7.4, 15)).toBe(0);
  });

  it('ちょうど倍数の値はそのまま返す（0 を含む）', () => {
    expect(snapToInterval(0, 15)).toBe(0);
    expect(snapToInterval(45, 15)).toBe(45);
    expect(snapToInterval(1440, 30)).toBe(1440);
  });

  it('snap が 1 未満（0・負数・小数）の場合は 1 として扱う', () => {
    expect(snapToInterval(37.4, 0)).toBe(37);
    expect(snapToInterval(37.6, -5)).toBe(38);
    expect(snapToInterval(10.2, 0.5)).toBe(10);
  });

  it('異なる間隔（30 分・60 分）でも最近傍に丸める', () => {
    expect(snapToInterval(44, 30)).toBe(30);
    expect(snapToInterval(46, 30)).toBe(60);
    expect(snapToInterval(89, 60)).toBe(60);
    expect(snapToInterval(91, 60)).toBe(120);
  });
});

describe('timeAtGridPosition', () => {
  const dayTokyo = dateFromKey('2026-07-07', TOKYO);

  it('fractionY = 0 はその日の 0:00 を返す', () => {
    const result = timeAtGridPosition({ day: dayTokyo, fractionY: 0, timeZone: TOKYO, snap: 15 });
    expect(result).toEqual(dayTokyo);
  });

  it('fractionY = 0.5 は現地時刻 12:00 を返す', () => {
    const result = timeAtGridPosition({
      day: dayTokyo,
      fractionY: 0.5,
      timeZone: TOKYO,
      snap: 15,
    });
    expect(result).toEqual(at('2026-07-07T12:00', TOKYO));
  });

  it('fractionY = 1 は 1440 - snap 分にクランプされる（snap 15 → 23:45）', () => {
    const result = timeAtGridPosition({ day: dayTokyo, fractionY: 1, timeZone: TOKYO, snap: 15 });
    expect(result).toEqual(at('2026-07-07T23:45', TOKYO));
  });

  it('snap 60 の場合のクランプ上限は 23:00 になる', () => {
    const result = timeAtGridPosition({ day: dayTokyo, fractionY: 1, timeZone: TOKYO, snap: 60 });
    expect(result).toEqual(at('2026-07-07T23:00', TOKYO));
  });

  it('snap が 1440 を超える場合、fractionY = 0 と 1 のどちらも当日 0:00（日内）になる', () => {
    // 修正前は上限が 1440 - 2000 = -560 となり、前日側へはみ出していた
    const result0 = timeAtGridPosition({
      day: dayTokyo,
      fractionY: 0,
      timeZone: TOKYO,
      snap: 2000,
    });
    const result1 = timeAtGridPosition({
      day: dayTokyo,
      fractionY: 1,
      timeZone: TOKYO,
      snap: 2000,
    });
    expect(result0).toEqual(dayTokyo);
    expect(result1).toEqual(dayTokyo);
  });

  it('1440 を割り切らない snap（25 分）では fractionY = 1 が格子上の 1425 分（23:45）にクランプされる', () => {
    // 修正前の上限は 1440 - 25 = 1415 分で、25 の倍数の格子から外れていた
    const result = timeAtGridPosition({ day: dayTokyo, fractionY: 1, timeZone: TOKYO, snap: 25 });
    expect(result).toEqual(at('2026-07-07T23:45', TOKYO));
  });

  it('負の fractionY は 0:00 にクランプされる', () => {
    const result = timeAtGridPosition({
      day: dayTokyo,
      fractionY: -0.25,
      timeZone: TOKYO,
      snap: 15,
    });
    expect(result).toEqual(dayTokyo);
  });

  it('スナップ間隔に丸められる（fractionY = 0.3・snap 30 → 7:00）', () => {
    // 0.3 * 1440 = 432 分 → 30 分間隔の最近傍 = 420 分 = 7:00
    const result = timeAtGridPosition({ day: dayTokyo, fractionY: 0.3, timeZone: TOKYO, snap: 30 });
    expect(result).toEqual(at('2026-07-07T07:00', TOKYO));
  });

  it('UTC でも同様に計算できる', () => {
    const dayUtc = dateFromKey('2026-07-07', UTC);
    const result = timeAtGridPosition({ day: dayUtc, fractionY: 0.5, timeZone: UTC, snap: 15 });
    expect(result.toISOString()).toBe('2026-07-07T12:00:00.000Z');
  });

  describe('America/New_York の DST 開始日（2026-03-08）', () => {
    const dstDay = dateFromKey('2026-03-08', NY);

    it('fractionY = 0 は 0:00 EST（UTC-5）を返す', () => {
      const result = timeAtGridPosition({ day: dstDay, fractionY: 0, timeZone: NY, snap: 15 });
      expect(result.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    });

    it('fractionY = 0.5 は現地時刻 12:00 EDT（UTC-4）に対応する', () => {
      const result = timeAtGridPosition({ day: dstDay, fractionY: 0.5, timeZone: NY, snap: 15 });
      expect(getWallClock(result, NY)).toMatchObject({ hours: 12, minutes: 0, day: 8 });
      expect(result.toISOString()).toBe('2026-03-08T16:00:00.000Z');
    });

    it('存在しない時刻（2:00）に相当する位置は直後の実在時刻（3:00 EDT）に繰り上げて解決される', () => {
      // 120 分 = 現地時刻 2:00 は存在しない → 3:00 EDT に繰り上げて解決
      const result = timeAtGridPosition({
        day: dstDay,
        fractionY: 120 / 1440,
        timeZone: NY,
        snap: 15,
      });
      expect(getWallClock(result, NY)).toMatchObject({ hours: 3, minutes: 0, day: 8 });
      expect(result.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    });

    it('fractionY = 1 は現地時刻 23:45 EDT にクランプされる', () => {
      const result = timeAtGridPosition({ day: dstDay, fractionY: 1, timeZone: NY, snap: 15 });
      expect(getWallClock(result, NY)).toMatchObject({ hours: 23, minutes: 45, day: 8 });
      expect(result.toISOString()).toBe('2026-03-09T03:45:00.000Z');
    });
  });
});

describe('dragPreviewRange', () => {
  const context = { timeZone: TOKYO, snap: 15 };

  describe('create', () => {
    it('アンカーより後にドラッグすると [anchor, pointer) になる', () => {
      const state: TimeGridDragState = {
        mode: 'create',
        occurrence: null,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T11:30', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T11:30', TOKYO));
    });

    it('アンカーより前にドラッグすると順序が反転して [pointer, anchor) になる', () => {
      const state: TimeGridDragState = {
        mode: 'create',
        occurrence: null,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T08:15', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T08:15', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T10:00', TOKYO));
    });

    it('同時刻（クリック相当）の場合は snap 分の長さになる', () => {
      const anchor = at('2026-07-07T10:00', TOKYO);
      const state: TimeGridDragState = { mode: 'create', occurrence: null, anchor };
      const range = dragPreviewRange(state, new Date(anchor.getTime()), context);
      expect(range.start).toEqual(anchor);
      expect(range.end).toEqual(at('2026-07-07T10:15', TOKYO));
    });

    it('日を跨ぐドラッグ（0:00 ちょうどまで）でも end 排他で扱える', () => {
      const state: TimeGridDragState = {
        mode: 'create',
        occurrence: null,
        anchor: at('2026-07-07T23:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-08T00:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T23:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-08T00:00', TOKYO));
    });

    it('snap が 0 でもクリック相当は空プレビューにならず 1 分の長さになる（正規化）', () => {
      const anchor = at('2026-07-07T10:00', TOKYO);
      const state: TimeGridDragState = { mode: 'create', occurrence: null, anchor };
      const range = dragPreviewRange(state, new Date(anchor.getTime()), {
        timeZone: TOKYO,
        snap: 0,
      });
      expect(range.start).toEqual(anchor);
      expect(range.end).toEqual(at('2026-07-07T10:01', TOKYO));
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    });

    it('snap が負数でもクリック相当は end < start に反転せず 1 分の長さになる', () => {
      const anchor = at('2026-07-07T10:00', TOKYO);
      const state: TimeGridDragState = { mode: 'create', occurrence: null, anchor };
      const range = dragPreviewRange(state, new Date(anchor.getTime()), {
        timeZone: TOKYO,
        snap: -15,
      });
      expect(range.start).toEqual(anchor);
      expect(range.end).toEqual(at('2026-07-07T10:01', TOKYO));
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    });
  });

  describe('move', () => {
    it('移動量だけ開始がずれ、長さ（ミリ秒）が維持される', () => {
      const occurrence = makeOccurrence({
        start: at('2026-07-07T10:00', TOKYO),
        end: at('2026-07-07T11:00', TOKYO),
      });
      const state: TimeGridDragState = {
        mode: 'move',
        occurrence,
        anchor: at('2026-07-07T10:15', TOKYO),
      };
      // アンカー（イベント内のつかんだ位置）から 2 時間後へ
      const range = dragPreviewRange(state, at('2026-07-07T12:15', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T12:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T13:00', TOKYO));
    });

    it('日を跨ぐ移動でも長さが維持される', () => {
      const occurrence = makeOccurrence({
        start: at('2026-07-07T23:00', TOKYO),
        end: at('2026-07-07T23:30', TOKYO),
      });
      const state: TimeGridDragState = {
        mode: 'move',
        occurrence,
        anchor: at('2026-07-07T23:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-08T01:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-08T01:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-08T01:30', TOKYO));
      expect(range.end.getTime() - range.start.getTime()).toBe(30 * 60 * 1000);
    });

    it('前方向（過去側）への移動もできる', () => {
      const occurrence = makeOccurrence({
        start: at('2026-07-07T10:00', TOKYO),
        end: at('2026-07-07T11:00', TOKYO),
      });
      const state: TimeGridDragState = {
        mode: 'move',
        occurrence,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T08:30', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T08:30', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T09:30', TOKYO));
    });

    it('occurrence が null なら Error を投げる', () => {
      const state: TimeGridDragState = {
        mode: 'move',
        occurrence: null,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      expect(() => dragPreviewRange(state, at('2026-07-07T11:00', TOKYO), context)).toThrow(
        /オカレンス/,
      );
    });
  });

  describe('resize', () => {
    const occurrence = makeOccurrence({
      start: at('2026-07-07T10:00', TOKYO),
      end: at('2026-07-07T11:00', TOKYO),
    });

    it('開始は固定され、ポインタ位置が終了時刻になる', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T12:30', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T12:30', TOKYO));
    });

    it('ポインタが開始より前でも最小 snap 分の長さを保つ', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T09:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T10:15', TOKYO));
    });

    it('ポインタが開始と同時刻でも最小 snap 分の長さを保つ', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T10:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T10:15', TOKYO));
    });

    it('occurrence が null なら Error を投げる', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence: null,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      expect(() => dragPreviewRange(state, at('2026-07-07T12:00', TOKYO), context)).toThrow(
        /オカレンス/,
      );
    });

    it('snap が 0 でも最小 1 分の長さを保つ（正規化）', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T10:00', TOKYO), {
        timeZone: TOKYO,
        snap: 0,
      });
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T10:01', TOKYO));
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    });

    it('snap が負数でも end が start を下回らず最小 1 分の長さを保つ', () => {
      const state: TimeGridDragState = {
        mode: 'resize',
        occurrence,
        anchor: at('2026-07-07T11:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T09:00', TOKYO), {
        timeZone: TOKYO,
        snap: -30,
      });
      expect(range.start).toEqual(at('2026-07-07T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T10:01', TOKYO));
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    });
  });

  describe('resize-start（上端リサイズ）', () => {
    const occurrence = makeOccurrence({
      start: at('2026-07-07T10:00', TOKYO),
      end: at('2026-07-07T11:00', TOKYO),
    });

    it('終了は固定され、ポインタ位置が開始時刻になる', () => {
      const state: TimeGridDragState = {
        mode: 'resize-start',
        occurrence,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T09:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T09:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T11:00', TOKYO));
    });

    it('ポインタが終了より後でも最小 snap 分の長さを保つ', () => {
      const state: TimeGridDragState = {
        mode: 'resize-start',
        occurrence,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      const range = dragPreviewRange(state, at('2026-07-07T12:00', TOKYO), context);
      expect(range.start).toEqual(at('2026-07-07T10:45', TOKYO));
      expect(range.end).toEqual(at('2026-07-07T11:00', TOKYO));
    });

    it('occurrence が null なら Error を投げる', () => {
      const state: TimeGridDragState = {
        mode: 'resize-start',
        occurrence: null,
        anchor: at('2026-07-07T10:00', TOKYO),
      };
      expect(() => dragPreviewRange(state, at('2026-07-07T09:00', TOKYO), context)).toThrow(
        /オカレンス/,
      );
    });
  });
});

describe('dayDragPreviewRange', () => {
  describe('create', () => {
    it('単一日のクリック相当は当日 0:00 から翌日 0:00（排他）になる', () => {
      const day = dateFromKey('2026-07-08', TOKYO);
      const range = dayDragPreviewRange(
        { mode: 'create', occurrence: null },
        day,
        new Date(day.getTime()),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-08', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-09', TOKYO));
    });

    it('後ろの日へドラッグすると [アンカー日, ポインタ日の翌日 0:00) になる', () => {
      const range = dayDragPreviewRange(
        { mode: 'create', occurrence: null },
        dateFromKey('2026-07-10', TOKYO),
        dateFromKey('2026-07-08', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-08', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-11', TOKYO));
    });

    it('前の日へドラッグすると順序が反転して [ポインタ日, アンカー日の翌日 0:00) になる', () => {
      const range = dayDragPreviewRange(
        { mode: 'create', occurrence: null },
        dateFromKey('2026-07-08', TOKYO),
        dateFromKey('2026-07-10', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-08', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-11', TOKYO));
    });

    it('DST 開始日（NY 2026-03-08）を含む範囲でも end は翌日の現地時刻 0:00 になる', () => {
      const range = dayDragPreviewRange(
        { mode: 'create', occurrence: null },
        dateFromKey('2026-03-08', NY),
        dateFromKey('2026-03-07', NY),
        NY,
      );
      expect(range.start).toEqual(dateFromKey('2026-03-07', NY));
      // 3/8 は 23 時間しかないため、翌日 0:00 は単純な +24h とは異なる
      expect(range.end).toEqual(dateFromKey('2026-03-09', NY));
    });
  });

  describe('move', () => {
    it('日数差だけ開始・終了がずれ、期間（日数）が維持される（複数日の終日イベント）', () => {
      const occurrence = makeOccurrence({
        start: dateFromKey('2026-07-01', TOKYO),
        end: dateFromKey('2026-07-03', TOKYO),
        allDay: true,
      });
      const range = dayDragPreviewRange(
        { mode: 'move', occurrence },
        dateFromKey('2026-07-05', TOKYO),
        dateFromKey('2026-07-01', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-05', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-07', TOKYO));
    });

    it('アンカーがイベント途中の日でも日数差で移動する', () => {
      const occurrence = makeOccurrence({
        start: dateFromKey('2026-07-01', TOKYO),
        end: dateFromKey('2026-07-04', TOKYO),
        allDay: true,
      });
      // イベント 2 日目（7/2）をつかんで 7/3 へ → 全体が +1 日
      const range = dayDragPreviewRange(
        { mode: 'move', occurrence },
        dateFromKey('2026-07-03', TOKYO),
        dateFromKey('2026-07-02', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-02', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-05', TOKYO));
    });

    it('前方向（負の日数差）への移動も正しく計算される', () => {
      const occurrence = makeOccurrence({
        start: at('2026-07-10T09:00', TOKYO),
        end: at('2026-07-10T10:00', TOKYO),
      });
      const range = dayDragPreviewRange(
        { mode: 'move', occurrence },
        dateFromKey('2026-07-08', TOKYO),
        dateFromKey('2026-07-10', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(at('2026-07-08T09:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-08T10:00', TOKYO));
    });

    it('DST 跨ぎの移動（NY 3/7 → 3/9）でも現地時刻 9:00 が維持される', () => {
      const occurrence = makeOccurrence({
        start: at('2026-03-07T09:00', NY),
        end: at('2026-03-07T10:00', NY),
      });
      const range = dayDragPreviewRange(
        { mode: 'move', occurrence },
        dateFromKey('2026-03-09', NY),
        dateFromKey('2026-03-07', NY),
        NY,
      );
      // 3/7 は EST（UTC-5）、3/9 は EDT（UTC-4）だが現地時刻 9:00 が維持される
      expect(getWallClock(range.start, NY)).toMatchObject({ day: 9, hours: 9, minutes: 0 });
      expect(getWallClock(range.end, NY)).toMatchObject({ day: 9, hours: 10, minutes: 0 });
      expect(range.start.toISOString()).toBe('2026-03-09T13:00:00.000Z');
    });

    it('occurrence が null なら Error を投げる', () => {
      expect(() =>
        dayDragPreviewRange(
          { mode: 'move', occurrence: null },
          dateFromKey('2026-07-08', TOKYO),
          dateFromKey('2026-07-10', TOKYO),
          TOKYO,
        ),
      ).toThrow(/オカレンス/);
    });
  });

  describe('resize-end（帯の右端リサイズ）', () => {
    // 7/1〜7/2 の 2 日間の終日イベント（end 排他で 7/3 0:00）
    const occurrence = makeOccurrence({
      start: dateFromKey('2026-07-01', TOKYO),
      end: dateFromKey('2026-07-03', TOKYO),
      allDay: true,
    });

    it('ポインタ日までの日数差だけ終了が伸びる（開始は固定）', () => {
      const range = dayDragPreviewRange(
        { mode: 'resize-end', occurrence },
        dateFromKey('2026-07-04', TOKYO),
        dateFromKey('2026-07-02', TOKYO), // 表示上の最終日からドラッグ開始
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-01', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-05', TOKYO));
    });

    it('開始日より前へ縮めても最低 1 日分の長さを保つ', () => {
      const range = dayDragPreviewRange(
        { mode: 'resize-end', occurrence },
        dateFromKey('2026-06-28', TOKYO),
        dateFromKey('2026-07-02', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-01', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-02', TOKYO));
    });

    it('時間指定の複数日イベントは終了の現地時刻を維持したまま日数が変わる', () => {
      const timed = makeOccurrence({
        start: at('2026-07-01T10:00', TOKYO),
        end: at('2026-07-03T11:00', TOKYO),
      });
      const range = dayDragPreviewRange(
        { mode: 'resize-end', occurrence: timed },
        dateFromKey('2026-07-05', TOKYO),
        dateFromKey('2026-07-03', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(at('2026-07-01T10:00', TOKYO));
      expect(range.end).toEqual(at('2026-07-05T11:00', TOKYO));
    });

    it('occurrence が null なら Error を投げる', () => {
      expect(() =>
        dayDragPreviewRange(
          { mode: 'resize-end', occurrence: null },
          dateFromKey('2026-07-04', TOKYO),
          dateFromKey('2026-07-02', TOKYO),
          TOKYO,
        ),
      ).toThrow(/オカレンス/);
    });
  });

  describe('resize-start（帯の左端リサイズ）', () => {
    const occurrence = makeOccurrence({
      start: dateFromKey('2026-07-01', TOKYO),
      end: dateFromKey('2026-07-03', TOKYO),
      allDay: true,
    });

    it('ポインタ日までの日数差だけ開始がずれる（終了は固定）', () => {
      const range = dayDragPreviewRange(
        { mode: 'resize-start', occurrence },
        dateFromKey('2026-06-29', TOKYO),
        dateFromKey('2026-07-01', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-06-29', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-03', TOKYO));
    });

    it('終了日以降へ縮めても最低 1 日分の長さを保つ', () => {
      const range = dayDragPreviewRange(
        { mode: 'resize-start', occurrence },
        dateFromKey('2026-07-05', TOKYO),
        dateFromKey('2026-07-01', TOKYO),
        TOKYO,
      );
      expect(range.start).toEqual(dateFromKey('2026-07-02', TOKYO));
      expect(range.end).toEqual(dateFromKey('2026-07-03', TOKYO));
    });
  });
});

describe('shortcutForKey', () => {
  it('m / w / d / a がビュー切替に対応する', () => {
    expect(shortcutForKey('m')).toEqual({ type: 'view', view: 'month' });
    expect(shortcutForKey('w')).toEqual({ type: 'view', view: 'week' });
    expect(shortcutForKey('d')).toEqual({ type: 'view', view: 'day' });
    expect(shortcutForKey('a')).toEqual({ type: 'view', view: 'list' });
  });

  it('t が「今日へ移動」に対応する', () => {
    expect(shortcutForKey('t')).toEqual({ type: 'today' });
  });

  it('j と n が「次の期間」に対応する', () => {
    expect(shortcutForKey('j')).toEqual({ type: 'next' });
    expect(shortcutForKey('n')).toEqual({ type: 'next' });
  });

  it('k と p が「前の期間」に対応する', () => {
    expect(shortcutForKey('k')).toEqual({ type: 'prev' });
    expect(shortcutForKey('p')).toEqual({ type: 'prev' });
  });

  it('c が「予定作成」に対応する', () => {
    expect(shortcutForKey('c')).toEqual({ type: 'create' });
  });

  it('大文字でも同じ結果になる（大文字小文字非区別）', () => {
    expect(shortcutForKey('M')).toEqual({ type: 'view', view: 'month' });
    expect(shortcutForKey('T')).toEqual({ type: 'today' });
    expect(shortcutForKey('J')).toEqual({ type: 'next' });
    expect(shortcutForKey('C')).toEqual({ type: 'create' });
  });

  it('修飾キー（ctrl / meta / alt）付きは null を返す', () => {
    expect(shortcutForKey('m', { ctrlKey: true })).toBeNull();
    expect(shortcutForKey('t', { metaKey: true })).toBeNull();
    expect(shortcutForKey('c', { altKey: true })).toBeNull();
    expect(shortcutForKey('w', { ctrlKey: true, metaKey: true, altKey: true })).toBeNull();
  });

  it('修飾キーがすべて false なら通常どおり解釈される', () => {
    expect(shortcutForKey('m', { ctrlKey: false, metaKey: false, altKey: false })).toEqual({
      type: 'view',
      view: 'month',
    });
  });

  it('該当しないキーや空文字は null を返す', () => {
    expect(shortcutForKey('x')).toBeNull();
    expect(shortcutForKey('Escape')).toBeNull();
    expect(shortcutForKey('1')).toBeNull();
    expect(shortcutForKey('')).toBeNull();
  });
});
