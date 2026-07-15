import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/basic');
  await expect(page.locator('[data-koyomi="root"]')).toHaveAttribute('data-koyomi-view', 'month');
});

test('ビュー切替・キーボードショートカット・テーマ切替が動作する', async ({ page }) => {
  const root = page.locator('[data-koyomi="root"]');

  await page.locator('[data-koyomi-action="view-week"]').click();
  await expect(root).toHaveAttribute('data-koyomi-view', 'week');

  await page.keyboard.press('m');
  await expect(root).toHaveAttribute('data-koyomi-view', 'month');

  await page.getByRole('button', { name: /ダークモード/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-koyomi-theme', 'dark');
});

test('時間グリッドのポインタドラッグで予定作成ダイアログが開く', async ({ browserName, page }) => {
  await page.locator('[data-koyomi-action="view-day"]').click();
  const slots = page.locator('[data-koyomi="timegrid-slot"]');
  await expect(slots).toHaveCount(24);

  // slot 自体は罫線用の高さ 0 の要素なので、空いている 16〜17 時を表示領域へ
  // スクロールしてから、その線の少し下を実ポインタで操作する。
  await slots.nth(16).scrollIntoViewIfNeeded();
  const start = await slots.nth(16).boundingBox();
  const end = await slots.nth(17).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  if (start === null || end === null) return;

  const startPoint = { x: start.x + start.width / 2, y: start.y + 2 };
  const endPoint = { x: end.x + end.width / 2, y: end.y + 2 };
  if (browserName === 'chromium') {
    // Chromium では Playwright の低レベル入力を使い、実際のマウスポインタ経路も検証する。
    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.up();
  } else {
    // Firefox / WebKit の page.mouse は自動操作時に PointerEvent を生成しないため、
    // 実ブラウザ内で同等の PointerEvent 経路を直接検証する。
    const day = page.locator('[data-koyomi="timegrid-day"]');
    await day.dispatchEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: startPoint.x,
      clientY: startPoint.y,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          buttons: 1,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
    }, endPoint);
  }

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '予定を作成' })).toBeVisible();
});

test('実タッチ入力のドラッグで予定作成ダイアログが開く', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-touch', 'Chromium のタッチ入力専用検証');
  await page.locator('[data-koyomi-action="view-day"]').click();
  const slots = page.locator('[data-koyomi="timegrid-slot"]');
  await slots.nth(16).scrollIntoViewIfNeeded();
  const start = await slots.nth(16).boundingBox();
  const end = await slots.nth(17).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  if (start === null || end === null) return;

  const session = await page.context().newCDPSession(page);
  const startPoint = { x: start.x + start.width / 2, y: start.y + 2 };
  const endPoint = { x: end.x + end.width / 2, y: end.y + 2 };
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...startPoint, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...endPoint, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('国際化デモで英語・RTL・複数タイムゾーン軸を切り替えられる', async ({ page }) => {
  await page.getByRole('link', { name: /国際化/ }).click();
  await page.locator('[data-koyomi-action="view-week"]').click();
  await expect(page.locator('[data-koyomi="time-axis"]')).toHaveCount(3);

  await page.getByLabel('RTL（右から左）').check();
  await expect(page.locator('.koyomi-demo-international')).toHaveAttribute('dir', 'rtl');

  await page.locator('.international-language-toggle').click();
  await expect(page.locator('[data-koyomi-action="today"]')).toHaveText('Today');
});

test('大量リソースの仮想化スクロールでフォーカスと対象行を維持する', async ({ page }) => {
  await page.getByRole('link', { name: /チーム/ }).click();
  const resource = page.locator('[data-koyomi="resource"][data-koyomi-virtualized="true"]');
  await expect(resource).toBeVisible();
  const renderedHeaders = resource.locator('[data-koyomi="resource-header-cell"]');
  expect(await renderedHeaders.count()).toBeLessThan(201);

  const firstEvent = resource.locator('[data-koyomi="timegrid-event"]').first();
  await expect(firstEvent).toBeVisible();
  const occurrenceKey = await firstEvent.getAttribute('data-koyomi-occurrence');
  expect(occurrenceKey).not.toBeNull();
  if (occurrenceKey === null) return;
  const focusedEvent = resource.locator(`[data-koyomi-occurrence="${occurrenceKey}"]`);
  await focusedEvent.focus();
  await expect(focusedEvent).toBeFocused();
  await resource.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll'));
  });
  // リソース一覧の末尾はメンバー 200 人の後ろに追加された階層リソース
  // （リソース表示ではフラットな列。最後は「大阪1F 会議室A」）
  await expect(
    resource.locator('[data-koyomi-resource-id="room-osaka-1f-a"]').first(),
  ).toBeVisible();
  await expect(focusedEvent).toBeAttached();
  await expect(focusedEvent).toBeFocused();

  await page.getByRole('button', { name: 'タイムライン' }).click();
  const timeline = page.locator('[data-koyomi="timeline"][data-koyomi-virtualized="true"]');
  await expect(timeline).toBeVisible();
  await page.getByLabel('リソースへジャンプ').selectOption('member-200');
  await expect(timeline.locator('[data-koyomi-resource-id="member-200"]').first()).toBeVisible();
});

test('主要画面に WCAG 2.0 A/AA の自動検出違反がない', async ({ page }) => {
  const lightResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('[data-koyomi="timegrid-now-indicator"]')
    .analyze();
  expect(lightResults.violations).toEqual([]);

  await page.getByRole('button', { name: /ダークモード/ }).click();
  const darkResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('[data-koyomi="timegrid-now-indicator"]')
    .analyze();
  expect(darkResults.violations).toEqual([]);
});
