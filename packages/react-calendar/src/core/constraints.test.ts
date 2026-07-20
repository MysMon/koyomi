/**
 * constraints.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * DST の検証は 'America/New_York'（DST は 2026-03-08 に開始）を明示して行う。
 */
import { describe, expect, it } from 'vitest';
import {
  hasBlockingOverlap,
  isDragCandidateValid,
  isRangeWithinBusinessHours,
  type OverlapBlocker,
  occurrenceBlocksOverlap,
  resolveConstraintRules,
} from './constraints';
import type { BusinessHoursRule, CalendarEvent, DateRange } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

/** テスト用の最小限の CalendarEvent を作る。 */
function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'e1', title: '予定', start: '2026-07-15T10:00', ...overrides };
}

function range(startIso: string, endIso: string): DateRange {
  return { start: new Date(startIso), end: new Date(endIso) };
}

describe('occurrenceBlocksOverlap', () => {
  it('event.overlap が指定されていればそれを優先する（false）', () => {
    expect(occurrenceBlocksOverlap(makeEvent({ overlap: false }), true)).toBe(true);
  });

  it('event.overlap が指定されていればそれを優先する（true）', () => {
    expect(occurrenceBlocksOverlap(makeEvent({ overlap: true }), false)).toBe(false);
  });

  it('event.overlap 未指定時は options.eventOverlap に従う（false → 拒否）', () => {
    expect(occurrenceBlocksOverlap(makeEvent(), false)).toBe(true);
  });

  it('event.overlap 未指定時は options.eventOverlap に従う（true → 許可）', () => {
    expect(occurrenceBlocksOverlap(makeEvent(), true)).toBe(false);
  });
});

