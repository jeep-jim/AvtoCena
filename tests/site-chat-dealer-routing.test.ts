import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {siteRule,siteVisibilityCss,normalizeSiteControls} from '../apps/web/lib/site-controls';
import {defaultDealerTelegram,targetForLead,saveDealerTelegram,readDealerTelegram} from '../apps/web/lib/dealers/telegram-settings';
import {chatList,chatDetail,createDirectChat,sendChatMessage} from '../apps/web/lib/crm-chat';
import {writeDataJson,readChunkedDataJson,updateChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {claimCrmNotices,authorizeCrmNotice} from '../apps/web/lib/crm-relay';
import type {AuthUser} from '../apps/web/lib/auth';
const owner={id:'owner-test',displayName:'Владелец',role:'owner',companyId:'dealer_topavto'} as AuthUser;
const manager={...owner,id:'manager-test',displayName:'Сотрудник',role:'manager',crmPermissions:{viewAll:false,editLeads:true}} as AuthUser;
const third={...manager,id:'third-test'} as AuthUser;
async function isolated(run:()=>Promise<void>){const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'crm-chat-'));fs.mkdirSync(path.join(tmp,'data'));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();try{await writeDataJson('auth/users.json',[owner,manager,third]);await run();}finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}}
test('device visibility keeps defaults, validates switches and isolates phone from desktop',()=>{
 assert.equal(siteRule({},'partners').desktop,false);assert.equal(siteRule({},'catalog').desktop,true);
 const features={partnersEnabled:true,siteControls:normalizeSiteControls({partners:{desktop:true,mobile:false,title:' Текст '}})};
 assert.equal(siteRule(features,'partners').title,'Текст');const css=siteVisibilityCss(features);assert.match(css,/@media\(max-width:767px\)/);assert.doesNotMatch(css,/@media\(min-width:768px\).*partners/);assert.throws(()=>normalizeSiteControls({catalog:{desktop:'false',mobile:true}}));
});
test('dealer routing has no platform fallback, reserves group ownership, migrates queued targets and revokes old lease',()=>isolated(async()=>{
 assert.equal(targetForLead({requestedDealerId:'dealer_other'},{}),null);
 await writeDataJson('dealers/dealers.json',[{id:'dealer_topavto',status:'verified'},{id:'dealer_other',status:'verified'}]);
 const pilot=defaultDealerTelegram('dealer_topavto');await assert.rejects(saveDealerTelegram('dealer_other',{...pilot,version:0}),/другой компании/);
 const other={...defaultDealerTelegram('dealer_other'),enabled:true,chatId:'-100999999999',title:'Другой дилер'};await saveDealerTelegram('dealer_other',other);
 const now=new Date().toISOString();await writeDataJson('leads/leads.json',Array.from({length:6},(_,i)=>({id:`unconnected-${i}`,requestedDealerId:'dealer_missing',notificationRequestedAt:now})).concat([{id:'foreign',requestedDealerId:'dealer_other',notificationRequestedAt:now}]));
 const claims=await claimCrmNotices();assert.equal(claims.length,1);assert.equal(claims[0].chatId,other.chatId);assert.equal(claims[0].targetTitle,other.title);assert.match(claims[0].url,/dealer-cabinet$/);
 await saveDealerTelegram('dealer_other',{...await readDealerTelegram('dealer_other'),chatId:'-100888888888'});
 assert.equal(await authorizeCrmNotice(claims[0].id,claims[0].token),false);
}));
test('private team chat protects membership, rejects external accounts and deduplicates retry',()=>isolated(async()=>{
 const {id}=await createDirectChat(owner,manager.id);
 assert.equal((await createDirectChat(manager,owner.id)).id,id);
 await assert.rejects(chatDetail(third,id),/chat_forbidden/);
 await assert.rejects(chatList({...owner,companyId:'dealer_other'}),/chat_forbidden/);
 await assert.rejects(createDirectChat(owner,'unknown'),/chat_forbidden/);
 const input={text:'Внутренний текст',operationId:'operation-123456'};
 await sendChatMessage(owner,id,input);await sendChatMessage(owner,id,input);
 assert.equal((await chatDetail(manager,id)).messages.length,1);
 assert.equal((await readChunkedDataJson('telegram/crm-outbox.json',[])).length,0);
 await assert.rejects(sendChatMessage(owner,id,{...input,text:'Другой текст'}),/message_conflict/);
 await assert.rejects(sendChatMessage(owner,id,{text:'x'.repeat(3001),operationId:'operation-1234567'}),/invalid_message/);
 await writeDataJson('auth/users.json',[owner,{...manager,status:'disabled'},third]);await assert.rejects(chatDetail(owner,id),/chat_forbidden/);
}));
test('customer replies require visible active own lead and connection; retry queues once; reassignment removes access',()=>isolated(async()=>{
 await writeDataJson('leads/leads.json',[{id:'lead-a',name:'Клиент',assignedManagerId:manager.id,telegramChatId:'12345'},{id:'no-tg',assignedManagerId:manager.id},{id:'external',requestedDealerId:'dealer_other',telegramChatId:'23456'}]);
 const input={text:'Ответ клиенту',operationId:'customer-operation-123'};
 await sendChatMessage(manager,'lead:lead-a',input);await sendChatMessage(manager,'lead:lead-a',input);
 const queue=await readChunkedDataJson<any>('telegram/crm-outbox.json',[]);assert.equal(queue.length,1);assert.equal(queue[0].chatId,'12345');assert.equal(queue[0].audience,'customer');
 await assert.rejects(sendChatMessage(manager,'lead:no-tg',input),/chat_forbidden/);
 await assert.rejects(sendChatMessage(owner,'lead:external',input),/chat_forbidden/);
 await updateChunkedDataJson<any>('leads/leads.json','lead-a',l=>({...l,assignedManagerId:third.id}));
 await assert.rejects(chatDetail(manager,'lead:lead-a'),/chat_forbidden/);
 await updateChunkedDataJson<any>('leads/leads.json','lead-a',l=>({...l,archivedAt:new Date().toISOString()}));
 await assert.rejects(sendChatMessage(owner,'lead:lead-a',input),/chat_forbidden/);
}));
