import { publicResponseChallenge } from "./lib/public-response-challenge.mjs";
import { isExistingPilotBridgeRequest } from './lib/catalog-pilot-bridge.mjs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { catalogTrialSnapshot } from './lib/catalog-trial-snapshot.mjs';
import { summarizePilotMarket, boundedPilotInteger } from './lib/catalog-pilot-summary.mjs';

// Bounded public listing and detail diagnostic; no image downloads or publication.
// KCar's existing public search POST is allowed only on its exact search route.
process.env.JSON_STORAGE_DRIVER = 'local';
process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
const fetchOriginal = globalThis.fetch;
const trial = process.env.PILOT_TRIAL_PROFILE === 'five_market_v1';
const sampleLimit = boundedPilotInteger(process.env.PILOT_SAMPLE_LIMIT, 3, trial ? 200 : 80);
const pageLimit = boundedPilotInteger(process.env.PILOT_PAGE_LIMIT, 1, 5);
const requestLimit = boundedPilotInteger(process.env.PILOT_REQUEST_LIMIT, 8, trial ? 350 : 100);
const timeoutMs = Math.max(1000, Math.min(45000, Number(process.env.PILOT_TIMEOUT_MS || 15000)));
process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = '1';
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES = '1';
let currencyRequests = 0;
let imageRequestsBlocked = 0;
let nextSourceRequestAt = 0;
const requestIntervalMs = Math.max(0, Math.min(3000, Number(process.env.PILOT_REQUEST_INTERVAL_MS || 0)));
let active;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (/\.(?:jpe?g|png|webp|avif|gif|svg)(?:$|\/)/i.test(url.pathname) || /^(?:img|image|images)\./i.test(url.hostname)) {
    imageRequestsBlocked++; throw new Error('diagnostic_image_download_blocked');
  }
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  const bridgeRequest = process.env.PILOT_ALLOW_EXISTING_BRIDGE === '1'
    && isExistingPilotBridgeRequest(url, method, process.env.PILOT_REGISTERED_SOURCE_ID, trial ? pageLimit : 1);
  if (url.href === 'https://www.cbr.ru/scripts/XML_daily.asp' && method === 'GET' && currencyRequests++ === 0) return fetchOriginal(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (active?.stopped) throw new Error('pilot_source_stopped');
  if (active?.requests.length >= requestLimit) throw new Error('pilot_request_budget_exhausted');
  if (!active || (method !== 'GET' && !(method === 'POST' && url.hostname === 'api.kcar.com' && url.pathname === '/bc/search/list/drct'))
    || url.protocol !== 'https:' || url.username || url.password || url.port || (!bridgeRequest && !active.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)))) {
    throw new Error('pilot_request_outside_envelope');
  }
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
  if (headers.has('authorization') || headers.has('cookie')) throw new Error('pilot_credentials_not_allowed');
  const event = { origin: url.origin, path: url.pathname, method, status: null };
  active.requests.push(event);
  const waitMs = Math.max(0, nextSourceRequestAt - Date.now());
  nextSourceRequestAt = Date.now() + waitMs + requestIntervalMs;
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  if (active.stopped) { event.cancelled = true; throw new Error('pilot_source_stopped'); }
  let response;
  try { response = await fetchOriginal(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { event.error = String(error?.name || 'network_error'); throw error; }
  event.status = response.status;
  event.contentType = response.headers.get('content-type');
  if ([401, 403, 429].includes(response.status)) { active.stopped = true; throw new Error(`pilot_stop_http_${response.status}`); }
  if (response.status >= 300 && response.status < 400) throw new Error('pilot_redirect_requires_review');
  if (/^image\//i.test(event.contentType || '')) {
    await response.body?.cancel();
    imageRequestsBlocked++; throw new Error('diagnostic_image_response_blocked');
  }
  const body = await response.clone().text();
  if (process.env.PILOT_RESPONSE_EVIDENCE === '1') {
    event.bodyEvidence = { bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex'),
      title: body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.slice(0, 180),
      rscPushCount: (body.match(/self\.__next_f\.push/g) || []).length,
      hasSpecTable: body.includes('ssrSpecParam'), hasBoundSpecId: body.includes('initialSpecId'),
      hasCarId: body.includes('carId'), hasFlightContentType: /text\/x-component/.test(event.contentType || '') };

  }
  if (publicResponseChallenge(body)) { active.stopped = true; throw new Error('pilot_challenge_stop'); }
  return response;
};

const sources = [
  process.env.PILOT_KOREA_SOURCE === 'encar' ? ['korea', 'encar-complete-source', 'encarCompleteSource', ['encar.com']] : ['korea', 'kcar-exact-source', 'kcarKoreaExactSource', ['kcar.com']],
  ['europe', 'mobile-de-exact-source', 'mobileDeExactSource', ['mobile.de']],
  ['china', 'che168-global-exact-source', 'che168GlobalExactSource', ['che168.com']],
  process.env.PILOT_UAE_SOURCE === 'porsche' ? ['uae', 'porsche-finder-source', 'porscheFinderUaeSource', ['finder.porsche.com']] : process.env.PILOT_UAE_SOURCE === 'carswitch' ? ['uae', 'carswitch-exact-source', 'carswitchUaeExactSource', ['carswitch.com']] : process.env.PILOT_UAE_SOURCE === 'dubicars' ? ['uae', 'dubicars-current-source', 'dubicarsUaeCurrentSource', ['dubicars.com']] : ['uae', 'dubizzle-exact-source', 'dubizzleUaeExactSource', ['dubizzle.com']],
  process.env.PILOT_GEORGIA_SOURCE === 'porsche' ? ['georgia', 'porsche-finder-source', 'porscheFinderGeorgiaSource', ['finder.porsche.com']] : process.env.PILOT_GEORGIA_SOURCE === 'myauto' ? ['georgia', 'myauto-list-source', 'myAutoListSource', ['myauto.ge']] : ['georgia', 'autopapa-georgia-source', 'autoPapaGeorgiaSource', ['autopapa.ge']],
];
let registeredSource;
if (process.env.PILOT_REGISTERED_SOURCE_ID) {
  const { REQUIRED_CATALOG_SOURCES } = await import('../apps/web/lib/catalog/required-catalog-sources.ts');
  const { catalogImportSources } = await import('../apps/web/lib/catalog/importer.ts');
  registeredSource = catalogImportSources.find(source => source.sourceId === process.env.PILOT_REGISTERED_SOURCE_ID && source.market !== 'japan');
  const contract = registeredSource && REQUIRED_CATALOG_SOURCES[registeredSource.market].find(source => source.sourceId === registeredSource.sourceId);
  if (!contract) throw new Error('pilot_registered_source_forbidden');
  const host = new URL(contract.canonicalUrl).hostname.replace(/^www\./, '');
  sources.splice(0, sources.length, [registeredSource.market, null, null, [host]]);
}
const report = { version: 3, completed: false, checkedAt: new Date().toISOString(), productionWrites: false,
  existingProductionBridgeAllowed: process.env.PILOT_ALLOW_EXISTING_BRIDGE === '1',
  bridgeUpstreamTrafficObserved: false,
  japanRequests: 0, detailsRequested: true, pricesCalculated: true, maxRequestsPerSource: requestLimit, sampleLimit, pageLimit, markets: [],
  limitation: 'Bounded sample per source; local repository business settings, not an attestation of production settings. Not a complete collection or publication acceptance test. Network/proxy errors do not prove source unavailability.' };
const outputPath = process.env.PILOT_REPORT || 'data/catalog/research/public-detail-calculation-pilot-v1-20260906.json';
async function checkpoint(snapshot = report) {
  report.currencyRequests = currencyRequests;
  snapshot.imageRequestsBlocked = imageRequestsBlocked;
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2) + '\n');
}
const requestedMarkets = new Set(String(process.env.PILOT_MARKETS || 'europe,china,uae').split(','));
const { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } = await import('../apps/web/lib/catalog/specification-evidence-audit.ts');
const { enrichOfferForDisplay, catalogPricingSpecificationsChanged } = await import('../apps/web/lib/catalog/display-enrichment.ts');
const { catalogPublicPriority, catalogOfferVisibleRub } = await import('../apps/web/lib/catalog/public-priority.ts');
const { searchProjectionFromOffer, projectionCanRenderCard } = await import('../apps/web/lib/catalog/storage.ts');
const { isCrediblePublicOffer, catalogSemanticEvidenceRejectionReason, credibleCatalogImages, hasAllowedCatalogSourceProvenance } = await import('../apps/web/lib/catalog/offer-quality.ts');
const { isCatalogYearAllowed } = await import('../apps/web/lib/catalog/offer-quality.ts');
const { getJsonStorage } = await import('../apps/web/lib/data.ts');
const storage = getJsonStorage();
for (const method of ['writeJson', 'writeJsonIfMatch', 'deleteObject', 'deleteObjects', 'deletePrefix', 'putBinary']) storage[method] = async () => { throw new Error('diagnostic_storage_write_blocked'); };
const { calculateOfferWithVerifiedSpecifications } = await import('../apps/web/lib/catalog/customs-pricing.ts');
const { enrichOfferWithKnowledgeCore } = await import('../apps/web/lib/catalog/knowledge-core.ts');
const { enrichOfferWithCertifiedPower } = await import('../apps/web/lib/catalog/power-reference.ts');
const { normalizeVehicleOfferSpecs } = await import('../apps/web/lib/catalog/spec-normalization.ts');
report.calculationPreparation = 'knowledge_core_then_certified_power_then_verified_specifications';
for (const [market, module, name, hosts] of sources.filter(([market]) => requestedMarkets.has(market))) {
  active = { market, hosts, requests: [] };
  try {
    const source = registeredSource || (await import(`../apps/web/lib/catalog/${module}.ts`))[name];
    active.sourceId = source.sourceId;
    const offers = [];
    const snapshots = [];
    const seen = new Set();
    const seenCursors = new Set();
    let cursor = '1';
    active.listingRows = 0;
    active.normalizedRows = 0;
    active.normalizationRejected = 0;
    active.duplicates = 0;
    active.details = [];
    active.pages = [];
    for (let page = 0; page < pageLimit; page += 1) {
      if (active.stopped || active.requests.length >= requestLimit || offers.length >= sampleLimit) break;
      if (seenCursors.has(cursor)) { active.stopReason = 'repeated_cursor'; break; }
      seenCursors.add(cursor);
      const result = await source.fetchPage(cursor);
      const rows = result.items || [];
      active.listingRows += rows.length;
      active.sourceHealth = result.health || null;
      active.pages.push({ cursor, returnedRows: rows.length, diagnostics: result.diagnostics || null, health: result.health || null });
      for (const row of rows) {
        const offer = source.normalizeOffer(row);
        if (!offer) { active.normalizationRejected += 1; continue; }
        const identity = `${offer.sourceId}:${offer.sourceOfferId}`;
        if (seen.has(identity)) { active.duplicates += 1; continue; }
        seen.add(identity);
        active.normalizedRows += 1;
        // A network stop does not discard already fetched detail data. The fetch
        // guard still forbids subsequent requests, including inside fetchImages.
        if (offers.length >= sampleLimit) continue;
        offers.push(offer);
        const before = { year: offer.year, fuel: offer.fuel, engineCc: offer.engineCc, powerHp: offer.powerHp, sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency };
        const item = { sourceOfferId: offer.sourceOfferId, yearAllowed: isCatalogYearAllowed(offer.year, market), before };
        const detailRequestStart = active.requests.length;
        let preparedOffer;
        try {
          offer.images = await source.fetchImages(offer);
          item.images = offer.images.length;
          item.sourceUrl = offer.operational?.sourceUrl;
          item.galleryUrls = offer.images.map(image => image.url);
          if (process.env.PILOT_RESPONSE_EVIDENCE === '1' && market === 'china') {
            const raw = offer.operational?.raw || {};
            item.sourceWitness = { detailId: raw.detail?.infoid, specId: raw.detail?.specid,
              apiEngine: raw.detail?.engine, apiFuel: raw.detail?.fuelname,
              boundParameters: raw.boundPageParameters || null, semanticEvidence: offer.operational?.semanticEvidence };
          }
          if (process.env.PILOT_RESPONSE_EVIDENCE === '1' && source.sourceId === 'myauto_georgia_list') {
            const raw = offer.operational?.raw || {};
            item.sourceWitness = { productId: raw.myAutoProductCarId,
              productEngineCc: raw.myAutoProductEngineCc, productPowerHp: raw.myAutoProductPowerHp,
              productSemanticEvidence: raw.myAutoProductSemanticEvidence || null,
              semanticEvidence: offer.operational?.semanticEvidence || null,
              limitation: 'Existing deployed bridge may predate shared product evidence preparation; derived scalar alone is not exact evidence.' };
          }
          item.sourceFields = Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(offer, field)]));
          // Match collection's knowledge preparation before the exact-evidence
          // gate. Representative guesses and unresolved variants still fail it.
          const calculationInput = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(
            await enrichOfferWithKnowledgeCore(structuredClone(offer))));
          preparedOffer = calculationInput;
          item.fields = Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(calculationInput, field)]));
          item.calculationInput = Object.fromEntries(Object.keys(before).map(key => [key, calculationInput[key]]));
          item.knowledgeEnrichment = calculationInput.operational?.knowledgeCore || null;
          const priced = await calculateOfferWithVerifiedSpecifications(calculationInput);
          preparedOffer = priced;
          item.totalRub = priced.totalRub;
          item.calculationStatus = priced.calculationStatus;
          item.breakdown = priced.calculationSnapshot?.breakdown;
          item.currencyRate = priced.calculationSnapshot?.currencyRate;
          item.eurRate = priced.calculationSnapshot?.eurRate;
          if (process.env.PILOT_PUBLIC_DISPLAY_AUDIT === '1') {
            const displayed = await enrichOfferForDisplay(structuredClone(priced));
            const priority = catalogPublicPriority(displayed);
            const projection = searchProjectionFromOffer(displayed);
            const detailRub = catalogOfferVisibleRub(displayed);
            const cardRub = catalogOfferVisibleRub(projection);
            const breakdownSumRub = (displayed.calculationSnapshot?.breakdown || []).reduce((sum, line) => sum + Number(line.amountRub || 0), 0);
            item.publicDisplay = { calculationStatus: displayed.calculationStatus, totalRub: displayed.totalRub,
              businessConfigVersion: displayed.calculationSnapshot?.businessConfigVersion,
              priceDeltaFromCalculationRub: Number(displayed.totalRub || 0) - Number(priced.totalRub || 0),
              pricingSpecificationsChanged: catalogPricingSpecificationsChanged(priced, displayed),
              credible: isCrediblePublicOffer(displayed),
              credibilityEvidence: { sourceAllowed: hasAllowedCatalogSourceProvenance(displayed),
                semanticRejection: catalogSemanticEvidenceRejectionReason(displayed),
                credibleImageCount: credibleCatalogImages(displayed.images).length,
                bodyType: displayed.bodyType, bodyEvidence: displayed.operational?.semanticEvidence?.bodyType },
              eligible: priority.eligible, reason: priority.reason,
              detailRub, cardRub, pricesAgree: detailRub === cardRub,
              projectionCanRender: projectionCanRenderCard(projection),
              breakdownSumRub, breakdownMatchesTotal: breakdownSumRub === displayed.totalRub };
          }
        } catch (error) { item.error = String(error?.message || 'error').replace(/https?:\/\/\S+/g, '[url]').slice(0, 250); }
        item.detailNetworkRequests = active.requests.length - detailRequestStart;
        item.after = Object.fromEntries(Object.keys(before).map(key => [key, offer[key]]));
        item.changedFields = Object.keys(before).filter(key => before[key] !== offer[key]);
        // Details may correct the listing year; acceptance uses the final evidence.
        item.yearAllowed = isCatalogYearAllowed(offer.year, market);
        active.details.push(item);
        if (trial && process.env.PILOT_SNAPSHOT_DIR) {
          snapshots.push(catalogTrialSnapshot(preparedOffer || offer));
          await fs.mkdir(process.env.PILOT_SNAPSHOT_DIR, { recursive: true });
          for (let index = 0; index < snapshots.length; index += 500) {
            await fs.writeFile(path.join(process.env.PILOT_SNAPSHOT_DIR, `offers-${String(index / 500 + 1).padStart(4, '0')}.json`),
              JSON.stringify(snapshots.slice(index, index + 500), null, 2) + '\n');
          }
        }
        active.summary = summarizePilotMarket(active);
        await checkpoint({ ...report, currencyRequests, markets: [...report.markets, { ...active, hosts: undefined }] });
      }
      if (result.finished || !result.nextCursor) { active.stopReason = 'source_finished'; break; }
      cursor = result.nextCursor;
    }
    active.summary = summarizePilotMarket(active);
    active.samples = offers.map(offer => ({ sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model,
      year: offer.year, engineCc: offer.engineCc, powerHp: offer.powerHp, fuel: offer.fuel,
      fields: Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(offer, field)])),
    }));
    active.status = active.stopped ? 'stopped_by_source_response' : active.listingRows ? 'listing_received' : 'no_listing_rows';
  } catch (error) {
    active.status = 'blocked_or_failed';
    active.error = String(error?.message || 'unknown_error').replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
  }
  active.summary = summarizePilotMarket(active);
  delete active.hosts;
  report.markets.push(active);
  await checkpoint();
  console.log(JSON.stringify({ market, listingRows: active.listingRows || 0, requests: active.requests.length, priced: (active.details || []).filter(row => row.totalRub > 0).length, status: active.status }));
}
if (!requestedMarkets.has('korea')) report.markets.push({ market: 'korea', status: 'not_attempted', reason: 'Not selected for this run; no inference about source availability.' });
report.completed = true;
await checkpoint();
if (process.env.PILOT_QUIET !== '1') console.log(JSON.stringify(report, null, 2));
