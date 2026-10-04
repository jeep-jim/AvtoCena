import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readDataJson,writeDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {accountPath,type CustomerAccount,hash} from '../apps/web/lib/account/auth';
import {createCustomerChallenge,consumeCustomerChallenge,handleCustomerAccountBot} from '../apps/web/lib/account/telegram';
test('Telegram recovery requires the bound sender and one-use approval; contact must belong to sender and match phone',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'customer-tg-')),fetch=globalThis.fetch;
 fs.mkdirSync(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:1}});
 const a={id:'a'.repeat(64),phone:'+79990001111',name:'Customer',passwordHash:'test',createdAt:new Date().toISOString(),sessionVersion:0} as CustomerAccount;
 const msg=(from:number,body:any)=>({message:{chat:{id:from,type:'private'},from:{id:from},...body}});
 try{
  await writeDataJson(accountPath(a.id),a);const token=await createCustomerChallenge(a,'bind');
  await handleCustomerAccountBot(msg(42,{text:'/start account_'+token}),'test');
  await handleCustomerAccountBot(msg(42,{contact:{user_id:99,phone_number:a.phone}}),'test');assert.equal((await readDataJson<any>(accountPath(a.id),null)).telegramId,undefined);
  await handleCustomerAccountBot(msg(42,{contact:{user_id:42,phone_number:'+79990002222'}}),'test');assert.equal((await readDataJson<any>(accountPath(a.id),null)).telegramId,undefined);
  await handleCustomerAccountBot(msg(42,{contact:{user_id:42,phone_number:a.phone}}),'test');const bound=await readDataJson<any>(accountPath(a.id),null);assert.equal(bound.telegramId,'42');assert.ok(bound.phoneVerifiedAt);
  const reset=await createCustomerChallenge(bound,'reset');await assert.rejects(consumeCustomerChallenge(reset,'reset'));
  const callback=(id:number)=>({callback_query:{from:{id},message:{chat:{id,type:'private'}},data:'account_ok:'+hash(reset).slice(0,32)}});
  await handleCustomerAccountBot(callback(99),'test');await assert.rejects(consumeCustomerChallenge(reset,'reset'));
  await handleCustomerAccountBot(callback(42),'test');assert.equal((await consumeCustomerChallenge(reset,'reset')).accountId,a.id);await assert.rejects(consumeCustomerChallenge(reset,'reset'));
  const absent=await createCustomerChallenge(null,'reset');await assert.rejects(consumeCustomerChallenge(absent,'reset'));
  const stored=await readDataJson<any[]>('accounts/telegram-challenges.json',[]);assert.equal(JSON.stringify(stored).includes(reset),false);
  assert.equal(await handleCustomerAccountBot(msg(42,{text:'Обычное сообщение'}),'test'),false);
 }finally{globalThis.fetch=fetch;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
