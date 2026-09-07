import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { extractOfferCoreContract } from './catalog-source-chngoodcar-contract-probe-v1.mjs';
import { sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_CURRENCY_OUTPUT || 'catalog-source-chngoodcar-currency-identity-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CURRENCY_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(200000, Math.min(1800000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CURRENCY_MAX_BODY_BYTES || 1300000)));
const USER_AGENT = 'AvtoCenaGoodCarCurrencyIdentity/1.0 (+read-only source qualification)';

const LIST_URL = 'https://www.chngoodcar.com/Home/CarsList';
const HOME_URL = 'https://www.chngoodcar.com/';
const DETAILS = [
  { url: 'https://www.chngoodcar.com/Home/Cars?id=1245159140309858930', expectedName: '众泰 云100S', routeOrigin: 'known_sample' },
  { url: 'https://www.chngoodcar.com/Home/Cars?id=1265916925100158976', expectedName: '现代名驭 2014款 1.8L 手动版', routeOrigin: 'discovered_in_run_33747985524' },
  { url: 'https://www.chngoodcar.com/Home/Cars?id=1288729215201439744', expectedName: '现代悦动 2017款 1.6L 手动版', routeOrigin: 'discovered_in_run_33747985524' },
  { url: 'https://www.chngoodcar.com/Home/Cars?id=2049753443165270016', expectedName: '马自达CX-50行也 2023款 2.0L 领行版', routeOrigin: 'official_site_public_search_20260903' },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
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
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function visibleText(html, limit = 300000) {
  return decodeHtml(String(html || ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function titleOf(html) {
  return visibleText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 320);
}

function currencyContract(html) {
  const text = visibleText(html);
  const match = text.match(/价格\s*\(\s*US\s*\$\s*\)/i);
  return {
    explicitPriceLabel: match?.[0] || null,
    currency: match ? 'USD' : null,
    priceBandsPresent: /2000-5000/.test(text) && /5000-7000/.test(text) && /7000-15000/.test(text),
  };
}

function normalizeName(value) {
  return String(value || '').replace(/[\s_]+/g, ' ').trim().toLowerCase();
}

function homepageParity(homeHtml, expectedName, priceRaw) {
  const text = visibleText(homeHtml);
  const lower = normalizeName(text);
  const needle = normalizeName(expectedName);
  const idx = lower.indexOf(needle);
  if (idx < 0) return { namePresent: false, priceNearName: false, context: null };
  const context = text.slice(Math.max(0, idx - 100), Math.min(text.length, idx + expectedName.length + 320));
  const pricePattern = new RegExp(`(?:价格[:：]?\\s*)?${String(priceRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.00)?(?!\\d)`);
  return { namePresent: true, priceNearName: pricePattern.test(context), context: context.slice(0, 500) };
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
  try {
    const response = await fetchTimed('https://www.chngoodcar.com/robots.txt', { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimited(response)).body : '';
    robotsCache = { status: response.status, text };
  } catch (error) {
    robotsCache = { status: null, text: '', error: String(error?.message || error) };
  }
  return robotsCache;
}

async function fetchAllowed(url) {
  const rob = await robots();
  const policy = evaluateRobots(rob.text, url, USER_AGENT);
  if (!policy.allowed) return { kind: 'robots_disallowed', robotsStatus: rob.status, matchedRule: policy.matchedRule };
  let response;
  try {
    response = await fetchTimed(url, { headers: HEADERS, redirect: 'manual' });
  } catch (error) {
    return { kind: 'network_error', error: String(error?.message || error), robotsStatus: rob.status };
  }
  if (response.status >= 300 && response.status < 400) return { kind: 'redirect_not_followed', status: response.status, location: response.headers.get('location'), robotsStatus: rob.status };
  const { body, truncated } = await readLimited(response);
  return { kind: response.ok ? 'reachable' : 'http_error', status: response.status, body, truncated, bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'), robotsStatus: rob.status };
}

async function repeatPage(url, summarize) {
  const firstRaw = await fetchAllowed(url);
  const secondRaw = await fetchAllowed(url);
  const make = (raw) => {
    if (!raw.body) return raw;
    const summary = summarize(raw.body);
    return { kind: raw.kind, status: raw.status, truncated: raw.truncated, bodyHashSha256: raw.bodyHashSha256, summary };
  };
  const first = make(firstRaw);
  const second = make(secondRaw);
  return {
    first,
    second,
    repeat: {
      sameKind: first.kind === second.kind,
      sameBodyHash: Boolean(first.bodyHashSha256 && first.bodyHashSha256 === second.bodyHashSha256),
      sameSummary: Boolean(first.summary && second.summary && JSON.stringify(first.summary) === JSON.stringify(second.summary)),
    },
  };
}

export async function runCurrencyIdentityProbe() {
  const list = await repeatPage(LIST_URL, (body) => currencyContract(body));
  const home = await repeatPage(HOME_URL, (body) => ({ title: titleOf(body), textHash: crypto.createHash('sha256').update(visibleText(body)).digest('hex') }));
  const homeRaw = await fetchAllowed(HOME_URL);
  const details = [];
  for (const sample of DETAILS) {
    const row = await repeatPage(sample.url, (body) => {
      const contract = extractOfferCoreContract(body, sample.url);
      return {
        title: titleOf(body),
        sourceOfferId: sourceOfferIdFromUrl(sample.url),
        contract: {
          priceRaw: contract.priceRaw,
          bodyType: contract.bodyType,
          vehicleType: contract.vehicleType,
          vin: contract.vin,
          manufactureYearMonth: contract.manufactureYearMonth,
          mileageKm: contract.mileageKm,
          displacementMl: contract.displacementMl,
          powerKw: contract.powerKw,
          fuel: contract.fuel,
          coreImageCount: contract.coreImageCount,
          evidenceFingerprint: contract.evidenceFingerprint,
        },
        homepageParity: homeRaw.body ? homepageParity(homeRaw.body, sample.expectedName, contract.priceRaw) : null,
      };
    });
    details.push({ ...sample, ...row });
  }
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_currency_list_detail_identity_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    listUrl: LIST_URL,
    homeUrl: HOME_URL,
    list,
    home,
    details,
    interpretation: 'Currency may be treated as source-bound only if the public CarsList repeatedly labels its price dimension as US $ and list/home price parity matches the same detail offer numeric price. No numeric-magnitude inference is allowed.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, detailCount: details.length, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runCurrencyIdentityProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
