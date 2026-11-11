import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshGenerationPages, refreshGenerationPagesWindow} from '../scripts/lib/catalog-refresh-generation-pages.mjs';
function fixture() {
  const writes = [], reads = [], objects = new Map();
  const generation = 'gen_old', prefix = `catalog/generations/${generation}/indexes/`;
  objects.set('catalog/manifest.json', {generationId:generation, markets:{china:{count:2}}});
  objects.set('catalog/import-lock.json', {lockedUntil:'2099-01-01',operationType:'catalog_v3_publish_china'});
  objects.set(`${prefix}projection/china.json`, {generationId:generation, items:[{id:'a',market:'china'},{id:'b',market:'china'}]});
  const options = {
    storage: {
      async readJson(path,fallback) {reads.push(path); return objects.get(path) ?? fallback;},
      async readJsonWithMeta(path,fallback) {return {found:objects.has(path),value:objects.get(path)??fallback,etag:objects.has(path)?'v1':undefined};},
      async writeJson(path,value,condition) {writes.push({path,value,condition}); objects.set(path,value);},
    }, markets:['china'], now:()=>new Date('2026-10-23T00:00:00Z'),
    landingPath:g=>`catalog/generations/${g}/indexes/market-landing-v1/china.json`,
    overviewPath:g=>`catalog/generations/${g}/indexes/overview.json`,
    prepareRows:rows=>rows.slice(0,1),
    buildLanding:async(g,market,items)=>({generationId:g,market,sourceTotal:items.length,total:1,policyDate:'2026-10-23'}),
    buildOverview:async(g,rows)=>({generationId:g,facets:{generationId:g},policyDate:'2026-10-23',markets:{china:{total:rows.length,sourceTotal:rows.length}}}),
  };
  return {options,objects,writes,reads,prefix};
}
test('active publisher does not block scoped pages; source counts survive date filtering',async()=>{
  const f=fixture(); const result=await refreshGenerationPages(f.options);
  assert.equal(result.generationScopedOnly,true);
  assert.equal(f.writes.length,2);
  for(const w of f.writes) {assert.ok(w.path.startsWith(f.prefix));assert.deepEqual(w.condition,{ifNoneMatch:'*'});}
  assert.equal(f.writes[1].value.markets.china.sourceTotal,2);
  assert.equal(f.writes[1].value.markets.china.total,1);
  assert.equal(f.objects.get('catalog/manifest.json').generationId,'gen_old');
  assert.equal(f.reads.includes('catalog/import-lock.json'),false);
});
test('cutover during build prevents old overview write',async()=>{
  const f=fixture(); const build=f.options.buildOverview;
  f.options.buildOverview=async(...args)=>{f.objects.set('catalog/manifest.json',{generationId:'gen_new'});return build(...args);};
  await assert.rejects(refreshGenerationPages(f.options),/generation_changed/);
  assert.equal(f.writes.length,1);
});
test('midnight during build prevents publication with wrong policy day',async()=>{
  const f=fixture(); const build=f.options.buildLanding;
  let date=new Date('2026-10-23T00:00:00Z'); f.options.now=()=>date;
  f.options.buildLanding=async(...args)=>{date=new Date('2026-10-24');return build(...args);};
  await assert.rejects(refreshGenerationPages(f.options),/date_changed/); assert.equal(f.writes.length,0);
});
test('incomplete sources cannot become ready pages',async()=>{
  const f=fixture(); f.objects.get(`${f.prefix}projection/china.json`).items.pop();
  await assert.rejects(refreshGenerationPages(f.options),/source_count_mismatch/);assert.equal(f.writes.length,0);
});
test('existing derivatives require ETags and conflicting refresh fails closed',async()=>{
  const f=fixture();f.objects.set(`${f.prefix}overview.json`,{});
  const write=f.options.storage.writeJson;
  f.options.storage.writeJson=async(path,value,condition)=>{
    if(path.endsWith('/overview.json')) {assert.deepEqual(condition,{ifMatch:'v1'});throw Error('storage_conflict');}
    return write(path,value,condition);
  };
  await assert.rejects(refreshGenerationPages(f.options),/storage_conflict/);
  assert.deepEqual(f.objects.get(`${f.prefix}overview.json`),{});
});
test('refuses an alias passed as output path',async()=>{
 const f=fixture(); f.options.overviewPath=()=> 'catalog/public/overview.json';
 await assert.rejects(refreshGenerationPages(f.options),/unscoped_write/);assert.equal(f.writes.length,0);
});

 test('future derivatives use exact policy date while rollover still fences writes',async()=>{
  const f=fixture();f.options.policyNow=new Date('2026-10-24T00:00:00Z');
  const landing=f.options.buildLanding,overview=f.options.buildOverview;
  f.options.buildLanding=async(...args)=>({...await landing(...args),policyDate:'2026-10-24'});
  f.options.buildOverview=async(...args)=>({...await overview(...args),policyDate:'2026-10-24'});
  f.options.landingPath=g=>`catalog/generations/${g}/indexes/market-landing-v1/china.2026-10-24.json`;
  f.options.overviewPath=g=>`catalog/generations/${g}/indexes/overview.2026-10-24.json`;
  await refreshGenerationPages(f.options);
  assert.equal(f.writes.length,2);assert.ok(f.writes.every(w=>w.path.endsWith('.2026-10-24.json')));
  assert.equal(f.objects.has(f.prefix+'overview.json'),false);
  f.options.policyNow=new Date('2026-11-01');
  await assert.rejects(refreshGenerationPages(f.options),/horizon_invalid/);
 });

