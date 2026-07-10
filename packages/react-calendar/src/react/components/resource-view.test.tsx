/**
 * resource-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `ResourceView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type {
  CalendarEvent,
  CalendarResource,
  CalendarViewType,
  PositionedOccurrence,
  ResourceColumn,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { ResourceViewProps } from './resource-view';
import { ResourceView } from './resource-view';

/** 表示タイムゾーン。 */
const TOKYO = 'Asia/Tokyo';
/** テスト用の固定「現在時刻」。Asia/Tokyo で 2026-07-15（水） 10:00。 */
const NOW = new Date('2026-07-15T01:00:00Z');
/** events 未指定時に毎レンダー同じ参照を渡し、useCalendar の開発時警告を避ける。 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [];
/** resources 未指定時に毎レンダー同じ参照を渡す。 */
const EMPTY_RESOURCES: readonly CalendarResource[] = [];

/** テスト用ハーネスの props。 */
interface HarnessProps {
  /** 初期ビュー。既定は 'resource'。 */
  initialView?: CalendarViewType;
  /** 初期表示日（既定は NOW = 今日）。 */
  initialDate?: Date;
  /** 初期イベント。 */
  events?: readonly CalendarEvent[];
  /** リソース一覧。 */
  resources?: readonly CalendarResource[];
  /** 未割り当てレーンの生成規則。 */
  unassignedLane?: 'auto' | 'always';
  /** `ResourceView` へそのまま渡す追加 props。 */
  viewProps?: ResourceViewProps;
  /** `useCalendar` の戻り値を外部から観測するための入れ物。 */
  sink?: { current: UseCalendarResult | null };
}

/** `ResourceView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: props.initialDate ?? NOW,
    initialView: props.initialView ?? 'resource',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_RESOURCES,
    unassignedLane: props.unassignedLane ?? 'auto',
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider value={calendar}>
      <ResourceView {...(props.viewProps ?? {})} />
    </CalendarProvider>
  );
}

/** 2 リソース分の固定フィクスチャ。 */
const ROOM_A: CalendarResource = { id: 'room-a', title: '会議室A', color: '#ff0000' };
const ROOM_B: CalendarResource = { id: 'room-b', title: '会議室B' };

describe('ResourceView - viewModel ガード', () => {
  it('viewModel.type が resource 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" resources={[ROOM_A]} />);
    expect(container.querySelector('[data-koyomi="resource"]')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('viewModel.type が resource のときは data-koyomi="resource" のルートを描画する', () => {
    const { container } = render(<Harness resources={[ROOM_A]} />);
    expect(container.querySelector('[data-koyomi="resource"]')).not.toBeNull();
  });
});

describe('ResourceView - DOM 構造', () => {
  it('列見出し・終日セル・時間グリッド列がリソース数 + 未割り当て分だけ描画され、列数が data-koyomi-columns に反映される', () => {
    const events: CalendarEvent[] = [
      // resourceId 未指定 → 未割り当て列に合流し、'auto' の未割り当て列を生成させる
      {
        id: 'unassigned-1',
        title: '未割当予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      },
    ];
    const { container } = render(
      <Harness resources={[ROOM_A, ROOM_B]} events={events} unassignedLane="auto" />,
    );
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root).toHaveAttribute('data-koyomi-columns', '3');
    expect(container.querySelectorAll('[data-koyomi="resource-header-cell"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="resource-allday-cell"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="resource-column"]')).toHaveLength(3);
  });

  it('resource-header-cell にリソース列は data-koyomi-resource-id が付き、未割り当て列には付かない', () => {
    const { container } = render(<Harness resources={[ROOM_A]} unassignedLane="always" />);
    const headers = Array.from(container.querySelectorAll('[data-koyomi="resource-header-cell"]'));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveAttribute('data-koyomi-resource-id', 'room-a');
    expect(headers[1]).not.toHaveAttribute('data-koyomi-resource-id');
  });

  it('unassignedLane が auto かつ未割り当てオカレンスが無ければ未割り当て列を生成しない', () => {
    const { container } = render(<Harness resources={[ROOM_A]} unassignedLane="auto" />);
    expect(container.querySelectorAll('[data-koyomi="resource-header-cell"]')).toHaveLength(1);
  });
});

describe('ResourceView - 未割り当て列のラベル', () => {
  it('既定では「未割り当て」を表示する', () => {
    const { container } = render(<Harness resources={[ROOM_A]} unassignedLane="always" />);
    const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const unassignedHeader = headers[headers.length - 1];
    expect(unassignedHeader?.textContent).toBe('未割り当て');
  });

  it('unassignedLabel でラベルを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        unassignedLane="always"
        viewProps={{ unassignedLabel: '担当未定' }}
      />,
    );
    const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const unassignedHeader = headers[headers.length - 1];
    expect(unassignedHeader?.textContent).toBe('担当未定');
  });
});

