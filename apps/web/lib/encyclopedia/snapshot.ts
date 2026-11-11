import {randomUUID} from 'node:crypto';
import {hash,modelId,variantSignature,ROOT,summarize} from './records';
import {cleanText,numberFields,textFields,safeUrl,type ModelRecord,type Variant,type EncyclopediaManifest} from './schema';
export function createSnapshotBuilder(at=new Date().toISOString()){
 const models=new Map<string,ModelRecord>(),signatures=new Map<string,Map<string,Variant>>(),coverage:Record<string,number>={};
 return {models,coverage,add(row:Record<string,any>,origin:'observed'|'reference'='observed'){
  const make=cleanText(row.make,80),model=cleanText(row.model,100);if(!make||!model)return;
  const id=modelId(make,model);let record=models.get(id);
  if(!record){record={id,make,model,photo:'',revision:randomUUID(),updatedAt:at,variants:[]};models.set(id,record);signatures.set(id,new Map());}
  if(!record.photo){record.photo=safeUrl(row.cardImageUrl||row.photo||row.images?.[0]?.url);if(record.photo)record.photoMarket=row.market;}
  const v:Variant={id:'',markets:['china','japan','korea','uae','europe','georgia'].includes(row.market)?[row.market]:[],status:origin==='reference'?'review':'observed',observedCount:origin==='observed'?1:0};
  for(const f of textFields)if(row[f])v[f]=cleanText(row[f],f==='sourceUrl'?1500:160);
  for(const f of numberFields){const n=Number(row[f]);if(Number.isFinite(n)&&n>0&&(f!=='year'||Number.isInteger(n)&&n>=1900&&n<=new Date(at).getFullYear()+1))v[f]=n;}
  // UAE supplier power and volume remain untrusted; no resurrection from titles.
  if(row.market==='uae'&&origin==='observed'){delete v.engineCc;delete v.powerHp;delete v.powerKw;delete v.icePowerKw;delete v.motorPeakKw;delete v.systemPowerKw;delete v.power30MinKw;delete v.frontMotor30MinKw;delete v.rearMotor30MinKw;}
  if((row.market!=='uae'||origin==='reference')&&Array.isArray(row.power30MinKwByMotor))v.motors30MinKw=row.power30MinKwByMotor.filter((x:unknown)=>Number.isFinite(Number(x))&&Number(x)>0).join('; ')||undefined;
  const signature=variantSignature(v),previous=signatures.get(id)!.get(signature);
  if(previous){previous.observedCount+=v.observedCount;previous.markets=[...new Set([...previous.markets,...v.markets])];if(!previous.sourceUrl&&v.sourceUrl)previous.sourceUrl=v.sourceUrl;}
  else {v.id=hash(id+signature);record.variants.push(v);signatures.get(id)!.set(signature,v);}
  if(origin==='observed'&&row.market)coverage[row.market]=(coverage[row.market]||0)+1;
 }};
}
export async function publishSnapshot(storage:{readJson:Function;writeJson:Function},builder:ReturnType<typeof createSnapshotBuilder>,generationId:string,savedSearchRows:number,at:string){
 if(await storage.readJson(`${ROOT}/manifest.json`,null))throw Error('encyclopedia_snapshot_already_exists');
 if(!builder.models.size)throw Error('encyclopedia_empty_snapshot');
 const run=randomUUID(),summaries=[];
 const records=[...builder.models.values()].sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,'ru'));
 for(let i=0;i<records.length;i+=8){summaries.push(...await Promise.all(records.slice(i,i+8).map(async record=>{const key=`${ROOT}/snapshots/${run}/${record.id}.json`;record.variants.sort((a,b)=>(b.year||0)-(a.year||0)||(a.powerHp||0)-(b.powerHp||0));await storage.writeJson(key,record,{ifNoneMatch:'*'});return summarize(record,key);})));}
 const manifest:EncyclopediaManifest={version:1,capturedAt:at,updatedAt:at,generationId,models:summaries,coverage:builder.coverage,savedSearchRows};
 await storage.writeJson(`${ROOT}/manifest.json`,manifest,{ifNoneMatch:'*'});return manifest;
}
