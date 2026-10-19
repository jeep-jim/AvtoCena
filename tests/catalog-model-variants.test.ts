import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesCatalogModel } from '../apps/web/lib/catalog/model-filter';
import { catalogSearchProjectionMatches } from '../apps/web/lib/catalog/storage';
import { filterGreenCorner } from '../apps/web/lib/catalog/green-corner-search';

test('base model includes versions even when canonical keys are present, in every market', () => {
  for (const market of ['japan', 'china', 'korea', 'uae', 'europe', 'georgia']) {
    for (const model of ['A2', 'A2 1.4', 'A2 quattro', 'A2 Sport']) {
      const row: any = {id:market==='japan'?'green-1':'test', market, make:'Audi', model, year:2021};
      assert.equal(catalogSearchProjectionMatches(row,{make:'Audi',model:'A2'},new Set(['audi:a2'])),true,`${market} ${model}`);
      assert.equal(catalogSearchProjectionMatches(row,{make:'BMW',model:'A2'},new Set(['audi:a2'])),false);
    }
  }
});
test('model aliases expand to versions without leaking across manufacturers', () => {
  const keys = new Set(['toyota:vitZ'.toLowerCase(),'toyota:ヴィッツ']);
  assert.equal(catalogSearchProjectionMatches({id:'green-2',make:'Toyota',model:'Vitz RS',market:'japan'} as any,{model:'Витц'},keys),true);
  assert.equal(catalogSearchProjectionMatches({make:'Other',model:'Vitz RS',market:'japan'} as any,{model:'Витц'},keys),false);
});
test('model separators normalize but neighboring model numbers stay distinct', () => {
  for (const [model,query] of [['A4L 40 TFSI','A4'],['Q2L','Q2'],['X5M Competition','X5'],['CX-5 2.0 High','CX5'],['C HR Hybrid','C-HR'],['A 2 Sport','A2'],['Corolla Cross Hybrid','Corolla']]) assert.equal(matchesCatalogModel(model,query),true);
  for (const [model,query] of [['A20','A2'],['XA2','A2'],['X50','X5'],['CX-50','CX-5'],['A2','A2 quattro']]) assert.equal(matchesCatalogModel(model,query),false);
});
test('green corner includes versions and still respects other filters', () => {
  const rows:any[]=[{id:'1',make:'Audi',model:'A2 Sport',year:2021},{id:'2',make:'Audi',model:'A20',year:2021},{id:'3',make:'Audi',model:'A2',year:2010}];
  assert.deepEqual(filterGreenCorner(rows,{make:'Audi',model:'A2',yearFrom:'2020'}).map(r=>r.id),['1']);
});

test('Honda Step Wagon aliases find source versions in Green Corner and all local markets',()=>{
 const source:any[]=[{id:'base',make:'Honda',model:'STEPWGN',year:2021,powerHp:150},{id:'spada',make:'Honda',model:'STEPWGN SPADA',year:2022,powerHp:160},{id:'high',make:'Honda',model:'STEP WGN AIR',year:2022,powerHp:184},{id:'other',make:'Other',model:'STEPWGN',year:2022},{id:'neighbor',make:'Honda',model:'N-WGN',year:2022}];
 for(const model of ['STEP WAGON','STEPWAGON','STEP WGN','STEPWGN','Степвагон']){
  assert.deepEqual(filterGreenCorner(source,{make:'Honda',model,powerTo:'160'}).map(r=>r.id),['spada','base']);
  for(const market of ['japan','china','korea','uae','europe','georgia']){
   assert.equal(catalogSearchProjectionMatches({...source[0],id:market==='japan'?'green-3':source[0].id,market},{make:'Honda',model}),true,market+' '+model);
  }
 }
 assert.equal(matchesCatalogModel('STEPWGN','STEP WAGON','Other'),false);
 assert.equal(matchesCatalogModel('STEPWGN SPADA','STEP WAGON SPADA','Honda'),true);
 assert.equal(matchesCatalogModel('STEPWGN','STEP WAGON SPADA','Honda'),false);
 assert.equal(source[0].model,'STEPWGN','source identity stays unchanged');
});