describe('ResourceView - 空状態', () => {
  it('列が 1 つもないとき data-koyomi="resource-empty" と既定メッセージを描画する', () => {
    const { container } = render(<Harness resources={[]} unassignedLane="auto" />);
    expect(container.querySelector('[data-koyomi="resource-column"]')).toBeNull();
    const empty = container.querySelector('[data-koyomi="resource-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('リソースがありません');
  });

  it('emptyLabel でメッセージを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[]}
        unassignedLane="auto"
        viewProps={{ emptyLabel: '会議室がありません' }}
      />,
    );
    const empty = container.querySelector('[data-koyomi="resource-empty"]');
    expect(empty?.textContent).toBe('会議室がありません');
  });
});

describe('ResourceView - イベントブロック', () => {
  it('timegrid-event として描画され、aria-label にリソース名が含まれる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '定例会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    expect(eventEl?.getAttribute('aria-label')).toBe('定例会議、7月15日 10:00〜11:00、会議室A');
    expect(eventEl?.textContent).toContain('10:00');
    expect(eventEl?.textContent).toContain('定例会議');
  });

  it('参照先のない resourceId のイベントは未割り当て列に入り、aria-label にリソース名を付けない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'orphan',
        title: '孤立予定',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'ghost-room',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl).not.toBeNull();
    expect(eventEl?.getAttribute('aria-label')).toBe('孤立予定、7月15日 10:00〜11:00');
    const unassignedColumn = container.querySelector(
      '[data-koyomi="resource-column"][data-koyomi-resource="unassigned"]',
    );
    expect(unassignedColumn?.contains(eventEl)).toBe(true);
  });
});

describe('ResourceView - カスタム描画 props', () => {
  it('renderEvent でイベントブロックの内容を差し替えられる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '定例会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const renderEvent = (item: PositionedOccurrence): ReactElement => (
      <span data-koyomi="custom-event">CUSTOM:{item.occurrence.event.title}</span>
    );
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} viewProps={{ renderEvent }} />,
    );
    const custom = container.querySelector('[data-koyomi="custom-event"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe('CUSTOM:定例会議');
  });

  it('renderColumnHeader で列見出しの内容を差し替えられ、defaultContent には既定の内容が渡る', () => {
    const renderColumnHeader = (
      column: ResourceColumn,
      defaultContent: ReactNode,
    ): ReactElement => (
      <div data-koyomi="custom-header">
        CUSTOM:{column.key}:{defaultContent}
      </div>
    );
    const { container } = render(
      <Harness resources={[ROOM_A]} viewProps={{ renderColumnHeader }} />,
    );
    const custom = container.querySelector('[data-koyomi="custom-header"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe('CUSTOM:r:room-a:会議室A');
  });
});

describe('ResourceView - 現在時刻線', () => {
  it('表示日が今日のときのみ now-indicator が描画される', () => {
    const { container: todayContainer } = render(
      <Harness resources={[ROOM_A]} initialDate={NOW} />,
    );
    const todayColumn = todayContainer.querySelector('[data-koyomi="resource-column"]');
    const indicator = todayColumn?.querySelector('[data-koyomi="now-indicator"]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveAttribute('aria-hidden', 'true');

    const { container: otherContainer } = render(
      <Harness resources={[ROOM_A]} initialDate={new Date('2026-07-10T01:00:00Z')} />,
    );
    const otherColumn = otherContainer.querySelector('[data-koyomi="resource-column"]');
    expect(otherColumn?.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
  });
});

describe('ResourceView - リソース color の反映', () => {
  it('列見出しに --koyomi-event-color として反映される', () => {
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} />);
    const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const headerA = headers[0];
    const headerB = headers[1];
    expect(headerA?.getAttribute('style')).toContain('--koyomi-event-color: #ff0000');
    expect(headerB?.getAttribute('style') ?? '').not.toContain('--koyomi-event-color');
  });

  it('イベント自身に color が無い場合はリソースの color がイベントブロックにも反映される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '定例会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
      {
        id: 'e2',
        title: '色指定あり',
        start: '2026-07-15T13:00',
        end: '2026-07-15T14:00',
        resourceId: 'room-a',
        color: '#00ff00',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);
    const eventEls = Array.from(container.querySelectorAll('[data-koyomi="timegrid-event"]'));
    const withoutOwnColor = eventEls.find((el) => el.textContent?.includes('定例会議'));
    const withOwnColor = eventEls.find((el) => el.textContent?.includes('色指定あり'));
    expect(withoutOwnColor?.getAttribute('style')).toContain('--koyomi-event-color: #ff0000');
    // イベント自身の color が優先される
    expect(withOwnColor?.getAttribute('style')).toContain('--koyomi-event-color: #00ff00');
  });
});

