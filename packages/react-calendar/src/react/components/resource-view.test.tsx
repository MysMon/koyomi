/**
 * resource-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `ResourceView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { render } from '@testing-library/react';
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
