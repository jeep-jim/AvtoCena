import {createHash} from 'node:crypto';

const ORIGIN = 'https://avtocena.com';
const CITY = 'Новокузнецк';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const need = (value, code) => { if (!value) throw Error('japan_browser_stability_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const name = value => typeof value === 'string' && value.trim() === value && value.length > 0
  && value.length <= 100 && !/[\x00-\x1f\x7f<>|]/.test(value);
const normalized = value => String(value).normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
const compact = value => normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
const sameMake = (value, expected) => name(value) && compact(value) === compact(expected);
const sourceModelMatches = (source, selected) => compact(source) === compact(selected)
  || normalized(source).startsWith(normalized(selected) + ' ')
  || normalized(source).startsWith(normalized(selected) + '(');

export const JAPAN_STABILITY_GATES = Object.freeze(['japanModelSelectionPassed', 'japanCombinedFiltersPassed',
  'japanRelatedCardsPassed', 'japanVehiclePolicyPassed']);
export const JAPAN_STABILITY_MODELS_API = '/api/catalog/source-models?market=japan&make=Mazda';
export const JAPAN_LEGACY_MAZDA_THREE_PAGES = Object.freeze({
  literal: ORIGIN + '/cars/japan?' + new URLSearchParams({make: 'Mazda', model: '3', city: CITY}),
  canonical: ORIGIN + '/cars/japan/Mazda/3?' + new URLSearchParams({city: CITY}),
});

/** The controls preserve the selected source spellings in the canonical path. */
export function japanStabilitySelectionUrl(value, make, model) {
  if (!name(make) || model !== undefined && !name(model)) return false;
  try {
    const url = new URL(value);
    const expected = ORIGIN + '/cars/japan/' + encodeURIComponent(make)
      + (model === undefined ? '' : '/' + encodeURIComponent(model)) + '?' + new URLSearchParams({city: CITY});
    return url.href === expected;
  } catch { return false; }
}

export function japanStabilityChinaFamilyPage(generationId) {
  need(/^gen_china_[0-9]+_[0-9]+$/.test(generationId), 'china_generation');
  return ORIGIN + '/cars/china/Mercedes-Benz/B-Class?'
    + new URLSearchParams({city: CITY, preparedCut: generationId});
}

export function japanStabilitySearchApi(kind, model) {
  need(['model', 'combined', 'related'].includes(kind), 'query_kind');
  const query = new URLSearchParams({market: 'japan', page: '1', pageSize: '24', city: CITY});
  if (kind === 'combined') {
    query.set('auctionGrade', '5'); query.set('transmission', 'automatic');
    query.set('fuel', 'petrol'); query.set('powerTo', '160');
  } else {
    need(name(model) && (kind !== 'related' || compact(model) === 'BCLASS'), 'query_model');
    query.set('make', kind === 'model' ? 'Mazda' : 'Mercedes-Benz'); query.set('model', model);
  }
  return '/api/catalog/search?' + query;
}

/** Additional reads are limited to the three actual visitor regressions. No
 * supplier URL, arbitrary API path, count scan or pagination loop is accepted. */
export function japanStabilityApiAllowed(value) {
  if (value === JAPAN_STABILITY_MODELS_API) return true;
  try {
    const url = new URL(value, ORIGIN), query = url.searchParams;
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/api/catalog/search'
      || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) return false;
    if (query.get('auctionGrade') === '5') return value === japanStabilitySearchApi('combined');
    if (query.get('make') === 'Mazda') return value === japanStabilitySearchApi('model', query.get('model'));
    return query.get('make') === 'Mercedes-Benz' && value === japanStabilitySearchApi('related', query.get('model'));
  } catch { return false; }
}

export function checkedJapanStabilityDirectory(payload, status) {
  need(status === 200 && payload?.version === 1 && payload.stale === false
    && Array.isArray(payload.models) && payload.models.length > 0, 'directory_unavailable');
  const rows = payload.models.map(row => {
    need(Array.isArray(row) && row.length === 4 && sameMake(row[0], 'Mazda') && name(row[1])
      && Array.isArray(row[2]) && row[2].length === 0 && Number.isSafeInteger(row[3]) && row[3] > 0, 'directory_rows');
    return {model: row[1], total: row[3]};
  });
  need(new Set(rows.map(row => normalized(row.model))).size === rows.length, 'directory_duplicate');
  return rows;
}

export function selectJapanStabilityModel(directory, options) {
  need(Array.isArray(directory) && directory.length > 0 && Array.isArray(options) && options.length > 0, 'model_options');
  for (const option of options) need(sameMake(option.make, 'Mazda') && name(option.model)
    && directory.some(row => sourceModelMatches(row.model, option.model)), 'model_not_in_source');
  need(new Set(options.map(row => normalized(row.model))).size === options.length, 'model_duplicate');
  // These priorities choose only an option actually rendered from this source.
  // They never turn an encyclopedia alias such as "3" into MAZDA3 or AXELA.
  const priority = value => ['MAZDA3', 'AXELA', 'DEMIO', 'CX5', 'CX3'].findIndex(prefix => compact(value).startsWith(prefix));
  const ranked = options.filter(row => !/\b(?:TITAN|BONGO|SCRUM)\b/.test(normalized(row.model)))
    .map(row => ({...row, rank: priority(row.model)}))
    .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.model.localeCompare(b.model));
  need(ranked.length > 0, 'passenger_model_missing');
  return {make: ranked[0].make, model: ranked[0].model};
}

