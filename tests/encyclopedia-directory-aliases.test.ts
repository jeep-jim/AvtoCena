import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDirectoryModels,filterModels} from '../apps/web/lib/encyclopedia/query';
import {ajesPaginationCountText} from '../apps/web/lib/catalog/ajes-count-display';
test('brand aliases share headings and old filter links retain every source record',()=>{
 const rows=['Citroen','Citroën','DS','DS Automobiles','Ford-CNG-Technik','FORD-CNG-TECHNIK','Fiat','FIAT-ADRIA'].map((make,i)=>({id:String(i),make,model:'Example',years:[2023],fuels:['petrol'],needs30:0}));
 const view=canonicalDirectoryModels(rows);
 assert.equal(new Set(view.map(r=>r.make)).size,4);
 assert.deepEqual(view.map(r=>r.id),rows.map(r=>r.id));
 assert.equal(rows[1].make,'Citroën');
 assert.equal(filterModels(view as any,{make:'Citroën'}).length,2);
 assert.equal(filterModels(view as any,{make:'DS Automobiles'}).length,2);
 assert.equal(view[6].make,view[7].make);
 assert.equal(view[7].model,'Example (ADRIA)','coachbuilder remains explicit without a duplicate brand');
 assert.equal(rows[7].make,'FIAT-ADRIA','stored technical identity is unchanged');
});
test('cursor page totals expose the aggregate rather than just the first 24 cards',()=>{
 const s={total:577000,stale:false,upperBound:false,observedAt:'now'};
 assert.match(ajesPaginationCountText(s),/577.*000/);
 assert.match(ajesPaginationCountText(s),/24.*042/);
 assert.equal(ajesPaginationCountText({...s,upperBound:true}),'Количество уточняется');
 assert.match(ajesPaginationCountText({...s,stale:true}),/последним данным/);
 assert.equal(ajesPaginationCountText(null),'Количество уточняется');
});

test('service labels are hidden while unfamiliar real brands and record IDs are preserved',()=>{
 const rows=[{id:'placeholder',make:'UEBRIGE (SIEHE TYP)',model:'Type'},
 {id:'real',make:'BINZ',model:'X'},{id:'wey1',make:'GWM - WEY',model:'Coffee 01'},
 {id:'wey2',make:'WEY',model:'Coffee 02'}];
 const view=canonicalDirectoryModels(rows);
 assert.deepEqual(view.map(v=>v.id),['real','wey1','wey2']);
 assert.deepEqual(view.map(v=>v.make),['BINZ','WEY','WEY']);
 assert.equal(rows.length,4);
});

test('hyphenated production brands retain their ordinary model names',()=>{
 const rows=[{make:'Mercedes-Benz',model:'E-Class'},{make:'Mercedes Maybach',model:'S-Class'}];
 assert.deepEqual(canonicalDirectoryModels(rows).map(m=>m.model),['E-Class','S-Class']);
});


test('owner compound-brand selections use parent brands without duplicating multi-selects',async()=>{
 const {catalogBrandFilter,catalogBrandPresentation}=await import('../apps/web/lib/catalog/brands');
 assert.equal(catalogBrandFilter('MERCEDES-ADRIA'),'Mercedes-Benz');
 assert.equal(catalogBrandFilter('PEUGEOT-BRAVIA,Peugeot,PEUGEOT-DANGEL,PEUGEOT-TOURNE'),'Peugeot');
 assert.equal(catalogBrandFilter('RENAULT-SPORT,RENAULT-ADRIA'),'Renault');
 assert.equal(catalogBrandFilter('Mercedes-Benz,Mercedes Maybach'),'Mercedes-Benz,Mercedes-Maybach');
 assert.equal(catalogBrandPresentation('MERCEDES-ADRIA').conversion,'ADRIA');
});

test('electric and hybrid quick filter preserves aliases, missing-power and year filters',()=>{
 const rows=['petrol','electric','hev','phev','Гибрид','diesel','unknown'].map((fuel,i)=>({make:'Toyota',model:String(i),years:[2025],fuels:[fuel],needs30:i===2?1:0}));
 assert.deepEqual(filterModels(rows,{fuel:'electrified'}).map(m=>m.model),['1','2','3','4']);
 assert.deepEqual(filterModels(rows,{fuel:'electrified',missing30:'1'}).map(m=>m.model),['2']);
 assert.deepEqual(filterModels(rows,{fuel:'electrified',year:'2024'}),[]);
 assert.equal(rows[2].fuels[0],'hev');
});
