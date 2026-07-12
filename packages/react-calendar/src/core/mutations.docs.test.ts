/**
 * mutations.docs.test.ts
 *
 * このファイルは docs/events.md（「イベントの CRUD」「パッチ規則（applyPatch）」
 * 「undo（元に戻す）を実装する」節）と docs/api.md（`CalendarApi` 表・
 * `core/mutations` 節・`EventChangeEntry` 型の説明）の記述のみから導出した
 * 仕様由来テストである。実装ファイル（mutations.ts / calendar.ts 等）を
 * 参照して期待値を書いたものではない。
 *
 * 各 it() の直前コメントに、根拠となる docs の記述（ファイル名・見出し・
 * 該当記述の要約）を出典として付す。
 */
import { describe, expect, it } from 'vitest';
import { createCalendar } from './calendar';
import { applyPatch } from './mutations';
import type { CalendarEvent, CalendarEventPatch, EventChangeEntry } from './types';

const TOKYO = 'Asia/Tokyo';

/** 固定 TZ（東京）のカレンダーを作るヘルパ。 */
function makeCalendar(overrides?: Parameters<typeof createCalendar>[0]) {
  return createCalendar({ timeZone: TOKYO, ...overrides });
}

/**
 * exactOptionalPropertyTypes 下では `{ extendedProps: undefined }` のような
 * リテラルを直接書けない箇所があるため、Object.assign で
 * 「キーが存在し値が undefined」のパッチを合成する
 * （mutations.test.ts の undefinedPatch と同じ流儀）。
 */
function undefinedPatch(...keys: (keyof CalendarEventPatch)[]): CalendarEventPatch {
  const patch: CalendarEventPatch = {};
  for (const key of keys) {
    Object.assign(patch, { [key]: undefined });
  }
  return patch;
}

describe('createEvent: id 自動採番（docs/events.md「イベントの CRUD」・docs/api.md CalendarApi 表）', () => {
  // 出典: docs/events.md「イベントの CRUD」節のコード例
  //   `const created = calendar.createEvent({ title: '新しい予定', start: '2026-07-01T10:00:00' });`
  //   `// created.id === 'koyomi-1'`
  // docs/api.md「createEvent」説明: 「`createEvent` で `id` を省略した場合は
  //   `'koyomi-1'` のような連番 ID を採番します。」
  it('新規カレンダーで id を省略して作成すると最初の呼び出しは koyomi-1 になる', () => {
    const calendar = makeCalendar();
    const created = calendar.createEvent({ title: '新しい予定', start: '2026-07-01T10:00:00' });
    expect(created.id).toBe('koyomi-1');
  });

  // 出典: docs/api.md「createEvent」説明「連番 ID を採番します」
  // → 複数回呼び出せば番号が連続して増えることを意味する。
  it('id を省略して 2 回作成すると koyomi-1・koyomi-2 と連番になる', () => {
    const calendar = makeCalendar();
    const first = calendar.createEvent({ title: 'A', start: '2026-07-01T10:00:00' });
    const second = calendar.createEvent({ title: 'B', start: '2026-07-02T10:00:00' });
    expect(first.id).toBe('koyomi-1');
    expect(second.id).toBe('koyomi-2');
  });
});

describe('パッチ規則（applyPatch）: docs/events.md「パッチ規則（applyPatch）」節', () => {
  const base: CalendarEvent = {
    id: 'e1',
    title: '会議',
    start: '2026-07-01T10:00:00',
    extendedProps: { team: 'dev', ownerId: 'u1' },
  };

  // 出典: docs/events.md「パッチ規則（applyPatch）」
  //   「patch にキーが存在し値が undefined の場合、そのフィールドを削除する」
  //   （例として rrule が挙げられているが、規則自体は「各フィールド」に
  //   共通と明記されている。extendedProps もこの一般規則の対象）
  it('extendedProps に undefined を指定するパッチは extendedProps フィールドごと削除する', () => {
    const result = applyPatch(base, undefinedPatch('extendedProps'));
    expect('extendedProps' in result).toBe(false);
  });

  // 出典: docs/events.md「パッチ規則（applyPatch）」
  //   「patch にキーが存在すれば、その値で上書きする」という一般規則
  //   （extendedProps のキー単位のマージ規則は docs のどこにも記載がなく、
  //   フィールド全体の付け替えとして扱われることが読み取れる）
  it('extendedProps を新しいオブジェクトで置き換えるパッチは、既存のキーをマージせず丸ごと置き換える', () => {
    const result = applyPatch(base, { extendedProps: { ownerId: 'u2' } });
    expect(result.extendedProps).toEqual({ ownerId: 'u2' });
    // 置き換え前の 'team' キーは残らない（マージではなく置換）
    expect(result.extendedProps).not.toHaveProperty('team');
  });
});

