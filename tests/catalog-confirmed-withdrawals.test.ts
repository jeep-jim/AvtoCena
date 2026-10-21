import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedSourceWithdrawalById, isConfirmedSourceWithdrawn } from '../apps/web/lib/catalog/confirmed-source-withdrawals';
import { stableOfferId, projectionCanRenderCard, catalogSearchProjectionMatches, getUnavailableOffer } from '../apps/web/lib/catalog/storage';

test('only exact incident source identities are withdrawn; newer refreshes supersede old evidence',async()=>{
 for(const sourceOfferId of ['EC61409859','EC61402490','EC61398692','EC61401182']) {
  const id=stableOfferId('kcar_korea_open',sourceOfferId);
  const row:any={id,market:'korea',sourceId:'kcar_korea_open',sourceOfferId,updatedAt:'2026-09-13T00:00:00Z'};
  assert.equal(isConfirmedSourceWithdrawn(row),true);
  assert.equal(projectionCanRenderCard(row),false);assert.equal(catalogSearchProjectionMatches(row,{}),false);
  assert.equal(confirmedSourceWithdrawalById(id)?.reason,'sold');assert.equal((await getUnavailableOffer(id))?.reason,'sold');
  assert.equal(isConfirmedSourceWithdrawn({...row,sourceOfferId:'another'}),false);
  assert.equal(isConfirmedSourceWithdrawn({...row,updatedAt:'2026-09-17T00:00:00Z'}),false);
 }
 assert.equal(isConfirmedSourceWithdrawn({id:'unknown',market:'korea'}),false);
 assert.equal(confirmedSourceWithdrawalById('unknown'),null);
 const removedId=stableOfferId('autoscout_europe_open','9e56324e-1c6e-44d8-8525-04f1a5809bad');
 assert.equal(confirmedSourceWithdrawalById(removedId)?.reason,'removed');
});
