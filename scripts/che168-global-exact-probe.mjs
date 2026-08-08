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
function clean(value) { return String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim(); }
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
function snippet(html, needle, radius = 3500) {
  const idx = html.indexOf(needle);
  if (idx < 0) return '';
  return clean(html.slice(Math.max(0, idx - radius), Math.min(html.length, idx + radius))).slice(0, 5000);
}
function contexts(text) {
  const out = [];
  const terms = ['USD', 'CNY', 'RMB', '$', 'Price', 'Mileage', 'km', 'Year', 'Engine', 'Displacement', 'Transmission', 'Drive', 'Fuel', 'Power', 'Horsepower', 'kW', 'HP'];
  const lower = text.toLowerCase();
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0) out.push(text.slice(Math.max(0, i - 180), Math.min(text.length, i + 500)));
  }
  return [...new Set(out)].slice(0, 16);
}

const { res: listRes, body: listBody } = await get(LIST, `${BASE}/en`);
const ids = [...new Set([...listBody.matchAll(/\/en\/detail\/(\d+)/g)].map((m) => m[1]))].slice(0, 3);
const output = {
  generatedAt: new Date().toISOString(),
  list: {
    status: listRes.status,
    finalUrl: listRes.url,
    bytes: listBody.length,
    title: clean(listBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    ids,
    nextFlight: /self\.__next_f\.push/i.test(listBody),
    samples: ids.map((id) => ({ id, context: snippet(listBody, `/en/detail/${id}`) })),
  },
  details: [],
};
for (const id of ids) {
  const url = `${BASE}/en/detail/${id}`;
  try {
    const { res, body } = await get(url, LIST);
    const text = clean(body);
    const imgs = images(body, url);
    output.details.push({
      id,
      url,
      status: res.status,
      finalUrl: res.url,
      bytes: body.length,
      title: clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
      nextFlight: /self\.__next_f\.push/i.test(body),
      contexts: contexts(text),
      imageCount: imgs.length,
      imageSample: imgs.slice(0, 20),
      detailIdOccurrences: (body.match(new RegExp(id, 'g')) || []).length,
    });
  } catch (error) {
    output.details.push({ id, url, error: String(error?.message || error) });
  }
}
await fs.writeFile('che168-global-exact-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
