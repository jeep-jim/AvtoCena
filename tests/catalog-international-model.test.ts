import test from 'node:test';import assert from 'node:assert/strict';
import {internationalModel} from '../apps/web/lib/catalog/international-model';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter';
import {presentCatalogOffer} from '../apps/web/lib/catalog/presentation';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';
test('Haval aliases share international display, old projection search and new imports without copying specs',()=>{
 for(const model of ['First Love','初恋','Julion','Jolion','Джулион','Джолион','Chulian']){
  assert.equal(internationalModel('Haval',model),'Jolion');assert.equal(matchesCatalogModel(model,'Jolion','Haval'),true);
  const offer:any={market:'china',make:'Haval',model,sourceCurrency:'CNY',sourcePrice:88888,engineCc:1497,powerHp:150};
  assert.equal(presentCatalogOffer(offer).title,'Haval Jolion');const normalized=normalizeVehicleOfferSpecs(offer);assert.equal(normalized.model,'Jolion');assert.equal(offer.model,model);assert.equal(normalized.sourcePrice,88888);
 }
 assert.equal(internationalModel('Other','First Love'),'First Love');assert.equal(internationalModel('Haval','Chitu'),'Chitu');assert.equal(internationalModel('Haval','Jolion Pro'),'Jolion Pro');
 assert.equal(matchesCatalogModel('First Love','Джулион','Haval'),true);assert.equal(matchesCatalogModel('First Love','Jolion','Other'),false);
 const row:any={make:'Haval',model:'First Love',market:'china',year:2022};assert.equal(catalogSearchProjectionMatches(row,{make:'Haval',model:'Julion'}),true);
});
