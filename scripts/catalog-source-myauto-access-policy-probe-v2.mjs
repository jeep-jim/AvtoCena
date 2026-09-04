import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-myauto-access-policy-probe-v2.json';
const SOURCE_ID = 'myauto_georgia_list';
const ORIGIN = 'https://www.myauto.ge';
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const RULES_URLS = [`${ORIGIN}/ka/rules`, `${ORIGIN}/ru/rules`];
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1_500_000;

const headers = {
  'user-agent': UA,
  'accept-language': 'ka,en-US;q=0.9,ru;q=0.8,en;q=0.7',
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
  const scored = groups.map((group) => ({
    group,
    score: Math.max(0, ...group.agents.map(agentSpecificity)),
  })).filter((row) => row.score > 0);
  if (!scored.length) return { allowed: true, matchedRule: null, applicableGroups: 0 };
  const best = Math.max(...scored.map((row) => row.score));
  const path = `${new URL(url).pathname}${new URL(url).search}`;
  const matches = scored.filter((row) => row.score === best)
    .flatMap((row) => row.group.rules)
    .filter((rule) => ruleMatches(rule.value, path))
    .sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
  return {
    allowed: !matches[0] || matches[0].type === 'allow',
    matchedRule: matches[0] || null,
    applicableGroups: scored.filter((row) => row.score === best).length,
  };
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

function titleOf(html) {
  return clean(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 260);
}

function snippets(text, regex, limit = 10, radius = 200) {
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
  version: 2,
  generatedAt: new Date().toISOString(),
  sourceId: SOURCE_ID,
  mode: 'permission_first_bounded_alternate_rules_no_write',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  rulesRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
  rulesAttempts: [],
};

try {
  const robots = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequests = 1;
  if (!robots.ok && ![404, 410].includes(robots.status)) throw new Error(`robots_http_${robots.status}`);
  result.robots = {
    status: robots.status,
    finalUrl: robots.finalUrl,
    contentType: robots.contentType,
    hashSha256: robots.hashSha256,
  };

  let readable = null;
  for (const url of RULES_URLS) {
    const evaluation = robots.ok ? evaluateRobots(robots.text, url) : { allowed: true, matchedRule: null, applicableGroups: 0 };
    if (!evaluation.allowed) {
      result.rulesAttempts.push({ url, skipped: true, reason: 'robots_disallowed', matchedRule: evaluation.matchedRule });
      continue;
    }
    const page = await get(url, 'text/html,application/xhtml+xml,*/*;q=0.5');
    result.requestCount += 1;
    result.rulesRequests += 1;
    const attempt = {
      url,
      finalUrl: page.finalUrl,
      status: page.status,
      ok: page.ok,
      contentType: page.contentType,
      capturedBytes: page.capturedBytes,
      truncated: page.truncated,
      hashSha256: page.hashSha256,
      title: titleOf(page.text),
      robotsAllowed: true,
    };
    result.rulesAttempts.push(attempt);
    if (page.ok) {
      readable = page;
      break;
    }
  }

  if (!readable) {
    result.permissionConclusion = 'official_rules_routes_inaccessible_from_automation_no_positive_permission_proven';
    result.completed = true;
  } else {
    const visible = clean(readable.text);
    const automation = snippets(visible, /(?:scrap(?:e|ing)|crawler|spider|robot|automated|automation|data\s*mining|harvest|პარს|რობოტ|ავტომატ|სკრაპ|парсинг|скрейп|робот|автоматиз)/gi);
    const reuse = snippets(visible, /(?:commercial\s+use|commercially|reuse|re-use|reproduce|copy(?:ing)?|extract(?:ion)?|database|republish|license|კომერც|კოპირ|მონაცემთა\s*ბაზ|გამოყენებ|коммерчес|копир|извлеч|повторн.*использ|баз.*данн)/gi);
    const ipBlocking = snippets(visible, /(?:IP\s*(?:address|მისამართი|адрес)|დაბლოკ|block(?:ed|ing)?\s+IP)/gi);
    const sections = snippets(visible, /(?:3\.11|3\.12|4\.5|4\.8)/g, 12, 280);
    result.readableRulesPage = {
      finalUrl: readable.finalUrl,
      status: readable.status,
      contentType: readable.contentType,
      capturedBytes: readable.capturedBytes,
      truncated: readable.truncated,
      hashSha256: readable.hashSha256,
      title: titleOf(readable.text),
      visibleTextLength: visible.length,
      automationRestrictionSnippets: automation,
      reuseRestrictionSnippets: reuse,
      ipBlockingSnippets: ipBlocking,
      sectionSignals: sections,
    };
    result.permissionConclusion = automation.length || reuse.length
      ? 'manual_review_required_before_any_inventory_probe'
      : 'no_explicit_automation_or_reuse_rule_detected_but_no_positive_permission_proven';
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
  rulesRequests: result.rulesRequests,
  permissionConclusion: result.permissionConclusion || null,
  error: result.error || null,
}, null, 2));
if (!result.completed) process.exitCode = 1;
