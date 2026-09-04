import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.sbtjapan.com';
const LIST_URL = `${BASE_URL}/used-cars/search`;
const OUTPUT = process.env.CATALOG_SOURCE_SBTJAPAN_OUTPUT || 'catalog-source-sbtjapan-qualification-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(40000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_TIMEOUT_MS || 18000)));
const MAX_BODY_BYTES = Math.max(300000, Math.min(2500000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_MAX_BODY_BYTES || 1900000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_SBTJAPAN_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaSbtJapanQualification/1.0 (+read-only source qualification)';
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /verify (?:that )?you are human|access denied|request blocked|robot check|security check|cf-chl|challenge-platform|enable javascript and (?:then )?reload/i;
const COMMERCIAL_RE = /\b(?:TRUCK|BUS|DUMP|CRANE|TRACTOR|FORKLIFT|EXCAVATOR|CAMPER|CAMPING)\b/i;
const ELECTRIFIED_RE = /\b(?:HYBRID|PHEV|HEV|ELECTRIC|EV)\b/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(value, limit = 2000) {
  return decodeHtml(String(value ?? ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function visibleText(html, limit = 350000) {
  return cleanText(String(html || '')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), limit);
}

function capture(text, re, limit = 220) {
  const m = String(text || '').match(re);
  return m ? cleanText(m[1], limit) || null : null;
}

function numeric(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function safeUrl(value, base = LIST_URL) {
  try {
    const url = new URL(decodeHtml(String(value || '')), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function uniq(values, limit = 200) {
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

export function parseSbtDetailUrl(value) {
  try {
    const url = new URL(value, BASE_URL);
    if (url.origin !== BASE_URL) return null;
    const match = url.pathname.match(/^\/used-cars\/([A-Z0-9]{5,12})\/?$/i);
    if (!match) return null;
    const stockId = match[1].toUpperCase();
    return { stockId, url: `${BASE_URL}/used-cars/${stockId}` };
  } catch {
    return null;
  }
}

export function extractSbtStockLinks(html, limit = 100) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const absolute = safeUrl(match[1], LIST_URL);
    const parsed = absolute ? parseSbtDetailUrl(absolute) : null;
    if (parsed) out.push(parsed);
  }
  return uniq(out, limit);
}

function titleOf(html) {
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 320);
}

function detailWindow(html) {
  const source = String(html || '');
  const start = source.search(/Stock\s*Id\s*:/i);
  const endCandidates = [source.search(/##?\s*Reviews on/i), source.search(/Reviews on/i), source.search(/SBT offers a range of services/i)].filter((n) => n > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(source.length, Math.max(0, start) + 900000);
  return source.slice(Math.max(0, start), end);
}

function extractGallery(html) {
  const source = detailWindow(html);
  const beforePhotoList = source.split(/View photo list/i)[0] || source;
  return uniq([
    ...beforePhotoList.matchAll(/(?:src|data-src|data-original|href)\s*=\s*["']([^"']+\.(?:jpe?g|webp)(?:\?[^"']*)?)["']/gi),
  ].map((m) => safeUrl(m[1], BASE_URL))
    .filter((url) => url && /(?:^|\.)sbtjapan\.com\//i.test(new URL(url).hostname + '/') || url?.includes('img.sbtjapan.com'))
    .filter((url) => !/(?:logo|icon|sprite|banner|flag|avatar|qr|placeholder|loading)/i.test(url)), 120);
}

export function parseSbtDetailEvidence(html) {
  const text = visibleText(detailWindow(html));
  const h1 = capture(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i, 300);
  const stockId = capture(text, /Stock\s*Id\s*:\s*([A-Z0-9]{5,12})/i);
  const yearMonth = capture(h1 || text, /\b((?:19|20)\d{2}(?:\/\d{1,2})?)\b/);
  const priceRaw = capture(text, /Vehicle\s+Price\s+(?:USD|\$)\s*([\d,]+(?:\.\d+)?)/i)
    || capture(text, /Pricing\s+Details\s+Vehicle\s+Price\s+\$\s*([\d,]+(?:\.\d+)?)/i);
  const mileageRaw = capture(text, /\bMileage\s+([\d,]+(?:\.\d+)?)\s*km\b/i);
  const engineRaw = capture(text, /\bEngine\s+([\d,]+(?:\.\d+)?)\s*cc\b/i);
  const transmission = capture(text, /\bTransmission\s+([A-Z0-9-]{1,12})\b/i);
  const drive = capture(text, /\bDrive\s+([A-Z0-9-]{1,20})\b/i);
  const steering = capture(text, /\bSteering\s+(RHD|LHD)\b/i);
  const fuel = capture(text, /\bFuel\s+([A-Z][A-Z0-9 ()+\/-]{1,50}?)(?=\s+(?:Door|Doors|Seats|Get an estimate|Vehicle Price|Stock Id|Inventory location|Vehicle Details|$))/i);
  const make = capture(text, /\bMake\s+([A-Z][A-Z0-9 .&'\/-]{1,60}?)(?=\s+Model\b)/i);
  const model = capture(text, /\bModel\s+([A-Z0-9][A-Z0-9 .&'()\/-]{0,80}?)(?=\s+Body color\b)/i);
  const bodyType = capture(text, /\bBody\s+Type\s+([A-Za-z][A-Za-z0-9 &()\/-]{1,60}?)(?=\s+Doors\b)/i);
  const inventoryLocation = capture(text, /Inventory\s+location\s*:?\s*([A-Za-z0-9 ,.&'()\/-]{2,80}?JAPAN)/i);
  const powerTokens = uniq([...text.matchAll(/\b(?:Horsepower|Engine Power|Maximum Power|Max Power|Power Output|Power)\s*[:：-]?\s*([\d,.]+)\s*(HP|PS|kW)\b/gi)]
    .map((m) => ({ value: numeric(m[1]), unit: m[2].toUpperCase() })), 10);
  const images = extractGallery(html);
  return {
    title: h1,
    stockId,
    yearMonth,
    priceUsd: numeric(priceRaw),
    currency: priceRaw ? 'USD' : null,
    mileageKm: numeric(mileageRaw),
    engineCc: numeric(engineRaw),
    transmission,
    drive,
    steering,
    fuel,
    make,
    model,
    bodyType,
    inventoryLocation,
    powerTokens,
    imageCount: images.length,
    imageSamples: images.slice(0, 15),
  };
}

export function buildSbtFieldMatrix(stock, evidence) {
  const electrified = ELECTRIFIED_RE.test(String(evidence?.fuel || ''));
  const powerExact = Array.isArray(evidence?.powerTokens) && evidence.powerTokens.length === 1
    && Number.isFinite(evidence.powerTokens[0]?.value) && evidence.powerTokens[0].value > 0;
  const japanBound = /JAPAN/i.test(String(evidence?.inventoryLocation || ''));
  const fields = {
    identity: evidence?.stockId === stock.stockId ? 'exact' : 'missing_or_conflict',
    title: evidence?.title ? 'exact' : 'missing',
    price: Number.isFinite(evidence?.priceUsd) && evidence.priceUsd > 0 && evidence.currency === 'USD' ? 'exact' : 'missing_or_conflict',
    year: /^(?:19|20)\d{2}(?:\/\d{1,2})?$/.test(String(evidence?.yearMonth || '')) ? 'exact' : 'missing',
    mileage: Number.isFinite(evidence?.mileageKm) && evidence.mileageKm >= 0 ? 'exact' : 'missing',
    engineCc: Number.isFinite(evidence?.engineCc) && evidence.engineCc >= 300 && evidence.engineCc <= 10000 ? 'exact' : electrified && evidence?.engineCc == null ? 'not_applicable' : 'missing_or_conflict',
    fuel: evidence?.fuel ? 'exact' : 'missing',
    body: evidence?.bodyType ? 'exact' : 'missing',
    power: powerExact ? 'exact' : 'missing_or_ambiguous',
    certifiedPower: electrified ? 'missing' : 'not_applicable',
    gallery: evidence?.imageCount >= 5 ? 'exact' : 'unproven',
    japanInventory: japanBound ? 'exact' : 'missing_or_conflict',
  };
  const acceptable = new Set(['exact', 'not_applicable']);
  const deficits = Object.entries(fields).filter(([, value]) => !acceptable.has(value)).map(([key]) => key);
  return { fields, exactReady: deficits.length === 0, deficits, electrified };
}

const robotsCache = new Map();
async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function robotsFor(url) {
  const origin = new URL(url).origin;
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  try {
    const response = await fetchTimed(`${origin}/robots.txt`, { headers: HEADERS, redirect: 'follow' });
    const value = { status: response.status, text: response.ok ? (await response.text()).slice(0, 500000) : '' };
    robotsCache.set(origin, value);
    return value;
  } catch (error) {
    const value = { status: null, text: '', error: String(error?.message || error) };
    robotsCache.set(origin, value);
    return value;
  }
}

async function fetchAllowed(url, referer = BASE_URL) {
  const robots = await robotsFor(url);
  const policy = robots.text ? evaluateRobots(robots.text, url, USER_AGENT) : { allowed: true, matchedRule: null };
  if (!policy.allowed) return { kind: 'robots_disallowed', url, robotsStatus: robots.status, matchedRule: policy.matchedRule };
  try {
    const response = await fetchTimed(url, { headers: { ...HEADERS, referer }, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return { kind: 'redirect_not_followed', url, status: response.status, location: response.headers.get('location'), robotsStatus: robots.status };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
    const pageTitle = titleOf(body);
    const challenge = CHALLENGE_RE.test(`${pageTitle} ${visibleText(body, 30000)}`);
    return {
      kind: challenge ? 'challenge' : response.ok ? 'reachable' : 'http_error',
      url,
      finalUrl: response.url || url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes: bytes.length,
      truncated: bytes.length > MAX_BODY_BYTES,
      bodyHashSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      robotsStatus: robots.status,
      body,
    };
  } catch (error) {
    return { kind: 'network_error', url, robotsStatus: robots.status, error: String(error?.message || error) };
  }
}

function publicFetch(row) {
  const { body, ...safe } = row;
  return safe;
}

function chooseSamples(candidates, details, count) {
  const usable = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const evidence = details[i]?.evidence;
    if (!evidence) continue;
    if (!/JAPAN/i.test(String(evidence.inventoryLocation || ''))) continue;
    if (COMMERCIAL_RE.test(String(evidence.title || ''))) continue;
    if (ELECTRIFIED_RE.test(String(evidence.fuel || ''))) continue;
    usable.push(i);
    if (usable.length >= count) break;
  }
  return usable;
}

export async function runSbtJapanQualification() {
  const listFirst = await fetchAllowed(LIST_URL, BASE_URL);
  const listSecond = listFirst.kind === 'reachable' ? await fetchAllowed(LIST_URL, BASE_URL) : null;
  const candidates = listFirst.body ? extractSbtStockLinks(listFirst.body, 40) : [];
  const preflight = [];

  for (const stock of candidates.slice(0, Math.max(SAMPLE_COUNT * 4, 12))) {
    const first = await fetchAllowed(stock.url, LIST_URL);
    const evidence = first.body ? parseSbtDetailEvidence(first.body) : null;
    preflight.push({ stock, first, evidence });
  }

  const selectedIndexes = chooseSamples(candidates, preflight, SAMPLE_COUNT);
  const samples = [];
  for (const idx of selectedIndexes) {
    const stock = candidates[idx];
    const first = preflight[idx].first;
    const evidence = preflight[idx].evidence;
    const second = await fetchAllowed(stock.url, LIST_URL);
    const secondEvidence = second.body ? parseSbtDetailEvidence(second.body) : null;
    samples.push({
      stock,
      first: publicFetch(first),
      second: publicFetch(second),
      repeatStable: Boolean(first.kind === 'reachable' && second.kind === 'reachable' && first.bodyHashSha256 === second.bodyHashSha256),
      evidence,
      secondEvidenceFingerprint: secondEvidence ? crypto.createHash('sha256').update(JSON.stringify(secondEvidence)).digest('hex') : null,
      fieldMatrix: buildSbtFieldMatrix(stock, evidence),
    });
  }

  const deficits = {};
  for (const sample of samples) for (const deficit of sample.fieldMatrix.deficits) deficits[deficit] = (deficits[deficit] || 0) + 1;
  const stableReachableCount = samples.filter((row) => row.repeatStable).length;
  const exactReadyCount = samples.filter((row) => row.fieldMatrix.exactReady).length;
  const coreWithoutPowerCount = samples.filter((row) => {
    const d = row.fieldMatrix.deficits;
    return d.length > 0 && d.every((name) => name === 'power' || name === 'certifiedPower');
  }).length;

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'sbtjapan_japan_source_qualification_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourceId: 'sbtjapan_japan_candidate',
    sourcePublishAllowed: false,
    listUrl: LIST_URL,
    listFirst: publicFetch(listFirst),
    listSecond: listSecond ? publicFetch(listSecond) : null,
    listRepeatStable: Boolean(listFirst.kind === 'reachable' && listSecond?.kind === 'reachable' && listFirst.bodyHashSha256 === listSecond.bodyHashSha256),
    discoveredStockCount: candidates.length,
    selectedSampleCount: samples.length,
    samples,
    sourceVerdict: {
      classificationDecision: 'deferred',
      stableReachableCount,
      exactReadyCount,
      coreWithoutPowerCount,
      deficitCounts: deficits,
      reason: exactReadyCount === samples.length && samples.length >= 2
        ? 'mechanical exact completeness passed; manual semantic review required before classification'
        : coreWithoutPowerCount === samples.length && samples.length >= 2
          ? 'repeatable detail proves core offer fields but source-bound power is missing; exact_catalog gate remains closed'
          : 'mechanical exact completeness not proven; inspect source-bound deficits before classification',
    },
  };
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT, discoveredStockCount: candidates.length, selectedSampleCount: samples.length, ...payload.sourceVerdict }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runSbtJapanQualification().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
