import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-kcar-access-policy-probe-v1.json';
const SOURCE_ID = 'kcar_korea_open';
const HOME_URL = 'https://www.kcar.com/';
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1_800_000;

const headers = {
  'user-agent': UA,
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6',
  'cache-control': 'no-cache',
};

async function readLimited(response, maxBytes = MAX_BYTES) {
  if (!response.body) return { text: '', bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    if (bytes >= maxBytes) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString('utf8'), bytes: buffer.length, truncated };
}

async function get(url, accept, maxBytes = MAX_BYTES) {
  const response = await fetch(url, {
    headers: { ...headers, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readLimited(response, maxBytes);
  return {
    url,
    finalUrl: response.url || url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    text: body.text,
    capturedBytes: body.bytes,
    truncated: body.truncated,
    hashSha256: crypto.createHash('sha256').update(body.text).digest('hex'),
  };
}

function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  let sawRule = false;
  const flush = () => {
    if (agents.length) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
    sawRule = false;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (sawRule) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if (!['allow', 'disallow'].includes(key) || !agents.length) continue;
    sawRule = true;
    if (key === 'disallow' && value === '') continue;
    if (value) rules.push({ type: key, value });
  }
  flush();
  return groups;
}

function agentSpecificity(agent) {
  if (agent === '*') return 1;
  const token = agent.trim().toLowerCase();
  return token && UA.toLowerCase().includes(token) ? token.length + 1 : 0;
}

function ruleMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try { return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path); }
  catch { return false; }
}

function evaluateRobots(text, url) {
  const groups = parseRobots(text);
  const scored = groups.map((group) => ({ group, score: Math.max(0, ...group.agents.map(agentSpecificity)) })).filter((row) => row.score > 0);
  if (!scored.length) return { allowed: true, matchedRule: null, applicableGroups: 0 };
  const best = Math.max(...scored.map((row) => row.score));
  const path = `${new URL(url).pathname}${new URL(url).search}`;
  const matches = scored.filter((row) => row.score === best).flatMap((row) => row.group.rules)
    .filter((rule) => ruleMatches(rule.value, path))
    .sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
  return { allowed: !matches[0] || matches[0].type === 'allow', matchedRule: matches[0] || null, applicableGroups: scored.filter((row) => row.score === best).length };
}

function clean(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'), base);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function sourceDeclaredLinks(html, baseUrl) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (!/(?:^|\.)kcar\.com$/.test(host)) continue;
    const text = clean(match[2]);
    if (!out.some((row) => row.url === url && row.text === text)) out.push({ url, text: text.slice(0, 180) });
  }
  return out;
}

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 260);
}

function snippets(text, regex, limit = 10, radius = 220) {
  const source = String(text || '');
  const out = [];
  for (const match of source.matchAll(regex)) {
    const start = Math.max(0, (match.index || 0) - radius);
    const end = Math.min(source.length, (match.index || 0) + match[0].length + radius);
    const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!out.includes(snippet)) out.push(snippet);
    if (out.length >= limit) break;
  }
  return out;
}

async function robotsForOrigin(origin, result) {
  const url = `${origin}/robots.txt`;
  const page = await get(url, 'text/plain,*/*;q=0.5', 300000);
  result.requestCount += 1;
  result.robotsRequests += 1;
  return page;
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceId: SOURCE_ID,
  mode: 'permission_first_source_declared_terms_and_partnership_no_write',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  homeRequests: 0,
  termsRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
};

