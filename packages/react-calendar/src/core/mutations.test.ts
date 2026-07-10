/**
 * mutations.ts のテスト。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 * マルチタイムゾーンの検証は 'America/New_York' を引数で明示して行う。
 *
 * 基本フィクスチャ（東京）:
 * - master-1: 毎朝 9:00〜10:00 JST（= 00:00〜01:00Z）、FREQ=DAILY;COUNT=10、7/1 起点。
 *   オカレンスは 7/1〜7/10 の各日 00:00Z。
 *
 * America/New_York の 2026 年の DST:
 * - 開始: 2026-03-08 02:00（EST(UTC-5) → EDT(UTC-4)、9:00 は 14:00Z → 13:00Z になる）
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createEventIn,
  deleteEventIn,
  type MutationContext,
  moveOccurrenceIn,
  updateEventIn,
} from './mutations';
import { expandRecurrence } from './recurrence';
import { getWallClock } from './timezone';
import type { CalendarEvent, CalendarEventPatch } from './types';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

/** 決定的な ID 採番（gen-1, gen-2, …）を行うテスト用コンテキストを作る。 */
function makeContext(partial: Partial<MutationContext> = {}): MutationContext {
  let sequence = 0;
  return {
    displayTimeZone: TOKYO,
    defaultEventMinutes: 60,
    generateId: () => {
      sequence += 1;
      return `gen-${sequence}`;
    },
    ...partial,
  };
}

/**
 * exactOptionalPropertyTypes のもとではリテラルで undefined 値のキーを書けないため、
 * Object.assign で「キーが存在し、値が undefined」のパッチを合成する。
 */
function undefinedPatch(...keys: (keyof CalendarEventPatch)[]): CalendarEventPatch {
  const patch: CalendarEventPatch = {};
  for (const key of keys) {
    Object.assign(patch, { [key]: undefined });
  }
  return patch;
}

/** ID でイベントを探す（テスト用。見つからなければ失敗させる）。 */
function findById(events: readonly CalendarEvent[], id: string): CalendarEvent {
  const found = events.find((event) => event.id === id);
  if (found === undefined) {
    throw new Error(`テスト対象のイベントが見つかりません: ${id}`);
  }
  return found;
}

/** Date の配列を ISO 文字列の配列に変換する（アサーションの可読性のため）。 */
function toISO(dates: readonly Date[]): string[] {
  return dates.map((date) => date.toISOString());
}

/** 毎朝 9:00〜10:00 JST・FREQ=DAILY;COUNT=10 のマスターイベント。 */
function makeMaster(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'master-1',
    title: '朝会',
    start: new Date('2026-07-01T00:00:00Z'), // 東京 7/1 9:00
    end: new Date('2026-07-01T01:00:00Z'), // 東京 7/1 10:00
    timeZone: TOKYO,
    rrule: 'FREQ=DAILY;COUNT=10',
    color: '#3b82f6',
    location: '会議室A',
    description: '毎朝の定例',
    editable: true,
    extendedProps: { team: 'dev' },
    ...overrides,
  };
}

/** master-1 の 7/3 のオカレンスを 11:00〜12:00 JST に移動済みのオーバーライド。 */
function makeOverride(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ov-3',
    title: '朝会（変更済み）',
    start: new Date('2026-07-03T02:00:00Z'), // 東京 7/3 11:00
    end: new Date('2026-07-03T03:00:00Z'),
    timeZone: TOKYO,
    recurringEventId: 'master-1',
    originalStart: new Date('2026-07-03T00:00:00Z'), // 本来は東京 7/3 9:00
    ...overrides,
  };
}

/** 7 月全体をカバーする展開範囲。 */
const JULY_RANGE = {
  start: new Date('2026-06-30T00:00:00Z'),
  end: new Date('2026-08-01T00:00:00Z'),
};

describe('applyPatch', () => {
  it('patch に存在するキーの値で上書きし、存在しないキーは変更しない', () => {
    const event = makeMaster();
    const result = applyPatch(event, { title: '新タイトル' });
    expect(result).toEqual(makeMaster({ title: '新タイトル' }));
  });

  it('キーが存在し値が undefined のフィールドは削除する（rrule 解除）', () => {
    const event = makeMaster();
    const result = applyPatch(event, undefinedPatch('rrule', 'location'));
    expect(Object.hasOwn(result, 'rrule')).toBe(false);
    expect(Object.hasOwn(result, 'location')).toBe(false);
    // 他のフィールドは維持される
    expect(result.title).toBe('朝会');
    expect(result.color).toBe('#3b82f6');
  });

  it('exactOptionalPropertyTypes 下でも undefined 値のリテラルを直接書ける（型の保証）', () => {
    // CalendarEventPatch は各フィールドに明示的な `| undefined` を許容するため、
    // Object.assign を経由せずリテラルで削除パッチを書ける
    const event = makeMaster();
    const result = applyPatch(event, { rrule: undefined, location: undefined });
    expect(Object.hasOwn(result, 'rrule')).toBe(false);
    expect(Object.hasOwn(result, 'location')).toBe(false);
  });

  it('必須フィールド（title / start）は undefined を渡しても元の値を維持する', () => {
    const event = makeMaster();
    const result = applyPatch(event, undefinedPatch('title', 'start'));
    expect(result.title).toBe('朝会');
    expect(result.start).toEqual(new Date('2026-07-01T00:00:00Z'));
  });

  it('入力の event と patch を変更しない', () => {
    const event = makeMaster();
    const patch: CalendarEventPatch = { title: '別名' };
    const eventBefore = structuredClone(event);
    const patchBefore = structuredClone(patch);
    applyPatch(event, patch);
    expect(event).toEqual(eventBefore);
    expect(patch).toEqual(patchBefore);
  });

  it('resourceId は他のフィールドと同様にキーが存在し値が undefined なら削除される', () => {
    const event = makeMaster({ resourceId: 'room-1' });
    const result = applyPatch(event, undefinedPatch('resourceId'));
    expect(Object.hasOwn(result, 'resourceId')).toBe(false);
  });

  it('resourceId は patch の値で変更される', () => {
    const event = makeMaster({ resourceId: 'room-1' });
    const result = applyPatch(event, { resourceId: 'room-2' });
    expect(result.resourceId).toBe('room-2');
  });
});

