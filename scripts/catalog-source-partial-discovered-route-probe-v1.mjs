import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';
import { extractRouteCandidates } from './catalog-source-deficit-recon-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_PARTIAL_DISCOVERED_OUTPUT || 'catalog-source-partial-discovered-route-probe-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_PARTIAL_DISCOVERED_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(150000, Math.min(1600000, Number(process.env.CATALOG_SOURCE_PARTIAL_DISCOVERED_MAX_BODY_BYTES || 1100000)));
const USER_AGENT = 'AvtoCenaPartialDiscoveredProbe/1.0 (+read-only source qualification)';

const SAMPLES = [
  {
    market: 'china',
    sourceId: 'chngoodcar_china_candidate',
    routeKind: 'second_offer_discovered_in_run_33747985524',
    url: 'https://www.chngoodcar.com/Home/Cars?id=1265916925100158976',
  },
  {
    market: 'china',
    sourceId: 'chngoodcar_china_candidate',
    routeKind: 'second_offer_discovered_in_run_33747985524',
    url: 'https://www.chngoodcar.com/Home/Cars?id=1265916910290071552',
  },
  {
    market: 'china',
    sourceId: 'chngoodcar_china_candidate',
    routeKind: 'second_offer_discovered_in_run_33747985524',
    url: 'https://www.chngoodcar.com/Home/Cars?id=1288729215201439744',
  },
  {
    market: 'china',
    sourceId: 'iautos_china_candidate',
    routeKind: 'same_offer_configuration_discovered_in_run_33747985524',
    url: 'https://m.iautos.cn/configuration-15501828/',
    expectedOfferId: '15501828',
  },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const FIELD_PATTERNS = {
  price: /(?:价格|售价|报价|车价|新车含税价|price)/i,
  currency: /(?:￥|¥|CNY|RMB|人民币|万元|元)/i,
  year: /(?:年款|年份|首次上牌|上牌时间|出厂|20\d{2}|19\d{2})/i,
  mileage: /(?:里程|行驶里程|公里|km)/i,
  fuel: /(?:能源类型|燃料类型|燃油类型|燃料|汽油|柴油|混动|混合动力|纯电|电动|新能源)/i,
  engine: /(?:排量|发动机|engine|\b\d(?:\.\d+)?\s*L\b|\b\d{3,5}\s*cc\b)/i,
  power: /(?:最大马力|最大功率|马力|功率|\b\d{2,4}\s*(?:Ps|PS|hp|HP|kw|kW)\b)/i,
  body: /(?:车身结构|车身形式|车辆类型|车型|轿车|SUV|MPV|两厢|三厢|旅行车|跑车|中型车|紧凑型)/i,
  charging: /(?:快充|慢充|充电时间|充电|电量)/i,
};

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function clean(value, limit = 1200) {
  return decodeHtml(String(value ?? ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 320);
}

function visibleText(html) {
  return clean(String(html || '')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), 260000);
}

function uniq(values, limit = 100) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function safeUrl(value, base) {
  try {
    const url = new URL(decodeHtml(String(value || '')), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function extractImages(html, baseUrl) {
  const out = [];
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const raw of String(match[1] || '').split(',').map((x) => x.trim().split(/\s+/)[0])) {
      const url = safeUrl(raw, baseUrl);
      if (url && IMAGE_EXT_RE.test(url)) out.push(url);
    }
  }
  return uniq(out, 250);
}

export function extractFieldContexts(html, limitPerField = 16) {
  const text = visibleText(html);
  const out = {};
  for (const [field, re] of Object.entries(FIELD_PATTERNS)) {
    const rows = [];
    const global = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const match of text.matchAll(global)) {
      const idx = match.index ?? 0;
      rows.push({ marker: match[0], context: text.slice(Math.max(0, idx - 180), Math.min(text.length, idx + 380)).trim() });
      if (rows.length >= limitPerField) break;
    }
    out[field] = uniq(rows, limitPerField);
  }
  return out;
}

function offerScopedImages(html, baseUrl, offerId) {
  if (!offerId) return [];
  const source = decodeHtml(String(html || ''));
  const clusters = [];
  let from = 0;
  for (let count = 0; count < 8; count += 1) {
    const idx = source.indexOf(String(offerId), from);
    if (idx < 0) break;
    const fragment = source.slice(Math.max(0, idx - 9000), Math.min(source.length, idx + 22000));
    const images = extractImages(fragment, baseUrl);
    if (images.length) clusters.push({ offerIdInFragment: true, imageCount: images.length, imageSample: images.slice(0, 15) });
    from = idx + String(offerId).length;
  }
  return uniq(clusters, 10);
}

function summarize(body, sample) {
  const sourceOfferId = sample.expectedOfferId || sourceOfferIdFromUrl(sample.url);
  const title = titleOf(body);
  const fields = extractFieldContexts(body);
  const images = extractImages(body, sample.url);
  const scoped = offerScopedImages(body, sample.url, sourceOfferId);
  const routes = extractRouteCandidates(body, sample.url, sourceOfferId || '', 25);
  const summary = {
    title,
    sourceOfferId,
    fields,
    totalImageCount: images.length,
    imageSample: images.slice(0, 20),
    offerScopedImageClusters: scoped,
    discoveredSameOriginRoutes: routes,
  };
  summary.evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  return summary;
}

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return { body: await response.text(), truncated: false };
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

const robotsCache = new Map();
async function robotsFor(url) {
  const origin = new URL(url).origin;
  const robotsUrl = `${origin}/robots.txt`;
  if (robotsCache.has(robotsUrl)) return robotsCache.get(robotsUrl);
  try {
    const response = await fetchTimed(robotsUrl, { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimited(response)).body : '';
    const out = { status: response.status, text };
    robotsCache.set(robotsUrl, out);
    return out;
  } catch (error) {
    const out = { status: null, text: '', error: String(error?.message || error) };
    robotsCache.set(robotsUrl, out);
    return out;
  }
}

async function fetchSample(sample) {
  const robots = await robotsFor(sample.url);
  const policy = evaluateRobots(robots.text, sample.url, USER_AGENT);
  if (!policy.allowed) return { kind: 'robots_disallowed', robotsStatus: robots.status, matchedRule: policy.matchedRule };
  let response;
  try {
    response = await fetchTimed(sample.url, { headers: HEADERS, redirect: 'manual' });
  } catch (error) {
    return { kind: 'network_error', error: String(error?.message || error), robotsStatus: robots.status };
  }
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'redirect_not_followed', status: response.status, location: response.headers.get('location'), robotsStatus: robots.status };
  }
  const { body, truncated } = await readLimited(response);
  return {
    kind: response.ok ? 'reachable' : 'http_error',
    status: response.status,
    truncated,
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
    summary: summarize(body, sample),
    robotsStatus: robots.status,
  };
}

async function runOne(sample) {
  const first = await fetchSample(sample);
  const second = await fetchSample(sample);
  return {
    ...sample,
    first,
    second,
    repeat: {
      sameKind: first.kind === second.kind,
      sameBodyHash: Boolean(first.bodyHashSha256 && first.bodyHashSha256 === second.bodyHashSha256),
      sameEvidenceFingerprint: Boolean(first.summary?.evidenceFingerprint && first.summary.evidenceFingerprint === second.summary?.evidenceFingerprint),
    },
  };
}

export async function runPartialDiscoveredProbe() {
  const results = [];
  for (const sample of SAMPLES) results.push(await runOne(sample));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'partial_signal_discovered_route_probe_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    routeOrigin: 'discovered_in_run_33747985524',
    sampleCount: SAMPLES.length,
    results,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, sampleCount: payload.sampleCount, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runPartialDiscoveredProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
