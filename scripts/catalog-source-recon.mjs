import fs from 'node:fs/promises';
import path from 'node:path';

const sourceId = String(process.env.CATALOG_RECON_SOURCE_ID || '').trim();
const outputDir = String(process.env.CATALOG_RECON_OUTPUT_DIR || 'catalog-recon').trim();
const maxBodyBytes = Math.max(100_000, Math.min(4_000_000, Number(process.env.CATALOG_RECON_MAX_BODY_BYTES || 2_500_000)));
const maxScripts = Math.max(0, Math.min(20, Number(process.env.CATALOG_RECON_MAX_SCRIPTS || 12)));
const timeoutMs = Math.max(5_000, Number(process.env.CATALOG_RECON_TIMEOUT_MS || 30_000));

const SOURCES = {
  kcar_korea_open: [
    'https://www.kcar.com/bc/search',
    'https://www.kcar.com/bc/search/carSearchList',
    'https://m.kcar.com/bc/search',
  ],
  autoscout_europe_open: [
    'https://www.autoscout24.com/lst?atype=C&ustate=N%2CU&page=1',
  ],
  mobile_de_open: [
    'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&ref=srpHead&pageNumber=1',
  ],
  dubizzle_uae_open: [
    'https://uae.dubizzle.com/motors/used-cars/?page=1',
    'https://uae.dubizzle.com/en/motors/used-cars/?page=1',
  ],
  myauto_georgia_list: [
    'https://www.myauto.ge/en/main?page=1',
  ],
  autopapa_georgia_open: [
    'https://autopapa.ge/en/search?page=1',
    'https://autopapa.ge/en/cars?page=1',
    'https://autopapa.ge/search?page=1',
  ],
  dongchedi_china_open: [
    'https://www.dongchedi.com/usedcar?page=1',
    'https://www.dongchedi.com/auto/library/x-x-x-x-x-x-x-x-x-x-x?page=1',
  ],
  autohome_used_china_open: [
    'https://www.che168.com/china/list/?page=1',
    'https://www.che168.com/china/a0_0msdgscncgpi1ltocsp1exx0/',
  ],
  autohome_new_china_open: [
    'https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-1.html',
    'https://www.autohome.com.cn/',
  ],
  jpauc_japan_past_open: [
    'https://jpauc.com/auction/past',
    'https://jpauc.com/auction/listing?page=1',
  ],
  carvector_japan_stat_open: [
    'https://carvector.com/stat?page=1',
  ],
  prestige_japan_auctions_open: [
    'https://prestigemotorsport.com.au/auctions/?page=1',
    'https://prestigemotorsport.com.au/japanese-car-auctions/?page=1',
  ],
  auctiondatasearch_japan_open: [
    'https://www.auctiondatasearch.jp/',
    'https://www.auctiondatasearch.jp/search?page=1',
  ],
  jpcenter_japan_catalog_open: [
    'https://jp.center/catalog?lang=en&page=1',
    'https://jp.center/catalog?page=1',
  ],
};

