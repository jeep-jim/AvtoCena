import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const reportPath = process.env.JAPAN_PHOTO_RETRY_REPORT;
if (reportPath) assert.ok(path.isAbsolute(reportPath), 'report path must be absolute');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-photo-retry-'));
const completedWidths = [], checkNames = ['transientRecovery', 'persistentFailureBound',
  'sourceChangeCancellation', 'unmountCancellation', 'exactUrl', 'noExternalRequests',
  'protectedPhotoPreserved', 'lazyLoadRecovery'];
let passed = false, caseCount = 0, browser, server, unexpectedRequests = 0;
function writeReport() {
  const report = {version: 1, kind: 'japan-photo-retry-browser-v1', passed,
    widths: [...completedWidths], caseCount,
    checks: Object.fromEntries(checkNames.map(name => [name, passed]))};
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  return report;
}
writeReport();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#557799"/></svg>';
async function until(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail(message);
}
const state = page => page.evaluate(() => {
  const image = document.querySelector('#photo-cover img');
  return {images: image ? 1 : 0, placeholder: Boolean(document.querySelector('#photo-cover [role="img"]')),
    decoded: Boolean(image?.complete && image.naturalWidth > 0),
    src: image?.getAttribute('src') ?? null, scheduled: Boolean(image?.dataset.photoRetried),
    errors: window.__photoRetryFixture.errors, loads: window.__photoRetryFixture.loads};
});
const configure = (page, value) => page.evaluate(next => window.__photoRetryFixture.configure(next), value);

try {
  await build({entryPoints: ['tests/browser/catalog-photo-retry-fixture.tsx'], bundle: true,
    format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: 'apps/web/tsconfig.json',
    outfile: path.join(temporary, 'fixture.js'), define: {'process.env.NODE_ENV': '"production"'}});
  const javascript = fs.readFileSync(path.join(temporary, 'fixture.js'));
  server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, {'content-type': 'application/javascript'}); response.end(javascript); return;
    }
    if (request.url !== '/') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:16px;color:#223;background:#eef}#photo-cover{width:320px;height:240px}#photo-cover>img,#photo-cover>[role=img]{width:100%;height:100%;object-fit:cover}</style><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN || undefined,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync']});

  for (const width of [1440, 390]) {
    for (const scenario of ['transient', 'persistent', 'source-change', 'unmount', 'protected', 'lazy']) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [], targets = new Map();
      page.on('pageerror', error => errors.push(error.message));
      const source = scenario === 'protected' ? '/api/catalog/photo/fixture?url=fixture&market=china'
        : `https://7.tru.ru/img/fixture_${scenario.replaceAll('-', '_')}&w=320`;
      const requested = scenario === 'protected' ? origin + source + '&view=card' : source;
      const replacement = 'https://8.ajes.com/img/fixture_replacement&w=320';
      const initial = {count: 0, failures: scenario === 'persistent' ? Infinity : 1, urls: []};
      const next = {count: 0, failures: 0, urls: []};
      targets.set(requested, initial);
      if (scenario === 'source-change') targets.set(replacement, next);
      await page.route('**/*', async route => {
        const request = route.request(), url = request.url();
        if (request.method() === 'GET' && [origin + '/', origin + '/fixture.js'].includes(url)) return route.continue();
        const target = request.method() === 'GET' && request.resourceType() === 'image' ? targets.get(url) : null;
        if (!target) { unexpectedRequests++; return route.abort('blockedbyclient'); }
        // These exact fake AJ-shaped requests never leave Playwright. A source
        // URL, query or host change is blocked and fails the fixture.
        target.count++; target.urls.push(url);
        if (target.count <= target.failures) return route.abort('failed');
        return route.fulfill({status: 200, contentType: 'image/svg+xml',
          headers: {'cache-control': 'no-store'}, body: svg});
      });
      try {
        await page.addInitScript(() => { Math.random = () => 0; });
        await page.clock.install({time: new Date('2026-11-26T10:00:00.000Z')});
        await page.goto(origin + '/', {waitUntil: 'load'});
        await until(() => page.evaluate(() => window.__photoRetryFixture?.ready === true), 'fixture mounted');
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 10);
        await configure(page, {src: source, shown: true, eager: scenario !== 'lazy', belowFold: scenario === 'lazy'});
        if (scenario === 'lazy') {
          await page.clock.runFor(16);
          assert.equal(await page.locator('#photo-cover img').getAttribute('loading'), 'lazy');
          assert.equal(initial.count, 0, 'below-fold image is not eagerly fetched');
          await page.evaluate(() => document.getElementById('photo-cover').scrollIntoView());
        }
        await until(async () => (await state(page)).errors >= 1, 'initial locally aborted image reached CatalogCover');
        const failed = await state(page);
        console.log(JSON.stringify({width, scenario, observation: 'initial_failure', requests: initial.count,
          images: failed.images, placeholder: failed.placeholder}));
        assert.equal(failed.images, 1, 'transient direct-image failure must retain the image for its bounded retry');
        assert.equal(failed.placeholder, false);
        assert.equal(failed.scheduled, true);
        assert.equal(failed.src, scenario === 'protected' ? source + '&view=card' : source);

        if (scenario === 'source-change') {
          await configure(page, {src: replacement});
          await until(async () => (await state(page)).decoded, 'replacement photo decoded');
          await page.clock.runFor(120_000);
          assert.equal(initial.count, 1, 'replaced source has no stale retry');
          assert.equal(next.count, 1); assert.equal((await state(page)).src, replacement);
        } else if (scenario === 'unmount') {
          await configure(page, {shown: false});
          await page.clock.runFor(120_000);
          assert.equal(initial.count, 1, 'unmounted photo has no stale retry');
          assert.equal((await state(page)).images, 0);
        } else {
          await page.clock.runFor(14_999);
          assert.equal(initial.count, 1, 'first retry is not early');
          await page.clock.runFor(1);
          await until(async () => initial.count === 2 && (scenario === 'persistent'
            ? (await state(page)).errors >= 2 : (await state(page)).decoded), 'first bounded retry completed');
          if (scenario === 'persistent') {
            assert.equal((await state(page)).placeholder, false);
            await page.clock.runFor(34_999);
            assert.equal(initial.count, 2, 'second retry is not early');
            await page.clock.runFor(1);
            await until(async () => initial.count === 3 && (await state(page)).placeholder,
              'persistent failure stops after two retries');
            assert.equal((await state(page)).images, 0);
            await page.clock.runFor(120_000);
            assert.equal(initial.count, 3, 'no unbounded retries');
          } else {
            assert.equal((await state(page)).placeholder, false);
            await page.clock.runFor(120_000);
            assert.equal(initial.count, 2, 'successful photo does not retry again');
            assert.equal((await state(page)).decoded, true);
          }
        }
        assert.deepEqual(initial.urls, Array(initial.count).fill(requested), 'same exact URL, no cache-buster or source replacement');
        assert.deepEqual(next.urls, Array(next.count).fill(replacement));
        assert.equal(unexpectedRequests, 0, 'all non-fixture requests are forbidden');
        assert.deepEqual(errors, []);
        caseCount++;
        console.log(JSON.stringify({width, scenario, passed: true, imageRequests: initial.count,
          replacementRequests: next.count, externalRequests: 0}));
      } finally { await context.close(); }
    }
    completedWidths.push(width);
  }
  assert.equal(caseCount, 12);
  passed = true;
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.stack : 'photo retry fixture failed');
} finally {
  try { await browser?.close(); }
  catch { passed = false; process.exitCode = 1; }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify(writeReport()));
  fs.rmSync(temporary, {recursive: true, force: true});
}
