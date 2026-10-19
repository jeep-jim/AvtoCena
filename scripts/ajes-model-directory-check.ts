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
 // Two bounded reads after the Japan sort fix; stop on the first refusal.
 for(const query of [{table:'stats' as const,make:'HONDA',model:'STEPWGN',pageSize:5},{table:'korea' as const,make:'MERCEDES BENZ',powerTo:160,pageSize:5}]){
  const page=await client.read(query,ip);
  console.log('FILTER_SOURCE_RESULT',JSON.stringify({table:query.table,received:page.received,accepted:page.items.length,powers:page.items.map((x:any)=>x.sourcePower),mileage:page.items.map((x:any)=>x.mileageKm),years:page.items.map((x:any)=>x.year)}));
 }

}
main().catch(e=>{const reason=String(e?.reason||'local_failure');console.log('FILTER_LOCAL_ERROR',JSON.stringify({name:e?.name,code:/^[A-Z_0-9]{1,40}$/.test(e?.code||'')?e.code:undefined,message:typeof e?.message==='string'&&/^Cannot find module ['"](?:next|react)/.test(e.message)?e.message.split('\n')[0]:undefined}));console.log('AJES_MODEL_DIRECTORY_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
