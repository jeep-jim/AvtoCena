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
// Use the exact root/public layout and catalog sidebar imports, including fonts.
// PostCSS runs from apps/web so Tailwind resolves its actual config/content.
const styleImporters = ['apps/web/app/layout.tsx', 'apps/web/app/(public)/layout.tsx', 'apps/web/components/catalog/CatalogSidebar.tsx'];
const layoutStyles = styleImporters.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/^import\s+['"]([^'"]+\.css)['"];?/gm)]
  .map(([, specifier]) => specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier)
    : require.resolve(specifier, {paths: [path.resolve(path.dirname(file))]})));
const styleBuild = await build({stdin: {contents: layoutStyles.map(file => `@import ${JSON.stringify(file)};`).join('\n'),
  loader: 'css', resolveDir: process.cwd()}, bundle: true, outfile: path.join(temporary, 'app.css'),
  loader: {'.woff2': 'file', '.woff': 'file'}, assetNames: 'assets/[name]-[hash]', publicPath: '/',
  external: ['/brands/*', '/key-logo.png'], metafile: true});
execFileSync(process.execPath, ['-e', `
  const fs = require('node:fs'), path = require('node:path');
  const config = require(path.resolve('postcss.config.js'));
  const plugins = Object.entries(config.plugins).map(([name, options]) => require(name)(options));
  const output = process.argv[1];
  require('postcss')(plugins).process(fs.readFileSync(output, 'utf8'), {from: output, to: output})
    .then(result => fs.writeFileSync(output, result.css)).catch(error => {console.error(error); process.exitCode = 1;});
`, path.join(temporary, 'app.css')], {cwd: path.resolve('apps/web'), env: {...process.env, NODE_ENV: 'production'}, stdio: 'pipe'});
const styleAssets = new Map(Object.keys(styleBuild.metafile.outputs).map(file => [
  '/' + path.relative(temporary, path.resolve(file)).split(path.sep).join('/'), path.resolve(file)]));
const digestFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
report.styles = {source: 'Exact root/public layout and CatalogSidebar CSS imports, compiled with apps/web PostCSS and Tailwind configuration',
  inputs: [...layoutStyles, 'apps/web/postcss.config.js', 'apps/web/tailwind.config.ts'].map(file => ({file: path.relative(process.cwd(), file), sha256: digestFile(file)})),
  compiledSha256: digestFile(path.join(temporary, 'app.css'))};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({counts: {}, modelCounts: {}, items: [], models: []}));
  } else if (styleAssets.has(url.pathname) || ['/current.js', '/baseline.js', '/current.css', '/baseline.css'].includes(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.woff2') ? 'font/woff2' : url.pathname.endsWith('.woff') ? 'font/woff' : 'application/javascript');
    response.end(fs.readFileSync(styleAssets.get(url.pathname) || path.join(temporary, path.basename(url.pathname))));
  } else {
    const variant = url.pathname.startsWith('/baseline/') ? 'baseline' : 'current';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/${variant}.css"></head><body><div id="root"></div><script src="/${variant}.js"></script></body></html>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const waitPhases = new WeakMap();
async function waitForFunction(page, phase, predicate, argument) {
  waitPhases.set(page, phase);
  await page.waitForFunction(predicate, argument);
  waitPhases.set(page, 'scenario-actions');
}

async function withPage(run, {query = 'market=china', width = 1280, variant = 'current'} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1100}, hasTouch: width < 1024, serviceWorkers: 'block', locale: 'ru-RU'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    waitPhases.set(page, 'fixture-navigation');
    await page.goto(`${origin}/${variant}/cars?${query}`);
    await waitForFunction(page, 'fixture-ready', () => window.__filterFixture && !document.querySelector('button[aria-label="Открыть фильтры"]').disabled);
    waitPhases.set(page, 'production-fonts-ready');
    await page.evaluate(() => document.fonts.ready);
    waitPhases.set(page, 'scenario-actions');
    await run(page);
    assert.deepEqual(errors, []);
  } catch (error) {
    report.failure = {variant, width, query, waitPhase: waitPhases.get(page), pageErrors: errors,
      stack: String(error.stack || '').split('\n').slice(0, 10),
      state: await page.evaluate(() => {
        const active = document.activeElement;
        const input = node => ({tag: node?.tagName, name: node?.getAttribute('name'), label: node?.getAttribute('aria-label'), value: node instanceof HTMLInputElement ? node.value : null, checked: node instanceof HTMLInputElement ? node.checked : null});
        return {url: location.href, fixturePresent: !!window.__filterFixture,
          calls: window.__filterFixture?.calls ?? null, keydowns: window.__filterFixture?.keydowns ?? null,
          pointerTrace: window.__filterFixture?.pointerTrace ?? null,
          autoAcknowledge: window.__filterFixture?.autoAcknowledge ?? null,
          forms: [...document.querySelectorAll('.ac-catalog-filter-panel, .ac-mobile-filter-sheet')].map(form => ({className: form.className, busy: form.getAttribute('aria-busy')})),
          activeElement: input(active), inputs: [...document.querySelectorAll('.ac-range-input-box input')].map(input)};
      }).catch(failure => ({captureError: String(failure.message).slice(0, 500)}))};
    throw error;
  } finally { await context.close(); }
}
const calls = page => page.evaluate(() => window.__filterFixture.calls);
const settled = page => waitForFunction(page, 'catalog-settled', () => document.querySelector('.ac-catalog-filter-panel').getAttribute('aria-busy') === 'false');
const budget = page => page.locator('.ac-catalog-filter-panel').getByRole('textbox', {name: 'Цена: до', exact: true});
async function expectCalls(page, count) {
  await waitForFunction(page, `navigation-count:${count}`, count => window.__filterFixture.calls.length >= count, count);
  assert.equal((await calls(page)).length, count);
}
async function caseOf(name, run, options) {
  try { await withPage(run, options); results.push({name, passed: true}); }
  catch (error) {
    results.push({name, passed: false, error: {name: error.name, message: String(error.message).slice(0, 2000)}, failure: report.failure});
  }
}
async function holdClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  await pointerSnapshot(locator, 'before-down', rect);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  assert.equal((await calls(page)).length, 0, 'pointer blur must still wait for the final click');
  await pointerSnapshot(locator, 'before-up', rect);
  await page.mouse.up();
}
async function pointerSnapshot(locator, phase, rect) {
  await locator.evaluate((target, {phase, rect}) => window.__filterFixture.snapshotPointer(phase, target,
    rect.x + rect.width / 2, rect.y + rect.height / 2), {phase, rect});
}
async function openPriceChoice(panel, label, {touch = false} = {}) {
  const toggle = panel.getByRole('button', {name: 'Выбрать значение: Цена: до', exact: true});
  if (touch) await toggle.tap(); else await toggle.click();
  return toggle.locator('..').getByRole('button', {name: label, exact: true});
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
    const preset = await openPriceChoice(page.locator('.ac-catalog-filter-panel'), '2 млн');
    await budget(page).fill('2500000');
    await holdClick(page, preset);
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
  await caseOf('cancelled held preset preserves the original blur commit', async page => {
    const preset = await openPriceChoice(page.locator('.ac-catalog-filter-panel'), '2 млн');
    await budget(page).fill('2500000');
    await preset.scrollIntoViewIfNeeded(); const rect = await preset.boundingBox();
    await pointerSnapshot(preset, 'before-cancelled-down', rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
    await page.waitForTimeout(60); await page.mouse.move(0, 0); await page.mouse.up();
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    assert.equal((await calls(page)).length, 1);
    assert.equal(await budget(page).inputValue(), '2500000');
    assert.equal(new URL((await calls(page))[0].href, origin).searchParams.get('budget'), '2500000');
  });
  await caseOf('dirty year and held price preset coalesce across range cards', async page => {
    const panel = page.locator('.ac-catalog-filter-panel');
    const preset = await openPriceChoice(panel, '2 млн');
    await panel.getByRole('textbox', {name: 'Год: от', exact: true}).fill('2019');
    await holdClick(page, preset);
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    const final = await calls(page); assert.equal(final.length, 1);
    const query = new URL(final[0].href, origin).searchParams;
    assert.equal(query.get('yearFrom'), '2019'); assert.equal(query.get('budget'), '2000000');
  });
  await caseOf('dirty mileage and held price clear coalesce across range cards', async page => {
    const panel = page.locator('.ac-catalog-filter-panel');
    await panel.getByRole('textbox', {name: 'Пробег: до', exact: true}).fill('50000');
    await holdClick(page, panel.getByRole('button', {name: 'Сбросить Цена', exact: true}));
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    const final = await calls(page); assert.equal(final.length, 1);
    const query = new URL(final[0].href, origin).searchParams;
    assert.equal(query.get('mileageTo'), '50000'); assert.equal(query.has('budget'), false);
  }, {query: 'market=china&budget=2000000'});
  await caseOf('dirty range and held power checkbox coalesce into one query', async page => {
    await budget(page).fill('2000000');
    await holdClick(page, page.locator('.ac-catalog-filter-panel input[name="powerTo"]'));
    await expectCalls(page, 1); await settled(page); await page.waitForTimeout(230);
    const final = await calls(page); assert.equal(final.length, 1);
    const query = new URL(final[0].href, origin).searchParams;
    assert.equal(query.get('budget'), '2000000'); assert.equal(query.get('powerTo'), '160');
  });
  await caseOf('prevented Tab expires before an unrelated later blur', async page => {
    await budget(page).fill('2000000');
    await budget(page).evaluate(input => input.addEventListener('keydown', event => {if (event.key === 'Tab') event.preventDefault();}, {once: true}));
    await budget(page).press('Tab'); await page.waitForTimeout(30); assert.deepEqual(await calls(page), []);
    await budget(page).evaluate(input => input.blur());
    await page.waitForTimeout(80); assert.deepEqual(await calls(page), []);
    await expectCalls(page, 1); await settled(page);
  });
  await caseOf('keyboard preset and clear remain accessible with one push each', async page => {
    const panel = page.locator('.ac-catalog-filter-panel');
    const preset = await openPriceChoice(panel, '3 млн');
    await preset.focus();
    await preset.press('Enter');
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
  await caseOf('Enter intent is consumed before an external sticky-chip pointer click', async page => {
    await page.evaluate(() => {window.__filterFixture.autoAcknowledge = false;});
    await budget(page).fill('2000000'); await budget(page).press('Enter'); await expectCalls(page, 1);
    await page.locator('.ac-catalog-sticky-sentinel').evaluate(async marker => {
      marker.scrollIntoView({block: 'center'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0, window.scrollY + marker.getBoundingClientRect().top + 80);
    });
    const sticky = page.getByRole('navigation', {name: 'Выбранные фильтры и сортировка'});
    const chip = sticky.getByRole('button', {name: /^Убрать Цена /});
    waitPhases.set(page, 'sticky-chip-visible');
    await chip.waitFor({state: 'visible'});
    waitPhases.set(page, 'scenario-actions');
    assert.equal(await chip.evaluate(button => button.closest('form') === null), true);
    await page.evaluate(() => document.addEventListener('click', () => {window.__stickyClickAt = performance.now();}, {once: true, capture: true}));
    await chip.click(); await expectCalls(page, 2);
    const final = await calls(page), clickedAt = await page.evaluate(() => window.__stickyClickAt);
    const delay = final[1].at - clickedAt;
    assert.ok(delay >= 175, `external pointer action must keep the existing 180ms coalescing window, observed ${delay}ms`);
    assert.equal(new URL(final[1].href, origin).searchParams.has('budget'), false);
    await page.evaluate(() => window.__filterFixture.acknowledge(window.__filterFixture.calls[1].href));
    await settled(page); await page.waitForTimeout(230); assert.equal((await calls(page)).length, 2);
  }, {query: 'market=china&budget=1500000'});
  await caseOf('acknowledged Back restores controls without another push', async page => {
    await budget(page).fill('2000000'); await budget(page).press('Tab');
    await expectCalls(page, 1); await settled(page);
    await page.goBack();
    await waitForFunction(page, 'back-control-restored', () => document.querySelector('.ac-catalog-filter-panel input[aria-label="Цена: до"]').value === '1500000');
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
    const preset = await openPriceChoice(panel, '2 млн', {touch: true});
    await input.fill('2500000');
    await preset.scrollIntoViewIfNeeded();
    await pointerSnapshot(preset, 'before-touch', await preset.boundingBox());
    await preset.tap();
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
  const failedCases = results.filter(result => !result.passed);
  assert.equal(failedCases.length, 0, `${failedCases.length} independent component cases failed; inspect each case's preserved failure state`);
  const profile = {};
  for (const variant of ['baseline', 'current']) {
    const samples = [];
    await withPage(async page => {
      for (let i = 0; i < 7; i++) {
        await budget(page).fill(String(1500000 + i * 100000));
        await budget(page).press('Tab');
        const started = await page.evaluate(() => window.__filterFixture.keydowns.at(-1).at);
        await expectCalls(page, i + 1); await settled(page);
        samples.push(Number(((await calls(page))[i].at - started).toFixed(3)));
      }
    }, {variant});
    profile[variant] = {samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3]};
  }
  report.passed = true;
  report.profile = {kind: 'actual Tab keydown to router.push in real component; transport stubbed; not public browser acceptance', ...profile};
} catch (error) {
  report.error = {name: error.name, message: String(error.message).slice(0,2000)};
  process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(process.env.CATALOG_RANGE_REPORT || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'catalog-range-commit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  fs.rmSync(temporary, {recursive: true, force: true});
}
