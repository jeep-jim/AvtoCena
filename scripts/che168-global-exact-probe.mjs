import fs from 'node:fs/promises';

const BASE = 'https://global.che168.com';
const LIST = `${BASE}/en/used-cars`;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
function clean(value) { return String(value ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim(); }
function abs(value, base = BASE) { try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; } }
function images(html, base) {
  const values = [];
  for (const m of html.matchAll(/(?:src|data-src|data-original|content)=["']([^"']+)["']/gi)) if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(m[1])) values.push(m[1]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(m[0].replace(/\\\//g, '/'));
  return [...new Set(values.map((v) => abs(v, base)).filter((v) => v && !/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|qrcode/i.test(v)))];
}
async function get(url, referer = LIST) {
  const res = await fetch(url, { headers: { ...HEADERS, referer }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  return { res, body: await res.text() };
}
function idsOf(body) { return [...new Set([...body.matchAll(/\/en\/detail\/(\d+)/g)].map((m) => m[1]))]; }
function contextsAround(body, terms, radius = 900) {
  const out = [];
  const lower = body.toLowerCase();
  for (const term of terms) {
    let from = 0;
    while (out.length < 40) {
      const index = lower.indexOf(term.toLowerCase(), from);
      if (index < 0) break;
      out.push({ term, context: clean(body.slice(Math.max(0, index - radius), Math.min(body.length, index + radius))).slice(0, 3000) });
      from = index + term.length;
      if (out.filter((row) => row.term === term).length >= 4) break;
    }
  }
  return out;
}
function endpointCandidates(body) {
  const values = [];
  for (const match of body.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)) values.push(match[0].replace(/\\\//g, '/'));
  for (const match of body.matchAll(/["'](\/[^"']*(?:api|search|used-car|usedcar|list|query|filter)[^"']*)["']/gi)) values.push(match[1].replace(/\\\//g, '/'));
  return [...new Set(values.map((v) => v.replace(/\\u0026/g, '&')).filter((v) => /api|search|used-car|usedcar|list|query|filter/i.test(v)))].slice(0, 120);
}
function snippet(html, needle, radius = 3500) {
  const idx = html.indexOf(needle);
  if (idx < 0) return '';
  return clean(html.slice(Math.max(0, idx - radius), Math.min(html.length, idx + radius))).slice(0, 5000);
}
function detailsContext(text) {
  const out = [];
  const terms = ['USD', 'Price', 'Mileage', 'Engine', 'Trans.', 'Drive Train', 'Fuel Type', 'horsepower', ' hp ', 'Model Year'];
  const lower = text.toLowerCase();
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0) out.push(text.slice(Math.max(0, i - 180), Math.min(text.length, i + 500)));
  }
  return [...new Set(out)].slice(0, 16);
}

const { res: listRes, body: listBody } = await get(LIST, `${BASE}/en`);
const allFirstIds = idsOf(listBody);
const ids = allFirstIds.slice(0, 3);
const output = {
  generatedAt: new Date().toISOString(),
  list: {
    status: listRes.status,
    finalUrl: listRes.url,
    bytes: listBody.length,
    title: clean(listBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    ids,
    idCount: allFirstIds.length,
    nextFlight: /self\.__next_f\.push/i.test(listBody),
    samples: ids.map((id) => ({ id, context: snippet(listBody, `/en/detail/${id}`) })),
    dataContractContexts: contextsAround(listBody, ['pageSize', 'pageIndex', 'pageNo', 'pageNum', 'currentPage', 'totalPage', 'totalCount', 'pagination', 'loadMore', 'hasMore', 'usedCarList', 'carList', 'searchParams', '/api/', 'fetch(']),
    endpointCandidates: endpointCandidates(listBody),
    scripts: [...listBody.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => abs(m[1], LIST)).slice(0, 60),
  },
  pagination: [],
  details: [],
};

const pageCandidates = [
  `${LIST}?page=2`, `${LIST}?pageNum=2`, `${LIST}?pageNo=2`, `${LIST}?pageNumber=2`, `${LIST}?currentPage=2`, `${LIST}?p=2`,
  `${LIST}/2`, `${BASE}/en/used-cars/2`,
];
for (const url of pageCandidates) {
  try {
    const { res, body } = await get(url, LIST);
    const pageIds = idsOf(body);
    const overlap = pageIds.filter((id) => allFirstIds.includes(id));
    output.pagination.push({ url, status: res.status, finalUrl: res.url, bytes: body.length, idCount: pageIds.length, firstIds: pageIds.slice(0, 10), overlapWithFirstCount: overlap.length, differentFromFirst: pageIds.length > 0 && pageIds.some((id) => !allFirstIds.includes(id)), nextFlight: /self\.__next_f\.push/i.test(body) });
  } catch (error) { output.pagination.push({ url, error: String(error?.message || error) }); }
}

for (const id of ids) {
  const url = `${BASE}/en/detail/${id}`;
  try {
    const { res, body } = await get(url, LIST);
    const text = clean(body);
    const imgs = images(body, url);
    output.details.push({ id, url, status: res.status, finalUrl: res.url, bytes: body.length, title: clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), nextFlight: /self\.__next_f\.push/i.test(body), contexts: detailsContext(text), imageCount: imgs.length, imageSample: imgs.slice(0, 20), detailIdOccurrences: (body.match(new RegExp(id, 'g')) || []).length, galleryCountMarker: Number(text.match(/\b1\s*\/\s*(\d{1,2})\b/)?.[1] || 0), endpointCandidates: endpointCandidates(body).slice(0, 60) });
  } catch (error) { output.details.push({ id, url, error: String(error?.message || error) }); }
}
await fs.writeFile('che168-global-exact-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ generatedAt: output.generatedAt, list: { status: output.list.status, bytes: output.list.bytes, idCount: output.list.idCount, endpointCandidates: output.list.endpointCandidates, dataContractContexts: output.list.dataContractContexts }, pagination: output.pagination, details: output.details.map((row) => ({ id: row.id, status: row.status, bytes: row.bytes, title: row.title, imageCount: row.imageCount, galleryCountMarker: row.galleryCountMarker, endpointCandidates: row.endpointCandidates })) }, null, 2));
