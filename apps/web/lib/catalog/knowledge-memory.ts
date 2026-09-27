import {createHash} from 'node:crypto';
import {getJsonStorage,StorageConflictError} from '../data';
import {canonicalCatalogBrand} from './brands';
import {vehicleKnowledgeCompact} from './vehicle-knowledge';
import {DetailReadCache} from './detail-read-cache';
export const MEMORY_SHARDS=32,MEMORY_MAX_ROWS=256,MEMORY_MAX_BYTES=256*1024;
export type VehicleMemory={id:string;make:string;model:string;market:string;year:number;engineCc?:number;fuel?:string;powerHp?:number;powerKw?:number;price?:number;currency?:string;image?:string;offerId:string;sourceId:string;seenAt:string};
export const knowledgeIdentity=(make:string,model:string)=>`${canonicalCatalogBrand(make)}:${vehicleKnowledgeCompact(model)}`;
const shard=(make:string,model:string)=>String(parseInt(createHash('sha256').update(knowledgeIdentity(make,model)).digest('hex').slice(0,2),16)%MEMORY_SHARDS).padStart(2,'0');
const file=(id:string)=>`catalog/knowledge-memory/v1/${id}.json`;
const positive=(n:any,max:number)=>Number.isFinite(Number(n))&&Number(n)>0&&Number(n)<=max?Number(n):undefined;
export function memoryObservation(row:any):VehicleMemory|null{
 const make=canonicalCatalogBrand(String(row.make||'')),model=String(row.model||'').trim().slice(0,100),year=positive(row.year,2100);
 if(!make||!model||!year||year<1950||!row.id||row.sourceId==='manual_link')return null;
 const engineCc=positive(row.engineCc,20000),powerHp=positive(row.powerHp,2500),powerKw=positive(row.powerKw,2000),fuel=String(row.fuel||'').slice(0,30),market=String(row.market||'');
 const id=createHash('sha256').update(JSON.stringify([knowledgeIdentity(make,model),market,year,engineCc,fuel,powerHp,powerKw])).digest('hex').slice(0,24);
 const rawImage=String(row.cardImageUrl||row.images?.[0]?.url||'');
 return {id,make,model,market,year,engineCc,fuel,powerHp,powerKw,price:positive(row.sourcePrice,1e12),currency:String(row.sourceCurrency||'').slice(0,3),image:rawImage.startsWith('https://')||rawImage.startsWith('/api/')?rawImage.slice(0,1200):undefined,offerId:String(row.id).slice(0,180),sourceId:String(row.sourceId||row.sourceGroup||'public_catalog').slice(0,80),seenAt:String(row.updatedAt||'').slice(0,30)};
}
export function mergeVehicleMemory(previous:VehicleMemory[],incoming:VehicleMemory[]){
 const map=new Map<string,VehicleMemory>();
 for(const row of [...previous,...incoming]){const old=map.get(row.id);if(!old||row.seenAt>=old.seenAt)map.set(row.id,row);}
 const rows=[...map.values()].sort((a,b)=>b.seenAt.localeCompare(a.seenAt)||a.id.localeCompare(b.id)).slice(0,MEMORY_MAX_ROWS);
 while(Buffer.byteLength(JSON.stringify(rows,null,2))>MEMORY_MAX_BYTES)rows.pop();
 return rows;
}
async function saveShard(key:string,rows:VehicleMemory[]){
 const storage=getJsonStorage();
 for(let attempt=0;attempt<4;attempt++){
  const meta=await storage.readJsonWithMeta<VehicleMemory[]>(file(key),[]);
  const next=mergeVehicleMemory(meta.value,rows);
  if(JSON.stringify(meta.value)===JSON.stringify(next))return next;
  try{await storage.writeJson(file(key),next,meta.found&&meta.etag?{ifMatch:meta.etag}:{ifNoneMatch:'*'});return next;}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
 }
 throw new StorageConflictError();
}
export async function rememberPublishedVehicles(offers:any[]){
 const groups=new Map<string,VehicleMemory[]>();for(const offer of offers){const row=memoryObservation(offer);if(!row)continue;const key=shard(row.make,row.model);const list=groups.get(key)||[];list.push(row);groups.set(key,list);}
 let records=0,bytes=0;
 // Fixed mutable shards, sequential bounded writes; no per-view or per-keystroke persistence.
 for(const [key,rows] of groups){const saved=await saveShard(key,rows);records+=saved.length;bytes+=Buffer.byteLength(JSON.stringify(saved,null,2));}
 return {shards:groups.size,records,bytes,maxBytes:MEMORY_SHARDS*MEMORY_MAX_BYTES};
}
const reads=new DetailReadCache<VehicleMemory[]>({maxEntries:8,maxBytes:2*1024*1024,ttlMs:60000,concurrency:2});
export async function recallVehicleMemory(make:string,model:string){const key=shard(make,model);const rows=await reads.get(key,()=>getJsonStorage().readJson<VehicleMemory[]>(file(key),[]));return rows.filter(row=>knowledgeIdentity(row.make,row.model)===knowledgeIdentity(make,model));}