describe('ResourceView - 終日アイテム', () => {
  it('allday-event として終日行に表示され、タイトルと aria-label が付く', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad1',
        title: '休暇',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'room-a',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent).not.toBeNull();
    expect(alldayEvent?.textContent).toBe('休暇');
    expect(alldayEvent?.getAttribute('aria-label')).toBe('休暇、7月15日、会議室A');
  });
});

describe('ResourceView - Codex レビュー回帰（終日アイテム）', () => {
  /** 同じ列に終日アイテムを 2 件持つフィクスチャ。 */
  const TWO_ALLDAY_EVENTS: readonly CalendarEvent[] = [
    {
      id: 'ad-1',
      title: '終日1',
      start: '2026-07-15',
      end: '2026-07-16',
      allDay: true,
      resourceId: 'room-a',
    },
    {
      id: 'ad-2',
      title: '終日2',
      start: '2026-07-15',
      end: '2026-07-16',
      allDay: true,
      resourceId: 'room-a',
    },
  ];

  it('同じ列の複数の終日アイテムはレーン（配列順）の top で縦積みされる', () => {
    const { container } = render(<Harness resources={[ROOM_A]} events={TWO_ALLDAY_EVENTS} />);
    const items = container.querySelectorAll('[data-koyomi="allday-event"]');
    expect(items).toHaveLength(2);
    const tops = Array.from(items).map((item) =>
      item instanceof HTMLElement ? item.style.top : '',
    );
    expect(tops[0]).toBe('calc(0 * var(--koyomi-lane-height, 24px))');
    expect(tops[1]).toBe('calc(1 * var(--koyomi-lane-height, 24px))');
  });

  it('終日セルはレーン数分の minHeight を確保する（2 レーン未満は 2 レーン分）', () => {
    const { container } = render(<Harness resources={[ROOM_A]} events={TWO_ALLDAY_EVENTS} />);
    const cell = container.querySelector('[data-koyomi="resource-allday-cell"]');
    expect(cell instanceof HTMLElement ? cell.style.minHeight : '').toBe(
      'calc(2 * var(--koyomi-lane-height, 24px))',
    );
  });

  it('終日アイテムのクリックは親セルへ伝播せず、新しいイベントを作成しない', () => {
    const { container } = render(
      <Harness resources={[ROOM_A]} events={[TWO_ALLDAY_EVENTS[0] as CalendarEvent]} />,
    );
    const item = container.querySelector('[data-koyomi="allday-event"]');
    expect(item).not.toBeNull();
    if (!(item instanceof HTMLElement)) {
      throw new Error('終日アイテムが見つかりません');
    }
    // クリックが resource-allday-cell の作成ハンドラへ伝播すると予定が 2 件になる
    item.click();
    const items = container.querySelectorAll('[data-koyomi="allday-event"]');
    expect(items).toHaveLength(1);
  });
});

describe('ResourceView - Codex 再レビュー回帰', () => {
  it('終日アイテムはセル幅いっぱいに広がる（insetInlineStart 0% / width 100%）', () => {
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        events={[
          {
            id: 'ad-w',
            title: '終日',
            start: '2026-07-15',
            end: '2026-07-16',
            allDay: true,
            resourceId: 'room-a',
          },
        ]}
      />,
    );
    const item = container.querySelector('[data-koyomi="allday-event"]');
    expect(item instanceof HTMLElement ? item.style.width : '').toBe('100%');
    expect(item instanceof HTMLElement ? item.style.insetInlineStart : '').toBe('0%');
  });
});

describe('ResourceView - ドラッグプレビュー', () => {
  it('setDragPreview 後、対象列にのみ timegrid-preview が data-kind・top・height 付きで出現する', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} sink={sink} />);

    expect(container.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'resize',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'), // 10:00 JST
          end: new Date('2026-07-15T03:00:00Z'), // 12:00 JST
        },
        allDay: false,
        resourceId: 'room-a',
      });
    });

    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    const preview = columns[0]?.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    // ドラッグプレビューは装飾要素なので読み上げ対象から外す
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    const style = (preview as HTMLElement).style;
    // 10:00 = 600分 → 600/1440*100 ≈ 41.66...%、12:00 = 720分 → 高さ 120/1440*100 ≈ 8.33...%
    expect(style.top).toContain('41.66');
    expect(style.height).toContain('8.33');

    // 対象外の列（room-b）にはプレビューが出ない
    expect(columns[1]?.querySelector('[data-koyomi="timegrid-preview"]')).toBeNull();
  });

  it('setDragPreview（allDay: true）後、対象列の終日セルにのみ data-koyomi-preview-target が付く', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'ad1@2026-07-15T00:00:00.000Z',
        range: {
          start: new Date('2026-07-14T15:00:00Z'), // 2026-07-15 0:00 JST
          end: new Date('2026-07-15T15:00:00Z'), // 2026-07-16 0:00 JST
        },
        allDay: true,
        resourceId: 'room-b',
      });
    });

    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(allDayCells[0]).not.toHaveAttribute('data-koyomi-preview-target');
    expect(allDayCells[1]).toHaveAttribute('data-koyomi-preview-target', 'true');
  });
});

