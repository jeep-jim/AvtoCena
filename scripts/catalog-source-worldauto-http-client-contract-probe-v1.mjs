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
const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_HTTP_CLIENT_OUTPUT || 'catalog-source-worldauto-http-client-contract-probe-v1.json';
const USER_AGENT = 'AvtoCenaWorldAutoHttpClientProbe/1.0 (+bounded read-only declared-client qualification)';
const TIMEOUT_MS = Math.max(5_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_HTTP_CLIENT_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(150_000, Math.min(2_000_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_HTTP_CLIENT_MAX_BODY_BYTES || 1_200_000)));
const MAX_SCRIPT_REQUESTS = Math.max(1, Math.min(24, Number(process.env.CATALOG_SOURCE_WORLDAUTO_HTTP_CLIENT_MAX_SCRIPTS || 24)));
const TARGET_MODULE_ID = '47400';
const HEADERS = {
  accept: 'text/html,application/javascript,text/javascript,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

function scrub(value) {
  return String(value || '')
    .replace(/([?&](?:token|auth|key|signature|session|cookie|jwt|access_token)=)[^&"'`\s,)]+/gi, '$1[redacted]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9._-]{20,}/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
}

function unique(values, limit = 50) {
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

export function extractWorldAutoHttpClientSignals(jsText, moduleId = TARGET_MODULE_ID) {
  const text = String(jsText || '');
  const modulePatterns = [
    new RegExp(`(?:^|[,({])${moduleId}:\\s*\\(`),
    new RegExp(`(?:^|[,({])${moduleId}:\\s*function\\b`),
  ];
  let moduleIndex = -1;
  for (const re of modulePatterns) {
    const match = re.exec(text);
    if (match) { moduleIndex = match.index; break; }
  }
  const baseUrlValues = [];
  const candidates = [];
  const source = moduleIndex >= 0 ? text.slice(moduleIndex, Math.min(text.length, moduleIndex + 30_000)) : text;
  for (const match of source.matchAll(/baseURL\s*:\s*["'`]([^"'`]{1,300})["'`]/gi)) baseUrlValues.push(match[1]);
  for (const match of source.matchAll(/https?:\/\/[^"'`\s,)]+/gi)) {
    const value = match[0];
    if (/worldauto|api/i.test(value)) candidates.push(value);
  }
  const axiosCreateObserved = /(?:axios|\.create)\s*\(|\.create\s*\(\s*\{[^}]*baseURL/i.test(source);
  const exportedAyObserved = /\bAy\s*:\s*\(\)|\bAy\s*:/i.test(source) || /e\.d\([^)]*\bAy\b/.test(source);
  const context = moduleIndex >= 0 ? scrub(text.slice(Math.max(0, moduleIndex - 300), Math.min(text.length, moduleIndex + 5000))) : '';
  return {
    moduleFound: moduleIndex >= 0,
    moduleIndex,
    baseUrlValues: unique(baseUrlValues, 20),
    worldAutoOrApiUrls: unique(candidates, 30),
    axiosCreateObserved,
    exportedAyObserved,
    context,
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

export async function runWorldAutoHttpClientContractProbe() {
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
    const payload = { version:1, generatedAt:new Date().toISOString(), mode:'worldauto_http_client_contract_probe_no_write', sourceId:SOURCE_ID, sourceUrl, ...safety, requestCount:1, scriptRequests:0, robots:{status:robots.status,bodyHashSha256:robots.bodyHashSha256,policy:robotsPolicy}, page:null, scripts:[], client:null, decisionSignal:'robots_disallowed', next:'Stop.' };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload,null,2));
    return payload;
  }

  const page = await fetchBounded(sourceUrl);
  const policy = detectWorldAutoPublicAccessPolicy(page.body);
  const declared = extractWorldAutoDeclaredRoutes(page.body, page.finalUrl || sourceUrl, sourceUrl);
  if (policy.explicitRestrictionObserved) {
    const payload = { version:1, generatedAt:new Date().toISOString(), mode:'worldauto_http_client_contract_probe_no_write', sourceId:SOURCE_ID, sourceUrl, ...safety, requestCount:2, scriptRequests:0, robots:{status:robots.status,bodyHashSha256:robots.bodyHashSha256,policy:robotsPolicy}, page:{status:page.status,bodyHashSha256:page.bodyHashSha256}, scripts:[], client:null, decisionSignal:'public_terms_block_automated_collection', next:'Stop.' };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload,null,2));
    return payload;
  }

  // Prioritize application bundles before generic vendors, but every request stays source-declared and same-origin.
  const selected = [...declared.sameOriginScriptUrls].sort((a,b) => {
    const pa = /\/main-/i.test(new URL(a).pathname) ? 0 : /\/vendors-/i.test(new URL(a).pathname) ? 1 : 2;
    const pb = /\/main-/i.test(new URL(b).pathname) ? 0 : /\/vendors-/i.test(new URL(b).pathname) ? 1 : 2;
    return pa - pb;
  }).slice(0, MAX_SCRIPT_REQUESTS);
  const scripts = [];
  let client = null;
  for (const url of selected) {
    const result = await fetchBounded(url);
    const signals = result.ok ? extractWorldAutoHttpClientSignals(result.body) : { moduleFound:false, baseUrlValues:[], worldAutoOrApiUrls:[], axiosCreateObserved:false, exportedAyObserved:false, context:'' };
    scripts.push({url,status:result.status,truncated:result.truncated,bodyHashSha256:result.bodyHashSha256,moduleFound:signals.moduleFound});
    if (signals.moduleFound) {
      client = { scriptUrl:url, ...signals };
      break;
    }
  }
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'worldauto_http_client_contract_probe_no_write',
    sourceId: SOURCE_ID,
    sourceUrl,
    ...safety,
    requestCount: 2 + scripts.length,
    scriptRequests: scripts.length,
    robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
    page: { status: page.status, bodyHashSha256: page.bodyHashSha256, declaredScriptCount: declared.sameOriginScriptUrls.length },
    scripts,
    client,
    decisionSignal: client?.moduleFound ? 'http_client_module_found' : 'http_client_module_not_found_in_bounded_declared_assets',
    next: client?.baseUrlValues?.length || client?.worldAutoOrApiUrls?.length
      ? 'Use only the source-declared client base plus /search/sell/car/get in a separate no-param GET probe; do not invent params.'
      : 'Do not request the route yet; base transport is not proven.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload,null,2));
  console.log(JSON.stringify({output:OUTPUT_PATH, requestCount:payload.requestCount, scriptRequests:payload.scriptRequests, client:client ? {scriptUrl:client.scriptUrl,baseUrlValues:client.baseUrlValues,worldAutoOrApiUrls:client.worldAutoOrApiUrls,axiosCreateObserved:client.axiosCreateObserved,exportedAyObserved:client.exportedAyObserved}:null, decisionSignal:payload.decisionSignal},null,2));
  return payload;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  runWorldAutoHttpClientContractProbe().catch((error)=>{console.error(error);process.exitCode=1;});
}