test('deployment prepares current and future pages before candidate HTTP acceptance',async()=>{
 const {readFile}=await import('node:fs/promises');
 const workflow=await readFile(new URL('../.github/workflows/regcloud-deploy.yml',import.meta.url),'utf8');
 assert.ok(workflow.indexOf('CATALOG_OVERVIEW_SKIP_READY=true npx tsx scripts/catalog-refresh-generation-pages.mjs')>workflow.indexOf('npx tsx scripts/regcloud-prepare-prices.mjs'));
 assert.ok(workflow.indexOf('CATALOG_OVERVIEW_SKIP_READY=true npx tsx scripts/catalog-refresh-generation-pages.mjs')<workflow.indexOf('- name: Deploy with rollback'));
});

test('market-only preparation never reads or replaces a global overview',async()=>{
 const f=fixture();f.options.landingsOnly=true;
 f.options.overviewPath=()=>{throw Error('unrelated_overview');};
 f.options.buildOverview=()=>{throw Error('partial_overview_forbidden');};
 const result=await refreshGenerationPages(f.options);
 assert.equal(result.landingsOnly,true);
 assert.equal(f.writes.length,1);
});

function windowFixture({landingsOnly=false,skipReady=false}={}) {
  const f=fixture(), calls=[];
  let clock=new Date('2026-10-23T16:59:59Z');
  const now=()=>new Date(clock);
  const state={...f,calls,
    advance:()=>{clock=new Date(Math.floor((clock.getTime()+7*3600000)/86400000)*86400000-7*3600000+86400000);},
    beforeDay:()=>{},onBuild:()=>{},afterDay:()=>{}};
  state.run=()=>refreshGenerationPagesWindow({now,refreshDay:async(policyNow,offset)=>{
    const policyDate=new Date(policyNow.getTime()+7*3600000).toISOString().slice(0,10);
    calls.push({policyDate,offset});
    state.beforeDay();
    const dated=path=>offset?path.replace(/\.json$/,`.${policyDate}.json`):path;
    const result=await refreshGenerationPages({...f.options,now,policyNow,landingsOnly,skipReady,
      landingPath:g=>dated(f.options.landingPath(g)),overviewPath:g=>dated(f.options.overviewPath(g)),
      buildLanding:async(g,market,items)=>{
        state.onBuild();
        return {generationId:g,market,sourceTotal:items.length,total:1,policyDate};
      },
      buildOverview:async(g,rows)=>({generationId:g,facets:{generationId:g},policyDate,markets:{china:{total:rows.length}}}),
    });
    state.afterDay(result);
    return result;
  }});
  return state;
}

