/**
 * @packageDocumentation
 * `StressPattern` — 「ストレステスト」パターン（`#/stress`）。
 *
 * 件数可変（スライダー）の大量データでカレンダーの初回描画時間と編集操作
 * （作成・更新・削除）の所要時間を計測するストレステスト。データはベンチマーク
 * スイート（`bench/`）と共有する決定的な生成関数（`makeManyResources` /
 * `makeStressEvents`）で作る。
 *
 * 設定はハッシュのクエリパラメータ（例:
 * `#/stress?events=10000&resources=100&view=timeline`）と同期し、URL だけで
 * 同じ構成を再現できる。ベンチマークスイートはこの URL 指定でページを開き、
 * 本パターンが `data-stress-*` 属性として公開する計測結果を読み取る。
 *
 * - `data-stress-events` / `data-stress-resources` — 適用中の設定値
 * - `data-stress-generated` — 実際に生成されたイベント件数（常に `events` と一致）
 * - `data-stress-generate-ms` — データ生成の所要時間（ミリ秒）
 * - `data-stress-ready` / `data-stress-render-ms` — 初回描画の完了フラグと所要時間
 *   （マウント開始からペイント完了まで。ミリ秒）
 * - `data-stress-mutate`（トリガー用ボタン） — クリックすると
 *   `createEvent`/`updateEvent`/`deleteEvent` を {@link MUTATE_BATCH_SIZE} 件ずつ
 *   一括実行する（ベンチマークはクリックでのみ計測を開始する。URL クエリや
 *   `window` 経由のトリガーは提供しない）
 * - `data-stress-mutate-count` / `data-stress-mutate-create-ms` /
 *   `data-stress-mutate-update-ms` / `data-stress-mutate-delete-ms` —
 *   直近の編集操作計測の一括件数と各フェーズの所要時間（ミリ秒）
 */

import {
  CalendarProvider,
  dateKeyInZone,
  type EventId,
  useCalendar,
  VirtualListView,
  VirtualResourceView,
  VirtualTimelineView,
} from '@koyomi-cal/react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { makeManyResources, makeStressEvents } from '../sample-data';
import './stress.css';

/** ストレステストで切り替えられるビュー（いずれも仮想化コンポーネント）。 */
type StressView = 'resource' | 'timeline' | 'list';

/** ストレステストの適用中設定（イベント件数 × リソース件数 × ビュー）。 */
interface StressConfig {
  /** 生成するイベント総件数。 */
  events: number;
  /** 生成するリソース件数。 */
  resources: number;
  /** 表示するビュー。 */
  view: StressView;
}

/** スライダー（と URL クエリのクランプ）の範囲。 */
interface CountRange {
  /** 最小値。 */
  min: number;
  /** 最大値。 */
  max: number;
  /** スライダーの刻み幅。 */
  step: number;
}

/** イベント件数の範囲（100〜10,000 件）。 */
const EVENT_RANGE: CountRange = { min: 100, max: 10_000, step: 100 };

/** リソース件数の範囲（10〜1,000 件）。 */
const RESOURCE_RANGE: CountRange = { min: 10, max: 1_000, step: 10 };

/** クエリ無しで開いたときの既定設定。 */
const DEFAULT_CONFIG: StressConfig = { events: 1_000, resources: 100, view: 'timeline' };

/** ビュータブの選択肢。 */
const VIEW_TABS: readonly { value: StressView; label: string }[] = [
  { value: 'resource', label: 'リソース' },
  { value: 'timeline', label: 'タイムライン' },
  { value: 'list', label: 'リスト' },
];

/** タイムラインビューの表示日数。 */
const TIMELINE_DAYS = 7;

/** リストビューの表示日数。 */
const LIST_DAYS = 30;

/**
 * 編集操作ベンチマークで一括実行する件数（`createEvent`/`updateEvent`/
 * `deleteEvent` それぞれ）。作成した予定は計測の最後に必ず削除するため、
 * 計測後もカレンダーのイベント総数は変化しない。
 */
const MUTATE_BATCH_SIZE = 200;

/** 編集操作ベンチマーク 1 回分の計測結果（各フェーズの合計所要時間、ミリ秒）。 */
interface MutationBenchmarkResult {
  /** {@link MUTATE_BATCH_SIZE} 件の `createEvent` の合計所要時間。 */
  createMs: number;
  /** {@link MUTATE_BATCH_SIZE} 件の `updateEvent` の合計所要時間。 */
  updateMs: number;
  /** {@link MUTATE_BATCH_SIZE} 件の `deleteEvent` の合計所要時間。 */
  deleteMs: number;
}

/** 文字列を整数として解釈し、範囲にクランプする（解釈できなければ既定値）。 */
function clampCount(value: string | null, range: CountRange, fallback: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, parsed));
}

