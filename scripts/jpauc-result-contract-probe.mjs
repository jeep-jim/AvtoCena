import fs from 'node:fs/promises';

const BASE = 'https://jpauc.com';
const PAST = `${BASE}/auction/past`;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
let cookie = '';
function clean(value) { return String(value ?? '').replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function abs(value, base = BASE) { try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; } }
function checkbox(html, name) { const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return [...html.matchAll(new RegExp(`name=["']${e}["'][^>]*value=["']([^"']+)["']`, 'gi'))].map(m => m[1]); }
async function request(url, options = {}) {
  const res = await fetch(url, { method: options.method || 'GET', body: options.body, redirect: 'follow', headers: { ...HEADERS, ...(cookie ? { cookie } : {}), ...(options.referer ? { referer: options.referer } : {}), ...(options.accept ? { accept: options.accept } : {}), ...(options.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } : {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (!cookie) cookie = String(res.headers.get('set-cookie') || '').split(';')[0];
  return { res, body };
}
function listingRows(html) {
  return [...html.matchAll(/<tr\b([^>]*)data-id=["'](\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi)].slice(0, 5).map(m => {
    const attrs = `${m[1]} data-id="${m[2]}" ${m[3]}`;
    const cells = [...m[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1]));
    const r = attrs.match(/data-r=["']([^"']+)["']/i)?.[1] || '1';
    const rtotal = attrs.match(/data-r-total=["']([^"']+)["']/i)?.[1] || '1';
    return { dataId: m[2], r, rtotal, cells, detailUrl: `${PAST}/detail/${m[2]}?&ys=1900&ye=2100&mm=0&mx=9999&p=1&ob=none&r=0&r=${encodeURIComponent(r)}&rtotal=${encodeURIComponent(rtotal)}` };
  });
}
function contexts(body, terms, radius = 1500, maxPer = 8) {
  const out = []; const lower = body.toLowerCase();
  for (const term of terms) { let from = 0; let count = 0; while (count < maxPer) { const i = lower.indexOf(term.toLowerCase(), from); if (i < 0) break; out.push({ term, context: body.slice(Math.max(0, i-radius), Math.min(body.length, i+radius)) }); from = i + term.length; count++; } }
  return out;
}
function endpoints(body, base) {
  const vals = [];
  for (const m of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi)) vals.push(m[0].replace(/\\\//g, '/'));
  for (const m of body.matchAll(/["'`](\/[^"'`]*(?:auction|past|result|history|detail|api|ajax|bid|lot)[^"'`]*)["'`]/gi)) vals.push(m[1].replace(/\\\//g, '/'));
  return [...new Set(vals.map(v => abs(v, base)).filter(v => /^https?:/i.test(v)))].slice(0, 200);
}
function scriptUrls(html, base) { return [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => abs(m[1], base)).filter(Boolean))]; }
function historyVin(html) {
  return html.match(/id=["']viewhistory["'][^>]*data-vin=["']([^"']+)["']/i)?.[1]
    || html.match(/data-vin=["']([^"']+)["'][^>]*id=["']viewhistory["']/i)?.[1]
    || '';
}
function jsonParse(body) { try { return JSON.parse(body); } catch { return null; } }
function summarizeHistory(value) {
  if (!Array.isArray(value)) return { type: typeof value, value };
  return {
    count: value.length,
    rows: value.slice(0, 20).map((item) => ({
      keys: item && typeof item === 'object' ? Object.keys(item) : [],
      lot_date: item?.lot_date,
      auction_name: item?.auction_name,
      auct_system_ref: item?.auct_system_ref,
      end_price_en: item?.end_price_en,
      result_en: item?.result_en,
      lot_no: item?.lot_no ?? item?.lot_number,
      id: item?.id ?? item?.data_id ?? item?.auction_id,
      vin: item?.vin ?? item?.frame ?? item?.chassis,
      model: item?.model ?? item?.model_name,
      grade: item?.grade_en ?? item?.grade,
      mileage: item?.mileage ?? item?.km,
      image: item?.image ?? item?.image_url ?? item?.auction_sheet_url,
    })),
  };
}

const initial = await request(PAST, { referer: `${BASE}/auction` });
const dates = checkbox(initial.body, 'checkdate[]');
if (!dates[0]) throw new Error('no_past_date');
const maker = await request(PAST, { method: 'POST', body: new URLSearchParams([['checkdate[]', dates[0]], ['submit', 'submitauction']]).toString(), referer: PAST });
const makers = checkbox(maker.body, 'mk[]');
if (!makers.length) throw new Error('no_makers');
const makerBody = new URLSearchParams(); makers.forEach(v => makerBody.append('mk[]', v));
const model = await request(maker.res.url, { method: 'POST', body: makerBody.toString(), referer: maker.res.url });
const models = checkbox(model.body, 'md[]');
if (!models.length) throw new Error('no_models');
const modelBody = new URLSearchParams(); models.forEach(v => modelBody.append('md[]', v));
const listing = await request(model.res.url, { method: 'POST', body: modelBody.toString(), referer: model.res.url });
const rows = listingRows(listing.body);

const output = { generatedAt: new Date().toISOString(), selectedDate: dates[0], listing: { status: listing.res.status, url: listing.res.url, bytes: listing.body.length, rows }, details: [] };
for (const row of rows.slice(0, 3)) {
  const detail = await request(row.detailUrl, { referer: listing.res.url });
  const scripts = scriptUrls(detail.body, detail.res.url);
  const vin = historyVin(detail.body);
  const record = {
    dataId: row.dataId, detailUrl: row.detailUrl, status: detail.res.status, finalUrl: detail.res.url, bytes: detail.body.length,
    historyVin: vin,
    visibleText: clean(detail.body).slice(0, 12000),
    htmlContexts: contexts(detail.body, ['end_price', 'result_en', 'start_price', 'result', 'sold', 'unsold', 'price', 'status', 'aleado', 'data-id', 'data-r', 'rtotal', 'data-vin'], 1100, 4).map(r => ({ term: r.term, context: r.context.slice(0, 4500) })),
    endpoints: endpoints(detail.body, detail.res.url), scripts, history: null, scriptContexts: [],
  };
  if (vin) {
    const historyUrl = `${BASE}/API/auction/history/${encodeURIComponent(vin)}`;
    try {
      const history = await request(historyUrl, { referer: detail.res.url, accept: 'application/json,text/plain,*/*' });
      record.history = { url: historyUrl, status: history.res.status, contentType: history.res.headers.get('content-type') || '', bytes: history.body.length, preview: history.body.slice(0, 1500), summary: summarizeHistory(jsonParse(history.body)) };
    } catch (error) {
      record.history = { url: historyUrl, error: String(error?.message || error) };
    }
  }
  for (const script of scripts) {
    try {
      const js = await request(script, { referer: detail.res.url });
      if (!/end_price|result_en|start_price|auction\/past|aleado|rtotal|data-r|history|result/i.test(js.body)) continue;
      record.scriptContexts.push({ url: script, status: js.res.status, bytes: js.body.length, endpoints: endpoints(js.body, script), contexts: contexts(js.body, ['end_price_en', 'end_price', 'result_en', 'result', 'start_price', 'auction/past', 'history', 'aleado', 'rtotal'], 1800, 8).map(r => ({ term: r.term, context: r.context.slice(0, 6500) })) });
    } catch (error) { record.scriptContexts.push({ url: script, error: String(error?.message || error) }); }
  }
  output.details.push(record);
}
await fs.writeFile('jpauc-result-contract-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ generatedAt: output.generatedAt, selectedDate: output.selectedDate, listing: output.listing, details: output.details.map(d => ({ dataId: d.dataId, status: d.status, finalUrl: d.finalUrl, historyVin: d.historyVin, history: d.history, endpoints: d.endpoints })) }, null, 2));
