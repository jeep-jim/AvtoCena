import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import webpush from 'web-push';
import {registerPush,flushCrmPush,removePush} from '../apps/web/lib/crm-push';
import {mutateDataJson,appendChunkedDataJson} from '../apps/web/lib/data';
import {resetJsonStorageForTests} from '../apps/web/lib/data';
test('push delivers once, only to authorized accounts; unread is independent; disabled and unsubscribed recipients get nothing',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'crm-push-'));const send=webpush.sendNotification;
 await fs.mkdir(path.join(tmp,"data"));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 const sent:string[]=[];webpush.sendNotification=(async(subscription:any)=>{sent.push(subscription.endpoint);return {statusCode:201,body:'',headers:{}};}) as any;
 try {
  const owner:any={id:'o',role:'owner',displayName:'Owner',telegramUsername:'owner'},manager:any={id:'m',role:'manager',displayName:'Manager',telegramUsername:'manager'},other:any={id:'x',role:'manager',displayName:'Other',telegramUsername:'other'};
  await mutateDataJson('auth/users.json',[],()=>[owner,manager,other]);
  const sub=(id:string)=>({endpoint:`https://fcm.googleapis.com/fcm/send/${id}`,keys:{auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65).toString('base64url')}});
  for(const u of [owner,manager,other])await registerPush(u,sub(u.id));
  await appendChunkedDataJson('leads/leads.json',{id:'lead',createdAt:new Date(Date.now()+1000).toISOString(),assignedManagerId:'m'});
  assert.equal((await flushCrmPush()).sent,2);assert.deepEqual(sent.sort(),[sub('m').endpoint,sub('o').endpoint]);
  assert.equal((await flushCrmPush()).sent,0);
  await removePush('o',sub('o').endpoint);
  await mutateDataJson('auth/users.json',[],()=>[owner,{...manager,status:'disabled'},other]);
  await appendChunkedDataJson('leads/leads.json',{id:'lead2',createdAt:new Date(Date.now()+2000).toISOString(),assignedManagerId:'m'});
  assert.equal((await flushCrmPush()).sent,0);assert.equal(sent.length,2);
 }finally{webpush.sendNotification=send;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();await fs.rm(tmp,{recursive:true,force:true});}
});