/** 文字列が有効な {@link StressView} ならそれを、そうでなければ既定のビューを返す。 */
function parseView(value: string | null): StressView {
  return value === 'resource' || value === 'timeline' || value === 'list'
    ? value
    : DEFAULT_CONFIG.view;
}

/**
 * `location.hash`（例: `#/stress?events=1000&resources=100&view=timeline`）から
 * ストレステストの設定を読み取る。不正・範囲外の値は既定値・範囲内へ丸める。
 */
function parseStressQuery(hash: string): StressConfig {
  const queryIndex = hash.indexOf('?');
  const params = new URLSearchParams(queryIndex === -1 ? '' : hash.slice(queryIndex + 1));
  return {
    events: clampCount(params.get('events'), EVENT_RANGE, DEFAULT_CONFIG.events),
    resources: clampCount(params.get('resources'), RESOURCE_RANGE, DEFAULT_CONFIG.resources),
    view: parseView(params.get('view')),
  };
}

/**
 * 設定をハッシュのクエリパラメータへ反映する。`hashchange` を発火させない
 * `history.replaceState` を使い、パターン自体の再マウントを避ける。
 */
function writeStressQuery(config: StressConfig): void {
  window.history.replaceState(
    null,
    '',
    `#/stress?events=${config.events}&resources=${config.resources}&view=${config.view}`,
  );
}

/** {@link StressCalendar} の props。 */
interface StressCalendarProps {
  /** 適用中の設定。変更時は親が `key` を替えて再マウントし、計測をやり直す。 */
  config: StressConfig;
}

/**
 * 設定 1 回分のカレンダー本体。マウント開始からペイント完了までを
 * 初回描画時間として計測し、`data-stress-*` 属性と画面表示の両方へ公開する。
 */
