import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {catalogDisplayGroup,catalogDisplayPrice} from './display-order';
import {catalogPowerBand} from './power-mix';
import {catalogBodyType} from './pickup-body';
import {calculatedCatalogPrice} from './calculated-price';
import {deliveryPricingBasis} from './card-city-delivery';
import {
 normalizedCatalogSearchProjection,projectionCanRenderCard,catalogSearchProjectionMatches,
 compilePreparedChinaFilterMetadataPredicate,type CatalogSearchProjection,
} from './storage';
import type {CatalogSearchParams,VehicleOffer} from './types';
import type {PreparedChinaIdLocation} from './prepared-china-id-locator';

const VERSION=1,PART_ROWS=8192,MAX_ROWS=1_000_000,MAX_OBJECT_BYTES=4*1024*1024,MAX_PART_BYTES=16*1024*1024;
const MAX_TOTAL_BYTES=128*1024*1024;
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,ID=/^[A-Za-z0-9_:-]{1,150}$/,CHUNK=/^chunk-\d{4,10}$/;
const fail=(reason:string):never=>{throw Error('prepared_china_filter:'+reason);};
const hash=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
const prefix=(generationId:string)=>`catalog/generations/${generationId}/indexes/prepared-china-read-v1/filters-v1/`;
const readyPath=(generationId:string,sha:string)=>prefix(generationId)+`ready-${sha}.json`;
const partPath=(generationId:string,ordinal:number,sha:string)=>prefix(generationId)+`parts/${ordinal}-${sha}.json`;
export type PreparedChinaFilterIndexRef={version:1;sha256:string};
type Context={generationId:string;marketDigest:string};
type Part={sha256:string;rows:number;bytes:number;decodedBytes:number};
type Directory=Context & {version:1;rows:number;cityOrderInvariant:boolean;parts:Part[]};
// Locations, admission, resolved filter values, source group, exact order keys.
// No photos, prices ledger, bibliography or full supplier row is retained.
export type PreparedChinaFilterEntry=[
 string,string,number,number,boolean,string,string,number|null,number|null,number|null,
 number|null,number|null,string,string,string,string,string,string,
 number,number,number,number,number,number,string,
];
const numeric=(value:unknown)=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const text=(value:unknown)=>String(value||'');

