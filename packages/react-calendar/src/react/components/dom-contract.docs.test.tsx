/**
 * DOM/ARIA の仕様由来テスト（監査用）。
 *
 * 出典:
 * - docs/internal/components-dom.md（DOM 仕様書。ASCII 図・data-koyomi-* 属性・role 構成）
 * - docs/theming.md（data-koyomi 属性一覧・inline style の仕様）
 * - docs/accessibility.md（WAI-ARIA パターン・aria-current 等）
 *
 * このファイルは上記 docs の記述のみから導出した仕様由来テストであり、
 * packages/react-calendar/src/ の実装ファイル（*.test.* 以外）を参照して
 * 書いたものではない。既存テスト（*.test.ts(x)）は「その仕様が既にテストされて
 * いるか」の照合にのみ用いた（期待値の根拠にはしていない）。
 *
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarResource } from '../../core/types';
import { CalendarProvider } from '../context';
import { useCalendar } from '../use-calendar';
import { MonthView } from './month-view';
import { ResourceView } from './resource-view';
import { TimeGridView } from './time-grid-view';
import { TimelineView } from './timeline-view';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];
/** resources 未指定時に毎レンダー同じ参照を渡す。 */
const EMPTY_RESOURCES: readonly CalendarResource[] = [];

/** MonthView を検証するための最小ハーネス。 */
function MonthHarness(props: { events?: readonly CalendarEvent[] }): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'month',
    events: props.events ?? EMPTY_EVENTS,
  });
  return (
    <CalendarProvider value={calendar}>
      <MonthView />
    </CalendarProvider>
  );
}

/** ResourceView を検証するための最小ハーネス。 */
function ResourceHarness(props: {
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'resource',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_RESOURCES,
    unassignedLane: 'auto',
  });
  return (
    <CalendarProvider value={calendar}>
      <ResourceView />
    </CalendarProvider>
  );
}

/** TimeGridView（週ビュー）を検証するための最小ハーネス。 */
function TimeGridHarness(props: { events?: readonly CalendarEvent[] }): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'week',
    events: props.events ?? EMPTY_EVENTS,
  });
  return (
    <CalendarProvider value={calendar}>
      <TimeGridView />
    </CalendarProvider>
  );
}

/** TimelineView を検証するための最小ハーネス。 */
function TimelineHarness(props: {
  events?: readonly CalendarEvent[];
  resources?: readonly CalendarResource[];
}): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: NOW,
    initialView: 'timeline',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_RESOURCES,
    unassignedLane: 'auto',
  });
  return (
    <CalendarProvider value={calendar}>
      <TimelineView />
    </CalendarProvider>
  );
}

/** テスト用の固定リソースフィクスチャ。 */
const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A' };
const ROOM_B: CalendarResource = { id: 'room-b', title: '会議室B' };

describe('ResourceView - 継続属性（data-continues-before / data-continues-after）', () => {
  /*
   * 出典: docs/internal/components-dom.md「リソースビュー（ResourceView）」節
   *   「イベントブロック・リサイズハンドル・現在時刻線・プレビューは週/日ビュー
   *     （timegrid-event / timegrid-resize / now-indicator / timegrid-preview）と
   *     同じ部位名を使い、デフォルトテーマのスタイルを共有する」
   * および docs/theming.md「状態を表す data 属性」表:
   *   data-continues-before/after の付与対象に timegrid-event が含まれる。
   * ResourceView は 1 日固定ビューのため、週/日ビューの「日境界をまたぐイベント」と
   * 同じ規則で、表示日の前後にまたがるイベントに continues 属性が付くはずである。
   */
  it('表示日の前から続くイベントには data-continues-before のみ、後まで続くイベントには data-continues-after のみが付き、収まるイベントにはどちらも付かない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'contained',
        title: '基準予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'room-a',
      },
      {
        id: 'cross-start',
        title: '開始またぎ予定',
        start: '2026-07-14T22:00',
        end: '2026-07-15T02:00',
        resourceId: 'room-a',
      },
      {
        id: 'cross-end',
        title: '終了またぎ予定',
        start: '2026-07-15T22:00',
        end: '2026-07-16T02:00',
        resourceId: 'room-b',
      },
    ];
    const { container } = render(<ResourceHarness resources={[ROOM_A, ROOM_B]} events={events} />);

    const findByTitle = (title: string): Element => {
      const found = Array.from(container.querySelectorAll('[data-koyomi="timegrid-event"]')).find(
        (candidate) => candidate.textContent?.includes(title) ?? false,
      );
      if (found === undefined) {
        throw new Error(`イベント「${title}」の timegrid-event が見つかりません`);
      }
      return found;
    };

    const contained = findByTitle('基準予定');
    expect(contained).not.toHaveAttribute('data-continues-before');
    expect(contained).not.toHaveAttribute('data-continues-after');

    const crossStart = findByTitle('開始またぎ予定');
    expect(crossStart).toHaveAttribute('data-continues-before', 'true');
    expect(crossStart).not.toHaveAttribute('data-continues-after');

    const crossEnd = findByTitle('終了またぎ予定');
    expect(crossEnd).toHaveAttribute('data-continues-after', 'true');
    expect(crossEnd).not.toHaveAttribute('data-continues-before');
  });
});

