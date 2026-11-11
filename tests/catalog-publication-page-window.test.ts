import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stageCatalogPageWindow, assertCatalogPageWindowCurrent} from '../apps/web/lib/catalog/publication-page-window';
import {buildCatalogOverviewFromProjections, buildCatalogMarketLanding, persistCatalogOffers,
  resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {getJsonStorage, resetJsonStorageForTests, StorageConflictError} from '../apps/web/lib/data';

const day = (date: Date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
function fixture() {
  const generationId = 'gen_new', prefix = `catalog/generations/${generationId}/indexes/`;
  const rows = [{id:'a',market:'china'}, {id:'b',market:'korea'}];
  const rowsByMarket = new Map(['china','korea','japan'].map(market => [market, rows.filter(row => row.market === market)]));
  const objects = new Map<string, any>(), versions = new Map<string, number>(), writes: {path:string; condition:any}[] = [], reads: string[] = [];
  const storage: any = {
    async readJsonWithMeta(key:string, fallback:any) {
      reads.push(key);
      return {found:objects.has(key),etag:objects.has(key) ? String(versions.get(key) || 1) : undefined,
        value:structuredClone(objects.get(key) ?? fallback)};
    },
    async readJson(key:string, fallback:any) { return (await storage.readJsonWithMeta(key,fallback)).value; },
    async writeJson(key:string, value:any, condition:any) {
      writes.push({path:key,condition});
      if (condition?.ifNoneMatch === '*' && objects.has(key)
          || condition?.ifMatch && condition.ifMatch !== String(versions.get(key) || 1)) throw new StorageConflictError();
      objects.set(key,structuredClone(value));versions.set(key,(versions.get(key)||0)+1);
    },
  };
  let clock = new Date('2026-10-26T16:59:00Z'), contextChecks = 0;
  const options = {storage,generationId,markets:[...rowsByMarket.keys()],rows,rowsByMarket,
    now:()=>new Date(clock), assertContext:async()=>{contextChecks++;},
    landingPath:(g:string,m:string)=>`catalog/generations/${g}/indexes/market-landing-v1/${m}.json`,
    overviewPath:(g:string)=>`catalog/generations/${g}/indexes/overview.json`,
    buildLanding:async(g:string,market:string,source:any[],now:Date)=>({version:1,generationId:g,market,
      policyDate:day(now),sourceTotal:source.length,total:source.length,items:source,facets:{generationId:g}}),
    buildOverview:async(g:string,source:any[],now:Date)=>({version:1,publicPolicyVersion:2,generationId:g,
      policyDate:day(now),facets:{generationId:g},markets:Object.fromEntries([...rowsByMarket.keys()].map(market=>{
        const items=source.filter(row=>row.market===market);return [market,{sourceTotal:items.length,total:items.length,items}];
      }))}),
  };
  return {options,objects,versions,writes,reads,prefix,setClock:(value:Date)=>{clock=value;},checks:()=>contextChecks};
}

test('three exact dates stage only compact generation pages and landings precede each ready overview',async()=>{
  const f=fixture(), result=await stageCatalogPageWindow(f.options);
  assert.deepEqual(result.proof.days,['2026-10-26','2026-10-27','2026-10-28']);
  assert.equal(f.writes.length,12);
  assert.ok(f.writes.every(row=>row.path.startsWith(f.prefix) && row.condition.ifNoneMatch==='*'));
  assert.ok(f.reads.every(key=>key.startsWith(f.prefix)),'no projection, source, manifest or alias reads in the helper');
  for(let index=0;index<3;index++){
    const group=f.writes.slice(index*4,index*4+4);
    assert.ok(group.slice(0,3).every(row=>row.path.includes('market-landing-v1/')));
    assert.match(group[3].path,/overview(?:\.[0-9-]+)?\.json$/);
    assert.equal(f.objects.get(group[3].path).dailyLandingsVersion,1);
    assert.ok(group.every(row=>f.objects.get(row.path).policyDate===result.proof.days[index]));
  }
  assert.equal(f.objects.get(f.prefix+'market-landing-v1/japan.json').total,0);
});

test('active generation refresh uses ETag CAS and preserves a competing page',async()=>{
  const f=fixture();await stageCatalogPageWindow(f.options);f.writes.length=0;
  const conflict=f.prefix+'market-landing-v1/china.json', winner={generationId:'gen_new',winner:true};
  const write=f.options.storage.writeJson;
  f.options.storage.writeJson=async(key:string,value:any,condition:any)=>{
    if(key===conflict){assert.ok(condition.ifMatch);f.objects.set(key,winner);f.versions.set(key,99);}
    return write(key,value,condition);
  };
  await assert.rejects(stageCatalogPageWindow(f.options),StorageConflictError);
  assert.deepEqual(f.objects.get(conflict),winner);assert.equal(f.writes.length,1);
});

test('missing ETag, rejected create, changed readback and malformed builders never report readiness',async()=>{
  for(const mode of ['etag','create','readback','payload']){
    const f=fixture(), key=f.prefix+'market-landing-v1/china.json';
    if(mode==='etag'){
      f.objects.set(key,{});const read=f.options.storage.readJsonWithMeta;
      f.options.storage.readJsonWithMeta=async(...args:any[])=>({...await read(...args),etag:undefined});
    }else if(mode==='create')f.options.storage.writeJson=async()=>{throw new StorageConflictError();};
    else if(mode==='readback')f.options.storage.readJson=async()=>({unexpected:true});
    else {const build=f.options.buildLanding;f.options.buildLanding=async(...args)=>({...await build(...args),sourceTotal:99});}
    await assert.rejects(stageCatalogPageWindow(f.options),/etag_required|storage_conflict|readback_mismatch|landing_invalid/);
    assert.equal(f.writes.some(row=>row.path.includes('/overview')),false);
  }
});

test('lease/base failure and date rollover propagate before further writes without retry',async()=>{
  for(const reason of ['catalog_publish_lock_lost','catalog_publish_base_changed','midnight']){
    const f=fixture();let checks=0;
    f.options.assertContext=async()=>{
      if(++checks===3){if(reason==='midnight')f.setClock(new Date('2026-10-26T17:00:00Z'));else throw Error(reason);}
    };
    await assert.rejects(stageCatalogPageWindow(f.options),new RegExp(reason==='midnight'?'date_changed':reason));
    assert.equal(f.writes.length,1);assert.equal(checks,3);
  }
});

test('overview readiness rejects missing, blank, untrimmed, foreign or duplicate card identities',async()=>{
  for(const invalid of ['missing','blank','untrimmed','number','foreign','duplicate']){
    const f=fixture(), second={id:'second-china',market:'china'};
    f.options.rows.push(second);f.options.rowsByMarket.get('china')!.push(second);
    const build=f.options.buildOverview;
    f.options.buildOverview=async(...args)=>{
      const value=await build(...args), summary=value.markets.china;
      summary.items=summary.items.map(item=>({...item}));
      const first=summary.items[0] as any;
      if(invalid==='missing')delete first.id;
      else if(invalid==='blank')first.id='  ';
      else if(invalid==='untrimmed')first.id=' a ';
      else if(invalid==='number')first.id=42;
      else if(invalid==='foreign')first.market='korea';
      else summary.items[1].id=first.id;
      return value;
    };
    await assert.rejects(stageCatalogPageWindow(f.options),/catalog_page_window_overview_invalid/);
    assert.equal(f.writes.length,3);assert.equal(f.writes.some(row=>row.path.includes('/overview')),false);
  }
});

test('future builders reevaluate raw age evidence without source fetches or current-cache contamination',async(t)=>{
  let fetches=0;t.mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('source_fetch_forbidden');});
  const f=fixture();
  const base:any={market:'korea',make:'Kia',model:'K5',year:2020,cardProjectionVersion:3,
    cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',
    engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,
    publicVisibleRub:3000000,publicSpecificationVerified:true,totalRub:3000000,sourcePrice:30000000,sourceCurrency:'KRW'};
  const rows=[{...base,id:'expires',inventorySourceDate:'2020-10-26'},{...base,id:'retained',inventorySourceDate:'2020-10-28'}];
  const original=JSON.stringify(rows);
  const result=await stageCatalogPageWindow({...f.options,markets:['korea'],rows,rowsByMarket:new Map([['korea',rows]]),
    buildLanding:(g,m,r,now)=>buildCatalogMarketLanding(g,m,r,{now}),
    buildOverview:(g,r,now)=>buildCatalogOverviewFromProjections(g,r,{now})});
  assert.deepEqual(result.proof.days.map((date,index)=>{
    const suffix=index?'.'+date:'';return f.objects.get(`${f.prefix}overview${suffix}.json`).markets.korea.total;
  }),[2,1,1]);
  for(const date of result.proof.days.slice(1)){
    const landing=f.objects.get(`${f.prefix}market-landing-v1/korea.${date}.json`);
    assert.equal(landing.sourceTotal,2);assert.deepEqual(landing.items.map((row:any)=>row.id),['retained']);
  }
  assert.equal((await buildCatalogMarketLanding('gen_new','korea',rows,{now:f.options.now()})).total,2);
  assert.equal(JSON.stringify(rows),original);assert.equal(fetches,0);
});

