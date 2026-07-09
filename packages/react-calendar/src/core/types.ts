/**
 * @packageDocumentation
 * Koyomi のコア型定義。
 *
 * このファイルはライブラリ全体の「仕様」であり、core / react の全モジュールが
 * この型定義に従って実装される。core モジュールは React に依存しない。
 */

/**
 * カレンダーのビュー種別。
 *
 * - `month` — 月表示（グリッド）
 * - `week` — 週表示（時間グリッド、7日）
 * - `day` — 日表示（時間グリッド、1日）
 * - `list` — リスト表示（予定を日付ごとに列挙）
 * - `year` — 年表示（12 ヶ月分のミニ月グリッド）
 * - `multiMonth` — 複数月表示（連続する N ヶ月の月グリッドを縦に並べる）
 */
export type CalendarViewType = 'month' | 'week' | 'day' | 'list' | 'year' | 'multiMonth';

/**
 * IANA タイムゾーン ID。
 *
 * @example 'Asia/Tokyo', 'America/New_York', 'UTC'
 */
export type TimeZoneId = string;

/** イベントを一意に識別する ID。 */
export type EventId = string;

/** 曜日番号。0 = 日曜日、1 = 月曜日、…、6 = 土曜日。 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 日時範囲。`end` は排他的（範囲に含まれない）。
 */
export interface DateRange {
  /** 範囲の開始（含む）。 */
  start: Date;
  /** 範囲の終了（含まない）。 */
  end: Date;
}

/**
 * カレンダーイベント（ソースデータ）。
 *
 * 利用者がカレンダーに与える予定の定義。繰り返し予定の場合は 1 件の
 * `CalendarEvent` が複数の {@link EventOccurrence}（オカレンス）に展開される。
 *
 * @remarks
 * - 終日イベント（`allDay: true`）の `start` / `end` は日付として解釈され、
 *   `end` は **排他的**（例: 7/1〜7/2 の 2 日間の予定は `start: '2026-07-01'`,
 *   `end: '2026-07-03'`）。
 * - 時間指定イベントの `end` も排他的（`start <= t < end` の区間を占有する）。
 * - 文字列で日時を与える場合は ISO 8601 形式。オフセットなしの文字列
 *   （例: `'2026-07-01T10:00:00'`）は `timeZone`（未指定ならカレンダーの
 *   表示タイムゾーン）の現地時刻として解釈される。
 */
export interface CalendarEvent {
  /** 一意な ID。繰り返し例外（オーバーライド）イベントも独自の ID を持つ。 */
  id: EventId;
  /** 予定のタイトル。 */
  title: string;
  /** 開始日時。終日イベントの場合は日付（`'YYYY-MM-DD'` も可）。 */
  start: Date | string;
  /**
   * 終了日時（排他的）。終日イベントの場合は日付（排他的）。
   * 省略時は、時間指定イベントは開始から {@link CalendarOptions.defaultEventMinutes} 分、
   * 終日イベントは 1 日とみなす。
   */
  end?: Date | string;
  /** 終日イベントかどうか。既定は `false`。 */
  allDay?: boolean;
  /**
   * このイベントのタイムゾーン。
   * 繰り返しの展開（「毎日 9:00」の現地時刻の維持、DST 跨ぎ）に使用される。
   * 省略時はカレンダーの表示タイムゾーン。
   */
  timeZone?: TimeZoneId;
  /**
   * RFC 5545 の繰り返しルール。
   * `'FREQ=WEEKLY;BYDAY=MO,WE'` のような本体のみ、または
   * `'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'` 形式を受け付ける。
   * `DTSTART` は {@link CalendarEvent.start} から自動的に補われる。
   */
  rrule?: string;
  /**
   * 繰り返しから除外するオカレンスの開始日時（EXDATE 相当）。
   * 「この予定のみ削除」したオカレンスがここに追加される。
   */
  exdates?: readonly (Date | string)[];
  /**
   * 繰り返しに追加するオカレンスの開始日時（RFC 5545 の RDATE 相当）。
   * `rrule` のパターン外の日時にオカレンスを追加できる。`rrule` と併用でき、
   * `rrule` なしで `rdates` のみの指定も可能（`start` ＋ `rdates` がオカレンスになる）。
   * `exdates` と重複する日時は除外が優先される。
   */
  rdates?: readonly (Date | string)[];
  /**
   * 繰り返し例外（オーバーライド）イベントの場合、元となる繰り返しイベントの ID。
   * 「この予定のみ変更」した場合に、変更後の単発イベントがこの参照を持つ。
   */
  recurringEventId?: EventId;
  /**
   * 繰り返し例外イベントの場合、置き換え対象となるオカレンスの本来の開始日時。
   * 展開時に、この日時のオカレンスがオーバーライドの内容で置き換えられる。
   */
  originalStart?: Date | string;
  /** 表示色。デフォルトテーマでは背景色として使用される（CSS の color 値）。 */
  color?: string;
  /** 場所。 */
  location?: string;
  /** 説明文。 */
  description?: string;
  /**
   * ドラッグ移動・リサイズを許可するか。既定は `true`。
   * `false` の場合、表示・クリックは可能だが変更操作は無効になる。
   */
  editable?: boolean;
  /** 利用者定義の任意データ。ライブラリは内容に関知しない。 */
  extendedProps?: Record<string, unknown>;
}

