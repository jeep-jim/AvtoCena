import test from 'node:test';
import assert from 'node:assert/strict';
import {savedAjesLots,savedAjesObservation} from '../scripts/encyclopedia/saved-observations';
import {createSnapshotBuilder} from '../apps/web/lib/encyclopedia/snapshot';
import {appendMissingObservations} from '../apps/web/lib/encyclopedia/observations';
import {repairSavedModelMetadata,savedPassengerModel,publishOwnerRequestedModel} from '../scripts/encyclopedia/saved-model-metadata';
const lot={id:'visited-vezel',table:'stats',make:'Honda',model:'Vezel',trim:'Hybrid Z',year:2016,chassisCode:'RU3',engineCc:1500,sourceFuel:'',sourcePower:'132',sourceDrive:'FF',sourceTransmission:'AT'};
test('unknown inventory count has no captured snapshot; repair preserves facts and refuses manual changes',()=>{
 const at='2026-10-31T13:53:42.224Z';const row:any={id:'new',make:'Honda',model:'New',revision:'r',updatedAt:at,variants:[{id:'v',status:'observed',year:2016}],directorySnapshot:{capturedAt:at}};
 const fixed=repairSavedModelMetadata(row,at)!;assert.equal('directorySnapshot' in fixed.record,false);assert.deepEqual(fixed.record.variants,row.variants);assert.equal(fixed.exclude,false);assert.equal(fixed.record.manualCreated,true);
 assert.equal(repairSavedModelMetadata({...row,directorySnapshot:{capturedAt:at,count:0}},at),null);
 assert.throws(()=>repairSavedModelMetadata({...row,editedBy:'owner'},at),/was_edited/);
 assert.equal(repairSavedModelMetadata({...row,make:'KOMATSU'},at)!.exclude,true);
 assert.equal(savedPassengerModel({make:'HITACHI'}),false);assert.equal(savedPassengerModel({make:'Honda'}),true);
});
test('owner-requested imported model stays visible without inventing inventory or verifying observed facts',()=>{
 const at='2026-10-31T13:53:42.224Z';const parent:any={id:'new',make:'Honda',model:'New',revision:'r',updatedAt:at,variants:[{id:'v',status:'observed',year:2016}],directorySnapshot:{capturedAt:at}};
 const {directorySnapshot,...record}=parent;const next=publishOwnerRequestedModel(record,parent,at);
 assert.ok(next.directorySnapshot||next.manualCreated,'same visibility predicate as encyclopedia page');
 assert.equal(next.directorySnapshot,undefined);assert.deepEqual(next.variants,parent.variants);
 assert.throws(()=>publishOwnerRequestedModel({...record,editedBy:'owner'},parent,at),/mismatch/);
 assert.throws(()=>publishOwnerRequestedModel({...record,variants:[{...record.variants[0],year:2017}]},parent,at),/mismatch/);
});
test('visited Japan Hybrid variant survives reconciliation with petrol variants and unknown powers',()=>{
 const builder=createSnapshotBuilder('2026-10-31T12:00:00Z');builder.add(savedAjesObservation(lot));
 const observed=[...builder.models.values()][0].variants;
 assert.equal(observed[0].fuel,'hybrid');assert.equal(observed[0].powerHp,undefined);assert.equal(observed[0].power30MinKw,undefined);assert.equal(observed[0].icePowerKw,undefined);
 const manual:any={id:'staff',year:2016,fuel:'petrol',engineCc:1498,powerHp:131,manualEditedAt:'saved',status:'verified',markets:[],observedCount:0};
 const before=structuredClone(manual),merged=appendMissingObservations([manual],observed);
 assert.equal(merged.length,2);assert.deepEqual(merged[0],before);
 assert.deepEqual(appendMissingObservations(merged,observed),merged,'repeat adds no duplicates');
});
test('both detail and all retained query responses contribute saved variants, never count-only directories',()=>{
 const response={items:[lot]};assert.deepEqual(savedAjesLots(response),[lot]);
 assert.equal(savedAjesLots({hash:'a'.repeat(64),value:{models:[{make:'Honda',model:'Vezel'}]},previous:[{hash:'b'.repeat(64),value:response}]}).length,1);
 assert.deepEqual(savedAjesLots({models:[lot]}),[]);
});
test('source fuel and unknown drive are not overwritten by guesses',()=>{
 assert.equal(savedAjesObservation({...lot,sourceFuel:'P'}).fuel,'petrol');
 assert.equal(savedAjesObservation({...lot,trim:'Z',sourceDrive:'2WD'}).drive,undefined);
 assert.equal(savedAjesObservation({...lot,trim:'Z'}).fuel,undefined);
});
