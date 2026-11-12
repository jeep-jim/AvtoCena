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
    buildOverview:async(g,rows)=>({version:1,publicPolicyVersion:2,generationId:g,facets:{generationId:g},policyDate:'2026-10-23',markets:{china:{total:rows.length,sourceTotal:rows.length,items:rows}}}),
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

function readyOverviewFixture() {
  const f=fixture(), generationId='gen_old', policyDate='2026-10-23';
  const counts={china:12,korea:3,japan:0};
  f.objects.set('catalog/manifest.json',{generationId,markets:Object.fromEntries(Object.entries(counts).map(([market,count])=>[market,{count}]))});
  const markets={};
  for(const [market,count] of Object.entries(counts)){
    const items=Array.from({length:count},(_,id)=>({id:`${market}-${id}`,market}));
    f.objects.set(`${f.prefix}projection/${market}.json`,{generationId,items});
    markets[market]={total:count,sourceTotal:count,items:items.slice(0,10)};
  }
  const overview={version:1,publicPolicyVersion:2,generationId,policyDate,dailyLandingsVersion:1,facets:{generationId},markets};
  f.objects.set(`${f.prefix}overview.json`,overview);
  Object.assign(f.options,{
    markets:Object.keys(counts),skipReady:true,isPublished:item=>item.sourceId!=='withdrawn',
    landingPath:(g,market)=>`catalog/generations/${g}/indexes/market-landing-v1/${market}.json`,
    prepareRows:rows=>rows,
    buildLanding:async(g,market,items)=>({generationId:g,market,sourceTotal:items.length,total:items.length,policyDate}),
    buildOverview:async(g,rows)=>({version:1,publicPolicyVersion:2,generationId:g,facets:{generationId:g},policyDate,
      markets:Object.fromEntries(Object.keys(counts).map(market=>{const items=rows.filter(row=>row.market===market);return [market,{total:items.length,items:items.slice(0,10)}];})),
    }),
  });
  return {...f,overview};
}

test('ready overview skips work only when every requested market is complete, including zero-count markets',async()=>{
  const f=readyOverviewFixture();
  assert.equal((await refreshGenerationPages(f.options)).alreadyPrepared,true);
  assert.equal(f.writes.length,0);
  assert.equal(f.reads.some(path=>path.includes('/projection/')),false);
  assert.deepEqual(f.overview.markets.japan,{total:0,sourceTotal:0,items:[]});
});

test('date and generation markers cannot make an incomplete home overview skip preparation',async()=>{
  const damage=[
    value=>{value.version=0;},
    value=>{value.publicPolicyVersion=1;},
    value=>{delete value.markets.korea;},
    value=>{value.markets.korea.sourceTotal=2;},
    value=>{value.markets.japan.sourceTotal=1;},
    value=>{value.markets.china.total=NaN;},
    value=>{value.markets.china.total=1.5;},
    value=>{value.markets.china.total=-1;},
    value=>{value.markets.china.total=13;},
    value=>{value.markets.china.total=0;},
    value=>{value.markets.china.items={length:10};},
    value=>{value.markets.china.items[0]=null;},
    value=>{value.markets.china.items=Array.from({length:10},()=>({}));},
    value=>{value.markets.china.items[0]=value.markets.china.items[1];},
    value=>{value.markets.china.items[0]={id:'wrong-market',market:'korea'};},
    value=>{value.markets.china.items.pop();},
    value=>{value.markets.china.items[0]={id:'withdrawn',sourceId:'withdrawn'};},
    value=>{value.markets.japan.items=null;},
  ];
  for(const corrupt of damage){
    const f=readyOverviewFixture();corrupt(f.overview);
    const result=await refreshGenerationPages(f.options);
    assert.notEqual(result.alreadyPrepared,true,corrupt.toString());
    assert.equal(f.writes.length,4,corrupt.toString());
    assert.deepEqual(f.writes.at(-1).condition,{ifMatch:'v1'});
    assert.equal(f.objects.get(`${f.prefix}overview.json`).markets.korea.sourceTotal,3);
    assert.equal(f.reads.includes(`${f.prefix}projection/japan.json`),false,'empty market needs no source read');
  }
});