export function preparedChinaFilterEntry(row:CatalogSearchProjection,position:PreparedChinaIdLocation):PreparedChinaFilterEntry {
 if(row.market!=='china'||position.id!==row.id)return fail('identity');
 const resolved=normalizedCatalogSearchProjection(row),price=calculatedCatalogPrice(row);
 const entry:PreparedChinaFilterEntry=[row.id,position.chunk,position.part,position.offset,
  projectionCanRenderCard(row)&&catalogSearchProjectionMatches(row,{market:'china'}),
  text(resolved.make),text(resolved.model),numeric(resolved.year),numeric(resolved.mileageKm),numeric(resolved.engineCc||resolved.japanDeliveredPreview?.engineCc),
  numeric(resolved.powerHp),numeric(resolved.utilizationPowerKw),text(resolved.powertrainKind),text(resolved.fuel),catalogBodyType(resolved),
  text(resolved.transmission),text(resolved.drive),text(row.sourceGroup).trim(),
  Number(price>0),catalogDisplayGroup(row),catalogDisplayPrice(row),Number(catalogPowerBand(row as unknown as Partial<VehicleOffer>)==='low'),Number(price>0),
  Date.parse(String(row.auctionDate||row.sourcePublishedAt||row.firstSeenAt||row.updatedAt||''))||0,text(row.updatedAt),
 ];
 if(!validEntry(entry))return fail('row');
 return entry;
}
function validEntry(row:unknown):row is PreparedChinaFilterEntry {
 if(!Array.isArray(row)||row.length!==25||typeof row[0]!=='string'||!ID.test(row[0])||typeof row[1]!=='string'||!CHUNK.test(row[1])||
  !Number.isSafeInteger(row[2])||row[2]<0||row[2]>=500||!Number.isSafeInteger(row[3])||row[3]<0||row[3]>=128||typeof row[4]!=='boolean')return false;
 if([5,6,12,13,14,15,16,17,24].some(i=>typeof row[i]!=='string'||row[i].length>512))return false;
 if([7,8,9,10,11].some(i=>row[i]!==null&&(typeof row[i]!=='number'||!Number.isFinite(row[i]))))return false;
 return [18,21,22].every(i=>row[i]===0||row[i]===1)&&[0,1,2].includes(row[19])&&Number.isFinite(row[20])&&row[20]>=0&&Number.isFinite(row[23]);
}
function compareDisplay(a:PreparedChinaFilterEntry,b:PreparedChinaFilterEntry){
 return b[18]-a[18]||a[19]-b[19]||(a[19]===2?a[20]-b[20]:b[21]-a[21]);
}
function compareBase(a:PreparedChinaFilterEntry,b:PreparedChinaFilterEntry){
 return compareDisplay(a,b)||b[22]-a[22]||b[23]-a[23]||b[24].localeCompare(a[24]);
}
function cityOrderIsInvariant(row:CatalogSearchProjection){
 if('savedCalculationPreview' in row&&row.savedCalculationPreview||'deliveredCalculationPreview' in row&&row.deliveredCalculationPreview||row.japanDeliveredPreview)return false;
 const base=calculatedCatalogPrice(row),basis=deliveryPricingBasis(row.calculationSnapshot);
 if(!base||!basis)return true;
 if(!Number.isFinite(basis.subtotalRub)||!Number.isFinite(basis.deliveryRub)||basis.deliveryRub<0||
  !Array.isArray(basis.percents)||basis.percents.some(p=>!Number.isFinite(p)||p<0))return false;
 // Delivery is nonnegative. With nonnegative percentages, zero delivery is
 // the minimum possible city total; its positivity preserves the only city
 // dependent key of the default ordering.
 const minimum=base-basis.deliveryRub+basis.percents.reduce((sum,p)=>sum+
  Math.round((basis.subtotalRub-basis.deliveryRub)*p/100)-Math.round(basis.subtotalRub*p/100),0);
 return minimum>0;
}
function metadata(row:PreparedChinaFilterEntry):CatalogSearchProjection {
 return {id:row[0],market:'china',make:row[5],model:row[6],year:row[7],mileageKm:row[8],engineCc:row[9],powerHp:row[10],
  utilizationPowerKw:row[11],powertrainKind:row[12],fuel:row[13],bodyType:row[14],transmission:row[15],drive:row[16],
  editorialSpecifications:row[14]?{bodyType:row[14]}:undefined} as CatalogSearchProjection;
}

/** Offline producer only. The caller seals this reference into the authenticated directory. */
export function createPreparedChinaFilterIndex(context:Context){
 if(!GEN.test(context.generationId)||!SHA.test(context.marketDigest))return fail('scope');
 const rows:PreparedChinaFilterEntry[]=[],ids=new Set<string>(),locations=new Set<string>();
 let closed=false,cityOrderInvariant=true;
 return {
  add(row:CatalogSearchProjection,position:PreparedChinaIdLocation){
   if(closed||rows.length>=MAX_ROWS)return fail('writer_closed_or_full');
   const entry=preparedChinaFilterEntry(row,position),location=JSON.stringify(entry.slice(1,4));
   if(ids.has(row.id)||locations.has(location))return fail('duplicate');
   ids.add(row.id);locations.add(location);rows.push(entry);
   cityOrderInvariant&&=cityOrderIsInvariant(row);
  },
  async publish(put:(path:string,body:Buffer)=>Promise<void>):Promise<PreparedChinaFilterIndexRef>{
   if(closed||!rows.length)return fail('writer_closed_or_empty');
   closed=true;rows.sort(compareBase);
   const parts:Part[]=[];let decodedTotal=0;
   for(let start=0;start<rows.length;start+=PART_ROWS){
    const ordinal=parts.length,batch=rows.slice(start,start+PART_ROWS);
    const raw=Buffer.from(JSON.stringify({version:VERSION,...context,ordinal,rows:batch}));
    decodedTotal+=raw.length;
    if(raw.length>MAX_PART_BYTES||decodedTotal>MAX_TOTAL_BYTES)return fail('decoded_bytes');
    const body=Buffer.from(JSON.stringify({encoding:'gzip-base64',payload:gzipSync(raw,{level:6}).toString('base64')}));
    if(body.length>MAX_OBJECT_BYTES)return fail('object_bytes');
    const sha256=hash(body);
    await put(partPath(context.generationId,ordinal,sha256),body);
    parts.push({sha256,rows:batch.length,bytes:body.length,decodedBytes:raw.length});
   }
   const body=Buffer.from(JSON.stringify({version:VERSION,...context,rows:rows.length,cityOrderInvariant,parts} satisfies Directory));
   if(body.length>MAX_OBJECT_BYTES)return fail('directory_bytes');
   const ref:PreparedChinaFilterIndexRef={version:1,sha256:hash(body)};
   await put(readyPath(context.generationId,ref.sha256),body);
   return ref;
  },
 };
}