test('date rollover restarts the complete three-day window with a freshly captured date',async()=>{
  const f=windowFixture({skipReady:true});
  f.onBuild=()=>{if(f.calls.length===2)f.advance();};
  const result=await f.run();
  assert.deepEqual(f.calls,[
    {policyDate:'2026-10-23',offset:0},{policyDate:'2026-10-24',offset:1},
    {policyDate:'2026-10-24',offset:0},{policyDate:'2026-10-25',offset:1},{policyDate:'2026-10-26',offset:2},
  ]);
  assert.deepEqual(result.map(row=>row.policyDate),['2026-10-24','2026-10-25','2026-10-26']);
  for(const [suffix,day] of [['','2026-10-24'],['.2026-10-25','2026-10-25'],['.2026-10-26','2026-10-26']]){
    assert.equal(f.objects.get(`${f.prefix}overview${suffix}.json`).policyDate,day);
    assert.equal(f.objects.get(`${f.prefix}market-landing-v1/china${suffix}.json`).policyDate,day);
  }
  const currentWrites=f.writes.filter(row=>row.path===`${f.prefix}overview.json`);
  assert.deepEqual(currentWrites.map(row=>row.condition),[{ifNoneMatch:'*'},{ifMatch:'v1'}]);
  assert.equal(f.objects.has(`${f.prefix}overview.2026-10-24.json`),false,'failed day must not be published');
  const count=f.writes.length;
  assert.ok((await f.run()).every(row=>row.alreadyPrepared),'skipReady still applies after recovery');
  assert.equal(f.writes.length,count);
});

test('a stable market-only window preserves all three dates without overview reads or writes',async()=>{
  const f=windowFixture({landingsOnly:true});
  f.options.overviewPath=()=>{throw Error('unrelated_overview');};
  const result=await f.run();
  assert.deepEqual(result.map(row=>row.policyDate),['2026-10-23','2026-10-24','2026-10-25']);
  assert.ok(result.every(row=>row.landingsOnly));
  assert.equal(f.writes.length,3);
  assert.ok(f.writes.every(row=>row.path.includes('/market-landing-v1/')));
});

test('rollover after a successful or final skipReady day restarts from the new current day',async()=>{
  for(const finalOffset of [0,2]){
    const f=windowFixture({skipReady:true});
    await f.run();
    f.calls.length=0;
    const completed=[];
    f.afterDay=result=>{completed.push(result);if(f.calls.length===finalOffset+1)f.advance();};
    const result=await f.run();
    assert.ok(completed.slice(0,finalOffset+1).every(row=>row.alreadyPrepared));
    assert.deepEqual(f.calls.slice(finalOffset+1),[
      {policyDate:'2026-10-24',offset:0},{policyDate:'2026-10-25',offset:1},{policyDate:'2026-10-26',offset:2},
    ]);
    assert.deepEqual(result.map(row=>row.policyDate),['2026-10-24','2026-10-25','2026-10-26']);
    assert.equal(f.objects.get(`${f.prefix}overview.json`).policyDate,'2026-10-24');
    assert.equal(f.objects.get(`${f.prefix}market-landing-v1/china.json`).policyDate,'2026-10-24');
  }
});

test('a second date rollover fails closed without a third window attempt',async()=>{
  const f=windowFixture({landingsOnly:true});
  f.onBuild=()=>f.advance();
  await assert.rejects(f.run(),{message:'catalog_pages_date_changed_retry'});
  assert.deepEqual(f.calls,[{policyDate:'2026-10-23',offset:0},{policyDate:'2026-10-24',offset:0}]);
  assert.equal(f.writes.length,0);
});

test('the three-day wrapper does not retry generation, source, CAS or other failures',async()=>{
  for(const error of ['catalog_pages_generation_changed_retry','catalog_overview_source_count_mismatch','storage_conflict','catalog_pages_horizon_invalid','catalog_pages_date_changed_retry_extra']){
    const f=windowFixture();
    if(error==='catalog_pages_generation_changed_retry')f.onBuild=()=>f.objects.set('catalog/manifest.json',{generationId:'gen_new'});
    else if(error==='catalog_overview_source_count_mismatch')f.objects.get(`${f.prefix}projection/china.json`).items.pop();
    else if(error==='storage_conflict')f.options.storage.writeJson=async()=>{throw Error(error);};
    else if(error==='catalog_pages_horizon_invalid')f.beforeDay=()=>f.advance();
    else f.onBuild=()=>{throw Error(error);};
    await assert.rejects(f.run(),new RegExp(error));
    assert.equal(f.calls.length,1,error);
    assert.equal(f.writes.length,0,error);
  }
});
