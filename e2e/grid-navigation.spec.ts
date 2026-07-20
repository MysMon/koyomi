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

/**
 * 実行日に依存せず必ず月グリッドの内側で左右・上下移動できる基準日
 * （今月の 15 日）の日付キーを返す。15 日の右隣（16 日）・1 週間後（22 日）は
 * どの月でも月本体に存在する。
 */
function midMonthKey(): string {
  return `${tokyoDayKey(0).slice(0, 8)}15`;
}

/** 翌月の 15 日の日付キー（どの月でも翌月のグリッドに必ず存在する日）を返す。 */
function nextMonthMidKey(): string {
  const [yearText, monthText] = tokyoDayKey(0).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-15`;
}

/** 指定した日付キーの月ビューの日セル。 */
function monthDayCell(page: Page, key: string): Locator {
  return page.locator(`[data-koyomi="month-day"][data-koyomi-date="${key}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/basic');
  await expect(page.locator('[data-koyomi="root"]')).toHaveAttribute('data-koyomi-view', 'month');
});

test('月ビューの日セルは単一の Tab ストップになり、矢印キーで移動して Tab ストップが追従する', async ({
  page,
}) => {
  // 既定の Tab ストップは「今日」のセル（tabIndex=0）、他のセルは -1
  const today = monthDayCell(page, tokyoDayKey(0));
  await expect(today).toHaveAttribute('tabindex', '0');

  const mid = monthDayCell(page, midMonthKey());
  await mid.focus();

  // ArrowRight: 右隣（翌日）のセルへ移動し、Tab ストップが追従する
  await page.keyboard.press('ArrowRight');
  const next = monthDayCell(page, `${tokyoDayKey(0).slice(0, 8)}16`);
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('tabindex', '0');
  await expect(mid).toHaveAttribute('tabindex', '-1');

  // ArrowDown: 同じ曜日列の次の週（1 週間後）のセルへ移動する
  await page.keyboard.press('ArrowDown');
  await expect(monthDayCell(page, `${tokyoDayKey(0).slice(0, 8)}23`)).toBeFocused();
});

test('セルの Enter でセル内の予定へ入り、Escape でセルへ戻る（モード分離）', async ({ page }) => {
  // サンプルデータでは「今日」に時間指定の予定（商談: A社様 など）があり、
  // 月ビューでは今日のセルが帯（month-event）を所有する
  const today = monthDayCell(page, tokyoDayKey(0));
  await today.focus();

  await page.keyboard.press('Enter');
  const focusedEvent = page.locator('[data-koyomi="month-event"]:focus');
  await expect(focusedEvent).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(today).toBeFocused();
});

test('PageDown で次の月へ切り替わり、フォーカスが新しいグリッドのセルに保持される', async ({
  page,
}) => {
  const today = monthDayCell(page, tokyoDayKey(0));
  await today.focus();

  await page.keyboard.press('PageDown');

  // 表示が次の月へ切り替わり（翌月 15 日のセルが現れる）、フォーカスは body へ
  // 落ちずに新しいグリッドの既定セル（今日、なければ先頭セル）へ移る
  await expect(monthDayCell(page, nextMonthMidKey())).toHaveCount(1);
  const focusedCell = page.locator('[data-koyomi="month-day"]:focus');
  await expect(focusedCell).toHaveCount(1);
  await expect(focusedCell).toHaveAttribute('tabindex', '0');
});
