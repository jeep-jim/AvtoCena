import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {ajesPowerFilterView,missingAjesFilterPower} from '../apps/web/lib/catalog/ajes-filter-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';

const require = createRequire(import.meta.url);
const filter = ajesResultFilter({market:'korea',powerTo:'160'});
const source = (id = 'known', overrides: Record<string, any> = {}) => ({
  id:`ajes-korea-${id}`, sourceId:'ajes_korea_feed', sourceOfferId:id, market:'korea',
  make:'Kia', model:'Sportage', trim:'Diesel 1.6 2WD Prestige', year:2021,
  fuel:'diesel', powertrainKind:'combustion', engineCc:1598, sourcePrice:12900000, sourceCurrency:'KRW',
  updatedAt:'2026-11-09T23:58:13.194Z', calculationSnapshot:{currencyRate:{rateDate:'2026-11-10'}},
  operational:{raw:{sourcePower:'136,186'}}, ...overrides,
});
const preview = (offer:any, hp:number, managementLearned=false) => ({
  version:managementLearned ? `management:${'a'.repeat(64)}` : 'a96e0dcb-f4b5-4c90-afaf-ddd38975002a',
  ...(managementLearned?{managementLearned:true}:{}), totalRub:1710931, deliveryCity:'',
  parameters:{year:offer.year,fuel:offer.fuel,engineCc:offer.engineCc,powertrainKind:'combustion',powerHp:hp,powerKw:hp*0.73549875,deliveryCity:''},
  currencyRate:{sourcePrice:offer.sourcePrice,currency:offer.sourceCurrency,rateDate:'2026-11-10'},
});

test('same-listing staff 136 hp and learned 123 hp qualify without changing missing source power',()=>{
  for(const [hp,learned] of [[136,false],[123,true],[160,false]] as const){
    const raw=source(), priced={...raw,savedCalculationPreview:preview(raw,hp,learned)};
    assert.equal(filter.matches(raw),false);
    assert.equal(filter.matches(priced),false,'an arbitrary scenario is not source evidence');
    const view=ajesPowerFilterView(priced,raw);
    assert.equal(filter.matches(view),true);
    assert.equal(view.powerHp,hp);
    assert.equal(raw.powerHp,undefined);assert.equal(priced.powerHp,undefined);
  }
  const raw=source(), high={...raw,savedCalculationPreview:preview(raw,186)};
  assert.equal(filter.matches(ajesPowerFilterView(high,raw)),false);
  assert.equal(filter.matches(ajesPowerFilterView(raw,raw)),false,'supplier PW never supplies power');
});

test('known conflicting source power, other markets and uncertified electrified scenarios keep existing rules',()=>{
  const known=source('known',{powerHp:180});
  assert.equal(ajesPowerFilterView({...known,savedCalculationPreview:preview(known,136)},known).powerHp,180);
  for(const known of [source('kw',{powerKw:150}),source('drive',{drive:'awd'})]){
    const saved=preview(known,136);Object.assign(saved.parameters,{drive:'fwd'});
    assert.equal(filter.matches(ajesPowerFilterView({...known,savedCalculationPreview:saved},known)),false);
  }
  assert.equal(missingAjesFilterPower({powerHp:'136,186'}),false);
  const raw=source();
  for(const overrides of [{market:'japan'}, {fuel:'hybrid',powertrainKind:'other_hybrid'}, {fuel:'electric',powertrainKind:'electric'}]){
    const other={...raw,...overrides};
    assert.equal(filter.matches(ajesPowerFilterView({...other,savedCalculationPreview:preview(other,136)},other)),false);
  }
  const estimated={...raw,savedCalculationPreview:{...preview(raw,136),power30Precedent:{kw:30,certified:false}}};
  assert.equal(filter.matches(ajesPowerFilterView(estimated,raw)),false);
});

