import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanicalRows,compactSpecs} from '../apps/web/lib/encyclopedia/compact';
test('equipment names collapse without merging different engines, years or certification values',()=>{
 const base:any={id:'a',year:2025,engineCc:1500,powerHp:150,fuel:'petrol',drive:'fwd',markets:[],status:'observed',observedCount:1};
 const rows=[base,{...base,id:'b',trim:'Luxury'}, {...base,id:'c',drive:'awd'}, {...base,id:'d',year:2024},{...base,id:'e',powerHp:160},{...base,id:'f',power30MinKw:54}];
 assert.equal(mechanicalRows(rows).length,5);assert.equal(rows.length,6);
 assert.equal(compactSpecs(rows).powerHp,'Разные');assert.equal(compactSpecs(rows).power30MinKw,'Разные');
 assert.equal(compactSpecs([base]).power30MinKw,'—');assert.equal(compactSpecs([base]).powerHp,'150');
 assert.equal(compactSpecs([base,{...base,powerHp:undefined}]).powerHp,'Разные');
});
