import fs from "node:fs/promises";

const URL = "https://jp.center/";
const RUNTIME_URLS = ["https://jp.center/z_neo1.js"];
const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,ja;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function attrs(tag) {
  const out = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of tag.matchAll(re)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
function around(text, pattern, radius = 1800, max = 20) {
  const found = [];
  const re = new RegExp(pattern, "gi");
  for (const m of text.matchAll(re)) {
    const start = Math.max(0, (m.index || 0) - radius);
    const end = Math.min(text.length, (m.index || 0) + m[0].length + radius);
    found.push({ match: m[0], index: m.index || 0, snippet: text.slice(start, end) });
    if (found.length >= max) break;
  }
  return found;
}
function formBlocks(html) {
  const result = [];
  for (const m of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const block = m[0];
    const tag = block.match(/<form\b[^>]*>/i)?.[0] || "";
    const controls = [];
    for (const c of block.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/gi)) {
      controls.push({ tag: c[0].slice(0, 500), attrs: attrs(c[0]) });
    }
    result.push({ attrs: attrs(tag), tag, controls: controls.slice(0, 120), sample: block.slice(0, 12000) });
  }
  return result.slice(0, 30);
}
function scriptBlocks(html) {
  const result = [];
  let idx = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const body = m[2] || "";
    if (/aj_neo|loader|poisk|model_submit|doLoad|XMLHttpRequest|fetch\s*\(|\.submit\s*\(|FormData|grid_edit|ajax/i.test(body)) {
      result.push({ index: idx, attrs: attrs(`<script ${m[1] || ""}>`), body: body.slice(0, 40000) });
    }
    idx++;
    if (result.length >= 40) break;
  }
  return result;
}

const keywords = [
  "aj_neo\\?file=loader(?:_email)?",
  "function\\s+model_submit",
  "model_submit\\s*=",
  "function\\s+doLoad",
  "doLoad\\s*=",
  "ajx\\.query",
  "_hash2query",
  "url_loader",
  "XMLHttpRequest",
  "fetch\\s*\\(",
  "FormData",
  "poisk",
  "grid_edit",
  "loader_email",
  "file=loader",
  "manuf_str",
  "model_str",
];
function keywordMap(text, radius = 2200) {
  const out = {};
  for (const pattern of keywords) out[pattern] = around(text, pattern, radius, 12);
  return out;
}

async function fetchText(url, accept, referer = URL, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept, referer, ...extraHeaders },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    setCookies: typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [],
    bytes: body.length,
    body,
  };
}
function formHtmlById(html, id) {
  const re = new RegExp(`<form\\b[^>]*\\bid=["']?${id}["']?[^>]*>[\\s\\S]*?<\\/form>`, "i");
  return html.match(re)?.[0] || "";
}
function successfulFormPairs(formHtml) {
  const pairs = [];
  for (const match of formHtml.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    if (!a.name || a.disabled != null) continue;
    const type = String(a.type || "text").toLowerCase();
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type) && a.checked == null) continue;
    pairs.push([a.name, a.value || ""]);
  }
  for (const match of formHtml.matchAll(/<select\b[^>]*name=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = match[1];
    const options = [...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find((row) => /\bselected\b/i.test(row[1])) || options[0];
    if (!selected) continue;
    const a = attrs(`<option ${selected[1]}>`);
    pairs.push([name, a.value ?? clean(selected[2])]);
  }
  for (const match of formHtml.matchAll(/<textarea\b[^>]*name=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/textarea>/gi)) pairs.push([match[1], clean(match[2])]);
  return pairs;
}
function cookieHeader(setCookies) {
  return setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}
function phpSessionId(setCookies) {
  for (const value of setCookies) {
    const match = value.match(/(?:^|;\s*)PHPSESSID=([^;]+)/i);
    if (match) return match[1];
  }
  return "";
}
function loaderSummary(body) {
  const patterns = {
    dataReady: /ajx\.dataReady/i,
    tplPoisk: /tpl_poisk/i,
    soldFor: /Sold\s*for|price_finish/i,
    ajesImages: /(?:https?:)?\\?\/\\?\/(?:\d+\.)?ajes\.com\/imgs\//i,
    lotNumber: /Lot\s*number|lot(?:_num|number)?/i,
    auctionDate: /Auction\s*date|auction_date/i,
    login: /LOGIN|is_login|auth_passwd/i,
    vip: /VIP|BUY\s+VIP|tpl_vip/i,
    limit: /LIMIT\s+\d+\s+PAGES/i,
  };
  return Object.fromEntries(Object.entries(patterns).map(([key, re]) => [key, re.test(body)]));
}
async function probeLoader(html, setCookies, pageValue) {
  const formHtml = formHtmlById(html, "poisk");
  const pairs = successfulFormPairs(formHtml).map(([name, value]) => [name, name === "page" && pageValue != null ? String(pageValue) : value]);
  const body = new FormData();
  for (const [name, value] of pairs) body.append(name, value);
  const session = phpSessionId(setCookies);
  const query = new URLSearchParams();
  if (session) query.set("PHPSESSID", session);
  query.set("ajx", `${Date.now()}-form`);
  const requestUrl = `https://jp.center/aj_neo?file=loader&${query.toString()}`;
  const response = await fetch(requestUrl, {
    method: "POST",
    body,
    headers: {
      ...HEADERS,
      accept: "text/html,application/javascript,*/*;q=0.8",
      referer: URL,
      ...(cookieHeader(setCookies) ? { cookie: cookieHeader(setCookies) } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  return {
    requestUrl: requestUrl.replace(/PHPSESSID=[^&]+/i, "PHPSESSID=<session>"),
    pageValue: pageValue == null ? "source_default" : String(pageValue),
    pairCount: pairs.length,
    pairs: pairs.map(([name, value]) => ({ name, value: /pass|session|token|auth/i.test(name) ? "<redacted>" : value })),
    status: response.status,
    finalUrl: response.url.replace(/PHPSESSID=[^&]+/i, "PHPSESSID=<session>"),
    contentType: response.headers.get("content-type") || "",
    bytes: text.length,
    markers: loaderSummary(text),
    dataReadyCalls: [...text.matchAll(/ajx\.dataReady\s*\([\s\S]{0,12000}?\);/gi)].slice(0, 5).map((m) => m[0].slice(0, 12000)),
    sample: text.slice(0, 50000),
  };
}

const page = await fetchText(URL, HEADERS.accept, URL);
if (page.status < 200 || page.status >= 300) throw new Error(`jpcenter_loader_probe_http_${page.status}`);
const html = page.body;

const runtimeAssets = [];
for (const runtimeUrl of RUNTIME_URLS) {
  try {
    const asset = await fetchText(runtimeUrl, "text/javascript,application/javascript,*/*;q=0.8", URL, cookieHeader(page.setCookies) ? { cookie: cookieHeader(page.setCookies) } : {});
    runtimeAssets.push({
      requestedUrl: asset.requestedUrl,
      finalUrl: asset.finalUrl,
      status: asset.status,
      contentType: asset.contentType,
      bytes: asset.bytes,
      keywordSnippets: keywordMap(asset.body, 6500),
      possibleEndpoints: [...new Set([
        ...[...asset.body.matchAll(/["']((?:https?:\/\/jp\.center)?\/(?:aj|set|m|catalog|search|ajax|api|price|calcos|account|lists)[^"'<>\s]*)["']/gi)].map((m) => m[1]),
        ...[...asset.body.matchAll(/["'](aj_neo\?file=[^"'<>\s]+)["']/gi)].map((m) => m[1]),
      ])].slice(0, 250),
      sample: asset.body.slice(0, 50000),
    });
  } catch (error) {
    runtimeAssets.push({ requestedUrl: runtimeUrl, error: String(error?.message || error) });
  }
}

const possibleEndpoints = [...new Set([
  ...[...html.matchAll(/["']((?:https?:\/\/jp\.center)?\/(?:aj|set|m|catalog|search|ajax|api|price|calcos|account|lists)[^"'<>\s]*)["']/gi)].map((m) => m[1]),
  ...[...html.matchAll(/["'](aj_neo\?file=[^"'<>\s]+)["']/gi)].map((m) => m[1]),
])].slice(0, 250);

const loaderRequests = [];
for (const pageValue of [null, 1]) {
  try { loaderRequests.push(await probeLoader(html, page.setCookies, pageValue)); }
  catch (error) { loaderRequests.push({ pageValue: pageValue == null ? "source_default" : String(pageValue), error: String(error?.message || error) }); }
}

const report = {
  generatedAt: new Date().toISOString(),
  requestedUrl: URL,
  finalUrl: page.finalUrl,
  status: page.status,
  contentType: page.contentType,
  bytes: html.length,
  setCookieNames: page.setCookies.map((value) => value.split("=", 1)[0]),
  forms: formBlocks(html),
  scripts: scriptBlocks(html),
  keywordSnippets: keywordMap(html, 3500),
  possibleEndpoints,
  runtimeAssets,
  loaderRequests,
};
await fs.writeFile("jpcenter-loader-contract-probe.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  status: report.status,
  contentType: report.contentType,
  bytes: report.bytes,
  setCookieNames: report.setCookieNames,
  forms: report.forms.map((f) => ({ attrs: f.attrs, controls: f.controls.map((c) => c.attrs).filter((x) => Object.keys(x).length).slice(0, 60) })),
  scripts: report.scripts.map((s) => ({ index: s.index, attrs: s.attrs, sample: clean(s.body).slice(0, 9000) })),
  keywordSnippets: Object.fromEntries(Object.entries(report.keywordSnippets).map(([k, rows]) => [k, rows.map((x) => ({ index: x.index, sample: clean(x.snippet).slice(0, 8000) }))])),
  possibleEndpoints: report.possibleEndpoints,
  runtimeAssets: report.runtimeAssets.map((asset) => ({
    requestedUrl: asset.requestedUrl,
    finalUrl: asset.finalUrl,
    status: asset.status,
    contentType: asset.contentType,
    bytes: asset.bytes,
    error: asset.error,
    keywordSnippets: asset.keywordSnippets ? Object.fromEntries(Object.entries(asset.keywordSnippets).map(([k, rows]) => [k, rows.map((x) => ({ index: x.index, sample: clean(x.snippet).slice(0, 9000) }))])) : undefined,
    possibleEndpoints: asset.possibleEndpoints,
  })),
  loaderRequests: report.loaderRequests.map((row) => ({
    requestUrl: row.requestUrl,
    pageValue: row.pageValue,
    pairCount: row.pairCount,
    status: row.status,
    finalUrl: row.finalUrl,
    contentType: row.contentType,
    bytes: row.bytes,
    markers: row.markers,
    error: row.error,
    dataReadyCalls: row.dataReadyCalls?.map((value) => clean(value).slice(0, 10000)),
    sample: row.sample ? clean(row.sample).slice(0, 12000) : undefined,
  })),
}, null, 2));
