import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { extractLabelPairs, extractVisibleNamedFields } from './catalog-source-field-audit-v1.mjs';

const BASE_URL = 'https://www.beforward.jp';
const STOCKLIST_URL = `${BASE_URL}/stocklist`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_BEFORWARD_JAPAN_OUTPUT || 'catalog-source-beforward-japan-qualification-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_BEFORWARD_JAPAN_TIMEOUT_MS || 20000)));
const MAX_BODY_BYTES = Math.max(250000, Math.min(2200000, Number(process.env.CATALOG_SOURCE_BEFORWARD_JAPAN_MAX_BODY_BYTES || 1600000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_BEFORWARD_JAPAN_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaBeforwardJapanQualification/1.0 (+read-only source qualification)';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /captcha|cloudflare|verify (?:that )?you are human|access denied|request blocked|robot check|security check|cf-chl|challenge-platform/i;
const JAPAN_LOCATION_RE = /^(?:Yokohama|Nagoya|Kobe|Osaka|Kyushu|Toyama|Chiba|Hokkaido|Hakata|Fukuoka|Nara|Saitama|Ibaraki|Tochigi|Gunma|Aichi|Hyogo|Kanagawa|Tokyo)$/i;
const COMMERCIAL_TITLE_RE = /\b(?:TRUCK|BUS|DUMP|CRANE|CAMPING|TRACTOR|FORKLIFT|EXCAVATOR)\b/i;

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

function visibleText(html, limit = 300000) {
  return cleanText(String(html || '')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), limit);
}

function safeUrl(value, base = STOCKLIST_URL) {
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
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 300);
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

export function parseBeforwardDetailUrl(url) {
  try {
    const parsed = new URL(url, BASE_URL);
    if (parsed.origin !== BASE_URL) return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/([a-z0-9-]{4,})\/id\/(\d{5,})\/?$/i);
    if (!match) return null;
    return {
      makeSlug: match[1].toLowerCase(),
      modelSlug: match[2].toLowerCase(),
      refNo: match[3].toUpperCase(),
      numericId: match[4],
      url: `${BASE_URL}${parsed.pathname}`,
    };
  } catch {
    return null;
  }
}

function contextAround(source, index, radius = 2400) {
  return source.slice(Math.max(0, index - radius), Math.min(source.length, index + radius));
}

function capture(text, re) {
  return cleanText(String(text || '').match(re)?.[1] || '', 220) || null;
}

export function parseBeforwardListContext(fragment) {
  const text = visibleText(fragment, 10000);
  const title = capture(text, /((?:19|20)\d{2}(?:\/\d{1,2})?\s+[A-Z0-9][A-Z0-9 .+&'()\/-]{2,120}?)(?=\s+\$[\d,]+)/i);
  const refNo = capture(text, /Ref\s+No\.\s*([A-Z0-9-]{4,})/i);
  const priceUsdRaw = capture(text, /(?:Price\s*)?\$\s*([\d,]+(?:\.\d+)?)/i);
  const year = capture(text, /\bYear\s+((?:19|20)\d{2}(?:\/\d{1,2})?)/i);
  const mileageRaw = capture(text, /\bMileage\s+([\d,]+(?:\.\d+)?)\s*km\b/i);
  const engineRaw = capture(text, /\bEngine\s+([\d,]+(?:\.\d+)?)\s*cc\b/i);
  const transmission = capture(text, /\bTrans\.\s*([A-Z0-9-]{1,12})\b/i);
  const location = capture(text, /\bLocation\s+([A-Za-z -]{2,40}?)(?=\s+(?:Model code|Ref No\.|Price|Fuel|Engine code|Steering|Auction grade|\d{4}\b|$))/i);
  const modelCode = capture(text, /\bModel code\s+(.{1,80}?)(?=\s+Steering\b)/i);
  const fuel = capture(text, /\bFuel\s+(.{1,60}?)(?=\s+(?:Seats|Engine code|Color|Drive|Doors|Auction grade|Price)\b)/i);
  const drive = capture(text, /\bDrive\s+(.{1,30}?)(?=\s+(?:Doors|Auction grade|Price)\b)/i);
  return {
    refNo,
    title,
    priceUsd: priceUsdRaw ? Number(priceUsdRaw.replace(/,/g, '')) : null,
    currency: priceUsdRaw ? 'USD' : null,
    year,
    mileageKm: mileageRaw ? Number(mileageRaw.replace(/,/g, '')) : null,
    engineCc: engineRaw ? Number(engineRaw.replace(/,/g, '')) : null,
    transmission,
    location,
    modelCode,
    fuel,
    drive,
  };
}

export function extractBeforwardStockCandidates(html, limit = 40) {
  const source = String(html || '');
  const rows = [];
  for (const match of source.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const absolute = safeUrl(match[1], STOCKLIST_URL);
    const identity = absolute ? parseBeforwardDetailUrl(absolute) : null;
    if (!identity) continue;
    const list = parseBeforwardListContext(contextAround(source, match.index ?? 0));
    if (list.refNo && list.refNo.toUpperCase() !== identity.refNo) continue;
    rows.push({ ...identity, list });
  }
  return uniq(rows, limit);
}

function exactNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function pairValues(pairs, patterns) {
  return uniq(pairs.filter((row) => patterns.some((re) => re.test(row.label))).map((row) => ({ label: row.label, value: row.value, source: row.source })), 20);
}

function customDetailFields(html) {
  const text = visibleText(html);
  const pairs = extractLabelPairs(html);
  const named = extractVisibleNamedFields(html);
  const refNo = capture(text, /Ref\s+No\.\s*([A-Z0-9-]{4,})/i);
  const priceRaw = capture(text, /(?:Vehicle Price|Price)\s*:?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    || capture(text, /\$\s*([\d,]+(?:\.\d+)?)(?=\s+(?:Mileage|Year|Engine|High quality|Ref No\.))/i);
  const year = capture(text, /\bYear\s+((?:19|20)\d{2}(?:\/\d{1,2})?)/i);
  const mileageRaw = capture(text, /\bMileage\s+([\d,]+(?:\.\d+)?)\s*km\b/i);
  const engineRaw = capture(text, /\bEngine\s+([\d,]+(?:\.\d+)?)\s*cc\b/i);
  const fuel = capture(text, /\bFuel\s+(.{1,60}?)(?=\s+(?:Seats|Engine code|Color|Drive|Doors|Auction grade|Price|Mileage|Year)\b)/i);
  const body = capture(text, /\b(?:Body Type|Body Style|Type)\s+(.{1,70}?)(?=\s+(?:Fuel|Engine|Mileage|Year|Transmission|Trans\.|Drive|Doors|Seats|Color)\b)/i);
  const powerTokens = uniq([...text.matchAll(/\b(?:Horsepower|Max(?:imum)? Power|Engine Power|Power Output)\s*[:：-]?\s*([\d,.]+)\s*(HP|PS|kW)\b/gi)]
    .map((m) => ({ value: Number(m[1].replace(/,/g, '')), unit: m[2].toUpperCase() })), 10);
  const images = uniq([...String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => safeUrl(m[1], BASE_URL))
    .filter((url) => url && /(?:cdn\.beforward\.jp|beforward\.jp)/i.test(url) && !/(?:logo|icon|sprite|banner|flag|qr|avatar|placeholder|loading)/i.test(url)), 120);
  return {
    refNo,
    priceUsd: priceRaw ? Number(priceRaw.replace(/,/g, '')) : null,
    currency: priceRaw ? 'USD' : null,
    year,
    mileageKm: mileageRaw ? Number(mileageRaw.replace(/,/g, '')) : null,
    engineCc: engineRaw ? Number(engineRaw.replace(/,/g, '')) : null,
    fuel,
    body,
    powerTokens,
    images,
    named,
    labelPairs: pairs.slice(0, 100),
    bodyPairs: pairValues(pairs, [/^body(?: type| style)?$/i, /^type$/i]),
    fuelPairs: pairValues(pairs, [/^fuel(?: type)?$/i]),
    powerPairs: pairValues(pairs, [/^(?:horsepower|engine power|max(?:imum)? power|power output)$/i]),
  };
}

function parity(a, b) {
  if (a == null || b == null || a === '' || b === '') return null;
  return String(a).replace(/\s+/g, ' ').trim().toLowerCase() === String(b).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildBeforwardFieldMatrix(candidate, detail) {
  const electrified = /hybrid|electric|phev|hev|ev\b/i.test(String(detail.fuel || candidate.list.fuel || ''));
  const exactPower = detail.powerTokens.length === 1 && exactNumber(detail.powerTokens[0].value, 1, detail.powerTokens[0].unit === 'KW' ? 1000 : 1500);
  const bodyEvidence = detail.body || detail.bodyPairs[0]?.value || null;
  const imageBound = detail.images.filter((url) => url.toLowerCase().includes(candidate.refNo.toLowerCase()) || url.includes(candidate.numericId));
  const fields = {
    identity: detail.refNo && detail.refNo.toUpperCase() === candidate.refNo ? 'exact' : 'missing_or_conflict',
    year: parity(candidate.list.year, detail.year) === true ? 'exact' : 'missing_or_conflict',
    price: parity(candidate.list.priceUsd, detail.priceUsd) === true ? 'exact' : 'missing_or_conflict',
    currency: candidate.list.currency === 'USD' && detail.currency === 'USD' ? 'exact' : 'missing_or_conflict',
    mileage: parity(candidate.list.mileageKm, detail.mileageKm) === true ? 'exact' : 'missing_or_conflict',
    engineCc: parity(candidate.list.engineCc, detail.engineCc) === true && exactNumber(detail.engineCc, 300, 10000) ? 'exact' : 'missing_or_conflict',
    fuel: detail.fuel ? 'exact' : 'missing',
    body: bodyEvidence ? 'exact' : 'missing',
    power: exactPower ? 'exact' : 'missing_or_ambiguous',
    certifiedPower: electrified ? 'missing' : 'not_applicable',
    gallery: imageBound.length >= 5 ? 'exact' : 'unproven',
  };
  const acceptable = new Set(['exact', 'not_applicable']);
  const required = Object.keys(fields);
  return {
    fields,
    exactReady: required.every((field) => acceptable.has(fields[field])),
    deficits: required.filter((field) => !acceptable.has(fields[field])),
    bodyEvidence,
    listingBoundImageCount: imageBound.length,
    listingBoundImageSample: imageBound.slice(0, 12),
    powerTokens: detail.powerTokens,
    electrified,
  };
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
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const response = await fetchTimed(robotsUrl, { headers: HEADERS, redirect: 'follow' });
    const text = response.ok ? (await response.text()).slice(0, 500000) : '';
    const result = { status: response.status, text };
    robotsCache.set(origin, result);
    return result;
  } catch (error) {
    const result = { status: null, text: '', error: String(error?.message || error) };
    robotsCache.set(origin, result);
    return result;
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
    const title = titleOf(body);
    const challenge = CHALLENGE_RE.test(`${title} ${visibleText(body, 20000)}`);
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

function publicEnvelope(row) {
  const { body, ...safe } = row;
  return safe;
}

export async function runBeforwardJapanQualification() {
  const listFetch = await fetchAllowed(STOCKLIST_URL, BASE_URL);
  if (listFetch.kind !== 'reachable' || !listFetch.body) {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'beforward_japan_source_qualification_no_write',
      productionWrites: false,
      classificationMutations: false,
      publishAllowedMutations: false,
      objectStorageWrites: false,
      catalogGenerationWrites: false,
      rawBodiesStored: false,
      guessedRoutes: false,
      listFetch: publicEnvelope(listFetch),
      candidates: [],
      samples: [],
      sourceVerdict: { classificationDecision: 'deferred', reason: `stocklist_${listFetch.kind}` },
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload.sourceVerdict, null, 2));
    return payload;
  }

  const candidates = extractBeforwardStockCandidates(listFetch.body, 80);
  const japanCandidates = candidates.filter((row) => JAPAN_LOCATION_RE.test(row.list.location || ''));
  const preferred = japanCandidates.filter((row) => row.list.fuel && !/hybrid|electric|phev|hev|ev\b/i.test(row.list.fuel) && !COMMERCIAL_TITLE_RE.test(row.list.title || ''));
  const selected = (preferred.length >= SAMPLE_COUNT ? preferred : japanCandidates).slice(0, SAMPLE_COUNT);
  const samples = [];

  for (const candidate of selected) {
    const first = await fetchAllowed(candidate.url, STOCKLIST_URL);
    const second = first.kind === 'reachable' ? await fetchAllowed(candidate.url, STOCKLIST_URL) : null;
    const firstDetail = first.body ? customDetailFields(first.body) : null;
    const secondDetail = second?.body ? customDetailFields(second.body) : null;
    const matrix = firstDetail ? buildBeforwardFieldMatrix(candidate, firstDetail) : null;
    samples.push({
      candidate,
      first: publicEnvelope(first),
      second: second ? publicEnvelope(second) : null,
      repeatStable: Boolean(first.kind === 'reachable' && second?.kind === 'reachable' && first.bodyHashSha256 === second.bodyHashSha256),
      detailEvidence: firstDetail ? {
        refNo: firstDetail.refNo,
        priceUsd: firstDetail.priceUsd,
        currency: firstDetail.currency,
        year: firstDetail.year,
        mileageKm: firstDetail.mileageKm,
        engineCc: firstDetail.engineCc,
        fuel: firstDetail.fuel,
        body: firstDetail.body,
        powerTokens: firstDetail.powerTokens,
        bodyPairs: firstDetail.bodyPairs,
        fuelPairs: firstDetail.fuelPairs,
        powerPairs: firstDetail.powerPairs,
        imageCount: firstDetail.images.length,
        imageSamples: firstDetail.images.slice(0, 20),
      } : null,
      secondEvidenceFingerprint: secondDetail ? crypto.createHash('sha256').update(JSON.stringify({
        refNo: secondDetail.refNo,
        priceUsd: secondDetail.priceUsd,
        year: secondDetail.year,
        mileageKm: secondDetail.mileageKm,
        engineCc: secondDetail.engineCc,
        fuel: secondDetail.fuel,
        body: secondDetail.body,
        powerTokens: secondDetail.powerTokens,
        images: secondDetail.images,
      })).digest('hex') : null,
      fieldMatrix: matrix,
    });
  }

  const exactReadyCount = samples.filter((row) => row.fieldMatrix?.exactReady).length;
  const stableReachableCount = samples.filter((row) => row.repeatStable).length;
  const deficitCounts = {};
  for (const sample of samples) for (const deficit of sample.fieldMatrix?.deficits || []) deficitCounts[deficit] = (deficitCounts[deficit] || 0) + 1;
  const sourceVerdict = {
    classificationDecision: 'deferred',
    sampleCount: samples.length,
    stableReachableCount,
    exactReadyCount,
    deficitCounts,
    reason: exactReadyCount === samples.length && samples.length >= 2
      ? 'mechanical exact completeness passed; manual semantic review required before classification'
      : 'mechanical exact completeness not proven; inspect source-bound deficits before classification',
  };

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'beforward_japan_source_qualification_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourceId: 'beforward_japan_candidate',
    sourcePublishAllowed: false,
    stocklistUrl: STOCKLIST_URL,
    listFetch: publicEnvelope(listFetch),
    discoveredCandidateCount: candidates.length,
    discoveredJapanCandidateCount: japanCandidates.length,
    selectedSampleCount: selected.length,
    samples,
    sourceVerdict,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, discoveredCandidateCount: candidates.length, discoveredJapanCandidateCount: japanCandidates.length, ...sourceVerdict }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runBeforwardJapanQualification().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
