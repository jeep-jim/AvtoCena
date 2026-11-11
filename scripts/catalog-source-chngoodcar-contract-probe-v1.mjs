import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_CONTRACT_OUTPUT || 'catalog-source-chngoodcar-contract-probe-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CONTRACT_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(200000, Math.min(1800000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CONTRACT_MAX_BODY_BYTES || 1300000)));
const USER_AGENT = 'AvtoCenaGoodCarContractProbe/1.0 (+read-only source qualification)';

const SAMPLES = [
  'https://www.chngoodcar.com/Home/Cars?id=1245159140309858930',
  'https://www.chngoodcar.com/Home/Cars?id=1265916925100158976',
  'https://www.chngoodcar.com/Home/Cars?id=1265916910290071552',
  'https://www.chngoodcar.com/Home/Cars?id=1288729215201439744',
].map((url) => ({ market: 'china', sourceId: 'chngoodcar_china_candidate', url, routeOrigin: 'known_sample_or_discovered_in_run_33747985524' }));

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i;
const CURRENCY_TOKEN_RE = /(?:\bUSD\b|US\$|美元|\bCNY\b|\bRMB\b|人民币|￥|¥|\$)/gi;

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

function clean(value, limit = 1000) {
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

function extractImages(fragment, baseUrl) {
  const out = [];
  for (const match of String(fragment || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const raw of String(match[1] || '').split(',').map((x) => x.trim().split(/\s+/)[0])) {
      const url = safeUrl(raw, baseUrl);
      if (url && IMAGE_EXT_RE.test(url)) out.push(url);
    }
  }
  return uniq(out, 200);
}

function normalizeImageIdentity(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function visibleCoreSegment(decodedHtml) {
  const text = clean(decodedHtml
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), 260000);
  const stockIdx = text.indexOf('库存');
  if (stockIdx < 0) return text.slice(0, 12000);
  const start = Math.max(0, stockIdx - 500);
  const recIdx = text.indexOf('猜你喜欢', stockIdx);
  const end = recIdx >= 0 ? recIdx : Math.min(text.length, stockIdx + 9000);
  return text.slice(start, end).trim();
}

function htmlCoreSegment(decodedHtml) {
  const stockIdx = decodedHtml.indexOf('库存');
  if (stockIdx < 0) return decodedHtml.slice(0, 50000);
  const start = Math.max(0, stockIdx - 15000);
  const recIdx = decodedHtml.indexOf('猜你喜欢', stockIdx);
  const end = recIdx >= 0 ? recIdx : Math.min(decodedHtml.length, stockIdx + 70000);
  return decodedHtml.slice(start, end);
}

function firstMatch(text, re, map = (x) => x) {
  const match = text.match(re);
  return match ? map(match) : null;
}

export function extractOfferCoreContract(html, baseUrl) {
  const decoded = decodeHtml(String(html || ''));
  const coreText = visibleCoreSegment(decoded);
  const coreHtml = htmlCoreSegment(decoded);
  const images = uniq(extractImages(coreHtml, baseUrl).map(normalizeImageIdentity), 100);
  const wholeVisible = clean(decoded, 260000);
  const contract = {
    priceRaw: firstMatch(coreText, /([\d,.]+)\s+库存[:：]?\s*\d+\s*辆/, (m) => m[1]),
    currencyTokensInCore: uniq([...coreText.matchAll(new RegExp(CURRENCY_TOKEN_RE.source, 'gi'))].map((m) => m[0]), 20),
    currencyTokensOnPage: uniq([...wholeVisible.matchAll(new RegExp(CURRENCY_TOKEN_RE.source, 'gi'))].map((m) => m[0]), 20),
    bodyType: firstMatch(coreText, /车型\s+(轿车|SUV|MPV|两厢车|三厢车|旅行车|跑车|皮卡|面包车)/i, (m) => m[1]),
    vehicleType: firstMatch(coreText, /车辆类型\s+([^\s]{2,12})/, (m) => m[1]),
    vin: firstMatch(coreText, /VIN码\s+([A-HJ-NPR-Z0-9]{11,17})/i, (m) => m[1]),
    manufactureYearMonth: firstMatch(coreText, /出厂年份\s+(\d{4}-\d{2})/, (m) => m[1]),
    mileageKm: firstMatch(coreText, /里程\s*\(km\)\s*(\d+)/i, (m) => Number(m[1])),
    displacementMl: firstMatch(coreText, /排量\s*\(ml\)\s*(\d+)/i, (m) => Number(m[1])),
    powerKw: firstMatch(coreText, /功率\s*\(kw\)\s*([\d.]+)/i, (m) => Number(m[1])),
    fuel: firstMatch(coreText, /燃料种类\s+([^\s]{1,12})/, (m) => m[1]),
    transmission: firstMatch(coreText, /变速箱\s+([^\s]{1,16})/, (m) => m[1]),
    doors: firstMatch(coreText, /门数\s+(\d+)/, (m) => Number(m[1])),
    seats: firstMatch(coreText, /座位数\s+(\d+)/, (m) => Number(m[1])),
    coreImageCount: images.length,
    coreImageSample: images.slice(0, 20),
    coreTextPreview: coreText.slice(0, 2000),
  };
  contract.evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    priceRaw: contract.priceRaw,
    currencyTokensInCore: contract.currencyTokensInCore,
    bodyType: contract.bodyType,
    vehicleType: contract.vehicleType,
    vin: contract.vin,
    manufactureYearMonth: contract.manufactureYearMonth,
    mileageKm: contract.mileageKm,
    displacementMl: contract.displacementMl,
    powerKw: contract.powerKw,
    fuel: contract.fuel,
    transmission: contract.transmission,
    doors: contract.doors,
    seats: contract.seats,
    coreImages: images,
  })).digest('hex');
  return contract;
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

