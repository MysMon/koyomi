/**
 * timeline-view.tsx のテスト。
 *
 * `useCalendar` + `CalendarProvider` で実際のカレンダーエンジンを組み立て、
 * `TimelineView` が生成する DOM を `data-koyomi="..."` 属性で検証する。
 * テストプロセスは vitest.config.ts により TZ=Asia/Tokyo で実行される。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarResource,
  CalendarViewType,
  TimelineItem,
  TimelineRow,
  TimelineScale,
  Weekday,
} from '../../core/types';
import { CalendarProvider } from '../context';
import type { MessageCatalogOverrides } from '../locales/types';
import type { UseCalendarResult } from '../types';
import { useCalendar } from '../use-calendar';
import type { TimelineViewProps } from './timeline-view';
import { TimelineView } from './timeline-view';

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
  /** 初期ビュー。既定は 'timeline'。 */
  initialView?: CalendarViewType;
  /** 初期表示日（既定は NOW = 今日）。 */
  initialDate?: Date;
  /** 初期イベント。 */
  events?: readonly CalendarEvent[];
  /** リソース一覧。 */
  resources?: readonly CalendarResource[];
  /** 未割り当てレーンの生成規則。 */
  unassignedLane?: 'auto' | 'always';
  /** 表示日数。 */
  timelineDays?: number;
  /** ズーム粒度。 */
  timelineScale?: TimelineScale;
  /** 週の開始曜日。 */
  weekStartsOn?: Weekday;
  /** 時間軸の目盛り間隔（分）。 */
  slotMinutes?: number;
  /** 営業時間の指定（{@link CalendarOptions.businessHours}）。 */
  businessHours?: readonly BusinessHoursRule[];
  /** `TimelineView` へそのまま渡す追加 props。 */
  viewProps?: TimelineViewProps;
  /** `CalendarProvider` の `messages` prop。 */
  messages?: MessageCatalogOverrides;
  /** `useCalendar` の戻り値を外部から観測するための入れ物。 */
  sink?: { current: UseCalendarResult | null };
}

/** `TimelineView` を `CalendarProvider` 配下で描画するテスト用ハーネス。 */
function Harness(props: HarnessProps): ReactElement {
  const calendar = useCalendar({
    timeZone: TOKYO,
    now: () => NOW,
    initialDate: props.initialDate ?? NOW,
    initialView: props.initialView ?? 'timeline',
    events: props.events ?? EMPTY_EVENTS,
    resources: props.resources ?? EMPTY_RESOURCES,
    unassignedLane: props.unassignedLane ?? 'auto',
    ...(props.timelineDays !== undefined ? { timelineDays: props.timelineDays } : {}),
    ...(props.timelineScale !== undefined ? { timelineScale: props.timelineScale } : {}),
    ...(props.weekStartsOn !== undefined ? { weekStartsOn: props.weekStartsOn } : {}),
    ...(props.slotMinutes !== undefined ? { slotMinutes: props.slotMinutes } : {}),
    ...(props.businessHours !== undefined ? { businessHours: props.businessHours } : {}),
  });
  if (props.sink) {
    props.sink.current = calendar;
  }
  return (
    <CalendarProvider
      value={calendar}
      {...(props.messages !== undefined ? { messages: props.messages } : {})}
    >
      <TimelineView {...(props.viewProps ?? {})} />
    </CalendarProvider>
  );
}

/** 2 リソース分の固定フィクスチャ。 */
const CRANE_1: CalendarResource = { id: 'crane-1', title: 'クレーン1号機', color: '#0000ff' };
const CRANE_2: CalendarResource = { id: 'crane-2', title: 'クレーン2号機' };

