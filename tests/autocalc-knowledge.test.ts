import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingKnowledgeModels,knowledgeDraft} from '../apps/web/lib/autocalc/knowledge';
import {memoryObservation,mergeVehicleMemory,MEMORY_MAX_BYTES,MEMORY_MAX_ROWS} from '../apps/web/lib/catalog/knowledge-memory';
import {countCanonicalCatalogModels} from '../apps/web/lib/catalog/canonical-model-counts';
test('exact name wins over another model with the same prefix',()=>{
 const models=[{id:'1',make:'Toyota',model:'Corolla'},{id:'2',make:'Toyota',model:'Corolla Cross'},{id:'3',make:'Peugeot',model:'2008'}];
 assert.deepEqual(matchingKnowledgeModels(models,'Toyota Corolla').map(m=>m.id),['1']);
 assert.deepEqual(matchingKnowledgeModels(models,'Peugeot 2008').map(m=>m.id),['3']);
 assert.equal(matchingKnowledgeModels(models,'Toyota').length,2);
});
test('knowledge never converts hybrid system power to combustion or 30-minute values',()=>{
 const d=knowledgeDraft({year:2023,fuel:'hybrid',engineCc:1800,powerHp:140});
 assert.equal(d.engineCc,'1800');assert.equal(d.powerHp,undefined);assert.equal(d.icePowerHp,undefined);assert.equal(d.power30MinKw,undefined);
});
test('memory compacts duplicates and enforces real stored byte and row limits',()=>{
 const row={id:'offer-1',make:'Peugeot',model:'2008',market:'europe',year:2023,fuel:'petrol',engineCc:1199,powerHp:130,sourcePrice:12000,sourceCurrency:'EUR',updatedAt:'2026-09-27',cardImageUrl:'https://example.com/a.jpg'};
 const a=memoryObservation(row)!;assert.ok(a);assert.equal(memoryObservation({...row,sourceId:'manual_link'}),null);
 const b=memoryObservation({...row,id:'offer-2',sourcePrice:12500})!;assert.equal(a.id,b.id);assert.equal(mergeVehicleMemory([a],[b]).length,1);assert.equal(mergeVehicleMemory([a],[b])[0].price,12500);
 const many=Array.from({length:1000},(_,i)=>({...a,id:String(i),image:'https://example.com/'+String(i).repeat(400)}));
 const merged=mergeVehicleMemory([],many);assert.ok(merged.length<=MEMORY_MAX_ROWS);assert.ok(Buffer.byteLength(JSON.stringify(merged,null,2))<=MEMORY_MAX_BYTES);
 assert.equal((a as any).operational,undefined);
});
test('weighted compact counts preserve totals without expanding offer rows',()=>{
 const r=countCanonicalCatalogModels([{id:'a',make:'Peugeot',model:'2008'}],[{make:'Peugeot',model:'2008',count:174}]);assert.equal(r.counts.Peugeot,174);assert.equal(r.canonicalModelCounts.Peugeot,1);
});
