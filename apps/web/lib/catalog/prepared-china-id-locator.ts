import {createHash} from 'node:crypto';
import {detailHash,type DetailShard} from './detail-shards';
import {CATALOG_CHUNK_SIZE} from './runtime-config';

const ROOTS=256,LEAF_ROWS=256,MAX_BYTES=128*1024;
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,CHUNK=/^chunk-\d{4,10}$/,ID=/^[A-Za-z0-9_:-]{1,150}$/;
export type PreparedChinaIdLocation={id:string;chunk:string;part:number;offset:number};
type Node={version:1;generationId:string;prefix:string;items?:PreparedChinaIdLocation[];children?:Array<string|null>};
const fail=(code:string):never=>{throw Error('prepared_china_locator:'+code);};
const rootPosition=(prefix:string)=>parseInt(prefix,16);
const sha256=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
const path=(g:string,prefix:string,sha:string)=>`catalog/generations/${g}/indexes/prepared-china-read-v1/ids/${prefix}-${sha}.json`;
const isLocation=(row:PreparedChinaIdLocation,prefix:string)=>!!row&&ID.test(row.id)&&detailHash(row.id).startsWith(prefix)&&
 CHUNK.test(row.chunk)&&Number.isSafeInteger(row.part)&&row.part>=0&&row.part<CATALOG_CHUNK_SIZE&&
 Number.isSafeInteger(row.offset)&&row.offset>=0&&row.offset<128;

export function validPreparedChinaIdRoots(roots:unknown):roots is Array<string|null>{
 return Array.isArray(roots)&&roots.length===ROOTS&&roots.every(x=>x===null||(typeof x==='string'&&SHA.test(x)));
}

/** Reuse the existing detail-spool partition by complete stable ID. All paths
 * here are generation scoped; unlike normal detail aliases it never writes a public root. */
export function createPreparedChinaIdShardWriter(generationId:string,put:(path:string,body:Buffer)=>Promise<void>){
 if(!GEN.test(generationId))return fail('generation');
 const roots:Array<string|null>=Array.from({length:ROOTS},()=>null);
 const pending=new Map<string,string>();
 const seenRoots=new Set<string>();
 let rows=0;
 return {
  async write(prefix:string,shard:DetailShard<PreparedChinaIdLocation>){
   if(!/^[a-f0-9]{2,64}$/.test(prefix)||seenRoots.has(prefix)||pending.has(prefix))return fail('prefix');
   if(prefix.length===2)seenRoots.add(prefix);
   if(!shard.children&&!shard.items.length){if(prefix.length!==2)return fail('empty_child');return;}
   const node:Node={version:1,generationId,prefix};
   if(shard.children){
    if(shard.items.length||prefix.length===64)return fail('branch');
    node.children=Array.from({length:16},(_,n)=>{
     const child=prefix+n.toString(16),value=pending.get(child)||null;pending.delete(child);return value;
    });
    if(!node.children.some(Boolean))return fail('branch_empty');
   }else{
    if(shard.items.length>LEAF_ROWS||shard.items.some(row=>!isLocation(row,prefix))||
       new Set(shard.items.map(row=>row.id)).size!==shard.items.length)return fail('leaf');
    node.items=shard.items;
    rows+=node.items.length;
   }
   const body=Buffer.from(JSON.stringify(node)),digest=sha256(body);
   if(body.length>MAX_BYTES)return fail('bytes');
   await put(path(generationId,prefix,digest),body);
   if(prefix.length>2)pending.set(prefix,digest);
   else roots[rootPosition(prefix)]=digest;
  },
  finish(expectedRows:number){
   if(seenRoots.size!==ROOTS||pending.size||rows!==expectedRows)return fail('coverage');
   return roots;
  },
 };
}

/** One key path from the authenticated generation directory, no LIST or
 * market projection scan. In a split bucket only the chosen child is read. */
export async function readPreparedChinaIdLocation(generationId:string,roots:Array<string|null>,id:string,
 read:(path:string,sha:string)=>Promise<Buffer>){
 if(!GEN.test(generationId)||!validPreparedChinaIdRoots(roots))return fail('scope');
 if(typeof id!=='string'||!ID.test(id))return null;
 const full=detailHash(id);
 let depth=2,next=roots[rootPosition(full.slice(0,depth))];
 while(next){
  const prefix=full.slice(0,depth);
  const body=await read(path(generationId,prefix,next),next);
  if(!body.length||body.length>MAX_BYTES||sha256(body)!==next)return fail('bytes');
  const node=JSON.parse(body.toString('utf8')) as Node;
  if(node.version!==1||node.generationId!==generationId||node.prefix!==prefix)return fail('identity');
  if(node.children!==undefined){
   if(node.items!==undefined||depth>=64||!Array.isArray(node.children)||node.children.length!==16||
      !node.children.some(Boolean)||node.children.some(v=>v!==null&&(typeof v!=='string'||!SHA.test(v))))return fail('branch');
   next=node.children[rootPosition(full[depth++])];
  }else{
   if(!Array.isArray(node.items)||!node.items.length||node.items.length>LEAF_ROWS||
      node.items.some(row=>!isLocation(row,prefix))||new Set(node.items.map(row=>row.id)).size!==node.items.length)return fail('leaf');
   return node.items.find(row=>row.id===id)||null;
  }
 }
 return null;
}
