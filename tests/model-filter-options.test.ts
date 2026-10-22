import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFilterModels} from '../apps/web/lib/catalog/model-filter-options';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter';
import {resolveAjesModelNames} from '../apps/web/lib/catalog/ajes-model-resolution';
const names=['Kona','Kona N','Kona AWD','Kona Electric','Kona (Stop/Start)','Kona AWD (Stop/Start)','Kona Electric Long Range','Kona Electric (17" Wheels)','Kona Electric (19" Wheels)'];
test('one Kona option selects every source variant',()=>{
 const rows=names.map(model=>({make:'Hyundai',model,aliases:[]}));const options=groupFilterModels(rows);
 assert.equal(options.length,1);assert.equal(options[0].model,'Kona');
 for(const model of names)assert.equal(matchesCatalogModel(model,options[0].model,'Hyundai'),true);
 assert.deepEqual(new Set(resolveAjesModelNames('Kona',rows,'Hyundai').split('|')),new Set(names));
 assert.deepEqual(new Set(options[0].aliases),new Set(names));
});
test('a trim-only search still returns a base model and preserves multiword names',()=>{
 assert.equal(groupFilterModels([{make:'Hyundai',model:'Kona Electric Long Range',aliases:[]}])[0].model,'Kona');
 assert.equal(groupFilterModels([{make:'Toyota',model:'Land Cruiser Prado',aliases:[]}])[0].model,'Land Cruiser Prado');
});
test('numeric models and different makes stay separate',()=>{
 const rows=[['Audi','A2'],['Audi','A20'],['BMW','X5'],['BMW','X50'],['Hyundai','Kona'],['Other','Kona']].map(([make,model])=>({make,model,aliases:[]}));
 assert.equal(groupFilterModels(rows).length,6);
});
