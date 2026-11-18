/**
 * `shiftRRuleForStart`（開始日時の移動に合わせた RRULE の書き換え）のテスト。
 */

import { describe, expect, it } from 'vitest';
import { shiftRRuleForStart } from './rrule-shift';

/** 現地時刻の成分を UTC ミリ秒として組み立てる（`shiftRRuleForStart` の引数の形式）。 */
function wall(iso: string): number {
  return new Date(`${iso}Z`).getTime();
}

describe('shiftRRuleForStart', () => {
  describe('移動がない場合', () => {
    it('開始が変わらなければ RRULE をそのまま返す', () => {
      const rrule = 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20260731T090000Z';
      expect(
        shiftRRuleForStart(rrule, wall('2026-07-01T09:00:00'), wall('2026-07-01T09:00:00')),
      ).toBe(rrule);
    });
  });

  describe('UNTIL', () => {
    it('日時形式の UNTIL を開始と同じ現地時刻差だけ移動する', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;UNTIL=20260705T090000Z',
          wall('2026-07-01T09:00:00'),
          wall('2026-07-01T10:00:00'),
        ),
      ).toBe('FREQ=DAILY;UNTIL=20260705T100000Z');
    });

    it('開始を前へ動かすと UNTIL も前へ動く（日付の繰り下がりを含む）', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;UNTIL=20260705T003000Z',
          wall('2026-07-01T00:30:00'),
          wall('2026-06-30T23:30:00'),
        ),
      ).toBe('FREQ=DAILY;UNTIL=20260704T233000Z');
    });

    it('Z のない日時形式は Z なしのまま移動する', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;UNTIL=20260705T090000',
          wall('2026-07-01T09:00:00'),
          wall('2026-07-02T09:30:00'),
        ),
      ).toBe('FREQ=DAILY;UNTIL=20260706T093000');
    });

    it('日付のみの UNTIL は開始日の移動日数だけ移動する', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;UNTIL=20260705',
          wall('2026-07-01T00:00:00'),
          wall('2026-07-03T00:00:00'),
        ),
      ).toBe('FREQ=DAILY;UNTIL=20260707');
    });

    it('日付のみの UNTIL は同じ日の中の時刻変更では変わらない', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;UNTIL=20260705',
          wall('2026-07-01T09:00:00'),
          wall('2026-07-01T15:00:00'),
        ),
      ).toBe('FREQ=DAILY;UNTIL=20260705');
    });

    it('COUNT で終わるルールは変わらない', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=DAILY;COUNT=5',
          wall('2026-07-01T09:00:00'),
          wall('2026-07-02T10:00:00'),
        ),
      ).toBe('FREQ=DAILY;COUNT=5');
    });
  });

  describe('BYDAY（曜日の並び）', () => {
    it('毎週の BYDAY を開始の曜日の移動に合わせてずらす', () => {
      // 水曜 → 金曜（+2 日）
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;BYDAY=WE',
          wall('2026-07-08T09:00:00'),
          wall('2026-07-10T09:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=FR');
    });

    it('複数の曜日は全体を同じ日数だけずらし、月曜始まりの順に並べる', () => {
      // 月・水 を +5 日（月 → 土、水 → 月）
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;BYDAY=MO,WE',
          wall('2026-07-06T09:00:00'),
          wall('2026-07-11T09:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=MO,SA');
    });

    it('前へ動かす場合も曜日をずらす（日曜 → 土曜）', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU',
          wall('2026-07-05T09:00:00'),
          wall('2026-07-04T09:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA');
    });

    it('7 日の倍数の移動では BYDAY を変えない', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;BYDAY=MO,WE',
          wall('2026-07-06T09:00:00'),
          wall('2026-07-13T09:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    });

    it('同じ日の中の時刻変更では BYDAY を変えない', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;BYDAY=WE',
          wall('2026-07-08T09:00:00'),
          wall('2026-07-08T23:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=WE');
    });

    it('BYSETPOS と組み合わせた BYDAY は変えない', () => {
      const rrule = 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1';
      expect(
        shiftRRuleForStart(rrule, wall('2026-07-31T09:00:00'), wall('2026-08-01T09:00:00')),
      ).toBe(rrule);
    });

    it('小文字で書かれた RRULE も書き換える', () => {
      expect(
        shiftRRuleForStart(
          'freq=weekly;byday=we',
          wall('2026-07-08T09:00:00'),
          wall('2026-07-09T09:00:00'),
        ),
      ).toBe('freq=weekly;byday=TH');
    });

    it("'RRULE:' プレフィックスを保つ", () => {
      expect(
        shiftRRuleForStart(
          'RRULE:FREQ=WEEKLY;BYDAY=WE',
          wall('2026-07-08T09:00:00'),
          wall('2026-07-09T09:00:00'),
        ),
      ).toBe('RRULE:FREQ=WEEKLY;BYDAY=TH');
    });
  });

  describe('BYDAY（第 N 曜日）', () => {
    it('開始が表す第 N 曜日を移動先の第 N 曜日に書き換える', () => {
      // 2026-07-14 は第 2 火曜、2026-07-23 は第 4 木曜
      expect(
        shiftRRuleForStart(
          'FREQ=MONTHLY;BYDAY=2TU',
          wall('2026-07-14T09:00:00'),
          wall('2026-07-23T09:00:00'),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=4TH');
    });

    it('最終曜日（-1）は移動先も月の最終週なら最終曜日のままにする', () => {
      // 2026-07-31 は最終金曜、2026-07-30 は最終木曜
      expect(
        shiftRRuleForStart(
          'FREQ=MONTHLY;BYDAY=-1FR',
          wall('2026-07-31T09:00:00'),
          wall('2026-07-30T09:00:00'),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=-1TH');
    });

    it('最終曜日（-1）から月の途中へ動かすと第 N 曜日になる', () => {
      // 2026-07-31（最終金曜）→ 2026-07-15（第 3 水曜）
      expect(
        shiftRRuleForStart(
          'FREQ=MONTHLY;BYDAY=-1FR',
          wall('2026-07-31T09:00:00'),
          wall('2026-07-15T09:00:00'),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=3WE');
    });

    it('移動先が第 5 曜日になる場合は最終曜日（-1）にする', () => {
      // 2026-07-14（第 2 火曜）→ 2026-07-29（第 5 水曜 = 最終水曜）
      expect(
        shiftRRuleForStart(
          'FREQ=MONTHLY;BYDAY=2TU',
          wall('2026-07-14T09:00:00'),
          wall('2026-07-29T09:00:00'),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=-1WE');
    });

    it('開始と一致しない第 N 曜日の指定は変えない', () => {
      // 開始は第 2 火曜だがルールは第 1 月曜
      const rrule = 'FREQ=MONTHLY;BYDAY=1MO';
      expect(
        shiftRRuleForStart(rrule, wall('2026-07-14T09:00:00'), wall('2026-07-15T09:00:00')),
      ).toBe(rrule);
    });
  });

  describe('BYMONTHDAY / BYMONTH', () => {
    it('開始の日と一致する BYMONTHDAY を移動先の日に書き換える', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=MONTHLY;BYMONTHDAY=15',
          wall('2026-07-15T09:00:00'),
          wall('2026-07-17T09:00:00'),
        ),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=17');
    });

    it('開始の日と一致しない BYMONTHDAY は変えない', () => {
      const rrule = 'FREQ=MONTHLY;BYMONTHDAY=1';
      expect(
        shiftRRuleForStart(rrule, wall('2026-07-15T09:00:00'), wall('2026-07-17T09:00:00')),
      ).toBe(rrule);
    });

    it('複数値・負の値の BYMONTHDAY は変えない', () => {
      const multiple = 'FREQ=MONTHLY;BYMONTHDAY=1,15';
      const negative = 'FREQ=MONTHLY;BYMONTHDAY=-1';
      expect(
        shiftRRuleForStart(multiple, wall('2026-07-15T09:00:00'), wall('2026-07-17T09:00:00')),
      ).toBe(multiple);
      expect(
        shiftRRuleForStart(negative, wall('2026-07-31T09:00:00'), wall('2026-07-30T09:00:00')),
      ).toBe(negative);
    });

    it('毎年のルールは開始と一致する BYMONTH と BYMONTHDAY の両方を書き換える', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=31',
          wall('2026-07-31T09:00:00'),
          wall('2026-08-02T09:00:00'),
        ),
      ).toBe('FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=2');
    });

    it('毎年の第 N 曜日のルールは BYMONTH と BYDAY を書き換える', () => {
      // 2026-05-10（5 月第 2 日曜）→ 2026-06-01（6 月第 1 月曜）
      expect(
        shiftRRuleForStart(
          'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU',
          wall('2026-05-10T09:00:00'),
          wall('2026-06-01T09:00:00'),
        ),
      ).toBe('FREQ=YEARLY;BYMONTH=6;BYDAY=1MO');
    });
  });

  describe('対象外のルール', () => {
    it('毎日のルールの BYDAY（平日のみ等）は変えない', () => {
      const rrule = 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR';
      expect(
        shiftRRuleForStart(rrule, wall('2026-07-06T09:00:00'), wall('2026-07-07T09:00:00')),
      ).toBe(rrule);
    });

    it('BY 系の指定がないルールは UNTIL 以外を変えない', () => {
      expect(
        shiftRRuleForStart(
          'FREQ=WEEKLY;INTERVAL=2',
          wall('2026-07-06T09:00:00'),
          wall('2026-07-08T09:00:00'),
        ),
      ).toBe('FREQ=WEEKLY;INTERVAL=2');
    });
  });
});
