import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogConfirmedWithdrawalIndex,catalogOfferWithdrawnByReport} from '../apps/web/lib/catalog/source-retention';

test('China removal evidence cannot hide a later confirmed reappearance or another source/market',()=>{
 const removal={id:'31be31a8b10c5979aed659d0',sourceId:'autohome_used_china_open',sourceOfferId:'123',market:'china',status:'removed',observedAt:'2026-10-22T03:10:29.879+03:00'};
 const index=catalogConfirmedWithdrawalIndex([{report:{confirmedWithdrawals:[removal]}}],'china');
 const old={id:removal.id,sourceId:removal.sourceId,sourceOfferId:removal.sourceOfferId,market:'china' as const,operational:{lastSeenAt:'2026-10-21T00:00:00Z'}};
 assert.equal(catalogOfferWithdrawnByReport(old,index),true);
 assert.equal(catalogOfferWithdrawnByReport({...old,operational:{lastSeenAt:'2026-11-16T23:57:09.965Z'}},index),false);
 assert.equal(catalogOfferWithdrawnByReport({...old,market:'korea'},index),false);
 assert.equal(catalogOfferWithdrawnByReport({...old,sourceOfferId:'other'},index),false);
 assert.equal(catalogOfferWithdrawnByReport({...old,sourceId:'autohome_new_china_open'},index),false);
 assert.equal(catalogOfferWithdrawnByReport({...old,id:'another'},index),false);
 const failure=catalogConfirmedWithdrawalIndex([{report:{confirmedWithdrawals:[{...removal,status:'request_failed'}]}}],'china');
 assert.equal(catalogOfferWithdrawnByReport(old,failure),false);
});
