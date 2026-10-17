import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const SOURCE_ID = 'kbchachacha_korea_candidate';
const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_KBCHACHACHA_POLICY_OUTPUT || 'catalog-source-kbchachacha-access-policy-probe-v1.json';
const USER_AGENT = 'AvtoCenaKBQualificationProbe/1.0 (+bounded read-only access-policy qualification)';
const TIMEOUT_MS = Math.max(5_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_KBCHACHACHA_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(100_000, Math.min(1_000_000, Number(process.env.CATALOG_SOURCE_KBCHACHACHA_MAX_BODY_BYTES || 700_000)));
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const SCRAPING_PROHIBITION_RE = /(?:무단\s*복제[\s\S]{0,120}?스크래핑[\s\S]{0,120}?(?:금지|엄격히\s*금지)|스크래핑[\s\S]{0,120}?(?:금지|엄격히\s*금지))/i;
const AUTOMATION_PROHIBITION_RE = /(?:무단[\s\S]{0,160}?(?:자동|로봇|크롤링|스크래핑)[\s\S]{0,160}?(?:금지|제한)|(?:크롤링|스크래핑)[\s\S]{0,160}?(?:금지|제한))/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (token, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : token;
    });
}

export function visibleText(html, limit = 300_000) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function detectKbPublicAccessPolicy(html) {
  const text = visibleText(html);
  const scrapingProhibited = SCRAPING_PROHIBITION_RE.test(text);
  const automationRestricted = AUTOMATION_PROHIBITION_RE.test(text);
  return {
    scrapingProhibited,
    automationRestricted,
    explicitRestrictionObserved: scrapingProhibited || automationRestricted,
  };
}

function absolute(value, baseUrl) {
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function extractKbDeclaredSameOriginRoutes(html, pageUrl, limit = 40) {
  const origin = new URL(pageUrl).origin;
  const out = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(match[1], pageUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== origin || !/\.kbc(?:$|\?)/i.test(`${parsed.pathname}${parsed.search}`)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
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
  if (!candidate?.url) throw new Error(`kb_registry_candidate_missing:${SOURCE_ID}`);
  return candidate;
}

export async function runKbChaChaChaAccessPolicyProbe() {
  const candidate = await loadRegistryCandidate();
  const sourceUrl = candidate.url;
  const sourceOrigin = new URL(sourceUrl).origin;
  const robotsUrl = `${sourceOrigin}/robots.txt`;

  // Deliberately bounded: exactly robots.txt + the registry-declared public page.
  // No script following, detail fetching, AJAX discovery, pagination or crawling.
  const robots = await fetchBounded(robotsUrl);
  const robotsPolicy = robots.ok ? evaluateRobots(robots.body, sourceUrl, USER_AGENT) : { allowed: true, matchedRule: null, applicableGroupCount: 0 };
  if (!robotsPolicy.allowed) {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'kbchachacha_access_policy_probe_no_write',
      sourceId: SOURCE_ID,
      sourceUrl,
      productionWrites: false,
      classificationMutations: false,
      publishAllowedMutations: false,
      objectStorageWrites: false,
      catalogGenerationWrites: false,
      rawBodiesStored: false,
      requestCount: 1,
      detailRequests: 0,
      paginationRequests: 0,
      robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
      page: null,
      decisionSignal: 'robots_disallowed',
      next: 'Do not automate this source route unless a permitted API/partner route is provided.',
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify({ output: OUTPUT_PATH, decisionSignal: payload.decisionSignal, requestCount: 1 }, null, 2));
    return payload;
  }

  const page = await fetchBounded(sourceUrl);
  const policy = detectKbPublicAccessPolicy(page.body);
  const declaredRoutes = extractKbDeclaredSameOriginRoutes(page.body, page.finalUrl || sourceUrl);
  const text = visibleText(page.body);
  const inventoryMatch = text.match(/(?:전체등록\s*매물|전체|검색결과)?\s*([\d,]{4,})\s*대/);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'kbchachacha_access_policy_probe_no_write',
    sourceId: SOURCE_ID,
    sourceUrl,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    requestCount: 2,
    detailRequests: 0,
    paginationRequests: 0,
    externalScriptRequests: 0,
    robots: {
      status: robots.status,
      bodyHashSha256: robots.bodyHashSha256,
      policy: robotsPolicy,
    },
    page: {
      status: page.status,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      truncated: page.truncated,
      bodyHashSha256: page.bodyHashSha256,
      explicitPublicScrapingRestriction: policy.scrapingProhibited,
      explicitAutomationRestriction: policy.automationRestricted,
      explicitRestrictionObserved: policy.explicitRestrictionObserved,
      visibleInventoryCount: inventoryMatch ? Number(inventoryMatch[1].replace(/,/g, '')) : null,
      declaredSameOriginRoutes: declaredRoutes,
    },
    decisionSignal: policy.explicitRestrictionObserved ? 'public_terms_block_automated_collection' : (page.ok ? 'policy_not_explicit_on_registry_page' : `http_${page.status}`),
    next: policy.explicitRestrictionObserved
      ? 'Treat KB ChaChaCha as manual/lead-only unless an explicitly permitted API, partner feed or written authorization is available. Do not follow detail routes or paginate automatically.'
      : 'No automated promotion from this probe alone; separately review permitted-access documentation before any detail-route test.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    pageStatus: page.status,
    explicitRestrictionObserved: policy.explicitRestrictionObserved,
    visibleInventoryCount: payload.page.visibleInventoryCount,
    declaredRouteCount: declaredRoutes.length,
    decisionSignal: payload.decisionSignal,
    requestCount: payload.requestCount,
  }, null, 2));
  return payload;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  runKbChaChaChaAccessPolicyProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
