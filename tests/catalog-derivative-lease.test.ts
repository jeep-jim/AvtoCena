import assert from 'node:assert/strict';
import test from 'node:test';
import {assertCatalogDerivativeLease, type CatalogRepairLease} from '../apps/web/lib/catalog/publication-lease';
import {withCatalogReadModelRepairLock} from '../scripts/lib/catalog-read-model-repair-lock.mjs';
const owner: CatalogRepairLease = {operationId:'read-model-repair-test',operationType:'catalog_read_model_repair',startedAt:new Date(0).toISOString(),lockedUntil:new Date(60000).toISOString()};
test('nested build accepts only its exact live repair lease',()=>{
 assert.doesNotThrow(()=>assertCatalogDerivativeLease(owner,owner,'test',1));
 for(const current of [null,{...owner,operationId:'other'},{...owner,startedAt:new Date(1).toISOString()},{...owner,lockedUntil:new Date(70000).toISOString()},{...owner,operationType:'other'},{...owner,lockedUntil:''}]) {
  assert.throws(()=>assertCatalogDerivativeLease(current as any,owner,'test',1),/lease_lost/);
 }
 assert.throws(()=>assertCatalogDerivativeLease(owner,owner,'test',60000),/lease_lost/);
 assert.throws(()=>assertCatalogDerivativeLease({...owner,lockedUntil:'bad'},owner,'test',1),/lock_invalid/);
});
test('standalone builds still reject active or malformed locks',()=>{
 assert.doesNotThrow(()=>assertCatalogDerivativeLease(null,undefined,'test',1));
 assert.doesNotThrow(()=>assertCatalogDerivativeLease(owner,undefined,'test',60000));
 assert.throws(()=>assertCatalogDerivativeLease(owner,undefined,'test',1),/in_progress/);
 assert.throws(()=>assertCatalogDerivativeLease({...owner,lockedUntil:'bad'},undefined,'test',1),/lock_invalid/);
});
test('repair passes the CAS-acquired lease and refuses malformed retained leases',async()=>{
 let value:any={};
 const mutate=async(_p:any,_f:any,fn:any)=>(value=fn(value));
 await withCatalogReadModelRepairLock(mutate,async(lease:any)=>{
  assert.deepEqual(lease,value);assert.ok(Object.isFrozen(lease));
  assert.doesNotThrow(()=>assertCatalogDerivativeLease(value,lease,'nested',1));
 },()=>0);
 assert.equal(value.lockedUntil,'');
 value={lockedUntil:'bad'};
 await assert.rejects(withCatalogReadModelRepairLock(mutate,()=>assert.fail('must not run')),/lock_invalid/);
 assert.deepEqual(value,{lockedUntil:'bad'});
});
