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
function formHtmlById(html, id) { return html.match(new RegExp(`<form\\b[^>]*\\bid=["']?${id}["']?[^>]*>[\\s\\S]*?<\\/form>`, "i"))?.[0] || ""; }
function pairsFromForm(html) {
  const out = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.name || a.disabled != null) continue;
    const type = String(a.type || "text").toLowerCase();
    if (["submit","button","image","reset","file"].includes(type)) continue;
    if (["checkbox","radio"].includes(type) && a.checked == null) continue;
    out.push([a.name, a.value || ""]);
  }
  return out;
}
function setValue(pairs, name, value) {
  let seen = false;
  const out = pairs.map(([k,v]) => k === name ? (seen = true, [k,String(value)]) : [k,v]);
  if (!seen) out.push([name,String(value)]);
  return out;
}
function cookieHeader(values) { return values.map((v) => v.split(";",1)[0]).filter(Boolean).join("; "); }
function markers(text) {
  return {
    dataReady: /ajx\.dataReady/i.test(text),
    nonEmptyBody: /body\s*:\s*\[\s*\{/i.test(text),
    soldPrice: /price_finish|Sold\s*for/i.test(text),
    ajesImage: /(?:https?:)?\\?\/\\?\/(?:\d+\.)?ajes\.com\/imgs\//i.test(text),
    lot: /(?:bid|lot(?:_num|number)?)\s*:/i.test(text),
    auction: /auct(?:ion)?(?:_name|_date)?\s*:/i.test(text),
    vip: /tpl_vip|BUY\s+VIP|VIP ACCOUNT/i.test(text),
    login: /auth_passwd|is_login|LOGIN/i.test(text),
  };
}

const rootResp = await fetch(ROOT, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30000) });
const root = await rootResp.text();
if (!rootResp.ok) throw new Error(`jpcenter_root_http_${rootResp.status}`);
if (!/1:ALPHARD(?:\s|\(|;|<)/i.test(root)) throw new Error("jpcenter_verified_model_marker_missing");
const setCookies = typeof rootResp.headers.getSetCookie === "function" ? rootResp.headers.getSetCookie() : [];
let pairs = pairsFromForm(formHtmlById(root,"poisk"));
for (const [k,v] of [["page","1"],["sort_ord",""],["is_stat","0"],["vendor","1"],["model","ALPHARD"]]) pairs = setValue(pairs,k,v);
const body = new FormData();
for (const [k,v] of pairs) body.append(k,v);
const url = `https://jp.center/aj_neo?file=loader&Q=ALPHARD&ajx=${Date.now()}-form`;
const response = await fetch(url, {
  method: "POST", body,
  headers: { ...HEADERS, accept: "text/html,application/javascript,*/*;q=0.8", referer: ROOT, ...(cookieHeader(setCookies) ? {cookie:cookieHeader(setCookies)} : {}) },
  redirect: "follow", signal: AbortSignal.timeout(30000),
});
const text = await response.text();
const report = {
  generatedAt:new Date().toISOString(),
  root:{status:rootResp.status,bytes:root.length,verifiedModel:"1:ALPHARD"},
  request:{vendor:"1",model:"ALPHARD",page:"1",pairCount:pairs.length,url:url.replace(/ajx=[^&]+/,"ajx=<request>")},
  response:{status:response.status,contentType:response.headers.get("content-type")||"",bytes:text.length,markers:markers(text),sample:text.slice(0,150000)},
};
await fs.writeFile("jpcenter-known-model-loader-probe.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,response:{...report.response,sample:report.response.sample.slice(0,30000)}},null,2));
if (!response.ok) process.exit(1);