describe('TimelineView - viewModel ガード', () => {
  it('viewModel.type が timeline 以外のときは何も描画しない', () => {
    const { container } = render(<Harness initialView="month" resources={[CRANE_1]} />);
    expect(container.querySelector('[data-koyomi="timeline"]')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('viewModel.type が timeline のときは data-koyomi="timeline" のルートを描画する', () => {
    const { container } = render(<Harness resources={[CRANE_1]} />);
    expect(container.querySelector('[data-koyomi="timeline"]')).not.toBeNull();
  });
});

describe('TimelineView - DOM 構造', () => {
  it('data-koyomi-days に表示日数が反映され、日ヘッダーと目盛りが同数分描画される', () => {
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={3} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-days', '3');
    // トラック幅の計算（テーマ CSS の min-width calc）が参照する表示日数の CSS 変数
    expect(root?.getAttribute('style')).toContain('--koyomi-timeline-days: 3');
    expect(root?.querySelector('[data-koyomi="timeline-body"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(3);
    // slotMinutes 既定 60 分 × 3 日 = 72 個
    expect(container.querySelectorAll('[data-koyomi="timeline-slot-label"]')).toHaveLength(72);
  });

  it('行数がリソース数 + 未割り当て分になり、timeline-row / timeline-item が描画される', () => {
    const events: CalendarEvent[] = [
      // resourceId 未指定 → 未割り当て行に合流し、'auto' の未割り当て行を生成させる
      {
        id: 'unassigned-1',
        title: '未割当作業',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
      },
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1, CRANE_2]} events={events} unassignedLane="auto" />,
    );
    expect(container.querySelectorAll('[data-koyomi="timeline-row"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="timeline-resource-header"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="timeline-item"]')).toHaveLength(2);
  });

  it('リソース行には data-koyomi-resource-id が付き、未割り当て行には付かない', () => {
    const { container } = render(<Harness resources={[CRANE_1]} unassignedLane="always" />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveAttribute('data-koyomi-resource-id', 'crane-1');
    expect(headers[1]).not.toHaveAttribute('data-koyomi-resource-id');
  });
});

describe('TimelineView - 空状態', () => {
  it('行が 1 つもないとき data-koyomi="timeline-empty" と既定メッセージを描画する', () => {
    const { container } = render(<Harness resources={[]} unassignedLane="auto" />);
    expect(container.querySelector('[data-koyomi="timeline-row"]')).toBeNull();
    const empty = container.querySelector('[data-koyomi="timeline-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('リソースがありません');
  });

  it('messages.timeline.empty でメッセージを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[]}
        unassignedLane="auto"
        messages={{ timeline: { empty: '設備がありません' } }}
      />,
    );
    const empty = container.querySelector('[data-koyomi="timeline-empty"]');
    expect(empty?.textContent).toBe('設備がありません');
  });

  it('行が1つもないとき timeline-body を生成せず、ルート直下は timeline-empty のみになる', () => {
    const { container } = render(<Harness resources={[]} events={[]} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root?.querySelector('[data-koyomi="timeline-body"]')).toBeNull();
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild).toHaveAttribute('data-koyomi', 'timeline-empty');
  });

  it('空状態でも data-koyomi-scale は常に出力される', () => {
    const { container } = render(<Harness resources={[]} events={[]} timelineScale="week" />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'week');
  });
});

describe('TimelineView - timelineScale（ズーム粒度）', () => {
  it("既定（省略時）は data-koyomi-scale='hour' で、既存の日ヘッダー・時刻目盛りの DOM が不変", () => {
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={3} />);
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'hour');
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).not.toBeNull();
    expect(container.querySelector('[data-koyomi="timeline-group-headers"]')).toBeNull();
    expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-koyomi="timeline-slot-label"]')).toHaveLength(72);
  });

  it('day スケールでは日ヘッダーのみで時刻目盛りが出ない', () => {
    const { container } = render(
      <Harness resources={[CRANE_1]} timelineDays={3} timelineScale="day" />,
    );
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'day');
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-koyomi="timeline-day-header"]')).toHaveLength(3);
    expect(container.querySelector('[data-koyomi="timeline-group-headers"]')).toBeNull();
    expect(container.querySelectorAll('[data-koyomi="timeline-slot-label"]')).toHaveLength(0);
  });

  it('week スケールでは日ヘッダーの代わりに週グループ見出しが出て、目盛りは日番号になる', () => {
    // 2026-07-15(水) から 10 日間、weekStartsOn=0（日曜始まり）
    const { container } = render(
      <Harness resources={[CRANE_1]} timelineDays={10} timelineScale="week" weekStartsOn={0} />,
    );
    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'week');
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).toBeNull();
    const groupHeaders = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
    // 07-15(水)〜07-18(土): 第1週（部分）/ 07-19(日)〜07-24(金): 第2週（部分、表示終端）
    expect(groupHeaders).toHaveLength(2);
    expect(groupHeaders[0]).toHaveAttribute('data-koyomi-group-start', '2026-07-15');
    expect(groupHeaders[1]).toHaveAttribute('data-koyomi-group-start', '2026-07-19');
    const slotLabels = container.querySelectorAll('[data-koyomi="timeline-slot-label"]');
    expect(slotLabels).toHaveLength(10);
    expect(Array.from(slotLabels).map((el) => el.textContent)).toEqual([
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
      '24',
    ]);
  });

  it('week スケールの週グループ見出しは中央カタログの rangeSeparator（既定 ja の「〜」）で開始日〜終了日を連結する', () => {
    const { container } = render(
      <Harness resources={[CRANE_1]} timelineDays={10} timelineScale="week" weekStartsOn={0} />,
    );
    const groupHeaders = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
    expect(Array.from(groupHeaders).map((el) => el.textContent)).toEqual([
      '7月15日〜7月18日',
      '7月19日〜7月24日',
    ]);
  });

  it('messages.common.rangeSeparator を部分上書きすると週グループ見出しの区切り記号が反映される（〜のハードコードを使わない）', () => {
    const { container } = render(
      <Harness
        resources={[CRANE_1]}
        timelineDays={10}
        timelineScale="week"
        weekStartsOn={0}
        messages={{ common: { rangeSeparator: ' – ' } }}
      />,
    );
    const groupHeaders = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
    expect(Array.from(groupHeaders).map((el) => el.textContent)).toEqual([
      '7月15日 – 7月18日',
      '7月19日 – 7月24日',
    ]);
  });

  it('month スケールでは月グループ見出しが出て、containsToday を含むグループに data-today/aria-current が付く', () => {
    // 2026-07-15(水) から 20 日間 = 7/15〜8/3。今日(2026-07-15)は 7 月グループ内
    const { container } = render(
      <Harness resources={[CRANE_1]} timelineDays={20} timelineScale="month" />,
    );
    const groupHeaders = container.querySelectorAll('[data-koyomi="timeline-group-header"]');
    expect(groupHeaders).toHaveLength(2);
    expect(groupHeaders[0]).toHaveAttribute('data-koyomi-group-start', '2026-07-15');
    expect(groupHeaders[0]).toHaveAttribute('data-today', 'true');
    expect(groupHeaders[0]).toHaveAttribute('aria-current', 'date');
    expect(groupHeaders[1]).toHaveAttribute('data-koyomi-group-start', '2026-08-01');
    expect(groupHeaders[1]).not.toHaveAttribute('data-today');
    expect(groupHeaders[1]).not.toHaveAttribute('aria-current');
  });

  it('updateOptions({ timelineScale }) で再ビルド後に DOM が切り替わる', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={10} sink={sink} />);
    expect(container.querySelector('[data-koyomi="timeline-group-headers"]')).toBeNull();

    act(() => {
      sink.current?.api.updateOptions({ timelineScale: 'week' });
    });

    const root = container.querySelector('[data-koyomi="timeline"]');
    expect(root).toHaveAttribute('data-koyomi-scale', 'week');
    expect(container.querySelector('[data-koyomi="timeline-group-headers"]')).not.toBeNull();
    expect(container.querySelector('[data-koyomi="timeline-day-headers"]')).toBeNull();
  });
});

