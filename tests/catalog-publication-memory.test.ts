import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {snapshotCatalogRows,assertCatalogRowsUnchanged} from '../scripts/lib/catalog-row-hash.mjs';

const source=fs.readFileSync(new URL('../scripts/catalog-publish-market.mjs',import.meta.url),'utf8');
const loggerStart=source.indexOf('function logPublicationMemory(');
const loggerEnd=source.indexOf('\ntry {',loggerStart);
assert.ok(loggerStart>=0 && loggerEnd>loggerStart);
const createLogger=new Function('process','getHeapStatistics','console','market',
  source.slice(loggerStart,loggerEnd)+'\nreturn logPublicationMemory;');

test('actual publisher telemetry identifies the process and records measured memory without offer contents',()=>{
  const records:any[]=[];
  const log=createLogger({pid:27,ppid:19,version:'v24.22.3',
    memoryUsage:()=>({rss:501,heapUsed:302,external:103,arrayBuffers:41}),
    availableMemory:()=>909},()=>({heap_size_limit:804}),
  {log:text=>records.push(JSON.parse(text))},'korea');
  log('preserved_market_read_complete',{preservedMarket:'china',rows:2});
  assert.equal(records.length,1);
  const {at,...record}=records[0];
  assert.ok(Number.isFinite(Date.parse(at)));
  assert.deepEqual(record,{market:'korea',stage:'preserved_market_read_complete',
    preservedMarket:'china',rows:2,pid:27,ppid:19,nodeVersion:'v24.22.3',
    memoryBytes:{rss:501,heapUsed:302,external:103,arrayBuffers:41,availableMemory:909,heapLimit:804}});
});

const targetStart=source.indexOf('    logPublicationMemory("target_snapshot_read_start");');
const targetEnd=source.indexOf('    await loadPreservedMarkets();',targetStart);
assert.ok(targetStart>=0 && targetEnd>targetStart);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const checkTarget=new AsyncFunction('readMarketOffers','assertCatalogRowsUnchanged','preparedTargetSnapshot','logPublicationMemory',
  'const market="korea";\n'+source.slice(targetStart,targetEnd));

test('actual target recheck releases its array only after proving the snapshot, without changing source rows',async()=>{
  const original=[{id:'a',market:'korea',price:120,operational:{manualNotes:'keep'}},
    {id:'b',market:'korea',price:130,operational:{manualNotes:'preserve'}}];
  const before=structuredClone(original),latest=[...original],snapshot=snapshotCatalogRows(original),events:any[]=[];
  await checkTarget(async market=>{assert.equal(market,'korea');return latest;},assertCatalogRowsUnchanged,snapshot,
    (stage,details)=>events.push({stage,...details}));
  assert.equal(latest.length,0,'the completed recheck must not retain a whole old target beside preserved markets');
  assert.deepEqual(original,before);
  assert.deepEqual(snapshot,snapshotCatalogRows(original));
  assert.deepEqual(events,[{stage:'target_snapshot_read_start'},
    {stage:'target_snapshot_read_complete',rows:2},{stage:'target_snapshot_released',rows:2}]);
});

test('actual target recheck still fails on a concurrent same-count change before releasing or loading neighbours',async()=>{
  const snapshot=snapshotCatalogRows([{id:'a',market:'korea',price:120}]);
  const latest=[{id:'a',market:'korea',price:121}],before=structuredClone(latest),events:string[]=[];
  await assert.rejects(checkTarget(async()=>latest,assertCatalogRowsUnchanged,snapshot,stage=>events.push(stage)),
    /catalog_target_changed_during_prepare:korea/);
  assert.deepEqual(latest,before);
  assert.deepEqual(events,['target_snapshot_read_start','target_snapshot_read_complete']);
});
