import { describe, expect, it, vi } from 'vitest';
import type { DateRange } from '../../core/types';
import {
  formatClockLabel,
  formatClockRangeLabel,
  formatDayHeader,
  formatDayTitle,
  formatMonthTitle,
  formatRangeTitle,
  formatTime,
  formatTimeZoneLabel,
  formatViewTitle,
  formatWeekday,
} from './format';

describe('formatTime', () => {
  it('東京タイムゾーンで H:mm 形式（0 時台は 0:00）になる', () => {
    // 2026-07-15T01:00:00Z は東京では 10:00
    expect(formatTime(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')).toBe('10:00');
    // 2026-07-14T15:00:00Z は東京では 0:00（日付が変わる瞬間）
    expect(formatTime(new Date('2026-07-14T15:00:00Z'), 'Asia/Tokyo', 'ja')).toBe('0:00');
  });

  it('タイムゾーンが異なると同じ絶対時刻でも表示時刻が変わる（東京 vs NY）', () => {
    const instant = new Date('2026-07-15T01:00:00Z');
    expect(formatTime(instant, 'Asia/Tokyo', 'ja')).toBe('10:00');
    // NY は東京より 13 時間遅れ（夏時間中）のため前日 21:00
    expect(formatTime(instant, 'America/New_York', 'ja')).toBe('21:00');
  });
});

describe('formatClockLabel', () => {
  it('1 日の中の分を、実行環境のタイムゾーンに依存せず時刻ラベルにする', () => {
    expect(formatClockLabel(600, 'ja')).toBe('10:00');
    expect(formatClockLabel(0, 'ja')).toBe('0:00');
    expect(formatClockLabel(1439, 'ja')).toBe('23:59');
  });

  it('ロケールの慣習に従う（en-US は 12 時間制）', () => {
    expect(formatClockLabel(600, 'en-US')).toBe('10:00 AM');
  });
});

describe('formatClockRangeLabel', () => {
  it('開始・終了の分を「開始〜終了」の範囲ラベルにする', () => {
    expect(formatClockRangeLabel(600, 660, 'ja')).toBe('10:00〜11:00');
    expect(formatClockRangeLabel(600, 660, 'en-US')).toBe('10:00 AM〜11:00 AM');
  });
});

describe('formatMonthTitle', () => {
  it('ja ロケールで「YYYY年M月」になる', () => {
    expect(formatMonthTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')).toBe(
      '2026年7月',
    );
  });

  it('ja 以外のロケールでも Intl の既定書式で例外なく整形できる', () => {
    expect(() =>
      formatMonthTitle(new Date('2026-07-15T01:00:00Z'), 'America/New_York', 'en-US'),
    ).not.toThrow();
    expect(formatMonthTitle(new Date('2026-07-15T01:00:00Z'), 'America/New_York', 'en-US')).toBe(
      'July 2026',
    );
  });
});

describe('formatDayTitle', () => {
  it('ja ロケールで「YYYY年M月D日(曜)」になる', () => {
    expect(formatDayTitle(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')).toBe(
      '2026年7月15日(水)',
    );
  });

  it('タイムゾーン差で日付が変わる（東京は 7/15、NY は前日 7/14）', () => {
    const instant = new Date('2026-07-15T01:00:00Z');
    expect(formatDayTitle(instant, 'Asia/Tokyo', 'ja')).toBe('2026年7月15日(水)');
    expect(formatDayTitle(instant, 'America/New_York', 'ja')).toBe('2026年7月14日(火)');
  });
});

describe('formatRangeTitle', () => {
  it('同一年内の範囲は「M月D日〜M月D日」になる（end は排他、直前の瞬間の日付を使う）', () => {
    // 2026-07-05 0:00 〜 2026-07-12 0:00（排他）＝ 7/5〜7/11 の週
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'), // 東京 2026-07-05 0:00
      end: new Date('2026-07-11T15:00:00Z'), // 東京 2026-07-12 0:00（排他）
    };
    expect(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '〜')).toBe('7月5日〜7月11日');
  });

  it('年をまたぐ範囲は両端に年を表示する', () => {
    const range: DateRange = {
      start: new Date('2025-12-28T15:00:00Z'), // 東京 2025-12-29 0:00
      end: new Date('2026-01-04T15:00:00Z'), // 東京 2026-01-05 0:00（排他）
    };
    expect(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '〜')).toBe('2025年12月29日〜2026年1月4日');
  });

  it('ja 以外のロケールでも例外なく整形できる', () => {
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'),
      end: new Date('2026-07-11T15:00:00Z'),
    };
    expect(() => formatRangeTitle(range, 'Asia/Tokyo', 'en-US', '–')).not.toThrow();
  });

  it('rangeSeparator を差し替えると区切り記号が変わる（ハードコードされた〜を使わない）', () => {
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'), // 東京 2026-07-05 0:00
      end: new Date('2026-07-11T15:00:00Z'), // 東京 2026-07-12 0:00（排他）
    };
    expect(formatRangeTitle(range, 'Asia/Tokyo', 'ja', '–')).toBe('7月5日–7月11日');
  });
});

