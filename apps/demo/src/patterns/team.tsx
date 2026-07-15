/**
 * @packageDocumentation
 * `TeamPattern` — 「チーム」パターン（`#/team`）。
 *
 * 200 件のリソース（チームメンバー）と大量イベント（`makeManyResources` /
 * `makeManyEvents`）を使い、`VirtualResourceView` / `VirtualTimelineView` /
 * `VirtualListView` を切り替えて表示するチームスケジューラーのデモ。
 * `CalendarView` / `Toolbar` は使わず、この 3 ビューのみを個別コンポーネントで
 * 直接切り替える（`api.setView` と自前のタブ UI）。
 *
 * サイドバーの「未割り当てタスク」一覧は `useExternalDrag` でカレンダーへ
 * ドラッグでき、ドロップ確定時（`onExternalDrop`）に `api.createEvent` で
 * ドロップ先リソースへ割り当てる（ドロップしたタスクは一覧から消える）。
 * ヘッダーでは `snapMinutes`（ドラッグ・リサイズの丸め単位）・
 * `unassignedLane`（未割り当てレーンの生成規則）を切り替えられるほか、
 * `scrollToResource`（`VirtualResourceView` / `VirtualTimelineView` の ref API）
 * を使った「リソースへジャンプ」の `<select>` を提供する。
 *
 * `businessHours`（営業時間）はリソース/タイムラインビューにもネイティブ対応して
 * いるため、`useCalendar` のオプションを設定するだけで各ビューの見た目に反映される
 * （`docs/views.md` の「営業時間」節を参照。CSS 側の補完表示は不要）。
 *
 * このほか、以下の機能も本パターンに統合している。
 * - **リソースの階層グルーピング**（`CalendarResource.parentId`） — 200 人のメンバー
 *   リソースとは別に、拠点＞フロア＞会議室の 3 段階層リソースを追加する。
 *   タイムラインビューで折りたたみボタン（ビルトイン）を確認できる
 * - **宣言的な重なり・配置制約**（`eventOverlap` / `eventConstraint`） —
 *   トグルで切り替え、`businessHours` の表示と組み合わせて無効なドラッグ操作の
 *   プレビューが赤く表示されることを確認できる
 * - **時間グリッドの表示時間帯制限・初期スクロール位置**（`slotMinTime` /
 *   `slotMaxTime` / `initialScrollTime` / `scrollToTime`） — リソースビューに適用する
 * - **タイムラインのズーム粒度**（`timelineScale`） — `timelineDays` のプリセットと
 *   合わせて切り替える
 */

