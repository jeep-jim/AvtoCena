import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import {
  detectWorldAutoPublicAccessPolicy,
  extractWorldAutoDeclaredRoutes,
} from './catalog-source-worldauto-access-route-probe-v1.mjs';

const SOURCE_ID = 'worldauto_georgia_candidate';
const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_ASSET_OUTPUT || 'catalog-source-worldauto-declared-asset-route-probe-v1.json';
const USER_AGENT = 'AvtoCenaWorldAutoAssetRouteProbe/1.0 (+bounded read-only declared-asset qualification)';
const TIMEOUT_MS = Math.max(5_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_ASSET_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(150_000, Math.min(1_500_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_ASSET_MAX_BODY_BYTES || 900_000)));
const MAX_SCRIPT_REQUESTS = Math.max(1, Math.min(7, Number(process.env.CATALOG_SOURCE_WORLDAUTO_MAX_SCRIPT_REQUESTS || 7)));
const HEADERS = {
  accept: 'text/html,application/javascript,text/javascript,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

function uniq(values, limit = 200) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function safeRouteLiteral(raw, origin) {
  let value = String(raw || '').trim();
  if (!value || value.length > 320) return '';
  value = value.replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
  if (/^(?:data:|blob:|javascript:|mailto:|tel:)/i.test(value)) return '';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return '';
    const names = uniq([...url.searchParams.keys()], 20);
    return `${url.pathname}${names.length ? `?${names.sort().join('&')}` : ''}`;
  } catch {
    if (!value.startsWith('/')) return '';
    const [path, query = ''] = value.split('?', 2);
    const names = uniq(query.split('&').map((part) => part.split('=')[0]).filter(Boolean), 20);
    return `${path}${names.length ? `?${names.sort().join('&')}` : ''}`;
  }
}

