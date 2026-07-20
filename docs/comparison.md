# 競合ライブラリ比較

React 向けカレンダー/スケジューラーライブラリ 8 製品と Koyomi (`@koyomi-cal/react`) の
機能・ライセンス費用を比較します。採用判断の参考資料として、事実（公式ドキュメント・
GitHub・npm レジストリ・GitHub Issue 等の一次情報）のみを記載し、評価・優劣の主観的な
判断は含みません。

**調査時点: 2026 年 7 月。** バージョン番号・価格・ダウンロード数・Issue の状態は
調査時点のものであり、その後変更されている可能性があります。値は各製品の公式サイト・
npm レジストリ・GitHub の実測値に基づきます（出典は各節末尾に記載）。

## 比較表: ライセンスと費用

| ライブラリ | ライセンス | 費用（2026-07 時点） |
| --- | --- | --- |
| **Koyomi**（本ライブラリ） | MIT | 無償（制限なし） |
| FullCalendar | コアは MIT（無償）。リソース表示・タイムラインビュー・印刷最適化は Premium | Premium は商用ライセンス $480/開発者/年（非営利は無償・改変不可、AGPLv3 準拠なら無償） |
| react-big-calendar | MIT | 無償（制限なし） |
| Schedule-X | コアは MIT（無償）。D&D・リサイズ・ドラッグ作成・インタラクティブモーダル・リソースビュー等は Premium | 年額 €479（+VAT）、買い切り €999（+VAT） |
| TOAST UI Calendar | MIT | 無償（制限なし） |
| Bryntum Calendar/Scheduler | 商用クローズドソース | EUL $600〜$680/開発者（永久ライセンス+1年サポート）。OEM は別途見積もり |
| Mobiscroll Event Calendar | 商用クローズドソース（無料 Lite 版は Apache 2.0 だが Event Calendar 非対応） | プロジェクト単位 $995〜、Complete Company $8,955、SaaS 向け年額 $645〜 |
| Syncfusion React Scheduler | 商用（Essential Studio の一部） | 要問い合わせ（非公開）。年商 100 万ドル未満・開発者 5 名以下等の無償コミュニティライセンスあり |
| KendoReact Scheduler | 商用プロプライエタリ（Premium コンポーネント） | 開発者 1 人あたり年額 $930 前後 + サポートティア $649〜$1,199/年 |

## 比較表: アーキテクチャとビュー

| ライブラリ | ヘッドレス | 対応ビュー | リソース/タイムライン |
| --- | --- | --- | --- |
| **Koyomi** | ○（`data-koyomi-*` 属性フックのみ） | 月・週・日・リスト・年・複数月・リソース・タイムライン | ○（両方標準搭載、仮想化コンポーネントあり） |
| FullCalendar | ×（`fc-*` クラス + CSS 変数） | 月・週・日・リスト・複数月・年 | ○（Premium のみ） |
| react-big-calendar | ×（SCSS 同梱） | 月・週・Work Week・日・アジェンダ（年・複数月なし） | 部分対応（列表示のみ、専用タイムラインなし） |
| Schedule-X | ×（Material Design ベース） | 日・週・週アジェンダ・月グリッド・月アジェンダ・リスト（年・複数月なし） | ガントチャート的なリソーススケジューラー（Premium のみ） |
| TOAST UI Calendar | ×（Preact 依存の固定 UI） | 月・週・日のみ | 非対応（要望のみで未実装） |
| Bryntum Calendar/Scheduler | ×（独自 DOM/テーマ） | Day/Week/Month/Year/Agenda 等 12 種類 | ○（横型・縦型・Histogram 等、リソース特化ビューが充実） |
| Mobiscroll Event Calendar | ×（iOS/Material/Windows テーマ） | Calendar/Scheduler/Timeline/Agenda（月・週・複数週・四半期・年に変更可） | ○（両方、200 リソース×1 万イベント規模を謳う） |
| Syncfusion React Scheduler | ×（事前スタイル済み） | 成熟版: Day/Week/Month/Year/Agenda/Timeline 系。新版 Pure React は Day/Week/Month のみ | ○（成熟版のみ。新版は未実装） |
| KendoReact Scheduler | ×（Sass テーマ、Unstyled mode の対象外） | Day/Week/Month/Timeline/Agenda | ○（水平/垂直グルーピング対応） |

## 比較表: 繰り返し予定（RRULE）とタイムゾーン

