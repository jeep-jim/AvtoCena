import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ORIGIN = 'https://avtocena.com';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('china_browser_' + code); };
const rounded = value => Number(Number(value).toFixed(2));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function browserOracleCases(oracle, releaseSha, precedingSpeedReport) {
  need(/^[a-f0-9]{40}$/.test(releaseSha || '') && oracle?.version === 1 && oracle.runtimeSha === releaseSha &&
    /^[a-f0-9]{40}$/.test(oracle.pricingRuntimeSha || '') &&
    /^[a-f0-9]{64}$/.test(oracle.generationManifestSha256 || '') && typeof oracle.expectedGeneration === 'string', 'oracle_binding');
  // Check before Chromium starts or any network request. These additional
  // functional visits must not warm the unchanged timed browser gate.
  need(precedingSpeedReport?.release === releaseSha && precedingSpeedReport.passed === true &&
    precedingSpeedReport.browserPassed === true && precedingSpeedReport.speedGuard?.passed === true, 'preceding_speed_gate');
  const find = name => {
    const values = oracle.cases.filter(row => row.name === name); need(values.length === 1, 'case_coverage');
    const item = values[0], url = new URL(item.path, ORIGIN);
    need(url.origin === ORIGIN && url.pathname === '/api/catalog/search' && url.searchParams.get('market') === 'china' &&
      url.searchParams.get('preparedCut') === oracle.expectedGeneration && Number.isSafeInteger(item.total) && item.total > 0 &&
      Array.isArray(item.ids) && item.ids.length > 0 && item.ids.length <= 24 && item.ids.every(id => /^[a-f0-9]{24}$/.test(id)) &&
      Array.isArray(item.totalRub) && item.totalRub.length === item.ids.length, 'case_shape');
    return item;
  };
  const home = find('china-first-page'), power = find('china-power-to-160'), modelCity = find('popular-model-2014-novokuznetsk');
  need(Array.isArray(power.power) && power.power.length === power.ids.length &&
    new URL(power.path, ORIGIN).searchParams.get('powerTo') === '160', 'power_evidence');
  const modelUrl = new URL(modelCity.path, ORIGIN);
  need(modelUrl.searchParams.get('make') && modelUrl.searchParams.get('model') && modelUrl.searchParams.get('yearFrom') === '2014' &&
    modelUrl.searchParams.get('city') === 'Новокузнецк' && modelCity.totalRub.some(value => Number.isSafeInteger(value) && value > 0), 'model_city_evidence');
  return {home, power, modelCity};
}

/** Compare actual rendered cards with the private offline oracle. No listing
 * IDs, titles, URLs or source payloads are copied to the public report. */
export function verifyRenderedChinaCards(cards, total, expected, generationId, {limit = 24, power = false, prices = false} = {}) {
  const count = Math.min(limit, expected.total);
  need(total === expected.total && cards.length === count, 'section_count');
  need(same(cards.map(row => row.id), expected.ids.slice(0, count)), 'section_ids');
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index], href = new URL(card.href, ORIGIN);
    need(href.origin === ORIGIN && href.searchParams.get('market') === 'china' && href.searchParams.get('preparedCut') === generationId, 'card_context');
    if (prices && expected.totalRub[index] > 0) need(card.price === expected.totalRub[index], 'card_price');
    if (power) {
      const values = expected.power[index];
      need(Number.isFinite(values.filterPowerHp) && values.filterPowerHp > 0 && values.filterPowerHp <= 160.01, 'filtered_power');
      const includes = (actual, value) => actual.some(number => Math.abs(number - rounded(value)) < 0.011);
      if (values.displayHp > 0) need(includes(card.hp, values.displayHp), 'visible_power_hp');
      if (values.displayKw > 0) need(includes(card.kw, values.displayKw), 'visible_power_kw');
      if (!(values.displayHp > 0 || values.displayKw > 0)) need(values.utilizationKw > 0 && includes(card.kw, values.utilizationKw), 'visible_certified_power');
    }
  }
  return {total, cards: cards.length, idsMatched: true, ...(prices ? {pricesMatched: true} : {}), ...(power ? {
    visiblePowerMatched: true, maxFilterPowerHp: Math.max(...expected.power.slice(0, count).map(row => row.filterPowerHp)),
  } : {})};
}