describe('formatWeekday', () => {
  it('曜日番号を ja の短縮ラベルに変換する', () => {
    expect(formatWeekday(0, 'ja')).toBe('日');
    expect(formatWeekday(1, 'ja')).toBe('月');
    expect(formatWeekday(2, 'ja')).toBe('火');
    expect(formatWeekday(3, 'ja')).toBe('水');
    expect(formatWeekday(4, 'ja')).toBe('木');
    expect(formatWeekday(5, 'ja')).toBe('金');
    expect(formatWeekday(6, 'ja')).toBe('土');
  });

  it('ja 以外のロケールでも例外なく整形できる', () => {
    expect(() => formatWeekday(0, 'en-US')).not.toThrow();
  });
});

describe('formatTimeZoneLabel', () => {
  it('タイムゾーンを GMT オフセットの短縮ラベルにする', () => {
    const instant = new Date('2026-07-15T01:00:00Z');
    expect(formatTimeZoneLabel(instant, 'Asia/Tokyo', 'ja')).toBe('GMT+9');
    // 夏時間中のニューヨークは GMT-4（DST を反映した時点依存の値になる）
    expect(formatTimeZoneLabel(instant, 'America/New_York', 'ja')).toBe('GMT-4');
  });

  it('冬時間の時点では DST 前のオフセットになる（時点依存の確認）', () => {
    const winter = new Date('2026-01-15T01:00:00Z');
    expect(formatTimeZoneLabel(winter, 'America/New_York', 'ja')).toBe('GMT-5');
  });

  it('UTC は GMT ちょうどのラベルになる', () => {
    const instant = new Date('2026-07-15T01:00:00Z');
    expect(formatTimeZoneLabel(instant, 'UTC', 'ja')).toBe('GMT');
  });

  it('ja 以外のロケールでも例外なく整形できる', () => {
    expect(() =>
      formatTimeZoneLabel(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'en-US'),
    ).not.toThrow();
  });
});

describe('formatDayHeader', () => {
  it('ja ロケールで「D (曜)」になる', () => {
    expect(formatDayHeader(new Date('2026-07-15T01:00:00Z'), 'Asia/Tokyo', 'ja')).toBe('15 (水)');
  });

  it('タイムゾーン差で日付が変わる（東京は 15、NY は前日 14）', () => {
    const instant = new Date('2026-07-15T01:00:00Z');
    expect(formatDayHeader(instant, 'Asia/Tokyo', 'ja')).toBe('15 (水)');
    expect(formatDayHeader(instant, 'America/New_York', 'ja')).toBe('14 (火)');
  });
});