| ライブラリ | RRULE 対応 | タイムゾーン |
| --- | --- | --- |
| **Koyomi** | RFC 5545 の主要パターン（`FREQ`/`INTERVAL`/`BYDAY`/`BYMONTHDAY`/`COUNT`/`UNTIL` 等）+ RDATE/EXDATE 相当。詳細は [繰り返し予定](./recurrence.md) を参照 | イベント別 + 表示タイムゾーン、DST 対応 |
| FullCalendar | 標準はシンプルな組み込み Recurring Events。本格的な RRULE は `rrule-plugin`（外部ラッパー）経由 | v7 で `temporal-polyfill` により組み込み化（moment-timezone/Luxon プラグインは廃止） |
| react-big-calendar | ネイティブ非対応。事前展開したイベント配列を渡す運用が公式に案内される | ローカライザー（moment/date-fns/dayjs/luxon）任せ、本体に変換ロジックなし |
| Schedule-X | RFC 5545 の部分実装（`FREQ` 4 種のみ、`BYSETPOS`/`BYYEARDAY`/`BYWEEKNO` 等は非対応） | `Temporal.ZonedDateTime` ベース、`config.timezone` で指定 |
| TOAST UI Calendar | 文字列フィールドのみで自動展開なし（実質非対応） | `timezone.zones` で複数タイムゾーン表示、IE11 は別途ポリフィルが必要 |
| Bryntum Calendar/Scheduler | RFC 5545 準拠、`FREQ` 4 種（`SECONDLY`/`MINUTELY`/`HOURLY` は非対応） | `timeZone` 設定で IANA 名指定可能（DST 境界のバグ報告あり） |
| Mobiscroll Event Calendar | 独自 JSON または RRULE 文字列を入力に受け付ける（出力は独自 JSON が基本） | `dataTimezone`/`displayTimezone` の分離指定、外部ライブラリ依存 |
| Syncfusion React Scheduler | iCalendar 準拠の RRULE を生成・解釈する Recurrence Editor 標準搭載 | IANA 形式、DST 対応（エッジケースのバグ修正が継続中） |
| KendoReact Scheduler | RFC 5545 の主要パラメータ対応（一部組み合わせ制限あり） | IANA ID を個別インポート（既定は `Etc/UTC` のみ） |

## 比較表: アクセシビリティとパフォーマンス

| ライブラリ | アクセシビリティ | 大量データ時の仮想化 |
| --- | --- | --- |
| **Koyomi** | WAI-ARIA grid パターン、`aria-current="date"`、キーボード操作。詳細は [アクセシビリティ](./accessibility.md) | `VirtualListView`/`VirtualResourceView`/`VirtualTimelineView`（opt-in）。詳細は [パフォーマンス](./performance.md) |
| FullCalendar | WAI-ARIA 技術を採用。第三者機関の WCAG 準拠証明は非公開 | リソースタイムラインの全軸で仮想化（v7〜）。dayGrid/timeGrid は非対応 |
| react-big-calendar | a11y 専用の設計・監査なし。GitHub Issue に複数の指摘あり | 非対応 |
| Schedule-X | 独立した a11y ドキュメントなし | 明示的な言及なし（Premium のリソーススケジューラーのみ無限スクロール対応） |
| TOAST UI Calendar | 公式記載なし | 明示的な言及なし |
| Bryntum Calendar/Scheduler | キーボード操作対応、ARIA 属性の継続的強化。VPAT/ACR の公開は未確認 | バッファレンダリングで数万件規模に対応（自社ベンチマーク） |
| Mobiscroll Event Calendar | WCAG 2.2 完全準拠は明言せず、継続的に取り組み中と説明 | Scheduler/Timeline に仮想スクロール（Calendar/Agenda は対象外） |
| Syncfusion React Scheduler | axe-core 等での自動テストを実施、Section 508/WCAG 準拠を主張 | 仮想スクロール + 遅延ロード（一部ビューは非対応） |
| KendoReact Scheduler | WCAG 2.2 AA・Section 508 準拠を公称、VPAT/ACR 提供 | リソースグループ/サブグループの仮想化（最大 5 分の 1 に短縮を謳う） |

## 個別メモ

### FullCalendar (`@fullcalendar/react`)

npm 週間ダウンロード数（`@fullcalendar/react`）約 137 万件、GitHub スター約 20,600。
v7 で HTML/CSS を全面刷新し、タイムゾーン解決を内蔵化。リソース・タイムラインは
Premium ライセンス（$480/開発者/年）が必要。RRULE は `rrule-plugin` 経由で、EXDATE の
日付/日時形式不一致（#6105）等の既知の不具合報告がある。

