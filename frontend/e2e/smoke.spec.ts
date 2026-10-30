import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
/** Verified count from the file the app serves at /data (copied from data/processed by the prebuild sync). */
function verifiedInServedData(): number {
  const geojson = JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/data/tamil-nadu.geojson', import.meta.url)), 'utf8'),
  ) as { features: Array<{ properties: { verificationStatus: string } }> };
  return geojson.features.filter((f) => f.properties.verificationStatus === 'verified').length;
}
const sitesIn = (text: string | null) => Number(text?.match(/\d[\d,]*/)?.[0]?.replace(/,/g, ''));
test('map, search, details and insights work on the committed Tamil Nadu data', async ({ page }) => {
  const verifiedCount = verifiedInServedData();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  // MapLibre renders into a WebGL canvas (fallback style, no API key).
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-map-style', 'fallback');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  const resultCount = page.getByTestId('result-count');
  await expect(resultCount).toHaveText(new RegExp(`^${verifiedCount} sites`));
  const sidebar = page.getByRole('complementary', { name: 'Explore heritage sites' });
  await page.getByRole('searchbox').fill('Thanjavur');
  await expect.poll(async () => sitesIn(await resultCount.textContent())).toBeLessThan(verifiedCount);
  const narrowed = sitesIn(await resultCount.textContent());
  expect(narrowed).toBeGreaterThan(0);
  await sidebar.getByRole('button', { name: /Prahadisvarar Temple/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Details: Prahadisvarar Temple/ });
  await expect(dialog).toBeVisible();
  const sourceLink = dialog.getByRole('link', { name: /Wikidata Q\d+|OpenStreetMap/ }).first();
  await expect(sourceLink).toHaveAttribute('href', /^https:\/\/(www\.wikidata\.org\/wiki\/Q\d+|www\.openstreetmap\.org\/(node|way|relation)\/\d+)$/);
  await dialog.getByRole('button', { name: 'Close details' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Insights' }).click();
  await expect(page.getByTestId('insights-total-verified')).toHaveText(verifiedCount.toLocaleString('en-US'));
  expect(errors).toEqual([]);
});
