import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from '../data';
import {readConfiguredRegcloudScope,chinaObjectDigest,validChinaPublicRef,type ChinaPublicRef} from './china-regcloud-object-reader';

export const UAE_PUBLIC_CONTROL='catalog/independent-market-public-v1/uae/control.json';
const PREFIX='catalog/private-market-stage-v1/uae/';
const SHA=/^[a-f0-9]{64}$/;
type Ref=ChinaPublicRef; // Same reviewed run/generation/digest reference ABI.
type Control={version:1;market:'uae';revision:number;active:Ref;previous:Ref|null};
type Ready={
 version:1;kind:'uae-private-runtime-ready-v1';market:'uae';runId:string;generationId:string;
 sourceReceiptSha256:string;priceReceiptSha256:string;retainedDetailReceiptSha256:string;
 publicDirectorySha256:string;editorialReceiptSha256:string;
 admitted:{seller:number;onRequest:number;retainedDelivered:number};legalValidUntil:number;
};
type Directory={version:1;kind:'uae-public-directory-v1';market:'uae';generationId:string;
 sourceReceiptSha256:string;priceReceiptSha256:string;admitted:Ready['admitted'];blocks?:{rows:number;sha256:string}[];detailShards?:Record<string,{rows:number;sha256:string}>};
const fail=(reason:string):never=>{throw Error('uae_regcloud:'+reason);};
const exact=(value:object,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const ref=(x:Ref)=>!!x&&validChinaPublicRef(x)&&exact(x,['runId','generationId','readySha256']);
const sha=(x:unknown)=>typeof x==='string'&&SHA.test(x);
const nonnegative=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const parse=<T>(data:Buffer)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)) as T;
const fingerprint=()=>chinaObjectDigest([readConfiguredRegcloudScope(),process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY]);
const checksum=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export const uaeRegcloudRuntimeConfigured=()=>process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME==='1';

/** An opt-in UAE-only read capability, not a writer, router or auth grant.
 * READY must be emitted by an independently reviewed producer. Existing raw
 * source/delta seals lack seller/delivered/editorial/public-directory parity. */