if (!sourceId || !SOURCES[sourceId]) throw new Error(`catalog_recon_unknown_source:${sourceId}`);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const headers = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ru;q=0.8,ko;q=0.7,zh-CN;q=0.6,ja;q=0.5',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'upgrade-insecure-requests': '1',
  'user-agent': UA,
};

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function absolute(value, base) {
  try { return new URL(value.replace(/\\\//g, '/'), base).toString(); } catch { return ''; }
}
function uniq(values, limit = 100) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}
function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);
}
function titleOf(markup) {
  return clean(markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}
function extractHrefs(markup, base) {
  return uniq([...markup.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => absolute(m[1], base)), 250);
}
function extractScripts(markup, base) {
  return uniq([...markup.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => absolute(m[1], base)), 60);
}
function jsonShapePaths(value) {
  const rows = [];
  const seen = new Set();
  let visited = 0;
  const interesting = /(?:listing|offer|vehicle|search|result|inventory|pageProps)/i;
  const visit = (node, path, depth) => {
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 9 || visited++ > 25_000 || rows.length >= 240) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const sample = node.find((item) => item && typeof item === 'object' && !Array.isArray(item));
      const keys = sample ? Object.keys(sample).slice(0, 40) : [];
      if (node.length && (interesting.test(path) || keys.some((key) => /^(?:id|url|vehicle|price|images?|title|make|model)$/i.test(key)))) {
        rows.push({ path, type: 'array', length: node.length, itemKeys: keys });
      }
      node.slice(0, 3).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    const keys = Object.keys(node);
    if (interesting.test(path) || keys.some((key) => /^(?:listings?|offers?|vehicles?|searchResults?|inventory)$/i.test(key))) {
      rows.push({ path, type: 'object', keys: keys.slice(0, 60) });
    }
    for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key, depth + 1);
  };
  visit(value, '$', 0);
  return rows;
}
function extractJsonScripts(markup) {
  const rows = [];
  for (const match of markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();
    if (!body || body.length > 2_500_000) continue;
    if (!/(?:application\/ld\+json|application\/json|__NEXT_DATA__|__NUXT_DATA__|__APOLLO_STATE__|__INITIAL_STATE__)/i.test(`${attrs} ${body.slice(0, 300)}`)) continue;
    const id = clean(attrs.match(/\bid\s*=\s*["']([^"']+)/i)?.[1] || '');
    const type = clean(attrs.match(/\btype\s*=\s*["']([^"']+)/i)?.[1] || '');
    let parsed = null;
    let topKeys = [];
    let shapePaths = [];
    try {
      parsed = JSON.parse(body);
      topKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 80) : [];
      shapePaths = jsonShapePaths(parsed);
    } catch {}
    rows.push({ id, type, bytes: Buffer.byteLength(body), parsed: Boolean(parsed), topKeys, shapePaths, sample: clean(body.slice(0, 1200)) });
    if (rows.length >= 20) break;
  }
  return rows;
}
function extractCandidates(text, base) {
  const urls = [];
  for (const m of text.matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+/gi)) urls.push(m[0].replace(/\\\//g, '/'));
  for (const m of text.matchAll(/["'`](\/(?:api|ajax|graphql|search|cars?|vehicles?|offers?|inventory|listing|list|product|bc)[^"'`<>\s]{2,220})["'`]/gi)) urls.push(absolute(m[1], base));
  return uniq(urls.filter((url) => /api|ajax|graphql|search|car|vehicle|offer|inventory|list|product|auction|detail/i.test(url)), 250);
}
function keywordContexts(text) {
  const keywords = ['__NEXT_DATA__','__NUXT','graphql','apollo','carSeq','carCd','vehicleId','stockNo','inventory','searchList','carSearchList','offers','price','mileage','photos','images','gallery','auction','detail'];
  const rows = [];
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    let from = 0;
    let count = 0;
    while (count < 4) {
      const idx = lower.indexOf(keyword.toLowerCase(), from);
      if (idx < 0) break;
      rows.push({ keyword, context: clean(text.slice(Math.max(0, idx - 260), idx + 620)) });
      from = idx + keyword.length;
      count++;
    }
  }
  return rows.slice(0, 60);
}
async function request(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { ...headers, ...(referer ? { referer } : {}) }, redirect: 'follow', signal: controller.signal });
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.subarray(0, maxBodyBytes).toString('utf8');
    return { response, bytes: bytes.length, body };
  } finally { clearTimeout(timer); }
}

await fs.mkdir(outputDir, { recursive: true });
const report = { sourceId, generatedAt: new Date().toISOString(), probes: [] };

for (let index = 0; index < SOURCES[sourceId].length; index++) {
  const url = SOURCES[sourceId][index];
  const row = { requestUrl: url, index };
  try {
    const { response, bytes, body } = await request(url);
    const finalUrl = response.url || url;
    const hrefs = extractHrefs(body, finalUrl);
    const scripts = extractScripts(body, finalUrl);
    const sameOriginScripts = scripts.filter((script) => {
      try { return new URL(script).origin === new URL(finalUrl).origin; } catch { return false; }
    }).slice(0, maxScripts);
    const scriptReports = [];
    for (const scriptUrl of sameOriginScripts) {
      try {
        const script = await request(scriptUrl, finalUrl);
        scriptReports.push({
          url: scriptUrl,
          status: script.response.status,
          bytes: script.bytes,
          contentType: script.response.headers.get('content-type') || '',
          candidates: extractCandidates(script.body, finalUrl).slice(0, 100),
          contexts: keywordContexts(script.body).slice(0, 20),
        });
      } catch (error) {
        scriptReports.push({ url: scriptUrl, error: String(error?.message || error) });
      }
    }
    const rawPath = path.join(outputDir, `${safeName(sourceId)}-${index}.html`);
    await fs.writeFile(rawPath, body);
    Object.assign(row, {
      status: response.status,
      ok: response.ok,
      finalUrl,
      bytes,
      capturedBytes: Buffer.byteLength(body),
      contentType: response.headers.get('content-type') || '',
      server: response.headers.get('server') || '',
      title: titleOf(body),
      hrefCount: hrefs.length,
      hrefSamples: hrefs.filter((href) => /car|vehicle|offer|detail|auction|stock|inventory|used/i.test(href)).slice(0, 120),
      scriptCount: scripts.length,
      scriptSamples: scripts.slice(0, 60),
      jsonScripts: extractJsonScripts(body),
      candidates: extractCandidates(body, finalUrl),
      contexts: keywordContexts(body),
      scriptReports,
      rawPath,
      prefix: clean(body.slice(0, 2400)),
    });
  } catch (error) {
    row.error = String(error?.message || error);
  }
  report.probes.push(row);
}

const reportPath = path.join(outputDir, `${safeName(sourceId)}.json`);
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  sourceId,
  probes: report.probes.map((row) => ({
    requestUrl: row.requestUrl,
    status: row.status,
    finalUrl: row.finalUrl,
    bytes: row.bytes,
    title: row.title,
    hrefCount: row.hrefCount,
    scriptCount: row.scriptCount,
    candidates: (row.candidates || []).slice(0, 30),
    scriptCandidates: (row.scriptReports || []).flatMap((script) => script.candidates || []).slice(0, 50),
    jsonScripts: row.jsonScripts,
    prefix: row.prefix,
    error: row.error,
  })),
}, null, 2));
