import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredClientAccount} from '../apps/web/lib/account/crm-registration';
import {phoneAccountId,accountPath} from '../apps/web/lib/account/auth';
process.env.AUTH_SECRET='crm-avatar-test';
test('registration before or after the lead is visible without changing portal ownership',async()=>{
 const client={id:'client',phone:'8 (999) 123-45-67',createdAt:'2026-01-01'};
 const id=phoneAccountId('+79991234567');let account:any=null;
 const read=async(path:string)=>{assert.equal(path,accountPath(id));return account;};
 assert.equal(await registeredClientAccount(client,read),null);
 account={id,phone:'+79991234567',createdAt:'2026-10-07',avatarId:'character-1'};
 assert.equal((await registeredClientAccount(client,read))?.avatarId,'character-1');
 account.createdAt='2025-01-01';assert.equal((await registeredClientAccount(client,read))?.id,id);
 assert.equal('portalAccountId' in client,false);
 account.disabled=true;assert.equal(await registeredClientAccount(client,read),null);
});
test('explicit owner takes precedence; deleted clients and ambiguous names cannot match',async()=>{
 const id='b'.repeat(64);const account:any={id,phone:'+79990000000'};
 assert.equal((await registeredClientAccount({portalAccountId:id,phone:'+79991234567'},async path=>{assert.equal(path,accountPath(id));return account;}))?.id,id);
 assert.equal(await registeredClientAccount({fio:'Иван',telegram:'ivan'},async()=>{throw Error('must not read by name');}),null);
 assert.equal(await registeredClientAccount({deletedAt:'now',portalAccountId:id},async()=>account),null);
 assert.equal(await registeredClientAccount({portalAccountId:'bad',phone:'+79991234567'},async()=>account),null);
 assert.equal(await registeredClientAccount({phone:'+79991234567'},async()=>account),null);
});
