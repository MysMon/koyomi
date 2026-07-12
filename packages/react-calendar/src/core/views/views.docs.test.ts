/**
 * views-core ドメインの仕様由来テスト。
 *
 * このファイルは docs/views.md の記述のみから導出したテストであり、
 * 実装（*.test.* 以外のソースファイル）を参照せずに書かれている。
 * 既存の *.test.ts は「その仕様がすでにテストされているか」の照合のためだけに読み、
 * 期待値の根拠には使っていない。各テストの先頭コメントに出典（見出し・該当記述の要約または引用）を付す。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { describe, expect, it } from 'vitest';
import { createCalendar } from '../calendar';
import { parseDateValue } from '../timezone';
import type { CalendarEvent, EventOccurrence, TimeZoneId } from '../types';
import { buildMonthViewModel } from './month-view';
import { buildTimeGridViewModel } from './time-grid-view';
import { buildYearViewModel } from './year-view';

const TOKYO: TimeZoneId = 'Asia/Tokyo';

/** 東京時刻の `'YYYY-MM-DDTHH:mm'` から絶対時刻を作るテストヘルパ。 */
function at(isoLocal: string, timeZone: TimeZoneId = TOKYO): Date {
  return parseDateValue(isoLocal, timeZone, false);
}

/** テスト用のオカレンス（EventOccurrence）を組み立てるヘルパ。 */
function makeOccurrence(id: string, start: Date, end: Date, allDay = false): EventOccurrence {
  const event: CalendarEvent = { id, title: `イベント ${id}`, start, end, allDay };
  return {
    key: `${id}@${start.toISOString()}`,
    eventId: id,
    event,
    start,
    end,
    allDay,
    isRecurring: false,
    originalStart: start,
  };
}

describe('月ビュー: dayMaxEvents のちょうど境界', () => {
  it('dayMaxEvents ちょうどの件数（超過なし）では、どのセグメントも hidden にならず overflowCount は 0 になる', () => {
    // 出典: docs/views.md「月ビュー（month）」節:
    // 「dayMaxEvents（既定 4）を超える分はその日の「+N 件」ボタンに集約されます。」
    // → 「超える」場合のみあふれが発生するので、ちょうど dayMaxEvents 件（超過なし）では
    //   あふれが起きないはずである（超過側は既存の month-view.test.ts で検証済み）。
    const a = makeOccurrence('a', at('2026-07-07T09:00'), at('2026-07-07T10:00'));
    const b = makeOccurrence('b', at('2026-07-07T10:00'), at('2026-07-07T11:00'));
    const vm = buildMonthViewModel({
      currentDate: at('2026-07-07T00:00'),
      timeZone: TOKYO,
      occurrences: [a, b],
      weekStartsOn: 0,
      dayMaxEvents: 2,
      now: at('2026-07-07T12:00'),
    });
    const week = vm.weeks[1];
    expect(week?.segments).toHaveLength(2);
    expect(week?.segments.every((segment) => segment.hidden === false)).toBe(true);
    expect(week?.laneCount).toBe(2);
    expect(week?.days.every((day) => day.overflowCount === 0)).toBe(true);
  });
});

describe('hiddenWeekdays: 7 曜日すべてを指定した場合の無効化', () => {
  it('月ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、全曜日が表示される', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節:
    // 「7 曜日すべてを指定した場合は無効な設定として無視されます（すべて表示のまま）。」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'month',
      hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'month') throw new Error('unreachable');
    expect(vm.weekdays).toHaveLength(7);
    for (const week of vm.weeks) {
      expect(week.days).toHaveLength(7);
    }
  });

  it('週ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、7 日とも表示される', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節（月ビューと同じ規則が明記されている）:
    // 「7 曜日すべてを指定した場合は無効な設定として無視されます（すべて表示のまま）。」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'week',
      hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'timeGrid') throw new Error('unreachable');
    expect(vm.days).toHaveLength(7);
  });

  it('複数月ビューで 7 曜日すべてを hiddenWeekdays に指定すると無効な設定として無視され、各月グリッドが全曜日表示になる', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節:
    // 「複数月ビューは月ビューと同じく列が除外される」＋「7 曜日すべてを指定した場合は無効な設定として
    // 無視されます（すべて表示のまま）」の組み合わせから、複数月ビューでも同じ無効化が働くはずである。
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'multiMonth',
      hiddenWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'multiMonth') throw new Error('unreachable');
    expect(vm.weekdays).toHaveLength(7);
    for (const month of vm.months) {
      for (const week of month.weeks) {
        expect(week.days).toHaveLength(7);
      }
    }
  });
});

