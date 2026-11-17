import {explain} from './safe-prepare-errors.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
import {PROJECTION_KEYS,READY_KEY,createProbeFetch,safeProbeCode} from './lib/projection-readonly-probe.mjs';
const start=Date.now(),events=[],results=[];let written=false;
const finish=async(forced=false)=>{if(written)return;written=true;const report={version:1,forced,elapsedMs:Date.now()-start,requestTimeoutMs:120000,totalBudgetMs:120000,events,results,supplierRequests:0,storageWrites:0};await fs.writeFile('projection-readonly-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));};
// Hard runner ceiling independently bounds imports, SDK retry sleep and cancellation.
const watchdog=setTimeout(()=>{void finish(true).finally(()=>process.exit(2));},125000);
try{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'c7e00f72292573dde4c892a2038a65e65d5b7066');
 assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','apps/web/lib','packages'],{encoding:'utf8'}).trim(),'');
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 process.env.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS='120000';process.env.AVTOCENA_INTERACTIVE_READ_BUDGET_MS='120000';
 globalThis.fetch=createProbeFetch(globalThis.fetch,{deadline:start+120000,events});
 for(const module of [http,https])for(const key of ['request','get'])module[key]=()=>{throw Error('projection_probe_request_forbidden');};syncBuiltinESMExports();
 const {getJsonStorage}=await import('../apps/web/lib/data.ts');const storage=getJsonStorage();
 const probe=async(method,key)=>{const began=Date.now();try{const value=method==='HEAD'?await storage.readObjectMetadata(key):await storage.getBinary(key);results.push({method,key,ok:true,elapsedMs:Date.now()-began,...(method==='HEAD'?{found:value.found}:{bytes:value.size})});}catch(error){results.push({method,key,ok:false,elapsedMs:Date.now()-began,code:safeProbeCode(error),error:explain(error)});}};
 // All requests share one deadline; GET uses production data.ts body/timeout code,
 // not readJson (which could expand chunked projections into additional GETs).
 await Promise.all([...[...PROJECTION_KEYS,READY_KEY].map(key=>probe('HEAD',key)),probe('GET',PROJECTION_KEYS[0])]);
 await finish();
}catch(error){results.push({ok:false,code:safeProbeCode(error),error:explain(error)});await finish();process.exitCode=1;}
finally{clearTimeout(watchdog);}
