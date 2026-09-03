import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_FIELD_AUDIT_OUTPUT || 'catalog-source-field-audit-v1.json';
const TIMEOUT_MS = Math.max(3_000, Math.min(45_000, Number(process.env.CATALOG_SOURCE_FIELD_AUDIT_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(150_000, Math.min(2_000_000, Number(process.env.CATALOG_SOURCE_FIELD_AUDIT_MAX_BODY_BYTES || 1_200_000)));
const USER_AGENT = 'AvtoCenaFieldAudit/1.1 (+read-only source qualification)';

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

const CHALLENGE_RE = /captcha|cloudflare|verify (?:that )?you are human|access denied|request blocked|robot check|security check|incapsula|imperva|edgeone|cf-chl|challenge-platform|pardon our interruption/i;
const LOGIN_RE = /(?:login required|sign in to continue|please (?:log in|login|sign in)|authentication required|members? only|must be logged in|로그인이 필요|로그인 후|请登录|登录后|ログインしてください|会員ログイン)/i;

const FIELD_KEY_RE = {
  make: /^(?:make|makeName|brand|brandName|manufacturer)$/i,
  model: /^(?:model|modelName|vehicleModel|vehicleModelName)$/i,
  year: /^(?:year|modelYear|vehicleModelDate|manufactureYear|registrationYear)$/i,
  price: /^(?:price|salePrice|sellingPrice|listingPrice|displayPrice|amount)$/i,
  currency: /^(?:priceCurrency|currency|currencyCode)$/i,
  body: /^(?:bodyType|bodyStyle|vehicleType|carType)$/i,
  fuel: /^(?:fuelType|fuel|fuelName|powertrain|powerTrain)$/i,
  engine: /^(?:engineDisplacement|engineSize|engineCapacity|displacement|engineCc|engineCC|cc)$/i,
  power: /^(?:horsepower|horsePower|powerHp|powerHP|enginePower|maxPower|maximumPower|power)$/i,
  certifiedPower: /^(?:certifiedPower|certifiedPowerKw|ratedPower|ratedPowerKw|continuousPower|continuousPowerKw|thirtyMinutePower|power30min|power30Minute)$/i,
  mileage: /^(?:mileage|odometer|mileageFromOdometer|kilometers|kilometres|kms|km)$/i,
  image: /^(?:image|images|photos|photoUrls|imageUrls|gallery)$/i,
};

const LABEL_RE = {
  make: /^(?:make|brand|manufacturer|제조사|브랜드)$/i,
  model: /^(?:model|차명|모델)$/i,
  year: /^(?:model year|year|연식|등록일|최초등록)$/i,
  price: /^(?:price|vehicle price|selling price|asking price|sale price|가격|판매가|판매가격|차량가격|매매가격)$/i,
  currency: /^(?:currency|통화)$/i,
  body: /^(?:vehicle type|body type|body style|차종|차체형식)$/i,
  fuel: /^(?:fuel type|fuel|연료)$/i,
  engine: /^(?:engine|engine size|engine capacity|displacement|배기량)$/i,
  power: /^(?:horsepower|engine power|power|max power|maximum power|마력|최대출력)$/i,
  certifiedPower: /^(?:certified power|rated power|continuous power|30[- ]?minute power|30분 출력|정격출력)$/i,
  mileage: /^(?:kilometers|kilometres|mileage|odometer|주행거리)$/i,
};

const SCRIPT_LOCAL_KEYS = {
  make: ['make', 'makeName', 'brand', 'brandName', 'manufacturer'],
  model: ['model', 'modelName', 'vehicleModel', 'vehicleModelName'],
  year: ['year', 'modelYear', 'vehicleModelDate', 'manufactureYear'],
  price: ['price', 'salePrice', 'sellingPrice', 'listingPrice', 'displayPrice'],
  currency: ['priceCurrency', 'currency', 'currencyCode'],
  body: ['bodyType', 'bodyStyle', 'vehicleType', 'carType'],
  fuel: ['fuelType', 'fuel', 'fuelName', 'powertrain', 'powerTrain'],
  engine: ['engineDisplacement', 'engineSize', 'engineCapacity', 'displacement', 'engineCc', 'engineCC'],
  power: ['horsepower', 'horsePower', 'powerHp', 'powerHP', 'enginePower', 'maxPower', 'maximumPower'],
  certifiedPower: ['certifiedPower', 'certifiedPowerKw', 'ratedPower', 'ratedPowerKw', 'continuousPower', 'continuousPowerKw', 'thirtyMinutePower', 'power30min'],
  mileage: ['mileage', 'odometer', 'mileageFromOdometer', 'kilometers', 'kilometres', 'kms'],
  image: ['image', 'images', 'photos', 'photoUrls', 'imageUrls', 'gallery'],
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
  return decodeHtml(String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleText(html) {
  return decodeHtml(String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const source = String(html || '');
  const raw = source.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]
    || source.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["']/i)?.[1]
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
    if (!body || body.length > 1_800_000) continue;
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (type !== 'application/ld+json' && type !== 'application/json' && id !== '__NEXT_DATA__') continue;
    try {
      out.push({ type, id, value: JSON.parse(body) });
    } catch {
      // Invalid JSON is not evidence.
    }
  }
  return out.slice(0, 30);
}

function walkObjects(value, path = '$', out = [], depth = 0) {
  if (depth > 12 || out.length > 18_000 || value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 300).forEach((item, index) => walkObjects(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push({ path, value });
  for (const [key, child] of Object.entries(value).slice(0, 300)) walkObjects(child, `${path}.${key}`, out, depth + 1);
  return out;
}

function nodeTypes(value) {
  const raw = value?.['@type'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => String(x).toLowerCase());
}

function structuredFieldHits(scripts) {
  const hits = Object.fromEntries(Object.keys(FIELD_KEY_RE).map((key) => [key, []]));
  for (const script of scripts) {
    for (const { path, value } of walkObjects(script.value)) {
      for (const [key, child] of Object.entries(value).slice(0, 300)) {
        for (const [field, re] of Object.entries(FIELD_KEY_RE)) {
          if (!re.test(key)) continue;
          const preview = scalarPreview(child);
          if (preview == null) continue;
          const record = { scriptType: script.type || null, scriptId: script.id || null, path: `${path}.${key}`, value: preview };
          if (!hits[field].some((x) => JSON.stringify(x) === JSON.stringify(record))) hits[field].push(record);
          if (hits[field].length > 50) hits[field].length = 50;
        }
      }
    }
  }
  return hits;
}

function vehicleJsonLd(scripts) {
  const nodes = [];
  for (const script of scripts.filter((row) => row.type === 'application/ld+json')) {
    for (const { path, value } of walkObjects(script.value)) {
      const types = nodeTypes(value);
      if (!types.some((type) => ['car', 'vehicle', 'product'].includes(type))) continue;
      const offers = Array.isArray(value.offers) ? value.offers[0] : value.offers;
      const engine = value.vehicleEngine || value.engine || null;
      const images = Array.isArray(value.image) ? value.image : value.image ? [value.image] : [];
      nodes.push({
        path,
        types,
        name: scalarPreview(value.name),
        sku: scalarPreview(value.sku),
        url: scalarPreview(value.url),
        brand: scalarPreview(value.brand?.name ?? value.brand),
        model: scalarPreview(value.model),
        vehicleModelDate: scalarPreview(value.vehicleModelDate ?? value.modelYear),
        bodyType: scalarPreview(value.bodyType),
        fuelType: scalarPreview(value.fuelType ?? engine?.fuelType),
        mileageFromOdometer: value.mileageFromOdometer ?? null,
        vehicleEngine: engine,
        offers: offers ?? null,
        imageCount: images.length,
        imageSample: images.slice(0, 12).map(String),
      });
    }
  }
  return nodes.slice(0, 12);
}

export function extractLabelPairs(html) {
  const pairs = [];
  const push = (label, value, source) => {
    const left = cleanText(label).replace(/[:：]+$/, '').trim();
    const right = cleanText(value).trim();
    if (!left || !right || left.length > 100 || right.length > 700) return;
    const record = { label: left, value: right, source };
    if (!pairs.some((x) => x.label === record.label && x.value === record.value)) pairs.push(record);
  };
  for (const match of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((x) => x[1]);
    if (cells.length >= 2) push(cells[0], cells.slice(1).join(' '), 'table');
  }
  for (const match of String(html || '').matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) push(match[1], match[2], 'dl');
  return pairs.slice(0, 350);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueRecords(rows, limit = 30) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractVisibleNamedFields(html) {
  const text = visibleText(html);
  const boundary = '(?=\\s+(?:Make|Brand|Manufacturer|Model|Model year|Year|Horsepower|Engine power|Max(?:imum)? power|Vehicle type|Body type|Body style|Fuel Type|Fuel|Engine size|Engine capacity|Displacement|Mileage|Odometer|Doors|Cylinders|Color|Transmission|Drive type|판매가격|차량가격|매매가격|연식|배기량|주행거리|연료|차종|차명|제조사|브랜드|최대출력|마력)\\b|$)';
  const fields = Object.fromEntries(Object.keys(LABEL_RE).map((key) => [key, []]));
  const specs = [
    ['make', '(?:Make|Brand|Manufacturer)', 80],
    ['model', '(?:Model)', 100],
    ['year', '(?:Model year|Year)', 40],
    ['price', '(?:Vehicle price|Selling price|Asking price|Sale price|판매가격|차량가격|매매가격|판매가)', 80],
    ['body', '(?:Vehicle type|Body type|Body style|차종|차체형식)', 100],
    ['fuel', '(?:Fuel Type|Fuel|연료)', 80],
    ['engine', '(?:Engine size|Engine capacity|Displacement|배기량)', 80],
    ['power', '(?:Horsepower|Engine power|Max(?:imum)? power|최대출력|마력)', 80],
    ['certifiedPower', '(?:Certified power|Rated power|Continuous power|30[- ]?minute power|30분 출력|정격출력)', 80],
    ['mileage', '(?:Mileage|Odometer|주행거리)', 80],
  ];
  for (const [field, label, max] of specs) {
    const re = new RegExp(`(?:^|\\s)(${label})\\s*[:：-]?\\s*(.{1,${max}}?)${boundary}`, 'gi');
    for (const match of text.matchAll(re)) {
      const value = match[2].replace(/\s+/g, ' ').trim();
      if (!value) continue;
      fields[field].push({ label: match[1], value, source: 'visible_named' });
    }
    fields[field] = uniqueRecords(fields[field], 20);
  }

  for (const match of text.matchAll(/(?:연식\s*)?((?:19|20)\d{2})(?:\.\d{1,2})?\s+배기량\s*([\d,]+)\s*cc\s*\(([\d,]+)\s*마력\)/g)) {
    fields.year.push({ label: '연식', value: match[1], source: 'visible_compound' });
    fields.engine.push({ label: '배기량', value: `${match[2]} cc`, source: 'visible_compound' });
    fields.power.push({ label: '마력', value: `${match[3]} 마력`, source: 'visible_compound' });
  }
  fields.year = uniqueRecords(fields.year, 20);
  fields.engine = uniqueRecords(fields.engine, 20);
  fields.power = uniqueRecords(fields.power, 20);
  return fields;
}

function textFieldHits(html) {
  const text = visibleText(html);
  const matches = (re, limit = 30) => [...text.matchAll(re)].slice(0, limit).map((m) => m[0].replace(/\s+/g, ' ').trim().slice(0, 300));
  return {
    price: matches(/(?:AED\s*[\d,.]+|[\d,.]+\s*(?:AED|₩|KRW|원|만원))/gi),
    year: matches(/\b(?:19|20)\d{2}\b/g),
    mileage: matches(/\b[\d,.]+\s*(?:km|kms|kilometers|kilometres|킬로미터)\b/gi),
    engine: matches(/(?:engine(?:\s+(?:size|capacity))?|displacement|배기량)\s*[:：-]?\s*[\d,.]+\s*(?:cc|cm3|cm³|l|ℓ)?/gi),
    power: matches(/(?:horsepower|engine power|max(?:imum)? power|power|마력|최대출력)\s*[:：-]?\s*[\d,.]+\s*(?:hp|ps|kw|마력)?/gi),
    certifiedPower: matches(/(?:certified power|rated power|continuous power|30[- ]?minute power|30분 출력|정격출력)\s*[:：-]?\s*[\d,.]+\s*(?:hp|ps|kw|마력)?/gi),
    fuel: matches(/(?:fuel type|fuel|연료)\s*[:：-]?\s*(?:petrol|gasoline|diesel|hybrid|electric|phev|hev|ev|가솔린|휘발유|경유|디젤|하이브리드|전기)/gi),
    body: matches(/(?:vehicle type|body type|body style|차종|차체형식)\s*[:：-]?\s*[A-Za-z가-힣/ -]{2,60}/gi),
  };
}

function boundedContexts(text, re, limit = 12) {
  const out = [];
  for (const match of String(text || '').matchAll(re)) {
    const start = Math.max(0, match.index - 140);
    const end = Math.min(text.length, match.index + match[0].length + 220);
    out.push(text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 420));
    if (out.length >= limit) break;
  }
  return [...new Set(out)];
}

function diagnosticContexts(html) {
  const text = visibleText(html);
  return {
    koreanPrice: boundedContexts(text, /(?:판매가격|차량가격|매매가격|판매가|[\d,.]+\s*만원)/g),
    power: boundedContexts(text, /(?:Horsepower|Engine power|Max(?:imum)? power|마력|최대출력)/gi),
    engine: boundedContexts(text, /(?:Engine size|Engine capacity|Displacement|배기량)/gi),
  };
}

function extractImages(html, baseUrl, sourceOfferId) {
  const values = [];
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(',')) values.push(safeUrl(part.trim().split(/\s+/)[0], baseUrl));
  }
  for (const match of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["']/gi)) values.push(safeUrl(match[1], baseUrl));
  for (const match of String(html || '').matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'`<>\\\s]*)?/gi)) values.push(safeUrl(match[0].replace(/\\\//g, '/'), baseUrl));
  const filtered = [...new Set(values.filter(Boolean))].filter((url) => !/(?:logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code)/i.test(url));
  const bound = sourceOfferId ? filtered.filter((url) => url.includes(sourceOfferId)) : [];
  return { totalUnique: filtered.length, listingIdBoundCount: bound.length, listingIdBoundSample: bound.slice(0, 12), samples: filtered.slice(0, 25) };
}

function vehicleJsonLdImageEvidence(nodes) {
  const counts = nodes.map((node) => node.imageCount || 0);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const sample = nodes.flatMap((node) => node.imageSample || []).slice(0, 15);
  return { maxVehicleNodeImageCount: maxCount, sample };
}

function scriptLocalEvidence(html, sourceOfferId) {
  const result = Object.fromEntries(Object.keys(SCRIPT_LOCAL_KEYS).map((key) => [key, []]));
  if (!sourceOfferId) return result;
  const source = String(html || '');
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = decodeHtml(match[1] || '');
    if (!body || body.length > 1_600_000 || !body.includes(sourceOfferId)) continue;
    const positions = [];
    let cursor = 0;
    while (positions.length < 8) {
      const index = body.indexOf(sourceOfferId, cursor);
      if (index < 0) break;
      positions.push(index);
      cursor = index + sourceOfferId.length;
    }
    for (const position of positions) {
      const context = body.slice(Math.max(0, position - 3_500), Math.min(body.length, position + 7_500));
      for (const [field, keys] of Object.entries(SCRIPT_LOCAL_KEYS)) {
        for (const key of keys) {
          const keyRe = escapeRegExp(key);
          const regexes = [
            new RegExp(`["']${keyRe}["']\\s*:\\s*["']([^"']{1,260})["']`, 'gi'),
            new RegExp(`["']${keyRe}["']\\s*:\\s*(-?[\\d.]{1,30})`, 'gi'),
          ];
          for (const re of regexes) {
            for (const hit of context.matchAll(re)) {
              result[field].push({ key, value: hit[1], source: 'offer_local_script' });
              if (result[field].length >= 24) break;
            }
          }
        }
        result[field] = uniqueRecords(result[field], 24);
      }
    }
  }
  return result;
}

function parseNumeric(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function exactFuel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/\belectric\b|\bev\b|전기/.test(text)) return 'electric';
  if (/phev|plug[- ]?in|플러그/.test(text)) return 'phev';
  if (/hybrid|hev|하이브리드/.test(text)) return 'hybrid';
  if (/diesel|디젤|경유/.test(text)) return 'diesel';
  if (/petrol|gasoline|가솔린|휘발유/.test(text)) return 'petrol';
  return null;
}

function evidenceValues(summary, field) {
  const rows = [];
  const add = (source, value, detail = null) => {
    if (value == null || value === '') return;
    rows.push({ source, value, ...(detail ? { detail } : {}) });
  };
  for (const node of summary.vehicleJsonLd || []) {
    if (field === 'make') add('vehicle_jsonld', node.brand, node.path);
    if (field === 'model') add('vehicle_jsonld', node.model, node.path);
    if (field === 'year') add('vehicle_jsonld', node.vehicleModelDate, node.path);
    if (field === 'body') add('vehicle_jsonld', node.bodyType, node.path);
    if (field === 'fuel') add('vehicle_jsonld', node.fuelType, node.path);
    if (field === 'price') add('vehicle_jsonld', node.offers?.price, node.path);
    if (field === 'currency') add('vehicle_jsonld', node.offers?.priceCurrency, node.path);
    if (field === 'engine') add('vehicle_jsonld', node.vehicleEngine?.engineDisplacement ?? node.vehicleEngine?.displacement, node.path);
    if (field === 'power') add('vehicle_jsonld', node.vehicleEngine?.enginePower ?? node.vehicleEngine?.horsepower ?? node.vehicleEngine?.power, node.path);
    if (field === 'certifiedPower') add('vehicle_jsonld', node.vehicleEngine?.ratedPower ?? node.vehicleEngine?.certifiedPower ?? node.vehicleEngine?.continuousPower, node.path);
  }
  for (const row of summary.labelFieldHits?.[field] || []) add('named_table', row.value, row.label);
  for (const row of summary.visibleNamedFieldHits?.[field] || []) add(row.source, row.value, row.label);
  for (const row of summary.scriptLocalFieldHits?.[field] || []) add(row.source, row.value, row.key);
  return uniqueRecords(rows, 40);
}

function evidenceState(summary, field) {
  const values = evidenceValues(summary, field);
  if (field === 'identity') {
    return summary.sourceOfferId && /^https?:\/\//.test(summary.finalUrl || '')
      ? { state: 'exact', evidence: [{ source: 'url', value: summary.sourceOfferId }] }
      : { state: 'missing', evidence: [] };
  }
  if (field === 'gallery') {
    const jsonLdCount = summary.galleryEvidence?.vehicleJsonLd?.maxVehicleNodeImageCount || 0;
    const idCount = summary.images?.listingIdBoundCount || 0;
    const count = Math.max(jsonLdCount, idCount);
    return count >= 5
      ? { state: 'exact', evidence: [{ source: jsonLdCount >= idCount ? 'vehicle_jsonld_images' : 'offer_id_bound_images', value: String(count) }] }
      : count > 0
        ? { state: 'partial', evidence: [{ source: jsonLdCount >= idCount ? 'vehicle_jsonld_images' : 'offer_id_bound_images', value: String(count) }] }
        : { state: 'missing', evidence: [] };
  }
  if (field === 'engineCc') {
    const fuel = evidenceValues(summary, 'fuel').map((row) => exactFuel(row.value)).find(Boolean);
    if (fuel === 'electric') return { state: 'not_applicable', evidence: [{ source: 'fuel', value: 'electric' }] };
    const engineValues = evidenceValues(summary, 'engine');
    const normalized = [];
    for (const row of engineValues) {
      const raw = String(row.value);
      const number = parseNumeric(raw);
      if (!(number > 0)) continue;
      if (/\bcc\b|cm3|cm³/i.test(raw)) normalized.push({ source: row.source, value: String(Math.round(number)), raw });
      else if (/\b(?:l|ℓ|litre|liter)\b/i.test(raw)) normalized.push({ source: row.source, value: String(Math.round(number * 1000)), raw });
      else normalized.push({ source: row.source, value: null, raw, unitMissing: true });
    }
    const exact = normalized.filter((row) => row.value);
    if (exact.length) return { state: 'exact', evidence: uniqueRecords(exact, 10) };
    if (normalized.length) return { state: 'ambiguous', evidence: uniqueRecords(normalized, 10) };
    return { state: 'missing', evidence: [] };
  }
  if (field === 'powerHp') {
    const rows = evidenceValues(summary, 'power');
    if (!rows.length) return { state: 'missing', evidence: [] };
    const exact = [];
    const ambiguous = [];
    for (const row of rows) {
      const raw = String(row.value);
      const number = parseNumeric(raw);
      if (!(number > 0)) continue;
      if (/\b(?:hp|bhp|ps)\b|마력/i.test(raw)) exact.push({ source: row.source, value: String(number), raw });
      else if (/\bkw\b/i.test(raw)) exact.push({ source: row.source, value: String(Math.round(number * 1.3596216173)), raw, convertedFromKw: true });
      else ambiguous.push({ source: row.source, raw, unitMissing: true });
    }
    if (exact.length) return { state: 'exact', evidence: uniqueRecords(exact, 10) };
    if (ambiguous.length) return { state: 'ambiguous', evidence: uniqueRecords(ambiguous, 10) };
    return { state: 'missing', evidence: [] };
  }
  if (field === 'certifiedPower') {
    const fuel = evidenceValues(summary, 'fuel').map((row) => exactFuel(row.value)).find(Boolean);
    if (!['electric', 'hybrid', 'phev'].includes(fuel)) return { state: 'not_applicable', evidence: fuel ? [{ source: 'fuel', value: fuel }] : [] };
    const rows = evidenceValues(summary, 'certifiedPower');
    return rows.length ? { state: 'exact', evidence: rows.slice(0, 10) } : { state: 'missing', evidence: [] };
  }
  const rows = evidenceValues(summary, field);
  if (!rows.length) return { state: 'missing', evidence: [] };
  const serializedValues = [...new Set(rows.map((row) => String(row.value).trim().toLowerCase()).filter(Boolean))];
  return { state: serializedValues.length === 1 ? 'exact' : 'multiple_evidence', evidence: rows.slice(0, 10) };
}

function buildFieldMatrix(summary) {
  const matrix = {};
  for (const field of ['identity', 'make', 'model', 'year', 'price', 'currency', 'body', 'fuel', 'engineCc', 'powerHp', 'certifiedPower', 'gallery']) {
    matrix[field] = evidenceState(summary, field);
  }
  const required = ['identity', 'make', 'model', 'year', 'price', 'currency', 'body', 'fuel', 'engineCc', 'powerHp', 'certifiedPower', 'gallery'];
  const acceptable = new Set(['exact', 'not_applicable']);
  return {
    fields: matrix,
    exactReady: required.every((field) => acceptable.has(matrix[field].state)),
    missingOrAmbiguous: required.filter((field) => !acceptable.has(matrix[field].state)),
  };
}

function summarizeBody(html, finalUrl) {
  const scripts = parseJsonScripts(html);
  const sourceOfferId = sourceOfferIdFromUrl(finalUrl);
  const nodes = vehicleJsonLd(scripts);
  const pairs = extractLabelPairs(html);
  const summary = {
    finalUrl,
    title: titleOf(html),
    canonicalUrl: canonicalOf(html, finalUrl),
    sourceOfferId,
    challengeDetected: CHALLENGE_RE.test(`${titleOf(html)} ${visibleText(html).slice(0, 20_000)}`),
    loginDetected: LOGIN_RE.test(visibleText(html).slice(0, 40_000)),
    vehicleJsonLd: nodes,
    structuredFieldHits: structuredFieldHits(scripts),
    labelFieldHits: labelFieldHits(pairs),
    visibleNamedFieldHits: extractVisibleNamedFields(html),
    scriptLocalFieldHits: scriptLocalEvidence(html, sourceOfferId),
    textFieldHits: textFieldHits(html),
    labelPairsSample: pairs.slice(0, 50),
    diagnosticContexts: diagnosticContexts(html),
    images: extractImages(html, finalUrl, sourceOfferId),
    galleryEvidence: { vehicleJsonLd: vehicleJsonLdImageEvidence(nodes) },
  };
  summary.fieldMatrix = buildFieldMatrix(summary);
  summary.evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    finalUrl: summary.finalUrl,
    sourceOfferId: summary.sourceOfferId,
    vehicleJsonLd: summary.vehicleJsonLd,
    visibleNamedFieldHits: summary.visibleNamedFieldHits,
    scriptLocalFieldHits: summary.scriptLocalFieldHits,
    labelFieldHits: summary.labelFieldHits,
    fieldMatrix: summary.fieldMatrix,
    images: {
      listingIdBoundCount: summary.images.listingIdBoundCount,
      vehicleJsonLdCount: summary.galleryEvidence.vehicleJsonLd.maxVehicleNodeImageCount,
    },
  })).digest('hex');
  return summary;
}

const robotsCache = new Map();

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function robotsFor(url) {
  const origin = new URL(url).origin;
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const robotsUrl = `${origin}/robots.txt`;
  let result;
  try {
    const response = await fetchWithTimeout(robotsUrl, { headers: HEADERS, redirect: 'follow' });
    const text = (await response.text()).slice(0, 500_000);
    result = { status: response.status, finalUrl: response.url, text: response.ok ? text : '' };
  } catch (error) {
    result = { status: null, finalUrl: robotsUrl, text: '', error: String(error?.message || error) };
  }
  robotsCache.set(origin, result);
  return result;
}

async function requestDetail(requestUrl) {
  let current = requestUrl;
  const redirects = [];
  const robotsEvidence = [];
  for (let hop = 0; hop < 6; hop++) {
    const robots = await robotsFor(current);
    const policy = robots.text ? evaluateRobots(robots.text, current, USER_AGENT) : { allowed: true, matchedRule: null, applicableGroupCount: 0 };
    robotsEvidence.push({ url: current, robotsStatus: robots.status, allowed: policy.allowed, matchedRule: policy.matchedRule });
    if (!policy.allowed) return { kind: 'robots_disallowed', requestUrl, finalUrl: current, redirects, robots: robotsEvidence };

    let response;
    try {
      response = await fetchWithTimeout(current, { headers: HEADERS, redirect: 'manual' });
    } catch (error) {
      return { kind: 'network_error', requestUrl, finalUrl: current, redirects, robots: robotsEvidence, error: String(error?.message || error) };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = safeUrl(response.headers.get('location'), current);
      if (!next) return { kind: 'bad_redirect', requestUrl, finalUrl: current, redirects, robots: robotsEvidence, status: response.status };
      redirects.push({ from: current, to: next, status: response.status });
      current = next;
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
    const summary = summarizeBody(body, response.url || current);
    return {
      kind: summary.challengeDetected ? 'challenge' : summary.loginDetected ? 'login_wall' : response.ok ? 'reachable' : 'http_error',
      requestUrl,
      finalUrl: response.url || current,
      redirects,
      robots: robotsEvidence,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || '',
      bytes: bytes.length,
      truncated: bytes.length > MAX_BODY_BYTES,
      bodyHashSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      summary,
    };
  }
  return { kind: 'redirect_loop', requestUrl, finalUrl: current, redirects, robots: robotsEvidence };
}

function sampleEnvelope(market, sourceId, requestedUrl, first, second) {
  const firstFingerprint = first?.summary?.evidenceFingerprint || null;
  const secondFingerprint = second?.summary?.evidenceFingerprint || null;
  const stable = Boolean(
    first?.kind === 'reachable'
    && second?.kind === 'reachable'
    && first?.finalUrl === second?.finalUrl
    && firstFingerprint
    && firstFingerprint === secondFingerprint,
  );
  return {
    market,
    sourceId,
    requestedUrl,
    first,
    second,
    repeat: {
      stable,
      sameFinalUrl: first?.finalUrl === second?.finalUrl,
      sameBodyHash: first?.bodyHashSha256 && first?.bodyHashSha256 === second?.bodyHashSha256,
      firstFingerprint,
      secondFingerprint,
    },
    classificationMutation: false,
    publishAllowedMutation: false,
  };
}

function sourceVerdict(source) {
  const samples = source.samples || [];
  const stableReachable = samples.every((sample) => sample.repeat?.stable);
  const exactReady = samples.length > 0 && samples.every((sample) => sample.first?.summary?.fieldMatrix?.exactReady === true);
  const deficits = {};
  for (const sample of samples) {
    for (const field of sample.first?.summary?.fieldMatrix?.missingOrAmbiguous || []) deficits[field] = (deficits[field] || 0) + 1;
  }
  return {
    stableReachable,
    exactReady,
    sampleCount: samples.length,
    deficitCounts: deficits,
    classificationDecision: 'deferred',
    reason: exactReady
      ? 'mechanical source-bound completeness passed on samples; manual semantic audit still required before classification'
      : 'source-bound completeness not proven on all audited samples',
  };
}

async function runWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

export async function runAudit() {
  const flatSamples = SAMPLES.flatMap((source) => source.urls.map((url) => ({ market: source.market, sourceId: source.sourceId, url })));
  const sampleRows = await runWithConcurrency(flatSamples, 3, async ({ market, sourceId, url }) => {
    const first = await requestDetail(url);
    const second = await requestDetail(url);
    return sampleEnvelope(market, sourceId, url, first, second);
  });

  const results = SAMPLES.map((source) => {
    const row = {
      market: source.market,
      sourceId: source.sourceId,
      samples: sampleRows.filter((sample) => sample.sourceId === source.sourceId),
    };
    return { ...row, sourceVerdict: sourceVerdict(row) };
  });

  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: 'source_bound_field_audit_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    sourceCount: SAMPLES.length,
    sampleCount: flatSamples.length,
    settings: { timeoutMs: TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES, repeatFetches: 2, userAgent: USER_AGENT },
    results,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    generatedAt: payload.generatedAt,
    sourceCount: payload.sourceCount,
    sampleCount: payload.sampleCount,
    sources: results.map((row) => ({ sourceId: row.sourceId, ...row.sourceVerdict })),
    output: OUTPUT_PATH,
  }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runAudit().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
