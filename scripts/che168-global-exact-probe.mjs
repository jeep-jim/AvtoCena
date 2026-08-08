import fs from 'node:fs/promises';

const BASE = 'https://global.che168.com';
const LIST = `${BASE}/en/used-cars`;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.7',
  'cache-control': 'no-cache', pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
function clean(value) { return String(value ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim(); }
function abs(value, base = BASE) { try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; } }
async function get(url, referer = LIST) { const res = await fetch(url, { headers: { ...HEADERS, referer }, redirect: 'follow', signal: AbortSignal.timeout(30_000) }); return { res, body: await res.text() }; }
function idsOf(body) { return [...new Set([...body.matchAll(/\/en\/detail\/(\d+)/g)].map((m) => m[1]))]; }
function contextsAround(body, terms, radius = 1200, maxPer = 6) {
  const out = []; const lower = body.toLowerCase();
  for (const term of terms) { let from = 0; let n = 0; while (n < maxPer) { const index = lower.indexOf(term.toLowerCase(), from); if (index < 0) break; out.push({ term, context: body.slice(Math.max(0, index - radius), Math.min(body.length, index + radius)) }); from = index + term.length; n++; } }
  return out;
}
function endpointCandidates(body) {
  const values = [];
  for (const match of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi)) values.push(match[0].replace(/\\\//g, '/'));
  for (const match of body.matchAll(/["'`](\/[^"'`]*(?:api|search|used-car|usedcar|list|query|filter|vehicle)[^"'`]*)["'`]/gi)) values.push(match[1].replace(/\\\//g, '/'));
  return [...new Set(values.map((v) => v.replace(/\\u0026/g, '&')).filter((v) => /globalapi|api|search|used-car|usedcar|vehicle|pageindex|pagesize/i.test(v)))].slice(0, 200);
}

const { res: listRes, body: listBody } = await get(LIST, `${BASE}/en`);
const scripts = [...listBody.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => abs(m[1], LIST)).filter(Boolean);
const usedScripts = scripts.filter((url) => /used-cars|chunks\/app/i.test(url));
const output = {
  generatedAt: new Date().toISOString(),
  list: { status: listRes.status, bytes: listBody.length, idCount: idsOf(listBody).length, endpointCandidates: endpointCandidates(listBody), apiContexts: contextsAround(listBody, ['globalapi.che168.com', 'ssrApiParamsSnapshot', 'pageindex', 'pagesize'], 1300, 4), scripts: usedScripts },
  bundles: [],
};
for (const url of usedScripts) {
  try {
    const { res, body } = await get(url, LIST);
    const interesting = /globalapi\.che168\.com|pageindex|pagesize|usedcar|vehiclelist|carlist|fromsource|api\//i.test(body);
    if (!interesting) continue;
    output.bundles.push({
      url, status: res.status, bytes: body.length,
      endpointCandidates: endpointCandidates(body),
      contexts: contextsAround(body, ['globalapi.che168.com', 'pageindex', 'pagesize', 'vehicle_list', 'fromsource', 'fetch(', 'axios', '/api/'], 1600, 8).map((row) => ({ term: row.term, context: row.context.slice(0, 5000) })),
    });
  } catch (error) { output.bundles.push({ url, error: String(error?.message || error) }); }
}
await fs.writeFile('che168-global-exact-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
