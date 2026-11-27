import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareJapanModelControlsFixture} from './japan-model-controls-ready.mjs';
import {checkJapanStabilityBrandControl, waitForJapanStabilityControls}
  from '../../scripts/catalog-next/japan-stability-browser.mjs';
import {japanNavigationErrorCode} from '../../scripts/catalog-next/japan-browser-acceptance.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const INITIAL = {market: 'japan', city: CITY, powerTo: '160', fuel: 'petrol'};
const QUERY = new URLSearchParams({city: CITY, powerTo: '160', fuel: 'petrol'}).toString();
const INITIAL_URL = ORIGIN + '/cars/japan?' + QUERY;
const COUNTS = {MAZDA: 12, TOYOTA: 24, BENZ: 1, 'MERCEDES BENZ': 1};
const SOURCE_MAKES = Object.keys(COUNTS), FALLBACK = 'NISSAN';
const VISIBLE_ROWS = [{id: 'ajes-stats-N1', market: 'japan', make: FALLBACK}];
const RETRY = 'Не удалось загрузить марки. Повторить';
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('japan_directory_retry_fixture_' + code); };
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const EXTRA_SOURCE_FILES = ['apps/web/components/catalog/BrandLogoRail.tsx',
  'apps/web/lib/catalog/brands.ts', 'apps/web/lib/catalog/brand-navigation.ts'];
const SCENARIOS = [
  {name: 'mobile_empty_directory_recovers_once', width: 390, first: 'empty', rail: false, recover: true},
  {name: 'desktop_dropdown_and_ssr_rail_recover_with_controls_remount', width: 1440,
    first: 'error', rail: true, recover: true},
  {name: 'persistent_empty_directory_refused_after_one_retry', width: 1440,
    first: 'empty', rail: false, recover: false},
];

/** Reuse the exact-runtime SSR fixture, adding only local server-prop delivery
 * for Next router.refresh. The real BrandLogoRail and CatalogFilters own their
 * states, Retry buttons and caches. A refresh remounts the controls, as a server
 * page boundary can; no production component or metadata loader is mocked. */
export async function prepareJapanBrandDirectoryRetryFixture(runtimeRoot, plan) {
  return prepareJapanModelControlsFixture(runtimeRoot, plan, {
    extraSourceFiles: EXTRA_SOURCE_FILES,
    extraCss: '.ac-ajes-catalog{padding:10px}.ac-catalog-sidebar{max-width:100%}.ac-catalog-filter-panel{max-width:100%}.ac-catalog-card{display:block;min-height:100px;margin-top:24px}'
      + '@media(max-width:1023px){.ac-catalog-filter-panel{display:none!important}.ac-filter-more-button{display:flex!important}.ac-mobile-filter-sheet{background:white}}',
    transformFixture(original) {
      let fixture = original;
      const once = (before, after) => {
        need(fixture.split(before).length === 2, 'runtime_fixture_contract'); fixture = fixture.replace(before, after);
      };
      once("import {catalogRouteParams} from '../../apps/web/lib/catalog/catalog-routes';",
        "import {catalogRouteParams} from '../../apps/web/lib/catalog/catalog-routes';\nimport {BrandLogoRail} from '../../apps/web/components/catalog/BrandLogoRail';");
      once('const [initial,setInitial]=useState(serverInitial);',
        `const [initial,setInitial]=useState(Object.fromEntries(Object.entries(serverInitial).filter(([key])=>!key.startsWith('__fixture'))));
 const [railState,setRailState]=useState<'ready'|'unavailable'>(serverInitial.__fixtureRailReady==='1'?'ready':'unavailable');
 const [railBrands,setRailBrands]=useState(serverInitial.__fixtureRailReady==='1'?${JSON.stringify([...SOURCE_MAKES, FALLBACK])}:${JSON.stringify([FALLBACK])});
 const [controlsVersion,setControlsVersion]=useState(0);
 useEffect(()=>{
  (window as any).__japanCityFixture.refresh=async()=>{
   const response=await fetch('/fixture-rail?'+${JSON.stringify(QUERY)},{cache:'no-store'});
   if(!response.ok)throw new Error('fixture_rail_transport');
   const next=await response.json();
   setRailBrands(next.brands);setRailState(next.state);setControlsVersion(value=>value+1);
  };
 },[]);`);
      once('<CatalogSelectionProvider><CatalogFilters key={routeKey} initial={initial}',
        '<CatalogSelectionProvider><BrandLogoRail initial={initial} brands={railBrands} sourceDirectoryState={railState}/><div className="ac-catalog-sidebar"><CatalogFilters key={routeKey+":"+controlsVersion} initial={initial}');
      once('facets={{makes:[],models:[],', 'facets={{makes:["NISSAN"],models:[],');
      once('resultCount={24}/></CatalogSelectionProvider>',
        'resultCount={24}/></div><article className="ac-catalog-card"><a href={"/cars/ajes-stats-N1?city="+encodeURIComponent(initial.city)}>NISSAN</a></article></CatalogSelectionProvider>');
      return fixture;
    },
  });
}