const allowed=new Set(['market','make','model','yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','powerFrom','powerTo',
 'fuel','bodyType','transmission','drive','city','sort','page','pageSize']);
export function supportsPreparedChinaFilterQuery(params:CatalogSearchParams){
 return params.market==='china'&&(!params.sort||params.sort==='updatedAt')&&
  Object.entries(params).every(([key,value])=>value===undefined||value===''||allowed.has(key));
}
type Loaded={rows:PreparedChinaFilterEntry[];bytes:number;cityOrderInvariant:boolean};
const cache=new DetailReadCache<Loaded>({maxEntries:2,maxBytes:192*1024*1024,ttlMs:6*3600_000,concurrency:1,sizeOf:v=>v.bytes*2});
export function resetPreparedChinaFilterIndexCacheForTests(){cache.clear();}
/** Read only. No request creates, repairs or publishes an index. */
export async function selectPreparedChinaFilterPage(context:Context & {rows:number},ref:PreparedChinaFilterIndexRef,
 params:CatalogSearchParams,input:{start:number;pageSize:number;countOnly:boolean},get:(key:string,sha:string)=>Promise<Buffer>){
 if(!supportsPreparedChinaFilterQuery(params))return null;
 if(!GEN.test(context.generationId)||!SHA.test(context.marketDigest)||ref?.version!==1||!SHA.test(ref.sha256)||
  !Number.isSafeInteger(context.rows)||context.rows<1||context.rows>MAX_ROWS||
  !Number.isSafeInteger(input.start)||input.start<0||!Number.isSafeInteger(input.pageSize)||input.pageSize<1||input.pageSize>48||
  !Number.isSafeInteger(input.start+input.pageSize))return fail('scope');
 const read=async(key:string,sha:string,bytes?:number)=>{
  const body=await get(key,sha);
  if(!Buffer.isBuffer(body)||!body.length||body.length>MAX_OBJECT_BYTES||hash(body)!==sha||bytes!==undefined&&body.length!==bytes)return fail('integrity');
  return JSON.parse(body.toString('utf8'));
 };
 const key=JSON.stringify([context.generationId,context.marketDigest,context.rows,ref.sha256]);
 const loaded=await cache.get(key,async()=>{
  const ready=await read(readyPath(context.generationId,ref.sha256),ref.sha256) as Directory;
  if(ready.version!==VERSION||ready.generationId!==context.generationId||ready.marketDigest!==context.marketDigest||ready.rows!==context.rows||typeof ready.cityOrderInvariant!=='boolean'||
   !Array.isArray(ready.parts)||ready.parts.length!==Math.ceil(ready.rows/PART_ROWS)||ready.parts.some((part,i)=>!part||!SHA.test(part.sha256)||
    part.rows!==Math.min(PART_ROWS,ready.rows-i*PART_ROWS)||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>MAX_OBJECT_BYTES||
    !Number.isSafeInteger(part.decodedBytes)||part.decodedBytes<1||part.decodedBytes>MAX_PART_BYTES)||
   ready.parts.reduce((sum,part)=>sum+part.decodedBytes,0)>MAX_TOTAL_BYTES)return fail('directory');
  const rows:PreparedChinaFilterEntry[]=[],ids=new Set<string>(),locations=new Set<string>();let decodedBytes=0;
  // Four compact immutable objects at a time; full card blocks are never read here.
  for(let start=0;start<ready.parts.length;start+=4){
   const parts=await Promise.all(ready.parts.slice(start,start+4).map(async(part,offset)=>{
    const ordinal=start+offset,v=await read(partPath(context.generationId,ordinal,part.sha256),part.sha256,part.bytes);
    if(v?.encoding!=='gzip-base64'||typeof v.payload!=='string'||v.payload.length>MAX_OBJECT_BYTES*2)return fail('encoding');
    const compressed=Buffer.from(v.payload,'base64');
    if(compressed.toString('base64')!==v.payload)return fail('encoding');
    const raw=gunzipSync(compressed,{maxOutputLength:MAX_PART_BYTES});
    if(raw.length!==part.decodedBytes)return fail('decoded_bytes');
    const data=JSON.parse(raw.toString('utf8'));
    if(data.version!==VERSION||data.generationId!==context.generationId||data.marketDigest!==context.marketDigest||data.ordinal!==ordinal||
     !Array.isArray(data.rows)||data.rows.length!==part.rows)return fail('part');
    return {rows:data.rows,bytes:raw.length};
   }));
   for(const part of parts){
    decodedBytes+=part.bytes;
    for(const row of part.rows){
     if(!validEntry(row))return fail('row');
     const location=JSON.stringify(row.slice(1,4));
     if(ids.has(row[0])||locations.has(location)||rows.length&&compareBase(rows[rows.length-1],row)>0)return fail('coverage_or_order');
     ids.add(row[0]);locations.add(location);rows.push(row);
    }
   }
   if(start+4<ready.parts.length)await new Promise<void>(resolve=>setImmediate(resolve));
  }
  if(rows.length!==context.rows)return fail('coverage');
  return {rows,bytes:decodedBytes,cityOrderInvariant:ready.cityOrderInvariant};
 });
 if(params.city&&!loaded.cityOrderInvariant)return null;
 const preset=params.powerTo===160&&Object.entries(params).every(([name,value])=>
  value===undefined||value===''||presetFields.has(name));
 let selection=preset?powerPreset.get(loaded):undefined;
 if(!selection){
  selection=selectMatchingRows(loaded,params,input.countOnly&&!preset);
  if(preset){
   powerPreset.set(loaded,selection);
   void selection.catch(()=>powerPreset.delete(loaded));
  }
 }
 const {total,ordered}=await selection;
 return {total,positions:input.countOnly?[]:ordered.slice(input.start,input.start+input.pageSize)};
}

