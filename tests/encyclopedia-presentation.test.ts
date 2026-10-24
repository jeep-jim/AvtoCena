import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldGroups,editorFieldGroups,filterVariants,astraDetails} from '../apps/web/lib/encyclopedia/presentation';
import {textFields,numberFields,type Variant} from '../apps/web/lib/encyclopedia/schema';

test('compact table keeps every editable specification available exactly once in its details',()=>{
 const fields=editorFieldGroups.flatMap(g=>[...g.fields]);
 assert.equal(new Set(fields).size,fields.length);
 assert.deepEqual([...fields].sort(),[...textFields,...numberFields].sort());
});

test('modification filters combine text, top-level fuel and verification without using country',()=>{
 const variants:Variant[]=[
  {id:'a',markets:['japan'],status:'verified',observedCount:1,trim:'Touring',chassisCode:'ABC-12',engineCode:'E20',year:2025,fuel:'Petrol hybrid',power30MinKw:40},
  {id:'b',markets:['china'],status:'observed',observedCount:1,trim:'Touring',chassisCode:'ABC-12',engineCode:'E20',year:2024,fuel:'petrol'},
  {id:'c',markets:[],status:'review',observedCount:1,fuel:'electric',motorPeakKw:200},
 ];
 assert.deepEqual(filterVariants(variants,' abc-12 ','verified').map(v=>v.id),['a']);
 assert.deepEqual(filterVariants(variants,'E20','',{fuel:'hybrid'}).map(v=>v.id),['a']);
 assert.deepEqual(filterVariants(variants,'2024','review').map(v=>v.id),['b']);
 assert.deepEqual(filterVariants(variants,'','',{missing30:true}).map(v=>v.id),['c']);
 assert.deepEqual(filterVariants(variants,'','missing30',{fuel:'petrol'}),[]);
 assert.equal(variants[2].power30MinKw,undefined,'peak power is never promoted to certified power');
 assert.equal(variants.length,3,'filtering does not remove stored records');
});

test('official approval identity is searchable without promoting manufacture years to model years',()=>{
 const v:Variant={id:'astra',markets:[],status:'review',observedCount:0,astraIdentity:{approval:'e6*0437',variant:'MXPH11'},astraEvidence:{manufactureYears:[2024,2021,2024]}};
 assert.equal(filterVariants([v],'e6*0437','').length,1);
 assert.equal(filterVariants([v],'MXPH11','').length,1);
 assert.equal(v.year,undefined);
 assert.deepEqual(astraDetails(v).at(-1),{label:'Годы изготовления',value:'2021, 2024'});
});
