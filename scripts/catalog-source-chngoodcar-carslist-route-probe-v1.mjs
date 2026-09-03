import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.chngoodcar.com';
const LIST_URL = `${BASE_URL}/Home/CarsList`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_CARSLIST_ROUTE_OUTPUT || 'catalog-source-chngoodcar-carslist-route-probe-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CARSLIST_ROUTE_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(200000, Math.min(1800000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_CARSLIST_ROUTE_MAX_BODY_BYTES || 1300000)));
const USER_AGENT = 'AvtoCenaGoodCarCarsListRouteProbe/1.0 (+read-only route discovery)';
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/javascript,text/javascript;q=0.9,text/plain;q=0.8,*/*;q=0.5',
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
    .replace(/&#(\d+);/g, (token, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : token;
    });
}

function clean(value, limit = 1800) {
  return decodeHtml(String(value ?? ''))
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
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

function sameOrigin(url) {
  try { return new URL(url).origin === BASE_URL; } catch { return false; }
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

export function extractGoodCarScriptSources(html, pageUrl = LIST_URL) {
  return uniq([...String(html || '').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((m) => safeUrl(m[1], pageUrl))
    .filter(Boolean), 60);
}

export function extractGoodCarFormContracts(html, pageUrl = LIST_URL) {
  const forms = [];
  for (const match of String(html || '').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const actionRaw = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    const method = (attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] || 'GET').toUpperCase();
    const action = safeUrl(actionRaw || pageUrl, pageUrl);
    const inputs = [];
    for (const input of inner.matchAll(/<(?:input|select|textarea)\b([^>]*)>/gi)) {
      const raw = input[1] || '';
      const name = raw.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
      const type = raw.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || null;
      const value = raw.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || null;
      if (name) inputs.push({ name, type, value: value ? clean(value, 120) : null });
    }
    forms.push({ action, method, inputs: uniq(inputs, 80) });
  }
  return uniq(forms, 20);
}

function quotedStrings(code) {
  const out = [];
  for (const match of String(code || '').matchAll(/(["'`])([^\n\r]{1,500}?)\1/g)) out.push(match[2]);
  return out;
}

export function extractGoodCarRouteCandidates(code, baseUrl = LIST_URL) {
  const candidates = [];
  for (const raw of quotedStrings(code)) {
    const value = decodeHtml(raw).replace(/\\\//g, '/').trim();
    if (!value || (!/[\/]Home\//i.test(value) && !/(?:Cars|Vehicle|Auto|List|Search|Page|Ajax|Get)/i.test(value))) continue;
    const url = safeUrl(value, baseUrl);
    if (!url || !sameOrigin(url)) continue;
    candidates.push(url);
  }
  return uniq(candidates, 120);
}

export function extractGoodCarPaginationEvidence(code) {
  const text = String(code || '');
  const names = uniq([...text.matchAll(/\b(pageIndex|pageindex|PageIndex|pageNo|pageno|PageNo|pageNum|pagenum|PageNum|page|Page|current|Current|limit|Limit|rows|Rows|pageSize|pagesize|PageSize)\b/g)].map((m) => m[1]), 40);
  const markers = [];
  const re = /ajax|\$\.get|\$\.post|fetch\s*\(|CarsList|pagination|laypage|pageIndex|PageIndex|pageSize|PageSize|currentPage|totalPage/gi;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    markers.push(clean(text.slice(Math.max(0, idx - 260), Math.min(text.length, idx + 620)), 900));
    if (markers.length >= 30) break;
  }
  return { parameterNames: names, snippets: uniq(markers, 30) };
}

function inlineScripts(html) {
  return [...String(html || '').matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] || '');
}

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
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
    const response = await fetchTimed(`${BASE_URL}/robots.txt`, { headers: HEADERS, redirect: 'manual' });
    const text = response.ok ? (await readLimited(response)).body : '';
    robotsCache = { status: response.status, text };
  } catch (error) {
    robotsCache = { status: null, text: '', error: String(error?.message || error) };
  }
  return robotsCache;
}

async function fetchAllowed(url, referer = LIST_URL) {
  const rob = await robots();
  const policy = evaluateRobots(rob.text, url, USER_AGENT);
  if (!policy.allowed) return { kind: 'robots_disallowed', robotsStatus: rob.status, matchedRule: policy.matchedRule };
  try {
    const response = await fetchTimed(url, { headers: { ...HEADERS, referer }, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) return { kind: 'redirect_not_followed', status: response.status, location: response.headers.get('location'), robotsStatus: rob.status };
    const { body, truncated } = await readLimited(response);
    return {
      kind: response.ok ? 'reachable' : 'http_error',
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      truncated,
      body,
      bodyHashSha256: crypto.createHash('sha256').update(body).digest('hex'),
      robotsStatus: rob.status,
    };
  } catch (error) {
    return { kind: 'network_error', error: String(error?.message || error), robotsStatus: rob.status };
  }
}

function summarizeCode(code, baseUrl) {
  const routes = extractGoodCarRouteCandidates(code, baseUrl);
  const pagination = extractGoodCarPaginationEvidence(code);
  return { routes, pagination };
}

export async function runGoodCarCarsListRouteProbe() {
  const listRaw = await fetchAllowed(LIST_URL, BASE_URL);
  if (!listRaw.body) throw new Error(`carslist_unreadable:${listRaw.kind}:${listRaw.status ?? 'none'}`);

  const scriptSources = extractGoodCarScriptSources(listRaw.body, LIST_URL);
  const forms = extractGoodCarFormContracts(listRaw.body, LIST_URL);
  const inline = inlineScripts(listRaw.body).map((code, index) => ({ index, ...summarizeCode(code, LIST_URL) }));
  const external = [];

  for (const scriptUrl of scriptSources.filter(sameOrigin).slice(0, 24)) {
    const raw = await fetchAllowed(scriptUrl, LIST_URL);
    if (!raw.body) {
      external.push({ scriptUrl, kind: raw.kind, status: raw.status ?? null, error: raw.error || null });
      continue;
    }
    external.push({
      scriptUrl,
      kind: raw.kind,
      status: raw.status,
      contentType: raw.contentType,
      truncated: raw.truncated,
      bodyHashSha256: raw.bodyHashSha256,
      byteLength: Buffer.byteLength(raw.body),
      ...summarizeCode(raw.body, scriptUrl),
    });
  }

  const routeCandidates = uniq([
    ...inline.flatMap((x) => x.routes),
    ...external.flatMap((x) => x.routes || []),
    ...forms.map((x) => x.action).filter(Boolean),
  ].filter((url) => url && sameOrigin(url)), 160);

  const paginationParameterNames = uniq([
    ...inline.flatMap((x) => x.pagination.parameterNames),
    ...external.flatMap((x) => x.pagination?.parameterNames || []),
    ...forms.flatMap((x) => x.inputs.map((i) => i.name)),
  ], 100);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_carslist_declared_route_discovery_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    listUrl: LIST_URL,
    listFetch: {
      kind: listRaw.kind,
      status: listRaw.status,
      contentType: listRaw.contentType,
      truncated: listRaw.truncated,
      bodyHashSha256: listRaw.bodyHashSha256,
      byteLength: Buffer.byteLength(listRaw.body),
      explicitUsdLabel: /价格\s*\(\s*US\s*\$\s*\)/i.test(clean(listRaw.body)),
      directDetailLinks: [...listRaw.body.matchAll(/\/Home\/Cars\?id=(\d+)/gi)].map((m) => m[1]).length,
    },
    forms,
    scriptSources,
    inlineScripts: inline,
    externalScripts: external,
    routeCandidates,
    paginationParameterNames,
    next: 'Only follow routes/methods/parameters explicitly evidenced by this artifact. Do not guess page query names or API endpoints.',
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    listStatus: payload.listFetch.status,
    listBytes: payload.listFetch.byteLength,
    scriptSources: payload.scriptSources.length,
    sameOriginScriptsAudited: payload.externalScripts.length,
    formCount: payload.forms.length,
    routeCandidates: payload.routeCandidates,
    paginationParameterNames: payload.paginationParameterNames,
  }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runGoodCarCarsListRouteProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
