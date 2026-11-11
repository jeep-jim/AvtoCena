import assert from 'node:assert/strict';
import test from 'node:test';
import {crmCustomerKey, groupCrmLeads} from '../apps/web/lib/crm-customer-group';

test('different cars and old client IDs form one account group without losing applications',()=>{
 const clients=[{id:'c1',portalAccountId:'account-a'},{id:'c2',portalAccountId:'account-a'}];
 const leads=[{id:'l1',clientId:'c1',car:'Car A'},{id:'l2',clientId:'c2',car:'Car B'}];
 assert.deepEqual(groupCrmLeads(leads,clients),[leads]);
});
test('normalized Russian phones match but names and empty contacts never merge',()=>{
 assert.equal(crmCustomerKey({id:'a',phone:'8 (999) 111-22-33'}),crmCustomerKey({id:'b',phone:'+79991112233'}));
 assert.notEqual(crmCustomerKey({id:'a',name:'Alex'}),crmCustomerKey({id:'b',name:'Alex'}));
});
test('dealer and authenticated account boundaries remain separate',()=>{
 const base={id:'a',phone:'+79991112233'};
 assert.notEqual(crmCustomerKey({...base,requestedDealerId:'one'}),crmCustomerKey({...base,requestedDealerId:'two'}));
 assert.notEqual(crmCustomerKey({...base,portalAccountId:'one'}),crmCustomerKey({...base,portalAccountId:'two'}));
 assert.notEqual(crmCustomerKey(base),crmCustomerKey({...base,portalAccountId:'one'}));
});
test('existing client and new account application resolve to identical identity',()=>{
 assert.equal(crmCustomerKey({id:'old',portalAccountId:'one',phone:'+79991112233'}),crmCustomerKey({customerAccountId:'one',phone:'+79992223344'}));
});
