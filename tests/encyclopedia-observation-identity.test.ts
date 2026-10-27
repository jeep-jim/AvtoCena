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
