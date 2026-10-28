import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeModelSuggestions,createModelSuggestionSearch,type ModelSearchData} from '../apps/web/lib/catalog/model-suggestion-search';
const data:ModelSearchData={version:1,brands:[['Toyota',['Тойота']],['BMW',[]],['Peugeot',[]]],models:[['Toyota','Corolla',[],1],['Toyota','Corolla Cross',[],1],['Toyota','Corolla Cross AWD',[],0],['Toyota','Camry',[],1],['BMW','X5',[],1],['BMW','X3',[],1],['Peugeot','2008',[],1],['Peugeot','208',[],1]]};
const search=createModelSuggestionSearch(data);
test('single-letter model names remain searchable within a selected make',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['GAC','S',[],1],['GAC','S7',[],1]]});
 assert.equal(find('S','GAC')[0].model,'S');
 assert.deepEqual(find('S'),[]);
});
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
 assert.ok(search('Тойота').every(m=>m.make==='Toyota'));assert.ok(search('','Toyota').length>0);assert.equal(search('').length,data.models.length);
});

test('current feed identities extend the dictionary without duplicates or cross-brand leakage',async()=>{
 const {mergeModelSuggestions}=await import('../apps/web/lib/catalog/model-suggestion-search');
 const inventory=createModelSuggestionSearch({version:1,brands:[],models:[['Haval','M6',[],1],['Haval','F7',[],1],['Great Wall','Poer',[],1],['Isuzu','RE-MAX Ruimai',[],1]]});
 for(const [query,make,model] of [['m6','Haval','M6'],['Poer','Great Wall','Poer'],['RE-MAX','Isuzu','RE-MAX Ruimai']]){
  assert.equal(mergeModelSuggestions(inventory(query,make),search(query,make),query)[0].model,model);
 }
 assert.equal(inventory('M6','Toyota').length,0);
 assert.equal(inventory('Haval M6')[0].model,'M6');
 assert.equal(inventory('Great Wall Poer')[0].model,'Poer');
 const item={make:'Haval',model:'M6',aliases:[]};
 assert.equal(mergeModelSuggestions([item],[{...item,aliases:['М6']}],'M6').length,1);
 assert.deepEqual(mergeModelSuggestions([item],[{...item,aliases:['М6']}],'M6')[0].aliases,['М6']);
});

test('substring suggestions recall names when a prefix is missing',()=>{
 assert.equal(search('rolla')[0].model,'Corolla');
 assert.equal(search('rolla','BMW').length,0);
});
test('typed selections preserve the request instead of picking an unrelated first result',async()=>{
 const {typedModelSelection}=await import('../apps/web/lib/catalog/model-suggestion-search');
 assert.equal(typedModelSelection('Королла',search('Королла'),true),'Corolla');
 assert.equal(typedModelSelection('Corolla Z',search('Corolla Z'),true),'Corolla Z');
 assert.equal(typedModelSelection('Camry, Corolla, Camry, ',search('','Toyota'),true),'Camry|Corolla');
 assert.equal(typedModelSelection('Unknown model',[],true),'Unknown model');
 assert.equal(typedModelSelection('',search('','Toyota'),true),'');
});

test('substring matches survive competing prefixes and spaced model identities',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['Toyota','Corolla',[],1],['Other','Rolla',[],1],['Audi','A6',[],1],['Audi','A6L',[],1]]});
 assert.ok(find('rolla').some(row=>row.model==='Corolla'));
 assert.equal(find('A 6','Audi')[0].model,'A6');
 assert.equal(find('А6','Audi')[0].model,'A6');
});

 test('opening and searching the picker retain every model beyond the old fifty-row limit',()=>{
 const rows=Array.from({length:180},(_,i)=>['Toyota','Corolla '+i,[],1] as [string,string,string[],number]);
 const find=createModelSuggestionSearch({version:1,brands:[],models:rows});
 assert.equal(find('','Toyota').length,180);
 assert.equal(find('Corolla','Toyota').length,180);
 assert.equal(find('').length,180);
 assert.equal(mergeModelSuggestions(find('Corolla'),[], 'Corolla').length,180);
 });

test('source brand aliases remain visible under their canonical selected make',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['BENZ','C-CLASS',[],1],['MERCEDES BENZ','E-CLASS',[],1],['BMW','X5',[],1]]});
 assert.equal(find('','Mercedes-Benz').length,2);
});

test('placeholder models are omitted without corrupting search indexes or Japanese brand scope',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['トヨタ','※',[],0],['トヨタ','Corolla',[],0],['スバル','Forester',[],0],['Toyota','---',[],0]]});
 assert.deepEqual(find('','Toyota').map(row=>row.model),['Corolla']);
 assert.equal(find('Forester')[0].model,'Forester');
 assert.equal(find('').length,2);
 assert.equal(mergeModelSuggestions([{make:'Toyota',model:'※',aliases:[]}],find(''), '').length,2);
});

test('unreviewed localized document headings do not enter the public dictionary; live models remain selectable',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['BMW','3.「CO2排出量」については',[],0],['Toyota','カローラ',[],1],['Toyota','Corolla',[],1]]});
 assert.equal(find('').length,2);
 assert.equal(find('','Toyota').length,2);
});

 test('Russian spellings, transliteration and typos suggest the canonical model',()=>{
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['Toyota','Corolla',[],1],['Toyota','Corolla Cross',[],1],['Hyundai','Kona',[],1],['Hyundai','Kona Electric',[],1],['BMW','X5',[],1],['BMW','X3',[],1]]});
 for(const q of ['королла','колрла','corola','korolla','xorolla'])assert.ok(find(q).some(row=>row.model==='Corolla'),q);
 for(const q of ['кона','cona','kona'])assert.equal(find(q)[0].model,'Kona',q);
 assert.deepEqual(find('колрла','Hyundai'),[]);
 assert.deepEqual(find('X4'),[]);
 assert.equal(find('Corolla')[0].related,undefined);
 });

test('spaced exact ix35 uses its real name and infers only an unambiguous make',async()=>{
 const {typedModelSelection,typedModelMake}=await import('../apps/web/lib/catalog/model-suggestion-search');
 const find=createModelSuggestionSearch({version:1,brands:[],models:[['Hyundai','ix35',[],1],['Hyundai','Tucson',[],1],['Other','ix350',[],1]]});
 const rows=find('ix 35');assert.equal(rows[0].model,'ix35');
 assert.equal(typedModelSelection('ix 35',rows,true),'ix35');assert.equal(typedModelMake('ix35',rows),'Hyundai');
 assert.equal(typedModelSelection('ix 35',find('Tucson'),true),'ix 35','never substitute a successor or a fuzzy suggestion');
 assert.equal(typedModelMake('Unknown',rows),'');
 assert.equal(typedModelMake('ix35',[...rows,{make:'Other',model:'ix35',aliases:[]}]),'');
});
