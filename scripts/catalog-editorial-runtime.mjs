import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {restoreReleaseEncyclopedia} from './encyclopedia/restore-calculation-index.mjs';
import {budgetPreparationDecision} from './catalog-budget-runtime.mjs';

export const EDITORIAL_HEALTH_URL='https://avtocena.com/api/health';
export const UNSUPPORTED_ACCEPTED_RELEASE='a182cd21b21ecf612b63613d263e5bdd817ea4c0';
const HELPER='apps/web/lib/catalog/editorial-home.ts';
const PRIVATE_INDEX='data/knowledge/encyclopedia/calculation-v1.json';
export function validateEditorialHealth(value){
 if(value?.ok!==true||!/^[a-f0-9]{40}$/.test(value?.releaseSha||'')||!/^[a-f0-9]{64}$/.test(value?.calculationVersion||''))throw Error('editorial_runtime_health_invalid');
 return {release:value.releaseSha,calculationVersion:value.calculationVersion};
}
/** One fixed public endpoint; deadline covers headers and the complete <=32KiB body. */
export async function readEditorialHealth(fetchImpl=fetch,timeoutMs=15000){
 const controller=new AbortController();let reader,timer;
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
  controller.abort();void reader?.cancel().catch(()=>{});reject(Error('editorial_runtime_health_timeout'));
 },timeoutMs);});
 try{return await Promise.race([expired,(async()=>{
  const response=await fetchImpl(EDITORIAL_HEALTH_URL,{headers:{accept:'application/json','cache-control':'no-cache'},redirect:'error',signal:controller.signal});
  if(!response.ok||response.redirected||!response.body)throw Error('editorial_runtime_health_http');
  reader=response.body.getReader();const chunks=[];let bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
   if(bytes>32768){controller.abort();void reader.cancel().catch(()=>{});throw Error('editorial_runtime_health_capacity');}chunks.push(part.value);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('editorial_runtime_health_json');}
  return validateEditorialHealth(value);
 })()]);}finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
}
export function assertEditorialHealth(expected,actual){
 if(actual.release!==expected.release||actual.calculationVersion!==expected.calculationVersion)throw Error('editorial_runtime_health_changed');
}
export async function installedEditorialSupported(root,release){
 try{await fs.access(path.join(root,HELPER));return true;}catch(error){
  if(error.code!=='ENOENT')throw error;
  if(release===UNSUPPORTED_ACCEPTED_RELEASE)return false;
  throw Error('editorial_runtime_helper_missing');
 }
}
/** Stored-search preparation may contact only the configured object-store prefix. */
export function editorialPreparationFetch(fetchImpl,env,generationId){
 const endpoint=new URL(env.YC_OBJECT_STORAGE_ENDPOINT||'');
 if(endpoint.origin!=='https://s3.regru.cloud'||endpoint.pathname!=='/'||!env.YC_OBJECT_STORAGE_BUCKET)throw Error('editorial_runtime_storage_scope_invalid');
 const prefix=String(env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,'');
 if(!prefix||prefix.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('editorial_runtime_storage_scope_invalid');
 const bucketPrefix=`/${encodeURIComponent(env.YC_OBJECT_STORAGE_BUCKET)}/${prefix.split('/').map(encodeURIComponent).join('/')}/`;
 const outputPrefix=`${bucketPrefix}catalog/generations/${generationId}/indexes/editorial-home-v1/`;
 return (input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(options.method||(typeof input==='object'&&input.method)||'GET').toUpperCase();
  if(url.href===EDITORIAL_HEALTH_URL&&method==='GET')return fetchImpl(input,{...options,redirect:'error'});
  if(url.origin!==endpoint.origin||!url.pathname.startsWith(bucketPrefix)||url.username||url.password||url.search
    ||!(['GET','HEAD'].includes(method)||(method==='PUT'&&url.pathname.startsWith(outputPrefix)
      &&/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.json$/.test(url.pathname.slice(outputPrefix.length)))))throw Error('editorial_runtime_network_scope_denied');
  return fetchImpl(input,{...options,redirect:'error'});
 };
}

export async function prepareInstalledEditorial({root,expected,readHealth=readEditorialHealth}){
 root=path.resolve(root);
 if(path.resolve(process.cwd())!==root)throw Error('editorial_runtime_working_directory_mismatch');
 validateEditorialHealth({ok:true,releaseSha:expected.release,calculationVersion:expected.calculationVersion});
 assertEditorialHealth(expected,await readHealth());
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024}).trim();
 if(head!==expected.release)throw Error('editorial_runtime_checkout_mismatch');
 const load=relative=>import(pathToFileURL(path.join(root,relative)).href);
 const {calculationVersion}=await load('scripts/catalog-calculation-version.mjs');
 if(calculationVersion(root)!==expected.calculationVersion)throw Error('editorial_runtime_calculation_mismatch');
 if(!await installedEditorialSupported(root,expected.release)){
  assertEditorialHealth(expected,await readHealth());
  return {...expected,supported:false,prepared:false,reason:'accepted_release_has_no_editorial_home_helper'};
 }
 process.env.AVTOCENA_RELEASE_SHA=expected.release;
 process.env.AVTOCENA_CALCULATION_VERSION=expected.calculationVersion;
 process.env.GITHUB_SHA=expected.release;
 process.env.RELEASE_SOURCE_SHA=expected.release;
 const {getJsonStorage}=await load('apps/web/lib/data.ts'),storage=getJsonStorage();
 if(storage.driver!=='object')throw Error('editorial_runtime_object_storage_required');
 const readState=async()=>{const [manifest,lock]=await Promise.all([
  storage.readJson('catalog/manifest.json',null),storage.readJson('catalog/import-lock.json',null),
 ]);return {manifest,lock};};
 const initial=await readState(),decision=budgetPreparationDecision(initial.manifest,initial.lock);
 if(decision.skip)throw Error('editorial_runtime_publication_in_progress');
 const generationId=decision.generationId,prefix=`catalog/generations/${generationId}/indexes/editorial-home-v1/`;
 const assertState=async()=>{
  const current=await readState(),state=budgetPreparationDecision(current.manifest,current.lock);
  if(state.skip||JSON.stringify(current.manifest)!==JSON.stringify(initial.manifest))throw Error('editorial_runtime_publication_changed');
 };
 const originalWrite=storage.writeJson,originalFetch=globalThis.fetch;let restoredDigest;
 storage.writeJson=async(key,value,condition)=>{
  if(!key.startsWith(prefix)||!/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.json$/.test(key.slice(prefix.length))
    ||value?.generationId!==generationId||value?.context?.release!==expected.release
    ||value?.context?.calculationVersion!==expected.calculationVersion
    ||!restoredDigest||value?.context?.encyclopediaDigest!==restoredDigest
    ||!(condition?.ifMatch||condition?.ifNoneMatch==='*'))throw Error('editorial_runtime_write_scope_denied');
  await assertState();assertEditorialHealth(expected,await readHealth());
  return originalWrite.call(storage,key,value,condition);
 };
 try{
  globalThis.fetch=editorialPreparationFetch(originalFetch,process.env,generationId);
  const digest=await restoreReleaseEncyclopedia(storage,root,expected.release);
  if(!/^[a-f0-9]{64}$/.test(digest||''))throw Error('editorial_runtime_index_missing');
  restoredDigest=digest;
  // Import calculator consumers only after the exact private index is restored.
  const {prepareEditorialHome}=await load(HELPER),{searchOffers}=await load('apps/web/lib/catalog/storage.ts');
  if(typeof prepareEditorialHome!=='function'||typeof searchOffers!=='function')throw Error('editorial_runtime_helper_invalid');
  assertEditorialHealth(expected,await readHealth());await assertState();
  const result=await prepareEditorialHome({storage,search:market=>searchOffers({market,pageSize:12,sort:'updatedAt'})});
  await assertState();assertEditorialHealth(expected,await readHealth());
  if(result?.generationId!==generationId||typeof result.prepared!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(result.policyDate||'')
    ||!Array.isArray(result.markets)||result.markets.length>6
    ||result.markets.some(market=>!['china','korea','japan','uae','europe','georgia'].includes(market)))throw Error('editorial_runtime_result_invalid');
  return {...expected,supported:true,prepared:result.prepared,policyDate:result.policyDate,markets:result.markets,generationId,encyclopediaDigest:digest};
 }finally{
  storage.writeJson=originalWrite;globalThis.fetch=originalFetch;
  await fs.rm(path.join(root,PRIVATE_INDEX),{force:true});
 }
}
async function main(){
 if(process.argv[2]==='--resolve'){
  const health=await readEditorialHealth();if(!process.env.GITHUB_OUTPUT)throw Error('editorial_runtime_output_required');
  await fs.appendFile(process.env.GITHUB_OUTPUT,`release=${health.release}\ncalculation=${health.calculationVersion}\n`);
  console.log(JSON.stringify(health));return;
 }
 const [root,release,calculationVersion]=process.argv.slice(2);
 if(!root)throw Error('editorial_runtime_root_required');
 console.log(JSON.stringify(await prepareInstalledEditorial({root,expected:{release,calculationVersion}})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
