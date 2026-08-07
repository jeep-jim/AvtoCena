import fs from "node:fs/promises";

const output = process.env.DUBICARS_SHAPE_OUTPUT || "dubicars-strict-shape.json";
const listUrl = "https://www.dubicars.com/uae/used?page=1";
const headers = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
function abs(v, base) { try { return new URL(String(v).replace(/&amp;/gi,"&").replace(/\\\//g,"/"), base).toString(); } catch { return ""; } }
function clean(v) { return String(v??"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }

const lr = await fetch(listUrl, { headers, redirect: "follow" });
const listing = await lr.text();
const hrefs = [...listing.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
const likely = [...new Set(hrefs.filter(h=>/used|car|vehicle|sale/i.test(h)).map(h=>abs(h, lr.url || listUrl)).filter(Boolean))];
const numeric = [...new Set(hrefs.filter(h=>/\d{5,}/.test(h)).map(h=>abs(h, lr.url || listUrl)).filter(Boolean))];
const chosen = numeric.find(u=>/\.html(?:[?#]|$)/i.test(u)) || numeric[0] || likely.find(u=>u!==lr.url) || "";
let detail = { url: chosen, status: 0, bytes: 0, h1: "", og: "", textSample: "", imageCandidates: [], groupCounts: {} };
if (chosen) {
  const dr = await fetch(chosen, { headers: { ...headers, referer: lr.url || listUrl }, redirect: "follow" });
  const html = await dr.text();
  const values = [];
  for (const m of html.matchAll(/(?:data-src|data-original|data-lazy-src|src|content|poster)\s*=\s*["']([^"']+)["']/gi)) values.push(m[1]);
  for (const m of html.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) for (const p of m[1].split(",")) values.push(p.trim().split(/\s+/)[0]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+\.(?:jpe?g|webp|png)(?:\?[^"'<>\s\\]*)?/gi)) values.push(m[0]);
  const imgs=[...new Set(values.map(v=>abs(v, dr.url||chosen)).filter(u=>/^https?:\/\//.test(u) && /\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(u)))];
  const groups={};
  for(const u of imgs){try{const x=new URL(u);const parts=x.pathname.split('/').filter(Boolean);const uuid=parts.findIndex(p=>/^[a-f0-9-]{24,}$/i.test(p));const key=`${x.hostname}/${(uuid>=0?parts.slice(0,uuid+1):parts.slice(0,-1)).join('/')}`;groups[key]=(groups[key]||0)+1;}catch{}}
  detail={url:dr.url||chosen,status:dr.status,bytes:html.length,h1:clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]),og:html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"",textSample:clean(html).slice(0,5000),imageCandidates:imgs.slice(0,100),groupCounts:Object.fromEntries(Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,30))};
}
const report={checkedAt:new Date().toISOString(),listing:{status:lr.status,resolvedUrl:lr.url,bytes:listing.length,hrefCount:hrefs.length,numericCount:numeric.length,likelyCount:likely.length,hrefSample:hrefs.slice(0,100),numericSample:numeric.slice(0,50)},detail};
await fs.writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({listing:{status:report.listing.status,bytes:report.listing.bytes,hrefs:report.listing.hrefCount,numeric:report.listing.numericCount},detail:{url:detail.url,status:detail.status,bytes:detail.bytes,images:detail.imageCandidates.length,topGroups:detail.groupCounts}},null,2));
