import {createHash} from 'node:crypto';
import {
 catalogMakeFilterValues,catalogSearchProjectionComparator,facetsForPreparedChinaCompatibilityRows,
 orderPreparedChinaCompatibilityRows,type CatalogSearchProjection,type CatalogFacetProjection,
} from './storage';
import type {CatalogSearchParams} from './types';

const fail=():never=>{throw Error('prepared_china_streaming_selector');};
const makeKey=(value:string)=>value.replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
const MAKE_BYTES=64;
/** Exact-hit conservative dispatch (a Bloom collision can only add a read).
 * Raw prices are deliberately not pruned: city and safe-price semantics differ. */
function makeBits(key:string){
 const hash=createHash('sha256').update(key).digest();
 return [hash.readUInt16LE(0),hash.readUInt16LE(2),hash.readUInt16LE(4)].map(x=>x%(MAKE_BYTES*8));
}
export type ChinaSelectorPart={makeMask:string;minYear:number;maxYear:number};
export function summarizeChinaSelectorPart(rows:CatalogSearchProjection[]):ChinaSelectorPart {
 const mask=Buffer.alloc(MAKE_BYTES),years=rows.map(row=>Number(row.year||0));
 for(const row of rows)for(const bit of makeBits(makeKey(row.make)))mask[bit>>3]|=1<<(bit%8);
 if(!years.length||years.some(year=>!Number.isSafeInteger(year)||year<0))return fail();
 return {makeMask:mask.toString('hex'),minYear:Math.min(...years),maxYear:Math.max(...years)};
}
export function compileChinaPartDispatch(params:CatalogSearchParams){
 const makes=catalogMakeFilterValues(params.make).map(value=>makeBits(makeKey(value)));
 return (part:ChinaSelectorPart)=>{
  if(!part||!/^[a-f0-9]{128}$/.test(part.makeMask)||!Number.isSafeInteger(part.minYear)||
     !Number.isSafeInteger(part.maxYear)||part.minYear<0||part.minYear>part.maxYear)return fail();
  if(params.yearFrom&&part.maxYear<params.yearFrom||params.yearTo&&part.minYear>params.yearTo)return false;
  const mask=Buffer.from(part.makeMask,'hex');
  return !makes.length||makes.some(bits=>bits.every(bit=>(mask[bit>>3]&(1<<(bit%8)))!==0));
 };
}
type Ordered={row:CatalogSearchProjection;ordinal:number;bytes?:number};
/** Bounded worst-first heap. Sorting a page never buffers all matching cards. */
class Top {
 private readonly heap:Ordered[]=[];
 constructor(private readonly size:number,private readonly rank:(a:Ordered,b:Ordered)=>number){}
 add(item:Ordered){
  const itemBytes=()=>item.bytes??=Buffer.byteLength(JSON.stringify(item.row));
  const data=this.heap;
  if(data.length<this.size){
   let i=data.length;data.push(item);
   while(i>0){const p=(i-1)>>1;if(this.rank(data[p],item)>=0)break;data[i]=data[p];i=p;}
   data[i]=item;return itemBytes();
  }
  if(this.rank(item,data[0])>=0)return 0;
  const evicted=data[0].bytes!;
  let i=0;for(let child=1;child<data.length;child=i*2+1){
   if(child+1<data.length&&this.rank(data[child+1],data[child])>0)child++;
   if(this.rank(item,data[child])>=0)break;
   data[i]=data[child];i=child;
  }
  data[i]=item;return itemBytes()-evicted;
 }
 values(){return this.heap;}
}
export function createChinaSelectorPage(params:CatalogSearchParams,limit:number){
 const bounds={maxRetainedRows:32_768,maxDepth:8_192},tops=new Map<string,Top>();
 if(!Number.isSafeInteger(limit)||limit<0||limit>bounds.maxDepth)return fail();
 const originalCompare=catalogSearchProjectionComparator(params.sort,params.city);
 const rank=(a:Ordered,b:Ordered)=>originalCompare(a.row,b.row)||a.ordinal-b.ordinal;
 const balance=!params.sort||params.sort==='updatedAt';
 let ordinal=0,retained=0;
 const add=(top:Top,row:CatalogSearchProjection)=>{
  retained+=top.add({row,ordinal:ordinal++});
  if(retained>24*1024*1024)return fail();
 };
 return {
  add(row:CatalogSearchProjection){
   if(!limit)return;
   const source=balance?String(row.sourceGroup||'').trim():'',current=tops.get(source);
   if(current){add(current,row);return;}
   if((tops.size+1)*limit>bounds.maxRetainedRows)return fail();
   const top=new Top(limit,rank);tops.set(source,top);add(top,row);
  },
  finish(){
   // For any source, entries ranked beyond K have K rows of that same source
   // ahead of them. Per-source truncation therefore preserves the prefix even
   // after the native source interleave and final stable display rank.
   const rows=[...tops.values()].flatMap(top=>top.values()).sort((a,b)=>a.ordinal-b.ordinal).map(x=>x.row);
   orderPreparedChinaCompatibilityRows(rows,params);
   return rows.slice(0,limit);
  },
 };
}
const dims=['make','bodyType','fuel','transmission','drive'] as const;
export function createChinaSelectorFacets(generationId:string,params:CatalogSearchParams){
 const dimensions=new Set<string>(),models=new Set<string>(),representatives:CatalogFacetProjection[]=[];
 const hasFilters=Object.entries(params).some(([key,value])=>!['market','city','page','pageSize','sort'].includes(key)&&value!==undefined&&value!=='');
 const clean=(value:unknown)=>String(value||'').replace(/\s+/g,' ').trim();
 return {
  add(row:CatalogSearchProjection){
   let novel=false;
   for(const dim of dims){const key=dim+':'+clean(row[dim]);if(!dimensions.has(key)){dimensions.add(key);novel=true;}}
   if(hasFilters){const key=clean(row.make)+':'+clean(row.model);if(!models.has(key)){models.add(key);novel=true;}}
   if(novel){if(representatives.length>=32_768)return fail();const {make,model,bodyType,fuel,transmission,drive}=row;representatives.push({make,model,bodyType,fuel,transmission,drive});}
  },
  finish(){return facetsForPreparedChinaCompatibilityRows(generationId,representatives,params);},
 };
}

export const chinaSelectorNavigationQuery={market:'china',hasPrice:'yes'} as const;
