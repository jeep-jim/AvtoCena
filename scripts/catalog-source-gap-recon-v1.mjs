import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_GAP_RECON_OUTPUT || 'catalog-source-gap-recon-v1.json';
const TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_GAP_RECON_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(200_000, Math.min(2_000_000, Number(process.env.CATALOG_SOURCE_GAP_RECON_MAX_BODY_BYTES || 1_500_000)));
const USER_AGENT = 'AvtoCenaGapRecon/1.0 (+read-only source qualification)';

const SAMPLES = [
  { sourceId: 'bobaedream_korea_candidate', market: 'korea', gaps: ['body', 'gallery'], url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K' },
  { sourceId: 'bobaedream_korea_candidate', market: 'korea', gaps: ['body', 'gallery'], url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K' },
  { sourceId: 'carswitch_uae_candidate', market: 'uae', gaps: ['engineCc', 'powerHp'], url: 'https://carswitch.com/abudhabi/used-car/chevrolet/captiva/2025/864601' },
  { sourceId: 'carswitch_uae_candidate', market: 'uae', gaps: ['engineCc', 'powerHp'], url: 'https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416' },
  { sourceId: 'cars24_uae_candidate', market: 'uae', gaps: ['price', 'engineCc', 'powerHp'], url: 'https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/' },
  { sourceId: 'cars24_uae_candidate', market: 'uae', gaps: ['price', 'engineCc', 'powerHp'], url: 'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/' },
  { sourceId: 'dubicars_uae_exact', market: 'uae', gaps: ['engineCc', 'powerHp', 'gallery'], url: 'https://www.dubicars.com/2019-hyundai-veloster-740206.html' },
  { sourceId: 'dubicars_uae_exact', market: 'uae', gaps: ['certifiedPower', 'gallery'], url: 'https://www.dubicars.com/2023-bmw-ix1-979972.html' },
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
const INTEREST_RE = /(?:body|bodyType|bodyStyle|vehicleType|carType|sedan|hatchback|suv|coupe|wagon|convertible|engine|displacement|capacity|horsepower|horsePower|powerHp|enginePower|maxPower|maximumPower|ratedPower|certifiedPower|continuousPower|30.?minute|price|sellingPrice|salePrice|displayPrice|totalPrice|amount|gallery|image|images|photo|photos|배기량|마력|최대출력|차종|차체|가격|판매가|사진|이미지|정격출력)/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
function clean(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function visibleText(html) {
  return decodeHtml(String(html || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function safeUrl(value, base) {
  try {
    const url = new URL(decodeHtml(String(value || '')).replace(/\\\//g, '/'), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
function unique(values, limit = 100) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

export function keyValueHits(text) {
  const rows = [];
  const patterns = [
    /["']([A-Za-z_$][A-Za-z0-9_$.-]{1,80})["']\s*:\s*["']([^"']{1,500})["']/g,
    /["']([A-Za-z_$][A-Za-z0-9_$.-]{1,80})["']\s*:\s*(-?\d+(?:\.\d+)?)/g,
    /\b([A-Za-z_$][A-Za-z0-9_$.-]{1,80})\s*:\s*["']([^"']{1,500})["']/g,
    /\b([A-Za-z_$][A-Za-z0-9_$.-]{1,80})\s*:\s*(-?\d+(?:\.\d+)?)/g,
  ];
  for (const re of patterns) {
    for (const match of String(text || '').matchAll(re)) {
      if (!INTEREST_RE.test(match[1])) continue;
      rows.push({ key: match[1], value: match[2] });
      if (rows.length >= 300) break;
    }
  }
  return unique(rows, 160);
}

export function contextsAround(text, needles, radius = 900, limit = 30) {
  const source = decodeHtml(String(text || ''));
  const lower = source.toLowerCase();
  const rows = [];
  for (const needle of needles.filter(Boolean)) {
    const target = String(needle).toLowerCase();
    let from = 0;
    for (let count = 0; count < 8; count++) {
      const index = lower.indexOf(target, from);
      if (index < 0) break;
      const start = Math.max(0, index - radius);
      const end = Math.min(source.length, index + target.length + radius);
      rows.push({ needle: String(needle), context: clean(source.slice(start, end)).slice(0, 1600) });
      from = index + target.length;
      if (rows.length >= limit) return unique(rows, limit);
    }
  }
  return unique(rows, limit);
}

function extractScriptSrcs(html, baseUrl) {
  return unique([...String(html || '').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => safeUrl(m[1], baseUrl)).filter(Boolean), 80);
}
function extractInlineScripts(html) {
  return [...String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1] || '', body: decodeHtml(m[2] || '') }))
    .filter((row) => row.body.trim())
    .slice(0, 80);
}
function extractJsonScripts(html) {
  const rows = [];
  for (const script of extractInlineScripts(html)) {
    const type = script.attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    const id = script.attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!['application/ld+json', 'application/json'].includes(type) && id !== '__NEXT_DATA__') continue;
    try { rows.push({ type, id, value: JSON.parse(script.body) }); } catch {}
  }
  return rows;
}
function walk(value, path = '$', out = [], depth = 0) {
  if (depth > 14 || out.length > 25_000 || value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((item, index) => walk(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push({ path, value });
  for (const [key, child] of Object.entries(value).slice(0, 500)) walk(child, `${path}.${key}`, out, depth + 1);
  return out;
}

export function objectEvidenceNearId(jsonScripts, sourceOfferId) {
  if (!sourceOfferId) return [];
  const rows = [];
  for (const script of jsonScripts) {
    for (const { path, value } of walk(script.value)) {
      let serialized = '';
      try { serialized = JSON.stringify(value); } catch { continue; }
      if (!serialized.includes(sourceOfferId) || serialized.length > 250_000) continue;
      const keys = Object.keys(value).slice(0, 120);
      const interesting = [];
      for (const [key, child] of Object.entries(value)) {
        if (!INTEREST_RE.test(key)) continue;
        if (['string', 'number', 'boolean'].includes(typeof child)) interesting.push({ key, value: String(child).slice(0, 500) });
        else if (Array.isArray(child)) interesting.push({ key, arrayLength: child.length, sample: child.slice(0, 5).map((x) => typeof x === 'string' ? x.slice(0, 300) : typeof x) });
        else if (child && typeof child === 'object') interesting.push({ key, objectKeys: Object.keys(child).slice(0, 50) });
      }
      rows.push({ scriptType: script.type, scriptId: script.id, path, keys, interesting });
      if (rows.length >= 30) return rows;
    }
  }
  return rows;
}

function extractUrlsFromText(text, baseUrl) {
  const rows = [];
  for (const match of String(text || '').matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+/gi)) rows.push(safeUrl(match[0], baseUrl));
  for (const match of String(text || '').matchAll(/["'`](\/(?:api|ajax|graphql|search|cars?|vehicles?|offers?|inventory|listing|product|detail|mycar)[^"'`<>\s]{1,240})["'`]/gi)) rows.push(safeUrl(match[1], baseUrl));
  return unique(rows.filter(Boolean), 300);
}

function candidateExplicitGets(html, baseUrl, sourceOfferId) {
  const origin = new URL(baseUrl).origin;
  const values = [];
  for (const match of String(html || '').matchAll(/(?:fetch|axios\.get|\.get)\s*\(\s*["']([^"']+)["']/gi)) values.push(safeUrl(match[1], baseUrl));
  for (const script of extractInlineScripts(html)) values.push(...extractUrlsFromText(script.body, baseUrl));
  return unique(values.filter((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== origin) return false;
      if (!sourceOfferId || !url.includes(sourceOfferId)) return false;
      return /api|ajax|graphql|car|vehicle|offer|inventory|listing|product|detail|mycar/i.test(parsed.pathname + parsed.search);
    } catch { return false; }
  }), 30);
}

function imageUrls(text, baseUrl) {
  const values = [];
  for (const match of String(text || '').matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'`<>\\\s]*)?/gi)) values.push(safeUrl(match[0], baseUrl));
  for (const match of String(text || '').matchAll(/(?:src|data-src|data-original|content)\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) values.push(safeUrl(match[1], baseUrl));
  return unique(values.filter((url) => url && !/(?:logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code)/i.test(url)), 300);
}

export function localIdEvidence(html, baseUrl, sourceOfferId) {
  if (!sourceOfferId) return [];
  const rows = [];
  for (const script of extractInlineScripts(html)) {
    const body = script.body;
    let from = 0;
    for (let count = 0; count < 10; count++) {
      const index = body.indexOf(sourceOfferId, from);
      if (index < 0) break;
      const fragment = body.slice(Math.max(0, index - 12_000), Math.min(body.length, index + 20_000));
      const kv = keyValueHits(fragment);
      const images = imageUrls(fragment, baseUrl);
      const urls = extractUrlsFromText(fragment, baseUrl).filter((url) => url.includes(sourceOfferId)).slice(0, 30);
      rows.push({
        index,
        fragmentHashSha256: sha256(fragment),
        keyValues: kv,
        imageCount: images.length,
        imageSamples: images.slice(0, 30),
        idBoundUrls: urls,
        interestContexts: contextsAround(fragment, ['body', 'vehicleType', 'engine', 'displacement', 'horsepower', 'power', 'price', 'gallery', 'image', '배기량', '마력', '차종', '가격', '사진'], 500, 20),
      });
      from = index + sourceOfferId.length;
      if (rows.length >= 10) break;
    }
  }
  return rows;
}

function visibleGapContexts(html) {
  const text = visibleText(html);
  return contextsAround(text, ['body type', 'vehicle type', 'body style', 'engine size', 'engine capacity', 'displacement', 'horsepower', 'engine power', 'maximum power', 'rated power', 'certified power', '30-minute power', 'price', '차종', '차체', '배기량', '마력', '최대출력', '정격출력', '가격', '판매가', '사진'], 550, 35);
}

const robotsCache = new Map();
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function robotsFor(url) {
  const origin = new URL(url).origin;
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const robotsUrl = `${origin}/robots.txt`;
  let result;
  try {
    const response = await fetchWithTimeout(robotsUrl, { headers: HEADERS, redirect: 'follow' });
    const text = (await response.text()).slice(0, 500_000);
    result = { status: response.status, text: response.ok ? text : '' };
  } catch (error) { result = { status: null, text: '', error: String(error?.message || error) }; }
  robotsCache.set(origin, result);
  return result;
}
async function allowedByRobots(url) {
  const robots = await robotsFor(url);
  if (!robots.text) return { allowed: true, robotsStatus: robots.status, matchedRule: null };
  const policy = evaluateRobots(robots.text, url, USER_AGENT);
  return { allowed: policy.allowed, robotsStatus: robots.status, matchedRule: policy.matchedRule };
}
async function getText(url, referer = '') {
  const policy = await allowedByRobots(url);
  if (!policy.allowed) return { kind: 'robots_disallowed', url, policy };
  try {
    const response = await fetchWithTimeout(url, { headers: { ...HEADERS, ...(referer ? { referer } : {}) }, redirect: 'follow' });
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
    const textPrefix = `${titleOf(body)} ${visibleText(body).slice(0, 20_000)}`;
    return {
      kind: CHALLENGE_RE.test(textPrefix) ? 'challenge' : LOGIN_RE.test(textPrefix) ? 'login_wall' : response.ok ? 'reachable' : 'http_error',
      url,
      finalUrl: response.url || url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes: bytes.length,
      truncated: bytes.length > MAX_BODY_BYTES,
      bodyHashSha256: sha256(bytes),
      body,
      policy,
    };
  } catch (error) { return { kind: 'network_error', url, error: String(error?.message || error), policy }; }
}

async function inspectSecondaryUrl(url, referer) {
  const result = await getText(url, referer);
  if (!result.body) return { ...result, body: undefined };
  const body = result.body;
  return {
    kind: result.kind,
    url,
    finalUrl: result.finalUrl,
    status: result.status,
    contentType: result.contentType,
    bytes: result.bytes,
    truncated: result.truncated,
    bodyHashSha256: result.bodyHashSha256,
    policy: result.policy,
    keyValues: keyValueHits(body),
    contexts: contextsAround(body, ['bodyType', 'vehicleType', 'engine', 'displacement', 'horsepower', 'powerHp', 'enginePower', 'ratedPower', 'certifiedPower', 'price', 'gallery', 'images', 'photos', '배기량', '마력', '차종', '가격'], 650, 25),
    imageCount: imageUrls(body, result.finalUrl || url).length,
  };
}

async function inspectSample(sample) {
  const detail = await getText(sample.url);
  if (!detail.body) return { ...sample, sourceOfferId: sourceOfferIdFromUrl(sample.url), detail: { ...detail, body: undefined } };
  const html = detail.body;
  const sourceOfferId = sourceOfferIdFromUrl(detail.finalUrl || sample.url);
  const jsonScripts = extractJsonScripts(html);
  const scriptSrcs = extractScriptSrcs(html, detail.finalUrl || sample.url);
  const sameOriginScripts = scriptSrcs.filter((url) => {
    try { return new URL(url).origin === new URL(detail.finalUrl || sample.url).origin; } catch { return false; }
  }).slice(0, 8);
  const explicitGets = candidateExplicitGets(html, detail.finalUrl || sample.url, sourceOfferId).slice(0, 8);

  const secondary = [];
  for (const url of unique([...explicitGets, ...sameOriginScripts], 12)) secondary.push(await inspectSecondaryUrl(url, detail.finalUrl || sample.url));

  return {
    sourceId: sample.sourceId,
    market: sample.market,
    gaps: sample.gaps,
    requestedUrl: sample.url,
    sourceOfferId,
    detail: {
      kind: detail.kind,
      finalUrl: detail.finalUrl,
      status: detail.status,
      contentType: detail.contentType,
      bytes: detail.bytes,
      truncated: detail.truncated,
      bodyHashSha256: detail.bodyHashSha256,
      title: titleOf(html),
      policy: detail.policy,
    },
    objectEvidenceNearId: objectEvidenceNearId(jsonScripts, sourceOfferId),
    localIdEvidence: localIdEvidence(html, detail.finalUrl || sample.url, sourceOfferId),
    visibleGapContexts: visibleGapContexts(html),
    globalInterestingKeyValues: keyValueHits(html),
    pageImages: {
      uniqueCount: imageUrls(html, detail.finalUrl || sample.url).length,
      samples: imageUrls(html, detail.finalUrl || sample.url).slice(0, 40),
    },
    explicitSameOriginGetCandidates: explicitGets,
    sameOriginScriptCount: sameOriginScripts.length,
    secondary,
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

export async function runRecon() {
  const results = await runWithConcurrency(SAMPLES, 3, inspectSample);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'targeted_source_gap_recon_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    rawBodiesStored: false,
    requestMethod: 'GET_only',
    challengeBypass: false,
    robotsBypass: false,
    sampleCount: SAMPLES.length,
    results,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    generatedAt: payload.generatedAt,
    sampleCount: payload.sampleCount,
    results: results.map((row) => ({
      sourceId: row.sourceId,
      sourceOfferId: row.sourceOfferId,
      kind: row.detail?.kind,
      localEvidenceBlocks: row.localIdEvidence?.length || 0,
      objectEvidenceBlocks: row.objectEvidenceNearId?.length || 0,
      pageImages: row.pageImages?.uniqueCount || 0,
      explicitGets: row.explicitSameOriginGetCandidates?.length || 0,
      secondary: row.secondary?.length || 0,
    })),
    output: OUTPUT_PATH,
  }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runRecon().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