/**
 * イベントのオカレンス。
 *
 * {@link CalendarEvent} を表示範囲に対して展開した結果の 1 回分。
 * 単発イベントは 1 件のオカレンスになり、繰り返しイベントは範囲内の回数分の
 * オカレンスになる。`start` / `end` は絶対時刻（時点）。
 */
export interface EventOccurrence {
  /**
   * オカレンスを一意に識別するキー。React の `key` などに利用できる。
   * 形式: `` `${eventId}@${startのISO文字列}` ``
   */
  key: string;
  /** 元イベントの ID（オーバーライドの場合はオーバーライドイベントの ID）。 */
  eventId: EventId;
  /** 元の {@link CalendarEvent}（オーバーライドの場合はオーバーライドイベント）。 */
  event: CalendarEvent;
  /** このオカレンスの開始（絶対時刻）。 */
  start: Date;
  /** このオカレンスの終了（絶対時刻、排他的）。 */
  end: Date;
  /** 終日イベントかどうか。 */
  allDay: boolean;
  /** 繰り返しイベント由来のオカレンスかどうか（オーバーライド含む）。 */
  isRecurring: boolean;
  /**
   * 繰り返し由来の場合、このオカレンスの本来の開始日時。
   * 「この予定のみ変更/削除」の照合キーとして使用する。
   * オーバーライドの場合は元のオカレンスの開始日時、それ以外は `start` と同値。
   */
  originalStart: Date;
}

/**
 * 繰り返しイベントの編集・削除の適用範囲。
 * Google カレンダーの「この予定 / これ以降のすべての予定 / すべての予定」に対応する。
 *
 * - `this` — このオカレンスのみ
 * - `thisAndFollowing` — このオカレンスとそれ以降のすべて
 * - `all` — 繰り返し全体
 */
export type RecurringEditScope = 'this' | 'thisAndFollowing' | 'all';

/**
 * イベントの変更内容（部分更新）。
 * `id` 以外のすべてのフィールドを変更できる。
 *
 * @remarks
 * キーが存在し値が `undefined` のフィールドは「削除」を意味する
 * （例: `{ rrule: undefined }` で繰り返しを解除する。ただし必須フィールドの
 * `title` / `start` は削除されず元の値が維持される）。
 * `exactOptionalPropertyTypes: true` の利用者コードでもこのリテラルを
 * そのまま書けるように、各フィールドは明示的に `| undefined` を許容する。
 */
export type CalendarEventPatch = {
  [K in keyof Omit<CalendarEvent, 'id'>]?: Omit<CalendarEvent, 'id'>[K] | undefined;
};

// ---------------------------------------------------------------------------
// ビューモデル
// ---------------------------------------------------------------------------

/**
 * 週内に配置された帯状のイベントセグメント。
 *
 * 月ビューの各週、および週/日ビューの終日イベント行で使用される。
 * 複数日にまたがるイベントは週ごとに分割され、それぞれがセグメントになる。
 */
export interface EventSegment {
  /** 対応するオカレンス。 */
  occurrence: EventOccurrence;
  /** 週内での開始列（0 起点。週の 1 日目 = 0）。 */
  startCol: number;
  /** 専有する列数（1 以上）。 */
  span: number;
  /** 縦方向のレーン番号（0 起点）。同じレーンのセグメント同士は重ならない。 */
  lane: number;
  /** イベントの実際の開始がこの週より前にあるか（「←続く」表示用）。 */
  continuesBefore: boolean;
  /** イベントの実際の終了がこの週より後にあるか（「続く→」表示用）。 */
  continuesAfter: boolean;
  /**
   * あふれ（`dayMaxEvents` 超過）により非表示にすべきセグメントか。
   * `true` のセグメントは「+N 件」に集約される。
   */
  hidden: boolean;
}

