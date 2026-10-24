import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDirectoryModels,filterModels} from '../apps/web/lib/encyclopedia/query';
import {ajesPaginationCountText} from '../apps/web/lib/catalog/ajes-count-display';
test('brand aliases share headings and old filter links retain every source record',()=>{
 const rows=['Citroen','Citroën','DS','DS Automobiles','Ford-CNG-Technik','FORD-CNG-TECHNIK','Fiat','FIAT-ADRIA'].map((make,i)=>({id:String(i),make,model:'Example',years:[2023],fuels:['petrol'],needs30:0}));
 const view=canonicalDirectoryModels(rows);
 assert.equal(new Set(view.map(r=>r.make)).size,5);
 assert.deepEqual(view.map(r=>r.id),rows.map(r=>r.id));
 assert.equal(rows[1].make,'Citroën');
 assert.equal(filterModels(view as any,{make:'Citroën'}).length,2);
 assert.equal(filterModels(view as any,{make:'DS Automobiles'}).length,2);
 assert.notEqual(view[6].make,view[7].make,'coachbuilder identity is not erased');
});
test('cursor page totals expose the aggregate rather than just the first 24 cards',()=>{
 const s={total:577000,stale:false,upperBound:false,observedAt:'now'};
 assert.match(ajesPaginationCountText(s),/577.*000/);
 assert.match(ajesPaginationCountText(s),/24.*042/);
 assert.match(ajesPaginationCountText({...s,upperBound:true}),/Найдено до/);
 assert.match(ajesPaginationCountText({...s,stale:true}),/последним данным/);
 assert.equal(ajesPaginationCountText(null),'Количество уточняется');
});
