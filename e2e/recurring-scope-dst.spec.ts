import { expect, type Locator, type Page, test } from '@playwright/test';

/** 検証に使う DST を持つタイムゾーン（デモの表示タイムゾーン切替の選択肢にある）。 */
const DST_ZONE = 'America/New_York';

/** デモのサンプルデータにある、ニューヨーク現地時刻 9:00〜9:30 の毎日の繰り返し予定。 */
const DST_EVENT_TITLE = 'NY デイリー定例';

/** 1 日のミリ秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `timeZone` における `instant` 時点の UTC オフセット（分）を返す。 */
function utcOffsetMinutes(timeZone: string, instant: Date): number {
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName');
  if (offsetPart === undefined) {
    throw new Error(`UTC オフセットを取得できません: ${timeZone}`);
  }
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(offsetPart.value);
  if (match === null) {
    throw new Error(`UTC オフセット表記を解釈できません: ${offsetPart.value}`);
  }
  if (match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    // 'GMT'（オフセット 0）の表記
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * 今日から `daysFromNow` 日後の正午 UTC の時点を返す。
 * DST の切替はニューヨーク現地の深夜 2:00 ごろに発生するため、正午 UTC
 * （ニューヨーク現地の午前 7〜8 時）の時点では切替が反映済みで、かつ
 * UTC の日付とニューヨーク現地の日付が一致する。
 */
function probeAtNoonUtc(daysFromNow: number): Date {
  const now = new Date();
  const todayNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  return new Date(todayNoon + daysFromNow * DAY_MS);
}

/** 正午 UTC の時点から日付キー（`'YYYY-MM-DD'`）を取り出す。 */
function dayKeyOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** 次の DST 切替日の情報。`dayKey(0)` が切替日当日、負数は切替日より前の日。 */
interface DstTransition {
  /** 切替日から `offsetDays` 日ずらした日付キーを返す。 */
  dayKey: (offsetDays: number) => string;
  /** 切替日前日の UTC オフセット（分）。 */
  offsetBefore: number;
  /** 切替日当日の UTC オフセット（分）。 */
  offsetAfter: number;
}

/**
 * 今日以降で次にニューヨークの DST 切替が発生する日（現地日付）を探す。
 * サンプルデータの繰り返し予定は 3 週間前から毎日続くため、切替日とその前後の
 * 日には必ずオカレンスが存在する。
 */
function findNextDstTransition(): DstTransition {
  let previousOffset = utcOffsetMinutes(DST_ZONE, probeAtNoonUtc(1));
  for (let day = 2; day <= 400; day += 1) {
    const offset = utcOffsetMinutes(DST_ZONE, probeAtNoonUtc(day));
    if (offset !== previousOffset) {
      const transitionDay = day;
      return {
        dayKey: (offsetDays: number) => dayKeyOf(probeAtNoonUtc(transitionDay + offsetDays)),
        offsetBefore: previousOffset,
        offsetAfter: offset,
      };
    }
    previousOffset = offset;
  }
  throw new Error('400 日以内に DST の切替が見つかりません');
}

/** ベーシックデモを開き、表示タイムゾーンをニューヨークへ切り替えて日ビューにする。 */
async function setupNewYorkDayView(page: Page): Promise<void> {
  await page.goto('/#/basic');
  await expect(page.locator('[data-koyomi="root"]')).toHaveAttribute('data-koyomi-view', 'month');
  await page.locator('#demo-timezone-select').selectOption(DST_ZONE);
  await page.locator('[data-koyomi-action="view-day"]').click();
}

/** 日付ジャンプ入力で指定日の日ビューへ移動する。 */
async function gotoDay(page: Page, dayKey: string): Promise<void> {
  await page.locator('#demo-goto-date').fill(dayKey);
}

/** 表示中の繰り返し予定（NY デイリー定例）のオカレンスの要素。 */
function dstEventChip(page: Page): Locator {
  return page.locator('[data-koyomi="timegrid-event"]', { hasText: DST_EVENT_TITLE });
}

/**
 * オカレンスへの矢印キー移動（+15 分）を開始し、スコープ選択ダイアログで
 * 指定の選択肢を選ぶ。
 */
async function moveByArrowWithScope(page: Page, scopeLabel: string): Promise<void> {
  await dstEventChip(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { name: '繰り返し予定の移動' })).toBeVisible();
  await page.getByRole('button', { name: scopeLabel, exact: true }).click();
}

test('DST 切替日の前後で繰り返しオカレンスは現地時刻 9:00〜9:30 のまま表示される', async ({
  page,
}) => {
  const transition = findNextDstTransition();
  // 前提の確認: 探索した切替日の前後で実際に UTC オフセットが変わっている
  expect(transition.offsetAfter).not.toBe(transition.offsetBefore);

  await setupNewYorkDayView(page);
  await gotoDay(page, transition.dayKey(-1));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:00〜9:30/);
  await gotoDay(page, transition.dayKey(0));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:00〜9:30/);
});

test("スコープ 'this' の移動は DST 切替日のオカレンスだけに適用される", async ({ page }) => {
  const transition = findNextDstTransition();
  await setupNewYorkDayView(page);

  await gotoDay(page, transition.dayKey(0));
  await moveByArrowWithScope(page, 'この予定のみ');
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:15〜9:45/);

  // 切替日の翌日・前日（DST 境界の反対側）は元の現地時刻のまま
  await gotoDay(page, transition.dayKey(1));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:00〜9:30/);
  await gotoDay(page, transition.dayKey(-1));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:00〜9:30/);
});

test("スコープ 'thisAndFollowing' の移動は DST 境界をまたいだ後続オカレンスにも現地時刻を保って適用される", async ({
  page,
}) => {
  const transition = findNextDstTransition();
  await setupNewYorkDayView(page);

  // 切替日前日のオカレンスから「これ以降のすべての予定」で +15 分移動する
  await gotoDay(page, transition.dayKey(-1));
  await moveByArrowWithScope(page, 'これ以降のすべての予定');
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:15〜9:45/);

  // DST 境界をまたいだ切替日当日も、新しい現地時刻 9:15 のまま（1 時間ずれない）
  await gotoDay(page, transition.dayKey(0));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:15〜9:45/);

  // 分割点より前のオカレンスは元の現地時刻のまま
  await gotoDay(page, transition.dayKey(-2));
  await expect(dstEventChip(page)).toHaveAttribute('aria-label', /9:00〜9:30/);
});

test("スコープ 'all' の削除は DST 境界の前後を含む全オカレンスを取り除く", async ({ page }) => {
  const transition = findNextDstTransition();
  await setupNewYorkDayView(page);

  await gotoDay(page, transition.dayKey(0));
  await dstEventChip(page).focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('heading', { name: '繰り返し予定の削除' })).toBeVisible();
  await page.getByRole('button', { name: 'すべての予定', exact: true }).click();

  await expect(dstEventChip(page)).toHaveCount(0);
  await gotoDay(page, transition.dayKey(-1));
  await expect(dstEventChip(page)).toHaveCount(0);
  await gotoDay(page, transition.dayKey(1));
  await expect(dstEventChip(page)).toHaveCount(0);
});