test('ready-looking overview cannot bypass invalid current manifest source counts',async()=>{
  const f=readyOverviewFixture();
  f.objects.get('catalog/manifest.json').markets.china.count='invalid';
  await assert.rejects(refreshGenerationPages(f.options),/catalog_pages_source_count_invalid/);
  assert.equal(f.writes.length,0);
});

function windowFixture({landingsOnly=false,skipReady=false}={}) {
  const f=fixture(), calls=[];
  let clock=new Date('2026-10-23T16:59:59Z');
  const now=()=>new Date(clock);
  const state={...f,calls,
    advance:()=>{clock=new Date(Math.floor((clock.getTime()+7*3600000)/86400000)*86400000-7*3600000+86400000);},
    beforeDay:()=>{},onBuild:()=>{},afterDay:()=>{}};
  state.run=()=>refreshGenerationPagesWindow({now,
    getGeneration:async()=>f.objects.get('catalog/manifest.json')?.generationId,
    refreshDay:async(policyNow,offset)=>{
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
      buildOverview:async(g,rows)=>({version:1,publicPolicyVersion:2,generationId:g,facets:{generationId:g},policyDate,markets:{china:{total:rows.length,items:rows}}}),
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

test('the three-day wrapper does not retry source, CAS or other failures',async()=>{
  for(const error of ['catalog_overview_source_count_mismatch','storage_conflict','catalog_pages_horizon_invalid','catalog_pages_date_changed_retry_extra','catalog_pages_generation_changed_retry_extra']){
    const f=windowFixture();
    if(error==='catalog_overview_source_count_mismatch')f.objects.get(`${f.prefix}projection/china.json`).items.pop();
    else if(error==='storage_conflict')f.options.storage.writeJson=async()=>{throw Error(error);};
    else if(error==='catalog_pages_horizon_invalid')f.beforeDay=()=>f.advance();
    else f.onBuild=()=>{throw Error(error);};
    await assert.rejects(f.run(),new RegExp(error));
    assert.equal(f.calls.length,1,error);
    assert.equal(f.writes.length,0,error);
  }
});

function changeWindowGeneration(f,generationId) {
  const previous=f.objects.get('catalog/manifest.json');
  f.objects.set('catalog/manifest.json',{...previous,generationId});
  f.objects.set(`catalog/generations/${generationId}/indexes/projection/china.json`,{
    generationId,items:[{id:'a',market:'china'},{id:'b',market:'china'}],
  });
}

function assertCompleteGenerationWindow(f,result,generationId) {
  assert.deepEqual(result.map(row=>row.generationId),[generationId,generationId,generationId]);
  for(const [suffix,day] of [['','2026-10-23'],['.2026-10-24','2026-10-24'],['.2026-10-25','2026-10-25']]){
    const prefix=`catalog/generations/${generationId}/indexes/`;
    for(const name of ['overview','market-landing-v1/china']){
      const page=f.objects.get(`${prefix}${name}${suffix}.json`);
      assert.equal(page?.generationId,generationId);
      assert.equal(page?.policyDate,day);
    }
  }
}

test('generation turnover between dated builds restarts the entire window',async()=>{
  const f=windowFixture({skipReady:true});
  f.afterDay=()=>{if(f.calls.length===1)changeWindowGeneration(f,'gen_new');};
  const result=await f.run();
  assert.deepEqual(f.calls.map(row=>row.offset),[0,1,0,1,2]);
  assertCompleteGenerationWindow(f,result,'gen_new');
});

test('generation turnover inside a dated build uses the same bounded window retry',async()=>{
  const f=windowFixture();
  f.onBuild=()=>{if(f.calls.length===1)changeWindowGeneration(f,'gen_new');};
  const result=await f.run();
  assert.deepEqual(f.calls.map(row=>row.offset),[0,0,1,2]);
  assertCompleteGenerationWindow(f,result,'gen_new');
  assert.equal(f.objects.has(`${f.prefix}overview.json`),false);
});

test('final manifest validation catches publication after the last skipReady day',async()=>{
  const f=windowFixture({skipReady:true});
  await f.run();
  f.calls.length=0;
  const completed=[];
  f.afterDay=result=>{
    completed.push(result);
    if(f.calls.length===3)changeWindowGeneration(f,'gen_new');
  };
  const result=await f.run();
  assert.ok(completed.slice(0,3).every(row=>row.alreadyPrepared));
  assert.deepEqual(f.calls.map(row=>row.offset),[0,1,2,0,1,2]);
  assertCompleteGenerationWindow(f,result,'gen_new');
});

test('stable ready generation requires a final manifest read and performs no rebuild',async()=>{
  const f=windowFixture({skipReady:true});
  await f.run();
  const writes=f.writes.length;
  f.calls.length=0;
  f.onBuild=()=>{throw Error('ready_window_must_not_rebuild');};
  const result=await f.run();
  assert.ok(result.every(row=>row.alreadyPrepared));
  assertCompleteGenerationWindow(f,result,'gen_old');
  assert.equal(f.writes.length,writes);
  assert.deepEqual(f.calls.map(row=>row.offset),[0,1,2]);
  let reads=0;
  await refreshGenerationPagesWindow({now:()=>new Date('2026-10-23'),
    getGeneration:async()=>{reads++;return 'gen_old';},
    refreshDay:async()=>({generationId:'gen_old',alreadyPrepared:true})});
  assert.equal(reads,2);
});

test('a second generation change fails without a third window attempt',async()=>{
  const f=windowFixture();
  f.afterDay=()=>changeWindowGeneration(f,`gen_changed_${f.calls.length}`);
  await assert.rejects(f.run(),{message:'catalog_pages_generation_changed_retry'});
  assert.deepEqual(f.calls.map(row=>row.offset),[0,1,0,1]);
});

test('date and generation turnover share one retry rather than multiplying attempts',async()=>{
  for(const errors of [
    ['catalog_pages_date_changed_retry','catalog_pages_generation_changed_retry'],
    ['catalog_pages_generation_changed_retry','catalog_pages_date_changed_retry'],
  ]){
    let attempts=0;
    await assert.rejects(refreshGenerationPagesWindow({now:()=>new Date('2026-10-23'),
      getGeneration:async()=> 'gen_old',
      refreshDay:async()=>{throw Error(errors[attempts++]);},
    }),{message:errors[1]});
    assert.equal(attempts,2);
  }
});

test('missing generation reader or invalid current manifest fails before building',async()=>{
  const refreshDay=async()=>{throw Error('must_not_build');};
  await assert.rejects(refreshGenerationPagesWindow({refreshDay}),{message:'catalog_pages_generation_reader_required'});
  for(const generation of [undefined,'','../wrong']){
    await assert.rejects(refreshGenerationPagesWindow({refreshDay,getGeneration:async()=>generation}),
      {message:'catalog_pages_manifest_invalid'});
  }
});

test('completed collectors prepare derivatives even when a later step failed',async()=>{
  const {readFile}=await import('node:fs/promises');
  const workflow=await readFile(new URL('../.github/workflows/regcloud-overview.yml',import.meta.url),'utf8');
  assert.match(workflow,/types: \[completed\]/);
  assert.match(workflow,/build:\n(?:    #[^\n]*\n)*    if: github\.ref == 'refs\/heads\/main'\n/);
  assert.doesNotMatch(workflow,/workflow_run\.conclusion/);
  assert.match(workflow,/- cron: '5 17 \* \* \*'/);
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/run: npx tsx scripts\/catalog-refresh-generation-pages\.mjs/);
  assert.doesNotMatch(workflow,/scripts\/(?:catalog-publish|catalog-source-intake|catalog-live-recovery)/);
  const watched=workflow.match(/workflows: \[([^\]]+)\]/)[1].split(',').map(name=>name.trim());
  const names=await Promise.all(['china','korea','europe','uae','georgia','green'].map(async market=>{
    const collector=await readFile(new URL(`../.github/workflows/catalog-refresh-${market}.yml`,import.meta.url),'utf8');
    return collector.match(/^name: (.+)$/m)[1];
  }));
  assert.deepEqual(watched,names);
});


test('release preparation entrypoint only imports files present in this exact checkout',async()=>{
 const {readFile,access}=await import('node:fs/promises');
 const entry=new URL('../scripts/catalog-refresh-generation-pages.mjs',import.meta.url);
 const source=await readFile(entry,'utf8');
 const imports=[...source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)].map(match=>match[2]);
 assert.ok(imports.length>=7,'inspect both static and dynamic runtime dependencies');
 for(const dependency of imports)await assert.doesNotReject(access(new URL(dependency,entry)),`missing release dependency: ${dependency}`);
});
