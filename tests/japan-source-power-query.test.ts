import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {japanSourcePowerPredicate} from '../apps/web/lib/catalog/japan-source-power-query';
import {japanMakeSqlExclusion,japanVehicleTypeExcluded,japanVehicleFamilySqlExclusion,japanVehicleFamilyCacheSqlExclusion,japanHeavyVehicleSqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {motorcycleExcluded,motorcycleSqlExclusion} from '../apps/web/lib/catalog/motorcycle-policy';
import {parseCatalogSort} from '../apps/web/lib/catalog/catalog-sort';
import type {CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';

const source=(name:string)=>readFileSync(new URL('../apps/web/lib/catalog/'+name,import.meta.url),'utf8');
const stripped=(text:string)=>stripTypeScriptTypes(text,{mode:'transform'}).replace(/^import[^\n]+;\s*$/gm,'').replace(/^export /gm,'');
// Compile the actual query and result-filter functions. Unrelated catalogue
// conditional filters are unused in this isolated fixture. The real baseline
// exclusions, parsing, WHERE/URI budget, COUNT/LIST/order and power matcher run.
const queryBindings={japanSourcePowerPredicate,JAPAN_MIN_MODEL_YEAR:2008,
 pickupSourceCandidateSql:()=>'(1=1)',japanDriveSql:()=>'(1=1)',auctionSaleRange:()=>null,
 japanMakeSqlExclusion,japanVehicleFamilySqlExclusion,japanVehicleFamilyCacheSqlExclusion,
 japanHeavyVehicleSqlExclusion,heavyVehicleSqlExclusion,motorcycleSqlExclusion,
 japanVehicleTypeExcluded,knownHeavyVehicleFamily,motorcycleExcluded,
 assertAjesJapanMarket:(market:unknown)=>{if(market!==undefined&&market!=='japan')throw Error('unexpected market');},
 vehicleColorAliases:(value:string)=>[value],auctionGradeLabel:(value:string)=>value,parseEngineCc:Number,
 parseCatalogSort};
const {ajesQuery,ajesCatalogQuery,AjesInputError}=new Function(...Object.keys(queryBindings),stripped(source('ajes-query.ts'))+'\nreturn {ajesQuery,ajesCatalogQuery,AjesInputError};')(...Object.values(queryBindings));
const power=new Function('isOwnerStepwgnNonHybrid','namedElectrifiedPowertrainKind',stripped(source('japan-source-power.ts'))+'\nreturn {parseJapanSourcePower,japanSupplierPower,japanUnknownPower};')(()=>false,()=>undefined);
const filterBindings={isOwnerStepwgnNonHybrid:()=>false,...power,AjesInputError,matchesCatalogColor:()=>true,
 filterSelections:(value:string)=>value?value.split('|'):[],matchesFilterSelection:()=>true,priceCardForCity:()=>null,catalogBodyType:()=>'',hasModificationSelection:()=>false};
const ajesResultFilter=new Function(...Object.keys(filterBindings),stripped(source('ajes-result-filter.ts'))+'\nreturn ajesResultFilter;')(...Object.values(filterBindings));

type Row={id:string;pw:unknown;model?:string;make?:string;year?:number;finish?:number;localHp?:number};
function fixture(t:any,rows:Row[]){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?0:Number(new RegExp(String(pattern),'i').test(String(value))));
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,auction_date text,pw text)');
 const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?)');
 for(const row of rows)insert.run(row.id,row.year??2023,2,'Sold',row.finish??100000,row.make??'TOYOTA',row.model??'TEST','2026-11-28',row.pw==null?null:String(row.pw));
 return {db,select:(query:Record<string,unknown>,index:CalculationIndex|null=null)=>db.prepare(ajesQuery({table:'stats',...query},index).sql).all(),
  ids:(query:Record<string,unknown>,index:CalculationIndex|null=null)=>db.prepare(ajesQuery({table:'stats',...query},index).sql).all().map((row:any)=>row.id)};
}
const index=(keys:string[]):CalculationIndex=>({version:1,digest:'fixture',manifestDigest:'fixture',createdAt:'2026-11-28',models:Object.fromEntries(keys.map(key=>[key,[{modelId:key,variantId:'v',revision:'r',year:2023,trims:[],constraints:{},values:{powerHp:150},sources:{}}]]))});
const offered=(row:Row)=>({id:'ajes-stats-'+row.id,sourceId:'ajes_japan_feed',market:'japan',make:row.make??'TOYOTA',model:row.model??'TEST',
 ...(row.localHp?{powerHp:row.localHp}:{}),operational:{raw:{sourcePower:row.pw}}});

