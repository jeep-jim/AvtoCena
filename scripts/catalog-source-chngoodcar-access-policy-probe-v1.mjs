import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const SOURCE_ID = 'chngoodcar_china_candidate';
const ORIGIN = 'https://www.chngoodcar.com';
const UA = 'AvtoCenaQualificationProbe/1.0 (+bounded read-only access-policy review)';
const OUT = 'catalog-source-chngoodcar-access-policy-probe-v1.json';
const LEGAL = /terms|conditions|privacy|legal|rules|policy|agreement|法律|条款|协议|隐私|声明/i;
const TOPIC = /scrap\w*|robot\w*|spider\w*|automat\w*|commercial\w*|reus\w*|reproduc\w*|republish\w*|permission|consent|api|feed|license|爬虫|抓取|自动|商业|许可|授权|复制|转载|协议|法律/gim;

function decode(s) {
  return String(s).replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n) => {
    const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
  }).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&nbsp;/gi, ' ');
}
function visible(html) {
  return decode(String(html).replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function publicHttps(value, base) {
  try {
    const u = new URL(decode(value), base);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
        isIP(u.hostname) || !u.hostname.includes('.') || /\.(local|localhost|internal|invalid|test)$/i.test(u.hostname)) return null;
    u.hash = '';
    return u;
  } catch { return null; }
}
export function legalLinks(html, base) {
  const cleaned = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  const found = new Map();
  for (const m of cleaned.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const label = visible(m[2]).slice(0, 140);
    const u = publicHttps(href[1] ?? href[2] ?? href[3], base);
    if (!u || !LEGAL.test(label + ' ' + u.pathname) ||
        /\/(?:api|login|logout|account|cars|carslist|used-cars|inventory|search)(?:[/.?]|$)/i.test(u.pathname)) continue;
    if (!found.has(u.href)) found.set(u.href, { url: u.href, label });
  }
  const links = [...found.values()];
  links.sort((a, b) => Number(/privacy|隐私/i.test(a.label + a.url)) - Number(/privacy|隐私/i.test(b.label + b.url)));
  return { links: links.slice(0, 30), detectedCount: links.length, truncated: links.length > 30 };
}
export function robotsAllows(text, url) {
  const groups = []; let agents = [], rules = [];
  const flush = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') { if (rules.length) flush(); agents.push(value.toLowerCase()); }
    else if (agents.length && ['allow', 'disallow'].includes(key)) rules.push({ kind: key, path: value });
  }
  flush();
  if (!groups.length && text.trim()) return { allowed: false, reason: 'robots_format_unproven' };
  const ua = UA.toLowerCase();
  const scores = groups.map(g => Math.max(-1, ...g.agents.map(a => a === '*' ? 0 : a && ua.includes(a) ? a.length : -1)));
  const best = Math.max(-1, ...scores);
  const path = new URL(url).pathname + new URL(url).search;
  const matches = [];
  groups.forEach((g, i) => {
    if (scores[i] !== best || best < 0) return;
    for (const r of g.rules) {
      if (!r.path) continue;
      const pattern = r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$$/, '$').replace(/\*/g, '.*');
      if (new RegExp('^' + pattern).test(path)) matches.push({ ...r, specificity: r.path.replace(/[*$]/g, '').length });
    }
  });
  matches.sort((a, b) => b.specificity - a.specificity || Number(b.kind === 'allow') - Number(a.kind === 'allow'));
  const rule = matches[0];
  return { allowed: !rule || rule.kind === 'allow', reason: rule ? 'matched_rule' : 'no_disallow_match', matchedRule: rule ? { kind: rule.kind, path: rule.path.slice(0, 250) } : null };
}
export function policySnippets(html) {
  const text = visible(html), out = [], ranges = []; let used = 0;
  // Store bounded excerpts only; never retain the complete policy text.
  const budget = Math.min(1500, Math.floor(text.length / 3));
  const important = /commercial|scrap|robot|spider|automat|permission|consent|republish|商业性利用|商业用途|事先书面批准|爬虫|抓取|复制|转载|授权/i;
  const matches = [...text.matchAll(TOPIC)].sort((a, b) => Number(important.test(text.slice(Math.max(0, b.index - 40), b.index + 100))) - Number(important.test(text.slice(Math.max(0, a.index - 40), a.index + 100))));
  for (const m of matches) {
    if (out.length >= 6 || used >= budget) break;
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, start + Math.min(280, budget - used));
    if (ranges.some(([a, b]) => start < b && end > a)) continue;
    const snippet = text.slice(start, end);
    if (snippet) { out.push(snippet); ranges.push([start, end]); used += snippet.length; }
  }
  return { visibleCharacters: text.length, snippets: out, storedSnippetCharacters: used };
}
async function readBounded(response, max) {
  const reader = response.body?.getReader(); const chunks = []; let bytes = 0, truncated = false;
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = Math.min(value.byteLength, max - bytes);
      if (n) chunks.push(Buffer.from(value.subarray(0, n)));
      bytes += n;
      if (n < value.byteLength || bytes === max) { truncated = true; break; }
    }
  } finally { if (truncated) await reader.cancel().catch(() => {}); }
  const buffer = Buffer.concat(chunks);
  return { text: buffer.toString('utf8'), capturedBytes: bytes, truncated, bodyHashSha256: crypto.createHash('sha256').update(buffer).digest('hex'), hashScope: truncated ? 'captured_prefix' : 'complete_response_body' };
}
export async function runProbe({ registry, fetchImpl = fetch, policyEvidence = null } = {}) {
  assert.equal(registry.productionWrites, false);
  assert(registry.candidates.every(c => c.publishAllowed === false));
  assert(registry.pausedMarkets.includes('japan'));
  assert.equal(registry.marketControls.japan.automatedQualificationAllowed, false);
  assert(registry.candidates.filter(c => c.market === 'japan').every(c => c.qualificationPaused === true));
  const c = registry.candidates.find(c => c.sourceId === SOURCE_ID);
  assert.equal(c?.market, 'china'); assert.equal(new URL(c.url).origin, ORIGIN);
  assert(!c.qualificationPaused && !registry.pausedMarkets.includes(c.market));
  const report = { version: 1, generatedAt: new Date().toISOString(), sourceId: SOURCE_ID,
    mode: 'permission_first_bounded_no_write', productionWrites: false, publishAllowed: false,
    publishAllowedMutations: false, classificationMutations: false, objectStorageWrites: false,
    catalogGenerationWrites: false, manifestWrites: false, cleanupStarted: false,
    rawBodiesStored: false, redirectsFollowed: false, guessedRoutes: false, japanRequests: 0,
    listingRequests: 0, detailRequests: 0, apiRequests: 0, paginationRequests: 0,
    requestCount: 0, maxRequests: 3, requests: [], sourceDeclaredLegalLinks: [],
    positivePermissionProven: false, automaticClassification: false, completed: false };
  async function get(url, kind) {
    assert(report.requestCount < report.maxRequests, 'request_budget_exhausted');
    const row = { requestNumber: ++report.requestCount, kind, url, method: 'GET', status: null, finalUrl: null, contentType: null,
      bodyHashSha256: null, capturedBytes: 0, truncated: false };
    report.requests.push(row);
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual',
        headers: { 'user-agent': UA, accept: kind === 'robots' ? 'text/plain' : 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(20000) });
      Object.assign(row, { status: response.status, finalUrl: response.url || url, contentType: response.headers.get('content-type') || '',
        redirectLocation: response.headers.get('location') || null });
      const body = await readBounded(response, kind === 'robots' ? 200000 : 1800000);
      const { text, ...metadata } = body; Object.assign(row, metadata);
      return { row, text, ok: response.ok };
    } catch (error) { row.error = String(error.message).slice(0, 200); throw error; }
  }
  function allowed(r, url) {
    if ([404, 410].includes(r.row.status)) return { allowed: true, reason: 'robots_absent_http_' + r.row.status };
    if (!r.ok || r.row.truncated || /html/i.test(r.row.contentType)) return { allowed: false, reason: 'robots_access_or_completeness_unproven' };
    return robotsAllows(r.text, url);
  }
  const stop = reason => { report.decisionSignal = reason; report.completed = true; return report; };
  try {
    if (policyEvidence) {
      assert.equal(policyEvidence.sourceId, SOURCE_ID);
      assert.equal(policyEvidence.rawBodiesStored, false);
      const url = policyEvidence.selectedPolicyLink?.url;
      // Only the exact legal route already declared by the previous live homepage is eligible.
      assert.equal(url, ORIGIN + '/Home/Qualification?id=4');
      assert(policyEvidence.sourceDeclaredLegalLinks.some(l => l.url === url));
      report.mode = 'same_declared_policy_clause_confirmation_no_write';
      report.maxRequests = 2;
      report.sourceDeclaredLegalLinks = policyEvidence.sourceDeclaredLegalLinks;
      report.selectedPolicyLink = policyEvidence.selectedPolicyLink;
      report.routeProvenanceRun = 34018339034;
      const robots = await get(ORIGIN + '/robots.txt', 'robots');
      report.policyRobotsDecision = allowed(robots, url);
      if (!report.policyRobotsDecision.allowed) return stop('policy_robots_access_unproven_or_disallowed');
      const policy = await get(url, 'policy');
      if (!policy.ok || !/html/i.test(policy.row.contentType)) return stop('policy_unreadable_permission_unproven');
      report.policy = { url, ...policySnippets(policy.text) };
      const text = visible(policy.text);
      const clause = text.match(/1\.4\s*您同意，您不会对任何资料作商业性利用[^。]{0,250}。/);
      report.policy.commercialUseClause = clause ? { section: '七 / 1.4', text: clause[0] } : null;
      report.policy.explicitPriorWrittenApprovalClauseObserved = Boolean(clause && /事先书面批准/.test(clause[0]));
      return stop(clause ? 'commercial_reuse_prior_written_approval_clause_observed' : 'clause_not_confirmed_permission_unproven');
    }
    const robots = await get(ORIGIN + '/robots.txt', 'robots');
    report.homeRobotsDecision = allowed(robots, ORIGIN + '/');
    if (!report.homeRobotsDecision.allowed) return stop('home_robots_access_unproven_or_disallowed');
    const home = await get(ORIGIN + '/', 'home');
    if (!home.ok) return stop('home_http_' + home.row.status + '_permission_unproven');
    if (!/html/i.test(home.row.contentType) || /just a moment|cf-chl-|captcha|turnstile|EO-Bot-Js-Token/i.test(home.text)) return stop('home_unreadable_or_challenged_permission_unproven');
    const found = legalLinks(home.text, home.row.finalUrl);
    report.sourceDeclaredLegalLinks = found.links;
    report.legalLinkCount = found.detectedCount; report.legalLinksTruncated = found.truncated;
    const link = found.links[0];
    if (!link) return stop('no_source_declared_legal_link_in_captured_home_permission_unproven');
    report.selectedPolicyLink = link;
    const u = new URL(link.url);
    let policyRobots = robots;
    if (u.origin !== ORIGIN) {
      report.maxRequests = 4;
      policyRobots = await get(u.origin + '/robots.txt', 'robots');
    }
    report.policyRobotsDecision = allowed(policyRobots, link.url);
    if (!report.policyRobotsDecision.allowed) return stop('policy_robots_access_unproven_or_disallowed');
    const policy = await get(link.url, 'policy');
    if (!policy.ok || !/html|text\/plain/i.test(policy.row.contentType)) return stop('policy_http_or_type_unreadable_permission_unproven');
    report.policy = { url: link.url, ...policySnippets(policy.text) };
    return stop('source_declared_policy_requires_manual_permission_review');
  } catch (error) { report.error = String(error.message).slice(0, 200); return stop('network_or_envelope_error_permission_unproven'); }
}

