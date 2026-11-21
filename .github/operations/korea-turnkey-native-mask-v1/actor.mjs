import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {verify,publicStatusSplit} from './verify-successor.mjs';
import {guardedCheckpointFetch} from './exact-read-cap.mjs';
const e=process.env, check=(x,c)=>{if(!x)throw Error(c)};
async function main(){
 check(e.GITHUB_REPOSITORY_ID==='1289722938'&&e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&e.GITHUB_JOB==='inspect'
 &&e.GITHUB_RUN_ATTEMPT==='1'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='push'
 &&e.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/korea-turnkey-native-mask-v1.yml@refs/heads/main'
 &&e.JSON_STORAGE_DRIVER==='object'&&e.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
 &&e.YC_OBJECT_STORAGE_REGION==='us-east-1'&&e.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
 &&e.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'&&e.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS==='8000'
 &&e.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1','encar_sample_protected_scope');
 const {ObjectJsonStorage}=await import(pathToFileURL(path.resolve(e.GITHUB_WORKSPACE,'apps/web/lib/data.ts')).href);
 const s=new ObjectJsonStorage();
 const read=async (k,cap)=>{const b=await s.getBinary(k);check(b.size===b.data.length&&b.size<=cap,'encar_sample_read_bound');return b.data;};
 const head=async k=>(await s.readObjectMetadata(k)).found;
 // Never serialize the internal verification receipt or provider payload.
 const originalFetch=globalThis.fetch;
 const wire=guardedCheckpointFetch(originalFetch.bind(globalThis));
 globalThis.fetch=wire.fetch;
 try{
   const report=await verify({read,head});
   const used=wire.finish();
   console.log(JSON.stringify(publicStatusSplit(report,used)));
 }finally{globalThis.fetch=originalFetch;}
}
try{await main();}catch(e){console.error(/^encar_[a-z0-9_]{1,80}$/.test(e?.message||'')?e.message:'encar_successor_read_only_hold');process.exitCode=1;}
