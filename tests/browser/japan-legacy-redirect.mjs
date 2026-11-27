import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {installReadFence, japanNavigationErrorCode} from '../../scripts/catalog-next/japan-browser-acceptance.mjs';
import {JAPAN_LEGACY_MAZDA_THREE_PAGES} from '../../scripts/catalog-next/japan-stability-browser.mjs';

// Exercise the actual release fence and Chromium navigation lifecycle. Only
// route.fetch's transport is redirected to this loopback server; the fence
// still sees the original browser request, page, frame, URL and 308 Location.
const ORIGIN = 'https://avtocena.com';
const CITY = 'Новокузнецк';
const PRIVATE = ORIGIN + '/api/crm/japan-fixture-denied';
const EXTERNAL = 'https://japan-fixture-denied.invalid/';
const need = (value, code) => { if (!value) throw Error('japan_legacy_fixture_' + code); };
const scenarios = [
  {name: 'canonical_static', mode: 'static'},
  {name: 'canonical_chunked', mode: 'chunked'},
  {name: 'literal_wrong_target', mode: 'literal_private', denied: true},
  {name: 'literal_wrong_status', mode: 'literal_temporary', denied: true},
  {name: 'canonical_private_redirect', mode: 'canonical_private', denied: true},
  {name: 'canonical_redirect_loop', mode: 'canonical_loop', denied: true},
  {name: 'direct_private_navigation', mode: 'private', denied: true},
  {name: 'direct_external_navigation', mode: 'external', denied: true},
];
const report = {version: 1, kind: 'japan-legacy-redirect-browser-v1', passed: false,
  scope: 'Actual release read fence and Chromium navigation with loopback-only HTTP transport',
  playwrightVersion: null, browserVersion: null, productionRequests: 0,
  loopbackRequests: 0, forbiddenTransportAttempts: 0, requiredCases: scenarios.length, cases: []};
let active, browser, activeCase = 'setup';
const beginHtml = '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
  + '<link rel="icon" href="data:,"><title>Japan navigation fixture</title></head><body>'
  + '<main><h1>Mazda 3</h1><span data-model></span><span data-city></span>';
const endHtml = '</main><script>document.querySelector("[data-model]").textContent='
  + 'decodeURIComponent(location.pathname.split("/").at(-1));'
  + 'document.querySelector("[data-city]").textContent=new URLSearchParams(location.search).get("city")||"";'
  + 'document.documentElement.dataset.complete="yes";</script></body></html>';
const server = http.createServer((request, response) => {
  report.loopbackRequests++;
  const state = active;
  if (!state || request.method !== 'GET') { response.writeHead(400); response.end(); return; }
  const url = new URL(request.url, ORIGIN).href;
  const redirect = (status, location) => { response.writeHead(status, {Location: location, 'Cache-Control': 'no-store'}); response.end(); };
  if (url === JAPAN_LEGACY_MAZDA_THREE_PAGES.literal) {
    state.literalRequests++;
    redirect(state.mode === 'literal_temporary' ? 307 : 308,
      state.mode === 'literal_private' ? PRIVATE : JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical);
    return;
  }
  if (url !== JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical) {
    state.otherRequests++; response.writeHead(400); response.end(); return;
  }
  state.canonicalRequests++;
  if (state.mode === 'canonical_private') { redirect(302, PRIVATE); return; }
  if (state.mode === 'canonical_loop') { redirect(308, JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical); return; }
  const headers = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; img-src data:"};
  if (state.mode === 'chunked') {
    response.writeHead(200, headers);
    response.write(beginHtml);
    const timer = setTimeout(() => response.end(endHtml), 25);
    response.once('close', () => clearTimeout(timer));
  } else {
    const body = beginHtml + endHtml;
    response.writeHead(200, {...headers, 'Content-Length': Buffer.byteLength(body)}); response.end(body);
  }
});

