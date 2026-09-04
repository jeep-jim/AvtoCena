import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import {
  buildSbtFieldMatrix,
  parseSbtDetail,
  parseSbtDetailUrl,
  parseSbtListContext,
} from './catalog-source-sbtjapan-japan-qualification-v1.mjs';

const BASE_URL = 'https://www.sbtjapan.com';
const LIST_URL = `${BASE_URL}/used-cars/search`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_V2_OUTPUT || 'catalog-source-sbtjapan-japan-qualification-v2.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_V2_TIMEOUT_MS || 20000)));
const MAX_BODY_BYTES = Math.max(1000000, Math.min(8000000, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_V2_MAX_BODY_BYTES || 6000000)));
const SAMPLE_COUNT = Math.max(2, Math.min(6, Number(process.env.CATALOG_SOURCE_SBTJAPAN_JAPAN_V2_SAMPLE_COUNT || 4)));
const USER_AGENT = 'AvtoCenaSbtJapanQualification/2.0 (+read-only source qualification)';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /verify (?:that )?you are human|checking your browser before accessing|complete (?:the )?(?:security verification|challenge) to continue|access denied(?:\s*[|:-]|$)|request blocked(?:\s*[|:-]|$)|cf-chl-/i;

function cleanVisible(html, limit = 100000) {
  return String(html || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function exactFuelLabel(value) {
  const text = cleanVisible(value, 120000);
  const labeled = text.match(/\bFuel\s*:?\s*(HYBRID\s*\([^)]*\)|PETROL|GASOLINE|DIESEL|ELECTRIC|LPG|CNG|HYBRID)(?=\s|<|$)/i)?.[1];
  const composite = text.match(/\b(HYBRID\s*\([^)]*\))/i)?.[1];
  const simple = text.match(/\b(PETROL|GASOLINE|DIESEL|ELECTRIC|LPG|CNG|HYBRID)\b/i)?.[1];
  const fuel = labeled || composite || simple || null;
  return fuel ? fuel.replace(/\s+/g, '').replace(/^GASOLINE$/i, 'GASOLINE').toUpperCase() : null;
}

function uniqueByStock(rows, limit = 50) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row?.stockId || seen.has(row.stockId)) continue;
    seen.add(row.stockId);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function absoluteUrl(value) {
  try {
    const url = new URL(String(value || ''), LIST_URL);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function extractSbtCardCandidates(html, limit = 50) {
  const source = String(html || '');
  const rows = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorRe)) {
    const url = absoluteUrl(match[1]);
    const identity = url ? parseSbtDetailUrl(url) : null;
    if (!identity) continue;
    const cardText = cleanVisible(match[2], 16000);
    if (!/\bVehicle Price\b/i.test(cardText) || !/\bStock\s+Id\b/i.test(cardText)) continue;
    const parsedList = parseSbtListContext(cardText);
    const list = { ...parsedList, fuel: exactFuelLabel(cardText) || parsedList.fuel };
    if (!list.stockId || list.stockId.toUpperCase() !== identity.stockId) continue;
    if (!list.yearMonth || !Number.isFinite(list.priceUsd) || !list.currency) continue;
    rows.push({ ...identity, list });
  }
  return uniqueByStock(rows, limit);
}

function titleOf(html) {
  return cleanVisible(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 300);
}

async function fetchTimed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    const bounded = text.slice(0, MAX_BODY_BYTES);
    const visible = cleanVisible(bounded, 120000);
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      bytes: Buffer.byteLength(bounded),
      truncated: text.length > bounded.length,
      title: titleOf(bounded),
      challenge: CHALLENGE_RE.test(`${titleOf(bounded)} ${visible}`),
      sha256: crypto.createHash('sha256').update(bounded).digest('hex'),
      body: bounded,
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

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function stableDetail(attempts, stockId) {
  if (attempts.length !== 2) return false;
  if (!attempts.every((row) => row.ok && !row.challenge && row.parsed?.stockId?.toUpperCase() === stockId)) return false;
  const [a, b] = attempts.map((row) => row.parsed);
  return ['yearMonth', 'priceUsd', 'currency', 'mileageKm', 'engineCc', 'fuel', 'body']
    .every((key) => sameValue(a[key], b[key]));
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

async function run() {
  const robots = await fetchRobots();
  const listPolicy = evaluateRobots(robots.text, LIST_URL, USER_AGENT);
  const output = {
    version: 2,
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
    robots: { status: robots.status, sha256: robots.sha256, list: listPolicy },
    list: null,
    samples: [],
    sourceVerdict: 'research_pending',
    summary: null,
  };

  if (!listPolicy.allowed) {
    output.sourceVerdict = 'blocked_by_robots';
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  let listResult;
  try {
    listResult = await fetchTimed(LIST_URL);
  } catch (error) {
    output.list = { error: String(error?.message || error) };
    output.sourceVerdict = 'network_error';
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0 };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }

  const candidates = listResult.ok && !listResult.challenge ? extractSbtCardCandidates(listResult.body, 50) : [];
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
    output.summary = { candidateCount: 0, sampled: 0, stableReachable: 0, exactReady: 0, identityPriceStable: 0, powerMissing: 0 };
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
        const baseParsed = result.ok && !result.challenge ? parseSbtDetail(result.body, candidate.url) : null;
        const parsed = baseParsed ? { ...baseParsed, fuel: exactFuelLabel(result.body) || baseParsed.fuel } : null;
        attempts.push(publicAttempt(result, parsed));
      } catch (error) {
        attempts.push({ ok: false, challenge: false, error: String(error?.message || error), parsed: null });
      }
    }

    const stableReachable = stableDetail(attempts, candidate.stockId);
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
