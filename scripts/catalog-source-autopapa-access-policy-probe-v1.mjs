import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-autopapa-access-policy-probe-v1.json';
const SOURCE_ID = 'autopapa_georgia_open';
const ENTRY_URL = 'https://autopapa.ge/';
const ROBOTS_URL = 'https://autopapa.ge/robots.txt';
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1_500_000;

const headers = {
  'user-agent': UA,
  'accept-language': 'en-US,en;q=0.9,ka;q=0.8,ru;q=0.7',
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

async function get(url, accept) {
  const response = await fetch(url, {
    headers: { ...headers, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readLimited(response, url === ROBOTS_URL ? 300000 : MAX_BYTES);
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
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (sawRule) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if (!['allow','disallow'].includes(key) || !agents.length) continue;
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

function policyLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin) continue;
    const text = clean(match[2]);
    const key = `${parsed.pathname} ${text}`;
    if (!/(?:terms?|conditions?|rules?|policy|privacy|legal|agreement|usage|use|წეს|პირობ|კონფიდენ|политик|правил|услов)/i.test(key)) continue;
    if (!out.some((row) => row.url === url)) out.push({ url, text: text.slice(0, 180) });
  }
  return out.slice(0, 20);
}

function snippets(text, regex, limit = 10, radius = 180) {
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

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceId: SOURCE_ID,
  mode: 'permission_first_source_declared_policy_link_no_write',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  entryRequests: 0,
  policyRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
};

try {
  const robots = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequests = 1;
  if (!robots.ok && ![404,410].includes(robots.status)) throw new Error(`robots_http_${robots.status}`);
  const entryDecision = robots.ok ? evaluateRobots(robots.text, ENTRY_URL) : { allowed: true, matchedRule: null, applicableGroups: 0 };
  result.robots = {
    status: robots.status,
    finalUrl: robots.finalUrl,
    contentType: robots.contentType,
    hashSha256: robots.hashSha256,
    entryAllowed: entryDecision.allowed,
    entryMatchedRule: entryDecision.matchedRule,
  };
  if (!entryDecision.allowed) throw new Error('entry_disallowed_by_robots');

  const entry = await get(ENTRY_URL, 'text/html,application/xhtml+xml,*/*;q=0.5');
  result.requestCount += 1;
  result.entryRequests = 1;
  result.entry = {
    status: entry.status,
    finalUrl: entry.finalUrl,
    contentType: entry.contentType,
    capturedBytes: entry.capturedBytes,
    truncated: entry.truncated,
    hashSha256: entry.hashSha256,
    title: clean(entry.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0,260),
  };
  if (!entry.ok) throw new Error(`entry_http_${entry.status}`);

  const links = policyLinks(entry.text, entry.finalUrl);
  result.entry.policyLinks = links;
  let policyPage = null;
  let selected = null;
  for (const link of links) {
    const decision = robots.ok ? evaluateRobots(robots.text, link.url) : { allowed: true, matchedRule: null, applicableGroups: 0 };
    if (!decision.allowed) continue;
    selected = { ...link, robotsAllowed: true };
    policyPage = await get(link.url, 'text/html,application/xhtml+xml,*/*;q=0.5');
    result.requestCount += 1;
    result.policyRequests = 1;
    break;
  }

  if (!policyPage) {
    result.permissionConclusion = 'no_source_declared_readable_policy_link_proven_from_entry_no_positive_permission';
    result.completed = true;
  } else {
    const visible = clean(policyPage.text);
    const automation = snippets(visible, /(?:scrap(?:e|ing)|crawler|spider|robot|automated|automation|data\s*mining|harvest|რობოტ|ავტომატ|სკრაპ|парсинг|скрейп|робот|автоматиз)/gi);
    const reuse = snippets(visible, /(?:commercial\s+use|commercially|reuse|re-use|reproduce|copy(?:ing)?|extract(?:ion)?|database|republish|license|კომერც|კოპირ|მონაცემთა\s*ბაზ|გამოყენებ|коммерчес|копир|извлеч|повторн.*использ|баз.*данн)/gi);
    result.policy = {
      selected,
      status: policyPage.status,
      finalUrl: policyPage.finalUrl,
      contentType: policyPage.contentType,
      capturedBytes: policyPage.capturedBytes,
      truncated: policyPage.truncated,
      hashSha256: policyPage.hashSha256,
      visibleTextLength: visible.length,
      automationRestrictionSnippets: automation,
      reuseRestrictionSnippets: reuse,
    };
    result.permissionConclusion = !policyPage.ok
      ? `source_declared_policy_http_${policyPage.status}_no_positive_permission`
      : automation.length || reuse.length
        ? 'manual_review_required_before_inventory_probe'
        : 'source_declared_policy_readable_but_no_positive_automation_reuse_permission_proven';
    result.completed = true;
  }
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: OUT, completed: result.completed, requestCount: result.requestCount, policyRequests: result.policyRequests, permissionConclusion: result.permissionConclusion || null, error: result.error || null }, null, 2));
if (!result.completed) process.exitCode = 1;