describe('editable: false のイベントへの API 直接操作: docs/events.md CalendarEvent フィールド表 + 「イベントの CRUD」節', () => {
  // 出典: docs/events.md CalendarEvent フィールド表の editable の説明
  //   「false の場合、表示・クリックは可能だがドラッグ移動・リサイズ・
  //   キーボードでの移動/リサイズ/削除はすべて無効になります。」
  // → 無効化の対象として列挙されているのは「ドラッグ移動・リサイズ・
  //   キーボード操作」のみであり、`CalendarApi.updateEvent` /
  //   `deleteEvent` の直接呼び出しはこの列挙に含まれない。
  it('editable: false のイベントに updateEvent を直接呼んでも通常どおり更新される', () => {
    const calendar = makeCalendar({
      events: [
        {
          id: 'locked',
          title: '固定予定',
          start: '2026-07-01T10:00:00',
          editable: false,
        },
      ],
    });
    calendar.updateEvent('locked', { title: '更新後' });
    expect(calendar.getEvents()[0]?.title).toBe('更新後');
  });

  it('editable: false のイベントに deleteEvent を直接呼んでも通常どおり削除される', () => {
    const calendar = makeCalendar({
      events: [
        {
          id: 'locked',
          title: '固定予定',
          start: '2026-07-01T10:00:00',
          editable: false,
        },
      ],
    });
    calendar.deleteEvent('locked');
    expect(calendar.getEvents()).toHaveLength(0);
  });
});

describe('changes（EventChangeEntry）: docs/events.md「undo（元に戻す）を実装する」節', () => {
  // 出典: docs/events.md
  //   「`before` のみ（`after` なし） — そのイベントは削除された」
  //   「`after` のみ（`before` なし） — そのイベントは新規作成された」
  //   「両方あり — そのイベントの内容が変更された」
  it('updateEvent は変更されたイベントについて before/after 両方を含む 1 件を返す', () => {
    const calendar = makeCalendar({
      events: [{ id: 'e1', title: '会議', start: '2026-07-01T10:00:00' }],
    });
    const before = calendar.getEvents()[0];
    const changes = calendar.updateEvent('e1', { title: '変更後' });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.before).toEqual(before);
    expect(changes[0]?.after).toEqual(calendar.getEvents()[0]);
  });

  it('deleteEvent は削除されたイベントについて before のみ（after なし）を含む 1 件を返す', () => {
    const calendar = makeCalendar({
      events: [{ id: 'e1', title: '会議', start: '2026-07-01T10:00:00' }],
    });
    const before = calendar.getEvents()[0];
    const changes = calendar.deleteEvent('e1');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.before).toEqual(before);
    expect(changes[0]?.after).toBeUndefined();
  });

  // 出典: docs/events.md「undo（元に戻す）を実装する」節の undoChanges 関数と、
  //   その直前の説明「そのため changes をそのまま逆再生すれば、操作前の状態を
  //   完全に復元できる」。docs のサンプルコードのアルゴリズムをそのまま用いて
  //   CalendarApi レベルで完全復元できることを検証する。
  function undoChanges(
    api: ReturnType<typeof createCalendar>,
    changes: readonly EventChangeEntry[],
  ): void {
    const byId = new Map(api.getEvents().map((event) => [event.id, event]));
    for (const change of changes) {
      if (change.after !== undefined) {
        byId.delete(change.after.id);
      }
    }
    for (const change of changes) {
      if (change.before !== undefined) {
        byId.set(change.before.id, change.before);
      }
    }
    api.setEvents([...byId.values()]);
  }

  it('update + delete が混在する操作後も、changes を逆再生すれば操作前の状態に完全復元できる', () => {
    const initialEvents: readonly CalendarEvent[] = [
      { id: 'a', title: 'A', start: '2026-07-01T10:00:00' },
      { id: 'b', title: 'B', start: '2026-07-02T10:00:00' },
    ];
    const calendar = makeCalendar({ events: initialEvents });

    const updateChanges = calendar.updateEvent('a', { title: 'A（更新）' });
    const deleteChanges = calendar.deleteEvent('b');

    // 操作後の状態は初期状態と異なる
    expect(calendar.getEvents()).not.toEqual(initialEvents);

    // changes を新しい順に逆再生して復元する
    undoChanges(calendar, [...deleteChanges, ...updateChanges]);

    const restored = [...calendar.getEvents()].sort((x, y) => x.id.localeCompare(y.id));
    const expected = [...initialEvents].sort((x, y) => x.id.localeCompare(y.id));
    expect(restored).toEqual(expected);
  });
});
