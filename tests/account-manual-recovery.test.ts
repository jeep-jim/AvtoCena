import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {writeDataJson,readDataJson,readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {accountPath,phoneAccountId,type CustomerAccount} from '../apps/web/lib/account/auth';
import {createRecoveryRequest,recoveryRequest,recoveryRequests,issueRequestedPassword,finishRecoveryRequest} from '../apps/web/lib/account/manual-recovery';
// @ts-ignore Shared isolated persistence and Next request context.
import {customerAuthHarness} from './helpers/customer-auth-harness.mjs';
const owner:any={id:'owner',displayName:'Владелец',role:'owner',companyId:'dealer_topavto'};
const restricted:any={...owner,id:'manager',role:'manager',permissions:{viewAll:false}};

test('public support request is durable, private, rate limited and never resets or links credentials',async()=>{
 process.env.AUTH_SECRET='manual-request-isolated-test';
 const {handle,state}=await customerAuthHarness();
 state.records.set('auth/users.json',[owner,restricted,{...owner,id:'external',companyId:'dealer_other'}]);
 const request=(body:any,route='recovery-request',origin='https://avtocena.com')=>handle(new Request('https://avtocena.com/api/account/'+route,{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'192.0.2.80'},body:JSON.stringify(body)}));
 const phone='+79991234567';const registered=await request({action:'register',phone,password:'original-test-password',consent:true},'auth');assert.equal(registered.status,200);
 const {account}=await registered.json(),key=accountPath(account.id),before=structuredClone(state.records.get(key));
 assert.equal((await request({phone,email:'owner@example.com',consent:true},'recovery-request','https://untrusted.example')).status,403);
 assert.equal((await request({phone,email:'owner@example.com'})).status,400);
 assert.equal((await request({phone,email:'invalid',consent:true})).status,400);
 const body={phone,email:'Owner@Example.com',consent:true};
 const first=await request(body);assert.equal(first.status,200);assert.deepEqual(await first.json(),{ok:true});
 assert.equal((await request(body)).status,200);
 assert.deepEqual(state.records.get(key),before);
 const rows=[...state.records.entries()].filter(([key]:any)=>key.startsWith('accounts/recovery-requests/items/')).map(([,row]:any)=>row);
 assert.equal(rows.length,1);assert.equal(rows[0].accountId,account.id);assert.equal(rows[0].email,'owner@example.com');
 const notices=state.records.get('crm/notifications.json').filter((n:any)=>n.kind==='recovery');assert.equal(notices.length,1);assert.deepEqual(notices[0].recipientIds,['owner']);assert.match(notices[0].href,new RegExp(account.id));
 assert.deepEqual(await (await request({...body,phone:'+79990000001'})).json(),{ok:true});
 assert.equal((await request(body)).status,200);assert.equal((await request(body)).status,429);
 delete (globalThis as any).__customerAuthTest;
});

test('manual review restricts issuance to owner, preserves email, retries one password, and tracks manual sending',async()=>{
 const cwd=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'manual-recovery-'));fs.mkdirSync(path.join(tmp,'data'));
 const vars=['JSON_STORAGE_DRIVER','AUTH_SECRET'],before=Object.fromEntries(vars.map(k=>[k,process.env[k]]));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='manual-recovery-isolated-secret';resetJsonStorageForTests();
 try{
  await writeDataJson('auth/users.json',[owner,restricted]);
  const phone='+79991230000',id=phoneAccountId(phone),account={id,phone,name:'Покупатель',sessionVersion:0,passwordHash:'initial-hash',email:'original@example.com',emailVerifiedAt:new Date().toISOString(),createdAt:new Date().toISOString()} as CustomerAccount;
  await writeDataJson(accountPath(id),account);
  const row=await createRecoveryRequest(phone,'contact@example.com');assert.equal((await recoveryRequests(id)).length,1);assert.deepEqual(await readDataJson(accountPath(id),null),account);
  await assert.rejects(issueRequestedPassword(restricted,row.id,id,'Проверены номер и прежнее обращение.'));
  await assert.rejects(issueRequestedPassword({...owner,companyId:'dealer_other'},row.id,id,'Проверены номер и прежнее обращение.'));
  await assert.rejects(issueRequestedPassword(owner,row.id,'f'.repeat(64),'Проверены номер и прежнее обращение.'));
  await assert.rejects(finishRecoveryRequest(owner,row.id,'completed','Письмо отправлено.'));
  const issued=await issueRequestedPassword(owner,row.id,id,'Проверены номер и прежнее обращение.');assert.ok(issued.expires>Date.now());assert.equal((await recoveryRequest(row.id))?.status,'issued');
  const repeated=await issueRequestedPassword(owner,row.id,id,'Проверены номер и прежнее обращение.');assert.deepEqual(repeated,issued);
  const changed=await readDataJson<CustomerAccount>(accountPath(id),account);assert.equal(changed.sessionVersion,1);assert.equal(changed.email,account.email);assert.equal(changed.emailVerifiedAt,account.emailVerifiedAt);
  const feed=await readChunkedDataJson('activity/feed.json',[]);assert.equal(JSON.stringify(feed).includes(issued.password),false);assert.equal(JSON.stringify(await recoveryRequest(row.id)).includes(issued.password),false);
  await finishRecoveryRequest(owner,row.id,'completed','Сотрудник отправил письмо вручную.');assert.equal((await recoveryRequest(row.id))?.status,'completed');await assert.rejects(issueRequestedPassword(owner,row.id,id,'Проверены номер и прежнее обращение.'));
  const unknown=await createRecoveryRequest('+79990000009','contact@example.com');assert.equal(unknown.accountId,undefined);await assert.rejects(issueRequestedPassword(owner,unknown.id,id,'Проверены номер и прежнее обращение.'));await finishRecoveryRequest(owner,unknown.id,'rejected','Номер регистрации не найден.');
  const pending=await createRecoveryRequest(phone,'next@example.com');const newer={...changed,sessionVersion:2,passwordRecoveryProof:undefined};await writeDataJson(accountPath(id),newer);await assert.rejects(issueRequestedPassword(owner,pending.id,id,'Проверены номер и прежнее обращение.'));assert.equal((await recoveryRequest(pending.id))?.status,'rejected');assert.deepEqual(await readDataJson(accountPath(id),null),JSON.parse(JSON.stringify(newer)));
 }finally{process.chdir(cwd);for(const k of vars){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}
});