describe('hasBlockingOverlap', () => {
  const blockerA: OverlapBlocker = {
    key: 'a',
    start: new Date('2026-07-15T10:00:00+09:00'),
    end: new Date('2026-07-15T11:00:00+09:00'),
    blocksOverlap: false,
  };
  const blockerB: OverlapBlocker = {
    key: 'b',
    start: new Date('2026-07-15T13:00:00+09:00'),
    end: new Date('2026-07-15T14:00:00+09:00'),
    blocksOverlap: true,
  };

  it('端点が接触するだけ（end === start）は重なりとみなさない', () => {
    const candidate = range('2026-07-15T09:00:00+09:00', '2026-07-15T10:00:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [blockerA], false)).toBe(false);
  });

  it('excludeKey に一致する blocker は判定から除外される', () => {
    const candidate = range('2026-07-15T10:30:00+09:00', '2026-07-15T11:30:00+09:00');
    // blockerA と重なるが excludeKey で除外されるため false
    expect(hasBlockingOverlap(candidate, 'a', [blockerA], true)).toBe(false);
  });

  it('動かす側が blocksOverlap=true の場合、重ねられる側の設定に関わらず全オカレンスが blocker になる', () => {
    // blockerA.blocksOverlap は false だが、動かす側が true なら拒否される
    const candidate = range('2026-07-15T10:30:00+09:00', '2026-07-15T10:45:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [blockerA], true)).toBe(true);
  });

  it('動かす側が blocksOverlap=false の場合、重ねられる側も blocksOverlap=false なら重ねられる', () => {
    const candidate = range('2026-07-15T10:30:00+09:00', '2026-07-15T10:45:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [blockerA], false)).toBe(false);
  });

  it('動かす側が blocksOverlap=false でも、重ねられる側が blocksOverlap=true なら拒否される', () => {
    const candidate = range('2026-07-15T13:30:00+09:00', '2026-07-15T13:45:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [blockerB], false)).toBe(true);
  });

  it('複数 blocker のうち 1 件でも重なりを拒否すれば true になる', () => {
    const candidate = range('2026-07-15T10:30:00+09:00', '2026-07-15T13:30:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [blockerA, blockerB], false)).toBe(true);
  });

  it('blockers が空なら常に false', () => {
    const candidate = range('2026-07-15T10:30:00+09:00', '2026-07-15T11:30:00+09:00');
    expect(hasBlockingOverlap(candidate, null, [], true)).toBe(false);
  });
});

describe('isRangeWithinBusinessHours', () => {
  const weekdayRule: BusinessHoursRule = {
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '18:00',
  };

  it('rules が空配列なら常に false', () => {
    const candidate = range('2026-07-15T10:00:00+09:00', '2026-07-15T11:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [], TOKYO)).toBe(false);
  });

  it('単日で営業時間内に完全に収まっていれば true', () => {
    // 2026-07-15 は水曜
    const candidate = range('2026-07-15T10:00:00+09:00', '2026-07-15T11:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], TOKYO)).toBe(true);
  });

  it('境界ちょうど（startTime〜endTime）は内包とみなす', () => {
    const candidate = range('2026-07-15T09:00:00+09:00', '2026-07-15T18:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], TOKYO)).toBe(true);
  });

  it('営業時間の終了を 1 分でも超えると false', () => {
    const candidate = range('2026-07-15T17:30:00+09:00', '2026-07-15T18:01:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], TOKYO)).toBe(false);
  });

  it('対象曜日にルールがなければ false（土曜日）', () => {
    // 2026-07-18 は土曜
    const candidate = range('2026-07-18T10:00:00+09:00', '2026-07-18T11:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], TOKYO)).toBe(false);
  });

  it('複数日にまたがり、各日とも営業時間の全日カバーが必要なため一部だけ外れると false', () => {
    // 2026-07-15 09:00 〜 2026-07-16 12:00（2 日にまたがる）。
    // 1 日目は 09:00〜24:00 を占有するが、ルールは 18:00 までのため一部が外れる
    const candidate = range('2026-07-15T09:00:00+09:00', '2026-07-16T12:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], TOKYO)).toBe(false);
  });

  it("endTime '23:59' のルールでは、日をまたぐ範囲の初日の最後の 1 分をカバーできず false になる", () => {
    // 日をまたぐ候補区間の初日は必ず日境界（24:00 相当）まで達するため、
    // 23:59 までのルールでは 23:59〜24:00 の 1 分が外れる
    const almostAllDayRule: BusinessHoursRule = {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '00:00',
      endTime: '23:59',
    };
    const candidate = range('2026-07-15T09:00:00+09:00', '2026-07-16T12:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [almostAllDayRule], TOKYO)).toBe(false);
  });

  it("endTime '24:00'（日の終端）のルールは、その日の 24:00 ちょうどまでを内包する", () => {
    // 2026-07-15 は水曜。20:00〜翌 0:00 の候補は 18:00〜24:00 のルールに収まる
    const eveningRule: BusinessHoursRule = {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '18:00',
      endTime: '24:00',
    };
    const candidate = range('2026-07-15T20:00:00+09:00', '2026-07-16T00:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [eveningRule], TOKYO)).toBe(true);
  });

  it('全曜日 00:00〜24:00 のルールなら、複数日にまたがる範囲も true になる', () => {
    const fullDayRule: BusinessHoursRule = {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '00:00',
      endTime: '24:00',
    };
    const candidate = range('2026-07-15T09:00:00+09:00', '2026-07-16T12:00:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, [fullDayRule], TOKYO)).toBe(true);
  });

  it('日をまたぐ営業時間を 2 件（22:00〜24:00 と翌曜日 00:00〜02:00）に分ければ、深夜の日またぎ範囲が true になる', () => {
    // 2026-07-15 は水曜（3）、翌 07-16 は木曜（4）
    const nightRules: readonly BusinessHoursRule[] = [
      { daysOfWeek: [3], startTime: '22:00', endTime: '24:00' },
      { daysOfWeek: [4], startTime: '00:00', endTime: '02:00' },
    ];
    const candidate = range('2026-07-15T22:30:00+09:00', '2026-07-16T01:30:00+09:00');
    expect(isRangeWithinBusinessHours(candidate, nightRules, TOKYO)).toBe(true);
  });

  it('DST 切替日（America/New_York, 2026-03-08 は 2:00→3:00 で 23 時間しかない日）でも現地時刻基準で正しく判定する', () => {
    const dstRule: BusinessHoursRule = {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '08:00',
      endTime: '18:00',
    };
    const candidate = range('2026-03-08T08:00:00-04:00', '2026-03-08T17:00:00-04:00');
    expect(isRangeWithinBusinessHours(candidate, [dstRule], NY)).toBe(true);
  });

  it('DST 切替日でも weekday 判定が短い日に影響されない（2026-03-08 は日曜）', () => {
    const weekdayRule: BusinessHoursRule = {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '18:00',
    };
    const candidate = range('2026-03-08T09:00:00-04:00', '2026-03-08T10:00:00-04:00');
    expect(isRangeWithinBusinessHours(candidate, [weekdayRule], NY)).toBe(false);
  });
});

describe('resolveConstraintRules', () => {
  const businessHours: readonly BusinessHoursRule[] = [
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
  ];

  it('未指定（undefined）なら null', () => {
    expect(resolveConstraintRules(undefined, businessHours)).toBeNull();
  });

  it('null なら null', () => {
    expect(resolveConstraintRules(null, businessHours)).toBeNull();
  });

  it("'businessHours' 指定時は options.businessHours を解決する", () => {
    expect(resolveConstraintRules('businessHours', businessHours)).toBe(businessHours);
  });

  it('配列指定時はそのまま返す（businessHours とは独立）', () => {
    const custom: readonly BusinessHoursRule[] = [
      { daysOfWeek: [0, 6], startTime: '10:00', endTime: '12:00' },
    ];
    expect(resolveConstraintRules(custom, businessHours)).toBe(custom);
  });
});

describe('isDragCandidateValid', () => {
  const businessRule: BusinessHoursRule = {
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '18:00',
  };
  const blocker: OverlapBlocker = {
    key: 'existing',
    start: new Date('2026-07-15T10:00:00+09:00'),
    end: new Date('2026-07-15T11:00:00+09:00'),
    blocksOverlap: true,
  };

  it('重なりが blocker に拒否される場合、constraint の判定より先に false になる', () => {
    // 営業時間内だが、blocker と重なる
    const result = isDragCandidateValid({
      range: range('2026-07-15T10:30:00+09:00', '2026-07-15T10:45:00+09:00'),
      allDay: false,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [blocker],
      constraintRules: null,
      timeZone: TOKYO,
    });
    expect(result).toBe(false);
  });

  it('重なりはなく constraint のみ違反する場合は false', () => {
    const result = isDragCandidateValid({
      range: range('2026-07-15T19:00:00+09:00', '2026-07-15T20:00:00+09:00'),
      allDay: false,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [],
      constraintRules: [businessRule],
      timeZone: TOKYO,
    });
    expect(result).toBe(false);
  });

  it('終日イベントには constraint が適用されない（重なりがなければ true）', () => {
    const result = isDragCandidateValid({
      range: range('2026-07-18T00:00:00+09:00', '2026-07-19T00:00:00+09:00'),
      allDay: true,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [],
      constraintRules: [businessRule],
      timeZone: TOKYO,
    });
    expect(result).toBe(true);
  });

  it('重なりなし・constraint なしなら true', () => {
    const result = isDragCandidateValid({
      range: range('2026-07-15T12:00:00+09:00', '2026-07-15T13:00:00+09:00'),
      allDay: false,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [blocker],
      constraintRules: null,
      timeZone: TOKYO,
    });
    expect(result).toBe(true);
  });

  it('複数日にまたがる時間指定の候補も、00:00〜24:00 のルールなら constraint を満たし true になる', () => {
    const fullDayRule: BusinessHoursRule = {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '00:00',
      endTime: '24:00',
    };
    const result = isDragCandidateValid({
      range: range('2026-07-15T09:00:00+09:00', '2026-07-17T12:00:00+09:00'),
      allDay: false,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [],
      constraintRules: [fullDayRule],
      timeZone: TOKYO,
    });
    expect(result).toBe(true);
  });

  it('重なりなし・営業時間内なら true（両方 OK）', () => {
    const result = isDragCandidateValid({
      range: range('2026-07-15T12:00:00+09:00', '2026-07-15T13:00:00+09:00'),
      allDay: false,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [blocker],
      constraintRules: [businessRule],
      timeZone: TOKYO,
    });
    expect(result).toBe(true);
  });

  it('blockers が空・constraintRules が null なら常に true（既定値と同じ挙動）', () => {
    const result = isDragCandidateValid({
      range: range('2026-07-15T00:00:00+09:00', '2026-07-16T00:00:00+09:00'),
      allDay: true,
      excludeKey: null,
      moverBlocksOverlap: false,
      blockers: [],
      constraintRules: null,
      timeZone: TOKYO,
    });
    expect(result).toBe(true);
  });
});
