import test from 'node:test';
import assert from 'node:assert/strict';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection,japanSourceSelectionSql} from '../apps/web/lib/catalog/japan-source-selection';
import type {CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';

const editorial={revision:'e1',entries:{}};
const index={version:1,digest:'d1',manifestDigest:'m1',createdAt:'2026-11-28T00:00:00Z',models:{
 'audi:a4':[
  {make:'Audi',model:'A4',year:2020,values:{powerHp:150}},
  {make:'Audi',model:'A4',year:2021,values:{powerHp:200}},
  {make:'Audi',model:'A4',year:2020,values:{powerKw:110}},
 ],
 '@astra-power30:audi:a4':[{year:0,values:{power30MinKw:100}}],
}} as unknown as CalculationIndex;

test('power plan retains only annual hp donors in range and the owner policy',()=>{
 const plan=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 assert.equal(plan.complete,true);assert.equal(plan.ownerStepwgn,true);
 assert.deepEqual(plan.models,[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}]);
 const high=buildJapanPowerCandidatePlan({powerFrom:170,powerTo:210,index,editorial});
 assert.equal(high.ownerStepwgn,false);assert.equal(high.models[0].year,2021);
});
test('complete wire directory keeps every canonical spelling without manufacturing aliases',()=>{
 const plan=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const sourceModels=[{make:'AUDI',model:'A4'},{make:'AUDI',model:'A 4'},{make:'AUDI',model:'A-4'},
  {make:'ＡＵＤＩ',model:'Ａ４'},{make:'HONDA',model:'STEP WGN'},{make:'TOYOTA',model:'A4'}];
 const resolved=resolveJapanSourceSelection({power:plan,sourceModels,directoryComplete:true});
 assert.equal(resolved.complete,true);assert.equal(resolved.selection!.power!.models.length,4);
 const known=japanSourceSelectionSql(resolved.selection!,'k'),unknown=japanSourceSelectionSql(resolved.selection!,'u');
 for(const name of ['A4','A 4','A-4','Ａ４','STEP WGN'])assert(known.includes(`'${name}'`));
 assert(known.includes('year=2020'));assert(!known.includes('year=2021'));assert(!known.includes("marka_name='TOYOTA'"));
 assert(known.includes('pw>=1 and pw<=160'));assert(!known.includes('pw is null'));assert(!known.includes('pw+'));assert(!known.includes('pw*'));
 assert(known.includes("pw regexp '[^ -~]'"));assert(known.includes("pw like '%&%'"));
 assert(unknown.includes('pw is null'));assert(!unknown.includes('model_name'));
});
test('a stale or missing directory cannot establish complete local override coverage',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:false});
 assert.equal(result.complete,false);assert.equal(result.selection,null);assert(result.unresolved.includes('source_model_directory_incomplete'));
});
test('an unsupported exact entity spelling is reported, never silently removed or expanded to all models',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[{make:'AUDI',model:'A&#52;'}],directoryComplete:true});
 assert.equal(result.complete,false);assert.equal(result.selection,null);assert(result.unresolved.includes('source_model_spelling_unsupported'));
});
test('no index means no annual hp contribution and no extra directory needed outside owner range',()=>{
 const power=buildJapanPowerCandidatePlan({powerFrom:170,powerTo:210,index:null,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:false});
 assert.equal(result.complete,true);assert.deepEqual(result.selection!.power!.models,[]);
});
test('body cohorts use the same exact alias resolution and combine with power, not a page-local sort',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const body={models:[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}],ids:['saved-1'],sourceBody:{field:'BODY_TYPE' as const,labels:['SUV','Кроссовер']},pickupCandidates:false,complete:true,unresolved:[]};
 const result=resolveJapanSourceSelection({power,body,sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 const sql=japanSourceSelectionSql(result.selection!,'k');
 assert(sql.includes("id='saved-1'"));assert(sql.includes("body_type is not null and body_type!=''"));assert(sql.includes(') and ('));
 assert(!sql.includes('body_type) in'),'source body aliases cannot silently narrow NFKC/whitespace variants');
});
test('missing body schema keeps representable known candidates explicitly incomplete',()=>{
 const body={models:[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}],ids:['saved-1'],pickupCandidates:false,
  complete:false,unresolved:['body_source_schema_unobserved']};
 const result=resolveJapanSourceSelection({body,sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 assert.equal(result.complete,false);assert(result.selection);assert.deepEqual(result.unresolved,['body_source_schema_unobserved']);
 const sql=japanSourceSelectionSql(result.selection);
 assert(sql.includes("model_name='A 4'"));assert(sql.includes("id='saved-1'"));assert(!sql.includes('body_type'));
 const noIndex=resolveJapanSourceSelection({body:{...body,models:[],unresolved:['body_source_schema_unobserved','body_encyclopedia_unavailable']},sourceModels:[],directoryComplete:false});
 assert.equal(noIndex.complete,false);assert(noIndex.selection);assert(japanSourceSelectionSql(noIndex.selection).includes("id='saved-1'"));
 const invalid=resolveJapanSourceSelection({body:{...body,unresolved:['body_evidence_identity_invalid']},sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 assert.equal(invalid.selection,null);
});
test('typed SQL descriptors reject injected fields, invalid ids, phases and raw SQL names',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index:null,editorial});
 const {selection}=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:true});
 assert.throws(()=>japanSourceSelectionSql(selection!),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,sql:'1=1'} as any,'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,ids:["x' or 1=1"]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,ids:123}} as any,'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,models:[{make:'AUDI',model:"A4'",years:[2020]}]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,models:[{make:"AUDI' OR 1=1",model:'A4',years:[2020]}]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,from:0}},'k'),/ajes_invalid_query/);
});
test('local-only body scope intersects annual power exceptions while preserving exact edited IDs',()=>{
 const selection:any={version:1,power:{from:1,to:160,models:[
  {make:'AUDI',model:'A4',years:[2020,2021]},{make:'TOYOTA',model:'POWER ONLY',years:[2020]},
 ],ids:['manual-power'],ownerModels:[]},body:{models:[{make:'AUDI',model:'A4',years:[2021,2022]}],ids:['manual-body'],pickupCandidates:false}};
 const before=JSON.stringify(selection),sql=japanSourceSelectionSql(selection,'k');
 assert(!sql.includes('POWER ONLY'));assert(!sql.includes('2020'));assert(sql.includes("model_name='A4' and year=2021"));
 assert(sql.includes("id in ('manual-body','manual-power')"));assert(sql.includes('pw>=1 and pw<=160'));
 assert.equal(JSON.stringify(selection),before,'SQL compilation does not mutate cursor identity');
 for(const patch of [{sourceBody:{field:'BODY_TYPE',labels:['suv']}},{pickupCandidates:true}]){
  const broad=japanSourceSelectionSql({...selection,body:{...selection.body,...patch}},'k');assert(broad.includes('POWER ONLY'));
 }
});
test('year compression preserves gaps and uses a range only for consecutive years',()=>{
 const base={version:1 as const,body:{models:[{make:'AUDI',model:'A4',years:[2023,2021,2022,2020,2020]}],ids:[],pickupCandidates:false}};
 const compact=japanSourceSelectionSql(base);assert(compact.includes('year>=2020 and year<=2023'));
 const gaps=japanSourceSelectionSql({...base,body:{...base.body,models:[{make:'AUDI',model:'A4',years:[2020,2022,2023]}]}});
 assert(gaps.includes('year in (2020,2022,2023)'));assert(!gaps.includes('year>=2020'));
 const pair=japanSourceSelectionSql({...base,body:{...base.body,models:[{make:'AUDI',model:'A4',years:[2020,2021]}]}});
 assert(pair.includes('year in (2020,2021)'));
});
test('cross-make compression retains the exact association between source model names and year sets',()=>{
 const selection:any={version:1,power:{from:1,to:160,models:[
  {make:'AUDI',model:'COMMON',years:[2020,2022]},
  {make:'TOYOTA',model:'COMMON',years:[2020,2022]},
  {make:'HONDA',model:'OTHER',years:[2021]},
 ],ids:[],ownerModels:[{make:'HONDA',model:'STEP WGN'},{make:'HONDA',model:'STEPWGN'}]}};
 const before=JSON.stringify(selection),sql=japanSourceSelectionSql(selection,'k');
 assert(sql.includes("model_name='COMMON' and year in (2020,2022)"));
 assert(sql.includes("model_name='OTHER' and year=2021"));
 assert(!sql.includes("model_name in ('COMMON','OTHER')"),'different year sets cannot be merged');
 assert(sql.includes("model_name in ('STEP WGN','STEPWGN')"));
 assert(!sql.includes('marka_name='),'shorter exact-name superset avoids repeated makes');
 assert.equal(JSON.stringify(selection),before);
});
