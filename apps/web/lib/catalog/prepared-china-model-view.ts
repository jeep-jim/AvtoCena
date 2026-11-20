import {createHash} from 'node:crypto';
import {compareSortNumbers} from './catalog-sort';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import type {PreparedChinaIdLocation} from './prepared-china-id-locator';

const PAGE=64,MAX_ROWS=32_768,MAX_BYTES=256*1024;
const SHA=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_:-]{1,150}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,CHUNK=/^chunk-\d{4,10}$/;
const fail=(code:string):never=>{throw Error('prepared_china_model:'+code);};
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
type PriceKey={rub:number;id:string};
export type PreparedChinaModelPosition=PreparedChinaIdLocation & {rub:number};
type Block={sha:string;first:PriceKey;last:PriceKey;rows:number};
type View={version:1;generationId:string;keySha256:string;total:number;blocks:Block[]};
export type PreparedChinaModelViewRef={keySha256:string;viewSha256:string};
const prefix=(g:string,key:string)=>`catalog/generations/${g}/indexes/prepared-china-read-v1/models/${key}/`;
const indexPath=(g:string,ref:PreparedChinaModelViewRef)=>prefix(g,ref.keySha256)+`ready-${ref.viewSha256}.json`;
const blockPath=(g:string,key:string,num:number,sha:string)=>prefix(g,key)+`parts/${num}-${sha}.json`;
const keyOf=({rub,id}:PriceKey)=>({rub,id});
const compare=(a:PriceKey,b:PriceKey)=>compareSortNumbers(a.rub,b.rub,'totalRub')||a.id.localeCompare(b.id);
const priceKey=(row:PriceKey)=>!!row&&typeof row.id==='string'&&ID.test(row.id)&&Number.isSafeInteger(row.rub)&&row.rub>0;
const position=(row:PreparedChinaModelPosition)=>priceKey(row)&&typeof row.chunk==='string'&&CHUNK.test(row.chunk)&&
 Number.isSafeInteger(row.part)&&row.part>=0&&row.part<CATALOG_CHUNK_SIZE&&Number.isSafeInteger(row.offset)&&row.offset>=0&&row.offset<128;

export function createPreparedChinaModelView(generationId:string,keySha256:string){
 if(!GEN.test(generationId)||!SHA.test(keySha256))return fail('scope');
 let closed=false;
 const positions:PreparedChinaModelPosition[]=[],ids=new Set<string>();
 return {
  add(row:PreparedChinaModelPosition){
   if(closed||positions.length>=MAX_ROWS||!position(row)||ids.has(row.id))return fail('position');
   positions.push({...row});ids.add(row.id);
  },
  async publish(put:(path:string,body:Buffer)=>Promise<void>){
   if(closed)return fail('writer_closed');
   closed=true;
   positions.sort(compare);
   const blocks:Block[]=[];
   for(let start=0;start<positions.length;start+=PAGE){
    const rows=positions.slice(start,start+PAGE),ordinal=blocks.length;
    const body=Buffer.from(JSON.stringify({version:1,generationId,keySha256,ordinal,rows}));
    if(body.length>MAX_BYTES)return fail('block_bytes');
    const sha=hash(body);
    await put(blockPath(generationId,keySha256,ordinal,sha),body);
    blocks.push({sha,first:keyOf(rows[0]),last:keyOf(rows.at(-1)!),rows:rows.length});
   }
   const body=Buffer.from(JSON.stringify({version:1,generationId,keySha256,total:positions.length,blocks} satisfies View));
   if(body.length>MAX_BYTES)return fail('view_bytes');
   const ref={keySha256,viewSha256:hash(body)};
   await put(indexPath(generationId,ref),body);
   return ref;
  },
 };
}

function lower(size:number,match:(i:number)=>boolean){
 let lo=0,hi=size;
 while(lo<hi){const mid=(lo+hi)>>>1;if(match(mid))hi=mid;else lo=mid+1;}
 return lo;
}

