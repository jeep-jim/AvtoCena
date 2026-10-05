import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {siteRule,siteVisibilityCss,normalizeSiteControls} from '../apps/web/lib/site-controls';
import {offerLeadDealerIds} from '../apps/web/lib/dealers/lead-routing';
import {defaultDealerTelegram,targetForLead,saveDealerTelegram,readDealerTelegram} from '../apps/web/lib/dealers/telegram-settings';
import {chatList,chatDetail,createDirectChat,sendChatMessage,createChatRoom,updateChatRoom,reactToChatMessage,changeChatMessage,forwardChatMessage} from '../apps/web/lib/crm-chat';
import {writeDataJson,readChunkedDataJson,updateChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {claimCrmNotices,authorizeCrmNotice} from '../apps/web/lib/crm-relay';
import type {AuthUser} from '../apps/web/lib/auth';
const owner={id:'owner-test',displayName:'Владелец',role:'owner',companyId:'dealer_topavto'} as AuthUser;
const manager={...owner,id:'manager-test',displayName:'Сотрудник',role:'manager',permissions:{viewAll:false,editLeads:true}} as AuthUser;
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
 const claims=await claimCrmNotices();assert.equal(claims.length,1);assert.equal(claims[0].chatId,other.chatId);assert.equal(claims[0].targetTitle,other.title);assert.match(claims[0].url,/dealer-cabinet\/leads\?id=foreign$/);
 await saveDealerTelegram('dealer_other',{...await readDealerTelegram('dealer_other'),chatId:'-100888888888'});
 assert.equal(await authorizeCrmNotice(claims[0].id,claims[0].token),false);
 const rerouted=await claimCrmNotices();assert.equal(rerouted[0].chatId,"-100888888888");assert.notEqual(rerouted[0].token,claims[0].token);
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

test('catalog follows chosen dealer while dealer inventory remains authoritative',()=>{assert.deepEqual([...offerLeadDealerIds(['catalog-car'],'dealer_other')],['dealer_other']);assert.deepEqual([...offerLeadDealerIds(['special_dealer_one__car'],'dealer_other')],['dealer_one']);assert.equal(offerLeadDealerIds(['special_dealer_one__car','special_dealer_two__car']).size,2);});


test('general chat contains active staff; rooms enforce membership, versions and revoked access',()=>isolated(async()=>{
 const general='team_general';assert.equal((await chatList(owner)).threads[0].id,general);
 await sendChatMessage(manager,general,{text:'Всем привет 👋',operationId:'general-message-001'});
 assert.equal((await chatDetail(third,general)).messages[0].text,'Всем привет 👋');
 const input={title:'Логистика',participants:[manager.id],operationId:'create-room-001'};
 const room=await createChatRoom(owner,input);assert.equal((await createChatRoom(owner,input)).id,room.id);
 await assert.rejects(chatDetail(third,room.id),/chat_forbidden/);
 await sendChatMessage(owner,room.id,{text:'Внутри комнаты',operationId:'room-message-001'});
 await assert.rejects(updateChatRoom(manager,room.id,{version:1,participants:[third.id]}),/chat_forbidden/);
 const joined=await updateChatRoom(owner,room.id,{version:1,participants:[manager.id,third.id]});assert.equal(joined.version,2);
 assert.equal((await chatDetail(third,room.id)).messages.length,1);
 await assert.rejects(updateChatRoom(owner,room.id,{version:1,participants:[]}),/room_conflict/);
 await updateChatRoom(owner,room.id,{version:2,participants:[manager.id]});await assert.rejects(chatDetail(third,room.id),/chat_forbidden/);
 await assert.rejects(updateChatRoom(owner,general,{version:0,participants:[]}),/chat_forbidden/);
 await writeDataJson('auth/users.json',[owner,manager,{...third,status:'disabled'}]);
 assert.equal((await chatDetail(owner,general)).members?.length,2);await assert.rejects(chatDetail(third,general),/chat_forbidden/);
 await assert.rejects(createChatRoom(owner,{...input,participants:['missing'],operationId:'create-room-002'}),/invalid_members/);
 assert.equal((await readChunkedDataJson('telegram/crm-outbox.json',[])).length,0);
}));
test('reactions are persistent, idempotent, per-user and guarded by message access',()=>isolated(async()=>{
 const {id}=await createDirectChat(owner,manager.id);const d=await sendChatMessage(owner,id,{text:'План',operationId:'reaction-message-001'});const mid=d.messages[0].id;
 const reaction={messageId:mid,emoji:'👍',active:true};await reactToChatMessage(owner,id,reaction);await reactToChatMessage(owner,id,reaction);
 await reactToChatMessage(manager,id,reaction);let m=(await chatDetail(owner,id)).messages[0];assert.equal(m.reactions[0].count,2);assert.equal(m.reactions[0].mine,true);
 await reactToChatMessage(owner,id,{...reaction,active:false});m=(await chatDetail(owner,id)).messages[0];assert.equal(m.reactions[0].count,1);assert.equal(m.reactions[0].mine,false);
 await assert.rejects(reactToChatMessage(third,id,reaction),/chat_forbidden/);await assert.rejects(reactToChatMessage(owner,id,{...reaction,messageId:'missing'}),/chat_forbidden/);await assert.rejects(reactToChatMessage(owner,id,{...reaction,emoji:'<script>'}),/invalid_reaction/);
}));
test('own edits, replies, deletion and internal forwarding respect ownership and retry boundaries',()=>isolated(async()=>{
 const {id}=await createDirectChat(owner,manager.id),input={text:'Исходный текст',operationId:'edit-message-001'};
 const first=await sendChatMessage(owner,id,input),mid=first.messages[0].id;
 await assert.rejects(changeChatMessage(manager,id,{action:'edit',messageId:mid,text:'Чужая правка',version:0,operationId:'edit-operation-001'}),/chat_forbidden/);
 const edit={action:'edit',messageId:mid,text:'Исправлено 😊',version:0,operationId:'edit-operation-002'};
 await changeChatMessage(owner,id,edit);await changeChatMessage(owner,id,edit);
 let m=(await chatDetail(manager,id)).messages[0];assert.equal(m.text,'Исправлено 😊');assert.equal(m.version,1);assert.ok(m.editedAt);
 await assert.rejects(changeChatMessage(owner,id,{...edit,text:'Устаревшая правка',operationId:'edit-operation-003'}),/message_conflict/);
 await sendChatMessage(manager,id,{text:'Отвечаю',replyToId:mid,operationId:'reply-operation-001'});
 const forward={sourceThread:id,messageId:mid,operationId:'forward-operation-001'};
 await forwardChatMessage(owner,'team_general',forward);await forwardChatMessage(owner,'team_general',forward);
 const forwarded=(await chatDetail(third,'team_general')).messages;assert.equal(forwarded.length,1);assert.equal(forwarded[0].forwarded.author,owner.displayName);
 await assert.rejects(forwardChatMessage(third,'team_general',{...forward,operationId:'forward-operation-002'}),/chat_forbidden/);
 await assert.rejects(forwardChatMessage(owner,'lead:some-client',forward),/chat_forbidden/);
 await assert.rejects(sendChatMessage(owner,id,{text:'Ответ',replyToId:'unknown',operationId:'bad-reply-001'}),/invalid_reply/);
 await changeChatMessage(owner,id,{action:'delete',messageId:mid,version:1});await changeChatMessage(owner,id,{action:'delete',messageId:mid,version:1});
 const messages=(await chatDetail(manager,id)).messages;assert.equal(messages[0].deleted,true);assert.equal(messages[0].text,'Сообщение удалено');assert.equal(messages[1].replyTo.text,'Сообщение удалено');
 await assert.rejects(reactToChatMessage(owner,id,{messageId:mid,emoji:'👍',active:true}),/chat_forbidden/);
 assert.equal((await readChunkedDataJson('telegram/crm-outbox.json',[])).length,0);
}));
test('revoked chat access blocks reads and writes and excludes employee from recipients',()=>isolated(async()=>{
 const denied={...manager,permissions:{...manager.permissions,chat:false}};
 await writeDataJson('auth/users.json',[owner,denied,third]);
 await assert.rejects(chatList(denied),/chat_forbidden/);
 await assert.rejects(chatDetail(denied,'team_general'),/chat_forbidden/);
 await assert.rejects(sendChatMessage(denied,'team_general',{text:'Denied',operationId:'operation-denied'}),/chat_forbidden/);
 await assert.rejects(createDirectChat(owner,denied.id),/chat_forbidden/);
 assert.equal((await chatList(owner)).team.some(u=>u.id===denied.id),false);
 assert.equal((await chatDetail(owner,'team_general')).members?.some(u=>u.id===denied.id),false);
}));
test('notification replies retain the original thread and customer quotes cannot cross lead boundaries',()=>isolated(async()=>{
 const {id}=await createDirectChat(owner,manager.id);
 await sendChatMessage(owner,id,{text:'Проверить документы',operationId:'notice-source-001'});
 const notices=await chatDetail(manager,'notifications');const notice=notices.messages.find(m=>m.replyTarget?.kind==='chat');
 assert.equal(notice?.replyTarget?.thread,id);assert.equal(notice?.replyTarget?.messageId,notice?.id);
 await sendChatMessage(manager,id,{text:'Проверил',replyToId:notice!.id,operationId:'notice-reply-001'});
 assert.equal((await chatDetail(owner,id)).messages.at(-1)?.replyTo?.text,'Проверить документы');
 await writeDataJson('leads/leads.json',[{id:'a',assignedManagerId:manager.id,telegramChatId:'12345'},{id:'b',assignedManagerId:manager.id,telegramChatId:'23456'}]);
 await writeDataJson('telegram/crm-messages.json',[{id:'in-a',leadId:'a',text:'Когда приедет?',direction:'in',createdAt:new Date().toISOString()},{id:'in-b',leadId:'b',text:'Другой клиент',direction:'in',createdAt:new Date().toISOString()}]);
 const input={text:'Завтра',replyToId:'in-a',operationId:'lead-quoted-001'};
 await sendChatMessage(manager,'lead:a',input);await sendChatMessage(manager,'lead:a',input);
 assert.equal((await chatDetail(manager,'lead:a')).messages.find(m=>m.mine)?.replyTo?.text,'Когда приедет?');
 const queue=await readChunkedDataJson<any>('telegram/crm-outbox.json',[]);assert.equal(queue.length,1);assert.match(queue[0].text,/В ответ на: Когда приедет\?/);
 await assert.rejects(sendChatMessage(manager,'lead:a',{...input,replyToId:'in-b',operationId:'bad-lead-quote'}),/invalid_reply/);
 await assert.rejects(sendChatMessage(manager,'lead:a',{...input,replyToId:undefined}),/message_conflict/);
}));

test('system event replies require an accessible notice and explicit team destination',()=>isolated(async()=>{
 const {notifyTeam}=await import('../apps/web/lib/crm-notification-store');
 const {id}=await createDirectChat(owner,manager.id);
 await notifyTeam({id:'event-visible',createdAt:new Date().toISOString(),recipientIds:[owner.id],kind:'staff',title:'Изменение графика',text:'Завтра с 10:00',href:'/crm/managers'});
 const notice=(await chatDetail(owner,'notifications')).messages.find(m=>m.id==='event-visible');assert.deepEqual(notice?.replyTarget,{kind:'notice',noticeId:'event-visible'});
 const input={text:'Принято',noticeId:'event-visible',operationId:'event-reply-001'};
 await sendChatMessage(owner,id,input);await sendChatMessage(owner,id,input);
 const messages=(await chatDetail(manager,id)).messages;assert.equal(messages.length,1);assert.equal(messages[0].replyTo?.text,'Завтра с 10:00');
 await assert.rejects(sendChatMessage(manager,id,{...input,operationId:'event-denied-001'}),/invalid_reply/);
 await assert.rejects(sendChatMessage(owner,id,{...input,noticeId:undefined}),/message_conflict/);
}));
