import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {convertToRub} from '../apps/web/lib/catalog/rates';
import {ajesChinaSourceCeiling} from '../apps/web/lib/catalog/ajes-price-policy';
import {resolveAjesMakeNames} from '../apps/web/lib/catalog/ajes-make-resolution';
import {canonicalCatalogBrand} from '../apps/web/lib/catalog/brands';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('diagnostic_address_invalid');
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t==='main'||t==='stats'?'japan':t}_feed`),reserve:t=>reserveAjesRequest(getJsonStorage(),t)});
 const rate=await convertToRub(1,'CNY');if(!rate)throw Error('rate_unavailable');
 // Five bounded requested checks. Stop on the first refusal; never retry another address.
 const directory=await client.read({table:'china',make:'TOYOTA',aggregate:'models'},ip);
 const names=(directory.models||[]).filter((x:any)=>/corolla/i.test(x.model));
 console.log('FILTER_CHINA_MODELS',JSON.stringify({received:directory.received,names}));
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const models=resolveAjesModelSelection('COROLLA',directory.models||[],'TOYOTA');
 const strict={table:'china' as const,make:'TOYOTA',...models,yearFrom:2022,yearTo:2025,mileageTo:1500,powerTo:160,sort:'totalRub' as const,pageSize:5,sourcePriceTo:ajesChinaSourceCeiling(rate.effectiveRate)};
 const {ajesOffer}=await import('../apps/web/lib/catalog/ajes-offer');
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 for(const [label,query] of [['china_exact',strict],['china_model',{...strict,mileageTo:undefined}],['japan_model',{table:'stats',make:'HONDA',model:'STEPWGN',pageSize:5}],['korea_power',{table:'korea',make:'MERCEDES BENZ',powerTo:160,pageSize:5}]] as const){
  console.log('FILTER_QUERY',label,ajesQuery(query).sql);
  const page=await client.read(query,ip);
  console.log('FILTER_SOURCE_RESULT',JSON.stringify({label,received:page.received,accepted:page.items.length,powers:page.items.map((x:any)=>x.sourcePower),mileage:page.items.map((x:any)=>x.mileageKm),years:page.items.map((x:any)=>x.year)}));
  if(label==='china_exact'&&page.items.length){
   try{
   const offers=await Promise.all(page.items.map(async(lot:any)=>{const rate=await convertToRub(lot.sourcePrice,'CNY');if(!rate)throw Error('rate_unavailable');return ajesOffer(lot,rate,page.observedAt);}));
   const {applyActiveBusinessPricingBatch}=await import('../apps/web/lib/catalog/live-business-pricing');
   const priced=await applyActiveBusinessPricingBatch(offers);
   const filter=ajesResultFilter({budgetTo:2400000,city:'Санкт-Петербург',powerTo:160});
   console.log('FILTER_DELIVERED_RESULT',JSON.stringify({matched:priced.filter(filter.matches).length,offers:priced.map((x:any)=>({hp:x.powerHp,engineCc:x.engineCc,fuel:x.fuel,body:x.bodyType,total:x.deliveredCalculationPreview?.totalRub||x.japanDeliveredPreview?.totalRub||x.totalRub||null,status:x.calculationSnapshot?.customs?.status,missing:x.calculationSnapshot?.missing||x.calculationSnapshot?.customs?.missing||[]}))}));
   }catch(e:any){console.log('FILTER_PRICING_UNAVAILABLE',JSON.stringify({name:e?.name,code:/^[A-Z_0-9]{1,40}$/.test(e?.code||'')?e.code:undefined}));}
  }
 }

}
main().catch(e=>{const reason=String(e?.reason||'local_failure');console.log('FILTER_LOCAL_ERROR',JSON.stringify({name:e?.name,code:/^[A-Z_0-9]{1,40}$/.test(e?.code||'')?e.code:undefined,message:typeof e?.message==='string'&&/^Cannot find module ['"](?:next|react)/.test(e.message)?e.message.split('\n')[0]:undefined}));console.log('AJES_MODEL_DIRECTORY_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