describe('TimelineView - 帯の位置', () => {
  it('style の insetInlineStart/width が表示分 / totalMinutes の % で計算される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T06:00',
        end: '2026-07-15T12:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} timelineDays={1} />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]') as HTMLElement | null;
    expect(item).not.toBeNull();
    // 6:00 = 360 分 → 360/1440*100 = 25%、6 時間 = 360 分 → 25%
    expect(item?.style.insetInlineStart).toBe('25%');
    expect(item?.style.width).toBe('25%');
  });

  it('timelineDays > 1 のとき totalMinutes は日数 × 1440 になり、2 日目の帯の位置に反映される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '2日目作業',
        start: '2026-07-16T06:00',
        end: '2026-07-16T12:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} timelineDays={2} />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]') as HTMLElement | null;
    expect(item).not.toBeNull();
    // totalMinutes = 2880。2 日目 6:00 = 1440+360=1800分 → 1800/2880*100 = 62.5%
    // 6 時間 = 360 分 → 360/2880*100 = 12.5%
    expect(item?.style.insetInlineStart).toBe('62.5%');
    expect(item?.style.width).toBe('12.5%');
  });
});

describe('TimelineView - レーン', () => {
  it('重なる帯は data-koyomi-lane が異なり、--koyomi-timeline-lanes に行のレーン数が反映される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'a',
        title: 'A',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
      {
        id: 'b',
        title: 'B',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} events={events} />);
    const items = Array.from(container.querySelectorAll('[data-koyomi="timeline-item"]'));
    expect(items).toHaveLength(2);
    const lanes = items.map((el) => el.getAttribute('data-koyomi-lane')).sort();
    expect(lanes).toEqual(['0', '1']);

    const row = container.querySelector('[data-koyomi="timeline-row"]');
    expect(row?.getAttribute('style')).toContain('--koyomi-timeline-lanes: 2');
  });
});