test('valid empty future visibility keeps its exact zero rather than blocking today or fabricating cards',async()=>{
  const f=fixture(), build=f.options.buildLanding, overview=f.options.buildOverview;
  f.options.buildLanding=async(...args)=>({...await build(...args),total:0,items:[]});
  f.options.buildOverview=async(...args)=>{
    const value=await overview(...args);for(const summary of Object.values(value.markets)){summary.total=0;summary.items=[];}return value;
  };
  await stageCatalogPageWindow(f.options);
  assert.equal(f.objects.get(f.prefix+'overview.2026-10-27.json').markets.china.total,0);
  assert.equal(f.objects.get(f.prefix+'overview.2026-10-27.json').markets.china.sourceTotal,1);
});

test('proof fails after midnight even if its first two dates still exist',()=>{
  const proof={generationId:'gen_new',policyDate:'2026-10-26',days:['2026-10-26','2026-10-27','2026-10-28']};
  assertCatalogPageWindowCurrent(proof,new Date('2026-10-26T16:59:59Z'));
  assert.throws(()=>assertCatalogPageWindowCurrent(proof,new Date('2026-10-26T17:00:00Z')),/date_changed/);
});

test('real publisher activates only a verified window and preserves the old manifest on future failures',async(t)=>{
  const cwd=process.cwd(), driver=process.env.JSON_STORAGE_DRIVER;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'publication-window-'));
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T16:59:00Z')});
  try{
    process.chdir(root);await fs.mkdir('data');process.env.JSON_STORAGE_DRIVER='local';
    for(const mode of ['future_put','future_readback','editorial_put','editorial_readback','late_midnight','before_manifest_midnight','success']){
      t.mock.timers.setTime(new Date('2026-10-26T16:59:00Z').getTime());
      resetJsonStorageForTests();resetCatalogReadCachesForTests();
      const storage=getJsonStorage(), baseline={version:2,generationId:'gen_initial',markets:{}};
      await storage.writeJson('catalog/manifest.json',baseline);
      const write=storage.writeJson.bind(storage), read=storage.readJson.bind(storage);let manifestWrites=0, futureWrites=0;
      storage.writeJson=async(key,value,condition)=>{
        if(key==='catalog/manifest.json'){
          manifestWrites++;
          const generationId=(value as any).generationId;
          for(const [suffix,date] of [['','2026-10-26'],['.2026-10-27','2026-10-27'],['.2026-10-28','2026-10-28']]){
            const prefix=`catalog/generations/${generationId}/indexes/`;
            const overview:any=await read(`${prefix}overview${suffix}.json`,null);
            assert.equal(overview?.policyDate,date);assert.equal(overview?.dailyLandingsVersion,1);
            for(const market of ['china','japan','korea','uae','europe','georgia']){
              const landing:any=await read(`${prefix}market-landing-v1/${market}${suffix}.json`,null);
              assert.equal(landing?.policyDate,date);assert.equal(landing?.generationId,generationId);
            }
          }
        }
        if(key.endsWith('overview.2026-10-27.json')){futureWrites++;if(mode==='future_put')throw Error('future_put_failed');}
        if(mode==='editorial_put'&&key.endsWith('editorial-overview-v1.2026-10-27.json'))throw Error('editorial_put_failed');
        await write(key,value,condition);
        if(mode==='late_midnight' && key.endsWith('/publication-checkpoint.json') && (value as any).stage==='read_models_verified'){
          t.mock.timers.setTime(new Date('2026-10-26T17:00:00Z').getTime());
        }
        if(mode==='before_manifest_midnight' && key==='catalog/previous-manifest.json'){
          t.mock.timers.setTime(new Date('2026-10-26T17:00:00Z').getTime());
        }
      };
      storage.readJson=async(key,fallback)=>(mode==='future_readback' && key.endsWith('overview.2026-10-27.json'))
        ||(mode==='editorial_readback'&&key.endsWith('editorial-overview-v1.2026-10-27.json'))
        ? {unexpected:true} as any : read(key,fallback);
      if(mode==='success'){
        const result=await persistCatalogOffers([],{expectedBaseGenerationId:'gen_initial'});
        assert.equal((await read<any>('catalog/manifest.json',null)).generationId,result.generationId);
        assert.equal(manifestWrites,1);
      }else{
        await assert.rejects(persistCatalogOffers([],{expectedBaseGenerationId:'gen_initial'}),
          /future_put_failed|editorial_put_failed|readback_mismatch|date_changed/);
        assert.deepEqual(await read('catalog/manifest.json',null),baseline);assert.equal(manifestWrites,0);
      }
      assert.equal(futureWrites,mode.startsWith('editorial_')?0:1);
    }
  }finally{
    process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
    t.mock.timers.reset();resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(root,{recursive:true,force:true});
  }
});

