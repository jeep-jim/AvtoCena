import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-carswitch-live-detail-field-gap-v2.json';
const ORIGIN = 'https://carswitch.com';
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const DETAIL_SITEMAP = `${ORIGIN}/sitemap/detail_pages.xml`;
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 25000;
const MAX_BYTES = 2_000_000;
const MAX_DETAIL_ATTEMPTS = 3;

const headers = {
  'user-agent': UA,
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function readLimited(response, maxBytes = MAX_BYTES) {
  if (!response.body) return { text: '', bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    if (bytes >= maxBytes) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString('utf8'), bytes: buffer.length, truncated };
}

async function get(url, accept = 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5') {
  const response = await fetch(url, {
    headers: { ...headers, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readLimited(response);
  return {
    url,
    finalUrl: response.url || url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    body: body.text,
    capturedBytes: body.bytes,
    truncated: body.truncated,
    hashSha256: crypto.createHash('sha256').update(body.text).digest('hex'),
  };
}

function parseRobots(text) {
  let active = false;
  let crawlDelay = null;
  const rules = [];
  const sitemaps = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') { active = value === '*'; continue; }
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (!active) continue;
    if (key === 'crawl-delay' && /^\d+(?:\.\d+)?$/.test(value)) crawlDelay = Number(value);
    if ((key === 'allow' || key === 'disallow') && value) rules.push({ type: key, value });
  }
  return { rules, crawlDelay, sitemaps };
}

function pathAllowed(url, robots) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const matches = robots.rules.flatMap((rule) => {
    const anchored = rule.value.endsWith('$');
    const raw = anchored ? rule.value.slice(0, -1) : rule.value;
    const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try {
      return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path) ? [rule] : [];
    } catch {
      return [];
    }
  }).sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
  return !matches[0] || matches[0].type === 'allow';
}

function locs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((m) => m[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
}

function clean(text) {
  return String(text || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
}

function h1Of(html) {
  return clean(String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').slice(0, 300);
}

function boundedMatches(text, regex, limit = 8) {
  const source = String(text || '');
  const out = [];
  for (const match of source.matchAll(regex)) {
    const start = Math.max(0, (match.index || 0) - 100);
    const end = Math.min(source.length, (match.index || 0) + match[0].length + 160);
    const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!out.includes(snippet)) out.push(snippet);
    if (out.length >= limit) break;
  }
  return out;
}

function jsonLdObjects(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) out.push(...parsed); else out.push(parsed);
    } catch {}
  }
  return out;
}

function flattenKeys(value, prefix = '', out = new Set(), depth = 0) {
  if (value == null || depth > 5) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) flattenKeys(item, prefix, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    out.add(next);
    flattenKeys(child, next, out, depth + 1);
  }
  return out;
}

const result = {
  version: 2,
  generatedAt: new Date().toISOString(),
  sourceId: 'carswitch_uae_candidate',
  mode: 'permission_first_source_declared_live_detail_retry_no_write',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  sitemapRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
  detailAttempts: [],
};

