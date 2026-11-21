import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ObjectJsonStorage,getJsonStorage,LocalJsonStorage,resetJsonStorageForTests} from '../../../apps/web/lib/data.ts';
import {loadSourceEvidence,EDITORIAL_KEY,EXPECTED,CBR_21_NOV} from './qualify.mjs';
import {makeExactUaePorts} from './native-ports.mts';
import {sha,hash,Q,readQualification,materializeRows,makeReadyFiles} from './ready.mjs';
const E=process.env, req=(x:unknown,c:string)=>assert.ok(x,c);
const sourcePath=/^(?:source-prepared\.json|(?:source-input|predecessor-evidence)\/chunk-\d{4}\.ndjson)$/;
const decisionPath=/^(?:sealed-private-qualification\.json|decisions\/part-\d{4}\.ndjson)$/;
const priorPath=/^catalog\/generations\/gen_\d{13}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/;
const PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const RECORD='b2513d16f614312978534964327de665bf3b35e67a7c698b184789d0cbc93beb';
const CURSOR='7af8b18e95cb5f4e63b4ad428eaf25b0942561e9cf17cf4fb9bda40832e5572a';
const REFS='6cc21d16b68f49d291e983f3b23fbedb9c500092143da9862bb5eedd7268c3c0';
const until=Date.parse('2026-11-22T00:00:00Z');
let phase='authority';
async function run(){
 const runId=E.GITHUB_RUN_ID!, now=Date.now();
 req(E.GITHUB_REPOSITORY_ID==='1289722938'&&E.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&E.GITHUB_REF==='refs/heads/main'&&E.GITHUB_RUN_ATTEMPT==='1'
  &&E.GITHUB_JOB==='materialize'&&E.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/uae-private-ready-22867-v1.yml@refs/heads/main'
  &&/^[1-9]\d{8,14}$/.test(runId)&&E.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
  &&E.YC_OBJECT_STORAGE_REGION==='us-east-1'&&E.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
  &&E.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'&&E.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1','uae_ready_private_role');
 req(now>=Date.parse(EXPECTED.observed)&&now+300000<until,'uae_ready_price_cut_expired');
 const [base]=process.argv.slice(2);req(process.argv.length===3&&base===path.resolve(base)&&await fs.realpath(base)===base
    &&((await fs.stat(base)).mode&0o077)===0&&!(await fs.readdir(base)).length,'uae_ready_private_local_dir');
 const stage='catalog/private-market-stage-v1/uae/'+runId+'/', generationId='gen_'+now+'_uae'+runId;
 const out=/^(?:READY\.json|public-directory\.json|retained-evidence\.json|input-evidence\.json|projection\/\d{1,3}\.json|details\/[a-f0-9]{2}\.json)$/;
 const fixed=['catalog/manifest.json','catalog/intake-cursors/v1/uae.json',EDITORIAL_KEY];
 const storage=new ObjectJsonStorage(), realFetch=globalThis.fetch;let gets=0,puts=0;
 const readAllowed=(k:string)=>fixed.includes(k)||(k.startsWith(EXPECTED.root)&&sourcePath.test(k.slice(EXPECTED.root.length)))
  ||(k.startsWith(Q.root)&&decisionPath.test(k.slice(Q.root.length)))||priorPath.test(k)||(k.startsWith(stage)&&out.test(k.slice(stage.length)));
 globalThis.fetch=async(i,o:any={})=>{
  const u=new URL(i instanceof Request?i.url:String(i)),method=o.method??(i instanceof Request?i.method:'GET');
  if(u.origin==='https://avtocena.com'&&u.pathname==='/api/health'&&!u.search&&method==='GET')return realFetch(i,{...o,redirect:'error'});
  req(u.origin==='https://s3.regru.cloud'&&u.pathname.startsWith(PREFIX)&&!u.search&&!u.username&&!u.password,'uae_ready_transport_denied');
  const k=decodeURIComponent(u.pathname.slice(PREFIX.length));
  if(method==='PUT')req(k.startsWith(stage)&&out.test(k.slice(stage.length))&&new Headers(o.headers).get('if-none-match')==='*'&&++puts<=500,'uae_ready_write_scope');
  else req(['GET','HEAD'].includes(method)&&!o.body&&readAllowed(k)&&++gets<=950,'uae_ready_read_scope');
  return realFetch(i,{...o,redirect:'error'});
 };
 async function read(key:string,cap:number){
  req(readAllowed(key),'uae_ready_unauthorized_key');const v=await storage.getBinary(key);
  req(Buffer.isBuffer(v.data)&&v.size===v.data.length&&v.size>0&&v.size<=cap,'uae_ready_read_size');return v.data;
 }
 async function editorial(){
  const p=await storage.readObjectMetadata(EDITORIAL_KEY);
  req(p.found&&p.etag,'uae_ready_editorial_missing');
  const b=await read(EDITORIAL_KEY,8*1024*1024), conf=await storage.readObjectMetadata(EDITORIAL_KEY),index=JSON.parse(b.toString());
  req(sha(b)===Q.editorial&&conf.found&&conf.etag===p.etag&&index?.revision&&index.entries&&typeof index.entries==='object','uae_ready_editorial_changed');
  return {index,etag:p.etag};
 }
 async function live(){
  const [m,c,r]=await Promise.all([read(fixed[0],1024*1024),read(fixed[1],1024*1024),
    fetch('https://avtocena.com/api/health',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','cache-control':'no-cache'}})]);
  const manifest=JSON.parse(m.toString()),cursor=JSON.parse(c.toString()),health=r.ok?await r.json():null,u=manifest?.markets?.uae;
  const keys=u?.chunks?.map((k:string)=> /^chunk-\d{4,6}$/.test(k)?'catalog/generations/'+manifest.generationId+'/offers/uae/'+k+'.json':k);
  req(hash(u)===RECORD&&hash(cursor)===CURSOR&&hash(keys)===REFS&&health?.ok===true&&health.releaseSha===EXPECTED.release
   &&health.calculationVersion===EXPECTED.calc,'uae_ready_live_predecessor_changed');
 }
 phase='verified_inputs';
 const [source,qualification,ed]=await Promise.all([loadSourceEvidence(read),readQualification(read),editorial(),live()]);
 const rates=Object.fromEntries(['AED','USD','EUR'].map(c=>[c,{currency:c,nominal:1,cbrRate:(CBR_21_NOV as any)[c],
   rateDate:CBR_21_NOV.rateDate,rateSource:'cbr'}]));
 await fs.mkdir(path.join(base,'data','fees'),{mode:0o700,recursive:true});
 await fs.writeFile(path.join(base,'data','fees','exchange-rates.json'),JSON.stringify({...rates,updatedAt:CBR_21_NOV.rateDate}),{flag:'wx',mode:0o600});
 process.chdir(base);E.JSON_STORAGE_DRIVER='local';E.CATALOG_LIVE_RATE_DISABLED='1';resetJsonStorageForTests();
 const local=getJsonStorage();req(local instanceof LocalJsonStorage,'uae_ready_native_local_only');
 for(const name of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix','createBinaryDownloadUrl']){
  if(typeof(local as any)[name]==='function')(local as any)[name]=async()=>{throw Error('uae_ready_native_write_denied');};
 }
 const ports=makeExactUaePorts({editorial:ed,withPinnedNativeInputs:(_fx:any,fn:any)=>fn(),
   exactEditorialPhotoReady:()=>{throw Error('uae_ready_unused_gallery_callback');},
   exactRetainedBuyerProof:()=>{throw Error('uae_ready_unused_retention_callback');}});
 phase='native_selected_rows';
 const rows=await materializeRows({read,source,qualification,ports,editorial:ed,fx:{rates}});
 phase='private_plan';
 const plan=await makeReadyFiles({rows,qualification,ports,runId,generationId,legalValidUntil:until});
 console.log(JSON.stringify({phase,objects:plan.paths.size,wireBytes:plan.bytes,admitted:plan.ready.admitted,
   photoCards:plan.photoCards,projectionBlocks:plan.blocks,detailShards:plan.detailShards,publicPointerWrites:0,supplierRequests:0}));
 const assertFence=async()=>{const [edNow]=await Promise.all([editorial(),live()]);req(edNow.etag===ed.etag&&Date.now()+30000<until,'uae_ready_final_context_changed');};
 await assertFence();phase='private_createonly';
 async function create(v:any){
  req(out.test(v.name)&&v.body.length<=4*1024*1024,'uae_ready_stage_key_shape');
  await storage.putBinary(stage+v.name,v.body,'application/json',{ifNoneMatch:'*'});
  req(sha(await read(stage+v.name,v.body.length))===v.sha256,'uae_ready_create_readback');
 }
 for(const item of plan.paths.values())if(item.name!=='READY.json')await create(item);
 await assertFence();
 phase='private_ordinary_readback';
 const need=new Set(Object.values(plan.samples).map((x:any)=>x.id));
 const projected=new Map();
 for(const item of plan.paths.values())if(item.name.startsWith('projection/')&&need.size){
  const body=JSON.parse(item.body.toString());for(const x of body.items)if(need.has(x.id))projected.set(x.id,x);
 }
 for(const x of Object.values(plan.samples) as any[]){
  const b=JSON.parse((await read(stage+'details/'+x.shard+'.json',4*1024*1024)).toString());
  const d=b.items.find((o:any)=>o.id===x.id), p=projected.get(x.id);
  req(d?.id===p?.id&&d?.id===x.id&&b.generationId===generationId&&(d.sellerPriceRub??null)===x.sellerPriceRub
    &&(p.sellerPriceRub??null)===x.sellerPriceRub&&d.totalRub==null&&p.totalRub==null,'uae_ready_list_detail_positive_parity');
 }
 await assertFence();await create(plan.paths.get('READY.json'));
 console.log(JSON.stringify({status:'verified_uae_private_ready',market:'uae',runId,generationId,readySha256:plan.readySha256,
  sourceReceiptSha256:EXPECTED.sha,priceReceiptSha256:Q.sha,editorialReceiptSha256:Q.editorial,admitted:plan.ready.admitted,
  oldRetainedWithoutFreshness:2150,heldNotPromoted:Q.held,positiveSamples:Object.keys(plan.samples),photoCards:plan.photoCards,
  legalValidUntil:until,storageReads:gets,privateWrites:puts,rawExported:false,supplierRequests:0,
  publicPointerWrites:0,cursorWrites:0,published:false,activatesNothing:true}));
}
run().catch(e=>{const code=/^uae_[a-z0-9_]+$/.test(e?.message)?e.message:'uae_private_ready_hold';console.error(JSON.stringify({phase,code,published:false}));process.exitCode=1;});