test('versioned editorial objects are separate, conditional and cannot change raw rollback payloads',async()=>{
  const f=fixture(),base=await f.options.buildOverview('gen_new',f.options.rows,f.options.now());
  const editPath=(g:string)=>`catalog/generations/${g}/indexes/editorial-overview-v1.json`;
  const buildEditorial=async(g:string,_rows:any[],date:Date)=>({editorialSnapshotVersion:1 as const,generationId:g,
    policyDate:day(date),editorialRevision:'edit',order:'updatedAt' as const,markets:{}});
  await stageCatalogPageWindow({...f.options,buildEditorial,editorialPath:editPath});
  for(const [index,date] of ['2026-10-26','2026-10-27','2026-10-28'].entries()){
    const suffix=index?'.'+date:'',raw=f.objects.get(f.prefix+'overview'+suffix+'.json');
    assert.equal(raw.markets.china.total,base.markets.china.total);
    assert.equal('editorialRevision' in raw,false);
    const edit=f.writes.find(w=>w.path===f.prefix+'editorial-overview-v1'+suffix+'.json');
    assert.ok(edit);assert.deepEqual(edit.condition,{ifNoneMatch:'*'});
    assert.ok(f.writes.indexOf(edit!)<f.writes.findIndex(w=>w.path===f.prefix+'overview'+suffix+'.json'));
  }
  const bad=fixture();
  await assert.rejects(stageCatalogPageWindow({...bad.options,buildEditorial,editorialPath:()=> 'catalog/public/overview.json'}),/unscoped_write/);
  assert.equal(bad.writes.some(w=>w.path==='catalog/public/overview.json'),false);
});
