import fs from 'node:fs/promises';

process.env.CATALOG_RAW_LISTING_MODE = '1';
process.env.CATALOG_KNOWLEDGE_DISABLED = '1';
process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS ||= '30000';
process.env.CATALOG_GALLERY_TIMEOUT_MS ||= '30000';

const { catalogImportSources } = await import('../apps/web/lib/catalog/importer.ts');

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.8,zh-CN;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
const BLOCK_RE = /captcha|cloudflare|access denied|request blocked|verify you are human|forbidden|incapsula|imperva|pardon our interruption|request unsuccessful|robot check/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const MONEY_RE = /(?:¥|￥|JPY|CNY|RMB|元|万円|万|円|price|start|sold|result|final|落札|成約|売切)/i;
const DETAIL_PATTERNS = [
  /\/dealer\/\d+\/\d+\.html/gi,
  /\/spec\/\d+/gi,
  /\/usedcar\/\d+/gi,
  /\/car\/\d+/gi,
  /\/auction\/past\/detail\/\d+/gi,
];

function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function titleOf(html) {
  return clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 240);
}
function countMatches(html, re) {
  return new Set([...html.matchAll(re)].map((m) => m[0])).size;
}
function itemSummary(item) {
  if (!item || typeof item !== 'object') return { type: typeof item, value: String(item).slice(0, 300) };
  const keys = Object.keys(item).slice(0, 80);
  const selected = {};
  for (const key of keys) {
    if (!/(?:id|url|href|link|title|name|maker|make|model|year|date|lot|status|price|cost|amount|image|photo|grade|mileage|engine|currency|r$|rtotal)/i.test(key)) continue;
    const value = item[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') selected[key] = String(value).slice(0, 500);
    else if (Array.isArray(value)) selected[key] = { type: 'array', length: value.length, sample: value.slice(0, 3).map((row) => typeof row === 'string' ? row.slice(0, 300) : Object.keys(row || {}).slice(0, 20)) };
    else if (value && typeof value === 'object') selected[key] = { type: 'object', keys: Object.keys(value).slice(0, 40) };
  }
  return { keys, selected };
}
function normalizedDeficits(offer) {
  if (!offer) return ['normalize_null'];
  const deficits = [];
  if (!offer.id) deficits.push('id');
  if (!offer.sourceId) deficits.push('sourceId');
  if (!offer.sourceOfferId) deficits.push('sourceOfferId');
  if (!clean(offer.sourceTitle || offer?.operational?.sourceTitle || `${offer.make || ''} ${offer.model || ''}`)) deficits.push('title');
  if (!Number(offer.year)) deficits.push('year');
  if (!(Number(offer.sourcePrice) > 0)) deficits.push('sourcePrice');
  if (!clean(offer.sourceCurrency)) deficits.push('sourceCurrency');
  if (!/^https?:\/\//i.test(clean(offer?.operational?.sourceUrl))) deficits.push('sourceUrl');
  return deficits;
}
async function fetchText(url, referer = '') {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...(referer ? { referer } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  return { response, body };
}
function pageSummary(url, response, body) {
  const detailCounts = DETAIL_PATTERNS.map((pattern) => countMatches(body, pattern));
  const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 20);
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((x) => !x.startsWith('#')).slice(0, 30);
  return {
    url,
    finalUrl: response.url,
    status: response.status,
    bytes: body.length,
    contentType: response.headers.get('content-type') || '',
    title: titleOf(body),
    blocked: BLOCK_RE.test(body.slice(0, 20_000)),
    hasYear: YEAR_RE.test(body),
    hasMoneyMarkers: MONEY_RE.test(body),
    detailCounts,
    hasNextData: /__NEXT_DATA__/i.test(body),
    hasNextFlight: /self\.__next_f\.push/i.test(body),
    hasNuxt: /__NUXT__/i.test(body),
    scripts,
    links,
  };
}
function contextSnippets(html, terms) {
  const text = clean(html);
  const lower = text.toLocaleLowerCase('en-US');
  const out = [];
  for (const term of terms) {
    const index = lower.indexOf(term.toLocaleLowerCase('en-US'));
    if (index < 0) continue;
    out.push(text.slice(Math.max(0, index - 180), Math.min(text.length, index + 420)));
    if (out.length >= 12) break;
  }
  return [...new Set(out)];
}
function imageUrls(html, base) {
  const values = [];
  for (const match of html.matchAll(/(?:src|data-src|data-original|content)=["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) values.push(match[1]);
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, '/'));
  const result = [];
  for (const value of values) {
    try {
      const url = new URL(value.replace(/&amp;/g, '&'), base).toString();
      if (/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code/i.test(url)) continue;
      result.push(url);
    } catch {}
  }
  return [...new Set(result)];
}

const result = {
  generatedAt: new Date().toISOString(),
  mode: 'non_publishing_source_structure_probe',
  adapters: {},
  http: {},
};

const adapterIds = [
  'jpauc_japan_past_open',
  'carvector_japan_stat_open',
  'prestige_japan_auctions_open',
  'auctiondatasearch_japan_open',
  'jpcenter_japan_catalog_open',
  'autohome_used_china_open',
  'dongchedi_china_open',
  'autohome_new_china_open',
];

for (const sourceId of adapterIds) {
  const source = catalogImportSources.find((row) => row.sourceId === sourceId);
  if (!source) {
    result.adapters[sourceId] = { error: 'adapter_missing' };
    continue;
  }
  try {
    const page = await source.fetchPage(null);
    const items = Array.isArray(page?.items) ? page.items : [];
    const samples = [];
    for (const raw of items.slice(0, 3)) {
      let normalized = null;
      let normalizeError = '';
      try { normalized = source.normalizeOffer(raw); } catch (error) { normalizeError = String(error?.message || error); }
      samples.push({
        raw: itemSummary(raw),
        normalizeError,
        normalized: normalized ? {
          id: normalized.id,
          sourceOfferId: normalized.sourceOfferId,
          sourceTitle: normalized.sourceTitle,
          make: normalized.make,
          model: normalized.model,
          year: normalized.year,
          sourcePrice: normalized.sourcePrice,
          sourceCurrency: normalized.sourceCurrency,
          priceMode: normalized.priceMode,
          sourceUrl: normalized?.operational?.sourceUrl,
          imageCount: Array.isArray(normalized.images) ? normalized.images.length : 0,
          catalogKind: normalized.catalogKind,
          sourceStatus: normalized?.operational?.sourceStatus,
          deficits: normalizedDeficits(normalized),
        } : null,
      });
    }
    result.adapters[sourceId] = {
      ok: true,
      count: page?.count ?? items.length,
      itemCount: items.length,
      finished: Boolean(page?.finished),
      nextCursor: page?.nextCursor ?? null,
      health: page?.health ?? null,
      samples,
    };

    if (sourceId === 'jpauc_japan_past_open') {
      const details = [];
      for (const raw of items.slice(0, 3)) {
        const detailUrl = raw?.detailUrl;
        if (!detailUrl) continue;
        try {
          const { response, body } = await fetchText(detailUrl, 'https://jpauc.com/auction/past');
          details.push({
            dataId: raw?.dataId,
            detailUrl,
            status: response.status,
            bytes: body.length,
            title: titleOf(body),
            snippets: contextSnippets(body, ['result', 'sold', 'final', 'price', 'start', 'status', '落札', '成約', '売切', '開始', '価格']),
            imageCount: imageUrls(body, detailUrl).length,
            imageSample: imageUrls(body, detailUrl).slice(0, 8),
          });
        } catch (error) {
          details.push({ dataId: raw?.dataId, detailUrl, error: String(error?.message || error) });
        }
      }
      result.adapters[sourceId].detailProbe = details;
    }
  } catch (error) {
    result.adapters[sourceId] = { ok: false, error: String(error?.message || error) };
  }
}

const candidates = {
  che168: [
    'https://global.che168.com/en',
    'https://global.che168.com/en/used-cars',
    'https://www.che168.com/china/list/',
    'https://www.che168.com/china/a0_0msdgscncgpi1ltocsp1exx0/',
    'https://s.che168.com/',
  ],
  autohome: [
    'https://www.autohome.com.cn/',
    'https://car.autohome.com.cn/',
    'https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-1.html',
    'https://www.autohome.com.cn/grade/carhtml/',
  ],
  dongchedi: [
    'https://www.dongchedi.com/',
    'https://www.dongchedi.com/usedcar',
    'https://www.dongchedi.com/usedcar/sale',
    'https://www.dongchedi.com/auto/library/x-x-x-x-x-x-x-x-x-x-x',
  ],
  japan: [
    'https://jpauc.com/auction/past',
    'https://carvector.com/stat',
    'https://prestigemotorsport.com.au/auctions/',
    'https://www.auctiondatasearch.jp/',
    'https://jp.center/',
  ],
};

for (const [group, urls] of Object.entries(candidates)) {
  result.http[group] = [];
  for (const url of urls) {
    try {
      const { response, body } = await fetchText(url);
      result.http[group].push(pageSummary(url, response, body));
    } catch (error) {
      result.http[group].push({ url, error: String(error?.message || error) });
    }
  }
}

await fs.writeFile('catalog-source-structure-probe.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  generatedAt: result.generatedAt,
  adapters: Object.fromEntries(Object.entries(result.adapters).map(([id, row]) => [id, { ok: row.ok, itemCount: row.itemCount, error: row.error, samples: row.samples?.map((s) => s.normalized) }])),
  http: Object.fromEntries(Object.entries(result.http).map(([group, rows]) => [group, rows.map((row) => ({ url: row.url, finalUrl: row.finalUrl, status: row.status, bytes: row.bytes, title: row.title, blocked: row.blocked, detailCounts: row.detailCounts, error: row.error }))])),
}, null, 2));
