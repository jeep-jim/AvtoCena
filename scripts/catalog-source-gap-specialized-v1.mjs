import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import { sourceOfferIdFromUrl } from './catalog-source-field-audit-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_GAP_SPECIALIZED_OUTPUT || 'catalog-source-gap-specialized-v1.json';
const TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.CATALOG_SOURCE_GAP_SPECIALIZED_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(300_000, Math.min(2_000_000, Number(process.env.CATALOG_SOURCE_GAP_SPECIALIZED_MAX_BODY_BYTES || 1_500_000)));
const USER_AGENT = 'AvtoCenaGapSpecialized/1.0 (+read-only source qualification)';

const SAMPLES = [
  { sourceId: 'bobaedream_korea_candidate', market: 'korea', url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K' },
  { sourceId: 'bobaedream_korea_candidate', market: 'korea', url: 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K' },
  { sourceId: 'carswitch_uae_candidate', market: 'uae', url: 'https://carswitch.com/abudhabi/used-car/chevrolet/captiva/2025/864601' },
  { sourceId: 'carswitch_uae_candidate', market: 'uae', url: 'https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416' },
  { sourceId: 'cars24_uae_candidate', market: 'uae', url: 'https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/' },
  { sourceId: 'cars24_uae_candidate', market: 'uae', url: 'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/' },
  { sourceId: 'dubicars_uae_exact', market: 'uae', url: 'https://www.dubicars.com/2019-hyundai-veloster-740206.html' },
  { sourceId: 'dubicars_uae_exact', market: 'uae', url: 'https://www.dubicars.com/2023-bmw-ix1-979972.html' },
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
  return decodeHtml(String(value ?? '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function visibleText(html) {
  return decodeHtml(String(html || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  const out = []; const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key); out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function titleOf(html) { return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300); }
function inlineScripts(html) {
  return [...String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1] || '', body: decodeHtml(m[2] || '') }))
    .filter((row) => row.body.trim()).slice(0, 120);
}
function imageUrls(text, baseUrl) {
  const out = [];
  for (const match of String(text || '').matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'`<>\\\s]*)?/gi)) out.push(safeUrl(match[0], baseUrl));
  for (const match of String(text || '').matchAll(/(?:src|data-src|data-original|content)\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) out.push(safeUrl(match[1], baseUrl));
  return unique(out.filter((url) => url && !/(?:logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code)/i.test(url)), 400);
}

export function galleryContainerEvidence(html, baseUrl) {
  const source = String(html || '');
  const rows = [];
  const tagRe = /<(?:div|ul|ol|section|figure)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:gallery|carousel|swiper|slider|photo|photos|images|image-list|image-gallery)[^"']*["'][^>]*>/gi;
  for (const match of source.matchAll(tagRe)) {
    const start = Math.max(0, match.index - 300);
    const end = Math.min(source.length, match.index + 12_000);
    const fragment = source.slice(start, end);
    const images = imageUrls(fragment, baseUrl);
    if (images.length < 2) continue;
    rows.push({
      openingTag: clean(match[0]).slice(0, 500),
      fragmentHashSha256: sha256(fragment),
      imageCount: images.length,
      imageSamples: images.slice(0, 35),
      textPrefix: clean(fragment).slice(0, 500),
    });
  }
  return unique(rows, 20);
}

export function imageTagEvidence(html, baseUrl) {
  const rows = [];
  for (const match of String(html || '').matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1] || '';
    const src = safeUrl(attrs.match(/(?:^|\s)(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/i)?.[1] || '', baseUrl);
    if (!src || /(?:logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code)/i.test(src)) continue;
    const alt = clean(attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '');
    const cls = clean(attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] || '');
    const id = clean(attrs.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1] || '');
    const start = Math.max(0, match.index - 700); const end = Math.min(String(html || '').length, match.index + match[0].length + 700);
    const context = clean(String(html || '').slice(start, end)).slice(0, 1000);
    rows.push({ src, alt: alt || null, class: cls || null, id: id || null, context });
  }
  return unique(rows, 100);
}

export function numberedImageClusters(urls) {
  const groups = new Map();
  for (const url of urls) {
    let parsed; try { parsed = new URL(url); } catch { continue; }
    const match = parsed.pathname.match(/^(.*?)(?:[_-])(\d{1,3})(\.(?:jpe?g|png|webp|avif))$/i);
    if (!match) continue;
    const key = `${parsed.origin}${match[1]}${match[3]}`;
    const row = groups.get(key) || { key, count: 0, numbers: [], samples: [] };
    row.count++; row.numbers.push(Number(match[2])); if (row.samples.length < 30) row.samples.push(url); groups.set(key, row);
  }
  return [...groups.values()].filter((row) => row.count >= 3).sort((a,b) => b.count - a.count).slice(0, 20);
}

export function visibleUnitEvidence(html) {
  const text = visibleText(html);
  const rows = [];
  const patterns = [
    /\b\d{1,5}(?:\.\d+)?\s*(?:cc|cm3|cm³|L|ℓ|liters?|litres?)\b/gi,
    /\b\d{1,5}(?:\.\d+)?\s*(?:HP|BHP|PS|kW)\b/gi,
    /\b\d{1,5}(?:\.\d+)?\s*마력\b/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const start = Math.max(0, match.index - 180), end = Math.min(text.length, match.index + match[0].length + 220);
      rows.push({ value: match[0], context: text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 550) });
    }
  }
  return unique(rows, 80);
}

