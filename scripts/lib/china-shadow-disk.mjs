import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const digest=body=>createHash('sha256').update(body).digest('hex');
const safePart=value=>typeof value==='string'&&value!=='.'&&value!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(value);
const rootMarker='avtocena-china-archive-shadow-v1';
const privateStageGrants=new WeakSet();
const prefix='catalog/market-activation-fixture-v1/china/';
const fail=why=>{throw Error('china_shadow:'+why);};
export async function readVerifiedLocalFile(root,relative,{bytes,sha256},limit){
 if(!relative.split('/').every(safePart)||!Number.isSafeInteger(bytes)||bytes<1||bytes>limit||!(/^[a-f0-9]{64}$/).test(sha256))fail('file_descriptor');
 const file=path.join(root,relative),resolved=await fs.realpath(file);
 if(resolved!==file||!resolved.startsWith(root+path.sep))fail('file_scope');
 const f=await fs.open(file,'r');
 try{
  const stat=await f.stat();
  if(!stat.isFile()||stat.size!==bytes)fail('file_size');
  const body=await f.readFile();
  if(body.length!==bytes||digest(body)!==sha256)fail('file_sha256');
  return body;
 }finally{await f.close();}
}

/** No socket. The real ObjectJsonStorage client talks only to this fetch adapter. */
export async function openChinaShadowDisk(directory,create){
 const root=path.resolve(directory);
 if(!/^avtocena-china-shadow-[a-z0-9-]{1,45}$/.test(path.basename(root))||await fs.realpath(path.dirname(root))!==path.dirname(root))fail('workspace_name');
 if(create){
  await fs.mkdir(root,{mode:0o700});
  await fs.writeFile(path.join(root,'.scope'),rootMarker,{flag:'wx',mode:0o600});
  await fs.mkdir(path.join(root,'objects'),{mode:0o700});
 }
 if(await fs.realpath(root)!==root||await fs.realpath(path.join(root,'objects'))!==path.join(root,'objects')||
    (await fs.readFile(path.join(root,'.scope'),'utf8'))!==rootMarker)fail('workspace_identity');
 const endpoint='http://127.0.0.1:43154',bucket='fixture-china-archive',scopePrefix='fixture-offline-stage';
 const urlRoot=`/${bucket}/${scopePrefix}/`;
 const metrics={readCount:0,readBytes:0,maxReadBytes:0,writeCount:0,writeBytes:0,maxWriteBytes:0,conflicts:0,blockedRequests:0};
 let serial=Promise.resolve();
 const fetchMock=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method||'GET',headers=new Headers(init?.headers);
  if(url.origin!==endpoint||url.search||!url.pathname.startsWith(urlRoot)||!/^AWS4-HMAC-SHA256 Credential=fixture\//.test(headers.get('authorization')||'')){
   metrics.blockedRequests++;return fail('non_fixture_network_denied');
  }
  const key=decodeURIComponent(url.pathname.slice(urlRoot.length));
  if(!key.startsWith(prefix)||!key.split('/').every(safePart))return fail('market_namespace');
  const file=path.join(root,'objects',key);
  const get=async()=>{
   try{
    if(await fs.realpath(file)!==file)return fail('object_symlink');
    const stat=await fs.stat(file);
    if(!stat.isFile()||stat.size>4*1024*1024)return fail('object_size');
    return await fs.readFile(file);
   }catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  if(method==='GET'){
   metrics.readCount++;
   const body=await get();
   if(!body)return new Response(null,{status:404});
   metrics.readBytes+=body.length;metrics.maxReadBytes=Math.max(metrics.maxReadBytes,body.length);
   return new Response(new Uint8Array(body),{headers:{etag:'"'+digest(body)+'"'}});
  }
  if(method!=='PUT'||!create)return fail('readonly_or_method');
  const match=headers.get('if-match'),none=headers.get('if-none-match');
  if(!((match&&key.endsWith('/control.json')&&!none)||(!match&&none==='*')))return fail('unconditional_write');
  const run=async()=>{
   const old=await get();
   if((match&&(!old||match!=='"'+digest(old)+'"'))||(none==='*'&&old)){
    metrics.conflicts++;return new Response(null,{status:412});
   }
   const body=Buffer.isBuffer(init.body)?init.body:Buffer.from(String(init.body));
   if(!body.length||body.length>4*1024*1024)return fail('object_size');
   const dir=path.dirname(file);
   await fs.mkdir(dir,{recursive:true,mode:0o700});
   if(await fs.realpath(dir)!==dir)return fail('object_symlink');
   const tmp=file+'.'+randomUUID()+'.tmp';
   try{await fs.writeFile(tmp,body,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}
   finally{await fs.rm(tmp,{force:true});}
   metrics.writeCount++;metrics.writeBytes+=body.length;metrics.maxWriteBytes=Math.max(metrics.maxWriteBytes,body.length);
   return new Response(null,{status:200});
  };
  // Only the exclusive prepare command can write a newly created directory.
  const result=serial.then(run);serial=result.then(()=>{},()=>{});return result;
 };
 const env={
  YC_OBJECT_STORAGE_ENDPOINT:endpoint,YC_OBJECT_STORAGE_BUCKET:bucket,YC_OBJECT_STORAGE_PREFIX:scopePrefix,
  YC_OBJECT_STORAGE_REGION:'fixture',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture',
  JSON_STORAGE_DRIVER:'local',CATALOG_LIVE_RATE_DISABLED:'1',
 };
 const grant=Object.freeze({root,endpoint,bucket,prefix:scopePrefix,fetchMock,env:Object.freeze(env),metrics,mode:create?'prepare':'readonly'});
 privateStageGrants.add(grant);
 return grant;
}

/** Finish the guarded private run. Used by the file CLI and same-process
 * fresh admission + frozen-engine worker; never a public pointer mutation. */
export async function finalizeChinaShadowStage({disk,storage,publication,lease,staged,archiveSha256,source,fxReceiptSha256,count,streaming}){
 const assertPrivate=()=>{
  if(!privateStageGrants.has(disk)||disk.mode!=='prepare'||globalThis.fetch!==disk.fetchMock||
     process.env.YC_OBJECT_STORAGE_ENDPOINT!==disk.endpoint||process.env.YC_OBJECT_STORAGE_BUCKET!==disk.bucket||
     process.env.YC_OBJECT_STORAGE_PREFIX!==disk.prefix||process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID!=='fixture'||
     process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!=='fixture'||disk.metrics.blockedRequests)return fail('private_stage_authority');
 };
 assertPrivate();
 if(publication.market!=='china'||!/^[a-f0-9]{64}$/.test(archiveSha256)||!/^[a-f0-9]{64}$/.test(fxReceiptSha256)||
    staged?.ready?.generationId!==lease?.generationId||staged?.report?.admittedRows!==count||
    staged.report.fxReceiptSha256!==fxReceiptSha256||!source?.cursor)return fail('private_stage_candidate');
 const activated=await publication.activate(lease,staged.ready);
 const after=await publication.observe();
 assertPrivate();
 if(after.generationId!==staged.ready.generationId||JSON.stringify(after.cursor)!==JSON.stringify(source.cursor))return fail('shadow_commit_readback');
 let runtimeReadySha256;
 if(streaming){
  const active=await publication.openChinaPrepared(),control=await storage.getBinary(prefix+'control.json');
  if(!active||active.cut.generationId!==activated.generationId||active.cut.admitted.count!==count||
     active.cut.pricing.receiptSha256!==fxReceiptSha256||JSON.stringify(active.cut.source.cursor)!==JSON.stringify(source.cursor))
    return fail('runtime_binding');
  const runtime={version:1,kind:'china-isolated-runtime-ready',archiveSha256,generationId:activated.generationId,
   manifestSha256:activated.manifestSha256,activeControlSha256:digest(control.data),pricingReceiptSha256:fxReceiptSha256,
   admittedRows:count,validUntil:Math.min(active.cut.source.validUntil,active.cut.pricing.validUntil),
   ...(active.cut.pricing.legalValidUntil===undefined?{}:{legalValidUntil:active.cut.pricing.legalValidUntil})};
  const seal=Buffer.from(JSON.stringify(runtime));
  await active.assertCurrent();assertPrivate();
  await fs.writeFile(path.join(disk.root,'runtime-ready.json'),seal,{mode:0o600,flag:'wx'});
  runtimeReadySha256=digest(seal);
 }
 return {status:'offline_shadow_activated',archiveSha256,generationId:staged.ready.generationId,rows:count,
  privateBlocks:staged.report.blockCount,pricingReceiptSha256:fxReceiptSha256,runtimeReadySha256};
}
