import test from 'node:test';
import assert from 'node:assert/strict';
import {brandContextQuery,brandSelectionQuery} from '../apps/web/lib/catalog/brand-navigation';
test('brand selection on country routes preserves country, source and filters',()=>{
 for(const market of ['china','korea','japan']){
  const context=brandContextQuery('city=Красноярск&page=4',{market,source:'ajes',fuel:'petrol',yearFrom:'2022',model:'Old'});
  const p=new URLSearchParams(brandSelectionQuery(context,['Toyota']));
  assert.equal(p.get('market'),market);assert.equal(p.get('source'),'ajes');assert.equal(p.get('city'),'Красноярск');assert.equal(p.get('fuel'),'petrol');assert.equal(p.get('yearFrom'),'2022');assert.equal(p.get('make'),'Toyota');assert.equal(p.get('model'),'Old');assert.equal(p.has('page'),false);
  const cleared=new URLSearchParams(brandSelectionQuery(p.toString(),[]));assert.equal(cleared.has('make'),false);assert.equal(cleared.get('market'),market);
 }
});
test('adding or removing a brand retains every unrelated chosen parameter',()=>{
 const original=new URLSearchParams({make:'BMW',model:'X3|Corolla',budget:'1500000',city:'Новокузнецк',sort:'totalRub',powerTo:'160',selection:'1',fuel:'petrol',page:'4',after:'9.2'});
 for(const makes of [['BMW','Toyota'],['Toyota'],[]]){
  const next=new URLSearchParams(brandSelectionQuery(original.toString(),makes));
  for(const key of ['model','budget','city','sort','powerTo','selection','fuel'])assert.equal(next.get(key),original.get(key));
  assert.equal(next.has('after'),false);assert.equal(next.has('page'),false);
 }
});
test('server-resolved route context takes precedence while unrelated query values survive',()=>{
 const p=new URLSearchParams(brandContextQuery('market=korea&dealer=test',{market:'china',make:'Toyota'}));assert.equal(p.get('market'),'china');assert.equal(p.get('dealer'),'test');assert.equal(p.get('make'),'Toyota');
});