describe('ResourceView - editable: false のリサイズハンドル非出力', () => {
  /*
   * 出典: docs/internal/components-dom.md「リソースビュー（ResourceView）」節
   *   `div[data-koyomi="timegrid-resize"][data-edge="start"]? …
   *     getResizeHandleProps(item, 'start')（editable: false / continuesBefore
   *     には出力しない）`
   *   `div[data-koyomi="timegrid-resize"][data-edge="end"]? …
   *     （editable: false / continuesAfter には出力しない）`
   */
  it('editable: false のイベントには上下端どちらのリサイズハンドルも描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'editable',
        title: '編集可予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'room-a',
      },
      {
        id: 'locked',
        title: '編集不可予定',
        start: '2026-07-15T11:00',
        end: '2026-07-15T12:00',
        resourceId: 'room-a',
        editable: false,
      },
    ];
    const { container } = render(<ResourceHarness resources={[ROOM_A]} events={events} />);

    const events_ = Array.from(container.querySelectorAll('[data-koyomi="timegrid-event"]'));
    const editableEvent = events_.find((el) => el.textContent?.includes('編集可予定'));
    const lockedEvent = events_.find((el) => el.textContent?.includes('編集不可予定'));

    expect(editableEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(2);
    expect(lockedEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(0);
  });
});

describe('MonthView - 3 週にまたがる終日イベントの continues 属性（両端）', () => {
  /*
   * 出典: docs/theming.md「状態を表す data 属性」表:
   *   data-continues-before =「イベントの実際の開始がこの週・この日より前にある」
   *   data-continues-after  =「イベントの実際の終了がこの週・この日より後にある」
   * 3 週以上にまたがるイベントの中間週セグメントは、実際の開始・終了のどちらも
   * そのセグメントが属する週の外側にあるため、両方の属性が同時に付くはずである
   * （既存テストは 2 週にまたがる「片側のみ true」なケースまでしか検証していない）。
   */
  it('3 週にまたがる終日イベントは中間週のセグメントに continues-before と continues-after が両方付く', () => {
    // 2026年7月（週開始=日曜、東京）の週区切り:
    //   第1週 6/28-7/4, 第2週 7/5-7/11, 第3週 7/12-7/18, ...
    // start=2026-07-03, end=2026-07-13（排他的終了。実日程は 7/3〜7/12）は
    // 第1週・第2週・第3週の 3 週にまたがる
    const events: CalendarEvent[] = [
      { id: 'long-trip', title: '長期出張', start: '2026-07-03', end: '2026-07-13', allDay: true },
    ];
    const { container } = render(<MonthHarness events={events} />);

    const segments = container.querySelectorAll('[data-koyomi="month-event"]');
    expect(segments).toHaveLength(3);

    const [first, middle, last] = Array.from(segments);

    expect(first).toHaveAttribute('data-continues-after', 'true');
    expect(first).not.toHaveAttribute('data-continues-before');

    expect(middle).toHaveAttribute('data-continues-before', 'true');
    expect(middle).toHaveAttribute('data-continues-after', 'true');

    expect(last).toHaveAttribute('data-continues-before', 'true');
    expect(last).not.toHaveAttribute('data-continues-after');
  });
});

