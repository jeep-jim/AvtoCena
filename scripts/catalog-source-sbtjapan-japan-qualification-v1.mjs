import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.sbtjapan.com';
const LIST_URL = `${BASE_URL}/used-cars/search`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_OUTPUT || 'catalog-source-sbtjapan-japan-qualification-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_TIMEOUT_MS || 20000)));
const MAX_BODY_BYTES = Math.max(250000, Math.min(8000000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_MAX_BODY_BYTES || 6000000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaSbtJapanQualification/1.0 (+read-only source qualification)';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /verify (?:that )?you are human|checking your browser before accessing|complete (?:the )?(?:security verification|challenge) to continue|access denied(?:\s*[|:-]|$)|request blocked(?:\s*[|:-]|$)|cf-chl-/i;
const COMMERCIAL_RE = /\b(?:TRUCK|BUS|DUMP|CRANE|TRACTOR|FORKLIFT|EXCAVATOR)\b/i;
const PASSENGER_BODY_RE = /\b(?:sedan|saloon|hatchback|suv|crossover|wagon|estate|coupe|convertible|cabriolet|minivan|mpv|van|pickup)\b/i;

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

function visibleText(html, limit = 320000) {
  return cleanText(String(html || '')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|section|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), limit);
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

function titleOf(html) {
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 300);
}

function capture(text, re, limit = 220) {
  return cleanText(String(text || '').match(re)?.[1] || '', limit) || null;
}

function uniq(values, limit = 120) {
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

function normalizeToken(value) {
  return cleanText(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parity(a, b) {
  if (a == null || b == null || a === '' || b === '') return null;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return normalizeToken(a) === normalizeToken(b);
}

function exactNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function parseSbtDetailUrl(url) {
  try {
    const parsed = new URL(url, BASE_URL);
    if (parsed.origin !== BASE_URL) return null;
    const match = parsed.pathname.match(/^\/used-cars\/([a-z0-9]{5,16})\/?$/i);
    if (!match) return null;
    const stockId = match[1].toUpperCase();
    if (!/\d/.test(stockId)) return null;
    return {
      stockId,
      url: `${BASE_URL}/used-cars/${stockId}`,
    };
  } catch {
    return null;
  }
}

export function parseSbtListContext(fragment) {
  const text = visibleText(fragment, 12000);
  const title = capture(text, /(((?:19|20)\d{2}\/\d{1,2})\s+[A-Z0-9][A-Z0-9 .+&'()\/-]{2,140}?)(?=\s+Vehicle Price\b)/i, 180);
  const yearMonth = capture(text, /\b((?:19|20)\d{2}\/\d{1,2})\b/i);
  const priceRaw = capture(text, /\bVehicle Price\s+USD\s*([\d,]+(?:\.\d+)?)/i);
  const stockId = capture(text, /\bStock\s+Id\s*:?\s*([A-Z0-9]{5,16})\b/i);
  const location = capture(text, /\bInventory location\s*:?\s*([A-Za-z -]+,\s*JAPAN)\b/i, 80);
  const mileageRaw = capture(text, /\b([\d,]+)\s*km\b/i);
  const engineRaw = capture(text, /\b([\d,]+)\s*cc\b/i);
  const transmission = capture(text, /\b(AT|MT|CVT|AMT|DCT)\b/i);
  const drive = capture(text, /\b(2WD|4WD|AWD|FWD|RWD)\b/i);
  const steering = capture(text, /\b(RHD|LHD)\b/i);
  const fuel = capture(text, /\b(HYBRID\s*\([^)]*\)|PETROL|GASOLINE|DIESEL|ELECTRIC|LPG|CNG|HYBRID)\b/i);
  const modelCode = capture(text, /\b(?:Model Code|Model code)\s*:?\s*([A-Z0-9-]{3,30})\b/i)
    || capture(text, /\b([A-Z]{1,5}[A-Z0-9-]{2,12})\b(?=\s+[\d,]+\s*km\b)/i);
  return {
    stockId,
    title,
    yearMonth,
    priceUsd: priceRaw ? Number(priceRaw.replace(/,/g, '')) : null,
    currency: priceRaw ? 'USD' : null,
    location,
    mileageKm: mileageRaw ? Number(mileageRaw.replace(/,/g, '')) : null,
    engineCc: engineRaw ? Number(engineRaw.replace(/,/g, '')) : null,
    transmission: transmission?.toUpperCase() || null,
    drive: drive?.toUpperCase() || null,
    steering: steering?.toUpperCase() || null,
    fuel,
    modelCode,
  };
}

function contextAround(source, index, radius = 2600) {
  return source.slice(Math.max(0, index - radius), Math.min(source.length, index + radius));
}

function focusAroundStock(fragment, stockId) {
  const source = String(fragment || '');
  const index = source.toUpperCase().indexOf(String(stockId || '').toUpperCase());
  if (index < 0) return source;
  return source.slice(Math.max(0, index - 1600), Math.min(source.length, index + 1800));
}

export function extractSbtListCandidates(html, limit = 40) {
  const source = String(html || '');
  const rows = [];
  for (const match of source.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const absolute = safeUrl(match[1], LIST_URL);
    const identity = absolute ? parseSbtDetailUrl(absolute) : null;
    if (!identity) continue;
    const fragment = focusAroundStock(contextAround(source, match.index ?? 0), identity.stockId);
    const list = parseSbtListContext(fragment);
    if (!list.stockId || list.stockId.toUpperCase() !== identity.stockId) continue;
    rows.push({ ...identity, list });
  }
  return uniq(rows, limit);
}

function likelyVehicleImage(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (!/\.(?:jpe?g|webp)(?:$|\?)/i.test(`${parsed.pathname}${parsed.search}`)) return false;
    if (/(?:logo|icon|sprite|banner|flag|qr|avatar|placeholder|loading|social|facebook|twitter|youtube|instagram)/i.test(path)) return false;
    const base = parsed.pathname.split('/').pop() || '';
    return /[a-z0-9]{8,}\.(?:jpe?g|webp)$/i.test(base) || /^\d{1,3}\.(?:jpe?g|webp)$/i.test(base);
  } catch {
    return false;
  }
}

function extractImageUrls(html, base = BASE_URL) {
  const values = [];
  const source = String(html || '');
  for (const match of source.matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/gi)) {
    const url = safeUrl(match[1], base);
    if (url) values.push(url);
  }
  for (const match of source.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const item of match[1].split(',')) {
      const url = safeUrl(item.trim().split(/\s+/)[0], base);
      if (url) values.push(url);
    }
  }
  return uniq(values.filter(likelyVehicleImage), 240);
}

function largestImageCluster(images) {
  const groups = new Map();
  for (const image of images) {
    try {
      const url = new URL(image);
      const parts = url.pathname.split('/');
      parts.pop();
      const key = `${url.host}${parts.join('/')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(image);
    } catch {}
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
}

export function parseSbtDetail(html, detailUrl = BASE_URL) {
  const text = visibleText(html);
  const stockId = capture(text, /\bStock\s+Id\s*:?\s*([A-Z0-9]{5,16})\b/i);
  const title = capture(text, /(((?:19|20)\d{2}\/\d{1,2})\s+[A-Z0-9][A-Z0-9 .+&'()\/-]{2,150}?)(?=\s+(?:Stock\s+Id|Vehicle Price|Inventory location)\b)/i, 190);
  const yearMonth = capture(text, /\b((?:19|20)\d{2}\/\d{1,2})\b/i);
  const priceRaw = capture(text, /\bVehicle Price\s+USD\s*([\d,]+(?:\.\d+)?)/i);
  const location = capture(text, /\bInventory location\s*:?\s*([A-Za-z -]+,\s*JAPAN)\b/i, 80);
  const mileageRaw = capture(text, /\bMileage\s*:?\s*([\d,]+)\s*km\b/i) || capture(text, /\b([\d,]+)\s*km\b/i);
  const engineRaw = capture(text, /\bEngine\s*:?\s*([\d,]+)\s*cc\b/i) || capture(text, /\b([\d,]+)\s*cc\b/i);
  const transmission = capture(text, /\bTransmission\s*:?\s*(AT|MT|CVT|AMT|DCT)\b/i) || capture(text, /\b(AT|MT|CVT|AMT|DCT)\b/i);
  const drive = capture(text, /\b(?:Drive|Drivetrain)\s*:?\s*(2WD|4WD|AWD|FWD|RWD)\b/i) || capture(text, /\b(2WD|4WD|AWD|FWD|RWD)\b/i);
  const steering = capture(text, /\bSteering\s*:?\s*(RHD|LHD)\b/i) || capture(text, /\b(RHD|LHD)\b/i);
  const fuel = capture(text, /\bFuel\s*:?\s*(HYBRID\s*\([^)]*\)|PETROL|GASOLINE|DIESEL|ELECTRIC|LPG|CNG|HYBRID)\b/i)
    || capture(text, /\b(HYBRID\s*\([^)]*\)|PETROL|GASOLINE|DIESEL|ELECTRIC|LPG|CNG|HYBRID)\b/i);
  const body = capture(text, /\bBody Type\s*:?\s*([A-Za-z -]{3,50})\b/i, 60);
  const powerTokens = uniq([...text.matchAll(/\b(?:Horsepower|Engine Power|Max(?:imum)? Power|Power Output)\s*[:：-]?\s*([\d,.]+)\s*(HP|PS|kW)\b/gi)]
    .map((m) => ({ value: Number(m[1].replace(/,/g, '')), unit: m[2].toUpperCase() })), 12);
  const allImages = extractImageUrls(html, detailUrl);
  const offerBoundImages = largestImageCluster(allImages);
  return {
    stockId,
    title,
    yearMonth,
    priceUsd: priceRaw ? Number(priceRaw.replace(/,/g, '')) : null,
    currency: priceRaw ? 'USD' : null,
    location,
    mileageKm: mileageRaw ? Number(mileageRaw.replace(/,/g, '')) : null,
    engineCc: engineRaw ? Number(engineRaw.replace(/,/g, '')) : null,
    transmission: transmission?.toUpperCase() || null,
    drive: drive?.toUpperCase() || null,
    steering: steering?.toUpperCase() || null,
    fuel,
    body,
    powerTokens,
    allVehicleImageCount: allImages.length,
    offerBoundImageCount: offerBoundImages.length,
    offerBoundImageSample: offerBoundImages.slice(0, 12),
  };
}

export function buildSbtFieldMatrix(candidate, detail) {
  const electrified = /hybrid|electric|phev|hev|\bev\b/i.test(String(detail.fuel || candidate.list.fuel || ''));
  const exactPower = detail.powerTokens.length === 1 && exactNumber(detail.powerTokens[0].value, 1, detail.powerTokens[0].unit === 'KW' ? 1000 : 1500);
  const passengerBody = detail.body && PASSENGER_BODY_RE.test(detail.body) && !COMMERCIAL_RE.test(detail.body);
  const fields = {
    identity: detail.stockId?.toUpperCase() === candidate.stockId ? 'exact' : 'missing_or_conflict',
    year: parity(candidate.list.yearMonth, detail.yearMonth) === true ? 'exact' : 'missing_or_conflict',
    price: parity(candidate.list.priceUsd, detail.priceUsd) === true ? 'exact' : 'missing_or_conflict',
    currency: candidate.list.currency === 'USD' && detail.currency === 'USD' ? 'exact' : 'missing_or_conflict',
    mileage: parity(candidate.list.mileageKm, detail.mileageKm) === true ? 'exact' : 'missing_or_conflict',
    engineCc: parity(candidate.list.engineCc, detail.engineCc) === true && exactNumber(detail.engineCc, 300, 10000) ? 'exact' : 'missing_or_conflict',
    fuel: parity(candidate.list.fuel, detail.fuel) === true ? 'exact' : 'missing_or_conflict',
    body: passengerBody ? 'exact' : detail.body ? 'non_passenger_or_unknown' : 'missing',
    power: exactPower ? 'exact' : 'missing_or_ambiguous',
    certifiedPower: electrified ? 'missing' : 'not_applicable',
    gallery: detail.offerBoundImageCount >= 5 ? 'exact' : 'unproven',
  };
  const acceptable = new Set(['exact', 'not_applicable']);
  const required = Object.keys(fields);
  return {
    fields,
    exactReady: required.every((field) => acceptable.has(fields[field])),
    deficits: required.filter((field) => !acceptable.has(fields[field])),
    electrified,
    body: detail.body,
    powerTokens: detail.powerTokens,
    offerBoundImageCount: detail.offerBoundImageCount,
    offerBoundImageSample: detail.offerBoundImageSample,
    transmissionParity: parity(candidate.list.transmission, detail.transmission),
    driveParity: parity(candidate.list.drive, detail.drive),
    steeringParity: parity(candidate.list.steering, detail.steering),
  };
}

async function fetchTimed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    const bounded = text.slice(0, MAX_BODY_BYTES);
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      bytes: Buffer.byteLength(bounded),
      truncated: text.length > bounded.length,
      title: titleOf(bounded),
      challenge: CHALLENGE_RE.test(`${titleOf(bounded)} ${visibleText(bounded, 60000)}`),
      sha256: crypto.createHash('sha256').update(bounded).digest('hex'),
      body: bounded,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRobots() {
  const robotsUrl = `${BASE_URL}/robots.txt`;
  try {
    const result = await fetchTimed(robotsUrl);
    return { status: result.status, text: result.body.slice(0, 500000), sha256: result.sha256 };
  } catch (error) {
    return { status: null, text: '', error: String(error?.message || error) };
  }
}

function stableDetailPair(a, b, stockId) {
  if (!a || !b || !a.ok || !b.ok || a.challenge || b.challenge) return false;
  const pa = a.parsed;
  const pb = b.parsed;
  if (!pa || !pb || pa.stockId?.toUpperCase() !== stockId || pb.stockId?.toUpperCase() !== stockId) return false;
  return ['yearMonth', 'priceUsd', 'currency', 'mileageKm', 'engineCc', 'fuel', 'body']
    .every((key) => parity(pa[key], pb[key]) === true || (pa[key] == null && pb[key] == null));
}

function publicFetchSummary(result, parsed) {
  return {
    status: result.status,
    ok: result.ok,
    finalUrl: result.finalUrl,
    bytes: result.bytes,
    truncated: result.truncated,
    title: result.title,
    challenge: result.challenge,
    sha256: result.sha256,
    parsed,
  };
}

async function run() {
  const robots = await fetchRobots();
  const listRobots = evaluateRobots(robots.text, LIST_URL, USER_AGENT);
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceId: 'sbtjapan_japan_candidate',
    sourceUrl: BASE_URL,
    listUrl: LIST_URL,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourcePublishAllowed: false,
    robots: { status: robots.status, sha256: robots.sha256 || null, list: listRobots },
    list: null,
    samples: [],
    sourceVerdict: 'research_pending',
    summary: null,
  };

  if (!listRobots.allowed) {
    output.sourceVerdict = 'blocked_by_robots';
    output.summary = { candidateCount: 0, stableReachable: 0, exactReady: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  let listResult;
  try {
    listResult = await fetchTimed(LIST_URL);
  } catch (error) {
    output.sourceVerdict = 'network_error';
    output.list = { error: String(error?.message || error) };
    output.summary = { candidateCount: 0, stableReachable: 0, exactReady: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  const candidates = listResult.ok && !listResult.challenge ? extractSbtListCandidates(listResult.body, 50) : [];
  output.list = {
    status: listResult.status,
    ok: listResult.ok,
    finalUrl: listResult.finalUrl,
    bytes: listResult.bytes,
    truncated: listResult.truncated,
    title: listResult.title,
    challenge: listResult.challenge,
    sha256: listResult.sha256,
    discoveredCandidateCount: candidates.length,
    candidateSample: candidates.slice(0, 8).map((row) => ({ stockId: row.stockId, url: row.url, list: row.list })),
  };

  if (!listResult.ok || listResult.challenge) {
    output.sourceVerdict = listResult.challenge ? 'challenge' : `http_${listResult.status}`;
    output.summary = { candidateCount: 0, stableReachable: 0, exactReady: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  for (const candidate of candidates.slice(0, SAMPLE_COUNT)) {
    const policy = evaluateRobots(robots.text, candidate.url, USER_AGENT);
    if (!policy.allowed) {
      output.samples.push({ stockId: candidate.stockId, url: candidate.url, list: candidate.list, robots: policy, stableReachable: false, exactReady: false, blocker: 'robots_disallowed' });
      continue;
    }
    const attempts = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        const result = await fetchTimed(candidate.url);
        const parsed = result.ok && !result.challenge ? parseSbtDetail(result.body, candidate.url) : null;
        attempts.push({ ...publicFetchSummary(result, parsed) });
      } catch (error) {
        attempts.push({ error: String(error?.message || error), ok: false, challenge: false, parsed: null });
      }
    }
    const stableReachable = stableDetailPair(attempts[0], attempts[1], candidate.stockId);
    const detail = attempts[1]?.parsed || attempts[0]?.parsed || null;
    const matrix = detail ? buildSbtFieldMatrix(candidate, detail) : null;
    output.samples.push({
      stockId: candidate.stockId,
      url: candidate.url,
      list: candidate.list,
      robots: policy,
      stableReachable,
      exactReady: stableReachable && matrix?.exactReady === true,
      attempts,
      matrix,
    });
  }

  const stableReachable = output.samples.filter((row) => row.stableReachable).length;
  const exactReady = output.samples.filter((row) => row.exactReady).length;
  const identityPriceStable = output.samples.filter((row) => row.stableReachable && row.matrix?.fields?.identity === 'exact' && row.matrix?.fields?.price === 'exact').length;
  const powerMissing = output.samples.filter((row) => row.stableReachable && row.matrix?.fields?.power === 'missing_or_ambiguous').length;

  if (!candidates.length) output.sourceVerdict = 'no_source_declared_detail_candidates';
  else if (exactReady >= 2) output.sourceVerdict = 'exact_catalog_signal_requires_manual_review';
  else if (stableReachable >= 2 && identityPriceStable >= 2) output.sourceVerdict = 'lead_only_signal';
  else if (stableReachable > 0) output.sourceVerdict = 'partial_detail_signal';
  else output.sourceVerdict = 'detail_not_repeatably_reachable';

  output.summary = {
    candidateCount: candidates.length,
    sampled: output.samples.length,
    stableReachable,
    exactReady,
    identityPriceStable,
    powerMissing,
  };
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().then((result) => {
    console.log(JSON.stringify({ sourceId: result.sourceId, sourceVerdict: result.sourceVerdict, summary: result.summary }, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
