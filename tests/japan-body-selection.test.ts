import test from 'node:test';
import assert from 'node:assert/strict';
import {checksum,modelKey,compileModelFacts,type CalculationFact,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {buildJapanBodyCandidatePlan} from '../apps/web/lib/catalog/japan-body-selection';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection,japanSourceSelectionSql} from '../apps/web/lib/catalog/japan-source-selection';
import {japanSourceBody,japanSourceBodyLabels} from '../apps/web/lib/catalog/japan-source-body';

const empty={revision:'0',entries:{}};
function fact(make:string,model:string,year:number,bodyType?:string):CalculationFact {
 return {make,model,modelId:make+'/'+model,variantId:model+'-'+year,revision:'r',year,trims:['specific-trim'],constraints:{bodyType},
  values:{bodyType},sources:bodyType?{bodyType:{kind:'manufacturer',url:'https://example.com/fixture-only'}}:{}};
}
function index(facts:CalculationFact[]):CalculationIndex {
 const models:CalculationIndex['models']={};
 for(const f of facts)(models[modelKey(f.make,f.model)]||=[]).push(f);
 return {version:1,digest:checksum(models),manifestDigest:'fixture',createdAt:'2026-11-28T10:00:00Z',models};
}

test('body candidates enumerate every matching annual identity without treating all trims as matching',()=>{
 const source=index([fact('Toyota','TEST',2023,'suv'),fact('Toyota','TEST',2023,'sedan'),fact('Toyota','TEST',2022,'sedan'),fact('Audi','A 4',2023,'crossover'),fact('Toyota','NO BODY',2023)]);
 const plan=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields:['ID','BODY_TYPE']});
 assert.deepEqual(plan.models,[{modelKey:'audi:a4',make:'Audi',model:'A 4',year:2023},{modelKey:'toyota:test',make:'Toyota',model:'TEST',year:2023}]);
 assert.equal(plan.complete,true);
 assert.deepEqual(plan.ids,[]);
 assert.deepEqual(plan.sourceBody,{field:'BODY_TYPE',labels:['suv','crossover','кроссовер']});
 assert.equal(plan.pickupCandidates,false);
});

test('body planning reads the complete index without a make, model, or year count cap',()=>{
 const source=index(Array.from({length:750},(_,i)=>fact('Fixture Make '+i,'Model '+i,2008+i%19,'suv')));
 const before=JSON.stringify(source);
 const plan=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty});
 assert.equal(plan.models.length,750);
 assert.equal(new Set(plan.models.map(row=>row.modelKey)).size,750);
 assert.equal(JSON.stringify(source),before);
 assert.equal(plan.complete,false);
 assert.deepEqual(plan.unresolved,['body_source_schema_unobserved']);
 assert.equal(plan.sourceBody,undefined);
});

test('a verified old SUV fact from the common index builder cannot disable the current power/body selection',()=>{
 const facts=compileModelFacts({id:'fixture/suv',make:'Fixture',model:'SUV',revision:'r1',variants:[1999,2020].map(year=>({
  id:'suv-'+year,year,trim:'2.0',bodyType:'suv',powerHp:150,status:'verified',sourceUrl:'https://example.com/offline-fixture',
 }))});
 assert.deepEqual(facts.map(value=>value.year),[1999,2020],'the country-independent index legitimately retains older annual facts');
 const source=index(facts),before=JSON.stringify(source);
 for(const observedSourceFields of [undefined,['BODY_TYPE']]){
  const body=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields});
  assert.deepEqual(body.models.map(value=>value.year),[2020]);
  const power=buildJapanPowerCandidatePlan({powerTo:160,index:source,editorial:empty});
  const resolved=resolveJapanSourceSelection({body,power,sourceModels:[{make:'FIXTURE',model:'SUV'}],directoryComplete:true});
  assert(resolved.selection,'an irrelevant old year must not force the broad fallback reader');
  assert.equal(resolved.complete,Boolean(observedSourceFields));
  assert.deepEqual(resolved.unresolved,observedSourceFields?[]:['body_source_schema_unobserved']);
  const sql=japanSourceSelectionSql(resolved.selection,'k');
  assert.match(sql,/model_name='SUV' and year=2020/);assert.doesNotMatch(sql,/1999/);
 }
 assert.equal(JSON.stringify(source),before,'out-of-scope facts remain intact in the shared encyclopedia');
});

