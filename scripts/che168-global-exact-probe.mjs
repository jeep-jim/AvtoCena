import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const BASE = 'https://global.che168.com';
const API = 'https://globalapi.che168.com';
const LIST = `${BASE}/en/used-cars`;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.7',
  'cache-control': 'no-cache', pragma: 'no-cache',
  origin: BASE,
  referer: `${BASE}/en/used-cars`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
function abs(value, base = BASE) { try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; } }
async function get(url, referer = LIST, accept = HEADERS.accept) { const res = await fetch(url, { headers: { ...HEADERS, referer, accept }, redirect: 'follow', signal: AbortSignal.timeout(30_000) }); return { res, body: await res.text() }; }
function idsOf(body) { return [...new Set([...body.matchAll(/\/en\/detail\/(\d+)/g)].map((m) => m[1]))]; }
function contextsAround(body, terms, radius = 1600, maxPer = 12) {
  const out = []; const lower = body.toLowerCase();
  for (const term of terms) { let from = 0; let n = 0; while (n < maxPer) { const index = lower.indexOf(term.toLowerCase(), from); if (index < 0) break; out.push({ term, context: body.slice(Math.max(0, index - radius), Math.min(body.length, index + radius)) }); from = index + term.length; n++; } }
  return out;
}
function endpointCandidates(body) {
  const values = [];
  for (const match of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi)) values.push(match[0].replace(/\\\//g, '/'));
  for (const match of body.matchAll(/["'`](\/[^"'`]*(?:api|search|used-car|usedcar|list|query|filter|vehicle|carinfo)[^"'`]*)["'`]/gi)) values.push(match[1].replace(/\\\//g, '/'));
  return [...new Set(values.map((v) => v.replace(/\\u0026/g, '&')).filter((v) => /globalapi|api|search|used-car|usedcar|vehicle|carinfo|pageindex|pagesize/i.test(v)))].slice(0, 300);
}
function safeJson(body) { try { return JSON.parse(body); } catch { return null; } }
function summarizeJson(json) {
  if (!json || typeof json !== 'object') return null;
  const result = json.result ?? json.data ?? json;
  const keys = Object.keys(json).slice(0, 40);
  const resultKeys = result && typeof result === 'object' ? Object.keys(result).slice(0, 60) : [];
  const arrays = [];
  const walk = (value, path = '', depth = 0) => {
    if (depth > 3 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { arrays.push({ path, length: value.length, sampleKeys: value[0] && typeof value[0] === 'object' ? Object.keys(value[0]).slice(0, 40) : [] }); return; }
    for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(json);
  return { keys, resultKeys, arrays: arrays.slice(0, 20), returncode: json.returncode, message: json.message ?? json.msg ?? json.returnmsg };
}

const { res: listRes, body: listBody } = await get(LIST, `${BASE}/en`);
const scripts = [...new Set([...listBody.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => abs(m[1], LIST)).filter((url) => /\/_next\/static\/chunks\//i.test(url)))];
const output = { generatedAt: new Date().toISOString(), list: { status: listRes.status, bytes: listBody.length, idCount: idsOf(listBody).length, scriptCount: scripts.length }, modules: [], bundles: [], apiProbes: [] };

for (const url of scripts) {
  try {
    const { res, body } = await get(url, LIST);
    if (/53950:function|rh:function|o2:function|Zw:function|_appid|globalapi\.che168\.com/i.test(body)) {
      output.modules.push({ url, status: res.status, bytes: body.length, contexts: contextsAround(body, ['53950:function', 'rh:function', 'o2:function', 'Zw:function', '_appid', 'globalapi.che168.com'], 2200, 8).map((row) => ({ term: row.term, context: row.context.slice(0, 7000) })) });
    }
    const interesting = /globalapi\.che168\.com|pageindex|pagesize|vehicle_list|vehiclelist|carlist|usedcar|fromsource|infoid|\/api\//i.test(body);
    if (interesting) output.bundles.push({ url, status: res.status, bytes: body.length, endpointCandidates: endpointCandidates(body), contexts: contextsAround(body, ['globalapi.che168.com', 'pageindex', 'pagesize', 'vehicle_list', 'vehiclelist', 'carlist', 'infoid', 'fromsource'], 1800, 6).map((row) => ({ term: row.term, context: row.context.slice(0, 5000) })) });
  } catch (error) { output.bundles.push({ url, error: String(error?.message || error) }); }
}

const deviceid = crypto.randomUUID();
const baseParams = { language: 'en', pageindex: '1', pagesize: '24', sort: '0', vehicle_list: '0', fromsource: '0', deviceid };
const appCandidates = [null, 'g', 'global.m', '2046', '123', '1211123'];
for (const appid of appCandidates) {
  const params = new URLSearchParams(baseParams);
  if (appid) params.set('_appid', appid);
  const url = `${API}/api/v1/search?${params.toString()}`;
  try {
    const { res, body } = await get(url, LIST, 'application/json,text/plain,*/*');
    output.apiProbes.push({ kind: 'search', appid, url, status: res.status, contentType: res.headers.get('content-type') || '', bytes: body.length, preview: body.slice(0, 1500), json: summarizeJson(safeJson(body)) });
  } catch (error) { output.apiProbes.push({ kind: 'search', appid, url, error: String(error?.message || error) }); }
}
const sampleId = idsOf(listBody)[0];
if (sampleId) {
  for (const appid of [null, 'g', 'global.m']) {
    const params = new URLSearchParams({ language: 'en', fromsource: '0', deviceid });
    if (appid) params.set('_appid', appid);
    const url = `${API}/api/v1/carinfo/${sampleId}?${params.toString()}`;
    try {
      const { res, body } = await get(url, `${BASE}/en/detail/${sampleId}`, 'application/json,text/plain,*/*');
      output.apiProbes.push({ kind: 'detail', appid, sampleId, url, status: res.status, contentType: res.headers.get('content-type') || '', bytes: body.length, preview: body.slice(0, 1500), json: summarizeJson(safeJson(body)) });
    } catch (error) { output.apiProbes.push({ kind: 'detail', appid, sampleId, url, error: String(error?.message || error) }); }
  }
}
await fs.writeFile('che168-global-exact-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ generatedAt: output.generatedAt, list: output.list, modules: output.modules, apiProbes: output.apiProbes }, null, 2));
