import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT = 'catalog-source-encar-access-policy-probe-v1.json';
const SOURCE_ID = 'encar_direct';
const ORIGIN = 'https://fem.encar.com';
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const TERMS_URL = `${ORIGIN}/policy/terms`;
const CONTACT_URL = `${ORIGIN}/company/contact-us`;
const UA = 'AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1_500_000;

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

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceId: SOURCE_ID,
  mode: 'permission_first_official_terms_and_data_partnership_no_write',
  provenance: 'official Encar terms and company contact URLs verified on current public Encar surfaces; no guessed listing/detail/API route',
  productionWrites: false,
  classificationMutations: false,
  publishAllowedMutations: false,
  objectStorageWrites: false,
  catalogGenerationWrites: false,
  rawBodiesStored: false,
  guessedRoutes: false,
  requestCount: 0,
  robotsRequests: 0,
  termsRequests: 0,
  contactRequests: 0,
  detailRequests: 0,
  paginationRequests: 0,
  apiRequests: 0,
};

try {
  const robots = await get(ROBOTS_URL, 'text/plain,*/*;q=0.5');
  result.requestCount += 1;
  result.robotsRequests = 1;
  if (!robots.ok && ![404,410].includes(robots.status)) throw new Error(`robots_http_${robots.status}`);
  const termsDecision = robots.ok ? evaluateRobots(robots.text, TERMS_URL) : { allowed: true, matchedRule: null, applicableGroups: 0 };
  const contactDecision = robots.ok ? evaluateRobots(robots.text, CONTACT_URL) : { allowed: true, matchedRule: null, applicableGroups: 0 };
  result.robots = {
    status: robots.status,
    finalUrl: robots.finalUrl,
    contentType: robots.contentType,
    hashSha256: robots.hashSha256,
    termsAllowed: termsDecision.allowed,
    termsMatchedRule: termsDecision.matchedRule,
    contactAllowed: contactDecision.allowed,
    contactMatchedRule: contactDecision.matchedRule,
  };

  if (!termsDecision.allowed) throw new Error('terms_disallowed_by_robots');
  const terms = await get(TERMS_URL, 'text/html,application/xhtml+xml,*/*;q=0.5');
  result.requestCount += 1;
  result.termsRequests = 1;
  const termsVisible = clean(terms.text);
  result.terms = {
    status: terms.status,
    finalUrl: terms.finalUrl,
    contentType: terms.contentType,
    capturedBytes: terms.capturedBytes,
    truncated: terms.truncated,
    hashSha256: terms.hashSha256,
    title: titleOf(terms.text),
    visibleTextLength: termsVisible.length,
    automationRestrictionSnippets: snippets(termsVisible, /(?:자동\s*(?:수집|검색|접속)|크롤|스크랩|로봇|데이터\s*마이닝|무단\s*(?:수집|복제|이용)|scrap(?:e|ing)|crawler|spider|robot|automated)/gi),
    reuseRestrictionSnippets: snippets(termsVisible, /(?:상업적\s*이용|복제|재사용|재이용|재배포|데이터베이스|저작권|무단\s*이용|commercial|reuse|reproduce|republish|database|copyright)/gi),
  };

  if (!contactDecision.allowed) throw new Error('contact_disallowed_by_robots');
  const contact = await get(CONTACT_URL, 'text/html,application/xhtml+xml,*/*;q=0.5');
  result.requestCount += 1;
  result.contactRequests = 1;
  const contactVisible = clean(contact.text);
  result.contact = {
    status: contact.status,
    finalUrl: contact.finalUrl,
    contentType: contact.contentType,
    capturedBytes: contact.capturedBytes,
    truncated: contact.truncated,
    hashSha256: contact.hashSha256,
    title: titleOf(contact.text),
    visibleTextLength: contactVisible.length,
    dataPartnershipSnippets: snippets(contactVisible, /(?:시세\s*\/\s*데이터\s*제휴|데이터\s*제휴|거래데이터\s*서비스\s*제휴|price@encar\.com|사업\s*제휴|business@encar\.com)/gi, 10, 260),
  };

  const partnershipProven = result.contact.dataPartnershipSnippets.length > 0;
  const explicitPublicRestriction = result.terms.automationRestrictionSnippets.length > 0 || result.terms.reuseRestrictionSnippets.length > 0;
  result.permissionConclusion = partnershipProven
    ? explicitPublicRestriction
      ? 'official_data_partnership_route_proven_public_automation_reuse_restricted_or_requires_review'
      : 'official_data_partnership_route_proven_public_automation_permission_not_proven'
    : 'no_positive_data_route_proven_permission_unresolved';
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = String(error?.message || error);
}

await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: OUT, completed: result.completed, requestCount: result.requestCount, permissionConclusion: result.permissionConclusion || null, dataPartnershipSignals: result.contact?.dataPartnershipSnippets?.length || 0, error: result.error || null }, null, 2));
if (!result.completed) process.exitCode = 1;
