import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

const limit = Math.max(1, Math.min(300, Number(process.env.AUDIT_LIMIT || 80)));
const directRe = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;
const resizedRe = /(?:g\.autoimg\.cn\/@img\/|\/(?:240|300|320|360|400|480)x0[_-]|\/(?:small|thumb|thumbnail)\/)/i;
function urls(offer:any){return (Array.isArray(offer?.images)?offer.images:[]).map((x:any)=>String(x?.url||"")).filter(Boolean)}
function stale(offer:any){
  if(String(offer?.sourceId||"")!=="autohome_new_china_open") return false;
  const list=urls(offer);
  return list.length<5 || list.some((u:string)=>resizedRe.test(u)) || !list.every((u:string)=>directRe.test(u));
}
function score(offer:any){ const list=urls(offer); return (list.length<5?1000:0)+list.filter((u:string)=>resizedRe.test(u)).length*20+Math.max(0,30-list.length); }
const all:any[] = await readMarketOffers("china");
const source = all.filter((o)=>String(o?.sourceId||"")==="autohome_new_china_open");
const candidates = source.filter(stale).sort((a,b)=>score(b)-score(a)).slice(0,limit);
const rows:any[]=[];
for(let i=0;i<candidates.length;i++){
  const original=candidates[i]; const probe=structuredClone(original); probe.images=[];
  let exact:any[]=[]; let error="";
  try{ exact=await autohomeNewExactSource.fetchImages(probe); }catch(e:any){ error=String(e?.message||e); }
  const direct=exact.filter((img:any)=>directRe.test(String(img?.url||"")));
  rows.push({id:original.id,sourceOfferId:original.sourceOfferId,before:urls(original).length,beforeResized:urls(original).filter((u:string)=>resizedRe.test(u)).length,exact:direct.length,improvable:direct.length>=5,error});
  if((i+1)%10===0) await new Promise(r=>setTimeout(r,700));
}
const below5=source.filter((o)=>urls(o).length<5).length;
const staleCount=source.filter(stale).length;
const improvable=rows.filter((r)=>r.improvable);
const report={passed:rows.length>0,publicChina:all.length,autoHomeNew:source.length,below5,staleCount,attempted:rows.length,improvable:improvable.length,improvableBelow5:improvable.filter((r)=>r.before<5).length,exactGallery:{min:rows.length?Math.min(...rows.map(r=>r.exact)):0,max:rows.length?Math.max(...rows.map(r=>r.exact)):0,avg:rows.length?Math.round(rows.reduce((s,r)=>s+r.exact,0)/rows.length*100)/100:0},samples:rows.slice(0,30),failureExamples:rows.filter(r=>!r.improvable).slice(0,20)};
console.log(JSON.stringify(report,null,2));
if(!report.passed) process.exit(1);