test('unrefreshed, stale-context, wrong-listing and alternative-identity previews cannot qualify',()=>{
  const raw=source(), valid=preview(raw,136);
  const staleInput={...raw,savedCalculationPreview:valid};
  assert.equal(filter.matches(ajesPowerFilterView({...staleInput},staleInput)),false);
  for(const changes of [
    {id:'ajes-korea-other'}, {sourceOfferId:'other'}, {sourceId:'old_parser'},
    {updatedAt:'2026-10-01T00:00:00Z'}, {sourcePrice:1}, {year:2022}, {engineCc:1998},
  ]){
    const priced={...raw,...changes,savedCalculationPreview:valid};
    assert.equal(filter.matches(ajesPowerFilterView(priced,raw)),false,JSON.stringify(changes));
  }
  for(const changed of [
    {...valid,version:'old'}, {...valid,totalRub:0}, {...valid,deliveryCity:'Москва'},
    {...valid,managementLearned:true},
    {...valid,currencyRate:{...valid.currencyRate,sourcePrice:1}},
    {...valid,currencyRate:{...valid.currencyRate,currency:'JPY'}},
    {...valid,currencyRate:{...valid.currencyRate,rateDate:'2026-10-01'}},
    ...[{year:2020},{fuel:'petrol'},{engineCc:1998},{powertrainKind:'other_hybrid'},{powerHp:NaN},{powerKw:186}].map(change=>({...valid,parameters:{...valid.parameters,...change}})),
  ])assert.equal(filter.matches(ajesPowerFilterView({...raw,savedCalculationPreview:changed},raw)),false);
});

test('actual AJES catalog attaches current card previews before power filtering and retains bounded continuation',async()=>{
  const clock=Date.now;let now=Date.now();Date.now=()=>now;
  const rows=[source('manual136'),source('learned123'),source('over186'),source('unknown'),source('factory200',{powerHp:200})];
  const state={reads:[] as number[],priced:[] as string[],rows};
  (globalThis as any).__ajesPowerFilter=state;
  const stubs:Record<string,string>={
    'server-only':'',
    'next/headers':`export const headers=async()=>({get:()=>''});`,
    'react':`export const cache=f=>f;`,
    './market-page':`export const sortCatalogRows=rows=>rows;`,
    './japan-preview-parameters':`export const japanPreviewParameters=()=>({});`,
    './ajes-make-resolution':`export const resolveAjesMakeNames=make=>make;`,
    './ajes-model-resolution':`export const resolveAjesQueryModels=async query=>({query,modelDirectoryUnavailable:false});`,
    '../encyclopedia/calculation-evidence':`export const hasEncyclopediaCalculationEvidence=()=>false;`,
    './collection-controls':`export const assertCollectionEnabled=async()=>{};`,
    './ajes-runtime':`export const ajesClient={};`,
    './ajes-client':`export class AjesUnavailable extends Error {constructor(reason){super(reason);this.reason=reason;}};export const readAjesModelDirectory=async()=>({});export const readAjesMakeDirectory=async()=>({});`,
    './ajes-price-policy':`export const ajesChinaPriceAllowed=()=>true;`,
    './storage':`export const publicOffer=offer=>offer;`,
    './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{globalThis.__ajesPowerFilter.reads.push(q.page);return {items:globalThis.__ajesPowerFilter.rows,received:24,pageSize:24,observedAt:'2026-11-09T23:58:13.194Z',stale:true};};`,
    './live-business-pricing':`export const applyActiveBusinessPricingBatch=async rows=>{globalThis.__ajesPowerFilter.priced.push(...rows.map(r=>r.id));return globalThis.__ajesPowerFilter.attach(rows);};`,
  };
  (state as any).attach=(input:any[])=>{
    now+=9000; // The first source page used its budget; do not scan another one.
    return input.map(row=>{
      const hp=row.sourceOfferId==='manual136'?136:row.sourceOfferId==='learned123'?123:row.sourceOfferId==='over186'?186:null;
      return hp?{...row,savedCalculationPreview:preview(row,hp,row.sourceOfferId==='learned123')}:row;
    });
  };
  try{
    const result=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'catalog-power-boundaries',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
    const mod={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
    const page=await mod.exports.readAjesCatalogPage({market:'korea',powerTo:'160'});
    assert.deepEqual(page.items.map((row:any)=>row.id),['ajes-korea-manual136','ajes-korea-learned123']);
    assert.deepEqual(state.reads,[1]);
    assert.deepEqual(state.priced,['ajes-korea-manual136','ajes-korea-learned123','ajes-korea-over186','ajes-korea-unknown']);
    assert.equal(page.total,null,'a partial filtered page is not a full inventory count');
    assert.equal(page.hasMore,true);assert.equal(page.nextCursor,'2.0');assert.equal(page.scanLimited,true);
    assert.ok(page.items.every((row:any)=>row.powerHp===undefined),'source facts remain unchanged');
  }finally{Date.now=clock;delete (globalThis as any).__ajesPowerFilter;}
});
