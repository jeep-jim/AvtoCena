import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const store=getJsonStorage();
 const raw:any=await store.readJson('catalog/partner-cache/ajes/evidence/stats-last-detail.json',null);
 const values=raw?.values||{};
 console.log('AJES_RAW_SPEC',JSON.stringify({found:!!raw,observedAt:raw?.observedAt,fields:raw?.fields,values:Object.fromEntries(['ENG_V','PW','FUEL','PRIV','KPP'].map(k=>[k,{type:typeof values[k],value:typeof values[k]==='number'||/^[A-Za-z0-9 .,/+-]{0,80}$/.test(String(values[k]??''))?values[k]: '[non-scalar]'}])),infoLength:String(values.INFO||'').length,infoFuelLabels:/fuel|топливо|燃料/i.test(String(values.INFO||'')),infoPowerLabels:/horsepower|мощност|馬力|[0-9]\\s*(?:hp|kw|ps)/i.test(String(values.INFO||''))}));
 const v:any=await store.readJson('catalog/partner-cache/ajes/stats/9LJNSVjqiWytqB.json',null);
 const l=v?.items?.[0];
 console.log('AJES_REQUESTED_LOT',JSON.stringify({found:!!l,engineCc:l?.engineCc,power:l?.sourcePower,fuel:l?.sourceFuel,drive:l?.sourceDrive,transmission:l?.sourceTransmission,photos:l?.images?.length}));
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