describe('TimelineView - カスタム描画 props', () => {
  it('renderEvent で帯の内容を差し替えられる', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const renderEvent = (item: TimelineItem): ReactElement => (
      <span data-koyomi="custom-item">CUSTOM:{item.occurrence.event.title}</span>
    );
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} viewProps={{ renderEvent }} />,
    );
    const custom = container.querySelector('[data-koyomi="custom-item"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe('CUSTOM:荷揚げ');
  });

  it('messages.common.eventAriaLabel をオーバーライドすると、resourceLabel を含む parts ごとカスタマイズできる（区切りの混在が起きない）', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const eventAriaLabel = (
      occurrence: import('../../core/types').EventOccurrence,
      parts: { rangeLabel: string; resourceLabel?: string },
    ): string => {
      expect(occurrence.eventId).toBe('e1');
      expect(parts.rangeLabel).toBe('7月15日 9:00〜11:00');
      expect(parts.resourceLabel).toBe('クレーン1号機');
      return `カスタム:${parts.rangeLabel}:${parts.resourceLabel}`;
    };
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} messages={{ common: { eventAriaLabel } }} />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item).toHaveAttribute('aria-label', 'カスタム:7月15日 9:00〜11:00:クレーン1号機');
  });

  it('renderRowHeader で行見出しの内容を差し替えられ、defaultContent には既定の内容が渡る', () => {
    const renderRowHeader = (row: TimelineRow, defaultContent: ReactNode): ReactElement => (
      <div data-koyomi="custom-row-header">
        CUSTOM:{row.key}:{defaultContent}
      </div>
    );
    const { container } = render(<Harness resources={[CRANE_1]} viewProps={{ renderRowHeader }} />);
    const custom = container.querySelector('[data-koyomi="custom-row-header"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe('CUSTOM:r:crane-1:クレーン1号機');
  });

  it('messages.timeline.unassigned で未割り当て行のラベルを差し替えられる', () => {
    const { container } = render(
      <Harness
        resources={[CRANE_1]}
        unassignedLane="always"
        messages={{ timeline: { unassigned: '担当未定' } }}
      />,
    );
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers[headers.length - 1]?.textContent).toBe('担当未定');
  });
});

describe('TimelineView - 終日帯', () => {
  it('data-all-day が付き、リサイズハンドルが描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'ad1',
        title: '定期点検',
        start: '2026-07-15',
        end: '2026-07-16',
        allDay: true,
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} events={events} />);
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item).toHaveAttribute('data-all-day', 'true');
    expect(item?.querySelectorAll('[data-koyomi="timeline-resize"]')).toHaveLength(0);
  });

  it('時間指定の帯には編集可能なら左右のリサイズハンドルが data-edge 付きで描画される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T09:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} events={events} />);
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item).not.toHaveAttribute('data-all-day');
    expect(
      item?.querySelector('[data-koyomi="timeline-resize"][data-edge="start"]'),
    ).not.toBeNull();
    expect(item?.querySelector('[data-koyomi="timeline-resize"][data-edge="end"]')).not.toBeNull();
  });

  it('editable: false の帯にはリサイズハンドルが描画されない', () => {
    const events: CalendarEvent[] = [
      {
        id: 'locked',
        title: '編集不可',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'crane-1',
        editable: false,
      },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} events={events} />);
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item?.querySelectorAll('[data-koyomi="timeline-resize"]')).toHaveLength(0);
  });
});