/** The homepage deliberately balances make/model groups; verify its exact
 * native prefix as a set, preserving each ID's independently saved price. */
export function verifyHomeChinaCards(cards, total, expected, generationId) {
  const byId = new Map(cards.map(card => [card.id, card]));
  need(byId.size === cards.length, 'home_duplicate_id');
  const ordered = [...cards].sort((a, b) => expected.ids.indexOf(a.id) - expected.ids.indexOf(b.id));
  return {...verifyRenderedChinaCards(ordered, total, expected, generationId, {limit: 10, prices: true}), balancedOrderAllowed: true};
}

export function verifyHomeChinaApi(payload, expected, generationId) {
  need(payload?.independentChina === true && payload.marketCounts?.china === expected.total && Array.isArray(payload.items), 'home_api_authority');
  const rows = payload.items.filter(row => row.market === 'china');
  need(rows.length === Math.min(10, expected.total) && new Set(rows.map(row => row.id)).size === rows.length &&
    same(rows.map(row => row.id).sort(), expected.ids.slice(0, rows.length).sort()), 'home_api_ids');
  for (const row of rows) {
    const index = expected.ids.indexOf(row.id);
    need(row.preparedChinaSelection?.generationId === generationId, 'home_api_generation');
    need((row.totalRub ?? null) === expected.totalRub[index], 'home_api_price');
  }
  return {total: expected.total, cards: rows.length, independentChina: true, idsMatched: true, pricesMatched: true,
    incompleteOtherMarkets: payload.countIncomplete === true};
}

function catalogUrl(sample) {
  const url = new URL(sample.path, ORIGIN); url.pathname = '/cars';
  for (const key of ['marketPage', 'includeRates', 'includeFacets', 'countOnly']) url.searchParams.delete(key);
  return url;
}

async function health(context, expected) {
  const response = await context.request.get(ORIGIN + '/api/health', {timeout: 30000});
  need(response.status() === 200 && (await response.json()).releaseSha === expected, 'release_changed');
}

async function chinaSection(page, expectedCount, {home = false} = {}) {
  const heading = page.locator(home ? 'h3' : 'h2').filter({hasText: /Китай/});
  await heading.first().waitFor({state: 'attached', timeout: 60000});
  need(await heading.count() === 1, 'section_ambiguous');
  const section = heading.locator('xpath=ancestor::section[1]');
  const counter = section.locator(home ? '.ac-market-result-count' : '[data-catalog-market-count]');
  await counter.waitFor({state: 'attached', timeout: 60000});
  const cards = section.locator(CARD);
  await cards.nth(expectedCount - 1).waitFor({state: 'attached', timeout: 60000});
  await cards.first().scrollIntoViewIfNeeded();
  await cards.first().waitFor({state: 'visible', timeout: 60000});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const total = home ? Number((await counter.innerText()).replace(/[^0-9]/g, '')) : Number(await counter.getAttribute('data-catalog-market-count'));
  const rows = await cards.evaluateAll(nodes => nodes.map(node => {
    const anchor = [...node.querySelectorAll('a[href]')].find(link => new URL(link.href).pathname.startsWith('/cars/offer/'));
    const route = anchor ? decodeURIComponent(new URL(anchor.href).pathname.split('/')[3] || '') : '';
    const id = route.includes('--') ? route.slice(route.lastIndexOf('--') + 2) : route;
    const text = node.innerText || '';
    const number = value => Number(String(value).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    const hp = [...text.matchAll(/(\d[\d \u00a0\u202f]*(?:[,.]\d+)?)\s*л\s*\.?\s*с\s*\.?/gi)].map(match => number(match[1]));
    const kw = [...text.matchAll(/(\d[\d \u00a0\u202f]*(?:[,.]\d+)?)\s*кВт/gi)].map(match => number(match[1]));
    const price = Number((node.querySelector('.ac-price')?.textContent || '').replace(/[^0-9]/g, '')) || null;
    return {id, href: anchor?.href || '', hp, kw, price};
  }));
  return {section, cards, total, rows};
}

async function restoredFilters(page, expectedUrl) {
  const actual = new URL(page.url());
  need(actual.pathname === expectedUrl.pathname && [...expectedUrl.searchParams].every(([key, value]) => actual.searchParams.get(key) === value), 'back_url');
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Открыть фильтры"]');
    return button && !button.disabled && document.querySelector('.ac-catalog-filter-panel[aria-busy="false"]');
  }, null, {timeout: 60000});
  for (const name of ['make', 'model', 'yearFrom']) {
    const values = await page.locator(`input[name="${name}"]`).evaluateAll(inputs => inputs.map(input => input.value));
    need(values.includes(expectedUrl.searchParams.get(name)), 'back_filter_' + name);
  }
  const cityLabels = await page.locator('button[aria-label^="Выбрать город. Сейчас:"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  need(cityLabels.some(label => label.includes(expectedUrl.searchParams.get('city'))), 'back_filter_city');
}

