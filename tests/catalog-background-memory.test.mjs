import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {budgetWorkerInvocation} from '../scripts/catalog-budget-runtime.mjs';

const execute=promisify(execFile);
const memoryEvents=stderr=>stderr.split('\n').flatMap(line=>{
 try{const value=JSON.parse(line);return value?.stage==='node_resource_memory'?[value]:[];}catch{return [];}
});

test('exact runtime worker and cold probe receive fresh resources outside the controller checkout',async()=>{
 const runtime=await fs.mkdtemp(path.join(os.tmpdir(),'avtocena-price-runtime-'));
 try{
  await fs.writeFile(path.join(runtime,'probe.mjs'),`
   import v8 from 'node:v8';
   console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),
    heapLimit:v8.getHeapStatistics().heap_size_limit,nodeOptions:process.env.NODE_OPTIONS}));
  `);
  await fs.writeFile(path.join(runtime,'worker.mjs'),`
   import {execFile} from 'node:child_process';
   import {promisify} from 'node:util';
   import v8 from 'node:v8';
   const result=await promisify(execFile)(process.execPath,[process.env.CATALOG_NODE_RESOURCE_LAUNCHER,
    '--max-old-space-size=64','probe.mjs',...process.argv.slice(2)]);
   console.log(JSON.stringify({cwd:process.cwd(),heapLimit:v8.getHeapStatistics().heap_size_limit,
    launcher:process.env.CATALOG_NODE_RESOURCE_LAUNCHER,probe:JSON.parse(result.stdout),probeStderr:result.stderr}));
  `);
  const args=['--max-old-space-size=7','город Новокузнецк'];
  const invocation=budgetWorkerInvocation(runtime,['worker.mjs',...args],{
   env:{...process.env,NODE_OPTIONS:'--max-old-space-size=64 --no-warnings',CATALOG_NODE_RESOURCE_LAUNCHER:'/wrong/old/controller.mjs'},
  });
  const result=await execute(invocation.command,invocation.args,invocation.options);
  const worker=JSON.parse(result.stdout),events=memoryEvents(result.stderr),probes=memoryEvents(worker.probeStderr);
  assert.equal(worker.cwd,runtime);assert.equal(worker.probe.cwd,runtime);
  assert.deepEqual(worker.probe.args,args);
  assert.equal(worker.launcher,invocation.args[0]);
  assert.match(worker.probe.nodeOptions,/--no-warnings/);
  assert.doesNotMatch(worker.probe.nodeOptions,/max[-_]old[-_]space[-_]size/);
  assert.equal(events.length,1);assert.equal(probes.length,1);
  for(const [event,actual] of [[events[0],worker.heapLimit],[probes[0],worker.probe.heapLimit]]){
   assert.equal(event.requestedHeapBytes,event.actualHeapBytes);
   assert.equal(actual,event.actualHeapBytes);
   assert.ok(actual>64*1024*1024,'removed inherited 64 MiB ceiling');
   assert.ok(event.availableRamBytes>0);
  }
  assert.ok(Date.parse(probes[0].sampledAt)>=Date.parse(events[0].sampledAt));
 }finally{await fs.rm(runtime,{recursive:true,force:true});}
});
