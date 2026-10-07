import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readDataJson,writeDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {accountPath,type CustomerAccount,passwordMatches} from '../apps/web/lib/account/auth';
import {createCustomerChallenge,consumeCustomerChallenge,approvedCustomerChallenge,handleCustomerAccountBot} from '../apps/web/lib/account/telegram';
import {issueTemporaryPassword} from '../apps/web/lib/account/temporary-password';
test('fresh Telegram phone proof recovers without binding, rejects foreign contacts and retries one credential',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,secret=process.env.AUTH_SECRET,temp=fs.mkdtempSync(path.join(os.tmpdir(),'customer-tg-')),originalFetch=globalThis.fetch;
 fs.mkdirSync(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='isolated-recovery-secret';resetJsonStorageForTests();
 const sent:string[]=[];let failPassword=false;globalThis.fetch=async(_u,init)=>{const text=JSON.parse(String(init?.body)).text;if(failPassword&&text.startsWith('Временный пароль')){failPassword=false;throw Error('network failure');}sent.push(text);return Response.json({ok:true,result:{message_id:1}});};
 const a={id:'a'.repeat(64),phone:'+79990001111',name:'Customer',passwordHash:'old',createdAt:new Date().toISOString(),sessionVersion:0} as CustomerAccount;
 const msg=(from:number,body:any)=>({message:{chat:{id:from,type:'private'},from:{id:from},...body}});
 try{
 await writeDataJson(accountPath(a.id),a);const token=await createCustomerChallenge(a,'reset');
 await handleCustomerAccountBot(msg(42,{text:'/start account_'+token}),'test');
 await handleCustomerAccountBot(msg(99,{text:'/start account_'+token}),'test');
 await handleCustomerAccountBot(msg(99,{contact:{user_id:99,phone_number:a.phone}}),'test');
 await handleCustomerAccountBot(msg(42,{contact:{user_id:99,phone_number:a.phone}}),'test');
 await handleCustomerAccountBot(msg(42,{contact:{user_id:42,phone_number:'+79990002222'}}),'test');
 assert.equal((await readDataJson<any>(accountPath(a.id),null)).passwordHash,'old');
 const contact=msg(42,{contact:{user_id:42,phone_number:a.phone}});failPassword=true;await assert.rejects(handleCustomerAccountBot(contact,'test'));
 const first=await readDataJson<any>(accountPath(a.id),null);await handleCustomerAccountBot(contact,'test');const after=await readDataJson<any>(accountPath(a.id),null);
 assert.equal(after.passwordHash,first.passwordHash);assert.equal(after.sessionVersion,1);assert.equal(after.telegramId,undefined);assert.equal(after.email,undefined);const password=sent.find(s=>s.startsWith('Временный пароль'))!.split(': ')[1].split('\n')[0];assert.ok(await passwordMatches(password,after.passwordHash));assert.ok(after.passwordTemporaryUntil>Date.now());
 assert.equal(await handleCustomerAccountBot(contact,'test'),false);await assert.rejects(consumeCustomerChallenge(token,'reset'));await assert.rejects(issueTemporaryPassword(a.id,0,'another-proof'));
 await writeDataJson(accountPath(a.id),{...after,passwordTemporaryUsed:true});await assert.rejects(issueTemporaryPassword(a.id,0,after.passwordRecoveryProof));
 const absent=await createCustomerChallenge(null,'reset');await assert.rejects(consumeCustomerChallenge(absent,'reset'));
 const stored=await readDataJson<any[]>('accounts/telegram-challenges.json',[]);assert.equal(JSON.stringify(stored).includes(token),false);assert.equal(JSON.stringify(after).includes(password),false);
 const emailToken=await createCustomerChallenge(after,'reset','new@example.com');await assert.rejects(approvedCustomerChallenge(emailToken));await handleCustomerAccountBot(msg(42,{text:'/start account_'+emailToken}),'test');await handleCustomerAccountBot(contact,'test');assert.equal((await approvedCustomerChallenge(emailToken)).email,'new@example.com');assert.equal((await readDataJson<any>(accountPath(a.id),null)).email,undefined);await consumeCustomerChallenge(emailToken,'reset');await assert.rejects(approvedCustomerChallenge(emailToken));
 // Explicit opt-in binding still checks both sender and registration phone.
 const bind=await createCustomerChallenge({...after,passwordTemporaryUsed:false},'bind');await handleCustomerAccountBot(msg(42,{text:'/start account_'+bind}),'test');await handleCustomerAccountBot(contact,'test');assert.equal((await readDataJson<any>(accountPath(a.id),null)).telegramId,'42');
 }finally{globalThis.fetch=originalFetch;process.chdir(cwd);for(const [k,v] of Object.entries({JSON_STORAGE_DRIVER:driver,AUTH_SECRET:secret})){if(v===undefined)delete process.env[k];else process.env[k]=v;}resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