export function verifyJapanStabilityModelRows(payload, selection, directory) {
  need(payload.items.every(row => sameMake(row.make, 'Mazda') && name(row.model)
    && sourceModelMatches(row.model, selection.model)
    && directory.some(source => compact(source.model) === compact(row.model))), 'model_filter_mismatch');
  return {make: 'Mazda', model: selection.model, shown: payload.items.length, sourceOptionsOnly: true, rowModelsMatched: true};
}

const legacyMazdaThreeFamily = value => {
  const requested = 'MAZDA3'; let prefix = '';
  for (const word of normalized(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/)) {
    prefix += word;
    if (prefix === requested || prefix.startsWith(requested) && /^[A-Z]+$/.test(prefix.slice(requested.length))) return true;
    if (!requested.startsWith(prefix)) return false;
  }
  return false;
};

/** The old Mazda/3 bookmark must resolve to an observed MAZDA3 family. Another
 * selectable Mazda model cannot prove this alias, nor can an empty/error page. */
export function verifyJapanLegacyMazdaThreeRows(payload, directory) {
  const family = directory.filter(row => name(row.model) && legacyMazdaThreeFamily(row.model));
  need(family.length > 0, 'legacy_mazda_three_source_missing');
  need(Array.isArray(payload?.items) && payload.items.length > 0 && payload.items.every(row =>
    sameMake(row.make, 'Mazda') && name(row.model) && legacyMazdaThreeFamily(row.model)
    && family.some(source => compact(source.model) === compact(row.model))), 'legacy_mazda_three_mismatch');
  return {make: 'Mazda', model: '3', resolvedFamily: 'MAZDA3', shown: payload.items.length,
    sourceFamilyModels: family.length, rowModelsMatched: true};
}

export function verifyJapanStabilityCombinedRows(payload) {
  need(payload.items.every(row => row.fuel === 'petrol' && row.transmission === 'automatic'
    && String(row.auctionGrade).trim() === '5'), 'combined_filter_mismatch');
  return {auctionGrade: '5', transmission: 'automatic', fuel: 'petrol', powerTo: 160, shown: payload.items.length};
}

const auctionRow = row => row?.market === 'japan' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id || '');
// AJ retains its raw make. These two exact spellings are explicit aliases of
// Mercedes-Benz in runtime brands.ts; no other brand or family is inferred.
const relatedMercedesMake = value => sameMake(value, 'Mercedes-Benz')
  || name(value) && /^(?:benz|mercedes)$/i.test(value);
// filterGreenCorner calls matchesCatalogModel: Mercedes discovery compares the
// complete B-Class tokens and permits a trailing trim, not another class or
// a partial token such as B-Classical. Mercedes has no discovery-name rewrite.
const greenFamilyMatches = (model, family) => {
  const requested=compact(family);let prefix='';
  for(const word of normalized(model).replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/)){
    prefix+=word;if(prefix===requested)return true;
    if(!requested.startsWith(prefix))return false;
  }
  return false;
};

