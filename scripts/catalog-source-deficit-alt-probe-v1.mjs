import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { extractBodyContexts, extractKeyContexts } from './catalog-source-deficit-recon-v1.mjs';
import { extractLabelPairs } from './catalog-source-field-audit-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_DEFICIT_ALT_OUTPUT || 'catalog-source-deficit-alt-probe-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_DEFICIT_ALT_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(100000, Math.min(1500000, Number(process.env.CATALOG_SOURCE_DEFICIT_ALT_MAX_BODY_BYTES || 900000)));
const USER_AGENT = 'AvtoCenaDeficitAltProbe/1.0 (+read-only source qualification)';

const SAMPLES = [
  {
    market: 'korea',
    sourceId: 'bobaedream_korea_candidate',
    sourceOfferId: '2260063',
    url: 'https://www.bobaedream.co.kr/dealguide/carinfo.php?cat=spec&maker_no=3&model_no=1692&level_no=12449&class_no=26958&year_no=2016',
    binding: { maker_no: 3, model_no: 1692, level_no: 12449, class_no: 26958, year_no: 2016 },
  },
  {
    market: 'korea',
    sourceId: 'bobaedream_korea_candidate',
    sourceOfferId: '2262188',
    url: 'https://www.bobaedream.co.kr/dealguide/carinfo.php?cat=spec&maker_no=49&model_no=1589&level_no=16126&class_no=25294&year_no=2016',
    binding: { maker_no: 49, model_no: 1589, level_no: 16126, class_no: 25294, year_no: 2016 },
  },
];

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const BODY_LABEL_RE = /(?:^|\s)(?:차종|차체|차형|형식|body\s*type|body\s*style|vehicle\s*type)(?:\s|$|[:：])/i;
const BODY_VALUE_RE = /(?:세단|승용|해치백|왜건|쿠페|SUV|RV|밴|승합|픽업|트럭|sedan|hatchback|wagon|coupe|suv|crossover|minivan|van|pickup)/i;

function clean(value, limit = 500) {
  return String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 240);
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
    chunks.push(slice);
    total += slice.byteLength;
    if (value.byteLength > remaining) { truncated = true; break; }
  }
  return { body: Buffer.concat(chunks.map((x) => Buffer.from(x))).toString('utf8'), truncated };
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

function summarizeHtml(html, url) {
  const pairs = extractLabelPairs(html);
  const bodyPairs = pairs.filter((pair) => BODY_LABEL_RE.test(pair.label) || BODY_VALUE_RE.test(pair.value)).slice(0, 60);
  const keyContexts = extractKeyContexts(html, ['차종', '차체', '세단', '승용', 'SUV', '왜건', '해치백']).slice(0, 40);
  const bodyContexts = extractBodyContexts(html).slice(0, 24);
  const summary = {
    title: titleOf(html),
    bodyPairs,
    keyContexts,
    bodyContexts,
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
    truncated,
    bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
    summary: summarizeHtml(body, sample.url),
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

export async function runAltProbe() {
  const results = [];
  for (const sample of SAMPLES) results.push(await runOne(sample));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'source_deficit_discovered_route_probe_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    routeOrigin: 'discovered_in_run_33744960785',
    guessedRoutes: false,
    sampleCount: SAMPLES.length,
    results,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, sampleCount: payload.sampleCount, generatedAt: payload.generatedAt }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runAltProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