async function selfTest() {
  const registry = { productionWrites: false, pausedMarkets: ['japan'], marketControls: { japan: { automatedQualificationAllowed: false } },
    candidates: [{ sourceId: SOURCE_ID, market: 'china', url: ORIGIN + '/', publishAllowed: false },
      { sourceId: 'paused_test', market: 'japan', qualificationPaused: true, publishAllowed: false }] };
  const fake = entries => async (url, opts) => {
    assert.equal(opts.redirect, 'manual'); assert.equal(opts.method, 'GET');
    const x = entries.shift(); assert(x, 'unexpected_request'); assert.equal(url, x[0]);
    return new Response(x[2] ?? '', { status: x[1], headers: { 'content-type': url.endsWith('robots.txt') ? 'text/plain' : 'text/html' } });
  };
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /legal', ORIGIN + '/legal').allowed, true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*?secret=*', ORIGIN + '/legal?secret=1').allowed, false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /legal$', ORIGIN + '/legal-more').allowed, true);
  assert.equal(robotsAllows('User-agent: AvtoCenaQualificationProbe\nDisallow: /\nUser-agent: *\nAllow: /', ORIGIN + '/').allowed, false);
  let r = await runProbe({ registry, fetchImpl: fake([[ORIGIN + '/robots.txt', 200, 'User-agent: *\nDisallow: /']]) });
  assert.equal(r.requestCount, 1);
  r = await runProbe({ registry, fetchImpl: fake([[ORIGIN + '/robots.txt', 200, 'User-agent: *\nAllow: /'], [ORIGIN + '/', 302]]) });
  assert.equal(r.requestCount, 2); assert.match(r.decisionSignal, /302/);
  r = await runProbe({ registry, fetchImpl: fake([[ORIGIN + '/robots.txt', 200, 'User-agent: *\nDisallow: /legal'], [ORIGIN + '/', 200, '<a href="/legal">Terms</a>']]) });
  assert.equal(r.requestCount, 2); assert.equal(r.policyRobotsDecision.allowed, false);
  r = await runProbe({ registry, fetchImpl: fake([[ORIGIN + '/robots.txt', 404], [ORIGIN + '/', 200, '<a href="https://policy.example.com/terms">Terms</a>'], ['https://policy.example.com/robots.txt', 200, 'User-agent: *\nAllow: /'], ['https://policy.example.com/terms', 200, 'Written authorization is required for commercial use. '.repeat(30)]]) });
  assert.equal(r.requestCount, 4); assert.equal(r.positivePermissionProven, false); assert(r.policy.storedSnippetCharacters < r.policy.visibleCharacters);
  r = await runProbe({ registry, fetchImpl: async () => { throw new Error('network_test'); } });
  assert.equal(r.requestCount, 1); assert.equal(r.requests[0].status, null);
  assert.equal(legalLinks('<script><a href="/terms">Terms</a></script><a href="https://127.0.0.1/legal">Legal</a><a href="/Home/Cars?id=1">Legal</a>', ORIGIN).detectedCount, 0);
  await assert.rejects(runProbe({ registry: { ...registry, productionWrites: true }, fetchImpl: async () => { throw new Error('must_not_fetch'); } }));
  const sample = '隐私政策 注册协议 法律声明 '.repeat(50) + '1.4您同意，您不会对任何资料作商业性利用，包括但不限于在未经广东好车事先书面批准的情况下，复制在广东好车网站上展示的任何资料并用于商业用途。' + ' 普通其他内容。'.repeat(100);
  r = await runProbe({ registry, policyEvidence: { sourceId: SOURCE_ID, rawBodiesStored: false, selectedPolicyLink: { url: ORIGIN + '/Home/Qualification?id=4' }, sourceDeclaredLegalLinks: [{ url: ORIGIN + '/Home/Qualification?id=4' }] },
    fetchImpl: fake([[ORIGIN + '/robots.txt', 404], [ORIGIN + '/Home/Qualification?id=4', 200, sample]]) });
  assert.equal(r.requestCount, 2); assert.equal(r.policy.explicitPriorWrittenApprovalClauseObserved, true);
  assert(policySnippets(sample).snippets.some(s => s.includes('商业性利用')));
  console.log('Access-policy safety self-test: 13 checks passed; live requests: 0');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const registry = JSON.parse(await fs.readFile('data/catalog/source-qualification-v1.json', 'utf8'));
    const policyEvidence = process.argv.includes('--confirm-policy') ? JSON.parse(await fs.readFile('evidence/previous/catalog-source-chngoodcar-access-policy-probe-v1.json', 'utf8')) : null;
    const result = await runProbe({ registry, policyEvidence });
    await fs.writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  }
}