/** 月ビューの 1 日分。 */
export interface MonthDay {
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示タイムゾーンにおける `'YYYY-MM-DD'` 形式のキー。 */
  key: string;
  /** 表示中の月に属する日かどうか（前後月の日付は `false`）。 */
  inCurrentMonth: boolean;
  /** 今日かどうか（表示タイムゾーン基準）。 */
  isToday: boolean;
  /** その日の「+N 件」に集約された非表示イベント数。0 なら全件表示。 */
  overflowCount: number;
}

/** 月ビューの 1 週分。 */
export interface MonthWeek {
  /** この週の 7 日分。 */
  days: readonly MonthDay[];
  /**
   * この週に表示するイベントセグメント（レーン割当済み）。
   * `hidden: true` のものは「+N 件」に集約される。
   */
  segments: readonly EventSegment[];
  /** この週で使用されるレーン数（表示分のみ）。 */
  laneCount: number;
}

/** 月ビューのビューモデル。 */
export interface MonthViewModel {
  type: 'month';
  /** 表示対象月の 1 日（表示タイムゾーンベース）。 */
  anchor: Date;
  /** 週の配列（4〜6 週）。 */
  weeks: readonly MonthWeek[];
  /** 曜日ヘッダー（週開始曜日の設定順）。 */
  weekdays: readonly Weekday[];
}

/**
 * 時間グリッド（週/日ビュー）に配置されたオカレンス。
 * 位置はすべて割合・分単位で表現され、ピクセルには依存しない。
 */
export interface PositionedOccurrence {
  /** 対応するオカレンス。 */
  occurrence: EventOccurrence;
  /** 日内での表示開始（その日の 0:00 からの分。日をまたぐ場合はクランプ済み）。 */
  startMinutes: number;
  /** 日内での表示終了（分、排他的。日をまたぐ場合はクランプ済み）。 */
  endMinutes: number;
  /** 水平位置の左端（0〜1 の割合）。 */
  left: number;
  /** 水平方向の幅（0〜1 の割合）。 */
  width: number;
  /** オカレンスがこの日より前から続いているか。 */
  continuesBefore: boolean;
  /** オカレンスがこの日より後に続くか。 */
  continuesAfter: boolean;
}

/** 時間グリッドビューの 1 日分。 */
export interface TimeGridDay {
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示タイムゾーンにおける `'YYYY-MM-DD'` 形式のキー。 */
  key: string;
  /** 今日かどうか（表示タイムゾーン基準）。 */
  isToday: boolean;
  /** 曜日（表示タイムゾーン基準）。 */
  weekday: Weekday;
  /** この日に配置された時間指定イベント。 */
  items: readonly PositionedOccurrence[];
}

/** 時間グリッドの目盛り 1 つ分。 */
export interface TimeSlot {
  /** その日の 0:00 からの分。 */
  minutes: number;
  /** 表示ラベル（例: `'09:00'`）。 */
  label: string;
}

/** 週/日ビュー（時間グリッド）のビューモデル。 */
export interface TimeGridViewModel {
  type: 'timeGrid';
  /** `'week'` または `'day'`。 */
  viewType: 'week' | 'day';
  /** 表示する日（週なら 7 日、日なら 1 日）。 */
  days: readonly TimeGridDay[];
  /** 終日イベント行のセグメント（週単位の帯レイアウト、レーン割当済み）。 */
  allDaySegments: readonly EventSegment[];
  /** 終日イベント行のレーン数。 */
  allDayLaneCount: number;
  /** 時間軸の目盛り（{@link CalendarOptions.slotMinutes} 間隔）。 */
  slots: readonly TimeSlot[];
  /** 現在時刻線の位置。表示範囲内に「今日」がない場合は `null`。 */
  nowIndicator: {
    /** 今日の列の `key`（`'YYYY-MM-DD'`）。 */
    dayKey: string;
    /** その日の 0:00 からの分。 */
    minutes: number;
  } | null;
}

