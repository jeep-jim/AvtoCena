import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const compiled = await build({entryPoints: ['apps/web/components/catalog/paid-korea-report-contract.ts'], bundle: true, platform: 'node', format: 'esm', write: false});
const {normalizePaidKoreaReport} = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/paid-korea-report.json', 'utf8'));
const identity = {offerId: '0123456789abcdef01234567', lot: '42196907', observedAt: '2026-11-13T10:20:30.000Z'};
const payload = (kind, source = fixture) => normalizePaidKoreaReport(source, {...identity, kind});
const out = 'artifacts/paid-korea-report';
fs.mkdirSync(out, {recursive: true});
await build({entryPoints: ['tests/browser/paid-korea-report-fixture.tsx'], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: out + '/app.js', loader: {'.module.css': 'local-css'}, define: {'process.env.NODE_ENV': '"production"'}});
const css = await postcss([tailwindcss({content: [
  'apps/web/components/catalog/OfferSpecificationsDisclosure.tsx', 'apps/web/components/catalog/OfferUpdatedStatus.tsx',
  'apps/web/components/catalog/KoreaReportPanel.tsx', 'apps/web/components/catalog/PaidKoreaReportPanel.tsx',
  'tests/browser/paid-korea-report-fixture.tsx',
]}), autoprefixer]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-border:#d8dce5;--ac-surface:#fff;--ac-surface-2:#f3f5f8;--ac-text:#121826;--ac-muted:#677186;font-family:Arial}body{background:var(--ac-surface);color:var(--ac-text)}.dark{--ac-border:#3b4352;--ac-surface:#191f28;--ac-surface-2:#283342;--ac-text:#fff;--ac-muted:#b1bdcd}', {from: undefined});
const server = http.createServer((request, response) => {
  if (request.url === '/app.js') {response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(out + '/app.js')); return;}
  if (request.url === '/app.css') {response.setHeader('Content-Type', 'text/css'); response.end(css.css); return;}
  response.setHeader('Content-Type', 'text/html');
  response.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox']});
let externalRequests = 0;
async function pageFor(width, theme) {
  const page = await browser.newPage({viewport: {width, height: 1000}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) {externalRequests++; await route.abort('blockedbyclient');}
    else await route.continue();
  });
  return {page, errors, async open() {await page.goto(origin); await page.evaluate(value => document.documentElement.className = value, theme);}};
}
try {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const {page, errors, open} = await pageFor(width, theme);
    const calls = {history: 0, inspection: 0};
    let release;
    const held = new Promise(resolve => release = resolve);
    await page.route('**/api/catalog/korea-report?*', async route => {
      const query = new URL(route.request().url()).searchParams, kind = query.get('kind');
      assert.equal(query.get('id'), identity.offerId); assert.equal(query.get('lot'), identity.lot);
      assert.ok(['history', 'inspection'].includes(kind)); calls[kind]++;
      if (kind === 'history' && calls.history === 1) {await held; await route.fulfill({status: 503, json: {error: 'report_unavailable'}}); return;}
      if (kind === 'inspection' && calls.inspection === 1) {await route.fulfill({status: 404, json: {error: 'report_missing'}}); return;}
      await route.fulfill({json: payload(kind)});
    });
    await open();
    const trigger = page.locator('[data-korea-report-trigger]:visible');
    await trigger.waitFor(); await page.waitForTimeout(100);
    assert.deepEqual(calls, {history: 0, inspection: 0});
    await trigger.click();
    const panel = page.locator('[data-paid-korea-report-panel]:visible');
    await panel.waitFor();
    assert.deepEqual(calls, {history: 0, inspection: 0}, 'outer disclosure does not fetch reports');
    const history = panel.locator('[data-korea-report-section="history"]'), inspection = panel.locator('[data-korea-report-section="inspection"]');
    await history.getByRole('button', {name: 'Страховая история', exact: true}).click();
    await history.getByRole('status').waitFor();
    await trigger.click(); await trigger.click();
    assert.equal(calls.history, 1, 'closing the outer disclosure reuses the pending request');
    await history.getByRole('button', {name: 'Страховая история', exact: true}).click();
    await history.getByRole('button', {name: 'Страховая история', exact: true}).click();
    assert.equal(calls.history, 1, 'closing the inner disclosure reuses the pending request');
    await inspection.getByRole('button', {name: 'Осмотр автомобиля', exact: true}).click();
    await inspection.getByText('Для этого автомобиля сведения не предоставлены.', {exact: true}).waitFor();
    release();
    await history.getByText('Не удалось загрузить отчёт. Попробуйте ещё раз позже.', {exact: true}).waitFor();
    await history.getByRole('button', {name: 'Повторить', exact: true}).click();
    await history.locator('[data-paid-korea-history]').waitFor();
    assert.equal(await history.locator('[data-paid-korea-count="own"]').innerText(), '4');
    assert.equal(await history.locator('[data-paid-korea-count="other"]').innerText(), '2');
    assert.ok((await history.innerText()).replace(/\s/g, '').includes('3085736KRW'));
    assert.equal(await history.locator('[data-paid-korea-claim]').count(), 2);
    assert.equal(await history.locator('[data-paid-korea-claim]').nth(1).getByText('0 KRW', {exact: true}).count(), 2);
    await history.getByText('Страховая компания владельца', {exact: true}).waitFor();
    assert.equal(await panel.locator('iframe,a,img').count(), 0, 'no external links, images or frames');
    assert.equal(await page.getByText('Страховых случаев нет', {exact: true}).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'history does not overflow');
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({path: `${out}/${width}-${theme}-history.png`});
    await inspection.getByRole('button', {name: 'Повторить', exact: true}).click();
    await inspection.locator('[data-paid-korea-inspection]').waitFor();
    await inspection.locator('summary').filter({hasText: /^Двигатель$/}).click();
    await inspection.getByText('Головка блока', {exact: true}).waitFor();
    await inspection.getByText('Следы масла', {exact: true}).waitFor();
    await inspection.locator('summary').filter({hasText: /^Наружные панели$/}).click();
    assert.equal(await inspection.getByText('Переднее левое крыло', {exact: true}).count(), 2);
    assert.equal(await inspection.getByText('83 045 км', {exact: true}).count() + await inspection.getByText('83\u00a0045 км', {exact: true}).count() > 0, true);
    await inspection.getByText('Обнаружена замена наружной панели', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'inspection does not overflow');
    await trigger.click(); await trigger.click();
    assert.deepEqual(calls, {history: 2, inspection: 2}, 'both loaded reports survive closing');
    if (width > 1280) {
      const historyBox = await trigger.boundingBox(), specificationBox = await page.getByRole('button', {name: 'Все характеристики', exact: true}).boundingBox();
      assert.ok(Math.abs(historyBox.y - specificationBox.y) < 2 && historyBox.x > specificationBox.x, 'existing desktop button placement');
    }
    await inspection.scrollIntoViewIfNeeded(); await page.screenshot({path: `${out}/${width}-${theme}-inspection.png`});
    assert.deepEqual(errors, []); await page.close();
  }

  // An identity mismatch cannot expose data; a successful null report cannot invent zeroes.
  const {page, errors, open} = await pageFor(390, 'light');
  let calls = 0;
  await page.route('**/api/catalog/korea-report?*', async route => {
    calls++;
    await route.fulfill({json: calls === 1 ? {...payload('history'), lot: '99999999'} : payload('history', {history: null})});
  });
  await open(); await page.locator('[data-korea-report-trigger]:visible').click();
  const history = page.locator('[data-paid-korea-report-panel]:visible [data-korea-report-section="history"]');
  await history.getByRole('button', {name: 'Страховая история', exact: true}).click();
  await history.getByText('Не удалось загрузить отчёт. Попробуйте ещё раз позже.', {exact: true}).waitFor();
  assert.equal(await history.locator('[data-paid-korea-count]').count(), 0);
  await history.getByRole('button', {name: 'Повторить', exact: true}).click();
  await history.getByText('Сведения о страховой истории не предоставлены.', {exact: false}).waitFor();
  assert.equal(await history.locator('[data-paid-korea-count]').count(), 0);
  assert.deepEqual(errors, []); await page.close();
  assert.equal(externalRequests, 0);
  console.log('PASS: actual desktop/mobile disclosure, light/dark; no initial/provider requests; independent lazy sections, pending/result reuse, failure/missing retry; exact paid identity; KRW counts/claims; null is not zero; inspection/diagnosis facts; no external links/frames; no horizontal overflow');
} finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
