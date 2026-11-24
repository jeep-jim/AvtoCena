import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {buildChinaQueryIndex,openChinaQueryIndex} from '../scripts/catalog-next/query-index.mjs';
import {queryChinaWithPreparedCity} from '../apps/web/lib/catalog/china-city-query.mjs';
import {catalogSearchProjectionMatches,catalogSearchProjectionComparator} from '../apps/web/lib/catalog/storage';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {withCatalogEditorialSnapshot} from '../apps/web/lib/catalog/editorial';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter';
import {colorKey} from '../apps/web/lib/catalog/catalog-color-index';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {calculatedCatalogPrice} from '../apps/web/lib/catalog/calculated-price';
import {modificationBinding} from '../apps/web/lib/catalog/modification-contract';

const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const lower=(v:unknown)=>String(v??'').trim().toLocaleLowerCase('ru-RU');
const binding={version:1,market:'china',generationId:'gen_1795500000000_fixture',sourceCursor:100,
  sourceObservedAt:'2026-11-23T12:00:00.000Z',pricingAsOf:'2026-11-23T11:59:00.000Z',
  ...Object.fromEntries(['sourceSha256','pricingReceiptSha256','calculationVersion','encyclopediaSha256','editorialSha256','deliveryTariffSha256','filterSemanticsSha256'].map(k=>[k,sha(k)]))};
const modelQueries=['X3','X5','A4','Q3','One'];
const cities=['Новокузнецк','Кемерово'];
const power=(row:any)=>row.utilizationPowerKw>0?row.utilizationPowerKw*1.35962:
  ['electric','series_hybrid','other_hybrid'].includes(lower(row.powertrainKind))||/electric|hybrid|phev|hev|bev|электро|гибрид/.test(lower(row.fuel))?null:
    Number.isFinite(row.powerHp)&&row.powerHp>0?row.powerHp:null;
function fixtures(n=131){
  return Array.from({length:n},(_,i)=>{
    const make=['BMW','Audi','MINI'][i%3],model=make==='BMW'?(i%2?'X5 M':'X3'):make==='Audi'?(i%2?'A4 L':'Q3'):'One';
    return safePublicPricing({id:sha('fixture-'+i).slice(0,24),market:'china',make,model,year:2014+i%13,
      mileageKm:i%11===0?undefined:i%7===0?0:i*113,engineCc:i%8===0?undefined:1498+i%3*500,
      powerHp:i%7===0?undefined:i%5===0?150:180,powertrainKind:'combustion',fuel:i%4===0?'diesel':'petrol',
      color:i%2?'Белый':'Чёрный',bodyType:i%2?'suv':'sedan',transmission:i%4?'automatic':'manual',drive:i%3?'fwd':'awd',
      totalRub:i%17===0?null:1_000_000+i*15761,publicVisibleRub:i%17===0?undefined:1_000_000+i*15761,
      calculationStatus:i%17===0?'needs_data':'calculated',publicSpecificationVerified:i%17!==0,cardProjectionVersion:3,
      cardImageUrl:'https://example.invalid/test.jpg',updatedAt:new Date(Date.UTC(2026,10,22,0,0,i)).toISOString(),
      firstSeenAt:'2026-11-22T00:00:00.000Z',calculationSnapshot:{deliveryPricingBasis:{subtotalRub:1_000_000+i*15761,deliveryRub:0,percents:[]}},
      ...(i===1?{fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:100}:{}),
      ...(i===2?{fuel:'hybrid',powertrainKind:'series_hybrid',powerHp:320}:{}),
      ...(i===3?{powerHp:160.005}:{}),
    } as any);
  }).sort(catalogSearchProjectionComparator('updatedAt'));
}
function compiled(params:any){
  const {make,model,color,fuel,bodyType,transmission,drive,city,...rest}=params;
  return {...rest,...(make?{makeKeys:make.split('|').map(lower)}:{}),
    ...(model?{modelTerms:model.split('|').map((m:string)=>'model:'+lower(m))}:{}),
    ...(color?{colorKeys:color.split('|').map(colorKey)}:{}),
    ...(fuel?{fuelKeys:fuel.split('|').flatMap((x:string)=>x==='electrified'?['electric','hybrid']:[lower(x)])}:{}),
    ...(bodyType?{bodyTypeKeys:bodyType.split('|').map(lower)}:{}),
    ...(transmission?{transmissionKeys:transmission.split('|').map(lower)}:{}),
    ...(drive?{driveKeys:drive.split('|').map(lower)}:{}),...(city?{cityKey:city}:{})};
}
async function setup(t:any,rows=fixtures()){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'china-query-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'china-query.sqlite');
  const records=rows.map((projection:any,canonicalOrdinal:number)=>({projection,canonicalOrdinal,
    keys:{make:lower(projection.make),color:colorKey(projection.color),fuel:lower(projection.fuel),bodyType:lower(projection.bodyType),
      transmission:lower(projection.transmission),drive:lower(projection.drive),auctionGrade:'',filterPowerHp:power(projection),
      modelTerms:modelQueries.filter(query=>matchesCatalogModel(projection.model,query,projection.make)).map(query=>'model:'+lower(query))},
    frozenPrice:{totalRub:projection.totalRub,ledgerSha256:projection.totalRub===null?null:sha('synthetic-ledger-'+projection.id)},
    detailLocator:{chunk:'fixture',offset:canonicalOrdinal},
    cityPrices:Object.fromEntries(cities.map(city=>{
      const rub=priceCardForCity(projection,city).offer.totalRub;
      return [city,{totalRub:rub,ledgerSha256:rub===null?null:sha('synthetic-city-ledger-'+projection.id+city)}];
    }))}));
  const manifest=await buildChinaQueryIndex({filename,binding,expectedRows:rows.length,rows:records,cityKeys:cities});
  let accepted=true;
  const reader=await openChinaQueryIndex({filename,manifest,assertAuthority:()=>assert(accepted,'fixture_cut_changed')});
  t.after(()=>reader.close());
  return {filename,manifest,records,rows,reader,invalidate:()=>{accepted=false;}};
}
const scoped=(run:()=>Promise<void>)=>withCatalogEditorialSnapshot({revision:'query-fixture',entries:{}},run);

