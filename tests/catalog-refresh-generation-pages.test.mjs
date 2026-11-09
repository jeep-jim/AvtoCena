import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshGenerationPages} from '../scripts/lib/catalog-refresh-generation-pages.mjs';
import {generationPagePreparation,RELEASE_MARKETS} from '../scripts/lib/release-market-scope.mjs';
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
test('explicit home release reads all saved projections and retains Japan in the shared overview',async()=>{
 const f=fixture();Object.assign(f.options,generationPagePreparation('china',true));
 f.objects.get('catalog/manifest.json').markets.japan={count:1};
 f.objects.set(f.prefix+'projection/japan.json',{generationId:'gen_old',items:[{id:'japan-a',market:'japan'}]});
 f.options.landingPath=(g,m)=>`catalog/generations/${g}/indexes/market-landing-v1/${m}.json`;
 f.options.buildLanding=async(g,m,rows)=>({generationId:g,market:m,sourceTotal:rows.length,total:rows.length,policyDate:'2026-10-23'});
 f.options.prepareRows=rows=>rows;
 f.options.buildOverview=async(g,rows)=>({generationId:g,policyDate:'2026-10-23',facets:{generationId:g,markets:[...new Set(rows.map(row=>row.market))]},
  markets:Object.fromEntries(RELEASE_MARKETS.map(market=>{const items=rows.filter(row=>row.market===market);return [market,{total:items.length,items}];}))});
 await refreshGenerationPages(f.options);
 const overview=f.objects.get(f.prefix+'overview.json');
 assert.equal(f.reads.includes(f.prefix+'projection/japan.json'),true);
 assert.deepEqual(overview.markets.japan,{sourceTotal:1,total:1,items:[{id:'japan-a',market:'japan'}]});
 assert.equal(overview.facets.markets.includes('japan'),true);
 assert.equal(f.writes.length,7);assert.equal(f.reads.includes('catalog/import-lock.json'),false);
});

function requireCompleteOverview(overview,{generationId,manifest,policyDate}){
 const market=overview?.markets?.china;
 return overview?.generationId===generationId&&overview.policyDate===policyDate&&market?.sourceTotal===manifest.markets.china.count
  &&Number.isInteger(market.total)&&market.total>0&&market.total<=market.sourceTotal&&Array.isArray(market.items)&&market.items.length>=Math.min(10,market.total);
}
function readyOverview(f,overrides={}){
 return {generationId:'gen_old',facets:{generationId:'gen_old'},policyDate:'2026-10-23',dailyLandingsVersion:1,
  markets:{china:{sourceTotal:2,total:1,items:[{id:'a',market:'china'}],...overrides}}};
}
test('home readiness may skip only a complete current generation summary',async()=>{
 const f=fixture();f.options.skipReady=true;f.options.overviewComplete=requireCompleteOverview;
 f.objects.set(f.prefix+'overview.json',readyOverview(f));
 const result=await refreshGenerationPages(f.options);
 assert.equal(result.alreadyPrepared,true);assert.equal(f.writes.length,0);
 assert.equal(f.reads.some(key=>key.includes('/projection/')),false);
});
for(const scenario of ['wrong-source-count','missing-cards','false-zero','old-policy','missing-market']){
 test(`home readiness rebuilds ${scenario} despite a saved ready marker`,async()=>{
  const f=fixture();f.options.skipReady=true;f.options.overviewComplete=requireCompleteOverview;
  const previous=readyOverview(f,scenario==='wrong-source-count'?{sourceTotal:1}:scenario==='missing-cards'?{items:[]}:scenario==='false-zero'?{total:0,items:[]}:{});
  if(scenario==='old-policy')previous.policyDate='2026-10-22';
  if(scenario==='missing-market')previous.markets={};
  f.objects.set(f.prefix+'overview.json',previous);
  f.options.buildOverview=async()=>readyOverview(f);
  const result=await refreshGenerationPages(f.options);
  assert.equal(result.alreadyPrepared,undefined);assert.equal(f.writes.length,2);
  const write=f.writes.find(w=>w.path.endsWith('/overview.json'));
  assert.deepEqual(write.condition,{ifMatch:'v1'});
  assert.equal(write.value.markets.china.items.length,1);
 });
}
test('failed home completeness preserves the prior overview and generation fence still applies',async()=>{
 const f=fixture();f.options.overviewComplete=requireCompleteOverview;
 const previous=readyOverview(f);f.objects.set(f.prefix+'overview.json',previous);
 await assert.rejects(refreshGenerationPages(f.options),/home_overview_incomplete/);
 assert.equal(f.writes.length,1);assert.equal(f.objects.get(f.prefix+'overview.json'),previous);
 const g=fixture();g.options.overviewComplete=requireCompleteOverview;
 g.options.buildOverview=async()=>{g.objects.set('catalog/manifest.json',{generationId:'new'});return readyOverview(g);};
 await assert.rejects(refreshGenerationPages(g.options),/generation_changed/);
 assert.equal(g.writes.length,1);assert.equal(g.objects.has(g.prefix+'overview.json'),false);
});
test('home flag is carried through preparation, candidate checks and deployment regression tests',async()=>{
 const {readFile}=await import('node:fs/promises');
 const workflow=await readFile(new URL('../.github/workflows/regcloud-deploy.yml',import.meta.url),'utf8');
 const entry=await readFile(new URL('../scripts/catalog-refresh-generation-pages.mjs',import.meta.url),'utf8');
 const deploy=await readFile(new URL('../scripts/regcloud-deploy-production.sh',import.meta.url),'utf8');
 assert.match(workflow,/markerHomeCatalog\('\.github\/market-runs\/regcloud-deploy\.json'\)/);
 assert.match(workflow,/RELEASE_REQUIRE_HOME_CATALOG=\$\{requireHomeCatalog\?'1':'0'\}/);
 assert.match(workflow,/'\$RELEASE_PREPARATION_MARKETS' '\$RELEASE_REQUIRE_HOME_CATALOG'/);
 assert.match(workflow,/node --test tests\/release-market-scope\.test\.mjs tests\/catalog-overview-source-validation\.test\.mjs tests\/catalog-refresh-generation-pages\.test\.mjs/);
 assert.match(entry,/catalogOverviewMatchesGeneration\(overview,generationId\)/);
 assert.match(entry,/catalogOverviewMarketComplete\(/);assert.match(entry,/HOME_OVERVIEW_MARKETS\.every/);
 assert.match(entry,/\.\.\.preparation,overviewComplete/);
 assert.match(deploy,/export AVTOCENA_RELEASE_REQUIRE_HOME_CATALOG="\$\{5:-0\}"/);
});