describe('ResourceView - ARIA', () => {
  it('列見出し行・終日行は role="grid" の中で row/columnheader/gridcell を構成する', () => {
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} />);

    // 列見出し行・終日行だけをまとめた専用ラッパー（resource-grid）に role="grid" が付く
    expect(container.querySelector('[data-koyomi="resource"]')).not.toHaveAttribute('role');
    expect(container.querySelector('[data-koyomi="resource-grid"]')).toHaveAttribute(
      'role',
      'grid',
    );
    expect(container.querySelector('[data-koyomi="resource-header"]')).toHaveAttribute(
      'role',
      'row',
    );
    // unassignedLane: 'auto' かつ未割り当てイベントが無いため 2 列（会議室A・会議室B）
    expect(
      container.querySelectorAll('[data-koyomi="resource-header-cell"][role="columnheader"]'),
    ).toHaveLength(2);
    expect(container.querySelector('[data-koyomi="allday-row"]')).toHaveAttribute('role', 'row');
    expect(
      container.querySelectorAll('[data-koyomi="resource-allday-cell"][role="gridcell"]'),
    ).toHaveLength(2);

    // row → columnheader/gridcell の間に挟まるレイアウト用ラッパーは role="presentation" で
    // 所有関係を透過させる（required owned elements 違反を避ける）
    expect(container.querySelector('[data-koyomi="resource-headers"]')).toHaveAttribute(
      'role',
      'presentation',
    );
    expect(container.querySelector('[data-koyomi="resource-allday-cells"]')).toHaveAttribute(
      'role',
      'presentation',
    );

    // 本文（時間軸 + リソース列）は連続的な時間位置決めで離散セルに対応しないため grid 化せず、
    // role="grid" の owned elements（row/rowgroup）違反を避けるため resource-grid の
    // 外側（兄弟要素）に置かれる。role は付かない
    expect(container.querySelector('[data-koyomi="resource-body"]')).not.toHaveAttribute('role');
  });

  it('role="grid" の要素は本文の予定ボタンを子孫に含まない（WAI-ARIA grid パターンの owned elements 違反を避ける）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} events={events} />);

    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    // role="grid" の直接・間接の子孫として row/rowgroup 以外の要素（予定ボタン）が
    // 現れてはいけない（role="presentation" は自身の役割を消すだけで、内部の
    // <button> はアクセシビリティツリー上 grid の子孫として露出してしまうため）
    expect(grid?.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
    // 本文コンテナ自体も role="grid" の外側（子孫ではない）に置く
    expect(grid?.querySelector('[data-koyomi="resource-body"]')).toBeNull();
  });

  it('終日セルの aria-label はリソース名（未割り当て列は「未割り当て」）になる', () => {
    const events: CalendarEvent[] = [
      // resourceId 未指定 → 未割り当て列を生成させる
      {
        id: 'unassigned-1',
        title: '未割当予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} events={events} />);
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(cells[0]).toHaveAttribute('aria-label', '会議室A');
    expect(cells[1]).toHaveAttribute('aria-label', '会議室B');
    expect(cells[2]).toHaveAttribute('aria-label', '未割り当て');
  });

  it('unassignedLabel でカスタムラベルを渡すと、未割り当て列の終日セルの aria-label にも同じラベルが反映される（columnheader と一致する）', () => {
    const events: CalendarEvent[] = [
      // resourceId 未指定 → 未割り当て列を生成させる
      {
        id: 'unassigned-1',
        title: '未割当予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      },
    ];
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} viewProps={{ unassignedLabel: '担当未定' }} />,
    );
    const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    // columnheader の表示内容（既存挙動）と gridcell の aria-label（今回の修正対象）が一致する
    expect(headers[headers.length - 1]?.textContent).toBe('担当未定');
    expect(cells[cells.length - 1]).toHaveAttribute('aria-label', '担当未定');
  });

  it('unassignedLabel に文字列でない ReactNode を渡した場合、未割り当て列の終日セルの aria-label は既定文言にフォールバックする', () => {
    const events: CalendarEvent[] = [
      {
        id: 'unassigned-1',
        title: '未割当予定',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      },
    ];
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        events={events}
        viewProps={{ unassignedLabel: <span>担当未定</span> }}
      />,
    );
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(cells[cells.length - 1]).toHaveAttribute('aria-label', '未割り当て');
  });
});
