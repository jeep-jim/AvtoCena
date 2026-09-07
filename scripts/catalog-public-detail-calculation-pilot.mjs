import { publicResponseChallenge } from "./lib/public-response-challenge.mjs";
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { summarizePilotMarket, boundedPilotInteger } from './lib/catalog-pilot-summary.mjs';

// Bounded public listing and detail diagnostic; no image downloads or publication.
// KCar's existing public search POST is allowed only on its exact search route.
process.env.JSON_STORAGE_DRIVER = 'local';
process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
const fetchOriginal = globalThis.fetch;
const sampleLimit = boundedPilotInteger(process.env.PILOT_SAMPLE_LIMIT, 3, 50);
const pageLimit = boundedPilotInteger(process.env.PILOT_PAGE_LIMIT, 1, 5);
const requestLimit = boundedPilotInteger(process.env.PILOT_REQUEST_LIMIT, 8, 100);
const timeoutMs = Math.max(1000, Math.min(45000, Number(process.env.PILOT_TIMEOUT_MS || 15000)));
process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = '1';
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES = '1';
let currencyRequests = 0;
let active;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(url.pathname)) throw new Error('diagnostic_image_download_blocked');
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  if (url.href === 'https://www.cbr.ru/scripts/XML_daily.asp' && method === 'GET' && currencyRequests++ === 0) return fetchOriginal(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!active || active.stopped || active.requests.length >= requestLimit || (method !== 'GET' && !(method === 'POST' && url.hostname.endsWith('.kcar.com') && url.pathname === '/bc/search/list/drct'))
    || url.protocol !== 'https:' || !active.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('pilot_request_outside_envelope');
  }
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
  if (headers.has('authorization') || headers.has('cookie')) throw new Error('pilot_credentials_not_allowed');
  const event = { origin: url.origin, path: url.pathname, method, status: null };
  active.requests.push(event);
  const response = await fetchOriginal(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  event.status = response.status;
  event.contentType = response.headers.get('content-type');
  if ([401, 403, 429].includes(response.status)) { active.stopped = true; throw new Error(`pilot_stop_http_${response.status}`); }
  if (response.status >= 300 && response.status < 400) throw new Error('pilot_redirect_requires_review');
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
  process.env.PILOT_UAE_SOURCE === 'carswitch' ? ['uae', 'carswitch-exact-source', 'carswitchUaeExactSource', ['carswitch.com']] : process.env.PILOT_UAE_SOURCE === 'dubicars' ? ['uae', 'dubicars-current-source', 'dubicarsUaeCurrentSource', ['dubicars.com']] : ['uae', 'dubizzle-exact-source', 'dubizzleUaeExactSource', ['dubizzle.com']],
  process.env.PILOT_GEORGIA_SOURCE === 'myauto' ? ['georgia', 'myauto-list-source', 'myAutoListSource', ['myauto.ge']] : ['georgia', 'autopapa-georgia-source', 'autoPapaGeorgiaSource', ['autopapa.ge']],
];
const report = { version: 3, completed: false, checkedAt: new Date().toISOString(), productionWrites: false,
  japanRequests: 0, detailsRequested: true, pricesCalculated: true, maxRequestsPerSource: requestLimit, sampleLimit, pageLimit, markets: [],
  limitation: 'Bounded sample per source; local repository business settings, not an attestation of production settings. Not a complete collection or publication acceptance test. Network/proxy errors do not prove source unavailability.' };
const outputPath = process.env.PILOT_REPORT || 'data/catalog/research/public-detail-calculation-pilot-v1-20260906.json';
async function checkpoint(snapshot = report) {
  report.currencyRequests = currencyRequests;
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2) + '\n');
}
const requestedMarkets = new Set(String(process.env.PILOT_MARKETS || 'europe,china,uae').split(','));
const { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } = await import('../apps/web/lib/catalog/specification-evidence-audit.ts');
const { isCatalogYearAllowed } = await import('../apps/web/lib/catalog/offer-quality.ts');
const { getJsonStorage } = await import('../apps/web/lib/data.ts');
const storage = getJsonStorage();
for (const method of ['writeJson', 'writeJsonIfMatch', 'deleteObject', 'deleteObjects', 'deletePrefix', 'putBinary']) storage[method] = async () => { throw new Error('diagnostic_storage_write_blocked'); };
const { calculateOfferWithVerifiedSpecifications } = await import('../apps/web/lib/catalog/customs-pricing.ts');
for (const [market, module, name, hosts] of sources.filter(([market]) => requestedMarkets.has(market))) {
  active = { market, hosts, requests: [] };
  try {
    const source = (await import(`../apps/web/lib/catalog/${module}.ts`))[name];
    active.sourceId = source.sourceId;
    const offers = [];
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
        if (offers.length >= sampleLimit || active.stopped || active.requests.length >= requestLimit) continue;
        offers.push(offer);
        const before = { year: offer.year, fuel: offer.fuel, engineCc: offer.engineCc, powerHp: offer.powerHp, sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency };
        const item = { sourceOfferId: offer.sourceOfferId, yearAllowed: isCatalogYearAllowed(offer.year, market), before };
        const detailRequestStart = active.requests.length;
        try {
          offer.images = await source.fetchImages(offer);
          item.images = offer.images.length;
          if (process.env.PILOT_RESPONSE_EVIDENCE === '1' && market === 'china') {
            const raw = offer.operational?.raw || {};
            item.sourceWitness = { detailId: raw.detail?.infoid, specId: raw.detail?.specid,
              apiEngine: raw.detail?.engine, apiFuel: raw.detail?.fuelname,
              boundParameters: raw.boundPageParameters || null, semanticEvidence: offer.operational?.semanticEvidence };
          }
          item.fields = Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(offer, field)]));
          const priced = await calculateOfferWithVerifiedSpecifications(offer);
          item.totalRub = priced.totalRub;
          item.calculationStatus = priced.calculationStatus;
          item.breakdown = priced.calculationSnapshot?.breakdown;
          item.currencyRate = priced.calculationSnapshot?.currencyRate;
          item.eurRate = priced.calculationSnapshot?.eurRate;
        } catch (error) { item.error = String(error?.message || 'error').replace(/https?:\/\/\S+/g, '[url]').slice(0, 250); }
        item.detailNetworkRequests = active.requests.length - detailRequestStart;
        item.after = Object.fromEntries(Object.keys(before).map(key => [key, offer[key]]));
        item.changedFields = Object.keys(before).filter(key => before[key] !== offer[key]);
        // Details may correct the listing year; acceptance uses the final evidence.
        item.yearAllowed = isCatalogYearAllowed(offer.year, market);
        active.details.push(item);
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
console.log(JSON.stringify(report, null, 2));