// The power-only preset depends exclusively on this authenticated immutable
// index. Page number and a proven order-invariant city do not change the IDs.
const presetFields=new Set(['market','powerTo','page','pageSize','sort','city']);
type Selection={total:number;ordered:PreparedChinaFilterEntry[]};
const powerPreset=new WeakMap<Loaded,Promise<Selection>>();

async function selectMatchingRows(loaded:Loaded,params:CatalogSearchParams,countOnly:boolean){
 const matches=await compilePreparedChinaFilterMetadataPredicate(params),groups=new Map<string,PreparedChinaFilterEntry[]>();
 const matching:PreparedChinaFilterEntry[]=[];
 let total=0;
 for(let start=0;start<loaded.rows.length;start+=1024){
  const end=Math.min(start+1024,loaded.rows.length);
  for(let index=start;index<end;index++){
   const row=loaded.rows[index];
   if(!row[4]||!matches(metadata(row)))continue;
   total++;
   if(!countOnly){matching.push(row);const group=groups.get(row[17])||[];group.push(row);groups.set(row[17],group);}
  }
  if(start+1024<loaded.rows.length)await new Promise<void>(resolve=>setImmediate(resolve));
 }
 if(countOnly)return {total,ordered:[] as PreparedChinaFilterEntry[]};
 const known=[...groups].filter(([source])=>source),unknown=groups.get('')||[];
 let ordered:PreparedChinaFilterEntry[];
 if(known.length<2)ordered=matching;
 else{
  ordered=[];
  for(let depth=0;known.some(([,rows])=>depth<rows.length);depth++)for(const [,rows] of known)if(rows[depth])ordered.push(rows[depth]);
  ordered.push(...unknown);ordered.sort(compareDisplay);
 }
 return {total,ordered};
}

export function assertPreparedChinaFilterEntry(row:CatalogSearchProjection,entry:PreparedChinaFilterEntry){
 const current=preparedChinaFilterEntry(row,{id:entry[0],chunk:entry[1],part:entry[2],offset:entry[3]});
 if(JSON.stringify(current)!==JSON.stringify(entry))return fail('projection_parity');
}