async function main() {
  const report = {version: 1, kind: 'japan-brand-directory-retry-browser-v1', passed: false,
    scope: 'Verified runtime controls and rail with actual controller retry helper; local metadata and router.refresh server-prop adapter',
    runtimeSha: null, runtimeTree: null, playwrightVersion: null, browserVersion: null,
    productionRequests: 0, supplierRequests: 0, forbiddenTransportAttempts: 0, cases: []};
  let fixture, browser, server, active, activeCase = 'setup';
  try {
    need(process.argv.length === 2, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(ROOT, '.github/operations/catalog-next/china-code-serving-plan.json'), 'utf8'));
    fixture = await prepareJapanBrandDirectoryRetryFixture(process.env.PHOTO_RUNTIME_ROOT, plan);
    Object.assign(report, {runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree, componentSha256: fixture.sources,
      controllerHelperSha256: hash(await fs.readFile(path.join(ROOT, 'scripts/catalog-next/japan-stability-browser.mjs')))});
    need(path.isAbsolute(process.env.PLAYWRIGHT_MODULE || '') && path.isAbsolute(process.env.CHROME_BIN || ''), 'browser_environment');
    const pkg = JSON.parse(await fs.readFile(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'package.json'), 'utf8'));
    need(pkg.version === '1.55.0', 'playwright_version'); report.playwrightVersion = pkg.version;
    server = http.createServer(async (request, response) => {
      try {
        need(active && request.method === 'GET', 'server_scope');
        const url = new URL(request.url, ORIGIN);
        if (url.pathname === '/fixture.js') { response.writeHead(200, {'Content-Type': 'application/javascript'}); response.end(fixture.javascript); return; }
        if (url.pathname === '/fixture.css') { response.writeHead(200, {'Content-Type': 'text/css'}); response.end(fixture.css); return; }
        if (/^\/brand-logos\/local\/(light|dark)\/(mazda|nissan|toyota|mercedes-benz)\.png$/.test(url.pathname)) {
          response.writeHead(200, {'Content-Type': 'image/png'});
          response.end(await fs.readFile(path.join(process.env.PHOTO_RUNTIME_ROOT, 'apps/web/public', url.pathname))); return;
        }
        if (url.pathname === '/api/catalog/brand-counts') {
          need(url.search === '?market=japan', 'metadata_scope');
          const attempt = ++active.metadataRequests;
          need(attempt <= 2, 'metadata_read_bound');
          response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
          if (attempt === 1 && active.scenario.first === 'error') {
            response.statusCode = 503; response.end(JSON.stringify({error: 'fixture_metadata_unavailable'})); return;
          }
          response.end(JSON.stringify({generationId: new Date().toISOString(), stale: false,
            counts: attempt === 2 && active.scenario.recover ? COUNTS : {}, modelCounts: {}})); return;
        }
        if (url.pathname === '/fixture-rail') {
          need(active.scenario.rail && active.scenario.recover && url.search.slice(1) === QUERY
            && ++active.railRequests === 1, 'rail_refresh_bound');
          response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
          response.end(JSON.stringify({state: 'ready', brands: [...SOURCE_MAKES, FALLBACK]})); return;
        }
        need(url.href === INITIAL_URL, 'document_scope');
        const initial = {...INITIAL, __fixtureRailReady: active.scenario.rail ? '0' : '1'};
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><main class="ac-ajes-catalog" id="root">'
          + fixture.renderMarkup(initial) + '</main><script>window.__japanCityInitial=' + JSON.stringify(initial)
          + '</script><script defer src="/fixture.js"></script></body></html>');
      } catch { report.forbiddenTransportAttempts++; response.writeHead(400); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const loopback = 'http://127.0.0.1:' + server.address().port;
    const {chromium} = await import(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-background-networking']});
    const version = browser.version(); report.browserVersion = /^\d+(?:\.\d+){1,4}$/.test(version) ? version : null;
    for (const scenario of SCENARIOS) {
      activeCase = scenario.name;
      const state = active = {scenario, metadataRequests: 0, railRequests: 0, fallbackObservations: 0};
      const context = await browser.newContext({viewport: {width: scenario.width, height: 1000}, locale: 'ru-RU', serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [], progress = {};
      report.activeProgress = progress;
      page.on('pageerror', error => errors.push(japanNavigationErrorCode(error)));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const allowed = url.origin === ORIGIN && request.method() === 'GET' && (url.href === INITIAL_URL
          || ['/fixture.js', '/fixture.css', '/api/catalog/brand-counts', '/fixture-rail'].includes(url.pathname)
          || /^\/brand-logos\/local\/(light|dark)\/(mazda|nissan|toyota|mercedes-benz)\.png$/.test(url.pathname));
        if (!allowed) { report.forbiddenTransportAttempts++; await route.abort('blockedbyclient'); return; }
        let response;
        try {
          response = await route.fetch({url: loopback + url.pathname + url.search, maxRedirects: 0, timeout: 15_000});
          need([200, 503].includes(response.status()), 'loopback_response'); await route.fulfill({response});
        } catch { await route.abort('failed').catch(() => {}); }
        finally { if (response) await response.dispose().catch(() => {}); }
      });
      try {
        await page.goto(INITIAL_URL, {waitUntil: 'domcontentloaded', timeout: 15_000});
        const mobile = scenario.width < 1024;
        let controls;
        if (mobile) {
          const open = page.locator('button.ac-filter-more-button:enabled[aria-busy="false"]:visible');
          await open.waitFor({state: 'visible', timeout: 5000});
          need(!await page.locator('form.ac-catalog-filter-panel').isVisible(), 'mobile_desktop_form_hidden');
          await open.click();
          controls = page.getByRole('dialog', {name: 'Фильтры каталога', exact: true});
          await page.locator('form[role="dialog"][aria-label="Фильтры каталога"][aria-busy="false"]')
            .waitFor({state: 'visible', timeout: 5000});
          need(await controls.evaluate(form => form.tagName === 'FORM'), 'actual_mobile_dialog');
        } else controls = await waitForJapanStabilityControls(page);
        const before = await controls.evaluate(form => JSON.stringify([...new FormData(form)].sort()));
        await controls.evaluate(form => { window.__fixtureOriginalControls = form; });
        const rail = scenario.rail ? page.locator('main.ac-ajes-catalog section.ac-brand-rail') : undefined;
        if (rail) {
          need(await rail.getAttribute('data-japan-source-directory-state') === 'unavailable'
            && await rail.getByRole('button', {name: RETRY, exact: true}).isVisible(), 'initial_rail_unavailable');
        }
        let outcome, rejected;
        try {
          outcome = await checkJapanStabilityBrandControl({view: page, controls, rail, visibleRows: VISIBLE_ROWS, progress,
            onResponse: async ({data, status}) => {
              const dropdown = controls.locator('.ac-filter-dropdown[data-japan-source-directory-state]');
              if (status !== 200 || Object.keys(data?.counts || {}).length === 0) {
                await controls.locator('.ac-filter-dropdown[data-japan-source-directory-state="unavailable"]')
                  .waitFor({state: 'visible', timeout: 5000});
                need(same(await dropdown.locator('button[data-facet-value]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-facet-value'))), [FALLBACK])
                  && await dropdown.getByRole('button', {name: RETRY, exact: true}).isVisible()
                  && await dropdown.getByText('Марка не найдена', {exact: true}).count() === 0, 'honest_source_fallback');
                state.fallbackObservations++;
              }
            }});
        } catch (error) { rejected = error; }
        if (scenario.recover) {
          if (rejected) throw rejected;
          need(outcome.proof.completeSourceCovered === true && outcome.proof.fallbackOnly === false
            && outcome.proof.selectionUnchanged === true && outcome.proof.metadataRequests === 2
            && outcome.proof.dropdownRetryUsed === true && outcome.proof.railRetryUsed === scenario.rail
            && same(outcome.directory.makes, SOURCE_MAKES), 'strict_recovered_directory');
          if (rail) {
            need(outcome.proof.sourceLinksMatched === true && outcome.proof.filterContextPreserved === true
              && outcome.proof.railMakes === 4 && outcome.proof.visibleFallbackMakes === 1
              && outcome.proof.aboveCars === true && await page.evaluate(() => !window.__fixtureOriginalControls.isConnected), 'independent_rail_and_remount');
            // This extra opening belongs only to the local cache regression.
            // The production helper must finish after the rail refresh without
            // opening again or waiting for a third metadata response.
            const remounted = await waitForJapanStabilityControls(page);
            const trigger = remounted.locator('button[aria-label="Выбрать марки автомобилей"]:visible');
            await trigger.click();
            const warm = remounted.locator('.ac-filter-dropdown[data-japan-source-directory-state="ready"]');
            await warm.waitFor({state: 'visible', timeout: 5000});
            need(same(await warm.locator('button[data-facet-value]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-facet-value'))), SOURCE_MAKES)
              && state.metadataRequests === 2, 'remount_reuses_successful_cache');
            await trigger.click();
          }
        } else {
          need(rejected && /^japan_browser_stability_brand_directory_(?:rows|empty|unavailable)$/.test(rejected.message || '')
            && outcome === undefined, 'persistent_fallback_refused');
        }
        need(progress.attempts.length === 2 && progress.dropdownRetries === 1
          && progress.railRetries === Number(scenario.rail)
          && progress.dropdownFallback?.sourceFallbackVerified === true
          && progress.dropdownFallback.completeSourceCovered === false
          && progress.dropdownFallback.fallbackOnly === true
          && progress.attempts[0].validation !== 'fresh_complete'
          && (progress.attempts[1].validation === 'fresh_complete') === scenario.recover,
        'fallback_never_certifies_completeness');
        if (scenario.rail) need(progress.railFallback?.sourceFallbackVerified === true
          && progress.railFallback.completeSourceCovered === false && progress.railFallback.fallbackOnly === true,
        'rail_fallback_never_certifies_completeness');
        const afterControls = mobile ? controls : await waitForJapanStabilityControls(page);
        if (mobile) await page.locator('form[role="dialog"][aria-label="Фильтры каталога"][aria-busy="false"]')
          .waitFor({state: 'visible', timeout: 5000});
        need(page.url() === INITIAL_URL && before === await afterControls.evaluate(form => JSON.stringify([...new FormData(form)].sort())), 'selection_and_city_unchanged');
        need(state.metadataRequests === 2 && state.railRequests === Number(scenario.rail)
          && state.fallbackObservations === (scenario.recover ? 1 : 2)
          && errors.length === 0 && await page.evaluate(() => window.__japanCityFixture.errors.length) === 0
          && report.forbiddenTransportAttempts === 0, 'bounded_clean_journey');
        if (mobile) {
          await controls.getByRole('button', {name: 'Свернуть фильтры', exact: true}).click();
          await controls.waitFor({state: 'hidden', timeout: 5000});
          need(page.url() === INITIAL_URL, 'mobile_close_preserves_selection');
        }
        report.cases.push({name: scenario.name, passed: true, width: scenario.width,
          actualRuntimeComponents: true, actualMobileDialog: mobile,
          honestFallbackObserved: true, fallbackAcceptedAsComplete: false,
          recoveredCompleteSource: scenario.recover, persistentFallbackRefused: !scenario.recover,
          exactRecoveredSourceNames: scenario.recover, verifiedFallbackAndCity: true, selectionUnchanged: true,
          metadataRequests: state.metadataRequests, railRefreshRequests: state.railRequests,
          controlsRemounted: scenario.rail, cachedSuccessReusedAfterRemount: scenario.rail,
          fallbackObservations: state.fallbackObservations,
          ...(outcome ? {proof: outcome.proof} : {refusalCode: rejected.message}), progress});
      } finally { await context.close(); active = null; }
    }
    delete report.activeProgress; report.passed = report.cases.length === SCENARIOS.length;
  } catch (error) {
    report.error = {case: activeCase,
      code: /^japan_(?:directory_retry_fixture|browser_stability)_[a-z_]+$/.test(error?.message || '') ? error.message : japanNavigationErrorCode(error)};
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (fixture) await fs.rm(fixture.temporary, {recursive: true, force: true});
    report.caseCount = report.cases.length;
    if (process.env.JAPAN_BRAND_DIRECTORY_RETRY_REPORT) {
      const destination = path.resolve(process.env.JAPAN_BRAND_DIRECTORY_RETRY_REPORT);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    }
    console.log('JAPAN_BRAND_DIRECTORY_RETRY_BROWSER', JSON.stringify(report));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