describe('TimelineView - continues 属性', () => {
  it('表示範囲外へ続く帯には continuesBefore/After が付く', () => {
    const events: CalendarEvent[] = [
      // 前日 22:00 〜 当日 2:00（表示範囲は当日 1 日のみ）
      {
        id: 'cross',
        title: '夜間作業',
        start: '2026-07-14T22:00',
        end: '2026-07-15T02:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} timelineDays={1} />,
    );
    const item = container.querySelector('[data-koyomi="timeline-item"]');
    expect(item).toHaveAttribute('data-continues-before', 'true');
    expect(item).not.toHaveAttribute('data-continues-after');
    // 表示範囲の先頭にクランプされる
    expect((item as HTMLElement).style.insetInlineStart).toBe('0%');
  });
});

describe('TimelineView - 現在時刻線', () => {
  it('表示範囲に「今」が含まれるときのみ now-indicator が描画される', () => {
    const { container: inRangeContainer } = render(
      <Harness resources={[CRANE_1]} initialDate={NOW} timelineDays={1} />,
    );
    const indicator = inRangeContainer.querySelector('[data-koyomi="now-indicator"]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
    expect(indicator).toHaveAttribute('data-orientation', 'vertical');

    const { container: outOfRangeContainer } = render(
      <Harness
        resources={[CRANE_1]}
        initialDate={new Date('2026-07-10T01:00:00Z')}
        timelineDays={1}
      />,
    );
    expect(outOfRangeContainer.querySelector('[data-koyomi="now-indicator"]')).toBeNull();
  });
});

describe('TimelineView - リソース color の反映', () => {
  it('行見出しに --koyomi-event-color として反映される', () => {
    const { container } = render(<Harness resources={[CRANE_1, CRANE_2]} />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers[0]?.getAttribute('style')).toContain('--koyomi-event-color: #0000ff');
    expect(headers[1]?.getAttribute('style') ?? '').not.toContain('--koyomi-event-color');
  });

  it('イベント自身に color が無い場合はリソースの color が帯にも反映される', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '荷揚げ',
        start: '2026-07-15T09:00',
        end: '2026-07-15T10:00',
        resourceId: 'crane-1',
      },
      {
        id: 'e2',
        title: '色指定あり',
        start: '2026-07-15T13:00',
        end: '2026-07-15T14:00',
        resourceId: 'crane-1',
        color: '#00ff00',
      },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} events={events} />);
    const items = Array.from(container.querySelectorAll('[data-koyomi="timeline-item"]'));
    const withoutOwnColor = items.find((el) => el.textContent?.includes('荷揚げ'));
    const withOwnColor = items.find((el) => el.textContent?.includes('色指定あり'));
    expect(withoutOwnColor?.getAttribute('style')).toContain('--koyomi-event-color: #0000ff');
    // イベント自身の color が優先される
    expect(withOwnColor?.getAttribute('style')).toContain('--koyomi-event-color: #00ff00');
  });
});

describe('TimelineView - inline style の仕様', () => {
  it('timeline-item の inline style は position・背景色・文字色・枠線・イベント色変数を含まない', () => {
    // event.color も resource.color も指定していないため --koyomi-event-color は
    // 設定されない。position 等の見た目はテーマ CSS 側の責務であり inline には出ない。
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '会議',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-2',
      },
    ];
    const { container } = render(<Harness resources={[CRANE_2]} events={events} />);
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

describe('TimelineView - ドラッグプレビュー', () => {
  it('setDragPreview 後、対象行にのみ timeline-preview が data-kind・insetInlineStart・width 付きで出現する', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(
      <Harness resources={[CRANE_1, CRANE_2]} timelineDays={1} sink={sink} />,
    );

    expect(container.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'resize',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'), // 10:00 JST
          end: new Date('2026-07-15T03:00:00Z'), // 12:00 JST
        },
        allDay: false,
        resourceId: 'crane-2',
      });
    });

    const rows = container.querySelectorAll('[data-koyomi="timeline-row"]');
    const preview = rows[1]?.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveAttribute('data-kind', 'resize');
    // ドラッグプレビューは装飾要素なので読み上げ対象から外す
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    const style = (preview as HTMLElement).style;
    // 10:00 = 600分 → 600/1440*100 ≈ 41.66...%、12:00 = 720分 → 幅 120/1440*100 ≈ 8.33...%
    expect(style.insetInlineStart).toContain('41.66');
    expect(style.width).toContain('8.33');

    // 対象外の行（crane-1）にはプレビューが出ない
    expect(rows[0]?.querySelector('[data-koyomi="timeline-preview"]')).toBeNull();
  });

  it('dragPreview.invalid: true のとき timeline-preview に data-koyomi-invalid="true" が付与される', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={1} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'crane-1',
        invalid: true,
      });
    });

    const preview = container.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).toHaveAttribute('data-koyomi-invalid', 'true');
  });

  it('dragPreview.invalid 省略時は timeline-preview に data-koyomi-invalid 属性が付かない', () => {
    const sink: { current: UseCalendarResult | null } = { current: null };
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={1} sink={sink} />);

    act(() => {
      sink.current?.api.setDragPreview({
        kind: 'move',
        occurrenceKey: 'e1@2026-07-15T01:00:00.000Z',
        range: {
          start: new Date('2026-07-15T01:00:00Z'),
          end: new Date('2026-07-15T03:00:00Z'),
        },
        allDay: false,
        resourceId: 'crane-1',
      });
    });

    const preview = container.querySelector('[data-koyomi="timeline-preview"]');
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute('data-koyomi-invalid');
  });
});

