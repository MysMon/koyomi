import { expect, type Locator, type Page, test } from '@playwright/test';

/** 1 日のミリ秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 今日から `offsetDays` 日後の日付キー（`'YYYY-MM-DD'`、Asia/Tokyo 基準）を返す。
 * デモのサンプルデータは Asia/Tokyo の「今日」を基準に相対配置されている。
 */
function tokyoDayKey(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * DAY_MS));
}

/** `useCalendarAnnouncer` の aria-live リージョン。 */
function liveRegion(page: Page): Locator {
  return page.locator('[data-koyomi="live-region"]');
}

/** タイトルで指定した時間指定イベントの要素。 */
function timegridEvent(page: Page, title: string): Locator {
  return page.locator('[data-koyomi="timegrid-event"]', { hasText: title });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/basic');
  await expect(page.locator('[data-koyomi="root"]')).toHaveAttribute('data-koyomi-view', 'month');
  await page.locator('[data-koyomi-action="view-day"]').click();
});

test('矢印キーで予定を移動・リサイズでき、aria-live リージョンの文言が更新される', async ({
  page,
}) => {
  const region = liveRegion(page);
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText('');

  const chip = timegridEvent(page, '商談: A社様');
  await expect(chip).toHaveAttribute('aria-label', /10:00〜11:00/);
  await chip.focus();

  // ArrowDown: snapMinutes（15 分）だけ後ろへ移動する
  await page.keyboard.press('ArrowDown');
  await expect(chip).toHaveAttribute('aria-label', /10:15〜11:15/);
  await expect(region).toContainText('商談: A社様 を');
  await expect(region).toContainText('10:15〜11:15 に移動しました');

  // Shift+ArrowDown: 終了時刻だけを 15 分後ろへリサイズする。
  // 変更のたびにオカレンスキーが変わって要素が作り直されるため、都度フォーカスし直す
  await chip.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(chip).toHaveAttribute('aria-label', /10:15〜11:30/);
  await expect(region).toContainText('10:15〜11:30 にサイズ変更しました');

  // ArrowUp: 15 分前へ移動する（リサイズ後の長さ 1 時間 15 分は保たれる）
  await chip.focus();
  await page.keyboard.press('ArrowUp');
  await expect(chip).toHaveAttribute('aria-label', /10:00〜11:15/);
  await expect(region).toContainText('10:00〜11:15 に移動しました');
});

test('Delete キーで予定が削除され、削除文言が通知される', async ({ page }) => {
  const chip = timegridEvent(page, '商談: A社様');
  await chip.focus();
  await page.keyboard.press('Delete');

  await expect(chip).toHaveCount(0);
  await expect(liveRegion(page)).toContainText('商談: A社様 を削除しました');
});

test('editable: false の予定は矢印キーでも Delete でも変更されず、通知もされない', async ({
  page,
}) => {
  // サンプルデータの「全社総会（予定変更不可）」は 2 日後の 13:00〜15:00
  await page.locator('#demo-goto-date').fill(tokyoDayKey(2));
  const chip = timegridEvent(page, '全社総会（予定変更不可）');
  await expect(chip).toHaveAttribute('aria-label', /13:00〜15:00/);

  await chip.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');

  await expect(chip).toHaveAttribute('aria-label', /13:00〜15:00/);
  await expect(chip).toHaveCount(1);
  await expect(liveRegion(page)).toHaveText('');
});

test('時間グリッドの日列で Enter を押すと予定が作成され、フォーカスが新規予定へ移る', async ({
  page,
}) => {
  // 「ヘッドレス」パターンは onSelectRange を指定しないため、Enter 作成は
  // 既定の即時作成（createDefaultEvent）を経由し、確定後に新規予定の要素へ
  // フォーカスが移る（onSelectRange 自前実装の #/basic では委譲されフォーカス移動はない）
  await page.getByRole('link', { name: /ヘッドレス/ }).click();
  await page.locator('[data-koyomi-action="view-week"]').click();

  const today = page.locator('[data-koyomi="timegrid-day"][data-today="true"]');
  await today.focus();
  await page.keyboard.press('Enter');

  const created = timegridEvent(page, '(タイトルなし)');
  await expect(created).toBeVisible();
  await expect(created).toBeFocused();
  // 作成範囲は slotMinTime（既定 0:00）から defaultEventMinutes（既定 60 分）分
  await expect(created).toHaveAttribute('aria-label', /0:00〜1:00/);
});

test('フォーカス中の時間指定の予定で A キーを押すと終日イベントに変換される', async ({ page }) => {
  const chip = timegridEvent(page, '商談: A社様');
  await expect(chip).toHaveAttribute('aria-label', /10:00〜11:00/);

  await chip.focus();
  await page.keyboard.press('a');

  // 時間グリッドの帯は消え、終日行の帯として作り直される
  await expect(timegridEvent(page, '商談: A社様')).toHaveCount(0);
  await expect(
    page.locator('[data-koyomi="allday-event"]', { hasText: '商談: A社様' }),
  ).toBeVisible();
});

test('同時刻に重なる予定を Delete で削除すると、フォーカスが同じビュー内の別の予定へ移る', async ({
  page,
}) => {
  // 「商談: A社様」「採用面接」は今日 10:00〜11:00 に重なるサンプル予定
  const first = timegridEvent(page, '商談: A社様');
  const second = timegridEvent(page, '採用面接');

  await first.focus();
  await page.keyboard.press('Delete');

  await expect(first).toHaveCount(0);
  await expect(second).toBeFocused();
});