export async function selectPreparedChinaModelPage(generationId:string,ref:PreparedChinaModelViewRef,input:{
 lower?:number;upper?:number;start:number;pageSize:number;countOnly:boolean;
},get:(key:string,expectedSha:string)=>Promise<Buffer>){
 const {start,pageSize,countOnly}=input,from=input.lower??0,to=input.upper??Infinity;
 if(!GEN.test(generationId)||!SHA.test(ref?.keySha256)||!SHA.test(ref?.viewSha256)||
    !Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>48||
    !Number.isSafeInteger(start+pageSize)||!Number.isFinite(from)||from<0||Number.isNaN(to)||to<0)return fail('scope');
 const read=async(key:string,sha:string)=>{
  const body=await get(key,sha);
  if(!body.length||body.length>MAX_BYTES||hash(body)!==sha)return fail('integrity');
  return JSON.parse(body.toString('utf8'));
 };
 const {keySha256}=ref;
 const view=await read(indexPath(generationId,ref),ref.viewSha256) as View;
 if(view.version!==1||view.generationId!==generationId||view.keySha256!==keySha256||
    !Number.isSafeInteger(view.total)||view.total<0||view.total>MAX_ROWS||
    !Array.isArray(view.blocks)||view.blocks.length!==Math.ceil(view.total/PAGE)||
    view.blocks.some((b,i)=>!b||!SHA.test(b.sha)||!priceKey(b.first)||!priceKey(b.last)||compare(b.first,b.last)>0||
      b.rows!==Math.min(PAGE,view.total-i*PAGE)||(i>0&&compare(view.blocks[i-1].last,b.first)>=0)))return fail('directory');
 if(!view.total||from>to)return {total:0,positions:[]};
 const cached=new Map<number,PreparedChinaModelPosition[]>();
 const part=async(ordinal:number)=>{
  if(cached.has(ordinal))return cached.get(ordinal)!;
  const b=view.blocks[ordinal];
  const v=await read(blockPath(generationId,keySha256,ordinal,b.sha),b.sha);
  if(v.version!==1||v.generationId!==generationId||v.keySha256!==keySha256||v.ordinal!==ordinal||
     !Array.isArray(v.rows)||v.rows.length!==b.rows||v.rows.some((row:PreparedChinaModelPosition,i:number)=>!position(row)||(i>0&&compare(v.rows[i-1],row)>=0))||
     compare(v.rows[0],b.first)!==0||compare(v.rows.at(-1),b.last)!==0)return fail('block');
  cached.set(ordinal,v.rows);
  return v.rows as PreparedChinaModelPosition[];
 };
 const first=lower(view.blocks.length,i=>view.blocks[i].last.rub>=from);
 const past=lower(view.blocks.length,i=>view.blocks[i].last.rub>to);
 const edge=async(ordinal:number,limit:number,strict:boolean)=>{
  if(ordinal===view.blocks.length)return view.total;
  const check=(rub:number)=>strict?rub>limit:rub>=limit;
  if(check(view.blocks[ordinal].first.rub))return ordinal*PAGE;
  const rows=await part(ordinal);
  return ordinal*PAGE+lower(rows.length,i=>check(rows[i].rub));
 };
 const begin=await edge(first,from,false),end=await edge(past,to,true);
 const total=Math.max(0,end-begin);
 if(countOnly||start>=total)return {total,positions:[]};
 const positions:PreparedChinaModelPosition[]=[],stop=Math.min(end,begin+start+pageSize);
 for(let offset=begin+start;offset<stop;){
  const ordinal=Math.floor(offset/PAGE),rows=await part(ordinal);
  const take=Math.min(stop-offset,rows.length-offset%PAGE);
  positions.push(...rows.slice(offset%PAGE,offset%PAGE+take));offset+=take;
 }
 return {total,positions};
}
