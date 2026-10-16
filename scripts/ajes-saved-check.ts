import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const store=getJsonStorage(),found=new Map<string,any>();
 const lock:any=await store.readJson('catalog/import-lock.json',null);
 console.log('CATALOG_PREPARE_LOCK',JSON.stringify({present:!!lock,operationType:lock?.operationType,lockedUntil:lock?.lockedUntil}));
 for(let start=0;start<128;start+=8){
  const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson('catalog/partner-cache/ajes/queries/'+(start+n)+'.json',null).catch(()=>null)));
  for(const slot of slots as any[])for(const lot of slot?.value?.items||[]){
   if(/^MAZDA$/i.test(lot.make||'')&&/^CX[- ]?8$/i.test(lot.model||'')&&lot.year===2021&&lot.finalPriceJpy===1305000)found.set(lot.id,{...lot,savedAt:slot.value.observedAt,schemaVersion:slot.value.schemaVersion});
  }
 }
 console.log('AJES_MATCHES',found.size);
 const raw:any=await store.readJson('catalog/partner-cache/ajes/evidence/stats-last-detail.json',null);
 console.log('AJES_RAW_MATCH',JSON.stringify({present:!!raw,matchesOwnerLot:!!raw&&found.has(raw.id),observedAt:raw?.observedAt}));
 if(raw){
  const fields=Object.fromEntries(['ENG_V','PW','TIME','FUEL','PRIV','KPP'].map(k=>[k,{present:Array.isArray(raw.fields)&&raw.fields.includes(k),type:typeof raw.values?.[k],value:raw.values?.[k]}]));
  console.log('AJES_LAST_RAW',JSON.stringify({matchesOwnerLot:found.has(raw.id),observedAt:raw.observedAt,fields,infoLength:String(raw.values?.INFO||'').length}));
 }
 for(const [id,list] of [...found].slice(0,3)){
  console.log('AJES_OWNER_LIST',JSON.stringify({observedAt:list.savedAt,schemaVersion:list.schemaVersion,engineCc:list.engineCc,power:list.sourcePower,fuel:list.sourceFuel,fuelField:list.sourceFuelField,drive:list.sourceDrive,chassisCode:list.chassisCode}));
  const v:any=await store.readJson('catalog/partner-cache/ajes/stats/'+id+'.json',null),l=v?.items?.[0];
  console.log('AJES_OWNER_LOT',JSON.stringify({found:!!l,observedAt:v?.observedAt,schemaVersion:v?.schemaVersion,chassisCode:l?.chassisCode,framePresent:!!l?.frameNumber,engineCc:l?.engineCc,power:l?.sourcePower,fuel:l?.sourceFuel,drive:l?.sourceDrive,transmission:l?.sourceTransmission,photos:l?.images?.length,infoLength:String(l?.info||'').length}));
 }
 if(found.size===1){
  const id=[...found.keys()][0];
  const client=createAjesClient({password:ajesPassword,assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),reserve:t=>reserveAjesRequest(store,t),saveEvidence:async(_table,e)=>{
   console.log('AJES_EXACT_RAW',JSON.stringify({fields:e.fields,values:Object.fromEntries(['ENG_V','PW','TIME','FUEL','PRIV','KPP'].map(k=>[k,e.values[k]])),infoLength:String(e.values.INFO||'').length}));
  }});
  try{const fresh=await client.read({table:'stats',id},process.env.AJES_DIAG_IP||'');console.log('AJES_EXACT_RESULT',JSON.stringify({ok:true,accepted:fresh.items.length}));}
  catch(e){console.log('AJES_EXACT_RESULT',JSON.stringify({ok:false,reason:e instanceof AjesUnavailable?e.reason:'check_failed'}));}
 }
 for(const kind of ['count','models']){
 const v:any=await store.readJson('catalog/partner-cache/ajes/evidence/'+kind+'-last.json',null);
 console.log('AJES_AGGREGATE',JSON.stringify({kind,evidence:v}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
