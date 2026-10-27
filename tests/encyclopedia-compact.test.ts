import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanicalRows,compactSpecs,yearVariants} from '../apps/web/lib/encyclopedia/compact';
import {publicEncyclopediaRecord} from '../apps/web/lib/encyclopedia/public-record';
test('exact year view preserves reviewed equipment IDs while compact UI and public privacy stay intact',()=>{
 const base:any={id:'reviewed-launch',year:2021,engineCc:1490,power30MinKw:37,markets:['korea'],status:'review',observedCount:1,sourceUrl:'private-evidence',notes:'private-notes'};
 const variants=[{...base,id:'trend'},base,{...base,id:'other-year',year:2022},{...base,id:'unknown',year:undefined},{...base,id:'different-power',power30MinKw:38}];
 const before=JSON.stringify(variants);
 assert.deepEqual(yearVariants(variants,'2021').map(v=>v.id),['trend','different-power']);
 const exact=yearVariants(variants,'2021',true);
 assert.deepEqual(exact.map(v=>v.id),['trend','reviewed-launch','different-power']);
 assert.equal(exact.find(v=>v.id==='reviewed-launch')?.power30MinKw,37);
 assert.deepEqual(yearVariants(variants,'unknown',true).map(v=>v.id),['unknown']);
 const publicRecord=publicEncyclopediaRecord({id:'model',make:'Toyota',model:'Yaris',photo:'',revision:'r',updatedAt:'now',variants:exact});
 assert.equal(publicRecord.variants.length,3);
 assert.doesNotMatch(JSON.stringify(publicRecord),/private-evidence|private-notes|sourceUrl|notes/);
 assert.equal(JSON.stringify(variants),before);
});
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
