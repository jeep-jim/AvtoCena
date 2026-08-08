import fs from 'node:fs/promises';

const LIST = 'https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-1.html';
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'cache-control': 'no-cache', pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
function abs(value, base) { try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; } }
function clean(value) { return String(value ?? '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
async function get(url, referer = 'https://www.autohome.com.cn/') {
  const res = await fetch(url, { headers: { ...HEADERS, referer }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const charset = ct.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase() || (bytes.slice(0, 500).toString().includes('gb2312') ? 'gb18030' : 'utf-8');
  let body;
  try { body = new TextDecoder(/gb|gbk/i.test(charset) ? 'gb18030' : 'utf-8').decode(bytes); }
  catch { body = new TextDecoder('utf-8').decode(bytes); }
  return { res, body, byteLength: bytes.byteLength, charset };
}
function idsOf(html) { return [...new Set([...html.matchAll(/(?:https?:)?\/\/www\.autohome\.com\.cn\/spec\/(\d+)|\/spec\/(\d+)/gi)].map(m => m[1] || m[2]).filter(Boolean))]; }
function links(html, base, re) { return [...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m => abs(m[1], base)).filter(url => url && re.test(url)))].slice(0, 100); }
function images(html, base) {
  const values = [];
  for (const m of html.matchAll(/(?:src|data-src|data-original|data-src2|content)=["']([^"']+)["']/gi)) if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(m[1])) values.push(m[1]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(m[0].replace(/\\\//g, '/'));
  return [...new Set(values.map(v => abs(v, base)).filter(url => /^https?:/i.test(url) && !/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|qrcode/i.test(url)))];
}
function contexts(html, terms, radius = 1200, maxPer = 5) { const out = []; const lower = html.toLowerCase(); for (const term of terms) { let pos = 0, n = 0; while (n < maxPer) { const i = lower.indexOf(term.toLowerCase(), pos); if (i < 0) break; out.push({ term, context: clean(html.slice(Math.max(0, i-radius), Math.min(html.length, i+radius))).slice(0, 4000) }); pos = i + term.length; n++; } } return out; }
function endpoints(html, base) { const vals = []; for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi)) vals.push(m[0].replace(/\\\//g, '/')); for (const m of html.matchAll(/["'`](\/[^"'`]*(?:api|config|spec|pic|photo|series|price|param)[^"'`]*)["'`]/gi)) vals.push(m[1]); return [...new Set(vals.map(v => abs(v, base)).filter(v => /autohome|autoimg/i.test(v)))].slice(0, 200); }

const list = await get(LIST);
const allIds = idsOf(list.body);
const sampleIds = allIds.slice(0, 3);
const output = {
  generatedAt: new Date().toISOString(),
  list: { status: list.res.status, finalUrl: list.res.url, bytes: list.byteLength, charset: list.charset, title: clean(list.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), specCount: allIds.length, sampleIds, specLinks: links(list.body, list.res.url, /\/spec\/\d+/i).slice(0, 20), contexts: contexts(list.body, ['指导价', '厂商指导价', '万', 'spec/', 'price', '车型', '2026', '2025'], 900, 3) },
  specs: [],
};

for (const id of sampleIds) {
  const candidates = [
    `https://www.autohome.com.cn/spec/${id}/`,
    `https://car.autohome.com.cn/config/spec/${id}.html`,
    `https://car.autohome.com.cn/pic/spec${id}.html`,
    `https://car.autohome.com.cn/duibi/chexing/carids=${id}`,
  ];
  const record = { id, pages: [] };
  for (const url of candidates) {
    try {
      const page = await get(url, LIST);
      const imgs = images(page.body, page.res.url);
      record.pages.push({ url, status: page.res.status, finalUrl: page.res.url, bytes: page.byteLength, charset: page.charset, title: clean(page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), imageCount: imgs.length, imageSample: imgs.slice(0, 20), links: links(page.body, page.res.url, /(?:\/spec\/\d+|\/config\/|\/pic\/|photo|image)/i).slice(0, 30), contexts: contexts(page.body, ['指导价', '厂商指导价', '万', '发动机', '最大功率', '最大扭矩', '变速箱', '驱动方式', '车身结构', '燃料形式', '能源类型', '图片', 'param', 'specId', 'specid'], 1200, 4), endpoints: endpoints(page.body, page.res.url) });
    } catch (error) { record.pages.push({ url, error: String(error?.message || error) }); }
  }
  output.specs.push(record);
}

await fs.writeFile('autohome-new-structure-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ generatedAt: output.generatedAt, list: { status: output.list.status, bytes: output.list.bytes, charset: output.list.charset, title: output.list.title, specCount: output.list.specCount, sampleIds: output.list.sampleIds }, specs: output.specs.map(s => ({ id: s.id, pages: s.pages.map(p => ({ url: p.url, status: p.status, finalUrl: p.finalUrl, bytes: p.bytes, charset: p.charset, title: p.title, imageCount: p.imageCount, error: p.error })) })) }, null, 2));