/** リストビューの 1 日分。予定のある日のみ生成される。 */
export interface ListDay {
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示タイムゾーンにおける `'YYYY-MM-DD'` 形式のキー。 */
  key: string;
  /** 今日かどうか（表示タイムゾーン基準）。 */
  isToday: boolean;
  /** その日に発生する予定（開始時刻順。終日イベントが先頭）。 */
  occurrences: readonly EventOccurrence[];
}

/** リストビューのビューモデル。 */
export interface ListViewModel {
  type: 'list';
  /** 予定のある日の配列（日付順）。 */
  days: readonly ListDay[];
  /** 表示範囲内に予定が 1 件もないか。 */
  isEmpty: boolean;
}

/** 年ビューのミニ月グリッドの 1 日分。 */
export interface YearDay {
  /** その日の開始時刻（表示タイムゾーンにおける 0:00 の絶対時刻）。 */
  date: Date;
  /** 表示タイムゾーンにおける `'YYYY-MM-DD'` 形式のキー。 */
  key: string;
  /** 表示中の月に属する日かどうか（前後月の日付は `false`）。 */
  inCurrentMonth: boolean;
  /** 今日かどうか（表示タイムゾーン基準）。 */
  isToday: boolean;
  /**
   * その日に発生する予定の件数。
   * 複数日にまたがるオカレンスは覆う各日にカウントされる。
   * 前後月の日付（`inCurrentMonth: false`）は常に `0`。
   */
  eventCount: number;
}

/** 年ビューの 1 ヶ月分（ミニ月グリッド）。 */
export interface YearMonth {
  /** 月初の絶対時刻（表示タイムゾーンベース）。 */
  anchor: Date;
  /** `'YYYY-MM'` 形式のキー。 */
  key: string;
  /** 週の配列（4〜6 週、各週は 7 日）。 */
  weeks: readonly (readonly YearDay[])[];
}

/** 年ビューのビューモデル。 */
export interface YearViewModel {
  type: 'year';
  /** 表示対象年の 1 月 1 日（表示タイムゾーンベース）。 */
  anchor: Date;
  /** 12 ヶ月分（1 月〜12 月）。 */
  months: readonly YearMonth[];
  /** 曜日ヘッダー（週開始曜日の設定順）。全ミニ月グリッド共通。 */
  weekdays: readonly Weekday[];
}

/** 複数月ビューの 1 ヶ月分。 */
export interface MultiMonthMonth {
  /** 月初の絶対時刻（表示タイムゾーンベース）。 */
  anchor: Date;
  /** `'YYYY-MM'` 形式のキー。 */
  key: string;
  /**
   * 週の配列（4〜6 週）。月ビューの {@link MonthWeek} と同じ構造だが、
   * 前後月の日付セルにはセグメントを配置しない（帯は月本体にクランプされ、
   * 月境界をまたぐ予定は `continuesBefore` / `continuesAfter` で示される）。
   */
  weeks: readonly MonthWeek[];
}

/** 複数月ビューのビューモデル。 */
export interface MultiMonthViewModel {
  type: 'multiMonth';
  /** 先頭月の 1 日（表示タイムゾーンベース）。 */
  anchor: Date;
  /** {@link CalendarOptions.multiMonthCount} ヶ月分（表示順）。 */
  months: readonly MultiMonthMonth[];
  /** 曜日ヘッダー（週開始曜日の設定順）。全月共通。 */
  weekdays: readonly Weekday[];
}

/** 現在のビューに対応するビューモデル。 */
export type CalendarViewModel =
  | MonthViewModel
  | TimeGridViewModel
  | ListViewModel
  | YearViewModel
  | MultiMonthViewModel;

// ---------------------------------------------------------------------------
// カレンダーの状態とオプション
// ---------------------------------------------------------------------------

/**
 * ドラッグ操作のプレビュー状態。
 *
 * ドラッグによる予定の作成・移動・リサイズの間、確定前の範囲を
 * ハイライト表示するために使用する。
 */
export interface DragPreview {
  /** 操作の種類。 */
  kind: 'create' | 'move' | 'resize';
  /** 移動・リサイズの対象となるオカレンスのキー。作成時は `null`。 */
  occurrenceKey: string | null;
  /** プレビュー中の日時範囲。 */
  range: DateRange;
  /** 終日（帯）としてのプレビューか。 */
  allDay: boolean;
}

