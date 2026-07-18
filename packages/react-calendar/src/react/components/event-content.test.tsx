/**
 * event-content.tsx のテスト。
 *
 * イベント内容スロットのコンテキスト（`EventContentContext`）の組み立てと、
 * 「ビュー個別の render prop > 中央 `renderEventContent` > 既定内容」という
 * 解決順序を仕様として固定する。
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, EventOccurrence } from '../../core/types';
import type { EventContentContext } from '../types';
import {
  listEventContentContext,
  resolveEventContent,
  timedTextEventContentContext,
  titleOnlyEventContentContext,
} from './event-content';

/** テスト用の最小限のオカレンス。 */
function makeOccurrence(): EventOccurrence {
  const event: CalendarEvent = { id: 'e1', title: '会議', start: '2026-07-15T10:00' };
  return {
    key: 'e1::2026-07-15T01:00:00.000Z',
    eventId: 'e1',
    event,
    start: new Date('2026-07-15T01:00:00Z'),
    end: new Date('2026-07-15T02:00:00Z'),
    originalStart: new Date('2026-07-15T01:00:00Z'),
    allDay: false,
    isRecurring: false,
  };
}

describe('timedTextEventContentContext', () => {
  it('「時刻テキスト＋半角スペース＋タイトル」の既定内容と、分解済みパーツを組み立てる', () => {
    const ctx = timedTextEventContentContext('timegrid-event', 'week', '10:00〜11:00', '会議');
    expect(ctx.slot).toBe('timegrid-event');
    expect(ctx.view).toBe('week');
    expect(ctx.defaultContent).toBe('10:00〜11:00 会議');
    expect(ctx.parts.timeText).toBe('10:00〜11:00');
    expect(ctx.parts.titleText).toBe('会議');
    // 部位要素を持たないスロットでは、time / title はテキストそのもの
    expect(ctx.parts.time).toBe('10:00〜11:00');
    expect(ctx.parts.title).toBe('会議');
    expect(ctx.parts.swatch).toBeNull();
  });

  it('同じスロットでもビューごとに ctx.view で判別できる', () => {
    const ctx = timedTextEventContentContext('timegrid-event', 'resource', '10:00〜11:00', '会議');
    expect(ctx.slot).toBe('timegrid-event');
    expect(ctx.view).toBe('resource');
  });
});

describe('titleOnlyEventContentContext', () => {
  it('タイトルのみの既定内容を組み立て、時刻パーツは null になる', () => {
    const ctx = titleOnlyEventContentContext('allday-event', 'week', '出張');
    expect(ctx.slot).toBe('allday-event');
    expect(ctx.view).toBe('week');
    expect(ctx.defaultContent).toBe('出張');
    expect(ctx.parts.timeText).toBeNull();
    expect(ctx.parts.time).toBeNull();
    expect(ctx.parts.swatch).toBeNull();
    expect(ctx.parts.titleText).toBe('出張');
    expect(ctx.parts.title).toBe('出張');
  });

  it('整形済み時刻テキストを渡すと、既定内容はタイトルのみのまま parts に時刻が載る', () => {
    // タイムラインの帯（timeline-item）: 既定内容には時刻を表示しないが、
    // カスタム描画からは parts.timeText で整形済み時刻を差し込める
    const ctx = titleOnlyEventContentContext('timeline-item', 'timeline', '会議', '10:00〜11:00');
    expect(ctx.defaultContent).toBe('会議');
    expect(ctx.parts.timeText).toBe('10:00〜11:00');
    expect(ctx.parts.time).toBe('10:00〜11:00');
    expect(ctx.parts.title).toBe('会議');
  });
});

describe('listEventContentContext', () => {
  it('時刻・色見本・タイトルの部位要素を parts として渡し、既定内容はその 3 部位の並びになる', () => {
    const time = <span data-koyomi="list-event-time">10:00〜11:00</span>;
    const swatch = <span data-koyomi="list-event-swatch" />;
    const title = <span data-koyomi="list-event-title">会議</span>;
    const ctx = listEventContentContext({
      timeText: '10:00〜11:00',
      time,
      swatch,
      titleText: '会議',
      title,
    });
    expect(ctx.slot).toBe('list-event');
    expect(ctx.view).toBe('list');
    expect(ctx.parts.timeText).toBe('10:00〜11:00');
    expect(ctx.parts.titleText).toBe('会議');
    expect(ctx.parts.time).toBe(time);
    expect(ctx.parts.swatch).toBe(swatch);
    expect(ctx.parts.title).toBe(title);

    // 既定内容を描画すると、時刻 → 色見本 → タイトルの順で 3 部位が並ぶ
    const { container } = render(<>{ctx.defaultContent}</>);
    const parts = Array.from(container.querySelectorAll('[data-koyomi]')).map((el) =>
      el.getAttribute('data-koyomi'),
    );
    expect(parts).toEqual(['list-event-time', 'list-event-swatch', 'list-event-title']);
  });

  it('終日イベント（整形済み時刻テキストを持たない）では timeText を null にできる', () => {
    const ctx = listEventContentContext({
      timeText: null,
      time: <span data-koyomi="list-event-time">終日</span>,
      swatch: <span data-koyomi="list-event-swatch" />,
      titleText: '出張',
      title: <span data-koyomi="list-event-title">出張</span>,
    });
    expect(ctx.parts.timeText).toBeNull();
  });
});

describe('resolveEventContent', () => {
  const occurrence = makeOccurrence();
  const item = { occurrence, marker: 'view-item' };
  const ctx: EventContentContext = titleOnlyEventContentContext(
    'timeline-item',
    'timeline',
    '会議',
  );

  it('ビュー個別の render prop があればそれを (item, ctx) で呼び、中央レンダラーは呼ばない', () => {
    const renderEvent = vi.fn().mockReturnValue('個別');
    const renderEventContent = vi.fn().mockReturnValue('中央');
    const content = resolveEventContent(renderEvent, renderEventContent, item, occurrence, ctx);
    expect(content).toBe('個別');
    expect(renderEvent).toHaveBeenCalledWith(item, ctx);
    expect(renderEventContent).not.toHaveBeenCalled();
  });

  it('個別 render prop が無ければ中央レンダラーを (occurrence, ctx) で呼ぶ', () => {
    const renderEventContent = vi.fn().mockReturnValue('中央');
    const content = resolveEventContent(undefined, renderEventContent, item, occurrence, ctx);
    expect(content).toBe('中央');
    expect(renderEventContent).toHaveBeenCalledWith(occurrence, ctx);
  });

  it('どちらも無ければ既定内容（ctx.defaultContent）を返す', () => {
    const content = resolveEventContent(undefined, undefined, item, occurrence, ctx);
    expect(content).toBe(ctx.defaultContent);
  });
});