export async function openConfiguredUaeRegcloudFiles(target:'active'|'previous'='active'){
 if(!uaeRegcloudRuntimeConfigured())return null;
 const config=fingerprint(),storage=new ObjectJsonStorage();
 const guardConfig=()=>{
  if(!uaeRegcloudRuntimeConfigured()||fingerprint()!==config)return fail('storage_changed');
 };
 const readControl=async()=>{
  guardConfig();const o=await storage.readScopedControl(UAE_PUBLIC_CONTROL);guardConfig();
  if(!o||!o.etag||!o.data.length||o.data.length>32*1024||checksum(o.data)!==o.checksum)return fail('control_missing_or_corrupt');
  return o;
 };
 const current=await readControl(),state=parse<Control>(current.data);
 if(!state||state.version!==1||state.market!=='uae'||!exact(state,['version','market','revision','active','previous'])||
  !Number.isSafeInteger(state.revision)||state.revision<1||!ref(state.active)||
  (state.previous!==null&&(!ref(state.previous)||state.previous.generationId===state.active.generationId)))return fail('control_scope');
 if(target==='previous'&&!state.previous)return null;
 const active=Object.freeze({...state[target]!});
 const root=PREFIX+active.runId+'/';
 const fence=async()=>{
  const check=await readControl();
  if(check.etag!==current.etag||check.checksum!==current.checksum)return fail('cut_changed');
 };
 const get=async(name:string,digest:string,max:number)=>{
  guardConfig();const obj=await storage.getBinaryBounded(root+name,max);guardConfig();
  if(!obj.data.length||obj.data.length>max||obj.checksum!==digest||checksum(obj.data)!==digest)return fail('immutable_digest');
  return obj.data;
 };
 const ready=parse<Ready>(await get('READY.json',active.readySha256,32*1024));
 if(!ready||ready.version!==1||ready.kind!=='uae-private-runtime-ready-v1'||ready.market!=='uae'||
  ready.runId!==active.runId||ready.generationId!==active.generationId||
  ![ready.sourceReceiptSha256,ready.priceReceiptSha256,ready.publicDirectorySha256,
    ready.retainedDetailReceiptSha256,ready.editorialReceiptSha256].every(sha)||
  !ready.admitted||!exact(ready.admitted,['seller','onRequest','retainedDelivered'])||
  !Object.values(ready.admitted).every(nonnegative)||
  !Number.isSafeInteger(ready.admitted.seller+ready.admitted.onRequest+ready.admitted.retainedDelivered)||
  ready.admitted.seller+ready.admitted.onRequest+ready.admitted.retainedDelivered===0||
  !Number.isSafeInteger(ready.legalValidUntil)||ready.legalValidUntil<=Date.now())return fail('ready_scope');
 const assertCurrent=async()=>{
  if(ready.legalValidUntil<=Date.now())return fail('legal_horizon');
  await fence();
  if(ready.legalValidUntil<=Date.now())return fail('legal_horizon');
 };
 await assertCurrent();
 const issued=new WeakSet<object>();
 const readPublicDirectory=async()=>{
   await assertCurrent();
   const directory=parse<Directory>(await get('public-directory.json',ready.publicDirectorySha256,4*1024*1024));
   if(directory?.version!==1||directory.kind!=='uae-public-directory-v1'||directory.market!=='uae'||
    directory.generationId!==active.generationId||directory.sourceReceiptSha256!==ready.sourceReceiptSha256||
    directory.priceReceiptSha256!==ready.priceReceiptSha256||!directory.admitted||
    !exact(directory.admitted,['seller','onRequest','retainedDelivered'])||
    directory.admitted.seller!==ready.admitted.seller||directory.admitted.onRequest!==ready.admitted.onRequest||
    directory.admitted.retainedDelivered!==ready.admitted.retainedDelivered)return fail('directory_scope');
   await assertCurrent();
   const view=Object.freeze({...directory,admitted:Object.freeze({...directory.admitted}),
    ...(Array.isArray(directory.blocks)?{blocks:Object.freeze(directory.blocks.map(b=>Object.freeze({...b})))}:{}),
    ...(directory.detailShards&&typeof directory.detailShards==='object'?{
     detailShards:Object.freeze(Object.fromEntries(Object.entries(directory.detailShards).map(([k,v])=>[k,Object.freeze({...v})])))
    }:{})}) as Directory;
   issued.add(view);return view;
 };
 return Object.freeze({generationId:active.generationId,revision:state.revision,readySha256:active.readySha256,
  readPublicDirectory,
  async *readProjectionBlocks(directory:Awaited<ReturnType<typeof readPublicDirectory>>){
   const blocks=directory.blocks,expected=[directory.admitted.seller,directory.admitted.onRequest,directory.admitted.retainedDelivered].reduce((a,b)=>a+b,0);
   // Only the authenticated directory read from this handle may address blocks.
   if(!issued.has(directory)||!Array.isArray(blocks)||blocks.length<1||blocks.length>512||
    blocks.some(b=>!Number.isSafeInteger(b?.rows)||b.rows<1||b.rows>512||!sha(b?.sha256))||
    blocks.reduce((n,b)=>n+b.rows,0)!==expected)return fail('projection_directory');
   for(const [ordinal,block] of blocks.entries()){
    const doc=parse<{version:number;market:string;generationId:string;ordinal:number;items:unknown[]}>(await get(`projection/${ordinal}.json`,block.sha256,4*1024*1024));
    if(doc?.version!==1||doc.market!=='uae'||doc.generationId!==active.generationId||doc.ordinal!==ordinal||
     !Array.isArray(doc.items)||doc.items.length!==block.rows)return fail('projection_block_scope');
    yield doc.items;
   }
   await assertCurrent();
  },
  async readDetail(directory:Awaited<ReturnType<typeof readPublicDirectory>>,id:string){
   if(!issued.has(directory)||typeof id!=='string'||!/^[a-zA-Z0-9_:-]{1,128}$/.test(id))return fail('detail_scope');
   const map=directory.detailShards;
   if(!map||Array.isArray(map)||Object.keys(map).length<1||Object.keys(map).length>256||
    Object.entries(map).some(([key,d])=>!/^[0-9a-f]{2}$/.test(key)||!Number.isSafeInteger(d?.rows)||d.rows<1||d.rows>512||!sha(d?.sha256))||
    Object.values(map).reduce((n,d)=>n+d.rows,0)!==Object.values(directory.admitted).reduce((a,b)=>a+b,0))return fail('detail_directory');
   const label=checksum(Buffer.from(id)).slice(0,2),binding=map[label];
   await assertCurrent();
   if(!binding)return null;
   const doc=parse<{version:number;market:string;generationId:string;shard:string;items:{id:string}[]}>(
    await get(`details/${label}.json`,binding.sha256,4*1024*1024));
   if(doc?.version!==1||doc.market!=='uae'||doc.generationId!==active.generationId||doc.shard!==label||
    !Array.isArray(doc.items)||doc.items.length!==binding.rows||
    doc.items.some(row=>typeof row?.id!=='string'||checksum(Buffer.from(row.id)).slice(0,2)!==label)||
    new Set(doc.items.map(row=>row.id)).size!==binding.rows)return fail('detail_block_scope');
   await assertCurrent();
   return doc.items.find(row=>row.id===id)||null;
  },assertCurrent});
}
