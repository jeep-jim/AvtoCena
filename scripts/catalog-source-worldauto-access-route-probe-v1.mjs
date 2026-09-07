import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const SOURCE_ID = 'worldauto_georgia_candidate';
const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_ACCESS_OUTPUT || 'catalog-source-worldauto-access-route-probe-v1.json';
const USER_AGENT = 'AvtoCenaWorldAutoQualificationProbe/1.0 (+bounded read-only source qualification)';
const TIMEOUT_MS = Math.max(5_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(150_000, Math.min(1_500_000, Number(process.env.CATALOG_SOURCE_WORLDAUTO_MAX_BODY_BYTES || 900_000)));
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

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

export function visibleText(html, limit = 350_000) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

const AUTOMATION_WORD_RE = /(?:scrap(?:e|ing)|crawl(?:er|ing)?|automated?\s+(?:access|collection|request)|bot(?:s)?|парсинг|скрапинг|краулинг|автоматиз(?:ированн|ация)|бот(?:ы|ов)?)/i;
const PROHIBITION_WORD_RE = /(?:prohibit(?:ed|s)?|forbidden|not\s+allowed|must\s+not|may\s+not|unauthori[sz]ed|запрещ(?:ен|ена|ено|ены|ается)|нельзя|не\s+разреш(?:ен|ена|ено|ается)|без\s+разрешения)/i;

export function detectWorldAutoPublicAccessPolicy(html) {
  const text = visibleText(html);
  const windows = [];
  const re = new RegExp(AUTOMATION_WORD_RE.source, 'ig');
  for (const match of text.matchAll(re)) {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(text.length, match.index + match[0].length + 220);
    windows.push(text.slice(start, end));
    if (windows.length >= 20) break;
  }
  const restrictionWindows = windows.filter((window) => PROHIBITION_WORD_RE.test(window));
  return {
    automationLanguageObserved: windows.length > 0,
    explicitRestrictionObserved: restrictionWindows.length > 0,
    matchedWindowCount: restrictionWindows.length,
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

function uniq(values, limit = 120) {
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

function isPolicyLike(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return /(?:terms|conditions|rules|policy|privacy|agreement|legal|usage|use)/.test(p);
  } catch {
    return false;
  }
}

function isDetailLike(url, registryUrl) {
  try {
    const parsed = new URL(url);
    const registry = new URL(registryUrl);
    if (parsed.origin !== registry.origin || parsed.href === registry.href) return false;
    const path = parsed.pathname.toLowerCase();
    if (/\/search\/car(?:\/|$)/.test(path)) return false;
    return /\/(?:car|cars|auto|vehicle|vehicles)\/(?:[^/]+\/){0,4}[^/]+$/i.test(path);
  } catch {
    return false;
  }
}

export function extractWorldAutoDeclaredRoutes(html, pageUrl, registryUrl = pageUrl) {
  const origin = new URL(pageUrl).origin;
  const anchors = [];
  const scripts = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(match[1], pageUrl);
    if (!url || new URL(url).origin !== origin) continue;
    anchors.push(url);
  }
  for (const match of String(html || '').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(match[1], pageUrl);
    if (!url || new URL(url).origin !== origin) continue;
    scripts.push(url);
  }
  const sameOriginAnchors = uniq(anchors, 120);
  return {
    sameOriginAnchors,
    policyLinks: sameOriginAnchors.filter(isPolicyLike).slice(0, 20),
    detailLikeRouteCandidates: sameOriginAnchors.filter((url) => isDetailLike(url, registryUrl)).slice(0, 40),
    sameOriginScriptUrls: uniq(scripts, 40),
    frameworkSignals: {
      nextData: /<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["']/i.test(String(html || '')),
      nextAssets: /\/_next\//i.test(String(html || '')),
      nuxtAssets: /\/_nuxt\//i.test(String(html || '')) || /__NUXT__/i.test(String(html || '')),
    },
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

export async function runWorldAutoAccessRouteProbe() {
  const candidate = await loadRegistryCandidate();
  const sourceUrl = candidate.url;
  const sourceOrigin = new URL(sourceUrl).origin;
  const robotsUrl = `${sourceOrigin}/robots.txt`;

  // Permission-first and deliberately bounded: robots.txt + only the registry-declared search page.
  // No detail fetch, pagination, script fetch, API guessing or storage/publication writes.
  const robots = await fetchBounded(robotsUrl);
  const robotsPolicy = robots.ok
    ? evaluateRobots(robots.body, sourceUrl, USER_AGENT)
    : { allowed: true, matchedRule: null, applicableGroupCount: 0 };

  if (!robotsPolicy.allowed) {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'worldauto_access_route_probe_no_write',
      sourceId: SOURCE_ID,
      sourceUrl,
      productionWrites: false,
      classificationMutations: false,
      publishAllowedMutations: false,
      objectStorageWrites: false,
      catalogGenerationWrites: false,
      rawBodiesStored: false,
      guessedRoutes: false,
      requestCount: 1,
      detailRequests: 0,
      paginationRequests: 0,
      scriptRequests: 0,
      robots: { status: robots.status, bodyHashSha256: robots.bodyHashSha256, policy: robotsPolicy },
      page: null,
      decisionSignal: 'robots_disallowed',
      next: 'Stop automated qualification on this route unless WorldAuto provides a permitted API/partner route.',
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify({ output: OUTPUT_PATH, decisionSignal: payload.decisionSignal, requestCount: 1 }, null, 2));
    return payload;
  }

  const page = await fetchBounded(sourceUrl);
  const policy = detectWorldAutoPublicAccessPolicy(page.body);
  const routes = extractWorldAutoDeclaredRoutes(page.body, page.finalUrl || sourceUrl, sourceUrl);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'worldauto_access_route_probe_no_write',
    sourceId: SOURCE_ID,
    sourceUrl,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    requestCount: 2,
    detailRequests: 0,
    paginationRequests: 0,
    scriptRequests: 0,
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
      explicitAutomationRestriction: policy.explicitRestrictionObserved,
      automationLanguageObserved: policy.automationLanguageObserved,
      sameOriginAnchorCount: routes.sameOriginAnchors.length,
      policyLinks: routes.policyLinks,
      detailLikeRouteCandidates: routes.detailLikeRouteCandidates,
      sameOriginScriptUrls: routes.sameOriginScriptUrls,
      frameworkSignals: routes.frameworkSignals,
    },
    decisionSignal: policy.explicitRestrictionObserved
      ? 'public_terms_block_automated_collection'
      : (page.ok ? (routes.policyLinks.length ? 'review_declared_policy_link_before_detail_probe' : 'registry_page_accessible_no_explicit_restriction_observed') : `http_${page.status}`),
    next: policy.explicitRestrictionObserved
      ? 'Do not automate WorldAuto public inventory without a permitted API/partner route or written authorization.'
      : routes.policyLinks.length
        ? 'Fetch only a source-declared policy link in the next bounded no-write step before any detail route.'
        : routes.detailLikeRouteCandidates.length
          ? 'Probe at most two source-declared detail-like URLs next; do not paginate or guess APIs.'
          : 'No source-declared detail route was proven in the registry HTML; inspect only declared same-origin assets in a separate bounded no-write route-discovery step.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    pageStatus: page.status,
    decisionSignal: payload.decisionSignal,
    policyLinkCount: routes.policyLinks.length,
    detailLikeRouteCandidateCount: routes.detailLikeRouteCandidates.length,
    sameOriginScriptCount: routes.sameOriginScriptUrls.length,
    requestCount: payload.requestCount,
  }, null, 2));
  return payload;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  runWorldAutoAccessRouteProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