describe('hiddenWeekdays: 年・リソース・タイムラインビューは無視する', () => {
  it('年ビューは hiddenWeekdays を無視し、ミニ月グリッドは常に 7 列のままになる', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節:
    // 「年ビューも hiddenWeekdays を無視する（ミニ月グリッドは常に 7 列のまま）」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'year',
      hiddenWeekdays: [0, 6],
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'year') throw new Error('unreachable');
    expect(vm.weekdays).toHaveLength(7);
    for (const month of vm.months) {
      for (const week of month.weeks) {
        expect(week).toHaveLength(7);
      }
    }
  });

  it('リソースビューは hiddenWeekdays を無視し、非表示曜日へ goTo した日もそのまま表示日になる', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節:
    // 「リソースビューも hiddenWeekdays を無視する（日ビューと同じく表示日は 1 日固定）」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'resource',
      hiddenWeekdays: [0, 6],
    });
    // 2026-07-04 は土曜（非表示曜日に指定されている）
    calendar.goTo(at('2026-07-04T00:00'));
    const vm = calendar.getViewModel();
    if (vm.type !== 'resource') throw new Error('unreachable');
    expect(vm.dateKey).toBe('2026-07-04');
  });

  it('タイムラインビューは hiddenWeekdays を無視し、常に timelineDays 日の連続した並びになる', () => {
    // 出典: docs/views.md「週末などの曜日を隠す（hiddenWeekdays）」節:
    // 「タイムラインビューも hiddenWeekdays を無視する（比例スケールの歪みを避けるため。
    // 常に timelineDays 日の連続した並びになる）」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-15T10:00'),
      initialDate: at('2026-07-15T10:00'),
      initialView: 'timeline',
      hiddenWeekdays: [0, 6],
      timelineDays: 3,
    });
    // 2026-07-04(土)〜2026-07-06(月) を表示日にする。土日が非表示曜日でも欠けずに並ぶ。
    calendar.goTo(at('2026-07-04T00:00'));
    const vm = calendar.getViewModel();
    if (vm.type !== 'timeline') throw new Error('unreachable');
    expect(vm.days.map((day) => day.key)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06']);
  });
});

describe('hiddenWeekdays: リストビューは対象外（本追記分）', () => {
  it('リストビューは hiddenWeekdays を受け取らず、非表示曜日にしか予定が無い日もセクションとして表示される', () => {
    // 出典: docs/views.md「リストビュー（list）」節（本追記分）:
    // 「hiddenWeekdays は対象外です（buildListViewModel / ListView はそもそも
    //  hiddenWeekdays を受け取らないため、非表示曜日にしか予定が無い日もセクションとして
    //  表示されます）。」
    // 2026-07-04 は土曜日（hiddenWeekdays: [0, 6] に含まれる想定の曜日）。
    const occ = makeOccurrence('sat-only', at('2026-07-04T09:00'), at('2026-07-04T10:00'));
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-01T10:00'),
      initialDate: at('2026-07-01T10:00'),
      initialView: 'list',
      listDays: 7,
      hiddenWeekdays: [0, 6],
      events: [
        {
          id: occ.eventId,
          title: occ.event.title,
          start: occ.start,
          end: occ.end,
        },
      ],
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'list') throw new Error('unreachable');
    expect(vm.days.some((day) => day.key === '2026-07-04')).toBe(true);
  });
});

describe('showWeekNumbers: 複数月ビューは対象外（本追記分）', () => {
  it('複数月ビューは showWeekNumbers: true を指定しても各月グリッドの weekNumber が常に null になる', () => {
    // 出典: docs/views.md「週番号（showWeekNumbers）」節（本追記分）:
    // 「複数月ビュー（MultiMonthView）は showWeekNumbers の対象外です。
    //  buildMultiMonthViewModel は showWeekNumbers を受け取らず内部の
    //  buildMonthViewModel 呼び出しにも渡さないため、showWeekNumbers: true を
    //  指定していても各月グリッドの MonthWeek.weekNumber は常に null のままで、
    //  data-koyomi-week-number 属性も出力されません。」
    const calendar = createCalendar({
      timeZone: TOKYO,
      now: () => at('2026-07-07T12:00'),
      initialDate: at('2026-07-07T12:00'),
      initialView: 'multiMonth',
      showWeekNumbers: true,
    });
    const vm = calendar.getViewModel();
    if (vm.type !== 'multiMonth') throw new Error('unreachable');
    for (const month of vm.months) {
      for (const week of month.weeks) {
        expect(week.weekNumber).toBeNull();
      }
    }
  });
});