function StressCalendar({ config }: StressCalendarProps): ReactElement {
  // 初回レンダー突入時刻。データ生成（useMemo）より前に一度だけ記録し、
  // 「データ生成 + React レンダー + ペイント」の合計を初回描画時間とする。
  const renderStartRef = useRef<number | null>(null);
  if (renderStartRef.current === null) {
    renderStartRef.current = performance.now();
  }
  const renderStart = renderStartRef.current;

  const data = useMemo(() => {
    const start = performance.now();
    const resources = makeManyResources(config.resources);
    const events = makeStressEvents(resources, config.events);
    return { resources, events, generateMs: performance.now() - start };
  }, [config.events, config.resources]);

  const calendar = useCalendar({
    initialView: config.view,
    locale: 'ja',
    timeZone: 'Asia/Tokyo',
    events: data.events,
    resources: data.resources,
    timelineDays: TIMELINE_DAYS,
    listDays: LIST_DAYS,
  });

  const [renderMs, setRenderMs] = useState<number | null>(null);
  useEffect(() => {
    // ダブル rAF: マウント直後のフレームの次のフレーム開始時点＝初回ペイント
    // 完了直後の時刻を採取する。
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        setRenderMs(performance.now() - renderStart);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [renderStart]);

  const [mutation, setMutation] = useState<MutationBenchmarkResult | null>(null);
  const { api } = calendar;

  /**
   * 「編集操作を計測」ボタンのクリックハンドラ。
   *
   * `createEvent` → `updateEvent` → `deleteEvent` を {@link MUTATE_BATCH_SIZE}
   * 件ずつ順に一括実行し、フェーズごとの合計所要時間を計測する。作成した予定は
   * 計測の最後にすべて削除するため、計測前後でイベント総数は変化しない。
   */
  function runMutationBenchmark(): void {
    const day = dateKeyInZone(new Date(), 'Asia/Tokyo');

    const createStart = performance.now();
    const createdIds: EventId[] = [];
    for (let index = 0; index < MUTATE_BATCH_SIZE; index += 1) {
      const created = api.createEvent({
        title: `編集ベンチ ${index}`,
        start: `${day}T09:00:00`,
        end: `${day}T09:30:00`,
      });
      createdIds.push(created.id);
    }
    const createMs = performance.now() - createStart;

    const updateStart = performance.now();
    for (const id of createdIds) {
      api.updateEvent(id, { title: '編集ベンチ（更新後）' });
    }
    const updateMs = performance.now() - updateStart;

    const deleteStart = performance.now();
    for (const id of createdIds) {
      api.deleteEvent(id);
    }
    const deleteMs = performance.now() - deleteStart;

    setMutation({ createMs, updateMs, deleteMs });
  }

  return (
    <div
      className="stress-calendar"
      data-stress-frame="true"
      data-stress-events={config.events}
      data-stress-resources={config.resources}
      data-stress-generated={data.events.length}
      data-stress-generate-ms={data.generateMs.toFixed(1)}
      {...(renderMs === null
        ? {}
        : { 'data-stress-ready': 'true', 'data-stress-render-ms': renderMs.toFixed(1) })}
      {...(mutation === null
        ? {}
        : {
            'data-stress-mutate-count': MUTATE_BATCH_SIZE,
            'data-stress-mutate-create-ms': mutation.createMs.toFixed(1),
            'data-stress-mutate-update-ms': mutation.updateMs.toFixed(1),
            'data-stress-mutate-delete-ms': mutation.deleteMs.toFixed(1),
          })}
    >
      <p className="stress-measure" aria-live="polite">
        {`イベント ${config.events.toLocaleString('ja-JP')} 件 × リソース ${config.resources.toLocaleString('ja-JP')} 件 — `}
        {`データ生成 ${data.generateMs.toFixed(1)} ms / 初回描画 `}
        {renderMs === null ? '計測中…' : `${renderMs.toFixed(1)} ms`}
      </p>
      <div className="stress-mutate-panel">
        <button
          type="button"
          className="stress-mutate-button"
          data-stress-mutate="true"
          onClick={runMutationBenchmark}
        >
          {`編集操作を計測（作成・更新・削除 各 ${MUTATE_BATCH_SIZE.toLocaleString('ja-JP')} 件）`}
        </button>
        {mutation !== null && (
          <p className="stress-mutate-result" aria-live="polite">
            {`作成 ${mutation.createMs.toFixed(1)} ms / 更新 ${mutation.updateMs.toFixed(1)} ms / 削除 ${mutation.deleteMs.toFixed(1)} ms`}
          </p>
        )}
      </div>
      {/* CalendarView を使わず個別ビューを描画するため、デフォルトテーマの適用
          スコープである data-koyomi="root" を自前で付ける（docs/theming.md）。 */}
      <div className="stress-calendar-frame" data-koyomi="root">
        <CalendarProvider value={calendar}>
          {config.view === 'resource' && <VirtualResourceView />}
          {config.view === 'timeline' && <VirtualTimelineView />}
          {config.view === 'list' && <VirtualListView />}
        </CalendarProvider>
      </div>
    </div>
  );
}

/**
 * 「ストレステスト」パターンのルートコンポーネント。
 *
 * スライダーで件数を選び「適用して再計測」で反映する（スライダー操作中は
 * 再生成しない）。設定が替わるたびに {@link StressCalendar} を `key` で
 * 再マウントし、初回描画時間を計測し直す。
 */
export function StressPattern(): ReactElement {
  const [config, setConfig] = useState<StressConfig>(() => parseStressQuery(window.location.hash));
  const [pendingEvents, setPendingEvents] = useState(config.events);
  const [pendingResources, setPendingResources] = useState(config.resources);

  /** 設定を適用し、URL（ハッシュのクエリ）にも反映する。 */
  const applyConfig = (next: StressConfig): void => {
    setConfig(next);
    writeStressQuery(next);
  };

  return (
    <div className="stress-pattern demo-app">
      <header className="demo-header">
        <h2 className="demo-title">ストレステスト</h2>
        <div className="demo-controls">
          <div className="stress-view-tabs">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className="stress-view-tab"
                aria-current={config.view === tab.value ? 'page' : undefined}
                onClick={() => applyConfig({ ...config, view: tab.value })}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label className="demo-control" htmlFor="stress-events-slider">
            <span>イベント件数: {pendingEvents.toLocaleString('ja-JP')}</span>
            <input
              id="stress-events-slider"
              type="range"
              min={EVENT_RANGE.min}
              max={EVENT_RANGE.max}
              step={EVENT_RANGE.step}
              value={pendingEvents}
              onChange={(event) => setPendingEvents(Number(event.target.value))}
            />
          </label>

          <label className="demo-control" htmlFor="stress-resources-slider">
            <span>リソース件数: {pendingResources.toLocaleString('ja-JP')}</span>
            <input
              id="stress-resources-slider"
              type="range"
              min={RESOURCE_RANGE.min}
              max={RESOURCE_RANGE.max}
              step={RESOURCE_RANGE.step}
              value={pendingResources}
              onChange={(event) => setPendingResources(Number(event.target.value))}
            />
          </label>

          <button
            type="button"
            className="stress-apply-button"
            onClick={() =>
              applyConfig({ ...config, events: pendingEvents, resources: pendingResources })
            }
          >
            適用して再計測
          </button>
        </div>
      </header>

      <StressCalendar key={`${config.events}-${config.resources}-${config.view}`} config={config} />

      <p className="stress-hint">
        件数・表示は URL のクエリ（例:{' '}
        <code>#/stress?events=10000&amp;resources=100&amp;view=timeline</code>
        ）と同期し、同じ構成を URL だけで再現できます。性能ベンチマーク（
        <code>pnpm bench</code>）はこのページを同じデータ生成コードで開いて計測します。
      </p>
    </div>
  );
}
