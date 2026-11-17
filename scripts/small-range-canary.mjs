import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {runCanary} from './lib/small-range-canary.mjs';
const events=[];let done=false;const finish=async(verified)=>{if(done)return;done=true;const report={verified,events};await fs.writeFile('small-range-canary.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));};
const timer=setTimeout(()=>{void finish(false).finally(()=>process.exit(2));},65000);
try{
 if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='c7e00f72292573dde4c892a2038a65e65d5b7066')throw Error('canary_source');
 if(process.env.YC_OBJECT_STORAGE_ENDPOINT!=='https://s3.regru.cloud'||process.env.YC_OBJECT_STORAGE_BUCKET!=='avtocena-staging-8120751'||process.env.YC_OBJECT_STORAGE_PREFIX!=='migration-staging/full-20261011/')throw Error('canary_storage');
 await runCanary({fetchImpl:globalThis.fetch,env:process.env,events});await finish(true);
}catch(error){events.push({stage:'failure',code:/^(range|canary)_[a-z_]+$/.test(error?.message||'')?error.message:'unclassified',errorHash:(await import('node:crypto')).createHash('sha256').update(String(error?.message||'')).digest('hex')});await finish(false);process.exitCode=1;}finally{clearTimeout(timer);}
