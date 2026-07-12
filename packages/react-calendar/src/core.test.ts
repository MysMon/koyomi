/**
 * `./core`（React 非依存の単体エントリ）の検証。
 *
 * 1. import グラフ検証: `src/core.ts` から静的 import を再帰的に辿り、
 *    どの依存先にも 'react' / 'react-dom' や `src/react/` 配下のモジュールが
 *    現れないことを機械的に確認する。
 * 2. シンボル検証: 主要な公開 API（値・型）が `./core` から import できることを
 *    コンパイル時（`pnpm typecheck`）・実行時の両方で確認する。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addDaysInZone,
  addMinutesInZone,
  addMonthsInZone,
  applyPatch,
  buildListViewModel,
  buildMonthViewModel,
  buildMultiMonthViewModel,
  buildResourceViewModel,
  buildTimeGridViewModel,
  buildTimelineViewModel,
  buildYearViewModel,
  type CalendarApi,
  countOccurrencesBefore,
  createCalendar,
  createEventIn,
  dateFromKey,
  dateKeyInZone,
  deleteEventIn,
  deleteEventInWithChanges,
  type EventChangeEntry,
  eachDayInRange,
  expandEvents,
  expandRecurrence,
  formatSlotLabel,
  fromWallClock,
  getLocalTimeZone,
  getWallClock,
  isValidTimeZone,
  monthGridRange,
  moveOccurrenceIn,
  moveOccurrenceInWithChanges,
  navigateDate,
  normalizeRRuleString,
  occurrenceKey,
  parseDateValue,
  parseTimeOfDay,
  previousOccurrenceStart,
  rangesOverlap,
  resolveOccurrence,
  snapToInterval,
  startOfDayInZone,
  startOfMonthInZone,
  startOfWeekInZone,
  startOfYearInZone,
  truncateRRule,
  updateEventIn,
  updateEventInWithChanges,
  visibleRangeFor,
} from './core';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** テキストから静的 import / re-export の指定子（'react' 等）を抽出する。 */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // `import ... from '...'` / `export ... from '...'` / `import('...')` を拾う。
  const pattern = /(?:from\s+|import\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** 相対 import 指定子をファイルパスに解決する（拡張子省略・index 省略に対応）。 */
function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf-8');
      return candidate;
    } catch {
      // 次の候補を試す
    }
  }
  throw new Error(`import 指定子を解決できません: ${specifier}（起点: ${fromFile}）`);
}

describe('core エントリ (src/core.ts)', () => {
  it('import グラフのどこにも react / react-dom / src/react 配下が現れない', () => {
    const entry = join(srcDir, 'core.ts');
    const visited = new Set<string>();
    const externalSpecifiers = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || visited.has(file)) {
        continue;
      }
      visited.add(file);

      const source = readFileSync(file, 'utf-8');
      for (const specifier of extractSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const resolved = resolveRelative(file, specifier);
          expect(resolved.replaceAll('\\', '/')).not.toMatch(/\/src\/react\//);
          queue.push(resolved);
        } else {
          externalSpecifiers.add(specifier);
        }
      }
    }

    expect(visited.size).toBeGreaterThan(1);
    for (const specifier of externalSpecifiers) {
      expect(specifier).not.toBe('react');
      expect(specifier).not.toBe('react-dom');
      expect(specifier).not.toMatch(/^react(-dom)?\//);
    }
  });

  it('カレンダーエンジン・型が import できる', () => {
    expect(typeof createCalendar).toBe('function');
    const calendar: CalendarApi = createCalendar({ timeZone: 'Asia/Tokyo' });
    expect(calendar.getState().timeZone).toBe('Asia/Tokyo');
    const change: EventChangeEntry | undefined = undefined;
    expect(change).toBeUndefined();
  });

  it('日付範囲・イベント展開・繰り返しユーティリティが import できる', () => {
    for (const fn of [
      addMonthsInZone,
      eachDayInRange,
      monthGridRange,
      navigateDate,
      rangesOverlap,
      startOfMonthInZone,
      startOfWeekInZone,
      startOfYearInZone,
      visibleRangeFor,
      expandEvents,
      occurrenceKey,
      resolveOccurrence,
      snapToInterval,
      applyPatch,
      createEventIn,
      deleteEventIn,
      deleteEventInWithChanges,
      moveOccurrenceIn,
      moveOccurrenceInWithChanges,
      updateEventIn,
      updateEventInWithChanges,
      countOccurrencesBefore,
      expandRecurrence,
      normalizeRRuleString,
      previousOccurrenceStart,
      truncateRRule,
      addDaysInZone,
      addMinutesInZone,
      dateFromKey,
      dateKeyInZone,
      formatSlotLabel,
      fromWallClock,
      getLocalTimeZone,
      getWallClock,
      isValidTimeZone,
      parseDateValue,
      parseTimeOfDay,
      startOfDayInZone,
      buildListViewModel,
      buildMonthViewModel,
      buildMultiMonthViewModel,
      buildResourceViewModel,
      buildTimeGridViewModel,
      buildTimelineViewModel,
      buildYearViewModel,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('React コンポーネント・フックは再エクスポートされない', async () => {
    const coreEntry: Record<string, unknown> = await import('./core');

    for (const reactOnlySymbol of [
      'useCalendar',
      'useCalendarShortcuts',
      'useDayDrag',
      'useTimeGridDrag',
      'useResourceGridDrag',
      'useTimelineDrag',
      'useExternalDrag',
      'useVirtualizer',
      'CalendarProvider',
      'CalendarView',
      'MonthView',
      'TimeGridView',
      'Toolbar',
    ]) {
      expect(coreEntry[reactOnlySymbol]).toBeUndefined();
    }
  });

  it('createCalendar は動的 import 経由でも同じ挙動で利用できる', async () => {
    const { createCalendar: createCalendarFromCoreEntry } = await import('./core');
    const calendar = createCalendarFromCoreEntry({ timeZone: 'Asia/Tokyo' });
    calendar.setView('week');
    expect(calendar.getState().view).toBe('week');
  });
});

describe('index エントリ (src/index.ts) の主要なユーティリティ export', () => {
  it('isoWeekNumberInZone と parseTimeOfDay が公開エントリから export されている', async () => {
    const indexModule = await import('./index');
    expect(typeof indexModule.isoWeekNumberInZone).toBe('function');
    expect(typeof indexModule.parseTimeOfDay).toBe('function');
  });
});