export async function runChinaBrowserAcceptance({oraclePath, releaseSha, nonce, outputFile, precedingSpeedReportPath, playwrightModule, chromeBin}) {
  const report = {version: 1, kind: 'china-browser-details-v1', release: releaseSha, nonce, checkedAt: new Date().toISOString(),
    phase: 'after_existing_speed_gate', passed: false, checks: [], explicitMutationActions: 0, explicitSupplierRequests: 0};
  let browser, stage = 'preconditions';
  try {
    need(/^[a-f0-9]{32}$/.test(nonce || '') && path.isAbsolute(outputFile), 'arguments');
    const [rawOracle, rawGate] = await Promise.all([fs.readFile(oraclePath), fs.readFile(precedingSpeedReportPath)]);
    const oracle = JSON.parse(rawOracle), preceding = JSON.parse(rawGate);
    const samples = browserOracleCases(oracle, releaseSha, preceding);
    report.generationManifestSha256 = oracle.generationManifestSha256;
    report.pricingRuntimeSha = oracle.pricingRuntimeSha;
    report.oracleSha256 = sha(rawOracle); report.precedingSpeedReportSha256 = sha(rawGate);
    const {chromium} = await import(playwrightModule || 'playwright');
    browser = await chromium.launch({headless: true, executablePath: chromeBin, args: ['--no-sandbox']});
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block', locale: 'ru-RU'});
      try {
        const page = await context.newPage(); let pageErrors = 0;
        page.on('pageerror', () => { pageErrors++; });
        stage = 'release_before'; await health(context, releaseSha);
        const result = {width, releaseBeforeMatched: true}; report.checks.push(result);
        stage = 'homepage';
        // A fresh browser context has no city inherited from the detail case.
        // Wait for China itself, independently of later streamed foreign rails.
        const homeResponse = await page.goto(ORIGIN + '/', {waitUntil: 'commit', timeout: 90000});
        need(homeResponse?.status() === 200, 'home_response');
        const home = await chinaSection(page, Math.min(10, samples.home.total), {home: true});
        result.homepage = verifyHomeChinaCards(home.rows, home.total, samples.home, oracle.expectedGeneration);
        stage = 'homepage_api';
        const homeApi = await context.request.get(ORIGIN + '/api/catalog/home', {timeout: 90000});
        need(homeApi.status() === 200, 'home_api_response');
        result.homeApi = verifyHomeChinaApi(await homeApi.json(), samples.home, oracle.expectedGeneration);
        stage = 'general_power_catalog';
        const response = await page.goto(ORIGIN + '/cars?powerTo=160', {waitUntil: 'domcontentloaded', timeout: 90000});
        need(response?.status() === 200, 'general_response');
        const general = await chinaSection(page, Math.min(6, samples.power.total));
        result.generalPower = verifyRenderedChinaCards(general.rows, general.total, samples.power, oracle.expectedGeneration, {limit: 6, power: true});
        const checked = await page.locator('input[name="powerTo"][value="160"]').evaluateAll(nodes => nodes.some(node => node.checked));
        need(checked, 'general_power_control');
        result.unavailableSiblingSections = await page.locator('section').filter({hasText: 'Не удалось загрузить автомобили этого направления.'}).count();
        const consent = page.getByRole('button', {name: 'Хорошо', exact: true}); if (await consent.isVisible()) await consent.click();

        stage = 'model_city_catalog';
        const expectedUrl = catalogUrl(samples.modelCity);
        const selectedResponse = await page.goto(expectedUrl.href, {waitUntil: 'domcontentloaded', timeout: 90000});
        need(selectedResponse?.status() === 200, 'model_city_response');
        const selected = await chinaSection(page, Math.min(24, samples.modelCity.total));
        result.modelCity = verifyRenderedChinaCards(selected.rows, selected.total, samples.modelCity, oracle.expectedGeneration, {prices: true});
        await restoredFilters(page, expectedUrl);
        const chosen = samples.modelCity.totalRub.findIndex(value => Number.isSafeInteger(value) && value > 0);
        need(chosen >= 0 && chosen < selected.rows.length, 'priced_detail_sample');
        const href = new URL(selected.rows[chosen].href);
        need(href.searchParams.get('city') === expectedUrl.searchParams.get('city'), 'detail_city_context');
        stage = 'model_city_detail';
        await selected.cards.nth(chosen).locator('a[href*="/cars/offer/"]').first().click();
        await page.waitForURL(url => url.pathname.startsWith('/cars/offer/'), {waitUntil: 'commit', timeout: 90000});
        const main = page.locator('main[data-offer-id]'); await main.waitFor({state: 'attached', timeout: 90000});
        need(await main.getAttribute('data-offer-id') === samples.modelCity.ids[chosen], 'detail_id');
        need(Number(await main.getAttribute('data-offer-price-rub')) === samples.modelCity.totalRub[chosen], 'detail_price');
        const visiblePrices = await main.locator('.ac-offer-price-panel .ac-price').evaluateAll(nodes => nodes.map(node => Number((node.textContent || '').replace(/[^0-9]/g, ''))));
        need(visiblePrices.includes(samples.modelCity.totalRub[chosen]), 'visible_detail_price');
        result.detail = {idMatched: true, savedCityPriceMatched: true, visiblePriceMatched: true};
        stage = 'back_to_filters';
        await page.goBack({waitUntil: 'domcontentloaded', timeout: 90000});
        await restoredFilters(page, expectedUrl);
        const back = await chinaSection(page, Math.min(24, samples.modelCity.total));
        verifyRenderedChinaCards(back.rows, back.total, samples.modelCity, oracle.expectedGeneration, {prices: true});
        result.back = {filtersRestored: true, idsMatched: true, pricesMatched: true};

        stage = 'release_after'; await health(context, releaseSha);
        result.releaseAfterMatched = true; result.pageErrorsObserved = pageErrors;
      } finally { await context.close(); }
    }
    report.passed = true;
  } catch (error) {
    report.error = {stage, code: /^china_browser_[a-z_]+$/.test(error?.message || '') ? error.message : 'china_browser_check_failed',
      timeout: error?.name === 'TimeoutError'};
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fs.writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runChinaBrowserAcceptance({oraclePath: process.env.ORACLE_PATH, releaseSha: process.env.CHINA_RELEASE_SHA,
      nonce: process.env.CHINA_VERIFICATION_NONCE || process.env.VERIFICATION_NONCE,
      outputFile: path.resolve(process.env.CHINA_BROWSER_DETAILS_OUTPUT || 'china-browser-details-report.json'),
      precedingSpeedReportPath: process.env.OWNER_FILTER_BROWSER_REPORT || 'owner-filter-browser-report.json',
      playwrightModule: process.env.PLAYWRIGHT_MODULE, chromeBin: process.env.CHROME_BIN});
    process.stdout.write('CHINA_BROWSER_DETAILS ' + JSON.stringify(report) + '\n');
    if (!report.passed) process.exitCode = 1;
  } catch { process.stderr.write('china_browser_report_failed\n'); process.exitCode = 1; }
}
