import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {classifyChinaRefresh,verifyOwnedChinaDownload} from './lib/owned-china-verification.mjs';

const event=JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8')).workflow_run;
const runId=String(event?.id??'');
if(!/^[1-9]\d{0,19}$/.test(runId)||!process.env.GITHUB_TOKEN||!process.env.GITHUB_OUTPUT)throw Error('china_verification_event');
const api=`https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/${runId}`;
async function read(suffix){
 const response=await fetch(api+suffix,{headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:'application/json'},
  redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok||!response.body)throw Error('china_verification_official_http');
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>2*1024*1024)throw Error('china_verification_official_capacity');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const run=await read('');
if(!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error('china_verification_attempt');
const jobs=await read(`/attempts/${run.run_attempt}/jobs?per_page=100`);
const mode=classifyChinaRefresh(run,jobs,event);
if(mode==='mirror'){
 const storage=getJsonStorage();if(storage.driver!=='object')throw Error('china_verification_object_storage');
 const report=await verifyOwnedChinaDownload(storage,{runId,attempt:String(run.run_attempt),producerSha:run.head_sha});
 await fs.writeFile('che168-source-download-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
await fs.appendFile(process.env.GITHUB_OUTPUT,`mode=${mode}\n`);