describe('createEventIn', () => {
  it('id 省略時は generateId で採番し、末尾に追加した新しい配列を返す', () => {
    const existing = makeMaster();
    const result = createEventIn(
      [existing],
      { title: '打ち合わせ', start: new Date('2026-07-02T05:00:00Z') },
      makeContext(),
    );
    expect(result.created).toEqual({
      id: 'gen-1',
      title: '打ち合わせ',
      start: new Date('2026-07-02T05:00:00Z'),
    });
    expect(result.events).toEqual([existing, result.created]);
  });

  it('id 指定時はその id をそのまま使う', () => {
    const result = createEventIn(
      [],
      { id: 'my-id', title: '単発', start: new Date('2026-07-01T10:00:00Z') },
      makeContext(),
    );
    expect(result.created.id).toBe('my-id');
    expect(result.events).toHaveLength(1);
  });

  it('既存イベントと重複する id が指定された場合は Error を投げる', () => {
    expect(() =>
      createEventIn(
        [makeMaster()],
        { id: 'master-1', title: '重複', start: new Date('2026-07-01T10:00:00Z') },
        makeContext(),
      ),
    ).toThrow(/重複/);
  });

  it('不正な rrule が指定された場合は Error を投げる', () => {
    expect(() =>
      createEventIn(
        [],
        { title: '不正', start: new Date('2026-07-01T10:00:00Z'), rrule: 'FOO=BAR' },
        makeContext(),
      ),
    ).toThrow(Error);
    expect(() =>
      createEventIn(
        [],
        { title: '不正', start: new Date('2026-07-01T10:00:00Z'), rrule: 'FREQ=BOGUS' },
        makeContext(),
      ),
    ).toThrow(Error);
  });

  it("'RRULE:' プレフィックス付きの正しい rrule は受理される", () => {
    const result = createEventIn(
      [],
      { title: '繰り返し', start: new Date('2026-07-01T10:00:00Z'), rrule: 'RRULE:FREQ=DAILY' },
      makeContext(),
    );
    expect(result.created.rrule).toBe('RRULE:FREQ=DAILY');
  });

  it('入力配列を変更しない', () => {
    const events = [makeMaster()];
    const before = structuredClone(events);
    createEventIn(
      events,
      { title: '追加', start: new Date('2026-07-01T10:00:00Z') },
      makeContext(),
    );
    expect(events).toEqual(before);
  });
});