出典: fullcalendar.io/pricing、fullcalendar.io/license、fullcalendar.io/docs/rrule-plugin、
GitHub Issue #6105・#6126・#5673・#4395、npm レジストリ実測（2026-07-12〜18 週）。

### react-big-calendar

npm 週間ダウンロード数 約 107 万件、GitHub スター 約 8.7K。MIT ライセンスで完全無償。
Year/複数月ビュー、専用タイムラインビューは非対応。RRULE はネイティブ非対応で
事前展開が必須。メンテナーが 2026 年時点でアーキテクチャの陳腐化
（クラスコンポーネント中心、メモ化不足）を公に認め、次期メジャーバージョンでの
刷新を検討中（Issue #2255）。

出典: npm レジストリ実測、GitHub Issue #2255・#51・#809・#1753・#2037・#68・#2752。

### Schedule-X

npm 週間ダウンロード数（`@schedule-x/calendar`）約 111,459 件。コアは MIT だが、
D&D・リサイズ・ドラッグ作成・インタラクティブモーダル・リソースビューは v4 以降
Premium（年額 €479〜）に切り出されており、無料版は表示中心の機能にとどまる。
RRULE は `FREQ` 4 種のみの部分実装。

出典: schedule-x.dev/premium、schedule-x.dev/docs/calendar/plugins/recurrence、
GitHub schedule-x/schedule-x、npm レジストリ実測。

### TOAST UI Calendar (`@toast-ui/calendar`)

MIT ライセンスで無償。直近リリースは v2.1.3（2022-08-16）で、調査時点で約 4 年間
新バージョンが出ておらず実質的にメンテナンスが停止していると判断できる。
リソース・タイムライン・年・複数月・リストビューは非対応。

出典: github.com/nhn/tui.calendar、npm レジストリ実測、GitHub Issue #371・#649・#567。

### Bryntum Calendar / Bryntum Scheduler

商用クローズドソース。EUL は開発者ごと永久ライセンスで $600〜$680/開発者
（1 年サポート込み、以降は同額でサブスクリプション更新）。12 種類のビュー、
横型・縦型のリソース特化ビューが充実。タイムゾーン実装は「JS の Date を UTC
オフセットでずらす」暫定方式で、DST 境界のバグ報告がある。

出典: bryntum.com/store、bryntum.com/licensing、bryntum.com/products/scheduler/docs、
forum.bryntum.com、GitHub bryntum/support #318。

### Mobiscroll Event Calendar

商用クローズドソース、プライベート npm レジストリ経由配布。最小 $995
（プロジェクト単位）からのライセンス。Calendar/Scheduler/Timeline/Agenda を
1 コンポーネントで統合。RRULE 文字列は入力のみ対応し、内部表現は独自 JSON。

出典: mobiscroll.com/pricing、mobiscroll.com/docs/react/eventcalendar、
forum.mobiscroll.com。

### Syncfusion React Scheduler

Essential Studio サブスクリプションの一部（単体販売なし、価格は要問い合わせ）。
成熟版 `@syncfusion/ej2-react-schedule`（npm 週間ダウンロード数 約 19,501 件）は
Day/Week/Month/Year/Agenda/Timeline 系を網羅する一方、2026 年投入の新実装
Pure React Scheduler は Day/Week/Month のみでリソース・繰り返し予定編集は未実装。

出典: syncfusion.com/sales/pricing、syncfusion.com/products/communitylicense、
ej2.syncfusion.com/react/documentation/schedule、npm レジストリ実測。

### KendoReact Scheduler

Premium コンポーネント（無料の KendoReact Free には含まれない）。開発者 1 人あたり
年額 $930 前後。RRULE の主要パラメータ（`BYSETPOS` 含む）に対応する一方、
`BYMONTHDAY`/`BYYEARDAY`/`BYWEEKNO` に組み合わせ制限がある。WCAG 2.2 AA・
Section 508 準拠の VPAT/ACR を公開。

出典: telerik.com/kendo-react-ui/pricing、telerik.com/kendo-react-ui/components/scheduler、
componentsource.com、npm レジストリ実測。

## 関連ページ

- [バージョニング](./versioning.md)
- [パフォーマンス](./performance.md)
- [アクセシビリティ](./accessibility.md)
- [繰り返し予定](./recurrence.md)