try {
  const homeOrigin = new URL(HOME_URL).origin;
  const homeRobots = await robotsForOrigin(homeOrigin, result);
  if (!homeRobots.ok && ![404,410].includes(homeRobots.status)) throw new Error(`home_robots_http_${homeRobots.status}`);
  const homeDecision = homeRobots.ok ? evaluateRobots(homeRobots.text, HOME_URL) : { allowed: true, matchedRule: null, applicableGroups: 0 };
  result.homeRobots = {
    status: homeRobots.status,
    finalUrl: homeRobots.finalUrl,
    contentType: homeRobots.contentType,
    hashSha256: homeRobots.hashSha256,
    homeAllowed: homeDecision.allowed,
    matchedRule: homeDecision.matchedRule,
  };
  if (!homeDecision.allowed) throw new Error('home_disallowed_by_robots');

  const home = await get(HOME_URL, 'text/html,application/xhtml+xml,*/*;q=0.5');
  result.requestCount += 1;
  result.homeRequests = 1;
  if (!home.ok) throw new Error(`home_http_${home.status}`);
  const homeVisible = clean(home.text);
  const links = sourceDeclaredLinks(home.text, home.finalUrl);
  const termsLink = links.find((row) => /이용약관|terms?\s*(?:of\s*)?(?:use|service)?|약관/i.test(`${row.text} ${row.url}`)) || null;
  const partnershipSnippets = snippets(homeVisible, /(?:사업제휴문의|partnership@kcar\.com|사업\s*제휴)/gi, 8, 260);
  result.home = {
    status: home.status,
    finalUrl: home.finalUrl,
    contentType: home.contentType,
    capturedBytes: home.capturedBytes,
    truncated: home.truncated,
    hashSha256: home.hashSha256,
    title: titleOf(home.text),
    sourceDeclaredLinkCount: links.length,
    termsLink,
    partnershipSnippets,
    partnershipEmailVisible: /partnership@kcar\.com/i.test(homeVisible),
  };

  if (!termsLink) {
    result.permissionConclusion = partnershipSnippets.length
      ? 'official_business_partnership_route_proven_terms_link_not_extracted_public_automation_permission_unproven'
      : 'terms_and_permission_unresolved_no_inventory_probe';
    result.completed = true;
  } else {
    const termsOrigin = new URL(termsLink.url).origin;
    let termsRobots = homeRobots;
    if (termsOrigin !== homeOrigin) termsRobots = await robotsForOrigin(termsOrigin, result);
    if (!termsRobots.ok && ![404,410].includes(termsRobots.status)) throw new Error(`terms_robots_http_${termsRobots.status}`);
    const termsDecision = termsRobots.ok ? evaluateRobots(termsRobots.text, termsLink.url) : { allowed: true, matchedRule: null, applicableGroups: 0 };
    result.termsRobots = {
      origin: termsOrigin,
      status: termsRobots.status,
      hashSha256: termsRobots.hashSha256,
      allowed: termsDecision.allowed,
      matchedRule: termsDecision.matchedRule,
    };
    if (!termsDecision.allowed) throw new Error('terms_disallowed_by_robots');

    const terms = await get(termsLink.url, 'text/html,application/xhtml+xml,*/*;q=0.5');
    result.requestCount += 1;
    result.termsRequests = 1;
    const visible = clean(terms.text);
    result.terms = {
      status: terms.status,
      finalUrl: terms.finalUrl,
      contentType: terms.contentType,
      capturedBytes: terms.capturedBytes,
      truncated: terms.truncated,
      hashSha256: terms.hashSha256,
      title: titleOf(terms.text),
      visibleTextLength: visible.length,
      automationRestrictionSnippets: snippets(visible, /(?:자동\s*(?:수집|검색|접속)|크롤|스크랩|로봇|데이터\s*마이닝|무단\s*(?:수집|복제|이용)|scrap(?:e|ing)|crawler|spider|robot|automated)/gi),
      reuseRestrictionSnippets: snippets(visible, /(?:상업적\s*이용|복제|재사용|재이용|재배포|데이터베이스|저작권|무단\s*이용|commercial|reuse|reproduce|republish|database|copyright)/gi),
    };
    const explicitRestriction = result.terms.automationRestrictionSnippets.length > 0 || result.terms.reuseRestrictionSnippets.length > 0;
    const partnership = partnershipSnippets.length > 0;
    result.permissionConclusion = explicitRestriction
      ? partnership
        ? 'public_automation_or_reuse_restricted_official_business_partnership_route_proven'
        : 'public_automation_or_reuse_restricted_no_permitted_data_route_proven'
      : partnership
        ? 'official_business_partnership_route_proven_public_automation_permission_not_proven'
        : 'public_automation_permission_not_proven';
    result.completed = true;
  }
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUT,
  completed: result.completed,
  requestCount: result.requestCount,
  termsLink: result.home?.termsLink?.url || null,
  partnership: result.home?.partnershipEmailVisible || false,
  permissionConclusion: result.permissionConclusion || null,
  error: result.error || null,
}, null, 2));
if (!result.completed) process.exitCode = 1;
