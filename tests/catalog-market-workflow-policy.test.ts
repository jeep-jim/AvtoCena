import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultCollectionControls,collectionMarketEnabled,collectionWorkflowEnabled} from '../apps/web/lib/catalog/collection-controls-schema.ts';

// Execute the actual workflow planner with offline controls and filesystem.
const workflow=fs.readFileSync('.github/workflows/catalog-market-refresh.yml','utf8');
const match=workflow.match(/node --import tsx --input-type=module <<'JS'\n([\s\S]*?)\n          JS/);
assert.ok(match,'workflow planner exists');
const body=match[1].split('\n').map(line=>line.slice(10)).filter(line=>!line.startsWith('import ')&&!line.includes("await import('./apps/web/lib/catalog/collection-")).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const planner=new AsyncFunction('fs','catalogRefreshDue','readCollectionControls','collectionMarketEnabled','collectionWorkflowEnabled','process','console',body);
async function plan(market,enabled,event='schedule',due=true,marketEnabled=true){
 const controls=defaultCollectionControls();
 for(const value of Object.values(controls.sources))value.enabled=false;
 for(const id of enabled)controls.sources[id].enabled=true;
 controls.markets[market].enabled=marketEnabled;
 let output='';const logs=[];
 const fakeFs={readFileSync:path=>JSON.stringify(path.endsWith('refresh-policy-v1.json')?{pausedMarkets:{}}:{}),appendFileSync:(_path,value)=>{output+=value;}};
 await planner(fakeFs,()=>due,async()=>controls,collectionMarketEnabled,collectionWorkflowEnabled,{env:{TARGET_MARKET:market,EVENT_NAME:event,GITHUB_OUTPUT:'offline'}},{log:value=>logs.push(value)});
 return {values:Object.fromEntries(output.trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];})),logs,controls};
}
test('AJES-only Korea stays available without starting empty legacy collection/publication',async()=>{
 for(const event of ['schedule','push','workflow_dispatch']){
  const p=await plan('korea',['ajes_korea_feed'],event);
  assert.equal(collectionMarketEnabled(p.controls,'korea'),true);
  assert.equal(p.values.run,'false');assert.match(p.logs[0],/no_enabled_background_source/);
  assert.equal(p.controls.sources.ajes_korea_feed.enabled,true);
 }
});
test('owner-enabled background source remains runnable; disabled market stays stopped',async()=>{
 assert.equal((await plan('korea',['encar_direct'])).values.run,'true');
 assert.equal((await plan('korea',['encar_direct'],'schedule',true,false)).values.run,'false');
 assert.equal((await plan('korea',[])).values.run,'false');
});
test('paid China and UAE workers retain their existing routes',async()=>{
 assert.equal((await plan('china',['che168_feed'],'schedule',false)).values.run,'true');
 assert.equal((await plan('uae',['dubicars_feed'])).values.run,'true');
 assert.equal((await plan('china',['ajes_china_feed'])).values.run,'false');
});
test('three-day background cadence and explicit dispatch semantics are preserved',async()=>{
 assert.equal((await plan('korea',['encar_direct'],'schedule',false)).values.run,'false');
 assert.equal((await plan('korea',['encar_direct'],'workflow_dispatch',false)).values.run,'true');
});
