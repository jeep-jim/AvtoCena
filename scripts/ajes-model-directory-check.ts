import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {convertToRub} from '../apps/web/lib/catalog/rates';
import {ajesChinaSourceCeiling} from '../apps/web/lib/catalog/ajes-price-policy';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('diagnostic_address_invalid');
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t}_feed`),reserve:t=>reserveAjesRequest(getJsonStorage(),t)});
 const rate=await convertToRub(1,'CNY');if(!rate)throw Error('rate_unavailable');
 // One bounded query, no shared response cache and no retry or address switch.
 const result=await client.read({table:'china',make:'BMW',aggregate:'models',sourcePriceTo:ajesChinaSourceCeiling(rate.effectiveRate)},ip);
 console.log('AJES_MODEL_DIRECTORY_CHECK',JSON.stringify({received:result.received,models:result.models?.length,stale:result.stale}));
}
main().catch(e=>{const reason=String(e?.reason||'local_failure');console.log('AJES_MODEL_DIRECTORY_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