describe('formatViewTitle', () => {
  const currentDate = new Date('2026-07-15T01:00:00Z'); // 東京 2026-07-15 10:00

  it('month は formatMonthTitle と同じ「YYYY年M月」になる（range は無視する）', () => {
    const range: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 2026-07-01 0:00
      end: new Date('2026-07-31T15:00:00Z'), // 東京 2026-08-01 0:00（排他）
    };
    expect(formatViewTitle('month', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月',
    );
  });

  it('day / resource は formatDayTitle と同じ「YYYY年M月D日(曜)」になる（currentDate 基準）', () => {
    const range: DateRange = {
      start: new Date('2026-07-14T15:00:00Z'), // 東京 2026-07-15 0:00
      end: new Date('2026-07-15T15:00:00Z'), // 東京 2026-07-16 0:00（排他）
    };
    expect(formatViewTitle('day', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月15日(水)',
    );
    expect(formatViewTitle('resource', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月15日(水)',
    );
  });

  it('week / list は formatRangeTitle と同じ「M月D日〜M月D日」になる', () => {
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'), // 東京 2026-07-05 0:00
      end: new Date('2026-07-11T15:00:00Z'), // 東京 2026-07-12 0:00（排他）
    };
    expect(formatViewTitle('week', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月5日〜7月11日',
    );
    expect(formatViewTitle('list', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月5日〜7月11日',
    );
  });

  it('timeline: 1 日表示（range が 1 日分）なら日ビューと同じ形式（currentDate 基準）になる', () => {
    const range: DateRange = {
      start: new Date('2026-07-14T15:00:00Z'), // 東京 2026-07-15 0:00
      end: new Date('2026-07-15T15:00:00Z'), // 東京 2026-07-16 0:00（排他）
    };
    expect(formatViewTitle('timeline', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月15日(水)',
    );
  });

  it('timeline: 複数日表示（range が複数日分）なら範囲形式になる', () => {
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'), // 東京 2026-07-05 0:00
      end: new Date('2026-07-11T15:00:00Z'), // 東京 2026-07-12 0:00（排他）
    };
    expect(formatViewTitle('timeline', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '7月5日〜7月11日',
    );
  });

  it('year は formatYearTitle と同じ「YYYY年」になる（range は無視する）', () => {
    const range: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'),
      end: new Date('2026-07-31T15:00:00Z'),
    };
    expect(formatViewTitle('year', currentDate, range, 'Asia/Tokyo', 'ja', '〜')).toBe('2026年');
  });

  it('multiMonth: 表示月数が 1 なら開始月のみ、複数月なら「開始月〜終了月」になる', () => {
    const singleMonth: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 2026-07-01 0:00
      end: new Date('2026-07-31T15:00:00Z'), // 東京 2026-08-01 0:00（排他）
    };
    expect(formatViewTitle('multiMonth', currentDate, singleMonth, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月',
    );

    const threeMonths: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 2026-07-01 0:00
      end: new Date('2026-09-30T15:00:00Z'), // 東京 2026-10-01 0:00（排他、7〜9月の3ヶ月分）
    };
    expect(formatViewTitle('multiMonth', currentDate, threeMonths, 'Asia/Tokyo', 'ja', '〜')).toBe(
      '2026年7月〜2026年9月',
    );
  });

  it('ja 以外のロケールでも例外なく整形できる', () => {
    const range: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'),
      end: new Date('2026-07-31T15:00:00Z'),
    };
    expect(() =>
      formatViewTitle('month', currentDate, range, 'Asia/Tokyo', 'en-US', '–'),
    ).not.toThrow();
  });

  it('rangeSeparator を差し替えると week / list / timeline(複数日) / multiMonth(複数月) のタイトルへ反映される（ハードコードされた〜を使わない）', () => {
    const weekRange: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'), // 東京 2026-07-05 0:00
      end: new Date('2026-07-11T15:00:00Z'), // 東京 2026-07-12 0:00（排他）
    };
    expect(formatViewTitle('week', currentDate, weekRange, 'Asia/Tokyo', 'ja', '–')).toBe(
      '7月5日–7月11日',
    );
    expect(formatViewTitle('list', currentDate, weekRange, 'Asia/Tokyo', 'ja', '–')).toBe(
      '7月5日–7月11日',
    );
    expect(formatViewTitle('timeline', currentDate, weekRange, 'Asia/Tokyo', 'ja', '–')).toBe(
      '7月5日–7月11日',
    );

    const threeMonths: DateRange = {
      start: new Date('2026-06-30T15:00:00Z'), // 東京 2026-07-01 0:00
      end: new Date('2026-09-30T15:00:00Z'), // 東京 2026-10-01 0:00（排他、7〜9月の3ヶ月分）
    };
    expect(formatViewTitle('multiMonth', currentDate, threeMonths, 'Asia/Tokyo', 'ja', '–')).toBe(
      '2026年7月–2026年9月',
    );
  });
});

describe('Intl.DateTimeFormat のキャッシュ', () => {
  // 他の describe ブロックで使われていない locale/timeZone を使い、このブロックの
  // アサーションが他テストの実行順序（＝キャッシュのウォーム状態）に依存しないようにする。
  const CACHE_TEST_LOCALE = 'fr-FR';
  const CACHE_TEST_TZ = 'Europe/Paris';

  // spy の実装は `new` の対象になるため、コンストラクタとして呼べる関数宣言で
  // 元の Intl.DateTimeFormat（spy 適用前に捕捉）へ委譲する。arrow だと new できず失敗する。
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  function createRealDateTimeFormat(
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ): Intl.DateTimeFormat {
    return new OriginalDateTimeFormat(...args);
  }

  it('同じ locale/timeZone/書式種別の組み合わせでは Intl.DateTimeFormat を再生成しない', () => {
    const date = new Date('2026-07-15T01:00:00Z');
    formatTime(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE); // ウォームアップ

    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    formatTime(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE);
    formatTime(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('locale が異なれば別の Intl.DateTimeFormat を生成する', () => {
    const date = new Date('2026-07-15T01:00:00Z');
    formatTime(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE); // ウォームアップ

    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(createRealDateTimeFormat);
    formatTime(date, CACHE_TEST_TZ, 'de-DE');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('書式の種別が異なれば（同じ locale/timeZone でも）別の Intl.DateTimeFormat を生成する', () => {
    const date = new Date('2026-07-15T01:00:00Z');
    formatTime(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE); // ウォームアップ（'time' 種別）

    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(createRealDateTimeFormat);
    formatMonthTitle(date, CACHE_TEST_TZ, CACHE_TEST_LOCALE); // 'month-title' 種別は未キャッシュ
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