describe('TimelineView - ARIA', () => {
  it('role="grid" の中でヘッダー行・各リソース行が row/columnheader/rowheader/gridcell を構成する', () => {
    const { container } = render(<Harness resources={[CRANE_1, CRANE_2]} />);

    expect(container.querySelector('[data-koyomi="timeline"]')).toHaveAttribute('role', 'grid');
    // grid → row の間に挟まるスクロールコンテナは role="presentation" で
    // 所有関係を透過させる（required owned elements 違反を避ける）
    expect(container.querySelector('[data-koyomi="timeline-body"]')).toHaveAttribute(
      'role',
      'presentation',
    );
    expect(container.querySelector('[data-koyomi="timeline-header-row"]')).toHaveAttribute(
      'role',
      'row',
    );
    // 角セルは本文行の rowheader 列に対応する見出し。presentation で隠すと
    // ヘッダー行と本文行で公開される列数がずれる（本文=rowheader+gridcell の 2 列、
    // ヘッダー=時間軸のみの 1 列）ため、空でも columnheader として公開する
    const corner = container.querySelector('[data-koyomi="timeline-corner"]');
    expect(corner).toHaveAttribute('role', 'columnheader');
    expect(corner).toHaveAttribute('aria-label', 'リソース');
    expect(container.querySelector('[data-koyomi="timeline-axis"]')).toHaveAttribute(
      'role',
      'columnheader',
    );

    const rowGroups = container.querySelectorAll('[data-koyomi="timeline-row-group"]');
    expect(rowGroups).toHaveLength(2);
    for (const rowGroup of rowGroups) {
      expect(rowGroup).toHaveAttribute('role', 'row');
      expect(rowGroup.querySelector('[data-koyomi="timeline-resource-header"]')).toHaveAttribute(
        'role',
        'rowheader',
      );
      expect(rowGroup.querySelector('[data-koyomi="timeline-row"]')).toHaveAttribute(
        'role',
        'gridcell',
      );
    }
  });

  it('今日の日ヘッダーに aria-current="date" が付く', () => {
    const { container } = render(<Harness resources={[CRANE_1]} timelineDays={3} />);
    const todayHeader = container.querySelector(
      '[data-koyomi="timeline-day-header"][data-today="true"]',
    );
    expect(todayHeader).toHaveAttribute('aria-current', 'date');

    const otherHeaders = container.querySelectorAll(
      '[data-koyomi="timeline-day-header"]:not([data-today])',
    );
    expect(otherHeaders.length).toBeGreaterThan(0);
    for (const header of otherHeaders) {
      expect(header).not.toHaveAttribute('aria-current');
    }
  });
});

