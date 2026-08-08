import fs from "node:fs/promises";

const targets = [
  "https://jp.center/catalog?lang=en",
  "https://jp.center/catalog",
  "https://jp.center/",
  "https://jp.center/robots.txt",
];
const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,ja;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function absolute(value, base) {
  try { return new URL(String(value || "").replace(/&amp;/g, "&"), base).toString(); } catch { return ""; }
}
function uniq(values, limit = 200) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1]] = match[2];
  return result;
}
function summarize(markup, finalUrl) {
  const title = clean(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const hrefs = uniq([...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => absolute(m[1], finalUrl)), 300);
  const forms = [...markup.matchAll(/<form\b[^>]*>/gi)].map((m) => attributes(m[0])).slice(0, 40);
  const inputs = [...markup.matchAll(/<(?:input|select|button)\b[^>]*>/gi)].map((m) => attributes(m[0])).slice(0, 120);
  const scripts = uniq([...markup.matchAll(/<script\b[^>]*src\s*=\s*["']([^"']+)["']/gi)].map((m) => absolute(m[1], finalUrl)), 100);
  const images = uniq([...markup.matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/gi)].map((m) => absolute(m[1], finalUrl)), 80);
  const apiLike = uniq([
    ...[...markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)].map((m) => m[0].replace(/\\\//g, "/")),
    ...[...markup.matchAll(/["'](\/(?:api|ajax|catalog|search|cars?|lots?|stock|auction)[^"']*)["']/gi)].map((m) => absolute(m[1], finalUrl)),
  ].filter((url) => /api|ajax|catalog|search|cars?|lots?|stock|auction/i.test(url)), 200);
  const dataAttrs = uniq([...markup.matchAll(/\b(data-[\w-]+)\s*=\s*["']([^"']+)["']/gi)].map((m) => `${m[1]}=${m[2]}`), 200);
  const ids = uniq([...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]), 120);
  const classes = uniq([...markup.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => m[1].split(/\s+/)), 200);
  const jsonMarkers = uniq([...markup.matchAll(/(?:__NEXT_DATA__|__NUXT__|window\.__\w+|application\/ld\+json|application\/json|api\/v\d+|graphql)/gi)].map((m) => m[0]), 80);
  return {
    title,
    plainSample: clean(markup).slice(0, 6000),
    hrefCount: hrefs.length,
    hrefs,
    forms,
    inputs,
    scripts,
    images,
    apiLike,
    dataAttrs,
    ids,
    classes,
    jsonMarkers,
  };
}

const results = [];
for (const url of targets) {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    results.push({
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: body.length,
      ...summarize(body, response.url || url),
    });
  } catch (error) {
    results.push({ requestedUrl: url, error: String(error?.message || error) });
  }
}
const report = { generatedAt: new Date().toISOString(), results };
await fs.writeFile("jpcenter-structure-probe.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
