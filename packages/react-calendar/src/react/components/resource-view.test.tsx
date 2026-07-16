/**
 * resource-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `ResourceView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  CalendarViewType,
  PositionedOccurrence,
  ResourceColumn,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type { UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { ResourceViewHandle, ResourceViewProps } from './resource-view';
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
  /** 営業時間の指定（{@link CalendarOptions.businessHours}）。 */
  businessHours?: readonly BusinessHoursRule[];
  /** 表示時間帯の開始（{@link CalendarOptions.slotMinTime}）。 */
  slotMinTime?: string;
  /** 表示時間帯の終了（{@link CalendarOptions.slotMaxTime}）。 */
  slotMaxTime?: string;
  /** `ResourceView` へそのまま渡す追加 props。 */
  viewProps?: ResourceViewProps;
  /** `CalendarProvider` の `messages` prop。 */
  messages?: MessageCatalogOverrides;
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
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
    ...(props.slotMinTime !== undefined ? { slotMinTime: props.slotMinTime } : {}),
    ...(props.slotMaxTime !== undefined ? { slotMaxTime: props.slotMaxTime } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
    >
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

  it('messages.resource.unassigned でラベルを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        unassignedLane="always"
        messages={{ resource: { unassigned: '担当未定' } }}
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

  it('messages.resource.empty でメッセージを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[]}
        unassignedLane="auto"
        messages={{ resource: { empty: '会議室がありません' } }}
      />,
    );
    const empty = container.querySelector('[data-koyomi="resource-empty"]');
    expect(empty?.textContent).toBe('会議室がありません');
  });

  it('列が1つもないとき resource-grid / resource-body を生成せず、ルート直下は resource-empty のみになる', () => {
    const { container } = render(<Harness resources={[]} events={[]} />);
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root?.querySelector('[data-koyomi="resource-grid"]')).toBeNull();
    expect(root?.querySelector('[data-koyomi="resource-body"]')).toBeNull();
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild).toHaveAttribute('data-koyomi', 'resource-empty');
  });

  it('列が1つもないとき、ルートの data-koyomi-columns 属性自体が付かない（"0" にもならない）', () => {
    const { container } = render(<Harness resources={[]} events={[]} />);
    const root = container.querySelector('[data-koyomi="resource"]');
    expect(root).not.toHaveAttribute('data-koyomi-columns');
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

  it('messages.common.eventAriaLabel をオーバーライドすると、リソース名が付記される前の aria-label がカスタマイズされる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '定例会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const eventAriaLabel = (
      occurrence: import('../../core/types').EventOccurrence,
      rangeLabel: string,
    ): string => {
      expect(occurrence.eventId).toBe('e1');
      expect(rangeLabel).toBe('7月15日 10:00〜11:00');
      return `カスタム:${rangeLabel}`;
    };
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} messages={{ common: { eventAriaLabel } }} />,
    );
    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]');
    expect(eventEl?.getAttribute('aria-label')).toBe('カスタム:7月15日 10:00〜11:00、会議室A');
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

  it('表示日の前から続くイベントには data-continues-before のみ、後まで続くイベントには data-continues-after のみが付き、収まるイベントにはどちらも付かない', () => {
    // ResourceView は 1 日固定ビューのため、週/日ビューの「日境界をまたぐイベント」と
    // 同じ規則で、表示日の前後にまたがるイベントに continues 属性が付く
    // （timegrid-event は週/日ビューと部位名を共有する）。
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
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} events={events} />);

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
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);

    const eventElements = Array.from(container.querySelectorAll('[data-koyomi="timegrid-event"]'));
    const editableEvent = eventElements.find((el) => el.textContent?.includes('編集可予定'));
    const lockedEvent = eventElements.find((el) => el.textContent?.includes('編集不可予定'));

    expect(editableEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(2);
    expect(lockedEvent?.querySelectorAll('[data-koyomi="timegrid-resize"]')).toHaveLength(0);
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

  it('messages.common.eventAriaLabel は終日アイテムの区切り記号適用済み日付ラベルも rangeLabel として受け取る', () => {
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
    const eventAriaLabel = (
      _occurrence: import('../../core/types').EventOccurrence,
      rangeLabel: string,
    ): string => `カスタム:${rangeLabel}`;
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} messages={{ common: { eventAriaLabel } }} />,
    );
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent?.getAttribute('aria-label')).toBe('カスタム:7月15日、会議室A');
  });

  it('renderAllDayItem で終日アイテムの内容をカスタマイズできる（renderEvent は影響しない）', () => {
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
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        events={events}
        viewProps={{
          renderEvent: () => <span data-testid="timed">時間指定用</span>,
          renderAllDayItem: (occurrence) => (
            <span data-testid="custom-allday">{occurrence.event.title}★</span>
          ),
        }}
      />,
    );
    const alldayEvent = container.querySelector('[data-koyomi="allday-event"]');
    expect(alldayEvent?.querySelector('[data-testid="custom-allday"]')?.textContent).toBe('休暇★');
    expect(alldayEvent?.querySelector('[data-testid="timed"]')).toBeNull();
  });

  it('renderAllDayItem 省略時は既定どおりタイトルのみが表示される', () => {
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
    expect(alldayEvent?.textContent).toBe('休暇');
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

  it('dragPreview.invalid: true のとき timegrid-preview に data-koyomi-invalid="true" が付与される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[ROOM_A]} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'room-a',
        invalid: true,
      });
    });

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).toHaveAttribute('data-koyomi-invalid', 'true');
  });

  it('dragPreview.invalid 省略時は timegrid-preview に data-koyomi-invalid 属性が付かない', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[ROOM_A]} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'room-a',
      });
    });

    const preview = container.querySelector('[data-koyomi="timegrid-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute('data-koyomi-invalid');
  });

  it('終日プレビュー対象列（data-koyomi-preview-target）にも dragPreview.invalid が data-koyomi-invalid として反映される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[ROOM_A, ROOM_B]} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'ad1@2026-07-15T00:00:00.000Z',
        range: {
          start: new Date('2026-07-14T15:00:00Z'),
          end: new Date('2026-07-15T15:00:00Z'),
        },
        allDay: true,
        resourceId: 'room-b',
        invalid: true,
      });
    });

    const allDayCells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(allDayCells[0]).not.toHaveAttribute('data-koyomi-invalid');
    expect(allDayCells[1]).toHaveAttribute('data-koyomi-invalid', 'true');
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

  it('messages.resource.unassigned でカスタムラベルを渡すと、未割り当て列の終日セルの aria-label にも同じラベルが反映される（columnheader と一致する）', () => {
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
      <Harness
        resources={[ROOM_A]}
        events={events}
        messages={{ resource: { unassigned: '担当未定' } }}
      />,
    );
    const headers = container.querySelectorAll('[data-koyomi="resource-header-cell"]');
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    // columnheader の表示内容（既存挙動）と gridcell の aria-label（今回の修正対象）が一致する
    expect(headers[headers.length - 1]?.textContent).toBe('担当未定');
    expect(cells[cells.length - 1]).toHaveAttribute('aria-label', '担当未定');
  });

  it('messages.resource.unassigned に文字列でない ReactNode を渡した場合、未割り当て列の終日セルの aria-label 属性自体が付かない', () => {
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
        messages={{ resource: { unassigned: <span>担当未定</span> } }}
      />,
    );
    const cells = container.querySelectorAll('[data-koyomi="resource-allday-cell"]');
    expect(cells[cells.length - 1]).not.toHaveAttribute('aria-label');
  });
});