let robotsCache = null;
async function robots() {
  if (robotsCache) return robotsCache;
  const url = 'https://www.chngoodcar.com/robots.txt';
  try {
    const response = await fetchTimed(url, { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimited(response)).body : '';
    robotsCache = { status: response.status, text };
  } catch (error) {
    robotsCache = { status: null, text: '', error: String(error?.message || error) };
  }
  return robotsCache;
}

async function fetchSample(sample) {
  const rob = await robots();
  const policy = evaluateRobots(rob.text, sample.url, USER_AGENT);
  if (!policy.allowed) return { kind: 'robots_disallowed', robotsStatus: rob.status, matchedRule: policy.matchedRule };
  let response;
  try {
    response = await fetchTimed(sample.url, { headers: HEADERS, redirect: 'manual' });
  } catch (error) {
    return { kind: 'network_error', error: String(error?.message || error), robotsStatus: rob.status };
  }
  if (response.status >= 300 && response.status < 400) return { kind: 'redirect_not_followed', status: response.status, location: response.headers.get('location'), robotsStatus: rob.status };
  const { body, truncated } = await readLimited(response);
  return {
    kind: response.ok ? 'reachable' : 'http_error',
    status: response.status,
    truncated,
    title: titleOf(body),
    sourceOfferId: sourceOfferIdFromUrl(sample.url),
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
    contract: extractOfferCoreContract(body, sample.url),
    robotsStatus: rob.status,
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
      sameContractFingerprint: Boolean(first.contract?.evidenceFingerprint && first.contract.evidenceFingerprint === second.contract?.evidenceFingerprint),
    },
  };
}

export async function runGoodCarContractProbe() {
  const results = [];
  for (const sample of SAMPLES) results.push(await runOne(sample));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_offer_core_contract_probe_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    routeOrigin: 'known_sample_or_discovered_in_run_33747985524',
    sampleCount: SAMPLES.length,
    results,
    next: 'determine whether explicit offer currency exists; do not infer currency from export context or numeric magnitude',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, sampleCount: payload.sampleCount, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runGoodCarContractProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
