import test from 'node:test';
import assert from 'node:assert/strict';
import {brandContextQuery,brandSelectionQuery} from '../apps/web/lib/catalog/brand-navigation';
test('brand selection on country routes preserves country, source and filters',()=>{
 for(const market of ['china','korea','japan']){
  const context=brandContextQuery('city=Красноярск&page=4',{market,source:'ajes',fuel:'petrol',yearFrom:'2022',model:'Old'});
  const p=new URLSearchParams(brandSelectionQuery(context,['Toyota']));
  assert.equal(p.get('market'),market);assert.equal(p.get('source'),'ajes');assert.equal(p.get('city'),'Красноярск');assert.equal(p.get('fuel'),'petrol');assert.equal(p.get('yearFrom'),'2022');assert.equal(p.get('make'),'Toyota');assert.equal(p.has('model'),false);assert.equal(p.has('page'),false);
  const cleared=new URLSearchParams(brandSelectionQuery(p.toString(),[]));assert.equal(cleared.has('make'),false);assert.equal(cleared.get('market'),market);
 }
});
test('server-resolved route context takes precedence while unrelated query values survive',()=>{
 const p=new URLSearchParams(brandContextQuery('market=korea&dealer=test',{market:'china',make:'Toyota'}));assert.equal(p.get('market'),'china');assert.equal(p.get('dealer'),'test');assert.equal(p.get('make'),'Toyota');
});