describe('inline style の仕様 - 位置決めの数値以外は inline に書かない', () => {
  /*
   * 出典: docs/theming.md「ヘッドレスの考え方」:
   *   「インラインの style は、位置決めに必須の数値（%・calc()）だけに限定されて
   *     います。色・境界線・余白などの見た目は inline style に出力されません。
   *     唯一の例外は event.color を指定したイベント要素で、この場合のみ CSS
   *     変数 --koyomi-event-color が inline で設定されます」
   * および「自前スタイルをゼロから当てる場合の注意」:
   *   「position: absolute 自体はテーマ側の責務です…自前 CSS では次の要素すべてに
   *     position: absolute を明示的に当ててください」という一覧に month-event /
   *   allday-event / timegrid-event / timeline-item が含まれる（= これらの要素
   *   自身は inline で position を出力しない。例外は month-overflow と仮想化の
   *   pinned 要素のみ、と明記されている）。
   * event.color を指定していないため --koyomi-event-color も設定されないはずである。
   */
  it('month-event の inline style は position・背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<MonthHarness events={events} />);
    const segment = container.querySelector('[data-koyomi="month-event"]');
    if (!(segment instanceof HTMLElement)) {
      throw new Error('month-event が見つかりません');
    }
    expect(segment.style.position).toBe('');
    expect(segment.style.backgroundColor).toBe('');
    expect(segment.style.color).toBe('');
    expect(segment.style.border).toBe('');
    expect(segment.style.getPropertyValue('--koyomi-event-color')).toBe('');
  });

  it('timegrid-event の inline style は position・背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '会議', start: '2026-07-15T10:00', end: '2026-07-15T11:00' },
    ];
    const { container } = render(<TimeGridHarness events={events} />);
    const item = container.querySelector('[data-koyomi="timegrid-event"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('timegrid-event が見つかりません');
    }
    expect(item.style.position).toBe('');
    expect(item.style.backgroundColor).toBe('');
    expect(item.style.color).toBe('');
    expect(item.style.border).toBe('');
    expect(item.style.getPropertyValue('--koyomi-event-color')).toBe('');
  });

  it('allday-event の inline style は position・背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      { id: 'e1', title: '休暇', start: '2026-07-15', end: '2026-07-16', allDay: true },
    ];
    const { container } = render(<TimeGridHarness events={events} />);
    const item = container.querySelector('[data-koyomi="allday-event"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('allday-event が見つかりません');
    }
    expect(item.style.position).toBe('');
    expect(item.style.backgroundColor).toBe('');
    expect(item.style.color).toBe('');
    expect(item.style.border).toBe('');
    expect(item.style.getPropertyValue('--koyomi-event-color')).toBe('');
  });

  it('timeline-item の inline style は position・背景色・文字色・枠線・イベント色変数を含まない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(<TimelineHarness resources={[ROOM_A]} events={events} />);
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('timeline-item が見つかりません');
    }
    expect(item.style.position).toBe('');
    expect(item.style.backgroundColor).toBe('');
    expect(item.style.color).toBe('');
    expect(item.style.border).toBe('');
    expect(item.style.getPropertyValue('--koyomi-event-color')).toBe('');
  });
});

describe('ResourceView - isEmpty のとき内部構造を出力しない', () => {
  /*
   * 出典: docs/internal/components-dom.md「リソースビュー（ResourceView）」節
   *   「isEmpty の場合は div[data-koyomi="resource"] の直下に resource-empty
   *     のみを描画する（上記の内部構造は出力しない。resource-grid も生成しない）」
   */
  it('列が1つもないとき resource-grid / resource-body を生成せず、ルート直下は resource-empty のみになる', () => {
    const { container } = render(<ResourceHarness resources={[]} events={[]} />);
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root?.querySelector('[data-koyomi="resource-grid"]')).toBeNull();
    expect(root?.querySelector('[data-koyomi="resource-body"]')).toBeNull();
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild).toHaveAttribute('data-koyomi', 'resource-empty');
  });
});

describe('TimelineView - isEmpty のとき内部構造を出力しない', () => {
  /*
   * 出典: docs/internal/components-dom.md「タイムラインビュー（TimelineView）」節
   *   「isEmpty の場合は div[data-koyomi="timeline"] の直下に timeline-empty
   *     のみを描画する」
   */
  it('行が1つもないとき timeline-body を生成せず、ルート直下は timeline-empty のみになる', () => {
    const { container } = render(<TimelineHarness resources={[]} events={[]} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root?.querySelector('[data-koyomi="timeline-body"]')).toBeNull();
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild).toHaveAttribute('data-koyomi', 'timeline-empty');
  });
});
