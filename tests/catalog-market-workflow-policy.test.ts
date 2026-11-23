import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultCollectionControls,collectionMarketEnabled,collectionWorkflowEnabled} from '../apps/web/lib/catalog/collection-controls-schema.ts';
import {paidEncarBindingFromWorkflow} from '../scripts/lib/paid-encar-artifact-binding.mjs';

// Execute the actual workflow planner with offline controls and filesystem.
const workflow=fs.readFileSync('.github/workflows/catalog-market-refresh.yml','utf8');
const match=workflow.match(/node --import tsx --input-type=module <<'JS'\n([\s\S]*?)\n          JS/);
assert.ok(match,'workflow planner exists');
const body=match[1].split('\n').map(line=>line.slice(10)).filter(line=>!line.startsWith('import ')&&!line.includes("await import('./apps/web/lib/catalog/collection-")).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const planner=new AsyncFunction('fs','catalogRefreshDue','readCollectionControls','collectionMarketEnabled','collectionWorkflowEnabled','paidEncarBindingFromWorkflow','process','console',body);
async function plan(market,enabled,event='schedule',due=true,marketEnabled=true,extraEnv={},marker={}){
 const controls=defaultCollectionControls();
 for(const value of Object.values(controls.sources))value.enabled=false;
 for(const id of enabled)controls.sources[id].enabled=true;
 controls.markets[market].enabled=marketEnabled;
 let output='';const logs=[];
 const fakeFs={readFileSync:path=>JSON.stringify(path.endsWith('refresh-policy-v1.json')?{pausedMarkets:{}}:marker),appendFileSync:(_path,value)=>{output+=value;}};
 await planner(fakeFs,(_now, marketName)=>marketName==='china'||due,async()=>controls,collectionMarketEnabled,collectionWorkflowEnabled,paidEncarBindingFromWorkflow,{env:{TARGET_MARKET:market,EVENT_NAME:event,GITHUB_OUTPUT:'offline',...extraEnv}},{log:value=>logs.push(value)});
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
test('market cadence and explicit dispatch semantics are preserved',async()=>{
 assert.equal((await plan('korea',['encar_direct'],'schedule',false)).values.run,'false');
 assert.equal((await plan('korea',['encar_direct'],'workflow_dispatch',false)).values.run,'true');
});
const sameRun={PREPARED_ENCAR_RUN:'500',PREPARED_ENCAR_SELF:'true',PREPARED_ENCAR_ATTEMPT:'1',
 PREPARED_ENCAR_ARTIFACT_ID:'900',PREPARED_ENCAR_ARTIFACT_DIGEST:'d'.repeat(64),
 GITHUB_RUN_ID:'500',GITHUB_RUN_ATTEMPT:'2',GITHUB_REPOSITORY_ID:'100',GITHUB_SHA:'a'.repeat(40)};
test('same-run paid publication reuses only its validated producer and performs no source collection',async()=>{
 const p=await plan('korea',['encar_feed'],'schedule',false,true,sameRun);
 assert.equal(p.values.run,'true');assert.equal(p.values.reuse_run_id,'500');
 assert.equal(p.values.collect_markets,'[]');assert.equal(p.values.publish_matrix,'["korea"]');
});
test('same-run publication rejects another run, future attempt, missing binding or disabled paid source',async()=>{
 for(const changed of [{PREPARED_ENCAR_RUN:'501'},{PREPARED_ENCAR_ATTEMPT:'3'},
  {PREPARED_ENCAR_ARTIFACT_ID:''},{PREPARED_ENCAR_ARTIFACT_DIGEST:''}]){
  await assert.rejects(plan('korea',['encar_feed'],'schedule',true,true,{...sameRun,...changed}),/paid_encar_artifact_binding_/);
 }
 await assert.rejects(plan('korea',['encar_direct'],'schedule',true,true,sameRun),/invalid_prepared_encar_source/);
 assert.equal((await plan('korea',['encar_feed'],'schedule',true,false,sameRun)).values.run,'false');
});
test('existing external prepared-run route remains separate from same-run artifact bindings',async()=>{
 const p=await plan('korea',['encar_feed'],'workflow_run',false,true,{PREPARED_ENCAR_RUN:'400'});
 assert.equal(p.values.run,'true');assert.equal(p.values.reuse_run_id,'400');assert.equal(p.values.collect_markets,'[]');
 await assert.rejects(plan('korea',['encar_feed'],'workflow_run',true,true,{...sameRun,PREPARED_ENCAR_SELF:'false'}),/unexpected_prepared_encar_binding/);
});
test('prepared paid Korea cannot overlay parser collection through an old push marker',async()=>{
 await assert.rejects(plan('korea',['encar_feed'],'push',true,true,sameRun,{refreshMarkets:['korea']}),/prepared_encar_collection_overlay_forbidden/);
 await assert.rejects(plan('korea',['encar_feed'],'push',true,true,{PREPARED_ENCAR_RUN:'400'},{refreshMarkets:['korea']}),/prepared_encar_collection_overlay_forbidden/);
});

test('daily China uses the reviewed frozen publisher without changing other market checkout selection',()=>{
 const pin='bb6317bffd1f7b1832681ac78378fe6c3e39e3b5';
 const before=workflow.slice(0,workflow.indexOf('  publish:\n')),publish=workflow.slice(workflow.indexOf('  publish:\n'));
 assert.ok(!before.includes('CHINA_APPROVED_PUBLISHER_SHA')&&!before.includes(pin));
 assert.ok(publish.includes(`ref: \${{ matrix.market == 'china' && '${pin}' || (inputs.prepared_encar_run && github.sha || github.event.workflow_run.head_sha || github.sha) }}`));
 assert.ok(publish.includes(`CHINA_APPROVED_PUBLISHER_SHA: \${{ matrix.market == 'china' && '${pin}' || '' }}`));
 assert.ok(publish.includes(`CATALOG_CHUNKED_PROJECTIONS_WRITE: \${{ matrix.market == 'china' && '1' || '0' }}`));
 assert.ok(publish.includes('CATALOG_CHUNKED_ALL_PROJECTION_WRITE: "1"'));
});

test('daily China serving mismatch fails before recovery, archive, cursor or even outcome storage writes',()=>{
 const publish=workflow.slice(workflow.indexOf('  publish:\n'));
 const gate=publish.indexOf('run: node --import tsx scripts/verify-china-publisher-source.mjs');
 assert.ok(gate>publish.indexOf('- run: npm ci'));
 for(const later of ['scripts/catalog-auto-api-che168-recover.mjs','scripts/catalog-archive-intake.mjs restore-for-publication','scripts/catalog-publish-market.mjs','scripts/catalog-commit-intake-cursor.mjs']) assert.ok(publish.indexOf(later)>gate);
 assert.match(publish,/id: china_publisher_source\n        if: matrix.market == 'china'/);
 assert.ok(publish.includes("if: always() && (matrix.market != 'china' || steps.china_publisher_source.conclusion == 'success')"));
 assert.ok(publish.includes('run: node scripts/catalog-budget-runtime.mjs --resolve'));
 assert.ok(publish.includes('ref: ${{ steps.budget_runtime.outputs.release }}'));
 assert.ok(publish.includes('CATALOG_BUDGET_RUNTIME_ROOT: ${{ github.workspace }}/.catalog-serving-runtime'));
});

test('China daily cursor uses the same lease and conditional write wrapper while other markets retain their CLI',()=>{
 const p=workflow.slice(workflow.indexOf('  publish:\n'));
 assert.ok(p.includes('cursor_existing_etag_required'));
 assert.ok(p.includes("const key='catalog/import-lock.json'"));
 assert.ok(p.includes("before.found?{ifMatch:before.etag}:{ifNoneMatch:'*'}"));
 assert.ok(p.includes('node --import tsx "$RUNNER_TEMP/china-guarded-cursor.mjs"'));
 assert.ok(p.includes('node --import tsx scripts/catalog-commit-intake-cursor.mjs'));
});


test('saved paid producer is bound to its original source and never collects again',async()=>{
 const saved={...sameRun,PREPARED_ENCAR_SELF:'false',PREPARED_ENCAR_RUN:'400',PREPARED_ENCAR_SOURCE_SHA:'b'.repeat(40)};
 const p=await plan('korea',['encar_feed'],'push',false,true,saved);
 assert.equal(p.values.run,'true');assert.equal(p.values.reuse_run_id,'400');
 assert.equal(p.values.collect_markets,'[]');assert.equal(p.values.publish_matrix,'["korea"]');
 for(const changed of [{PREPARED_ENCAR_SOURCE_SHA:'invalid'},{PREPARED_ENCAR_RUN:'500'},
  {PREPARED_ENCAR_ARTIFACT_DIGEST:''},{PREPARED_ENCAR_ARTIFACT_ID:''}]){
  await assert.rejects(plan('korea',['encar_feed'],'push',true,true,{...saved,...changed}),/paid_encar_artifact_binding_/);
 }
 await assert.rejects(plan('korea',['encar_feed'],'push',true,true,{...sameRun,PREPARED_ENCAR_SOURCE_SHA:'b'.repeat(40)}),/source_mode/);
});
