import {getJsonStorage} from '../apps/web/lib/data';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {convertToRub} from '../apps/web/lib/catalog/rates';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {ajesOriginalListingUrl} from '../apps/web/lib/catalog/ajes-source-url';
async function original(url:string,market:string,lot:string){
 const u=ajesOriginalListingUrl(url,market,lot);if(!u)return {status:'no_verified_url'};
 try{
  const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'AvtoCena owner-requested price verification','Accept':'text/html'}});
  if(!r.ok){await r.body?.cancel();return {status:'http_'+r.status};}
  const reader=r.body?.getReader();if(!reader)return {status:'empty'};
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2*1024*1024){await reader.cancel();return {status:'too_large'};}chunks.push(x.value);}
  const h=new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  if(/captcha|verify you are human|access denied|访问异常|安全验证/i.test(h))return {status:'challenge'};
  const fields=[...h.matchAll(/["'](price|salePrice|sellPrice|dealerPrice|Price|SalePrice|SellPrice|advertisedPrice)["']\s*:\s*["']?(\d+(?:\.\d+)?)/g)].slice(0,12).map(x=>({field:x[1],value:x[2]}));
  const text=h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const labels=[...text.matchAll(/.{0,35}(?:售价|报价|价格|만원|판매가격|차량가격|차량 가격).{0,65}/g)].slice(0,8).map(x=>x[0]);
  return {status:'read',bytes:size,identityMention:lot?h.includes(lot):false,fields,labels};
 }catch{return {status:'request_failed'};}
}
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const store=getJsonStorage(),all=new Map<string,any>();
 for(let start=0;start<128;start+=8){
  const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson<any>('catalog/partner-cache/ajes/queries/'+(start+n)+'.json',null).catch(()=>null)));
  for(const s of slots)for(const l of s?.value?.items||[])if(['china','korea'].includes(l.table)&&l.sourcePrice>0&&(!all.has(l.table+':'+l.id)||Date.parse(s.value.observedAt)>Date.parse(all.get(l.table+':'+l.id).savedAt)))all.set(l.table+':'+l.id,{...l,savedAt:s.value.observedAt});
 }
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled('ajes_'+t+'_feed'),reserve:t=>reserveAjesRequest(store,t)});
 let stop=false;
 for(const market of ['china','korea']){
  let candidates=[...all.values()].filter(l=>l.table===market);if(!candidates.length){const page=await client.read({table:market,pageSize:12},ip);candidates=page.items.map(l=>({...l,savedAt:page.observedAt}));}const chosen:any[]=[];const makes=new Set();
  for(const l of candidates)if(!makes.has(l.make)&&chosen.length<4){chosen.push(l);makes.add(l.make);}
  for(const l of candidates)if(chosen.length<4&&!chosen.some(x=>x.id===l.id))chosen.push(l);
  console.log('AUDIT_SELECTION',JSON.stringify({market,available:candidates.length,selected:chosen.length}));
  for(const l of chosen){
   if(stop)break;
   const base={market,id:l.id,lot:l.lot,make:l.make,model:l.model,year:l.year,cachedAt:l.savedAt,cachedPrice:l.sourcePrice,currency:l.currency};
   try{
    const saved:any=await store.readJson('catalog/partner-cache/ajes/'+market+'/'+l.id+'.json',null);
    const fresh=await client.read({table:market,id:l.id},ip),f=fresh.items[0];
    if(!f){console.log('PRICE_SAMPLE',JSON.stringify({...base,status:'fresh_empty'}));continue;}
    const rate=await convertToRub(f.sourcePrice!,f.currency),offer=rate?ajesOffer(f as any,rate,fresh.observedAt):null;
    const sourceUrl=ajesOriginalListingUrl(f.status,market,f.lot);
    const source=sourceUrl?await original(sourceUrl,market,f.lot):{status:'no_verified_url'};
    console.log('PRICE_SAMPLE',JSON.stringify({...base,observedAt:fresh.observedAt,freshPrice:f.sourcePrice,freshLot:f.lot,stale:fresh.stale,savedDetailPrice:saved?.items?.[0]?.sourcePrice,savedDetailAt:saved?.observedAt,cacheMatches:f.sourcePrice===l.sourcePrice,sourceUrl,rate:rate?{quote:rate.cbrRate,nominal:rate.nominal,effective:rate.effectiveRate,date:rate.rateDate}:null,adapterSourcePrice:offer?.sourcePrice,adapterSellerRub:offer?.sellerPriceRub,source}));
   }catch(e:any){const reason=typeof e?.reason==='string'&&/^[a-z_0-9]+$/.test(e.reason)?e.reason:'request_failed';console.log('PRICE_SAMPLE',JSON.stringify({...base,status:reason}));if(/restricted|quota/.test(reason))stop=true;}
  }
 }
}
main().catch(()=>{console.log('AUDIT_FAILED');process.exitCode=1;});