import type {
  BusinessHoursRule,
  CalendarEvent,
  CalendarInteractionCallbacks,
  CalendarResource,
  EventChange,
  ExternalDropInfo,
  TimelineScale,
  VirtualResourceViewHandle,
  VirtualTimelineViewHandle,
} from '@koyomi-cal/react';
import {
  addDaysInZone,
  addMinutesInZone,
  CalendarProvider,
  dateKeyInZone,
  useCalendar,
  useExternalDrag,
  VirtualListView,
  VirtualResourceView,
  VirtualTimelineView,
} from '@koyomi-cal/react';
import { type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
import { makeManyEvents, makeManyResources } from '../sample-data';
import './team.css';

/** 生成するリソース（チームメンバー）件数。 */
const RESOURCE_COUNT = 200;

/**
 * イベントを生成する日数（今日起点）。`LIST_DAYS` と揃え、リストの表示範囲内が
 * 隙間なく埋まるようにする（`ListView` は予定のある日だけを表示するため）。
 */
const EVENT_DAYS = 45;

/**
 * リストビューの表示日数。仮想化の効果が分かるよう、開発ビルド警告の閾値
 * （40 日）を上回る値にしている。
 */
const LIST_DAYS = 45;

/** タイムラインビューの表示日数（1 週間弱）。 */
const TIMELINE_DAYS = 5;

/** 表示するビューの選択肢（このパターンでは 3 ビューのみに opt-in）。 */
const VIEW_TABS: readonly { value: 'resource' | 'timeline' | 'list'; label: string }[] = [
  { value: 'resource', label: 'リソース' },
  { value: 'timeline', label: 'タイムライン' },
  { value: 'list', label: 'リスト' },
];

/** `snapMinutes` 切替の選択肢。 */
const SNAP_MINUTES_OPTIONS: readonly number[] = [15, 30, 60];

/** 「リソースへジャンプ」の未割り当てレーンを表す特別な選択肢値。 */
const UNASSIGNED_OPTION_VALUE = '__unassigned__';

/** 平日 9-18 時・土曜午前のみを営業時間とする（日曜は休業）。 */
const BUSINESS_HOURS: readonly BusinessHoursRule[] = [
  { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
  { daysOfWeek: [6], startTime: '10:00', endTime: '13:00' },
];

/**
 * リソースの階層グルーピング（`parentId`）のデモ用に追加する会議室リソース
 * （拠点 ＞ フロア ＞ 会議室の 3 段階層）。200 人のメンバーリソースとは別グループ
 * として末尾に追加する。
 */
const HIERARCHICAL_RESOURCES: readonly CalendarResource[] = [
  { id: 'site-tokyo', title: '東京拠点' },
  { id: 'floor-tokyo-1f', title: '東京 1F', parentId: 'site-tokyo' },
  { id: 'floor-tokyo-2f', title: '東京 2F', parentId: 'site-tokyo' },
  { id: 'room-tokyo-1f-a', title: '東京1F 会議室A', parentId: 'floor-tokyo-1f' },
  { id: 'room-tokyo-1f-b', title: '東京1F 会議室B', parentId: 'floor-tokyo-1f' },
  { id: 'room-tokyo-2f-a', title: '東京2F 会議室A', parentId: 'floor-tokyo-2f' },
  { id: 'site-osaka', title: '大阪拠点' },
  { id: 'floor-osaka-1f', title: '大阪 1F', parentId: 'site-osaka' },
  { id: 'room-osaka-1f-a', title: '大阪1F 会議室A', parentId: 'floor-osaka-1f' },
];

/**
 * 初期状態で折りたたむリソース ID。「東京 2F」フロアを畳んだ状態で開始し、
 * 折りたたみボタン（ビルトイン、タイムラインビューのみ）で展開できることを
 * 確認できるようにする。
 */
const INITIAL_COLLAPSED_RESOURCE_IDS: readonly string[] = ['floor-tokyo-2f'];

/** 表示時間帯（`slotMinTime`/`slotMaxTime`）切替の選択肢。 */
const SLOT_RANGE_OPTIONS: readonly {
  value: string;
  label: string;
  slotMinTime: string;
  slotMaxTime: string;
}[] = [
  { value: 'full', label: '終日 (00:00-24:00)', slotMinTime: '00:00', slotMaxTime: '24:00' },
  {
    value: 'business',
    label: '営業時間帯 (07:00-22:00)',
    slotMinTime: '07:00',
    slotMaxTime: '22:00',
  },
];

/** `initialScrollTime` / `scrollToTime` で使う、営業時間の開始時刻に揃えたスクロール位置。 */
const SCROLL_TO_TIME_TARGET = '09:00';

/**
 * タイムラインのズーム粒度（`timelineScale`）切替の選択肢。粒度が粗くなるほど
 * 表示日数（`timelineDays`）のプリセットも広げ、ズームの効果を確認しやすくする。
 */
const TIMELINE_SCALE_OPTIONS: readonly {
  value: TimelineScale;
  label: string;
  timelineDays: number;
}[] = [
  { value: 'hour', label: '時間', timelineDays: TIMELINE_DAYS },
  { value: 'day', label: '日', timelineDays: 14 },
  { value: 'week', label: '週', timelineDays: 84 },
  { value: 'month', label: '月', timelineDays: 180 },
];

/** 変更ログの最大保持件数。 */
const MAX_LOG_ENTRIES = 6;

/** 変更ログの 1 エントリ。 */
interface LogEntry {
  /** React の `key` 用の一意な ID。 */
  id: string;
  /** 表示テキスト。 */
  text: string;
}

/** サイドバーの「未割り当てタスク」1 件分（`useExternalDrag` のペイロード）。 */
interface UnassignedTask {
  /** 一意な ID（割り当て済みタスクを一覧から除くために使う）。 */
  id: string;
  /** タスク名。作成イベントのタイトルにそのまま使う。 */
  title: string;
  /** 想定所要時間（分）。ドロップ位置の開始時刻からこの分数を終了時刻にする。 */
  durationMinutes: number;
}

/** サイドバーに表示する未割り当てタスクの初期一覧。 */
const INITIAL_TASKS: readonly UnassignedTask[] = [
  { id: 'task-design-review', title: '設計レビュー', durationMinutes: 60 },
  { id: 'task-client-visit', title: '顧客訪問', durationMinutes: 90 },
  { id: 'task-doc-prep', title: '資料作成', durationMinutes: 45 },
  { id: 'task-code-review', title: 'コードレビュー', durationMinutes: 30 },
  { id: 'task-1on1', title: '1on1 面談', durationMinutes: 30 },
  { id: 'task-monthly-report', title: '月次報告', durationMinutes: 60 },
  { id: 'task-onboarding', title: '新人研修', durationMinutes: 120 },
  { id: 'task-interview', title: '採用面接', durationMinutes: 45 },
];

/** 今日から `offsetDays` 日後の日付キー（`'YYYY-MM-DD'`、Asia/Tokyo 基準）を返す。 */
function teamDayKey(offsetDays: number): string {
  return dateKeyInZone(addDaysInZone(new Date(), offsetDays, 'Asia/Tokyo'), 'Asia/Tokyo');
}

/** {@link HIERARCHICAL_RESOURCES}（拠点＞フロア＞会議室）向けのサンプルイベント。 */
const HIERARCHICAL_EVENTS: readonly CalendarEvent[] = [
  {
    id: 'hier-tokyo-1fa-review',
    title: '設計レビュー',
    resourceId: 'room-tokyo-1f-a',
    start: `${teamDayKey(0)}T10:00:00`,
    end: `${teamDayKey(0)}T11:00:00`,
  },
  {
    id: 'hier-tokyo-1fb-standup',
    title: '朝会',
    resourceId: 'room-tokyo-1f-b',
    start: `${teamDayKey(0)}T09:00:00`,
    end: `${teamDayKey(0)}T09:30:00`,
  },
  {
    // 折りたたみ既定の「東京 2F」フロア配下。展開すると確認できる。
    id: 'hier-tokyo-2fa-meeting',
    title: '経営会議',
    resourceId: 'room-tokyo-2f-a',
    start: `${teamDayKey(0)}T13:00:00`,
    end: `${teamDayKey(0)}T14:30:00`,
  },
  {
    id: 'hier-osaka-1fa-sync',
    title: '大阪支店定例',
    resourceId: 'room-osaka-1f-a',
    start: `${teamDayKey(0)}T15:00:00`,
    end: `${teamDayKey(0)}T16:00:00`,
  },
];

/**
 * `<select>` の `snapMinutes` の値を検証しつつ数値に変換する。
 *
 * @throws `SNAP_MINUTES_OPTIONS` にない値の場合は `Error`
 */
function parseSnapMinutes(value: string): number {
  const parsed = Number(value);
  if (SNAP_MINUTES_OPTIONS.includes(parsed)) {
    return parsed;
  }
  throw new Error(`不正な snapMinutes の値です: '${value}'`);
}

/**
 * `<select>` の `unassignedLane` の値（`'auto'` / `'always'`）を検証しつつ変換する。
 *
 * @throws 上記以外の値の場合は `Error`
 */
function parseUnassignedLane(value: string): 'auto' | 'always' {
  if (value === 'auto' || value === 'always') {
    return value;
  }
  throw new Error(`不正な unassignedLane の値です: '${value}'`);
}

/**
 * `<select>` の表示時間帯（`SLOT_RANGE_OPTIONS`）の値を検証しつつ変換する。
 *
 * @throws `SLOT_RANGE_OPTIONS` にない値の場合は `Error`
 */
function parseSlotRangeOption(value: string): (typeof SLOT_RANGE_OPTIONS)[number] {
  const found = SLOT_RANGE_OPTIONS.find((option) => option.value === value);
  if (found === undefined) {
    throw new Error(`不正な表示時間帯の値です: '${value}'`);
  }
  return found;
}

/**
 * `<select>` のタイムラインズーム粒度（`TIMELINE_SCALE_OPTIONS`）の値を検証しつつ変換する。
 *
 * @throws `TIMELINE_SCALE_OPTIONS` にない値の場合は `Error`
 */
function parseTimelineScaleOption(value: string): (typeof TIMELINE_SCALE_OPTIONS)[number] {
  const found = TIMELINE_SCALE_OPTIONS.find((option) => option.value === value);
  if (found === undefined) {
    throw new Error(`不正な timelineScale の値です: '${value}'`);
  }
  return found;
}

/** リソース ID から表示名を求める（`null` は「未割り当て」、`undefined` は空文字）。 */
function resourceTitleFor(
  resources: readonly CalendarResource[],
  resourceId: string | null | undefined,
): string {
  if (resourceId === undefined) {
    return '';
  }
  if (resourceId === null) {
    return '未割り当て';
  }
  return resources.find((entry) => entry.id === resourceId)?.title ?? resourceId;
}

/**
 * 「チーム」パターンのルートコンポーネント。
 */
export function TeamPattern(): ReactElement {
  const memberResources = useMemo(() => makeManyResources(RESOURCE_COUNT), []);
  // 200 人のメンバー（フラット）に、階層グルーピングのデモ用リソース
  // （拠点＞フロア＞会議室）を別グループとして追加する。
  const resources = useMemo(
    () => [...memberResources, ...HIERARCHICAL_RESOURCES],
    [memberResources],
  );
  const events = useMemo(() => {
    const memberEvents = makeManyEvents(memberResources, EVENT_DAYS);
    // 宣言的な重なり制約のデモ用に、先頭の 1 件へ overlap: false を付与する
    // （このイベントには他の予定を重ねてドラッグ/リサイズ/新規作成できなくなる）。
    const [firstEvent, ...restEvents] = memberEvents;
    const eventsWithOverlapSample =
      firstEvent === undefined ? memberEvents : [{ ...firstEvent, overlap: false }, ...restEvents];
    return [...eventsWithOverlapSample, ...HIERARCHICAL_EVENTS];
  }, [memberResources]);

  const calendar = useCalendar({
    initialView: 'resource',
    locale: 'ja',
    events,
    resources,
    timeZone: 'Asia/Tokyo',
    listDays: LIST_DAYS,
    timelineDays: TIMELINE_DAYS,
    businessHours: BUSINESS_HOURS,
    initialCollapsedResourceIds: INITIAL_COLLAPSED_RESOURCE_IDS,
    // 現在時刻線・「今日」判定を 1 分ごとに追従させる
    refreshSeconds: 60,
  });
  const { api, state } = calendar;

  const [unassignedTasks, setUnassignedTasks] = useState<readonly UnassignedTask[]>(INITIAL_TASKS);
  const [logEntries, setLogEntries] = useState<readonly LogEntry[]>([]);
  // slotMinTime/slotMaxTime の <select> 表示専用の値（実際の適用は state.options 側）。
  const [slotRangeValue, setSlotRangeValue] = useState<string>('full');

  const containerRef = useRef<HTMLDivElement>(null);
  const resourceViewRef = useRef<VirtualResourceViewHandle>(null);
  const timelineViewRef = useRef<VirtualTimelineViewHandle>(null);

  /** 変更ログに 1 行追記する（最新 {@link MAX_LOG_ENTRIES} 件のみ保持）。 */
  const pushLog = useCallback((text: string) => {
    setLogEntries((prev) => [{ id: crypto.randomUUID(), text }, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  /** インタラクション中の想定外エラーをログに出す。 */
  const handleError = useCallback(
    (error: unknown) => {
      pushLog(`エラー: ${String(error)}`);
    },
    [pushLog],
  );

  /** ドラッグ移動・リサイズ（リソース/タイムラインをまたぐ移動を含む）をログに追記する。 */
  const handleEventChange = useCallback(
    (change: EventChange) => {
      const { timeZone, resources: currentResources } = api.getState();
      const formatter = new Intl.DateTimeFormat('ja', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const resourceLabel =
        change.resourceId !== undefined
          ? `（${resourceTitleFor(currentResources, change.resourceId)}）`
          : '';
      pushLog(
        `移動: ${change.occurrence.event.title}${resourceLabel} ${formatter.format(change.newRange.start)}〜${formatter.format(change.newRange.end)}`,
      );
    },
    [api, pushLog],
  );

  const callbacks: CalendarInteractionCallbacks = useMemo(
    () => ({ onEventChange: handleEventChange, onError: handleError }),
    [handleEventChange, handleError],
  );

  /**
   * サイドバーの未割り当てタスクがカレンダー上にドロップされたときに呼ばれる。
   * ドロップ先のリソース（`info.resourceId`。`null` は未割り当てレーン）に
   * `api.createEvent` で予定を作成し、割り当て済みタスクを一覧から取り除く。
   */
  const handleExternalDrop = useCallback(
    (info: ExternalDropInfo<UnassignedTask>) => {
      const { timeZone, resources: currentResources } = api.getState();
      const end = info.allDay
        ? info.range.end
        : addMinutesInZone(info.range.start, info.payload.durationMinutes, timeZone);
      api.createEvent({
        title: info.payload.title,
        start: info.range.start,
        end,
        ...(info.allDay ? { allDay: true } : {}),
        ...(info.resourceId !== undefined && info.resourceId !== null
          ? { resourceId: info.resourceId }
          : {}),
      });
      setUnassignedTasks((prev) => prev.filter((task) => task.id !== info.payload.id));

      const formatter = new Intl.DateTimeFormat('ja', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const resourceLabel = resourceTitleFor(currentResources, info.resourceId ?? null);
      pushLog(
        `割当: ${info.payload.title} → ${resourceLabel}（${formatter.format(info.range.start)}〜）`,
      );
    },
    [api, pushLog],
  );

  const externalDrag = useExternalDrag<UnassignedTask>({
    calendar,
    containerRef,
    onExternalDrop: handleExternalDrop,
    onError: handleError,
  });

  /**
   * 「リソースへジャンプ」の選択を、現在アクティブなビュー（リソース/タイムライン）の
   * `scrollToResource` に転送する。リスト表示中は転送先が無いため何もしない
   * （`<select>` 自体も disabled にしている）。
   */
  const handleJumpToResource = useCallback(
    (value: string) => {
      if (value === '') {
        return;
      }
      const resourceId = value === UNASSIGNED_OPTION_VALUE ? null : value;
      if (state.view === 'resource') {
        resourceViewRef.current?.scrollToResource(resourceId, { align: 'center' });
      } else if (state.view === 'timeline') {
        timelineViewRef.current?.scrollToResource(resourceId, { align: 'center' });
      }
    },
    [state.view],
  );

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('ja', {
        timeZone: state.timeZone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }).format(state.currentDate),
    [state.currentDate, state.timeZone],
  );

  return (
    <div className="team-pattern demo-app">
      <header className="demo-header">
        <h2 className="demo-title">チームスケジューラー</h2>
        <div className="demo-controls">
          <div className="team-view-tabs">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className="team-view-tab"
                aria-current={state.view === tab.value ? 'page' : undefined}
                onClick={() => api.setView(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="team-nav">
            <button
              type="button"
              className="team-nav-button"
              aria-label="前の期間へ"
              onClick={() => api.prev()}
            >
              ←
            </button>
            <button type="button" className="team-nav-button" onClick={() => api.today()}>
              今日
            </button>
            <button
              type="button"
              className="team-nav-button"
              aria-label="次の期間へ"
              onClick={() => api.next()}
            >
              →
            </button>
            <span className="team-nav-date">{dateLabel}</span>
          </div>

          <label className="demo-control" htmlFor="team-snap-select">
            <span>ドラッグ・リサイズの単位</span>
            <select
              id="team-snap-select"
              name="snapMinutes"
              value={String(state.options.snapMinutes)}
              onChange={(event) =>
                api.updateOptions({ snapMinutes: parseSnapMinutes(event.target.value) })
              }
            >
              {SNAP_MINUTES_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} 分
                </option>
              ))}
            </select>
          </label>

          <label className="demo-control" htmlFor="team-unassigned-lane-select">
            <span>未割り当てレーン</span>
            <select
              id="team-unassigned-lane-select"
              name="unassignedLane"
              value={state.options.unassignedLane}
              onChange={(event) =>
                api.updateOptions({ unassignedLane: parseUnassignedLane(event.target.value) })
              }
            >
              <option value="auto">自動 (auto)</option>
              <option value="always">常に表示 (always)</option>
            </select>
          </label>

          <label className="demo-control" htmlFor="team-jump-select">
            <span>リソースへジャンプ</span>
            <select
              id="team-jump-select"
              name="jumpToResource"
              value=""
              disabled={state.view === 'list'}
              onChange={(event) => handleJumpToResource(event.target.value)}
            >
              <option value="" disabled>
                選択してください
              </option>
              <option value={UNASSIGNED_OPTION_VALUE}>未割り当て</option>
              {state.resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.title}
                </option>
              ))}
            </select>
          </label>

          <label className="demo-control" htmlFor="team-overlap-toggle">
            <input
              id="team-overlap-toggle"
              type="checkbox"
              checked={!state.options.eventOverlap}
              onChange={(event) => api.updateOptions({ eventOverlap: !event.target.checked })}
            />
            <span>予定の重なりを禁止</span>
          </label>

          <label className="demo-control" htmlFor="team-constraint-toggle">
            <input
              id="team-constraint-toggle"
              type="checkbox"
              checked={state.options.eventConstraint === 'businessHours'}
              onChange={(event) =>
                api.updateOptions({
                  eventConstraint: event.target.checked ? 'businessHours' : null,
                })
              }
            />
            <span>営業時間内に制限</span>
          </label>

          <label className="demo-control" htmlFor="team-slot-range-select">
            <span>表示時間帯</span>
            <select
              id="team-slot-range-select"
              name="slotRange"
              value={slotRangeValue}
              onChange={(event) => {
                const option = parseSlotRangeOption(event.target.value);
                setSlotRangeValue(option.value);
                api.updateOptions({
                  slotMinTime: option.slotMinTime,
                  slotMaxTime: option.slotMaxTime,
                });
              }}
            >
              {SLOT_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="team-nav-button"
            disabled={state.view !== 'resource'}
            onClick={() => resourceViewRef.current?.scrollToTime(SCROLL_TO_TIME_TARGET)}
          >
            {SCROLL_TO_TIME_TARGET} へスクロール
          </button>

          <label className="demo-control" htmlFor="team-timeline-scale-select">
            <span>タイムラインの粒度</span>
            <select
              id="team-timeline-scale-select"
              name="timelineScale"
              value={state.options.timelineScale}
              onChange={(event) => {
                const option = parseTimelineScaleOption(event.target.value);
                api.updateOptions({
                  timelineScale: option.value,
                  timelineDays: option.timelineDays,
                });
              }}
            >
              {TIMELINE_SCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="team-body">
        <aside className="team-sidebar">
          <h3 className="team-sidebar-title">未割り当てタスク</h3>
          <p className="team-sidebar-hint">
            タスクをカレンダー（リソース/タイムライン表示）へドラッグ&ドロップすると、ドロップ先のリソースに割り当てられます。リスト表示中はドロップを受け付けません。
          </p>
          {unassignedTasks.length === 0 ? (
            <p className="team-task-empty">割り当て待ちのタスクはありません。</p>
          ) : (
            <ul className="team-task-list">
              {unassignedTasks.map((task) => (
                <li key={task.id} className="team-task" {...externalDrag.getDraggableProps(task)}>
                  <span className="team-task-title">{task.title}</span>
                  <span className="team-task-duration">{task.durationMinutes} 分</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* CalendarView を使わず個別ビューを描画するため、デフォルトテーマの適用
            スコープ（CSS 変数の定義先）である data-koyomi="root" を自前で付ける
            （docs/theming.md の規約。これが無いと --koyomi-bg 等が解決されず、
            sticky ヘッダーの背景が透明になる等、テーマが部分的に壊れる） */}
        <div ref={containerRef} className="team-calendar-frame" data-koyomi="root">
          <CalendarProvider value={calendar} callbacks={callbacks}>
            {state.view === 'resource' && (
              <VirtualResourceView
                ref={resourceViewRef}
                initialScrollTime={SCROLL_TO_TIME_TARGET}
              />
            )}
            {state.view === 'timeline' && <VirtualTimelineView ref={timelineViewRef} />}
            {state.view === 'list' && <VirtualListView />}
          </CalendarProvider>
        </div>
      </div>

      <section className="demo-log" aria-live="polite">
        <h2 className="demo-log-title">変更ログ</h2>
        {logEntries.length === 0 ? (
          <p className="demo-log-empty">
            まだ変更はありません。サイドバーのタスクをカレンダーへドラッグするか、予定を移動・リサイズしてみてください。
          </p>
        ) : (
          <ul className="demo-log-list">
            {logEntries.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ul>
        )}
        <p className="demo-log-hint">
          「東京拠点」配下は拠点＞フロア＞会議室の 3 段階層リソース（`parentId`）の例です。
          タイムライン表示で折りたたみボタンを確認できます（「東京
          2F」は初期状態で折りたたみ済み）。 「予定の重なりを禁止」は<code>eventOverlap</code>
          、先頭のメンバーの予定 1 件は個別の
          <code>overlap: false</code>
          の例で、他の予定を重ねてドラッグ・作成できません。「表示時間帯」・ 「
          {SCROLL_TO_TIME_TARGET} へスクロール」は<code>slotMinTime</code>/<code>slotMaxTime</code>/
          <code>initialScrollTime</code>/<code>scrollToTime</code>
          （リソース表示のみ）、「タイムラインの粒度」は<code>timelineScale</code>の例です。
        </p>
      </section>
    </div>
  );
}
