import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
async function startPublicationHeartbeat(...args){const module=await import('../scripts/lib/publication-heartbeat.mjs');return module.startPublicationHeartbeat(...args);}
const operationId='catalog_v3_publish_china_12345678-1234-1234-1234-123456789abc';
async function fixture(fn){
 const cwd=process.cwd(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'publication-heartbeat-'));
 await fs.mkdir(path.join(dir,'data/catalog'),{recursive:true});
 const file=path.join(dir,'data/catalog/import-lock.json');
 await fs.writeFile(file,JSON.stringify({operationId,lockedUntil:new Date(Date.now()+30000).toISOString()}));
 process.chdir(dir);
 try{await fn(file);}finally{process.chdir(cwd);await fs.rm(dir,{recursive:true,force:true});}
}
test('lease stays live while publisher event loop is blocked longer than lease TTL',async()=>{
 await fixture(async file=>{
  const heartbeat=await startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'});
  try{
   const until=Date.now()+2400;while(Date.now()<until){} // Regression: parent timers cannot run here.
   const saved=JSON.parse(await fs.readFile(file,'utf8'));
   assert.equal(saved.operationId,operationId);assert.ok(Date.parse(saved.lockedUntil)>Date.now());
   heartbeat.assertHealthy();
  }finally{await heartbeat.stop();}
  const saved=await fs.readFile(file,'utf8');await delay(250);assert.equal(await fs.readFile(file,'utf8'),saved);
 });
});
test('heartbeat cannot extend another writer lease',async()=>{
 await fixture(async file=>{
  const heartbeat=await startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'});
  try{
   const other={operationId:'another-writer',lockedUntil:new Date(Date.now()+30000).toISOString()};
   await fs.writeFile(file,JSON.stringify(other));await delay(400);
   assert.throws(()=>heartbeat.assertHealthy(),/heartbeat/);
   assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),other);
  }finally{await heartbeat.stop();}
 });
});
test('expired lease cannot be revived by the heartbeat',async()=>{
 await fixture(async file=>{
  await fs.writeFile(file,JSON.stringify({operationId,lockedUntil:'2020-01-01T00:00:00Z'}));
  await assert.rejects(()=>startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'}),/heartbeat_start_failed/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).lockedUntil,'2020-01-01T00:00:00Z');
 });
});

// Exercise the real fork, resource helper, startup preload and IPC worker. The
// observer records only process/resource facts; lease IO stays on a local disk.
test('IPC heartbeat samples fresh resources and exits when its parent disappears',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'publication-heartbeat-ipc-'));
 const lease=path.join(dir,'data/catalog/import-lock.json'),observed=path.join(dir,'observed.json');
 const disconnected=path.join(dir,'disconnected'),exited=path.join(dir,'exited');
 const observer=path.join(dir,'observe.mjs'),parent=path.join(dir,'parent.mjs');
 await fs.mkdir(path.dirname(lease),{recursive:true});
 await fs.writeFile(lease,JSON.stringify({operationId,lockedUntil:new Date(Date.now()+30000).toISOString()}));
 await fs.writeFile(observer,`
  import fs from 'node:fs';
  import {getHeapStatistics} from 'node:v8';
  globalThis.fetch=async()=>{throw Error('test_live_fetch_blocked');};
  fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({pid:process.pid,ppid:process.ppid,
   plan:JSON.parse(process.env.AVTOCENA_NODE_RESOURCE_MEMORY_PLAN),
   heap:getHeapStatistics().heap_size_limit,args:process.execArgv,options:process.env.NODE_OPTIONS}));
  process.once('disconnect',()=>fs.writeFileSync(${JSON.stringify(disconnected)},'disconnected'));
  process.once('exit',code=>fs.writeFileSync(${JSON.stringify(exited)},String(code)));
 `);
 const heartbeatUrl=new URL('../scripts/lib/publication-heartbeat.mjs',import.meta.url).href;
 const nodeOptions='--trace-warnings --max-old-space-size=32 --import '+pathToFileURL(observer).href;
 await fs.writeFile(parent,`
  import {startPublicationHeartbeat} from ${JSON.stringify(heartbeatUrl)};
  const heartbeat=await startPublicationHeartbeat({key:'catalog/import-lock.json',
   operationId:${JSON.stringify(operationId)},ttlMs:1500,intervalMs:100},
   {...process.env,NODE_OPTIONS:${JSON.stringify(nodeOptions)},
    AVTOCENA_NODE_RESOURCE_MEMORY_PLAN:JSON.stringify({version:1,role:'stale-parent',sampledAt:'2000-01-01T00:00:00.000Z',heapMiB:1,capacityBytes:1048576})});
  heartbeat.assertHealthy();
  process.send({ready:true});
 `);
 const started=Date.now();
 const publisher=fork(parent,[],{cwd:dir,execArgv:[],env:{PATH:process.env.PATH,JSON_STORAGE_DRIVER:'local'},
  stdio:['ignore','ignore','pipe','ipc']});
 let stderr='',workerPid:number|undefined;
 publisher.stderr!.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
 t.after(async()=>{
  if(publisher.exitCode===null&&publisher.signalCode===null){const stopped=once(publisher,'exit');publisher.kill('SIGKILL');await stopped;}
  // Only a failed assertion can reach cleanup before the disconnect proof.
  if(workerPid){try{await fs.access(exited);}catch{try{process.kill(workerPid,'SIGKILL');}catch{}}}
  await fs.rm(dir,{recursive:true,force:true});
 });
 const [message]=await once(publisher,'message',{signal:AbortSignal.timeout(10000)});
 assert.deepEqual(message,{ready:true},stderr);
 const actual=JSON.parse(await fs.readFile(observed,'utf8'));workerPid=actual.pid;
 assert.equal(actual.ppid,publisher.pid);
 assert.equal(actual.plan.role,'publication-heartbeat');
 assert.ok(Date.parse(actual.plan.sampledAt)>=started);
 assert.ok(actual.plan.availableRamBytes>0);
 assert.equal(actual.plan.capacityBytes,actual.plan.availableRamBytes+actual.plan.usableSwapBytes);
 assert.equal(actual.plan.heapMiB,Math.floor(actual.plan.capacityBytes/1024**2));
 assert.equal(actual.heap,actual.plan.heapMiB*1024**2);
 assert.ok(actual.args.includes('--max-heap-size='+actual.plan.heapMiB));
 assert.ok(!actual.args.some(arg=>/max[-_]old[-_]space[-_]size/.test(arg)));
 assert.match(actual.options,/trace-warnings/);
 assert.ok(!/max[-_]old[-_]space[-_]size/.test(actual.options));
 assert.ok(actual.options.includes(pathToFileURL(observer).href));
 const telemetry=stderr.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}})
  .find(value=>value.stage==='node_resource_memory'&&value.role==='publication-heartbeat');
 assert.ok(telemetry,'real startup telemetry must reach the publisher stderr');
 assert.equal(telemetry.actualHeapBytes,actual.heap);
 assert.equal(telemetry.sampledAt,actual.plan.sampledAt);
 const renewed=JSON.parse(await fs.readFile(lease,'utf8'));
 assert.equal(renewed.operationId,operationId);assert.ok(Date.parse(renewed.heartbeatAt)>=started);
 const parentExit=once(publisher,'exit');publisher.kill('SIGKILL');await parentExit;
 const deadline=Date.now()+5000;
 for(;;){try{await fs.access(exited);break;}catch{assert.ok(Date.now()<deadline,'heartbeat did not exit after IPC disconnect');await delay(20);}}
 assert.equal(await fs.readFile(disconnected,'utf8'),'disconnected');
 assert.equal(await fs.readFile(exited,'utf8'),'0');
 const afterExit=await fs.readFile(lease,'utf8');await delay(250);
 assert.equal(await fs.readFile(lease,'utf8'),afterExit,'an orphaned heartbeat must not renew the lease');
});
