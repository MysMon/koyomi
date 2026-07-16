/**
 * @packageDocumentation
 * 中央メッセージカタログの型定義。
 *
 * Koyomi のユーザー可視文言（ビュー・ツールバー・アナウンサー・繰り返しルール
 * エディタ）を 1 つの {@link MessageCatalog} に集約する。カタログは常に
 * **グループ→リーフの 2 階層固定**（`catalog.list.empty` のように必ず 2 段で
 * 到達する）で、この階層を深くしない・浅くしないことが {@link MessageCatalogOverrides}
 * を型安全な部分上書きとして成立させる前提になる。
 *
 * リーフはプレーンな値（`ReactNode` / `string`）か、ドメインオブジェクトと
 * 既に整形済みの部分文字列（日時ラベル等）を受け取って全文を組み立てる関数の
 * いずれか。関数リーフは「既定文字列を受け取って置換する」形ではなく、
 * 語順・区切り・単数複数の判断そのものをカタログ側が担う。
 */

import type { ReactNode } from 'react';
import type {
  RecurrenceRuleState,
  RecurrenceUnsupportedReason,
  RecurrenceValidationIssue,
} from '../../core/recurrence-editor';
import type {
  CalendarEvent,
  CalendarRangeChangeInfo,
  CalendarResource,
  EventOccurrence,
  ListDay,
  TimeZoneId,
  YearDay,
} from '../../core/types';
import type { EventChange, EventDelete, RangeSelection } from '../types';

/**
 * イベント変更の種別を表す、ロケールに依存しないコード。
 *
 * 移動・サイズ変更の判定や終日⇔時間指定の変換判定はロケールに関係なく同じ
 * ロジックで決まるため、判定結果をこのコードとして {@link MessageCatalog.announcer}
 * の関数へ渡す（判定ロジック自体を各カタログに複製させないための型）。
 */
export type EventChangeVerb = 'moved' | 'resized' | 'convertedToAllDay' | 'convertedToTimed';

/** {@link MessageCatalog.common} — 複数のビューで共通に使う文言。 */
export interface CommonMessages {
  /** `defaultEventTitle` 省略時のイベント既定タイトル。 */
  untitledEvent: ReactNode;
  /** 日時範囲ラベル内で開始側・終了側を連結する区切り記号（例: `'〜'`）。 */
  rangeSeparator: string;
  /** aria-label 等で複数の項目を連結する区切り記号（例: `'、'`）。 */
  itemSeparator: string;
  /**
   * イベントの aria-label 全文を組み立てる。
   *
   * @param occurrence - 対象のオカレンス
   * @param rangeLabel - 整形済みの日時範囲ラベル（`common.rangeSeparator` 適用済み）
   */
  eventAriaLabel: (occurrence: EventOccurrence, rangeLabel: string) => string;
}

/** {@link MessageCatalog.toolbar} — `Toolbar` の表示文字列・aria-label。 */
export interface ToolbarMessages {
  /** 月ビュー切替ボタンの表示文字列。 */
  month: ReactNode;
  /** 週ビュー切替ボタンの表示文字列。 */
  week: ReactNode;
  /** 日ビュー切替ボタンの表示文字列。 */
  day: ReactNode;
  /** リストビュー切替ボタンの表示文字列。 */
  list: ReactNode;
  /** 年ビュー切替ボタンの表示文字列。 */
  year: ReactNode;
  /** 複数月ビュー切替ボタンの表示文字列。 */
  multiMonth: ReactNode;
  /** リソースビュー切替ボタンの表示文字列。 */
  resource: ReactNode;
  /** タイムラインビュー切替ボタンの表示文字列。 */
  timeline: ReactNode;
  /** 「今日」ボタンの表示文字列（aria-label にも使う）。 */
  today: ReactNode;
  /** 「前へ」ボタンの aria-label。 */
  prev: ReactNode;
  /** 「次へ」ボタンの aria-label。 */
  next: ReactNode;
  /** ビュー切替ボタングループの `aria-label`。 */
  viewsGroup: string;
}

/** {@link MessageCatalog.list} — `ListView` / `VirtualListView` の文言。 */
export interface ListMessages {
  /** 終日イベントの時刻ラベル表示。 */
  allDay: ReactNode;
  /** 予定が 1 件もない場合のメッセージ。 */
  empty: ReactNode;
  /**
   * 日セクションの aria-label 全文を組み立てる。
   *
   * @param day - 対象の日
   * @param dateLabel - 整形済みの日付見出しラベル
   */
  dayAriaLabel: (day: ListDay, dateLabel: string) => string;
}

/** {@link MessageCatalog.month} — `MonthView` の文言。 */
export interface MonthMessages {
  /** overflow（「+N 件」）ボタンの表示内容。 */
  overflow: (count: number) => ReactNode;
}

/** {@link MessageCatalog.multiMonth} — `MultiMonthView` の文言。 */
export interface MultiMonthMessages {
  /** overflow（「+N 件」）ボタンの表示内容。 */
  overflow: (count: number) => ReactNode;
}

/** {@link MessageCatalog.resource} — `ResourceView` / `VirtualResourceView` の文言。 */
export interface ResourceMessages {
  /** 未割り当て列の見出し。 */
  unassigned: ReactNode;
  /** リソースが 1 件もない場合のメッセージ。 */
  empty: ReactNode;
}

