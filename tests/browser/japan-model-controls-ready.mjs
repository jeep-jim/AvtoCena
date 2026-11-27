import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {checkedJapanStabilityDirectory, selectJapanStabilityModelThroughUi}
  from '../../scripts/catalog-next/japan-stability-browser.mjs';
import {japanNavigationErrorCode} from '../../scripts/catalog-next/japan-browser-acceptance.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const INITIAL_URL = ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY});
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('japan_controls_fixture_' + code); };
const require = createRequire(import.meta.url);
const SOURCE_FILES = ['apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogBrandMultiSelect.tsx', 'apps/web/components/catalog/VehicleModelSearch.tsx',
  'apps/web/components/catalog/CatalogSelectionContext.tsx', 'apps/web/lib/catalog/catalog-routes.ts',
  'tests/browser/japan-catalog-city-fixture.tsx'];
const MODELS = {version: 1, brands: [], models: [['MAZDA', 'MAZDA3 FASTBACK', [], 12]], stale: false};

/** The controller supplies only transport and lifecycle assertions. Every
 * component is bundled from the independently verified runtime checkout. */
export async function prepareJapanModelControlsFixture(runtimeRoot, plan, {extraSourceFiles = [],
  transformFixture = value => value, extraCss = ''} = {}) {
  need(path.isAbsolute(runtimeRoot || '') && runtimeRoot !== ROOT.replace(/\/$/, ''), 'runtime_root');
  const git = args => execFileSync('git', ['-C', runtimeRoot, ...args], {encoding: 'utf8', timeout: 30_000}).trim();
  need(git(['rev-parse', 'HEAD']) === plan.runtimeSha && git(['rev-parse', 'HEAD^{tree}']) === plan.runtimeTree, 'runtime_binding');
  const sources = {};
  for (const file of [...SOURCE_FILES, ...extraSourceFiles]) {
    const raw = await fs.readFile(path.join(runtimeRoot, file));
    const committed = execFileSync('git', ['-C', runtimeRoot, 'show', plan.runtimeSha + ':' + file], {timeout: 30_000});
    need(raw.equals(committed), 'runtime_component_changed'); sources[file] = hash(raw);
  }
  const fixtureFile = path.join(runtimeRoot, SOURCE_FILES.at(-1));
  let fixture = await fs.readFile(fixtureFile, 'utf8');
  const once = (before, after) => {
    need(fixture.split(before).length === 2, 'runtime_fixture_contract'); fixture = fixture.replace(before, after);
  };
  // The existing exact-runtime fixture already renders/hydrates CatalogFilters
  // and acknowledges canonical URLs. Add only a route-key remount variant to
  // model the leaf-page boundary; no production component is replaced.
  once('const [initial,setInitial]=useState(serverInitial);',
    "const [initial,setInitial]=useState(serverInitial);const [routeKey,setRouteKey]=useState('/cars/japan');");
  once("const acknowledge=()=>setInitial({...Object.fromEntries(new URLSearchParams(location.search)),...catalogRouteParams(location.pathname)});",
    "const acknowledge=()=>{setInitial({...Object.fromEntries(new URLSearchParams(location.search)),...catalogRouteParams(location.pathname)});if((window as any).__japanModelRemount)setRouteKey(location.pathname);};");
  once('<CatalogFilters initial={initial}', '<CatalogFilters key={routeKey} initial={initial}');
  fixture = transformFixture(fixture);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-model-controls-'));
  const transport = {name: 'verified-runtime-controls-transport', setup(builder) {
    builder.onResolve({filter: /^fixture:runtime-controls$/}, () => ({path: 'controls', namespace: 'runtime-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'runtime-fixture'}, () => ({contents: fixture, loader: 'tsx', resolveDir: path.dirname(fixtureFile)}));
    builder.onResolve({filter: /^next\/(navigation|link)$/}, args => ({path: args.path, namespace: 'next-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'next-fixture'}, args => ({loader: 'js', resolveDir: runtimeRoot,
      contents: args.path.endsWith('navigation')
        ? `const router={push(href){window.__japanCityFixture.navigate(href)},replace(href){history.replaceState(null,'',href)},refresh(){return window.__japanCityFixture.refresh?.()}};export const useRouter=()=>router;export const usePathname=()=>typeof location==='undefined'?null:location.pathname;export const useSearchParams=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);`
        : `import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}`,
    }));
  }};
  const common = {absWorkingDir: runtimeRoot, bundle: true, jsx: 'automatic',
    tsconfig: path.join(runtimeRoot, 'apps/web/tsconfig.json'), define: {'process.env.NODE_ENV': '"production"'},
    plugins: [transport], logLevel: 'silent'};
  try {
    await build({...common, stdin: {contents: "import 'fixture:runtime-controls';", resolveDir: runtimeRoot, loader: 'js'},
      platform: 'browser', format: 'iife', outfile: path.join(temporary, 'fixture.js')});
    await build({...common, stdin: {contents: `import React from 'react';import {renderToString} from 'react-dom/server';import {JapanCityFixture} from 'fixture:runtime-controls';export const render=initial=>renderToString(React.createElement(JapanCityFixture,{initial}));`, resolveDir: runtimeRoot, loader: 'tsx'},
      platform: 'node', format: 'cjs', outfile: path.join(temporary, 'server.cjs')});
    const {render} = require(path.join(temporary, 'server.cjs'));
    const renderMarkup = initial => render(initial).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
      (_all, open, css, close) => open + css.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&') + close);
    const markup = renderMarkup({market: 'japan', city: CITY});
    need(markup.includes('aria-label="Расширенные фильтры"') && markup.includes('aria-busy="true"'), 'actual_ssr_marker');
    const css = await postcss([tailwindcss({content: [...SOURCE_FILES.slice(0, 3), ...extraSourceFiles].map(file => path.join(runtimeRoot, file))})])
      .process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
    return {temporary, sources, markup, renderMarkup, javascript: await fs.readFile(path.join(temporary, 'fixture.js')),
      css: css.css + '.ac-catalog-filter-panel{display:block!important;width:360px;padding:12px}.ac-catalog-filter-panel>div.grid{display:flex;flex-direction:column;gap:10px}.ac-catalog-sidebar .ac-filter-settings{display:none!important}.ac-filter-more-button{display:none!important}.ac-filter-dropdown{background:white}.ac-catalog-sidebar{width:400px}' + extraCss};
  } catch (error) { await fs.rm(temporary, {recursive: true, force: true}); throw error; }
}

async function main() {
  const report = {version: 1, kind: 'japan-model-controls-ready-browser-v1', passed: false,
    scope: 'Verified runtime CatalogFilters SSR/hydration with actual controller selection helper and loopback-only transport',
    runtimeSha: null, runtimeTree: null, playwrightVersion: null, browserVersion: null,
    productionRequests: 0, supplierRequests: 0, forbiddenTransportAttempts: 0, cases: []};
  let fixture, browser, server, active, activeCase = 'setup';
  try {
    need(process.argv.length === 2, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(ROOT, '.github/operations/catalog-next/china-code-serving-plan.json'), 'utf8'));
    fixture = await prepareJapanModelControlsFixture(process.env.PHOTO_RUNTIME_ROOT, plan);
    Object.assign(report, {runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree, componentSha256: fixture.sources,
      controllerHelperSha256: hash(await fs.readFile(path.join(ROOT, 'scripts/catalog-next/japan-stability-browser.mjs')))});
    need(path.isAbsolute(process.env.PLAYWRIGHT_MODULE || '') && path.isAbsolute(process.env.CHROME_BIN || ''), 'browser_environment');
    const pkg = JSON.parse(await fs.readFile(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'package.json'), 'utf8'));
    need(pkg.version === '1.55.0', 'playwright_version'); report.playwrightVersion = pkg.version;
    server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, ORIGIN);
        if (url.pathname === '/fixture.js') { response.writeHead(200, {'Content-Type': 'application/javascript'}); response.end(fixture.javascript); return; }
        if (url.pathname === '/fixture.css') { response.writeHead(200, {'Content-Type': 'text/css'}); response.end(fixture.css); return; }
        if (/^\/brand-logos\/local\/(light|dark)\/(mazda|nissan)\.png$/.test(url.pathname)) {
          response.writeHead(200, {'Content-Type': 'image/png'});
          response.end(await fs.readFile(path.join(process.env.PHOTO_RUNTIME_ROOT, 'apps/web/public', url.pathname))); return;
        }
        if (url.pathname.startsWith('/api/')) {
          need(url.searchParams.get('market') === 'japan' && !url.searchParams.has('stock'), 'metadata_scope');
          response.setHeader('Content-Type', 'application/json');
          if (url.pathname === '/api/catalog/brand-counts') {
            active.brandRequests++; response.end(JSON.stringify({generationId: new Date().toISOString(), counts: {MAZDA: 12, NISSAN: 2}, modelCounts: {MAZDA: 1}, stale: false})); return;
          }
          need(url.pathname === '/api/catalog/source-models' && (!url.searchParams.has('make') || url.searchParams.get('make').toUpperCase() === 'MAZDA'), 'model_metadata_scope');
          active.modelRequests++; response.end(JSON.stringify(MODELS)); return;
        }
        need(url.href === INITIAL_URL && active, 'document_scope');
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div class="ac-catalog-sidebar" id="root">'
          + fixture.markup + '</div><script>window.__japanCityInitial=' + JSON.stringify({market: 'japan', city: CITY})
          + ';window.__japanModelRemount=' + JSON.stringify(active.remount) + '</script><script async src="/fixture.js"></script></body></html>');
      } catch { report.forbiddenTransportAttempts++; response.writeHead(400); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const loopback = 'http://127.0.0.1:' + server.address().port;
    const {chromium} = await import(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-background-networking']});
    const version = browser.version(); report.browserVersion = /^\d+(?:\.\d+){1,4}$/.test(version) ? version : null;
    for (const remount of [false, true]) {
      activeCase = remount ? 'delayed_hydration_remounted_controls' : 'delayed_hydration_preserved_controls';
      const state = active = {remount, brandRequests: 0, modelRequests: 0, scriptHeld: false};
      let releaseScript; const scriptAllowed = new Promise(resolve => { releaseScript = resolve; });
      const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'ru-RU', serviceWorkers: 'block'});
      const page = await context.newPage(), pageErrors = [];
      const progress = {}; report.activeProgress = progress;
      page.on('pageerror', error => pageErrors.push(japanNavigationErrorCode(error)));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const allowed = url.origin === ORIGIN && request.method() === 'GET' && (url.href === INITIAL_URL
          || ['/fixture.js', '/fixture.css', '/api/catalog/brand-counts', '/api/catalog/source-models'].includes(url.pathname)
          || /^\/brand-logos\/local\/(light|dark)\/(mazda|nissan)\.png$/.test(url.pathname));
        if (!allowed) { report.forbiddenTransportAttempts++; await route.abort('blockedbyclient'); return; }
        if (url.pathname === '/fixture.js') { state.scriptHeld = true; await scriptAllowed; }
        let response;
        try {
          response = await route.fetch({url: loopback + url.pathname + url.search, maxRedirects: 0, timeout: 15_000});
          need(response.status() === 200, 'loopback_response'); await route.fulfill({response});
        } catch { await route.abort('failed').catch(() => {}); }
        finally { if (response) await response.dispose().catch(() => {}); }
      });
      try {
        await page.goto(INITIAL_URL, {waitUntil: 'domcontentloaded', timeout: 15_000});
        const form = page.locator('form.ac-catalog-filter-panel:visible');
        await form.waitFor({state: 'visible', timeout: 5000});
        const marker = form.locator('button[aria-label="Расширенные фильтры"]');
        need(state.scriptHeld && await marker.isDisabled() && await marker.getAttribute('aria-busy') === 'true'
          && !await marker.isVisible(), 'ssr_not_hydrated');
        const brand = form.locator('button[aria-label="Выбрать марки автомобилей"]');
        await brand.click({timeout: 5000});
        need(await brand.getAttribute('aria-expanded') === 'false' && await form.locator('.ac-filter-dropdown').count() === 0
          && state.brandRequests === 0 && page.url() === INITIAL_URL, 'early_click_lost');
        let settled = false;
        const selection = selectJapanStabilityModelThroughUi({view: page, directory: checkedJapanStabilityDirectory(MODELS, 200), progress})
          .then(value => { settled = true; return {value}; }, error => { settled = true; return {error}; });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        need(!settled && progress.phase === 'initial_controls_ready' && (progress.readyChecks ?? 0) === 0
          && await marker.isDisabled() && state.brandRequests === 0, 'helper_waits_for_hydration');
        releaseScript();
        const outcome = await selection; if (outcome.error) throw outcome.error;
        need(outcome.value.sourceMake === 'MAZDA' && outcome.value.selected.model === 'MAZDA3 FASTBACK', 'source_selection');
        need(progress.readyChecks === 3 && progress.brandExpanded === true && progress.brandUrlMatched === true
          && progress.modelUrlMatched === true && progress.selectedValueMatched === true && progress.phase === 'selection_complete', 'completed_real_journey');
        need(progress.modelPopupClose === (remount ? 'already_closed_after_navigation' : 'clicked_close'), 'popup_lifecycle');
        need(await form.locator('input[name="make"]').inputValue() === 'MAZDA'
          && await form.locator('input[name="model"]').inputValue() === 'MAZDA3 FASTBACK'
          && await form.locator('input[aria-label="Модель автомобиля"]:visible').inputValue() === 'MAZDA3 FASTBACK'
          && new URL(page.url()).searchParams.get('city') === CITY, 'final_form_identity');
        need(pageErrors.length === 0 && (await page.evaluate(() => window.__japanCityFixture.errors.length)) === 0
          && report.forbiddenTransportAttempts === 0 && state.brandRequests >= 1 && state.brandRequests <= 4
          && state.modelRequests >= 1 && state.modelRequests <= 4, 'bounded_clean_journey');
        report.cases.push({name: activeCase, passed: true, width: 1440, actualRuntimeComponents: true,
          domContentLoadedBeforeHydration: true, earlyBrandClickLost: true, hiddenReadinessMarker: true,
          helperWaitedForInteractiveEffect: true, exactSourceModelAndCity: true,
          brandRequests: state.brandRequests, modelRequests: state.modelRequests, progress: {...progress}});
      } finally { releaseScript(); await context.close(); active = null; }
    }
    delete report.activeProgress; report.passed = report.cases.length === 2;
  } catch (error) {
    report.error = {case: activeCase,
      code: /^japan_(?:controls_fixture|browser_stability)_[a-z_]+$/.test(error?.message || '') ? error.message : japanNavigationErrorCode(error)};
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (fixture) await fs.rm(fixture.temporary, {recursive: true, force: true});
    report.caseCount = report.cases.length;
    if (process.env.JAPAN_MODEL_CONTROLS_READY_REPORT) {
      const destination = path.resolve(process.env.JAPAN_MODEL_CONTROLS_READY_REPORT);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    }
    console.log('JAPAN_MODEL_CONTROLS_READY_BROWSER', JSON.stringify(report));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
