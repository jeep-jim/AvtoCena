import assert from 'node:assert/strict';
import test from 'node:test';
import {stageGenerationPageWindow} from '../apps/web/lib/catalog/generation-page-window';

const day=(date:Date)=>new Date(date.getTime()+7*3600000).toISOString().slice(0,10);
type Row={id:string;market:string;lastDay:string};
function fixture(){
  let time=new Date('2026-11-11T16:59:00Z');
  const generationId='new_generation',markets=['china','korea','japan'];
  const rowsByMarket=new Map<string,Row[]>([
    ['china',[{id:'cn-1',market:'china',lastDay:'2026-11-12'},{id:'cn-2',market:'china',lastDay:'2026-12-31'}]],
    ['korea',[{id:'kr-1',market:'korea',lastDay:'2026-12-31'}]],['japan',[]],
  ]);
  const objects=new Map<string,any>([['catalog/manifest.json',{generationId:'old_generation'}],
    ['catalog/public/overview.json',{generationId:'old_generation'}]]);
  const writes:string[]=[],preparedDates:string[]=[];
  const prepareRows=(rows:Row[],date:Date)=>rows.filter(row=>row.lastDay>=day(date));
  const options={generationId,markets,rowsByMarket,landingLimit:192,overviewLimit:24,now:()=>new Date(time),prepareRows,
    landingPath:(g:string,m:string)=>`catalog/generations/${g}/indexes/market-landing-v1/${m}.json`,
    overviewPath:(g:string)=>`catalog/generations/${g}/indexes/overview.json`,
    buildLanding:async(g:string,m:string,rows:Row[],date:Date)=>{
      const items=prepareRows(rows,date);
      return {generationId:g,market:m,sourceTotal:rows.length,policyDate:day(date),total:items.length,items,facets:{generationId:g}};
    },
    buildOverview:async(g:string,rows:Row[],date:Date)=>{
      preparedDates.push(day(date));
      return {generationId:g,policyDate:day(date),facets:{generationId:g},markets:Object.fromEntries(markets.map(m=>{
        const items=rows.filter(row=>row.market===m);return [m,{sourceTotal:items.length,total:items.length,items}];
      }))};
    },
    write:async(path:string,value:unknown)=>{writes.push(path);objects.set(path,structuredClone(value));},
  };
  return {options,objects,writes,preparedDates,setTime:(date:string)=>{time=new Date(date);}};
}

test('new generation has three complete policy days before any public pointer can change',async()=>{
  const f=fixture(),original=structuredClone(f.options.rowsByMarket);
  const result=await stageGenerationPageWindow(f.options);
  assert.deepEqual(result.policyDates,['2026-11-11','2026-11-12','2026-11-13']);
  assert.equal(f.writes.length,12);
  assert.ok(f.writes.every(path=>path.startsWith('catalog/generations/new_generation/indexes/')));
  assert.equal(f.objects.get('catalog/manifest.json').generationId,'old_generation');
  assert.equal(f.objects.get('catalog/public/overview.json').generationId,'old_generation');
  assert.deepEqual(f.options.rowsByMarket,original);
  const tomorrow=f.objects.get('catalog/generations/new_generation/indexes/overview.2026-11-12.json');
  const later=f.objects.get('catalog/generations/new_generation/indexes/overview.2026-11-13.json');
  assert.equal(tomorrow.markets.china.total,2);
  assert.equal(later.markets.china.total,1,'future age policy changes visible count');
  assert.equal(later.markets.china.sourceTotal,2,'source completeness does not become visible count');
  assert.equal(later.markets.japan.sourceTotal,0);
  assert.equal(later.dailyLandingsVersion,1);
  for(const d of result.policyDates){
    const suffix=d==='2026-11-11'?'':'.'+d;
    const overview=f.writes.indexOf(`catalog/generations/new_generation/indexes/overview${suffix}.json`);
    for(const market of f.options.markets)assert.ok(f.writes.indexOf(`catalog/generations/new_generation/indexes/market-landing-v1/${market}${suffix}.json`)<overview);
  }
});

test('one midnight during preparation uses already staged exact next-day objects',async()=>{
  const f=fixture(),build=f.options.buildOverview;
  f.options.buildOverview=async(...args)=>{const result=await build(...args);f.setTime('2026-11-11T17:01:00Z');return result;};
  const result=await stageGenerationPageWindow(f.options);
  assert.ok(result.policyDates.includes(day(f.options.now())));
  assert.equal(f.objects.get('catalog/generations/new_generation/indexes/overview.2026-11-12.json').policyDate,'2026-11-12');
});

test('storage failure never yields a publishable result or touches old pointers',async()=>{
  const f=fixture(),write=f.options.write;
  f.options.write=async(path,value)=>{if(path.includes('2026-11-12'))throw Error('storage_unavailable');await write(path,value);};
  await assert.rejects(stageGenerationPageWindow(f.options),/storage_unavailable/);
  assert.equal(f.objects.get('catalog/manifest.json').generationId,'old_generation');
  assert.equal(f.objects.get('catalog/public/overview.json').generationId,'old_generation');
  assert.ok(!f.preparedDates.includes('2026-11-13'));
});

test('wrong generation, date, source count or market cannot be staged as a valid landing',async()=>{
  for(const replacement of [{generationId:'old_generation'},{policyDate:'2026-11-10'},{sourceTotal:0},{market:'europe'},{total:999},{items:[]},{facets:{generationId:'old_generation'}}]){
    const f=fixture(),build=f.options.buildLanding;
    f.options.buildLanding=async(...args)=>({...await build(...args),...replacement});
    await assert.rejects(stageGenerationPageWindow(f.options),/landing_invalid/);
    assert.equal(f.writes.length,0);
  }
});

test('partial overview and wrong-day overview never get the ready marker',async()=>{
  for(const kind of ['missingMarket','wrongDay','wrongGeneration','impossibleTotal','shortSample']){
    const f=fixture(),build=f.options.buildOverview;
    f.options.buildOverview=async(...args)=>{
      const value=await build(...args);
      if(kind==='missingMarket')delete value.markets.korea;
      if(kind==='wrongDay')value.policyDate='2026-11-10';
      if(kind==='wrongGeneration')value.generationId='old_generation';
      if(kind==='impossibleTotal')value.markets.china.total=500;
      if(kind==='shortSample')value.markets.china.items=[];
      return value;
    };
    await assert.rejects(stageGenerationPageWindow(f.options),/overview_(invalid|incomplete)/);
    assert.ok(f.writes.every(path=>!path.includes('/overview')));
  }
});

test('foreign paths, foreign rows and expired policy window cannot reach publication',async()=>{
  for(const kind of ['path','row','generation','expired']){
    const f=fixture();
    if(kind==='path')f.options.landingPath=()=>`catalog/public/market.json`;
    if(kind==='row')f.options.rowsByMarket.get('china')![0].market='europe';
    if(kind==='generation')f.options.generationId='../old';
    if(kind==='expired'){
      const build=f.options.buildLanding;
      f.options.buildLanding=async(...args)=>{const value=await build(...args);f.setTime('2026-11-15T00:00:00Z');return value;};
    }
    await assert.rejects(stageGenerationPageWindow(f.options),/catalog_generation_pages_/);
    assert.equal(f.writes.length,0);
  }
});
