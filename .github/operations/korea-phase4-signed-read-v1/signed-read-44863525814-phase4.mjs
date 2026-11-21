// Intended for an explicitly approved read-only protected runner only.
// No network in fixture tests; no provider client, raw body output, PUT or LIST.
import {verifyExactPhase4} from './verify-44863525814-checkpoint.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';

const R='44863525814';
const base='catalog/operations/korea-encar-scoped-source/v1/'+R+'/attempt-1/';
const absent=base+'attempt-1585.json';
const pos=[
 ['phase4-receipt.json',32768],['body-1584.json',12*1024*1024],
 ['attempt-1584.json',32768],['body-1.json',32768]
];
const claim=p=>'catalog/operations/korea-encar-scoped-source/v1/continuation-claims/'+R+'/'+p.receiptSha256+'.json';
const check=(v,c)=>{if(!v)throw Error(c)};
export async function collect({readExact,headExact,verify=verifyExactPhase4}){
 check(await headExact(absent)===false,'encar_phase4_following_attempt');
 const data=await Promise.all(pos.map(async([leaf,cap])=>{
  const b=await readExact(base+leaf,cap);
  check(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'encar_phase4_input_bound');return b;
 }));
 const result=verify(data);
 check(await headExact(absent)===false&&await headExact(claim(result))===false,'encar_phase4_following_attempt_or_existing_claim');
 const again=await readExact(base+pos[0][0],pos[0][1]);
 check(Buffer.isBuffer(again)&&again.equals(data[0])&&createHash('sha256').update(again).digest('hex')===result.receiptSha256,'encar_phase4_receipt_check_failed');
 return {kind:'verified_phase4_predecessor_metadata',predecessor:result,providerCalls:0,objectWrites:0,
  providerTerminal:false,publish:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const e=process.env;
 check(e.GITHUB_REPOSITORY_ID==='1289722938'&&e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&e.GITHUB_JOB==='inspect'&&e.GITHUB_RUN_ATTEMPT==='1'&&
 e.JSON_STORAGE_DRIVER==='object'&&e.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'&&
 e.YC_OBJECT_STORAGE_REGION==='us-east-1'&&e.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'&&
 e.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'&&
 e.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1'&&e.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS==='8000','encar_phase4_protected_scope');
 async function main(){
  const dataPath=path.resolve(process.argv[2],'apps/web/lib/data.ts');
  const {ObjectJsonStorage}=await import(pathToFileURL(dataPath).href);
  const storage=new ObjectJsonStorage();
  const readExact=async(k,cap)=>{const b=await storage.getBinary(k);check(b.size===b.data.length&&b.size<=cap,'encar_phase4_byte_bound');return b.data;};
  const headExact=async k=>(await storage.readObjectMetadata(k)).found;
  const r=await collect({readExact,headExact});
  // Output only a reviewable predecessor marker fragment, never receipt/body bytes.
  console.log(JSON.stringify(r));
 }
 try{await main();}catch{console.error('encar_phase4_read_only_hold');process.exitCode=1;}
}
