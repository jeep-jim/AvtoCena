import {heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {readAjesQueryCache,ajesQueryCacheLocation} from '../apps/web/lib/catalog/ajes-query-cache';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const store=getJsonStorage(),found=new Map<string,any>(),sample=new Map<string,any>();
 const lock:any=await store.readJson('catalog/import-lock.json',null);
 console.log('CATALOG_PREPARE_LOCK',JSON.stringify({present:!!lock,operationType:lock?.operationType,lockedUntil:lock?.lockedUntil}));
 for(let start=0;start<128;start+=8){
  const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson('catalog/partner-cache/ajes/queries/'+(start+n)+'.json',null).catch(()=>null)));
  for(const slot of slots as any[])for(const lot of slot?.value?.items||[]){
   if(lot.table==='stats'&&(!sample.has(lot.id)||Date.parse(slot.value.observedAt)>=Date.parse(sample.get(lot.id).savedAt)))sample.set(lot.id,{...lot,savedAt:slot.value.observedAt,evidence:slot.value.sourceEvidenceById?.[lot.id]});
   if(/^TOYOTA$/i.test(lot.make||'')&&/^COROLLA[ -]CROSS$/i.test(lot.model||'')&&lot.year===2023&&lot.finalPriceJpy===3302000&&(!found.has(lot.id)||Date.parse(slot.value.observedAt)>=Date.parse(found.get(lot.id).savedAt)))found.set(lot.id,{...lot,savedAt:slot.value.observedAt,schemaVersion:slot.value.schemaVersion,sourceEvidence:slot.value.sourceEvidenceById?.[lot.id]});
  }
 }
 const rows=[...sample.values()],dates=rows.map(l=>l.auctionDate).filter(Boolean).sort(),fuels=rows.reduce((a,l)=>{const k=String(l.sourceFuel||'(empty)');a[k]=(a[k]||0)+1;return a;},{} as Record<string,number>);
 console.log('AJES_CACHE_SAMPLE',JSON.stringify({uniqueLots:rows.length,dateMin:dates[0],dateMax:dates.at(-1),fuelValues:fuels,rawTimeEvidence:rows.filter(l=>l.evidence?.fields?.includes('TIME')).length,rawTimeEmpty:rows.filter(l=>l.evidence?.fields?.includes('TIME')&&!String(l.evidence.values?.TIME||'').trim()).length}));
 console.log('AJES_MATCHES',found.size);
 const makeDirectory=await readAjesQueryCache(store,ajesQuery({aggregate:'makes'}).sql);
 console.log('AJES_CACHED_MAKES',JSON.stringify({found:!!makeDirectory,observedAt:makeDirectory?.observedAt,received:makeDirectory?.received,makes:makeDirectory?.makes}));
 console.log('AJES_SAVED_BRANDS',JSON.stringify([...new Set(rows.map(l=>l.make))].sort()));
 console.log('AJES_SAVED_SYLPHY',JSON.stringify(rows.filter(l=>/^NISSAN$/i.test(l.make)&&/^SYLPHY$/i.test(l.model)).map(l=>({id:l.id,observedAt:l.savedAt,year:l.year}))));
 for(const [label,params] of [['all',{}],['KG11',{chassis:'KG11'}]] as const){
  const sql=ajesQuery({...params,aggregate:'count'}).sql;
  const count=await readAjesQueryCache(store,sql);
  console.log('AJES_EXACT_COUNT',JSON.stringify({label,found:!!count,total:count?.total,observedAt:count?.observedAt}));
 }
 for(const version of ['current','legacy'])for(let page=1;page<=10;page++){
  let sql=ajesQuery({aggregate:'models',page}).sql;
  if(version==='legacy')sql=sql.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(true));
  const directory=await readAjesQueryCache(store,sql);
  const models=directory?.models||[];
  console.log('AJES_EXACT_DIRECTORY',JSON.stringify({version,page,found:!!directory,received:directory?.received,observedAt:directory?.observedAt,total:models.reduce((n:number,m:any)=>n+m.total,0),allowedTotal:models.filter((m:any)=>!knownHeavyVehicleFamily(m.make,m.model)).reduce((n:number,m:any)=>n+m.total,0)}));
  if(directory&&directory.received<500)break;
 }

 const searchMatches=rows.filter(l=>String(l.chassisCode||'').toUpperCase()==='LA350A'&&String(l.lot)==='2910');
 console.log('AJES_SEARCH_SAVED',JSON.stringify({chassis:'LA350A',lot:'2910',matches:searchMatches.map(l=>({id:l.id,make:l.make,model:l.model,year:l.year,observedAt:l.savedAt,fuel:l.sourceFuel,rawTime:l.evidence?.values?.TIME}))}));
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
