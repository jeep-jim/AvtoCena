import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const BASE = 'https://www.dongchedi.com';
const URLS = [
  `${BASE}/usedcar`,
  `${BASE}/usedcar?page=1`,
  `${BASE}/usedcar/sale`,
  `${BASE}/usedcar/22450156`,
  `${BASE}/news/used`,
  `${BASE}/auto/library/x-x-x-x-x-x-x-x-x-x-x`,
  `${BASE}/auto/library/x-x-x-x-x-x-x-x-x-x-x-x-x-x-x`,
  'https://m.dongchedi.com/usedcar',
];
const H = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};

function clean(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function absolute(value, base = BASE) {
  try { return new URL(String(value).replace(/&amp;/g, '&'), base).toString(); } catch { return ''; }
}
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
async function get(url, referer = BASE) {
  const response = await fetch(url, { headers: { ...H, referer }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  return { response, body };
}
function links(body, base) {
  return [...new Set([...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((match) => absolute(match[1], base)).filter(Boolean))];
}
function endpoints(body, base) {
  const values = [];
  for (const match of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi)) values.push(match[0].replace(/\\\//g, '/'));
  for (const match of body.matchAll(/["'`](\/[^"'`]*(?:api|usedcar|search|list|feed|vehicle|car|series)[^"'`]*)["'`]/gi)) values.push(match[1].replace(/\\\//g, '/'));
  return [...new Set(values.map((value) => absolute(value, base)).filter((value) => /dongchedi|byteimg|snssdk|toutiao/i.test(value)))].slice(0, 400);
}
function contexts(body, terms, radius = 1500, max = 6) {
  const output = [];
  const lower = body.toLowerCase();
  for (const term of terms) {
    let position = 0;
    let count = 0;
    while (count < max) {
      const index = lower.indexOf(term.toLowerCase(), position);
      if (index < 0) break;
      output.push({ term, context: body.slice(Math.max(0, index - radius), Math.min(body.length, index + radius)) });
      position = index + term.length;
      count += 1;
    }
  }
  return output;
}
function pageEvidence(response, body) {
  const visibleText = clean(body);
  return {
    status: response.status,
    finalUrl: response.url,
    bytes: body.length,
    sha256: digest(body),
    contentType: response.headers.get('content-type') || '',
    server: response.headers.get('server') || '',
    title: clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    visiblePrefix: visibleText.slice(0, 1_500),
    hasLogin: /登录|扫码登录|手机号登录|login/i.test(visibleText.slice(0, 5_000)),
    hasCaptcha: /captcha|验证码|verify|secsdk-captcha|verifycenter/i.test(body),
    hasChallenge: /acrawler|byted_acrawler|secsdk|ttwid|verifycenter|访问验证|安全验证/i.test(body),
    hasNextData: /__NEXT_DATA__/i.test(body),
    hasNextFlight: /self\.__next_f\.push/i.test(body),
    hasSSR: /__INITIAL_STATE__|window\._SSR_DATA|SSR_DATA|__NUXT__|RENDER_DATA|UNIVERSAL_DATA/i.test(body),
  };
}

const TERMS = ['usedcar', 'vehicle_id', 'car_id', 'series_id', 'search', 'api/', 'fetch(', 'axios', 'list', 'page_size', 'offset', 'cursor', 'RENDER_DATA', 'UNIVERSAL_DATA'];
const output = { generatedAt: new Date().toISOString(), pages: [], bundles: [] };
const scripts = new Set();

for (const url of URLS) {
  try {
    const { response, body } = await get(url);
    const allLinks = links(body, response.url);
    const scriptUrls = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => absolute(match[1], response.url)).filter(Boolean);
    scriptUrls.forEach((scriptUrl) => scripts.add(scriptUrl));
    output.pages.push({
      url,
      ...pageEvidence(response, body),
      usedcarLinks: allLinks.filter((link) => /\/usedcar\/\d+/i.test(link)).slice(0, 80),
      seriesLinks: allLinks.filter((link) => /\/auto\/series\/\d+/i.test(link)).slice(0, 80),
      endpoints: endpoints(body, response.url),
      contexts: contexts(body, TERMS, 1_200, 6).map((row) => ({ term: row.term, context: row.context.slice(0, 4_800) })),
      scripts: scriptUrls.slice(0, 120),
    });
  } catch (error) {
    output.pages.push({ url, error: String(error?.message || error) });
  }
}

for (const url of [...scripts].slice(0, 160)) {
  try {
    const { response, body } = await get(url, BASE);
    if (!/usedcar|vehicle_id|car_id|series_id|page_size|offset|cursor|search|\/api\/|api\./i.test(body)) continue;
    output.bundles.push({
      url,
      status: response.status,
      bytes: body.length,
      sha256: digest(body),
      endpoints: endpoints(body, url),
      contexts: contexts(body, TERMS, 2_000, 10).map((row) => ({ term: row.term, context: row.context.slice(0, 7_000) })),
    });
  } catch (error) {
    output.bundles.push({ url, error: String(error?.message || error) });
  }
}

await fs.writeFile('dongchedi-structure-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  generatedAt: output.generatedAt,
  pages: output.pages.map((page) => ({
    url: page.url,
    status: page.status,
    finalUrl: page.finalUrl,
    bytes: page.bytes,
    sha256: page.sha256,
    title: page.title,
    hasLogin: page.hasLogin,
    hasCaptcha: page.hasCaptcha,
    hasChallenge: page.hasChallenge,
    hasNextData: page.hasNextData,
    hasNextFlight: page.hasNextFlight,
    hasSSR: page.hasSSR,
    usedcarLinks: page.usedcarLinks?.length,
    seriesLinks: page.seriesLinks?.length,
    endpoints: page.endpoints?.slice(0, 30),
    error: page.error,
  })),
  bundles: output.bundles.map((bundle) => ({ url: bundle.url, status: bundle.status, bytes: bundle.bytes, endpoints: bundle.endpoints?.slice(0, 30), error: bundle.error })),
}, null, 2));