export function visibleCurrencyEvidence(html) {
  const text = visibleText(html); const rows = [];
  for (const match of text.matchAll(/(?:AED|USD|KRW|₩|\$)\s*[\d,.]+|[\d,.]+\s*(?:AED|USD|KRW|₩|원|만원)/gi)) {
    const start = Math.max(0, match.index - 220), end = Math.min(text.length, match.index + match[0].length + 260);
    rows.push({ value: match[0], context: text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 650) });
  }
  return unique(rows, 80);
}

export function bodyTermEvidence(html) {
  const text = visibleText(html); const rows = [];
  const re = /\b(?:sedan|hatchback|suv|crossover|coupe|wagon|estate|convertible|pickup|pick-up|van|bus)\b|(?:세단|해치백|쿠페|왜건|컨버터블|승용차|승용|SUV|차종)/gi;
  for (const match of text.matchAll(re)) {
    const start = Math.max(0, match.index - 180), end = Math.min(text.length, match.index + match[0].length + 220);
    rows.push({ value: match[0], context: text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 550) });
  }
  return unique(rows, 80);
}

export function wideOfferContextEvidence(html, sourceOfferId, baseUrl) {
  if (!sourceOfferId) return [];
  const rows = [];
  for (const script of inlineScripts(html)) {
    let from = 0;
    for (let count = 0; count < 8; count++) {
      const index = script.body.indexOf(sourceOfferId, from); if (index < 0) break;
      const fragment = script.body.slice(Math.max(0, index - 60_000), Math.min(script.body.length, index + 90_000));
      const keyValues = [];
      const re = /["']([A-Za-z_$][A-Za-z0-9_$.-]{1,100})["']\s*:\s*(?:["']([^"']{1,700})["']|(-?\d+(?:\.\d+)?))/g;
      for (const m of fragment.matchAll(re)) {
        if (!/(?:price|amount|sale|offer|discount|engine|displacement|capacity|horse|power|rated|certified|continuous|body|vehicleType|fuel|highlight|image|photo|gallery)/i.test(m[1])) continue;
        keyValues.push({ key: m[1], value: m[2] ?? m[3] });
      }
      const imageList = imageUrls(fragment, baseUrl);
      rows.push({ occurrence: count + 1, fragmentHashSha256: sha256(fragment), keyValues: unique(keyValues, 180), imageCount: imageList.length, imageSamples: imageList.slice(0, 35) });
      from = index + sourceOfferId.length;
    }
  }
  return rows.slice(0, 12);
}

export function specialPhraseEvidence(html) {
  const text = decodeHtml(String(html || ''));
  const rows = [];
  const re = /(?:highlightName|engineSize|engineDisplacement|horsepower|horsePower|powerHp|enginePower|maxPower|maximumPower|ratedPower|certifiedPower|continuousPower|sellingPrice|salePrice|displayPrice|listingPrice|finalPrice|offerPrice|price)\s*["']?\s*[:=]\s*["']?([^,"'}\]\n]{1,180})/gi;
  for (const match of text.matchAll(re)) {
    rows.push({ expression: clean(match[0]).slice(0, 260), value: clean(match[1]).slice(0, 180) });
  }
  return unique(rows, 120);
}

