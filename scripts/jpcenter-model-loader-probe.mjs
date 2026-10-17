import fs from "node:fs/promises";

const ROOT = "https://jp.center/";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
function clean(v) { return String(v ?? "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
function jsString(markup, name) {
  const re = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`, "i");
  const m = markup.match(re);
  if (!m) return "";
  return m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
function listPairs(raw) {
  return raw.split(";").map((row) => {
    const pos = row.indexOf(":");
    return pos > 0 ? { id: clean(row.slice(0, pos)), name: clean(row.slice(pos + 1)) } : null;
  }).filter(Boolean);
}
function formHtmlById(html, id) {
  return html.match(new RegExp(`<form\\b[^>]*\\bid=["']?${id}["']?[^>]*>[\\s\\S]*?<\\/form>`, "i"))?.[0] || "";
}
function formPairs(formHtml) {
  const pairs = [];
  for (const m of formHtml.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.name || a.disabled != null) continue;
    const type = String(a.type || "text").toLowerCase();
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type) && a.checked == null) continue;
    pairs.push([a.name, a.value || ""]);
  }
  return pairs;
}
function cookieHeader(values) { return values.map((v) => v.split(";", 1)[0]).filter(Boolean).join("; "); }
function setValue(pairs, name, value) {
  let found = false;
  const out = pairs.map(([k, v]) => k === name ? (found = true, [k, String(value)]) : [k, v]);
  if (!found) out.push([name, String(value)]);
  return out;
}
function extractBodyObject(text) {
  const marker = "var data=";
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const open = text.indexOf("{", start + marker.length);
  if (open < 0) return "";
  let depth = 0, quote = "", esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return "";
}
function markers(text) {
  return {
    dataReady: /ajx\.dataReady/i.test(text),
    nonEmptyBody: /body\s*:\s*\[\s*\{/i.test(text),
    soldPriceField: /price_finish|Sold\s*for/i.test(text),
    ajesImage: /(?:https?:)?\\?\/\\?\/(?:\d+\.)?ajes\.com\/imgs\//i.test(text),
    lotField: /(?:lot|bid)(?:_num|number)?\s*:/i.test(text),
    auctionField: /auct(?:ion)?(?:_name|_date)?\s*:/i.test(text),
    vip: /tpl_vip|BUY\s+VIP|VIP ACCOUNT/i.test(text),
    login: /auth_passwd|is_login|LOGIN/i.test(text),
  };
}

const rootResp = await fetch(ROOT, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30000) });
const root = await rootResp.text();
if (!rootResp.ok) throw new Error(`jpcenter_root_http_${rootResp.status}`);
const setCookies = typeof rootResp.headers.getSetCookie === "function" ? rootResp.headers.getSetCookie() : [];
const manufRaw = jsString(root, "manuf_str");
const modelRaw = jsString(root, "model_str");
const makers = listPairs(manufRaw);
const models = listPairs(modelRaw);
const make = makers.find((row) => /TOYOTA/i.test(row.name)) || makers[0];
if (!make) throw new Error("jpcenter_no_maker_data");
const makeModels = models.filter((row) => row.id === make.id);
const model = makeModels.find((row) => /ALPHARD/i.test(row.name)) || makeModels.find((row) => /PRIUS|COROLLA|RAV4/i.test(row.name)) || makeModels[0];
if (!model) throw new Error(`jpcenter_no_model_data_for_${make.id}`);

let pairs = formPairs(formHtmlById(root, "poisk"));
pairs = setValue(pairs, "page", "1");
pairs = setValue(pairs, "sort_ord", "");
pairs = setValue(pairs, "is_stat", "0");
pairs = setValue(pairs, "vendor", make.id);
pairs = setValue(pairs, "model", model.name.split(" (")[0]);
const body = new FormData();
for (const [k, v] of pairs) body.append(k, v);
const qModel = encodeURIComponent(model.name.split(" (")[0]);
const loaderUrl = `https://jp.center/aj_neo?file=loader&Q=${qModel}&ajx=${Date.now()}-form`;
const loaderResp = await fetch(loaderUrl, {
  method: "POST",
  body,
  headers: { ...HEADERS, accept: "text/html,application/javascript,*/*;q=0.8", referer: ROOT, ...(cookieHeader(setCookies) ? { cookie: cookieHeader(setCookies) } : {}) },
  redirect: "follow",
  signal: AbortSignal.timeout(30000),
});
const loaderText = await loaderResp.text();
const dataObject = extractBodyObject(loaderText);
const report = {
  generatedAt: new Date().toISOString(),
  root: { status: rootResp.status, bytes: root.length, contentType: rootResp.headers.get("content-type") || "" },
  sourceData: { makerCount: makers.length, modelCount: models.length, selectedMake: make, selectedModel: model },
  request: { url: loaderUrl.replace(/ajx=[^&]+/, "ajx=<request>"), pairCount: pairs.length, vendor: make.id, model: model.name.split(" (")[0], page: 1 },
  response: { status: loaderResp.status, bytes: loaderText.length, contentType: loaderResp.headers.get("content-type") || "", markers: markers(loaderText), dataObjectBytes: dataObject.length, dataObject: dataObject.slice(0, 120000), sample: loaderText.slice(0, 120000) },
};
await fs.writeFile("jpcenter-model-loader-probe.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ generatedAt: report.generatedAt, root: report.root, sourceData: report.sourceData, request: report.request, response: { ...report.response, dataObject: report.response.dataObject.slice(0, 20000), sample: report.response.sample.slice(0, 20000) } }, null, 2));
if (!loaderResp.ok) process.exit(1);
