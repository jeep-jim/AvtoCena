import fs from "node:fs/promises";
import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { dedupeMashinaImageUrls } from "../apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts";

const limit = Math.max(1, Math.min(80, Number(process.env.KG_GALLERY_DIAG_LIMIT || 30)));
const output = process.env.KG_GALLERY_DIAG_OUTPUT || "kg-gallery-depth-report.json";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,ky;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const IMAGE_HOST = /^(?:storage|im)\.mashina\.kg$/i;

function publicUrls(offer:any){ return (Array.isArray(offer?.images)?offer.images:[]).map((x:any)=>String(x?.url||"")).filter(Boolean); }
function compact(value:unknown){ return String(value||"").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu,""); }
function plain(markup:string){ return markup.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim(); }
function identityOk(markup:string, offer:any){ const text=compact(plain(markup).slice(0,25000)); const make=compact(offer?.make); const tokens=String(offer?.model||"").split(/\s+/).map(compact).filter((x)=>x.length>=2).slice(0,3); return Boolean(make&&text.includes(make)&&tokens.some((x)=>text.includes(x))); }
function absolute(value:string, base:string){ try { return new URL(value.replace(/\\\//g,"/"),base).toString(); } catch { return ""; } }
function extract(markup:string, base:string){
  const raw:string[]=[];
  for(const m of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) raw.push(m[1]);
  for(const m of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) m[1].split(",").forEach((part)=>raw.push(part.trim().split(/\s+/)[0]));
  for(const m of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) raw.push(m[0].replace(/\\\//g,"/"));
  const accepted=[...new Set(raw.map((v)=>absolute(v,base)).filter(Boolean))].filter((u)=>{ try { const x=new URL(u); return IMAGE_HOST.test(x.hostname)&&!BAD.test(u); } catch { return false; } });
  return dedupeMashinaImageUrls(accepted).slice(0,60);
}

const offers:any[] = await readMarketOffers("kyrgyzstan");
const candidates = offers.filter((o:any)=>String(o.sourceId||"")==="mashina_kyrgyzstan_exact" && publicUrls(o).length<5 && /^https?:\/\//i.test(String(o?.operational?.sourceUrl||""))).slice(0,limit);
const rows:any[]=[];
for(const offer of candidates){
  const sourceUrl=String(offer.operational.sourceUrl);
  const started=Date.now();
  try{
    const response=await fetch(sourceUrl,{headers:{...HEADERS,referer:"https://www.mashina.kg/en/search/"},redirect:"follow",signal:AbortSignal.timeout(25000)});
    const markup=await response.text();
    const exact=extract(markup,response.url||sourceUrl);
    rows.push({id:offer.id,sourceOfferId:offer.sourceOfferId,make:offer.make,model:offer.model,year:offer.year,before:publicUrls(offer).length,http:response.status,identityOk:identityOk(markup,offer),exactCount:exact.length,exactSample:exact.slice(0,5),ms:Date.now()-started});
  }catch(error:any){ rows.push({id:offer.id,sourceOfferId:offer.sourceOfferId,before:publicUrls(offer).length,error:String(error?.message||error),ms:Date.now()-started}); }
}
const report={version:1,market:"kyrgyzstan",candidateCount:offers.filter((o:any)=>String(o.sourceId||"")==="mashina_kyrgyzstan_exact"&&publicUrls(o).length<5).length,attempted:rows.length,identityOk:rows.filter((r)=>r.identityOk).length,exactAtLeast5:rows.filter((r)=>r.identityOk&&r.exactCount>=5).length,histogram:Object.fromEntries([...new Set(rows.map((r)=>Number(r.exactCount||0)))].sort((a,b)=>a-b).map((n)=>[String(n),rows.filter((r)=>Number(r.exactCount||0)===n).length])),rows};
await fs.writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