describe('年ビューの密度ドット: 件数によらず二値表示になる（本追記分）', () => {
  it('1 件の日と 100 件の日で eventCount は異なるが、密度マーカーの有無（data-has-events 相当の判定）はどちらも同じ「表示あり」になる', () => {
    // 出典: docs/views.md「年ビュー（year）」節（本追記分）:
    // 「ドットは「予定が1件以上あるか」の二値表示で、件数が1件でも100件でも見た目は
    //  同じ1個のドットのままです。」
    // コアのビューモデルは eventCount（実数）を返すが、閲覧側の「表示あり/なし」判定
    // （eventCount > 0）は 1 件・100 件のどちらでも同じ結果になることを確認する。
    const oneEventOcc = makeOccurrence('one', at('2026-07-10T09:00'), at('2026-07-10T10:00'));
    const manyOccurrences: EventOccurrence[] = Array.from({ length: 100 }, (_, i) =>
      makeOccurrence(`many-${i}`, at('2026-07-20T09:00'), at('2026-07-20T09:30')),
    );
    const vm = buildYearViewModel({
      currentDate: at('2026-07-01T00:00'),
      timeZone: TOKYO,
      occurrences: [oneEventOcc, ...manyOccurrences],
      weekStartsOn: 0,
      now: at('2026-07-01T12:00'),
    });
    const julyMonth = vm.months.find((month) => month.key === '2026-07');
    const findDay = (key: string) => julyMonth?.weeks.flat().find((day) => day.key === key);

    const oneEventDay = findDay('2026-07-10');
    const manyEventsDay = findDay('2026-07-20');
    expect(oneEventDay?.eventCount).toBe(1);
    expect(manyEventsDay?.eventCount).toBe(100);
    // 「表示あり」判定（eventCount > 0）はどちらも true で同じ扱いになる
    expect((oneEventDay?.eventCount ?? 0) > 0).toBe((manyEventsDay?.eventCount ?? 0) > 0);
  });
});

describe('週番号（showWeekNumbers）: weekStartsOn による週区切りの違いと ISO 週番号の対応', () => {
  it('weekStartsOn: 4（木曜始まり）では 2026-07-01 を含む週が第 26 週になり、日曜始まりでは同じ日付が第 27 週になる', () => {
    // 出典: docs/views.md「週番号（showWeekNumbers）」節:
    // 「顕著なのは weekStartsOn: 4（木曜始まり）で、月曜始まりの ISO 週と区切りが大きくずれるため、
    // 例えば 2026-07-01 は他の週開始曜日では第 27 週の行に入るのに対し、
    // 木曜始まりでは第 26 週の行に入ります。」
    const vmThursday = buildMonthViewModel({
      currentDate: at('2026-07-07T00:00'),
      timeZone: TOKYO,
      occurrences: [],
      weekStartsOn: 4,
      dayMaxEvents: 4,
      now: at('2026-07-07T12:00'),
      showWeekNumbers: true,
    });
    const weekThursday = vmThursday.weeks.find((week) =>
      week.days.some((day) => day.key === '2026-07-01'),
    );
    expect(weekThursday?.weekNumber).toBe(26);

    const vmSunday = buildMonthViewModel({
      currentDate: at('2026-07-07T00:00'),
      timeZone: TOKYO,
      occurrences: [],
      weekStartsOn: 0,
      dayMaxEvents: 4,
      now: at('2026-07-07T12:00'),
      showWeekNumbers: true,
    });
    const weekSunday = vmSunday.weeks.find((week) =>
      week.days.some((day) => day.key === '2026-07-01'),
    );
    expect(weekSunday?.weekNumber).toBe(27);
  });
});

describe('営業時間（businessHours）: スロット境界に整合しない startTime', () => {
  it('startTime が slotMinutes の区切りに合っていない場合、ハイライトは次のスロット境界から始まる', () => {
    // 出典: docs/views.md「営業時間（businessHours）」→「週/日ビュー（TimeGridView）」節:
    // 「startTime / endTime が slotMinutes の区切りに合っていない場合
    // （例: slotMinutes: 30 で startTime: '09:15'）、ハイライトは次のスロット境界（9:30）から始まります。」
    // 2026-07-01 は水曜（daysOfWeek に含まれる）。
    const model = buildTimeGridViewModel({
      currentDate: at('2026-07-01T00:00'),
      viewType: 'day',
      timeZone: TOKYO,
      occurrences: [],
      weekStartsOn: 0,
      slotMinutes: 30,
      now: at('2026-07-01T10:00'),
      businessHours: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:15', endTime: '17:00' }],
    });
    const day = model.days[0];
    const at9 = day?.businessHourSlots.find((slot) => slot.minutes === 540); // 9:00
    const at930 = day?.businessHourSlots.find((slot) => slot.minutes === 570); // 9:30
    expect(at9?.isBusinessHours).toBe(false);
    expect(at930?.isBusinessHours).toBe(true);
  });
});
