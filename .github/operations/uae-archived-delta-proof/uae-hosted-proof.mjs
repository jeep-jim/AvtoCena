import assert from 'node:assert/strict';
import {proveUaeDelta} from './uae-delta-proof.mjs';
// No storage signed operations can run before the concrete verb, prefix,
// target-market/path, and get count checks. No supplier transport is exposed.
const fetchOriginal=globalThis.fetch;
const origin='https://s3.regru.cloud';
const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const keys=/^catalog\/(?:manifest\.json|intake-cursors\/v1\/uae\.json|nonjp-intake\/v1\/uae\/(?:43988535521|44636630094)\/1\/(?:complete\.json|files\/report\.json\/0-[a-f0-9]{64}\.json)|generations\/gen_[1-9]\d{12}_[a-f0-9]{8}\/offers\/uae\/chunk-[0-9]{4,6}\.json)$/;
const deadline=AbortSignal.timeout(90_000);
let transportReads=0;
globalThis.fetch=async(input,options={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.ok((options.method||(input instanceof Request?input.method:'GET'))==='GET'&&!options.body&&url.origin===origin&&!url.search&&!url.username&&!url.password&&
    url.pathname.startsWith(prefix)&&keys.test(url.pathname.slice(prefix.length))&&++transportReads<=18,'uae_non_get_or_unapproved_scope');
  const response=await fetchOriginal(input,{...options,redirect:'error',signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline});
  if(!response.body)return response;
  const reader=response.body.getReader();let size=0;const parts=[];
  try{
    for(;;){const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;assert.ok(size<=8*1024*1024,'uae_response_budget');parts.push(item.value);}
  }finally{await reader.cancel();reader.releaseLock();}
  return new Response(Buffer.concat(parts),{status:response.status,headers:response.headers});
};
try{
  const {getJsonStorage}=await import('../../../apps/web/lib/data.ts');
  const storage=getJsonStorage();
  assert.ok(storage.driver==='object');
  const result=await proveUaeDelta({read:key=>storage.readJson(key,null)});
  console.log(JSON.stringify({...result,transportReads}));
}catch(error){
  // Do not print signed URLs, backend response bodies, raw rows, or secrets.
  const reason=/^[a-z_]+$/.test(error?.message||'')?error.message:'uae_get_only_proof_failed';
  console.log(JSON.stringify({market:'uae',status:'failed',reason,transportReads,supplierRequests:0,storageWrites:0,publicationAllowed:false}));
  process.exitCode=1;
}