describe('TimelineView - businessHours（営業時間）', () => {
  it('省略時（既定 []）は timeline-business-hours 要素が描画されない', () => {
    const { container } = render(<Harness resources={[CRANE_1]} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-business-hours"]')).toHaveLength(0);
  });

  it('指定した時間帯が insetInlineStart/width % の帯として全行に描画される（2026-07-15 は水曜）', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1, CRANE_2]} businessHours={businessHours} />,
    );
    const bands = container.querySelectorAll('[data-koyomi="timeline-business-hours"]');
    // 1 日分（totalMinutes=1440）× 2 行
    expect(bands).toHaveLength(2);
    for (const band of bands) {
      expect(band).toHaveAttribute('aria-hidden', 'true');
      const style = (band as HTMLElement).style;
      // 09:00 = 540 分 / 1440 分 = 37.5%、幅 = (18:00 - 09:00) = 540 分 / 1440 分 = 37.5%
      expect(style.insetInlineStart).toBe('37.5%');
      expect(style.width).toBe('37.5%');
    }
  });

  it('daysOfWeek に表示日の曜日が含まれない場合は帯が描画されない', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [0], startTime: '09:00', endTime: '18:00' },
    ];
    const { container } = render(<Harness resources={[CRANE_1]} businessHours={businessHours} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-business-hours"]')).toHaveLength(0);
  });

  it('帯は timeline-row の中で timeline-item より前（背面）に描画される', () => {
    const businessHours: BusinessHoursRule[] = [
      { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
    ];
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '予定',
        start: '2026-07-15T10:00',
        end: '2026-07-15T11:00',
        resourceId: 'crane-1',
      },
    ];
    const { container } = render(
      <Harness resources={[CRANE_1]} events={events} businessHours={businessHours} />,
    );
    const row = container.querySelector('[data-koyomi="timeline-row"]');
    expect(row).not.toBeNull();
    const children = Array.from(row?.children ?? []);
    const bandIndex = children.findIndex(
      (el) => el.getAttribute('data-koyomi') === 'timeline-business-hours',
    );
    const itemIndex = children.findIndex(
      (el) => el.getAttribute('data-koyomi') === 'timeline-item',
    );
    expect(bandIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThanOrEqual(0);
    expect(bandIndex).toBeLessThan(itemIndex);
  });
});

describe('TimelineView - リソースの階層グルーピング（parentId）', () => {
  const PARENT: CalendarResource = { id: 'parent', title: '本社' };
  const CHILD: CalendarResource = { id: 'child', title: '1F会議室', parentId: 'parent' };

  it('parentId 未使用時は timeline-row-toggle が 1 つも描画されない（既存挙動の回帰確認）', () => {
    const { container } = render(<Harness resources={[CRANE_1, CRANE_2]} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-row-toggle"]')).toHaveLength(0);
  });

  it('hasChildren な行にのみ timeline-row-toggle が描画され、aria-expanded が collapsed と整合する', () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers).toHaveLength(2);
    const parentToggle = headers[0]?.querySelector('[data-koyomi="timeline-row-toggle"]');
    const childToggle = headers[1]?.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(parentToggle).not.toBeNull();
    expect(parentToggle).toHaveAttribute('aria-expanded', 'true');
    expect(childToggle).toBeNull();
  });

  it('timeline-resource-header に data-koyomi-depth 属性が付き、深さに応じた値になる', () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    const headers = container.querySelectorAll('[data-koyomi="timeline-resource-header"]');
    expect(headers[0]).toHaveAttribute('data-koyomi-depth', '0');
    expect(headers[1]).toHaveAttribute('data-koyomi-depth', '1');
  });

  it('トグルボタンをクリックすると toggleResourceCollapsed が呼ばれ、子孫行が非表示になる', async () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    expect(container.querySelectorAll('[data-koyomi="timeline-row"]')).toHaveLength(2);
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(toggle).not.toBeNull();

    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });

    expect(container.querySelectorAll('[data-koyomi="timeline-row"]')).toHaveLength(1);
    const parentHeader = container.querySelector('[data-koyomi="timeline-resource-header"]');
    expect(parentHeader?.querySelector('[data-koyomi="timeline-row-toggle"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('既定の aria-label は「◯◯ を折りたたむ / を展開する」形式になる', () => {
    const { container } = render(<Harness resources={[PARENT, CHILD]} />);
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(toggle).toHaveAttribute('aria-label', '本社 を折りたたむ');
  });

  it('messages.timeline.resourceToggleAriaLabel をオーバーライドすると aria-label をカスタマイズできる', () => {
    const { container } = render(
      <Harness
        resources={[PARENT, CHILD]}
        messages={{
          timeline: {
            resourceToggleAriaLabel: (resource, collapsed) => `${resource.title}/${collapsed}`,
          },
        }}
      />,
    );
    const toggle = container.querySelector('[data-koyomi="timeline-row-toggle"]');
    expect(toggle).toHaveAttribute('aria-label', '本社/false');
  });
});
