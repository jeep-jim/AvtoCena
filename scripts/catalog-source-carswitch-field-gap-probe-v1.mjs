import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-carswitch-field-gap-probe-v1.json';
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1200000;
const ORIGIN = 'https://carswitch.com';
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const DETAIL_SITEMAP = `${ORIGIN}/sitemap/detail_pages.xml`;

const headers = {
  'user-agent': UA,
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
};

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

async function get(url, accept = 'text/html,application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.5') {
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseRobots(text) {
  const lines = String(text || '').split(/\r?\n/);
  let active = false;
  const rules = [];
  let crawlDelay = null;
  const sitemaps = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      active = value === '*';
      continue;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!active) continue;
    if (key === 'crawl-delay' && /^\d+(?:\.\d+)?$/.test(value)) crawlDelay = Number(value);
    if ((key === 'allow' || key === 'disallow') && value) rules.push({ type: key, value });
  }
  return { rules, crawlDelay, sitemaps };
}

function pathAllowed(url, robots) {
  const path = `${new URL(url).pathname}${new URL(url).search}`;
  const matches = robots.rules
    .filter((rule) => {
      const escaped = rule.value
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      try { return new RegExp(`^${escaped}`).test(path); } catch { return false; }
    })
    .sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
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
    .replace(/\s+/g, ' ')
    .trim();
}

function findJsonLd(html) {
  const rows = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) rows.push(item);
    } catch {}
  }
  return rows;
}

function flattenKeys(value, prefix = '', out = new Set(), depth = 0) {
  if (depth > 5 || value == null) return out;
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

function boundedMatches(text, regex, limit = 8) {
  const out = [];
  for (const match of String(text || '').matchAll(regex)) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(text.length, (match.index || 0) + match[0].length + 130);
    const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!out.includes(snippet)) out.push(snippet);
    if (out.length >= limit) break;
  }
  return out;
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceId: 'carswitch_uae_candidate',
  mode: 'permission_first_single_detail_field_gap_no_write',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequest: 0,
  sitemapRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
};

try {
  const robotsResp = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequest = 1;
  const robots = parseRobots(robotsResp.body);
  result.robots = {
    status: robotsResp.status,
    finalUrl: robotsResp.finalUrl,
    contentType: robotsResp.contentType,
    hashSha256: robotsResp.hashSha256,
    crawlDelaySeconds: robots.crawlDelay,
    declaredDetailSitemap: robots.sitemaps.includes(DETAIL_SITEMAP),
    sitemapCount: robots.sitemaps.length,
  };
  if (!robotsResp.ok) throw new Error(`robots_http_${robotsResp.status}`);
  if (!robots.sitemaps.includes(DETAIL_SITEMAP)) throw new Error('detail_sitemap_not_declared_by_robots');
  if (!pathAllowed(DETAIL_SITEMAP, robots)) throw new Error('detail_sitemap_disallowed_by_robots');

  const delayMs = Math.max(15000, Math.ceil((robots.crawlDelay || 0) * 1000));
  await sleep(delayMs);
  const sitemapResp = await get(DETAIL_SITEMAP, 'application/xml,text/xml,*/*;q=0.5');
  result.requestCount += 1;
  result.sitemapRequests = 1;
  result.sitemap = {
    status: sitemapResp.status,
    finalUrl: sitemapResp.finalUrl,
    contentType: sitemapResp.contentType,
    capturedBytes: sitemapResp.capturedBytes,
    truncated: sitemapResp.truncated,
    hashSha256: sitemapResp.hashSha256,
  };
  if (!sitemapResp.ok) throw new Error(`sitemap_http_${sitemapResp.status}`);

  const urls = locs(sitemapResp.body)
    .filter((url) => {
      try {
        const u = new URL(url);
        return u.origin === ORIGIN && /\/uae\/used-cars\//i.test(u.pathname) && pathAllowed(url, robots);
      } catch { return false; }
    });
  result.sitemap.candidateUrlCountInCapturedPrefix = urls.length;
  result.sitemap.firstCandidateUrls = urls.slice(0, 3);
  const detailUrl = urls[0];
  if (!detailUrl) throw new Error('no_allowed_uae_detail_url_in_sitemap_prefix');

  await sleep(delayMs);
  const detailResp = await get(detailUrl);
  result.requestCount += 1;
  result.detailRequests = 1;
  const visible = clean(detailResp.body);
  const jsonLd = findJsonLd(detailResp.body);
  const keys = [...flattenKeys(jsonLd)].sort();
  result.detail = {
    url: detailUrl,
    status: detailResp.status,
    finalUrl: detailResp.finalUrl,
    contentType: detailResp.contentType,
    capturedBytes: detailResp.capturedBytes,
    truncated: detailResp.truncated,
    hashSha256: detailResp.hashSha256,
    visibleTextLength: visible.length,
    jsonLdObjectCount: jsonLd.length,
    jsonLdKeys: keys.slice(0, 250),
    signals: {
      year: boundedMatches(visible, /\b(?:202[0-6]|201\d)\b/g),
      price: boundedMatches(visible, /(?:AED\s*[\d,]+|[\d,]+\s*AED)/gi),
      engine: boundedMatches(visible, /(?:\b\d(?:\.\d)?L\b|engine\s*(?:size|capacity|displacement)?|\b\d{3,4}\s*cc\b)/gi),
      power: boundedMatches(visible, /(?:\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b|horsepower|engine power|power output)/gi),
      fuel: boundedMatches(visible, /\b(?:petrol|gasoline|diesel|hybrid|electric|phev|fuel)\b/gi),
      transmission: boundedMatches(visible, /\b(?:automatic|manual|cvt|transmission)\b/gi),
      drive: boundedMatches(visible, /\b(?:AWD|4WD|FWD|RWD|all[- ]wheel|front[- ]wheel|rear[- ]wheel)\b/gi),
    },
  };
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: OUT, completed: result.completed, requestCount: result.requestCount, detailUrl: result.detail?.url || null, error: result.error || null }, null, 2));
if (!result.completed) process.exitCode = 1;
