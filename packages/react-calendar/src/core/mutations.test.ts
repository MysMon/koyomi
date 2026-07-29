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
import { expandEvents } from './expansion';
import {
  applyEventChangeEntries,
  applyEventChangeEntriesWithApplied,
  applyPatch,
  buildOccurrenceCopy,
  createEventIn,
  deleteEventIn,
  deleteEventInWithChanges,
  duplicateEventIn,
  duplicateEventInWithChanges,
  type EventChangeEntry,
  type MutationContext,
  moveOccurrenceIn,
  moveOccurrenceInWithChanges,
  pasteEventIn,
  pasteEventInWithChanges,
  placeEventInputAt,
  updateEventIn,
  updateEventInWithChanges,
} from './mutations';
import { expandRecurrence } from './recurrence';
import { getWallClock } from './timezone';
import type { CalendarEvent, CalendarEventInput, CalendarEventPatch } from './types';

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

  it('extendedProps に undefined を指定するパッチは extendedProps フィールドごと削除する', () => {
    const event = makeMaster({ extendedProps: { team: 'dev', ownerId: 'u1' } });
    const result = applyPatch(event, undefinedPatch('extendedProps'));
    expect('extendedProps' in result).toBe(false);
  });

  it('extendedProps を新しいオブジェクトで置き換えるパッチは、既存のキーをマージせず丸ごと置き換える', () => {
    const event = makeMaster({ extendedProps: { team: 'dev', ownerId: 'u1' } });
    const result = applyPatch(event, { extendedProps: { ownerId: 'u2' } });
    expect(result.extendedProps).toEqual({ ownerId: 'u2' });
    // 置き換え前の 'team' キーは残らない（マージではなく置換）
    expect(result.extendedProps).not.toHaveProperty('team');
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

  it('不正な timeZone が指定された場合は Error を投げる（メッセージに id と不正値を含む）', () => {
    expect(() =>
      createEventIn(
        [],
        {
          id: 'bad-tz',
          title: '不正',
          start: new Date('2026-07-01T10:00:00Z'),
          timeZone: 'Invalid/Zone',
        },
        makeContext(),
      ),
    ).toThrow(/bad-tz.*Invalid\/Zone/);
  });

  it('有効な timeZone・timeZone 省略はそのまま受理される', () => {
    const withZone = createEventIn(
      [],
      { title: '有効', start: new Date('2026-07-01T10:00:00Z'), timeZone: 'America/New_York' },
      makeContext(),
    );
    expect(withZone.created.timeZone).toBe('America/New_York');

    const withoutZone = createEventIn(
      [],
      { title: '省略', start: new Date('2026-07-01T10:00:00Z') },
      makeContext(),
    );
    expect(withoutZone.created.timeZone).toBeUndefined();
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

  it('patch の不正な timeZone は Error を投げ、state に混入しない（メッセージに id と不正値を含む）', () => {
    expect(() =>
      updateEventIn([single], 'single-1', { timeZone: 'Invalid/Zone' }, undefined, makeContext()),
    ).toThrow(/single-1.*Invalid\/Zone/);
    // 正しい timeZone は受理される
    const ok = updateEventIn(
      [single],
      'single-1',
      { timeZone: 'America/New_York' },
      undefined,
      makeContext(),
    );
    expect(ok[0]?.timeZone).toBe('America/New_York');
    // timeZone: undefined（カレンダーの表示タイムゾーンへのフォールバック）は検証をすり抜けず正常に削除される
    const cleared = updateEventIn(
      [{ ...single, timeZone: 'America/New_York' }],
      'single-1',
      { timeZone: undefined },
      undefined,
      makeContext(),
    );
    expect(cleared[0]?.timeZone).toBeUndefined();
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

  it('マスターに resourceIds（複数リソース割当）があればオーバーライドに継承する', () => {
    const result = updateEventIn(
      [makeMaster({ resourceIds: ['room-1', 'room-2'] })],
      'master-1',
      { title: '臨時' },
      { occurrenceStart, scope: 'this' },
      makeContext(),
    );
    const override = findById(result, 'gen-1');
    expect(override.resourceIds).toEqual(['room-1', 'room-2']);
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
    expect(override.start).toBe('2026-07-08');
    expect(override.end).toBe('2026-07-09'); // 1 暦日分
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

describe('findOverrideFor: originalStart を持つオーバーライドは originalStart のみで判定する', () => {
  // 再現ケース: override-a は 7/1 のオカレンス（originalStart=7/1）を未変更のまま残し、
  // override-b は本来 7/3 のオカレンス（originalStart=7/3）だったものを 7/1 へ移動済み。
  // 現在の start が override-b（7/1）と偶然一致しても、originalStart が不一致な override-b は
  // 対象外とし、originalStart が一致する override-a のみが「7/1 のオカレンスのオーバーライド」
  // として扱われるべき。配列順は override-b が先（Array.find が先に検査する）。
  function makeOverrideA(): CalendarEvent {
    return {
      id: 'override-a',
      title: '7/1 のオーバーライド（未変更）',
      start: new Date('2026-07-01T00:00:00Z'),
      end: new Date('2026-07-01T01:00:00Z'),
      recurringEventId: 'master-1',
      originalStart: new Date('2026-07-01T00:00:00Z'),
    };
  }
  function makeOverrideB(): CalendarEvent {
    return {
      id: 'override-b',
      title: '7/3 のオーバーライド（7/1 へ移動済み）',
      start: new Date('2026-07-01T00:00:00Z'), // 現在位置が override-a と偶然一致
      end: new Date('2026-07-01T01:00:00Z'),
      recurringEventId: 'master-1',
      originalStart: new Date('2026-07-03T00:00:00Z'),
    };
  }

  it('updateEventIn: 7/1 の originalStart に一致する override-a のみが更新され、override-b は変更されない', () => {
    const events = [makeMaster(), makeOverrideB(), makeOverrideA()]; // override-b が先
    const result = updateEventIn(
      events,
      'master-1',
      { title: '再変更' },
      { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toHaveLength(3); // 新しいオーバーライドは作られない
    expect(findById(result, 'override-a').title).toBe('再変更');
    expect(findById(result, 'override-b')).toEqual(makeOverrideB());
  });

  it('deleteEventIn: 7/1 の originalStart に一致する override-a のみが除去され、override-b は変更されない', () => {
    const events = [makeMaster(), makeOverrideB(), makeOverrideA()]; // override-b が先
    const result = deleteEventIn(
      events,
      'master-1',
      { occurrenceStart: new Date('2026-07-01T00:00:00Z'), scope: 'this' },
      makeContext(),
    );
    expect(result).toHaveLength(2); // override-a のみ除去される
    expect(result.some((event) => event.id === 'override-a')).toBe(false);
    expect(findById(result, 'override-b')).toEqual(makeOverrideB());
    expect(findById(result, 'master-1').exdates).toEqual([new Date('2026-07-01T00:00:00Z')]);
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

  it('分割点ちょうどのオーバーライドは新シリーズへ付け替わるが、patch はそのオーバーライドには適用されない', () => {
    const atBoundary = makeOverride({
      id: 'ov-4',
      start: new Date('2026-07-04T02:00:00Z'),
      end: new Date('2026-07-04T03:00:00Z'),
      originalStart: new Date('2026-07-04T00:00:00Z'), // ちょうど分割点（>= なので新シリーズへ）
    });
    const result = updateEventIn(
      [makeMaster(), atBoundary],
      'master-1',
      { title: '新シリーズ' },
      { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
      makeContext(),
    );
    // オーバーライドは recurringEventId の付け替えのみ行われ、patch（title）は適用されない
    expect(findById(result, 'ov-4')).toEqual({ ...atBoundary, recurringEventId: 'gen-1' });
    // patch は新シリーズの初回オカレンス（マスター相当のイベント）にのみ適用される
    expect(findById(result, 'gen-1').title).toBe('新シリーズ');
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

describe('updateEventIn: 参照先のないオーバーライド（親マスター不在）', () => {
  it('target を省略した更新は、単発イベントと同様に直接パッチを適用する', () => {
    const orphan: CalendarEvent = {
      id: 'orphan-1',
      title: '参照先のないオーバーライド',
      start: new Date('2026-07-03T02:00:00Z'),
      end: new Date('2026-07-03T03:00:00Z'),
      recurringEventId: 'missing-master',
      originalStart: new Date('2026-07-03T00:00:00Z'),
    };
    const result = updateEventIn(
      [orphan],
      'orphan-1',
      { title: '変更後' },
      undefined,
      makeContext(),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('変更後');
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

  it("マスターの ID + 本来の開始時刻（originalStart）でオーバーライド済みのオカレンスを 'this' 削除できる", () => {
    // ov-3 は 7/3 9:00（originalStart）のオカレンスを 11:00 に移動済み。
    // 呼び出し規約どおり、occurrenceStart には本来の開始時刻（originalStart）を渡す
    const result = deleteEventIn(
      [makeMaster(), makeOverride()],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'this' },
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
  it('オーバーライド済みのオカレンスをマスター ID + 本来の開始時刻（originalStart）で移動すると、オーバーライド固有の長さが維持される', () => {
    // 7/3 のオカレンスは 11:00〜12:30 JST（90 分）に変更済み（マスターの既定は 60 分）
    const override = makeOverride({ end: new Date('2026-07-03T03:30:00Z') });
    const result = moveOccurrenceIn(
      [makeMaster(), override],
      'master-1',
      {
        // 呼び出し規約どおり、occurrenceStart には本来の開始時刻（originalStart = 9:00 JST）を渡す
        occurrenceStart: new Date('2026-07-03T00:00:00Z'),
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
    expect(moved.start).toBe('2026-07-02');
    expect(moved.end).toBe('2026-07-03');
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

  it('allDay: true への変換で newEnd 省略時、変換前の長さ（26 時間）を引き継がずちょうど 1 日になる', () => {
    // 26 時間の時間指定イベント（allDay 変換前の実ミリ秒差をそのまま使うと 2 日にまたがってしまう）
    const timed: CalendarEvent = {
      id: 'timed-1',
      title: '長時間イベント',
      start: new Date('2026-07-01T00:00:00Z'),
      end: new Date('2026-07-02T02:00:00Z'), // 26 時間後
    };
    const result = moveOccurrenceIn(
      [timed],
      'timed-1',
      {
        occurrenceStart: new Date('2026-07-01T00:00:00Z'),
        newStart: new Date('2026-07-10T00:00:00Z'),
        allDay: true,
      },
      makeContext(),
    );
    const moved = findById(result, 'timed-1');
    expect(moved.allDay).toBe(true);
    expect(moved.start).toBe('2026-07-10');
    expect(moved.end).toBe('2026-07-11'); // ちょうど 1 暦日後（26 時間ではない）
  });

  it('allDay: false への変換で newEnd 省略時、変換前の長さ（3 日間）を引き継がず defaultEventMinutes になる', () => {
    // 3 日間の終日イベント（allDay 変換前の日数×24時間をそのまま使うと 3 日間の時間指定イベントになってしまう）
    const allDayEvent: CalendarEvent = {
      id: 'allday-3d',
      title: '3 日間の終日イベント',
      start: '2026-07-01',
      end: '2026-07-04',
      allDay: true,
    };
    const result = moveOccurrenceIn(
      [allDayEvent],
      'allday-3d',
      {
        occurrenceStart: new Date('2026-06-30T15:00:00Z'), // 東京 7/1 0:00
        newStart: new Date('2026-07-10T01:00:00Z'),
        allDay: false,
      },
      makeContext({ defaultEventMinutes: 45 }),
    );
    const moved = findById(result, 'allday-3d');
    expect(moved.allDay).toBe(false);
    expect(moved.start).toEqual(new Date('2026-07-10T01:00:00Z'));
    expect(moved.end).toEqual(new Date('2026-07-10T01:45:00Z')); // defaultEventMinutes（45 分）。3 日間ではない
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

describe('終日繰り返しの変更境界', () => {
  const auditRange = {
    start: new Date('2026-06-29T00:00:00Z'),
    end: new Date('2026-11-10T00:00:00Z'),
  };

  function occurrenceTitles(
    events: readonly CalendarEvent[],
    displayTimeZone: string,
  ): readonly [string, string][] {
    return expandEvents({
      events,
      range: auditRange,
      displayTimeZone,
      defaultEventMinutes: 60,
    }).map((occurrence) => [occurrence.start.toISOString(), occurrence.event.title]);
  }

  it('イベント TZ と表示 TZ が異なっても this 更新は対象の日付だけに作用する', () => {
    const master: CalendarEvent = {
      id: 'cross-zone-all-day',
      title: '変更前',
      start: '2026-07-01',
      end: '2026-07-02',
      allDay: true,
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=3',
    };
    // 東京 7/2 0:00。ニューヨークでは 7/1 11:00 だが、終日は東京表示上の
    // 日付キー 7/2 を対象として維持しなければならない。
    const target = new Date('2026-07-01T15:00:00Z');
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: target, scope: 'this' },
      makeContext({ displayTimeZone: TOKYO }),
    );

    expect(occurrenceTitles(result, TOKYO).slice(0, 3)).toEqual([
      ['2026-06-30T15:00:00.000Z', '変更前'],
      ['2026-07-01T15:00:00.000Z', '変更後'],
      ['2026-07-02T15:00:00.000Z', '変更前'],
    ]);
  });

  it('イベント TZ と表示 TZ が異なっても this 削除は対象の日付だけを除外する', () => {
    const master: CalendarEvent = {
      id: 'cross-zone-delete',
      title: '終日',
      start: '2026-07-01',
      end: '2026-07-02',
      allDay: true,
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=3',
    };
    const result = deleteEventIn(
      [master],
      master.id,
      { occurrenceStart: new Date('2026-07-01T15:00:00Z'), scope: 'this' },
      makeContext({ displayTimeZone: TOKYO }),
    );

    expect(occurrenceTitles(result, TOKYO).slice(0, 3)).toEqual([
      ['2026-06-30T15:00:00.000Z', '終日'],
      ['2026-07-02T15:00:00.000Z', '終日'],
    ]);
  });

  it('イベント TZ と表示 TZ が異なっても thisAndFollowing の分割日はずれない', () => {
    const master: CalendarEvent = {
      id: 'cross-zone-following',
      title: '変更前',
      start: '2026-07-01',
      end: '2026-07-02',
      allDay: true,
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=3',
    };
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      {
        occurrenceStart: new Date('2026-07-01T15:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeContext({ displayTimeZone: TOKYO }),
    );

    expect(occurrenceTitles(result, TOKYO).slice(0, 3)).toEqual([
      ['2026-06-30T15:00:00.000Z', '変更前'],
      ['2026-07-01T15:00:00.000Z', '変更後'],
      ['2026-07-02T15:00:00.000Z', '変更後'],
    ]);
  });

  it('イベント TZ と表示 TZ が異なる this 移動も対象の日付キーを維持する', () => {
    const master: CalendarEvent = {
      id: 'cross-zone-move',
      title: '終日',
      start: '2026-07-01',
      end: '2026-07-02',
      allDay: true,
      timeZone: NY,
      rrule: 'FREQ=DAILY;COUNT=3',
    };
    const result = moveOccurrenceIn(
      [master],
      master.id,
      {
        occurrenceStart: new Date('2026-07-01T15:00:00Z'),
        newStart: new Date('2026-07-04T15:00:00Z'),
        scope: 'this',
      },
      makeContext({ displayTimeZone: TOKYO }),
    );

    expect(
      occurrenceTitles(result, TOKYO)
        .slice(0, 3)
        .map(([start]) => start),
    ).toEqual(['2026-06-30T15:00:00.000Z', '2026-07-02T15:00:00.000Z', '2026-07-04T15:00:00.000Z']);
    const override = result.find((event) => event.recurringEventId === master.id);
    expect(override?.originalStart).toBe('2026-07-02');
    expect(override?.start).toBe('2026-07-05');
    expect(override?.end).toBe('2026-07-06');
  });

  it('DST 終了日の this 更新でも終日オカレンスが 1 暦日のまま残る', () => {
    const master: CalendarEvent = {
      id: 'dst-fall-all-day',
      title: '変更前',
      start: '2026-10-25',
      allDay: true,
      rrule: 'FREQ=WEEKLY;COUNT=3',
    };
    const target = new Date('2026-11-01T04:00:00Z'); // NY 11/1 0:00（25 時間の日）
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: target, scope: 'this' },
      makeContext({ displayTimeZone: NY }),
    );
    const occurrences = expandEvents({
      events: result,
      range: auditRange,
      displayTimeZone: NY,
      defaultEventMinutes: 60,
    });

    expect(occurrences).toHaveLength(3);
    const changed = occurrences.find((occurrence) => occurrence.event.title === '変更後');
    expect(changed?.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(changed?.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('DST 開始日の this 更新でも終日オカレンスが 1 暦日のまま残る', () => {
    const master: CalendarEvent = {
      id: 'dst-spring-all-day',
      title: '変更前',
      start: '2026-03-01',
      allDay: true,
      rrule: 'FREQ=WEEKLY;COUNT=3',
    };
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: new Date('2026-03-08T05:00:00Z'), scope: 'this' },
      makeContext({ displayTimeZone: NY }),
    );
    const occurrences = expandEvents({
      events: result,
      range: {
        start: new Date('2026-02-28T00:00:00Z'),
        end: new Date('2026-03-20T00:00:00Z'),
      },
      displayTimeZone: NY,
      defaultEventMinutes: 60,
    });

    expect(occurrences).toHaveLength(3);
    const changed = occurrences.find((occurrence) => occurrence.event.title === '変更後');
    expect(changed?.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(changed?.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('明示 end を持つ複数日の終日予定も DST 終了日に同じ暦日数を維持する', () => {
    const master: CalendarEvent = {
      id: 'dst-explicit-end',
      title: '変更前',
      start: '2026-10-25',
      end: '2026-10-27',
      allDay: true,
      rrule: 'FREQ=WEEKLY;COUNT=3',
    };
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: new Date('2026-11-01T04:00:00Z'), scope: 'this' },
      makeContext({ displayTimeZone: NY }),
    );
    const changed = expandEvents({
      events: result,
      range: auditRange,
      displayTimeZone: NY,
      defaultEventMinutes: 60,
    }).find((occurrence) => occurrence.event.title === '変更後');

    expect(changed?.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(changed?.end.toISOString()).toBe('2026-11-03T05:00:00.000Z');
  });

  it('DST 終了日の終日オカレンス移動で newEnd を省略しても 1 暦日を維持する', () => {
    const master: CalendarEvent = {
      id: 'dst-move',
      title: '終日',
      start: '2026-10-25',
      allDay: true,
      rrule: 'FREQ=WEEKLY;COUNT=3',
    };
    const result = moveOccurrenceIn(
      [master],
      master.id,
      {
        occurrenceStart: new Date('2026-11-01T04:00:00Z'),
        newStart: new Date('2026-11-03T05:00:00Z'),
        scope: 'this',
      },
      makeContext({ displayTimeZone: NY }),
    );
    const override = result.find((event) => event.recurringEventId === master.id);

    expect(override?.originalStart).toBe('2026-11-01');
    expect(override?.start).toBe('2026-11-03');
    expect(override?.end).toBe('2026-11-04');
  });
});

describe('rdates のみの繰り返しスコープ', () => {
  const master: CalendarEvent = {
    id: 'rdates-only',
    title: '変更前',
    start: '2026-07-01T09:00:00Z',
    end: '2026-07-01T10:00:00Z',
    rdates: ['2026-07-02T09:00:00Z', '2026-07-03T09:00:00Z'],
  };
  const context = makeContext({ displayTimeZone: 'UTC' });
  const range = {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-07-05T00:00:00Z'),
  };

  function expand(events: readonly CalendarEvent[]) {
    return expandEvents({ events, range, displayTimeZone: 'UTC', defaultEventMinutes: 60 });
  }

  it('this 更新は選択した RDATE オカレンスだけを変更する', () => {
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: new Date('2026-07-02T09:00:00Z'), scope: 'this' },
      context,
    );

    expect(expand(result).map((occurrence) => occurrence.event.title)).toEqual([
      '変更前',
      '変更後',
      '変更前',
    ]);
  });

  it('this 削除は選択した RDATE オカレンスだけを除外する', () => {
    const result = deleteEventIn(
      [master],
      master.id,
      { occurrenceStart: new Date('2026-07-02T09:00:00Z'), scope: 'this' },
      context,
    );

    expect(expand(result).map((occurrence) => occurrence.start.toISOString())).toEqual([
      '2026-07-01T09:00:00.000Z',
      '2026-07-03T09:00:00.000Z',
    ]);
  });

  it('thisAndFollowing 更新は RDATE 集合を前後のシリーズへ分割する', () => {
    const result = updateEventIn(
      [master],
      master.id,
      { title: '変更後' },
      { occurrenceStart: new Date('2026-07-02T09:00:00Z'), scope: 'thisAndFollowing' },
      context,
    );

    expect(
      expand(result).map((occurrence) => [occurrence.start.toISOString(), occurrence.event.title]),
    ).toEqual([
      ['2026-07-01T09:00:00.000Z', '変更前'],
      ['2026-07-02T09:00:00.000Z', '変更後'],
      ['2026-07-03T09:00:00.000Z', '変更後'],
    ]);
  });

  it('thisAndFollowing 削除は分割点より前のオカレンスだけを残す', () => {
    const result = deleteEventIn(
      [master],
      master.id,
      { occurrenceStart: new Date('2026-07-02T09:00:00Z'), scope: 'thisAndFollowing' },
      context,
    );

    expect(expand(result).map((occurrence) => occurrence.start.toISOString())).toEqual([
      '2026-07-01T09:00:00.000Z',
    ]);
  });

  it('moveOccurrenceIn は scope を要求し、this で選択した RDATE だけを移動する', () => {
    expect(() =>
      moveOccurrenceIn(
        [master],
        master.id,
        {
          occurrenceStart: new Date('2026-07-02T09:00:00Z'),
          newStart: new Date('2026-07-02T11:00:00Z'),
        },
        context,
      ),
    ).toThrow('scope');

    const result = moveOccurrenceIn(
      [master],
      master.id,
      {
        occurrenceStart: new Date('2026-07-02T09:00:00Z'),
        newStart: new Date('2026-07-02T11:00:00Z'),
        scope: 'this',
      },
      context,
    );
    expect(expand(result).map((occurrence) => occurrence.start.toISOString())).toEqual([
      '2026-07-01T09:00:00.000Z',
      '2026-07-02T11:00:00.000Z',
      '2026-07-03T09:00:00.000Z',
    ]);
  });
});

describe('終日シリーズの分割データ移送', () => {
  const makeAllDayContext = (): MutationContext => makeContext({ displayTimeZone: TOKYO });

  it('RRULE の thisAndFollowing 更新で EXDATE・RDATE・オーバーライドを前後へ振り分ける', () => {
    const master: CalendarEvent = {
      id: 'all-day-rrule-split',
      title: '変更前',
      start: '2026-07-01',
      end: '2026-07-03',
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=5',
      exdates: ['2026-07-02', '2026-07-04'],
      rdates: ['2026-06-30', '2026-07-06'],
    };
    const beforeOverride: CalendarEvent = {
      id: 'before-override',
      title: '前',
      start: '2026-07-02',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-02',
    };
    const afterOverride: CalendarEvent = {
      id: 'after-override',
      title: '後',
      start: '2026-07-04',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-04',
    };
    const unrelated: CalendarEvent = {
      id: 'unrelated',
      title: '無関係',
      start: '2026-07-01',
      allDay: true,
    };
    const result = updateEventIn(
      [master, beforeOverride, afterOverride, unrelated],
      master.id,
      { title: '変更後' },
      {
        occurrenceStart: new Date('2026-07-02T15:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeAllDayContext(),
    );

    const oldMaster = findById(result, master.id);
    const newMaster = findById(result, 'gen-1');
    expect(oldMaster.exdates).toEqual(['2026-07-02']);
    expect(oldMaster.rdates).toEqual(['2026-06-30']);
    expect(newMaster).toMatchObject({
      title: '変更後',
      start: '2026-07-03',
      end: '2026-07-05',
      exdates: ['2026-07-04'],
      rdates: ['2026-07-06'],
    });
    expect(findById(result, beforeOverride.id).recurringEventId).toBe(master.id);
    expect(findById(result, afterOverride.id).recurringEventId).toBe('gen-1');
    expect(findById(result, unrelated.id)).toEqual(unrelated);
  });

  it('RRULE の thisAndFollowing 削除で分割点以降の付随データだけを除く', () => {
    const master: CalendarEvent = {
      id: 'all-day-rrule-truncate',
      title: '終日',
      start: '2026-07-01',
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=5',
      exdates: ['2026-07-02', '2026-07-04'],
      rdates: ['2026-06-30', '2026-07-06'],
    };
    const beforeOverride: CalendarEvent = {
      id: 'kept-override',
      title: '前',
      start: '2026-07-02',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-02',
    };
    const afterOverride: CalendarEvent = {
      id: 'removed-override',
      title: '後',
      start: '2026-07-04',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-04',
    };
    const unrelated: CalendarEvent = {
      id: 'truncate-unrelated',
      title: '無関係',
      start: '2026-07-01',
    };
    const result = deleteEventIn(
      [master, beforeOverride, afterOverride, unrelated],
      master.id,
      {
        occurrenceStart: new Date('2026-07-02T15:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeAllDayContext(),
    );

    expect(findById(result, master.id).exdates).toEqual(['2026-07-02']);
    expect(findById(result, master.id).rdates).toEqual(['2026-06-30']);
    expect(result.map((event) => event.id)).toEqual([master.id, beforeOverride.id, unrelated.id]);
  });

  it('RRULE の先頭から thisAndFollowing 削除するとマスターとオーバーライドを削除する', () => {
    const master: CalendarEvent = {
      id: 'all-day-delete-first',
      title: '終日',
      start: '2026-07-01',
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=2',
    };
    const override: CalendarEvent = {
      id: 'first-override',
      title: '変更',
      start: '2026-07-02',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-02',
    };
    const unrelated: CalendarEvent = { id: 'first-unrelated', title: '残る', start: '2026-07-01' };

    expect(
      deleteEventIn(
        [master, override, unrelated],
        master.id,
        {
          occurrenceStart: new Date('2026-06-30T15:00:00Z'),
          scope: 'thisAndFollowing',
        },
        makeAllDayContext(),
      ),
    ).toEqual([unrelated]);
  });

  it('終日 RDATE-only の thisAndFollowing 更新で日数と付随データを維持する', () => {
    const master: CalendarEvent = {
      id: 'all-day-rdates-split',
      title: '変更前',
      start: '2026-07-01',
      end: '2026-07-03',
      allDay: true,
      rdates: ['2026-07-03', '2026-07-05'],
      exdates: ['2026-07-02', '2026-07-04'],
    };
    const beforeOverride: CalendarEvent = {
      id: 'rdate-before',
      title: '前',
      start: '2026-07-02',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-02',
    };
    const afterOverride: CalendarEvent = {
      id: 'rdate-after',
      title: '後',
      start: '2026-07-05',
      allDay: true,
      recurringEventId: master.id,
      originalStart: new Date('2026-07-04T15:00:00Z'),
    };
    const unrelated: CalendarEvent = {
      id: 'rdate-unrelated',
      title: '無関係',
      start: '2026-07-01',
    };
    const result = updateEventIn(
      [master, beforeOverride, afterOverride, unrelated],
      master.id,
      { title: '変更後' },
      {
        occurrenceStart: new Date('2026-07-02T15:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeAllDayContext(),
    );

    expect(findById(result, master.id)).toMatchObject({
      exdates: ['2026-07-02'],
    });
    expect(findById(result, master.id).rdates).toBeUndefined();
    expect(findById(result, 'gen-1')).toMatchObject({
      title: '変更後',
      start: '2026-07-03',
      end: '2026-07-05',
      exdates: ['2026-07-04'],
      rdates: ['2026-07-05'],
    });
    expect(findById(result, beforeOverride.id).recurringEventId).toBe(master.id);
    expect(findById(result, afterOverride.id).recurringEventId).toBe('gen-1');
    expect(findById(result, unrelated.id)).toEqual(unrelated);
  });

  it('終日 RDATE-only の thisAndFollowing 削除で分割点より前だけを残す', () => {
    const master: CalendarEvent = {
      id: 'all-day-rdates-truncate',
      title: '終日',
      start: '2026-07-01',
      allDay: true,
      rdates: ['2026-07-03', '2026-07-05'],
      exdates: ['2026-07-02', '2026-07-04'],
    };
    const beforeOverride: CalendarEvent = {
      id: 'rdate-kept',
      title: '前',
      start: '2026-07-02',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-02',
    };
    const afterOverride: CalendarEvent = {
      id: 'rdate-removed',
      title: '後',
      start: '2026-07-05',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-05',
    };
    const unrelated: CalendarEvent = {
      id: 'rdate-truncate-unrelated',
      title: '残る',
      start: '2026-07-01',
    };
    const result = deleteEventIn(
      [master, beforeOverride, afterOverride, unrelated],
      master.id,
      {
        occurrenceStart: new Date('2026-07-02T15:00:00Z'),
        scope: 'thisAndFollowing',
      },
      makeAllDayContext(),
    );

    expect(findById(result, master.id).exdates).toEqual(['2026-07-02']);
    expect(findById(result, master.id).rdates).toBeUndefined();
    expect(result.map((event) => event.id)).toEqual([master.id, beforeOverride.id, unrelated.id]);
  });

  it('終日 RDATE-only の先頭から thisAndFollowing 削除すると関連イベントを全削除する', () => {
    const master: CalendarEvent = {
      id: 'all-day-rdates-first',
      title: '終日',
      start: '2026-07-01',
      allDay: true,
      rdates: ['2026-07-03'],
    };
    const override: CalendarEvent = {
      id: 'rdates-first-override',
      title: '変更',
      start: '2026-07-03',
      allDay: true,
      recurringEventId: master.id,
      originalStart: '2026-07-03',
    };

    expect(
      deleteEventIn(
        [master, override],
        master.id,
        {
          occurrenceStart: new Date('2026-06-30T15:00:00Z'),
          scope: 'thisAndFollowing',
        },
        makeAllDayContext(),
      ),
    ).toEqual([]);
  });

  it('既存終日オーバーライドは originalStart の Date・文字列・欠落を照合できる', () => {
    const master: CalendarEvent = {
      id: 'anchor-master',
      title: '終日',
      start: '2026-07-01',
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=4',
    };
    const cases: readonly CalendarEvent[] = [
      {
        id: 'anchor-date',
        title: 'Date',
        start: '2026-07-02',
        allDay: true,
        recurringEventId: master.id,
        originalStart: new Date('2026-07-01T15:00:00Z'),
      },
      {
        id: 'anchor-string',
        title: '文字列',
        start: '2026-07-03',
        allDay: true,
        recurringEventId: master.id,
        originalStart: '2026-07-03',
      },
      {
        id: 'anchor-start',
        title: 'start',
        start: '2026-07-04',
        allDay: true,
        recurringEventId: master.id,
      },
    ];

    for (const [index, override] of cases.entries()) {
      const day = index + 2;
      const result = updateEventIn(
        [master, ...cases],
        master.id,
        { title: `更新${day}` },
        {
          occurrenceStart: new Date(`2026-07-0${day - 1}T15:00:00Z`),
          scope: 'this',
        },
        makeAllDayContext(),
      );
      expect(findById(result, override.id).title).toBe(`更新${day}`);
    }
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

describe('before/after スナップショット（undo 基盤）', () => {
  /** イベント配列を id をキーにした Record に変換する（順序に依存しない比較のため）。 */
  function byId(events: readonly CalendarEvent[]): Record<string, CalendarEvent> {
    return Object.fromEntries(events.map((event) => [event.id, event]));
  }

  /**
   * 変更後のイベント配列と changes から、変更前の状態（id → イベント）を復元する。
   * 新規作成されたイベント（`before` なし）は復元後の状態に含めない。
   */
  function reconstructBefore(
    after: readonly CalendarEvent[],
    changes: readonly EventChangeEntry[],
  ): Record<string, CalendarEvent> {
    const map = byId(after);
    for (const change of changes) {
      if (change.after !== undefined) {
        delete map[change.after.id];
      }
    }
    for (const change of changes) {
      if (change.before !== undefined) {
        map[change.before.id] = change.before;
      }
    }
    return map;
  }

  /**
   * 変更前のイベント配列と changes から、変更後の状態（id → イベント）を復元する。
   * 削除されたイベント（`after` なし）は復元後の状態に含めない。
   */
  function reconstructAfter(
    before: readonly CalendarEvent[],
    changes: readonly EventChangeEntry[],
  ): Record<string, CalendarEvent> {
    const map = byId(before);
    for (const change of changes) {
      if (change.before !== undefined && change.after === undefined) {
        delete map[change.before.id];
      }
    }
    for (const change of changes) {
      if (change.after !== undefined) {
        map[change.after.id] = change.after;
      }
    }
    return map;
  }

  describe('updateEventInWithChanges: 単発イベントの移動', () => {
    it('before/after 1 件のみが含まれ、双方向に状態を完全に復元できる', () => {
      const single: CalendarEvent = {
        id: 'single-1',
        title: '歯医者',
        start: new Date('2026-07-01T05:00:00Z'),
        end: new Date('2026-07-01T06:00:00Z'),
      };
      const result = updateEventInWithChanges(
        [single],
        'single-1',
        { start: new Date('2026-07-02T05:00:00Z'), end: new Date('2026-07-02T06:00:00Z') },
        undefined,
        makeContext(),
      );
      expect(result.changes).toEqual([
        { before: single, after: findById(result.events, 'single-1'), index: 0 },
      ]);
      expect(reconstructAfter([single], result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId([single]));
    });
  });

  describe("updateEventInWithChanges: scope 'this'（オーバーライド作成）", () => {
    it('作成されたオーバーライドのみが changes に含まれ（before なし）、マスターは含まれない', () => {
      const master = makeMaster();
      const occurrenceStart = new Date('2026-07-03T00:00:00Z');
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        { title: '臨時' },
        { occurrenceStart, scope: 'this' },
        makeContext(),
      );
      // 新規作成のみのエントリの index は変更後の一覧内での位置（[master, gen-1] の 1）
      expect(result.changes).toEqual([{ after: findById(result.events, 'gen-1'), index: 1 }]);
      expect(reconstructAfter([master], result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId([master]));
    });
  });

  describe("updateEventInWithChanges: scope 'thisAndFollowing'（シリーズ分割）", () => {
    it('旧マスター（変更）・新シリーズ（作成）・分割点以降のオーバーライド（付け替え）が漏れなく changes に含まれる', () => {
      const beforeSplit = makeOverride({
        id: 'ov-2',
        start: new Date('2026-07-02T02:00:00Z'),
        end: new Date('2026-07-02T03:00:00Z'),
        originalStart: new Date('2026-07-02T00:00:00Z'),
      });
      const afterSplit = makeOverride({
        id: 'ov-5',
        start: new Date('2026-07-05T02:00:00Z'),
        end: new Date('2026-07-05T03:00:00Z'),
        originalStart: new Date('2026-07-05T00:00:00Z'),
      });
      const master = makeMaster();
      const events = [master, beforeSplit, afterSplit];
      const splitPoint = new Date('2026-07-04T00:00:00Z');
      const result = updateEventInWithChanges(
        events,
        'master-1',
        { title: '新シリーズ' },
        { occurrenceStart: splitPoint, scope: 'thisAndFollowing' },
        makeContext(),
      );

      // 旧マスター（変更）・新シリーズ（作成）・ov-5（recurringEventId 付け替え）の 3 件のみ
      expect(result.changes).toHaveLength(3);
      const byChangeId = (id: string) =>
        result.changes.find((change) => (change.before ?? change.after)?.id === id);
      // before があるエントリの index は元の配列（[master, ov-2, ov-5]）内での位置
      expect(byChangeId('master-1')).toEqual({
        before: master,
        after: findById(result.events, 'master-1'),
        index: 0,
      });
      // 新規作成のみのエントリの index は変更後の配列（[master-1, ov-2, ov-5, gen-1]）内での位置
      expect(byChangeId('gen-1')).toEqual({ after: findById(result.events, 'gen-1'), index: 3 });
      expect(byChangeId('ov-5')).toEqual({
        before: afterSplit,
        after: findById(result.events, 'ov-5'),
        index: 2,
      });
      // 分割点より前の ov-2 は付け替えの対象外なので changes に含まれない
      expect(byChangeId('ov-2')).toBeUndefined();

      expect(reconstructAfter(events, result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId(events));
    });
  });

  describe("updateEventInWithChanges: scope 'all'", () => {
    it('マスターの before/after のみが changes に含まれ、既存のオーバーライドは含まれない', () => {
      const master = makeMaster();
      const override = makeOverride();
      const events = [master, override];
      const result = updateEventInWithChanges(
        events,
        'master-1',
        { title: '全体変更' },
        { occurrenceStart: new Date('2026-07-03T00:00:00Z'), scope: 'all' },
        makeContext(),
      );
      expect(result.changes).toEqual([
        { before: master, after: findById(result.events, 'master-1'), index: 0 },
      ]);
      expect(reconstructAfter(events, result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId(events));
    });
  });

  describe('deleteEventInWithChanges: 単発イベント', () => {
    it('削除されたイベントのみが before のみで changes に含まれる', () => {
      const single: CalendarEvent = {
        id: 'single-1',
        title: '歯医者',
        start: new Date('2026-07-01T05:00:00Z'),
      };
      const result = deleteEventInWithChanges([single], 'single-1', undefined, makeContext());
      expect(result.changes).toEqual([{ before: single, index: 0 }]);
      expect(reconstructAfter([single], result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId([single]));
    });
  });

  describe("deleteEventInWithChanges: scope 'this'", () => {
    it('未オーバーライドのオカレンス削除は、マスターの before/after（EXDATE 追加）のみが changes に含まれる', () => {
      const master = makeMaster();
      const occ = new Date('2026-07-05T00:00:00Z');
      const result = deleteEventInWithChanges(
        [master],
        'master-1',
        { occurrenceStart: occ, scope: 'this' },
        makeContext(),
      );
      expect(result.changes).toEqual([
        { before: master, after: findById(result.events, 'master-1'), index: 0 },
      ]);
      expect(reconstructAfter([master], result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId([master]));
    });

    it('オーバーライド済みのオカレンス削除は、オーバーライド除去（before のみ）とマスターの EXDATE 追加（before/after）の 2 件が changes に含まれる', () => {
      const master = makeMaster();
      const override = makeOverride();
      const events = [master, override];
      const result = deleteEventInWithChanges(
        events,
        'ov-3',
        { occurrenceStart: new Date('2026-07-03T02:00:00Z'), scope: 'this' },
        makeContext(),
      );
      expect(result.changes).toHaveLength(2);
      const byChangeId = (id: string) =>
        result.changes.find((change) => (change.before ?? change.after)?.id === id);
      // index は元の配列（[master, override]）内での位置
      expect(byChangeId('ov-3')).toEqual({ before: override, index: 1 });
      expect(byChangeId('master-1')).toEqual({
        before: master,
        after: findById(result.events, 'master-1'),
        index: 0,
      });
      expect(reconstructAfter(events, result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId(events));
    });
  });

  describe("deleteEventInWithChanges: scope 'thisAndFollowing'", () => {
    it('マスターの打ち切り（before/after）と分割点以降のオーバーライド除去（before のみ）が漏れなく changes に含まれる', () => {
      const master = makeMaster();
      const atBoundary = makeOverride({
        id: 'ov-4',
        start: new Date('2026-07-04T02:00:00Z'),
        originalStart: new Date('2026-07-04T00:00:00Z'),
      });
      const beforeBoundary = makeOverride({
        id: 'ov-2',
        start: new Date('2026-07-02T02:00:00Z'),
        originalStart: new Date('2026-07-02T00:00:00Z'),
      });
      const events = [master, atBoundary, beforeBoundary];
      const result = deleteEventInWithChanges(
        events,
        'master-1',
        { occurrenceStart: new Date('2026-07-04T00:00:00Z'), scope: 'thisAndFollowing' },
        makeContext(),
      );
      expect(result.changes).toHaveLength(2);
      const byChangeId = (id: string) =>
        result.changes.find((change) => (change.before ?? change.after)?.id === id);
      // index は元の配列（[master, atBoundary, beforeBoundary]）内での位置
      expect(byChangeId('master-1')).toEqual({
        before: master,
        after: findById(result.events, 'master-1'),
        index: 0,
      });
      expect(byChangeId('ov-4')).toEqual({ before: atBoundary, index: 1 });
      // 分割点より前の ov-2 は変更されないので changes に含まれない
      expect(byChangeId('ov-2')).toBeUndefined();
      expect(reconstructAfter(events, result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId(events));
    });
  });

  describe("deleteEventInWithChanges: scope 'all'", () => {
    it('マスターとそれを参照するすべてのオーバーライドが before のみで changes に含まれる', () => {
      const master = makeMaster();
      const override = makeOverride();
      const events = [master, override];
      const result = deleteEventInWithChanges(
        events,
        'master-1',
        { occurrenceStart: new Date('2026-07-05T00:00:00Z'), scope: 'all' },
        makeContext(),
      );
      expect(result.events).toEqual([]);
      expect(result.changes).toHaveLength(2);
      const byChangeId = (id: string) =>
        result.changes.find((change) => (change.before ?? change.after)?.id === id);
      // index は元の配列（[master, override]）内での位置
      expect(byChangeId('master-1')).toEqual({ before: master, index: 0 });
      expect(byChangeId('ov-3')).toEqual({ before: override, index: 1 });
      expect(reconstructAfter(events, result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId(events));
    });
  });

  describe('moveOccurrenceInWithChanges', () => {
    it("繰り返しの 'this' 移動でオーバーライドが作成され、changes にはオーバーライドのみ（before なし）が含まれる", () => {
      const master = makeMaster();
      const occ = new Date('2026-07-03T00:00:00Z');
      const result = moveOccurrenceInWithChanges(
        [master],
        'master-1',
        { occurrenceStart: occ, newStart: new Date('2026-07-03T06:00:00Z'), scope: 'this' },
        makeContext(),
      );
      // 新規作成のみのエントリの index は変更後の一覧内での位置（[master, gen-1] の 1）
      expect(result.changes).toEqual([{ after: findById(result.events, 'gen-1'), index: 1 }]);
      expect(reconstructAfter([master], result.changes)).toEqual(byId(result.events));
      expect(reconstructBefore(result.events, result.changes)).toEqual(byId([master]));
    });
  });

  describe('updateEventInWithChanges: 値として無変化のパッチ', () => {
    it('空パッチ（{}）を適用しても changes は空になる（applyPatch が新しい参照を返しても値は同一）', () => {
      const single: CalendarEvent = {
        id: 'single-1',
        title: '歯医者',
        start: new Date('2026-07-01T05:00:00Z'),
        end: new Date('2026-07-01T06:00:00Z'),
      };
      const result = updateEventInWithChanges([single], 'single-1', {}, undefined, makeContext());
      expect(result.changes).toEqual([]);
    });

    it('既存の値と同じ値を明示的に指定したパッチでも changes は空になる（extendedProps・exdates 等の構造比較を含む）', () => {
      const master = makeMaster({ exdates: [new Date('2026-07-05T00:00:00Z')] });
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        {
          title: master.title,
          color: master.color,
          // 同じ内容だが別参照の Date / 配列 / オブジェクトを明示的に指定する
          exdates: [new Date('2026-07-05T00:00:00Z')],
          extendedProps: { team: 'dev' },
        },
        undefined,
        makeContext(),
      );
      expect(result.changes).toEqual([]);
    });

    it('exdates が同じ集合で並び順だけ異なるパッチは「無変化」と判定され changes は空になる', () => {
      const master = makeMaster({
        exdates: [new Date('2026-07-05T00:00:00Z'), new Date('2026-07-12T00:00:00Z')],
      });
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        // 同じ 2 日付を逆順で指定する（exdates は概念上は日付の集合であり、順序に意味はない）
        { exdates: [new Date('2026-07-12T00:00:00Z'), new Date('2026-07-05T00:00:00Z')] },
        undefined,
        makeContext(),
      );
      expect(result.changes).toEqual([]);
    });

    it('rdates が同じ集合で並び順だけ異なるパッチも「無変化」と判定される', () => {
      const master = makeMaster({
        rdates: [new Date('2026-07-06T00:00:00Z'), new Date('2026-07-13T00:00:00Z')],
      });
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        { rdates: [new Date('2026-07-13T00:00:00Z'), new Date('2026-07-06T00:00:00Z')] },
        undefined,
        makeContext(),
      );
      expect(result.changes).toEqual([]);
    });

    it('exdates の集合として実際に異なるパッチは changes に含まれる', () => {
      const master = makeMaster({ exdates: [new Date('2026-07-05T00:00:00Z')] });
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        { exdates: [new Date('2026-07-19T00:00:00Z')] },
        undefined,
        makeContext(),
      );
      expect(result.changes).toHaveLength(1);
    });

    it('実際に値が変わるフィールドが 1 つでもあれば、通常どおり changes に含まれる', () => {
      const master = makeMaster();
      const result = updateEventInWithChanges(
        [master],
        'master-1',
        { title: master.title, color: '#000000' },
        undefined,
        makeContext(),
      );
      expect(result.changes).toEqual([
        { before: master, after: findById(result.events, 'master-1'), index: 0 },
      ]);
    });
  });
});

describe('applyEventChangeEntries', () => {
  /** テスト用の最小イベント。 */
  function ev(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      id,
      title: `イベント${id}`,
      start: new Date('2026-07-01T00:00:00Z'),
      ...overrides,
    };
  }

  it("'before' 方向で after のみ（作成）のエントリを適用すると対象 id を削除する", () => {
    const created = ev('a');
    const events = [ev('x'), created];
    const result = applyEventChangeEntries(events, [{ after: created }], 'before');
    expect(result.map((event) => event.id)).toEqual(['x']);
  });

  it("'before' 方向で before のみ（削除）のエントリを適用すると対象 id を before の内容で復元する", () => {
    const deleted = ev('a', { title: '元のタイトル' });
    const events = [ev('x')];
    const result = applyEventChangeEntries(events, [{ before: deleted }], 'before');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(deleted);
  });

  it("'before' 方向で before/after 両方（更新）のエントリを適用すると before の内容に戻す", () => {
    const before = ev('a', { title: '変更前' });
    const after = ev('a', { title: '変更後' });
    const result = applyEventChangeEntries([after], [{ before, after }], 'before');
    expect(result).toEqual([before]);
  });

  it("'after' 方向では 3 パターンが対称に動作する（作成の再現・削除の再現・after への変更）", () => {
    // 作成の再現: before なし・after ありのエントリを 'after' で適用すると作成される
    const created = ev('a');
    expect(applyEventChangeEntries([], [{ after: created }], 'after')).toEqual([created]);

    // 削除の再現: before あり・after なしのエントリを 'after' で適用すると削除される
    const deleted = ev('b');
    expect(applyEventChangeEntries([deleted], [{ before: deleted }], 'after')).toEqual([]);

    // 変更の適用: before/after 両方のエントリを 'after' で適用すると after の内容になる
    const changeBefore = ev('c', { title: '変更前' });
    const changeAfter = ev('c', { title: '変更後' });
    expect(
      applyEventChangeEntries(
        [changeBefore],
        [{ before: changeBefore, after: changeAfter }],
        'after',
      ),
    ).toEqual([changeAfter]);
  });

  it("ドリフト検出: 'before' 適用時、期待する現在値（after）に対応する id が現在の一覧に存在しない場合はそのエントリをスキップし、他のイベントには影響しない", () => {
    // id 'a' は外部要因で既に一覧から消えている想定（期待する現在値 after が存在しない）
    const missingBefore = ev('a', { title: 'a-変更前' });
    const missingAfter = ev('a', { title: 'a-変更後' });
    const presentBefore = ev('b', { title: 'b-変更前' });
    const presentAfter = ev('b', { title: 'b-変更後' });
    const events = [presentAfter];

    const result = applyEventChangeEntries(
      events,
      [
        { before: missingBefore, after: missingAfter },
        { before: presentBefore, after: presentAfter },
      ],
      'before',
    );

    // id 'a' のエントリはスキップされ、events に存在しないまま（誤って作成されない）
    expect(result.some((event) => event.id === 'a')).toBe(false);
    // id 'b' のエントリは正しく before の内容に戻る
    expect(result).toEqual([presentBefore]);
  });

  it("ドリフト検出: 'before' 適用時、削除の取り消し（before のみ）のエントリで、本来存在しないはずの id が別内容で既に存在する場合は上書きせずスキップする", () => {
    const originalDeleted = ev('a', { title: '元のタイトル' });
    // id 'a' が外部要因で別内容として再利用されている想定（想定外に存在している）
    const unexpectedCurrent = ev('a', { title: '別内容（外部要因で再利用された id）' });

    const result = applyEventChangeEntries(
      [unexpectedCurrent],
      [{ before: originalDeleted }],
      'before',
    );

    // 復元（上書き）されず、現在の内容がそのまま残る
    expect(result).toEqual([unexpectedCurrent]);
  });

  it("複数エントリ（3 件以上）を一括で 'before' 方向に適用すると影響を受けた全イベントが一括で元に戻る", () => {
    const changes: EventChangeEntry[] = [
      { before: ev('a', { title: 'a-変更前' }), after: ev('a', { title: 'a-変更後' }) },
      { after: ev('b', { title: 'b-新規' }) },
      { before: ev('c', { title: 'c-削除前' }) },
    ];
    const events = [
      ev('a', { title: 'a-変更後' }),
      ev('b', { title: 'b-新規' }),
      ev('z', { title: '無関係' }),
    ];

    const result = applyEventChangeEntries(events, changes, 'before');
    const byId = new Map(result.map((event) => [event.id, event]));

    expect(byId.get('a')?.title).toBe('a-変更前');
    expect(byId.has('b')).toBe(false);
    expect(byId.get('c')?.title).toBe('c-削除前');
    expect(byId.get('z')?.title).toBe('無関係');
  });

  it('入力の events 配列・各 CalendarEvent オブジェクトを変更しない（参照比較で確認）', () => {
    const untouched = ev('z');
    const changedAfter = ev('a', { title: '変更後' });
    const events = [untouched, changedAfter];
    const before = structuredClone(events);

    applyEventChangeEntries(
      events,
      [{ before: ev('a', { title: '変更前' }), after: changedAfter }],
      'before',
    );

    expect(events).toEqual(before);
    expect(events[0]).toBe(untouched);
    expect(events[1]).toBe(changedAfter);
  });

  describe('index による挿入位置の復元', () => {
    it("削除の取り消し（'before' 方向）は index の位置（元の配列内での位置）に復元する", () => {
      const a = ev('a');
      const b = ev('b', { title: '元のタイトル' });
      const c = ev('c');
      // [a, b, c] から b（index 1）を削除した後の一覧が [a, c] という想定
      const result = applyEventChangeEntries([a, c], [{ before: b, index: 1 }], 'before');
      expect(result).toEqual([a, b, c]);
    });

    it('先頭・末尾の削除も、それぞれ index 0・末尾へ復元する', () => {
      const a = ev('a');
      const b = ev('b');
      const c = ev('c');
      expect(applyEventChangeEntries([b, c], [{ before: a, index: 0 }], 'before')).toEqual([
        a,
        b,
        c,
      ]);
      expect(applyEventChangeEntries([a, b], [{ before: c, index: 2 }], 'before')).toEqual([
        a,
        b,
        c,
      ]);
    });

    it('複数の削除（シリーズ分割相当）を index 昇順に処理し、元の並び順を安定して復元する', () => {
      const a = ev('a');
      const b = ev('b');
      const c = ev('c');
      const d = ev('d');
      // [a, b, c, d] から b（index 1）・c（index 2）をまとめて削除した想定。
      // changes の記載順序を意図的に入れ替えても、index 昇順で処理されるため結果は変わらない
      const result = applyEventChangeEntries(
        [a, d],
        [
          { before: c, index: 2 },
          { before: b, index: 1 },
        ],
        'before',
      );
      expect(result).toEqual([a, b, c, d]);
    });

    it("作成のやり直し（'after' 方向）も index の位置（変更後の配列内での位置）に復元する", () => {
      const a = ev('a');
      const b = ev('b');
      const c = ev('c');
      // [a, b, c] で b（index 1）が新規作成されたエントリの再現
      const result = applyEventChangeEntries([a, c], [{ after: b, index: 1 }], 'after');
      expect(result).toEqual([a, b, c]);
    });

    it('index を省略した挿入エントリは末尾に追加される（後方互換）', () => {
      const a = ev('a');
      const b = ev('b');
      expect(applyEventChangeEntries([a], [{ after: b }], 'after')).toEqual([a, b]);
    });

    it('index が現在の要素数以上の場合は末尾にクランプされる', () => {
      const a = ev('a');
      const b = ev('b');
      const result = applyEventChangeEntries([a], [{ before: b, index: 99 }], 'before');
      expect(result).toEqual([a, b]);
    });

    it('既存 id への書き込み（更新）は index の指定にかかわらず元の位置を維持する', () => {
      const a = ev('a', { title: '変更前' });
      const b = ev('b');
      const updatedA = ev('a', { title: '変更後' });
      const result = applyEventChangeEntries(
        [a, b],
        [{ before: a, after: updatedA, index: 99 }],
        'after',
      );
      expect(result).toEqual([updatedA, b]);
    });
  });
});

describe('applyEventChangeEntriesWithApplied', () => {
  /** テスト用の最小イベント。 */
  function ev(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      id,
      title: `イベント${id}`,
      start: new Date('2026-07-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('全エントリが適用された場合、applied に changes と同じ内容が含まれ、events は applyEventChangeEntries と同じ結果になる', () => {
    const before = ev('a', { title: '変更前' });
    const after = ev('a', { title: '変更後' });
    const changes: EventChangeEntry[] = [{ before, after }];
    const result = applyEventChangeEntriesWithApplied([after], changes, 'before');
    expect(result.applied).toEqual(changes);
    expect(result.events).toEqual(applyEventChangeEntries([after], changes, 'before'));
  });

  it('一部エントリがドリフトによりスキップされた場合、applied には適用できたエントリのみが含まれる', () => {
    const missingBefore = ev('a', { title: 'a-変更前' });
    const missingAfter = ev('a', { title: 'a-変更後' });
    const presentBefore = ev('b', { title: 'b-変更前' });
    const presentAfter = ev('b', { title: 'b-変更後' });
    const changes: EventChangeEntry[] = [
      { before: missingBefore, after: missingAfter },
      { before: presentBefore, after: presentAfter },
    ];

    const result = applyEventChangeEntriesWithApplied([presentAfter], changes, 'before');

    expect(result.applied).toEqual([{ before: presentBefore, after: presentAfter }]);
    expect(result.events).toEqual([presentBefore]);
  });

  it('全エントリがドリフトによりスキップされた場合、applied は空配列になり events は変化しない', () => {
    const missingBefore = ev('a', { title: 'a-変更前' });
    const missingAfter = ev('a', { title: 'a-変更後' });
    const events = [ev('z')];

    const result = applyEventChangeEntriesWithApplied(
      events,
      [{ before: missingBefore, after: missingAfter }],
      'before',
    );

    expect(result.applied).toEqual([]);
    expect(result.events).toEqual(events);
  });

  it('削除を適用したエントリの applied には、記録時の index ではなく削除直前の実際の位置が入る（部分ドリフト後の逆適用で並び順を復元するため）', () => {
    const a = ev('a');
    const b = ev('b');
    // 記録時は [a, b, c] だったが、外部同期で a が消えて [b, c] になっている想定。
    // b の記録時 index は 1 だが、削除直前の実際の位置は 0
    const changes: EventChangeEntry[] = [
      { after: a, index: 0 },
      { after: b, index: 1 },
    ];

    const result = applyEventChangeEntriesWithApplied([b, ev('c')], changes, 'before');

    expect(result.events).toEqual([ev('c')]);
    expect(result.applied).toEqual([{ after: b, index: 0 }]);
  });

  it('挿入を適用したエントリの applied には、記録時の index ではなく挿入後の実際の位置が入る（クランプされた場合の往復を安定させるため）', () => {
    const b = ev('b');
    // 記録時 index 5 は現在の要素数を超えるため末尾（位置 1）へクランプされる
    const result = applyEventChangeEntriesWithApplied([ev('c')], [{ after: b, index: 5 }], 'after');

    expect(result.events).toEqual([ev('c'), b]);
    expect(result.applied).toEqual([{ after: b, index: 1 }]);
  });
});

describe('buildOccurrenceCopy', () => {
  it('単発イベントのコピーは id を持たず、他のフィールドをそのまま引き継ぐ（元イベントは変更しない）', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '打ち合わせ',
      start: new Date('2026-07-01T05:00:00Z'),
      end: new Date('2026-07-01T06:00:00Z'),
      timeZone: TOKYO,
      color: '#ef4444',
      location: '会議室B',
      description: '単発の予定',
      resourceId: 'room-a',
      extendedProps: { team: 'sales' },
    };
    const events = [single];
    const copy = buildOccurrenceCopy(events, 'single-1', {}, makeContext());
    expect(copy).toEqual({
      title: '打ち合わせ',
      start: new Date('2026-07-01T05:00:00Z'),
      end: new Date('2026-07-01T06:00:00Z'),
      timeZone: TOKYO,
      color: '#ef4444',
      location: '会議室B',
      description: '単発の予定',
      resourceId: 'room-a',
      extendedProps: { team: 'sales' },
    });
    expect('id' in copy).toBe(false);
    expect(events[0]).toEqual(single); // 純粋関数（入力は変更しない）
  });

  it('繰り返しマスター + occurrenceStart のコピーは、当該オカレンスを単発化する（rrule を引き継がない）', () => {
    const copy = buildOccurrenceCopy(
      [makeMaster()],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z') },
      makeContext(),
    );
    // 7/3 のオカレンスの絶対時刻に配置され、繰り返し関連フィールドを持たない
    expect(copy.start).toEqual(new Date('2026-07-03T00:00:00Z'));
    expect(copy.end).toEqual(new Date('2026-07-03T01:00:00Z'));
    expect(copy.title).toBe('朝会');
    expect(copy.color).toBe('#3b82f6');
    expect('rrule' in copy).toBe(false);
    expect('recurringEventId' in copy).toBe(false);
    expect('originalStart' in copy).toBe(false);
    expect('id' in copy).toBe(false);
  });

  it('exdates / rdates を持つマスターのコピーにも exdates / rdates は引き継がれない', () => {
    const master = makeMaster({
      exdates: [new Date('2026-07-02T00:00:00Z')],
      rdates: [new Date('2026-07-20T00:00:00Z')],
    });
    const copy = buildOccurrenceCopy(
      [master],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z') },
      makeContext(),
    );
    expect('exdates' in copy).toBe(false);
    expect('rdates' in copy).toBe(false);
  });

  it('オーバーライドの id のコピーは recurringEventId / originalStart を持たない単発コピーになる', () => {
    const copy = buildOccurrenceCopy([makeMaster(), makeOverride()], 'ov-3', {}, makeContext());
    expect(copy.title).toBe('朝会（変更済み）');
    expect(copy.start).toEqual(new Date('2026-07-03T02:00:00Z')); // 移動済みの現在位置
    expect(copy.end).toEqual(new Date('2026-07-03T03:00:00Z'));
    expect('recurringEventId' in copy).toBe(false);
    expect('originalStart' in copy).toBe(false);
    expect('id' in copy).toBe(false);
  });

  it('マスターの id + オーバーライド済みオカレンスの occurrenceStart は、オーバーライドの内容をコピーする', () => {
    const copy = buildOccurrenceCopy(
      [makeMaster(), makeOverride()],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z') }, // 本来の開始（originalStart）
      makeContext(),
    );
    expect(copy.title).toBe('朝会（変更済み）');
    expect(copy.start).toEqual(new Date('2026-07-03T02:00:00Z'));
    expect('recurringEventId' in copy).toBe(false);
  });

  it('終日の繰り返しマスターのコピーは対象日の日付キーになり、日数を維持する', () => {
    const master: CalendarEvent = {
      id: 'master-allday',
      title: '合宿',
      start: '2026-07-01',
      end: '2026-07-03', // 2 日間（排他的）
      allDay: true,
      timeZone: TOKYO,
      rrule: 'FREQ=WEEKLY;COUNT=4',
    };
    // 2 回目のオカレンス（東京 7/8 0:00 = 2026-07-07T15:00:00Z）
    const copy = buildOccurrenceCopy(
      [master],
      'master-allday',
      { occurrenceStart: new Date('2026-07-07T15:00:00Z') },
      makeContext(),
    );
    expect(copy.start).toBe('2026-07-08');
    expect(copy.end).toBe('2026-07-10'); // 2 暦日分を維持
    expect(copy.allDay).toBe(true);
    expect('rrule' in copy).toBe(false);
  });

  it('end 省略の繰り返しマスターのコピーは defaultEventMinutes の長さになる', () => {
    const master: CalendarEvent = {
      id: 'master-noend',
      title: '朝会',
      start: new Date('2026-07-01T00:00:00Z'),
      timeZone: TOKYO,
      rrule: 'FREQ=DAILY;COUNT=5',
    };
    const copy = buildOccurrenceCopy(
      [master],
      'master-noend',
      { occurrenceStart: new Date('2026-07-02T00:00:00Z') },
      makeContext({ defaultEventMinutes: 90 }),
    );
    expect(copy.start).toEqual(new Date('2026-07-02T00:00:00Z'));
    expect(copy.end).toEqual(new Date('2026-07-02T01:30:00Z'));
  });

  it('繰り返しイベントで occurrenceStart 省略は例外を投げる', () => {
    expect(() => buildOccurrenceCopy([makeMaster()], 'master-1', {}, makeContext())).toThrow(
      /occurrenceStart/,
    );
  });

  it('存在しない id は例外を投げる', () => {
    expect(() => buildOccurrenceCopy([], 'missing', {}, makeContext())).toThrow(/missing/);
  });
});

describe('placeEventInputAt', () => {
  /** 10:00〜11:30 JST の時間指定入力。 */
  function timedInput(): CalendarEventInput {
    return {
      title: '打ち合わせ',
      start: new Date('2026-07-01T01:00:00Z'),
      end: new Date('2026-07-01T02:30:00Z'),
      color: '#ef4444',
    };
  }

  it('時間指定の入力を newStart に配置し、元の長さを維持する', () => {
    const placed = placeEventInputAt(
      timedInput(),
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext(),
    );
    expect(placed.start).toEqual(new Date('2026-07-05T03:00:00Z'));
    expect(placed.end).toEqual(new Date('2026-07-05T04:30:00Z')); // 90 分を維持
    expect(placed.title).toBe('打ち合わせ');
    expect(placed.color).toBe('#ef4444');
  });

  it('入力に id があっても配置結果は id を持たない（貼り付けは常に新しいイベントになる）', () => {
    const placed = placeEventInputAt(
      { ...timedInput(), id: 'src-1' },
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext(),
    );
    expect('id' in placed).toBe(false);
  });

  it('終日の入力は表示タイムゾーンの日付キーに配置され、日数を維持する', () => {
    const placed = placeEventInputAt(
      { title: '合宿', start: '2026-07-01', end: '2026-07-03', allDay: true },
      // 東京 7/10 0:00 = 2026-07-09T15:00:00Z
      { newStart: new Date('2026-07-09T15:00:00Z') },
      makeContext(),
    );
    expect(placed.start).toBe('2026-07-10');
    expect(placed.end).toBe('2026-07-12'); // 2 暦日分を維持
    expect(placed.allDay).toBe(true);
  });

  it('allDay: true への変換（時間指定 → 終日）はちょうど 1 日になる', () => {
    const placed = placeEventInputAt(
      timedInput(),
      { newStart: new Date('2026-07-09T15:00:00Z'), allDay: true },
      makeContext(),
    );
    expect(placed.start).toBe('2026-07-10');
    expect(placed.end).toBe('2026-07-11');
    expect(placed.allDay).toBe(true);
  });

  it('allDay: false への変換（終日 → 時間指定）は defaultEventMinutes の長さになる', () => {
    const placed = placeEventInputAt(
      { title: '合宿', start: '2026-07-01', end: '2026-07-03', allDay: true },
      { newStart: new Date('2026-07-05T03:00:00Z'), allDay: false },
      makeContext({ defaultEventMinutes: 45 }),
    );
    expect(placed.start).toEqual(new Date('2026-07-05T03:00:00Z'));
    expect(placed.end).toEqual(new Date('2026-07-05T03:45:00Z'));
    expect(placed.allDay).toBe(false);
  });

  it('end 省略の時間指定入力は defaultEventMinutes の長さで配置される', () => {
    const placed = placeEventInputAt(
      { title: '打ち合わせ', start: new Date('2026-07-01T01:00:00Z') },
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext({ defaultEventMinutes: 30 }),
    );
    expect(placed.end).toEqual(new Date('2026-07-05T03:30:00Z'));
  });

  it('allDay を指定しない時間指定入力の配置結果には allDay キーを追加しない', () => {
    const placed = placeEventInputAt(
      timedInput(),
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext(),
    );
    expect('allDay' in placed).toBe(false);
  });
});

describe('pasteEventIn / pasteEventInWithChanges', () => {
  it('配置した入力を新しい id で末尾に追加する', () => {
    const events = [makeMaster()];
    const result = pasteEventIn(
      events,
      {
        title: '貼り付け',
        start: new Date('2026-07-01T01:00:00Z'),
        end: new Date('2026-07-01T02:00:00Z'),
      },
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext(),
    );
    expect(result.events).toHaveLength(2);
    expect(result.created.id).toBe('gen-1');
    expect(result.created.start).toEqual(new Date('2026-07-05T03:00:00Z'));
    expect(result.events.at(-1)).toBe(result.created);
    expect(events).toHaveLength(1); // 入力配列は変更しない
  });

  it('入力の id は無視して常に新しい id を採番する（同じクリップボードを 2 回貼り付けできる）', () => {
    const context = makeContext();
    const first = pasteEventIn(
      [],
      { id: 'src-1', title: '貼り付け', start: new Date('2026-07-01T01:00:00Z') },
      { newStart: new Date('2026-07-05T03:00:00Z') },
      context,
    );
    const second = pasteEventIn(
      first.events,
      { id: 'src-1', title: '貼り付け', start: new Date('2026-07-01T01:00:00Z') },
      { newStart: new Date('2026-07-06T03:00:00Z') },
      context,
    );
    expect(second.events).toHaveLength(2);
    expect(second.events.map((event) => event.id)).toEqual(['gen-1', 'gen-2']);
  });

  it('WithChanges は after のみのエントリ（新規作成）と挿入位置を返す', () => {
    const events = [makeMaster()];
    const result = pasteEventInWithChanges(
      events,
      {
        title: '貼り付け',
        start: new Date('2026-07-01T01:00:00Z'),
        end: new Date('2026-07-01T02:00:00Z'),
      },
      { newStart: new Date('2026-07-05T03:00:00Z') },
      makeContext(),
    );
    expect(result.changes).toEqual([{ after: result.created, index: 1 }]);
    // undo（'before' 方向）で貼り付け前に戻せる
    expect(applyEventChangeEntries(result.events, result.changes, 'before')).toEqual(events);
  });
});

describe('duplicateEventIn / duplicateEventInWithChanges', () => {
  it('単発イベントを同じ日時のまま新しい id で複製し、末尾に追加する', () => {
    const single: CalendarEvent = {
      id: 'single-1',
      title: '打ち合わせ',
      start: new Date('2026-07-01T05:00:00Z'),
      end: new Date('2026-07-01T06:00:00Z'),
    };
    const result = duplicateEventIn([single], 'single-1', {}, makeContext());
    expect(result.events).toHaveLength(2);
    expect(result.created).toEqual({
      id: 'gen-1',
      title: '打ち合わせ',
      start: new Date('2026-07-01T05:00:00Z'),
      end: new Date('2026-07-01T06:00:00Z'),
    });
  });

  it('繰り返しマスター + occurrenceStart は当該オカレンスを単発化した複製を追加する（マスターは変更しない）', () => {
    const result = duplicateEventIn(
      [makeMaster()],
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z') },
      makeContext(),
    );
    expect(findById(result.events, 'master-1')).toEqual(makeMaster());
    expect(result.created.rrule).toBeUndefined();
    expect(result.created.start).toEqual(new Date('2026-07-03T00:00:00Z'));
    // 展開すると元の 10 オカレンス + 複製 1 件になる
    const occurrences = expandEvents({
      events: result.events,
      range: JULY_RANGE,
      displayTimeZone: TOKYO,
      defaultEventMinutes: 60,
    });
    expect(occurrences).toHaveLength(11);
  });

  it('WithChanges の changes を undo（before 方向）へ適用すると複製前に戻る', () => {
    const events = [makeMaster()];
    const result = duplicateEventInWithChanges(
      events,
      'master-1',
      { occurrenceStart: new Date('2026-07-03T00:00:00Z') },
      makeContext(),
    );
    expect(result.changes).toEqual([{ after: result.created, index: 1 }]);
    expect(applyEventChangeEntries(result.events, result.changes, 'before')).toEqual(events);
  });
});
