import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.tc-v.com';
const LIST_URL = `${BASE_URL}/used_car/all/all/`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_TCV_JAPAN_ANATOMY_OUTPUT || 'catalog-source-tcv-japan-anatomy-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_ANATOMY_TIMEOUT_MS || 20000)));
const MAX_BODY_BYTES = Math.max(500000, Math.min(8000000, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_ANATOMY_MAX_BODY_BYTES || 6000000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_TCV_JAPAN_ANATOMY_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaTcvJapanAnatomy/1.0 (+read-only source qualification)';

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

function cleanVisible(html, limit = 120000) {
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

function titleOf(html) {
  return cleanVisible(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 400);
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

function parseDetailUrl(value) {
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

function extractListCandidates(html, limit = 30) {
  const source = String(html || '');
  const rows = [];
  for (const match of source.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const absolute = safeUrl(match[1]);
    const identity = absolute ? parseDetailUrl(absolute) : null;
    if (!identity) continue;
    const index = match.index ?? 0;
    const around = source.slice(Math.max(0, index - 2600), Math.min(source.length, index + 5200));
    const context = cleanVisible(around, 5200);
    const anchorText = cleanVisible(match[2], 500);
    rows.push({ ...identity, anchorText, context });
  }
  return uniq(rows, limit);
}

function capture(text, re) {
  const value = String(text || '').match(re)?.[1];
  return value ? String(value).replace(/\s+/g, ' ').trim().slice(0, 220) : null;
}

function numeric(value) {
  if (!value) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function analyzeVisible(html, listingId = null) {
  const text = cleanVisible(html, 220000);
  const imageUrls = uniq([...String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => safeUrl(m[1], BASE_URL))
    .filter(Boolean), 300);
  const probableListingImages = imageUrls.filter((url) => {
    const lower = url.toLowerCase();
    if (/(?:logo|icon|sprite|banner|flag|avatar|placeholder|loading|googletagmanager|doubleclick)/i.test(lower)) return false;
    return listingId ? lower.includes(String(listingId).toLowerCase()) : true;
  });

  const powerTokens = uniq([
    ...[...text.matchAll(/\b(?:Horsepower|Engine Power|Max(?:imum)? Power|Power Output)\s*[:：-]?\s*([\d,.]+)\s*(HP|PS|kW)\b/gi)]
      .map((m) => `${m[1]} ${m[2].toUpperCase()}`),
    ...[...text.matchAll(/\b([\d,.]+)\s*(HP|PS|kW)\b/gi)]
      .map((m) => `${m[1]} ${m[2].toUpperCase()}`),
  ], 20);

  return {
    registrationYear: capture(text, /\bRegistration Year\s*((?:19|20)\d{2}(?:\/\d{1,2})?)/i),
    manufactureYear: capture(text, /\bManufacture Year\s*((?:19|20)\d{2}(?:\/\d{1,2})?|ASK)/i),
    engineCc: numeric(capture(text, /\bEngine Capacity\s*([\d,]+(?:\.\d+)?)\s*cc\b/i)),
    mileageKm: numeric(capture(text, /\bMileage\s*([\d,]+(?:\.\d+)?)\s*km\b/i)),
    priceUsd: numeric(capture(text, /\bFOB Price\s*US\$\s*([\d,]+(?:\.\d+)?)/i)),
    refNo: capture(text, /\bRef\.?\s*No\.?\s*[:：]?\s*([A-Z0-9-]{3,})\b/i),
    fuelToken: capture(text, /\b(Diesel|Gasoline|Petrol|Hybrid|Electric|LPG|CNG)\b/i),
    bodyToken: capture(text, /\b(?:Body ?Style|Body ?Type)\s*[:：]?\s*([A-Za-z0-9 /+-]{2,50})/i),
    powerTokens,
    imageCount: imageUrls.length,
    listingBoundImageCount: probableListingImages.length,
    imageSample: probableListingImages.slice(0, 12),
    textSignals: {
      hasRegistrationYear: /\bRegistration Year\b/i.test(text),
      hasEngineCapacity: /\bEngine Capacity\b/i.test(text),
      hasMileage: /\bMileage\b/i.test(text),
      hasFobPrice: /\bFOB Price\b/i.test(text),
      hasFuel: /\b(?:Diesel|Gasoline|Petrol|Hybrid|Electric|LPG|CNG)\b/i.test(text),
      hasBodyLabel: /\b(?:Body ?Style|Body ?Type)\b/i.test(text),
      hasPowerLabel: /\b(?:Horsepower|Engine Power|Max(?:imum)? Power|Power Output)\b/i.test(text),
    },
    visibleSample: text.slice(0, 6000),
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
    const response = await fetchTimed(`${BASE_URL}/robots.txt`);
    return { status: response.status, sha256: response.sha256, text: response.body.slice(0, 500000) };
  } catch (error) {
    return { status: null, sha256: null, text: '', error: String(error?.message || error) };
  }
}

async function main() {
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
    summary: null,
  };

  if (!listPolicy.allowed) {
    output.summary = { listReachable: false, candidateCount: 0, sampled: 0, detailOk: 0, repeatable: 0, challenge: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  let listResult;
  try {
    listResult = await fetchTimed(LIST_URL);
  } catch (error) {
    output.list = { error: String(error?.message || error) };
    output.summary = { listReachable: false, candidateCount: 0, sampled: 0, detailOk: 0, repeatable: 0, challenge: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  const candidates = listResult.ok && !listResult.challenge ? extractListCandidates(listResult.body, 40) : [];
  output.list = {
    status: listResult.status,
    ok: listResult.ok,
    finalUrl: listResult.finalUrl,
    bytes: listResult.bytes,
    truncated: listResult.truncated,
    title: listResult.title,
    challenge: listResult.challenge,
    sha256: listResult.sha256,
    candidateCount: candidates.length,
    candidateSample: candidates.slice(0, 8),
    analyzed: listResult.ok && !listResult.challenge ? analyzeVisible(listResult.body) : null,
  };

  for (const candidate of candidates.slice(0, SAMPLE_COUNT)) {
    const policy = evaluateRobots(robots.text, candidate.url, USER_AGENT);
    const row = { listingId: candidate.listingId, url: candidate.url, anchorText: candidate.anchorText, listContext: candidate.context, robots: policy, attempts: [] };
    if (!policy.allowed) {
      row.blocker = 'robots_disallowed';
      output.samples.push(row);
      continue;
    }
    for (let i = 0; i < 2; i += 1) {
      try {
        const result = await fetchTimed(candidate.url);
        row.attempts.push({
          status: result.status,
          ok: result.ok,
          finalUrl: result.finalUrl,
          bytes: result.bytes,
          truncated: result.truncated,
          title: result.title,
          challenge: result.challenge,
          sha256: result.sha256,
          analyzed: result.ok && !result.challenge ? analyzeVisible(result.body, candidate.listingId) : null,
        });
      } catch (error) {
        row.attempts.push({ ok: false, challenge: false, error: String(error?.message || error), analyzed: null });
      }
    }
    row.repeatable = row.attempts.length === 2
      && row.attempts.every((attempt) => attempt.ok && !attempt.challenge)
      && row.attempts[0].finalUrl === row.attempts[1].finalUrl
      && row.attempts[0].analyzed?.registrationYear === row.attempts[1].analyzed?.registrationYear
      && row.attempts[0].analyzed?.priceUsd === row.attempts[1].analyzed?.priceUsd
      && row.attempts[0].analyzed?.engineCc === row.attempts[1].analyzed?.engineCc;
    output.samples.push(row);
  }

  output.summary = {
    listReachable: listResult.ok && !listResult.challenge,
    candidateCount: candidates.length,
    sampled: output.samples.length,
    detailOk: output.samples.filter((row) => row.attempts?.every((attempt) => attempt.ok && !attempt.challenge)).length,
    repeatable: output.samples.filter((row) => row.repeatable).length,
    challenge: output.samples.filter((row) => row.attempts?.some((attempt) => attempt.challenge)).length,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

main().then((result) => {
  console.log(JSON.stringify({ sourceId: result.sourceId, summary: result.summary }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
