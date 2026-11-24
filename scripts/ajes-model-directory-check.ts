import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('diagnostic_address_invalid');
 const client=createAjesClient({password:ajesPassword,assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),reserve:t=>reserveAjesRequest(getJsonStorage(),t)});
 // Two bounded Japan reads: the actual model spelling and one matching page.
 const directory=await client.read({table:'stats',make:'HONDA',aggregate:'models'},ip);
 const models=(directory.models||[]).filter((x:any)=>/STEP/i.test(x.model));
 console.log('FILTER_JAPAN_MODELS',JSON.stringify({received:directory.received,models}));
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const selection=resolveAjesModelSelection('STEP WAGON',directory.models||[],'HONDA');
 const page=await client.read({table:'stats',make:'HONDA',...selection,pageSize:5},ip);
 console.log('FILTER_SOURCE_RESULT',JSON.stringify({table:'stats',received:page.received,accepted:page.items.length,powers:page.items.map((x:any)=>x.sourcePower),models:page.items.map((x:any)=>x.model),years:page.items.map((x:any)=>x.year)}));

}
main().catch(e=>{const reason=String(e?.reason||'local_failure');console.log('FILTER_LOCAL_ERROR',JSON.stringify({name:e?.name,code:/^[A-Z_0-9]{1,40}$/.test(e?.code||'')?e.code:undefined,message:typeof e?.message==='string'&&/^Cannot find module ['"](?:next|react)/.test(e.message)?e.message.split('\n')[0]:undefined}));console.log('AJES_MODEL_DIRECTORY_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
