import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_DEFICIT_RECON_OUTPUT || 'catalog-source-deficit-recon-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_DEFICIT_RECON_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(150000, Math.min(2000000, Number(process.env.CATALOG_SOURCE_DEFICIT_RECON_MAX_BODY_BYTES || 1400000)));
const USER_AGENT = 'AvtoCenaDeficitRecon/1.0 (+read-only source qualification)';

const SAMPLES = [
  { market: 'korea', sourceId: 'bobaedream_korea_candidate', url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K', offerId: '2260063', anchors: ['차종', '차체', '세단', '승용', '사진', '이미지', '갤러리'] },
  { market: 'korea', sourceId: 'bobaedream_korea_candidate', url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K', offerId: '2262188', anchors: ['차종', '차체', '세단', '승용', '사진', '이미지', '갤러리'] },
  { market: 'uae', sourceId: 'carswitch_uae_candidate', url: 'https://carswitch.com/abudhabi/used-car/chevrolet/captiva/2025/864601', offerId: '864601', anchors: ['1.5', 'engine', 'displacement', 'capacity', 'horsepower', 'power', 'hp', 'kw', 'liter', 'litre', 'cc'] },
  { market: 'uae', sourceId: 'carswitch_uae_candidate', url: 'https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416', offerId: '857416', anchors: ['5.7', 'engine', 'displacement', 'capacity', 'horsepower', 'power', 'hp', 'kw', 'liter', 'litre', 'cc'] },
  { market: 'uae', sourceId: 'cars24_uae_candidate', url: 'https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/', offerId: '9714841569', anchors: ['31499', '31,499', '1.5', 'price', 'sellingPrice', 'listingPrice', 'engine', 'displacement', 'horsepower', 'power', 'hp', 'kw', 'liter', 'litre', 'cc'] },
  { market: 'uae', sourceId: 'cars24_uae_candidate', url: 'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/', offerId: '9714841918', anchors: ['64999', '64,999', '1.8', 'price', 'sellingPrice', 'listingPrice', 'engine', 'displacement', 'horsepower', 'power', 'hp', 'kw', 'liter', 'litre', 'cc'] },
  { market: 'uae', sourceId: 'dubicars_uae_exact', url: 'https://www.dubicars.com/2019-hyundai-veloster-740206.html', offerId: '740206', anchors: ['engine', 'displacement', 'horsepower', 'power', 'hp', 'kw', 'liter', 'litre', 'cc', 'gallery', 'photos', 'images'] },
  { market: 'uae', sourceId: 'dubicars_uae_exact', url: 'https://www.dubicars.com/2023-bmw-ix1-979972.html', offerId: '979972', anchors: ['313', '30 minute', '30-minute', 'continuous power', 'rated power', 'net power', 'certified power', 'kw', 'hp', 'gallery', 'photos', 'images'] },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ko;q=0.7,ru;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const SECRETISH_RE = /(?:authorization|cookie|set-cookie|csrf|xsrf|bearer|access[_-]?token|refresh[_-]?token|session[_-]?id|password|passwd|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const ROUTE_HINT_RE = /(?:api|ajax|photo|image|gallery|spec|detail|vehicle|car|stock|offer|listing|inventory|graphql|json)/i;
const KEY_HINT_RE = /(?:price|amount|currency|engine|displacement|capacity|cc|liter|litre|horse|power|kw|body|type|photo|image|gallery|media|certif|rated|continuous|30.?minute)/i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i;
const BODY_HINT_RE = /(?:차종|차체|세단|승용|해치백|왜건|쿠페|SUV|suv|sedan|hatchback|wagon|coupe|crossover|body\s*type|body\s*style|vehicle\s*type)/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function clean(value, limit = 700) {
  return decodeHtml(String(value ?? ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(SECRETISH_RE, '[redacted]')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function rawSnippet(value, limit = 700) {
  return decodeHtml(String(value ?? ''))
    .replace(SECRETISH_RE, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function absoluteUrl(value, base) {
  try {
    const u = new URL(decodeHtml(String(value || '')), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function limitedUnique(values, limit = 40) {
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

export function extractRouteCandidates(html, baseUrl, offerId, limit = 40) {
  const base = new URL(baseUrl);
  const values = [];
  const source = decodeHtml(String(html || ''));
  const regexes = [
    /\b(?:href|src|action|data-url|data-api|data-src)\s*=\s*["']([^"']+)["']/gi,
    /["'](https?:\\?\/\\?\/[^"'\s<>]+|\/[A-Za-z0-9_./?=&%+-]{4,})["']/g,
  ];
  for (const re of regexes) {
    for (const match of source.matchAll(re)) {
      const candidate = absoluteUrl(String(match[1] || '').replace(/\\\//g, '/'), baseUrl);
      if (!candidate) continue;
      const parsed = new URL(candidate);
      if (parsed.origin !== base.origin) continue;
      const key = `${parsed.pathname}${parsed.search}`;
      if (!ROUTE_HINT_RE.test(key) && !key.includes(String(offerId))) continue;
      if (/login|signin|register|logout|privacy|terms|cookie|favorite|wishlist/i.test(key)) continue;
      values.push(candidate);
    }
  }
  return limitedUnique(values, limit);
}

export function extractKeyContexts(html, anchors = [], limit = 80) {
  const source = decodeHtml(String(html || ''));
  const contexts = [];
  const pushAt = (index, label) => {
    if (index < 0) return;
    const start = Math.max(0, index - 260);
    const end = Math.min(source.length, index + 440);
    const snippet = rawSnippet(source.slice(start, end), 760);
    if (!snippet) return;
    contexts.push({ label, snippet });
  };

  for (const match of source.matchAll(/["']([A-Za-z_][A-Za-z0-9_.-]{1,80})["']\s*:\s*(?:["']([^"']{0,180})["']|(-?\d+(?:\.\d+)?))/g)) {
    const key = match[1] || '';
    if (!KEY_HINT_RE.test(key)) continue;
    const value = match[2] ?? match[3] ?? '';
    const idx = match.index ?? -1;
    pushAt(idx, `${key}=${String(value).slice(0, 120)}`);
  }

  const lower = source.toLowerCase();
  for (const anchorRaw of anchors) {
    const anchor = String(anchorRaw || '').trim();
    if (!anchor) continue;
    const needle = anchor.toLowerCase();
    let from = 0;
    let hits = 0;
    while (hits < 4) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      pushAt(idx, `anchor:${anchor}`);
      from = idx + Math.max(1, needle.length);
      hits += 1;
    }
  }
  return limitedUnique(contexts, limit);
}

function extractImageUrls(fragment, baseUrl) {
  const values = [];
  const srcRe = /<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy|srcset)\s*=\s*["']([^"']+)["']/gi;
  for (const match of String(fragment || '').matchAll(srcRe)) {
    for (const raw of String(match[1] || '').split(',').map((x) => x.trim().split(/\s+/)[0])) {
      const url = absoluteUrl(raw, baseUrl);
      if (url && IMAGE_EXT_RE.test(url)) values.push(url);
    }
  }
  for (const match of String(fragment || '').matchAll(/["'](https?:\\?\/\\?\/[^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) {
    const url = absoluteUrl(String(match[1] || '').replace(/\\\//g, '/'), baseUrl);
    if (url) values.push(url);
  }
  return limitedUnique(values, 200);
}

function normalizedImageIdentity(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/(?:w_\d+x\d+|\d+x\d+|thumb|thumbnail|small|medium|large)\//gi, '/')
      .replace(/\/+/g, '/');
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export function extractGalleryClusters(html, baseUrl, offerId, limit = 12) {
  const source = decodeHtml(String(html || ''));
  const clusters = [];
  const markerRe = /(?:gallery|photo|photos|image|images|carousel|slider|swiper|사진|이미지|갤러리|이전 이미지|다음 이미지)/gi;
  for (const match of source.matchAll(markerRe)) {
    const idx = match.index ?? 0;
    const start = Math.max(0, idx - 2200);
    const end = Math.min(source.length, idx + 5200);
    const fragment = source.slice(start, end);
    const urls = extractImageUrls(fragment, baseUrl);
    const identities = limitedUnique(urls.map(normalizedImageIdentity), 200);
    if (identities.length < 3) continue;
    const containerTag = fragment.match(/<(?:div|section|ul|figure)\b[^>]*(?:id|class)\s*=\s*["']([^"']*(?:gallery|photo|image|slider|swiper|carousel|사진|이미지)[^"']*)["'][^>]*>/i)?.[1] || null;
    const offerBound = fragment.includes(String(offerId));
    clusters.push({
      marker: match[0],
      containerHint: containerTag ? clean(containerTag, 180) : null,
      offerIdInFragment: offerBound,
      uniqueImageCount: identities.length,
      imageSample: identities.slice(0, 12),
      context: clean(fragment.slice(Math.max(0, idx - start - 450), Math.min(fragment.length, idx - start + 650)), 650),
    });
  }
  return limitedUnique(clusters.sort((a, b) => Number(b.offerIdInFragment) - Number(a.offerIdInFragment) || b.uniqueImageCount - a.uniqueImageCount), limit);
}

export function extractBodyContexts(html, limit = 24) {
  const source = decodeHtml(String(html || ''));
  const out = [];
  for (const match of source.matchAll(new RegExp(BODY_HINT_RE.source, 'gi'))) {
    const idx = match.index ?? 0;
    const snippet = clean(source.slice(Math.max(0, idx - 240), Math.min(source.length, idx + 520)), 680);
    if (snippet) out.push({ marker: match[0], snippet });
  }
  return limitedUnique(out, limit);
}

function stableEvidenceFingerprint(summary) {
  return crypto.createHash('sha256').update(JSON.stringify({
    routeCandidates: summary.routeCandidates,
    keyContexts: summary.keyContexts,
    galleryClusters: summary.galleryClusters,
    bodyContexts: summary.bodyContexts,
  })).digest('hex');
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedBody(response) {
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
    chunks.push(slice);
    total += slice.byteLength;
    if (value.byteLength > remaining) { truncated = true; break; }
  }
  return { body: Buffer.concat(chunks.map((x) => Buffer.from(x))).toString('utf8'), truncated };
}

const robotsCache = new Map();
async function robotsFor(url) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.origin}/robots.txt`;
  if (robotsCache.has(robotsUrl)) return robotsCache.get(robotsUrl);
  let result;
  try {
    const response = await fetchWithTimeout(robotsUrl, { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimitedBody(response)).body : '';
    result = { robotsUrl, status: response.status, text };
  } catch (error) {
    result = { robotsUrl, status: null, text: '', error: String(error?.message || error) };
  }
  robotsCache.set(robotsUrl, result);
  return result;
}

async function fetchSample(sample) {
  const robots = await robotsFor(sample.url);
  const policy = evaluateRobots(robots.text, sample.url, USER_AGENT);
  if (!policy.allowed) {
    return { kind: 'robots_disallowed', url: sample.url, robots: { status: robots.status, matchedRule: policy.matchedRule } };
  }
  let response;
  try {
    response = await fetchWithTimeout(sample.url, { headers: HEADERS, redirect: 'manual' });
  } catch (error) {
    return { kind: 'network_error', url: sample.url, error: String(error?.message || error), robots: { status: robots.status, matchedRule: policy.matchedRule } };
  }
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'redirect_not_followed', url: sample.url, status: response.status, location: response.headers.get('location'), robots: { status: robots.status, matchedRule: policy.matchedRule } };
  }
  const { body, truncated } = await readLimitedBody(response);
  const summary = {
    status: response.status,
    contentType: response.headers.get('content-type'),
    bytes: Buffer.byteLength(body),
    truncated,
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
    routeCandidates: extractRouteCandidates(body, sample.url, sample.offerId),
    keyContexts: extractKeyContexts(body, sample.anchors),
    galleryClusters: extractGalleryClusters(body, sample.url, sample.offerId),
    bodyContexts: extractBodyContexts(body),
  };
  summary.evidenceFingerprint = stableEvidenceFingerprint(summary);
  return { kind: response.ok ? 'reachable' : 'http_error', url: sample.url, robots: { status: robots.status, matchedRule: policy.matchedRule }, summary };
}

async function runOne(sample) {
  const first = await fetchSample(sample);
  const second = await fetchSample(sample);
  const repeat = {
    sameKind: first.kind === second.kind,
    sameEvidenceFingerprint: first.summary?.evidenceFingerprint && first.summary.evidenceFingerprint === second.summary?.evidenceFingerprint,
    sameBodyHash: first.summary?.bodyHashSha256 && first.summary.bodyHashSha256 === second.summary?.bodyHashSha256,
  };
  return { ...sample, first, second, repeat };
}

export async function runRecon() {
  const results = [];
  for (const sample of SAMPLES) results.push(await runOne(sample));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'source_deficit_recon_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    alternateRouteRequestsPerformed: false,
    sampleCount: SAMPLES.length,
    results,
    next: 'inspect route/key/gallery/body evidence; only then add explicitly permitted public alternate-route probes where source-bound binding is demonstrable',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, sampleCount: payload.sampleCount, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runRecon().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
