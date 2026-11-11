import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery,ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {japanExcludedMake} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {catalogBrandMatches} from '../apps/web/lib/catalog/brands';
test('Japan exclusion applies before aggregate counts and to direct lots',()=>{
 for(const make of ['FRUEHAUF','GM','HINO','HITACHI','KOMATSU','OTHERS','SUMITOMO','TADANO','TCM','TRAILER']){
  assert.equal(japanExcludedMake(make),true);
  for(const aggregate of ['count','makes','models'] as const)assert.ok(ajesQuery({table:'stats',aggregate}).sql.includes("'"+make+"'"));
  assert.equal(ajesLot({ID:'1',MARKA_NAME:make,MODEL_NAME:'OTHER',YEAR:2020},'stats',true),null);
 }
 for(const make of ['Toyota','Honda','Isuzu','Mitsuoka'])assert.equal(japanExcludedMake(make),false);
 assert.ok(!ajesQuery({table:'korea'}).sql.includes("'SUMITOMO'"));
});
test('Russian brand queries find Hyundai without changing vehicle identity',()=>{
 for(const query of ['хёндай','хендай','хендэ','HYUNDAI','хюндай'])assert.equal(catalogBrandMatches('Hyundai',query),true);
 assert.equal(catalogBrandMatches('Honda','хёндай'),false);
});
