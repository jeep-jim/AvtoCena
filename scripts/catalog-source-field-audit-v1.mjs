import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_FIELD_AUDIT_OUTPUT || 'catalog-source-field-audit-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_FIELD_AUDIT_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(150000, Math.min(2000000, Number(process.env.CATALOG_SOURCE_FIELD_AUDIT_MAX_BODY_BYTES || 1200000)));
const USER_AGENT = 'AvtoCenaFieldAudit/1.0 (+read-only source qualification)';

const SAMPLES = [
  {
    market: 'uae',
    sourceId: 'dubicars_uae_exact',
    urls: [
      'https://www.dubicars.com/2019-hyundai-veloster-740206.html',
      'https://www.dubicars.com/2023-bmw-ix1-979972.html',
    ],
  },
  {
    market: 'korea',
    sourceId: 'bobaedream_korea_candidate',
    urls: [
      'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K',
      'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K',
    ],
  },
  {
    market: 'uae',
    sourceId: 'carswitch_uae_candidate',
    urls: [
      'https://carswitch.com/abudhabi/used-car/chevrolet/captiva/2025/864601',
      'https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416',
    ],
  },
  {
    market: 'uae',
    sourceId: 'cars24_uae_candidate',
    urls: [
      'https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/',
      'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/',
    ],
  },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ko;q=0.7,ru;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const FIELD_KEY_RE = {
  make: /^(?:make|makeName|brand|brandName|manufacturer)$/i,
  model: /^(?:model|modelName|vehicleModel|vehicleModelName)$/i,
  year: /^(?:year|modelYear|vehicleModelDate|manufactureYear|registrationYear)$/i,
  price: /^(?:price|salePrice|sellingPrice|listingPrice|displayPrice|amount)$/i,
  currency: /^(?:priceCurrency|currency|currencyCode)$/i,
  body: /^(?:bodyType|bodyStyle|vehicleType|carType)$/i,
  fuel: /^(?:fuelType|fuel|fuelName)$/i,
  engine: /^(?:engineDisplacement|engineSize|engineCapacity|displacement|engineCc|engineCC|cc)$/i,
  power: /^(?:horsepower|horsePower|powerHp|powerHP|enginePower|maxPower|maximumPower|power)$/i,
  mileage: /^(?:mileage|odometer|mileageFromOdometer|kilometers|kilometres|kms|km)$/i,
  image: /^(?:image|images|photos|photoUrls|imageUrls|gallery)$/i,
};

const LABEL_RE = {
  price: /^(?:price|vehicle price|selling price|asking price|가격|판매가|차량가격)$/i,
  currency: /^(?:currency|통화)$/i,
  body: /^(?:vehicle type|body type|body style|차종|차체형식)$/i,
  fuel: /^(?:fuel type|fuel|연료)$/i,
  engine: /^(?:engine|engine size|engine capacity|displacement|배기량)$/i,
  power: /^(?:horsepower|engine power|power|max power|maximum power|마력|최대출력)$/i,
  mileage: /^(?:kilometers|kilometres|mileage|odometer|주행거리)$/i,
  year: /^(?:model year|year|연식|등록일|최초등록)$/i,
  make: /^(?:make|brand|manufacturer|제조사|브랜드)$/i,
  model: /^(?:model|차명|모델)$/i,
};

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(value) {
  return decodeHtml(String(value ?? '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textLines(html) {
  return decodeHtml(String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 5000);
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

function titleOf(html) {
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
}

function canonicalOf(html, base) {
  const raw = String(html || '').match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]
    || String(html || '').match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["']/i)?.[1]
    || null;
  return raw ? safeUrl(raw, base) : null;
}

export function sourceOfferIdFromUrl(url) {
  const parsed = new URL(url);
  for (const key of ['no', 'id', 'stock', 'stockId', 'vehicleId', 'carId', 'listingId', 'offerId', 'adId']) {
    const value = parsed.searchParams.get(key);
    if (value && /^[A-Za-z0-9_-]{3,}$/.test(value)) return value;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const last = path.split('/').pop() || '';
  const trailing = last.match(/(?:^|[-_])(\d{5,})(?:\.html?)?$/i)?.[1];
  if (trailing) return trailing;
  const uuid = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  return uuid || null;
}

function parseJsonScripts(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || '';
    const body = decodeHtml(match[2] || '').trim();
    if (!body) continue;
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (type !== 'application/ld+json' && type !== 'application/json' && id !== '__NEXT_DATA__') continue;
    try {
      out.push({ type, id, value: JSON.parse(body) });
    } catch {
      // Only valid JSON is evidence.
    }
  }
  return out.slice(0, 30);
}

function nodeTypes(value) {
  const raw = value?.['@type'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => String(x).toLowerCase());
}

function walkObjects(value, path = '$', out = [], depth = 0) {
  if (depth > 12 || out.length > 15000 || value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 250).forEach((item, index) => walkObjects(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push({ path, value });
  for (const [key, child] of Object.entries(value).slice(0, 250)) walkObjects(child, `${path}.${key}`, out, depth + 1);
  return out;
}

function scalarPreview(value) {
  if (value == null) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value).slice(0, 400);
  if (Array.isArray(value) && value.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) return value.slice(0, 20).map(String);
  return null;
}

function structuredFieldHits(scripts) {
  const hits = Object.fromEntries(Object.keys(FIELD_KEY_RE).map((key) => [key, []]));
  for (const script of scripts) {
    const objects = walkObjects(script.value);
    for (const { path, value } of objects) {
      for (const [key, child] of Object.entries(value).slice(0, 250)) {
        for (const [field, re] of Object.entries(FIELD_KEY_RE)) {
          if (!re.test(key)) continue;
          const preview = scalarPreview(child);
          if (preview == null) continue;
          const record = { scriptType: script.type || null, scriptId: script.id || null, path: `${path}.${key}`, value: preview };
          const serialized = JSON.stringify(record);
          if (!hits[field].some((x) => JSON.stringify(x) === serialized)) hits[field].push(record);
          if (hits[field].length > 40) hits[field].length = 40;
        }
      }
    }
  }
  return hits;
}

function vehicleJsonLd(scripts) {
  const nodes = [];
  for (const script of scripts.filter((s) => s.type === 'application/ld+json')) {
    for (const { path, value } of walkObjects(script.value)) {
      if (nodeTypes(value).some((type) => ['car', 'vehicle', 'product'].includes(type))) {
        nodes.push({ path, types: nodeTypes(value), value });
      }
    }
  }
  return nodes.slice(0, 12).map(({ path, types, value }) => ({
    path,
    types,
    name: scalarPreview(value.name),
    sku: scalarPreview(value.sku),
    url: scalarPreview(value.url),
    brand: scalarPreview(value.brand?.name ?? value.brand),
    model: scalarPreview(value.model),
    vehicleModelDate: scalarPreview(value.vehicleModelDate),
    bodyType: scalarPreview(value.bodyType),
    fuelType: scalarPreview(value.fuelType),
    mileageFromOdometer: value.mileageFromOdometer ?? null,
    vehicleEngine: value.vehicleEngine ?? null,
    offers: value.offers ?? null,
    image: Array.isArray(value.image) ? value.image.slice(0, 20) : value.image ?? null,
  }));
}

export function extractLabelPairs(html) {
  const pairs = [];
  const push = (label, value, source) => {
    const left = cleanText(label).replace(/[:：]+$/, '').trim();
    const right = cleanText(value).trim();
    if (!left || !right || left.length > 100 || right.length > 500) return;
    const record = { label: left, value: right, source };
    if (!pairs.some((x) => x.label === record.label && x.value === record.value)) pairs.push(record);
  };
  for (const match of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((x) => x[1]);
    if (cells.length >= 2) push(cells[0], cells.slice(1).join(' '), 'table');
  }
  for (const match of String(html || '').matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) push(match[1], match[2], 'dl');
  return pairs.slice(0, 300);
}

function labelFieldHits(pairs) {
  const hits = Object.fromEntries(Object.keys(LABEL_RE).map((key) => [key, []]));
  for (const pair of pairs) {
    for (const [field, re] of Object.entries(LABEL_RE)) {
      if (re.test(pair.label)) hits[field].push(pair);
    }
  }
  return hits;
}

function textFieldHits(html) {
  const lines = textLines(html);
  const joined = lines.join(' \n ');
  const matches = (re, limit = 20) => [...joined.matchAll(re)].slice(0, limit).map((m) => m[0].replace(/\s+/g, ' ').trim().slice(0, 300));
  return {
    price: matches(/(?:AED\s*[\d,.]+|[\d,.]+\s*(?:AED|₩|KRW|원))/gi),
    year: matches(/\b(?:19|20)\d{2}\b/g),
    mileage: matches(/\b[\d,.]+\s*(?:km|kms|kilometers|kilometres|킬로미터)\b/gi),
    engine: matches(/(?:engine(?:\s+(?:size|capacity))?|displacement|배기량)\s*[:：-]?\s*[\d,.]+\s*(?:cc|cm3|cm³|l|ℓ)?/gi),
    power: matches(/(?:horsepower|engine power|max(?:imum)? power|power|마력|최대출력)\s*[:：-]?\s*[\d,.]+\s*(?:hp|ps|kw|마력)?/gi),
    fuel: matches(/(?:fuel type|fuel|연료)\s*[:：-]?\s*(?:petrol|gasoline|diesel|hybrid|electric|phev|hev|휘발유|가솔린|경유|디젤|하이브리드|전기)/gi),
    body: matches(/(?:vehicle type|body type|body style|차종|차체형식)\s*[:：-]?\s*[A-Za-z가-힣/ -]{2,80}/gi),
  };
}

function imageEvidence(html, baseUrl, offerId) {
  const urls = [];
  const add = (raw) => {
    const url = safeUrl(raw, baseUrl);
    if (!url || /favicon|logo|icon|sprite|pixel|avatar|placeholder|badge/i.test(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const raw of match[1].split(',').map((part) => part.trim().split(/\s+/)[0])) add(raw);
  }
  for (const match of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
  const listingBound = offerId ? urls.filter((url) => url.includes(offerId)) : [];
  return { totalUnique: urls.length, listingIdBoundCount: listingBound.length, samples: urls.slice(0, 20), listingIdBoundSamples: listingBound.slice(0, 20) };
}

function summarizeHtml(html, finalUrl) {
  const scripts = parseJsonScripts(html);
  const pairs = extractLabelPairs(html);
  const offerId = sourceOfferIdFromUrl(finalUrl);
  return {
    title: titleOf(html),
    canonicalUrl: canonicalOf(html, finalUrl),
    sourceOfferId: offerId,
    vehicleJsonLd: vehicleJsonLd(scripts),
    structuredFieldHits: structuredFieldHits(scripts),
    labelFieldHits: labelFieldHits(pairs),
    textFieldHits: textFieldHits(html),
    labelPairsSample: pairs.slice(0, 80),
    images: imageEvidence(html, finalUrl, offerId),
  };
}

function evidenceFingerprint(summary) {
  const stable = {
    sourceOfferId: summary.sourceOfferId,
    canonicalUrl: summary.canonicalUrl,
    title: summary.title,
    vehicleJsonLd: summary.vehicleJsonLd,
    labelFieldHits: summary.labelFieldHits,
    textFieldHits: summary.textFieldHits,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

async function readBodyLimited(response) {
  if (!response.body) return { text: '', bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_BODY_BYTES - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    if (bytes >= MAX_BODY_BYTES) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString('utf8'), bytes: buffer.length, truncated };
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, headers: { ...HEADERS, ...(options.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: options.redirect ?? 'manual' });
}

const robotsCache = new Map();
async function robotsDecision(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const response = await fetchWithTimeout(`${origin}/robots.txt`, { redirect: 'follow', headers: { accept: 'text/plain,*/*;q=0.5' } });
        const body = await readBodyLimited(response);
        return { status: response.status, ok: response.ok, text: response.ok ? body.text : '' };
      } catch (error) {
        return { status: null, ok: false, text: '', error: String(error?.message || error) };
      }
    })());
  }
  const robots = await robotsCache.get(origin);
  if (!robots.ok || !robots.text) return { allowed: true, robotsStatus: robots.status, policy: 'unknown_no_explicit_disallow' };
  const result = evaluateRobots(robots.text, url, USER_AGENT);
  return { allowed: result.allowed, robotsStatus: robots.status, policy: result.allowed ? 'allowed_by_robots' : 'explicitly_disallowed_by_robots', matchedRule: result.matchedRule };
}

async function fetchPage(initialUrl) {
  let url = initialUrl;
  const redirects = [];
  for (let hop = 0; hop <= 5; hop++) {
    const robots = await robotsDecision(url);
    if (!robots.allowed) return { kind: 'robots_disallowed', requestUrl: initialUrl, finalUrl: url, redirects, robots };
    let response;
    try {
      response = await fetchWithTimeout(url);
    } catch (error) {
      return { kind: 'network_error', requestUrl: initialUrl, finalUrl: url, redirects, robots, error: String(error?.message || error) };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = safeUrl(response.headers.get('location'), url);
      if (!next || hop === 5) return { kind: 'redirect_error', requestUrl: initialUrl, finalUrl: url, redirects, robots, status: response.status };
      redirects.push({ from: url, status: response.status, to: next });
      url = next;
      continue;
    }
    const body = await readBodyLimited(response);
    const contentType = response.headers.get('content-type') || '';
    const summary = response.ok && (/html|xhtml/i.test(contentType) || /^\s*</.test(body.text)) ? summarizeHtml(body.text, url) : null;
    return {
      kind: 'response', requestUrl: initialUrl, finalUrl: url, redirects, robots,
      status: response.status, ok: response.ok, contentType, bytes: body.bytes, truncated: body.truncated,
      bodyHashSha256: crypto.createHash('sha256').update(body.text).digest('hex'),
      summary,
    };
  }
  return { kind: 'redirect_error', requestUrl: initialUrl, finalUrl: url, redirects };
}

function repeatComparison(first, second) {
  if (first.kind !== 'response' || second.kind !== 'response' || !first.summary || !second.summary) return { stable: false, reason: 'missing_successful_html_response' };
  const firstFingerprint = evidenceFingerprint(first.summary);
  const secondFingerprint = evidenceFingerprint(second.summary);
  return {
    stable: first.ok && second.ok && first.finalUrl === second.finalUrl && firstFingerprint === secondFingerprint,
    sameFinalUrl: first.finalUrl === second.finalUrl,
    sameBodyHash: first.bodyHashSha256 === second.bodyHashSha256,
    firstFingerprint,
    secondFingerprint,
  };
}

async function auditSample(source, url) {
  const first = await fetchPage(url);
  const second = await fetchPage(url);
  return {
    market: source.market,
    sourceId: source.sourceId,
    requestedUrl: url,
    first,
    second,
    repeat: repeatComparison(first, second),
    classificationMutation: false,
    publishAllowedMutation: false,
  };
}

export async function runAudit() {
  const results = [];
  for (const source of SAMPLES) {
    const samples = [];
    for (const url of source.urls) samples.push(await auditSample(source, url));
    results.push({ market: source.market, sourceId: source.sourceId, samples });
  }
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'source_bound_field_audit_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    sourceCount: results.length,
    sampleCount: results.reduce((sum, source) => sum + source.samples.length, 0),
    settings: { timeoutMs: TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES, repeatedRequestsPerSample: 2, rawBodiesStored: false },
    results,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ generatedAt: payload.generatedAt, sourceCount: payload.sourceCount, sampleCount: payload.sampleCount, output: OUTPUT_PATH }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runAudit().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
