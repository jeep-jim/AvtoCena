import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelSuggestionSearch,type ModelSearchData} from '../apps/web/lib/catalog/model-suggestion-search';
const data:ModelSearchData={version:1,brands:[['Toyota',['Тойота']],['BMW',[]],['Peugeot',[]]],models:[['Toyota','Corolla',[],1],['Toyota','Corolla Cross',[],1],['Toyota','Corolla Cross AWD',[],0],['Toyota','Camry',[],1],['BMW','X5',[],1],['BMW','X3',[],1],['Peugeot','2008',[],1],['Peugeot','208',[],1]]};
const search=createModelSuggestionSearch(data);
test('incomplete trim query recalls Corolla Cross and marks related suggestions',()=>{
 for(const q of ['Corolla Z','Королла Z','Toyota Corolla Z']){const result=search(q);assert.ok(result.some(m=>m.model==='Corolla Cross'&&m.related));assert.ok(!result.some(m=>m.model==='Camry'));}
 assert.equal(search('Королла Кросс')[0].model,'Corolla Cross');
 assert.equal(search('Corolla Cross')[0].related,undefined);
 assert.ok(search('Corolla').some(m=>m.model==='Corolla Cross'));
});
test('brand scope, short identities and numeric model names stay distinct',()=>{
 assert.equal(search('Corolla Z','BMW').length,0);assert.equal(search('unrelated').length,0);
 assert.equal(search('BMW X5')[0].model,'X5');assert.ok(!search('BMW X5').some(m=>m.model==='X3'));
 assert.equal(search('2008')[0].model,'2008');assert.equal(search('208')[0].model,'208');
 assert.ok(search('Тойота').every(m=>m.make==='Toyota'));assert.ok(search('','Toyota').length>0);assert.equal(search('').length,0);
});