try {
  const robotsResp = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequests = 1;
  if (!robotsResp.ok) throw new Error(`robots_http_${robotsResp.status}`);
  const robots = parseRobots(robotsResp.body);
  result.robots = {
    status: robotsResp.status,
    hashSha256: robotsResp.hashSha256,
    crawlDelaySeconds: robots.crawlDelay,
    detailSitemapDeclared: robots.sitemaps.includes(DETAIL_SITEMAP),
  };
  if (!robots.sitemaps.includes(DETAIL_SITEMAP)) throw new Error('detail_sitemap_not_declared');
  if (!pathAllowed(DETAIL_SITEMAP, robots)) throw new Error('detail_sitemap_disallowed');

  const delayMs = Math.max(15000, Math.ceil((robots.crawlDelay || 0) * 1000));
  await sleep(delayMs);
  const sitemapResp = await get(DETAIL_SITEMAP, 'application/xml,text/xml,*/*;q=0.5');
  result.requestCount += 1;
  result.sitemapRequests = 1;
  if (!sitemapResp.ok) throw new Error(`sitemap_http_${sitemapResp.status}`);

  const allLocs = locs(sitemapResp.body);
  const candidates = allLocs.filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === ORIGIN
        && !parsed.pathname.startsWith('/ar/')
        && /\/(?:dubai|abudhabi|ajman|sharjah|fujairah|alain|ras-al-khaimah|umm-al-quwain)\/used-car\//i.test(parsed.pathname)
        && pathAllowed(url, robots);
    } catch {
      return false;
    }
  });
  result.sitemap = {
    status: sitemapResp.status,
    contentType: sitemapResp.contentType,
    capturedBytes: sitemapResp.capturedBytes,
    truncated: sitemapResp.truncated,
    hashSha256: sitemapResp.hashSha256,
    rawLocCount: allLocs.length,
    englishDetailCandidateCount: candidates.length,
    firstEnglishDetailCandidates: candidates.slice(0, 10),
  };

  let selected = null;
  for (const url of candidates.slice(0, MAX_DETAIL_ATTEMPTS)) {
    await sleep(delayMs);
    const page = await get(url);
    result.requestCount += 1;
    result.detailRequests += 1;
    const attempt = {
      url,
      finalUrl: page.finalUrl,
      status: page.status,
      ok: page.ok,
      contentType: page.contentType,
      capturedBytes: page.capturedBytes,
      truncated: page.truncated,
      hashSha256: page.hashSha256,
      title: titleOf(page.body),
      h1: h1Of(page.body),
    };
    result.detailAttempts.push(attempt);
    if (page.ok && /text\/html|application\/xhtml/i.test(page.contentType)) {
      selected = page;
      break;
    }
  }
  if (!selected) throw new Error('no_live_detail_within_bounded_source_declared_attempts');

  const visible = clean(selected.body);
  const ld = jsonLdObjects(selected.body);
  const jsonLdKeys = [...flattenKeys(ld)].sort();
  result.detail = {
    url: selected.url,
    finalUrl: selected.finalUrl,
    status: selected.status,
    contentType: selected.contentType,
    capturedBytes: selected.capturedBytes,
    truncated: selected.truncated,
    hashSha256: selected.hashSha256,
    title: titleOf(selected.body),
    h1: h1Of(selected.body),
    jsonLdObjectCount: ld.length,
    jsonLdKeys: jsonLdKeys.slice(0, 300),
    visibleSignals: {
      price: boundedMatches(visible, /(?:AED\s*[\d,]+|[\d,]+\s*AED)/gi),
      engine: boundedMatches(visible, /(?:\b\d(?:\.\d)?L\b|engine\s*(?:size|capacity|displacement)?|\b\d{3,4}\s*cc\b)/gi),
      power: boundedMatches(visible, /(?:\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b|horsepower|engine power|power output)/gi),
      fuel: boundedMatches(visible, /\b(?:petrol|gasoline|diesel|hybrid|electric|phev|fuel)\b/gi),
      transmission: boundedMatches(visible, /\b(?:automatic|manual|cvt|transmission)\b/gi),
      drive: boundedMatches(visible, /\b(?:AWD|4WD|FWD|RWD|all[- ]wheel|front[- ]wheel|rear[- ]wheel)\b/gi),
      body: boundedMatches(visible, /\b(?:sedan|suv|coupe|hatchback|convertible|wagon|pickup|minivan|van|body type)\b/gi),
    },
    rawStructuredKeySignals: {
      powerLikeKeys: boundedMatches(selected.body, /["'](?:horsepower|horsePower|enginePower|powerHp|powerKW|powerKw|power)["']\s*:/gi),
      engineLikeKeys: boundedMatches(selected.body, /["'](?:engineSize|engineCapacity|engineVolume|displacement|engineCc|engine)["']\s*:/gi),
      priceLikeKeys: boundedMatches(selected.body, /["'](?:price|cashPrice|sellingPrice|salePrice)["']\s*:/gi),
    },
  };
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUT,
  completed: result.completed,
  requestCount: result.requestCount,
  detailRequests: result.detailRequests,
  liveDetail: result.detail?.url || null,
  error: result.error || null,
}, null, 2));
if (!result.completed) process.exitCode = 1;
