import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.tc-v.com';
const LIST_URL = `${BASE_URL}/used_car/all/all/`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_TCV_JAPAN_OUTPUT || 'catalog-source-tcv-japan-qualification-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_TIMEOUT_MS || 20000)));
const MAX_BODY_BYTES = Math.max(500000, Math.min(8000000, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_MAX_BODY_BYTES || 6000000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaTcvJapanQualification/1.0 (+read-only source qualification)';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /captcha|cloudflare|verify (?:that )?you are human|checking your browser|access denied|request blocked|robot check|security check|cf-chl|challenge-platform/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanVisible(html, limit = 240000) {
  return decodeHtml(String(html || ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function safeUrl(value, base = LIST_URL) {
  try {
    const url = new URL(decodeHtml(String(value || '')), base);
    if (url.origin !== BASE_URL) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function parseTcvDetailUrl(value) {
  try {
    const url = new URL(value, LIST_URL);
    if (url.origin !== BASE_URL) return null;
    const match = url.pathname.match(/^\/used_car\/([^/]+)\/([^/]+)\/(\d{5,})\/?$/i);
    if (!match) return null;
    return {
      makeSlug: decodeURIComponent(match[1]).toLowerCase(),
      modelSlug: decodeURIComponent(match[2]).toLowerCase(),
      listingId: match[3],
      url: `${BASE_URL}${url.pathname}`,
    };
  } catch {
    return null;
  }
}

function titleOf(html) {
  return cleanVisible(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 400);
}

function capture(text, re, limit = 220) {
  const value = String(text || '').match(re)?.[1];
  return value ? String(value).replace(/\s+/g, ' ').trim().slice(0, limit) : null;
}

function numeric(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function uniqBy(values, keyFn, limit = 100) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function powerTokens(text) {
  const rows = [...String(text || '').matchAll(/\b([\d,.]{1,8})\s*(HP|PS|kW)\b/gi)]
    .map((match) => ({ value: numeric(match[1]), unit: match[2].toUpperCase() }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);
  return uniqBy(rows, (row) => `${row.value}:${row.unit}`, 20);
}

function normalizeFuel(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (/electric|\bev\b/.test(text) && !/hybrid/.test(text)) return 'electric';
  if (/hybrid|phev|hev/.test(text)) return 'hybrid';
  if (/diesel/.test(text)) return 'diesel';
  if (/gasoline|petrol/.test(text)) return 'petrol';
  if (/lpg/.test(text)) return 'lpg';
  if (/cng/.test(text)) return 'cng';
  return text.replace(/\s+/g, ' ').trim();
}

function sameValue(a, b) {
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).replace(/\s+/g, ' ').trim().toLowerCase() === String(b).replace(/\s+/g, ' ').trim().toLowerCase();
}

function detailHrefInSegment(segment, listingId) {
  for (const match of String(segment || '').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const absolute = safeUrl(match[1]);
    const parsed = absolute ? parseTcvDetailUrl(absolute) : null;
    if (parsed?.listingId === listingId) return parsed;
  }
  return null;
}

export function parseTcvListCard(segment, expectedListingId = null) {
  const source = String(segment || '');
  const text = cleanVisible(source, 14000);
  const listingId = expectedListingId || capture(source, /\bdata-car-id\s*=\s*["'](\d{5,})["']/i);
  if (!listingId) return null;
  const identity = detailHrefInSegment(source, listingId);
  if (!identity) return null;
  const yearMonth = capture(text, /\bRegistration Year\s*((?:19|20)\d{2}(?:\/\d{1,2})?)/i);
  const engineCc = numeric(capture(text, /\bEngine Capacity\s*([\d,]+(?:\.\d+)?)\s*cc\b/i));
  const mileageKm = numeric(capture(text, /\bMileage\s*([\d,]+(?:\.\d+)?)\s*km\b/i));
  const priceUsd = numeric(capture(text, /\bFOB Price\s*US\$\s*([\d,]+(?:\.\d+)?)/i));
  const directionalFuel = capture(text, /\b(?:RHD|LHD)\s+(Gasoline(?:\/Petrol)?|Petrol|Diesel|Hybrid(?:\([^)]*\))?|Electric|LPG|CNG)\b/i);
  const makeModel = capture(text, /\bSTOCK\s+((?:19|20)\d{2}\s+[A-Za-z0-9][A-Za-z0-9 .+&'()\/-]{2,100}?)(?=\s+FOB Price\b)/i, 140);
  return {
    ...identity,
    list: {
      makeModel,
      yearMonth,
      engineCc,
      mileageKm,
      priceUsd,
      currency: priceUsd != null ? 'USD' : null,
      fuel: directionalFuel,
      powerTokens: powerTokens(text),
    },
  };
}

export function extractTcvListCandidates(html, limit = 40) {
  const source = String(html || '');
  const starts = [];
  let lastId = null;
  for (const match of source.matchAll(/\bdata-car-id\s*=\s*["'](\d{5,})["']/gi)) {
    const id = match[1];
    if (id === lastId) continue;
    starts.push({ listingId: id, index: match.index ?? 0 });
    lastId = id;
  }
  const rows = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = starts[i + 1]?.index ?? source.length;
    const segment = source.slice(start.index, end);
    const parsed = parseTcvListCard(segment, start.listingId);
    if (parsed) rows.push(parsed);
    if (rows.length >= limit) break;
  }
  return uniqBy(rows, (row) => row.listingId, limit);
}

function specificSection(html) {
  const text = cleanVisible(html, 260000);
  const marker = /\bSpecific information\s+VIN\s*\(Vehicle Identification Number\)/i.exec(text);
  if (!marker) return { fullText: text, section: '' };
  const start = marker.index;
  const tail = text.slice(start);
  const endMatch = /\s+Options\s+(?:Safety|Comfort|Other|Selling Points)\b/i.exec(tail);
  const section = endMatch ? tail.slice(0, endMatch.index) : tail.slice(0, 45000);
  return { fullText: text, section };
}

function priceEvidence(fullText, html, expectedPriceUsd) {
  if (!Number.isFinite(expectedPriceUsd)) return { priceUsd: null, currency: null, contexts: [] };
  const formatted = Number(expectedPriceUsd).toLocaleString('en-US');
  const patterns = [
    new RegExp(`(?:FOB|Vehicle|Car)?\\s*Price[^\\d]{0,40}(?:US\\$|USD|\\$)\\s*${formatted.replace(',', ',?')}(?!\\d)`, 'ig'),
    new RegExp(`(?:US\\$|USD|\\$)\\s*${formatted.replace(',', ',?')}(?!\\d)`, 'ig'),
  ];
  const contexts = [];
  for (const text of [String(fullText || ''), decodeHtml(String(html || ''))]) {
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        const index = match.index ?? 0;
        const around = cleanVisible(text.slice(Math.max(0, index - 180), Math.min(text.length, index + 260)), 500);
        if (!contexts.includes(around)) contexts.push(around);
        if (contexts.length >= 8) break;
      }
      if (contexts.length >= 8) break;
    }
    if (contexts.length >= 8) break;
  }
  return {
    priceUsd: contexts.length ? expectedPriceUsd : null,
    currency: contexts.length ? 'USD' : null,
    contexts,
  };
}

function imageEvidence(html, listingId) {
  const urls = [];
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy)\s*=\s*["']([^"']+)["']/gi)) {
    const absolute = safeUrl(match[1], BASE_URL);
    if (!absolute) continue;
    const lower = absolute.toLowerCase();
    if (/(?:logo|icon|sprite|banner|flag|avatar|placeholder|loading|googletagmanager|doubleclick)/i.test(lower)) continue;
    if (!lower.includes(String(listingId).toLowerCase())) continue;
    if (!urls.includes(absolute)) urls.push(absolute);
    if (urls.length >= 120) break;
  }
  return urls;
}

export function parseTcvDetail(html, url, expectedPriceUsd = null) {
  const identity = parseTcvDetailUrl(url);
  if (!identity) return null;
  const { fullText, section } = specificSection(html);
  const scoped = section || fullText;
  const yearMonth = capture(scoped, /\bRegistration Year\s*\/\s*Month\s*((?:19|20)\d{2}(?:\/\d{1,2})?)/i);
  const manufacture = capture(scoped, /\bManufacture Year\s*\/\s*Month\s*(Confirm with the Seller|(?:19|20)\d{2}(?:\/\d{1,2})?)/i);
  const mileageKm = numeric(capture(scoped, /\bMileage\s*([\d,]+(?:\.\d+)?)\s*km\b/i));
  const engineCc = numeric(capture(scoped, /\bEngine Capacity\s*\(Displacement\)\s*([\d,]+(?:\.\d+)?)\s*cc\b/i));
  const fuel = capture(scoped, /\bFuel\s+(.{1,50}?)(?=\s+BodyStyle1\b)/i, 80);
  const body1 = capture(scoped, /\bBodyStyle1\s+(.{1,50}?)(?=\s+BodyStyle2\b)/i, 80);
  const body2 = capture(scoped, /\bBodyStyle2\s+(.{1,50}?)(?=\s+Steering\b)/i, 80);
  const modelCode = capture(scoped, /\bModel Code\s+(.{1,60}?)(?=\s+Registration Year\b)/i, 80);
  const offerId = capture(scoped, /\bID\s+([A-Z0-9-]{3,})\b/i, 80);
  const detailPower = powerTokens(scoped);
  const images = imageEvidence(html, identity.listingId);
  const price = priceEvidence(fullText, html, expectedPriceUsd);
  return {
    ...identity,
    title: titleOf(html),
    yearMonth,
    manufacture,
    mileageKm,
    engineCc,
    fuel,
    body1,
    body2,
    modelCode,
    offerId,
    powerTokens: detailPower,
    images,
    listingBoundImageCount: images.length,
    priceUsd: price.priceUsd,
    currency: price.currency,
    priceContexts: price.contexts,
    specificSectionPresent: Boolean(section),
  };
}

function validPowerToken(token) {
  if (!token || !Number.isFinite(token.value)) return false;
  if (token.unit === 'KW') return token.value >= 1 && token.value <= 1000;
  return token.value >= 1 && token.value <= 1500;
}

export function buildTcvFieldMatrix(candidate, detail) {
  const fuel = normalizeFuel(detail?.fuel || candidate?.list?.fuel);
  const electrified = fuel === 'hybrid' || fuel === 'electric';
  const listPower = (candidate?.list?.powerTokens || []).filter(validPowerToken);
  const detailPower = (detail?.powerTokens || []).filter(validPowerToken);
  const detailUniquePower = detailPower.length === 1 ? detailPower[0] : null;
  const listPowerParity = listPower.length === 0 || (listPower.length === 1 && detailUniquePower && listPower[0].value === detailUniquePower.value && listPower[0].unit === detailUniquePower.unit);
  const fields = {
    identity: detail?.listingId === candidate?.listingId && detail?.url === candidate?.url && detail?.listingBoundImageCount > 0 ? 'exact' : 'missing_or_conflict',
    year: sameValue(candidate?.list?.yearMonth, detail?.yearMonth) ? 'exact' : 'missing_or_conflict',
    price: sameValue(candidate?.list?.priceUsd, detail?.priceUsd) ? 'exact' : 'missing_or_conflict',
    currency: candidate?.list?.currency === 'USD' && detail?.currency === 'USD' ? 'exact' : 'missing_or_conflict',
    mileage: sameValue(candidate?.list?.mileageKm, detail?.mileageKm) ? 'exact' : 'missing_or_conflict',
    engineCc: sameValue(candidate?.list?.engineCc, detail?.engineCc) && Number(detail?.engineCc) >= 300 && Number(detail?.engineCc) <= 10000 ? 'exact' : 'missing_or_conflict',
    fuel: normalizeFuel(candidate?.list?.fuel) && normalizeFuel(candidate?.list?.fuel) === normalizeFuel(detail?.fuel) ? 'exact' : 'missing_or_conflict',
    body: detail?.body1 && detail.body1 !== '-' ? 'exact' : 'missing',
    power: detailUniquePower && listPowerParity ? 'exact' : 'missing_or_ambiguous',
    certifiedPower: electrified ? 'missing' : 'not_applicable',
    gallery: detail?.listingBoundImageCount >= 5 ? 'exact' : 'unproven',
  };
  const acceptable = new Set(['exact', 'not_applicable']);
  const required = Object.keys(fields);
  return {
    fields,
    exactReady: required.every((field) => acceptable.has(fields[field])),
    deficits: required.filter((field) => !acceptable.has(fields[field])),
    electrified,
    listPower,
    detailPower,
    listingBoundImageCount: detail?.listingBoundImageCount || 0,
    priceEvidenceCount: detail?.priceContexts?.length || 0,
  };
}

async function fetchTimed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const raw = await response.text();
    const body = raw.slice(0, MAX_BODY_BYTES);
    const visible = cleanVisible(body, 120000);
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      bytes: Buffer.byteLength(body),
      truncated: raw.length > body.length,
      title: titleOf(body),
      challenge: CHALLENGE_RE.test(`${titleOf(body)} ${visible}`),
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRobots() {
  try {
    const result = await fetchTimed(`${BASE_URL}/robots.txt`);
    return { status: result.status, sha256: result.sha256, text: result.body.slice(0, 500000) };
  } catch (error) {
    return { status: null, sha256: null, text: '', error: String(error?.message || error) };
  }
}

function publicAttempt(result, parsed) {
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

function stableDetail(attempts, candidate) {
  if (attempts.length !== 2) return false;
  if (!attempts.every((row) => row.ok && !row.challenge && row.parsed?.listingId === candidate.listingId)) return false;
  const [a, b] = attempts.map((row) => row.parsed);
  return ['yearMonth', 'mileageKm', 'engineCc', 'fuel', 'body1', 'priceUsd', 'currency']
    .every((key) => (a[key] == null && b[key] == null) || sameValue(a[key], b[key]));
}

async function run() {
  const robots = await fetchRobots();
  const listPolicy = evaluateRobots(robots.text, LIST_URL, USER_AGENT);
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceId: 'tcv_japan_candidate',
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
    robots: { status: robots.status, sha256: robots.sha256, list: listPolicy },
    list: null,
    samples: [],
    sourceVerdict: 'research_pending',
    summary: null,
  };

  if (!listPolicy.allowed) {
    output.sourceVerdict = 'blocked_by_robots';
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0, priceMissing: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  let listResult;
  try {
    listResult = await fetchTimed(LIST_URL);
  } catch (error) {
    output.list = { error: String(error?.message || error) };
    output.sourceVerdict = 'network_error';
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0, priceMissing: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  const candidates = listResult.ok && !listResult.challenge ? extractTcvListCandidates(listResult.body, 50) : [];
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
    candidateSample: candidates.slice(0, 8),
  };

  if (!listResult.ok || listResult.challenge) {
    output.sourceVerdict = listResult.challenge ? 'challenge' : `http_${listResult.status}`;
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0, priceMissing: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  for (const candidate of candidates.slice(0, SAMPLE_COUNT)) {
    const policy = evaluateRobots(robots.text, candidate.url, USER_AGENT);
    if (!policy.allowed) {
      output.samples.push({ listingId: candidate.listingId, url: candidate.url, list: candidate.list, robots: policy, stableReachable: false, exactReady: false, blocker: 'robots_disallowed' });
      continue;
    }
    const attempts = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        const result = await fetchTimed(candidate.url);
        const parsed = result.ok && !result.challenge ? parseTcvDetail(result.body, result.finalUrl || candidate.url, candidate.list.priceUsd) : null;
        attempts.push(publicAttempt(result, parsed));
      } catch (error) {
        attempts.push({ ok: false, challenge: false, error: String(error?.message || error), parsed: null });
      }
    }
    const stableReachable = stableDetail(attempts, candidate);
    const detail = attempts[1]?.parsed || attempts[0]?.parsed || null;
    const matrix = detail ? buildTcvFieldMatrix(candidate, detail) : null;
    output.samples.push({
      listingId: candidate.listingId,
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
  const priceMissing = output.samples.filter((row) => row.stableReachable && row.matrix?.fields?.price !== 'exact').length;

  if (!candidates.length) output.sourceVerdict = 'no_source_declared_card_candidates';
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
    priceMissing,
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
