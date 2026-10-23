import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/catalog-filter-navigation';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 320, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
const page = await context.newPage();
const started = Date.now(), requests = new Map(), responses = [], errors = [];
const safeUrl = value => {
  const u = new URL(value);
  return u.origin + u.pathname + (u.searchParams.has('bodyType') ? `?bodyType=${encodeURIComponent(u.searchParams.get('bodyType'))}` : '');
};
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => {
  if (['document', 'fetch', 'xhr'].includes(request.resourceType())) requests.set(request, { url: safeUrl(request.url()), type: request.resourceType(), startedMs: Date.now() - started });
});
page.on('requestfinished', request => {
  const entry = requests.get(request);
  if (entry) { responses.push({ ...entry, durationMs: Date.now() - started - entry.startedMs, status: request.response().then(r => r?.status()).catch(() => null) }); requests.delete(request); }
});
page.on('requestfailed', request => {
  const entry = requests.get(request);
  if (entry) { responses.push({ ...entry, durationMs: Date.now() - started - entry.startedMs, failure: request.failure()?.errorText }); requests.delete(request); }
});
const marker = JSON.parse(fs.readFileSync('.github/market-runs/catalog-filter-navigation-diagnostic.json', 'utf8'));
const health = async () => { const r = await page.request.get('https://avtocena.com/api/health'); assert.equal(r.ok(), true); const h = await r.json(); if (marker.expectedRelease) assert.equal(h.releaseSha, marker.expectedRelease); return h; };
let failure = null, clickedMs = null, secondClickedMs = null, firstUrlMs = null, healthBefore = null, healthAfter = null;
let phase = 'initial';
try {
  healthBefore = await health();
  await page.goto('https://avtocena.com/cars', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  const cookie = page.getByRole('complementary', { name: 'Уведомление о cookie' });
  if (await cookie.isVisible()) await cookie.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть фильтры', exact: true }).click();
  const sheet = page.locator('.ac-mobile-filter-sheet');
  await sheet.waitFor();
  const body = sheet.locator('input[name="bodyType"]').locator('..');
  await body.locator(':scope > button').click();
  phase = 'first-suv';
  clickedMs = Date.now() - started;
  await body.getByRole('button', { name: 'Кроссовер', exact: true }).click();
  assert.equal(await body.locator('input[name="bodyType"]').inputValue(), 'suv');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('bodyType') === 'suv', null, { timeout: 30000 });
  firstUrlMs = Date.now() - started;
  phase = 'second-sedan';
  secondClickedMs = Date.now() - started;
  await body.getByRole('button', { name: 'Седан', exact: true }).click();
  assert.deepEqual((await body.locator('input[name="bodyType"]').inputValue()).split('|').sort(), ['sedan','suv']);
  await page.waitForFunction(() => new URLSearchParams(location.search).get('bodyType')?.split('|').includes('sedan'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.ac-mobile-filter-header [role="status"]')?.getAttribute('aria-busy') === 'false', null, { timeout: 30000 });
  assert.equal(await sheet.isVisible(), true);
  assert.deepEqual(errors, []);
  healthAfter = await health();
} catch (error) { failure = String(error); }
finally {
  const state = await page.evaluate(() => ({ url: location.href, readyState: document.readyState, selectedBody: document.querySelector('.ac-mobile-filter-sheet input[name="bodyType"]')?.value, busy: document.querySelector('.ac-mobile-filter-header [role="status"]')?.getAttribute('aria-busy') })).catch(error => ({ error: String(error) }));
  const report = { passed: !failure, failure, phase, healthBefore, healthAfter, state, clickedMs, firstUrlMs, secondClickedMs, elapsedMs: Date.now() - started, pageErrors: errors, responses: await Promise.all(responses.map(async r => ({ ...r, status: await r.status }))), unfinished: [...requests.values()] };
  fs.writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${out}/page.png`, fullPage: true }).catch(() => {});
  console.log(JSON.stringify(report));
  await browser.close();
}
if (failure) process.exitCode = 1;
