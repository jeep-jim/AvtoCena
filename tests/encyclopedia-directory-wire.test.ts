import test from 'node:test';
import assert from 'node:assert/strict';
import {packDirectory,unpackDirectory,type DirectoryModel} from '../apps/web/lib/encyclopedia/directory-wire';
import {filterModels} from '../apps/web/lib/encyclopedia/query';
test('directory wire preserves year specs and all 4000 models without duplicating shared specs',()=>{
 const specs={fuel:'Бензин',powerHp:'150',engineCc:'1500'};
 const models:DirectoryModel[]=Array.from({length:4000},(_,i)=>({id:String(i),make:i%2?'Toyota':'Audi',model:`Model ${i}`,photo:'',years:[2023,2024],fuels:['petrol'],needs30:0,compact:{all:specs,years:{2023:specs,2024:{...specs,powerHp:'160'}}}}));
 const wire=packDirectory(models),roundtrip=unpackDirectory(wire);assert.deepEqual(roundtrip,models);assert.equal(wire.specs.length,2);assert.ok(JSON.stringify(wire).length<JSON.stringify(models).length*.8);assert.equal(filterModels(roundtrip,{letter:'T',year:'2024',fuel:'petrol'}).length,2000);assert.equal(filterModels(roundtrip,{letter:'T',year:'2020'}).length,0);
});
