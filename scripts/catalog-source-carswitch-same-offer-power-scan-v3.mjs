import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-carswitch-same-offer-power-scan-v3.json';
const SOURCE_ID = 'carswitch_uae_candidate';
const DETAIL_URL = 'https://carswitch.com/dubai/used-car/peugeot/3008/2024/661285';
const LISTING_ID = '661285';
const ROBOTS_URL = 'https://carswitch.com/robots.txt';
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const MAX_BYTES = 6_000_000;
const TIMEOUT_MS = 30000;

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

async function get(url, accept) {
  const response = await fetch(url, {
    headers: { ...headers, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readLimited(response, url === ROBOTS_URL ? 300000 : MAX_BYTES);
  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') || '',
    text: body.text,
    capturedBytes: body.bytes,
    truncated: body.truncated,
    hashSha256: crypto.createHash('sha256').update(body.text).digest('hex'),
  };
}

function parseRobots(text) {
  let active = false;
  let crawlDelay = null;
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') { active = value === '*'; continue; }
    if (!active) continue;
    if (key === 'crawl-delay' && /^\d+(?:\.\d+)?$/.test(value)) crawlDelay = Number(value);
    if ((key === 'allow' || key === 'disallow') && value) rules.push({ type: key, value });
  }
  return { rules, crawlDelay };
}

function pathAllowed(url, robots) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const matches = robots.rules.flatMap((rule) => {
    const anchored = rule.value.endsWith('$');
    const raw = anchored ? rule.value.slice(0, -1) : rule.value;
    const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path) ? [rule] : []; }
    catch { return []; }
  }).sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
  return !matches[0] || matches[0].type === 'allow';
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

function matches(text, regex, limit = 20, radius = 140) {
  const source = String(text || '');
  const out = [];
  for (const m of source.matchAll(regex)) {
    const start = Math.max(0, (m.index || 0) - radius);
    const end = Math.min(source.length, (m.index || 0) + m[0].length + radius);
    const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!out.includes(snippet)) out.push(snippet);
    if (out.length >= limit) break;
  }
  return out;
}

function countMatches(text, regex) {
  return [...String(text || '').matchAll(regex)].length;
}

function listingContexts(raw, id, radius = 12000, limit = 5) {
  const out = [];
  let from = 0;
  while (out.length < limit) {
    const index = raw.indexOf(id, from);
    if (index < 0) break;
    const context = raw.slice(Math.max(0, index - radius), Math.min(raw.length, index + id.length + radius));
    out.push({
      index,
      length: context.length,
      powerKeyCount: countMatches(context, /["'](?:horsepower|horsePower|enginePower|powerHp|powerKW|powerKw|power)["']\s*:/gi),
      numericPowerUnitCount: countMatches(context, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi),
      powerKeySnippets: matches(context, /["'](?:horsepower|horsePower|enginePower|powerHp|powerKW|powerKw|power)["']\s*:/gi, 5, 100),
      numericPowerSnippets: matches(context, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi, 5, 100),
    });
    from = index + id.length;
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

function compactVehicleLd(objects) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const type = Array.isArray(obj['@type']) ? obj['@type'].join(' ') : String(obj['@type'] || '');
    if (!/Car|Vehicle/i.test(type) && !obj.vehicleIdentificationNumber) continue;
    return {
      type: obj['@type'] ?? null,
      name: obj.name ?? null,
      brand: obj.brand?.name ?? obj.brand ?? null,
      model: obj.model ?? null,
      vehicleModelDate: obj.vehicleModelDate ?? null,
      vehicleConfiguration: obj.vehicleConfiguration ?? null,
      bodyType: obj.bodyType ?? null,
      vehicleEngine: obj.vehicleEngine ?? null,
      driveWheelConfiguration: obj.driveWheelConfiguration ?? null,
      vehicleTransmission: obj.vehicleTransmission ?? null,
      mileageFromOdometer: obj.mileageFromOdometer ?? null,
      vehicleIdentificationNumber: obj.vehicleIdentificationNumber ?? null,
      offers: obj.offers ?? null,
      imageCount: Array.isArray(obj.image) ? obj.image.length : obj.image ? 1 : 0,
    };
  }
  return null;
}

const result = {
  version: 3,
  generatedAt: new Date().toISOString(),
  sourceId: SOURCE_ID,
  detailUrl: DETAIL_URL,
  listingId: LISTING_ID,
  provenance: 'exact live detail URL was recovered from CarSwitch robots-declared detail_pages.xml in successful run 33865783957; no guessed route',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
};

try {
  const robotsResp = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequests = 1;
  if (!robotsResp.ok) throw new Error(`robots_http_${robotsResp.status}`);
  const robots = parseRobots(robotsResp.text);
  result.robots = { status: robotsResp.status, hashSha256: robotsResp.hashSha256, crawlDelaySeconds: robots.crawlDelay, detailAllowed: pathAllowed(DETAIL_URL, robots) };
  if (!pathAllowed(DETAIL_URL, robots)) throw new Error('detail_disallowed_by_robots');

  await sleep(Math.max(15000, Math.ceil((robots.crawlDelay || 0) * 1000)));
  const page = await get(DETAIL_URL, 'text/html,application/xhtml+xml,*/*;q=0.5');
  result.requestCount += 1;
  result.detailRequests = 1;
  if (!page.ok) throw new Error(`detail_http_${page.status}`);

  const visible = clean(page.text);
  const jsonLd = jsonLdObjects(page.text);
  result.detail = {
    status: page.status,
    finalUrl: page.finalUrl,
    contentType: page.contentType,
    capturedBytes: page.capturedBytes,
    truncated: page.truncated,
    hashSha256: page.hashSha256,
    listingIdOccurrences: countMatches(page.text, new RegExp(LISTING_ID, 'g')),
    wholeCapturedPowerKeyCount: countMatches(page.text, /["'](?:horsepower|horsePower|enginePower|powerHp|powerKW|powerKw|power)["']\s*:/gi),
    wholeCapturedNumericPowerUnitCount: countMatches(page.text, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi),
    wholeCapturedPowerKeySnippets: matches(page.text, /["'](?:horsepower|horsePower|enginePower|powerHp|powerKW|powerKw|power)["']\s*:/gi, 10, 120),
    wholeCapturedNumericPowerSnippets: matches(page.text, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi, 10, 120),
    visibleNumericPowerUnitCount: countMatches(visible, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi),
    visibleNumericPowerSnippets: matches(visible, /\b\d{2,4}\s*(?:HP|BHP|PS|kW)\b/gi, 10, 120),
    listingContexts: listingContexts(page.text, LISTING_ID),
    vehicleJsonLd: compactVehicleLd(jsonLd),
  };
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: OUT, completed: result.completed, requestCount: result.requestCount, capturedBytes: result.detail?.capturedBytes || 0, truncated: result.detail?.truncated ?? null, powerKeyCount: result.detail?.wholeCapturedPowerKeyCount ?? null, numericPowerCount: result.detail?.wholeCapturedNumericPowerUnitCount ?? null, error: result.error || null }, null, 2));
if (!result.completed) process.exitCode = 1;
