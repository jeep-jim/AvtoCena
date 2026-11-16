import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReadOnlyRawGcS3Transport} from './lib/catalog-raw-gc-s3.mjs';
import {readRawGcAuthority,inventoryRawGcRoots,prepareRawGcPlan} from './lib/catalog-raw-gc.mjs';

const localLimit=128*1024**2;
async function inputJson(file,maxBytes=localLimit) {
  assert.ok(path.isAbsolute(file),'raw_gc_cli_absolute_input_required');
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await handle.stat();assert.ok(stat.isFile()&&stat.size<=maxBytes,'raw_gc_cli_input_size');
    const chunks=[];let total=0;
    while(true){const chunk=Buffer.alloc(Math.min(65536,maxBytes-total+1));const read=await handle.read(chunk,0,chunk.length,null);
      if(!read.bytesRead)break;total+=read.bytesRead;assert.ok(total<=maxBytes,'raw_gc_cli_input_size');chunks.push(chunk.subarray(0,read.bytesRead));
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));
  } finally {await handle.close();}
}
function argumentsOf(argv) {
  const result={mode:'plan'},seen=new Set();
  for(let index=0;index<argv.length;index+=2) {
    const name=argv[index],value=argv[index+1];
    assert.ok(['--mode','--roots-file','--retention-input','--output','--work-ms'].includes(name)&&typeof value==='string'&&!value.startsWith('--'),'raw_gc_cli_argument');
    const key=name.slice(2);assert.ok(!seen.has(key),'raw_gc_cli_duplicate_argument');seen.add(key);result[key]=value;
  }
  assert.ok(['plan','inventory'].includes(result.mode),'raw_gc_cli_readonly_modes_only');
  assert.ok(typeof result.output==='string'&&path.isAbsolute(result.output),'raw_gc_cli_absolute_output_required');
  if(result.mode==='inventory')assert.ok(result['roots-file']&&!result['retention-input'],'raw_gc_cli_inventory_input');
  else assert.ok(!result['roots-file'],'raw_gc_cli_plan_input');
  const workMs=Number(result['work-ms']||120000);assert.ok(Number.isSafeInteger(workMs)&&workMs>0&&workMs<=600000,'raw_gc_cli_deadline');
  return {...result,workMs};
}

/** Read-only CLI. Local inputs never create registry/root/coverage evidence in
 * S3; the sole output write is an exclusive local artifact file. */
export async function runRawGcReadOnlyCli({argv=process.argv.slice(2),environment=process.env,fetchImpl=globalThis.fetch,
  now=Date.now,signal}={}) {
  const options=argumentsOf(argv),controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,options.workMs),startedAt=now();
  try {
    // Read bounded local inputs before constructing a credential-bearing client.
    const roots=options['roots-file']?await inputJson(options['roots-file'],65536):null;
    const retentionInputs=options['retention-input']?await inputJson(options['retention-input']):undefined;
    assert.ok(!roots||roots.version===1&&Array.isArray(roots.roots)&&roots.roots.length>0&&roots.roots.length<=10,'raw_gc_cli_roots');
    const remaining=options.workMs-(now()-startedAt);assert.ok(remaining>0&&!controller.signal.aborted,'raw_gc_cli_deadline');
    const io=createReadOnlyRawGcS3Transport({environment,fetchImpl,now,signal:controller.signal});
    const config={workMs:remaining};let result;
    if(options.mode==='inventory') {
      const authority=await readRawGcAuthority({io,config,now});
      const afterAuthority=options.workMs-(now()-startedAt);assert.ok(afterAuthority>0&&!controller.signal.aborted,'raw_gc_cli_deadline');
      const inventory=await inventoryRawGcRoots({io,roots:roots.roots,authority,config:{workMs:afterAuthority,groups:roots.roots.length},now});
      result={mode:'inventory',...inventory,eligibleForDeletion:false,
        authority:{status:authority.status,...(authority.reason?{reason:authority.reason}:{})}};
    } else result=await prepareRawGcPlan({io,retentionInputs,config,now});
    const transport=io.stats();assert.ok(transport.put===0&&transport.post===0,'raw_gc_cli_readonly_violation');
    const report={version:1,...result,executionEnabled:false,storageWrites:0,deleteRequests:0,transport,checkedAt:new Date(now()).toISOString()};
    const encoded=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(encoded)<=localLimit,'raw_gc_cli_output_size');
    await fs.writeFile(options.output,encoded,{flag:'wx',mode:0o600});
    return {mode:report.mode,status:report.status,...(report.reason?{reason:report.reason}:{}),executionEnabled:false,
      storageWrites:0,deleteRequests:0,transport,output:options.output};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

async function main() {
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try {console.log(JSON.stringify(await runRawGcReadOnlyCli({signal:controller.signal})));}
  catch(error) {
    const code=String(error?.message||'').split('\n')[0];
    console.error(JSON.stringify({status:'failed',reason:/^raw_(?:gc|coord|inventory)_[a-z0-9_]+$/.test(code)?code:'raw_gc_cli_failed',executionEnabled:false}));
    process.exitCode=1;
  } finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)void main();
