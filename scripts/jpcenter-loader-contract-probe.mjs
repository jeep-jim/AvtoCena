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
    result.push({ attrs: attrs(tag), tag, controls: controls.slice(0, 120), sample: block.slice(0, 7000) });
  }
  return result.slice(0, 30);
}
function scriptBlocks(html) {
  const result = [];
  let idx = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const body = m[2] || "";
    if (/aj_neo|loader|poisk|model_submit|doLoad|XMLHttpRequest|fetch\s*\(|\.submit\s*\(|FormData|grid_edit|ajax/i.test(body)) {
      result.push({ index: idx, attrs: attrs(`<script ${m[1] || ""}>`), body: body.slice(0, 30000) });
    }
    idx++;
    if (result.length >= 25) break;
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
  "url_loader",
  "XMLHttpRequest",
  "fetch\\s*\\(",
  "FormData",
  "poisk",
  "grid_edit",
  "loader_email",
  "file=loader",
];
function keywordMap(text) {
  const out = {};
  for (const pattern of keywords) out[pattern] = around(text, pattern, 2200, 12);
  return out;
}

async function fetchText(url, accept, referer = URL) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept, referer },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    bytes: body.length,
    body,
  };
}

const page = await fetchText(URL, HEADERS.accept, URL);
if (page.status < 200 || page.status >= 300) throw new Error(`jpcenter_loader_probe_http_${page.status}`);
const html = page.body;

const runtimeAssets = [];
for (const runtimeUrl of RUNTIME_URLS) {
  try {
    const asset = await fetchText(runtimeUrl, "text/javascript,application/javascript,*/*;q=0.8", URL);
    runtimeAssets.push({
      requestedUrl: asset.requestedUrl,
      finalUrl: asset.finalUrl,
      status: asset.status,
      contentType: asset.contentType,
      bytes: asset.bytes,
      keywordSnippets: keywordMap(asset.body),
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

const report = {
  generatedAt: new Date().toISOString(),
  requestedUrl: URL,
  finalUrl: page.finalUrl,
  status: page.status,
  contentType: page.contentType,
  bytes: html.length,
  forms: formBlocks(html),
  scripts: scriptBlocks(html),
  keywordSnippets: keywordMap(html),
  possibleEndpoints,
  runtimeAssets,
};
await fs.writeFile("jpcenter-loader-contract-probe.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  status: report.status,
  contentType: report.contentType,
  bytes: report.bytes,
  forms: report.forms.map((f) => ({ attrs: f.attrs, controls: f.controls.map((c) => c.attrs).filter((x) => Object.keys(x).length).slice(0, 40) })),
  scripts: report.scripts.map((s) => ({ index: s.index, attrs: s.attrs, sample: clean(s.body).slice(0, 7000) })),
  keywordSnippets: Object.fromEntries(Object.entries(report.keywordSnippets).map(([k, rows]) => [k, rows.map((x) => ({ index: x.index, sample: clean(x.snippet).slice(0, 6000) }))])),
  possibleEndpoints: report.possibleEndpoints,
  runtimeAssets: report.runtimeAssets.map((asset) => ({
    requestedUrl: asset.requestedUrl,
    finalUrl: asset.finalUrl,
    status: asset.status,
    contentType: asset.contentType,
    bytes: asset.bytes,
    error: asset.error,
    keywordSnippets: asset.keywordSnippets ? Object.fromEntries(Object.entries(asset.keywordSnippets).map(([k, rows]) => [k, rows.map((x) => ({ index: x.index, sample: clean(x.snippet).slice(0, 6000) }))])) : undefined,
    possibleEndpoints: asset.possibleEndpoints,
    sample: asset.sample ? clean(asset.sample).slice(0, 12000) : undefined,
  })),
}, null, 2));
