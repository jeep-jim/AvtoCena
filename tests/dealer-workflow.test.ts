import test from 'node:test';
import assert from 'node:assert/strict';
import {dealerLeadView,hasContactResult} from '../apps/web/lib/dealers/lead-workflow';
import {EMPTY_MEMBERSHIP,dealerCommissionPercent,dealerAccessLevel,remunerationCommission,addMonths} from '../apps/web/lib/dealers/program-model';
import {confirmedCustomerContract} from '../apps/web/lib/account/access';
test('contacts and free text are not serialized before disclosure; other tenants get nothing',()=>{
 const lead={id:'l',requestedDealerId:'dealer_a',name:'private name',phone:'private phone',car:'private contact in car',comment:'private comment',offerSnapshot:{phone:'secret'},documents:[{url:'secret'}]};
 assert.equal(dealerLeadView(lead,'dealer_b'),null);
 assert.equal(JSON.stringify(dealerLeadView(lead,'dealer_a')).includes('private'),false);
 assert.equal(JSON.stringify(dealerLeadView({...lead,assignedManagerId:'m'},'dealer_a')).includes('private'),false);
 const open=dealerLeadView({...lead,assignedManagerId:'m',platformTerms:{agreementDigest:'a'}},'dealer_a');assert.equal(open?.phone,lead.phone);assert.equal('offerSnapshot' in open!,false);
 assert.equal(dealerLeadView({...lead,archivedAt:'now'},'dealer_a'),null);
});
test('trial and paid are 10%, explicit commission-only 15%, expired cannot quote new commission',()=>{
 const now=new Date('2026-10-07'),trial={...EMPTY_MEMBERSHIP,trialEndsAt:'2026-11-07'};
 assert.equal(dealerCommissionPercent(trial,now),10);assert.equal(dealerCommissionPercent({...EMPTY_MEMBERSHIP,paidUntil:'2026-11-07'},now),10);
 assert.equal(dealerCommissionPercent(EMPTY_MEMBERSHIP,now),null);
 const commission={...EMPTY_MEMBERSHIP,plan:'commission' as const,agreement:{approvedAt:'2026-10-01'} as any};assert.equal(dealerCommissionPercent(commission,now),15);assert.equal(dealerAccessLevel('external',commission,now).full,true);
 assert.equal(dealerCommissionPercent({...commission,agreement:undefined},now),null);
 assert.equal(remunerationCommission(150000,10),15000);assert.equal(remunerationCommission(150000,15),22500);assert.throws(()=>remunerationCommission(NaN,10));assert.throws(()=>remunerationCommission(150000,100));
 assert.equal(addMonths(new Date('2027-01-31'),1).toISOString().slice(0,10),'2027-02-28');
});
test('client acknowledgement is required for new dealer confirmations, legacy contracts retained',()=>{
 const c={documents:[{id:'d',customerVisible:true}],portalContracts:{l:{documentId:'d',confirmedBy:'m',confirmedAt:'2026-10-07',requiresCustomerConfirmation:true}}};
 assert.equal(confirmedCustomerContract(c,'l'),null);assert.ok(confirmedCustomerContract({...c,portalContracts:{l:{...c.portalContracts.l,customerConfirmedAt:'2026-10-07'}}},'l'));
 assert.ok(confirmedCustomerContract({...c,portalContracts:{l:{...c.portalContracts.l,requiresCustomerConfirmation:false}}},'l'));assert.equal(confirmedCustomerContract(undefined,'l'),null);
 assert.equal(hasContactResult({assignedManagerId:'m',dealerContactResult:'waiting'}),true);assert.equal(hasContactResult({dealerContactResult:'contacted'}),false);
});
