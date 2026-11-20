#!/usr/bin/env node
/** Capture exact authorized pricing inputs in a new private workspace. S3 HEAD/GET only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const origin='https://s3.regru.cloud',physical='/avtocena-staging-8120751/migration-staging/full-20261011/',region='us-east-1';
const SHA=/^[a-f0-9]{64}$/,REL=/^[a-f0-9]{40}$/,MiB=1024**2,MAX_INDEX=256*MiB;
const fixed=Object.freeze({'markets/markets.json':2*MiB,'fees/exchange-rates.json':2*MiB,
 'catalog-editorial/current.json':8*MiB,'catalog/china-cny-prices/current.json':64*MiB});
const mayBeAbsent=new Set(['catalog-editorial/current.json','catalog/china-cny-prices/current.json']);
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=x=>hash(JSON.stringify(x)),hmac=(key,v)=>createHmac('sha256',key).update(v).digest();
const need=(v,k)=>{if(!v)throw Error('china_runtime_context:'+k);};
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const state=(a,b)=>a?.etag===b?.etag&&a?.bytes===b?.bytes&&a?.encoding===b?.encoding;
const rootFiles=['catalog/vehicle-knowledge/models.json','catalog/vehicle-knowledge/models-index.json','catalog/vehicle-knowledge/v2-bridge-models.json'];

async function readPinned(file,cap,pin,privateOnly=false){
 need(path.isAbsolute(file)&&await fs.realpath(file)===file,'input_scope');
 const stat=await fs.lstat(file);
 need(stat.isFile()&&stat.nlink===1&&stat.size>0&&stat.size<=cap&&(!privateOnly||(stat.mode&0o077)===0),'input_bound');
 const b=await fs.readFile(file);need(b.length===stat.size&&(!pin||hash(b)===pin),'input_pin');return b;
}
function signedRead({credentials,scope,fetchImpl,now=Date.now}){
 need(typeof credentials?.access==='string'&&/^[a-zA-Z0-9_+=./-]{1,256}$/.test(credentials.access)&&typeof credentials?.secret==='string'&&
  credentials.secret.length>0&&credentials.secret.length<=1024&&!/[\r\n\x00]/.test(credentials.secret),'credentials');
 return async(method,key)=>{
  const max=scope.get(key);need(max&&['HEAD','GET'].includes(method),'read_scope');
  const resource=physical+key,at=new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=at.slice(0,8),signing=day+'/'+region+'/s3/aws4_request';
  const payloadSha=hash(''),headers={host:'s3.regru.cloud','x-amz-content-sha256':payloadSha,'x-amz-date':at},names=Object.keys(headers).sort();
  const request=[method,resource,'',names.map(k=>k+':'+headers[k]+'\n').join(''),names.join(';'),payloadSha].join('\n');
  const keySign=hmac(hmac(hmac(hmac('AWS4'+credentials.secret,day),region),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+credentials.access+'/'+signing+', SignedHeaders='+names.join(';')+
   ', Signature='+createHmac('sha256',keySign).update(['AWS4-HMAC-SHA256',at,signing,hash(request)].join('\n')).digest('hex');
  const r=await fetchImpl(origin+resource,{method,headers,redirect:'error',signal:AbortSignal.timeout(method==='HEAD'?15000:60000)});
  if(r.status===404){await r.body?.cancel();return null;}
  const etag=r.headers.get('etag'),n=Number(r.headers.get('content-length')),encoding=r.headers.get('content-encoding')||'identity';
  if(r.status!==200||!/^"[^"\r\n]{1,128}"$/.test(etag??'')||!Number.isSafeInteger(n)||n<=0||n>max||
     !['identity','gzip'].includes(encoding)){
   await r.body?.cancel();need(false,'object_metadata');
  }
  if(method==='HEAD')return {etag,bytes:n,encoding};
  need(r.body,'read_body');
  const reader=r.body.getReader(),chunks=[];let total=0;
  try{for(;;){
   const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
   if(total>max){await reader.cancel();need(false,'decoded_body_cap');}chunks.push(value);
  }}finally{reader.releaseLock();}
  let b=Buffer.concat(chunks,total);
  if(encoding==='identity')need(total===n,'wire_length');
  else if(b[0]===0x1f&&b[1]===0x8b)b=gunzipSync(b,{maxOutputLength:max});
  need(b.length>0&&b.length<=max,'decoded_body_cap');
  return {etag,bytes:n,encoding,body:b};
 };
}
function validateDynamic(key,value){
 if(key==='markets/markets.json'){
  const china=Array.isArray(value)?value.filter(x=>x?.id==='china'):[];
  need(china.length===1&&Array.isArray(china[0].versions)&&china[0].versions.some(x=>x&&
   (x.id===china[0].activeVersionId||x.status==='active'||x.active===true)),'china_market_config_missing');
 }else if(key==='fees/exchange-rates.json'){
  need(Array.isArray(value?.rates)&&['CNY','USD','EUR'].every(code=>value.rates.some(row=>row?.currency===code&&
   ['cbr','cbr_live'].includes(row.rateSource)&&Number(row.cbrRate)>0&&Number(row.nominal)>0&&
   /^\d{4}-\d{2}-\d{2}$/.test(row.rateDate??''))),'official_rate_table_missing');
 }else if(key==='catalog-editorial/current.json'){
  need(value?.entries&&typeof value.entries==='object'&&!Array.isArray(value.entries)&&
   Object.values(value.entries).every(x=>x&&x.market!=='china'),'china_editorial_needs_explicit_support');
 }else if(key==='catalog/china-cny-prices/current.json'){
  need(value?.version===1&&value.entries&&typeof value.entries==='object'&&!Array.isArray(value.entries),'china_anchor_shape');
 }
}
export async function materializeChinaRuntimeContext({plan,expectedPlanSha256,releaseRoot,out,credentials,fetchImpl=globalThis.fetch}){
 need(plan?.version===1&&plan.kind==='china-regcloud-readonly-runtime-context-v1'&&plan.market==='china'&&
  plan.storage?.endpoint===origin&&plan.storage.bucket==='avtocena-staging-8120751'&&
  plan.storage.prefix==='migration-staging/full-20261011'&&plan.storage.region===region&&
  plan.remoteWritesAuthorized===false&&plan.publicationAuthorized===false&&REL.test(plan.releaseSha??'')&&
  SHA.test(plan.calculationVersion??'')&&SHA.test(expectedPlanSha256??'')&&digest(plan)===expectedPlanSha256&&
  (plan.expectedIndexDigest===undefined||SHA.test(plan.expectedIndexDigest))&&Array.isArray(plan.allowAbsent)&&
  plan.allowAbsent.length<=2&&new Set(plan.allowAbsent).size===plan.allowAbsent.length&&plan.allowAbsent.every(k=>mayBeAbsent.has(k)),'plan');
 need(path.isAbsolute(out)&&path.normalize(out)===out&&/^avtocena-china-context-[a-z0-9-]{1,45}$/.test(path.basename(out))&&
  await fs.realpath(path.dirname(out))===path.dirname(out)&&path.isAbsolute(releaseRoot)&&await fs.realpath(releaseRoot)===releaseRoot&&
  out!==releaseRoot&&!out.startsWith(releaseRoot+path.sep),'workspace_scope');
 const exec=promisify(execFile);
 const git=async(args,cap=8*MiB)=>(await exec('git',args,{cwd:releaseRoot,maxBuffer:cap,encoding:'buffer'})).stdout;
 need((await git(['rev-parse','HEAD'])).toString().trim()===plan.releaseSha,'release_checkout');
 const tree=new Set((await git(['ls-tree','-r','--name-only',plan.releaseSha,'--','data/catalog/vehicle-knowledge'])).toString().trim().split('\n'));
 const bundled=new Map();
 const readBlob=async(key)=>{
  need(!bundled.has(key)&&tree.has('data/'+key)&&bundled.size<400,'model_git_scope');
  const b=await git(['show',plan.releaseSha+':data/'+key]);
  need(b.length>0&&b.length<=8*MiB,'model_git_size');const v=parse(b);bundled.set(key,b);return v;
 };
 if(tree.has('data/'+rootFiles[1])){
  const m=await readBlob(rootFiles[1]);need(m?.version===1&&Number.isSafeInteger(m.total)&&m.total>0&&Array.isArray(m.chunks)&&m.chunks.length<=350,'model_index');
  let rows=0;
  for(const c of m.chunks){
   need(/^[a-zA-Z0-9_.-]+\.json$/.test(c?.file??'')&&Number.isSafeInteger(c.count)&&c.count>0,'model_chunk');
   const v=await readBlob('catalog/vehicle-knowledge/'+c.file);
   need(Array.isArray(v)&&v.length===c.count,'model_chunk_count');rows+=v.length;
  }
  need(rows===m.total,'model_index_count');
 }else{
  const m=await readBlob(rootFiles[0]);need(Array.isArray(m)&&m.length>0,'model_directory');
 }
 if(tree.has('data/'+rootFiles[2]))need(Array.isArray(await readBlob(rootFiles[2])),'model_bridge');
 const bindingKey='knowledge/encyclopedia/calculation-releases/'+plan.releaseSha+'.json';
 const scope=new Map([...Object.entries(fixed),[bindingKey,256*1024]]),get=signedRead({credentials,scope,fetchImpl});
 const bindingBefore=await get('HEAD',bindingKey),binding=await get('GET',bindingKey);
 need(bindingBefore&&binding&&state(bindingBefore,binding),'encyclopedia_binding_moved');
 const b=parse(binding.body);
 const indexKey='knowledge/encyclopedia/calculation-indexes/'+b?.digest+'.json';
 need(b?.release===plan.releaseSha&&SHA.test(b.digest??'')&&b.key===indexKey&&(!plan.expectedIndexDigest||b.digest===plan.expectedIndexDigest),'encyclopedia_release_binding');
 scope.set(indexKey,MAX_INDEX);
 const indexHead=await get('HEAD',indexKey),index=await get('GET',indexKey);
 need(indexHead&&index&&state(indexHead,index),'encyclopedia_index_moved');
 const iv=parse(index.body);need(iv?.version===1&&iv.digest===b.digest&&iv.models&&digest(iv.models)===b.digest,'encyclopedia_model_digest');
 const keys=Object.keys(fixed),pre=await Promise.all(keys.map(k=>get('HEAD',k)));
 const data=new Map(),objects=[];
 for(const[i,key]of keys.entries()){
  if(!pre[i]){need(plan.allowAbsent.includes(key),'required_object_absent');objects.push({key,absent:true});continue;}
  const got=await get('GET',key);need(got&&state(pre[i],got),'mutable_object_changed');
  validateDynamic(key,parse(got.body));data.set(key,got.body);
  objects.push({key,etag:got.etag,bytes:got.body.length,sha256:hash(got.body)});
 }
 const post=await Promise.all([...keys,bindingKey,indexKey].map(k=>get('HEAD',k)));
 need(pre.every((p,i)=>state(p,post[i]))&&state(bindingBefore,post[keys.length])&&state(indexHead,post[keys.length+1]),'input_snapshot_changed');
 await fs.mkdir(out,{mode:0o700});let complete=false;
 try{
  const descriptors=[];
  for(const[key,body]of [...data,...bundled,['knowledge/encyclopedia/calculation-v1.json',index.body]].sort(([a],[b])=>a.localeCompare(b))){
   const file='data/'+key,target=path.join(out,file);
   await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,body,{flag:'wx',mode:0o600});
   descriptors.push({file,bytes:body.length,sha256:hash(body)});
  }
  const receipt={version:1,kind:'china-local-runtime-context-v1',market:'china',releaseSha:plan.releaseSha,calculationVersion:plan.calculationVersion,
   sourcePlanSha256:expectedPlanSha256,encyclopediaDigest:b.digest,encyclopediaBindingSha256:hash(binding.body),
   objects,runtimeDataFiles:descriptors,storageWrites:0,publicationAuthorized:false};
  const raw=Buffer.from(JSON.stringify(receipt));
  await fs.writeFile(path.join(out,'RUNTIME_CONTEXT.json'),raw,{flag:'wx',mode:0o600});
  complete=true;return {receipt,receiptSha256:hash(raw)};
 }finally{if(!complete)await fs.rm(out,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const {values}=parseArgs({options:{plan:{type:'string'},'expect-plan-sha':{type:'string'},'release-root':{type:'string'},out:{type:'string'},secrets:{type:'string'}}});
  need(values.plan&&SHA.test(values['expect-plan-sha']??'')&&values['release-root']&&values.out&&values.secrets,'args');
  const raw=await readPinned(path.resolve(values.plan),64*1024,values['expect-plan-sha'],true);
  const credentials=parse(await readPinned(path.resolve(values.secrets),4096,undefined,true));
  const {receipt,receiptSha256}=await materializeChinaRuntimeContext({plan:parse(raw),expectedPlanSha256:values['expect-plan-sha'],
   releaseRoot:path.resolve(values['release-root']),out:path.resolve(values.out),credentials});
  console.log(JSON.stringify({status:'local_runtime_context_materialized',receiptSha256,releaseSha:receipt.releaseSha,
   files:receipt.runtimeDataFiles.length,encyclopediaDigest:receipt.encyclopediaDigest,storageWrites:0,publicationAuthorized:false}));
 }catch(error){console.error(JSON.stringify({status:'not_materialized',reason:/^china_runtime_context:[a-z0-9_]+$/.test(error?.message??'')?error.message:'runtime_read_refused',storageWrites:0}));process.exitCode=1;}
}