/** {@link MessageCatalog.timeline} — `TimelineView` / `VirtualTimelineView` の文言。 */
export interface TimelineMessages {
  /** 未割り当て行の見出し。 */
  unassigned: ReactNode;
  /** リソースが 1 件もない場合のメッセージ。 */
  empty: ReactNode;
  /** ヘッダー行の角セル（行見出し列の列見出し）の `aria-label`。 */
  corner: string;
  /**
   * 折りたたみトグルボタンの aria-label を組み立てる。
   *
   * @param resource - 対象のリソース
   * @param collapsed - 現在の折りたたみ状態（`true` なら押すと展開）
   */
  resourceToggleAriaLabel: (resource: CalendarResource, collapsed: boolean) => string;
}

/** {@link MessageCatalog.year} — `YearView` の文言。 */
export interface YearMessages {
  /** 日セルの aria-label に含める件数文言（例: `'予定3件'`）。 */
  dayCount: (count: number) => string;
  /**
   * 日セルの aria-label 全文を組み立てる。
   *
   * @param day - 対象の日
   * @param dateLabel - 整形済みの日付ラベル
   */
  dayAriaLabel: (day: YearDay, dateLabel: string) => string;
}

/** {@link MessageCatalog.announcer} — `useCalendarAnnouncer` の通知文言。 */
export interface AnnouncerMessages {
  /** リソース ID が未割り当て・参照先のない ID のときのリソース表示名。 */
  unassignedResource: string;
  /**
   * `onEventChange` 確定後の通知文を組み立てる。
   *
   * @param change - 変更内容
   * @param verb - 変更の種別
   * @param rangeLabel - 整形済みの変更後日時範囲ラベル
   * @param resourceLabel - リソース名（対象外のビューでは `null`）
   */
  eventChanged: (
    change: EventChange,
    verb: EventChangeVerb,
    rangeLabel: string,
    resourceLabel: string | null,
  ) => string;
  /**
   * 既定即時作成の確定後の通知文を組み立てる。
   *
   * @param event - 作成されたイベント
   * @param selection - 作成元の範囲選択
   * @param rangeLabel - 整形済みの日時範囲ラベル
   * @param resourceLabel - リソース名（対象外のビューでは `null`）
   */
  eventCreated: (
    event: CalendarEvent,
    selection: RangeSelection,
    rangeLabel: string,
    resourceLabel: string | null,
  ) => string;
  /**
   * `onEventDelete` 確定後の通知文を組み立てる。
   *
   * @param deletion - 削除内容（`scope` から付記文言を判断する）
   */
  eventDeleted: (deletion: EventDelete) => string;
  /**
   * ビュー・基準日・表示範囲の変更後の通知文を組み立てる。
   *
   * @param info - 変更内容
   * @param title - 整形済みの変更後の期間タイトル
   */
  viewChanged: (info: CalendarRangeChangeInfo, title: string) => string;
}

/** {@link MessageCatalog.recurrenceEditor} — `useRecurrenceRuleEditor` の文言。 */
export interface RecurrenceEditorMessages {
  /**
   * 繰り返しルールの説明文を組み立てる。
   *
   * @param state - 現在の状態
   * @param context - 曜日・月内日付・年内の月日を補うための DTSTART とタイムゾーン（省略可）
   */
  describeRule: (
    state: RecurrenceRuleState,
    context?: { dtstart?: Date; timeZone?: TimeZoneId },
  ) => string;
  /**
   * 検証エラー 1 件の文言を組み立てる。
   *
   * @param issue - 検証エラー
   */
  validationMessage: (issue: RecurrenceValidationIssue) => string;
  /**
   * 対応範囲外の RRULE の理由文言を組み立てる。
   *
   * @param reason - 非対応理由
   */
  unsupportedReason: (reason: RecurrenceUnsupportedReason) => string;
}

/**
 * 中央メッセージカタログ。
 *
 * `resolveMessageCatalog` が返す解決済みの完全なカタログの型。各グループは
 * 必ず対応する `*Messages` 型のリーフをすべて持つ（部分適用は
 * {@link MessageCatalogOverrides} 側の責務）。
 */
export interface MessageCatalog {
  /** 複数のビューで共通に使う文言。 */
  common: CommonMessages;
  /** `Toolbar` の表示文字列・aria-label。 */
  toolbar: ToolbarMessages;
  /** `ListView` / `VirtualListView` の文言。 */
  list: ListMessages;
  /** `MonthView` の文言。 */
  month: MonthMessages;
  /** `MultiMonthView` の文言。 */
  multiMonth: MultiMonthMessages;
  /** `ResourceView` / `VirtualResourceView` の文言。 */
  resource: ResourceMessages;
  /** `TimelineView` / `VirtualTimelineView` の文言。 */
  timeline: TimelineMessages;
  /** `YearView` の文言。 */
  year: YearMessages;
  /** `useCalendarAnnouncer` の通知文言。 */
  announcer: AnnouncerMessages;
  /** `useRecurrenceRuleEditor` の文言。 */
  recurrenceEditor: RecurrenceEditorMessages;
}

/**
 * {@link MessageCatalog} の部分上書き。
 *
 * 各グループを独立に `Partial` 化した 2 階層のオプショナル型で、グループ単位の
 * 浅いマージ（`{ ...base[group], ...overrides[group] }`）と組み合わせて使う。
 * グループ自体を省略した場合はそのグループ全体が既定のまま、グループの一部の
 * リーフだけを指定した場合は指定したリーフだけが差し替わる。
 */
export type MessageCatalogOverrides = {
  [Group in keyof MessageCatalog]?: Partial<MessageCatalog[Group]>;
};
