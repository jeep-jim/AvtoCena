import fs from 'node:fs/promises';

const BASE = 'https://www.auctiondatasearch.jp';
const OUT = 'auctiondatasearch-auth-contract-probe.json';
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};

function clean(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function absolute(value, base = BASE) {
  try { return new URL(String(value || ''), base).toString(); } catch { return ''; }
}

function anchors(markup, base) {
  const rows = [];
  for (const match of markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absolute(match[1], base);
    if (!href) continue;
    rows.push({ href, text: clean(match[2]).slice(0, 120) });
  }
  return [...new Map(rows.map((row) => [row.href, row])).values()];
}

function scripts(markup, base) {
  const urls = [];
  for (const match of markup.matchAll(/<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(match[1], base);
    if (url && new URL(url).hostname.endsWith('auctiondatasearch.jp')) urls.push(url);
  }
  return [...new Set(urls)];
}

async function fetchText(url, redirect = 'follow') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect, signal: controller.signal });
    const text = await response.text();
    return {
      requestedUrl: url,
      status: response.status,
      finalUrl: response.url || url,
      location: response.headers.get('location') || '',
      contentType: response.headers.get('content-type') || '',
      bytes: Buffer.byteLength(text),
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(result) {
  const visible = clean(result.text);
  return {
    requestedUrl: result.requestedUrl,
    status: result.status,
    finalUrl: result.finalUrl,
    location: result.location,
    contentType: result.contentType,
    bytes: result.bytes,
    markers: {
      login: /\blogin\b/i.test(visible),
      username: /username/i.test(visible),
      password: /password/i.test(visible),
      register: /register/i.test(visible),
      japanAuctions: /Japan Auctions/i.test(visible),
      statistics: /Statistics/i.test(visible),
      soldPrices: /sold prices|sold vehicles/i.test(visible),
      currentVehicles: /Current Vehicles/i.test(visible),
      vehicleCount: /[0-9][0-9,]{3,}\s+vehicles/i.test(visible),
    },
    textSample: visible.slice(0, 900),
  };
}

const paths = ['/', '/search/', '/statistics/', '/current_vehicles_counts_by_maker/'];
const pages = {};
for (const path of paths) {
  const url = new URL(path, BASE).toString();
  const manual = await fetchText(url, 'manual');
  const followed = await fetchText(url, 'follow');
  pages[path] = {
    manual: summarize(manual),
    followed: summarize(followed),
    anchors: anchors(followed.text, followed.finalUrl).filter((row) => /auction|search|statistic|vehicle|account|login/i.test(`${row.href} ${row.text}`)).slice(0, 80),
    scripts: scripts(followed.text, followed.finalUrl),
  };
}

const scriptUrls = [...new Set(Object.values(pages).flatMap((page) => page.scripts))].slice(0, 30);
const scriptContracts = [];
for (const url of scriptUrls) {
  try {
    const result = await fetchText(url, 'follow');
    if (result.status !== 200 || result.bytes > 2_000_000) continue;
    const endpoints = [...new Set([
      ...result.text.matchAll(/["'`](\/[A-Za-z0-9_.\-/]*(?:search|statistic|vehicle|auction|current|maker)[A-Za-z0-9_.\-/?=&%]*)["'`]/gi),
    ].map((match) => match[1]))].slice(0, 120);
    if (endpoints.length) scriptContracts.push({ url, status: result.status, bytes: result.bytes, endpoints });
  } catch (error) {
    scriptContracts.push({ url, error: String(error?.message || error) });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'auctiondatasearch_public_auth_contract_probe_no_publish',
  pages,
  scriptContracts,
  conclusion: {
    searchRedirectsToLogin: /\/accounts\/login\//i.test(pages['/search/']?.followed?.finalUrl || ''),
    statisticsRedirectsToLogin: /\/accounts\/login\//i.test(pages['/statistics/']?.followed?.finalUrl || ''),
    publicRootHasInventoryCountButNoVerifiedOfferFeed: pages['/']?.followed?.markers?.vehicleCount === true,
  },
};

await fs.writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