/** カレンダーの内部状態のスナップショット。 */
export interface CalendarState {
  /** 現在のビュー。 */
  view: CalendarViewType;
  /** 表示の基準日（アンカー日、絶対時刻）。 */
  currentDate: Date;
  /** 表示タイムゾーン。 */
  timeZone: TimeZoneId;
  /** すべてのソースイベント。 */
  events: readonly CalendarEvent[];
  /** ドラッグ操作のプレビュー。操作中でなければ `null`。 */
  dragPreview: DragPreview | null;
  /** 解決済みのオプション（既定値適用後）。 */
  options: ResolvedCalendarOptions;
}

/**
 * カレンダー作成時のオプション。
 * すべて省略可能で、省略時は {@link ResolvedCalendarOptions} に記載の既定値が使われる。
 */
export interface CalendarOptions {
  /**
   * 初期表示日。既定は現在日時。
   * **作成時のみ有効**。作成後に基準日を変更するには
   * {@link CalendarApi.goTo} / {@link CalendarApi.today} を使う。
   */
  initialDate?: Date;
  /**
   * 初期ビュー。既定は `'month'`。
   * **作成時のみ有効**。作成後にビューを変更するには {@link CalendarApi.setView} を使う。
   */
  initialView?: CalendarViewType;
  /** 初期イベント。 */
  events?: readonly CalendarEvent[];
  /**
   * 表示タイムゾーン。既定は実行環境のローカルタイムゾーン。
   * {@link CalendarApi.setTimeZone} で後から変更できる。
   */
  timeZone?: TimeZoneId;
  /** 週の開始曜日。既定は `0`（日曜日）。 */
  weekStartsOn?: Weekday;
  /** 月ビューで 1 日に表示する最大イベント数。超過分は「+N 件」に集約。既定は `4`。 */
  dayMaxEvents?: number;
  /** ドラッグ操作のスナップ間隔（分）。既定は `15`。 */
  snapMinutes?: number;
  /** 時間グリッドの目盛り間隔（分）。既定は `60`。 */
  slotMinutes?: number;
  /** 時間指定イベントの既定の長さ（分）。`end` 省略時に使用。既定は `60`。 */
  defaultEventMinutes?: number;
  /**
   * 既定作成（`onSelectRange` 未指定時の即時作成）で使うイベントタイトル。
   * ロケールに合わせて差し替えられる。既定は `'(タイトルなし)'`。
   */
  defaultEventTitle?: string;
  /** リストビューが表示する日数。既定は `30`。 */
  listDays?: number;
  /**
   * 複数月ビューが表示する月数。既定は `3`（四半期）。
   * `next()` / `prev()` の移動単位にもなる。
   * `1` も指定できるが、前後月の日付セルに予定を表示しない点で
   * 月ビューの代替にはならない（月ビューは前後月の日付にも帯を描く）。
   */
  multiMonthCount?: number;
  /** 曜日・時刻ラベルのロケール。既定は `'ja'`。 */
  locale?: string;
  /**
   * 非表示にする曜日。月・週ビューの列から除外される
   * （例: `[0, 6]` で週末を隠す）。既定は `[]`（すべて表示）。
   * 7 曜日すべてを指定した場合は無効な設定として無視される。
   */
  hiddenWeekdays?: readonly Weekday[];
  /**
   * 現在時刻を返す関数。「今日」の判定と現在時刻線に使用する。
   * テストでの時刻固定に利用できる。既定は `() => new Date()`。
   */
  now?: () => Date;
  /**
   * イベント一覧が変更されたときに呼ばれるコールバック。
   * 外部ストアと同期する場合に使用する。
   */
  onEventsChange?: (events: readonly CalendarEvent[]) => void;
}

/** 既定値が適用された解決済みオプション。 */
export interface ResolvedCalendarOptions {
  /** 週の開始曜日。 */
  weekStartsOn: Weekday;
  /** 月ビューで 1 日に表示する最大イベント数。 */
  dayMaxEvents: number;
  /** ドラッグ操作のスナップ間隔（分）。 */
  snapMinutes: number;
  /** 時間グリッドの目盛り間隔（分）。 */
  slotMinutes: number;
  /** 時間指定イベントの既定の長さ（分）。 */
  defaultEventMinutes: number;
  /** 既定作成で使うイベントタイトル。 */
  defaultEventTitle: string;
  /** リストビューが表示する日数。 */
  listDays: number;
  /** 複数月ビューが表示する月数。 */
  multiMonthCount: number;
  /** ロケール。 */
  locale: string;
  /** 非表示にする曜日。 */
  hiddenWeekdays: readonly Weekday[];
  /** 現在時刻プロバイダ。 */
  now: () => Date;
}

