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
