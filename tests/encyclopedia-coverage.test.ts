import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCoverage,summarizeCoverage} from '../scripts/encyclopedia/coverage.mjs';
const row={id:'variant',year:2024,trim:'2.0 T',fuel:'petrol',powertrainKind:'combustion',engineCc:1999,powerHp:160,status:'observed'};
const record=(variants:any[])=>({id:'model',make:'Example',model:'One',revision:'revision',photo:'',variants});
test('present observations are not reported as supported facts or ready calculations',()=>{
 const r=modelCoverage(record([row]),[]);assert.equal(r.requiredValuesPresent,1);assert.equal(r.requiredValuesSupported,0);assert.equal(r.unsupported.engineCc,1);
});
test('electric coverage requires certified power, never displacement or peak substitution',()=>{
 const r=modelCoverage(record([{...row,fuel:'electric',powertrainKind:'electric',engineCc:undefined,powerHp:300}]),[]);
 assert.equal(r.missing.power30MinKw,1);assert.equal(r.missing.engineCc,undefined);assert.equal(r.requiredValuesPresent,0);
});
test('unknown powertrain cannot be counted complete',()=>{
 const r=modelCoverage(record([{...row,powertrainKind:'unknown'}]),[]);assert.equal(r.requiredValuesPresent,0);assert.equal(r.missing.powertrainKind,1);
});
test('documented engine abbreviations count like calculator aliases without supplying missing facts',()=>{
 for(const alias of ['ICE','ice','combustion']){
  const values={fuel:'petrol',powertrainKind:alias,engineCc:1999,powerHp:160};
  const r=modelCoverage(record([{...row,powertrainKind:alias}]),[{variantId:row.id,values,sources:{}}]);
  assert.equal(r.requiredValuesSupported,1);assert.equal(r.missing.powertrainKind,undefined);
 }
 for(const alias of ['BEV','HEV','PHEV','EREV','series_hybrid','other_hybrid']){
  const r=modelCoverage(record([{...row,powertrainKind:alias}]),[]);
  assert.equal(r.requiredValuesSupported,0);assert.equal(r.missing.power30MinKw,1);
 }
});
test('compiled field sources stay distinct and reports aggregate all models',()=>{
 const facts=[{variantId:'variant',values:{fuel:'petrol',powertrainKind:'combustion',engineCc:1999,powerHp:160},sources:{fuel:{kind:'manufacturer',batchId:'batch'},powertrainKind:{kind:'manufacturer',batchId:'batch'},engineCc:{kind:'owner_reference'},powerHp:{kind:'manual'}}}];
 const one=modelCoverage(record([row]),facts);assert.equal(one.requiredValuesSupported,1);assert.deepEqual(one.sourceFields,{manufacturer:2,owner_reference:1,manual:1});assert.equal(one.batches.batch,2);
 const report=summarizeCoverage([one,modelCoverage({...record([]),id:'second',make:'Another'},[])],{indexDigest:'digest'});
 assert.equal(report.total.brands,2);assert.equal(report.total.models,2);assert.equal(report.total.requiredValuesSupported,1);
});
test('powertrain denominators partition all variants and distinguish recorded from supported 30-minute power',()=>{
 const rows=[row,{...row,id:'ev',powertrainKind:'BEV',fuel:'electric',power30MinKw:50},{...row,id:'hev',powertrainKind:'HEV',power30MinKw:30},{...row,id:'unknown',powertrainKind:'unknown'}];
 const facts=rows.slice(0,2).map(r=>({variantId:r.id,values:{...r},sources:{}}));
 const report=summarizeCoverage([modelCoverage(record(rows),facts)],{});
 assert.equal(Object.values(report.byPowertrain).reduce((n:any,g:any)=>n+g.variants,0),4);
 assert.equal(report.byPowertrain.combustion.completePercent,100);
 assert.equal(report.byPowertrain.electric.power30MinSupported,1);
 assert.equal(report.byPowertrain.hybrid.power30MinPresent,1);
 assert.equal(report.byPowertrain.hybrid.power30MinSupported,0);
 assert.equal(report.byPowertrain.hybrid.remainingPercent,100);
 assert.equal(report.byPowertrain.unknown.remaining,1);
 assert.equal(report.total.requiredValuesSupported,2);
});
