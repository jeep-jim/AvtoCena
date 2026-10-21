import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import nodemailer from 'nodemailer';
import {writeDataJson,readDataJson,readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {hash,accountPath,registerAccount,type CustomerAccount} from '../apps/web/lib/account/auth';
import {recordCustomerRegistration} from '../apps/web/lib/account/registration-notice';
import {readCrmActivity} from '../apps/web/lib/crm-activity';
import {createEmailChallenge,consumeEmailChallenge,normalizeAccountEmail,emailChallengeMatches,type EmailChallenge} from '../apps/web/lib/account/email';
const owner:any={id:'owner',displayName:'Владелец',role:'owner',companyId:'dealer_topavto'};
const manager:any={...owner,id:'manager',role:'manager',permissions:{activityAll:false}};
async function isolated(run:()=>Promise<void>){const cwd=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'account-fixes-'));fs.mkdirSync(path.join(tmp,'data'));const old=process.env.JSON_STORAGE_DRIVER;process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();try{await writeDataJson('auth/users.json',[owner,manager,{...owner,id:'dealer',companyId:'dealer_other'},{...owner,id:'disabled',status:'disabled'}]);await run();}finally{process.chdir(cwd);if(old===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=old;resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}}
test('registration appears once in common feed and notices, external dealers excluded',()=>isolated(async()=>{
 process.env.AUTH_SECRET='isolated-registration-secret';
 const account=await registerAccount('+79995550123','valid-test-password','Покупатель');await recordCustomerRegistration(account);
 const rows=await readChunkedDataJson<any>('activity/feed.json',[]);assert.equal(rows.length,1);assert.equal(rows[0].type,'customer_registered');
 const notices=await readChunkedDataJson<any>('crm/notifications.json',[]);assert.equal(notices.length,1);assert.deepEqual(notices[0].recipientIds.sort(),['manager','owner']);
 assert.equal((await readCrmActivity(manager)).some(x=>x.id===rows[0].id),true);
 await assert.rejects(registerAccount(account.phone,'valid-test-password','Duplicate'));
 assert.equal((await readChunkedDataJson('crm/notifications.json',[])).length,1);
}));
test('email normalizes addresses and challenges reject wrong, expired, exhausted and used codes',()=>{
 assert.equal(normalizeAccountEmail(' User@Example.COM '),'user@example.com');assert.throws(()=>normalizeAccountEmail('bad\r\nBcc: x@example.com'));
 const token='a'.repeat(48),code='123456';const c:EmailChallenge={tokenHash:hash(token),codeHash:hash(token+':'+code),accountId:'b'.repeat(64),email:'a@example.com',kind:'reset',version:0,attempts:0,expires:Date.now()+10000};
 assert.equal(emailChallengeMatches(c,token,code,'reset'),true);
 for(const invalid of [{...c,used:true},{...c,expires:0},{...c,attempts:5}])assert.equal(emailChallengeMatches(invalid,token,code,'reset'),false);
 assert.equal(emailChallengeMatches(c,token,'999999','reset'),false);assert.equal(emailChallengeMatches(c,token,code,'bind'),false);
});
test('mail reset sends only to a previously verified matching address; binding and consumption isolate owners',()=>isolated(async()=>{
 const vars=['ACCOUNT_SMTP_HOST','ACCOUNT_SMTP_USER','ACCOUNT_SMTP_PASSWORD','ACCOUNT_MAIL_FROM'];const before=Object.fromEntries(vars.map(k=>[k,process.env[k]]));for(const k of vars)process.env[k]='test';
 const original=nodemailer.createTransport;const sent:any[]=[];(nodemailer as any).createTransport=()=>({sendMail:async(m:any)=>{sent.push(m);},close(){}});
 try{
  const a={id:'b'.repeat(64),sessionVersion:0,email:'a@example.com',emailVerifiedAt:new Date().toISOString()} as CustomerAccount;
  await createEmailChallenge(a,'other@example.com','reset');await createEmailChallenge(null,'a@example.com','reset');assert.equal(sent.length,0);
  const token=await createEmailChallenge(a,'a@example.com','reset');assert.equal(sent.length,1);const code=sent[0].text.match(/\b\d{6}\b/)[0];
  await assert.rejects(consumeEmailChallenge(token,code,'bind'));const c=await consumeEmailChallenge(token,code,'reset');assert.equal(c.accountId,a.id);await assert.rejects(consumeEmailChallenge(token,code,'reset'));
  const bind=await createEmailChallenge(a,'new@example.com','bind'),bindCode=sent[1].text.match(/\b\d{6}\b/)[0];await assert.rejects(consumeEmailChallenge(bind,bindCode,'bind','wrong'));assert.equal((await consumeEmailChallenge(bind,bindCode,'bind',a.id)).email,'new@example.com');
 }finally{(nodemailer as any).createTransport=original;for(const k of vars){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
}));