/**
 * 新規イベント作成の入力。`id` は省略可能（省略時は自動生成される）。
 */
export type CalendarEventInput = Omit<CalendarEvent, 'id'> & { id?: EventId };

// ---------------------------------------------------------------------------
// カレンダー API（フレームワーク非依存のエンジン）
// ---------------------------------------------------------------------------

/**
 * カレンダーエンジンの公開 API。
 *
 * `createCalendar` が返すオブジェクトで、状態の購読・ナビゲーション・
 * イベントの CRUD・ビューモデルの取得を提供する。React からは
 * `useCalendar` フック経由で利用する。
 */
export interface CalendarApi {
  /** 現在の状態のスナップショットを返す。 */
  getState(): CalendarState;
  /**
   * 状態変更の通知を購読する。
   * @param listener - 状態が変わるたびに呼ばれるリスナー
   * @returns 購読を解除する関数
   */
  subscribe(listener: () => void): () => void;

  // --- ナビゲーション ---

  /** ビューを切り替える。 */
  setView(view: CalendarViewType): void;
  /** 現在のビュー単位で次の期間へ移動する（月→翌月、週→翌週、…）。 */
  next(): void;
  /** 現在のビュー単位で前の期間へ移動する。 */
  prev(): void;
  /** 今日へ移動する。 */
  today(): void;
  /** 指定日へ移動する。 */
  goTo(date: Date): void;
  /** 表示タイムゾーンを変更する。 */
  setTimeZone(timeZone: TimeZoneId): void;
  /**
   * オプションを部分的に更新する。
   *
   * `initialView` / `initialDate` は作成時専用のため型レベルで受け付けない
   * （ビュー・基準日の変更には `setView` / `goTo` / `today` を使う）。
   * 値が実際に変わらないパッチでは通知は発生しない。
   */
  updateOptions(patch: Partial<Omit<CalendarOptions, 'initialView' | 'initialDate'>>): void;
  /**
   * ビューモデルを再構築して購読者に通知する。
   *
   * 状態は変更しないが、`now()` が再評価されるため「今日」の判定と
   * 現在時刻線が最新になる。時間経過に追従させる場合に `setInterval` などから
   * 定期的に呼び出す（React では `useCalendar` の `refreshSeconds` を使う）。
   */
  refresh(): void;

  // --- イベント CRUD ---

  /** すべてのソースイベントを返す。 */
  getEvents(): readonly CalendarEvent[];
  /** イベント一覧を置き換える（外部ストアとの同期用）。 */
  setEvents(events: readonly CalendarEvent[]): void;
  /**
   * イベントを作成する。
   * @returns 作成されたイベント（`id` 確定済み）
   */
  createEvent(input: CalendarEventInput): CalendarEvent;
  /**
   * イベントを更新する。
   * @param id - 対象イベントの ID
   * @param patch - 変更内容
   * @param target - 繰り返しイベントの場合の対象オカレンスと適用範囲。
   *   単発イベントでは省略する。
   */
  updateEvent(
    id: EventId,
    patch: CalendarEventPatch,
    target?: { occurrenceStart: Date; scope: RecurringEditScope },
  ): void;
  /**
   * イベントを削除する。
   * @param id - 対象イベントの ID
   * @param target - 繰り返しイベントの場合の対象オカレンスと適用範囲。
   *   単発イベントでは省略する。
   */
  deleteEvent(id: EventId, target?: { occurrenceStart: Date; scope: RecurringEditScope }): void;

  // --- ビューモデル ---

  /** 現在のビューに対応するビューモデルを構築して返す。 */
  getViewModel(): CalendarViewModel;
  /** 現在のビューが表示している日時範囲を返す。 */
  getVisibleRange(): DateRange;
  /** 指定範囲のオカレンス一覧を返す（開始時刻順）。 */
  getOccurrences(range: DateRange): readonly EventOccurrence[];

  // --- ドラッグプレビュー ---

  /** ドラッグ操作のプレビューを設定する（`null` で解除）。 */
  setDragPreview(preview: DragPreview | null): void;
}
