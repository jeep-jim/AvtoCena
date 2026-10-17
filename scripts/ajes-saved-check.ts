import {ajesClient} from '../apps/web/lib/catalog/ajes-runtime';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const store=getJsonStorage(),found=new Map<string,any>();
 const lock:any=await store.readJson('catalog/import-lock.json',null);
 console.log('CATALOG_PREPARE_LOCK',JSON.stringify({present:!!lock,operationType:lock?.operationType,lockedUntil:lock?.lockedUntil}));
 for(let start=0;start<128;start+=8){
  const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson('catalog/partner-cache/ajes/queries/'+(start+n)+'.json',null).catch(()=>null)));
  for(const slot of slots as any[])for(const lot of slot?.value?.items||[]){
   if(/^TOYOTA$/i.test(lot.make||'')&&/^COROLLA[ -]CROSS$/i.test(lot.model||'')&&lot.year===2023&&lot.finalPriceJpy===3302000&&(!found.has(lot.id)||Date.parse(slot.value.observedAt)>=Date.parse(found.get(lot.id).savedAt)))found.set(lot.id,{...lot,savedAt:slot.value.observedAt,schemaVersion:slot.value.schemaVersion,sourceEvidence:slot.value.sourceEvidenceById?.[lot.id]});
  }
 }
 console.log('AJES_MATCHES',found.size);
 try{
  const list=await ajesClient.read({table:'stats',make:'SUBARU',model:'FORESTER',chassis:'SKE',lotNumber:'30132'},process.env.AJES_DIAG_IP||'');
  console.log('AJES_FORESTER_SEARCH',JSON.stringify({observedAt:list.observedAt,stale:list.stale,items:list.items.map((l:any)=>({id:l.id,lot:l.lot,chassis:l.chassisCode,date:l.auctionDate,fuel:l.sourceFuel,power:l.sourcePower,engine:l.engineCc}))}));
  const match=list.items.find((l:any)=>l.year===2022&&String(l.auctionDate).startsWith('2026-08-19'));
  if(match){const detail=await ajesClient.read({table:'stats',id:match.id},process.env.AJES_DIAG_IP||'');console.log('AJES_FORESTER_DETAIL',JSON.stringify({id:match.id,stale:detail.stale,sourceEvidence:detail.sourceEvidence,items:detail.items.map((l:any)=>({fuel:l.sourceFuel,power:l.sourcePower,chassis:l.chassisCode,drive:l.sourceDrive,engine:l.engineCc}))}));}
 }catch(e){console.log('AJES_FORESTER_FAILURE',JSON.stringify({reason:(e as any)?.reason||'failed'}));}

 for(const table of ['main','stats']){const q:any=await store.readJson('catalog/operations/ajes-quota-'+table+'.json',null);console.log('AJES_QUOTA_STATE',JSON.stringify({table,buckets:q?.buckets}));}
 const raw:any=await store.readJson('catalog/partner-cache/ajes/evidence/stats-last-detail.json',null);
 console.log('AJES_RAW_MATCH',JSON.stringify({present:!!raw,matchesOwnerLot:!!raw&&found.has(raw.id),observedAt:raw?.observedAt}));
 if(raw){
  const fields=Object.fromEntries(['ENG_V','PW','TIME','FUEL','PRIV','KPP'].map(k=>[k,{present:Array.isArray(raw.fields)&&raw.fields.includes(k),type:typeof raw.values?.[k],value:raw.values?.[k]}]));
  console.log('AJES_LAST_RAW',JSON.stringify({matchesOwnerLot:found.has(raw.id),observedAt:raw.observedAt,fields,fieldNames:raw.fields,infoLength:String(raw.values?.INFO||'').length}));
 }
 for(const [id,list] of [...found].slice(0,3)){
  console.log('AJES_OWNER_LIST',JSON.stringify({observedAt:list.savedAt,schemaVersion:list.schemaVersion,engineCc:list.engineCc,power:list.sourcePower,fuel:list.sourceFuel,fuelField:list.sourceFuelField,drive:list.sourceDrive,chassisCode:list.chassisCode}));
  const v:any=await store.readJson('catalog/partner-cache/ajes/stats/'+id+'.json',null),l=v?.items?.[0];
  console.log('AJES_OWNER_LIST_RAW',JSON.stringify(list.sourceEvidence||null));
  const exact=v?.sourceEvidence;console.log('AJES_OWNER_RAW',JSON.stringify({present:!!exact,matches:exact?.id===id,observedAt:exact?.observedAt,fields:exact?.fields,values:exact?.id===id?exact.values:undefined}));
  const info=String(l?.info||'');let infoUrl:any=null;try{const u=new URL(info);infoUrl={scheme:u.protocol,host:u.hostname,queryKeys:[...u.searchParams.keys()],pathParts:u.pathname.split('/').filter(Boolean).length};}catch{}
  let infoKeys:string[]=[];try{const x=JSON.parse(info);if(x&&typeof x==='object')infoKeys=Object.keys(x).slice(0,30);}catch{}
  console.log('AJES_INFO_SHAPE',JSON.stringify({length:info.length,url:infoUrl,jsonKeys:infoKeys,tags:[...info.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map(m=>m[1]).slice(0,20),technicalWords:info.match(/diesel|petrol|gasoline|power|fuel|horsepower|дизель|бензин|мощность|топливо|軽油|ガソリン|馬力|燃料|error|access|denied|bot|http|iframe|javascript/gi)}));
  console.log('AJES_OWNER_LOT',JSON.stringify({id,lot:l?.lot,auction:l?.auction,found:!!l,observedAt:v?.observedAt,schemaVersion:v?.schemaVersion,chassisCode:l?.chassisCode,framePresent:!!l?.frameNumber,engineCc:l?.engineCc,power:l?.sourcePower,fuel:l?.sourceFuel,drive:l?.sourceDrive,transmission:l?.sourceTransmission,photos:l?.images?.length,infoLength:String(l?.info||'').length}));
 }
 for(const kind of ['count','models']){
 const v:any=await store.readJson('catalog/partner-cache/ajes/evidence/'+kind+'-last.json',null);
 console.log('AJES_AGGREGATE',JSON.stringify({kind,evidence:v}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
