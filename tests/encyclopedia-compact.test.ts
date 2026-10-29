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

test('directory migration keeps prior facts and refuses concurrent edits or repeated capture',async()=>{
 const {commitDirectorySnapshot}=await import('../apps/web/lib/encyclopedia/directory-plan');
 const old:any={id:'a',revision:'one',key:'original',make:'Toyota',model:'Corolla'};
 const baseline:any={version:1,models:[old,{id:'archive',revision:'old',key:'keep'}],generationId:'g',capturedAt:'old',updatedAt:'old',coverage:{},savedSearchRows:1};
 const updated={...old,directorySnapshot:{capturedAt:'now',count:123}};
 const result=commitDirectorySnapshot(baseline,baseline,new Map([['a',updated]]),[],'now');
 assert.equal(result.models[0].key,'original');assert.equal(result.models[1],baseline.models[1]);assert.equal(baseline.models[0].directorySnapshot,undefined);
 assert.throws(()=>commitDirectorySnapshot({...baseline,models:[{...old,revision:'two'},baseline.models[1]]},baseline,new Map(),[],'now'),/concurrent_edit/);
 assert.throws(()=>commitDirectorySnapshot(result,baseline,new Map(),[],'later'),/directory_changed/);
 assert.throws(()=>commitDirectorySnapshot(baseline,baseline,new Map(),[old],'now'),/duplicate_directory/);
});

test('presentation aliases and one unambiguous partial observation share a row without rewriting originals',()=>{
 const base:any={id:'complete',year:2026,fuel:'petrol',engineCc:1998,powerHp:252,drive:'awd',transmission:'automatic',bodyType:'suv',markets:[],status:'review',observedCount:1};
 const partial={...base,id:'partial',bodyType:undefined,status:'observed'};
 const alias={...base,id:'alias',fuel:'Бензин',drive:'Полный',transmission:'Автомат',bodyType:'Внедорожник'};
 const before=JSON.stringify([base,partial,alias]);
 assert.deepEqual(mechanicalRows([base,partial,alias]).map(v=>v.id),['complete']);
 assert.equal(JSON.stringify([base,partial,alias]),before);
 assert.equal(mechanicalRows([base,partial,{...base,id:'other',bodyType:'sedan'}]).length,3);
 assert.equal(mechanicalRows([base,{...partial,manualEditedAt:'now'}]).length,2);
 assert.equal(mechanicalRows([base,{...partial,status:'verified'}]).length,2);
});

test('generation, approval identities and per-motor certification never collapse',()=>{
 const base:any={id:'a',year:2026,fuel:'electric',powerHp:252,drive:'awd',markets:[],status:'observed',observedCount:1};
 assert.equal(mechanicalRows([base,{...base,id:'b',generation:'II'},{...base,id:'c',motors30MinKw:'20;30'},{...base,id:'d',astraIdentity:{variant:'different'}}]).length,4);
});

test('alphabet filters canonical makes, and missing fields do not demand ICE values from electric cars',async()=>{
 const {filterModels,directoryLetter}=await import('../apps/web/lib/encyclopedia/query');
 const {missingVariantFields,filterVariants}=await import('../apps/web/lib/encyclopedia/presentation');
 const models:any=[{make:'Toyota',model:'Corolla',fuels:['petrol'],years:[2026],needs30:0},{make:'Abarth',model:'500',fuels:['petrol'],years:[2026],needs30:0}];
 assert.deepEqual(filterModels(models,{letter:'T'}).map(m=>m.make),['Toyota']);
 assert.equal(directoryLetter('212'),'0–9');
 assert.equal(filterModels(models,{letter:'T',year:'2025'}).length,0);
 const ev:any={year:2026,fuel:'electric',power30MinKw:50,status:'review'};
 const ice:any={year:2026,fuel:'petrol',engineCc:1998,powerHp:252,status:'review'};
 assert.deepEqual(missingVariantFields(ev),[]);assert.deepEqual(missingVariantFields(ice),[]);
 assert.deepEqual(missingVariantFields({...ice,powerHp:undefined}),['powerHp']);
 assert.equal(filterVariants([ev,ice,{...ice,powerHp:undefined}],'','missing:powerHp').length,1);
 assert.equal(filterVariants([ev,ice],'','missing30').length,0);
});
