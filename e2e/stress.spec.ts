import { expect, test } from '@playwright/test';

/**
 * ストレステストパターン（`#/stress`）の実ブラウザ検証。
 *
 * ハッシュのクエリパラメータ（`events` / `resources` / `view`）で件数・表示を
 * 指定してデータを決定的に生成し、初回描画時間の計測結果を
 * `data-stress-*` 属性として公開する。ベンチマークスイート（`bench/`）は
 * この属性を読み取って計測するため、ここでは属性の仕様を固定する。
 */

test('クエリパラメータで指定した件数のデータが生成され初回描画時間が計測される', async ({
  page,
}) => {
  await page.goto('/#/stress?events=300&resources=20&view=timeline');

  const frame = page.locator('[data-stress-frame]');
  // クエリで指定した件数がそのまま生成件数になる（決定的生成）
  await expect(frame).toHaveAttribute('data-stress-events', '300');
  await expect(frame).toHaveAttribute('data-stress-resources', '20');
  await expect(frame).toHaveAttribute('data-stress-generated', '300');

  // 描画完了後に計測結果（ミリ秒）が属性として公開される
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });
  const renderMs = Number(await frame.getAttribute('data-stress-render-ms'));
  expect(renderMs).toBeGreaterThan(0);
  const generateMs = Number(await frame.getAttribute('data-stress-generate-ms'));
  expect(generateMs).toBeGreaterThanOrEqual(0);

  // タイムラインビューが実際に描画され、予定が表示されている
  await expect(page.locator('[data-koyomi="timeline-body"]')).toBeVisible();
  expect(await page.locator('[data-koyomi="timeline-item"]').count()).toBeGreaterThan(0);
});

test('クエリ無しの #/stress は既定の件数で表示される', async ({ page }) => {
  await page.goto('/#/stress');

  const frame = page.locator('[data-stress-frame]');
  await expect(frame).toHaveAttribute('data-stress-events', '1000');
  await expect(frame).toHaveAttribute('data-stress-resources', '100');
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });
});

test('スライダーで件数を変更して適用すると再生成され URL に反映される', async ({ page }) => {
  await page.goto('/#/stress?events=300&resources=20&view=timeline');

  const frame = page.locator('[data-stress-frame]');
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });

  await page.locator('#stress-events-slider').fill('500');
  await page.locator('#stress-resources-slider').fill('30');
  await page.getByRole('button', { name: '適用して再計測' }).click();

  await expect(frame).toHaveAttribute('data-stress-generated', '500');
  await expect(frame).toHaveAttribute('data-stress-resources', '30');
  // 再適用後にも初回描画時間が計測し直される
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });
  // 件数は URL（ハッシュのクエリ）にも反映され、リロードで再現できる
  expect(page.url()).toContain('events=500');
  expect(page.url()).toContain('resources=30');
});

test('ビュータブで表示を切り替えると URL に反映され再計測される', async ({ page }) => {
  await page.goto('/#/stress?events=300&resources=20&view=timeline');

  const frame = page.locator('[data-stress-frame]');
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });

  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await expect(page.locator('[data-koyomi="list"]')).toBeVisible();
  await expect(frame).toHaveAttribute('data-stress-ready', 'true', { timeout: 30_000 });
  expect(page.url()).toContain('view=list');
});
