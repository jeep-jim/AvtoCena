import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const BASE_URL = 'https://www.chngoodcar.com';
const LIST_URL = `${BASE_URL}/Home/CarsList`;
const SEARCH_URL = `${BASE_URL}/Car/SearchCarList`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_PAGE_PROBE_OUTPUT || 'catalog-source-chngoodcar-carslist-page-probe-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_PAGE_PROBE_TIMEOUT_MS || 15000)));
const USER_AGENT = 'AvtoCenaGoodCarCarsListPageProbe/1.0 (+read-only public search pagination)';
const BASE_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json,text/javascript;q=0.9,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

function sha(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function extractVerificationToken(html) {
  for (const match of String(html || '').matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\bname\s*=\s*["']__RequestVerificationToken["']/i.test(tag)) continue;
    return tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1] || '';
  }
  return '';
}

function cookieHeader(response) {
  const headers = response.headers;
  const rows = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const source = rows.length ? rows : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  const pairs = [];
  for (const row of source) {
    if (!row) continue;
    const pair = String(row).split(';', 1)[0].trim();
    if (pair && pair.includes('=')) pairs.push(pair);
  }
  return [...new Set(pairs)].join('; ');
}

export function defaultGoodCarSearchBody(pageindex) {
  // Source-declared no-filter call:
  // pager(false, 1, 0, 0, 0, [], [], [], [], [], [], [], [], [], [], [], r_page)
  // jQuery omits empty arrays from application/x-www-form-urlencoded serialization.
  const body = new URLSearchParams();
  body.set('Hot', 'false');
  body.set('DefaultSort', '1');
  body.set('PriceSort', '0');
  body.set('MileageSort', '0');
  body.set('YearSort', '0');
  body.set('pageindex', String(pageindex));
  body.set('pagesize', '15');
  return body.toString();
}

function rowId(row) {
  const value = row?.Id ?? row?.id ?? row?.ID;
  return value == null ? '' : String(value).trim();
}

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function summarizeRow(row) {
  const keys = Object.keys(row || {}).sort();
  const interesting = {};
  const preferred = [
    'Id','id','Name','Title','CarName','ModelName','BrandName','Price','Year','Mileage','MileageKm',
    'FactoryTime','ProductionDate','Fuel','Gearbox','Shape','VehicleType','EngineModel','Img','Image','ImageUrl',
  ];
  for (const key of preferred) {
    if (!(key in (row || {}))) continue;
    const value = scalar(row[key]);
    if (value != null) interesting[key] = typeof value === 'string' ? value.slice(0, 240) : value;
  }
  return { id: rowId(row), keys, fields: interesting };
}

export function summarizeGoodCarSearchPayload(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const total = Number(payload?.total);
  return {
    total: Number.isFinite(total) && total >= 0 ? total : null,
    rowCount: rows.length,
    rowIds: rows.map(rowId).filter(Boolean),
    rows: rows.slice(0, 15).map(summarizeRow),
  };
}

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function robotsAllowed(url) {
  const robotsUrl = `${new URL(url).origin}/robots.txt`;
  try {
    const response = await fetchTimed(robotsUrl, { headers: BASE_HEADERS, redirect: 'manual' });
    const text = response.ok ? await response.text() : '';
    return { status: response.status, ...evaluateRobots(text, url, USER_AGENT) };
  } catch (error) {
    return { status: null, allowed: true, matchedRule: null, error: String(error?.message || error) };
  }
}

async function bootstrapSession() {
  const policy = await robotsAllowed(LIST_URL);
  if (!policy.allowed) throw new Error(`carslist_robots_disallowed:${policy.matchedRule || 'unknown'}`);
  const response = await fetchTimed(LIST_URL, { headers: BASE_HEADERS, redirect: 'manual' });
  const html = await response.text();
  if (!response.ok) throw new Error(`carslist_http_${response.status}`);
  const token = extractVerificationToken(html);
  const cookie = cookieHeader(response);
  if (!token) throw new Error('carslist_verification_token_missing');
  return {
    token,
    cookie,
    listStatus: response.status,
    listBodyHashSha256: sha(html),
    tokenLength: token.length,
    cookiePresent: Boolean(cookie),
    cookieNameCount: cookie ? cookie.split(';').length : 0,
  };
}

async function postSearch(session, pageindex) {
  const policy = await robotsAllowed(SEARCH_URL);
  if (!policy.allowed) throw new Error(`search_robots_disallowed:${policy.matchedRule || 'unknown'}`);
  const body = defaultGoodCarSearchBody(pageindex);
  const response = await fetchTimed(SEARCH_URL, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      '__RequestVerificationToken': session.token,
      origin: BASE_URL,
      referer: LIST_URL,
      ...(session.cookie ? { cookie: session.cookie } : {}),
    },
    body,
    redirect: 'manual',
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  return {
    pageindex,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    responseBodyHashSha256: sha(text),
    responseByteLength: Buffer.byteLength(text),
    requestBodyHashSha256: sha(body),
    jsonParsed: Boolean(payload && typeof payload === 'object'),
    summary: payload ? summarizeGoodCarSearchPayload(payload) : null,
  };
}

export function pageIdentityDisjoint(first, second) {
  const a = new Set(first?.summary?.rowIds || []);
  const b = new Set(second?.summary?.rowIds || []);
  if (!a.size || !b.size) return false;
  return [...a].every((id) => !b.has(id));
}

export async function runGoodCarCarsListPageProbe() {
  const session = await bootstrapSession();
  const page1a = await postSearch(session, 1);
  const page2 = await postSearch(session, 2);
  const page1b = await postSearch(session, 1);
  const totalStable = page1a.summary?.total != null && page1a.summary.total === page2.summary?.total && page1a.summary.total === page1b.summary?.total;
  const page1Stable = page1a.summary?.rowIds?.length > 0 && JSON.stringify(page1a.summary.rowIds) === JSON.stringify(page1b.summary?.rowIds || []);
  const differentPages = pageIdentityDisjoint(page1a, page2);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_carslist_public_search_page_probe_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    analyticsWrites: false,
    rawBodiesStored: false,
    tokensStored: false,
    cookiesStored: false,
    guessedRoutes: false,
    searchEndpoint: SEARCH_URL,
    sourceDeclaredMethod: 'POST',
    sourceDeclaredPageSize: 15,
    sourceDeclaredDefaultCall: {
      Hot: false,
      DefaultSort: 1,
      PriceSort: 0,
      MileageSort: 0,
      YearSort: 0,
      filters: 'empty_arrays_omitted_by_jquery_param',
    },
    session: {
      listStatus: session.listStatus,
      listBodyHashSha256: session.listBodyHashSha256,
      verificationTokenPresent: session.tokenLength > 0,
      verificationTokenLength: session.tokenLength,
      cookiePresent: session.cookiePresent,
      cookieNameCount: session.cookieNameCount,
    },
    page1a,
    page2,
    page1b,
    checks: {
      allHttp200: [page1a,page2,page1b].every((x) => x.status === 200),
      allJson: [page1a,page2,page1b].every((x) => x.jsonParsed),
      page1HasRows: (page1a.summary?.rowCount || 0) > 0,
      page2HasRows: (page2.summary?.rowCount || 0) > 0,
      totalStable,
      page1Stable,
      page1Page2Disjoint: differentPages,
    },
  };
  payload.failures = Object.entries(payload.checks).filter(([, ok]) => ok !== true).map(([key]) => key);
  payload.next = payload.failures.length
    ? 'Do not integrate pagination into adapter; inspect only this no-write evidence and repair the browser-contract reproduction.'
    : 'Pagination pages 1/2 are proven stable; integrate this exact search contract into the research adapter and run a bounded multi-page no-write scale test.';
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    session: payload.session,
    page1: { status: page1a.status, total: page1a.summary?.total, rows: page1a.summary?.rowCount, ids: page1a.summary?.rowIds },
    page2: { status: page2.status, total: page2.summary?.total, rows: page2.summary?.rowCount, ids: page2.summary?.rowIds },
    repeatPage1: { status: page1b.status, total: page1b.summary?.total, rows: page1b.summary?.rowCount },
    checks: payload.checks,
    failures: payload.failures,
  }, null, 2));
  if (payload.failures.length) throw new Error(`chngoodcar_page_probe_failed:${payload.failures.join(',')}`);
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runGoodCarCarsListPageProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
