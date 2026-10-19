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
 // Four bounded reads; stop on any refusal. No retries, address substitution or payload logs.
 const query={table:'china' as const,make:'Volkswagen',powerTo:160,sort:'totalRub' as const,pageSize:5,sourcePriceTo:ajesChinaSourceCeiling(rate.effectiveRate)};
 console.log('AJES_POWER_QUERY',ajesQuery(query).sql);
 const page=await client.read(query,ip);
 console.log('AJES_POWER_PAGE',JSON.stringify({received:page.received,accepted:page.items.length,powers:page.items.map((x:any)=>x.sourcePower),observedAt:page.observedAt}));
 if(!page.items.length)throw Error('unexpected_empty');
 const count=await client.read({...query,aggregate:'count'},ip);
 console.log('AJES_POWER_COUNT',JSON.stringify({total:count.total,observedAt:count.observedAt}));
 const directory=await client.read({table:'korea',aggregate:'makes'},ip);
 const names=(directory.makes||[]).filter((x:any)=>canonicalCatalogBrand(x.make)==='Mercedes-Benz');
 console.log('AJES_MERCEDES_NAMES',JSON.stringify({received:directory.received,names}));
 if(!names.length)throw Error('mercedes_directory_missing');
 const cars=await client.read({table:'korea',make:resolveAjesMakeNames('Mercedes-Benz',names),pageSize:5},ip);
 console.log('AJES_MERCEDES_PAGE',JSON.stringify({received:cars.received,accepted:cars.items.length,observedAt:cars.observedAt}));
}
main().catch(e=>{const reason=String(e?.reason||'local_failure');console.log('AJES_MODEL_DIRECTORY_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