export function extractWorldAutoRouteLiterals(jsText, origin = 'https://worldauto.ge') {
  const literals = [];
  const text = String(jsText || '');
  const stringRe = /(["'`])((?:https?:\\?\/\\?\/[^"'`\\\s]+)|(?:\\?\/[A-Za-z0-9_./:?&=%${}+-]{2,260}))\1/g;
  for (const match of text.matchAll(stringRe)) {
    const route = safeRouteLiteral(match[2], origin);
    if (!route) continue;
    if (/\.(?:js|css|png|jpe?g|svg|gif|webp|woff2?|ttf|ico|map)(?:\?|$)/i.test(route)) continue;
    if (!/(?:api|car|cars|vehicle|vehicles|auto|search|listing|offer|ad(?:vert)?|product)/i.test(route)) continue;
    literals.push(route);
    if (literals.length >= 1200) break;
  }
  const routes = uniq(literals, 300);
  return {
    all: routes,
    apiLike: routes.filter((route) => /(?:^|\/)api(?:\/|$)|graphql|rest\//i.test(route)).slice(0, 120),
    detailLike: routes.filter((route) => /\/(?:car|cars|vehicle|vehicles|auto|listing|offer|ad(?:vert)?)\/(?:[^/?]+\/){0,5}[^/?]+/i.test(route) && !/\/search\//i.test(route)).slice(0, 120),
    searchLike: routes.filter((route) => /search|filter|catalog|list/i.test(route)).slice(0, 120),
  };
}

async function readLimited(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const body = await response.text();
    return { body: body.slice(0, MAX_BODY_BYTES), truncated: body.length > MAX_BODY_BYTES };
  }
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = MAX_BODY_BYTES - total;
    if (remaining <= 0) { truncated = true; break; }
    const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(Buffer.from(slice));
    total += slice.byteLength;
    if (value.byteLength > remaining) { truncated = true; break; }
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated };
}

async function fetchBounded(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const { body, truncated } = await readLimited(response);
  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') || '',
    body,
    truncated,
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
  };
}

async function loadRegistryCandidate() {
  const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
  const candidate = registry.candidates?.find((row) => row.sourceId === SOURCE_ID);
  if (!candidate?.url) throw new Error(`worldauto_registry_candidate_missing:${SOURCE_ID}`);
  return candidate;
}

export async function runWorldAutoDeclaredAssetRouteProbe() {
  const candidate = await loadRegistryCandidate();
  const sourceUrl = candidate.url;
  const origin = new URL(sourceUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const robots = await fetchBounded(robotsUrl);
  const robotsPolicy = robots.ok
    ? evaluateRobots(robots.body, sourceUrl, USER_AGENT)
    : { allowed: true, matchedRule: null, applicableGroupCount: 0 };

  const basePayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'worldauto_declared_asset_route_probe_no_write',
    sourceId: SOURCE_ID,
    sourceUrl,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    detailRequests: 0,
    paginationRequests: 0,
    apiRequests: 0,
    robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
  };

  if (!robotsPolicy.allowed) {
    const payload = { ...basePayload, requestCount: 1, page: null, scripts: [], routeEvidence: null, decisionSignal: 'robots_disallowed', next: 'Stop automated WorldAuto route discovery.' };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const page = await fetchBounded(sourceUrl);
  const publicPolicy = detectWorldAutoPublicAccessPolicy(page.body);
  const declared = extractWorldAutoDeclaredRoutes(page.body, page.finalUrl || sourceUrl, sourceUrl);
  if (publicPolicy.explicitRestrictionObserved) {
    const payload = {
      ...basePayload,
      requestCount: 2,
      page: { status: page.status, bodyHashSha256: page.bodyHashSha256, explicitAutomationRestriction: true },
      scripts: [],
      routeEvidence: null,
      decisionSignal: 'public_terms_block_automated_collection',
      next: 'Do not fetch declared assets for automated route discovery without a permitted data route.',
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const mainScripts = declared.sameOriginScriptUrls
    .filter((url) => /\/main-[^/]+\.js(?:\?|$)/i.test(new URL(url).pathname))
    .slice(0, MAX_SCRIPT_REQUESTS);
  const scripts = [];
  const combined = { all: [], apiLike: [], detailLike: [], searchLike: [] };
  for (const url of mainScripts) {
    const result = await fetchBounded(url);
    const evidence = result.ok ? extractWorldAutoRouteLiterals(result.body, origin) : { all: [], apiLike: [], detailLike: [], searchLike: [] };
    for (const key of Object.keys(combined)) combined[key].push(...evidence[key]);
    scripts.push({
      url,
      status: result.status,
      contentType: result.contentType,
      truncated: result.truncated,
      bodyHashSha256: result.bodyHashSha256,
      routeLiteralCount: evidence.all.length,
      apiLikeCount: evidence.apiLike.length,
      detailLikeCount: evidence.detailLike.length,
      searchLikeCount: evidence.searchLike.length,
    });
  }
  for (const key of Object.keys(combined)) combined[key] = uniq(combined[key], key === 'all' ? 300 : 120);

  const payload = {
    ...basePayload,
    requestCount: 2 + scripts.length,
    scriptRequests: scripts.length,
    page: {
      status: page.status,
      bodyHashSha256: page.bodyHashSha256,
      declaredSameOriginScriptCount: declared.sameOriginScriptUrls.length,
      selectedDeclaredMainScriptCount: mainScripts.length,
      selectedDeclaredMainScripts: mainScripts,
    },
    scripts,
    routeEvidence: combined,
    decisionSignal: combined.apiLike.length || combined.detailLike.length
      ? 'source_declared_route_literals_found'
      : 'no_actionable_route_literal_in_bounded_declared_main_assets',
    next: combined.apiLike.length || combined.detailLike.length
      ? 'Validate only the strongest source-declared route literal with a separate bounded no-write request; do not paginate or broaden automatically.'
      : 'Do not guess hidden endpoints. Reclassify as lead-only unless another public source-declared route becomes available.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    requestCount: payload.requestCount,
    scriptRequests: payload.scriptRequests,
    apiLike: combined.apiLike,
    detailLike: combined.detailLike,
    searchLike: combined.searchLike,
    decisionSignal: payload.decisionSignal,
  }, null, 2));
  return payload;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  runWorldAutoDeclaredAssetRouteProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
