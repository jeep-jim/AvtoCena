import fs from "node:fs/promises";

const headers = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  referer: "https://jpauc.com/auction",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const key = match[1].toLowerCase();
    if (key === tag.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase()) continue;
    out[key] = match[2] ?? match[3] ?? match[4] ?? true;
  }
  return out;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function snippets(text, patterns, before = 260, after = 520) {
  const rows = [];
  const lower = text.toLowerCase();
  for (const pattern of patterns) {
    let offset = 0;
    while (rows.length < 80) {
      const index = lower.indexOf(pattern.toLowerCase(), offset);
      if (index < 0) break;
      rows.push(clean(text.slice(Math.max(0, index - before), Math.min(text.length, index + pattern.length + after))));
      offset = index + pattern.length;
    }
  }
  return [...new Set(rows)].slice(0, 80);
}

function extract(html, url) {
  const forms = [];
  for (const match of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const block = match[0];
    const open = block.match(/^<form\b[^>]*>/i)?.[0] || "";
    const controls = [];
    for (const tag of block.matchAll(/<(input|button|select|option)\b[^>]*>/gi)) {
      const type = tag[1].toLowerCase();
      const parsed = attrs(tag[0]);
      if (parsed.name || parsed.value || parsed.type || type === "select") controls.push({ type, ...parsed });
    }
    forms.push({ form: attrs(open), controls: controls.slice(0, 200), text: clean(block.replace(/<[^>]+>/g, " ")).slice(0, 1200) });
  }
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((href) => /auction|past|listing|search|date|lot/i.test(href))
    .slice(0, 300);
  const scripts = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 100);
  return { url, bytes: html.length, forms, links, scripts };
}

async function get(url) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  return { status: response.status, finalUrl: response.url, headers: { contentType: response.headers.get("content-type"), setCookie: response.headers.get("set-cookie") }, ...extract(html, response.url), html };
}

const pages = [];
for (const url of ["https://jpauc.com/auction/past", "https://jpauc.com/auction"]) {
  const result = await get(url);
  pages.push({ ...result, html: undefined });
}

const scriptCandidates = [...new Set(pages.flatMap((page) => page.scripts || []))].filter((src) => /\.js(?:\?|$)/i.test(src));
const scriptHits = [];
for (const src of scriptCandidates.slice(0, 30)) {
  try {
    const absolute = new URL(src, "https://jpauc.com").toString();
    const response = await fetch(absolute, { headers, signal: AbortSignal.timeout(20000) });
    const source = await response.text();
    const hits = snippets(source, ["submitauction", "auction-dates", "checkdate", "submitlot", "/auction/past", "serialize", ".submit(", "location.href"]);
    scriptHits.push({ url: absolute, status: response.status, bytes: source.length, hits });
  } catch (error) {
    scriptHits.push({ url: src, error: String(error?.message || error) });
  }
}

const output = { checkedAt: new Date().toISOString(), pages, scriptHits };
await fs.writeFile("jpauc-past-form-diagnostic.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