async function scenario(definition, origin) {
  const state = {...definition, literalRequests: 0, canonicalRequests: 0, otherRequests: 0,
    literalPage: null, canonicalOnCaller: false, probeClosedBeforeCanonical: false, chunkedTransport: false};
  active = state;
  const context = await browser.newContext({serviceWorkers: 'block', locale: 'ru-RU'});
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(japanNavigationErrorCode(error)));
  const nativeRoute = context.route.bind(context);
  context.route = (pattern, handler) => nativeRoute(pattern, route => handler(new Proxy(route, {
    get(target, key) {
      if (key === 'fetch') return async options => {
        const request = target.request(), url = request.url();
        if (!Object.values(JAPAN_LEGACY_MAZDA_THREE_PAGES).includes(url)
          || request.method() !== 'GET' || options?.maxRedirects !== 0) {
          report.forbiddenTransportAttempts++; throw Error('japan_legacy_fixture_transport_scope');
        }
        if (url === JAPAN_LEGACY_MAZDA_THREE_PAGES.literal) {
          state.literalPage = request.frame().page();
          need(state.literalPage !== page && page.url() === 'about:blank', 'separate_probe');
        } else {
          state.canonicalOnCaller = request.frame().page() === page && request.frame() === page.mainFrame();
          state.probeClosedBeforeCanonical = state.literalPage?.isClosed() === true;
          need(state.canonicalOnCaller && state.probeClosedBeforeCanonical, 'probe_close_barrier');
        }
        const source = new URL(url), local = new URL(source.pathname + source.search, origin);
        need(local.origin === origin && local.hostname === '127.0.0.1', 'loopback_transport');
        const response = await target.fetch({...options, url: local.href});
        if (url === JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical)
          state.chunkedTransport = response.headers()['transfer-encoding'] === 'chunked';
        return response;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  })));
  const evidence = {codeScope: 'catalog-japan-stability-v1', checks: {}};
  try {
    const fence = await installReadFence(context, evidence, {isLegacyMazdaThreeStage: () => true});
    let failure, result;
    try {
      result = ['private', 'external'].includes(state.mode)
        ? await page.goto(state.mode === 'private' ? PRIVATE : EXTERNAL, {waitUntil: 'domcontentloaded', timeout: 10_000})
        : await fence.navigateLegacyMazdaThree(page);
    } catch (error) { failure = error; }
    need(report.forbiddenTransportAttempts === 0 && state.otherRequests === 0, 'transport_boundary');
    need(evidence.readOnlyBrowserFence === true && context.pages().length === 1, 'fence_and_probe_cleanup');
    if (!state.denied) {
      if (failure) throw failure;
      need(result.response?.status() === 200 && page.url() === JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical, 'canonical_response');
      need(state.literalRequests === 1 && state.canonicalRequests === 1, 'bounded_navigation');
      need(state.canonicalOnCaller && state.probeClosedBeforeCanonical, 'completed_probe_barrier');
      need(result.redirectProof?.status === 308 && result.redirectProof?.redirects === 1
        && result.redirectProof?.exactTarget === true && result.redirectProof?.mainFrame === true
        && result.redirectProof?.sameOrigin === true, 'literal_redirect_proof');
      await page.locator('html[data-complete="yes"]').waitFor({state: 'attached', timeout: 5000});
      need(await page.locator('h1').textContent() === 'Mazda 3'
        && await page.locator('[data-model]').textContent() === '3'
        && await page.locator('[data-city]').textContent() === CITY, 'model_city_render');
      need(errors.length === 0 && Object.values(evidence.blockedRequests).every(value => value === 0), 'clean_canonical_document');
      need(state.chunkedTransport === (state.mode === 'chunked'), 'canonical_response_framing');
      return {name: state.name, passed: true, literalRequests: 1, canonicalRequests: 1,
        actualLiteral308: true, callerPageUntouchedUntilCanonical: true, probeClosedBeforeCanonical: true,
        canonicalHttp200: true, exactModelAndCity: true, chunkedTransport: state.chunkedTransport};
    }
    need(failure && japanNavigationErrorCode(failure) === 'ERR_BLOCKED_BY_CLIENT', 'denied_navigation');
    const direct = ['private', 'external'].includes(state.mode);
    const counter = direct ? state.mode : 'redirect';
    need(evidence.blockedRequests[counter] === 1, 'denial_counter');
    need(state.literalRequests === (direct ? 0 : 1), 'denied_literal_count');
    need(state.canonicalRequests === (state.mode.startsWith('canonical_') ? 1 : 0), 'no_redirect_follow');
    return {name: state.name, passed: true, blockedByClient: true, blockedScope: counter,
      literalRequests: state.literalRequests, canonicalRequests: state.canonicalRequests,
      forbiddenTargetRequests: 0};
  } finally { await context.close(); active = null; }
}

try {
  need(path.isAbsolute(process.env.PLAYWRIGHT_MODULE || '') && path.isAbsolute(process.env.CHROME_BIN || ''), 'browser_environment');
  const pkg = JSON.parse(await fs.readFile(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'package.json'), 'utf8'));
  need(pkg.version === '1.55.0', 'playwright_version'); report.playwrightVersion = pkg.version;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE);
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN,
    args: ['--no-sandbox', '--disable-background-networking']});
  const version = browser.version(); report.browserVersion = /^\d+(?:\.\d+){1,4}$/.test(version) ? version : null;
  for (const definition of scenarios) {
    activeCase = definition.name; report.cases.push(await scenario(definition, origin));
  }
  need(report.cases.length === scenarios.length && report.forbiddenTransportAttempts === 0, 'complete_cases');
  report.passed = true;
} catch (error) {
  report.error = {case: activeCase,
    code: /^japan_legacy_fixture_[a-z_]+$/.test(error?.message || '') ? error.message : japanNavigationErrorCode(error)};
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.caseCount = report.cases.length;
  if (process.env.JAPAN_LEGACY_REDIRECT_REPORT) {
    const destination = path.resolve(process.env.JAPAN_LEGACY_REDIRECT_REPORT);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  console.log('JAPAN_LEGACY_REDIRECT_BROWSER', JSON.stringify(report));
}
