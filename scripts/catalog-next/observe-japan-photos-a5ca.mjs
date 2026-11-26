import {setTimeout as delay} from 'node:timers/promises';

// One ordinary anonymous visit. Health/runtime binding is checked separately by the caller.
const TARGET = 'https://avtocena.com/cars/japan?powerTo=160&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA';
const ORIGIN = 'https://avtocena.com', DEADLINE_MS = 180_000, MAX_CARDS = 24;
const ROOT = 'main.ac-ajes-catalog', BATCH = ROOT + ' [data-catalog-batch="1"]';
const CARD = BATCH + ' > article.ac-catalog-card';
const started = Date.now();
const report = {
  version: 1, kind: 'japan-public-photo-observation-v1', observationCompleted: false,
  expectedRuntimeSha: 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740', runtimeCheckedHere: false,
  page: '/cars/japan', powerTo: 160, city: 'Новокузнецк', width: 390,
  startedAt: new Date(started).toISOString(), initial: null, final: null, scrolledCards: 0,
  allCardImagesLoaded: null, globalCountVerified: false, freshnessVerified: false,
  network: {allowedRequests: 0, firstPageSearchGets: 0, firstPageCountGets: 0,
    blockedWrites: 0, blockedPrefetch: 0, blockedOtherPages: 0, blockedOwnerRoutes: 0,
    blockedExternalNonAssets: 0, blockedWebSockets: 0, routeErrors: 0},
};
class ObservationError extends Error {}
const need = (value, code) => { if (!value) throw new ObservationError(code); };
let browser, context, page, phase = 'launch', watchdog;
const counters = report.network;

function samePage(url) {
  return url.origin === ORIGIN && url.pathname === '/cars/japan'
    && url.searchParams.get('powerTo') === '160' && url.searchParams.get('city') === 'Новокузнецк'
    && (!url.searchParams.has('page') || url.searchParams.get('page') === '1');
}

async function snapshot() {
  return page.evaluate(({root, batch, card}) => {
    const cards = [...document.querySelectorAll(card)];
    const result = {cards: cards.length, loaded: 0, pending: 0, failedOrAwaitingRetry: 0,
      temporaryPlaceholders: 0, missingSourcePlaceholders: 0, unrecognized: 0,
      lazyImages: 0, retryMarkedImages: 0, naturalWidthMin: null, naturalWidthMax: null,
      naturalHeightMin: null, naturalHeightMax: null, otherBatches: 0,
      marketCounterText: null, marketCounterAttribute: null, shownCounterText: null};
    const widths = [], heights = [];
    for (const item of cards) {
      const media = item.querySelector(':scope > a > div:first-child');
      const image = media?.querySelector(':scope > img');
      const placeholder = media?.querySelector(':scope > div[role="img"][aria-label$=". Фото временно недоступно"]');
      if (image) {
        if (image.loading === 'lazy') result.lazyImages++;
        if (image.hasAttribute('data-photo-retried')) result.retryMarkedImages++;
        if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
          result.loaded++; widths.push(image.naturalWidth); heights.push(image.naturalHeight);
        } else if (!image.complete) result.pending++;
        else result.failedOrAwaitingRetry++;
      } else if (placeholder) result.temporaryPlaceholders++;
      else if (media?.firstElementChild?.textContent?.trim() === 'Фото загружается') result.missingSourcePlaceholders++;
      else result.unrecognized++;
    }
    if (widths.length) {
      result.naturalWidthMin = Math.min(...widths); result.naturalWidthMax = Math.max(...widths);
      result.naturalHeightMin = Math.min(...heights); result.naturalHeightMax = Math.max(...heights);
    }
    result.otherBatches = [...document.querySelectorAll(root + ' [data-catalog-batch]')]
      .filter(item => item.getAttribute('data-catalog-batch') !== '1').length;
    const text = node => node ? (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
    const market = document.querySelector(root + ' .ac-market-result-count');
    result.marketCounterText = text(market);
    const attribute = market?.getAttribute('data-catalog-market-count');
    result.marketCounterAttribute = attribute && /^\d{1,15}$/.test(attribute) ? Number(attribute) : null;
    result.shownCounterText = text(document.querySelector(batch + ' + div > p[role="status"]'));
    return result;
  }, {root: ROOT, batch: BATCH, card: CARD});
}

