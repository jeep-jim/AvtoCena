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
const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_CALLSITE_OUTPUT || 'catalog-source-worldauto-route-callsite-probe-v1.json';
const USER_AGENT = 'AvtoCenaWorldAutoCallsiteProbe/1.0 (+bounded read-only declared-callsite qualification)';
const TIMEOUT_MS = Math.max(5_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_CALLSITE_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(150_000, Math.min(1_500_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_CALLSITE_MAX_BODY_BYTES || 900_000)));
const MAX_SCRIPT_REQUESTS = Math.max(1, Math.min(7, Number(process.env.CATALOG_SOURCE_WORLDAUTO_CALLSITE_MAX_SCRIPTS || 7)));
const TARGET_ROUTES = ['/car/get', '/sell/car/get'];
const HEADERS = {
  accept: 'text/html,application/javascript,text/javascript,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

function uniq(values, limit = 100) {
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

function scrubContext(value) {
  return String(value || '')
    .replace(/([?&](?:token|auth|key|signature|session|cookie|jwt|access_token)=)[^&"'`\s,)]+/gi, '$1[redacted]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9._-]{20,}/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .slice(0, 1200);
}

function methodSignals(context, literalIndex) {
  const before = context.slice(Math.max(0, literalIndex - 260), literalIndex + 40);
  const after = context.slice(literalIndex, Math.min(context.length, literalIndex + 300));
  const whole = `${before} ${after}`;
  const methods = [];
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (new RegExp(`(?:\\.${method.toLowerCase()}\\s*\\(|method\\s*:\\s*["']${method}["']|method\\s*:\\s*["']${method.toLowerCase()}["'])`, 'i').test(whole)) methods.push(method);
  }
  return uniq(methods, 10);
}

function nearbyKeys(context) {
  const keys = [];
  for (const match of context.matchAll(/(?:params|query|body|data)\s*:\s*\{([^{}]{0,500})\}/gi)) {
    for (const key of match[1].matchAll(/([A-Za-z_][A-Za-z0-9_]{1,48})\s*:/g)) keys.push(key[1]);
  }
  for (const match of context.matchAll(/[?&]([A-Za-z_][A-Za-z0-9_]{1,48})=/g)) keys.push(match[1]);
  return uniq(keys, 40).sort();
}

export function extractWorldAutoCallsites(jsText, routes = TARGET_ROUTES) {
  const text = String(jsText || '');
  const out = [];
  for (const route of routes) {
    let cursor = 0;
    while (cursor < text.length) {
      const index = text.indexOf(route, cursor);
      if (index < 0) break;
      const start = Math.max(0, index - 450);
      const end = Math.min(text.length, index + route.length + 550);
      const contextRaw = text.slice(start, end);
      const literalIndex = index - start;
      out.push({
        route,
        methodSignals: methodSignals(contextRaw, literalIndex),
        nearbyParameterKeys: nearbyKeys(contextRaw),
        context: scrubContext(contextRaw),
      });
      cursor = index + route.length;
      if (out.length >= 30) return out;
    }
  }
  return out;
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

export async function runWorldAutoRouteCallsiteProbe() {
  const candidate = await loadRegistryCandidate();
  const sourceUrl = candidate.url;
  const origin = new URL(sourceUrl).origin;
  const robots = await fetchBounded(`${origin}/robots.txt`);
  const robotsPolicy = robots.ok
    ? evaluateRobots(robots.body, sourceUrl, USER_AGENT)
    : { allowed: true, matchedRule: null, applicableGroupCount: 0 };

  const safety = {
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
  };

  if (!robotsPolicy.allowed) {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'worldauto_route_callsite_probe_no_write',
      sourceId: SOURCE_ID,
      sourceUrl,
      ...safety,
      requestCount: 1,
      scriptRequests: 0,
      robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
      page: null,
      scripts: [],
      callsites: [],
      decisionSignal: 'robots_disallowed',
      next: 'Stop WorldAuto automated qualification.',
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const page = await fetchBounded(sourceUrl);
  const policy = detectWorldAutoPublicAccessPolicy(page.body);
  const declared = extractWorldAutoDeclaredRoutes(page.body, page.finalUrl || sourceUrl, sourceUrl);
  if (policy.explicitRestrictionObserved) {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'worldauto_route_callsite_probe_no_write',
      sourceId: SOURCE_ID,
      sourceUrl,
      ...safety,
      requestCount: 2,
      scriptRequests: 0,
      robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
      page: { status: page.status, bodyHashSha256: page.bodyHashSha256, explicitAutomationRestriction: true },
      scripts: [],
      callsites: [],
      decisionSignal: 'public_terms_block_automated_collection',
      next: 'Do not inspect WorldAuto assets for automated ingestion.',
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const selected = declared.sameOriginScriptUrls
    .filter((url) => /\/main-[^/]+\.js(?:\?|$)/i.test(new URL(url).pathname))
    .slice(0, MAX_SCRIPT_REQUESTS);
  const scripts = [];
  const callsites = [];
  for (const url of selected) {
    const result = await fetchBounded(url);
    const found = result.ok ? extractWorldAutoCallsites(result.body) : [];
    scripts.push({
      url,
      status: result.status,
      truncated: result.truncated,
      bodyHashSha256: result.bodyHashSha256,
      callsiteCount: found.length,
    });
    for (const row of found) callsites.push({ scriptUrl: url, ...row });
  }

  const targetSummary = TARGET_ROUTES.map((route) => {
    const rows = callsites.filter((row) => row.route === route);
    return {
      route,
      occurrences: rows.length,
      methodSignals: uniq(rows.flatMap((row) => row.methodSignals), 10),
      nearbyParameterKeys: uniq(rows.flatMap((row) => row.nearbyParameterKeys), 50).sort(),
    };
  });
  const actionable = targetSummary.some((row) => row.occurrences > 0 && (row.methodSignals.length > 0 || row.nearbyParameterKeys.length > 0));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'worldauto_route_callsite_probe_no_write',
    sourceId: SOURCE_ID,
    sourceUrl,
    ...safety,
    requestCount: 2 + scripts.length,
    scriptRequests: scripts.length,
    robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
    page: {
      status: page.status,
      bodyHashSha256: page.bodyHashSha256,
      selectedDeclaredMainScripts: selected,
    },
    scripts,
    targetSummary,
    callsites: callsites.slice(0, 20),
    decisionSignal: actionable ? 'declared_route_callsite_contract_signal_found' : (callsites.length ? 'route_literal_found_without_request_contract' : 'target_route_literal_not_found_in_current_declared_assets'),
    next: actionable
      ? 'Validate only one route whose method/parameter contract is source-declared; no pagination and no guessed values.'
      : 'Do not request /car/get or /sell/car/get yet; the request contract is not proven.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    requestCount: payload.requestCount,
    targetSummary,
    decisionSignal: payload.decisionSignal,
  }, null, 2));
  return payload;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  runWorldAutoRouteCallsiteProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
