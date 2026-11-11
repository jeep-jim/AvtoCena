import { publicResponseChallenge } from "./lib/public-response-challenge.mjs";
import fs from 'node:fs/promises';

// One public listing GET per source. No details, image downloads or publication.
const fetchOriginal = globalThis.fetch;
let active;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  if (!active || active.requests.length >= 1 || method !== 'GET'
    || url.protocol !== 'https:' || !active.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('pilot_request_outside_envelope');
  }
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
  if (headers.has('authorization') || headers.has('cookie')) throw new Error('pilot_credentials_not_allowed');
  const event = { origin: url.origin, path: url.pathname, method, status: null };
  active.requests.push(event);
  const response = await fetchOriginal(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  event.status = response.status;
  event.contentType = response.headers.get('content-type');
  if ([401, 403, 429].includes(response.status)) throw new Error(`pilot_stop_http_${response.status}`);
  if (response.status >= 300 && response.status < 400) throw new Error('pilot_redirect_requires_review');
  const body = await response.clone().text();
  if (publicResponseChallenge(body)) throw new Error('pilot_challenge_stop');
  return response;
};

const sources = [
  ['korea', 'encar-complete-source', 'encarCompleteSource', ['encar.com']],
  ['europe', 'mobile-de-exact-source', 'mobileDeExactSource', ['mobile.de']],
  ['china', 'che168-global-exact-source', 'che168GlobalExactSource', ['che168.com']],
  process.env.PILOT_UAE_SOURCE === 'dubicars' ? ['uae', 'dubicars-current-source', 'dubicarsUaeCurrentSource', ['dubicars.com']] : ['uae', 'dubizzle-exact-source', 'dubizzleUaeExactSource', ['dubizzle.com']],
  ['georgia', 'autopapa-georgia-source', 'autoPapaGeorgiaSource', ['autopapa.ge']],
];
const report = { version: 1, checkedAt: new Date().toISOString(), productionWrites: false,
  japanRequests: 0, detailsRequested: false, pricesCalculated: false, maxRequestsPerSource: 1, markets: [],
  limitation: 'First listing response only, not a complete collection or calculation acceptance test. Network/proxy errors do not prove source unavailability.' };
const requestedMarkets = new Set(String(process.env.PILOT_MARKETS || 'europe,china,uae,georgia').split(','));
const { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } = await import('../apps/web/lib/catalog/specification-evidence-audit.ts');
for (const [market, module, name, hosts] of sources.filter(([market]) => requestedMarkets.has(market))) {
  active = { market, hosts, requests: [] };
  try {
    const source = (await import(`../apps/web/lib/catalog/${module}.ts`))[name];
    active.sourceId = source.sourceId;
    const result = await source.fetchPage('1');
    active.listingRows = result.items?.length || 0;
    const offers = (result.items || []).slice(0, 20).map(row => source.normalizeOffer(row)).filter(Boolean);
    active.normalizedRows = offers.length;
    active.samples = offers.map(offer => ({ sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model,
      year: offer.year, engineCc: offer.engineCc, powerHp: offer.powerHp, fuel: offer.fuel,
      fields: Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(offer, field)])),
    }));
    active.status = active.listingRows ? 'listing_received' : 'no_listing_rows';
  } catch (error) {
    active.status = 'blocked_or_failed';
    active.error = String(error?.message || 'unknown_error').replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
  }
  delete active.hosts;
  report.markets.push(active);
}
if (!requestedMarkets.has('korea')) report.markets.push({ market: 'korea', status: 'not_attempted', reason: 'Not selected for this run; no inference about source availability.' });
await fs.writeFile(process.env.PILOT_REPORT || 'data/catalog/research/public-listing-pilot-v1-20260906.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
