import test from 'node:test';import assert from 'node:assert/strict';
import {appendMissingObservations} from '../apps/web/lib/encyclopedia/observations';
import {compileModelFacts} from '../apps/web/lib/encyclopedia/calculation-index';
test('a rediscovered original ID cannot shadow its reviewed field provenance',()=>{
 const original:any={id:'original',year:2020,trim:'A1 30',bodyType:'hatchback',status:'review',markets:['europe'],researchEvidence:{batchId:'review',checkedIdentity:{make:'Audi',model:'A1',year:2020,trim:'A1 30'},fields:['bodyType'],values:{bodyType:'hatchback'},source:{type:'manufacturer',url:'https://www.audi.com/body.pdf'}}};
 const incoming:any={id:'original',year:2020,trim:'A1 30',status:'observed',markets:['europe']};
 const before=structuredClone(original),variants=appendMissingObservations([original],[incoming,{...incoming,id:'new',year:2025}]);
 assert.equal(variants.length,2);assert.deepEqual(original,before);assert.equal(variants[0],original);
 const facts=compileModelFacts({id:'model',make:'Audi',model:'A1',revision:'new',variants});
 const fact=facts.find(f=>f.variantId==='original')!;assert.equal(fact.values.bodyType,'hatchback');assert.equal(fact.sources.bodyType?.batchId,'review');
 assert.deepEqual(appendMissingObservations(variants,[incoming]),variants);
});

test('active ancestry skips only the proven faulty migration while retaining its audit references',async()=>{
 const {compactObservationRepair}=await import('../apps/web/lib/encyclopedia/observations');
 const {assertAstraRecordContinuation}=await import('../scripts/encyclopedia/assert-release-astra.mjs');
 const root='knowledge/encyclopedia';
 const {ROOT}=await import('../apps/web/lib/encyclopedia/records');
 const key=(revision:string)=>`${ROOT}/revisions/model/${revision}.json`;
 const old:any={id:'model',make:'Audi',model:'A1',revision:'old',variants:[{id:'v',year:2020,trim:'A1',icePowerKw:150,status:'observed'}]};
 const good:any={...old,revision:'good',previousKey:key('old'),variants:[{...old.variants[0],icePowerKw:110,status:'review',researchEvidence:{batchId:'real'}}]};
 const bad:any={...good,revision:'bad',previousKey:key('good'),directorySnapshot:{capturedAt:'date'},variants:[...good.variants,{...old.variants[0]}]};
 const cleaned:any={...bad,revision:'cleaned',previousKey:key('bad'),variants:[...good.variants]};
 const records=new Map([[key('old'),old],[key('good'),good],[key('bad'),bad]]);
 const args:any={original:old,current:cleaned,readRecord:async(k:string)=>records.get(k),isReviewedResearchCorrection:({before,after,afterRecord}:any)=>before.icePowerKw===150&&after.icePowerKw===110&&afterRecord.revision==='good'};
 await assert.rejects(assertAstraRecordContinuation(args),/existing_value_changed/);
 const plan=compactObservationRepair(cleaned,bad,good)!;assert.equal(plan.previousKey,key('good'));assert.equal(plan.ancestryRepaired,true);
 const fixed={...cleaned,revision:'fixed',previousKey:plan.previousKey,supersededSnapshotKeys:[key('bad'),key('cleaned')]};
 await assertAstraRecordContinuation({...args,current:fixed});
 assert.equal(compactObservationRepair({...cleaned,photo:'staff-edit'},bad,good),null);
 assert.equal(compactObservationRepair({...cleaned,variants:[{...cleaned.variants[0],icePowerKw:999}]},bad,good),null);
 assert.equal(compactObservationRepair(bad,good)!.removed,1);
});
