import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {readCollectionControls} from '../../../apps/web/lib/catalog/collection-controls.ts';
import {collectionEnabled} from '../../../apps/web/lib/catalog/collection-controls-schema.ts';
import {authorized,providerTransport,runPhase,rootFor,claimFor,digestReceipt} from './carrier.mjs';
const env=process.env, workflow='korea-encar-v3-2022-source-v1', phase=process.argv[2];
const ensure=(b,c)=>{if(!b)throw Error(c)};
async function main(){
 ensure(env.GITHUB_REPOSITORY_ID==='1289722938'&&env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'
  &&/^[1-9]\d{8,14}$/.test(env.GITHUB_RUN_ID||'')&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')
  &&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_RUN_ATTEMPT==='1'
  &&env.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/'+workflow+'.yml@refs/heads/main'
  &&['initial','phase2','phase3','phase4'].includes(phase)&&env.GITHUB_JOB===phase,'encar_run_scope');
 ensure(env.JSON_STORAGE_DRIVER==='object'&&env.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
  &&env.YC_OBJECT_STORAGE_REGION==='us-east-1'&&env.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
  &&env.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'
  &&env.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1'&&env.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS==='8000','encar_storage_scope');
 const auth=authorized(JSON.parse(await fs.readFile('.github/market-runs/'+workflow+'.json','utf8')),env.ENCAR_REVIEWED_WORKER_TREE);
 const source=providerTransport({key:env.ACCOUNT_KEY});
 const identity={runId:env.GITHUB_RUN_ID,attempt:'1',revision:env.GITHUB_SHA};
 const root=rootFor(identity.runId);
 const native=new ObjectJsonStorage(), policy=JSON.parse(await fs.readFile('data/catalog/refresh-policy-v1.json','utf8'));
 const leaf=/^(?:scope-start|(?:attempt|body)-[1-9]\d*|(?:initial|phase[234])-receipt)\.json$/;
 const permitted=(base,k)=>k.startsWith(base+'/')&&leaf.test(k.slice(base.length+1));
 const limit=k=>k.split('/').at(-1).startsWith('body-')?12*1024*1024:32768;
 async function read(k,alt){
   if(!(await native.readObjectMetadata(k)).found)return alt;
   const bin=await native.getBinary(k);ensure(bin.data.length===bin.size&&bin.size>0&&bin.size<=limit(k),'encar_private_object_bound');
   return JSON.parse(bin.data.toString('utf8'));
 }
 async function write(k,v){
   const bulk=Buffer.from(JSON.stringify(v));ensure(bulk.length>0&&bulk.length<=limit(k),'encar_private_object_bound');
   await native.putBinary(k,bulk,'application/json',{ifNoneMatch:'*'});
 }
 const storage=Object.freeze({
   async readJson(k,alt){ensure(permitted(root,k),'encar_private_key_scope');return read(k,alt);},
   async writeJson(k,v,condition){
     ensure(permitted(root,k)&&condition?.ifNoneMatch==='*','encar_private_create_only');await write(k,v);
   }
 });
 const p=auth.predecessor;
 const history=async(base,n)=>{
   ensure(p&&[rootFor(p.runId),rootFor(p.originalRunId)].includes(base)&&leaf.test(n),'encar_predecessor_key_scope');
   return read(base+'/'+n,null);
 };
 const claim=async(binding,value,create)=>{
   ensure(p&&digestReceipt(p)===digestReceipt(binding),'encar_claim_scope');
   const k=claimFor(p);
   if(create)await write(k,value); // one successor per predecessor, no overwrite or adopt
   ensure(digestReceipt(await read(k,null))===digestReceipt(value),'encar_claim_mismatch');
 };
 async function checkOwner(){
  const c=await readCollectionControls(native);
  ensure(!policy.pausedMarkets?.korea&&collectionEnabled(c,'encar_feed'),'encar_owner_scope_hold');
  ensure(Date.now()<Date.parse(auth.expiresAt)&&new Date().toISOString().slice(0,10)===auth.anchorDate,'encar_epoch_hold');
  return createHash('sha256').update(JSON.stringify([c.markets.korea,c.sources.encar_feed])).digest('hex');
 }
 const prior=phase==='initial'?null:JSON.parse(env.ENCAR_PREVIOUS_RESULT||'null');
 const r=await runPhase({storage,root,auth,identity,phase,prior,history,claim,source,checkOwner,deadline:Date.now()+35*60000});
 await fs.appendFile(env.GITHUB_OUTPUT,'phase_result='+JSON.stringify(r)+'\ncontinue_allowed='+r.continueAllowed+'\n');
 console.log(JSON.stringify({scope:r.scope,kind:r.kind,attempts:r.attempts,pages:r.pages,rows:r.rows,unverified:r.unverified,
   duplicateRows:r.duplicateRows,hold:r.hold,publicationAllowed:false}));
}
try{await main()}catch(e){
 const form=/^encar_[a-z0-9_]{1,80}$/;
 console.error(JSON.stringify({state:'hold',reason:form.test(e?.message||'')?e.message:'encar_protected_carrier_hold',publicationAllowed:false}));
 process.exitCode=1;
}