describe('updateEventIn: 単発イベント', () => {
  const single: CalendarEvent = {
    id: 'single-1',
    title: '歯医者',
    start: new Date('2026-07-01T05:00:00Z'),
    end: new Date('2026-07-01T06:00:00Z'),
  };

  it('patch を適用した新しい配列を返す', () => {
    const result = updateEventIn(
      [single],
      'single-1',
      { title: '皮膚科' },
      undefined,
      makeContext(),
    );
    expect(result).toEqual([{ ...single, title: '皮膚科' }]);
  });

  it('target が指定されても単発イベントには patch を直接適用する', () => {
    const result = updateEventIn(
      [single],
      'single-1',
      { title: '皮膚科' },
      { occurrenceStart: new Date('2026-07-01T05:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toEqual([{ ...single, title: '皮膚科' }]);
    expect(result).toHaveLength(1);
  });

  it('patch の不正な rrule は Error を投げ、state に混入しない（createEventIn と同じ検証）', () => {
    expect(() =>
      updateEventIn([single], 'single-1', { rrule: 'FOO=BAR' }, undefined, makeContext()),
    ).toThrow(Error);
    expect(() =>
      updateEventIn([single], 'single-1', { rrule: 'FREQ=BOGUS' }, undefined, makeContext()),
    ).toThrow(Error);
    // 正しい rrule は受理される
    const ok = updateEventIn(
      [single],
      'single-1',
      { rrule: 'FREQ=DAILY' },
      undefined,
      makeContext(),
    );
    expect(ok[0]?.rrule).toBe('FREQ=DAILY');
    // rrule: undefined（繰り返し解除）は検証をすり抜けず正常に削除される
    const cleared = updateEventIn(
      [{ ...single, rrule: 'FREQ=DAILY' }],
      'single-1',
      { rrule: undefined },
      undefined,
      makeContext(),
    );
    expect(cleared[0]?.rrule).toBeUndefined();
  });

  it('存在しない id には Error を投げる（空配列を含む）', () => {
    expect(() => updateEventIn([], 'nothing', {}, undefined, makeContext())).toThrow(
      /イベントが見つかりません/,
    );
    expect(() => updateEventIn([single], 'nothing', {}, undefined, makeContext())).toThrow(
      /イベントが見つかりません/,
    );
  });

  it('{ rrule: undefined } のパッチで繰り返しを解除できる（undefined キー削除規則）', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      undefinedPatch('rrule'),
      undefined,
      makeContext(),
    );
    const updated = findById(result, 'master-1');
    expect(Object.hasOwn(updated, 'rrule')).toBe(false);
    expect(updated.title).toBe('朝会');
  });

  it('patch にキーが存在しないフィールドは変更されない（空パッチで同値）', () => {
    const result = updateEventIn([makeMaster()], 'master-1', {}, undefined, makeContext());
    expect(result).toEqual([makeMaster()]);
  });
});

describe("updateEventIn: scope 'this'（オーバーライド作成）", () => {
  const occurrenceStart = new Date('2026-07-03T00:00:00Z'); // 3 回目のオカレンス（東京 7/3 9:00）

  it('マスターの表示系フィールドを継承したオーバーライドを作成する', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { title: '臨時' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    // マスターは変更されない（EXDATE も付かない。展開時に originalStart で置き換えられる）
    expect(findById(result, 'master-1')).toEqual(makeMaster());
    const override = findById(result, 'gen-1');
    expect(override).toEqual({
      id: 'gen-1',
      title: '臨時',
      start: new Date('2026-07-03T00:00:00Z'),
      end: new Date('2026-07-03T01:00:00Z'), // マスターの長さ（1 時間）を維持
      timeZone: TOKYO,
      color: '#3b82f6',
      location: '会議室A',
      description: '毎朝の定例',
      editable: true,
      extendedProps: { team: 'dev' },
      recurringEventId: 'master-1',
      originalStart: new Date('2026-07-03T00:00:00Z'),
    });
    // オーバーライドは rrule / exdates を持たない
    expect(Object.hasOwn(override, 'rrule')).toBe(false);
    expect(Object.hasOwn(override, 'exdates')).toBe(false);
  });

  it('マスターに resourceId があればオーバーライドに継承する', () => {
    const result = updateEventIn(
      [makeMaster({ resourceId: 'room-1' })],
      'master-1',
      { title: '臨時' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.resourceId).toBe('room-1');
  });

  it('マスターに resourceId が無ければオーバーライドにも resourceId を持たせない', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { title: '臨時' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(Object.hasOwn(override, 'resourceId')).toBe(false);
  });

  it('patch.resourceId 指定時はマスターの resourceId より優先される', () => {
    const result = updateEventIn(
      [makeMaster({ resourceId: 'room-1' })],
      'master-1',
      { resourceId: 'room-2' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.resourceId).toBe('room-2');
  });

  it('patch.start / patch.end 指定時はそちらが優先される', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { start: new Date('2026-07-03T02:00:00Z'), end: new Date('2026-07-03T04:00:00Z') },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.start).toEqual(new Date('2026-07-03T02:00:00Z'));
    expect(override.end).toEqual(new Date('2026-07-03T04:00:00Z'));
    expect(override.originalStart).toEqual(occurrenceStart);
  });

  it('patch.start のみ指定時、end はオカレンスの開始＋マスターの長さに固定される', () => {
    // 仕様: end = patch.end ?? オカレンスの開始＋マスターの長さ（patch.start には追従しない）
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { start: new Date('2026-07-03T00:30:00Z') },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.start).toEqual(new Date('2026-07-03T00:30:00Z'));
    expect(override.end).toEqual(new Date('2026-07-03T01:00:00Z')); // オカレンスの開始 + 1 時間
  });

  it('end 省略マスターの長さは defaultEventMinutes で計算する', () => {
    const master: CalendarEvent = {
      id: 'master-noend',
      title: 'リマインダー',
      start: new Date('2026-07-01T00:00:00Z'),
      timeZone: TOKYO,
      rrule: 'FREQ=DAILY;COUNT=5',
    };
    const result = updateEventIn(
      [master],
      'master-noend',
      { title: '変更' },
      { occurrenceStart: new Date('2026-07-02T00:00:00Z'), scope: 'this' },
      makeContext({ defaultEventMinutes: 90 }),
    );
    const override = findById(result, 'gen-1');
    expect(override.start).toEqual(new Date('2026-07-02T00:00:00Z'));
    expect(override.end).toEqual(new Date('2026-07-02T01:30:00Z'));
  });

  it('終日マスターは 1 日の長さと allDay フラグを引き継ぐ', () => {
    const master: CalendarEvent = {
      id: 'master-allday',
      title: '終日タスク',
      start: '2026-07-01', // 東京 7/1 0:00 = 2026-06-30T15:00:00Z
      allDay: true,
      timeZone: TOKYO,
      rrule: 'FREQ=WEEKLY;COUNT=4',
    };
    // 2 回目のオカレンス（東京 7/8 0:00）
    const result = updateEventIn(
      [master],
      'master-allday',
      { title: '変更' },
      { occurrenceStart: new Date('2026-07-07T15:00:00Z'), scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.allDay).toBe(true);
    expect(override.start).toEqual(new Date('2026-07-07T15:00:00Z'));
    expect(override.end).toEqual(new Date('2026-07-08T15:00:00Z')); // 1 日分
  });

  it('既にオーバーライドされたオカレンス（originalStart 一致）への再編集はオーバーライドに直接適用する', () => {
    const events = [makeMaster(), makeOverride()];
    const result = updateEventIn(
      events,
      'master-1',
      { title: '再変更' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    expect(result).toHaveLength(2); // 新しいオーバーライドは作られない
    expect(findById(result, 'ov-3')).toEqual(makeOverride({ title: '再変更' }));
    expect(findById(result, 'master-1')).toEqual(makeMaster());
  });

  it("オーバーライドの ID + scope 'this' はオーバーライド自体を変更する", () => {
    const events = [makeMaster(), makeOverride()];
    const result = updateEventIn(
      events,
      'ov-3',
      { title: '直接変更' },
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    expect(findById(result, 'ov-3').title).toBe('直接変更');
  });

  it('オーバーライドの ID + target 省略もオーバーライド自体を変更する', () => {
    const events = [makeMaster(), makeOverride()];
    const result = updateEventIn(events, 'ov-3', { title: '直接変更' }, undefined, makeContext());
    expect(result).toHaveLength(2);
    expect(findById(result, 'ov-3').title).toBe('直接変更');
  });

  it("オーバーライド生成 → 再編集 → 'this' 削除で exdate 化＋オーバーライド除去、の一連の流れが動く", () => {
    const context = makeContext();
    const occ = new Date('2026-07-03T00:00:00Z');
    let events: readonly CalendarEvent[] = [makeMaster()];

    // 1. 'this' 編集でオーバーライドが生まれる
    events = updateEventIn(
      events,
      'master-1',
      { start: new Date('2026-07-03T02:00:00Z'), end: new Date('2026-07-03T03:00:00Z') },
      { occurrenceStart: occ, scope: 'this' },
      context,
    );
    expect(events).toHaveLength(2);
    expect(findById(events, 'gen-1').originalStart).toEqual(occ);

    // 2. そのオーバーライドを再編集（直接適用）
    events = updateEventIn(events, 'gen-1', { title: '臨時MTG' }, undefined, context);
    expect(events).toHaveLength(2);
    expect(findById(events, 'gen-1').title).toBe('臨時MTG');

    // 3. 'this' 削除でオーバーライドが除去され、元のオカレンスが exdates に追加される
    events = deleteEventIn(
      events,
      'gen-1',
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
      context,
    );
    expect(events).toHaveLength(1);
    expect(findById(events, 'master-1').exdates).toEqual([occ]);
  });
});

describe("updateEventIn: scope 'thisAndFollowing'（シリーズ分割）", () => {
  // COUNT=10 の 4 回目（東京 7/4 9:00）で分割する
  const splitPoint = new Date('2026-07-04T00:00:00Z');

  it('COUNT=10 の 4 回目で分割すると旧シリーズは UNTIL 打ち切り・新シリーズは COUNT=7 になる', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { title: '新シリーズ' },
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    // 旧シリーズ: COUNT は削除され、分割点の直前で UNTIL 打ち切り。patch は適用されない
    expect(findById(result, 'master-1')).toEqual(
      makeMaster({ rrule: 'FREQ=DAILY;UNTIL=20260703T090000Z' }),
    );
    // 新シリーズ: 末尾に追加され、patch が適用される
    const created = result[result.length - 1];
    expect(created).toEqual(
      makeMaster({
        id: 'gen-1',
        title: '新シリーズ',
        start: new Date('2026-07-04T00:00:00Z'),
        end: new Date('2026-07-04T01:00:00Z'),
        rrule: 'FREQ=DAILY;COUNT=7',
      }),
    );
  });

  it('新シリーズはマスターの resourceId を継承する（{ ...master } スプレッドによる自動継承）', () => {
    const result = updateEventIn(
      [makeMaster({ resourceId: 'room-1' })],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(findById(result, 'master-1').resourceId).toBe('room-1');
    expect(findById(result, 'gen-1').resourceId).toBe('room-1');
  });

  it('分割後のオカレンス集合は旧 3 回・新 7 回で、元のオカレンスの日時を保つ', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    const oldMaster = findById(result, 'master-1');
    const created = findById(result, 'gen-1');
    if (oldMaster.rrule === undefined || created.rrule === undefined) {
      throw new Error('分割後の rrule がありません');
    }
    const oldOccurrences = expandRecurrence({
      rrule: oldMaster.rrule,
      dtstart: new Date('2026-07-01T00:00:00Z'),
      timeZone: TOKYO,
      range: JULY_RANGE,
    });
    expect(toISO(oldOccurrences)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    ]);
    const newOccurrences = expandRecurrence({
      rrule: created.rrule,
      dtstart: new Date('2026-07-04T00:00:00Z'),
      timeZone: TOKYO,
      range: JULY_RANGE,
    });
    expect(newOccurrences).toHaveLength(7);
    expect(toISO(newOccurrences)[0]).toBe('2026-07-04T00:00:00.000Z');
    expect(toISO(newOccurrences)[6]).toBe('2026-07-10T00:00:00.000Z');
  });

  it('分割点以降のオーバーライドは新シリーズに付け替わり、それより前は旧シリーズに残る', () => {
    const before = makeOverride({
      id: 'ov-2',
      start: new Date('2026-07-02T02:00:00Z'),
      end: new Date('2026-07-02T03:00:00Z'),
      originalStart: new Date('2026-07-02T00:00:00Z'),
    });
    const atBoundary = makeOverride({
      id: 'ov-4',
      start: new Date('2026-07-04T02:00:00Z'),
      end: new Date('2026-07-04T03:00:00Z'),
      originalStart: new Date('2026-07-04T00:00:00Z'), // ちょうど分割点（>= なので新シリーズへ）
    });
    const after = makeOverride({
      id: 'ov-5',
      start: new Date('2026-07-05T02:00:00Z'),
      end: new Date('2026-07-05T03:00:00Z'),
      originalStart: new Date('2026-07-05T00:00:00Z'),
    });
    const result = updateEventIn(
      [makeMaster(), before, atBoundary, after],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toHaveLength(5);
    expect(findById(result, 'ov-2').recurringEventId).toBe('master-1');
    expect(findById(result, 'ov-4').recurringEventId).toBe('gen-1');
    expect(findById(result, 'ov-5').recurringEventId).toBe('gen-1');
    // 付け替え以外のフィールドは変更されない
    expect(findById(result, 'ov-5')).toEqual({ ...after, recurringEventId: 'gen-1' });
  });

  it('EXDATE は分割点を境（>= は新シリーズ）に振り分けられる', () => {
    const master = makeMaster({
      exdates: [new Date('2026-07-03T00:00:00Z'), new Date('2026-07-04T00:00:00Z')],
    });
    const result = updateEventIn(
      [master],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(findById(result, 'master-1').exdates).toEqual([new Date('2026-07-03T00:00:00Z')]);
    expect(findById(result, 'gen-1').exdates).toEqual([new Date('2026-07-04T00:00:00Z')]);
  });

  it('RDATE は EXDATE と対称に分割点を境（>= は新シリーズ）に振り分けられる', () => {
    const master = makeMaster({
      rdates: [new Date('2026-07-03T05:00:00Z'), new Date('2026-07-04T05:00:00Z')],
    });
    const result = updateEventIn(
      [master],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(findById(result, 'master-1').rdates).toEqual([new Date('2026-07-03T05:00:00Z')]);
    expect(findById(result, 'gen-1').rdates).toEqual([new Date('2026-07-04T05:00:00Z')]);
  });

  it('UNTIL 付きルールの分割では新シリーズが UNTIL をそのまま引き継ぐ', () => {
    const master = makeMaster({ rrule: 'FREQ=DAILY;UNTIL=20260710T090000Z' });
    const result = updateEventIn(
      [master],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(findById(result, 'master-1').rrule).toBe('FREQ=DAILY;UNTIL=20260703T090000Z');
    expect(findById(result, 'gen-1').rrule).toBe('FREQ=DAILY;UNTIL=20260710T090000Z');
  });

  it('終了条件なし（無限）ルールの分割では新シリーズが rrule をそのまま引き継ぐ', () => {
    const master = makeMaster({ rrule: 'FREQ=DAILY' });
    const result = updateEventIn(
      [master],
      'master-1',
      {},
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(findById(result, 'master-1').rrule).toBe('FREQ=DAILY;UNTIL=20260703T090000Z');
    expect(findById(result, 'gen-1').rrule).toBe('FREQ=DAILY');
  });

  it("最初のオカレンス（dtstart と一致）での分割は 'all' と同じ扱いになる", () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { title: '全変更' },
      { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toHaveLength(1); // 新イベントは作られない
    expect(findById(result, 'master-1')).toEqual(makeMaster({ title: '全変更' }));
  });

  it('DST 跨ぎの分割でも現地時刻（NY 9:00）が保たれる', () => {
    const nyMaster: CalendarEvent = {
      id: 'ny-master',
      title: 'NY 朝会',
      start: new Date('2026-03-06T14:00:00Z'), // NY 3/6 9:00 EST
      end: new Date('2026-03-06T15:00:00Z'),
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=6',
    };
    // 3 回目のオカレンス = DST 切替日 3/8 の 9:00 EDT = 13:00Z で分割
    const result = updateEventIn(
      [nyMaster],
      'ny-master',
      {},
      { occurrenceStart: new Date('2026-03-08T13:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(), // displayTimeZone は東京 → イベントの timeZone が優先されることの検証
    );
    const oldMaster = findById(result, 'ny-master');
    const created = findById(result, 'gen-1');
    expect(oldMaster.rrule).toBe('FREQ=DAILY;UNTIL=20260307T090000Z');
    expect(created.start).toEqual(new Date('2026-03-08T13:00:00Z'));
    expect(created.end).toEqual(new Date('2026-03-08T14:00:00Z'));
    expect(created.rrule).toBe('FREQ=DAILY;COUNT=4'); // 消化済み 2 回を差し引く

    const marchRange = {
      start: new Date('2026-03-01T00:00:00Z'),
      end: new Date('2026-04-01T00:00:00Z'),
    };
    if (oldMaster.rrule === undefined || created.rrule === undefined) {
      throw new Error('分割後の rrule がありません');
    }
    const oldOccurrences = expandRecurrence({
      rrule: oldMaster.rrule,
      dtstart: new Date('2026-03-06T14:00:00Z'),
      timeZone: NY,
      range: marchRange,
    });
    expect(toISO(oldOccurrences)).toEqual(['2026-03-06T14:00:00.000Z', '2026-03-07T14:00:00.000Z']);
    const newOccurrences = expandRecurrence({
      rrule: created.rrule,
      dtstart: new Date('2026-03-08T13:00:00Z'),
      timeZone: NY,
      range: marchRange,
    });
    expect(toISO(newOccurrences)).toEqual([
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-10T13:00:00.000Z',
      '2026-03-11T13:00:00.000Z',
    ]);
    for (const occurrence of newOccurrences) {
      const wall = getWallClock(occurrence, NY);
      expect([wall.hours, wall.minutes]).toEqual([9, 0]);
    }
  });
});

describe("updateEventIn: scope 'all'", () => {
  it('patch をマスターに適用し、rrule は変更しない', () => {
    const result = updateEventIn(
      [makeMaster()],
      'master-1',
      { title: '全体変更', color: '#ff0000' },
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'all' },
      makeContext(),
    );
    expect(result).toEqual([makeMaster({ title: '全体変更', color: '#ff0000' })]);
  });

  it('既存のオーバーライドは維持される', () => {
    const result = updateEventIn(
      [makeMaster(), makeOverride()],
      'master-1',
      { title: '全体変更' },
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'all' },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    expect(findById(result, 'ov-3')).toEqual(makeOverride());
  });
});

describe('updateEventIn: オーバーライドの ID で親シリーズに適用', () => {
  it("scope 'all' は親シリーズに patch を適用し、オーバーライドは維持する", () => {
    const result = updateEventIn(
      [makeMaster(), makeOverride()],
      'ov-3',
      { title: '全体変更' },
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'all' },
      makeContext(),
    );
    expect(findById(result, 'master-1')).toEqual(makeMaster({ title: '全体変更' }));
    expect(findById(result, 'ov-3')).toEqual(makeOverride());
  });

  it("scope 'thisAndFollowing' はオーバーライドの originalStart を分割点として親を分割する", () => {
    // ov-3 の originalStart は 7/3 9:00（3 回目のオカレンス）。現在の開始 11:00 ではなく本来の 9:00 で分割される
    const result = updateEventIn(
      [makeMaster(), makeOverride()],
      'ov-3',
      { title: '以降変更' },
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toHaveLength(3);
    // 旧シリーズは 7/3 9:00 の直前で打ち切り（7/1・7/2 の 2 回が残る）
    expect(findById(result, 'master-1').rrule).toBe('FREQ=DAILY;UNTIL=20260702T090000Z');
    // 新シリーズは分割点（originalStart）から始まり、COUNT は 10 - 2 = 8
    const created = findById(result, 'gen-1');
    expect(created.start).toEqual(new Date('2026-07-03T00:00:00Z'));
    expect(created.rrule).toBe('FREQ=DAILY;COUNT=8');
    expect(created.title).toBe('以降変更');
    // オーバーライドは新シリーズに付け替わる
    expect(findById(result, 'ov-3').recurringEventId).toBe('gen-1');
  });
});

describe('deleteEventIn: 参照先のないオーバーライド（親マスター不在）', () => {
  it("親が存在しないオーバーライドの 'this' 削除はオーバーライドの除去のみ行う", () => {
    const orphan: CalendarEvent = {
      id: 'orphan-1',
      title: '参照先のないオーバーライド',
      start: new Date('2026-07-03T02:00:00Z'),
      end: new Date('2026-07-03T03:00:00Z'),
      recurringEventId: 'missing-master',
      originalStart: new Date('2026-07-03T00:00:00Z'),
    };
    const other: CalendarEvent = {
      id: 'other-1',
      title: '無関係',
      start: new Date('2026-07-04T00:00:00Z'),
    };

    const result = deleteEventIn([orphan, other], 'orphan-1', undefined, makeContext());

    // 参照先のないオーバーライドは取り除かれ、他イベントは EXDATE 追加などの影響を受けない
    expect(result).toEqual([other]);
  });
});

describe('オーバーライドの日時解釈: マスターの timeZone にフォールバックする', () => {
  // 外部データ同期パターン: マスターに明示 TZ（America/New_York）があり、
  // オーバーライド側は timeZone フィールドを持たない。
  // originalStart 'YYYY-MM-DDTHH:mm' は expansion.ts と同じく
  // 「オーバーライド TZ → マスター TZ → 表示 TZ」の順で解釈されるべき。
  // 2026 年 7 月の NY は EDT（UTC-4）なので 10:00 NY = 14:00Z。
  // 表示 TZ（Asia/Tokyo）で誤って解釈すると 01:00Z になり 13 時間ずれる。

  /** 毎朝 10:00 NY 開始・FREQ=DAILY のマスター。 */
  function makeNyMaster(): CalendarEvent {
    return {
      id: 'ny-master',
      title: 'NY 定例',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      timeZone: NY,
      rrule: 'FREQ=DAILY',
    };
  }

  /** 7/3 のオカレンスを 12:00 に移動したオーバーライド（timeZone フィールドなし）。 */
  function makeNyOverride(): CalendarEvent {
    return {
      id: 'ny-ov',
      title: '移動済み',
      start: '2026-07-03T12:00',
      end: '2026-07-03T13:00',
      recurringEventId: 'ny-master',
      originalStart: '2026-07-03T10:00',
    };
  }

  it("deleteEventIn: オーバーライド ID の 'this' 削除で親に追加される EXDATE がマスター TZ 基準になる", () => {
    const result = deleteEventIn(
      [makeNyMaster(), makeNyOverride()],
      'ny-ov',
      undefined,
      makeContext(),
    );

    const parent = findById(result, 'ny-master');
    expect(toISO((parent.exdates ?? []).map((d) => new Date(d)))).toEqual([
      '2026-07-03T14:00:00.000Z', // 10:00 EDT
    ]);
  });

  it("updateEventIn: オーバーライド ID の 'thisAndFollowing' がマスター TZ 基準の分割点でシリーズを分割する", () => {
    const result = updateEventIn(
      [makeNyMaster(), makeNyOverride()],
      'ny-ov',
      { title: '以降変更' },
      { occurrenceStart: new Date('2026-07-03T16:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );

    // 新シリーズは 7/3 10:00 NY（= 14:00Z）から始まる
    const created = findById(result, 'gen-1');
    expect(created.start).toEqual(new Date('2026-07-03T14:00:00Z'));
    // 旧シリーズは 7/1・7/2 の 2 回のみ（分割点 14:00Z の直前で打ち切り）
    const oldMaster = findById(result, 'ny-master');
    const kept = expandRecurrence({
      rrule: oldMaster.rrule ?? '',
      dtstart: new Date('2026-07-01T14:00:00Z'),
      timeZone: NY,
      range: { start: new Date('2026-06-30T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') },
    });
    expect(toISO(kept)).toEqual(['2026-07-01T14:00:00.000Z', '2026-07-02T14:00:00.000Z']);
    // オーバーライドは新シリーズに付け替わる
    expect(findById(result, 'ny-ov').recurringEventId).toBe('gen-1');
  });

  it("updateEventIn: マスター ID + 'this' が既存オーバーライドをマスター TZ 基準で照合し、重複オーバーライドを作らない", () => {
    const result = updateEventIn(
      [makeNyMaster(), makeNyOverride()],
      'ny-master',
      { title: '再変更' },
      { occurrenceStart: new Date('2026-07-03T14:00:00Z'), scope: 'this' },
      makeContext(),
    );

    // 既存オーバーライドへの適用であり、新規イベントは増えない
    expect(result).toHaveLength(2);
    expect(findById(result, 'ny-ov').title).toBe('再変更');
  });
});

describe('deleteEventIn: 単発イベント', () => {
  it('イベントを取り除く', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '歯医者',
      start: new Date('2026-07-01T05:00:00Z'),
    };
    const result = deleteEventIn([single, makeMaster()], 'single-1', undefined, makeContext());
    expect(result).toEqual([makeMaster()]);
  });

  it('存在しない id には Error を投げる（空配列を含む）', () => {
    expect(() => deleteEventIn([], 'nothing', undefined, makeContext())).toThrow(
      /イベントが見つかりません/,
    );
  });
});

describe('deleteEventIn: 繰り返しイベント', () => {
  it('target 省略時は繰り返し全体と、それを参照するオーバーライドをすべて取り除く', () => {
    const other: CalendarEvent = {
      id: 'other-1',
      title: '無関係',
      start: new Date('2026-07-01T05:00:00Z'),
    };
    const result = deleteEventIn(
      [makeMaster(), makeOverride(), other],
      'master-1',
      undefined,
      makeContext(),
    );
    expect(result).toEqual([other]);
  });

  it("scope 'all' も繰り返し全体とオーバーライドを取り除く", () => {
    const result = deleteEventIn(
      [makeMaster(), makeOverride()],
      'master-1',
      { occurrenceStart: new Date('2026-07-05T00:00:00Z'), scope: 'all' },
      makeContext(),
    );
    expect(result).toEqual([]);
  });

  it("scope 'this'（未オーバーライドのオカレンス）は対象オカレンスを EXDATE に追加する", () => {
    const occ = new Date('2026-07-05T00:00:00Z');
    const result = deleteEventIn(
      [makeMaster()],
      'master-1',
      { occurrenceStart: occ, scope: 'this' },
      makeContext(),
    );
    expect(result).toEqual([makeMaster({ exdates: [occ] })]);
  });

  it("scope 'this' は既存の EXDATE の末尾に追加する", () => {
    const master = makeMaster({ exdates: [new Date('2026-07-02T00:00:00Z')] });
    const result = deleteEventIn(
      [master],
      'master-1',
      { occurrenceStart: new Date('2026-07-05T00:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(findById(result, 'master-1').exdates).toEqual([
      new Date('2026-07-02T00:00:00Z'),
      new Date('2026-07-05T00:00:00Z'),
    ]);
  });

  it("オーバーライドの ID + scope 'this' はオーバーライドを除去し、元のオカレンス（originalStart）を EXDATE に追加する", () => {
    const result = deleteEventIn(
      [makeMaster(), makeOverride()],
      'ov-3',
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toEqual([makeMaster({ exdates: [new Date('2026-07-03T00:00:00Z')] })]);
  });

  it('オーバーライドの ID + target 省略も同様にオーバーライド除去＋EXDATE 追加になる', () => {
    const result = deleteEventIn([makeMaster(), makeOverride()], 'ov-3', undefined, makeContext());
    expect(result).toEqual([makeMaster({ exdates: [new Date('2026-07-03T00:00:00Z')] })]);
  });

  it("マスターの ID + 現在の開始時刻でもオーバーライド済みのオカレンスを 'this' 削除できる", () => {
    // ov-3 は 7/3 9:00 のオカレンスを 11:00 に移動済み。現在の開始時刻（11:00 = 02:00Z）で指定する
    const result = deleteEventIn(
      [makeMaster(), makeOverride()],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toEqual([makeMaster({ exdates: [new Date('2026-07-03T00:00:00Z')] })]);
  });

  it("scope 'thisAndFollowing' は分割点の直前で打ち切り、以降（>=）の EXDATE とオーバーライドを取り除く", () => {
    const master = makeMaster({
      exdates: [new Date('2026-07-03T00:00:00Z'), new Date('2026-07-04T00:00:00Z')],
    });
    const atBoundary = makeOverride({
      id: 'ov-4',
      start: new Date('2026-07-04T02:00:00Z'),
      originalStart: new Date('2026-07-04T00:00:00Z'), // ちょうど分割点 → 除去される
    });
    const before = makeOverride({
      id: 'ov-2',
      start: new Date('2026-07-02T02:00:00Z'),
      originalStart: new Date('2026-07-02T00:00:00Z'), // 分割点より前 → 残る
    });
    const result = deleteEventIn(
      [master, atBoundary, before],
      'master-1',
      { occurrenceStart: new Date('2026-07-04T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    const updated = findById(result, 'master-1');
    expect(updated.rrule).toBe('FREQ=DAILY;UNTIL=20260703T090000Z');
    expect(updated.exdates).toEqual([new Date('2026-07-03T00:00:00Z')]);
    expect(findById(result, 'ov-2')).toEqual(before);
    expect(result.some((event) => event.id === 'ov-4')).toBe(false);
  });

  it("scope 'thisAndFollowing' の打ち切りは分割点以降（>=）の RDATE も取り除く", () => {
    const master = makeMaster({
      rdates: [new Date('2026-07-03T05:00:00Z'), new Date('2026-07-04T05:00:00Z')],
    });
    const result = deleteEventIn(
      [master],
      'master-1',
      { occurrenceStart: new Date('2026-07-04T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    const updated = findById(result, 'master-1');
    expect(updated.rrule).toBe('FREQ=DAILY;UNTIL=20260703T090000Z');
    expect(updated.rdates).toEqual([new Date('2026-07-03T05:00:00Z')]);
  });

  it("scope 'thisAndFollowing' の打ち切り後は分割点より前のオカレンスだけが残る", () => {
    const result = deleteEventIn(
      [makeMaster()],
      'master-1',
      { occurrenceStart: new Date('2026-07-04T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    const updated = findById(result, 'master-1');
    if (updated.rrule === undefined) {
      throw new Error('打ち切り後の rrule がありません');
    }
    const occurrences = expandRecurrence({
      rrule: updated.rrule,
      dtstart: new Date('2026-07-01T00:00:00Z'),
      timeZone: TOKYO,
      range: JULY_RANGE,
    });
    expect(toISO(occurrences)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    ]);
  });

  it("最初のオカレンスでの 'thisAndFollowing' 削除は繰り返し全体を削除する", () => {
    const result = deleteEventIn(
      [makeMaster(), makeOverride()],
      'master-1',
      { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(result).toEqual([]);
  });
});

describe('moveOccurrenceIn', () => {
  it('オーバーライド済みのオカレンスをマスター ID + 現在の開始時刻で移動すると、オーバーライド固有の長さが維持される', () => {
    // 7/3 のオカレンスは 11:00〜12:30 JST（90 分）に変更済み（マスターの既定は 60 分）
    const override = makeOverride({ end: new Date('2026-07-03T03:30:00Z') });
    const result = moveOccurrenceIn(
      [makeMaster(), override],
      'master-1',
      {
        // 「対象オカレンスの現在の開始時刻」= オーバーライド後の 11:00 JST
        occurrenceStart: new Date('2026-07-03T02:00:00Z'),
        newStart: new Date('2026-07-03T05:00:00Z'), // 14:00 JST へ移動
        scope: 'this',
      },
      makeContext(),
    );
    const moved = findById(result, 'ov-3');
    expect(moved.start).toEqual(new Date('2026-07-03T05:00:00Z'));
    // マスターの 60 分ではなく、オーバーライドの 90 分が維持される
    expect(moved.end).toEqual(new Date('2026-07-03T06:30:00Z'));
  });

  it('単発イベントの移動では長さ（90 分）が維持される', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '打ち合わせ',
      start: '2026-07-01T10:00', // 東京の現地時刻 → 01:00Z
      end: '2026-07-01T11:30', // 02:30Z（90 分）
    };
    const result = moveOccurrenceIn(
      [single],
      'single-1',
      {
        occurrenceStart: new Date('2026-07-01T01:00:00Z'),
        newStart: new Date('2026-07-02T05:00:00Z'),
      },
      makeContext(),
    );
    expect(findById(result, 'single-1').start).toEqual(new Date('2026-07-02T05:00:00Z'));
    expect(findById(result, 'single-1').end).toEqual(new Date('2026-07-02T06:30:00Z'));
  });

  it('end 省略イベントの移動は defaultEventMinutes の長さになる', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: 'メモ',
      start: new Date('2026-07-01T01:00:00Z'),
    };
    const result = moveOccurrenceIn(
      [single],
      'single-1',
      {
        occurrenceStart: new Date('2026-07-01T01:00:00Z'),
        newStart: new Date('2026-07-01T03:00:00Z'),
      },
      makeContext({ defaultEventMinutes: 45 }),
    );
    expect(findById(result, 'single-1').end).toEqual(new Date('2026-07-01T03:45:00Z'));
  });

  it('newEnd 指定時はリサイズとして end に newEnd を使う', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '作業',
      start: new Date('2026-07-01T01:00:00Z'),
      end: new Date('2026-07-01T02:00:00Z'),
    };
    const result = moveOccurrenceIn(
      [single],
      'single-1',
      {
        occurrenceStart: new Date('2026-07-01T01:00:00Z'),
        newStart: new Date('2026-07-01T01:00:00Z'),
        newEnd: new Date('2026-07-01T04:00:00Z'),
      },
      makeContext(),
    );
    expect(findById(result, 'single-1')).toEqual({
      ...single,
      end: new Date('2026-07-01T04:00:00Z'),
    });
  });

  it('allDay: true 指定時は allDay フラグもパッチに含まれる（時間 → 終日）', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '作業',
      start: new Date('2026-07-01T01:00:00Z'),
      end: new Date('2026-07-01T02:00:00Z'),
    };
    const result = moveOccurrenceIn(
      [single],
      'single-1',
      {
        occurrenceStart: new Date('2026-07-01T01:00:00Z'),
        newStart: new Date('2026-07-01T15:00:00Z'), // 東京 7/2 0:00
        allDay: true,
      },
      makeContext(),
    );
    const moved = findById(result, 'single-1');
    expect(moved.allDay).toBe(true);
    expect(moved.start).toEqual(new Date('2026-07-01T15:00:00Z'));
  });

  it('allDay: false + newEnd 指定で終日 → 時間指定に変換できる', () => {
    const allDayEvent: CalendarEvent = {
      id: 'allday-1',
      title: '終日タスク',
      start: '2026-07-01',
      end: '2026-07-02',
      allDay: true,
    };
    const result = moveOccurrenceIn(
      [allDayEvent],
      'allday-1',
      {
        occurrenceStart: new Date('2026-06-30T15:00:00Z'),
        newStart: new Date('2026-07-01T01:00:00Z'),
        newEnd: new Date('2026-07-01T02:00:00Z'),
        allDay: false,
      },
      makeContext(),
    );
    expect(findById(result, 'allday-1')).toEqual({
      ...allDayEvent,
      start: new Date('2026-07-01T01:00:00Z'),
      end: new Date('2026-07-01T02:00:00Z'),
      allDay: false,
    });
  });

  it("繰り返しの 'this' 移動ではオーバーライドが生まれ、マスターの長さ（1 時間）が維持される", () => {
    const occ = new Date('2026-07-03T00:00:00Z');
    const result = moveOccurrenceIn(
      [makeMaster()],
      'master-1',
      {
        occurrenceStart: occ,
        newStart: new Date('2026-07-03T06:00:00Z'), // 東京 7/3 15:00 へ移動
        scope: 'this',
      },
      makeContext(),
    );
    expect(result).toHaveLength(2);
    expect(findById(result, 'master-1')).toEqual(makeMaster());
    const override = findById(result, 'gen-1');
    expect(override.start).toEqual(new Date('2026-07-03T06:00:00Z'));
    expect(override.end).toEqual(new Date('2026-07-03T07:00:00Z'));
    expect(override.recurringEventId).toBe('master-1');
    expect(override.originalStart).toEqual(occ);
  });

  it("繰り返しの 'thisAndFollowing' 移動では新シリーズが移動先から始まる", () => {
    const result = moveOccurrenceIn(
      [makeMaster()],
      'master-1',
      {
        occurrenceStart: new Date('2026-07-04T00:00:00Z'),
        newStart: new Date('2026-07-04T02:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeContext(),
    );
    expect(findById(result, 'master-1').rrule).toBe('FREQ=DAILY;UNTIL=20260703T090000Z');
    const created = findById(result, 'gen-1');
    expect(created.start).toEqual(new Date('2026-07-04T02:00:00Z'));
    expect(created.end).toEqual(new Date('2026-07-04T03:00:00Z'));
    expect(created.rrule).toBe('FREQ=DAILY;COUNT=7');
  });

  it("scope 'all' で最初のオカレンスを移動するとマスターの start / end が変わる", () => {
    const result = moveOccurrenceIn(
      [makeMaster()],
      'master-1',
      {
        occurrenceStart: new Date('2026-07-01T00:00:00Z'),
        newStart: new Date('2026-07-01T02:00:00Z'),
        scope: 'all',
      },
      makeContext(),
    );
    expect(result).toEqual([
      makeMaster({
        start: new Date('2026-07-01T02:00:00Z'),
        end: new Date('2026-07-01T03:00:00Z'),
      }),
    ]);
  });

  it('繰り返しイベントで scope 未指定の場合は Error を投げる', () => {
    expect(() =>
      moveOccurrenceIn(
        [makeMaster()],
        'master-1',
        {
          occurrenceStart: new Date('2026-07-03T00:00:00Z'),
          newStart: new Date('2026-07-03T06:00:00Z'),
        },
        makeContext(),
      ),
    ).toThrow(/scope/);
  });

  it('オーバーライドイベントでも scope 未指定の場合は Error を投げる', () => {
    expect(() =>
      moveOccurrenceIn(
        [makeMaster(), makeOverride()],
        'ov-3',
        {
          occurrenceStart: new Date('2026-07-03T02:00:00Z'),
          newStart: new Date('2026-07-03T06:00:00Z'),
        },
        makeContext(),
      ),
    ).toThrow(/scope/);
  });

  it('存在しない id には Error を投げる', () => {
    expect(() =>
      moveOccurrenceIn(
        [],
        'nothing',
        {
          occurrenceStart: new Date('2026-07-01T00:00:00Z'),
          newStart: new Date('2026-07-02T00:00:00Z'),
        },
        makeContext(),
      ),
    ).toThrow(/イベントが見つかりません/);
  });
});

describe('不変性: 入力配列・入力イベントオブジェクトを変更しない', () => {
  it('createEventIn は入力を変更しない', () => {
    const events = [makeMaster(), makeOverride()];
    const before = structuredClone(events);
    createEventIn(
      events,
      { title: '追加', start: new Date('2026-07-01T05:00:00Z') },
      makeContext(),
    );
    expect(events).toEqual(before);
  });

  it("updateEventIn（'this' でのオーバーライド作成）は入力を変更しない", () => {
    const events = [makeMaster()];
    const before = structuredClone(events);
    updateEventIn(
      events,
      'master-1',
      { title: '変更' },
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(events).toEqual(before);
  });

  it("updateEventIn（'thisAndFollowing' での分割）は入力を変更しない", () => {
    const events = [
      makeMaster({ exdates: [new Date('2026-07-05T00:00:00Z')] }),
      makeOverride({ id: 'ov-5', originalStart: new Date('2026-07-06T00:00:00Z') }),
    ];
    const before = structuredClone(events);
    updateEventIn(
      events,
      'master-1',
      { title: '変更' },
      { occurrenceStart: new Date('2026-07-04T00:00:00Z'), scope: 'thisAndFollowing' },
      makeContext(),
    );
    expect(events).toEqual(before);
  });

  it("deleteEventIn（'this' での EXDATE 追加・オーバーライド除去）は入力を変更しない", () => {
    const events = [makeMaster({ exdates: [new Date('2026-07-02T00:00:00Z')] }), makeOverride()];
    const before = structuredClone(events);
    deleteEventIn(
      events,
      'ov-3',
      { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(events).toEqual(before);
  });

  it('moveOccurrenceIn は入力を変更しない', () => {
    const events = [makeMaster()];
    const before = structuredClone(events);
    moveOccurrenceIn(
      events,
      'master-1',
      {
        occurrenceStart: new Date('2026-07-03T00:00:00Z'),
        newStart: new Date('2026-07-03T06:00:00Z'),
        scope: 'this',
      },
      makeContext(),
    );
    expect(events).toEqual(before);
  });
});
