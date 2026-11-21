import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collect,ROOT,SEAL_KEY} from './collector.mjs';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {COLLECTION_CONTROLS_KEY,validateCollectionControls} from '../../../apps/web/lib/catalog/collection-controls.ts';
import {collectionEnabled} from '../../../apps/web/lib/catalog/collection-controls-schema.ts';
const e=process.env, req=(x,c)=>assert.ok(x,c), status='uae_delta_private_role_required';
const LIVE_UAE_CURSOR='catalog/intake-cursors/v1/uae.json';
const marker='.github/market-runs/uae-dubicars-private-delta-v1.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const K=/^(?:(?:page|attempt)-[1-9]\d*|sealed-delta)\.json$/;
const privateKey=k=>k.startsWith(ROOT)&&K.test(k.slice(ROOT.length));
async function main(){
 req(e.GITHUB_REPOSITORY_ID==='1289722938'&&e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'
   &&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_RUN_ATTEMPT==='1'
   &&e.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/uae-dubicars-private-delta-v1.yml@refs/heads/main'
   &&['delta','continuation'].includes(e.GITHUB_JOB)
   &&/^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&/^[a-f0-9]{40}$/.test(e.UAE_DELTA_REVIEWED_TREE||''),status);
 req(e.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'&&e.YC_OBJECT_STORAGE_REGION==='us-east-1'
   &&e.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'&&e.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'
   &&e.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS==='8000'&&e.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1'&&e.JSON_STORAGE_DRIVER==='object',status);
 const permit=JSON.parse(await fs.readFile(marker,'utf8'));
 req(permit.reviewedWorkerTree===e.UAE_DELTA_REVIEWED_TREE,status);
 const apiKey=e.AUTO_API_DUBICARS_KEY;
 req(typeof apiKey==='string'&&apiKey.length>0&&apiKey.length<=1024&&!/\s/.test(apiKey),'uae_delta_paid_key_missing');
 const storage=new ObjectJsonStorage();
 const io={
   async read(key,cap){
     req(privateKey(key)||key===SEAL_KEY||key===COLLECTION_CONTROLS_KEY||key===LIVE_UAE_CURSOR,'uae_delta_object_scope');
     if(privateKey(key)&&!(await storage.readObjectMetadata(key)).found)return null;
     const v=await storage.getBinary(key);req(v.size===v.data.length&&v.size>0&&v.size<=cap,'uae_delta_object_bound');return v.data;
   },
   async create(key,data){
     req(privateKey(key)&&Buffer.isBuffer(data)&&data.length>0&&data.length<=4*1024*1024,'uae_delta_create_only_scope');
     await storage.putBinary(key,data,'application/json',{ifNoneMatch:'*'});
   },
 };
 let ownerHash;
 async function assertOwner(){
   const doc=validateCollectionControls(JSON.parse((await io.read(COLLECTION_CONTROLS_KEY,512*1024)).toString('utf8')));
   req(collectionEnabled(doc,'dubicars_feed'),'uae_delta_dubicars_disabled');
   const next=sha(JSON.stringify([doc.markets.uae,doc.sources.dubicars_feed]));
   req(!ownerHash||next===ownerHash,'uae_delta_owner_changed');ownerHash=next;return next;
 }
 let lastStart=0;
 async function fetchOne(cursor){
   // Fixed ordinary configured paid route. No HEAD, /offer details, /offers,
   // /change_id, export, alternative Basic credential or redirects/retries.
   req(Number.isSafeInteger(cursor)&&cursor>=324989,'uae_delta_request_cursor');
   const wait=lastStart+200-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
   const url=new URL('https://api1.auto-api.com/api/v2/dubicars/changes');
   url.searchParams.set('change_id',String(cursor));url.searchParams.set('api_key',apiKey);
   lastStart=Date.now();
   const r=await fetch(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(r.status!==200){await r.body?.cancel();return {status:r.status};}
   req(r.body,'uae_delta_http_body');
   const reader=r.body.getReader(), chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
     if(size>2*1024*1024){await reader.cancel();throw Error('uae_delta_http_body_bound');}
     chunks.push(Buffer.from(value));}
   return {status:200,payload:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
 }
 const cursor=JSON.parse((await io.read(LIVE_UAE_CURSOR,1024*1024)).toString('utf8'));
 const current=cursor.sources?.find(x=>x?.sourceId==='dubicars_uae_exact'&&x?.provider==='auto_api_dubicars');
 req(cursor.version===1&&cursor.market==='uae'&&current?.cursor===320763&&current.stopReason==='source_finished'
   &&cursor.durableIntakeArchive?.root==='catalog/nonjp-intake/v1/uae/43988535521/1'
   &&cursor.durableIntakeArchive?.manifestSha256==='ff7d930aec5ee8b059e28ef06e0ccc6afadd88b89d45df38917f85b44bd966a3','uae_delta_new_public_cursor_requires_requalification');
 const receipt=await collect({io,permit,fetchOne,assertOwner,phaseBudget:300,phaseDeadline:Date.now()+70*60000});
 console.log(JSON.stringify(receipt));
 await fs.appendFile(e.GITHUB_OUTPUT,'state='+receipt.state+'\ncan_continue='+(receipt.canContinue===true)+'\n');
}
try{await main();}catch(e){
 const reason=/^uae_delta_[a-z0-9_]{1,100}$/.test(e?.message)?e.message:'uae_delta_private_hold';
 console.error(JSON.stringify({state:'held',reason,published:false,cursorAdvanced:false}));process.exitCode=1;
}
