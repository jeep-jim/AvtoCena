import test from 'node:test';
import assert from 'node:assert/strict';
import {koreaExistingSearch} from '../apps/web/lib/catalog/korea-existing-search';
test('Korea existing Audi search retains every selected filter and resets only pagination/source',()=>{
 const p={market:'korea',source:'ajes',make:'Audi',model:'A6',city:'novokuznetsk',engineFrom:'1.5',engineTo:'2000',powerTo:'265',fuel:'petrol|diesel',transmission:'automatic|cvt',drive:'awd|fwd',bodyType:'sedan',budgetTo:'5000000',yearFrom:'2021',mileageTo:'90000',sort:'totalRub',page:'3',after:'old-cursor'};
 const {query,href}=koreaExistingSearch(p),u=new URL(href,'https://avtocena.com');
 assert.equal(query.market,'korea');assert.equal(query.source,'existing');assert.equal(query.make,'Audi');assert.equal(query.model,'A6');assert.equal(query.engineFrom,1500);assert.equal(query.engineTo,2000);assert.equal(query.powerTo,265);assert.equal(query.budgetTo,5000000);assert.equal(query.mileageTo,90000);assert.equal(query.page,1);
 for(const k of ['make','model','city','fuel','transmission','drive','bodyType','budgetTo','yearFrom','mileageTo','sort'])assert.equal(u.searchParams.get(k),p[k as keyof typeof p]);
 assert.equal(u.searchParams.get('source'),'existing');assert.equal(u.searchParams.has('after'),false);assert.equal(u.searchParams.has('page'),false);
});
test('legacy aliases are accepted and invalid numbers do not create a new restriction',()=>{
 const {query}=koreaExistingSearch({brand:'Audi',model:'A6',budget:'3000000',body:'sedan',powerTo:'invalid'});
 assert.equal(query.make,'Audi');assert.equal(query.budgetTo,3000000);assert.equal(query.bodyType,'sedan');assert.equal(query.powerTo,undefined);
});
