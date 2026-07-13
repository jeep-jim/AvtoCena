import fs from 'node:fs';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

const sources = JSON.parse(fs.readFileSync('data/catalog/sources/sources.json','utf8'));
const timeoutMs = Number(process.env.CATALOG_PROBE_TIMEOUT_MS || 6000);
const concurrency = Number(process.env.CATALOG_PROBE_CONCURRENCY || 2);
const delayMs = Number(process.env.CATALOG_PROBE_DELAY_MS || 500);
const now = new Date().toISOString();
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

function headOrGet(url, method='GET') {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok:false, error:'missing_url' });
    const started = Date.now();
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ ok:false, error:'invalid_url' }); }
    const lib = parsed.protocol === 'http:' ? httpRequest : request;
    const req = lib(url, { method, timeout: timeoutMs, headers: { 'User-Agent': 'AvtoCenaCatalogProbe/1.0 (+manual source review; no scraping)' } }, (res) => {
      let bytes = 0; let text = '';
      res.on('data', chunk => { bytes += chunk.length; if (text.length < 8192) text += chunk.toString('utf8'); if (bytes > 16384) req.destroy(); });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, contentType: res.headers['content-type'] || '', bytes, responseMs: Date.now()-started, text }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, error:'timeout', responseMs: Date.now()-started }); });
    req.on('error', err => resolve({ ok:false, error: err.code || err.message, responseMs: Date.now()-started }));
    req.end();
  });
}

function analyzeHtml(text='') {
  const lower = text.toLowerCase();
  return {
    requiresJavascript: /<noscript|__next_data__|window\.__|enable javascript|id="app"|captcha/.test(lower),
    hasTermsLink: /terms|condition|услов|oferta|privacy|legal|regulamin/.test(lower),
    hasJsonHint: /application\/json|__next_data__|api\//.test(lower),
    blocked: /captcha|access denied|forbidden|too many requests|robot/.test(lower)
  };
}

async function probeOne(source) {
  await sleep(delayMs);
  const catalog = await headOrGet(source.catalogUrl);
  const robots = await headOrGet(source.robotsUrl);
  const terms = source.termsUrl ? await headOrGet(source.termsUrl, 'GET') : { ok:false, error:'missing_terms_url' };
  const detail = source.sampleListingUrl ? await headOrGet(source.sampleListingUrl) : { ok:false, error:'missing_sample_listing_url' };
  const html = analyzeHtml(String(catalog.text || '') + String(detail.text || ''));
  const blocked = catalog.status === 401 || catalog.status === 403 || catalog.status === 429 || detail.status === 401 || detail.status === 403 || detail.status === 429 || html.blocked;
  return {
    sourceId: source.id,
    market: source.market,
    probedAt: now,
    catalog: { url: source.catalogUrl, status: catalog.status || null, contentType: catalog.contentType || null, responseMs: catalog.responseMs || null, error: catalog.error || null },
    robots: { url: source.robotsUrl, status: robots.status || null, present: Boolean(robots.status && robots.status < 400), error: robots.error || null },
    terms: { url: source.termsUrl, status: terms.status || null, present: Boolean(terms.status && terms.status < 400) || html.hasTermsLink, error: terms.error || null },
    detail: { url: source.sampleListingUrl || '', status: detail.status || null, contentType: detail.contentType || null, responseMs: detail.responseMs || null, error: detail.error || null },
    requiresJavascript: source.requiresJavascript || html.requiresJavascript,
    publicJsonHint: html.hasJsonHint,
    captchaOrBlocked: blocked,
    directImageProbe: { attempted: false, reason: 'image URL is source-specific; adapter must extract at most one direct image first' },
    allowedForAutomation: false,
    statusRecommendation: source.requiresPartnerAgreement ? 'requires_agreement' : blocked ? 'blocked' : source.mode === 'manual_json' || source.mode === 'manual_csv' ? 'operational_manual' : 'awaiting_review'
  };
}

const results = [];
for (let i=0; i<sources.length; i+=concurrency) {
  const batch = sources.slice(i, i+concurrency);
  const settled = await Promise.all(batch.map((source)=>probeOne(source).catch((error)=>({ sourceId:source.id, market:source.market, probedAt:now, error:String(error), statusRecommendation:'awaiting_review' }))));
  results.push(...settled);
}
fs.writeFileSync('data/catalog/sources/probe-results.json', JSON.stringify({ updatedAt: now, timeoutMs, concurrency, delayMs, results }, null, 2));
console.log(JSON.stringify({ probed: results.length, updatedAt: now }, null, 2));
