import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// This fixture runs the real component/effects. Only Next transport is replaced
// by recorded navigation plus controllable server-prop acknowledgements.
const require = createRequire(import.meta.url);
const playwright = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(require.resolve('playwright')).href);
const {chromium} = playwright.default || playwright;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-range-commit-'));
const baselineRevision = '860e1ff601c6852eb3b1474982e52e3a5300c4af';
const component = 'apps/web/components/catalog/CatalogFilters.tsx';
const baselineSource = execFileSync('git', ['show', `${baselineRevision}:${component}`], {encoding: 'utf8'});
const results = [];
const report = {passed: false, runtimeSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  component, componentSha256: createHash('sha256').update(fs.readFileSync(component)).digest('hex'),
  baselineRevision, baselineComponentSha256: createHash('sha256').update(baselineSource).digest('hex'),
  environment: 'Actual CatalogFilters in Chromium; local synthetic data and recorded Next transport; no suppliers or public acceptance', cases: results};
const next = {name: 'record-next-navigation', setup(builder) {
  builder.onResolve({filter: /^next\/(navigation|link)$/}, args => ({path: args.path, namespace: 'next-fixture'}));
  builder.onLoad({filter: /.*/, namespace: 'next-fixture'}, args => ({loader: 'js', resolveDir: process.cwd(), contents:
    args.path.endsWith('navigation')
      ? `const router={push(href,options){window.__filterFixture.navigate(href,options);},replace(href){history.replaceState(null,'',href);}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`
      : `import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children);}`,
  }));
}};
for (const variant of ['current', 'baseline']) {
  await build({entryPoints: ['tests/browser/catalog-range-commit-fixture.tsx'], bundle: true, format: 'iife', platform: 'browser',
    jsx: 'automatic', outfile: path.join(temporary, variant + '.js'), tsconfig: 'apps/web/tsconfig.json',
    define: {'process.env.NODE_ENV': '"production"'}, plugins: [next, ...(variant === 'baseline' ? [{name: 'exact-baseline', setup(builder) {
      builder.onLoad({filter: /\/CatalogFilters\.tsx$/}, () => ({loader: 'tsx', contents: baselineSource,
        resolveDir: path.resolve(path.dirname(component))}));
    }}] : [])]});
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({counts: {}, modelCounts: {}, items: [], models: []}));
  } else if (['/current.js', '/baseline.js'].includes(url.pathname)) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(fs.readFileSync(path.join(temporary, path.basename(url.pathname))));
  } else {
    const variant = url.pathname.startsWith('/baseline/') ? 'baseline' : 'current';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font:16px sans-serif;margin:12px}button,input{font:inherit;margin:3px;padding:7px}input{width:150px}.ac-range-card{border:1px solid #ddd;margin:5px;padding:5px}.ac-filter-more-button{display:none}.ac-catalog-filter-panel{display:block}.ac-filter-dropdown{background:white}.ac-mobile-filter-backdrop{position:fixed;inset:0;background:#0007;display:flex;align-items:end}.ac-mobile-filter-sheet{background:white;max-height:96vh;overflow:auto;width:100%}.ac-hide-scrollbar{overflow:auto}.ac-range-value-toggle,.ac-filter-clear{display:none}
      @media(max-width:1023px){.ac-catalog-filter-panel{display:none}.ac-filter-more-button{display:block}}
      </style></head><body><div id="root"></div><script src="/${variant}.js"></script></body></html>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function withPage(run, {query = 'market=china', width = 1280, variant = 'current'} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1100}, hasTouch: width < 1024, serviceWorkers: 'block', locale: 'ru-RU'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(`${origin}/${variant}/cars?${query}`);
    await page.waitForFunction(() => window.__filterFixture && !document.querySelector('button[aria-label="Открыть фильтры"]').disabled);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
const calls = page => page.evaluate(() => window.__filterFixture.calls);
const settled = page => page.waitForFunction(() => document.querySelector('.ac-catalog-filter-panel').getAttribute('aria-busy') === 'false');
const budget = page => page.locator('.ac-catalog-filter-panel').getByRole('textbox', {name: 'Цена: до', exact: true});
async function expectCalls(page, count) {
  await page.waitForFunction(count => window.__filterFixture.calls.length >= count, count);
  assert.equal((await calls(page)).length, count);
}
async function caseOf(name, run, options) {
  try { await withPage(run, options); }
  catch (error) { results.push({name, passed: false}); error.message = `${name}: ${error.message}`; throw error; }
  results.push({name, passed: true});
}
async function holdClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', args: ['--no-sandbox']});
  await caseOf('typing waits for Tab; one normalized final query', async page => {
    await budget(page).fill('2000000');
    await page.waitForTimeout(240);
    assert.deepEqual(await calls(page), []);
    await budget(page).press('Tab');
    await expectCalls(page, 1); await settled(page);
    await page.waitForTimeout(220);
    const [call] = await calls(page);
    assert.equal((await calls(page)).length, 1);
    assert.equal(new URL(call.href, origin).searchParams.get('budget'), '2000000');
    assert.deepEqual(call.options, {scroll: false});
  });
  await caseOf('Enter and repeated blur do not duplicate navigation', async page => {
    await budget(page).fill('2000000'); await budget(page).press('Enter');
    await expectCalls(page, 1); await settled(page);
    await budget(page).dispatchEvent('focusout');
    await page.waitForTimeout(230);
    assert.equal((await calls(page)).length, 1);
  });
  await caseOf('both normalized bounds travel in one query', async page => {
    await budget(page).fill('1500000'); await budget(page).press('Tab');
    await expectCalls(page, 1); await settled(page);
    const query = new URL((await calls(page))[0].href, origin).searchParams;
    assert.equal(query.get('budgetFrom'), '1500000'); assert.equal(query.get('budget'), '1500000');
    await page.waitForTimeout(220); assert.equal((await calls(page)).length, 1);
  }, {query: 'market=china&budgetFrom=2000000&budget=3000000'});
  await caseOf('dirty input to held preset click submits only the preset', async page => {
    await budget(page).fill('2500000');
    await holdClick(page, page.locator('.ac-catalog-filter-panel').getByRole('button', {name: 'до 2 млн', exact: true}));
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    assert.equal((await calls(page)).length, 1);
    assert.equal(new URL((await calls(page))[0].href, origin).searchParams.get('budget'), '2000000');
  });
  await caseOf('dirty input to held clear click submits only cleared bounds', async page => {
    await budget(page).fill('2500000');
    await holdClick(page, page.locator('.ac-catalog-filter-panel').getByRole('button', {name: 'Сбросить Цена', exact: true}));
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    const final = await calls(page); assert.equal(final.length, 1);
    assert.equal(new URL(final[0].href, origin).searchParams.has('budget'), false);
    assert.equal(new URL(final[0].href, origin).searchParams.has('budgetFrom'), false);
  }, {query: 'market=china&budget=2000000'});
  await caseOf('cancelled held preset leaves text pending until keyboard blur', async page => {
    await budget(page).fill('2500000');
    const preset = page.locator('.ac-catalog-filter-panel').getByRole('button', {name: 'до 2 млн', exact: true});
    await preset.scrollIntoViewIfNeeded(); const rect = await preset.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
    await page.waitForTimeout(60); await page.mouse.move(0, 0); await page.mouse.up();
    await page.waitForTimeout(230); assert.deepEqual(await calls(page), []);
    assert.equal(await budget(page).inputValue(), '2500000');
    await budget(page).press('Tab'); await expectCalls(page, 1); await settled(page);
    assert.equal(new URL((await calls(page))[0].href, origin).searchParams.get('budget'), '2500000');
  });
  await caseOf('keyboard preset and clear remain accessible with one push each', async page => {
    const panel = page.locator('.ac-catalog-filter-panel');
    await panel.getByRole('button', {name: 'до 3 млн', exact: true}).focus();
    await panel.getByRole('button', {name: 'до 3 млн', exact: true}).press('Enter');
    await expectCalls(page, 1); await settled(page);
    await panel.getByRole('button', {name: 'Сбросить Цена', exact: true}).focus();
    await panel.getByRole('button', {name: 'Сбросить Цена', exact: true}).press('Enter');
    await expectCalls(page, 2); await settled(page); await page.waitForTimeout(230);
    assert.equal((await calls(page)).length, 2);
    assert.equal(new URL((await calls(page))[1].href, origin).searchParams.has('budget'), false);
  });
  await caseOf('stale route response cannot replace a newer range or resubmit it', async page => {
    await page.evaluate(() => {window.__filterFixture.autoAcknowledge = false;});
    await budget(page).fill('1500000'); await budget(page).press('Tab'); await expectCalls(page, 1);
    await budget(page).fill('2000000'); await budget(page).press('Tab'); await expectCalls(page, 2);
    await page.evaluate(() => window.__filterFixture.acknowledge(window.__filterFixture.calls[0].href));
    await page.waitForTimeout(220); assert.equal(await budget(page).inputValue(), '2000000');
    assert.equal((await calls(page)).length, 2);
    await page.evaluate(() => window.__filterFixture.acknowledge(window.__filterFixture.calls[1].href));
    await settled(page); await page.waitForTimeout(220); assert.equal((await calls(page)).length, 2);
  });
  await caseOf('acknowledged Back restores controls without another push', async page => {
    await budget(page).fill('2000000'); await budget(page).press('Tab');
    await expectCalls(page, 1); await settled(page);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.ac-catalog-filter-panel input[aria-label="Цена: до"]').value === '1500000');
    await settled(page); await page.waitForTimeout(220); assert.equal((await calls(page)).length, 1);
  }, {query: 'market=china&budget=1500000'});
  await caseOf('mobile blur and close share one final navigation', async page => {
    await page.getByRole('button', {name: 'Открыть фильтры', exact: true}).click();
    const panel = page.getByRole('dialog', {name: 'Фильтры каталога'});
    await panel.getByRole('textbox', {name: 'Цена: до', exact: true}).fill('2000000');
    await panel.getByRole('button', {name: 'Показать автомобили', exact: true}).click();
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(220);
    assert.equal((await calls(page)).length, 1); assert.equal(await panel.count(), 0);
  }, {width: 390});
  await caseOf('touch preset and clear do not submit dirty intermediate text', async page => {
    await page.getByRole('button', {name: 'Открыть фильтры', exact: true}).tap();
    const panel = page.getByRole('dialog', {name: 'Фильтры каталога'});
    const input = panel.getByRole('textbox', {name: 'Цена: до', exact: true});
    await input.fill('2500000');
    await panel.getByRole('button', {name: 'до 2 млн', exact: true}).tap();
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(220);
    assert.equal((await calls(page)).length, 1);
    assert.equal(new URL((await calls(page))[0].href, origin).searchParams.get('budget'), '2000000');
    await input.fill('2500000');
    await panel.getByRole('button', {name: 'Сбросить Цена', exact: true}).tap();
    await expectCalls(page, 2); await settled(page); await page.waitForTimeout(220);
    assert.equal((await calls(page)).length, 2);
    assert.equal(new URL((await calls(page))[1].href, origin).searchParams.has('budget'), false);
  }, {width: 390});
  await caseOf('mixed range and categorical edits retain coalescing', async page => {
    const control = page.locator('.ac-catalog-filter-panel input[name="bodyType"]').locator('..');
    await budget(page).fill('2000000');
    await control.locator(':scope > button').dispatchEvent('click');
    await page.evaluate(() => {
      const panel = document.querySelector('.ac-catalog-filter-panel');
      const control = panel.querySelector('input[name="bodyType"]').parentElement;
      const option = [...control.querySelectorAll('.ac-filter-option')].find(node => node.textContent.includes('Седан'));
      option.click(); panel.querySelector('input[aria-label="Цена: до"]').blur();
    });
    await page.waitForTimeout(80); assert.deepEqual(await calls(page), []);
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(220);
    const final = await calls(page); assert.equal(final.length, 1);
    const query = new URL(final[0].href, origin).searchParams;
    assert.equal(query.get('budget'), '2000000'); assert.equal(query.get('bodyType'), 'sedan');
  });
  await caseOf('auction typing keeps the existing 650ms coalescing', async page => {
    const lot = page.locator('.ac-catalog-filter-panel input[name="lotNumber"]');
    await lot.fill('123'); await page.waitForTimeout(250); assert.deepEqual(await calls(page), []);
    await lot.fill('1234'); await page.waitForTimeout(300); assert.deepEqual(await calls(page), []);
    await expectCalls(page, 1); await settled(page); assert.equal(new URL((await calls(page))[0].href, origin).searchParams.get('lotNumber'), '1234');
  }, {query: 'market=japan&fixtureAuction=1'});
  await caseOf('no-op range blur does not navigate', async page => {
    await budget(page).focus(); await budget(page).press('Tab');
    await page.waitForTimeout(230); assert.deepEqual(await calls(page), []);
  }, {query: 'market=china&budget=2000000'});
  await caseOf('unmount cancels pending navigation', async page => {
    await budget(page).fill('2000000');
    await page.evaluate(() => {
      document.querySelector('.ac-catalog-filter-panel input[aria-label="Цена: до"]').blur();
      window.__filterFixture.unmount();
    });
    await page.waitForTimeout(230); assert.deepEqual(await calls(page), []);
  });
  const profile = {};
  for (const variant of ['baseline', 'current']) {
    const samples = [];
    await withPage(async page => {
      for (let i = 0; i < 7; i++) {
        await budget(page).fill(String(1500000 + i * 100000));
        const started = await page.evaluate(() => {
          const started = performance.now();
          document.querySelector('.ac-catalog-filter-panel input[aria-label="Цена: до"]').blur();
          return started;
        });
        await expectCalls(page, i + 1); await settled(page);
        samples.push(Number(((await calls(page))[i].at - started).toFixed(3)));
      }
    }, {variant});
    profile[variant] = {samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3]};
  }
  report.passed = true;
  report.profile = {kind: 'local real component blur-to-router.push, transport stubbed; not public browser acceptance', ...profile};
} catch (error) {
  report.error = {name: error.name, message: String(error.message).slice(0,2000)};
  process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(process.env.CATALOG_RANGE_REPORT || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'catalog-range-commit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  fs.rmSync(temporary, {recursive: true, force: true});
}