const robotsCache = new Map();
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}
async function robotsFor(url) {
  const origin = new URL(url).origin; if (robotsCache.has(origin)) return robotsCache.get(origin);
  let result; try {
    const response = await fetchWithTimeout(`${origin}/robots.txt`, { headers: HEADERS, redirect: 'follow' });
    const text = (await response.text()).slice(0, 500_000); result = { status: response.status, text: response.ok ? text : '' };
  } catch (error) { result = { status: null, text: '', error: String(error?.message || error) }; }
  robotsCache.set(origin, result); return result;
}
async function getPage(url) {
  const robots = await robotsFor(url);
  const policy = robots.text ? evaluateRobots(robots.text, url, USER_AGENT) : { allowed: true, matchedRule: null };
  if (!policy.allowed) return { kind: 'robots_disallowed', url, robotsStatus: robots.status, matchedRule: policy.matchedRule };
  try {
    const response = await fetchWithTimeout(url, { headers: HEADERS, redirect: 'follow' });
    const bytes = Buffer.from(await response.arrayBuffer()); const body = bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
    const prefix = `${titleOf(body)} ${visibleText(body).slice(0, 20_000)}`;
    return { kind: CHALLENGE_RE.test(prefix) ? 'challenge' : LOGIN_RE.test(prefix) ? 'login_wall' : response.ok ? 'reachable' : 'http_error', finalUrl: response.url || url, status: response.status, bytes: bytes.length, truncated: bytes.length > MAX_BODY_BYTES, bodyHashSha256: sha256(bytes), body, robotsStatus: robots.status, matchedRule: policy.matchedRule };
  } catch (error) { return { kind: 'network_error', url, error: String(error?.message || error), robotsStatus: robots.status }; }
}

async function inspect(sample) {
  const page = await getPage(sample.url); const sourceOfferId = sourceOfferIdFromUrl(page.finalUrl || sample.url);
  if (!page.body) return { ...sample, sourceOfferId, page };
  const html = page.body; const baseUrl = page.finalUrl || sample.url; const allImages = imageUrls(html, baseUrl);
  return {
    sourceId: sample.sourceId, market: sample.market, requestedUrl: sample.url, sourceOfferId,
    page: { kind: page.kind, finalUrl: page.finalUrl, status: page.status, bytes: page.bytes, truncated: page.truncated, bodyHashSha256: page.bodyHashSha256, title: titleOf(html), robotsStatus: page.robotsStatus, matchedRule: page.matchedRule },
    galleryContainers: galleryContainerEvidence(html, baseUrl),
    imageTags: imageTagEvidence(html, baseUrl),
    numberedImageClusters: numberedImageClusters(allImages),
    visibleUnits: visibleUnitEvidence(html),
    visibleCurrency: visibleCurrencyEvidence(html),
    bodyTerms: bodyTermEvidence(html),
    wideOfferContexts: wideOfferContextEvidence(html, sourceOfferId, baseUrl),
    specialPhrases: specialPhraseEvidence(html),
    allImageCount: allImages.length,
    allImageSamples: allImages.slice(0, 50),
  };
}

async function runWithConcurrency(items, limit, worker) {
  const out = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; out[index] = await worker(items[index], index); }
  })); return out;
}

export async function runSpecialized() {
  const results = await runWithConcurrency(SAMPLES, 3, inspect);
  const payload = { version: 1, generatedAt: new Date().toISOString(), mode: 'targeted_source_gap_specialized_no_write', productionWrites: false, classificationMutations: false, publishAllowedMutations: false, rawBodiesStored: false, requestMethod: 'GET_only', challengeBypass: false, robotsBypass: false, sampleCount: SAMPLES.length, results };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ generatedAt: payload.generatedAt, sampleCount: payload.sampleCount, results: results.map((row) => ({ sourceId: row.sourceId, sourceOfferId: row.sourceOfferId, kind: row.page?.kind, galleryContainers: row.galleryContainers?.length || 0, numberedClusters: row.numberedImageClusters?.length || 0, visibleUnits: row.visibleUnits?.length || 0, visibleCurrency: row.visibleCurrency?.length || 0, bodyTerms: row.bodyTerms?.length || 0, wideContexts: row.wideOfferContexts?.length || 0, specialPhrases: row.specialPhrases?.length || 0 })) }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) runSpecialized().catch((error) => { console.error(error); process.exitCode = 1; });
