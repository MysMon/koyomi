import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../core/types';
import {
  formatDayHeader,
  formatDayTitle,
  formatMonthTitle,
  formatRangeTitle,
  formatTime,
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
    expect(formatRangeTitle(range, 'Asia/Tokyo', 'ja')).toBe('7月5日〜7月11日');
  });

  it('年をまたぐ範囲は両端に年を表示する', () => {
    const range: DateRange = {
      start: new Date('2025-12-28T15:00:00Z'), // 東京 2025-12-29 0:00
      end: new Date('2026-01-04T15:00:00Z'), // 東京 2026-01-05 0:00（排他）
    };
    expect(formatRangeTitle(range, 'Asia/Tokyo', 'ja')).toBe('2025年12月29日〜2026年1月4日');
  });

  it('ja 以外のロケールでも例外なく整形できる', () => {
    const range: DateRange = {
      start: new Date('2026-07-04T15:00:00Z'),
      end: new Date('2026-07-11T15:00:00Z'),
    };
    expect(() => formatRangeTitle(range, 'Asia/Tokyo', 'en-US')).not.toThrow();
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