test('SQL membership, complete counts and page order equal installed runtime filter oracle',async t=>scoped(async()=>{
  const f=await setup(t);
  const queries=[{}, {powerTo:160}, {make:'BMW',model:'X3|X5',powerTo:160},
    {yearFrom:2018,yearTo:2023,mileageTo:10000,sort:'mileage'},
    {color:'белый',fuel:'petrol|diesel',bodyType:'suv',transmission:'automatic',drive:'fwd'},
    {engineFrom:1400,engineTo:2100,hasPrice:'yes',budgetTo:2_100_000,sort:'totalRub,year'},
    {hasPrice:'no'}, {model:'A4',yearFrom:2014,sort:'yearAsc,mileageDesc'},
    {fuel:'electrified',powerTo:160}, {city:'Новокузнецк',budgetFrom:1_000_000,budgetTo:2_500_000,sort:'totalRubDesc'},
    {city:'Кемерово',powerTo:160,sort:'totalRub'}, {mileageTo:1}, {powerFrom:160,powerTo:160}];
  for(const query of queries){
    const expected=f.rows.filter(row=>catalogSearchProjectionMatches(row as any,query)).sort(catalogSearchProjectionComparator(query.sort,query.city));
    const count=f.reader.query({...compiled(query),countOnly:true});
    assert.equal(count.total,expected.length,JSON.stringify(query));assert.deepEqual(count.items,[]);
    for(const page of [1,2,Math.ceil(expected.length/24)+1]){
      const actual=f.reader.query({...compiled(query),page});
      assert.equal(actual.total,expected.length);
      assert.deepEqual(actual.items.map((x:any)=>x.id),expected.slice((page-1)*24,page*24).map(x=>x.id),JSON.stringify({query,page}));
      for(const item of actual.items)assert.equal(item.queryRub,query.city?priceCardForCity(item.projection,query.city).offer.totalRub:item.projection.totalRub);
    }
  }
}));

test('unknown certified hybrid power is excluded, attested EV calculation power is included',async t=>scoped(async()=>{
  const f=await setup(t);
  const ids=f.reader.query({powerTo:160,pageSize:48}).items.map((item:any)=>item.id);
  assert(ids.includes(sha('fixture-1').slice(0,24)));
  assert(!ids.includes(sha('fixture-2').slice(0,24)));
  assert.equal(f.reader.query({powerFrom:160,powerTo:160}).items[0].id,sha('fixture-3').slice(0,24));
}));

