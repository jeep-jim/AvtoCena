import test from 'node:test';
import assert from 'node:assert/strict';
import {relatedModelFamily, readRelatedModelFamily} from '../apps/web/lib/catalog/related-model-family';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter';
import {selectRelatedOfferGroups} from '../apps/web/lib/catalog/related-offer-selection';
const directory:any[] = [
 ...['A2','A4','A4L','A5','Q2','Q2L'].map(model=>({make:'Audi',model})),
 ...['CX-5','CX-50'].map(model=>({make:'Mazda',model})),
 ...['Corolla','Corolla Cross','Land Cruiser','Land Cruiser Prado'].map(model=>({make:'Toyota',model})),
 {make:'Honda',model:'Fit',aliases:['フィット']},
];
test('related discovery includes base and sibling versions in either direction',()=>{
 for(const [make,a,b,base] of [['Audi','A4','A4L','A4'],['Audi','Q2','Q2L','Q2'],['Toyota','Corolla','Corolla Cross Hybrid','Corolla'],['Toyota','Land Cruiser','Land Cruiser Prado','Land Cruiser']]){
  for(const current of [a,b]){
   const family=relatedModelFamily(make,current,directory);
   assert.equal(family,base);
   assert.equal(matchesCatalogModel(a,family),true);
   assert.equal(matchesCatalogModel(b,family),true);
  }
 }
});
test('family resolution preserves manufacturer and model number boundaries',()=>{
 assert.equal(relatedModelFamily('Audi','A4L 40 TFSI',directory),'A4');
 assert.equal(relatedModelFamily('Mazda','CX-50 High',directory),'CX-50');
 assert.equal(relatedModelFamily('Audi','A20',directory),'A20');
 assert.equal(relatedModelFamily('Other','A4L',directory),'A4L');
 assert.equal(relatedModelFamily('Honda','フィット RS',directory),'Fit');
 assert.equal(relatedModelFamily('Audi','Unknown Version',directory),'Unknown Version');
 assert.equal(matchesCatalogModel('A5',relatedModelFamily('Audi','A4L',directory)),false);
 assert.equal(matchesCatalogModel('A4','A4L'),false,'explicit catalog filter stays precise');
});
test('bundled directory resolves real Audi, BMW and Mazda model families',async()=>{
 for(const [make,model,base] of [['Audi','A4L','A4'],['Audi','Q2L','Q2'],['BMW','X5M Competition','X5'],['Mazda','CX-5 High','CX-5']])
  assert.equal(await readRelatedModelFamily(make,model),base);
});
test('four-card family rail exposes a sibling even after many current-model candidates',async()=>{
 for(const [model,sibling] of [['A4L','A4'],['A4','A4L']]){
  const current={id:'current',make:'Audi',model,market:'china'};
  const rows=[...Array.from({length:10},(_,i)=>({...current,id:String(i)})),{...current,id:'sibling',model:sibling}];
  const groups=await selectRelatedOfferGroups({current,modelRows:rows,marketRows:[],crossResults:[],greenModels:[],greenRows:[],price:async rows=>rows,renderable:()=>true});
  assert.equal(groups.sameModel.length,4);
  assert.equal(groups.sameModel[0].model,sibling);
 }
});