/** Match the unchanged runtime Green stock and seller-price contracts. Stock
 * may fill a related rail, but cannot substitute for fresh auction evidence.
 * The source identity is required for the Green-specific ATB invoice rate. */
export function validJapanStabilityGreenStock(row) {
  const rate = row?.calculationSnapshot?.currencyRate;
  let retiredImage = false;
  try { retiredImage = /(^|\.)(pro-auctions\.ru|pa-server\.ru|jptrade\.ru)$/i.test(new URL(row?.imageUrl).hostname); } catch {}
  return row?.sourceId === 'akebono_green_japan_open' && row.market === 'japan'
    && typeof row.id === 'string' && /^green-\d+$/.test(row.id) && row.offerType === 'fixed'
    && row.catalogPricingMode === 'seller' && row.calculationStatus === 'needs_data'
    && !(Number(row.totalRub) > 0) && Number.isFinite(row.sellerPriceRub) && row.sellerPriceRub > 0
    && Number(row.sourcePrice) > 0 && /^[A-Z]{3}$/.test(String(row.sourceCurrency || ''))
    && ['cbr', 'cbr_live', 'atb_akebono'].includes(rate?.rateSource)
    && rate.currency === row.sourceCurrency && Number(rate.sourcePrice) === Number(row.sourcePrice)
    && Number.isFinite(rate.effectiveRate) && rate.effectiveRate > 0
    && Math.round(Number(row.sourcePrice) * rate.effectiveRate) === row.sellerPriceRub
    && Array.isArray(row.images) && row.images.length > 0 && !retiredImage
    && !['operational', 'vin', 'frameNumber'].some(key => Object.hasOwn(row, key));
}

export function verifyJapanStabilityRelated(payload, status, currentId) {
  need(status === 200 && payload?.kind === 'related' && payload.current?.id === currentId
    && payload.current.market === 'china' && sameMake(payload.make, 'Mercedes-Benz')
    && name(payload.familyModel) && compact(payload.familyModel) === 'BCLASS'
    && Array.isArray(payload.crossMarketGroups), 'related_response');
  const groups = payload.crossMarketGroups.filter(group => group?.market === 'japan');
  need(groups.length === 1 && Array.isArray(groups[0].items) && groups[0].items.length > 0
    && groups[0].items.length <= 4, 'related_empty');
  const rows = groups[0].items;
  need(rows.some(auctionRow) && rows.every(row => (auctionRow(row) || validJapanStabilityGreenStock(row)
    && greenFamilyMatches(row.model,payload.familyModel))
    && relatedMercedesMake(row.make) && name(row.model))
    && new Set(rows.map(row => row.id)).size === rows.length, 'related_rows');
  return rows;
}

async function visibleCardsMatch(page, root, items) {
  const cards = root.locator(CARD);
  await cards.nth(items.length - 1).waitFor({state: 'attached', timeout: 60_000});
  need(await cards.count() === items.length, 'ui_count');
  for (const row of items) {
    const card = cards.filter({has: page.locator('a[href*="' + row.id + '"]')});
    await card.waitFor({state: 'attached', timeout: 30_000});
    need(await card.count() === 1, 'ui_identity');
  }
  need(await root.getByText('Не удалось загрузить эту страницу', {exact: true}).count() === 0, 'ui_load_error');
  return cards;
}

export async function runJapanLegacyMazdaThreeBrowser({context, directory, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, navigateLegacyMazdaThree}) {
  onStage('stability_legacy_mazda_three');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const {response, redirectProof} = await navigateLegacyMazdaThree(view);
  need(response?.status() === 200, 'legacy_mazda_three_page_http');
  need(view.url() === JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical, 'legacy_mazda_three_url');
  const result = await read(japanStabilitySearchApi('model', '3'));
  const observation = verifyPage(result.data, result.status);
  verifyFullPage(result.data);
  const proof = verifyJapanLegacyMazdaThreeRows(result.data, directory);
  await visibleCardsMatch(view, view.locator('main.ac-ajes-catalog'), result.data.items);
  need(errors === 0, 'legacy_mazda_three_javascript');
  await capture(view, 'japan-legacy-mazda-three-desktop');
  await view.close(); onPage(null);
  return {page: result.data, proof: {...observation, ...proof, literalBookmarkChecked: true,
    canonicalRedirect: redirectProof, uiMatchesApi: true, cityPreserved: true, pageErrors: errors}};
}