async function observe() {
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({headless: true, timeout: 20_000,
    executablePath: process.env.CHROME_BIN || undefined,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync']});
  context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1,
    locale: 'ru-RU', serviceWorkers: 'block', acceptDownloads: false});
  await context.routeWebSocket('**/*', socket => { counters.blockedWebSockets++; socket.close(); });
  await context.route('**/*', async route => {
    try {
      const request = route.request(), url = new URL(request.url()), headers = request.headers();
      let blocked;
      if (!['GET', 'HEAD'].includes(request.method())) blocked = 'blockedWrites';
      else if (/prefetch/i.test((headers.purpose || '') + ' ' + (headers['sec-purpose'] || ''))
        || headers['next-router-prefetch'] === '1' || headers['x-middleware-prefetch'] === '1') blocked = 'blockedPrefetch';
      else if (url.origin === ORIGIN && /^\/(?:crm|api\/crm|login|logout)(?:\/|$)/.test(url.pathname)) blocked = 'blockedOwnerRoutes';
      else if (request.isNavigationRequest() && !samePage(url)) blocked = 'blockedOtherPages';
      else if (url.origin === ORIGIN && url.pathname.startsWith('/cars') && !samePage(url)) blocked = 'blockedOtherPages';
      else if (url.origin === ORIGIN && /^\/api\/catalog\/offer(?:\/|$)/.test(url.pathname)) blocked = 'blockedOtherPages';
      else if (url.origin === ORIGIN && url.pathname === '/api/catalog/search'
        && url.searchParams.has('page') && url.searchParams.get('page') !== '1') blocked = 'blockedOtherPages';
      else if (url.origin !== ORIGIN && !['image', 'font', 'stylesheet', 'script', 'media'].includes(request.resourceType()))
        blocked = 'blockedExternalNonAssets';
      if (blocked) { counters[blocked]++; await route.abort('blockedbyclient'); return; }
      // Preserve ordinary first-party GETs, including countOnly, initiated by the current page.
      if (url.origin === ORIGIN && url.pathname === '/api/catalog/search' && request.method() === 'GET') {
        counters.firstPageSearchGets++;
        if (url.searchParams.has('countOnly')) counters.firstPageCountGets++;
      }
      counters.allowedRequests++;
      await route.continue();
    } catch { counters.routeErrors++; try { await route.abort('blockedbyclient'); } catch {} }
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  phase = 'navigation';
  const response = await page.goto(TARGET, {waitUntil: 'domcontentloaded', timeout: 60_000});
  need(response?.status() === 200 && samePage(new URL(page.url())), 'page_response');
  phase = 'catalog';
  await page.locator(CARD).first().waitFor({state: 'attached', timeout: 25_000});
  await delay(500);
  report.initial = await snapshot();
  need(report.initial.cards > 0 && report.initial.cards <= MAX_CARDS
    && report.initial.otherBatches === 0 && report.initial.unrecognized === 0, 'first_batch_shape');
  phase = 'scroll';
  for (let index = 0; index < report.initial.cards; index++) {
    await page.locator(CARD).nth(index).scrollIntoViewIfNeeded();
    report.scrolledCards++;
    await delay(350);
  }
  phase = 'settle';
  // Actual application timers run normally: retries after 15-18 s, then another 35-38 s.
  const settleUntil = Math.min(Date.now() + 70_000, started + DEADLINE_MS - 5_000);
  do {
    report.final = await snapshot();
    const unsettled = report.final.pending + report.final.failedOrAwaitingRetry;
    if (!unsettled || Date.now() >= settleUntil) break;
    await delay(1000);
  } while (true);
  need(samePage(new URL(page.url())) && report.final.cards === report.initial.cards
    && report.final.otherBatches === 0 && report.final.unrecognized === 0, 'observation_shape_changed');
  need(counters.routeErrors === 0, 'request_fence_error');
  report.allCardImagesLoaded = report.final.loaded === report.final.cards;
  report.observationCompleted = true;
  phase = 'complete';
}

try {
  await Promise.race([observe(), new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new ObservationError('deadline')), DEADLINE_MS);
  })]);
} catch (error) {
  report.errorCode = error instanceof ObservationError ? error.message : 'browser_observation_failed';
  report.failurePhase = phase;
} finally {
  clearTimeout(watchdog);
  let closeTimer;
  try {
    await Promise.race([browser?.close(), new Promise(resolve => { closeTimer = setTimeout(resolve, 5000); })]);
  } catch {} finally { clearTimeout(closeTimer); }
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  // Only public aggregate observations: no image URLs, cookies, bodies, console messages or traces.
  const output = JSON.stringify(report);
  process.stdout.write(output + '\n', () => process.exit(report.observationCompleted ? 0 : 1));
}