test('price sorting preserves seller-price fallback before later terms when delivered totals are absent',async t=>scoped(async()=>{
  const rows=fixtures(12).map((row:any,i:number)=>({...row,totalRub:i<3?row.totalRub:null,
    publicVisibleRub:i<3?row.publicVisibleRub:undefined,
    ...(i<3?{}:{catalogPricingMode:'seller',calculationStatus:'needs_data'}),
    sellerPriceRub:[undefined,undefined,undefined,900_000,100_000,500_000,100_000,undefined,0,-1,300_000,300_000][i]}))
    .sort(catalogSearchProjectionComparator('updatedAt'));
  const f=await setup(t,rows);
  for(const sort of ['totalRub','totalRubDesc','totalRub,year','totalRubDesc,mileageDesc','year,totalRub']){
    const expected=[...rows].sort(catalogSearchProjectionComparator(sort));
    const actual=f.reader.query({sort,pageSize:48});
    assert.deepEqual(actual.items.map((item:any)=>item.id),expected.map(row=>row.id),sort);
    for(const city of cities){
      const delivered=[...rows].sort(catalogSearchProjectionComparator(sort,city));
      assert.deepEqual(f.reader.query({sort,cityKey:city,pageSize:48}).items.map((item:any)=>item.id),delivered.map(row=>row.id),city+':'+sort);
    }
  }
}));

test('positive displayed seller or unresolved-modification amounts never become budget-eligible quotes',async t=>scoped(async()=>{
  const rows=fixtures(7);
  const seller={...rows[1],catalogPricingMode:'seller',sellerPriceRub:400_000,totalRub:1_500_000};
  const unresolved:any={...rows[2],totalRub:1_100_000,sourcePrice:80_000,sourceCurrency:'CNY',sellerPriceRub:300_000,
    recoveryQualification:{status:'selection_required'}};
  unresolved.modificationSelection={version:1,status:'selection_required',binding:modificationBinding(unresolved),
    options:[{id:'synthetic-option',label:'Synthetic test option',market:'china',fuel:'petrol',powertrainKind:'combustion',
      engineCc:1498,powerHp:150,powerKw:110.3248125,evidenceIds:['synthetic-test-evidence']}]};
  rows[1]=seller;rows[2]=unresolved;rows.sort(catalogSearchProjectionComparator('updatedAt'));
  assert.equal(calculatedCatalogPrice(seller),0);assert.equal(calculatedCatalogPrice(unresolved),0);
  const f=await setup(t,rows);
  for(const query of [{hasPrice:'yes'},{hasPrice:'no'},{budgetTo:2_000_000},{sort:'totalRub,year'},
    {sort:'totalRubDesc,mileageDesc'},{city:'Кемерово',hasPrice:'yes',budgetTo:2_000_000},{city:'Кемерово',sort:'totalRub'}]){
    const expected=rows.filter(row=>catalogSearchProjectionMatches(row as any,query)).sort(catalogSearchProjectionComparator(query.sort,query.city));
    const actual=f.reader.query({...compiled(query),pageSize:48});
    assert.equal(actual.total,expected.length,JSON.stringify(query));
    assert.deepEqual(actual.items.map((item:any)=>item.id),expected.map(row=>row.id),JSON.stringify(query));
    assert.equal(f.reader.query({...compiled(query),countOnly:true}).total,expected.length);
  }
  const unknown=f.reader.query({hasPrice:'no',pageSize:48});
  for(const id of [seller.id,unresolved.id]){
    const item=unknown.items.find((item:any)=>item.id===id);
    assert(item);assert.equal(item.queryRub,null);assert(item.projection.totalRub>0);
  }
}));

test('deep pagination has no legacy 8192-record cap',async t=>scoped(async()=>{
  const f=await setup(t,fixtures(8401));
  const actual=f.reader.query({page:350,pageSize:24});
  assert.equal(actual.total,8401);assert.deepEqual(actual.items.map((item:any)=>item.id),f.rows.slice(8376,8400).map(row=>row.id));
  assert.equal(f.reader.query({page:351,pageSize:24}).items.length,1);
}));

