import {getJsonStorage} from '../apps/web/lib/data';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {convertToRub} from '../apps/web/lib/catalog/rates';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const storage=getJsonStorage(),id='83A7S2UuaVtzRx';
 const saved:any=await storage.readJson('catalog/partner-cache/ajes/china/'+id+'.json',null);
 const old=saved?.items?.[0];
 console.log('PRICE_CACHE',JSON.stringify({id,observedAt:saved?.observedAt,price:old?.sourcePrice,lot:old?.lot,currency:old?.currency}));
 // No application cache readers or writers: a single genuine exact-ID supplier request.
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled('ajes_'+t+'_feed'),reserve:t=>reserveAjesRequest(storage,t)});
 try {
  const fresh=await client.read({table:'china',id},ip),lot=fresh.items[0];
  console.log('PRICE_FRESH',JSON.stringify({observedAt:fresh.observedAt,id:lot?.id,lot:lot?.lot,price:lot?.sourcePrice,currency:lot?.currency,stale:fresh.stale,sameAsCache:lot?.sourcePrice===old?.sourcePrice}));
 } catch(e:any){console.log('PRICE_FRESH_FAILED',typeof e?.reason==='string'&&/^[a-z_0-9]+$/.test(e.reason)?e.reason:'local_or_request_failed');}
 const stored:any=await storage.readJson('fees/exchange-rates.json',null);
 for(const currency of ['CNY','KRW','JPY','USD','EUR','AED']){
  const raw=Array.isArray(stored?.rates)?stored.rates.find((x:any)=>x.currency===currency):stored?.[currency];
  const rate=await convertToRub(currency==='CNY'?57800:1,currency);
  console.log('RATE_CHAIN',JSON.stringify({currency,stored:raw?{cbrRate:raw.cbrRate,nominal:raw.nominal,effectiveRate:raw.effectiveRate,rateDate:raw.rateDate,source:raw.rateSource}:null,used:rate,canonicalMatches:rate?rate.effectiveRate===rate.cbrRate/rate.nominal:null}));
 }
 await assertCollectionEnabled('ajes_china_feed');
 try{
  const response=await fetch('https://www.che168.com/dealer/490679/59163228.html',{signal:AbortSignal.timeout(20000),redirect:'follow',headers:{'User-Agent':'AvtoCena owner-requested listing price comparison','Accept':'text/html'}});
  if(!response.ok){await response.body?.cancel();console.log('ORIGINAL_PAGE',JSON.stringify({status:response.status}));return;}
  const reader=response.body?.getReader();if(!reader)throw Error('empty');
  const chunks:Uint8Array[]=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error('large');}chunks.push(value);}
  const html=Buffer.concat(chunks).toString('utf8');
  const priceFields=[...html.matchAll(/["'](price|salePrice|sellPrice|dealerPrice|referencePrice|Price|SalePrice|SellPrice)["']\s*:\s*["']?(\d+(?:\.\d+)?)/g)].map(m=>({field:m[1],value:m[2]})).slice(0,20);
  const priceLabels=[...html.matchAll(/(?:售价|报价|价格)[^<>]{0,25}\d+(?:\.\d+)?\s*万/g)].map(m=>m[0]).slice(0,5);
  console.log('ORIGINAL_PAGE',JSON.stringify({status:response.status,bytes,finalHost:new URL(response.url).hostname,identityMention:html.includes('59163228'),challenge:/captcha|验证|访问异常|verify/i.test(html),priceFields,priceLabels}));
 }catch(e:any){console.log('ORIGINAL_PAGE',JSON.stringify({accessible:false,reason:'request_failed',code:typeof e?.cause?.code==='string'&&/^[A-Z_0-9]+$/.test(e.cause.code)?e.cause.code:undefined}));}
}
main().catch(()=>{console.log('PRICE_CHAIN_FAILED');process.exitCode=1;});
