import test from 'node:test';
import assert from 'node:assert/strict';
import {applyJapanOwnerSpecifications as apply,isOwnerStepwgnNonHybrid} from '../apps/web/lib/catalog/japan-owner-specifications';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {presentCatalogOffer} from '../apps/web/lib/catalog/presentation';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesPowerFilterValues} from '../apps/web/lib/catalog/ajes-power-estimate';
const base:any={market:'japan',make:'Honda',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion',year:2018,engineCc:1500};
test('owner override covers aliases, old and incoming rows, and invalidates stale quotes',()=>{
 for(const model of ['STEPWGN','STEP WAGON Z','STEPWGN SPADA','STEP WGN AIR','STEPWAGON','Степвагон'])for(const powerHp of [undefined,152,160,150]){
  const row={...base,model,powerHp,totalRub:2000000,calculationSnapshot:{powerScenario:{horsepower:100,utilizationPowerKw:73.55,source:'fallback_100'}}};
  const result=apply(row);
  assert.equal(result.powerHp,150);assert.equal(result.powerKw,110.32481);assert.equal(result.totalRub,null);
  assert.match(result.powerDataSource,/^owner_policy:/);assert.equal(result.operational.semanticEvidence,undefined);
  assert.equal(result.operational.ownerPowerOverride.previous.powerHp,powerHp);assert.equal(row.powerHp,powerHp);
  assert.equal(apply(result),result);
 }
});
test('hybrids stay untouched even with an erroneous petrol default',()=>{
 for(const patch of [{fuel:'hybrid'},{powertrainKind:'other_hybrid'},{model:'STEPWGN e:HEV'},{trim:'HYBRID G EX'},{trim:'ハイブリッド'},{chassisCode:'6AA-RP8'},{chassisCode:'RP5'},{frameNumber:'RP5-1234567'},{operational:{chassisCode:'6AA-RP5'}},{operational:{raw:{sourceFuel:'HE'}}},{power30MinKw:54},{fuel:'unknown',operational:{raw:{sourceFuel:'Q'}}}]){
  const row={...base,...patch};assert.equal(isOwnerStepwgnNonHybrid(row),false);assert.notEqual(apply(row).powerHp,150);
 }
 for(const patch of [{make:'Other'},{model:'N-WGN'},{model:'STEPWGNFAKE'},{market:'korea'}])assert.equal(apply({...base,...patch}).powerHp,undefined);
});
test('same 150 in safe cards, presentation, calculator and preliminary price inputs',()=>{
 for(const sourceId of ['ajes_japan_feed','akebono_green_japan_open']){
  const row={...base,sourceId,powerHp:152,powerKw:112,operational:{raw:{sourcePower:'152'},semanticEvidence:{fuel:{status:'exact',value:'petrol',source:'fixture'},powertrainKind:{status:'exact',value:'combustion',source:'fixture'},engineCc:{status:'exact',value:1500,source:'fixture'}}}};
  assert.equal(safePublicPricing(row).powerHp,150);
  assert.equal(presentCatalogOffer(row).powerHp,150);
  assert.equal(offerParameterDraft(row,row).powerHp,'150');
  const preview=japanPreviewParameters(row);
  assert.equal(preview.powerHp,150);
  const corrected=apply(row);
  assert.equal(safePublicPricing({...corrected,totalRub:2100000}).totalRub,2100000);
 }
});
test('auction power query includes owner rule before counts/page and saved power uses override',()=>{
 for(const aggregate of [undefined,'count'] as const){const sql=ajesQuery({table:'stats',powerTo:160,aggregate}).sql;assert.match(sql,/150<=160/);assert.match(sql,/RP\[58\]/);assert.ok(!sql.includes('limit')||sql.indexOf('150<=160')<sql.indexOf('limit'));}
 assert.doesNotMatch(ajesQuery({table:'korea',powerTo:160}).sql,/RP\[58\]/);
 assert.deepEqual(ajesPowerFilterValues({...base,sourceId:'ajes_japan_feed',operational:{raw:{sourcePower:'170'}}}),[150]);
});
test('SQL and local classification agree for fuel/chassis/alias exclusions',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {stepwgnOwnerSql}=await import('../apps/web/lib/catalog/japan-owner-specifications');
 const db=new DatabaseSync(':memory:');db.function('regexp',(p,v)=>v===null?null:Number(new RegExp(String(p),'i').test(String(v))));
 db.exec('create table cars(marka_name text,model_name text,time text,grade text,kuzov text,pw integer)');
 const cases=[['HONDA','STEP WAGON','P','Z','RK5',160],['HONDA','STEPWGN',null,null,null,152],['HONDA','STEPWGN','P','','RP5',145],['HONDA','STEPWGN','P','','6AA-RP8',145],['HONDA','STEPWGN','HE','','RP5',145],['HONDA','STEPWGN','P','e:HEV',null,145],['HONDA','STEPWGN','P','ハイブリッド',null,145],['HONDA','N-WGN','P','',null,64]];
 for(const [make,model,fuel,trim,chassis,pw] of cases){
  db.exec('delete from cars');db.prepare('insert into cars values(?,?,?,?,?,?)').run(make,model,fuel,trim,chassis,pw);
  const predicate=stepwgnOwnerSql();
  assert.equal(Number(db.prepare(`select ${predicate} as owner from cars`).get()!.owner),Number(isOwnerStepwgnNonHybrid({market:'japan',make,model,trim,chassisCode:chassis,operational:{raw:{sourceFuel:fuel}}})));
  const count=db.prepare(`select count(*) as n from cars where ((${predicate} and 150<=150) or (not ${predicate} and pw<=150))`).get()!.n;
  assert.equal(Number(count),isOwnerStepwgnNonHybrid({market:'japan',make,model,trim,chassisCode:chassis,operational:{raw:{sourceFuel:fuel}}})||Number(pw)<=150?1:0);
 }
 db.close();
});
