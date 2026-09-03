import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { extractLabelPairs, sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';
import { extractRouteCandidates } from './catalog-source-deficit-recon-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_PARTIAL_FIELD_AUDIT_OUTPUT || 'catalog-source-partial-field-audit-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_PARTIAL_FIELD_AUDIT_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(200000, Math.min(2000000, Number(process.env.CATALOG_SOURCE_PARTIAL_FIELD_AUDIT_MAX_BODY_BYTES || 1400000)));
const USER_AGENT = 'AvtoCenaPartialFieldAudit/1.0 (+read-only source qualification)';

const SAMPLES = [
  {
    market: 'japan',
    sourceId: 'carvector_japan_stat_open',
    url: 'https://carvector.com/stat/hitachi/ex55ur-3/ab29a1a3-d845-41fb-a9f8-20a7e4282c6f',
    knownConcern: 'auction_statistics_mixed_category_sample_and_single_image',
  },
  {
    market: 'china',
    sourceId: 'chngoodcar_china_candidate',
    url: 'https://www.chngoodcar.com/Home/Cars?id=1245159140309858930',
    knownConcern: 'currency_fuel_engine_body_unproven',
  },
  {
    market: 'china',
    sourceId: 'iautos_china_candidate',
    url: 'https://m.iautos.cn/usedcar-15501828.html',
    knownConcern: 'fuel_power_unproven',
  },
  {
    market: 'japan',
    sourceId: 'exportcar_japan_candidate',
    url: 'https://exportcar.jp/auto/?id=27qDVYVBkJg1fdu',
    knownConcern: 'detail_page_low_signal',
  },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,ja;q=0.7,ru;q=0.5',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const FIELD_KEYS = {
  make: /^(?:make|makeName|brand|brandName|manufacturer|品牌|厂牌|メーカー)$/i,
  model: /^(?:model|modelName|vehicleModel|vehicleModelName|车系|车型名称|型号|モデル|車名)$/i,
  year: /^(?:year|modelYear|vehicleModelDate|manufactureYear|registrationYear|年款|年份|上牌年份|年式)$/i,
  price: /^(?:price|salePrice|sellingPrice|listingPrice|displayPrice|amount|售价|价格|报价|車両価格|価格)$/i,
  currency: /^(?:priceCurrency|currency|currencyCode|币种|通貨)$/i,
  body: /^(?:bodyType|bodyStyle|vehicleType|carType|车身结构|车身形式|车型|ボディタイプ|ボディ)$/i,
  fuel: /^(?:fuelType|fuel|fuelName|能源类型|燃料类型|燃油类型|燃料|燃料種別)$/i,
  engine: /^(?:engineDisplacement|engineSize|engineCapacity|displacement|engineCc|engineCC|排量|发动机排量|排気量)$/i,
  power: /^(?:horsepower|horsePower|powerHp|powerHP|enginePower|maxPower|maximumPower|power|最大功率|马力|功率|最高出力|馬力)$/i,
  mileage: /^(?:mileage|odometer|mileageFromOdometer|kilometers|kilometres|kms|km|里程|行驶里程|表显里程|走行距離)$/i,
  image: /^(?:image|images|photos|photoUrls|imageUrls|gallery|图片|照片|画像)$/i,
};

const LABEL_PATTERNS = {
  make: /^(?:make|brand|manufacturer|品牌|厂牌|メーカー)$/i,
  model: /^(?:model|车型|车系|型号|車名|モデル)$/i,
  year: /^(?:year|model year|年份|年款|上牌时间|首次上牌|年式|初度登録)$/i,
  price: /^(?:price|selling price|vehicle price|价格|售价|报价|価格|車両価格)$/i,
  currency: /^(?:currency|币种|通貨)$/i,
  body: /^(?:body|body type|body style|vehicle type|车身结构|车身形式|ボディ|ボディタイプ)$/i,
  fuel: /^(?:fuel|fuel type|能源类型|燃料类型|燃油类型|燃料|燃料種別)$/i,
  engine: /^(?:engine|engine size|engine capacity|displacement|排量|发动机排量|排気量)$/i,
  power: /^(?:power|engine power|horsepower|max power|maximum power|最大功率|马力|功率|最高出力|馬力)$/i,
  mileage: /^(?:mileage|odometer|里程|行驶里程|表显里程|走行距離)$/i,
};

const CURRENCY_RE = /(?:\bCNY\b|\bRMB\b|人民币|万元|元|¥|￥|\bJPY\b|円|万円|\bUSD\b|US\$|\$)/i;
const ENGINE_UNIT_RE = /\b(\d{2,5}(?:\.\d+)?)\s*(cc|cm3|cm³)\b|\b(\d(?:\.\d+)?)\s*(L|lit(?:er|re)s?)\b/gi;
const POWER_UNIT_RE = /\b(\d{2,4}(?:\.\d+)?)\s*(hp|bhp|ps|kW|kw)\b|(\d{2,4})\s*(?:马力|馬力)/gi;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const PRICE_RE = /(?:CNY|RMB|JPY|USD|US\$|¥|￥|円|万元|元|万円|\$)\s*[\d,.]+|[\d,.]+\s*(?:CNY|RMB|JPY|USD|万元|元|円|万円)/gi;
const FUEL_VALUE_RE = /(?:petrol|gasoline|diesel|hybrid|electric|phev|hev|ev\b|汽油|柴油|混合动力|混动|纯电|电动|新能源|ガソリン|ディーゼル|ハイブリッド|電気)/i;
const BODY_VALUE_RE = /(?:sedan|saloon|suv|crossover|hatchback|wagon|estate|coupe|convertible|minivan|van|pickup|轿车|两厢|三厢|旅行车|跑车|SUV|MPV|セダン|ハッチバック|ワゴン|クーペ|SUV|ミニバン)/i;
const STATISTICS_RE = /(?:statistics|auction statistics|auction history|落札|統計|starting at)/i;
const HEAVY_MACHINERY_RE = /(?:excavator|construction machinery|heavy machinery|forklift|loader|bulldozer|crane|hitachi\s+ex\d|komatsu\s+pc\d|caterpillar\s+\d)/i;
const GENERIC_SHELL_RE = /^(?:auto auctions?|auction|used cars?|cars?)$/i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(value, limit = 1000) {
  return decodeHtml(String(value ?? ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function visibleText(html) {
  return cleanText(String(html || '')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), 240000);
}

function titleOf(html) {
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 320);
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

function canonicalOf(html, base) {
  const raw = String(html || '').match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]
    || String(html || '').match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["']/i)?.[1]
    || null;
  return raw ? safeUrl(raw, base) : null;
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

function scalarPreview(value) {
  if (value == null) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value).slice(0, 500);
  if (Array.isArray(value) && value.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) return value.slice(0, 30).map(String);
  return null;
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
      // Invalid JSON is not promoted to structured evidence.
    }
  }
  return out.slice(0, 40);
}

function walkObjects(value, path = '$', out = [], depth = 0) {
  if (depth > 14 || out.length >= 20000 || value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 300).forEach((item, index) => walkObjects(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push({ path, value });
  for (const [key, child] of Object.entries(value).slice(0, 300)) walkObjects(child, `${path}.${key}`, out, depth + 1);
  return out;
}

function structuredFieldHits(scripts) {
  const hits = Object.fromEntries(Object.keys(FIELD_KEYS).map((field) => [field, []]));
  for (const script of scripts) {
    for (const { path, value } of walkObjects(script.value)) {
      for (const [key, child] of Object.entries(value).slice(0, 300)) {
        for (const [field, re] of Object.entries(FIELD_KEYS)) {
          if (!re.test(key)) continue;
          const preview = scalarPreview(child);
          if (preview == null) continue;
          hits[field].push({ scriptType: script.type || null, scriptId: script.id || null, path: `${path}.${key}`, key, value: preview });
        }
      }
    }
  }
  for (const field of Object.keys(hits)) hits[field] = uniq(hits[field], 50);
  return hits;
}

function nodeTypes(value) {
  const raw = value?.['@type'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => String(x).toLowerCase());
}

function vehicleJsonLd(scripts) {
  const rows = [];
  for (const script of scripts.filter((x) => x.type === 'application/ld+json')) {
    for (const { path, value } of walkObjects(script.value)) {
      const types = nodeTypes(value);
      if (!types.some((x) => ['car', 'vehicle', 'product'].includes(x))) continue;
      rows.push({
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
        image: Array.isArray(value.image) ? value.image.slice(0, 30) : value.image ?? null,
      });
    }
  }
  return rows.slice(0, 20);
}

function inlineLabelPairs(html) {
  const out = [];
  const push = (label, value, source) => {
    const l = cleanText(label, 100).replace(/[:：]+$/, '').trim();
    const v = cleanText(value, 500);
    if (!l || !v || l.length > 100 || v.length > 500) return;
    if (Object.values(LABEL_PATTERNS).some((re) => re.test(l))) out.push({ label: l, value: v, source });
  };
  for (const match of String(html || '').matchAll(/<(?:div|li|p|span)\b[^>]*>([\s\S]{0,180}?)<\/(?:div|li|p|span)>/gi)) {
    const text = cleanText(match[1], 260);
    const pair = text.match(/^([^:：]{1,80})[:：]\s*(.{1,180})$/);
    if (pair) push(pair[1], pair[2], 'inline-colon');
  }
  return uniq(out, 200);
}

function namedPairHits(pairs) {
  const hits = Object.fromEntries(Object.keys(LABEL_PATTERNS).map((field) => [field, []]));
  for (const pair of pairs) {
    for (const [field, re] of Object.entries(LABEL_PATTERNS)) {
      if (re.test(pair.label)) hits[field].push(pair);
    }
  }
  for (const field of Object.keys(hits)) hits[field] = uniq(hits[field], 50);
  return hits;
}

function explicitUnitEvidence(html) {
  const text = visibleText(html);
  const engine = [];
  const power = [];
  for (const match of text.matchAll(new RegExp(ENGINE_UNIT_RE.source, 'gi'))) {
    const idx = match.index ?? 0;
    engine.push({ match: match[0], context: text.slice(Math.max(0, idx - 140), Math.min(text.length, idx + 260)).trim() });
  }
  for (const match of text.matchAll(new RegExp(POWER_UNIT_RE.source, 'gi'))) {
    const idx = match.index ?? 0;
    power.push({ match: match[0], context: text.slice(Math.max(0, idx - 140), Math.min(text.length, idx + 260)).trim() });
  }
  return { engine: uniq(engine, 40), power: uniq(power, 40) };
}

function visibleSignals(html) {
  const text = visibleText(html);
  return {
    year: uniq([...text.matchAll(new RegExp(YEAR_RE.source, 'g'))].map((m) => m[0]), 20),
    price: uniq([...text.matchAll(new RegExp(PRICE_RE.source, 'gi'))].map((m) => m[0]), 30),
    currencyPresent: CURRENCY_RE.test(text),
    fuelContexts: uniq(text.split(/\s*[|·•\n]\s*/).filter((x) => FUEL_VALUE_RE.test(x)).map((x) => x.slice(0, 240)), 30),
    bodyContexts: uniq(text.split(/\s*[|·•\n]\s*/).filter((x) => BODY_VALUE_RE.test(x)).map((x) => x.slice(0, 240)), 30),
  };
}

function extractImages(html, baseUrl) {
  const urls = [];
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const raw of String(match[1] || '').split(',').map((x) => x.trim().split(/\s+/)[0])) {
      const url = safeUrl(raw, baseUrl);
      if (url && IMAGE_EXT_RE.test(url)) urls.push(url);
    }
  }
  for (const match of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["']/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (url && IMAGE_EXT_RE.test(url)) urls.push(url);
  }
  return uniq(urls, 250);
}

function normalizeImageIdentity(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return `${parsed.host}${parsed.pathname}`
      .replace(/\/(?:thumb|thumbnail|small|medium|large|w_\d+x\d+|\d+x\d+)\//gi, '/')
      .replace(/[-_](?:thumb|small|medium|large)(?=\.)/gi, '');
  } catch {
    return url;
  }
}

function galleryEvidence(html, baseUrl, offerId) {
  const images = extractImages(html, baseUrl);
  const identities = uniq(images.map(normalizeImageIdentity), 250);
  const source = decodeHtml(String(html || ''));
  const scoped = [];
  if (offerId) {
    let from = 0;
    let hits = 0;
    while (hits < 8) {
      const idx = source.indexOf(String(offerId), from);
      if (idx < 0) break;
      const fragment = source.slice(Math.max(0, idx - 8000), Math.min(source.length, idx + 18000));
      const fragImages = extractImages(fragment, baseUrl);
      const fragIds = uniq(fragImages.map(normalizeImageIdentity), 100);
      if (fragIds.length) scoped.push({ offerIdInFragment: true, uniqueImageCount: fragIds.length, imageSample: fragIds.slice(0, 15) });
      from = idx + String(offerId).length;
      hits += 1;
    }
  }
  return {
    totalUniqueImages: identities.length,
    imageSample: identities.slice(0, 20),
    offerScopedClusters: uniq(scoped, 10),
  };
}

export function pageRoleDiagnostics({ title, html, imageCount }) {
  const text = visibleText(html);
  return {
    statisticsLanguage: STATISTICS_RE.test(`${title} ${text.slice(0, 12000)}`),
    heavyMachineryLanguage: HEAVY_MACHINERY_RE.test(`${title} ${text.slice(0, 12000)}`),
    genericShellTitle: GENERIC_SHELL_RE.test(title.trim()),
    imageCount,
    oneOrFewerImages: imageCount <= 1,
  };
}

function evidenceCoverage(structured, pairs, units, gallery, role) {
  const fields = ['make', 'model', 'year', 'price', 'currency', 'body', 'fuel', 'engine', 'power', 'mileage'];
  const named = {};
  for (const field of fields) named[field] = Boolean(structured[field]?.length || pairs[field]?.length);
  return {
    named,
    explicitEngineUnit: units.engine.length > 0,
    explicitPowerUnit: units.power.length > 0,
    galleryAtLeastFiveTotal: gallery.totalUniqueImages >= 5,
    offerScopedGalleryAtLeastFive: gallery.offerScopedClusters.some((x) => x.uniqueImageCount >= 5),
    pageRoleConcern: role.statisticsLanguage || role.heavyMachineryLanguage || role.genericShellTitle,
  };
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
    const response = await fetchWithTimeout(robotsUrl, { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimitedBody(response)).body : '';
    const out = { status: response.status, text };
    robotsCache.set(robotsUrl, out);
    return out;
  } catch (error) {
    const out = { status: null, text: '', error: String(error?.message || error) };
    robotsCache.set(robotsUrl, out);
    return out;
  }
}

function summarizeBody(body, sample) {
  const title = titleOf(body);
  const canonical = canonicalOf(body, sample.url);
  const sourceOfferId = sourceOfferIdFromUrl(canonical || sample.url);
  const scripts = parseJsonScripts(body);
  const structured = structuredFieldHits(scripts);
  const pairs = namedPairHits([...extractLabelPairs(body), ...inlineLabelPairs(body)]);
  const units = explicitUnitEvidence(body);
  const gallery = galleryEvidence(body, sample.url, sourceOfferId);
  const role = pageRoleDiagnostics({ title, html: body, imageCount: gallery.totalUniqueImages });
  const visible = visibleSignals(body);
  const routes = extractRouteCandidates(body, sample.url, sourceOfferId || '', 30);
  const coverage = evidenceCoverage(structured, pairs, units, gallery, role);
  const summary = {
    title,
    canonical,
    sourceOfferId,
    vehicleJsonLd: vehicleJsonLd(scripts),
    structuredFields: structured,
    namedPairs: pairs,
    explicitUnits: units,
    visibleSignals: visible,
    gallery,
    pageRole: role,
    coverage,
    discoveredSameOriginRoutes: routes,
  };
  summary.evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  return summary;
}

async function fetchSample(sample) {
  const robots = await robotsFor(sample.url);
  const policy = evaluateRobots(robots.text, sample.url, USER_AGENT);
  if (!policy.allowed) {
    return { kind: 'robots_disallowed', robotsStatus: robots.status, matchedRule: policy.matchedRule };
  }
  let response;
  try {
    response = await fetchWithTimeout(sample.url, { headers: HEADERS, redirect: 'manual' });
  } catch (error) {
    return { kind: 'network_error', error: String(error?.message || error), robotsStatus: robots.status };
  }
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'redirect_not_followed', status: response.status, location: response.headers.get('location'), robotsStatus: robots.status };
  }
  const { body, truncated } = await readLimitedBody(response);
  return {
    kind: response.ok ? 'reachable' : 'http_error',
    status: response.status,
    contentType: response.headers.get('content-type'),
    truncated,
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
    summary: summarizeBody(body, sample),
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

export async function runPartialFieldAudit() {
  const results = [];
  for (const sample of SAMPLES) results.push(await runOne(sample));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'partial_signal_source_bound_field_audit_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourceCount: SAMPLES.length,
    sampleCount: SAMPLES.length,
    results,
    next: 'review repeated source-bound evidence; only strong candidates receive a separately discovered second-offer or same-origin route probe',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, sourceCount: payload.sourceCount, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runPartialFieldAudit().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
