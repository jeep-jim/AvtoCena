import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const store=getJsonStorage(),found=new Map<string,any>();
 const lock:any=await store.readJson('catalog/import-lock.json',null);
 console.log('CATALOG_PREPARE_LOCK',JSON.stringify({present:!!lock,operationType:lock?.operationType,lockedUntil:lock?.lockedUntil}));
 for(let start=0;start<128;start+=8){
  const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson('catalog/partner-cache/ajes/queries/'+(start+n)+'.json',null).catch(()=>null)));
  for(const slot of slots as any[])for(const lot of slot?.value?.items||[]){
   if(/NISSAN/i.test(lot.make||'')&&/X[- ]?TRAIL/i.test(lot.model||'')&&lot.year===2016&&lot.finalPriceJpy===465000)found.set(lot.id,lot);
  }
 }
 console.log('AJES_MATCHES',found.size);
 for(const [id] of [...found].slice(0,3)){
  const v:any=await store.readJson('catalog/partner-cache/ajes/stats/'+id+'.json',null),l=v?.items?.[0];
  console.log('AJES_OWNER_LOT',JSON.stringify({found:!!l,engineCc:l?.engineCc,power:l?.sourcePower,fuel:l?.sourceFuel,drive:l?.sourceDrive,transmission:l?.sourceTransmission,photos:l?.images?.length,infoLength:String(l?.info||'').length}));
 }
 for(const kind of ['count','models']){
 const v:any=await store.readJson('catalog/partner-cache/ajes/evidence/'+kind+'-last.json',null);
 console.log('AJES_AGGREGATE',JSON.stringify({kind,evidence:v}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
