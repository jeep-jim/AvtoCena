import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshGenerationPages} from '../scripts/lib/catalog-refresh-generation-pages.mjs';
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