describe('ResourceView - businessHours（営業時間）', () => {
  it('省略時（既定 []）は data-koyomi-business-hours 属性が付かない', () => {
    const { container } = render(<Harness resources={[ROOM_A]} />);
    expect(container.querySelectorAll('[data-koyomi-business-hours]')).toHaveLength(0);
  });

  it('指定した時間帯のスロットにのみ data-koyomi-business-hours 属性が付き、全列共通になる（2026-07-15 は水曜）', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    ];
    const { container } = render(
      <Harness resources={[ROOM_A, ROOM_B]} businessHours={businessHours} />,
    );
    const columns = container.querySelectorAll('[data-koyomi="resource-column"]');
    expect(columns).toHaveLength(2);
    for (const column of columns) {
      const slots = column.querySelectorAll('[data-koyomi="timegrid-slot"]');
      // slotMinutes 既定 60 分: インデックス 9 = 9:00、17 = 17:00
      expect(slots[9]).toHaveAttribute('data-koyomi-business-hours', 'true');
      expect(slots[17]).not.toHaveAttribute('data-koyomi-business-hours');
      expect(slots[8]).not.toHaveAttribute('data-koyomi-business-hours');
    }
  });
});

describe('ResourceView - 表示時間帯制限（slotMinTime/slotMaxTime）', () => {
  it('省略時は既定 00:00/24:00 として、スロット数・イベントの top/height %・--koyomi-timegrid-hours が従来どおりになる（回帰ペア）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(<Harness resources={[ROOM_A]} events={events} />);
    const column = container.querySelector('[data-koyomi="resource-column"]');
    expect(column?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(24);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    expect(eventEl.style.top).toBe(`${(600 / 1440) * 100}%`);
    expect(eventEl.style.height).toBe(`${(60 / 1440) * 100}%`);

    const root = container.querySelector('[data-koyomi="resource"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('24');
  });

  it('slotMinTime/slotMaxTime を指定すると、スロット数・イベントの top/height %・--koyomi-timegrid-hours が表示時間帯基準になる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} slotMinTime="08:00" slotMaxTime="20:00" />,
    );
    const column = container.querySelector('[data-koyomi="resource-column"]');
    expect(column?.querySelectorAll('[data-koyomi="timegrid-slot"]')).toHaveLength(12);

    const eventEl = container.querySelector('[data-koyomi="timegrid-event"]') as HTMLElement;
    expect(eventEl.style.top).toBe(`${((600 - 480) / (1200 - 480)) * 100}%`);
    expect(eventEl.style.height).toBe(`${(60 / (1200 - 480)) * 100}%`);

    const root = container.querySelector('[data-koyomi="resource"]') as HTMLElement;
    expect(root.style.getPropertyValue('--koyomi-timegrid-hours')).toBe('12');
  });

  it('表示時間帯の外側にしか存在しないオカレンスは timegrid-event として描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'early',
        title: '早朝',
        start: '2026-07-15T05:00',
        end: '2026-07-15T06:00',
        resourceId: 'room-a',
      },
    ];
    const { container } = render(
      <Harness resources={[ROOM_A]} events={events} slotMinTime="08:00" slotMaxTime="20:00" />,
    );
    expect(container.querySelector('[data-koyomi="timegrid-event"]')).toBeNull();
  });

  it('now が表示時間帯の外側にあると now-indicator が描画されない', () => {
    const { container } = render(
      // NOW は 2026-07-15 10:00（東京）。表示時間帯を 08:00〜09:00 にして範囲外にする
      <Harness resources={[ROOM_A]} slotMinTime="08:00" slotMaxTime="09:00" />,
    );
    expect(container.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
  });
});