test('body candidate years match the source cohort domain while malformed annual evidence still fails closed',()=>{
 const source=index([2007,2008,2100,2101].map(year=>fact('Toyota','TEST',year,'suv')));
 const plan=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(plan.models.map(value=>value.year),[2008,2100]);assert.equal(plan.complete,true);assert.deepEqual(plan.unresolved,[]);
 const malformed=index([fact('Toyota','TEST',2020.5,'suv'),fact('Toyota','TEST',2020,'suv')]);
 const invalid=buildJapanBodyCandidatePlan({selection:'suv',index:malformed,editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(invalid.models.map(value=>value.year),[2020]);assert.equal(invalid.complete,false);
 assert.deepEqual(invalid.unresolved,['body_evidence_identity_invalid']);
});

test('source body support is explicit and does not claim an unknown schema as complete',()=>{
 const source=index([fact('Toyota','TEST',2023,'suv')]);
 for(const observedSourceFields of [undefined,[],['ID','KUZOV','MODEL_NAME']]){
  const plan=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields});
  assert.equal(plan.models.length,1);assert.equal(plan.complete,false);assert.equal(plan.sourceBody,undefined);
 }
 assert.equal(buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields:['body_type']}).complete,true);
 const unavailable=buildJapanBodyCandidatePlan({selection:'suv',index:null,editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.equal(unavailable.complete,false);assert.deepEqual(unavailable.unresolved,['body_encyclopedia_unavailable']);
});

test('only visible identity-bound Japanese editorial body corrections enter the candidate IDs',()=>{
 const entry={id:'ajes-stats-manual',market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'manual',status:'visible',specifications:{bodyType:'suv'}};
 const entries:any={};
 for(const [suffix,patch] of Object.entries({manual:{},hidden:{status:'hidden'},otherMarket:{market:'china'},foreignSource:{sourceId:'other'},identityMismatch:{sourceOfferId:'different'},sedan:{specifications:{bodyType:'sedan'}}})){
  const id='ajes-stats-'+suffix;entries[id]={...entry,id,sourceOfferId:suffix,...patch};
 }
 entries['ajes-stats-wrong-id']={...entry,sourceOfferId:'wrong-id'};
 const plan=buildJapanBodyCandidatePlan({selection:'suv',index:index([]),editorial:{revision:'1',entries},observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(plan.ids,['manual']);
});

test('missing proof remains incomplete and older verified facts retain their exact index key',()=>{
 const source=index([fact('Toyota','TEST',2023,'suv')]);
 const f=source.models['toyota:test'][0];delete f.make;delete f.model;
 const plan=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(plan.models,[{modelKey:'toyota:test',make:'',model:'',year:2023}]);
 delete f.sources.bodyType;
 const invalid=buildJapanBodyCandidatePlan({selection:'suv',index:source,editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(invalid.models,[]);assert.equal(invalid.complete,false);assert.deepEqual(invalid.unresolved,['body_evidence_unproven']);
});

test('all parser labels are returned for a multiselect and pickup inference remains an explicit branch',()=>{
 const selected=['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'];
 const labels=japanSourceBodyLabels(selected);
 assert.ok(labels.length>selected.length);
 for(const label of labels)assert.ok(selected.includes(japanSourceBody(label)!));
 const plan=buildJapanBodyCandidatePlan({selection:'pickup|suv|pickup',index:index([]),editorial:empty,observedSourceFields:['BODY_TYPE']});
 assert.deepEqual(plan.bodyTypes,['pickup','suv']);assert.equal(plan.pickupCandidates,true);
 assert.deepEqual(plan.sourceBody?.labels,japanSourceBodyLabels(['pickup','suv']));
 for(const selection of ['',"suv' OR 1=1",'bus','unknown'])assert.throws(()=>buildJapanBodyCandidatePlan({selection,index:index([]),editorial:empty}),/ajes_invalid_query/);
});
