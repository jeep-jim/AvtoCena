import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_ACCESS_PROBE_OUTPUT || 'catalog-source-access-probe-v1.json';
const TIMEOUT_MS = Math.max(3_000, Math.min(45_000, Number(process.env.CATALOG_SOURCE_ACCESS_PROBE_TIMEOUT_MS || 15_000)));
const MAX_BODY_BYTES = Math.max(100_000, Math.min(2_000_000, Number(process.env.CATALOG_SOURCE_ACCESS_PROBE_MAX_BODY_BYTES || 1_000_000)));
const MAX_DETAIL_SAMPLES = Math.max(0, Math.min(2, Number(process.env.CATALOG_SOURCE_ACCESS_PROBE_DETAIL_SAMPLES || 1)));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CATALOG_SOURCE_ACCESS_PROBE_CONCURRENCY || 4)));
const USER_AGENT = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';

const BASE_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.7,ko;q=0.6,zh-CN;q=0.6,ja;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

const CHALLENGE_RE = /captcha|cloudflare|verify (?:that )?you are human|access denied|request blocked|robot check|security check|incapsula|imperva|edgeone|cf-chl|challenge-platform/i;
const CHALLENGE_TITLE_RE = /just a moment|access denied|zugriff verweigert|pardon our interruption|verify (?:that )?you are human|request blocked|robot check|security check/i;
const LOGIN_URL_RE = /(?:\/|^)(?:login(?:-required)?|log-in|signin|sign-in|member\/login|auth\/login)(?:\/|\?|$)/i;
const LOGIN_TITLE_RE = /^(?:login|log in|sign in|member login|로그인|登录|ログイン)(?:\b|\s|[-|])/i;
const LOGIN_WALL_RE = /(?:login required|sign in to continue|please (?:log in|login|sign in)|authentication required|members? only|must be logged in|로그인이 필요|로그인 후|请登录|登录后|ログインしてください|会員ログイン)/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const CURRENCY_RE = /(?:AED|د\.\s*إ|د\.إ|EUR|€|GEL|₾|KRW|₩|원|JPY|円|万円|CNY|RMB|人民币|万元|元|USD|US\$|\$|£|GBP)/i;
const PRICE_RE = /(?:price|asking price|sale price|vehicle price|цена|가격|판매가|价格|售价|価格|本体価格|prix|preis|ფასი|AED|EUR|GEL|KRW|JPY|CNY|RMB|₩|€|₾|円|万元)/i;
const MILEAGE_RE = /(?:mileage|odometer|kilomet(?:er|re)s?|\bkm\b|пробег|주행거리|公里|里程|走行距離|kilométrage|kilometerstand|გარბენი)/i;
const FUEL_RE = /(?:fuel|petrol|gasoline|diesel|hybrid|electric|phev|hev|ev\b|бензин|дизел|гибрид|электро|연료|휘발유|가솔린|경유|디젤|하이브리드|전기|汽油|柴油|混合动力|混动|电动|新能源|燃料|ガソリン|ディーゼル|ハイブリッド|電気|essence|carburant|kraftstoff|საწვავი)/i;
const ENGINE_RE = /(?:engine|displacement|engine size|cubic capacity|\bcc\b|cm³|cm3|объ[её]м|двигател|배기량|엔진|排量|发动机|排気量|エンジン|cylindr(?:ée|ee)|hubraum|ძრავ)/i;
const POWER_RE = /(?:power|horsepower|\bhp\b|\bps\b|\bkw\b|л\.?\s*с\.?|мощност|마력|출력|功率|马力|馬力|puissance|leistung|სიმძლავრ)/i;
const BODY_RE = /(?:body type|body style|sedan|saloon|suv|crossover|hatchback|wagon|estate|coupe|convertible|cabriolet|minivan|van|pickup|truck|limousine|кузов|седан|хэтчбек|универсал|кроссовер|внедорож|미니밴|세단|해치백|왜건|쿠페|차종|轿车|SUV|两厢|三厢|旅行车|跑车|ボディ|セダン|ハッチバック|ワゴン|クーペ|carrosserie|karosserie|ძარის)/i;
const DETAIL_EXCLUDE_RE = /(?:login|signin|register|privacy|terms|cookie|contact|about|news|blog|faq|search(?:[\/?#]|$)|filter|sort|compare|favorite|wishlist|javascript:|mailto:|tel:)/i;

function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseRobots(text) {
  const groups = [];
  let currentAgents = [];
  let currentRules = [];
  let sawRule = false;

  const flush = () => {
    if (currentAgents.length) groups.push({ agents: [...currentAgents], rules: [...currentRules] });
    currentAgents = [];
    currentRules = [];
    sawRule = false;
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (sawRule) flush();
      currentAgents.push(value.toLowerCase());
      continue;
    }
    if (key !== 'allow' && key !== 'disallow') continue;
    if (!currentAgents.length) continue;
    sawRule = true;
    if (key === 'disallow' && value === '') continue;
    if (!value) continue;
    currentRules.push({ type: key, pattern: value });
  }
  flush();
  return groups;
}

function agentSpecificity(agent, userAgent) {
  if (agent === '*') return 1;
  const token = agent.trim().toLowerCase();
  if (!token) return 0;
  return userAgent.toLowerCase().includes(token) ? token.length + 1 : 0;
}

function robotsPatternMatch(pattern, path) {
  const anchored = pattern.endsWith('$');
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const parts = raw.split('*').map(escapeRegExp);
  const re = new RegExp(`^${parts.join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}

export function evaluateRobots(text, targetUrl, userAgent = USER_AGENT) {
  const groups = parseRobots(text);
  const url = new URL(targetUrl);
  const path = `${url.pathname || '/'}${url.search || ''}`;
  const scored = groups.map((group) => ({
    group,
    specificity: Math.max(0, ...group.agents.map((agent) => agentSpecificity(agent, userAgent))),
  })).filter((row) => row.specificity > 0);
  if (!scored.length) return { allowed: true, matchedRule: null, applicableGroupCount: 0 };
  const bestSpecificity = Math.max(...scored.map((row) => row.specificity));
  const applicable = scored.filter((row) => row.specificity === bestSpecificity).map((row) => row.group);
  const matches = applicable.flatMap((group) => group.rules)
    .filter((rule) => robotsPatternMatch(rule.pattern, path))
    .sort((a, b) => b.pattern.length - a.pattern.length || (a.type === 'allow' ? -1 : 1));
  const matchedRule = matches[0] || null;
  return {
    allowed: !matchedRule || matchedRule.type === 'allow',
    matchedRule,
    applicableGroupCount: applicable.length,
  };
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'), base);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function identityScore(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  const path = parsed.pathname;
  const key = `${path}${parsed.search}`;
  if (/career|jobs?|imglist|image-list|counts?|allmakeslist|sitemap|search|filter|sort|compare|favorite|wishlist|budget|under[-_]|over[-_]|between[-_]|price[-_]|hotrank|community|(?:^|\/)(?:series|library-brand|topic|article|cms)(?:\/|[-_]|$)|(?:^|\/)models?(?:\/|$)|(?:^|\/)makes?(?:\/|$)|(?:^|\/)brands?(?:\/|$)/i.test(key)) return 0;
  let score = 0;
  for (const [name, value] of parsed.searchParams) {
    if (/^(?:id|no|stock|stockid|stock_id|offer|offerid|listing|listingid|vehicle|vehicleid|car|carid|car_id|ad|adid|lot|lotid)$/i.test(name) && /^[A-Za-z0-9_-]{3,}$/.test(value)) score = Math.max(score, 8);
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(path)) score = Math.max(score, 8);
  if (/\d{5,}(?:\.html?)?\/?$/i.test(path)) score = Math.max(score, 6);
  return score;
}

export function extractCatalogCandidates(html, baseUrl, limit = 3) {
  if (limit <= 0) return [];
  const base = new URL(baseUrl);
  const candidates = new Map();
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin) continue;
    const key = `${parsed.pathname}${parsed.search}`;
    if (key === `${base.pathname}${base.search}` || key === '/') continue;
    if (DETAIL_EXCLUDE_RE.test(key)) continue;
    if (identityScore(parsed) > 0) continue;
    let score = 0;
    if (/(?:^|\/)(?:buy-used-cars|used(?:-cars?|_cars?)?|preowned|pre-owned|inventory|stocklist|stock-list|search|lst|list|listings?|vehicles?|cars)(?:\/|[-_?=&]|$)/i.test(key)) score += 7;
    if (/(?:^|\/)(?:auction|auctions|past|stat|stats|estimates-data|allmakeslist)(?:\/|[-_?=&]|$)/i.test(key)) score += 5;
    if (/\bused\b|second[-_ ]?hand|pre[-_ ]?owned/i.test(key)) score += 2;
    if (/career|jobs?|dealer|shop|sell|finance|insurance|loan|servic|review|news|blog|about|contact|privacy|terms|compare|new-cars?|community|fans|magazine|tutorial|hotrank|imglist|gallery|photo/i.test(key)) score -= 10;
    if (score < 5) continue;
    const previous = candidates.get(url);
    if (!previous || previous.score < score) candidates.set(url, { url, score });
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit)
    .map((row) => row.url);
}

export function extractDetailCandidates(html, baseUrl, limit = MAX_DETAIL_SAMPLES) {
  if (limit <= 0) return [];
  const base = new URL(baseUrl);
  const candidates = new Map();
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin) continue;
    const key = `${parsed.pathname}${parsed.search}`;
    if (key === `${base.pathname}${base.search}` || key === '/') continue;
    if (DETAIL_EXCLUDE_RE.test(key)) continue;
    const identity = identityScore(parsed);
    if (identity <= 0) continue;
    let score = identity;
    if (/(?:^|\/)(?:detail|vehicle|vehicles|usedcar|used-car|used_cars?|car|cars|stock|listing|offer|offers|auction|auto|motors)(?:\/|[-_?=&]|$)/i.test(key)) score += 4;
    if (/\.(?:html?|aspx?|php)(?:$|\?)/i.test(key)) score += 1;
    const previous = candidates.get(url);
    if (!previous || previous.score < score) candidates.set(url, { url, score });
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit)
    .map((row) => row.url);
}

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 240);
}

function imageCount(html, baseUrl) {
  const values = [];
  for (const match of String(html || '').matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const value of match[1].split(',').map((part) => part.trim().split(/\s+/)[0])) values.push(absoluteUrl(value, baseUrl));
  }
  for (const match of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["']/gi)) {
    values.push(absoluteUrl(match[1], baseUrl));
  }
  return new Set(values.filter((url) => url && !/favicon|logo|icon|sprite|pixel|avatar|placeholder/i.test(url))).size;
}

function jsonLdSummary(html) {
  const types = new Set();
  const keys = new Set();
  let parsedCount = 0;
  for (const match of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (parsedCount >= 12) break;
    try {
      const value = JSON.parse(match[1].trim());
      parsedCount++;
      const nodes = Array.isArray(value) ? value : value?.['@graph'] && Array.isArray(value['@graph']) ? value['@graph'] : [value];
      for (const node of nodes.slice(0, 20)) {
        if (!node || typeof node !== 'object') continue;
        Object.keys(node).slice(0, 40).forEach((key) => keys.add(key));
        const rawType = node['@type'];
        const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
        typeList.forEach((type) => types.add(String(type)));
      }
    } catch {
      // Invalid JSON-LD is only a signal; it must not fail the access probe.
    }
  }
  return { parsedCount, types: [...types].slice(0, 30), keys: [...keys].slice(0, 50) };
}

export function summarizeBody(html, baseUrl) {
  const raw = String(html || '');
  const text = clean(raw).slice(0, 750_000);
  const jsonLd = jsonLdSummary(raw);
  const title = titleOf(raw);
  const bodyBytes = Buffer.byteLength(raw);
  return {
    title,
    markers: {
      year: YEAR_RE.test(text),
      price: PRICE_RE.test(text),
      currency: CURRENCY_RE.test(text),
      mileage: MILEAGE_RE.test(text),
      fuel: FUEL_RE.test(text),
      engine: ENGINE_RE.test(text),
      power: POWER_RE.test(text),
      body: BODY_RE.test(text),
    },
    imageCount: imageCount(raw, baseUrl),
    jsonLd,
    challenge: CHALLENGE_TITLE_RE.test(title) || (bodyBytes < 120_000 && CHALLENGE_RE.test(text.slice(0, 80_000))),
    loginWall: LOGIN_TITLE_RE.test(title) || (bodyBytes < 80_000 && LOGIN_WALL_RE.test(text.slice(0, 80_000))),
  };
}

async function readBodyLimited(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body) return { text: '', capturedBytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let captured = 0;
  let truncated = false;
  try {
    while (captured < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - captured;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        captured += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      captured += value.byteLength;
    }
    if (captured >= maxBytes) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString('utf8'), capturedBytes: buffer.length, truncated };
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const robotsCache = new Map();

async function getRobots(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const promise = (async () => {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await fetchWithTimeout(robotsUrl, { redirect: 'follow', headers: { accept: 'text/plain,*/*;q=0.5' } });
      const body = await readBodyLimited(response, 300_000);
      const contentType = response.headers.get('content-type') || '';
      let status = 'available';
      if (response.status === 404 || response.status === 410) status = 'not_found';
      else if (response.status === 401 || response.status === 403) status = 'denied';
      else if (!response.ok) status = 'http_error';
      else if (CHALLENGE_RE.test(body.text.slice(0, 50_000))) status = 'challenge';
      return {
        robotsUrl,
        finalUrl: response.url || robotsUrl,
        httpStatus: response.status,
        contentType,
        status,
        text: status === 'available' ? body.text : '',
        hashSha256: body.text ? crypto.createHash('sha256').update(body.text).digest('hex') : null,
      };
    } catch (error) {
      return { robotsUrl, finalUrl: robotsUrl, httpStatus: null, contentType: '', status: 'network_error', text: '', error: String(error?.message || error) };
    }
  })();
  robotsCache.set(origin, promise);
  return promise;
}

async function robotsDecision(url) {
  const robots = await getRobots(url);
  if (robots.status !== 'available') {
    return {
      robots: { ...robots, text: undefined },
      allowed: true,
      policy: robots.status === 'not_found' ? 'no_robots_file' : 'unknown_no_explicit_disallow',
      matchedRule: null,
    };
  }
  const evaluation = evaluateRobots(robots.text, url, USER_AGENT);
  return {
    robots: { ...robots, text: undefined },
    allowed: evaluation.allowed,
    policy: evaluation.allowed ? 'allowed_by_robots' : 'explicitly_disallowed_by_robots',
    matchedRule: evaluation.matchedRule,
  };
}

async function fetchPageRespectingRobots(initialUrl) {
  let currentUrl = initialUrl;
  const redirectChain = [];
  for (let hop = 0; hop <= 5; hop++) {
    const decision = await robotsDecision(currentUrl);
    if (!decision.allowed) {
      return { kind: 'robots_disallowed', requestUrl: initialUrl, finalUrl: currentUrl, redirectChain, robotsDecision: decision };
    }
    let response;
    try {
      response = await fetchWithTimeout(currentUrl, { redirect: 'manual' });
    } catch (error) {
      return { kind: 'network_error', requestUrl: initialUrl, finalUrl: currentUrl, redirectChain, robotsDecision: decision, error: String(error?.message || error) };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop === 5) return { kind: 'too_many_redirects', requestUrl: initialUrl, finalUrl: currentUrl, redirectChain, robotsDecision: decision, httpStatus: response.status };
      const nextUrl = absoluteUrl(response.headers.get('location'), currentUrl);
      if (!nextUrl) return { kind: 'bad_redirect', requestUrl: initialUrl, finalUrl: currentUrl, redirectChain, robotsDecision: decision, httpStatus: response.status };
      redirectChain.push({ from: currentUrl, status: response.status, to: nextUrl });
      currentUrl = nextUrl;
      continue;
    }
    const body = await readBodyLimited(response);
    const contentType = response.headers.get('content-type') || '';
    const summary = /html|xhtml/i.test(contentType) || /^\s*</.test(body.text) ? summarizeBody(body.text, currentUrl) : null;
    return {
      kind: 'response',
      requestUrl: initialUrl,
      finalUrl: currentUrl,
      redirectChain,
      robotsDecision: decision,
      httpStatus: response.status,
      ok: response.ok,
      contentType,
      capturedBytes: body.capturedBytes,
      truncated: body.truncated,
      bodyHashSha256: crypto.createHash('sha256').update(body.text).digest('hex'),
      body: body.text,
      summary,
    };
  }
  return { kind: 'too_many_redirects', requestUrl: initialUrl, finalUrl: currentUrl, redirectChain };
}

function publicPageSnapshot(page) {
  if (!page) return null;
  return {
    kind: page.kind,
    requestUrl: page.requestUrl,
    finalUrl: page.finalUrl,
    redirectChain: page.redirectChain,
    robotsDecision: page.robotsDecision,
    httpStatus: page.httpStatus ?? null,
    ok: page.ok ?? false,
    contentType: page.contentType || '',
    capturedBytes: page.capturedBytes ?? 0,
    truncated: page.truncated ?? false,
    bodyHashSha256: page.bodyHashSha256 || null,
    summary: page.summary || null,
    error: page.error,
  };
}

function accessStatus(listPage, detailPages) {
  if (!listPage) return 'network_error';
  if (listPage.kind === 'robots_disallowed') return 'robots_disallowed';
  if (listPage.kind === 'network_error') return 'network_error';
  if (listPage.kind !== 'response') return listPage.kind;
  if (listPage.summary?.challenge) return 'challenge';
  if (listPage.summary?.loginWall || LOGIN_URL_RE.test(new URL(listPage.finalUrl || listPage.requestUrl).pathname)) return 'login_wall';
  if (!listPage.ok) return 'http_error';
  if (!listPage.summary) return 'non_html';
  if (detailPages.some((page) => page?.kind === 'response' && page.ok && page.summary && !page.summary.challenge && !page.summary.loginWall && !LOGIN_URL_RE.test(new URL(page.finalUrl || page.requestUrl).pathname))) return 'reachable_detail_sample';
  return 'reachable_no_detail';
}

async function probeCandidate(candidate) {
  const entryPage = await fetchPageRespectingRobots(candidate.url);
  let listPage = entryPage;
  let listSource = 'entry';
  let catalogCandidates = [];

  if (entryPage.kind === 'response' && entryPage.ok && entryPage.summary && !entryPage.summary.challenge && !entryPage.summary.loginWall) {
    const entryUrl = new URL(entryPage.finalUrl || candidate.url);
    catalogCandidates = extractCatalogCandidates(entryPage.body, entryPage.finalUrl, 5);
    if ((entryUrl.pathname === '/' || entryUrl.pathname === '') && catalogCandidates.length) {
      listPage = await fetchPageRespectingRobots(catalogCandidates[0]);
      listSource = 'discovered_catalog_route';
    }
  }

  const detailPages = [];
  let detailCandidates = [];
  if (listPage.kind === 'response' && listPage.ok && listPage.summary && !listPage.summary.challenge && !listPage.summary.loginWall) {
    detailCandidates = extractDetailCandidates(listPage.body, listPage.finalUrl, Math.max(MAX_DETAIL_SAMPLES, 5));
    for (const detailUrl of detailCandidates.slice(0, MAX_DETAIL_SAMPLES)) {
      detailPages.push(await fetchPageRespectingRobots(detailUrl));
    }
  }
  return {
    market: candidate.market,
    sourceId: candidate.sourceId,
    label: candidate.label,
    candidateUrl: candidate.url,
    classBefore: candidate.class,
    publishAllowedBefore: candidate.publishAllowed,
    accessStatus: accessStatus(listPage, detailPages),
    entry: publicPageSnapshot(entryPage),
    listSource,
    catalogCandidates,
    list: publicPageSnapshot(listPage),
    detailCandidates,
    details: detailPages.map(publicPageSnapshot),
    classificationMutation: false,
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        const candidate = items[index];
        results[index] = {
          market: candidate.market,
          sourceId: candidate.sourceId,
          label: candidate.label,
          candidateUrl: candidate.url,
          classBefore: candidate.class,
          publishAllowedBefore: candidate.publishAllowed,
          accessStatus: 'probe_error',
          entry: null,
          listSource: 'entry',
          catalogCandidates: [],
          list: null,
          detailCandidates: [],
          details: [],
          classificationMutation: false,
          error: String(error?.stack || error?.message || error),
        };
      }
    }
  }));
  return results;
}

export async function runProbe() {
  const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
  if (registry.productionWrites !== false) throw new Error('qualification_registry_must_be_no_write');
  if (!Array.isArray(registry.candidates) || !registry.candidates.length) throw new Error('qualification_registry_candidates_missing');
  if (registry.candidates.some((candidate) => candidate.publishAllowed !== false)) throw new Error('qualification_probe_refuses_publish_allowed_candidate');

  const results = await runWithConcurrency(registry.candidates, CONCURRENCY, probeCandidate);
  const counts = {};
  for (const row of results) counts[row.accessStatus] = (counts[row.accessStatus] || 0) + 1;
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'six_market_source_access_detail_probe_no_write',
    registryPath: REGISTRY_PATH,
    registryVersion: registry.version,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    candidateCount: registry.candidates.length,
    markets: registry.markets,
    settings: {
      timeoutMs: TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      maxDetailSamples: MAX_DETAIL_SAMPLES,
      concurrency: CONCURRENCY,
      robotsPolicy: 'respect explicit Disallow; unavailable robots never count as permission proof',
      rawBodiesStored: false,
    },
    counts,
    results,
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ generatedAt: payload.generatedAt, candidateCount: payload.candidateCount, counts: payload.counts, output: OUTPUT_PATH }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runProbe().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
