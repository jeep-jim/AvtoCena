import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {build} = await import(process.env.ESBUILD_MODULE || 'esbuild');
const out = path.resolve('artifacts/catalog-photo-recovery');
await fs.mkdir(out, {recursive: true});

// Exercise the real CatalogCard/CatalogCover and retry module. Only unrelated
// Next routing, dealer context and price/preview integrations are fixture-owned.
const integrations = {name: 'photo-fixture-integrations', setup(b) {
  b.onResolve({filter: /^(?:next\/(?:link|navigation)|.*\/(?:DealerBrowsingContext|browsing-context|useSavedCalculationPreview|CatalogPrice))$/}, a => ({path: a.path, namespace: 'fixture'}));
  b.onLoad({filter: /.*/, namespace: 'fixture'}, a => ({loader: 'tsx', resolveDir: process.cwd(), contents:
    a.path === 'next/link' ? "import React from 'react'; export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}" :
    a.path === 'next/navigation' ? "export const useRouter=()=>({prefetch(){},push(){}});" :
    a.path.endsWith('/DealerBrowsingContext') ? 'export const useDealerBrowsing=()=>null;' :
    a.path.endsWith('/browsing-context') ? 'export const dealerBrowsingHref=href=>href;' :
    a.path.endsWith('/useSavedCalculationPreview') ? 'export const useSavedCalculationPreview=()=>undefined;' :
    "import React from 'react'; export const CatalogPrice=({offer})=><strong>{offer.totalRub} ₽</strong>;",
  }));
}};
await build({entryPoints: ['tests/browser/catalog-photo-recovery-fixture.tsx'], bundle: true, format: 'iife',
  platform: 'browser', jsx: 'automatic', outfile: path.join(out, 'app.js'), tsconfig: 'apps/web/tsconfig.json',
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [integrations]});
const css = await postcss([tailwindcss({content: ['apps/web/components/catalog/**/*.{ts,tsx}',
  'tests/browser/catalog-photo-recovery-fixture.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
await fs.writeFile(path.join(out, 'style.css'), css.css + await fs.readFile(path.join(out, 'app.css'), 'utf8') + await fs.readFile('apps/web/components/catalog/catalog-sidebar.css', 'utf8') +
  '\n:root{--ac-surface:#171c25;--ac-surface-2:#27313f;--ac-text:#f4f4f5;--ac-muted:#a1a1aa;--ac-border:#374151}body{background:#171c25;color:#f4f4f5}');
if (process.env.PHOTO_RECOVERY_BUILD_ONLY === '1') {
  console.log('Photo recovery browser fixture bundle: PASS');
  process.exit(0);
}

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGElEQVQokWOoW7CDJMQwqmHBaCjVYQsDAMF4YJCRaxoZAAAAAElFTkSuQmCC', 'base64');
const cases = new Map();
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture.local');
  if (url.pathname.startsWith('/api/catalog/photo/')) {
    const match = url.pathname.match(/^\/api\/catalog\/photo\/fixture-(.+)-(broken|healthy|replaced)$/);
    const state = match && cases.get(match[1]);
    if (!state) { response.writeHead(404); response.end(); return; }
    const kind = match[2]; state.requests[kind].push(request.url);
    const failed = kind === 'broken' && state.requests[kind].length <= state.failures;
    response.writeHead(failed ? 503 : 200, failed ? {'cache-control': 'no-store', 'retry-after': '15', 'x-photo-status': 'photo_busy'} :
      {'content-type': 'image/png', 'cache-control': 'public, max-age=86400'});
    response.end(failed ? undefined : image); return;
  }
  if (url.pathname === '/app.js' || url.pathname === '/style.css') {
    response.setHeader('content-type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css');
    response.end(await fs.readFile(path.join(out, url.pathname.slice(1)))); return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const waitFor = async (check, label) => {
  for (let attempts = 0; attempts < 100; attempts++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(label);
};
async function openCase(caseId, width, failures, view = 'grid') {
  const state = {failures, requests: {broken: [], healthy: [], replaced: []}}; cases.set(caseId, state);
  const page = await browser.newPage({viewport: {width, height: 900}});
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === baseUrl) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.clock.install({time: new Date('2026-11-25T10:00:00Z')});
  await page.addInitScript(() => {
    window.photoErrors = 0;
    window.addEventListener('error', event => {
      if (event.target instanceof HTMLImageElement && event.target.src.includes('-broken?')) window.photoErrors++;
    }, true);
  });
  await page.goto(`${baseUrl}/?case=${caseId}&view=${view}`, {waitUntil: 'domcontentloaded'});
  await waitFor(() => page.evaluate(() => window.photoErrors === 1), 'initial photo failure');
  await waitFor(() => page.locator('[data-fixture="healthy"] img').evaluate(img => img.naturalWidth > 0), 'healthy photo');
  return {page, state, errors, external};
}
async function exhaust(page, count) {
  await page.clock.runFor(18_001);
  await waitFor(() => page.evaluate(expected => window.photoErrors >= expected, count + 1), 'first bounded retry');
  await page.clock.runFor(38_001);
  await waitFor(() => page.evaluate(expected => window.photoErrors >= expected, count + 2), 'second bounded retry');
  await waitFor(() => page.locator('[data-catalog-photo-retry]').count().then(count => count === 1), 'recoverable placeholder');
}
function assertUrls(state) {
  for (const urls of Object.values(state.requests)) {
    assert.equal(new Set(urls).size, urls.length ? 1 : 0, 'retry URL must stay exact');
    for (const raw of urls) {
      const url = new URL(raw, baseUrl);
      assert.deepEqual([...url.searchParams.keys()].sort(), ['market', 'url', 'view']);
      assert.equal(url.searchParams.get('view'), 'card');
    }
  }
}
try {
  browser = await chromium.launch({executablePath: process.env.CHROME_BIN, args: ['--no-sandbox']});
  for (const [width, view] of [[1280, 'grid'], [390, 'grid'], [1280, 'list']]) {
    const {page, state, errors, external} = await openCase(`manual-${width}-${view}`, width, 3, view);
    try {
      await exhaust(page, 1);
      const button = page.getByRole('button', {name: 'Повторить загрузку фото Hyundai Elantra'});
      assert.equal(await button.evaluate(element => element.closest('a') === null), true, 'retry is outside navigation link');
      assert.equal(await button.isVisible(), true);
      const placeholder = page.locator('[data-fixture="broken"]').getByRole('img', {name: 'Hyundai Elantra. Фото временно недоступно', exact: true});
      assert.equal(await placeholder.textContent(), '', 'compact recovery uses the labelled button without clipped duplicate copy');
      assert.equal(await button.evaluate(element => {
        const card = element.closest('article');
        const frame = card.querySelector('[role="img"]').getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const inside = rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom;
        const overlaps = [...card.querySelectorAll('.ac-on-image')].some(other => {
          const box = other.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
        });
        return inside && !overlaps;
      }), true, 'retry fits inside the photo without covering the market, favourite or title');
      assert.equal(state.requests.broken.length, 3); assert.equal(state.requests.healthy.length, 1);
      await page.screenshot({path: path.join(out, `${width}-${view}-unavailable.png`), fullPage: true});
      const before = page.url();
      await button.evaluate(element => { element.click(); element.click(); element.click(); });
      await waitFor(() => page.locator('[data-fixture="broken"] img').count().then(async count => count === 1 &&
        await page.locator('[data-fixture="broken"] img').evaluate(img => img.naturalWidth > 0)), 'manual recovery');
      assert.equal(page.url(), before); assert.equal(state.requests.broken.length, 4); assert.equal(state.requests.healthy.length, 1);
      assert.equal(await page.locator('[data-catalog-photo-retry]').count(), 0);
      await page.clock.runFor(60_000);
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(state.requests.broken.length, 4); assert.equal(state.requests.healthy.length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assertUrls(state);
      await page.screenshot({path: path.join(out, `${width}-${view}-recovered.png`), fullPage: true});
      results.push({width, view, scenario: 'manual', brokenRequests: 4, healthyRequests: 1});
    } finally { await page.close(); }
  }

  {
    const {page, state, errors, external} = await openCase('automatic', 390, Infinity);
    try {
      await exhaust(page, 1);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      assert.equal(state.requests.broken.length, 3, 'cooldown blocks immediate return recovery');
      await page.clock.runFor(15_000);
      await waitFor(() => page.evaluate(() => window.photoErrors === 4), 'one delayed automatic recovery without return events');
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(state.requests.broken.length, 4, 'return events cannot duplicate an active cycle');
      await exhaust(page, 4);
      await page.clock.runFor(60_000);
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      await page.clock.runFor(60_000);
      assert.equal(state.requests.broken.length, 6, 'return events cannot create an automatic loop');
      state.failures = 6;
      await page.getByRole('button', {name: 'Повторить загрузку фото Hyundai Elantra'}).click();
      await waitFor(() => page.locator('[data-fixture="broken"] img').count().then(async count => count === 1 &&
        await page.locator('[data-fixture="broken"] img').evaluate(img => img.naturalWidth > 0)), 'manual retry after automatic budget');
      assert.equal(state.requests.broken.length, 7); assert.equal(state.requests.healthy.length, 1);
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assertUrls(state);
      results.push({scenario: 'automatic-bounded', brokenRequests: 7, healthyRequests: 1});
    } finally { await page.close(); }
  }

  for (const action of ['replace', 'unmount']) {
    const {page, state, errors, external} = await openCase(action, 390, Infinity);
    try {
      await page.getByRole('button', {name: action === 'replace' ? 'Сменить проверяемое фото' : 'Убрать проверяемую карточку'}).click();
      if (action === 'replace') await waitFor(() => page.locator('[data-fixture="broken"] img').evaluate(img => img.naturalWidth > 0), 'replacement photo');
      await page.clock.runFor(120_000);
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(state.requests.broken.length, 1, 'cancelled old-source retry');
      assert.equal(state.requests.replaced.length, action === 'replace' ? 1 : 0);
      assert.equal(await page.locator('[data-catalog-photo-retry]').count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assertUrls(state);
      results.push({scenario: action, brokenRequests: 1, healthyRequests: 1});
    } finally { await page.close(); }
  }
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({passed: true, results}, null, 2));
  console.log('PHOTO_RECOVERY_BROWSER', JSON.stringify({passed: true, results}));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