/** Ordinary, bounded public journeys supplement the unchanged Japan freshness,
 * power, pagination, price and neighbor-preservation acceptance. */
export async function runJapanStabilityBrowser({context, report, generationId, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy, navigateLegacyMazdaThree}) {
  const pages = [];
  onStage('stability_source_models');
  const directoryResponse = await read(JAPAN_STABILITY_MODELS_API);
  const directory = checkedJapanStabilityDirectory(directoryResponse.data, directoryResponse.status);

  const legacy = await runJapanLegacyMazdaThreeBrowser({context, directory, read, capture, onStage, onPage,
    verifyPage, verifyFullPage, navigateLegacyMazdaThree});
  pages.push(legacy.page); report.checks.legacyModelSelection = legacy.proof;

  onStage('stability_model_selection');
  let view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  let response = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'model_page_http');
  const brand = view.locator('button[aria-label="Выбрать марки автомобилей"]:visible');
  await brand.click();
  const brandOption = view.locator('button[data-facet-value="Mazda" i]:visible');
  const sourceMake = await brandOption.getAttribute('data-facet-value');
  need(sameMake(sourceMake, 'Mazda'), 'make_option_identity');
  await brandOption.click();
  await view.waitForURL(url => japanStabilitySelectionUrl(url.href, sourceMake), {timeout: 60_000});
  if (await brand.getAttribute('aria-expanded') === 'true') await brand.click();
  const input = view.locator('input[aria-label="Модель автомобиля"]:visible');
  await input.click();
  await view.locator('button[data-model-value]:visible').first().waitFor({state: 'visible', timeout: 60_000});
  const options = await view.locator('button[data-model-value]:visible').evaluateAll(nodes => nodes.map(node =>
    ({model: node.getAttribute('data-model-value'), make: node.getAttribute('data-model-make')})));
  const selected = selectJapanStabilityModel(directory, options);
  const option = view.locator('button[data-model-value]:visible').filter({hasText: selected.model});
  const exact = await option.evaluateAll((nodes, model) => nodes.map(node => node.getAttribute('data-model-value')).filter(value => value === model), selected.model);
  need(exact.length === 1, 'selected_option_identity');
  const optionIndex = options.findIndex(row => row.model === selected.model && row.make === selected.make);
  await view.locator('button[data-model-value]:visible').nth(optionIndex).click();
  await view.getByRole('button', {name: 'Закрыть список моделей', exact: true}).click();
  await view.waitForURL(url => japanStabilitySelectionUrl(url.href, sourceMake, selected.model), {timeout: 60_000});
  need(new URL(view.url()).searchParams.get('city') === CITY, 'model_city');
  const modelResponse = await read(japanStabilitySearchApi('model', selected.model));
  const modelObservation = verifyPage(modelResponse.data, modelResponse.status);
  verifyFullPage(modelResponse.data);
  const modelProof = verifyJapanStabilityModelRows(modelResponse.data, selected, directory);
  pages.push(modelResponse.data);
  let catalog = view.locator('main.ac-ajes-catalog');
  await visibleCardsMatch(view, catalog, modelResponse.data.items);
  need(errors === 0, 'model_javascript');
  report.checks.modelSelection = {...modelObservation, ...modelProof, directoryModels: directory.length,
    selectedThroughUi: true, uiMatchesApi: true, cityPreserved: true, pageErrors: errors};
  report.japanModelSelectionPassed = true;
  await capture(view, 'japan-source-model-selection-desktop');
  await view.close(); onPage(null);

  onStage('stability_combined_filters');
  view = await context.newPage(); onPage(view); errors = 0; view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 390, height: 900});
  const combinedApi = japanStabilitySearchApi('combined');
  const combinedQuery = new URL(combinedApi, ORIGIN).searchParams;
  for(const key of ['market','page','pageSize'])combinedQuery.delete(key);
  response = await view.goto(ORIGIN + '/cars/japan?' + combinedQuery, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'combined_page_http');
  const combinedResponse = await read(combinedApi);
  const combinedObservation = verifyPage(combinedResponse.data, combinedResponse.status);
  verifyFullPage(combinedResponse.data); verifyPowerPage(combinedResponse.data);
  const combinedProof = verifyJapanStabilityCombinedRows(combinedResponse.data);
  pages.push(combinedResponse.data);
  catalog = view.locator('main.ac-ajes-catalog');
  await visibleCardsMatch(view, catalog, combinedResponse.data.items);
  const combinedUrl = new URL(view.url());
  need([...combinedQuery].every(([key, value]) => combinedUrl.searchParams.get(key) === value), 'combined_url');
  need(errors === 0, 'combined_javascript');
  report.checks.combinedFilters = {...combinedObservation, ...combinedProof, uiMatchesApi: true, cityPreserved: true, pageErrors: errors};
  report.japanCombinedFiltersPassed = true;
  await capture(view, 'japan-grade-five-petrol-automatic-power-mobile');
  await view.close(); onPage(null);

  onStage('stability_other_market_detail');
  const chinaPage = japanStabilityChinaFamilyPage(generationId);
  view = await context.newPage(); onPage(view); errors = 0; view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  response = await view.goto(chinaPage, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'china_page_http');
  need(view.url() === chinaPage, 'china_url');
  const sourceCard = view.locator(CARD).filter({hasText: /B-Class/i}).first();
  await sourceCard.waitFor({state: 'visible', timeout: 60_000});
  const link = sourceCard.locator('a[href*="/cars/offer/"]').first();
  const detail = new URL(await link.getAttribute('href'), ORIGIN);
  const match = /^\/cars\/offer\/([A-Za-z0-9_-]+)(?:\/[^/]+)?$/.exec(detail.pathname);
  need(detail.origin === ORIGIN && match && detail.searchParams.get('market') === 'china'
    && detail.searchParams.get('preparedCut') === generationId && detail.searchParams.get('city') === CITY, 'china_link');
  const currentId = match[1];
  const recommendationResponse = view.waitForResponse(value => {
    const url = new URL(value.url());
    return value.request().method() === 'GET' && url.origin === ORIGIN && url.pathname === '/api/catalog/recommendations'
      && url.searchParams.get('kind') === 'related' && url.searchParams.get('id') === currentId;
  }, {timeout: 90_000});
  recommendationResponse.catch(() => {});
  await link.click(); await view.waitForURL(url => url.href === detail.href, {timeout: 90_000});
  const recommendations = view.locator('[data-deferred-recommendations="related"]');
  await recommendations.scrollIntoViewIfNeeded();
  const relatedResponse = await recommendationResponse;
  const related = await relatedResponse.json();
  onStage('stability_related_freshness');
  // Record the one matching visitor search even when the recommendation rail
  // is empty, so an actual source restriction has its own bounded receipt.
  const fresh = await read(japanStabilitySearchApi('related', 'B-Class'));
  const freshObservation = verifyPage(fresh.data, fresh.status); verifyFullPage(fresh.data); pages.push(fresh.data);
  const rows = verifyJapanStabilityRelated(related, relatedResponse.status(), currentId);
  const freshIds = new Set(fresh.data.items.map(row => row.id));
  const auctionRows = rows.filter(auctionRow);
  need(auctionRows.every(row => freshIds.has(row.id)), 'related_fresh_identity');
  const japan = recommendations.locator('[data-related-market="japan"]');
  await japan.waitFor({state: 'visible', timeout: 60_000});
  await visibleCardsMatch(view, japan, rows);
  need(errors === 0, 'related_javascript');
  report.checks.relatedCards = {currentOfferSha256: hash(currentId), currentMarket: 'china', familyModel: 'B-Class',
    market: 'japan', cards: rows.length, uiMatchesApi: true, freshSourceIdsMatched: true,
    freshAuctionCards: auctionRows.length, validatedGreenStockCards: rows.length - auctionRows.length,
    freshObservation, pageErrors: errors};
  report.japanRelatedCardsPassed = true;
  report.checks.vehiclePolicy = verifyVehiclePolicy(pages); report.japanVehiclePolicyPassed = true;
  await capture(view, 'japan-related-cards-on-china-detail-desktop');
  await view.close(); onPage(null);
}
