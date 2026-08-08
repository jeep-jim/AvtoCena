import fs from "node:fs/promises";

const ROOT = "https://jp.center/";
const CANDIDATES = [
  { id: "4X5OjbgVimzsWhi", reason: "verified_loader_sold_marker" },
  { id: "Jqh4QFz0RrXrXf", reason: "verified_loader_positive_numeric_price" },
  { id: "2eIEjCiABt14gP3", reason: "verified_loader_positive_numeric_price" },
];
const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
function clean(v) { return String(v ?? "").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function absolute(v, base) { try { return new URL(String(v||"").replace(/&amp;/g,"&"),base).toString(); } catch { return ""; } }
function around(text, re, radius=1200, max=20) {
  const out=[]; const rx=new RegExp(re.source,re.flags.includes("g")?re.flags:re.flags+"g");
  for (const m of text.matchAll(rx)) { const i=m.index||0; out.push({match:m[0],index:i,snippet:text.slice(Math.max(0,i-radius),Math.min(text.length,i+m[0].length+radius))}); if(out.length>=max) break; }
  return out;
}
function exactImages(html, base) {
  const values=[];
  for (const m of html.matchAll(/(?:src|href|data-src|data-original|content)=["']([^"']+)["']/gi)) values.push(m[1]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)) values.push(m[0].replace(/\\\//g,"/"));
  return [...new Set(values.map(v=>absolute(v,base)).filter(u=>/^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+(?:[?#].*)?$/i.test(u)))];
}
function fieldRows(html) {
  const rows=[];
  for (const m of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/(?:tr)>/gi)) {
    const text=clean(m[0]);
    if (/year|maker|make|model|lot|auction|chassis|mileage|engine|condition|start|sold|price|status/i.test(text)) rows.push(text.slice(0,1000));
    if(rows.length>=100) break;
  }
  return rows;
}
async function fetchText(url, referer=ROOT) {
  const r=await fetch(url,{headers:{...HEADERS,referer},redirect:"follow",signal:AbortSignal.timeout(30000)});
  const body=await r.text();
  return {status:r.status,finalUrl:r.url,contentType:r.headers.get("content-type")||"",bytes:body.length,body};
}
const root=await fetchText(ROOT,ROOT);
if(root.status<200||root.status>=300) throw new Error(`jpcenter_root_http_${root.status}`);
const templateSnippets={
  soldFor: around(root.body,/Sold(?:&nbsp;|\s)*for|price_finish/gi,2400,20),
  detailHref: around(root.body,/\$\{b\.f1\}-\$\{b\.a\}\.htm/gi,2400,10),
  priceHref: around(root.body,/\/price-\$\{b\.a\}/gi,2400,10),
  imageToken: around(root.body,/ajes\.com\/imgs\/\$\{b\.[xyz]\}/gi,2400,20),
};
const details=[];
for(const candidate of CANDIDATES){
  const url=`https://jp.center/aj-${candidate.id}.htm`;
  try{
    const d=await fetchText(url,ROOT);
    const price=await fetchText(`https://jp.center/price-${candidate.id}`,url).catch(error=>({error:String(error?.message||error),status:0,finalUrl:"",contentType:"",bytes:0,body:""}));
    details.push({
      ...candidate,
      url,
      status:d.status,
      finalUrl:d.finalUrl,
      contentType:d.contentType,
      bytes:d.bytes,
      title:clean(d.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||""),
      images:exactImages(d.body,d.finalUrl),
      rows:fieldRows(d.body),
      markers:{login:/LOGIN|auth_passwd|sign in/i.test(d.body),vip:/BUY\s+VIP|VIP ACCOUNT|tpl_vip/i.test(d.body),sold:/\bsold\b/i.test(clean(d.body)),soldFor:/Sold(?:&nbsp;|\s)*for|price_finish/i.test(d.body),start:/\bStart\b|price_start/i.test(d.body),lot:/\bLot(?:\s*number)?\b/i.test(clean(d.body)),auction:/\bAuction\b/i.test(clean(d.body)),chassis:/\bChassis\b/i.test(clean(d.body))},
      snippets:{soldFor:around(d.body,/Sold(?:&nbsp;|\s)*for|price_finish|End Price|Final Price/gi,1500,20).map(x=>clean(x.snippet).slice(0,5000)),start:around(d.body,/\bStart\b|price_start/gi,1500,20).map(x=>clean(x.snippet).slice(0,5000)),lot:around(d.body,/\bLot(?:\s*number)?\b|Chassis|Auction Date/gi,1500,30).map(x=>clean(x.snippet).slice(0,5000)),ajes:around(d.body,/ajes\.com\/imgs\//gi,800,20).map(x=>x.snippet.slice(0,3000))},
      priceEndpoint:{status:price.status,finalUrl:price.finalUrl,contentType:price.contentType,bytes:price.bytes,title:clean(price.body?.match?.(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||""),text:clean(price.body||"").slice(0,12000),markers:{login:/LOGIN|auth_passwd|sign in/i.test(price.body||""),vip:/BUY\s+VIP|VIP ACCOUNT|tpl_vip/i.test(price.body||""),yen:/\b(?:YEN|JPY|¥)\b/i.test(clean(price.body||""))}},
    });
  }catch(error){ details.push({...candidate,url,error:String(error?.message||error)}); }
}
const report={generatedAt:new Date().toISOString(),root:{status:root.status,bytes:root.bytes,contentType:root.contentType},templateSnippets,details};
await fs.writeFile("jpcenter-detail-contract-probe.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({generatedAt:report.generatedAt,root:report.root,templateSnippets:Object.fromEntries(Object.entries(templateSnippets).map(([k,rows])=>[k,rows.map(x=>clean(x.snippet).slice(0,5000))])),details:details.map(d=>({id:d.id,reason:d.reason,url:d.url,status:d.status,finalUrl:d.finalUrl,contentType:d.contentType,bytes:d.bytes,title:d.title,imageCount:d.images?.length,images:d.images?.slice(0,12),rows:d.rows,markers:d.markers,snippets:d.snippets,priceEndpoint:d.priceEndpoint,error:d.error}))},null,2));