test('global source PW bounds retain unknown scalars and change COUNT before page LIMIT',t=>{
 const rows:Row[]=[{id:'lower',pw:'100'},{id:'upper',pw:'160'},{id:'small',pw:'99'},{id:'large',pw:'200'},
  ...[null,'','0','150,200','bad','9007199254740992','9'.repeat(31)].map((pw,n)=>({id:'unknown-'+n,pw})),
  {id:'trimmed',pw:' 150 '},{id:'zeros',pw:'000150'}];
 const f=fixture(t,rows),query={powerFrom:100,powerTo:160,pageSize:2};
 const full=f.ids({...query,pageSize:48});
 assert.deepEqual([...full].sort(),rows.filter(row=>!['small','large'].includes(row.id)).map(row=>row.id).sort());
 assert.deepEqual(f.ids({...query,page:1}),full.slice(0,2));assert.deepEqual(f.ids({...query,page:2}),full.slice(2,4));
 assert.equal(f.select({...query,aggregate:'count'})[0]['count(*)'],full.length);
 const where=(sql:string)=>sql.split(' where ')[1].split(' order by ')[0];
 assert.equal(where(ajesQuery(query).sql),where(ajesQuery({...query,aggregate:'count'}).sql));
 assert.notEqual(f.select({aggregate:'count'})[0]['count(*)'],full.length);
});

test('PW200 with local150 remains a candidate while PW150 with local200 is rejected locally',t=>{
 const rows:Row[]=[{id:'local-in',pw:200,model:'A4',make:'AUDI',localHp:150},{id:'local-out',pw:150,model:'A4',make:'AUDI',localHp:200},
  {id:'foreign-model',pw:200,model:'A45',make:'AUDI'},{id:'ordinary-in',pw:150,model:'OTHER'},{id:'unknown',pw:''}];
 const f=fixture(t,rows),calculation=index(['audi:a4']),query={powerTo:160,pageSize:48};
 assert.deepEqual(new Set(f.ids(query,calculation)),new Set(['local-in','local-out','ordinary-in','unknown']));
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 assert.equal(filter.matchesPower(offered(rows[0])),true);assert.equal(filter.matchesPower(offered(rows[1])),false);
 assert.equal(filter.matchesPower(offered(rows[2])),false);assert.equal(filter.matchesPower(offered(rows[4])),true);
 assert.equal(f.select({...query,aggregate:'count'},calculation)[0]['count(*)'],4,'COUNT is the actual global candidate scope, not the three locally admitted rows');
});

test('local manual facts, owner families and ASTRA aliases survive source-side power narrowing',t=>{
 const rows:Row[]=[{id:'manual',pw:300,model:'MODEL-X'},{id:'owner',pw:200,model:'STEP WAGON',make:'HONDA'},
  {id:'astra-family',pw:300,model:'C-CLASS',make:'MERCEDES BENZ'},{id:'astra-literal',pw:300,model:'C300',make:'MERCEDES BENZ'},
  {id:'other',pw:300,model:'UNRELATED'}];
 const calculation=index(['toyota:modelx','@astra-power30:mercedesbenz:c300']);
 const f=fixture(t,rows),selected=f.ids({powerTo:160,pageSize:48},calculation);
 assert.deepEqual(new Set(selected),new Set(['manual','owner','astra-family','astra-literal']));
 assert.equal(japanSourcePowerPredicate(1,160,calculation).requiresLocalValidation,true);
});