describe('ResourceView - 初期スクロール位置（initialScrollTime）・命令的スクロール（scrollToTime）', () => {
  /** jsdom は scrollHeight を常に 0 として扱うため、テスト内で固定値へ差し替える。 */
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 2000,
    });
  });

  afterEach(() => {
    if (scrollHeightDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    }
  });

  function getBody(container: HTMLElement): HTMLElement {
    const body = container.querySelector('[data-koyomi="resource-body"]');
    if (!(body instanceof HTMLElement)) {
      throw new Error('resource-body が見つかりません');
    }
    return body;
  }

  it('initialScrollTime 省略時はマウント時に scrollTop が変化しない（回帰ペア）', () => {
    const { container } = render(<Harness resources={[ROOM_A]} />);
    expect(getBody(container).scrollTop).toBe(0);
  });

  it('initialScrollTime 指定時にマウント時 1 回だけ scrollTop が設定される', () => {
    const { container } = render(
      <Harness resources={[ROOM_A]} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    expect(getBody(container).scrollTop).toBe((540 / 1440) * 2000);
  });

  it('ref.current.scrollToTime(time) で任意のタイミングにスクロールできる', () => {
    const handleRef = createRef<ResourceViewHandle>();
    const { container } = render(<Harness resources={[ROOM_A]} viewProps={{ ref: handleRef }} />);
    const body = getBody(container);
    expect(body.scrollTop).toBe(0);

    act(() => {
      handleRef.current?.scrollToTime('12:00');
    });
    expect(body.scrollTop).toBe((720 / 1440) * 2000);
  });

  it('表示時間帯制限（slotMinTime/slotMaxTime）を指定していても initialScrollTime/scrollToTime は機能する（独立性の確認）', () => {
    const handleRef = createRef<ResourceViewHandle>();
    const { container } = render(
      <Harness
        resources={[ROOM_A]}
        slotMinTime="08:00"
        slotMaxTime="20:00"
        viewProps={{ initialScrollTime: '10:00', ref: handleRef }}
      />,
    );
    const body = getBody(container);
    expect(body.scrollTop).toBe(((600 - 480) / (1200 - 480)) * 2000);

    act(() => {
      handleRef.current?.scrollToTime('14:00');
    });
    expect(body.scrollTop).toBe(((840 - 480) / (1200 - 480)) * 2000);
  });

  it('アンマウント後に再マウントすると initialScrollTime が再適用される', () => {
    const { container, unmount } = render(
      <Harness resources={[ROOM_A]} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    const body = getBody(container);
    expect(body.scrollTop).toBe((540 / 1440) * 2000);
    body.scrollTop = 999;
    unmount();

    const { container: remounted } = render(
      <Harness resources={[ROOM_A]} viewProps={{ initialScrollTime: '09:00' }} />,
    );
    expect(getBody(remounted).scrollTop).toBe((540 / 1440) * 2000);
  });
});