test('range counts and sorted selection never open large card payloads; only selected IDs are hydrated',async t=>scoped(async()=>{
  const rows=fixtures(512).map(row=>({...row,calculationSnapshot:{...row.calculationSnapshot,fixtureIndexPayload:'x'.repeat(16384)}}));
  (rows[0] as any).year=undefined;(rows[1] as any).year=0;
  const f=await setup(t,rows);
  const inspect=new DatabaseSync(f.filename,{readOnly:true});
  let payloadRoots:Set<number>;
  try{
    const columns=inspect.prepare('PRAGMA table_info(cards)').all().map(row=>row.name);
    assert(!columns.some(name=>String(name).includes('json')),'filter table must not contain card JSON');
    payloadRoots=new Set(inspect.prepare("SELECT rootpage FROM sqlite_schema WHERE tbl_name='card_payloads'").all()
      .map(row=>Number(row.rootpage)).filter(root=>root>0));
    assert(payloadRoots.size>0);
  }finally{inspect.close();}
  const opensPayload=(statement:any)=>statement.bytecode.some((op:any)=>op.opcode==='OpenRead'&&payloadRoots.has(op.p2));
  const range=f.reader.explainQuery({yearFrom:2020,countOnly:true});
  assert(range.count.plan.some((step:any)=>/SEARCH c USING COVERING INDEX cards_year \(year>/.test(step.detail)),
    JSON.stringify(range.count.plan));
  assert(!opensPayload(range.count));assert.equal(range.selection,null);assert.equal(range.hydration,null);
  const query={powerTo:160,sort:'mileage',page:2,pageSize:24};
  const plan=f.reader.explainQuery(query);
  assert(!opensPayload(plan.count));assert(!opensPayload(plan.selection));
  assert.doesNotMatch(plan.selection.sql,/projection_json|locator_json|card_payloads/);
  assert(plan.selection.plan.some((step:any)=>step.detail.includes('TEMP B-TREE FOR ORDER BY')),
    'fixture deliberately exercises a sort rather than only an already ordered index');
  assert(opensPayload(plan.hydration));
  assert(plan.hydration.plan.some((step:any)=>/SEARCH card_payloads USING PRIMARY KEY \(id=/.test(step.detail)),
    JSON.stringify(plan.hydration.plan));
  const expected=rows.filter(row=>catalogSearchProjectionMatches(row as any,query)).sort(catalogSearchProjectionComparator(query.sort));
  const actual=f.reader.query(query);
  assert.equal(actual.total,expected.length);assert.equal(actual.items.length,24);
  assert.deepEqual(actual.items.map((item:any)=>item.id),expected.slice(24,48).map(row=>row.id));
  assert(actual.items.every((item:any)=>item.projection.calculationSnapshot.fixtureIndexPayload.length===16384));
  for(const bounds of [{yearTo:2014},{yearFrom:2014},{yearFrom:2018,yearTo:2021}]){
    const wanted=rows.filter(row=>catalogSearchProjectionMatches(row as any,bounds));
    assert.equal(f.reader.query({...bounds,countOnly:true}).total,wanted.length,JSON.stringify(bounds));
  }
}));

test('query is local, unknown fields/sort/city fail and pinned cut change invalidates reads',async t=>scoped(async()=>{
  const f=await setup(t),previousFetch=globalThis.fetch;
  globalThis.fetch=(async()=>{throw Error('network forbidden');}) as typeof fetch;
  try{
    assert(f.reader.query({powerTo:160}).total>0);
    assert.throws(()=>f.reader.query({cityKey:'not-prepared'}),/china_query_city_not_prepared/);
    assert.throws(()=>f.reader.query({sort:'totalRub;DROP TABLE cards'}),/china_query_sort/);
    assert.throws(()=>f.reader.query({unknown:true}),/china_query_unsupported_filter/);
    assert.equal(f.reader.query({makeKeys:["' OR 1=1 --"]}).total,0);
    f.invalidate();assert.throws(()=>f.reader.query({}),/fixture_cut_changed/);
  }finally{globalThis.fetch=previousFetch;}
}));

test('delivery-only city pagination selects IDs without a whole-city scan and preserves exact frozen amounts',async t=>scoped(async()=>{
  const f=await setup(t,fixtures(512));
  const queries:any[]=[],points:any[]=[];
  const tracked={manifest:f.reader.manifest,
    query(params:any){queries.push(params);return f.reader.query(params);},
    cityPrices(id:string){points.push(id);return f.reader.cityPrices(id);},
    get(){assert.fail('selected projections must not be hydrated twice');}};
  for(const city of cities)for(const query of [{},{powerTo:160},{yearFrom:2018,sort:'yearAsc,mileageDesc'}]){
    const input={...compiled(query),cityKey:city,page:2},expected=f.reader.query(input);
    queries.length=0;points.length=0;
    const savedPrices=new Map(),actual=queryChinaWithPreparedCity(tracked,input,savedPrices);
    assert.deepEqual(actual,expected,JSON.stringify(input));
    assert.equal(queries.length,1);assert.equal(queries[0].cityKey,undefined);
    assert.deepEqual(points,actual.items.map((item:any)=>item.id));
    for(const item of actual.items)assert.deepEqual(savedPrices.get(item.id),f.reader.cityPrices(item.id));
    const plan=f.reader.explainQuery(queries[0]);
    assert.doesNotMatch(plan.count.sql,/city_prices/);assert.doesNotMatch(plan.selection.sql,/city_prices/);
    if(!Object.keys(query).length)assert(!plan.selection.plan.some((step:any)=>/TEMP B-TREE/.test(step.detail)),JSON.stringify(plan.selection.plan));
    for(const item of actual.items)assert.equal(item.queryRub,calculatedCatalogPrice(priceCardForCity(item.projection,city).offer)||null);
  }
  for(const city of cities)for(const sort of [undefined,'year','totalRub','totalRubDesc,mileage']){
    queries.length=0;points.length=0;
    const input={cityKey:city,sort,countOnly:true};
    assert.deepEqual(queryChinaWithPreparedCity(tracked,input),f.reader.query(input));
    assert.equal(queries[0].cityKey,undefined);assert.deepEqual(points,[]);
  }
  for(const input of [{},{cityKey:cities[0],budgetFrom:1_000_000,budgetTo:2_000_000},
    {cityKey:cities[0],hasPrice:'no'},{cityKey:cities[1],hasPrice:'yes',countOnly:true},
    {cityKey:cities[0],sort:'totalRub'},{cityKey:cities[1],sort:'year,totalRubDesc'}]){
    queries.length=0;points.length=0;
    assert.deepEqual(queryChinaWithPreparedCity(tracked,input),f.reader.query(input));
    assert.deepEqual(queries,[input]);assert.deepEqual(points,[]);
  }
  assert.throws(()=>queryChinaWithPreparedCity(tracked,{cityKey:'not-prepared'}),/china_query_city_not_prepared/);
  assert.throws(()=>queryChinaWithPreparedCity(tracked,{cityKey:cities[0],unknown:true}),/china_query_unsupported_filter/);
  assert.throws(()=>queryChinaWithPreparedCity(tracked,{cityKey:cities[0],sort:'invalid'}),/china_query_sort/);
  f.invalidate();
  assert.throws(()=>queryChinaWithPreparedCity(tracked,{cityKey:cities[0]}),/fixture_cut_changed/);
}));

test('wrong bound generation, changed file and mismatched frozen price cannot be accepted',async t=>scoped(async()=>{
  const f=await setup(t);
  const wrong={...f.manifest,binding:{...f.manifest.binding,generationId:'gen_other'}};
  await assert.rejects(openChinaQueryIndex({filename:f.filename,manifest:wrong}),/china_query_metadata/);
  const filename=path.join(path.dirname(f.filename),'wrong-price.sqlite');
  const rows=structuredClone(f.records);rows[0].frozenPrice.totalRub=123;
  await assert.rejects(buildChinaQueryIndex({filename,binding,rows,expectedRows:rows.length,cityKeys:cities}),/china_query_projection_price_disagrees/);
  await fs.chmod(f.filename,0o600);await fs.appendFile(f.filename,'changed');
  assert.throws(()=>f.reader.query({}),/china_query_open_file_changed/);
  await assert.rejects(openChinaQueryIndex({filename:f.filename,manifest:f.manifest}),/china_query_file_checksum/);
}));