test('source normalization cannot hide a locally matching model, and dictionary order does not change SQL',t=>{
 const rows:Row[]=[{id:'space',pw:250,model:'a 4'},{id:'dot',pw:250,model:'A.4'},{id:'slash',pw:250,model:'A/4'},
  {id:'fullwidth',pw:250,model:'Ａ４'},{id:'entity',pw:250,model:'A&#52;'},{id:'unicode',pw:250,model:'ステップワゴン'},
  {id:'sibling',pw:250,model:'A45'},{id:'other',pw:250,model:'OTHER'}];
 const f=fixture(t,rows),a=index(['audi:a4','toyota:corolla']),b=index(['toyota:corolla','audi:a4']);
 assert.equal(japanSourcePowerPredicate(1,160,a).sql,japanSourcePowerPredicate(1,160,b).sql);
 assert.deepEqual(new Set(f.ids({powerTo:160,pageSize:48},a)),new Set(rows.slice(0,6).map(row=>row.id)));
});

test('kW, drive and certified thirty-minute facts do not neutralize the discovery PW predicate',t=>{
 const calculation=index(['audi:a4','@astra-power30:mercedesbenz:c300','toyota:corolla']);
 calculation.models['audi:a4'][0].values={powerKw:110};
 calculation.models['@astra-power30:mercedesbenz:c300'][0].values={power30MinKw:50};
 calculation.models['toyota:corolla'][0].values={drive:'fwd'};
 const f=fixture(t,[{id:'kw',model:'A4',pw:200},{id:'certified',model:'C300',pw:200},{id:'drive',model:'COROLLA',pw:200},{id:'within',model:'A4',pw:150}]);
 assert.equal(japanSourcePowerPredicate(1,160,calculation).localModelCount,0);
 assert.deepEqual(f.ids({powerTo:160,pageSize:48},calculation),['within']);
});

test('large local indexes coarsen complete cohorts within the URI budget instead of truncating exceptions',t=>{
 const keys=Array.from({length:400},(_,n)=>'make:local'+n.toString(36).padStart(4,'0'));
 const calculation=index(keys),predicate=japanSourcePowerPredicate(1,160,calculation,1000);
 assert.equal(predicate.applied,true);assert.equal(predicate.cohortMode,'prefix');assert.equal(predicate.localModelCount,400);
 assert.ok(new URLSearchParams({sql:predicate.sql!}).toString().length-4<=1000);
 const f=fixture(t,keys.map((key,n)=>({id:'row-'+n,pw:300,model:key.split(':')[1].toUpperCase()})));
 assert.equal(f.db.prepare('select count(*) as n from stats where '+predicate.sql).get()!.n,400);
 const fallback=japanSourcePowerPredicate(1,160,calculation,10);
 assert.equal(fallback.sql,null);assert.equal(fallback.applied,false);assert.equal(fallback.cohortMode,'unrestricted');
 assert.equal(japanSourcePowerPredicate(1,160,{digest:'incomplete-test-index'} as CalculationIndex).applied,false);
});

test('PW input cannot inject SQL and distinct global ranges cannot share the same raw cache selection',()=>{
 for(const params of [{powerTo:'-1'},{powerTo:'150 OR 1=1'},{powerFrom:'161',powerTo:'160'},{powerTo:'Infinity'},{powerTo:'160.5'}])
  assert.throws(()=>ajesQuery(ajesCatalogQuery({market:'japan',...params})),AjesInputError);
 const ordinary=ajesQuery({}).sql,small=ajesQuery({powerTo:100}).sql,large=ajesQuery({powerTo:160}).sql;
 assert.equal(new Set([ordinary,small,large]).size,3);
 assert.ok(new URLSearchParams({sql:large}).toString().length<6000,'the complete ordinary query retains the URI budget');
 assert.throws(()=>ajesQuery({powerTo:160,sourcePowerSql:'1=1'}),AjesInputError);
});
